"""Sun anchor resolution — pure, no Home Assistant imports.

Uses the `astral` library (bundled with Home Assistant) so a clip edge like
``sunset -30`` can be resolved to a concrete datetime for **any** date — which is
what the séjour pre-generation and the card date navigator both need.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from astral import Observer
from astral.sun import sun as astral_sun

from .const import ANCHOR_SUN, SUN_SUNSET
from .models import Anchor


@dataclass
class Location:
    """Everything needed to compute sun times for a date."""

    latitude: float
    longitude: float
    time_zone: str
    elevation: float = 0.0

    @property
    def tzinfo(self) -> ZoneInfo:
        return ZoneInfo(self.time_zone)


def sun_times(location: Location, day: date) -> dict[str, datetime]:
    """Return tz-aware sunrise/sunset datetimes for the given day."""
    observer = Observer(latitude=location.latitude, longitude=location.longitude, elevation=location.elevation)
    events = astral_sun(observer, date=day, tzinfo=location.tzinfo)
    return {"sunrise": events["sunrise"], "sunset": events["sunset"]}


def resolve_anchor(anchor: Anchor, day: date, location: Location) -> datetime:
    """Resolve an anchor to an absolute tz-aware datetime on `day`.

    Fixed anchors combine the day with the local time. Sun anchors take the sun
    event of that day and apply the offset in minutes.
    """
    if anchor.type == ANCHOR_SUN:
        base = sun_times(location, day)[anchor.event or SUN_SUNSET]
        return base + timedelta(minutes=anchor.offset)
    return datetime.combine(day, anchor.time, tzinfo=location.tzinfo)
