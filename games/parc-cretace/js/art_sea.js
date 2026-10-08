/* Crétacé Park — sea creature templates (art-sea module).
   Registers with PC.ART.registerTemplate: turtle, ichthyosaur, armoredfish, plesiosaur, mosasaur, shark, pliosaur.
   Local units: origin = seabed point under the creature, +x = towards the head, -y = up. Bodies float with their
   centre near y = -45 and bob gently. Templates read o.stage (0 Bébé … 3 Alpha) for proportions, colours and
   ornaments, and o.pose: 'swim' (idle), 'walk' (fast swim), 'attack', 'hurt', 'eat', 'roar'.
   Optional extras for the battle module (ignored when absent):
     o.move  — attack variant: 'bite' (default), 'charge' (ram, mouth shut), 'tail' (tail slap), 'claw' (flipper slap)
     o.power — 0..1 super-attack charge: eyes (and the open mouth) glow in the creature's class colour. */
(function (PC) {
  'use strict';
  const ART = PC.ART;
  if (!ART || !ART.registerTemplate || !ART.helpers) return;
  const H = ART.helpers;
  const PI = Math.PI, TAU = PI * 2;
  const LW = 2.2;   // outline width (local units)
  const CY = -45;   // height of the body centre above the seabed

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const sstep = x => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
  const bump = (k, c, w) => clamp(1 - Math.abs(k - c) / w, 0, 1);
  const has = (sp, f) => !!(sp.features && sp.features.indexOf(f) >= 0);
  const rot = (p, c, a) => {
    const s = Math.sin(a), co = Math.cos(a), x = p[0] - c[0], y = p[1] - c[1];
    return [c[0] + x * co - y * s, c[1] + x * s + y * co];
  };

  // ---------- Colour helpers ----------
  const toHex = (r, g, b) => '#' + [r, g, b].map(v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
  function hsl(hex) {
    const [r, g, b] = H.hexToRgb(hex).map(v => v / 255);
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
    if (mx === mn) return [0, 0, l];
    const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h / 6, s, l];
  }
  function fromHsl(h, s, l) {
    if (!s) return toHex(l * 255, l * 255, l * 255);
    const f = (p, q, t) => {
      t = (t + 1) % 1;
      return t < 1 / 6 ? p + (q - p) * 6 * t : t < 0.5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    return toHex(f(p, q, h + 1 / 3) * 255, f(p, q, h) * 255, f(p, q, h - 1 / 3) * 255);
  }
  const saturate = (hex, amt) => { const c = hsl(hex); return fromHsl(c[0], clamp(c[1] * (1 + amt), 0, 1), c[2]); };
  /** Bright, saturated version of a colour (greys fall back to a sea-cyan hue). */
  const vivid = (hex, l) => { const c = hsl(hex); return fromHsl(c[1] < 0.03 ? 0.52 : c[0], Math.max(0.8, c[1]), l); };

  // ---------- Evolution stages ----------
  // len: body length, head/eye: baby proportions, chub: roundness, fin: fin & flipper size,
  // feat: crests/frills/fangs, teeth: tooth length (0 = none), neck: neck length.
  const STAGE = [
    { len: 0.8, head: 1.32, eye: 1.65, chub: 1.16, fin: 0.84, feat: 0.2, teeth: 0, neck: 0.72 },
    { len: 0.91, head: 1.13, eye: 1.25, chub: 1.06, fin: 0.93, feat: 0.6, teeth: 0.6, neck: 0.87 },
    { len: 1, head: 1, eye: 1, chub: 1, fin: 1, feat: 1, teeth: 1, neck: 1 },
    { len: 1.02, head: 1.06, eye: 0.98, chub: 1.05, fin: 1.07, feat: 1.35, teeth: 1.3, neck: 1.02 },
  ];

  /** Palette per species and stage (cached: no colour maths per frame). */
  const palCache = new Map();
  function pal(sp, st) {
    const key = sp.id + '|' + st;
    let P = palCache.get(key);
    if (P) return P;
    let body = sp.colors.body, belly = sp.colors.belly, acc = sp.colors.accent;
    if (st === 0) { body = H.shade(H.mix(body, belly, 0.3), 0.12); belly = H.shade(belly, 0.14); acc = H.mix(acc, belly, 0.35); }
    else if (st === 1) { body = H.mix(body, belly, 0.12); acc = H.mix(acc, belly, 0.12); }
    else if (st === 3) { body = saturate(H.shade(body, -0.2), 0.45); belly = saturate(H.shade(belly, -0.05), 0.25); acc = saturate(H.shade(acc, -0.05), 0.5); }
    const ink = H.ink(body), fin = H.shade(H.mix(body, acc, 0.22), -0.05), shell = H.mix(body, acc, 0.4);
    P = {
      body, belly, acc, ink,
      dorsal: H.shade(body, -0.18), under: H.shade(body, -0.34),
      fin, finFar: H.shade(fin, -0.34), far: H.shade(body, -0.32),
      finEdge: H.rgba(H.shade(body, 0.6), 0.5),
      jaw: H.mix(belly, body, 0.22), jawShade: H.rgba(H.shade(body, -0.5), 0.22),
      pat: H.rgba(H.shade(H.mix(body, acc, st === 3 ? 0.6 : 0.35), -0.42), [0.24, 0.36, 0.48, 0.74][st]),
      texD: H.rgba(H.shade(body, -0.55), 0.2), texL: H.rgba(H.shade(body, 0.7), 0.16),
      rim: H.rgba(H.shade(body, 0.8), 0.6), bellyEdge: H.rgba(belly, 0.5),
      mouth: '#5c1d24', mouthDeep: '#2b0b10', tongue: '#b4565e', tooth: '#f8f3e4',
      bone: H.mix('#e2d6ba', body, 0.3), boneDark: H.shade(H.mix('#e2d6ba', body, 0.45), -0.35),
      boneA: H.rgba(H.mix('#e2d6ba', body, 0.3), 0.72),
      shell, shellTop: H.shade(shell, 0.1), shellLow: H.shade(shell, -0.38), shellLight: H.shade(shell, 0.35),
      beak: H.shade(H.mix(body, '#3a3226', 0.55), -0.05), skin: H.mix(body, belly, 0.12),
      scar: 'rgba(252,240,226,.92)', scarDark: H.rgba(ink, 0.45),
      glow: vivid(acc, 0.6), glowCore: vivid(acc, 0.88),
    };
    palCache.set(key, P);
    return P;
  }

  /** Cached random numbers per seed (stable texture / pattern placement without per-frame RNG work). */
  const rndCache = new Map();
  function rnd(seed, n) {
    let d = rndCache.get(seed);
    if (!d || d.length < n) {
      const r = H.rng(seed);
      d = new Float32Array(n);
      for (let i = 0; i < n; i++) d[i] = r();
      rndCache.set(seed, d);
    }
    return d;
  }

  // ---------- Animation state ----------
  function anim(o, sp) {
    const st = clamp(o.stage == null ? 3 : o.stage | 0, 0, 3);
    let pose = o.pose || 'swim';
    if (pose === 'idle') pose = 'swim';
    const t = o.t || 0, k = clamp(o.k || 0, 0, 1), seed = sp.seed || 1;
    const mv = pose === 'attack' ? String(o.move || 'bite') : '';
    const ram = /charge|head|horn|club|stomp|ram/.test(mv), whip = /tail|queue/.test(mv), slash = /claw|griffe|slash|fin/.test(mv);
    const spd = pose === 'walk' ? 7.5 : pose === 'attack' ? 6.5 : pose === 'hurt' ? 2.5 : pose === 'roar' ? 2.4 : 3.3;
    const ph = t * spd + seed * 1.7;
    const lg = H.lunge(o), rc = H.recoil(o);
    const A = {
      st, S: STAGE[st], P: pal(sp, st), t, k, pose, seed, ph, lg, rc, ram, whip, slash,
      beat: Math.cos(ph), wamp: 1, bob: Math.sin(t * 1.25 + seed) * 2.6, dx: 0,
      pitch: Math.sin(t * 0.8 + seed) * 0.02, bend: 0, fl: Math.sin(ph) * 0.3,
      hp: Math.sin(t * 0.7 + seed) * 0.06 + Math.sin(t * 1.9) * 0.02, jw: H.jaw(o),
      hurt: pose === 'hurt', angry: pose === 'attack' || pose === 'roar',
      blink: pose !== 'hurt' && pose !== 'attack' && ((t + seed * 0.73) % 4.2) < 0.13,
      power: clamp(+o.power || 0, 0, 1), strike: 0, snap: 0, neck: 0, noFx: o.fx === false,
    };
    if (pose === 'walk') { A.wamp = 1.5; A.pitch += 0.035; A.fl = Math.sin(ph) * 0.48; A.bob *= 0.5; }
    else if (pose === 'attack') {
      A.bob *= 0.3; A.wamp = 1.2;
      A.strike = clamp((lg - 0.2) / 0.8, 0, 1);
      if (whip) {
        // tail slap: tail rises (wind-up), whips down (strike), settles
        const w = k < 0.3 ? 0.8 * sstep(k / 0.3) : k < 0.55 ? 0.8 - 1.45 * sstep((k - 0.3) / 0.25) : -0.65 * (1 - sstep((k - 0.55) / 0.45));
        A.bend = w; A.dx = lg * 10; A.pitch += w * 0.07; A.jw = 0.12; A.fl = -w * 0.3;
      } else {
        A.dx = lg * (ram ? 26 : 21);
        A.pitch += lg < 0 ? lg * 0.28 : lg * (ram ? 0.1 : 0.03);
        A.hp = lg < 0 ? lg * 0.6 : lg * 0.1;
        A.neck = lg;
        A.fl = lg < 0 ? (-lg / 0.3) * 0.5 : -lg * 0.6;   // flippers pulled back, then thrust
        if (ram) A.jw = 0.06;
        else if (slash) { A.fl = lg < 0 ? (-lg / 0.3) * 0.8 : -lg * 1.5; A.jw = 0.3 + 0.3 * Math.max(0, lg); }
        else {
          // bite: gape during the wind-up, wide open on the approach, SNAP shut at impact, chomp
          A.jw = k < 0.25 ? 0.15 + 0.85 * sstep(k / 0.25) : k < 0.5 ? 1 : k < 0.58 ? 1 - 0.92 * sstep((k - 0.5) / 0.08)
            : 0.08 + 0.14 * Math.max(0, Math.sin((k - 0.58) * 30)) * (1 - k);
          A.snap = bump(k, 0.57, 0.07);
        }
      }
    } else if (pose === 'hurt') {
      A.dx = -rc * 15; A.pitch -= rc * 0.22; A.bend = rc * 0.9; A.wamp = 0.4; A.fl = -0.55 * rc;
      A.hp = -0.35 * rc; A.bob *= 0.4; A.jw = 0.12 + 0.45 * rc; A.neck = -rc;
    } else if (pose === 'roar') {
      A.pitch -= 0.15; A.bend = 0.3; A.wamp = 0.5; A.fl = -0.35 + Math.sin(ph) * 0.12; A.hp = -0.4;
      A.jw = 0.86 + 0.06 * Math.sin(t * 22);
    } else if (pose === 'eat') {
      A.pitch += 0.05; A.dx = Math.max(0, Math.sin(t * 9)) * 2.5; A.hp = 0.28 + 0.08 * Math.sin(t * 9);
    }
    return A;
  }

  // ---------- Body geometry ----------
  /**
   * Build a swimming body from a design profile. prof rows = [x, up, dn] (adult design units, tail first, snout last):
   * centreline at y = 0, `up` = back thickness, `dn` = belly thickness. Babies get a shorter body and a bigger head
   * (x > opt.hx). A vertical travelling wave (growing towards the tail) and a tail bend animate the spine.
   * B.px(x, y) maps any design point (fins, eyes, jaws) through the same stage scaling and wave.
   */
  function makeBody(A, prof, opt) {
    const S = A.S, n = prof.length, hx = opt.hx, th0 = opt.thick || 1, hs = S.head * (opt.headScale || 1);
    const mx = x => (x <= hx ? x * S.len : hx * S.len + (x - hx) * hs);
    const tk = x => th0 * lerp(S.chub, hs, sstep((x - hx + 8) / 16));
    const xT = mx(prof[0][0]), xH = mx(prof[n - 1][0]), span = xH - xT;
    const amp = A.wamp * (opt.wave == null ? 5 : opt.wave), wl = opt.wl || 34, bend = A.bend * (opt.bendAmp == null ? 16 : opt.bendAmp);
    const wy = X => {
      const e = Math.pow(clamp((xH - X) / span, 0, 1.25), 1.6);
      return amp * e * Math.sin(A.ph - (xH - X) / wl) - bend * e * e;
    };
    const B = { n, x: [], y: [], up: [], dn: [], nx: [], ny: [], mx, tk, wy, pts: null, tail: null };
    for (let i = 0; i < n; i++) {
      const r = prof[i], X = mx(r[0]), kk = tk(r[0]);
      B.x.push(X); B.y.push(wy(X)); B.up.push(r[1] * kk); B.dn.push(r[2] * kk);
    }
    normals(B);
    B.px = (x, y) => { const X = mx(x); return [X, y * tk(x) + wy(X)]; };
    if (opt.tailTip) {
      const dx = B.x[0] - B.x[1], dy = B.y[0] - B.y[1], l = Math.hypot(dx, dy) || 1;
      B.tail = [B.x[0] + dx / l * opt.tailTip, B.y[0] + dy / l * opt.tailTip];
    }
    return B;
  }
  function normals(B) {
    const n = B.n;
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
      const dx = B.x[b] - B.x[a], dy = B.y[b] - B.y[a], l = Math.hypot(dx, dy) || 1;
      B.nx[i] = dy / l; B.ny[i] = -dx / l;   // "up" normal
    }
    B.pts = null;
  }
  /** Point at fractional station u, v = +1 back edge, 0 centreline, -1 belly edge. */
  function at(B, u, v) {
    u = clamp(u, 0, B.n - 1);
    const i = Math.min(B.n - 2, Math.floor(u)), f = u - i;
    const x = lerp(B.x[i], B.x[i + 1], f), y = lerp(B.y[i], B.y[i + 1], f);
    const nx = lerp(B.nx[i], B.nx[i + 1], f), ny = lerp(B.ny[i], B.ny[i + 1], f);
    const h = v >= 0 ? lerp(B.up[i], B.up[i + 1], f) : lerp(B.dn[i], B.dn[i + 1], f);
    return [x + nx * v * h, y + ny * v * h];
  }
  function nrm(B, u) {
    u = clamp(u, 0, B.n - 1);
    const i = Math.min(B.n - 2, Math.floor(u)), f = u - i;
    return [lerp(B.nx[i], B.nx[i + 1], f), lerp(B.ny[i], B.ny[i + 1], f)];
  }
  /** Station index for a design x (body must be monotonic in x there). */
  function U(B, x) {
    const X = B.mx(x);
    if (X <= B.x[0]) return 0;
    for (let i = 0; i < B.n - 1; i++) if (X <= B.x[i + 1]) return i + (X - B.x[i]) / ((B.x[i + 1] - B.x[i]) || 1);
    return B.n - 1;
  }
  function bodyPts(B) {
    if (B.pts) return B.pts;
    const pts = [];
    if (B.tail) pts.push(B.tail);
    for (let i = 0; i < B.n; i++) pts.push([B.x[i] + B.nx[i] * B.up[i], B.y[i] + B.ny[i] * B.up[i]]);
    for (let i = B.n - 1; i >= 0; i--) pts.push([B.x[i] - B.nx[i] * B.dn[i], B.y[i] - B.ny[i] * B.dn[i]]);
    let y0 = 1e9, y1 = -1e9;
    for (const p of pts) { if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
    B.y0 = y0; B.y1 = y1;
    return (B.pts = pts);
  }
  const bodyPath = (ctx, B) => H.smooth(ctx, bodyPts(B), true, 0.5);
  function edgePath(ctx, B, u0, u1, v, step) {
    step = step || 0.5;
    ctx.beginPath();
    for (let u = u0, first = true; ; u += step) {
      const p = at(B, Math.min(u, u1), typeof v === 'function' ? v(u) : v);
      if (first) { ctx.moveTo(p[0], p[1]); first = false; } else ctx.lineTo(p[0], p[1]);
      if (u >= u1) break;
    }
  }

  // ---------- Skin painting ----------
  /** Species pattern mapped onto the body so it follows the undulation (call inside a clip). */
  function pattern(ctx, A, sp, B, R) {
    if (!R || sp.pattern === 'none' || !sp.pattern) return;
    const st = A.st, P = A.P, s = (R.s || 1) * [0.8, 0.9, 1, 1.22][st];
    const d = rnd(sp.seed * 97 + 11, 160);
    if (sp.pattern === 'spots') {
      const cnt = Math.min(50, Math.round((R.n || 18) * [0.6, 0.8, 1, 1.25][st]));
      ctx.beginPath();
      for (let i = 0; i < cnt; i++) {
        const p = at(B, lerp(R.u0, R.u1, d[i * 3]), lerp(R.v0, R.v1, d[i * 3 + 1])), rr = (1.5 + d[i * 3 + 2] * 2.6) * s;
        ctx.moveTo(p[0] + rr * 1.25, p[1]);
        ctx.ellipse(p[0], p[1], rr * 1.25, rr * (0.75 + d[i * 3 + 1] * 0.3), d[i * 3 + 2] - 0.5, 0, TAU);
      }
      ctx.fillStyle = P.pat; ctx.fill();
    } else {
      const cnt = Math.min(40, Math.round((R.n || 9) * [0.7, 0.85, 1, 1.15][st]));
      ctx.strokeStyle = P.pat; ctx.lineCap = 'round';
      for (let i = 0; i < cnt; i++) {
        const u = lerp(R.u0, R.u1, (i + 0.5) / cnt) + (d[i * 3] - 0.5) * 0.2;
        const a = at(B, u, 1.15), m = at(B, u - 0.1, 0.6), b = at(B, u - 0.22 - d[i * 3 + 1] * 0.12, lerp(R.v0, 0.45, d[i * 3 + 2]));
        ctx.lineWidth = (2.2 + d[i * 3 + 1] * 1.6) * s;
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.quadraticCurveTo(m[0], m[1], b[0], b[1]); ctx.stroke();
      }
    }
  }
  /** Fine scale / leather texture: dark specks with a light bead (call inside a clip). */
  function texture(ctx, A, sp, B, T) {
    const P = A.P, n = T.n || 40, d = rnd(sp.seed * 31 + 7, 3 * 120), r0 = T.r || 0.8;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const p = at(B, lerp(T.u0, T.u1, d[i * 3]), d[i * 3 + 1] * 1.8 - 0.9), r = r0 * (0.6 + d[i * 3 + 2] * 0.8);
      ctx.moveTo(p[0] + r, p[1]); ctx.arc(p[0], p[1], r, 0, TAU);
    }
    ctx.fillStyle = P.texD; ctx.fill();
    ctx.beginPath();
    for (let i = 0; i < n; i += 2) {
      const p = at(B, lerp(T.u0, T.u1, d[i * 3]), d[i * 3 + 1] * 1.8 - 0.9), r = r0 * 0.45 * (0.6 + d[i * 3 + 2] * 0.8);
      ctx.moveTo(p[0] - r * 0.5 + r, p[1] - r * 0.8); ctx.arc(p[0] - r * 0.5, p[1] - r * 0.8, r, 0, TAU);
    }
    ctx.fillStyle = P.texL; ctx.fill();
  }
  /** Moving dappled sunlight on the back (call inside a clip). */
  function caustics(ctx, A, B, u0, u1, k) {
    const t = A.t, n = 7;
    k = k || 1;
    for (let i = 0; i < n; i++) {
      const a = 0.11 + 0.1 * Math.sin(t * 1.7 + i * 2.4);
      if (a <= 0.03) continue;
      const u = lerp(u0, u1, (i + 0.5) / n) + Math.sin(t * 0.55 + i * 1.9) * 0.35;
      const p = at(B, u, 0.6 + 0.2 * Math.sin(i * 2.3 + 0.4));
      ctx.fillStyle = 'rgba(226,250,255,' + a.toFixed(3) + ')';
      H.ellipse(ctx, p[0], p[1], (5 + 2.5 * Math.sin(i * 1.3 + t * 0.9)) * k, 1.8 * k, Math.sin(i) * 0.4);
      ctx.fill();
    }
  }
  /** Pale battle scars (Alpha): a triple claw slash, a long stitched scar and a small nick, spread along the body. */
  function scars(ctx, A, sp, B, R) {
    const d = rnd(sp.seed * 53 + 5, 12), P = A.P, s = R.s || 1;
    const spots = [[0.2, 0.75, 9, 3], [0.6, 0.35, 15, 1], [0.88, 0.62, 6, 1]];
    ctx.save();
    ctx.lineCap = 'round';
    for (let pass = 0; pass < 2; pass++) {
      ctx.beginPath();
      for (let i = 0; i < 3; i++) {
        const S = spots[i];
        const p = at(B, lerp(R.u0, R.u1, S[0] + (d[i * 3] - 0.5) * 0.1), lerp(R.v0, R.v1, S[1]));
        const len = S[2] * s * (0.85 + d[i * 3 + 1] * 0.3), a = -1.05 + (d[i * 3 + 2] - 0.5) * 0.5 + (i === 2 ? 0.5 : 0);
        const cx = Math.cos(a) * len / 2, cy = Math.sin(a) * len / 2, ox0 = pass ? 0 : 0.5, oy0 = pass ? 0 : 0.7;
        for (let j = 0; j < S[3]; j++) {
          const off = (j - (S[3] - 1) / 2) * 3 * s, ox = -Math.sin(a) * off + ox0 + j * 1.5 * Math.cos(a), oy = Math.cos(a) * off + oy0 + j * 1.5 * Math.sin(a);
          ctx.moveTo(p[0] + ox - cx, p[1] + oy - cy);
          ctx.quadraticCurveTo(p[0] + ox + cy * 0.18, p[1] + oy - cx * 0.18, p[0] + ox + cx, p[1] + oy + cy);
        }
        if (i === 1) {
          // stitch ticks across the long scar
          for (let j = -1; j <= 1; j++) {
            const qx = p[0] + cx * j * 0.55 + ox0, qy = p[1] + cy * j * 0.55 + oy0, nx = -Math.sin(a) * 2 * s, ny = Math.cos(a) * 2 * s;
            ctx.moveTo(qx - nx, qy - ny); ctx.lineTo(qx + nx, qy + ny);
          }
        }
      }
      ctx.strokeStyle = pass ? P.scar : P.scarDark;
      ctx.lineWidth = (pass ? 1.1 : 2.2) * Math.sqrt(s);
      ctx.stroke();
    }
    ctx.restore();
  }
  /** Pulsing glowing marking along the path built by pathFn (Alpha stage / bioluminescence). */
  function glow(ctx, A, pathFn, w) {
    const P = A.P, pulse = 0.72 + 0.28 * Math.sin(A.t * 3.2);
    ctx.save();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.globalCompositeOperation = 'lighter';
    pathFn();
    ctx.strokeStyle = H.rgba(P.glow, 0.2 * pulse); ctx.lineWidth = w * 3.2; ctx.stroke();
    ctx.strokeStyle = H.rgba(P.glow, 0.4 * pulse); ctx.lineWidth = w * 1.7; ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = H.rgba(P.glowCore, 0.9); ctx.lineWidth = w * 0.75; ctx.stroke();
    ctx.restore();
  }
  /** Glowing dots (photophores). pts = [[x, y, r], …]. */
  function glowDots(ctx, A, pts) {
    const P = A.P;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let pass = 0; pass < 2; pass++) {
      ctx.beginPath();
      for (let i = 0; i < pts.length; i++) {
        const q = pts[i], r = q[2] * (pass ? 1 : 2.4) * (0.8 + 0.2 * Math.sin(A.t * 3 + i * 1.7));
        ctx.moveTo(q[0] + r, q[1]); ctx.arc(q[0], q[1], r, 0, TAU);
      }
      ctx.fillStyle = pass ? P.glowCore : H.rgba(P.glow, 0.32);
      ctx.fill();
    }
    ctx.restore();
  }

  /**
   * Fill and shade a body: volume gradient, countershaded belly band, pattern, texture, extra details,
   * underside shading, flank highlight, caustics, rim light, Alpha scars and glow, outline.
   * o: { cols, belly: false | { v (number | fn(u)), u0, u1 }, pat, tex, cau: [u0, u1, k], hl: [u, v, rx, ry],
   *      scar: { u0, u1, v0, v1, s }, glow: pathFn, glowW, extra: fn, late: fn }
   */
  function skin(ctx, A, sp, B, o) {
    const P = A.P, n1 = B.n - 1;
    bodyPts(B);
    const cols = o.cols || [P.dorsal, P.body, P.under];
    bodyPath(ctx, B);
    ctx.fillStyle = H.linear(ctx, 0, B.y0, 0, B.y1, [[0, cols[0]], [0.42, cols[1]], [1, cols[2]]]);
    ctx.fill();
    ctx.save();
    ctx.clip();
    if (o.belly !== false) {
      const bl = o.belly || {}, u0 = bl.u0 || 0, u1 = bl.u1 == null ? n1 : bl.u1, vb = bl.v == null ? -0.2 : bl.v;
      const vf = typeof vb === 'function' ? vb : () => vb;
      ctx.beginPath();
      for (let u = u0; u <= u1 + 1e-6; u += 0.5) { const p = at(B, u, vf(u)); if (u === u0) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]); }
      for (let u = u1; u >= u0 - 1e-6; u -= 0.5) { const p = at(B, u, -1.7); ctx.lineTo(p[0], p[1]); }
      ctx.closePath();
      ctx.fillStyle = P.belly; ctx.fill();
      edgePath(ctx, B, u0, u1, vf);
      ctx.strokeStyle = P.bellyEdge; ctx.lineWidth = 4; ctx.stroke();
    }
    pattern(ctx, A, sp, B, o.pat);
    if (o.tex !== false) texture(ctx, A, sp, B, o.tex || { u0: 0.3, u1: n1, n: 40 });
    if (o.extra) o.extra();
    // underside occlusion, broad back light, flank highlight
    edgePath(ctx, B, 0, n1, -1);
    ctx.strokeStyle = 'rgba(8,18,30,.2)'; ctx.lineWidth = 9; ctx.stroke();
    edgePath(ctx, B, 0, n1, 0.86);
    ctx.strokeStyle = 'rgba(255,255,255,.07)'; ctx.lineWidth = 8; ctx.stroke();
    const hl = o.hl || [n1 * 0.55, 0.4, 30, 9];
    const hp = at(B, hl[0], hl[1]);
    ctx.save();
    ctx.translate(hp[0], hp[1]);
    ctx.scale(hl[2] / hl[3], 1);
    ctx.fillStyle = H.radial(ctx, 0, 0, 0, hl[3], [[0, 'rgba(255,255,255,.2)'], [1, 'rgba(255,255,255,0)']]);
    ctx.fillRect(-hl[3], -hl[3], hl[3] * 2, hl[3] * 2);
    ctx.restore();
    if (o.cau) caustics(ctx, A, B, o.cau[0], o.cau[1], o.cau[2]);
    edgePath(ctx, B, 0.4, n1 - 0.3, 0.97);
    ctx.strokeStyle = P.rim; ctx.lineWidth = 1.7; ctx.stroke();
    if (A.st === 3 && o.scar) scars(ctx, A, sp, B, o.scar);
    if (o.late) o.late();
    ctx.restore();
    if (o.glow && (A.st === 3 || o.glowAlways)) glow(ctx, A, o.glow, o.glowW || 1.6);
    if (A.power > 0) {
      // super-attack charge: crackling energy rim in the class colour
      const c = classColor(sp), pw = A.power * (0.75 + 0.25 * Math.sin(A.t * 14));
      ctx.save();
      ctx.globalCompositeOperation = 'lighter'; ctx.lineJoin = 'round';
      bodyPath(ctx, B);
      ctx.strokeStyle = H.rgba(c, 0.22 * pw); ctx.lineWidth = 12; ctx.stroke();
      ctx.strokeStyle = H.rgba(c, 0.55 * pw); ctx.lineWidth = 5; ctx.stroke();
      ctx.restore();
    }
    bodyPath(ctx, B);
    ctx.lineWidth = LW; ctx.strokeStyle = P.ink; ctx.lineJoin = 'round';
    ctx.stroke();
  }
  const classColor = sp => (PC.CLASSES && PC.CLASSES[sp.cls] && PC.CLASSES[sp.cls].color) || '#ffd040';

  // ---------- Parts ----------
  /**
   * Paddle flipper / pectoral fin from root (x, y) along angle ang (0 = +x, PI/2 = down).
   * o: { curl (tip sweeps back, 0..0.6), round, wrist (narrow root), flat (no details), bones, scutes, edge (trailing edge colour) }
   */
  function flipper(ctx, A, x, y, ang, len, wid, fill, o) {
    o = o || {};
    const w = wid * 0.5, P = A.P, c = o.curl == null ? 0.22 : o.curl, ty = c * len * 0.32, rd = o.round ? 1 : 0;
    const r0 = o.wrist ? 0.55 : 1;   // root half-width factor
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    const outline = () => {
      ctx.beginPath();
      ctx.moveTo(-w * 0.45 * r0, -w * r0);
      ctx.bezierCurveTo(len * 0.3, -w * (1.55 + rd * 0.25), len * 0.82, -w * (0.8 + rd * 0.4) + ty * 0.6, len, ty);
      ctx.bezierCurveTo(len * (0.8 + rd * 0.1), ty + w * (0.2 + rd * 0.7), len * 0.38, w * (0.95 - c * 1.4 + rd * 0.3), -w * 0.45 * r0, w * r0);
      ctx.quadraticCurveTo(-w * 0.9 * r0, 0, -w * 0.45 * r0, -w * r0);
      ctx.closePath();
    };
    outline();
    H.fillStroke(ctx, fill, P.ink, LW * 0.9);
    if (!o.flat) {
      ctx.save();
      outline(); ctx.clip();
      ctx.lineCap = 'round';
      // shaded trailing half
      ctx.beginPath();
      ctx.moveTo(-w, w * 0.2);
      ctx.bezierCurveTo(len * 0.35, w * 0.1, len * 0.75, ty * 0.6, len * 1.05, ty + w * 0.1);
      ctx.lineTo(len * 1.05, w * 3); ctx.lineTo(-w, w * 3); ctx.closePath();
      ctx.fillStyle = 'rgba(8,16,26,.16)'; ctx.fill();
      if (o.bones) {
        ctx.beginPath();
        for (let j = -1; j <= 1; j++) {
          ctx.moveTo(len * 0.12, j * w * 0.38 - w * 0.08);
          ctx.quadraticCurveTo(len * 0.5, j * w * 0.3 - w * 0.12 + ty * 0.25, len * (0.8 - Math.abs(j) * 0.1), j * w * 0.1 + ty * 0.7);
        }
        ctx.strokeStyle = H.rgba(P.ink, 0.22); ctx.lineWidth = 0.9; ctx.stroke();
      }
      if (o.scutes) {
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const f = 0.12 + i * 0.13, sx = len * f, sy = -w * (1.05 - f * 0.7) + ty * f * f, r = w * (0.34 - f * 0.18);
          ctx.moveTo(sx + r, sy); ctx.arc(sx, sy, r, 0, TAU);
        }
        ctx.fillStyle = H.rgba(P.belly, 0.28); ctx.fill();
        ctx.strokeStyle = H.rgba(P.ink, 0.3); ctx.lineWidth = 0.7; ctx.stroke();
      }
      ctx.restore();
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(w * 0.1, -w * 0.92);
      ctx.bezierCurveTo(len * 0.3, -w * 1.3, len * 0.72, -w * 0.66 + ty * 0.55, len * 0.94, ty * 0.95 - w * 0.08);
      ctx.strokeStyle = 'rgba(255,255,255,.26)'; ctx.lineWidth = 1.6; ctx.stroke();
      if (o.edge) {
        ctx.beginPath();
        ctx.moveTo(len * 0.95, ty + w * 0.06);
        ctx.bezierCurveTo(len * 0.75, ty + w * 0.3, len * 0.38, w * (0.85 - c * 1.4), w * 0.2, w * 0.9);
        ctx.strokeStyle = o.edge; ctx.lineWidth = 1.8; ctx.stroke();
      }
    }
    ctx.restore();
  }
  /** Flipper stroke angle for paddle swimmers, clamped so a paddle never points straight down like a leg. */
  const paddle = (rest, stroke, min) => clamp(rest + stroke, min || 2.3, 3.45);
  /** Crescent tail fin attached to the first body station. U / L = lobe tips, fork = notch x (local, x < 0 = back). */
  function tailFin(ctx, A, B, Up, Lo, fork, fill, o) {
    o = o || {};
    const P = A.P, x = B.x[0], y = B.y[0];
    const ang = Math.atan2(B.y[0] - B.y[1], B.x[0] - B.x[1]) - PI;
    const sx = o.noBeat ? 1 : 0.74 + 0.26 * A.beat;
    const r0 = Math.max(B.up[0], B.dn[0]) * 0.9 + 1;
    const ux = Up[0] * sx, uy = Up[1], lx = Lo[0] * sx, ly = Lo[1], fx = fork * sx;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    ctx.beginPath();
    ctx.moveTo(3, -r0);
    ctx.quadraticCurveTo(ux * 0.25, uy * 0.55, ux, uy);
    ctx.quadraticCurveTo(lerp(ux, fx, 0.45) + 4, uy * 0.42, fx, 0);
    ctx.quadraticCurveTo(lerp(lx, fx, 0.45) + 4, ly * 0.42, lx, ly);
    ctx.quadraticCurveTo(lx * 0.25, ly * 0.55, 3, r0);
    ctx.closePath();
    H.fillStroke(ctx, fill, P.ink, LW);
    ctx.beginPath();
    for (let i = 1; i <= 3; i++) {
      const f = i / 4;
      ctx.moveTo(-2, 0); ctx.lineTo(lerp(ux, fx, f) * 0.85, lerp(uy, 0, f) * 0.85);
      ctx.moveTo(-2, 0); ctx.lineTo(lerp(lx, fx, f) * 0.85, lerp(ly, 0, f) * 0.85);
    }
    ctx.strokeStyle = H.rgba(P.ink, 0.22); ctx.lineWidth = 0.9; ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(1, -r0 + 1.5);
    ctx.quadraticCurveTo(ux * 0.25 + 1.5, uy * 0.55 + 1.2, ux + 2, uy + 3);
    ctx.strokeStyle = P.finEdge; ctx.lineWidth = 1.5; ctx.lineCap = 'round'; ctx.stroke();
    if (A.st === 3 && o.glow) glow(ctx, A, () => {
      ctx.beginPath(); ctx.moveTo(ux * 0.4, uy * 0.45); ctx.lineTo(ux * 0.85, uy * 0.88);
      ctx.moveTo(lx * 0.4, ly * 0.45); ctx.lineTo(lx * 0.85, ly * 0.88);
    }, 1.2);
    ctx.restore();
  }
  /** Fin standing on the back (side = 1) or hanging under the belly (side = -1), between design xs xf (front) and xb. */
  function finOn(ctx, A, B, xf, xb, h, sweep, fill, side) {
    side = side || 1;
    const uf = U(B, xf), ub = U(B, xb), v = 0.72 * side;
    const a = at(B, uf, v), b = at(B, ub, v), nn = nrm(B, (uf + ub) / 2);
    const nx = nn[0] * side, ny = nn[1] * side;
    const apex = [b[0] - sweep + nx * h, b[1] + ny * h];
    const c1 = [lerp(a[0], apex[0], 0.35) + nx * h * 0.35, lerp(a[1], apex[1], 0.35) + ny * h * 0.35];
    const c2 = [b[0] + 2, lerp(apex[1], b[1], 0.45)];
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.quadraticCurveTo(c1[0], c1[1], apex[0], apex[1]);
    ctx.quadraticCurveTo(c2[0], c2[1], b[0], b[1]);
    ctx.closePath();
    H.fillStroke(ctx, fill, A.P.ink, LW * 0.95);
    ctx.beginPath();
    ctx.moveTo(lerp(a[0], b[0], 0.15), lerp(a[1], b[1], 0.15));
    ctx.quadraticCurveTo(c1[0] - 1, c1[1] + 1.2 * side, apex[0] + 1.5, apex[1] + 2 * side);
    ctx.strokeStyle = A.P.finEdge; ctx.lineWidth = 1.4; ctx.lineCap = 'round'; ctx.stroke();
    return apex;
  }
  /**
   * Mouth interior + lower jaw rotated about the hinge (drawn BEFORE the body, which forms the upper jaw).
   * J: { hinge, top: upper jaw line (front of hinge), shape: closed lower jaw outline, open: max angle, fill }
   * teeth: lower teeth { from, to, n, len } (pointing up, hidden under the lip while closed).
   */
  function jawGroup(ctx, A, B, J, teeth, after) {
    const P = A.P, ang = A.jw * J.open;
    const h = B.px(J.hinge[0], J.hinge[1]);
    const top = J.top.map(q => B.px(q[0], q[1]));
    if (ang > 0.015) {
      const rt = top.map(q => rot(q, h, ang)), m = top.length >> 1;
      ctx.beginPath();
      ctx.moveTo(h[0], h[1]);
      for (const q of top) ctx.lineTo(q[0], q[1]);
      for (let i = rt.length - 1; i >= 0; i--) ctx.lineTo(rt[i][0], rt[i][1]);
      ctx.closePath();
      ctx.fillStyle = P.mouth; ctx.fill();
      // throat depth + tongue
      const c = [lerp(h[0], (top[m][0] + rt[m][0]) / 2, 0.35), lerp(h[1], (top[m][1] + rt[m][1]) / 2, 0.35)];
      const g = Math.hypot(top[m][0] - rt[m][0], top[m][1] - rt[m][1]);
      ctx.fillStyle = P.mouthDeep;
      H.ellipse(ctx, c[0], c[1], g * 0.55 + 1, g * 0.3 + 0.5, ang * 0.5);
      ctx.fill();
      const tq = rot([lerp(h[0], top[m][0], 0.9), lerp(h[1], top[m][1], 0.9) - 0.5], h, ang * 0.85);
      ctx.fillStyle = P.tongue;
      H.ellipse(ctx, tq[0], tq[1] - 0.5, g * 0.6 + 2, Math.min(3, g * 0.16 + 0.8), ang * 0.85);
      ctx.fill();
    }
    ctx.save();
    ctx.translate(h[0], h[1]); ctx.rotate(ang); ctx.translate(-h[0], -h[1]);
    if (teeth && A.S.teeth > 0.05) teethRow(ctx, A, B, teeth.from, teeth.to, teeth.n, teeth.len, true);
    H.smooth(ctx, J.shape.map(q => B.px(q[0], q[1])), true, J.tension || 0.35);
    H.fillStroke(ctx, J.fill || P.jaw, P.ink, LW * 0.9);
    // lip line shading on the lower jaw
    const lip = J.shape.slice(0, J.top.length + 1).map(q => B.px(q[0], q[1] + 2.2));
    H.smooth(ctx, lip, false, 0.4);
    ctx.strokeStyle = P.jawShade; ctx.lineWidth = 2.4; ctx.stroke();
    if (after) after(h, ang);
    ctx.restore();
  }
  /** Row of triangular teeth along (x0, y0)→(x1, y1), batched into one fill + one stroke (cheaper than H.teeth). */
  function fangs(ctx, x0, y0, x1, y1, n, len, up, color) {
    const dx = (x1 - x0) / n, dy = (y1 - y0) / n, s = up ? -1 : 1;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const ax = x0 + dx * i, ay = y0 + dy * i, l = len * (0.75 + 0.25 * Math.sin(i * 2.3 + 1));
      ctx.moveTo(ax, ay); ctx.lineTo(ax + dx * 0.5, ay + dy * 0.5 + l * s); ctx.lineTo(ax + dx, ay + dy); ctx.closePath();
    }
    ctx.fillStyle = color; ctx.fill();
    ctx.strokeStyle = 'rgba(60,40,20,.55)'; ctx.lineWidth = 0.8; ctx.lineJoin = 'round'; ctx.stroke();
  }
  function teethRow(ctx, A, B, a, b, n, len, up) {
    const tl = len * A.S.teeth * A.S.head;
    if (tl < 0.6) return;
    const pa = B.px(a[0], a[1]), pb = B.px(b[0], b[1]);
    fangs(ctx, pa[0], pa[1], pb[0], pb[1], n, tl, up, A.P.tooth);
  }
  /** Long thin interlocking teeth (plesiosaur). dir +1 = down, -1 = up; lean tilts them forward. */
  function needles(ctx, A, a, b, n, len, dir, lean) {
    if (len < 0.5) return;
    ctx.save();
    ctx.lineCap = 'round';
    for (let pass = 0; pass < 2; pass++) {
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const f = (i + 0.5) / n, x = lerp(a[0], b[0], f), y = lerp(a[1], b[1], f), l = len * (0.7 + 0.3 * Math.sin(i * 2.1 + 0.5));
        ctx.moveTo(x, y); ctx.lineTo(x + lean * l, y + dir * l);
      }
      ctx.strokeStyle = pass ? A.P.tooth : 'rgba(60,40,24,.55)';
      ctx.lineWidth = pass ? 0.9 : 1.7;
      ctx.stroke();
    }
    ctx.restore();
  }
  function squint(ctx, x, y, r, ink) {
    ctx.save();
    H.ellipse(ctx, x, y, r * 1.2, r);
    ctx.fillStyle = 'rgba(20,12,6,.35)'; ctx.fill();
    ctx.strokeStyle = ink; ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(1, r * 0.45);
    ctx.beginPath(); ctx.moveTo(x - r * 1.15, y - r * 0.3); ctx.quadraticCurveTo(x, y + r * 0.5, x + r * 1.15, y - r * 0.3); ctx.stroke();
    ctx.lineWidth = Math.max(0.7, r * 0.25);
    ctx.beginPath();
    ctx.moveTo(x - r * 0.75, y - r * 1.05); ctx.lineTo(x - r * 0.3, y - r * 0.5);
    ctx.moveTo(x + r * 0.75, y - r * 1.05); ctx.lineTo(x + r * 0.3, y - r * 0.5);
    ctx.stroke();
    ctx.restore();
  }
  /** Eye with blink, hurt squeeze, angry brow; o: { iris, pupil, dark, ring (bony ring colour), lid, brow }. */
  function eye(ctx, A, q, r, o) {
    o = o || {};
    if (A.hurt) { squint(ctx, q[0], q[1], r, A.P.ink); return; }
    if (A.blink) {
      // closed lid: skin-coloured lid with a curved lash line
      ctx.save();
      H.ellipse(ctx, q[0], q[1], r * 1.18, r * 1.05);
      ctx.fillStyle = o.lid || A.P.dorsal; ctx.fill();
      ctx.strokeStyle = H.rgba(A.P.ink, 0.6); ctx.lineWidth = 0.8; ctx.stroke();
      ctx.strokeStyle = A.P.ink; ctx.lineCap = 'round'; ctx.lineWidth = Math.max(0.8, r * 0.36);
      ctx.beginPath(); ctx.moveTo(q[0] - r * 1.05, q[1]); ctx.quadraticCurveTo(q[0], q[1] + r * 0.6, q[0] + r * 1.05, q[1]); ctx.stroke();
      ctx.restore();
      return;
    }
    if (o.ring) {
      ctx.save();
      H.ellipse(ctx, q[0], q[1], r * 1.5, r * 1.42);
      ctx.fillStyle = o.ring; ctx.fill();
      ctx.strokeStyle = H.rgba(A.P.ink, 0.6); ctx.lineWidth = 0.9; ctx.stroke();
      ctx.beginPath();
      for (let i = 0; i < 12; i++) {
        const a = i / 12 * TAU;
        ctx.moveTo(q[0] + Math.cos(a) * r * 1.12, q[1] + Math.sin(a) * r * 1.08);
        ctx.lineTo(q[0] + Math.cos(a) * r * 1.48, q[1] + Math.sin(a) * r * 1.4);
      }
      ctx.strokeStyle = H.rgba(A.P.ink, 0.35); ctx.lineWidth = 0.7; ctx.stroke();
      ctx.restore();
    }
    H.eye(ctx, q[0], q[1], r, {
      iris: o.iris, pupil: o.pupil || 'round', mammal: !!o.dark,
      angry: A.angry && o.brow !== false, browColor: H.rgba(A.P.ink, 0.9),
    });
  }
  function bubbles(ctx, x, y, t, n, h, drift, seed) {
    ctx.save();
    ctx.lineWidth = 0.9;
    for (let i = 0; i < n; i++) {
      const ph = (t * 0.9 + i / n + seed * 0.37) % 1;
      const bx = x + Math.sin(i * 2.7 + t * 3) * 2.5 + ph * drift, by = y - ph * h;
      const r = (1.1 + (i % 3) * 0.75) * (0.7 + ph * 0.5), a = 0.8 * (1 - ph);
      ctx.strokeStyle = 'rgba(235,250,255,' + a.toFixed(3) + ')';
      H.ellipse(ctx, bx, by, r, r); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,' + (a * 0.8).toFixed(3) + ')';
      H.ellipse(ctx, bx - r * 0.35, by - r * 0.35, r * 0.3, r * 0.3); ctx.fill();
    }
    ctx.restore();
  }
  /** Small fish darting in front of the mouth (eat pose). */
  function snack(ctx, A, x, y) {
    const t = A.t, cyc = (t * 1.5) % 1;
    if (cyc > 0.8) return;   // just gulped
    const fx = x + 12 - cyc * 5 + Math.sin(t * 6) * 1.5, fy = y + Math.sin(t * 5) * 2.2;
    ctx.save();
    ctx.translate(fx, fy);
    ctx.scale(-1, 1);
    const w = Math.sin(t * 22) * 1.6;
    H.poly(ctx, [[-5, 0], [-9.5, -3 + w], [-9.5, 3 + w]], true);
    H.fillStroke(ctx, '#8fb8c8', '#2c4a58', 0.9);
    H.ellipse(ctx, 0, 0, 6, 2.7);
    H.fillStroke(ctx, H.linear(ctx, 0, -2.7, 0, 2.7, [[0, '#7aa6b8'], [0.5, '#dff2f6'], [1, '#f6fbfc']]), '#2c4a58', 0.9);
    ctx.fillStyle = '#10202a';
    H.ellipse(ctx, 3.3, -0.5, 0.8, 0.8); ctx.fill();
    ctx.restore();
  }
  /** Speed streaks behind the creature while it surges forward. */
  function streaks(ctx, A, x, y, h) {
    const a = A.pose === 'walk' ? 0.35 : A.strike;
    if (a <= 0.02) return;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(230,248,255,' + (0.5 * a).toFixed(3) + ')';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      const yy = y + (i - 1.5) * h * 0.42, x0 = x - 4 - (i % 2) * 6, len = (20 + (i % 3) * 12) * a;
      ctx.moveTo(x0, yy); ctx.lineTo(x0 - len, yy);
    }
    ctx.stroke();
    ctx.restore();
  }
  /** Four-point sparkle (teeth glint at the bite). */
  function glint(ctx, x, y, a, s) {
    if (a <= 0.02) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = 'rgba(255,255,236,' + a.toFixed(3) + ')';
    ctx.beginPath();
    ctx.moveTo(x, y - s); ctx.lineTo(x + s * 0.2, y - s * 0.2); ctx.lineTo(x + s, y); ctx.lineTo(x + s * 0.2, y + s * 0.2);
    ctx.lineTo(x, y + s); ctx.lineTo(x - s * 0.2, y + s * 0.2); ctx.lineTo(x - s, y); ctx.lineTo(x - s * 0.2, y - s * 0.2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  /** Super-attack charge: glowing eye and mouth in the class colour. */
  function powerFx(ctx, A, sp, eyeQ, mouthQ, r) {
    if (A.power <= 0) return;
    const c = classColor(sp), p = A.power, f = 0.8 + 0.2 * Math.sin(A.t * 18);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const R = r * 3.4;
    ctx.fillStyle = H.radial(ctx, eyeQ[0], eyeQ[1], 0, R, [[0, 'rgba(255,255,255,' + (0.9 * p).toFixed(3) + ')'], [0.25, H.rgba(c, 0.8 * p * f)], [1, H.rgba(c, 0)]]);
    ctx.fillRect(eyeQ[0] - R, eyeQ[1] - R, R * 2, R * 2);
    if (mouthQ && A.jw > 0.25) {
      const M = r * 6 * (0.6 + A.jw * 0.5);
      ctx.fillStyle = H.radial(ctx, mouthQ[0], mouthQ[1], 0, M, [[0, H.rgba('#ffffff', 0.7 * p)], [0.3, H.rgba(c, 0.55 * p * f)], [1, H.rgba(c, 0)]]);
      ctx.fillRect(mouthQ[0] - M, mouthQ[1] - M, M * 2, M * 2);
    }
    ctx.restore();
  }
  /** Shared pose effects drawn in body space: bubbles, speed streaks, prey fish, roar bubbles, bite glint, power. */
  function effects(ctx, A, sp, B, mouth, eyeQ, eyeR) {
    if (A.noFx) return;
    const tail = B.tail || [B.x[0], B.y[0]];
    if (A.pose === 'walk' || A.strike > 0.1) bubbles(ctx, tail[0] - 6, tail[1] + 4, A.t * 1.6, 5, 22, -14, A.seed);
    if (A.pose === 'walk' || A.pose === 'attack') streaks(ctx, A, tail[0], tail[1], 30);
    if (A.pose === 'roar') bubbles(ctx, mouth[0] + 4, mouth[1], A.t * 1.4, 8, 36, 12, A.seed + 3);
    if (A.pose === 'eat') snack(ctx, A, mouth[0], mouth[1]);
    if (A.snap > 0) glint(ctx, mouth[0] - 2, mouth[1] - 2, A.snap, 9 * A.S.head);
    powerFx(ctx, A, sp, eyeQ, mouth, eyeR);
  }
  function begin(ctx, A, pitchK) {
    ctx.save();
    ctx.translate(A.dx, CY + A.bob);
    ctx.rotate(A.pitch * (pitchK == null ? 1 : pitchK));
  }

  // =====================================================================
  // Shark (megalodon)
  // =====================================================================
  const SHARK = [
    [-70, 3.4, 3.4], [-56, 7, 6.5], [-36, 14, 12], [-12, 22, 18], [12, 26, 21], [30, 24, 20],
    [36, 22.5, 16.5], [41, 21, 11.5], [52, 17, 9.2], [63, 12, 6.2], [71, 6.5, 3], [76, 1.6, -1],
  ];
  const SHARK_JAW = {
    hinge: [41, 11.4], open: 0.78,
    top: [[52, 9.2], [63, 6.2], [71, 3]],
    shape: [[41, 11.4], [52, 9.2], [63, 6.2], [71, 3], [71.5, 5.5], [64, 11], [54, 15.6], [44, 18.2], [34, 18.6], [28, 16.5], [32, 13]],
  };
  function shark(ctx, sp, o) {
    const A = anim(o, sp), P = A.P, S = A.S;
    begin(ctx, A);
    const B = makeBody(A, SHARK, { hx: 30, wave: 5, wl: 34, bendAmp: 16, tailTip: 4 });
    const p = B.px, fs = S.fin, fe = 0.55 + 0.45 * Math.min(1, S.feat);
    let q = p(26, 12);
    flipper(ctx, A, q[0] - 5, q[1] - 4, 2.05 + A.fl * 0.25, 30 * fs, 12 * fs, P.finFar, { flat: true });
    tailFin(ctx, A, B, [-34 * fs, -42 * fs], [-29 * fs, 25 * fs], -15 * fs, P.fin, { glow: true });
    finOn(ctx, A, B, 22, -6, 31 * fs * fe, 12, P.fin, 1);
    finOn(ctx, A, B, -49, -57, 8 * fs, 5, P.fin, 1);
    finOn(ctx, A, B, -47, -55, 7 * fs, 5, P.finFar, -1);
    jawGroup(ctx, A, B, SHARK_JAW, { from: [45, 11.2], to: [68, 5], n: 6, len: 5 });
    const n1 = B.n - 1;
    skin(ctx, A, sp, B, {
      belly: { v: u => lerp(-0.42, 0.05, u / n1) },
      pat: { u0: 1, u1: 8, v0: 0.1, v1: 0.9 },
      tex: { u0: 0.5, u1: n1, n: 46, r: 0.7 },
      cau: [1.5, 9.5],
      hl: [5, 0.42, 34, 10],
      scar: { u0: 3, u1: 7, v0: 0.05, v1: 0.6, s: 1.1 },
      glow: () => edgePath(ctx, B, 1.2, 6.8, 0.12),
    });
    // gill slits
    const gills = (ox, oy) => {
      ctx.beginPath();
      for (let i = 0; i < 5; i++) {
        const x = 22 + i * 3.4, a = p(x, -9 + i * 0.6), b = p(x - 2.6, 8.5 - i * 0.5), c = p(x + 1.8, 0);
        ctx.moveTo(a[0] + ox, a[1] + oy); ctx.quadraticCurveTo(c[0] + ox, c[1] + oy, b[0] + ox, b[1] + oy);
      }
    };
    ctx.save();
    ctx.lineCap = 'round';
    gills(0.9, 0.3); ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.lineWidth = 1.1; ctx.stroke();
    gills(0, 0); ctx.strokeStyle = H.rgba(P.ink, 0.62); ctx.lineWidth = 1.5; ctx.stroke();
    ctx.restore();
    if (A.st === 3) glow(ctx, A, () => gills(0, 0), 1);
    teethRow(ctx, A, B, [44, 10.8], [68.5, 4.6], 6, 6.6, false);
    const eq = p(58, -3.4), er = 2.6 * S.eye;
    eye(ctx, A, eq, er, { dark: true, lid: P.dorsal });
    q = p(70.5, 0.6);
    ctx.fillStyle = H.rgba(P.ink, 0.7);
    H.ellipse(ctx, q[0], q[1], 1.4, 0.7, -0.3); ctx.fill();
    q = p(28, 13);
    flipper(ctx, A, q[0], q[1], 2.1 + A.fl * 0.25, 34 * fs, 13 * fs, P.fin, { edge: H.rgba(P.ink, 0.25) });
    q = p(-28, 16);
    flipper(ctx, A, q[0], q[1], 2.55 + A.fl * 0.15, 12 * fs, 6 * fs, P.fin, { flat: true });
    effects(ctx, A, sp, B, p(72, 6), eq, er);
    ctx.restore();
  }

  // =====================================================================
  // Ichthyosaur (ichthyosaurus; feature giant = shonisaurus)
  // =====================================================================
  const ICHTHY = [
    [-60, 3, 3], [-48, 7, 6.5], [-30, 14, 13], [-8, 20, 17.5], [12, 22.5, 18.5], [28, 20, 16],
    [37, 16.5, 12.6], [43, 14.6, 7.4], [50, 11, 5.4], [56, 6.6, 3.6], [66, 4, 2.8], [80, 2.6, 2], [90, 1.4, 1],
  ];
  const ICHTHY_JAW = {
    hinge: [43, 7.6], open: 0.42,
    top: [[50, 5.4], [56, 3.6], [66, 2.8], [80, 2], [90, 1]],
    shape: [[43, 7.6], [50, 5.4], [56, 3.6], [66, 2.8], [80, 2], [90, 1], [89.5, 2.6], [80, 4.4], [66, 6.2], [55, 9.2], [45, 12.6], [37, 14], [33, 12]],
  };
  const snoutShort = x => (x > 56 ? 56 + (x - 56) * 0.78 : x);
  const ICHTHY_G = ICHTHY.map(r => [snoutShort(r[0]), r[1], r[2]]);
  const ICHTHY_JAW_G = {
    hinge: ICHTHY_JAW.hinge, open: 0.42,
    top: ICHTHY_JAW.top.map(q => [snoutShort(q[0]), q[1]]),
    shape: ICHTHY_JAW.shape.map(q => [snoutShort(q[0]), q[1]]),
  };
  function ichthyosaur(ctx, sp, o) {
    const A = anim(o, sp), P = A.P, S = A.S, giant = has(sp, 'giant');
    const X = giant ? snoutShort : x => x;
    begin(ctx, A);
    if (giant) ctx.translate(0, -6);
    const B = makeBody(A, giant ? ICHTHY_G : ICHTHY, { hx: 36, wave: 5, wl: 36, bendAmp: 14, tailTip: 3, thick: giant ? 1.28 : 1 });
    const p = B.px, fs = S.fin;
    const fLen = giant ? 1.55 : 1, fW = giant ? 0.85 : 1;
    const ra = giant ? 0.35 : 0;   // the giant's long flippers trail further back
    const fl = giant ? Math.max(-0.4, A.fl) : A.fl;
    const fa = (rest, k) => Math.max(giant ? 2.25 : 1.85, rest + ra + fl * k);   // never straight down like a leg
    let q = p(30, 9);
    flipper(ctx, A, q[0] - 4, q[1] - 4, fa(2.1, 0.6), 28 * fs * fLen, 10.5 * fs * fW, P.finFar, { flat: true });
    q = p(-20, 10);
    flipper(ctx, A, q[0] - 3, q[1] - 3, fa(2.4, 0.5), 16 * fs * fLen, 7.5 * fs * fW, P.finFar, { flat: true });
    tailFin(ctx, A, B, [-26 * fs, -30 * fs], [-25 * fs, 28 * fs], -13 * fs, P.fin, { glow: true });
    finOn(ctx, A, B, 14, -8, 22 * fs * (giant ? 0.5 : 1) * (0.55 + 0.45 * Math.min(1, S.feat)), 10, P.fin, 1);
    const tl = giant ? 0.45 : 1;
    jawGroup(ctx, A, B, giant ? ICHTHY_JAW_G : ICHTHY_JAW, { from: [48, 5.4], to: [X(86), 1.5], n: 11, len: 2 * tl });
    const n1 = B.n - 1;
    skin(ctx, A, sp, B, {
      belly: { v: u => lerp(-0.35, 0.12, u / n1) },
      pat: { u0: 1, u1: 7, v0: 0.1, v1: 0.9 },
      tex: { u0: 0.5, u1: 8, n: 34, r: 0.65 },
      cau: [1.2, 8],
      hl: [4.6, 0.45, 30, 9],
      scar: { u0: 2.5, u1: 6, v0: 0.05, v1: 0.6 },
      glow: () => edgePath(ctx, B, 1.4, 7.2, 0.14),
    });
    teethRow(ctx, A, B, [48, 5.2], [X(87), 1.2], 12, 2.2 * tl, false);
    // nostril + huge eye with its bony sclerotic ring
    q = p(X(61), -1.6);
    ctx.fillStyle = H.rgba(P.ink, 0.7);
    H.ellipse(ctx, q[0], q[1], 1.3, 0.6, -0.2); ctx.fill();
    // the eye is already huge: divide by the baby head scale so it stays inside the skull
    const eq = p(46, -3.6), er = 6 * S.eye * (giant ? 0.72 : 1) / S.head;
    eye(ctx, A, eq, er, { iris: A.st === 3 ? P.glow : '#e8b84a', ring: P.bone, lid: P.dorsal, brow: false });
    if (A.st === 3 && !A.hurt) glow(ctx, A, () => { ctx.beginPath(); ctx.arc(eq[0], eq[1], er * 1.32, 0, TAU); }, 0.9);
    q = p(30, 12);
    flipper(ctx, A, q[0], q[1], fa(2.15, 0.6), 30 * fs * fLen, 11 * fs * fW, P.fin, { bones: true });
    q = p(-22, 13);
    flipper(ctx, A, q[0], q[1], fa(2.45, 0.5), 18 * fs * fLen, 8 * fs * fW, P.fin, { bones: true });
    effects(ctx, A, sp, B, p(X(88), 2), eq, er);
    ctx.restore();
  }

  // =====================================================================
  // Armoured fish (dunkleosteus)
  // =====================================================================
  const DUNK = [
    [-74, 3, 3], [-60, 7.5, 7], [-38, 15, 13.5], [-12, 23, 19.5], [10, 28, 22.5], [28, 30, 22.5],
    [40, 28.5, 18], [46, 27, 10.4], [56, 23.5, 8.2], [65, 17.5, 7.2], [71, 10.5, 6.4], [75, 3.5, 5.8],
  ];
  function armoredfish(ctx, sp, o) {
    const A = anim(o, sp), P = A.P, S = A.S, st = A.st;
    begin(ctx, A);
    const B = makeBody(A, DUNK, { hx: 16, wave: 4.5, wl: 34, bendAmp: 15, tailTip: 4 });
    const p = B.px, fs = S.fin, fang = Math.max(0.3, S.teeth) * (st === 3 ? 1.15 : 1);
    let q = p(20, 12);
    flipper(ctx, A, q[0] - 4, q[1] - 4, 2.3 + A.fl * 0.4, 22 * fs, 12 * fs, P.finFar, { flat: true, round: true });
    tailFin(ctx, A, B, [-38 * fs, -34 * fs], [-22 * fs, 18 * fs], -12 * fs, P.fin, { glow: true });
    finOn(ctx, A, B, -2, -26, 24 * fs * (0.55 + 0.45 * Math.min(1, S.feat)), 10, P.fin, 1);
    finOn(ctx, A, B, -48, -58, 8 * fs, 4, P.finFar, -1);
    // lower blade jaw with its upward front cusp
    const fy = 5.8 - 7 * fang;
    const J = {
      hinge: [46, 10.4], open: 0.85, tension: 0.15, fill: P.bone,
      top: [[56, 8.2], [65, 7.2], [71, 6.4], [75, 5.8]],
      shape: [[46, 10.4], [56, 8.2], [65, 7.2], [71, 6.4], [74.5, 5.9], [76.6, fy], [78.6, 6.6], [77, 11], [68, 15.5], [56, 18], [46, 19], [38, 17.5], [40, 13]],
    };
    jawGroup(ctx, A, B, J, null, () => {
      // shearing edge highlight
      const a = p(48, 9.6), b = p(74, 6), c = p(76.6, fy + 1.5);
      ctx.beginPath(); ctx.moveTo(a[0], a[1] + 1.2); ctx.lineTo(b[0], b[1] + 1.2); ctx.lineTo(c[0], c[1] + 1);
      ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = 1.1; ctx.stroke();
    });
    const n1 = B.n - 1, ua = U(B, 14);
    skin(ctx, A, sp, B, {
      belly: { v: u => lerp(-0.42, -0.05, u / n1), u1: n1 },
      pat: { u0: 0.8, u1: ua, v0: -0.3, v1: 0.9, n: 20 },
      tex: { u0: 0.5, u1: ua + 0.3, n: 30, r: 0.7 },
      cau: [1, 9],
      hl: [4.2, 0.4, 26, 9],
      extra: () => {
        // bony head armour: translucent bone over the body shading, raised back edge, plate seams, pits
        const edge = [p(15, -40), p(11.5, -22), p(12, -2), p(16, 14), p(22, 30)];
        const plate = () => {
          ctx.beginPath(); ctx.moveTo(edge[0][0], edge[0][1]);
          H.smooth(ctx, edge, false, 0.5);
          const e1 = p(100, 34), e2 = p(100, -44);
          ctx.lineTo(e1[0], e1[1]); ctx.lineTo(e2[0], e2[1]); ctx.closePath();
        };
        // shadow cast by the armour edge on the body behind it
        ctx.save(); ctx.translate(-2.5, 0.5);
        H.smooth(ctx, edge, false, 0.5); ctx.strokeStyle = 'rgba(10,14,20,.32)'; ctx.lineWidth = 4; ctx.stroke();
        ctx.restore();
        plate(); ctx.fillStyle = P.boneA; ctx.fill();
        ctx.save(); plate(); ctx.clip();
        const d = rnd(sp.seed * 7 + 2, 120);
        ctx.beginPath();
        for (let i = 0; i < 38; i++) {
          const c = p(14 + d[i * 3] * 62, -28 + d[i * 3 + 1] * 44), r = 0.45 + d[i * 3 + 2] * 0.7;
          ctx.moveTo(c[0] + r, c[1]); ctx.arc(c[0], c[1], r, 0, TAU);
        }
        ctx.fillStyle = H.rgba(P.boneDark, 0.5); ctx.fill();
        if (sp.pattern === 'spots') H.spots(ctx, sp.seed, p(18, 0)[0], p(0, -30)[1], p(60, 0)[0], p(0, -6)[1], 6 + st * 2, 1.2, 2.6, P.pat);
        ctx.restore();
        H.smooth(ctx, edge, false, 0.5); ctx.strokeStyle = H.rgba(P.ink, 0.85); ctx.lineWidth = 1.8; ctx.stroke();
        ctx.save(); ctx.translate(1.6, 0);
        H.smooth(ctx, edge, false, 0.5); ctx.strokeStyle = 'rgba(255,255,255,.3)'; ctx.lineWidth = 1.2; ctx.stroke();
        ctx.restore();
        armourSeams(ctx, p);
        ctx.strokeStyle = H.rgba(P.ink, 0.55); ctx.lineWidth = 1.3; ctx.lineCap = 'round'; ctx.stroke();
      },
      scar: { u0: 1.6, u1: 4.2, v0: 0.05, v1: 0.75, s: 1.1 },
      glow: () => armourSeams(ctx, p),
      glowW: 1.2,
    });
    // upper tooth-plate blade with its downward fang
    const ub = [p(50, 6.8), p(66, 5.6), p(74, 4.2), p(76, 4.4), p(74.6, 6.4 + 7 * fang), p(71.2, 7.2), p(62, 8.4), p(50, 9.8)];
    H.poly(ctx, ub, true);
    H.fillStroke(ctx, P.bone, P.ink, 1.4);
    ctx.beginPath(); ctx.moveTo(ub[7][0], ub[7][1] - 0.6); ctx.lineTo(ub[5][0], ub[5][1] - 0.6); ctx.lineTo(ub[4][0] - 0.3, ub[4][1] - 1.2);
    ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 1; ctx.stroke();
    // eye in its bony ring
    const eq = p(60, -7.4), er = 3.2 * S.eye;
    eye(ctx, A, eq, er, { iris: '#f0d060', ring: P.bone, lid: P.bone });
    q = p(20, 14);
    flipper(ctx, A, q[0], q[1], 2.35 + A.fl * 0.4, 24 * fs, 13 * fs, P.fin, { round: true, bones: true });
    q = p(-30, 17);
    flipper(ctx, A, q[0], q[1], 2.6 + A.fl * 0.2, 11 * fs, 6 * fs, P.fin, { flat: true });
    effects(ctx, A, sp, B, p(76, 6), eq, er);
    ctx.restore();
  }
  /** Builds the armour plate seams path (design coordinates mapped through p). */
  function armourSeams(ctx, p) {
    const m = (x, y) => { const q = p(x, y); ctx.moveTo(q[0], q[1]); };
    const l = (x, y) => { const q = p(x, y); ctx.lineTo(q[0], q[1]); };
    const c = (cx, cy, x, y) => { const a = p(cx, cy), b = p(x, y); ctx.quadraticCurveTo(a[0], a[1], b[0], b[1]); };
    ctx.beginPath();
    m(28, -31); c(31, -14, 46, -8);                 // central (nuchal) plate seam
    l(54, -24);                                      // post-orbital seam
    m(22, 26); c(28, 6, 37, -1); c(50, 3, 68, -1);  // cheek plate
    m(46, -8); c(45, -1, 46, 4);
  }

  // =====================================================================
  // Mosasaur (tylosaurus: long_snout; mosasaurus: big + frill_back; glow = bioluminescent spots)
  // =====================================================================
  const MOSA = [
    [-92, 2.8, 2.8], [-76, 5.6, 5.6], [-54, 10.5, 10], [-30, 17, 16], [-4, 21.5, 21], [20, 22, 21],
    [38, 18, 17.5], [50, 13.6, 13.6], [58, 14.4, 13.8], [64, 14.2, 7.2], [74, 11.6, 5.4], [86, 8.4, 3.8],
    [96, 5.6, 2.6], [103, 2.6, 1.4],
  ];
  const MOSA_JAW = {
    hinge: [64, 7.3], open: 0.62,
    top: [[74, 5.4], [86, 3.8], [96, 2.6], [103, 1.4]],
    shape: [[64, 7.3], [74, 5.4], [86, 3.8], [96, 2.6], [103, 1.4], [103.5, 3], [100, 5], [90, 8], [78, 11.2], [68, 13.6], [60, 14], [54, 13.2], [56, 10]],
  };
  const snoutLong = x => (x > 74 ? 74 + (x - 74) * 1.3 : x);
  const MOSA_L = MOSA.map(r => [snoutLong(r[0]), r[1], r[2]]);
  const MOSA_JAW_L = { hinge: MOSA_JAW.hinge, open: 0.62, top: MOSA_JAW.top.map(q => [snoutLong(q[0]), q[1]]), shape: MOSA_JAW.shape.map(q => [snoutLong(q[0]), q[1]]) };
  function mosasaur(ctx, sp, o) {
    const A = anim(o, sp), P = A.P, S = A.S, st = A.st;
    const longS = has(sp, 'long_snout'), big = has(sp, 'big'), frill = has(sp, 'frill_back'), lum = has(sp, 'glow');
    const X = longS ? snoutLong : x => x;
    begin(ctx, A);
    const B = makeBody(A, longS ? MOSA_L : MOSA, { hx: 52, wave: 6, wl: 40, bendAmp: 15, tailTip: 3, thick: big ? 1.2 : 1, headScale: big ? 1.12 : 1.04 });
    const p = B.px, fs = S.fin, fl = A.fl, n1 = B.n - 1;
    let q = p(42, 10);
    flipper(ctx, A, q[0] - 4, q[1] - 4, paddle(2.5, fl * 0.5), 30 * fs, 12 * fs, P.finFar, { flat: true, curl: 0.3 });
    q = p(-26, 12);
    flipper(ctx, A, q[0] - 4, q[1] - 3, paddle(2.7, fl * 0.45), 26 * fs, 11 * fs, P.finFar, { flat: true, curl: 0.3 });
    tailFin(ctx, A, B, [-25 * fs, -22 * fs], [-29 * fs, 22 * fs], -13 * fs, P.fin, { glow: true });
    if (frill) {
      // low serrated crest along the back
      const h = 6.5 * Math.min(1.4, 0.35 + 0.65 * S.feat), u0 = 0.4, u1 = U(B, 50), N = 22;
      const pts = [];
      for (let i = 0; i <= N; i++) {
        const u = lerp(u0, u1, i / N), e = Math.pow(Math.sin(PI * i / N), 0.5), b = at(B, u, 0.85), nn = nrm(B, u);
        const hh = h * e * (i % 2 ? 0.35 : 1) + B.up[Math.round(u)] * 0.15;
        pts.push([b[0] + nn[0] * hh - (i % 2 ? 0 : 1.5), b[1] + nn[1] * hh]);
      }
      for (let i = N; i >= 0; i -= 2) pts.push(at(B, lerp(u0, u1, i / N), 0.5));
      H.poly(ctx, pts, true);
      H.fillStroke(ctx, H.mix(P.fin, P.acc, 0.5), P.ink, 1.5);
      if (st === 3 || lum) glow(ctx, A, () => { ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i <= N; i++) ctx.lineTo(pts[i][0], pts[i][1]); }, 0.9);
    }
    jawGroup(ctx, A, B, longS ? MOSA_JAW_L : MOSA_JAW, { from: [68, 6.8], to: [X(96), 2.6], n: 7, len: 4 });
    skin(ctx, A, sp, B, {
      belly: { v: u => lerp(-0.4, 0.05, u / n1) },
      pat: { u0: 1, u1: 9.5, v0: 0, v1: 0.95, n: sp.pattern === 'spots' ? 26 : 12, s: big ? 1.15 : 1 },
      tex: { u0: 0.5, u1: n1, n: 60, r: 0.65 },
      cau: [1.5, 10.5],
      hl: [5.5, 0.42, 36, 9],
      scar: { u0: 3, u1: 8.5, v0: 0, v1: 0.7, s: 1.15 },
      late: () => {
        // throat pleats
        ctx.beginPath();
        for (let i = 0; i < 3; i++) { const a = p(44 + i * 3, 10 + i * 0.8), b = p(62 + i * 2, 12 - i * 0.6); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); }
        ctx.strokeStyle = H.rgba(P.ink, 0.22); ctx.lineWidth = 0.9; ctx.stroke();
        if (lum) {
          const d = rnd(sp.seed * 5 + 1, 80), pts = [];
          for (let i = 0; i < 18; i++) { const c = at(B, 1 + i / 18 * (n1 - 3), i % 2 ? 0.3 : -0.25); pts.push([c[0], c[1], 0.9 + d[i] * 0.8]); }
          glowDots(ctx, A, pts);
        }
      },
      glow: () => {
        // chevrons along the back
        ctx.beginPath();
        for (let u = 2; u <= 8.5; u += 1.1) { const a = at(B, u, 0.75), b = at(B, u + 0.35, 0.4), c = at(B, u, 0.05); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(c[0], c[1]); }
      },
      glowAlways: lum,
      glowW: 1.2,
    });
    teethRow(ctx, A, B, [68, 6.6], [X(99), 2.2], 8, 4.4, false);
    if (longS) {
      // bony rostrum ridge beyond the teeth
      const a = p(X(98), -2.6), b = p(X(103), 0.2);
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.quadraticCurveTo(b[0] + 1, a[1], b[0], b[1]);
      ctx.strokeStyle = H.rgba(P.ink, 0.4); ctx.lineWidth = 1.1; ctx.stroke();
    }
    q = p(X(97), -2.8);
    ctx.fillStyle = H.rgba(P.ink, 0.75);
    H.ellipse(ctx, q[0], q[1], 1.7, 0.7, -0.15); ctx.fill();
    const eq = p(76, -5.4), er = 3.1 * S.eye;
    // heavy brow ridge
    const b0 = p(70, -8.6), b1 = p(78, -10), b2 = p(83, -7.6);
    ctx.beginPath(); ctx.moveTo(b0[0], b0[1]); ctx.quadraticCurveTo(b1[0], b1[1], b2[0], b2[1]);
    ctx.strokeStyle = H.rgba(P.ink, 0.55); ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.stroke();
    eye(ctx, A, eq, er, { iris: lum ? P.glow : st === 3 ? '#ffd23a' : '#d9cf52', pupil: 'slit' });
    if (lum && !A.hurt && !A.blink) glow(ctx, A, () => { ctx.beginPath(); ctx.arc(eq[0], eq[1], er * 1.05, 0, TAU); }, 0.7);
    q = p(42, 14);
    flipper(ctx, A, q[0], q[1], paddle(2.45, fl * 0.5), 32 * fs, 12.5 * fs, P.fin, { bones: true, curl: 0.3, edge: H.rgba(P.ink, 0.2) });
    q = p(-26, 15);
    flipper(ctx, A, q[0], q[1], paddle(2.65, fl * 0.45), 27 * fs, 11 * fs, P.fin, { bones: true, curl: 0.3, edge: H.rgba(P.ink, 0.2) });
    effects(ctx, A, sp, B, p(X(101), 3), eq, er);
    ctx.restore();
  }

  // =====================================================================
  // Pliosaur (liopleurodon)
  // =====================================================================
  const PLIO = [
    [-86, 1.4, 1.4], [-74, 5, 5], [-52, 12.5, 12.5], [-26, 21, 21], [0, 25, 24], [20, 23, 22],
    [32, 19, 18], [42, 20, 17.5], [50, 19, 9.8], [62, 16.6, 7.8], [78, 12.4, 6], [92, 8.6, 4.6],
    [102, 5.2, 3.2], [108, 2, 1.6],
  ];
  const PLIO_JAW = {
    hinge: [50, 10], open: 0.6,
    top: [[62, 7.8], [78, 6], [92, 4.6], [102, 3.2], [108, 1.6]],
    shape: [[50, 10], [62, 7.8], [78, 6], [92, 4.6], [102, 3.2], [108, 1.6], [108, 3.8], [102, 6.4], [90, 9.8], [74, 13.6], [60, 17], [48, 18.2], [40, 17], [42, 13]],
  };
  function pliosaur(ctx, sp, o) {
    const A = anim(o, sp), P = A.P, S = A.S, st = A.st;
    begin(ctx, A);
    ctx.translate(0, -4);
    const B = makeBody(A, PLIO, { hx: 38, wave: 3, wl: 30, bendAmp: 12, tailTip: 2 });
    const p = B.px, fs = S.fin, n1 = B.n - 1;
    const extra = (A.fl - Math.sin(A.ph) * 0.3) * 0.6;
    const fa = Math.sin(A.ph) * 0.4 + extra, fb = Math.sin(A.ph - 1.1) * 0.4 + extra;
    let q = p(14, 8);
    flipper(ctx, A, q[0] - 5, q[1] - 4, paddle(2.6, fa - 0.12), 40 * fs, 13 * fs, P.finFar, { flat: true, curl: 0.3 });
    q = p(-32, 9);
    flipper(ctx, A, q[0] - 5, q[1] - 4, paddle(2.8, fb - 0.12, 2.5), 44 * fs, 14 * fs, P.finFar, { flat: true, curl: 0.3 });
    tailFin(ctx, A, B, [-11 * fs, -10 * fs], [-10 * fs, 8 * fs], -6, P.fin, { noBeat: true });
    jawGroup(ctx, A, B, PLIO_JAW, { from: [55, 9.6], to: [102, 3.4], n: 8, len: 5.6 }, () => {
      if (S.teeth > 0.05) { const a = p(104, 3), l = 5 * S.teeth; fangs(ctx, a[0], a[1], a[0] + 4, a[1] - 1, 1, l, true, P.tooth); }
    });
    skin(ctx, A, sp, B, {
      belly: { v: u => lerp(-0.3, 0.02, u / n1) },
      pat: { u0: 1, u1: 11, v0: -0.1, v1: 0.95, n: 26 },
      tex: { u0: 0.5, u1: n1, n: 56, r: 0.75 },
      cau: [1.5, 11.5],
      hl: [5.5, 0.42, 32, 11],
      scar: { u0: 3, u1: 10.5, v0: 0, v1: 0.75, s: 1.2 },
      late: () => {
        // skull ridge and jaw muscle
        const a = p(48, -17), b = p(70, -13), c = p(96, -6.5);
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.quadraticCurveTo(b[0], b[1], c[0], c[1]);
        ctx.strokeStyle = 'rgba(255,255,255,.14)'; ctx.lineWidth = 1.6; ctx.stroke();
        const m0 = p(44, -2), m1 = p(52, 2), m2 = p(60, 5);
        ctx.beginPath(); ctx.moveTo(m0[0], m0[1]); ctx.quadraticCurveTo(m1[0], m1[1] - 4, m2[0], m2[1]);
        ctx.strokeStyle = H.rgba(P.ink, 0.25); ctx.lineWidth = 1.2; ctx.stroke();
      },
      glow: () => {
        const a = p(52, 6.6), b = p(80, 3.6), c = p(104, 0.8);
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.quadraticCurveTo(b[0], b[1], c[0], c[1]);
        // dashed glowing marks along the back
        for (let u = 1.6; u < 7.4; u += 0.75) { const d0 = at(B, u, 0.5), d1 = at(B, u + 0.38, 0.52); ctx.moveTo(d0[0], d0[1]); ctx.lineTo(d1[0], d1[1]); }
      },
      glowW: 1.3,
    });
    teethRow(ctx, A, B, [55, 9.2], [103, 2.4], 9, 6.2, false);
    if (S.teeth > 0.05) {
      // big splayed front fangs
      const a = p(104.5, 1.8), l = 6.5 * S.teeth * S.head;
      ctx.save();
      ctx.translate(a[0], a[1]); ctx.rotate(-0.55);
      fangs(ctx, -3, 0, 2, 0, 1, l, false, P.tooth);
      ctx.restore();
    }
    q = p(97, -5.8);
    ctx.fillStyle = H.rgba(P.ink, 0.75);
    H.ellipse(ctx, q[0], q[1], 1.6, 0.8, -0.2); ctx.fill();
    const eq = p(65, -9.4), er = 3.2 * S.eye;
    const b0 = p(58, -13.6), b1 = p(66, -15.6), b2 = p(73, -12);
    ctx.beginPath(); ctx.moveTo(b0[0], b0[1]); ctx.quadraticCurveTo(b1[0], b1[1], b2[0], b2[1]);
    ctx.strokeStyle = H.rgba(P.ink, 0.6); ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.stroke();
    eye(ctx, A, eq, er, { iris: st === 3 ? '#ff8a2a' : '#f0a838' });
    q = p(16, 13);
    flipper(ctx, A, q[0], q[1], paddle(2.55, fa), 44 * fs, 14 * fs, P.fin, { bones: true, curl: 0.3, edge: H.rgba(P.ink, 0.2) });
    q = p(-30, 13);
    flipper(ctx, A, q[0], q[1], paddle(2.75, fb, 2.48), 48 * fs, 15 * fs, P.fin, { bones: true, curl: 0.3, edge: H.rgba(P.ink, 0.2) });
    effects(ctx, A, sp, B, p(106, 3), eq, er);
    ctx.restore();
  }
  /** Adds a sub-path along the body (no beginPath) — used to combine glow lines. */
  function edgePathAppend(ctx, B, u0, u1, v) {
    for (let u = u0, first = true; ; u += 0.5) {
      const q = at(B, Math.min(u, u1), v);
      if (first) { ctx.moveTo(q[0], q[1]); first = false; } else ctx.lineTo(q[0], q[1]);
      if (u >= u1) break;
    }
  }

  // =====================================================================
  // Plesiosaur (plesiosaurus; very_long_neck = elasmosaurus)
  // =====================================================================
  const PLES = [
    [-76, 1.2, 1.2], [-64, 4.6, 4.6], [-46, 11.5, 11.5], [-22, 19, 20], [2, 21.5, 22], [22, 19.5, 20], [34, 14, 15], [40, 10.5, 11],
  ];
  function plesiosaur(ctx, sp, o) {
    const A = anim(o, sp), P = A.P, S = A.S, st = A.st, vlong = has(sp, 'very_long_neck');
    begin(ctx, A, 0.7);
    const B = makeBody(A, PLES, { hx: 60, wave: 3, wl: 30, bendAmp: 10, tailTip: 2 });
    const p = B.px, fs = S.fin, nb = B.n;
    // neck chain from the shoulders
    const N = vlong ? 13 : 7, seg = (vlong ? 9.6 : 9.4) * S.neck;
    let a0 = vlong ? -0.95 : -0.5, a1 = vlong ? 0.42 : 0.1;
    const lg = A.neck;
    if (A.pose === 'attack') {
      if (lg < 0) { const c = -lg / 0.3; a0 -= 0.25 * c; a1 += 0.4 * c; }   // coil back like a spring
      else { const f = lg * (vlong ? 0.62 : 0.85); a0 = lerp(a0, -0.12, f); a1 = lerp(a1, 0.08, f); }   // whip forward
    } else if (A.pose === 'hurt') { a0 -= 0.12 * A.rc; a1 -= 0.32 * A.rc; }
    else if (A.pose === 'roar') { a0 -= vlong ? 0.12 : 0.2; a1 -= vlong ? 0.32 : 0.42; }
    else if (A.pose === 'eat') { a1 += 0.5 + 0.08 * Math.sin(A.t * 9); }
    else a1 += Math.sin(A.t * 0.7 + A.seed) * 0.12;
    let x = B.x[nb - 1], y = B.y[nb - 1], ang = 0;
    const w0 = 10.5 * lerp(1, S.chub, 0.5), w1 = 4.6 * Math.sqrt(S.head);
    for (let j = 1; j <= N; j++) {
      const f = j / N;
      // leave the shoulders almost level, rise to a0, then bend towards a1 near the head
      ang = (f < 0.3 ? lerp(-0.12, a0, sstep(f / 0.3)) : lerp(a0, a1, sstep((f - 0.3) / 0.7)))
        + Math.sin(A.t * 1.3 - j * 0.45 + A.seed) * 0.05 * f;
      x += Math.cos(ang) * seg; y += Math.sin(ang) * seg;
      const w = lerp(w0, w1, Math.pow(f, 0.7));
      B.x.push(x); B.y.push(y); B.up.push(w); B.dn.push(w * 1.02);
    }
    B.n = nb + N;
    normals(B);
    const n1 = B.n - 1;
    // flippers (underwater flight: front and rear strokes out of phase)
    const extra = (A.fl - Math.sin(A.ph) * 0.3) * 0.6;
    const fa = Math.sin(A.ph) * 0.42 + extra, fb = Math.sin(A.ph - 1.4) * 0.42 + extra;
    let q = p(18, 7);
    flipper(ctx, A, q[0] - 5, q[1] - 5, paddle(2.65, fa - 0.12), 42 * fs, 14 * fs, P.finFar, { flat: true, curl: 0.35 });
    q = p(-30, 8);
    flipper(ctx, A, q[0] - 5, q[1] - 5, paddle(2.85, fb - 0.12, 2.45), 37 * fs, 13 * fs, P.finFar, { flat: true, curl: 0.35 });
    tailFin(ctx, A, B, [-9 * fs, -7 * fs], [-9 * fs, 6 * fs], -5, P.fin, { noBeat: true });
    skin(ctx, A, sp, B, {
      belly: { v: u => (u < nb - 1 ? -0.18 : lerp(-0.18, 0.1, (u - nb + 1) / N)) },
      pat: { u0: 1, u1: nb + N * 0.5, v0: 0, v1: 0.95, n: sp.pattern === 'spots' ? 22 : 12 },
      tex: { u0: 0.5, u1: n1, n: 46, r: 0.7 },
      cau: [1, nb + N * 0.6],
      hl: [3.4, 0.45, 26, 10],
      scar: { u0: 2, u1: 6, v0: 0, v1: 0.75 },
      glow: () => edgePath(ctx, B, 2, n1 - 0.5, 0.45),
      glowW: 1.3,
    });
    // small head at the end of the neck
    const hb = [B.x[n1], B.y[n1]], ha = ang + A.hp * 0.8, hs = S.head * (vlong ? 1.08 : 1.15);
    ctx.save();
    ctx.translate(hb[0], hb[1]);
    ctx.rotate(ha);
    ctx.scale(hs, hs);
    plesioHead(ctx, A, sp, hs);
    ctx.restore();
    q = p(18, 12);
    flipper(ctx, A, q[0], q[1], paddle(2.6, fa), 46 * fs, 15 * fs, P.fin, { bones: true, curl: 0.35, edge: H.rgba(P.ink, 0.2) });
    q = p(-30, 12);
    flipper(ctx, A, q[0], q[1], paddle(2.8, fb, 2.42), 40 * fs, 14 * fs, P.fin, { bones: true, curl: 0.35, edge: H.rgba(P.ink, 0.2) });
    const c = Math.cos(ha), s = Math.sin(ha);
    const hp = (lx, ly) => [hb[0] + (lx * c - ly * s) * hs, hb[1] + (lx * s + ly * c) * hs];
    effects(ctx, A, sp, B, hp(24, 1.5), hp(8.5, -2.4), 2.3 * S.eye);
    ctx.restore();
  }
  const PLES_SKULL = [[-4.5, -3.6], [-1, -6], [5, -7.2], [10.5, -6.4], [15, -4], [20, -2.2], [24.6, -1], [26, 0.2], [24.8, 1.1], [13, 1.9], [3, 2.6], [-3, 4.6], [-5.5, 1]];
  const PLES_JAW = [[3, 2.6], [13, 1.9], [24.8, 1.1], [24.8, 2.7], [18, 4.4], [9, 5.8], [1, 6.4], [-3, 5.2], [-1, 3]];
  function plesioHead(ctx, A, sp, hs) {
    const P = A.P, S = A.S, ang = A.jw * 0.55, h = [3, 2.6], lw = LW / hs;
    const top = [[13, 1.8], [24.6, 0.9]], rt = top.map(q => rot(q, h, ang));
    if (ang > 0.02) {
      ctx.beginPath(); ctx.moveTo(h[0], h[1]);
      for (const q of top) ctx.lineTo(q[0], q[1]);
      for (let i = rt.length - 1; i >= 0; i--) ctx.lineTo(rt[i][0], rt[i][1]);
      ctx.closePath(); ctx.fillStyle = P.mouth; ctx.fill();
    }
    const tl = 3.4 * S.teeth;
    ctx.save();
    ctx.translate(h[0], h[1]); ctx.rotate(ang); ctx.translate(-h[0], -h[1]);
    H.smooth(ctx, PLES_JAW, true, 0.35);
    H.fillStroke(ctx, P.jaw, P.ink, lw * 0.9);
    needles(ctx, A, [8, 2.2], [23.5, 1.3], 6, tl, -1, 0.35);
    ctx.restore();
    H.smooth(ctx, PLES_SKULL, true, 0.4);
    H.fillStroke(ctx, H.linear(ctx, 0, -6, 0, 3, [[0, P.dorsal], [0.55, P.body], [1, P.belly]]), P.ink, lw);
    // highlight, cheek line, nostril
    ctx.beginPath(); ctx.moveTo(0, -5.2); ctx.quadraticCurveTo(10, -7, 22, -1.8);
    ctx.strokeStyle = P.rim; ctx.lineWidth = 1 / hs; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-2, 2.4); ctx.quadraticCurveTo(4, 0.6, 10, 1.4);
    ctx.strokeStyle = H.rgba(P.ink, 0.25); ctx.lineWidth = 0.8 / hs; ctx.stroke();
    needles(ctx, A, [8, 2], [23.5, 1.2], 6, tl, 1, 0.35);
    ctx.fillStyle = H.rgba(P.ink, 0.7);
    H.ellipse(ctx, 20.5, -2.1, 0.9, 0.45, 0.2); ctx.fill();
    eye(ctx, A, [8.5, -2.4], 2.3 * S.eye / hs, { iris: A.st === 3 ? '#ffcc33' : '#e2b04a', lid: P.dorsal });
  }

  // =====================================================================
  // Sea turtle (archelon)
  // =====================================================================
  const SHELL = [[-64, 1.5, 1.5], [-54, 11, 4.5], [-36, 23, 6.5], [-14, 30.5, 7.5], [8, 32, 8], [26, 26.5, 7.5], [38, 17, 6.5], [44, 6, 5]];
  const T_SKULL = [[-6.5, -6.5], [1, -10.4], [10, -11.2], [17.5, -9], [23, -5.2], [26.6, -0.2], [27.6, 4.6], [26, 8.4], [23.8, 5.4], [18, 4.6], [8, 5.6], [-2, 8.6], [-7, 3]];
  const T_JAW = [[8, 5.6], [18, 4.6], [23.4, 5.4], [22.4, 8.6], [16, 10.8], [6, 11.4], [-1, 10], [1, 6.6]];
  function turtle(ctx, sp, o) {
    const A = anim(o, sp), P = A.P, S = A.S, st = A.st;
    begin(ctx, A, 0.7);
    ctx.translate(0, -8);   // big flippers: float a little higher
    A.wamp = 0;
    const B = makeBody(A, SHELL, { hx: 60, wave: 0, bendAmp: 0, tailTip: 0 });
    const p = B.px, ff = [0.98, 0.97, 1, 1.06][st];
    // wing-like strokes: up (raised behind the shell) and down, never straight down like a leg
    const flap = clamp(Math.sin(A.ph * 0.8) * 0.5 + (A.fl - Math.sin(A.ph) * 0.3) * 1.1, -0.39, 0.55);
    // far flippers (behind the shell)
    let q = p(18, 1);
    flipper(ctx, A, q[0] - 3, q[1] - 3, 2.75 + flap, 56 * ff, 15 * ff, P.far, { flat: true, curl: 0.5, wrist: true });
    q = p(-44, 3);
    flipper(ctx, A, q[0] - 3, q[1] - 2, 2.85 + flap * 0.3, 21 * ff, 10 * ff, P.far, { flat: true, round: true });
    // tail
    q = p(-56, 5);
    H.poly(ctx, [[q[0] + 6, q[1] - 3], [q[0] - 9, q[1] + 2], [q[0] + 6, q[1] + 4]], true);
    H.fillStroke(ctx, P.skin, P.ink, LW * 0.8);
    // neck reaching out of the shell (extends on a bite, retracts when hurt)
    const ext = (A.pose === 'attack' && !A.ram ? Math.max(0, A.lg) * 10 : 0) - A.rc * 6 + (A.pose === 'eat' ? 3 : 0);
    const nb = p(32, 1), hb = [p(44, 0)[0] + 12 * S.head + ext, p(44, -2)[1] - 2 + (A.pose === 'roar' ? -4 : 0)];
    const nm = [lerp(nb[0], hb[0], 0.5), lerp(nb[1], hb[1], 0.5) + 1.5];
    H.limb(ctx, [nb, nm, hb], [16, 14.5, 13 * Math.sqrt(S.head)], H.volume(ctx, P.skin, hb[1] - 8, hb[1] + 8), P.ink, LW);
    ctx.beginPath();
    for (let i = 0; i < 3; i++) {
      const c = [lerp(nb[0], hb[0], 0.45 + i * 0.16), lerp(nb[1], hb[1], 0.45 + i * 0.16)];
      ctx.moveTo(c[0] - 1.5, c[1] - 5.5); ctx.quadraticCurveTo(c[0] + 1.5, c[1], c[0] - 1, c[1] + 5.5);
    }
    ctx.strokeStyle = H.rgba(P.ink, 0.3); ctx.lineWidth = 1; ctx.stroke();
    // head
    const ha = A.hp + (A.ram ? 0.3 * Math.max(0, A.lg) : 0), hs = S.head * 1.18;
    ctx.save();
    ctx.translate(hb[0], hb[1]); ctx.rotate(ha); ctx.scale(hs, hs);
    turtleHead(ctx, A, hs);
    ctx.restore();
    // underbody
    const ub = [p(-50, 2), p(-30, 12.5), p(0, 16.5), p(28, 13.5), p(42, 3)];
    H.smooth(ctx, ub, false, 0.5); ctx.closePath();
    H.fillStroke(ctx, H.linear(ctx, 0, 0, 0, 17, [[0, P.belly], [1, H.shade(P.belly, -0.25)]]), P.ink, LW);
    ctx.beginPath();
    for (const xx of [-24, -4, 16]) { const a = p(xx, 6), b = p(xx + 2, 15); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); }
    ctx.strokeStyle = H.rgba(P.ink, 0.25); ctx.lineWidth = 1; ctx.stroke();
    // leathery ridged shell
    const n1 = B.n - 1;
    const keels = () => {
      ctx.beginPath();
      for (const kv of [0.88, 0.52, 0.16]) edgePathAppend(ctx, B, 0.7, n1 - 0.4, kv);
    };
    skin(ctx, A, sp, B, {
      cols: [P.shellTop, P.shell, P.shellLow], belly: false,
      pat: { u0: 0.8, u1: n1 - 0.5, v0: -0.4, v1: 0.95, n: 24 },
      tex: { u0: 0.3, u1: n1, n: 70, r: 0.8 },
      cau: [1, 6.5, 1.1],
      hl: [3.6, 0.55, 30, 12],
      extra: () => {
        keels(); ctx.strokeStyle = H.rgba(P.ink, 0.5); ctx.lineWidth = 2.2; ctx.stroke();
        ctx.save(); ctx.translate(0, 1.6);
        keels(); ctx.strokeStyle = H.rgba(P.shellLight, 0.6); ctx.lineWidth = 1.1; ctx.stroke();
        ctx.restore();
        // knobs along the top keel
        ctx.beginPath();
        for (let u = 1; u < n1 - 0.6; u += 0.42) { const c = at(B, u, 0.88), r = 1.1 + 0.3 * st; ctx.moveTo(c[0] + r, c[1]); ctx.arc(c[0], c[1], r, 0, TAU); }
        ctx.fillStyle = P.shellLight; ctx.fill();
        ctx.strokeStyle = H.rgba(P.ink, 0.45); ctx.lineWidth = 0.7; ctx.stroke();
        // pale shell rim
        edgePath(ctx, B, 0.4, n1, -0.92);
        ctx.strokeStyle = H.rgba(P.belly, 0.45); ctx.lineWidth = 3; ctx.stroke();
      },
      scar: { u0: 1.5, u1: 5.5, v0: 0.2, v1: 0.8, s: 1.1 },
      glow: () => { ctx.beginPath(); edgePathAppend(ctx, B, 0.8, n1 - 0.5, 0.52); },
      glowW: 1.2,
      late: () => {
        if (st !== 3) return;
        const pts = [];
        for (let u = 1.2; u < n1 - 0.6; u += 0.84) { const c = at(B, u, 0.88); pts.push([c[0], c[1], 1.1]); }
        glowDots(ctx, A, pts);
      },
    });
    // near flippers
    q = p(-42, 8);
    flipper(ctx, A, q[0], q[1], 2.9 + flap * 0.3, 24 * ff, 12 * ff, P.skin, { bones: true, round: true, scutes: true, wrist: true });
    q = p(24, 8);
    flipper(ctx, A, q[0], q[1], 2.75 + flap, 62 * ff, 18 * ff, H.volume(ctx, P.skin, q[1] - 10, q[1] + 30), { bones: true, scutes: true, curl: 0.5, wrist: true, edge: H.rgba(P.ink, 0.22) });
    const c = Math.cos(ha), s = Math.sin(ha);
    const hp = (lx, ly) => [hb[0] + (lx * c - ly * s) * hs, hb[1] + (lx * s + ly * c) * hs];
    effects(ctx, A, sp, B, hp(26, 6), hp(9, -3.5), 2.6 * S.eye);
    ctx.restore();
  }
  function turtleHead(ctx, A, hs) {
    const P = A.P, S = A.S, ang = A.jw * 0.62, h = [8, 5.4], lw = LW / hs;
    if (ang > 0.02) {
      const top = [[19, 4.4], [24, 4.6]], rt = top.map(q => rot(q, h, ang));
      ctx.beginPath(); ctx.moveTo(h[0], h[1]);
      for (const q of top) ctx.lineTo(q[0], q[1]);
      for (let i = rt.length - 1; i >= 0; i--) ctx.lineTo(rt[i][0], rt[i][1]);
      ctx.closePath(); ctx.fillStyle = P.mouth; ctx.fill();
    }
    ctx.save();
    ctx.translate(h[0], h[1]); ctx.rotate(ang); ctx.translate(-h[0], -h[1]);
    H.smooth(ctx, T_JAW, true, 0.3);
    H.fillStroke(ctx, P.jaw, P.ink, lw * 0.9);
    ctx.save(); H.smooth(ctx, T_JAW, true, 0.3); ctx.clip();
    ctx.fillStyle = P.beak; ctx.fillRect(15, 0, 14, 14);
    ctx.restore();
    H.smooth(ctx, T_JAW, true, 0.3); ctx.strokeStyle = P.ink; ctx.lineWidth = lw * 0.9; ctx.stroke();
    ctx.restore();
    H.smooth(ctx, T_SKULL, true, 0.35);
    H.fillStroke(ctx, H.linear(ctx, 0, -10, 0, 8, [[0, P.dorsal], [0.5, P.skin], [1, P.belly]]), P.ink, lw);
    ctx.save();
    H.smooth(ctx, T_SKULL, true, 0.35); ctx.clip();
    // horny hooked beak
    ctx.beginPath(); ctx.moveTo(17, -12); ctx.quadraticCurveTo(14, -2, 17.5, 6); ctx.lineTo(30, 10); ctx.lineTo(30, -12); ctx.closePath();
    ctx.fillStyle = P.beak; ctx.fill();
    ctx.beginPath(); ctx.moveTo(17, -12); ctx.quadraticCurveTo(14, -2, 17.5, 6);
    ctx.strokeStyle = H.rgba(P.ink, 0.5); ctx.lineWidth = 1 / hs; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(19, -8.5); ctx.quadraticCurveTo(25, -5.5, 26.6, 2);
    ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.lineWidth = 1 / hs; ctx.stroke();
    // head scales
    ctx.beginPath();
    for (const [x, y, r] of [[0, -5, 2.2], [5, -7.5, 2], [10, -8, 1.8], [-3, 0, 2], [3, 1.5, 1.8]]) { ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, TAU); }
    ctx.strokeStyle = H.rgba(P.ink, 0.25); ctx.lineWidth = 0.8 / hs; ctx.stroke();
    ctx.restore();
    H.smooth(ctx, T_SKULL, true, 0.35); ctx.strokeStyle = P.ink; ctx.lineWidth = lw; ctx.stroke();
    ctx.fillStyle = H.rgba(P.ink, 0.7);
    H.ellipse(ctx, 23, -3.2, 0.8, 0.5); ctx.fill();
    // brow fold over the eye
    ctx.beginPath(); ctx.moveTo(4, -6.5); ctx.quadraticCurveTo(9.5, -9, 14, -5.6);
    ctx.strokeStyle = H.rgba(P.ink, 0.45); ctx.lineWidth = 1.2 / hs; ctx.stroke();
    eye(ctx, A, [9, -3.5], 2.6 * S.eye / hs, { iris: A.st === 3 ? '#ff9a30' : '#c9a04a', lid: P.skin });
  }

  // ---------- Registration ----------
  /** Wrap a template so the canvas state is always restored, even if drawing throws (core then draws a fallback). */
  const safe = fn => function (ctx, sp, o, h) {
    ctx.save();
    try { fn(ctx, sp, o, h); } finally { ctx.restore(); }
  };
  // Bounds = measured union of every stage (normalised to stage-3 scale), pose and attack variant at size 1,
  // without effects (bubbles / streaks / prey fish may spill a little outside, into drawCreature's padding).
  ART.registerTemplate('turtle', safe(turtle), { bounds: [-87, -97, 126, 2], shadowW: 120 });
  ART.registerTemplate('ichthyosaur', safe(ichthyosaur), { bounds: [-108, -105, 126, 5], shadowW: 120 });
  ART.registerTemplate('armoredfish', safe(armoredfish), { bounds: [-129, -108, 119, 5], shadowW: 140 });
  ART.registerTemplate('plesiosaur', safe(plesiosaur), { bounds: [-106, -139, 217, 7], shadowW: 130 });
  ART.registerTemplate('mosasaur', safe(mosasaur), { bounds: [-140, -98, 150, 7], shadowW: 170 });
  ART.registerTemplate('shark', safe(shark), { bounds: [-126, -120, 112, 6], shadowW: 150 });
  ART.registerTemplate('pliosaur', safe(pliosaur), { bounds: [-119, -88, 150, 8], shadowW: 160 });
})(window.PC = window.PC || {});
