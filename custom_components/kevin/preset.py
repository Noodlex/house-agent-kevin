"""Loading the bundled reference preset (shared by setup and the options flow)."""

from __future__ import annotations

import copy
import json
import os

_PRESET_PATH = os.path.join(os.path.dirname(__file__), "presets", "reference.json")


def load_preset() -> dict:
    with open(_PRESET_PATH, encoding="utf-8") as fp:
        return json.load(fp)


def apply_options(config: dict, options: dict) -> dict:
    """Return a copy of `config` patched with the options-flow values."""
    cfg = copy.deepcopy(config)
    sejour = cfg.setdefault("sejour", {})
    rule = sejour.setdefault("rule", {})

    if options.get("start_date"):
        sejour["start_date"] = options["start_date"]
    if options.get("end_date"):
        sejour["end_date"] = options["end_date"]
    if options.get("mode"):
        rule["mode"] = options["mode"]
        # A rotation/pool needs a mix list; default to the whole library.
        if rule["mode"] in ("rotation", "pool") and not rule.get("mixes"):
            rule["mixes"] = list(cfg.get("mixes", {}).keys())
    if options.get("rotation_length"):
        rule["length"] = int(options["rotation_length"])
    if options.get("safety_off"):
        cfg["safety_off"] = str(options["safety_off"])[:5]
    if options.get("jitter") is not None:
        for mix in cfg.get("mixes", {}).values():
            mix["jitter_default"] = int(options["jitter"])
    return cfg


def first_jitter(config: dict) -> int:
    for mix in config.get("mixes", {}).values():
        return int(mix.get("jitter_default", 20))
    return 20
