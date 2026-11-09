// House Agent Kevin — Lovelace card.
// Deux vues : l'aperçu (séjour macro + soirée micro + couche soleil, lu via
// kevin/get_plan) et l'édition (clips déplaçables, inspecteur, et le CRUD des
// scénarios). Pas d'étape de build : un custom element qui écrit du SVG.
//
// L'édition travaille sur une copie locale de la config (kevin/get_config) et
// n'écrit qu'une fois, à l'enregistrement (kevin/update_config). C'est ce qui
// permet de créer, dupliquer et supprimer des scénarios sans laisser le store
// dans un état intermédiaire incohérent — et pourquoi le nettoyage des
// références d'un scénario supprimé se fait ici, pas côté serveur.

const PALETTE = ["#14b8a6", "#8b5cf6", "#f59e0b", "#ec4899", "#3b82f6", "#10b981", "#f43f5e"];

// Les quatre modes de `rule.mode`, dans l'ordre où on les propose.
const MODE_LABELS = {
  global: "un seul scénario",
  rotation: "roulement",
  pool: "tirage au sort",
  weekday: "par jour de semaine",
};

// Les clés attendues par le générateur (`_WEEKDAY_KEYS`), avec leur libellé.
const WEEKDAYS = [
  ["mon", "lun"], ["tue", "mar"], ["wed", "mer"], ["thu", "jeu"],
  ["fri", "ven"], ["sat", "sam"], ["sun", "dim"],
];

const SPAN_MIN = 600;            // the 16:00 -> 02:00 window, in minutes
const START_MIN = 16 * 60;
const ROW_H = 24;                // px per track row
const TOP = 30;                  // px above the first row (hour labels)

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function truncate(s, max) {
  s = String(s);
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

/** « Aujourd'hui » au format YYYY-MM-DD, en heure LOCALE.
 *  toISOString() donne la date UTC : entre minuit et 1 h ou 2 h à Paris, elle
 *  désigne encore la veille. Toute comparaison avec les dates du séjour (qui
 *  sont des jours locaux) doit passer par ici. */
function localToday() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseLocal(iso) {
  const m = String(iso).match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/);
  if (!m) return { date: "", h: 0, min: 0 };
  return { date: m[1], h: +m[2], min: +m[3] };
}

class HouseAgentKevinCard extends HTMLElement {
  setConfig(config) {
    this._config = config || {};
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._fetched) {
      this._fetched = true;
      this._load();
    }
  }

  getCardSize() {
    return 9;
  }

  connectedCallback() {
    // Re-render when the card is resized so 1 SVG unit stays 1 real pixel.
    if (this._ro) return;
    this._ro = new ResizeObserver(() => {
      const w = this._innerWidth();
      if (w !== this._lastWidth && this._data) {
        this._lastWidth = w;
        this._render();
      }
    });
    this._ro.observe(this);
  }

  disconnectedCallback() {
    if (this._ro) {
      this._ro.disconnect();
      this._ro = null;
    }
  }

  _innerWidth() {
    const w = this.getBoundingClientRect().width;
    // 28px = the ha-card horizontal padding declared in the styles below.
    return Math.max(340, Math.round((w || 680) - 28));
  }

  async _load() {
    try {
      this._data = await this._hass.connection.sendMessagePromise({ type: "kevin/get_plan" });
      if (this._selected == null) this._selected = this._defaultIndex();
      this._render();
    } catch (err) {
      this._renderError(err);
      return;
    }
    // Un séjour terminé n'a qu'une suite logique : de nouvelles dates. On ouvre
    // le panneau une seule fois par affichage de la carte — le refermer reste
    // possible, et un enregistrement ne le rouvrira pas en boucle.
    if (this._sejourEnded() && this._isAdmin() && !this._edit && !this._absCfg && !this._absAutoOpened) {
      this._absAutoOpened = true;
      await this._toggleAbsence();
    }
  }

  _defaultIndex() {
    const days = (this._data && this._data.days) || [];
    if (!days.length) return 0;
    const today = localToday();
    const idx = days.findIndex((d) => d.date >= today);
    return idx < 0 ? 0 : idx;
  }

  _mixColor(mixId) {
    const keys = Object.keys((this._data && this._data.mixes) || {});
    const i = keys.indexOf(mixId);
    return PALETTE[(i < 0 ? 0 : i) % PALETTE.length];
  }

  _friendly(entityId) {
    const st = this._hass && this._hass.states[entityId];
    return (st && st.attributes && st.attributes.friendly_name) || entityId;
  }

  _root() {
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    return this.shadowRoot;
  }

  _renderError(err) {
    if (err && err.code === "not_found") {
      // La carte est encore en cache mais l'intégration n'est pas (ou plus)
      // configurée : on dit quoi faire plutôt qu'afficher une erreur brute.
      this._root().innerHTML = `
        <ha-card header="House Agent Kevin">
          <div style="padding:0 16px 16px;line-height:1.5;color:var(--primary-text-color)">
            Kevin n'est pas encore configuré sur ce Home Assistant.<br>
            <a href="/config/integrations/dashboard/add?domain=kevin">Ajouter l'intégration House Agent Kevin</a>
            <span style="color:var(--secondary-text-color)">— ou Paramètres → Appareils et services → Ajouter une intégration.</span>
          </div>
        </ha-card>`;
      return;
    }
    const msg = err && err.message ? err.message : "House Agent Kevin is not set up yet.";
    this._root().innerHTML = `<ha-card header="House Agent Kevin"><div style="padding:16px;color:var(--error-color,#c00)">${esc(msg)}</div></ha-card>`;
  }

  /** Vrai tant qu'aucun scénario n'allume quoi que ce soit : Kevin n'a rien à jouer. */
  _isEmpty() {
    return !(this._data.days || []).some((d) =>
      (d.events || []).some((e) => e.action === "on" || e.action === "oneshot")
    );
  }

  _onboardingHtml(admin) {
    if (!this._isEmpty()) return "";
    if (!admin) {
      return `<div class="onb"><b>Kevin n'est pas encore configuré.</b>
        <div>Un administrateur doit d'abord choisir les lumières qu'il simulera.</div></div>`;
    }
    return `<div class="onb">
        <b>Bienvenue — Kevin n'a encore rien à jouer.</b>
        <ol>
          <li><b>Choisis les lumières</b> qu'il allumera le soir.
            <button class="btn primary" id="onbedit">✎ Ajouter mes premières pistes</button></li>
          <li><b>Vérifie les dates</b> de ton absence dans le bandeau « Absence » ci-dessus.</li>
          <li><b>Le jour du départ, arme Kevin</b> d'un clic sur la pastille « Désarmé ».</li>
        </ol>
      </div>`;
  }

  // ---- edit mode -------------------------------------------------------- //

  /** The scenario being edited: the one picked in the bar, else the day's own. */
  _mixId(day) {
    if (this._edit && this._config && this._editMix && this._config.mixes[this._editMix]) {
      return this._editMix;
    }
    return day.mix;
  }

  _clips(day) {
    const mix = this._config.mixes[this._mixId(day)];
    return mix ? mix.clips : [];
  }

  /** Anchor -> minutes since local midnight of `day` (may exceed 1440). */
  _anchorMins(anchor, day) {
    if (anchor.type === "sun") {
      const p = parseLocal(anchor.event === "sunrise" ? day.sunrise : day.sunset);
      return p.h * 60 + p.min + (anchor.offset || 0);
    }
    const [h, m] = String(anchor.time).split(":").map(Number);
    return h * 60 + m;
  }

  /** Move an anchor to `mins`, preserving whether it is fixed or sun-anchored. */
  _setAnchor(anchor, mins, day) {
    if (anchor.type === "sun") {
      const p = parseLocal(anchor.event === "sunrise" ? day.sunrise : day.sunset);
      anchor.offset = Math.round(mins - (p.h * 60 + p.min));
    } else {
      const m = ((Math.round(mins) % 1440) + 1440) % 1440;
      anchor.time = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    }
  }

  async _enterEdit() {
    const res = await this._hass.connection.sendMessagePromise({ type: "kevin/get_config" });
    this._config = res.config;
    this._timings = res.timings || [];
    if (this._timingId == null && this._timings.length) this._timingId = this._timings[0].id;
    const day = this._data.days[this._selected];
    this._editMix =
      day && this._config.mixes[day.mix] ? day.mix : Object.keys(this._config.mixes)[0];
    this._edit = true;
    this._dirty = false;
    this._sel = null;
    this._render();
  }

  // ---- scenario CRUD ---------------------------------------------------- //

  _slugify(name) {
    return String(name)
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "") // « soirée » -> « soiree »
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40);
  }

  _uniqueMixId(name) {
    const mixes = this._config.mixes;
    const base = this._slugify(name) || "scenario";
    if (!mixes[base]) return base;
    for (let n = 2; n < 1000; n++) {
      if (!mixes[`${base}_${n}`]) return `${base}_${n}`;
    }
    return `${base}_${Date.now()}`;
  }

  /** Everything that points at a scenario — i.e. what deleting it disturbs. */
  _mixUsage(mixId) {
    const sejour = this._config.sejour || {};
    const rule = sejour.rule || {};
    const overrides = sejour.overrides || {};
    return {
      days: (this._data.days || []).filter((d) => d.mix === mixId).length,
      inList: (rule.mixes || []).includes(mixId),
      isRuleMix: rule.mix === mixId,
      weekdays: Object.keys(rule.map || {}).filter((k) => rule.map[k] === mixId),
      painted: Object.keys(overrides).filter((k) => overrides[k] === mixId),
    };
  }

  _switchMix(id, dirty) {
    this._editMix = id;
    this._sel = null; // les index de clips appartenaient au scénario précédent
    if (dirty) this._dirty = true;
    this._render();
  }

  _newMix() {
    const name = (prompt("Nom du nouveau scénario :", "Nouvelle soirée") || "").trim();
    if (!name) return;
    const id = this._uniqueMixId(name);
    const current = this._config.mixes[this._editMix];
    this._config.mixes[id] = {
      id,
      name,
      jitter_default: current ? current.jitter_default : 20,
      clips: [],
      oneshots: [],
    };
    this._switchMix(id, true);
  }

  _duplicateMix() {
    const src = this._config.mixes[this._editMix];
    if (!src) return;
    const name = (prompt("Nom de la copie :", `${src.name} (copie)`) || "").trim();
    if (!name) return;
    const id = this._uniqueMixId(name);
    const copy = JSON.parse(JSON.stringify(src));
    copy.id = id;
    copy.name = name;
    this._config.mixes[id] = copy;
    this._switchMix(id, true);
  }

  _renameMix() {
    const mix = this._config.mixes[this._editMix];
    if (!mix) return;
    const name = (prompt("Nouveau nom du scénario :", mix.name) || "").trim();
    if (!name || name === mix.name) return;
    // Seul le libellé bouge. L'id est ce que visent la règle du séjour et les
    // jours peints : le renommer transformerait chaque référence en référence
    // pendante, et les soirées concernées disparaîtraient du plan sans un mot.
    mix.name = name;
    this._dirty = true;
    this._render();
  }

  _deleteMix() {
    const id = this._editMix;
    const mix = this._config.mixes[id];
    if (!mix) return;
    const ids = Object.keys(this._config.mixes);
    if (ids.length <= 1) {
      alert("Impossible de supprimer le dernier scénario : le séjour n'aurait plus rien à jouer.");
      return;
    }
    const sejour = this._config.sejour;
    const rule = sejour.rule || (sejour.rule = {});
    const overrides = sejour.overrides || (sejour.overrides = {});
    const fallbackId = ids.find((x) => x !== id);
    const fallbackName = this._config.mixes[fallbackId].name;
    const use = this._mixUsage(id);

    // Ce que le nettoyage donnera — calculé avant de toucher à quoi que ce soit,
    // pour que la confirmation annonce exactement ce qui va se passer.
    const listAfter = (rule.mixes || []).filter((x) => x !== id);
    const mapAfter = {};
    for (const k of Object.keys(rule.map || {})) {
      if (rule.map[k] !== id) mapAfter[k] = rule.map[k];
    }
    const repoints =
      (rule.mode === "global" && rule.mix === id) ||
      ((rule.mode === "rotation" || rule.mode === "pool") && !listAfter.length) ||
      (rule.mode === "weekday" && !Object.keys(mapAfter).length && (!rule.mix || rule.mix === id));

    const lines = [`Supprimer « ${mix.name} » ?`, ""];
    if (use.days) lines.push(`• ${use.days} soirée(s) du séjour y sont affectées.`);
    if (use.painted.length) lines.push(`• ${use.painted.length} jour(s) peint(s) à la main repasseront en « Auto ».`);
    if (use.weekdays.length) lines.push(`• ${use.weekdays.length} jour(s) de la semaine perdront leur association.`);
    if (use.inList && listAfter.length) lines.push("• Il sortira de la liste de la règle du séjour.");
    if (repoints) lines.push(`• La règle du séjour sera recalée sur « ${fallbackName} ».`);
    lines.push("", `Ses ${mix.clips ? mix.clips.length : 0} piste(s) seront perdues.`);
    if (!confirm(lines.join("\n"))) return;

    delete this._config.mixes[id];
    rule.mixes = listAfter;
    rule.map = mapAfter;
    for (const k of Object.keys(overrides)) {
      if (overrides[k] === id) delete overrides[k];
    }
    // Laisser un mode sans scénario à désigner revient à vider le séjour : on
    // retombe systématiquement sur un scénario qui existe encore.
    if (rule.mix === id || (rule.mode === "global" && !rule.mix)) rule.mix = fallbackId;
    if ((rule.mode === "rotation" || rule.mode === "pool") && !rule.mixes.length) {
      rule.mixes = [fallbackId];
    }
    if (rule.mode === "weekday" && !Object.keys(rule.map).length && !rule.mix) {
      rule.mix = fallbackId;
    }
    this._switchMix(fallbackId, true);
  }

  _mixOptions() {
    return Object.keys(this._config.mixes)
      .map((id) => {
        const m = this._config.mixes[id];
        return `<option value="${esc(id)}"${id === this._editMix ? " selected" : ""}>${esc(m.name)}</option>`;
      })
      .join("");
  }

  // ---- absence panel ----------------------------------------------------- //
  // Les dates et la règle du séjour, sans passer par le formulaire d'options.
  // Le panneau charge la config *vive* à l'ouverture et la réécrit entière à
  // l'enregistrement : il ne patche que `sejour`, donc il ne peut pas écraser
  // ce qui a été arrangé dans l'éditeur de scénarios.

  /** Les écritures sont réservées aux admins côté serveur — on cache le reste. */
  _isAdmin() {
    const user = this._hass && this._hass.user;
    return user ? !!user.is_admin : true;
  }

  _absRule() {
    const sejour = this._absCfg.sejour;
    return sejour.rule || (sejour.rule = { mode: "global", mix: null, mixes: [], map: {}, length: 3 });
  }

  /** Durée en jours, bornes comprises. Midi local : insensible aux heures d'été. */
  _absSpanDays() {
    const s = this._absCfg.sejour;
    const a = new Date(`${s.start_date}T12:00:00`);
    const b = new Date(`${s.end_date}T12:00:00`);
    if (isNaN(a) || isNaN(b)) return 0;
    return Math.round((b - a) / 86400000) + 1;
  }

  async _toggleAbsence() {
    if (this._absCfg) {
      if (this._absDirty && !confirm("Abandonner les modifications de l'absence ?")) return;
      this._absCfg = null;
      this._absDirty = false;
      this._render();
      return;
    }
    try {
      const res = await this._hass.connection.sendMessagePromise({ type: "kevin/get_config" });
      this._absCfg = res.config;
      this._absDirty = false;
    } catch (err) {
      this._renderError(err);
      return;
    }
    this._render();
  }

  _absSetDate(which, value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return;
    this._absCfg.sejour[which] = value;
    this._absDirty = true;
    this._render();
  }

  _absSetMode(mode) {
    const rule = this._absRule();
    const ids = Object.keys(this._absCfg.mixes);
    rule.mode = mode;
    // Chaque mode doit pouvoir désigner un scénario, sinon le séjour se vide.
    // Même règle que le formulaire d'options (preset.apply_options).
    if ((mode === "rotation" || mode === "pool") && !(rule.mixes || []).length) rule.mixes = ids.slice();
    if (mode === "global" && !rule.mix) rule.mix = ids[0];
    if (mode === "weekday" && !Object.keys(rule.map || {}).length && !rule.mix) rule.mix = ids[0];
    this._absDirty = true;
    this._render();
  }

  _absListAdd(id) {
    if (!id) return;
    const rule = this._absRule();
    rule.mixes = (rule.mixes || []).concat([id]);
    this._absDirty = true;
    this._render();
  }

  _absListRemove(i) {
    const rule = this._absRule();
    const list = (rule.mixes || []).slice();
    if (list.length <= 1) {
      alert("Il faut au moins un scénario dans la liste, sinon le séjour n'a rien à jouer.");
      return;
    }
    list.splice(i, 1);
    rule.mixes = list;
    this._absDirty = true;
    this._render();
  }

  _absListMove(i, delta) {
    const rule = this._absRule();
    const list = (rule.mixes || []).slice();
    const j = i + delta;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    rule.mixes = list;
    this._absDirty = true;
    this._render();
  }

  _absSetWeekday(key, id) {
    const rule = this._absRule();
    rule.map = rule.map || {};
    if (id) rule.map[key] = id;
    else delete rule.map[key];
    this._absDirty = true;
    this._render();
  }

  _absSetRuleMix(id) {
    this._absRule().mix = id || null;
    this._absDirty = true;
    this._render();
  }

  _absSetLength(value) {
    this._absRule().length = Math.max(1, Math.min(14, Math.round(+value) || 1));
    this._absDirty = true;
    this._render();
  }

  async _absSave() {
    try {
      await this._hass.connection.sendMessagePromise({
        type: "kevin/update_config",
        config: this._absCfg,
      });
    } catch (err) {
      // Dates inversées, séjour délirant, liste vide… : on reste ouvert pour
      // que la saisie en cours ne parte pas à la poubelle.
      alert(`Enregistrement refusé : ${(err && err.message) || err}`);
      return;
    }
    this._absCfg = null;
    this._absDirty = false;
    await this._load();
  }

  _absMixOptions(selected, placeholder) {
    const opts = Object.keys(this._absCfg.mixes).map((id) => {
      const name = this._absCfg.mixes[id].name;
      return `<option value="${esc(id)}"${id === selected ? " selected" : ""}>${esc(name)}</option>`;
    });
    if (placeholder) opts.unshift(`<option value=""${selected ? "" : " selected"}>${esc(placeholder)}</option>`);
    return opts.join("");
  }

  /** Le dernier soir du séjour est derrière nous : armer Kevin ne ferait rien. */
  _sejourEnded() {
    return !!(this._data && this._data.sejour && this._data.sejour.end < localToday());
  }

  _absenceSummary() {
    const s = this._data.sejour;
    const n = this._data.days.length;
    const fmt = (iso) => `${iso.slice(8)}/${iso.slice(5, 7)}`;
    const mode = (this._data.rule && this._data.rule.mode) || "";
    const label = MODE_LABELS[mode] || mode;
    if (this._sejourEnded()) {
      const armedNote = this._data.armed ? " · Kevin est armé mais n'a plus rien à jouer" : "";
      return `séjour terminé (du ${fmt(s.start)} au ${fmt(s.end)}) — choisis les dates de ta prochaine absence${armedNote}`;
    }
    return `du ${fmt(s.start)} au ${fmt(s.end)} · ${n} jour${n > 1 ? "s" : ""}${label ? ` · ${label}` : ""}`;
  }

  _absRuleHtml() {
    const rule = this._absRule();
    const mixes = this._absCfg.mixes;
    if (rule.mode === "global") {
      return `<div class="absrow"><label>Scénario</label>
        <select data-abs="rulemix">${this._absMixOptions(rule.mix)}</select></div>`;
    }
    if (rule.mode === "rotation" || rule.mode === "pool") {
      const list = rule.mixes || [];
      const rows = list
        .map((id, i) => {
          const name = mixes[id] ? mixes[id].name : `${id} (inconnu)`;
          const order = rule.mode === "rotation" ? `<span class="absnum">${i + 1}</span>` : "";
          const arrows =
            rule.mode === "rotation"
              ? `<button class="tbtn" data-abs="up" data-i="${i}" title="Monter"${i === 0 ? " disabled" : ""}>▲</button>` +
                `<button class="tbtn" data-abs="down" data-i="${i}" title="Descendre"${i === list.length - 1 ? " disabled" : ""}>▼</button>`
              : "";
          return `<div class="absitem">${order}<span class="absname">${esc(name)}</span>${arrows}
            <button class="tbtn" data-abs="rm" data-i="${i}" title="Retirer de la liste">✕</button></div>`;
        })
        .join("");
      const free = Object.keys(mixes).filter((id) => !list.includes(id));
      const add = free.length
        ? `<select data-abs="add"><option value="">＋ ajouter un scénario…</option>${free
            .map((id) => `<option value="${esc(id)}">${esc(mixes[id].name)}</option>`)
            .join("")}</select>`
        : `<span class="absnote">Tous les scénarios sont déjà dans la liste.</span>`;
      const len =
        rule.mode === "rotation"
          ? `<div class="absrow"><label>Bloc</label>
              <input type="number" min="1" max="14" step="1" value="${rule.length || 3}" data-abs="len"> jours par scénario
              <span class="absnote">${esc(this._rotationPreview())}</span></div>`
          : `<div class="absrow"><span class="absnote">Un scénario est tiré au sort chaque soir, de façon reproductible.</span></div>`;
      return `<div class="abslist">${rows}</div><div class="absrow">${add}</div>${len}`;
    }
    // weekday
    const rows = WEEKDAYS.map(
      ([key, label]) =>
        `<div class="absday"><span>${label}</span>
          <select data-abs="wd" data-key="${key}">${this._absMixOptions(rule.map ? rule.map[key] : "", "— repli —")}</select></div>`
    ).join("");
    return `<div class="absgrid">${rows}</div>
      <div class="absrow"><label>Repli</label>
        <select data-abs="rulemix">${this._absMixOptions(rule.mix)}</select>
        <span class="absnote">joué les jours laissés sur « repli ».</span></div>`;
  }

  /** « A A A B B B A… » — ce que le roulement va réellement donner. */
  _rotationPreview() {
    const rule = this._absRule();
    const list = rule.mixes || [];
    if (!list.length) return "";
    const block = Math.max(1, rule.length || 1);
    const letters = list.map((id, i) => String.fromCharCode(65 + i));
    const span = Math.min(this._absSpanDays(), 12);
    const out = [];
    for (let i = 0; i < span; i++) out.push(letters[Math.floor(i / block) % letters.length]);
    return `${out.join(" ")}${this._absSpanDays() > 12 ? " …" : ""}  (${list
      .map((id, i) => `${letters[i]} = ${this._absCfg.mixes[id] ? this._absCfg.mixes[id].name : id}`)
      .join(", ")})`;
  }

  _absenceHtml() {
    if (!this._isAdmin()) return "";
    const open = !!this._absCfg;
    const ended = this._sejourEnded() ? " ended" : "";
    const head = `<button class="absbtn${ended}" id="abstoggle">${open ? "▾" : "▸"} Absence — ${esc(this._absenceSummary())}</button>`;
    if (!open) return `<div class="abs">${head}</div>`;

    const sejour = this._absCfg.sejour;
    const rule = this._absRule();
    const n = this._absSpanDays();
    const problem =
      n < 1
        ? "La fin précède le début."
        : n > 366
        ? `${n} jours : au-delà d'un an, c'est probablement une faute de frappe sur l'année.`
        : "";
    const stale = Object.keys(sejour.overrides || {}).filter(
      (d) => d < sejour.start_date || d > sejour.end_date
    );
    const modeOpts = Object.keys(MODE_LABELS)
      .map((m) => `<option value="${m}"${m === rule.mode ? " selected" : ""}>${esc(MODE_LABELS[m])}</option>`)
      .join("");

    return `<div class="abs">${head}
      <div class="abspanel">
        <div class="absrow">
          <label>Du</label><input type="date" value="${esc(sejour.start_date)}" data-abs="start">
          <label>au</label><input type="date" value="${esc(sejour.end_date)}" data-abs="end">
          <span class="${problem ? "absbad" : "absnote"}">${problem ? esc(problem) : `${n} jour${n > 1 ? "s" : ""}`}</span>
        </div>
        <div class="absrow"><label>Règle</label><select data-abs="mode">${modeOpts}</select></div>
        ${this._absRuleHtml()}
        ${stale.length ? `<div class="absnote">${stale.length} jour(s) peint(s) hors de ces dates sont conservés — ils reprendront effet si tu élargis le séjour.</div>` : ""}
        <div class="absrow absactions">
          <button class="btn" data-abs="cancel">Annuler</button>
          <button class="btn primary" data-abs="save"${problem ? " disabled" : ""}>Enregistrer l'absence</button>
        </div>
      </div></div>`;
  }

  _bindAbsence(root) {
    const toggle = root.getElementById("abstoggle");
    if (toggle) toggle.onclick = () => this._toggleAbsence();
    if (!this._absCfg) return;
    root.querySelectorAll(".abspanel [data-abs]").forEach((el) => {
      const act = el.dataset.abs;
      const i = +el.dataset.i;
      if (act === "start") el.addEventListener("change", () => this._absSetDate("start_date", el.value));
      else if (act === "end") el.addEventListener("change", () => this._absSetDate("end_date", el.value));
      else if (act === "mode") el.addEventListener("change", () => this._absSetMode(el.value));
      else if (act === "rulemix") el.addEventListener("change", () => this._absSetRuleMix(el.value));
      else if (act === "len") el.addEventListener("change", () => this._absSetLength(el.value));
      else if (act === "add") el.addEventListener("change", () => this._absListAdd(el.value));
      else if (act === "rm") el.addEventListener("click", () => this._absListRemove(i));
      else if (act === "up") el.addEventListener("click", () => this._absListMove(i, -1));
      else if (act === "down") el.addEventListener("click", () => this._absListMove(i, 1));
      else if (act === "wd") el.addEventListener("change", () => this._absSetWeekday(el.dataset.key, el.value));
      else if (act === "cancel") el.addEventListener("click", () => this._toggleAbsence());
      else if (act === "save") el.addEventListener("click", () => this._absSave());
    });
  }

  // --- per-clip edge/jitter edits (inspector) ---------------------------- //

  _sunMins(event, day) {
    const p = parseLocal(event === "sunrise" ? day.sunrise : day.sunset);
    return p.h * 60 + p.min;
  }

  _setEdgeType(clip, edge, type, day) {
    const a = clip[edge];
    if (a.type === type) return;
    const mins = this._anchorMins(a, day);
    if (type === "sun") {
      clip[edge] = { type: "sun", event: "sunset", offset: Math.round(mins - this._sunMins("sunset", day)) };
    } else {
      const m = ((Math.round(mins) % 1440) + 1440) % 1440;
      clip[edge] = { type: "fixed", time: `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}` };
    }
    this._dirty = true;
    this._render();
  }

  _setEdgeEvent(clip, edge, event, day) {
    const a = clip[edge];
    if (a.type !== "sun") return;
    const mins = this._anchorMins(a, day); // keep the resolved time stable
    a.event = event;
    a.offset = Math.round(mins - this._sunMins(event, day));
    this._dirty = true;
    this._render();
  }

  _setEdgeOffset(clip, edge, offset) {
    clip[edge].offset = Math.round(+offset || 0);
    this._dirty = true;
    this._render();
  }

  _setEdgeTime(clip, edge, time) {
    if (!/^\d{1,2}:\d{2}/.test(time)) return;
    clip[edge].time = time.slice(0, 5);
    this._dirty = true;
    this._render();
  }

  _setJitter(clip, value) {
    if (value === "" || value == null) delete clip.jitter;
    else clip.jitter = Math.max(0, Math.round(+value));
    this._dirty = true;
    this._render();
  }

  async _exitEdit(save) {
    if (save && this._dirty) {
      try {
        await this._hass.connection.sendMessagePromise({
          type: "kevin/update_config",
          config: this._config,
        });
      } catch (err) {
        // Le serveur refuse une config incohérente (référence de scénario
        // pendante) : on reste en édition pour que rien ne soit perdu.
        alert(`Enregistrement refusé : ${(err && err.message) || err}`);
        return;
      }
    }
    this._edit = false;
    this._config = null;
    this._editMix = null;
    this._sel = null;
    await this._load();
  }

  _timing(id) {
    return (this._timings || []).find((t) => t.id === id) || null;
  }

  _clipFromTiming(entityId, timingId) {
    const t = this._timing(timingId);
    if (!t) {
      return {
        entity_id: entityId,
        start: { type: "sun", event: "sunset", offset: 0 },
        end: { type: "sun", event: "sunset", offset: 120 },
      };
    }
    const clip = {
      entity_id: entityId,
      start: JSON.parse(JSON.stringify(t.start)),
      end: JSON.parse(JSON.stringify(t.end)),
    };
    if (t.jitter != null) clip.jitter = t.jitter;
    return clip;
  }

  _addTrack(entityId, day) {
    if (!entityId) return;
    const mix = this._config.mixes[this._mixId(day)];
    if (!mix || mix.clips.some((c) => c.entity_id === entityId)) return;
    mix.clips.push(this._clipFromTiming(entityId, this._timingId));
    this._dirty = true;
    this._render();
  }

  /** Re-shape an existing clip with a ready-made pattern (entity untouched). */
  _applyTiming(clip, timingId) {
    const t = this._timing(timingId);
    if (!t) return;
    clip.start = JSON.parse(JSON.stringify(t.start));
    clip.end = JSON.parse(JSON.stringify(t.end));
    if (t.jitter != null) clip.jitter = t.jitter;
    this._dirty = true;
    this._render();
  }

  _removeTrack(entityId, day) {
    const mix = this._config.mixes[this._mixId(day)];
    if (!mix) return;
    mix.clips = mix.clips.filter((c) => c.entity_id !== entityId);
    this._sel = null; // indices shifted; drop any selection
    this._dirty = true;
    this._render();
  }

  async _regenerate() {
    if (!this._data || !this._data.armed) return;
    await this._hass.callService("kevin", "regenerate_schedule");
    await this._load();
  }

  async _toggleArm() {
    const armed = this._data && this._data.armed;
    await this._hass.callService("kevin", armed ? "stop" : "start");
    await this._load();
  }

  _xForMin(mins) {
    const v = Math.max(0, Math.min(SPAN_MIN, mins - START_MIN));
    return this._L + (v / SPAN_MIN) * (this._R - this._L);
  }

  _xForIso(iso, dayDate) {
    const p = parseLocal(iso);
    let mins = p.h * 60 + p.min;
    if (p.date > dayDate) mins += 24 * 60;
    return this._xForMin(mins);
  }

  _buildTracks(day) {
    const perEntity = {};
    for (const e of day.events) {
      if (e.action === "safety_off") continue;
      (perEntity[e.entity_id] = perEntity[e.entity_id] || []).push(e);
    }
    const tracks = Object.keys(perEntity).map((eid) => {
      const evs = perEntity[eid].slice().sort((a, b) => (a.t < b.t ? -1 : 1));
      const intervals = [];
      const shots = [];
      let openOn = null;
      for (const ev of evs) {
        if (ev.action === "on") openOn = ev.t;
        else if (ev.action === "off") {
          if (openOn) intervals.push([openOn, ev.t]);
          openOn = null;
        } else if (ev.action === "oneshot") shots.push(ev.t);
      }
      if (openOn) intervals.push([openOn, null]);
      return { eid, intervals, shots, first: evs.length ? evs[0].t : "" };
    });
    tracks.sort((a, b) => (a.first < b.first ? -1 : 1));
    return tracks;
  }

  _svg(day) {
    const kev = this._buildTracks(day);
    const ref = day.reference || [];

    // 1 SVG unit = 1 real pixel: the viewBox is built at the measured width, so
    // nothing gets scaled up when the card is wide (e.g. in a panel view).
    const W = this._innerWidth();
    this._lastWidth = W;
    const narrow = W < 620;
    this._L = narrow ? 96 : 150;           // label column
    this._R = W - 8;
    const labelChars = narrow ? 11 : 18;

    const y0 = TOP;
    const nRows = Math.max(1, ref.length + kev.length);
    const bottom = y0 + nRows * ROW_H;
    const H = bottom + 34;
    const safety = day.events.find((e) => e.action === "safety_off");
    const safetyEnd = safety ? safety.t : null;

    // Sun transition band from earliest to latest sunset over the whole séjour.
    const sunsetMods = this._data.days.map((d) => {
      const p = parseLocal(d.sunset);
      return p.h * 60 + p.min;
    });
    const bandL = this._xForMin(Math.min(...sunsetMods));
    const bandR = this._xForMin(Math.max(...sunsetMods));
    const sunX = this._xForIso(day.sunset, day.date);
    const sunP = parseLocal(day.sunset);
    const sunLabel = `${sunP.h}h${String(sunP.min).padStart(2, "0")}`;

    const parts = [];
    parts.push(`<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" style="display:block">`);
    // sun layers
    parts.push(`<rect x="${this._L}" y="22" width="${bandL - this._L}" height="${bottom - 22}" fill="#facc15" fill-opacity="0.10"/>`);
    parts.push(`<rect x="${bandL}" y="22" width="${bandR - bandL}" height="${bottom - 22}" fill="#6366f1" fill-opacity="0.18"/>`);
    parts.push(`<rect x="${bandR}" y="22" width="${this._R - bandR}" height="${bottom - 22}" fill="#1e3a8a" fill-opacity="0.20"/>`);
    // hour grid + labels (thin out the labels when there is no room)
    const step = W < 520 ? 3 : W < 760 ? 2 : 1;
    for (let h = 16; h <= 26; h++) {
      const x = this._xForMin(h * 60);
      parts.push(`<line x1="${x}" y1="22" x2="${x}" y2="${bottom}" stroke="var(--divider-color,#ddd)" stroke-opacity="0.5"/>`);
      if ((h - 16) % step === 0) {
        parts.push(`<text x="${x}" y="14" text-anchor="middle" class="tm">${h % 24}h</text>`);
      }
    }
    // sunset marker
    parts.push(`<line x1="${sunX}" y1="22" x2="${sunX}" y2="${bottom}" stroke="#f97316" stroke-width="1.5" stroke-dasharray="3 3"/>`);
    parts.push(`<circle cx="${sunX}" cy="26" r="4" fill="#f97316"/>`);
    const sunAnchor = sunX > W - 90 ? "end" : "start";
    const sunTx = sunAnchor === "end" ? sunX - 8 : sunX + 8;
    parts.push(`<text x="${sunTx}" y="30" text-anchor="${sunAnchor}" class="tm" fill="#c2410c">coucher ${sunLabel}</text>`);
    // safety off marker
    if (safetyEnd) {
      const sx = this._xForIso(safetyEnd, day.date);
      parts.push(`<line x1="${sx}" y1="22" x2="${sx}" y2="${bottom}" stroke="var(--secondary-text-color,#888)" stroke-dasharray="2 3"/>`);
    }
    // reference rows (grey — already automated, not controlled by Kevin)
    let row = 0;
    ref.forEach((tr) => {
      const cy = y0 + row * ROW_H + 12;
      row += 1;
      parts.push(`<text x="6" y="${cy + 4}" class="tm">${esc(truncate(tr.name, labelChars))}</text>`);
      for (const c of tr.clips) {
        const x1 = this._xForIso(c.start, day.date);
        const x2 = this._xForIso(c.end, day.date);
        const w = Math.max(3, x2 - x1);
        parts.push(`<rect x="${x1}" y="${cy - 8}" width="${w}" height="16" rx="3" fill="#94a3b8" fill-opacity="0.30" stroke="#94a3b8" stroke-dasharray="4 3"/>`);
        if (c.label) parts.push(`<text x="${x1 + 4}" y="${cy + 4}" class="tm">${c.label}</text>`);
      }
      for (const p of tr.points) {
        const x = this._xForIso(p.at, day.date);
        parts.push(`<polygon points="${x},${cy - 6} ${x + 6},${cy} ${x},${cy + 6} ${x - 6},${cy}" fill="none" stroke="#94a3b8"/>`);
        if (p.label) parts.push(`<text x="${x + 9}" y="${cy + 4}" class="tm">${esc(p.label)}</text>`);
      }
    });
    if (ref.length) {
      const sepY = y0 + ref.length * ROW_H;
      parts.push(`<line x1="6" y1="${sepY}" x2="${this._R}" y2="${sepY}" stroke="var(--divider-color,#ccc)" stroke-dasharray="2 3"/>`);
    }
    // Kevin rows (turquoise — controlled)
    kev.forEach((tr) => {
      const cy = y0 + row * ROW_H + 12;
      row += 1;
      const name = truncate(this._friendly(tr.eid), labelChars);
      parts.push(`<title>${esc(this._friendly(tr.eid))}</title><text x="6" y="${cy + 4}" class="tl">${esc(name)}</text>`);
      for (const [start, end] of tr.intervals) {
        const x1 = this._xForIso(start, day.date);
        const x2 = end ? this._xForIso(end, day.date) : this._xForIso(safetyEnd || day.sunset, day.date);
        const w = Math.max(3, x2 - x1);
        parts.push(`<rect x="${x1}" y="${cy - 8}" width="${w}" height="16" rx="3" fill="#14b8a6" fill-opacity="0.85"/>`);
      }
      for (const t of tr.shots) {
        const x = this._xForIso(t, day.date);
        parts.push(`<polygon points="${x},${cy - 7} ${x + 7},${cy} ${x},${cy + 7} ${x - 7},${cy}" fill="#0f766e"/>`);
      }
    });
    if (!kev.length) {
      parts.push(`<text x="${this._L}" y="${y0 + 18}" class="tm">Aucune entité pour l'instant — clique ✎ pour en ajouter.</text>`);
    } else if (!narrow) {
      parts.push(`<text x="${this._L}" y="${bottom + 22}" class="tm">Bande violette = le coucher tombe ici selon la date du séjour.</text>`);
    }
    parts.push(`</svg>`);
    return parts.join("");
  }

  /** Edit view: the mix's *nominal* clips (no swing), with drag handles. */
  _svgEdit(day) {
    const clips = this._clips(day);
    const W = this._innerWidth();
    this._lastWidth = W;
    const narrow = W < 620;
    this._L = narrow ? 96 : 150;
    this._R = W - 8;
    const labelChars = narrow ? 10 : 16;
    const y0 = TOP;
    const bottom = y0 + Math.max(1, clips.length) * ROW_H;
    const H = bottom + 34;

    const sunX = this._xForMin(this._anchorMins({ type: "sun", event: "sunset", offset: 0 }, day));
    const parts = [];
    parts.push(`<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" style="display:block;touch-action:none">`);
    parts.push(`<rect x="${this._L}" y="22" width="${sunX - this._L}" height="${bottom - 22}" fill="#facc15" fill-opacity="0.10"/>`);
    parts.push(`<rect x="${sunX}" y="22" width="${this._R - sunX}" height="${bottom - 22}" fill="#1e3a8a" fill-opacity="0.18"/>`);
    const step = W < 520 ? 3 : W < 760 ? 2 : 1;
    for (let h = 16; h <= 26; h++) {
      const x = this._xForMin(h * 60);
      parts.push(`<line x1="${x}" y1="22" x2="${x}" y2="${bottom}" stroke="var(--divider-color,#ddd)" stroke-opacity="0.5"/>`);
      if ((h - 16) % step === 0) parts.push(`<text x="${x}" y="14" text-anchor="middle" class="tm">${h % 24}h</text>`);
    }
    parts.push(`<line x1="${sunX}" y1="22" x2="${sunX}" y2="${bottom}" stroke="#f97316" stroke-width="1.5" stroke-dasharray="3 3"/>`);

    clips.forEach((clip, i) => {
      const cy = y0 + i * ROW_H + 12;
      let s = this._anchorMins(clip.start, day);
      let e = this._anchorMins(clip.end, day);
      if (e <= s) e += 1440;
      const x1 = this._xForMin(s);
      const x2 = this._xForMin(e);
      const w = Math.max(6, x2 - x1);
      const full = this._friendly(clip.entity_id);
      const selected = i === this._sel;
      parts.push(`<text x="6" y="${cy + 4}" class="${selected ? "tlsel" : "tl"}">${esc(truncate(full, labelChars))}</text>`);
      parts.push(`<text x="${this._L - 14}" y="${cy + 4}" class="rm" data-rm="${esc(clip.entity_id)}">✕</text>`);
      const stroke = selected ? ' stroke="#083344" stroke-width="2"' : "";
      parts.push(`<rect class="clip" data-ci="${i}" data-edge="body" x="${x1}" y="${cy - 8}" width="${w}" height="16" rx="3" fill="#14b8a6" fill-opacity="0.85"${stroke}/>`);
      parts.push(`<rect class="hnd" data-ci="${i}" data-edge="start" x="${x1 - 4}" y="${cy - 9}" width="8" height="18" rx="2" fill="#0f766e"/>`);
      parts.push(`<rect class="hnd" data-ci="${i}" data-edge="end" x="${x2 - 4}" y="${cy - 9}" width="8" height="18" rx="2" fill="#0f766e"/>`);
      const tag = clip.start.type === "sun" ? "☀" : "🕑";
      parts.push(`<text x="${x1 + 6}" y="${cy + 4}" class="tm" fill="#083344">${tag}</text>`);
    });
    if (!clips.length) {
      parts.push(`<text x="${this._L}" y="${y0 + 16}" class="tm">Aucune piste — ajoute une entité ci-dessous.</text>`);
    }
    parts.push(`</svg>`);
    return parts.join("");
  }

  _bindDrag(root, day) {
    const pxPerMin = (this._R - this._L) / SPAN_MIN;
    const clips = this._clips(day);

    const onDown = (ev) => {
      const ci = +ev.currentTarget.dataset.ci;
      const edge = ev.currentTarget.dataset.edge;
      const clip = clips[ci];
      if (!clip) return;
      ev.preventDefault();
      const startX = ev.clientX;
      const s0 = this._anchorMins(clip.start, day);
      let e0 = this._anchorMins(clip.end, day);
      if (e0 <= s0) e0 += 1440;
      let moved = false;

      const onMove = (m) => {
        if (!moved && Math.abs(m.clientX - startX) < 4) return; // click threshold
        moved = true;
        const d = Math.round((m.clientX - startX) / pxPerMin / 5) * 5;
        if (edge === "body") {
          this._setAnchor(clip.start, s0 + d, day);
          this._setAnchor(clip.end, e0 + d, day);
        } else if (edge === "start") {
          this._setAnchor(clip.start, Math.min(s0 + d, e0 - 5), day);
        } else {
          this._setAnchor(clip.end, Math.max(e0 + d, s0 + 5), day);
        }
        this._dirty = true;
        this._refreshEditSvg(day);
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        // A click (no drag) selects the clip and opens the inspector; a drag
        // ended, so re-render to refresh the inspector's values too.
        this._sel = ci;
        this._render();
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    };

    root.querySelectorAll(".clip, .hnd").forEach((el) => el.addEventListener("pointerdown", onDown));
    root.querySelectorAll(".rm").forEach((el) => {
      el.addEventListener("click", () => this._removeTrack(el.dataset.rm, day));
    });
  }

  _macro() {
    const days = this._data.days;
    // runs of consecutive same-mix days => blocks
    const blocks = [];
    for (const d of days) {
      const last = blocks[blocks.length - 1];
      if (last && last.mix === d.mix) last.n += 1;
      else blocks.push({ mix: d.mix, name: d.mix_name, n: 1 });
    }
    const blockHtml = blocks
      .map((b) => `<div class="blk" style="flex:${b.n};background:${this._mixColor(b.mix)}">${b.name} ×${b.n}</div>`)
      .join("");
    const dayHtml = days
      .map((d, i) => {
        const num = d.date.slice(8);
        const cls = i === this._selected ? "day sel" : "day";
        return `<button class="${cls}" data-i="${i}" style="border-top-color:${this._mixColor(d.mix)}">${num}</button>`;
      })
      .join("");
    return `<div class="blocks">${blockHtml}</div><div class="days">${dayHtml}</div>`;
  }

  _refreshEditSvg(day) {
    const wrap = this._root().getElementById("svgwrap");
    if (!wrap) return;
    wrap.innerHTML = this._svgEdit(day);
    this._bindDrag(wrap, day);
  }

  _renderEdit(day) {
    const root = this._root();
    const mixId = this._mixId(day);
    // Editing a mix propagates to every day the plan assigns to it.
    const affected = this._data.days.filter((d) => d.mix === mixId);
    const n = affected.length;
    const dates = affected.map((d) => `${d.date.slice(8)}/${d.date.slice(5, 7)}`);
    const datesLabel = dates.length > 8 ? dates.slice(0, 8).join(", ") + "…" : dates.join(", ");
    const dayLabel = `${day.date.slice(8)}/${day.date.slice(5, 7)}`;
    const affectedHtml = n
      ? `<div class="affected" title="${esc(dates.join(", "))}">S'applique à ${n} jour${n > 1 ? "s" : ""} du séjour : ${esc(datesLabel)}</div>`
      : `<div class="unused">Aucun jour du séjour ne joue ce scénario pour l'instant — enregistre, puis affecte-le à une date avec le sélecteur « Mix du … » de l'aperçu.</div>`;
    root.innerHTML = `
      <style>
        ha-card { padding: 12px 14px; }
        .head { display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap; }
        .title { font-weight:600; color:var(--primary-text-color); }
        .btn { cursor:pointer; border:1px solid var(--divider-color); background:var(--card-background-color); color:var(--primary-text-color); border-radius:8px; height:32px; padding:0 12px; font-size:13px; }
        .btn.primary { background:#14b8a6; border-color:#14b8a6; color:#fff; font-weight:600; }
        .affected { font-size:11px; color:#0f766e; margin:4px 0 0; font-weight:600; }
        .unused { font-size:11px; color:var(--warning-color,#b45309); margin:4px 0 0; font-weight:600; }
        .hint { font-size:11px; color:var(--secondary-text-color); margin:6px 0 4px; }
        .scen { display:flex; align-items:center; gap:6px; flex-wrap:wrap; margin-top:8px; font-size:12px; color:var(--secondary-text-color); }
        .scen select { border:1px solid var(--divider-color); background:var(--card-background-color); color:var(--primary-text-color); border-radius:6px; padding:3px 6px; font-size:12px; min-width:140px; }
        .scen .sid { font-family:monospace; font-size:10px; opacity:.6; }
        .add { display:flex; align-items:center; gap:10px; margin-top:8px; font-size:12px; color:var(--secondary-text-color); }
        .add select { border:1px solid var(--divider-color); background:var(--card-background-color); color:var(--primary-text-color); border-radius:6px; padding:3px 6px; font-size:12px; }
        .insp { margin-top:10px; border:1px solid var(--divider-color); border-radius:10px; padding:10px 12px; }
        .insp-head { display:flex; align-items:center; gap:8px; justify-content:space-between; }
        .insp-head b { color:var(--primary-text-color); font-size:13px; }
        .insp-row { display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-top:8px; font-size:12px; color:var(--secondary-text-color); }
        .insp-row > label { min-width:52px; }
        .insp input, .insp select { border:1px solid var(--divider-color); background:var(--card-background-color); color:var(--primary-text-color); border-radius:6px; padding:3px 6px; font-size:12px; }
        .insp input[type=number] { width:66px; }
        .tbtn { cursor:pointer; border:1px solid var(--divider-color); background:var(--secondary-background-color); color:var(--primary-text-color); border-radius:6px; padding:3px 8px; font-size:12px; }
        .lnk { cursor:pointer; color:var(--error-color,#c0392b); font-size:12px; }
        text.tl { fill: var(--primary-text-color); font: 12px var(--paper-font-body1_-_font-family, sans-serif); }
        text.tlsel { fill: var(--primary-text-color); font: 700 12px var(--paper-font-body1_-_font-family, sans-serif); }
        text.tm { fill: var(--secondary-text-color); font: 11px var(--paper-font-body1_-_font-family, sans-serif); }
        text.rm { fill: var(--error-color, #c0392b); font: 13px sans-serif; cursor:pointer; }
        rect.clip { cursor: grab; }
        rect.hnd { cursor: ew-resize; }
      </style>
      <ha-card>
        <div class="head">
          <div class="title">✎ Édition des scénarios</div>
          <div>
            <button class="btn" id="cancel">Annuler</button>
            <button class="btn primary" id="save">Enregistrer</button>
          </div>
        </div>
        <div class="scen">
          <span>Scénario :</span>
          <select id="mixsel" title="Choisir le scénario à éditer">${this._mixOptions()}</select>
          <button class="tbtn" id="mixnew" title="Créer un scénario vide">＋ Nouveau</button>
          <button class="tbtn" id="mixdup" title="Dupliquer ce scénario avec ses pistes">⧉ Dupliquer</button>
          <button class="tbtn" id="mixren" title="Renommer (l'identifiant interne ne change pas)">✎ Renommer</button>
          <button class="tbtn" id="mixdel" title="Supprimer ce scénario">🗑 Supprimer</button>
          <span class="sid" title="Identifiant interne, visé par la règle et les jours peints">${esc(mixId)}</span>
        </div>
        ${affectedHtml}
        <div class="hint">
          Glisse un clip pour le déplacer (poignées = début/fin, aimanté à 5 min), ou <b>clique-le</b> pour l'éditer finement.
          ✕ retire la piste. Horaires du soleil affichés pour le ${esc(dayLabel)}.
        </div>
        <div id="svgwrap">${this._svgEdit(day)}</div>
        ${this._inspectorHtml(day)}
        <div class="add">
          <span>Ajouter une piste :</span><span id="pickwrap"></span>
          <select id="timingpick" title="Forme de la plage horaire">${this._timingOptions(this._timingId)}</select>
        </div>
        <div class="hint" id="timinghint">${esc(this._timingHint(this._timingId))}</div>
      </ha-card>`;

    root.getElementById("cancel").onclick = () => this._exitEdit(false);
    root.getElementById("save").onclick = () => this._exitEdit(true);

    const mixSel = root.getElementById("mixsel");
    mixSel.onchange = () => this._switchMix(mixSel.value, false);
    root.getElementById("mixnew").onclick = () => this._newMix();
    root.getElementById("mixdup").onclick = () => this._duplicateMix();
    root.getElementById("mixren").onclick = () => this._renameMix();
    root.getElementById("mixdel").onclick = () => this._deleteMix();

    this._bindDrag(root, day);
    this._bindInspector(root, day);
    this._appendPicker(root.getElementById("pickwrap"), day);

    const timingPick = root.getElementById("timingpick");
    if (timingPick) {
      timingPick.onchange = () => {
        this._timingId = timingPick.value;
        const hint = root.getElementById("timinghint");
        if (hint) hint.textContent = this._timingHint(this._timingId);
      };
    }
  }

  _edgeControlsHtml(clip, edge) {
    const a = clip[edge];
    if (a.type === "sun") {
      return (
        `<button class="tbtn" data-act="type" data-edge="${edge}" title="Basculer en heure fixe">☀ soleil</button>` +
        `<select data-act="event" data-edge="${edge}">` +
        `<option value="sunset"${a.event !== "sunrise" ? " selected" : ""}>coucher</option>` +
        `<option value="sunrise"${a.event === "sunrise" ? " selected" : ""}>lever</option></select>` +
        `<input type="number" step="5" value="${a.offset || 0}" data-act="off" data-edge="${edge}"> min`
      );
    }
    return (
      `<button class="tbtn" data-act="type" data-edge="${edge}" title="Basculer en ancrage soleil">🕑 fixe</button>` +
      `<input type="time" step="300" value="${esc(a.time)}" data-act="time" data-edge="${edge}">`
    );
  }

  _inspectorHtml(day) {
    const clips = this._clips(day);
    if (this._sel == null || !clips[this._sel]) return "";
    const clip = clips[this._sel];
    const mix = this._config.mixes[this._mixId(day)];
    const def = mix ? mix.jitter_default : 20;
    return `
      <div class="insp">
        <div class="insp-head">
          <b>${esc(this._friendly(clip.entity_id))}</b>
          <span><span class="lnk" data-act="del">Supprimer</span> · <span class="lnk" data-act="close">fermer</span></span>
        </div>
        <div class="insp-row"><label>Début</label>${this._edgeControlsHtml(clip, "start")}</div>
        <div class="insp-row"><label>Fin</label>${this._edgeControlsHtml(clip, "end")}</div>
        <div class="insp-row"><label>Modèle</label>
          <select data-act="timing">${this._timingOptions(null, "— appliquer un modèle —")}</select>
        </div>
        <div class="insp-row"><label>Swing</label><input type="number" min="0" max="90" step="5" value="${clip.jitter ?? ""}" placeholder="${def}" data-act="jitter"> min <span>(vide = défaut du mix : ${def})</span></div>
      </div>`;
  }

  _bindInspector(root, day) {
    const clips = this._clips(day);
    const clip = this._sel != null ? clips[this._sel] : null;
    if (!clip) return;
    root.querySelectorAll(".insp [data-act]").forEach((el) => {
      const act = el.dataset.act;
      const edge = el.dataset.edge;
      if (act === "type") el.addEventListener("click", () => this._setEdgeType(clip, edge, clip[edge].type === "sun" ? "fixed" : "sun", day));
      else if (act === "event") el.addEventListener("change", () => this._setEdgeEvent(clip, edge, el.value, day));
      else if (act === "off") el.addEventListener("change", () => this._setEdgeOffset(clip, edge, el.value));
      else if (act === "time") el.addEventListener("change", () => this._setEdgeTime(clip, edge, el.value));
      else if (act === "jitter") el.addEventListener("change", () => this._setJitter(clip, el.value));
      else if (act === "timing") el.addEventListener("change", () => { if (el.value) this._applyTiming(clip, el.value); });
      else if (act === "del") el.addEventListener("click", () => { this._sel = null; this._removeTrack(clip.entity_id, day); });
      else if (act === "close") el.addEventListener("click", () => { this._sel = null; this._render(); });
    });
  }

  _timingOptions(selected, placeholder) {
    const opts = (this._timings || []).map(
      (t) => `<option value="${esc(t.id)}"${t.id === selected ? " selected" : ""}>${esc(t.name)}</option>`
    );
    if (placeholder) opts.unshift(`<option value="">${esc(placeholder)}</option>`);
    return opts.join("");
  }

  _timingHint(id) {
    const t = this._timing(id);
    return t && t.hint ? t.hint : "";
  }

  _addDomains() {
    return ["light", "switch", "media_player", "fan", "input_boolean"];
  }

  /** Entity chooser: ha-entity-picker when it's loaded, else a native select. */
  _appendPicker(container, day) {
    if (customElements.get("ha-entity-picker")) {
      const picker = document.createElement("ha-entity-picker");
      picker.hass = this._hass;
      picker.includeDomains = this._addDomains();
      picker.allowCustomEntity = false;
      picker.addEventListener("value-changed", (ev) => {
        const v = ev.detail && ev.detail.value;
        if (v) {
          picker.value = "";
          this._addTrack(v, day);
        }
      });
      container.appendChild(picker);
      return;
    }

    // Fallback: a native <select>, always available even if HA hasn't lazy-loaded
    // ha-entity-picker on this page yet.
    const domains = this._addDomains();
    const used = new Set(this._clips(day).map((c) => c.entity_id));
    const ids = Object.keys(this._hass.states)
      .filter((id) => domains.includes(id.split(".")[0]) && !used.has(id))
      .sort();
    const sel = document.createElement("select");
    sel.innerHTML =
      '<option value="">— choisir une entité —</option>' +
      ids
        .map((id) => `<option value="${esc(id)}">${esc(this._friendly(id))}</option>`)
        .join("");
    sel.addEventListener("change", () => {
      if (sel.value) this._addTrack(sel.value, day);
    });
    container.appendChild(sel);
  }

  _render() {
    if (!this._data || !this._data.days || !this._data.days.length) {
      this._renderError({ message: "Aucun séjour à afficher (vérifie les dates du séjour)." });
      return;
    }
    const day = this._data.days[this._selected];
    if (this._edit && this._config) {
      this._renderEdit(day);
      return;
    }
    // day.date est une date nue (« 2026-08-30 ») : parseLocal(), qui attend un
    // horodatage « …THH:MM », la réduisait à une chaîne vide et le libellé
    // valait « / » depuis la toute première version de la carte.
    const dateLabel = `${day.date.slice(8)}/${day.date.slice(5, 7)}`;
    const armed = this._data.armed;
    // Les écritures (peinture d'un jour, édition, absence) sont réservées aux
    // admins côté serveur : inutile d'offrir des boutons qui échoueront.
    const admin = this._isAdmin();
    const mixOpts = ['<option value="__auto__">Auto (règle)</option>']
      .concat(Object.keys(this._data.mixes).map((id) => `<option value="${id}">${this._data.mixes[id].name}</option>`))
      .join("");

    this._root().innerHTML = `
      <style>
        ha-card { padding: 12px 14px; }
        .head { display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap; }
        .title { font-weight:600; display:flex; align-items:center; gap:8px; }
        .pill { font-size:11px; font-weight:600; border-radius:999px; padding:2px 8px; cursor:pointer; border:1px solid; }
        .on { color:#0f766e; background:rgba(20,184,166,.16); border-color:rgba(20,184,166,.45); }
        .off { color:var(--secondary-text-color); background:var(--secondary-background-color); border-color:var(--divider-color); }
        .nav { display:flex; align-items:center; gap:6px; }
        .nav button, .btn { cursor:pointer; border:1px solid var(--divider-color); background:var(--card-background-color); color:var(--primary-text-color); border-radius:8px; height:30px; min-width:30px; padding:0 8px; font-size:13px; }
        .dsel { text-align:center; min-width:120px; font-size:12px; }
        .dsel b { color:var(--primary-text-color); }
        .mix { font-size:11px; color:var(--secondary-text-color); }
        .paint { display:flex; align-items:center; gap:8px; margin-top:8px; font-size:12px; color:var(--secondary-text-color); }
        .paint select { border:1px solid var(--divider-color); background:var(--card-background-color); color:var(--primary-text-color); border-radius:6px; padding:3px 6px; font-size:12px; }
        .onb { margin-top:10px; border:1px solid #14b8a6; background:rgba(20,184,166,.08); border-radius:10px; padding:10px 14px; font-size:13px; color:var(--primary-text-color); }
        .onb ol { margin:8px 0 0; padding-left:20px; line-height:1.9; }
        .onb .btn { margin-left:6px; height:28px; }
        .abs { margin-top:10px; }
        .absbtn { width:100%; text-align:left; cursor:pointer; border:1px solid var(--divider-color); background:var(--secondary-background-color); color:var(--primary-text-color); border-radius:8px; padding:6px 10px; font-size:12px; font-weight:600; }
        .absbtn.ended { border-color:var(--warning-color,#b45309); color:var(--warning-color,#b45309); background:rgba(245,158,11,.10); }
        .abspanel { border:1px solid var(--divider-color); border-top:none; border-radius:0 0 8px 8px; padding:10px 12px; }
        .absrow { display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-top:8px; font-size:12px; color:var(--secondary-text-color); }
        .absrow > label { min-width:52px; }
        .absrow input, .absrow select, .absitem select { border:1px solid var(--divider-color); background:var(--card-background-color); color:var(--primary-text-color); border-radius:6px; padding:3px 6px; font-size:12px; }
        .absrow input[type=number] { width:60px; }
        .absactions { justify-content:flex-end; margin-top:12px; }
        .abslist { margin-top:8px; display:flex; flex-direction:column; gap:4px; }
        .absitem { display:flex; align-items:center; gap:6px; font-size:12px; color:var(--primary-text-color); }
        .absnum { display:inline-flex; align-items:center; justify-content:center; width:18px; height:18px; border-radius:50%; background:var(--secondary-background-color); font-size:10px; font-weight:700; }
        .absname { flex:1; }
        .absgrid { display:flex; flex-wrap:wrap; gap:6px; margin-top:8px; }
        .absday { display:flex; align-items:center; gap:4px; font-size:11px; color:var(--secondary-text-color); }
        .absday select { border:1px solid var(--divider-color); background:var(--card-background-color); color:var(--primary-text-color); border-radius:6px; padding:2px 4px; font-size:11px; }
        .absnote { font-size:11px; color:var(--secondary-text-color); }
        .absbad { font-size:11px; color:var(--error-color,#c0392b); font-weight:600; }
        .tbtn { cursor:pointer; border:1px solid var(--divider-color); background:var(--secondary-background-color); color:var(--primary-text-color); border-radius:6px; padding:2px 6px; font-size:11px; }
        .tbtn[disabled] { opacity:.35; cursor:default; }
        .btn.primary { background:#14b8a6; border-color:#14b8a6; color:#fff; font-weight:600; }
        .btn[disabled] { opacity:.45; cursor:default; }
        .macro { margin:10px 0; }
        .blocks { display:flex; gap:3px; margin-bottom:3px; }
        .blk { border-radius:5px; padding:3px 4px; font-size:11px; font-weight:600; color:#fff; text-align:center; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .days { display:flex; gap:3px; }
        .day { flex:1; cursor:pointer; border:1px solid var(--divider-color); border-top-width:3px; border-radius:6px; background:var(--card-background-color); color:var(--primary-text-color); padding:5px 0; font-size:11px; }
        .day.sel { outline:2px solid var(--primary-text-color); outline-offset:1px; font-weight:700; }
        .legend { display:flex; flex-wrap:wrap; gap:12px; margin-top:6px; font-size:11px; color:var(--secondary-text-color); align-items:center; }
        .legend span { display:inline-flex; align-items:center; gap:5px; }
        .sw { width:16px; height:11px; border-radius:2px; display:inline-block; }
        text.tl { fill: var(--primary-text-color); font: 12px var(--paper-font-body1_-_font-family, sans-serif); }
        text.tm { fill: var(--secondary-text-color); font: 11px var(--paper-font-body1_-_font-family, sans-serif); }
      </style>
      <ha-card>
        <div class="head">
          <div class="title">
            🏠🕵️ House Agent Kevin
            <span class="pill ${armed ? "on" : "off"}" id="arm">${armed ? "Armé" : "Désarmé"}</span>
          </div>
          <div class="nav">
            <button id="prev">‹</button>
            <div class="dsel"><b>${dateLabel}</b><div class="mix">${day.mix_name}</div></div>
            <button id="next">›</button>
            <button class="btn" id="regen" title="Re-tirer les aléas">⟳</button>
            ${admin ? `<button class="btn" id="edit" title="Éditer les scénarios">✎</button>` : ""}
          </div>
        </div>
        ${this._absenceHtml()}
        ${this._onboardingHtml(admin)}
        ${admin ? `<div class="paint"><i class="mdi mdi-brush"></i>Mix du ${dateLabel} :<select id="mixpick">${mixOpts}</select><span>pinceau</span></div>` : ""}
        <div class="macro">${this._macro()}</div>
        ${this._svg(day)}
        <div class="legend">
          <span><i class="sw" style="background:#14b8a6"></i>Piloté par Kevin</span>
          <span><i class="sw" style="background:#6366f1;opacity:.4"></i>Transition coucher (séjour)</span>
          <span><i class="sw" style="background:#1e3a8a;opacity:.3"></i>Nuit</span>
          <span><i class="sw" style="border-radius:50%;background:#0f766e;transform:rotate(45deg)"></i>Événement ponctuel</span>
        </div>
      </ha-card>`;

    const root = this._root();
    root.getElementById("prev").onclick = () => { this._selected = (this._selected + this._data.days.length - 1) % this._data.days.length; this._render(); };
    root.getElementById("next").onclick = () => { this._selected = (this._selected + 1) % this._data.days.length; this._render(); };
    root.getElementById("regen").onclick = () => this._regenerate();
    root.getElementById("arm").onclick = () => this._toggleArm();
    root.querySelectorAll(".day").forEach((btn) => {
      btn.onclick = () => { this._selected = +btn.dataset.i; this._render(); };
    });
    this._bindAbsence(root);

    const editBtn = root.getElementById("edit");
    if (editBtn) editBtn.onclick = () => this._enterEdit();
    const onbEdit = root.getElementById("onbedit");
    if (onbEdit) onbEdit.onclick = () => this._enterEdit();

    const pick = root.getElementById("mixpick");
    if (pick) {
      pick.value = day.overridden ? day.mix : "__auto__";
      pick.onchange = async (ev) => {
        const v = ev.target.value;
        await this._hass.connection.sendMessagePromise({
          type: "kevin/set_override",
          date: day.date,
          mix: v === "__auto__" ? null : v,
        });
        await this._load();
      };
    }
  }
}

// Le panneau de la barre latérale : une barre d'en-tête (avec le bouton menu
// sur mobile) et la carte elle-même, en pleine largeur. Home Assistant lui
// passe `hass`, `narrow` et `panel` comme à tout panneau personnalisé.
class HouseAgentKevinPanel extends HTMLElement {
  set hass(hass) {
    this._hass = hass;
    if (!this._card) this._build();
    this._card.hass = hass;
    if (this._menu) this._menu.hass = hass;
  }

  set narrow(narrow) {
    this._narrow = narrow;
    if (this._menu) this._menu.narrow = narrow;
  }

  set panel(panel) {
    this._panel = panel;
  }

  _build() {
    const root = this.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>
        :host { display:block; min-height:100%; background:var(--primary-background-color); }
        .toolbar { display:flex; align-items:center; gap:4px; height:var(--header-height,56px); padding:0 12px; box-sizing:border-box;
          background:var(--app-header-background-color, var(--primary-color)); color:var(--app-header-text-color, #fff);
          border-bottom:var(--app-header-border-bottom, none); font-size:20px; }
        .wrap { max-width:1100px; margin:0 auto; padding:16px; box-sizing:border-box; }
        house-agent-kevin-card { display:block; }
      </style>
      <div class="toolbar"><span id="menu"></span><span>House Agent Kevin</span></div>
      <div class="wrap"></div>`;
    if (customElements.get("ha-menu-button")) {
      this._menu = document.createElement("ha-menu-button");
      this._menu.hass = this._hass;
      this._menu.narrow = this._narrow;
      root.getElementById("menu").appendChild(this._menu);
    }
    this._card = document.createElement("house-agent-kevin-card");
    this._card.setConfig({});
    root.querySelector(".wrap").appendChild(this._card);
  }
}

if (!customElements.get("house-agent-kevin-card")) {
  customElements.define("house-agent-kevin-card", HouseAgentKevinCard);
}
if (!customElements.get("house-agent-kevin-panel")) {
  customElements.define("house-agent-kevin-panel", HouseAgentKevinPanel);
}
window.customCards = window.customCards || [];
if (!window.customCards.some((c) => c.type === "house-agent-kevin-card")) {
  window.customCards.push({
    type: "house-agent-kevin-card",
    name: "House Agent Kevin",
    description: "Preview the presence-simulation plan: séjour timeline, evening mix and sun layer.",
  });
}
console.info("%c House Agent Kevin card loaded", "color:#14b8a6");
