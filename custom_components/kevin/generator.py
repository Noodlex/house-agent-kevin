"""Deterministic plan generation — pure, no Home Assistant imports.

Given a config, a location and a global seed, produce the full séjour Plan:
which mix plays each day, and the concrete on/off/oneshot/safety_off events with
the swing (jitter) applied. Deterministic: same (config, location, seed) always
yields the same plan — that is what makes the card honest and survives reboots.
"""

from __future__ import annotations

import hashlib
import random
from datetime import date, datetime, timedelta

from .const import (
    ACTION_OFF,
    ACTION_ON,
    ACTION_ONESHOT,
    ACTION_SAFETY_OFF,
    ENTITY_ALL,
    MODE_GLOBAL,
    MODE_POOL,
    MODE_ROTATION,
    MODE_WEEKDAY,
)
from .models import (
    DayPlan,
    KevinConfig,
    Mix,
    Plan,
    ReferenceTrack,
    ScheduledEvent,
    Sejour,
)
from .sun import Location, resolve_anchor

_WEEKDAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]


def _seed_for(global_seed: int, day: date, key: str) -> int:
    """Stable per-(day, key) seed. Uses sha256, NOT the salted built-in hash()."""
    raw = f"{global_seed}|{day.isoformat()}|{key}".encode()
    return int(hashlib.sha256(raw).hexdigest()[:8], 16)


def _jitter(dt: datetime, minutes: int, seed: int) -> datetime:
    """Apply a deterministic ± swing (in minutes, rounded) to a datetime."""
    if minutes <= 0:
        return dt
    rng = random.Random(seed)
    return dt + timedelta(minutes=round(rng.uniform(-minutes, minutes)))


def mix_for_day(sejour: Sejour, day: date, index: int, global_seed: int = 0) -> str:
    """Resolve which mix plays on `day` (overrides win over the base rule)."""
    override = sejour.overrides.get(day.isoformat())
    if override:
        return override

    rule = sejour.rule
    if rule.mode == MODE_GLOBAL:
        return rule.mix
    if rule.mode == MODE_WEEKDAY:
        return rule.map.get(_WEEKDAY_KEYS[day.weekday()], rule.mix or next(iter(rule.map.values())))
    if rule.mode == MODE_ROTATION:
        if not rule.mixes:
            return rule.mix
        # Blocks of `length` days per mix, then cycle: A A A B B B C C C ...
        block = max(1, rule.length)
        return rule.mixes[(index // block) % len(rule.mixes)]
    if rule.mode == MODE_POOL:
        if not rule.mixes:
            return rule.mix
        # Tied to the plan seed so "re-roll the whole séjour" changes the draw.
        rng = random.Random(_seed_for(global_seed, day, "pool"))
        return rng.choice(rule.mixes)
    return rule.mix


def generate_day(
    mix: Mix,
    day: date,
    location: Location,
    global_seed: int,
    safety_off_time,
) -> list[ScheduledEvent]:
    """Concrete events for one evening: on/off per clip, one-shots, safety off."""
    events: list[ScheduledEvent] = []

    for clip in mix.clips:
        jitter = clip.jitter if clip.jitter is not None else mix.jitter_default
        start = _jitter(
            resolve_anchor(clip.start, day, location),
            jitter,
            _seed_for(global_seed, day, f"{clip.entity_id}|start"),
        )
        end = _jitter(
            resolve_anchor(clip.end, day, location),
            jitter,
            _seed_for(global_seed, day, f"{clip.entity_id}|end"),
        )
        if end <= start:
            # A fixed end past midnight (e.g. "00:30") resolves to the same day,
            # landing before the evening start — roll it to the next day.
            end += timedelta(days=1)
        events.append(ScheduledEvent(t=start, entity_id=clip.entity_id, action=ACTION_ON))
        events.append(ScheduledEvent(t=end, entity_id=clip.entity_id, action=ACTION_OFF))

    for shot in mix.oneshots:
        jitter = shot.jitter if shot.jitter is not None else mix.jitter_default
        at = _jitter(
            resolve_anchor(shot.at, day, location),
            jitter,
            _seed_for(global_seed, day, f"{shot.entity_id}|at"),
        )
        events.append(
            ScheduledEvent(
                t=at,
                entity_id=shot.entity_id,
                action=ACTION_ONESHOT,
                service=shot.service,
                data=shot.data or None,
            )
        )

    # Safety off belongs to the following calendar morning (e.g. 01:00).
    safety_dt = datetime.combine(day + timedelta(days=1), safety_off_time, tzinfo=location.tzinfo)
    events.append(ScheduledEvent(t=safety_dt, entity_id=ENTITY_ALL, action=ACTION_SAFETY_OFF))

    events.sort(key=lambda e: e.t)
    return events


def resolve_reference(tracks: list[ReferenceTrack], day: date, location: Location) -> list[dict]:
    """Resolve reference (grey) tracks to concrete times for a day — no jitter."""
    out: list[dict] = []
    for track in tracks:
        clips = []
        for clip in track.clips:
            start = resolve_anchor(clip.start, day, location)
            end = resolve_anchor(clip.end, day, location)
            if end <= start:
                end += timedelta(days=1)
            clips.append({"start": start.isoformat(), "end": end.isoformat(), "label": clip.label})
        points = [
            {"at": resolve_anchor(point.at, day, location).isoformat(), "label": point.label}
            for point in track.points
        ]
        out.append({"name": track.name, "clips": clips, "points": points})
    return out


def generate_plan(config: KevinConfig, location: Location, global_seed: int, now: datetime) -> Plan:
    """Pre-generate the whole séjour into a persisted Plan."""
    days: dict[str, DayPlan] = {}
    for index, day in enumerate(config.sejour.dates()):
        mix_id = mix_for_day(config.sejour, day, index, global_seed)
        mix = config.mixes.get(mix_id)
        if mix is None:
            continue
        events = generate_day(mix, day, location, global_seed, config.safety_off)
        days[day.isoformat()] = DayPlan(mix=mix_id, events=events)

    return Plan(
        generated_at=now,
        seed=global_seed,
        start_date=config.sejour.start_date,
        end_date=config.sejour.end_date,
        days=days,
    )
