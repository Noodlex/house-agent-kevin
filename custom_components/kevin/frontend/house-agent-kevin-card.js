// House Agent Kevin — Lovelace preview card.
// Read-only previewer: séjour plan (macro) + evening mix (micro) + sun transition
// layer. Fetches the plan over the WebSocket API (kevin/get_plan). No build step:
// a plain custom element rendering SVG. Drag-to-edit comes in a later phase.

const PALETTE = ["#14b8a6", "#8b5cf6", "#f59e0b", "#ec4899", "#3b82f6", "#10b981", "#f43f5e"];

const LEFT = 150;
const RIGHT = 635;
const WIDTH = RIGHT - LEFT;      // px for the 16:00 -> 02:00 window
const SPAN_MIN = 600;            // 10 hours
const START_MIN = 16 * 60;

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

  async _load() {
    try {
      this._data = await this._hass.connection.sendMessagePromise({ type: "kevin/get_plan" });
      if (this._selected == null) this._selected = this._defaultIndex();
      this._render();
    } catch (err) {
      this._renderError(err);
    }
  }

  _defaultIndex() {
    const days = (this._data && this._data.days) || [];
    if (!days.length) return 0;
    const today = new Date().toISOString().slice(0, 10);
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
    const msg = err && err.message ? err.message : "House Agent Kevin is not set up yet.";
    this._root().innerHTML = `<ha-card header="House Agent Kevin"><div style="padding:16px;color:var(--error-color,#c00)">${msg}</div></ha-card>`;
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
    return LEFT + (v / SPAN_MIN) * WIDTH;
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
    const y0 = 30;
    const rowH = 24;
    const nRows = ref.length + kev.length;
    const bottom = y0 + nRows * rowH;
    const H = bottom + 44;
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
    parts.push(`<svg viewBox="0 0 680 ${H}" width="100%" role="img">`);
    // sun layers
    parts.push(`<rect x="${LEFT}" y="22" width="${bandL - LEFT}" height="${bottom - 22}" fill="#facc15" fill-opacity="0.10"/>`);
    parts.push(`<rect x="${bandL}" y="22" width="${bandR - bandL}" height="${bottom - 22}" fill="#6366f1" fill-opacity="0.18"/>`);
    parts.push(`<rect x="${bandR}" y="22" width="${RIGHT - bandR}" height="${bottom - 22}" fill="#1e3a8a" fill-opacity="0.20"/>`);
    // hour grid + labels
    for (let h = 16; h <= 26; h++) {
      const x = this._xForMin(h * 60);
      parts.push(`<line x1="${x}" y1="22" x2="${x}" y2="${bottom}" stroke="var(--divider-color,#ddd)" stroke-opacity="0.5"/>`);
      parts.push(`<text x="${x}" y="14" text-anchor="middle" class="tm">${h % 24}h</text>`);
    }
    // sunset marker
    parts.push(`<line x1="${sunX}" y1="22" x2="${sunX}" y2="${bottom}" stroke="#f97316" stroke-width="1.5" stroke-dasharray="3 3"/>`);
    parts.push(`<circle cx="${sunX}" cy="26" r="4" fill="#f97316"/>`);
    parts.push(`<text x="${sunX + 7}" y="30" class="tm" fill="#c2410c">coucher ${sunLabel}</text>`);
    // safety off marker
    if (safetyEnd) {
      const sx = this._xForIso(safetyEnd, day.date);
      parts.push(`<line x1="${sx}" y1="22" x2="${sx}" y2="${bottom}" stroke="var(--secondary-text-color,#888)" stroke-dasharray="2 3"/>`);
    }
    // reference rows (grey — already automated, not controlled by Kevin)
    let row = 0;
    ref.forEach((tr) => {
      const cy = y0 + row * rowH + 12;
      row += 1;
      parts.push(`<text x="8" y="${cy + 4}" class="tm">${tr.name}</text>`);
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
        if (p.label) parts.push(`<text x="${x + 9}" y="${cy + 4}" class="tm">${p.label}</text>`);
      }
    });
    if (ref.length) {
      const sepY = y0 + ref.length * rowH;
      parts.push(`<line x1="8" y1="${sepY}" x2="${RIGHT}" y2="${sepY}" stroke="var(--divider-color,#ccc)" stroke-dasharray="2 3"/>`);
    }
    // Kevin rows (turquoise — controlled)
    kev.forEach((tr) => {
      const cy = y0 + row * rowH + 12;
      row += 1;
      parts.push(`<text x="8" y="${cy + 4}" class="tl">${this._friendly(tr.eid)}</text>`);
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
    parts.push(`<text x="${LEFT}" y="${bottom + 22}" class="tm">Bande violette = le coucher tombe ici selon la date du séjour.</text>`);
    parts.push(`</svg>`);
    return parts.join("");
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

  _render() {
    if (!this._data || !this._data.days || !this._data.days.length) {
      this._renderError({ message: "Aucun séjour à afficher (vérifie les dates du preset)." });
      return;
    }
    const day = this._data.days[this._selected];
    const p = parseLocal(day.date);
    const dateLabel = `${p.date.slice(8)}/${p.date.slice(5, 7)}`;
    const armed = this._data.armed;
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
          </div>
        </div>
        <div class="paint"><i class="mdi mdi-brush"></i>Mix du ${dateLabel} :<select id="mixpick">${mixOpts}</select><span>pinceau</span></div>
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
    const pick = root.getElementById("mixpick");
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

customElements.define("house-agent-kevin-card", HouseAgentKevinCard);
window.customCards = window.customCards || [];
window.customCards.push({
  type: "house-agent-kevin-card",
  name: "House Agent Kevin",
  description: "Preview the presence-simulation plan: séjour timeline, evening mix and sun layer.",
});
console.info("%c House Agent Kevin card loaded", "color:#14b8a6");
