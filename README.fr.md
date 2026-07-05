# House Agent Kevin 🏠🕵️

[English](README.md) · **Français**

> *« Kevin ! Tu pars, et la maison se débrouille toute seule. »*

Une intégration personnalisée pour [Home Assistant](https://www.home-assistant.io/)
qui **simule une présence pendant vos absences** — clin d'œil à *Maman j'ai raté
l'avion*, où Kevin truque la maison avec des lumières minutées et des silhouettes
pour faire fuir les cambrioleurs.

Confiez à Kevin vos lumières (et quelques prises déco), armez un seul interrupteur
avant de partir en vacances, et la maison *vit* : les lumières intérieures
s'allument et s'éteignent dans un ordre plausible chaque soir, jamais deux fois
pareil, calées sur le vrai coucher du soleil. Une carte Lovelace montre exactement
ce qui va se passer, jour par jour, sur toute la durée du séjour.

## État

Le backend et la carte sont fonctionnels (pas encore testés dans un vrai HA —
c'est la prochaine étape). Déjà en place :

- **Interrupteur maître** `switch.kevin` — arme/désarme l'ensemble.
- **Moteur déterministe** — tout le séjour est pré-généré et persisté à
  l'armement : *ce que vous voyez sur la carte est ce qui arrivera*, et ça survit
  à un redémarrage. Un **swing** par jour (±20 min, surchargeable par clip) fait
  que deux soirs ne se ressemblent jamais.
- **Ancrage soleil** — chaque bord de clip est une heure fixe *ou* relatif au
  soleil (`coucher -30`, `lever +15`…), donc le plan suit la saison.
- **Quatre modes de planification** — global, pool aléatoire, par jour de la
  semaine, roulement de N jours — sous forme de **plan de séjour** avec des
  exceptions par jour (le *pinceau*).
- **Régie (mode absence)** — au choix, suspend les automatisations et bascule des
  composants (vannes thermostatiques…) en mode absence à l'armement, puis
  restaure tout au désarmement. Désactivée par défaut. Voir [docs/REGIE.md](docs/REGIE.md).
- **Capteurs** — `sensor.kevin_next_event`, `sensor.kevin_active_mix`.
- **Services** — `kevin.start`, `kevin.stop`, `kevin.regenerate_schedule`.
- **Carte Lovelace** (chargée automatiquement) — frise du séjour (colorée par
  mix) + soirée (contour pointillé = fenêtre de swing) sur une **couche de
  transition du soleil**, navigation jour par jour, et un sélecteur de mix par jour.
- **UI d'options** — dates de vacances, mode, longueur de roulement, jitter,
  extinction de sécurité.

Reste à faire : édition par glisser des clips sur la carte, édition des mix depuis
l'UI, et packaging HACS. Voir [VISION.md](VISION.md) et [docs/MVP-PLAN.md](docs/MVP-PLAN.md).

## Installation

### Via HACS (dépôt personnalisé)

[![Ouvrir dans HACS](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=Noodlex&repository=house-agent-kevin&category=integration)

1. HACS → ⋮ (en haut à droite) → **Dépôts personnalisés**.
2. Dépôt : `https://github.com/Noodlex/house-agent-kevin` — Catégorie : **Intégration** → **Ajouter**.
3. Cherchez **House Agent Kevin** dans HACS → **Télécharger**.
4. **Redémarrez Home Assistant.**
5. **Paramètres → Appareils et services → Ajouter l'intégration → House Agent Kevin.**
6. Déposez une carte `custom:house-agent-kevin-card` sur un tableau de bord (elle
   se charge toute seule — aucune ressource Lovelace à déclarer).

### Manuelle

Copiez `custom_components/kevin/` dans votre `config/custom_components/`,
redémarrez, puis suivez les étapes 5–6 ci-dessus.

Le preset livré cible une maison de référence ; ajustez les entités, les mix et
les dates de vacances à votre logement (via l'UI d'options ou
`presets/reference.json`).

## Pourquoi pas simplement « Presence Simulation » ?

Le domaine `presence_simulation` est déjà pris par une
[intégration HACS existante](https://github.com/slashback100/presence_simulation).
House Agent Kevin utilise le domaine `kevin` et adopte une approche orientée
carte, pensée pour les vacances.

## Licence

MIT
