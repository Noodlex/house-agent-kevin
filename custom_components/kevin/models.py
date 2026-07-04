"""Data model for House Agent Kevin.

Pure dataclasses + (de)serialization. **No Home Assistant imports** — this module
is deliberately standalone so the model and the generator can be unit-tested
without a running HA instance.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, time

from .const import (
    ACTION_SAFETY_OFF,
    ANCHOR_FIXED,
    ANCHOR_SUN,
    DEFAULT_JITTER_MINUTES,
    DEFAULT_SAFETY_OFF,
    ENTITY_ALL,
    MODE_GLOBAL,
    SUN_SUNSET,
)


def _parse_time(value: str) -> time:
    """Parse "HH:MM" (or "HH:MM:SS") into a time."""
    parts = [int(p) for p in value.split(":")]
    while len(parts) < 3:
        parts.append(0)
    return time(parts[0], parts[1], parts[2])


def _fmt_time(value: time) -> str:
    return value.strftime("%H:%M")


# --------------------------------------------------------------------------- #
# Time anchors                                                                 #
# --------------------------------------------------------------------------- #
@dataclass
class Anchor:
    """One edge of a clip: a fixed local time, or an offset from a sun event."""

    type: str = ANCHOR_FIXED
    time: time | None = None          # for fixed
    event: str | None = None          # sunrise | sunset (for sun)
    offset: int = 0                   # minutes (for sun)

    @classmethod
    def from_dict(cls, d: dict) -> "Anchor":
        t = d.get("type", ANCHOR_FIXED)
        if t == ANCHOR_SUN:
            return cls(type=ANCHOR_SUN, event=d.get("event", SUN_SUNSET), offset=int(d.get("offset", 0)))
        return cls(type=ANCHOR_FIXED, time=_parse_time(d["time"]))

    def to_dict(self) -> dict:
        if self.type == ANCHOR_SUN:
            return {"type": ANCHOR_SUN, "event": self.event, "offset": self.offset}
        return {"type": ANCHOR_FIXED, "time": _fmt_time(self.time)}


# --------------------------------------------------------------------------- #
# Clips / one-shots / mix                                                      #
# --------------------------------------------------------------------------- #
@dataclass
class Clip:
    """A window where an entity is ON (start -> end)."""

    entity_id: str
    start: Anchor
    end: Anchor
    jitter: int | None = None         # overrides the mix default when set

    @classmethod
    def from_dict(cls, d: dict) -> "Clip":
        return cls(
            entity_id=d["entity_id"],
            start=Anchor.from_dict(d["start"]),
            end=Anchor.from_dict(d["end"]),
            jitter=d.get("jitter"),
        )

    def to_dict(self) -> dict:
        out = {"entity_id": self.entity_id, "start": self.start.to_dict(), "end": self.end.to_dict()}
        if self.jitter is not None:
            out["jitter"] = self.jitter
        return out


@dataclass
class OneShot:
    """A point event (diamond): fire a service once at a moment."""

    entity_id: str
    at: Anchor
    jitter: int | None = None
    service: str | None = None        # e.g. "script.turn_on"; inferred from domain otherwise
    data: dict = field(default_factory=dict)

    @classmethod
    def from_dict(cls, d: dict) -> "OneShot":
        return cls(
            entity_id=d["entity_id"],
            at=Anchor.from_dict(d["at"]),
            jitter=d.get("jitter"),
            service=d.get("service"),
            data=d.get("data", {}) or {},
        )

    def to_dict(self) -> dict:
        out = {"entity_id": self.entity_id, "at": self.at.to_dict()}
        if self.jitter is not None:
            out["jitter"] = self.jitter
        if self.service:
            out["service"] = self.service
        if self.data:
            out["data"] = self.data
        return out


@dataclass
class Mix:
    """A schema = one arranged evening (the "mix")."""

    id: str
    name: str
    jitter_default: int = DEFAULT_JITTER_MINUTES
    clips: list[Clip] = field(default_factory=list)
    oneshots: list[OneShot] = field(default_factory=list)

    @classmethod
    def from_dict(cls, d: dict) -> "Mix":
        return cls(
            id=d["id"],
            name=d.get("name", d["id"]),
            jitter_default=int(d.get("jitter_default", DEFAULT_JITTER_MINUTES)),
            clips=[Clip.from_dict(c) for c in d.get("clips", [])],
            oneshots=[OneShot.from_dict(o) for o in d.get("oneshots", [])],
        )

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "jitter_default": self.jitter_default,
            "clips": [c.to_dict() for c in self.clips],
            "oneshots": [o.to_dict() for o in self.oneshots],
        }

    def entity_ids(self) -> set[str]:
        ids = {c.entity_id for c in self.clips}
        ids |= {o.entity_id for o in self.oneshots}
        return ids


# --------------------------------------------------------------------------- #
# Séjour plan (macro)                                                          #
# --------------------------------------------------------------------------- #
@dataclass
class Rule:
    """How mixes are assigned across days (only `global` is wired in the MVP)."""

    mode: str = MODE_GLOBAL
    mix: str | None = None            # global
    mixes: list[str] = field(default_factory=list)  # pool / rotation
    map: dict[str, str] = field(default_factory=dict)  # weekday
    length: int = 3                   # rotation

    @classmethod
    def from_dict(cls, d: dict) -> "Rule":
        return cls(
            mode=d.get("mode", MODE_GLOBAL),
            mix=d.get("mix"),
            mixes=list(d.get("mixes", [])),
            map=dict(d.get("map", {})),
            length=int(d.get("length", 3)),
        )

    def to_dict(self) -> dict:
        return {
            "mode": self.mode,
            "mix": self.mix,
            "mixes": self.mixes,
            "map": self.map,
            "length": self.length,
        }


@dataclass
class Sejour:
    """The holiday span + the rule + manual per-day overrides (pinceau)."""

    start_date: date
    end_date: date
    rule: Rule
    overrides: dict[str, str] = field(default_factory=dict)  # "YYYY-MM-DD" -> mix id

    @classmethod
    def from_dict(cls, d: dict) -> "Sejour":
        return cls(
            start_date=date.fromisoformat(d["start_date"]),
            end_date=date.fromisoformat(d["end_date"]),
            rule=Rule.from_dict(d.get("rule", {})),
            overrides=dict(d.get("overrides", {})),
        )

    def to_dict(self) -> dict:
        return {
            "start_date": self.start_date.isoformat(),
            "end_date": self.end_date.isoformat(),
            "rule": self.rule.to_dict(),
            "overrides": self.overrides,
        }

    def dates(self) -> list[date]:
        from datetime import timedelta

        out: list[date] = []
        d = self.start_date
        while d <= self.end_date:
            out.append(d)
            d += timedelta(days=1)
        return out


@dataclass
class KevinConfig:
    """The whole configuration: the mix library + the séjour plan + safety."""

    mixes: dict[str, Mix]
    sejour: Sejour
    safety_off: time = field(default_factory=lambda: _parse_time(DEFAULT_SAFETY_OFF))

    @classmethod
    def from_dict(cls, d: dict) -> "KevinConfig":
        return cls(
            mixes={k: Mix.from_dict(v) for k, v in d.get("mixes", {}).items()},
            sejour=Sejour.from_dict(d["sejour"]),
            safety_off=_parse_time(d.get("safety_off", DEFAULT_SAFETY_OFF)),
        )

    def to_dict(self) -> dict:
        return {
            "mixes": {k: v.to_dict() for k, v in self.mixes.items()},
            "sejour": self.sejour.to_dict(),
            "safety_off": _fmt_time(self.safety_off),
        }

    def controlled_entities(self) -> set[str]:
        ids: set[str] = set()
        for mix in self.mixes.values():
            ids |= mix.entity_ids()
        return ids


# --------------------------------------------------------------------------- #
# Generated plan (the persisted "truth" the card reads)                        #
# --------------------------------------------------------------------------- #
@dataclass
class ScheduledEvent:
    """A concrete on/off/oneshot/safety_off at an absolute datetime."""

    t: datetime
    entity_id: str
    action: str
    service: str | None = None
    data: dict | None = None

    @classmethod
    def from_dict(cls, d: dict) -> "ScheduledEvent":
        return cls(
            t=datetime.fromisoformat(d["t"]),
            entity_id=d["entity_id"],
            action=d["action"],
            service=d.get("service"),
            data=d.get("data"),
        )

    def to_dict(self) -> dict:
        out = {"t": self.t.isoformat(), "entity_id": self.entity_id, "action": self.action}
        if self.service:
            out["service"] = self.service
        if self.data:
            out["data"] = self.data
        return out


@dataclass
class DayPlan:
    """The mix chosen for a day + its concrete events."""

    mix: str
    events: list[ScheduledEvent] = field(default_factory=list)

    @classmethod
    def from_dict(cls, d: dict) -> "DayPlan":
        return cls(mix=d["mix"], events=[ScheduledEvent.from_dict(e) for e in d.get("events", [])])

    def to_dict(self) -> dict:
        return {"mix": self.mix, "events": [e.to_dict() for e in self.events]}


@dataclass
class Plan:
    """The full pre-generated, persisted séjour plan."""

    generated_at: datetime
    seed: int
    start_date: date
    end_date: date
    days: dict[str, DayPlan] = field(default_factory=dict)  # "YYYY-MM-DD" -> DayPlan
    version: int = 1

    @classmethod
    def from_dict(cls, d: dict) -> "Plan":
        return cls(
            generated_at=datetime.fromisoformat(d["generated_at"]),
            seed=int(d["seed"]),
            start_date=date.fromisoformat(d["start_date"]),
            end_date=date.fromisoformat(d["end_date"]),
            days={k: DayPlan.from_dict(v) for k, v in d.get("days", {}).items()},
            version=int(d.get("version", 1)),
        )

    def to_dict(self) -> dict:
        return {
            "version": self.version,
            "generated_at": self.generated_at.isoformat(),
            "seed": self.seed,
            "start_date": self.start_date.isoformat(),
            "end_date": self.end_date.isoformat(),
            "days": {k: v.to_dict() for k, v in self.days.items()},
        }

    def all_events(self) -> list[ScheduledEvent]:
        events: list[ScheduledEvent] = []
        for day in self.days.values():
            events.extend(day.events)
        events.sort(key=lambda e: e.t)
        return events

    def mix_for(self, day_iso: str) -> str | None:
        dp = self.days.get(day_iso)
        return dp.mix if dp else None
