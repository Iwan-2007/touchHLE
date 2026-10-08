/* Crétacé Park — ice-age creature templates (art-ice module).
   Registers with PC.ART.registerTemplate: bird (dodo), deer (megaloceros), glyptodon, wolf (direwolf),
   rhino (woolly rhinoceros), cat (smilodon), sloth (megatherium), bear (arctodus), elephant (mammoths).
   Local units: origin = ground point under the body, +x = towards the head, -y = up (size 1 ≈ 120–160 long).
   Every template reads o.stage (0 Bébé … 3 Alpha) to change proportions, colours and ornaments. */
(function (PC) {
  'use strict';
  const ART = PC.ART;
  if (!ART || !ART.registerTemplate || !ART.helpers) return;
  const H = ART.helpers;
  const PI = Math.PI, TAU = PI * 2;
  const LW = 2.2; // outline width (local units)
  /** Registers a template wrapped in save/restore so no context state ever leaks out of a draw. */
  const register = (name, fn, meta) => ART.registerTemplate(name, (ctx, sp, o, h) => {
    ctx.save();
    try { fn(ctx, sp, o, h); } finally { ctx.restore(); }
  }, meta);

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smoothstep = x => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
  const lerpPt = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  /** Deterministic 0..1 noise for an index. */
  const hash = i => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

  // ---------- Colour helpers ----------
  const toHex = (r, g, b) => '#' + [r, g, b].map(v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
  function hslOf(hex) {
    const [r, g, b] = H.hexToRgb(hex).map(v => v / 255);
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
    if (mx === mn) return [0, 0, l];
    const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
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
  const vivid = (hex, l) => { const c = hslOf(hex); return fromHsl(c[0], Math.max(0.8, c[1]), l); };

  // ---------- Evolution stages ----------
  // head/eye: baby proportions, leg: leg length, len: body length, chub: body roundness, feat: horns/antlers/
  // tusks/claws/plates, teeth, tail, fluff: fur tuft length (cubs are fluffy).
  const STAGE = [
    { head: 1.42, eye: 1.6, leg: 0.74, len: 0.84, chub: 1.12, feat: 0.12, teeth: 0.25, tail: 0.75, fluff: 1.45, snout: 0.6 },
    { head: 1.17, eye: 1.22, leg: 0.88, len: 0.93, chub: 1.04, feat: 0.5, teeth: 0.65, tail: 0.88, fluff: 1.15, snout: 0.84 },
    { head: 1, eye: 1, leg: 1, len: 1, chub: 1, feat: 1, teeth: 1, tail: 1, fluff: 1, snout: 1 },
    { head: 1.04, eye: 0.98, leg: 1.02, len: 1.02, chub: 1.05, feat: 1.28, teeth: 1.25, tail: 1.03, fluff: 1.18, snout: 1.03 },
  ];

  // Alpha glow colours (icy / ember / golden accents chosen per species; fallback = vivid accent).
  const GLOW = {
    dodo: '#ffd84a', megaloceros: '#8af4ff', glyptodon: '#5fe1ff', direwolf: '#7fdcff', woollyrhino: '#ff9a3c',
    smilodon: '#ffc94a', megatherium: '#a8ff70', arctodus: '#ff7a40', mammoth: '#7fe8ff', glacimammoth: '#7ff0ff',
  };

  /** Palette per species and stage (cached: no string work per frame). */
  const palCache = new Map();
  function pal(sp, st) {
    const key = sp.id + '|' + st;
    let P = palCache.get(key);
    if (P) return P;
    let body = sp.colors.body, belly = sp.colors.belly, acc = sp.colors.accent;
    if (st === 0) { body = H.shade(H.mix(body, belly, 0.3), 0.12); belly = H.shade(belly, 0.16); }
    else if (st === 1) { body = H.shade(H.mix(body, belly, 0.12), 0.03); belly = H.shade(belly, 0.06); }
    else if (st === 3) { body = saturate(H.shade(body, -0.2), 0.32); belly = saturate(H.shade(belly, -0.08), 0.18); acc = saturate(acc, 0.2); }
    const ink = H.ink(body);
    const glow = GLOW[sp.id] || vivid(acc, 0.6);
    P = {
      body, belly, acc, ink,
      leg: H.mix(body, belly, 0.22), far: H.shade(H.mix(body, belly, 0.15), -0.3), dark: H.shade(body, -0.22), light: H.shade(body, 0.3),
      hi: H.shade(body, 0.2), lo: H.shade(body, -0.32),
      mane: st === 3 ? H.shade(H.mix(body, '#1a120c', 0.4), -0.1) : H.shade(body, -0.14),
      bellyMix: H.mix(body, belly, 0.7),
      furD: H.rgba(H.shade(body, -0.55), 0.36), furL: H.rgba(H.shade(body, 0.62), 0.32),
      edge: H.rgba(ink, 0.26), rim: H.rgba(H.shade(body, 0.8), 0.6),
      nose: '#1d1613', mouth: '#4a1612', gum: '#b5585c', tongue: '#cc6464', tooth: '#f8f1de',
      claw: '#2a221c', clawHi: 'rgba(255,245,225,.35)',
      horn: H.mix(acc, '#f4ecd8', 0.25), hornDark: H.shade(H.mix(acc, body, 0.25), -0.25),
      glow, glowCore: H.shade(glow, 0.7),
      scar: 'rgba(250,236,220,.92)', snow: 'rgba(246,250,253,.78)', snowShade: 'rgba(170,198,220,.35)',
    };
    palCache.set(key, P);
    return P;
  }

  /**
   * Per-draw animation state shared by every template. speed = walk cycle speed (rad/s).
   * Optional extension: o.super (bool) or o.power (0..1) = super attack charge: exaggerated lunge and jaws,
   * glowing markings at every stage (flickering faster and brighter).
   */
  function poseOf(o, sp, speed) {
    const st = clamp(o.stage == null ? 3 : o.stage | 0, 0, 3);
    const pose = o.pose === 'swim' ? 'walk' : (o.pose || 'idle');
    const t = o.t || 0, spd = speed || 7;
    const blinkPh = (t + sp.seed * 0.71) % 4.1;
    const walking = pose === 'walk';
    const pow = o.super ? 1 : clamp(+o.power || 0, 0, 1);
    const atk = pose === 'attack' || pose === 'roar';
    return {
      st, S: STAGE[st], P: pal(sp, st), t, pose, k: clamp(o.k || 0, 0, 1), seed: sp.seed,
      pow, glowOn: st === 3 || pow > 0,
      br: H.breath(o), lg: H.lunge(o) * (1 + 0.3 * pow), jw: Math.min(1, H.jaw(o) + (atk ? 0.25 * pow : 0)), rc: H.recoil(o),
      look: pose === 'idle' ? H.idleLook(o) : 0,
      blink: (pose === 'idle' || pose === 'walk' || pose === 'eat') && blinkPh < 0.14,
      hurt: pose === 'hurt', angry: pose === 'attack' || pose === 'roar',
      walking, spd, ph: t * spd,
      bob: walking ? -(0.5 + 0.5 * Math.cos(2 * t * spd)) * 1.6 : 0,
    };
  }
  /** Foot offset for a walking leg: [dx, lift]. */
  function gait(X, phase, stride, lift) {
    if (!X.walking) return [0, 0];
    const p = X.ph + phase;
    return [Math.sin(p) * stride, Math.max(0, Math.cos(p)) * lift];
  }
  /** Rear-up curve for attacks (k 0..0.35 rise, hold to 0.55, slam down by 0.75). */
  const rearCurve = k => (k < 0.35 ? smoothstep(k / 0.35) : k < 0.55 ? 1 : k < 0.75 ? 1 - smoothstep((k - 0.55) / 0.2) : 0);

  // ---------- Frames ----------
  /** Body frame: rotate (x, y) around pivot (px, py) by a, then translate by (dx, dy). Returns [x, y, f]. */
  function bodyFrame(px, py, a, dx, dy) {
    const c = Math.cos(a), s = Math.sin(a);
    return (x, y, f) => { const u = x - px, v = y - py; return [px + u * c - v * s + dx, py + u * s + v * c + dy, f || 0]; };
  }
  /** Head frame: head-local (x forward, y down) → local, pivot HP, angle a, scale s. */
  function headFrame(HP, a, s) {
    const c = Math.cos(a) * s, si = Math.sin(a) * s;
    return (x, y, f) => [HP[0] + x * c - y * si, HP[1] + x * si + y * c, f || 0];
  }
  /** Lowers the head angle (towards up) until every head-local sample point stays above the ground. */
  function clampHead(HP, a, s, pts) {
    for (let it = 0; it < 30; it++) {
      const c = Math.cos(a), si = Math.sin(a);
      let maxY = -1e9;
      for (const p of pts) { const y = HP[1] + (p[0] * si + p[1] * c) * s; if (y > maxY) maxY = y; }
      if (maxY <= -0.5) break;
      a -= 0.04;
    }
    return a;
  }

  // ---------- Shapes ----------
  /** Bezier control points of segment i of a closed Catmull-Rom spline. */
  function segCtl(pts, i) {
    const n = pts.length, p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    return [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6, p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
  }
  /**
   * Closed smooth shape through control points [x, y, fuzz]. Segments with fuzz > 0 get a ragged fur edge made
   * of tufts (length fuzz × amt) sweeping along (swx, swy) and swaying gently with time. Returns a Path2D.
   */
  function shape(pts, amt, seed, t, swx, swy) {
    const n = pts.length, p = new Path2D();
    let area = 0;
    for (let i = 0; i < n; i++) { const a = pts[i], b = pts[(i + 1) % n]; area += a[0] * b[1] - b[0] * a[1]; }
    const sg = area > 0 ? 1 : -1;
    swx = swx == null ? -0.5 : swx; swy = swy == null ? 0.6 : swy;
    p.moveTo(pts[0][0], pts[0][1]);
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n], c = segCtl(pts, i);
      const fa = (a[2] || 0) * amt, fb = (b[2] || 0) * amt;
      if (fa < 0.5 && fb < 0.5) { p.bezierCurveTo(c[0], c[1], c[2], c[3], b[0], b[1]); continue; }
      const m = Math.max(2, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 4.2));
      let px = a[0], py = a[1];
      for (let j = 1; j <= m; j++) {
        const u = j / m, v = 1 - u;
        const x = v * v * v * a[0] + 3 * v * v * u * c[0] + 3 * v * u * u * c[2] + u * u * u * b[0];
        const y = v * v * v * a[1] + 3 * v * v * u * c[1] + 3 * v * u * u * c[3] + u * u * u * b[1];
        let dx = x - px, dy = y - py;
        const l = Math.hypot(dx, dy) || 1;
        dx /= l; dy /= l;
        const nx = dy * sg, ny = -dx * sg;
        const hv = hash(seed * 7.3 + i * 13 + j * 2.7);
        const L = lerp(fa, fb, u - 0.5 / m) * (0.35 + 1.05 * hv * hv);
        const sw = Math.sin(t * 2.3 + i * 1.7 + j) * 0.22;
        const tx = (px + x) / 2 + (nx + (swx + sw) * 0.75) * L, ty = (py + y) / 2 + (ny + swy * 0.75) * L;
        p.quadraticCurveTo(px + nx * L * 0.95 + (tx - px) * 0.15, py + ny * L * 0.95 + (ty - py) * 0.15, tx, ty);
        p.quadraticCurveTo(x + (tx - x) * 0.18 + nx * L * 0.12, y + (ty - y) * 0.18 + ny * L * 0.12, x, y);
        px = x; py = y;
      }
    }
    p.closePath();
    return p;
  }
  /** Bounding box of control points. */
  function boxOf(pts, pad) {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const q of pts) { if (q[0] < x0) x0 = q[0]; if (q[0] > x1) x1 = q[0]; if (q[1] < y0) y0 = q[1]; if (q[1] > y1) y1 = q[1]; }
    pad = pad || 0;
    return [x0 - pad, y0 - pad, x1 + pad, y1 + pad];
  }
  /** Closed outline points around a chain of joints (tapered tube), fuzz f on every point. */
  function tube(joints, widths, f) {
    const n = joints.length, L = [], R = [];
    for (let i = 0; i < n; i++) {
      const a = joints[Math.max(0, i - 1)], b = joints[Math.min(n - 1, i + 1)];
      let dx = b[0] - a[0], dy = b[1] - a[1];
      const l = Math.hypot(dx, dy) || 1;
      dx /= l; dy /= l;
      const w = widths[Math.min(i, widths.length - 1)] / 2;
      L.push([joints[i][0] - dy * w, joints[i][1] + dx * w, f]);
      R.push([joints[i][0] + dy * w, joints[i][1] - dx * w, f]);
    }
    const e = joints[n - 1], d = joints[n - 2], el = Math.hypot(e[0] - d[0], e[1] - d[1]) || 1;
    const we = widths[Math.min(n - 1, widths.length - 1)] * 0.4;
    const cap = [e[0] + (e[0] - d[0]) / el * we, e[1] + (e[1] - d[1]) / el * we, f];
    return L.concat([cap], R.reverse());
  }

  // ---------- Painting ----------
  /** Fill a path, run inner() clipped to it, add an inner edge shade and the outline. */
  function paint(ctx, X, path, fill, inner, lw, edgeW) {
    ctx.fillStyle = fill;
    ctx.fill(path);
    ctx.save();
    ctx.clip(path);
    if (inner) inner();
    ctx.lineWidth = edgeW || 7;
    ctx.strokeStyle = X.P.edge;
    ctx.stroke(path);
    ctx.restore();
    ctx.lineWidth = lw || LW;
    ctx.strokeStyle = X.P.ink;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke(path);
  }
  /** Body gradient: lit back, base colour, then the countershaded belly. */
  function bodyGrad(ctx, P, y0, y1, bellyAt) {
    const b = bellyAt == null ? 0.72 : bellyAt;
    return H.linear(ctx, 0, y0, 0, y1, [[0, P.hi], [0.35, P.body], [b, P.body], [Math.min(0.97, b + 0.16), P.bellyMix], [1, P.belly]]);
  }

  const furCache = new Map();
  function furData(seed, n) {
    const key = seed * 977 + n;
    let d = furCache.get(key);
    if (!d) {
      const r = H.rng(seed * 53 + 11);
      d = new Float32Array(n * 4);
      for (let i = 0; i < d.length; i++) d[i] = r();
      furCache.set(key, d);
    }
    return d;
  }
  /**
   * Fur texture: n short curved strokes over a box, flowing along angle ang (call inside a clip).
   * Two thirds dark, one third light. curl bends each stroke.
   */
  function fur(ctx, P, seed, x0, y0, x1, y1, n, len, ang, w, curl, colD, colL) {
    const d = furData(seed, n), W = x1 - x0, Hh = y1 - y0;
    ctx.lineCap = 'round';
    ctx.lineWidth = w;
    for (let pass = 0; pass < 2; pass++) {
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        if ((i % 3 === 0) !== (pass === 1)) continue;
        const x = x0 + d[i * 4] * W, y = y0 + d[i * 4 + 1] * Hh, l = len * (0.6 + 0.8 * d[i * 4 + 2]);
        const a = ang + (d[i * 4 + 3] - 0.5) * 0.7, ca = Math.cos(a), sa = Math.sin(a);
        const c = (curl == null ? 0.3 : curl) * l;
        ctx.moveTo(x, y);
        ctx.quadraticCurveTo(x + ca * l * 0.5 - sa * c, y + sa * l * 0.5 + ca * c, x + ca * l, y + sa * l);
      }
      ctx.strokeStyle = pass ? (colL || P.furL) : (colD || P.furD);
      ctx.stroke();
    }
  }
  /** Soft snow caps along a top line (call inside the body clip so only the lower halves show). */
  function snowCaps(ctx, X, pts, r) {
    const P = X.P;
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const q = pts[i], rr = r * (0.55 + 0.6 * hash(X.seed + i * 3.3));
      ctx.moveTo(q[0] + rr, q[1] - r * 0.1);
      ctx.ellipse(q[0], q[1] - r * 0.1, rr, rr * 0.42, 0, 0, TAU);
    }
    ctx.fillStyle = P.snowShade;
    ctx.fill();
    ctx.translate(0, -r * 0.18);
    ctx.fillStyle = P.snow;
    ctx.fill();
    ctx.translate(0, r * 0.18);
  }
  /** A few snow flakes resting on top of the outline (after the outline is drawn). */
  function snowTop(ctx, X, pts, r) {
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const q = pts[i], rr = r * (0.45 + 0.4 * hash(X.seed * 3 + i * 5.1));
      ctx.moveTo(q[0] + rr, q[1]);
      ctx.ellipse(q[0], q[1], rr, rr * 0.5, 0, 0, TAU);
    }
    ctx.fillStyle = X.P.snow;
    ctx.fill();
  }
  /** Light rim stroke along a polyline (back line), inside the clip. */
  function rim(ctx, X, pts, w) {
    H.smooth(ctx, pts, false, 0.5);
    ctx.lineWidth = w || 2.6;
    ctx.strokeStyle = X.P.rim;
    ctx.lineCap = 'round';
    ctx.stroke();
  }
  /** Radial highlight blob (muscle sheen), inside a clip. */
  function sheen(ctx, x, y, r, a) {
    ctx.fillStyle = H.radial(ctx, x, y, 0, r, [[0, `rgba(255,250,236,${a || 0.28})`], [1, 'rgba(255,250,236,0)']]);
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  /** Pulsing glowing marking (Alpha stage). segs = array of polylines. */
  /** Glow pulse: gentle breathing for Alphas, fast and bright flicker while charging a super attack. */
  const glowPulse = X => (0.72 + 0.28 * Math.sin(X.t * (3.2 + X.pow * 10))) * (1 + X.pow * 0.6);
  function glowLines(ctx, X, segs, w) {
    const P = X.P, pulse = glowPulse(X);
    w *= 1 + X.pow * 0.35;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (const s of segs) { ctx.moveTo(s[0][0], s[0][1]); for (let i = 1; i < s.length; i++) ctx.lineTo(s[i][0], s[i][1]); }
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = H.rgba(P.glow, Math.min(1, 0.28 * pulse)); ctx.lineWidth = w * 3.4; ctx.stroke();
    ctx.strokeStyle = H.rgba(P.glow, Math.min(1, 0.55 * pulse)); ctx.lineWidth = w * 1.9; ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = P.glowCore; ctx.lineWidth = w; ctx.stroke();
    ctx.restore();
  }
  /** Pale battle scars (Alpha stage). */
  function scarLines(ctx, X, segs, w) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (const s of segs) { ctx.moveTo(s[0][0], s[0][1]); for (let i = 1; i < s.length; i++) ctx.lineTo(s[i][0], s[i][1]); }
    ctx.strokeStyle = 'rgba(70,30,22,.38)'; ctx.lineWidth = w * 2; ctx.stroke();
    ctx.strokeStyle = X.P.scar; ctx.lineWidth = w; ctx.stroke();
    ctx.restore();
  }
  /** Three parallel claw-mark scars centred on (x, y) at angle a. */
  function clawScars(ctx, X, x, y, a, len, w) {
    const c = Math.cos(a), s = Math.sin(a), segs = [];
    for (let i = -1; i <= 1; i++) {
      const ox = -s * i * w * 2.6, oy = c * i * w * 2.6, l = len * (1 - Math.abs(i) * 0.18);
      segs.push([[x + ox - c * l / 2, y + oy - s * l / 2], [x + ox + c * l / 2, y + oy + s * l / 2]]);
    }
    scarLines(ctx, X, segs, w);
  }

  /** Eye with blink, squeeze (hurt) and angry brow. opt: { iris, pupil, lid, brow } (mammal eye by default). */
  function eye(ctx, X, x, y, r, opt) {
    const P = X.P;
    opt = opt || {};
    ctx.save();
    if (X.hurt) {
      H.ellipse(ctx, x, y, r * 1.3, r * 1.05);
      ctx.fillStyle = 'rgba(20,12,6,.35)';
      ctx.fill();
      ctx.strokeStyle = P.ink; ctx.lineWidth = Math.max(0.8, r * 0.5); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(x - r * 1.1, y - r * 0.75); ctx.lineTo(x + r * 0.7, y); ctx.lineTo(x - r * 1.1, y + r * 0.75); ctx.stroke();
    } else if (X.blink) {
      H.ellipse(ctx, x, y, r * 1.2, r * 1.0);
      ctx.fillStyle = opt.lid || P.dark;
      ctx.fill();
      ctx.strokeStyle = P.ink; ctx.lineWidth = Math.max(0.8, r * 0.38); ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(x, y - r * 0.5, r * 1.05, 0.45, PI - 0.45); ctx.stroke();
    } else {
      if (opt.iris) H.eye(ctx, x, y, r, { iris: opt.iris, pupil: opt.pupil || 'round' });
      else H.eye(ctx, x, y, r, { mammal: true });
      ctx.strokeStyle = H.rgba(P.ink, 0.8); ctx.lineWidth = Math.max(0.7, r * 0.34); ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(x, y + r * 0.25, r * 1.18, PI + 0.35, TAU - 0.2); ctx.stroke();
    }
    if (opt.brow !== false && (X.angry || X.hurt)) {
      ctx.strokeStyle = opt.browCol || P.lo; ctx.lineWidth = r * 0.75; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(x - r * 1.6, y - r * 1.6); ctx.quadraticCurveTo(x, y - r * 1.9, x + r * 1.5, y - r * 0.8); ctx.stroke();
    }
    ctx.restore();
  }

  // ---------- Legs and feet ----------
  /** Two-bone IK from a to b. dir +1 bends the middle joint forward (+x) for a downward chain. */
  function ik2(ax, ay, bx, by, l1, l2, dir) {
    let dx = bx - ax, dy = by - ay, d = Math.hypot(dx, dy) || 0.001;
    const mx = (l1 + l2) * 0.995, mn = Math.abs(l1 - l2) + 0.5;
    if (d > mx) { dx *= mx / d; dy *= mx / d; d = mx; } else if (d < mn) { dx *= mn / d; dy *= mn / d; d = mn; }
    const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    const ux = dx / d, uy = dy / d;
    return [ax + ux * a + uy * h * dir, ay + uy * a - ux * h * dir, ax + dx, ay + dy];
  }
  /** Foreleg joints: shoulder → elbow (bends back) → wrist → foot. pa = pastern slant (rad, wrist behind foot). */
  function foreLeg(sh, fx, fy, l1, l2, pas, pa) {
    const wx = fx - Math.sin(pa) * pas, wy = fy - Math.cos(pa) * pas;
    const k = ik2(sh[0], sh[1], wx, wy, l1, l2, -1);
    const f = [k[2] + Math.sin(pa) * pas, k[3] + Math.cos(pa) * pas];
    return [sh, [k[0], k[1]], [k[2], k[3]], f];
  }
  /** Hind leg joints: hip → knee (bends forward) → hock → foot. ma = metatarsus slant (hock behind foot). */
  function hindLeg(hp, fx, fy, l1, l2, meta, ma) {
    const hx = fx - Math.sin(ma) * meta, hy = fy - Math.cos(ma) * meta;
    const k = ik2(hp[0], hp[1], hx, hy, l1, l2, 1);
    const f = [k[2] + Math.sin(ma) * meta, k[3] + Math.cos(ma) * meta];
    return [hp, [k[0], k[1]], [k[2], k[3]], f];
  }
  /** Draws a leg tube through joints J (first joint extended upwards into the body). */
  function legTube(ctx, X, J, widths, fill, near) {
    const top = [J[0][0], J[0][1] - widths[0] * 0.45];
    const n = J.length, a = J[n - 2], e = J[n - 1], l = Math.hypot(e[0] - a[0], e[1] - a[1]) || 1;
    const pull = Math.min(l * 0.6, widths[widths.length - 1] * 0.38);
    const end = [e[0] - (e[0] - a[0]) / l * pull, e[1] - (e[1] - a[1]) / l * pull];
    H.limb(ctx, [top].concat(J.slice(0, n - 1), [end]), widths, fill, X.P.ink, LW);
    if (near) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255,248,232,.2)';
      ctx.lineWidth = widths[1] * 0.2;
      ctx.lineCap = 'round';
      const m = lerpPt(J[0], J[1], 0.5);
      ctx.beginPath();
      ctx.moveTo(J[0][0] + widths[1] * 0.22, J[0][1]);
      ctx.quadraticCurveTo(m[0] + widths[1] * 0.3, m[1], J[1][0] + widths[2] * 0.2, J[1][1]);
      ctx.stroke();
      ctx.restore();
    }
  }
  /** Rounded paw on the ground at (x, y), toes forward, with claws (len cl). */
  function paw(ctx, X, x, y, w, fill, cl) {
    const P = X.P;
    H.ellipse(ctx, x + w * 0.28, y - w * 0.3, w * 0.66, w * 0.36);
    H.fillStroke(ctx, fill, P.ink, LW * 0.8);
    ctx.strokeStyle = H.rgba(P.ink, 0.6);
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(x + w * 0.42, y - w * 0.56); ctx.lineTo(x + w * 0.5, y - w * 0.12);
    ctx.moveTo(x + w * 0.66, y - w * 0.5); ctx.lineTo(x + w * 0.74, y - w * 0.12);
    ctx.stroke();
    if (cl > 0.3) {
      ctx.fillStyle = P.claw;
      for (let i = 0; i < 3; i++) {
        const cx = x + w * (0.5 + i * 0.2), cy = y - w * 0.08;
        ctx.beginPath();
        ctx.moveTo(cx - cl * 0.35, cy - cl * 0.5);
        ctx.quadraticCurveTo(cx + cl * 0.8, cy - cl * 0.6, cx + cl * 0.75, cy + 0.4);
        ctx.lineTo(cx - cl * 0.1, cy);
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  /** Muscle crease: soft dark line with a light edge (inside a clip). */
  function crease(ctx, X, pts, w) {
    H.smooth(ctx, pts, false, 0.5);
    ctx.lineCap = 'round';
    ctx.lineWidth = w || 1.6;
    ctx.strokeStyle = H.rgba(X.P.ink, 0.22);
    ctx.stroke();
    ctx.save();
    ctx.translate(-0.9, -0.9);
    H.smooth(ctx, pts, false, 0.5);
    ctx.strokeStyle = 'rgba(255,250,236,.16)';
    ctx.stroke();
    ctx.restore();
  }
  /** Copy of head-local points with the muzzle (x > x0) shortened/lengthened by k (cached per key). */
  const snoutCache = new Map();
  function snout(key, pts, k, x0) {
    const kk = key + '|' + k;
    let r = snoutCache.get(kk);
    if (!r) { r = pts.map(p => [p[0] > x0 ? x0 + (p[0] - x0) * k : p[0], p[1], p[2] || 0]); snoutCache.set(kk, r); }
    return r;
  }

  // =====================================================================================================
  // WOLF — direwolf: heavy wolf, thick fur, bushy tail, snarling muzzle.
  // =====================================================================================================
  const WOLF_HEAD = [[-15, -2, 0.8], [-11, -12, 0.3], [0, -16.5, 0], [10, -15.5, 0], [16, -11, 0], [25, -9, 0], [34, -7, 0],
    [39.5, -4.5, 0], [40, -0.5, 0], [35, 2.5, 0], [22, 4, 0], [11, 5.5, 0], [3, 12.5, 0.9], [-9, 11.5, 0.9]];
  const WOLF_JAW = [[4, 2], [20, 3.5], [32, 3], [33, 5.6], [27, 8.6], [15, 11], [5, 9]];
  const WOLF_EAR = [[-10, -9], [-8, -20], [-5, -30], [-1, -21], [3, -12]];

  function wolf(ctx, sp, o) {
    const X = poseOf(o, sp, 7.5), S = X.S, P = X.P, st = X.st;
    const lk = S.leg, hipH = 52, drop = hipH * (1 - lk);
    const lg = X.lg, rc = X.rc;
    const dx = lg * 18 - rc * 9;
    const pitch = lg * 0.06 - rc * 0.1 + (X.pose === 'eat' ? 0.06 : 0) + (X.pose === 'roar' ? -0.05 : 0);
    const B = bodyFrame(-34, -52, pitch, dx, drop + X.bob - (X.pose === 'attack' ? Math.max(0, lg) * 6 : 0));
    const yc = -46, chub = S.chub, bl = S.len * 0.94;
    const R = (x, y, f) => B(x * bl, yc + (y - yc) * chub - 8, f);
    const b = X.br * 0.9;

    // ---- head placement
    let hp = [42, -69], ha = 0.1 + X.look * 0.1;
    if (X.walking) ha += Math.sin(X.ph * 2) * 0.03;
    if (X.pose === 'attack') { ha += lg * 0.2; hp = [42 + lg * 6, -69 + lg * 5]; }
    else if (X.hurt) { ha -= rc * 0.45; hp = [42 - rc * 3, -69 - rc * 2]; }
    else if (X.pose === 'eat') { ha = 1.12 + Math.sin(X.t * 9) * 0.04; hp = [47, -34]; }
    else if (X.pose === 'roar') { ha = -0.85; hp = [40, -74]; }
    const hs = S.head * 1.08;
    const HP = R(hp[0] / bl, hp[1]);
    let HA = ha + pitch;
    HA = clampHead(HP, HA, hs, [[12 + 28 * S.snout, 1], [12 + 22 * S.snout, 10], [8, 13]]);
    const hx = headFrame(HP, HA, hs);

    // ---- legs: all four emerge from under the body (far pair darker)
    const ws = 0.9 + 0.1 * chub;
    const gF = gait(X, 0, 10 * lk, 6 * lk), gH = gait(X, PI, 10 * lk, 6 * lk);
    const drawLeg = (front, near, x, ph) => {
      const g = gait(X, ph, 10 * lk, 6 * lk);
      const fy = (near ? 0 : -1.5) - g[1];
      const fx = x * bl + g[0] + (front ? dx * 1.05 + (X.pose === 'eat' ? 3 : 0) : dx * 0.45);
      const lift = front && X.pose === 'attack' ? Math.max(0, lg) * 12 : 0;
      const fill = near ? P.leg : P.far;
      if (front) {
        const J = foreLeg(R(x * 0.85 + 2, -40), fx, fy - lift, 19 * lk, 22.5 * lk, 8 * lk, 0.22 + g[1] * 0.06);
        legTube(ctx, X, J, [15 * ws, 13 * ws, 9.5 * ws, 7 * ws, 6.4 * ws], fill, false);
        paw(ctx, X, J[3][0] - 2.5, J[3][1], 8 * ws, fill, 2.2 * S.feat + 0.6);
      } else {
        const J = hindLeg(R(x * 0.95, -42), fx, fy, 20 * lk, 20 * lk, 16 * lk, 0.42);
        legTube(ctx, X, J, [19 * ws, 15 * ws, 9.5 * ws, 7 * ws, 6.4 * ws], fill, false);
        paw(ctx, X, J[3][0] - 2.5, J[3][1], 8 * ws, fill, 2 * S.feat + 0.5);
      }
    };
    drawLeg(true, false, 24, PI);
    drawLeg(false, false, -29, 0);

    // ---- tail (bushy, behind the body)
    const tb = R(-46, -52);
    let ta = PI - 0.8 + Math.sin(X.t * 2.1) * 0.07;
    if (X.walking) ta += Math.sin(X.ph) * 0.08;
    if (X.angry) ta = PI - 0.25 + Math.sin(X.t * 9) * 0.05;
    if (X.hurt) ta = PI - 1.3;
    const tl = 40 * S.tail, TJ = [tb];
    {
      let a = ta, x = tb[0], y = tb[1];
      for (let i = 1; i <= 4; i++) {
        a += 0.12 + Math.sin(X.t * 2.4 - i * 0.8) * 0.05;
        x += Math.cos(a) * tl / 4; y += Math.sin(a) * tl / 4;
        TJ.push([x, y]);
      }
      const tw = S.fluff;
      const path = shape(tube(TJ, [9 * tw, 13 * tw, 14 * tw, 11 * tw, 6 * tw], 1), 2.6 * S.fluff, X.seed + 5, X.t, -0.3, 0.5);
      const bx = boxOf(TJ, 12);
      paint(ctx, X, path, P.body, () => {
        H.ellipse(ctx, TJ[4][0], TJ[4][1], 10, 8, a);
        ctx.fillStyle = H.rgba(st === 0 ? P.dark : P.acc, 0.7);
        ctx.fill();
        fur(ctx, P, X.seed + 9, bx[0], bx[1], bx[2], bx[3], 30, 4.5, a + 0.25, 0.9, 0.12);
      });
    }

    drawLeg(false, true, -36, PI);
    drawLeg(true, true, 31, 0);

    // ---- body: back, neck into the head base, deep chest, elbow, tucked belly, thigh
    const fs = gF[0] * 0.35 + dx * 0.3, hsx = gH[0] * 0.35;
    const pts = [
      R(-46, -53, 0.35), R(-28, -58, 0.3), R(-8, -57, 0.35), R(10, -61, 0.55), R(24, -66, 0.85),
      hx(-18, -7, 0.95), hx(-9, 15, 0.95),
      R(44, -44, 0.85), R(40 + fs, -30, 0.7), R(32 + fs, -21, 0.5), R(22 + fs, -24 + b, 0.45),
      R(8, -30 + b, 0.45), R(-10, -32 + b, 0.4), R(-20 + hsx, -28, 0.35), R(-30 + hsx, -21, 0.35),
      R(-44 + hsx, -27, 0.35), R(-52, -42, 0.3),
    ];
    const box = boxOf(pts, 6);
    const body = shape(pts, 2.4 * S.fluff, X.seed, X.t, -0.5, 0.65);
    paint(ctx, X, body, bodyGrad(ctx, P, box[1], box[3], 0.68), () => {
      // dark saddle on the back, darker mane on the Alpha
      let q = R(-12, -57);
      H.ellipse(ctx, q[0], q[1], 34 * bl, 8 * chub, pitch);
      ctx.fillStyle = H.rgba(P.acc, [0.2, 0.38, 0.5, 0.72][st]);
      ctx.fill();
      q = R(22, -61);
      H.ellipse(ctx, q[0], q[1], 19, 11, pitch - 0.5);
      ctx.fillStyle = H.rgba(P.mane, st === 3 ? 0.75 : 0.3);
      ctx.fill();
      q = R(28, -40); sheen(ctx, q[0], q[1], 15, 0.2);
      q = R(-34, -42); sheen(ctx, q[0], q[1], 16, 0.2);
      fur(ctx, P, X.seed, box[0], box[1], box[2], box[3], 150, 5, PI - 0.5, 0.95, 0.05);
      crease(ctx, X, [R(18, -52), R(20 + fs * 0.5, -38), R(24 + fs, -26)], 1.6);
      crease(ctx, X, [R(-20, -52), R(-17 + hsx * 0.5, -40), R(-22 + hsx, -29)], 1.6);
      rim(ctx, X, [R(-46, -53), R(-28, -57.5), R(-8, -56.5), R(10, -60.5), R(24, -65)], 2.4);
      snowCaps(ctx, X, [R(-34, -57), R(-16, -58), R(2, -59), R(14, -61.5)], 5.5);
      if (st === 3) { q = R(-4, -42); clawScars(ctx, X, q[0], q[1], 0.9, 13, 0.9); }
      if (X.glowOn) glowLines(ctx, X, [[R(16, -55), R(22, -48), R(16, -41)], [R(8, -55), R(14, -48), R(8, -41)], [R(0, -55), R(6, -48), R(0, -41)]], 1.5);
    });

    // ---- head
    ctx.save();
    ctx.translate(HP[0], HP[1]);
    ctx.rotate(HA);
    ctx.scale(hs, hs);
    wolfHead(ctx, X);
    ctx.restore();
  }

  function wolfHead(ctx, X) {
    const P = X.P, S = X.S, st = X.st, lw = LW / S.head, k = S.snout;
    const sx = x => (x > 12 ? 12 + (x - 12) * k : x);
    const earA = X.angry || X.hurt ? -0.55 : Math.sin(X.t * 1.3) * 0.06 + (Math.sin(X.t * 0.37 + X.seed) > 0.95 ? -0.2 : 0);
    const earS = st === 0 ? 1.12 : 1;
    const ear = (dx, fill, inner) => {
      ctx.save();
      ctx.translate(-4 + dx, -11);
      ctx.rotate(earA);
      ctx.scale(earS, earS);
      ctx.translate(4, 11);
      H.smooth(ctx, WOLF_EAR, true, 0.35);
      H.fillStroke(ctx, fill, P.ink, lw);
      if (inner) {
        H.smooth(ctx, [[-7, -11], [-5.5, -20], [-4.5, -26], [-1.5, -19], [0, -12]], true, 0.35);
        ctx.fillStyle = 'rgba(70,40,36,.75)';
        ctx.fill();
        fur(ctx, P, 7, -8, -24, 1, -11, 8, 3, -1.2, 0.7, 0.2, 'rgba(240,230,215,.55)', 'rgba(240,230,215,.55)');
      }
      ctx.restore();
    };
    ear(5, P.far, false);
    // mouth + lower jaw (rotates about the hinge at (7, 4))
    const ja = X.jw * (X.pose === 'roar' ? 0.5 : 0.62);
    const c = Math.cos(ja), s = Math.sin(ja);
    const J = (x, y) => [7 + (sx(x) - 7) * c - (y - 4) * s, 4 + (sx(x) - 7) * s + (y - 4) * c];
    const tk = S.teeth;
    if (ja > 0.04) {
      const a = J(32, 3), e = J(20, 3.5);
      H.poly(ctx, [[7, 4], [sx(22), 4], [sx(35), 2.5], a, e], true);
      H.fillStroke(ctx, P.mouth, P.ink, lw);
      const tg = J(22, 6);
      H.ellipse(ctx, tg[0], tg[1] - 1.5, 8 * k, 2.4, ja);
      ctx.fillStyle = P.tongue;
      ctx.fill();
    }
    if (tk > 0.2) {
      H.teeth(ctx, sx(14), 4.2, sx(36), 2.6, 6, 2.2 * tk, false, P.tooth);
      H.poly(ctx, [[sx(31) - 1.4, 3], [sx(31), 3 + 7 * tk], [sx(31) + 1.4, 3]], true);
      H.fillStroke(ctx, P.tooth, 'rgba(60,40,20,.6)', 0.7);
    }
    H.smooth(ctx, WOLF_JAW.map(p => J(p[0], p[1])), true, 0.4);
    H.fillStroke(ctx, H.mix(P.body, P.belly, 0.45), P.ink, lw);
    if (tk > 0.2 && ja > 0.04) {
      const a = J(16, 3.4), e = J(31, 3.1), cc = J(29, 3);
      H.teeth(ctx, a[0], a[1], e[0], e[1], 5, 2 * tk, true, P.tooth);
      H.poly(ctx, [[cc[0] - 1.3, cc[1]], [cc[0] + 0.2, cc[1] - 6 * tk], [cc[0] + 1.6, cc[1]]], true);
      H.fillStroke(ctx, P.tooth, 'rgba(60,40,20,.6)', 0.7);
    }
    // upper head
    const head = shape(snout('wolf', WOLF_HEAD, k, 12), 3 * S.fluff, X.seed + 3, X.t, -0.6, 0.6);
    paint(ctx, X, head, H.volume(ctx, P.body, -16, 13), () => {
      H.ellipse(ctx, 14, 9.5, 20, 6.5, -0.05);
      ctx.fillStyle = P.belly;
      ctx.fill();
      H.ellipse(ctx, 2, 10, 9, 6);
      ctx.fillStyle = H.rgba(P.belly, 0.85);
      ctx.fill();
      H.ellipse(ctx, sx(26), -11.5, 16 * k, 4, 0.12);
      ctx.fillStyle = H.rgba(P.lo, 0.35);
      ctx.fill();
      H.ellipse(ctx, 6, -11, 7, 3.5, 0.3);
      ctx.fillStyle = H.rgba(P.belly, 0.3);
      ctx.fill();
      fur(ctx, P, X.seed + 21, -16, -16, 20, 12, 26, 3.6, PI - 0.4, 0.9, 0.3);
      if (X.angry) {
        ctx.strokeStyle = H.rgba(P.ink, 0.55); ctx.lineWidth = 0.9;
        ctx.beginPath();
        for (const wx of [21, 25, 29]) { ctx.moveTo(sx(wx), -8.5); ctx.quadraticCurveTo(sx(wx) + 2, -5.5, sx(wx) + 1, -3); }
        ctx.stroke();
      }
      if (st === 3) { scarLines(ctx, X, [[[6, -16], [11, -7], [13, -1]]], 0.9); }
      if (X.glowOn) glowLines(ctx, X, [[[15, -5], [5, -2], [-5, -4]]], 1.1);
    }, lw, 5);
    // snarl: lifted lip shows gums and teeth over the face
    if (X.angry && tk > 0.2) {
      H.smooth(ctx, [[13, 4], [sx(22), 1.5], [sx(33), 0], [sx(37), 1.5], [sx(33), 3.4], [sx(22), 4.2]], true, 0.4);
      H.fillStroke(ctx, P.gum, P.ink, lw * 0.6);
      H.teeth(ctx, sx(14), 3.6, sx(36), 2.4, 6, 2.4 * tk, false, P.tooth);
      H.poly(ctx, [[sx(31) - 1.5, 2.6], [sx(31), 3 + 7.5 * tk], [sx(31) + 1.5, 2.6]], true);
      H.fillStroke(ctx, P.tooth, 'rgba(60,40,20,.6)', 0.7);
    }
    // nose, mouth line, eye, near ear
    const nx = sx(38.6);
    H.ellipse(ctx, nx, -3, 3.4, 2.7, 0.2);
    ctx.fillStyle = P.nose;
    ctx.fill();
    H.ellipse(ctx, nx - 0.6, -4.2, 1.2, 0.7);
    ctx.fillStyle = 'rgba(255,255,255,.45)';
    ctx.fill();
    ctx.strokeStyle = H.rgba(P.ink, 0.7); ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(sx(35), 2.6); ctx.quadraticCurveTo(sx(26), 4.4, 12, 5.5); ctx.stroke();
    eye(ctx, X, 12.5, -8, 2.5 * S.eye, { iris: st === 3 ? '#ffd05a' : '#e0a83a', pupil: 'round' });
    ear(0, P.body, true);
  }
  register('wolf', wolf, { bounds: [-99, -130, 114, 3], shadowW: 110 });

  // =====================================================================================================
  // CAT — smilodon: muscular big cat, high shoulders, bobbed tail, long saber canines; attack = pounce.
  // =====================================================================================================
  const CAT_HEAD = [[-15, -2, 0.6], [-11, -12, 0.2], [0, -17, 0], [12, -16, 0], [20, -11.5, 0], [27, -7.5, 0], [31.5, -3.5, 0],
    [31.5, 1, 0], [27.5, 4, 0], [18, 5, 0], [8, 6, 0], [1, 11, 0.7], [-10, 9.5, 0.7]];
  const CAT_JAW = [[0, 4], [14, 5], [24, 5], [25, 8], [19, 11.5], [7, 12.5], [-1, 9]];

  function cat(ctx, sp, o) {
    const X = poseOf(o, sp, 7), S = X.S, P = X.P, st = X.st;
    const lk = S.leg, hipH = 50, drop = hipH * (1 - lk);
    const lg = X.lg, rc = X.rc, atk = X.pose === 'attack';
    const leap = atk ? Math.max(0, lg) : 0, crouch = atk ? Math.max(0, -lg) / 0.3 : 0;
    const dx = lg * 24 - rc * 9;
    const pitch = crouch * 0.05 - leap * 0.2 - rc * 0.1 + (X.pose === 'eat' ? 0.05 : 0) + (X.pose === 'roar' ? -0.06 : 0);
    const B = bodyFrame(-36, -48, pitch, dx, drop + X.bob + crouch * 9 - leap * 14);
    const yc = -50, chub = S.chub, bl = S.len * 0.95;
    const R = (x, y, f) => B(x * bl, yc + (y - yc) * chub, f);
    const b = X.br * 0.9;

    // ---- head placement
    let hp = [44, -76], ha = 0.12 + X.look * 0.1;
    if (X.walking) ha += Math.sin(X.ph * 2) * 0.03;
    if (atk) { ha += crouch * 0.15 - leap * 0.2; hp = [44 + leap * 5, -76 + crouch * 4]; }
    else if (X.hurt) { ha -= rc * 0.45; hp = [44 - rc * 3, -76 - rc * 2]; }
    else if (X.pose === 'eat') { ha = 1.1 + Math.sin(X.t * 9) * 0.04; hp = [50, -42]; }
    else if (X.pose === 'roar') { ha = -0.55; hp = [44, -80]; }
    const hs = S.head * 1.26;
    const HP = R(hp[0] / bl, hp[1]);
    let HA = ha + pitch;
    HA = clampHead(HP, HA, hs, [[12 + 20 * S.snout, 2], [12 + 12 * S.snout, 12], [24, 5 + 20 * S.feat]]);
    const hx = headFrame(HP, HA, hs);

    // ---- legs
    const ws = 0.9 + 0.1 * chub;
    const cl = 1.2 + 1.6 * S.feat + leap * 3;
    const gF = gait(X, 0, 9 * lk, 6 * lk), gH = gait(X, PI, 9 * lk, 6 * lk);
    const drawLeg = (front, near, x, ph) => {
      const g = gait(X, ph, 9 * lk, 6 * lk);
      let fy = (near ? 0 : -1.5) - g[1];
      let fx = x * bl + g[0] + (front ? dx * (atk ? 0.6 : 1.05) + (X.pose === 'eat' ? 3 : 0) : dx * 0.35);
      const fill = near ? P.leg : P.far;
      if (front) {
        const sh = R(x * 0.85 + 3, -46);
        if (leap > 0) { // paws reach forward with claws out
          const r = smoothstep(leap * 1.3);
          fx = lerp(fx, sh[0] + 30 + (near ? 4 : 0), r);
          fy = lerp(fy, sh[1] + 12 + (near ? 0 : -4), r);
        }
        const J = foreLeg(sh, fx, fy, 20 * lk, 21 * lk, 7 * lk, 0.2 + g[1] * 0.06 - leap * 0.5);
        legTube(ctx, X, J, [19 * ws, 17 * ws, 12.5 * ws, 9 * ws, 8.5 * ws], fill, false);
        paw(ctx, X, J[3][0] - 3, J[3][1], 10.5 * ws, fill, cl);
      } else {
        const J = hindLeg(R(x * 0.95, -46), fx, fy, 21 * lk, 20 * lk, 15 * lk, 0.42 + leap * 0.3);
        legTube(ctx, X, J, [21 * ws, 17 * ws, 10.5 * ws, 8.5 * ws, 8 * ws], fill, false);
        paw(ctx, X, J[3][0] - 3, J[3][1], 9.5 * ws, fill, 1 + S.feat);
      }
    };
    drawLeg(true, false, 26, PI);
    drawLeg(false, false, -32, 0);

    // ---- bobbed tail
    {
      const tb = R(-52, -56);
      let a = PI - 0.75 + Math.sin(X.t * 1.8) * 0.12 + (X.angry ? -0.5 + Math.sin(X.t * 12) * 0.1 : 0) + (X.hurt ? -0.5 : 0);
      const TJ = [tb], tl = 17 * S.tail;
      let x = tb[0], y = tb[1];
      for (let i = 1; i <= 2; i++) { a += 0.2; x += Math.cos(a) * tl / 2; y += Math.sin(a) * tl / 2; TJ.push([x, y]); }
      const path = shape(tube(TJ, [10, 8.5, 6], 0.3), 2 * S.fluff, X.seed + 5, X.t, -0.3, 0.5);
      paint(ctx, X, path, P.body, () => {
        H.ellipse(ctx, TJ[2][0], TJ[2][1], 6, 6);
        ctx.fillStyle = H.rgba(P.acc, 0.8);
        ctx.fill();
      });
    }

    drawLeg(false, true, -39, PI);
    drawLeg(true, true, 33, 0);

    // ---- body
    const fs = gF[0] * 0.35 + (atk ? leap * 8 : 0), hsx = gH[0] * 0.35;
    const pts = [
      R(-46, -58, 0.05), R(-30, -62, 0.03), R(-10, -64, 0.05), R(12, -71, 0.12), R(26, -74, 0.3),
      hx(-14, -8, 0.5), hx(-8, 13, 0.7),
      R(47, -50, 0.6), R(43 + fs, -36, 0.5), R(34 + fs, -26, 0.3), R(23 + fs, -30 + b, 0.35),
      R(8, -36 + b, 0.45), R(-10, -38 + b, 0.45), R(-22 + hsx, -35, 0.3), R(-29 + hsx, -27, 0.15),
      R(-40 + hsx, -24, 0.15), R(-51 + hsx, -31, 0.15), R(-56, -47, 0.15),
    ];
    const box = boxOf(pts, 6);
    const body = shape(pts, 1.9 * S.fluff, X.seed, X.t, -0.4, 0.7);
    paint(ctx, X, body, bodyGrad(ctx, P, box[1], box[3], 0.66), () => {
      if (sp.pattern === 'spots' || st === 0) {
        H.spots(ctx, X.seed * 13 + 1, box[0] + 4, box[1] + 2, box[2] - 6, box[3] - 12, 26, 1.8, [3.2, 3.4, 3.8, 4.6][st], H.rgba(P.acc, [0.35, 0.4, 0.45, 0.62][st]));
      } else if (sp.pattern === 'stripes') {
        H.stripes(ctx, X.seed * 13 + 1, box[0], box[1], box[2], box[3] - 10, 9, 3.5, H.rgba(P.acc, 0.45), 0.2);
      }
      let q = R(20, -66);
      H.ellipse(ctx, q[0], q[1], 22, 10, pitch - 0.4);
      ctx.fillStyle = H.rgba(P.mane, st === 3 ? 0.55 : 0.2);
      ctx.fill();
      q = R(30, -48); sheen(ctx, q[0], q[1], 18, 0.24);
      q = R(-34, -48); sheen(ctx, q[0], q[1], 17, 0.2);
      fur(ctx, P, X.seed, box[0], box[1], box[2], box[3], 110, 3.6, PI - 0.4, 0.85, 0.05);
      crease(ctx, X, [R(18, -58), R(22 + fs * 0.5, -42), R(26 + fs, -30)], 1.8);
      crease(ctx, X, [R(-20, -56), R(-16 + hsx * 0.5, -44), R(-22 + hsx, -32)], 1.8);
      crease(ctx, X, [R(4, -40), R(-6, -42), R(-14, -41)], 1.2);
      rim(ctx, X, [R(-46, -58), R(-30, -61.5), R(-10, -63.5), R(12, -70.5), R(26, -73)], 2.4);
      snowCaps(ctx, X, [R(-36, -60), R(-18, -63), R(0, -66), R(16, -71)], 5);
      if (st === 3) { q = R(-8, -50); clawScars(ctx, X, q[0], q[1], 1.1, 14, 0.9); }
      if (X.glowOn) glowLines(ctx, X, [[R(14, -64), R(18, -56), R(15, -48)], [R(6, -63), R(10, -55), R(7, -47)], [R(-2, -62), R(2, -54), R(-1, -47)]], 1.5);
    });

    ctx.save();
    ctx.translate(HP[0], HP[1]);
    ctx.rotate(HA);
    ctx.scale(hs, hs);
    catHead(ctx, X);
    ctx.restore();
  }

  function catHead(ctx, X) {
    const P = X.P, S = X.S, st = X.st, lw = LW / (S.head * 1.26), k = S.snout;
    const sx = x => (x > 10 ? 10 + (x - 10) * k : x);
    const earA = X.angry || X.hurt ? -0.5 : Math.sin(X.t * 1.1) * 0.05;
    const ear = (dx, fill, inner) => {
      ctx.save();
      ctx.translate(-2 + dx, -13);
      ctx.rotate(earA);
      ctx.scale(st === 0 ? 1.25 : 1, st === 0 ? 1.25 : 1);
      H.smooth(ctx, [[-6, 1], [-6, -7], [-1, -11], [4, -8], [6, 1]], true, 0.5);
      H.fillStroke(ctx, fill, P.ink, lw);
      if (inner) {
        H.smooth(ctx, [[-3.5, 0], [-3.5, -5.5], [-0.5, -8], [2.5, -5], [3.5, 0]], true, 0.5);
        ctx.fillStyle = 'rgba(80,46,40,.7)';
        ctx.fill();
      }
      ctx.restore();
    };
    ear(6, P.far, false);
    const ja = X.jw * (X.pose === 'attack' ? 1.3 : X.pose === 'roar' ? 1.25 : 0.8);
    const c = Math.cos(ja), s = Math.sin(ja);
    const J = (x, y) => [2 + (sx(x) - 2) * c - (y - 5) * s, 5 + (sx(x) - 2) * s + (y - 5) * c];
    const fk = S.feat, saber = 3 + 19 * fk;
    if (ja > 0.04) {
      H.poly(ctx, [[1, 5], [sx(18), 5], [sx(28), 3.5], J(24, 5), J(14, 5)], true);
      H.fillStroke(ctx, P.mouth, P.ink, lw);
      const tg = J(15, 7);
      H.ellipse(ctx, tg[0], tg[1] - 1.5, 7 * k, 2.2, ja);
      ctx.fillStyle = P.tongue;
      ctx.fill();
    }
    // sabers (far one first, behind the jaw)
    const sab = (ox, col) => {
      const x0 = sx(19) + ox, y0 = 4;
      ctx.beginPath();
      ctx.moveTo(x0 - 2.4, y0);
      ctx.quadraticCurveTo(x0 - 1.2, y0 + saber * 0.6, x0 - 2.2 + saber * 0.1, y0 + saber);
      ctx.quadraticCurveTo(x0 + 2.8, y0 + saber * 0.5, x0 + 2.6, y0);
      ctx.closePath();
      H.fillStroke(ctx, col, P.ink, lw * 0.7);
      ctx.strokeStyle = 'rgba(255,255,255,.55)';
      ctx.lineWidth = 0.7;
      ctx.beginPath(); ctx.moveTo(x0 + 1.2, y0 + 1); ctx.quadraticCurveTo(x0 + 1.4, y0 + saber * 0.5, x0 - 1 + saber * 0.1, y0 + saber * 0.88); ctx.stroke();
    };
    sab(-2.5, H.shade(P.tooth, -0.25));
    H.smooth(ctx, CAT_JAW.map(p => J(p[0], p[1])), true, 0.4);
    H.fillStroke(ctx, H.mix(P.body, P.belly, 0.5), P.ink, lw);
    if (ja > 0.04 && S.teeth > 0.2) {
      const a = J(12, 4.6), e = J(23, 4.6);
      H.teeth(ctx, a[0], a[1], e[0], e[1], 4, 1.8 * S.teeth, true, P.tooth);
    }
    const head = shape(snout('cat', CAT_HEAD, k, 10), 2.6 * S.fluff, X.seed + 3, X.t, -0.6, 0.6);
    paint(ctx, X, head, H.volume(ctx, P.body, -17, 12), () => {
      H.ellipse(ctx, sx(23), 3, 11 * k, 5.5);
      ctx.fillStyle = P.belly;
      ctx.fill();
      H.ellipse(ctx, 2, 9, 10, 5);
      ctx.fillStyle = H.rgba(P.belly, 0.85);
      ctx.fill();
      H.ellipse(ctx, 6, -13, 9, 4, 0.2);
      ctx.fillStyle = H.rgba(P.lo, 0.3);
      ctx.fill();
      // tear line and whisker dots
      ctx.strokeStyle = H.rgba(P.acc, 0.7); ctx.lineWidth = 1.2; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(15, -5); ctx.quadraticCurveTo(17, -1, sx(19), 2); ctx.stroke();
      ctx.fillStyle = H.rgba(P.ink, 0.55);
      for (let i = 0; i < 6; i++) { H.ellipse(ctx, sx(20 + (i % 3) * 3), 0.5 + Math.floor(i / 3) * 2.2, 0.5, 0.5); ctx.fill(); }
      if (st === 0) H.spots(ctx, X.seed + 40, -10, -15, 14, -2, 6, 1, 1.8, H.rgba(P.acc, 0.4));
      fur(ctx, P, X.seed + 21, -16, -17, 18, 12, 22, 3, PI - 0.4, 0.8, 0.1);
      if (X.angry) {
        ctx.strokeStyle = H.rgba(P.ink, 0.5); ctx.lineWidth = 0.9;
        ctx.beginPath();
        for (const wx of [17, 20.5]) { ctx.moveTo(sx(wx), -10); ctx.quadraticCurveTo(sx(wx) + 2, -7, sx(wx) + 1, -4.5); }
        ctx.stroke();
      }
      if (st === 3) { scarLines(ctx, X, [[[14, -15], [17, -7], [16, -1]]], 0.9); }
      if (X.glowOn) glowLines(ctx, X, [[[2, -15], [5, -10]], [[-4, -14], [-1, -9]]], 1.1);
    }, lw, 5);
    sab(0, P.tooth);
    // nose, whiskers, eye, near ear
    const nx = sx(30.5);
    H.poly(ctx, [[nx - 4, -4.5], [nx + 1.2, -4], [nx + 0.6, -1], [nx - 2.4, -0.4]], true);
    H.fillStroke(ctx, '#7a4a42', P.ink, lw * 0.6);
    ctx.strokeStyle = 'rgba(250,245,235,.6)'; ctx.lineWidth = 0.5;
    ctx.beginPath();
    for (let i = 0; i < 3; i++) { ctx.moveTo(sx(22), 1 + i); ctx.quadraticCurveTo(sx(30), 2 + i * 2, sx(37), 1.5 + i * 3.5); }
    ctx.stroke();
    eye(ctx, X, 13, -8, 2.5 * S.eye, { iris: st === 3 ? '#f5d040' : '#d8b440', pupil: 'round' });
    ear(0, P.body, true);
  }
  register('cat', cat, { bounds: [-76, -140, 117, 3], shadowW: 115 });

  /** Big plantigrade paw: sole from heel (hx, hy) to toes, long claws (len cl). */
  function bearPaw(ctx, X, hx, hy, x, y, w, fill, cl) {
    const P = X.P, tx = Math.max(x + w * 0.6, hx + w * 1.4);
    H.smooth(ctx, [[hx - w * 0.2, hy - w * 0.1], [hx + w * 0.2, y - w * 0.55], [tx - w * 0.2, y - w * 0.62], [tx + w * 0.25, y - w * 0.25], [tx, y], [hx, y]], true, 0.45);
    H.fillStroke(ctx, fill, P.ink, LW * 0.8);
    ctx.strokeStyle = H.rgba(P.ink, 0.55);
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(tx - w * 0.45, y - w * 0.55); ctx.lineTo(tx - w * 0.38, y - w * 0.1);
    ctx.moveTo(tx - w * 0.1, y - w * 0.5); ctx.lineTo(tx - w * 0.05, y - w * 0.1);
    ctx.stroke();
    ctx.fillStyle = P.claw;
    for (let i = 0; i < 3; i++) {
      const cx = tx - w * 0.3 + i * w * 0.24, cy = y - w * 0.2;
      ctx.beginPath();
      ctx.moveTo(cx - cl * 0.25, cy - cl * 0.25);
      ctx.quadraticCurveTo(cx + cl * 0.9, cy - cl * 0.3, cx + cl * 0.95, cy + w * 0.2);
      ctx.lineTo(cx + cl * 0.1, cy + w * 0.1);
      ctx.closePath();
      ctx.fill();
    }
  }

  // =====================================================================================================
  // BEAR — arctodus: short-faced bear, long legs, shoulder hump; rears up on the hind legs to attack.
  // =====================================================================================================
  const BEAR_HEAD = [[-16, -2, 0.7], [-14, -15, 0.6], [-3, -21.5, 0.35], [9, -20.5, 0.1], [17, -14.5, 0], [23.5, -10.5, 0], [28.5, -8, 0],
    [31.5, -4, 0], [31.2, 1.5, 0], [27, 5, 0], [17, 6.5, 0], [7, 8, 0], [-1, 14, 0.85], [-12, 11.5, 0.85]];
  const BEAR_JAW = [[4, 5], [17, 6.5], [26, 6], [27, 9], [21, 12.5], [10, 14], [2, 11]];
  const bearRear = k => (k < 0.35 ? smoothstep(k / 0.35) : k < 0.5 ? 1 : k < 0.62 ? 1 - smoothstep((k - 0.5) / 0.12) : 0);

  function bear(ctx, sp, o) {
    const X = poseOf(o, sp, 5.5), S = X.S, P = X.P, st = X.st;
    const lk = S.leg, hipH = 62, drop = hipH * (1 - lk);
    const lg = X.lg, rc = X.rc, atk = X.pose === 'attack';
    const rear = atk ? bearRear(X.k) : X.pose === 'roar' ? 0.32 : 0;
    const slam = atk && X.k > 0.5 && X.k < 0.8 ? Math.sin((X.k - 0.5) / 0.3 * PI) : 0;
    const dx = (atk ? Math.max(0, lg) * 20 : 0) - rc * 9;
    const pitch = -rear * 0.55 - rc * 0.08 + (X.pose === 'eat' ? 0.05 : 0);
    const B = bodyFrame(-38, -60, pitch, dx, drop + X.bob);
    const yc = -64, chub = S.chub, bl = S.len * 0.95;
    const R = (x, y, f) => B(x * bl, yc + (y - yc) * chub, f);
    const b = X.br * 1.1;

    let hp = [50, -90], ha = 0.2 + X.look * 0.1;
    if (X.walking) ha += Math.sin(X.ph * 2) * 0.04;
    if (atk) { ha += rear * 0.25 + slam * 0.25; hp = [50 + slam * 4, -90]; }
    else if (X.hurt) { ha -= rc * 0.4; hp = [50 - rc * 3, -90 - rc * 2]; }
    else if (X.pose === 'eat') { ha = 1.15 + Math.sin(X.t * 8) * 0.04; hp = [56, -56]; }
    else if (X.pose === 'roar') { ha = -0.25; hp = [50, -92]; }
    const hs = S.head * 1.18;
    const HP = R(hp[0] / bl, hp[1]);
    let HA = ha + pitch;
    HA = clampHead(HP, HA, hs, [[12 + 19 * S.snout, 2], [12 + 12 * S.snout, 13], [-1, 15]]);
    const hx = headFrame(HP, HA, hs);

    const ws = 0.92 + 0.08 * chub;
    const cl = 1.5 + 3.2 * S.feat + (atk ? rear * 2 : 0);
    const legC = near => (near ? H.mix(P.leg, P.acc, 0.35) : H.shade(H.mix(P.leg, P.acc, 0.35), -0.3));
    const gF = gait(X, 0, 11 * lk, 7 * lk), gH = gait(X, PI, 11 * lk, 7 * lk);
    const drawLeg = (front, near, x, ph) => {
      const g = gait(X, ph, 11 * lk, 7 * lk);
      let fy = (near ? 0 : -1.5) - g[1];
      let fx = x * bl + g[0] + (front ? dx * 1.1 : dx * 0.3);
      const fill = legC(near);
      if (front) {
        const sh = R(x * 0.85 + 3, -62);
        if (rear > 0) { // paws raised in front of the chest, claws out
          const up = R(x + 26 + (near ? 4 : -2), -50 + (near ? 0 : -6));
          fx = lerp(fx, up[0], rear); fy = lerp(fy, up[1], rear);
        }
        const J = foreLeg(sh, fx, fy, 28 * lk, 32 * lk, 6 * lk, 0.45 + g[1] * 0.05 + rear * 0.6);
        legTube(ctx, X, J, [26 * ws, 23 * ws, 16 * ws, 13 * ws, 12 * ws], fill, false);
        bearPaw(ctx, X, J[2][0] - 4, J[3][1], J[3][0] + 2, J[3][1], 12 * ws, fill, cl);
      } else {
        const J = hindLeg(R(x * 0.95, -62), fx, fy, 31 * lk, 28 * lk, 12 * lk, 0.85);
        legTube(ctx, X, J, [28 * ws, 23 * ws, 16 * ws, 13 * ws, 12 * ws], fill, false);
        bearPaw(ctx, X, J[2][0] - 3, J[3][1], J[3][0] + 1, J[3][1], 12 * ws, fill, cl * 0.7);
      }
    };
    drawLeg(true, false, 31, PI);
    drawLeg(false, false, -33, 0);
    // stubby tail
    {
      const tb = R(-60, -74);
      H.ellipse(ctx, tb[0] - 3, tb[1] + 2, 6, 5, pitch - 0.5);
      H.fillStroke(ctx, P.dark, P.ink, LW);
    }
    drawLeg(false, true, -40, PI);
    drawLeg(true, true, 38, 0);

    const fs = gF[0] * 0.35, hsx = gH[0] * 0.35;
    const pts = [
      R(-52, -76, 0.5), R(-34, -83, 0.5), R(-12, -85, 0.5), R(12, -94, 0.85), R(28, -92, 0.9),
      hx(-18, -9, 1), hx(-9, 17, 1),
      R(50, -66, 0.85), R(47 + fs, -50, 0.75), R(38 + fs, -40, 0.6), R(26 + fs, -44 + b, 0.65),
      R(8, -46 + b, 0.75), R(-12, -46 + b, 0.75), R(-25 + hsx, -45, 0.6), R(-31 + hsx, -38, 0.5),
      R(-45 + hsx, -34, 0.5), R(-57 + hsx, -44, 0.5), R(-62, -62, 0.5),
    ];
    const box = boxOf(pts, 6);
    const body = shape(pts, 3.4 * S.fluff, X.seed, X.t, -0.5, 0.65);
    paint(ctx, X, body, bodyGrad(ctx, P, box[1], box[3], 0.72), () => {
      let q = R(16, -86);
      H.ellipse(ctx, q[0], q[1], 26, 13, pitch - 0.3);
      ctx.fillStyle = H.rgba(P.mane, st === 3 ? 0.8 : 0.4);
      ctx.fill();
      q = R(-12, -50);
      H.ellipse(ctx, q[0], q[1], 44, 9, pitch);
      ctx.fillStyle = H.rgba(P.acc, 0.25);
      ctx.fill();
      q = R(32, -64); sheen(ctx, q[0], q[1], 20, 0.2);
      q = R(-38, -66); sheen(ctx, q[0], q[1], 20, 0.18);
      fur(ctx, P, X.seed, box[0], box[1], box[2], box[3], 130, 6.5, PI - 0.6, 1.1, 0.1);
      crease(ctx, X, [R(20, -78), R(23 + fs * 0.5, -60), R(28 + fs, -44)], 1.8);
      crease(ctx, X, [R(-22, -76), R(-20 + hsx * 0.5, -60), R(-26 + hsx, -42)], 1.8);
      rim(ctx, X, [R(-52, -75), R(-34, -82), R(-12, -84), R(12, -93), R(28, -91)], 2.6);
      snowCaps(ctx, X, [R(-42, -79), R(-24, -84), R(-4, -86), R(14, -93)], 6.5);
      if (st === 3) { q = R(-10, -62); clawScars(ctx, X, q[0], q[1], 1, 16, 1); }
      if (X.glowOn) glowLines(ctx, X, [[R(6, -82), R(16, -74), R(8, -64)], [R(18, -84), R(28, -76), R(20, -66)]], 1.7);
    });

    ctx.save();
    ctx.translate(HP[0], HP[1]);
    ctx.rotate(HA);
    ctx.scale(hs, hs);
    bearHead(ctx, X, LW / hs);
    ctx.restore();
  }

  function bearHead(ctx, X, lw) {
    const P = X.P, S = X.S, st = X.st, k = S.snout;
    const sx = x => (x > 12 ? 12 + (x - 12) * k : x);
    const ear = (x, y, fill, inner) => {
      const r = st === 0 ? 6.5 : 5.4;
      H.ellipse(ctx, x, y, r, r * 0.95);
      H.fillStroke(ctx, fill, P.ink, lw);
      if (inner) { H.ellipse(ctx, x + 0.6, y + 0.6, r * 0.5, r * 0.45); ctx.fillStyle = 'rgba(60,36,28,.7)'; ctx.fill(); }
    };
    ear(4, -20, P.far, false);
    const ja = X.jw * (X.pose === 'roar' ? 0.75 : 0.6);
    const c = Math.cos(ja), s = Math.sin(ja);
    const J = (x, y) => [6 + (sx(x) - 6) * c - (y - 6) * s, 6 + (sx(x) - 6) * s + (y - 6) * c];
    const tk = S.teeth;
    if (ja > 0.04) {
      H.poly(ctx, [[5, 6], [sx(20), 6.5], [sx(28), 5], J(26, 6), J(17, 6.5)], true);
      H.fillStroke(ctx, P.mouth, P.ink, lw);
      const tg = J(20, 8);
      H.ellipse(ctx, tg[0], tg[1] - 1.5, 8 * k, 2.6, ja);
      ctx.fillStyle = P.tongue;
      ctx.fill();
    }
    if (tk > 0.2) {
      H.teeth(ctx, sx(14), 6.6, sx(28), 5.2, 5, 2 * tk, false, P.tooth);
      H.poly(ctx, [[sx(24.5) - 1.6, 5.5], [sx(24.5), 5.5 + 6 * tk], [sx(24.5) + 1.6, 5.5]], true);
      H.fillStroke(ctx, P.tooth, 'rgba(60,40,20,.6)', 0.7);
    }
    H.smooth(ctx, BEAR_JAW.map(p => J(p[0], p[1])), true, 0.4);
    H.fillStroke(ctx, H.mix(P.body, P.belly, 0.4), P.ink, lw);
    if (tk > 0.2 && ja > 0.04) {
      const a = J(14, 6), e = J(25, 5.8), cc = J(23, 5.6);
      H.teeth(ctx, a[0], a[1], e[0], e[1], 4, 1.8 * tk, true, P.tooth);
      H.poly(ctx, [[cc[0] - 1.4, cc[1]], [cc[0] + 0.1, cc[1] - 5.5 * tk], [cc[0] + 1.6, cc[1]]], true);
      H.fillStroke(ctx, P.tooth, 'rgba(60,40,20,.6)', 0.7);
    }
    const head = shape(snout('bear', BEAR_HEAD, k, 12), 3.2 * S.fluff, X.seed + 3, X.t, -0.6, 0.6);
    paint(ctx, X, head, H.volume(ctx, P.body, -20, 14), () => {
      H.ellipse(ctx, sx(25), 0, 11 * k, 7, -0.1);
      ctx.fillStyle = P.belly;
      ctx.fill();
      H.ellipse(ctx, sx(18), -4, 8, 6);
      ctx.fillStyle = H.rgba(P.belly, 0.5);
      ctx.fill();
      H.ellipse(ctx, 2, -15, 12, 6, 0.1);
      ctx.fillStyle = H.rgba(P.mane, 0.35);
      ctx.fill();
      fur(ctx, P, X.seed + 21, -17, -20, 16, 14, 30, 3.8, PI - 0.45, 0.9, 0.1);
      if (X.angry) {
        ctx.strokeStyle = H.rgba(P.ink, 0.5); ctx.lineWidth = 0.9;
        ctx.beginPath();
        for (const wx of [19, 22.5]) { ctx.moveTo(sx(wx), -11.5); ctx.quadraticCurveTo(sx(wx) + 2, -8.5, sx(wx) + 1, -6); }
        ctx.stroke();
      }
      if (st === 3) { clawScars(ctx, X, 8, -12, 1.2, 10, 0.8); }
      if (X.glowOn) glowLines(ctx, X, [[[sx(22), -10], [12, -14], [2, -17]]], 1.1);
    }, lw, 5);
    if (X.angry && tk > 0.2) {
      H.smooth(ctx, [[15, 6.5], [sx(21), 4], [sx(27), 3], [sx(30), 4.5], [sx(26), 6], [sx(21), 6.6]], true, 0.4);
      H.fillStroke(ctx, P.gum, P.ink, lw * 0.6);
      H.teeth(ctx, sx(15), 6.1, sx(28), 5, 5, 2.2 * tk, false, P.tooth);
      H.poly(ctx, [[sx(24.5) - 1.6, 5.3], [sx(24.5), 5.5 + 6.5 * tk], [sx(24.5) + 1.6, 5.3]], true);
      H.fillStroke(ctx, P.tooth, 'rgba(60,40,20,.6)', 0.7);
    }
    const nx = sx(29.6);
    H.ellipse(ctx, nx, -3.2, 4, 3.2, 0.15);
    ctx.fillStyle = P.nose;
    ctx.fill();
    H.ellipse(ctx, nx - 0.8, -4.4, 1.4, 0.8);
    ctx.fillStyle = 'rgba(255,255,255,.4)';
    ctx.fill();
    ctx.strokeStyle = H.rgba(P.ink, 0.7); ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(nx, 0); ctx.lineTo(nx - 1, 4); ctx.quadraticCurveTo(sx(22), 7, 13, 7); ctx.stroke();
    eye(ctx, X, 12.5, -9, 2.1 * S.eye, {});
    ear(-4, -18, P.body, true);
  }
  register('bear', bear, { bounds: [-79, -168, 110, 4], shadowW: 130 });

  /** Big curved claws from (x, y) along angle a (rad), curling towards +a side by curl. */
  function bigClaws(ctx, X, x, y, a, n, len, w, curl, glow) {
    const P = X.P;
    for (let i = 0; i < n; i++) {
      const aa = a + (i - (n - 1) / 2) * 0.28, l = len * (1 - Math.abs(i - (n - 1) / 2) * 0.12);
      const ca = Math.cos(aa), sa = Math.sin(aa), bx = x + (i - (n - 1) / 2) * w * 0.5 * -sa, by = y + (i - (n - 1) / 2) * w * 0.5 * ca;
      const tx = bx + ca * l + -sa * l * curl, ty = by + sa * l + ca * l * curl;
      const cx = bx + ca * l * 0.7, cy = by + sa * l * 0.7;
      ctx.beginPath();
      ctx.moveTo(bx - sa * w * 0.5, by + ca * w * 0.5);
      ctx.quadraticCurveTo(cx - sa * w * 0.3, cy + ca * w * 0.3, tx, ty);
      ctx.quadraticCurveTo(cx + sa * w * 0.5, cy - ca * w * 0.5, bx + sa * w * 0.5, by - ca * w * 0.5);
      ctx.closePath();
      H.fillStroke(ctx, H.mix(P.claw, '#8a7a62', 0.3), P.ink, LW * 0.6);
      ctx.strokeStyle = P.clawHi;
      ctx.lineWidth = Math.max(0.8, w * 0.18);
      ctx.beginPath(); ctx.moveTo(bx - sa * w * 0.15, by + ca * w * 0.15); ctx.quadraticCurveTo(cx - sa * w * 0.1, cy + ca * w * 0.1, tx, ty); ctx.stroke();
      if (glow) { H.ellipse(ctx, tx, ty, w * 0.45, w * 0.45); ctx.fillStyle = H.rgba(X.P.glow, 0.85); ctx.fill(); }
    }
  }

  // =====================================================================================================
  // SLOTH — megatherium: giant ground sloth, shaggy, huge claws; rears up on hind legs + tail to attack.
  // =====================================================================================================
  const SLOTH_HEAD = [[-11, -3, 0.7], [-7, -11, 0.5], [4, -13, 0.15], [14, -11, 0], [22, -7.5, 0], [27, -4.5, 0], [29.5, -1, 0],
    [28, 3, 0], [22, 4.8, 0], [12, 6, 0], [2, 9.5, 0.6], [-8, 8, 0.7]];
  const SLOTH_JAW = [[6, 4], [16, 5], [23, 4.6], [24, 7.2], [18, 9.8], [9, 10.5], [4, 8]];
  const slothRear = k => (k < 0.35 ? smoothstep(k / 0.35) : k < 0.55 ? 1 : k < 0.82 ? 1 - smoothstep((k - 0.55) / 0.27) : 0);

  function sloth(ctx, sp, o) {
    const X = poseOf(o, sp, 4.5), S = X.S, P = X.P, st = X.st;
    const lk = S.leg, hipH = 70, drop = hipH * (1 - lk);
    const lg = X.lg, rc = X.rc, atk = X.pose === 'attack';
    const rear = atk ? slothRear(X.k) : X.pose === 'roar' ? 0.45 : 0;
    const swipe = atk ? (X.k < 0.45 ? 0 : X.k < 0.6 ? smoothstep((X.k - 0.45) / 0.15) : 1 - smoothstep((X.k - 0.6) / 0.25)) : 0;
    const dx = (atk ? Math.max(0, lg) * 12 : 0) - rc * 8;
    const pitch = -rear * 0.68 + swipe * 0.22 - rc * 0.08 + (X.pose === 'eat' ? 0.04 : 0);
    const B = bodyFrame(-34, -70, pitch, dx, drop + X.bob);
    const yc = -74, chub = S.chub, bl = S.len * 0.95;
    const R = (x, y, f) => B(x * bl, yc + (y - yc) * chub, f);
    const b = X.br * 1.2;

    let hp = [42, -88], ha = 0.3 + X.look * 0.12;
    if (X.walking) ha += Math.sin(X.ph * 2) * 0.04;
    if (rear > 0) { ha += rear * 0.25 - swipe * 0.1; }
    if (X.hurt) { ha -= rc * 0.4; hp = [42 - rc * 3, -88 - rc * 2]; }
    else if (X.pose === 'eat') { ha = 0.9 + Math.sin(X.t * 7) * 0.05; hp = [50, -66]; }
    else if (X.pose === 'roar') { ha = -0.2; }
    const hs = S.head * 1.35;
    const HP = R(hp[0] / bl, hp[1]);
    let HA = ha + pitch;
    HA = clampHead(HP, HA, hs, [[12 + 17 * S.snout, 3], [8, 11]]);
    const hx = headFrame(HP, HA, hs);

    const ws = 0.9 + 0.1 * chub;
    const clawL = 5 + 12 * S.feat;
    const fillOf = near => (near ? H.mix(P.leg, P.acc, 0.2) : H.shade(H.mix(P.leg, P.acc, 0.2), -0.3));
    const gF = gait(X, 0, 9 * lk, 6 * lk), gH = gait(X, PI, 9 * lk, 6 * lk);
    let up = 0;
    const drawLeg = (front, near, x, ph) => {
      const g = gait(X, ph, 9 * lk, 6 * lk);
      let fy = (near ? 0 : -1.5) - g[1];
      let fx = x * bl + g[0] + (front ? dx * 1.1 : dx * 0.2);
      const fill = fillOf(near);
      if (front) {
        const sh = R(x * 0.85 + 2, -68);
        up = 0;
        if (rear > 0) { // arms raised above the head, then swiping down in front
          const hi = [sh[0] + (near ? 26 : 18), sh[1] - (near ? 34 : 28)], lo = [sh[0] + (near ? 46 : 40), sh[1] + 30];
          const tgt = lerpPt(hi, lo, swipe);
          up = clamp(rear * 1.3, 0, 1);
          fx = lerp(fx, tgt[0], up); fy = lerp(fy, tgt[1], up);
        }
        const J = foreLeg(sh, fx, fy, 31 * lk, 32 * lk, 7 * lk, 0.3 + g[1] * 0.06 - up * 1.4);
        legTube(ctx, X, J, [30 * ws, 27 * ws, 21 * ws, 18 * ws, 17 * ws], fill, false);
        // fist + big curled claws
        const w = J[3], v = J[2];
        const a = Math.atan2(w[1] - v[1], w[0] - v[0]);
        const ca = lerp(0.35, a, smoothstep(up * 1.5));
        H.ellipse(ctx, w[0] + 1, w[1] - 6 * (1 - up), 12 * ws, 9 * ws, ca);
        H.fillStroke(ctx, fill, P.ink, LW * 0.85);
        bigClaws(ctx, X, w[0] + Math.cos(ca) * 8, w[1] - 13 * (1 - up) + Math.sin(ca) * 8, ca - 0.45 * (1 - up), 3, clawL * (1 + up * 0.25), 6.5, 0.55 - 0.3 * (1 - up), X.glowOn);
      } else {
        const J = hindLeg(R(x * 0.95, -68), fx, fy, 33 * lk, 29 * lk, 14 * lk, 0.75);
        legTube(ctx, X, J, [36 * ws, 30 * ws, 23 * ws, 19 * ws, 18 * ws], fill, false);
        const f = J[3];
        H.smooth(ctx, [[J[2][0] - 8, f[1] - 2], [J[2][0] - 4, f[1] - 12], [f[0] + 8, f[1] - 11], [f[0] + 14, f[1] - 3], [f[0] + 8, f[1]], [J[2][0] - 6, f[1]]], true, 0.45);
        H.fillStroke(ctx, fill, P.ink, LW * 0.85);
        bigClaws(ctx, X, f[0] + 11, f[1] - 6, 0.15, 3, clawL * 0.5, 4, 0.25, false);
      }
    };
    drawLeg(true, false, 28, PI);
    drawLeg(false, false, -29, 0);

    // ---- thick tail resting on the ground (the third leg of the tripod when rearing)
    {
      const tb = R(-50, -70), tip = [-90 * bl + dx * 0.3, -11];
      const mid = [lerp(tb[0], tip[0], 0.5) - 4, lerp(tb[1], tip[1], 0.45) - 6];
      const TJ = [tb, lerpPt(tb, mid, 0.6), mid, lerpPt(mid, tip, 0.55), tip];
      const tw = S.tail;
      const tube0 = tube(TJ, [32 * tw, 28 * tw, 22 * tw, 16 * tw, 10 * tw], 0.9);
      for (const q of tube0) if (q[1] > -6) q[2] = 0.1;
      const path = shape(tube0, 3.4 * S.fluff, X.seed + 5, X.t, -0.4, 0.8);
      const bx = boxOf(TJ, 16);
      paint(ctx, X, path, bodyGrad(ctx, P, bx[1], bx[3], 0.6), () => {
        fur(ctx, P, X.seed + 9, bx[0], bx[1], bx[2], bx[3], 40, 7, 2.2, 1.1, 0.1);
      });
    }

    drawLeg(false, true, -36, PI);
    const armFront = rear > 0.15;
    if (!armFront) drawLeg(true, true, 34, 0);

    const fs = gF[0] * 0.35, hsx = gH[0] * 0.35;
    const pts = [
      R(-50, -80, 0.8), R(-38, -98, 0.8), R(-20, -105, 0.8), R(0, -101, 0.85), R(20, -93, 0.9), R(34, -88, 1),
      hx(-12, -7, 1), hx(-7, 11, 1),
      R(46, -68, 1), R(42 + fs, -54, 0.9), R(32 + fs, -45, 0.9), R(16, -47 + b, 1),
      R(-4, -43 + b, 1), R(-20, -45, 1), R(-31 + hsx, -40, 0.9), R(-42 + hsx, -38, 0.9),
      R(-56 + hsx, -50, 0.85), R(-58, -68, 0.8),
    ];
    const box = boxOf(pts, 6);
    const body = shape(pts, 3.8 * S.fluff, X.seed, X.t, -0.3, 0.9);
    paint(ctx, X, body, bodyGrad(ctx, P, box[1], box[3], 0.7), () => {
      let q = R(-4, -50);
      H.ellipse(ctx, q[0], q[1], 46, 12, pitch);
      ctx.fillStyle = H.rgba(P.acc, 0.3);
      ctx.fill();
      q = R(22, -88);
      H.ellipse(ctx, q[0], q[1], 22, 10, pitch - 0.35);
      ctx.fillStyle = H.rgba(P.mane, st === 3 ? 0.65 : 0.25);
      ctx.fill();
      q = R(-26, -82); sheen(ctx, q[0], q[1], 26, 0.2);
      q = R(26, -70); sheen(ctx, q[0], q[1], 18, 0.16);
      fur(ctx, P, X.seed, box[0], box[1], box[2], box[3], 130, 9, PI / 2 + 0.55, 1.2, 0.12);
      crease(ctx, X, [R(14, -86), R(18 + fs * 0.5, -66), R(24 + fs, -50)], 1.8);
      crease(ctx, X, [R(-14, -94), R(-14 + hsx * 0.5, -70), R(-22 + hsx, -46)], 1.8);
      rim(ctx, X, [R(-48, -81), R(-37, -97), R(-20, -104), R(0, -100), R(20, -92)], 2.6);
      snowCaps(ctx, X, [R(-36, -98), R(-20, -104), R(-2, -101), R(14, -96)], 6.5);
      if (st === 3) { q = R(0, -76); clawScars(ctx, X, q[0], q[1], 1.2, 18, 1.1); }
      if (X.glowOn) glowLines(ctx, X, [[R(22, -84), R(28, -74), R(24, -62)], [R(14, -86), R(20, -76), R(16, -64)]], 1.6);
    });

    if (armFront) drawLeg(true, true, 34, 0);
    ctx.save();
    ctx.translate(HP[0], HP[1]);
    ctx.rotate(HA);
    ctx.scale(hs, hs);
    slothHead(ctx, X, LW / hs);
    ctx.restore();
  }

  function slothHead(ctx, X, lw) {
    const P = X.P, S = X.S, st = X.st, k = S.snout;
    const sx = x => (x > 10 ? 10 + (x - 10) * k : x);
    const ja = X.jw * 0.55;
    const c = Math.cos(ja), s = Math.sin(ja);
    const J = (x, y) => [8 + (sx(x) - 8) * c - (y - 5) * s, 5 + (sx(x) - 8) * s + (y - 5) * c];
    if (ja > 0.04) {
      H.poly(ctx, [[7, 5], [sx(18), 5], [sx(25), 4], J(23, 4.6), J(16, 5)], true);
      H.fillStroke(ctx, P.mouth, P.ink, lw);
      const tg = J(18, 6.5);
      H.ellipse(ctx, tg[0], tg[1] - 1, 6 * k, 2, ja);
      ctx.fillStyle = P.tongue;
      ctx.fill();
      // long prehensile tongue sticks out when eating
      if (X.pose === 'eat') {
        ctx.strokeStyle = P.tongue; ctx.lineWidth = 2.4; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(tg[0], tg[1]); ctx.quadraticCurveTo(sx(30), 8 + Math.sin(X.t * 7) * 2, sx(34), 4 + Math.sin(X.t * 7) * 3); ctx.stroke();
      }
    }
    H.smooth(ctx, SLOTH_JAW.map(p => J(p[0], p[1])), true, 0.4);
    H.fillStroke(ctx, H.mix(P.body, P.belly, 0.35), P.ink, lw);
    if (ja > 0.1) {
      const a = J(13, 4.6), e = J(22, 4.4);
      H.teeth(ctx, a[0], a[1], e[0], e[1], 3, 1.6, true, '#e8dcc0');
    }
    const head = shape(snout('sloth', SLOTH_HEAD, k, 10), 3 * S.fluff, X.seed + 3, X.t, -0.6, 0.7);
    paint(ctx, X, head, H.volume(ctx, P.body, -13, 10), () => {
      H.ellipse(ctx, sx(23), 0.5, 8 * k, 5);
      ctx.fillStyle = H.rgba(P.belly, 0.8);
      ctx.fill();
      H.ellipse(ctx, 10, -4, 6, 4);
      ctx.fillStyle = H.rgba(P.acc, 0.45);
      ctx.fill();
      fur(ctx, P, X.seed + 21, -12, -13, 18, 10, 22, 3.6, PI - 0.3, 0.8, 0.1);
      if (st === 3) { scarLines(ctx, X, [[[2, -12], [6, -4], [5, 2]]], 0.8); }
      if (X.glowOn) glowLines(ctx, X, [[[sx(20), -7], [12, -9], [3, -9]]], 1);
    }, lw, 4.5);
    // nostrils, mouth line, small ear, eye
    const nx = sx(27.5);
    H.ellipse(ctx, nx, -2, 2.2, 1.6, 0.4);
    ctx.fillStyle = P.nose;
    ctx.fill();
    ctx.strokeStyle = H.rgba(P.ink, 0.7); ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(sx(26), 3.5); ctx.quadraticCurveTo(sx(18), 5.2, 8, 5.5); ctx.stroke();
    H.ellipse(ctx, -3, -9, st === 0 ? 4 : 3.2, st === 0 ? 3.6 : 2.8, -0.3);
    H.fillStroke(ctx, P.dark, P.ink, lw * 0.8);
    eye(ctx, X, 10, -4, 1.8 * S.eye, {});
  }
  register('sloth', sloth, { bounds: [-100, -156, 91, 5], shadowW: 150 });

  /** Pillar foot (elephant, rhino): wide rounded pad with pale toenails. */
  function pillarFoot(ctx, X, x, y, w, fill, nails) {
    const P = X.P;
    H.smooth(ctx, [[x - w * 0.55, y - w * 0.55], [x + w * 0.55, y - w * 0.55], [x + w * 0.62, y - w * 0.05], [x, y + w * 0.04], [x - w * 0.62, y - w * 0.05]], true, 0.6);
    H.fillStroke(ctx, fill, P.ink, LW * 0.85);
    ctx.fillStyle = nails || '#d8ccb4';
    for (let i = 0; i < 3; i++) {
      H.ellipse(ctx, x - w * 0.12 + i * w * 0.24, y - w * 0.14, w * 0.11, w * 0.13);
      ctx.fill();
    }
  }
  /** Chain of joints from base along angle a0, bending by curv(i) per segment. */
  function chain(base, a0, len, n, curv) {
    const J = [base];
    let a = a0, x = base[0], y = base[1];
    for (let i = 0; i < n; i++) {
      a += curv(i);
      x += Math.cos(a) * len / n; y += Math.sin(a) * len / n;
      J.push([x, y]);
    }
    return J;
  }
  /** Tapered curved tusk/horn along a cubic (p0 → p3), width w0 → w1. Returns the sampled centre line. */
  function cubicBlade(ctx, X, p0, p1, p2, p3, w0, w1, fill, lw, rings, ringCol) {
    const P = X.P, n = 12, C = [], L = [], Rr = [];
    for (let i = 0; i <= n; i++) {
      const u = i / n, v = 1 - u;
      C.push([v * v * v * p0[0] + 3 * v * v * u * p1[0] + 3 * v * u * u * p2[0] + u * u * u * p3[0],
        v * v * v * p0[1] + 3 * v * v * u * p1[1] + 3 * v * u * u * p2[1] + u * u * u * p3[1]]);
    }
    for (let i = 0; i <= n; i++) {
      const a = C[Math.max(0, i - 1)], b = C[Math.min(n, i + 1)];
      let dx = b[0] - a[0], dy = b[1] - a[1];
      const l = Math.hypot(dx, dy) || 1;
      dx /= l; dy /= l;
      const w = lerp(w0, w1, Math.pow(i / n, 0.8)) / 2;
      L.push([C[i][0] - dy * w, C[i][1] + dx * w]);
      Rr.push([C[i][0] + dy * w, C[i][1] - dx * w]);
    }
    ctx.beginPath();
    ctx.moveTo(L[0][0], L[0][1]);
    for (let i = 1; i <= n; i++) ctx.lineTo(L[i][0], L[i][1]);
    for (let i = n; i >= 0; i--) ctx.lineTo(Rr[i][0], Rr[i][1]);
    ctx.closePath();
    H.fillStroke(ctx, fill, P.ink, lw);
    // highlight along the upper side, shadow along the lower side
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let i = 1; i < n; i++) { const q = lerpPt(C[i], Rr[i], 0.5); if (i === 1) ctx.moveTo(q[0], q[1]); else ctx.lineTo(q[0], q[1]); }
    ctx.strokeStyle = 'rgba(255,255,250,.55)'; ctx.lineWidth = Math.max(0.8, w0 * 0.16); ctx.stroke();
    ctx.beginPath();
    for (let i = 1; i < n; i++) { const q = lerpPt(C[i], L[i], 0.6); if (i === 1) ctx.moveTo(q[0], q[1]); else ctx.lineTo(q[0], q[1]); }
    ctx.strokeStyle = 'rgba(90,70,40,.28)'; ctx.lineWidth = Math.max(0.8, w0 * 0.2); ctx.stroke();
    if (rings) {
      ctx.strokeStyle = ringCol || 'rgba(110,90,60,.45)'; ctx.lineWidth = 0.8;
      ctx.beginPath();
      for (let i = 1; i <= rings; i++) { const j = i; ctx.moveTo(L[j][0], L[j][1]); ctx.lineTo(Rr[j][0], Rr[j][1]); }
      ctx.stroke();
    }
    return C;
  }
  /** Small hanging icicles at points (frost creatures). */
  function icicles(ctx, X, pts, len) {
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const q = pts[i], l = len * (0.6 + 0.7 * hash(X.seed + i * 7.7)), w = 1.6 + l * 0.12;
      ctx.moveTo(q[0] - w, q[1]); ctx.lineTo(q[0] + w, q[1]); ctx.lineTo(q[0] + 0.3, q[1] + l); ctx.closePath();
    }
    ctx.fillStyle = 'rgba(214,244,255,.92)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(70,140,180,.7)';
    ctx.lineWidth = 0.7;
    ctx.stroke();
  }
  /** Twinkling frost crystals (frost creatures), inside a clip. */
  function frost(ctx, X, pts, r) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,.85)';
    ctx.lineWidth = 0.9;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const q = pts[i], rr = r * (0.6 + 0.5 * Math.abs(Math.sin(X.t * 2 + i * 1.7)));
      for (let k = 0; k < 3; k++) {
        const a = k * PI / 3 + i;
        ctx.moveTo(q[0] - Math.cos(a) * rr, q[1] - Math.sin(a) * rr);
        ctx.lineTo(q[0] + Math.cos(a) * rr, q[1] + Math.sin(a) * rr);
      }
    }
    ctx.stroke();
    ctx.restore();
  }

  // =====================================================================================================
  // ELEPHANT — mammoth: domed head, shoulder hump, long shaggy wool skirt, curling trunk, spiral tusks.
  // =====================================================================================================
  const MAM_HEAD = [[-14, -4, 0.8], [-12, -24, 0.7], [-2, -36, 0.9], [10, -38, 1], [19, -30, 0.45], [24, -18, 0], [27, -6, 0],
    [28.5, 6, 0], [25.5, 16, 0.2], [16, 22, 0.6], [4, 21, 0.8], [-8, 14, 0.9]];
  const mamLift = k => (k < 0.3 ? smoothstep(k / 0.3) : k < 0.5 ? 1 - smoothstep((k - 0.3) / 0.2) : 0);

  function elephant(ctx, sp, o) {
    const X = poseOf(o, sp, 4.2), S = X.S, P = X.P, st = X.st;
    const isFrost = sp.features.indexOf('frost') >= 0;
    const lk = S.leg, hipH = 76, drop = hipH * (1 - lk);
    const lg = X.lg, rc = X.rc, atk = X.pose === 'attack';
    const lift = atk ? mamLift(X.k) : X.pose === 'roar' ? 0.35 : 0;
    const dx = (atk ? Math.max(0, lg) * 16 : 0) - rc * 8;
    const pitch = -lift * 0.16 - rc * 0.06 + (X.pose === 'eat' ? 0.03 : 0);
    const B = bodyFrame(-38, -74, pitch, dx, drop + X.bob);
    const yc = -80, chub = S.chub, bl = S.len * 0.96;
    const R = (x, y, f) => B(x * bl, yc + (y - yc) * chub, f);
    const b = X.br * 1.3;

    // ---- head placement (pivot = top of the neck behind the dome)
    let hp = [36, -98], ha = 0.04 + X.look * 0.06;
    if (X.walking) ha += Math.sin(X.ph * 2) * 0.025;
    if (atk) ha += -lift * 0.3 + Math.max(0, lg) * 0.38;
    else if (X.hurt) { ha -= rc * 0.3; hp = [36 - rc * 3, -98 - rc * 2]; }
    else if (X.pose === 'eat') ha = 0.16 + Math.sin(X.t * 2) * 0.03;
    else if (X.pose === 'roar') ha = -0.28;
    const hs = S.head * 1.08;
    const HP = R(hp[0] / bl, hp[1]);
    const HA = ha + pitch;
    const hx = headFrame(HP, HA, hs);

    // ---- legs
    const ws = 0.92 + 0.08 * chub;
    const legFill = near => (near ? H.mix(P.body, P.acc === sp.colors.accent && !isFrost ? P.body : P.belly, 0.1) : P.far);
    const gF = gait(X, 0, 9 * lk, 5 * lk), gH = gait(X, PI, 9 * lk, 5 * lk);
    const drawLeg = (front, near, x, ph) => {
      const g = gait(X, ph, 9 * lk, 5 * lk);
      let fy = (near ? 0 : -1.8) - g[1];
      const fx = x * bl + g[0] + (front ? dx * 1.05 : dx * 0.3);
      const fill = near ? P.leg : P.far;
      if (front) {
        fy -= lift * 16;
        const J = foreLeg(R(x * 0.9 + 2, -76), fx, fy, 38 * lk, 30 * lk, 12 * lk, 0.08 + g[1] * 0.05);
        legTube(ctx, X, J, [32 * ws, 27 * ws, 23 * ws, 21 * ws, 22 * ws], fill, false);
        pillarFoot(ctx, X, J[3][0], J[3][1], 22 * ws, fill, isFrost ? '#e8f8ff' : '#d8ccb4');
      } else {
        const J = hindLeg(R(x * 0.95, -76), fx, fy, 38 * lk, 28 * lk, 13 * lk, 0.25);
        legTube(ctx, X, J, [34 * ws, 28 * ws, 23 * ws, 21 * ws, 22 * ws], fill, false);
        pillarFoot(ctx, X, J[3][0], J[3][1], 22 * ws, fill, isFrost ? '#e8f8ff' : '#d8ccb4');
      }
    };
    drawLeg(true, false, 18, PI);
    drawLeg(false, false, -28, 0);
    // tail with a hair tuft
    {
      const tb = R(-60, -80);
      const a0 = PI - 1.1 + Math.sin(X.t * 1.6) * 0.12 + (X.angry ? -0.4 : 0);
      const TJ = chain(tb, a0, 24 * S.tail, 3, i => 0.12);
      H.limb(ctx, TJ, [7, 5.5, 4, 3.5], P.dark, P.ink, LW);
      const tip = TJ[3];
      const tuft = shape([[tip[0] - 4, tip[1] - 2, 1], [tip[0] + 3, tip[1] - 1, 1], [tip[0] + 2, tip[1] + 9, 1], [tip[0] - 4, tip[1] + 8, 1]], 3, X.seed + 9, X.t, -0.2, 0.9);
      paint(ctx, X, tuft, P.mane, null, LW * 0.8, 3);
    }
    drawLeg(false, true, -36, PI);
    drawLeg(true, true, 26, 0);

    // ---- body: hump, sloping back, long wool skirt
    const fs = gF[0] * 0.3, hsx = gH[0] * 0.3, sk = Math.min(S.fluff, 1.18);
    const pts = [
      R(-58, -80, 0.5), R(-50, -91, 0.5), R(-34, -95, 0.6), R(-14, -101, 0.7), R(2, -110, 0.8), R(14, -116, 0.9), R(26, -111, 0.8),
      hx(-12, -16, 0.9), hx(-6, 18, 1.1),
      R(48, -66, 1.2), R(44 + fs, -50, 1.5), R(30 + fs, -42 + b, 1.7), R(12, -41 + b, 1.8), R(-8, -41 + b, 1.8),
      R(-26 + hsx, -43, 1.7), R(-44 + hsx, -46, 1.5), R(-57, -57, 1.1), R(-63, -71, 0.7),
    ];
    const box = boxOf(pts, 8);
    const body = shape(pts, 4.8 * sk, X.seed, X.t, -0.15, 1);
    paint(ctx, X, body, bodyGrad(ctx, P, box[1], box[3], 0.74), () => {
      let q = R(10, -104);
      H.ellipse(ctx, q[0], q[1], 30, 13, pitch - 0.2);
      ctx.fillStyle = H.rgba(P.mane, st === 3 ? 0.7 : 0.3);
      ctx.fill();
      q = R(-6, -50);
      H.ellipse(ctx, q[0], q[1], 56, 11, pitch);
      ctx.fillStyle = H.rgba(isFrost ? P.belly : P.dark, 0.35);
      ctx.fill();
      q = R(20, -84); sheen(ctx, q[0], q[1], 26, 0.2);
      q = R(-34, -78); sheen(ctx, q[0], q[1], 24, 0.16);
      fur(ctx, P, X.seed, box[0], box[1], box[2], box[3], 150, 11, PI / 2 + 0.35, 1.25, 0.1);
      crease(ctx, X, [R(16, -96), R(20 + fs * 0.5, -72), R(26 + fs, -50)], 2);
      crease(ctx, X, [R(-22, -92), R(-22 + hsx * 0.5, -70), R(-28 + hsx, -50)], 2);
      rim(ctx, X, [R(-50, -90), R(-34, -94), R(-14, -100), R(2, -109), R(14, -115), R(26, -110)], 2.8);
      snowCaps(ctx, X, [R(-44, -92), R(-26, -97), R(-8, -103), R(6, -112), R(20, -114)], isFrost ? 8 : 7);
      if (isFrost) frost(ctx, X, [R(-30, -86), R(-4, -92), R(14, -100), R(-40, -66), R(4, -66)], 4);
      if (st === 3) { q = R(-14, -76); clawScars(ctx, X, q[0], q[1], 1.15, 20, 1.2); }
      if (X.glowOn) { // ice-rune snowflake on the shoulder
        const c = R(16, -82), segs = [];
        for (let i = 0; i < 3; i++) {
          const a = i * PI / 3 + 0.2, ca = Math.cos(a), sa = Math.sin(a), r = 11;
          segs.push([[c[0] - ca * r, c[1] - sa * r], [c[0] + ca * r, c[1] + sa * r]]);
          for (const e of [-1, 1]) {
            const tx = c[0] + ca * r * 0.62 * e, ty = c[1] + sa * r * 0.62 * e;
            segs.push([[tx + Math.cos(a + 0.9 * e) * 4, ty + Math.sin(a + 0.9 * e) * 4], [tx, ty], [tx + Math.cos(a - 0.9 * e) * 4, ty + Math.sin(a - 0.9 * e) * 4]]);
          }
        }
        glowLines(ctx, X, segs, 1.3);
      }
    }, LW * 0.9);
    if (isFrost) icicles(ctx, X, [R(40, -48), R(28, -38), R(16, -37), R(2, -37), R(-12, -37), R(-28, -39), R(-44, -43)], 8);

    ctx.save();
    ctx.translate(HP[0], HP[1]);
    ctx.rotate(HA);
    ctx.scale(hs, hs);
    elephantHead(ctx, X, sp, LW / hs, lift, isFrost, (-3 - HP[1]) / hs, HA);
    ctx.restore();
  }

  function elephantHead(ctx, X, sp, lw, lift, isFrost, groundY, HA) {
    const P = X.P, S = X.S, st = X.st, atk = X.pose === 'attack';
    // ---- trunk shape per pose
    const tl = 72 * (st === 0 ? 0.6 : st === 1 ? 0.84 : 1), n = 8;
    let a0 = 1.32, curv;
    const sway = i => Math.sin(X.t * 1.2 - i * 0.6) * 0.06 * (i / n);
    const curl = 0.55 + 0.25 * Math.sin(X.t * 0.8);
    if (X.pose === 'roar' || (atk && lift > 0.05)) {
      const r = X.pose === 'roar' ? 1 : lift;
      a0 = lerp(1.32, 0.15, r);
      curv = i => lerp(0.02 + sway(i) + (i >= n - 2 ? -curl * 0.5 : 0), -0.21 + Math.sin(X.t * 10 + i) * 0.02, r);
    } else if (atk && X.lg > 0) {
      const r = X.lg;
      a0 = lerp(1.32, 1.7, r);
      curv = i => lerp(0.02 + sway(i), 0.2, r);
    } else if (X.pose === 'eat') {
      const e = 0.5 + 0.5 * Math.sin(X.t * 2.2);
      a0 = 1.3 + e * 0.15;
      curv = i => 0.04 + e * 0.32 + sway(i);
    } else if (X.hurt) {
      a0 = 1.0 + Math.sin(X.t * 13) * 0.2;
      curv = i => 0.05 + Math.sin(X.t * 13 - i) * 0.12;
    } else {
      curv = i => 0.025 + sway(i) + (X.walking ? Math.sin(X.ph - i * 0.5) * 0.04 : 0) + (i >= n - 2 ? -curl * 0.55 : 0);
    }
    let TJ = chain([25.5, 4], a0, tl, n, curv);
    // keep the trunk tip above the ground: curl it up more if needed (groundY = ground in head-local y, unrotated)
    const ch = Math.cos(HA), sh = Math.sin(HA);
    for (let it = 0, extra = 0; it < 8; it++) {
      let lo = -1e9;
      for (const q of TJ) lo = Math.max(lo, q[0] * sh + q[1] * ch);
      if (lo < groundY - 4) break;
      extra -= 0.06;
      const e = extra, c0 = curv;
      TJ = chain([25.5, 4], a0, tl, n, i => c0(i) + (i >= n / 2 ? e : 0));
    }
    // ---- tusks (feature: tusks): spiral down-forward then up
    const fk = S.feat * (sp.features.indexOf('tusks') >= 0 ? 1 : 0.4);
    const tuskFill = isFrost ? H.linear(ctx, 20, 10, 90, 40, [[0, '#f2fcff'], [0.5, '#b8ecff'], [1, H.mix(P.acc, '#ffffff', 0.35)]]) : H.mix(P.acc, '#fffaf0', 0.15);
    const tusk = (ox, oy, dark) => {
      if (fk < 0.05) return;
      const k = fk, curlUp = 1 + Math.max(0, k - 1) * 0.6;
      const p0 = [18 + ox, 12 + oy];
      const p1 = [p0[0] + 6 * k, p0[1] + 34 * k], p2 = [p0[0] + 46 * k, p0[1] + 46 * k], p3 = [p0[0] + 62 * k, p0[1] + (20 - 22 * (curlUp - 1)) * k];
      const fill = dark ? (isFrost ? 'rgba(150,200,225,.95)' : H.shade(H.mix(P.acc, P.body, 0.15), -0.25)) : tuskFill;
      const C = cubicBlade(ctx, X, p0, p1, p2, p3, 11 * Math.min(1, 0.5 + k * 0.5), 2.2, fill, lw, isFrost ? 0 : 3);
      if (X.glowOn || isFrost) {
        glowLines(ctx, X, [[C[9], C[10], C[11], C[12]]], 1.3);
      }
    };
    tusk(-5, -3, true);
    // ---- ear (small, furry) and head
    const head = shape(MAM_HEAD, 3.8 * S.fluff, X.seed + 3, X.t, -0.3, 0.8);
    paint(ctx, X, head, H.volume(ctx, P.body, -40, 22), () => {
      H.ellipse(ctx, 6, -30, 16, 8, 0.2);
      ctx.fillStyle = H.rgba(P.mane, st === 3 ? 0.7 : 0.35);
      ctx.fill();
      fur(ctx, P, X.seed + 21, -14, -40, 28, 22, 40, 6, PI / 2 + 0.6, 1, 0.1);
      sheen(ctx, 10, -24, 16, 0.22);
      if (isFrost) frost(ctx, X, [[4, -32], [16, -26]], 3.2);
      if (st === 3) { scarLines(ctx, X, [[[8, -30], [14, -18], [13, -10]], [[20, -24], [24, -14]]], 0.9); }
      if (X.glowOn) { const arc = []; for (let i = 0; i <= 8; i++) { const a = -2.7 + i * 0.22; arc.push([8 + Math.cos(a) * 15, -14 + Math.sin(a) * 15]); } glowLines(ctx, X, [arc], 1.2); }
    }, lw, 6);
    // small furry ear at the back of the head
    const ear = shape([[-12, -16, 0.6], [-6, -16, 0.5], [-3, -9, 0.6], [-6, -2, 0.8], [-12, -4, 0.8], [-14, -10, 0.6]], 2.6, X.seed + 31, X.t, -0.3, 0.8);
    paint(ctx, X, ear, P.mane, null, lw * 0.8, 3);
    // mouth under the trunk base
    if (X.jw > 0.15) {
      const m = X.jw;
      H.smooth(ctx, [[12, 18], [20, 16], [24, 18 + m * 3], [18, 22 + m * 6], [12, 21 + m * 3]], true, 0.5);
      H.fillStroke(ctx, P.mouth, P.ink, lw * 0.8);
      H.ellipse(ctx, 17, 21 + m * 5, 4, 1.6);
      ctx.fillStyle = P.tongue;
      ctx.fill();
    } else {
      ctx.strokeStyle = H.rgba(P.ink, 0.7); ctx.lineWidth = 0.9;
      ctx.beginPath(); ctx.moveTo(13, 19); ctx.quadraticCurveTo(18, 21, 22, 18); ctx.stroke();
    }
    // ---- trunk
    const tw = st === 0 ? 0.85 : 1;
    const widths = [17 * tw, 15 * tw, 13 * tw, 11.5 * tw, 10 * tw, 9 * tw, 8 * tw, 7 * tw, 6.2 * tw];
    H.limb(ctx, TJ, widths, H.mix(P.body, P.belly, 0.12), P.ink, lw);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = H.rgba(P.ink, 0.38);
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    for (let i = 1; i < n; i++) {
      const a = TJ[i - 1], c = TJ[i + 1], q = TJ[i];
      let dx = c[0] - a[0], dy = c[1] - a[1];
      const l = Math.hypot(dx, dy) || 1;
      dx /= l; dy /= l;
      const w = widths[i] * 0.42;
      for (const f of [-0.25, 0.25]) {
        const qx = q[0] + dx * f * tl / n, qy = q[1] + dy * f * tl / n;
        ctx.moveTo(qx - dy * w, qy + dx * w); ctx.lineTo(qx + dy * w * 0.6, qy - dx * w * 0.6);
      }
    }
    ctx.stroke();
    // highlight along the front of the trunk
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const a = TJ[Math.max(0, i - 1)], c = TJ[Math.min(n, i + 1)];
      let dx = c[0] - a[0], dy = c[1] - a[1];
      const l = Math.hypot(dx, dy) || 1;
      const w = widths[i] * 0.28, qx = TJ[i][0] + dy / l * w, qy = TJ[i][1] - dx / l * w;
      if (i === 0) ctx.moveTo(qx, qy); else ctx.lineTo(qx, qy);
    }
    ctx.strokeStyle = 'rgba(255,248,232,.25)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
    // eye with wrinkles
    ctx.strokeStyle = H.rgba(P.ink, 0.4); ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.arc(14, -6, 4.5 * S.eye, PI * 0.15, PI * 0.85); ctx.stroke();
    eye(ctx, X, 14, -7, 2.3 * S.eye, {});
    tusk(0, 0, false);
  }
  register('elephant', elephant, { bounds: [-94, -185, 154, 3], shadowW: 150 });

  // =====================================================================================================
  // RHINO — woolly rhinoceros: shaggy fur, shoulder hump, low head, long front horn + smaller second horn.
  // =====================================================================================================
  const RHINO_HEAD = [[-12, -6, 0.8], [-6, -16, 0.7], [6, -17.5, 0.3], [18, -14, 0], [30, -10, 0], [40, -7, 0], [47, -4, 0],
    [49.5, 1.5, 0], [46.5, 7.5, 0], [38, 9.5, 0], [26, 11, 0], [12, 14, 0.5], [0, 15.5, 0.8], [-10, 10, 0.9]];

  function rhino(ctx, sp, o) {
    const X = poseOf(o, sp, 5.5), S = X.S, P = X.P, st = X.st;
    const lk = S.leg, hipH = 52, drop = hipH * (1 - lk);
    const lg = X.lg, rc = X.rc, atk = X.pose === 'attack';
    const dx = lg * 20 - rc * 9;
    const pitch = (atk ? lg * 0.05 : 0) - rc * 0.08 + (X.pose === 'roar' ? -0.04 : 0);
    const B = bodyFrame(-38, -52, pitch, dx, drop + X.bob);
    const yc = -58, chub = S.chub, bl = S.len * 0.97;
    const R = (x, y, f) => B(x * bl, yc + (y - yc) * chub, f);
    const b = X.br * 1.1;

    let hp = [40, -68], ha = 0.42 + X.look * 0.07;
    if (X.walking) ha += Math.sin(X.ph * 2) * 0.03;
    if (atk) { ha += lg < 0 ? -lg / 0.3 * 0.25 : -lg * 0.4; hp = [40 + Math.max(0, lg) * 4, -68]; }
    else if (X.hurt) { ha -= rc * 0.25; hp = [40 - rc * 3, -68 - rc * 2]; }
    else if (X.pose === 'eat') ha = 0.75 + Math.sin(X.t * 8) * 0.04;
    else if (X.pose === 'roar') ha = 0.1;
    const hs = S.head * 1.05;
    const HP = R(hp[0] / bl, hp[1]);
    let HA = ha + pitch;
    HA = clampHead(HP, HA, hs, [[12 + 37 * S.snout, 6], [12 + 26 * S.snout, 11], [0, 16]]);
    const hx = headFrame(HP, HA, hs);

    const ws = 0.92 + 0.08 * chub;
    const gF = gait(X, 0, 9 * lk, 5 * lk), gH = gait(X, PI, 9 * lk, 5 * lk);
    const drawLeg = (front, near, x, ph) => {
      const g = gait(X, ph, 9 * lk, 5 * lk);
      const fy = (near ? 0 : -1.5) - g[1];
      const fx = x * bl + g[0] + (front ? dx * 1.05 : dx * 0.35);
      const fill = near ? P.leg : P.far;
      if (front) {
        const J = foreLeg(R(x * 0.9 + 2, -50), fx, fy, 24 * lk, 21 * lk, 9 * lk, 0.12 + g[1] * 0.05);
        legTube(ctx, X, J, [26 * ws, 22 * ws, 17 * ws, 15 * ws, 16 * ws], fill, false);
        pillarFoot(ctx, X, J[3][0] + 1, J[3][1], 16 * ws, fill, '#cfc2a8');
      } else {
        const J = hindLeg(R(x * 0.95, -50), fx, fy, 25 * lk, 21 * lk, 9 * lk, 0.3);
        legTube(ctx, X, J, [28 * ws, 23 * ws, 17 * ws, 15 * ws, 16 * ws], fill, false);
        pillarFoot(ctx, X, J[3][0] + 1, J[3][1], 16 * ws, fill, '#cfc2a8');
      }
    };
    drawLeg(true, false, 22, PI);
    drawLeg(false, false, -30, 0);
    {
      const tb = R(-58, -62);
      const TJ = chain(tb, PI - 1.15 + Math.sin(X.t * 1.7) * 0.15 + (X.angry ? -0.5 : 0), 18 * S.tail, 3, () => 0.1);
      H.limb(ctx, TJ, [6, 5, 3.5, 3], P.dark, P.ink, LW);
      const tip = TJ[3];
      const tuft = shape([[tip[0] - 3, tip[1] - 2, 1], [tip[0] + 3, tip[1] - 1, 1], [tip[0] + 2, tip[1] + 7, 1], [tip[0] - 3, tip[1] + 6, 1]], 2.6, X.seed + 9, X.t, -0.2, 0.9);
      paint(ctx, X, tuft, P.mane, null, LW * 0.8, 3);
    }
    drawLeg(false, true, -38, PI);
    drawLeg(true, true, 29, 0);

    const fs = gF[0] * 0.3, hsx = gH[0] * 0.3;
    const pts = [
      R(-58, -62, 0.5), R(-48, -74, 0.5), R(-30, -77, 0.6), R(-8, -79, 0.7), R(10, -88, 0.9), R(24, -86, 0.9),
      hx(-13, -10, 1), hx(-6, 16, 1.1),
      R(44, -50, 1.1), R(40 + fs, -38, 1.2), R(28 + fs, -32 + b, 1.3), R(10, -31 + b, 1.4), R(-10, -31 + b, 1.4),
      R(-26 + hsx, -33, 1.3), R(-42 + hsx, -35, 1.1), R(-56, -44, 0.8), R(-62, -55, 0.6),
    ];
    const box = boxOf(pts, 6);
    const body = shape(pts, 3.8 * S.fluff, X.seed, X.t, -0.2, 1);
    paint(ctx, X, body, bodyGrad(ctx, P, box[1], box[3], 0.72), () => {
      let q = R(12, -80);
      H.ellipse(ctx, q[0], q[1], 26, 11, pitch - 0.2);
      ctx.fillStyle = H.rgba(P.mane, st === 3 ? 0.7 : 0.32);
      ctx.fill();
      q = R(-8, -38);
      H.ellipse(ctx, q[0], q[1], 50, 9, pitch);
      ctx.fillStyle = H.rgba(P.dark, 0.35);
      ctx.fill();
      q = R(22, -60); sheen(ctx, q[0], q[1], 22, 0.2);
      q = R(-36, -60); sheen(ctx, q[0], q[1], 20, 0.16);
      fur(ctx, P, X.seed, box[0], box[1], box[2], box[3], 140, 8.5, PI / 2 + 0.45, 1.2, 0.1);
      crease(ctx, X, [R(12, -76), R(16 + fs * 0.5, -56), R(22 + fs, -38)], 1.9);
      crease(ctx, X, [R(-24, -72), R(-22 + hsx * 0.5, -54), R(-28 + hsx, -38)], 1.9);
      rim(ctx, X, [R(-56, -63), R(-48, -73), R(-30, -76), R(-8, -78), R(10, -87), R(24, -85)], 2.6);
      snowCaps(ctx, X, [R(-46, -74), R(-28, -77), R(-10, -79), R(8, -86)], 6.5);
      if (st === 3) { q = R(-12, -56); clawScars(ctx, X, q[0], q[1], 1.1, 17, 1.1); }
      if (X.glowOn) glowLines(ctx, X, [[R(4, -76), R(12, -66), R(4, -56)], [R(16, -78), R(24, -68), R(16, -58)]], 1.6);
    }, LW * 0.95);

    ctx.save();
    ctx.translate(HP[0], HP[1]);
    ctx.rotate(HA);
    ctx.scale(hs, hs);
    rhinoHead(ctx, X, LW / hs);
    ctx.restore();
  }

  function rhinoHead(ctx, X, lw) {
    const P = X.P, S = X.S, st = X.st, k = S.snout, fk = S.feat;
    const sx = x => (x > 12 ? 12 + (x - 12) * k : x);
    const hornFill = H.linear(ctx, 0, 0, 0, -60, [[0, H.shade(P.horn, -0.35)], [0.35, P.horn], [1, H.shade(P.horn, 0.25)]]);
    // far ear
    const ear = (dx, fill) => {
      ctx.save();
      ctx.translate(-3 + dx, -15);
      ctx.rotate((X.angry || X.hurt ? -0.5 : Math.sin(X.t * 1.4) * 0.08) - 0.2);
      H.smooth(ctx, [[-4, 2], [-3, -6], [0, -11], [3, -5], [4, 2]], true, 0.5);
      H.fillStroke(ctx, fill, P.ink, lw);
      ctx.restore();
    };
    ear(5, P.far);
    // mouth opening (bellow / hurt)
    const ja = X.jw * 0.45;
    if (ja > 0.06) {
      const c = Math.cos(ja), s = Math.sin(ja);
      const J = (x, y) => [10 + (sx(x) - 10) * c - (y - 10) * s, 10 + (sx(x) - 10) * s + (y - 10) * c];
      H.poly(ctx, [[10, 10], [sx(30), 10], [sx(44), 8], J(42, 10), J(28, 11)], true);
      H.fillStroke(ctx, P.mouth, P.ink, lw);
      H.smooth(ctx, [J(10, 9), J(30, 10), J(42, 9.5), J(44, 13), J(30, 17), J(12, 17)], true, 0.4);
      H.fillStroke(ctx, H.mix(P.body, P.belly, 0.3), P.ink, lw);
    }
    const head = shape(snout('rhino', RHINO_HEAD, k, 12), 3.2 * S.fluff, X.seed + 3, X.t, -0.4, 0.8);
    paint(ctx, X, head, H.volume(ctx, P.body, -18, 15), () => {
      H.ellipse(ctx, sx(36), 6, 14 * k, 6, -0.1);
      ctx.fillStyle = H.rgba(P.belly, 0.55);
      ctx.fill();
      H.ellipse(ctx, 4, -12, 12, 6, 0.1);
      ctx.fillStyle = H.rgba(P.mane, 0.45);
      ctx.fill();
      fur(ctx, P, X.seed + 21, -12, -18, 30, 16, 34, 4, PI / 2 + 0.7, 0.9, 0.1);
      sheen(ctx, sx(26), -8, 12, 0.18);
      if (st === 3) { scarLines(ctx, X, [[[14, -14], [20, -4], [18, 4]]], 0.9); }
      if (X.glowOn) glowLines(ctx, X, [[[sx(34), -6], [sx(26), -9], [16, -10]]], 1.1);
    }, lw, 5);
    // horns: second (smaller) then the long front horn
    const h2 = 0.25 + 0.75 * fk;
    if (fk > 0.1) {
      const b0 = [sx(28), -10];
      cubicBlade(ctx, X, b0, [b0[0] + 3 * h2, b0[1] - 9 * h2], [b0[0] + 5 * h2, b0[1] - 16 * h2], [b0[0] + 3 * h2, b0[1] - 22 * h2], 11 * Math.min(1, 0.5 + h2 * 0.5), 2, hornFill, lw, 0);
    }
    const h1 = 0.2 + 0.8 * fk;
    {
      const b0 = [sx(41), -6];
      const C = cubicBlade(ctx, X, b0, [b0[0] + 8 * h1, b0[1] - 14 * h1], [b0[0] + 18 * h1, b0[1] - 30 * h1], [b0[0] + 22 * h1, b0[1] - 50 * h1],
        15 * Math.min(1, 0.45 + h1 * 0.55), 2.4, hornFill, lw, fk > 0.5 ? 3 : 0, 'rgba(120,100,70,.45)');
      if (X.glowOn) glowLines(ctx, X, [[C[0], C[2], C[4]]], 1.2);
    }
    // nostril, lip line, eye, near ear
    H.ellipse(ctx, sx(46), 1.5, 2, 1.4, 0.5);
    ctx.fillStyle = P.nose;
    ctx.fill();
    ctx.strokeStyle = H.rgba(P.ink, 0.7); ctx.lineWidth = 0.9;
    ctx.beginPath(); ctx.moveTo(sx(46), 7); ctx.quadraticCurveTo(sx(34), 11, 14, 12); ctx.stroke();
    eye(ctx, X, 18, -5, 2 * S.eye, {});
    ear(0, P.body);
  }
  register('rhino', rhino, { bounds: [-89, -146, 148, 3], shadowW: 130 });

  // =====================================================================================================
  // DEER — megaloceros: giant deer, enormous palmate antlers, slim legs, shoulder hump, maned neck.
  // =====================================================================================================
  const DEER_HEAD = [[-10, -4, 0.4], [-6, -11, 0.2], [4, -12.5, 0], [14, -10, 0], [24, -6.5, 0], [32, -3, 0], [35.5, 0.5, 0],
    [34, 4.5, 0], [26, 6, 0], [14, 7, 0], [4, 9, 0.5], [-7, 7, 0.6]];
  const DEER_LEGK = [0.9, 0.95, 1, 1.02];

  /**
   * Palmate antler in head-local units, base at (bx, by). size: 0 (nub) … 0.65 (forked spikes) … 1.3 (huge palm).
   * th = palm axis angle (≈ -2.4 = up and back). Tines grow on the upper rim of the palm.
   */
  function antler(ctx, X, bx, by, size, th, fill, lw, glowTips) {
    const P = X.P;
    if (size < 0.2) { // tiny velvet nubs
      H.ellipse(ctx, bx - 1, by - 2, 2.4, 3, -0.3);
      H.fillStroke(ctx, H.mix(P.body, P.horn, 0.4), P.ink, lw);
      return;
    }
    const s = size;
    ctx.save();
    ctx.translate(bx, by);
    if (s < 0.65) { // juvenile: forked spikes
      const t = s / 0.65;
      H.limb(ctx, [[0, 0], [-5 * t, -12 * t], [-12 * t, -24 * t]], [4.5, 3.4, 1.6], fill, P.ink, lw);
      H.limb(ctx, [[-4 * t, -9 * t], [3 * t, -17 * t], [7 * t, -24 * t]], [3.4, 2.4, 1.3], fill, P.ink, lw);
      ctx.restore();
      return;
    }
    // short beam with a forward brow tine
    const ox = -4 * s, oy = -9 * s;
    H.limb(ctx, [[1, 1], [-2 * s, -5 * s], [ox, oy]], [7 * s, 6.5 * s, 7 * s], fill, P.ink, lw);
    H.limb(ctx, [[-1.5 * s, -4 * s], [7 * s, -8 * s], [15 * s, -8 * s]], [4 * s, 2.8 * s, 1.2 * s], fill, P.ink, lw);
    // palm: axis u along th, v = upper side
    const L = 46 * s, W = 15 * s, T = 9 * s, n = s > 1.05 ? 7 : 6;
    const c = Math.cos(th), si = Math.sin(th);
    const M = (u, v) => [ox + u * c - v * si, oy + u * si + v * c];
    const wu = u => W * Math.pow(Math.sin(PI * clamp(u / L * 0.92 + 0.06, 0, 1)), 0.7);
    const pts = [M(0, -W * 0.25), M(L * 0.5, -W * 0.38), M(L * 0.92, -W * 0.15), M(L + T * 0.75, W * 0.1)];
    const tips = [pts[3]];
    for (let i = n - 1; i >= 0; i--) {
      const u = L * (0.18 + 0.74 * i / (n - 1)), g = L * 0.05, tl = T * (0.75 + 0.45 * hash(i * 3.7 + 1));
      pts.push(M(u + g, wu(u + g)));
      const tp = M(u + tl * 0.35, wu(u) + tl);
      pts.push(tp); tips.push(tp);
      pts.push(M(u - g, wu(u - g)));
    }
    pts.push(M(0, W * 0.35));
    H.poly(ctx, pts, true);
    H.fillStroke(ctx, fill, P.ink, lw);
    // palm shading: darker lower half, light grain towards each tine
    ctx.save();
    ctx.clip();
    const q0 = M(L * 0.5, -W * 0.5), q1 = M(L * 0.5, W * 0.5);
    ctx.strokeStyle = 'rgba(80,60,30,.2)'; ctx.lineWidth = W * 0.5;
    ctx.beginPath(); ctx.moveTo(...M(0, -W * 0.4)); ctx.lineTo(...M(L, -W * 0.4)); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,245,.38)'; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < tips.length; i++) { const a = M(L * (0.18 + 0.74 * (n - i) / (n - 1)) * 0.92, W * 0.1); ctx.moveTo(a[0], a[1]); ctx.lineTo(tips[i][0], tips[i][1]); }
    ctx.stroke();
    void q0; void q1;
    ctx.restore();
    if (glowTips) glowLines(ctx, X, tips.map(q => [q, [q[0] + 0.2, q[1] + 0.2]]), 1.7);
    ctx.restore();
  }

  function deer(ctx, sp, o) {
    const X = poseOf(o, sp, 6.5), S = X.S, P = X.P, st = X.st;
    const lk = DEER_LEGK[st], hipH = 70, drop = hipH * (1 - lk);
    const lg = X.lg, rc = X.rc, atk = X.pose === 'attack';
    const dx = lg * 20 - rc * 9;
    const pitch = (atk ? Math.max(0, lg) * 0.08 : 0) - rc * 0.08 + (X.pose === 'eat' ? 0.05 : 0);
    const B = bodyFrame(-36, -70, pitch, dx, drop + X.bob);
    const yc = -76, chub = S.chub, bl = S.len * 0.95;
    const R = (x, y, f) => B(x * bl, yc + (y - yc) * chub, f);
    const b = X.br * 0.9;

    // neck + head: pivot at the top of a long neck
    let hp = [48, -114], ha = 0.25 + X.look * 0.1;
    if (X.walking) { ha += Math.sin(X.ph * 2) * 0.04; hp = [50, -112]; }
    if (atk) {
      const w = lg < 0 ? -lg / 0.3 : 0, c = Math.max(0, lg);
      ha += -w * 0.25 + c * 0.95; hp = [48 + c * 10, -114 + c * 34 - w * 4];
    } else if (X.hurt) { ha -= rc * 0.4; hp = [44 - rc * 4, -116 - rc * 2]; }
    else if (X.pose === 'eat') { ha = 1.3 + Math.sin(X.t * 8) * 0.04; hp = [58, -46]; }
    else if (X.pose === 'roar') { ha = -0.55; hp = [54, -112]; }
    const hs = S.head * 1.28;
    const HP = R(hp[0] / bl, hp[1]);
    let HA = ha + pitch;
    HA = clampHead(HP, HA, hs, [[12 + 23 * S.snout, 3], [8, 9]]);
    const hx = headFrame(HP, HA, hs);

    const ws = 0.92 + 0.08 * chub;
    const hoof = (f, fill) => {
      H.poly(ctx, [[f[0] - 3.4, f[1] - 6], [f[0] + 3.2, f[1] - 6], [f[0] + 5.2, f[1]], [f[0] - 3.6, f[1]]], true);
      H.fillStroke(ctx, '#2c221a', P.ink, LW * 0.8);
      ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.moveTo(f[0] + 0.8, f[1] - 5); ctx.lineTo(f[0] + 1.6, f[1]); ctx.stroke();
    };
    const gF = gait(X, 0, 12 * lk, 8 * lk), gH = gait(X, PI, 12 * lk, 8 * lk);
    const drawLeg = (front, near, x, ph) => {
      const g = gait(X, ph, 12 * lk, 8 * lk);
      const fy = (near ? 0 : -1.5) - g[1];
      const fx = x * bl + g[0] + (front ? dx * 1.05 : dx * 0.4);
      const fill = near ? P.leg : P.far;
      if (front) {
        const J = foreLeg(R(x * 0.9 + 2, -66), fx, fy, 26 * lk, 26 * lk, 17 * lk, 0.1 + g[1] * 0.12);
        legTube(ctx, X, J, [17 * ws, 13 * ws, 7.5 * ws, 5.5 * ws, 5 * ws], fill, false);
        hoof(J[3], fill);
      } else {
        const J = hindLeg(R(x * 0.95, -68), fx, fy, 27 * lk, 26 * lk, 23 * lk, 0.3);
        legTube(ctx, X, J, [21 * ws, 15 * ws, 7.5 * ws, 5.5 * ws, 5 * ws], fill, false);
        hoof(J[3], fill);
      }
    };
    drawLeg(true, false, 22, PI);
    drawLeg(false, false, -30, 0);
    // short tail
    {
      const tb = R(-50, -88);
      const TJ = chain(tb, PI - 1.2 + Math.sin(X.t * 2.6) * 0.15 + (X.angry ? -0.5 : 0), 13 * S.tail, 2, () => 0.15);
      H.limb(ctx, TJ, [8, 7, 4.5], P.body, P.ink, LW);
    }
    drawLeg(false, true, -37, PI);
    drawLeg(true, true, 28, 0);

    const fs = gF[0] * 0.3, hsx = gH[0] * 0.3;
    const pts = [
      R(-52, -86, 0.1), R(-34, -92, 0.1), R(-12, -92, 0.15), R(8, -97, 0.3), R(22, -102, 0.5),
      hx(-12, -8, 0.6), hx(-4, 10, 0.9),
      R(46, -86, 1.1), R(44, -70, 1), R(38 + fs, -58, 0.5), R(28 + fs, -52, 0.3), R(14, -55 + b, 0.25),
      R(-6, -56 + b, 0.25), R(-22 + hsx, -56, 0.2), R(-30 + hsx, -50, 0.15), R(-42 + hsx, -50, 0.15), R(-54, -62, 0.1), R(-57, -76, 0.1),
    ];
    const box = boxOf(pts, 6);
    const body = shape(pts, 2.8 * S.fluff, X.seed, X.t, -0.2, 0.9);
    paint(ctx, X, body, bodyGrad(ctx, P, box[1], box[3], 0.66), () => {
      let q = R(30, -96);
      H.ellipse(ctx, q[0], q[1], 22, 12, pitch - 0.7);
      ctx.fillStyle = H.rgba(P.mane, st === 3 ? 0.65 : 0.35);
      ctx.fill();
      q = R(-52, -80);
      H.ellipse(ctx, q[0], q[1], 7, 10);
      ctx.fillStyle = H.rgba(P.belly, 0.45);
      ctx.fill();
      if (st === 0) H.spots(ctx, X.seed * 5 + 3, box[0] + 10, box[1] + 6, box[2] - 30, box[3] - 22, 22, 1.4, 2.6, 'rgba(250,246,236,.75)');
      q = R(24, -76); sheen(ctx, q[0], q[1], 18, 0.2);
      q = R(-34, -78); sheen(ctx, q[0], q[1], 18, 0.18);
      fur(ctx, P, X.seed, box[0], box[1], box[2], box[3], 130, 4.5, PI - 0.5, 0.9, 0.05);
      crease(ctx, X, [R(18, -88), R(22 + fs * 0.5, -72), R(28 + fs, -56)], 1.6);
      crease(ctx, X, [R(-24, -86), R(-20 + hsx * 0.5, -70), R(-26 + hsx, -54)], 1.6);
      rim(ctx, X, [R(-50, -87), R(-34, -91), R(-12, -91), R(8, -96), R(22, -101)], 2.4);
      snowCaps(ctx, X, [R(-40, -90), R(-22, -92), R(-4, -93), R(10, -97)], 5);
      if (st === 3) { q = R(-6, -72); clawScars(ctx, X, q[0], q[1], 1, 14, 0.9); }
      if (X.glowOn) glowLines(ctx, X, [[R(30, -88), R(36, -76), R(32, -64)]], 1.5);
    });

    ctx.save();
    ctx.translate(HP[0], HP[1]);
    ctx.rotate(HA);
    ctx.scale(hs, hs);
    deerHead(ctx, X, sp, LW / hs);
    ctx.restore();
  }

  function deerHead(ctx, X, sp, lw) {
    const P = X.P, S = X.S, st = X.st, k = S.snout;
    const sx = x => (x > 10 ? 10 + (x - 10) * k : x);
    const big = sp.features.indexOf('antlers') >= 0 ? 1 : 0.5;
    const asz = [0.1, 0.55, 1, 1.12][st] * big;
    const aFill = H.linear(ctx, 0, -6, -20, -50, [[0, H.shade(P.horn, -0.3)], [0.35, P.horn], [1, H.shade(P.horn, 0.18)]]);
    antler(ctx, X, 4, -10, asz * 0.92, -2.45, H.shade(P.horn, -0.3), lw, false);
    // far ear
    const ear = (dx, fill, inner) => {
      ctx.save();
      ctx.translate(-4 + dx, -9);
      ctx.rotate((X.angry || X.hurt ? 0.5 : Math.sin(X.t * 1.5 + dx) * 0.1) - 0.9);
      const es = st === 0 ? 1.3 : 1;
      ctx.scale(es, es);
      H.smooth(ctx, [[0, 2], [-3, -6], [0, -15], [4, -7], [4, 1]], true, 0.5);
      H.fillStroke(ctx, fill, P.ink, lw);
      if (inner) { H.smooth(ctx, [[0.5, 0], [-1, -6], [0.5, -12], [2.5, -6], [2.5, 0]], true, 0.5); ctx.fillStyle = 'rgba(90,60,50,.55)'; ctx.fill(); }
      ctx.restore();
    };
    ear(3, P.far, false);
    const ja = X.jw * 0.5;
    if (ja > 0.06) {
      const c = Math.cos(ja), s = Math.sin(ja);
      const J = (x, y) => [10 + (sx(x) - 10) * c - (y - 5) * s, 5 + (sx(x) - 10) * s + (y - 5) * c];
      H.poly(ctx, [[10, 5], [sx(26), 5], [sx(33), 4], J(31, 5), J(22, 6)], true);
      H.fillStroke(ctx, P.mouth, P.ink, lw);
      H.smooth(ctx, [J(10, 4.5), J(24, 5.5), J(32, 5), J(32, 7.5), J(22, 9), J(11, 9)], true, 0.4);
      H.fillStroke(ctx, H.mix(P.body, P.belly, 0.5), P.ink, lw);
    }
    const head = shape(snout('deer', DEER_HEAD, k, 10), 2.4 * S.fluff, X.seed + 3, X.t, -0.4, 0.8);
    paint(ctx, X, head, H.volume(ctx, P.body, -13, 9), () => {
      H.ellipse(ctx, sx(26), 4, 10 * k, 4.5);
      ctx.fillStyle = H.rgba(P.belly, 0.75);
      ctx.fill();
      H.ellipse(ctx, 6, 7, 9, 4);
      ctx.fillStyle = H.rgba(P.belly, 0.6);
      ctx.fill();
      H.ellipse(ctx, sx(20), -9, 10, 3, 0.25);
      ctx.fillStyle = H.rgba(P.lo, 0.3);
      ctx.fill();
      fur(ctx, P, X.seed + 21, -10, -13, 20, 9, 18, 2.8, PI - 0.3, 0.7, 0.05);
      if (st === 3) scarLines(ctx, X, [[[6, -12], [10, -4], [9, 2]]], 0.8);
    }, lw, 4.5);
    const nx = sx(34);
    H.ellipse(ctx, nx, 0.5, 2.6, 2.4);
    ctx.fillStyle = P.nose;
    ctx.fill();
    ctx.strokeStyle = H.rgba(P.ink, 0.65); ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(nx - 1, 3.5); ctx.quadraticCurveTo(sx(26), 5.6, 12, 6); ctx.stroke();
    eye(ctx, X, 9, -4, 2.3 * S.eye, {});
    ear(0, P.body, true);
    antler(ctx, X, -1, -10, asz, -3.0, aFill, lw, X.glowOn);
  }
  register('deer', deer, { bounds: [-69, -211, 151, 4], shadowW: 105 });

  // =====================================================================================================
  // GLYPTODON — huge domed shell of hexagonal plates, armoured head cap, ringed tail with a spiked club.
  // =====================================================================================================
  const GLYP_SHELL = [[-60, -30], [-58, -52], [-46, -74], [-26, -88], [-4, -93], [18, -87], [34, -71], [42, -51], [43, -32],
    [28, -25], [0, -23], [-30, -23], [-52, -25]];
  const GLYP_C = [-8, -58], GLYP_RX = 54, GLYP_RY = 37;
  const GLYP_HEAD = [[-10, -2], [-6, -11], [4, -14], [14, -11.5], [20, -6], [22.5, 1], [19.5, 7.5], [10, 11], [0, 11], [-8, 6]];
  /** Cached plate paths per hex size: seams (lines), rosettes (centres) and "spot" plates, projected on a dome. */
  const glypCache = new Map();
  function glypPlates(rn, seed) {
    const key = rn + '|' + seed;
    let G = glypCache.get(key);
    if (G) return G;
    const proj = (u, v) => {
      const r = Math.hypot(u, v), k = r > 0.0001 ? Math.sin(Math.min(r, 1) * PI / 2) / r : 1;
      return [GLYP_C[0] + u * k * GLYP_RX, GLYP_C[1] + v * k * GLYP_RY];
    };
    const seams = new Path2D(), ros = new Path2D(), spots = new Path2D(), glow = new Path2D();
    const w = rn * Math.sqrt(3), hgt = rn * 1.5;
    let row = 0;
    for (let v = -1.25; v <= 1.25; v += hgt, row++) {
      for (let u = -1.25 + (row % 2) * w / 2; u <= 1.25; u += w) {
        if (Math.hypot(u, v) > 1.18) continue;
        const vs = [];
        for (let i = 0; i < 6; i++) { const a = PI / 6 + i * PI / 3; vs.push(proj(u + Math.cos(a) * rn, v + Math.sin(a) * rn)); }
        seams.moveTo(vs[0][0], vs[0][1]);
        for (let i = 1; i < 6; i++) seams.lineTo(vs[i][0], vs[i][1]);
        seams.closePath();
        const c = proj(u, v), e = proj(u + rn * 0.42, v), f = proj(u, v + rn * 0.42);
        const rx = Math.max(0.6, Math.abs(e[0] - c[0])), ry = Math.max(0.6, Math.abs(f[1] - c[1]));
        ros.moveTo(c[0] + rx, c[1]);
        ros.ellipse(c[0], c[1], rx, ry, 0, 0, TAU);
        const h = hash(seed + u * 37.1 + v * 91.7);
        if (h < 0.2) { spots.moveTo(vs[0][0], vs[0][1]); for (let i = 1; i < 6; i++) spots.lineTo(vs[i][0], vs[i][1]); spots.closePath(); }
        if (Math.abs(v + 0.15) < hgt * 0.6 || h > 0.9) { glow.moveTo(vs[0][0], vs[0][1]); for (let i = 1; i < 6; i++) glow.lineTo(vs[i][0], vs[i][1]); glow.closePath(); }
      }
    }
    G = { seams, ros, spots, glow };
    glypCache.set(key, G);
    return G;
  }
  const glypSwing = k => (k < 0.3 ? -smoothstep(k / 0.3) * 0.2 : k < 0.55 ? -0.2 + 1.9 * smoothstep((k - 0.3) / 0.25) : 1.7 * (1 - smoothstep((k - 0.55) / 0.45)));

  function glyptodon(ctx, sp, o) {
    const X = poseOf(o, sp, 5), S = X.S, P = X.P, st = X.st;
    const lk = 0.85 + 0.15 * S.leg, hipH = 34, drop = hipH * (1 - lk);
    const lg = X.lg, rc = X.rc, atk = X.pose === 'attack';
    const dx = (atk ? Math.max(0, lg) * 10 : 0) - rc * 7;
    const pitch = (atk ? -Math.max(0, lg) * 0.04 : 0) - rc * 0.05 + (X.pose === 'eat' ? 0.03 : 0);
    const bob = X.bob * 0.6 + (X.walking ? Math.sin(X.ph) * 0.01 : 0);
    const B = bodyFrame(-8, -30, pitch, dx, drop + bob);
    const sx = S.len, sy = S.chub;
    const R = (x, y, f) => B(-8 + (x + 8) * sx, (y) * sy, f);

    // head: tucks in when hurt, pokes out to bite
    let hp = [40, -42], ha = 0.22 + X.look * 0.08;
    if (X.walking) ha += Math.sin(X.ph * 2) * 0.03;
    if (atk) { hp = [40 + Math.max(0, -lg) * -3, -42]; ha += 0.1 * Math.max(0, lg); }
    else if (X.hurt) { hp = [36 - rc * 5, -40]; ha -= rc * 0.2; }
    else if (X.pose === 'eat') { ha = 0.75 + Math.sin(X.t * 8) * 0.05; hp = [42, -36]; }
    else if (X.pose === 'roar') ha = -0.3;
    const hs = S.head * 1.08;
    const HP = R(hp[0], hp[1]);
    let HA = ha + pitch;
    HA = clampHead(HP, HA, hs, [[12 + 10 * S.snout, 8], [10, 11]]);

    const ws = 1;
    const gF = gait(X, 0, 7 * lk, 4 * lk), gH = gait(X, PI, 7 * lk, 4 * lk);
    void gF; void gH;
    const drawLeg = (front, near, x, ph) => {
      const g = gait(X, ph, 7 * lk, 4 * lk);
      const fy = (near ? 0 : -1.5) - g[1];
      const fx = x * sx + g[0] + (front ? dx : dx * 0.5);
      const fill = near ? P.leg : P.far;
      if (front) {
        const J = foreLeg(R(x * 0.9 + 1, -36), fx, fy, 17.5 * lk, 14 * lk, 8 * lk, 0.1 + g[1] * 0.05);
        legTube(ctx, X, J, [20 * ws, 18 * ws, 15 * ws, 14 * ws, 14 * ws], fill, false);
        pillarFoot(ctx, X, J[3][0] + 1, J[3][1], 14, fill, '#3a2e22');
      } else {
        const J = hindLeg(R(x * 0.95, -38), fx, fy, 18.5 * lk, 14 * lk, 9 * lk, 0.3);
        legTube(ctx, X, J, [22 * ws, 19 * ws, 15 * ws, 14 * ws, 14 * ws], fill, false);
        pillarFoot(ctx, X, J[3][0] + 1, J[3][1], 14, fill, '#3a2e22');
      }
    };
    drawLeg(true, false, 22, PI);
    drawLeg(false, false, -34, 0);

    // ---- armoured tail with a spiked club
    {
      const swing = atk ? glypSwing(X.k) : (X.angry ? 0.3 : 0) + Math.sin(X.t * 1.3) * 0.05 - (X.hurt ? 0.2 : 0);
      const tb = R(-58, -38);
      const a0 = PI - 0.25 + swing + pitch;
      const TJ = chain(tb, a0, 36 * S.tail, 5, i => swing * 0.14 + (X.walking ? Math.sin(X.ph - i) * 0.02 : 0));
      const tw = 0.8 + 0.2 * sy;
      H.limb(ctx, TJ, [17 * tw, 15 * tw, 13 * tw, 11.5 * tw, 10 * tw, 9 * tw], H.mix(P.body, P.acc, 0.15), P.ink, LW);
      ctx.save();
      ctx.strokeStyle = H.rgba(P.acc, 0.85); ctx.lineWidth = 1.4; ctx.lineCap = 'round';
      ctx.beginPath();
      for (let i = 1; i < 5; i++) {
        const a = TJ[i - 1], c = TJ[i + 1], q = TJ[i];
        let ddx = c[0] - a[0], ddy = c[1] - a[1];
        const l = Math.hypot(ddx, ddy) || 1, w = (15 - i * 1.6) * tw * 0.5;
        ddx /= l; ddy /= l;
        ctx.moveTo(q[0] - ddy * w, q[1] + ddx * w); ctx.quadraticCurveTo(q[0] + ddx * 2, q[1] + ddy * 2, q[0] + ddy * w, q[1] - ddx * w);
      }
      ctx.stroke();
      ctx.restore();
      // club
      const e = TJ[5], d = TJ[4], ca = Math.atan2(e[1] - d[1], e[0] - d[0]);
      const cs = 0.7 + 0.3 * Math.min(1.2, S.feat + 0.3), cl = st === 0 ? 0 : 7.5 * S.feat;
      const cx = e[0] + Math.cos(ca) * 6 * cs, cy = e[1] + Math.sin(ca) * 6 * cs;
      if (cl > 0.5) {
        ctx.fillStyle = H.mix(P.horn, '#e8dcc0', 0.3);
        ctx.strokeStyle = P.ink; ctx.lineWidth = LW * 0.7; ctx.lineJoin = 'round';
        for (let i = 0; i < 6; i++) {
          const a = ca + (i - 2.5) * 0.62;
          const bx = cx + Math.cos(a) * 9 * cs, by = cy + Math.sin(a) * 7 * cs;
          ctx.beginPath();
          ctx.moveTo(bx - Math.sin(a) * 3, by + Math.cos(a) * 3);
          ctx.lineTo(bx + Math.cos(a) * cl, by + Math.sin(a) * cl);
          ctx.lineTo(bx + Math.sin(a) * 3, by - Math.cos(a) * 3);
          ctx.closePath();
          ctx.fill(); ctx.stroke();
        }
      }
      H.ellipse(ctx, cx, cy, 12 * cs, 9 * cs, ca);
      H.fillStroke(ctx, H.radial(ctx, cx - 3, cy - 3, 1, 13 * cs, [[0, P.hi], [1, P.dark]]), P.ink, LW);
      ctx.strokeStyle = H.rgba(P.acc, 0.8); ctx.lineWidth = 1.1;
      ctx.beginPath(); ctx.ellipse(cx, cy, 7 * cs, 5 * cs, ca, 0, TAU); ctx.stroke();
    }

    drawLeg(false, true, -40, PI);
    drawLeg(true, true, 28, 0);

    // ---- head (under the front of the shell)
    ctx.save();
    ctx.translate(HP[0], HP[1]);
    ctx.rotate(HA);
    ctx.scale(hs, hs);
    glypHead(ctx, X, LW / hs);
    ctx.restore();

    // ---- shell, drawn in rest coordinates through the body frame
    ctx.save();
    const o0 = B(-8, 0);
    ctx.translate(o0[0], o0[1]);
    ctx.rotate(pitch);
    ctx.scale(sx, sy);
    ctx.translate(8, 0);
    const shellPath = new Path2D();
    H.smooth({ beginPath() {}, moveTo: (x, y) => shellPath.moveTo(x, y), lineTo: (x, y) => shellPath.lineTo(x, y),
      bezierCurveTo: (a, b2, c, d, e, f) => shellPath.bezierCurveTo(a, b2, c, d, e, f), closePath: () => shellPath.closePath() }, GLYP_SHELL, true, 0.5);
    const rn = [0.19, 0.155, 0.135, 0.125][st];
    const G = glypPlates(rn, sp.seed);
    const lw = LW / Math.sqrt(sx * sy);
    ctx.fillStyle = H.radial(ctx, -2, -82, 4, 78, [[0, P.light], [0.45, P.body], [1, P.lo]]);
    ctx.fill(shellPath);
    ctx.save();
    ctx.clip(shellPath);
    if (sp.pattern === 'spots') { ctx.fillStyle = H.rgba(P.acc, [0.18, 0.28, 0.32, 0.45][st]); ctx.fill(G.spots); }
    ctx.fillStyle = H.rgba(P.belly, [0.3, 0.38, 0.42, 0.36][st]);
    ctx.fill(G.ros);
    ctx.strokeStyle = H.rgba(H.shade(P.acc, -0.2), [0.45, 0.7, 0.8, 0.9][st]);
    ctx.lineWidth = [1.1, 1.4, 1.6, 1.8][st] / Math.sqrt(sx * sy);
    ctx.lineJoin = 'round';
    ctx.stroke(G.seams);
    if (st >= 1) { // light bevel on each plate
      ctx.save(); ctx.translate(-0.7, -0.7);
      ctx.strokeStyle = 'rgba(255,248,230,.18)'; ctx.lineWidth = 0.9;
      ctx.stroke(G.seams);
      ctx.restore();
    }
    if (X.glowOn) {
      const pulse = glowPulse(X);
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = H.rgba(P.glow, Math.min(1, 0.35 * pulse)); ctx.lineWidth = 4 * (1 + X.pow * 0.5); ctx.stroke(G.glow);
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = H.rgba(P.glowCore, Math.min(1, 0.9 * pulse)); ctx.lineWidth = 1.2; ctx.stroke(G.glow);
    }
    if (st === 3) scarLines(ctx, X, [[[-30, -70], [-14, -56], [-6, -40]], [[10, -80], [20, -66]]], 1);
    // rim band of small scales along the bottom edge
    ctx.fillStyle = H.rgba(P.dark, 0.55);
    ctx.fillRect(-64, -32, 112, 12);
    ctx.beginPath();
    for (let x = -58; x <= 40; x += 6.5) { ctx.moveTo(x + 3.2, -29); ctx.arc(x, -29, 3.2, 0, PI); }
    ctx.fillStyle = H.rgba(P.light, 0.35);
    ctx.fill();
    ctx.strokeStyle = H.rgba(P.ink, 0.5); ctx.lineWidth = 0.9;
    ctx.stroke();
    ctx.lineWidth = 9; ctx.strokeStyle = P.edge; ctx.stroke(shellPath);
    rim(ctx, X, [[-56, -54], [-46, -73], [-26, -87], [-4, -92], [18, -86], [33, -71]], 2.8);
    snowCaps(ctx, X, [[-40, -79], [-22, -88], [-4, -92], [14, -88], [28, -77]], 6);
    ctx.restore();
    ctx.lineWidth = lw; ctx.strokeStyle = P.ink; ctx.lineJoin = 'round';
    ctx.stroke(shellPath);
    ctx.restore();
  }

  function glypHead(ctx, X, lw) {
    const P = X.P, S = X.S, st = X.st, k = S.snout;
    const sxx = x => (x > 8 ? 8 + (x - 8) * k : x);
    const ja = X.jw * 0.45;
    if (ja > 0.06) {
      const c = Math.cos(ja), s = Math.sin(ja);
      const J = (x, y) => [6 + (sxx(x) - 6) * c - (y - 7) * s, 7 + (sxx(x) - 6) * s + (y - 7) * c];
      H.poly(ctx, [[6, 7], [sxx(16), 7], [sxx(20), 6], J(19, 7), J(12, 8)], true);
      H.fillStroke(ctx, P.mouth, P.ink, lw);
      H.smooth(ctx, [J(6, 7), J(14, 7.5), J(19, 7), J(19, 10), J(12, 12.5), J(5, 11)], true, 0.4);
      H.fillStroke(ctx, H.mix(P.body, P.belly, 0.4), P.ink, lw);
    }
    const head = snout('glyp', GLYP_HEAD, k, 8);
    paint(ctx, X, shape(head, 0, 0, 0), H.volume(ctx, P.body, -14, 11), () => {
      H.ellipse(ctx, sxx(17), 4, 7 * k, 4.5);
      ctx.fillStyle = H.rgba(P.belly, 0.6);
      ctx.fill();
      ctx.strokeStyle = H.rgba(P.ink, 0.3); ctx.lineWidth = 0.7;
      ctx.beginPath();
      for (let i = 0; i < 4; i++) { ctx.moveTo(-6 + i * 3, 2); ctx.lineTo(-4 + i * 3, 9); }
      ctx.stroke();
    }, lw, 4);
    // armoured head cap
    H.smooth(ctx, [[-6, -9], [2, -15.5], [12, -13.5], [sxx(18), -8], [10, -6.5], [0, -5.5]], true, 0.4);
    H.fillStroke(ctx, H.linear(ctx, 0, -16, 0, -5, [[0, P.light], [1, P.dark]]), P.ink, lw);
    ctx.strokeStyle = H.rgba(P.acc, 0.85); ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(1, -14.5); ctx.lineTo(3, -6); ctx.moveTo(8, -14.5); ctx.lineTo(8.5, -6.5); ctx.moveTo(13, -12.5); ctx.lineTo(sxx(14), -7);
    ctx.moveTo(-4, -10); ctx.lineTo(sxx(16), -10.5);
    ctx.stroke();
    H.ellipse(ctx, -6, -8, st === 0 ? 3.6 : 2.8, st === 0 ? 3.2 : 2.5);
    H.fillStroke(ctx, P.dark, P.ink, lw * 0.8);
    H.ellipse(ctx, sxx(21), 0, 1.4, 1.1);
    ctx.fillStyle = P.nose;
    ctx.fill();
    ctx.strokeStyle = H.rgba(P.ink, 0.65); ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(sxx(20), 6.5); ctx.quadraticCurveTo(sxx(14), 8, 6, 7.5); ctx.stroke();
    eye(ctx, X, 8, -2.5, 1.9 * S.eye, {});
  }
  register('glyptodon', glyptodon, { bounds: [-124, -101, 77, 4], shadowW: 125 });

  // =====================================================================================================
  // BIRD — dodo: plump grey flightless bird, big hooked beak, tiny wings, curly tail tuft, stubby yellow legs.
  // =====================================================================================================
  const DODO_HEAD = [[-14, -2, 0.3], [-12, -14, 0.2], [-2, -21, 0.1], [10, -20, 0], [17, -13, 0], [19, -4, 0], [16, 6, 0],
    [6, 11, 0.2], [-6, 11, 0.4], [-13, 6, 0.4]];
  const DODO_BEAK = [[13, -11], [26, -12.5], [38, -10.5], [47, -6], [51.5, 1], [50, 8.5], [45.5, 12.5], [44, 7], [40, 3.5], [28, 2.5], [15, 1.5]];
  const DODO_JAW = [[14, 2], [28, 3], [40, 4], [44.5, 6], [41, 9.5], [29, 10], [16, 8]];

  /** Feather scallops: rows of small arcs (call inside a clip). */
  function feathers(ctx, seed, x0, y0, x1, y1, r, col, colL) {
    const d = furData(seed + 77, 120);
    ctx.beginPath();
    let i = 0;
    for (let y = y0, row = 0; y < y1 + r; y += r * 1.25, row++) {
      for (let x = x0 + (row % 2) * r; x < x1 + r; x += r * 2) {
        const jx = (d[i % 480] - 0.5) * r * 0.5, jy = (d[(i + 1) % 480] - 0.5) * r * 0.4;
        i += 2;
        ctx.moveTo(x + jx - r, y + jy);
        ctx.quadraticCurveTo(x + jx, y + jy + r * 1.25, x + jx + r, y + jy);
      }
    }
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(0.8, r * 0.22);
    ctx.strokeStyle = col;
    ctx.stroke();
    if (colL) {
      ctx.save(); ctx.translate(0, -r * 0.3);
      ctx.strokeStyle = colL; ctx.lineWidth = Math.max(0.6, r * 0.14);
      ctx.stroke();
      ctx.restore();
    }
  }

  function bird(ctx, sp, o) {
    const X = poseOf(o, sp, 8), S = X.S, P = X.P, st = X.st;
    const lk = 0.6 + 0.4 * S.leg;
    const lg = X.lg, rc = X.rc, atk = X.pose === 'attack';
    const wad = X.walking ? Math.sin(X.ph) * 0.06 : 0;
    const dx = lg * 14 - rc * 8;
    const pitch = (atk ? Math.max(0, lg) * 0.22 - Math.max(0, -lg) * 0.3 : 0) - rc * 0.15 + wad + (X.pose === 'eat' ? 0.18 : 0) + (X.pose === 'roar' ? -0.12 : 0);
    const legH = 30 * lk;
    const B = bodyFrame(0, -legH, pitch, dx, (30 - legH) + X.bob * 1.5 - (X.pose === 'roar' ? 2 : 0));
    const chub = S.chub * (st === 0 ? 1.06 : 1), bl = S.len;
    const R = (x, y, f) => B(x * bl, -58 + (y + 58) * chub, f);
    const b = X.br * 1.2;

    let hp = [24, -100], ha = 0.04 + X.look * 0.14;
    if (X.walking) ha += Math.sin(X.ph * 2) * 0.05;
    if (atk) { ha += Math.max(0, lg) * 0.55 - Math.max(0, -lg) * 0.6; hp = [24 + Math.max(0, lg) * 10, -100 + Math.max(0, lg) * 12]; }
    else if (X.hurt) { ha -= rc * 0.4; hp = [22 - rc * 3, -102]; }
    else if (X.pose === 'eat') { ha = 1.05 + Math.max(0, Math.sin(X.t * 10)) * 0.25; hp = [32, -66]; }
    else if (X.pose === 'roar') { ha = -0.6; hp = [22, -104]; }
    const hs = S.head * 1.0;
    const HP = R(hp[0] / bl, hp[1]);
    let HA = ha + pitch;
    HA = clampHead(HP, HA, hs, [[12 + 38 * S.snout, 10], [12 + 32 * S.snout, 12], [0, 12]]);
    const hx = headFrame(HP, HA, hs);

    // ---- legs (stubby, yellow), far first
    const legCol = H.mix(P.acc, '#e8c040', 0.3), legFar = H.shade(legCol, -0.3);
    const drawLeg = (near, x, ph) => {
      const g = gait(X, ph, 9, 7);
      const hipP = R(x, -30);
      const fx = x * bl + g[0] + dx * 0.4 + (near ? 0 : 3), fy = (near ? 0 : -1.5) - g[1];
      const k = ik2(hipP[0], hipP[1], fx, fy - 4, 18 * lk, 16 * lk, 1);
      const fill = near ? legCol : legFar;
      H.limb(ctx, [hipP, [k[0], k[1]], [k[2], k[3]], [fx, fy - 1]], [11, 9, 7.5, 7], fill, P.ink, LW);
      ctx.strokeStyle = H.rgba(P.ink, 0.35); ctx.lineWidth = 0.8;
      ctx.beginPath();
      for (let i = 1; i < 4; i++) { const q = lerpPt([k[0], k[1]], [k[2], k[3]], i / 4); ctx.moveTo(q[0] - 3, q[1]); ctx.lineTo(q[0] + 3, q[1] + 0.6); }
      ctx.stroke();
      // toes: three forward, one back, dark claws
      const lift = g[1] > 0.5 ? 0.35 : 0;
      for (const [a, l] of [[-0.25 + lift, 13], [0.05 + lift, 12], [0.35 + lift, 9], [PI - 0.15, 6]]) {
        const ex = fx + Math.cos(a) * l, ey = fy - 2 + Math.sin(a) * l * 0.35;
        H.limb(ctx, [[fx, fy - 2.5], [ex, ey]], [4.4, 3], fill, P.ink, LW * 0.7);
        H.ellipse(ctx, ex + Math.cos(a) * 1.5, ey + 0.4, 1.6, 1.2, a);
        ctx.fillStyle = P.claw;
        ctx.fill();
      }
    };
    drawLeg(false, 6, PI);

    // ---- curly tail plume
    const plume = (dxp, a0, len, col) => {
      const base = R(-46 + dxp, -66);
      const J = chain(base, a0 + pitch + Math.sin(X.t * 2 + dxp) * 0.06 + (X.angry ? -0.2 : 0), len * S.tail, 5, i => (i < 2 ? 0.1 : 0.55));
      H.limb(ctx, J, [7, 7.5, 6.5, 5, 3.5, 2.2], col, P.ink, LW * 0.8);
    };
    if (st > 0) {
      plume(-2, -2.3, 26, H.shade(P.belly, -0.1));
      plume(2, -2.0, 30, P.belly);
      plume(6, -1.75, 24, H.shade(P.belly, 0.15));
    } else {
      const q = R(-50, -60);
      H.ellipse(ctx, q[0], q[1], 7, 6);
      H.fillStroke(ctx, P.belly, P.ink, LW * 0.8);
    }

    // far wing peeks above the back when flapping
    const flap = X.pose === 'roar' ? -0.9 + Math.sin(X.t * 22) * 0.45 : atk ? -0.5 * Math.max(0, lg) + Math.sin(X.t * 20) * 0.2 * Math.max(0, lg) : X.hurt ? -0.4 : Math.sin(X.t * 1.5) * 0.04;
    const wing = (near) => {
      const sh = R(near ? 6 : 10, near ? -76 : -82);
      ctx.save();
      ctx.translate(sh[0], sh[1]);
      ctx.rotate(pitch + flap * (near ? 1 : 0.8));
      const ws = [0.7, 0.85, 1, 1.1][st];
      ctx.scale(ws, ws);
      const fill = near ? H.shade(P.body, -0.08) : P.far;
      const pts = [[4, -2], [-8, -7], [-22, -4], [-30, 6], [-31, 15], [-25, 12], [-23, 19], [-17, 13], [-14, 18], [-9, 10], [-2, 9]];
      H.smooth(ctx, pts, true, 0.35);
      H.fillStroke(ctx, fill, P.ink, LW * 0.9 / ws);
      if (near) {
        ctx.save();
        ctx.clip();
        feathers(ctx, X.seed + 5, -30, -6, 4, 20, 3.6, H.rgba(P.ink, 0.28));
        ctx.strokeStyle = 'rgba(245,242,232,.6)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(-29, 12); ctx.lineTo(-24, 9); ctx.moveTo(-22, 16); ctx.lineTo(-17, 10); ctx.moveTo(-13, 15); ctx.lineTo(-9, 8); ctx.stroke();
        ctx.restore();
        if (X.glowOn) glowLines(ctx, X, [[[-4, 0], [-14, 4], [-24, 4]], [[-6, 5], [-15, 9]]], 1.3);
      }
      ctx.restore();
    };
    if (flap < -0.2) wing(false);

    // ---- body
    const pts = [
      R(-52, -56, 0.5), R(-44, -78, 0.3), R(-26, -92, 0.2), R(-2, -97, 0.2), R(16, -94, 0.25),
      hx(-13, -7, 0.4), hx(-7, 11, 0.5),
      R(38, -66, 0.4), R(36, -44, 0.4), R(20, -28 + b, 0.5), R(-6, -24 + b, 0.5), R(-28, -28, 0.55), R(-46, -40, 0.55),
    ];
    const box = boxOf(pts, 6);
    const body = shape(pts, (st === 0 ? 4.2 : 2) * S.fluff, X.seed, X.t, -0.3, 0.6);
    paint(ctx, X, body, bodyGrad(ctx, P, box[1], box[3], 0.62), () => {
      let q = R(-8, -36);
      H.ellipse(ctx, q[0], q[1], 34, 12, pitch);
      ctx.fillStyle = H.rgba(P.belly, 0.45);
      ctx.fill();
      q = R(-6, -78); sheen(ctx, q[0], q[1], 26, 0.22);
      feathers(ctx, X.seed, box[0], box[1], box[2], box[3], st === 0 ? 5 : 4.2, H.rgba(P.ink, st === 0 ? 0.12 : 0.2), 'rgba(255,255,255,.14)');
      if (st === 0) fur(ctx, P, X.seed, box[0], box[1], box[2], box[3], 60, 4, PI - 0.5, 0.9, 0.3);
      rim(ctx, X, [R(-44, -77), R(-26, -91), R(-2, -96), R(16, -93)], 2.4);
      snowCaps(ctx, X, [R(-36, -84), R(-18, -93), R(2, -96)], 5);
      if (st === 3) { q = R(-24, -54); clawScars(ctx, X, q[0], q[1], 1.2, 11, 0.8); }
    });
    drawLeg(true, -6, 0);
    wing(true);

    // ---- loose feathers when hurt
    if (X.hurt) {
      for (let i = 0; i < 3; i++) {
        const u = X.k, a = -1.2 - i * 0.7;
        const fx = HP[0] - 10 + Math.cos(a) * u * (20 + i * 8), fy = HP[1] + 10 + Math.sin(a) * u * (16 + i * 4) + u * u * 10;
        ctx.save();
        ctx.translate(fx, fy);
        ctx.rotate(u * 4 + i);
        H.ellipse(ctx, 0, 0, 5, 1.8);
        H.fillStroke(ctx, H.rgba(P.light, 1 - u * 0.7), H.rgba(P.ink, 0.6 * (1 - u * 0.5)), 0.8);
        ctx.restore();
      }
    }

    ctx.save();
    ctx.translate(HP[0], HP[1]);
    ctx.rotate(HA);
    ctx.scale(hs, hs);
    birdHead(ctx, X, LW / hs);
    ctx.restore();
  }

  function birdHead(ctx, X, lw) {
    const P = X.P, S = X.S, st = X.st, k = S.snout * (st === 3 ? 1.06 : 1);
    const sx = x => (x > 13 ? 13 + (x - 13) * k : x);
    const tip = H.mix(P.acc, '#9fc040', 0.45);
    const beakFill = H.linear(ctx, 13, 0, 13 + 38 * k, 0, [[0, '#5a5650'], [0.3, '#cfc8b4'], [0.7, H.mix('#e6dfc8', tip, 0.35)], [1, tip]]);
    const ja = X.jw * (X.pose === 'roar' ? 0.6 : 0.5);
    const c = Math.cos(ja), s = Math.sin(ja);
    const J = (x, y) => [14 + (sx(x) - 14) * c - (y - 3) * s, 3 + (sx(x) - 14) * s + (y - 3) * c];
    if (ja > 0.04) {
      H.poly(ctx, [[14, 2], [sx(28), 2.5], [sx(42), 4], J(40, 4), J(26, 3)], true);
      H.fillStroke(ctx, P.mouth, P.ink, lw);
      const tg = J(24, 5);
      H.ellipse(ctx, tg[0], tg[1], 6 * k, 1.8, ja);
      ctx.fillStyle = P.tongue;
      ctx.fill();
    }
    H.smooth(ctx, DODO_JAW.map(p => J(p[0], p[1])), true, 0.35);
    H.fillStroke(ctx, beakFill, P.ink, lw);
    // head
    const head = shape(DODO_HEAD, (st === 0 ? 3.4 : 1.6) * S.fluff, X.seed + 3, X.t, -0.5, 0.6);
    paint(ctx, X, head, H.volume(ctx, P.body, -21, 11), () => {
      H.ellipse(ctx, 10, -5, 10, 8, -0.2);
      ctx.fillStyle = H.mix(P.belly, '#d8c8b8', 0.5);
      ctx.fill();
      feathers(ctx, X.seed + 9, -16, -22, 6, 12, 3.2, H.rgba(P.ink, 0.18));
      if (st === 3) scarLines(ctx, X, [[[-6, -18], [-2, -8], [-4, 2]]], 0.9);
    }, lw, 4);
    // upper beak with the hooked tip
    H.smooth(ctx, snout('dodo', DODO_BEAK, k, 13), true, 0.35);
    H.fillStroke(ctx, beakFill, P.ink, lw);
    ctx.strokeStyle = 'rgba(255,255,245,.4)'; ctx.lineWidth = 1.2; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(17, -9.5); ctx.quadraticCurveTo(sx(34), -10.5, sx(46), -4); ctx.stroke();
    ctx.strokeStyle = H.rgba(P.ink, 0.55); ctx.lineWidth = 0.9;
    ctx.beginPath(); ctx.moveTo(sx(26), -6.5); ctx.quadraticCurveTo(sx(30), -7.5, sx(34), -6); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(sx(40), -5); ctx.quadraticCurveTo(sx(44), -3.5, sx(46), 1); ctx.stroke();
    // eye in a bare-skin ring
    const er = 3 * S.eye;
    H.ellipse(ctx, 7, -7, er * 1.6, er * 1.45);
    ctx.fillStyle = H.mix(P.belly, '#e8d8c8', 0.4);
    ctx.fill();
    eye(ctx, X, 7, -7, er, { iris: st === 3 ? '#ffe070' : '#e8d070', pupil: 'round', lid: P.body });
  }
  register('bird', bird, { bounds: [-74, -152, 103, 4], shadowW: 85 });
})(window.PC = window.PC || {});
