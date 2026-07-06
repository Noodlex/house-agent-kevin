"""Config + options flow for House Agent Kevin.

The config flow is the setup wizard: pick the entities Kevin controls plus a few
settings, and a working config (with a plausible starter mix) is built for you —
no JSON editing. The options flow re-tunes those settings (and lets you re-pick
entities, which rebuilds the starter mix). Fine per-clip editing lands in the
card editor.
"""

from __future__ import annotations

from datetime import timedelta

import voluptuous as vol

from homeassistant.config_entries import ConfigEntry, ConfigFlow, OptionsFlow
from homeassistant.core import callback
from homeassistant.data_entry_flow import FlowResult
from homeassistant.helpers.selector import selector
import homeassistant.util.dt as dt_util

from .const import DOMAIN, MODE_GLOBAL, MODE_POOL, MODE_ROTATION, MODE_WEEKDAY
from .defaults import build_config, build_default_mix
from .preset import apply_options, first_jitter, load_preset

_ENTITY_SELECTOR = selector(
    {"entity": {"multiple": True, "filter": {"domain": ["light", "switch", "media_player", "script"]}}}
)
_MODE_SELECTOR = selector(
    {"select": {"options": [MODE_GLOBAL, MODE_POOL, MODE_WEEKDAY, MODE_ROTATION], "mode": "dropdown"}}
)


class KevinConfigFlow(ConfigFlow, domain=DOMAIN):
    """Setup wizard."""

    VERSION = 1

    async def async_step_user(self, user_input: dict | None = None) -> FlowResult:
        await self.async_set_unique_id(DOMAIN)
        self._abort_if_unique_id_configured()

        errors: dict[str, str] = {}
        if user_input is not None:
            if not user_input.get("entities"):
                errors["entities"] = "no_entities"
            else:
                config = build_config(
                    entities=user_input["entities"],
                    start_date=user_input["start_date"],
                    end_date=user_input["end_date"],
                    mode=user_input["mode"],
                    rotation_length=int(user_input["rotation_length"]),
                    jitter=int(user_input["jitter"]),
                    safety_off=user_input["safety_off"],
                )
                return self.async_create_entry(title="House Agent Kevin", data={"config": config})

        today = dt_util.now().date()
        end = today + timedelta(days=14)
        schema = vol.Schema(
            {
                vol.Required("entities"): _ENTITY_SELECTOR,
                vol.Required("start_date", default=today.isoformat()): selector({"date": {}}),
                vol.Required("end_date", default=end.isoformat()): selector({"date": {}}),
                vol.Required("mode", default=MODE_GLOBAL): _MODE_SELECTOR,
                vol.Required("rotation_length", default=3): selector({"number": {"min": 1, "max": 14, "mode": "box"}}),
                vol.Required("jitter", default=20): selector(
                    {"number": {"min": 0, "max": 90, "mode": "box", "unit_of_measurement": "min"}}
                ),
                vol.Required("safety_off", default="01:00:00"): selector({"time": {}}),
            }
        )
        return self.async_show_form(step_id="user", data_schema=schema, errors=errors)

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> "KevinOptionsFlow":
        return KevinOptionsFlow(config_entry)


class KevinOptionsFlow(OptionsFlow):
    """Re-tune settings; re-picking entities rebuilds the starter mix."""

    def __init__(self, config_entry: ConfigEntry) -> None:
        self._entry = config_entry

    def _current(self) -> dict:
        return self._entry.options.get("config") or self._entry.data.get("config") or load_preset()

    async def async_step_init(self, user_input: dict | None = None) -> FlowResult:
        current = self._current()

        if user_input is not None:
            new_config = apply_options(current, user_input)
            entities = user_input.get("entities")
            if entities:
                # Rebuild the starter mix from the (possibly changed) entities,
                # preserving its id so the séjour rule keeps pointing at it.
                first_id = next(iter(new_config.get("mixes", {})), "soiree")
                mix = build_default_mix(entities, jitter_default=int(user_input["jitter"]), mix_id=first_id)
                new_config["mixes"][first_id] = mix
            return self.async_create_entry(title="", data={"config": new_config})

        sejour = current.get("sejour", {})
        rule = sejour.get("rule", {})
        controlled = sorted({c["entity_id"] for m in current.get("mixes", {}).values() for c in m.get("clips", [])})
        schema = vol.Schema(
            {
                vol.Optional("entities", default=controlled): _ENTITY_SELECTOR,
                vol.Required("start_date", default=sejour.get("start_date")): selector({"date": {}}),
                vol.Required("end_date", default=sejour.get("end_date")): selector({"date": {}}),
                vol.Required("mode", default=rule.get("mode", MODE_GLOBAL)): _MODE_SELECTOR,
                vol.Required("rotation_length", default=rule.get("length", 3)): selector(
                    {"number": {"min": 1, "max": 14, "mode": "box"}}
                ),
                vol.Required("jitter", default=first_jitter(current)): selector(
                    {"number": {"min": 0, "max": 90, "mode": "box", "unit_of_measurement": "min"}}
                ),
                vol.Required("safety_off", default=f"{current.get('safety_off', '01:00')}:00"): selector({"time": {}}),
            }
        )
        return self.async_show_form(step_id="init", data_schema=schema)
