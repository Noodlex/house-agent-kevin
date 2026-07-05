"""WebSocket API so the Lovelace card can read the generated plan.

A frontend card cannot read the persisted Store directly, so it fetches the plan
(plus per-day sun times) over the HA WebSocket connection via `kevin/get_plan`.
"""

from __future__ import annotations

from datetime import date

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant

from .const import DOMAIN
from .generator import resolve_reference
from .sun import sun_times

_WS_REGISTERED = f"{DOMAIN}_ws_registered"


def async_register(hass: HomeAssistant) -> None:
    """Register the WebSocket commands once."""
    if hass.data.get(_WS_REGISTERED):
        return
    hass.data[_WS_REGISTERED] = True
    websocket_api.async_register_command(hass, ws_get_plan)
    websocket_api.async_register_command(hass, ws_set_override)


def _first_coordinator(hass: HomeAssistant):
    for coordinator in hass.data.get(DOMAIN, {}).values():
        if hasattr(coordinator, "async_get_or_preview_plan"):
            return coordinator
    return None


@websocket_api.websocket_command({vol.Required("type"): "kevin/get_plan"})
@websocket_api.async_response
async def ws_get_plan(hass: HomeAssistant, connection, msg: dict) -> None:
    """Return the current (or preview) plan with per-day sun times."""
    coordinator = _first_coordinator(hass)
    if coordinator is None:
        connection.send_error(msg["id"], "not_found", "House Agent Kevin is not set up")
        return

    plan = await coordinator.async_get_or_preview_plan()
    location = coordinator.location()
    mixes = coordinator.config.mixes
    reference = coordinator.config.reference
    overrides = coordinator.config.sejour.overrides

    def _build() -> list[dict]:
        days: list[dict] = []
        for date_iso, day_plan in sorted(plan.days.items()):
            day = date.fromisoformat(date_iso)
            times = sun_times(location, day)
            mix = mixes.get(day_plan.mix)
            days.append(
                {
                    "date": date_iso,
                    "mix": day_plan.mix,
                    "mix_name": mix.name if mix else day_plan.mix,
                    "sunrise": times["sunrise"].isoformat(),
                    "sunset": times["sunset"].isoformat(),
                    "events": [e.to_dict() for e in day_plan.events],
                    "reference": resolve_reference(reference, day, location),
                    "overridden": date_iso in overrides,
                }
            )
        return days

    days = await hass.async_add_executor_job(_build)

    connection.send_result(
        msg["id"],
        {
            "armed": coordinator.armed,
            "sejour": {"start": plan.start_date.isoformat(), "end": plan.end_date.isoformat()},
            "safety_off": coordinator.config.safety_off.strftime("%H:%M"),
            "mixes": {mix_id: {"name": mix.name} for mix_id, mix in mixes.items()},
            "days": days,
        },
    )


@websocket_api.websocket_command(
    {
        vol.Required("type"): "kevin/set_override",
        vol.Required("date"): str,
        vol.Optional("mix"): vol.Any(str, None),
    }
)
@websocket_api.async_response
async def ws_set_override(hass: HomeAssistant, connection, msg: dict) -> None:
    """Paint (or clear) the mix for a specific day."""
    coordinator = _first_coordinator(hass)
    if coordinator is None:
        connection.send_error(msg["id"], "not_found", "House Agent Kevin is not set up")
        return
    await coordinator.async_set_override(msg["date"], msg.get("mix"))
    connection.send_result(msg["id"], {"ok": True})
