"""The coordinator: pre-generate + persist + schedule + fire the plan."""

from __future__ import annotations

import logging
import random
from datetime import datetime

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.helpers.event import async_track_point_in_time
from homeassistant.helpers.storage import Store
import homeassistant.util.dt as dt_util

from .const import (
    ACTION_ON,
    ACTION_ONESHOT,
    ACTION_SAFETY_OFF,
    DOMAIN,
    SIGNAL_UPDATE,
    STORAGE_KEY,
    STORAGE_VERSION,
)
from .generator import generate_plan
from .models import KevinConfig, Plan, ScheduledEvent
from .sun import Location

_LOGGER = logging.getLogger(__name__)

# Domains for which turn_on/turn_off is meaningful; anything else falls back to
# the generic homeassistant.turn_on/off.
_TURN_DOMAINS = {"light", "switch", "media_player", "fan", "input_boolean", "climate", "cover", "humidifier"}


class KevinCoordinator:
    """Owns the plan lifecycle for one config entry."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry, config: KevinConfig) -> None:
        self.hass = hass
        self.entry = entry
        self.config = config
        self.armed = False
        self.plan: Plan | None = None
        self._store: Store = Store(hass, STORAGE_VERSION, f"{DOMAIN}.{entry.entry_id}.plan")
        self._events: list[ScheduledEvent] = []
        self._idx: int | None = None
        self._unsub = None

    # -- lifecycle --------------------------------------------------------- #
    async def async_load(self) -> None:
        """Load any persisted plan (called on setup, before entities add)."""
        data = await self._store.async_load()
        if data:
            try:
                self.plan = Plan.from_dict(data)
            except (KeyError, ValueError) as err:  # corrupt / old format
                _LOGGER.warning("Ignoring unreadable persisted plan: %s", err)
                self.plan = None

    def _location(self) -> Location:
        return Location(
            latitude=self.hass.config.latitude,
            longitude=self.hass.config.longitude,
            time_zone=str(self.hass.config.time_zone),
            elevation=self.hass.config.elevation,
        )

    async def _generate(self) -> None:
        seed = random.randint(1, 2**31 - 1)
        now = dt_util.now()
        self.plan = await self.hass.async_add_executor_job(
            generate_plan, self.config, self._location(), seed, now
        )
        await self._store.async_save(self.plan.to_dict())
        _LOGGER.info("Kevin generated a %d-day plan (seed %d)", len(self.plan.days), seed)

    # -- arm / disarm / regenerate ---------------------------------------- #
    async def async_arm(self, regenerate: bool = True) -> None:
        """Arm Kevin. Generates a fresh plan unless resuming a persisted one."""
        self.armed = True
        if regenerate or self.plan is None:
            await self._generate()
        self._reschedule()
        await self._apply_current_state()
        self._notify()

    async def async_disarm(self) -> None:
        self.armed = False
        self._cancel()
        self._notify()

    async def async_regenerate(self) -> None:
        """Re-roll the whole séjour (only meaningful while armed)."""
        if not self.armed:
            return
        await self._generate()
        self._reschedule()
        self._notify()

    # -- scheduling -------------------------------------------------------- #
    @callback
    def _cancel(self) -> None:
        if self._unsub is not None:
            self._unsub()
            self._unsub = None

    @callback
    def _reschedule(self) -> None:
        """(Re)build the flat event list and arm the timer for the next one."""
        self._cancel()
        if self.plan is None:
            self._events = []
            self._idx = None
            return
        self._events = self.plan.all_events()
        now = dt_util.now()
        self._idx = next((i for i, e in enumerate(self._events) if e.t > now), None)
        self._arm_timer()

    @callback
    def _arm_timer(self) -> None:
        if self._idx is None or self._idx >= len(self._events):
            return
        self._unsub = async_track_point_in_time(self.hass, self._handle, self._events[self._idx].t)

    async def _apply_current_state(self) -> None:
        """Bring entities to the state the plan implies *right now*.

        Called on every arm, so arming mid-evening (or resuming after a reboot)
        turns on what should be on and off what should be off, instead of waiting
        for the next scheduled edge.
        """
        now = dt_util.now()
        state: dict[str, bool] = {}
        for event in self._events:
            if event.t > now:
                break
            if event.action == ACTION_SAFETY_OFF:
                for entity_id in self.config.controlled_entities():
                    state[entity_id] = False
            elif event.action == ACTION_ON:
                state[event.entity_id] = True
            elif event.action == ACTION_OFF:
                state[event.entity_id] = False
        for entity_id, on in state.items():
            await self._turn(entity_id, on=on)

    async def _handle(self, _now: datetime) -> None:
        self._unsub = None
        now = dt_util.now()
        while self._idx is not None and self._idx < len(self._events) and self._events[self._idx].t <= now:
            await self._execute(self._events[self._idx])
            self._idx += 1
        self._notify()
        self._arm_timer()

    # -- execution --------------------------------------------------------- #
    async def _execute(self, event: ScheduledEvent) -> None:
        if event.action == ACTION_SAFETY_OFF:
            for entity_id in sorted(self.config.controlled_entities()):
                await self._turn(entity_id, on=False)
            return
        if event.action == ACTION_ONESHOT:
            await self._oneshot(event)
            return
        await self._turn(event.entity_id, on=event.action == ACTION_ON)

    async def _turn(self, entity_id: str, on: bool) -> None:
        domain = entity_id.split(".", 1)[0]
        service_domain = domain if domain in _TURN_DOMAINS else "homeassistant"
        service = "turn_on" if on else "turn_off"
        await self._call(service_domain, service, {"entity_id": entity_id})

    async def _oneshot(self, event: ScheduledEvent) -> None:
        domain = event.entity_id.split(".", 1)[0]
        if event.service and "." in event.service:
            service_domain, service = event.service.split(".", 1)
        else:
            service_domain = domain
            service = event.service or "turn_on"
        data = {"entity_id": event.entity_id, **(event.data or {})}
        await self._call(service_domain, service, data)

    async def _call(self, domain: str, service: str, data: dict) -> None:
        try:
            await self.hass.services.async_call(domain, service, data, blocking=False)
        except Exception as err:  # noqa: BLE001 — never let one bad entity kill the loop
            _LOGGER.error("Kevin: %s.%s(%s) failed: %s", domain, service, data.get("entity_id"), err)

    # -- state readouts (for sensors) ------------------------------------- #
    def next_event(self) -> ScheduledEvent | None:
        if not self.armed:
            return None
        now = dt_util.now()
        return next((e for e in self._events if e.t > now), None)

    def active_mix_name(self) -> str | None:
        if not self.armed or self.plan is None:
            return None
        mix_id = self.plan.mix_for(dt_util.now().date().isoformat())
        if not mix_id:
            return None
        mix = self.config.mixes.get(mix_id)
        return mix.name if mix else mix_id

    @callback
    def _notify(self) -> None:
        async_dispatcher_send(self.hass, SIGNAL_UPDATE.format(self.entry.entry_id))
