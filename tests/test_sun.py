"""Sun anchor resolution tests."""

from datetime import date

from kevin_pure import models
from kevin_pure.sun import Location, resolve_anchor, sun_times

# Roughly Paris.
PARIS = Location(latitude=48.8566, longitude=2.3522, time_zone="Europe/Paris", elevation=35.0)
DAY = date(2026, 7, 20)


def test_sunrise_before_sunset():
    times = sun_times(PARIS, DAY)
    assert times["sunrise"] < times["sunset"]


def test_fixed_anchor_uses_local_time():
    anchor = models.Anchor.from_dict({"type": "fixed", "time": "19:45"})
    dt = resolve_anchor(anchor, DAY, PARIS)
    assert (dt.hour, dt.minute) == (19, 45)
    assert dt.date() == DAY


def test_sun_anchor_applies_offset():
    base = sun_times(PARIS, DAY)["sunset"]
    anchor = models.Anchor.from_dict({"type": "sun", "event": "sunset", "offset": -30})
    dt = resolve_anchor(anchor, DAY, PARIS)
    assert (base - dt).total_seconds() == 30 * 60
