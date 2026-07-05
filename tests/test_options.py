"""Options-flow value application (pure helpers in preset.py)."""

from kevin_pure import preset


def test_apply_options_patches_key_fields():
    cfg = preset.load_preset()
    out = preset.apply_options(
        cfg,
        {
            "start_date": "2026-08-01",
            "end_date": "2026-08-10",
            "mode": "rotation",
            "rotation_length": 2,
            "safety_off": "02:00:00",
            "jitter": 15,
        },
    )
    assert out["sejour"]["start_date"] == "2026-08-01"
    assert out["sejour"]["end_date"] == "2026-08-10"
    assert out["sejour"]["rule"]["mode"] == "rotation"
    assert out["sejour"]["rule"]["length"] == 2
    assert out["safety_off"] == "02:00"
    assert all(m["jitter_default"] == 15 for m in out["mixes"].values())
    # source config is not mutated
    assert cfg["safety_off"] == "01:00"


def test_switching_to_pool_fills_mix_list():
    cfg = preset.load_preset()
    cfg["sejour"]["rule"] = {"mode": "global", "mix": "soiree_a"}
    out = preset.apply_options(cfg, {"mode": "pool"})
    assert out["sejour"]["rule"]["mode"] == "pool"
    assert set(out["sejour"]["rule"]["mixes"]) == set(cfg["mixes"].keys())
