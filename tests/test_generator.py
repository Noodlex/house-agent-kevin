"""Plan generation tests."""

from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from conftest import preset_dict
from kevin_pure import models
from kevin_pure.generator import generate_day, generate_plan, mix_for_day
from kevin_pure.sun import Location

PARIS = Location(latitude=48.8566, longitude=2.3522, time_zone="Europe/Paris", elevation=35.0)
NOW = datetime(2026, 7, 19, 23, 0, tzinfo=ZoneInfo("Europe/Paris"))


def _config():
    return models.KevinConfig.from_dict(preset_dict())


def test_plan_covers_every_day():
    config = _config()
    plan = generate_plan(config, PARIS, seed := 12345, NOW)
    assert plan.seed == seed
    assert len(plan.days) == len(config.sejour.dates())
    assert "2026-07-20" in plan.days


def test_generation_is_deterministic():
    config = _config()
    a = generate_plan(config, PARIS, 999, NOW).to_dict()
    b = generate_plan(config, PARIS, 999, NOW).to_dict()
    assert a["days"] == b["days"]


def test_different_seed_changes_times():
    config = _config()
    a = generate_plan(config, PARIS, 1, NOW).to_dict()["days"]
    b = generate_plan(config, PARIS, 2, NOW).to_dict()["days"]
    assert a != b


def test_each_day_has_a_safety_off_and_is_sorted():
    config = _config()
    plan = generate_plan(config, PARIS, 7, NOW)
    for day_iso, day_plan in plan.days.items():
        times = [e.t for e in day_plan.events]
        assert times == sorted(times)
        assert any(e.action == "safety_off" for e in day_plan.events)


def test_jitter_within_bounds():
    config = _config()
    mix = config.mixes["soiree_a"]
    day = date(2026, 7, 20)
    events = generate_day(mix, day, PARIS, 42, config.safety_off)
    # The salon clip start is fixed 19:45 with the mix default jitter of 20 min.
    ons = [e for e in events if e.entity_id == "light.salon" and e.action == "on"]
    assert ons
    start = ons[0].t
    nominal = datetime.combine(day, __import__("datetime").time(19, 45), tzinfo=ZoneInfo("Europe/Paris"))
    assert abs((start - nominal).total_seconds()) <= 20 * 60


def test_mix_for_day_respects_override():
    config = _config()
    config.sejour.overrides = {"2026-07-22": "soiree_a"}
    assert mix_for_day(config.sejour, date(2026, 7, 22), 2) == "soiree_a"
    assert mix_for_day(config.sejour, date(2026, 7, 20), 0) == "soiree_a"
