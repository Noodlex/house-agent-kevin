"""The "régie": put the house in away mode on arm, restore it on disarm.

- Automations: record their on/off state, then turn them off. Restored on disarm.
- Components (thermostatic valves, etc.): snapshot into a HA scene, then run the
  configured away actions. The scene restores them on disarm.

Everything is reversible. The snapshot dict is persisted by the coordinator so an
early return still restores what was suspended.
"""

from __future__ import annotations

import logging

from homeassistant.core import HomeAssistant

from .models import Regie

_LOGGER = logging.getLogger(__name__)

SCENE_ID = "kevin_regie_restore"
SCENE_ENTITY = f"scene.{SCENE_ID}"


async def async_apply(hass: HomeAssistant, regie: Regie) -> dict:
    """Enter away mode; return a snapshot used to restore later."""
    snapshot: dict = {"automations": {}, "scene": None}

    for automation_id in regie.suspend_automations:
        state = hass.states.get(automation_id)
        was_on = state is not None and state.state == "on"
        snapshot["automations"][automation_id] = was_on
        if was_on:
            await _call(hass, "automation", "turn_off", {"entity_id": automation_id})

    if regie.snapshot_entities:
        await _call(
            hass,
            "scene",
            "create",
            {"scene_id": SCENE_ID, "snapshot_entities": regie.snapshot_entities},
        )
        snapshot["scene"] = SCENE_ENTITY

    for action in regie.away_actions:
        service = action.get("service", "")
        if "." not in service:
            continue
        domain, name = service.split(".", 1)
        data = dict(action.get("data", {}))
        data.update(action.get("target", {}))
        await _call(hass, domain, name, data)

    _LOGGER.info("Kevin régie: away mode applied")
    return snapshot


async def async_restore(hass: HomeAssistant, snapshot: dict) -> None:
    """Leave away mode: restore automations and replay the snapshot scene."""
    if not snapshot:
        return
    for automation_id, was_on in (snapshot.get("automations") or {}).items():
        if was_on:
            await _call(hass, "automation", "turn_on", {"entity_id": automation_id})

    scene = snapshot.get("scene")
    if scene and hass.states.get(scene) is not None:
        await _call(hass, "scene", "turn_on", {"entity_id": scene})

    _LOGGER.info("Kevin régie: away mode restored")


async def _call(hass: HomeAssistant, domain: str, service: str, data: dict) -> None:
    try:
        await hass.services.async_call(domain, service, data, blocking=True)
    except Exception as err:  # noqa: BLE001
        _LOGGER.error("Kevin régie: %s.%s(%s) failed: %s", domain, service, data, err)
