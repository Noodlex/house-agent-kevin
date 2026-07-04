"""Config flow for House Agent Kevin.

MVP: a single-instance flow with no user input — it just creates the entry and
loads the bundled reference preset. UI editing of mixes and the séjour plan comes
later (options flow / the Lovelace card editor).
"""

from __future__ import annotations

from homeassistant.config_entries import ConfigFlow
from homeassistant.data_entry_flow import FlowResult

from .const import DOMAIN


class KevinConfigFlow(ConfigFlow, domain=DOMAIN):
    """Handle the config flow."""

    VERSION = 1

    async def async_step_user(self, user_input: dict | None = None) -> FlowResult:
        await self.async_set_unique_id(DOMAIN)
        self._abort_if_unique_id_configured()

        if user_input is not None:
            return self.async_create_entry(title="House Agent Kevin", data={})

        return self.async_show_form(step_id="user")
