"""Build a working config from UI choices — no JSON editing required.

Given the entities the user picks in the config flow (plus a few settings), this
produces a plausible starter mix (sun-anchored, staggered) and a full config.
Pure module: no Home Assistant imports, so it is unit-testable.
"""

from __future__ import annotations

DEFAULT_MIX_ID = "soiree"
DEFAULT_MIX_NAME = "Soirée type"


def build_default_mix(
    entity_ids: list[str],
    jitter_default: int = 20,
    mix_id: str = DEFAULT_MIX_ID,
    name: str = DEFAULT_MIX_NAME,
) -> dict:
    """A plausible evening built from the chosen entities.

    Lights get staggered sun-anchored windows; switches (decoy plugs) mimic the
    usual "sunset-30 -> 23:00"; media players get an evening block; scripts become
    an occasional one-shot.
    """
    clips: list[dict] = []
    oneshots: list[dict] = []

    lights = [e for e in entity_ids if e.startswith("light.")]
    for i, entity_id in enumerate(lights):
        start_off = -15 + i * 15
        end_off = 90 + i * 20
        clips.append(
            {
                "entity_id": entity_id,
                "start": {"type": "sun", "event": "sunset", "offset": start_off},
                "end": {"type": "sun", "event": "sunset", "offset": end_off},
            }
        )

    for entity_id in entity_ids:
        if entity_id.startswith("switch."):
            clips.append(
                {
                    "entity_id": entity_id,
                    "start": {"type": "sun", "event": "sunset", "offset": -30},
                    "end": {"type": "fixed", "time": "23:00"},
                    "jitter": 10,
                }
            )
        elif entity_id.startswith("media_player."):
            clips.append(
                {
                    "entity_id": entity_id,
                    "start": {"type": "sun", "event": "sunset", "offset": 60},
                    "end": {"type": "sun", "event": "sunset", "offset": 180},
                }
            )
        elif entity_id.startswith("script."):
            oneshots.append(
                {
                    "entity_id": entity_id,
                    "at": {"type": "sun", "event": "sunset", "offset": 90},
                    "jitter": 30,
                    "service": "script.turn_on",
                }
            )

    return {
        "id": mix_id,
        "name": name,
        "jitter_default": jitter_default,
        "clips": clips,
        "oneshots": oneshots,
    }


def build_config(
    entities: list[str],
    start_date: str,
    end_date: str,
    mode: str = "global",
    rotation_length: int = 3,
    jitter: int = 20,
    safety_off: str = "01:00",
) -> dict:
    """A full config from the config-flow answers."""
    mix = build_default_mix(entities, jitter_default=jitter)
    rule: dict = {"mode": mode, "mix": mix["id"]}
    if mode in ("rotation", "pool"):
        rule["mixes"] = [mix["id"]]
        rule["length"] = rotation_length
    return {
        "mixes": {mix["id"]: mix},
        "sejour": {
            "start_date": start_date,
            "end_date": end_date,
            "rule": rule,
            "overrides": {},
        },
        "safety_off": str(safety_off)[:5],
        "regie": {},
        "reference": [],
    }
