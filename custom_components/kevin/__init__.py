"""House Agent Kevin — presence simulation for Home Assistant.

Simulates presence while you're away (Home Alone style): a master switch arms a
daily schedule engine that turns lights on/off in a plausible, never-repeating
order, anchored to the real sunset.

This is the integration entry point. The scheduling engine (coordinator),
master switch, sensors and config flow are added incrementally — see the repo
roadmap.
"""

from __future__ import annotations

# NOTE: MVP backend not implemented yet. Next steps:
#   - coordinator.py : daily schedule generation + jitter + sun anchoring + modes
#   - switch.py      : switch.kevin master toggle
#   - sensor.py      : sensor.kevin_next_event / sensor.kevin_active_schema
#   - config_flow.py : UI setup (entities, holiday dates, jitter, schemas)
