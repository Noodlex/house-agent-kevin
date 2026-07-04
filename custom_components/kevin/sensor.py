"""Sensors: next event and active mix."""

from __future__ import annotations

from datetime import datetime

from homeassistant.components.sensor import SensorDeviceClass, SensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity import DeviceInfo
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DOMAIN, SIGNAL_UPDATE
from .coordinator import KevinCoordinator


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    coordinator: KevinCoordinator = hass.data[DOMAIN][entry.entry_id]
    async_add_entities([KevinNextEventSensor(coordinator), KevinActiveMixSensor(coordinator)])


class _KevinSensorBase(SensorEntity):
    _attr_has_entity_name = True

    def __init__(self, coordinator: KevinCoordinator, key: str, name: str) -> None:
        self._coordinator = coordinator
        self._attr_name = name
        self._attr_unique_id = f"{coordinator.entry.entry_id}_{key}"
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, coordinator.entry.entry_id)},
            name="House Agent Kevin",
            manufacturer="House Agent Kevin",
        )

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        self.async_on_remove(
            async_dispatcher_connect(
                self.hass,
                SIGNAL_UPDATE.format(self._coordinator.entry.entry_id),
                self._handle_update,
            )
        )

    @callback
    def _handle_update(self) -> None:
        self.async_write_ha_state()


class KevinNextEventSensor(_KevinSensorBase):
    _attr_icon = "mdi:clock-outline"
    _attr_device_class = SensorDeviceClass.TIMESTAMP

    def __init__(self, coordinator: KevinCoordinator) -> None:
        super().__init__(coordinator, "next_event", "Next event")

    @property
    def native_value(self) -> datetime | None:
        event = self._coordinator.next_event()
        return event.t if event else None

    @property
    def extra_state_attributes(self) -> dict:
        event = self._coordinator.next_event()
        if not event:
            return {}
        return {"entity_id": event.entity_id, "action": event.action}


class KevinActiveMixSensor(_KevinSensorBase):
    _attr_icon = "mdi:playlist-music"

    def __init__(self, coordinator: KevinCoordinator) -> None:
        super().__init__(coordinator, "active_mix", "Active mix")

    @property
    def native_value(self) -> str | None:
        return self._coordinator.active_mix_name()
