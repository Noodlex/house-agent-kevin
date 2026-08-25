// House Agent Kevin — Lovelace preview card.
// Read-only previewer: séjour plan (macro) + evening mix (micro) + sun transition
// layer. Fetches the plan over the WebSocket API (kevin/get_plan). No build step:
// a plain custom element rendering SVG. Drag-to-edit comes in a later phase.

const PALETTE = ["#14b8a6", "#8b5cf6", "#f59e0b", "#ec4899", "#3b82f6", "#10b981", "#f43f5e"];

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

  // ---- edit mode -------------------------------------------------------- //

  _mixId(day) {
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
    this._edit = true;
    this._dirty = false;
    this._sel = null;
    this._render();
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
      await this._hass.connection.sendMessagePromise({
        type: "kevin/update_config",
        config: this._config,
      });
    }
    this._edit = false;
    this._config = null;
    await this._load();
  }

  _addTrack(entityId, day) {
    if (!entityId) return;
    const mix = this._config.mixes[this._mixId(day)];
    if (!mix || mix.clips.some((c) => c.entity_id === entityId)) return;
    mix.clips.push({
      entity_id: entityId,
      start: { type: "sun", event: "sunset", offset: 0 },
      end: { type: "sun", event: "sunset", offset: 120 },
    });
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
    const mix = this._config.mixes[mixId];
    // Editing a mix propagates to every day the plan assigns to it.
    const affected = this._data.days.filter((d) => d.mix === mixId);
    const n = affected.length;
    const dates = affected.map((d) => `${d.date.slice(8)}/${d.date.slice(5, 7)}`);
    const datesLabel = dates.length > 8 ? dates.slice(0, 8).join(", ") + "…" : dates.join(", ");
    root.innerHTML = `
      <style>
        ha-card { padding: 12px 14px; }
        .head { display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap; }
        .title { font-weight:600; color:var(--primary-text-color); }
        .btn { cursor:pointer; border:1px solid var(--divider-color); background:var(--card-background-color); color:var(--primary-text-color); border-radius:8px; height:32px; padding:0 12px; font-size:13px; }
        .btn.primary { background:#14b8a6; border-color:#14b8a6; color:#fff; font-weight:600; }
        .affected { font-size:11px; color:#0f766e; margin:4px 0 0; font-weight:600; }
        .hint { font-size:11px; color:var(--secondary-text-color); margin:6px 0 4px; }
        .add { display:flex; align-items:center; gap:10px; margin-top:8px; font-size:12px; color:var(--secondary-text-color); }
        .add span:last-child { flex:1; }
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
          <div class="title">✎ Édition — ${esc(mix ? mix.name : day.mix)}</div>
          <div>
            <button class="btn" id="cancel">Annuler</button>
            <button class="btn primary" id="save">Enregistrer</button>
          </div>
        </div>
        <div class="affected" title="${esc(dates.join(", "))}">
          S'applique à ${n} jour${n > 1 ? "s" : ""} du séjour${n ? ` : ${esc(datesLabel)}` : ""}
        </div>
        <div class="hint">
          Glisse un clip pour le déplacer (poignées = début/fin, aimanté à 5 min), ou <b>clique-le</b> pour l'éditer finement.
          ✕ retire la piste.
        </div>
        <div id="svgwrap">${this._svgEdit(day)}</div>
        ${this._inspectorHtml(day)}
        <div class="add"><span>Ajouter une piste :</span><span id="pickwrap"></span></div>
      </ha-card>`;

    root.getElementById("cancel").onclick = () => this._exitEdit(false);
    root.getElementById("save").onclick = () => this._exitEdit(true);
    this._bindDrag(root, day);
    this._bindInspector(root, day);
    this._appendPicker(root.getElementById("pickwrap"), day);
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
      else if (act === "del") el.addEventListener("click", () => { this._sel = null; this._removeTrack(clip.entity_id, day); });
      else if (act === "close") el.addEventListener("click", () => { this._sel = null; this._render(); });
    });
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
            <button class="btn" id="edit" title="Éditer le mix de ce jour">✎</button>
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
    root.getElementById("edit").onclick = () => this._enterEdit();
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
