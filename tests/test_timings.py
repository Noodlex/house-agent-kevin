"""Ready-made clip timing patterns."""

from datetime import date

from kevin_pure import models, timings
from kevin_pure.sun import Location, resolve_anchor

PARIS = Location(latitude=48.8566, longitude=2.3522, time_zone="Europe/Paris", elevation=35.0)


def test_every_timing_is_a_valid_clip():
    for t in timings.TIMINGS:
        clip = models.Clip.from_dict(timings.as_clip(t["id"], "light.salon"))
        assert clip.entity_id == "light.salon"
        assert clip.start.type in ("fixed", "sun")
        assert clip.end.type in ("fixed", "sun")


def test_ids_are_unique_and_named():
    ids = [t["id"] for t in timings.TIMINGS]
    assert len(ids) == len(set(ids))
    assert all(t.get("name") for t in timings.TIMINGS)


def test_unknown_id_returns_none():
    assert timings.as_clip("nope", "light.salon") is None


def test_patterns_land_in_the_evening_across_seasons():
    """A pattern must produce a sane evening window in both July and December."""
    for day in (date(2026, 7, 20), date(2026, 12, 20)):
        for t in timings.TIMINGS:
            clip = models.Clip.from_dict(timings.as_clip(t["id"], "light.salon"))
            start = resolve_anchor(clip.start, day, PARIS)
            end = resolve_anchor(clip.end, day, PARIS)
            if end <= start:
                # Only a fixed end past midnight may resolve before the start;
                # the generator rolls it to the next day.
                assert clip.end.type == "fixed", t["id"]
            else:
                assert (end - start).total_seconds() <= 8 * 3600, t["id"]
            # No blanket check on the start hour: a "sunset +2h30" pattern legitimately
            # starts after midnight in midsummer, when the sun sets around 21:45.


def test_sun_anchored_patterns_shift_with_the_season():
    """The whole point: a sun-anchored edge lands at a different clock time."""
    clip = models.Clip.from_dict(timings.as_clip("evening", "light.salon"))
    july = resolve_anchor(clip.start, date(2026, 7, 20), PARIS)
    december = resolve_anchor(clip.start, date(2026, 12, 20), PARIS)
    assert july.hour != december.hour


def test_fixed_patterns_do_not_shift():
    clip = models.Clip.from_dict(timings.as_clip("fixed_1900_2300", "light.salon"))
    july = resolve_anchor(clip.start, date(2026, 7, 20), PARIS)
    december = resolve_anchor(clip.start, date(2026, 12, 20), PARIS)
    assert (july.hour, july.minute) == (december.hour, december.minute) == (19, 0)
