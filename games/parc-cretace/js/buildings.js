/* Crétacé Park — building & scenery art → PC.BUILD_ART.
   Every building is drawn procedurally in a canonical isometric frame: 1 unit = 1 px at zoom 1,
   tile = 96×48, origin = top corner of the footprint, u = gx axis (towards the right corner),
   v = gy axis (towards the left corner), z = height in px. Static parts are cached into sprites
   (per zoom bucket); animated details (flames, smoke, flags, water, lights…) are drawn live on top. */
(function (PC) {
  'use strict';
  const BA = PC.BUILD_ART = PC.BUILD_ART || {};
  const H = PC.ART.helpers;
  const TAU = Math.PI * 2, PI = Math.PI;
  const HX = 48, HY = 24;                       // half tile (canonical px)
  const FONT = '"Russo One", "Arial Black", Impact, sans-serif';
  const shade = H.shade, mix = H.mix, rgba = H.rgba;
  const ink = c => shade(mix(c, '#20140c', 0.35), -0.52);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const fract = v => v - Math.floor(v);
  const hash = (a, b) => fract(Math.sin(a * 127.1 + (b || 0) * 311.7 + 0.5) * 43758.5453);
  const lerp = (a, b, k) => a + (b - a) * k;

  let X = null;                                 // current 2D context (draw or sprite rendering)
  function withCtx(ctx, fn) { const prev = X; X = ctx; try { return fn(); } finally { X = prev; } }

  // ---------------------------------------------------------------- projection & paths
  /** Canonical screen point of iso coords (u, v in tiles, z in px up). */
  const P = (u, v, z) => [(u - v) * HX, (u + v) * HY - (z || 0)];
  function ipath(pts, open) {
    X.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const q = P(pts[i][0], pts[i][1], pts[i][2]);
      if (i) X.lineTo(q[0], q[1]); else X.moveTo(q[0], q[1]);
    }
    if (!open) X.closePath();
  }
  function spath(pts, open) {
    X.beginPath();
    for (let i = 0; i < pts.length; i++) { if (i) X.lineTo(pts[i][0], pts[i][1]); else X.moveTo(pts[i][0], pts[i][1]); }
    if (!open) X.closePath();
  }
  /** Fill then stroke the current path. */
  function fs(fill, stroke, lw) {
    if (fill) { X.fillStyle = fill; X.fill(); }
    if (stroke) { X.lineWidth = lw || 1.3; X.strokeStyle = stroke; X.lineJoin = 'round'; X.lineCap = 'round'; X.stroke(); }
  }
  const lin = (x0, y0, x1, y1, stops) => H.linear(X, x0, y0, x1, y1, stops);
  const rad = (x, y, r0, r1, stops, fx, fy) => H.radial(X, x, y, r0, r1, stops, fx, fy);
  function ell(x, y, rx, ry, rot) { X.beginPath(); X.ellipse(x, y, Math.max(0.01, rx), Math.max(0.01, ry), rot || 0, 0, TAU); }
  function line(x0, y0, x1, y1, col, lw) { X.beginPath(); X.moveTo(x0, y0); X.lineTo(x1, y1); X.strokeStyle = col; X.lineWidth = lw || 1; X.lineCap = 'round'; X.stroke(); }
  function rrect(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    X.beginPath();
    X.moveTo(x + r, y); X.lineTo(x + w - r, y); X.quadraticCurveTo(x + w, y, x + w, y + r);
    X.lineTo(x + w, y + h - r); X.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    X.lineTo(x + r, y + h); X.quadraticCurveTo(x, y + h, x, y + h - r);
    X.lineTo(x, y + r); X.quadraticCurveTo(x, y, x + r, y);
    X.closePath();
  }

  // ---------------------------------------------------------------- planes
  /** Draw in the plane of a LEFT-facing wall (v = V): local x = px along +u from u = ua, local y = −z. */
  function onL(V, ua, fn) { const o = P(ua, V, 0); X.save(); X.transform(1, 0.5, 0, 1, o[0], o[1]); fn(); X.restore(); }
  /** Draw in the plane of a RIGHT-facing wall (u = U): local x = px from v = vb towards smaller v, local y = −z. */
  function onR(U, vb, fn) { const o = P(U, vb, 0); X.save(); X.transform(1, -0.5, 0, 1, o[0], o[1]); fn(); X.restore(); }
  /** Draw on a horizontal plane at height z, local coords in tiles (u, v). */
  function onTop(z, fn) { X.save(); X.transform(HX, HY, -HX, HY, 0, -(z || 0)); fn(); X.restore(); }
  /** Thickness trick: draw `shape(col, k)` repeatedly from plane v = V0 to V1 (k 0..1), last one on top. */
  function extrudeL(V0, V1, ua, steps, shape) {
    for (let i = 0; i <= steps; i++) { const k = i / steps; onL(lerp(V0, V1, k), ua, () => shape(k)); }
  }
  function extrudeR(U0, U1, vb, steps, shape) {
    for (let i = 0; i <= steps; i++) { const k = i / steps; onR(lerp(U0, U1, k), vb, () => shape(k)); }
  }

  // ---------------------------------------------------------------- boxes
  function faceGrad(col, y0, y1) { return lin(0, y0, 0, y1, [[0, shade(col, 0.07)], [1, shade(col, -0.13)]]); }
  function faceRun(pts, fill, tex, st, lw) {
    ipath(pts);
    fs(fill);
    if (tex) { X.save(); X.clip(); tex(); X.restore(); ipath(pts); }
    if (st) fs(null, st, lw);
  }
  /**
   * Iso box u0..u1 × v0..v1 × z0..z1. c = base colour (right face) or {top, left, right}.
   * o: { stroke (false = none), lw, top: false, tex: fn(len, z0, z1, faceColour, side) drawn in wall space,
   *      texTop: fn() in top-plane tile space, hi: false (no edge highlight) }
   */
  function box(u0, v0, u1, v1, z0, z1, c, o) {
    o = o || {};
    const base = typeof c === 'string' ? c : (c.right || c.top);
    const cR = (typeof c === 'object' && c.right) || base;
    const cL = (typeof c === 'object' && c.left) || shade(base, -0.24);
    const cT = (typeof c === 'object' && c.top) || shade(base, 0.18);
    const st = o.stroke === false ? null : (o.stroke || ink(base)), lw = o.lw || 1.2;
    const tex = o.tex;
    faceRun([[u0, v1, z0], [u1, v1, z0], [u1, v1, z1], [u0, v1, z1]], faceGrad(cL, P(u0, v1, z1)[1], P(u1, v1, z0)[1]),
      tex && (() => onL(v1, u0, () => tex((u1 - u0) * HX, z0, z1, cL, 'L'))), st, lw);
    faceRun([[u1, v1, z0], [u1, v0, z0], [u1, v0, z1], [u1, v1, z1]], faceGrad(cR, P(u1, v0, z1)[1], P(u1, v1, z0)[1]),
      tex && (() => onR(u1, v1, () => tex((v1 - v0) * HX, z0, z1, cR, 'R'))), st, lw);
    if (o.top !== false) {
      faceRun([[u0, v0, z1], [u1, v0, z1], [u1, v1, z1], [u0, v1, z1]], cT,
        o.texTop && (() => onTop(z1, () => o.texTop(cT))), st, lw);
    }
    if (o.hi !== false) {
      ipath([[u0, v1, z1], [u1, v1, z1], [u1, v0, z1]], true);
      fs(null, 'rgba(255,255,255,.28)', 1);
    }
  }
  /** Simple flat slab (ground pads, platforms). */
  function slab(u0, v0, u1, v1, z0, z1, col, texTop, st) {
    box(u0, v0, u1, v1, z0, z1, col, { texTop, stroke: st });
  }

  // ---------------------------------------------------------------- wall textures (wall space)
  const TX = {
    planks(ph, seed) {
      return (len, z0, z1, col) => {
        X.lineWidth = 0.8;
        X.strokeStyle = rgba(ink(col), 0.45);
        let row = 0;
        for (let z = z0 + ph; z < z1 - 0.5; z += ph, row++) line(0, -z, len, -z, rgba(ink(col), 0.45), 0.8);
        row = 0;
        for (let z = z0; z < z1; z += ph, row++) {
          const off = hash(row, seed || 1) * 30;
          for (let x = off; x < len; x += 34) line(x, -z, x, -Math.min(z1, z + ph), rgba(ink(col), 0.35), 0.7);
          X.fillStyle = 'rgba(255,255,255,.07)';
          X.fillRect(0, -Math.min(z1, z + ph), len, 1.4);
        }
      };
    },
    vplanks(pw) {
      return (len, z0, z1, col) => {
        for (let x = pw, i = 0; x < len; x += pw, i++) line(x, -z0, x, -z1, rgba(ink(col), 0.4), 0.8);
        for (let x = 0, i = 0; x < len; x += pw, i++) { X.fillStyle = i % 2 ? 'rgba(0,0,0,.05)' : 'rgba(255,255,255,.05)'; X.fillRect(x, -z1, pw, z1 - z0); }
      };
    },
    stones(sz, seed) {
      return (len, z0, z1, col) => {
        X.fillStyle = shade(col, -0.32);
        X.fillRect(0, -z1, len, z1 - z0);
        let row = 0;
        for (let z = z0; z < z1; z += sz, row++) {
          let x = -hash(row, seed || 3) * sz;
          let i = 0;
          while (x < len) {
            const w = sz * (0.9 + hash(row * 13 + i, seed || 3) * 1.1);
            const hh = Math.min(sz, z1 - z);
            const c2 = shade(col, (hash(i, row + (seed || 3)) - 0.5) * 0.2);
            rrect(x + 0.8, -z - hh + 0.8, w - 1.6, hh - 1.6, 2.5);
            X.fillStyle = lin(0, -z - hh, 0, -z, [[0, shade(c2, 0.14)], [1, shade(c2, -0.08)]]);
            X.fill();
            x += w; i++;
          }
        }
      };
    },
    bricks(bh, col2) {
      return (len, z0, z1, col) => {
        let row = 0;
        X.strokeStyle = rgba(col2 || shade(col, -0.35), 0.7);
        X.lineWidth = 0.8;
        for (let z = z0; z < z1; z += bh, row++) {
          line(0, -z, len, -z, X.strokeStyle, 0.8);
          for (let x = (row % 2) * bh; x < len; x += bh * 2) line(x, -z, x, -Math.min(z1, z + bh), X.strokeStyle, 0.8);
        }
      };
    },
    logs(d) {
      return (len, z0, z1, col) => {
        for (let z = z0; z < z1; z += d) {
          const y0 = -Math.min(z1, z + d), y1 = -z;
          X.fillStyle = lin(0, y0, 0, y1, [[0, shade(col, 0.22)], [0.45, col], [1, shade(col, -0.35)]]);
          X.fillRect(0, y0, len, y1 - y0);
          line(0, y1, len, y1, rgba(ink(col), 0.6), 1);
          for (let x = 8 + hash(z) * 20; x < len; x += 26) line(x, y0 + d * 0.4, x + 6, y0 + d * 0.4, rgba(ink(col), 0.3), 0.7);
        }
      };
    },
    corr(step, dark) {
      return (len, z0, z1, col) => {
        for (let x = 0, i = 0; x < len; x += step, i++) {
          X.fillStyle = i % 2 ? rgba(dark || '#000000', 0.12) : 'rgba(255,255,255,.1)';
          X.fillRect(x, -z1, step, z1 - z0);
        }
      };
    },
    panels(pw, ph) {
      return (len, z0, z1, col) => {
        for (let x = pw; x < len; x += pw) line(x, -z0, x, -z1, rgba(ink(col), 0.35), 0.8);
        if (ph) for (let z = z0 + ph; z < z1; z += ph) line(0, -z, len, -z, rgba(ink(col), 0.3), 0.8);
        for (let x = 0; x < len; x += pw) { X.fillStyle = 'rgba(255,255,255,.08)'; X.fillRect(x + 1, -z1, 2, z1 - z0); }
      };
    },
    ice(sz, seed) {
      return (len, z0, z1, col) => {
        let row = 0;
        for (let z = z0; z < z1; z += sz, row++) {
          const hh = Math.min(sz, z1 - z);
          let x = row % 2 ? -sz * 0.6 : 0, i = 0;
          while (x < len) {
            const w = sz * (1.3 + hash(i + row * 7, seed || 5) * 0.6);
            X.fillStyle = lin(x, -z - hh, x + w, -z, [[0, 'rgba(255,255,255,.35)'], [0.5, 'rgba(255,255,255,.05)'], [1, 'rgba(40,110,160,.18)']]);
            X.fillRect(x + 1, -z - hh + 1, w - 2, hh - 2);
            X.strokeStyle = 'rgba(255,255,255,.55)'; X.lineWidth = 0.8;
            X.strokeRect(x + 0.5, -z - hh + 0.5, w - 1, hh - 1);
            x += w; i++;
          }
        }
      };
    },
    tiles(sz) { // bathroom-style square tiles
      return (len, z0, z1, col) => {
        for (let x = sz; x < len; x += sz) line(x, -z0, x, -z1, rgba(shade(col, -0.3), 0.45), 0.6);
        for (let z = z0 + sz; z < z1; z += sz) line(0, -z, len, -z, rgba(shade(col, -0.3), 0.45), 0.6);
      };
    },
  };
  /** Combine several wall textures. */
  const both = (...fns) => (...a) => fns.forEach(f => f && f(...a));

  // ---------------------------------------------------------------- top textures (tile space)
  const TT = {
    paving(n, col) {
      return () => {
        X.lineWidth = 0.025;
        X.strokeStyle = rgba(shade(col || '#b9ab8e', -0.35), 0.5);
        X.beginPath();
        for (let i = -6; i <= 6; i++) { X.moveTo(i / n, -6); X.lineTo(i / n, 6); X.moveTo(-6, i / n); X.lineTo(6, i / n); }
        X.stroke();
      };
    },
    deck(n, col) {
      return () => {
        X.lineWidth = 0.02;
        X.strokeStyle = rgba(ink(col || '#a0683a'), 0.5);
        X.beginPath();
        for (let i = -12; i <= 12; i++) { X.moveTo(i / n, -6); X.lineTo(i / n, 6); }
        X.stroke();
      };
    },
  };

  // ---------------------------------------------------------------- roofs
  /** Shaded slope quad with optional texture. e0,e1 = eave (screen), r1,r0 = ridge (screen). */
  function slope(e0, e1, r1, r0, col, type, st) {
    // eave thickness
    spath([e0, e1, [e1[0], e1[1] + 3], [e0[0], e0[1] + 3]]);
    fs(shade(col, -0.45));
    spath([e0, e1, r1, r0]);
    const my = (r0[1] + r1[1]) / 2, ey = (e0[1] + e1[1]) / 2;
    fs(lin(0, my, 0, ey, [[0, shade(col, 0.12)], [1, shade(col, -0.1)]]));
    if (type) {
      X.save(); X.clip();
      const n = type === 'thatch' ? 9 : type === 'metal' ? 0 : 6;
      const dark = rgba(ink(col), type === 'thatch' ? 0.35 : 0.4);
      for (let i = 1; i < n; i++) {
        const k = i / n;
        const a = [lerp(e0[0], r0[0], k), lerp(e0[1], r0[1], k)], b = [lerp(e1[0], r1[0], k), lerp(e1[1], r1[1], k)];
        line(a[0], a[1], b[0], b[1], dark, type === 'thatch' ? 1.2 : 1);
        if (type === 'tiles') {
          const segs = Math.max(3, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 8));
          const k2 = (i - 1) / n;
          for (let j = 0; j <= segs; j++) {
            const f = (j + (i % 2) * 0.5) / segs;
            if (f > 1) continue;
            const p = [lerp(a[0], b[0], f), lerp(a[1], b[1], f)];
            const q = [lerp(lerp(e0[0], r0[0], k2), lerp(e1[0], r1[0], k2), f), lerp(lerp(e0[1], r0[1], k2), lerp(e1[1], r1[1], k2), f)];
            line(p[0], p[1], q[0], q[1], rgba(ink(col), 0.25), 0.8);
          }
        }
      }
      if (type === 'thatch') {
        for (let j = 0; j < 40; j++) {
          const f = hash(j, 2), k = hash(j, 9);
          const a = [lerp(lerp(e0[0], e1[0], f), lerp(r0[0], r1[0], f), k), lerp(lerp(e0[1], e1[1], f), lerp(r0[1], r1[1], f), k)];
          const dx = (lerp(e0[0], e1[0], f) - lerp(r0[0], r1[0], f)) * 0.08, dy = (lerp(e0[1], e1[1], f) - lerp(r0[1], r1[1], f)) * 0.08;
          line(a[0], a[1], a[0] + dx, a[1] + dy, rgba(shade(col, 0.35), 0.6), 0.9);
        }
      }
      if (type === 'metal') {
        const segs = Math.max(4, Math.round(Math.hypot(e1[0] - e0[0], e1[1] - e0[1]) / 7));
        for (let j = 1; j < segs; j++) {
          const f = j / segs;
          line(lerp(e0[0], e1[0], f), lerp(e0[1], e1[1], f), lerp(r0[0], r1[0], f), lerp(r0[1], r1[1], f), j % 2 ? 'rgba(255,255,255,.18)' : rgba(ink(col), 0.3), 1);
        }
      }
      X.restore();
    }
    spath([e0, e1, r1, r0]);
    fs(null, st || ink(col), 1.2);
  }
  /** Snow blanket over a slope with a soft drooping lip at the eave. */
  function snowSlope(e0, e1, r1, r0, seed) {
    const n = 7, pts = [r0, r1];
    for (let i = 0; i <= n; i++) {
      const f = 1 - i / n;
      const d = 2 + 3.5 * hash(i, seed || 7) + (i % 2 ? 1.5 : 0);
      pts.push([lerp(e0[0], e1[0], f), lerp(e0[1], e1[1], f) + d]);
    }
    X.beginPath();
    X.moveTo(pts[0][0], pts[0][1]);
    X.lineTo(pts[1][0], pts[1][1]);
    for (let i = 2; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      X.quadraticCurveTo(a[0], a[1] + 2, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + 1);
    }
    X.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
    X.closePath();
    const my = (r0[1] + r1[1]) / 2, ey = (e0[1] + e1[1]) / 2;
    fs(lin(0, my, 0, ey + 6, [[0, '#ffffff'], [1, '#d6e6f2']]), '#9db7cc', 1.1);
  }
  /**
   * Gable roof. axis 'u' = ridge along u (front slope faces +v / left), 'v' = ridge along v (front slope faces +u / right).
   * o: { ov (overhang tiles), gable (wall colour for the end triangle), type ('tiles'|'thatch'|'metal'|'shingle'), snow, gableTex(fn) }
   */
  function gable(axis, u0, v0, u1, v1, zb, zr, col, o) {
    o = o || {};
    const ov = o.ov == null ? 0.1 : o.ov, type = o.type || 'tiles';
    const gcol = o.gable || '#e8d8b0';
    if (axis === 'u') {
      const vm = (v0 + v1) / 2;
      const A = (u, v, z) => P(u, v, z);
      // back slope
      slope(A(u0 - ov, v0 - ov, zb), A(u1 + ov, v0 - ov, zb), A(u1 + ov, vm, zr), A(u0 - ov, vm, zr), shade(col, -0.2), type);
      if (o.snow) snowSlope(A(u0 - ov, v0 - ov, zb), A(u1 + ov, v0 - ov, zb), A(u1 + ov, vm, zr), A(u0 - ov, vm, zr), 3);
      // gable end at u1
      ipath([[u1, v0, zb], [u1, v1, zb], [u1, vm, zr]]);
      fs(faceGrad(gcol, P(u1, vm, zr)[1], P(u1, v1, zb)[1]), ink(gcol), 1.2);
      if (o.gableTex) { X.save(); ipath([[u1, v0, zb], [u1, v1, zb], [u1, vm, zr]]); X.clip(); o.gableTex(); X.restore(); }
      // verge board (gable edge)
      ipath([[u1 + ov, v0 - ov, zb], [u1 + ov, vm, zr], [u1 + ov, v1 + ov, zb]], true);
      fs(null, shade(col, -0.4), 3.2);
      // front slope
      slope(A(u0 - ov, v1 + ov, zb), A(u1 + ov, v1 + ov, zb), A(u1 + ov, vm, zr), A(u0 - ov, vm, zr), col, type);
      if (o.snow) snowSlope(A(u0 - ov, v1 + ov, zb), A(u1 + ov, v1 + ov, zb), A(u1 + ov, vm, zr), A(u0 - ov, vm, zr), 5);
      ipath([[u0 - ov, vm, zr], [u1 + ov, vm, zr]], true);
      fs(null, o.snow ? '#ffffff' : shade(col, -0.35), o.snow ? 3 : 2.4);
    } else {
      const um = (u0 + u1) / 2;
      const A = (u, v, z) => P(u, v, z);
      slope(A(u0 - ov, v0 - ov, zb), A(u0 - ov, v1 + ov, zb), A(um, v1 + ov, zr), A(um, v0 - ov, zr), shade(col, -0.2), type);
      if (o.snow) snowSlope(A(u0 - ov, v0 - ov, zb), A(u0 - ov, v1 + ov, zb), A(um, v1 + ov, zr), A(um, v0 - ov, zr), 4);
      ipath([[u0, v1, zb], [u1, v1, zb], [um, v1, zr]]);
      fs(faceGrad(shade(gcol, -0.15), P(um, v1, zr)[1], P(u1, v1, zb)[1]), ink(gcol), 1.2);
      if (o.gableTex) { X.save(); ipath([[u0, v1, zb], [u1, v1, zb], [um, v1, zr]]); X.clip(); o.gableTex(); X.restore(); }
      ipath([[u0 - ov, v1 + ov, zb], [um, v1 + ov, zr], [u1 + ov, v1 + ov, zb]], true);
      fs(null, shade(col, -0.4), 3.2);
      slope(A(u1 + ov, v1 + ov, zb), A(u1 + ov, v0 - ov, zb), A(um, v0 - ov, zr), A(um, v1 + ov, zr), shade(col, 0.12), type);
      if (o.snow) snowSlope(A(u1 + ov, v1 + ov, zb), A(u1 + ov, v0 - ov, zb), A(um, v0 - ov, zr), A(um, v1 + ov, zr), 6);
      ipath([[um, v0 - ov, zr], [um, v1 + ov, zr]], true);
      fs(null, o.snow ? '#ffffff' : shade(col, -0.35), o.snow ? 3 : 2.4);
    }
  }
  /** Hip / pyramid roof over u0..u1 × v0..v1. */
  function hip(u0, v0, u1, v1, zb, zr, col, o) {
    o = o || {};
    const ov = o.ov == null ? 0.1 : o.ov, type = o.type || 'tiles';
    u0 -= ov; v0 -= ov; u1 += ov; v1 += ov;
    const w = u1 - u0, d = v1 - v0;
    let ra, rb; // ridge end points (u, v)
    if (w >= d) { const i = d / 2; ra = [u0 + i, (v0 + v1) / 2]; rb = [u1 - i, (v0 + v1) / 2]; }
    else { const i = w / 2; ra = [(u0 + u1) / 2, v0 + i]; rb = [(u0 + u1) / 2, v1 - i]; }
    const R = (p) => P(p[0], p[1], zr), E = (u, v) => P(u, v, zb);
    // back faces first
    slope(E(u1, v0), E(u0, v0), R(ra), R(w >= d ? rb : ra), shade(col, -0.25), null);
    slope(E(u0, v0), E(u0, v1), R(w >= d ? ra : rb), R(ra), shade(col, -0.2), null);
    // right (+u) and left (+v) faces
    slope(E(u1, v1), E(u1, v0), R(w >= d ? rb : ra), R(rb), shade(col, 0.12), type);
    slope(E(u0, v1), E(u1, v1), R(rb), R(w >= d ? ra : rb), col, type);
    if (o.snow) {
      snowSlope(E(u1, v1), E(u1, v0), R(w >= d ? rb : ra), R(rb), 8);
      snowSlope(E(u0, v1), E(u1, v1), R(rb), R(w >= d ? ra : rb), 9);
    }
    // hip lines
    spath([E(u1, v1), R(rb)], true); fs(null, o.snow ? '#ffffff' : shade(col, -0.35), 2);
    if (w !== d) { spath([R(ra), R(rb)], true); fs(null, o.snow ? '#ffffff' : shade(col, -0.35), 2); }
  }
  /** Flat roof with parapet. */
  function flatRoof(u0, v0, u1, v1, z, col, o) {
    o = o || {};
    const p = o.parapet == null ? 5 : o.parapet, i = o.inset == null ? 0.07 : o.inset;
    box(u0, v0, u1, v1, z, z + p, col, { top: true, texTop: o.texTop });
    if (p > 0) {
      ipath([[u0 + i, v0 + i, z + p], [u1 - i, v0 + i, z + p], [u1 - i, v1 - i, z + p], [u0 + i, v1 - i, z + p]]);
      fs(o.inner || shade(col, -0.3));
      // inner walls (back sides) lighter strips
      ipath([[u0 + i, v0 + i, z + p], [u1 - i, v0 + i, z + p], [u1 - i, v0 + i, z + 1], [u0 + i, v0 + i, z + 1]]);
      fs(shade(col, -0.08));
      ipath([[u0 + i, v0 + i, z + p], [u0 + i, v1 - i, z + p], [u0 + i, v1 - i, z + 1], [u0 + i, v0 + i, z + 1]]);
      fs(shade(col, -0.18));
    }
  }
  /** Snow layer on a flat top (u0..u1 × v0..v1 at height z) with drooping front edges. */
  function snowTop(u0, v0, u1, v1, z, th, seed) {
    th = th || 4;
    const e = 0.04;
    const a = P(u0 - e, v0 - e, z), b = P(u1 + e, v0 - e, z), c = P(u1 + e, v1 + e, z), d = P(u0 - e, v1 + e, z);
    X.beginPath();
    X.moveTo(a[0], a[1] - th * 0.6);
    X.lineTo(b[0], b[1] - th * 0.6);
    const edge = (p, q, n, sd) => {
      for (let i = 1; i <= n; i++) {
        const f = i / n, m = (i - 0.5) / n;
        const dd = th * (0.6 + 0.9 * hash(i, sd));
        X.quadraticCurveTo(lerp(p[0], q[0], m), lerp(p[1], q[1], m) + dd, lerp(p[0], q[0], f), lerp(p[1], q[1], f) + th * 0.3);
      }
    };
    X.lineTo(b[0], b[1] + th * 0.3);
    edge(b, c, Math.max(2, Math.round((v1 - v0) * 3)), seed || 1);
    edge(c, d, Math.max(2, Math.round((u1 - u0) * 3)), (seed || 1) + 5);
    X.lineTo(d[0], d[1] - th * 0.6);
    X.closePath();
    fs(lin(0, a[1] - th, 0, c[1] + th, [[0, '#ffffff'], [1, '#d3e4f1']]), '#9cb6ca', 1);
  }
  /** Row of icicles hanging from the screen segment a→b. */
  function icicles(a, b, n, len, seed) {
    for (let i = 0; i < n; i++) {
      const f = (i + 0.5) / n, x = lerp(a[0], b[0], f), y = lerp(a[1], b[1], f);
      const l = len * (0.45 + hash(i, seed || 2) * 0.8), w = 1.6 + hash(i, (seed || 2) + 4) * 1.4;
      spath([[x - w, y], [x + w, y], [x + 0.3, y + l]]);
      fs(lin(x, y, x, y + l, [[0, '#ffffff'], [1, 'rgba(160,220,250,.85)']]), 'rgba(110,170,210,.8)', 0.6);
    }
  }

  // ---------------------------------------------------------------- round solids
  /** Vertical cylinder: base centre (x, y) screen, radius R (horizontal px), height h. o: {top, stroke, tex(x,y,R,h), k} */
  function cyl(x, y, R, h, col, o) {
    o = o || {};
    const k = o.k || 0.5, st = o.stroke === false ? null : (o.stroke || ink(col));
    X.beginPath();
    X.moveTo(x - R, y - h);
    X.lineTo(x - R, y);
    X.ellipse(x, y, R, R * k, 0, PI, 0, true);
    X.lineTo(x + R, y - h);
    X.closePath();
    fs(lin(x - R, 0, x + R, 0, [[0, shade(col, -0.32)], [0.4, shade(col, -0.08)], [0.75, shade(col, 0.16)], [1, shade(col, -0.04)]]));
    if (o.tex) {
      X.save();
      X.beginPath(); X.moveTo(x - R, y - h); X.lineTo(x - R, y); X.ellipse(x, y, R, R * k, 0, PI, 0, true); X.lineTo(x + R, y - h); X.closePath();
      X.clip(); o.tex(x, y, R, h); X.restore();
    }
    X.beginPath(); X.moveTo(x - R, y - h); X.lineTo(x - R, y); X.ellipse(x, y, R, R * k, 0, PI, 0, true); X.lineTo(x + R, y - h);
    fs(null, st, o.lw || 1.2);
    if (o.top !== false) {
      ell(x, y - h, R, R * k);
      fs(o.top || shade(col, 0.2), st, o.lw || 1.2);
    }
  }
  /** Point on the front of a cylinder at angle a (0 = right, PI/2 = front, PI = left). */
  const cylPt = (x, y, R, a, z, k) => [x + Math.cos(a) * R, y + Math.sin(a) * R * (k || 0.5) - (z || 0)];
  function cone(x, y, R, h, col, o) {
    o = o || {};
    X.beginPath();
    X.moveTo(x - R, y);
    X.lineTo(x + (o.lean || 0), y - h);
    X.lineTo(x + R, y);
    X.ellipse(x, y, R, R * 0.5, 0, 0, PI, false);
    X.closePath();
    fs(lin(x - R, 0, x + R, 0, [[0, shade(col, -0.3)], [0.65, shade(col, 0.15)], [1, shade(col, -0.05)]]), o.stroke === false ? null : (o.stroke || ink(col)), 1.2);
  }
  /** Dome: base ellipse centre (x, y), radius R, height hh. */
  function domePath(x, y, R, hh) {
    X.beginPath();
    X.ellipse(x, y, R, R * 0.5, 0, PI, 0, true);
    X.ellipse(x, y, R, hh, 0, 0, PI, true);
    X.closePath();
  }
  function dome(x, y, R, hh, col, o) {
    o = o || {};
    domePath(x, y, R, hh);
    fs(rad(x + R * 0.3, y - hh * 0.65, R * 0.05, R * 1.25, [[0, shade(col, 0.4)], [0.45, col], [1, shade(col, -0.35)]]), o.stroke === false ? null : (o.stroke || ink(col)), 1.3);
  }
  /** Meridian/parallel lines on a dome (front half). */
  function domeRibs(x, y, R, hh, nm, np, col, lw) {
    X.strokeStyle = col; X.lineWidth = lw || 1;
    for (let i = 1; i < nm; i++) {
      const phi = PI * i / nm; // 0..PI across the front
      X.beginPath();
      for (let j = 0; j <= 16; j++) {
        const th = (PI / 2) * j / 16; // 0 = base, PI/2 = top
        const px = x - Math.cos(phi) * R * Math.cos(th), py = y + Math.sin(phi) * R * 0.5 * Math.cos(th) - hh * Math.sin(th);
        if (j) X.lineTo(px, py); else X.moveTo(px, py);
      }
      X.stroke();
    }
    for (let i = 1; i < np; i++) {
      const th = (PI / 2) * i / np, r = R * Math.cos(th);
      X.beginPath();
      X.ellipse(x, y - hh * Math.sin(th), r, r * 0.5, 0, 0, PI, false);
      X.stroke();
    }
  }

  // ---------------------------------------------------------------- ground
  function groundShadow(W, D, k, dx, dy) {
    const c = P(W / 2, D / 2, 0), r = (W + D) * HX * 0.5 * (k || 1);
    X.save();
    X.translate(c[0] + (dx == null ? -6 : dx), c[1] + (dy == null ? 4 : dy));
    X.scale(1, 0.5);
    X.fillStyle = H.radial(X, 0, 0, 0, r, [[0, 'rgba(0,0,0,.34)'], [0.65, 'rgba(0,0,0,.22)'], [1, 'rgba(0,0,0,0)']]);
    X.beginPath(); X.arc(0, 0, r, 0, TAU); X.fill();
    X.restore();
  }
  /** Soft elliptical contact shadow. */
  function blob(x, y, rx, ry, a) {
    X.save(); X.translate(x, y); X.scale(1, ry / rx);
    X.fillStyle = H.radial(X, 0, 0, 0, rx, [[0, `rgba(0,0,0,${a == null ? 0.3 : a})`], [0.6, `rgba(0,0,0,${(a == null ? 0.3 : a) * 0.6})`], [1, 'rgba(0,0,0,0)']]);
    X.beginPath(); X.arc(0, 0, rx, 0, TAU); X.fill();
    X.restore();
  }

  // ---------------------------------------------------------------- text & signs
  function txt(str, x, y, size, col, o) {
    o = o || {};
    X.font = size + 'px ' + FONT;
    X.textAlign = o.align || 'center';
    X.textBaseline = 'middle';
    if (o.maxW) {
      const w = X.measureText(str).width;
      if (w > o.maxW) { size = size * o.maxW / w; X.font = size + 'px ' + FONT; }
    }
    if (o.stroke) { X.lineWidth = o.lw || 2.2; X.strokeStyle = o.stroke; X.lineJoin = 'round'; X.strokeText(str, x, y); }
    if (o.shadow) { X.fillStyle = o.shadow; X.fillText(str, x + 0.8, y + 1); }
    X.fillStyle = col;
    X.fillText(str, x, y);
  }
  const SIGN = {
    wood: { bg: '#9a6236', frame: '#5a3418', col: '#ffe9b0', sh: '#3a1e0a' },
    metal: { bg: '#5d6b74', frame: '#2b3338', col: '#ffd84a', sh: '#1a1f22' },
    red: { bg: '#c8372a', frame: '#6a140c', col: '#ffffff', sh: '#5a0a04' },
    cream: { bg: '#f4e7c4', frame: '#7a5a2a', col: '#7a2a14', sh: null },
    green: { bg: '#2f7a46', frame: '#163a20', col: '#ffffff', sh: '#0e2a14' },
    navy: { bg: '#1f4a78', frame: '#0c2238', col: '#ffe680', sh: '#081626' },
    ice: { bg: '#d8f0fa', frame: '#5a8fb0', col: '#1f5a82', sh: null },
    stone: { bg: '#b9ad94', frame: '#6e624c', col: '#4a3c28', sh: 'rgba(255,255,255,.4)' },
    neon: { bg: '#1a2230', frame: '#0a0e14', col: '#7ff0ff', sh: null },
    hazard: { bg: '#2a2e32', frame: '#f0c020', col: '#ffd23a', sh: '#000' },
  };
  /** Sign board centred at (x, y) in the current plane. */
  function board(x, y, w, h, str, style, size) {
    const S = SIGN[style] || SIGN.wood;
    rrect(x - w / 2 - 1.5, y - h / 2 - 1.5, w + 3, h + 3, 3);
    fs(S.frame);
    rrect(x - w / 2, y - h / 2, w, h, 2);
    fs(lin(0, y - h / 2, 0, y + h / 2, [[0, shade(S.bg, 0.18)], [1, shade(S.bg, -0.15)]]));
    if (style === 'wood') { for (let i = 1; i < 3; i++) line(x - w / 2 + 1, y - h / 2 + h * i / 3, x + w / 2 - 1, y - h / 2 + h * i / 3, 'rgba(60,30,10,.35)', 0.6); }
    if (style === 'hazard') {
      X.save(); rrect(x - w / 2, y - h / 2, w, h, 2); X.clip();
      for (let i = -10; i < w / 4 + 10; i++) {
        spath([[x - w / 2 + i * 8, y - h / 2], [x - w / 2 + i * 8 + 4, y - h / 2], [x - w / 2 + i * 8 + 4 - h, y + h / 2], [x - w / 2 + i * 8 - h, y + h / 2]]);
        fs('#f0c020');
      }
      rrect(x - w / 2 + 2.5, y - h / 2 + 2.5, w - 5, h - 5, 1.5); fs('#22272b');
      X.restore();
    }
    if (style === 'metal' || style === 'hazard') {
      X.fillStyle = 'rgba(255,255,255,.55)';
      for (const [px, py] of [[x - w / 2 + 3, y - h / 2 + 3], [x + w / 2 - 3, y - h / 2 + 3], [x - w / 2 + 3, y + h / 2 - 3], [x + w / 2 - 3, y + h / 2 - 3]]) { ell(px, py, 0.9, 0.9); X.fill(); }
    }
    if (str) txt(str, x, y + 0.5, size || h * 0.62, S.col, { maxW: w - 6, shadow: S.sh, stroke: style === 'neon' ? null : null });
    if (style === 'neon' && str) {
      X.save(); X.globalCompositeOperation = 'lighter'; X.globalAlpha *= 0.5;
      txt(str, x, y + 0.5, size || h * 0.62, '#40c0ff', { maxW: w - 6 });
      X.restore();
    }
  }
  /** Sign on a left wall: centred at u = uc, at height z (centre), w×h px. */
  function signL(V, uc, z, w, h, str, style, size) { onL(V, 0, () => board(uc * HX, -z, w, h, str, style, size)); }
  function signR(U, vc, z, w, h, str, style, size) { onR(U, 0, () => board(-vc * HX, -z, w, h, str, style, size)); }

  // ---------------------------------------------------------------- facade details (wall space)
  /** Window with frame at top-left (x, y) size w×h. o: {lit, arch, cross, frame, glass, sill, shutters} */
  function win(x, y, w, h, o) {
    o = o || {};
    const fr = o.frame || '#f4efe2';
    const path = () => {
      if (o.round) { ell(x + w / 2, y + h / 2, w / 2, h / 2); return; }
      if (o.arch) { X.beginPath(); X.moveTo(x, y + h); X.lineTo(x, y + w / 2); X.arc(x + w / 2, y + w / 2, w / 2, PI, 0); X.lineTo(x + w, y + h); X.closePath(); }
      else { X.beginPath(); X.rect(x, y, w, h); }
    };
    if (o.shutters) {
      X.fillStyle = o.shutters; X.fillRect(x - w * 0.42 - 1, y, w * 0.42, h); X.fillRect(x + w + 1, y, w * 0.42, h);
      X.strokeStyle = shade(o.shutters, -0.4); X.lineWidth = 0.7; X.strokeRect(x - w * 0.42 - 1, y, w * 0.42, h); X.strokeRect(x + w + 1, y, w * 0.42, h);
    }
    path();
    fs(fr, ink(fr), 2.6);
    path();
    if (o.lit) fs(lin(x, y, x + w, y + h, [[0, '#fff3b0'], [0.6, '#ffc850'], [1, '#e08a20']]));
    else fs(lin(x, y, x + w, y + h, [[0, o.glass ? shade(o.glass, 0.45) : '#c8ecff'], [0.5, o.glass || '#5aa8d8'], [1, o.glass ? shade(o.glass, -0.4) : '#24527a']]));
    X.save(); path(); X.clip();
    spath([[x + w * 0.15, y + h], [x + w * 0.55, y], [x + w * 0.8, y], [x + w * 0.4, y + h]]);
    fs('rgba(255,255,255,' + (o.lit ? 0.18 : 0.3) + ')');
    X.restore();
    if (o.cross !== false && !o.round) {
      line(x + w / 2, y + (o.arch ? w * 0.2 : 0), x + w / 2, y + h, fr, 1.3);
      line(x, y + h * 0.48, x + w, y + h * 0.48, fr, 1.3);
    }
    if (o.round) { ell(x + w / 2, y + h / 2, w / 2, h / 2); fs(null, o.ring || '#c09030', 2.4); }
    if (o.sill !== false && !o.round) { X.fillStyle = shade(fr, -0.15); X.fillRect(x - 2, y + h, w + 4, 2.2); }
  }
  /** Door (single or double) with top at y. */
  function door(x, y, w, h, col, o) {
    o = o || {};
    const path = () => {
      X.beginPath();
      if (o.arch) { X.moveTo(x, y + h); X.lineTo(x, y + w / 2); X.arc(x + w / 2, y + w / 2, w / 2, PI, 0); X.lineTo(x + w, y + h); X.closePath(); }
      else X.rect(x, y, w, h);
    };
    path();
    fs(shade(col, -0.5));
    X.save(); path(); X.clip();
    if (o.glass) {
      X.fillStyle = lin(x, y, x + w, y + h, [[0, '#d8f2ff'], [0.5, '#6ab0d8'], [1, '#2a5a80']]); X.fillRect(x + 1.5, y + 1.5, w - 3, h - 1.5);
      if (o.lit) { X.fillStyle = 'rgba(255,210,120,.45)'; X.fillRect(x, y, w, h); }
      line(x + w / 2, y, x + w / 2, y + h, shade(col, -0.2), 1.6);
    } else {
      X.fillStyle = lin(x, 0, x + w, 0, [[0, shade(col, -0.1)], [1, shade(col, 0.12)]]); X.fillRect(x + 1.2, y + 1.2, w - 2.4, h);
      for (let i = 1; i < 4; i++) line(x + w * i / 4, y, x + w * i / 4, y + h, rgba(ink(col), 0.35), 0.7);
      if (o.double !== false) line(x + w / 2, y, x + w / 2, y + h, ink(col), 1.2);
    }
    X.restore();
    path(); fs(null, o.frame || ink(col), 1.8);
    if (!o.glass) { X.fillStyle = '#f0c040'; ell(x + w / 2 + (o.double === false ? w * 0.3 : -2), y + h * 0.55, 1.2, 1.2); X.fill(); if (o.double !== false) { ell(x + w / 2 + 2, y + h * 0.55, 1.2, 1.2); X.fill(); } }
  }
  /** Striped awning sticking out of a left wall (v = V) from ua..ub at height z. */
  function awningL(V, ua, ub, z, dep, drop, c1, c2, n) {
    n = n || Math.max(3, Math.round((ub - ua) * 9));
    for (let i = 0; i < n; i++) {
      const a = lerp(ua, ub, i / n), b = lerp(ua, ub, (i + 1) / n);
      ipath([[a, V, z], [b, V, z], [b, V + dep, z - drop], [a, V + dep, z - drop]]);
      fs(lin(0, P(a, V, z)[1], 0, P(a, V + dep, z - drop)[1], [[0, shade(i % 2 ? c2 : c1, -0.12)], [1, shade(i % 2 ? c2 : c1, 0.1)]]));
    }
    ipath([[ua, V, z], [ub, V, z], [ub, V + dep, z - drop], [ua, V + dep, z - drop]]);
    fs(null, ink(c1), 1.1);
    // scalloped valance
    onL(V + dep, ua, () => {
      const len = (ub - ua) * HX;
      for (let i = 0; i < n; i++) {
        const x0 = len * i / n, x1 = len * (i + 1) / n;
        X.beginPath(); X.moveTo(x0, -(z - drop)); X.lineTo(x1, -(z - drop)); X.lineTo(x1, -(z - drop) + 2);
        X.quadraticCurveTo((x0 + x1) / 2, -(z - drop) + 9, x0, -(z - drop) + 2); X.closePath();
        fs(i % 2 ? c2 : c1, ink(c1), 0.8);
      }
    });
  }
  function awningR(U, va, vb, z, dep, drop, c1, c2, n) {
    n = n || Math.max(3, Math.round((vb - va) * 9));
    for (let i = 0; i < n; i++) {
      const a = lerp(vb, va, i / n), b = lerp(vb, va, (i + 1) / n);
      ipath([[U, a, z], [U, b, z], [U + dep, b, z - drop], [U + dep, a, z - drop]]);
      fs(lin(0, P(U, a, z)[1], 0, P(U + dep, a, z - drop)[1], [[0, i % 2 ? c2 : c1], [1, shade(i % 2 ? c2 : c1, 0.15)]]));
    }
    ipath([[U, va, z], [U, vb, z], [U + dep, vb, z - drop], [U + dep, va, z - drop]]);
    fs(null, ink(c1), 1.1);
    onR(U + dep, vb, () => {
      const len = (vb - va) * HX;
      for (let i = 0; i < n; i++) {
        const x0 = len * i / n, x1 = len * (i + 1) / n;
        X.beginPath(); X.moveTo(x0, -(z - drop)); X.lineTo(x1, -(z - drop)); X.lineTo(x1, -(z - drop) + 2);
        X.quadraticCurveTo((x0 + x1) / 2, -(z - drop) + 9, x0, -(z - drop) + 2); X.closePath();
        fs(i % 2 ? c2 : c1, ink(c1), 0.8);
      }
    });
  }

  // ---------------------------------------------------------------- small props
  function pole(x, y, h, col, w) {
    X.fillStyle = lin(x - (w || 2), 0, x + (w || 2), 0, [[0, shade(col, -0.3)], [0.6, shade(col, 0.3)], [1, shade(col, -0.2)]]);
    X.fillRect(x - (w || 2) / 2 - 0.5, y - h, (w || 2) + 1, h);
    ell(x, y - h - 1, (w || 2) * 0.9, (w || 2) * 0.9); X.fillStyle = '#f0c040'; X.fill();
  }
  /** Waving flag cloth attached at (x, y) (top), width w, height h, dir ±1. */
  function cloth(x, y, w, h, t, c1, c2, ph, dir) {
    dir = dir || 1;
    const n = 8, top = [], bot = [];
    for (let i = 0; i <= n; i++) {
      const f = i / n, wv = Math.sin(t * 5.5 - i * 0.85 + (ph || 0)) * 2.6 * f;
      top.push([x + dir * w * f, y + wv]);
      bot.push([x + dir * w * f, y + h + wv + f * 1.5]);
    }
    spath(top.concat(bot.reverse()));
    fs(c1, ink(c1), 0.9);
    if (c2) {
      const a = [], b = [];
      for (let i = 0; i <= n; i++) { const tp = top[i], bt = bot[n - i]; a.push([tp[0], lerp(tp[1], bt[1], 0.36)]); b.push([tp[0], lerp(tp[1], bt[1], 0.64)]); }
      spath(a.concat(b.reverse())); fs(c2);
    }
    // folds shading
    for (let i = 1; i < n; i++) {
      const s = Math.cos(t * 5.5 - i * 0.85 + (ph || 0));
      if (s < -0.3) line(top[i][0], top[i][1] + 1, bot[n - i][0], bot[n - i][1] - 1, 'rgba(0,0,0,.18)', 2);
    }
  }
  /** Triangular pennant. */
  function pennant(x, y, w, h, t, col, ph, dir) {
    dir = dir || 1;
    const wv = Math.sin(t * 6 + (ph || 0)) * 2;
    spath([[x, y], [x + dir * w * 0.5, y + h * 0.25 + wv * 0.5], [x + dir * w, y + h * 0.5 + wv], [x + dir * w * 0.5, y + h * 0.75 + wv * 0.5], [x, y + h]]);
    fs(col, ink(col), 0.8);
  }
  function crate(u, v, z, s, col) {
    box(u, v, u + s, v + s, z, z + s * 34, col || '#b07a44', { tex: TX.planks(s * 34 / 3, 2), lw: 1 });
    const c = P(u + s, v + s, z + s * 17);
    line(c[0] - s * 40, c[1] - s * 3, c[0], c[1] + s * 14, rgba(ink(col || '#b07a44'), 0.4), 1);
  }
  function barrel(x, y, r, h, col) {
    cyl(x, y, r, h, col || '#8a5a30', {
      tex: (cx, cy, R, hh) => {
        for (const f of [0.2, 0.8]) { X.beginPath(); X.ellipse(cx, cy - hh * f, R, R * 0.5, 0, 0, PI); X.strokeStyle = '#3a3a3a'; X.lineWidth = 1.6; X.stroke(); }
      },
      top: shade(col || '#8a5a30', 0.25),
    });
  }
  function lamp(x, y, h, lit) {
    pole(x, y, h, '#3a3f44', 1.8);
    X.fillStyle = '#2a2e32'; X.fillRect(x - 3, y - h - 5, 6, 2);
    ell(x, y - h - 8, 3.2, 4); fs(lit ? '#ffe9a0' : '#d8e0e4', '#2a2e32', 1);
  }
  function glow(x, y, r, col, a) {
    X.save();
    X.globalCompositeOperation = 'lighter';
    X.fillStyle = rad(x, y, 0, r, [[0, rgba(col, a == null ? 0.5 : a)], [1, rgba(col, 0)]]);
    X.fillRect(x - r, y - r, r * 2, r * 2);
    X.restore();
  }

  // ---------------------------------------------------------------- vegetation
  /** Fern clump at ground (x, y), size s (≈ px tall). */
  function fern(x, y, s, col, seed, n) {
    col = col || '#4f9a34';
    n = n || 7;
    for (let i = 0; i < n; i++) {
      const a = -PI / 2 + (i / (n - 1) - 0.5) * 2.5 + (hash(i, seed) - 0.5) * 0.3;
      const l = s * (0.75 + hash(i + 3, seed) * 0.4) * (1 - Math.abs(Math.cos(a + PI / 2)) * 0.2);
      const tipx = x + Math.cos(a) * l, tipy = y + Math.sin(a) * l * 0.85;
      const mx = x + Math.cos(a) * l * 0.55, my = y + Math.sin(a) * l * 0.55 - l * 0.18;
      const c = shade(col, (hash(i, seed + 1) - 0.5) * 0.25 + (Math.cos(a) > 0 ? 0.08 : -0.08));
      // leaflets
      const steps = 6;
      for (let j = 1; j <= steps; j++) {
        const f = j / (steps + 1);
        const px = (1 - f) * (1 - f) * x + 2 * (1 - f) * f * mx + f * f * tipx;
        const py = (1 - f) * (1 - f) * y + 2 * (1 - f) * f * my + f * f * tipy;
        const ll = s * 0.16 * (1 - f * 0.7);
        const nx = -Math.sin(a), ny = Math.cos(a);
        for (const sd of [-1, 1]) {
          ell(px + nx * ll * 0.5 * sd, py + ny * ll * 0.5 * sd - ll * 0.15, ll * 0.62, ll * 0.24, a + sd * 0.9);
          X.fillStyle = sd > 0 ? shade(c, -0.12) : c; X.fill();
        }
      }
      X.beginPath(); X.moveTo(x, y); X.quadraticCurveTo(mx, my, tipx, tipy);
      X.strokeStyle = shade(col, -0.35); X.lineWidth = 1; X.stroke();
    }
  }
  /** Round bush of overlapping balls. */
  function bush(x, y, r, col, seed, fl) {
    col = col || '#4c9a34';
    const rr = H.rng(seed || 4);
    const balls = [];
    for (let i = 0; i < 7; i++) {
      const a = PI + rr() * PI, d = r * (0.25 + rr() * 0.45);
      balls.push([x + Math.cos(a) * d * 1.2, y - r * 0.45 + Math.sin(a) * d * 0.6 - rr() * r * 0.25, r * (0.42 + rr() * 0.22)]);
    }
    balls.push([x, y - r * 0.55, r * 0.6]);
    balls.sort((a, b) => a[1] - b[1]);
    ell(x, y - r * 0.35, r * 1.05, r * 0.7); fs(shade(col, -0.35));
    for (const [bx, by, br] of balls) {
      ell(bx, by, br, br * 0.88);
      fs(rad(bx + br * 0.3, by - br * 0.4, br * 0.1, br * 1.1, [[0, shade(col, 0.35)], [0.6, col], [1, shade(col, -0.3)]]), shade(col, -0.45), 0.9);
    }
    if (fl) {
      for (let i = 0; i < 6; i++) {
        const b = balls[i % balls.length];
        const px = b[0] + (rr() - 0.5) * b[2], py = b[1] + (rr() - 0.7) * b[2] * 0.6;
        ell(px, py, 1.9, 1.6); fs(fl[i % fl.length]);
      }
    }
  }
  /** Tree canopy blob (fruit trees, broadleaf). */
  function canopy(x, y, r, col, seed) {
    const rr = H.rng(seed || 9);
    const balls = [];
    for (let i = 0; i < 9; i++) {
      const a = rr() * TAU, d = r * 0.55 * Math.sqrt(rr());
      balls.push([x + Math.cos(a) * d * 1.15, y + Math.sin(a) * d * 0.8, r * (0.38 + rr() * 0.2)]);
    }
    balls.sort((a, b) => a[1] - b[1]);
    ell(x, y + r * 0.1, r * 1.05, r * 0.9); fs(shade(col, -0.38));
    for (const [bx, by, br] of balls) {
      ell(bx, by, br, br * 0.9);
      fs(rad(bx + br * 0.35, by - br * 0.45, br * 0.1, br * 1.15, [[0, shade(col, 0.32)], [0.55, col], [1, shade(col, -0.32)]]), shade(col, -0.45), 0.8);
    }
  }
  /** Palm tree from ground (x, y), height h. */
  function palmTree(x, y, h, seed, lean) {
    const L = lean == null ? (hash(seed, 3) - 0.5) * 0.5 : lean;
    const tx = x + L * h * 0.6, ty = y - h;
    // trunk
    const segs = 9;
    for (let i = 0; i < segs; i++) {
      const f0 = i / segs, f1 = (i + 1) / segs;
      const bend = (f) => [x + L * h * 0.6 * f * f, y - h * f];
      const a = bend(f0), b = bend(f1), w0 = 4.6 - f0 * 1.8, w1 = 4.6 - f1 * 1.8;
      spath([[a[0] - w0, a[1]], [a[0] + w0, a[1]], [b[0] + w1, b[1] + 1], [b[0] - w1, b[1] + 1]]);
      fs(lin(a[0] - w0, 0, a[0] + w0, 0, [[0, '#6a4a2a'], [0.6, '#a8804e'], [1, '#7a5634']]), '#4a2e14', 0.8);
    }
    // fronds (full serrated leaves, back ones first)
    const n = 8;
    const fr = [];
    for (let i = 0; i < n; i++) fr.push(i);
    fr.sort((a, b) => Math.sin(a / n * TAU + seed) - Math.sin(b / n * TAU + seed));
    for (const i of fr) {
      const a = i / n * TAU + seed;
      const dx = Math.cos(a), dz = Math.sin(a);
      const l = h * (0.5 + hash(i, seed) * 0.12);
      const ex = tx + dx * l * 0.95, ey = ty + dz * l * 0.28 + l * 0.42;
      const cx = tx + dx * l * 0.55, cy = ty - l * 0.3 + dz * l * 0.1;
      const col = dz > 0.2 ? '#62b440' : dz < -0.2 ? '#3a8228' : '#4f9e34';
      const steps = 14, Lp = [], Rp = [], sp = [];
      for (let j = 0; j <= steps; j++) {
        const f = j / steps;
        const px = (1 - f) * (1 - f) * tx + 2 * (1 - f) * f * cx + f * f * ex;
        const py = (1 - f) * (1 - f) * ty + 2 * (1 - f) * f * cy + f * f * ey;
        const gx = 2 * (1 - f) * (cx - tx) + 2 * f * (ex - cx), gy = 2 * (1 - f) * (cy - ty) + 2 * f * (ey - cy);
        const gl = Math.hypot(gx, gy) || 1, nx = -gy / gl, ny = gx / gl;
        const w = (l * 0.15 * Math.sin(Math.min(1, f * 1.1) * PI) + 0.4) * (j % 2 ? 1 : 0.72);
        sp.push([px, py]);
        Lp.push([px + nx * w, py + ny * w + w * 0.35]); Rp.push([px - nx * w, py - ny * w + w * 0.35]);
      }
      spath(Lp.concat(Rp.reverse()));
      fs(lin(tx, ty, ex, ey, [[0, shade(col, 0.15)], [1, shade(col, -0.15)]]), shade(col, -0.45), 0.8);
      X.strokeStyle = rgba(shade(col, -0.4), 0.55); X.lineWidth = 0.7;
      X.beginPath();
      for (let j = 1; j < steps; j++) { X.moveTo(sp[j][0], sp[j][1]); X.lineTo(Lp[j][0], Lp[j][1]); X.moveTo(sp[j][0], sp[j][1]); X.lineTo(Rp[steps - j][0], Rp[steps - j][1]); }
      X.stroke();
      X.beginPath(); X.moveTo(tx, ty); X.quadraticCurveTo(cx, cy, ex, ey);
      X.strokeStyle = shade(col, -0.35); X.lineWidth = 1.3; X.stroke();
    }
    // coconuts on top
    for (const [ddx, ddy] of [[-3, 3], [3, 3.5], [0, 5]]) { ell(tx + ddx, ty + ddy, 3, 3); fs(rad(tx + ddx - 1, ty + ddy - 1, 0.5, 3.5, [[0, '#8a6a3a'], [1, '#4a3418']]), '#2a1a08', 0.7); }
  }
  /** Faceted rock. */
  function rock(x, y, w, h, col, seed) {
    const rr = H.rng(seed || 11);
    const n = 7, pts = [];
    for (let i = 0; i <= n; i++) {
      const a = PI + i / n * PI;
      const k = 0.8 + rr() * 0.3;
      pts.push([x + Math.cos(a) * w * k, y + Math.sin(a) * h * k]);
    }
    pts.push([x + w * 0.9, y + h * 0.18], [x, y + h * 0.3], [x - w * 0.9, y + h * 0.18]);
    spath(pts);
    fs(lin(x - w, y - h, x + w, y, [[0, shade(col, 0.15)], [1, shade(col, -0.3)]]), ink(col), 1.1);
    // facet highlight
    spath([[x - w * 0.5, y - h * 0.65], [x + w * 0.1, y - h * 0.95], [x + w * 0.55, y - h * 0.6], [x + w * 0.05, y - h * 0.35]]);
    fs(rgba(shade(col, 0.4), 0.55));
    spath([[x + w * 0.05, y - h * 0.35], [x + w * 0.55, y - h * 0.6], [x + w * 0.85, y - h * 0.1], [x + w * 0.3, y + h * 0.15]]);
    fs(rgba(shade(col, -0.35), 0.4));
  }
  function flowerAt(x, y, r, col) {
    for (let i = 0; i < 5; i++) { const a = i / 5 * TAU; ell(x + Math.cos(a) * r * 0.6, y + Math.sin(a) * r * 0.45, r * 0.55, r * 0.42, a); X.fillStyle = col; X.fill(); }
    ell(x, y, r * 0.35, r * 0.3); X.fillStyle = '#ffe680'; X.fill();
  }
  function grassTufts(x, y, w, n, col, seed) {
    X.strokeStyle = col || '#4f9a34'; X.lineWidth = 1;
    for (let i = 0; i < n; i++) {
      const px = x + (hash(i, seed) - 0.5) * w, py = y + (hash(i + 7, seed) - 0.5) * w * 0.5;
      X.beginPath();
      for (let j = -1; j <= 1; j++) { X.moveTo(px, py); X.lineTo(px + j * 2.5, py - 5 - Math.abs(j) * -1.5); }
      X.stroke();
    }
  }

  // ---------------------------------------------------------------- animated effects
  function smoke(x, y, t, o) {
    o = o || {};
    const n = o.n || 6, col = o.col || '#d9d4cc';
    for (let i = 0; i < n; i++) {
      const p = fract(t * (o.speed || 0.32) + i / n + (o.seed || 0) * 0.37);
      const px = x + Math.sin(p * 5 + i * 2.1 + (o.seed || 0)) * (o.spread || 3) * p + (o.drift == null ? 8 : o.drift) * p;
      const py = y - p * (o.rise || 42);
      const r = (o.r0 || 2.5) + p * (o.r1 || 8);
      const a = (o.a || 0.55) * Math.min(1, p * 5) * (1 - p);
      ell(px, py, r, r * 0.9);
      X.fillStyle = rgba(col, a); X.fill();
    }
  }
  function flame(x, y, s, t, seed, o) {
    o = o || {};
    const f = 1 + 0.14 * Math.sin(t * 17 + seed * 3) + 0.09 * Math.sin(t * 31 + seed);
    const sway = Math.sin(t * 8 + seed * 2) * 0.22 * s;
    if (o.glow !== false) glow(x, y - s * 0.6, s * (o.glowR || 3.2), '#ff9a30', 0.45 + 0.08 * Math.sin(t * 13 + seed));
    const layer = (w, h, col) => {
      X.beginPath();
      X.moveTo(x - w, y);
      X.bezierCurveTo(x - w * 1.15, y - h * 0.45, x - w * 0.25 + sway * 0.5, y - h * 0.72, x + sway, y - h);
      X.bezierCurveTo(x + w * 0.35 + sway * 0.4, y - h * 0.66, x + w * 1.15, y - h * 0.42, x + w, y);
      X.quadraticCurveTo(x, y + w * 0.6, x - w, y);
      X.fillStyle = col; X.fill();
    };
    layer(s * 0.62, s * 1.75 * f, o.outer || '#e2401a');
    layer(s * 0.47, s * 1.32 * f, o.mid || '#ff9a1f');
    layer(s * 0.27, s * 0.82 * f, o.inner || '#fff0a0');
    if (o.sparks !== false) {
      for (let i = 0; i < 3; i++) {
        const p = fract(t * 0.9 + i / 3 + seed * 0.13);
        const px = x + Math.sin(p * 9 + i * 3 + seed) * s * 0.6, py = y - s * 1.2 - p * s * 3.2;
        ell(px, py, 0.9, 0.9); X.fillStyle = `rgba(255,${180 + i * 20},80,${(1 - p) * 0.9})`; X.fill();
      }
    }
  }
  function sparkle(x, y, r, a, col) {
    if (a <= 0) return;
    X.save();
    X.globalAlpha *= clamp(a, 0, 1);
    X.globalCompositeOperation = 'lighter';
    X.fillStyle = col || '#fff6c8';
    X.beginPath();
    X.moveTo(x, y - r); X.quadraticCurveTo(x, y, x + r, y); X.quadraticCurveTo(x, y, x, y + r);
    X.quadraticCurveTo(x, y, x - r, y); X.quadraticCurveTo(x, y, x, y - r);
    X.fill();
    X.restore();
  }
  function bubbles(x, y, t, o) {
    o = o || {};
    const n = o.n || 5;
    X.lineWidth = 0.9;
    for (let i = 0; i < n; i++) {
      const p = fract(t * (o.speed || 0.3) + i / n + (o.seed || 0) * 0.29);
      const px = x + (hash(i, o.seed || 1) - 0.5) * (o.spread || 10) + Math.sin(p * 9 + i) * 2;
      const py = y - p * (o.h || 50);
      const r = (o.r || 2.2) * (0.6 + hash(i + 3, o.seed || 1) * 0.7) * (0.7 + p * 0.5);
      const a = Math.min(1, p * 6) * (1 - p * 0.7);
      ell(px, py, r, r);
      X.fillStyle = `rgba(200,240,255,${0.18 * a})`; X.fill();
      X.strokeStyle = `rgba(220,250,255,${0.8 * a})`; X.stroke();
      ell(px - r * 0.35, py - r * 0.35, r * 0.28, r * 0.28); X.fillStyle = `rgba(255,255,255,${0.9 * a})`; X.fill();
    }
  }
  /** Small fish swimming on an ellipse path. */
  function fishLoop(cx, cy, rx, ry, t, n, col, speed, seed) {
    for (let i = 0; i < n; i++) {
      const a = t * (speed || 0.8) * (i % 2 ? 1 : -1) + i * TAU / n + (seed || 0);
      const x = cx + Math.cos(a) * rx * (0.7 + 0.3 * hash(i, seed)), y = cy + Math.sin(a) * ry + Math.sin(t * 2 + i) * 2;
      const dir = (i % 2 ? -1 : 1) * (Math.sin(a) >= 0 ? -1 : 1);
      miniFish(x, y, 3.2 + hash(i, 3) * 1.6, dir, col || ['#ffb03a', '#4fc0e8', '#ff6a5a', '#ffe14a'][i % 4], t + i);
    }
  }
  function miniFish(x, y, s, dir, col, t) {
    X.save(); X.translate(x, y); X.scale(dir, 1);
    const wag = Math.sin(t * 12) * 0.3;
    spath([[-s * 0.9, 0], [-s * 1.7, -s * 0.55 + wag], [-s * 1.7, s * 0.55 + wag]]); fs(shade(col, -0.15));
    ell(0, 0, s, s * 0.5); fs(col, shade(col, -0.5), 0.6);
    ell(s * 0.45, -s * 0.1, s * 0.13, s * 0.13); X.fillStyle = '#111'; X.fill();
    X.restore();
  }

  // ================================================================ registry
  const DEFS = {};
  /** Register building art: o = { W, D, H (px above the footprint centre), park, draw(b), anim(b), grow } */
  function def(id, o) { DEFS[id] = Object.assign({ id }, o); }

  // ---------------------------------------------------------------- creature statues / mascots
  const crCache = new Map();
  /** Creature rendered into an offscreen canvas (optionally recoloured: tint 'bronze' | 'ice'). */
  function creatureImg(id, o) {
    const key = [id, o.scale, o.stage, o.facing, o.pose, o.tint || ''].join('|');
    if (crCache.has(key)) return crCache.get(key);
    let res = null;
    try {
      if (PC.ART && PC.ART.drawCreature && PC.SPECIES && PC.SPECIES[id]) {
        const co = { x: 0, y: 0, scale: o.scale, stage: o.stage, facing: o.facing || 1, pose: o.pose || 'idle', t: o.t || 0.6, k: 0.5, shadow: false };
        const bx = PC.ART.creatureBox(id, co);
        const R = 2, pad = 8;
        const w = Math.ceil((bx.x1 - bx.x0 + pad * 2) * R), h = Math.ceil((bx.y1 - bx.y0 + pad * 2) * R);
        if (w > 0 && h > 0 && w < 3000 && h < 3000) {
          const c = document.createElement('canvas'); c.width = w; c.height = h;
          const g = c.getContext('2d');
          g.setTransform(R, 0, 0, R, (-bx.x0 + pad) * R, (-bx.y0 + pad) * R);
          PC.ART.drawCreature(g, id, co);
          if (o.tint) {
            const m = document.createElement('canvas'); m.width = w; m.height = h;
            const mg = m.getContext('2d'); mg.drawImage(c, 0, 0);
            g.setTransform(1, 0, 0, 1, 0, 0);
            g.globalCompositeOperation = 'saturation'; g.fillStyle = '#808080'; g.fillRect(0, 0, w, h);
            if (o.tint === 'bronze') {
              g.globalCompositeOperation = 'multiply'; g.fillStyle = '#e2b25a'; g.fillRect(0, 0, w, h);
              g.globalCompositeOperation = 'screen'; g.fillStyle = H.linear(g, w, 0, 0, h, [[0, 'rgba(255,230,160,.55)'], [0.5, 'rgba(120,80,20,.1)'], [1, 'rgba(60,40,10,0)']]); g.fillRect(0, 0, w, h);
            } else {
              g.globalCompositeOperation = 'screen'; g.fillStyle = '#4fb8e8'; g.fillRect(0, 0, w, h);
              g.globalCompositeOperation = 'screen'; g.fillStyle = H.linear(g, w, 0, 0, h, [[0, 'rgba(255,255,255,.6)'], [0.6, 'rgba(200,240,255,.15)'], [1, 'rgba(0,0,0,0)']]); g.fillRect(0, 0, w, h);
            }
            g.globalCompositeOperation = 'destination-in'; g.drawImage(m, 0, 0);
            g.globalCompositeOperation = 'source-over';
          }
          res = { c, ox: -bx.x0 + pad, oy: -bx.y0 + pad, R, h: bx.y1 - bx.y0, w: bx.x1 - bx.x0 };
        }
      }
    } catch (e) { res = null; }
    crCache.set(key, res);
    return res;
  }
  function drawCreatureImg(img, x, y, alpha) {
    if (!img) return false;
    X.save();
    if (alpha != null) X.globalAlpha *= alpha;
    X.drawImage(img.c, x - img.ox, y - img.oy, img.c.width / img.R, img.c.height / img.R);
    X.restore();
    return true;
  }

  // ---------------------------------------------------------------- shared land bits
  const C = {
    stone: '#c2b394', stoneD: '#9d927e', wood: '#a86c3c', woodD: '#6e4422', woodL: '#d0a068', thatch: '#c9a14e',
    tileRed: '#c94f2f', cream: '#f2e2bc', iron: '#3c3a38', leaf: '#4f9a34', sand: '#e3cf98', soil: '#6b4a2a',
    pave: '#cdbf9f', white: '#eef0ec', glass: '#5aa8d8', grass: '#6aa83e',
  };
  const pave = (W, D, inset, col, n) => slab(inset, inset, W - inset, D - inset, 0, 3, col || C.pave, TT.paving(n || 3, col || C.pave));
  const at = (u, v, z) => P(u, v, z);
  /** Hanging vine in the current plane: starts at (x, y), hangs down len px. */
  function vine(x, y, len, seed) {
    X.beginPath(); X.moveTo(x, y);
    for (let i = 1; i <= 8; i++) X.lineTo(x + Math.sin(i * 1.3 + seed) * 2.5, y + len * i / 8);
    X.strokeStyle = '#2f6a22'; X.lineWidth = 1.2; X.stroke();
    for (let i = 1; i <= 8; i++) {
      const px = x + Math.sin(i * 1.3 + seed) * 2.5, py = y + len * i / 8;
      ell(px + (i % 2 ? 2.5 : -2.5), py, 2.6, 1.5, i % 2 ? 0.5 : -0.5); X.fillStyle = i % 3 ? '#4f9a34' : '#6fbf45'; X.fill();
    }
  }
  /** Iron fire bowl at ground point (x, y) (static part). */
  function fireBowl(x, y, r) {
    X.beginPath();
    X.moveTo(x - r, y - r * 0.9);
    X.quadraticCurveTo(x - r * 0.85, y - r * 0.25, x - r * 0.45, y - r * 0.2);
    X.ellipse(x, y - r * 0.2, r * 0.45, r * 0.22, 0, PI, 0, true);
    X.quadraticCurveTo(x + r * 0.85, y - r * 0.25, x + r, y - r * 0.9);
    X.ellipse(x, y - r * 0.9, r, r * 0.45, 0, 0, PI, false);
    X.closePath();
    fs(lin(x - r, 0, x + r, 0, [[0, '#1e1c1b'], [0.6, '#5a5550'], [1, '#2a2826']]), '#111', 1.2);
    ell(x, y - r * 0.9, r, r * 0.45);
    fs(rad(x, y - r * 0.9, 1, r, [[0, '#fff0a0'], [0.35, '#ff8a20'], [0.8, '#a02a10'], [1, '#3a1a10']]), '#141210', 1.6);
    for (let i = 0; i < 4; i++) { const a = PI * (0.15 + i * 0.23); const q = cylPt(x, y - r * 0.6, r * 0.72, a); line(q[0], q[1] - 3, q[0], q[1] + 2, '#7a746e', 1); }
  }
  /** Bamboo tiki torch (static). Returns flame anchor. */
  function tiki(x, y, h) {
    for (let i = 0; i < 5; i++) {
      const y0 = y - h * i / 5, y1 = y - h * (i + 1) / 5;
      X.fillStyle = lin(x - 2.5, 0, x + 2.5, 0, [[0, '#8a6a30'], [0.6, '#e0c070'], [1, '#9a7838']]);
      X.fillRect(x - 2.4, y1, 4.8, y0 - y1);
      line(x - 2.6, y1 + 0.5, x + 2.6, y1 + 0.5, '#6a4a1a', 1.2);
    }
    X.beginPath(); X.moveTo(x - 6, y - h - 9); X.lineTo(x + 6, y - h - 9); X.lineTo(x + 3, y - h + 1); X.lineTo(x - 3, y - h + 1); X.closePath();
    fs(lin(x - 6, 0, x + 6, 0, [[0, '#6a4a20'], [0.6, '#c09a50'], [1, '#7a5a28']]), '#3a2408', 1);
    X.save(); X.clip();
    for (let i = -3; i <= 3; i++) { line(x + i * 3, y - h - 10, x + i * 3 + 6, y - h + 2, 'rgba(60,30,8,.5)', 0.8); line(x + i * 3, y - h - 10, x + i * 3 - 6, y - h + 2, 'rgba(60,30,8,.5)', 0.8); }
    X.restore();
    ell(x, y - h - 9, 6, 2.2); fs('#2a1808');
    return [x, y - h - 9];
  }
  /** Simple dino footprint emblem (original). */
  function footprint(x, y, s, col) {
    X.fillStyle = col;
    ell(x, y + s * 0.25, s * 0.42, s * 0.38); X.fill();
    for (const a of [-0.55, 0, 0.55]) { ell(x + Math.sin(a) * s * 0.62, y - s * 0.3 - Math.cos(a) * s * 0.18, s * 0.16, s * 0.36, a); X.fill(); }
  }
  /** Text along an arc (current plane). */
  function arcText(str, cx, cy, r, size, col, sh) {
    X.font = size + 'px ' + FONT; X.textAlign = 'center'; X.textBaseline = 'middle';
    const ws = [...str].map(ch => X.measureText(ch).width * 1.04);
    const total = ws.reduce((a, b) => a + b, 0);
    let a = -PI / 2 - total / r / 2;
    [...str].forEach((ch, i) => {
      const am = a + ws[i] / r / 2;
      X.save(); X.translate(cx + Math.cos(am) * r, cy + Math.sin(am) * r); X.rotate(am + PI / 2);
      if (sh) { X.fillStyle = sh; X.fillText(ch, 0.7, 1); }
      X.fillStyle = col; X.fillText(ch, 0, 0);
      X.restore();
      a += ws[i] / r;
    });
  }
  /** Generic low wooden fence along a left edge (v = V, u from a to b) or right edge (u = U, v from a to b). */
  function fenceL(V, a, b, h, col, gapA, gapB) {
    col = col || '#a0703e';
    const n = Math.round((b - a) / 0.22);
    for (let i = 0; i <= n; i++) {
      const u = lerp(a, b, i / n);
      if (gapA != null && u > gapA && u < gapB) continue;
      const p = P(u, V, 0);
      X.fillStyle = lin(p[0] - 1.6, 0, p[0] + 1.6, 0, [[0, shade(col, -0.25)], [1, shade(col, 0.15)]]);
      X.fillRect(p[0] - 1.6, p[1] - h - 2, 3.2, h + 2);
    }
    for (const z of [h * 0.45, h * 0.85]) {
      if (gapA != null) { ipath([[a, V, z], [gapA, V, z]], true); fs(null, shade(col, -0.1), 2); ipath([[gapB, V, z], [b, V, z]], true); fs(null, shade(col, -0.1), 2); }
      else { ipath([[a, V, z], [b, V, z]], true); fs(null, shade(col, -0.1), 2); }
    }
  }
  function fenceR(U, a, b, h, col) {
    col = col || '#a0703e';
    const n = Math.round((b - a) / 0.22);
    for (let i = 0; i <= n; i++) {
      const p = P(U, lerp(a, b, i / n), 0);
      X.fillStyle = lin(p[0] - 1.6, 0, p[0] + 1.6, 0, [[0, shade(col, -0.1)], [1, shade(col, 0.25)]]);
      X.fillRect(p[0] - 1.6, p[1] - h - 2, 3.2, h + 2);
    }
    for (const z of [h * 0.45, h * 0.85]) { ipath([[U, a, z], [U, b, z]], true); fs(null, shade(col, 0.05), 2); }
  }
  /** Sign on a post standing at (u, v). */
  function postSign(u, v, h, w, bh, str, style) {
    const p = P(u, v, 0);
    pole(p[0] - w * 0.3, p[1], h, '#6e4422', 2.4);
    pole(p[0] + w * 0.3, p[1], h, '#6e4422', 2.4);
    board(p[0], p[1] - h + bh * 0.2, w, bh, str, style || 'wood');
  }
  function stringLights(pts, n, t, anim) {
    // pts: screen points of the cable; bulbs hang along it
    X.beginPath(); X.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) X.quadraticCurveTo((pts[i - 1][0] + pts[i][0]) / 2, (pts[i - 1][1] + pts[i][1]) / 2 + 6, pts[i][0], pts[i][1]);
    if (!anim) { X.strokeStyle = '#2a2420'; X.lineWidth = 0.8; X.stroke(); }
    const cols = ['#ff5a4a', '#ffd23a', '#5ad0ff', '#7aff6a', '#ff8ad8'];
    for (let s = 0; s < pts.length - 1; s++) {
      for (let i = 1; i < n; i++) {
        const f = i / n, a = pts[s], b = pts[s + 1];
        const x = lerp(a[0], b[0], f), y = lerp(a[1], b[1], f) + Math.sin(f * PI) * 6 * 0.75;
        const c = cols[(s * n + i) % cols.length];
        if (anim) {
          const on = 0.55 + 0.45 * Math.sin(t * 3 + (s * n + i) * 1.7);
          glow(x, y + 1.5, 4.5, c, 0.5 * on);
        } else { ell(x, y + 1.5, 1.4, 1.8); fs(c, shade(c, -0.5), 0.5); }
      }
    }
  }

  // ================================================================ LAND — specials
  function pillarLand(u0, v0) {
    const u1 = u0 + 0.52, v1 = v0 + 0.62;
    box(u0 - 0.03, v0 - 0.03, u1 + 0.03, v1 + 0.03, 0, 14, '#9a8f7a', { tex: TX.stones(7, 1) });
    box(u0, v0, u1, v1, 14, 72, '#bdae8e', { tex: TX.stones(10, 2) });
    box(u0 + 0.03, v0 + 0.03, u1 - 0.03, v1 - 0.03, 72, 110, C.wood, { tex: TX.vplanks(5.5) });
    for (const z of [78, 102]) box(u0 + 0.02, v0 + 0.02, u1 - 0.02, v1 - 0.02, z, z + 3, '#dcc48e', { hi: false, top: false, stroke: '#7a6030' });
    box(u0 - 0.04, v0 - 0.04, u1 + 0.04, v1 + 0.04, 110, 116, '#a39880', { tex: TX.stones(6, 3) });
    onL(v1, u0, () => { vine(6, -70, 34, u0 * 7); vine((u1 - u0) * HX - 7, -72, 22, u0 * 3 + 1); });
    onR(u1, v1, () => vine(10, -72, 28, u0 * 5 + 2));
    const c = P(u0 + 0.26, v0 + 0.31, 116);
    X.fillStyle = '#2a2826'; X.fillRect(c[0] - 4, c[1] - 6, 8, 6);
    fireBowl(c[0], c[1] - 4, 15);
  }
  def('gate_land', {
    W: 3, D: 2, H: 160, park: 'land',
    draw(b) {
      groundShadow(3, 2, 0.95);
      slab(0.6, 0.02, 2.4, 1.98, 0, 2, '#cdbb92', TT.paving(4, '#cdbb92'));
      fern(...at(0.25, 0.3), 20, '#4f9a34', 3); bush(...at(2.75, 0.25), 15, '#3f8a2c', 5);
      fern(...at(1.0, 0.25), 15, '#5aa83a', 8);
      pillarLand(0.02, 0.7);
      // palisade double door
      const x0 = 0.54 * HX, x1 = 2.46 * HX, n = 10, lw = (x1 - x0) / n;
      extrudeL(0.92, 1.08, 0, 4, (k) => {
        for (let i = 0; i < n; i++) {
          const x = x0 + i * lw, top = -76 - (i % 2 ? 0 : 3);
          spath([[x, 0], [x + lw, 0], [x + lw, top], [x + lw / 2, top - 8], [x, top]]);
          if (k < 1) fs(shade(C.woodD, -0.25));
          else fs(lin(x, 0, x + lw, 0, [[0, shade(C.wood, -0.25)], [0.6, shade(C.wood, 0.18)], [1, shade(C.wood, -0.15)]]), ink(C.wood), 0.9);
        }
        if (k === 1) {
          for (const z of [16, 56]) {
            X.fillStyle = '#3a3634'; X.fillRect(x0, -z - 4, x1 - x0, 6);
            for (let i = 0; i < n; i++) { ell(x0 + i * lw + lw / 2, -z - 1, 1.1, 1.1); X.fillStyle = '#a8a29a'; X.fill(); }
          }
          line((x0 + x1) / 2, 0, (x0 + x1) / 2, -79, '#2a1a0a', 1.6);
          for (const dx of [-6, 6]) { X.beginPath(); X.arc((x0 + x1) / 2 + dx, -38, 4, 0, TAU); X.strokeStyle = '#c9a040'; X.lineWidth = 1.6; X.stroke(); }
        }
      });
      box(0.54, 0.88, 2.46, 1.12, 82, 94, C.woodD, { tex: TX.logs(12) });
      pillarLand(2.46, 0.7);
      // arch sign in front of the pillars
      onL(1.36, 0, () => {
        const cx = 72, cy = -30, r0 = 80, r1 = 110;
        for (const dx of [-26, 26]) { X.fillStyle = lin(cx + dx - 3, 0, cx + dx + 3, 0, [[0, '#4a2c14'], [1, '#8a5a30']]); X.fillRect(cx + dx - 3, -116, 6, 30); }
        const arch = (ro, ri) => { X.beginPath(); X.arc(cx, cy, ro, -PI / 2 - 0.47, -PI / 2 + 0.47); X.arc(cx, cy, ri, -PI / 2 + 0.47, -PI / 2 - 0.47, true); X.closePath(); };
        arch(r1 + 3, r0 - 3); fs('#4a2a12');
        arch(r1, r0); fs(lin(0, cy - r1, 0, cy - r0 * 0.88, [[0, '#c48448'], [1, '#8a5428']]));
        X.save(); arch(r1, r0); X.clip();
        for (let r = r0 + 7; r < r1; r += 7) { X.beginPath(); X.arc(cx, cy, r, -PI, 0); X.strokeStyle = 'rgba(70,35,12,.35)'; X.lineWidth = 0.8; X.stroke(); }
        X.restore();
        arch(r1, r0); fs(null, '#3a1e0a', 1.4);
        arcText('CRÉTACÉ PARK', cx, cy, (r0 + r1) / 2 - 1, 13, '#ffd860', '#3a1a06');
        // emblem
        const ey = cy - r1 - 6;
        ell(cx, ey, 12.5, 12.5); fs(lin(0, ey - 12, 0, ey + 12, [[0, '#ffe08a'], [1, '#c07818']]), '#5a3008', 1.6);
        ell(cx, ey, 9.5, 9.5); fs(rad(cx - 3, ey - 3, 1, 11, [[0, '#ffcf60'], [1, '#d0701a']]));
        footprint(cx, ey + 0.5, 8.5, '#5a2a08');
        for (const dx of [-38, 38]) { ell(cx + dx, cy - r1 + 12 + Math.abs(dx) * 0.05, 1.3, 1.3); X.fillStyle = '#e8c070'; X.fill(); }
      });
      fern(...at(0.3, 1.75), 22, '#4f9a34', 11); fern(...at(2.72, 1.72), 22, '#5aa83a', 12);
      rock(...at(0.6, 1.85), 9, 6, '#8a8278', 2); rock(...at(2.5, 1.9), 7, 5, '#8a8278', 6);
      grassTufts(...at(1.5, 1.85), 40, 6, '#4f9a34', 2);
    },
    anim(b) {
      for (const [u, s] of [[0.28, 1], [2.72, 2]]) {
        const c = P(u, 1.01, 116);
        flame(c[0], c[1] - 18, 13, b.t, s, { glowR: 2.6 });
        smoke(c[0], c[1] - 44, b.t, { n: 5, seed: s, rise: 36, col: '#bfb6aa', a: 0.35 });
      }
    },
  });

  def('lab_land', {
    W: 3, D: 3, H: 162, park: 'land',
    draw(b) {
      groundShadow(3, 3, 0.95);
      slab(0.1, 0.1, 2.9, 2.9, 0, 3, '#c9cdc8', TT.paving(3, '#c9cdc8'));
      // observatory drum + glass dome (back right)
      const dc = P(2.25, 0.85, 3);
      cyl(dc[0], dc[1], 34, 34, '#e4e8ea', { top: false, tex: (x, y, R, h) => { for (let a = 0.25; a < PI; a += 0.5) { const q = cylPt(x, y, R, a, 22); X.fillStyle = '#7fd0f0'; X.fillRect(q[0] - 3 * Math.sin(a), q[1] - 6, 6 * Math.sin(a), 10); } } });
      dome(dc[0], dc[1] - 34, 36, 30, '#7fd8e8');
      domeRibs(dc[0], dc[1] - 34, 36, 30, 6, 3, 'rgba(255,255,255,.6)', 1.1);
      ell(dc[0] + 12, dc[1] - 56, 7, 4); fs('rgba(255,255,255,.5)');
      // main building
      box(0.35, 0.3, 2.0, 2.3, 3, 10, '#7d8a90', { hi: false });
      box(0.35, 0.3, 2.0, 2.3, 10, 64, '#eef1f0', { tex: TX.panels(16) });
      for (const z of [18, 44]) {
        onL(2.3, 0.35, () => { X.fillStyle = lin(0, -z - 14, 0, -z, [[0, '#a8e8ff'], [0.5, '#3a98c8'], [1, '#1c4a6a']]); X.fillRect(4, -z - 14, 1.65 * HX - 8, 14); for (let x = 4; x < 1.65 * HX - 4; x += 10) line(x, -z - 14, x, -z, '#e8f0f0', 1.2); });
        onR(2.0, 2.3, () => { X.fillStyle = lin(0, -z - 14, 0, -z, [[0, '#b8f0ff'], [0.5, '#4aa8d8'], [1, '#205070']]); X.fillRect(6, -z - 14, 2.0 * HX - 12, 14); for (let x = 6; x < 2.0 * HX - 6; x += 10) line(x, -z - 14, x, -z, '#e8f0f0', 1.2); });
      }
      // entrance
      onL(2.3, 0.35, () => { door(24, -26, 26, 23, '#c8ccd0', { glass: true, lit: true }); });
      box(0.75, 2.3, 1.55, 2.62, 30, 34, '#2f8f6a', { stroke: '#174a36' });
      for (const u of [0.8, 1.5]) { const p = P(u, 2.58, 0); X.fillStyle = '#9aa0a4'; X.fillRect(p[0] - 1, p[1] - 30, 2, 30); }
      signL(2.31, 1.18, 54, 62, 12, 'LABO ADN', 'navy', 9.5);
      // second level setback
      flatRoof(0.35, 0.3, 2.0, 2.3, 64, '#d6dbdc', { parapet: 4 });
      box(0.55, 0.5, 1.5, 1.6, 68, 90, '#e8eceb', { tex: TX.panels(12) });
      onL(1.6, 0.55, () => { X.fillStyle = lin(0, -86, 0, -74, [[0, '#a8e8ff'], [1, '#2a6a98']]); X.fillRect(4, -86, 0.95 * HX - 8, 12); });
      onR(1.5, 1.6, () => { X.fillStyle = lin(0, -86, 0, -74, [[0, '#b8f0ff'], [1, '#2a6a98']]); X.fillRect(4, -86, 1.1 * HX - 8, 12); });
      flatRoof(0.55, 0.5, 1.5, 1.6, 90, '#c6cccd', { parapet: 3 });
      // solar panels on the lower roof
      for (let i = 0; i < 3; i++) {
        const u = 1.62 + (i % 2) * 0.0, v = 0.55 + i * 0.5;
        ipath([[u, v, 70], [u + 0.3, v, 70], [u + 0.3, v + 0.38, 76], [u, v + 0.38, 76]]);
        fs(lin(...P(u, v, 70), ...P(u + 0.3, v + 0.38, 76), [[0, '#2a4a8a'], [0.5, '#5a8ad8'], [1, '#1a2a5a']]), '#c8d0d8', 1);
      }
      // AC units
      box(0.6, 1.85, 0.95, 2.15, 68, 78, '#b8bec2', {});
      // antenna masts
      for (const [u, v, h] of [[1.35, 0.6, 46], [0.7, 1.4, 34]]) {
        const p = P(u, v, 94);
        line(p[0], p[1], p[0], p[1] - h, '#5a6268', 1.6);
        for (let k = 1; k < 4; k++) line(p[0] - 4 + k, p[1] - h * k / 4, p[0] + 4 - k, p[1] - h * k / 4, '#5a6268', 1);
      }
      // radar mast (dish drawn in anim)
      const rp = P(0.85, 0.75, 94);
      box(0.78, 0.68, 0.92, 0.82, 94, 108, '#7a8288', {});
      // DNA pylon at the front corner
      box(2.25, 2.25, 2.55, 2.55, 3, 92, '#2c3a48', { stroke: '#121a22' });
      onL(2.55, 2.25, () => { X.fillStyle = '#0c1620'; X.fillRect(3, -88, 8.4, 74); });
      onR(2.55, 2.55, () => { X.fillStyle = '#0c1620'; X.fillRect(3, -88, 8.4, 74); txt('A', 7.2, -80, 7, '#7ff0ff'); txt('D', 7.2, -70, 7, '#7ff0ff'); txt('N', 7.2, -60, 7, '#7ff0ff'); });
      // planters
      for (const u of [0.45, 1.75]) { box(u, 2.4, u + 0.3, 2.62, 3, 9, '#8a8f92', {}); bush(...P(u + 0.15, 2.51, 9), 9, '#4f9a34', u * 10 + 1); }
      bush(...at(2.75, 1.55), 12, '#3f8a2c', 7); fern(...at(0.25, 2.75), 16, '#4f9a34', 4);
      b._rp = rp;
    },
    anim(b) {
      const t = b.t;
      // rotating radar dish
      const rp = P(0.85, 0.75, 108), a = t * 1.3, ca = Math.cos(a), sa = Math.sin(a);
      const rx = 3 + 15 * Math.abs(ca);
      ell(rp[0], rp[1] - 10, rx, 11, 0);
      fs(lin(rp[0] - rx, 0, rp[0] + rx, 0, ca > 0 ? [[0, '#f4f6f8'], [1, '#9aa4ac']] : [[0, '#8a949c'], [1, '#d8dde0']]), '#4a545c', 1.2);
      ell(rp[0], rp[1] - 10, rx * 0.55, 6); fs(ca > 0 ? 'rgba(0,0,0,.12)' : 'rgba(255,255,255,.1)');
      line(rp[0], rp[1] - 10, rp[0] + sa * 9, rp[1] - 18, '#4a545c', 1.3);
      line(rp[0], rp[1], rp[0], rp[1] - 6, '#5a6268', 3);
      // blinking antenna lights
      for (const [u, v, h, ph] of [[1.35, 0.6, 46, 0], [0.7, 1.4, 34, 1.3]]) {
        const p = P(u, v, 94), on = Math.sin(t * 3 + ph) > 0.3;
        ell(p[0], p[1] - h - 1, 2, 2); fs(on ? '#ff4a3a' : '#7a2018');
        if (on) glow(p[0], p[1] - h - 1, 8, '#ff4a3a', 0.6);
      }
      // DNA helix on the pylon (right face)
      onL(2.55, 2.25, () => dnaHelix(7.4, -86, 70, 3.2, t));
      // dome inner glow
      const dc = P(2.25, 0.85, 37);
      glow(dc[0], dc[1] - 8, 30, '#7ff0ff', 0.12 + 0.06 * Math.sin(t * 2));
    },
  });
  /** Animated DNA double helix (vertical) at x, from y0 down len px, amplitude amp. */
  function dnaHelix(x, y0, len, amp, t) {
    const n = 18;
    for (let i = 0; i <= n; i++) {
      const y = y0 + len * i / n, ph = i * 0.62 + t * 3;
      const xa = x + Math.sin(ph) * amp, xb = x + Math.sin(ph + PI) * amp;
      if (i % 2 === 0) line(xa, y, xb, y, 'rgba(200,240,255,.55)', 0.8);
      const front = Math.cos(ph) > 0;
      ell(xa, y, 1.3, 1.3); X.fillStyle = front ? '#ff5a8a' : '#8a2a48'; X.fill();
      ell(xb, y, 1.3, 1.3); X.fillStyle = !front ? '#4fe0ff' : '#1a6a88'; X.fill();
    }
    glow(x, y0 + len / 2, len * 0.45, '#40d8ff', 0.12);
  }

  // ---------------------------------------------------------------- arenas (shared builder)
  /**
   * Round stadium on a 4×4 lot. s = style:
   * { wall, wallTex(x,y,R,h), rim, tiers:[c...], riser, floor, floorDeco(x,y,r), crowd, gate, sign, poles:[angles], pole(x,y,front) }
   */
  function arena(b, s) {
    const c = P(2, 2, 0), cx = c[0], cy = c[1];
    const R = 150, h = s.h || 48, k = 0.5;
    groundShadow(4, 4, 0.9, -8, 6);
    if (s.base) s.base(cx, cy, R);
    // rim (full top ellipse)
    ell(cx, cy - h, R, R * k); fs(s.rim, ink(s.rim), 1.4);
    // tiers
    const n = s.tiers.length, rIn = R - 12;
    let r = rIn, z = h - 5;
    ell(cx, cy - z, r, r * k); fs(s.tiers[0]);
    for (let i = 0; i < n; i++) {
      const r2 = r - 15, z2 = z - 8;
      // tread with crowd
      if (s.crowd) {
        const rr = H.rng(17 + i);
        for (let j = 0; j < 46; j++) {
          const a = PI + 0.12 + (j / 46) * (PI - 0.24) + (rr() - 0.5) * 0.04;
          const rm = (r + r2) / 2 + (rr() - 0.5) * 4;
          const px = cx + Math.cos(a) * rm, py = cy - z + Math.sin(a) * rm * k;
          if (rr() < 0.18) continue;
          const col = s.crowd[Math.floor(rr() * s.crowd.length)];
          X.fillStyle = col; X.fillRect(px - 1.6, py - 2, 3.2, 3.5);
          ell(px, py - 3.2, 1.4, 1.4); X.fillStyle = ['#f0c8a0', '#c08a60', '#8a5a3a', '#f8dcc0'][j % 4]; X.fill();
        }
      }
      // riser band (only the inner back half is visible)
      ell(cx, cy - z, r2, r2 * k); fs(s.riser);
      ell(cx, cy - z2, r2, r2 * k); fs(s.tiers[(i + 1) % n] || s.tiers[0]);
      r = r2; z = z2;
    }
    // floor
    ell(cx, cy - z + 2, r, r * k); fs(s.riser);
    ell(cx, cy - z + 6, r, r * k);
    fs(rad(cx, cy - z + 6, r * 0.1, r, [[0, shade(s.floor, 0.12)], [1, shade(s.floor, -0.12)]]));
    if (s.floorDeco) s.floorDeco(cx, cy - z + 6, r);
    // back poles / decorations on the rim
    const poles = s.poles || [];
    for (const a of poles) if (Math.sin(a) < 0) s.pole(cx + Math.cos(a) * (R - 5), cy - h + Math.sin(a) * (R - 5) * k, false, a);
    // front outer wall
    X.beginPath();
    X.moveTo(cx - R, cy - h); X.lineTo(cx - R, cy);
    X.ellipse(cx, cy, R, R * k, 0, PI, 0, true);
    X.lineTo(cx + R, cy - h);
    X.ellipse(cx, cy - h, R, R * k, 0, 0, PI, false);
    X.closePath();
    fs(lin(cx - R, 0, cx + R, 0, [[0, shade(s.wall, -0.35)], [0.45, shade(s.wall, -0.05)], [0.78, shade(s.wall, 0.14)], [1, shade(s.wall, -0.1)]]));
    if (s.wallTex) {
      X.save();
      X.beginPath(); X.moveTo(cx - R, cy - h); X.lineTo(cx - R, cy); X.ellipse(cx, cy, R, R * k, 0, PI, 0, true); X.lineTo(cx + R, cy - h); X.ellipse(cx, cy - h, R, R * k, 0, 0, PI, false); X.closePath();
      X.clip(); s.wallTex(cx, cy, R, h); X.restore();
    }
    X.beginPath(); X.moveTo(cx - R, cy - h); X.lineTo(cx - R, cy); X.ellipse(cx, cy, R, R * k, 0, PI, 0, true); X.lineTo(cx + R, cy - h);
    fs(null, ink(s.wall), 1.4);
    // rim lip
    X.beginPath(); X.ellipse(cx, cy - h, R, R * k, 0, 0, PI, false); fs(null, shade(s.rim, 0.25), 2.5);
    // gatehouse at the front
    if (s.gate) s.gate(cx, cy, R, h);
    for (const a of poles) if (Math.sin(a) >= 0) s.pole(cx + Math.cos(a) * (R - 5), cy - h + Math.sin(a) * (R - 5) * k, true, a);
    if (s.front) s.front(cx, cy, R, h);
  }
  /** Arched openings around the front of a stadium wall. */
  function arcadeTex(cx, cy, R, h, n, rows, dark, frame) {
    for (let row = 0; row < rows; row++) {
      const zb = 6 + row * (h - 8) / rows, zt = zb + (h - 8) / rows - 5;
      for (let i = 0; i < n; i++) {
        const a = PI * (i + 0.5) / n, sa = Math.sin(a);
        const x = cx + Math.cos(a) * R, y = cy + sa * R * 0.5;
        const w = 9 * sa;
        if (w < 1.5) continue;
        X.beginPath();
        X.moveTo(x - w / 2, y - zb); X.lineTo(x - w / 2, y - zt + w / 2);
        X.ellipse(x, y - zt + w / 2, w / 2, w / 2, 0, PI, 0);
        X.lineTo(x + w / 2, y - zb); X.closePath();
        fs(dark, frame, 1);
      }
      X.beginPath(); X.ellipse(cx, cy - zt - 3, R, R * 0.5, 0, 0, PI); fs(null, rgba('#000000', 0.18), 1.2);
    }
  }
  function torchPole(x, y, front) {
    const p = tiki(x, y, 22);
    return p;
  }
  def('arena_land', {
    W: 4, D: 4, H: 170, park: 'land',
    draw(b) {
      arena(b, {
        wall: '#c9b083', rim: '#d8c49c', riser: '#8a7656', floor: '#e2c98e',
        tiers: ['#bda67c', '#b09a70', '#a89068', '#9c8660'],
        crowd: ['#e8452f', '#2f7ae0', '#f0c030', '#3faa4a', '#ffffff', '#c860c8', '#ff8a2a'],
        base(cx, cy, R) { ell(cx, cy + 2, R + 10, (R + 10) * 0.5); fs('#b8a07a', '#7a6848', 1.2); },
        wallTex: (cx, cy, R, h) => {
          arcadeTex(cx, cy, R, h, 16, 2, '#4a3a28', '#8a7454');
          for (let i = 0; i < 24; i++) { const a = PI * (i + 0.5) / 24; const p = cylPt(cx, cy, R, a); line(p[0], p[1] - 2, p[0], p[1] - h, 'rgba(90,70,40,.18)', 1); }
        },
        floorDeco(x, y, r) {
          X.save(); X.translate(x, y); X.scale(1, 0.5);
          X.beginPath(); X.arc(0, 0, r * 0.45, 0, TAU); X.strokeStyle = 'rgba(150,110,60,.5)'; X.lineWidth = 2; X.stroke();
          X.beginPath(); X.arc(0, 0, r * 0.82, 0, TAU); X.strokeStyle = 'rgba(150,110,60,.35)'; X.lineWidth = 1.5; X.stroke();
          footprint(0, 0, r * 0.28, 'rgba(160,110,50,.45)');
          X.restore();
        },
        poles: [PI * 1.15, PI * 1.38, PI * 1.62, PI * 1.85, PI * 0.12, PI * 0.88],
        pole(x, y, front) { pole(x, y, 30, '#6e4422', 2.4); },
        gate(cx, cy, R, h) {
          // gatehouse at the front corner
          box(3.18, 3.18, 3.78, 3.78, 0, 64, '#d2bc90', { tex: TX.stones(9, 4) });
          for (const side of ['L', 'R']) {
            const f = () => { door(8, -42, 13, 42, '#5a3a1a', { arch: true, frame: '#5a4a30' }); };
            if (side === 'L') onL(3.78, 3.18, f); else onR(3.78, 3.78, f);
          }
          box(3.12, 3.12, 3.84, 3.84, 64, 70, '#b8a07a', { tex: TX.stones(6, 5) });
          // crenels
          for (let i = 0; i < 3; i++) { box(3.14 + i * 0.25, 3.7, 3.28 + i * 0.25, 3.84, 70, 77, '#c9b083', {}); box(3.7, 3.14 + i * 0.25, 3.84, 3.28 + i * 0.25, 70, 77, '#c9b083', {}); }
          const p = P(3.78, 3.78, 0);
          for (const dx of [-20, 20]) { X.fillStyle = '#5a3a1a'; X.fillRect(p[0] + dx - 1.5, p[1] - 90, 3, 14); }
          board(p[0], p[1] - 96, 64, 16, 'ARÈNE', 'red', 12);
          for (const q of [P(3.13, 3.83, 77), P(3.83, 3.13, 77)]) fireBowl(q[0], q[1], 7);
        },
      });
    },
    anim(b) {
      const c = P(2, 2, 0), R = 150, h = 48;
      const poles = [PI * 1.15, PI * 1.38, PI * 1.62, PI * 1.85, PI * 0.12, PI * 0.88];
      const cols = ['#e8452f', '#f0c030', '#2f7ae0', '#e8452f', '#f0c030', '#2f7ae0'];
      poles.forEach((a, i) => {
        const x = c[0] + Math.cos(a) * (R - 5), y = c[1] - h + Math.sin(a) * (R - 5) * 0.5;
        cloth(x + 1, y - 30, 16, 10, b.t, cols[i], i % 2 ? '#ffffff' : null, i * 1.7, Math.cos(a) > 0 ? 1 : -1);
      });
      // camera flashes in the crowd
      for (let i = 0; i < 3; i++) {
        const p = fract(b.t * 0.7 + i * 0.37);
        if (p > 0.12) continue;
        const a = PI + 0.3 + hash(Math.floor(b.t * 0.7 + i * 0.37), i) * (PI - 0.6);
        const rr = 110 - (i % 3) * 14;
        sparkle(c[0] + Math.cos(a) * rr, c[1] - 40 + Math.sin(a) * rr * 0.5, 5, 1 - p / 0.12, '#ffffff');
      }
      // gatehouse fire bowls
      for (const [q, sd] of [[P(3.13, 3.83, 77), 1], [P(3.83, 3.13, 77), 2]]) flame(q[0], q[1] - 7, 6, b.t, sd, { glowR: 2.6 });
    },
  });

  // ================================================================ LAND — food buildings
  /** Fence along a left edge at base height zb. */
  function railL(V, a, b, zb, h, col) {
    col = col || '#8a5a30';
    const n = Math.max(2, Math.round((b - a) / 0.2));
    for (let i = 0; i <= n; i++) { const p = P(lerp(a, b, i / n), V, zb); X.fillStyle = shade(col, -0.1); X.fillRect(p[0] - 1.2, p[1] - h, 2.4, h); }
    ipath([[a, V, zb + h], [b, V, zb + h]], true); fs(null, col, 2);
    ipath([[a, V, zb + h * 0.5], [b, V, zb + h * 0.5]], true); fs(null, shade(col, -0.15), 1.2);
  }
  function railR(U, a, b, zb, h, col) {
    col = col || '#8a5a30';
    const n = Math.max(2, Math.round((b - a) / 0.2));
    for (let i = 0; i <= n; i++) { const p = P(U, lerp(a, b, i / n), zb); X.fillStyle = shade(col, 0.1); X.fillRect(p[0] - 1.2, p[1] - h, 2.4, h); }
    ipath([[U, a, zb + h], [U, b, zb + h]], true); fs(null, shade(col, 0.15), 2);
    ipath([[U, a, zb + h * 0.5], [U, b, zb + h * 0.5]], true); fs(null, col, 1.2);
  }

  def('fern_farm', {
    W: 2, D: 2, H: 82, park: 'land', grow: true,
    draw(b) {
      groundShadow(2, 2, 0.9);
      box(0.06, 0.06, 1.94, 1.94, 0, 3, '#7a5634', { top: true, stroke: '#4a3018' });
      // shed (back corner)
      box(0.12, 0.12, 0.7, 0.72, 3, 30, '#b07a44', { tex: TX.planks(5.5, 3) });
      onR(0.7, 0.72, () => door(10, -26, 15, 23, '#8a5a30', { double: false }));
      onL(0.72, 0.12, () => win(9, -25, 11, 10, { frame: '#e8d8b0', cross: true }));
      gable('v', 0.12, 0.12, 0.7, 0.72, 30, 48, C.thatch, { type: 'thatch', gable: '#c08a50', ov: 0.09 });
      barrel(...P(0.8, 0.84, 3), 5.5, 12, '#7a5a3a');
      ell(...P(0.8, 0.84, 15), 4, 2); fs('#4a8ac8');
      // beds back → front
      const rows = [[0.31, 0.88, 1.84], [0.62, 0.88, 1.84], [1.0, 0.16, 1.84], [1.37, 0.16, 1.84], [1.74, 0.16, 1.84]];
      const g = b.g, s = 5 + g * 17;
      rows.forEach(([vc, u0, u1], r) => {
        box(u0, vc - 0.11, u1, vc + 0.11, 3, 7, '#5a3a1e', { stroke: '#3a2410', hi: false });
        ipath([[u0 + 0.02, vc, 7], [u1 - 0.02, vc, 7]], true); fs(null, 'rgba(30,18,8,.5)', 1);
        for (let u = u0 + 0.12; u < u1 - 0.05; u += 0.27) {
          const p = P(u, vc, 7);
          if (g < 0.15) {
            for (const sd of [-1, 1]) { ell(p[0] + sd * 2.2, p[1] - 3, 2.6, 1.2, sd * -0.5); X.fillStyle = '#7ac84a'; X.fill(); }
            line(p[0], p[1], p[0], p[1] - 3, '#4f8a2c', 1);
          } else fern(p[0], p[1], s * (0.85 + hash(u * 10, r) * 0.3), g > 0.9 ? '#4fa83a' : '#5aa83a', r * 13 + Math.round(u * 10), g < 0.5 ? 5 : 7);
        }
      });
      // sprinkler post
      const sp = P(1.3, 1.19, 3);
      X.fillStyle = '#6a7278'; X.fillRect(sp[0] - 1, sp[1] - 14, 2, 14);
      ell(sp[0], sp[1] - 14, 2.2, 1.4); fs('#9aa4ac', '#3a4248', 0.8);
      // fence + sign
      fenceL(1.95, 0.08, 1.92, 9, '#a0703e', 0.7, 1.05);
      fenceR(1.95, 0.08, 1.92, 9, '#a0703e');
      const sg = P(1.95, 1.95, 0);
      board(sg[0], sg[1] - 18, 46, 12, 'FOUGÈRES', 'wood', 8);
    },
    anim(b) {
      const t = b.t, sp = P(1.3, 1.19, 17);
      for (let i = 0; i < 14; i++) {
        const a = t * 1.6 + i * (TAU / 14), p = fract(t * 1.2 + i * 0.37);
        const dx = Math.cos(a) * 22 * p, dy = Math.sin(a) * 11 * p;
        const y = sp[1] + dy - 10 * Math.sin(p * PI) + p * 10;
        ell(sp[0] + dx, y, 1, 1.4); X.fillStyle = `rgba(150,210,255,${0.85 * (1 - p)})`; X.fill();
      }
      butterfly(...P(1.3, 0.4, 30), t, 0, '#ffb030');
    },
  });
  function butterfly(x, y, t, seed, col) {
    const px = x + Math.sin(t * 0.9 + seed) * 18, py = y + Math.sin(t * 1.7 + seed * 2) * 7;
    const f = Math.abs(Math.sin(t * 14 + seed));
    X.fillStyle = col;
    for (const sd of [-1, 1]) { ell(px + sd * 2.4 * f, py - 1, 2.6 * f + 0.4, 2.2, sd * 0.4); X.fill(); }
    line(px, py - 2, px, py + 1.5, '#2a1a10', 1);
  }

  /** Fruit tree at ground (x, y). */
  function fruitTree(x, y, sz, fruit, n, seed, ripe) {
    blob(x, y, 18 * sz, 7 * sz, 0.25);
    ell(x, y, 10 * sz, 4.5 * sz); fs('#6b4a2a');
    X.beginPath(); X.moveTo(x - 3.5 * sz, y); X.quadraticCurveTo(x - 2 * sz, y - 14 * sz, x - 1.5 * sz, y - 26 * sz); X.lineTo(x + 2 * sz, y - 26 * sz); X.quadraticCurveTo(x + 2.5 * sz, y - 12 * sz, x + 4 * sz, y);
    fs(lin(x - 4, 0, x + 4, 0, [[0, '#5a3a20'], [0.6, '#9a6a3c'], [1, '#6a4428']]), '#3a2410', 1);
    canopy(x, y - 38 * sz, 22 * sz, '#4f9a34', seed);
    const rr = H.rng(seed + 50);
    for (let i = 0; i < n; i++) {
      const a = rr() * TAU, d = Math.sqrt(rr()) * 17 * sz;
      const fx = x + Math.cos(a) * d * 1.1, fy = y - 38 * sz + Math.sin(a) * d * 0.8 + 3;
      const r = (ripe ? 3.1 : 2.2) * sz;
      ell(fx, fy, r, r * 1.05); fs(rad(fx - r * 0.3, fy - r * 0.3, 0.3, r * 1.2, [[0, shade(ripe ? fruit : '#8ac04a', 0.45)], [1, ripe ? fruit : '#6aa03a']]), shade(ripe ? fruit : '#6aa03a', -0.5), 0.7);
    }
  }
  def('fruit_orchard', {
    W: 2, D: 2, H: 72, park: 'land', grow: true,
    draw(b) {
      groundShadow(2, 2, 0.9);
      box(0.06, 0.06, 1.94, 1.94, 0, 3, '#7ab04a', { stroke: '#4a7a2a' });
      onTop(3, () => { for (let i = 0; i < 26; i++) { X.fillStyle = i % 2 ? 'rgba(40,90,20,.25)' : 'rgba(160,210,90,.25)'; ell(0.15 + hash(i, 4) * 1.7, 0.15 + hash(i, 9) * 1.7, 0.05, 0.03); X.fill(); } });
      const g = b.g, n = Math.round(2 + 10 * g), ripe = g > 0.3;
      const trees = [[0.55, 0.55, '#ff9a2a', 1], [1.45, 0.55, '#e8402a', 2], [0.55, 1.45, '#ffd23a', 3], [1.45, 1.45, '#ff7a3a', 4]];
      for (const [u, v, f, s] of trees) {
        const p = P(u, v, 3);
        fruitTree(p[0], p[1], 1, f, n, s, ripe);
        if (s === 2) { // ladder
          const a = P(u + 0.25, v + 0.12, 3), c = [p[0] + 6, p[1] - 30];
          line(a[0] - 3, a[1], c[0] - 3, c[1], '#a0703e', 1.6); line(a[0] + 3, a[1], c[0] + 3, c[1], '#a0703e', 1.6);
          for (let k = 1; k < 6; k++) line(lerp(a[0], c[0], k / 6) - 3, lerp(a[1], c[1], k / 6), lerp(a[0], c[0], k / 6) + 3, lerp(a[1], c[1], k / 6), '#c0905a', 1.2);
        }
        if (s === 2) {
          crate(0.88, 0.85, 3, 0.26, '#b07a44');
          const c = P(1.01, 0.98, 12);
          for (let i = 0; i < Math.round(3 + 6 * g); i++) { ell(c[0] - 7 + (i % 4) * 4.5, c[1] - 1 - Math.floor(i / 4) * 3, 2.6, 2.4); fs(['#ff9a2a', '#e8402a', '#ffd23a'][i % 3], '#5a2a08', 0.6); }
        }
      }
      fenceL(1.95, 0.08, 1.92, 8, '#a0703e', 0.75, 1.1);
      fenceR(1.95, 0.08, 1.92, 8, '#a0703e');
      const sg = P(1.95, 1.95, 0);
      board(sg[0], sg[1] - 17, 42, 12, 'VERGER', 'wood', 8.5);
    },
    anim(b) { butterfly(...P(1.0, 1.0, 40), b.t, 3, '#ff6ab0'); },
  });

  /** Hanging ham / steak in the current plane at (x, y) = hook point. */
  function ham(x, y, s, kind) {
    line(x, y, x, y + 3 * s, '#6a6a6a', 0.8);
    if (kind % 2) {
      X.beginPath(); X.moveTo(x - 1.5 * s, y + 3 * s); X.quadraticCurveTo(x - 4.5 * s, y + 9 * s, x - 2 * s, y + 13 * s); X.quadraticCurveTo(x, y + 14.5 * s, x + 2 * s, y + 13 * s); X.quadraticCurveTo(x + 4.5 * s, y + 9 * s, x + 1.5 * s, y + 3 * s); X.closePath();
      fs(lin(x - 4 * s, 0, x + 4 * s, 0, [[0, '#8a2a1a'], [0.6, '#d0603a'], [1, '#9a3a22']]), '#4a120a', 0.9);
      ell(x, y + 12.5 * s, 1.8 * s, 0.9 * s); fs('#f0e0c8');
    } else {
      ell(x, y + 8 * s, 3.4 * s, 5 * s); fs(lin(x - 3 * s, 0, x + 3 * s, 0, [[0, '#9a2a20'], [1, '#e06a4a']]), '#4a120a', 0.9);
      ell(x - 0.8 * s, y + 7 * s, 1.2 * s, 2.5 * s); fs('rgba(255,235,220,.7)');
    }
  }
  def('meat_market', {
    W: 2, D: 2, H: 94, park: 'land', grow: true,
    draw(b) {
      groundShadow(2, 2, 0.9);
      pave(2, 2, 0.06, '#cfc4b0', 4);
      box(0.3, 0.25, 1.7, 1.25, 3, 46, '#f2efe6', { tex: both(TX.tiles(6), (len, z0, z1) => { X.fillStyle = '#c8372a'; X.fillRect(0, -34, len, 4); }) });
      // counter opening with hanging meat
      onL(1.25, 0.3, () => {
        X.fillStyle = lin(0, -36, 0, -14, [[0, '#3a1e14'], [1, '#6a3a24']]); X.fillRect(7, -34, 54, 20);
        line(8, -32, 60, -32, '#9a9a9a', 1.2);
        const n = 2 + Math.round(4 * b.g);
        for (let i = 0; i < n; i++) ham(12 + i * 47 / Math.max(1, n - 1), -32, 1, i);
        X.fillStyle = lin(0, -15, 0, -11, [[0, '#d8a870'], [1, '#8a5a30']]); X.fillRect(5, -15, 58, 4);
        X.fillStyle = '#c8b8a0'; X.fillRect(5, -11, 58, 8);
        for (let x = 8; x < 60; x += 8) line(x, -11, x, -3, 'rgba(0,0,0,.15)', 0.8);
      });
      awningL(1.25, 0.32, 1.68, 41, 0.2, 7, '#c8372a', '#ffffff');
      onR(1.7, 1.25, () => { door(8, -30, 14, 27, '#8a4a2a', { double: false }); win(28, -30, 12, 12, { frame: '#f4efe2' }); });
      gable('u', 0.3, 0.25, 1.7, 1.25, 46, 66, '#b84a30', { gable: '#f2efe6' });
      box(1.3, 0.85, 1.46, 1.01, 52, 76, '#a87a62', { tex: TX.bricks(4) });
      // rooftop sign
      const sp = P(0.95, 0.75, 66);
      for (const dx of [-14, 14]) { X.fillStyle = '#4a3020'; X.fillRect(sp[0] + dx - 1.2, sp[1] - 10, 2.4, 10); }
      board(sp[0], sp[1] - 16, 52, 13, 'VIANDES', 'red', 9.5);
      // grill at the front
      const gp = P(1.75, 1.72, 3);
      X.fillStyle = '#2a2a2a'; for (const dx of [-5, 5]) X.fillRect(gp[0] + dx - 0.8, gp[1] - 12, 1.6, 12);
      ell(gp[0], gp[1] - 13, 10, 5); fs(lin(gp[0] - 10, 0, gp[0] + 10, 0, [[0, '#1a1a1a'], [0.6, '#4a4a4a'], [1, '#222']]), '#000', 1);
      ell(gp[0], gp[1] - 14, 8.5, 4); fs(rad(gp[0], gp[1] - 14, 1, 9, [[0, '#ffb040'], [1, '#802010']]));
      for (const dx of [-4, 3]) { ell(gp[0] + dx, gp[1] - 15, 3, 1.6); fs('#8a3a20', '#3a100a', 0.6); }
      barrel(...P(0.2, 1.75, 3), 5.5, 12, '#8a5a30');
    },
    anim(b) {
      const gp = P(1.75, 1.72, 3), c = P(1.38, 0.93, 76);
      smoke(gp[0], gp[1] - 18, b.t, { n: 5, rise: 34, col: '#e0dad0', a: 0.45, seed: 2 });
      smoke(c[0], c[1] - 2, b.t, { n: 5, rise: 30, col: '#cfc8c0', a: 0.4, seed: 5 });
    },
  });

  /** Shipping container box. */
  function container(u0, v0, u1, v1, z0, col) {
    box(u0, v0, u1, v1, z0, z0 + 15, col, { tex: TX.corr(2.4), lw: 1 });
  }
  def('crops_harbor', {
    W: 3, D: 3, H: 125, park: 'land', grow: true,
    draw(b) {
      groundShadow(3, 3, 0.95);
      // water basin (back band)
      ipath([[0.04, 0.04, 4], [2.96, 0.04, 4], [2.96, 0.04, -10], [0.04, 0.04, -10]]); fs('#8a8478', '#5a554c', 1);
      ipath([[0.04, 0.04, 4], [0.04, 1.18, 4], [0.04, 1.18, -10], [0.04, 0.04, -10]]); fs('#9a958a', '#5a554c', 1);
      ipath([[0.04, 0.04, -6], [2.96, 0.04, -6], [2.96, 1.18, -6], [0.04, 1.18, -6]]);
      fs(lin(...P(0, 0, -6), ...P(3, 1.2, -6), [[0, '#2a6a8a'], [0.5, '#3a8aa8'], [1, '#235a78']]));
      ipath([[0.04, 0.04, 4], [2.96, 0.04, 4]], true); fs(null, '#d8d2c4', 2.5);
      ipath([[0.04, 0.04, 4], [0.04, 1.18, 4]], true); fs(null, '#d8d2c4', 2.5);
      // cargo ship
      const hull = [[0.3, 0.26], [0.3, 0.92], [2.15, 0.92], [2.64, 0.59], [2.15, 0.26]];
      const side = (a, c, col) => {
        for (const [z0, z1, cc] of [[-6, -2, '#b83a2a'], [-2, 10, col], [10, 12, '#f0f0ea']]) { ipath([[a[0], a[1], z0], [c[0], c[1], z0], [c[0], c[1], z1], [a[0], a[1], z1]]); fs(cc, '#14202c', 0.8); }
      };
      side(hull[3], hull[4], '#3a5a7e');
      side(hull[1], hull[2], '#24405e');
      side(hull[2], hull[3], '#2c4a6c');
      ipath(hull.map(p => [p[0], p[1], 12])); fs('#8a6a5a', '#3a2a20', 1);
      onL(0.92, 0, () => txt('CRÉTACÉ', 1.25 * HX, -4, 6, '#ffffff'));
      // containers on deck
      const cc = ['#c8402a', '#2f6aa8', '#e8b830', '#3f8f4a', '#d06a2a', '#2f8a8a'];
      let ci = 0;
      for (const u of [0.95, 1.5]) for (const v of [0.3, 0.6]) { container(u, v, u + 0.52, v + 0.28, 12, cc[ci++ % 6]); }
      container(0.95, 0.3, 1.47, 0.58, 27, cc[4]); container(1.5, 0.6, 2.02, 0.88, 27, cc[5]);
      // bridge + funnel
      box(0.34, 0.32, 0.8, 0.86, 12, 40, '#f0f0ea', { tex: TX.panels(10) });
      onR(0.8, 0.86, () => { X.fillStyle = '#1a3a5a'; X.fillRect(3, -36, 0.54 * HX - 6, 6); });
      onL(0.86, 0.34, () => { X.fillStyle = '#1a3a5a'; X.fillRect(3, -36, 0.46 * HX - 6, 6); for (let x = 5; x < 20; x += 7) { X.fillStyle = '#1a3a5a'; X.fillRect(x, -26, 4, 4); } });
      box(0.4, 0.42, 0.74, 0.76, 40, 48, '#e4e4de', {});
      const fp = P(0.52, 0.58, 48);
      cyl(fp[0], fp[1], 6, 16, '#c8402a', { top: '#1a1a1a', tex: (x, y, R, h) => { X.fillStyle = '#1a1a1a'; X.fillRect(x - R, y - h, R * 2, 4); X.fillStyle = '#f0f0ea'; X.fillRect(x - R, y - h + 7, R * 2, 2.5); } });
      // deck crane on the bow: orange post, slanted boom over the containers, hook with a net of fruit
      const mp = P(2.3, 0.59, 12), mt = P(2.3, 0.59, 46), bt = P(1.86, 0.5, 58);
      cyl(mp[0], mp[1], 3.4, 34, '#e0702a', { top: '#f09a4a' });
      box(2.22, 0.51, 2.38, 0.67, 34, 42, '#f0f0ea', { lw: 0.8 });
      line(mt[0], mt[1], bt[0], bt[1], ink('#e0702a'), 3.6); line(mt[0], mt[1], bt[0], bt[1], '#f08a3a', 2.2);
      line(mt[0], mt[1] - 6, bt[0], bt[1], '#4a4a4a', 0.7);
      line(bt[0], bt[1], bt[0], bt[1] + 12, '#3a3a3a', 0.8);
      ell(bt[0], bt[1] + 16, 4.6, 4); fs(lin(bt[0] - 4, 0, bt[0] + 4, 0, [[0, '#6a8a3a'], [1, '#a8c860']]), '#3a4a1a', 0.8);
      for (let k = 0; k < 3; k++) { ell(bt[0] - 2 + k * 2, bt[1] + 15 + (k % 2), 1.3, 1.3); X.fillStyle = ['#ff9a2a', '#e8402a', '#ffd23a'][k]; X.fill(); }
      // quay
      box(0.04, 1.18, 2.96, 2.96, 0, 4, '#b9b4a8', { texTop: TT.paving(3, '#b9b4a8') });
      ipath([[0.04, 1.22, 4], [2.96, 1.22, 4]], true); fs(null, '#f0c020', 1.6);
      for (const u of [0.45, 1.3, 2.1]) {
        const p = P(u, 1.26, 4); cyl(p[0], p[1], 3, 5, '#2a2a2a', {});
        line(p[0], p[1] - 4, ...P(u + 0.1, 0.92, 11), '#d8c8a0', 0.9);
      }
      // produce stacks (amount depends on growth)
      const g = b.g, stacks = 2 + Math.round(4 * g);
      const spots = [[0.35, 1.45], [0.75, 1.45], [1.15, 1.45], [0.35, 1.85], [0.75, 1.85], [1.15, 1.85]];
      for (let i = 0; i < stacks; i++) {
        const [u, v] = spots[i];
        crate(u, v, 4, 0.3, '#b07a44');
        const p = P(u + 0.15, v + 0.15, 14);
        if (i % 3 === 0) fern(p[0], p[1], 10, '#5aaa3a', i + 3, 5);
        else for (let k = 0; k < 5; k++) { ell(p[0] - 6 + k * 3, p[1] - 1 - (k % 2) * 2, 2.4, 2.2); fs(['#ff9a2a', '#e8402a', '#ffd23a', '#8ac04a'][(k + i) % 4], '#4a2a08', 0.5); }
      }
      // sacks
      for (let i = 0; i < 1 + Math.round(2 * g); i++) { const p = P(1.6 + i * 0.22, 2.1, 4); ell(p[0], p[1] - 6, 7, 7.5); fs(lin(p[0] - 7, 0, p[0] + 7, 0, [[0, '#a8946a'], [0.6, '#e0cc98'], [1, '#b09a6a']]), '#5a4a2a', 1); line(p[0] - 3, p[1] - 12, p[0] + 3, p[1] - 12, '#5a4a2a', 1.4); }
      container(0.25, 2.25, 0.95, 2.55, 4, '#2f6aa8');
      container(0.25, 2.55, 0.95, 2.85, 4, '#c8402a');
      container(0.3, 2.4, 1.0, 2.7, 19, '#e8b830');
      // quay crane: open lattice tower (4 legs + cross bracing) so the ship stays visible behind it
      const CY = '#e8b830', CD = '#8a6a10', Lg = 0.03, cu0 = 2.52, cu1 = 2.78, cv0 = 1.44, cv1 = 1.7;
      const brace = (len, col, lw) => {
        X.strokeStyle = col; X.lineWidth = lw; X.lineCap = 'round'; X.beginPath();
        for (let z = 8; z < 78; z += 14) { X.moveTo(0, -z); X.lineTo(len, -z - 14); X.moveTo(len, -z); X.lineTo(0, -z - 14); X.moveTo(0, -z); X.lineTo(len, -z); }
        X.stroke();
      };
      const leg = (u, v) => box(u - Lg, v - Lg, u + Lg, v + Lg, 4, 78, CY, { lw: 0.8 });
      leg(cu0, cv0);
      onL(cv0, cu0, () => brace((cu1 - cu0) * HX, shade(CD, 0.15), 1));   // far faces, seen through the tower
      onR(cu0, cv1, () => brace((cv1 - cv0) * HX, shade(CD, 0.15), 1));
      leg(cu1, cv0); leg(cu0, cv1);
      onL(cv1, cu0, () => brace((cu1 - cu0) * HX, CD, 1.5));            // near faces
      onR(cu1, cv1, () => brace((cv1 - cv0) * HX, CD, 1.5));
      leg(cu1, cv1);
      box(2.47, 1.39, 2.83, 1.75, 78, 94, '#f0c030', {});
      onL(1.75, 2.47, () => { X.fillStyle = '#2a4a6a'; X.fillRect(3, -91, 12, 8); });
      onR(2.83, 1.75, () => { X.fillStyle = '#2a4a6a'; X.fillRect(3, -91, 10, 8); });
      const j0 = P(2.65, 1.42, 96), j1 = P(2.65, 0.3, 96), j0b = P(2.65, 1.42, 90), j1b = P(2.65, 0.3, 92);
      spath([j0, j1, j1b, j0b]); fs('#e8b830', '#6a5008', 1);
      X.strokeStyle = '#8a6a10'; X.lineWidth = 0.9; X.beginPath();
      for (let i = 0; i < 10; i++) { const a = [lerp(j0[0], j1[0], i / 10), lerp(j0[1], j1[1], i / 10)], c = [lerp(j0b[0], j1b[0], (i + 0.5) / 10), lerp(j0b[1], j1b[1], (i + 0.5) / 10)]; X.moveTo(a[0], a[1]); X.lineTo(c[0], c[1]); }
      X.stroke();
      const top = P(2.65, 1.57, 112);
      line(top[0], top[1], ...P(2.65, 1.42, 94), '#6a5008', 2);
      line(top[0], top[1], j1[0], j1[1], '#4a4a4a', 0.9);
      line(top[0], top[1], ...P(2.65, 2.07, 94), '#4a4a4a', 0.9);
      box(2.55, 1.75, 2.75, 2.1, 88, 98, '#8a8a8a', {});
      // sign
      const sg = P(2.6, 2.75, 0);
      for (const dx of [-12, 12]) { X.fillStyle = '#4a4a4a'; X.fillRect(sg[0] + dx - 1, sg[1] - 22, 2, 22); }
      board(sg[0], sg[1] - 26, 44, 13, 'PORT', 'navy', 10);
    },
    anim(b) {
      const t = b.t;
      // water ripples
      X.save(); ipath([[0.04, 0.04, -6], [2.96, 0.04, -6], [2.96, 1.18, -6], [0.04, 1.18, -6]]); X.clip();
      for (let i = 0; i < 9; i++) {
        const u = 0.15 + hash(i, 2) * 2.7, v = 0.1 + hash(i, 5) * 1.0, p = P(u, v, -6);
        const k = fract(t * 0.25 + hash(i, 7));
        ell(p[0], p[1], 6 + k * 8, (6 + k * 8) * 0.3); fs(null, `rgba(220,245,255,${0.45 * (1 - k)})`, 1);
      }
      X.restore();
      const fp = P(0.52, 0.58, 64);
      smoke(fp[0], fp[1], t, { n: 6, rise: 40, col: '#9a9a9a', a: 0.45, seed: 3, drift: 10 });
      // hanging container on the crane
      const zc = 46 + Math.sin(t * 0.7) * 8;
      const c0 = P(2.65, 0.5, zc + 15), j = P(2.65, 0.5, 92);
      line(j[0], j[1], c0[0], c0[1] - 2, '#3a3a3a', 1);
      box(2.42, 0.37, 2.88, 0.63, zc, zc + 13, '#3f8f4a', { tex: TX.corr(2.4), lw: 1 });
    },
  });

  // ================================================================ LAND — coin buildings
  def('souvenir_shop', {
    W: 2, D: 2, H: 120, park: 'land',
    draw(b) {
      groundShadow(2, 2, 0.9);
      pave(2, 2, 0.06, '#d8c8a4', 4);
      box(0.35, 0.3, 1.65, 1.4, 3, 10, '#9a9284', { tex: TX.stones(7, 4) });
      box(0.35, 0.3, 1.65, 1.4, 10, 60, '#f3dc9a', { tex: TX.planks(6, 2) });
      for (const [u, v] of [[0.35, 1.4], [1.65, 1.4], [1.65, 0.3]]) box(u - 0.04, v - 0.04, u + 0.04, v + 0.04, 10, 60, '#8a5a30', { hi: false });
      onL(1.4, 0.35, () => {
        X.fillStyle = '#5a3a24'; X.fillRect(4, -33, 32, 22);
        X.fillStyle = lin(0, -33, 0, -11, [[0, '#fff6d8'], [1, '#e8c890']]); X.fillRect(5.5, -31.5, 29, 19);
        // plush toys
        const toys = [['#5ab04a', 10, -15, 5], ['#e86a8a', 19, -16, 4.5], ['#5aa0e8', 28, -15, 5], ['#f0b030', 15, -24, 3.6], ['#a070e0', 25, -25, 3.6]];
        for (const [c, x, y, r] of toys) { ell(x, y, r, r * 0.9); fs(rad(x - 1, y - 1, 0.5, r, [[0, shade(c, 0.35)], [1, c]]), shade(c, -0.5), 0.8); ell(x + r * 0.35, y - r * 0.2, 0.7, 0.7); X.fillStyle = '#111'; X.fill(); }
        line(5, -20, 35, -20, 'rgba(255,255,255,.6)', 1);
        X.strokeStyle = '#5a3a24'; X.lineWidth = 2; X.strokeRect(4, -33, 32, 22);
        door(41, -32, 15, 29, '#8a5a30', { glass: true });
      });
      awningL(1.4, 0.37, 1.63, 38, 0.2, 7, '#e8452f', '#ffffff');
      signL(1.41, 1.0, 48, 56, 12, 'BOUTIQUE', 'red', 9);
      onR(1.65, 1.4, () => {
        win(18, -38, 14, 16, { shutters: '#3f8f6a', frame: '#fff4dc' });
        X.fillStyle = '#7a4a2a'; X.fillRect(16, -21, 18, 4);
        for (let i = 0; i < 5; i++) { ell(18 + i * 3.5, -22, 2, 1.8); X.fillStyle = ['#ff4a5a', '#ffd23a', '#ff8ad8'][i % 3]; X.fill(); }
      });
      hip(0.35, 0.3, 1.65, 1.4, 60, 82, '#d0532f', { ov: 0.1 });
      const m = creatureImg('stegosaurus', { scale: 0.5, stage: 1, facing: -1, pose: 'idle', t: 0.4 });
      const mp = P(1.05, 0.9, 78);
      drawCreatureImg(m, mp[0], mp[1] + 4);
      const fp = P(1.86, 0.2, 3); pole(fp[0], fp[1], 66, '#c8c8c8', 2);
      const bp = P(1.82, 1.75, 3); X.fillStyle = '#6a4a2a'; X.fillRect(bp[0] - 1, bp[1] - 20, 2, 20);
      ell(bp[0], bp[1], 5, 2.5); fs('#8a6a4a');
    },
    anim(b) {
      const t = b.t, fp = P(1.86, 0.2, 69);
      cloth(fp[0] + 1, fp[1], 20, 13, t, '#3a8ad8', '#ffd23a', 0);
      const bp = P(1.82, 1.75, 23);
      const cols = ['#ff4a4a', '#ffd23a', '#4aa0ff'];
      for (let i = 0; i < 3; i++) {
        const x = bp[0] + (i - 1) * 7 + Math.sin(t * 1.5 + i * 2) * 2, y = bp[1] - 14 - (i % 2) * 6 + Math.sin(t * 2 + i) * 1.5;
        X.beginPath(); X.moveTo(bp[0], bp[1]); X.quadraticCurveTo((bp[0] + x) / 2 + 2, (bp[1] + y) / 2, x, y + 5); X.strokeStyle = 'rgba(60,60,60,.7)'; X.lineWidth = 0.6; X.stroke();
        ell(x, y, 4.4, 5.2); fs(rad(x - 1.5, y - 2, 0.5, 6, [[0, shade(cols[i], 0.5)], [1, cols[i]]]), shade(cols[i], -0.4), 0.7);
      }
    },
  });

  def('snack_bar', {
    W: 2, D: 2, H: 100, park: 'land',
    draw(b) {
      groundShadow(2, 2, 0.85);
      pave(2, 2, 0.06, '#d8c8a4', 4);
      parasolTable(...P(0.42, 1.6, 3), '#e8452f', '#ffffff');
      const c = P(0.95, 0.95, 3);
      cyl(c[0], c[1], 40, 36, '#f4e2b8', {
        tex: (x, y, R, h) => {
          for (let i = 0; i < 12; i++) { const a0 = PI * i / 12, a1 = PI * (i + 1) / 12; if (i % 2) continue; const p0 = cylPt(x, y, R, a0), p1 = cylPt(x, y, R, a1); spath([[p0[0], p0[1]], [p1[0], p1[1]], [p1[0], p1[1] - h], [p0[0], p0[1] - h]]); fs('rgba(240,140,40,.55)'); }
          // serving hatch
          X.beginPath(); X.ellipse(x, y - 14, R + 1, R * 0.5 + 0.5, 0, PI * 0.18, PI * 0.82); X.ellipse(x, y - 32, R + 1, R * 0.5 + 0.5, 0, PI * 0.82, PI * 0.18, true); X.closePath();
          fs(lin(0, y - 32, 0, y, [[0, '#3a2014'], [1, '#7a4a2a']]));
          for (let i = 0; i < 5; i++) { const a = PI * (0.28 + i * 0.11), q = cylPt(x, y, R - 3, a, 16); X.fillStyle = ['#ffd23a', '#ff4a5a', '#ffffff', '#ff9a2a', '#5ad0ff'][i]; X.fillRect(q[0] - 1.8, q[1] - 6, 3.6, 6); }
          X.beginPath(); X.ellipse(x, y - 14, R + 2.5, R * 0.5 + 1.5, 0, PI * 0.12, PI * 0.88); X.strokeStyle = '#9a6a3a'; X.lineWidth = 3; X.stroke();
        },
        top: false,
      });
      // volcano roof (frustum + crater)
      const y0 = c[1] - 36, R0 = 48, Rt = 11, hh = 34;
      X.beginPath(); X.moveTo(c[0] - R0, y0); X.lineTo(c[0] - Rt, y0 - hh); X.lineTo(c[0] + Rt, y0 - hh); X.lineTo(c[0] + R0, y0); X.ellipse(c[0], y0, R0, R0 / 2, 0, 0, PI); X.closePath();
      fs(lin(c[0] - R0, 0, c[0] + R0, 0, [[0, '#4a3830'], [0.65, '#8a6a58'], [1, '#5a463c']]), '#2a1a12', 1.3);
      for (const k of [0.3, 0.6]) { const r = lerp(R0, Rt, k); X.beginPath(); X.ellipse(c[0], y0 - hh * k, r, r / 2, 0, 0.15, PI - 0.15); X.strokeStyle = 'rgba(30,18,12,.35)'; X.lineWidth = 1.2; X.stroke(); }
      // pink lava drips
      for (let i = 0; i < 6; i++) {
        const a = PI * (0.12 + i * 0.15), l = 10 + hash(i, 3) * 14;
        const x0 = c[0] + Math.cos(a) * Rt, yy = y0 - hh + Math.sin(a) * Rt / 2;
        const dx = Math.cos(a) * l * 0.9, dy = l;
        X.beginPath(); X.moveTo(x0 - 3, yy); X.quadraticCurveTo(x0 - 3 + dx * 0.5, yy + dy * 0.5, x0 + dx - 2, yy + dy); X.arc(x0 + dx, yy + dy, 2.2, PI, 0, true); X.quadraticCurveTo(x0 + 3 + dx * 0.5, yy + dy * 0.5, x0 + 3, yy); X.closePath();
        fs(lin(0, yy, 0, yy + dy, [[0, '#ff7ab0'], [1, '#e8508a']]), '#a02a5a', 0.8);
      }
      ell(c[0], y0 - hh, Rt + 2, Rt / 2 + 1.5); fs('#ff8ab8', '#a02a5a', 1);
      ell(c[0], y0 - hh - 1, Rt - 2, Rt / 2 - 1.5); fs(rad(c[0], y0 - hh - 1, 1, Rt, [[0, '#fff0f6'], [1, '#ff6aa8']]));
      board(c[0], y0 - 12, 44, 12, 'SNACK', 'cream', 9.5);
      parasolTable(...P(1.62, 1.5, 3), '#ffb020', '#ffffff');
    },
    anim(b) {
      const c = P(0.95, 0.95, 73);
      smoke(c[0], c[1], b.t, { n: 6, rise: 36, col: '#ffe0ee', a: 0.55, seed: 1, drift: 4, r1: 7 });
    },
  });
  function parasolTable(x, y, c1, c2) {
    blob(x, y, 16, 7, 0.25);
    for (const [dx, dy] of [[-9, 1], [9, -1]]) { X.fillStyle = '#8a5a30'; X.fillRect(x + dx - 3, y + dy - 7, 6, 2); X.fillRect(x + dx - 3, y + dy - 7, 1.5, 7); X.fillRect(x + dx + 1.5, y + dy - 7, 1.5, 7); }
    X.fillStyle = '#ddd'; X.fillRect(x - 0.8, y - 9, 1.6, 9);
    ell(x, y - 9, 7, 3.2); fs('#ffffff', '#8a8a8a', 0.8);
    X.fillStyle = '#7a7a7a'; X.fillRect(x - 0.7, y - 30, 1.4, 21);
    const R = 17, top = y - 34;
    for (let i = 0; i < 8; i++) {
      const a0 = PI * i / 8 - 0.02, a1 = PI * (i + 1) / 8 + 0.02;
      spath([[x, top - 7], [x + Math.cos(a0) * R, top + Math.sin(a0) * R * 0.45], [x + Math.cos(a1) * R, top + Math.sin(a1) * R * 0.45]]);
      fs(shade(i % 2 ? c2 : c1, -0.05 + Math.cos((a0 + a1) / 2) * 0.12));
    }
    spath([[x - R, top], [x, top - 7], [x + R, top]], true); fs(null, shade(c1, -0.45), 0.8);
    X.beginPath(); X.ellipse(x, top, R, R * 0.45, 0, 0, PI); fs(null, shade(c1, -0.45), 0.9);
  }

  def('restaurant', {
    W: 2, D: 2, H: 96, park: 'land',
    draw(b) {
      groundShadow(2, 2, 0.9);
      pave(2, 2, 0.06, '#d0c4a8', 4);
      box(0.1, 1.2, 1.9, 1.92, 3, 6, '#b07a44', { texTop: TT.deck(8, '#b07a44') });
      box(0.3, 0.22, 1.62, 1.15, 3, 44, '#cdb894', { tex: TX.stones(8, 6) });
      for (const [u, v] of [[0.3, 1.15], [1.62, 1.15], [1.62, 0.22]]) box(u - 0.035, v - 0.035, u + 0.035, v + 0.035, 3, 44, '#5a3a22', { hi: false });
      onR(1.62, 1.15, () => { win(8, -34, 12, 17, { lit: true, frame: '#6e4422' }); win(26, -34, 12, 17, { lit: true, frame: '#6e4422' }); });
      onL(1.15, 0.3, () => { win(8, -32, 13, 16, { lit: true, frame: '#6e4422', shutters: '#8a3a2a' }); door(36, -32, 15, 29, '#7a4a28', { arch: true }); });
      signL(1.16, 1.0, 38.5, 58, 10, 'RESTAURANT', 'cream', 7.5);
      gable('u', 0.3, 0.22, 1.62, 1.15, 44, 68, '#b8452c', { gable: '#e0cfa8', gableTex: () => { onR(1.62, 1.15, () => win(17, -60, 11, 11, { round: true, lit: true, ring: '#6e4422' })); } });
      box(0.55, 0.86, 0.71, 1.02, 54, 82, '#a89a88', { tex: TX.bricks(4) });
      // giant bone on the ridge
      const bp = P(1.0, 0.685, 68);
      bone(bp[0], bp[1] - 12, 26);
      // terrace
      for (const [u, v] of [[0.55, 1.55], [1.4, 1.6]]) terraceTable(...P(u, v, 6));
      for (const [u, v] of [[0.14, 1.88], [1.86, 1.88]]) { const p = P(u, v, 6); X.fillStyle = '#5a3a22'; X.fillRect(p[0] - 1.2, p[1] - 30, 2.4, 30); }
      stringLights([P(0.14, 1.88, 36), P(1.62, 1.15, 42), P(1.86, 1.88, 36)], 6, 0, false);
    },
    anim(b) {
      const c = P(0.63, 0.94, 82);
      smoke(c[0], c[1], b.t, { n: 6, rise: 38, col: '#d8d2c8', a: 0.45, seed: 4 });
      stringLights([P(0.14, 1.88, 36), P(1.62, 1.15, 42), P(1.86, 1.88, 36)], 6, b.t, true);
    },
  });
  function bone(x, y, w) {
    const h = w * 0.22;
    const path = () => {
      X.beginPath();
      X.moveTo(x - w * 0.42, y - h * 0.45); X.lineTo(x + w * 0.42, y - h * 0.45);
      X.arc(x + w * 0.48, y - h * 0.7, h * 0.62, PI * 0.8, PI * 2.1);
      X.arc(x + w * 0.48, y + h * 0.7, h * 0.62, PI * 1.9, PI * 1.2);
      X.lineTo(x - w * 0.42, y + h * 0.45);
      X.arc(x - w * 0.48, y + h * 0.7, h * 0.62, PI * 1.8, PI * 3.1);
      X.arc(x - w * 0.48, y - h * 0.7, h * 0.62, PI * 0.9, PI * 0.2 + PI * 2, false);
      X.closePath();
    };
    X.save(); X.translate(x, y); X.rotate(-0.12); X.translate(-x, -y);
    X.fillStyle = '#4a3020'; X.fillRect(x - 1.5, y, 3, 14);
    path(); fs(lin(0, y - h * 1.4, 0, y + h * 1.4, [[0, '#fffaf0'], [1, '#d8c8a8']]), '#5a4a30', 1.4);
    line(x - w * 0.38, y - h * 0.15, x + w * 0.38, y - h * 0.15, 'rgba(255,255,255,.8)', 1);
    X.restore();
  }
  function terraceTable(x, y) {
    blob(x, y, 14, 6, 0.25);
    for (const dx of [-10, 10]) { X.fillStyle = '#6a4428'; X.fillRect(x + dx - 2.5, y - 8, 5, 2); X.fillRect(x + dx - 2.5, y - 14, 1.5, 8); X.fillRect(x + dx - 2.5, y - 8, 1.2, 8); X.fillRect(x + dx + 1.3, y - 8, 1.2, 8); }
    X.fillStyle = '#5a3a22'; X.fillRect(x - 1, y - 10, 2, 10);
    ell(x, y - 10, 9, 4.2); fs('#ffffff', '#8a2a2a', 0.8);
    X.save(); ell(x, y - 10, 9, 4.2); X.clip();
    for (let i = -4; i <= 4; i++) for (let j = -2; j <= 2; j++) if ((i + j) % 2 === 0) { X.fillStyle = '#d83a3a'; X.fillRect(x + i * 2.2, y - 10 + j * 1.6, 2.2, 1.6); }
    X.restore();
    ell(x, y - 12, 1.2, 1.8); fs('#fff0c0');
  }

  def('observation_tower', {
    W: 2, D: 2, H: 160, park: 'land',
    draw(b) {
      groundShadow(2, 2, 0.75);
      pave(2, 2, 0.12, '#cfc2a4', 3);
      box(0.38, 0.38, 1.62, 1.62, 3, 8, '#a89c88', { tex: TX.stones(5, 2) });
      const base = { b: [0.5, 0.5], l: [0.5, 1.5], r: [1.5, 0.5], f: [1.5, 1.5] };
      const top = { b: [0.64, 0.64], l: [0.64, 1.36], r: [1.36, 0.64], f: [1.36, 1.36] };
      const leg = k => { const a = P(base[k][0], base[k][1], 8), c = P(top[k][0], top[k][1], 98); line(a[0], a[1], c[0], c[1], '#3a2412', 7); line(a[0], a[1], c[0], c[1], '#9a6a3a', 4.6); line(a[0] - 1, a[1], c[0] - 1, c[1], 'rgba(255,220,160,.35)', 1.2); };
      const brace = (k1, k2) => {
        for (let i = 0; i < 3; i++) {
          const f0 = i / 3, f1 = (i + 1) / 3;
          const pt = (k, f) => { const u = lerp(base[k][0], top[k][0], f), v = lerp(base[k][1], top[k][1], f); return P(u, v, lerp(8, 98, f)); };
          const a = pt(k1, f0), c = pt(k2, f1), d = pt(k2, f0), e = pt(k1, f1);
          line(a[0], a[1], c[0], c[1], '#7a5230', 2); line(d[0], d[1], e[0], e[1], '#7a5230', 2);
          line(e[0], e[1], c[0], c[1], '#6a4424', 2.4);
        }
      };
      leg('b'); brace('b', 'l'); brace('b', 'r');
      // stairs
      for (let i = 0; i < 7; i++) { const z = 14 + i * 12, u = i % 2 ? 0.8 : 1.2; ipath([[0.8, 1.0, z], [1.2, 1.0, z + 12]], true); fs(null, '#b08050', 2.2); }
      leg('l'); leg('r'); brace('l', 'f'); brace('r', 'f'); leg('f');
      box(0.4, 0.4, 1.6, 1.6, 98, 102, '#8a5a30', { texTop: TT.deck(10, '#8a5a30') });
      box(0.58, 0.58, 1.42, 1.42, 102, 124, '#c8955a', { tex: TX.planks(5, 4) });
      onL(1.42, 0.58, () => { X.fillStyle = lin(0, -121, 0, -107, [[0, '#d8f4ff'], [1, '#3a8ab8']]); X.fillRect(3, -121, 0.84 * HX - 6, 13); for (let x = 3; x < 0.84 * HX - 3; x += 10) line(x, -121, x, -108, '#6e4422', 1.4); });
      onR(1.42, 1.42, () => { X.fillStyle = lin(0, -121, 0, -107, [[0, '#e8faff'], [1, '#4a9ac8']]); X.fillRect(3, -121, 0.84 * HX - 6, 13); for (let x = 3; x < 0.84 * HX - 3; x += 10) line(x, -121, x, -108, '#6e4422', 1.4); });
      railL(1.6, 0.4, 1.6, 102, 8, '#7a4a28'); railR(1.6, 0.4, 1.6, 102, 8, '#7a4a28');
      hip(0.58, 0.58, 1.42, 1.42, 124, 146, '#3f7a3a', { ov: 0.16 });
      // telescope
      const tp = P(1.5, 1.5, 102); line(tp[0], tp[1], tp[0], tp[1] - 8, '#3a3a3a', 1.6);
      X.save(); X.translate(tp[0], tp[1] - 10); X.rotate(-0.4); X.fillStyle = '#4a5560'; X.fillRect(-5, -2, 10, 4); X.restore();
      onL(1.62, 0, () => board(1.0 * HX, -92, 50, 11, 'PANORAMA', 'green', 8));
      const ap = P(1.0, 1.0, 146); pole(ap[0], ap[1], 18, '#c8c8c8', 1.6);
    },
    anim(b) {
      const ap = P(1.0, 1.0, 164);
      cloth(ap[0] + 1, ap[1], 16, 10, b.t, '#e8452f', '#ffd23a', 1);
      const on = Math.sin(b.t * 2.5) > 0.2;
      const lp = P(1.0, 1.0, 146);
      ell(lp[0] - 3, lp[1] - 3, 1.8, 1.8); fs(on ? '#ff4a3a' : '#7a2018');
      if (on) glow(lp[0] - 3, lp[1] - 3, 9, '#ff4a3a', 0.6);
    },
  });

  def('hotel', {
    W: 3, D: 3, H: 182, park: 'land',
    draw(b) {
      groundShadow(3, 3, 0.95);
      pave(3, 3, 0.06, '#d8ccb0', 4);
      slab(1.35, 1.85, 1.65, 2.92, 3, 4, '#b02a2a');
      box(0.45, 0.4, 2.55, 1.85, 3, 10, '#b86a4a', { tex: TX.bricks(4) });
      const facade = (len, z0, z1, col, side) => {
        for (let f = 1; f < 4; f++) { X.fillStyle = 'rgba(160,120,70,.35)'; X.fillRect(0, -(10 + f * 28) - 2, len, 3); }
        const step = side === 'L' ? 14.4 : 14;
        for (let f = 0; f < 4; f++) {
          const zb = 10 + f * 28;
          for (let x = 6, i = 0; x < len - 10; x += step, i++) {
            if (side === 'L' && f === 0 && x > 36 && x < 66) continue;
            const lit = hash(i + f * 7, side === 'L' ? 1 : 2) > 0.55;
            win(x, -(zb + 22), 8.5, 15, { lit, frame: '#fff8e8', shutters: f ? '#3f8f5a' : null, cross: false });
          }
        }
      };
      box(0.45, 0.4, 2.55, 1.85, 10, 122, '#f2e3c2', { tex: facade });
      // balconies (left face)
      for (let f = 1; f < 4; f++) {
        const z = 10 + f * 28;
        for (const u of [0.7, 1.3, 1.9]) {
          box(u, 1.85, u + 0.3, 1.97, z, z + 2, '#e8dcc0', { hi: false });
          railL(1.97, u, u + 0.3, z + 2, 6, '#4a5a4a');
        }
      }
      onL(1.85, 0.45, () => door(45, -30, 20, 27, '#c8b080', { glass: true, lit: true }));
      flatRoof(0.45, 0.4, 2.55, 1.85, 122, '#d8c8a8', { parapet: 5 });
      const wt = P(0.85, 0.75, 127); cyl(wt[0], wt[1], 10, 16, '#8a7a6a', { top: '#6a5a4a' });
      box(1.9, 0.6, 2.25, 0.95, 127, 135, '#b8bec2', {});
      // canopy + poles
      for (const u of [1.2, 1.8]) { const p = P(u, 2.3, 3); X.fillStyle = '#c8b060'; X.fillRect(p[0] - 1, p[1] - 33, 2, 33); }
      box(1.12, 1.85, 1.88, 2.36, 33, 37, '#2f7a46', { stroke: '#163a20' });
      // rooftop sign
      onL(1.65, 0, () => {
        for (const x of [52, 92]) { X.fillStyle = '#4a4a4a'; X.fillRect(x - 1.2, -142, 2.4, 16); }
        board(72, -146, 72, 17, 'HÔTEL', 'navy', 13);
        for (let i = 0; i < 3; i++) ICONS_star(60 + i * 12, -160, 4.5);
      });
      palmTree(...P(0.3, 2.55, 3), 52, 2.2, -0.15);
      palmTree(...P(2.6, 2.6, 3), 48, 4.1, 0.15);
      for (const v of [0.55, 0.95, 1.35]) { const p = P(2.82, v, 3); pole(p[0], p[1], 64, '#d0d0d0', 2); }
      bush(...P(0.9, 2.35, 3), 9, '#4f9a34', 3, ['#ff5a6a']); bush(...P(2.1, 2.35, 3), 9, '#4f9a34', 4, ['#ffd23a']);
    },
    anim(b) {
      const cols = [['#e8452f', '#ffffff'], ['#2f7ae0', '#ffd23a'], ['#3f8f4a', '#ffffff']];
      [0.55, 0.95, 1.35].forEach((v, i) => { const p = P(2.82, v, 67); cloth(p[0] + 1, p[1], 18, 12, b.t, cols[i][0], cols[i][1], i * 1.3); });
      // a few windows switching on/off
      onR(2.55, 1.85, () => {
        for (let i = 0; i < 3; i++) {
          const on = Math.sin(b.t * 0.35 + i * 2.1) > 0.35;
          if (!on) continue;
          const f = 1 + i, x = 6 + ((i * 2 + 1) % 4) * 14, zb = 10 + f * 28;
          X.fillStyle = 'rgba(255,214,110,.75)'; X.fillRect(x, -(zb + 22), 8.5, 15);
        }
      });
    },
  });
  /** Small golden star in the current plane. */
  function ICONS_star(x, y, r) {
    const pts = [];
    for (let i = 0; i < 10; i++) { const rr = i % 2 ? r * 0.45 : r, a = -PI / 2 + i * PI / 5; pts.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr]); }
    spath(pts); fs('#ffd23a', '#7a5206', 0.8);
  }

  def('cinema', {
    W: 3, D: 3, H: 178, park: 'land',
    draw(b) {
      groundShadow(3, 3, 0.95);
      pave(3, 3, 0.06, '#c8bca4', 4);
      slab(1.15, 2.0, 1.85, 2.92, 3, 4, '#b02a2a');
      box(0.4, 0.35, 2.6, 2.0, 3, 10, '#3a1a1a', {});
      box(0.4, 0.35, 2.6, 2.0, 10, 80, '#8e2a2e', { tex: (len, z0, z1, col) => { for (let x = 6; x < len; x += 13) { X.fillStyle = 'rgba(240,190,80,.55)'; X.fillRect(x, -z1, 1.6, z1 - z0); } } });
      box(0.36, 0.31, 2.64, 2.04, 80, 86, '#e0b040', {});
      // poster on the right face
      onR(2.6, 2.0, () => {
        X.fillStyle = '#e0b040'; X.fillRect(14, -72, 52, 58);
        X.fillStyle = lin(0, -70, 0, -16, [[0, '#ff9a3a'], [0.55, '#e0503a'], [1, '#4a1a4a']]); X.fillRect(17, -69, 46, 52);
        ell(40, -48, 12, 12); X.fillStyle = 'rgba(255,230,140,.8)'; X.fill();
        X.save(); X.beginPath(); X.rect(17, -69, 46, 52); X.clip();
        if (PC.ART && PC.ART.drawCreature) { try { PC.ART.drawCreature(X, 'tyrannosaurus', { x: 36, y: -24, scale: 0.18, pose: 'roar', t: 0.5, shadow: false, silhouette: 'rgba(30,8,24,.95)' }); } catch (e) { /* ignore */ } }
        X.restore();
        txt('DINO 3D', 40, -21, 7, '#ffe680', { shadow: '#2a0a10' });
      });
      onL(2.0, 0.4, () => { for (let i = 0; i < 3; i++) door(36 + i * 12, -27, 11, 24, '#c8b080', { glass: true, lit: true }); });
      // marquee
      box(0.92, 2.0, 2.08, 2.34, 32, 46, '#f4f0e6', {});
      signL(2.35, 1.5, 39, 48, 9, 'DINO-FILM', 'cream', 7.5);
      // film reel on the roof
      ipath([[0.48, 0.43, 86], [2.52, 0.43, 86], [2.52, 1.92, 86], [0.48, 1.92, 86]]); fs('#5a2a2a');
      box(1.5, 0.75, 2.3, 1.45, 86, 92, '#7a3a36', { texTop: () => { X.fillStyle = 'rgba(140,210,240,.75)'; X.fillRect(0.06, 0.06, 0.68, 0.58); X.strokeStyle = '#3a1a1a'; X.lineWidth = 0.03; for (let i = 1; i < 4; i++) { X.beginPath(); X.moveTo(i * 0.2, 0.06); X.lineTo(i * 0.2, 0.64); X.stroke(); } } });
      box(1.75, 1.6, 2.05, 1.85, 86, 96, '#b8bec2', {}); box(2.15, 1.6, 2.4, 1.85, 86, 94, '#a8aeb2', {});
      const rp = P(1.0, 0.9, 86);
      X.fillStyle = '#3a3a3a'; X.fillRect(rp[0] - 1.5, rp[1] - 20, 3, 20);
      reel(rp[0] - 9, rp[1] - 30, 12); reel(rp[0] + 12, rp[1] - 22, 9);
      // pylon with vertical letters
      box(1.28, 1.86, 1.72, 2.12, 46, 128, '#6a1a1e', { tex: TX.panels(30) });
      onL(2.12, 1.28, () => {
        X.fillStyle = '#2a0a0e'; X.fillRect(5, -122, 0.44 * HX - 10, 72);
        [...'CINÉMA'].forEach((ch, i) => txt(ch, 0.22 * HX, -115 + i * 11.6, 10, '#ffe680', { shadow: '#5a2a00' }));
      });
      box(1.24, 1.82, 1.76, 2.16, 128, 132, '#e0b040', {});
      // rope stands
      for (const u of [1.12, 1.88]) {
        const pts = [2.3, 2.6, 2.9].map(v => P(u, v, 3));
        for (const p of pts) { X.fillStyle = '#d0a030'; X.fillRect(p[0] - 1, p[1] - 9, 2, 9); ell(p[0], p[1] - 9.5, 1.6, 1.6); X.fill(); }
        for (let i = 0; i < 2; i++) { X.beginPath(); X.moveTo(pts[i][0], pts[i][1] - 7); X.quadraticCurveTo((pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2 - 3, pts[i + 1][0], pts[i + 1][1] - 7); X.strokeStyle = '#b02a2a'; X.lineWidth = 1.6; X.stroke(); }
      }
    },
    anim(b) {
      const t = b.t;
      // marquee chase lights
      onL(2.34, 0.92, () => {
        const len = 1.16 * HX;
        for (let i = 0; i < 14; i++) { const x = 2 + i * (len - 4) / 13, on = (Math.floor(t * 6) + i) % 3 === 0; ell(x, -45, 1.3, 1.3); X.fillStyle = on ? '#fff6a0' : '#a08040'; X.fill(); if (on) glow(x, -45, 5, '#ffd040', 0.5); ell(x, -33, 1.3, 1.3); X.fillStyle = !on ? '#fff6a0' : '#a08040'; X.fill(); }
      });
      // pylon letters light up in sequence
      onL(2.12, 1.28, () => { const i = Math.floor(t * 2.5) % 8; if (i < 6) glow(0.22 * HX, -115 + i * 11.6, 10, '#ffd040', 0.55); });
      // searchlights
      X.save(); X.globalCompositeOperation = 'lighter';
      for (const [u, v, ph] of [[0.6, 0.5, 0], [2.4, 1.85, 2]]) {
        const p = P(u, v, 86), a = -PI / 2 + Math.sin(t * 0.6 + ph) * 0.5;
        const L = 130, w = 0.09;
        spath([p, [p[0] + Math.cos(a - w) * L, p[1] + Math.sin(a - w) * L], [p[0] + Math.cos(a + w) * L, p[1] + Math.sin(a + w) * L]]);
        X.fillStyle = H.radial(X, p[0], p[1], 0, L, [[0, 'rgba(255,250,210,.16)'], [1, 'rgba(255,250,210,0)']]); X.fill();
      }
      X.restore();
    },
  });
  function reel(x, y, r) {
    ell(x, y, r, r); fs(lin(x - r, y - r, x + r, y + r, [[0, '#9aa0a8'], [1, '#3a3e44']]), '#1a1a1a', 1.2);
    for (let i = 0; i < 5; i++) { const a = i / 5 * TAU; ell(x + Math.cos(a) * r * 0.55, y + Math.sin(a) * r * 0.55, r * 0.2, r * 0.2); X.fillStyle = '#2a2a2a'; X.fill(); }
    ell(x, y, r * 0.15, r * 0.15); X.fillStyle = '#c8c8c8'; X.fill();
  }

  // ================================================================ LAND — decorations
  def('palm', {
    W: 1, D: 1, H: 95, park: 'land', sway: 0.03,
    draw(b) {
      const c = P(0.5, 0.5, 0);
      blob(c[0] - 4, c[1] + 2, 30, 13, 0.3);
      ell(c[0], c[1], 28, 13); fs(lin(0, c[1] - 13, 0, c[1] + 13, [[0, '#f0dca8'], [1, '#d4bc84']]), '#b09a68', 1);
      for (let i = 0; i < 4; i++) rock(c[0] - 18 + i * 11, c[1] + 4 - (i % 2) * 5, 4, 3, '#a09584', i);
      grassTufts(c[0], c[1] + 2, 44, 6, '#5a9a34', 3);
      palmTree(c[0] - 2, c[1] + 1, 76, 1.3, 0.22);
    },
  });
  def('flowers', {
    W: 1, D: 1, H: 45, park: 'land',
    draw(b) {
      const c = P(0.5, 0.5, 0);
      blob(c[0], c[1] + 2, 34, 15, 0.25);
      cyl(c[0], c[1] + 2, 34, 7, '#a89c88', { top: '#6b4a2a', tex: (x, y, R, h) => { for (let i = 0; i < 14; i++) { const a = PI * i / 13, q = cylPt(x, y, R, a); line(q[0], q[1], q[0], q[1] - h, 'rgba(60,50,40,.35)', 0.8); } } });
      ell(c[0], c[1] - 5, 30, 14); fs('#5a3a20');
      const fl = [['#ff4a5a', '#ffd23a'], ['#c060e0', '#ffffff'], ['#ff8a2a', '#ff4a8a'], ['#ffe14a', '#ff6a3a'], ['#ff5a8a', '#ffffff']];
      const spots = [[-14, -9], [6, -12], [16, -5], [-4, -3], [-18, 0], [10, 3], [-6, 6]];
      spots.forEach(([dx, dy], i) => bush(c[0] + dx, c[1] + dy, 8, i % 2 ? '#4f9a34' : '#3f8a2c', i + 1, fl[i % fl.length]));
      // bird of paradise
      const bp = [c[0] + 2, c[1] - 6];
      line(bp[0], bp[1], bp[0] + 2, bp[1] - 22, '#3f7a2a', 1.6);
      spath([[bp[0] + 2, bp[1] - 22], [bp[0] + 12, bp[1] - 25], [bp[0] + 3, bp[1] - 19]]); fs('#ff8a1a', '#8a3a08', 0.7);
      spath([[bp[0] + 5, bp[1] - 23], [bp[0] + 8, bp[1] - 31], [bp[0] + 9, bp[1] - 23]]); fs('#3a5ae0', '#1a2a6a', 0.6);
    },
    anim(b) { const c = P(0.5, 0.5, 22); butterfly(c[0], c[1], b.t, 1, '#ff9a2a'); butterfly(c[0] - 6, c[1] - 6, b.t * 1.1, 4, '#5ab0ff'); },
  });
  const TORCH_A = [0.36, 0.62, 52], TORCH_B = [0.66, 0.34, 40];
  def('torch', {
    W: 1, D: 1, H: 80, park: 'land',
    draw(b) {
      const c = P(0.5, 0.5, 0);
      blob(c[0], c[1] + 2, 26, 11, 0.25);
      for (let i = 0; i < 7; i++) { const a = PI + i / 6 * PI; rock(c[0] + Math.cos(a) * 18, c[1] + 4 + Math.sin(a) * 7, 5, 4, '#8a8278', i + 3); }
      tiki(...P(TORCH_B[0], TORCH_B[1], 0), TORCH_B[2]);
      fern(c[0] - 4, c[1] + 4, 16, '#4f9a34', 4, 6);
      tiki(...P(TORCH_A[0], TORCH_A[1], 0), TORCH_A[2]);
      for (let i = 0; i < 4; i++) rock(c[0] - 14 + i * 9, c[1] + 10 - (i % 2) * 2, 4, 3, '#9a9284', i + 8);
    },
    anim(b) {
      for (const [T, s] of [[TORCH_B, 2], [TORCH_A, 1]]) { const p = P(T[0], T[1], 0); flame(p[0], p[1] - T[2] - 10, 7.5, b.t, s, { glowR: 3 }); }
    },
  });
  def('volcano_rock', {
    W: 1, D: 1, H: 70, park: 'land',
    draw(b) {
      const c = P(0.5, 0.5, 0);
      blob(c[0] - 3, c[1] + 3, 34, 14, 0.32);
      rock(c[0] + 18, c[1] + 6, 10, 7, '#3e3836', 2);
      rock(c[0], c[1] + 2, 28, 34, '#433c3a', 5);
      rock(c[0] - 20, c[1] + 8, 11, 8, '#4a4240', 7);
      // glowing cracks
      const cracks = [[[-10, -26], [-4, -16], [-8, -6], [-2, 4]], [[6, -30], [10, -18], [4, -10], [12, 0]], [[-18, -4], [-10, 0], [-14, 6]]];
      for (const cr of cracks) {
        spath(cr.map(p => [c[0] + p[0], c[1] + p[1]]), true);
        fs(null, '#ff6a1a', 2.6);
        spath(cr.map(p => [c[0] + p[0], c[1] + p[1]]), true);
        fs(null, '#ffe080', 0.9);
      }
      for (let i = 0; i < 3; i++) { ell(c[0] - 14 + i * 13, c[1] + 12, 3, 1.2); X.fillStyle = '#ff8a2a'; X.fill(); }
    },
    anim(b) {
      const c = P(0.5, 0.5, 0), t = b.t;
      glow(c[0], c[1] - 12, 30, '#ff5a10', 0.22 + 0.1 * Math.sin(t * 2.2));
      smoke(c[0] + 2, c[1] - 34, t, { n: 4, rise: 30, col: '#8a8078', a: 0.35, seed: 3, drift: 5 });
      for (let i = 0; i < 4; i++) { const p = fract(t * 0.6 + i / 4); ell(c[0] - 8 + i * 6 + Math.sin(p * 8 + i) * 3, c[1] - 20 - p * 26, 1, 1); X.fillStyle = `rgba(255,${150 + i * 20},60,${1 - p})`; X.fill(); }
    },
  });
  def('safari_jeep', {
    W: 1, D: 1, H: 55, park: 'land',
    draw(b) {
      const c = P(0.5, 0.5, 0);
      blob(c[0] - 2, c[1] + 3, 34, 13, 0.35);
      const wheel = (u, v) => onL(v, 0, () => { const x = u * HX; ell(x, -6, 6.2, 6.2); fs('#1e1e1e', '#000', 1); ell(x, -6, 3.2, 3.2); fs('#8a8a80'); ell(x, -6, 1.2, 1.2); fs('#2a2a2a'); });
      wheel(0.34, 0.3); wheel(0.74, 0.3);
      box(0.16, 0.32, 0.86, 0.7, 4, 9, '#2a2a28', { hi: false });
      const body = '#7a8a3e';
      box(0.16, 0.32, 0.62, 0.7, 8, 23, body, { tex: (len, z0, z1, col, side) => { if (side === 'L') { X.fillStyle = '#d8c070'; X.fillRect(0, -17, len, 3); txt('RANGER', len / 2, -12.5, 5, '#f4ecd0'); } } , top: false });
      // tub interior
      ipath([[0.2, 0.36, 23], [0.6, 0.36, 23], [0.6, 0.66, 23], [0.2, 0.66, 23]]); fs('#3a3a2e');
      box(0.24, 0.4, 0.38, 0.62, 12, 27, '#5a4030', {}); // rear seat
      box(0.44, 0.4, 0.56, 0.5, 12, 26, '#5a4030', {}); box(0.44, 0.54, 0.56, 0.64, 12, 26, '#5a4030', {});
      box(0.62, 0.34, 0.88, 0.68, 8, 19, body, { tex: (len, z0, z1, col, side) => { if (side === 'R') { X.fillStyle = '#2a2a2a'; for (let x = 4; x < len - 4; x += 2.5) X.fillRect(x, -16, 1.2, 7); ell(3, -12.5, 2.2, 2.2); fs('#fff6c8', '#333', 0.6); ell(len - 3, -12.5, 2.2, 2.2); fs('#fff6c8', '#333', 0.6); } } });
      // spare wheel on the hood
      const sw = P(0.75, 0.51, 19); ell(sw[0], sw[1] - 2, 7, 3.6); fs('#1e1e1e', '#000', 1); ell(sw[0], sw[1] - 2.5, 3, 1.5); fs('#8a8a80');
      // windshield
      ipath([[0.6, 0.34, 23], [0.6, 0.68, 23], [0.58, 0.68, 34], [0.58, 0.34, 34]]); fs('rgba(170,220,240,.55)', '#3a3a30', 1.2);
      // roll bar + lights
      ipath([[0.24, 0.34, 23], [0.24, 0.34, 40], [0.24, 0.68, 40], [0.24, 0.68, 23]], true); fs(null, '#2a2a28', 2.4);
      for (let i = 0; i < 3; i++) { const p = P(0.24, 0.42 + i * 0.09, 41); ell(p[0], p[1], 2, 1.6); fs('#ffe680', '#5a4a10', 0.6); }
      wheel(0.34, 0.7); wheel(0.74, 0.7);
      grassTufts(c[0], c[1] + 8, 50, 5, '#5a9a34', 9);
    },
  });

  def('fountain', {
    W: 2, D: 2, H: 80, park: 'land',
    draw(b) {
      groundShadow(2, 2, 0.8);
      pave(2, 2, 0.06, '#d8cdb4', 5);
      const c = P(1, 1, 3);
      ell(c[0], c[1], 78, 39); fs(null, 'rgba(140,120,90,.4)', 2);
      cyl(c[0], c[1], 64, 14, '#c8bca4', { top: '#d8ceb8', tex: (x, y, R, h) => { for (let i = 0; i < 16; i++) { const q = cylPt(x, y, R, PI * i / 15); line(q[0], q[1], q[0], q[1] - h, 'rgba(90,80,60,.3)', 1); } } });
      ell(c[0], c[1] - 14, 56, 28); fs(lin(0, c[1] - 42, 0, c[1] + 14, [[0, '#4ab0d8'], [1, '#1f6a9a']]));
      ell(c[0], c[1] - 14, 56, 28); fs(null, 'rgba(255,255,255,.35)', 1.2);
      // column + upper bowl
      cyl(c[0], c[1] - 14, 8, 30, '#d8ceb8', {});
      const by = c[1] - 44;
      X.beginPath(); X.moveTo(c[0] - 26, by); X.quadraticCurveTo(c[0] - 18, by + 12, c[0] - 6, by + 12); X.lineTo(c[0] + 6, by + 12); X.quadraticCurveTo(c[0] + 18, by + 12, c[0] + 26, by); X.ellipse(c[0], by, 26, 13, 0, 0, PI);
      X.closePath();
      fs(lin(c[0] - 26, 0, c[0] + 26, 0, [[0, '#a89c84'], [0.7, '#e8e0cc'], [1, '#b8ac94']]), '#6e624c', 1.2);
      ell(c[0], by, 26, 13); fs('#e0d6c0', '#6e624c', 1.2);
      ell(c[0], by, 22, 10.5); fs(lin(0, by - 10, 0, by + 10, [[0, '#6ac8e8'], [1, '#2a80b0']]));
      cyl(c[0], by, 4.5, 16, '#d8ceb8', {});
      ell(c[0], by - 20, 6, 6); fs(rad(c[0] - 2, by - 22, 0.5, 7, [[0, '#ffffff'], [1, '#b8ac94']]), '#6e624c', 1);
      // fern pots at the corners
      for (const [u, v] of [[0.25, 0.25], [1.75, 0.25], [0.25, 1.75], [1.75, 1.75]]) { const p = P(u, v, 3); cyl(p[0], p[1], 8, 9, '#b0603a', { top: '#5a3a20' }); fern(p[0], p[1] - 9, 15, '#4f9a34', u * 10 + v, 6); }
    },
    anim(b) {
      const t = b.t, c = P(1, 1, 3), by = c[1] - 44;
      // central jets
      for (let i = 0; i < 6; i++) {
        const a = i / 6 * TAU + 0.3;
        for (let k = 0; k < 6; k++) {
          const p = fract(t * 1.1 + k / 6 + i * 0.1);
          const x = c[0] + Math.cos(a) * 18 * p, y = by - 24 - Math.sin(p * PI) * 10 + Math.sin(a) * 9 * p + p * 22;
          ell(x, y, 1.4, 1.8); X.fillStyle = `rgba(220,245,255,${0.9 - p * 0.4})`; X.fill();
        }
      }
      // water curtain from the upper bowl
      for (let i = 0; i < 9; i++) {
        const a = PI * (0.05 + i * 0.112), x = c[0] + Math.cos(a) * 25, y0 = by + Math.sin(a) * 12.5;
        const ph = fract(t * 1.5 + i * 0.3);
        X.strokeStyle = 'rgba(200,240,255,.6)'; X.lineWidth = 1.4;
        X.beginPath(); X.moveTo(x, y0); X.quadraticCurveTo(x + Math.cos(a) * 8, y0 + 6, x + Math.cos(a) * 12, y0 + 28); X.stroke();
        ell(x + Math.cos(a) * 12, y0 + 28 - ph * 26, 1.2, 1.6); X.fillStyle = 'rgba(255,255,255,.8)'; X.fill();
      }
      // ripples in the basin
      for (let i = 0; i < 4; i++) {
        const k = fract(t * 0.4 + i / 4);
        ell(c[0], c[1] - 14, 26 + k * 28, (26 + k * 28) * 0.5); fs(null, `rgba(255,255,255,${0.45 * (1 - k)})`, 1);
      }
      sparkle(c[0] + Math.sin(t) * 30, c[1] - 14 + Math.cos(t * 1.3) * 10, 3, 0.5 + 0.5 * Math.sin(t * 5), '#ffffff');
    },
  });

  def('statue_rex', {
    W: 2, D: 2, H: 140, park: 'land',
    draw(b) {
      groundShadow(2, 2, 0.85);
      pave(2, 2, 0.06, '#d4c8ae', 3);
      for (const [u, v] of [[0.2, 1.0], [1.0, 1.8], [1.8, 1.0]]) bush(...P(u, v, 3), 9, '#4f9a34', u * 7 + v, ['#ff5a6a', '#ffd23a']);
      box(0.36, 0.36, 1.64, 1.64, 3, 12, '#a89c84', { tex: TX.stones(5, 7) });
      box(0.52, 0.52, 1.48, 1.48, 12, 38, '#d8d0bc', { tex: TX.panels(46, 0) });
      box(0.47, 0.47, 1.53, 1.53, 38, 43, '#bcb29a', {});
      signL(1.49, 1.0, 26, 56, 12, 'ROI DES DINOS', 'stone', 6.5);
      const img = creatureImg('tyrannosaurus', { scale: 0.36, stage: 3, facing: -1, pose: 'roar', tint: 'bronze', t: 0.5 });
      const p = P(1.0, 1.0, 43);
      if (!drawCreatureImg(img, p[0] + 6, p[1])) { cone(p[0], p[1], 16, 60, '#c09040'); }
      // spotlights
      for (const [u, v] of [[1.7, 1.7], [0.3, 1.7]]) { const q = P(u, v, 3); box(u - 0.05, v - 0.05, u + 0.05, v + 0.05, 3, 6, '#3a3a3a', {}); ell(q[0], q[1] - 8, 2.5, 2); fs('#fff6c8', '#333', 0.6); }
    },
    anim(b) {
      const p = P(1.0, 1.0, 43), t = b.t;
      for (let i = 0; i < 2; i++) { const k = fract(t * 0.3 + i * 0.5); sparkle(p[0] - 30 + i * 40 + k * 10, p[1] - 30 - i * 20, 4.5, Math.sin(k * PI) * 0.9, '#fff8d8'); }
    },
  });

  // ================================================================ SEA (underwater park)
  const S = {
    sand: '#d9cc9c', rockS: '#7f9498', coral: '#ff7a6a', coralO: '#ff9a3a', coralP: '#b060d0', metal: '#8fa2b0', brass: '#d0a040',
    glass: '#7fe0f0', teal: '#2f9aa8', red: '#d8342a', white: '#eef4f4', navy: '#1f3a5a', yellow: '#f0c020',
  };
  /** Sandy seabed pad with ripples and a few shells. */
  function seabed(W, D, inset, seed) {
    groundShadow(W, D, 0.95);
    box(inset, inset, W - inset, D - inset, 0, 3, S.sand, {
      stroke: '#a8986a',
      texTop: () => {
        X.strokeStyle = 'rgba(160,140,90,.45)'; X.lineWidth = 0.02;
        for (let i = 0; i < 7 * W; i++) { const u = inset + hash(i, seed) * (W - 2 * inset), v = inset + hash(i + 9, seed) * (D - 2 * inset); X.beginPath(); X.arc(u, v, 0.12, 0.3, 1.6); X.stroke(); }
      },
    });
    for (let i = 0; i < W + D; i++) {
      const p = P(inset + 0.1 + hash(i, seed + 3) * (W - 2 * inset - 0.2), inset + 0.1 + hash(i, seed + 7) * (D - 2 * inset - 0.2), 3);
      if (i % 3 === 0) starfish(p[0], p[1], 3.5, i % 2 ? '#ff7a4a' : '#e8506a');
      else { ell(p[0], p[1], 2.2, 1.4); fs(i % 2 ? '#f4e8d8' : '#f0c8c0', '#8a7a5a', 0.5); }
    }
  }
  function starfish(x, y, r, col) {
    const pts = [];
    for (let i = 0; i < 10; i++) { const rr = i % 2 ? r * 0.4 : r, a = -PI / 2 + i * PI / 5; pts.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.55]); }
    spath(pts); fs(col, shade(col, -0.45), 0.6);
  }
  /** Brass porthole in the current plane, centre (x, y). */
  function porthole(x, y, r, lit) {
    ell(x, y, r + 1.8, r + 1.8); fs(lin(x - r, y - r, x + r, y + r, [[0, '#ffe08a'], [1, '#8a6018']]), '#4a3008', 0.8);
    ell(x, y, r, r);
    fs(lit ? rad(x - r * 0.3, y - r * 0.3, 0.5, r * 1.2, [[0, '#e8ffff'], [0.5, '#6ff0ff'], [1, '#1a8aa8']]) : lin(x - r, y - r, x + r, y + r, [[0, '#b8f0ff'], [1, '#1f5a7a']]));
    ell(x - r * 0.35, y - r * 0.35, r * 0.3, r * 0.22); fs('rgba(255,255,255,.7)');
  }
  /** Kelp strand from (x, y) up h px (static). */
  function kelpStrand(x, y, h, col, seed) {
    X.beginPath(); X.moveTo(x, y);
    for (let j = 1; j <= 8; j++) X.lineTo(x + Math.sin(j * 0.9 + seed) * 4, y - h * j / 8);
    X.strokeStyle = shade(col, -0.3); X.lineWidth = 1.8; X.stroke();
    for (let j = 1; j <= 7; j++) {
      const px = x + Math.sin(j * 0.9 + seed) * 4, py = y - h * j / 8, sd = j % 2 ? 1 : -1;
      ell(px + sd * 5, py + 2, 6, 2.2, sd * 0.6 - 0.2); fs(shade(col, (j % 3) * 0.06), shade(col, -0.35), 0.6);
    }
  }
  function coralClump(x, y, s, seed) {
    coralBranch(x - s * 0.3, y, s, '#ff8a3a', seed);
    coralBranch(x + s * 0.35, y + 1, s * 0.8, '#ff6a8a', seed + 1);
    ell(x, y + 1, s * 0.35, s * 0.2); fs('#b060d0', '#5a2a6a', 0.7);
  }
  /** Scallop shell emblem centred at (x, y). */
  function scallop(x, y, r) {
    X.beginPath(); X.moveTo(x, y + r * 0.7);
    for (let i = 0; i <= 8; i++) { const a = PI + 0.25 + i / 8 * (PI - 0.5); X.lineTo(x + Math.cos(a) * r, y - r * 0.15 + Math.sin(a) * r * 0.95); }
    X.closePath();
    fs(rad(x, y - r * 0.4, 1, r * 1.1, [[0, '#fff2d8'], [0.6, '#ffb070'], [1, '#e0703a']]), '#7a3a10', 1);
    for (let i = 1; i < 8; i++) { const a = PI + 0.25 + i / 8 * (PI - 0.5); line(x, y + r * 0.6, x + Math.cos(a) * r * 0.92, y - r * 0.15 + Math.sin(a) * r * 0.88, 'rgba(122,58,16,.5)', 0.8); }
    spath([[x - r * 0.35, y + r * 0.5], [x + r * 0.35, y + r * 0.5], [x + r * 0.2, y + r * 0.8], [x - r * 0.2, y + r * 0.8]]); fs('#f0a060', '#7a3a10', 0.8);
  }
  function seaPillar(u0, v0) {
    const u1 = u0 + 0.56, v1 = v0 + 0.64;
    box(u0 - 0.04, v0 - 0.04, u1 + 0.04, v1 + 0.04, 0, 12, '#6a7e84', { tex: TX.stones(6, 8) });
    box(u0, v0, u1, v1, 12, 100, '#8a9ea2', { tex: TX.stones(11, u0 * 10 + 1) });
    onL(v1, u0, () => { porthole(13, -40, 5.5, true); porthole(13, -74, 5.5, true); });
    onR(u1, v1, () => porthole(15, -58, 5, true));
    // rocky crown with coral
    const c = P(u0 + 0.28, v0 + 0.32, 100);
    rock(c[0] - 6, c[1] + 2, 14, 10, '#7a9094', u0 * 3 + 1); rock(c[0] + 8, c[1] + 4, 11, 8, '#86989a', u0 * 3 + 2);
    coralBranch(c[0] - 4, c[1] - 4, 16, '#ff8a3a', u0 * 5 + 1);
    coralBranch(c[0] + 9, c[1], 12, '#ff5a8a', u0 * 5 + 2);
    // coral growing on the faces
    const lp = P(u0 + 0.1, v1, 22); coralBranch(lp[0], lp[1], 12, '#ff7a6a', u0 + 7);
    const rp = P(u1, v0 + 0.2, 64); ell(rp[0], rp[1], 7, 3.5); fs('#b060d0', '#5a2a6a', 0.8);
    for (let i = 0; i < 4; i++) { const q = P(u0 + 0.05 + i * 0.13, v1, 8 + (i % 2) * 30); ell(q[0], q[1], 2.2, 1.8); fs('#e8e0d0', '#6a6458', 0.5); }
  }
  def('gate_sea', {
    W: 3, D: 2, H: 150, park: 'sea',
    draw(b) {
      seabed(3, 2, 0.02, 3);
      for (const [u, v, h, s] of [[0.15, 0.3, 50, 1], [2.85, 0.4, 44, 2], [0.75, 0.25, 36, 3]]) kelpStrand(...P(u, v, 3), h, '#5a8a2a', s);
      seaPillar(0.02, 0.68);
      // arch (extruded)
      const cx = 72, cy = -60;
      const archPath = () => { X.beginPath(); X.arc(cx, cy, 66, PI + 0.12, -0.12); X.lineTo(cx + 66 * Math.cos(-0.12), -60); X.lineTo(cx + 46, -60); X.arc(cx, cy, 46, 0, PI, true); X.lineTo(cx - 66 * Math.cos(-0.12), -60); X.closePath(); };
      const archShape = () => { X.beginPath(); X.moveTo(cx - 64, -96); X.arc(cx, cy - 8, 64, PI + 0.6, -0.6); X.lineTo(cx + 64, -96); X.lineTo(cx + 46, -96); X.arc(cx, cy - 8, 42, -0.25, PI + 0.25, true); X.closePath(); };
      extrudeL(0.82, 1.18, 0, 6, (k) => {
        archShape();
        if (k < 1) fs('#5a6e74');
        else {
          fs(lin(0, -140, 0, -96, [[0, '#a8bcbe'], [1, '#7a9094']]), '#3a4a50', 1.2);
          X.save(); archShape(); X.clip();
          for (let i = 0; i < 9; i++) { const a = PI + 0.6 + i * (PI - 1.2) / 8; line(cx + Math.cos(a) * 42, cy - 8 + Math.sin(a) * 42, cx + Math.cos(a) * 66, cy - 8 + Math.sin(a) * 66, 'rgba(40,60,66,.45)', 1); }
          X.restore();
        }
      });
      seaPillar(2.42, 0.68);
      onL(1.18, 0, () => {
        scallop(cx, -136, 13);
        coralBranch(cx - 40, -116, 13, '#ff6a8a', 4); coralBranch(cx + 44, -112, 11, '#ff9a3a', 5);
        ell(cx + 26, -126, 6, 3); fs('#b060d0', '#5a2a6a', 0.8);
        // hanging sign
        line(cx - 30, -112, cx - 30, -96, '#c8a040', 1.2); line(cx + 30, -112, cx + 30, -96, '#c8a040', 1.2);
        board(cx, -88, 92, 17, 'CRÉTACÉ PARK', 'navy', 12);
        board(cx, -72, 38, 9, 'LAGON', 'cream', 7);
      });
      coralClump(...P(0.3, 1.7, 3), 14, 2); coralClump(...P(2.75, 1.75, 3), 12, 6);
      for (const [u, v] of [[0.7, 1.85], [2.3, 1.85]]) rock(...P(u, v, 3), 7, 5, '#7a9094', u * 4);
    },
    anim(b) {
      const t = b.t;
      // bubble curtain in the gateway
      onL(1.0, 0, () => {
        X.save(); X.globalCompositeOperation = 'lighter';
        X.fillStyle = lin(0, -90, 0, 0, [[0, 'rgba(120,230,255,0)'], [1, 'rgba(120,230,255,.18)']]); X.fillRect(30, -88, 70, 88);
        X.restore();
        for (let i = 0; i < 7; i++) bubbles(35 + i * 10, 0, t, { n: 3, h: 88, spread: 6, seed: i + 1, speed: 0.35, r: 1.8 });
      });
      for (const u of [0.3, 2.7]) { const p = P(u, 1.0, 112); bubbles(p[0], p[1], t, { n: 4, h: 45, spread: 10, seed: u * 3, speed: 0.25 }); }
      // porthole pulse
      for (const [u, z] of [[0.15, 40], [0.15, 74], [2.55, 40], [2.55, 74]]) { const p = P(u, 1.32, z); glow(p[0], p[1], 10, '#6ff0ff', 0.25 + 0.15 * Math.sin(t * 2 + u + z)); }
      fishLoop(...P(1.5, 1.0, 120), 60, 14, t, 3, null, 0.5, 2);
    },
  });

  def('lab_sea', {
    W: 3, D: 3, H: 150, park: 'sea',
    draw(b) {
      seabed(3, 3, 0.04, 5);
      // tower module (back right)
      const tp = P(2.4, 0.6, 3);
      cyl(tp[0], tp[1], 22, 92, '#e8ecea', {
        tex: (x, y, R, h) => { for (const z of [18, 50, 82]) { X.fillStyle = '#f0c020'; X.beginPath(); X.ellipse(x, y - z, R, R / 2, 0, 0, PI); X.ellipse(x, y - z - 5, R, R / 2, 0, PI, 0, true); X.fill(); } for (const z of [34, 66]) for (const a of [0.9, 1.6, 2.3]) { const q = cylPt(x, y, R, a, z); porthole(q[0], q[1], 3.6 * Math.sin(a), true); } },
        top: '#c8d0d4',
      });
      dome(tp[0], tp[1] - 92, 22, 12, '#d8e0e4');
      const am = [tp[0], tp[1] - 104]; line(am[0], am[1], am[0], am[1] - 22, '#5a6268', 1.6);
      // connecting tube
      const a1 = P(2.2, 0.9, 22), a2 = P(1.75, 1.2, 22);
      line(a1[0], a1[1], a2[0], a2[1], '#4a5a64', 13); line(a1[0], a1[1], a2[0], a2[1], '#a8b8c0', 10); line(a1[0], a1[1] - 3, a2[0], a2[1] - 3, 'rgba(255,255,255,.5)', 2);
      // main dome
      const c = P(1.35, 1.45, 3);
      cyl(c[0], c[1], 70, 14, S.metal, { top: '#d8e4e8', tex: (x, y, R, h) => { for (let i = 0; i < 9; i++) { const a = PI * (i + 0.5) / 9, q = cylPt(x, y, R, a, 7); ell(q[0], q[1], 2.6 * Math.sin(a) + 0.4, 2.6); fs('#ffe680'); } } });
      // interior
      const fy = c[1] - 14;
      ell(c[0], fy, 64, 32); fs('#c8dce0');
      for (const [dx, dy] of [[-36, -6], [30, -10], [-18, 12], [24, 12]]) { X.fillStyle = '#5a6a78'; X.fillRect(c[0] + dx - 8, fy + dy - 9, 16, 9); X.fillStyle = '#7ff0ff'; X.fillRect(c[0] + dx - 6, fy + dy - 8, 12, 4); }
      cyl(c[0], fy + 2, 12, 6, '#5a6a78', { top: '#2a3a48' });
      ell(c[0], fy - 4, 9, 4.5); fs('rgba(120,240,255,.6)');
      // glass dome
      domePath(c[0], fy, 66, 62);
      fs(rad(c[0] + 22, fy - 44, 4, 80, [[0, 'rgba(230,255,255,.55)'], [0.5, 'rgba(110,220,240,.28)'], [1, 'rgba(40,140,180,.45)']]), '#2a6a7a', 1.6);
      domeRibs(c[0], fy, 66, 62, 7, 4, 'rgba(60,110,130,.75)', 1.4);
      X.save(); domePath(c[0], fy, 66, 62); X.clip();
      X.beginPath(); X.ellipse(c[0] + 26, fy - 40, 10, 22, 0.5, 0, TAU); X.fillStyle = 'rgba(255,255,255,.35)'; X.fill();
      X.restore();
      // small airlock module (front left)
      const mp = P(0.55, 2.35, 3);
      cyl(mp[0], mp[1], 18, 24, '#e8ecea', { top: '#c8d0d4', tex: (x, y, R, h) => { X.fillStyle = '#f0c020'; X.fillRect(x - R, y - 8, R * 2, 3); } });
      const hp = cylPt(mp[0], mp[1], 18, PI * 0.5, 14); porthole(hp[0], hp[1], 5, false);
      // sign
      const sg = P(2.4, 2.5, 3);
      for (const dx of [-16, 16]) { X.fillStyle = '#4a5a64'; X.fillRect(sg[0] + dx - 1.2, sg[1] - 24, 2.4, 24); }
      board(sg[0], sg[1] - 28, 60, 14, 'LABO ADN', 'neon', 10);
      coralClump(...P(0.3, 0.4, 3), 14, 3); coralClump(...P(2.7, 1.8, 3), 13, 8);
      kelpStrand(...P(0.2, 1.2, 3), 46, '#5a8a2a', 2);
    },
    anim(b) {
      const t = b.t, c = P(1.35, 1.45, 17);
      // hologram DNA inside the dome
      glow(c[0], c[1] - 26, 34, '#40e0ff', 0.18 + 0.06 * Math.sin(t * 2));
      dnaHelix(c[0], c[1] - 50, 42, 6, t);
      // sonar dish on the tower
      const tp = P(2.4, 0.6, 3), a = t * 1.1, ca = Math.cos(a), rx = 2 + 10 * Math.abs(ca);
      ell(tp[0] + 10, tp[1] - 104, rx, 7); fs(ca > 0 ? '#e8eef0' : '#8a98a0', '#3a4a54', 1);
      const on = Math.sin(t * 3) > 0.3;
      ell(tp[0], tp[1] - 127, 2, 2); fs(on ? '#ff4a3a' : '#7a2018'); if (on) glow(tp[0], tp[1] - 127, 8, '#ff4a3a', 0.6);
      bubbles(tp[0] - 5, tp[1] - 108, t, { n: 5, h: 50, spread: 8, seed: 3 });
      bubbles(c[0] - 20, c[1] - 70, t, { n: 4, h: 40, spread: 20, seed: 7, speed: 0.22 });
    },
  });

  def('arena_sea', {
    W: 4, D: 4, H: 175, park: 'sea',
    draw(b) {
      arena(b, {
        wall: '#f0eeea', rim: '#ffffff', riser: '#9aa4ac', floor: '#e0d4a0', h: 50,
        tiers: ['#d8dee2', '#c83a32', '#d8dee2', '#c83a32'],
        crowd: ['#ffffff', '#2f7ae0', '#f0c030', '#ff6a5a', '#3fd0c0', '#ff9a2a'],
        base(cx, cy, R) { ell(cx, cy + 2, R + 10, (R + 10) * 0.5); fs('#d0c494', '#8a7e58', 1.2); },
        wallTex: (cx, cy, R, h) => {
          for (let i = 0; i < 20; i++) {
            if (i % 2) continue;
            const a0 = PI * i / 20, a1 = PI * (i + 1) / 20;
            const p0 = cylPt(cx, cy, R, a0), p1 = cylPt(cx, cy, R, a1);
            spath([p0, p1, [p1[0], p1[1] - h], [p0[0], p0[1] - h]]); fs('#d8342a');
          }
          X.beginPath(); X.ellipse(cx, cy - h + 8, R, R * 0.5, 0, 0, PI); fs(null, 'rgba(0,0,0,.2)', 3);
          for (let i = 0; i < 14; i++) { const a = PI * (i + 0.5) / 14, q = cylPt(cx, cy, R, a, 20); ell(q[0], q[1], 3 * Math.sin(a) + 0.5, 3); fs('#2a4a6a'); }
        },
        floorDeco(x, y, r) {
          X.save(); X.translate(x, y); X.scale(1, 0.5);
          X.beginPath(); X.arc(0, 0, r * 0.86, 0, TAU); X.strokeStyle = 'rgba(40,140,200,.55)'; X.lineWidth = 5; X.stroke();
          X.beginPath(); X.arc(0, 0, r * 0.3, 0, TAU); X.strokeStyle = 'rgba(200,52,42,.55)'; X.lineWidth = 3; X.stroke();
          X.restore();
          scallop(x, y + 2, 12);
        },
        poles: [PI * 1.2, PI * 1.8, PI * 0.1, PI * 0.9],
        pole(x, y) {
          X.fillStyle = lin(x - 2, 0, x + 2, 0, [[0, '#6a7680'], [1, '#c8d0d6']]); X.fillRect(x - 2, y - 62, 4, 62);
          X.fillStyle = '#3a4650'; X.fillRect(x - 10, y - 72, 20, 10);
          for (let i = 0; i < 3; i++) { ell(x - 6 + i * 6, y - 67, 2.4, 2.4); fs('#fff8d0'); }
        },
        gate(cx, cy, R, h) {
          box(3.18, 3.18, 3.78, 3.78, 0, 60, '#e8ecee', { tex: TX.panels(10) });
          onL(3.78, 3.18, () => door(6, -40, 17, 37, '#c8d0d6', { glass: true }));
          onR(3.78, 3.78, () => door(6, -40, 17, 37, '#c8d0d6', { glass: true }));
          box(3.12, 3.12, 3.84, 3.84, 60, 66, '#d8342a', {});
          const p = P(3.78, 3.78, 0);
          for (const dx of [-20, 20]) { X.fillStyle = '#6a7680'; X.fillRect(p[0] + dx - 1.5, p[1] - 86, 3, 14); }
          board(p[0], p[1] - 92, 66, 16, 'ARÈNE', 'red', 12);
        },
      });
    },
    anim(b) {
      const c = P(2, 2, 0), R = 145, h = 50, t = b.t;
      for (const a of [PI * 1.2, PI * 1.8, PI * 0.1, PI * 0.9]) { const x = c[0] + Math.cos(a) * R, y = c[1] - h + Math.sin(a) * R * 0.5 - 67; glow(x, y, 22, '#fff8c0', 0.28 + 0.06 * Math.sin(t * 3 + a)); }
      bubbles(c[0] - 60, c[1] - 30, t, { n: 5, h: 90, spread: 40, seed: 2, speed: 0.2 });
      bubbles(c[0] + 70, c[1] - 20, t, { n: 4, h: 80, spread: 30, seed: 5, speed: 0.18 });
      for (let i = 0; i < 3; i++) {
        const p = fract(t * 0.7 + i * 0.37);
        if (p > 0.12) continue;
        const a = PI + 0.3 + hash(Math.floor(t * 0.7 + i * 0.37), i) * (PI - 0.6), rr = 110 - (i % 3) * 14;
        sparkle(c[0] + Math.cos(a) * rr, c[1] - 42 + Math.sin(a) * rr * 0.5, 5, 1 - p / 0.12, '#ffffff');
      }
    },
  });

  // ---------------------------------------------------------------- sea food buildings
  /** Round net cage (static part). */
  function netCage(x, y, R, h, fishN, seed, front) {
    if (!front) {
      ell(x, y, R, R * 0.5); fs('rgba(20,70,110,.55)', '#1a4a6a', 1);
      // back mesh
      X.strokeStyle = 'rgba(230,240,240,.35)'; X.lineWidth = 0.8;
      for (let i = 0; i <= 12; i++) { const a = PI + PI * i / 12, q = cylPt(x, y, R, a); X.beginPath(); X.moveTo(q[0], q[1]); X.lineTo(q[0], q[1] - h); X.stroke(); }
      for (let z = 6; z < h; z += 7) { X.beginPath(); X.ellipse(x, y - z, R, R * 0.5, 0, PI, TAU); X.stroke(); }
      ell(x, y - h * 0.4, R * 0.9, R * 0.42); fs('rgba(60,150,200,.2)');
    } else {
      X.strokeStyle = 'rgba(240,248,248,.6)'; X.lineWidth = 0.9;
      for (let i = 0; i <= 12; i++) { const a = PI * i / 12, q = cylPt(x, y, R, a); X.beginPath(); X.moveTo(q[0], q[1]); X.lineTo(q[0], q[1] - h); X.stroke(); }
      for (let z = 6; z < h; z += 7) { X.beginPath(); X.ellipse(x, y - z, R, R * 0.5, 0, 0, PI); X.stroke(); }
      for (const a of [0.1, PI / 2, PI - 0.1]) { const q = cylPt(x, y, R, a); line(q[0], q[1] + 1, q[0], q[1] - h - 2, '#5a6a70', 2); }
      // float ring
      X.beginPath(); X.ellipse(x, y - h, R, R * 0.5, 0, 0, TAU); X.strokeStyle = '#2a3a40'; X.lineWidth = 5; X.stroke();
      X.strokeStyle = '#f08a2a'; X.lineWidth = 3.4; X.stroke();
      for (let i = 0; i < 10; i++) { const a = i / 10 * TAU, q = cylPt(x, y, R, a, h); ell(q[0], q[1], 3.2, 2.4); fs(i % 2 ? '#ffd23a' : '#ffffff', '#5a4a1a', 0.6); }
    }
  }
  def('fish_farm', {
    W: 2, D: 2, H: 75, park: 'sea', grow: true,
    draw(b) {
      seabed(2, 2, 0.05, 8);
      const c1 = P(1.38, 0.6, 3), c2 = P(0.6, 1.36, 3);
      // wooden pontoon from the feeder, between the two cages, to the front platform
      const wood = '#9a7048';
      ipath([[0.42, 0.56, 3], [0.56, 0.42, 3], [1.58, 1.44, 3], [1.44, 1.58, 3]]); fs(shade(wood, -0.35));
      ipath([[0.42, 0.56, 6], [0.56, 0.42, 6], [1.58, 1.44, 6], [1.44, 1.58, 6]]); fs(wood, ink(wood), 0.8);
      X.beginPath();
      for (let k = 0.5; k < 1.52; k += 0.075) { const a = P(k - 0.07, k + 0.07, 6), c = P(k + 0.07, k - 0.07, 6); X.moveTo(a[0], a[1]); X.lineTo(c[0], c[1]); }
      X.strokeStyle = rgba(ink(wood), 0.5); X.lineWidth = 0.7; X.stroke();
      for (const k of [0.75, 1.05, 1.35]) for (const [du, dv] of [[-0.08, 0.08], [0.08, -0.08]]) { const q = P(k + du, k + dv, 3); X.fillStyle = '#5a3a20'; X.fillRect(q[0] - 1, q[1] - 2, 2, 5); }
      // feeder unit
      box(0.18, 0.18, 0.5, 0.5, 3, 24, '#e8ecea', { tex: TX.panels(8) });
      onL(0.5, 0.18, () => { X.fillStyle = '#f0c020'; X.fillRect(0, -16, 0.32 * HX, 3); porthole(7.7, -10, 3, true); });
      const f1 = P(0.34, 0.34, 24);
      line(f1[0], f1[1], c1[0] - 14, c1[1] - 38, '#4a5a64', 3); line(f1[0], f1[1], c2[0] + 8, c2[1] - 34, '#4a5a64', 3);
      netCage(c1[0], c1[1], 32, 34, 0, 1, false); netCage(c1[0], c1[1], 32, 34, 0, 1, true);
      netCage(c2[0], c2[1], 30, 30, 0, 2, false); netCage(c2[0], c2[1], 30, 30, 0, 2, true);
      // front platform: fish-food barrels, net basket and the sign
      box(1.4, 1.4, 1.9, 1.9, 3, 7, wood, { tex: TX.planks(4, 5), texTop: () => { X.strokeStyle = rgba(ink(wood), 0.45); X.lineWidth = 0.02; for (let v = 1.48; v < 1.9; v += 0.08) { X.beginPath(); X.moveTo(1.42, v); X.lineTo(1.88, v); X.stroke(); } } });
      barrel(...P(1.52, 1.5, 7), 5, 11, '#2f7aa8'); barrel(...P(1.66, 1.48, 7), 5, 11, '#e8b830');
      const bk = P(1.56, 1.72, 7); ell(bk[0], bk[1] - 4, 7, 4.5); fs(lin(bk[0] - 7, 0, bk[0] + 7, 0, [[0, '#8a6a3a'], [1, '#d0b070']]), '#4a3418', 0.8);
      for (let k = 0; k < 3; k++) miniFish(bk[0] - 3 + k * 3, bk[1] - 7 - (k % 2), 2.6, k % 2 ? 1 : -1, ['#ffb03a', '#4fc0e8', '#ff6a5a'][k], k);
      const sg = P(1.86, 1.86, 7);
      for (const dx of [-13, 13]) { X.fillStyle = '#4a5a64'; X.fillRect(sg[0] + dx - 1, sg[1] - 14, 2, 14); }
      board(sg[0], sg[1] - 18, 48, 12, 'POISSONS', 'navy', 8.5);
      coralClump(...P(1.84, 1.0, 3), 10, 4); coralClump(...P(0.25, 1.85, 3), 8, 7);
    },
    anim(b) {
      const t = b.t, n = 2 + Math.round(5 * b.g);
      for (const [u, v, R, h] of [[1.38, 0.6, 32, 34], [0.6, 1.36, 30, 30]]) {
        const c = P(u, v, 3);
        X.save(); X.beginPath(); X.rect(c[0] - R, c[1] - h, R * 2, h + R * 0.5); X.clip();
        fishLoop(c[0], c[1] - h * 0.45, R * 0.75, R * 0.28, t, n, null, 0.9, u * 10);
        X.restore();
        cachedLayer('fishnet' + u, [c[0] - R - 6, c[1] - h - 8, c[0] + R + 6, c[1] + R * 0.5 + 4], () => netCage(c[0], c[1], R, h, 0, 1, true));
      }
      const f = P(1.38, 0.6, 38); bubbles(f[0] - 14, f[1] - 2, t, { n: 4, h: 30, spread: 6, seed: 3 });
    },
  });
  def('krill_net', {
    W: 2, D: 2, H: 130, park: 'sea', grow: true,
    draw(b) {
      seabed(2, 2, 0.05, 11);
      const wood = '#8a6440', g = b.g;
      // wooden gantry (back) with a winch
      for (const u of [0.24, 1.46]) box(u, 0.48, u + 0.12, 0.6, 3, 92, wood, { tex: TX.planks(30, 3) });
      for (const [ua, ub] of [[0.36, 0.62], [1.2, 1.46]]) {
        const a = P(ua === 0.36 ? ua : ub, 0.54, ua === 0.36 ? 40 : 40), c = P(ua === 0.36 ? ub : ua, 0.54, 84);
        X.beginPath(); X.moveTo(a[0], a[1]); X.lineTo(c[0], c[1]); X.strokeStyle = shade(wood, -0.35); X.lineWidth = 5; X.stroke(); X.strokeStyle = wood; X.lineWidth = 3.4; X.stroke();
      }
      box(0.18, 0.46, 1.64, 0.62, 84, 94, wood, { tex: TX.planks(5, 4) });
      box(0.36, 0.64, 0.62, 0.86, 3, 16, '#5a6a74', {});
      const wp = P(0.49, 0.75, 16);
      ell(wp[0], wp[1] - 5, 8, 5.5); fs(lin(wp[0] - 8, 0, wp[0] + 8, 0, [[0, '#6a5a3a'], [1, '#c0a070']]), '#3a2a10', 1);
      // net bag hanging from the beam, filled with krill as production grows
      const top = P(0.95, 0.54, 84), bx = top[0], by = top[1];
      line(bx, by, bx, by + 22, '#d8c8a0', 1.6);
      line(wp[0], wp[1] - 8, ...P(0.3, 0.54, 86), '#d8c8a0', 1);
      const bagPath = () => {
        X.beginPath(); X.moveTo(bx - 8, by + 22);
        X.bezierCurveTo(bx - 34, by + 34, bx - 34, by + 76, bx, by + 80);
        X.bezierCurveTo(bx + 34, by + 76, bx + 34, by + 34, bx + 8, by + 22); X.closePath();
      };
      bagPath(); fs('rgba(30,80,110,.3)');
      X.save(); bagPath(); X.clip();
      const lvl = by + 80 - (12 + g * 50);
      X.beginPath(); X.moveTo(bx - 40, by + 90); X.lineTo(bx - 40, lvl + 4); X.quadraticCurveTo(bx, lvl - 6, bx + 40, lvl + 4); X.lineTo(bx + 40, by + 90); X.closePath();
      fs(lin(0, lvl, 0, by + 80, [[0, '#ffb8c4'], [0.5, '#ff7a90'], [1, '#d8405a']]));
      const rr = H.rng(5);
      for (let i = 0; i < 70; i++) { const x = bx - 30 + rr() * 60, y = lvl + rr() * 60; ell(x, y, 1.6, 0.9, rr() * 3); fs(i % 3 ? '#ff8a9a' : '#ffe0e6'); }
      X.strokeStyle = 'rgba(245,240,225,.8)'; X.lineWidth = 0.8;
      for (let x = -80; x < 80; x += 6) { X.beginPath(); X.moveTo(bx + x, by + 18); X.lineTo(bx + x + 64, by + 82); X.moveTo(bx + x, by + 18); X.lineTo(bx + x - 64, by + 82); X.stroke(); }
      X.restore();
      bagPath(); fs(null, '#cfc29c', 1.6);
      ell(bx, by + 22, 9, 3); fs('#e8742a', '#5a2a0a', 1);
      // round krill tank in front (static part: rim + swirling pink water)
      const tc = P(1.32, 1.28, 3);
      cyl(tc[0], tc[1], 26, 14, '#4f7a8c', {
        top: false,
        tex: (x, y, R, h) => { for (let i = 0; i < 9; i++) { const q = x - R + (i + 0.5) * R * 2 / 9; line(q, y - h, q, y + 12, 'rgba(255,255,255,.18)', 1); } },
      });
      ell(tc[0], tc[1] - 14, 26, 13); fs('#2a4a5a', '#1a2e38', 1.2);
      ell(tc[0], tc[1] - 13, 22.5, 11); fs(rad(tc[0], tc[1] - 13, 2, 23, [[0, '#ff9aac'], [0.7, '#e8607a'], [1, '#8a3a5a']]));
      X.beginPath(); X.ellipse(tc[0], tc[1] - 14, 26, 13, 0, 0, TAU); X.strokeStyle = '#f0c020'; X.lineWidth = 2; X.stroke();
      // barrels of krill (more when production is ready)
      const nb = 1 + Math.round(2 * g);
      for (let i = 0; i < nb; i++) { const p = P(0.35 + i * 0.28, 1.55 + (i % 2) * 0.14, 3); barrel(p[0], p[1], 6.5, 13, '#7a5a3a'); ell(p[0], p[1] - 13, 5, 2.4); fs('#ff7a8a'); }
      signL(0.62, 0.66, 89, 42, 13, 'KRILL', 'navy', 9.5);
      coralClump(...P(1.8, 1.55, 3), 10, 6);
    },
    anim(b) {
      const t = b.t, tc = P(1.32, 1.28, 16);
      // swirling krill in the tank
      for (let i = 0; i < 16; i++) {
        const a = t * (0.6 + hash(i, 2) * 0.6) + i * 2.4, r = 4 + hash(i, 7) * 16;
        ell(tc[0] + Math.cos(a) * r, tc[1] + 3 + Math.sin(a) * r * 0.48, 1.6, 0.9, a); X.fillStyle = i % 3 ? 'rgba(255,220,228,.9)' : 'rgba(255,120,150,.9)'; X.fill();
      }
      bubbles(tc[0], tc[1] - 2, t, { n: 4, h: 46, spread: 30, seed: 4 });
      // a few krill drifting out of the net bag
      const c = P(0.95, 0.54, 40);
      for (let i = 0; i < 8; i++) {
        const p = fract(t * 0.15 + i / 8);
        const x = c[0] - 30 + hash(i, 3) * 60 + Math.sin(t + i) * 6, y = c[1] + 14 - p * 50;
        ell(x, y, 1.2, 0.8, t + i); X.fillStyle = `rgba(255,140,160,${Math.sin(p * PI) * 0.9})`; X.fill();
      }
    },
  });

  // ---------------------------------------------------------------- sea coin buildings
  def('shell_shop', {
    W: 2, D: 2, H: 115, park: 'sea',
    draw(b) {
      seabed(2, 2, 0.05, 13);
      const c = P(0.92, 0.9, 3);
      // turret shell: stacked whorls
      let y = c[1], r = 48;
      blob(c[0], c[1] + 3, 54, 22, 0.3);
      const whorls = [];
      for (let i = 0; i < 6; i++) { whorls.push([y, r]); y -= r * 0.5; r *= 0.74; }
      whorls.forEach(([wy, wr], i) => {
        X.beginPath(); X.ellipse(c[0], wy, wr, wr * 0.55, 0, 0, PI); X.lineTo(c[0] - wr * 0.78, wy - wr * 0.55); X.ellipse(c[0], wy - wr * 0.5, wr * 0.78, wr * 0.42, 0, PI, 0); X.closePath();
        fs(lin(c[0] - wr, 0, c[0] + wr, 0, [[0, '#d8a888'], [0.6, '#fff0e0'], [1, '#e8b898']]), '#8a5a3a', 1.2);
        X.save(); X.beginPath(); X.ellipse(c[0], wy, wr, wr * 0.55, 0, 0, PI); X.lineTo(c[0] - wr * 0.78, wy - wr * 0.55); X.ellipse(c[0], wy - wr * 0.5, wr * 0.78, wr * 0.42, 0, PI, 0); X.closePath(); X.clip();
        for (let k = 0; k < 7; k++) { const a = PI * (k + 0.5) / 7, x = c[0] + Math.cos(a) * wr; X.beginPath(); X.moveTo(x, wy + Math.sin(a) * wr * 0.55); X.quadraticCurveTo(x - wr * 0.1, wy - wr * 0.2, c[0] + Math.cos(a) * wr * 0.78, wy - wr * 0.5 + Math.sin(a) * wr * 0.42); X.strokeStyle = 'rgba(190,100,60,.45)'; X.lineWidth = wr * 0.08; X.stroke(); }
        X.restore();
      });
      ell(c[0], y + r * 0.2, r * 0.9, r * 0.5); fs('#e8b898', '#8a5a3a', 1);
      // aperture = door
      const dx = c[0] + 14, dy = c[1] - 4;
      X.beginPath(); X.ellipse(dx, dy - 18, 15, 22, -0.25, 0, TAU); fs(lin(dx - 15, 0, dx + 15, 0, [[0, '#ff9ab0'], [1, '#d85a7a']]), '#8a2a4a', 1.4);
      X.beginPath(); X.ellipse(dx + 1, dy - 17, 10, 17, -0.25, 0, TAU); fs('#6a3a1a');
      door(dx - 7, dy - 30, 14, 26, '#a8703a', { arch: true, double: false });
      porthole(c[0] - 26, c[1] - 26, 5, true); porthole(c[0] - 6, c[1] - 58, 4, true);
      // display stand
      const sp = P(1.65, 1.55, 3);
      box(1.48, 1.42, 1.85, 1.7, 3, 14, '#a8703a', { tex: TX.planks(4, 1) });
      for (let i = 0; i < 5; i++) { const q = [sp[0] - 10 + i * 5, sp[1] - 14 - (i % 2) * 2]; if (i % 2) scallop(q[0], q[1] - 2, 3.5); else { ell(q[0], q[1] - 2, 2, 2); fs('#ffffff', '#8a8a8a', 0.5); } }
      awningR(1.85, 1.42, 1.7, 26, 0.12, 5, '#2fa0c8', '#ffffff', 4);
      const sg = P(0.45, 1.7, 3);
      for (const dxx of [-16, 16]) { X.fillStyle = '#a8703a'; X.fillRect(sg[0] + dxx - 1.2, sg[1] - 20, 2.4, 20); }
      board(sg[0], sg[1] - 24, 62, 12, 'COQUILLAGES', 'cream', 7.5);
      coralClump(...P(1.75, 0.35, 3), 12, 9);
    },
    anim(b) {
      const sp = P(1.65, 1.55, 18);
      sparkle(sp[0] - 6 + Math.sin(b.t) * 6, sp[1] - 2, 3.5, 0.5 + 0.5 * Math.sin(b.t * 4), '#ffffff');
      const c = P(0.92, 0.9, 3);
      bubbles(c[0], c[1] - 110, b.t, { n: 4, h: 40, spread: 8, seed: 6 });
    },
  });

  /** Yellow submarine lying along v (bow towards +v) centred on u = uc; z0 = bottom height. */
  function submarine(uc, va, vb, z0, R) {
    const steps = 34;
    for (let i = 0; i <= steps; i++) {
      const f = i / steps, v = lerp(va, vb, f);
      const taper = Math.sqrt(Math.max(0, 1 - Math.pow((f - 0.48) / 0.52, 4)));
      const r = R * (0.25 + 0.75 * taper);
      onL(v, uc, () => {
        ell(0, -z0 - R, r, r);
        if (i === steps) fs(rad(-r * 0.3, -z0 - R - r * 0.3, 0.5, r * 1.1, [[0, '#d8ffff'], [0.5, '#5ad0f0'], [1, '#1a5a7a']]), '#2a3a40', 1.2);
        else fs(lin(0, -z0 - R - r, 0, -z0 - R + r, [[0, '#fff27a'], [0.45, '#f0c020'], [1, '#a87a08']]), i === 0 ? '#5a4008' : null);
      });
    }
    // portholes on the right side
    for (let k = 0; k < 4; k++) { const v = lerp(va, vb, 0.25 + k * 0.15); const q = P(uc + R * 0.75 / HX * 1.0, v, z0 + R * 1.15); ell(q[0], q[1], 3.2, 3.4); fs('#1a5a7a', '#5a4008', 1.2); ell(q[0] - 1, q[1] - 1, 1, 1); fs('rgba(255,255,255,.7)'); }
    // tower
    const tp = P(uc, lerp(va, vb, 0.45), z0 + R * 1.9);
    X.beginPath(); X.moveTo(tp[0] - 9, tp[1]); X.lineTo(tp[0] - 7, tp[1] - 14); X.lineTo(tp[0] + 9, tp[1] - 14); X.lineTo(tp[0] + 10, tp[1]); X.closePath();
    fs(lin(tp[0] - 10, 0, tp[0] + 10, 0, [[0, '#c89a10'], [0.6, '#ffe060'], [1, '#d0a010']]), '#5a4008', 1.2);
    ell(tp[0] + 1, tp[1] - 14, 8, 3.5); fs('#e8c030', '#5a4008', 1);
    line(tp[0] + 3, tp[1] - 14, tp[0] + 3, tp[1] - 26, '#4a4a4a', 1.6); line(tp[0] + 3, tp[1] - 26, tp[0] + 8, tp[1] - 26, '#4a4a4a', 1.6);
  }
  def('submarine_dock', {
    W: 3, D: 3, H: 130, park: 'sea',
    draw(b) {
      seabed(3, 3, 0.04, 17);
      kelpStrand(...P(0.25, 0.3, 3), 40, '#5a8a2a', 3);
      // cradle
      for (const v of [0.9, 1.6, 2.3]) box(0.6, v - 0.06, 1.3, v + 0.06, 3, 14, '#5a6a74', {});
      submarine(0.95, 0.4, 2.6, 8, 21);
      // dock platform
      box(1.72, 0.25, 2.9, 2.75, 3, 12, '#6a7a86', { tex: TX.panels(14), texTop: TT.paving(4, '#8a9aa6') });
      ipath([[1.76, 0.25, 12], [1.76, 2.75, 12]], true); fs(null, '#f0c020', 2);
      railR(2.9, 0.3, 2.7, 12, 9, '#c8d0d6');
      // control tower
      box(2.1, 0.45, 2.75, 1.1, 12, 52, '#e8ecea', { tex: TX.panels(9) });
      onL(1.1, 2.1, () => { X.fillStyle = lin(0, -48, 0, -38, [[0, '#a8f0ff'], [1, '#2a7a9a']]); X.fillRect(3, -48, 0.65 * HX - 6, 10); door(10, -34, 12, 22, '#9aa8b0', { glass: true }); });
      onR(2.75, 1.1, () => { X.fillStyle = lin(0, -48, 0, -38, [[0, '#a8f0ff'], [1, '#2a7a9a']]); X.fillRect(3, -48, 0.65 * HX - 6, 10); });
      flatRoof(2.1, 0.45, 2.75, 1.1, 52, '#c8d0d4', { parapet: 3 });
      const am = P(2.45, 0.75, 55); line(am[0], am[1], am[0], am[1] - 26, '#5a6268', 1.6);
      for (const v of [0.6, 1.4, 2.2]) { const p = P(1.82, v, 12); cyl(p[0], p[1], 3, 5, '#2a2a2a', {}); }
      const sg = P(2.55, 1.85, 12);
      for (const dx of [-18, 18]) { X.fillStyle = '#4a5a64'; X.fillRect(sg[0] + dx - 1.2, sg[1] - 22, 2.4, 22); }
      board(sg[0], sg[1] - 26, 68, 13, 'SOUS-MARINS', 'navy', 8.5);
      coralClump(...P(0.3, 2.75, 3), 12, 10);
    },
    anim(b) {
      const t = b.t;
      // propeller at the stern (back)
      const pp = P(0.95, 0.36, 29);
      const a = t * 9;
      for (let i = 0; i < 3; i++) { const aa = a + i * TAU / 3; ell(pp[0] + Math.cos(aa) * 4, pp[1] + Math.sin(aa) * 6, 4.5, 1.8, aa); fs('#8a7a5a', '#3a3020', 0.6); }
      bubbles(pp[0] + 6, pp[1] - 4, t, { n: 5, h: 40, spread: 8, seed: 2 });
      const am = P(2.45, 0.75, 81), on = Math.sin(t * 3) > 0.3;
      ell(am[0], am[1], 2, 2); fs(on ? '#40ff6a' : '#1a5a2a'); if (on) glow(am[0], am[1], 8, '#40ff6a', 0.6);
      // headlight beam from the glass nose
      const np = P(0.95, 2.6, 29);
      X.save(); X.globalCompositeOperation = 'lighter';
      spath([np, [np[0] - 46, np[1] + 30], [np[0] - 20, np[1] + 40]]);
      X.fillStyle = H.radial(X, np[0], np[1], 0, 50, [[0, 'rgba(255,250,200,.35)'], [1, 'rgba(255,250,200,0)']]); X.fill();
      X.restore();
    },
  });

  def('octopus_house', {
    W: 2, D: 2, H: 120, park: 'sea',
    draw(b) {
      seabed(2, 2, 0.05, 19);
      const c = P(1.0, 0.95, 3), col = '#b8468a';
      const tent = (pts, w) => {
        H.limb(X, pts, w, lin(pts[0][0], pts[0][1], pts[pts.length - 1][0], pts[pts.length - 1][1], [[0, shade(col, -0.15)], [1, shade(col, 0.15)]]), shade(col, -0.5), 1.2);
        for (let i = 1; i < pts.length - 1; i++) { ell(pts[i][0], pts[i][1] + w[i] * 0.3, w[i] * 0.18, w[i] * 0.13); fs('#f8c8e0', shade(col, -0.4), 0.5); }
      };
      // back tentacles
      tent([[c[0] - 30, c[1] - 6], [c[0] - 56, c[1] - 14], [c[0] - 70, c[1] - 6], [c[0] - 64, c[1] + 2]], [16, 12, 8, 4]);
      tent([[c[0] + 30, c[1] - 6], [c[0] + 58, c[1] - 16], [c[0] + 74, c[1] - 26], [c[0] + 70, c[1] - 36]], [16, 12, 8, 4]);
      // skirt
      dome(c[0], c[1], 48, 30, shade(col, -0.05));
      // head (mantle)
      const hy = c[1] - 62;
      X.beginPath(); X.ellipse(c[0], hy, 38, 44, 0, 0, TAU);
      fs(rad(c[0] + 12, hy - 18, 4, 52, [[0, shade(col, 0.4)], [0.5, col], [1, shade(col, -0.35)]]), shade(col, -0.5), 1.6);
      X.save(); X.beginPath(); X.ellipse(c[0], hy, 38, 44, 0, 0, TAU); X.clip();
      const rr = H.rng(31);
      for (let i = 0; i < 14; i++) { ell(c[0] - 30 + rr() * 60, hy - 40 + rr() * 50, 2 + rr() * 3, 1.6 + rr() * 2); fs(rgba(shade(col, 0.45), 0.7)); }
      X.restore();
      // eye windows
      for (const sd of [-1, 1]) { const ex = c[0] + sd * 15, ey = hy + 12; ell(ex, ey, 10, 11); fs('#f4ead8', shade(col, -0.5), 1.6); ell(ex, ey, 7.5, 8.5); fs(rad(ex - 2, ey - 2, 0.5, 9, [[0, '#fff6c0'], [1, '#f0b030']])); X.fillStyle = '#2a1a10'; X.fillRect(ex - 1.2, ey - 7, 2.4, 14); line(ex - 7, ey, ex + 7, ey, '#2a1a10', 1.4); }
      // door in the skirt
      door(c[0] - 8, c[1] - 26, 16, 24, '#6a3a20', { arch: true, double: false });
      // front tentacles
      tent([[c[0] - 20, c[1] + 8], [c[0] - 46, c[1] + 22], [c[0] - 62, c[1] + 18], [c[0] - 60, c[1] + 8]], [18, 13, 8, 4]);
      tent([[c[0] + 20, c[1] + 8], [c[0] + 44, c[1] + 26], [c[0] + 66, c[1] + 22], [c[0] + 68, c[1] + 10]], [18, 13, 8, 4]);
      tent([[c[0] + 34, c[1] - 2], [c[0] + 52, c[1] - 30], [c[0] + 50, c[1] - 58], [c[0] + 42, c[1] - 70]], [14, 11, 8, 5]);
      board(c[0] + 50, c[1] - 78, 50, 13, 'PIEUVRE', 'cream', 9);
      for (let i = 0; i < 3; i++) crate(1.55 + i * 0.1, 1.55 - i * 0.22, 3, 0.2, '#a8703a');
    },
    anim(b) {
      const c = P(1.0, 0.95, 3), hy = c[1] - 62;
      for (const sd of [-1, 1]) glow(c[0] + sd * 15, hy + 12, 14, '#ffd040', 0.25 + 0.1 * Math.sin(b.t * 2 + sd));
      bubbles(c[0], hy - 44, b.t, { n: 5, h: 50, spread: 12, seed: 8 });
    },
  });

  def('dome_restaurant', {
    W: 3, D: 3, H: 125, park: 'sea',
    draw(b) {
      seabed(3, 3, 0.04, 23);
      const c = P(1.45, 1.4, 3), R = 98;
      cyl(c[0], c[1], R + 4, 12, S.metal, { top: '#dce6ea' });
      const fy = c[1] - 12;
      ell(c[0], fy, R - 4, (R - 4) / 2); fs('#e8dcc4');
      // interior: tables around a central bar
      const tables = [];
      for (let i = 0; i < 9; i++) { const a = i / 9 * TAU + 0.3; tables.push([c[0] + Math.cos(a) * 62, fy + Math.sin(a) * 28]); }
      tables.sort((p, q) => p[1] - q[1]);
      const bar = () => { cyl(c[0], fy, 20, 16, '#8a5a3a', { top: '#c89a6a' }); cyl(c[0], fy - 16, 6, 20, '#d8d0c0', {}); ell(c[0], fy - 38, 14, 6); fs('#f0c040', '#7a5a10', 1); };
      let drawnBar = false;
      for (const [x, y] of tables) {
        if (!drawnBar && y > fy) { bar(); drawnBar = true; }
        X.fillStyle = '#c8c0b0'; X.fillRect(x - 1, y - 9, 2, 9);
        ell(x, y - 9, 9, 4); fs('#ffffff', '#8a8070', 0.8);
        for (const sd of [-1, 1]) { X.fillStyle = '#c84a3a'; X.fillRect(x + sd * 11 - 2.5, y - 6, 5, 6); }
        ell(x, y - 11, 1.5, 2); fs('#ffe080');
      }
      if (!drawnBar) bar();
      // greenhouse planters along the glass (kelp-green ferns in round pots)
      for (const a of [0.15, 1.2, 2.0, 2.95, 4.0, 5.3]) {
        const px = c[0] + Math.cos(a) * 84, py = fy + Math.sin(a) * 38;
        ell(px, py - 3, 7, 3.5); fs('#b86a3a', '#5a2a10', 0.8);
        fern(px, py - 4, 13, a > 3 && a < 6 ? '#3f9a4a' : '#5ab85a', Math.round(a * 10), 6);
      }
      // back half of the green light ring (seen through the glass)
      for (let i = 0; i < 14; i++) { const a = PI + (i + 0.5) / 14 * PI; ell(c[0] + Math.cos(a) * (R + 2), fy + Math.sin(a) * (R + 2) / 2 + 1, 2.2, 1.5); X.fillStyle = '#5aff8a'; X.fill(); }
      // glass dome
      domePath(c[0], fy, R, 82);
      fs(rad(c[0] + 30, fy - 60, 6, 120, [[0, 'rgba(230,255,255,.5)'], [0.5, 'rgba(120,220,240,.22)'], [1, 'rgba(40,140,180,.42)']]), '#2a6a7a', 1.8);
      domeRibs(c[0], fy, R, 82, 9, 5, 'rgba(70,120,140,.8)', 1.5);
      X.save(); domePath(c[0], fy, R, 82); X.clip();
      X.beginPath(); X.ellipse(c[0] + 40, fy - 56, 12, 30, 0.6, 0, TAU); X.fillStyle = 'rgba(255,255,255,.3)'; X.fill();
      X.restore();
      ell(c[0], fy - 82, 8, 4); fs('#c8d0d4', '#3a4a54', 1);
      // front half of the green light ring on the base rim
      for (let i = 0; i < 14; i++) { const a = (i + 0.5) / 14 * PI, x = c[0] + Math.cos(a) * (R + 2), y = fy + Math.sin(a) * (R + 2) / 2 + 1; ell(x, y, 3, 2); fs('#5aff8a', '#1a5a2a', 0.7); ell(x - 0.8, y - 0.6, 0.9, 0.6); X.fillStyle = '#eafff0'; X.fill(); }
      // airlock tube towards the front-left
      for (let i = 0; i <= 10; i++) {
        const v = lerp(2.05, 2.75, i / 10);
        onL(v, 0.95, () => { ell(0, -20, 17, 17); fs(i === 10 ? '#c8d4da' : lin(0, -37, 0, -3, [[0, '#e8f0f2'], [1, '#6a7a86']]), i === 10 || i === 0 ? '#3a4a54' : null, 1.2); });
      }
      onL(2.76, 0.95, () => { ell(0, -20, 11, 13); fs('#4a5a64', '#2a3a44', 1.2); ell(0, -20, 8, 10); fs(lin(0, -30, 0, -10, [[0, '#ffe6a0'], [1, '#d08a30']])); line(0, -30, 0, -10, '#4a5a64', 1.4); });
      onL(2.78, 0.95, () => board(0, -46, 66, 12, 'RESTAURANT', 'navy', 8));
      coralClump(...P(2.7, 0.6, 3), 14, 11); coralClump(...P(0.3, 2.2, 3), 12, 12);
    },
    anim(b) {
      const c = P(1.45, 1.4, 3), t = b.t;
      glow(c[0], c[1] - 40, 70, '#ffd890', 0.1 + 0.03 * Math.sin(t * 2.5));
      // pulsing green rim lights (one cached glow sprite)
      const gs = greenGlowSprite(), fy = c[1] - 12, ga = X.globalAlpha;
      if (gs) {
        X.save(); X.globalCompositeOperation = 'lighter';
        for (let i = 0; i < 14; i++) {
          const a = (i + 0.5) / 14 * PI, x = c[0] + Math.cos(a) * 100, y = fy + Math.sin(a) * 50 + 1;
          X.globalAlpha = ga * (0.45 + 0.35 * Math.sin(t * 3 - i * 0.7));
          X.drawImage(gs, x - 10, y - 10, 20, 20);
        }
        X.restore();
      }
      fishLoop(c[0], c[1] - 60, 110, 30, t, 5, null, 0.35, 3);
      bubbles(c[0], c[1] - 100, t, { n: 4, h: 40, spread: 10, seed: 9 });
    },
  });

  def('aquarium_hotel', {
    W: 3, D: 3, H: 188, park: 'sea',
    draw(b) {
      seabed(3, 3, 0.04, 29);
      const c = P(1.5, 1.5, 3);
      for (const [u, v, s] of [[0.35, 1.2, 1], [1.3, 2.6, 2], [2.65, 1.0, 3], [2.4, 2.3, 4]]) coralClump(...P(u, v, 3), 14, s);
      cyl(c[0], c[1], 84, 18, '#8a9ea2', { top: '#a8bcbe', tex: TX.stones ? (x, y, R, h) => { for (let i = 0; i < 18; i++) { const q = cylPt(x, y, R, PI * i / 17); line(q[0], q[1], q[0], q[1] - h, 'rgba(40,60,66,.35)', 1); } } : null });
      const tz = 18, th = 104;
      cyl(c[0], c[1] - tz, 56, th, '#eef2f0', {
        top: false,
        tex: (x, y, R, h) => {
          for (let f = 0; f < 4; f++) {
            const z = 16 + f * 24;
            X.fillStyle = '#2f9aa8'; X.beginPath(); X.ellipse(x, y - z + 12, R, R / 2, 0, 0, PI); X.ellipse(x, y - z + 9, R, R / 2, 0, PI, 0, true); X.fill();
            for (let i = 0; i < 7; i++) { const a = PI * (i + 0.5) / 7, q = cylPt(x, y, R, a, z); porthole(q[0], q[1], 4.6 * Math.sin(a) + 0.5, hash(i, f) > 0.35); }
          }
        },
      });
      // glass observation deck
      const dy = c[1] - tz - th;
      cyl(c[0], dy, 62, 20, '#7fe0f0', { top: false, tex: (x, y, R, h) => { X.fillStyle = 'rgba(255,255,255,.25)'; X.fillRect(x + R * 0.2, y - h, R * 0.25, h + R * 0.4); for (let i = 1; i < 8; i++) { const q = cylPt(x, y, R, PI * i / 8); line(q[0], q[1], q[0], q[1] - h, 'rgba(40,90,110,.6)', 1.2); } } });
      ell(c[0], dy, 62, 31); fs(null, '#3a5a64', 2);
      dome(c[0], dy - 20, 62, 28, '#2f9aa8');
      domeRibs(c[0], dy - 20, 62, 28, 8, 2, 'rgba(255,255,255,.35)', 1);
      const ap = [c[0], dy - 48]; line(ap[0], ap[1], ap[0], ap[1] - 18, '#5a6268', 1.8);
      // vertical sign
      const sx = c[0] - 49, sy = c[1] - tz - 30;
      rrect(sx - 8, sy - 66, 16, 66, 3); fs(lin(sx - 8, 0, sx + 8, 0, [[0, '#14304a'], [1, '#2a4a6a']]), '#0a1a2a', 1.2);
      [...'HÔTEL'].forEach((ch, i) => txt(ch, sx, sy - 58 + i * 12.5, 10, '#ffe680', { shadow: '#000' }));
      door(c[0] - 12, c[1] - 18 - 26 + 4, 24, 22, '#9aa8b0', { glass: true, lit: true });
      kelpStrand(...P(0.2, 0.6, 3), 54, '#5a8a2a', 5); kelpStrand(...P(2.8, 2.6, 3), 44, '#6a9a30', 6);
    },
    anim(b) {
      const c = P(1.5, 1.5, 3), t = b.t, dy = c[1] - 122;
      const on = Math.sin(t * 2.6) > 0.2;
      ell(c[0], dy - 66, 2.2, 2.2); fs(on ? '#ff4a3a' : '#7a2018'); if (on) glow(c[0], dy - 66, 9, '#ff4a3a', 0.6);
      fishLoop(c[0], c[1] - 80, 80, 22, t, 4, null, 0.4, 5);
      bubbles(c[0] + 20, dy - 50, t, { n: 4, h: 40, spread: 12, seed: 4 });
      glow(c[0], dy - 10, 50, '#7fe0f0', 0.1 + 0.05 * Math.sin(t * 1.7));
    },
  });

  // ---------------------------------------------------------------- sea decorations
  def('coral', {
    W: 1, D: 1, H: 60, park: 'sea',
    draw(b) {
      const c = P(0.5, 0.5, 0);
      blob(c[0], c[1] + 2, 30, 13, 0.3);
      ell(c[0], c[1], 28, 13); fs('#d9cc9c', '#a8986a', 0.8);
      rock(c[0] + 4, c[1] + 2, 16, 10, '#7a9094', 3);
      // fan behind
      X.save(); X.translate(c[0] - 10, c[1] - 6); X.scale(0.55, 0.55);
      X.beginPath(); X.moveTo(0, 0); for (let i = 0; i <= 10; i++) { const a = -PI + 0.3 + i / 10 * (PI - 0.6); X.lineTo(Math.cos(a) * 32, -14 + Math.sin(a) * 48); } X.closePath();
      fs(rad(0, -30, 4, 50, [[0, '#d080f0'], [1, '#8a40b0']]), '#4a1a6a', 1.6); X.restore();
      coralBranch(c[0] + 8, c[1] - 2, 26, '#ff8a3a', 3);
      coralBranch(c[0] - 14, c[1] + 4, 18, '#ff5a7a', 4);
      for (const [dx, h] of [[16, 14], [21, 10], [12, 9]]) { cyl(c[0] + dx, c[1] + 6, 2.6, h, '#f0d040', { top: '#5a4a10' }); }
      dome(c[0] - 4, c[1] + 9, 8, 7, '#7ab85a');
    },
    anim(b) { const c = P(0.5, 0.5, 0); fishLoop(c[0], c[1] - 30, 26, 8, b.t, 3, null, 1.1, 1); },
  });
  def('kelp', {
    W: 1, D: 1, H: 110, park: 'sea', sway: 0.05,
    draw(b) {
      const c = P(0.5, 0.5, 0);
      blob(c[0], c[1] + 2, 24, 10, 0.28);
      rock(c[0], c[1] + 3, 14, 8, '#6f8890', 2);
      for (let i = 0; i < 5; i++) kelpStrand(c[0] - 12 + i * 6, c[1] + 2 - (i % 2) * 3, 70 + hash(i, 4) * 30, ['#5a8a2a', '#6a9a30', '#4a7a2a'][i % 3], i * 2.3);
      rock(c[0] - 12, c[1] + 6, 6, 4, '#7a9094', 5);
    },
    anim(b) { const c = P(0.5, 0.5, 0); bubbles(c[0], c[1] - 40, b.t, { n: 3, h: 50, spread: 16, seed: 2 }); },
  });
  def('anchor', {
    W: 1, D: 1, H: 70, park: 'sea',
    draw(b) {
      const c = P(0.5, 0.5, 0);
      blob(c[0], c[1] + 2, 28, 11, 0.3);
      ell(c[0], c[1] + 1, 26, 11); fs('#d9cc9c', '#a8986a', 0.8);
      const rust = '#8a4a2a';
      // chain on the sand
      for (let i = 0; i < 7; i++) { const x = c[0] - 26 + i * 5, y = c[1] + 6 - Math.sin(i * 0.8) * 2; ell(x, y, 3, 1.8, i % 2 ? 0 : 1.2); fs(null, '#5a3a2a', 1.4); }
      X.save(); X.translate(c[0] + 2, c[1] + 2); X.rotate(0.35);
      // arms + flukes
      X.beginPath(); X.moveTo(-22, -14); X.quadraticCurveTo(-18, 4, 0, 4); X.quadraticCurveTo(18, 4, 22, -14);
      X.strokeStyle = shade(rust, -0.4); X.lineWidth = 7.5; X.lineCap = 'round'; X.stroke(); X.strokeStyle = rust; X.lineWidth = 5.5; X.stroke();
      for (const sd of [-1, 1]) { spath([[sd * 22, -22], [sd * 28, -10], [sd * 17, -11]]); fs(rust, shade(rust, -0.5), 1.2); }
      // shank
      X.fillStyle = lin(-4, 0, 4, 0, [[0, shade(rust, -0.35)], [0.6, shade(rust, 0.2)], [1, shade(rust, -0.2)]]);
      X.fillRect(-3.5, -52, 7, 56); X.strokeStyle = shade(rust, -0.5); X.lineWidth = 1; X.strokeRect(-3.5, -52, 7, 56);
      // stock + ring
      X.fillStyle = '#5a4a3a'; X.fillRect(-16, -46, 32, 5); X.strokeRect(-16, -46, 32, 5);
      ell(0, -58, 6, 6); fs(null, shade(rust, -0.4), 3.5); ell(0, -58, 6, 6); fs(null, rust, 2);
      for (let i = 0; i < 6; i++) { ell(-2 + hash(i, 2) * 4, -40 + i * 7, 1.6, 1.3); fs('#d8d0c0', '#6a6458', 0.5); }
      X.restore();
      kelpStrand(c[0] - 16, c[1] + 4, 26, '#5a8a2a', 3);
    },
    anim(b) { const c = P(0.5, 0.5, 0); bubbles(c[0] + 10, c[1] - 50, b.t, { n: 3, h: 30, spread: 6, seed: 3 }); },
  });
  def('treasure_chest', {
    W: 1, D: 1, H: 55, park: 'sea',
    draw(b) {
      const c = P(0.5, 0.5, 0);
      blob(c[0], c[1] + 2, 30, 12, 0.3);
      ell(c[0], c[1] + 1, 28, 12); fs('#d9cc9c', '#a8986a', 0.8);
      const wood = '#8a5a30';
      // open lid (behind)
      ipath([[0.28, 0.36, 18], [0.72, 0.36, 18], [0.72, 0.26, 38], [0.28, 0.26, 38]]); fs(lin(...P(0.5, 0.3, 38), ...P(0.5, 0.36, 18), [[0, shade(wood, 0.15)], [1, shade(wood, -0.3)]]), '#3a2010', 1);
      ipath([[0.3, 0.33, 22], [0.7, 0.33, 22], [0.7, 0.29, 34], [0.3, 0.29, 34]]); fs('#6a1a2a');
      box(0.28, 0.36, 0.72, 0.68, 0, 18, wood, { tex: (len, z0, z1) => { X.fillStyle = '#d0a030'; X.fillRect(2, -z1, 3, z1 - z0); X.fillRect(len - 5, -z1, 3, z1 - z0); X.fillRect(0, -z1 + 2, len, 2.5); } , top: false });
      // gold pile
      const gp = P(0.5, 0.52, 18);
      ell(gp[0], gp[1], 20, 9); fs(rad(gp[0] - 4, gp[1] - 4, 1, 22, [[0, '#fff2a0'], [0.5, '#f0c030'], [1, '#a87a10']]), '#6a4a08', 1);
      for (let i = 0; i < 14; i++) { const x = gp[0] - 15 + hash(i, 1) * 30, y = gp[1] - 6 + hash(i, 2) * 9; ell(x, y, 2.6, 1.4); fs('#ffd23a', '#8a6008', 0.6); }
      for (const [dx, dy, col] of [[-6, -4, '#e8203a'], [5, -2, '#20c060'], [10, -6, '#3a80ff']]) { spath([[gp[0] + dx, gp[1] + dy - 3], [gp[0] + dx + 2.5, gp[1] + dy], [gp[0] + dx, gp[1] + dy + 2.5], [gp[0] + dx - 2.5, gp[1] + dy]]); fs(col, '#1a1a1a', 0.6); }
      // pearls necklace spilling
      for (let i = 0; i < 8; i++) { ell(gp[0] + 14 + i * 2.2, gp[1] + 4 + Math.sin(i * 0.7) * 4 + i * 1.6, 1.5, 1.5); fs('#ffffff', '#a8a8a8', 0.4); }
      for (let i = 0; i < 6; i++) { ell(c[0] - 22 + hash(i, 5) * 16, c[1] + 4 + hash(i, 6) * 6, 2.4, 1.2); fs('#ffd23a', '#8a6008', 0.5); }
    },
    anim(b) {
      const gp = P(0.5, 0.52, 18), t = b.t;
      glow(gp[0], gp[1] - 4, 26, '#ffd040', 0.22 + 0.1 * Math.sin(t * 3));
      for (let i = 0; i < 3; i++) { const p = fract(t * 0.6 + i / 3); sparkle(gp[0] - 12 + i * 12, gp[1] - 6 - p * 18, 3.5, Math.sin(p * PI), '#fff8c0'); }
    },
  });
  def('shipwreck', {
    W: 2, D: 2, H: 105, park: 'sea',
    draw(b) {
      seabed(2, 2, 0.05, 31);
      rock(...P(0.3, 0.5, 3), 16, 12, '#6f8890', 4);
      const zAt = u => 44 - u * 12; // deck height (bow sinking)
      // far rail
      ipath([[0.25, 0.68, zAt(0.25) + 4], [1.85, 0.68, zAt(1.85) + 4]], true); fs(null, '#4a3020', 2.2);
      // deck
      ipath([[0.25, 0.68, zAt(0.25)], [1.85, 0.68, zAt(1.85)], [1.85, 1.3, zAt(1.85)], [0.25, 1.3, zAt(0.25)]]);
      fs('#8a6a48', '#3a2410', 1);
      for (let i = 1; i < 6; i++) { const v = 0.68 + i * 0.1; ipath([[0.25, v, zAt(0.25)], [1.85, v, zAt(1.85)]], true); fs(null, 'rgba(50,30,15,.45)', 0.8); }
      // broken hole in the deck
      ipath([[0.9, 0.85, zAt(0.9)], [1.2, 0.8, zAt(1.2)], [1.3, 1.05, zAt(1.3)], [1.05, 1.15, zAt(1.05)], [0.85, 1.05, zAt(0.85)]]); fs('#1a1008');
      // mast (broken, leaning) + torn sail
      const m0 = P(1.0, 0.98, zAt(1.0)), m1 = [m0[0] + 26, m0[1] - 54];
      line(m0[0], m0[1], m1[0], m1[1], '#3a2410', 5.5); line(m0[0], m0[1], m1[0], m1[1], '#7a5a3a', 3.6);
      X.beginPath(); X.moveTo(m0[0] + 8, m0[1] - 18); X.lineTo(m1[0] - 4, m1[1] + 8); X.lineTo(m1[0] + 18, m1[1] + 24); X.lineTo(m1[0] + 10, m1[1] + 30); X.lineTo(m1[0] + 16, m1[1] + 38); X.lineTo(m0[0] + 20, m0[1] - 6); X.closePath();
      fs('rgba(220,210,180,.85)', '#6a5a40', 1);
      // near hull side (v = 1.3)
      onL(1.3, 0, () => {
        const hull = () => { X.beginPath(); X.moveTo(0.22 * HX, -zAt(0.22) - 2); X.lineTo(1.88 * HX, -zAt(1.88)); X.quadraticCurveTo(1.7 * HX, -2, 1.2 * HX, 2); X.quadraticCurveTo(0.4 * HX, 2, 0.22 * HX, -zAt(0.22) - 2); X.closePath(); };
        hull(); fs(lin(0, -50, 0, 2, [[0, '#9a6a40'], [1, '#4a3018']]), '#2a1808', 1.4);
        X.save(); hull(); X.clip();
        for (let k = 1; k < 7; k++) { X.beginPath(); X.moveTo(0, -k * 6.5); X.lineTo(1.9 * HX, -k * 6.5 + 12); X.strokeStyle = 'rgba(40,24,10,.5)'; X.lineWidth = 0.9; X.stroke(); }
        X.beginPath(); X.moveTo(52, -26); X.lineTo(60, -34); X.lineTo(66, -24); X.lineTo(72, -30); X.lineTo(70, -14); X.lineTo(58, -10); X.closePath(); fs('#1a1008');
        X.restore();
        for (const x of [24, 40, 82]) porthole(x, -zAt(x / HX) + 12, 2.8, false);
        // seaweed hanging
        for (const x of [30, 64, 78]) { X.beginPath(); X.moveTo(x, -zAt(x / HX)); X.quadraticCurveTo(x + 3, -zAt(x / HX) + 8, x - 1, -zAt(x / HX) + 16); X.strokeStyle = '#4a7a2a'; X.lineWidth = 2; X.stroke(); }
      });
      // stern castle
      box(0.22, 0.7, 0.62, 1.3, zAt(0.4), zAt(0.4) + 18, '#8a6040', { tex: TX.planks(5, 3) });
      onL(1.3, 0.22, () => { win(4, -zAt(0.4) - 14, 7, 8, { frame: '#3a2410', glass: '#2a4a5a' }); win(12, -zAt(0.4) - 14, 7, 8, { frame: '#3a2410', glass: '#2a4a5a' }); });
      // sand drift over the bow
      X.beginPath(); const sp = P(1.75, 1.3, 0); X.ellipse(sp[0] - 4, sp[1] - 2, 26, 9, -0.3, 0, TAU); fs('#d9cc9c', '#a8986a', 0.8);
      coralClump(...P(1.8, 0.4, 3), 12, 14);
      coralBranch(...P(0.5, 1.5, 3), 14, '#ff7a6a', 15);
    },
    anim(b) {
      const c = P(1, 1, 30);
      fishLoop(c[0], c[1] - 10, 60, 18, b.t, 4, null, 0.5, 7);
      bubbles(...P(1.05, 0.98, 30), b.t, { n: 4, h: 50, spread: 10, seed: 5 });
    },
  });
  /** Stroke the current path as a bone: dark outline, then bone colour. */
  function boneStroke(w, col) {
    X.lineCap = 'round'; X.lineJoin = 'round';
    X.strokeStyle = '#5a4a32'; X.lineWidth = w + 1.8; X.stroke();
    X.strokeStyle = col || '#eee2c4'; X.lineWidth = w; X.stroke();
  }
  /** Giant marine-reptile skeleton arching out of a rocky outcrop, half-buried in the sand. */
  def('fossil_skeleton', {
    W: 2, D: 2, H: 96, park: 'sea',
    draw(b) {
      seabed(2, 2, 0.05, 37);
      const bone = '#eee2c4', bink = '#5a4a32', boneD = '#cdbf9c';
      // rocky outcrop behind the skeleton
      rock(...P(0.5, 0.42, 3), 42, 44, '#6a7e86', 12);
      rock(...P(1.08, 0.24, 3), 28, 26, '#7f9298', 14);
      rock(...P(0.24, 0.92, 3), 30, 36, '#76888c', 16);
      // strata lines on the big rock
      const r0 = P(0.5, 0.42, 3);
      for (let i = 0; i < 3; i++) { X.beginPath(); X.moveTo(r0[0] - 34, r0[1] - 10 - i * 9); X.quadraticCurveTo(r0[0], r0[1] - 16 - i * 10, r0[0] + 30, r0[1] - 8 - i * 9); X.strokeStyle = 'rgba(30,45,50,.3)'; X.lineWidth = 1.2; X.stroke(); }
      coralBranch(r0[0] - 12, r0[1] - 34, 14, '#b060d0', 21);
      coralBranch(r0[0] + 14, r0[1] - 30, 11, '#ff7a6a', 23);
      // spine: from inside the rock (left) arching over to the skull (right)
      const N = 17, sp = [];
      for (let i = 0; i < N; i++) {
        const f = i / (N - 1);
        sp.push({ i, f, u: lerp(0.4, 1.46, f), v: lerp(1.4, 0.66, f), z: 8 + Math.sin(Math.min(1, f * 1.12) * PI) * 50 + f * 8 });
      }
      const ribK = f => (f > 0.16 && f < 0.66 ? Math.sin((f - 0.16) / 0.5 * PI) : 0);
      const rib = (s, sd) => {
        const k = ribK(s.f);
        if (k < 0.15 || s.i % 2) return;
        const o = 0.14 + 0.3 * k;
        // ribs bulge outwards and sweep back towards the tail
        const a = P(s.u, s.v, s.z), c = P(s.u + sd * o * 1.6 + 0.05, s.v + sd * o * 1.6 - 0.04, s.z * 0.72), e = P(s.u + sd * o - 0.16, s.v + sd * o + 0.11, 2);
        X.beginPath(); X.moveTo(a[0], a[1]); X.quadraticCurveTo(c[0], c[1], e[0], e[1]);
        boneStroke(2.2 + k * 1.2, sd < 0 ? boneD : bone);
      };
      for (const s of sp) rib(s, -1);                       // far ribs
      // sand drift along the belly (covers the far rib ends)
      const m0 = P(0.62, 1.05, 3), m1 = P(1.28, 0.62, 3);
      X.beginPath(); X.moveTo(m0[0] - 14, m0[1] + 2); X.quadraticCurveTo((m0[0] + m1[0]) / 2, (m0[1] + m1[1]) / 2 - 12, m1[0] + 14, m1[1] + 2); X.closePath();
      fs(lin(0, m1[1] - 10, 0, m1[1] + 4, [[0, '#e6dab0'], [1, '#cfc08e']]));
      // vertebrae with neural spines
      for (let i = 0; i < N; i++) {
        const s = sp[i], p = P(s.u, s.v, s.z), r = 3.4 + ribK(s.f) * 1.6 - (s.f > 0.8 ? (s.f - 0.8) * 6 : 0);
        if (i) { const q = P(sp[i - 1].u, sp[i - 1].v, sp[i - 1].z); X.beginPath(); X.moveTo(q[0], q[1]); X.lineTo(p[0], p[1]); boneStroke(2.6, boneD); }
        if (s.f < 0.8) { X.beginPath(); X.moveTo(p[0], p[1]); X.lineTo(p[0] - 1.5, p[1] - 6 - ribK(s.f) * 6); boneStroke(1.8); }
        ell(p[0], p[1], r, r * 0.8); fs(lin(0, p[1] - r, 0, p[1] + r, [[0, '#fff6dc'], [1, boneD]]), bink, 1);
      }
      // skull, jaws wide open, resting on the sand (towards the right corner)
      const sk = P(1.5, 0.62, 12);
      X.save(); X.translate(sk[0] - 2, sk[1]); X.rotate(-0.12);
      X.beginPath(); X.moveTo(-2, 3); X.quadraticCurveTo(22, 22, 54, 22); X.lineTo(55, 17); X.quadraticCurveTo(26, 14, 4, -1); X.closePath();
      fs(lin(0, 0, 0, 22, [[0, '#f6ecd4'], [1, '#c4b28a']]), bink, 1.2);
      H.teeth(X, 12, 7.5, 52, 16.5, 9, 4.2, true, '#fffaf0');
      X.beginPath(); X.moveTo(-9, 0); X.quadraticCurveTo(-8, -17, 10, -18); X.quadraticCurveTo(30, -16, 62, -2); X.lineTo(62, 2); X.quadraticCurveTo(32, 1, 6, 6); X.quadraticCurveTo(-6, 7, -9, 0); X.closePath();
      fs(lin(0, -18, 0, 7, [[0, '#fffaea'], [0.6, '#eadcb8'], [1, '#c4b28a']]), bink, 1.3);
      H.teeth(X, 10, 4.6, 60, 1.6, 12, 4.6, false, '#fffaf0');
      ell(6, -8, 6.5, 5); fs(rad(6, -8, 1, 7, [[0, '#14100a'], [1, '#3a3020']]), bink, 0.9);
      ell(-3, -4, 2.6, 4.2, 0.3); fs('#3a3020');
      ell(46, -6, 2.2, 1.3, -0.2); fs('#3a3020');
      X.beginPath(); X.moveTo(14, -15); X.quadraticCurveTo(34, -12, 56, -4); X.strokeStyle = 'rgba(255,255,255,.6)'; X.lineWidth = 1.2; X.stroke();
      X.restore();
      // near ribs + sand mounds burying their tips
      for (const s of sp) rib(s, 1);
      for (const s of sp) { const k = ribK(s.f); if (k < 0.15 || s.i % 2) continue; const o = 0.14 + 0.3 * k, e = P(s.u + o - 0.16, s.v + o + 0.11, 3); ell(e[0], e[1] + 1, 5, 2.4); fs('#dccf9f'); }
      // front flipper splayed on the sand
      const fl = P(1.22, 0.98, 4);
      for (let i = 0; i < 4; i++) {
        const ex = fl[0] + 6 + i * 5, ey = fl[1] + 12 - i * 1.5;
        X.beginPath(); X.moveTo(fl[0], fl[1]); X.lineTo(ex, ey); boneStroke(1.7);
        for (let k = 1; k <= 2; k++) { ell(lerp(fl[0], ex, k / 2.6), lerp(fl[1], ey, k / 2.6), 1.6, 1.4); fs(bone, bink, 0.6); }
      }
      ell(fl[0], fl[1], 3, 2.4); fs(bone, bink, 0.8);
      // the tail disappears into a rock at the front left
      rock(...P(0.52, 1.62, 3), 30, 30, '#7a8c90', 13);
      coralClump(...P(0.62, 1.75, 3), 11, 5);
      starfish(...P(1.55, 1.55, 3), 5, '#ff7a4a');
    },
    anim(b) {
      const sk = P(1.5, 0.62, 12);
      sparkle(sk[0] + 4, sk[1] - 10, 4, 0.5 + 0.5 * Math.sin(b.t * 2.2), '#ffffff');
      const r0 = P(0.5, 0.42, 3);
      bubbles(r0[0] + 4, r0[1] - 40, b.t, { n: 3, h: 44, spread: 10, seed: 9 });
      fishLoop(...P(1.0, 0.8, 60), 30, 8, b.t, 2, null, 0.7, 3);
    },
  });

  /** Greek column at ground (x, y). */
  function column(x, y, h, r, broken, seed) {
    cyl(x, y, r, h, '#e4e0d2', {
      top: broken ? false : undefined,
      tex: (cx, cy, R, hh) => { for (let i = 1; i < 8; i++) { const q = cylPt(cx, cy, R, PI * i / 8); line(q[0], q[1], q[0], q[1] - hh, 'rgba(120,110,90,.45)', 1); } },
    });
    if (broken) {
      X.beginPath(); X.moveTo(x - r, y - h); for (let i = 1; i <= 6; i++) X.lineTo(x - r + i * r / 3, y - h - (i % 2 ? 6 : 0) - hash(i, seed) * 5); X.lineTo(x + r, y - h + r * 0.5); X.ellipse(x, y - h, r, r * 0.5, 0, 0, PI, false); X.closePath();
      fs('#d4cfc0', '#7a7260', 1);
    } else {
      ell(x, y - h - 2, r + 3, (r + 3) * 0.5); fs('#e8e4d6', '#7a7260', 1);
      X.fillStyle = '#d8d4c4'; X.fillRect(x - r - 5, y - h - 9, (r + 5) * 2, 6); X.strokeStyle = '#7a7260'; X.lineWidth = 1; X.strokeRect(x - r - 5, y - h - 9, (r + 5) * 2, 6);
    }
  }
  def('ancient_ruins', {
    W: 2, D: 2, H: 128, park: 'sea',
    draw(b) {
      seabed(2, 2, 0.05, 41);
      box(0.15, 0.15, 1.85, 1.85, 3, 9, '#cfcab8', { tex: TX.stones(6, 3) });
      box(0.28, 0.28, 1.72, 1.72, 9, 14, '#dcd8c8', { texTop: TT.paving(2, '#dcd8c8') });
      const c1 = P(0.5, 0.5, 14), c2 = P(1.5, 0.5, 14), c3 = P(0.5, 1.5, 14);
      column(c1[0], c1[1], 78, 9, false, 1);
      column(c2[0], c2[1], 78, 9, false, 2);
      box(0.3, 0.38, 1.7, 0.62, 92, 102, '#e0dccc', { tex: (len, z0, z1) => { for (let x = 6; x < len; x += 12) { X.fillStyle = 'rgba(120,110,90,.35)'; X.fillRect(x, -z1 + 2, 3, z1 - z0 - 4); } } });
      // pediment fragment
      ipath([[0.3, 0.5, 102], [1.1, 0.5, 102], [0.75, 0.5, 118]]); fs('#e8e4d6', '#7a7260', 1);
      column(c3[0], c3[1], 40, 9, true, 3);
      // fallen column (lying along u)
      for (let i = 0; i <= 12; i++) { const u = lerp(1.0, 1.85, i / 12); onR(u, 1.62, () => { ell(-8, -9, 8.5, 8.5); fs(i === 12 ? '#d8d4c4' : lin(0, -18, 0, 0, [[0, '#f0ece0'], [1, '#a8a090']]), i === 12 || i === 0 ? '#7a7260' : null, 1); }); }
      for (const th of [-1.1, -0.55, 0, 0.55, 1.1]) {
        const lx = -8 + Math.sin(th) * 8.5, ly = -9 - Math.cos(th) * 8.5;
        const pa = P(1.0, 1.62, 0), pb = P(1.85, 1.62, 0);
        line(pa[0] + lx, pa[1] - 0.5 * lx + ly, pb[0] + lx, pb[1] - 0.5 * lx + ly, th === 0 ? 'rgba(255,255,255,.7)' : 'rgba(120,110,90,.45)', th === 0 ? 1.4 : 0.9);
      }
      const pa = P(1.0, 1.62, 0), pb = P(1.85, 1.62, 0);
      line(pa[0] - 16.5, pa[1] - 0.5 * -16.5 - 9, pb[0] - 16.5, pb[1] + 8.25 - 9, '#7a7260', 1);
      line(pa[0] + 0.5, pa[1] - 0.25 - 9 - 8.5, pb[0] + 0.5, pb[1] - 0.25 - 17.5, '#7a7260', 1);
      onR(1.85, 1.62, () => { ell(-8, -9, 8.5, 8.5); fs('#d8d4c4', '#7a7260', 1); for (let k = 0; k < 8; k++) { const a = k / 8 * TAU; line(-8, -9, -8 + Math.cos(a) * 7, -9 + Math.sin(a) * 7, 'rgba(120,110,90,.3)', 0.7); } });
      // runes on the step (glow drawn in anim)
      onL(1.85, 0.15, () => { for (let i = 0; i < 5; i++) { const x = 14 + i * 14; X.strokeStyle = 'rgba(40,120,150,.6)'; X.lineWidth = 1; X.beginPath(); X.moveTo(x, -5); X.lineTo(x + 3, -8); X.lineTo(x + 6, -5); X.moveTo(x + 3, -8); X.lineTo(x + 3, -4); X.stroke(); } });
      coralBranch(c1[0] - 8, c1[1], 12, '#ff7a6a', 21); kelpStrand(c3[0] + 14, c3[1] + 4, 40, '#5a8a2a', 2);
      ell(c2[0] + 6, c2[1] - 50, 5, 2.5); fs('#b060d0', '#5a2a6a', 0.7);
      coralClump(...P(1.82, 0.25, 3), 10, 22);
      for (const [u, v] of [[0.4, 0.95], [1.25, 1.35]]) { const p = P(u, v, 14); X.fillStyle = 'rgba(80,140,60,.55)'; ell(p[0], p[1], 8, 3); X.fill(); }
    },
    anim(b) {
      const t = b.t;
      onL(1.85, 0.15, () => { for (let i = 0; i < 5; i++) glow(17 + i * 14, -6, 7, '#40e0ff', 0.22 + 0.2 * Math.sin(t * 2 + i)); });
      const c = P(1.0, 0.5, 100); bubbles(c[0], c[1], t, { n: 3, h: 40, spread: 30, seed: 6 });
    },
  });

  // ================================================================ ICE (glacier park)
  const I = {
    snow: '#f4f8fb', snowS: '#c8dae8', ice: '#a8dcef', iceD: '#5aa8d0', stone: '#8a96a0', log: '#8a5a34', red: '#d8402a',
    green: '#3f8f5a', orange: '#e8742a', metal: '#8a96a0',
  };
  /** Snowy ground pad with soft drifts. */
  function snowPad(W, D, inset, seed) {
    groundShadow(W, D, 0.95);
    box(inset, inset, W - inset, D - inset, 0, 3, '#eef4f8', { stroke: '#b8cad8', top: '#f6fafc' });
    for (let i = 0; i < W + D; i++) {
      const p = P(inset + 0.1 + hash(i, seed) * (W - 2 * inset - 0.2), inset + 0.1 + hash(i, seed + 4) * (D - 2 * inset - 0.2), 3);
      ell(p[0], p[1], 9 + hash(i, seed + 2) * 8, 3.5); fs(lin(0, p[1] - 4, 0, p[1] + 4, [[0, '#ffffff'], [1, '#d8e6f0']]));
    }
  }
  function snowPile(x, y, r) {
    X.beginPath(); X.moveTo(x - r, y); X.quadraticCurveTo(x - r * 0.7, y - r * 0.6, x - r * 0.2, y - r * 0.55); X.quadraticCurveTo(x + r * 0.3, y - r * 0.8, x + r * 0.7, y - r * 0.35); X.quadraticCurveTo(x + r, y - r * 0.1, x + r, y); X.ellipse(x, y, r, r * 0.35, 0, 0, PI); X.closePath();
    fs(lin(0, y - r * 0.8, 0, y + r * 0.35, [[0, '#ffffff'], [1, '#c8dcea']]), '#a8bfd0', 0.9);
  }
  /** Quonset hangar with the arched roof along u (door at u1). */
  function quonset(u0, u1, v0, v1, col, endCol, seed) {
    const vm = (v0 + v1) / 2, rt = (v1 - v0) / 2, zh = rt * 62, n = 22;
    const pt = (u, th) => [u, vm + rt * Math.cos(th), 3 + zh * Math.sin(th)];
    for (let i = n - 1; i >= 0; i--) {
      const a = PI * i / n, b2 = PI * (i + 1) / n;
      ipath([pt(u0, a), pt(u1, a), pt(u1, b2), pt(u0, b2)]);
      const k = 0.18 * Math.sin((a + b2) / 2) - 0.22 * Math.cos((a + b2) / 2) + (i % 2 ? 0.05 : -0.04);
      fs(shade(col, k));
    }
    ipath([pt(u0, 0), pt(u1, 0)], true); fs(null, ink(col), 1.2);
    // end wall
    const end = []; for (let i = 0; i <= n; i++) end.push(pt(u1, PI * i / n));
    ipath(end); fs(faceGrad(endCol, P(u1, vm, 3 + zh)[1], P(u1, v1, 3)[1]), ink(endCol), 1.2);
    // snow on the crown
    const sn = [];
    for (let i = 5; i <= 17; i++) sn.push(pt(u0, PI * i / n));
    for (let i = 17; i >= 5; i--) sn.push(pt(u1, PI * i / n));
    ipath(sn); fs('rgba(255,255,255,.85)');
    return { vm, rt, zh };
  }
  /** Brazier: stone pedestal + fire bowl at ground (x, y). Returns flame anchor. */
  function stoneBrazier(x, y, h, r) {
    cyl(x, y, r * 0.75, h, '#8a929a', { tex: (cx, cy, R, hh) => { for (let z = 6; z < hh; z += 7) { X.beginPath(); X.ellipse(cx, cy - z, R, R / 2, 0, 0, PI); X.strokeStyle = 'rgba(40,50,60,.4)'; X.lineWidth = 0.8; X.stroke(); } }, top: '#a8b0b8' });
    fireBowl(x, y - h, r);
    return [x, y - h - r * 0.9];
  }
  function icePillar(u0, v0) {
    const u1 = u0 + 0.54, v1 = v0 + 0.6;
    box(u0 - 0.04, v0 - 0.04, u1 + 0.04, v1 + 0.04, 0, 14, '#7a8690', { tex: TX.stones(7, 3) });
    box(u0, v0, u1, v1, 14, 104, I.stone, { tex: TX.stones(11, u0 * 9 + 2) });
    snowTop(u0, v0, u1, v1, 104, 5, u0 * 3 + 1);
    icicles(P(u0, v1, 104), P(u1, v1, 104), 5, 9, u0 * 5);
    icicles(P(u1, v1, 104), P(u1, v0, 104), 4, 8, u0 * 5 + 2);
    snowPile(...P(u0 + 0.27, v1 + 0.08, 0), 16);
    const c = P(u0 + 0.27, v0 + 0.3, 106);
    X.fillStyle = '#2a2826'; X.fillRect(c[0] - 4, c[1] - 6, 8, 6);
    fireBowl(c[0], c[1] - 4, 16);
  }
  def('gate_ice', {
    W: 3, D: 2, H: 160, park: 'ice',
    draw(b) {
      snowPad(3, 2, 0.02, 3);
      pineTree(...P(0.2, 0.25, 3), 46, 1, true); pineTree(...P(2.85, 0.2, 3), 40, 2, true);
      icePillar(0.02, 0.7);
      // icy double gate
      const x0 = 0.56 * HX, x1 = 2.44 * HX, mid = (x0 + x1) / 2;
      const shape = () => { X.beginPath(); X.moveTo(x0, 0); X.lineTo(x0, -64); X.quadraticCurveTo(x0 + 10, -86, mid, -92); X.quadraticCurveTo(x1 - 10, -86, x1, -64); X.lineTo(x1, 0); X.closePath(); };
      extrudeL(0.93, 1.07, 0, 4, (k) => {
        shape();
        if (k < 1) fs('#4a88b0');
        else {
          fs(lin(x0, -92, x1, 0, [[0, 'rgba(230,250,255,.95)'], [0.45, 'rgba(150,215,240,.9)'], [1, 'rgba(80,160,210,.92)']]), '#2a6a90', 1.6);
          X.save(); shape(); X.clip();
          // crystal facets
          const rr = H.rng(7);
          for (let i = 0; i < 16; i++) { const x = x0 + rr() * (x1 - x0), y = -rr() * 88; spath([[x, y], [x + 6 + rr() * 8, y - 10 - rr() * 8], [x + 12 + rr() * 6, y + 2]]); fs(rr() > 0.5 ? 'rgba(255,255,255,.35)' : 'rgba(60,140,190,.25)'); }
          for (let i = 0; i < 6; i++) line(x0 + 8 + i * 14, -6, x0 + 14 + i * 14, -70, 'rgba(255,255,255,.45)', 1.2);
          X.restore();
          // iron frame
          X.strokeStyle = '#2a3a48'; X.lineWidth = 3;
          X.beginPath(); X.moveTo(mid, 0); X.lineTo(mid, -92); X.stroke();
          for (const z of [18, 50]) { X.fillStyle = '#2a3a48'; X.fillRect(x0, -z - 3, x1 - x0, 5); for (let i = 0; i < 9; i++) { ell(x0 + 6 + i * 10, -z - 0.5, 1, 1); X.fillStyle = '#a8b4c0'; X.fill(); } }
          for (const dx of [-6, 6]) { X.beginPath(); X.arc(mid + dx, -34, 4, 0, TAU); X.strokeStyle = '#a8b4c0'; X.lineWidth = 1.6; X.stroke(); }
        }
      });
      // frosted log beam with icicles
      box(0.56, 0.88, 2.44, 1.12, 92, 104, I.log, { tex: TX.logs(12) });
      snowTop(0.56, 0.88, 2.44, 1.12, 104, 4, 9);
      icicles(P(0.56, 1.12, 92), P(2.44, 1.12, 92), 14, 11, 4);
      icePillar(2.44, 0.7);
      // sign
      onL(1.36, 0, () => {
        for (const dx of [-30, 30]) { X.fillStyle = '#4a2c14'; X.fillRect(72 + dx - 2.5, -112, 5, 14); }
        rrect(20, -132, 104, 22, 6); fs(lin(0, -132, 0, -110, [[0, '#a8703a'], [1, '#6e4422']]), '#3a1e0a', 1.6);
        for (let i = 1; i < 3; i++) line(22, -132 + i * 7.3, 122, -132 + i * 7.3, 'rgba(50,25,8,.4)', 0.8);
        txt('CRÉTACÉ PARK', 72, -120.5, 13, '#ffe9b0', { maxW: 98, shadow: '#2a1406' });
        // snow on the board
        X.beginPath(); X.moveTo(20, -131); X.quadraticCurveTo(30, -138, 44, -134); X.quadraticCurveTo(60, -139, 78, -134); X.quadraticCurveTo(96, -139, 110, -134); X.quadraticCurveTo(122, -137, 124, -130); X.lineTo(124, -128); X.quadraticCurveTo(100, -131, 72, -129); X.quadraticCurveTo(44, -131, 20, -128); X.closePath();
        fs('#ffffff', '#a8bfd0', 0.8);
        // snowflake emblem
        const ex = 72, ey = -146;
        ell(ex, ey, 10, 10); fs(lin(0, ey - 10, 0, ey + 10, [[0, '#e8f8ff'], [1, '#7ac0e0']]), '#2a5a7a', 1.4);
        X.strokeStyle = '#1f5a82'; X.lineWidth = 1.6; X.lineCap = 'round';
        for (let i = 0; i < 6; i++) { const a = i * PI / 3; X.beginPath(); X.moveTo(ex, ey); X.lineTo(ex + Math.cos(a) * 7, ey + Math.sin(a) * 7); X.moveTo(ex + Math.cos(a) * 4, ey + Math.sin(a) * 4); X.lineTo(ex + Math.cos(a + 0.5) * 6, ey + Math.sin(a + 0.5) * 6); X.stroke(); }
        board(72, -100, 50, 9, 'GRAND NORD', 'ice', 6.5);
      });
      snowPile(...P(0.4, 1.75, 3), 18); snowPile(...P(2.6, 1.8, 3), 16);
    },
    anim(b) {
      for (const [u, s] of [[0.29, 1], [2.71, 2]]) {
        const c = P(u, 1.0, 106);
        flame(c[0], c[1] - 18, 14, b.t, s, { glowR: 2.8 });
        smoke(c[0], c[1] - 46, b.t, { n: 5, seed: s, rise: 36, col: '#c8c4c0', a: 0.35 });
      }
    },
  });

  def('harbor_ice', {
    W: 4, D: 3, H: 150, park: 'ice', padX: 30,
    draw(b) {
      groundShadow(4, 3, 0.95);
      // water (back band)
      ipath([[0.04, 0.04, 3], [3.96, 0.04, 3], [3.96, 0.04, -10], [0.04, 0.04, -10]]); fs('#6a7680', '#3a444c', 1);
      ipath([[0.04, 0.04, -6], [3.96, 0.04, -6], [3.96, 0.92, -6], [0.04, 0.92, -6]]);
      fs(lin(...P(0, 0, -6), ...P(4, 0.9, -6), [[0, '#2a5a72'], [0.5, '#3a7a92'], [1, '#1f4a62']]));
      for (const [u, v, r] of [[0.6, 0.3, 10], [3.4, 0.5, 13], [1.4, 0.7, 7]]) { const p = P(u, v, -5); ell(p[0], p[1], r, r * 0.45); fs('#f4f8fb', '#a8bfd0', 0.8); }
      ipath([[0.04, 0.04, 3], [3.96, 0.04, 3]], true); fs(null, '#e8eef2', 2.5);
      hovercraftAt(3.1, -0.02, 0.7, -4);
      // apron
      box(0.04, 0.92, 3.96, 2.96, 0, 3, '#aab2b8', { texTop: TT.paving(2, '#aab2b8'), stroke: '#6a747c' });
      ipath([[1.3, 0.98, 3], [3.96, 0.98, 3]], true); fs(null, '#f0c020', 1.6);
      for (let u = 1.55; u < 3.9; u += 0.45) { const p = P(u, 0.99, 3); cyl(p[0], p[1], 2.6, 5, '#3a4048', { top: '#5a626a' }); }
      slab(1.3, 2.0, 3.96, 2.4, 3, 3.6, '#5a6268');
      ipath([[1.3, 2.2, 3.6], [3.96, 2.2, 3.6]], true); X.setLineDash([6, 6]); fs(null, '#f4f4f4', 1.2); X.setLineDash([]);
      // cliff + tunnel (back left)
      box(0.04, 0.92, 1.3, 2.96, 3, 74, '#7a8088', { tex: both(TX.stones(14, 5), (len, z0, z1) => { for (let i = 0; i < 7; i++) { const x = hash(i, 3) * len, z = 10 + hash(i, 4) * 50; X.fillStyle = 'rgba(255,255,255,.75)'; X.beginPath(); X.ellipse(x, -z, 6, 2.2, 0, 0, TAU); X.fill(); } }) });
      onR(1.3, 2.96, () => {
        const tx = 0.8 * HX;
        X.beginPath(); X.moveTo(tx - 26, 0); X.lineTo(tx - 26, -30); X.arc(tx, -30, 26, PI, 0); X.lineTo(tx + 26, 0); X.closePath(); fs('#c8ccd0', '#4a5058', 1.4);
        X.beginPath(); X.moveTo(tx - 20, 0); X.lineTo(tx - 20, -30); X.arc(tx, -30, 20, PI, 0); X.lineTo(tx + 20, 0); X.closePath(); fs(rad(tx, -10, 2, 40, [[0, '#0a0e12'], [1, '#2a3038']]));
        for (let i = 0; i < 5; i++) { ell(tx - 12 + i * 6, -40, 1.2, 1.2); X.fillStyle = '#ffe680'; X.fill(); }
      });
      // rocky crest with snow
      snowTop(0.04, 0.92, 1.3, 2.96, 74, 5, 6);
      for (const [u, v, r] of [[0.3, 1.2, 18], [0.95, 1.15, 14], [0.4, 2.0, 20], [1.0, 2.3, 13], [0.55, 2.7, 16]]) { const p = P(u, v, 74); rock(p[0], p[1], r, r * 0.8, '#7a8088', u * 10 + v); snowPile(p[0] - 2, p[1] - r * 0.55, r * 0.8); }
      icicles(P(1.3, 2.96, 74), P(1.3, 0.92, 74), 12, 12, 3);
      // tunnel sign on brackets, in front of the icicles
      onR(1.3, 2.96, () => {
        const tx = 0.8 * HX;
        for (const dx of [-16, 16]) { X.fillStyle = '#3a4048'; X.fillRect(tx + dx - 1, -64, 2, 9); }
        board(tx, -64, 50, 11, 'TUNNEL', 'hazard', 7.5);
      });
      // hangars
      quonset(1.55, 2.6, 1.05, 1.8, '#c8402a', '#e4e0da', 1);
      onR(2.6, 1.8, () => { X.fillStyle = '#5a6268'; X.fillRect(8, -26, 20, 23); for (let z = 5; z < 26; z += 3) line(8, -z, 28, -z, 'rgba(0,0,0,.25)', 0.8); });
      onR(2.61, 1.8, () => board(18, -36, 34, 9, 'PORT', 'red', 7.5));
      quonset(2.85, 3.85, 1.0, 1.75, '#3f8f5a', '#e4e0da', 2);
      onR(3.85, 1.75, () => { X.fillStyle = '#5a6268'; X.fillRect(8, -24, 20, 21); for (let z = 5; z < 24; z += 3) line(8, -z, 28, -z, 'rgba(0,0,0,.25)', 0.8); });
      box(2.05, 1.2, 2.15, 1.3, 30, 44, '#5a5a5a', {});
      // containers
      const cc = ['#c8402a', '#2f6aa8', '#e8b830', '#3f8f4a'];
      container(1.6, 2.45, 2.3, 2.75, 3, cc[1]); container(2.4, 2.45, 3.1, 2.75, 3, cc[0]); container(1.65, 2.45, 2.35, 2.75, 18, cc[2]);
      snowTop(1.65, 2.45, 2.35, 2.75, 33, 3, 2);
      container(2.45, 2.47, 3.05, 2.73, 18, cc[3]); snowTop(2.45, 2.47, 3.05, 2.73, 33, 3, 4);
      // lamp posts
      for (const [u, v] of [[1.45, 2.85], [3.9, 0.98]]) lamp(...P(u, v, 3), 34, true);
      // the hovercraft that just arrived on the apron
      hovercraftAt(3.02, 1.98, 0.92, 3.6);
    },
    anim(b) {
      const t = b.t;
      const c = P(2.1, 1.25, 44); smoke(c[0], c[1], t, { n: 5, rise: 34, col: '#b8b8b8', a: 0.4, seed: 2 });
      hovercraftFan(3.1, -0.02, 0.7, -4, t); hovercraftFan(3.02, 1.98, 0.92, 3.6, t);
      for (const [u, v] of [[1.45, 2.85], [3.9, 0.98]]) { const p = P(u, v, 3); glow(p[0], p[1] - 42, 14, '#ffe6a0', 0.35); }
      X.save(); ipath([[0.04, 0.04, -6], [3.96, 0.04, -6], [3.96, 0.92, -6], [0.04, 0.92, -6]]); X.clip();
      for (let i = 0; i < 6; i++) { const p = P(0.3 + hash(i, 2) * 3.4, 0.1 + hash(i, 5) * 0.75, -6), k = fract(t * 0.25 + hash(i, 7)); ell(p[0], p[1], 5 + k * 8, (5 + k * 8) * 0.3); fs(null, `rgba(220,245,255,${0.45 * (1 - k)})`, 1); }
      X.restore();
    },
  });

  /** Points of a rounded rectangle in tile space (centre uc, vc; half sizes a × b; corner radius r),
      sampled by outward-normal angle from a0 to a1 (full outline: 0 → TAU). */
  function rrUV(uc, vc, a, b, r, a0, a1, n) {
    const pts = [];
    for (let i = 0; i < n; i++) {
      const an = a0 + (i + 0.5) / n * (a1 - a0), cs = Math.cos(an), sn = Math.sin(an);
      pts.push([uc + (cs >= 0 ? 1 : -1) * (a - r) + cs * r, vc + (sn >= 0 ? 1 : -1) * (b - r) + sn * r]);
    }
    return pts;
  }
  /** Convex hull of screen points (monotone chain). */
  function hull2(pts) {
    const p = pts.slice().sort((A, B) => A[0] - B[0] || A[1] - B[1]);
    const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], up = [];
    for (const q of p) { while (lo.length > 1 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
    for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length > 1 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
    return lo.slice(0, -1).concat(up.slice(0, -1));
  }
  /** Solid extruded from a convex (u, v) outline between heights z0 and z1 (side silhouette + top face). */
  function prism(outline, z0, z1, side, top, st, lw) {
    const scr = [];
    for (const [u, v] of outline) { scr.push(P(u, v, z0)); scr.push(P(u, v, z1)); }
    spath(hull2(scr)); fs(side, st, lw || 1);
    spath(outline.map(([u, v]) => P(u, v, z1))); fs(top, st, lw || 1);
  }

  /** Hovercraft drawn in the iso frame at (u0, v0), scale s (1 = one tile), base height z0.
      Bow towards +u: black inflatable skirt, orange hull, white cabin, twin ducted fans with rudders at the stern. */
  const HOVER_FANS = [0.35, 0.65], HOVER_R = 6.6;
  function hovercraftAt(u0, v0, s, z0) {
    const U = (u) => u0 + u * s, V = (v) => v0 + v * s, Z = (z) => z0 + z * s;
    const uc = U(0.5), vc = V(0.5);
    const c = P(uc, vc, Z(0));
    blob(c[0], c[1] + 3 * s, 42 * s, 17 * s, 0.3);
    const xL = P(U(0.07), V(0.8), 0)[0], xR = P(U(0.93), V(0.2), 0)[0];
    // inflatable skirt
    prism(rrUV(uc, vc, 0.44 * s, 0.3 * s, 0.25 * s, 0, TAU, 44), Z(0), Z(8),
      lin(xL, 0, xR, 0, [[0, '#121416'], [0.55, '#2e3238'], [0.8, '#3a3f46'], [1, '#1a1c20']]), '#3a3e45', '#08090a', 1.1);
    spath(rrUV(uc, vc, 0.44 * s, 0.3 * s, 0.25 * s, -PI / 4, PI * 0.75, 18).map(([u, v]) => P(u, v, Z(5.5))), true);
    fs(null, 'rgba(255,255,255,.16)', 1.6 * s);
    // hull
    const hullC = I.orange;
    prism(rrUV(uc, vc, 0.38 * s, 0.24 * s, 0.18 * s, 0, TAU, 40), Z(8), Z(13),
      lin(xL, 0, xR, 0, [[0, shade(hullC, -0.3)], [0.6, hullC], [1, shade(hullC, -0.12)]]), shade(hullC, 0.2), ink(hullC), 1);
    spath(rrUV(uc, vc, 0.38 * s, 0.24 * s, 0.18 * s, -PI / 4, PI * 0.75, 18).map(([u, v]) => P(u, v, Z(10.3))), true);
    fs(null, '#f8f4ea', 1.5 * s);
    // deck plates + bollards
    for (const [u, v] of [[0.8, 0.36], [0.8, 0.64], [0.3, 0.3], [0.3, 0.7]]) { const p = P(U(u), V(v), Z(13)); ell(p[0], p[1] - 1 * s, 1.6 * s, 1.1 * s); fs('#d8dde2', '#2a2e32', 0.6); }
    // stern: rudders, then twin ducted fans
    for (const fv of HOVER_FANS) {
      onL(V(fv), U(0.04), () => {
        rrect(0, -Z(32), 0.11 * HX * s, Z(32) - Z(13), 1.5 * s); fs(lin(0, -Z(32), 0, -Z(13), [[0, '#ff9a4a'], [1, '#c8541a']]), '#5a2a0a', 0.9);
      });
    }
    const R = HOVER_R * s, zc = Z(13) + 4 * s + R;
    for (let k = 0; k <= 4; k++) {
      onR(U(0.12 + k * 0.035), V(0.8), () => {
        for (const fv of HOVER_FANS) {
          const x = (0.8 - fv) * HX * s;
          if (k === 0) { line(x - R * 0.5, -zc + R * 0.7, x - R * 0.7, -Z(13), '#3a3e44', 1.8 * s); line(x + R * 0.5, -zc + R * 0.7, x + R * 0.7, -Z(13), '#3a3e44', 1.8 * s); }
          ell(x, -zc, R, R);
          if (k < 4) fs(null, k % 2 ? '#aab3ba' : '#8a949c', 3.6 * s);
          else {
            fs('rgba(20,26,34,.6)');
            ell(x, -zc, R, R); fs(null, '#e8ecef', 3.4 * s);
            ell(x, -zc, R + 1.7 * s, R + 1.7 * s); fs(null, '#5a646c', 0.7 * s);
            ell(x, -zc, R - 1.7 * s, R - 1.7 * s); fs(null, '#3a4048', 0.7 * s);
            X.beginPath(); X.arc(x, -zc, R, PI * 0.15, PI * 0.45); X.strokeStyle = I.orange; X.lineWidth = 3.4 * s; X.stroke();
            line(x - R, -zc, x + R, -zc, 'rgba(200,210,220,.5)', 0.6 * s); line(x, -zc - R, x, -zc + R, 'rgba(200,210,220,.5)', 0.6 * s);
          }
        }
      });
    }
    // cabin
    box(U(0.44), V(0.32), U(0.8), V(0.68), Z(13), Z(26), '#f2f0ea', { lw: 0.9 });
    const glass = () => lin(0, -Z(25), 0, -Z(18), [[0, '#c8f4ff'], [0.5, '#5ab4d8'], [1, '#2a6a90']]);
    onR(U(0.8), V(0.68), () => {
      X.fillStyle = glass(); X.fillRect(2.2 * s, -Z(25), 0.36 * HX * s - 4.4 * s, 7 * s);
      line(0.18 * HX * s, -Z(25), 0.18 * HX * s, -Z(18), '#f2f0ea', 1.2 * s);
      X.fillStyle = 'rgba(255,255,255,.55)'; X.fillRect(3 * s, -Z(24.5), 4 * s, 1.2 * s);
    });
    onL(V(0.68), U(0.44), () => {
      for (let i = 0; i < 3; i++) { rrect((2.5 + i * 5.6) * s, -Z(24.5), 4.4 * s, 5.5 * s, 1.2 * s); fs(glass(), '#2a4a60', 0.6); }
      X.fillStyle = I.red; X.fillRect(0, -Z(16.5), 0.36 * HX * s, 2 * s);
    });
    // roof: beacon + antenna
    const rp = P(U(0.62), V(0.5), Z(26));
    ell(rp[0], rp[1] - 1.5 * s, 3 * s, 2.2 * s); fs('#ffb020', '#6a4408', 0.7);
    line(...P(U(0.5), V(0.4), Z(26)), P(U(0.5), V(0.4), Z(38))[0], P(U(0.5), V(0.4), Z(38))[1], '#3a3e44', 0.9 * s);
  }
  /** Animated parts of hovercraftAt: spinning fan blades, roof beacon and air-cushion spray. */
  function hovercraftFan(u0, v0, s, z0, t) {
    const U = (u) => u0 + u * s, V = (v) => v0 + v * s, Z = (z) => z0 + z * s;
    const R = HOVER_R * s, zc = Z(13) + 4 * s + R;
    onR(U(0.26), V(0.8), () => {
      HOVER_FANS.forEach((fv, j) => {
        const x = (0.8 - fv) * HX * s;
        for (let i = 0; i < 3; i++) { const a = t * 15 * (j ? -1 : 1) + i * TAU / 3; X.save(); X.translate(x, -zc); X.rotate(a); ell(R * 0.45, 0, R * 0.45, R * 0.17); fs('rgba(70,74,80,.8)'); X.restore(); }
        ell(x, -zc, 1.6 * s, 1.6 * s); fs('#d8dce0');
      });
    });
    const rp = P(U(0.62), V(0.5), Z(26)), on = Math.sin(t * 7) > 0;
    if (on) glow(rp[0], rp[1] - 2 * s, 14 * s, '#ffb020', 0.55);
    // spray / snow dust puffed out by the air cushion
    for (let i = 0; i < 7; i++) {
      const p = fract(t * 0.9 + i / 7), an = -PI / 4 + hash(i, 5) * PI;
      const q = rrUV(U(0.5), V(0.5), (0.44 + p * 0.12) * s, (0.3 + p * 0.12) * s, (0.25 + p * 0.12) * s, an, an + 1e-3, 1)[0];
      const pt = P(q[0], q[1], Z(1 + p * 4));
      ell(pt[0], pt[1], (2 + p * 4) * s, (1.2 + p * 2) * s); X.fillStyle = `rgba(255,255,255,${0.55 * (1 - p)})`; X.fill();
    }
  }

  def('lab_ice', {
    W: 3, D: 3, H: 150, park: 'ice',
    draw(b) {
      snowPad(3, 3, 0.04, 7);
      // wind turbine pole (back right)
      const wp = P(2.6, 0.45, 3);
      X.fillStyle = lin(wp[0] - 3, 0, wp[0] + 3, 0, [[0, '#b8c0c8'], [0.6, '#ffffff'], [1, '#c8d0d6']]);
      X.beginPath(); X.moveTo(wp[0] - 3.5, wp[1]); X.lineTo(wp[0] - 1.6, wp[1] - 112); X.lineTo(wp[0] + 1.6, wp[1] - 112); X.lineTo(wp[0] + 3.5, wp[1]); X.closePath(); X.fill();
      ell(wp[0] + 2, wp[1] - 114, 6, 3.5); fs('#e8ecef', '#6a747c', 1);
      // stilts + main module
      for (const [u, v] of [[0.55, 1.5], [1.25, 1.5], [2.0, 1.5], [2.0, 0.62]]) { const p = P(u, v, 3); X.fillStyle = '#3a4048'; X.fillRect(p[0] - 1.8, p[1] - 16, 3.6, 16); }
      box(0.45, 0.55, 2.1, 1.55, 16, 58, I.red, { tex: both(TX.panels(12), (len, z0, z1) => { X.fillStyle = '#f4f4f0'; X.fillRect(0, -21, len, 4); }) });
      onL(1.55, 0.45, () => { for (let x = 8; x < 1.65 * HX - 10; x += 14) { if (x > 30 && x < 56) continue; X.fillStyle = '#2a3a48'; X.fillRect(x, -36, 9, 9); X.fillStyle = lin(x, -36, x + 9, -27, [[0, '#ffe8a0'], [1, '#e0a040']]); X.fillRect(x + 1, -35, 7, 7); } });
      onR(2.1, 1.55, () => { for (let x = 8; x < HX - 4; x += 14) { X.fillStyle = '#2a3a48'; X.fillRect(x, -36, 9, 9); X.fillStyle = lin(x, -36, x + 9, -27, [[0, '#c8f0ff'], [1, '#3a7aa0']]); X.fillRect(x + 1, -35, 7, 7); } });
      // lab sign (the DNA helix inside it is animated)
      onL(1.56, 0.45, () => { board(19, -47, 46, 15, '', 'navy'); txt('ADN', 26, -46.5, 10.5, '#ffe680', { shadow: '#081626' }); });
      snowTop(0.45, 0.55, 2.1, 1.55, 58, 5, 3);
      icicles(P(0.45, 1.55, 16), P(2.1, 1.55, 16), 10, 8, 2);
      // radome
      const rp = P(0.85, 0.9, 62);
      cyl(rp[0], rp[1], 9, 8, '#c8d0d6', {});
      ell(rp[0], rp[1] - 26, 22, 21); fs(rad(rp[0] + 6, rp[1] - 34, 2, 26, [[0, '#ffffff'], [0.6, '#e4eaee'], [1, '#a8b4bc']]), '#6a747c', 1.2);
      X.save(); ell(rp[0], rp[1] - 26, 22, 21); X.clip(); X.strokeStyle = 'rgba(120,130,140,.45)'; X.lineWidth = 0.8;
      for (let i = -3; i <= 3; i++) { X.beginPath(); X.ellipse(rp[0], rp[1] - 26, Math.abs(i) * 6 + 0.1, 21, 0, 0, TAU); X.stroke(); X.beginPath(); X.moveTo(rp[0] - 22, rp[1] - 26 + i * 6); X.lineTo(rp[0] + 22, rp[1] - 26 + i * 6); X.stroke(); }
      X.restore();
      // antenna mast
      const am = P(1.8, 0.75, 62); line(am[0], am[1], am[0], am[1] - 44, '#5a6268', 1.6); for (let k = 1; k < 4; k++) line(am[0] - 4 + k, am[1] - k * 11, am[0] + 4 - k, am[1] - k * 11, '#5a6268', 1);
      // second module
      for (const [u, v] of [[1.75, 2.4], [2.6, 2.4], [2.6, 1.5]]) { const p = P(u, v, 3); X.fillStyle = '#3a4048'; X.fillRect(p[0] - 1.8, p[1] - 12, 3.6, 12); }
      box(1.7, 1.45, 2.65, 2.45, 12, 46, '#eef0ee', { tex: both(TX.panels(10), (len) => { X.fillStyle = '#2f6aa8'; X.fillRect(0, -36, len, 4); }) });
      onL(2.45, 1.7, () => { door(12, -40, 14, 26, '#9aa8b0', { glass: true, lit: true }); X.fillStyle = '#2a3a48'; X.fillRect(32, -32, 9, 9); X.fillStyle = '#ffe8a0'; X.fillRect(33, -31, 7, 7); });
      // stairs to the door
      for (let i = 0; i < 4; i++) box(1.95, 2.45 + i * 0.1, 2.25, 2.55 + i * 0.1, 3, 12 - i * 3, '#7a848c', { hi: false });
      snowTop(1.7, 1.45, 2.65, 2.45, 46, 5, 5);
      icicles(P(1.7, 2.45, 12), P(2.65, 2.45, 12), 6, 7, 6);
      const dp = P(2.25, 1.85, 50); box(2.2, 1.8, 2.3, 1.9, 46, 54, '#7a848c', {});
      for (const [u, v] of [[0.3, 2.6], [2.8, 2.7]]) snowPile(...P(u, v, 3), 14);
      // cryogenic DNA tanks (front left) linked to the lab by a pipe
      const pa = P(0.5, 1.98, 24), pb = P(0.62, 1.55, 24);
      line(pa[0], pa[1], pb[0], pb[1], '#5a646c', 3.2); line(pa[0], pa[1], pb[0], pb[1], '#aab4bc', 1.6);
      for (const [u, v, R, h] of [[0.42, 2.12, 11, 34], [1.02, 2.08, 9, 26]]) {
        const p = P(u, v, 3);
        blob(p[0], p[1] + 1, R + 4, (R + 4) * 0.45, 0.25);
        cyl(p[0], p[1], R, h, '#e8eef2', {
          top: '#f8fbfd',
          tex: (x, y, RR, hh) => {
            for (const z of [hh * 0.25, hh * 0.7]) { X.beginPath(); X.ellipse(x, y - z, RR, RR * 0.5, 0, 0, PI); X.strokeStyle = '#2f6aa8'; X.lineWidth = 3; X.stroke(); }
            for (let i = 0; i < 4; i++) { ell(x - RR * 0.5 + hash(i, u * 10) * RR, y - hh * (0.35 + hash(i, v * 10) * 0.25), 1.6, 1.2); X.fillStyle = 'rgba(255,255,255,.8)'; X.fill(); }
          },
        });
        ell(p[0], p[1] - h - 2, R * 0.35, R * 0.18); fs('#9aa4ac', '#4a545c', 0.8);
        snowPile(p[0] - R * 0.2, p[1] - h - 1, R * 0.6);
      }
      board(...P(0.42, 2.12, 18), 18, 8, '-196°', 'ice', 5.5);
    },
    anim(b) {
      const t = b.t;
      // wind turbine blades
      const wp = P(2.6, 0.45, 3), hx = wp[0] + 6, hy = wp[1] - 114;
      for (let i = 0; i < 3; i++) {
        const a = t * 1.6 + i * TAU / 3;
        X.save(); X.translate(hx, hy); X.rotate(a);
        X.beginPath(); X.moveTo(0, -1.5); X.quadraticCurveTo(14, -3.5, 30, -0.5); X.lineTo(30, 0.6); X.quadraticCurveTo(14, 2, 0, 1.5); X.closePath();
        fs('#f4f6f8', '#6a747c', 0.8);
        X.restore();
      }
      ell(hx, hy, 2.6, 2.6); fs('#c8d0d6', '#4a545c', 0.8);
      // satellite dish
      const dp = P(2.25, 1.85, 54), a = t * 0.9, ca = Math.cos(a), rx = 2 + 11 * Math.abs(ca);
      ell(dp[0], dp[1] - 8, rx, 8); fs(ca > 0 ? '#f4f6f8' : '#9aa4ac', '#4a545c', 1);
      line(dp[0], dp[1] - 8, dp[0] + Math.sin(a) * 8, dp[1] - 14, '#4a545c', 1.2);
      // blinking light + DNA helix next to the sign
      const am = P(1.8, 0.75, 106), on = Math.sin(t * 3) > 0.3;
      ell(am[0], am[1], 2, 2); fs(on ? '#ff4a3a' : '#7a2018'); if (on) glow(am[0], am[1], 8, '#ff4a3a', 0.6);
      onL(1.56, 0.45, () => dnaHelix(5.5, -52.5, 11, 2.6, t));
    },
  });

  def('arena_ice', {
    W: 4, D: 4, H: 175, park: 'ice',
    draw(b) {
      arena(b, {
        wall: '#9fd4ea', rim: '#f4f8fb', riser: '#8fb0c4', floor: '#cdeefa', h: 50,
        tiers: ['#e8f0f6', '#d6e4ee', '#e8f0f6', '#d6e4ee'],
        crowd: ['#d8402a', '#2f6aa8', '#f0c030', '#3f8f5a', '#ffffff', '#8a4ac0'],
        base(cx, cy, R) { ell(cx, cy + 2, R + 10, (R + 10) * 0.5); fs('#eef4f8', '#a8bfd0', 1.2); },
        wallTex: (cx, cy, R, h) => {
          for (let row = 0; row < 4; row++) {
            const z0 = row * h / 4, z1 = (row + 1) * h / 4;
            for (let i = 0; i < 14; i++) {
              const a0 = PI * (i + (row % 2) * 0.5) / 14, a1 = PI * (i + 1 + (row % 2) * 0.5) / 14;
              if (a0 >= PI) continue;
              const p0 = cylPt(cx, cy, R, a0, z0), p1 = cylPt(cx, cy, R, Math.min(PI, a1), z0);
              spath([p0, p1, [p1[0], p1[1] - (z1 - z0)], [p0[0], p0[1] - (z1 - z0)]]);
              fs(hash(i, row) > 0.5 ? 'rgba(255,255,255,.18)' : 'rgba(40,110,160,.12)', 'rgba(255,255,255,.6)', 0.8);
            }
          }
          for (let i = 0; i < 6; i++) { const a = PI * (0.1 + i * 0.16), p = cylPt(cx, cy, R, a, 12); line(p[0], p[1], p[0] + 4, p[1] - 22, 'rgba(255,255,255,.55)', 1.4); }
        },
        floorDeco(x, y, r) {
          X.save(); X.translate(x, y); X.scale(1, 0.5);
          X.beginPath(); X.arc(0, 0, r * 0.8, 0, TAU); X.strokeStyle = 'rgba(80,160,210,.5)'; X.lineWidth = 3; X.stroke();
          X.beginPath(); X.moveTo(-r * 0.5, -r * 0.2); X.lineTo(-r * 0.1, r * 0.1); X.lineTo(r * 0.3, -r * 0.15); X.lineTo(r * 0.6, r * 0.2); X.strokeStyle = 'rgba(255,255,255,.7)'; X.lineWidth = 1.5; X.stroke();
          X.restore();
          ell(x + r * 0.3, y - r * 0.12, r * 0.25, r * 0.06); fs('rgba(255,255,255,.55)');
        },
        poles: [PI * 1.15, PI * 1.5, PI * 1.85, PI * 0.12, PI * 0.88],
        pole(x, y, front, a) { fireBowl(x, y - 2, 9); },
        gate(cx, cy, R, h) {
          box(3.18, 3.18, 3.78, 3.78, 0, 64, '#b8e4f4', { tex: TX.ice(10, 3) });
          for (const side of ['L', 'R']) {
            const f = () => { X.beginPath(); X.moveTo(8, 0); X.lineTo(8, -32); X.arc(14.5, -32, 6.5, PI, 0); X.lineTo(21, 0); X.closePath(); fs(rad(14.5, -14, 2, 26, [[0, '#ffd890'], [1, '#2a4a62']]), '#2a5a7a', 1.2); };
            if (side === 'L') onL(3.78, 3.18, f); else onR(3.78, 3.78, f);
          }
          snowTop(3.18, 3.18, 3.78, 3.78, 64, 6, 4);
          icicles(P(3.18, 3.78, 64), P(3.78, 3.78, 64), 6, 9, 1); icicles(P(3.78, 3.78, 64), P(3.78, 3.18, 64), 6, 9, 2);
          const p = P(3.78, 3.78, 0);
          for (const dx of [-20, 20]) { X.fillStyle = '#5a3a1a'; X.fillRect(p[0] + dx - 1.5, p[1] - 92, 3, 18); }
          board(p[0], p[1] - 98, 64, 16, 'ARÈNE', 'ice', 12);
        },
        front(cx, cy, R, h) { X.beginPath(); for (let i = 0; i < 26; i++) { const a = 0.15 + i * (PI - 0.3) / 25, q = cylPt(cx, cy, R, a, h); icicles([q[0] - 3, q[1] + 1], [q[0] + 3, q[1] + 1], 1, 10, i); } },
      });
    },
    anim(b) {
      const c = P(2, 2, 0), R = 145, h = 50, t = b.t;
      [PI * 1.15, PI * 1.5, PI * 1.85, PI * 0.12, PI * 0.88].forEach((a, i) => {
        const x = c[0] + Math.cos(a) * R, y = c[1] - h + Math.sin(a) * R * 0.5 - 2;
        flame(x, y - 8, 7, t, i + 1, { glowR: 2.6, sparks: false });
      });
      for (let i = 0; i < 3; i++) {
        const p = fract(t * 0.7 + i * 0.37);
        if (p > 0.12) continue;
        const a = PI + 0.3 + hash(Math.floor(t * 0.7 + i * 0.37), i) * (PI - 0.6), rr = 110 - (i % 3) * 14;
        sparkle(c[0] + Math.cos(a) * rr, c[1] - 42 + Math.sin(a) * rr * 0.5, 5, 1 - p / 0.12, '#ffffff');
      }
      sparkle(c[0] + 30, c[1] - 24, 4, 0.5 + 0.5 * Math.sin(t * 2), '#ffffff');
    },
  });

  // ---------------------------------------------------------------- ice food buildings
  def('hunter_lodge', {
    W: 2, D: 2, H: 95, park: 'ice', grow: true,
    draw(b) {
      snowPad(2, 2, 0.05, 11);
      box(0.28, 0.25, 1.3, 1.22, 3, 40, I.log, { tex: TX.logs(6.5) });
      onR(1.3, 1.22, () => win(12, -32, 13, 13, { lit: true, frame: '#5a3a1a' }));
      onL(1.22, 0.28, () => {
        door(26, -31, 15, 28, '#6a4422', { double: false });
        // antlers above the door
        X.strokeStyle = '#efe4c8'; X.lineWidth = 2; X.lineCap = 'round';
        for (const sd of [-1, 1]) { X.beginPath(); X.moveTo(33.5, -35); X.quadraticCurveTo(33.5 + sd * 6, -40, 33.5 + sd * 10, -46); X.moveTo(33.5 + sd * 5, -38.5); X.lineTo(33.5 + sd * 4, -44); X.moveTo(33.5 + sd * 8, -42); X.lineTo(33.5 + sd * 11, -42); X.stroke(); }
        ell(33.5, -35, 2.5, 2); fs('#5a3a1a');
        win(7, -30, 11, 11, { lit: true, frame: '#5a3a1a' });
      });
      gable('u', 0.28, 0.25, 1.3, 1.22, 40, 62, '#6a4a3a', { gable: '#9a6a44', snow: true, type: 'tiles' });
      icicles(P(0.18, 1.32, 40), P(1.4, 1.32, 40), 10, 8, 3);
      box(0.45, 0.85, 0.63, 1.03, 52, 74, '#8a8e94', { tex: TX.stones(5, 2) }); snowTop(0.45, 0.85, 0.63, 1.03, 74, 3, 2);
      // drying rack with meat
      const r0 = P(1.68, 0.4, 3), r1 = P(1.68, 1.65, 3);
      for (const p of [r0, r1]) { line(p[0] - 5, p[1], p[0], p[1] - 34, '#6a4a2a', 2.6); line(p[0] + 5, p[1], p[0], p[1] - 34, '#6a4a2a', 2.6); }
      line(r0[0], r0[1] - 33, r1[0], r1[1] - 33, '#7a5a3a', 2.4);
      const n = 2 + Math.round(5 * b.g);
      for (let i = 0; i < n; i++) {
        const f = (i + 0.7) / (n + 0.4), x = lerp(r0[0], r1[0], f), y = lerp(r0[1], r1[1], f) - 33;
        X.beginPath(); X.moveTo(x - 2.5, y); X.lineTo(x + 2.5, y); X.lineTo(x + 1.5 + Math.sin(i) * 1.5, y + 14 + (i % 3) * 3); X.lineTo(x - 2 + Math.sin(i) * 1.5, y + 13 + (i % 3) * 3); X.closePath();
        fs(lin(x - 3, 0, x + 3, 0, [[0, '#6a1a12'], [0.6, '#b8402a'], [1, '#7a2a1a']]), '#3a0a06', 0.8);
      }
      // firewood
      const fw = P(0.35, 1.62, 3);
      for (let r = 0; r < 3; r++) for (let i = 0; i < 4 - r; i++) { const x = fw[0] + i * 7 + r * 3.5 - 10, y = fw[1] - 4 - r * 6; ell(x, y, 3.6, 3.6); fs(rad(x, y, 0.5, 3.6, [[0, '#e8c890'], [0.6, '#b08050'], [1, '#6a4422']]), '#3a2410', 0.8); }
      snowPile(...P(1.1, 1.75, 3), 12);
      const sg = P(1.8, 1.85, 3);
      X.fillStyle = '#6a4422'; X.fillRect(sg[0] - 1.2, sg[1] - 20, 2.4, 20);
      board(sg[0], sg[1] - 22, 42, 11, 'PISTEUR', 'wood', 8);
    },
    anim(b) {
      const c = P(0.54, 0.94, 74); smoke(c[0], c[1], b.t, { n: 6, rise: 40, col: '#d8d8d8', a: 0.5, seed: 3 });
      onL(1.22, 0.28, () => glow(14, -26, 12, '#ffc860', 0.25 + 0.08 * Math.sin(b.t * 7)));
    },
  });

  def('cold_storage', {
    W: 2, D: 2, H: 85, park: 'ice', grow: true,
    draw(b) {
      snowPad(2, 2, 0.05, 13);
      box(0.25, 0.25, 1.75, 1.45, 3, 52, '#dfe8ee', { tex: both(TX.panels(11), (len) => { X.fillStyle = '#2f6aa8'; X.fillRect(0, -10, len, 6); }) });
      onL(1.45, 0.25, () => {
        // half-open door with hanging meat inside
        X.fillStyle = lin(0, -40, 0, -4, [[0, '#1a2a38'], [1, '#3a5a70']]); X.fillRect(10, -40, 40, 36);
        line(12, -36, 48, -36, '#8a9aa8', 1.2);
        const n = 2 + Math.round(4 * b.g);
        for (let i = 0; i < n; i++) ham(15 + i * 30 / Math.max(1, n - 1), -36, 0.9, i);
        X.fillStyle = 'rgba(200,235,255,.35)'; X.fillRect(10, -14, 40, 10);
        X.fillStyle = lin(42, 0, 62, 0, [[0, '#9aa8b4'], [0.5, '#d8e2ea'], [1, '#8a98a4']]); X.fillRect(38, -42, 26, 40);
        X.strokeStyle = '#4a5864'; X.lineWidth = 1.2; X.strokeRect(38, -42, 26, 40);
        for (let x = 42; x < 64; x += 5) line(x, -42, x, -2, 'rgba(60,70,80,.3)', 0.8);
        X.fillStyle = '#f0c020'; X.fillRect(8, -44, 58, 3);
      });
      onR(1.75, 1.45, () => { for (const x of [8, 40]) { X.fillStyle = '#9aa8b4'; X.fillRect(x, -24, 10, 8); X.fillStyle = 'rgba(255,255,255,.6)'; X.fillRect(x + 1, -23, 8, 2.5); } });
      signR(1.76, 0.85, 36, 52, 15, '', 'ice');
      onR(1.76, 0, () => { txt('CHAMBRE', -0.85 * HX, -39.5, 7.5, '#1f5a82'); txt('FROIDE', -0.85 * HX, -32, 7.5, '#1f5a82'); });
      flatRoof(0.25, 0.25, 1.75, 1.45, 52, '#c8d4dc', { parapet: 3 });
      snowTop(0.25, 0.25, 1.75, 1.45, 55, 4, 7);
      for (const [u, v] of [[0.55, 0.55], [1.2, 0.6]]) { box(u, v, u + 0.35, v + 0.35, 55, 63, '#8a98a4', {}); }
      icicles(P(0.25, 1.45, 52), P(1.75, 1.45, 52), 12, 9, 5); icicles(P(1.75, 1.45, 52), P(1.75, 0.25, 52), 9, 8, 6);
      // frost patches
      for (const [u, v] of [[0.3, 1.45], [1.75, 1.0]]) { const p = P(u, v, 8); ell(p[0], p[1], 9, 6); fs('rgba(255,255,255,.75)'); }
      const nc = 1 + Math.round(2 * b.g);
      for (let i = 0; i < nc; i++) { crate(1.25 + i * 0.25, 1.6, 3, 0.22, '#9aa8b4'); const p = P(1.36 + i * 0.25, 1.71, 11); ell(p[0], p[1] - 1, 5, 2.4); fs('#b8402a', '#5a1a10', 0.6); }
    },
    anim(b) {
      const t = b.t;
      for (const [u, v] of [[0.55, 0.55], [1.2, 0.6]]) {
        const p = P(u + 0.175, v + 0.175, 63);
        ell(p[0], p[1], 7, 3.5); fs('#3a4650');
        for (let i = 0; i < 3; i++) { const a = t * 10 + i * TAU / 3; ell(p[0] + Math.cos(a) * 3.5, p[1] + Math.sin(a) * 1.75, 3, 1.2, a); fs('#c8d0d6'); }
      }
      // cold mist from the door
      onL(1.45, 0.25, () => {
        for (let i = 0; i < 6; i++) {
          const p = fract(t * 0.3 + i / 6);
          ell(20 + i * 5 - p * 16, -6 + p * 6, 6 + p * 10, 3 + p * 3);
          X.fillStyle = `rgba(235,248,255,${0.45 * (1 - p)})`; X.fill();
        }
      });
    },
  });

  // ---------------------------------------------------------------- ice coin buildings
  def('fur_shop', {
    W: 2, D: 2, H: 105, park: 'ice',
    draw(b) {
      snowPad(2, 2, 0.05, 17);
      box(0.35, 0.3, 1.62, 1.35, 3, 10, '#8a8e94', { tex: TX.stones(6, 4) });
      box(0.35, 0.3, 1.62, 1.35, 10, 44, '#7a4a2c', { tex: TX.planks(5, 6) });
      onL(1.35, 0.35, () => {
        X.fillStyle = '#4a2a14'; X.fillRect(5, -30, 32, 20);
        X.fillStyle = lin(0, -30, 0, -10, [[0, '#fff2d0'], [1, '#e8c890']]); X.fillRect(6.5, -28.5, 29, 17);
        // hats & scarves
        const cols = ['#d8402a', '#2f6aa8', '#f0c030', '#3f8f5a'];
        for (let i = 0; i < 4; i++) { const x = 11 + i * 7, y = -16; X.beginPath(); X.arc(x, y, 3.2, PI, 0); X.closePath(); fs(cols[i], shade(cols[i], -0.5), 0.6); ell(x, y - 4, 1.6, 1.6); fs('#ffffff'); X.fillStyle = shade(cols[i], 0.3); X.fillRect(x - 3.2, y - 0.5, 6.4, 1.6); }
        for (let i = 0; i < 3; i++) { X.fillStyle = cols[(i + 1) % 4]; X.fillRect(12 + i * 9, -27, 4, 8); }
        X.strokeStyle = '#4a2a14'; X.lineWidth = 2; X.strokeRect(5, -30, 32, 20);
        door(42, -33, 14, 30, '#5a3418', { double: false });
      });
      signL(1.36, 0.92, 37.5, 52, 9, 'BOUTIQUE', 'wood', 7.5);
      onR(1.62, 1.35, () => win(16, -32, 13, 14, { lit: true, frame: '#f4e8d0', shutters: '#2f6aa8' }));
      gable('u', 0.35, 0.3, 1.62, 1.35, 44, 76, '#5a3a2a', { gable: '#8a5a34', snow: true });
      icicles(P(0.25, 1.45, 44), P(1.72, 1.45, 44), 11, 8, 7);
      box(1.25, 0.45, 1.42, 0.62, 66, 86, '#8a8e94', { tex: TX.stones(5, 1) }); snowTop(1.25, 0.45, 1.42, 0.62, 86, 3, 3);
      // scarf rack outside
      const r0 = P(1.65, 1.5, 3), r1 = P(1.9, 1.85, 3);
      for (const p of [r0, r1]) line(p[0], p[1], p[0], p[1] - 26, '#6a4422', 2);
      line(r0[0], r0[1] - 25, r1[0], r1[1] - 25, '#6a4422', 2);
      ['#d8402a', '#f0c030', '#2f6aa8', '#c860c8'].forEach((c, i) => { const f = (i + 0.6) / 4.2, x = lerp(r0[0], r1[0], f), y = lerp(r0[1], r1[1], f) - 25; X.fillStyle = c; X.fillRect(x - 2, y, 4, 14); for (let k = 0; k < 3; k++) { X.fillStyle = 'rgba(255,255,255,.5)'; X.fillRect(x - 2, y + 3 + k * 4, 4, 1.2); } });
      lamp(...P(0.3, 1.5, 3), 26, true);
      snowPile(...P(0.5, 1.8, 3), 12);
    },
    anim(b) {
      const c = P(1.33, 0.54, 86); smoke(c[0], c[1], b.t, { n: 5, rise: 36, col: '#d8d8d8', a: 0.45, seed: 4 });
      const l = P(0.3, 1.5, 3); glow(l[0], l[1] - 34, 12, '#ffd890', 0.35 + 0.08 * Math.sin(b.t * 6));
    },
  });

  def('hot_chocolate', {
    W: 2, D: 2, H: 125, park: 'ice',
    draw(b) {
      snowPad(2, 2, 0.05, 19);
      box(0.35, 0.35, 1.55, 1.4, 3, 44, '#c8905a', { tex: TX.planks(5, 8) });
      onL(1.4, 0.35, () => {
        X.fillStyle = '#4a2a14'; X.fillRect(6, -30, 42, 17);
        X.fillStyle = lin(0, -30, 0, -13, [[0, '#ffe0a0'], [1, '#c87830']]); X.fillRect(7.5, -28.5, 39, 14);
        for (let i = 0; i < 4; i++) { const x = 13 + i * 9; X.fillStyle = '#ffffff'; X.fillRect(x - 2.5, -19, 5, 5); X.fillStyle = '#6a3a1a'; X.fillRect(x - 2, -19, 4, 1.4); }
        X.fillStyle = '#8a5a30'; X.fillRect(4, -14, 46, 3.5);
      });
      onR(1.55, 1.4, () => door(16, -32, 14, 29, '#6a3a1a', { double: false }));
      signL(1.41, 0.95, 37, 50, 9, 'CHOCOLAT', 'cream', 7.5);
      gable('v', 0.35, 0.35, 1.55, 1.4, 44, 68, '#7a3a2a', { gable: '#c8905a', snow: true });
      icicles(P(1.65, 1.5, 44), P(1.65, 0.25, 44), 9, 7, 9);
      // giant mug on the roof
      const m = P(0.95, 0.88, 64);
      cyl(m[0], m[1], 17, 22, '#ffffff', { top: false, tex: (x, y, R, h) => { X.fillStyle = '#d8402a'; X.fillRect(x - R, y - 14, R * 2, 4); } });
      X.beginPath(); X.ellipse(m[0] + 19, m[1] - 11, 7, 8, 0, -PI / 2, PI / 2); X.strokeStyle = '#a8a8a8'; X.lineWidth = 5; X.stroke(); X.strokeStyle = '#ffffff'; X.lineWidth = 3; X.stroke();
      ell(m[0], m[1] - 22, 17, 8.5); fs('#ffffff', '#a8a8a8', 1);
      ell(m[0], m[1] - 22, 14.5, 7); fs('#5a2a12');
      // whipped cream swirl
      for (let i = 0; i < 4; i++) { const r = 12 - i * 3; ell(m[0], m[1] - 25 - i * 5, r, r * 0.55); fs(rad(m[0] + 2, m[1] - 28 - i * 5, 1, r, [[0, '#ffffff'], [1, '#e8e0d8']]), '#c8beb4', 0.8); }
      for (const [dx, dy, c] of [[-8, -26, '#ffb0c8'], [7, -27, '#ffffff'], [2, -24, '#ffb0c8']]) { X.fillStyle = c; X.fillRect(m[0] + dx - 2, m[1] + dy - 2, 4, 3.5); }
      // benches
      for (const [u, v] of [[1.75, 0.6], [1.75, 1.2]]) { box(u - 0.1, v - 0.18, u + 0.05, v + 0.18, 3, 9, '#8a5a30', {}); snowTop(u - 0.1, v - 0.18, u + 0.05, v + 0.18, 9, 2, u + v); }
      snowPile(...P(0.3, 1.75, 3), 12);
    },
    anim(b) {
      const m = P(0.95, 0.88, 64), t = b.t;
      for (let i = 0; i < 3; i++) {
        const p = fract(t * 0.35 + i / 3);
        X.beginPath();
        const x0 = m[0] - 6 + i * 6, y0 = m[1] - 44;
        X.moveTo(x0, y0);
        for (let k = 1; k <= 8; k++) X.lineTo(x0 + Math.sin(k * 0.9 + t * 3 + i) * 3, y0 - k * 4 - p * 6);
        X.strokeStyle = `rgba(255,255,255,${0.55 * (1 - p * 0.6)})`; X.lineWidth = 2.4; X.stroke();
      }
      stringLights([P(0.25, 1.5, 44), P(1.65, 1.5, 44)], 9, t, true);
    },
  });

  def('visitor_center_ice', {
    W: 3, D: 3, H: 130, park: 'ice',
    draw(b) {
      snowPad(3, 3, 0.04, 23);
      const c = P(1.45, 1.4, 3), R = 96;
      cyl(c[0], c[1], R, 34, '#eef0ee', { top: false, tex: (x, y, RR, h) => {
        X.fillStyle = '#2f6aa8'; X.beginPath(); X.ellipse(x, y - 6, RR, RR / 2, 0, 0, PI); X.ellipse(x, y - 10, RR, RR / 2, 0, PI, 0, true); X.fill();
        for (let i = 0; i < 16; i++) { const a = PI * (i + 0.5) / 16, q = cylPt(x, y, RR, a, 16); const w = 9 * Math.sin(a) + 0.5; X.fillStyle = '#2a3a48'; X.fillRect(q[0] - w / 2, q[1] - 12, w, 12); X.fillStyle = lin(0, q[1] - 11, 0, q[1], [[0, '#fff0b8'], [1, '#e8a840']]); X.fillRect(q[0] - w / 2 + 0.6, q[1] - 11, w - 1.2, 10); }
      } });
      ell(c[0], c[1] - 34, R, R / 2); fs('#d8e0e6', '#8a98a4', 1.2);
      dome(c[0], c[1] - 34, R - 6, 72, '#e8f2f8');
      X.save(); domePath(c[0], c[1] - 34, R - 6, 72); X.clip();
      domeRibs(c[0], c[1] - 34, R - 6, 72, 12, 5, 'rgba(100,140,170,.55)', 1.2);
      // glass panels
      for (let i = 0; i < 5; i++) { const a = PI * (0.3 + i * 0.1), px = c[0] - Math.cos(a) * (R - 6) * 0.7, py = c[1] - 34 - 40 + Math.sin(a) * 6; spath([[px - 6, py], [px + 6, py], [px, py - 12]]); fs('rgba(120,200,240,.6)'); }
      // snow around the dome base
      X.beginPath(); X.ellipse(c[0], c[1] - 34, R - 6, (R - 6) / 2, 0, 0, PI); X.ellipse(c[0], c[1] - 34 - 16, R - 14, 30, 0, PI, 0, true); X.closePath(); fs('rgba(255,255,255,.85)');
      X.restore();
      domePath(c[0], c[1] - 34, R - 6, 72); fs(null, '#6a7a88', 1.2);
      ell(c[0], c[1] - 106, 9, 4); fs('#c8d0d6', '#4a545c', 1);
      // entrance with mammoth tusks
      box(1.2, 2.15, 1.85, 2.7, 3, 30, '#eef0ee', { tex: TX.panels(10) });
      onL(2.7, 1.2, () => door(9, -25, 14, 22, '#9aa8b0', { glass: true, lit: true }));
      box(1.12, 2.1, 1.93, 2.82, 30, 34, '#2f6aa8', {}); snowTop(1.12, 2.1, 1.93, 2.82, 34, 3, 2);
      onL(2.86, 1.2, () => {
        for (const [x0, sd] of [[2, 1], [30, -1]]) { X.beginPath(); X.moveTo(x0, 0); X.bezierCurveTo(x0 - sd * 8, -30, x0 + sd * 10, -56, x0 + sd * 16, -50); X.lineTo(x0 + sd * 14, -46); X.bezierCurveTo(x0 + sd * 6, -50, x0 - sd * 4, -28, x0 + sd * 4, 0); X.closePath(); fs(lin(0, -56, 0, 0, [[0, '#fffaf0'], [1, '#d8c8a0']]), '#7a6a48', 1); }
        board(16, -44, 46, 10, 'ACCUEIL', 'navy', 8);
      });
      for (const v of [0.6, 1.0, 1.4]) { const p = P(2.9, v, 3); pole(p[0], p[1], 60, '#d0d0d0', 2); }
      for (const [u, v] of [[0.35, 2.5], [2.6, 2.6]]) { pineTree(...P(u, v, 3), 44, u, true); }
    },
    anim(b) {
      const cols = [['#2f6aa8', '#ffffff'], ['#d8402a', '#ffffff'], ['#3f8f5a', '#ffd23a']];
      [0.6, 1.0, 1.4].forEach((v, i) => { const p = P(2.9, v, 63); cloth(p[0] + 1, p[1], 18, 12, b.t, cols[i][0], cols[i][1], i * 1.4); });
      const c = P(1.45, 1.4, 3); sparkle(c[0] + 30, c[1] - 90, 4, 0.5 + 0.5 * Math.sin(b.t * 1.7), '#ffffff');
    },
  });

  def('ice_hotel', {
    W: 3, D: 3, H: 165, park: 'ice',
    draw(b) {
      snowPad(3, 3, 0.04, 29);
      const t1 = P(2.42, 0.55, 3);
      const iceTower = (p, R, h, rh) => {
        cyl(p[0], p[1], R, h, '#b8e4f4', { top: false, tex: (x, y, RR, hh) => { for (let z = 10; z < hh; z += 10) { X.beginPath(); X.ellipse(x, y - z, RR, RR / 2, 0, 0, PI); X.strokeStyle = 'rgba(255,255,255,.6)'; X.lineWidth = 1; X.stroke(); for (let i = 0; i < 6; i++) { const q = cylPt(x, y, RR, PI * (i + (z / 10 % 2) * 0.5) / 6, z); line(q[0], q[1], q[0], q[1] + 10, 'rgba(255,255,255,.45)', 0.8); } } const w = cylPt(x, y, RR, PI * 0.45, hh * 0.6); win(w[0] - 4, w[1] - 8, 8, 12, { lit: true, arch: true, frame: '#e8f8ff', cross: false }); } });
        cone(p[0], p[1] - h, R + 5, rh, '#d8f2fc');
        X.beginPath(); X.moveTo(p[0] - R - 5, p[1] - h); X.lineTo(p[0] - (R + 5) * 0.45, p[1] - h - rh * 0.55); X.quadraticCurveTo(p[0], p[1] - h - rh * 0.5, p[0] + (R + 5) * 0.45, p[1] - h - rh * 0.55); X.lineTo(p[0] + R + 5, p[1] - h); X.ellipse(p[0], p[1] - h, R + 5, (R + 5) / 2, 0, 0, PI); X.closePath(); fs('rgba(255,255,255,.9)', '#a8c8dc', 0.8);
        icicles([p[0] - R - 3, p[1] - h + 2], [p[0] + R + 3, p[1] - h + 2], 7, 9, R);
      };
      iceTower(t1, 24, 100, 46);
      const iceTex = TX.ice(12, 9);
      box(0.5, 0.45, 2.45, 1.95, 3, 76, '#a8dcef', { tex: iceTex });
      onL(1.95, 0.5, () => { for (const x of [10, 26, 70, 86]) win(x, -60, 9, 16, { lit: true, arch: true, frame: '#e8f8ff', cross: false }); for (const x of [10, 26, 70, 86]) win(x, -32, 9, 14, { lit: true, arch: true, frame: '#e8f8ff', cross: false });
        // entrance with fur curtain
        X.beginPath(); X.moveTo(40, 0); X.lineTo(40, -26); X.arc(47, -26, 7, PI, 0); X.lineTo(54, 0); X.closePath(); fs('#e8f8ff', '#5aa8d0', 1.4);
        X.beginPath(); X.moveTo(42, 0); X.lineTo(42, -26); X.arc(47, -26, 5, PI, 0); X.lineTo(52, 0); X.closePath(); fs(lin(42, 0, 52, 0, [[0, '#6a4a2a'], [0.5, '#a07a4a'], [1, '#6a4a2a']]));
        board(47, -46, 64, 10, 'HÔTEL DE GLACE', 'ice', 7);
      });
      onR(2.45, 1.95, () => { for (const x of [12, 30, 48]) { win(x, -60, 9, 16, { lit: true, arch: true, frame: '#e8f8ff', cross: false }); win(x, -32, 9, 14, { lit: true, arch: true, frame: '#e8f8ff', cross: false }); } });
      // crenellations
      for (let i = 0; i < 8; i++) { const u = 0.5 + i * 0.25; box(u, 1.83, u + 0.13, 1.95, 76, 84, '#c8ecf8', { lw: 0.8 }); }
      for (let i = 0; i < 6; i++) { const v = 0.45 + i * 0.25; box(2.33, v, 2.45, v + 0.13, 76, 84, '#c8ecf8', { lw: 0.8 }); }
      snowTop(0.5, 0.45, 2.45, 1.95, 76, 3, 4);
      iceTower(P(0.55, 1.95, 3), 22, 92, 42);
      for (const [u, v] of [[0.3, 2.6], [2.7, 2.4]]) { const p = P(u, v, 3); crystal(p[0], p[1], 4, 22, 0.1, '#9ad8f0'); crystal(p[0] + 6, p[1] + 2, 3, 14, -0.3, '#b0e4f8'); }
      for (const u of [1.1, 1.85]) lamp(...P(u, 2.3, 3), 22, true);
      snowPile(...P(1.5, 2.75, 3), 14);
    },
    anim(b) {
      const t = b.t;
      for (let i = 0; i < 3; i++) { const p = fract(t * 0.25 + i / 3), a = i * 2.1; const q = P(0.7 + i * 0.7, 1.95, 30 + i * 18); sparkle(q[0] + Math.sin(a + t) * 6, q[1], 4, Math.sin(p * PI), '#ffffff'); }
      for (const u of [1.1, 1.85]) { const p = P(u, 2.3, 3); glow(p[0], p[1] - 30, 12, '#ffd890', 0.35 + 0.08 * Math.sin(t * 5 + u)); }
    },
  });

  // ---------------------------------------------------------------- ice decorations
  def('snowy_pine', {
    W: 1, D: 1, H: 105, park: 'ice', sway: 0.012,
    draw(b) {
      const c = P(0.5, 0.5, 0);
      blob(c[0], c[1] + 2, 26, 10, 0.25);
      ell(c[0], c[1] + 1, 24, 9); fs('#f4f8fb', '#c4d6e4', 0.8);
      pineTree(c[0], c[1] + 1, 96, 2, true);
      snowPile(c[0] + 14, c[1] + 6, 8);
    },
  });
  def('brazier', {
    W: 1, D: 1, H: 70, park: 'ice',
    draw(b) {
      const c = P(0.5, 0.5, 0);
      blob(c[0], c[1] + 2, 28, 11, 0.25);
      ell(c[0], c[1] + 1, 24, 10); fs('#8a8a84', '#6a6a64', 0.8);
      ell(c[0], c[1] + 1, 30, 13); fs(null, '#ffffff', 3);
      for (const [dx, a] of [[-16, 0.4], [14, -0.3]]) { X.save(); X.translate(c[0] + dx, c[1] + 8); X.rotate(a); X.fillStyle = lin(0, -3, 0, 3, [[0, '#a07a4a'], [1, '#5a3a1a']]); X.fillRect(-9, -2.5, 18, 5); ell(9, 0, 2.5, 2.5); fs('#e0c090', '#5a3a1a', 0.6); X.restore(); }
      stoneBrazier(c[0], c[1], 22, 15);
    },
    anim(b) {
      const c = P(0.5, 0.5, 0), y = c[1] - 22 - 13.5;
      flame(c[0], y, 13, b.t, 3, { glowR: 3 });
      smoke(c[0], y - 26, b.t, { n: 5, rise: 34, col: '#c8c4c0', a: 0.35, seed: 3 });
    },
  });
  def('hovercraft', {
    W: 1, D: 1, H: 55, park: 'ice',
    draw(b) {
      const c = P(0.5, 0.5, 0);
      ell(c[0], c[1] + 1, 36, 15); fs('#e4eef4', '#b8cad8', 0.8);
      hovercraftAt(0, 0, 1, 2);
    },
    anim(b) { hovercraftFan(0, 0, 1, 2, b.t); },
  });
  def('snowman', {
    W: 1, D: 1, H: 75, park: 'ice',
    draw(b) {
      const c = P(0.5, 0.5, 0);
      blob(c[0], c[1] + 2, 24, 9, 0.25);
      snowPile(c[0], c[1] + 3, 22);
      const ball = (y, r) => { ell(c[0], y, r, r * 0.95); fs(rad(c[0] + r * 0.35, y - r * 0.4, r * 0.1, r * 1.1, [[0, '#ffffff'], [0.7, '#e8f0f6'], [1, '#b8cadb']]), '#9ab0c4', 1); };
      ball(c[1] - 12, 16); ball(c[1] - 34, 12);
      // stick arms
      X.strokeStyle = '#5a3a1a'; X.lineWidth = 1.8; X.lineCap = 'round';
      X.beginPath(); X.moveTo(c[0] - 10, c[1] - 36); X.lineTo(c[0] - 24, c[1] - 46); X.moveTo(c[0] - 19, c[1] - 42); X.lineTo(c[0] - 22, c[1] - 49); X.moveTo(c[0] + 10, c[1] - 36); X.lineTo(c[0] + 24, c[1] - 42); X.moveTo(c[0] + 20, c[1] - 40); X.lineTo(c[0] + 24, c[1] - 47); X.stroke();
      ball(c[1] - 52, 9);
      for (let i = 0; i < 3; i++) { ell(c[0] + 1, c[1] - 40 + i * 6, 1.3, 1.3); fs('#2a2a2a'); }
      for (const dx of [-3.5, 3.5]) { ell(c[0] + dx, c[1] - 55, 1.3, 1.4); fs('#1a1a1a'); }
      spath([[c[0], c[1] - 52.5], [c[0] - 11, c[1] - 50], [c[0], c[1] - 50.5]]); fs('#f07a20', '#8a3a08', 0.6);
      for (let i = 0; i < 5; i++) { ell(c[0] - 4 + i * 2, c[1] - 47 + Math.sin(i) * 0.5, 0.8, 0.8); fs('#2a2a2a'); }
      // scarf
      X.beginPath(); X.ellipse(c[0], c[1] - 44.5, 9.5, 3.2, 0, 0, TAU); fs('#d8402a', '#7a1a10', 0.8);
      // hat
      ell(c[0], c[1] - 60, 10, 3); fs('#1e1e22', '#000', 0.8);
      X.fillStyle = lin(c[0] - 6.5, 0, c[0] + 6.5, 0, [[0, '#141418'], [0.6, '#3a3a42'], [1, '#1a1a1e']]); X.fillRect(c[0] - 6.5, c[1] - 74, 13, 14);
      ell(c[0], c[1] - 74, 6.5, 2); fs('#2a2a30');
      X.fillStyle = '#d8402a'; X.fillRect(c[0] - 6.5, c[1] - 64, 13, 2.5);
    },
    anim(b) {
      const c = P(0.5, 0.5, 0), t = b.t;
      X.beginPath(); X.moveTo(c[0] + 5, c[1] - 43); X.quadraticCurveTo(c[0] + 9 + Math.sin(t * 3) * 2, c[1] - 36, c[0] + 7 + Math.sin(t * 3 + 1) * 3, c[1] - 30);
      X.lineTo(c[0] + 3 + Math.sin(t * 3 + 1) * 3, c[1] - 31); X.quadraticCurveTo(c[0] + 4, c[1] - 37, c[0] + 1, c[1] - 42); X.closePath(); fs('#d8402a', '#7a1a10', 0.7);
    },
  });
  def('snow_tracker', {
    W: 1, D: 1, H: 55, park: 'ice',
    draw(b) {
      const c = P(0.5, 0.5, 0);
      blob(c[0], c[1] + 3, 34, 13, 0.32);
      ell(c[0], c[1] + 1, 36, 15); fs('#eef4f8', '#c4d6e4', 0.8);
      // rubber track loop (rounded), extruded across v0..v1, with road wheels and grousers on the outer face
      const track = (v0, v1) => {
        const L = 0.76 * HX;
        extrudeL(v0, v1, 0.12, 4, k => {
          rrect(0, -15, L, 13, 6.5); fs(k < 1 ? '#18191c' : '#2a2b30', '#050506', 1);
          if (k < 1) return;
          for (let x = 3; x < L - 2; x += 3) { line(x, -15, x, -13.6, '#55585e', 1.1); line(x, -2, x, -0.6, '#3a3c40', 1.1); }
          for (let i = 0; i < 4; i++) { const x = 7 + i * (L - 14) / 3; ell(x, -8.5, 4, 4); fs(lin(x - 4, -12, x + 4, -5, [[0, '#9aa0a8'], [1, '#4a4e54']]), '#1a1a1e', 0.8); ell(x, -8.5, 1.4, 1.4); fs('#d8dce0'); }
        });
      };
      track(0.28, 0.4);
      box(0.2, 0.36, 0.82, 0.64, 10, 22, I.red, {});
      box(0.38, 0.38, 0.78, 0.62, 22, 37, I.red, {});
      onR(0.78, 0.62, () => { X.fillStyle = lin(0, -35, 0, -25, [[0, '#c8f4ff'], [1, '#2a6a90']]); X.fillRect(2, -35, 0.24 * HX - 4, 9); });
      onL(0.62, 0.38, () => { X.fillStyle = lin(0, -35, 0, -25, [[0, '#c8f4ff'], [1, '#2a6a90']]); X.fillRect(3, -35, 0.36 * HX - 6, 9); X.fillStyle = '#f4f4f0'; X.fillRect(0, -18, 0.62 * HX, 2.5); });
      onR(0.82, 0.64, () => { for (const x of [3, 0.28 * HX - 3]) { ell(x, -17, 2.2, 2.2); fs('#fff6c8', '#333', 0.6); } });
      box(0.42, 0.42, 0.74, 0.58, 37, 39, '#3a3a3a', { hi: false });
      for (let i = 0; i < 3; i++) { const p = P(0.58, 0.44 + i * 0.06, 40); ell(p[0], p[1], 1.8, 1.4); fs('#ffb020', '#5a3a08', 0.5); }
      const ex = P(0.3, 0.4, 22); X.fillStyle = '#4a4a4a'; X.fillRect(ex[0] - 1.2, ex[1] - 14, 2.4, 14);
      track(0.6, 0.72);
      snowTop(0.38, 0.38, 0.78, 0.62, 39.5, 2, 3);
      // front snow blade with hazard stripes
      for (const [a, z0] of [[0.22, 4], [0.78, 4]]) line(...P(0.86, a + (a < 0.5 ? 0.06 : -0.06), 11), ...P(0.95, a, 9), '#3a3e44', 2);
      extrudeR(0.93, 0.97, 0.8, 2, k => {
        X.beginPath(); X.moveTo(0, -3); X.lineTo(0.62 * HX, -3); X.quadraticCurveTo(0.62 * HX + 2, -10, 0.62 * HX - 1, -17); X.lineTo(-1, -17); X.quadraticCurveTo(2, -10, 0, -3); X.closePath();
        fs(k < 1 ? '#a87a10' : '#f0c020', '#4a3404', 1);
        if (k < 1) return;
        X.save(); X.clip();
        for (let x = -10; x < 0.62 * HX + 10; x += 7) { X.beginPath(); X.moveTo(x, -3); X.lineTo(x + 3.5, -3); X.lineTo(x - 0.5, -17); X.lineTo(x - 4, -17); X.closePath(); X.fillStyle = 'rgba(30,30,30,.85)'; X.fill(); }
        X.restore();
        line(0, -16.5, 0.62 * HX - 1, -16.5, 'rgba(255,255,255,.55)', 1);
      });
      snowPile(...P(1.0, 0.5, 2), 9);
    },
    anim(b) { const ex = P(0.3, 0.4, 36); smoke(ex[0], ex[1], b.t, { n: 4, rise: 26, col: '#9a9a9a', a: 0.35, seed: 6, r1: 5 }); },
  });
  def('ice_crystals', {
    W: 1, D: 1, H: 75, park: 'ice',
    draw(b) {
      const c = P(0.5, 0.5, 0);
      blob(c[0], c[1] + 2, 26, 10, 0.25);
      ell(c[0], c[1] + 1, 24, 9); fs('#eef6fb', '#b8cfe0', 0.8);
      for (const [dx, dy, w, h, a, col] of [[-16, 2, 5, 26, -0.4, '#9ad8f0'], [15, 3, 5, 30, 0.35, '#80c8ea'], [-6, -2, 6, 44, -0.12, '#b0e4f8'], [6, 0, 8, 58, 0.06, '#9ad8f0'], [0, 6, 4, 20, 0.2, '#c0ecfa'], [-12, 7, 4, 16, -0.6, '#a0dcf4']]) crystal(c[0] + dx, c[1] + dy, w, h, a, col);
    },
    anim(b) {
      const c = P(0.5, 0.5, 0), t = b.t;
      glow(c[0], c[1] - 26, 30, '#7fd8ff', 0.18 + 0.08 * Math.sin(t * 2));
      for (let i = 0; i < 3; i++) { const p = fract(t * 0.4 + i / 3); sparkle(c[0] - 12 + i * 12, c[1] - 20 - p * 30, 4, Math.sin(p * PI), '#ffffff'); }
    },
  });
  def('igloo', {
    W: 2, D: 2, H: 80, park: 'ice',
    draw(b) {
      snowPad(2, 2, 0.06, 31);
      const c = P(1.0, 0.92, 3), R = 62, hh = 50;
      dome(c[0], c[1], R, hh, '#f0f6fa', { stroke: '#9ab4c8' });
      X.save(); domePath(c[0], c[1], R, hh); X.clip();
      X.strokeStyle = 'rgba(120,150,175,.55)'; X.lineWidth = 1.1;
      const rows = 5;
      for (let i = 1; i < rows; i++) { const th = (PI / 2) * i / rows, r = R * Math.cos(th); X.beginPath(); X.ellipse(c[0], c[1] - hh * Math.sin(th), r, r * 0.5, 0, 0, PI); X.stroke(); }
      for (let i = 0; i < rows; i++) {
        const th0 = (PI / 2) * i / rows, th1 = (PI / 2) * (i + 1) / rows;
        const n = 9 - i;
        for (let k = 0; k <= n; k++) {
          const phi = PI * (k + (i % 2) * 0.5) / n;
          if (phi > PI) continue;
          const p0 = [c[0] - Math.cos(phi) * R * Math.cos(th0), c[1] + Math.sin(phi) * R * 0.5 * Math.cos(th0) - hh * Math.sin(th0)];
          const p1 = [c[0] - Math.cos(phi) * R * Math.cos(th1), c[1] + Math.sin(phi) * R * 0.5 * Math.cos(th1) - hh * Math.sin(th1)];
          line(p0[0], p0[1], p1[0], p1[1], 'rgba(120,150,175,.5)', 1);
        }
      }
      X.restore();
      // entrance tunnel (towards +v)
      for (let i = 0; i <= 10; i++) {
        const v = lerp(1.35, 1.85, i / 10);
        onL(v, 1.0, () => { X.beginPath(); X.moveTo(-17, 0); X.lineTo(-17, -8); X.arc(0, -8, 17, PI, 0); X.lineTo(17, 0); X.closePath(); fs(i === 10 ? '#e8f0f6' : lin(0, -25, 0, 0, [[0, '#ffffff'], [1, '#c8dae8']]), i === 10 || i === 0 ? '#9ab4c8' : null, 1); });
      }
      onL(1.86, 1.0, () => { X.beginPath(); X.moveTo(-11, 0); X.lineTo(-11, -6); X.arc(0, -6, 11, PI, 0); X.lineTo(11, 0); X.closePath(); fs(rad(0, -4, 1, 16, [[0, '#ffc870'], [0.6, '#a0602a'], [1, '#3a2a20']])); for (const x of [-12, 12]) line(x, -2, x, -12, 'rgba(120,150,175,.5)', 1); });
      // fishing hole + rod
      const fh = P(1.62, 1.55, 3);
      ell(fh[0], fh[1], 9, 4); fs('#2a5a72', '#9ab4c8', 1.2);
      line(fh[0] + 12, fh[1] + 2, fh[0] - 2, fh[1] - 20, '#6a4422', 1.6);
      X.beginPath(); X.moveTo(fh[0] - 2, fh[1] - 20); X.quadraticCurveTo(fh[0] - 6, fh[1] - 10, fh[0] - 2, fh[1]); X.strokeStyle = 'rgba(40,40,40,.6)'; X.lineWidth = 0.6; X.stroke();
      const fp = P(1.25, 0.6, 3);
      X.fillStyle = '#6a4422'; X.fillRect(c[0] + 26, c[1] - 74, 1.6, 30);
      spath([[c[0] + 27.6, c[1] - 74], [c[0] + 40, c[1] - 70], [c[0] + 27.6, c[1] - 66]]); fs('#d8402a', '#7a1a10', 0.6);
      snowPile(...P(0.3, 1.6, 3), 12);
    },
    anim(b) {
      const t = b.t;
      onL(1.86, 1.0, () => glow(0, -6, 16, '#ffb050', 0.28 + 0.1 * Math.sin(t * 6) + 0.05 * Math.sin(t * 13)));
      const c = P(1.0, 0.92, 3); smoke(c[0] + 4, c[1] - 52, t, { n: 4, rise: 26, col: '#e0e0e0', a: 0.3, seed: 8, r1: 6 });
    },
  });
  def('helipad', {
    W: 2, D: 2, H: 70, park: 'ice',
    draw(b) {
      groundShadow(2, 2, 0.9);
      box(0.12, 0.12, 1.88, 1.88, 0, 6, '#7a848c', {
        tex: TX.panels(16),
        texTop: () => {
          X.fillStyle = '#4a5258'; X.fillRect(0.12, 0.12, 1.76, 1.76);
          X.beginPath(); X.arc(1, 1, 0.66, 0, TAU); X.strokeStyle = '#f0c020'; X.lineWidth = 0.07; X.stroke();
          X.fillStyle = '#ffffff';
          X.fillRect(0.72, 0.68, 0.12, 0.64); X.fillRect(1.16, 0.68, 0.12, 0.64); X.fillRect(0.72, 0.94, 0.56, 0.12);
          X.strokeStyle = 'rgba(255,255,255,.6)'; X.lineWidth = 0.03; X.strokeRect(0.2, 0.2, 1.6, 1.6);
        },
      });
      for (const [u, v] of [[0.14, 0.14], [1.86, 0.14], [0.14, 1.86], [1.86, 1.86]]) snowPile(...P(u, v, 6), 9);
      // helicopter
      const hp = P(1.0, 1.0, 6);
      for (const sd of [-1, 1]) { const a = P(0.75, 1.0 + sd * 0.16, 6), c2 = P(1.3, 1.0 + sd * 0.16, 6); line(a[0], a[1], c2[0], c2[1], '#2a2a2a', 2); }
      for (const [u, sd] of [[0.85, -1], [0.85, 1], [1.2, -1], [1.2, 1]]) { const a = P(u, 1.0 + sd * 0.16, 6), c2 = P(u, 1.0 + sd * 0.08, 14); line(a[0], a[1], c2[0], c2[1], '#2a2a2a', 1.4); }
      // tail boom toward -u
      const tb0 = P(0.85, 1.0, 22), tb1 = P(0.2, 1.0, 26);
      line(tb0[0], tb0[1], tb1[0], tb1[1], '#a8261c', 5); line(tb0[0], tb0[1] - 1.5, tb1[0], tb1[1] - 1.5, '#e85a48', 1.4);
      spath([[tb1[0], tb1[1] + 2], [tb1[0] - 2, tb1[1] - 14], [tb1[0] + 5, tb1[1] - 12], [tb1[0] + 6, tb1[1]]]); fs('#d8402a', '#5a1a10', 1);
      ell(tb1[0] + 1, tb1[1] - 8, 1.6, 6); fs('rgba(60,60,60,.6)');
      // cabin
      ell(hp[0] + 8, hp[1] - 20, 22, 13); fs(lin(hp[0] - 14, hp[1] - 33, hp[0] + 30, hp[1] - 7, [[0, '#ff7a5a'], [0.5, '#d8402a'], [1, '#8a2014']]), '#4a0e08', 1.4);
      X.save(); ell(hp[0] + 8, hp[1] - 20, 22, 13); X.clip(); X.fillStyle = '#ffffff'; X.fillRect(hp[0] - 20, hp[1] - 18, 60, 3); X.restore();
      X.beginPath(); X.ellipse(hp[0] + 16, hp[1] - 22, 13, 9, 0.2, -PI * 0.8, PI * 0.35); X.closePath(); fs(lin(hp[0] + 8, hp[1] - 30, hp[0] + 26, hp[1] - 14, [[0, '#d8f6ff'], [1, '#2a6a90']]), '#1a3a50', 1);
      X.fillStyle = '#3a3a3a'; X.fillRect(hp[0] + 6, hp[1] - 37, 4, 5);
      // windsock pole
      const wp = P(1.85, 0.2, 6); pole(wp[0], wp[1], 34, '#d0d0d0', 1.6);
    },
    anim(b) {
      const t = b.t, hp = P(1.0, 1.0, 6);
      // rotor
      const rc = [hp[0] + 8, hp[1] - 38];
      ell(rc[0], rc[1], 46, 14); fs('rgba(60,60,60,.08)');
      for (let i = 0; i < 2; i++) { const a = t * 2.2 + i * PI; const ex = Math.cos(a) * 46, ey = Math.sin(a) * 14; line(rc[0] - ex, rc[1] - ey, rc[0] + ex, rc[1] + ey, '#2a2a2a', 2.4); }
      ell(rc[0], rc[1], 3, 1.6); fs('#4a4a4a');
      // edge lights
      for (let i = 0; i < 8; i++) {
        const k = i / 8, u = i < 4 ? 0.14 + k * 2 * 1.72 : 1.86, v = i < 4 ? 1.86 : 0.14 + (k - 0.5) * 2 * 1.72;
        const p = P(Math.min(1.86, u), v, 6), on = (Math.floor(t * 3) + i) % 4 === 0;
        ell(p[0], p[1], 1.6, 1.2); fs(on ? '#7aff8a' : '#2a5a32');
        if (on) glow(p[0], p[1], 6, '#7aff8a', 0.5);
      }
      // windsock
      const wp = P(1.85, 0.2, 40);
      const n = 5;
      for (let i = 0; i < n; i++) {
        const x0 = wp[0] + i * 4 + 1, w = Math.sin(t * 5 + i * 0.9) * 1.5;
        spath([[x0, wp[1] + w + i * 0.6], [x0 + 4, wp[1] + w + i * 0.7], [x0 + 4, wp[1] + w + 7 - i * 0.7], [x0, wp[1] + w + 7.5 - i * 0.6]]);
        fs(i % 2 ? '#ffffff' : '#ff7a20', '#7a3a10', 0.5);
      }
    },
  });
  def('ice_statue', {
    W: 2, D: 2, H: 130, park: 'ice',
    draw(b) {
      snowPad(2, 2, 0.06, 37);
      box(0.38, 0.38, 1.62, 1.62, 3, 12, '#eef4f8', { stroke: '#a8bfd0' });
      box(0.52, 0.52, 1.48, 1.48, 12, 34, '#b8e4f4', { tex: TX.ice(11, 2) });
      snowTop(0.52, 0.52, 1.48, 1.48, 34, 3, 2);
      signL(1.49, 1.0, 24, 52, 11, 'MAMMOUTH', 'ice', 7.5);
      const img = creatureImg('mammoth', { scale: 0.3, stage: 3, facing: -1, pose: 'idle', tint: 'ice', t: 0.8 });
      const p = P(1.0, 1.0, 36);
      if (!drawCreatureImg(img, p[0] + 4, p[1], 0.93)) crystal(p[0], p[1], 14, 60, 0, '#9ad8f0');
      for (const [u, v] of [[0.25, 1.4], [1.4, 0.25], [1.75, 1.75]]) { const q = P(u, v, 3); crystal(q[0], q[1], 3, 14, 0.2, '#b0e4f8'); }
    },
    anim(b) {
      const p = P(1.0, 1.0, 36), t = b.t;
      for (let i = 0; i < 3; i++) { const k = fract(t * 0.3 + i / 3); sparkle(p[0] - 28 + i * 24, p[1] - 30 - i * 14 - k * 8, 4, Math.sin(k * PI), '#ffffff'); }
    },
  });

  // ================================================================ SCENERY
  // Each kind: { box: [x0, y0, x1, y1] (canonical, tile width 96, ground point = 0,0), nv (variants), sway, draw(variant, seed), anim? }
  const SCN = {};
  const scn = (kind, o) => { SCN[kind] = o; };
  const pick = (arr, i) => arr[i % arr.length];

  function softShadow(rx, ry) { blob(0, 0, rx, ry, 0.28); }

  // ---------------------------------------------------------------- land
  scn('palm', {
    box: [-64, -118, 64, 16], nv: 4, sway: 0.035,
    draw(v, seed) {
      softShadow(30, 11);
      for (let i = 0; i < 4; i++) rock(-14 + i * 8, 4 - (i % 2) * 3, 4, 3, '#9a8f80', i + v);
      palmTree(0, 0, 66 + v * 7, v * 1.7 + 0.4, (v - 1.5) * 0.18);
      grassTufts(0, 4, 30, 5, '#5a9a34', v);
    },
  });
  scn('fern', {
    box: [-48, -46, 48, 12], nv: 4, sway: 0.03,
    draw(v) {
      softShadow(26, 9);
      const cols = ['#4f9a34', '#5aaa3a', '#3f8a2c', '#62b04a'];
      fern(10, 3, 18, pick(cols, v + 1), v + 20, 6);
      fern(-4, 0, 26 + v * 2, pick(cols, v), v + 3, 8);
    },
  });
  scn('broadleaf', {
    box: [-56, -110, 56, 14], nv: 4, sway: 0.018,
    draw(v) {
      softShadow(34, 12);
      const tr = '#6a4a2c';
      X.beginPath(); X.moveTo(-5, 0); X.quadraticCurveTo(-3, -24, -2, -44); X.lineTo(3, -44); X.quadraticCurveTo(4, -22, 6, 0); X.closePath();
      fs(lin(-5, 0, 6, 0, [[0, shade(tr, -0.3)], [0.6, shade(tr, 0.2)], [1, shade(tr, -0.1)]]), '#3a2614', 1);
      line(0, -30, -12, -46, tr, 3); line(1, -34, 12, -50, tr, 2.6);
      const cols = ['#4f9a34', '#3f8a2c', '#5aa83a', '#6a9a2a'];
      canopy(-12, -58, 22, pick(cols, v + 1), v + 4);
      canopy(12, -62, 22, pick(cols, v), v + 9);
      canopy(0, -74, 24, shade(pick(cols, v), 0.08), v + 2);
    },
  });
  scn('bush', {
    box: [-34, -44, 34, 10], nv: 4, sway: 0.015,
    draw(v, seed) {
      softShadow(22, 8);
      const cols = ['#4c9a34', '#3f8a2c', '#5aa83a', '#4a8a3a'];
      const fl = v === 1 ? ['#ff5a6a', '#ffd23a'] : v === 3 ? ['#ffffff', '#ff9ad8'] : null;
      bush(0, 2, 18 + v * 1.5, pick(cols, v), v + 5, fl);
    },
  });
  scn('rock', {
    box: [-46, -44, 46, 14], nv: 4,
    draw(v) {
      softShadow(30, 10);
      const col = pick(['#9a9184', '#8a8278', '#a59a88', '#7f7a74'], v);
      rock(10, 4, 12, 9, shade(col, -0.05), v + 7);
      rock(-6, 0, 22 + v * 2, 17 + v * 2, col, v + 1);
      if (v % 2 === 0) rock(-24, 6, 8, 6, shade(col, 0.05), v + 3);
      // moss
      X.fillStyle = 'rgba(90,150,50,.55)';
      ell(-10, -14 - v * 2, 7, 2.5, -0.2); X.fill();
      grassTufts(4, 6, 40, 5, '#5a9a34', v + 2);
    },
  });
  scn('flowers', {
    box: [-36, -30, 36, 12], nv: 4, sway: 0.02,
    draw(v) {
      const sets = [['#ff4a5a', '#ffd23a'], ['#c060e0', '#ffffff'], ['#ff8a2a', '#ff4a8a'], ['#ffe14a', '#5ab0ff']];
      const fl = pick(sets, v);
      for (let i = 0; i < 9; i++) {
        const x = (hash(i, v) - 0.5) * 46, y = (hash(i + 5, v) - 0.5) * 16;
        X.strokeStyle = '#3f7a2a'; X.lineWidth = 1; X.beginPath(); X.moveTo(x, y + 4); X.lineTo(x + 1, y - 6); X.stroke();
        ell(x - 3, y - 1, 3.5, 1.4, -0.5); X.fillStyle = '#4f9a34'; X.fill();
        ell(x + 3, y + 1, 3.5, 1.4, 0.5); X.fillStyle = '#3f8a2c'; X.fill();
      }
      for (let i = 0; i < 9; i++) {
        const x = (hash(i, v) - 0.5) * 46, y = (hash(i + 5, v) - 0.5) * 16;
        flowerAt(x + 1, y - 7, 3.2, fl[i % 2]);
      }
    },
  });

  // ---------------------------------------------------------------- sea
  function seaRockBase(w, h, col, seed) { rock(0, 3, w, h, col || '#6f8a92', seed); }
  scn('coral_fan', {
    box: [-46, -84, 46, 12], nv: 3, sway: 0.03, swaySpeed: 0.9,
    draw(v) {
      softShadow(26, 8);
      if (v === 2) { // green table coral
        seaRockBase(14, 10, '#6a8088', 2);
        for (const [x, y, r, c] of [[-4, -22, 26, '#6ac05a'], [10, -12, 18, '#8ad06a'], [-14, -8, 14, '#4fa84a']]) {
          X.fillStyle = shade(c, -0.4); X.fillRect(x - 2, y, 4, 22 + y * -0.3);
          ell(x, y, r, r * 0.36); fs(lin(0, y - r * 0.36, 0, y + r * 0.36, [[0, shade(c, 0.3)], [1, shade(c, -0.25)]]), shade(c, -0.5), 1);
          ell(x, y - 1.5, r * 0.8, r * 0.26); fs(null, rgba(shade(c, 0.45), 0.8), 0.8);
          for (let i = 0; i < 8; i++) { ell(x + (hash(i, r) - 0.5) * r * 1.4, y - 1 + (hash(i + 3, r) - 0.5) * r * 0.4, 1, 0.6); X.fillStyle = shade(c, 0.5); X.fill(); }
        }
        return;
      }
      const col = v ? '#e04a5a' : '#a050c8';
      seaRockBase(12, 8, '#6a8088', v + 3);
      // fan
      X.save();
      X.beginPath(); X.moveTo(0, 0);
      for (let i = 0; i <= 12; i++) { const a = -PI + 0.25 + i / 12 * (PI - 0.5); X.lineTo(Math.cos(a) * 34 * (0.85 + hash(i, v) * 0.2), -16 + Math.sin(a) * 50 * (0.9 + hash(i + 2, v) * 0.15)); }
      X.closePath();
      fs(rad(0, -30, 4, 56, [[0, shade(col, 0.25)], [1, shade(col, -0.2)]]), shade(col, -0.45), 1.2);
      X.clip();
      X.strokeStyle = rgba(shade(col, -0.45), 0.6); X.lineWidth = 0.8;
      for (let i = 0; i < 14; i++) { const a = -PI + 0.2 + i / 13 * (PI - 0.4); X.beginPath(); X.moveTo(0, 0); X.quadraticCurveTo(Math.cos(a) * 20, -14 + Math.sin(a) * 26, Math.cos(a) * 40, -16 + Math.sin(a) * 58); X.stroke(); }
      for (let r = 12; r < 60; r += 7) { X.beginPath(); X.ellipse(0, -10, r * 0.7, r, 0, PI, 0); X.stroke(); }
      X.restore();
      // small orange coral in front
      coralBranch(14, 4, 16, '#ff8a3a', v + 5);
    },
  });
  /** Branching coral at (x, y). */
  function coralBranch(x, y, s, col, seed) {
    const rr = H.rng(seed || 3);
    const br = (x0, y0, a, l, w, d) => {
      const x1 = x0 + Math.cos(a) * l, y1 = y0 + Math.sin(a) * l;
      X.beginPath(); X.moveTo(x0, y0); X.lineTo(x1, y1);
      X.strokeStyle = shade(col, -0.35); X.lineWidth = w + 1.6; X.lineCap = 'round'; X.stroke();
      X.strokeStyle = shade(col, d * 0.06); X.lineWidth = w; X.stroke();
      if (d < 3) { br(x1, y1, a - 0.45 - rr() * 0.2, l * 0.72, w * 0.75, d + 1); br(x1, y1, a + 0.4 + rr() * 0.2, l * 0.7, w * 0.75, d + 1); }
      else { ell(x1, y1, w * 0.7, w * 0.7); X.fillStyle = shade(col, 0.4); X.fill(); }
    };
    br(x, y, -PI / 2 - 0.3, s * 0.45, s * 0.22, 0);
    br(x, y, -PI / 2 + 0.35, s * 0.4, s * 0.2, 1);
  }
  scn('coral_brain', {
    box: [-40, -46, 40, 12], nv: 3,
    draw(v) {
      softShadow(26, 9);
      if (v === 2) { // tube sponges
        seaRockBase(16, 9, '#6a8088', 8);
        for (const [x, h, r, c] of [[-10, 26, 5, '#e8a03a'], [0, 34, 6, '#f0c040'], [10, 22, 5, '#d8803a'], [5, 16, 4, '#c8603a']]) {
          cyl(x, 0, r, h, c, { top: '#5a2a10' });
          ell(x, -h, r * 0.7, r * 0.35); X.fillStyle = '#3a1a08'; X.fill();
        }
        return;
      }
      const col = v ? '#d8c050' : '#7ab85a';
      dome(0, 2, 26, 26, col);
      X.save(); domePath(0, 2, 26, 26); X.clip();
      X.strokeStyle = rgba(shade(col, -0.45), 0.7); X.lineWidth = 1.4;
      for (let i = 0; i < 9; i++) {
        X.beginPath();
        const y0 = -24 + i * 3.4;
        for (let x = -28; x <= 28; x += 3) { const y = y0 + Math.sin(x * 0.45 + i * 1.7) * 1.8 + (x * x) * 0.012; if (x === -28) X.moveTo(x, y); else X.lineTo(x, y); }
        X.stroke();
      }
      X.restore();
      coralBranch(-20, 6, 14, '#ff6a8a', v + 2);
    },
  });
  scn('kelp', {
    box: [-34, -128, 34, 10], nv: 3, sway: 0.06, swaySpeed: 0.8,
    draw(v) {
      softShadow(18, 6);
      seaRockBase(12, 7, '#5f7a82', v + 1);
      const n = 4;
      for (let i = 0; i < n; i++) {
        const x0 = (i - 1.5) * 6, hgt = 80 + hash(i, v) * 38;
        const col = pick(['#5a8a2a', '#6a9a30', '#4a7a2a'], i + v);
        X.beginPath(); X.moveTo(x0, 0);
        for (let j = 1; j <= 10; j++) X.lineTo(x0 + Math.sin(j * 0.8 + i) * 5, -hgt * j / 10);
        X.strokeStyle = shade(col, -0.3); X.lineWidth = 2; X.stroke();
        for (let j = 1; j <= 9; j++) {
          const px = x0 + Math.sin(j * 0.8 + i) * 5, py = -hgt * j / 10, sd = j % 2 ? 1 : -1;
          ell(px + sd * 6, py + 2, 7, 2.6, sd * 0.6 - 0.2); fs(shade(col, (j % 3) * 0.06), shade(col, -0.35), 0.7);
        }
        ell(x0 + Math.sin(8.8 + i) * 5, -hgt * 0.75, 2.4, 2.4); X.fillStyle = '#c8b040'; X.fill();
      }
    },
  });
  scn('sea_rock', {
    box: [-48, -50, 48, 14], nv: 3,
    draw(v) {
      softShadow(32, 10);
      const col = pick(['#6f8a92', '#7a8a8a', '#627a86'], v);
      rock(14, 5, 13, 10, shade(col, 0.05), v + 4);
      rock(-6, 2, 24, 20 + v * 3, col, v + 2);
      // barnacles & small growths
      for (let i = 0; i < 6; i++) { const x = -18 + hash(i, v) * 24, y = -14 + hash(i + 4, v) * 12; ell(x, y, 2, 1.5); fs('#d8d0c0', '#6a6458', 0.6); }
      coralBranch(-18, 4, 12, '#ff7a5a', v + 1);
      ell(10, -6, 5, 3); fs('#e85aa0', '#8a2a5a', 0.8);
    },
  });
  scn('anemone', {
    box: [-30, -42, 30, 10], nv: 3, sway: 0.05, swaySpeed: 1.6,
    draw(v) {
      softShadow(18, 6);
      const col = pick(['#ff7ab0', '#ff9a40', '#b080ff'], v);
      cyl(0, 2, 9, 8, shade(col, -0.25), { top: false });
      for (let i = 0; i < 16; i++) {
        const a = -PI / 2 + (i / 15 - 0.5) * 2.6;
        const l = 16 + hash(i, v) * 8;
        const x1 = Math.cos(a) * l * 0.9, y1 = -8 + Math.sin(a) * l;
        X.beginPath(); X.moveTo(Math.cos(a) * 5, -7); X.quadraticCurveTo(x1 * 0.6, y1 * 0.7 - 4, x1, y1);
        X.strokeStyle = shade(col, -0.3); X.lineWidth = 3.6; X.lineCap = 'round'; X.stroke();
        X.strokeStyle = shade(col, 0.1 + (i % 3) * 0.08); X.lineWidth = 2.4; X.stroke();
        ell(x1, y1, 1.5, 1.5); X.fillStyle = shade(col, 0.5); X.fill();
      }
      if (v === 0) miniFish(6, -18, 4, 1, '#ff8a2a', 1);
    },
  });

  // ---------------------------------------------------------------- ice
  /** Snowy pine tree at (x, y) of height h. */
  function pineTree(x, y, h, seed, snow) {
    X.fillStyle = '#5a3a22'; X.fillRect(x - 2.5, y - h * 0.18, 5, h * 0.18);
    const tiers = 4;
    for (let i = 0; i < tiers; i++) {
      const yb = y - h * 0.12 - i * h * 0.2, w = h * (0.34 - i * 0.065), th = h * 0.32;
      const pts = [[x - w, yb], [x, yb - th], [x + w, yb]];
      X.beginPath(); X.moveTo(pts[0][0], pts[0][1]); X.lineTo(pts[1][0], pts[1][1]); X.lineTo(pts[2][0], pts[2][1]);
      X.quadraticCurveTo(x, yb + w * 0.25, pts[0][0], pts[0][1]);
      fs(lin(x - w, 0, x + w, 0, [[0, '#1f4a32'], [0.6, '#3a7a4a'], [1, '#2a5a3a']]), '#143024', 1);
      if (snow) {
        X.beginPath();
        X.moveTo(x - w * 0.82, yb - th * 0.1);
        X.lineTo(x, yb - th);
        X.lineTo(x + w * 0.82, yb - th * 0.1);
        for (let j = 5; j >= 0; j--) { const f = j / 5; X.quadraticCurveTo(x - w * 0.82 + w * 1.64 * (f + 0.1), yb - th * 0.05 + 3, x - w * 0.82 + w * 1.64 * f, yb - th * 0.18 - (j % 2) * 2); }
        X.closePath();
        fs(lin(0, yb - th, 0, yb, [[0, '#ffffff'], [1, '#d4e4f0']]), '#a8bfd0', 0.8);
      }
    }
  }
  scn('pine', {
    box: [-40, -118, 40, 12], nv: 4, sway: 0.012,
    draw(v) {
      softShadow(24, 8);
      ell(0, 2, 22, 7); fs('#f4f8fb', '#c4d6e4', 0.8);
      pineTree(0, 0, 92 + v * 6, v, true);
    },
  });
  scn('snow_rock', {
    box: [-46, -46, 46, 14], nv: 3,
    draw(v) {
      softShadow(30, 10);
      const col = pick(['#7a8288', '#6e767c', '#858c90'], v);
      rock(12, 5, 12, 9, col, v + 8);
      rock(-6, 1, 24, 20 + v * 2, col, v + 3);
      // snow caps
      X.beginPath(); X.moveTo(-26, -10); X.quadraticCurveTo(-18, -26 - v * 2, -4, -24 - v * 2); X.quadraticCurveTo(10, -24, 14, -12);
      X.quadraticCurveTo(8, -9, 4, -12); X.quadraticCurveTo(-2, -8, -8, -12); X.quadraticCurveTo(-16, -7, -26, -10);
      fs(lin(0, -26, 0, -8, [[0, '#ffffff'], [1, '#d0e2ee']]), '#a8bfd0', 0.8);
      ell(12, -5, 8, 3); fs('#f4f8fb', '#a8bfd0', 0.7);
    },
  });
  /** Crystal prism cluster. */
  function crystal(x, y, w, h, lean, col) {
    X.save(); X.translate(x, y); X.rotate(lean);
    spath([[-w, 0], [-w, -h * 0.75], [0, -h], [w, -h * 0.75], [w, 0]]);
    fs(lin(-w, 0, w, 0, [[0, shade(col, -0.25)], [0.45, shade(col, 0.35)], [0.5, shade(col, 0.1)], [1, shade(col, -0.1)]]), shade(col, -0.45), 1);
    spath([[-w, -h * 0.75], [0, -h], [0, -h * 0.82]]); fs('rgba(255,255,255,.55)');
    line(-w * 0.4, -h * 0.1, -w * 0.4, -h * 0.7, 'rgba(255,255,255,.6)', 1);
    X.restore();
  }
  scn('ice_shard', {
    box: [-36, -72, 36, 12], nv: 3,
    draw(v) {
      softShadow(22, 7);
      ell(0, 2, 20, 6); fs('#eef6fb', '#b8cfe0', 0.8);
      const col = pick(['#9ad8f0', '#b0e4f8', '#80c8ea'], v);
      crystal(-12, 2, 5, 28, -0.35, col);
      crystal(12, 2, 5, 24, 0.4, shade(col, 0.05));
      crystal(0, 4, 7, 48 + v * 6, 0.05 * (v - 1), col);
      crystal(6, 6, 4, 18, 0.2, shade(col, 0.1));
    },
    anim(t, seed) { const p = fract(t * 0.35 + seed * 0.13); sparkle(-2 + Math.sin(seed) * 6, -30 - p * 10, 4, Math.sin(p * PI), '#ffffff'); },
  });
  scn('dead_tree', {
    box: [-48, -96, 48, 12], nv: 3,
    draw(v) {
      softShadow(22, 7);
      ell(0, 2, 18, 6); fs('#f4f8fb', '#c4d6e4', 0.8);
      const col = '#5a4a3e';
      const br = (x0, y0, a, l, w, d) => {
        const x1 = x0 + Math.cos(a) * l, y1 = y0 + Math.sin(a) * l;
        X.beginPath(); X.moveTo(x0, y0); X.lineTo(x1, y1);
        X.strokeStyle = shade(col, -0.3); X.lineWidth = w + 1.2; X.lineCap = 'round'; X.stroke();
        X.strokeStyle = col; X.lineWidth = w; X.stroke();
        if (w > 2) { X.strokeStyle = '#ffffff'; X.lineWidth = w * 0.45; X.beginPath(); X.moveTo(x0 - w * 0.2, y0 - w * 0.4); X.lineTo(x1 - w * 0.2, y1 - w * 0.4); X.stroke(); }
        if (d < 4) { br(x1, y1, a - 0.5 - hash(d, v) * 0.3, l * 0.7, w * 0.62, d + 1); br(x1, y1, a + 0.45 + hash(d + 3, v) * 0.3, l * 0.66, w * 0.62, d + 1); }
      };
      br(0, 0, -PI / 2 + (v - 1) * 0.08, 34, 6.5, 0);
    },
  });

  // ================================================================ fallback art
  def('_unknown', {
    W: 1, D: 1, H: 40,
    draw() {
      groundShadow(1, 1, 0.8);
      crate(0.25, 0.25, 0, 0.5, '#b07a44');
      const p = P(0.5, 0.5, 34);
      txt('?', p[0], p[1] - 6, 14, '#ffe680', { stroke: '#3a2408' });
    },
  });

  // ================================================================ roads (thumbnails; the iso view draws the real road network)
  function roadTile(biome) {
    const cols = { land: ['#cdbb92', '#a8946a'], sea: ['#eadcb0', '#c4b088'], ice: ['#f4f8fb', '#b8cad8'] }[biome] || ['#cdbb92', '#a8946a'];
    box(0.04, 0.04, 0.96, 0.96, 0, 3, cols[0], {
      stroke: cols[1],
      texTop: () => {
        X.lineWidth = 0.02; X.strokeStyle = rgba(cols[1], 0.8);
        if (biome === 'ice') {
          for (const v of [0.3, 0.7]) { X.beginPath(); X.moveTo(0.1, v); X.lineTo(0.9, v); X.stroke(); for (let u = 0.15; u < 0.9; u += 0.1) { X.beginPath(); X.moveTo(u, v - 0.04); X.lineTo(u + 0.03, v + 0.04); X.stroke(); } }
        } else if (biome === 'sea') {
          for (let i = 0; i < 14; i++) { X.beginPath(); X.arc(0.1 + hash(i, 3) * 0.8, 0.1 + hash(i, 7) * 0.8, 0.02 + hash(i, 9) * 0.02, 0, TAU); X.fillStyle = i % 3 ? 'rgba(160,140,100,.6)' : 'rgba(255,240,230,.9)'; X.fill(); }
        } else {
          for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) { X.strokeRect(0.08 + c * 0.21 + (r % 2) * 0.05, 0.08 + r * 0.21, 0.19, 0.19); }
        }
      },
    });
  }
  def('road', { W: 1, D: 1, H: 20, biomeKey: true, draw(b) { roadTile(b.biome); } });
  for (const bio of ['land', 'sea', 'ice']) def('road_' + bio, { W: 1, D: 1, H: 20, park: bio, draw() { roadTile(bio); } });

  // ================================================================ sprite cache
  BA.cache = true;
  const cache = new Map(), lastByKey = new Map();
  let cachePx = 0, budget = 0, budgetAt = -1e9, fontsHooked = false;
  const MAX_PX = 14e6, BUDGET = 6;
  function clearCache() { cache.clear(); lastByKey.clear(); cachePx = 0; tightCache.clear(); thumbCache.clear(); hitMasks.clear(); }
  BA.clearCache = clearCache;
  function hookFonts() {
    if (fontsHooked) return;
    fontsHooked = true;
    try { if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', clearCache); } catch (e) { /* ignore */ }
  }
  function devScale(ctx) {
    try { const m = ctx.getTransform(); return Math.hypot(m.a, m.b) || 1; } catch (e) { return 1; }
  }
  const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  /** Quantise a render scale to ~15 % steps (rounded up for crispness), clamped. */
  const bucket = q => Math.pow(2, Math.ceil(Math.log2(clamp(q, 0.2, 3)) * 5 - 1e-6) / 5);

  function bboxOf(d) {
    const cy = (d.W + d.D) * HY / 2;
    return [-d.D * HX - (d.padX || 24), cy - d.H - 16, d.W * HX + (d.padX || 24), (d.W + d.D) * HY + (d.padY || 16)];
  }
  function sprite(key, q, bb, render) {
    const k = key + '@' + q.toFixed(3);
    let e = cache.get(k);
    if (e) { cache.delete(k); cache.set(k, e); return e; }
    const now = nowMs();
    if (now - budgetAt > 12) { budgetAt = now; budget = BUDGET; }
    if (budget <= 0) { const alt = lastByKey.get(key); return alt && cache.has(alt.k) ? alt : null; }
    budget--;
    const w = Math.ceil((bb[2] - bb[0]) * q), h = Math.ceil((bb[3] - bb[1]) * q);
    if (w < 1 || h < 1 || w * h > 8e6) return null;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.setTransform(q, 0, 0, q, -bb[0] * q, -bb[1] * q);
    g.lineJoin = 'round';
    withCtx(g, render);
    e = { c, k, x0: bb[0], y0: bb[1], w: bb[2] - bb[0], h: bb[3] - bb[1], px: w * h };
    cache.set(k, e); lastByKey.set(key, e); cachePx += e.px;
    while (cachePx > MAX_PX && cache.size > 1) {
      const first = cache.keys().next().value, fe = cache.get(first);
      cache.delete(first); cachePx -= fe.px;
    }
    return e;
  }

  function makeB(d, t, opts) {
    const c = P(d.W / 2, d.D / 2, 0);
    const ready = !!opts.ready;
    let g = opts.producing != null ? clamp(+opts.producing || 0, 0, 1) : 0.65;
    if (ready) g = 1;
    if (d.grow) g = Math.round(g * 4) / 4;
    return { W: d.W, D: d.D, t: t || 0, ready, g, opts, cx: c[0], cy: c[1], biome: opts.biome || d.park || 'land' };
  }
  function keyOf(d, b) {
    let k = d.id;
    if (d.grow) k += '|g' + b.g;
    if (d.biomeKey) k += '|' + b.biome;
    return k;
  }
  function drawStatic(ctx, d, b) {
    if (!BA.cache || typeof document === 'undefined') { d.draw(b); return; }
    const q = bucket(devScale(ctx));
    const spr = sprite(keyOf(d, b), q, bboxOf(d), () => d.draw(b));
    if (spr) ctx.drawImage(spr.c, spr.x0, spr.y0, spr.w, spr.h);
    else d.draw(b);
  }
  /** Draw a static sub-layer (e.g. a net drawn over animated fish) from the sprite cache at the current scale. */
  function cachedLayer(key, bb, render) {
    if (!BA.cache || typeof document === 'undefined') { render(); return; }
    const spr = sprite('lyr:' + key, bucket(devScale(X)), bb, render);
    if (spr) X.drawImage(spr.c, spr.x0, spr.y0, spr.w, spr.h); else render();
  }
  function readyFx(b, d) {
    const t = b.t, pulse = 0.5 + 0.5 * Math.sin(t * 4);
    const r = (d.W + d.D) * HX * 0.42;
    X.save();
    X.globalCompositeOperation = 'lighter';
    X.translate(b.cx, b.cy); X.scale(1, 0.5);
    X.fillStyle = H.radial(X, 0, 0, r * 0.2, r, [[0, `rgba(255,214,90,${0.16 + 0.12 * pulse})`], [1, 'rgba(255,214,90,0)']]);
    X.beginPath(); X.arc(0, 0, r, 0, TAU); X.fill();
    X.restore();
    const top = Math.min(d.H, 90);
    for (let i = 0; i < 7; i++) {
      const p = fract(t * 0.45 + i / 7);
      const a = i * 2.4 + t * 0.5;
      sparkle(b.cx + Math.cos(a) * r * 0.75, b.cy - 6 - p * top + Math.sin(a) * r * 0.22, 2.5 + 2.5 * Math.sin(p * PI), Math.sin(p * PI), i % 2 ? '#fff2a0' : '#ffffff');
    }
  }

  // ---------------------------------------------------------------- upgrade levels (opts.level 2..5)
  // Generic "plot upgrades" drawn around any non-special building: L2 star plaque, L3 corner flags +
  // ground lights, L4 tall banners + coloured bulbs, L5 everything in gold with rising sparkles.
  const LV_FLAG = { land: ['#2f8a3e', '#ffd23a'], sea: ['#1f8ac0', '#ffffff'], ice: ['#2a6ab0', '#e8f4ff'] };
  const BULBS = ['#ff5a4a', '#ffd23a', '#5ad06a', '#4ab0ff'];
  const fxSprites = new Map();
  /** Small canvases rendered once and reused every frame (glows, halos, plaques). */
  function fxSprite(key, w, h, render) {
    if (typeof document === 'undefined') return null;
    let c = fxSprites.get(key);
    if (c) return c;
    c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d');
    withCtx(g, () => render(g));
    fxSprites.set(key, c);
    return c;
  }
  /** Soft warm glow used for every light bulb. */
  const bulbSprite = () => fxSprite('bulb', 32, 32, g => {
    const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    gr.addColorStop(0, 'rgba(255,244,190,.95)'); gr.addColorStop(0.3, 'rgba(255,214,110,.45)'); gr.addColorStop(1, 'rgba(255,200,80,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
  });
  /** Soft green glow (sea greenhouse lights). */
  const greenGlowSprite = () => fxSprite('gglow', 32, 32, g => {
    const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    gr.addColorStop(0, 'rgba(190,255,200,.95)'); gr.addColorStop(0.35, 'rgba(80,255,140,.45)'); gr.addColorStop(1, 'rgba(60,255,120,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
  });
  /** Golden ring halo (unit sprite, stretched onto the ground ellipse). */
  const haloSprite = () => fxSprite('halo', 128, 128, g => {
    const gr = g.createRadialGradient(64, 64, 64 * 0.55, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,200,60,0)'); gr.addColorStop(0.55, 'rgba(255,200,60,.85)'); gr.addColorStop(1, 'rgba(255,200,60,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  });
  const PLQ = 3;                                // plaque sprite resolution (px per canonical px)
  /** Metal (or gold) plate on two short posts showing `n` stars; sprite anchored at its ground point. */
  function plaqueSprite(n, gold, k) {
    const w = (8 + n * 7.5) * k + 6, h = 20 * k;
    return fxSprite('plq' + n + (gold ? 'g' : '') + k, Math.ceil(w * PLQ), Math.ceil(h * PLQ), g => {
      g.scale(PLQ, PLQ);
      levelPlaque(w / 2, h - 1, n, gold, k);
    });
  }
  function levelPlaque(x, y, n, gold, k) {
    const ph = 4 * k, w = (8 + n * 7.5) * k, h = 11 * k, y1 = y - ph;
    for (const dx of [-w * 0.3, w * 0.3]) { X.fillStyle = '#2e3338'; X.fillRect(x + dx - 1 * k, y1, 2 * k, ph); }
    rrect(x - w / 2 - 1.5 * k, y1 - h - 1.5 * k, w + 3 * k, h + 3 * k, 3 * k); fs(gold ? '#6a4606' : '#22292e');
    rrect(x - w / 2, y1 - h, w, h, 2 * k);
    fs(lin(0, y1 - h, 0, y1, gold ? [[0, '#fff3b0'], [0.5, '#f0b830'], [1, '#a86e0e']] : [[0, '#b9c3c9'], [0.5, '#7d8a92'], [1, '#56616a']]));
    for (let i = 0; i < n; i++) {
      const sx = x + (i - (n - 1) / 2) * 7.5 * k, sy = y1 - h / 2, r = 3.3 * k, pts = [];
      for (let j = 0; j < 10; j++) { const rr = j % 2 ? r * 0.45 : r, a = -PI / 2 + j * PI / 5; pts.push([sx + Math.cos(a) * rr, sy + Math.sin(a) * rr]); }
      spath(pts); fs(gold ? '#fffbe0' : '#ffd23a', gold ? '#8a5a06' : '#6a4406', 0.7 * k);
    }
  }
  /** Screen points of the light bulbs along the two front edges (cached per footprint). */
  const bulbCache = new Map();
  function bulbPoints(d) {
    const key = d.W + 'x' + d.D;
    if (bulbCache.has(key)) return bulbCache.get(key);
    const pts = [], big = d.W * d.D > 1, step = big ? 0.34 : 0.5, e = 0.06;
    for (let v = e; v <= d.D - e + 1e-6; v += step) pts.push(P(d.W - e, v, 2));
    for (let u = d.W - e - step; u >= e - 1e-6; u -= step) pts.push(P(u, d.D - e, 2));
    bulbCache.set(key, pts);
    return pts;
  }
  function levelFx(d, b, lvl) {
    const t = b.t, big = d.W * d.D > 1, k = big ? 1 : 0.8, gold = lvl >= 5, ga = X.globalAlpha;
    const cols = gold ? ['#f0b830', '#c8372a'] : (LV_FLAG[b.biome] || LV_FLAG.land);
    // L5: golden halo on the ground (drawn first so it sits under the props)
    if (gold) {
      const r = (d.W + d.D) * HX * 0.5, spr = haloSprite();
      if (spr) {
        X.save(); X.globalCompositeOperation = 'lighter'; X.globalAlpha = ga * (0.16 + 0.1 * Math.sin(t * 2.4));
        X.drawImage(spr, b.cx - r, b.cy - r * 0.5, r * 2, r); X.restore();
      }
    }
    // L3+: light bulbs along the two front edges (left corner → front corner → right corner), batched
    if (lvl >= 3) {
      const pts = bulbPoints(d), spr = bulbSprite(), nc = lvl >= 4 ? 4 : 1;
      X.beginPath();
      for (const p of pts) { X.moveTo(p[0], p[1]); X.lineTo(p[0], p[1] - 3); }
      X.strokeStyle = '#3a3f44'; X.lineWidth = 1.2; X.stroke();
      if (spr) {
        X.save(); X.globalCompositeOperation = 'lighter';
        for (let grp = 0; grp < 2; grp++) {
          X.globalAlpha = ga * (0.5 + 0.4 * Math.sin(t * 3 + grp * PI));
          for (let i = grp; i < pts.length; i += 2) X.drawImage(spr, pts[i][0] - 12, pts[i][1] - 16, 24, 24);
        }
        X.restore();
      }
      for (let c = 0; c < nc; c++) {
        X.beginPath();
        for (let i = c; i < pts.length; i += nc) { const p = pts[i]; X.moveTo(p[0] + 2.4, p[1] - 4); X.arc(p[0], p[1] - 4, 2.4, 0, TAU); }
        fs(nc > 1 ? BULBS[c] : '#ffe27a', 'rgba(0,0,0,.5)', 0.6);
      }
      X.beginPath();
      for (const p of pts) { X.moveTo(p[0] + 0.1, p[1] - 4.8); X.arc(p[0] - 0.8, p[1] - 4.8, 0.9, 0, TAU); }
      X.fillStyle = 'rgba(255,255,255,.95)'; X.fill();
    }
    // L3+: flag poles at the left and right corners (L4+: tall banners)
    if (lvl >= 3 && big) {
      const hgt = lvl >= 4 ? 58 : 44;
      [[0.1, d.D - 0.1, -1], [d.W - 0.1, 0.1, 1]].forEach(([u, v, dir], i) => {
        const p = P(u, v, 0);
        ell(p[0], p[1], 5, 2.2); X.fillStyle = 'rgba(0,0,0,.22)'; X.fill();
        pole(p[0], p[1], hgt, gold ? '#d8a020' : '#9aa4ac', 2.2);
        if (lvl >= 4) {
          // vertical banner hanging from a short arm
          const bx = p[0] + dir * 2, by = p[1] - hgt + 3, wv = Math.sin(t * 3 + i) * 1.5, bw = 11, bh = 24;
          line(p[0], by, p[0] + dir * (bw + 3), by, gold ? '#d8a020' : '#6a747c', 1.6);
          spath([[bx, by], [bx + dir * bw, by], [bx + dir * bw + wv, by + bh], [bx + dir * bw / 2 + wv, by + bh - 5], [bx + wv, by + bh]]);
          fs(shade(cols[0], -0.05), ink(cols[0]), 0.8);
          line(bx + dir * 1.5, by + 3, bx + dir * (bw - 1.5), by + 3, cols[1], 1.4);
          const sx = bx + dir * bw / 2 + wv * 0.5, sy = by + 11, pts = [];
          for (let j = 0; j < 10; j++) { const rr = j % 2 ? 1.6 : 3.6, a = -PI / 2 + j * PI / 5; pts.push([sx + Math.cos(a) * rr, sy + Math.sin(a) * rr]); }
          spath(pts); fs(cols[1]);
        } else cloth(p[0] + dir, p[1] - hgt + 1, 15, 10, t, cols[0], cols[1], i * 1.7, dir);
      });
    }
    // L2+: star plaque at the front corner (pre-rendered sprite)
    const f = P(d.W, d.D, 0), spr = plaqueSprite(lvl, gold, k);
    if (spr) X.drawImage(spr, f[0] - spr.width / PLQ / 2, f[1] + 8 - spr.height / PLQ, spr.width / PLQ, spr.height / PLQ);
    else levelPlaque(f[0], f[1] + 7, lvl, gold, k);
    // L5: sparkles rising around the building
    if (gold) {
      const r = (d.W + d.D) * HX * 0.36, top = Math.min(d.H, 100);
      for (let i = 0; i < 6; i++) {
        const p = fract(t * 0.35 + i / 6), a = i * 2.1 + t * 0.3;
        sparkle(b.cx + Math.cos(a) * r, b.cy - 4 - p * top + Math.sin(a) * r * 0.3, 2 + 2.5 * Math.sin(p * PI), Math.sin(p * PI), i % 2 ? '#ffe680' : '#ffffff');
      }
    }
  }
  /** Level visuals apply to buyable buildings only (not to specials, roads or the fallback art). */
  function levelOf(artId, d, opts) {
    const lvl = Math.min(5, Math.floor(+opts.level || 1));
    if (lvl < 2 || d.id === 'road' || d.id[0] === '_' || /^road_/.test(d.id)) return 0;
    const def = PC.DATA && PC.DATA.BUILDINGS && PC.DATA.BUILDINGS[artId];
    if (def && (def.kind === 'special' || def.kind === 'road')) return 0;
    return lvl;
  }

  /**
   * Draw building art `artId` standing on footprint diamond fp (ctx coordinates, camera applied).
   * opts: { alpha, ghost, ready, producing (0..1), biome, level (1..5) }
   * - ghost: placement preview → translucent (alpha 0.7 unless `alpha` is given), no "ready" sparkle.
   * - ready: golden glow + sparkles (production finished); producing drives growth visuals of farms.
   * - level ≥ 2: upgrade decorations (plaque with stars, flags, lights, gold at level 5).
   */
  BA.draw = function (ctx, artId, fp, t, opts) {
    if (!ctx || !fp || !fp.top || !fp.bottom || !fp.left || !fp.right) return;
    const d = DEFS[artId] || DEFS._unknown;
    opts = opts || {};
    const span = fp.right[0] - fp.left[0];
    const s = span / ((d.W + d.D) * HX);
    if (!(s > 0.005)) return;
    hookFonts();
    const b = makeB(d, t, opts);
    const ghost = !!opts.ghost, lvl = levelOf(artId, d, opts);
    const mx = (fp.top[0] + fp.bottom[0]) / 2, my = (fp.top[1] + fp.bottom[1]) / 2;
    ctx.save();
    if (opts.alpha != null) ctx.globalAlpha *= clamp(+opts.alpha, 0, 1);
    else if (ghost) ctx.globalAlpha *= 0.7;
    ctx.translate(mx, my);
    ctx.scale(s, s);
    ctx.translate(-b.cx, -b.cy);
    withCtx(ctx, () => {
      try {
        if (d.sway) {
          const k = Math.sin(b.t * 1.3 + (fp.top[0] + fp.top[1]) * 0.01) * d.sway;
          X.save(); X.translate(b.cx, b.cy); X.transform(1, 0, k, 1, 0, 0); X.translate(-b.cx, -b.cy);
          drawStatic(ctx, d, b);
          X.restore();
        } else drawStatic(ctx, d, b);
        if (d.anim) d.anim(b);
        if (lvl) levelFx(d, b, lvl);
        if (b.ready && !ghost) readyFx(b, d);
      } catch (e) {
        if (!BA._warned) { BA._warned = true; console.warn('BUILD_ART', artId, e); }
      }
    });
    ctx.restore();
  };

  /** Footprint [W, D] the art was designed for. */
  BA.size = id => { const d = DEFS[id]; return d ? [d.W, d.D] : [1, 1]; };
  BA.has = id => !!DEFS[id] && id[0] !== '_';

  // ---------------------------------------------------------------- tight bounds & thumbnails
  const tightCache = new Map(), thumbCache = new Map();
  function tightBounds(d, b, staticOnly) {
    const key = keyOf(d, b) + (staticOnly ? '|s' : '');
    if (tightCache.has(key)) return tightCache.get(key);
    const bb = bboxOf(d), m = 40;
    const w = Math.ceil(bb[2] - bb[0] + m * 2), h = Math.ceil(bb[3] - bb[1] + m * 2);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.translate(-bb[0] + m, -bb[1] + m);
    withCtx(g, () => { d.draw(b); if (d.anim && !staticOnly) d.anim(b); });
    let res = bb;
    try {
      const data = g.getImageData(0, 0, w, h).data;
      let x0 = w, y0 = h, x1 = -1, y1 = -1;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (data[(y * w + x) * 4 + 3] > 10) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      }
      if (x1 >= 0) res = [x0 + bb[0] - m, y0 + bb[1] - m, x1 + 1 + bb[0] - m, y1 + 1 + bb[1] - m];
    } catch (e) { /* keep generous box */ }
    tightCache.set(key, res);
    return res;
  }
  // ---------------------------------------------------------------- hit testing (drawn silhouette)
  const hitMasks = new Map();
  const MASK_Q = 0.5, MASK_ALPHA = 96, MASK_M = 40;   // mask px per canonical px, opacity threshold, margin around bboxOf
  /** Opacity mask of a building's art (static + animated parts at rest + level decorations); faint glows/smoke excluded. */
  function hitMask(d, b, lvl) {
    const key = keyOf(d, b) + '|L' + lvl;
    if (hitMasks.has(key)) return hitMasks.get(key);
    let res = null;
    try {
      const bb = bboxOf(d), q = MASK_Q, x0 = bb[0] - MASK_M, y0 = bb[1] - MASK_M;
      const w = Math.ceil((bb[2] - bb[0] + MASK_M * 2) * q), h = Math.ceil((bb[3] - bb[1] + MASK_M * 2) * q);
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.setTransform(q, 0, 0, q, -x0 * q, -y0 * q);
      g.lineJoin = 'round';
      withCtx(g, () => { d.draw(b); if (d.anim) d.anim(b); if (lvl) levelFx(d, b, lvl); });
      const px = g.getImageData(0, 0, w, h).data, data = new Uint8Array(w * h);
      for (let i = 0; i < w * h; i++) data[i] = px[i * 4 + 3] > MASK_ALPHA ? 1 : 0;
      res = { x0, y0, w, h, q, data };
    } catch (e) { res = null; }
    hitMasks.set(key, res);
    return res;
  }
  /**
   * Does ctx point (x, y) lie on the drawn silhouette of building `artId` standing on footprint fp
   * (same fp / opts as BA.draw), within `slop` ctx units (finger tolerance)? Transparent parts (the air above
   * a round arena's rim, gaps between props) do not count, so taps reach whatever is visible behind.
   * Returns null when no mask can be built (caller falls back to a box).
   */
  BA.hit = function (artId, fp, x, y, opts, slop) {
    if (!fp || !fp.left || !fp.right || !fp.top || !fp.bottom || typeof document === 'undefined') return null;
    const d = DEFS[artId] || DEFS._unknown;
    opts = opts || {};
    const s = (fp.right[0] - fp.left[0]) / ((d.W + d.D) * HX);
    if (!(s > 0.005)) return null;
    const b = makeB(d, 0, opts), bb = bboxOf(d), sl = Math.max(0, +slop || 0) / s;
    const ax = (x - (fp.top[0] + fp.bottom[0]) / 2) / s + b.cx, ay = (y - (fp.top[1] + fp.bottom[1]) / 2) / s + b.cy;
    const M = MASK_M + sl;
    if (ax < bb[0] - M || ax > bb[2] + M || ay < bb[1] - M || ay > bb[3] + M) return false;   // far away: no mask needed
    const mk = hitMask(d, b, levelOf(artId, d, opts));
    if (!mk) return null;
    const mx = Math.floor((ax - mk.x0) * mk.q), my = Math.floor((ay - mk.y0) * mk.q), r = Math.min(12, Math.ceil(sl * mk.q));
    for (let dy = -r; dy <= r; dy++) {
      const yy = my + dy;
      if (yy < 0 || yy >= mk.h) continue;
      for (let dx = -r; dx <= r; dx++) {
        const xx = mx + dx;
        if (xx >= 0 && xx < mk.w && dx * dx + dy * dy <= r * r && mk.data[yy * mk.w + xx]) return true;
      }
    }
    return false;
  };
  /** Cached thumbnail canvas (w×h px) of a building for market cards. */
  BA.thumb = function (artId, w, h) {
    w = Math.max(1, Math.round(w || 96)); h = Math.max(1, Math.round(h || w));
    const key = artId + '|' + w + '|' + h;
    if (thumbCache.has(key)) return thumbCache.get(key);
    hookFonts();
    const d = DEFS[artId] || DEFS._unknown;
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d');
    const b = makeB(d, 1.15, { producing: 1, biome: d.park });
    try {
      const tb = tightBounds(d, b);
      const fit = Math.min(w * 0.94 / (tb[2] - tb[0]), h * 0.94 / (tb[3] - tb[1]));
      g.setTransform(fit, 0, 0, fit, w / 2 - (tb[0] + tb[2]) / 2 * fit, h / 2 - (tb[1] + tb[3]) / 2 * fit);
      withCtx(g, () => { d.draw(b); if (d.anim) d.anim(b); });
    } catch (e) { if (!BA._warned) { BA._warned = true; console.warn('BUILD_ART thumb', artId, e); } }
    thumbCache.set(key, c);
    return c;
  };

  // ---------------------------------------------------------------- scenery
  /**
   * Draw a scenery element at ground point (x, y); size ≈ tile width in ctx units (96 at zoom 1).
   * Kinds: land palm, fern, broadleaf, bush, rock, flowers; sea coral_fan, coral_brain, kelp, sea_rock, anemone;
   * ice pine, snow_rock, ice_shard, dead_tree.
   */
  BA.drawScenery = function (ctx, kind, x, y, size, t, seed) {
    const S = SCN[kind];
    if (!ctx || !S) return;
    seed = Math.abs(seed | 0);
    const k = (size || 96) / 96 * (0.82 + hash(seed, 1) * 0.36);
    const flip = (seed >> 2) & 1 ? -1 : 1;
    const variant = seed % (S.nv || 1);
    ctx.save();
    ctx.translate(x, y);
    if (S.sway) { const sh = Math.sin((t || 0) * (S.swaySpeed || 1.3) + seed * 0.7) * S.sway; ctx.transform(1, 0, sh, 1, 0, 0); }
    ctx.scale(k * flip, k);
    withCtx(ctx, () => {
      try {
        const bb = S.box;
        if (BA.cache && typeof document !== 'undefined') {
          const q = bucket(devScale(ctx));
          const spr = sprite('scn:' + kind + ':' + variant, q, bb, () => S.draw(variant, seed));
          if (spr) ctx.drawImage(spr.c, spr.x0, spr.y0, spr.w, spr.h); else S.draw(variant, seed);
        } else S.draw(variant, seed);
        if (S.anim) S.anim(t || 0, seed, variant);
      } catch (e) { if (!BA._warned) { BA._warned = true; console.warn('BUILD_ART scenery', kind, e); } }
    });
    ctx.restore();
  };

  BA.ids = Object.keys(DEFS).filter(id => id[0] !== '_');
  BA.sceneryKinds = Object.keys(SCN);
  BA._debug = { DEFS, SCN, bboxOf, tightBounds: (id, o, st) => tightBounds(DEFS[id], makeB(DEFS[id], 1.15, o || { producing: 1 }), st), makeB };
})(window.PC = window.PC || {});
