"""The master switch: switch.kevin."""

from __future__ import annotations

from homeassistant.components.switch import SwitchEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity import DeviceInfo
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.restore_state import RestoreEntity

from .const import DOMAIN, SIGNAL_UPDATE
from .coordinator import KevinCoordinator


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    coordinator: KevinCoordinator = hass.data[DOMAIN][entry.entry_id]
    async_add_entities([KevinSwitch(coordinator)])


class KevinSwitch(SwitchEntity, RestoreEntity):
    """Arms/disarms the presence simulation."""

    _attr_has_entity_name = True
    _attr_name = None
    _attr_icon = "mdi:home-account"

    def __init__(self, coordinator: KevinCoordinator) -> None:
        self._coordinator = coordinator
        self._attr_unique_id = coordinator.entry.entry_id
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, coordinator.entry.entry_id)},
            name="House Agent Kevin",
            manufacturer="House Agent Kevin",
        )

    @property
    def is_on(self) -> bool:
        return self._coordinator.armed

    async def async_turn_on(self, **kwargs) -> None:
        await self._coordinator.async_arm(regenerate=True)

    async def async_turn_off(self, **kwargs) -> None:
        await self._coordinator.async_disarm()

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        self.async_on_remove(
            async_dispatcher_connect(
                self.hass,
                SIGNAL_UPDATE.format(self._coordinator.entry.entry_id),
                self._handle_update,
            )
        )
        # Resume a previously-armed state after a restart, replaying the
        # persisted plan (no re-roll).
        last = await self.async_get_last_state()
        if last is not None and last.state == "on":
            await self._coordinator.async_arm(regenerate=False)

    @callback
    def _handle_update(self) -> None:
        self.async_write_ha_state()
