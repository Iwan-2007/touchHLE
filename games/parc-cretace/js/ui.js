/* Crétacé Park — user interface: HUD, bottom bar, panels (marché, labo ADN, créatures, bâtiments,
   missions, cartes, collection, parcs, options), modals, story dialogs, placement bar, contextual
   action bar, title screen, launch intro and the original CRÉTACÉ PARK logo (PC.LOGO).
   Owned by the ui agent. Every call into another module is guarded (they may be missing). */
(function (PC) {
  'use strict';
  const UI = PC.UI = PC.UI || {};
  const LOGO = PC.LOGO = PC.LOGO || {};
  const H = (PC.ART && PC.ART.helpers) || null;
  const TAU = Math.PI * 2;

  // ===========================================================================
  // Small utilities
  // ===========================================================================
  const D = () => PC.DATA || {};
  const S = () => (PC.ENGINE && PC.ENGINE.state) || null;
  const has = fn => !!(PC.ENGINE && typeof PC.ENGINE[fn] === 'function');
  /** Guarded engine call: returns undefined when the function is missing or throws. */
  function ecall(fn, ...args) {
    if (!has(fn)) return undefined;
    try { return PC.ENGINE[fn](...args); } catch (e) { console.error('ENGINE.' + fn, e); return undefined; }
  }
  const okRes = r => r === true || (r && typeof r === 'object' && r.ok);
  function now() { try { return PC.ENGINE && PC.ENGINE.now ? PC.ENGINE.now() : Date.now(); } catch (e) { return Date.now(); } }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = t => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
  const DPR = () => Math.min(2, window.devicePixelRatio || 1);
  function cur() { const s = S(); return (s && s.current) || 'land'; }
  function park(id) { return (D().PARKS || {})[id || cur()] || { id: id || 'land', name: 'Parc', food: 'food_land', foodName: 'Nourriture' }; }

  /** h('div.a.b', {attrs, onclick, text, html, style}, ...children) → element. */
  function h(tag, a, ...kids) {
    const parts = String(tag).split('.');
    const n = document.createElement(parts[0] || 'div');
    if (parts.length > 1) n.className = parts.slice(1).join(' ');
    if (a != null && (typeof a !== 'object' || a.nodeType || Array.isArray(a))) { kids.unshift(a); a = null; }
    if (a) {
      for (const k in a) {
        const v = a[k];
        if (v == null || v === false) continue;
        if (k === 'class') n.className += (n.className ? ' ' : '') + v;
        else if (k === 'style' && typeof v === 'object') Object.assign(n.style, v);
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') n.addEventListener(k.slice(2), v);
        else if (k === 'text') n.textContent = v;
        else if (k === 'html') n.innerHTML = v;
        else if (k === 'disabled') n.disabled = !!v;
        else n.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const c of kids.flat(Infinity)) if (c != null && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c)));
    return n;
  }
  UI.h = h;

  // ---------- Formatting (French) ----------
  const NF = (() => { try { return new Intl.NumberFormat('fr-FR'); } catch (e) { return null; } })();
  function fmt(n) {
    n = Math.floor(+n || 0);
    const s = NF ? NF.format(n) : String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return s.replace(/[   ]/g, ' ');
  }
  function fmtShort(n) {
    n = Math.floor(+n || 0);
    if (n >= 1e7) return Math.floor(n / 1e6) + ' M';
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace('.', ',') + ' M';
    if (n >= 1e5) return Math.floor(n / 1000) + ' k';
    return fmt(n);
  }
  /** Remaining time: 42 s, 4:05, 1 h 20, 2 j 3 h. */
  function fmtTime(sec) {
    sec = Math.max(0, Math.ceil(sec));
    if (sec < 60) return sec + ' s';
    if (sec < 3600) return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
    if (sec < 86400) return Math.floor(sec / 3600) + ' h ' + String(Math.floor(sec % 3600 / 60)).padStart(2, '0');
    return Math.floor(sec / 86400) + ' j ' + Math.floor(sec % 86400 / 3600) + ' h';
  }
  /** A duration label: 30 s, 5 min, 2 h, 1 h 30. */
  function fmtDur(sec) {
    sec = Math.round(sec);
    if (sec < 60) return sec + ' s';
    if (sec < 3600) return Math.round(sec / 60) + ' min';
    const hh = Math.floor(sec / 3600), mm = Math.round(sec % 3600 / 60);
    return hh + ' h' + (mm ? ' ' + String(mm).padStart(2, '0') : '');
  }
  const plural = (n, one, many) => (n > 1 ? many : one);
  /** « du Vélociraptor » / « de l’Archélon ». */
  const du = name => (/^[aeiouyéèêâîôhAEIOUYÉÈÊÂÎÔH]/.test(name) ? 'de l’' + name : 'du ' + name);
  UI.fmt = fmt; UI.fmtTime = fmtTime; UI.fmtDur = fmtDur;

  const RES_KEYS = ['coins', 'dollars', 'food_land', 'food_sea', 'food_ice', 'xp'];
  const resIcon = k => (k === 'xp' ? 'xp' : ((D().RESOURCES || {})[k] || {}).icon || k);
  const resName = k => (k === 'xp' ? 'XP' : ((D().RESOURCES || {})[k] || {}).name || k);
  const RES_COLOR = { coins: '#ffd23a', dollars: '#8fe04a', food_land: '#9be05a', food_sea: '#7fd0ff', food_ice: '#ff9a8a', xp: '#7fd0ff' };

  // ---------- Per-viewer UI memory (never game state) ----------
  const store = {
    key: 'cretace-park-ui', d: null,
    load() { if (this.d) return this.d; try { this.d = JSON.parse(localStorage.getItem(this.key) || '{}') || {}; } catch (e) { this.d = {}; } return this.d; },
    get(k, def) { const d = this.load(); return k in d ? d[k] : def; },
    set(k, v) { const d = this.load(); d[k] = v; try { localStorage.setItem(this.key, JSON.stringify(d)); } catch (e) { /* storage blocked */ } },
  };

  // ---------- Sound & music (PC.SFX / PC.MUSIC from audio.js, optional) ----------
  function settings() { const s = S(); return (s && s.settings) || {}; }
  UI.sfx = function (name) {
    if (settings().sound === false) return;
    try { if (PC.SFX && PC.SFX.play) PC.SFX.play(name); } catch (e) { /* audio optional */ }
  };
  let musicTrack = null;
  UI.music = function (track) {
    musicTrack = track;
    if (!PC.MUSIC) return;
    try {
      if (settings().music === false) { if (PC.MUSIC.stop) PC.MUSIC.stop(); return; }
      if (PC.MUSIC.play) PC.MUSIC.play(track);
    } catch (e) { /* audio optional */ }
  };
  UI.parkTrack = p => 'park_' + (p || cur());
  /** Push the Musique / Sons toggles to the audio module. */
  UI.applyAudioSettings = function () {
    const st = settings();
    try { if (PC.MUSIC && PC.MUSIC.setEnabled) PC.MUSIC.setEnabled(st.music !== false); } catch (e) { /* */ }
    try { if (PC.SFX && PC.SFX.setEnabled) PC.SFX.setEnabled(st.sound !== false); } catch (e) { /* */ }
    if (st.music !== false && musicTrack) UI.music(musicTrack);
  };
  const sfx = UI.sfx;

  // ===========================================================================
  // Icons — original UI icons drawn on small canvases (same 22-unit box as PC.ICONS)
  // ===========================================================================
  function rr(c, x, y, w, hh, r) {
    c.beginPath();
    c.moveTo(x + r, y); c.lineTo(x + w - r, y); c.quadraticCurveTo(x + w, y, x + w, y + r);
    c.lineTo(x + w, y + hh - r); c.quadraticCurveTo(x + w, y + hh, x + w - r, y + hh);
    c.lineTo(x + r, y + hh); c.quadraticCurveTo(x, y + hh, x, y + hh - r);
    c.lineTo(x, y + r); c.quadraticCurveTo(x, y, x + r, y); c.closePath();
  }
  const lin = (c, x0, y0, x1, y1, st) => { const g = c.createLinearGradient(x0, y0, x1, y1); st.forEach(s => g.addColorStop(s[0], s[1])); return g; };
  const rad = (c, x, y, r0, r1, st, fx, fy) => { const g = c.createRadialGradient(fx == null ? x : fx, fy == null ? y : fy, r0, x, y, r1); st.forEach(s => g.addColorStop(s[0], s[1])); return g; };
  function fs(c, fill, stroke, lw) {
    c.fillStyle = fill; c.fill();
    if (stroke) { c.lineWidth = lw || 1.2; c.strokeStyle = stroke; c.lineJoin = 'round'; c.lineCap = 'round'; c.stroke(); }
  }
  function ell(c, x, y, rx, ry, rot) { c.beginPath(); c.ellipse(x, y, Math.max(0.01, rx), Math.max(0.01, ry), rot || 0, 0, TAU); }
  function poly(c, pts, closed) { c.beginPath(); c.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]); if (closed) c.closePath(); }
  function coreIcon(c, name, x, y, size) { if (PC.ICONS && PC.ICONS.draw) PC.ICONS.draw(c, name, x, y, size); }
  const STEEL_ST = [[0, '#f4f6f7'], [0.45, '#b4bcc3'], [0.55, '#8a939b'], [1, '#d3d8dc']];

  const UIICON = {
    market(c) {
      c.beginPath(); c.rect(-9, -2, 18, 11); fs(c, lin(c, 0, -2, 0, 9, [[0, '#d99a5a'], [1, '#8a5426']]), '#3b220e');
      c.strokeStyle = 'rgba(60,30,10,.5)'; c.lineWidth = 0.8;
      for (const x of [-3, 3]) { c.beginPath(); c.moveTo(x, -2); c.lineTo(x, 9); c.stroke(); }
      c.fillStyle = '#5a3818'; c.fillRect(-9.5, -8, 2, 6); c.fillRect(7.5, -8, 2, 6);
      const aw = () => poly(c, [[-8.5, -12], [8.5, -12], [11.5, -6], [-11.5, -6]], true);
      c.save(); aw(); c.clip(); for (let i = 0; i < 7; i++) { c.fillStyle = i % 2 ? '#f6efe2' : '#e23d2a'; c.fillRect(-12 + i * 3.6, -13, 3.6, 8); } c.restore();
      aw(); c.strokeStyle = '#4a120a'; c.lineWidth = 1.2; c.stroke();
      for (let i = 0; i < 6; i++) { const w = 23 / 6, x = -11.5 + w * i + w / 2; c.beginPath(); c.arc(x, -6, w / 2, 0, Math.PI); fs(c, i % 2 ? '#f6efe2' : '#e23d2a', '#4a120a', 1); }
      c.beginPath(); c.rect(-10.5, -3, 21, 2.6); fs(c, '#f1c27a', '#3b220e', 1);
      coreIcon(c, 'egg', -4, 4, 9); coreIcon(c, 'coin', 4.5, 4.5, 8);
    },
    roads(c) {
      poly(c, [[-3.5, -11], [3.5, -11], [11, 10], [-11, 10]], true);
      fs(c, lin(c, 0, -11, 0, 10, [[0, '#8a929a'], [1, '#3c434a']]), '#15191c', 1.4);
      c.strokeStyle = '#f2f2f2'; c.lineWidth = 1;
      c.beginPath(); c.moveTo(-2.6, -10); c.lineTo(-9.4, 9); c.moveTo(2.6, -10); c.lineTo(9.4, 9); c.stroke();
      c.fillStyle = '#ffd21e';
      [[-9, 0.8, 2.5], [-3.5, 1.1, 3.4], [3, 1.5, 4.6]].forEach(([y, w, l]) => { c.fillRect(-w / 2, y, w, l); });
      // traffic cone
      poly(c, [[7, -3], [9.5, 4], [4.5, 4]], true); fs(c, '#ff7a1a', '#5a2200', 0.9);
      c.fillStyle = '#fff'; c.fillRect(5.8, 0, 2.6, 1.2);
      c.fillStyle = '#3a1a06'; c.fillRect(4, 4, 6, 1.4);
    },
    lab(c) {
      const path = () => { c.beginPath(); c.moveTo(-3, -10); c.lineTo(3, -10); c.lineTo(3, -4); c.lineTo(9.6, 7.5); c.quadraticCurveTo(10.6, 10.5, 7.6, 10.5); c.lineTo(-7.6, 10.5); c.quadraticCurveTo(-10.6, 10.5, -9.6, 7.5); c.lineTo(-3, -4); c.closePath(); };
      ell(c, 0, 6, 12, 7); c.fillStyle = 'rgba(120,255,120,.18)'; c.fill();
      path(); fs(c, 'rgba(210,240,255,.38)', null);
      c.save(); path(); c.clip();
      c.fillStyle = lin(c, 0, 0, 0, 11, [[0, '#b8ff7a'], [1, '#2a9a26']]); c.fillRect(-12, 0.5, 24, 12);
      c.fillStyle = 'rgba(255,255,255,.65)'; [[-3, 5, 1.2], [2, 3, 0.9], [4, 7, 1.4], [-5, 8, 0.8]].forEach(([x, y, r]) => { ell(c, x, y, r, r); c.fill(); });
      c.restore();
      path(); c.strokeStyle = '#173040'; c.lineWidth = 1.4; c.stroke();
      c.beginPath(); c.rect(-4.2, -12, 8.4, 2.6); fs(c, lin(c, 0, -12, 0, -9, STEEL_ST), '#2a3036', 1);
      c.strokeStyle = 'rgba(255,255,255,.7)'; c.lineWidth = 1.2; c.beginPath(); c.moveTo(-1.6, -8); c.lineTo(-1.6, -3.5); c.lineTo(-6.5, 5.5); c.stroke();
      // tiny helix
      c.lineWidth = 1.3;
      for (let i = 0; i < 2; i++) { c.strokeStyle = i ? '#4fc0e8' : '#ff6a9a'; c.beginPath(); for (let y = -2; y <= 9; y += 1) { const x = Math.sin(y / 1.9 + i * Math.PI) * 2.6 + 0.5; if (y === -2) c.moveTo(x, y); else c.lineTo(x, y); } c.stroke(); }
    },
    tournament(c) {
      const sh = () => { c.beginPath(); c.moveTo(0, -11); c.lineTo(9.5, -7.5); c.lineTo(8.6, 2.5); c.quadraticCurveTo(6, 8.5, 0, 11.2); c.quadraticCurveTo(-6, 8.5, -8.6, 2.5); c.lineTo(-9.5, -7.5); c.closePath(); };
      sh(); fs(c, lin(c, -9, -10, 9, 10, [[0, '#ffe680'], [0.5, '#e0a010'], [1, '#8a5a04']]), '#3a2402', 1.3);
      c.save(); c.translate(0, 0.6); c.scale(0.8, 0.8); sh(); c.restore();
      fs(c, rad(c, -2, -4, 1, 13, [[0, '#ff6a50'], [0.6, '#c8200f'], [1, '#6a0802']]), '#3a0402', 1);
      c.lineCap = 'round';
      for (let i = 0; i < 3; i++) {
        const x = -4.2 + i * 4;
        c.strokeStyle = '#3a0402'; c.lineWidth = 3; c.beginPath(); c.moveTo(x + 2.4, -6); c.quadraticCurveTo(x + 1, 0, x - 1.6, 6); c.stroke();
        c.strokeStyle = '#fff6e0'; c.lineWidth = 1.6; c.beginPath(); c.moveTo(x + 2.4, -6); c.quadraticCurveTo(x + 1, 0, x - 1.6, 6); c.stroke();
      }
    },
    cards(c) {
      const C = [[-0.42, '#4f9fe0', '#1f5a94'], [0.42, '#f0b030', '#8a5a06'], [0, '#b06ae0', '#5a2a86']];
      for (const [a, c1, c2] of C) {
        c.save(); c.translate(0, 4); c.rotate(a); c.translate(0, -5);
        rr(c, -5.5, -8.5, 11, 15.5, 2); fs(c, lin(c, -5, -8, 5, 7, [[0, H ? H.shade(c1, 0.3) : c1], [1, c2]]), '#14181b', 1.2);
        rr(c, -4, -7, 8, 12.5, 1.4); c.strokeStyle = 'rgba(255,255,255,.75)'; c.lineWidth = 0.8; c.stroke();
        c.restore();
      }
      coreIcon(c, 'star', 0, -1.5, 9);
    },
    collection(c) {
      c.beginPath(); c.moveTo(0, -5); c.quadraticCurveTo(-6, -9, -11.5, -7); c.lineTo(-11.5, 9); c.quadraticCurveTo(-6, 7, 0, 10.5); c.quadraticCurveTo(6, 7, 11.5, 9); c.lineTo(11.5, -7); c.quadraticCurveTo(6, -9, 0, -5); c.closePath();
      fs(c, '#7a3a1a', '#2a1006', 1.2);
      c.beginPath(); c.moveTo(0, -6.5); c.quadraticCurveTo(-5, -10, -10, -8.5); c.lineTo(-10, 7); c.quadraticCurveTo(-5, 5.8, 0, 8.5); c.closePath(); fs(c, lin(c, -10, 0, 0, 0, [[0, '#fff7e6'], [1, '#d9caa8']]), '#5a4426', 0.9);
      c.beginPath(); c.moveTo(0, -6.5); c.quadraticCurveTo(5, -10, 10, -8.5); c.lineTo(10, 7); c.quadraticCurveTo(5, 5.8, 0, 8.5); c.closePath(); fs(c, lin(c, 0, 0, 10, 0, [[0, '#d9caa8'], [1, '#fff7e6']]), '#5a4426', 0.9);
      c.strokeStyle = 'rgba(90,68,38,.55)'; c.lineWidth = 0.8;
      for (let i = 0; i < 4; i++) { c.beginPath(); c.moveTo(-8.5, -5 + i * 3); c.quadraticCurveTo(-5, -6.2 + i * 3, -1.5, -4.2 + i * 3); c.stroke(); }
      c.fillStyle = '#8a5a2a';
      ell(c, 5, 2.2, 1.8, 2.2); c.fill();
      for (const a of [-0.8, 0, 0.8]) { ell(c, 5 + Math.sin(a) * 3, -1.6 - Math.cos(a) * 1.3, 0.8, 1.6, a); c.fill(); }
    },
    parks(c) {
      const P = [[-11, -8], [-4, -10], [4, -8], [11, -10], [11, 8], [4, 10], [-4, 8], [-11, 10]];
      poly(c, P, true); fs(c, '#e8dcc0', '#3a2a14', 1.2);
      poly(c, [[-11, -8], [-4, -10], [-4, 8], [-11, 10]], true); fs(c, '#8fd06a', null);
      poly(c, [[-4, -10], [4, -8], [4, 10], [-4, 8]], true); fs(c, '#6ac0ea', null);
      poly(c, [[4, -8], [11, -10], [11, 8], [4, 10]], true); fs(c, '#eef4f8', null);
      poly(c, P, true); c.strokeStyle = '#3a2a14'; c.lineWidth = 1.2; c.stroke();
      c.strokeStyle = 'rgba(58,42,20,.5)'; c.lineWidth = 0.8; c.beginPath(); c.moveTo(-4, -10); c.lineTo(-4, 8); c.moveTo(4, -8); c.lineTo(4, 10); c.stroke();
      c.setLineDash([1.6, 1.4]); c.strokeStyle = '#c42a1a'; c.lineWidth = 1.2;
      c.beginPath(); c.moveTo(-8, 6); c.quadraticCurveTo(-2, -4, 2, 2); c.quadraticCurveTo(5, 6, 7, -3); c.stroke(); c.setLineDash([]);
      c.beginPath(); c.moveTo(7, -1); c.quadraticCurveTo(3.6, -6, 7, -8.8); c.quadraticCurveTo(10.4, -6, 7, -1); fs(c, rad(c, 6, -7, 0.5, 5, [[0, '#ff8a7a'], [1, '#c41a10']]), '#4a0602', 1);
      ell(c, 7, -6, 1.1, 1.1); c.fillStyle = '#fff'; c.fill();
    },
    options(c) {
      c.beginPath();
      const n = 8;
      for (let i = 0; i < n * 2; i++) {
        const a0 = (i / (n * 2)) * TAU - Math.PI / 2, r = i % 2 ? 7.6 : 11;
        const a1 = a0 + TAU / (n * 2);
        c.lineTo(Math.cos(a0 + 0.06) * r, Math.sin(a0 + 0.06) * r); c.lineTo(Math.cos(a1 - 0.06) * r, Math.sin(a1 - 0.06) * r);
      }
      c.closePath(); fs(c, lin(c, -10, -10, 10, 10, STEEL_ST), '#1d2328', 1.3);
      ell(c, 0, 0, 5.4, 5.4); fs(c, lin(c, 0, -5, 0, 5, [[0, '#5a646c'], [1, '#c3cad0']]), '#1d2328', 1.1);
      ell(c, 0, 0, 2.6, 2.6); fs(c, '#1d2328', null);
    },
    missions(c) {
      rr(c, -8.5, -9, 17, 20, 2.4); fs(c, lin(c, 0, -9, 0, 11, [[0, '#b07a42'], [1, '#6a4220']]), '#2a1606', 1.2);
      rr(c, -6.5, -6.5, 13, 15.5, 1); fs(c, '#fbf6ea', '#8a7a5a', 0.7);
      rr(c, -4.5, -11, 9, 5, 1.6); fs(c, lin(c, 0, -11, 0, -6, STEEL_ST), '#1d2328', 1);
      for (let i = 0; i < 3; i++) {
        const y = -3 + i * 4.2;
        c.beginPath(); c.rect(-5, y - 1.4, 2.8, 2.8); fs(c, '#fff', '#5a6066', 0.6);
        if (i < 2) { c.strokeStyle = '#2f9a1a'; c.lineWidth = 1.3; c.lineCap = 'round'; c.beginPath(); c.moveTo(-4.8, y); c.lineTo(-3.8, y + 1); c.lineTo(-2, y - 1.6); c.stroke(); }
        c.fillStyle = '#9aa3a8'; c.fillRect(-0.8, y - 0.6, 6, 1.3);
      }
    },
    amber(c) {
      ell(c, 0, 0, 11.5, 11.5); c.fillStyle = rad(c, 0, 0, 1, 12, [[0, 'rgba(170,140,255,.55)'], [1, 'rgba(120,90,255,0)']]); c.fill();
      const P = [[0, -11], [6.5, -5.5], [6.8, 4.5], [0, 11], [-6.8, 4.5], [-6.5, -5.5]];
      poly(c, P, true); fs(c, lin(c, -6, -10, 6, 10, [[0, '#e6dcff'], [0.35, '#9a82ff'], [0.7, '#5a3ee0'], [1, '#2a1a86']]), '#160c4a', 1.3);
      c.save(); poly(c, P, true); c.clip();
      c.lineWidth = 1.5; c.lineCap = 'round';
      for (let i = 0; i < 2; i++) { c.strokeStyle = i ? '#7ff0ff' : '#ffd84a'; c.beginPath(); for (let y = -8; y <= 8; y += 0.8) { const x = Math.sin(y / 2.2 + i * Math.PI) * 2.8; if (y === -8) c.moveTo(x, y); else c.lineTo(x, y); } c.stroke(); }
      c.strokeStyle = 'rgba(255,255,255,.75)'; c.lineWidth = 0.8;
      for (let y = -7; y <= 7; y += 2.2) { const x = Math.sin(y / 2.2) * 2.8; c.beginPath(); c.moveTo(x, y); c.lineTo(-x, y); c.stroke(); }
      poly(c, [[0, -11], [6.5, -5.5], [0, -2], [-6.5, -5.5]], true); c.fillStyle = 'rgba(255,255,255,.28)'; c.fill();
      poly(c, [[-6.8, 4.5], [0, 11], [0, 3]], true); c.fillStyle = 'rgba(20,0,60,.25)'; c.fill();
      c.restore();
      c.strokeStyle = 'rgba(255,255,255,.55)'; c.lineWidth = 0.7; c.beginPath(); c.moveTo(-6.5, -5.5); c.lineTo(0, -2); c.lineTo(6.5, -5.5); c.moveTo(0, -2); c.lineTo(0, 11); c.stroke();
      c.fillStyle = '#fff'; c.beginPath(); c.moveTo(-3.5, -8); c.lineTo(-2.8, -6.2); c.lineTo(-1, -5.5); c.lineTo(-2.8, -4.8); c.lineTo(-3.5, -3); c.lineTo(-4.2, -4.8); c.lineTo(-6, -5.5); c.lineTo(-4.2, -6.2); c.closePath(); c.fill();
    },
    truck(c) {
      rr(c, -11, -7.5, 13.5, 12, 1.2); fs(c, lin(c, 0, -7, 0, 5, [[0, '#ffcf5a'], [1, '#d07a10']]), '#3a2002', 1.2);
      c.strokeStyle = 'rgba(80,40,0,.45)'; c.lineWidth = 0.8; for (const x of [-7.6, -4.2, -0.8]) { c.beginPath(); c.moveTo(x, -6.5); c.lineTo(x, 3.5); c.stroke(); }
      poly(c, [[3, -4.5], [8, -4.5], [11, 0], [11, 4.5], [3, 4.5]], true); fs(c, lin(c, 0, -4, 0, 5, [[0, '#7fc8ff'], [1, '#1f6ab8']]), '#0a2a4a', 1.2);
      poly(c, [[4.6, -3.2], [7.4, -3.2], [9.4, 0], [4.6, 0]], true); fs(c, '#dff4ff', '#0a2a4a', 0.7);
      for (const x of [-6.5, 6.5]) { ell(c, x, 6, 3, 3); fs(c, '#22272b', '#000', 1); ell(c, x, 6, 1.3, 1.3); fs(c, '#b9c1c8', null); }
      coreIcon(c, 'food_land', -4.5, -1.5, 9);
    },
    collect(c) {
      poly(c, [[-10, -2], [10, -2], [7.5, 10], [-7.5, 10]], true); fs(c, lin(c, 0, -2, 0, 10, [[0, '#d99a5a'], [1, '#7a4a20']]), '#3b220e', 1.2);
      c.strokeStyle = 'rgba(60,30,10,.55)'; c.lineWidth = 0.9;
      for (let i = 0; i < 3; i++) { c.beginPath(); c.moveTo(-9.4 + i * 0.6, 1.5 + i * 3); c.lineTo(9.4 - i * 0.6, 1.5 + i * 3); c.stroke(); }
      for (const x of [-5, 0, 5]) { c.beginPath(); c.moveTo(x, -2); c.lineTo(x * 0.8, 10); c.stroke(); }
      coreIcon(c, 'coin', -4, -5, 10); coreIcon(c, 'coin', 3.5, -6.5, 10); coreIcon(c, 'coin', 0, -2.5, 10);
      c.beginPath(); c.rect(-11, -2.8, 22, 2.4); fs(c, '#a8703a', '#3b220e', 1);
    },
    upgrade(c) {
      const P = [[0, -11], [10, -1], [4.5, -1], [4.5, 10.5], [-4.5, 10.5], [-4.5, -1], [-10, -1]];
      poly(c, P, true); fs(c, lin(c, 0, -11, 0, 11, [[0, '#d2ff8a'], [0.5, '#5cbc26'], [1, '#2a7010']]), '#123a04', 1.4);
      poly(c, [[0, -8], [6, -2.2], [0, -4.5], [-6, -2.2]], true); c.fillStyle = 'rgba(255,255,255,.45)'; c.fill();
    },
    move(c) {
      const arrow = a => { c.save(); c.rotate(a); poly(c, [[0, -11.5], [5, -5.5], [2, -5.5], [2, -1.5], [-2, -1.5], [-2, -5.5], [-5, -5.5]], true); fs(c, lin(c, 0, -11, 0, -1, [[0, '#a5dcff'], [1, '#1f6ab8']]), '#0a2a4a', 1.1); c.restore(); };
      for (let i = 0; i < 4; i++) arrow(i * Math.PI / 2);
      ell(c, 0, 0, 3, 3); fs(c, lin(c, 0, -3, 0, 3, STEEL_ST), '#1d2328', 1);
    },
    sell(c) {
      const P = [[-10.5, -1], [-2, -10], [9.5, -10], [9.5, 1.5], [1, 10.5]];
      poly(c, P, true); fs(c, lin(c, -8, -8, 8, 8, [[0, '#fff09a'], [0.5, '#ffc21e'], [1, '#c98a00']]), '#4a3000', 1.3);
      ell(c, 5.5, -6, 1.7, 1.7); fs(c, '#4a3000', null);
      c.save(); c.translate(-0.5, 0.5); c.rotate(-0.78);
      c.fillStyle = '#5a3a00'; c.font = 'bold 11px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('$', 0, 0.5);
      c.restore();
    },
    info(c) {
      ell(c, 0, 0, 10.5, 10.5); fs(c, rad(c, -3, -4, 1, 13, [[0, '#9ad8ff'], [0.6, '#2f86d8'], [1, '#0d3a70']]), '#06203f', 1.3);
      c.fillStyle = '#fff'; ell(c, 0, -5.5, 1.9, 1.9); c.fill();
      rr(c, -1.8, -2, 3.6, 9.5, 1.2); c.fill();
    },
    speed(c) {
      poly(c, [[2.5, -11.5], [-7.5, 1.5], [-0.8, 1.5], [-3.2, 11.5], [7.5, -2], [0.8, -2]], true);
      fs(c, lin(c, 0, -11, 0, 11, [[0, '#fff8b0'], [0.5, '#ffd21e'], [1, '#e08a00']]), '#5a3200', 1.4);
    },
    close(c) {
      c.lineCap = 'round';
      c.strokeStyle = '#4a0602'; c.lineWidth = 6; c.beginPath(); c.moveTo(-6, -6); c.lineTo(6, 6); c.moveTo(6, -6); c.lineTo(-6, 6); c.stroke();
      c.strokeStyle = '#fff'; c.lineWidth = 3.6; c.stroke();
    },
    ok(c) {
      c.lineCap = 'round'; c.lineJoin = 'round';
      c.strokeStyle = '#163c05'; c.lineWidth = 6; c.beginPath(); c.moveTo(-7, 0); c.lineTo(-2, 5.5); c.lineTo(8, -6); c.stroke();
      c.strokeStyle = '#fff'; c.lineWidth = 3.6; c.stroke();
    },
    hammer(c) {
      c.save(); c.rotate(-0.7);
      rr(c, -1.6, -3, 3.2, 15, 1.2); fs(c, lin(c, -2, 0, 2, 0, [[0, '#c98a4a'], [1, '#7a4a1a']]), '#3a2006', 1.1);
      rr(c, -7, -9, 14, 6.5, 1.4); fs(c, lin(c, 0, -9, 0, -2.5, STEEL_ST), '#1d2328', 1.2);
      c.restore();
    },
    music(c) {
      c.fillStyle = '#ffd23a'; c.strokeStyle = '#3a2600'; c.lineWidth = 1.2;
      ell(c, -5, 6, 3.6, 2.8, -0.4); fs(c, '#ffd23a', '#3a2600', 1.2);
      ell(c, 6, 4, 3.6, 2.8, -0.4); fs(c, '#ffd23a', '#3a2600', 1.2);
      c.beginPath(); c.moveTo(-1.8, 5.5); c.lineTo(-1.8, -8); c.lineTo(9.2, -10.5); c.lineTo(9.2, 3.5); c.lineWidth = 2.4; c.strokeStyle = '#3a2600'; c.stroke();
      c.beginPath(); c.moveTo(-1.8, -8); c.lineTo(9.2, -10.5); c.lineTo(9.2, -7); c.lineTo(-1.8, -4.5); c.closePath(); fs(c, '#ffd23a', '#3a2600', 1);
    },
    sound(c) {
      poly(c, [[-10, -3.5], [-5, -3.5], [1, -9], [1, 9], [-5, 3.5], [-10, 3.5]], true); fs(c, lin(c, 0, -9, 0, 9, STEEL_ST), '#1d2328', 1.2);
      c.strokeStyle = '#7fd0ff'; c.lineWidth = 2; c.lineCap = 'round';
      c.beginPath(); c.arc(1, 0, 5, -0.8, 0.8); c.stroke(); c.beginPath(); c.arc(1, 0, 9, -0.8, 0.8); c.stroke();
    },
    help(c) {
      ell(c, 0, 0, 10.5, 10.5); fs(c, rad(c, -3, -4, 1, 13, [[0, '#fff59a'], [0.6, '#ffc21e'], [1, '#a86a00']]), '#4a3000', 1.3);
      c.fillStyle = '#3a2400'; c.font = 'bold 15px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('?', 0, 1);
    },
    restart(c) {
      c.lineCap = 'round';
      c.strokeStyle = '#4a0602'; c.lineWidth = 5.5; c.beginPath(); c.arc(0, 1, 7.5, -2.6, 2.2); c.stroke();
      c.strokeStyle = '#ff6a50'; c.lineWidth = 3; c.stroke();
      poly(c, [[-9.5, -9.5], [-2.5, -6.5], [-9, -1.5]], true); fs(c, '#ff6a50', '#4a0602', 1.1);
    },
    heart(c) {
      c.beginPath(); c.moveTo(0, 9.5); c.bezierCurveTo(-15, -1, -7, -13, 0, -4.5); c.bezierCurveTo(7, -13, 15, -1, 0, 9.5);
      fs(c, rad(c, -3, -4, 1, 13, [[0, '#ff9ab0'], [1, '#d01a4a']]), '#4a0418', 1.2);
    },
    tab_creatures(c) {
      // Original stylised dino head (side view, facing right).
      c.beginPath();
      c.moveTo(-10, 9); c.quadraticCurveTo(-11, -2, -6, -7); c.quadraticCurveTo(0, -11.5, 6, -8.5); c.quadraticCurveTo(10.8, -6.5, 11, -2.5);
      c.quadraticCurveTo(11, 0.5, 8, 1); c.lineTo(-1, 1.6); c.quadraticCurveTo(4, 3, 7, 4.2); c.quadraticCurveTo(7, 7.5, 2, 7.5); c.quadraticCurveTo(-3, 7.5, -5, 9.5); c.closePath();
      fs(c, lin(c, 0, -11, 0, 10, [[0, '#9be05a'], [0.6, '#4c9a2e'], [1, '#2a6a14']]), '#123a06', 1.3);
      c.fillStyle = 'rgba(255,255,255,.85)';
      for (let i = 0; i < 4; i++) { poly(c, [[0 + i * 2, 1.2], [1 + i * 2, 3.2], [2 + i * 2, 1.2]], true); c.fill(); }
      c.fillStyle = 'rgba(18,58,6,.5)'; ell(c, -4, -2, 2.2, 3.4, 0.4); c.fill();
      ell(c, 2, -4.6, 2.3, 2.3); fs(c, '#ffd23a', '#123a06', 0.9);
      ell(c, 2.3, -4.6, 0.7, 1.6); c.fillStyle = '#120a05'; c.fill();
      ell(c, 9, -4, 0.7, 0.5); c.fillStyle = '#123a06'; c.fill();
      c.strokeStyle = '#2a6a14'; c.lineWidth = 1; c.beginPath(); c.moveTo(-1, -8.5); c.lineTo(-0.5, -11); c.lineTo(1.5, -9); c.moveTo(-5, -6.5); c.lineTo(-5.5, -9.5); c.lineTo(-3, -8); c.stroke();
    },
    tab_buildings(c) {
      c.beginPath(); c.rect(-8.5, -3, 17, 13); fs(c, lin(c, 0, -3, 0, 10, [[0, '#f2e6cc'], [1, '#c4ae84']]), '#3a2a14', 1.2);
      poly(c, [[-11, -2.5], [0, -11], [11, -2.5]], true); fs(c, lin(c, 0, -11, 0, -2, [[0, '#7fc8ff'], [1, '#1f6ab8']]), '#0a2a4a', 1.2);
      c.beginPath(); c.rect(-2.5, 3, 5, 7); fs(c, '#8a5426', '#3a2006', 1);
      for (const x of [-6.5, 4]) { c.beginPath(); c.rect(x, 0, 3.2, 3.2); fs(c, '#bfe8ff', '#3a2a14', 0.8); }
      ell(c, 0, -5.2, 1.8, 1.8); fs(c, '#ffd23a', '#3a2600', 0.8);
    },
    tab_deco(c) {
      c.strokeStyle = '#5a3818'; c.lineWidth = 2.6; c.lineCap = 'round';
      c.beginPath(); c.moveTo(1, 10.5); c.quadraticCurveTo(-1, 2, 1.5, -5); c.stroke();
      c.strokeStyle = 'rgba(30,15,5,.55)'; c.lineWidth = 0.7;
      for (let y = 8; y > -4; y -= 2.4) { c.beginPath(); c.moveTo(-0.6, y); c.lineTo(2, y - 0.4); c.stroke(); }
      const leaf = (a, l, col) => { c.save(); c.translate(1.5, -5.5); c.rotate(a); c.beginPath(); c.moveTo(0, 0); c.quadraticCurveTo(l * 0.5, -3, l, 1.5); c.quadraticCurveTo(l * 0.5, -0.6, 0, 0); fs(c, col, '#123a06', 0.9); c.restore(); };
      leaf(-2.6, 10, '#4c9a2e'); leaf(-0.4, 10, '#5fae3a'); leaf(-1.5, 9, '#76c44a'); leaf(Math.PI + 0.5, 9.5, '#5fae3a'); leaf(Math.PI - 0.3, 10, '#4c9a2e');
      ell(c, 0.5, -4.5, 1.3, 1.3); fs(c, '#7a4a1a', null); ell(c, 3, -4, 1.3, 1.3); fs(c, '#7a4a1a', null);
      ell(c, 1, 10.5, 6, 1.6); c.fillStyle = 'rgba(0,0,0,.25)'; c.fill();
    },
    egg_nest(c) { coreIcon(c, 'egg', 0, -1, 20); },
    paw(c) {
      c.fillStyle = '#ffd23a'; c.strokeStyle = '#3a2600'; c.lineWidth = 1.1;
      ell(c, 0, 4, 5, 5.5); fs(c, '#ffd23a', '#3a2600', 1.1);
      for (const a of [-0.9, 0, 0.9]) { ell(c, Math.sin(a) * 7.5, -3.5 - Math.cos(a) * 3, 1.8, 3.8, a); fs(c, '#ffd23a', '#3a2600', 1.1); }
    },
    pause(c) { c.fillStyle = '#fff'; rr(c, -6, -8, 4.4, 16, 1.2); c.fill(); rr(c, 1.6, -8, 4.4, 16, 1.2); c.fill(); },
  };
  UI.UIICONS = UIICON;

  // Extend PC.ICONS so other modules can use the new 'amber' icon too (PC.ICONS.url('amber')).
  (function extendIcons() {
    const IC = PC.ICONS;
    if (!IC || IC._uiExtended || typeof IC.draw !== 'function') return;
    const orig = IC.draw;
    IC.draw = function (ctx, name, x, y, size) {
      if (name === 'amber' && UIICON.amber) {
        ctx.save(); ctx.translate(x, y); ctx.scale(size / 22, size / 22); UIICON.amber(ctx); ctx.restore();
        return;
      }
      return orig.call(IC, ctx, name, x, y, size);
    };
    if (Array.isArray(IC.names) && IC.names.indexOf('amber') < 0) IC.names.push('amber');
    IC._uiExtended = true;
  })();

  const iconCache = new Map();
  /** data: URL for an icon name (UI icons first, then PC.ICONS). */
  function iconURL(name, size) {
    size = size || 32;
    const key = name + '|' + size;
    if (iconCache.has(key)) return iconCache.get(key);
    let url = '';
    if (UIICON[name]) {
      try {
        const c = document.createElement('canvas');
        c.width = c.height = size * 2;
        const x = c.getContext('2d');
        x.translate(size, size); x.scale(size * 2 / 22 * 0.95, size * 2 / 22 * 0.95);
        UIICON[name](x);
        url = c.toDataURL();
      } catch (e) { url = ''; }
    } else if (PC.ICONS && PC.ICONS.url) {
      try { url = PC.ICONS.url(name, size); } catch (e) { url = ''; }
    }
    iconCache.set(key, url);
    return url;
  }
  function icon(name, size, cls) {
    const url = iconURL(name, size || 24);
    return h('img' + (cls ? '.' + cls : ''), { src: url || 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', width: size || 24, height: size || 24, alt: '', draggable: 'false' });
  }
  UI.iconURL = iconURL; UI.icon = icon;

  /** Canvas → cached data URL (portraits, thumbnails) so cards can use plain <img>. */
  const imgURLCache = new WeakMap();
  function canvasURL(cv) {
    if (!cv) return '';
    if (imgURLCache.has(cv)) return imgURLCache.get(cv);
    let u = '';
    try { u = cv.toDataURL(); } catch (e) { u = ''; }
    imgURLCache.set(cv, u);
    return u;
  }
  function portraitURL(id, w, hh, o) {
    if (!PC.ART || !PC.ART.portrait) return '';
    try { return canvasURL(PC.ART.portrait(id, w, hh, o)); } catch (e) { return ''; }
  }
  function thumbURL(artId, w, hh) {
    if (!PC.BUILD_ART || !PC.BUILD_ART.thumb) return '';
    try { return canvasURL(PC.BUILD_ART.thumb(artId, w, hh)); } catch (e) { return ''; }
  }

  /** Reward / cost chips. sign: '+' for gains. */
  function chips(obj, sign, size) {
    const w = h('span.chips');
    if (!obj) return w;
    for (const k of RES_KEYS) if (obj[k]) w.append(h('span.chip', icon(resIcon(k), size || 24), h('b', (sign || '') + fmt(obj[k]))));
    return w;
  }
  /** Inline price pill for buttons (first priced resource). */
  function pricePill(cost) {
    const k = RES_KEYS.find(x => cost && cost[x]);
    if (!k) return h('span.pill', 'Gratuit');
    return h('span.pill', icon(resIcon(k), 20), fmt(cost[k]));
  }
  function canAfford(cost) {
    if (!cost) return true;
    const r = ecall('canAfford', cost);
    if (r !== undefined) return !!r;
    const p = (S() || {}).player || {};
    return RES_KEYS.every(k => !cost[k] || k === 'xp' || (p[k] || 0) >= cost[k]);
  }
  function missingText(cost) {
    const p = (S() || {}).player || {};
    const k = RES_KEYS.find(x => cost && cost[x] && x !== 'xp' && (p[x] || 0) < cost[x]);
    if (!k) return 'Tu n’as pas assez de ressources.';
    if (k === 'coins') return 'Il te manque ' + fmt(cost[k] - (p[k] || 0)) + ' pièces.';
    if (k === 'dollars') return 'Il te manque ' + fmt(cost[k] - (p[k] || 0)) + ' ' + plural(cost[k] - (p[k] || 0), 'dollar', 'dollars') + '.';
    return 'Il te manque ' + fmt(cost[k] - (p[k] || 0)) + ' ' + resName(k).toLowerCase() + '.';
  }

  // ---------- Canvas helpers ----------
  /** Size a canvas to its CSS box × DPR; returns {ctx, w, h} in CSS px (ctx already scaled). */
  function fitCanvas(cv, w, hh) {
    const dpr = DPR();
    const r = cv.getBoundingClientRect();
    w = w || Math.max(1, Math.round(r.width)) || 300;
    hh = hh || Math.max(1, Math.round(r.height)) || 150;
    const pw = Math.round(w * dpr), ph = Math.round(hh * dpr);
    if (cv.width !== pw || cv.height !== ph) { cv.width = pw; cv.height = ph; }
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h: hh };
  }

  // ===========================================================================
  // PC.LOGO — original « CRÉTACÉ PARK » logo: steel octagon emblem with a volcanic
  // ring and an amber gem holding a three-toed footprint, ferns, metallic lettering.
  // ===========================================================================
  function footprint(c, x, y, s, fill) {
    c.save(); c.translate(x, y); c.scale(s, s);
    c.fillStyle = fill;
    // heel pad
    c.beginPath(); c.moveTo(-9, 10); c.quadraticCurveTo(-12, -2, 0, -4); c.quadraticCurveTo(12, -2, 9, 10); c.quadraticCurveTo(0, 18, -9, 10); c.fill();
    // three toes with claws
    for (const [a, len] of [[-0.62, 26], [0, 31], [0.62, 26]]) {
      c.save(); c.rotate(a);
      c.beginPath(); c.moveTo(-5.5, -2); c.quadraticCurveTo(-6.5, -len * 0.6, -2.5, -len); c.lineTo(0, -len - 7); c.lineTo(2.5, -len); c.quadraticCurveTo(6.5, -len * 0.6, 5.5, -2); c.closePath(); c.fill();
      c.restore();
    }
    c.restore();
  }
  function fern(c, x0, y0, x1, y1, bend, width, col, ink) {
    const mx = (x0 + x1) / 2 + bend[0], my = (y0 + y1) / 2 + bend[1];
    const pt = t => [(1 - t) * (1 - t) * x0 + 2 * (1 - t) * t * mx + t * t * x1, (1 - t) * (1 - t) * y0 + 2 * (1 - t) * t * my + t * t * y1];
    const n = 13;
    for (let i = 1; i < n; i++) {
      const t = i / n, p = pt(t), q = pt(Math.min(1, t + 0.02));
      const ang = Math.atan2(q[1] - p[1], q[0] - p[0]);
      const l = width * (1 - t * 0.75);
      for (const s of [-1, 1]) {
        const a = ang + s * 1.05;
        c.beginPath(); c.moveTo(p[0], p[1]);
        c.quadraticCurveTo(p[0] + Math.cos(a - s * 0.4) * l * 0.6, p[1] + Math.sin(a - s * 0.4) * l * 0.6, p[0] + Math.cos(a) * l, p[1] + Math.sin(a) * l + l * 0.25);
        c.quadraticCurveTo(p[0] + Math.cos(a + s * 0.3) * l * 0.4, p[1] + Math.sin(a + s * 0.3) * l * 0.4 + 2, p[0], p[1]);
        c.fillStyle = col; c.fill(); c.strokeStyle = ink; c.lineWidth = 1.4; c.stroke();
      }
    }
    c.beginPath(); c.moveTo(x0, y0); c.quadraticCurveTo(mx, my, x1, y1); c.strokeStyle = ink; c.lineWidth = 3; c.stroke();
  }
  /** Draw the emblem centred at (x, y) with radius r (unit-agnostic). */
  function drawEmblem(c, x, y, r, t) {
    t = t || 0;
    c.save(); c.translate(x, y); c.scale(r / 112, r / 112);
    // steel octagon
    const oct = rad0 => { c.beginPath(); for (let i = 0; i < 8; i++) { const a = (i + 0.5) / 8 * TAU; c.lineTo(Math.cos(a) * rad0, Math.sin(a) * rad0); } c.closePath(); };
    c.save(); c.shadowColor = 'rgba(0,0,0,.55)'; c.shadowBlur = 18; c.shadowOffsetY = 8; oct(112); c.fillStyle = '#1a1f23'; c.fill(); c.restore();
    oct(112); fs(c, lin(c, 0, -112, 0, 112, [[0, '#f6f8f9'], [0.3, '#c3cad0'], [0.5, '#8a939b'], [0.52, '#a8b0b7'], [1, '#e3e7ea']]), '#14181b', 6);
    oct(100); c.strokeStyle = 'rgba(0,0,0,.35)'; c.lineWidth = 3; c.stroke();
    for (let i = 0; i < 8; i++) {
      const a = (i + 0.5) / 8 * TAU;
      ell(c, Math.cos(a) * 99, Math.sin(a) * 99, 6, 6);
      fs(c, rad(c, Math.cos(a) * 99 - 2, Math.sin(a) * 99 - 2, 0.5, 7, [[0, '#ffffff'], [0.5, '#9aa3aa'], [1, '#3a4248']]), '#14181b', 1.5);
    }
    // volcanic ring with lava cracks
    ell(c, 0, 0, 90, 90); fs(c, rad(c, 0, -20, 20, 95, [[0, '#5a3a2a'], [0.7, '#2a1a12'], [1, '#140c08']]), '#0a0604', 4);
    c.save(); ell(c, 0, 0, 89, 89); c.clip();
    const r0 = H ? H.rng(77) : Math.random;
    c.lineCap = 'round'; c.lineJoin = 'round';
    for (let i = 0; i < 16; i++) {
      const a = i / 16 * TAU + r0() * 0.3;
      let px = Math.cos(a) * 74, py = Math.sin(a) * 74;
      c.beginPath(); c.moveTo(px, py);
      for (let k = 0; k < 3; k++) { const aa = a + (r0() - 0.5) * 0.5; px += Math.cos(aa) * 6; py += Math.sin(aa) * 6; c.lineTo(px, py); }
      const glow = 0.65 + 0.35 * Math.sin(t * 2.5 + i);
      c.strokeStyle = `rgba(255,${120 + (i % 3) * 30},30,${glow})`; c.lineWidth = 2.6; c.shadowColor = '#ff7a1a'; c.shadowBlur = 8; c.stroke();
    }
    c.restore();
    // amber gem
    ell(c, 0, 0, 72, 72);
    fs(c, rad(c, 0, 0, 4, 74, [[0, '#ffe39a'], [0.4, '#ffb22a'], [0.78, '#d9600a'], [1, '#7a2a04']], -22, -26), '#3a1404', 5);
    c.save(); ell(c, 0, 0, 70, 70); c.clip();
    c.fillStyle = 'rgba(255,240,190,.5)';
    const r1 = H ? H.rng(9) : Math.random;
    for (let i = 0; i < 14; i++) { const bx = (r1() - 0.5) * 110, by = (r1() - 0.5) * 110, br = 1 + r1() * 2.6; ell(c, bx, by, br, br); c.fill(); }
    // footprint pressed in the amber (with light emboss under it)
    footprint(c, 2, 26, 1.35, 'rgba(255,230,160,.35)');
    footprint(c, 0, 22, 1.35, '#4a1a04');
    footprint(c, -1, 20, 1.18, 'rgba(120,40,4,.55)');
    // glossy highlight
    c.beginPath(); c.ellipse(-16, -34, 46, 22, -0.35, 0, TAU); c.fillStyle = lin(c, 0, -60, 0, -12, [[0, 'rgba(255,255,255,.55)'], [1, 'rgba(255,255,255,0)']]); c.fill();
    c.restore();
    ell(c, 0, 0, 72, 72); c.strokeStyle = 'rgba(255,220,140,.6)'; c.lineWidth = 1.5; c.stroke();
    c.restore();
  }
  /** Metallic bevelled text centred at (x, baseline y). */
  function metalText(c, text, x, y, size, o) {
    o = o || {};
    c.save();
    c.font = size + 'px ' + (o.font || '"Russo One", "Arial Black", Impact, sans-serif');
    c.textAlign = 'left'; c.textBaseline = 'alphabetic';
    const sp = o.spacing || 0;
    const ws = [...text].map(ch => c.measureText(ch).width);
    let total = ws.reduce((a, b) => a + b, 0) + sp * (ws.length - 1);
    let k = 1;
    if (o.maxW && total > o.maxW) { k = o.maxW / total; }
    c.translate(x, y); c.scale(k, 1);
    let cx = -total / 2;
    const glyphs = [...text].map((ch, i) => { const g = { ch, x: cx }; cx += ws[i] + sp; return g; });
    const each = fn => glyphs.forEach(g => fn(g.ch, g.x));
    const top = -size * 0.74, bot = size * 0.02;
    // drop shadow
    c.fillStyle = 'rgba(0,0,0,.55)'; each((ch, gx) => c.fillText(ch, gx, size * 0.08));
    c.lineJoin = 'round'; c.miterLimit = 2;
    c.strokeStyle = o.ink || '#140a04'; c.lineWidth = size * 0.17; each((ch, gx) => c.strokeText(ch, gx, 0));
    c.strokeStyle = o.rim || '#8a4208'; c.lineWidth = size * 0.09; each((ch, gx) => c.strokeText(ch, gx, 0));
    c.fillStyle = lin(c, 0, top, 0, bot, o.grad || [[0, '#fffbe0'], [0.3, '#ffd65a'], [0.52, '#f6a21e'], [0.53, '#c25a08'], [0.75, '#f0a02a'], [1, '#ffdd7a']]);
    each((ch, gx) => c.fillText(ch, gx, 0));
    c.save();
    c.globalCompositeOperation = 'source-atop';
    c.restore();
    c.strokeStyle = 'rgba(255,255,255,.55)'; c.lineWidth = Math.max(1, size * 0.018); each((ch, gx) => c.strokeText(ch, gx, -size * 0.015));
    c.restore();
    return total * k;
  }
  function drawLogo(c, t) {
    // ferns behind the emblem
    fern(c, 300, 168, 70, 250, [-30, -70], 34, '#3f8a2a', '#123a06');
    fern(c, 340, 168, 570, 250, [30, -70], 34, '#3f8a2a', '#123a06');
    fern(c, 310, 150, 150, 70, [10, -40], 26, '#5aa83a', '#123a06');
    fern(c, 330, 150, 490, 70, [-10, -40], 26, '#5aa83a', '#123a06');
    drawEmblem(c, 320, 128, 116, t);
    // hazard bar + steel plate for « PARK »
    c.save();
    rr(c, 96, 334, 448, 28, 6); c.save(); c.clip();
    for (let i = -2; i < 40; i++) { c.beginPath(); c.moveTo(96 + i * 24, 334); c.lineTo(96 + i * 24 + 12, 334); c.lineTo(96 + i * 24 - 16, 362); c.lineTo(96 + i * 24 - 28, 362); c.closePath(); c.fillStyle = '#1b1b1b'; c.fill(); }
    c.globalCompositeOperation = 'destination-over'; c.fillStyle = '#f6c21b'; c.fillRect(90, 330, 460, 40);
    c.restore();
    rr(c, 96, 334, 448, 28, 6); c.strokeStyle = '#14181b'; c.lineWidth = 4; c.stroke();
    c.shadowColor = 'rgba(0,0,0,.5)'; c.shadowBlur = 10; c.shadowOffsetY = 4;
    rr(c, 208, 318, 224, 62, 12); fs(c, lin(c, 0, 318, 0, 380, [[0, '#f6f8f9'], [0.45, '#b9c1c8'], [0.55, '#8a939b'], [1, '#d6dbdf']]), '#14181b', 4);
    c.shadowColor = 'transparent';
    for (const rx of [222, 418]) for (const ry of [331, 367]) { ell(c, rx, ry, 4, 4); fs(c, rad(c, rx - 1, ry - 1, 0.5, 5, [[0, '#fff'], [1, '#4a5258']]), '#14181b', 1); }
    c.restore();
    metalText(c, 'PARK', 320, 368, 46, { spacing: 10, rim: '#3a4248', grad: [[0, '#ffffff'], [0.48, '#dfe4e8'], [0.5, '#8a939b'], [1, '#e6eaed']] });
    metalText(c, 'CRÉTACÉ', 320, 306, 116, { spacing: 4, maxW: 610 });
  }
  /**
   * Draw the logo into `target` (a canvas or a 2D context) inside a w×h box.
   * With a canvas and no w/h, the whole canvas (in pixels) is used. Aspect ≈ 1.6.
   */
  LOGO.draw = function (target, w, hh, t) {
    if (!target) return;
    const isCanvas = !!target.getContext;
    const c = isCanvas ? target.getContext('2d') : target;
    if (isCanvas && (w == null || hh == null)) { w = target.width; hh = target.height; c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, w, hh); }
    const s = Math.min(w / 640, hh / 400);
    c.save();
    c.translate((w - 640 * s) / 2, (hh - 400 * s) / 2);
    c.scale(s, s);
    try { drawLogo(c, t || 0); } catch (e) { console.error('LOGO', e); }
    c.restore();
  };
  /** Just the round emblem, centred at (x, y) radius r. */
  LOGO.emblem = function (ctx, x, y, r, t) { try { drawEmblem(ctx, x, y, r, t); } catch (e) { /* */ } };
  LOGO.emblemURL = function (size) {
    const key = 'emblem|' + size;
    if (iconCache.has(key)) return iconCache.get(key);
    const c = document.createElement('canvas'); c.width = c.height = size * 2;
    drawEmblem(c.getContext('2d'), size, size, size * 0.96, 0);
    const u = c.toDataURL(); iconCache.set(key, u); return u;
  };
