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
        else if (k === 'style' && typeof v === 'object') { for (const sk in v) { if (sk.slice(0, 2) === '--') n.style.setProperty(sk, v[sk]); else n.style[sk] = v[sk]; } }
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
    c.fillStyle = '#f6c21b'; c.fillRect(90, 330, 460, 40);
    for (let i = -2; i < 40; i++) { c.beginPath(); c.moveTo(96 + i * 24, 334); c.lineTo(96 + i * 24 + 12, 334); c.lineTo(96 + i * 24 - 16, 362); c.lineTo(96 + i * 24 - 28, 362); c.closePath(); c.fillStyle = '#1b1b1b'; c.fill(); }
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


  // ===========================================================================
  // DOM roots, animation loop, popup queue
  // ===========================================================================
  const $ = id => document.getElementById(id);
  let R = null;
  /** Find (or create when index.html lacks them) every UI root element. */
  function roots() {
    if (R && R.app && R.app.isConnected) return R;
    const app = $('pc-app') || document.body;
    const need = (id, tag, cls, parent) => {
      let n = $(id);
      if (!n) { n = document.createElement(tag || 'div'); n.id = id; if (cls) n.className = cls; (parent || app).append(n); }
      return n;
    };
    R = { app };
    R.hud = need('pc-hud', 'div', 'hidden');
    if (!R.hud.querySelector('.hud-left')) {
      R.hud.innerHTML = '<div class="hud-left"><div class="lvl-badge" id="pc-lvl"><span class="niv">NIV</span><b id="pc-lvl-n">1</b></div>' +
        '<div class="hud-col"><div class="xp"><div class="bar hzfill"><i id="pc-xp-fill"></i><span id="pc-xp-txt"></span></div></div>' +
        '<div class="hud-btns" id="pc-hud-btns"></div></div></div><div class="hud-right" id="pc-res"></div>';
    }
    R.lvlBadge = $('pc-lvl'); R.lvl = $('pc-lvl-n'); R.xpFill = $('pc-xp-fill'); R.xpTxt = $('pc-xp-txt');
    R.hudBtns = $('pc-hud-btns'); R.res = $('pc-res');
    R.parkPlate = need('pc-parkplate', 'div', 'park-plate hidden');
    if (!$('pc-parkname')) R.parkPlate.innerHTML = '<div class="hz"></div><span id="pc-parkname"></span><div class="hz"></div>';
    R.parkName = $('pc-parkname');
    R.bottom = need('pc-bottombar', 'nav', 'hidden');
    R.action = need('pc-actionbar', 'div', 'hidden');
    R.place = need('pc-placebar', 'div', 'hidden');
    R.panels = need('pc-panels');
    R.modals = need('pc-modals');
    R.toasts = need('pc-toasts');
    R.title = need('pc-title');
    R.intro = need('pc-intro', 'canvas', 'hidden');
    return R;
  }

  // One shared requestAnimationFrame loop for every animated UI canvas.
  // A callback returning false (or whose canvas left the page) is dropped.
  const anims = new Set();
  let animRaf = 0;
  function addAnim(fn) {
    anims.add(fn);
    if (!animRaf) animRaf = requestAnimationFrame(animLoop);
    return () => anims.delete(fn);
  }
  function animLoop(ts) {
    animRaf = 0;
    const t = ts / 1000;
    for (const fn of Array.from(anims)) {
      let keep;
      try { keep = fn(t); } catch (e) { console.error('UI anim', e); keep = false; }
      if (keep === false) anims.delete(fn);
    }
    if (anims.size) animRaf = requestAnimationFrame(animLoop);
  }
  /** Animate a canvas while it is in the page: draw(ctx, w, h, t). */
  function animCanvas(cv, draw) {
    return addAnim(t => {
      if (!cv.isConnected) return false;
      const r = cv.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return true;
      const f = fitCanvas(cv);
      f.ctx.clearRect(0, 0, f.w, f.h);
      draw(f.ctx, f.w, f.h, t);
      return true;
    });
  }

  // Big popups (level-up, evolution, story dialogs, research results…) are shown one at a time.
  const queue = [];
  let popupBusy = false, blockPopups = true;
  /** enqueue(fn(done)) — fn shows a popup and calls done() when it is closed. */
  function enqueue(fn, front) {
    if (front) queue.unshift(fn); else queue.push(fn);
    pump();
  }
  function pump() {
    if (popupBusy || blockPopups || !queue.length) return;
    popupBusy = true;
    const fn = queue.shift();
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      popupBusy = false;
      setTimeout(pump, 160);
    };
    try { fn(done); } catch (e) { console.error('UI popup', e); done(); }
  }
  UI.setPopupsBlocked = b => { blockPopups = !!b; pump(); };

  // ===========================================================================
  // Toasts
  // ===========================================================================
  let lastToast = { text: '', at: 0 };
  UI.toast = function (text, kind) {
    const r = roots();
    text = String(text || '');
    if (!text) return;
    const t0 = Date.now();
    if (text === lastToast.text && t0 - lastToast.at < 1500) return;
    lastToast = { text, at: t0 };
    const ic = kind === 'good' ? 'check' : kind === 'bad' ? null : null;
    const el = h('div.toast.' + (kind === 'good' || kind === 'bad' ? kind : 'info'), ic ? icon(ic, 22) : null, h('span', text));
    r.toasts.append(el);
    const maxToasts = window.innerWidth < 640 ? 2 : 3;
    while (r.toasts.children.length > maxToasts) r.toasts.firstChild.remove();
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 400); }, kind === 'bad' ? 2600 : 3400);
  };
  const toast = UI.toast;
  /** Show the reason of a failed engine call (and the error sound). */
  function failToast(res, fallback) {
    const reason = (res && res.reason) || fallback || 'Impossible pour le moment.';
    sfx('error');
    toast(reason, 'bad');
  }

  // ===========================================================================
  // Modals & in-page confirm
  // ===========================================================================
  /**
   * modal({title, body, buttons:[{label, cls, icon, cost, value, onclick}], cls, x, backdropClose, onClose, rays})
   * → {wrap, box, inner, close(value)}. A button's onclick returning true keeps the modal open.
   */
  function modal(o) {
    const r = roots();
    const wrap = h('div.mw' + (o.wrapCls ? '.' + o.wrapCls : ''));
    const box = h('div.modal.steel' + (o.cls ? '.' + o.cls : ''));
    const inner = h('div.inner');
    let closed = false;
    const close = v => {
      if (closed) return;
      closed = true;
      wrap.remove();
      if (o.onClose) { try { o.onClose(v); } catch (e) { console.error(e); } }
    };
    if (o.x !== false) box.append(h('button.xbtn', { 'aria-label': 'Fermer', title: 'Fermer', onclick: () => { sfx('click'); close(null); } }));
    if (o.title) box.append(h('div.ph', h('div.hz'), h('div.pt', o.title), h('div.hz')));
    box.append(inner);
    if (o.body) inner.append(...[].concat(o.body).filter(Boolean));
    if (o.buttons && o.buttons.length) {
      inner.append(h('div.btn-row', o.buttons.map(b => h('button.b' + (b.cls ? '.' + b.cls : ''), {
        disabled: b.disabled,
        onclick: () => {
          sfx('click');
          if (b.onclick && b.onclick() === true) return;
          close(b.value === undefined ? true : b.value);
        },
      }, b.icon ? icon(b.icon, 22) : null, b.label, b.cost ? pricePill(b.cost) : null))));
    }
    if (o.rays) wrap.append(h('div.rays'));
    wrap.append(box);
    if (o.backdropClose) wrap.addEventListener('click', e => { if (e.target === wrap) close(null); });
    wrap._close = close;
    r.modals.append(wrap);
    return { wrap, box, inner, close };
  }
  UI.modal = modal;

  /** In-page confirm (no window.confirm in the sandbox). Resolves true / false. */
  UI.confirm = function (o) {
    o = o || {};
    return new Promise(res => {
      const body = [h('div.mtxt', o.html ? { html: o.html } : { text: o.text || 'Es-tu sûr ?' })];
      if (o.extra) body.push(o.extra);
      modal({
        title: o.title || 'Confirmer', cls: 'confirm', body,
        buttons: [
          { label: o.no || 'Annuler', cls: 'b-dark', value: false },
          { label: o.yes || 'Oui', cls: o.danger ? 'b-red' : '', icon: o.yesIcon, value: true },
        ],
        onClose: v => res(v === true),
      });
    });
  };

  function confetti(parent, n) {
    const c = h('div.confetti');
    const cols = ['#ffd23a', '#ff5a48', '#8fe04a', '#5ab4ff', '#ff9ad0', '#ffffff'];
    for (let i = 0; i < (n || 46); i++) {
      c.append(h('i', { style: {
        left: (Math.random() * 100) + '%', background: cols[i % cols.length],
        animationDuration: (1.8 + Math.random() * 1.8) + 's', animationDelay: (Math.random() * 0.6) + 's',
        transform: 'rotate(' + Math.round(Math.random() * 360) + 'deg)',
      } }));
    }
    parent.append(c);
    setTimeout(() => c.remove(), 4400);
  }

  // ===========================================================================
  // Panels (one at a time) — openPanel(name, title, opts) → P
  //   P = { name, el, box, body, close(), setTitle(t), onUpdate: fn, onTimer: fn }
  // ===========================================================================
  let panel = null;
  function openPanel(name, title, opts) {
    opts = opts || {};
    closePanel(true);
    hideActionBar();
    const r = roots();
    const wrap = h('div.pw');
    const box = h('div.panel.steel' + (opts.cls ? '.' + opts.cls : ''));
    const pt = h('div.pt', title);
    const head = h('div.ph', h('div.hz'), pt, h('div.hz'));
    const body = h('div.pb');
    const P = { name, el: wrap, box, body, head, onUpdate: null, onTimer: null, onClose: opts.onClose || null };
    P.setTitle = t => { pt.textContent = t; };
    P.close = () => { if (panel === P) closePanel(); };
    box.append(h('button.xbtn', { 'aria-label': 'Fermer', title: 'Fermer', onclick: () => { sfx('click'); P.close(); } }), head, body);
    wrap.append(box);
    wrap.addEventListener('pointerdown', e => { wrap._downOnBack = e.target === wrap; });
    wrap.addEventListener('click', e => { if (e.target === wrap && wrap._downOnBack) P.close(); });
    r.panels.append(wrap);
    panel = P;
    return P;
  }
  function closePanel(silent) {
    if (!panel) return;
    const P = panel;
    panel = null;
    P.el.remove();
    if (P.onClose) { try { P.onClose(); } catch (e) { console.error(e); } }
    if (!silent) syncBars();
  }
  UI.closePanel = () => closePanel();
  UI.panelName = () => (panel ? panel.name : null);
  /** Re-run the open panel's update (keeps scroll positions). */
  function updatePanel() {
    if (panel && panel.onUpdate) { try { panel.onUpdate(); } catch (e) { console.error('panel update', e); } }
  }

  /** Remember / restore the scroll of every scroller inside `el` while rebuilding it. */
  function keepScroll(el, rebuild) {
    const saved = Array.from(el.querySelectorAll('.scroll-x, .scroll-y')).map(n => [n.dataset.sk || '', n.scrollLeft, n.scrollTop]);
    rebuild();
    const now2 = Array.from(el.querySelectorAll('.scroll-x, .scroll-y'));
    for (const n of now2) {
      const s = saved.find(x => x[0] === (n.dataset.sk || ''));
      if (s) { n.scrollLeft = s[1]; n.scrollTop = s[2]; }
    }
  }
  /** Mouse wheel scrolls horizontal card rows. */
  function wheelX(el) {
    el.addEventListener('wheel', e => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && el.scrollWidth > el.clientWidth) { el.scrollLeft += e.deltaY; e.preventDefault(); }
    }, { passive: false });
    return el;
  }
  function htabs(list, cur2, onPick) {
    return h('div.htabs', list.map(t => h('button.htab' + (t.id === cur2 ? '.on' : ''), {
      onclick: () => { if (t.id !== cur2) { sfx('click'); onPick(t.id); } },
    }, t.icon ? icon(t.icon, 26) : null, t.label, t.bang ? h('span.bang', t.bang) : null)));
  }


  // ===========================================================================
  // Iso view link (set by main.js) and small game helpers
  // ===========================================================================
  let view = null;
  UI.setView = v => { view = v; };
  UI.getView = () => view;
  /** Guarded call into the iso view. */
  function V(fn, ...a) {
    if (view && typeof view[fn] === 'function') { try { return view[fn](...a); } catch (e) { console.error('view.' + fn, e); } }
    return undefined;
  }
  const bdef = id => (D().BUILDINGS || {})[id] || null;
  const spdef = id => (PC.SPECIES || {})[id] || null;
  const center = o => [o.gx + (o.w || 1) / 2, o.gy + (o.h || 1) / 2];
  const rarityOf = r => (PC.RARITY || {})[r] || { name: r || '', color: '#9aa3a8' };
  const clsOf = c => (PC.CLASSES || {})[c] || { name: c || '', color: '#888' };
  const npcOf = id => (D().NPCS || {})[id] || { name: 'Ranger', role: '', look: {} };
  function getObj(id) { return id == null ? null : ecall('getObj', cur(), id) || (ecall('findObj', id) || {}).obj || null; }
  const sfxRes = k => (k === 'coins' || k === 'dollars' ? 'coin' : 'food');

  let gameStarted = false;

  // ===========================================================================
  // HUD — level badge, XP bar (hazard fill), Missions / collect buttons, resource capsules
  // ===========================================================================
  const hudBtn = {};
  let capEls = {}, capPark = null;
  function setBang(el, n, cls) {
    if (!el) return;
    let b = el.querySelector(':scope > .' + (cls || 'bang'));
    if (n) {
      if (!b) { b = h('span.' + (cls || 'bang')); el.append(b); }
      b.textContent = n === true ? '!' : String(n);
    } else if (b) b.remove();
  }
  function bump(el) { el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
  function buildHUD() {
    const r = roots();
    r.hudBtns.innerHTML = '';
    hudBtn.missions = h('button.sqbtn', { title: 'Missions', 'aria-label': 'Missions', onclick: () => { sfx('click'); UI.openMissions(); } }, icon('missions', 34));
    hudBtn.collect = h('button.sqbtn', { title: 'Tout ramasser', 'aria-label': 'Tout ramasser', onclick: collectAllUI }, icon('collect', 34));
    r.hudBtns.append(hudBtn.missions, hudBtn.collect);
    if (r.lvlBadge) r.lvlBadge.onclick = () => { sfx('click'); showLevelInfo(); };
    buildCaps();
  }
  function buildCaps() {
    const r = roots();
    capPark = cur();
    capEls = {};
    r.res.innerHTML = '';
    for (const k of [park().food || 'food_land', 'coins', 'dollars']) {
      const span = h('span', '0');
      const el = h('div.cap', { title: resName(k) }, icon(resIcon(k), 40), span);
      capEls[k] = { el, span, val: null };
      r.res.append(el);
    }
  }
  function missionsClaimable() {
    let n = 0;
    const m = ecall('mission');
    if (m && m.done) n++;
    for (const s of ecall('sideMissions') || []) if (s.done) n++;
    return n;
  }
  function refreshHUD() {
    const s = S();
    if (!s) return;
    const r = roots();
    if (capPark !== cur()) buildCaps();
    const p = s.player || {};
    if (r.lvl) r.lvl.textContent = p.level || 1;
    const lp = ecall('levelProgress') || { xp: p.xp || 0, need: 1, ratio: 0 };
    if (r.xpFill) r.xpFill.style.width = (lp.max ? 100 : Math.round(clamp(lp.ratio, 0, 1) * 100)) + '%';
    if (r.xpTxt) r.xpTxt.textContent = lp.max ? 'NIVEAU MAX' : fmtShort(lp.xp) + ' / ' + fmtShort(lp.need) + ' XP';
    for (const k in capEls) {
      const c = capEls[k], v = Math.floor(p[k] || 0);
      if (c.val !== v) { if (c.val != null && v > c.val) bump(c.el); c.val = v; c.span.textContent = fmtShort(v); }
    }
    if (r.parkName) r.parkName.textContent = park().name.toUpperCase();
    setBang(hudBtn.missions, missionsClaimable());
  }
  function showLevelInfo() {
    const lp = ecall('levelProgress');
    if (!lp) return;
    toast(lp.max ? 'Niveau ' + lp.level + ' : tu as atteint le niveau maximum !' :
      'Niveau ' + lp.level + ' : encore ' + fmt(lp.need - lp.xp) + ' XP pour le niveau ' + (lp.level + 1) + '.', 'info');
  }
  function collectAllUI() {
    sfx('click');
    const got = ecall('collectAll', cur()) || {};
    const keys = Object.keys(got).filter(k => got[k] > 0);
    if (!keys.length) { toast('Rien à ramasser pour l’instant. Reviens un peu plus tard !', 'info'); return; }
    toast('Ramassé : ' + keys.map(k => '+' + fmt(got[k]) + ' ' + resName(k).toLowerCase()).join(', '), 'good');
  }

  // ===========================================================================
  // Bottom bar — square steel buttons with drawn icons
  // ===========================================================================
  const bbEls = {};
  const BOTTOM = [
    ['market', 'market', 'MARCHÉ', () => UI.openMarket()],
    ['roads', 'roads', 'ROUTES', () => UI.startRoads()],
    ['lab', 'lab', 'LABO ADN', () => UI.openLab()],
    ['battle', 'tournament', 'TOURNOI', () => UI.openBattle()],
    ['cards', 'cards', 'CARTES', () => UI.openCards()],
    ['collection', 'collection', 'COLLECTION', () => UI.openCollection()],
    ['parks', 'parks', 'PARCS', () => UI.openParks()],
    ['options', 'options', 'OPTIONS', () => UI.openOptions()],
  ];
  function buildBottom() {
    const r = roots();
    r.bottom.innerHTML = '';
    for (const [id, ic, label, fn] of BOTTOM) {
      const b = h('button.bb', { 'data-id': id, title: label, onclick: () => { sfx('click'); fn(); } }, icon(ic, 40), h('span.lbl', label));
      bbEls[id] = b;
      r.bottom.append(b);
    }
  }
  function refreshBottom() {
    const s = S();
    if (!s) return;
    setBang(bbEls.cards, ecall('cardsReady') ? 'COLLECTER' : 0, 'tag-red');
    const labWaiting = (s.research && s.research.result === false) || (s.expedition && s.expedition.result != null);
    setBang(bbEls.lab, labWaiting ? '!' : 0);
    const promo = ecall('promoInfo');
    setBang(bbEls.lab, promo && !labWaiting ? 'FLASH' : 0, 'tag-red');
  }

  /** Which bottom bar is visible: placement bar > action bar > main bar. */
  function syncBars() {
    const r = roots();
    const on = gameStarted;
    r.hud.classList.toggle('hidden', !on);
    r.parkPlate.classList.toggle('hidden', !on);
    r.place.classList.toggle('hidden', !on || !placing);
    r.action.classList.toggle('hidden', !on || !!placing || actionId == null);
    r.bottom.classList.toggle('hidden', !on || !!placing || actionId != null);
  }

  // ===========================================================================
  // Contextual action bar (building tapped): plate + round steel buttons
  // ===========================================================================
  let actionId = null, actionKey = '', actionRefs = null;
  function rbtn(label, ic, color, onclick, cost, disabled) {
    const k = cost && RES_KEYS.find(x => cost[x]);
    return h('button.rbtn.' + color, { onclick: e => { e.stopPropagation(); onclick(); }, disabled, title: label },
      h('span.disc', icon(ic, 32)), h('span.rl', label),
      k ? h('span.rc', icon(resIcon(k), 14), fmtShort(cost[k])) : null);
  }
  function showActionBar(obj) {
    if (!obj) return;
    closePanel(true);
    actionId = obj.id;
    actionKey = '';
    V('highlight', obj.id);
    renderActionBar();
    syncBars();
  }
  function hideActionBar() {
    if (actionId == null) return;
    actionId = null;
    actionRefs = null;
    V('highlight', null);
    roots().action.innerHTML = '';
    syncBars();
  }
  UI.showActionBar = showActionBar;
  UI.hideActionBar = hideActionBar;

  /** Status line + progress of a production building. */
  function prodStatus(o, b, prod) {
    if (!prod || prod.state === 'none') return { text: b.desc || (D().KIND_NAMES || {})[b.kind] || '', ratio: null };
    const rn = resName(prod.res).toLowerCase();
    if (prod.state === 'idle') return { text: 'En attente : touche ACTIVER pour choisir une livraison', ratio: 0 };
    if (prod.state === 'ready') return { text: (b.kind === 'food' ? 'Livraison arrivée : ' : 'Prêt : ') + '+' + fmt(prod.amount) + ' ' + rn + ' !', ratio: 1, ready: true };
    const what = prod.order ? prod.order.name + ' : ' : '';
    return { text: what + '+' + fmt(prod.amount) + ' ' + rn + ' dans ' + fmtTime(prod.remainingSec), ratio: prod.progress };
  }
  function renderActionBar() {
    if (actionId == null) return;
    const o = getObj(actionId);
    if (!o || o.type !== 'building') { hideActionBar(); return; }
    const b = bdef(o.buildingId) || { name: 'Bâtiment', kind: 'deco', desc: '' };
    const prod = b.kind === 'coins' || b.kind === 'food' ? ecall('production', o.id) : null;
    const up = ecall('upgradeCost', o.id);
    const spd = prod && prod.state === 'producing' ? ecall('speedUpCost', o.id) || 0 : 0;
    const key = [o.id, o.level, prod ? prod.state : '-', up ? up.coins : '-', spd, cur()].join('|');
    const r = roots();
    if (key !== actionKey || !actionRefs) {
      actionKey = key;
      r.action.innerHTML = '';
      const st = h('div.ab-status');
      const fill = h('i');
      const bar = h('div.bar.gold', fill);
      const lv = b.kind === 'coins' || b.kind === 'food' ? h('span.lvtag', 'NIV. ' + (o.level || 1)) : null;
      const plate = h('div.ab-plate', h('div.th', h('img', { src: thumbURL(b.art || o.buildingId, 112, 112) || iconURL('tab_buildings', 28), alt: '' })),
        h('div.ab-info', h('div.ab-name', h('span', b.name), lv), st, bar));
      const btns = h('div.ab-btns');
      if (b.kind === 'food' && prod) {
        if (prod.state === 'idle') btns.append(rbtn('ACTIVER', 'truck', 'green', () => openOrders(o)));
        else btns.append(rbtn('COLLECTER', 'collect', 'yellow', () => collectObj(o), null, prod.state !== 'ready'));
      } else if (b.kind === 'coins' && prod) {
        btns.append(rbtn('COLLECTER', 'collect', 'yellow', () => collectObj(o), null, prod.state !== 'ready'));
      }
      if (spd) btns.append(rbtn('ACCÉLÉRER', 'speed', 'blue', () => speedUpObj(o), { dollars: spd }));
      if (b.kind === 'coins' || b.kind === 'food') {
        btns.append(up ? rbtn('AMÉLIORER', 'upgrade', 'green', () => upgradeObj(o), up)
          : rbtn('NIV. MAX', 'upgrade', 'green', () => toast('Ce bâtiment est déjà au niveau maximum !', 'info'), null, true));
      }
      if (!o.fixed) {
        btns.append(rbtn('DÉPLACER', 'move', 'blue', () => UI.startPlacement({ kind: 'move', obj: o })));
        btns.append(rbtn('VENDRE', 'sell', 'orange', () => sellObj(o)));
      }
      btns.append(rbtn('INFOS', 'info', 'blue', () => openBuilding(o)));
      const x = h('button.xbtn.ab-close', { 'aria-label': 'Fermer', onclick: () => { sfx('click'); hideActionBar(); } });
      r.action.append(plate, btns, x);
      actionRefs = { st, fill, bar };
    }
    const ps = prodStatus(o, b, prod);
    actionRefs.st.textContent = ps.text;
    actionRefs.bar.style.display = ps.ratio == null ? 'none' : '';
    actionRefs.fill.style.width = Math.round((ps.ratio || 0) * 100) + '%';
  }

  // ----- shared object actions (action bar, panels, taps) -----
  function collectObj(o) {
    const n = ecall('collect', o.id);
    if (!n) {
      const p = o.type === 'building' ? ecall('production', o.id) : null;
      if (p && p.state === 'idle') { openOrders(o); return 0; }
      toast(o.type === 'enclosure' ? 'Pas encore de pièces à ramasser.' : 'Pas encore prêt : patience !', 'info');
    }
    return n || 0;
  }
  function speedUpObj(o) {
    const c = ecall('speedUpCost', o.id) || 0;
    if (!c) return;
    const res = ecall('speedUp', o.id);
    if (!okRes(res)) failToast(res, missingText({ dollars: c }));
    else sfx('success');
  }
  function upgradeObj(o) {
    const res = ecall('upgrade', o.id);
    if (!okRes(res)) { failToast(res); return; }
    sfx('levelup');
    toast((bdef(o.buildingId) || {}).name + ' passe au niveau ' + res.level + ' : production ×1,5 !', 'good');
  }
  function sellObj(o) {
    const isEgg = o.type === 'enclosure';
    const name = isEgg ? (o.name || (spdef(o.speciesId) || {}).name) : (bdef(o.buildingId) || {}).name;
    const refund = ecall('sellValue', o.id) || {};
    if (isEgg) { const pend = ecall('pendingCoins', o.id) || 0; if (pend > 0) refund.coins = (refund.coins || 0) + pend; }
    const extra = h('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' } },
      h('div.rw-label', 'Tu récupères'), chips(refund, '+'));
    UI.confirm({
      title: 'Vendre ?', danger: true, yes: 'Vendre', extra,
      html: isEgg ? 'Veux-tu vraiment vendre <b>' + esc(name) + '</b> ? Tu pourras recréer cette espèce plus tard.'
        : 'Veux-tu vraiment vendre <b>' + esc(name) + '</b> ?',
    }).then(yes => {
      if (!yes) return;
      const res = ecall('sell', o.id);
      if (!okRes(res)) { failToast(res); return; }
      sfx('coin');
      if (actionId === o.id) hideActionBar();
      if (panel && panel.objId === o.id) closePanel();
    });
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c])); }

  // ===========================================================================
  // Placement mode (market purchases, moves, roads) + placement bar ✓ Placer / ✕ Annuler
  // ===========================================================================
  let placing = null, placeRefs = null;
  /**
   * startPlacement({kind:'creature', speciesId} | {kind:'building', buildingId, repeat} | {kind:'move', obj})
   */
  UI.startPlacement = function (o) {
    const pk = cur();
    const pl = Object.assign({}, o);
    if (pl.kind === 'creature') {
      const sp = spdef(pl.speciesId);
      if (!sp) return;
      const sz = ecall('enclosureSize', sp.park) || (D().ENCLOSURE_SIZE || {})[sp.park] || [3, 3];
      pl.w = sz[0]; pl.h = sz[1];
      pl.cost = ecall('creaturePrice', pl.speciesId) || sp.price;
      pl.title = sp.name;
      pl.thumb = portraitURL(sp.id, 96, 96, { stage: 0 });
      pl.ghost = { type: 'enclosure', speciesId: sp.id };
    } else if (pl.kind === 'building') {
      const b = bdef(pl.buildingId);
      if (!b) return;
      pl.w = b.size[0]; pl.h = b.size[1];
      pl.cost = b.cost;
      pl.title = b.name;
      pl.thumb = thumbURL(b.art || b.id, 96, 96);
      pl.ghost = { type: 'building', buildingId: b.id };
      if (b.kind === 'road') pl.repeat = true;
    } else if (pl.kind === 'move') {
      const ob = pl.obj;
      if (!ob || ob.fixed) { toast('Ce bâtiment ne peut pas être déplacé.', 'info'); return; }
      pl.w = ob.w || 1; pl.h = ob.h || 1;
      pl.cost = null;
      pl.title = 'Déplacer : ' + (ob.type === 'enclosure' ? ob.name || (spdef(ob.speciesId) || {}).name : (bdef(ob.buildingId) || {}).name);
      pl.thumb = ob.type === 'enclosure' ? portraitURL(ob.speciesId, 96, 96, { stage: PC.stageForLevel ? PC.stageForLevel(ob.level || 1) : 0 })
        : thumbURL((bdef(ob.buildingId) || {}).art || ob.buildingId, 96, 96);
      pl.ghost = { type: 'move', obj: ob };
      pl.ignoreId = ob.id;
    } else return;
    closePanel(true);
    hideActionBar();
    const spot = pl.kind === 'move' ? { gx: pl.obj.gx, gy: pl.obj.gy } : ecall('findFreeSpot', pk, pl.w, pl.h);
    if (!spot) { failToast(null, 'Plus de place dans le parc ! Vends ou déplace quelque chose.'); return; }
    if (!view || typeof view.startPlacement !== 'function') {
      // No iso view available: place straight away at the free spot.
      const res = doPlace(pl, spot.gx, spot.gy);
      if (!okRes(res)) failToast(res); else afterPlace(pl, res);
      return;
    }
    placing = pl;
    view.onPlacementChange = p => updatePlaceBar(p);
    V('startPlacement', { w: pl.w, h: pl.h, ghost: pl.ghost, gx: spot.gx, gy: spot.gy });
    V('centerOn', spot.gx + pl.w / 2, spot.gy + pl.h / 2);
    renderPlaceBar();
    syncBars();
    updatePlaceBar(V('getPlacement'));
  };
  UI.isPlacing = () => !!placing;
  /** ROUTES button: road placement for the current park. */
  UI.startRoads = function () {
    const id = 'road_' + cur();
    const b = bdef(id);
    if (!b) { UI.openMarket('road'); return; }
    if (((S() || {}).player || {}).level < b.level) { failToast(null, 'Les routes de ce parc se débloquent au niveau ' + b.level + '.'); return; }
    UI.startPlacement({ kind: 'building', buildingId: id });
  };
  function doPlace(pl, gx, gy) {
    if (pl.kind === 'creature') return ecall('buyCreature', pl.speciesId, gx, gy);
    if (pl.kind === 'building') return ecall('buyBuilding', pl.buildingId, gx, gy);
    if (pl.kind === 'move') return ecall('move', pl.obj.id, gx, gy);
    return null;
  }
  function afterPlace(pl, res) {
    if (pl.kind === 'creature') {
      const sp = spdef(pl.speciesId);
      toast('Un œuf de ' + sp.name + ' est au chaud ! Éclosion dans ' + fmtDur(sp.hatchSec || 10) + '.', 'good');
    } else if (pl.kind === 'move') sfx('build');
  }
  function renderPlaceBar() {
    const r = roots(), pl = placing;
    r.place.innerHTML = '';
    if (!pl) return;
    const hint = h('div.pl-hint', '');
    const ok = h('button.b.b-lg', { onclick: confirmPlacement }, icon('ok', 24), pl.kind === 'move' ? 'Valider' : 'Placer', pl.cost ? pricePill(pl.cost) : null);
    const cancel = h('button.b.b-red', { onclick: () => { sfx('click'); cancelPlacement(); } }, icon('close', 22), pl.repeat ? 'Terminer' : 'Annuler');
    r.place.append(h('div.pl-info', h('img.th', { src: pl.thumb || iconURL('tab_buildings', 40), alt: '' }),
      h('div', { style: { minWidth: 0 } }, h('div.pl-title', pl.title), hint)), cancel, ok);
    placeRefs = { hint, ok };
  }
  function updatePlaceBar(p) {
    if (!placing || !placeRefs) return;
    p = p || V('getPlacement') || {};
    const pl = placing;
    let reason = null;
    if (p.gx != null && !p.valid) reason = ecall('placeReason', cur(), p.gx, p.gy, pl.w, pl.h, pl.ignoreId) || 'Emplacement impossible ici';
    placeRefs.hint.textContent = reason ? reason : pl.repeat ? 'Touche une case pour poser la route, puis ✓ Placer.' : 'Fais glisser ou touche une case pour choisir l’emplacement.';
    placeRefs.hint.classList.toggle('badtxt', !!reason);
    placeRefs.ok.disabled = !!reason || p.gx == null;
  }
  let lastRoadDir = [1, 0];
  function confirmPlacement() {
    const pl = placing;
    if (!pl) return;
    const p = V('getPlacement') || {};
    if (p.gx == null) return;
    if (!p.valid) { failToast({ reason: ecall('placeReason', cur(), p.gx, p.gy, pl.w, pl.h, pl.ignoreId) || 'Emplacement impossible ici' }); return; }
    const res = doPlace(pl, p.gx, p.gy);
    if (!okRes(res)) { failToast(res); return; }
    if (pl.repeat) {
      if (pl.prev) lastRoadDir = [Math.sign(p.gx - pl.prev[0]), Math.sign(p.gy - pl.prev[1])];
      if (!lastRoadDir[0] && !lastRoadDir[1]) lastRoadDir = [1, 0];
      pl.prev = [p.gx, p.gy];
      const nxt = nextSpot(p.gx, p.gy, pl);
      if (nxt && canAfford(pl.cost)) {
        V('startPlacement', { w: pl.w, h: pl.h, ghost: pl.ghost, gx: nxt.gx, gy: nxt.gy });
        updatePlaceBar(V('getPlacement'));
        return;
      }
      if (!canAfford(pl.cost)) toast('Plus assez de pièces pour une autre route.', 'info');
    }
    cancelPlacement();
    afterPlace(pl, res);
  }
  function nextSpot(gx, gy, pl) {
    const pk = cur();
    const dirs = [lastRoadDir, [1, 0], [0, 1], [-1, 0], [0, -1]];
    for (const d of dirs) {
      const x = gx + d[0], y = gy + d[1];
      if (ecall('canPlace', pk, x, y, pl.w, pl.h)) return { gx: x, gy: y };
    }
    return null;
  }
  function cancelPlacement() {
    if (!placing) return;
    placing = null;
    placeRefs = null;
    if (view) view.onPlacementChange = null;
    V('endPlacement');
    roots().place.innerHTML = '';
    syncBars();
  }
  UI.cancelPlacement = cancelPlacement;


  // ===========================================================================
  // MARCHÉ — vertical category tabs, title plate, horizontally scrolling cards
  // ===========================================================================
  const MARKET_TABS = [
    { id: 'creatures', label: 'Créatures', icon: 'tab_creatures', title: 'Créatures' },
    { id: 'coins', label: 'Bâtiments', icon: 'tab_buildings', title: 'Commerces' },
    { id: 'food', label: 'Nourriture', icon: null, title: 'Nourriture' },
    { id: 'deco', label: 'Décorations', icon: 'tab_deco', title: 'Décorations' },
    { id: 'road', label: 'Routes', icon: 'roads', title: 'Routes' },
  ];
  let marketTab = 'creatures';
  /** Card to highlight in the open market ({tab, id}); set by openMarket, cleared on tab switch. */
  let marketFocus = null;
  /**
   * Open the market. `tab` is a tab id ('creatures', 'coins' | 'buildings', 'food', 'deco', 'road');
   * `focusId` (optional) is a species or building id: the market opens on its tab, scrolls its card
   * into view and highlights it.
   */
  UI.openMarket = function (tab, focusId) {
    marketFocus = null;
    if (focusId && spdef(focusId)) { tab = 'creatures'; marketFocus = { tab, id: focusId }; }
    else if (focusId && bdef(focusId) && MARKET_TABS.some(t => t.id === bdef(focusId).kind)) { tab = bdef(focusId).kind; marketFocus = { tab, id: focusId }; }
    if (tab) marketTab = tab === 'buildings' ? 'coins' : tab;
    if (!MARKET_TABS.some(t => t.id === marketTab)) marketTab = 'creatures';
    const P = openPanel('market', 'MARCHÉ');
    const tabsEl = h('div.vtabs');
    const inner = h('div.inner');
    P.body.append(tabsEl, inner);
    let sig = '';
    const render = force => {
      const s2 = marketSig();
      if (!force && s2 === sig) return;
      sig = s2;
      tabsEl.innerHTML = '';
      for (const t of MARKET_TABS) {
        const ic = t.id === 'food' ? resIcon(park().food || 'food_land') : t.icon;
        const offerBang = t.id === 'creatures' && hasFreshOffer();
        tabsEl.append(h('button.vtab' + (t.id === marketTab ? '.on' : ''), {
          onclick: () => { if (marketTab !== t.id) { sfx('click'); marketTab = t.id; marketFocus = null; render(true); const sx = inner.querySelector('.scroll-x'); if (sx) sx.scrollLeft = 0; } },
        }, icon(ic, 38), h('span', t.label), offerBang ? h('span.bang', '!') : null));
      }
      keepScroll(inner, () => { inner.innerHTML = ''; buildMarketTab(inner, marketTab); });
    };
    P.onUpdate = () => render(false);
    P.onTimer = () => render(false);
    render(true);
    // Bring the focused card into view (centred) once, on open.
    const fc = marketFocus && inner.querySelector('.card.focus');
    const row = fc && fc.parentNode;
    if (row && row.scrollWidth > row.clientWidth) row.scrollLeft = Math.max(0, fc.offsetLeft - (row.clientWidth - fc.offsetWidth) / 2);
  };
  /** Market tab + card a story goal points at (null when the market does not help with it). */
  function marketTargetFor(g) {
    if (!g) return null;
    const pk = g.park || null;
    if (g.type === 'build' || g.type === 'own_building') {
      const b = g.building && bdef(g.building);
      if (b) return !b.fixed && MARKET_TABS.some(t => t.id === b.kind) ? { park: b.park, tab: b.kind, id: b.id } : null;
      if (g.kind && MARKET_TABS.some(t => t.id === g.kind)) return { park: pk, tab: g.kind, id: null };
      return null;
    }
    if (g.type === 'hatch' || g.type === 'own_species') {
      if (g.species && spdef(g.species)) return { park: spdef(g.species).park, tab: 'creatures', id: g.species };
      const p2 = pk || cur();
      // First species of that park the player can create right now.
      const id = ((PC.SPECIES_ORDER || {})[p2] || []).find(x => spdef(x) && (ecall('speciesStatus', x) || {}).state === 'available');
      return { park: p2, tab: 'creatures', id: id || null };
    }
    return null;
  }
  /** Open the market on what a story goal asks for (switching park first when needed). */
  function openMarketForGoal(g) {
    const t = marketTargetFor(g);
    if (!t) return false;
    cancelPlacement();
    const go = () => UI.openMarket(t.tab, t.id);
    if (t.park && t.park !== cur()) {
      const st = ecall('parkStatus', t.park);
      if (st && !st.unlocked) return false;
      goToPark(t.park, go);
    } else go();
    return true;
  }
  function hasFreshOffer() {
    const o = ecall('offerInfo');
    return !!(o && !o.owned && spdef(o.speciesId) && spdef(o.speciesId).park === cur());
  }
  /** Cheap signature of what market cards depend on (rebuild only when it changes). */
  function marketSig() {
    const s = S();
    if (!s) return '';
    const p = s.player;
    const off = ecall('offerInfo');
    const owned = [];
    for (const o of ecall('objects', cur()) || []) if (o.type === 'enclosure') owned.push(o.speciesId);
    return [cur(), marketTab, p.level, p.coins, p.dollars, p[park().food], off ? off.speciesId + off.label : '-', owned.join(','),
      JSON.stringify(s.researched || {}), JSON.stringify(s.researchProgress || {}), s.research ? s.research.speciesId + s.research.result : '-'].join('|');
  }
  function buildMarketTab(inner, tab) {
    const t = MARKET_TABS.find(x => x.id === tab) || MARKET_TABS[0];
    const ic = tab === 'food' ? resIcon(park().food || 'food_land') : t.icon;
    const hints = {
      creatures: 'Achète un œuf : il éclora dans un enclos.',
      coins: 'Les commerces produisent des pièces tout seuls.',
      food: 'Active une livraison pour récolter de la nourriture.',
      deco: 'Embellis ton parc et gagne de l’expérience.',
      road: 'Trace des allées pour tes visiteurs.',
    };
    inner.append(h('div.sec-head', h('span.plate', icon(ic, 28), t.title.toUpperCase() + ' · ' + park().name), h('span.hint', hints[tab] || '')));
    const row = wheelX(h('div.cards-row.scroll-x', { 'data-sk': 'm-' + tab }));
    inner.append(row);
    const focusId = marketFocus && marketFocus.tab === tab ? marketFocus.id : null;
    const add = (card, id) => {
      card.dataset.id = id;
      if (id === focusId) card.classList.add('focus');
      row.append(card);
    };
    if (tab === 'creatures') {
      const off = ecall('offerInfo');
      if (off && spdef(off.speciesId)) add(creatureCard(off.speciesId, off), off.speciesId);
      // Species still to create come first; « Déjà créé » ones go to the end of the row.
      const ids = ((PC.SPECIES_ORDER || {})[cur()] || []).filter(id => spdef(id) && !spdef(id).offerOnly && !(off && off.speciesId === id));
      const owned = id => (ecall('speciesStatus', id) || {}).state === 'owned';
      for (const id of ids.filter(id => !owned(id)).concat(ids.filter(owned))) add(creatureCard(id, null), id);
    } else {
      const list = Object.values(D().BUILDINGS || {}).filter(b => b.park === cur() && b.kind === tab && !b.fixed && b.kind !== 'special')
        .sort((a, b) => a.level - b.level || ((a.cost || {}).coins || 0) - ((b.cost || {}).coins || 0));
      for (const b of list) add(buildingCard(b), b.id);
      if (!list.length) row.append(h('div.muted', { style: { padding: '20px' } }, 'Rien à vendre ici pour le moment.'));
    }
  }
  function rarityTag(r) {
    const R2 = rarityOf(r);
    return h('span.rtag', { style: { background: R2.color } }, R2.name.toUpperCase());
  }
  function creatureCard(id, offer) {
    const sp = spdef(id);
    const st = ecall('speciesStatus', id) || { state: 'available', needLevel: sp.level, price: sp.price };
    const price = st.price && Object.keys(st.price).length ? st.price : (ecall('creaturePrice', id) || sp.price);
    const card = h('div.card.r-' + sp.rarity + (offer ? '.offer' : ''));
    if (offer) card.append(h('div.ribbon', 'OFFRE LIMITÉE'), h('span.bang', '!'));
    card.append(h('div.cn', sp.name), h('div.cr', rarityOf(sp.rarity).name));
    const ci = h('div.ci');
    const locked = st.state === 'level' || st.state === 'park';
    ci.append(h('img.art', { src: portraitURL(id, 304, 300, { stage: 2 }), alt: sp.name, draggable: 'false' }));
    ci.append(h('img.cls', { src: iconURL(sp.cls, 26), alt: clsOf(sp.cls).name, title: clsOf(sp.cls).name }));
    if (offer) ci.append(h('span.ytag', offer.label || ''));
    if (locked) ci.append(h('div.lockov', icon('lock', 40), 'Niveau ' + (st.needLevel || sp.level)));
    else if (st.state === 'research' || st.state === 'researching') {
      const steps = st.steps || ecall('researchSteps', id) || { done: 0, steps: 0 };
      ci.append(h('div.lockov', icon('dna', 40), st.state === 'researching' ? 'Recherche en cours…' : 'ADN ' + steps.done + ' / ' + steps.steps));
    } else if (st.state === 'owned') ci.append(h('div.done', 'Déjà créé'));
    card.append(ci);
    const stats = PC.statsAt ? PC.statsAt(id, 1) : null;
    card.append(h('div.cinfo',
      stats ? h('span', icon('coin', 18), '+' + fmt(stats.coinsPerMin) + '/min') : null,
      h('span', icon('clock', 18), fmtDur(sp.hatchSec || 10))));
    if (st.state === 'owned') {
      card.append(h('div.owned', icon('check', 22), 'Déjà créé'));
    } else if (locked) {
      card.append(h('button.b.b-dark.cb', { onclick: () => { sfx('error'); toast(st.state === 'park' ? 'Débloque d’abord le ' + park(sp.park).name + '.' : 'Atteins le niveau ' + (st.needLevel || sp.level) + ' pour créer cette espèce.', 'info'); } }, icon('lock', 20), 'Niv. ' + (st.needLevel || sp.level)));
    } else if (st.state === 'research' || st.state === 'researching') {
      card.append(h('button.b.b-blue.cb', { onclick: () => { sfx('click'); UI.openLab(id); } }, icon('dna', 22), 'Labo ADN'));
    } else if (st.state === 'offer_only') {
      card.append(h('div.owned', 'Offre spéciale'));
    } else {
      const afford = canAfford(price);
      const elsewhere = sp.park !== cur();
      const btn = h('button.b.cb' + (price.dollars ? '.b-orange' : ''), {
        onclick: () => {
          if (elsewhere) { sfx('click'); goToPark(sp.park, () => UI.openMarket('creatures')); return; }
          if (!canAfford(price)) { sfx('error'); toast(missingText(price), 'bad'); return; }
          sfx('click');
          UI.startPlacement({ kind: 'creature', speciesId: id });
        },
      }, elsewhere ? 'Aller au parc' : pricePill(price));
      if (!afford && !elsewhere) btn.style.filter = 'grayscale(.6) brightness(.8)';
      card.append(btn);
    }
    return card;
  }
  function buildingCard(b) {
    const lvl = ((S() || {}).player || {}).level || 1;
    const card = h('div.card');
    card.append(h('div.cn', b.name));
    const ci = h('div.ci', h('img.bart', { src: thumbURL(b.art || b.id, 220, 200), alt: b.name, draggable: 'false' }));
    const locked = lvl < (b.level || 1);
    if (locked) ci.append(h('div.lockov', icon('lock', 40), 'Niveau ' + b.level));
    card.append(ci);
    const info = h('div.cinfo');
    if (b.produce) {
      if (b.kind === 'food' && b.orders && b.orders.length) info.append(h('span', icon(resIcon(b.produce.res), 18), '+' + fmt(b.orders[0].amount) + ' / ' + fmtDur(b.orders[0].sec)));
      else info.append(h('span', icon(resIcon(b.produce.res), 18), '+' + fmt(b.produce.amount) + ' / ' + fmtDur(b.produce.sec)));
    } else if (b.xp) info.append(h('span', icon('xp', 18), '+' + fmt(b.xp) + ' XP'));
    else info.append(h('span', b.size[0] + '×' + b.size[1]));
    card.append(info);
    if (locked) {
      card.append(h('button.b.b-dark.cb', { onclick: () => { sfx('error'); toast('Atteins le niveau ' + b.level + ' pour construire : ' + b.name + '.', 'info'); } }, icon('lock', 20), 'Niv. ' + b.level));
    } else {
      const btn = h('button.b.cb', {
        onclick: () => {
          if (!canAfford(b.cost)) { sfx('error'); toast(missingText(b.cost), 'bad'); return; }
          sfx('click');
          UI.startPlacement({ kind: 'building', buildingId: b.id });
        },
      }, pricePill(b.cost));
      if (!canAfford(b.cost)) btn.style.filter = 'grayscale(.6) brightness(.8)';
      card.append(btn);
    }
    return card;
  }
  /** Switch to another (unlocked) park, then run `then`. */
  function goToPark(p, then) {
    const st = ecall('parkStatus', p);
    if (st && !st.unlocked) { UI.openParks(); return; }
    const res = ecall('setPark', p);
    if (!okRes(res)) { failToast(res); return; }
    if (then) setTimeout(then, 60);
  }


  // ===========================================================================
  // LABO ADN — Recherche (multi-step) + Expéditions
  // ===========================================================================
  let labTab = 'research', labSel = null, expSel = null, labBoost = false;
  let labFx = null; // {kind: 'success'|'fail', at: ms, speciesId}
  const nowMs = () => performance.now();
  function speedUpPreview(sec) {
    try { if (typeof D().speedUpCost === 'function') return Math.max(1, Math.round(D().speedUpCost(sec))); } catch (e) { /* fallback */ }
    return Math.max(1, Math.ceil(Math.max(0, sec) / 60));
  }
  function researchList(p) {
    return ((PC.SPECIES_ORDER || {})[p] || []).filter(id => spdef(id) && spdef(id).research);
  }

  UI.openLab = function (speciesId, tab) {
    if (speciesId && spdef(speciesId)) { labSel = speciesId; labTab = 'research'; }
    if (tab) labTab = tab;
    const P = openPanel('lab', 'LABO ADN');
    const inner = h('div.inner');
    P.body.append(inner);
    let key = '';
    const render = force => {
      const k = labKey();
      if (!force && k === key) { labLive(); return; }
      key = k;
      keepScroll(inner, () => {
        inner.innerHTML = '';
        const s = S() || {};
        const expBang = s.expedition && s.expedition.result != null ? '!' : ecall('promoInfo') ? '%' : 0;
        const resBang = s.research && s.research.result === false ? '!' : 0;
        inner.append(htabs([
          { id: 'research', label: 'Recherche', icon: 'dna', bang: resBang },
          { id: 'expedition', label: 'Expéditions', icon: 'amber', bang: expBang },
        ], labTab, id => { labTab = id; render(true); }), h('div.tabline'));
        if (labTab === 'expedition') buildExpeditionTab(inner); else buildResearchTab(inner);
      });
      labLive();
    };
    P.onUpdate = () => render(false);
    P.onTimer = () => render(false);
    P.rerender = () => render(true);
    render(true);
  };
  /** Rebuild key: everything that changes the lab's buttons/layout. */
  function labKey() {
    const s = S() || {};
    const r = s.research, x = s.expedition, pr = ecall('promoInfo');
    return [labTab, labSel, expSel, labBoost, cur(), (s.player || {}).level, r ? [r.speciesId, r.result, r.step, r.complete].join(',') : '-',
      x ? [x.speciesId, x.result].join(',') : '-', pr ? 1 : 0, JSON.stringify(s.researchProgress || {}), JSON.stringify(s.researched || {}),
      labFx ? labFx.kind : '-', Math.floor(((s.player || {}).coins || 0) / 1000), (s.player || {}).dollars].join('|');
  }
  let labRefs = {};
  /** Live (per-second) bits: timers and progress bars. */
  function labLive() {
    const s = S() || {};
    const t = ecall('now') || Date.now();
    if (labRefs.rBar && s.research && s.research.result === null) {
      const r = s.research, tot = Math.max(1, r.endsAt - r.startedAt), rem = Math.max(0, r.endsAt - t);
      labRefs.rBar.firstChild.style.width = Math.round(clamp(1 - rem / tot, 0, 1) * 100) + '%';
      labRefs.rBar.lastChild.textContent = fmtTime(rem / 1000);
      if (labRefs.rSpeed) labRefs.rSpeed.querySelector('.pill').lastChild.textContent = fmt(speedUpPreview(rem / 1000));
    }
    if (labRefs.xBar && s.expedition && s.expedition.result === null) {
      const x = s.expedition, tot = Math.max(1, x.endsAt - x.startedAt), rem = Math.max(0, x.endsAt - t);
      labRefs.xBar.firstChild.style.width = Math.round(clamp(1 - rem / tot, 0, 1) * 100) + '%';
      labRefs.xBar.lastChild.textContent = 'Retour dans ' + fmtTime(rem / 1000);
      if (labRefs.xSpeed) labRefs.xSpeed.querySelector('.pill').lastChild.textContent = fmt(speedUpPreview(rem / 1000));
    }
    if (labRefs.promo) {
      const pr = ecall('promoInfo');
      if (pr) labRefs.promo.lastChild.textContent = fmtTime(pr.remainingSec);
    }
  }

  // ----- Recherche tab -----
  function buildResearchTab(inner) {
    labRefs = {};
    const s = S() || {};
    const list = researchList(cur());
    const wrap = h('div.lab-wrap.scroll-y', { 'data-sk': 'lab-r' });
    inner.append(wrap);
    if (!list.length) { wrap.append(h('div.muted', { style: { padding: '20px' } }, 'Aucune espèce à rechercher dans ce parc.')); return; }
    const r = s.research;
    if (!labSel || !list.includes(labSel)) {
      labSel = (r && list.includes(r.speciesId) && r.speciesId) ||
        list.find(id => (ecall('speciesStatus', id) || {}).state === 'research') || list.find(id => !(ecall('researchInfo', id) || {}).complete) || list[0];
    }
    const sel = labSel, sp = spdef(sel);
    const ri = ecall('researchInfo', sel) || { done: 0, steps: 3, chance: (sp.research || {}).chance || 50, boostedChance: 70, cost: { coins: 0 }, boostCost: { dollars: 5 }, retryCost: { dollars: 1 } };
    const st = ecall('speciesStatus', sel) || { state: 'research' };
    const main = h('div.lab-main');
    const side = h('div.lab-side');
    wrap.append(main, side);

    // species chips
    const strip = wheelX(h('div.sp-strip.scroll-x', { 'data-sk': 'lab-strip' }));
    for (const id of list) {
      const i2 = ecall('researchInfo', id) || {};
      const st2 = ecall('speciesStatus', id) || {};
      const lockedLv = st2.state === 'level' || st2.state === 'park';
      const badge = i2.complete ? 'check' : lockedLv ? 'lock' : (r && r.speciesId === id && r.result === null) ? 'clock' : null;
      strip.append(h('button.sp-chip' + (id === sel ? '.on' : ''), { title: spdef(id).name, onclick: () => { if (labSel !== id) { sfx('click'); labSel = id; labFx = null; panel && panel.rerender && panel.rerender(); } } },
        h('img', { src: portraitURL(id, 156, 108, { stage: 2, silhouette: !i2.complete }), alt: '' }),
        h('div.n', spdef(id).name), badge ? h('img.st', { src: iconURL(badge, 24), alt: '' }) : null));
    }
    main.append(strip);

    // DNA helix progress bar
    const helix = h('canvas.helix-bar');
    main.append(helix);
    const running = !!(r && r.speciesId === sel && r.result === null);
    animCanvas(helix, (c, w, hh, t) => {
      const info = ecall('researchSteps', sel) || { done: ri.done, steps: ri.steps };
      drawHelixBar(c, w, hh, t, info.done, info.steps || 1, running);
    });

    // portrait + controls
    const mid = h('div.lab-mid');
    const pcv = h('canvas');
    const done = ri.done, steps = Math.max(1, ri.steps);
    const pinfo = h('div', h('div.cp-name', { style: { fontSize: '19px' } }, sp.name),
      h('div.cp-sub', rarityTag(sp.rarity), h('span', icon(sp.cls, 20)), h('span', clsOf(sp.cls).name)),
      h('div.lab-status', 'Étape ', h('b', Math.min(steps, done + (ri.complete ? 0 : 1)) + ' / ' + steps), ri.complete ? ' · terminée' : ''));
    mid.append(h('div.lab-portrait', pcv, pinfo));
    animCanvas(pcv, (c, w, hh, t) => drawLabPortrait(c, w, hh, t, sel, running));

    const ctrl = h('div.lab-ctrl');
    const tubes = h('canvas.tubes');
    ctrl.append(tubes);
    animCanvas(tubes, (c, w, hh, t) => {
      const info = ecall('researchSteps', sel) || { done: ri.done, steps: ri.steps };
      const rr2 = (S() || {}).research;
      let prog = 0;
      if (rr2 && rr2.speciesId === sel && rr2.result === null) prog = clamp(1 - (rr2.endsAt - (ecall('now') || Date.now())) / Math.max(1, rr2.endsAt - rr2.startedAt), 0, 1);
      drawTubes(c, w, hh, t, info.done, info.steps || 1, rr2 && rr2.speciesId === sel && rr2.result === null ? prog : -1,
        labFx && labFx.speciesId === sel && nowMs() - labFx.at < 1600 ? labFx.kind : null);
    });
    const status = h('div.lab-status');
    const actions = h('div.lab-actions');
    ctrl.append(status, actions);
    mid.append(ctrl);
    main.append(mid);

    const otherRun = r && r.result === null && r.speciesId !== sel;
    const x = s.expedition;
    if (ri.complete || st.state === 'owned' || st.state === 'available') {
      status.append(h('b', 'Recherche terminée ! '), 'Tu peux créer cette espèce au marché.');
      actions.append(h('button.b.b-lg', { onclick: () => { sfx('click'); goMarketFor(sel); } }, icon('market', 26), 'Aller au marché'));
    } else if (st.state === 'level' || st.state === 'park') {
      status.append(icon('lock', 18), ' ', st.state === 'park' ? 'Débloque d’abord le ' + park(sp.park).name + '.' : 'Atteins le niveau ' + sp.level + ' pour rechercher cette espèce.');
    } else if (running) {
      status.append(h('b', 'Séquençage en cours… '), 'étape ' + (done + 1) + ' sur ' + steps + ' · chance ' + r.chance + ' %');
      const bar = h('div.bar.blue', { style: { height: '22px' } }, h('i'), h('span', ''));
      labRefs.rBar = bar;
      ctrl.insertBefore(bar, actions);
      const rem = Math.max(0, (r.endsAt - (ecall('now') || Date.now())) / 1000);
      const sb = h('button.b.b-blue', { onclick: () => { sfx('click'); const res = ecall('speedUpResearch'); if (!okRes(res)) failToast(res); } }, icon('speed', 22), 'Accélérer', pricePill({ dollars: speedUpPreview(rem) }));
      labRefs.rSpeed = sb;
      actions.append(sb);
    } else if (otherRun) {
      status.append('Le labo séquence déjà l’ADN ', h('b', du(spdef(r.speciesId).name)), '.');
      actions.append(h('button.b.b-steel', { onclick: () => { sfx('click'); labSel = r.speciesId; panel && panel.rerender && panel.rerender(); } }, 'Voir la recherche'));
    } else if (x && x.speciesId === sel && x.result === null) {
      status.append('Une expédition cherche déjà cet ADN dans la nature.');
      actions.append(h('button.b.b-steel', { onclick: () => { sfx('click'); labTab = 'expedition'; panel && panel.rerender && panel.rerender(); } }, icon('amber', 22), 'Voir l’expédition'));
    } else {
      const failed = r && r.speciesId === sel && r.result === false;
      const succeeded = r && r.speciesId === sel && r.result === true;
      if (failed) status.append(h('b', { style: { color: '#ff8a78' } }, 'Échec ! '), 'L’ADN de cette étape était trop abîmé. Réessaie !');
      else if (succeeded) status.append(h('b', { style: { color: '#9be05a' } }, 'Étape ' + done + ' réussie ! '), 'Continue le séquençage.');
      else status.append('Chance de réussite : ', h('b', ri.chance + ' %'), ' · avec le boost : ', h('b', ri.boostedChance + ' %'));
      const cost = Object.assign({}, ri.cost);
      if (labBoost) for (const k in ri.boostCost || {}) cost[k] = (cost[k] || 0) + ri.boostCost[k];
      if (failed) {
        actions.append(h('button.b.b-orange.b-sm', { onclick: () => {
          sfx('click');
          const res = ecall('retryResearch');
          if (!okRes(res)) failToast(res); else labFx = null;
        } }, icon('restart', 20), 'Réessayer', pricePill(ri.retryCost || { dollars: 1 })));
      }
      actions.append(h('button.b.b-yellow.b-lg', { onclick: () => {
        if (!canAfford(cost)) { sfx('error'); toast(missingText(cost), 'bad'); return; }
        sfx('click');
        labFx = null;
        const res = ecall('startResearch', sel, labBoost);
        if (!okRes(res)) failToast(res);
      } }, icon('dna', 26), 'Tenter la recherche', h('span.pill', icon('coin', 20), fmt(cost.coins || 0), cost.dollars ? h('span', ' + ', icon('dollar', 18), fmt(cost.dollars)) : null)));
      const box = h('span.box', labBoost ? '✓' : '');
      actions.append(h('button.boost', { onclick: () => { sfx('click'); labBoost = !labBoost; panel && panel.rerender && panel.rerender(); } },
        box, h('span', 'Boost +' + Math.max(0, ri.boostedChance - ri.chance) + ' % ', icon('dollar', 18), fmt((ri.boostCost || {}).dollars || 5))));
    }

    // assistants
    side.append(h('div.plate', { style: { fontSize: '14px', justifyContent: 'center' } }, 'ASSISTANTS'));
    const lookE = npcOf('elise');
    const a1 = h('canvas');
    animCanvas(a1, (c, w, hh, t) => { if (PC.ART && PC.ART.drawNPC) PC.ART.drawNPC(c, lookE.look, 0, 0, w, hh, t); });
    side.append(h('div.assist', a1, h('div.an', lookE.name || 'Dr Élise Morel'), h('div.ar', '+ chance de réussite')));
    for (let i = 0; i < 2; i++) {
      const cv = h('canvas');
      animCanvas(cv, (c, w, hh) => drawEmptySlot(c, w, hh));
      side.append(h('div.assist', cv, h('div.an', 'Place libre'), h('div.ar', 'Bientôt : aide des amis')));
    }
  }
  function goMarketFor(speciesId) {
    const sp = spdef(speciesId);
    const go = () => UI.openMarket('creatures', sp ? speciesId : null);
    if (sp && sp.park !== cur()) goToPark(sp.park, go);
    else go();
  }

  // ----- research visuals -----
  function drawHelixBar(c, w, hh, t, done, steps, running) {
    const x0 = 16, x1 = w - 16, cy = hh / 2, amp = hh * 0.26;
    rr(c, 3, 5, w - 6, hh - 10, (hh - 10) / 2);
    fs(c, lin(c, 0, 5, 0, hh - 5, [[0, '#070a0c'], [1, '#1b242b']]), '#000', 2);
    c.save(); rr(c, 3, 5, w - 6, hh - 10, (hh - 10) / 2); c.clip();
    const frac = clamp(done / steps, 0, 1), xf = x0 + (x1 - x0) * frac;
    const xr = running ? x0 + (x1 - x0) * Math.min(1, (done + 1) / steps) : xf;
    if (frac > 0) { c.fillStyle = lin(c, x0, 0, xf, 0, [[0, 'rgba(90,255,120,.10)'], [1, 'rgba(255,220,60,.28)']]); c.fillRect(0, 0, xf, hh); }
    if (running) { c.fillStyle = `rgba(90,200,255,${0.08 + 0.08 * Math.sin(t * 6)})`; c.fillRect(xf, 0, xr - xf, hh); }
    const ph = x => x * 0.055 - t * 2.4;
    // rungs
    const N = Math.max(8, Math.floor((x1 - x0) / 8));
    for (let i = 0; i <= N; i++) {
      const x = x0 + (x1 - x0) * i / N, s1 = Math.sin(ph(x));
      const on = x <= xf + 0.5, act = running && x > xf && x <= xr;
      c.strokeStyle = on ? `rgba(255,255,255,${0.45 + 0.35 * Math.abs(s1)})` : act ? `rgba(140,220,255,${0.3 + 0.3 * Math.sin(t * 8 + i)})` : 'rgba(120,140,155,.18)';
      c.lineWidth = 1.6;
      c.beginPath(); c.moveTo(x, cy + s1 * amp); c.lineTo(x, cy - s1 * amp); c.stroke();
    }
    // strands (back then front for depth)
    for (const front of [false, true]) {
      for (let s = 0; s < 2; s++) {
        const sign = s ? -1 : 1;
        for (let x = x0; x < x1; x += 2) {
          const a = Math.cos(ph(x)) * sign;
          if ((a > 0) !== front) continue;
          const on = x <= xf, act = running && x > xf && x <= xr;
          c.strokeStyle = on ? (s ? '#7cff5a' : '#ffd23a') : act ? (s ? '#8fe8ff' : '#c6f0ff') : '#35424c';
          c.lineWidth = front ? 3.4 : 2.4;
          c.globalAlpha = front ? 1 : 0.7;
          c.beginPath(); c.moveTo(x, cy + Math.sin(ph(x)) * amp * sign); c.lineTo(x + 2.4, cy + Math.sin(ph(x + 2.4)) * amp * sign); c.stroke();
        }
      }
    }
    c.globalAlpha = 1;
    if (frac > 0) { c.save(); c.globalCompositeOperation = 'lighter'; c.fillStyle = rad(c, xf, cy, 1, 26, [[0, 'rgba(255,240,140,.55)'], [1, 'rgba(255,240,140,0)']]); c.fillRect(xf - 26, 0, 52, hh); c.restore(); }
    c.restore();
    // step rings
    for (let i = 0; i <= steps; i++) {
      const x = x0 + (x1 - x0) * i / steps;
      if (i > 0 && i < steps) { c.fillStyle = 'rgba(0,0,0,.55)'; c.fillRect(x - 1.5, 8, 3, hh - 16); }
      ell(c, x, cy, 7.5, 7.5);
      fs(c, i <= done ? rad(c, x - 2, cy - 2, 1, 9, [[0, '#fffbe0'], [1, '#e0a010']]) : lin(c, 0, cy - 7, 0, cy + 7, STEEL_ST), '#14181b', 1.5);
    }
  }
  function drawTubes(c, w, hh, t, done, steps, prog, fx) {
    const n = steps, gap = 10;
    const tw = Math.min(64, (w - gap * (n + 1)) / n), tx0 = (w - (tw * n + gap * (n - 1))) / 2;
    const top = 14, bot = hh - 22;
    for (let i = 0; i < n; i++) {
      const x = tx0 + i * (tw + gap), cx = x + tw / 2;
      const isDone = i < done, isCur = i === done && prog >= 0;
      // back glass
      rr(c, x + 4, top, tw - 8, bot - top, (tw - 8) / 2);
      fs(c, lin(c, x, 0, x + tw, 0, [[0, 'rgba(160,200,220,.18)'], [0.5, 'rgba(20,30,36,.5)'], [1, 'rgba(160,200,220,.12)']]), null);
      // liquid
      let lvl = isDone ? 1 : isCur ? 0.15 + 0.85 * prog : 0.08;
      const ly = bot - (bot - top - 8) * lvl;
      c.save(); rr(c, x + 6, top + 2, tw - 12, bot - top - 4, (tw - 12) / 2); c.clip();
      const liq = isDone ? ['#e8ff6a', '#5ad22a'] : isCur ? ['#8fe8ff', '#2a8ad8'] : ['#2a3640', '#1a2228'];
      c.fillStyle = lin(c, 0, ly, 0, bot, [[0, liq[0]], [1, liq[1]]]);
      c.fillRect(x, ly, tw, bot - ly);
      if (isDone || isCur) {
        // bubbles
        c.fillStyle = 'rgba(255,255,255,.55)';
        for (let b = 0; b < 6; b++) {
          const ph = (t * (isCur ? 0.9 : 0.4) + b / 6 + i * 0.13) % 1;
          const by = bot - (bot - ly) * ph, bx = cx + Math.sin(b * 2.1 + t * 2) * (tw * 0.22);
          if (by > ly) { ell(c, bx, by, 1.6 + (b % 3), 1.6 + (b % 3)); c.fill(); }
        }
      }
      // helix inside
      const spin = t * (isCur ? 5 : isDone ? 1.6 : 0.4);
      const ampx = (tw - 18) * 0.32;
      for (let s = 0; s < 2; s++) {
        c.strokeStyle = isDone ? (s ? '#ffffff' : '#fff27a') : isCur ? (s ? '#e6faff' : '#ffe680') : 'rgba(140,160,175,.35)';
        c.lineWidth = isDone || isCur ? 2.2 : 1.4;
        c.beginPath();
        for (let y = top + 10; y <= bot - 8; y += 2) { const xx = cx + Math.sin(y * 0.14 + spin + s * Math.PI) * ampx; if (y === top + 10) c.moveTo(xx, y); else c.lineTo(xx, y); }
        c.stroke();
      }
      c.restore();
      // glow when done
      if (isDone || (fx && i === done - 1 && fx === 'success')) {
        c.save(); c.globalCompositeOperation = 'lighter';
        c.fillStyle = rad(c, cx, (top + bot) / 2, 4, tw, [[0, 'rgba(200,255,90,.35)'], [1, 'rgba(200,255,90,0)']]);
        c.fillRect(x - tw / 2, top - 10, tw * 2, bot - top + 20); c.restore();
      }
      if (fx === 'fail' && i === done) {
        c.save(); c.globalAlpha = 0.5 + 0.4 * Math.sin(t * 20); rr(c, x + 4, top, tw - 8, bot - top, (tw - 8) / 2); c.fillStyle = 'rgba(255,60,40,.55)'; c.fill(); c.restore();
      }
      // glass highlight + outline
      rr(c, x + 4, top, tw - 8, bot - top, (tw - 8) / 2);
      c.strokeStyle = 'rgba(220,240,255,.75)'; c.lineWidth = 2; c.stroke();
      c.fillStyle = 'rgba(255,255,255,.22)'; c.fillRect(x + 9, top + 10, 3, bot - top - 26);
      // steel caps
      rr(c, x, top - 8, tw, 12, 3); fs(c, lin(c, 0, top - 8, 0, top + 4, STEEL_ST), '#14181b', 1.4);
      rr(c, x, bot - 4, tw, 12, 3); fs(c, lin(c, 0, bot - 4, 0, bot + 8, STEEL_ST), '#14181b', 1.4);
      // label
      c.font = '13px "Russo One", sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillStyle = isDone ? '#ffe066' : '#c3ccd3'; c.fillText(isDone ? '✓' : String(i + 1), cx, hh - 6);
    }
  }
  const silCache = new Map();
  function drawLabPortrait(c, w, hh, t, id, running) {
    const sp = spdef(id);
    // screen background with grid
    c.fillStyle = rad(c, w / 2, hh * 0.45, 10, w * 0.7, [[0, '#14403f'], [1, '#061214']]);
    c.fillRect(0, 0, w, hh);
    c.strokeStyle = 'rgba(90,220,200,.12)'; c.lineWidth = 1;
    for (let x = 0; x < w; x += 16) { c.beginPath(); c.moveTo(x + 0.5, 0); c.lineTo(x + 0.5, hh); c.stroke(); }
    for (let y = 0; y < hh; y += 16) { c.beginPath(); c.moveTo(0, y + 0.5); c.lineTo(w, y + 0.5); c.stroke(); }
    if (!sp || !PC.ART || !PC.ART.portrait) return;
    const info = ecall('researchSteps', id) || { done: 0, steps: 1 };
    const complete = !!((S() || {}).researched || {})[id] || (info.steps && info.done >= info.steps);
    const pw = Math.round(w * 0.92), ph2 = Math.round(hh * 0.9);
    const dpr = DPR();
    const col = PC.ART.portrait(id, Math.round(pw * dpr), Math.round(ph2 * dpr), { stage: 2, bg: false });
    const sil = PC.ART.portrait(id, Math.round(pw * dpr), Math.round(ph2 * dpr), { stage: 2, bg: false, silhouette: true });
    const px = (w - pw) / 2, py = (hh - ph2) / 2 + 4;
    const jitter = running && Math.sin(t * 37) > 0.93 ? (Math.random() - 0.5) * 6 : 0;
    c.save();
    c.shadowColor = 'rgba(80,230,255,.85)'; c.shadowBlur = 12;
    c.drawImage(sil, px + jitter, py, pw, ph2);
    c.restore();
    // colour revealed from the bottom up, one slice per successful step
    const frac = complete ? 1 : clamp(info.done / Math.max(1, info.steps), 0, 1);
    if (frac > 0) {
      c.save();
      c.beginPath(); c.rect(0, py + ph2 * (1 - frac), w, ph2 * frac + 10); c.clip();
      c.drawImage(col, px + jitter, py, pw, ph2);
      c.restore();
      if (!complete) {
        const ly = py + ph2 * (1 - frac);
        c.strokeStyle = 'rgba(255,230,90,.85)'; c.lineWidth = 2; c.setLineDash([6, 4]);
        c.beginPath(); c.moveTo(4, ly); c.lineTo(w - 4, ly); c.stroke(); c.setLineDash([]);
      }
    }
    if (running) {
      const sy = (t * 90) % (hh + 40) - 20;
      c.save(); c.globalCompositeOperation = 'lighter';
      c.fillStyle = lin(c, 0, sy - 18, 0, sy + 18, [[0, 'rgba(90,255,200,0)'], [0.5, 'rgba(90,255,200,.45)'], [1, 'rgba(90,255,200,0)']]);
      c.fillRect(0, sy - 18, w, 36); c.restore();
      c.fillStyle = 'rgba(160,255,230,.9)'; c.font = '11px "Russo One", sans-serif'; c.textAlign = 'left';
      c.fillText('SÉQUENÇAGE' + '...'.slice(0, 1 + Math.floor(t * 3) % 3), 8, 16);
    }
    // result flash
    if (labFx && labFx.speciesId === id) {
      const age = (nowMs() - labFx.at) / 1000;
      if (labFx.kind === 'success' && age < 1.4) {
        c.save(); c.globalCompositeOperation = 'lighter'; c.globalAlpha = clamp(1 - age / 1.4, 0, 1);
        c.fillStyle = rad(c, w / 2, hh / 2, 4, w * 0.7, [[0, 'rgba(255,255,200,.95)'], [1, 'rgba(255,220,80,0)']]); c.fillRect(0, 0, w, hh); c.restore();
      }
      if (labFx.kind === 'fail') {
        c.fillStyle = `rgba(120,10,0,${0.25 + 0.1 * Math.sin(t * 6)})`; c.fillRect(0, 0, w, hh);
        c.save(); c.translate(w / 2, hh / 2); c.rotate(-0.18);
        const sc = age < 0.3 ? 1.8 - age / 0.3 * 0.8 : 1;
        c.scale(sc, sc);
        c.font = '30px "Russo One", sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.lineWidth = 6; c.strokeStyle = '#3a0402'; c.strokeText('ÉCHEC', 0, 0);
        c.fillStyle = '#ff5a48'; c.fillText('ÉCHEC', 0, 0);
        rr(c, -78, -24, 156, 48, 8); c.strokeStyle = '#ff5a48'; c.lineWidth = 3; c.stroke();
        c.restore();
      }
    }
    // scanlines
    c.fillStyle = 'rgba(0,0,0,.12)';
    for (let y = 0; y < hh; y += 3) c.fillRect(0, y, w, 1);
  }
  function drawEmptySlot(c, w, hh) {
    c.fillStyle = lin(c, 0, 0, 0, hh, [[0, '#2a333a'], [1, '#14191d']]); c.fillRect(0, 0, w, hh);
    const cx = w / 2, s = Math.min(w, hh) / 100;
    c.fillStyle = 'rgba(120,135,145,.35)';
    ell(c, cx, hh * 0.38, 16 * s, 18 * s); c.fill();
    c.beginPath(); c.moveTo(cx - 34 * s, hh); c.quadraticCurveTo(cx - 32 * s, hh * 0.62, cx, hh * 0.6); c.quadraticCurveTo(cx + 32 * s, hh * 0.62, cx + 34 * s, hh); c.fill();
    c.font = Math.round(26 * s) + 'px "Russo One", sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillStyle = 'rgba(255,255,255,.55)'; c.fillText('?', cx, hh * 0.39);
  }

  // ----- Expéditions tab -----
  function buildExpeditionTab(inner) {
    labRefs = {};
    const s = S() || {};
    const wrap = h('div.lab-wrap.scroll-y', { 'data-sk': 'lab-x', style: { flexDirection: 'column' } });
    inner.append(wrap);
    const pr = ecall('promoInfo');
    if (pr) {
      const tm = h('span', fmtTime(pr.remainingSec));
      labRefs.promo = h('div.promo-banner', icon('amber', 28), h('span', { style: { flex: 1 } }, 'EXPÉDITION FLASH ! −' + Math.round(pr.discount * 100) + ' %'), tm);
      wrap.append(labRefs.promo);
    }
    const x = s.expedition;
    const targets = ecall('expeditionTargets', cur()) || [];
    if (x) expSel = x.speciesId;
    else if (!expSel || !targets.includes(expSel)) expSel = targets[0] || null;
    const exPark = x ? x.park : cur();
    const scene = h('canvas.exp-scene');
    wrap.append(scene);
    animCanvas(scene, (c, w, hh, t) => {
      const xx = (S() || {}).expedition;
      let phase = 'idle', prog = 0;
      if (xx) {
        if (xx.result === null) { phase = 'run'; prog = clamp(1 - (xx.endsAt - (ecall('now') || Date.now())) / Math.max(1, xx.endsAt - xx.startedAt), 0, 1); }
        else phase = xx.result ? 'win' : 'fail';
      }
      drawExpScene(c, w, hh, t, exPark, phase, prog);
    });
    if (!x && !targets.length) {
      wrap.append(h('div.lab-status', { style: { padding: '8px 4px' } }, 'Aucun ADN à chercher dans ce parc pour le moment : toutes les recherches disponibles sont terminées, ou il faut monter de niveau !'));
      return;
    }
    if (!x) {
      const strip = wheelX(h('div.sp-strip.scroll-x', { 'data-sk': 'exp-strip' }));
      for (const id of targets) {
        strip.append(h('button.sp-chip' + (id === expSel ? '.on' : ''), { onclick: () => { if (expSel !== id) { sfx('click'); expSel = id; panel && panel.rerender && panel.rerender(); } } },
          h('img', { src: portraitURL(id, 156, 108, { stage: 2, silhouette: true }), alt: '' }), h('div.n', spdef(id).name)));
      }
      wrap.append(h('div.sec-head', { style: { padding: '2px 2px 0' } }, h('span.plate', { style: { fontSize: '14px' } }, icon('amber', 24), 'DESTINATION'), h('span.hint', 'Choisis l’ADN à chercher dans la nature.')), strip);
    }
    const sp = spdef(expSel);
    if (!sp) return;
    const info = ecall('expeditionInfo', exPark, expSel) || { cost: { coins: 0 }, durationSec: 60, chance: 50, buyDollars: 5, vehicle: '' };
    const costEl = h('b', icon('coin', 20), fmt((x ? x.cost : info.cost).coins || 0));
    if (!x && info.discount) costEl.append(h('span.strike', ' ' + fmt(info.baseCost.coins)));
    wrap.append(h('div.kv',
      h('div', h('small', 'Destination'), h('b', sp.name)),
      h('div', h('small', 'Véhicule'), h('b', (x && x.vehicle) || info.vehicle || '—')),
      h('div', h('small', 'Durée'), h('b', icon('clock', 20), fmtDur(info.durationSec))),
      h('div', h('small', 'Chance'), h('b', icon('star', 20), ((x ? x.chance : info.chance) || 0) + ' %')),
      h('div', h('small', 'Coût'), costEl)));
    const actions = h('div.lab-actions');
    if (!x) {
      actions.append(h('button.b.b-lg', { onclick: () => {
        if (!canAfford(info.cost)) { sfx('error'); toast(missingText(info.cost), 'bad'); return; }
        sfx('click');
        const res = ecall('startExpedition', exPark, expSel);
        if (!okRes(res)) failToast(res);
      } }, icon('truck', 26), 'Lancer l’expédition', pricePill(info.cost)));
      actions.append(h('span.lab-status', 'En cas d’échec : dernière chance d’acheter l’ambre.'));
    } else if (x.result === null) {
      const bar = h('div.bar.gold', { style: { height: '24px', flex: '1 1 200px' } }, h('i'), h('span', ''));
      labRefs.xBar = bar;
      const rem = Math.max(0, (x.endsAt - (ecall('now') || Date.now())) / 1000);
      const sb = h('button.b.b-blue', { onclick: () => { sfx('click'); const res = ecall('speedUpExpedition'); if (!okRes(res)) failToast(res); } }, icon('speed', 22), 'Accélérer', pricePill({ dollars: speedUpPreview(rem) }));
      labRefs.xSpeed = sb;
      actions.append(bar, sb);
    } else if (x.result === false) {
      actions.append(h('span.lab-status', h('b', 'Rien trouvé… '), 'mais un marchand propose son ambre.'),
        h('button.b.b-orange', { onclick: () => { sfx('click'); showLastChance(); } }, icon('amber', 22), 'Dernière chance'));
    } else {
      actions.append(h('span.lab-status', h('b', { style: { color: '#9be05a' } }, 'Ambre trouvée ! '), 'La recherche est terminée.'),
        h('button.b', { onclick: () => { sfx('click'); ecall('declineExpedition'); } }, icon('ok', 22), 'Super !'));
    }
    wrap.append(actions);
  }

  // ----- expedition scene (vehicle per park) -----
  function drawExpScene(c, w, hh, t, p, phase, prog) {
    const r0 = H ? H.rng(p.length * 13 + 5) : Math.random;
    if (p === 'sea') {
      c.fillStyle = lin(c, 0, 0, 0, hh, [[0, '#2a9ad0'], [0.6, '#145a8a'], [1, '#0a2a4a']]); c.fillRect(0, 0, w, hh);
      c.save(); c.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 5; i++) {
        const x = (i / 5 + 0.1) * w + Math.sin(t * 0.4 + i) * 20;
        c.fillStyle = lin(c, 0, 0, 0, hh, [[0, 'rgba(200,240,255,.18)'], [1, 'rgba(200,240,255,0)']]);
        c.beginPath(); c.moveTo(x - 12, 0); c.lineTo(x + 12, 0); c.lineTo(x + 60, hh); c.lineTo(x + 20, hh); c.closePath(); c.fill();
      }
      c.restore();
      c.fillStyle = '#c9b27a';
      c.beginPath(); c.moveTo(0, hh * 0.82); for (let x = 0; x <= w; x += 20) c.lineTo(x, hh * 0.82 + Math.sin(x * 0.03) * 5); c.lineTo(w, hh); c.lineTo(0, hh); c.fill();
      for (let i = 0; i < 9; i++) {
        const x = r0() * w, y = hh * 0.84, s2 = 10 + r0() * 14;
        c.fillStyle = ['#e0507a', '#f08a3a', '#9a5ad0', '#4ab08a'][i % 4];
        for (let k = 0; k < 4; k++) { c.beginPath(); c.ellipse(x + (k - 1.5) * s2 * 0.35, y - s2 * (0.5 + 0.2 * (k % 2)), s2 * 0.18, s2 * 0.6, (k - 1.5) * 0.3, 0, TAU); c.fill(); }
      }
      c.fillStyle = 'rgba(255,255,255,.5)';
      for (let i = 0; i < 14; i++) { const by = hh - ((t * 30 + i * 37) % hh), bx = (i * 71) % w + Math.sin(t + i) * 6; ell(c, bx, by, 2 + (i % 3), 2 + (i % 3)); c.fill(); }
    } else if (p === 'ice') {
      c.fillStyle = lin(c, 0, 0, 0, hh, [[0, '#a8d4ee'], [0.7, '#e8f4fa'], [1, '#ffffff']]); c.fillRect(0, 0, w, hh);
      c.fillStyle = '#c6dcea';
      c.beginPath(); c.moveTo(0, hh * 0.62); for (let i = 0; i <= 8; i++) c.lineTo(i / 8 * w, hh * (0.3 + 0.18 * ((i * 7) % 3)) ); c.lineTo(w, hh * 0.62); c.fill();
      c.fillStyle = '#ffffff';
      c.beginPath(); c.moveTo(0, hh * 0.62); for (let i = 0; i <= 8; i++) c.lineTo(i / 8 * w, hh * (0.34 + 0.18 * ((i * 7) % 3))); c.lineTo(w, hh * 0.5); c.lineTo(w, hh * 0.62); c.fill();
      for (let i = 0; i < 7; i++) {
        const x = r0() * w, y = hh * (0.66 + r0() * 0.08), s2 = 14 + r0() * 12;
        c.fillStyle = '#2e5a4a'; for (let k = 0; k < 3; k++) { c.beginPath(); c.moveTo(x, y - s2 * (1.3 - k * 0.3)); c.lineTo(x + s2 * (0.3 + k * 0.12), y - s2 * (0.6 - k * 0.3)); c.lineTo(x - s2 * (0.3 + k * 0.12), y - s2 * (0.6 - k * 0.3)); c.fill(); }
        c.fillStyle = '#fff'; c.beginPath(); c.moveTo(x, y - s2 * 1.3); c.lineTo(x + s2 * 0.15, y - s2 * 1.05); c.lineTo(x - s2 * 0.15, y - s2 * 1.05); c.fill();
      }
      c.fillStyle = '#f4fbff'; c.fillRect(0, hh * 0.78, w, hh * 0.22);
      c.fillStyle = 'rgba(255,255,255,.9)';
      for (let i = 0; i < 30; i++) { const sy = (t * 24 + i * 23) % hh, sx = (i * 53 + Math.sin(t + i) * 10) % w; ell(c, sx, sy, 1.6, 1.6); c.fill(); }
    } else {
      c.fillStyle = lin(c, 0, 0, 0, hh, [[0, '#ffcf7a'], [0.5, '#f6a85a'], [1, '#b8d28a']]); c.fillRect(0, 0, w, hh);
      c.fillStyle = '#6a8a4a';
      c.beginPath(); c.moveTo(0, hh * 0.6); for (let x = 0; x <= w; x += 30) c.lineTo(x, hh * 0.55 - Math.sin(x * 0.012 + 1) * 18); c.lineTo(w, hh); c.lineTo(0, hh); c.fill();
      // volcano
      c.fillStyle = '#5a4a3a'; c.beginPath(); c.moveTo(w * 0.62, hh * 0.58); c.lineTo(w * 0.74, hh * 0.18); c.lineTo(w * 0.8, hh * 0.18); c.lineTo(w * 0.94, hh * 0.58); c.fill();
      c.fillStyle = 'rgba(90,80,80,.5)'; ell(c, w * 0.77 + Math.sin(t) * 4, hh * 0.1, 18, 10); c.fill();
      c.fillStyle = '#4a7a3a';
      c.beginPath(); c.moveTo(0, hh * 0.72); for (let x = 0; x <= w; x += 24) c.lineTo(x, hh * 0.68 - Math.abs(Math.sin(x * 0.05)) * 10); c.lineTo(w, hh); c.lineTo(0, hh); c.fill();
      for (let i = 0; i < 6; i++) {
        const x = r0() * w, y = hh * 0.72;
        c.strokeStyle = '#3a2a14'; c.lineWidth = 3; c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + 4, y - 20, x + 2, y - 34); c.stroke();
        c.fillStyle = '#2f6a2a';
        for (let k = 0; k < 5; k++) { c.beginPath(); c.ellipse(x + 2 + Math.cos(k * 1.3) * 10, y - 34 + Math.sin(k * 1.3) * 3, 13, 4, k * 1.3, 0, TAU); c.fill(); }
      }
      c.fillStyle = '#c8a46a'; c.beginPath(); c.moveTo(0, hh * 0.86); c.quadraticCurveTo(w * 0.5, hh * 0.78, w, hh * 0.88); c.lineTo(w, hh * 0.96); c.quadraticCurveTo(w * 0.5, hh * 0.88, 0, hh * 0.96); c.fill();
    }
    // base and destination markers
    const groundY = p === 'sea' ? hh * 0.8 : hh * 0.88;
    const baseX = w * 0.12, destX = w * 0.88;
    c.fillStyle = '#3a4248'; c.fillRect(baseX - 30, groundY - 4, 3, -40 + 4);
    c.fillStyle = '#f6c21b'; c.beginPath(); c.moveTo(baseX - 27, groundY - 40); c.lineTo(baseX - 8, groundY - 34); c.lineTo(baseX - 27, groundY - 28); c.fill();
    // destination: amber glow
    const glow = phase === 'win' ? 1 : 0.45 + 0.2 * Math.sin(t * 3);
    c.save(); c.globalCompositeOperation = 'lighter';
    c.fillStyle = rad(c, destX, groundY - 20, 2, 44, [[0, `rgba(170,140,255,${0.5 * glow})`], [1, 'rgba(170,140,255,0)']]); c.fillRect(destX - 50, groundY - 70, 100, 100); c.restore();
    if (UIICON.amber) { c.save(); c.translate(destX, groundY - 22 + Math.sin(t * 2) * 3); const as2 = (phase === 'win' ? 2.6 : 1.9) * Math.min(1.3, hh / 190); c.scale(as2, as2); if (phase !== 'win') c.globalAlpha = 0.75; UIICON.amber(c); c.restore(); }
    // vehicle
    let vx = baseX + 20, bounce = 0;
    if (phase === 'run') { vx = lerp(baseX + 20, destX - 46, prog); bounce = Math.abs(Math.sin(t * 9)) * 2; }
    else if (phase === 'win' || phase === 'fail') vx = destX - 46;
    const vy = (p === 'sea' ? hh * 0.55 + Math.sin(t * 1.6) * 6 : groundY - 2) - bounce;
    // trail
    if (phase === 'run') {
      c.fillStyle = p === 'sea' ? 'rgba(255,255,255,.6)' : p === 'ice' ? 'rgba(255,255,255,.8)' : 'rgba(150,110,60,.45)';
      for (let i = 0; i < 6; i++) { const a = (t * 2 + i / 6) % 1; ell(c, vx - 30 - a * 40, vy - 6 - a * 10 * (p === 'sea' ? 2 : 1), 3 + a * 7, 3 + a * 7); c.fill(); }
    }
    drawVehicle(c, p, vx, vy, Math.min(1.2, hh / 160), t, phase === 'run');
    if (phase === 'fail') {
      c.save();
      for (let i = 0; i < 4; i++) {
        const mx = ((t * 12 * (i + 1)) % (w + 200)) - 100;
        c.fillStyle = rad(c, mx, hh * (0.3 + i * 0.15), 10, 160, [[0, 'rgba(220,225,235,.55)'], [1, 'rgba(220,225,235,0)']]);
        c.fillRect(0, 0, w, hh);
      }
      c.restore();
    }
  }
  function drawVehicle(c, p, x, y, s, t, moving) {
    c.save(); c.translate(x, y); c.scale(s, s);
    const wheel = (wx, wy, r) => {
      ell(c, wx, wy, r, r); fs(c, '#1c2024', '#000', 1.5);
      ell(c, wx, wy, r * 0.5, r * 0.5); fs(c, '#b9c1c8', '#2a3036', 1);
      const a = moving ? t * 12 : 0;
      c.strokeStyle = '#2a3036'; c.lineWidth = 1.2;
      for (let k = 0; k < 3; k++) { c.beginPath(); c.moveTo(wx, wy); c.lineTo(wx + Math.cos(a + k * 2.1) * r * 0.5, wy + Math.sin(a + k * 2.1) * r * 0.5); c.stroke(); }
    };
    if (p === 'sea') {
      // yellow submarine
      ell(c, 0, -16, 40, 15); fs(c, lin(c, 0, -31, 0, -1, [[0, '#fff3a0'], [0.5, '#ffc21e'], [1, '#c98a00']]), '#4a3000', 2);
      rr(c, -12, -40, 22, 14, 4); fs(c, lin(c, 0, -40, 0, -26, [[0, '#ffe066'], [1, '#d09a10']]), '#4a3000', 2);
      c.strokeStyle = '#4a3000'; c.lineWidth = 2; c.beginPath(); c.moveTo(4, -40); c.lineTo(4, -48); c.lineTo(10, -48); c.stroke();
      for (const px of [-16, -2, 12]) { ell(c, px, -17, 5, 5); fs(c, rad(c, px - 1, -18, 0.5, 6, [[0, '#dff6ff'], [1, '#2a8ad8']]), '#4a3000', 1.6); }
      const pa = moving ? t * 20 : 0;
      c.fillStyle = '#8a939b';
      for (let k = 0; k < 2; k++) { c.beginPath(); c.ellipse(-42, -16, 3, 10 * Math.abs(Math.cos(pa + k * Math.PI / 2)), 0, 0, TAU); c.fill(); }
      c.save(); c.globalCompositeOperation = 'lighter';
      c.fillStyle = lin(c, 40, 0, 120, 0, [[0, 'rgba(255,250,200,.45)'], [1, 'rgba(255,250,200,0)']]);
      c.beginPath(); c.moveTo(38, -18); c.lineTo(120, -40); c.lineTo(120, 10); c.closePath(); c.fill(); c.restore();
    } else if (p === 'ice') {
      // red snow tracker on treads
      rr(c, -36, -12, 66, 13, 6); fs(c, '#2a3036', '#000', 1.5);
      c.fillStyle = '#5a646c';
      const off = moving ? (t * 30) % 8 : 0;
      for (let k = -36 + off; k < 30; k += 8) c.fillRect(k, -12, 3, 13);
      rr(c, -30, -38, 48, 27, 5); fs(c, lin(c, 0, -38, 0, -11, [[0, '#ff7a5a'], [1, '#b8241a']]), '#3a0602', 2);
      rr(c, -4, -34, 18, 12, 3); fs(c, '#cfefff', '#3a0602', 1.4);
      rr(c, -26, -34, 16, 12, 3); fs(c, '#cfefff', '#3a0602', 1.4);
      c.fillStyle = '#f6c21b'; c.fillRect(-30, -20, 48, 4);
      c.strokeStyle = '#8a939b'; c.lineWidth = 3; c.beginPath(); c.moveTo(24, -4); c.lineTo(40, -2); c.lineTo(44, -6); c.stroke();
    } else {
      // safari jeep
      rr(c, -36, -30, 70, 20, 5); fs(c, lin(c, 0, -30, 0, -10, [[0, '#e8d08a'], [1, '#a8884a']]), '#3a2a10', 2);
      c.fillStyle = '#3a6a2a'; c.fillRect(-36, -22, 70, 4);
      poly(c, [[6, -30], [14, -44], [30, -44], [34, -30]], true); fs(c, 'rgba(200,235,255,.75)', '#3a2a10', 1.8);
      c.strokeStyle = '#2a3036'; c.lineWidth = 3; c.beginPath(); c.moveTo(-30, -30); c.lineTo(-26, -46); c.lineTo(4, -46); c.lineTo(6, -30); c.stroke();
      ell(c, -40, -22, 6, 8); fs(c, '#1c2024', '#000', 1);
      ell(c, 34, -24, 3, 3); fs(c, '#fff8c0', '#3a2a10', 1);
      wheel(-20, -8, 9); wheel(20, -8, 9);
    }
    c.restore();
  }

  // ----- research / expedition popups -----
  function eggCanvas(p, w, hh) {
    const cv = h('canvas', { style: { width: w + 'px', height: hh + 'px', maxWidth: '100%' } });
    animCanvas(cv, (c, W, HH, t) => {
      c.save(); c.globalCompositeOperation = 'lighter';
      c.fillStyle = rad(c, W / 2, HH * 0.55, 4, W * 0.5, [[0, 'rgba(255,220,120,.5)'], [1, 'rgba(255,220,120,0)']]); c.fillRect(0, 0, W, HH);
      for (let i = 0; i < 10; i++) {
        const a = i / 10 * TAU + t * 0.6, rr2 = W * (0.26 + 0.05 * Math.sin(t * 3 + i));
        const sx = W / 2 + Math.cos(a) * rr2, sy = HH * 0.5 + Math.sin(a) * rr2 * 0.5;
        coreIcon(c, 'star', sx, sy, 8 + 4 * Math.sin(t * 4 + i));
      }
      c.restore();
      if (PC.ART && PC.ART.drawEgg) PC.ART.drawEgg(c, W / 2, HH * 0.86, Math.min(W, HH) * 0.62, p || 'land', t, 1, true);
    });
    return cv;
  }
  function showResearchDone(speciesId) {
    const sp = spdef(speciesId);
    if (!sp) return;
    enqueue(done => {
      sfx('success');
      const m = modal({
        title: 'RECHERCHE TERMINÉE !', rays: true,
        body: [eggCanvas(sp.park, 220, 170),
          h('div.mtxt', { html: 'Tu as terminé la recherche ' + esc(du(sp.name)) + ' ! Tu peux maintenant créer cette espèce au marché.' })],
        buttons: [{ label: 'Plus tard', cls: 'b-dark', value: false }, { label: 'Aller au marché', icon: 'market', value: true }],
        onClose: v => {
          const x = (S() || {}).expedition;
          if (x && x.result === true) ecall('declineExpedition');
          if (v === true) { closePanel(true); goMarketFor(speciesId); }
          done();
        },
      });
      confetti(m.wrap, 40);
    });
  }
  let lastChanceOpen = false;
  function showLastChance() {
    const x = (S() || {}).expedition;
    if (!x || x.result !== false || lastChanceOpen) return;
    lastChanceOpen = true;
    enqueue(done => {
      const x2 = (S() || {}).expedition;
      if (!x2 || x2.result !== false) { lastChanceOpen = false; done(); return; }
      const sp = spdef(x2.speciesId) || { name: 'cette espèce' };
      const cv = h('canvas', { style: { width: '260px', height: '170px', maxWidth: '100%', borderRadius: '12px', boxShadow: '0 0 0 2px #000, 0 0 0 4px #7b858e' } });
      animCanvas(cv, (c, w, hh, t) => {
        c.fillStyle = lin(c, 0, 0, 0, hh, [[0, '#5a6a7a'], [1, '#1a2028']]); c.fillRect(0, 0, w, hh);
        c.save(); c.globalCompositeOperation = 'lighter';
        c.fillStyle = rad(c, w / 2, hh / 2, 4, w * 0.45, [[0, `rgba(160,120,255,${0.55 + 0.15 * Math.sin(t * 3)})`], [1, 'rgba(120,80,255,0)']]); c.fillRect(0, 0, w, hh);
        c.restore();
        c.save(); c.translate(w / 2, hh / 2 + Math.sin(t * 2) * 5); c.rotate(Math.sin(t) * 0.08); c.scale(3.4, 3.4); UIICON.amber(c); c.restore();
        for (let i = 0; i < 5; i++) {
          const mx = ((t * (14 + i * 5) + i * 90) % (w + 240)) - 120;
          c.fillStyle = rad(c, mx, hh * (0.25 + i * 0.14), 8, 110, [[0, 'rgba(230,235,245,.5)'], [1, 'rgba(230,235,245,0)']]);
          c.fillRect(0, 0, w, hh);
        }
      });
      modal({
        title: 'DERNIÈRE CHANCE !', cls: 'lastchance',
        body: [cv, h('div.mtxt', { html: 'L’expédition n’a pas trouvé l’ADN ' + esc(du(sp.name)) + '… Mais un marchand te propose ce morceau d’<b>ambre</b> qui le contient !' })],
        buttons: [
          { label: 'Non', cls: 'b-dark', value: false },
          { label: 'L’acheter pour ' + fmt(x2.buyDollars || 5) + ' $', cls: 'b-orange', icon: 'dollar', value: true },
        ],
        onClose: v => {
          lastChanceOpen = false;
          if (v === true) {
            const res = ecall('buyExpeditionDNA');
            if (!okRes(res)) { failToast(res); }
          } else if (v === false) ecall('declineExpedition');
          done();
        },
      });
    });
  }
  function showPromo(e) {
    enqueue(done => {
      sfx('expedition');
      const big = h('div', { style: { position: 'relative', display: 'flex', alignItems: 'center', gap: '12px' } },
        h('img', { src: iconURL('amber', 64), width: 96, height: 96, alt: '' }),
        h('div.banner.gold', { style: { fontSize: '46px' } }, '−' + Math.round(((e && e.discount) || 0.3) * 100) + ' %'));
      modal({
        title: 'EXPÉDITION FLASH !', rays: true,
        body: [big, h('div.mtxt', { html: 'Pendant <b>' + fmtDur(Math.max(60, (((e && e.until) || 0) - (ecall('now') || Date.now())) / 1000)) + '</b>, les expéditions ADN coûtent moins cher. Fonce au labo !' })],
        buttons: [{ label: 'Plus tard', cls: 'b-dark', value: false }, { label: 'Voir les expéditions', icon: 'amber', value: true }],
        onClose: v => { if (v === true) UI.openLab(null, 'expedition'); done(); },
      });
    });
  }


  // ===========================================================================
  // Creature panel — portrait at stage, stars, level, feed pips, stats, actions; egg mode
  // ===========================================================================
  const BIOME_BG = {
    land: [['#f3dc8a', '#8cbf5a', '#3f6a2a'], '#6a8a3a'],
    sea: [['#9ae6f0', '#2f86b8', '#0f3a5a'], '#d8c48a'],
    ice: [['#ffffff', '#bcdcec', '#6a93b0'], '#f2f8fb'],
  };
  function drawPen(c, w, hh, p, t) {
    const B = BIOME_BG[p] || BIOME_BG.land;
    c.fillStyle = rad(c, w / 2, hh * 0.35, 10, Math.max(w, hh) * 0.8, [[0, B[0][0]], [0.55, B[0][1]], [1, B[0][2]]]);
    c.fillRect(0, 0, w, hh);
    c.fillStyle = H ? H.rgba(B[1], 0.55) : 'rgba(0,0,0,.2)';
    ell(c, w / 2, hh * 0.86, w * 0.46, hh * 0.1); c.fill();
    if (p === 'sea') {
      c.save(); c.globalCompositeOperation = 'lighter'; c.fillStyle = 'rgba(255,255,255,.35)';
      for (let i = 0; i < 10; i++) { const by = hh - ((t * 28 + i * 31) % hh), bx = (i * 47) % w + Math.sin(t * 1.3 + i) * 5; ell(c, bx, by, 2 + (i % 3), 2 + (i % 3)); c.fill(); }
      c.restore();
    } else if (p === 'ice') {
      c.fillStyle = 'rgba(255,255,255,.85)';
      for (let i = 0; i < 18; i++) { const sy = (t * 20 + i * 17) % hh, sx = (i * 37 + Math.sin(t + i) * 8) % w; ell(c, sx, sy, 1.5, 1.5); c.fill(); }
    } else {
      c.strokeStyle = 'rgba(40,80,20,.5)'; c.lineWidth = 2;
      for (let i = 0; i < 14; i++) { const gx = (i * 53) % w, gy = hh * 0.88 + (i % 3) * 4; c.beginPath(); c.moveTo(gx, gy); c.quadraticCurveTo(gx + 2, gy - 8, gx + 4 + Math.sin(t + i) * 2, gy - 12); c.stroke(); }
    }
  }
  let feedAnimUntil = 0;
  UI.openCreature = function (obj) {
    if (!obj) return;
    const id = obj.id;
    const P = openPanel('creature', obj.name || 'Créature', { cls: 'narrow' });
    P.objId = id;
    const inner = h('div.inner');
    P.body.append(inner);
    let key = '', refs = {};
    const render = () => {
      const o = getObj(id);
      if (!o) { P.close(); return; }
      const sp = spdef(o.speciesId);
      if (!sp) { P.close(); return; }
      const st = ecall('creatureStats', o.id) || (PC.statsAt ? Object.assign(PC.statsAt(o.speciesId, o.level || 1), { stage: PC.stageForLevel(o.level || 1), feeds: o.feeds || 0 }) : null);
      const tnow = ecall('now') || Date.now();
      const eggReady = !o.hatched && o.hatchAt != null && o.hatchAt <= tnow;
      const k = [o.hatched, eggReady, o.level, o.feeds, Math.floor((((S() || {}).player || {})[park(sp.park).food] || 0) / 50), Math.floor(ecall('pendingCoins', o.id) || 0) > 0].join('|');
      if (k !== key) {
        key = k;
        P.setTitle(o.hatched ? (o.name || sp.name) : 'ŒUF DE ' + sp.name.toUpperCase());
        inner.innerHTML = '';
        refs = {};
        const cp = h('div.cp');
        const art = h('div.cp-art');
        const cv = h('canvas');
        art.append(cv);
        animCanvas(cv, (c, w, hh, t) => {
          const o2 = getObj(id);
          if (!o2) return;
          drawPen(c, w, hh, sp.park, t);
          if (!o2.hatched) {
            const tot = Math.max(1, (sp.hatchSec || 10) * 1000);
            const prog = o2.hatchAt ? clamp(1 - (o2.hatchAt - (ecall('now') || Date.now())) / tot, 0, 1) : 1;
            if (PC.ART && PC.ART.drawEgg) PC.ART.drawEgg(c, w / 2, hh * 0.86, Math.min(w, hh) * 0.5, sp.park, t, prog, prog >= 1);
            return;
          }
          const stage = PC.stageForLevel(o2.level || 1);
          const meta = PC.ART && PC.ART.templateMeta ? PC.ART.templateMeta(o2.speciesId) : { bounds: [-80, -90, 90, 4] };
          // Fit the creature at its own stage, then shrink babies a little so growth stays visible.
          const b = meta.bounds, g = (PC.STAGE_GROWTH || [1, 1, 1, 1])[stage] * sp.size;
          const fit = Math.min(w * 0.84 / ((b[2] - b[0]) * g), hh * 0.7 / ((b[3] - b[1]) * g)) * (0.72 + 0.09 * stage);
          const eating = performance.now() < feedAnimUntil;
          const walk = sp.park === 'sea' ? 'swim' : (Math.floor(t / 4) % 3 === 1 ? 'walk' : 'idle');
          const sway = sp.park === 'sea' ? Math.sin(t * 0.8) * w * 0.04 : 0;
          if (PC.ART && PC.ART.drawCreature) {
            PC.ART.drawCreature(c, o2.speciesId, { x: w / 2 - ((b[0] + b[2]) / 2) * g * fit + sway, y: hh * (sp.park === 'sea' ? 0.76 : 0.86), scale: fit, stage, t,
              pose: eating ? 'eat' : walk, k: eating ? ((performance.now() % 600) / 600) : 0, facing: 1, shadow: sp.park !== 'sea' });
          }
        });
        const info = h('div.cp-info');
        cp.append(art, info);
        inner.append(cp);
        const R2 = rarityOf(sp.rarity);
        info.append(h('div.cp-name', o.hatched ? (o.name || sp.name) : 'Œuf de ' + sp.name));
        info.append(h('div.cp-sub', h('span', sp.name), rarityTag(sp.rarity), h('span', icon(sp.cls, 20)), h('span', clsOf(sp.cls).name)));
        if (o.hatched && st) {
          const stars = h('span.stars');
          for (let i = 0; i < 4; i++) stars.append(h('img' + (i <= st.stage ? '' : '.off'), { src: iconURL('star', 22), alt: '' }));
          info.append(h('div.lvl-row', h('span.lvl-big', 'Niv. ' + (o.level || 1)), stars, h('span.rtag', { style: { background: '#2a3239' } }, (PC.STAGE_NAMES || [])[st.stage] || '')));
          const pips = h('div.pips');
          const ftl = st.feedsToLevel || 3;
          for (let i = 0; i < ftl; i++) pips.append(h('span.pip' + (i < (o.feeds || 0) ? '.on' : '')));
          const nextStageLv = st.stage < 3 ? [10, 20, 30][st.stage] : null;
          info.append(h('div.lvl-row', h('span.dim', { style: { font: '600 13px var(--font-ui)' } }, 'Repas avant le niveau ' + Math.min(40, (o.level || 1) + 1) + ' :'), pips));
          if (nextStageLv) info.append(h('div.evo-hint', '★ Évolue en ' + PC.STAGE_NAMES[st.stage + 1] + ' au niveau ' + nextStageLv + ' !'));
          else info.append(h('div.evo-hint', '★ Stade Alpha atteint : la forme ultime !'));
          const pend = h('b', '0');
          refs.pend = pend;
          info.append(h('div.stat-grid',
            h('div.stat', icon('hp', 26), h('div', h('small', 'Vie'), h('b', fmt(st.hp)))),
            h('div.stat', icon('atk', 26), h('div', h('small', 'Attaque'), h('b', fmt(st.atkMin) + '–' + fmt(st.atkMax)))),
            h('div.stat', icon('coin', 26), h('div', h('small', 'Pièces/min'), h('b', fmt(st.coinsPerMin)))),
            h('div.stat', icon('collect', 26), h('div', h('small', 'À ramasser'), pend))));
          const foodK = (st.food) || park(sp.park).food;
          const feedCost = { [foodK]: st.feedCost };
          const row = h('div.btn-row');
          if (st.maxLevel || (o.level || 1) >= (PC.MAX_LEVEL || 40)) row.append(h('button.b', { disabled: true }, 'Niveau max'));
          else row.append(h('button.b.b-lg', { onclick: () => {
            if (!canAfford(feedCost)) { sfx('error'); toast(missingText(feedCost), 'bad'); return; }
            const res = ecall('feed', o.id);
            if (!okRes(res)) { failToast(res); return; }
            feedAnimUntil = performance.now() + 1200;
          } }, icon(resIcon(foodK), 24), 'NOURRIR', pricePill(feedCost)));
          const col = h('button.b.b-yellow', { onclick: () => { const n = collectObj(o); if (n) feedAnimUntil = 0; } }, icon('collect', 24), 'COLLECTER');
          refs.col = col;
          row.append(col);
          info.append(row);
          info.append(h('div.btn-row',
            h('button.b.b-blue.b-sm', { onclick: () => { sfx('click'); UI.startPlacement({ kind: 'move', obj: o }); } }, icon('move', 22), 'DÉPLACER'),
            h('button.b.b-red.b-sm', { onclick: () => { sfx('click'); sellObj(o); } }, icon('sell', 22), 'VENDRE')));
          info.append(h('div.ms-text', { style: { fontSize: '13px', minHeight: 0 } }, sp.desc || ''));
        } else {
          // egg mode
          info.append(h('div.ms-text', { style: { minHeight: 0 } }, eggReady ? 'L’œuf bouge… il est prêt à éclore !' : 'L’œuf est au chaud dans son nid. Encore un peu de patience !'));
          const bar = h('div.bar.gold', { style: { height: '24px' } }, h('i'), h('span', ''));
          refs.eggBar = bar;
          info.append(bar);
          const row = h('div.btn-row');
          if (eggReady) {
            row.append(h('button.b.b-lg', { onclick: () => {
              const res = ecall('hatch', o.id);
              if (!okRes(res)) failToast(res);
            } }, icon('egg', 26), 'ÉCLORE !'));
          } else {
            const sb = h('button.b.b-blue', { onclick: () => speedUpObj(o) }, icon('speed', 22), 'ACCÉLÉRER', pricePill({ dollars: 1 }));
            refs.speed = sb;
            row.append(sb);
          }
          info.append(row);
          info.append(h('div.btn-row',
            h('button.b.b-blue.b-sm', { onclick: () => { sfx('click'); UI.startPlacement({ kind: 'move', obj: o }); } }, icon('move', 22), 'DÉPLACER'),
            h('button.b.b-red.b-sm', { onclick: () => { sfx('click'); sellObj(o); } }, icon('sell', 22), 'VENDRE')));
          info.append(h('div.ms-text', { style: { fontSize: '13px', minHeight: 0 } }, sp.desc || ''));
        }
      }
      // live bits
      if (refs.pend) {
        const n = ecall('pendingCoins', o.id) || 0;
        refs.pend.textContent = fmt(n);
        if (refs.col) refs.col.disabled = n < 1;
      }
      if (refs.eggBar) {
        const tot = Math.max(1, (sp.hatchSec || 10) * 1000);
        const rem = Math.max(0, (o.hatchAt || 0) - tnow);
        refs.eggBar.firstChild.style.width = Math.round(clamp(1 - rem / tot, 0, 1) * 100) + '%';
        refs.eggBar.lastChild.textContent = rem > 0 ? 'Éclosion dans ' + fmtTime(rem / 1000) : 'Prêt !';
        if (refs.speed) { const c2 = ecall('speedUpCost', o.id) || 1; refs.speed.querySelector('.pill').lastChild.textContent = fmt(c2); }
      }
    };
    P.onUpdate = render;
    P.onTimer = render;
    render();
  };

  // ===========================================================================
  // EVOLUTION overlay — before → after portraits
  // ===========================================================================
  UI.showEvolution = function (obj, fromStage, toStage) {
    if (!obj) return;
    const sp = spdef(obj.speciesId);
    if (!sp) return;
    enqueue(done => {
      sfx('evolve');
      const r = roots();
      const ov = h('div.evo');
      const names = PC.STAGE_NAMES || ['Bébé', 'Juvénile', 'Adulte', 'Alpha'];
      const before = h('div.evo-card.before', h('img', { src: portraitURL(sp.id, 280, 220, { stage: fromStage }), alt: '' }), h('div.en', names[fromStage] || ''));
      const after = h('div.evo-card.after', h('img', { src: portraitURL(sp.id, 420, 330, { stage: toStage }), alt: '' }), h('div.en', names[toStage] || ''));
      const stars = h('span.stars');
      for (let i = 0; i < 4; i++) stars.append(h('img' + (i <= toStage ? '' : '.off'), { src: iconURL('star', 30), alt: '', style: { width: '30px', height: '30px' } }));
      ov.append(h('div.rays'),
        h('div.banner.gold', 'ÉVOLUTION !'),
        h('div.evo-row', before, h('div.evo-arrow', '➜'), after),
        h('div.mtxt', { style: { position: 'relative', font: '600 17px var(--font-ui)', textAlign: 'center' }, html: '<b>' + esc(obj.name || sp.name) + '</b> est devenu' + (toStage === 3 ? ' un ' : ' ') + '<b>' + esc(names[toStage]) + '</b> !' }),
        stars,
        h('button.b.b-lg', { style: { position: 'relative' }, onclick: e => { e.stopPropagation(); close(); } }, 'GÉNIAL !'));
      let closed = false;
      const close = () => { if (closed) return; closed = true; sfx('click'); ov.remove(); done(); };
      ov._close = close;
      const t0 = performance.now();
      ov.addEventListener('click', () => { if (performance.now() - t0 > 1200) close(); });
      r.modals.append(ov);
      confetti(ov, 60);
      setTimeout(() => sfx('roar'), 700);
    });
  };

  // ===========================================================================
  // Building panel (« i ») + delivery orders (ACTIVER) + special buildings
  // ===========================================================================
  function openBuilding(obj) {
    if (!obj) return;
    const b = bdef(obj.buildingId);
    if (!b) return;
    if (b.kind === 'special') { openSpecial(obj, b); return; }
    const id = obj.id;
    hideActionBar();
    const P = openPanel('building', b.name, { cls: 'narrow' });
    P.objId = id;
    const inner = h('div.inner');
    P.body.append(inner);
    let key = '', refs = {};
    const render = () => {
      const o = getObj(id);
      if (!o) { P.close(); return; }
      const prod = b.kind === 'coins' || b.kind === 'food' ? ecall('production', o.id) : null;
      const up = ecall('upgradeCost', o.id);
      const k = [o.level, prod ? prod.state : '-', up ? up.coins : '-'].join('|');
      if (k !== key) {
        key = k;
        refs = {};
        inner.innerHTML = '';
        const cp = h('div.cp');
        const art = h('div.cp-art');
        const cv = h('canvas');
        art.append(cv);
        const th = PC.BUILD_ART && PC.BUILD_ART.thumb ? (() => { try { return PC.BUILD_ART.thumb(b.art || b.id, 360, 300); } catch (e) { return null; } })() : null;
        animCanvas(cv, (c, w, hh, t) => {
          drawPen(c, w, hh, b.park, t);
          if (th) {
            const s2 = Math.min(w * 0.86 / th.width, hh * 0.86 / th.height);
            const bob = Math.sin(t * 2) * 2;
            c.drawImage(th, (w - th.width * s2) / 2, (hh - th.height * s2) / 2 + bob, th.width * s2, th.height * s2);
          }
        });
        const info = h('div.cp-info');
        cp.append(art, info);
        inner.append(cp);
        const kindName = (D().KIND_NAMES || {})[b.kind] || '';
        info.append(h('div.cp-name', b.name));
        info.append(h('div.cp-sub', h('span.rtag', { style: { background: '#3a6a9a' } }, kindName.toUpperCase()),
          (b.kind === 'coins' || b.kind === 'food') ? h('span.lvtag', 'NIV. ' + (o.level || 1) + ' / 5') : null));
        info.append(h('div.ms-text', { style: { minHeight: 0, fontSize: '14px' } }, b.desc || ''));
        if (prod && prod.state !== 'none') {
          const st = h('div.lab-status');
          const bar = h('div.bar.gold', { style: { height: '22px' } }, h('i'), h('span', ''));
          refs.st = st; refs.bar = bar;
          info.append(st, bar);
          const row = h('div.btn-row');
          if (b.kind === 'food' && prod.state === 'idle') row.append(h('button.b.b-lg', { onclick: () => openOrders(o) }, icon('truck', 26), 'ACTIVER'));
          else row.append(h('button.b.b-yellow.b-lg', { disabled: prod.state !== 'ready', onclick: () => collectObj(o) }, icon('collect', 26), 'COLLECTER'));
          if (prod.state === 'producing') {
            const sb = h('button.b.b-blue', { onclick: () => speedUpObj(o) }, icon('speed', 22), 'ACCÉLÉRER', pricePill({ dollars: ecall('speedUpCost', o.id) || 1 }));
            refs.speed = sb;
            row.append(sb);
          }
          info.append(row);
          if (b.kind === 'food') {
            const orders = ecall('buildingOrders', o.id) || [];
            if (orders.length) info.append(h('div.kv', orders.map(od => h('div', h('small', od.name), h('b', icon(resIcon(prod.res), 20), '+' + fmt(od.amount)), h('span.dim', { style: { font: '600 12px var(--font-ui)' } }, fmtDur(od.sec))))));
          } else if (b.produce) {
            info.append(h('div.kv', h('div', h('small', 'Production'), h('b', icon('coin', 20), '+' + fmt(prod.amount))), h('div', h('small', 'Toutes les'), h('b', icon('clock', 20), fmtDur(b.produce.sec)))));
          }
          const row2 = h('div.btn-row');
          if (up) row2.append(h('button.b.b-orange', { onclick: () => upgradeObj(o) }, icon('upgrade', 22), 'AMÉLIORER', pricePill(up)));
          else row2.append(h('button.b.b-orange', { disabled: true }, icon('upgrade', 22), 'NIVEAU MAX'));
          info.append(row2);
        } else if (b.xp) {
          info.append(h('div.kv', h('div', h('small', 'Expérience'), h('b', icon('xp', 20), '+' + fmt(b.xp) + ' XP')), h('div', h('small', 'Taille'), h('b', b.size[0] + ' × ' + b.size[1]))));
        }
        info.append(h('div.btn-row',
          h('button.b.b-blue.b-sm', { onclick: () => { sfx('click'); UI.startPlacement({ kind: 'move', obj: o }); } }, icon('move', 22), 'DÉPLACER'),
          h('button.b.b-red.b-sm', { onclick: () => { sfx('click'); sellObj(o); } }, icon('sell', 22), 'VENDRE')));
      }
      if (refs.st && prod) {
        const ps = prodStatus(o, b, prod);
        refs.st.textContent = ps.text;
        refs.bar.firstChild.style.width = Math.round((ps.ratio || 0) * 100) + '%';
        refs.bar.lastChild.textContent = prod.state === 'producing' ? fmtTime(prod.remainingSec) : prod.state === 'ready' ? 'Prêt !' : '';
        if (refs.speed) refs.speed.querySelector('.pill').lastChild.textContent = fmt(ecall('speedUpCost', o.id) || 1);
      }
    };
    P.onUpdate = render;
    P.onTimer = render;
    render();
  }
  UI.openBuilding = openBuilding;

  /** Lab → Labo ADN, arena → tournament, gate / harbor → park info. */
  function openSpecial(obj, b) {
    const act = b.action;
    if (act === 'lab') UI.openLab();
    else if (act === 'arena') UI.openBattle();
    else openParkInfo(b);
  }
  function openParkInfo(b) {
    const pk = cur();
    const objs = ecall('objects', pk) || [];
    const cre = objs.filter(o => o.type === 'enclosure');
    const hatched = cre.filter(o => o.hatched);
    const blds = objs.filter(o => o.type === 'building' && !o.fixed && (bdef(o.buildingId) || {}).kind !== 'road');
    let cpm = 0;
    for (const o of hatched) { const st = ecall('creatureStats', o.id); if (st) cpm += st.coinsPerMin || 0; }
    const species = new Set(cre.map(o => o.speciesId)).size;
    const total = ((PC.SPECIES_ORDER || {})[pk] || []).length;
    const P = openPanel('parkinfo', (b && b.name) || park().name, { cls: 'narrow auto-h' });
    const cv = h('canvas', { style: { width: '100%', height: '150px', display: 'block', borderRadius: '12px', boxShadow: '0 0 0 2px #000, 0 0 0 4px #7b858e' } });
    animCanvas(cv, (c, w, hh, t) => drawParkScene(c, w, hh, t, pk));
    const inner = h('div.inner', { style: { padding: '14px', gap: '12px', display: 'flex', flexDirection: 'column' } });
    inner.append(cv, h('div.cp-name', park().name),
      h('div.ms-text', { style: { minHeight: 0 } }, (b && b.desc) || ''),
      h('div.kv',
        h('div', h('small', 'Créatures'), h('b', icon('egg', 20), fmt(cre.length))),
        h('div', h('small', 'Espèces'), h('b', icon('collection', 20), species + ' / ' + total)),
        h('div', h('small', 'Bâtiments'), h('b', icon('tab_buildings', 20), fmt(blds.length))),
        h('div', h('small', 'Revenus'), h('b', icon('coin', 20), fmt(cpm) + '/min'))),
      h('div.btn-row',
        h('button.b', { onclick: () => { sfx('click'); UI.openCollection(pk); } }, icon('collection', 22), 'Collection'),
        h('button.b.b-blue', { onclick: () => { sfx('click'); UI.openParks(); } }, icon('parks', 22), 'Parcs')));
    P.body.append(inner);
  }

  /** ACTIVER: choose one of 3 deliveries for a food building. */
  function openOrders(obj) {
    const b = bdef(obj.buildingId) || {};
    const orders = ecall('buildingOrders', obj.id) || [];
    if (!orders.length) { toast('Ce bâtiment n’a pas de livraison.', 'info'); return; }
    const fk = (b.produce && b.produce.res) || park(b.park).food;
    const grid = h('div.order-grid');
    let m = null;
    orders.forEach((od, i) => {
      const cv = h('canvas');
      animCanvas(cv, (c, w, hh, t) => drawCrates(c, w, hh, t, i, fk));
      grid.append(h('div.order', cv,
        h('div', { style: { flex: 1, display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'center' } },
          h('div.on', od.name),
          h('div.chips', h('span.chip', icon(resIcon(fk), 24), h('b', '+' + fmt(od.amount)))),
          h('div.dim', { style: { font: '700 13px var(--font-ui)', display: 'flex', alignItems: 'center', gap: '4px' } }, icon('clock', 18), fmtDur(od.sec)),
          h('button.b.b-sm', { onclick: () => {
            sfx('click');
            const res = ecall('activate', obj.id, i);
            if (!okRes(res)) { failToast(res); return; }
            toast(od.name + ' lancée : retour dans ' + fmtDur(od.sec) + '.', 'good');
            if (m) m.close(true);
          } }, icon('ok', 20), 'Choisir'))));
    });
    m = modal({ title: 'LIVRAISON', cls: 'orders', body: [h('div.mtxt', 'Choisis une livraison pour : ' + (b.name || '')), grid] });
    m.box.style.width = 'min(640px, 100%)';
  }
  function drawCrates(c, w, hh, t, size, fk) {
    c.fillStyle = lin(c, 0, 0, 0, hh, [[0, '#33404a'], [1, '#161c21']]); c.fillRect(0, 0, w, hh);
    const n = [1, 3, 6][size] || 1;
    const cs = Math.min(hh * 0.34, w / 6);
    const baseX = w / 2, baseY = hh * 0.86;
    const pos = [[0, 0], [-1, 0], [1, 0], [-0.5, 1], [0.5, 1], [0, 2]];
    const order = n === 1 ? [0] : n === 3 ? [1, 2, 3] : [1, 0, 2, 3, 4, 5];
    for (let j = 0; j < order.length; j++) {
      const [px, py] = pos[order[j]];
      const x = baseX + px * cs * 1.05 - cs / 2, y = baseY - (py + 1) * cs * 0.92 + Math.sin(t * 3 + j) * (n === 1 ? 2 : 0);
      rr(c, x, y, cs, cs * 0.9, 3); fs(c, lin(c, x, y, x, y + cs, [[0, '#d9a25a'], [1, '#8a5a26']]), '#3b220e', 1.5);
      c.strokeStyle = 'rgba(60,30,10,.6)'; c.lineWidth = 1.2; c.beginPath(); c.moveTo(x + 2, y + 2); c.lineTo(x + cs - 2, y + cs * 0.9 - 2); c.moveTo(x + cs - 2, y + 2); c.lineTo(x + 2, y + cs * 0.9 - 2); c.stroke();
      coreIcon(c, fk, x + cs / 2, y - cs * 0.1, cs * 0.6);
    }
  }


  // ===========================================================================
  // Missions — story mission + side missions (vertical tabs), story dialog sheet
  // ===========================================================================
  const KIND_WORDS = { deco: ['décoration', 'décorations'], road: ['morceau de route', 'morceaux de route'], coins: ['commerce', 'commerces'], food: ['ferme', 'fermes'], special: ['bâtiment', 'bâtiments'] };
  /** French sentence for a mission goal. */
  function goalText(g) {
    if (!g) return '';
    const n = g.count || g.amount || g.level || g.stage || 1;
    const pl = (one, many) => (n > 1 ? many : one);
    const bn = g.building && bdef(g.building) ? bdef(g.building).name : null;
    const sn = g.species && spdef(g.species) ? spdef(g.species).name : null;
    const pn = g.park ? park(g.park).name : null;
    switch (g.type) {
      case 'build':
        if (bn) return 'Construis ' + (n > 1 ? n + ' × ' : ': ') + bn;
        if (g.kind && KIND_WORDS[g.kind]) return 'Construis ' + n + ' ' + pl(KIND_WORDS[g.kind][0], KIND_WORDS[g.kind][1]);
        return 'Construis ' + n + ' ' + pl('bâtiment', 'bâtiments');
      case 'own_building':
        if (bn) return 'Possède ' + n + ' × ' + bn;
        if (g.kind && KIND_WORDS[g.kind]) return 'Possède ' + n + ' ' + pl(KIND_WORDS[g.kind][0], KIND_WORDS[g.kind][1]);
        return 'Possède ' + n + ' ' + pl('bâtiment', 'bâtiments');
      case 'hatch':
        if (sn) return 'Fais éclore ' + (n > 1 ? n + ' × ' : ': ') + sn;
        return 'Fais éclore ' + n + ' ' + pl('créature', 'créatures') + (pn ? ' au ' + pn : '');
      case 'own_species': return 'Possède ' + n + ' ' + pl('espèce', 'espèces différentes') + (pn ? ' au ' + pn : '');
      case 'feed': return 'Nourris tes créatures ' + n + ' fois';
      case 'creature_level': return sn ? 'Fais monter un ' + sn + ' au niveau ' + g.level : 'Fais monter une créature au niveau ' + g.level;
      case 'collect': return 'Ramasse ' + fmt(g.amount || n) + ' ' + (g.res === 'coins' ? 'pièces' : resName(g.res).toLowerCase());
      case 'research': return g.success === false ? 'Lance ' + n + ' ' + pl('tentative', 'tentatives') + ' de recherche ADN' : 'Réussis ' + n + ' ' + pl('étape', 'étapes') + ' de recherche ADN';
      case 'win_battle': return 'Gagne ' + n + ' ' + pl('combat', 'combats') + ' au tournoi' + (pn ? ' (' + pn + ')' : '');
      case 'battle_stage': return 'Remporte l’étape ' + g.stage + ' du tournoi' + (pn ? ' (' + pn + ')' : '');
      case 'player_level': return 'Atteins le niveau ' + g.level;
      case 'unlock_park': return 'Débloque le ' + (pn || 'nouveau parc');
      case 'activate': return 'Active ' + n + ' ' + pl('livraison', 'livraisons');
      case 'upgrade': return 'Améliore ' + n + ' ' + pl('bâtiment', 'bâtiments');
      case 'cards': return 'Ouvre ' + n + ' ' + pl('paquet', 'paquets') + ' de cartes';
      case 'expedition': return 'Envoie ' + n + ' ' + pl('expédition', 'expéditions') + ' ADN';
    }
    return 'Objectif';
  }
  UI.goalText = goalText;

  /** Typewriter into `el`; returns {skip(), done()}. */
  function typewriter(el, text, cps, onDone) {
    let i = 0, finished = false;
    const caret = h('span.caret');
    const tick = () => {
      if (finished || !el.isConnected) return;
      i = Math.min(text.length, i + Math.max(1, Math.round((cps || 45) / 30)));
      el.textContent = text.slice(0, i);
      el.append(caret);
      if (i >= text.length) { finished = true; caret.remove(); if (onDone) onDone(); return; }
      setTimeout(tick, 33);
    };
    tick();
    return {
      skip() { if (finished) return false; finished = true; el.textContent = text; if (onDone) onDone(); return true; },
      get done() { return finished; },
    };
  }
  function npcCanvas(npcId, cls) {
    const cv = h('canvas' + (cls ? '.' + cls : ''));
    const look = npcOf(npcId).look;
    animCanvas(cv, (c, w, hh, t) => { if (PC.ART && PC.ART.drawNPC) PC.ART.drawNPC(c, look, 0, 0, w, hh, t); });
    return cv;
  }

  let msSel = 'story';
  UI.openMissions = function (sel) {
    if (sel != null) msSel = sel;
    const P = openPanel('missions', 'MISSIONS');
    const wrap = h('div.inner', { style: { flexDirection: 'row' } });
    P.body.append(wrap);
    let key = '', refs = {};
    const render = force => {
      const m = ecall('mission');
      const sides = ecall('sideMissions') || [];
      const k = [msSel, m ? m.index + ':' + m.done : '-', sides.map(s => s.def.id + ':' + s.done).join(',')].join('|');
      if (force || k !== key) {
        key = k;
        refs = {};
        wrap.innerHTML = '';
        const tabs = h('div.ms-tabs.scroll-y', { 'data-sk': 'ms-tabs' });
        const body = h('div.ms-body.scroll-y', { 'data-sk': 'ms-body' });
        wrap.append(h('div.ms', tabs, body));
        tabs.append(h('button.ms-tab' + (msSel === 'story' ? '.on' : ''), { onclick: () => { if (msSel !== 'story') { sfx('click'); msSel = 'story'; render(true); } } },
          icon('missions', 40), h('span', 'HISTOIRE'), m && m.done ? h('span.bang', '!') : null));
        sides.forEach((s, i) => {
          const ic = s.def.icon || 'star';
          tabs.append(h('button.ms-tab' + (msSel === i ? '.on' : ''), { onclick: () => { if (msSel !== i) { sfx('click'); msSel = i; render(true); } } },
            icon(ic, 40), h('span', 'BONUS ' + (i + 1)), s.done ? h('span.bang', '!') : null));
        });
        if (msSel !== 'story' && !sides[msSel]) msSel = 'story';
        if (msSel === 'story') buildStoryBody(body, m, refs);
        else buildSideBody(body, sides[msSel], msSel, refs);
      }
      // live progress
      const cur2 = msSel === 'story' ? m : sides[msSel];
      if (cur2 && refs.gn) {
        refs.gn.textContent = fmt(cur2.progress) + ' / ' + fmt(cur2.target);
        refs.fill.style.width = Math.round(clamp(cur2.progress / Math.max(1, cur2.target), 0, 1) * 100) + '%';
      }
    };
    P.onUpdate = () => render(false);
    P.onTimer = null;
    render(true);
  };
  function goalBlock(item, refs, text) {
    const gn = h('span.gn', fmt(item.progress) + ' / ' + fmt(item.target));
    const fill = h('i');
    refs.gn = gn; refs.fill = fill;
    return [
      h('div.goal', h('span.cbox' + (item.done ? '.on' : '')), h('span.gt', text), gn),
      h('div.bar.gold', { style: { height: '14px' } }, fill),
    ];
  }
  function buildStoryBody(body, m, refs) {
    if (!m) {
      body.append(h('div.ms-head', npcCanvas('elise', 'ms-npc'), h('div', h('div.ms-who', 'Dr Élise Morel'), h('div.ms-title', 'Histoire terminée !'),
        h('div.ms-text', 'Bravo, directeur ! Tu as terminé toutes les missions de l’histoire. Continue à agrandir ton parc et à gagner des médailles au tournoi !'))));
      return;
    }
    const d = m.def, npc = npcOf(d.npc);
    const txt = h('div.ms-text');
    body.append(h('div.ms-head', npcCanvas(d.npc, 'ms-npc'),
      h('div', { style: { minWidth: 0, flex: 1 } }, h('div.ms-who', npc.name + (npc.role ? ' · ' + npc.role : '')), h('div.ms-title', d.title), txt)));
    const lines = (d.intro || []).slice(-2).join(' ');
    typewriter(txt, m.done && d.outro ? d.outro : lines, 60);
    body.append(...goalBlock(m, refs, goalText(d.goal)));
    body.append(h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' } }, h('span.rw-label', 'Récompenses'), chips(d.reward, '+')));
    const row = h('div.btn-row');
    row.append(h('button.b.b-lg' + (m.done ? '.title-play' : ''), { disabled: !m.done, onclick: () => claimStory() }, icon('check', 24), 'RÉCLAMER'));
    row.append(h('button.b.b-steel.b-sm', { onclick: () => { sfx('click'); closePanel(true); storySheet(d, 'intro', () => {}); } }, icon('help', 20), 'Revoir le dialogue'));
    body.append(row);
    body.append(h('div.muted', { style: { font: '600 12px var(--font-ui)' } }, 'Mission ' + (m.index + 1) + ' sur ' + (m.total || (D().MISSIONS || []).length)));
  }
  function buildSideBody(body, s, i, refs) {
    if (!s) return;
    const d = s.def, npc = npcOf(d.npc || 'tom');
    const txt = h('div.ms-text');
    body.append(h('div.ms-head', npcCanvas(d.npc || 'tom', 'ms-npc'),
      h('div', { style: { minWidth: 0, flex: 1 } }, h('div.ms-who', 'Mission secondaire · ' + npc.name), h('div.ms-title', d.title || 'Mission secondaire'), txt)));
    typewriter(txt, s.done ? 'Bien joué ! Viens chercher ta récompense.' : (d.text || goalText(d.goal)) + ' Une nouvelle mission arrive dès que tu réclames celle-ci.', 60);
    body.append(...goalBlock(s, refs, d.text || goalText(d.goal)));
    body.append(h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' } }, h('span.rw-label', 'Récompenses'), chips(d.reward, '+')));
    body.append(h('div.btn-row', h('button.b.b-lg' + (s.done ? '.title-play' : ''), { disabled: !s.done, onclick: () => {
      const res = ecall('claimSide', i);
      if (!okRes(res)) { failToast(res); return; }
      sfx('success');
      toast('Récompense : ' + rewardText(res.reward), 'good');
    } }, icon('check', 24), 'RÉCLAMER')));
  }
  function rewardText(r) {
    return RES_KEYS.filter(k => r && r[k]).map(k => '+' + fmt(r[k]) + ' ' + (k === 'xp' ? 'XP' : resName(k).toLowerCase())).join(', ');
  }
  function claimStory() {
    const res = ecall('claimMission');
    if (!okRes(res)) { failToast(res); return; }
    sfx('success');
    toast('Mission réussie ! ' + rewardText(res.reward), 'good');
  }

  // ----- story dialog bottom sheet (NPC + typewriter, tap to advance) -----
  let sheetOpen = false;
  /** mode 'intro' (intro lines → « C'est parti ! ») or 'outro' (outro → RÉCLAMER). */
  function storySheet(def, mode, done) {
    const r = roots();
    const npc = npcOf(def.npc);
    const lines = mode === 'outro' ? [def.outro || 'Mission accomplie !'] : (def.intro && def.intro.length ? def.intro : [def.title]);
    let i = 0, tw = null;
    sheetOpen = true;
    const wrap = h('div.sheet-w');
    const txt = h('div.txt');
    const acts = h('div.acts');
    const say = h('div.say.inner');
    const npcCv = npcCanvas(def.npc);
    say.append(h('div.who', h('b', npc.name), h('span', npc.role || '')),
      h('div.stitle', (mode === 'outro' ? 'MISSION ACCOMPLIE · ' : 'NOUVELLE MISSION · ') + (def.title || '').toUpperCase()), txt, acts);
    const sheet = h('div.sheet.steel', h('div.npcbox', npcCv, mode === 'intro' ? h('div.goal', { style: { padding: '6px 8px', gap: '6px' } }, h('span.cbox'), h('span.gt', { style: { fontSize: '12px' } }, goalText(def.goal))) : null), say);
    wrap.append(sheet);
    const close = () => { if (!wrap.isConnected) return; wrap.remove(); sheetOpen = false; done && done(); };
    wrap._close = close;
    const showActs = () => {
      acts.innerHTML = '';
      const last = i >= lines.length - 1;
      if (!last || mode === 'intro') acts.append(h('button.b.b-steel.b-sm', { onclick: e => { e.stopPropagation(); sfx('click'); close(); } }, 'Passer'));
      if (!last) acts.append(h('button.b', { onclick: e => { e.stopPropagation(); next(); } }, 'Suivant ➜'));
      else if (mode === 'outro') {
        acts.append(h('button.b.b-lg.title-play', { onclick: e => { e.stopPropagation(); close(); claimStory(); } }, icon('check', 24), 'RÉCLAMER', chips(def.reward, '+', 20)));
      } else {
        // Build / hatch goals: « C’est parti ! » opens the market right on what the mission asks for.
        const g = def.goal, m = ecall('mission');
        const toMarket = marketTargetFor(g) && !(m && m.def && m.def.id === def.id && m.done);
        acts.append(h('button.b.b-lg', { onclick: e => { e.stopPropagation(); sfx('click'); close(); if (toMarket) openMarketForGoal(g); } }, 'C’est parti !'));
      }
    };
    const show = () => {
      tw = typewriter(txt, lines[i], 50, null);
      showActs();
    };
    const next = () => {
      if (tw && !tw.done) { tw.skip(); return; }
      if (i < lines.length - 1) { sfx('click'); i++; show(); }
    };
    say.addEventListener('click', next);
    r.modals.append(wrap);
    show();
  }
  UI.storySheet = (def, mode) => enqueue(done => storySheet(def, mode || 'intro', done));


  // ===========================================================================
  // CARTES — free pack every 10 min, paid pack, 3 cards flipping with rarity glow
  // ===========================================================================
  const RARITY_FRAME = {
    commun: ['#dfe3e6', '#9aa3a8', '#555d63', 'rgba(255,255,255,.15)'],
    rare: ['#a9d8ff', '#4f9fe0', '#1f5a94', 'rgba(79,159,224,.75)'],
    super: ['#e2b8ff', '#b06ae0', '#5a2a86', 'rgba(176,106,224,.85)'],
    legendaire: ['#fff0a8', '#f0b030', '#8a5a06', 'rgba(240,176,48,.95)'],
    mythique: ['#ffb0c4', '#ff3b6b', '#7a0a26', 'rgba(255,59,107,.95)'],
  };
  function cardBack() {
    return h('div.face.back', h('img', { src: LOGO.emblemURL ? LOGO.emblemURL(60) : iconURL('cards', 48), alt: '' }));
  }
  UI.openCards = function () {
    const P = openPanel('cards', 'CARTES', { cls: 'narrow' });
    const inner = h('div.inner');
    P.body.append(inner);
    let mode = 'idle', refs = {};
    const renderIdle = () => {
      mode = 'idle';
      inner.innerHTML = '';
      refs = {};
      const ready = !!ecall('cardsReady');
      const stage = h('div.pack-stage');
      const pack = h('div.pack-big', h('div.gcard', cardBack()), h('div.gcard', cardBack()), h('div.gcard', cardBack()));
      const msg = h('div.mtxt', { style: { textAlign: 'center', font: '700 16px var(--font-ui)' } });
      refs.msg = msg;
      const packCost = (D().CARDS || {}).packCost || { dollars: 10 };
      const row = h('div.btn-row', { style: { justifyContent: 'center' } });
      const free = h('button.b.b-lg' + (ready ? '.title-play' : ''), { disabled: !ready, onclick: () => open(false) }, icon('cards', 26), 'OUVRIR', h('span.pill', 'Gratuit'));
      refs.free = free;
      row.append(free, h('button.b.b-orange', { onclick: () => {
        if (!canAfford(packCost)) { sfx('error'); toast(missingText(packCost), 'bad'); return; }
        open(true);
      } }, 'Acheter un paquet', pricePill(packCost)));
      stage.append(h('div.banner', { style: { fontSize: '22px' } }, 'PAQUET DE CARTES'), pack, msg, row,
        h('div.muted', { style: { font: '600 12px var(--font-ui)', textAlign: 'center' } }, '3 cartes surprises : pièces, nourriture, dollars ou XP. Les cartes rares rapportent plus !'));
      inner.append(stage);
      timer();
    };
    const timer = () => {
      if (mode !== 'idle' || !refs.msg) return;
      const ready = !!ecall('cardsReady');
      refs.msg.textContent = ready ? 'Un paquet gratuit t’attend !' : 'Prochain paquet gratuit dans ' + fmtTime(ecall('cardsIn') || 0);
      if (refs.free.disabled === ready) { refs.free.disabled = !ready; refs.free.classList.toggle('title-play', ready); }
    };
    const open = paid => {
      sfx('click');
      const res = ecall('openPack', paid);
      if (!okRes(res)) { failToast(res); return; }
      mode = 'reveal';
      inner.innerHTML = '';
      const stage = h('div.pack-stage');
      const row = h('div.pack-row');
      const cards = res.cards || [];
      cards.forEach((cd, i) => {
        const F = RARITY_FRAME[cd.rarity] || RARITY_FRAME.commun;
        const k = RES_KEYS.find(x => cd.reward && cd.reward[x]) || 'coins';
        const front = h('div.face.front', { style: { '--f1': F[0], '--f2': F[1], '--f3': F[2], '--glow': F[3] } },
          h('div.fr', rarityOf(cd.rarity).name),
          h('div.fi', h('img', { src: iconURL(resIcon(k), 64), alt: '' })),
          h('div.fl', cd.label || rewardText(cd.reward)));
        const g = h('div.gcard', { style: { animationDelay: (i * 0.12) + 's' } }, cardBack(), front);
        g.addEventListener('click', () => { if (!g.classList.contains('flip')) { g.classList.add('flip'); sfx('card'); } });
        row.append(g);
        setTimeout(() => { if (g.isConnected && !g.classList.contains('flip')) { g.classList.add('flip'); try { if (PC.SFX && settings().sound !== false) PC.SFX.play('card', { rarity: cd.rarity }); } catch (e) { /* */ } } }, 650 + i * 520);
      });
      stage.append(h('div.banner.gold', { style: { fontSize: '24px' } }, 'TES CARTES !'), row);
      const okb = h('button.b.b-lg', { style: { opacity: 0, pointerEvents: 'none', transition: 'opacity .3s' }, onclick: () => { sfx('click'); renderIdle(); } }, icon('ok', 24), 'SUPER !');
      stage.append(okb);
      setTimeout(() => { okb.style.opacity = 1; okb.style.pointerEvents = 'auto'; if (cards.some(c => c.rarity === 'legendaire' || c.rarity === 'mythique')) confetti(stage, 50); }, 650 + cards.length * 520 + 300);
      inner.append(stage);
    };
    P.onTimer = timer;
    P.onUpdate = timer;
    renderIdle();
  };

  // ===========================================================================
  // COLLECTION — tabs per park, owned / available / unknown silhouettes
  // ===========================================================================
  let colPark = null;
  UI.openCollection = function (p) {
    colPark = p || colPark || cur();
    const P = openPanel('collection', 'COLLECTION');
    const inner = h('div.inner');
    P.body.append(inner);
    const render = () => {
      keepScroll(inner, () => {
        inner.innerHTML = '';
        const order = D().PARK_ORDER || ['land', 'sea', 'ice'];
        const ownedSet = new Map();
        for (const pk of order) for (const o of ecall('objects', pk) || []) if (o.type === 'enclosure') {
          const prev = ownedSet.get(o.speciesId);
          if (!prev || (o.level || 1) > (prev.level || 1)) ownedSet.set(o.speciesId, Object.assign({ park: pk }, o));
        }
        const tabs = order.map(pk => {
          const ids = (PC.SPECIES_ORDER || {})[pk] || [];
          const n = ids.filter(id => ownedSet.has(id)).length;
          return { id: pk, label: park(pk).name.replace('Parc ', '') + ' ' + n + '/' + ids.length, icon: resIcon(park(pk).food) };
        });
        inner.append(htabs(tabs, colPark, id => { colPark = id; render(); }), h('div.tabline'));
        const grid = h('div.grid.scroll-y', { 'data-sk': 'col-' + colPark });
        for (const id of (PC.SPECIES_ORDER || {})[colPark] || []) grid.append(collectionCard(id, ownedSet.get(id)));
        inner.append(grid);
      });
    };
    P.onUpdate = null;
    render();
  };
  function collectionCard(id, owned) {
    const sp = spdef(id);
    const st = ecall('speciesStatus', id) || { state: 'level' };
    const known = !!owned || st.state === 'available' || st.state === 'owned';
    const card = h('div.card.r-' + sp.rarity);
    card.append(h('div.cn', known || st.state === 'research' || st.state === 'researching' ? sp.name : '???'), h('div.cr', rarityOf(sp.rarity).name));
    const stage = owned ? PC.stageForLevel(owned.level || 1) : 2;
    const ci = h('div.ci', h('img.art', { src: portraitURL(id, 260, 190, { stage, silhouette: !known }), alt: '' }));
    if (known) ci.append(h('img.cls', { src: iconURL(sp.cls, 26), alt: '' }));
    card.append(ci);
    if (owned) {
      const stars = h('span.stars');
      for (let i = 0; i < 4; i++) stars.append(h('img' + (i <= stage ? '' : '.off'), { src: iconURL('star', 16), alt: '', style: { width: '16px', height: '16px' } }));
      card.append(h('div.cinfo', h('span', 'Niv. ' + (owned.level || 1)), stars));
      card.append(h('button.b.b-sm.cb', { onclick: () => {
        sfx('click');
        const go = () => { closePanel(true); const o = getObj(owned.id); if (o) { V('centerOn', o.gx + (o.w || 1) / 2, o.gy + (o.h || 1) / 2); UI.openCreature(o); } };
        if (owned.park !== cur()) goToPark(owned.park, go); else go();
      } }, 'Voir'));
    } else {
      let label = 'À créer au marché';
      if (st.state === 'level' || st.state === 'park') label = 'Niveau ' + (st.needLevel || sp.level);
      else if (st.state === 'research' || st.state === 'researching') { const s2 = ecall('researchSteps', id) || { done: 0, steps: 0 }; label = 'ADN ' + s2.done + ' / ' + s2.steps; }
      else if (st.state === 'offer_only') label = 'Offre spéciale';
      card.append(h('div.cinfo', h('span', label)));
    }
    return card;
  }

  // ===========================================================================
  // PARCS — three themed cards with unlock state and cost; switching parks
  // ===========================================================================
  const PARK_DESC = {
    land: 'Jungle, fougères et volcan : le royaume des dinosaures.',
    sea: 'Un lagon turquoise et ses géants des mers. Inès t’y attend !',
    ice: 'Neige, glaciers et mammouths : l’ère glaciaire avec Oleg.',
  };
  const PARK_HERO = { land: 'triceratops', sea: 'plesiosaurus', ice: 'mammoth' };
  function drawParkScene(c, w, hh, t, p) {
    const sky = { land: ['#ffd68a', '#f39a5a', '#9ad06a'], sea: ['#8fe0f0', '#2a8ac0', '#0f3a5a'], ice: ['#cfe8f6', '#eef6fb', '#ffffff'] }[p] || ['#888', '#666', '#444'];
    c.fillStyle = lin(c, 0, 0, 0, hh, [[0, sky[0]], [0.55, sky[1]], [1, sky[2]]]); c.fillRect(0, 0, w, hh);
    if (p === 'land') {
      c.fillStyle = '#7a5a4a'; c.beginPath(); c.moveTo(w * 0.55, hh * 0.62); c.lineTo(w * 0.7, hh * 0.18); c.lineTo(w * 0.78, hh * 0.18); c.lineTo(w * 0.95, hh * 0.62); c.fill();
      c.fillStyle = '#ff7a1a'; c.beginPath(); c.moveTo(w * 0.7, hh * 0.18); c.lineTo(w * 0.78, hh * 0.18); c.lineTo(w * 0.75, hh * 0.3); c.fill();
      c.fillStyle = 'rgba(80,70,70,.5)'; ell(c, w * 0.74 + Math.sin(t * 0.7) * 5, hh * 0.08, 22, 10); c.fill();
      c.fillStyle = '#5a9a3a'; c.beginPath(); c.moveTo(0, hh * 0.7); for (let x = 0; x <= w; x += 20) c.lineTo(x, hh * 0.64 - Math.sin(x * 0.02) * 10); c.lineTo(w, hh); c.lineTo(0, hh); c.fill();
      for (let i = 0; i < 4; i++) {
        const x = (i + 0.3) * w / 4, y = hh * 0.72;
        c.strokeStyle = '#5a3a1a'; c.lineWidth = 4; c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + 6, y - 26, x + 3, y - 44); c.stroke();
        c.fillStyle = '#2f7a2a';
        for (let k = 0; k < 6; k++) { c.beginPath(); c.ellipse(x + 3 + Math.cos(k * 1.05) * 14, y - 44 + Math.sin(k * 1.05) * 4 + Math.sin(t * 2 + k) * 1.5, 17, 5, k * 1.05, 0, TAU); c.fill(); }
      }
    } else if (p === 'sea') {
      c.save(); c.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 4; i++) { const x = (i / 4 + 0.15) * w + Math.sin(t * 0.5 + i) * 12; c.fillStyle = 'rgba(220,250,255,.16)'; c.beginPath(); c.moveTo(x - 10, 0); c.lineTo(x + 10, 0); c.lineTo(x + 50, hh); c.lineTo(x + 18, hh); c.fill(); }
      c.restore();
      c.fillStyle = '#d8c48a'; c.fillRect(0, hh * 0.8, w, hh * 0.2);
      for (let i = 0; i < 8; i++) {
        const x = (i * 97) % w, y = hh * 0.82, s2 = 12 + (i % 3) * 6;
        c.fillStyle = ['#e0507a', '#f08a3a', '#9a5ad0', '#4ab08a'][i % 4];
        for (let k = 0; k < 4; k++) { c.beginPath(); c.ellipse(x + (k - 1.5) * s2 * 0.4, y - s2 * 0.6, s2 * 0.2, s2 * 0.7, (k - 1.5) * 0.35, 0, TAU); c.fill(); }
      }
      c.fillStyle = 'rgba(255,255,255,.5)';
      for (let i = 0; i < 10; i++) { const by = hh - ((t * 26 + i * 29) % hh); ell(c, (i * 61) % w, by, 2.5, 2.5); c.fill(); }
    } else {
      c.fillStyle = '#b8d4e6'; c.beginPath(); c.moveTo(0, hh * 0.66); c.lineTo(w * 0.2, hh * 0.25); c.lineTo(w * 0.38, hh * 0.5); c.lineTo(w * 0.6, hh * 0.15); c.lineTo(w * 0.85, hh * 0.45); c.lineTo(w, hh * 0.3); c.lineTo(w, hh * 0.66); c.fill();
      c.fillStyle = '#fff'; c.beginPath(); c.moveTo(w * 0.14, hh * 0.36); c.lineTo(w * 0.2, hh * 0.25); c.lineTo(w * 0.27, hh * 0.36); c.fill(); c.beginPath(); c.moveTo(w * 0.53, hh * 0.27); c.lineTo(w * 0.6, hh * 0.15); c.lineTo(w * 0.68, hh * 0.27); c.fill();
      c.fillStyle = '#f6fbff'; c.fillRect(0, hh * 0.66, w, hh * 0.34);
      for (let i = 0; i < 5; i++) {
        const x = (i + 0.4) * w / 5, y = hh * 0.74, s2 = 16;
        c.fillStyle = '#2e5a4a'; for (let k = 0; k < 3; k++) { c.beginPath(); c.moveTo(x, y - s2 * (1.4 - k * 0.32)); c.lineTo(x + s2 * (0.35 + k * 0.14), y - s2 * (0.6 - k * 0.3)); c.lineTo(x - s2 * (0.35 + k * 0.14), y - s2 * (0.6 - k * 0.3)); c.fill(); }
      }
      c.fillStyle = 'rgba(255,255,255,.9)';
      for (let i = 0; i < 26; i++) { const sy = (t * 22 + i * 19) % hh, sx = (i * 43 + Math.sin(t + i) * 8) % w; ell(c, sx, sy, 1.6, 1.6); c.fill(); }
    }
    // hero creature
    const id = PARK_HERO[p];
    if (id && spdef(id) && PC.ART && PC.ART.drawCreature) {
      const meta = PC.ART.templateMeta(id), b = meta.bounds, sp = spdef(id);
      const sc = Math.min(w * 0.42 / ((b[2] - b[0]) * sp.size), hh * 0.55 / ((b[3] - b[1]) * sp.size));
      PC.ART.drawCreature(c, id, { x: w * 0.36, y: hh * (p === 'sea' ? 0.7 : 0.9), scale: sc, stage: 2, t, pose: p === 'sea' ? 'swim' : 'idle', facing: 1, shadow: p !== 'sea' });
    }
  }
  UI.drawParkScene = drawParkScene;
  UI.openParks = function () {
    const P = openPanel('parks', 'PARCS');
    const inner = h('div.inner');
    P.body.append(inner);
    const render = () => {
      keepScroll(inner, () => {
        inner.innerHTML = '';
        const row = h('div.park-cards.scroll-y', { 'data-sk': 'parks' });
        for (const pk of D().PARK_ORDER || ['land', 'sea', 'ice']) {
          const st = ecall('parkStatus', pk) || { unlocked: pk === 'land', needLevel: 1, cost: {}, levelOk: true };
          const P2 = park(pk);
          const cv = h('canvas');
          animCanvas(cv, (c, w, hh, t) => {
            drawParkScene(c, w, hh, t, pk);
            if (!st.unlocked) { c.fillStyle = 'rgba(10,14,18,.55)'; c.fillRect(0, 0, w, hh); coreIcon(c, 'lock', w / 2, hh / 2, 56); }
          });
          let btn;
          if (pk === cur()) btn = h('button.b.b-steel', { disabled: true }, icon('check', 22), 'Tu es ici');
          else if (st.unlocked) btn = h('button.b', { onclick: () => { sfx('click'); closePanel(true); goToPark(pk); } }, icon('parks', 22), 'Visiter');
          else if (!st.levelOk) btn = h('button.b.b-dark', { onclick: () => { sfx('error'); toast('Atteins le niveau ' + st.needLevel + ' pour débloquer le ' + P2.name + '.', 'info'); } }, icon('lock', 22), 'Niveau ' + st.needLevel + ' requis');
          else btn = h('button.b.b-orange', { onclick: () => unlockParkUI(pk) }, 'Débloquer', pricePill(st.cost));
          row.append(h('div.pcard' + (pk === cur() ? '.cur' : ''), cv, h('div.pn', P2.name), h('div.pd', PARK_DESC[pk] || ''), btn));
        }
        inner.append(row);
      });
    };
    P.onUpdate = render;
    render();
  };
  function unlockParkUI(pk) {
    const st = ecall('parkStatus', pk) || {};
    if (st.cost && !canAfford(st.cost)) { sfx('error'); toast(missingText(st.cost), 'bad'); return; }
    const res = ecall('unlockPark', pk);
    if (!okRes(res)) { failToast(res); return; }
    closePanel(true);
  }
  function showParkUnlocked(pk) {
    enqueue(done => {
      sfx('levelup');
      const cv = h('canvas', { style: { width: '100%', height: '170px', display: 'block', borderRadius: '12px', boxShadow: '0 0 0 2px #000, 0 0 0 4px #7b858e' } });
      animCanvas(cv, (c, w, hh, t) => drawParkScene(c, w, hh, t, pk));
      const m = modal({
        title: 'NOUVEAU PARC !', rays: true,
        body: [cv, h('div.banner.gold', { style: { fontSize: '26px' } }, park(pk).name.toUpperCase()), h('div.mtxt', PARK_DESC[pk] || '')],
        buttons: [{ label: 'Plus tard', cls: 'b-dark', value: false }, { label: 'Visiter', icon: 'parks', value: true }],
        onClose: v => { if (v === true) goToPark(pk); done(); },
      });
      confetti(m.wrap, 50);
    });
  }

  // ===========================================================================
  // OPTIONS — music / sound toggles, help, credits, restart (in-page confirm)
  // ===========================================================================
  function setSetting(k, v) {
    if (has('setSetting')) ecall('setSetting', k, v);
    else { const s = S(); if (s) { s.settings = s.settings || {}; s.settings[k] = v; } }
    UI.applyAudioSettings();
    if (k === 'music' && v && gameStarted) UI.music(UI.parkTrack());
  }
  function toggle(on, onChange) {
    const t = h('button.toggle' + (on ? '.on' : ''), { 'aria-pressed': on ? 'true' : 'false', onclick: () => {
      on = !on; t.classList.toggle('on', on); t.setAttribute('aria-pressed', on ? 'true' : 'false'); onChange(on); if (on) sfx('click');
    } }, h('i'));
    return t;
  }
  UI.openOptions = function () {
    const P = openPanel('options', 'OPTIONS', { cls: 'narrow' });
    const st = settings();
    const logo = h('canvas', { style: { width: '100%', maxWidth: '360px', aspectRatio: '1.6', display: 'block', margin: '0 auto' } });
    requestAnimationFrame(() => { if (logo.isConnected) { const f = fitCanvas(logo); LOGO.draw(f.ctx, f.w, f.h, 0); } });
    const inner = h('div.inner.scroll-y', { style: { padding: '12px', gap: '10px', display: 'flex', flexDirection: 'column' } });
    inner.append(logo,
      h('div.opt-row', icon('music', 34), h('span.ol', 'Musique'), toggle(st.music !== false, v => setSetting('music', v))),
      h('div.opt-row', icon('sound', 34), h('span.ol', 'Sons'), toggle(st.sound !== false, v => setSetting('sound', v))),
      h('div.opt-row', icon('help', 34), h('span.ol', 'Comment jouer'), h('button.b.b-blue.b-sm', { onclick: () => { sfx('click'); showHelp(); } }, 'Lire')),
      h('div.opt-row', icon('info', 34), h('span.ol', 'Crédits'), h('button.b.b-steel.b-sm', { onclick: () => { sfx('click'); showCredits(); } }, 'Voir')),
      h('div.opt-row', icon('restart', 34), h('span.ol', 'Recommencer'), h('button.b.b-red.b-sm', { onclick: () => { sfx('click'); askRestart(); } }, 'Recommencer')));
    P.body.append(inner);
  };
  function showHelp() {
    const sec = (t, ...ps) => [h('h3', t), ...ps.map(p => h('p', p))];
    modal({
      title: 'COMMENT JOUER', cls: 'help',
      body: [h('div', { style: { textAlign: 'left', width: '100%' } },
        ...sec('Ton parc', 'Fais glisser pour te déplacer, molette ou deux doigts pour zoomer. Touche un enclos ou un bâtiment pour voir ce que tu peux faire.'),
        ...sec('Les créatures', 'Achète un œuf au MARCHÉ, place son enclos puis attends qu’il éclose. Touche les bulles de pièces pour les ramasser.',
          'Nourris tes créatures : elles montent de niveau et évoluent (Bébé → Juvénile → Adulte → Alpha) !'),
        ...sec('La nourriture', 'Construis des fermes, touche ACTIVER et choisis une livraison. Reviens COLLECTER quand elle est arrivée.'),
        ...sec('Le Labo ADN', 'Certaines espèces doivent être recherchées en plusieurs étapes. Une étape peut échouer : réessaie pour 1 $ ! Tu peux aussi envoyer une expédition chercher de l’ambre.'),
        ...sec('Le tournoi', 'Choisis jusqu’à 3 créatures et affronte les dresseurs. Les Chasseurs battent les Colosses, les Colosses battent les Blindés, les Blindés battent les Chasseurs.'),
        ...sec('Les missions', 'Suis l’histoire avec le Dr Élise Morel et accomplis les missions bonus pour gagner des récompenses.'))],
      buttons: [{ label: 'Compris !', icon: 'ok' }],
    });
  }
  function showCredits() {
    modal({
      title: 'CRÉDITS',
      body: [h('div.mtxt', { html: '<b>Crétacé Park</b> — un jeu de parc à dinosaures.<br><br>Tous les dessins, les animations, la musique et les sons sont créés par le code du jeu (Canvas 2D et WebAudio), sans aucune image ni fichier son.<br><br>Polices : Russo One et Exo 2 (Google Fonts).<br><br>Merci de jouer, directeur !' })],
      buttons: [{ label: 'Fermer' }],
    });
  }
  function askRestart() {
    UI.confirm({ title: 'Recommencer ?', danger: true, yes: 'Tout effacer', html: 'Ton parc, tes créatures et ta progression seront <b>effacés</b>. Es-tu vraiment sûr ?' }).then(yes => {
      if (!yes) return;
      closePanel(true);
      cancelPlacement();
      hideActionBar();
      queue.length = 0;
      ecall('reset');
      if (view) V('setPark', cur());
      buildCaps();
      UI.refresh();
      UI.music(UI.parkTrack());
      toast('Nouvelle partie : bienvenue à Crétacé Park !', 'good');
      const m = ecall('mission');
      if (m && m.def) UI.storySheet(m.def, 'intro');
    });
  }

  // ===========================================================================
  // Level-up modal (rewards + unlock list) and battle entry
  // ===========================================================================
  UI.showLevelUp = function (e) {
    if (!e) return;
    enqueue(done => {
      sfx('levelup');
      const badge = h('div.big-badge', h('span', 'NIV'), h('b', String(e.level)));
      const body = [h('div', { style: { position: 'relative', display: 'flex', justifyContent: 'center' } }, badge),
        h('div.banner.gold', 'NIVEAU SUPÉRIEUR !')];
      if (e.reward && Object.keys(e.reward).length) body.push(h('div.rw-label', 'Récompenses'), chips(e.reward, '+'));
      const ids = e.unlockIds || (e.unlocks || []).map(t2 => ({ text: t2 }));
      if (ids.length) {
        const ul = h('ul.unlocks');
        for (const u of ids.slice(0, 6)) {
          const img = u.type === 'species' && spdef(u.id) ? h('img', { src: portraitURL(u.id, 48, 48, { stage: 0, bg: false }), alt: '' })
            : icon(u.type === 'park' ? 'parks' : u.type === 'building' ? 'tab_buildings' : 'star', 24);
          ul.append(h('li', img, h('span', u.text)));
        }
        if (ids.length > 6) ul.append(h('li', h('span', '… et ' + (ids.length - 6) + ' autres nouveautés !')));
        body.push(h('div.rw-label', 'Nouveautés'), ul);
      }
      const m = modal({ cls: 'levelup', rays: true, body, buttons: [{ label: 'SUPER !', icon: 'ok' }], onClose: () => done() });
      confetti(m.wrap, 60);
    });
  };
  UI.openBattle = function () {
    closePanel(true);
    hideActionBar();
    const team = ecall('battleTeam', cur()) || [];
    if (!team.length) {
      modal({ title: 'TOURNOI', body: [npcCanvas('marco', 'ms-npc'), h('div.mtxt', 'Salut, je suis Marco, le chef des rangers ! Pour participer au tournoi, il te faut au moins une créature éclose dans ce parc. Reviens vite !')], buttons: [{ label: 'D’accord', icon: 'ok' }] });
      return;
    }
    if (PC.BATTLE && typeof PC.BATTLE.open === 'function') {
      try { PC.BATTLE.open(cur()); } catch (e) { console.error('BATTLE.open', e); toast('Le tournoi n’est pas disponible pour le moment.', 'bad'); }
    } else toast('Le tournoi se prépare… Reviens bientôt !', 'info');
  };


  // ===========================================================================
  // Title screen (volcanic sunset, logo, tip, JOUER) and launch intro (roaring T-Rex)
  // ===========================================================================
  function palm(c, x, y, s, col, t, seed) {
    c.save(); c.translate(x, y); c.scale(s, s);
    c.strokeStyle = col; c.fillStyle = col; c.lineCap = 'round';
    const lean = Math.sin(seed) * 0.25;
    c.lineWidth = 7; c.beginPath(); c.moveTo(0, 0); c.quadraticCurveTo(lean * 60, -50, lean * 90, -110); c.stroke();
    const tx = lean * 90, ty = -110;
    for (let k = 0; k < 7; k++) {
      const a = -Math.PI / 2 + (k - 3) * 0.5 + Math.sin(t * 0.8 + seed + k) * 0.04;
      const ex = tx + Math.cos(a) * 62, ey = ty + Math.sin(a) * 30 + 26;
      c.beginPath(); c.moveTo(tx, ty);
      c.quadraticCurveTo(tx + Math.cos(a) * 40, ty + Math.sin(a) * 36 - 8, ex, ey);
      c.quadraticCurveTo(tx + Math.cos(a) * 34, ty + Math.sin(a) * 22, tx, ty + 4);
      c.fill();
    }
    c.restore();
  }
  function jungleLayer(c, w, y0, amp, col, seed, t, palms) {
    const r0 = H ? H.rng(seed) : Math.random;
    c.fillStyle = col;
    c.beginPath(); c.moveTo(0, y0 + 200);
    for (let x = 0; x <= w + 30; x += 30) c.lineTo(x, y0 - Math.abs(Math.sin(x * 0.013 + seed)) * amp - r0() * amp * 0.4);
    c.lineTo(w, y0 + 400); c.lineTo(0, y0 + 400); c.closePath(); c.fill();
    for (let i = 0; i < palms; i++) palm(c, r0() * w, y0 + 6, 0.6 + r0() * 0.7, col, t, seed + i);
  }
  function drawTitleBg(c, w, hh, t) {
    c.fillStyle = lin(c, 0, 0, 0, hh, [[0, '#1c0a24'], [0.35, '#6a1a34'], [0.58, '#e0602a'], [0.72, '#ffb24a'], [1, '#3a1410']]);
    c.fillRect(0, 0, w, hh);
    const sr = Math.min(w, hh) * 0.17;
    c.fillStyle = rad(c, w * 0.5, hh * 0.64, sr * 0.2, sr * 2.4, [[0, 'rgba(255,240,180,.9)'], [0.35, 'rgba(255,190,90,.45)'], [1, 'rgba(255,140,60,0)']]);
    c.fillRect(0, 0, w, hh);
    ell(c, w * 0.5, hh * 0.64, sr, sr); c.fillStyle = '#ffe7a8'; c.fill();
    // volcano with lava and smoke
    const vx = w * 0.8, vy = hh * 0.7, vs = Math.min(w, hh) * 0.42;
    for (let i = 0; i < 7; i++) {
      const ph = (t * 0.06 + i / 7) % 1;
      c.fillStyle = `rgba(50,20,30,${0.45 * (1 - ph)})`;
      ell(c, vx + Math.sin(i * 3 + t * 0.3) * 20 + ph * 60, vy - vs * 0.62 - ph * vs * 0.9, vs * (0.08 + ph * 0.22), vs * (0.06 + ph * 0.16)); c.fill();
    }
    c.fillStyle = lin(c, 0, vy - vs * 0.6, 0, vy, [[0, '#4a1a26'], [1, '#2a0c16']]);
    c.beginPath(); c.moveTo(vx - vs * 0.8, vy + 10);
    c.quadraticCurveTo(vx - vs * 0.3, vy - vs * 0.12, vx - vs * 0.12, vy - vs * 0.6);
    c.lineTo(vx - vs * 0.05, vy - vs * 0.56); c.lineTo(vx + 0, vy - vs * 0.6); c.lineTo(vx + vs * 0.1, vy - vs * 0.58);
    c.quadraticCurveTo(vx + vs * 0.32, vy - vs * 0.12, vx + vs * 0.85, vy + 10); c.fill();
    c.save(); c.globalCompositeOperation = 'lighter';
    c.fillStyle = rad(c, vx, vy - vs * 0.6, 2, vs * 0.3, [[0, `rgba(255,140,40,${0.7 + 0.2 * Math.sin(t * 2)})`], [1, 'rgba(255,80,20,0)']]);
    c.fillRect(vx - vs * 0.4, vy - vs, vs * 0.8, vs * 0.8);
    c.restore();
    c.strokeStyle = '#ff7a1a'; c.lineWidth = 3; c.lineCap = 'round';
    c.beginPath(); c.moveTo(vx - vs * 0.04, vy - vs * 0.6); c.quadraticCurveTo(vx - vs * 0.08, vy - vs * 0.4, vx - vs * 0.16, vy - vs * 0.28); c.stroke();
    // flying pterosaurs
    c.fillStyle = '#2a0e1c';
    for (let i = 0; i < 3; i++) {
      const px = ((t * (18 + i * 7) + i * 300) % (w + 200)) - 100, py = hh * (0.16 + i * 0.08) + Math.sin(t + i) * 8;
      const fl = Math.sin(t * 5 + i * 2) * 0.6, s2 = 10 + i * 3;
      c.beginPath(); c.moveTo(px - s2 * 2, py - fl * s2); c.quadraticCurveTo(px - s2, py - s2 * 0.4, px, py); c.quadraticCurveTo(px + s2, py - s2 * 0.4, px + s2 * 2, py - fl * s2);
      c.quadraticCurveTo(px + s2, py + s2 * 0.1, px, py + s2 * 0.3); c.quadraticCurveTo(px - s2, py + s2 * 0.1, px - s2 * 2, py - fl * s2); c.fill();
    }
    jungleLayer(c, w, hh * 0.74, 40, '#4a1424', 11, t, 3);
    jungleLayer(c, w, hh * 0.84, 34, '#2a0a16', 23, t, 4);
    jungleLayer(c, w, hh * 0.95, 24, '#12040a', 37, t, 3);
    // embers
    c.save(); c.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 26; i++) {
      const ph = (t * 0.12 + i / 26) % 1;
      const ex = (i * 97.3) % w + Math.sin(t + i) * 14, ey = hh * (1 - ph);
      c.fillStyle = `rgba(255,${140 + (i % 5) * 20},60,${Math.sin(ph * Math.PI) * 0.8})`;
      ell(c, ex, ey, 1.8, 1.8); c.fill();
    }
    c.restore();
  }
  let titleShowing = false;
  /** Title screen with the logo, a tip and the JOUER button. onPlay is called after the first tap. */
  UI.showTitle = function (onPlay) {
    const r = roots();
    titleShowing = true;
    r.title.innerHTML = '';
    r.title.classList.remove('hidden');
    r.title.style.opacity = '';
    const bg = h('canvas');
    r.title.append(bg);
    animCanvas(bg, drawTitleBg);
    const logo = h('canvas.title-logo');
    animCanvas(logo, (c, w, hh, t) => LOGO.draw(c, w, hh, t));
    const tips = D().TIPS || [];
    const tip = tips.length ? tips[Math.floor(Math.random() * tips.length)] : '';
    let started = false;
    const go = () => {
      if (started) return;
      started = true;
      UI.unlockAudio();
      sfx('click');
      document.removeEventListener('keydown', onKey);
      r.title.style.transition = 'opacity .35s';
      r.title.style.opacity = '0';
      setTimeout(() => { r.title.classList.add('hidden'); r.title.innerHTML = ''; titleShowing = false; }, 380);
      if (onPlay) onPlay();
    };
    const onKey = e => { if (e.key === 'Enter' || e.key === ' ') go(); };
    document.addEventListener('keydown', onKey);
    const play = h('button.b.b-xl.title-play', { onclick: go }, 'JOUER');
    r.title.append(h('div.title-ui', logo, h('div.title-bottom',
      tip ? h('div.title-tip', h('b', 'ASTUCE'), tip) : null, play,
      h('div.title-foot', 'Un parc à dinosaures 100 % original · dessins, musique et sons créés par le code'))));
  };
  /** Unlock WebAudio on the first user gesture and push the toggles. */
  UI.unlockAudio = function () {
    try { if (PC.SFX && PC.SFX.unlock) PC.SFX.unlock(); } catch (e) { /* */ }
    try { if (PC.MUSIC && PC.MUSIC.unlock && PC.MUSIC.unlock !== (PC.SFX && PC.SFX.unlock)) PC.MUSIC.unlock(); } catch (e) { /* */ }
    UI.applyAudioSettings();
  };

  /** ~5 s launch intro: jungle at dusk, a T-Rex stomps in, roars (shake, dust, birds), the logo slams in. Tap to skip. */
  UI.playIntro = function (done) {
    const r = roots();
    const cv = r.intro;
    if (!cv) { if (done) done(); return; }
    cv.classList.remove('hidden');
    cv.style.transition = '';
    cv.style.opacity = '1';
    UI.music('title');
    const t0 = performance.now();
    let finished = false;
    const fired = {};
    const rexId = spdef('tyrannosaurus') ? 'tyrannosaurus' : Object.keys(PC.SPECIES || {})[0];
    const birds = [];
    for (let i = 0; i < 9; i++) birds.push({ x: 0.58 + (i % 5) * 0.08 + (i > 4 ? 0.04 : 0), y: 0.42 + (i % 3) * 0.06 + (i > 4 ? 0.05 : 0), d: Math.random() * 0.4, sp: 0.8 + Math.random() * 0.6 });
    const dust = [];
    const finish = () => {
      if (finished) return;
      finished = true;
      cv.removeEventListener('pointerdown', skip);
      cv.style.transition = 'opacity .4s';
      cv.style.opacity = '0';
      setTimeout(() => { cv.classList.add('hidden'); cv.style.opacity = '1'; }, 420);
      if (done) done();
    };
    const skip = e => { e.preventDefault(); finish(); };
    cv.addEventListener('pointerdown', skip);
    const shakeAt = [];
    const once = (k, t, fn) => { if (!fired[k] && t >= 0) { fired[k] = true; fn(); } };
    addAnim(() => {
      if (finished) return false;
      const t = (performance.now() - t0) / 1000;
      const f = fitCanvas(cv);
      const c = f.ctx, w = f.w, hh = f.h;
      // timeline
      const steps = [0.7, 1.05, 1.4, 1.75, 2.05];
      steps.forEach((st, i) => once('step' + i, t - st, () => { shakeAt.push([t, 5, 0.3]); sfx('stomp'); for (let k = 0; k < 6; k++) dust.push({ x: 0, y: 0, rel: true, t0: t, a: Math.random() * Math.PI, s: 0.5 + Math.random() }); }));
      once('roar', t - 2.35, () => { shakeAt.push([t, 11, 1.1]); sfx('roar'); try { if (PC.MUSIC && PC.MUSIC.duck) PC.MUSIC.duck(1.4); } catch (e) { /* */ } });
      once('slam', t - 3.85, () => { shakeAt.push([t, 16, 0.45]); sfx('crit'); });
      let sx = 0, sy = 0;
      for (const [st, mag, dur] of shakeAt) {
        const a = t - st;
        if (a >= 0 && a < dur) { const k = (1 - a / dur) * mag; sx += Math.sin(t * 90) * k; sy += Math.cos(t * 77) * k; }
      }
      c.save();
      c.translate(sx, sy);
      // dusk sky + moon
      c.fillStyle = lin(c, 0, -20, 0, hh, [[0, '#0b1028'], [0.5, '#3a2448'], [0.75, '#c2563a'], [1, '#2a1410']]);
      c.fillRect(-30, -30, w + 60, hh + 60);
      const mr = Math.min(w, hh) * 0.09;
      c.fillStyle = rad(c, w * 0.72, hh * 0.22, mr * 0.5, mr * 3, [[0, 'rgba(255,240,210,.35)'], [1, 'rgba(255,240,210,0)']]); c.fillRect(0, 0, w, hh);
      ell(c, w * 0.72, hh * 0.22, mr, mr); c.fillStyle = '#fff1d6'; c.fill();
      jungleLayer(c, w, hh * 0.66, 50, '#2a1a30', 5, t, 3);
      jungleLayer(c, w, hh * 0.78, 40, '#170e1c', 17, t, 4);
      // birds perched → flying away after the roar
      c.fillStyle = '#05030a';
      for (const b of birds) {
        let bx = b.x * w, by = b.y * hh;
        const fly = t - 2.45 - b.d;
        if (fly > 0) { bx += fly * 180 * b.sp; by -= fly * 220 * b.sp + Math.sin(fly * 12) * 4; }
        const fl = fly > 0 ? Math.sin(t * 22 + b.d * 9) * 0.8 : 0.2;
        const s2 = Math.min(w, hh) * 0.012;
        c.beginPath(); c.moveTo(bx - s2 * 2, by - fl * s2); c.quadraticCurveTo(bx - s2, by - s2 * 0.3, bx, by); c.quadraticCurveTo(bx + s2, by - s2 * 0.3, bx + s2 * 2, by - fl * s2);
        c.quadraticCurveTo(bx, by + s2 * 0.6, bx - s2 * 2, by - fl * s2); c.fill();
      }
      // ground
      const gy = hh * 0.9;
      c.fillStyle = '#0c0608'; c.fillRect(-30, gy - 4, w + 60, hh - gy + 40);
      // T-Rex
      if (rexId && PC.ART && PC.ART.drawCreature) {
        const meta = PC.ART.templateMeta(rexId), b = meta.bounds, sp = spdef(rexId);
        const sc = Math.min(hh * 0.47 / ((b[3] - b[1]) * sp.size), w * 0.56 / ((b[2] - b[0]) * sp.size));
        const walkP = clamp((t - 0.3) / 1.85, 0, 1);
        const xx = lerp(-w * 0.45, w * 0.32, ease(walkP));
        let pose = 'walk', k = 0;
        if (walkP >= 1) pose = 'idle';
        if (t > 2.3 && t < 3.75) { pose = 'roar'; k = clamp((t - 2.3) / 0.4, 0, 1); }
        PC.ART.drawCreature(c, rexId, { x: xx, y: gy, scale: sc, stage: 3, t: pose === 'walk' ? t * 1.3 : t, pose, k, facing: 1 });
        // dust puffs at the feet
        for (const d of dust) {
          if (d.rel) { d.x = xx + (Math.random() - 0.5) * 80 * sc; d.y = gy; d.rel = false; }
          const a = t - d.t0;
          if (a > 1.2) continue;
          c.fillStyle = `rgba(150,110,90,${0.5 * (1 - a / 1.2)})`;
          ell(c, d.x + Math.cos(d.a) * a * 60 * d.s, d.y - a * 24 * d.s, 10 + a * 30 * d.s, 6 + a * 14 * d.s); c.fill();
        }
        // roar shockwaves + text
        if (t > 2.35 && t < 3.7) {
          const mx = xx + b[2] * sc * sp.size * 0.85, my = gy + b[1] * sc * sp.size * 0.75;
          for (let i = 0; i < 3; i++) {
            const a = (t - 2.35 - i * 0.22);
            if (a < 0 || a > 1) continue;
            c.strokeStyle = `rgba(255,230,190,${0.6 * (1 - a)})`; c.lineWidth = 4 * (1 - a) + 1;
            c.beginPath(); c.arc(mx, my, 20 + a * Math.min(w, hh) * 0.4, -1.1, 1.1); c.stroke();
          }
          const ta = clamp((t - 2.45) / 0.25, 0, 1) * clamp((3.55 - t) / 0.25, 0, 1);
          if (ta > 0) {
            c.save(); c.globalAlpha = ta;
            c.translate(mx + Math.min(w, hh) * 0.12, my - Math.min(w, hh) * 0.08); c.rotate(-0.12);
            const fsz = Math.round(Math.min(w, hh) * 0.09);
            c.font = fsz + 'px "Russo One", Impact, sans-serif'; c.textAlign = 'center';
            const jx = Math.sin(t * 60) * 3;
            c.lineWidth = fsz * 0.16; c.strokeStyle = '#1a0402'; c.strokeText('GRAAAOOO !', jx, 0);
            c.fillStyle = lin(c, 0, -fsz, 0, 0, [[0, '#fff3a0'], [1, '#ff7a1a']]); c.fillText('GRAAAOOO !', jx, 0);
            c.restore();
          }
        }
      }
      // logo slam
      if (t > 3.5) {
        const a = clamp((t - 3.5) / 0.35, 0, 1);
        const s = 1 + (1 - a) * 2.2;
        const lw = Math.min(w * 0.88, 600, hh * 0.6 * 1.6), lh = lw / 1.6;
        c.save();
        c.globalAlpha = clamp(a * 1.6, 0, 1);
        c.translate(w / 2, hh * 0.04 + lh / 2);
        c.scale(s, s);
        c.translate(-lw / 2, -lh / 2);
        LOGO.draw(c, lw, lh, t);
        c.restore();
        const fl = t - 3.85;
        if (fl > 0 && fl < 0.45) { c.fillStyle = `rgba(255,245,220,${0.75 * (1 - fl / 0.45)})`; c.fillRect(-30, -30, w + 60, hh + 60); }
      }
      c.restore();
      // vignette + skip hint
      c.fillStyle = rad(c, w / 2, hh / 2, Math.min(w, hh) * 0.35, Math.max(w, hh) * 0.75, [[0, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,.6)']]);
      c.fillRect(0, 0, w, hh);
      c.font = '600 13px "Exo 2", sans-serif'; c.textAlign = 'right'; c.fillStyle = 'rgba(255,255,255,.6)';
      c.fillText('Touche l’écran pour passer ▸', w - 14, hh - 14);
      if (t > 5.2) { c.fillStyle = `rgba(0,0,0,${clamp((t - 5.2) / 0.4, 0, 1)})`; c.fillRect(0, 0, w, hh); }
      if (t > 5.6) finish();
      return !finished;
    });
  };


  // ===========================================================================
  // Lifecycle: init, start, refresh, engine events, taps, keyboard
  // ===========================================================================
  let refreshRaf = 0, secTimer = 0;
  /** Build the HUD and bottom bar (call once the engine state exists). */
  UI.init = function () {
    roots();
    buildHUD();
    buildBottom();
    syncBars();
    if (!secTimer) secTimer = setInterval(tick1s, 1000);
    document.addEventListener('keydown', onKeyDown);
    UI.refresh();
  };
  /** Show the HUD and bars, start the park music, show pending popups / the first mission. */
  UI.startGame = function () {
    gameStarted = true;
    syncBars();
    UI.refresh();
    UI.music(UI.parkTrack());
    const s = S();
    if (s) {
      const m = ecall('mission');
      if (m && m.def && !m.done && !s.seenIntro) {
        UI.storySheet(m.def, 'intro');
        ecall('setSeenIntro', true);
      }
      const x = s.expedition;
      if (x && x.result === false) showLastChance();
      else if (x && x.result === true) ecall('declineExpedition');
    }
    UI.setPopupsBlocked(false);
  };
  UI.isStarted = () => gameStarted;
  /** Coalesced refresh of everything visible (call on every engine 'change'). */
  UI.refresh = function () {
    if (refreshRaf) return;
    refreshRaf = requestAnimationFrame(() => {
      refreshRaf = 0;
      try { refreshHUD(); } catch (e) { console.error('HUD', e); }
      try { refreshBottom(); } catch (e) { console.error('bottom', e); }
      try { renderActionBar(); } catch (e) { console.error('actionbar', e); }
      updatePanel();
    });
  };
  function tick1s() {
    if (!S()) return;
    try { renderActionBar(); } catch (e) { console.error(e); }
    try { refreshBottom(); } catch (e) { console.error(e); }
    if (panel && panel.onTimer) { try { panel.onTimer(); } catch (e) { console.error('panel timer', e); } }
  }

  /** Engine event → popups / panels (sounds and park effects are wired in main.js). */
  UI.handleEvent = function (name, e) {
    e = e || {};
    try {
      switch (name) {
        case 'levelup': UI.showLevelUp(e); break;
        case 'researchStart': labFx = null; break;
        case 'research': onResearch(e); break;
        case 'expedition': if (e.status === 'fail') showLastChance(); break;
        case 'promo': if (e.status === 'start') showPromo(e); break;
        case 'mission': onMission(e); break;
        case 'feed': if (e.stageUp && e.obj) UI.showEvolution(e.obj, e.prevStage != null ? e.prevStage : Math.max(0, (e.stage || 1) - 1), e.stage); break;
        case 'unlock': if (e.park) showParkUnlocked(e.park); break;
        case 'park': onPark(e.park); break;
        case 'sell': if (e.obj && actionId === e.obj.id) hideActionBar(); break;
      }
    } catch (err) { console.error('UI event ' + name, err); }
    UI.refresh();
  };
  function onResearch(e) {
    const sp = spdef(e.speciesId);
    labFx = { kind: e.success ? 'success' : 'fail', at: nowMs(), speciesId: e.speciesId };
    if (e.source !== 'amber' && e.source !== 'expedition') sfx(e.success ? 'success' : 'fail');
    if (e.complete) { showResearchDone(e.speciesId); return; }
    if (!panel || panel.name !== 'lab') {
      if (e.success) toast('Étape ' + e.step + ' / ' + e.steps + ' réussie pour ' + (sp ? 'le ' + sp.name : 'la recherche') + ' !', 'good');
      else toast('Échec de la recherche ' + (sp ? du(sp.name) : '') + '… Réessaie au Labo ADN !', 'bad');
    }
  }
  function onMission(e) {
    if (e.status === 'complete' && e.mission) { sfx('success'); UI.storySheet(e.mission, 'outro'); }
    else if (e.status === 'new' && e.mission) UI.storySheet(e.mission, 'intro');
    else if (e.status === 'finished') {
      enqueue(done => modal({ title: 'BRAVO !', rays: true, body: [h('div.banner.gold', 'HISTOIRE TERMINÉE'), h('div.mtxt', 'Tu as accompli toutes les missions de Crétacé Park. Tu es un vrai directeur de parc !')], buttons: [{ label: 'Merci !' }], onClose: () => done() }));
    }
  }
  function onPark(p) {
    cancelPlacement();
    hideActionBar();
    if (panel && panel.name !== 'parks') closePanel(true);
    V('setPark', p || cur());
    buildCaps();
    if (gameStarted) {
      UI.music(UI.parkTrack(p));
      toast('Bienvenue au ' + park(p).name + ' !', 'info');
    }
  }

  /** view.onTap handler: bubble → hatch / collect, object → panel or action bar, tile → close. */
  UI.onTap = function (hit) {
    if (!hit || placing) return;
    try {
      if (hit.kind === 'bubble' && hit.obj) tapBubble(hit.obj);
      else if (hit.kind === 'object' && hit.obj) tapObject(hit.obj);
      else hideActionBar();
    } catch (e) { console.error('tap', e); }
  };
  function tapBubble(o) {
    if (o.type === 'enclosure') {
      if (!o.hatched) {
        if (o.hatchAt != null && o.hatchAt <= (ecall('now') || Date.now())) { const res = ecall('hatch', o.id); if (!okRes(res)) failToast(res); }
        else UI.openCreature(o);
        return;
      }
      if (!ecall('collect', o.id)) UI.openCreature(o);
      return;
    }
    const p = ecall('production', o.id);
    if (p && p.state === 'ready') ecall('collect', o.id);
    else if (p && p.state === 'idle') openOrders(o);
    else showActionBar(o);
  }
  function tapObject(o) {
    if (o.type === 'enclosure') { hideActionBar(); sfx('click'); UI.openCreature(o); return; }
    const b = bdef(o.buildingId);
    if (b && b.kind === 'special') { hideActionBar(); sfx('click'); openSpecial(o, b); return; }
    if (actionId === o.id) { hideActionBar(); return; }
    sfx('click');
    showActionBar(o);
  }
  function onKeyDown(e) {
    if (e.key !== 'Escape') return;
    const r = roots();
    const top = r.modals.lastElementChild;
    if (top && top._close) { top._close(null); return; }
    if (panel) { closePanel(); return; }
    if (placing) { cancelPlacement(); return; }
    if (actionId != null) hideActionBar();
  }
})(window.PC = window.PC || {});
