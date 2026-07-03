# House Agent Kevin — Vision & modèle

> Vue de dehors, le soir, pendant les vacances : la maison a l'air **habitée**.
> Un seul interrupteur l'arme, et une carte montre à l'avance ce qui va se
> passer, jour par jour, calé sur le vrai soleil.

Le mot-clé : **crédibilité vue de l'extérieur**. Tout en découle.

---

## 1. Le modèle : une table de mixage 🎛️

On ne *génère pas* algorithmiquement une soirée « plausible » : on la **compose
à la main**, comme un mix de musique. Kevin se contente ensuite de la *rejouer*,
avec un léger décalage aléatoire chaque soir.

| Musique 🎛️ | Kevin 🏠 |
|---|---|
| **Piste** (track) | une **entité** (Cuisine, Séjour, Salon, TV/son…) |
| **Clip** sur la piste | une **plage** début→fin où l'entité est ON |
| **Type de piste** | lumière/prise → ON sur la plage · média/script → on/off |
| **One-shot / sample** | **événement ponctuel** (losange) : le « son » occasionnel, une action unique |
| **Le swing** | le **jitter ±** (contour pointillé) — jamais posé pile au même moment |
| **Le mix complet** | un **schéma** = une soirée entière arrangée |
| **La crate de mixes** | les **4 modes** : plusieurs mixes → tirage au sort / par jour / roulement |

**Un « schéma » = un mix.** Kevin joue un mix par soir + le swing.

### Le swing (jitter) : global + surcharge
Un `±` par défaut pour tout le mix (ex. ±20 min). Surchargeable par clip quand
il le faut : le repas peut flotter (±30), mais l'**extinction de sécurité**
reste serrée (±5) pour que la maison ne reste jamais allumée trop tard.

### Ancrage soleil : au choix par bord de clip
Chaque bord d'un clip est soit une **heure fixe** (`18:45`), soit **relatif au
soleil** (`coucher −30`, `lever +15`). Le mix se décale donc tout seul selon la
saison — c'est le lien avec la couche soleil de la carte, et pourquoi
l'illusion tient toute l'année.

---

## 2. Deux étages : le mix (soirée) et le plan de séjour

Le modèle a **deux niveaux** :

- 🎵 **Micro — un mix** = la soirée arrangée (pistes/clips/one-shots). Cf. §1.
- 🗓️ **Macro — le plan de séjour** = comment on **répartit les mix sur les
  jours** de vacances : des **blocs de longueur libre** (Mix A pendant 3 jours,
  puis Mix B pendant 5 jours, puis Mix C pendant 2 jours…), ou des affectations
  sur des jours précis.

Les « 4 modes » historiques ne sont plus que des **façons de remplir ce plan** :
| Mode | = plan de séjour |
|---|---|
| Global quotidien | un seul bloc couvrant tout le séjour |
| Pool aléatoire | chaque jour = un mix tiré au sort dans un pool |
| Défini par jour | affectation par jour de la semaine |
| Roulement de N jours | blocs de N jours qui se répètent (A→B→C→…) |

Le plan de séjour généralise tout ça : blocs de durée quelconque + surcharges
par jour. La carte l'affiche comme un **bandeau** colorié (1 couleur = 1 mix),
cliquable pour naviguer jour par jour.

---

## 3. Les deux casquettes de Kevin
- 🎛️ **Le show** — le mix de lumières visibles. La crédibilité. (v1)
- 🎚️ **La régie** — à l'armement, Kevin met la maison en **mode absence** et
  restaure tout au retour : (v2)
  - **suspendre des automatisations** gênantes (volets/déco) → les réactiver à l'arrêt ;
  - **basculer des composants** en mode absence en sauvegardant leur état
    (ex. **vannes thermostatiques** → hors-gel/éco) → les remettre comme avant.

  Principe : à l'armement Kevin **mémorise l'état**, applique le mode absence ;
  au désarmement il **rejoue l'état sauvegardé**. Réversible, sans conflit.

---

## 4. La carte Lovelace = la table de mixage
La frise turquoise/grise **devient l'éditeur** :
- pistes **turquoise** = pilotées par Kevin · pistes **grises** = « déjà
  automatisé » (référence, affichées pour composer en contexte) ;
- on pose / tire les clips à la souris, contour pointillé = fenêtre ± ;
- **couche soleil** en fond, en **plage de transition sur tout le séjour** :
  on affiche le coucher (et le lever) du **premier** et du **dernier** jour, et
  la zone entre les deux est colorée en teinte intermédiaire (« ça bascule ici
  selon la date »). Le marqueur du jour affiché glisse dans cette bande. Jour =
  clair, nuit = sombre, transition = intermédiaire ;
- deux timelines : un **bandeau macro** (plan de séjour, mix par jour) au-dessus,
  et la **frise micro** (la soirée du jour) en dessous ;
- **navigateur de dates** entre les 2 dates de vacances → prévisualise quel mix
  passe et à quelle heure réelle, avec le soleil du jour.

---

## 5. Portée : hybride
Moteur **100 % générique** (aucune entité en dur dans le code), mais on démarre
avec la maison de référence comme **preset/config de test** pour valider vite.
Utilisable tout de suite chez soi, partageable HACS ensuite sans réécrire.

---

## 6. Décisions encore ouvertes (propositions à confirmer)
- **D — Quand génère-t-on le planning ?** *Proposé :* à l'armement (pour ce
  soir) + chaque nuit à minuit (pour le lendemain), **persisté** pour survivre à
  un redémarrage de HA. Service `regenerate_schedule` pour re-tirer les aléas.
- **E — Sémantique du switch.** *Proposé :* `switch.kevin` = ON/OFF manuel. Les
  **dates de vacances** = bornes de la simulation + de la carte (hors période,
  Kevin ne joue rien). Pas d'auto-désarmement à la date de fin en v1.
- **F — Robustesse.** *Proposé :* extinction de sécurité systématique en fin de
  nuit ; retour anticipé = OFF manuel → tout redevient normal (et régie
  restaurée en v2) ; reboot HA en cours d'absence = on relit le planning
  persisté.

---

## 7. Journal des décisions
- **Nom** : House Agent Kevin (clin d'œil *Home Alone*) · domain `kevin` · repo `house-agent-kevin`.
- **A** Portée : **hybride** (moteur générique + preset maison).
- **B** Modèle : **composition manuelle « table de mixage »** (pas d'algo de plausibilité).
- **Jitter** : **global + surcharge par clip**.
- **Ancrage** : **absolu OU soleil, au choix par bord de clip**.
- **Régie** (suspend/restore autos + composants) : retenue, planifiée **v2**.
- **Carte** : éditeur intégré au **même repo** (`www/`).
- **Deux étages** : mix (soirée, micro) + **plan de séjour** (répartition des mix
  sur les jours, macro). Les 4 modes = cas particuliers du plan.
- **Couche soleil** : **plage de transition** premier↔dernier jour (couleur
  intermédiaire), pas un simple trait.
