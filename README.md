# House Agent Kevin 🏠🕵️

**English** · [Français](README.fr.md)

> *"Kevin! You leave, and the house takes care of itself."*

A [Home Assistant](https://www.home-assistant.io/) custom integration that
**simulates presence while you're away** — inspired by *Home Alone*, where Kevin
rigs the house with timed lights and moving silhouettes to fool the burglars.

Point Kevin at your lights (and a few decoy plugs), flip one master switch before
you leave for holiday, and the house *lives*: interior lights turn on and off in a
plausible order every evening, never the same twice, anchored to the real sunset.
A Lovelace card shows exactly what will happen, day by day, over your holiday.

## Status

Backend + card are functional (not yet tested inside a live HA — that's next).
Implemented:

- **Master switch** `switch.kevin` — arm/disarm the whole thing.
- **Deterministic engine** — the whole séjour is pre-generated and persisted on
  arm, so *what you see on the card is what will happen*, and it survives a
  restart. A per-day **swing** (±20 min, overridable per clip) keeps no two
  evenings alike.
- **Sun anchoring** — each clip edge is a fixed time *or* relative to the sun
  (`sunset -30`, `sunrise +15`…), so the plan follows the season.
- **Four planning modes** — global, random pool, per-weekday, N-day rotation —
  as a **séjour plan** with per-day overrides (the *pinceau*).
- **Régie (away mode)** — optionally suspend automations and switch components
  (thermostatic valves…) to an away state on arm, and restore everything on
  disarm. Off by default. See [docs/REGIE.md](docs/REGIE.md).
- **Sensors** — `sensor.kevin_next_event`, `sensor.kevin_active_mix`.
- **Services** — `kevin.start`, `kevin.stop`, `kevin.regenerate_schedule`.
- **Lovelace card** (auto-loaded) — séjour timeline (colored by mix) + evening
  mix (dashed = swing window) over a **sun transition layer**, day navigation,
  and a day-level mix picker.
- **Options UI** — holiday dates, mode, rotation length, jitter, safety-off.

Still to do: drag-to-edit clips on the card, editing mixes from the UI, and HACS
packaging. See [VISION.md](VISION.md) and [docs/MVP-PLAN.md](docs/MVP-PLAN.md).

## Installation

_HACS instructions will come once packaged. For now: copy
`custom_components/kevin/` into your HA `config/custom_components/`, restart, add
the **House Agent Kevin** integration, then drop a `custom:house-agent-kevin-card`
on a dashboard (the card auto-loads — no manual resource needed)._

The bundled preset targets a reference house; tune the entities, mixes and
holiday dates to your own home.

## Why not just "Presence Simulation"?

The domain `presence_simulation` is already taken by an
[existing HACS integration](https://github.com/slashback100/presence_simulation).
House Agent Kevin uses the domain `kevin` and takes a card-first,
holiday-oriented approach.

## License

MIT
