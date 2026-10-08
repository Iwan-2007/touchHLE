/* Parc Crétacé — art core: drawing helpers, creature dispatcher, eggs, portraits, NPC busts, icons.
   Owned by the lead. Template files (art_land.js, art_sea.js, art_ice.js) register into PC.ART.templates. */
(function (PC) {
  'use strict';
  const ART = PC.ART = PC.ART || {};
  const templates = ART.templates = ART.templates || {};
  const TAU = Math.PI * 2;

  /**
   * Register a creature template.
   * fn(ctx, sp, o, H): draw in local units (origin = ground point under the body, +x = towards the head, -y = up).
   * meta.bounds = [x0, y0, x1, y1] extents in local units for size 1 (used to fit portraits and hit boxes).
   * meta.shadowW = shadow ellipse width in local units.
   */
  ART.registerTemplate = function (name, fn, meta) {
    templates[name] = { fn, meta: Object.assign({ bounds: [-80, -90, 90, 4], shadowW: 70 }, meta || {}) };
  };

  // ---------- Colour helpers ----------
  function hexToRgb(hex) {
    let h = String(hex).replace('#', '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    const n = parseInt(h.slice(0, 6), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const toHex = (r, g, b) => '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');

  const H = ART.helpers = {
    TAU,
    hexToRgb,
    /** amt in [-1, 1]: negative darkens towards black, positive lightens towards white. */
    shade(hex, amt) {
      const [r, g, b] = hexToRgb(hex);
      if (amt < 0) return toHex(r * (1 + amt), g * (1 + amt), b * (1 + amt));
      return toHex(r + (255 - r) * amt, g + (255 - g) * amt, b + (255 - b) * amt);
    },
    mix(a, b, t) {
      const A = hexToRgb(a), B = hexToRgb(b);
      return toHex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
    },
    rgba(hex, a) { const [r, g, b] = hexToRgb(hex); return `rgba(${r},${g},${b},${a})`; },
    /** Outline colour for a fill. */
    ink(hex) { return H.shade(H.mix(hex, '#2a1a10', 0.35), -0.55); },
    light(hex) { return H.shade(hex, 0.25); },
    dark(hex) { return H.shade(hex, -0.28); },

    linear(ctx, x0, y0, x1, y1, stops) {
      const g = ctx.createLinearGradient(x0, y0, x1, y1);
      for (const [o, c] of stops) g.addColorStop(o, c);
      return g;
    },
    radial(ctx, x, y, r0, r1, stops, fx, fy) {
      const g = ctx.createRadialGradient(fx == null ? x : fx, fy == null ? y : fy, r0, x, y, r1);
      for (const [o, c] of stops) g.addColorStop(o, c);
      return g;
    },
    /** Vertical "volume" gradient: lit top, base colour, shadowed underside. */
    volume(ctx, color, y0, y1) {
      return H.linear(ctx, 0, y0, 0, y1, [[0, H.shade(color, 0.22)], [0.45, color], [1, H.shade(color, -0.3)]]);
    },

    // ---------- Paths ----------
    poly(ctx, pts, closed) {
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      if (closed) ctx.closePath();
    },
    /** Smooth Catmull-Rom curve through points. tension 0..1 (0.5 default). */
    smooth(ctx, pts, closed, tension) {
      const t = tension == null ? 0.5 : tension, n = pts.length;
      if (n < 3) return H.poly(ctx, pts, closed);
      const P = i => closed ? pts[(i + n) % n] : pts[Math.max(0, Math.min(n - 1, i))];
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      const last = closed ? n : n - 1;
      for (let i = 0; i < last; i++) {
        const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
        ctx.bezierCurveTo(
          p1[0] + (p2[0] - p0[0]) * t / 3, p1[1] + (p2[1] - p0[1]) * t / 3,
          p2[0] - (p3[0] - p1[0]) * t / 3, p2[1] - (p3[1] - p1[1]) * t / 3,
          p2[0], p2[1]);
      }
      if (closed) ctx.closePath();
    },
    ellipse(ctx, x, y, rx, ry, rot) {
      ctx.beginPath();
      ctx.ellipse(x, y, Math.max(0.01, rx), Math.max(0.01, ry), rot || 0, 0, TAU);
    },
    /** Fill the current path, then outline it. */
    fillStroke(ctx, fill, stroke, lw) {
      ctx.fillStyle = fill;
      ctx.fill();
      if (stroke) {
        ctx.lineWidth = lw || 2.2;
        ctx.strokeStyle = stroke;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.stroke();
      }
    },
    /**
     * Tapered limb/neck/tail through joints. widths[i] = full width at joint i.
     * Draws a smooth closed outline with rounded ends.
     */
    limb(ctx, joints, widths, fill, stroke, lw) {
      const n = joints.length, left = [], right = [];
      for (let i = 0; i < n; i++) {
        const a = joints[Math.max(0, i - 1)], b = joints[Math.min(n - 1, i + 1)];
        let dx = b[0] - a[0], dy = b[1] - a[1];
        const len = Math.hypot(dx, dy) || 1;
        dx /= len; dy /= len;
        const w = widths[Math.min(i, widths.length - 1)] / 2;
        left.push([joints[i][0] - dy * w, joints[i][1] + dx * w]);
        right.push([joints[i][0] + dy * w, joints[i][1] - dx * w]);
      }
      const e0 = joints[0], e1 = joints[n - 1];
      const d0 = [joints[0][0] - joints[1][0], joints[0][1] - joints[1][1]];
      const d1 = [joints[n - 1][0] - joints[n - 2][0], joints[n - 1][1] - joints[n - 2][1]];
      const l0 = Math.hypot(d0[0], d0[1]) || 1, l1 = Math.hypot(d1[0], d1[1]) || 1;
      const w0 = widths[0] / 2 * 0.7, w1 = widths[Math.min(n - 1, widths.length - 1)] / 2 * 0.7;
      const cap0 = [e0[0] + d0[0] / l0 * w0, e0[1] + d0[1] / l0 * w0];
      const cap1 = [e1[0] + d1[0] / l1 * w1, e1[1] + d1[1] / l1 * w1];
      const pts = [cap0, ...left, cap1, ...right.reverse()];
      H.smooth(ctx, pts, true, 0.45);
      if (fill) H.fillStroke(ctx, fill, stroke, lw);
    },
    /** Run drawFn clipped to the path built by pathFn. */
    withClip(ctx, pathFn, drawFn) {
      ctx.save();
      pathFn();
      ctx.clip();
      drawFn();
      ctx.restore();
    },

    // ---------- Details ----------
    /**
     * Eye. o: { iris, pupil: 'slit'|'round', angry, blink (0..1), mammal (dark round eye) }
     */
    eye(ctx, x, y, r, o) {
      o = o || {};
      ctx.save();
      H.ellipse(ctx, x, y, r * 1.3, r * 1.15);
      ctx.fillStyle = 'rgba(20,12,6,.55)';
      ctx.fill();
      if (o.mammal) {
        H.ellipse(ctx, x, y, r, r);
        ctx.fillStyle = H.radial(ctx, x, y, 0, r, [[0, '#2a1a10'], [1, '#0d0806']]);
        ctx.fill();
      } else {
        H.ellipse(ctx, x, y, r, r);
        ctx.fillStyle = H.radial(ctx, x - r * 0.2, y - r * 0.2, 0, r, [[0, H.shade(o.iris || '#e0a52a', 0.35)], [1, o.iris || '#c9861a']]);
        ctx.fill();
        ctx.fillStyle = '#120a05';
        if (o.pupil === 'round') H.ellipse(ctx, x + r * 0.1, y, r * 0.45, r * 0.45);
        else H.ellipse(ctx, x + r * 0.1, y, r * 0.22, r * 0.85);
        ctx.fill();
      }
      ctx.fillStyle = 'rgba(255,255,255,.9)';
      H.ellipse(ctx, x - r * 0.35, y - r * 0.4, r * 0.28, r * 0.24);
      ctx.fill();
      if (o.blink > 0) {
        ctx.fillStyle = o.lid || '#6b5a48';
        ctx.beginPath();
        ctx.rect(x - r * 1.4, y - r * 1.3, r * 2.8, r * 2.6 * Math.min(1, o.blink));
        ctx.fill();
      }
      if (o.angry) {
        ctx.strokeStyle = o.browColor || 'rgba(30,18,10,.85)';
        ctx.lineWidth = r * 0.55;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x - r * 1.4, y - r * 1.5);
        ctx.lineTo(x + r * 1.3, y - r * 0.9);
        ctx.stroke();
      }
      ctx.restore();
    },
    /** Row of triangular teeth along (x0,y0)→(x1,y1). up=true points them up. */
    teeth(ctx, x0, y0, x1, y1, n, len, up, color) {
      ctx.save();
      ctx.fillStyle = color || '#f3ead2';
      ctx.strokeStyle = 'rgba(60,40,20,.55)';
      ctx.lineWidth = 0.8;
      const dx = (x1 - x0) / n, dy = (y1 - y0) / n, s = up ? -1 : 1;
      for (let i = 0; i < n; i++) {
        const ax = x0 + dx * i, ay = y0 + dy * i, l = len * (0.75 + 0.25 * Math.sin(i * 2.3 + 1));
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(ax + dx * 0.5, ay + dy * 0.5 + l * s);
        ctx.lineTo(ax + dx, ay + dy);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    },
    /** n curved claws starting at (x, y), pointing along angle (radians). */
    claws(ctx, x, y, n, len, angle, color) {
      ctx.save();
      ctx.strokeStyle = color || '#2a2018';
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(1, len * 0.3);
      for (let i = 0; i < n; i++) {
        const a = angle + (i - (n - 1) / 2) * 0.35;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.quadraticCurveTo(x + Math.cos(a) * len * 0.7, y + Math.sin(a) * len * 0.7 - len * 0.2, x + Math.cos(a + 0.5) * len, y + Math.sin(a + 0.5) * len);
        ctx.stroke();
      }
      ctx.restore();
    },
    rng(seed) {
      let s = seed | 0;
      return () => {
        s = (s + 0x6D2B79F5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    },
    /** Random spots inside the box (call inside a clip). */
    spots(ctx, seed, x0, y0, x1, y1, count, rmin, rmax, color) {
      const r = H.rng(seed);
      ctx.save();
      ctx.fillStyle = color;
      for (let i = 0; i < count; i++) {
        const rr = rmin + r() * (rmax - rmin);
        H.ellipse(ctx, x0 + r() * (x1 - x0), y0 + r() * (y1 - y0), rr, rr * (0.7 + r() * 0.4), r() * 3);
        ctx.fill();
      }
      ctx.restore();
    },
    /** Slanted stripes across the box (call inside a clip). */
    stripes(ctx, seed, x0, y0, x1, y1, count, width, color, slant) {
      const r = H.rng(seed);
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineCap = 'round';
      const sl = slant == null ? 0.35 : slant;
      for (let i = 0; i < count; i++) {
        const x = x0 + (i + 0.5) / count * (x1 - x0) + (r() - 0.5) * 6;
        ctx.lineWidth = width * (0.7 + r() * 0.5);
        ctx.beginPath();
        ctx.moveTo(x, y0);
        ctx.quadraticCurveTo(x + (y1 - y0) * sl * 0.5 + (r() - 0.5) * 4, (y0 + y1) / 2, x + (y1 - y0) * sl, y0 + (y1 - y0) * (0.55 + r() * 0.35));
        ctx.stroke();
      }
      ctx.restore();
    },

    // ---------- Animation helpers ----------
    wave(t, speed, amp, phase) { return Math.sin(t * speed + (phase || 0)) * amp; },
    /** Leg cycle -1..1 when walking/swimming, 0 otherwise. */
    walk(o, speed) { return o.pose === 'walk' || o.pose === 'swim' ? Math.sin(o.t * (speed || 8)) : 0; },
    /** Breathing 0..1. */
    breath(o) { return 0.5 + 0.5 * Math.sin(o.t * 2.2); },
    /** Forward lunge for attack pose: wind-up back, strike forward, return. Units ~ -0.3..1. */
    lunge(o) {
      if (o.pose !== 'attack') return 0;
      const k = Math.max(0, Math.min(1, o.k || 0));
      if (k < 0.3) return -0.3 * (k / 0.3);
      if (k < 0.55) return -0.3 + 1.3 * ((k - 0.3) / 0.25);
      return 1 - (k - 0.55) / 0.45;
    },
    /** Mouth opening 0..1 (attack, roar, eat). */
    jaw(o) {
      if (o.pose === 'attack') { const l = H.lunge(o); return Math.max(0, Math.min(1, 0.2 + l)); }
      if (o.pose === 'roar') return 0.9;
      if (o.pose === 'eat') return 0.3 + 0.3 * Math.sin(o.t * 9);
      if (o.pose === 'hurt') return 0.6;
      return 0.04 + 0.04 * Math.sin(o.t * 0.9);
    },
    /** Recoil for hurt pose: 0..1 */
    recoil(o) { return o.pose === 'hurt' ? Math.sin(Math.min(1, o.k || 0) * Math.PI) : 0; },
    /** Head bob/turn used during idle. */
    idleLook(o) { return Math.sin(o.t * 0.7) * 0.5 + Math.sin(o.t * 1.9) * 0.15; },
  };

  // ---------- Creature dispatcher ----------
  let buf = null, bctx = null;
  function getBuf(w, h) {
    if (!buf) { buf = document.createElement('canvas'); bctx = buf.getContext('2d'); }
    if (buf.width < w || buf.height < h) { buf.width = Math.max(buf.width, w); buf.height = Math.max(buf.height, h); }
    return bctx;
  }

  function fallback(ctx, sp, o) {
    const c = sp.colors.body;
    const leg = H.walk(o) * 6;
    ctx.fillStyle = H.dark(c);
    for (const lx of [-30, 25]) { ctx.fillRect(lx - 5 + leg, -28, 10, 28); ctx.fillRect(lx + 5 - leg, -28, 10, 28); }
    H.ellipse(ctx, 0, -40, 45, 22);
    H.fillStroke(ctx, H.volume(ctx, c, -62, -18), H.ink(c), 2.5);
    H.ellipse(ctx, 52, -58, 16, 11);
    H.fillStroke(ctx, c, H.ink(c), 2.5);
    H.eye(ctx, 58, -62, 3.2, {});
  }

  ART.templateMeta = function (speciesId) {
    const sp = PC.SPECIES[speciesId];
    return (templates[sp && sp.art] || { meta: { bounds: [-80, -90, 90, 4], shadowW: 70 } }).meta;
  };

  /**
   * Draw a creature.
   * o: { x, y (screen point of the ground under the body), scale (px per unit), facing (1 right, -1 left),
   *      t (seconds), pose ('idle'|'walk'|'attack'|'hurt'|'eat'|'roar'|'swim'), k (0..1 progress for attack/hurt),
   *      stage (0..3, default 3), alpha, shadow (default true), flash (0..1 white hit flash), silhouette (colour string) }
   */
  ART.drawCreature = function (ctx, speciesId, o) {
    const sp = PC.SPECIES[speciesId];
    if (!sp) return;
    o = Object.assign({ x: 0, y: 0, scale: 1, facing: 1, t: 0, pose: 'idle', k: 0, stage: 3, alpha: 1, shadow: true, flash: 0 }, o);
    if (sp.park === 'sea' && o.pose === 'idle') o.pose = 'swim';
    const tpl = templates[sp.art];
    const meta = tpl ? tpl.meta : { bounds: [-80, -90, 90, 4], shadowW: 70 };
    const s = o.scale * PC.STAGE_GROWTH[o.stage] * sp.size;
    if (o.shadow) {
      ctx.save();
      ctx.globalAlpha *= o.alpha * (sp.park === 'sea' ? 0.45 : 1);
      H.ellipse(ctx, o.x, o.y, meta.shadowW * 0.5 * s, meta.shadowW * 0.12 * s);
      ctx.fillStyle = H.radial(ctx, o.x, o.y, 0, meta.shadowW * 0.5 * s, [[0, 'rgba(0,0,0,.38)'], [1, 'rgba(0,0,0,0)']]);
      ctx.fill();
      ctx.restore();
    }
    const drawIt = (c) => {
      if (tpl) {
        try { tpl.fn(c, sp, o, H); } catch (e) { if (!ART._warned) { ART._warned = true; console.error('template', sp.art, e); } fallback(c, sp, o); }
      } else fallback(c, sp, o);
    };
    if (o.flash > 0 || o.silhouette) {
      // Render to an offscreen buffer so the tint only touches the creature.
      const b = meta.bounds, pad = 30;
      const bw = Math.ceil((b[2] - b[0] + pad * 2) * s), bh = Math.ceil((b[3] - b[1] + pad * 2) * s);
      if (bw <= 0 || bh <= 0 || bw > 4096 || bh > 4096) return;
      const bc = getBuf(bw, bh);
      bc.setTransform(1, 0, 0, 1, 0, 0);
      bc.globalCompositeOperation = 'source-over';
      bc.globalAlpha = 1;
      bc.clearRect(0, 0, bw, bh);
      const ox = o.facing >= 0 ? (-b[0] + pad) * s : (b[2] + pad) * s;
      bc.save();
      bc.translate(ox, (-b[1] + pad) * s);
      bc.scale(o.facing * s, s);
      drawIt(bc);
      bc.restore();
      bc.globalCompositeOperation = 'source-atop';
      bc.fillStyle = o.silhouette || `rgba(255,255,255,${Math.min(1, o.flash) * 0.85})`;
      bc.fillRect(0, 0, bw, bh);
      bc.globalCompositeOperation = 'source-over';
      ctx.save();
      ctx.globalAlpha *= o.alpha;
      ctx.drawImage(buf, 0, 0, bw, bh, o.x - ox, o.y - (-b[1] + pad) * s, bw, bh);
      ctx.restore();
      return;
    }
    const mythic = sp.rarity === 'mythique';
    if (mythic) drawAura(ctx, sp, o, meta, s, false);
    ctx.save();
    ctx.globalAlpha *= o.alpha;
    ctx.translate(o.x, o.y);
    ctx.scale(o.facing * s, s);
    drawIt(ctx);
    ctx.restore();
    if (mythic) drawAura(ctx, sp, o, meta, s, true);
  };

  /** Mythic creatures: pulsing aura behind (front=false) and rising glowing particles in front (front=true). */
  function drawAura(ctx, sp, o, meta, s, front) {
    const b = meta.bounds, f = o.facing || 1;
    const cx = o.x + (b[0] + b[2]) / 2 * s * f, cy = o.y + (b[1] + b[3]) / 2 * s;
    const r = Math.max(b[2] - b[0], b[3] - b[1]) * 0.62 * s;
    const col = sp.colors.accent;
    ctx.save();
    ctx.globalAlpha *= o.alpha;
    if (!front) {
      const pulse = 0.28 + 0.1 * Math.sin(o.t * 3);
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = H.radial(ctx, cx, cy, r * 0.1, r, [[0, H.rgba(col, pulse)], [0.6, H.rgba(col, pulse * 0.35)], [1, H.rgba(col, 0)]]);
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    } else {
      ctx.globalCompositeOperation = 'lighter';
      const feats = sp.features || [];
      const kind = feats.includes('lava') ? 'ember' : feats.includes('frost') ? 'frost' : 'glow';
      for (let i = 0; i < 9; i++) {
        const ph = (o.t * 0.35 + i / 9) % 1;
        const px = cx + Math.sin(i * 2.4 + o.t * 0.8) * r * 0.75;
        const py = cy + r * 0.5 - ph * r * 1.3;
        const a = Math.sin(ph * Math.PI) * 0.9;
        const pr = Math.max(1.2, r * (kind === 'frost' ? 0.035 : 0.028));
        ctx.fillStyle = kind === 'ember' ? `rgba(255,${120 + i * 12},40,${a})` : kind === 'frost' ? `rgba(220,245,255,${a})` : H.rgba(col, a);
        if (kind === 'frost') {
          ctx.save(); ctx.translate(px, py); ctx.rotate(o.t + i);
          ctx.fillRect(-pr, -pr * 0.25, pr * 2, pr * 0.5); ctx.fillRect(-pr * 0.25, -pr, pr * 0.5, pr * 2);
          ctx.restore();
        } else {
          H.ellipse(ctx, px, py, pr, pr);
          ctx.fill();
        }
      }
    }
    ctx.restore();
  }

  /** Screen-space bounding box of a creature drawn with the same o (for hit tests). */
  ART.creatureBox = function (speciesId, o) {
    const sp = PC.SPECIES[speciesId], meta = ART.templateMeta(speciesId), b = meta.bounds;
    const s = (o.scale || 1) * PC.STAGE_GROWTH[o.stage == null ? 3 : o.stage] * sp.size, f = o.facing || 1;
    const xa = o.x + b[0] * s * f, xb = o.x + b[2] * s * f;
    return { x0: Math.min(xa, xb), x1: Math.max(xa, xb), y0: o.y + b[1] * s, y1: o.y + b[3] * s };
  };

  // ---------- Eggs ----------
  const EGG = {
    land: { shell: '#efe3c4', spot: '#8a6a3c', nest: '#b08a4a', nestDark: '#6e5228' },
    sea: { shell: '#cfe6ea', spot: '#3f7f95', nest: '#e2d3a5', nestDark: '#a8946a' },
    ice: { shell: '#eef4f8', spot: '#7fa6c0', nest: '#ffffff', nestDark: '#a9c3d6' },
  };
  /** Egg in a nest. progress 0..1 (cracks appear late), ready = wobbles and glows. */
  ART.drawEgg = function (ctx, x, y, size, park, t, progress, ready) {
    const P = EGG[park] || EGG.land, s = size / 40;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);
    // nest
    H.ellipse(ctx, 0, 0, 30, 9);
    ctx.fillStyle = 'rgba(0,0,0,.25)';
    ctx.fill();
    H.ellipse(ctx, 0, -3, 26, 9);
    H.fillStroke(ctx, H.linear(ctx, 0, -12, 0, 6, [[0, P.nest], [1, P.nestDark]]), H.shade(P.nestDark, -0.3), 1.5);
    if (park === 'land') {
      ctx.strokeStyle = H.shade(P.nest, -0.2);
      ctx.lineWidth = 1.2;
      for (let i = 0; i < 9; i++) {
        const a = i / 9 * TAU;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * 18, -3 + Math.sin(a) * 6);
        ctx.lineTo(Math.cos(a + 0.5) * 27, -3 + Math.sin(a + 0.5) * 9);
        ctx.stroke();
      }
    }
    if (ready) {
      const g = H.radial(ctx, 0, -22, 2, 34, [[0, 'rgba(255,230,140,.55)'], [1, 'rgba(255,230,140,0)']]);
      ctx.fillStyle = g;
      ctx.fillRect(-36, -58, 72, 72);
    }
    const wob = ready ? Math.sin(t * 14) * 0.12 * (Math.sin(t * 2.1) > 0.2 ? 1 : 0) : Math.sin(t * 1.3) * 0.02;
    ctx.translate(0, -6);
    ctx.rotate(wob);
    H.smooth(ctx, [[0, -38], [13, -28], [16, -12], [11, -1], [0, 2], [-11, -1], [-16, -12], [-13, -28]], true, 0.6);
    H.fillStroke(ctx, H.radial(ctx, -5, -24, 2, 30, [[0, '#ffffff'], [0.35, P.shell], [1, H.shade(P.shell, -0.25)]]), H.shade(P.shell, -0.5), 1.6);
    H.withClip(ctx, () => H.smooth(ctx, [[0, -38], [13, -28], [16, -12], [11, -1], [0, 2], [-11, -1], [-16, -12], [-13, -28]], true, 0.6), () => {
      H.spots(ctx, park.length * 7 + 3, -16, -38, 16, 2, 9, 1.2, 3.2, H.rgba(P.spot, 0.55));
    });
    if (progress > 0.6 || ready) {
      ctx.strokeStyle = 'rgba(40,25,10,.8)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(-12, -20); ctx.lineTo(-6, -24); ctx.lineTo(-2, -18); ctx.lineTo(4, -25); ctx.lineTo(8, -19);
      if (progress > 0.85 || ready) { ctx.moveTo(4, -25); ctx.lineTo(6, -31); ctx.moveTo(-6, -24); ctx.lineTo(-9, -30); }
      ctx.stroke();
    }
    ctx.restore();
  };

  // ---------- Portraits ----------
  const portraitCache = new Map();
  const PARK_BG = {
    land: ['#d7c46a', '#5f8a3a', '#2c4a22'],
    sea: ['#7fd0e0', '#2c6f9a', '#12304a'],
    ice: ['#f2f8fb', '#9cc3d8', '#4d7390'],
  };
  /**
   * Card portrait canvas (cached). o: { stage (default 3), silhouette (bool), bg (default true), pose, t }
   */
  ART.portrait = function (speciesId, w, h, o) {
    o = o || {};
    const stage = o.stage == null ? 3 : o.stage;
    const key = [speciesId, w, h, stage, o.silhouette ? 1 : 0, o.bg === false ? 0 : 1].join('|');
    if (portraitCache.has(key)) return portraitCache.get(key);
    const sp = PC.SPECIES[speciesId];
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    if (!sp) return c;
    if (o.bg !== false) {
      const B = PARK_BG[sp.park] || PARK_BG.land;
      ctx.fillStyle = H.radial(ctx, w / 2, h * 0.45, 0, Math.max(w, h) * 0.75, [[0, B[0]], [0.55, B[1]], [1, B[2]]]);
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(0,0,0,.18)';
      H.ellipse(ctx, w / 2, h * 0.88, w * 0.42, h * 0.07);
      ctx.fill();
    }
    const meta = ART.templateMeta(speciesId), b = meta.bounds;
    const g = PC.STAGE_GROWTH[stage];
    const bw = (b[2] - b[0]) * sp.size * g, bh = (b[3] - b[1]) * sp.size * g;
    const fit = Math.min(w * 0.86 / bw, h * 0.8 / bh);
    const x = w / 2 - ((b[0] + b[2]) / 2) * sp.size * g * fit;
    const y = h * 0.88 - b[3] * sp.size * g * fit;
    ART.drawCreature(ctx, speciesId, { x, y, scale: fit, stage, t: o.t || 1.3, pose: o.pose || (sp.park === 'sea' ? 'swim' : 'idle'), shadow: sp.park !== 'sea', silhouette: o.silhouette ? 'rgba(12,16,20,.92)' : null });
    portraitCache.set(key, c);
    return c;
  };
  ART.clearPortraitCache = () => portraitCache.clear();

  // ---------- NPC busts ----------
  /**
   * Draw an NPC bust filling w×h at (x, y). look: { skin, hair, hairStyle: 'short'|'long'|'bun'|'bald'|'curly',
   * shirt, accent, glasses, hat, beard }
   */
  ART.drawNPC = function (ctx, look, x, y, w, h, t) {
    look = Object.assign({ skin: '#e0b48c', hair: '#3a2a1e', hairStyle: 'short', shirt: '#6b7f4a', accent: '#f0a33a' }, look || {});
    t = t || 0;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(w / 100, h / 120);
    ctx.fillStyle = H.linear(ctx, 0, 0, 0, 120, [[0, '#3c4a52'], [1, '#1d252a']]);
    ctx.fillRect(0, 0, 100, 120);
    const bob = Math.sin(t * 1.6) * 0.8;
    // shoulders
    H.smooth(ctx, [[8, 122], [12, 96], [30, 84], [50, 82], [70, 84], [88, 96], [92, 122]], true, 0.5);
    H.fillStroke(ctx, H.volume(ctx, look.shirt, 82, 122), H.ink(look.shirt), 2);
    H.poly(ctx, [[40, 84], [50, 100], [60, 84]], true);
    H.fillStroke(ctx, H.shade(look.shirt, -0.25), null);
    ctx.fillStyle = look.accent;
    ctx.fillRect(64, 96, 12, 8);
    // neck
    ctx.fillStyle = H.shade(look.skin, -0.12);
    ctx.fillRect(43, 66 + bob, 14, 20);
    // long hair behind
    if (look.hairStyle === 'long' || look.hairStyle === 'curly') {
      H.smooth(ctx, [[26, 40 + bob], [24, 70 + bob], [30, 88], [70, 88], [76, 70 + bob], [74, 40 + bob], [50, 18 + bob]], true, 0.5);
      H.fillStroke(ctx, H.shade(look.hair, -0.1), H.ink(look.hair), 1.5);
    }
    // head
    H.ellipse(ctx, 50, 48 + bob, 20, 25);
    H.fillStroke(ctx, H.radial(ctx, 44, 40 + bob, 3, 30, [[0, H.shade(look.skin, 0.15)], [1, H.shade(look.skin, -0.12)]]), H.ink(look.skin), 1.8);
    H.ellipse(ctx, 30, 50 + bob, 4, 6);
    H.fillStroke(ctx, look.skin, H.ink(look.skin), 1.2);
    H.ellipse(ctx, 70, 50 + bob, 4, 6);
    H.fillStroke(ctx, look.skin, H.ink(look.skin), 1.2);
    // eyes
    const blink = (t % 4) > 3.85 ? 0.2 : 1;
    ctx.fillStyle = '#1a120c';
    H.ellipse(ctx, 42, 47 + bob, 2.4, 2.6 * blink); ctx.fill();
    H.ellipse(ctx, 58, 47 + bob, 2.4, 2.6 * blink); ctx.fill();
    ctx.strokeStyle = H.shade(look.hair, -0.1);
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(37, 41 + bob); ctx.lineTo(46, 40 + bob); ctx.moveTo(54, 40 + bob); ctx.lineTo(63, 41 + bob); ctx.stroke();
    // nose & mouth
    ctx.strokeStyle = H.shade(look.skin, -0.35);
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(50, 50 + bob); ctx.lineTo(48, 57 + bob); ctx.lineTo(51, 58 + bob); ctx.stroke();
    ctx.strokeStyle = '#8a3a2a';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(43, 63 + bob); ctx.quadraticCurveTo(50, 67 + bob, 57, 63 + bob); ctx.stroke();
    if (look.beard) {
      H.smooth(ctx, [[31, 52 + bob], [34, 66 + bob], [44, 74 + bob], [56, 74 + bob], [66, 66 + bob], [69, 52 + bob], [62, 62 + bob], [50, 64 + bob], [38, 62 + bob]], true, 0.4);
      H.fillStroke(ctx, look.hair, H.ink(look.hair), 1.2);
      ctx.strokeStyle = '#8a3a2a';
      ctx.beginPath(); ctx.moveTo(44, 64 + bob); ctx.quadraticCurveTo(50, 67 + bob, 56, 64 + bob); ctx.stroke();
    }
    if (look.glasses) {
      ctx.strokeStyle = '#222';
      ctx.lineWidth = 1.6;
      ctx.strokeRect(36, 43 + bob, 11, 8);
      ctx.strokeRect(53, 43 + bob, 11, 8);
      ctx.beginPath(); ctx.moveTo(47, 46 + bob); ctx.lineTo(53, 46 + bob); ctx.stroke();
    }
    // hair on top
    if (look.hairStyle !== 'bald') {
      const top = look.hairStyle === 'curly'
        ? [[28, 46], [27, 30], [36, 20], [50, 17], [64, 20], [73, 30], [72, 46], [66, 34], [50, 30], [34, 34]]
        : [[29, 44], [30, 28], [40, 21], [52, 20], [64, 23], [71, 32], [71, 44], [64, 33], [48, 31], [36, 35]];
      H.smooth(ctx, top.map(p => [p[0], p[1] + bob]), true, 0.5);
      H.fillStroke(ctx, H.volume(ctx, look.hair, 18, 46), H.ink(look.hair), 1.5);
      if (look.hairStyle === 'bun') {
        H.ellipse(ctx, 50, 15 + bob, 9, 7);
        H.fillStroke(ctx, look.hair, H.ink(look.hair), 1.5);
      }
    }
    if (look.hat) {
      H.ellipse(ctx, 50, 27 + bob, 30, 6);
      H.fillStroke(ctx, '#b89a64', '#5a4426', 1.5);
      H.smooth(ctx, [[33, 27 + bob], [35, 12 + bob], [50, 8 + bob], [65, 12 + bob], [67, 27 + bob]], false, 0.5);
      ctx.closePath();
      H.fillStroke(ctx, H.volume(ctx, '#c9a96e', 8, 27), '#5a4426', 1.5);
      ctx.fillStyle = look.accent;
      ctx.fillRect(34, 21 + bob, 32, 4);
    }
    ctx.restore();
  };

  // ---------- Icons ----------
  const ICONS = PC.ICONS = PC.ICONS || {};
  const iconFns = {
    coin(ctx) {
      H.ellipse(ctx, 0, 1.5, 9.5, 9.5); ctx.fillStyle = '#8a5a08'; ctx.fill();
      H.ellipse(ctx, 0, 0, 9.5, 9.5);
      H.fillStroke(ctx, H.radial(ctx, -3, -3, 1, 11, [[0, '#fff2a8'], [0.5, '#f4c430'], [1, '#c98a10']]), '#7a4e06', 1.2);
      H.ellipse(ctx, 0, 0, 6.3, 6.3); ctx.strokeStyle = 'rgba(122,78,6,.7)'; ctx.lineWidth = 1; ctx.stroke();
      // footprint emboss
      ctx.fillStyle = 'rgba(122,78,6,.75)';
      H.ellipse(ctx, 0, 1.6, 2.3, 2.6); ctx.fill();
      for (const a of [-0.9, 0, 0.9]) { H.ellipse(ctx, Math.sin(a) * 3.6, -2.2 - Math.cos(a) * 1.4, 1, 1.9, a); ctx.fill(); }
    },
    dollar(ctx) {
      for (let i = 2; i >= 0; i--) {
        ctx.save(); ctx.translate(i * 1.2, i * 1.6); ctx.rotate(-0.12);
        ctx.beginPath(); ctx.rect(-10, -6, 20, 12);
        H.fillStroke(ctx, H.linear(ctx, 0, -6, 0, 6, [[0, '#9be07a'], [1, '#3f8f2a']]), '#1f4a14', 1);
        ctx.restore();
      }
      ctx.save(); ctx.rotate(-0.12);
      H.ellipse(ctx, 0, 0, 4, 4); ctx.fillStyle = '#d9f5c2'; ctx.fill();
      ctx.fillStyle = '#1f4a14'; ctx.font = 'bold 7px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('$', 0, 0.5);
      ctx.restore();
    },
    food_land(ctx) {
      const leaf = (a, l, c) => {
        ctx.save(); ctx.rotate(a);
        H.smooth(ctx, [[0, 4], [-4, -l * 0.5], [0, -l], [4, -l * 0.5]], true, 0.6);
        H.fillStroke(ctx, H.linear(ctx, -4, 0, 4, 0, [[0, H.shade(c, 0.2)], [1, H.shade(c, -0.2)]]), '#1d4a12', 1);
        ctx.strokeStyle = 'rgba(20,60,10,.6)'; ctx.lineWidth = 0.6; ctx.beginPath(); ctx.moveTo(0, 2); ctx.lineTo(0, -l + 2); ctx.stroke();
        ctx.restore();
      };
      leaf(-0.7, 13, '#5fae3a'); leaf(0.7, 13, '#4c9a2e'); leaf(0, 15, '#76c44a');
      ctx.fillStyle = '#a0662a'; ctx.fillRect(-4, 2, 8, 4); ctx.strokeStyle = '#5a3612'; ctx.lineWidth = 0.8; ctx.strokeRect(-4, 2, 8, 4);
    },
    food_sea(ctx) {
      H.smooth(ctx, [[-10, 0], [-2, -6], [6, -4], [10, 0], [6, 4], [-2, 6]], true, 0.6);
      H.fillStroke(ctx, H.linear(ctx, 0, -6, 0, 6, [[0, '#8fd0f0'], [1, '#2f7aa8']]), '#173a52', 1.1);
      H.poly(ctx, [[-9, 0], [-14, -5], [-13, 5]], true); H.fillStroke(ctx, '#4f9fcf', '#173a52', 1.1);
      H.ellipse(ctx, 5, -1, 1.3, 1.3); ctx.fillStyle = '#0d1a24'; ctx.fill();
    },
    food_ice(ctx) {
      H.smooth(ctx, [[-9, -2], [-4, -8], [5, -7], [10, -1], [6, 7], [-5, 7]], true, 0.6);
      H.fillStroke(ctx, H.radial(ctx, -2, -2, 1, 12, [[0, '#f08a7a'], [1, '#b0382a']]), '#5a140c', 1.1);
      H.ellipse(ctx, -1, -1, 4, 3); ctx.fillStyle = '#f6dcc8'; ctx.fill();
      ctx.strokeStyle = '#f2ead8'; ctx.lineWidth = 3; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(7, 3); ctx.lineTo(12, 8); ctx.stroke();
    },
    xp(ctx) { iconFns.star(ctx, '#7fd0ff', '#1f5a8a'); },
    star(ctx, c1, c2) {
      const pts = [];
      for (let i = 0; i < 10; i++) { const r = i % 2 ? 4.2 : 10, a = -Math.PI / 2 + i * Math.PI / 5; pts.push([Math.cos(a) * r, Math.sin(a) * r]); }
      H.poly(ctx, pts, true);
      H.fillStroke(ctx, H.radial(ctx, -2, -3, 1, 11, [[0, '#fffbe0'], [0.5, c1 || '#ffd23a'], [1, H.shade(c1 || '#ffd23a', -0.3)]]), c2 || '#7a5206', 1.2);
    },
    dna(ctx) {
      ctx.lineWidth = 2.2; ctx.lineCap = 'round';
      for (let i = 0; i < 2; i++) {
        ctx.strokeStyle = i ? '#4fc0e8' : '#e85a8a';
        ctx.beginPath();
        for (let y = -10; y <= 10; y += 1) { const x = Math.sin(y / 3.2 + i * Math.PI) * 5; if (y === -10) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
        ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(230,240,250,.8)'; ctx.lineWidth = 1;
      for (let y = -8; y <= 8; y += 4) { const x = Math.sin(y / 3.2) * 5; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(-x, y); ctx.stroke(); }
    },
    lock(ctx) {
      ctx.strokeStyle = '#9aa3a8'; ctx.lineWidth = 2.6; ctx.beginPath(); ctx.arc(0, -3, 5, Math.PI, 0); ctx.stroke();
      ctx.beginPath(); ctx.rect(-8, -3, 16, 12); H.fillStroke(ctx, H.linear(ctx, 0, -3, 0, 9, [[0, '#f0c040'], [1, '#a87410']]), '#5a3c06', 1.2);
      ctx.fillStyle = '#3a2804'; ctx.fillRect(-1, 1, 2, 4);
    },
    clock(ctx) {
      H.ellipse(ctx, 0, 0, 9.5, 9.5); H.fillStroke(ctx, '#f4f0e6', '#3a3a3a', 1.6);
      ctx.strokeStyle = '#2a2a2a'; ctx.lineWidth = 1.6; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -6); ctx.moveTo(0, 0); ctx.lineTo(4, 2); ctx.stroke();
    },
    hp(ctx) {
      ctx.beginPath(); ctx.moveTo(0, 9); ctx.bezierCurveTo(-14, -1, -6, -12, 0, -4); ctx.bezierCurveTo(6, -12, 14, -1, 0, 9);
      H.fillStroke(ctx, H.radial(ctx, -3, -4, 1, 12, [[0, '#ff9a8a'], [1, '#c8282a']]), '#5a0c0c', 1.2);
    },
    atk(ctx) {
      ctx.lineCap = 'round';
      for (let i = 0; i < 3; i++) {
        ctx.strokeStyle = '#3a2a1a'; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(-6 + i * 5, -9); ctx.quadraticCurveTo(-2 + i * 5, 0, -8 + i * 5, 9); ctx.stroke();
        ctx.strokeStyle = '#f2ead8'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(-6 + i * 5, -9); ctx.quadraticCurveTo(-2 + i * 5, 0, -8 + i * 5, 9); ctx.stroke();
      }
    },
    chasseur(ctx) { iconFns._badge(ctx, PC.CLASSES.chasseur.color, () => iconFns.atk(ctx)); },
    colosse(ctx) {
      iconFns._badge(ctx, PC.CLASSES.colosse.color, () => {
        ctx.fillStyle = '#f2ead8';
        H.ellipse(ctx, 0, 2.5, 4, 4.5); ctx.fill();
        for (const a of [-0.8, 0, 0.8]) { H.ellipse(ctx, Math.sin(a) * 6, -3.5 - Math.cos(a) * 2, 1.6, 3, a); ctx.fill(); }
      });
    },
    blinde(ctx) {
      iconFns._badge(ctx, PC.CLASSES.blinde.color, () => {
        H.poly(ctx, [[0, -8], [7, -5], [6, 3], [0, 8], [-6, 3], [-7, -5]], true);
        H.fillStroke(ctx, '#f2ead8', '#2a2a2a', 1);
      });
    },
    _badge(ctx, color, inner) {
      H.ellipse(ctx, 0, 0, 10.5, 10.5);
      H.fillStroke(ctx, H.radial(ctx, -3, -3, 1, 12, [[0, H.shade(color, 0.3)], [1, H.shade(color, -0.25)]]), '#1a1a1a', 1.2);
      ctx.save(); ctx.scale(0.75, 0.75); inner(); ctx.restore();
    },
    egg(ctx) {
      H.smooth(ctx, [[0, -10], [6, -5], [7, 3], [0, 9], [-7, 3], [-6, -5]], true, 0.6);
      H.fillStroke(ctx, H.radial(ctx, -2, -3, 1, 11, [[0, '#ffffff'], [1, '#d8c8a0']]), '#5a4a2a', 1.2);
      ctx.fillStyle = 'rgba(138,106,60,.6)';
      H.ellipse(ctx, 2, -2, 1.5, 1.2); ctx.fill(); H.ellipse(ctx, -3, 3, 1.2, 1); ctx.fill();
    },
    check(ctx) {
      H.ellipse(ctx, 0, 0, 10, 10); H.fillStroke(ctx, '#4caf50', '#1d4a1f', 1.2);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.6; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(-5, 0); ctx.lineTo(-1, 4); ctx.lineTo(5, -4); ctx.stroke();
    },
    trophy(ctx) {
      ctx.beginPath(); ctx.moveTo(-7, -9); ctx.lineTo(7, -9); ctx.lineTo(6, -1); ctx.quadraticCurveTo(0, 5, -6, -1); ctx.closePath();
      H.fillStroke(ctx, H.linear(ctx, -7, 0, 7, 0, [[0, '#ffe680'], [1, '#c9900f']]), '#6a4806', 1.2);
      ctx.strokeStyle = '#c9900f'; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(-8, -5, 3, Math.PI * 0.5, Math.PI * 1.5); ctx.stroke();
      ctx.beginPath(); ctx.arc(8, -5, 3, -Math.PI * 0.5, Math.PI * 0.5); ctx.stroke();
      ctx.fillStyle = '#c9900f'; ctx.fillRect(-1.5, 3, 3, 4); ctx.fillRect(-5, 7, 10, 3);
    },
  };
  ICONS.names = Object.keys(iconFns).filter(n => n[0] !== '_');
  /** Draw icon `name` centred at (x, y), `size` px tall. */
  ICONS.draw = function (ctx, name, x, y, size) {
    const fn = iconFns[name];
    if (!fn) return;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(size / 22, size / 22);
    fn(ctx);
    ctx.restore();
  };
  const urlCache = new Map();
  /** data: URL of an icon for DOM use (cached). */
  ICONS.url = function (name, size) {
    size = size || 32;
    const key = name + '|' + size;
    if (urlCache.has(key)) return urlCache.get(key);
    const c = document.createElement('canvas');
    c.width = c.height = size * 2;
    ICONS.draw(c.getContext('2d'), name, size, size, size * 2);
    const u = c.toDataURL();
    urlCache.set(key, u);
    return u;
  };
})(window.PC = window.PC || {});
