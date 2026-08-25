"""Ready-made timing patterns for a clip.

A pattern describes only the *shape* of a window — "sunset -15 until 23:00",
"19:00 to 23:00" — never which entity it applies to. Because the sun-anchored
edges are relative, the same pattern lands correctly whatever the season or the
date range it is applied to.

Pure module: no Home Assistant imports, so it stays unit-testable.
"""

from __future__ import annotations

_SUN = "sun"
_FIXED = "fixed"


def _sun(offset: int) -> dict:
    return {"type": _SUN, "event": "sunset", "offset": offset}


def _at(time: str) -> dict:
    return {"type": _FIXED, "time": time}


# Ordered from "starts around dusk" to "late night", which is how they read in a
# dropdown. `name` is what the card shows; ids are stable, names are not.
TIMINGS: list[dict] = [
    {
        "id": "dusk_to_2300",
        "name": "Coucher −15 → 23h00",
        "hint": "S'allume juste avant la tombée du jour, s'éteint à heure fixe.",
        "start": _sun(-15),
        "end": _at("23:00"),
    },
    {
        "id": "dusk_to_0030",
        "name": "Coucher −15 → 00h30",
        "hint": "Comme au-dessus, mais on veille tard.",
        "start": _sun(-15),
        "end": _at("00:30"),
    },
    {
        "id": "deco_dusk_to_2300",
        "name": "Coucher −30 → 23h00",
        "hint": "Déco extérieure : allumée avant la nuit, coupée à heure fixe.",
        "start": _sun(-30),
        "end": _at("23:00"),
        "jitter": 10,
    },
    {
        "id": "meal",
        "name": "Coucher → coucher +1h30",
        "hint": "Le repas : suit le soleil d'un bout à l'autre.",
        "start": _sun(0),
        "end": _sun(90),
    },
    {
        "id": "evening",
        "name": "Coucher +1h → coucher +3h",
        "hint": "La soirée au salon, entièrement calée sur le soleil.",
        "start": _sun(60),
        "end": _sun(180),
    },
    {
        "id": "late_light",
        "name": "Coucher +2h30 → +20 min",
        "hint": "La lumière tardive, brève, avant d'aller se coucher.",
        "start": _sun(150),
        "end": _sun(170),
    },
    {
        "id": "fixed_1900_2300",
        "name": "19h00 → 23h00",
        "hint": "Heures fixes : ne bouge pas avec la saison.",
        "start": _at("19:00"),
        "end": _at("23:00"),
    },
    {
        "id": "fixed_2000_0030",
        "name": "20h00 → 00h30",
        "hint": "Heures fixes, soirée longue.",
        "start": _at("20:00"),
        "end": _at("00:30"),
    },
]


def as_clip(timing_id: str, entity_id: str) -> dict | None:
    """Build a clip for `entity_id` from a timing pattern id."""
    timing = next((t for t in TIMINGS if t["id"] == timing_id), None)
    if timing is None:
        return None
    clip = {
        "entity_id": entity_id,
        "start": dict(timing["start"]),
        "end": dict(timing["end"]),
    }
    if "jitter" in timing:
        clip["jitter"] = timing["jitter"]
    return clip
