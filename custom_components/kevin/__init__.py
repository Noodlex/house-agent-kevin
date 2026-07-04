"""House Agent Kevin — presence simulation for Home Assistant.

Simulates presence while you're away (Home Alone style): a master switch arms a
pre-generated, persisted plan that turns lights on/off in a plausible,
never-repeating order, anchored to the real sunset.

See VISION.md and docs/MVP-PLAN.md in the repo.
"""

from __future__ import annotations

import json
import logging
import os

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, ServiceCall

from .const import (
    DOMAIN,
    PLATFORMS,
    SERVICE_REGENERATE,
    SERVICE_START,
    SERVICE_STOP,
)
from .coordinator import KevinCoordinator
from .models import KevinConfig

_LOGGER = logging.getLogger(__name__)

_PRESET_PATH = os.path.join(os.path.dirname(__file__), "presets", "reference.json")


def _load_preset() -> dict:
    with open(_PRESET_PATH, encoding="utf-8") as fp:
        return json.load(fp)


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up House Agent Kevin from a config entry."""
    raw = entry.options.get("config") or await hass.async_add_executor_job(_load_preset)
    config = KevinConfig.from_dict(raw)

    coordinator = KevinCoordinator(hass, entry, config)
    await coordinator.async_load()

    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = coordinator

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    _register_services(hass)
    entry.async_on_unload(entry.add_update_listener(_async_reload_entry))
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    unload_ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    coordinator: KevinCoordinator | None = hass.data.get(DOMAIN, {}).get(entry.entry_id)
    if coordinator is not None:
        await coordinator.async_disarm()
    if unload_ok:
        hass.data[DOMAIN].pop(entry.entry_id, None)
        if not hass.data[DOMAIN]:
            _unregister_services(hass)
    return unload_ok


async def _async_reload_entry(hass: HomeAssistant, entry: ConfigEntry) -> None:
    await hass.config_entries.async_reload(entry.entry_id)


def _coordinators(hass: HomeAssistant) -> list[KevinCoordinator]:
    return list(hass.data.get(DOMAIN, {}).values())


def _register_services(hass: HomeAssistant) -> None:
    if hass.services.has_service(DOMAIN, SERVICE_START):
        return

    async def _start(call: ServiceCall) -> None:
        for coordinator in _coordinators(hass):
            await coordinator.async_arm(regenerate=True)

    async def _stop(call: ServiceCall) -> None:
        for coordinator in _coordinators(hass):
            await coordinator.async_disarm()

    async def _regenerate(call: ServiceCall) -> None:
        for coordinator in _coordinators(hass):
            await coordinator.async_regenerate()

    hass.services.async_register(DOMAIN, SERVICE_START, _start)
    hass.services.async_register(DOMAIN, SERVICE_STOP, _stop)
    hass.services.async_register(DOMAIN, SERVICE_REGENERATE, _regenerate)


def _unregister_services(hass: HomeAssistant) -> None:
    for service in (SERVICE_START, SERVICE_STOP, SERVICE_REGENERATE):
        hass.services.async_remove(DOMAIN, service)
