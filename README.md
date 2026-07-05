# House Agent Kevin 🏠🕵️

> *"Kevin! You leave, and the house takes care of itself."*

A [Home Assistant](https://www.home-assistant.io/) custom integration that **simulates presence while you're away** — inspired by *Home Alone*, where Kevin rigs the house with timed lights and moving silhouettes to fool the burglars.

Point Kevin at your lights (and a few decoy plugs), flip one master switch before you leave for holiday, and the house *lives*: interior lights turn on and off in a plausible order every evening, never the same twice, anchored to the real sunset.

## Status

🚧 **Early development.** Building the MVP backend first (master switch + daily schedule engine + jitter + sun anchoring), then the Lovelace timeline card.

## Features (planned)

- **Master switch** `switch.kevin` — one toggle to arm/disarm the simulation.
- **Daily schedule engine** — generates on/off events each day with configurable random jitter (±20 min default) so no two evenings look alike.
- **Sun anchoring** — events can be fixed-time or relative to the sun (`sunset -30min`, `sunrise +15min`…) via `sun.sun`.
- **Four planning modes** — global daily schema, random pool, per-weekday, or N-day rotation.
- **Sensors** — `sensor.kevin_next_event`, `sensor.kevin_active_schema`.
- **Services** — `kevin.start`, `kevin.stop`, `kevin.regenerate_schedule`.
- **Lovelace card** (Lit + SVG) — Gantt-style timeline of simulated light windows (dashed = random window) over a day/night sun layer, with a date navigator across your holiday range.

## Status update

Backend + card are functional. Implemented: master switch; deterministic
pre-generated + persisted plan; sun anchoring; swing; safety-off; sensors;
services; the four planning modes (global / pool / weekday / N-day rotation) with
a **séjour plan**; grey **reference tracks**; the **régie** (away mode:
suspend/restore automations & components, off by default); an **options UI**; and
the **Lovelace card** (auto-loaded) with day-by-day preview, the sun transition
layer, and a **day-level pinceau** to paint a mix onto a day.

Still to do: drag-to-edit clips on the card, editing mixes from the UI, and HACS
packaging. See [VISION.md](VISION.md) and [docs/MVP-PLAN.md](docs/MVP-PLAN.md).

## Installation

_HACS installation instructions will be added once the MVP is ready. For now,
copy `custom_components/kevin/` into your HA `config/custom_components/`, restart,
then add the **House Agent Kevin** integration and drop a
`custom:house-agent-kevin-card` on a dashboard._

## Why not just "Presence Simulation"?

The domain `presence_simulation` is already taken by an [existing HACS integration](https://github.com/slashback100/presence_simulation). House Agent Kevin uses the domain `kevin` and takes a card-first, holiday-oriented approach.

## License

MIT
