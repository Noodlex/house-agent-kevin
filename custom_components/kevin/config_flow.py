"""Config + options flow for House Agent Kevin.

The config flow is a single-instance, no-input flow that loads the bundled
reference preset. The options flow lets you tune the key knobs (séjour dates,
planning mode, rotation length, global jitter, safety-off) from the UI without
touching JSON. Editing individual mixes / clips comes later (card editor).
"""

from __future__ import annotations

import voluptuous as vol

from homeassistant.config_entries import ConfigEntry, ConfigFlow, OptionsFlow
from homeassistant.core import callback
from homeassistant.data_entry_flow import FlowResult
from homeassistant.helpers.selector import selector

from .const import DOMAIN, MODE_GLOBAL, MODE_POOL, MODE_ROTATION, MODE_WEEKDAY
from .preset import apply_options, first_jitter, load_preset


class KevinConfigFlow(ConfigFlow, domain=DOMAIN):
    """Handle the config flow."""

    VERSION = 1

    async def async_step_user(self, user_input: dict | None = None) -> FlowResult:
        await self.async_set_unique_id(DOMAIN)
        self._abort_if_unique_id_configured()
        if user_input is not None:
            return self.async_create_entry(title="House Agent Kevin", data={})
        return self.async_show_form(step_id="user")

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> "KevinOptionsFlow":
        return KevinOptionsFlow(config_entry)


class KevinOptionsFlow(OptionsFlow):
    """Tune the key knobs from the UI."""

    def __init__(self, config_entry: ConfigEntry) -> None:
        self._entry = config_entry

    async def async_step_init(self, user_input: dict | None = None) -> FlowResult:
        current = self._entry.options.get("config") or await self.hass.async_add_executor_job(load_preset)

        if user_input is not None:
            new_config = apply_options(current, user_input)
            return self.async_create_entry(title="", data={"config": new_config})

        sejour = current.get("sejour", {})
        rule = sejour.get("rule", {})
        schema = vol.Schema(
            {
                vol.Required("start_date", default=sejour.get("start_date")): selector({"date": {}}),
                vol.Required("end_date", default=sejour.get("end_date")): selector({"date": {}}),
                vol.Required("mode", default=rule.get("mode", MODE_GLOBAL)): selector(
                    {
                        "select": {
                            "options": [MODE_GLOBAL, MODE_POOL, MODE_WEEKDAY, MODE_ROTATION],
                            "mode": "dropdown",
                        }
                    }
                ),
                vol.Required("rotation_length", default=rule.get("length", 3)): selector(
                    {"number": {"min": 1, "max": 14, "mode": "box"}}
                ),
                vol.Required("safety_off", default=f"{current.get('safety_off', '01:00')}:00"): selector(
                    {"time": {}}
                ),
                vol.Required("jitter", default=first_jitter(current)): selector(
                    {"number": {"min": 0, "max": 90, "mode": "box", "unit_of_measurement": "min"}}
                ),
            }
        )
        return self.async_show_form(step_id="init", data_schema=schema)
