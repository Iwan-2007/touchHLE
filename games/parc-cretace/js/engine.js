/* Crétacé Park — game engine → PC.ENGINE (SPEC §5 + §11 items 3, 4, 8–11).
   Owns the whole game state: resources, park objects, timers (eggs, productions, research,
   expeditions), story + side missions, tournament records and medals, card packs, limited offers,
   building levels and deliveries, save/load with repair.
   Pure logic, no DOM. Every timer is a timestamp taken from ENGINE.now(), so the park keeps living
   while the page is closed. Every mutation emits 'change'. Public functions never throw: invalid
   actions return { ok: false, reason: '<texte en français>' }. */
(function (PC) {
  'use strict';

  const ENGINE = PC.ENGINE = {};
  const SAVE_KEY = 'cretace-park-v2';
  const VERSION = 2;
  const PARKS = ['land', 'sea', 'ice'];
  // Object ids are unique across parks (each park numbers from its own base).
  const ID_BASE = { land: 1, sea: 1000001, ice: 2000001 };
  const AUTOSAVE_MS = 10000;
  const RES_KEYS = ['coins', 'dollars', 'food_land', 'food_sea', 'food_ice'];
  const RES_WORDS = { coins: 'pièces', dollars: 'dollars', food_land: 'nourriture', food_sea: 'poissons', food_ice: 'viande' };
  const GOAL_TYPES = ['build', 'own_building', 'hatch', 'own_species', 'feed', 'creature_level', 'collect', 'research',
    'win_battle', 'battle_stage', 'player_level', 'unlock_park', 'activate', 'upgrade', 'cards', 'expedition'];

  // ---------------------------------------------------------------------------
  // Fallback tables, used when PC.DATA lacks a value (DATA always wins per key).
  // ---------------------------------------------------------------------------
  const RARITY_KEYS = ['commun', 'rare', 'super', 'legendaire', 'mythique'];
  const FB = {
    START: { coins: 6000, dollars: 25, food_land: 600, food_sea: 0, food_ice: 0, level: 1, xp: 0 },
    XP: { feed: 4, feedPerFood: 0, collect: 1, creatureLevel: 10, researchAttempt: 20, researchSuccess: 50 },
    RESEARCH: {
      durationSec: { commun: 5, rare: 8, super: 12, legendaire: 18, mythique: 25 },
      boostCost: { dollars: 5 }, boostChance: 20, maxChance: 95,
      steps: { commun: 2, rare: 3, super: 4, legendaire: 5, mythique: 6 },
      retryCost: { dollars: 1 },
    },
    EXPEDITION: {
      durationSec: { commun: 60, rare: 120, super: 240, legendaire: 420, mythique: 600 },
      chance: { commun: 60, rare: 55, super: 45, legendaire: 40, mythique: 35 },
      cost: { commun: 600, rare: 2500, super: 9000, legendaire: 25000, mythique: 60000 }, costMult: 1,
      buyDollars: { commun: 6, rare: 12, super: 25, legendaire: 45, mythique: 80 },
      vehicle: { land: 'Jeep d’exploration', sea: 'Sous-marin', ice: 'Chenillette des neiges' },
      promo: { everySec: 1800, durationSec: 300, discount: 0.3 },
    },
    UPGRADE: { maxLevel: 5, costMult: 1.5, prodMult: 1.5, kinds: ['coins', 'food'] },
    MEDALS: { names: ['Bronze', 'Argent', 'Or'], levelBonus: [0, 5, 10], rewardMult: [1, 1.5, 2.2], replayCoins: 0.3, lossXp: 5 },
    OFFERS: { rotateSec: 86400, minRarity: 'super', discount: 0.2, maxLevelAhead: 6 },
    CARDS: {
      freeEverySec: 600, perPack: 3, packCost: { dollars: 10 },
      table: [
        { weight: 3, reward: { coins: 400 }, label: '400 pièces', rarity: 'commun' },
        { weight: 2, reward: { xp: 60 }, label: '60 XP', rarity: 'commun' },
        { weight: 1, reward: { dollars: 2 }, label: '2 dollars', rarity: 'rare' },
      ],
    },
    SIDE_MISSIONS: {
      count: 3,
      templates: [
        { id: 'feed', icon: 'food', npc: 'tom', title: 'Petits creux', text: ['Nourris une créature.', 'Nourris tes créatures {n} fois.'],
          goal: { type: 'feed' }, n: [3, 0.5, 25], reward: { xp: [15, 4], coins: [150, 60] } },
        { id: 'deco', icon: 'star', npc: 'tom', title: 'Jardinier en chef', text: ['Place une décoration.', 'Place {n} décorations.'],
          goal: { type: 'build', kind: 'deco' }, n: [2, 0.15, 6], reward: { xp: [15, 4], coins: [120, 50] } },
        { id: 'coins', icon: 'coin', npc: 'tom', title: 'La tirelire du parc', text: ['Ramasse {n} pièce.', 'Ramasse {n} pièces.'],
          goal: { type: 'collect', res: 'coins' }, n: [200, 150, 30000], round: 50, reward: { xp: [15, 4], dollars: [1, 0.1] } },
      ],
    },
    ENCLOSURE_SIZE: { land: [3, 3], sea: [4, 4], ice: [3, 3] },
    NAMES: ['Caillou', 'Noisette', 'Pistache', 'Biscotte', 'Praline', 'Pompon', 'Caramel', 'Nougat', 'Plume', 'Truffe'],
  };

  const DATA = () => PC.DATA || {};
  const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
  const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const finite = v => typeof v === 'number' && Number.isFinite(v);
  const num = (v, d) => (v !== null && v !== '' && Number.isFinite(+v) ? +v : d);
  const nonNeg = (v, d) => Math.max(0, num(v, d));
  const clampInt = (v, a, b, d) => clamp(Math.round(num(v, d)), a, b);
  const fail = reason => ({ ok: false, reason });

  // Merged config tables, cached by identity of the DATA table.
  const cfgCache = {};
  function cfg(name) {
    const d = DATA()[name], fb = FB[name];
    const c = cfgCache[name];
    if (c && c.src === d) return c.val;
    let val = fb;
    if (isObj(d)) {
      val = Object.assign({}, fb, d);
      if (fb) for (const k in fb) if (isObj(fb[k]) && isObj(d[k])) val[k] = Object.assign({}, fb[k], d[k]);
    }
    cfgCache[name] = { src: d, val };
    return val;
  }
  const xpCfg = k => num((DATA().XP || {})[k], FB.XP[k]);
  const maxPlayerLevel = () => clampInt(DATA().MAX_PLAYER_LEVEL, 1, 999, 30);
  const maxCreatureLevel = () => PC.MAX_LEVEL || 40;
  const sellRatio = () => clamp(num(DATA().SELL_RATIO, 0.25), 0, 1);
  const coinCapMin = () => nonNeg(DATA().COIN_CAP_MIN, 60);
  function xpToNext(level) {
    try { if (typeof DATA().xpToNext === 'function') { const v = +DATA().xpToNext(level); if (v > 0) return v; } } catch (e) { /* fallback */ }
    return 400 + level * 300;
  }
  function levelReward(level) {
    try { if (typeof DATA().levelReward === 'function') { const r = DATA().levelReward(level); if (isObj(r)) return r; } } catch (e) { /* fallback */ }
    return { coins: 200 * level, dollars: level % 5 === 0 ? 10 : 3 };
  }
  function speedUpDollars(sec) {
    try { if (typeof DATA().speedUpCost === 'function') { const v = Math.round(+DATA().speedUpCost(sec)); if (v >= 0) return Math.max(1, v); } } catch (e) { /* fallback */ }
    return Math.max(1, Math.ceil(Math.max(0, sec) / 60));
  }
  const parkDef = p => (DATA().PARKS && DATA().PARKS[p]) || null;
  const foodOf = p => (parkDef(p) && parkDef(p).food) || 'food_' + p;
  const parkName = p => (parkDef(p) && parkDef(p).name) || p;
  const BLD = () => DATA().BUILDINGS || {};
  const bdef = id => BLD()[id] || null;
  const spdef = id => (PC.SPECIES && typeof id === 'string' && Object.prototype.hasOwnProperty.call(PC.SPECIES, id) ? PC.SPECIES[id] : null);
  const missionsList = () => (Array.isArray(DATA().MISSIONS) ? DATA().MISSIONS : []);
  const missionIdAt = i => { const d = missionsList()[i]; return d && d.id ? String(d.id) : null; };
  /** Story index of a saved mission: by id when known, else through the original order (missions
      added later carry `since`), so inserting missions never shifts an existing save. */
  function savedMissionIndex(M) {
    const list = missionsList();
    if (typeof M.id === 'string') { const j = list.findIndex(d => d && d.id === M.id); if (j >= 0) return j; }
    const legacy = list.filter(d => d && !d.since);
    const old = clampInt(M.index, 0, legacy.length, 0);
    return old >= legacy.length ? list.length : list.indexOf(legacy[old]);
  }
  const stagesOf = p => ((DATA().BATTLE_STAGES && Array.isArray(DATA().BATTLE_STAGES[p])) ? DATA().BATTLE_STAGES[p] : []);
  const rarityIdx = r => { const order = PC.RARITY_ORDER || RARITY_KEYS; const i = order.indexOf(r); return i < 0 ? 0 : i; };
  function enclosureSize(park) {
    const s = (DATA().ENCLOSURE_SIZE && DATA().ENCLOSURE_SIZE[park]) || (parkDef(park) && parkDef(park).enclosure) || FB.ENCLOSURE_SIZE[park] || [3, 3];
    return [clampInt(s[0], 1, 8, 3), clampInt(s[1], 1, 8, 3)];
  }
  /** Round a price to a friendly value. */
  /** French elision: « d’Archélon » / « de Stégosaure ». */
  const deName = name => (/^[aeiouyéèêâîôh]/i.test(name) ? 'd’' : 'de ') + name;
  function niceRound(v) {
    v = Math.max(0, +v || 0);
    const step = v < 1000 ? 10 : v < 10000 ? 50 : 100;
    return Math.max(step, Math.round(v / step) * step);
  }
  function fmtNum(n) {
    const s = String(Math.round(Math.abs(+n || 0))).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return (n < 0 ? '-' : '') + s;
  }
  /** French duration: 45 s, 4 min 05 s, 1 h 05, 2 j 3 h. */
  function fmtTime(sec) {
    sec = Math.max(0, Math.ceil(+sec || 0));
    if (sec < 60) return sec + ' s';
    const pad = n => String(n).padStart(2, '0');
    if (sec < 3600) { const m = Math.floor(sec / 60), s = sec % 60; return s ? `${m} min ${pad(s)} s` : `${m} min`; }
    if (sec < 86400) { const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60); return m ? `${h} h ${pad(m)}` : `${h} h`; }
    const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600);
    return h ? `${d} j ${h} h` : `${d} j`;
  }

  // ---------------------------------------------------------------------------
  // Events & time
  // ---------------------------------------------------------------------------
  const listeners = {};
  function on(evt, fn) {
    if (typeof evt !== 'string' || typeof fn !== 'function') return () => {};
    (listeners[evt] = listeners[evt] || []).push(fn);
    return () => off(evt, fn);
  }
  function off(evt, fn) {
    const l = listeners[evt];
    if (!l) return;
    const i = l.indexOf(fn);
    if (i >= 0) l.splice(i, 1);
  }
  function emit(evt, data) {
    const l = listeners[evt];
    if (!l || !l.length) return;
    for (const fn of l.slice()) {
      try { fn(data); } catch (e) { try { console.error('[ENGINE] listener "' + evt + '" failed', e); } catch (_) { /* ignore */ } }
    }
  }
  const toast = (text, kind) => emit('toast', { text: String(text), kind: kind || 'info' });

  let offset = 0;                    // debug time offset (ms), in memory only
  const now = () => Date.now() + offset;

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  let state = null;
  let lastSaveAt = 0, lastBankAt = 0, firstTick = true, welcome = null;
  const notified = { eggs: new Set(), ready: new Map() }; // egg ids / building id → readyAt already announced
  ENGINE.state = null;

  function defaultCounters() {
    return {
      built: {}, builtKind: {}, hatched: {}, hatchedPark: {}, feeds: 0, collected: {},
      researchAttempts: 0, researchSuccess: 0, researchComplete: 0,
      battlesWon: { land: 0, sea: 0, ice: 0 },
      activated: 0, upgrades: 0, packs: 0, expeditions: 0,
    };
  }
  const MAP_KEYS = ['built', 'builtKind', 'hatched', 'hatchedPark', 'collected'];
  const SCALAR_KEYS = ['feeds', 'researchAttempts', 'researchSuccess', 'researchComplete', 'activated', 'upgrades', 'packs', 'expeditions'];

  /** Fresh state without fixed objects (callers add them with ensureFixed once `state` is set). */
  function blankState() {
    const S = Object.assign({}, FB.START, isObj(DATA().START) ? DATA().START : {});
    const t = now();
    const s = {
      v: VERSION,
      player: { level: clampInt(S.level, 1, maxPlayerLevel(), 1), xp: nonNeg(S.xp, 0) },
      current: 'land',
      parks: {},
      researched: {},
      researchProgress: {},
      research: null,
      expedition: null,
      promo: null,
      promoNextAt: t + nonNeg(cfg('EXPEDITION').promo && cfg('EXPEDITION').promo.everySec, 1800) * 1000,
      offer: null,
      mission: { index: 0, id: missionIdAt(0), base: defaultCounters(), done: false },
      sideMissions: [],
      battles: { land: 0, sea: 0, ice: 0 },
      medals: { land: {}, sea: {}, ice: {} },
      counters: defaultCounters(),
      cards: { nextFreeAt: 0 },
      seenIntro: false,
      settings: { sound: true, music: true },
      createdAt: t,
      savedAt: 0,
    };
    for (const k of RES_KEYS) s.player[k] = Math.round(nonNeg(S[k], 0));
    for (const p of PARKS) {
      const P = parkDef(p);
      const free = p === 'land' || (P && P.unlockLevel <= 1 && !Object.keys(P.unlockCost || {}).length);
      s.parks[p] = { unlocked: !!free, objects: [], nextId: ID_BASE[p] };
    }
    return s;
  }

  function setState(s) {
    state = s;
    ENGINE.state = s;
    notified.eggs.clear();
    notified.ready.clear();
    firstTick = true;
    lastSaveAt = now();
    lastBankAt = 0;
  }

  /** Post-load housekeeping: fixed objects, positions, side missions, offer. */
  function finishSetup() {
    for (const p of PARKS) {
      ensureFixed(p);
      syncPositions(p);
      replaceLost(p);
    }
    ensureSide();
    ensureOffer();
  }

  // ---------------------------------------------------------------------------
  // Terrain & placement
  // ---------------------------------------------------------------------------
  const fallbackTerrains = {};
  function fallbackTerrain(park) {
    if (!fallbackTerrains[park]) {
      const tiles = new Uint8Array(24 * 24).fill(1);
      fallbackTerrains[park] = { park, w: 24, h: 24, tiles, fixed: [], scenery: [], fallback: true };
    }
    return fallbackTerrains[park];
  }
  function terrain(park) {
    if (!PARKS.includes(park)) park = 'land';
    const T = PC.TERRAIN;
    if (T && typeof T.generate === 'function') {
      try {
        const t = T.generate(park);
        if (t && t.tiles && t.tiles.length && t.w > 0 && t.h > 0) return t;
      } catch (e) { /* fall back */ }
    }
    return fallbackTerrain(park);
  }
  /** Tile code at (gx, gy): row-major tiles[gy * w + gx]. */
  function tileAt(t, gx, gy) {
    if (gx < 0 || gy < 0 || gx >= t.w || gy >= t.h) return 0;
    return t.tiles[gy * t.w + gx];
  }
  function overlaps(park, gx, gy, w, h, ignoreId) {
    for (const o of state.parks[park].objects) {
      if (o.id === ignoreId || o.gx == null) continue;
      if (gx < o.gx + o.w && gx + w > o.gx && gy < o.gy + o.h && gy + h > o.gy) return true;
    }
    return false;
  }
  /** null when (gx, gy, w, h) can be placed in `park`, else a French reason. */
  function placeReason(park, gx, gy, w, h, ignoreId) {
    if (!state || !PARKS.includes(park)) return 'Parc inconnu';
    gx = +gx; gy = +gy; w = +w; h = +h;
    if (![gx, gy, w, h].every(Number.isInteger) || w < 1 || h < 1) return 'Emplacement invalide';
    const t = terrain(park);
    if (gx < 0 || gy < 0 || gx + w > t.w || gy + h > t.h) return 'Impossible de construire ici';
    for (let y = gy; y < gy + h; y++) for (let x = gx; x < gx + w; x++) if (tileAt(t, x, y) !== 1) return 'Impossible de construire ici';
    if (overlaps(park, gx, gy, w, h, ignoreId)) return 'Emplacement occupé';
    return null;
  }
  function canPlace(park, gx, gy, w, h, ignoreId) { return placeReason(park, gx, gy, w, h, ignoreId) === null; }

  const centroids = new WeakMap();
  function centroid(t) {
    let c = centroids.get(t);
    if (!c) {
      let sx = 0, sy = 0, n = 0;
      for (let y = 0; y < t.h; y++) for (let x = 0; x < t.w; x++) if (tileAt(t, x, y) === 1) { sx += x + 0.5; sy += y + 0.5; n++; }
      c = n ? { x: sx / n, y: sy / n } : { x: t.w / 2, y: t.h / 2 };
      centroids.set(t, c);
    }
    return c;
  }
  /** Free spot for a w×h footprint, closest to the park centre, or null. */
  function findFreeSpot(park, w, h) {
    if (!state || !PARKS.includes(park)) return null;
    w = clampInt(w, 1, 24, 1); h = clampInt(h, 1, 24, 1);
    const t = terrain(park), c = centroid(t);
    let best = null, bestD = Infinity;
    for (let gy = 0; gy + h <= t.h; gy++) {
      for (let gx = 0; gx + w <= t.w; gx++) {
        const dx = gx + w / 2 - c.x, dy = gy + h / 2 - c.y, d = dx * dx + dy * dy;
        if (d >= bestD) continue;
        if (placeReason(park, gx, gy, w, h) === null) { best = { gx, gy }; bestD = d; }
      }
    }
    return best;
  }

  function nextId(park) {
    const P = state.parks[park];
    let id = Math.max(num(P.nextId, ID_BASE[park]), ID_BASE[park]);
    P.nextId = id + 1;
    return id;
  }

  /** Where the fixed buildings of a park stand (terrain first, then a simple fallback layout). */
  function fixedSpecs(park) {
    const t = terrain(park);
    if (Array.isArray(t.fixed) && t.fixed.length) return t.fixed;
    const spots = { harbor_ice: [2, 19], gate: [11, 21], lab: [5, 16], arena: [15, 15] };
    const out = [];
    for (const id in BLD()) {
      const b = BLD()[id];
      if (b.park !== park || !b.fixed) continue;
      const s = spots[id] || spots[b.action] || [null, null];
      if (!spots[id] && spots[b.action]) spots[b.action] = [null, null]; // only the first of each action
      out.push({ buildingId: id, gx: s[0], gy: s[1] });
    }
    return out;
  }
  /** Re-create missing fixed buildings (gate, lab, arena, harbor…). */
  function ensureFixed(park) {
    const objs = state.parks[park].objects;
    for (const f of fixedSpecs(park)) {
      const b = f && bdef(f.buildingId);
      if (!b || objs.some(o => o.type === 'building' && o.buildingId === f.buildingId)) continue;
      const [w, h] = b.size;
      let gx = f.gx, gy = f.gy;
      // Terrain positions are trusted (gates may straddle the edge); only avoid overlaps.
      if (!Number.isInteger(gx) || !Number.isInteger(gy) || overlaps(park, gx, gy, w, h)) {
        const spot = findFreeSpot(park, w, h);
        if (spot) { gx = spot.gx; gy = spot.gy; } else if (!Number.isInteger(gx) || !Number.isInteger(gy)) continue;
      }
      objs.push({ id: nextId(park), type: 'building', buildingId: f.buildingId, gx, gy, w, h, fixed: true });
    }
  }
  /**
   * After a load: fixed buildings follow the terrain's positions, and player objects standing on
   * unbuildable or overlapping tiles (e.g. the terrain generator changed since the save) move to a
   * free spot. An object that finds no room keeps its old position rather than being lost.
   */
  function syncPositions(park) {
    const t = terrain(park), objs = state.parks[park].objects;
    if (!t.fallback && Array.isArray(t.fixed)) for (const f of t.fixed) {
      const o = f && objs.find(x => x.fixed && x.buildingId === f.buildingId);
      if (o && Number.isInteger(f.gx) && Number.isInteger(f.gy)) { o.gx = f.gx; o.gy = f.gy; }
    }
    for (const o of objs) {
      if (o.fixed || !Number.isInteger(o.gx) || !Number.isInteger(o.gy)) continue;
      if (placeReason(park, o.gx, o.gy, o.w, o.h, o.id) === null) continue;
      const gx = o.gx, gy = o.gy;
      o.gx = null; o.gy = null;
      const spot = findFreeSpot(park, o.w, o.h);
      if (spot) { o.gx = spot.gx; o.gy = spot.gy; } else { o.gx = gx; o.gy = gy; }
    }
  }
  /** Objects loaded without a valid position get a free spot (or are dropped if the park is full). */
  function replaceLost(park) {
    const objs = state.parks[park].objects;
    for (let i = objs.length - 1; i >= 0; i--) {
      const o = objs[i];
      if (Number.isInteger(o.gx) && Number.isInteger(o.gy)) continue;
      o.gx = null; o.gy = null;
      const spot = findFreeSpot(park, o.w, o.h);
      if (spot) { o.gx = spot.gx; o.gy = spot.gy; } else objs.splice(i, 1);
    }
  }

  // ---------------------------------------------------------------------------
  // Resources & XP
  // ---------------------------------------------------------------------------
  function res(name) {
    if (!state) return 0;
    if (name === 'level' || name === 'xp') return state.player[name];
    return RES_KEYS.includes(name) ? state.player[name] || 0 : 0;
  }
  function canAfford(cost) {
    if (!state) return false;
    if (cost == null) return true;
    if (!isObj(cost)) return false;
    for (const k in cost) {
      if (k === 'xp') continue;
      const v = +cost[k];
      if (!Number.isFinite(v) || v <= 0) continue;
      if (!RES_KEYS.includes(k) || (state.player[k] || 0) < Math.ceil(v)) return false;
    }
    return true;
  }
  function payRaw(cost) {
    if (!canAfford(cost)) return false;
    if (isObj(cost)) for (const k in cost) {
      const v = +cost[k];
      if (RES_KEYS.includes(k) && Number.isFinite(v) && v > 0) state.player[k] -= Math.ceil(v);
    }
    return true;
  }
  /** French reason for the first resource missing to pay `cost`. */
  function missingReason(cost) {
    if (isObj(cost) && state) for (const k in cost) {
      const v = +cost[k];
      if (RES_KEYS.includes(k) && v > 0 && (state.player[k] || 0) < v) return 'Pas assez de ' + RES_WORDS[k];
    }
    return 'Pas assez de ressources';
  }
  function giveRaw(reward) {
    if (!isObj(reward) || !state) return;
    let xp = 0;
    for (const k in reward) {
      const v = Math.round(+reward[k]);
      if (!Number.isFinite(v) || v <= 0) continue;
      if (k === 'xp') xp += v;
      else if (RES_KEYS.includes(k)) state.player[k] = (state.player[k] || 0) + v;
    }
    if (xp) addXPRaw(xp);
  }
  function unlocksAt(level) {
    const out = [];
    for (const p of PARKS) {
      const P = parkDef(p);
      if (P && p !== 'land' && P.unlockLevel === level) out.push({ type: 'park', id: p, text: 'Nouveau parc : ' + P.name });
    }
    for (const id in PC.SPECIES || {}) {
      const sp = PC.SPECIES[id];
      if (sp.level === level && !sp.offerOnly) out.push({ type: 'species', id, text: 'Nouvelle espèce : ' + sp.name + (sp.research ? ' (recherche ADN)' : '') });
    }
    for (const id in BLD()) {
      const b = BLD()[id];
      if (b.level === level && b.kind !== 'special' && !b.fixed) out.push({ type: 'building', id, text: 'Nouveau bâtiment : ' + b.name });
    }
    return out;
  }
  /** Add XP, handling several level-ups at once; emits ONE 'levelup' for the final level. */
  function addXPRaw(n) {
    n = Math.round(+n);
    if (!state || !(n > 0)) return;
    const P = state.player, max = maxPlayerLevel(), from = P.level;
    P.xp += n;
    const levels = [], reward = {}, unlockIds = [];
    while (P.level < max && P.xp >= xpToNext(P.level)) {
      P.xp -= xpToNext(P.level);
      P.level++;
      levels.push(P.level);
      const r = levelReward(P.level) || {};
      for (const k in r) {
        const v = Math.round(+r[k]);
        if (RES_KEYS.includes(k) && v > 0) { reward[k] = (reward[k] || 0) + v; P[k] = (P[k] || 0) + v; }
      }
      unlockIds.push(...unlocksAt(P.level));
    }
    if (P.level >= max) P.xp = Math.min(P.xp, xpToNext(max));
    if (levels.length) {
      emit('levelup', { level: P.level, from, levels, reward, unlocks: unlockIds.map(u => u.text), unlockIds });
    }
  }
  function levelProgress() {
    if (!state) return null;
    const need = xpToNext(state.player.level);
    return { level: state.player.level, xp: state.player.xp, need, ratio: clamp(state.player.xp / need, 0, 1), max: state.player.level >= maxPlayerLevel() };
  }

  // ---------------------------------------------------------------------------
  // Objects
  // ---------------------------------------------------------------------------
  /** Find {park, obj} from an id or an object; the current park is searched first. */
  function find(ref) {
    if (!state || ref == null) return null;
    const order = [state.current].concat(PARKS.filter(p => p !== state.current));
    if (typeof ref === 'object') {
      for (const p of order) if (state.parks[p].objects.includes(ref)) return { park: p, obj: ref };
      ref = ref.id;
    }
    const id = Number(ref);
    if (!Number.isFinite(id)) return null;
    for (const p of order) {
      const o = state.parks[p].objects.find(x => x.id === id);
      if (o) return { park: p, obj: o };
    }
    return null;
  }
  const resolveObj = ref => { const f = find(ref); return f ? f.obj : null; };
  function getObj(park, id) {
    if (!state || !PARKS.includes(park)) return null;
    id = Number(id);
    return state.parks[park].objects.find(o => o.id === id) || null;
  }
  function objects(park) {
    if (!state) return [];
    if (!PARKS.includes(park)) park = state.current;
    return state.parks[park].objects;
  }
  function allObjects() {
    const out = [];
    for (const p of PARKS) for (const o of state.parks[p].objects) out.push(o);
    return out;
  }

  // ---------------------------------------------------------------------------
  // Species, prices, limited offers
  // ---------------------------------------------------------------------------
  const isResearched = id => { const sp = spdef(id); return !!sp && (!sp.research || !!state.researched[id]); };
  function ownsSpecies(id) {
    if (!state) return false;
    for (const p of PARKS) if (state.parks[p].objects.some(o => o.type === 'enclosure' && o.speciesId === id)) return true;
    return false;
  }
  const isOffer = id => !!(state && state.offer && state.offer.speciesId === id && state.offer.until > now());
  function researchingNow(id) {
    const r = state.research, x = state.expedition;
    return !!((r && r.speciesId === id && r.result === null) || (x && x.speciesId === id && x.result === null));
  }
  /** Current price of a species (offer discount applied, dollar price for offer-only species). */
  function creaturePrice(id) {
    const sp = spdef(id);
    if (!sp) return {};
    const p = sp.price || {};
    const cost = {};
    let coins = Math.round(nonNeg(p.coins, 0));
    const O = cfg('OFFERS');
    if (coins && isOffer(id) && O.discount > 0) coins = niceRound(coins * (1 - clamp(O.discount, 0, 0.9)));
    if (coins > 0) cost.coins = coins;
    if (nonNeg(p.dollars, 0) > 0) cost.dollars = Math.round(p.dollars);
    return cost;
  }
  /**
   * Market status of a species: state is one of
   * 'owned' (already created: « Déjà créé »), 'offer_only' (only through a limited offer),
   * 'level' (needLevel), 'park' (park locked), 'research', 'researching', 'available', 'unknown'.
   */
  function speciesStatus(id) {
    const sp = spdef(id);
    if (!sp || !state) return { state: 'unknown', needLevel: 0, owned: false, offer: false, price: {} };
    const park = state.parks[sp.park];
    const P = parkDef(sp.park);
    const out = { state: 'available', needLevel: sp.level, owned: ownsSpecies(id), offer: isOffer(id), price: creaturePrice(id),
      researched: isResearched(id), steps: researchSteps(id) };
    if (out.owned) out.state = 'owned';
    else if (!park || !park.unlocked) { out.state = state.player.level < sp.level ? 'level' : 'park'; if (out.state === 'park' && P) out.needLevel = P.unlockLevel; }
    else if (out.offer) out.state = 'available';
    else if (sp.offerOnly) out.state = 'offer_only';
    else if (state.player.level < sp.level) out.state = 'level';
    else if (!out.researched) out.state = researchingNow(id) ? 'researching' : 'research';
    return out;
  }
  function offerCandidates(maxAhead) {
    const O = cfg('OFFERS'), minR = rarityIdx(O.minRarity || 'super');
    const out = [];
    for (const id in PC.SPECIES || {}) {
      const sp = PC.SPECIES[id];
      if (!(sp.offerOnly || rarityIdx(sp.rarity) >= minR)) continue;
      if (!state.parks[sp.park] || !state.parks[sp.park].unlocked || ownsSpecies(id)) continue;
      if (maxAhead != null && sp.level > state.player.level + maxAhead) continue;
      out.push(id);
    }
    return out;
  }
  /** Rotate the limited offer when missing or expired. Returns true when it changed. */
  function ensureOffer(force) {
    if (!state) return false;
    const t = now(), O = cfg('OFFERS');
    const ahead = nonNeg(O.maxLevelAhead, 6);
    // An offer far above the player's level (e.g. from an older save) is replaced right away.
    const tooFar = id => { const sp = spdef(id); return !!sp && !ownsSpecies(id) && sp.level > state.player.level + ahead; };
    if (!force && state.offer && state.offer.until > t && !(state.offer.speciesId && tooFar(state.offer.speciesId))) return false;
    const prev = state.offer && state.offer.speciesId;
    // Only species close to the player's level: when none qualifies, no offer (retried in an hour).
    let c = offerCandidates(ahead);
    if (c.length > 1) c = c.filter(id => id !== prev);
    const period = Math.max(60, nonNeg(O.rotateSec, 86400)) * 1000;
    if (!c.length) {
      // Nothing to offer right now: try again in an hour.
      const changed = !!(state.offer && state.offer.speciesId);
      state.offer = { speciesId: null, until: t + Math.min(period, 3600000) };
      return changed;
    }
    const speciesId = c[Math.floor(Math.random() * c.length) % c.length];
    state.offer = { speciesId, until: t + period };
    emit('offer', { speciesId, until: state.offer.until });
    return true;
  }
  /** Limited offer for the market, or null. */
  function offerInfo() {
    if (!state || !state.offer || !state.offer.speciesId) return null;
    const sp = spdef(state.offer.speciesId);
    const rem = Math.max(0, (state.offer.until - now()) / 1000);
    if (!sp || rem <= 0) return null;
    const d = Math.floor(rem / 86400), h = Math.ceil(rem / 3600), m = Math.ceil(rem / 60);
    const label = d >= 1 ? `${d} j restant${d > 1 ? 's' : ''}` : h >= 2 ? `${h} h restantes` : rem >= 3600 ? '1 h restante' : `${m} min restante${m > 1 ? 's' : ''}`;
    return { speciesId: sp.id, until: state.offer.until, remainingSec: Math.ceil(rem), label, price: creaturePrice(sp.id),
      owned: ownsSpecies(sp.id), discount: sp.offerOnly ? 0 : clamp(num(cfg('OFFERS').discount, 0), 0, 0.9) };
  }

  // ---------------------------------------------------------------------------
  // Creatures
  // ---------------------------------------------------------------------------
  function randomName() {
    const names = Array.isArray(DATA().NAMES) && DATA().NAMES.length ? DATA().NAMES : FB.NAMES;
    const used = new Set(state ? allObjects().filter(o => o.type === 'enclosure').map(o => o.name) : []);
    const free = names.filter(n => !used.has(n));
    if (free.length) return free[Math.floor(Math.random() * free.length) % free.length];
    return names[Math.floor(Math.random() * names.length) % names.length] + ' ' + (2 + Math.floor(Math.random() * 98));
  }
  function buyCreature(speciesId, gx, gy) {
    const sp = spdef(speciesId);
    if (!sp || !state) return fail('Créature inconnue');
    const st = speciesStatus(speciesId);
    switch (st.state) {
      case 'owned': return fail('Déjà créé');
      case 'offer_only': return fail('Disponible seulement en offre limitée');
      case 'level': return fail('Niveau ' + st.needLevel + ' requis');
      case 'park': return fail('Débloque d’abord le ' + parkName(sp.park));
      case 'research': case 'researching': return fail('Recherche ADN nécessaire');
    }
    const park = sp.park, [w, h] = enclosureSize(park);
    let x = gx, y = gy;
    if (x == null || y == null) {
      const spot = findFreeSpot(park, w, h);
      if (!spot) return fail('Plus de place dans le parc');
      x = spot.gx; y = spot.gy;
    } else {
      x = Math.round(+x); y = Math.round(+y);
      const r = placeReason(park, x, y, w, h);
      if (r) return fail(r);
    }
    const cost = st.price;
    if (!payRaw(cost)) return fail(missingReason(cost));
    const obj = {
      id: nextId(park), type: 'enclosure', gx: x, gy: y, w, h,
      speciesId, name: randomName(), level: 1, feeds: 0,
      hatchAt: now() + nonNeg(sp.hatchSec, 10) * 1000, hatched: false,
      coins: 0, lastAt: null, paid: clone(cost),
    };
    state.parks[park].objects.push(obj);
    emit('buy', { park, obj, cost });
    changed();
    return { ok: true, obj, park, cost };
  }
  function hatch(objId) {
    const f = find(objId);
    if (!f || f.obj.type !== 'enclosure') return fail('Objet introuvable');
    const o = f.obj, sp = spdef(o.speciesId);
    if (!sp) return fail('Créature inconnue');
    if (o.hatched) return fail('Déjà éclos');
    if (now() < o.hatchAt) return fail('L’œuf n’est pas encore prêt');
    o.hatched = true; o.hatchAt = null; o.level = o.level || 1; o.feeds = 0; o.coins = 0; o.lastAt = now();
    const c = state.counters;
    c.hatched[o.speciesId] = (c.hatched[o.speciesId] || 0) + 1;
    c.hatchedPark[f.park] = (c.hatchedPark[f.park] || 0) + 1;
    emit('hatched', { park: f.park, obj: o });
    const R = PC.RARITY && PC.RARITY[sp.rarity];
    addXPRaw(R ? R.xpHatch : 40);
    changed();
    return { ok: true, obj: o, park: f.park };
  }
  function pendingRaw(o) {
    if (!o || o.type !== 'enclosure' || !o.hatched || !spdef(o.speciesId)) return 0;
    const cpm = PC.statsAt(o.speciesId, o.level || 1).coinsPerMin;
    const cap = cpm * coinCapMin();
    const t = now();
    const last = finite(o.lastAt) ? Math.min(o.lastAt, t) : t;
    return clamp(nonNeg(o.coins, 0) + (t - last) / 60000 * cpm, 0, cap);
  }
  /** Whole coins waiting above a creature (capped at COIN_CAP_MIN minutes of income). */
  function pendingCoins(ref) { return Math.floor(pendingRaw(resolveObj(ref) || ref)); }
  function bank(o) {
    if (!o || o.type !== 'enclosure' || !o.hatched) return;
    o.coins = pendingRaw(o);
    o.lastAt = now();
  }
  function bankAll() { for (const o of allObjects()) if (o.type === 'enclosure' && o.hatched) bank(o); }

  function feed(objId) {
    const f = find(objId);
    if (!f || f.obj.type !== 'enclosure') return fail('Objet introuvable');
    const o = f.obj, sp = spdef(o.speciesId);
    if (!sp) return fail('Créature inconnue');
    if (!o.hatched) return fail('Pas encore éclos');
    if ((o.level || 1) >= maxCreatureLevel()) return fail('Niveau maximum atteint');
    const st = PC.statsAt(o.speciesId, o.level);
    const food = foodOf(sp.park);
    const cost = { [food]: st.feedCost };
    if (!payRaw(cost)) return fail(missingReason(cost));
    bank(o); // coins earned so far keep the old rate
    o.feeds = (o.feeds || 0) + 1;
    state.counters.feeds++;
    let levelUp = false, stageUp = false;
    const prevStage = PC.stageForLevel(o.level);
    if (o.feeds >= st.feedsToLevel) {
      o.level = Math.min(maxCreatureLevel(), o.level + 1);
      o.feeds = 0;
      levelUp = true;
      stageUp = PC.stageForLevel(o.level) > prevStage;
    }
    const stage = PC.stageForLevel(o.level);
    emit('feed', { park: f.park, obj: o, levelUp, stageUp, level: o.level, stage, prevStage, cost });
    addXPRaw(feedXp(st.feedCost) + (levelUp ? xpCfg('creatureLevel') : 0));
    changed();
    return { ok: true, levelUp, stageUp, level: o.level, stage, cost };
  }
  /** Player XP for one feed: grows with the food spent (XP.feedPerFood), never below XP.feed. */
  function feedXp(foodCost) {
    return Math.max(xpCfg('feed'), Math.round(nonNeg(foodCost, 0) * xpCfg('feedPerFood')));
  }
  /** statsAt(...) of a creature plus stage, feeds, food resource and next feed cost. */
  function creatureStats(ref) {
    const o = isObj(ref) && ref.type === 'enclosure' ? ref : resolveObj(ref);
    if (!o || o.type !== 'enclosure' || !spdef(o.speciesId)) return null;
    const sp = spdef(o.speciesId), level = clampInt(o.level, 1, maxCreatureLevel(), 1);
    const s = PC.statsAt(o.speciesId, level);
    const stage = PC.stageForLevel(level);
    return Object.assign({}, s, {
      stage, stageName: (PC.STAGE_NAMES || [])[stage] || '', feeds: o.feeds || 0, food: foodOf(sp.park),
      feedCostObj: { [foodOf(sp.park)]: s.feedCost }, maxLevel: level >= maxCreatureLevel(),
      cls: sp.cls, rarity: sp.rarity, speciesId: o.speciesId, name: o.name,
    });
  }
  function creaturesOf(park, hatchedOnly) {
    if (!state) return [];
    if (!PARKS.includes(park)) park = state.current;
    return state.parks[park].objects.filter(o => o.type === 'enclosure' && (!hatchedOnly || o.hatched));
  }

  // ---------------------------------------------------------------------------
  // Buildings: purchase, production, deliveries, upgrades
  // ---------------------------------------------------------------------------
  const upCfg = () => cfg('UPGRADE');
  function prodMult(o) {
    const U = upCfg();
    return Math.pow(num(U.prodMult, 1.5), clampInt(o.level, 1, U.maxLevel, 1) - 1);
  }
  function startCycle(o, sec) {
    const t = now();
    o.cycleSec = Math.max(1, nonNeg(sec, 60));
    o.startedAt = t;
    o.readyAt = t + o.cycleSec * 1000;
  }
  /** The 3 delivery orders of a food building, amounts scaled by the building level. */
  function buildingOrders(ref) {
    const o = resolveObj(ref);
    const b = o ? bdef(o.buildingId) : bdef(ref);
    if (!b || b.kind !== 'food') return [];
    let base = Array.isArray(b.orders) && b.orders.length ? b.orders : null;
    if (!base) {
      const p = b.produce || { sec: 60, amount: 50 };
      base = [
        { name: 'Petite livraison', sec: p.sec, amount: p.amount },
        { name: 'Livraison moyenne', sec: p.sec * 6, amount: Math.round(p.amount * 4.5) },
        { name: 'Grosse livraison', sec: p.sec * 24, amount: p.amount * 15 },
      ];
    }
    const m = o ? prodMult(o) : 1;
    return base.map((x, i) => ({ index: i, name: x.name || ['Petite livraison', 'Livraison moyenne', 'Grosse livraison'][i] || 'Livraison',
      sec: nonNeg(x.sec, 60), amount: Math.round(nonNeg(x.amount, 0) * m) }));
  }
  /**
   * Production status of a building:
   * { kind, state: 'none'|'idle'|'producing'|'ready', res, amount, progress 0..1, remainingSec, order, orders? }.
   */
  function production(ref) {
    const o = resolveObj(ref);
    if (!o || o.type !== 'building') return null;
    const b = bdef(o.buildingId);
    if (!b) return null;
    const timer = (res, amount, order) => {
      const t = now(), total = nonNeg(o.cycleSec, 1) * 1000, rem = Math.max(0, (o.readyAt || t) - t);
      return { kind: b.kind, state: rem <= 0 ? 'ready' : 'producing', res, amount, order,
        progress: total ? clamp(1 - rem / total, 0, 1) : 1, remainingSec: Math.ceil(rem / 1000) };
    };
    if (b.kind === 'coins' && b.produce) {
      if (!finite(o.readyAt)) startCycle(o, b.produce.sec);
      return timer('coins', Math.round(b.produce.amount * prodMult(o)), null);
    }
    if (b.kind === 'food') {
      const res = (b.produce && b.produce.res) || foodOf(b.park);
      const orders = buildingOrders(o);
      if (!finite(o.readyAt)) return { kind: 'food', state: 'idle', res, amount: 0, progress: 0, remainingSec: 0, order: null, orders };
      const ord = orders[clampInt(o.order, 0, orders.length - 1, 0)];
      return Object.assign(timer(res, ord ? ord.amount : 0, ord || null), { orders });
    }
    return { kind: b.kind, state: 'none', res: null, amount: 0, progress: 0, remainingSec: 0, order: null };
  }
  function buyBuilding(buildingId, gx, gy) {
    const b = bdef(buildingId);
    if (!b || !state) return fail('Bâtiment inconnu');
    if (b.kind === 'special' || b.fixed) return fail('Ce bâtiment ne se construit pas');
    const park = b.park;
    if (!state.parks[park] || !state.parks[park].unlocked) return fail('Débloque d’abord le ' + parkName(park));
    if (state.player.level < b.level) return fail('Niveau ' + b.level + ' requis');
    const [w, h] = b.size;
    let x = gx, y = gy;
    if (x == null || y == null) {
      const spot = findFreeSpot(park, w, h);
      if (!spot) return fail('Plus de place dans le parc');
      x = spot.gx; y = spot.gy;
    } else {
      x = Math.round(+x); y = Math.round(+y);
      const r = placeReason(park, x, y, w, h);
      if (r) return fail(r);
    }
    if (!payRaw(b.cost)) return fail(missingReason(b.cost));
    const obj = { id: nextId(park), type: 'building', buildingId, gx: x, gy: y, w, h, level: 1 };
    if (b.kind === 'coins' && b.produce) startCycle(obj, b.produce.sec);
    if (b.kind === 'food') { obj.order = null; obj.readyAt = null; }
    state.parks[park].objects.push(obj);
    const c = state.counters;
    c.built[buildingId] = (c.built[buildingId] || 0) + 1;
    c.builtKind[b.kind] = (c.builtKind[b.kind] || 0) + 1;
    emit('build', { park, obj });
    addXPRaw(b.xp);
    changed();
    return { ok: true, obj, park };
  }
  /** Choose a delivery (0 small, 1 medium, 2 large) for an idle food building. */
  function activate(objId, orderIndex) {
    const f = find(objId);
    if (!f || f.obj.type !== 'building') return fail('Objet introuvable');
    const o = f.obj, b = bdef(o.buildingId);
    if (!b || b.kind !== 'food') return fail('Ce bâtiment n’a pas de livraison');
    if (finite(o.readyAt)) return fail(now() >= o.readyAt ? 'Collecte d’abord la livraison' : 'Livraison déjà en cours');
    const orders = buildingOrders(o);
    const i = orderIndex == null ? 0 : Math.round(+orderIndex);
    if (!Number.isInteger(i) || i < 0 || i >= orders.length) return fail('Livraison inconnue');
    o.order = i;
    startCycle(o, orders[i].sec);
    state.counters.activated++;
    emit('activate', { park: f.park, obj: o, order: orders[i] });
    changed();
    return { ok: true, order: orders[i] };
  }
  /** Coins needed to raise a building to the next level, or null when not upgradable / max level. */
  function upgradeCost(ref) {
    const o = resolveObj(ref);
    if (!o || o.type !== 'building' || o.fixed) return null;
    const b = bdef(o.buildingId), U = upCfg();
    if (!b || !(U.kinds || []).includes(b.kind)) return null;
    const lv = clampInt(o.level, 1, U.maxLevel, 1);
    if (lv >= U.maxLevel) return null;
    const base = nonNeg(b.cost && b.cost.coins, 0) || 100;
    return { coins: niceRound(base * Math.pow(num(U.costMult, 1.5), lv)) };
  }
  function upgrade(objId) {
    const f = find(objId);
    if (!f || f.obj.type !== 'building') return fail('Objet introuvable');
    const o = f.obj, b = bdef(o.buildingId), U = upCfg();
    if (!b || o.fixed || !(U.kinds || []).includes(b.kind)) return fail('Ce bâtiment ne peut pas être amélioré');
    if ((o.level || 1) >= U.maxLevel) return fail('Niveau maximum atteint');
    const cost = upgradeCost(o);
    if (!payRaw(cost)) return fail(missingReason(cost));
    o.level = (o.level || 1) + 1;
    state.counters.upgrades++;
    emit('upgrade', { park: f.park, obj: o, level: o.level, cost });
    // XP grows with the price like the building's own XP (≈ coins / 40): coins piling up turn into levels.
    const base = nonNeg(b.cost && b.cost.coins, 0) || 100;
    addXPRaw(Math.max(nonNeg(b.xp, 0), Math.round(nonNeg(b.xp, 0) * nonNeg(cost.coins, 0) / base)));
    changed();
    return { ok: true, level: o.level, cost };
  }

  // ---------------------------------------------------------------------------
  // Collect, move, sell, speed-ups
  // ---------------------------------------------------------------------------
  function collect(objId) {
    const f = find(objId);
    if (!f) return 0;
    const o = f.obj;
    let resName, amount;
    if (o.type === 'enclosure') {
      const raw = pendingRaw(o);
      amount = Math.floor(raw);
      if (amount < 1) return 0;
      o.coins = raw - amount;
      o.lastAt = now();
      resName = 'coins';
    } else {
      const p = production(o);
      if (!p || p.state !== 'ready' || !(p.amount > 0)) return 0;
      const b = bdef(o.buildingId);
      resName = p.res; amount = p.amount;
      if (p.kind === 'coins') startCycle(o, b.produce.sec);
      else { o.readyAt = null; o.order = null; o.startedAt = null; o.cycleSec = null; }
    }
    state.player[resName] = (state.player[resName] || 0) + amount;
    state.counters.collected[resName] = (state.counters.collected[resName] || 0) + amount;
    emit('collect', { park: f.park, obj: o, res: resName, amount });
    addXPRaw(xpCfg('collect'));
    changed();
    return amount;
  }
  /** Collect everything ready in a park (default: current). Returns {coins: n, food_x: n}. */
  function collectAll(park) {
    if (!state) return {};
    if (!PARKS.includes(park)) park = state.current;
    const got = {};
    for (const o of state.parks[park].objects.slice()) {
      const p = o.type === 'building' ? production(o) : null;
      if (o.type === 'enclosure' ? pendingRaw(o) >= 1 : p && p.state === 'ready') {
        const resName = o.type === 'enclosure' ? 'coins' : p.res;
        const n = collect(o);
        if (n) got[resName] = (got[resName] || 0) + n;
      }
    }
    return got;
  }
  function move(objId, gx, gy) {
    const f = find(objId);
    if (!f) return fail('Objet introuvable');
    const o = f.obj;
    if (o.fixed) return fail('Ce bâtiment ne peut pas être déplacé');
    const x = Math.round(+gx), y = Math.round(+gy);
    const r = placeReason(f.park, x, y, o.w, o.h, o.id);
    if (r) return fail(r);
    o.gx = x; o.gy = y;
    emit('move', { park: f.park, obj: o });
    changed();
    return { ok: true, obj: o };
  }
  /** Refund that sell() would give (SELL_RATIO of the price paid, upgrades included). */
  function sellValue(ref) {
    const o = resolveObj(ref);
    if (!o || o.fixed) return {};
    const ratio = sellRatio(), out = {};
    const add = (k, v) => { v = Math.floor(v * ratio); if (RES_KEYS.includes(k) && v > 0) out[k] = (out[k] || 0) + v; };
    if (o.type === 'enclosure') {
      const paid = isObj(o.paid) ? o.paid : (spdef(o.speciesId) || {}).price || {};
      for (const k in paid) add(k, nonNeg(paid[k], 0));
    } else {
      const b = bdef(o.buildingId);
      if (!b) return {};
      for (const k in b.cost || {}) add(k, nonNeg(b.cost[k], 0));
      const U = upCfg(), base = nonNeg(b.cost && b.cost.coins, 0) || 100;
      if ((U.kinds || []).includes(b.kind)) {
        let spent = 0;
        for (let lv = 1; lv < clampInt(o.level, 1, U.maxLevel, 1); lv++) spent += niceRound(base * Math.pow(num(U.costMult, 1.5), lv));
        add('coins', spent);
      }
    }
    return out;
  }
  function sell(objId) {
    const f = find(objId);
    if (!f) return fail('Objet introuvable');
    const o = f.obj;
    if (o.fixed) return fail('Ce bâtiment ne peut pas être vendu');
    const refund = sellValue(o);
    if (o.type === 'enclosure') {
      const pend = Math.floor(pendingRaw(o));
      if (pend > 0) refund.coins = (refund.coins || 0) + pend;
    }
    const list = state.parks[f.park].objects;
    list.splice(list.indexOf(o), 1);
    giveRaw(refund);
    emit('sell', { park: f.park, obj: o, refund });
    changed();
    return { ok: true, refund };
  }
  function remainingSec(o) {
    const t = now();
    if (o.type === 'enclosure' && !o.hatched && finite(o.hatchAt)) return Math.max(0, (o.hatchAt - t) / 1000);
    if (o.type === 'building' && finite(o.readyAt)) return Math.max(0, (o.readyAt - t) / 1000);
    return 0;
  }
  /** Dollars to finish an egg or a production now (0 when nothing to speed up). */
  function speedUpCost(ref) {
    const o = resolveObj(ref);
    if (!o) return 0;
    const sec = remainingSec(o);
    return sec > 0 ? speedUpDollars(sec) : 0;
  }
  function speedUp(objId) {
    const f = find(objId);
    if (!f) return fail('Objet introuvable');
    const o = f.obj, cost = speedUpCost(o);
    if (!cost) return fail('Rien à accélérer');
    if (!payRaw({ dollars: cost })) return fail('Pas assez de dollars');
    const t = now();
    if (o.type === 'enclosure') o.hatchAt = t; else o.readyAt = t;
    emit('speedup', { park: f.park, obj: o, cost: { dollars: cost } });
    changed();
    return { ok: true, cost: { dollars: cost } };
  }

  // ---------------------------------------------------------------------------
  // Parks
  // ---------------------------------------------------------------------------
  function parkStatus(park) {
    const P = parkDef(park);
    if (!state || !PARKS.includes(park)) return null;
    const unlocked = !!state.parks[park].unlocked;
    const needLevel = P ? P.unlockLevel : 1, cost = (P && P.unlockCost) || {};
    return { park, unlocked, needLevel, cost, levelOk: state.player.level >= needLevel, canUnlock: !unlocked && state.player.level >= needLevel && canAfford(cost) };
  }
  function unlockPark(park) {
    if (!state || !PARKS.includes(park)) return fail('Parc inconnu');
    if (state.parks[park].unlocked) return fail('Parc déjà débloqué');
    const st = parkStatus(park);
    if (!st.levelOk) return fail('Niveau ' + st.needLevel + ' requis');
    if (!payRaw(st.cost)) return fail(missingReason(st.cost));
    state.parks[park].unlocked = true;
    ensureFixed(park);
    emit('unlock', { park });
    changed();
    return { ok: true, park };
  }
  function setPark(park) {
    if (!state || !PARKS.includes(park)) return fail('Parc inconnu');
    if (!state.parks[park].unlocked) return fail('Parc verrouillé');
    state.current = park;
    emit('park', { park });
    changed();
    return { ok: true, park };
  }

  // ---------------------------------------------------------------------------
  // DNA research in several steps (§11.8)
  // ---------------------------------------------------------------------------
  const rCfg = () => cfg('RESEARCH');
  function stepsFor(sp) {
    const R = rCfg();
    return Math.max(1, Math.round(num(R.steps && R.steps[sp.rarity], FB.RESEARCH.steps[sp.rarity] || 3)));
  }
  /** {done, steps} for a species (steps 0 when it needs no research). */
  function researchSteps(id) {
    const sp = spdef(id);
    if (!sp || !sp.research || !state) return { done: 0, steps: 0 };
    const steps = stepsFor(sp);
    const done = state.researched[id] ? steps : clampInt(state.researchProgress[id], 0, steps, 0);
    return { done, steps };
  }
  const attemptCost = sp => ({ coins: Math.ceil(nonNeg(sp.research.cost, 0) / stepsFor(sp)) });
  const researchChance = (sp, boost) => Math.min(num(rCfg().maxChance, 95), nonNeg(sp.research.chance, 50) + (boost ? num(rCfg().boostChance, 20) : 0));
  const researchDur = sp => nonNeg(rCfg().durationSec && rCfg().durationSec[sp.rarity], FB.RESEARCH.durationSec[sp.rarity] || 10);
  /** Everything the lab panel needs for a species. */
  function researchInfo(id) {
    const sp = spdef(id);
    if (!sp || !sp.research || !state) return null;
    const R = rCfg(), st = researchSteps(id);
    return { speciesId: id, cost: attemptCost(sp), chance: researchChance(sp, false), boostedChance: researchChance(sp, true),
      boostCost: clone(R.boostCost), retryCost: clone(R.retryCost), durationSec: researchDur(sp),
      done: st.done, steps: st.steps, complete: isResearched(id), active: researchingNow(id), status: speciesStatus(id).state };
  }
  function startResearch(id, boost) {
    const sp = spdef(id);
    if (!sp || !state) return fail('Créature inconnue');
    if (!sp.research) return fail('Pas besoin de recherche ADN pour cette espèce');
    if (isResearched(id)) return fail('Recherche déjà terminée');
    if (state.player.level < sp.level) return fail('Niveau ' + sp.level + ' requis');
    if (!state.parks[sp.park].unlocked) return fail('Débloque d’abord le ' + parkName(sp.park));
    const r = state.research;
    if (r && r.result === null) return fail('Une recherche est déjà en cours');
    const x = state.expedition;
    if (x && x.speciesId === id && x.result === null) return fail('Une expédition cherche déjà cet ADN');
    const cost = attemptCost(sp);
    if (boost) for (const k in rCfg().boostCost || {}) cost[k] = (cost[k] || 0) + rCfg().boostCost[k];
    if (!payRaw(cost)) return fail(missingReason(cost));
    const t = now(), st = researchSteps(id);
    state.research = { speciesId: id, startedAt: t, endsAt: t + researchDur(sp) * 1000, chance: researchChance(sp, !!boost),
      boosted: !!boost, result: null, step: st.done, steps: st.steps, complete: false, cost, retries: 0 };
    emit('researchStart', { speciesId: id, research: state.research });
    changed();
    return { ok: true, research: state.research, cost };
  }
  /** Resolve the running attempt when its time is up. Returns true when something happened. */
  function resolveResearch() {
    const r = state.research;
    if (!r || r.result !== null || now() < r.endsAt) return false;
    const sp = spdef(r.speciesId);
    if (!sp || !sp.research) { state.research = null; return true; }
    const success = Math.random() * 100 < r.chance;
    const c = state.counters;
    c.researchAttempts++;
    let complete = false;
    if (success) {
      c.researchSuccess++;
      const st = researchSteps(r.speciesId);
      const done = Math.min(st.steps, st.done + 1);
      state.researchProgress[r.speciesId] = done;
      if (done >= st.steps) { state.researched[r.speciesId] = true; complete = true; c.researchComplete++; }
    }
    const st = researchSteps(r.speciesId);
    r.result = success; r.step = st.done; r.steps = st.steps; r.complete = complete;
    emit('research', { speciesId: r.speciesId, success, step: st.done, steps: st.steps, complete });
    addXPRaw(xpCfg('researchAttempt') + (success ? xpCfg('researchSuccess') : 0));
    return true;
  }
  /** After a failed attempt: re-run the same attempt for RESEARCH.retryCost (1 dollar), no coins. */
  function retryResearch() {
    const r = state && state.research;
    if (!r) return fail('Aucune recherche à réessayer');
    if (r.result === null) return fail('Une recherche est déjà en cours');
    if (r.result === true) return fail('La dernière tentative a réussi');
    if (isResearched(r.speciesId)) { state.research = null; changed(); return fail('Recherche déjà terminée'); }
    const cost = clone(rCfg().retryCost || { dollars: 1 });
    if (!payRaw(cost)) return fail(missingReason(cost));
    const sp = spdef(r.speciesId), t = now();
    r.startedAt = t; r.endsAt = t + researchDur(sp) * 1000; r.result = null; r.retries = (r.retries || 0) + 1;
    emit('researchStart', { speciesId: r.speciesId, research: r, retry: true });
    changed();
    return { ok: true, research: r, cost };
  }
  /** Clear a finished attempt (the lab shows the result until then). */
  function ackResearch() {
    if (!state || !state.research || state.research.result === null) return false;
    state.research = null;
    changed();
    return true;
  }
  function speedUpResearch() {
    const r = state && state.research;
    if (!r || r.result !== null) return fail('Aucune recherche en cours');
    const cost = { dollars: speedUpDollars((r.endsAt - now()) / 1000) };
    if (!payRaw(cost)) return fail('Pas assez de dollars');
    r.endsAt = now();
    resolveResearch();
    changed();
    return { ok: true, cost, success: r.result, complete: r.complete };
  }

  // ---------------------------------------------------------------------------
  // DNA expeditions + flash promo (§11.8)
  // ---------------------------------------------------------------------------
  const eCfg = () => cfg('EXPEDITION');
  const promoCfg = () => Object.assign({}, FB.EXPEDITION.promo, isObj(eCfg().promo) ? eCfg().promo : {});
  function promoDiscount(kind) {
    const p = state && state.promo;
    return p && p.until > now() && (!kind || p.kind === kind) ? clamp(num(p.discount, 0), 0, 0.9) : 0;
  }
  function promoInfo() {
    const p = state && state.promo;
    if (!p || p.until <= now()) return null;
    return { kind: p.kind, until: p.until, discount: p.discount, remainingSec: Math.ceil((p.until - now()) / 1000) };
  }
  /** Species an expedition can look for (research needed, level ok, park unlocked). */
  function expeditionTargets(park) {
    if (!state) return [];
    const out = [];
    for (const id in PC.SPECIES || {}) {
      const sp = PC.SPECIES[id];
      if (park && sp.park !== park) continue;
      if (!sp.research || isResearched(id) || state.player.level < sp.level || !state.parks[sp.park].unlocked) continue;
      out.push(id);
    }
    return out;
  }
  function normExpArgs(park, speciesId) {
    if (speciesId == null && spdef(park)) return { park: spdef(park).park, speciesId: park };
    return { park, speciesId };
  }
  function expeditionInfo(park, speciesId) {
    ({ park, speciesId } = normExpArgs(park, speciesId));
    const sp = spdef(speciesId);
    if (!sp || !state) return null;
    const E = eCfg(), r = sp.rarity;
    const pick = (tbl, d) => nonNeg(tbl && tbl[r], (FB.EXPEDITION[d] || {})[r] || 0);
    // Never cheaper than decoding the DNA step by step: at least costMult × the species' research cost.
    const resCost = sp.research ? nonNeg(sp.research.cost, 0) * nonNeg(E.costMult, 1) : 0;
    const baseCost = Math.max(Math.round(pick(E.cost, 'cost')), resCost ? niceRound(resCost) : 0);
    const discount = promoDiscount('expedition');
    const coins = discount ? niceRound(baseCost * (1 - discount)) : baseCost;
    const pk = PARKS.includes(park) ? park : sp.park;
    return { park: pk, speciesId, cost: { coins }, baseCost: { coins: baseCost }, discount,
      durationSec: pick(E.durationSec, 'durationSec'), chance: clamp(pick(E.chance, 'chance'), 0, 100),
      buyDollars: Math.max(1, Math.round(pick(E.buyDollars, 'buyDollars'))),
      vehicle: (E.vehicle && E.vehicle[pk]) || FB.EXPEDITION.vehicle[pk] };
  }
  function startExpedition(park, speciesId) {
    ({ park, speciesId } = normExpArgs(park, speciesId));
    const sp = spdef(speciesId);
    if (!sp || !state) return fail('Créature inconnue');
    if (park != null && park !== sp.park) return fail('Cette espèce ne vit pas dans ce parc');
    if (!sp.research) return fail('Pas besoin de recherche ADN pour cette espèce');
    if (isResearched(speciesId)) return fail('Recherche déjà terminée');
    if (state.player.level < sp.level) return fail('Niveau ' + sp.level + ' requis');
    if (!state.parks[sp.park].unlocked) return fail('Débloque d’abord le ' + parkName(sp.park));
    if (state.expedition && state.expedition.result === null) return fail('Une expédition est déjà en route');
    const r = state.research;
    if (r && r.speciesId === speciesId && r.result === null) return fail('Une recherche est déjà en cours pour cette espèce');
    const info = expeditionInfo(sp.park, speciesId);
    if (!payRaw(info.cost)) return fail(missingReason(info.cost));
    const t = now();
    state.expedition = { park: sp.park, speciesId, startedAt: t, endsAt: t + info.durationSec * 1000, cost: info.cost,
      chance: info.chance, result: null, buyDollars: info.buyDollars, vehicle: info.vehicle };
    emit('expedition', { status: 'start', expedition: state.expedition });
    changed();
    return { ok: true, expedition: state.expedition, cost: info.cost };
  }
  function completeResearch(id) {
    const st = researchSteps(id);
    state.researchProgress[id] = st.steps;
    if (!state.researched[id]) state.counters.researchComplete++;
    state.researched[id] = true;
  }
  function resolveExpedition() {
    const x = state.expedition;
    if (!x || x.result !== null || now() < x.endsAt) return false;
    const sp = spdef(x.speciesId);
    if (!sp) { state.expedition = null; return true; }
    const success = Math.random() * 100 < x.chance;
    state.counters.expeditions++;
    x.result = success;
    const name = sp.name;
    if (success) {
      completeResearch(x.speciesId);
      const st = researchSteps(x.speciesId);
      emit('expedition', { status: 'success', expedition: x });
      emit('research', { speciesId: x.speciesId, success: true, step: st.steps, steps: st.steps, complete: true, source: 'expedition' });
      toast('Expédition réussie : ambre ADN du ' + name + ' trouvé !', 'good');
    } else {
      emit('expedition', { status: 'fail', expedition: x, buyDollars: x.buyDollars });
      toast('L’expédition est rentrée bredouille… Dernière chance au labo !', 'info');
    }
    addXPRaw(xpCfg('researchAttempt'));
    return true;
  }
  /** « Dernière chance » after a failed expedition: buy the amber for dollars. */
  function buyExpeditionDNA() {
    const x = state && state.expedition;
    if (!x || x.result !== false) return fail('Aucune ambre à acheter');
    const cost = { dollars: x.buyDollars };
    if (!payRaw(cost)) return fail('Pas assez de dollars');
    completeResearch(x.speciesId);
    state.expedition = null;
    const st = researchSteps(x.speciesId);
    emit('expedition', { status: 'bought', expedition: x });
    emit('research', { speciesId: x.speciesId, success: true, step: st.steps, steps: st.steps, complete: true, source: 'amber' });
    changed();
    return { ok: true, speciesId: x.speciesId, cost };
  }
  /** Close a finished expedition (refuse the amber offer, or acknowledge a success). */
  function declineExpedition() {
    const x = state && state.expedition;
    if (!x || x.result === null) return fail('Aucune expédition terminée');
    state.expedition = null;
    emit('expedition', { status: 'closed', expedition: x });
    changed();
    return { ok: true };
  }
  function speedUpExpedition() {
    const x = state && state.expedition;
    if (!x || x.result !== null) return fail('Aucune expédition en route');
    const cost = { dollars: speedUpDollars((x.endsAt - now()) / 1000) };
    if (!payRaw(cost)) return fail('Pas assez de dollars');
    x.endsAt = now();
    resolveExpedition();
    changed();
    return { ok: true, cost, success: x.result };
  }
  /** « EXPÉDITION FLASH ! »: at most once per promo.everySec, lasts promo.durationSec. */
  function promoTick(t) {
    let dirty = false;
    if (state.promo && !(state.promo.until > t)) { state.promo = null; emit('promo', { status: 'end' }); dirty = true; }
    if (!state.promo && t >= num(state.promoNextAt, 0) && expeditionTargets().length) {
      const P = promoCfg();
      state.promo = { kind: 'expedition', until: t + nonNeg(P.durationSec, 300) * 1000, discount: clamp(num(P.discount, 0.3), 0, 0.9) };
      state.promoNextAt = t + nonNeg(P.everySec, 1800) * 1000 * (1 + Math.random());
      emit('promo', Object.assign({ status: 'start' }, state.promo));
      dirty = true;
    }
    return dirty;
  }

  // ---------------------------------------------------------------------------
  // Missions (story + side)
  // ---------------------------------------------------------------------------
  const sumMap = o => { let s = 0; for (const k in o || {}) s += +o[k] || 0; return s; };
  /** Counter value behind a "since start" goal, or null for absolute goals. */
  function counterValue(c, g) {
    switch (g.type) {
      case 'build': return g.building ? c.built[g.building] || 0 : g.kind ? c.builtKind[g.kind] || 0 : sumMap(c.builtKind);
      case 'hatch': return g.species ? c.hatched[g.species] || 0 : g.park ? c.hatchedPark[g.park] || 0 : sumMap(c.hatchedPark);
      case 'feed': return c.feeds || 0;
      case 'collect': return c.collected[g.res] || 0;
      case 'research': return (g.success ? c.researchSuccess : c.researchAttempts) || 0;
      case 'win_battle': return g.park ? (c.battlesWon || {})[g.park] || 0 : sumMap(c.battlesWon);
      case 'activate': return c.activated || 0;
      case 'upgrade': return c.upgrades || 0;
      case 'cards': return c.packs || 0;
      case 'expedition': return c.expeditions || 0;
    }
    return null;
  }
  function goalTarget(g) {
    return Math.max(1, Math.round(num(g.count, num(g.amount, num(g.level, num(g.stage, 1))))));
  }
  /** {progress, target, done} of a goal; `base` = counters snapshot at mission start. */
  function goalProgress(g, base) {
    if (!isObj(g)) return { progress: 0, target: 1, done: false };
    const target = g.type === 'unlock_park' ? 1 : goalTarget(g);
    let progress = 0;
    const rel = counterValue(state.counters, g);
    if (rel !== null) progress = rel - (counterValue(base || state.counters, g) || 0);
    else {
      switch (g.type) {
        case 'own_building':
          progress = allObjects().filter(o => {
            if (o.type !== 'building' || o.fixed) return false;
            if (g.building) return o.buildingId === g.building;
            const b = bdef(o.buildingId);
            return !!b && (!g.kind || b.kind === g.kind);
          }).length;
          break;
        case 'own_species': {
          const parks = g.park ? [g.park] : PARKS;
          const set = new Set();
          for (const p of parks) if (state.parks[p]) for (const o of state.parks[p].objects) if (o.type === 'enclosure' && o.hatched) set.add(o.speciesId);
          progress = set.size;
          break;
        }
        case 'creature_level':
          for (const p of g.park ? [g.park] : PARKS) for (const o of (state.parks[p] || {}).objects || []) {
            if (o.type === 'enclosure' && o.hatched && (!g.species || o.speciesId === g.species)) progress = Math.max(progress, o.level || 1);
          }
          break;
        case 'battle_stage': progress = (state.battles || {})[g.park] || 0; break;
        case 'player_level': progress = state.player.level; break;
        case 'unlock_park': progress = state.parks[g.park] && state.parks[g.park].unlocked ? 1 : 0; break;
      }
    }
    progress = Math.max(0, Math.floor(progress));
    return { progress: Math.min(progress, target), target, done: progress >= target };
  }
  /** Active story mission {def, index, progress, target, done}, or null when the story is finished. */
  function mission() {
    if (!state) return null;
    const list = missionsList(), i = state.mission.index;
    const def = list[i];
    if (!def) return null;
    const p = goalProgress(def.goal, state.mission.base);
    return { def, index: i, progress: p.done || state.mission.done ? p.target : p.progress, target: p.target, done: p.done || !!state.mission.done, total: list.length };
  }
  function claimMission() {
    const m = mission();
    if (!m) return fail('Toutes les missions sont terminées');
    if (!m.done) return fail('Mission pas encore terminée');
    const reward = clone(m.def.reward || {});
    state.mission = { index: m.index + 1, id: missionIdAt(m.index + 1), base: clone(state.counters), done: false };
    giveRaw(reward);
    const next = mission();
    emit('mission', { mission: next ? next.def : null, index: m.index + 1, status: next ? 'new' : 'finished', previous: m.def });
    changed();
    return { ok: true, reward, next: next ? next.def : null };
  }

  // ----- side missions -----
  const sideCfg = () => {
    const S = DATA().SIDE_MISSIONS;
    return isObj(S) && Array.isArray(S.templates) && S.templates.length ? Object.assign({ count: 3 }, S) : FB.SIDE_MISSIONS;
  };
  function sideNeedOk(need, tpl) {
    const objs = [];
    for (const p of PARKS) if (state.parks[p].unlocked) for (const o of state.parks[p].objects) objs.push(o);
    switch (need) {
      case 'creature': return objs.some(o => o.type === 'enclosure');
      case 'battle': return objs.some(o => o.type === 'enclosure' && o.hatched);
      case 'farm': return objs.some(o => o.type === 'building' && (bdef(o.buildingId) || {}).kind === 'food');
      case 'shop': return objs.some(o => o.type === 'building' && (bdef(o.buildingId) || {}).kind === 'coins');
      case 'hatch': return objs.some(o => o.type === 'enclosure' && !o.hatched) ||
        Object.keys(PC.SPECIES || {}).some(id => {
          // A limited offer only counts when the player can pay for it right now.
          const st = speciesStatus(id);
          return st.state === 'available' && (!st.offer || canAfford(st.price));
        });
      case 'research': return Object.keys(PC.SPECIES || {}).some(id => ['research', 'researching'].includes(speciesStatus(id).state));
      case 'expedition': return expeditionTargets().length > 0;
      case 'upgrade': return objs.some(o => upgradeCost(o) !== null);
      case 'farmroom': {
        const max = Math.max(1, num(tpl && tpl.maxFarms, 4));
        const isFarm = o => o.type === 'building' && (bdef(o.buildingId) || {}).kind === 'food';
        return PARKS.some(p => state.parks[p].unlocked && state.parks[p].objects.filter(isFarm).length < max &&
          Object.values(DATA().BUILDINGS || {}).some(b => b && b.park === p && b.kind === 'food' && !b.fixed && num(b.level, 1) <= state.player.level));
      }
    }
    return true;
  }
  /** Park whose food a "collect food" side mission asks for: current park if it has a farm, else any. */
  function sideFoodPark() {
    const hasFarm = p => state.parks[p].unlocked && state.parks[p].objects.some(o => o.type === 'building' && (bdef(o.buildingId) || {}).kind === 'food');
    if (hasFarm(state.current)) return state.current;
    return PARKS.find(hasFarm) || state.current;
  }
  function fillText(t, n, food) {
    const s = Array.isArray(t) ? (n > 1 ? t[1] || t[0] : t[0]) : String(t || '');
    return s.replace(/\{n\}/g, fmtNum(n)).replace(/\{food\}/g, food || '');
  }
  function makeSide(tpl) {
    const L = state.player.level;
    const n0 = Array.isArray(tpl.n) ? tpl.n : [1, 0, 1];
    let n = Math.round(num(n0[0], 1) + num(n0[1], 0) * (L - 1));
    if (tpl.round > 1) n = Math.round(n / tpl.round) * tpl.round;
    n = clamp(n, 1, num(n0[2], n) || n);
    const goal = clone(tpl.goal || { type: 'feed' });
    let icon = tpl.icon || 'star', food = '';
    if (goal.res === 'food' || icon === 'food') {
      const fp = sideFoodPark();
      if (goal.res === 'food') goal.res = foodOf(fp);
      if (icon === 'food') icon = foodOf(fp);
      food = RES_WORDS[foodOf(fp)] || '';
    }
    if (goal.type === 'collect') goal.amount = n; else goal.count = n;
    const reward = {};
    for (const k in tpl.reward || {}) {
      const r = tpl.reward[k], v = Array.isArray(r) ? num(r[0], 0) + num(r[1], 0) * (L - 1) : num(r, 0);
      const val = k === 'coins' ? niceRound(v) : Math.round(v);
      if (val > 0) reward[k] = val;
    }
    return { id: 'side_' + tpl.id + '_' + now().toString(36) + Math.floor(Math.random() * 1e4).toString(36), tpl: tpl.id,
      icon, npc: tpl.npc || 'tom', title: tpl.title || 'Mission secondaire', text: fillText(tpl.text, n, food),
      goal, reward, base: clone(state.counters), done: false, createdAt: now() };
  }
  function genSide(exclude) {
    const S = sideCfg(), L = state.player.level;
    const ok = S.templates.filter(t => t && t.id && (t.minLevel || 1) <= L && !exclude.has(t.id) && GOAL_TYPES.includes((t.goal || {}).type));
    const good = ok.filter(t => sideNeedOk(t.needs, t));
    const pool = good.length ? good : ok.length ? ok : S.templates.filter(t => t && t.goal);
    if (!pool.length) return null;
    let total = 0;
    for (const t of pool) total += Math.max(0.01, num(t.weight, 1));
    let r = Math.random() * total;
    for (const t of pool) { r -= Math.max(0.01, num(t.weight, 1)); if (r <= 0) return makeSide(t); }
    return makeSide(pool[pool.length - 1]);
  }
  /** Keep `count` side missions. Returns true when one was added. */
  function ensureSide() {
    if (!state) return false;
    if (!Array.isArray(state.sideMissions)) state.sideMissions = [];
    const count = clampInt(sideCfg().count, 0, 6, 3);
    let added = false;
    while (state.sideMissions.length < count) {
      const s = genSide(new Set(state.sideMissions.map(x => x.tpl)));
      if (!s) break;
      state.sideMissions.push(s);
      added = true;
    }
    return added;
  }
  /** [{def, index, progress, target, done}] for the « Missions secondaires ». */
  function sideMissions() {
    if (!state) return [];
    return state.sideMissions.map((d, i) => {
      const p = goalProgress(d.goal, d.base);
      const done = p.done || !!d.done;
      return { def: d, index: i, progress: done ? p.target : p.progress, target: p.target, done };
    });
  }
  function claimSide(i) {
    if (!state) return fail('Mission introuvable');
    i = Math.round(+i);
    const d = state.sideMissions[i];
    if (!d) return fail('Mission introuvable');
    const p = goalProgress(d.goal, d.base);
    if (!p.done && !d.done) return fail('Mission pas encore terminée');
    const reward = clone(d.reward || {});
    const exclude = new Set(state.sideMissions.map(x => x.tpl));
    const next = genSide(exclude) || genSide(new Set(state.sideMissions.filter((x, j) => j !== i).map(x => x.tpl)));
    if (next) state.sideMissions[i] = next; else state.sideMissions.splice(i, 1);
    giveRaw(reward);
    emit('side', { index: i, mission: next, status: 'new', previous: d, reward });
    changed();
    return { ok: true, reward, next };
  }
  /** Emit 'complete' events once per mission. */
  function checkMissions() {
    if (!state) return;
    const m = mission();
    if (m && m.done && !state.mission.done) {
      state.mission.done = true;
      emit('mission', { mission: m.def, index: m.index, status: 'complete' });
    }
    state.sideMissions.forEach((d, i) => {
      if (d.done) return;
      if (goalProgress(d.goal, d.base).done) {
        d.done = true;
        emit('side', { index: i, mission: d, status: 'complete' });
        toast('Mission secondaire réussie : ' + d.title, 'good');
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Battles: teams, enemies per medal tier, records (§5 + §11.4)
  // ---------------------------------------------------------------------------
  const medCfg = () => cfg('MEDALS');
  const stageDef = (park, stage) => stagesOf(park)[Math.round(+stage) - 1] || null;
  function battleTeam(park) {
    if (!state) return [];
    if (!PARKS.includes(park)) park = state.current;
    return creaturesOf(park, true).slice().sort((a, b) => (b.level || 1) - (a.level || 1) ||
      rarityIdx((spdef(b.speciesId) || {}).rarity) - rarityIdx((spdef(a.speciesId) || {}).rarity));
  }
  /** Enemy list for a stage at a medal tier (1 Bronze, 2 Argent: +5 levels and +1 enemy, 3 Or: +10 levels, 3 enemies). */
  function battleEnemies(park, stage, tier) {
    const st = stageDef(park, stage);
    if (!st || !Array.isArray(st.enemies)) return [];
    tier = clampInt(tier, 1, 3, 1);
    const M = medCfg(), bonus = num((M.levelBonus || [])[tier - 1], [0, 5, 10][tier - 1]);
    const maxL = maxCreatureLevel();
    const base = st.enemies.filter(e => spdef(e.species));
    const list = base.map(e => ({ species: e.species, level: clampInt(e.level + bonus, 1, maxL, 1) }));
    const want = tier === 1 ? list.length : tier === 2 ? Math.min(3, list.length + 1) : Math.max(3, list.length);
    if (list.length < want && base.length) {
      const topLevel = Math.max(...base.map(e => spdef(e.species).level));
      const avg = Math.round(base.reduce((s, e) => s + e.level, 0) / base.length);
      const order = (PC.SPECIES_ORDER && PC.SPECIES_ORDER[park]) || [];
      const free = order.filter(id => spdef(id) && !spdef(id).offerOnly && !list.some(e => e.species === id));
      // Prefer species no more advanced than the stage's own (strongest first, rotated by stage),
      // then the next easiest ones when the park has too few of them.
      const near = free.filter(id => spdef(id).level <= topLevel).sort((a, b) => spdef(b).level - spdef(a).level || order.indexOf(a) - order.indexOf(b));
      const above = free.filter(id => spdef(id).level > topLevel).sort((a, b) => spdef(a).level - spdef(b).level || order.indexOf(a) - order.indexOf(b));
      let k = Math.round(+stage) || 0;
      while (list.length < want && (near.length || above.length)) {
        const src = near.length ? near : above;
        const pickI = near.length ? k % Math.min(3, near.length) : 0;
        list.push({ species: src[pickI], level: clampInt(avg + bonus, 1, maxL, 1) });
        src.splice(pickI, 1);
        k++;
      }
    }
    return list;
  }
  function medal(park, stage) {
    if (!state || !state.medals[park]) return 0;
    return clampInt(state.medals[park][stage], 0, 3, 0);
  }
  /** Can this stage / tier be fought? Next stage opens after Bronze, Argent after Bronze, Or after Argent. */
  function battleUnlocked(park, stage, tier) {
    if (!state || !PARKS.includes(park) || !state.parks[park].unlocked) return false;
    stage = Math.round(+stage); tier = clampInt(tier, 1, 3, 1);
    if (!stageDef(park, stage)) return false;
    if (tier === 1) return stage === 1 || medal(park, stage - 1) >= 1 || state.battles[park] >= stage - 1;
    return medal(park, stage) >= tier - 1;
  }
  function scaleReward(r, m) {
    const out = {};
    for (const k in r || {}) {
      const v = nonNeg(r[k], 0) * m;
      const val = k === 'coins' && m !== 1 ? niceRound(v) : Math.round(v);
      if (val > 0) out[k] = val;
    }
    return out;
  }
  /** Reward a win of (park, stage, tier) would give now: full tier reward on first clear, else replay coins. */
  function winReward(st, park, stage, tier) {
    const M = medCfg();
    const tierReward = scaleReward(st.reward, num((M.rewardMult || [])[tier - 1], [1, 1.5, 2.2][tier - 1]));
    if (tier > medal(park, stage)) return { reward: tierReward, first: true };
    const coins = Math.round((tierReward.coins || 0) * num(M.replayCoins, 0.3));
    return { reward: coins > 0 ? { coins: niceRound(coins) } : { xp: 5 }, first: false };
  }
  /** Preview of the reward for winning a stage at a tier (used by the tournament screen). */
  function battleReward(park, stage, tier) {
    const st = stageDef(park, stage);
    if (!state || !st || !PARKS.includes(park)) return {};
    return winReward(st, park, Math.round(+stage), clampInt(tier, 1, 3, 1)).reward;
  }
  /** Record a fight result; returns the reward given (first clear of a tier = full tier reward). */
  function recordBattle(park, stage, won, tier) {
    const st = stageDef(park, stage);
    if (!state || !st || !PARKS.includes(park)) return {};
    stage = Math.round(+stage); tier = clampInt(tier, 1, 3, 1);
    if (!battleUnlocked(park, stage, tier)) return {};
    const M = medCfg();
    let reward, first = false;
    if (won) {
      state.counters.battlesWon[park] = (state.counters.battlesWon[park] || 0) + 1;
      ({ reward, first } = winReward(st, park, stage, tier));
      if (first) {
        state.medals[park][stage] = tier;
        if (tier === 1) state.battles[park] = Math.max(state.battles[park] || 0, stage);
      }
    } else {
      reward = { xp: Math.max(0, Math.round(num(M.lossXp, 5))) };
    }
    emit('battle', { park, stage, tier, won: !!won, reward, first, medal: medal(park, stage) });
    giveRaw(reward);
    changed();
    return reward;
  }

  // ---------------------------------------------------------------------------
  // Card packs
  // ---------------------------------------------------------------------------
  const cardsCfg = () => cfg('CARDS');
  function cardsReady() { return !!state && now() >= num(state.cards.nextFreeAt, 0); }
  /** Seconds until the next free pack (0 when ready). */
  function cardsIn() { return state ? Math.max(0, Math.ceil((num(state.cards.nextFreeAt, 0) - now()) / 1000)) : 0; }
  function openPack(paid) {
    if (!state) return fail('Jeu non démarré');
    const C = cardsCfg();
    const table = (Array.isArray(C.table) ? C.table : FB.CARDS.table)
      .filter(c => c && isObj(c.reward) && (!c.park || (state.parks[c.park] && state.parks[c.park].unlocked)));
    if (!table.length) return fail('Aucune carte disponible');
    if (paid) {
      if (!payRaw(C.packCost)) return fail(missingReason(C.packCost));
    } else if (!cardsReady()) {
      return fail('Prochain paquet gratuit dans ' + fmtTime(cardsIn()));
    }
    let total = 0;
    for (const c of table) total += Math.max(0, num(c.weight, 1));
    const cards = [];
    const n = clampInt(C.perPack, 1, 10, 3);
    for (let i = 0; i < n; i++) {
      let r = Math.random() * total, pick = table[table.length - 1];
      for (const c of table) { r -= Math.max(0, num(c.weight, 1)); if (r < 0) { pick = c; break; } }
      cards.push({ label: pick.label || '', reward: clone(pick.reward), rarity: pick.rarity || 'commun' });
    }
    if (!paid) state.cards.nextFreeAt = now() + nonNeg(C.freeEverySec, 600) * 1000;
    state.counters.packs++;
    for (const c of cards) giveRaw(c.reward);
    emit('cards', { cards, paid: !!paid });
    changed();
    return { ok: true, cards };
  }

  // ---------------------------------------------------------------------------
  // Save / load / repair
  // ---------------------------------------------------------------------------
  function storage() {
    try { return (typeof window !== 'undefined' && window.localStorage) || null; } catch (e) { return null; }
  }
  function save() {
    if (!state) return false;
    try {
      state.savedAt = now();
      lastSaveAt = now();
      const ls = storage();
      if (!ls) return false;
      ls.setItem(SAVE_KEY, JSON.stringify(state));
      return true;
    } catch (e) { return false; }
  }
  function readSave() {
    try {
      const ls = storage();
      const raw = ls && ls.getItem(SAVE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  /** Valid cost / reward object (resources only, plus xp when `withXp`), or null. */
  const cleanCost = (c, withXp) => {
    if (!isObj(c)) return null;
    const out = {};
    for (const k in c) if ((RES_KEYS.includes(k) || (withXp && k === 'xp')) && nonNeg(c[k], 0) > 0) out[k] = Math.round(c[k]);
    return out;
  };
  function cleanCounters(c) {
    const d = defaultCounters();
    if (!isObj(c)) return d;
    for (const k of MAP_KEYS) if (isObj(c[k])) for (const kk in c[k]) d[k][kk] = nonNeg(c[k][kk], 0);
    for (const k of SCALAR_KEYS) d[k] = nonNeg(c[k], 0);
    if (isObj(c.battlesWon)) for (const p of PARKS) d.battlesWon[p] = nonNeg(c.battlesWon[p], 0);
    return d;
  }
  /** Mission baseline: missing top-level fields default to the current counters (progress 0, never instant). */
  function cleanBase(base, counters) {
    const d = clone(counters);
    if (!isObj(base)) return d;
    for (const k of MAP_KEYS) if (isObj(base[k])) {
      d[k] = {};
      for (const kk in base[k]) d[k][kk] = nonNeg(base[k][kk], 0);
    }
    for (const k of SCALAR_KEYS) if (finite(+base[k]) && base[k] !== null) d[k] = nonNeg(base[k], d[k]);
    if (isObj(base.battlesWon)) for (const p of PARKS) d.battlesWon[p] = nonNeg(base.battlesWon[p], d.battlesWon[p]);
    return d;
  }
  function cleanObj(o, park, t) {
    if (!isObj(o)) return null;
    const id = finite(+o.id) && o.id !== null ? Math.floor(+o.id) : null;
    const gx = Number.isInteger(+o.gx) && o.gx !== null ? +o.gx : null;
    const gy = Number.isInteger(+o.gy) && o.gy !== null ? +o.gy : null;
    let c;
    if (o.type === 'enclosure') {
      const sp = spdef(o.speciesId);
      if (!sp) return null;
      const [w, h] = enclosureSize(sp.park);
      c = { id, type: 'enclosure', gx, gy, w, h, speciesId: o.speciesId,
        name: typeof o.name === 'string' && o.name ? o.name.slice(0, 40) : randomName(),
        level: clampInt(o.level, 1, maxCreatureLevel(), 1), feeds: clampInt(o.feeds, 0, 99, 0),
        hatched: !!o.hatched, hatchAt: null, coins: nonNeg(o.coins, 0), lastAt: null,
        paid: cleanCost(o.paid) || cleanCost(sp.price) || {} };
      if (c.hatched) c.lastAt = Math.min(num(o.lastAt, t), t);
      else { c.hatchAt = num(o.hatchAt, t); c.coins = 0; }
    } else if (o.type === 'building') {
      const b = bdef(o.buildingId);
      if (!b) return null;
      c = { id, type: 'building', gx, gy, w: b.size[0], h: b.size[1], buildingId: o.buildingId };
      if (b.kind === 'special' || b.fixed) c.fixed = true;
      else c.level = clampInt(o.level, 1, upCfg().maxLevel, 1);
      if (b.kind === 'coins' && b.produce) {
        c.cycleSec = nonNeg(o.cycleSec, b.produce.sec) || b.produce.sec;
        c.readyAt = num(o.readyAt, t + c.cycleSec * 1000);
        c.startedAt = num(o.startedAt, c.readyAt - c.cycleSec * 1000);
      } else if (b.kind === 'food') {
        const orders = buildingOrders(o.buildingId);
        if (finite(+o.readyAt) && o.readyAt !== null && orders.length) {
          c.order = clampInt(o.order, 0, orders.length - 1, 0);
          c.cycleSec = nonNeg(o.cycleSec, orders[c.order].sec) || orders[c.order].sec;
          c.readyAt = +o.readyAt;
          c.startedAt = num(o.startedAt, c.readyAt - c.cycleSec * 1000);
        } else { c.order = null; c.readyAt = null; }
      }
    } else return null;
    // Keep unknown extra fields other modules may have stored (never overriding ours).
    for (const k in o) if (!(k in c)) c[k] = o[k];
    return c;
  }
  function cleanSide(x, counters) {
    if (!isObj(x) || !isObj(x.goal) || !GOAL_TYPES.includes(x.goal.type)) return null;
    // Follow the template's icon when it changed since the save (e.g. roads no longer use the ✓ icon).
    const tpl = sideCfg().templates.find(t => t && t.id === x.tpl);
    const icon = tpl && typeof tpl.icon === 'string' && tpl.icon !== 'food' ? tpl.icon : typeof x.icon === 'string' ? x.icon : 'star';
    return {
      id: String(x.id || 'side_' + Math.random().toString(36).slice(2)), tpl: String(x.tpl || x.goal.type),
      icon, npc: typeof x.npc === 'string' ? x.npc : 'tom',
      title: typeof x.title === 'string' ? x.title : 'Mission secondaire', text: typeof x.text === 'string' ? x.text : '',
      goal: clone(x.goal), reward: cleanCost(x.reward, true) || {}, base: cleanBase(x.base, counters),
      done: !!x.done, createdAt: num(x.createdAt, 0),
    };
  }
  /** Turn any saved object into a valid state (null when unusable). Older saves never crash. */
  function repair(raw) {
    if (!isObj(raw) || !isObj(raw.player)) return null;
    const t = now();
    const s = blankState();
    const P = raw.player;
    s.player.level = clampInt(P.level, 1, maxPlayerLevel(), 1);
    s.player.xp = nonNeg(P.xp, 0);
    for (const k of RES_KEYS) s.player[k] = Math.round(nonNeg(P[k], s.player[k]));
    if (isObj(raw.parks)) for (const p of PARKS) {
      const rp = raw.parks[p];
      if (!isObj(rp)) continue;
      if (p !== 'land') s.parks[p].unlocked = !!rp.unlocked;
      const seen = new Set(), list = [];
      let maxId = ID_BASE[p] - 1;
      for (const o of Array.isArray(rp.objects) ? rp.objects : []) {
        const c = cleanObj(o, p, t);
        if (!c) continue;
        if (c.id === null || seen.has(c.id)) c.id = null; else { seen.add(c.id); maxId = Math.max(maxId, c.id); }
        list.push(c);
      }
      s.parks[p].nextId = Math.max(Math.round(num(rp.nextId, 0)), maxId + 1, ID_BASE[p]);
      for (const c of list) if (c.id === null) c.id = s.parks[p].nextId++;
      s.parks[p].objects = list;
    }
    s.current = PARKS.includes(raw.current) && s.parks[raw.current].unlocked ? raw.current : 'land';
    if (isObj(raw.researched)) for (const id in raw.researched) if (spdef(id) && raw.researched[id]) s.researched[id] = true;
    if (isObj(raw.researchProgress)) for (const id in raw.researchProgress) if (spdef(id)) s.researchProgress[id] = clampInt(raw.researchProgress[id], 0, 20, 0);
    const r = raw.research;
    if (isObj(r) && spdef(r.speciesId) && spdef(r.speciesId).research && finite(+r.endsAt)) {
      s.research = { speciesId: r.speciesId, startedAt: num(r.startedAt, t), endsAt: +r.endsAt, chance: clamp(num(r.chance, 50), 0, 100),
        boosted: !!r.boosted, result: r.result === true || r.result === false ? r.result : null,
        step: clampInt(r.step, 0, 20, 0), steps: clampInt(r.steps, 1, 20, 3), complete: !!r.complete, cost: cleanCost(r.cost) || {}, retries: clampInt(r.retries, 0, 9999, 0) };
    }
    const x = raw.expedition;
    if (isObj(x) && spdef(x.speciesId) && finite(+x.endsAt)) {
      const sp = spdef(x.speciesId);
      s.expedition = { park: sp.park, speciesId: x.speciesId, startedAt: num(x.startedAt, t), endsAt: +x.endsAt,
        cost: cleanCost(x.cost) || {}, chance: clamp(num(x.chance, 50), 0, 100), result: x.result === true || x.result === false ? x.result : null,
        buyDollars: clampInt(x.buyDollars, 1, 9999, 5), vehicle: typeof x.vehicle === 'string' ? x.vehicle : FB.EXPEDITION.vehicle[sp.park] };
    }
    if (isObj(raw.promo) && finite(+raw.promo.until)) s.promo = { kind: 'expedition', until: +raw.promo.until, discount: clamp(num(raw.promo.discount, 0.3), 0, 0.9) };
    s.promoNextAt = num(raw.promoNextAt, s.promoNextAt);
    if (isObj(raw.offer) && spdef(raw.offer.speciesId) && finite(+raw.offer.until)) s.offer = { speciesId: raw.offer.speciesId, until: +raw.offer.until };
    s.counters = cleanCounters(raw.counters);
    const M = isObj(raw.mission) ? raw.mission : {};
    const mi = savedMissionIndex(M);
    s.mission = { index: mi, id: missionIdAt(mi), base: cleanBase(M.base, s.counters), done: !!M.done };
    s.sideMissions = (Array.isArray(raw.sideMissions) ? raw.sideMissions : []).map(v => cleanSide(v, s.counters)).filter(Boolean)
      .slice(0, clampInt(sideCfg().count, 0, 6, 3));
    for (const p of PARKS) {
      const n = stagesOf(p).length || 99;
      s.battles[p] = clampInt(raw.battles && raw.battles[p], 0, n, 0);
      const rm = isObj(raw.medals) && isObj(raw.medals[p]) ? raw.medals[p] : {};
      for (const k in rm) { const st = Math.round(+k); if (st >= 1 && st <= n) { const v = clampInt(rm[k], 0, 3, 0); if (v) s.medals[p][st] = v; } }
      for (let st = 1; st <= s.battles[p]; st++) if (!s.medals[p][st]) s.medals[p][st] = 1;
      for (const k in s.medals[p]) if (s.medals[p][k] >= 1) s.battles[p] = Math.max(s.battles[p], +k);
    }
    s.cards = { nextFreeAt: num(raw.cards && raw.cards.nextFreeAt, 0) };
    s.seenIntro = !!raw.seenIntro;
    if (isObj(raw.settings)) {
      s.settings = Object.assign({}, raw.settings, { sound: raw.settings.sound !== false, music: raw.settings.music !== false });
    }
    s.createdAt = num(raw.createdAt, t);
    s.savedAt = num(raw.savedAt, 0);
    // Forward compatibility: keep unknown top-level keys (other modules may store their own data).
    for (const k in raw) if (!(k in s)) s[k] = raw[k];
    s.v = VERSION;
    return s;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle: init / reset / tick
  // ---------------------------------------------------------------------------
  /** Load the save (or `snapshot`, e.g. hot-reload data) or start a new game. Returns the state. */
  function init(snapshot) {
    let s = snapshot ? repair(snapshot) : null;
    let fromSave = false;
    if (!s) { s = repair(readSave()); fromSave = !!s; }
    const fresh = !s;
    setState(s || blankState());
    finishSetup();
    welcome = null;
    if (fromSave && state.savedAt > 0) {
      const away = (now() - state.savedAt) / 1000;
      let coins = 0;
      for (const o of allObjects()) if (o.type === 'enclosure' && o.hatched) coins += Math.floor(pendingRaw(o));
      if (away >= 120) welcome = { awaySec: Math.round(away), coins };
    }
    ENGINE.welcome = welcome;
    if (fresh) save();
    emit('change');
    return state;
  }
  function reset() {
    setState(blankState());
    finishSetup();
    welcome = null;
    ENGINE.welcome = null;
    save();
    emit('park', { park: state.current });
    emit('change');
    return state;
  }
  /** Toasts when an egg becomes ready or a delivery arrives (silent on the first tick after load). */
  function readyNotifications(t, silent) {
    let any = false;
    for (const p of PARKS) {
      if (!state.parks[p].unlocked) continue;
      for (const o of state.parks[p].objects) {
        if (o.type === 'enclosure' && !o.hatched && finite(o.hatchAt) && o.hatchAt <= t && !notified.eggs.has(o.id)) {
          notified.eggs.add(o.id);
          any = true;
          if (!silent) toast('L’œuf ' + deName((spdef(o.speciesId) || {}).name || 'créature') + ' est prêt à éclore !', 'good');
        } else if (o.type === 'building' && finite(o.readyAt) && o.readyAt <= t) {
          if (notified.ready.get(o.id) === o.readyAt) continue;
          notified.ready.set(o.id, o.readyAt);
          any = true;
          const b = bdef(o.buildingId);
          if (!silent && b && b.kind === 'food') toast('Livraison prête : ' + b.name, 'info');
        }
      }
    }
    return any;
  }
  function tick() {
    if (!state) return;
    const t = now();
    let dirty = false;
    const step = (fn) => { try { if (fn()) dirty = true; } catch (e) { try { console.error('[ENGINE] tick', e); } catch (_) { /* ignore */ } } };
    if (t - lastBankAt >= 1000) { step(() => { bankAll(); lastBankAt = t; return false; }); }
    step(resolveResearch);
    step(resolveExpedition);
    step(() => promoTick(t));
    step(() => ensureOffer(false));
    step(() => readyNotifications(t, firstTick));
    step(ensureSide);
    if (firstTick) {
      firstTick = false;
      if (welcome && welcome.coins > 0) toast('Bon retour ! Tes créatures ont gagné ' + fmtNum(welcome.coins) + ' pièces pendant ton absence.', 'good');
      else if (welcome) toast('Bon retour au parc !', 'info');
    }
    try { if (dirty) changed(); else checkMissions(); } catch (e) { try { console.error('[ENGINE] tick', e); } catch (_) { /* ignore */ } }
    if (t - lastSaveAt >= AUTOSAVE_MS) save();
  }
  function changed() {
    checkMissions();
    emit('change');
  }

  // ---------------------------------------------------------------------------
  // Settings & misc
  // ---------------------------------------------------------------------------
  function setSetting(key, value) {
    if (!state || typeof key !== 'string') return false;
    state.settings[key] = value;
    save();
    changed();
    return true;
  }
  function setSeenIntro(v) {
    if (!state) return false;
    state.seenIntro = v !== false;
    save();
    return true;
  }
  function snapshot() { return state ? clone(state) : null; }
  function getTerrain(park) { return terrain(PARKS.includes(park) ? park : state ? state.current : 'land'); }

  // ---------------------------------------------------------------------------
  // Debug hooks (tests)
  // ---------------------------------------------------------------------------
  const debug = {
    give(name, n) {
      if (!state) return;
      n = Math.round(+n) || 0;
      if (name === 'xp') addXPRaw(n);
      else if (RES_KEYS.includes(name)) state.player[name] = Math.max(0, (state.player[name] || 0) + n);
      changed();
    },
    /** Jump `sec` seconds into the future (offline progress), then tick. */
    skip(sec) {
      offset += Math.max(0, +sec || 0) * 1000;
      tick();
      if (state) changed();
    },
    setLevel(n) {
      if (!state) return;
      state.player.level = clampInt(n, 1, maxPlayerLevel(), 1);
      state.player.xp = 0;
      changed();
    },
    unlockAll() {
      if (!state) return;
      for (const p of PARKS) { state.parks[p].unlocked = true; ensureFixed(p); }
      changed();
    },
    researchAll() {
      if (!state) return;
      for (const id in PC.SPECIES || {}) if (PC.SPECIES[id].research) completeResearch(id);
      changed();
    },
    finishTimers() {
      if (!state) return;
      const t = now();
      for (const o of allObjects()) {
        if (o.type === 'enclosure' && !o.hatched) o.hatchAt = t;
        if (o.type === 'building' && finite(o.readyAt)) o.readyAt = t;
      }
      changed();
    },
    get offset() { return offset; },
    set offset(v) { offset = num(v, 0); },
  };

  // ---------------------------------------------------------------------------
  // Public API (every function wrapped so it never throws)
  // ---------------------------------------------------------------------------
  function safe(name, fn, fallback) {
    return function () {
      try { return fn.apply(null, arguments); } catch (e) {
        try { console.error('[ENGINE] ' + name + ' failed', e); } catch (_) { /* ignore */ }
        if (typeof fallback === 'function') return fallback();
        return fallback && typeof fallback === 'object' ? clone(fallback) : fallback;
      }
    };
  }
  const oops = () => fail('Oups, une erreur est survenue');
  const API = {
    // lifecycle
    init: [init, null], reset: [reset, null], save: [save, false], tick: [tick, undefined], snapshot: [snapshot, null],
    on: [on, () => () => {}], off: [off, undefined], toast: [toast, undefined],
    // resources
    res: [res, 0], canAfford: [canAfford, false], pay: [cost => { const ok = payRaw(cost); if (ok) changed(); return ok; }, false],
    give: [reward => { giveRaw(reward); changed(); }, undefined], addXP: [n => { addXPRaw(n); changed(); }, undefined],
    missingReason: [missingReason, 'Pas assez de ressources'], levelProgress: [levelProgress, null],
    // species & market
    speciesStatus: [speciesStatus, { state: 'unknown', needLevel: 0, owned: false, offer: false, price: {} }],
    creaturePrice: [creaturePrice, {}], ownsSpecies: [ownsSpecies, false], offerInfo: [offerInfo, null],
    // placement
    canPlace: [canPlace, false], placeReason: [placeReason, 'Emplacement invalide'], findFreeSpot: [findFreeSpot, null],
    enclosureSize: [enclosureSize, [3, 3]],
    // creatures
    buyCreature: [buyCreature, oops], hatch: [hatch, oops], pendingCoins: [pendingCoins, 0], collect: [collect, 0],
    collectAll: [collectAll, {}], feed: [feed, oops], creatureStats: [creatureStats, null], creaturesOf: [creaturesOf, []],
    // buildings
    buyBuilding: [buyBuilding, oops], production: [production, null], buildingOrders: [buildingOrders, []],
    activate: [activate, oops], upgrade: [upgrade, oops], upgradeCost: [upgradeCost, null],
    move: [move, oops], sell: [sell, oops], sellValue: [sellValue, {}], speedUpCost: [speedUpCost, 0], speedUp: [speedUp, oops],
    // parks
    unlockPark: [unlockPark, oops], setPark: [setPark, oops], parkStatus: [parkStatus, null],
    // research & expeditions
    startResearch: [startResearch, oops], retryResearch: [retryResearch, oops], ackResearch: [ackResearch, false],
    speedUpResearch: [speedUpResearch, oops], researchSteps: [researchSteps, { done: 0, steps: 0 }], researchInfo: [researchInfo, null],
    startExpedition: [startExpedition, oops], expeditionInfo: [expeditionInfo, null], expeditionTargets: [expeditionTargets, []],
    buyExpeditionDNA: [buyExpeditionDNA, oops], declineExpedition: [declineExpedition, oops], ackExpedition: [declineExpedition, oops],
    speedUpExpedition: [speedUpExpedition, oops], promoInfo: [promoInfo, null],
    // missions
    mission: [mission, null], claimMission: [claimMission, oops], sideMissions: [sideMissions, []], claimSide: [claimSide, oops],
    goalProgress: [(g, base) => goalProgress(g, base), { progress: 0, target: 1, done: false }],
    // battles
    battleTeam: [battleTeam, []], battleEnemies: [battleEnemies, []], battleUnlocked: [battleUnlocked, false],
    recordBattle: [recordBattle, {}], battleReward: [battleReward, {}], medal: [medal, 0],
    // objects & terrain
    getObj: [getObj, null], objects: [objects, []], findObj: [find, null], getTerrain: [getTerrain, null],
    // cards
    cardsReady: [cardsReady, false], cardsIn: [cardsIn, 0], openPack: [openPack, oops],
    // settings & helpers
    setSetting: [setSetting, false], setSeenIntro: [setSeenIntro, false],
    fmtTime: [fmtTime, ''], fmtNum: [fmtNum, '0'],
  };
  for (const k in API) ENGINE[k] = safe(k, API[k][0], API[k][1]);
  ENGINE.now = now;
  ENGINE.debug = debug;
  ENGINE.SAVE_KEY = SAVE_KEY;
  ENGINE.VERSION = VERSION;
  ENGINE.PARKS = PARKS;
  ENGINE.welcome = null;
})(window.PC = window.PC || {});
