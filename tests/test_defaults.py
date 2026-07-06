"""Config-flow default builders (pure)."""

from kevin_pure import defaults, models


ENTITIES = [
    "light.salon",
    "light.cuisine",
    "switch.prise_deco",
    "media_player.tv",
    "script.annonce",
]


def test_build_default_mix_categorizes_by_domain():
    mix = defaults.build_default_mix(ENTITIES, jitter_default=25)
    clip_entities = {c["entity_id"] for c in mix["clips"]}
    assert "light.salon" in clip_entities
    assert "switch.prise_deco" in clip_entities
    assert "media_player.tv" in clip_entities
    # the script becomes a one-shot, not a clip
    assert clip_entities.isdisjoint({"script.annonce"})
    assert mix["oneshots"][0]["entity_id"] == "script.annonce"
    assert mix["jitter_default"] == 25


def test_build_config_is_loadable_and_uses_entities():
    raw = defaults.build_config(
        entities=ENTITIES,
        start_date="2026-08-01",
        end_date="2026-08-10",
        mode="global",
        jitter=20,
        safety_off="01:00:00",
    )
    # It must be a valid KevinConfig with no manual editing.
    config = models.KevinConfig.from_dict(raw)
    assert config.sejour.start_date.isoformat() == "2026-08-01"
    assert config.safety_off.hour == 1
    assert "light.salon" in config.controlled_entities()


def test_rotation_mode_fills_mix_list():
    raw = defaults.build_config(ENTITIES, "2026-08-01", "2026-08-10", mode="rotation", rotation_length=2)
    assert raw["sejour"]["rule"]["mode"] == "rotation"
    assert raw["sejour"]["rule"]["mixes"] == ["soiree"]
    assert raw["sejour"]["rule"]["length"] == 2
