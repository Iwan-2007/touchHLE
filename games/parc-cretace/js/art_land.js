/* Crétacé Park — land creature templates (art-land module).
   Registers with PC.ART.registerTemplate: theropod, ceratopsian, stegosaur, ankylosaur, ornithomimid,
   hadrosaur, pachy, sauropod, pterosaur.
   Local units: origin = ground point under the body, +x = towards the head, -y = up (size 1 ≈ 120–170 long).
   Every template reads o.stage (0 Bébé … 3 Alpha) to change proportions, colours and ornaments. */
(function (PC) {
  'use strict';
  const ART = PC.ART;
  if (!ART || !ART.registerTemplate || !ART.helpers) return;
  const H = ART.helpers;
  const PI = Math.PI, TAU = PI * 2;
  const LW = 2.2; // outline width (local units)

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smoothstep = x => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
  const has = (sp, f) => sp.features.indexOf(f) >= 0;
  const lerpPt = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const rotAround = (p, c, a) => {
    const s = Math.sin(a), co = Math.cos(a), x = p[0] - c[0], y = p[1] - c[1];
    return [c[0] + x * co - y * s, c[1] + x * s + y * co];
  };
  /** Body frame: maps (x, y) relative to origin o, rotated by angle a, into local coordinates. */
  const frame = (o, a) => { const c = Math.cos(a), s = Math.sin(a); return (x, y) => [o[0] + x * c - y * s, o[1] + x * s + y * c]; };

  // ---------- Colour helpers ----------
  const toHex = (r, g, b) => '#' + [r, g, b].map(v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
  function hslOf(hex) {
    const [r, g, b] = H.hexToRgb(hex).map(v => v / 255);
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
    if (mx === mn) return [0, 0, l];
    const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    let h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h / 6, s, l];
  }
  function fromHsl(h, s, l) {
    const f = (p, q, t) => {
      t = (t + 1) % 1;
      return t < 1 / 6 ? p + (q - p) * 6 * t : t < 0.5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p;
    };
    if (!s) return toHex(l * 255, l * 255, l * 255);
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    return toHex(f(p, q, h + 1 / 3) * 255, f(p, q, h) * 255, f(p, q, h - 1 / 3) * 255);
  }
  const saturate = (hex, amt) => { const c = hslOf(hex); return fromHsl(c[0], clamp(c[1] * (1 + amt), 0, 1), c[2]); };
  const vivid = (hex, l) => { const c = hslOf(hex); return fromHsl(c[0], Math.max(0.78, c[1]), l); };

  // ---------- Evolution stages ----------
  // head/eye: baby proportions, leg: leg length, feat: horns/plates/spikes/crests, teeth, tail/neck length, chub: roundness
  const STAGE = [
    { head: 1.4, eye: 1.6, leg: 0.8, feat: 0.2, teeth: 0, tail: 0.74, neck: 0.8, chub: 1.1 },
    { head: 1.16, eye: 1.22, leg: 0.92, feat: 0.58, teeth: 0.6, tail: 0.88, neck: 0.92, chub: 1.03 },
    { head: 1, eye: 1, leg: 1, feat: 1, teeth: 1, tail: 1, neck: 1, chub: 1 },
    { head: 1.05, eye: 0.98, leg: 1.02, feat: 1.3, teeth: 1.3, tail: 1.03, neck: 1, chub: 1.06 },
  ];

  /** Palette per species and stage (cached: no string work per frame). */
  const palCache = new Map();
  function pal(sp, st) {
    const key = sp.id + '|' + st;
    let P = palCache.get(key);
    if (P) return P;
    let body = sp.colors.body, belly = sp.colors.belly, acc = sp.colors.accent;
    if (st === 0) { body = H.shade(H.mix(body, belly, 0.32), 0.1); belly = H.shade(belly, 0.15); acc = H.mix(acc, belly, 0.4); }
    else if (st === 1) { body = H.mix(body, belly, 0.13); acc = H.mix(acc, belly, 0.14); }
    else if (st === 3) { body = saturate(H.shade(body, -0.2), 0.35); belly = saturate(H.shade(belly, -0.06), 0.2); acc = saturate(H.shade(acc, -0.04), 0.45); }
    const ink = H.ink(body);
    P = {
      body, belly, acc, ink,
      far: H.shade(body, -0.3), dark: H.shade(body, -0.28), light: H.shade(body, 0.3),
      jaw: H.mix(body, belly, 0.5),
      pat: H.rgba(H.shade(H.mix(body, acc, st === 3 ? 0.5 : 0.28), -0.5), [0.2, 0.32, 0.42, 0.66][st]),
      patAcc: H.rgba(acc, [0.3, 0.45, 0.6, 0.85][st]),
      texD: H.rgba(H.shade(body, -0.55), 0.17), texL: H.rgba(H.shade(body, 0.6), 0.2),
      edge: H.rgba(ink, 0.24), rim: H.rgba(H.shade(body, 0.7), 0.6),
      bellyA: H.rgba(belly, 0.42), bellyB: H.rgba(belly, 0.8),
      horn: H.mix('#efe2c4', body, 0.12), hornFar: H.mix('#b9ac90', body, 0.3), hornTip: 'rgba(70,52,34,.75)',
      claw: '#2b2119', tooth: '#f7f0dc', mouth: '#5a1a18', tongue: '#b9504f',
      beak: H.shade(H.mix(body, '#3a3026', 0.62), -0.08),
      plate: H.mix(acc, body, 0.3), plateFar: H.shade(H.mix(acc, body, 0.45), -0.3),
      glow: vivid(acc, 0.58), glowCore: vivid(acc, 0.88),
      scar: 'rgba(250,234,214,.92)',
    };
    palCache.set(key, P);
    return P;
  }

  /** Per-draw animation state shared by every template. */
  function poseOf(o, sp) {
    const st = clamp(o.stage == null ? 3 : o.stage | 0, 0, 3);
    const pose = o.pose === 'swim' ? 'walk' : (o.pose || 'idle');
    const t = o.t || 0;
    const blinkPh = (t + sp.seed * 0.71) % 4.3;
    return {
      st, S: STAGE[st], P: pal(sp, st), t, pose, k: clamp(o.k || 0, 0, 1),
      br: H.breath(o), lg: H.lunge(o), jw: H.jaw(o), rc: H.recoil(o),
      look: pose === 'idle' ? H.idleLook(o) : 0,
      blink: pose !== 'hurt' && blinkPh < 0.13,
      hurt: pose === 'hurt', angry: pose === 'attack' || pose === 'roar',
    };
  }
  // Herbivore stomp: rise (k 0..0.35), slam (0.35..0.55, impact at the lunge peak), recover.
  const rearCurve = k => (k < 0.35 ? smoothstep(k / 0.35) : k < 0.55 ? 1 - smoothstep((k - 0.35) / 0.2) : 0);
  const slamFwd = k => (k < 0.35 ? 0 : k < 0.55 ? smoothstep((k - 0.35) / 0.2) : 1 - smoothstep((k - 0.55) / 0.45));

  // ---------- Geometry ----------
  /** Two-bone IK from a to b. dir +1 bends the middle joint forward (+x) for a downward chain.
      Returns [jx, jy, ex, ey] (middle joint, reachable end point). */
  function ik2(ax, ay, bx, by, l1, l2, dir) {
    let dx = bx - ax, dy = by - ay, d = Math.hypot(dx, dy) || 0.001;
    const mx = (l1 + l2) * 0.995, mn = Math.abs(l1 - l2) + 0.5;
    if (d > mx) { dx *= mx / d; dy *= mx / d; d = mx; } else if (d < mn) { dx *= mn / d; dy *= mn / d; d = mn; }
    const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    const ux = dx / d, uy = dy / d;
    return [ax + ux * a + uy * h * dir, ay + uy * a - ux * h * dir, ax + dx, ay + dy];
  }

  /** Tail chain from base going backwards. ang ≈ PI points straight back (PI + x tilts up). Returns joints tip-first. */
  function tailJoints(X, base, ang, len, n, curl, amp, speed) {
    const out = new Array(n);
    let x = base[0], y = base[1], a = ang;
    for (let i = 1; i <= n; i++) {
      a += curl + Math.sin(X.t * speed - i * 0.9) * amp * i / n;
      x += Math.cos(a) * len / n;
      y += Math.sin(a) * len / n;
      out[n - i] = [x, y];
    }
    return out;
  }

  /** Closed outline around a spine with separate back (up) and belly (dn) half-thicknesses. */
  function trunk(joints, up, dn) {
    const n = joints.length, top = new Array(n), bot = new Array(n), nx = new Array(n), ny = new Array(n);
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (let i = 0; i < n; i++) {
      const a = joints[i > 0 ? i - 1 : 0], b = joints[i < n - 1 ? i + 1 : n - 1];
      let dx = b[0] - a[0], dy = b[1] - a[1];
      const l = Math.hypot(dx, dy) || 1;
      dx /= l; dy /= l;
      nx[i] = -dy; ny[i] = dx; // "down" normal
      const j = joints[i];
      top[i] = [j[0] + dy * up[i], j[1] - dx * up[i]];
      bot[i] = [j[0] - dy * dn[i], j[1] + dx * dn[i]];
      for (const p of [top[i], bot[i]]) {
        if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
        if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
      }
    }
    const pts = top.slice();
    for (let i = n - 1; i >= 0; i--) pts.push(bot[i]);
    return { joints, up, dn, top, bot, nx, ny, pts, n, box: [x0, y0, x1, y1] };
  }
  /** Point on the trunk at fractional joint index u, offset d along the down normal (negative = towards the back). */
  function along(T, u, f) {
    const i = clamp(Math.floor(u), 0, T.n - 1), i2 = Math.min(T.n - 1, i + 1), w = u - i;
    const j = lerpPt(T.joints[i], T.joints[i2], w);
    const nx = lerp(T.nx[i], T.nx[i2], w), ny = lerp(T.ny[i], T.ny[i2], w);
    const th = f < 0 ? lerp(T.up[i], T.up[i2], w) : lerp(T.dn[i], T.dn[i2], w);
    return [j[0] + nx * th * f, j[1] + ny * th * f, nx, ny];
  }

  // ---------- Painting ----------
  const dotCache = new Map();
  function dotsFor(seed, n) {
    const key = seed * 1009 + n;
    let d = dotCache.get(key);
    if (!d) {
      const r = H.rng(seed * 31 + 7);
      d = new Float32Array(n * 3);
      for (let i = 0; i < d.length; i++) d[i] = r();
      dotCache.set(key, d);
    }
    return d;
  }
  /** Skin texture: small dark scales with a light bead on each (call inside a clip). */
  function texture(ctx, P, seed, x0, y0, x1, y1, n, r0, r1) {
    const d = dotsFor(seed, n), w = x1 - x0, h = y1 - y0;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = x0 + d[i * 3] * w, y = y0 + d[i * 3 + 1] * h, r = r0 + d[i * 3 + 2] * (r1 - r0);
      ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, TAU);
    }
    ctx.fillStyle = P.texD; ctx.fill();
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const r = (r0 + d[i * 3 + 2] * (r1 - r0)) * 0.45, x = x0 + d[i * 3] * w - r * 0.7, y = y0 + d[i * 3 + 1] * h - r * 0.9;
      ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, TAU);
    }
    ctx.fillStyle = P.texL; ctx.fill();
  }
  /** Species pattern (stripes / spots) inside a box (call inside a clip). */
  function pattern(ctx, sp, X, x0, y0, x1, y1, k) {
    k = k || 1;
    const bold = X.st === 3 ? 1.35 : X.st === 0 ? 0.8 : 1;
    if (sp.pattern === 'stripes') H.stripes(ctx, sp.seed * 13 + 1, x0, y0, x1, y1, Math.max(3, Math.round((x1 - x0) / 12 * k)), 4.4 * bold * k, X.P.pat, 0.26);
    else if (sp.pattern === 'spots') H.spots(ctx, sp.seed * 13 + 1, x0, y0, x1, y1, Math.max(4, Math.round((x1 - x0) * (y1 - y0) / 140 * k)), 1.6 * bold * k, 4 * bold * k, X.P.pat);
  }
  function band(ctx, T, i0, i1, f, col) {
    const pts = [];
    for (let i = i0; i <= i1; i++) { const d = T.dn[i] * f; pts.push([T.joints[i][0] + T.nx[i] * d, T.joints[i][1] + T.ny[i] * d]); }
    for (let i = i1; i >= i0; i--) { const d = T.dn[i] + 16; pts.push([T.joints[i][0] + T.nx[i] * d, T.joints[i][1] + T.ny[i] * d]); }
    H.smooth(ctx, pts, true, 0.5);
    ctx.fillStyle = col;
    ctx.fill();
  }
  function rimLine(ctx, T, i0, i1, col, w) {
    const pts = [];
    for (let i = i0; i <= i1; i++) pts.push([T.top[i][0] + T.nx[i] * 1.7, T.top[i][1] + T.ny[i] * 1.7]);
    H.smooth(ctx, pts, false, 0.5);
    ctx.lineWidth = w; ctx.strokeStyle = col; ctx.lineCap = 'round';
    ctx.stroke();
  }
  /**
   * Fill and shade a trunk: countershaded belly, pattern, scale texture, edge occlusion, rim light, highlight, outline.
   * opt: { pat: [x0,y0,x1,y1], belly: [i0,i1] | false, rim: [i0,i1], hl: [x,y,r], tex: n, extra: fn (inside clip) }
   */
  function paintTrunk(ctx, X, sp, T, fill, opt) {
    const P = X.P, b = T.box;
    H.smooth(ctx, T.pts, true, 0.5);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.save();
    ctx.clip();
    if (opt.belly !== false) {
      const i0 = opt.belly ? opt.belly[0] : 1, i1 = opt.belly ? opt.belly[1] : T.n - 1;
      band(ctx, T, i0, i1, 0.1, P.bellyA);
      band(ctx, T, i0, i1, 0.48, P.bellyB);
    }
    if (opt.pat) pattern(ctx, sp, X, opt.pat[0], opt.pat[1], opt.pat[2], opt.pat[3], opt.patK);
    texture(ctx, P, sp.seed, b[0], b[1], b[2], b[3], opt.tex || 70, 0.8, 2.1);
    if (opt.extra) opt.extra();
    H.smooth(ctx, T.pts, true, 0.5);
    ctx.lineWidth = 8; ctx.strokeStyle = P.edge; ctx.stroke();
    if (opt.rim) rimLine(ctx, T, opt.rim[0], opt.rim[1], P.rim, 2.6);
    if (opt.hl) {
      ctx.fillStyle = H.radial(ctx, opt.hl[0], opt.hl[1], 0, opt.hl[2], [[0, 'rgba(255,250,232,.3)'], [1, 'rgba(255,250,232,0)']]);
      ctx.fillRect(b[0], b[1], b[2] - b[0], b[3] - b[1]);
    }
    ctx.restore();
    H.smooth(ctx, T.pts, true, 0.5);
    ctx.lineWidth = LW; ctx.strokeStyle = P.ink; ctx.lineJoin = 'round';
    ctx.stroke();
  }
  /** Fill + shade a closed shape given by pathFn (heads, frills…): fill, inner edge shade, optional extra, outline. */
  function paintShape(ctx, X, pathFn, fill, extra, lw) {
    const P = X.P;
    pathFn();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.save();
    ctx.clip();
    if (extra) extra();
    pathFn();
    ctx.lineWidth = 6; ctx.strokeStyle = P.edge; ctx.stroke();
    ctx.restore();
    pathFn();
    ctx.lineWidth = lw || LW; ctx.strokeStyle = P.ink; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.stroke();
  }
  function openPath(ctx, pts) { H.smooth(ctx, pts, false, 0.5); }

  /** Pulsing glowing marking (Alpha stage). segs = array of polylines. */
  function glowLines(ctx, X, segs, w) {
    const P = X.P, pulse = 0.72 + 0.28 * Math.sin(X.t * 3.2);
    ctx.save();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    for (const s of segs) { ctx.moveTo(s[0][0], s[0][1]); for (let i = 1; i < s.length; i++) ctx.lineTo(s[i][0], s[i][1]); }
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = H.rgba(P.glow, 0.3 * pulse); ctx.lineWidth = w * 3.4; ctx.stroke();
    ctx.strokeStyle = H.rgba(P.glow, 0.55 * pulse); ctx.lineWidth = w * 1.9; ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = P.glowCore; ctx.lineWidth = w; ctx.stroke();
    ctx.restore();
  }
  /** Pale battle scars (Alpha stage). */
  function scarLines(ctx, X, segs, w) {
    ctx.save();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    for (const s of segs) { ctx.moveTo(s[0][0], s[0][1]); for (let i = 1; i < s.length; i++) ctx.lineTo(s[i][0], s[i][1]); }
    ctx.strokeStyle = 'rgba(70,30,22,.4)'; ctx.lineWidth = w * 2; ctx.stroke();
    ctx.strokeStyle = X.P.scar; ctx.lineWidth = w; ctx.stroke();
    ctx.restore();
  }
  /** Three parallel claw-mark scars around (x, y) at angle a. */
  function clawScars(ctx, X, x, y, a, len, w) {
    const c = Math.cos(a), s = Math.sin(a), segs = [];
    for (let i = -1; i <= 1; i++) {
      const ox = -s * i * w * 2.6, oy = c * i * w * 2.6, l = len * (1 - Math.abs(i) * 0.18);
      segs.push([[x + ox - c * l / 2, y + oy - s * l / 2], [x + ox + c * l / 2, y + oy + s * l / 2]]);
    }
    scarLines(ctx, X, segs, w);
  }

  /** Detailed eye with blink, squeeze (hurt) and optional brow ridge. */
  function eye(ctx, X, x, y, r, opt) {
    const P = X.P;
    opt = opt || {};
    ctx.save();
    if (X.hurt) {
      H.ellipse(ctx, x, y, r * 1.3, r * 1.05);
      ctx.fillStyle = 'rgba(20,12,6,.4)'; ctx.fill();
      ctx.strokeStyle = P.ink; ctx.lineWidth = Math.max(0.8, r * 0.5); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(x - r * 1.1, y - r * 0.75); ctx.lineTo(x + r * 0.7, y); ctx.lineTo(x - r * 1.1, y + r * 0.75); ctx.stroke();
    } else if (X.blink) {
      H.ellipse(ctx, x, y, r * 1.25, r * 1.05);
      ctx.fillStyle = P.dark; ctx.fill();
      ctx.strokeStyle = P.ink; ctx.lineWidth = Math.max(0.8, r * 0.4); ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(x, y - r * 0.4, r * 1.05, 0.35, PI - 0.35); ctx.stroke();
    } else {
      H.eye(ctx, x, y, r, { iris: opt.iris, pupil: opt.pupil });
      ctx.strokeStyle = H.rgba(P.ink, 0.85); ctx.lineWidth = Math.max(0.7, r * 0.38); ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(x, y + r * 0.2, r * 1.15, PI + 0.3, TAU - 0.15); ctx.stroke();
    }
    if (opt.brow) {
      const a = X.angry || X.hurt ? r * 0.6 : 0;
      ctx.strokeStyle = opt.browCol || P.dark; ctx.lineWidth = r * 0.8; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(x - r * 1.7, y - r * 1.3 - a * 0.3); ctx.quadraticCurveTo(x, y - r * 2.0, x + r * 1.6, y - r * 1.2 + a); ctx.stroke();
    }
    ctx.restore();
  }

  /** Tapered, curved horn/spike from base (bx,by) to tip (tx,ty). bend bows it sideways (fraction of length). */
  function horn(ctx, X, bx, by, tx, ty, w, bend, col, lw) {
    const P = X.P;
    const dx = tx - bx, dy = ty - by, l = Math.hypot(dx, dy) || 1, nx = -dy / l, ny = dx / l;
    const cx = (bx + tx) / 2 + nx * bend * l, cy = (by + ty) / 2 + ny * bend * l;
    const L = [], R = [];
    for (let i = 0; i <= 6; i++) {
      const u = i / 6, v = 1 - u, hw = w / 2 * v * (1 - 0.25 * u);
      const qx = v * v * bx + 2 * v * u * cx + u * u * tx, qy = v * v * by + 2 * v * u * cy + u * u * ty;
      let gx = 2 * v * (cx - bx) + 2 * u * (tx - cx), gy = 2 * v * (cy - by) + 2 * u * (ty - cy);
      const gl = Math.hypot(gx, gy) || 1; gx /= gl; gy /= gl;
      L.push([qx - gy * hw, qy + gx * hw]); R.push([qx + gy * hw, qy - gx * hw]);
    }
    const path = (a, b) => { ctx.beginPath(); ctx.moveTo(a[0][0], a[0][1]); for (let i = 1; i < a.length; i++) ctx.lineTo(a[i][0], a[i][1]); for (let i = b.length - 1; i >= 0; i--) ctx.lineTo(b[i][0], b[i][1]); ctx.closePath(); };
    path(L, R);
    H.fillStroke(ctx, col, P.ink, lw || LW * 0.85);
    path(L.slice(4), R.slice(4));
    ctx.fillStyle = P.hornTip; ctx.fill();
    ctx.beginPath(); ctx.moveTo(R[0][0], R[0][1]);
    for (let i = 1; i < 5; i++) ctx.lineTo(lerp(R[i][0], L[i][0], 0.3), lerp(R[i][1], L[i][1], 0.3));
    ctx.strokeStyle = 'rgba(255,255,245,.4)'; ctx.lineWidth = Math.max(0.8, w * 0.16); ctx.lineCap = 'round'; ctx.stroke();
  }

  /** Digitigrade leg (theropods, hadrosaurs, pachy…): thigh, shin, metatarsus, toes. Returns the foot point. */
  function digiLeg(ctx, X, hp, fx, lift, l1, l2, meta, w, fill, near, sickle) {
    const P = X.P;
    const A0 = [fx - meta * 0.3, -lift - meta * 0.95];
    const k = ik2(hp[0], hp[1], A0[0], A0[1], l1, l2, 1);
    const A = [k[2], k[3]], F = [A[0] + meta * 0.3, A[1] + meta * 0.95];
    H.limb(ctx, [[hp[0] - w * 0.1, hp[1] - w * 0.5], hp, lerpPt(hp, k, 0.5), [k[0], k[1]], A, F],
      [w * 1.05, w * 1.14, w * 0.9, w * 0.46, w * 0.3, w * 0.25]);
    H.fillStroke(ctx, fill, P.ink, LW);
    if (near) {
      // thigh muscle highlight
      ctx.save();
      ctx.strokeStyle = 'rgba(255,248,230,.22)'; ctx.lineWidth = w * 0.22; ctx.lineCap = 'round';
      const m = lerpPt(hp, k, 0.35);
      ctx.beginPath(); ctx.moveTo(hp[0] + w * 0.25, hp[1] - w * 0.1); ctx.quadraticCurveTo(m[0] + w * 0.35, m[1], k[0] + w * 0.05, k[1] - w * 0.2); ctx.stroke();
      ctx.restore();
    }
    toes(ctx, X, F[0], F[1], w, lift > 0.5 ? Math.min(0.75, lift * 0.1) : 0, fill, sickle);
    return F;
  }
  function toes(ctx, X, x, y, w, droop, fill, sickle) {
    const P = X.P, tl = 3 + w * 0.8, h = Math.max(2.4, w * 0.3);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(droop);
    // back toe
    H.smooth(ctx, [[-1, -h * 0.9], [-tl * 0.45, -h * 0.4], [-tl * 0.5, 0], [-1, 0]], true, 0.4);
    H.fillStroke(ctx, P.far, P.ink, LW * 0.7);
    H.smooth(ctx, [[-w * 0.3, -h * 1.1], [tl * 0.5, -h], [tl, -h * 0.35], [tl + 1, 0], [tl * 0.4, 0.2], [-w * 0.35, 0.2]], true, 0.4);
    H.fillStroke(ctx, fill, P.ink, LW * 0.85);
    ctx.strokeStyle = H.rgba(P.ink, 0.6); ctx.lineWidth = 0.9;
    ctx.beginPath(); ctx.moveTo(tl * 0.15, -h * 0.75); ctx.lineTo(tl * 0.75, -h * 0.4); ctx.stroke();
    // claws
    ctx.fillStyle = P.claw;
    ctx.beginPath(); ctx.moveTo(tl - 1, -h * 0.5); ctx.quadraticCurveTo(tl + 3.2, -h * 0.4, tl + 3.4, 0.4); ctx.lineTo(tl - 0.4, 0.2); ctx.closePath(); ctx.fill();
    if (sickle) {
      const s = sickle;
      ctx.strokeStyle = P.claw; ctx.lineWidth = 2.1 * s; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(tl * 0.2, -h * 0.9); ctx.quadraticCurveTo(tl * 0.35, -h * 2.6 * s, tl * 0.75, -h * 2.1 * s); ctx.stroke();
    }
    ctx.restore();
  }
  /** Biped arm: shoulder → elbow → hand with claws. Optional feather fan (raptors). */
  function arm(ctx, X, sh, a1, len, w, fingers, clawL, fill, feather) {
    const P = X.P, a2 = a1 - 1.15;
    const el = [sh[0] + Math.cos(a1) * len * 0.5, sh[1] + Math.sin(a1) * len * 0.5];
    const hd = [el[0] + Math.cos(a2) * len * 0.5, el[1] + Math.sin(a2) * len * 0.5];
    if (feather) {
      const fl = feather.len, n = 6;
      ctx.save();
      for (let i = 0; i < n; i++) {
        const u = i / (n - 1), p = lerpPt(el, hd, 0.15 + u * 0.85), a = a2 + 1.9 - u * 0.5, l = fl * (0.65 + u * 0.4);
        H.ellipse(ctx, p[0] + Math.cos(a) * l * 0.5, p[1] + Math.sin(a) * l * 0.5, l * 0.5, l * 0.13 + 1, a);
        H.fillStroke(ctx, i % 2 ? feather.c1 : feather.c2, P.ink, 1);
      }
      ctx.restore();
    }
    H.limb(ctx, [sh, el, hd], [w * 1.5, w, w * 0.75]);
    H.fillStroke(ctx, fill, P.ink, LW * 0.85);
    H.claws(ctx, hd[0], hd[1], fingers, clawL, a2 + 0.45, P.claw);
  }
  /** Pillar leg for quadrupeds (top → knee/elbow → foot) with a padded foot and nails. bend +1 knee forward. */
  function quadLeg(ctx, X, top, foot, l1, l2, w, bend, fill, near) {
    const P = X.P;
    const ay = foot[1] - w * 0.32;
    const k = ik2(top[0], top[1], foot[0], ay, l1, l2, bend);
    const end = [k[2], k[3]];
    H.limb(ctx, [[top[0], top[1] - w * 0.55], top, [k[0], k[1]], end], [w * 1.2, w * 1.16, w * 0.78, w * 0.72]);
    H.fillStroke(ctx, fill, P.ink, LW);
    if (near) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255,248,230,.2)'; ctx.lineWidth = w * 0.22; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(top[0] + w * 0.3, top[1]); ctx.lineTo(k[0] + w * 0.25, k[1]); ctx.stroke();
      ctx.restore();
    }
    const fy = end[1] + w * 0.32;
    H.ellipse(ctx, end[0] + w * 0.12, fy - w * 0.2, w * 0.56, w * 0.24);
    H.fillStroke(ctx, fill, P.ink, LW * 0.85);
    ctx.fillStyle = near ? P.horn : P.hornFar;
    ctx.strokeStyle = H.rgba(P.ink, 0.7); ctx.lineWidth = 0.8;
    for (let i = 0; i < 3; i++) {
      H.ellipse(ctx, end[0] + w * (0.0 + i * 0.22), fy - w * 0.08, w * 0.12, w * 0.1);
      ctx.fill(); ctx.stroke();
    }
  }

  // ===================================================================
  // BIPED RIG (theropods, ornithomimid, pachy)
  // V: proportions and pose tunables; hooks: { behind(R), flank(R), head(R), sickle, armFeather }
  function biped(ctx, sp, X, V, hooks) {
    const S = X.S, P = X.P, st = X.st;
    const legK = S.leg;
    const thigh = V.thigh * legK, shin = V.shin * legK, meta = V.meta * legK, hipH = V.hipH * legK;
    const ph = X.t * V.walk, lg = X.lg, rc = X.rc;
    let bx = 0, by = 0, tilt = V.tilt || 0, nA = V.neckAng, hA = V.headAng, tailLift = 0, a1 = 1.25;
    switch (X.pose) {
      case 'walk':
        by = -Math.abs(Math.cos(ph)) * 2.2 + 1.2; nA += 0.14; hA += Math.sin(ph * 2) * 0.04; tilt += 0.05; a1 = 1.25 + Math.sin(ph) * 0.2;
        break;
      case 'attack': {
        const f = clamp(lg, 0, 1), w = clamp(-lg / 0.3, 0, 1);
        bx = lg * V.lunge; by = f * 4 * legK; tilt += V.atkTilt * lg;
        nA = lerp(nA, V.atkNeck, f) - 0.3 * w; hA = lerp(hA, V.atkHead, f) - 0.25 * w;
        tailLift = 0.18 * lg; a1 = 1.25 - 0.85 * f;
        break;
      }
      case 'roar':
        bx = -2; tilt -= 0.1; nA = V.neckAng - 0.42; hA = -0.5 + Math.sin(X.t * 32) * 0.025; tailLift = -0.08; a1 = 0.75 + Math.sin(X.t * 14) * 0.25;
        break;
      case 'eat':
        tilt += 0.22; by = 2; nA = V.eatNeck; hA = V.eatHead + Math.sin(X.t * 4.5) * 0.06; a1 = 1.5;
        break;
      case 'hurt':
        bx = -9 * rc; by = -2 * rc; tilt -= 0.16 * rc; nA = V.neckAng - 0.5 * rc; hA -= 0.45 * rc; tailLift = 0.25 * rc; a1 = 1.25 + 0.5 * rc;
        break;
      default:
        by = -X.br * 1.1; nA += X.look * 0.1 + X.br * 0.03; hA += X.look * 0.14; a1 = 1.25 + Math.sin(X.t * 1.3) * 0.06;
    }
    const hip = [V.hipX + bx, -hipH + by];
    const B = frame(hip, tilt);
    const bl = V.bodyLen * (st === 0 ? 0.86 : 1);
    const nl = V.neckLen * S.neck;
    const nb = B(bl + 1, -2);
    const nm = [nb[0] + Math.cos(nA + 0.2) * nl * 0.5, nb[1] + Math.sin(nA + 0.2) * nl * 0.5];
    const ne = [nm[0] + Math.cos(nA - 0.15) * nl * 0.5, nm[1] + Math.sin(nA - 0.15) * nl * 0.5];
    const walking = X.pose === 'walk';
    const tail = tailJoints(X, B(-3, -1), PI + V.tailAng + tailLift - tilt * 0.6, V.tailLen * S.tail, 4, V.tailCurl || 0,
      walking ? 0.1 : 0.05, walking ? V.walk * 0.5 : 1.7);
    const ch = S.chub, tw = V.tailW * (st === 0 ? 1.12 : 1), tf = V.tailFin || 0;
    const J = tail.concat([B(0, 0), B(bl * 0.5, 1.5), B(bl, -1), nm, ne]);
    const up = [1, tw * 0.24 + tf * 0.5, tw * 0.45 + tf, tw * 0.7 + tf * 0.6, V.up * 0.95, V.up * ch, V.up * 0.8, V.neckW * 0.55, V.neckW * 0.48];
    const dn = [1, tw * 0.22, tw * 0.42, tw * 0.64, V.dn * 0.75, V.dn * 1.06 * ch * (1 + 0.03 * X.br), V.dn * 0.9, V.neckW * 0.6, V.neckW * 0.5];
    const T = trunk(J, up, dn);
    const R = { B, bl, hip, nb, nm, ne, nA, hA, T, tilt };

    // legs: feet stay planted while the body moves (lunge/recoil), walking uses a stride cycle
    const hipS = B(2, V.dn * 0.22), hipF = [hipS[0] + 3, hipS[1] - 1.5];
    const gx = V.hipX + 4, stride = V.stride * legK, lift = 8 * legK;
    let fN, fF, lN = 0, lF = 0;
    if (walking) {
      fN = gx + stride * Math.sin(ph); lN = Math.max(0, Math.cos(ph)) * lift;
      fF = gx + stride * Math.sin(ph + PI); lF = Math.max(0, Math.cos(ph + PI)) * lift;
    } else {
      const step = X.pose === 'attack' ? Math.max(0, lg) * V.lunge * 0.8 : X.pose === 'hurt' ? -4 * rc : 0;
      fN = gx + 6 + step; fF = gx - 6 + step * 0.3;
    }
    const G = H.volume(ctx, P.body, T.box[1], T.box[3] + 4);
    const sh = B(bl - 5, V.dn * 0.45);
    const sickle = hooks.sickle ? S.feat : 0;
    digiLeg(ctx, X, hipF, fF, lF, thigh, shin, meta, V.legW, P.far, false, sickle);
    const armLen = V.armLen * (st === 0 ? 0.85 : 1), feather = hooks.armFeather ? { len: 13 * (st === 0 ? 0.6 : 1), c1: P.dark, c2: H.shade(P.acc, -0.2) } : null;
    arm(ctx, X, [sh[0] + 3, sh[1] - 2], a1 + 0.15, armLen, V.armW, V.fingers, V.clawL, P.far, feather && { len: feather.len, c1: H.shade(feather.c1, -0.2), c2: H.shade(feather.c2, -0.25) });
    if (hooks.behind) hooks.behind(R);
    paintTrunk(ctx, X, sp, T, G, {
      pat: [T.joints[2][0], T.box[1], T.joints[6][0] + 4, T.joints[5][1] + V.dn * 0.25],
      rim: [1, 8], hl: [B(bl * 0.4, 0)[0], B(0, -V.up * 0.6)[1], bl * 0.75], tex: 80,
    });
    if (hooks.flank) hooks.flank(R);
    if (st === 3) {
      // Alpha: glowing war-paint chevrons on the flank, claw scars on the hip
      const segs = [];
      for (let i = 0; i < 3; i++) {
        const u = 0.42 + i * 0.17;
        segs.push([B(bl * u - 3, -V.up * 0.55), B(bl * u + 3, -V.up * 0.05), B(bl * u - 2, V.dn * 0.35)]);
      }
      glowLines(ctx, X, segs, 1.4);
      const c = B(-bl * 0.05, -V.up * 0.35);
      clawScars(ctx, X, c[0], c[1], 1.0 + tilt, V.up * 0.9, 1.1);
    }
    digiLeg(ctx, X, hipS, fN, lN, thigh, shin, meta, V.legW, G, true, sickle);
    hooks.head(R);
    arm(ctx, X, sh, a1, armLen, V.armW, V.fingers, V.clawL, G, feather);
    return R;
  }

  // ===================================================================
  // THEROPODS — one template, seven distinct species driven by features
  const TH = {
    allo:   { hipX: -6, hipH: 58, thigh: 28, shin: 26, meta: 14, legW: 19, bodyLen: 46, up: 16, dn: 19, neckLen: 24, neckW: 15, neckAng: -0.8, headAng: 0.12, headLen: 38, headH: 18, tailLen: 72, tailW: 15, tailAng: 0.06, armLen: 17, armW: 5, fingers: 3, clawL: 4, eyeR: 2.9, jawMax: 0.62, teeth: 8, toothL: 3.6, walk: 7, lunge: 14, stride: 13, iris: '#e3a62c', atkTilt: 0.12, atkNeck: 0.05, atkHead: 0.18, eatNeck: 1.0, eatHead: 0.95 },
    rex:    { hipX: -6, hipH: 62, thigh: 31, shin: 28, meta: 15, legW: 25, bodyLen: 48, up: 22, dn: 26, neckLen: 18, neckW: 24, neckAng: -0.7, headAng: 0.1, headLen: 50, headH: 27, tailLen: 70, tailW: 21, tailAng: 0.04, armLen: 10, armW: 4.5, fingers: 2, clawL: 3, eyeR: 3.1, jawMax: 0.72, teeth: 8, toothL: 5.5, walk: 5.5, lunge: 12, stride: 12, iris: '#e8b13a', atkTilt: 0.1, atkNeck: 0.1, atkHead: 0.2, eatNeck: 1.05, eatHead: 0.9 },
    giga:   { hipX: -6, hipH: 62, thigh: 31, shin: 28, meta: 15, legW: 23, bodyLen: 52, up: 20, dn: 24, neckLen: 20, neckW: 21, neckAng: -0.72, headAng: 0.12, headLen: 54, headH: 24, tailLen: 76, tailW: 20, tailAng: 0.04, armLen: 14, armW: 5, fingers: 3, clawL: 3.5, eyeR: 3, jawMax: 0.7, teeth: 9, toothL: 5, walk: 5.5, lunge: 12, stride: 12, iris: '#e0902a', atkTilt: 0.1, atkNeck: 0.1, atkHead: 0.2, eatNeck: 1.05, eatHead: 0.9 },
    carno:  { hipX: -6, hipH: 62, thigh: 29, shin: 30, meta: 15, legW: 18, bodyLen: 44, up: 15, dn: 17, neckLen: 24, neckW: 14, neckAng: -0.85, headAng: 0.12, headLen: 30, headH: 20, tailLen: 70, tailW: 14, tailAng: 0.06, armLen: 6, armW: 4, fingers: 4, clawL: 2, eyeR: 2.8, jawMax: 0.6, teeth: 6, toothL: 3.6, walk: 7.5, lunge: 15, stride: 14, iris: '#f0c040', atkTilt: 0.12, atkNeck: 0.05, atkHead: 0.25, eatNeck: 1.0, eatHead: 0.95 },
    spino:  { hipX: -8, hipH: 48, thigh: 24, shin: 22, meta: 12, legW: 18, bodyLen: 56, up: 16, dn: 19, neckLen: 28, neckW: 13, neckAng: -0.72, headAng: 0.1, headLen: 50, headH: 13.5, tailLen: 76, tailW: 15, tailFin: 6, tailAng: 0.05, armLen: 22, armW: 6.5, fingers: 3, clawL: 5, eyeR: 2.6, jawMax: 0.5, teeth: 11, toothL: 3.2, walk: 6, lunge: 14, stride: 11, iris: '#d9b030', atkTilt: 0.1, atkNeck: 0.1, atkHead: 0.15, eatNeck: 0.95, eatHead: 0.85 },
    raptor: { hipX: -4, hipH: 50, thigh: 23, shin: 24, meta: 13, legW: 12, bodyLen: 38, up: 11, dn: 12.5, neckLen: 24, neckW: 9, neckAng: -1.0, headAng: 0.12, headLen: 29, headH: 11.5, tailLen: 72, tailW: 9.5, tailAng: 0.0, armLen: 22, armW: 4.5, fingers: 3, clawL: 4, eyeR: 2.7, jawMax: 0.6, teeth: 8, toothL: 2.6, walk: 10, lunge: 18, stride: 15, iris: '#e8c23a', atkTilt: 0.14, atkNeck: 0.0, atkHead: 0.2, eatNeck: 1.05, eatHead: 0.9 },
    dilo:   { hipX: -5, hipH: 54, thigh: 25, shin: 25, meta: 14, legW: 14, bodyLen: 42, up: 12.5, dn: 14, neckLen: 30, neckW: 10, neckAng: -1.0, headAng: 0.12, headLen: 32, headH: 12.5, tailLen: 74, tailW: 11, tailAng: 0.04, armLen: 18, armW: 4.5, fingers: 3, clawL: 3.5, eyeR: 2.7, jawMax: 0.65, teeth: 8, toothL: 2.8, walk: 8, lunge: 15, stride: 14, iris: '#e6d040', atkTilt: 0.12, atkNeck: 0.0, atkHead: 0.2, eatNeck: 1.05, eatHead: 0.9 },
  };
  // Skull profiles normalised to (length, height); origin = neck attach, mouth line ≈ y 0.2.
  const SKULL = {
    allo: {
      up: [[-0.08, 0.3], [-0.13, -0.1], [-0.03, -0.46], [0.18, -0.6], [0.42, -0.52], [0.68, -0.38], [0.9, -0.24], [1.01, -0.02], [0.97, 0.17], [0.6, 0.22], [0.22, 0.25]],
      lo: [[0.04, 0.16], [0.9, 0.18], [0.96, 0.25], [0.84, 0.36], [0.5, 0.45], [0.16, 0.5], [-0.04, 0.38]],
      eye: [0.24, -0.27], nos: [0.88, -0.12], tUp: [0.3, 0.23, 0.95, 0.17], tLo: [0.3, 0.2, 0.9, 0.19], rim: [2, 6],
    },
    rex: {
      up: [[-0.1, 0.34], [-0.15, -0.12], [-0.05, -0.55], [0.16, -0.68], [0.42, -0.56], [0.72, -0.4], [0.94, -0.22], [1.02, 0.02], [0.96, 0.19], [0.58, 0.25], [0.2, 0.3]],
      lo: [[0.04, 0.18], [0.9, 0.2], [0.96, 0.28], [0.86, 0.44], [0.5, 0.6], [0.14, 0.64], [-0.06, 0.46]],
      eye: [0.22, -0.32], nos: [0.9, -0.12], tUp: [0.3, 0.26, 0.96, 0.18], tLo: [0.3, 0.22, 0.9, 0.21], rim: [2, 6],
    },
    giga: {
      up: [[-0.08, 0.3], [-0.13, -0.1], [-0.03, -0.5], [0.18, -0.6], [0.46, -0.5], [0.76, -0.36], [0.96, -0.2], [1.03, 0.02], [0.97, 0.17], [0.58, 0.23], [0.2, 0.27]],
      lo: [[0.04, 0.16], [0.92, 0.18], [0.98, 0.25], [0.86, 0.38], [0.5, 0.48], [0.14, 0.52], [-0.05, 0.4]],
      eye: [0.2, -0.3], nos: [0.9, -0.1], tUp: [0.3, 0.23, 0.97, 0.17], tLo: [0.3, 0.19, 0.92, 0.19], rim: [2, 6],
    },
    carno: {
      up: [[-0.1, 0.32], [-0.15, -0.12], [-0.05, -0.52], [0.18, -0.62], [0.48, -0.56], [0.76, -0.46], [0.96, -0.28], [1.03, -0.02], [0.98, 0.19], [0.6, 0.25], [0.2, 0.28]],
      lo: [[0.04, 0.18], [0.92, 0.2], [0.98, 0.28], [0.86, 0.42], [0.5, 0.54], [0.14, 0.58], [-0.06, 0.44]],
      eye: [0.3, -0.25], nos: [0.9, -0.16], tUp: [0.34, 0.25, 0.97, 0.19], tLo: [0.32, 0.21, 0.92, 0.21], rim: [2, 6],
    },
    spino: {
      up: [[-0.06, 0.34], [-0.1, -0.3], [0.0, -0.66], [0.13, -0.78], [0.27, -0.66], [0.42, -0.44], [0.56, -0.52], [0.66, -0.36], [0.84, -0.3], [0.97, -0.4], [1.04, -0.14], [1.02, 0.14], [0.92, 0.22], [0.6, 0.22], [0.2, 0.28]],
      lo: [[0.04, 0.18], [0.96, 0.18], [1.0, 0.27], [0.92, 0.38], [0.5, 0.42], [0.14, 0.54], [-0.05, 0.42]],
      eye: [0.15, -0.4], nos: [0.5, -0.32], tUp: [0.28, 0.24, 1.0, 0.18], tLo: [0.28, 0.2, 0.96, 0.18], rim: [2, 10],
    },
    raptor: {
      up: [[-0.08, 0.3], [-0.13, -0.12], [-0.03, -0.5], [0.17, -0.62], [0.36, -0.5], [0.62, -0.32], [0.88, -0.22], [1.02, -0.04], [0.98, 0.16], [0.6, 0.22], [0.2, 0.25]],
      lo: [[0.04, 0.16], [0.92, 0.17], [0.98, 0.24], [0.86, 0.33], [0.5, 0.42], [0.16, 0.48], [-0.04, 0.38]],
      eye: [0.23, -0.22], nos: [0.9, -0.08], tUp: [0.3, 0.22, 0.97, 0.16], tLo: [0.3, 0.18, 0.92, 0.17], rim: [2, 6],
    },
    dilo: {
      up: [[-0.08, 0.3], [-0.13, -0.12], [-0.03, -0.5], [0.18, -0.6], [0.44, -0.46], [0.7, -0.32], [0.9, -0.24], [1.02, -0.04], [0.98, 0.15], [0.84, 0.19], [0.75, 0.11], [0.64, 0.21], [0.2, 0.25]],
      lo: [[0.04, 0.16], [0.9, 0.17], [0.97, 0.24], [0.86, 0.33], [0.5, 0.42], [0.16, 0.48], [-0.04, 0.38]],
      eye: [0.25, -0.23], nos: [0.92, -0.1], tUp: [0.3, 0.22, 0.97, 0.15], tLo: [0.3, 0.18, 0.9, 0.17], rim: [2, 6],
    },
  };
  // Babies: shorter snout, rounder cranium (cached per kind and stage).
  const skullCache = new Map();
  function skull(vk, st) {
    const key = vk + st;
    let K = skullCache.get(key);
    if (K) return K;
    const B = SKULL[vk], sn = [0.68, 0.85, 1, 1][st], cr = [1.28, 1.1, 1, 1][st];
    const f = p => [p[0] > 0.3 ? 0.3 + (p[0] - 0.3) * sn : p[0], p[1] < -0.25 ? -0.25 + (p[1] + 0.25) * cr : p[1]];
    const a = f([B.tUp[0], B.tUp[1]]), b = f([B.tUp[2], B.tUp[3]]), c = f([B.tLo[0], B.tLo[1]]), d = f([B.tLo[2], B.tLo[3]]);
    K = { up: B.up.map(f), lo: B.lo.map(f), eye: f(B.eye), nos: f(B.nos), tUp: [a[0], a[1], b[0], b[1]], tLo: [c[0], c[1], d[0], d[1]], hinge: [0.04, 0.17], rim: B.rim };
    skullCache.set(key, K);
    return K;
  }
  const kindCache = new Map();
  function theroKind(sp) {
    let k = kindCache.get(sp.id);
    if (k) return k;
    k = has(sp, 'small') || has(sp, 'feathers') ? 'raptor'
      : has(sp, 'double_crest') || has(sp, 'frill_neck') ? 'dilo'
      : has(sp, 'bull_horns') ? 'carno'
      : has(sp, 'sail') || has(sp, 'croc_snout') ? 'spino'
      : has(sp, 'brow_ridge') ? 'giga'
      : has(sp, 'big_head') ? 'rex' : 'allo';
    kindCache.set(sp.id, k);
    return k;
  }

  function theroHead(ctx, X, sp, vk, V, ne, hA) {
    const P = X.P, S = X.S, st = X.st, fk = S.feat, K = skull(vk, st);
    const L = V.headLen * S.head * (st === 0 ? 0.92 : 1), Hh = V.headH * S.head * (st === 0 ? 1.12 : 1);
    const jawA = X.jw * V.jawMax;
    const pt = p => [p[0] * L, p[1] * Hh];
    const up = K.up.map(pt), lo = K.lo.map(pt), hg = pt(K.hinge);
    ctx.save();
    ctx.translate(ne[0], ne[1]);
    ctx.rotate(hA - jawA * 0.3);

    // far-side ornaments (behind the skull)
    if (vk === 'carno' && fk > 0.3) horn(ctx, X, 0.36 * L, -0.55 * Hh, 0.3 * L - 4 * fk, -0.55 * Hh - 11 * fk, 6 * Math.sqrt(fk), -0.25, P.hornFar);
    if (vk === 'dilo') diloCrest(ctx, X, L, Hh, fk, true);
    if (vk === 'raptor') {
      // feather crest at the back of the head
      for (let i = 0; i < 4; i++) {
        const a = -2.2 - i * 0.28, l = (9 + i * 1.5) * (st === 0 ? 0.8 : 1);
        H.ellipse(ctx, -0.02 * L + Math.cos(a) * l * 0.5, -0.4 * Hh + Math.sin(a) * l * 0.5, l * 0.5, 1.6, a);
        H.fillStroke(ctx, i % 2 ? P.dark : H.shade(P.acc, -0.15), P.ink, 1);
      }
    }
    // mouth interior
    if (jawA > 0.02) {
      const a = pt([K.tUp[2], K.tUp[3]]), b = rotAround(pt([K.tLo[2], K.tLo[3]]), hg, jawA);
      ctx.beginPath(); ctx.moveTo(hg[0] - 1, hg[1]); ctx.lineTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.closePath();
      ctx.fillStyle = P.mouth; ctx.fill();
    }
    // lower jaw
    ctx.save();
    ctx.translate(hg[0], hg[1]); ctx.rotate(jawA); ctx.translate(-hg[0], -hg[1]);
    if (jawA > 0.06) { H.ellipse(ctx, 0.45 * L, 0.21 * Hh, 0.3 * L, 0.05 * Hh + 1.2); ctx.fillStyle = P.tongue; ctx.fill(); }
    H.smooth(ctx, lo, true, 0.45);
    H.fillStroke(ctx, P.jaw, P.ink, LW);
    if (S.teeth > 0) H.teeth(ctx, K.tLo[0] * L, K.tLo[1] * Hh, K.tLo[2] * L, K.tLo[3] * Hh, V.teeth - 1, V.toothL * S.teeth * 0.85, true, P.tooth);
    ctx.restore();
    // upper skull
    const path = () => H.smooth(ctx, up, true, 0.45);
    paintShape(ctx, X, path, H.volume(ctx, P.body, -0.68 * Hh, 0.3 * Hh), () => {
      H.ellipse(ctx, 0.52 * L, 0.3 * Hh, 0.64 * L, 0.15 * Hh);
      ctx.fillStyle = P.bellyA; ctx.fill();
      if (sp.pattern === 'spots') H.spots(ctx, sp.seed + 9, -0.1 * L, -0.65 * Hh, 0.7 * L, 0, 5, 1, 2.2 * (st === 3 ? 1.3 : 1), P.pat);
      texture(ctx, P, sp.seed + 3, -0.15 * L, -0.75 * Hh, 1.05 * L, 0.3 * Hh, 26, 0.5, 1.3);
      if (vk === 'rex' || vk === 'giga') {
        // heavy jaw muscle shadow behind the eye
        H.ellipse(ctx, 0.08 * L, 0.05 * Hh, 0.16 * L, 0.3 * Hh);
        ctx.fillStyle = 'rgba(30,15,8,.14)'; ctx.fill();
      }
      openPath(ctx, up.slice(K.rim[0], K.rim[1] + 1).map(p => [p[0], p[1] + 1.6]));
      ctx.lineWidth = 2.4; ctx.strokeStyle = P.rim; ctx.stroke();
    });
    if (S.teeth > 0) H.teeth(ctx, K.tUp[0] * L, K.tUp[1] * Hh, K.tUp[2] * L, K.tUp[3] * Hh, V.teeth, V.toothL * S.teeth, false, P.tooth);
    // lip line
    ctx.strokeStyle = H.rgba(P.ink, 0.5); ctx.lineWidth = 1; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(K.tUp[0] * L - 4, K.tUp[1] * Hh + 0.5); ctx.lineTo(K.tUp[2] * L, K.tUp[3] * Hh); ctx.stroke();
    // nostril
    const ns = pt(K.nos);
    H.ellipse(ctx, ns[0], ns[1], 1.8 * Math.sqrt(S.head), 1.1, -0.3);
    ctx.fillStyle = 'rgba(25,12,6,.75)'; ctx.fill();
    // ornaments in front of the skull
    if (vk === 'allo') {
      horn(ctx, X, 0.2 * L, -0.56 * Hh, 0.17 * L, -0.56 * Hh - 9 * fk, 6 * Math.sqrt(fk), 0.1, P.horn);
      bumps(ctx, X, pt([0.45, -0.5]), pt([0.85, -0.27]), 4, 1.6 * Math.sqrt(fk) + 0.4);
    } else if (vk === 'rex') {
      bumps(ctx, X, pt([0.26, -0.64]), pt([0.36, -0.6]), 2, 2.2 * Math.sqrt(fk) + 0.5);
      bumps(ctx, X, pt([0.55, -0.5]), pt([0.88, -0.27]), 4, 1.3 * Math.sqrt(fk) + 0.3);
    } else if (vk === 'giga') {
      bumps(ctx, X, pt([0.06, -0.55]), pt([0.36, -0.58]), 5, 2.2 * Math.sqrt(fk) + 0.4);
      bumps(ctx, X, pt([0.48, -0.48]), pt([0.9, -0.24]), 5, 1.3 * Math.sqrt(fk) + 0.3);
    } else if (vk === 'carno' && fk > 0.3) {
      horn(ctx, X, 0.32 * L, -0.56 * Hh, 0.24 * L - 6 * fk, -0.56 * Hh - 13 * fk, 7.5 * Math.sqrt(fk), -0.3, P.horn);
    } else if (vk === 'dilo') {
      diloCrest(ctx, X, L, Hh, fk, false);
    }
    const ep = pt(K.eye);
    eye(ctx, X, ep[0], ep[1], V.eyeR * S.eye, { iris: st === 3 ? P.glow : V.iris, pupil: st === 0 ? 'round' : 'slit', brow: st > 0 });
    if (st === 3) scarLines(ctx, X, [[pt([0.5, -0.5]), pt([0.62, -0.12])], [pt([0.58, -0.48]), pt([0.68, -0.18])]], 1);
    ctx.restore();
  }
  /** Row of small bony bumps from a to b (skull ridges). */
  function bumps(ctx, X, a, b, n, r) {
    const P = X.P;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const p = lerpPt(a, b, n === 1 ? 0.5 : i / (n - 1));
      ctx.moveTo(p[0] + r, p[1]); ctx.arc(p[0], p[1], r, 0, TAU);
    }
    ctx.fillStyle = P.light; ctx.fill();
    ctx.strokeStyle = P.ink; ctx.lineWidth = 1; ctx.stroke();
  }
  function diloCrest(ctx, X, L, Hh, fk, far) {
    const P = X.P, h = (0.35 + 0.65 * fk) * Hh * 0.9, o = far ? [0.05 * L, -0.12 * Hh] : [0, 0];
    const pts = [[0.62 * L, -0.4 * Hh], [0.5 * L, -0.55 * Hh - h * 0.6], [0.32 * L, -0.62 * Hh - h], [0.12 * L, -0.6 * Hh - h * 0.75], [0.0, -0.5 * Hh], [0.3 * L, -0.52 * Hh]].map(p => [p[0] + o[0], p[1] + o[1]]);
    H.smooth(ctx, pts, true, 0.5);
    H.fillStroke(ctx, far ? P.plateFar : H.mix(P.acc, '#f4e8c0', 0.25), P.ink, LW * 0.8);
    if (!far) {
      ctx.strokeStyle = H.rgba(P.ink, 0.45); ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 1; i < 4; i++) { const u = i / 4; ctx.moveTo(lerp(0.55, 0.08, u) * L, -0.5 * Hh); ctx.lineTo(lerp(0.52, 0.1, u) * L, -0.58 * Hh - h * (0.55 + 0.4 * Math.sin(u * PI))); }
      ctx.stroke();
      if (X.st === 3) glowLines(ctx, X, [[[0.5 * L, -0.55 * Hh - h * 0.55], [0.32 * L, -0.62 * Hh - h * 0.88], [0.14 * L, -0.6 * Hh - h * 0.66]]], 1.1);
    }
  }
  /** Spinosaurus sail along the back between trunk joints i0..i1. */
  function spinoSail(ctx, X, sp, T, i0, i1, h) {
    const P = X.P, n = 11, base = [], tips = [];
    for (let j = 0; j < n; j++) {
      const u = j / (n - 1), q = along(T, lerp(i0, i1, u), -1);
      const hh = h * Math.pow(Math.sin(PI * clamp(u * 1.05 - 0.02, 0, 1)), 0.75) * (j % 2 ? 0.93 : 1) + 2;
      base.push([q[0] + q[2] * 5, q[1] + q[3] * 5]);
      tips.push([q[0] - q[2] * hh - (u - 0.5) * 6, q[1] - q[3] * hh]);
    }
    const pts = base.concat(tips.slice().reverse());
    const path = () => H.smooth(ctx, pts, true, 0.35);
    const yT = Math.min(...tips.map(p => p[1])), yB = Math.max(...base.map(p => p[1]));
    paintShape(ctx, X, path, H.linear(ctx, 0, yB, 0, yT, [[0, P.body], [0.55, H.mix(P.body, P.acc, 0.55)], [1, H.shade(P.acc, 0.12)]]), () => {
      // spines
      ctx.beginPath();
      for (let j = 1; j < n - 1; j++) { ctx.moveTo(base[j][0], base[j][1]); ctx.lineTo(tips[j][0], tips[j][1] + 1); }
      ctx.strokeStyle = H.rgba(P.ink, 0.35); ctx.lineWidth = 1.6; ctx.stroke();
      if (sp.pattern === 'stripes') {
        ctx.beginPath();
        for (let b = 0; b < 2; b++) {
          const f = 0.45 + b * 0.25;
          for (let j = 0; j < n; j++) { const p = lerpPt(base[j], tips[j], f); if (j) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); }
        }
        ctx.strokeStyle = P.pat; ctx.lineWidth = 3.2; ctx.stroke();
      }
      openPath(ctx, tips.map(p => [p[0], p[1] + 1.8]));
      ctx.lineWidth = 2.2; ctx.strokeStyle = P.rim; ctx.stroke();
    });
    if (X.st === 3) glowLines(ctx, X, [tips.slice(2, n - 2).map((p, j) => lerpPt(base[j + 2], p, 0.8))], 1.4);
  }
  /** Dilophosaurus neck frill, folded (small ruff) or open (attack/roar). */
  function diloFrill(ctx, X, R) {
    const P = X.P, open = X.pose === 'roar' ? 1 : X.pose === 'attack' ? smoothstep(X.k * 3) * smoothstep((1 - X.k) * 3) : 0;
    const c = lerpPt(R.nm, R.ne, 0.7), r = (5 + 22 * open) * (0.5 + 0.5 * X.S.feat), a0 = R.nA + 0.85, a1 = R.nA + TAU - 0.85, n = 9;
    const pts = [[c[0], c[1]]];
    for (let i = 0; i <= n * 2; i++) {
      const a = lerp(a0, a1, i / (n * 2)), rr = i % 2 ? r * 0.84 : r;
      pts.push([c[0] + Math.cos(a) * rr, c[1] + Math.sin(a) * rr]);
    }
    ctx.save();
    H.poly(ctx, pts, true);
    ctx.fillStyle = H.radial(ctx, c[0], c[1], 0, r, [[0, H.shade(P.acc, -0.35)], [0.55, P.acc], [0.85, H.mix(P.acc, '#c0392b', 0.55)], [1, '#7a1f16']]);
    ctx.fill();
    ctx.strokeStyle = H.rgba(P.ink, 0.55); ctx.lineWidth = 1.1;
    ctx.beginPath();
    for (let i = 1; i < pts.length; i += 2) { ctx.moveTo(c[0], c[1]); ctx.lineTo(pts[i][0], pts[i][1]); }
    ctx.stroke();
    H.poly(ctx, pts, true);
    ctx.lineWidth = LW * 0.8; ctx.strokeStyle = P.ink; ctx.lineJoin = 'round'; ctx.stroke();
    if (open > 0.3) {
      // eye-spots on the open frill
      ctx.fillStyle = 'rgba(30,20,10,.55)';
      for (let i = 0; i < 3; i++) { const a = lerp(a0, a1, 0.25 + i * 0.25); H.ellipse(ctx, c[0] + Math.cos(a) * r * 0.7, c[1] + Math.sin(a) * r * 0.7, r * 0.09, r * 0.09); ctx.fill(); }
    }
    ctx.restore();
  }

  function theropod(ctx, sp, o) {
    const X = poseOf(o, sp), vk = theroKind(sp), V = TH[vk], P = X.P, st = X.st, fk = X.S.feat;
    ctx.save();
    biped(ctx, sp, X, V, {
      sickle: vk === 'raptor',
      armFeather: vk === 'raptor',
      behind(R) {
        if (vk === 'spino') spinoSail(ctx, X, sp, R.T, 3.2, 6.6, (12 + 42 * fk) * (st === 0 ? 0.8 : 1));
        if (vk === 'dilo') diloFrill(ctx, X, R);
        if (vk === 'raptor') {
          // tail feather fan
          const T = R.T;
          for (let i = 0; i < 7; i++) {
            const u = 0.2 + i * 0.3, q = along(T, u, i % 2 ? -0.6 : 0.6), d = lerpPt(T.joints[0], T.joints[1], 0.5);
            const a = Math.atan2(T.joints[0][1] - T.joints[2][1], T.joints[0][0] - T.joints[2][0]) + (i % 2 ? -0.5 : 0.5) * (1 - i * 0.08);
            const l = 12 - i * 0.6;
            H.ellipse(ctx, q[0] + Math.cos(a) * l * 0.45, q[1] + Math.sin(a) * l * 0.45, l * 0.55, 2, a);
            H.fillStroke(ctx, i % 3 ? P.dark : H.shade(P.acc, -0.1), P.ink, 1);
            if (d) continue;
          }
        }
      },
      flank(R) {
        const T = R.T;
        if (vk === 'carno') {
          // rows of osteoderm knobs
          ctx.beginPath();
          for (let row = 0; row < 2; row++) for (let i = 0; i < 7; i++) {
            const q = along(T, 3.4 + i * 0.5, row ? -0.15 : -0.6), r = (row ? 1.5 : 2) * (0.6 + 0.4 * fk);
            ctx.moveTo(q[0] + r, q[1]); ctx.arc(q[0], q[1], r, 0, TAU);
          }
          ctx.fillStyle = P.light; ctx.fill();
          ctx.strokeStyle = P.ink; ctx.lineWidth = 0.9; ctx.stroke();
        }
        if (vk === 'raptor' || st === 0 && (vk === 'rex' || vk === 'giga')) {
          // feather fluff along neck and back (baby big theropods are fluffy too)
          ctx.beginPath();
          const n = vk === 'raptor' ? 16 : 10, s = vk === 'raptor' ? 1 : 0.8;
          for (let i = 0; i < n; i++) {
            const q = along(T, lerp(3, 8.6, i / (n - 1)), -0.85), l = (4 + (i % 3)) * s * (st === 0 ? 1.2 : 1);
            const bx = -q[2], by = -q[3]; // up normal
            ctx.moveTo(q[0], q[1]);
            ctx.quadraticCurveTo(q[0] + bx * l * 0.6 - by * l * 0.2, q[1] + by * l * 0.6 + bx * l * 0.2, q[0] + bx * l * 0.7 - by * l * 0.9, q[1] + by * l * 0.7 + bx * l * 0.9);
          }
          ctx.strokeStyle = H.shade(P.dark, -0.1); ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.stroke();
          ctx.strokeStyle = H.rgba(P.acc, 0.6); ctx.lineWidth = 0.9; ctx.stroke();
        }
        if (vk === 'rex' || vk === 'giga' || vk === 'allo') {
          // small dorsal scutes
          ctx.beginPath();
          for (let i = 0; i < 12; i++) { const q = along(T, 1.5 + i * 0.55, -0.9), r = 1.4; ctx.moveTo(q[0] + r, q[1]); ctx.arc(q[0], q[1], r, 0, TAU); }
          ctx.fillStyle = H.rgba(P.dark, 0.6); ctx.fill();
        }
      },
      head(R) { theroHead(ctx, X, sp, vk, V, R.ne, R.hA); },
    });
    ctx.restore();
  }
  ART.registerTemplate('theropod', theropod, { bounds: [-100, -128, 106, 4], shadowW: 120 });

  // ===================================================================
  // ORNITHOMIMID (gallimimus): ostrich-like runner, long S-neck, beak
  const ORNI = { hipX: -4, hipH: 60, thigh: 26, shin: 28, meta: 17, legW: 12.5, bodyLen: 34, up: 12, dn: 14, neckLen: 40, neckW: 8.5, neckAng: -1.15, headAng: 0.15, tailLen: 64, tailW: 10, tailAng: 0.02, armLen: 18, armW: 4, fingers: 3, clawL: 4.5, walk: 11, lunge: 14, stride: 18, atkTilt: 0.15, atkNeck: -0.1, atkHead: 0.45, eatNeck: 1.15, eatHead: 0.95 };
  function ornithomimid(ctx, sp, o) {
    const X = poseOf(o, sp), P = X.P, S = X.S, st = X.st;
    ctx.save();
    biped(ctx, sp, X, ORNI, {
      flank(R) {
        if (st === 3) glowLines(ctx, X, [[along(R.T, 6.4, -0.3), along(R.T, 7.2, -0.4), along(R.T, 8, -0.5)].map(q => [q[0], q[1]])], 1.3);
        // soft feather fringe on the forearm area / back
        ctx.beginPath();
        for (let i = 0; i < 8; i++) {
          const q = along(R.T, 3.6 + i * 0.3, -0.9), l = 4 + (i % 2) * 2;
          ctx.moveTo(q[0], q[1]); ctx.lineTo(q[0] - l * 0.8, q[1] - l * 0.6);
        }
        ctx.strokeStyle = H.rgba(P.dark, 0.7); ctx.lineWidth = 1.6; ctx.lineCap = 'round'; ctx.stroke();
      },
      head(R) {
        const hs = S.head * 1.0, jawA = X.jw * 0.45;
        ctx.save();
        ctx.translate(R.ne[0], R.ne[1]);
        ctx.rotate(R.hA - jawA * 0.3);
        ctx.scale(hs, hs);
        const lw = LW / hs;
        const sk = [[-3, 4], [-4, -3], [3, -8.5], [10, -8.5], [16, -5], [24, -1.2], [27, 1], [24, 3], [12, 4], [2, 5]];
        const lo = [[1, 3], [24, 2.2], [22, 5], [10, 7], [1, 7]];
        ctx.save();
        ctx.translate(1, 3); ctx.rotate(jawA); ctx.translate(-1, -3);
        H.smooth(ctx, lo, true, 0.4); H.fillStroke(ctx, P.beak, P.ink, lw);
        H.poly(ctx, [[1, 3.5], [10, 4], [10, 7], [1, 7]], true); ctx.fillStyle = P.jaw; ctx.fill();
        ctx.restore();
        paintShape(ctx, X, () => H.smooth(ctx, sk, true, 0.45), H.volume(ctx, P.body, -9, 5), () => {
          H.poly(ctx, [[15, -8], [30, -4], [30, 6], [14, 6]], true); ctx.fillStyle = P.beak; ctx.fill();
          ctx.fillStyle = P.bellyA; H.ellipse(ctx, 6, 4, 9, 2.5); ctx.fill();
          openPath(ctx, [[-2, -2], [4, -7], [11, -7.2], [17, -3.5]]); ctx.strokeStyle = P.rim; ctx.lineWidth = 1.6; ctx.stroke();
        }, lw);
        eye(ctx, X, 6.5, -3, 2.6 * S.eye, { iris: st === 3 ? P.glow : '#c8862a', pupil: 'round' });
        ctx.restore();
      },
    });
    ctx.restore();
  }
  ART.registerTemplate('ornithomimid', ornithomimid, { bounds: [-80, -128, 72, 4], shadowW: 80 });

  // ===================================================================
  // PACHY (pachycephalosaurus): bipedal, thick bony dome ringed with knobs; attack = head-butt
  const PACHY = { hipX: -6, hipH: 46, thigh: 22, shin: 22, meta: 12, legW: 15, bodyLen: 40, up: 15, dn: 17, neckLen: 18, neckW: 13, neckAng: -0.8, headAng: 0.18, tailLen: 62, tailW: 13, tailAng: 0.02, armLen: 12, armW: 4.5, fingers: 4, clawL: 2.5, walk: 7, lunge: 20, stride: 13, atkTilt: 0.18, atkNeck: 0.32, atkHead: 1.25, eatNeck: 0.95, eatHead: 0.9 };
  function pachy(ctx, sp, o) {
    const X = poseOf(o, sp), P = X.P, S = X.S, st = X.st, fk = S.feat;
    ctx.save();
    biped(ctx, sp, X, PACHY, {
      head(R) {
        const hs = S.head, jawA = X.jw * 0.3, dk = [0.42, 0.7, 1, 1.18][st];
        ctx.save();
        ctx.translate(R.ne[0], R.ne[1]);
        ctx.rotate(R.hA - jawA * 0.3);
        ctx.scale(hs, hs);
        const lw = LW / hs;
        const d = y => (y < -8 ? -8 + (y + 8) * dk : y); // dome height scales with stage
        const sk = [[-5, 6], [-8, -2], [-7, -10], [-2, -18], [8, -23], [18, -22], [25, -15], [29, -8], [34, -3], [37, 2], [35, 6], [24, 8], [8, 9]].map(p => [p[0], d(p[1])]);
        const dome = [[-7, -8], [-3, -18], [8, -24], [18, -23], [25, -16], [27, -9], [17, -11], [6, -12], [-2, -9]].map(p => [p[0], d(p[1])]);
        const lo = [[2, 6], [32, 5], [34, 8], [22, 12], [6, 12]];
        ctx.save();
        ctx.translate(2, 6); ctx.rotate(jawA); ctx.translate(-2, -6);
        H.smooth(ctx, lo, true, 0.4); H.fillStroke(ctx, P.jaw, P.ink, lw);
        ctx.restore();
        paintShape(ctx, X, () => H.smooth(ctx, sk, true, 0.45), H.volume(ctx, P.body, -24 * dk, 8), () => {
          H.ellipse(ctx, 18, 9, 18, 3.5); ctx.fillStyle = P.bellyA; ctx.fill();
          texture(ctx, P, sp.seed + 3, -8, -12, 38, 9, 18, 0.5, 1.2);
        }, lw);
        // bony dome
        const bone = H.mix('#efe0bf', P.body, 0.25);
        paintShape(ctx, X, () => H.smooth(ctx, dome, true, 0.5), H.radial(ctx, 6, d(-20), 1, 20 * dk + 6, [[0, H.shade(bone, 0.35)], [0.6, bone], [1, H.shade(bone, -0.3)]]), () => {
          if (st === 3) { ctx.strokeStyle = 'rgba(90,60,40,.35)'; ctx.lineWidth = 0.9; ctx.beginPath(); ctx.moveTo(4, d(-22)); ctx.lineTo(9, d(-16)); ctx.lineTo(7, d(-12)); ctx.stroke(); }
        }, lw);
        // ring of knobs around the dome and on the snout (babies: spikier, flatter head)
        const kn = (x, y, a, l) => horn(ctx, X, x, y, x + Math.cos(a) * l, y + Math.sin(a) * l, l * 0.8, 0, P.horn, lw * 0.7);
        const kl = st === 0 ? 3.2 : 2.6 + 1.6 * fk;
        kn(-7, d(-8), -2.6, kl); kn(-8, -3, -2.9, kl * 0.9); kn(-7, 2, 2.9, kl * 0.7);
        kn(-4, d(-15), -2.2, kl * 0.9); kn(26, d(-12), -0.9, kl * 0.75); kn(31, -6, -1.1, kl * 0.6); kn(34, -3, -0.7, kl * 0.5);
        if (st === 3) glowLines(ctx, X, [[[-4, d(-12)], [4, d(-16.5)], [14, d(-17)], [22, d(-13)]]], 1.2 / hs);
        H.poly(ctx, [[33, -2], [38, 2], [36, 6], [32, 5]], true); H.fillStroke(ctx, P.beak, P.ink, lw * 0.8);
        eye(ctx, X, 15, -6, 2.5 * S.eye, { iris: st === 3 ? P.glow : '#b8762a', pupil: 'round', brow: st > 1, browCol: H.shade(bone, -0.35) });
        ctx.restore();
      },
    });
    ctx.restore();
  }
  ART.registerTemplate('pachy', pachy, { bounds: [-84, -100, 86, 4], shadowW: 84 });

  // ===================================================================
  // CERATOPSIAN (triceratops, styracosaurus)
  const FRILL_T = [[12, 2], [13, -16], [5, -33], [-9, -43], [-25, -42], [-37, -31], [-40, -15], [-33, 0], [-19, 8], [-3, 9]];
  const FRILL_S = [[12, 2], [12, -14], [4, -27], [-8, -34], [-21, -33], [-30, -24], [-32, -11], [-26, 0], [-15, 7], [-3, 8]];
  function polyAt(pts, u) {
    const i = clamp(Math.floor(u), 0, pts.length - 2);
    return lerpPt(pts[i], pts[i + 1], u - i);
  }
  function ceratoHead(ctx, X, sp, styr, ne, hA) {
    const P = X.P, S = X.S, st = X.st, fk = S.feat;
    const hs = S.head * (st === 0 ? 0.88 : 1), fr = [0.48, 0.76, 1, 1.12][st];
    const jawA = X.jw * 0.32, lw = LW / hs;
    ctx.save();
    ctx.translate(ne[0], ne[1]);
    ctx.rotate(hA);
    ctx.scale(hs, hs);
    // frill
    const anc = [8, 0], FR = (styr ? FRILL_S : FRILL_T).map(p => [anc[0] + (p[0] - anc[0]) * fr, anc[1] + (p[1] - anc[1]) * fr]);
    const fc = [anc[0] - 18 * fr, -16 * fr];
    if (styr && fk > 0.15) {
      const L = [14, 24, 30, 30, 24, 15];
      for (let i = 0; i < 6; i++) {
        const p = polyAt(FR, 2 + i * 0.95), dx = p[0] - fc[0], dy = p[1] - fc[1], l = Math.hypot(dx, dy) || 1;
        const len = L[i] * fk * (0.75 + 0.25 * fr);
        horn(ctx, X, p[0] - dx / l * 3, p[1] - dy / l * 3, p[0] + dx / l * len, p[1] + dy / l * len, 6.5 * Math.sqrt(fk), i < 3 ? 0.06 : -0.06, i % 2 ? P.hornFar : P.horn, lw * 0.9);
      }
    }
    paintShape(ctx, X, () => H.smooth(ctx, FR, true, 0.5), H.radial(ctx, fc[0], fc[1], 0, 42 * fr, [[0, P.dark], [0.5, P.body], [1, H.mix(P.body, P.acc, 0.6)]]), () => {
      H.smooth(ctx, FR, true, 0.5); ctx.lineWidth = 9 * fr; ctx.strokeStyle = P.patAcc; ctx.stroke();
      if (sp.pattern === 'stripes') {
        ctx.beginPath();
        for (let i = 0; i < 7; i++) { const p = polyAt(FR, 1.4 + i * 0.95); ctx.moveTo(lerp(fc[0], p[0], 0.35), lerp(fc[1], p[1], 0.35)); ctx.lineTo(lerp(fc[0], p[0], 0.85), lerp(fc[1], p[1], 0.85)); }
        ctx.strokeStyle = P.pat; ctx.lineWidth = 3.4 * fr + 1; ctx.lineCap = 'round'; ctx.stroke();
      }
      texture(ctx, P, sp.seed + 11, fc[0] - 30 * fr, fc[1] - 30 * fr, fc[0] + 30 * fr, fc[1] + 26 * fr, 26, 0.6, 1.5);
      // ridge where frill meets the skull
      ctx.strokeStyle = 'rgba(30,15,8,.22)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(8, 6); ctx.quadraticCurveTo(-2 * fr, -10 * fr, 4, -26 * fr); ctx.stroke();
      openPath(ctx, FR.slice(1, 6).map(p => [p[0] + 0.8, p[1] + 1.6])); ctx.strokeStyle = P.rim; ctx.lineWidth = 2.2; ctx.stroke();
    }, lw);
    if (!styr && st > 0) {
      // epoccipitals along the rim
      ctx.beginPath();
      for (let i = 0; i < 11; i++) {
        const p = polyAt(FR, 1.2 + i * 0.6), dx = p[0] - fc[0], dy = p[1] - fc[1], l = Math.hypot(dx, dy) || 1, ux = dx / l, uy = dy / l, s = 2.4 * fr + 0.6;
        ctx.moveTo(p[0] - uy * s, p[1] + ux * s); ctx.lineTo(p[0] + ux * s * 1.7, p[1] + uy * s * 1.7); ctx.lineTo(p[0] + uy * s, p[1] - ux * s);
      }
      ctx.fillStyle = P.horn; ctx.fill();
      ctx.strokeStyle = P.ink; ctx.lineWidth = lw * 0.5; ctx.stroke();
    }
    if (st === 3) {
      const segs = [FR.slice(2, 8).map(p => lerpPt(fc, p, 0.8))];
      glowLines(ctx, X, segs, 1.5);
      scarLines(ctx, X, [[[-10 * fr, -30 * fr], [-2 * fr, -18 * fr], [-4 * fr, -10 * fr]]], 1);
    }
    // far brow horn
    const hl = (styr ? 6 : 36) * fk, ha = st === 1 && !styr ? -1.35 : -0.85, hb = st === 1 && !styr ? 0.22 : -0.1;
    if (hl > 2) horn(ctx, X, 21, -11, 21 + Math.cos(ha) * hl + 2, -12 + Math.sin(ha) * hl, 7 * Math.sqrt(fk) + 1, hb, P.hornFar, lw);
    // lower jaw
    ctx.save();
    ctx.translate(4, 12); ctx.rotate(jawA); ctx.translate(-4, -12);
    if (jawA > 0.04) { H.ellipse(ctx, 30, 14, 16, 3); ctx.fillStyle = P.mouth; ctx.fill(); }
    H.smooth(ctx, [[4, 12], [44, 13], [52, 16], [46, 22], [26, 24], [8, 21]], true, 0.45); H.fillStroke(ctx, P.jaw, P.ink, lw);
    H.smooth(ctx, [[42, 14], [52, 16], [47, 21], [42, 19]], true, 0.4); H.fillStroke(ctx, P.beak, P.ink, lw * 0.8);
    ctx.restore();
    // skull
    const SK = [[-6, 8], [-4, -6], [8, -13], [24, -13], [36, -9], [46, -4], [53, 3], [56, 10], [50, 14], [36, 15], [18, 17], [2, 15]];
    paintShape(ctx, X, () => H.smooth(ctx, SK, true, 0.45), H.volume(ctx, P.body, -14, 16), () => {
      H.ellipse(ctx, 28, 17, 24, 4); ctx.fillStyle = P.bellyA; ctx.fill();
      texture(ctx, P, sp.seed + 5, -6, -14, 56, 16, 28, 0.5, 1.3);
      openPath(ctx, [[-3, -5], [8, -11.5], [24, -11.5], [36, -7.5], [46, -2.5]]); ctx.strokeStyle = P.rim; ctx.lineWidth = 2; ctx.stroke();
    }, lw);
    H.smooth(ctx, [[46, 2], [55, 4], [60, 12], [58, 18], [52, 15], [47, 10]], true, 0.4);
    H.fillStroke(ctx, H.linear(ctx, 46, 2, 60, 16, [[0, H.shade(P.beak, 0.25)], [1, P.beak]]), P.ink, lw * 0.85);
    // cheek horn
    if (st > 0) horn(ctx, X, 15, 12, 10 - 2 * fk, 18 + 3 * fk, 5, 0.1, P.horn, lw * 0.8);
    // nose horn
    if (styr) horn(ctx, X, 41, -5, 47 + 3 * fk, -8 - 38 * fk, 11 * Math.sqrt(fk) + 2, 0.08, P.horn, lw);
    else horn(ctx, X, 45, -3, 48 + fk, -4 - 11 * fk, 7 * Math.sqrt(fk) + 2, 0.05, P.horn, lw);
    // near brow horn (juveniles' horns curve back, adults' sweep forward)
    if (hl > 2) horn(ctx, X, 25, -10, 25 + Math.cos(ha) * hl, -10 + Math.sin(ha) * hl, 8 * Math.sqrt(fk) + 1.5, hb, P.horn, lw);
    eye(ctx, X, 25, -3, 2.8 * S.eye, { iris: st === 3 ? P.glow : '#a8762a', pupil: 'round', brow: st > 0 });
    ctx.restore();
  }
  function ceratopsian(ctx, sp, o) {
    const X = poseOf(o, sp), S = X.S, P = X.P, st = X.st;
    const styr = has(sp, 'spiked_frill') || has(sp, 'nose_horn');
    const legK = S.leg, ph = X.t * 6.5, lg = X.lg, rc = X.rc;
    const hipH = 50 * legK, shH = 42 * legK;
    let bx = 0, by = 0, fy = 0, hA = 0.28;
    switch (X.pose) {
      case 'walk': by = -Math.abs(Math.sin(ph)) * 1.6; hA = 0.3 + Math.sin(ph * 2) * 0.04; break;
      case 'attack': bx = lg * 18; by = Math.max(0, lg) * 2; fy = Math.max(0, lg) * 3; hA = 0.28 + 0.2 * clamp(lg, 0, 1) - 0.42 * clamp(-lg / 0.3, 0, 1); break;
      case 'roar': bx = -2; fy = -4; hA = -0.32 + Math.sin(X.t * 30) * 0.02; break;
      case 'eat': fy = 4; hA = 0.48 + Math.sin(X.t * 4) * 0.05; break;
      case 'hurt': bx = -9 * rc; fy = -3 * rc; hA = 0.28 - 0.45 * rc; break;
      default: by = -X.br * 1.2; hA = 0.28 + X.look * 0.1;
    }
    const hip = [-30 + bx, -hipH + by], sh = [26 + bx, -shH + by + fy];
    const ang = Math.atan2(sh[1] - hip[1], sh[0] - hip[0]), bl = Math.hypot(sh[0] - hip[0], sh[1] - hip[1]);
    const B = frame(hip, ang);
    const tail = tailJoints(X, B(-6, -2), PI - 0.3 - ang * 0.5, 46 * S.tail, 3, -0.06, X.pose === 'walk' ? 0.09 : 0.05, 1.6);
    const ch = S.chub;
    const T = trunk(tail.concat([B(0, 0), B(bl * 0.5, -3), B(bl, 0), B(bl + 13, 5)]), [2, 6, 11, 24, 27 * ch, 23, 15], [2, 6, 11, 21, 27 * ch * (1 + X.br * 0.025), 24, 15]);
    ctx.save();
    const stride = 11 * legK, lift = 6 * legK, walking = X.pose === 'walk';
    const lgF = X.pose === 'attack' ? Math.max(0, lg) * 18 : 0, rcF = X.pose === 'hurt' ? -4 * rc : 0;
    const foot = (rx, p, off) => (walking ? [rx + stride * Math.sin(p), -Math.max(0, Math.cos(p)) * lift] : [rx + off, 0]);
    const G = H.volume(ctx, P.body, T.box[1], 2);
    const hL1 = 22 * legK, hL2 = 21 * legK, fL1 = 17 * legK, fL2 = 16 * legK;
    quadLeg(ctx, X, B(7, 8), foot(-24 + lgF * 0.3 + rcF, ph + PI, -5), hL1, hL2, 15, 1, P.far, false);
    quadLeg(ctx, X, B(bl, 9), foot(28 + lgF * 0.5 + rcF, ph, -4), fL1, fL2, 12.5, -1, P.far, false);
    paintTrunk(ctx, X, sp, T, G, {
      pat: [T.joints[1][0], T.box[1], T.joints[5][0], T.joints[4][1] + 4], rim: [1, 6],
      hl: [B(bl * 0.4, 0)[0], B(bl * 0.4, -18)[1], 50], tex: 90,
    });
    if (st === 3) {
      const c = B(bl * 0.55, -6);
      clawScars(ctx, X, c[0], c[1], 1.15 + ang, 18, 1.2);
    }
    quadLeg(ctx, X, B(2, 9), foot(-26 + lgF * 0.5 + rcF, ph, 4), hL1, hL2, 15.5, 1, G, true);
    quadLeg(ctx, X, B(bl - 5, 10), foot(24 + lgF * 0.8 + rcF, ph + PI, 3), fL1, fL2, 13, -1, G, true);
    ceratoHead(ctx, X, sp, styr, B(bl + 14, 6), hA);
    ctx.restore();
  }
  ART.registerTemplate('ceratopsian', ceratopsian, { bounds: [-92, -110, 104, 4], shadowW: 120 });

  // ===================================================================
  // STEGOSAUR: arched back with alternating plates, small low head, thagomizer
  function stegosaur(ctx, sp, o) {
    const X = poseOf(o, sp), S = X.S, P = X.P, st = X.st, fk = S.feat;
    const legK = S.leg, ph = X.t * 6, lg = X.lg, rc = X.rc;
    const hipH = 56 * legK, shH = 34 * legK;
    let bx = 0, by = 0, fy = 0, hA = 0.35, whip = 0;
    switch (X.pose) {
      case 'walk': by = -Math.abs(Math.sin(ph)) * 1.5; hA = 0.38 + Math.sin(ph * 2) * 0.04; break;
      case 'attack': whip = lg; bx = lg * 6; fy = Math.max(0, lg) * 2; hA = 0.45; break;
      case 'roar': fy = -3; hA = -0.25 + Math.sin(X.t * 30) * 0.02; whip = 0.15; break;
      case 'eat': fy = 4; hA = 0.95 + Math.sin(X.t * 4) * 0.05; break;
      case 'hurt': bx = -8 * rc; hA = 0.35 - 0.4 * rc; whip = 0.3 * rc; break;
      default: by = -X.br * 1.1; hA = 0.35 + X.look * 0.12;
    }
    const hip = [-22 + bx, -hipH + by], sh = [30 + bx, -shH + by + fy];
    const ang = Math.atan2(sh[1] - hip[1], sh[0] - hip[0]), bl = Math.hypot(sh[0] - hip[0], sh[1] - hip[1]);
    const B = frame(hip, ang);
    const walking = X.pose === 'walk';
    const tail = tailJoints(X, B(-4, -3), PI + 0.18 + whip * 0.45 - ang * 0.3, 70 * S.tail, 4, 0.01 + whip * 0.36, walking ? 0.08 : 0.04, 1.5);
    const ch = S.chub;
    const nk = B(bl + 12, 6), ne = [nk[0] + 10, nk[1] + 5 + (X.pose === 'eat' ? 10 : 0)];
    const T = trunk(tail.concat([B(0, -2), B(bl * 0.45, -6), B(bl, 0), nk, ne]),
      [2, 5, 8, 12, 22, 25 * ch, 18, 10, 7], [2, 5, 8, 12, 20, 25 * ch * (1 + X.br * 0.025), 18, 10, 7]);
    ctx.save();
    const G = H.volume(ctx, P.body, T.box[1], 2);
    const stride = 11 * legK, lift = 6 * legK;
    const foot = (rx, p, off) => (walking ? [rx + stride * Math.sin(p), -Math.max(0, Math.cos(p)) * lift] : [rx + off, 0]);
    const hL1 = 27 * legK, hL2 = 26 * legK, fL1 = 14 * legK, fL2 = 13 * legK;
    quadLeg(ctx, X, B(8, 10), foot(-18, ph + PI, -5), hL1, hL2, 15, 1, P.far, false);
    quadLeg(ctx, X, B(bl, 8), foot(34, ph, -4), fL1, fL2, 11, -1, P.far, false);
    // plates (far row darker, near row in front of it; both rooted inside the back)
    const plates = [], n = 9;
    for (let i = 0; i < n; i++) {
      const u = lerp(1.4, 7.6, i / (n - 1)), q = along(T, u, -0.75), sz = Math.sin(PI * (0.12 + 0.8 * i / (n - 1)));
      plates.push({ q, h: (5 + 28 * fk) * sz * (i % 2 ? 0.9 : 1), far: i % 2 === 1 });
    }
    const plate = (pl, col) => {
      const q = pl.q, h = pl.h, w = h * 0.72 + 3, ux = -q[2], uy = -q[3], vx = -uy, vy = ux; // up and along
      const base = [q[0] + q[2] * 6, q[1] + q[3] * 6];
      const pts = [[base[0] - vx * w * 0.4, base[1] - vy * w * 0.4], [base[0] + ux * h * 0.55 - vx * w * 0.55, base[1] + uy * h * 0.55 - vy * w * 0.55],
        [base[0] + ux * h - vx * w * 0.1, base[1] + uy * h - vy * w * 0.1], [base[0] + ux * h * 0.5 + vx * w * 0.42, base[1] + uy * h * 0.5 + vy * w * 0.42], [base[0] + vx * w * 0.4, base[1] + vy * w * 0.4]];
      H.smooth(ctx, pts, true, 0.35);
      H.fillStroke(ctx, col, P.ink, LW * 0.85);
      return pts;
    };
    const glowSegs = [];
    for (const pl of plates) if (pl.far) plate({ q: [pl.q[0] + 3, pl.q[1] - 2, pl.q[2], pl.q[3]], h: pl.h }, P.plateFar);
    for (const pl of plates) if (!pl.far) {
      const pts = plate(pl, P.plate);
      ctx.strokeStyle = 'rgba(255,240,220,.35)'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); ctx.lineTo(lerpPt(pts[1], pts[2], 0.5)[0], lerpPt(pts[1], pts[2], 0.5)[1]); ctx.stroke();
      ctx.strokeStyle = H.rgba(P.ink, 0.3);
      ctx.beginPath(); ctx.moveTo(lerpPt(pts[0], pts[4], 0.5)[0], lerpPt(pts[0], pts[4], 0.5)[1]); ctx.lineTo(pts[2][0], pts[2][1]); ctx.stroke();
      if (st === 3) glowSegs.push([lerpPt(pts[0], pts[1], 0.7), lerpPt(pts[1], pts[2], 0.6), lerpPt(pts[2], pts[3], 0.4)]);
    }
    // thagomizer (far pair first)
    const tdir = Math.atan2(T.joints[0][1] - T.joints[1][1], T.joints[0][0] - T.joints[1][0]);
    const sl = (4 + 18 * fk);
    const spike = (u, da, l, col) => { const q = along(T, u, -0.3); horn(ctx, X, q[0], q[1], q[0] + Math.cos(tdir + da) * l, q[1] + Math.sin(tdir + da) * l, 4 + 2 * fk, 0.08, col); };
    spike(0.9, 0.9, sl * 0.95, P.hornFar); spike(0.35, 0.55, sl * 0.9, P.hornFar);
    paintTrunk(ctx, X, sp, T, G, {
      pat: [T.joints[2][0], T.box[1], T.joints[7][0], T.joints[5][1]], rim: [1, 8],
      hl: [B(bl * 0.35, 0)[0], B(bl * 0.35, -20)[1], 46], tex: 90,
    });
    spike(1.2, 1.25, sl, P.horn); spike(0.6, 0.75, sl * 0.95, P.horn);
    if (st === 3) {
      glowLines(ctx, X, glowSegs, 1.2);
      const c = B(bl * 0.2, 6);
      clawScars(ctx, X, c[0], c[1], 1.2 + ang, 16, 1.1);
    }
    quadLeg(ctx, X, B(4, 11), foot(-22, ph, 4), hL1, hL2, 16, 1, G, true);
    quadLeg(ctx, X, B(bl - 4, 9), foot(30, ph + PI, 3), fL1, fL2, 11.5, -1, G, true);
    // small head
    const hs = S.head, jawA = X.jw * 0.3, lw = LW / hs;
    ctx.save();
    ctx.translate(ne[0], ne[1]); ctx.rotate(hA); ctx.scale(hs, hs);
    ctx.save(); ctx.translate(2, 5); ctx.rotate(jawA); ctx.translate(-2, -5);
    H.smooth(ctx, [[2, 5], [24, 5], [26, 8], [14, 10], [2, 9]], true, 0.4); H.fillStroke(ctx, P.jaw, P.ink, lw);
    ctx.restore();
    const SK = [[-4, 5], [-3, -4], [6, -7.5], [16, -6.5], [24, -3], [28, 1], [27, 5], [14, 7], [2, 7]];
    paintShape(ctx, X, () => H.smooth(ctx, SK, true, 0.45), H.volume(ctx, P.body, -8, 7), () => {
      H.poly(ctx, [[22, -6], [31, -1], [31, 8], [21, 8]], true); ctx.fillStyle = P.beak; ctx.fill();
      H.ellipse(ctx, 12, 7, 12, 2.4); ctx.fillStyle = P.bellyA; ctx.fill();
      openPath(ctx, [[-2, -3], [6, -6.5], [16, -5.5]]); ctx.strokeStyle = P.rim; ctx.lineWidth = 1.6; ctx.stroke();
    }, lw);
    eye(ctx, X, 8.5, -2, 2.1 * S.eye, { iris: st === 3 ? P.glow : '#9a6a2a', pupil: 'round', brow: st > 1 });
    ctx.restore();
    ctx.restore();
  }
  ART.registerTemplate('stegosaur', stegosaur, { bounds: [-110, -110, 86, 4], shadowW: 120 });

  // ===================================================================
  // ANKYLOSAUR: low armoured tank, osteoderms, side spikes, club tail
  function ankylosaur(ctx, sp, o) {
    const X = poseOf(o, sp), S = X.S, P = X.P, st = X.st, fk = S.feat;
    const legK = S.leg, ph = X.t * 6.5, lg = X.lg, rc = X.rc;
    const hipH = 34 * legK, shH = 31 * legK;
    let bx = 0, by = 0, fy = 0, hA = 0.22, whip = 0;
    switch (X.pose) {
      case 'walk': by = -Math.abs(Math.sin(ph)) * 1.2; hA = 0.25 + Math.sin(ph * 2) * 0.04; break;
      case 'attack': whip = lg; bx = lg * 6; hA = 0.35; break;
      case 'roar': fy = -3; hA = -0.25 + Math.sin(X.t * 30) * 0.02; whip = 0.12; break;
      case 'eat': fy = 3; hA = 0.8 + Math.sin(X.t * 4) * 0.05; break;
      case 'hurt': bx = -7 * rc; hA = 0.22 - 0.4 * rc; whip = 0.3 * rc; break;
      default: by = -X.br * 0.9; hA = 0.22 + X.look * 0.12;
    }
    const hip = [-24 + bx, -hipH + by], sh = [28 + bx, -shH + by + fy];
    const ang = Math.atan2(sh[1] - hip[1], sh[0] - hip[0]), bl = Math.hypot(sh[0] - hip[0], sh[1] - hip[1]);
    const B = frame(hip, ang);
    const walking = X.pose === 'walk';
    const tail = tailJoints(X, B(-6, -3), PI - 0.02 + whip * 0.55, 66 * S.tail, 4, whip * 0.34, walking ? 0.1 : 0.05, 1.5);
    const ch = S.chub;
    const nk = B(bl + 10, 4);
    const T = trunk(tail.concat([B(0, -2), B(bl * 0.5, -2), B(bl, 0), nk]), [3, 4.5, 6, 9, 22 * ch, 25 * ch, 20, 11], [3, 4.5, 6, 8, 13, 14 * (1 + X.br * 0.03), 13, 9]);
    ctx.save();
    const G = H.volume(ctx, P.body, T.box[1], 2);
    const stride = 9 * legK, lift = 5 * legK;
    const foot = (rx, p, off) => (walking ? [rx + stride * Math.sin(p), -Math.max(0, Math.cos(p)) * lift] : [rx + off, 0]);
    const hL1 = 17 * legK, hL2 = 16 * legK, fL1 = 14 * legK, fL2 = 13 * legK;
    quadLeg(ctx, X, B(8, 6), foot(-20, ph + PI, -5), hL1, hL2, 14, 1, P.far, false);
    quadLeg(ctx, X, B(bl, 6), foot(32, ph, -4), fL1, fL2, 12, -1, P.far, false);
    // far-side spikes peeking above the back
    const spikes = (far) => {
      for (let i = 0; i < 6; i++) {
        const q = along(T, 3.6 + i * 0.62, far ? -0.85 : 0.35), l = (3 + 8 * fk) * (i === 5 ? 1.5 : 1), a = Math.atan2(q[3], q[2]) + (far ? -PI * 0.75 : 0.55);
        horn(ctx, X, q[0], q[1], q[0] + Math.cos(a) * l, q[1] + Math.sin(a) * l, 4 + 1.5 * fk, 0, far ? P.hornFar : P.horn, LW * 0.75);
      }
    };
    if (fk > 0.3) spikes(true);
    paintTrunk(ctx, X, sp, T, G, {
      pat: [T.joints[3][0], T.box[1], T.joints[6][0], T.joints[5][1]], rim: [1, 7], belly: [0, 7],
      hl: [B(bl * 0.45, 0)[0], B(0, -20)[1], 46], tex: 60,
      extra() {
        // osteoderm rows following the dome
        for (let row = 0; row < 3; row++) {
          ctx.beginPath();
          const cnt = 10 - row, r = (3.6 - row * 0.5) * (0.7 + 0.3 * fk);
          for (let i = 0; i < cnt; i++) {
            const q = along(T, 3.3 + i * (4 / cnt) + row * 0.15, -0.72 + row * 0.42);
            ctx.moveTo(q[0] + r * 1.2, q[1]); ctx.ellipse(q[0], q[1], r * 1.2, r, 0, 0, TAU);
          }
          ctx.fillStyle = H.rgba(H.shade(P.body, 0.18), 0.9); ctx.fill();
          ctx.strokeStyle = H.rgba(P.ink, 0.6); ctx.lineWidth = 1; ctx.stroke();
        }
        // tail scutes
        ctx.beginPath();
        for (let i = 0; i < 6; i++) { const q = along(T, 0.6 + i * 0.5, -0.3), r = 1.8; ctx.moveTo(q[0] + r, q[1]); ctx.arc(q[0], q[1], r, 0, TAU); }
        ctx.fillStyle = H.rgba(H.shade(P.body, 0.15), 0.8); ctx.fill();
      },
    });
    if (fk > 0.15) spikes(false);
    // club
    const tip = T.joints[0], tdir = Math.atan2(T.joints[0][1] - T.joints[1][1], T.joints[0][0] - T.joints[1][0]), cs = [0.4, 0.7, 1, 1.25][st];
    ctx.save();
    ctx.translate(tip[0], tip[1]); ctx.rotate(tdir);
    H.ellipse(ctx, 2 * cs, -4 * cs, 9 * cs, 7 * cs); H.fillStroke(ctx, P.far, P.ink, LW);
    paintShape(ctx, X, () => H.ellipse(ctx, 3 * cs, 2 * cs, 11 * cs, 8 * cs), H.radial(ctx, 0, -2 * cs, 1, 12 * cs, [[0, H.shade(P.body, 0.3)], [1, H.shade(P.body, -0.2)]]), () => {
      ctx.beginPath();
      for (let i = 0; i < 5; i++) { const x = (i - 2) * 4 * cs + 3 * cs, y = (i % 2 ? -1 : 3) * cs; ctx.moveTo(x + 2.2 * cs, y); ctx.arc(x, y, 2.2 * cs, 0, TAU); }
      ctx.fillStyle = H.rgba(P.dark, 0.4); ctx.fill();
    });
    if (st === 3) glowLines(ctx, X, [[[-6 * cs, 2 * cs], [3 * cs, -4 * cs], [12 * cs, 2 * cs]]], 1.3);
    ctx.restore();
    if (st === 3) {
      const c = B(bl * 0.25, 4);
      clawScars(ctx, X, c[0], c[1], 1.1 + ang, 14, 1.1);
    }
    quadLeg(ctx, X, B(4, 7), foot(-26, ph, 4), hL1, hL2, 14.5, 1, G, true);
    quadLeg(ctx, X, B(bl - 4, 7), foot(26, ph + PI, 3), fL1, fL2, 12.5, -1, G, true);
    // head: wide, low, with back-corner horns and a beak
    const hs = S.head, jawA = X.jw * 0.28, lw = LW / hs;
    ctx.save();
    ctx.translate(nk[0] + 2, nk[1] + 2); ctx.rotate(hA); ctx.scale(hs, hs);
    if (fk > 0.2) horn(ctx, X, -1, -7, -10 - 4 * fk, -11 - 3 * fk, 6, 0.1, P.hornFar, lw);
    ctx.save(); ctx.translate(2, 6); ctx.rotate(jawA); ctx.translate(-2, -6);
    H.smooth(ctx, [[2, 6], [25, 6], [27, 9], [14, 11], [2, 10]], true, 0.4); H.fillStroke(ctx, P.jaw, P.ink, lw);
    ctx.restore();
    const SK = [[-4, 5], [-5, -6], [4, -11], [16, -11], [25, -6], [30, 0], [28, 6], [16, 8], [2, 8]];
    paintShape(ctx, X, () => H.smooth(ctx, SK, true, 0.45), H.volume(ctx, P.body, -12, 8), () => {
      H.poly(ctx, [[24, -6], [33, -2], [32, 9], [24, 9]], true); ctx.fillStyle = P.beak; ctx.fill();
      ctx.beginPath();
      for (let i = 0; i < 4; i++) { const x = 0 + i * 6, y = -8 + Math.abs(i - 1.5) * 0.8; ctx.moveTo(x + 2.4, y); ctx.arc(x, y, 2.4, 0, TAU); }
      ctx.fillStyle = H.rgba(H.shade(P.body, 0.2), 0.9); ctx.fill(); ctx.strokeStyle = H.rgba(P.ink, 0.5); ctx.lineWidth = 0.8; ctx.stroke();
      H.ellipse(ctx, 12, 8, 12, 2.4); ctx.fillStyle = P.bellyA; ctx.fill();
    }, lw);
    if (fk > 0.2) horn(ctx, X, 0, 4, -8 - 3 * fk, 9 + 3 * fk, 5.5, -0.1, P.horn, lw);
    eye(ctx, X, 13, -3, 2.2 * S.eye, { iris: st === 3 ? P.glow : '#9a6a2a', pupil: 'round', brow: st > 0, browCol: H.shade(P.body, -0.1) });
    ctx.restore();
    ctx.restore();
  }
  ART.registerTemplate('ankylosaur', ankylosaur, { bounds: [-112, -86, 80, 4], shadowW: 120 });

  // ===================================================================
  // HADROSAUR (parasaurolophus): quadrupedal grazer that rears up on its hind legs; tube crest, duck bill
  function hadrosaur(ctx, sp, o) {
    const X = poseOf(o, sp), S = X.S, P = X.P, st = X.st, fk = S.feat;
    const legK = S.leg, ph = X.t * 6, lg = X.lg, rc = X.rc;
    const hipH = 56 * legK;
    let bx = 0, by = 0, rear = 0, nA = -0.75, hA = 0.18, tailLift = 0;
    switch (X.pose) {
      case 'walk': by = -Math.abs(Math.sin(ph)) * 1.6; nA += Math.sin(ph * 2) * 0.04; break;
      case 'attack': rear = rearCurve(X.k); bx = slamFwd(X.k) * 10; nA = -0.95 + 0.4 * slamFwd(X.k); hA = 0.25; tailLift = -0.1 * rear; break;
      case 'roar': rear = 0.72; nA = -1.25; hA = -0.45 + Math.sin(X.t * 30) * 0.02; break;
      case 'eat': nA = 0.55; hA = 1.15 + Math.sin(X.t * 4) * 0.05; break;
      case 'hurt': rear = 0.3 * rc; bx = -8 * rc; nA = -1.1; hA = 0.18 - 0.45 * rc; break;
      default: by = -X.br * 1.1; nA += X.look * 0.08; hA += X.look * 0.12;
    }
    const ang = lerp(0.3, -0.72, rear) + (X.pose === 'eat' ? 0.06 : 0);
    const hip = [-14 + bx, -hipH + by];
    const B = frame(hip, ang);
    const bl = 46 * (st === 0 ? 0.88 : 1);
    const walking = X.pose === 'walk';
    const tail = tailJoints(X, B(-4, -2), PI - 0.06 + tailLift - ang * 0.7, 66 * S.tail, 4, 0.0, walking ? 0.1 : 0.05, 1.6);
    const nb = B(bl + 7, -3), nl = 28 * S.neck;
    const nm = [nb[0] + Math.cos(nA + 0.25) * nl * 0.5, nb[1] + Math.sin(nA + 0.25) * nl * 0.5];
    const ne = [nm[0] + Math.cos(nA - 0.15) * nl * 0.5, nm[1] + Math.sin(nA - 0.15) * nl * 0.5];
    const ch = S.chub;
    const T = trunk(tail.concat([B(0, 0), B(bl * 0.5, 2), B(bl, 3), nm, ne]),
      [1, 4, 8, 12.5, 20, 22 * ch, 18, 9, 7], [1, 4, 7.5, 11.5, 17, 22 * ch * (1 + X.br * 0.03), 18, 10, 7]);
    ctx.save();
    const G = H.volume(ctx, P.body, T.box[1], 2);
    // hind legs (digitigrade), front legs (on the ground or dangling when reared)
    const thigh = 28 * legK, shin = 26 * legK, meta = 13 * legK, gx = -10, stride = 13 * legK, lift = 7 * legK;
    let fN = gx + 6, fF = gx - 6, lN = 0, lF = 0;
    if (walking) { fN = gx + stride * Math.sin(ph); lN = Math.max(0, Math.cos(ph)) * lift; fF = gx + stride * Math.sin(ph + PI); lF = Math.max(0, Math.cos(ph + PI)) * lift; }
    const hipS = B(2, 9);
    const front = (p, off) => {
      const g = walking ? [34 + stride * 0.8 * Math.sin(p), -Math.max(0, Math.cos(p)) * lift * 0.8] : [32 + off + bx * 0.6, 0];
      const top = B(bl - 4, 9), hang = [top[0] + 10, top[1] + 22];
      const r = smoothstep(rear * 1.6);
      return lerpPt(g, hang, r);
    };
    const fl1 = 18 * legK, fl2 = 18 * legK;
    digiLeg(ctx, X, [hipS[0] + 3, hipS[1] - 1.5], fF, lF, thigh, shin, meta, 18, P.far, false);
    quadLeg(ctx, X, B(bl - 1, 8), front(ph, -4), fl1, fl2, 9, -1, P.far, false);
    paintTrunk(ctx, X, sp, T, G, {
      pat: [T.joints[2][0], T.box[1], T.joints[6][0], T.joints[5][1] + 4], rim: [1, 8],
      hl: [B(bl * 0.4, 0)[0], B(bl * 0.4, -14)[1], 44], tex: 90,
    });
    if (st === 3) {
      const c = B(bl * 0.6, -4);
      clawScars(ctx, X, c[0], c[1], 1.1 + ang, 15, 1.1);
    }
    digiLeg(ctx, X, hipS, fN, lN, thigh, shin, meta, 19, G, true);
    quadLeg(ctx, X, B(bl - 6, 9), front(ph + PI, 3), fl1, fl2, 9.5, -1, G, true);
    // head with tube crest and duck bill
    const hs = S.head, jawA = X.jw * 0.32, lw = LW / hs, ck = [0.3, 0.62, 1, 1.18][st];
    ctx.save();
    ctx.translate(ne[0], ne[1]); ctx.rotate(hA - jawA * 0.2); ctx.scale(hs, hs);
    const crest = [[10, -9], [-4 * ck + 2, -18 * ck - 5], [-22 * ck, -28 * ck - 6], [-38 * ck, -34 * ck - 6]];
    H.limb(ctx, crest, [9, 8.5, 8, 7]);
    const cpath = () => H.limb(ctx, crest, [9, 8.5, 8, 7]);
    paintShape(ctx, X, cpath, H.mix(P.acc, P.body, 0.25), () => {
      openPath(ctx, crest.map(p => [p[0] + 0.5, p[1] - 2.2])); ctx.strokeStyle = 'rgba(255,240,220,.45)'; ctx.lineWidth = 2; ctx.stroke();
      openPath(ctx, crest.map(p => [p[0], p[1] + 2.8])); ctx.strokeStyle = H.rgba(P.ink, 0.25); ctx.lineWidth = 2.5; ctx.stroke();
    }, lw);
    if (st === 3) glowLines(ctx, X, [crest.slice(1).map(p => [p[0], p[1] - 0.5])], 1.3 / hs);
    ctx.save(); ctx.translate(2, 7); ctx.rotate(jawA); ctx.translate(-2, -7);
    if (jawA > 0.04) { H.ellipse(ctx, 24, 8, 16, 2.5); ctx.fillStyle = P.mouth; ctx.fill(); }
    H.smooth(ctx, [[2, 7], [42, 7], [47, 10], [30, 13], [8, 13]], true, 0.4); H.fillStroke(ctx, P.jaw, P.ink, lw);
    ctx.restore();
    const SK = [[-4, 6], [-4, -6], [6, -12], [18, -12], [28, -8], [36, -4], [44, -2], [50, 1], [51, 6], [46, 9], [30, 9], [12, 10], [0, 9]];
    paintShape(ctx, X, () => H.smooth(ctx, SK, true, 0.45), H.volume(ctx, P.body, -13, 10), () => {
      H.poly(ctx, [[40, -6], [54, -1], [54, 12], [40, 12]], true); ctx.fillStyle = H.mix(P.beak, P.belly, 0.25); ctx.fill();
      H.ellipse(ctx, 22, 10, 20, 3); ctx.fillStyle = P.bellyA; ctx.fill();
      texture(ctx, P, sp.seed + 4, -4, -12, 44, 9, 18, 0.5, 1.2);
      openPath(ctx, [[-2, -5], [6, -10.5], [18, -10.5], [28, -6.5], [38, -3]]); ctx.strokeStyle = P.rim; ctx.lineWidth = 1.8; ctx.stroke();
    }, lw);
    H.ellipse(ctx, 44, -1, 2, 1, -0.2); ctx.fillStyle = 'rgba(25,12,6,.7)'; ctx.fill();
    eye(ctx, X, 15, -3.5, 2.6 * S.eye, { iris: st === 3 ? P.glow : '#a8742a', pupil: 'round', brow: st > 1 });
    ctx.restore();
    ctx.restore();
  }
  ART.registerTemplate('hadrosaur', hadrosaur, { bounds: [-96, -142, 92, 4], shadowW: 110 });

  // ===================================================================
  // SAUROPOD (brachiosaurus: high neck, long front legs; diplodocus: long low neck, whip tail)
  function sauropod(ctx, sp, o) {
    const X = poseOf(o, sp), S = X.S, P = X.P, st = X.st;
    const brach = has(sp, 'high_neck');
    const legK = S.leg, ph = X.t * 4.2, rc = X.rc;
    const hipH = (brach ? 58 : 56) * legK, shH = (brach ? 74 : 50) * legK;
    let bx = 0, by = 0, rear = 0, nA = brach ? -1.22 : -0.42, nCurl = brach ? 0.1 : 0.06, hA = brach ? 0.32 : 0.3, tailLift = 0;
    switch (X.pose) {
      case 'walk': by = -Math.abs(Math.sin(ph)) * 1.4; nA += Math.sin(ph * 2) * 0.03; break;
      case 'attack': rear = rearCurve(X.k); bx = slamFwd(X.k) * 9; nA += brach ? -0.12 * rear + 0.15 * slamFwd(X.k) : -0.4 * rear + 0.2 * slamFwd(X.k); tailLift = 0.12 * rear; hA -= 0.3 * rear; break;
      case 'roar': nA += brach ? -0.22 : -0.45; nCurl -= 0.04; hA = -0.4 + Math.sin(X.t * 30) * 0.02; break;
      case 'eat':
        if (brach) { nA = -1.0; nCurl = 0.14; hA = 0.7 + Math.sin(X.t * 4) * 0.05; } else { nA = 0.32; nCurl = 0.05; hA = 1.05 + Math.sin(X.t * 4) * 0.05; }
        break;
      case 'hurt': bx = -8 * rc; nA -= 0.3 * rc; hA -= 0.4 * rc; tailLift = 0.15 * rc; break;
      default: by = -X.br * 1.0; nA += X.look * 0.06 + Math.sin(X.t * 0.8) * 0.03; hA += X.look * 0.15;
    }
    const hip = [(brach ? -36 : -32) + bx, -hipH + by], sh0 = [(brach ? 26 : 26) + bx, -shH + by];
    const ang = Math.atan2(sh0[1] - hip[1], sh0[0] - hip[0]) - rear * 0.5, bl = Math.hypot(sh0[0] - hip[0], sh0[1] - hip[1]);
    const B = frame(hip, ang);
    const walking = X.pose === 'walk';
    const tn = brach ? 4 : 6;
    const tail = tailJoints(X, B(-6, -2), (brach ? PI - 0.3 : PI - 0.32) + tailLift - ang * 0.4, (brach ? 58 : 92) * S.tail, tn, brach ? -0.02 : 0.075, walking ? 0.09 : 0.05, 1.3);
    // neck chain
    const neck = [], nn = 4, nlen = (brach ? 92 : 78) * S.neck;
    let a = nA - nCurl * 1.5, p = B(bl + 5, -6);
    for (let i = 0; i < nn; i++) {
      a += nCurl + Math.sin(X.t * 1.1 - i * 0.7) * 0.015;
      p = [p[0] + Math.cos(a) * nlen / nn, p[1] + Math.sin(a) * nlen / nn];
      neck.push(p);
    }
    const ch = S.chub;
    const tUp = brach ? [2, 6, 11, 17] : [1, 2.5, 4.5, 7.5, 11.5, 17], tDn = brach ? [2, 6, 11, 16] : [1, 2.5, 4.5, 7, 11, 16];
    const nUp = brach ? [16, 12, 9.5, 8] : [14, 11, 9, 7.5], nDn = brach ? [17, 12.5, 10, 8] : [15, 11.5, 9, 7.5];
    const J = tail.concat([B(0, 0), B(bl * 0.5, -4), B(bl, 0)], neck);
    const T = trunk(J, tUp.concat([24, 28 * ch, 24], nUp), tDn.concat([22, 29 * ch * (1 + X.br * 0.02), 24], nDn));
    const iH = tn, iS = tn + 2, iN = T.n - 1;
    ctx.save();
    const G = H.volume(ctx, P.body, T.box[1], 2);
    const stride = 10 * legK, lift = 6 * legK;
    const foot = (rx, p2, off) => (walking ? [rx + stride * Math.sin(p2), -Math.max(0, Math.cos(p2)) * lift] : [rx + off + bx * 0.5, 0]);
    const frontFoot = (p2, off) => { const g = foot(brach ? 28 : 28, p2, off), top = B(bl, 10); return lerpPt(g, [top[0] + 8, top[1] + 34 * legK], smoothstep(rear * 1.5)); };
    const hL1 = 27 * legK, hL2 = 25 * legK, fL1 = (brach ? 34 : 23) * legK, fL2 = (brach ? 32 : 22) * legK;
    quadLeg(ctx, X, B(8, 12), foot(-30, ph + PI, -6), hL1, hL2, 17, 1, P.far, false);
    quadLeg(ctx, X, B(bl + 3, 12), frontFoot(ph, -5), fL1, fL2, brach ? 15 : 13.5, -1, P.far, false);
    paintTrunk(ctx, X, sp, T, G, {
      pat: [T.joints[Math.max(0, iH - 2)][0], T.box[1], T.joints[iS][0] + 10, T.joints[iH + 1][1] + 6], patK: 1.3, rim: [1, iN],
      hl: [B(bl * 0.45, 0)[0], B(bl * 0.45, -22)[1], 60], tex: 110,
      extra() {
        if (sp.pattern === 'spots') pattern(ctx, sp, X, neck[0][0] - 20, T.box[1], neck[nn - 1][0] + 10, neck[0][1] + 10, 0.8);
      },
    });
    if (st === 3) {
      const segs = [];
      for (let i = 0; i < 9; i++) { const q = along(T, lerp(iH - 0.5, iN - 0.5, i / 8), -0.55); segs.push([[q[0] - 1.2, q[1]], [q[0] + 1.2, q[1]]]); }
      glowLines(ctx, X, segs, 2.4);
      const c = B(bl * 0.3, 4);
      clawScars(ctx, X, c[0], c[1], 1.1 + ang, 20, 1.3);
    }
    quadLeg(ctx, X, B(3, 13), foot(-34, ph, 4), hL1, hL2, 18, 1, G, true);
    quadLeg(ctx, X, B(bl - 3, 13), frontFoot(ph + PI, 3), fL1, fL2, brach ? 15.5 : 14, -1, G, true);
    // small head
    const ne = neck[nn - 1], hs = S.head * 1.05, jawA = X.jw * 0.35, lw = LW / hs;
    ctx.save();
    ctx.translate(ne[0], ne[1]); ctx.rotate(hA - jawA * 0.2); ctx.scale(hs, hs);
    ctx.save(); ctx.translate(2, 4); ctx.rotate(jawA); ctx.translate(-2, -4);
    if (jawA > 0.04) { H.ellipse(ctx, 16, 5, 10, 2); ctx.fillStyle = P.mouth; ctx.fill(); }
    H.smooth(ctx, [[2, 4], [26, 4], [27, 7], [14, 9], [2, 8]], true, 0.4); H.fillStroke(ctx, P.jaw, P.ink, lw);
    if (S.teeth > 0) H.teeth(ctx, 18, 4.2, 26, 4.2, 4, 1.4, true, P.tooth);
    ctx.restore();
    const SK = brach
      ? [[-4, 4], [-4, -4], [1, -9], [6, -14], [12, -14], [16, -9], [22, -5], [27, -1], [28, 3], [26, 5], [12, 6], [0, 6]]
      : [[-4, 4], [-5, -3], [4, -7], [14, -6.5], [24, -4], [30, -1], [31, 3], [28, 5], [14, 6], [0, 6]];
    paintShape(ctx, X, () => H.smooth(ctx, SK, true, 0.45), H.volume(ctx, P.body, brach ? -14 : -8, 6), () => {
      H.ellipse(ctx, 12, 6, 13, 2.5); ctx.fillStyle = P.bellyA; ctx.fill();
      texture(ctx, P, sp.seed + 2, -4, -14, 30, 6, 12, 0.4, 1);
      openPath(ctx, brach ? [[-2, -4], [3, -10], [8, -13], [13, -12]] : [[-3, -2], [4, -6], [14, -5.5], [22, -3.5]]);
      ctx.strokeStyle = P.rim; ctx.lineWidth = 1.6; ctx.stroke();
    }, lw);
    if (S.teeth > 0) H.teeth(ctx, 19, 4.6, 27, 3.6, 4, 1.6, false, P.tooth);
    H.ellipse(ctx, brach ? 9 : 24, brach ? -12 : -3, 1.6, 1, -0.3); ctx.fillStyle = 'rgba(25,12,6,.7)'; ctx.fill();
    eye(ctx, X, brach ? 12 : 9, -3, 2 * S.eye, { iris: st === 3 ? P.glow : '#8a5a22', pupil: 'round', brow: st > 1 });
    ctx.restore();
    ctx.restore();
  }
  ART.registerTemplate('sauropod', sauropod, { bounds: [-150, -205, 136, 4], shadowW: 150 });

  // ===================================================================
  // PTEROSAUR (pteranodon): hovers above its ground point with flapping wings, long beak and back crest
  function pterosaur(ctx, sp, o) {
    const X = poseOf(o, sp), S = X.S, P = X.P, st = X.st, fk = S.feat;
    const lg = X.lg, rc = X.rc;
    let speed = 5.5, hover = 60, bx = 0, ang = -0.05, hA = 0.12, flapAmp = 1, flapBias = 0, jawA = X.jw * 0.42;
    switch (X.pose) {
      case 'walk': speed = 8.5; ang = 0.12; break;
      case 'attack': speed = 9; bx = lg * 16; hover = 60 - Math.max(0, lg) * 24; ang = 0.05 + 0.35 * Math.max(0, lg) - 0.2 * clamp(-lg / 0.3, 0, 1); hA = 0.15 + 0.2 * Math.max(0, lg); flapAmp = 1 - 0.8 * Math.abs(lg); flapBias = 0.85 * Math.abs(lg); break;
      case 'roar': speed = 3; flapAmp = 0.15; flapBias = 0.55; ang = -0.25; hA = -0.5 + Math.sin(X.t * 30) * 0.03; break;
      case 'eat': speed = 4.5; hover = 34; ang = 0.32; hA = 1.0 + Math.sin(X.t * 5) * 0.06; flapAmp = 0.7; break;
      case 'hurt': speed = 3; bx = -8 * rc; ang = -0.4 * rc; hA = 0.12 - 0.5 * rc; flapAmp = 0.4; flapBias = -0.5 * rc; break;
      default: hA += X.look * 0.12;
    }
    const f = clamp(Math.sin(X.t * speed) * flapAmp + flapBias, -1, 1);
    const bob = -f * 3 * flapAmp;
    const c = [bx, -hover * (0.75 + 0.25 * S.leg) + bob];
    const B = frame(c, ang);
    const span = 66 * [0.68, 0.84, 1, 1.08][st];
    ctx.save();
    // wing: shoulder S, sY = vertical extent (-1.2..1.2), near wing slightly lower (camera above)
    const wing = (sY, near) => {
      const S0 = B(near ? 7 : 10, near ? -3 : -6), hipW = B(-14, near ? 2 : -2);
      const d = near ? 1 : 0.86, sw = span * d;
      const E = [S0[0] - 6 * d, S0[1] - 22 * d * sY], W = [S0[0] - 1 * d, S0[1] - 44 * d * sY], Tp = [S0[0] - 26 * d, S0[1] - sw * sY];
      const tr1 = [S0[0] - 36 * d, S0[1] - sw * 0.62 * sY], tr2 = [S0[0] - 34 * d, S0[1] - sw * 0.3 * sY];
      const pts = [S0, E, W, Tp, tr1, tr2, hipW];
      const col = near ? H.mix(P.body, P.acc, 0.22) : H.shade(H.mix(P.body, P.acc, 0.22), -0.32);
      const path = () => H.smooth(ctx, pts, true, 0.3);
      paintShape(ctx, X, path, H.linear(ctx, S0[0], S0[1], Tp[0], Tp[1], [[0, H.shade(col, -0.12)], [0.5, col], [1, H.shade(col, 0.12)]]), () => {
        ctx.strokeStyle = H.rgba(P.ink, 0.22); ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 1; i <= 3; i++) { const a = lerpPt(W, Tp, i / 4), b = lerpPt(tr2, tr1, i / 4); ctx.moveTo(a[0], a[1]); ctx.quadraticCurveTo((a[0] + b[0]) / 2 - 4, (a[1] + b[1]) / 2, b[0], b[1]); }
        ctx.stroke();
        H.ellipse(ctx, (S0[0] + tr2[0]) / 2, (S0[1] + tr2[1]) / 2, 10, 8); ctx.fillStyle = 'rgba(20,10,5,.12)'; ctx.fill();
      });
      // leading-edge arm bones
      ctx.strokeStyle = near ? P.dark : H.shade(P.dark, -0.25); ctx.lineWidth = 3.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(S0[0], S0[1]); ctx.lineTo(E[0], E[1]); ctx.lineTo(W[0], W[1]); ctx.lineTo(Tp[0], Tp[1]); ctx.stroke();
      ctx.strokeStyle = H.rgba(P.light, 0.5); ctx.lineWidth = 1.1;
      ctx.beginPath(); ctx.moveTo(E[0], E[1]); ctx.lineTo(W[0], W[1]); ctx.lineTo(lerpPt(W, Tp, 0.7)[0], lerpPt(W, Tp, 0.7)[1]); ctx.stroke();
      H.claws(ctx, W[0], W[1], 3, 3, sY > 0 ? -0.3 : 0.6, P.claw);
      if (near && st === 3) glowLines(ctx, X, [[lerpPt(W, Tp, 0.15), lerpPt(W, Tp, 0.85)]], 1.2);
    };
    const sN = clamp(f - 0.45, -1.2, 1.15), sF = clamp(f + 0.5, -1.0, 1.2);
    wing(Math.abs(sF) < 0.12 ? 0.12 * Math.sign(sF || 1) : sF, false);
    // legs trailing under the tail
    const legs = (near) => {
      const hp = B(-12, near ? 4 : 2), dx = near ? 0 : 3, sw = Math.sin(X.t * 2) * 1.5;
      H.limb(ctx, [hp, [hp[0] - 6 + dx, hp[1] + 8 + sw], [hp[0] - 12 + dx, hp[1] + 12 + sw]], [5, 3, 2.2], near ? P.body : P.far, P.ink, LW * 0.7);
      H.claws(ctx, hp[0] - 12 + dx, hp[1] + 12 + sw, 3, 2.6, 1.6, P.claw);
    };
    legs(false);
    // body
    const T = trunk([B(-30, 2), B(-16, 1), B(-2, 0), B(10, -1), B(18, -6), B(23, -12)], [1, 6, 9.5, 9, 5, 4], [1, 7, 10, 9, 5, 4]);
    paintTrunk(ctx, X, sp, T, H.volume(ctx, P.body, T.box[1], T.box[3]), { rim: [1, 5], hl: [B(0, 0)[0], B(0, -8)[1], 18], tex: 30 });
    legs(true);
    // head: long toothless beak and backswept crest
    const ne = T.joints[5], hs = S.head * 0.95, lw = LW / hs, ck = [0.25, 0.6, 1, 1.25][st];
    ctx.save();
    ctx.translate(ne[0], ne[1]); ctx.rotate(hA - jawA * 0.3); ctx.scale(hs, hs);
    const bk = st === 0 ? 0.7 : 1;
    const crest = [[-2, -4], [-14 * ck - 4, -10 * ck - 4], [-30 * ck - 2, -17 * ck - 3], [-33 * ck - 2, -14 * ck - 3], [-10 * ck, -3], [-3, 1]];
    paintShape(ctx, X, () => H.smooth(ctx, crest, true, 0.4), H.mix(P.acc, P.body, 0.15), () => {
      openPath(ctx, crest.slice(0, 3).map(q => [q[0], q[1] + 1.6])); ctx.strokeStyle = 'rgba(255,240,220,.4)'; ctx.lineWidth = 1.6; ctx.stroke();
    }, lw);
    if (st === 3) glowLines(ctx, X, [[crest[1], crest[2]].map(q => [q[0] + 2, q[1] + 2])], 1.1 / hs);
    ctx.save(); ctx.translate(3, 2.5); ctx.rotate(jawA); ctx.translate(-3, -2.5);
    H.smooth(ctx, [[3, 2.5], [42 * bk, 1.5], [38 * bk, 4], [18 * bk, 5.5], [3, 5.5]], true, 0.35); H.fillStroke(ctx, H.mix(P.beak, P.belly, 0.35), P.ink, lw);
    ctx.restore();
    const SK = [[-6, 2], [-5, -4], [4, -6.5], [16 * bk, -4.5], [44 * bk, -0.6], [40 * bk, 1.6], [20 * bk, 2.6], [3, 3.5]];
    paintShape(ctx, X, () => H.smooth(ctx, SK, true, 0.35), H.volume(ctx, P.body, -7, 4), () => {
      H.poly(ctx, [[12 * bk, -8], [48 * bk, -2], [48 * bk, 5], [12 * bk, 5]], true); ctx.fillStyle = H.rgba(H.mix(P.beak, P.belly, 0.45), 0.85); ctx.fill();
      openPath(ctx, [[-4, -3], [4, -5.5], [16 * bk, -3.5], [30 * bk, -1.8]]); ctx.strokeStyle = P.rim; ctx.lineWidth = 1.5; ctx.stroke();
    }, lw);
    eye(ctx, X, 4, -1.6, 2.1 * S.eye, { iris: st === 3 ? P.glow : '#d0902a', pupil: st === 0 ? 'round' : 'slit', brow: st > 0 });
    ctx.restore();
    if (st === 3) clawScars(ctx, X, B(2, -3)[0], B(2, -3)[1], 1.2 + ang, 9, 0.9);
    wing(Math.abs(sN) < 0.12 ? 0.12 * Math.sign(sN || 1) : sN, true);
    ctx.restore();
  }
  ART.registerTemplate('pterosaur', pterosaur, { bounds: [-56, -132, 74, 4], shadowW: 70 });
})(window.PC = window.PC || {});
