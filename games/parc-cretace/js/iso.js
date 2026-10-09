/* Crétacé Park — terrain generation and the isometric park view → PC.TERRAIN, PC.ISO.
   World coordinates: tile (gx, gy) top corner = ((gx − gy)·TW/2, (gx + gy)·TH/2), +y down the screen.
   The ground of each park is painted once into an offscreen canvas (1× world resolution); scenery, roads,
   enclosures, creatures, buildings, bubbles and ambient effects are drawn live on top every frame. */
(function (PC) {
  'use strict';

  const TW = 96, TH = 48, HW = TW / 2, HH = TH / 2, MAP = 24;
  const TAU = Math.PI * 2, PI = Math.PI;
  const ISO = PC.ISO = PC.ISO || {};
  const TERRAIN = PC.TERRAIN = PC.TERRAIN || {};
  ISO.TW = TW; ISO.TH = TH; ISO.MAP = MAP;

  const FONT_D = '"Russo One", "Arial Black", Impact, sans-serif';
  const FONT_UI = '"Exo 2", "Trebuchet MS", Arial, sans-serif';
  const ZMIN = 0.45, ZMAX = 1.8, TAP_PX = 6, HIT_SLOP_PX = 6;   // HIT_SLOP_PX: finger tolerance around building art

  // ---------------------------------------------------------------- small math helpers
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, k) => a + (b - a) * k;
  const fract = v => v - Math.floor(v);
  const sstep = k => { k = clamp(k, 0, 1); return k * k * (3 - 2 * k); };
  /** World x / y of grid point (gx, gy) (fractional allowed). */
  const wx = (gx, gy) => (gx - gy) * HW;
  const wy = (gx, gy) => (gx + gy) * HH;
  ISO.toWorld = (gx, gy) => [wx(gx, gy), wy(gx, gy)];
  /** Fractional grid point under world point (x, y). */
  ISO.toGrid = (x, y) => [(x / HW + y / HH) / 2, (y / HH - x / HW) / 2];

  // ---------------------------------------------------------------- colours
  function hexRgb(hex) {
    let h = String(hex).replace('#', '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    const n = parseInt(h.slice(0, 6), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const rgbHex = (r, g, b) => '#' + [r, g, b].map(v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
  function shade(hex, amt) {
    const [r, g, b] = hexRgb(hex);
    if (amt < 0) return rgbHex(r * (1 + amt), g * (1 + amt), b * (1 + amt));
    return rgbHex(r + (255 - r) * amt, g + (255 - g) * amt, b + (255 - b) * amt);
  }
  function mix(a, b, k) {
    const A = hexRgb(a), B = hexRgb(b);
    return rgbHex(A[0] + (B[0] - A[0]) * k, A[1] + (B[1] - A[1]) * k, A[2] + (B[2] - A[2]) * k);
  }
  function rgba(hex, a) { const [r, g, b] = hexRgb(hex); return `rgba(${r},${g},${b},${a})`; }

  // ---------------------------------------------------------------- deterministic randomness & noise
  function rng(seed) {
    let s = seed | 0;
    return () => {
      s = (s + 0x6D2B79F5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function ihash(x, y, s) {
    let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 1274126177);
    h = Math.imul(h ^ (h >>> 13), 1103515245);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  /** Smooth value noise in [0, 1]. */
  function vnoise(x, y, s) {
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    const a = ihash(ix, iy, s), b = ihash(ix + 1, iy, s), c = ihash(ix, iy + 1, s), d = ihash(ix + 1, iy + 1, s);
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
  }
  function fbm(x, y, s, oct) {
    let v = 0, amp = 0.5, f = 1, n = 0;
    for (let i = 0; i < (oct || 3); i++) { v += vnoise(x * f, y * f, s + i * 101) * amp; n += amp; amp *= 0.5; f *= 2.03; }
    return v / n;
  }

  // ---------------------------------------------------------------- terrain generation
  // Planned fixed positions (top corner gx, gy). The gate sits on the front-left edge (gy max, the edge
  // nearest the viewer) with an entrance road leading out of the map; lab and arena flank it inside.
  // In the glacier park the arrival harbour sits on the back-right shore: its art has its quay water
  // along its gy = 0 side, which joins the open sea painted beyond that edge.
  const PLANS = {
    land: { gate: [10, 19], lab: [5, 15], arena: [15, 13] },
    sea: { gate: [10, 19], lab: [4, 14], arena: [15, 13] },
    ice: { gate: [9, 19], harbor: [15, 3], lab: [4, 14], arena: [15, 11] },
  };
  const SEEDS = { land: 7121, sea: 9343, ice: 5527 };
  const DEFAULT_SIZES = { gate: [3, 2], lab: [3, 3], arena: [4, 4], harbor: [4, 3] };
  const SCENERY_KINDS = {
    land: { near: [['bush', 4], ['fern', 5], ['flowers', 3], ['rock', 1]], far: [['palm', 4], ['broadleaf', 4], ['bush', 2], ['fern', 2], ['rock', 1]] },
    sea: { near: [['anemone', 3], ['coral_brain', 3], ['sea_rock', 2], ['coral_fan', 1]], far: [['coral_fan', 4], ['kelp', 4], ['coral_brain', 2], ['sea_rock', 2], ['anemone', 1]] },
    ice: { near: [['snow_rock', 3], ['ice_shard', 2]], far: [['pine', 6], ['dead_tree', 1], ['snow_rock', 2], ['ice_shard', 1]] },
  };
  /** Large view-only landmarks (drawn with PC.BUILD_ART.draw) placed in the scenery border: [art, gx, gy, w, h]. */
  const LANDMARKS = {
    land: [],
    sea: [['fossil_skeleton', 0, 11, 2, 2], ['ancient_ruins', 13, 0, 2, 2], ['shipwreck', 22, 7, 2, 2]],
    ice: [],
  };

  function weighted(R, list) {
    let tot = 0;
    for (const e of list) tot += e[1];
    let r = R() * tot;
    for (const e of list) { r -= e[1]; if (r <= 0) return e[0]; }
    return list[list.length - 1][0];
  }

  const terrainCache = {};
  /**
   * Generate (once, cached) the terrain of a park.
   * → { park, w, h, tiles: Uint8Array (0 scenery border, 1 buildable, 2 water), water: Uint8Array (0, 1 pond/lake,
   *     2 open sea), fixed: [{buildingId, gx, gy}], scenery: [{gx, gy, kind, seed}] (fractional grid point = ground
   *     point), landmarks, outer (view-only margin scenery), entrance: {x0, x1, y0}, core: {x0, y0, x1, y1} }
   */
  TERRAIN.generate = function (park) {
    if (!PLANS[park]) park = 'land';
    if (terrainCache[park]) return terrainCache[park];
    const N = MAP, seed = SEEDS[park], plan = PLANS[park];
    const tiles = new Uint8Array(N * N), water = new Uint8Array(N * N);
    const I = (x, y) => y * N + x;
    const inMap = (x, y) => x >= 0 && y >= 0 && x < N && y < N;
    const B = PC.DATA && PC.DATA.BUILDINGS;
    const sizeOf = (key) => {
      const d = B && B[key + '_' + park];
      return d && d.size ? [d.size[0] | 0 || 1, d.size[1] | 0 || 1] : DEFAULT_SIZES[key];
    };

    // 1. irregular natural core (nominal 3..20, noisy edge), kept at least 2 tiles away from the map edge
    const C0 = 3, C1 = 20;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const d = Math.min(x - C0, C1 - x, y - C0, C1 - y);
      const n = fbm(x * 0.42, y * 0.42, seed, 3);
      const v = d + (n - 0.5) * 3.4;
      tiles[I(x, y)] = v >= -0.35 && x >= 2 && y >= 2 && x <= 21 && y <= 21 ? 1 : 0;
    }
    // smooth (majority of the 8 neighbours)
    for (let pass = 0; pass < 2; pass++) {
      const nt = tiles.slice();
      for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) {
        let c = 0;
        for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) if ((i || j) && tiles[I(x + i, y + j)] === 1) c++;
        if (c >= 6) nt[I(x, y)] = x >= 2 && y >= 2 && x <= 21 && y <= 21 ? 1 : 0;
        else if (c <= 2) nt[I(x, y)] = 0;
      }
      tiles.set(nt);
    }

    // 2. fixed footprints (forced buildable) and the entrance road in front of the gate (forced border)
    const want = [];
    for (const key of ['gate', 'harbor', 'lab', 'arena']) {
      if (!plan[key]) continue;
      const [w, h] = sizeOf(key);
      want.push({ key, buildingId: key + '_' + park, gx: plan[key][0], gy: plan[key][1], w, h });
    }
    const gate = want[0];
    gate.gy = Math.min(gate.gy, N - 3 - gate.h);
    for (const f of want) for (let y = f.gy; y < f.gy + f.h; y++) for (let x = f.gx; x < f.gx + f.w; x++) if (inMap(x, y)) tiles[I(x, y)] = 1;
    const entrance = { x0: gate.gx, x1: gate.gx + gate.w, y0: gate.gy + gate.h };
    for (let y = entrance.y0; y < N; y++) for (let x = entrance.x0 - 1; x <= entrance.x1; x++) if (inMap(x, y)) tiles[I(x, y)] = 0;

    // 3. keep the main connected piece, fill holes
    const keep = new Uint8Array(N * N), stack = [[gate.gx, gate.gy]];
    while (stack.length) {
      const [x, y] = stack.pop();
      if (!inMap(x, y) || keep[I(x, y)] || tiles[I(x, y)] !== 1) continue;
      keep[I(x, y)] = 1;
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
    const outside = new Uint8Array(N * N);
    for (let i = 0; i < N; i++) stack.push([i, 0], [i, N - 1], [0, i], [N - 1, i]);
    while (stack.length) {
      const [x, y] = stack.pop();
      if (!inMap(x, y) || outside[I(x, y)] || keep[I(x, y)]) continue;
      outside[I(x, y)] = 1;
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
    for (let i = 0; i < N * N; i++) tiles[i] = keep[i] || !outside[i] ? 1 : 0;

    // 4. water: a pond fed by a river (land), a frozen lake + the open sea shore (ice); none under the sea
    const setWater = (x, y, kind) => { if (inMap(x, y)) { tiles[I(x, y)] = 2; water[I(x, y)] = kind; } };
    if (park === 'land') {
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const dx = (x + 0.5 - 6.2) / 2.3, dy = (y + 0.5 - 6.4) / 1.75;
        if (dx * dx + dy * dy + (vnoise(x * 0.9, y * 0.9, seed + 7) - 0.5) * 0.7 < 1) setWater(x, y, 1);
      }
      let px = -1, py = -1;
      for (let k = 0; k <= 60; k++) {
        const u = k / 60, x = lerp(0, 4.6, u), y = lerp(10.6, 6.8, u) + Math.sin(u * 5.5) * 0.9;
        const tx = Math.floor(x), ty = Math.floor(y);
        if (px >= 0 && tx !== px && ty !== py) setWater(tx, py, 1);
        setWater(tx, ty, 1);
        px = tx; py = ty;
      }
    } else if (park === 'ice') {
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const dx = (x + 0.5 - 7.2) / 2.0, dy = (y + 0.5 - 7.6) / 1.7;
        if (dx * dx + dy * dy + (vnoise(x * 0.9, y * 0.9, seed + 7) - 0.5) * 0.6 < 1) setWater(x, y, 1);
      }
      const hb = want.find(f => f.key === 'harbor');
      for (let x = 0; x < N; x++) {
        const edge = x < 5 ? 0 : 1 + (vnoise(x * 0.5, 3, seed + 9) > 0.55 ? 1 : 0);
        for (let y = 0; y <= edge; y++) if (tiles[I(x, y)] !== 1) setWater(x, y, 2);
      }
      if (hb) for (let x = hb.gx - 1; x <= hb.gx + hb.w; x++) for (let y = 0; y < hb.gy; y++) setWater(x, y, 2);
    }
    for (const f of want) for (let y = f.gy; y < f.gy + f.h; y++) for (let x = f.gx; x < f.gx + f.w; x++) if (inMap(x, y)) { tiles[I(x, y)] = 1; water[I(x, y)] = 0; }

    // 5. validate fixed footprints (all on code 1, no overlap); relocate (spiral search) if a size changed
    const taken = new Uint8Array(N * N);
    const fits = (x, y, w, h) => {
      if (x < 0 || y < 0 || x + w > N || y + h > N) return false;
      for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (tiles[I(i, j)] !== 1 || taken[I(i, j)]) return false;
      return true;
    };
    const fixed = [];
    for (const f of want) {
      let px = f.gx, py = f.gy;
      if (!fits(px, py, f.w, f.h)) {
        let best = null;
        for (let r = 1; r < N && !best; r++) for (let j = -r; j <= r && !best; j++) for (let i = -r; i <= r; i++) {
          if (Math.max(Math.abs(i), Math.abs(j)) !== r) continue;
          if (fits(f.gx + i, f.gy + j, f.w, f.h)) { best = [f.gx + i, f.gy + j]; break; }
        }
        if (best) { px = best[0]; py = best[1]; }
      }
      for (let j = py; j < py + f.h; j++) for (let i = px; i < px + f.w; i++) if (inMap(i, j)) taken[I(i, j)] = 1;
      fixed.push({ buildingId: f.buildingId, gx: px, gy: py });
      f.gx = px; f.gy = py;
    }

    // 6. scenery: dense border, small plants near the core, tall trees further out; nothing on the road / water
    const dist = new Uint8Array(N * N).fill(99);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      if (tiles[I(x, y)] === 1) { dist[I(x, y)] = 0; continue; }
      let d = 99;
      for (let j = Math.max(0, y - 4); j <= Math.min(N - 1, y + 4); j++) for (let i = Math.max(0, x - 4); i <= Math.min(N - 1, x + 4); i++) {
        if (tiles[I(i, j)] === 1) d = Math.min(d, Math.max(Math.abs(i - x), Math.abs(j - y)));
      }
      dist[I(x, y)] = d;
    }
    const reserved = new Uint8Array(N * N);
    for (let y = entrance.y0; y < N; y++) for (let x = entrance.x0; x < entrance.x1; x++) if (inMap(x, y)) reserved[I(x, y)] = 1;
    const landmarks = [];
    for (const [art, lx, ly, lw, lh] of LANDMARKS[park]) {
      let ok = true;
      for (let y = ly; y < ly + lh; y++) for (let x = lx; x < lx + lw; x++) if (!inMap(x, y) || tiles[I(x, y)] !== 0) ok = false;
      if (!ok) continue;
      for (let y = ly; y < ly + lh; y++) for (let x = lx; x < lx + lw; x++) reserved[I(x, y)] = 1;
      landmarks.push({ art, gx: lx, gy: ly, w: lw, h: lh });
    }
    const R = rng(seed * 7 + 3), K = SCENERY_KINDS[park], scenery = [];
    const front = (x, y) => x > C1 || y > C1;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const i = I(x, y);
      if (tiles[i] === 1 || reserved[i]) continue;
      if (tiles[i] === 2) {
        if (park === 'ice' && water[i] === 2 && R() < 0.12) scenery.push({ gx: x + 0.3 + R() * 0.4, gy: y + 0.3 + R() * 0.4, kind: 'iceberg', seed: (R() * 1e9) | 0 });
        continue;
      }
      const d = dist[i], nearOnly = d <= 1 || (front(x, y) && d <= 2);
      const n = R() < 0.9 ? (R() < (nearOnly ? 0.25 : 0.55) ? 2 : 1) : 0;
      for (let k = 0; k < n; k++) {
        const kind = weighted(R, nearOnly ? K.near : K.far);
        scenery.push({ gx: x + 0.18 + R() * 0.64, gy: y + 0.18 + R() * 0.64, kind, seed: (R() * 1e9) | 0 });
      }
    }
    // landmark surroundings (rocks / corals around the half-buried fossil etc.)
    for (const L of landmarks) {
      for (let k = 0; k < 5; k++) {
        const a = k / 5 * TAU + R();
        scenery.push({ gx: L.gx + L.w / 2 + Math.cos(a) * 1.25, gy: L.gy + L.h / 2 + Math.sin(a) * 1.25, kind: k % 2 ? 'sea_rock' : 'coral_brain', seed: (R() * 1e9) | 0 });
      }
    }
    // view-only scenery in the 3-tile margin around the map, so zoomed-out views stay lush
    const outer = [];
    for (let y = -3; y < N + 3; y++) for (let x = -3; x < N + 3; x++) {
      if (inMap(x, y)) continue;
      const cx = clamp(x, 0, N - 1), cy = clamp(y, 0, N - 1);
      if (tiles[I(cx, cy)] === 2 || (reserved[I(cx, cy)] && y >= N)) continue;
      if (R() < 0.62) outer.push({ gx: x + 0.2 + R() * 0.6, gy: y + 0.2 + R() * 0.6, kind: weighted(R, K.far), seed: (R() * 1e9) | 0 });
    }

    let cx0 = N, cy0 = N, cx1 = 0, cy1 = 0;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (tiles[I(x, y)] === 1) { cx0 = Math.min(cx0, x); cy0 = Math.min(cy0, y); cx1 = Math.max(cx1, x + 1); cy1 = Math.max(cy1, y + 1); }
    const T = { park, w: N, h: N, tiles, water, fixed, scenery, landmarks, outer, entrance, core: { x0: cx0, y0: cy0, x1: cx1, y1: cy1 }, seed };
    terrainCache[park] = T;
    return T;
  };
  /** Tile code at (gx, gy) of a park (0 outside the map). */
  TERRAIN.tileAt = function (park, gx, gy) {
    const T = TERRAIN.generate(park);
    gx |= 0; gy |= 0;
    return gx >= 0 && gy >= 0 && gx < T.w && gy < T.h ? T.tiles[gy * T.w + gx] : 0;
  };
  TERRAIN.isBuildable = (park, gx, gy) => TERRAIN.tileAt(park, gx, gy) === 1;

  // ---------------------------------------------------------------- terrain painting (cached canvas per park)
  const MARGIN = 3;
  const PAL = {
    land: { bg: '#3d7429', border: '#4b8631', core: '#79b444' },
    sea: { bg: '#0d3d63', border: '#114a74', core: '#1f6aa0' },
    ice: { bg: '#d3e1ec', border: '#dbe7f0', core: '#eef4f9' },
  };
  ISO.PALETTE = PAL;

  /** Add tile (x, y)'s diamond to a path / context. */
  function diamond(p, x, y) {
    const X = wx(x, y), Y = wy(x, y);
    p.moveTo(X, Y); p.lineTo(X + HW, Y + HH); p.lineTo(X, Y + TH); p.lineTo(X - HW, Y + HH); p.closePath();
  }
  /** Grid-aligned rectangle [u0, u1] × [v0, v1] → world quad on a path / context. */
  function quadIso(p, u0, v0, u1, v1) {
    p.moveTo(wx(u0, v0), wy(u0, v0)); p.lineTo(wx(u1, v0), wy(u1, v0));
    p.lineTo(wx(u1, v1), wy(u1, v1)); p.lineTo(wx(u0, v1), wy(u0, v1)); p.closePath();
  }
  /** Smooth outline of the pond / lake tiles: union of iso circles of grid radius r centred on the water tiles,
      on the midpoints between neighbouring water tiles and on the inner corners of 2×2 water blocks. */
  function smoothWater(S, r) {
    if (!S._wpts) {
      const set = new Set(S.pondT.map(([x, y]) => x + ',' + y)), has = (x, y) => set.has(x + ',' + y), pts = [];
      for (const [x, y] of S.pondT) {
        pts.push([x + 0.5, y + 0.5]);
        if (has(x + 1, y)) pts.push([x + 1, y + 0.5]);
        if (has(x, y + 1)) pts.push([x + 0.5, y + 1]);
        if (has(x + 1, y) && has(x, y + 1) && has(x + 1, y + 1)) pts.push([x + 1, y + 1]);
      }
      S._wpts = pts;
    }
    const p = new Path2D(), rx = r * HW * Math.SQRT2, ry = r * HH * Math.SQRT2;
    for (const [u, v] of S._wpts) { const X = wx(u, v), Y = wy(u, v); p.moveTo(X + rx, Y); p.ellipse(X, Y, rx, ry, 0, 0, TAU); }
    return p;
  }
  /** Add an ellipse as its own sub-path (no joining line). */
  function ellP(p, x, y, rx, ry, rot) {
    rot = rot || 0;
    p.moveTo(x + Math.cos(rot) * rx, y + Math.sin(rot) * rx);
    p.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), rot, 0, TAU);
  }

  function paintTerrain(T) {
    const park = T.park, N = MAP, M = MARGIN, P = PAL[park];
    const minX = -(N + 2 * M) * HW, maxX = -minX, minY = -2 * M * HH - 4, maxY = 2 * (N + M) * HH + 28;
    const cw = maxX - minX, ch = maxY - minY;
    const c = document.createElement('canvas');
    c.width = cw; c.height = ch;
    const g = c.getContext('2d');
    g.setTransform(1, 0, 0, 1, -minX, -minY);
    g.lineCap = 'round'; g.lineJoin = 'round';
    const R = rng(T.seed * 13 + 5);
    const code = (x, y) => {
      if (x >= 0 && y >= 0 && x < N && y < N) return T.tiles[y * N + x];
      return T.tiles[clamp(y, 0, N - 1) * N + clamp(x, 0, N - 1)] === 2 ? 2 : 0;
    };
    const wkind = (x, y) => (code(x, y) === 2 ? T.water[clamp(y, 0, N - 1) * N + clamp(x, 0, N - 1)] : 0);
    const core = new Path2D(), border = new Path2D(), pond = new Path2D(), sea = new Path2D();
    const coreT = [], borderT = [], pondT = [], seaT = [];
    for (let y = -M; y < N + M; y++) for (let x = -M; x < N + M; x++) {
      const k = code(x, y);
      if (k === 1) { diamond(core, x, y); coreT.push([x, y]); }
      else if (k === 2 && wkind(x, y) === 2) { diamond(sea, x, y); seaT.push([x, y]); }
      else if (k === 2) { diamond(pond, x, y); pondT.push([x, y]); }
      else { diamond(border, x, y); borderT.push([x, y]); }
    }
    // distance (in tiles) from the core, for the border near the park edge
    const near = (x, y, r) => {
      for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) if (code(x + i, y + j) === 1) return true;
      return false;
    };
    // boundary edges of the core and of the water
    const coreEdges = [], waterEdges = [];
    const W = (gx, gy) => [wx(gx, gy), wy(gx, gy)];
    for (const [x, y] of coreT) {
      if (code(x + 1, y) !== 1) coreEdges.push({ a: W(x + 1, y), b: W(x + 1, y + 1), front: true, water: code(x + 1, y) === 2, dir: 'R' });
      if (code(x, y + 1) !== 1) coreEdges.push({ a: W(x, y + 1), b: W(x + 1, y + 1), front: true, water: code(x, y + 1) === 2, dir: 'L' });
      if (code(x - 1, y) !== 1) coreEdges.push({ a: W(x, y), b: W(x, y + 1), front: false, water: code(x - 1, y) === 2, dir: 'BL' });
      if (code(x, y - 1) !== 1) coreEdges.push({ a: W(x, y), b: W(x + 1, y), front: false, water: code(x, y - 1) === 2, dir: 'BR' });
    }
    for (const list of [pondT, seaT]) for (const [x, y] of list) {
      const kind = wkind(x, y);
      const other = (i, j) => wkind(i, j) !== kind;
      if (other(x + 1, y)) waterEdges.push({ a: W(x + 1, y), b: W(x + 1, y + 1), kind, n: [1, 0], land: code(x + 1, y) });
      if (other(x, y + 1)) waterEdges.push({ a: W(x, y + 1), b: W(x + 1, y + 1), kind, n: [0, 1], land: code(x, y + 1) });
      if (other(x - 1, y)) waterEdges.push({ a: W(x, y), b: W(x, y + 1), kind, n: [-1, 0], land: code(x - 1, y) });
      if (other(x, y - 1)) waterEdges.push({ a: W(x, y), b: W(x + 1, y), kind, n: [0, -1], land: code(x, y - 1) });
    }
    const pt = (list) => {
      const t = list[(R() * list.length) | 0];
      const gx = t[0] + R(), gy = t[1] + R();
      return [wx(gx, gy), wy(gx, gy), gx, gy, t];
    };
    const S = { g, T, R, P, park, code, wkind, near, core, border, pond, sea, coreT, borderT, pondT, seaT, coreEdges, waterEdges, pt, minX, minY, maxX, maxY };
    g.fillStyle = P.bg;
    g.fillRect(minX, minY, cw, ch);
    PAINTERS[park](S);
    edgeFade(S);
    return { canvas: c, minX, minY, w: cw, h: ch, pond: S.pondPath || pond, sea, core };
  }

  /** Soft, large-scale colour variation: a low-res noise image (darker / lighter) stretched over the area. */
  function noiseOverlay(S, clip, scale, dark, light, alpha, seed, bias) {
    const { g, minX, minY, maxX, maxY } = S, STEP = 12;
    const w = Math.ceil((maxX - minX) / STEP) + 1, h = Math.ceil((maxY - minY) / STEP) + 1;
    const nc = document.createElement('canvas');
    nc.width = w; nc.height = h;
    const nx = nc.getContext('2d'), img = nx.createImageData(w, h), d = img.data;
    const A = hexRgb(dark), Bc = hexRgb(light);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const X = minX + i * STEP, Y = minY + j * STEP;
      const gx = (X / HW + Y / HH) / 2, gy = (Y / HH - X / HW) / 2;
      const n = fbm(gx * scale, gy * scale, seed, 4) - 0.5 + (bias || 0);
      const C = n < 0 ? A : Bc, a = clamp(Math.abs(n) * 2.6, 0, 1) * alpha;
      const o = (j * w + i) * 4;
      d[o] = C[0]; d[o + 1] = C[1]; d[o + 2] = C[2]; d[o + 3] = a * 255;
    }
    nx.putImageData(img, 0, 0);
    g.save();
    if (clip) g.clip(clip);
    g.imageSmoothingEnabled = true;
    g.drawImage(nc, minX, minY, w * STEP, h * STEP);
    g.restore();
  }

  /** Soft blobs (radial gradients) scattered in a tile list. */
  function blobs(S, list, n, color, alpha, rMin, rMax, comp) {
    const { g, R } = S;
    g.save();
    if (comp) g.globalCompositeOperation = comp;
    for (let i = 0; i < n; i++) {
      const p = S.pt(list), r = rMin + R() * (rMax - rMin);
      const grd = g.createRadialGradient(p[0], p[1], 0, p[0], p[1], r);
      grd.addColorStop(0, rgba(color, alpha)); grd.addColorStop(1, rgba(color, 0));
      g.fillStyle = grd;
      g.save(); g.translate(p[0], p[1]); g.scale(1, 0.5); g.translate(-p[0], -p[1]);
      g.fillRect(p[0] - r, p[1] - r, r * 2, r * 2);
      g.restore();
    }
    g.restore();
  }

  /** Batched short strokes (grass blades, leaves…) in a tile list. */
  function blades(S, list, n, colors, len, width, spread) {
    const { g, R } = S, paths = colors.map(() => new Path2D());
    for (let i = 0; i < n; i++) {
      const p = S.pt(list), k = (R() * colors.length) | 0, P2 = paths[k];
      const l = len * (0.55 + R() * 0.9), lean = (R() - 0.5) * l * (spread || 0.9);
      P2.moveTo(p[0], p[1]);
      P2.quadraticCurveTo(p[0] + lean * 0.2, p[1] - l * 0.6, p[0] + lean, p[1] - l);
    }
    g.lineCap = 'round';
    g.lineWidth = width || 1.3;
    paths.forEach((P2, i) => { g.strokeStyle = colors[i]; g.stroke(P2); });
  }

  /** Tufts: little fans of blades. */
  function tufts(S, list, n, dark, light, size) {
    const { g, R } = S, pd = new Path2D(), pl = new Path2D();
    for (let i = 0; i < n; i++) {
      const p = S.pt(list), s = size * (0.7 + R() * 0.6);
      for (let k = -3; k <= 3; k++) {
        const a = k * 0.22 + (R() - 0.5) * 0.2, l = s * (1 - Math.abs(k) * 0.12);
        const P2 = Math.abs(k) < 2 ? pl : pd;
        P2.moveTo(p[0] + k * 0.8, p[1]);
        P2.quadraticCurveTo(p[0] + k * 0.8 + Math.sin(a) * l * 0.5, p[1] - l * 0.6, p[0] + Math.sin(a) * l * 1.1, p[1] - Math.cos(a) * l);
      }
    }
    g.lineWidth = 1.4; g.lineCap = 'round';
    g.strokeStyle = dark; g.stroke(pd);
    g.strokeStyle = light; g.stroke(pl);
  }

  /** Little stones / pebbles. */
  function pebbles(S, list, n, base, size) {
    const { g, R } = S;
    for (let i = 0; i < n; i++) {
      const p = S.pt(list), r = size * (0.5 + R() * 0.8), c = shade(base, (R() - 0.5) * 0.25);
      g.beginPath(); g.ellipse(p[0] + 1, p[1] + 1, r * 1.2, r * 0.6, 0, 0, TAU); g.fillStyle = 'rgba(0,0,0,.22)'; g.fill();
      g.beginPath(); g.ellipse(p[0], p[1] - r * 0.25, r, r * 0.62, (R() - 0.5) * 0.6, 0, TAU);
      g.fillStyle = c; g.fill();
      g.beginPath(); g.ellipse(p[0] - r * 0.3, p[1] - r * 0.5, r * 0.45, r * 0.22, -0.3, 0, TAU);
      g.fillStyle = 'rgba(255,255,255,.35)'; g.fill();
    }
  }

  /** Clusters of tiny flowers (or coloured dots). */
  function flowerDots(S, list, n, colors, r) {
    const { g, R } = S;
    for (let i = 0; i < n; i++) {
      const p = S.pt(list), col = colors[(R() * colors.length) | 0], m = 3 + ((R() * 5) | 0);
      for (let k = 0; k < m; k++) {
        const x = p[0] + (R() - 0.5) * 14, y = p[1] + (R() - 0.5) * 7, rr = r * (0.7 + R() * 0.6);
        g.beginPath(); g.moveTo(x, y + rr); g.lineTo(x, y + rr + 2.5); g.strokeStyle = 'rgba(40,90,30,.6)'; g.lineWidth = 0.8; g.stroke();
        g.beginPath(); g.arc(x, y, rr, 0, TAU); g.fillStyle = col; g.fill();
        g.beginPath(); g.arc(x, y, rr * 0.38, 0, TAU); g.fillStyle = col === '#ffffff' || col === '#fff7c8' ? '#f2c230' : 'rgba(255,240,160,.9)'; g.fill();
      }
    }
  }

  /** Edges as strokes (optionally offset), clipped by the caller. */
  function strokeEdges(g, edges, filter, color, width, dy) {
    g.beginPath();
    for (const e of edges) {
      if (filter && !filter(e)) continue;
      g.moveTo(e.a[0], e.a[1] + (dy || 0)); g.lineTo(e.b[0], e.b[1] + (dy || 0));
    }
    g.strokeStyle = color; g.lineWidth = width; g.lineCap = 'round'; g.stroke();
  }

  /** Raised core: earthy / rocky / icy faces under the front edges + soft shadow at their foot. */
  function cliffFaces(S, o) {
    const { g, R } = S;
    for (const e of S.coreEdges) {
      if (!e.front) continue;
      const d = e.water ? o.depth + 5 : o.depth;
      const dx = e.b[0] - e.a[0], dy = e.b[1] - e.a[1];
      g.save();
      g.transform(dx, dy, 0, 1, e.a[0], e.a[1]);     // local (s 0..1 along the edge, z px down)
      // foot shadow
      let grd = g.createLinearGradient(0, d, 0, d + 12);
      grd.addColorStop(0, `rgba(0,0,0,${e.water ? 0.18 : 0.26})`); grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd; g.fillRect(-0.02, d, 1.04, 12);
      grd = g.createLinearGradient(0, 0, 0, d);
      const cols = e.water ? o.wet : o.face;
      grd.addColorStop(0, cols[0]); grd.addColorStop(1, cols[1]);
      g.fillStyle = grd; g.fillRect(0, 0, 1, d);
      if (e.dir === 'L') { g.fillStyle = 'rgba(0,0,0,.12)'; g.fillRect(0, 0, 1, d); }   // left faces get less light
      if (o.detail) o.detail(g, d, R, e);
      g.restore();
    }
  }

  /** Fade the outer margin into the background colour. */
  function edgeFade(S) {
    const { g } = S, N = MAP, M = MARGIN, f0 = 1.2, f1 = M - 0.3;
    g.save();
    g.transform(HW, HH, -HW, HH, 0, 0);
    g.globalCompositeOperation = 'destination-out';
    const band = (x0, y0, x1, y1, gx0, gy0, gx1, gy1) => {
      const grd = g.createLinearGradient(gx0, gy0, gx1, gy1);
      grd.addColorStop(0, 'rgba(0,0,0,0)'); grd.addColorStop(1, 'rgba(0,0,0,1)');
      g.fillStyle = grd; g.fillRect(x0, y0, x1 - x0, y1 - y0);
    };
    const A = -M - 40, Z = N + M + 40;          // far beyond the canvas corners
    band(A, A, -f0, Z, -f0, 0, -f1, 0);
    band(N + f0, A, Z, Z, N + f0, 0, N + f1, 0);
    band(A, A, Z, -f0, 0, -f0, 0, -f1);
    band(A, N + f0, Z, Z, 0, N + f0, 0, N + f1);
    g.restore();
  }

  /** The visitors' approach road from the gate out of the map (painted). */
  function entranceRoad(S, st) {
    const { g, T, R } = S, e = T.entrance;
    const u0 = e.x0 + 0.3, u1 = e.x1 - 0.3, v0 = e.y0 - 0.02, v1 = MAP + MARGIN + 1;
    g.save();
    g.transform(HW, HH, -HW, HH, 0, 0);
    g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(u0 - 0.16, v0, u1 - u0 + 0.36, v1 - v0);
    g.fillStyle = st.kerb; g.fillRect(u0 - 0.12, v0, u1 - u0 + 0.24, v1 - v0);
    g.fillStyle = st.base; g.fillRect(u0, v0, u1 - u0, v1 - v0);
    g.beginPath(); g.rect(u0, v0, u1 - u0, v1 - v0); g.clip();
    st.tex(g, u0, v0, u1, v1, R);
    g.restore();
  }

  const PAINTERS = {};

  // ---------------------------------------------------------------- land: lush grass plateau, jungle border, pond
  PAINTERS.land = function (S) {
    const { g, R } = S;
    // border ground: dark undergrowth
    g.fillStyle = S.P.border; g.fill(S.border);
    noiseOverlay(S, S.border, 0.22, '#2a5719', '#6aa53c', 0.7, 11);
    g.save(); g.clip(S.border);
    blobs(S, S.borderT, 160, '#22481a', 0.45, 20, 60);
    const leaves = [new Path2D(), new Path2D(), new Path2D(), new Path2D()];
    for (let i = 0; i < 9000; i++) {
      const p = S.pt(S.borderT), r = 2.2 + R() * 3.4, a = R() * PI;
      ellP(leaves[(R() * 4) | 0], p[0], p[1], r, r * 0.45, a);
    }
    ['#2f611f', '#3d7529', '#4f8c33', '#5f9c3a'].forEach((c, i) => { g.fillStyle = c; g.fill(leaves[i]); });
    blades(S, S.borderT, 5000, ['#2b5a1c', '#64a23e', '#3f7a29'], 8, 1.3);
    // soil and fallen leaves where the jungle meets the park
    const nearT = S.borderT.filter(([x, y]) => S.near(x, y, 1));
    if (nearT.length) {
      blobs(S, nearT, 70, '#6e5430', 0.4, 14, 34);
      pebbles(S, nearT, 40, '#9a9183', 2.6);
      flowerDots(S, nearT, 30, ['#ffffff', '#ffd23a', '#ff8fb0', '#c79bff'], 1.6);
    }
    g.restore();

    // pond & river (smooth outline): muddy bank, foam rim, shallows, deep water, lily pads and reeds
    if (S.pondT.length) {
      g.fillStyle = '#4f3f24'; g.fill(smoothWater(S, 0.76));
      g.fillStyle = '#6f5a36'; g.fill(smoothWater(S, 0.68));
      g.fillStyle = 'rgba(236,250,255,.9)'; g.fill(smoothWater(S, 0.62));
      const water = smoothWater(S, 0.585);
      [[0.585, '#6cc0d6'], [0.53, '#4fa6c8'], [0.47, '#3a8dbb']].forEach(([r, c]) => { g.fillStyle = c; g.fill(r === 0.585 ? water : smoothWater(S, r)); });
      const deep = smoothWater(S, 0.4), grd = g.createLinearGradient(0, 100, 0, 500);
      grd.addColorStop(0, '#2a7fb2'); grd.addColorStop(1, '#1b5a8a');
      g.fillStyle = grd; g.fill(deep);
      g.save(); g.clip(water);
      noiseOverlay(S, null, 0.5, '#123f66', '#6cc4e0', 0.4, 21);
      for (let i = 0; i < 70; i++) {
        const p = S.pt(S.pondT);
        g.beginPath(); g.moveTo(p[0] - 5, p[1]); g.lineTo(p[0] + 5, p[1]);
        g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 1.2; g.stroke();
      }
      for (let i = 0; i < 26; i++) {
        const p = S.pt(S.pondT), r = 5 + R() * 4, a = R() * TAU;
        if (!g.isPointInPath(deep, p[0], p[1])) continue;
        g.beginPath(); g.ellipse(p[0], p[1], r, r * 0.5, 0, a, a + TAU * 0.88); g.lineTo(p[0], p[1]); g.closePath();
        g.fillStyle = R() < 0.5 ? '#4f9a36' : '#5fae3e'; g.fill();
        g.strokeStyle = 'rgba(20,60,20,.5)'; g.lineWidth = 0.8; g.stroke();
        if (R() < 0.35) { g.beginPath(); g.arc(p[0] + 1, p[1] - 2, 2.4, 0, TAU); g.fillStyle = '#ffb3d0'; g.fill(); g.beginPath(); g.arc(p[0] + 1, p[1] - 2, 1, 0, TAU); g.fillStyle = '#ffe680'; g.fill(); }
      }
      g.restore();
      S.pondPath = water;
      // reeds on the banks
      for (const e of S.waterEdges) {
        if (e.kind !== 1 || R() < 0.55) continue;
        const k = R(), x = lerp(e.a[0], e.b[0], k), y = lerp(e.a[1], e.b[1], k);
        for (let j = 0; j < 4; j++) {
          const bx = x + (R() - 0.5) * 8, l = 10 + R() * 9, lean = (R() - 0.5) * 5;
          g.beginPath(); g.moveTo(bx, y); g.quadraticCurveTo(bx + lean * 0.3, y - l * 0.6, bx + lean, y - l);
          g.strokeStyle = j % 2 ? '#3d7a26' : '#5a9a34'; g.lineWidth = 1.3; g.stroke();
          if (j === 1) { g.beginPath(); g.ellipse(bx + lean, y - l, 1.6, 3.4, lean * 0.05, 0, TAU); g.fillStyle = '#6a4424'; g.fill(); }
        }
      }
    }

    // raised plateau faces (earth with roots and stones), then the lawn on top
    cliffFaces(S, {
      depth: 11, face: ['#8f6439', '#4f3219'], wet: ['#6d5131', '#2f2416'],
      detail(gg, d, Rr) {
        gg.fillStyle = 'rgba(40,24,10,.35)';
        for (let i = 0; i < 3; i++) gg.fillRect(Rr(), d * (0.35 + Rr() * 0.5), 0.12 + Rr() * 0.2, 1.2);
        gg.fillStyle = 'rgba(190,170,140,.65)';
        for (let i = 0; i < 2; i++) { gg.beginPath(); gg.ellipse(0.15 + Rr() * 0.7, d * (0.4 + Rr() * 0.4), 0.03, 1.6, 0, 0, TAU); gg.fill(); }
        gg.fillStyle = '#5f9c34';
        for (let i = 0; i < 6; i++) { const s = Rr(); gg.beginPath(); gg.moveTo(s - 0.04, 0); gg.lineTo(s, 2 + Rr() * 3.5); gg.lineTo(s + 0.04, 0); gg.fill(); }
      },
    });

    g.fillStyle = S.P.core; g.fill(S.core);
    g.save(); g.clip(S.core);
    noiseOverlay(S, null, 0.16, '#4f8c2b', '#a5d35e', 0.62, 31);
    // gentle tile checker so the grid reads without lines
    g.beginPath();
    for (const [x, y] of S.coreT) if ((x + y) & 1) diamond(g, x, y);
    g.fillStyle = 'rgba(255,255,230,.045)'; g.fill();
    blobs(S, S.coreT, 60, '#4c8a2a', 0.22, 24, 60);
    blobs(S, S.coreT, 40, '#d8f080', 0.12, 20, 50, 'lighter');
    blades(S, S.coreT, 15000, ['#5c9a33', '#8ac652', '#4c8a2b', '#a2d364', '#6dab3c'], 6.5, 1.25);
    tufts(S, S.coreT, 240, '#4a8428', '#77b543', 7);
    // clover patches
    for (let i = 0; i < 70; i++) {
      const p = S.pt(S.coreT);
      for (let k = 0; k < 6; k++) {
        const x = p[0] + (R() - 0.5) * 12, y = p[1] + (R() - 0.5) * 6;
        for (let l = 0; l < 3; l++) { g.beginPath(); g.arc(x + Math.cos(l * 2.1) * 1.3, y + Math.sin(l * 2.1) * 0.8, 1.3, 0, TAU); g.fillStyle = '#5c9c34'; g.fill(); }
      }
    }
    flowerDots(S, S.coreT, 120, ['#ffffff', '#fff7c8', '#ffd23a', '#ff9ec0', '#c9a0ff', '#ff8a4a'], 1.5);
    pebbles(S, S.coreT, 45, '#a49b8c', 2.4);
    g.restore();
    // edge outline: dark line at the back, sunny lip at the front
    strokeEdges(g, S.coreEdges, e => !e.front, 'rgba(30,70,20,.45)', 2);
    strokeEdges(g, S.coreEdges, e => e.front, 'rgba(210,240,140,.55)', 1.6, -1);

    entranceRoad(S, {
      kerb: '#7e776a', base: '#bdb39c',
      tex(gg, u0, v0, u1, v1, Rr) {
        gg.lineWidth = 0.025;
        for (let v = v0; v < v1; v += 0.23) {
          const off = ((v / 0.23) | 0) % 2 ? 0.12 : 0;
          for (let u = u0 - off; u < u1; u += 0.24) {
            const a = Math.max(u, u0) + 0.015, b = Math.min(u + 0.24, u1) - 0.015;
            if (b <= a) continue;
            gg.fillStyle = shade('#c4b99f', (Rr() - 0.5) * 0.18);
            gg.fillRect(a, v + 0.015, b - a, 0.2);
          }
        }
      },
    });
  };

  // ---------------------------------------------------------------- sea: deep blue seabed in big lots, coral reef border
  PAINTERS.sea = function (S) {
    const { g, R } = S;
    g.fillStyle = S.P.border; g.fill(S.border);
    noiseOverlay(S, S.border, 0.2, '#082b47', '#2a74a4', 0.75, 12);
    g.save(); g.clip(S.border);
    blobs(S, S.borderT, 90, '#4f8fb5', 0.35, 16, 46);           // sand patches
    blobs(S, S.borderT, 120, '#06223a', 0.5, 14, 40);           // dark rocky hollows
    // rubble: little rocks with lit tops
    pebbles(S, S.borderT, 260, '#3d5f78', 3.2);
    flowerDots(S, S.borderT, 110, ['#ff7aa8', '#ffa64d', '#c48cff', '#ff5f6d', '#ffe07a'], 1.5);
    blades(S, S.borderT, 2600, ['#2e8a6a', '#3fa07a', '#1f6d55'], 9, 1.4, 0.6);
    g.restore();

    cliffFaces(S, {
      depth: 10, face: ['#2f6488', '#0d2c46'], wet: ['#2f6488', '#0d2c46'],
      detail(gg, d, Rr) {
        gg.fillStyle = 'rgba(230,214,160,.85)'; gg.fillRect(0, 0, 1, 1.6);
        gg.fillStyle = 'rgba(0,15,30,.35)';
        for (let i = 0; i < 4; i++) gg.fillRect(Rr(), d * (0.3 + Rr() * 0.6), 0.1 + Rr() * 0.15, 1.4);
        gg.fillStyle = Rr() < 0.5 ? '#ff7aa8' : '#ffa64d';
        if (Rr() < 0.35) { gg.beginPath(); gg.ellipse(Rr(), d * 0.6, 0.025, 2, 0, 0, TAU); gg.fill(); }
      },
    });

    g.fillStyle = S.P.core; g.fill(S.core);
    g.save(); g.clip(S.core);
    noiseOverlay(S, null, 0.15, '#134d7c', '#3b8cc2', 0.6, 32);
    g.beginPath();
    for (const [x, y] of S.coreT) if ((x + y) & 1) diamond(g, x, y);
    g.fillStyle = 'rgba(160,220,255,.04)'; g.fill();
    // sand ripples (short wavy dashes along the gy axis)
    const rip = new Path2D();
    for (let i = 0; i < 2600; i++) {
      const p = S.pt(S.coreT), l = 7 + R() * 9;
      rip.moveTo(p[0] - l, p[1] - l * 0.5);
      rip.quadraticCurveTo(p[0], p[1] - l * 0.5 + 2.2, p[0] + l * 0.2, p[1] + l * 0.1);
    }
    g.strokeStyle = 'rgba(150,215,245,.16)'; g.lineWidth = 1.4; g.stroke(rip);
    blobs(S, S.coreT, 40, '#0e3f68', 0.3, 20, 50);
    blobs(S, S.coreT, 30, '#7fd8ff', 0.1, 24, 60, 'lighter');
    blades(S, S.coreT, 900, ['#2f9a7a', '#45b08a', '#237a62'], 8, 1.3, 0.5);
    pebbles(S, S.coreT, 70, '#7fa5bf', 2);
    // shells & starfish
    for (let i = 0; i < 40; i++) {
      const p = S.pt(S.coreT);
      if (R() < 0.3) {
        g.save(); g.translate(p[0], p[1]); g.scale(1, 0.55); g.rotate(R() * TAU);
        g.beginPath();
        for (let k = 0; k < 10; k++) { const r = k % 2 ? 1.6 : 4.2, a = k * PI / 5; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
        g.closePath(); g.fillStyle = R() < 0.5 ? '#ff8a4a' : '#ff6a8a'; g.fill();
        g.restore();
      } else {
        g.beginPath(); g.ellipse(p[0], p[1], 2.4, 1.6, R(), 0, TAU); g.fillStyle = '#f2e6d0'; g.fill();
        g.strokeStyle = 'rgba(140,110,80,.6)'; g.lineWidth = 0.6; g.stroke();
      }
    }
    // central cyan light
    const lg = g.createRadialGradient(0, 560, 40, 0, 560, 760);
    lg.addColorStop(0, 'rgba(110,230,255,.16)'); lg.addColorStop(1, 'rgba(110,230,255,0)');
    g.fillStyle = lg; g.fillRect(-900, 100, 1800, 1000);
    g.restore();

    // slightly raised sand paths dividing the seabed into big lots
    const lines = [9, 15], paths = new Path2D(), N = MAP;
    const isCore = (x, y) => S.code(x, y) === 1;
    for (const L of lines) for (const axis of [0, 1]) {
      let run = null;
      for (let k = 0; k <= N; k++) {
        const ok = k < N && (axis === 0 ? isCore(L - 1, k) && isCore(L, k) : isCore(k, L - 1) && isCore(k, L));
        if (ok && run == null) run = k;
        if (!ok && run != null) {
          if (axis === 0) quadIso(paths, L - 0.27, run + 0.05, L + 0.27, k - 0.05);
          else quadIso(paths, run + 0.05, L - 0.27, k - 0.05, L + 0.27);
          run = null;
        }
      }
    }
    g.save(); g.translate(1.5, 3); g.fillStyle = 'rgba(0,20,40,.35)'; g.fill(paths); g.restore();
    g.save(); g.translate(0, 2.2); g.fillStyle = '#a8946a'; g.fill(paths); g.restore();
    g.fillStyle = '#dccb98'; g.fill(paths);
    g.save(); g.clip(paths);
    noiseOverlay(S, null, 0.5, '#b8a274', '#f4e8c0', 0.6, 44);
    for (let i = 0; i < 900; i++) {
      const p = S.pt(S.coreT);
      if (!g.isPointInPath(paths, p[0], p[1])) continue;
      g.beginPath(); g.arc(p[0], p[1], 0.7 + R() * 1.2, 0, TAU);
      g.fillStyle = R() < 0.25 ? 'rgba(255,255,255,.7)' : 'rgba(150,125,85,.5)'; g.fill();
    }
    g.restore();

    entranceRoad(S, {
      kerb: '#a8946a', base: '#dccb98',
      tex(gg, u0, v0, u1, v1, Rr) {
        for (let i = 0; i < 220; i++) {
          gg.beginPath(); gg.arc(u0 + Rr() * (u1 - u0), v0 + Rr() * (v1 - v0), 0.012 + Rr() * 0.02, 0, TAU);
          gg.fillStyle = Rr() < 0.3 ? 'rgba(255,255,255,.75)' : 'rgba(150,125,85,.5)'; gg.fill();
        }
      },
    });
  };

  // ---------------------------------------------------------------- ice: snow plateau, frozen lake, open sea shore
  PAINTERS.ice = function (S) {
    const { g, R } = S;
    g.fillStyle = S.P.border; g.fill(S.border);
    noiseOverlay(S, S.border, 0.22, '#a9c2d6', '#ffffff', 0.75, 13);
    g.save(); g.clip(S.border);
    blobs(S, S.borderT, 120, '#9db8cf', 0.35, 16, 44);
    // drifts: bright tops with blue shadows below
    for (let i = 0; i < 160; i++) {
      const p = S.pt(S.borderT), r = 10 + R() * 18;
      g.beginPath(); g.ellipse(p[0] + 3, p[1] + 3, r, r * 0.42, 0, 0, TAU); g.fillStyle = 'rgba(120,160,195,.28)'; g.fill();
      g.beginPath(); g.ellipse(p[0], p[1], r, r * 0.38, 0, 0, TAU); g.fillStyle = 'rgba(255,255,255,.75)'; g.fill();
    }
    pebbles(S, S.borderT, 120, '#6d7780', 3.6);
    blades(S, S.borderT, 900, ['#9a8466', '#7a6a52', '#b8a27e'], 7, 1.1, 0.8);
    g.restore();

    // open sea (back-right shore): dark cold water, waves, floes and an ice shelf edge
    if (S.seaT.length) {
      const grd = g.createLinearGradient(0, -100, 0, 300);
      grd.addColorStop(0, '#173f5a'); grd.addColorStop(1, '#2a6a8a');
      g.fillStyle = grd; g.fill(S.sea);
      g.save(); g.clip(S.sea);
      noiseOverlay(S, null, 0.45, '#0f3048', '#3f87a8', 0.6, 23);
      const wv = new Path2D();
      for (let i = 0; i < 500; i++) {
        const p = S.pt(S.seaT), l = 6 + R() * 10;
        wv.moveTo(p[0] - l, p[1]); wv.quadraticCurveTo(p[0], p[1] - 2.5, p[0] + l, p[1]);
      }
      g.strokeStyle = 'rgba(200,235,250,.28)'; g.lineWidth = 1.2; g.stroke(wv);
      for (let i = 0; i < 38; i++) {
        const p = S.pt(S.seaT), r = 4 + R() * 9, n = 6 + ((R() * 3) | 0), pts = [];
        for (let k = 0; k < n; k++) { const a = k / n * TAU, rr = r * (0.7 + R() * 0.5); pts.push([p[0] + Math.cos(a) * rr, p[1] + Math.sin(a) * rr * 0.5]); }
        g.beginPath(); pts.forEach((q, k) => (k ? g.lineTo(q[0], q[1] + 2.5) : g.moveTo(q[0], q[1] + 2.5))); g.closePath(); g.fillStyle = '#7fb0cc'; g.fill();
        g.beginPath(); pts.forEach((q, k) => (k ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]))); g.closePath(); g.fillStyle = '#f4f9fc'; g.fill();
      }
      strokeEdges(g, S.waterEdges, e => e.kind === 2 && e.land !== 2, 'rgba(230,248,255,.65)', 9);
      g.restore();
      strokeEdges(g, S.waterEdges, e => e.kind === 2 && e.land !== 2, '#9fc0d6', 5, 2);
      strokeEdges(g, S.waterEdges, e => e.kind === 2 && e.land !== 2, '#f6fbfe', 3);
    }

    // frozen lake (smooth outline): snowy bank, white lip, glassy ice with cracks
    if (S.pondT.length) {
      g.fillStyle = '#b4cadb'; g.fill(smoothWater(S, 0.74));
      g.fillStyle = '#ffffff'; g.fill(smoothWater(S, 0.66));
      const ice = smoothWater(S, 0.6), grd = g.createLinearGradient(0, 200, 0, 520);
      grd.addColorStop(0, '#bfe7f4'); grd.addColorStop(1, '#8fcbe2');
      g.fillStyle = '#a9dcee'; g.fill(ice);
      g.fillStyle = grd; g.fill(smoothWater(S, 0.54));
      g.save(); g.clip(ice);
      noiseOverlay(S, null, 0.6, '#6fb0d0', '#e8f8ff', 0.55, 24);
      const cr = new Path2D();
      for (let i = 0; i < 26; i++) {
        let p = S.pt(S.pondT), x = p[0], y = p[1];
        cr.moveTo(x, y);
        for (let k = 0; k < 5; k++) { x += (R() - 0.5) * 22; y += (R() - 0.5) * 10; cr.lineTo(x, y); }
      }
      g.strokeStyle = 'rgba(255,255,255,.8)'; g.lineWidth = 1.1; g.stroke(cr);
      g.save(); g.translate(0.8, 0.8); g.strokeStyle = 'rgba(60,120,160,.35)'; g.lineWidth = 0.8; g.stroke(cr); g.restore();
      blobs(S, S.pondT, 20, '#ffffff', 0.55, 8, 22);
      for (let i = 0; i < 22; i++) {
        const p = S.pt(S.pondT);
        g.beginPath(); g.moveTo(p[0] - 9, p[1] + 3); g.lineTo(p[0] + 9, p[1] - 3);
        g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 1.6; g.stroke();
      }
      g.restore();
      S.pondPath = ice;
    }

    cliffFaces(S, {
      depth: 11, face: ['#d9eaf5', '#7fa2bf'], wet: ['#cfe4f2', '#6f93b0'],
      detail(gg, d, Rr) {
        gg.fillStyle = 'rgba(255,255,255,.9)';
        gg.fillRect(0, 0, 1, 1.8);
        for (let i = 0; i < 4; i++) { const s = 0.08 + Rr() * 0.84, l = 3 + Rr() * 6; gg.beginPath(); gg.moveTo(s - 0.025, 1); gg.lineTo(s, 1 + l); gg.lineTo(s + 0.025, 1); gg.fill(); }
        gg.fillStyle = 'rgba(90,130,165,.25)';
        for (let i = 0; i < 3; i++) gg.fillRect(Rr(), d * 0.45, 0.02, d * 0.5);
      },
    });

    g.fillStyle = S.P.core; g.fill(S.core);
    g.save(); g.clip(S.core);
    noiseOverlay(S, null, 0.17, '#a9c2d8', '#ffffff', 0.8, 33);
    g.beginPath();
    for (const [x, y] of S.coreT) if ((x + y) & 1) diamond(g, x, y);
    g.fillStyle = 'rgba(120,160,200,.045)'; g.fill();
    // soft snow mounds with blue shadows
    for (let i = 0; i < 130; i++) {
      const p = S.pt(S.coreT), r = 8 + R() * 18;
      g.beginPath(); g.ellipse(p[0] + 4, p[1] + 2.5, r, r * 0.4, 0, 0, TAU); g.fillStyle = 'rgba(125,165,205,.3)'; g.fill();
      g.beginPath(); g.ellipse(p[0], p[1], r, r * 0.38, 0, 0, TAU); g.fillStyle = 'rgba(255,255,255,.7)'; g.fill();
    }
    // sled tracks and footprints
    for (let i = 0; i < 7; i++) {
      const p = S.pt(S.coreT), a = (R() - 0.5) * 1.2, l = 60 + R() * 90;
      for (const off of [-3, 3]) {
        g.beginPath(); g.moveTo(p[0], p[1] + off);
        g.quadraticCurveTo(p[0] + Math.cos(a) * l * 0.5, p[1] + off + Math.sin(a) * l * 0.25 + 10, p[0] + Math.cos(a) * l, p[1] + off + Math.sin(a) * l * 0.5);
        g.strokeStyle = 'rgba(140,170,200,.3)'; g.lineWidth = 1.4; g.stroke();
      }
    }
    for (let i = 0; i < 10; i++) {
      let p = S.pt(S.coreT), x = p[0], y = p[1];
      const a = R() * TAU, dx = Math.cos(a) * 6, dy = Math.sin(a) * 3;
      for (let k = 0; k < 9; k++) {
        g.beginPath(); g.ellipse(x + (k % 2 ? 2 : -2), y, 1.6, 1, 0, 0, TAU); g.fillStyle = 'rgba(110,145,180,.35)'; g.fill();
        x += dx; y += dy;
      }
    }
    blobs(S, S.coreT, 70, '#9db9d6', 0.32, 20, 60);
    for (let i = 0; i < 500; i++) {
      const p = S.pt(S.coreT);
      g.fillStyle = R() < 0.5 ? 'rgba(255,255,255,.95)' : 'rgba(150,215,255,.8)';
      g.fillRect(p[0], p[1], 1.2, 1.2);
    }
    pebbles(S, S.coreT, 20, '#7b858e', 2.2);
    g.restore();
    strokeEdges(g, S.coreEdges, e => !e.front && !e.water, 'rgba(110,145,180,.45)', 2);
    strokeEdges(g, S.coreEdges, e => e.front, 'rgba(255,255,255,.9)', 2, -0.5);

    entranceRoad(S, {
      kerb: '#b8cad8', base: '#e4edf4',
      tex(gg, u0, v0, u1, v1, Rr) {
        gg.strokeStyle = 'rgba(120,150,180,.45)'; gg.lineWidth = 0.03;
        for (const u of [u0 + (u1 - u0) * 0.3, u0 + (u1 - u0) * 0.7]) { gg.beginPath(); gg.moveTo(u, v0); gg.lineTo(u, v1); gg.stroke(); }
        gg.fillStyle = 'rgba(120,150,180,.35)';
        for (let v = v0 + 0.1; v < v1; v += 0.18) for (const u of [u0 + (u1 - u0) * 0.3, u0 + (u1 - u0) * 0.7]) gg.fillRect(u - 0.06, v, 0.12, 0.04);
      },
    });
  };

  // ---------------------------------------------------------------- shared animated textures
  let causticTex = null, rippleTex = null;
  /** Tileable caustic network (bright cell borders of a wrapped Voronoi diagram). */
  function caustics() {
    if (causticTex) return causticTex;
    const S = 160, c = document.createElement('canvas');
    c.width = c.height = S;
    const x = c.getContext('2d'), img = x.createImageData(S, S), d = img.data, R = rng(77), pts = [];
    for (let i = 0; i < 16; i++) pts.push([R() * S, R() * S]);
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
      let f1 = 1e9, f2 = 1e9;
      for (const p of pts) for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        const dx = p[0] + ox * S - i, dy = p[1] + oy * S - j, dd = dx * dx + dy * dy;
        if (dd < f1) { f2 = f1; f1 = dd; } else if (dd < f2) f2 = dd;
      }
      const e = Math.sqrt(f2) - Math.sqrt(f1), v = Math.pow(clamp(1 - e / 7, 0, 1), 2.2);
      const o = (j * S + i) * 4;
      d[o] = 200; d[o + 1] = 250; d[o + 2] = 255; d[o + 3] = v * 255;
    }
    x.putImageData(img, 0, 0);
    causticTex = c;
    return c;
  }
  /** Tileable ripple glints for open water. */
  function ripples() {
    if (rippleTex) return rippleTex;
    const c = document.createElement('canvas');
    c.width = 128; c.height = 64;
    const x = c.getContext('2d'), R = rng(91);
    x.lineCap = 'round';
    for (let i = 0; i < 26; i++) {
      const px = R() * 128, py = R() * 64, l = 5 + R() * 10;
      for (const ox of [-128, 0, 128]) for (const oy of [-64, 0, 64]) {
        x.beginPath(); x.moveTo(px + ox - l, py + oy); x.quadraticCurveTo(px + ox, py + oy - 2, px + ox + l, py + oy);
        x.strokeStyle = `rgba(255,255,255,${0.35 + R() * 0.4})`; x.lineWidth = 1.3; x.stroke();
      }
    }
    rippleTex = c;
    return c;
  }

  // ================================================================ live view: shared helpers
  const paints = {};
  /** Painted ground of a park (cached offscreen canvas at 1× world resolution). */
  function terrainPaint(park) {
    if (!PAL[park]) park = 'land';
    if (!paints[park]) paints[park] = paintTerrain(TERRAIN.generate(park));
    return paints[park];
  }
  /** Paint (and cache) a park's ground ahead of time, e.g. behind a loading screen. */
  ISO.prewarm = function (park) {
    try { terrainPaint(park); } catch (e) { console.warn('[ISO] prewarm', park, e); }
  };

  /** Footprint diamond of a w×h area at (gx, gy) in world coords (the `fp` of SPEC §7). */
  function footprint(gx, gy, w, h) {
    const top = [wx(gx, gy), wy(gx, gy)], right = [wx(gx + w, gy), wy(gx + w, gy)];
    const bottom = [wx(gx + w, gy + h), wy(gx + w, gy + h)], left = [wx(gx, gy + h), wy(gx, gy + h)];
    return { top, right, bottom, left, cx: (top[0] + bottom[0]) / 2, cy: (top[1] + bottom[1]) / 2, w, h, tw: TW, th: TH };
  }
  ISO.footprint = footprint;

  const bdef = id => (PC.DATA && PC.DATA.BUILDINGS && PC.DATA.BUILDINGS[id]) || null;
  const isRoadId = id => /^road(_|$)/.test(id || '');
  const isRoad = o => !!o && o.type === 'building' && isRoadId(o.buildingId);
  function artOf(id) { if (isRoadId(id)) return 'road'; const d = bdef(id); return (d && d.art) || id; }
  const resIcon = r => (r === 'coins' ? 'coin' : r === 'dollars' ? 'dollar' : r || 'coin');
  const engine = () => PC.ENGINE || null;
  function nowMs() {
    const E = engine();
    try { if (E && typeof E.now === 'function') return E.now(); } catch (e) { /* ignore */ }
    return Date.now();
  }
  const pad2 = n => (n < 10 ? '0' : '') + n;
  /** Seconds → "m:ss" (or "h:mm:ss"). */
  function fmtClock(sec) {
    sec = Math.max(0, Math.ceil(sec));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return h ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`;
  }
  function rrect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function starPath(ctx, x, y, r, inner) {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -PI / 2 + i * PI / 5, rr = i % 2 ? r * (inner || 0.45) : r;
      ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    ctx.closePath();
  }
  function icon(ctx, name, x, y, size) {
    const I = PC.ICONS;
    if (I && typeof I.draw === 'function' && (!I.names || I.names.indexOf(name) >= 0)) { I.draw(ctx, name, x, y, size); return; }
    ctx.beginPath(); ctx.arc(x, y, size * 0.42, 0, TAU);
    ctx.fillStyle = '#f2c230'; ctx.fill(); ctx.strokeStyle = '#8a5a00'; ctx.lineWidth = size * 0.08; ctx.stroke();
  }
  function text(ctx, s, x, y, size, fill, stroke, font) {
    ctx.font = `${size}px ${font || FONT_D}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    if (stroke !== null) { ctx.lineWidth = Math.max(2, size * 0.24); ctx.strokeStyle = stroke || 'rgba(0,0,0,.85)'; ctx.strokeText(s, x, y); }
    ctx.fillStyle = fill || '#fff'; ctx.fillText(s, x, y);
  }
  /** Quadratic bezier point. */
  const qpt = (a, m, b, f) => (1 - f) * (1 - f) * a + 2 * (1 - f) * f * m + f * f * b;

  // ---------------------------------------------------------------- enclosure grounds (cached sprites)
  // Local coords: tile (u, v) of the enclosure → ((u − v)·HW, (u + v)·HH), top corner at (0, 0).
  const groundCache = new Map();
  const ENC_DROP = 9;          // sea lagoons: water surface below the stone rim (px)
  function enclosureGround(park, w, h, variant) {
    const key = park + ':' + w + 'x' + h + ':' + variant;
    let s = groundCache.get(key);
    if (s) return s;
    const pad = 6, x0 = -h * HW - pad, y0 = -pad;
    const c = document.createElement('canvas');
    c.width = Math.ceil((w + h) * HW + pad * 2); c.height = Math.ceil((w + h) * HH + pad * 2 + ENC_DROP);
    const g = c.getContext('2d');
    g.translate(-x0, -y0);
    g.lineCap = 'round'; g.lineJoin = 'round';
    (ENC_GROUND[park] || ENC_GROUND.land)(g, w, h, rng(variant * 977 + w * 31 + h * 7 + park.length * 1009));
    s = { c, x0, y0 };
    groundCache.set(key, s);
    return s;
  }
  function randIn(R, w, h, f) {
    const u = f + R() * (w - 2 * f), v = f + R() * (h - 2 * f);
    return [u, v, wx(u, v), wy(u, v)];
  }
  /** Soft shadow cast by the back fence onto the enclosure floor. */
  function backShade(g, w, h, f, col) {
    g.beginPath();
    g.moveTo(wx(f, h - f), wy(f, h - f)); g.lineTo(wx(f, f), wy(f, f)); g.lineTo(wx(w - f, f), wy(w - f, f));
    g.strokeStyle = col; g.lineWidth = 12; g.stroke();
    g.lineWidth = 5; g.stroke();
  }
  const ENC_GROUND = {
    land(g, w, h, R) {
      const f = 0.08, q = new Path2D(), A = w * h / 9;
      quadIso(q, f, f, w - f, h - f);
      const grd = g.createLinearGradient(0, 0, 0, (w + h) * HH);
      grd.addColorStop(0, '#8f6e40'); grd.addColorStop(1, '#b18c57');
      g.fillStyle = grd; g.fill(q);
      g.save(); g.clip(q);
      for (let i = 0; i < 46 * A; i++) {
        const p = randIn(R, w, h, f), r = 8 + R() * 22;
        g.beginPath(); g.ellipse(p[2], p[3], r, r * 0.5, 0, 0, TAU);
        g.fillStyle = R() < 0.5 ? 'rgba(80,55,25,.16)' : 'rgba(225,195,135,.16)'; g.fill();
      }
      const edgeD = (u, v) => Math.min(u - f, w - f - u, v - f, h - f - v);
      // grass: lush along the fence, a few patches in the trampled middle
      const gp = new Path2D(), gp2 = new Path2D();
      for (let i = 0; i < 160 * A; i++) {
        const p = randIn(R, w, h, f), d = edgeD(p[0], p[1]);
        if (R() > (d < 0.45 ? 0.95 : d < 0.7 ? 0.35 : 0.06)) continue;
        const r = 5 + R() * 11;
        ellP(R() < 0.5 ? gp : gp2, p[2], p[3], r, r * 0.5, 0);
      }
      g.fillStyle = '#5e9734'; g.fill(gp); g.fillStyle = '#74ad40'; g.fill(gp2);
      const bl = [new Path2D(), new Path2D(), new Path2D()];
      for (let i = 0; i < 1700 * A; i++) {
        const p = randIn(R, w, h, f), d = edgeD(p[0], p[1]);
        if (R() > (d < 0.45 ? 0.9 : d < 0.7 ? 0.3 : 0.05)) continue;
        const l = 4 + R() * 6, lean = (R() - 0.5) * 4, P2 = bl[(R() * 3) | 0];
        P2.moveTo(p[2], p[3]); P2.quadraticCurveTo(p[2] + lean * 0.3, p[3] - l * 0.6, p[2] + lean, p[3] - l);
      }
      g.lineWidth = 1.2;
      ['#3f7a24', '#7dba48', '#a5d566'].forEach((c, i) => { g.strokeStyle = c; g.stroke(bl[i]); });
      // three-toed footprints in the dirt
      for (let i = 0; i < 9 * A; i++) {
        const p = randIn(R, w, h, f);
        if (edgeD(p[0], p[1]) < 0.55) continue;
        const a = R() * TAU;
        for (let k = -1; k <= 1; k++) {
          g.beginPath(); g.ellipse(p[2] + Math.cos(a + k * 0.55) * 4, p[3] + Math.sin(a + k * 0.55) * 2, 2.8, 1, a + k * 0.55, 0, TAU);
          g.fillStyle = 'rgba(70,45,20,.33)'; g.fill();
        }
      }
      // puddle
      const pu = wx(w * 0.68, h * 0.3), pv = wy(w * 0.68, h * 0.3);
      g.beginPath(); g.ellipse(pu, pv, 17, 7, 0, 0, TAU); g.fillStyle = '#6b5130'; g.fill();
      g.beginPath(); g.ellipse(pu, pv + 0.5, 14, 5.4, 0, 0, TAU);
      const wg = g.createLinearGradient(0, pv - 6, 0, pv + 6); wg.addColorStop(0, '#4f9cc4'); wg.addColorStop(1, '#2d6f98');
      g.fillStyle = wg; g.fill();
      g.beginPath(); g.ellipse(pu - 4, pv - 1.5, 5, 1.2, 0, 0, TAU); g.fillStyle = 'rgba(255,255,255,.55)'; g.fill();
      // pebbles
      for (let i = 0; i < 14 * A; i++) {
        const p = randIn(R, w, h, f), r = 1.4 + R() * 2.4;
        g.beginPath(); g.ellipse(p[2] + 1, p[3] + 1, r * 1.2, r * 0.6, 0, 0, TAU); g.fillStyle = 'rgba(0,0,0,.2)'; g.fill();
        g.beginPath(); g.ellipse(p[2], p[3] - r * 0.2, r, r * 0.62, 0, 0, TAU); g.fillStyle = shade('#a49b8c', (R() - 0.5) * 0.3); g.fill();
      }
      // fallen log near the back corner
      const lx = wx(w * 0.25, h * 0.62), ly = wy(w * 0.25, h * 0.62);
      g.save(); g.translate(lx, ly); g.rotate(0.46);
      g.fillStyle = 'rgba(0,0,0,.22)'; g.beginPath(); g.ellipse(2, 5, 24, 5, 0, 0, TAU); g.fill();
      rrect(g, -22, -5, 44, 10, 5); g.fillStyle = '#7a5530'; g.fill(); g.strokeStyle = '#3e2914'; g.lineWidth = 1; g.stroke();
      g.strokeStyle = 'rgba(40,25,10,.4)'; g.beginPath(); g.moveTo(-16, -1); g.lineTo(14, -2); g.moveTo(-12, 2.5); g.lineTo(10, 2); g.stroke();
      g.beginPath(); g.ellipse(22, 0, 3.4, 5, 0, 0, TAU); g.fillStyle = '#c99a62'; g.fill(); g.stroke();
      g.fillStyle = '#5f9c34'; g.beginPath(); g.ellipse(-6, -5, 6, 2.4, 0, 0, TAU); g.fill();
      g.restore();
      backShade(g, w, h, f, 'rgba(40,25,10,.16)');
      g.restore();
    },

    sea(g, w, h, R) {
      const f = 0.05, fi = 0.32;
      const outer = new Path2D(), inner = new Path2D();
      quadIso(outer, f, f, w - f, h - f); quadIso(inner, fi, fi, w - fi, h - fi);
      g.save(); g.translate(1, 4); g.fillStyle = 'rgba(0,15,35,.4)'; g.fill(outer); g.restore();
      let grd = g.createLinearGradient(0, 0, 0, (w + h) * HH);
      grd.addColorStop(0, '#a6b3b1'); grd.addColorStop(1, '#7d8b8b');
      g.fillStyle = grd; g.fill(outer);
      // stone blocks of the rim
      g.save(); g.clip(outer);
      for (let i = 0; i < 260 * w * h / 16; i++) {
        const p = randIn(R, w, h, f);
        g.fillStyle = R() < 0.5 ? 'rgba(40,60,70,.12)' : 'rgba(255,255,255,.1)';
        g.fillRect(p[2], p[3], 2 + R() * 3, 1 + R() * 2);
      }
      g.strokeStyle = 'rgba(45,60,66,.55)'; g.lineWidth = 1;
      g.beginPath();
      const joint = (u0, v0, u1, v1) => { g.moveTo(wx(u0, v0), wy(u0, v0)); g.lineTo(wx(u1, v1), wy(u1, v1)); };
      for (let s = f + 0.45; s < w - f - 0.2; s += 0.55 + R() * 0.2) { joint(s, f, s, fi); joint(s, h - f, s, h - fi); }
      for (let s = f + 0.45; s < h - f - 0.2; s += 0.55 + R() * 0.2) { joint(f, s, fi, s); joint(w - f, s, w - fi, s); }
      g.stroke();
      g.restore();
      // inner wall (visible on the far side) and the lower water surface
      g.fillStyle = '#2f5568'; g.fill(inner);
      g.save(); g.clip(inner);
      g.fillStyle = 'rgba(0,0,0,.25)';
      for (let s = fi + 0.3; s < w - fi; s += 0.42) g.fillRect(wx(s, fi) - 0.5, wy(s, fi), 1, ENC_DROP + 2);
      g.translate(0, ENC_DROP);
      const cx = wx(w / 2, h / 2), cy = wy(w / 2, h / 2), rr = (w + h) * HW * 0.55;
      g.save(); g.translate(cx, cy); g.scale(1, 0.5);
      grd = g.createRadialGradient(0, 0, rr * 0.1, 0, 0, rr);
      grd.addColorStop(0, '#0a2c4a'); grd.addColorStop(0.65, '#124d77'); grd.addColorStop(1, '#2a86ad');
      g.fillStyle = grd; g.fillRect(-rr, -rr, rr * 2, rr * 2);
      g.restore();
      // sunken rocks, weeds and a few shells on the lagoon floor
      for (let i = 0; i < 12 * w * h / 16; i++) {
        const p = randIn(R, w, h, fi + 0.15), r = 4 + R() * 9;
        g.beginPath(); g.ellipse(p[2], p[3], r, r * 0.5, 0, 0, TAU);
        g.fillStyle = R() < 0.6 ? 'rgba(5,25,45,.35)' : 'rgba(120,200,220,.12)'; g.fill();
      }
      const wd = new Path2D();
      for (let i = 0; i < 70 * w * h / 16; i++) {
        const p = randIn(R, w, h, fi + 0.1), l = 5 + R() * 8, lean = (R() - 0.5) * 5;
        wd.moveTo(p[2], p[3]); wd.quadraticCurveTo(p[2] + lean, p[3] - l * 0.5, p[2] + lean * 0.3, p[3] - l);
      }
      g.strokeStyle = 'rgba(40,140,110,.45)'; g.lineWidth = 1.4; g.stroke(wd);
      // light band under the far wall
      g.beginPath(); g.moveTo(wx(fi, h - fi), wy(fi, h - fi)); g.lineTo(wx(fi, fi), wy(fi, fi)); g.lineTo(wx(w - fi, fi), wy(w - fi, fi));
      g.strokeStyle = 'rgba(140,230,255,.22)'; g.lineWidth = 8; g.stroke();
      g.restore();
      // rim lips
      g.strokeStyle = '#4c5a5c'; g.lineWidth = 1.4; g.stroke(inner);
      g.beginPath(); g.moveTo(wx(f, h - f), wy(f, h - f)); g.lineTo(wx(f, f), wy(f, f)); g.lineTo(wx(w - f, f), wy(w - f, f));
      g.strokeStyle = 'rgba(255,255,255,.4)'; g.lineWidth = 1.5; g.stroke();
      g.beginPath(); g.moveTo(wx(w - f, f), wy(w - f, f)); g.lineTo(wx(w - f, h - f), wy(w - f, h - f)); g.lineTo(wx(f, h - f), wy(f, h - f));
      g.strokeStyle = 'rgba(30,45,50,.6)'; g.lineWidth = 1.5; g.stroke();
      // front face of the rim
      g.beginPath();
      g.moveTo(wx(w - f, f), wy(w - f, f)); g.lineTo(wx(w - f, h - f), wy(w - f, h - f)); g.lineTo(wx(f, h - f), wy(f, h - f));
      g.lineTo(wx(f, h - f), wy(f, h - f) + 4); g.lineTo(wx(w - f, h - f), wy(w - f, h - f) + 4); g.lineTo(wx(w - f, f), wy(w - f, f) + 4); g.closePath();
      g.fillStyle = '#5d6b6c'; g.fill();
    },

    ice(g, w, h, R) {
      const f = 0.08, q = new Path2D(), A = w * h / 9;
      quadIso(q, f, f, w - f, h - f);
      const grd = g.createLinearGradient(0, 0, 0, (w + h) * HH);
      grd.addColorStop(0, '#d3e0ea'); grd.addColorStop(1, '#e6eef4');
      g.fillStyle = grd; g.fill(q);
      g.save(); g.clip(q);
      for (let i = 0; i < 40 * A; i++) {
        const p = randIn(R, w, h, f), r = 8 + R() * 20;
        g.beginPath(); g.ellipse(p[2], p[3], r, r * 0.5, 0, 0, TAU);
        g.fillStyle = R() < 0.55 ? 'rgba(120,150,185,.13)' : 'rgba(255,255,255,.4)'; g.fill();
      }
      const edgeD = (u, v) => Math.min(u - f, w - f - u, v - f, h - f - v);
      // drifts piled against the fence
      for (let i = 0; i < 90 * A; i++) {
        const p = randIn(R, w, h, f);
        if (edgeD(p[0], p[1]) > 0.35) continue;
        const r = 6 + R() * 10;
        g.beginPath(); g.ellipse(p[2] + 2, p[3] + 2, r, r * 0.42, 0, 0, TAU); g.fillStyle = 'rgba(120,155,195,.22)'; g.fill();
        g.beginPath(); g.ellipse(p[2], p[3], r, r * 0.4, 0, 0, TAU); g.fillStyle = 'rgba(255,255,255,.85)'; g.fill();
      }
      // frozen puddle
      const pu = wx(w * 0.66, h * 0.32), pv = wy(w * 0.66, h * 0.32);
      g.beginPath(); g.ellipse(pu, pv, 18, 7.5, 0, 0, TAU);
      const ig = g.createLinearGradient(0, pv - 7, 0, pv + 7); ig.addColorStop(0, '#bfe7f6'); ig.addColorStop(1, '#86c3dd');
      g.fillStyle = ig; g.fill(); g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = 1.4; g.stroke();
      g.beginPath(); g.moveTo(pu - 9, pv + 2); g.lineTo(pu + 1, pv - 3); g.moveTo(pu - 2, pv + 3); g.lineTo(pu + 8, pv - 1);
      g.strokeStyle = 'rgba(255,255,255,.75)'; g.lineWidth = 1; g.stroke();
      // straw from the feed pile
      const sx = wx(w * 0.3, h * 0.6), sy = wy(w * 0.3, h * 0.6), st = new Path2D();
      for (let i = 0; i < 70; i++) {
        const a = R() * TAU, r = R() * 16, x = sx + Math.cos(a) * r, y = sy + Math.sin(a) * r * 0.5, b = R() * PI;
        st.moveTo(x, y); st.lineTo(x + Math.cos(b) * 5, y + Math.sin(b) * 2.2);
      }
      g.strokeStyle = '#c9a052'; g.lineWidth = 1.1; g.stroke(st);
      g.save(); g.translate(0.6, 0.6); g.strokeStyle = 'rgba(120,85,30,.5)'; g.lineWidth = 0.8; g.stroke(st); g.restore();
      // paw prints
      for (let i = 0; i < 3; i++) {
        let p = randIn(R, w, h, f + 0.4), x = p[2], y = p[3];
        const a = R() * TAU, dx = Math.cos(a) * 7, dy = Math.sin(a) * 3.5;
        for (let k = 0; k < 6; k++) {
          g.beginPath(); g.ellipse(x + (k % 2 ? 2.5 : -2.5), y, 2, 1.1, 0, 0, TAU); g.fillStyle = 'rgba(100,135,175,.35)'; g.fill();
          x += dx; y += dy;
        }
      }
      for (let i = 0; i < 160 * A; i++) {
        const p = randIn(R, w, h, f);
        g.fillStyle = R() < 0.5 ? 'rgba(255,255,255,.95)' : 'rgba(160,215,255,.7)'; g.fillRect(p[2], p[3], 1.1, 1.1);
      }
      backShade(g, w, h, f, 'rgba(90,120,160,.14)');
      g.restore();
    },
  };

  // ---------------------------------------------------------------- fences
  const CABLES = [9, 17, 25, 33];
  const FENCE = {
    land: {
      spacing: 0.72,
      panels(ctx, pts, t, phase) {
        ctx.lineCap = 'round';
        for (let i = 0; i + 1 < pts.length; i++) {
          const a = pts[i], b = pts[i + 1], mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2 + 2.6;
          ctx.beginPath();
          for (const hh of CABLES) { ctx.moveTo(a[0], a[1] - hh); ctx.quadraticCurveTo(mx, my - hh, b[0], b[1] - hh); }
          ctx.strokeStyle = '#1f2529'; ctx.lineWidth = 1.8; ctx.stroke();
          ctx.save(); ctx.translate(0, -0.7); ctx.strokeStyle = 'rgba(205,220,230,.5)'; ctx.lineWidth = 0.6; ctx.stroke(); ctx.restore();
        }
        // a blue electric spark running along the top cable
        const n = pts.length - 1, p = fract(t * 0.3 + phase);
        if (n > 0 && p < 0.55) {
          const k = (p / 0.55) * n, i = Math.min(n - 1, k | 0), f = k - i, a = pts[i], b = pts[i + 1];
          const x = qpt(a[0], (a[0] + b[0]) / 2, b[0], f), y = qpt(a[1] - 33, (a[1] + b[1]) / 2 + 2.6 - 33, b[1] - 33, f);
          ctx.save(); ctx.globalCompositeOperation = 'lighter';
          const gr = ctx.createRadialGradient(x, y, 0, x, y, 9);
          gr.addColorStop(0, 'rgba(200,245,255,.95)'); gr.addColorStop(0.35, 'rgba(90,200,255,.5)'); gr.addColorStop(1, 'rgba(60,160,255,0)');
          ctx.fillStyle = gr; ctx.fillRect(x - 9, y - 9, 18, 18);
          ctx.restore();
        }
      },
      post(ctx, x, y) {
        const w = 3.6, H = 40, cy = y - H - 7;
        ctx.fillStyle = 'rgba(0,0,0,.22)'; ctx.beginPath(); ctx.ellipse(x + 3, y + 1, 6, 2.4, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#cfccc2'; ctx.fillRect(x - w, y - H, w, H);
        ctx.fillStyle = '#9a978d'; ctx.fillRect(x, y - H, w, H);
        ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.fillRect(x - w, y - 4, w * 2, 4);
        ctx.save(); ctx.beginPath(); ctx.rect(x - w - 0.6, cy, w * 2 + 1.2, 7); ctx.clip();
        ctx.fillStyle = '#f4c419'; ctx.fillRect(x - w - 1, cy, w * 2 + 2, 7);
        ctx.strokeStyle = '#151515'; ctx.lineWidth = 2;
        ctx.beginPath(); for (let k = -12; k < 10; k += 4.4) { ctx.moveTo(x + k, cy + 8); ctx.lineTo(x + k + 7, cy - 1); } ctx.stroke();
        ctx.restore();
        ctx.beginPath(); ctx.moveTo(x - w - 0.6, cy); ctx.lineTo(x, cy - 2.2); ctx.lineTo(x + w + 0.6, cy); ctx.lineTo(x, cy + 2.2); ctx.closePath();
        ctx.fillStyle = '#ffe36a'; ctx.fill();
        ctx.strokeStyle = 'rgba(25,25,25,.75)'; ctx.lineWidth = 0.8; ctx.strokeRect(x - w, cy, w * 2, H + 7);
        ctx.fillStyle = '#e6e3d9';
        for (const hh of CABLES) ctx.fillRect(x - w - 1.2, y - hh - 1.2, 2, 2.4);
      },
    },
    sea: {
      spacing: 0.8,
      panels(ctx, pts) {
        const H = 25;
        for (let i = 0; i + 1 < pts.length; i++) {
          const a = pts[i], b = pts[i + 1];
          ctx.beginPath(); ctx.moveTo(a[0], a[1] - 1); ctx.lineTo(b[0], b[1] - 1); ctx.lineTo(b[0], b[1] - H); ctx.lineTo(a[0], a[1] - H); ctx.closePath();
          const gr = ctx.createLinearGradient(0, a[1] - H, 0, a[1]);
          gr.addColorStop(0, 'rgba(190,240,255,.28)'); gr.addColorStop(1, 'rgba(120,210,245,.12)');
          ctx.fillStyle = gr; ctx.fill();
          ctx.beginPath();
          ctx.moveTo(lerp(a[0], b[0], 0.18), lerp(a[1], b[1], 0.18) - 4); ctx.lineTo(lerp(a[0], b[0], 0.34), lerp(a[1], b[1], 0.34) - H + 4);
          ctx.moveTo(lerp(a[0], b[0], 0.3), lerp(a[1], b[1], 0.3) - 4); ctx.lineTo(lerp(a[0], b[0], 0.38), lerp(a[1], b[1], 0.38) - H * 0.55);
          ctx.strokeStyle = 'rgba(255,255,255,.45)'; ctx.lineWidth = 1.6; ctx.stroke();
          ctx.beginPath(); ctx.moveTo(a[0], a[1] - H); ctx.lineTo(b[0], b[1] - H); ctx.moveTo(a[0], a[1] - 1.5); ctx.lineTo(b[0], b[1] - 1.5);
          ctx.strokeStyle = '#132430'; ctx.lineWidth = 2.6; ctx.stroke();
          ctx.beginPath(); ctx.moveTo(a[0], a[1] - H - 0.9); ctx.lineTo(b[0], b[1] - H - 0.9);
          ctx.strokeStyle = 'rgba(130,225,255,.75)'; ctx.lineWidth = 0.8; ctx.stroke();
        }
      },
      post(ctx, x, y, t, k) {
        const w = 2.6, H = 30;
        ctx.fillStyle = 'rgba(0,10,25,.3)'; ctx.beginPath(); ctx.ellipse(x + 2, y + 1, 5, 2, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#2b3f4e'; ctx.fillRect(x - w, y - H, w, H);
        ctx.fillStyle = '#16232d'; ctx.fillRect(x, y - H, w, H);
        ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = 0.7; ctx.strokeRect(x - w, y - H, w * 2, H);
        const pulse = 0.65 + 0.35 * Math.sin(t * 2.2 + k * 0.9);
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        const gr = ctx.createRadialGradient(x, y - H - 2, 0, x, y - H - 2, 10);
        gr.addColorStop(0, `rgba(120,240,255,${0.7 * pulse})`); gr.addColorStop(1, 'rgba(60,200,255,0)');
        ctx.fillStyle = gr; ctx.fillRect(x - 10, y - H - 12, 20, 20);
        ctx.restore();
        ctx.beginPath(); ctx.ellipse(x, y - H - 1.5, 3.2, 2.2, 0, 0, TAU); ctx.fillStyle = '#c8fbff'; ctx.fill();
        ctx.strokeStyle = '#0f1a22'; ctx.lineWidth = 0.8; ctx.stroke();
      },
    },
    ice: {
      spacing: 0.72,
      panels(ctx, pts) {
        for (let i = 0; i + 1 < pts.length; i++) {
          const a = pts[i], b = pts[i + 1];
          for (const hh of [8, 17]) {
            ctx.beginPath(); ctx.moveTo(a[0], a[1] - hh); ctx.lineTo(b[0], b[1] - hh);
            ctx.strokeStyle = '#3c2614'; ctx.lineWidth = 4.4; ctx.stroke();
            ctx.strokeStyle = '#94643a'; ctx.lineWidth = 2.8; ctx.stroke();
            ctx.beginPath(); ctx.moveTo(a[0], a[1] - hh - 0.8); ctx.lineTo(b[0], b[1] - hh - 0.8);
            ctx.strokeStyle = 'rgba(230,190,140,.6)'; ctx.lineWidth = 0.8; ctx.stroke();
          }
          // snow resting on the top rail
          ctx.beginPath(); ctx.moveTo(a[0], a[1] - 19.4); ctx.lineTo(b[0], b[1] - 19.4);
          ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2.2; ctx.stroke();
          for (let s = 0.25; s < 1; s += 0.35) {
            ctx.beginPath(); ctx.ellipse(lerp(a[0], b[0], s), lerp(a[1], b[1], s) - 20, 3.2, 1.6, 0, 0, TAU); ctx.fillStyle = '#fbfdff'; ctx.fill();
          }
        }
      },
      post(ctx, x, y) {
        const w = 4.4, H = 24;
        ctx.fillStyle = 'rgba(60,90,130,.25)'; ctx.beginPath(); ctx.ellipse(x + 3, y + 1, 7, 2.6, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#9aa3aa'; ctx.fillRect(x - w, y - H, w, H);
        ctx.fillStyle = '#6f7880'; ctx.fillRect(x, y - H, w, H);
        ctx.strokeStyle = 'rgba(40,50,60,.55)'; ctx.lineWidth = 0.8;
        ctx.beginPath(); ctx.moveTo(x - w, y - 8); ctx.lineTo(x + w, y - 8); ctx.moveTo(x - w, y - 16); ctx.lineTo(x + w, y - 16);
        ctx.moveTo(x - 1.5, y - 8); ctx.lineTo(x - 1.5, y - 16); ctx.moveTo(x + 2, y); ctx.lineTo(x + 2, y - 8); ctx.stroke();
        ctx.strokeRect(x - w, y - H, w * 2, H);
        ctx.beginPath(); ctx.ellipse(x, y - H, w + 1.6, 3.4, 0, PI, 0); ctx.lineTo(x + w + 1.2, y - H + 1.2); ctx.lineTo(x - w - 1.2, y - H + 1.2); ctx.closePath();
        ctx.fillStyle = '#ffffff'; ctx.fill();
        ctx.beginPath(); ctx.ellipse(x - 2.6, y - H + 2.4, 1.2, 2.4, 0, 0, TAU); ctx.fill();
        ctx.strokeStyle = 'rgba(120,150,190,.6)'; ctx.lineWidth = 0.6;
        ctx.beginPath(); ctx.ellipse(x, y - H, w + 1.6, 3.4, 0, PI, 0); ctx.stroke();
      },
    },
  };

  /** Small iron brazier with a flickering flame (glacier enclosures). */
  function brazier(ctx, x, y, t, ph) {
    ctx.fillStyle = 'rgba(60,90,130,.28)'; ctx.beginPath(); ctx.ellipse(x + 2, y + 1, 8, 3, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#2a2622'; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(x - 6, y); ctx.lineTo(x - 2, y - 14); ctx.moveTo(x + 6, y); ctx.lineTo(x + 2, y - 14); ctx.moveTo(x, y + 2); ctx.lineTo(x, y - 14); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - 8, y - 18); ctx.quadraticCurveTo(x, y - 9, x + 8, y - 18); ctx.closePath();
    ctx.fillStyle = '#3a332c'; ctx.fill(); ctx.strokeStyle = '#141210'; ctx.lineWidth = 1; ctx.stroke();
    ctx.beginPath(); ctx.ellipse(x, y - 18, 8, 2.4, 0, 0, TAU); ctx.fillStyle = '#ff7a1a'; ctx.fill();
    const fl = (k, sx, col, hh) => {
      const s = 1 + Math.sin(t * 13 + ph + k) * 0.12 + Math.sin(t * 7.3 + ph * 2 + k) * 0.08, sw = Math.sin(t * 5 + ph + k) * 1.6;
      ctx.beginPath(); ctx.moveTo(x - sx, y - 18);
      ctx.quadraticCurveTo(x - sx * 1.1, y - 18 - hh * 0.5 * s, x + sw, y - 18 - hh * s);
      ctx.quadraticCurveTo(x + sx * 1.1, y - 18 - hh * 0.5 * s, x + sx, y - 18);
      ctx.closePath(); ctx.fillStyle = col; ctx.fill();
    };
    fl(0, 6.5, '#ff5a1a', 17); fl(1, 4.6, '#ffa21e', 12); fl(2, 2.6, '#fff0a0', 7);
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const gr = ctx.createRadialGradient(x, y - 24, 0, x, y - 24, 30);
    gr.addColorStop(0, `rgba(255,170,60,${0.32 + 0.08 * Math.sin(t * 9 + ph)})`); gr.addColorStop(1, 'rgba(255,120,30,0)');
    ctx.fillStyle = gr; ctx.fillRect(x - 30, y - 54, 60, 60);
    ctx.restore();
  }

  /** Posts of the back (front = false) or front fences of an enclosure, sorted back to front. */
  function fenceRuns(gx, gy, w, h, front, spacing) {
    const f = 0.1, u0 = gx + f, v0 = gy + f, u1 = gx + w - f, v1 = gy + h - f;
    const segs = front ? [[[u1, v0], [u1, v1]], [[u0, v1], [u1, v1]]] : [[[u0, v0], [u0, v1]], [[u0, v0], [u1, v0]]];
    return segs.map(([a, b]) => {
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.round(L / spacing)), pts = [];
      for (let i = 0; i <= n; i++) { const u = lerp(a[0], b[0], i / n), v = lerp(a[1], b[1], i / n); pts.push([wx(u, v), wy(u, v), u + v]); }
      return pts;
    });
  }
  function drawFence(ctx, park, o, t, front) {
    const F = FENCE[park] || FENCE.land, runs = fenceRuns(o.gx, o.gy, o.w, o.h, front, F.spacing);
    const phase = ((o.id || 0) * 0.37) % 1;
    runs.forEach((pts, i) => F.panels(ctx, pts, t, phase + i * 0.5));
    const posts = [];
    for (const pts of runs) for (const p of pts) posts.push(p);
    posts.sort((a, b) => a[2] - b[2]);
    posts.forEach((p, k) => F.post(ctx, p[0], p[1], t, k));
    if (front && park === 'ice') {
      const f = 0.1;
      brazier(ctx, wx(o.gx + f, o.gy + o.h - f) - 9, wy(o.gx + f, o.gy + o.h - f) + 3, t, o.id || 0);
      brazier(ctx, wx(o.gx + o.w - f, o.gy + f) + 9, wy(o.gx + o.w - f, o.gy + f) + 3, t, (o.id || 0) + 2);
    }
  }

  /** Metal plate on the front fence: 1–4 stars (stage + 1) and the level. */
  function drawPlate(ctx, x, y, stage, level, park) {
    const w = 50, h = 26, dark = park === 'sea';
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,.3)'; rrect(ctx, x - w / 2 + 1.5, y - h / 2 + 2, w, h, 5); ctx.fill();
    rrect(ctx, x - w / 2, y - h / 2, w, h, 5);
    const gr = ctx.createLinearGradient(0, y - h / 2, 0, y + h / 2);
    if (dark) { gr.addColorStop(0, '#2c4a60'); gr.addColorStop(1, '#122433'); } else { gr.addColorStop(0, '#eef1f3'); gr.addColorStop(0.5, '#b9c1c7'); gr.addColorStop(1, '#8a949b'); }
    ctx.fillStyle = gr; ctx.fill();
    ctx.strokeStyle = dark ? '#6fe3ff' : '#2b3236'; ctx.lineWidth = 1.4; ctx.stroke();
    ctx.fillStyle = dark ? '#7fdcf0' : '#5a646b';
    for (const [rx, ry] of [[-w / 2 + 3.5, -h / 2 + 3.5], [w / 2 - 3.5, -h / 2 + 3.5], [-w / 2 + 3.5, h / 2 - 3.5], [w / 2 - 3.5, h / 2 - 3.5]]) {
      ctx.beginPath(); ctx.arc(x + rx, y + ry, 1.1, 0, TAU); ctx.fill();
    }
    for (let i = 0; i < 4; i++) {
      const sx = x - 15 + i * 10, sy = y - 5;
      starPath(ctx, sx, sy, 4.6);
      if (i <= stage) {
        ctx.fillStyle = stage === 3 ? '#ffb020' : '#ffd23a'; ctx.fill();
        ctx.strokeStyle = '#7a4a00'; ctx.lineWidth = 0.8; ctx.stroke();
      } else { ctx.fillStyle = dark ? 'rgba(0,0,0,.45)' : 'rgba(40,50,56,.35)'; ctx.fill(); }
    }
    text(ctx, 'Niv. ' + level, x, y + 6.5, 9.5, dark ? '#d6f7ff' : '#1d2328', null);
    ctx.restore();
  }

  // ---------------------------------------------------------------- creature wandering
  function wanderStep(map, key, o, sp, dt, T) {
    const R0 = Math.min(o.w, o.h) >= 4 ? 0.8 : 0.5, cu = o.gx + o.w / 2, cv = o.gy + o.h / 2;
    const swim = sp.park === 'sea';
    let s = map.get(key);
    if (!s || s.cu !== cu || s.cv !== cv) {
      s = { cu, cv, u: cu + (Math.random() - 0.5) * R0, v: cv + (Math.random() - 0.5) * R0, tu: cu, tv: cv,
        mode: 'idle', until: T + 0.4 + Math.random() * 2, facing: Math.random() < 0.5 ? -1 : 1 };
      map.set(key, s);
    }
    if (T >= s.until || s.until - T > 30) {
      if (s.mode === 'walk') {
        const r = Math.random();
        s.mode = r < 0.16 ? 'roar' : r < (swim ? 0.3 : 0.45) ? 'eat' : 'idle';
        s.until = T + (s.mode === 'roar' ? 1.5 : swim ? 0.8 + Math.random() * 1.5 : 1.5 + Math.random() * 3);
      } else {
        const a = Math.random() * TAU, rr = R0 * Math.sqrt(0.3 + Math.random() * 0.7);
        s.tu = cu + Math.cos(a) * rr; s.tv = cv + Math.sin(a) * rr;
        s.mode = 'walk'; s.until = T + 15;
      }
    }
    if (s.mode === 'walk') {
      const du = s.tu - s.u, dv = s.tv - s.v, d = Math.hypot(du, dv);
      const spd = (swim ? 0.36 : sp.art === 'pterosaur' ? 0.42 : 0.28) * dt;
      if (d <= spd || d < 0.01) { s.u = s.tu; s.v = s.tv; s.until = T; }
      else {
        s.u += du / d * spd; s.v += dv / d * spd;
        const sx = du - dv;
        if (Math.abs(sx) > 0.04 * d) s.facing = sx > 0 ? 1 : -1;
      }
    }
    return s;
  }

  // ---------------------------------------------------------------- roads (flat, auto-connected)
  const ROAD_STYLE = {
    land: { kerb: '#756d5c', base: '#c4b99f', shadow: 'rgba(25,40,10,.35)' },
    sea: { kerb: '#9c865c', base: '#e2d29f', shadow: 'rgba(0,20,40,.45)' },
    ice: { kerb: '#a3b6c6', base: '#eef3f7', shadow: 'rgba(60,90,120,.3)' },
  };
  const roadTex = {};
  /** One tile (96×48 diamond canvas) of road surface texture; seamless across tiles. */
  function roadTexture(park) {
    if (roadTex[park]) return roadTex[park];
    const c = document.createElement('canvas');
    c.width = TW; c.height = TH;
    const g = c.getContext('2d'), R = rng(park.length * 77 + 5), st = ROAD_STYLE[park] || ROAD_STYLE.land;
    g.translate(HW, 0);
    g.transform(HW, HH, -HW, HH, 0, 0);          // unit square = the tile
    if (park === 'land') {
      g.fillStyle = '#8c826b'; g.fillRect(0, 0, 1, 1);
      for (let r = 0; r < 5; r++) for (let k = -1; k < 5; k++) {
        const u = k * 0.2 + (r % 2 ? 0.1 : 0), v = r * 0.2;
        g.fillStyle = shade(st.base, (R() - 0.5) * 0.22);
        g.fillRect(u + 0.018, v + 0.018, 0.164, 0.164);
        g.fillStyle = 'rgba(255,255,255,.18)'; g.fillRect(u + 0.018, v + 0.018, 0.164, 0.035);
      }
    } else if (park === 'sea') {
      g.fillStyle = st.base; g.fillRect(0, 0, 1, 1);
      for (let i = 0; i < 160; i++) {
        g.fillStyle = R() < 0.3 ? 'rgba(255,255,255,.7)' : 'rgba(140,115,75,.45)';
        g.fillRect(R(), R(), 0.012 + R() * 0.02, 0.012 + R() * 0.02);
      }
      g.strokeStyle = 'rgba(160,135,90,.35)'; g.lineWidth = 0.02;
      for (let v = 0.1; v < 1; v += 0.2) { g.beginPath(); g.moveTo(0, v); g.quadraticCurveTo(0.5, v + 0.06, 1, v); g.stroke(); }
    } else {
      g.fillStyle = st.base; g.fillRect(0, 0, 1, 1);
      g.fillStyle = 'rgba(150,175,200,.35)';
      for (const v of [0.3, 0.7]) g.fillRect(0, v - 0.04, 1, 0.08);
      for (let i = 0; i < 90; i++) {
        g.fillStyle = R() < 0.5 ? 'rgba(255,255,255,.95)' : 'rgba(140,175,210,.45)';
        g.fillRect(R(), R(), 0.015, 0.015);
      }
    }
    roadTex[park] = c;
    return c;
  }
  function drawRoads(ctx, objs, park) {
    const tiles = new Map(), gates = new Set();
    for (const o of objs) {
      if (!Number.isFinite(o.gx)) continue;
      if (isRoad(o)) { for (let y = o.gy; y < o.gy + (o.h || 1); y++) for (let x = o.gx; x < o.gx + (o.w || 1); x++) tiles.set(x + ',' + y, 1); }
      else if (o.type === 'building' && o.fixed) {
        const d = bdef(o.buildingId);
        if ((d && d.action === 'gate') || /^(gate|harbor)_/.test(o.buildingId || '')) for (let y = o.gy; y < o.gy + o.h; y++) for (let x = o.gx; x < o.gx + o.w; x++) gates.add(x + ',' + y);
      }
    }
    if (!tiles.size) return;
    const conn = (x, y) => tiles.has(x + ',' + y) || gates.has(x + ',' + y);
    const kerb = new Path2D(), surf = new Path2D(), list = [];
    const a = 0.15, b = 0.85, ka = 0.07, kb = 0.93;
    for (const key of tiles.keys()) {
      const [x, y] = key.split(',').map(Number);
      list.push([x, y]);
      quadIso(kerb, x + ka, y + ka, x + kb, y + kb); quadIso(surf, x + a, y + a, x + b, y + b);
      if (conn(x + 1, y)) { quadIso(kerb, x + kb - 0.01, y + ka, x + 1, y + kb); quadIso(surf, x + b - 0.01, y + a, x + 1, y + b); }
      if (conn(x - 1, y)) { quadIso(kerb, x, y + ka, x + ka + 0.01, y + kb); quadIso(surf, x, y + a, x + a + 0.01, y + b); }
      if (conn(x, y + 1)) { quadIso(kerb, x + ka, y + kb - 0.01, x + kb, y + 1); quadIso(surf, x + a, y + b - 0.01, x + b, y + 1); }
      if (conn(x, y - 1)) { quadIso(kerb, x + ka, y, x + kb, y + ka + 0.01); quadIso(surf, x + a, y, x + b, y + a + 0.01); }
    }
    const st = ROAD_STYLE[park] || ROAD_STYLE.land, tex = roadTexture(park);
    ctx.save();
    ctx.save(); ctx.translate(1, 3); ctx.fillStyle = st.shadow; ctx.fill(kerb); ctx.restore();
    ctx.fillStyle = st.kerb; ctx.fill(kerb);
    ctx.save(); ctx.translate(0, -1); ctx.fillStyle = shade(st.kerb, 0.25); ctx.fill(kerb); ctx.restore();
    ctx.fillStyle = st.kerb; ctx.save(); ctx.translate(0, 0.6); ctx.fill(surf); ctx.restore();
    ctx.clip(surf);
    for (const [x, y] of list) ctx.drawImage(tex, wx(x, y) - HW, wy(x, y), TW, TH);
    ctx.restore();
  }

  // ---------------------------------------------------------------- scenery fallback (and the ice-sea icebergs)
  const BA_KINDS = () => (PC.BUILD_ART && PC.BUILD_ART.sceneryKinds) || [];
  function drawScenery(ctx, kind, x, y, size, t, seed) {
    const BA = PC.BUILD_ART;
    if (BA && typeof BA.drawScenery === 'function' && BA_KINDS().indexOf(kind) >= 0) { BA.drawScenery(ctx, kind, x, y, size, t, seed); return; }
    sceneryFallback(ctx, kind, x, y, size, t, seed);
  }
  function sceneryFallback(ctx, kind, x, y, size, t, seed) {
    const R = rng(seed | 0), k = size / 96 * (0.8 + R() * 0.4);
    ctx.save(); ctx.translate(x, y); ctx.scale(R() < 0.5 ? -k : k, k);
    if (kind === 'iceberg') {
      const bob = Math.sin(t * 0.8 + seed) * 1.2, w = 22 + R() * 14, hgt = 14 + R() * 16;
      ctx.translate(0, bob);
      ctx.beginPath(); ctx.ellipse(0, 2, w * 1.15, w * 0.32, 0, 0, TAU); ctx.fillStyle = 'rgba(230,248,255,.35)'; ctx.fill();
      ctx.beginPath(); ctx.moveTo(-w, 0); ctx.lineTo(-w * 0.6, -hgt * 0.7); ctx.lineTo(-w * 0.1, -hgt); ctx.lineTo(w * 0.5, -hgt * 0.8); ctx.lineTo(w, 0);
      ctx.lineTo(w * 0.2, w * 0.25); ctx.closePath(); ctx.fillStyle = '#e9f6fc'; ctx.fill();
      ctx.beginPath(); ctx.moveTo(-w * 0.1, -hgt); ctx.lineTo(w * 0.5, -hgt * 0.8); ctx.lineTo(w, 0); ctx.lineTo(w * 0.2, w * 0.25); ctx.lineTo(0, -hgt * 0.3); ctx.closePath();
      ctx.fillStyle = '#9fcbe2'; ctx.fill();
      ctx.strokeStyle = '#5f8fae'; ctx.lineWidth = 1; ctx.beginPath();
      ctx.moveTo(-w, 0); ctx.lineTo(-w * 0.6, -hgt * 0.7); ctx.lineTo(-w * 0.1, -hgt); ctx.lineTo(w * 0.5, -hgt * 0.8); ctx.lineTo(w, 0); ctx.stroke();
      ctx.restore();
      return;
    }
    ctx.beginPath(); ctx.ellipse(0, 0, 18, 6, 0, 0, TAU); ctx.fillStyle = 'rgba(0,0,0,.2)'; ctx.fill();
    const tree = /palm|broadleaf|pine|dead_tree|kelp/.test(kind), rock = /rock|ice_shard/.test(kind);
    if (tree) {
      ctx.fillStyle = kind === 'kelp' ? '#2f8a52' : '#6b4a2a'; ctx.fillRect(-2.5, -46, 5, 46);
      ctx.beginPath();
      if (kind === 'pine') { ctx.moveTo(-20, -18); ctx.lineTo(0, -70); ctx.lineTo(20, -18); ctx.fillStyle = '#2f5d48'; }
      else { ctx.arc(0, -52, 20, 0, TAU); ctx.fillStyle = kind === 'kelp' ? '#3fa063' : kind === 'dead_tree' ? 'rgba(0,0,0,0)' : '#3f8a2e'; }
      ctx.fill();
    } else if (rock) {
      ctx.beginPath(); ctx.moveTo(-14, 0); ctx.lineTo(-10, -12); ctx.lineTo(2, -18); ctx.lineTo(13, -8); ctx.lineTo(14, 0); ctx.closePath();
      ctx.fillStyle = kind === 'ice_shard' ? '#bfe6f6' : kind === 'snow_rock' ? '#8d969d' : kind === 'sea_rock' ? '#4f6b7d' : '#8f8778'; ctx.fill();
    } else {
      const col = { coral_fan: '#e45a7a', coral_brain: '#d98a3a', anemone: '#c66ae0', flowers: '#ff8fb0', fern: '#4f9a36', bush: '#3f8a2e' }[kind] || '#5f9a3a';
      ctx.beginPath(); ctx.arc(-6, -9, 9, 0, TAU); ctx.arc(6, -10, 9, 0, TAU); ctx.arc(0, -16, 9, 0, TAU); ctx.fillStyle = col; ctx.fill();
    }
    ctx.restore();
  }

  /** Simple iso box (used when PC.BUILD_ART is missing). */
  function boxFallback(ctx, fp, hgt, col, alpha) {
    ctx.save();
    if (alpha != null) ctx.globalAlpha *= alpha;
    const { top, right, bottom, left } = fp;
    ctx.beginPath(); ctx.moveTo(left[0], left[1]); ctx.lineTo(bottom[0], bottom[1]); ctx.lineTo(bottom[0], bottom[1] - hgt); ctx.lineTo(left[0], left[1] - hgt); ctx.closePath();
    ctx.fillStyle = shade(col, -0.15); ctx.fill();
    ctx.beginPath(); ctx.moveTo(bottom[0], bottom[1]); ctx.lineTo(right[0], right[1]); ctx.lineTo(right[0], right[1] - hgt); ctx.lineTo(bottom[0], bottom[1] - hgt); ctx.closePath();
    ctx.fillStyle = shade(col, -0.35); ctx.fill();
    ctx.beginPath(); ctx.moveTo(top[0], top[1] - hgt); ctx.lineTo(right[0], right[1] - hgt); ctx.lineTo(bottom[0], bottom[1] - hgt); ctx.lineTo(left[0], left[1] - hgt); ctx.closePath();
    ctx.fillStyle = shade(col, 0.15); ctx.fill();
    ctx.restore();
  }
  /** Rough on-screen height of a building's art (for bubbles and hit boxes). */
  function artHeight(art, w, h) {
    const D = PC.BUILD_ART && PC.BUILD_ART._debug && PC.BUILD_ART._debug.DEFS, d = D && D[art];
    if (d && d.H) return Math.min(d.H, 190) * (w + h) / ((d.W || w) + (d.D || h));
    return 30 + 26 * Math.max(w, h);
  }

  /** Tileable background texture shown beyond the painted terrain (pans with the world). */
  const bgTex = {};
  function bgTexture(park) {
    if (bgTex[park]) return bgTex[park];
    const W = 384, H = 192, c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d'), R = rng(park.length * 131 + 9), P = PAL[park] || PAL.land;
    g.fillStyle = P.bg; g.fillRect(0, 0, W, H);
    const cols = park === 'sea' ? [['#082b47', 0.45], ['#1a5b88', 0.35], ['#2f7fae', 0.12]]
      : park === 'ice' ? [['#b5c9da', 0.4], ['#f4f8fb', 0.6], ['#9fb7cc', 0.2]]
      : [['#24491a', 0.5], ['#4f8a33', 0.4], ['#5f9c3a', 0.25]];
    for (let i = 0; i < 140; i++) {
      const [col, a] = cols[i % cols.length], x = R() * W, y = R() * H, r = 6 + R() * (park === 'land' ? 18 : 30);
      for (const ox of [-W, 0, W]) for (const oy of [-H, 0, H]) {
        g.beginPath(); g.ellipse(x + ox, y + oy, r, r * 0.5, 0, 0, TAU); g.fillStyle = rgba(col, a * (0.5 + R() * 0.5)); g.fill();
      }
    }
    if (park === 'land') {
      for (let i = 0; i < 900; i++) {
        const x = R() * W, y = R() * H, r = 2 + R() * 3.4;
        g.beginPath(); g.ellipse(x, y, r, r * 0.45, R() * PI, 0, TAU);
        g.fillStyle = ['#2f611f', '#3d7529', '#4f8c33', '#2a5719'][(R() * 4) | 0]; g.fill();
      }
    }
    bgTex[park] = c;
    return c;
  }

  /** Time argument of render(): seconds preferred; a requestAnimationFrame timestamp (ms) is detected. */
  function normTime(t) {
    const pn = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    if (typeof t !== 'number' || !isFinite(t)) return pn / 1000;
    return Math.abs(t - pn) < Math.abs(t - pn / 1000) ? t / 1000 : t;
  }

  // ================================================================ the view
  /**
   * Create the park view on a <canvas> (it handles its own size, devicePixelRatio, pan, zoom and taps).
   * See SPEC §6 for the API. Extra helpers: hitTest(sx, sy), screenToGrid(sx, sy), gridToScreen(gx, gy),
   * getZoom(), setZoom(z), destroy(). Screen coordinates are CSS px relative to the canvas.
   */
  ISO.createView = function (canvas) {
    const ctx = canvas.getContext('2d');
    const view = { canvas, park: 'land', onTap: null, onPlacementChange: null };
    let cssW = 0, cssH = 0, dpr = 1;
    const cam = { x: 0, y: 0, z: 0.75 };
    let camAnim = null, lastT = 0, dt = 0.016;
    let placement = null, highlightId = null;
    let floats = [], parts = [], hitBubbles = [], hitBoxes = [];
    const wanders = new Map(), amb = {}, pats = {};
    const listeners = [];

    try {
      canvas.style.touchAction = 'none';
      canvas.style.userSelect = 'none';
      canvas.style.webkitUserSelect = 'none';
      canvas.style.webkitTapHighlightColor = 'transparent';
    } catch (e) { /* ignore */ }

    // ------------------------------------------------------------ camera
    function measure() {
      let w = canvas.clientWidth, h = canvas.clientHeight;
      if (!w || !h) { const r = canvas.getBoundingClientRect(); w = r.width; h = r.height; }
      if (!w || !h) { w = window.innerWidth || 800; h = window.innerHeight || 600; }
      return [w, h];
    }
    const defaultZoom = () => clamp(Math.max(cssW / 1700, cssH / 1400), 0.5, 0.95);
    function home() {
      const p = [12, 13.4];
      cam.x = wx(p[0], p[1]); cam.y = wy(p[0], p[1]);
    }
    function clampCam() {
      cam.z = clamp(cam.z, ZMIN, ZMAX);
      const g = ISO.toGrid(cam.x, cam.y), u = clamp(g[0], 1.5, MAP - 1.5), v = clamp(g[1], 1.5, MAP - 1.5);
      cam.x = wx(u, v); cam.y = wy(u, v);
    }
    function resize() {
      const [w, h] = measure();
      const d = Math.max(1, Math.min(2.5, window.devicePixelRatio || 1));
      const first = !cssW;
      cssW = w; cssH = h; dpr = d;
      const pw = Math.max(1, Math.round(w * d)), ph = Math.max(1, Math.round(h * d));
      if (canvas.width !== pw) canvas.width = pw;
      if (canvas.height !== ph) canvas.height = ph;
      if (first) { cam.z = defaultZoom(); home(); }
      clampCam();
    }
    const toWorld = (sx, sy) => [(sx - cssW / 2) / cam.z + cam.x, (sy - cssH / 2) / cam.z + cam.y];
    const toScreen = (x, y) => [(x - cam.x) * cam.z + cssW / 2, (y - cam.y) * cam.z + cssH / 2];
    function zoomAt(sx, sy, z) {
      const before = toWorld(sx, sy);
      cam.z = clamp(z, ZMIN, ZMAX);
      cam.x = before[0] - (sx - cssW / 2) / cam.z;
      cam.y = before[1] - (sy - cssH / 2) / cam.z;
      camAnim = null;
      clampCam();
    }

    view.resize = resize;
    view.getZoom = () => cam.z;
    view.setZoom = z => { zoomAt(cssW / 2, cssH / 2, z); };
    view.screenToGrid = (sx, sy) => { const p = toWorld(sx, sy); return ISO.toGrid(p[0], p[1]); };
    view.gridToScreen = (gx, gy) => toScreen(wx(gx, gy), wy(gx, gy));
    view.centerOn = function (gx, gy, instant) {
      const tx = wx(gx, gy), ty = wy(gx, gy);
      if (instant || !lastT) { cam.x = tx; cam.y = ty; camAnim = null; clampCam(); return; }
      camAnim = { fx: cam.x, fy: cam.y, tx, ty, t0: lastT, dur: 0.45 };
    };
    view.setPark = function (park) {
      if (!PAL[park]) park = 'land';
      const changed = park !== view.park;
      view.park = park;
      if (changed) { floats = []; parts = []; wanders.clear(); placement = null; highlightId = null; }
      if (!cssW) resize();
      home(); clampCam(); camAnim = null;
      try { terrainPaint(park); } catch (e) { console.error('[ISO] terrain', e); }
    };

    // ------------------------------------------------------------ state access
    function currentObjects() {
      const E = engine(), st = E && E.state, P = st && st.parks && st.parks[view.park];
      return (P && Array.isArray(P.objects)) ? P.objects : [];
    }
    function canPlace(gx, gy, w, h, ignoreId) {
      const E = engine();
      if (E && typeof E.canPlace === 'function') { try { return !!E.canPlace(view.park, gx, gy, w, h, ignoreId); } catch (e) { return false; } }
      for (let y = gy; y < gy + h; y++) for (let x = gx; x < gx + w; x++) if (TERRAIN.tileAt(view.park, x, y) !== 1) return false;
      return true;
    }
    function coinBubbleDue(o) {
      const E = engine();
      if (!E || typeof E.pendingCoins !== 'function' || !o.hatched) return false;
      let cpm = 5;
      try { cpm = PC.statsAt(o.speciesId, o.level || 1).coinsPerMin; } catch (e) { /* ignore */ }
      let p = 0;
      try { p = E.pendingCoins(o); } catch (e) { return false; }
      return p >= Math.max(5, cpm);
    }

    // ------------------------------------------------------------ placement
    function placementValid() {
      const p = placement;
      return canPlace(p.gx, p.gy, p.w, p.h, p.ghost && p.ghost.type === 'move' && p.ghost.obj ? p.ghost.obj.id : undefined);
    }
    function firePlacement() {
      if (typeof view.onPlacementChange === 'function' && placement) {
        try { view.onPlacementChange(view.getPlacement()); } catch (e) { console.error(e); }
      }
    }
    function movePlacement(gx, gy) {
      if (!placement) return;
      gx = clamp(Math.round(gx), 0, MAP - placement.w); gy = clamp(Math.round(gy), 0, MAP - placement.h);
      if (gx === placement.gx && gy === placement.gy) return;
      placement.gx = gx; placement.gy = gy;
      placement.valid = placementValid();
      firePlacement();
    }
    view.startPlacement = function (opts) {
      opts = opts || {};
      const ghost = opts.ghost || { type: 'building' };
      let w = opts.w | 0, h = opts.h | 0;
      if ((!w || !h) && ghost.type === 'move' && ghost.obj) { w = ghost.obj.w; h = ghost.obj.h; }
      if ((!w || !h) && ghost.type === 'building') { const d = bdef(ghost.buildingId); if (d && d.size) { w = d.size[0]; h = d.size[1]; } }
      w = Math.max(1, w || 1); h = Math.max(1, h || 1);
      let gx = opts.gx, gy = opts.gy;
      if (!Number.isFinite(gx) || !Number.isFinite(gy)) {
        if (ghost.type === 'move' && ghost.obj && Number.isFinite(ghost.obj.gx)) { gx = ghost.obj.gx; gy = ghost.obj.gy; }
        else { const c = ISO.toGrid(cam.x, cam.y); gx = Math.round(c[0] - w / 2); gy = Math.round(c[1] - h / 2); }
      }
      placement = { w, h, ghost, gx: clamp(Math.round(gx), 0, MAP - w), gy: clamp(Math.round(gy), 0, MAP - h), valid: false, t0: lastT };
      camAnim = null;
      placement.valid = placementValid();
      // keep the ghost on screen
      const s = toScreen(wx(placement.gx + w / 2, placement.gy + h / 2), wy(placement.gx + w / 2, placement.gy + h / 2));
      if (s[0] < 40 || s[0] > cssW - 40 || s[1] < 80 || s[1] > cssH - 120) view.centerOn(placement.gx + w / 2, placement.gy + h / 2);
      firePlacement();
      return view.getPlacement();
    };
    view.getPlacement = function () {
      if (!placement) return null;
      placement.valid = placementValid();
      return { gx: placement.gx, gy: placement.gy, w: placement.w, h: placement.h, valid: placement.valid };
    };
    view.endPlacement = function () { placement = null; };
    view.isPlacing = () => !!placement;

    // ------------------------------------------------------------ effects API
    view.highlight = function (id) { highlightId = id == null ? null : id; };
    view.addFloat = function (gx, gy, txt, color, ic) {
      floats.push({ x: wx(gx, gy), y: wy(gx, gy) - 46, text: String(txt == null ? '' : txt), color: color || '#ffffff', icon: ic || null, t0: lastT });
      if (floats.length > 40) floats.shift();
    };
    view.addBurst = function (gx, gy, kind) {
      const x = wx(gx, gy), y = wy(gx, gy), R = Math.random, T0 = lastT, park = view.park;
      const add = p => parts.push(Object.assign({ x, y, vx: 0, vy: 0, g: 0, t0: T0, life: 1, size: 4, rot: 0, vr: 0, col: '#fff' }, p));
      const ring = (col, life, r1, delay) => add({ type: 'ring', col, life, r1, t0: T0 + (delay || 0) });
      const sparks = (n, cols, sp, up, life, type) => {
        for (let i = 0; i < n; i++) {
          const a = R() * TAU, v = sp * (0.4 + R() * 0.8);
          add({ type: type || 'spark', vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.5 - up * (0.5 + R()), g: up * 0.9, life: life * (0.7 + R() * 0.6),
            size: 2 + R() * 3.5, col: cols[(R() * cols.length) | 0], rot: R() * TAU, vr: (R() - 0.5) * 8, y: y - 20 - R() * 20 });
        }
      };
      switch (kind) {
        case 'hatch':
          ring('#fff3b0', 0.8, 90);
          for (let i = 0; i < 16; i++) {
            const a = -PI / 2 + (R() - 0.5) * 2.6, v = 90 + R() * 120;
            add({ type: 'shard', vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 420, life: 1.1 + R() * 0.4, size: 4 + R() * 4, col: R() < 0.5 ? '#f3e8cc' : '#e2d2a8', rot: R() * TAU, vr: (R() - 0.5) * 14, y: y - 18 });
          }
          sparks(18, ['#ffe680', '#ffffff', '#ffd23a'], 120, 60, 1.2, 'star');
          break;
        case 'level':
          ring('#ffd23a', 0.9, 110); ring('#fff6c0', 0.9, 80, 0.15);
          sparks(22, ['#ffd23a', '#ffb020', '#ffffff'], 90, 110, 1.4, 'star');
          break;
        case 'evolve':
          add({ type: 'column', life: 1.8, size: 70 });
          ring('#b6f0ff', 1.1, 140); ring('#ffe680', 1.1, 120, 0.25); ring('#ffffff', 1.1, 100, 0.5);
          sparks(36, ['#ffe680', '#a0f0ff', '#ffffff', '#ff9ad8', '#b0ff9a'], 130, 140, 1.8, 'star');
          break;
        case 'stars':
          sparks(20, ['#ffe680', '#ffffff', '#ffd23a'], 110, 70, 1.1, 'star');
          break;
        case 'build':
        default: {
          const dust = park === 'ice' ? ['#ffffff', '#e2edf5'] : park === 'sea' ? ['#e2d29f', '#bfe8ff'] : ['#d8c49a', '#b89c6c'];
          ring(park === 'sea' ? '#bff3ff' : '#fff6d0', 0.7, 120);
          for (let i = 0; i < 22; i++) {
            const a = R() * TAU, v = 50 + R() * 90;
            add({ type: park === 'sea' ? 'bubble' : 'puff', vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.5 - 10, g: park === 'sea' ? -60 : -20, life: 0.9 + R() * 0.6,
              size: 8 + R() * 10, col: dust[(R() * dust.length) | 0] });
          }
          sparks(10, ['#ffffff', '#ffe680'], 80, 60, 0.9, 'star');
        }
      }
      if (parts.length > 600) parts.splice(0, parts.length - 600);
    };

    // ------------------------------------------------------------ hit testing
    view.hitTest = function (sx, sy) {
      const [x, y] = toWorld(sx, sy);
      for (let i = hitBubbles.length - 1; i >= 0; i--) {
        const b = hitBubbles[i], dx = x - b.x, dy = y - b.y;
        if (b.hw ? Math.abs(dx) <= b.hw && Math.abs(dy) <= b.hh : dx * dx + dy * dy <= b.r * b.r) return { kind: 'bubble', obj: b.obj };
      }
      const [u, v] = ISO.toGrid(x, y);
      let best = null, bestD = -Infinity;
      for (const o of currentObjects()) {
        if (!Number.isFinite(o.gx)) continue;
        if (u >= o.gx && u < o.gx + o.w && v >= o.gy && v < o.gy + o.h) {
          const d = o.gx + o.gy + (o.w + o.h) / 2;
          if (d > bestD) { best = o; bestD = d; }
        }
      }
      const slop = HIT_SLOP_PX / cam.z;
      for (const b of hitBoxes) {
        if (b.d <= bestD) continue;
        // buildings: only their drawn pixels count, so the air above a round arena's rim does not hide the
        // creature or enclosure behind it; the rectangle is the fallback when no art mask is available
        const art = b.art && PC.BUILD_ART && PC.BUILD_ART.hit ? PC.BUILD_ART.hit(b.art, b.fp, x, y, b.opts, slop) : null;
        if (art === null ? x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1 : art) { best = b.obj; bestD = b.d; }
      }
      if (best) return { kind: 'object', obj: best };
      return { kind: 'tile', gx: Math.floor(u), gy: Math.floor(v) };
    };

    // ------------------------------------------------------------ input
    const pointers = new Map();
    let gesture = null;
    const local = e => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    function on(target, evt, fn, opt) { target.addEventListener(evt, fn, opt); listeners.push([target, evt, fn, opt]); }
    function onGhost(sx, sy) {
      if (!placement) return false;
      const [x, y] = toWorld(sx, sy), [u, v] = ISO.toGrid(x, y), m = 0.6, p = placement;
      if (u >= p.gx - m && u <= p.gx + p.w + m && v >= p.gy - m && v <= p.gy + p.h + m) return true;
      // also the upright preview above the footprint
      const fp = footprint(p.gx, p.gy, p.w, p.h);
      return x >= fp.left[0] && x <= fp.right[0] && y >= fp.top[1] - 90 && y <= fp.bottom[1];
    }
    function startPinch() {
      const pts = [...pointers.values()];
      const a = pts[0], b = pts[1], mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      gesture = { mode: 'pinch', d0: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)), z0: cam.z, world: toWorld(mx, my), moved: true };
      camAnim = null;
    }
    on(canvas, 'pointerdown', e => {
      if (e.button != null && e.button > 0 && e.pointerType === 'mouse') return;
      const [sx, sy] = local(e);
      pointers.set(e.pointerId, { x: sx, y: sy });
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      if (pointers.size === 1) {
        gesture = { mode: 'pending', id: e.pointerId, sx, sy, cx: cam.x, cy: cam.y, moved: false, ghost: onGhost(sx, sy) };
        if (gesture.ghost) {
          const g = view.screenToGrid(sx, sy);
          gesture.off = [g[0] - placement.gx, g[1] - placement.gy];
        }
      } else if (pointers.size === 2) startPinch();
      if (e.cancelable) e.preventDefault();
    });
    on(canvas, 'pointermove', e => {
      const [sx, sy] = local(e);
      const p = pointers.get(e.pointerId);
      if (!p) {
        if (e.pointerType === 'mouse') {
          const h = view.hitTest(sx, sy);
          canvas.style.cursor = onGhost(sx, sy) ? 'grab' : h.kind !== 'tile' ? 'pointer' : 'default';
        }
        return;
      }
      p.x = sx; p.y = sy;
      if (!gesture) return;
      if (gesture.mode === 'pinch') {
        if (pointers.size < 2) return;
        const pts = [...pointers.values()], a = pts[0], b = pts[1], mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        cam.z = clamp(gesture.z0 * Math.hypot(a.x - b.x, a.y - b.y) / gesture.d0, ZMIN, ZMAX);
        cam.x = gesture.world[0] - (mx - cssW / 2) / cam.z;
        cam.y = gesture.world[1] - (my - cssH / 2) / cam.z;
        clampCam();
        return;
      }
      if (e.pointerId !== gesture.id) return;
      const dx = sx - gesture.sx, dy = sy - gesture.sy;
      if (!gesture.moved && Math.hypot(dx, dy) > TAP_PX) { gesture.moved = true; gesture.mode = gesture.ghost && placement ? 'ghost' : 'pan'; camAnim = null; }
      if (gesture.mode === 'pan') {
        cam.x = gesture.cx - dx / cam.z; cam.y = gesture.cy - dy / cam.z; clampCam();
      } else if (gesture.mode === 'ghost' && placement) {
        const g = view.screenToGrid(sx, sy);
        movePlacement(g[0] - gesture.off[0], g[1] - gesture.off[1]);
        canvas.style.cursor = 'grabbing';
      }
    });
    function release(e, cancelled) {
      const had = pointers.has(e.pointerId);
      pointers.delete(e.pointerId);
      try { canvas.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      if (!had || !gesture) return;
      if (gesture.mode === 'pinch') {
        if (pointers.size === 1) {
          const [id, q] = [...pointers.entries()][0];
          gesture = { mode: 'pan', id, sx: q.x, sy: q.y, cx: cam.x, cy: cam.y, moved: true };
        } else if (!pointers.size) gesture = null;
        return;
      }
      if (e.pointerId !== gesture.id) return;
      const g = gesture;
      gesture = null;
      if (!cancelled && !g.moved) {
        const [sx, sy] = local(e);
        tapAt(sx, sy);
      }
    }
    on(canvas, 'pointerup', e => release(e, false));
    on(canvas, 'pointercancel', e => release(e, true));
    on(canvas, 'lostpointercapture', e => { if (pointers.has(e.pointerId)) release(e, true); });
    on(canvas, 'wheel', e => {
      e.preventDefault();
      const [sx, sy] = local(e);
      let d = e.deltaY;
      if (e.deltaMode === 1) d *= 30; else if (e.deltaMode === 2) d *= 300;
      zoomAt(sx, sy, cam.z * Math.exp(-clamp(d, -300, 300) * 0.0016));
    }, { passive: false });
    on(canvas, 'contextmenu', e => e.preventDefault());
    on(window, 'resize', () => resize());
    on(window, 'orientationchange', () => setTimeout(resize, 120));
    let ro = null;
    if (typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(() => resize()); ro.observe(canvas); }

    function tapAt(sx, sy) {
      if (placement) {
        const g = view.screenToGrid(sx, sy);
        movePlacement(Math.floor(g[0]) - Math.floor((placement.w - 1) / 2), Math.floor(g[1]) - Math.floor((placement.h - 1) / 2));
        return;
      }
      const hit = view.hitTest(sx, sy);
      if (typeof view.onTap === 'function') { try { view.onTap(hit); } catch (e) { console.error(e); } }
    }
    view.tap = tapAt;            // programmatic tap (tests, keyboard helpers)
    view.destroy = function () {
      for (const [tg, ev, fn, opt] of listeners) tg.removeEventListener(ev, fn, opt);
      listeners.length = 0;
      if (ro) ro.disconnect();
    };

    // ------------------------------------------------------------ drawing: objects
    function drawEnclosure(o, T, now, alpha, wkey, ov, preview) {
      const park = view.park, sp = PC.SPECIES && PC.SPECIES[o.speciesId];
      const g = enclosureGround(park, o.w, o.h, (o.id || 0) % 3);
      ctx.save();
      if (alpha < 1) ctx.globalAlpha *= alpha;
      ctx.drawImage(g.c, wx(o.gx, o.gy) + g.x0, wy(o.gx, o.gy) + g.y0);
      if (park === 'sea') lagoonCaustics(o, T);
      drawFence(ctx, park, o, T, false);
      const cx = wx(o.gx + o.w / 2, o.gy + o.h / 2), cy = wy(o.gx + o.w / 2, o.gy + o.h / 2);
      const drop = park === 'sea' ? ENC_DROP : 0;
      if (sp && !o.hatched && !preview) {
        const hatchSec = sp.hatchSec || 60, remain = Math.max(0, ((o.hatchAt || 0) - now) / 1000), ready = remain <= 0;
        const ey = cy + drop + 4, size = o.w >= 4 ? 62 : 52;
        if (PC.ART && PC.ART.drawEgg) PC.ART.drawEgg(ctx, cx, ey, size, park, T + (o.id || 0), clamp(1 - remain / hatchSec, 0, 1), ready);
        if (ov) ov.push(ready ? { type: 'hatch', obj: o, x: cx, y: ey - size * 1.55, d: 0 } : { type: 'timer', x: cx, y: ey + 14, text: fmtClock(remain) });
      } else if (sp && PC.ART && PC.ART.drawCreature) {
        const level = preview ? 1 : o.level || 1, stage = PC.stageForLevel ? PC.stageForLevel(level) : 0;
        const meta = PC.ART.templateMeta ? PC.ART.templateMeta(o.speciesId) : { bounds: [-80, -90, 90, 4] }, b = meta.bounds;
        const growth = (PC.STAGE_GROWTH ? PC.STAGE_GROWTH[stage] : 1) * (sp.size || 1), encW = (o.w + o.h) * HW;
        const scale = Math.min(encW * 0.6 / 240, encW * 0.7 / ((b[2] - b[0]) * growth), encW * 0.62 / ((b[3] - b[1]) * growth));
        const s = wanderStep(wanders, wkey, o, sp, dt, T);
        const swim = sp.park === 'sea';
        let pose = s.mode === 'walk' ? (swim ? 'swim' : 'walk') : s.mode === 'idle' ? (swim ? 'swim' : 'idle') : s.mode;
        if (preview) pose = swim ? 'swim' : 'idle';
        const x = wx(s.u, s.v), y = wy(s.u, s.v) + drop + (swim ? Math.sin(T * 1.6 + (o.id || 0)) * 2 : 0);
        if (swim) {
          ctx.save(); ctx.globalAlpha *= 0.5;
          ctx.beginPath(); ctx.ellipse(x, y + 2, 44 * scale * growth + 10, 9, 0, 0, TAU);
          ctx.strokeStyle = 'rgba(200,245,255,.6)'; ctx.lineWidth = 1.5; ctx.stroke();
          ctx.restore();
        }
        const co = { x, y, scale, facing: s.facing, t: T + (o.id || 0) * 1.37, pose, stage, k: fract(T * 0.7), shadow: true };
        PC.ART.drawCreature(ctx, o.speciesId, co);
        if (!preview && PC.ART.creatureBox) {
          const bx = PC.ART.creatureBox(o.speciesId, co);
          hitBoxes.push({ x0: bx.x0, x1: bx.x1, y0: bx.y0, y1: bx.y1, d: o.gx + o.gy + (o.w + o.h) / 2, obj: o });
          if (ov && o.hatched && coinBubbleDue(o)) ov.push({ type: 'coin', obj: o, x: (bx.x0 + bx.x1) / 2, y: Math.min(bx.y0 + 6, cy - 40) - 18 });
        }
      }
      drawFence(ctx, park, o, T, true);
      if (o.hatched && !preview) {
        const f = 0.1, px = wx(o.gx + o.w - f, o.gy + o.h - f), py = wy(o.gx + o.w - f, o.gy + o.h - f);
        const lv = o.level || 1;
        drawPlate(ctx, px, py - (park === 'sea' ? 17 : park === 'ice' ? 13 : 20), PC.stageForLevel ? PC.stageForLevel(lv) : 0, lv, park);
      }
      ctx.restore();
    }
    function lagoonCaustics(o, T) {
      const pat = pattern('caustic');
      if (!pat) return;
      const fi = 0.32, q = new Path2D();
      quadIso(q, o.gx + fi, o.gy + fi, o.gx + o.w - fi, o.gy + o.h - fi);
      ctx.save();
      ctx.clip(q);
      ctx.translate(0, ENC_DROP);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha *= 0.3;
      const cx = wx(o.gx, o.gy);
      ctx.translate(cx + T * 9, wy(o.gx, o.gy) + T * 4);
      ctx.scale(0.9, 0.45);
      ctx.fillStyle = pat; ctx.fillRect(-400, -200, 900, 1100);
      ctx.restore();
    }
    function drawBuilding(o, T, now, alpha, ov, ghost) {
      const fp = footprint(o.gx, o.gy, o.w, o.h), art = artOf(o.buildingId), park = view.park;
      let prod = null;
      const E = engine();
      if (!ghost) {
        if (E && typeof E.production === 'function') { try { prod = E.production(o); } catch (e) { prod = null; } }
        if (!prod && Number.isFinite(o.readyAt)) {
          const tot = Math.max(1, (o.cycleSec || 60) * 1000), rem = o.readyAt - now, d = bdef(o.buildingId);
          prod = { state: rem <= 0 ? 'ready' : 'producing', progress: clamp(1 - rem / tot, 0, 1), remainingSec: Math.ceil(Math.max(0, rem) / 1000),
            res: d && d.produce ? d.produce.res : 'coins' };
        }
      }
      const ready = !!prod && prod.state === 'ready';
      const producing = prod ? (prod.state === 'ready' ? 1 : prod.state === 'producing' ? prod.progress || 0 : 0) : (ghost ? 1 : 0);
      const BA = PC.BUILD_ART;
      const artOpts = { ready, producing, biome: park, level: o.level || 1 }, drawn = !!BA && typeof BA.draw === 'function';
      if (drawn) BA.draw(ctx, art, fp, T, Object.assign({ alpha: alpha < 1 ? alpha : undefined, ghost: !!ghost }, artOpts));
      else boxFallback(ctx, fp, 20 + 18 * Math.max(o.w, o.h), o.fixed ? '#c08a3e' : '#8fa6b8', alpha);
      const H = artHeight(art, o.w, o.h), d = o.gx + o.gy + (o.w + o.h) / 2;
      if (!ghost) {
        const inset = (fp.right[0] - fp.left[0]) * 0.12;
        // the box is only a fallback: with building art, hitTest checks the drawn silhouette (BUILD_ART.hit)
        hitBoxes.push({ x0: fp.left[0] + inset, x1: fp.right[0] - inset, y0: fp.cy - H, y1: fp.cy, d, obj: o, art: drawn ? art : null, fp, opts: artOpts });
      }
      if (ov && prod) {
        const top = fp.cy - H * 0.92;
        if (ready) ov.push({ type: 'res', obj: o, x: fp.cx, y: top - 22, icon: resIcon(prod.res) });
        else if (prod.state === 'producing') ov.push({ type: 'bar', x: fp.cx, y: top - 4, p: prod.progress || 0, rem: prod.remainingSec });
        else if (prod.state === 'idle') ov.push({ type: 'idle', obj: o, x: fp.cx, y: top - 10 });
      }
      if (ov && highlightId != null && o.id === highlightId && (o.level || 1) > 1 && !o.fixed) ov.push({ type: 'lvl', x: fp.bottom[0], y: fp.bottom[1] + 16, level: o.level });
    }
    function drawObject(o, T, now, alpha, ov, wkey, preview) {
      if (o.type === 'enclosure') drawEnclosure(o, T, now, alpha, wkey, ov, preview);
      else drawBuilding(o, T, now, alpha, ov, preview);
    }

    // ------------------------------------------------------------ drawing: overlays (bubbles, timers…)
    function bubbleScale() { return clamp(0.85 / cam.z, 0.9, 1.7); }
    function drawBubbleShape(x, y, r, iconName, accent) {
      ctx.beginPath();
      ctx.moveTo(x - r * 0.42, y + r * 0.78); ctx.lineTo(x, y + r * 1.45); ctx.lineTo(x + r * 0.42, y + r * 0.78);
      ctx.arc(x, y, r, PI * 0.36, PI * 0.64, true);
      ctx.closePath();
      ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.save(); ctx.translate(1.5, 2.5); ctx.fill(); ctx.restore();
      const gr = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r * 1.2);
      gr.addColorStop(0, '#ffffff'); gr.addColorStop(1, accent || '#dfe9ef');
      ctx.fillStyle = gr; ctx.fill();
      ctx.strokeStyle = '#1e2a30'; ctx.lineWidth = 2; ctx.stroke();
      icon(ctx, iconName, x, y, r * 1.3);
      ctx.beginPath(); ctx.ellipse(x - r * 0.38, y - r * 0.5, r * 0.32, r * 0.16, -0.6, 0, TAU); ctx.fillStyle = 'rgba(255,255,255,.75)'; ctx.fill();
    }
    function drawOverlays(ov, T) {
      const k = bubbleScale();
      ov.sort((a, b) => a.y - b.y);
      for (const b of ov) {
        const bob = Math.sin(T * 3.2 + b.x * 0.031) * 3 * k;
        if (b.type === 'coin' || b.type === 'res') {
          const r = 15 * k, y = b.y + bob;
          drawBubbleShape(b.x, y, r, b.type === 'coin' ? 'coin' : b.icon, b.type === 'coin' ? '#ffe9a8' : '#d6f2c6');
          hitBubbles.push({ x: b.x, y, r: r + 8 * k, obj: b.obj });
        } else if (b.type === 'hatch') {
          const jump = Math.abs(Math.sin(T * 4)) * 7 * k, y = b.y - jump, w = 74 * k, h = 26 * k;
          ctx.save();
          ctx.fillStyle = 'rgba(0,0,0,.3)'; rrect(ctx, b.x - w / 2 + 2, y - h / 2 + 3, w, h, h / 2); ctx.fill();
          rrect(ctx, b.x - w / 2, y - h / 2, w, h, h / 2);
          const gr = ctx.createLinearGradient(0, y - h / 2, 0, y + h / 2);
          gr.addColorStop(0, '#ffe45a'); gr.addColorStop(1, '#f39a12');
          ctx.fillStyle = gr; ctx.fill(); ctx.strokeStyle = '#4a2a00'; ctx.lineWidth = 2; ctx.stroke();
          ctx.beginPath(); ctx.moveTo(b.x - 6 * k, y + h / 2 - 1); ctx.lineTo(b.x, y + h / 2 + 7 * k); ctx.lineTo(b.x + 6 * k, y + h / 2 - 1); ctx.closePath();
          ctx.fillStyle = '#f39a12'; ctx.fill(); ctx.stroke();
          text(ctx, 'Éclore !', b.x, y + 1, 13 * k, '#ffffff', '#6a3a00');
          ctx.restore();
          hitBubbles.push({ x: b.x, y, r: Math.max(w * 0.6, 30 * k), obj: b.obj });
        } else if (b.type === 'timer') {
          const w = 54 * k, h = 18 * k, y = b.y;
          ctx.fillStyle = 'rgba(16,22,26,.82)'; rrect(ctx, b.x - w / 2, y - h / 2, w, h, h / 2); ctx.fill();
          ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1; ctx.stroke();
          icon(ctx, 'clock', b.x - w / 2 + h * 0.55, y, h * 0.8);
          text(ctx, b.text, b.x + h * 0.3, y + 0.5, 11 * k, '#ffffff', null, FONT_D);
        } else if (b.type === 'bar') {
          const w = 46 * k, h = 9 * k, y = b.y, x0 = b.x - w / 2;
          ctx.fillStyle = 'rgba(10,14,16,.85)'; rrect(ctx, x0 - 2, y - h / 2 - 2, w + 4, h + 4, (h + 4) / 2); ctx.fill();
          const gr = ctx.createLinearGradient(0, y - h / 2, 0, y + h / 2);
          gr.addColorStop(0, '#9cf06a'); gr.addColorStop(1, '#3f9a26');
          const pw = Math.max(h, w * clamp(b.p, 0, 1));
          ctx.fillStyle = gr; rrect(ctx, x0, y - h / 2, pw, h, h / 2); ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,.35)'; rrect(ctx, x0 + 2, y - h / 2 + 1, Math.max(0, pw - 4), h * 0.3, h * 0.15); ctx.fill();
          icon(ctx, 'clock', x0 - 7 * k, y, 13 * k);
        } else if (b.type === 'idle') {
          const pulse = 1 + Math.sin(T * 4) * 0.06, w = 62 * k * pulse, h = 17 * k * pulse;
          ctx.fillStyle = 'rgba(0,0,0,.3)'; rrect(ctx, b.x - w / 2 + 1.5, b.y - h / 2 + 2, w, h, 4 * k); ctx.fill();
          rrect(ctx, b.x - w / 2, b.y - h / 2, w, h, 4 * k);
          ctx.fillStyle = '#f2c21b'; ctx.fill(); ctx.strokeStyle = '#1b1b1b'; ctx.lineWidth = 1.6; ctx.stroke();
          text(ctx, 'ACTIVER', b.x, b.y + 0.5, 10 * k, '#1b1b1b', null);
          if (b.obj) hitBubbles.push({ x: b.x, y: b.y, hw: w / 2 + 6 * k, hh: h / 2 + 8 * k, obj: b.obj });   // tap → UI.tapBubble → order picker
        } else if (b.type === 'lvl') {
          const w = 50 * k, h = 18 * k;
          ctx.fillStyle = 'rgba(16,22,26,.88)'; rrect(ctx, b.x - w / 2, b.y - h / 2, w, h, 5 * k); ctx.fill();
          ctx.strokeStyle = '#f2c21b'; ctx.lineWidth = 1.5; ctx.stroke();
          text(ctx, 'Niv. ' + b.level, b.x, b.y + 0.5, 11 * k, '#ffe36a', null);
        }
      }
    }
    function drawFloats(T) {
      const k = bubbleScale();
      floats = floats.filter(f => T - f.t0 < 1.7 && T >= f.t0 - 0.05);
      for (const f of floats) {
        const a = clamp((T - f.t0) / 1.7, 0, 1), rise = (1 - Math.pow(1 - a, 3)) * 56 * k, pop = a < 0.12 ? 0.6 + a / 0.12 * 0.4 : 1;
        ctx.save();
        ctx.globalAlpha *= a > 0.6 ? 1 - (a - 0.6) / 0.4 : 1;
        ctx.translate(f.x, f.y - rise); ctx.scale(pop * k, pop * k);
        ctx.font = `20px ${FONT_D}`;
        const tw = ctx.measureText(f.text).width, iw = f.icon ? 24 : 0, x0 = -(tw + iw) / 2;
        if (f.icon) icon(ctx, f.icon, x0 + 10, 0, 22);
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
        ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(0,0,0,.85)'; ctx.strokeText(f.text, x0 + iw, 1);
        ctx.fillStyle = f.color; ctx.fillText(f.text, x0 + iw, 1);
        ctx.restore();
      }
    }
    function drawParts(T) {
      parts = parts.filter(p => T - p.t0 < p.life);
      for (const p of parts) {
        const a = T - p.t0;
        if (a < 0) continue;
        const k = a / p.life, x = p.x + p.vx * a, y = p.y + p.vy * a + 0.5 * p.g * a * a, fade = 1 - k;
        ctx.save();
        if (p.type === 'ring') {
          const r = p.r1 * (0.2 + 0.8 * (1 - Math.pow(1 - k, 2)));
          ctx.globalAlpha *= fade; ctx.beginPath(); ctx.ellipse(p.x, p.y, r, r * 0.5, 0, 0, TAU);
          ctx.strokeStyle = p.col; ctx.lineWidth = 5 * fade + 1; ctx.stroke();
        } else if (p.type === 'column') {
          const w = p.size * (k < 0.2 ? k / 0.2 : 1) * (1 - k * 0.5), al = k < 0.2 ? k / 0.2 : fade;
          ctx.globalCompositeOperation = 'lighter';
          const gr = ctx.createLinearGradient(p.x - w, 0, p.x + w, 0);
          gr.addColorStop(0, 'rgba(160,240,255,0)'); gr.addColorStop(0.5, `rgba(230,255,255,${0.75 * al})`); gr.addColorStop(1, 'rgba(160,240,255,0)');
          ctx.fillStyle = gr; ctx.fillRect(p.x - w, p.y - 420, w * 2, 430);
          ctx.beginPath(); ctx.ellipse(p.x, p.y, w * 1.4, w * 0.6, 0, 0, TAU); ctx.fillStyle = `rgba(200,250,255,${0.5 * al})`; ctx.fill();
        } else if (p.type === 'shard') {
          ctx.translate(x, y); ctx.rotate(p.rot + p.vr * a); ctx.globalAlpha *= Math.min(1, fade * 2);
          ctx.beginPath(); ctx.moveTo(-p.size, p.size * 0.6); ctx.lineTo(0, -p.size); ctx.lineTo(p.size * 0.8, p.size * 0.5); ctx.closePath();
          ctx.fillStyle = p.col; ctx.fill(); ctx.strokeStyle = '#8a7a58'; ctx.lineWidth = 0.8; ctx.stroke();
        } else if (p.type === 'puff') {
          const r = p.size * (0.6 + k * 1.2);
          ctx.globalAlpha *= 0.75 * fade; ctx.beginPath(); ctx.arc(x, y - 6, r, 0, TAU); ctx.fillStyle = p.col; ctx.fill();
        } else if (p.type === 'bubble') {
          ctx.globalAlpha *= fade; ctx.beginPath(); ctx.arc(x, y - 8, p.size * 0.4, 0, TAU);
          ctx.strokeStyle = 'rgba(220,250,255,.9)'; ctx.lineWidth = 1.2; ctx.stroke();
        } else {
          ctx.globalAlpha *= Math.min(1, fade * 1.6);
          ctx.globalCompositeOperation = 'lighter';
          if (p.type === 'star') { starPath(ctx, x, y, p.size * 1.5 * (1 - k * 0.4), 0.42); ctx.fillStyle = p.col; ctx.fill(); }
          else { ctx.beginPath(); ctx.arc(x, y, p.size * 0.6, 0, TAU); ctx.fillStyle = p.col; ctx.fill(); }
        }
        ctx.restore();
      }
    }

    // ------------------------------------------------------------ ground marks: highlight & placement
    function drawHighlight(T, objs) {
      if (highlightId == null) return;
      const o = objs.find(q => q.id === highlightId);
      if (!o || !Number.isFinite(o.gx)) return;
      const q = new Path2D(), pulse = 0.5 + 0.5 * Math.sin(T * 5);
      quadIso(q, o.gx - 0.04, o.gy - 0.04, o.gx + o.w + 0.04, o.gy + o.h + 0.04);
      ctx.save();
      ctx.fillStyle = `rgba(255,230,90,${0.16 + 0.1 * pulse})`; ctx.fill(q);
      ctx.strokeStyle = `rgba(255,220,60,${0.55 + 0.4 * pulse})`; ctx.lineWidth = 4; ctx.stroke(q);
      ctx.restore();
    }
    function drawHighlightTop(T, objs) {
      if (highlightId == null) return;
      const o = objs.find(q => q.id === highlightId);
      if (!o || !Number.isFinite(o.gx)) return;
      const fp = footprint(o.gx, o.gy, o.w, o.h), pulse = 0.5 + 0.5 * Math.sin(T * 5), L = 0.28;
      ctx.save();
      ctx.strokeStyle = `rgba(255,226,70,${0.75 + 0.25 * pulse})`; ctx.lineWidth = 3.5; ctx.lineCap = 'round';
      ctx.beginPath();
      for (const [c, a, b] of [[fp.top, fp.left, fp.right], [fp.right, fp.top, fp.bottom], [fp.bottom, fp.right, fp.left], [fp.left, fp.bottom, fp.top]]) {
        ctx.moveTo(lerp(c[0], a[0], L), lerp(c[1], a[1], L));
        ctx.lineTo(c[0], c[1]); ctx.lineTo(lerp(c[0], b[0], L), lerp(c[1], b[1], L));
      }
      ctx.stroke();
      ctx.restore();
    }
    function drawPlacementMark(T) {
      const p = placement;
      if (!p) return;
      const ok = p.valid, q = new Path2D(), pulse = 0.5 + 0.5 * Math.sin(T * 6);
      quadIso(q, p.gx, p.gy, p.gx + p.w, p.gy + p.h);
      ctx.save();
      ctx.fillStyle = ok ? `rgba(70,225,100,${0.32 + 0.1 * pulse})` : `rgba(235,55,45,${0.36 + 0.1 * pulse})`; ctx.fill(q);
      ctx.beginPath();
      for (let i = 1; i < p.w; i++) { ctx.moveTo(wx(p.gx + i, p.gy), wy(p.gx + i, p.gy)); ctx.lineTo(wx(p.gx + i, p.gy + p.h), wy(p.gx + i, p.gy + p.h)); }
      for (let j = 1; j < p.h; j++) { ctx.moveTo(wx(p.gx, p.gy + j), wy(p.gx, p.gy + j)); ctx.lineTo(wx(p.gx + p.w, p.gy + j), wy(p.gx + p.w, p.gy + j)); }
      ctx.strokeStyle = ok ? 'rgba(220,255,220,.45)' : 'rgba(255,220,210,.45)'; ctx.lineWidth = 1; ctx.stroke();
      ctx.strokeStyle = ok ? '#c8ffb0' : '#ffb0a0'; ctx.lineWidth = 3; ctx.stroke(q);
      ctx.restore();
    }
    function drawGhost(T, now, objs) {
      const p = placement;
      if (!p) return;
      const gh = p.ghost || {}, fp = footprint(p.gx, p.gy, p.w, p.h);
      const a = 0.72;
      if (gh.type === 'move' && gh.obj) {
        const src = objs.find(o => o.id === gh.obj.id) || gh.obj;
        const copy = Object.assign({}, src, { gx: p.gx, gy: p.gy });
        if (isRoad(copy)) ghostRoad(fp, a); else drawObject(copy, T, now, a, null, 'ghost:' + src.id, false);
      } else if (gh.type === 'enclosure') {
        drawEnclosure({ id: -1, type: 'enclosure', speciesId: gh.speciesId, gx: p.gx, gy: p.gy, w: p.w, h: p.h, hatched: true, level: 1 }, T, now, a, 'ghost:new', null, true);
      } else if (gh.buildingId && isRoadId(gh.buildingId)) ghostRoad(fp, a);
      else if (gh.buildingId) drawBuilding({ id: -1, type: 'building', buildingId: gh.buildingId, gx: p.gx, gy: p.gy, w: p.w, h: p.h, level: 1 }, T, now, a, null, true);
      // footprint outline on top so it stays readable through the preview
      const q = new Path2D();
      quadIso(q, p.gx, p.gy, p.gx + p.w, p.gy + p.h);
      ctx.save(); ctx.setLineDash([8, 6]); ctx.lineDashOffset = -T * 20;
      ctx.strokeStyle = p.valid ? 'rgba(200,255,180,.9)' : 'rgba(255,170,150,.95)'; ctx.lineWidth = 2; ctx.stroke(q);
      ctx.restore();
      // light tint over the preview + four ground arrows pointing out of the footprint edges
      ctx.save();
      ctx.fillStyle = p.valid ? 'rgba(90,230,110,.16)' : 'rgba(240,60,50,.2)'; ctx.fill(q);
      const k = bubbleScale(), bounce = 3 + Math.sin(T * 5) * 3;
      const mids = [[p.gx + p.w / 2, p.gy, 0, -1], [p.gx + p.w, p.gy + p.h / 2, 1, 0], [p.gx + p.w / 2, p.gy + p.h, 0, 1], [p.gx, p.gy + p.h / 2, -1, 0]];
      for (const [u, v, du, dv] of mids) {
        const x = wx(u, v), y = wy(u, v), dx = (du - dv) * HW, dy = (du + dv) * HH, L = Math.hypot(dx, dy), ux = dx / L, uy = dy / L;
        const ox = x + ux * (12 + bounce) * k, oy = y + uy * (12 + bounce) * k, nx = -uy, ny = ux, s = 9 * k;
        ctx.beginPath();
        ctx.moveTo(ox + ux * s * 1.6, oy + uy * s * 1.6); ctx.lineTo(ox + nx * s, oy + ny * s); ctx.lineTo(ox - nx * s, oy - ny * s); ctx.closePath();
        ctx.fillStyle = p.valid ? '#6fe06a' : '#ff5a4a'; ctx.fill();
        ctx.strokeStyle = 'rgba(10,20,10,.85)'; ctx.lineWidth = 1.6; ctx.stroke();
      }
      ctx.restore();
    }
    function ghostRoad(fp, a) {
      const st = ROAD_STYLE[view.park] || ROAD_STYLE.land, p = placement;
      const q = new Path2D(), s = new Path2D();
      quadIso(q, p.gx + 0.07, p.gy + 0.07, p.gx + p.w - 0.07, p.gy + p.h - 0.07);
      quadIso(s, p.gx + 0.15, p.gy + 0.15, p.gx + p.w - 0.15, p.gy + p.h - 0.15);
      ctx.save(); ctx.globalAlpha *= a;
      ctx.fillStyle = st.kerb; ctx.fill(q); ctx.fillStyle = st.base; ctx.fill(s);
      ctx.restore();
    }

    // ------------------------------------------------------------ ambient life
    function pattern(name) {
      if (pats[name]) return pats[name];
      const src = name === 'caustic' ? caustics() : name.slice(0, 3) === 'bg_' ? bgTexture(name.slice(3)) : ripples();
      try { pats[name] = ctx.createPattern(src, 'repeat'); } catch (e) { pats[name] = null; }
      return pats[name];
    }
    function ambientState(park) {
      if (amb[park]) return amb[park];
      const T0 = TERRAIN.generate(park), R = rng(4242 + park.length * 17), A = { park };
      const core = [], pond = [];
      for (let y = 0; y < MAP; y++) for (let x = 0; x < MAP; x++) {
        const c = T0.tiles[y * MAP + x];
        if (c === 1) core.push([x, y]); else if (c === 2 && (!T0.water || T0.water[y * MAP + x] === 1)) pond.push([x, y]);
      }
      const pick = list => { const t = list[(R() * list.length) | 0] || [12, 12]; return [t[0] + R(), t[1] + R()]; };
      if (park === 'land') {
        const cols = ['#ffd23a', '#ff8fb0', '#8fd3ff', '#ffffff', '#ff9a3c', '#c79bff'];
        A.flies = [];
        for (let i = 0; i < 10; i++) { const p = pick(core); A.flies.push({ u: p[0], v: p[1], r: 0.8 + R() * 1.8, sp: 0.18 + R() * 0.25, ph: R() * TAU, col: cols[i % cols.length] }); }
        A.motes = [];
        const sc = T0.scenery.filter(s => s.kind === 'fern' || s.kind === 'bush' || s.kind === 'broadleaf');
        for (let i = 0; i < 30 && sc.length; i++) { const s = sc[(R() * sc.length) | 0]; A.motes.push({ x: wx(s.gx, s.gy), y: wy(s.gx, s.gy) - 20 - R() * 30, ph: R() * TAU, r: 10 + R() * 16 }); }
        A.clouds = [0, 1, 2].map(i => ({ ph: R() * 3000, y: 200 + i * 330, rx: 260 + R() * 140, ry: 110 + R() * 50, sp: 9 + R() * 6 }));
      } else if (park === 'sea') {
        A.bubbles = [];
        A.fish = [0, 1, 2].map(i => ({ cu: 8 + R() * 8, cv: 8 + R() * 8, rx: 5 + R() * 4, ry: 4 + R() * 4, sp: (0.035 + R() * 0.03) * (i % 2 ? -1 : 1), ph: R() * TAU,
          h: 90 + R() * 60, col: ['#0d3a58', '#1a4f6e', '#123047'][i], fish: Array.from({ length: 6 + ((R() * 5) | 0) }, () => [(R() - 0.5) * 60, (R() - 0.5) * 26, R() * TAU, 0.8 + R() * 0.5]) }));
        A.spots = T0.scenery.filter(s => s.kind === 'coral_brain' || s.kind === 'anemone' || s.kind === 'sea_rock').map(s => [wx(s.gx, s.gy), wy(s.gx, s.gy)]);
        for (let i = 0; i < 30; i++) { const p = pick(core); A.spots.push([wx(p[0], p[1]), wy(p[0], p[1])]); }
      } else {
        A.snow = Array.from({ length: 220 }, () => ({ x: R(), y: R(), z: 0.25 + R() * 0.75, ph: R() * TAU }));
        A.glints = Array.from({ length: 14 }, () => { const p = pick(pond.length ? pond : core); return [wx(p[0], p[1]), wy(p[0], p[1]), R() * TAU]; });
      }
      amb[park] = A;
      return A;
    }
    function waterFx(T, tp, park, vis) {
      if (park === 'sea') {
        const pat = pattern('caustic');
        if (!pat) return;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        for (const [sc, spx, spy, al] of [[1.6, 7, 3, 0.12], [2.3, -5, 4.5, 0.08]]) {
          ctx.save();
          ctx.globalAlpha = al;
          const ox = Math.floor(vis[0] / (160 * sc)) * 160 * sc, oy = Math.floor(vis[1] / (80 * sc)) * 80 * sc;
          ctx.translate(fract(T * spx / (160 * sc)) * 160 * sc + ox - 160 * sc, fract(T * spy / (80 * sc)) * 80 * sc + oy - 80 * sc);
          ctx.scale(sc, sc * 0.5);
          ctx.fillStyle = pat; ctx.fillRect(0, 0, (vis[2] - vis[0]) / sc + 480, (vis[3] - vis[1]) * 2 / sc + 480);
          ctx.restore();
        }
        ctx.restore();
      } else {
        const path = park === 'land' ? tp.pond : tp.sea;
        if (!path) return;
        const pat = pattern('ripple');
        if (!pat) return;
        ctx.save();
        ctx.clip(path);
        ctx.globalAlpha = park === 'land' ? 0.45 : 0.5;
        ctx.translate(fract(T * 0.05) * 128 + tp.minX, Math.sin(T * 0.6) * 4 + tp.minY);
        ctx.fillStyle = pat; ctx.fillRect(-128, -64, tp.w + 256, tp.h + 128);
        ctx.restore();
        if (park === 'ice') {
          const A = ambientState(park);
          for (const [x, y, ph] of A.glints) {
            const s = Math.max(0, Math.sin(T * 1.3 + ph)) ** 6;
            if (s < 0.05) continue;
            ctx.save(); ctx.globalAlpha = s; ctx.globalCompositeOperation = 'lighter';
            starPath(ctx, x, y, 6 * s + 2, 0.25); ctx.fillStyle = '#ffffff'; ctx.fill();
            ctx.restore();
          }
        }
      }
    }
    function ambientWorld(T, vis, park) {
      const A = ambientState(park), inV = (x, y, m) => x > vis[0] - m && x < vis[2] + m && y > vis[1] - m && y < vis[3] + m;
      if (park === 'land') {
        // drifting cloud shadows
        for (const c of A.clouds) {
          const x = ((T * c.sp + c.ph) % 3400) - 1700, y = c.y + Math.sin(T * 0.05 + c.ph) * 40;
          if (!inV(x, y, c.rx)) continue;
          ctx.save(); ctx.translate(x, y); ctx.scale(1, c.ry / c.rx);
          const gr = ctx.createRadialGradient(0, 0, 0, 0, 0, c.rx);
          gr.addColorStop(0, 'rgba(20,40,10,.11)'); gr.addColorStop(1, 'rgba(20,40,10,0)');
          ctx.fillStyle = gr; ctx.fillRect(-c.rx, -c.rx, c.rx * 2, c.rx * 2);
          ctx.restore();
        }
        // pollen / fireflies over the jungle
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        for (const m of A.motes) {
          const x = m.x + Math.sin(T * 0.4 + m.ph) * m.r, y = m.y + Math.cos(T * 0.3 + m.ph * 1.3) * m.r * 0.5, a = 0.35 + 0.35 * Math.sin(T * 2.2 + m.ph);
          if (!inV(x, y, 10) || a <= 0.02) continue;
          const gr = ctx.createRadialGradient(x, y, 0, x, y, 6);
          gr.addColorStop(0, `rgba(255,250,170,${a})`); gr.addColorStop(1, 'rgba(255,240,120,0)');
          ctx.fillStyle = gr; ctx.fillRect(x - 6, y - 6, 12, 12);
        }
        ctx.restore();
        // butterflies
        for (const f of A.flies) {
          const u = f.u + Math.sin(T * f.sp + f.ph) * f.r, v = f.v + Math.cos(T * f.sp * 0.8 + f.ph * 1.3) * f.r;
          const gx = wx(u, v), gy = wy(u, v), hgt = 34 + Math.sin(T * 1.7 + f.ph) * 10;
          if (!inV(gx, gy, 60)) continue;
          const dir = Math.cos(T * f.sp + f.ph) - Math.sin(T * f.sp * 0.8 + f.ph * 1.3) >= 0 ? 1 : -1;
          ctx.beginPath(); ctx.ellipse(gx, gy, 4, 1.6, 0, 0, TAU); ctx.fillStyle = 'rgba(0,0,0,.12)'; ctx.fill();
          const flap = Math.abs(Math.sin(T * 15 + f.ph)), x = gx, y = gy - hgt;
          ctx.save(); ctx.translate(x, y); ctx.scale(dir, 1);
          for (const s of [-1, 1]) {
            ctx.beginPath(); ctx.ellipse(s * (1 + 3.2 * flap), -1.5, 3.4 * flap + 0.5, 3.6, s * 0.3, 0, TAU); ctx.fillStyle = f.col; ctx.fill();
            ctx.beginPath(); ctx.ellipse(s * (1 + 2.2 * flap), 2.4, 2.2 * flap + 0.4, 2.2, -s * 0.3, 0, TAU); ctx.fill();
          }
          ctx.strokeStyle = '#2a1a10'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(0, -3.5); ctx.lineTo(0, 3.5); ctx.stroke();
          ctx.restore();
        }
      } else if (park === 'sea') {
        // fish schools gliding over the seabed (with faint shadows)
        for (const s of A.fish) {
          const a = T * s.sp + s.ph, u = s.cu + Math.cos(a) * s.rx, v = s.cv + Math.sin(a) * s.ry;
          const du = -Math.sin(a) * s.rx * s.sp, dv = Math.cos(a) * s.ry * s.sp, dir = du - dv >= 0 ? 1 : -1;
          const bx = wx(u, v), by = wy(u, v);
          if (!inV(bx, by - s.h, 120)) continue;
          for (const [ox, oy, ph, sz] of s.fish) {
            const x = bx + ox + Math.sin(T * 1.3 + ph) * 4, y = by - s.h + oy + Math.sin(T * 2 + ph) * 3;
            ctx.beginPath(); ctx.ellipse(x, by + oy * 0.5 + 6, 6 * sz, 1.8 * sz, 0, 0, TAU); ctx.fillStyle = 'rgba(0,15,35,.12)'; ctx.fill();
            ctx.save(); ctx.translate(x, y); ctx.scale(dir * sz, sz);
            const wig = Math.sin(T * 10 + ph) * 1.5;
            ctx.beginPath(); ctx.ellipse(0, 0, 8, 3.2, 0, 0, TAU); ctx.moveTo(-6, 0); ctx.lineTo(-12, -4 + wig); ctx.lineTo(-12, 4 + wig); ctx.closePath();
            ctx.fillStyle = s.col; ctx.globalAlpha *= 0.55; ctx.fill();
            ctx.beginPath(); ctx.ellipse(2, -1, 4, 1, 0, 0, TAU); ctx.fillStyle = 'rgba(160,230,255,.6)'; ctx.fill();
            ctx.restore();
          }
        }
        // rising bubbles
        while (A.bubbles.length < 46 && A.spots.length) {
          const s = A.spots[(Math.random() * A.spots.length) | 0];
          A.bubbles.push({ x: s[0] + (Math.random() - 0.5) * 20, y: s[1] - 10, t0: T + Math.random() * 6, life: 3.5 + Math.random() * 4, r: 1.2 + Math.random() * 2.8, ph: Math.random() * TAU, rise: 120 + Math.random() * 140 });
        }
        ctx.save();
        for (let i = A.bubbles.length - 1; i >= 0; i--) {
          const b = A.bubbles[i], a = (T - b.t0) / b.life;
          if (a > 1 || a < -2) { A.bubbles.splice(i, 1); continue; }
          if (a < 0) continue;
          const x = b.x + Math.sin(T * 3 + b.ph) * 3, y = b.y - a * b.rise;
          if (!inV(x, y, 10)) continue;
          ctx.globalAlpha = Math.min(1, (1 - a) * 2) * 0.8;
          ctx.beginPath(); ctx.arc(x, y, b.r, 0, TAU); ctx.strokeStyle = 'rgba(210,248,255,.9)'; ctx.lineWidth = 1; ctx.stroke();
          ctx.beginPath(); ctx.arc(x - b.r * 0.35, y - b.r * 0.35, b.r * 0.3, 0, TAU); ctx.fillStyle = '#ffffff'; ctx.fill();
        }
        ctx.restore();
      }
    }
    function ambientScreen(T, park) {
      const W = cssW, H = cssH;
      if (park === 'sea') {
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        for (let i = 0; i < 6; i++) {
          const x = W * (-0.05 + i * 0.21) + Math.sin(T * 0.22 + i * 1.7) * 50, w = 40 + (i % 3) * 34, sl = H * 0.45;
          const a = 0.55 + 0.45 * Math.sin(T * 0.5 + i * 2.1);
          const gr = ctx.createLinearGradient(0, 0, 0, H * 0.9);
          gr.addColorStop(0, `rgba(170,240,255,${0.16 * a})`); gr.addColorStop(1, 'rgba(170,240,255,0)');
          ctx.fillStyle = gr;
          ctx.beginPath(); ctx.moveTo(x, -5); ctx.lineTo(x + w, -5); ctx.lineTo(x + w * 1.6 + sl, H); ctx.lineTo(x + sl - w * 0.2, H); ctx.closePath(); ctx.fill();
        }
        ctx.restore();
        const gr = ctx.createLinearGradient(0, 0, 0, H);
        gr.addColorStop(0, 'rgba(120,230,255,.12)'); gr.addColorStop(0.4, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,15,45,.25)');
        ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
      } else if (park === 'ice') {
        const A = ambientState(park), n = Math.min(A.snow.length, 60 + Math.round(W * H / 6000));
        ctx.save();
        for (let i = 0; i < n; i++) {
          const f = A.snow[i], sp = 16 + f.z * 38;
          const y = ((f.y * (H + 20) + T * sp) % (H + 20)) - 10;
          const x = (((f.x * (W + 40) + Math.sin(T * 0.8 + f.ph) * 16 * f.z + T * 10 * f.z) % (W + 40)) + W + 40) % (W + 40) - 20;
          ctx.globalAlpha = 0.45 + f.z * 0.5;
          ctx.beginPath(); ctx.arc(x, y, 0.7 + f.z * 2.2, 0, TAU); ctx.fillStyle = '#ffffff'; ctx.fill();
        }
        ctx.restore();
      } else {
        const gr = ctx.createLinearGradient(0, 0, W * 0.7, H * 0.7);
        gr.addColorStop(0, 'rgba(255,236,160,.13)'); gr.addColorStop(1, 'rgba(255,236,160,0)');
        ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
      }
      // vignette
      const r0 = Math.min(W, H) * 0.42, r1 = Math.hypot(W, H) * 0.62;
      const vg = ctx.createRadialGradient(W / 2, H / 2, r0, W / 2, H / 2, r1);
      const vc = park === 'sea' ? '0,18,48' : park === 'ice' ? '50,80,120' : '15,30,8';
      vg.addColorStop(0, `rgba(${vc},0)`); vg.addColorStop(1, `rgba(${vc},${park === 'sea' ? 0.5 : park === 'ice' ? 0.22 : 0.32})`);
      ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
    }

    // ------------------------------------------------------------ render
    view.render = function (tArg) {
      const T = normTime(tArg);
      dt = lastT ? clamp(T - lastT, 0, 0.1) : 0.016;
      lastT = T;
      const [mw, mh] = measure();
      if (!cssW || Math.abs(mw - cssW) > 0.5 || Math.abs(mh - cssH) > 0.5) resize();
      if (camAnim) {
        const k = sstep((T - camAnim.t0) / camAnim.dur);
        cam.x = lerp(camAnim.fx, camAnim.tx, k); cam.y = lerp(camAnim.fy, camAnim.ty, k);
        if (k >= 1) camAnim = null;
        clampCam();
      }
      const park = view.park, P = PAL[park] || PAL.land, now = nowMs();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = P.bg; ctx.fillRect(0, 0, canvas.width, canvas.height);
      const k = dpr * cam.z;
      ctx.setTransform(k, 0, 0, k, (cssW / 2 - cam.x * cam.z) * dpr, (cssH / 2 - cam.y * cam.z) * dpr);
      const tl = toWorld(0, 0), br = toWorld(cssW, cssH), vis = [tl[0], tl[1], br[0], br[1]];
      const inView = (x, y, mx, myTop, myBot) => x > vis[0] - mx && x < vis[2] + mx && y > vis[1] - (myBot || 20) && y < vis[3] + (myTop || 200);
      hitBubbles = []; hitBoxes = [];
      const bgp = pattern('bg_' + park);
      if (bgp) { ctx.fillStyle = bgp; ctx.fillRect(vis[0] - 4, vis[1] - 4, vis[2] - vis[0] + 8, vis[3] - vis[1] + 8); }
      let tp = null;
      try { tp = terrainPaint(park); } catch (e) { if (!view._warned) { view._warned = true; console.error('[ISO] terrain', e); } }
      if (tp) {
        ctx.drawImage(tp.canvas, tp.minX, tp.minY);
        waterFx(T, tp, park, vis);
      }
      const objs = currentObjects();
      drawRoads(ctx, objs, park);
      drawHighlight(T, objs);
      drawPlacementMark(T);

      // depth-sorted scenery + objects
      const T0 = TERRAIN.generate(park), items = [];
      for (const list of [T0.scenery, T0.outer]) for (const s of list) {
        const x = wx(s.gx, s.gy), y = wy(s.gx, s.gy);
        if (inView(x, y, 110, 260, 30)) items.push({ d: s.gx + s.gy, s, x, y });
      }
      for (const L of T0.landmarks || []) {
        const fp = footprint(L.gx, L.gy, L.w, L.h);
        if (inView(fp.cx, fp.cy, 200, 300, 60)) items.push({ d: L.gx + L.gy + (L.w + L.h) / 2, L, fp });
      }
      const moving = placement && placement.ghost && placement.ghost.type === 'move' && placement.ghost.obj ? placement.ghost.obj.id : null;
      for (const o of objs) {
        if (!Number.isFinite(o.gx) || isRoad(o)) continue;
        const fp = footprint(o.gx, o.gy, o.w, o.h);
        if (!inView(fp.cx, fp.cy, (o.w + o.h) * HW, 420, (o.w + o.h) * HH + 40)) continue;
        items.push({ d: o.gx + o.gy + (o.w + o.h) / 2, o });
      }
      items.sort((a, b) => a.d - b.d || (a.o ? 1 : 0) - (b.o ? 1 : 0));
      const ov = [];
      for (const it of items) {
        try {
          if (it.s) drawScenery(ctx, it.s.kind, it.x, it.y, TW, T, it.s.seed);
          else if (it.L) {
            if (PC.BUILD_ART && PC.BUILD_ART.has && PC.BUILD_ART.has(it.L.art)) PC.BUILD_ART.draw(ctx, it.L.art, it.fp, T, { biome: park });
          } else drawObject(it.o, T, now, it.o.id === moving ? 0.35 : 1, it.o.id === moving ? null : ov, it.o.id, false);
        } catch (e) {
          if (!view._warnedDraw) { view._warnedDraw = true; console.error('[ISO] draw', e); }
        }
      }
      ambientWorld(T, vis, park);
      drawHighlightTop(T, objs);
      try { drawGhost(T, now, objs); } catch (e) { if (!view._warnedGhost) { view._warnedGhost = true; console.error('[ISO] ghost', e); } }
      drawOverlays(ov, T);
      drawParts(T);
      drawFloats(T);

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ambientScreen(T, park);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    };

    // initial park
    const st = engine() && engine().state;
    view.park = st && PAL[st.current] ? st.current : 'land';
    resize();
    return view;
  };
})(window.PC = window.PC || {});
