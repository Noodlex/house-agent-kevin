# La régie (away mode)

When Kevin arms, the *régie* puts the house in away mode; when it disarms, it
restores everything. It is **off by default** (empty). Add a `regie` block to the
config to enable it.

```json
{
  "regie": {
    "suspend_automations": [
      "automation.volets_horaire_scolaire",
      "automation.deco_exterieure"
    ],
    "snapshot_entities": [
      "climate.vanne_salon",
      "climate.vanne_chambre"
    ],
    "away_actions": [
      {
        "service": "climate.set_temperature",
        "target": { "entity_id": ["climate.vanne_salon", "climate.vanne_chambre"] },
        "data": { "temperature": 12 }
      }
    ]
  }
}
```

## How it works

**On arm** (fresh arm only, not a reboot resume):
1. Each automation in `suspend_automations` has its on/off state recorded, then
   is turned off.
2. `snapshot_entities` are captured into a HA scene (`scene.kevin_regie_restore`).
3. `away_actions` run (e.g. drop the valves to 12°C).

**On disarm:**
1. Automations that were on are turned back on.
2. The snapshot scene is replayed, restoring the components to their prior state.

The snapshot is persisted, so an early return still restores what was suspended.

> Limitation: the snapshot **scene** is recreated at arm time and does not survive
> a Home Assistant restart mid-absence. Suspended **automations** are restored
> across restarts (their prior state is persisted); component restore relies on
> the scene. This is acceptable for the v2 régie and will be hardened later.
