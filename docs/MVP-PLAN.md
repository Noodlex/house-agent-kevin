# House Agent Kevin — Plan technique du MVP

Ce document décrit l'architecture backend et le périmètre du **MVP**. Il découle
de [VISION.md](../VISION.md). Le frontend (carte) et la régie viennent après.

## 0. Périmètre MVP (ce qu'on code d'abord)

✅ Dans le MVP :
- `switch.kevin` (armer / désarmer).
- Un **coordinator** qui, à l'armement, **pré-génère** le plan et le **persiste**,
  puis **programme** les appels de service (on/off).
- **Mode « global »** uniquement (un seul mix rejoué chaque soir).
- Clips avec bords **fixes OU ancrés soleil**, **swing** (global + surcharge par clip).
- **Extinction de sécurité** en fin de nuit.
- Sensors `sensor.kevin_next_event` et `sensor.kevin_active_mix`.
- Services `start` / `stop` / `regenerate_schedule`.
- Config par **preset** (JSON livré, la maison de référence) + config_flow minimal.
- **Persistance** (survit au reboot HA).

🕓 Reporté (phases suivantes) :
- Modes pool / par-jour / roulement + **plan de séjour** (bandeau macro) et pinceau.
- **Carte** Lovelace (éditeur + couche soleil).
- **Régie** (suspendre/restaurer automatisations et composants, vannes).
- config_flow/options UI complet (édition des mix depuis l'UI).
- Pinceau au niveau du clip, verrouillage de jours.

> Le **modèle de données** ci-dessous est conçu complet dès le MVP (il porte déjà
> plan de séjour, modes, overrides), mais seul le chemin « global » est câblé en
> v1. Les autres champs sont lus/ignorés proprement.

## 1. Modèle de données

### 1.1 Ancre temporelle (un bord de clip)
```json
{ "type": "fixed", "time": "19:45" }
{ "type": "sun", "event": "sunset", "offset": -30 }   // minutes ; event: sunrise|sunset
```

### 1.2 Clip (plage ON d'une entité)
```json
{
  "entity_id": "light.salon",
  "start": { "type": "fixed", "time": "19:45" },
  "end":   { "type": "sun", "event": "sunset", "offset": 95 },
  "jitter": 20                     // optionnel — surcharge le défaut du mix
}
```

### 1.3 One-shot (événement ponctuel — losange)
```json
{
  "entity_id": "script.annonce_google_home",
  "at": { "type": "sun", "event": "sunset", "offset": 90 },
  "jitter": 30,
  "service": "script.turn_on",     // défaut déduit du domaine
  "data": {}                        // payload service optionnel
}
```

### 1.4 Mix (= un schéma = une soirée)
```json
{
  "id": "soiree_a",
  "name": "Soirée A",
  "jitter_default": 20,
  "clips": [ /* … */ ],
  "oneshots": [ /* … */ ]
}
```

### 1.5 Configuration (config entry / options)
```json
{
  "mixes": { "soiree_a": { /* mix */ }, "roulement_b": { /* … */ } },
  "sejour": {
    "start_date": "2026-07-20",
    "end_date":   "2026-07-29",
    "rule": { "mode": "global", "mix": "soiree_a" },
    "overrides": {}                 // { "2026-07-25": "week_end_c" }  (pinceau, v2)
  },
  "safety_off": "01:00"             // extinction de sécurité (heure locale)
}
```
`rule` possibles (seul `global` câblé en MVP) :
```
{ "mode": "global",   "mix": "id" }
{ "mode": "pool",     "mixes": ["id", …] }
{ "mode": "weekday",  "map": { "mon": "id", … } }
{ "mode": "rotation", "mixes": ["id", …], "length": 3 }
```

### 1.6 Plan généré (persisté via Store) — la « vérité »
```json
{
  "version": 1,
  "generated_at": "2026-07-19T23:10:00+02:00",
  "seed": 480213,
  "sejour": { "start_date": "2026-07-20", "end_date": "2026-07-29" },
  "days": {
    "2026-07-20": {
      "mix": "soiree_a",
      "events": [
        { "t": "2026-07-20T19:47:00+02:00", "entity_id": "light.salon", "action": "on" },
        { "t": "2026-07-20T23:12:00+02:00", "entity_id": "light.salon", "action": "off" },
        { "t": "2026-07-21T01:00:00+02:00", "entity_id": "__all__",     "action": "safety_off" }
      ]
    }
  }
}
```
La carte lira ce fichier → **ce que tu vois = ce qui arrivera**.

## 2. Génération (déterministe)

À l'armement (`switch.kevin` → on) **ou** sur `regenerate_schedule` :
1. Pour chaque jour du séjour : résoudre le **mix** (règle + overrides).
2. Résoudre les **ancres soleil** du jour (astral, localisation `hass.config`).
3. Appliquer le **swing** : `Random(seed_du_jour)` → offset dans `[-jitter, +jitter]`
   par bord de clip (déterministe, donc reproductible et « honnête » sur la carte).
   `seed_du_jour = hash(seed_global, date, entity, bord)`.
4. Émettre la liste d'**events** on/off triés + l'**extinction de sécurité**.
5. **Persister** le plan (Store). Réarmer ne re-tire pas (sauf `regenerate`).

## 3. Programmation (scheduling)

- Au démarrage/armement : charger le plan persisté, repérer les events **futurs**
  du jour courant, programmer le **prochain** via `async_track_point_in_time`.
- À chaque déclenchement : appeler le service (`light.turn_on/off`, `switch.*`,
  `media_player.*`, `script.turn_on`), puis programmer le suivant.
- Passage minuit : enchaîner sur les events du jour suivant du plan.
- **Reboot HA** : on relit le plan persisté et on reprend au prochain event futur
  (les events passés pendant l'arrêt sont ignorés, sauf un « rattrapage » de
  l'extinction de sécurité si on redémarre après elle → tout OFF).
- Désarmement (off) : annuler le timer courant. (En v2, la régie restaure l'état.)

## 4. Entités & services

| Fichier | Rôle |
|---|---|
| `__init__.py` | setup/unload du config entry, instancie le coordinator, enregistre les services |
| `coordinator.py` | génération (§2) + scheduling (§3) + persistance |
| `switch.py` | `switch.kevin` (armer/désarmer) |
| `sensor.py` | `sensor.kevin_next_event` (datetime + entité), `sensor.kevin_active_mix` (mix du jour) |
| `config_flow.py` | création du config entry (form minimal en MVP) ; options plus tard |
| `services.yaml` | `start`, `stop`, `regenerate_schedule` |
| `const.py` | domaine, clés, modes (déjà en place) |
| `sun.py` (helper) | résolution des ancres soleil pour une date arbitraire |
| `models.py` | dataclasses Clip / OneShot / Mix / Sejour / Plan + (de)sérialisation |

## 5. Dépendances & contraintes HA

- `dependencies: ["sun"]` (déjà dans le manifest) ; astral est fourni par HA.
- Store : `homeassistant.helpers.storage.Store` (clé `kevin.plan`).
- Timers : `homeassistant.helpers.event.async_track_point_in_time`.
- Tout en heure **locale** (`hass.config.time_zone`).

## 6. Découpage d'implémentation (ordre)

1. `models.py` + preset JSON (maison de référence) + tests de (dé)sérialisation.
2. `sun.py` (résolution ancre → datetime pour une date) + tests.
3. `coordinator.py` : génération d'un jour (mode global) → liste d'events + tests.
4. Persistance (Store) + rechargement.
5. Scheduling (timers) + extinction de sécurité + reprise post-reboot.
6. `switch.py`, `sensor.py`, services, `config_flow.py` minimal, wiring `__init__`.
7. Essai en HA réel avec le preset.
