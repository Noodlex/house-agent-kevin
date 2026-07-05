"""Model (de)serialization tests."""

from datetime import time

from conftest import preset_dict
from kevin_pure import models


def test_preset_roundtrips():
    config = models.KevinConfig.from_dict(preset_dict())
    again = models.KevinConfig.from_dict(config.to_dict())
    assert again.to_dict() == config.to_dict()


def test_preset_shape():
    config = models.KevinConfig.from_dict(preset_dict())
    assert {"soiree_a", "soiree_b", "week_end_c"} <= set(config.mixes)
    assert config.safety_off == time(1, 0)
    assert config.sejour.rule.mode == "rotation"
    assert config.sejour.rule.mixes == ["soiree_a", "soiree_b"]
    assert config.sejour.overrides.get("2026-07-25") == "week_end_c"


def test_controlled_entities_collects_all():
    config = models.KevinConfig.from_dict(preset_dict())
    entities = config.controlled_entities()
    assert "light.salon" in entities
    assert "switch.nous_7" in entities
    assert "script.annonce_google_home" in entities  # one-shot entity counted too


def test_regie_defaults_empty_and_roundtrips():
    config = models.KevinConfig.from_dict(preset_dict())
    assert config.regie.is_empty()

    regie = models.Regie.from_dict(
        {
            "suspend_automations": ["automation.volets_scolaire"],
            "snapshot_entities": ["climate.vanne_salon"],
            "away_actions": [
                {"service": "climate.set_temperature", "data": {"temperature": 12}, "target": {"entity_id": "climate.vanne_salon"}}
            ],
        }
    )
    assert not regie.is_empty()
    assert models.Regie.from_dict(regie.to_dict()).to_dict() == regie.to_dict()


def test_anchor_parsing():
    fixed = models.Anchor.from_dict({"type": "fixed", "time": "19:45"})
    assert fixed.type == "fixed" and fixed.time == time(19, 45)

    sun = models.Anchor.from_dict({"type": "sun", "event": "sunset", "offset": -30})
    assert sun.type == "sun" and sun.event == "sunset" and sun.offset == -30
    assert sun.to_dict() == {"type": "sun", "event": "sunset", "offset": -30}
