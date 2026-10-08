/* Crétacé Park — tournaments (battle module) → PC.BATTLE.
   Story map of stages with Bronze / Argent / Or medals, team picker, then a turn-based fight on a painted
   biome arena with cinematic move animations (3 moves + SPÉCIALE per creature), and a result screen.
   Public API: PC.BATTLE.open(park, opts), close(), isOpen(), movesFor(speciesId), enemiesFor(park, stage, tier),
   fight(opts) (custom fights, e.g. online teams). Everything is created on demand inside one overlay element. */
(function (PC) {
  'use strict';
  const BT = PC.BATTLE = PC.BATTLE || {};
  const TAU = Math.PI * 2, PI = Math.PI;
  const FD = '"Russo One", "Arial Black", Impact, sans-serif';   // display font
  const FU = '"Exo 2", "Segoe UI", system-ui, sans-serif';        // UI font

  // ================================================================ small helpers
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const randInt = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
  const Ease = {
    lin: k => k,
    in: k => k * k * k,
    in2: k => k * k,
    out: k => 1 - Math.pow(1 - k, 3),
    out2: k => 1 - (1 - k) * (1 - k),
    io: k => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2),
    back: k => { const c = 1.70158; return 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2); },
    bump: k => Math.sin(k * PI),
  };
  const fmt = n => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  const Hh = () => PC.ART.helpers;
  const sfx = n => { try { if (PC.SFX && PC.SFX.play) PC.SFX.play(n); } catch (e) { /* audio is optional */ } };
  // music goes through PC.UI.music when present (keeps the UI's current track + settings in sync)
  const music = t => {
    try {
      if (PC.UI && typeof PC.UI.music === 'function') PC.UI.music(t);
      else if (PC.MUSIC && PC.MUSIC.play) PC.MUSIC.play(t);
    } catch (e) { /* optional */ }
  };
  const iconUrl = (n, s) => (PC.ICONS && PC.ICONS.url ? PC.ICONS.url(n, s || 24) : '');
  const ENG = () => PC.ENGINE || null;
  const engState = () => (PC.ENGINE && PC.ENGINE.state) || null;

  // ================================================================ rules & data
  const GAUGE_MAX = 100, GAUGE_HIT = 15, GAUGE_MISS = 15, SPECIAL_MULT = 1.8, CRIT = 0.1, CRIT_MULT = 1.5;
  const SPECIAL_COST = { dollars: 2 };
  const TIER_NAMES = ['', 'Bronze', 'Argent', 'Or'];
  const TIER_COLORS = ['', '#d08a4a', '#cfd6dc', '#ffd23a'];
  const TIER_MULT = [0, 1, 1.5, 2.2];    // reward preview fallback when PC.DATA.MEDALS is missing

  const MOVE_NAMES = {
    bite: 'Morsure', claw: 'Coup de griffe', charge: 'Charge', tail: 'Coup de queue', stomp: 'Piétinement',
    horn: 'Coup de corne', club: 'Coup de massue', head: 'Coup de tête',
  };
  // [move, power multiplier, accuracy %, special gauge gain]
  const CLASS_MOVES = {
    chasseur: [['bite', 1.0, 95, 25], ['claw', 0.8, 100, 40], ['charge', 1.25, 80, 25]],
    colosse: [['charge', 1.25, 80, 25], ['tail', 1.0, 95, 25], ['stomp', 0.8, 100, 40]],
    blinde: [['*', 1.0, 95, 25], ['tail', 0.8, 100, 40], ['charge', 1.25, 80, 25]],
  };
  const BLINDE_PRIMARY = { ceratopsian: 'horn', rhino: 'horn', ankylosaur: 'club', glyptodon: 'club' };
  const SPECIALS = {
    chasseur: { name: 'Griffes Écarlates', color: '#ff3b2f', glow: '#ffb08a', roar: 'RRRAAAAAH !' },
    colosse: { name: 'Séisme Titanesque', color: '#46d63a', glow: '#c8ff9a', roar: 'GROOOOAR !' },
    blinde: { name: 'Charge Bouclier', color: '#3aa2ff', glow: '#bfe8ff', roar: 'HRRRAAMM !' },
  };

  /** The 3 regular moves of a species: [{key, name, mult, acc, gauge}]. */
  function movesFor(speciesId) {
    const sp = PC.SPECIES[speciesId];
    if (!sp) return [];
    return (CLASS_MOVES[sp.cls] || CLASS_MOVES.chasseur).map(([k, mult, acc, gauge]) => {
      const key = k === '*' ? (BLINDE_PRIMARY[sp.art] || 'head') : k;
      let name = MOVE_NAMES[key];
      if (sp.park === 'sea' && key === 'claw') name = 'Coup de nageoire';
      if (sp.park === 'sea' && key === 'stomp') name = 'Raz-de-marée';
      if (sp.art === 'bird' && key === 'head') name = 'Coup de bec';
      return { key, name, mult, acc, gauge };
    });
  }

  function stagesOf(park) { return (PC.DATA && PC.DATA.BATTLE_STAGES && PC.DATA.BATTLE_STAGES[park]) || []; }
  function stageDef(park, n) { return stagesOf(park).find(s => s.stage === n) || null; }
  function clearedOf(park) { const s = engState(); return (s && s.battles && s.battles[park]) | 0; }
  /** Medal 0..3 won on a stage (falls back to « Bronze » for cleared stages when the engine has no medals). */
  function medalOf(park, n) {
    const s = engState();
    const m = s && s.medals && s.medals[park] && s.medals[park][n];
    if (m != null) return m | 0;
    return n <= clearedOf(park) ? 1 : 0;
  }
  function parkUnlocked(p) {
    const s = engState();
    if (!s || !s.parks || !s.parks[p]) return p === 'land';
    return !!s.parks[p].unlocked;
  }
  const npcOf = id => (PC.DATA && PC.DATA.NPCS && PC.DATA.NPCS[id]) || { name: 'Adversaire', role: '', look: {} };
  const rarityIdx = sp => Math.max(0, (PC.RARITY_ORDER || ['commun', 'rare', 'super', 'legendaire', 'mythique']).indexOf(sp.rarity));

  /** Scaled enemy list for a stage and a tier (1 Bronze, 2 Argent, 3 Or). */
  function enemiesFor(park, n, tier) {
    tier = clamp(tier | 0 || 1, 1, 3);
    const E = ENG();
    if (E && typeof E.battleEnemies === 'function') {
      try {
        const r = E.battleEnemies(park, n, tier);
        if (Array.isArray(r) && r.length) {
          return r.map(e => ({ species: e.species || e.speciesId, level: clamp(e.level | 0 || 1, 1, PC.MAX_LEVEL), name: e.name }))
            .filter(e => PC.SPECIES[e.species]);
        }
      } catch (err) { console.warn('battleEnemies', err); }
    }
    const st = stageDef(park, n);
    if (!st) return [];
    let list = st.enemies.map(e => ({ species: e.species, level: e.level }));
    if (tier === 1) return list;
    const add = tier === 2 ? 5 : 10;
    list = list.map(e => ({ species: e.species, level: Math.min(PC.MAX_LEVEL, e.level + add) }));
    const want = tier === 2 ? Math.min(3, list.length + 1) : 3;
    const maxR = Math.max(...list.map(e => rarityIdx(PC.SPECIES[e.species])));
    const maxL = Math.max(...list.map(e => PC.SPECIES[e.species].level));
    const avgLv = Math.round(list.reduce((a, e) => a + e.level, 0) / list.length);
    const cands = (PC.SPECIES_ORDER[park] || []).filter(id => {
      const sp = PC.SPECIES[id];
      return !sp.offerOnly && rarityIdx(sp) <= maxR && sp.level <= maxL + 1 && !list.some(e => e.species === id);
    });
    let i = 0;
    while (list.length < want) {
      const id = cands.length ? cands[(n * 7 + i * 3) % cands.length] : list[0].species;
      if (cands.length) cands.splice(cands.indexOf(id), 1);
      list.push({ species: id, level: avgLv });
      i++;
    }
    return list;
  }

  /** Reward shown before a fight (engine's own numbers when it exposes battleReward()). */
  function rewardPreview(park, n, tier) {
    const E = ENG();
    if (E && typeof E.battleReward === 'function') {
      try { const r = E.battleReward(park, n, tier); if (r) return r; } catch (err) { /* fall back */ }
    }
    const st = stageDef(park, n);
    if (!st) return {};
    const M = (PC.DATA && PC.DATA.MEDALS) || {};
    const mult = (M.rewardMult && M.rewardMult[tier - 1]) || TIER_MULT[tier] || 1, replay = M.replayCoins != null ? M.replayCoins : 0.3;
    const first = medalOf(park, n) < tier, r = {};
    for (const k in st.reward) {
      if (first) r[k] = Math.round(st.reward[k] * mult);
      else if (k === 'coins') r[k] = Math.round(st.reward[k] * mult * replay);
    }
    return r;
  }

  // ================================================================ styles
  const CSS = `
.bt-root{position:fixed;inset:0;z-index:9000;font-family:${FU};color:#eef2f4;background:#0b0f12;overflow:hidden;
  user-select:none;-webkit-user-select:none;touch-action:manipulation;-webkit-tap-highlight-color:transparent;line-height:1.25}
.bt-root *{box-sizing:border-box}
/* zero-specificity reset so every .bt-* button class keeps its own background / border */
:where(.bt-root) button{font:inherit;color:inherit;cursor:pointer;border:0;background:none;padding:0;margin:0}
:where(.bt-root) button:focus-visible{outline:3px solid #ffd23a;outline-offset:2px}
:where(.bt-root) button:disabled{cursor:default}
.bt-screen{position:absolute;inset:0;display:flex;flex-direction:column;min-height:0}
.bt-hidden{display:none!important}
.bt-steel{background:
  radial-gradient(circle,#f6f8f9 0 1.4px,#59636a 1.9px 2.8px,transparent 3.3px) left 5px top 5px/9px 9px no-repeat,
  radial-gradient(circle,#f6f8f9 0 1.4px,#59636a 1.9px 2.8px,transparent 3.3px) right 5px top 5px/9px 9px no-repeat,
  radial-gradient(circle,#f6f8f9 0 1.4px,#59636a 1.9px 2.8px,transparent 3.3px) left 5px bottom 5px/9px 9px no-repeat,
  radial-gradient(circle,#f6f8f9 0 1.4px,#59636a 1.9px 2.8px,transparent 3.3px) right 5px bottom 5px/9px 9px no-repeat,
  repeating-linear-gradient(90deg,rgba(255,255,255,.06) 0 1px,rgba(0,0,0,.035) 1px 3px),
  linear-gradient(180deg,#e6eaed 0%,#b5bdc3 46%,#959ea5 54%,#cdd3d7 100%);
  border:2px solid #343c42;box-shadow:inset 0 1px 0 rgba(255,255,255,.85),inset 0 -2px 0 rgba(0,0,0,.22),0 4px 10px rgba(0,0,0,.45)}
button.bt-steel{background:repeating-linear-gradient(90deg,rgba(255,255,255,.06) 0 1px,rgba(0,0,0,.035) 1px 3px),linear-gradient(180deg,#eef1f3 0%,#c2c9ce 46%,#a2abb2 54%,#d6dbde 100%)}
.bt-dark{background:linear-gradient(180deg,#262f35,#171d21);border:2px solid #0a0d0f;box-shadow:inset 0 0 0 1px rgba(255,255,255,.07),inset 0 8px 18px rgba(0,0,0,.35)}
.bt-hazard{background:repeating-linear-gradient(-45deg,#f5c518 0 10px,#1b1b1b 10px 20px)}
.bt-close{position:relative;flex:none;width:44px;height:44px;border-radius:50%;
  background:radial-gradient(circle at 35% 30%,#ff9a8a,#e0302a 55%,#8a1010);border:3px solid #3a0a0a;
  box-shadow:0 0 0 3px #c9cfd3,0 0 0 5px #4a5258,0 4px 8px rgba(0,0,0,.55)}
.bt-close::before,.bt-close::after{content:"";position:absolute;left:50%;top:50%;width:22px;height:5px;margin:-2.5px 0 0 -11px;
  background:#fff;border-radius:3px;box-shadow:0 1px 0 rgba(0,0,0,.35);transform:rotate(45deg)}
.bt-close::after{transform:rotate(-45deg)}
.bt-close:active{transform:scale(.92)}
.bt-btn-green{font-family:${FD};color:#fff;letter-spacing:.03em;text-shadow:0 2px 0 #1d4a12,0 0 6px rgba(0,0,0,.35);
  background:linear-gradient(#a6f572,#52bd31 48%,#2f8a1c);border:3px solid #173f0d;border-radius:12px;
  box-shadow:inset 0 2px 0 rgba(255,255,255,.65),inset 0 -4px 0 rgba(0,0,0,.22),0 5px 0 #173f0d,0 9px 14px rgba(0,0,0,.45)}
.bt-btn-green:active:not(:disabled){transform:translateY(3px);box-shadow:inset 0 2px 0 rgba(255,255,255,.65),inset 0 -4px 0 rgba(0,0,0,.22),0 2px 0 #173f0d}
.bt-btn-green:disabled{filter:grayscale(1) brightness(.75);opacity:.8}
.bt-btn-steel{font-family:${FD};color:#263038;text-shadow:0 1px 0 rgba(255,255,255,.7);border-radius:10px}
.bt-btn-steel:active:not(:disabled){transform:translateY(2px)}
.bt-btn-red{font-family:${FD};color:#fff;text-shadow:0 2px 0 #5a0c0c;border-radius:10px;border:3px solid #4a0a0a;
  background:linear-gradient(#ff8a6a,#e0402a 50%,#a01c12);box-shadow:inset 0 2px 0 rgba(255,255,255,.5),0 4px 0 #4a0a0a}
/* ---------- tournament screen ---------- */
.bt-head{flex:none;position:relative;display:flex;align-items:center;gap:10px;padding:8px 12px 14px;z-index:3}
.bt-head::after{content:"";position:absolute;left:0;right:0;bottom:0;height:7px;background:repeating-linear-gradient(-45deg,#f5c518 0 10px,#1b1b1b 10px 20px);border-top:1px solid #222}
.bt-head-ico{flex:none;width:40px;height:40px}
.bt-titles{flex:1;min-width:0}
.bt-title{font-family:${FD};font-size:24px;line-height:1;color:#232a30;text-shadow:0 1px 0 rgba(255,255,255,.75);white-space:nowrap}
.bt-sub{font-size:13px;font-weight:700;color:#3d474e;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bt-tabs{display:flex;gap:6px;flex:none}
.bt-tab{padding:7px 10px;font-size:13px;border-radius:8px}
.bt-tab.is-on{background:linear-gradient(#ffe27a,#f2b51c);border-color:#6a4a06;color:#3a2604}
.bt-tab:disabled{opacity:.45}
.bt-body{flex:1;display:flex;min-height:0}
.bt-mapwrap{flex:1;position:relative;overflow-y:auto;overflow-x:hidden;background:#0d1114;scrollbar-width:thin;-webkit-overflow-scrolling:touch}
.bt-map{position:relative;margin:0 auto}
.bt-map>canvas,.bt-map>svg{position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none}
.bt-flow{stroke-dasharray:4 14;animation:bt-flow 1.1s linear infinite}
@keyframes bt-flow{to{stroke-dashoffset:-36}}
.bt-node{position:absolute;width:60px;height:60px;margin:-30px 0 0 -30px;border-radius:50%;z-index:2;
  background:radial-gradient(circle at 35% 30%,#fbfcfd,#aeb7bd 45%,#5d676e 75%,#3a4248);box-shadow:0 5px 0 #20272c,0 9px 14px rgba(0,0,0,.5)}
.bt-node>b{position:absolute;inset:7px;border-radius:50%;display:flex;align-items:center;justify-content:center;
  font-family:${FD};font-size:22px;color:#fff;text-shadow:0 2px 0 rgba(0,0,0,.45);border:2px solid rgba(0,0,0,.45);
  background:radial-gradient(circle at 40% 30%,#9aa3a8,#5b646a)}
.bt-node.is-done>b{background:radial-gradient(circle at 40% 30%,#a8f07a,#3fa52a 60%,#256a16)}
.bt-node.is-cur>b{background:radial-gradient(circle at 40% 30%,#ffe98a,#f5a51c 60%,#b8620a)}
.bt-node.is-cur{animation:bt-pulse 1.3s ease-in-out infinite}
.bt-node.is-lock>b{background:radial-gradient(circle at 40% 30%,#6e767b,#3d4449);color:#b8c0c4}
.bt-node.is-lock{filter:saturate(.3)}
.bt-node.is-sel{box-shadow:0 0 0 4px #fff,0 0 0 7px #f5c518,0 0 22px 6px rgba(255,220,90,.75),0 9px 14px rgba(0,0,0,.5)}
.bt-node .bt-lockico{position:absolute;right:-4px;top:-4px;width:22px;height:22px}
.bt-node .bt-okico{position:absolute;right:-5px;top:-5px;width:22px;height:22px}
@keyframes bt-pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.1);filter:drop-shadow(0 0 10px rgba(255,210,60,.95))}}
.bt-medals{position:absolute;left:50%;top:64px;transform:translateX(-50%);display:flex;gap:3px;pointer-events:none}
.bt-medal{width:17px;height:17px;border-radius:50%;border:2px solid rgba(0,0,0,.55);box-shadow:0 2px 2px rgba(0,0,0,.4);opacity:.38;filter:grayscale(.9)}
.bt-medal.on{opacity:1;filter:none;box-shadow:0 0 6px rgba(255,240,180,.9),0 2px 2px rgba(0,0,0,.4)}
.bt-medal.m1{background:radial-gradient(circle at 35% 30%,#ffd2a0,#c07a38 55%,#7a4418)}
.bt-medal.m2{background:radial-gradient(circle at 35% 30%,#ffffff,#c4ccd2 55%,#7c868e)}
.bt-medal.m3{background:radial-gradient(circle at 35% 30%,#fff6b0,#f2c21c 55%,#a87406)}
.bt-stack{position:absolute;width:64px;height:52px;margin-top:-26px;pointer-events:none;z-index:1}
.bt-stack canvas{position:absolute;top:0;width:34px;height:42px;border-radius:5px;border:2px solid #222;box-shadow:0 3px 5px rgba(0,0,0,.5)}
.bt-stack.lock canvas{filter:grayscale(1) brightness(.55)}
.bt-side{flex:none;width:410px;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:10px;scrollbar-width:thin}
.bt-opp{display:flex;gap:12px;align-items:center;padding:10px;border-radius:12px}
.bt-opp canvas{flex:none;width:78px;height:94px;border-radius:8px;border:3px solid #2a3238;box-shadow:0 3px 6px rgba(0,0,0,.5)}
.bt-opp-name{font-family:${FD};font-size:19px;color:#ffd96a;text-shadow:0 2px 0 rgba(0,0,0,.6)}
.bt-opp-role{font-size:12px;color:#aeb9c0}
.bt-opp-stage{margin-top:4px;font-weight:800;font-size:15px}
.bt-rec{margin-top:3px;font-size:12px;color:#9fe07a;font-weight:700}
.bt-sec{border-radius:12px;padding:8px 10px 10px}
.bt-sec h3{margin:0 0 7px;font-family:${FD};font-weight:400;font-size:14px;letter-spacing:.04em;color:#ffd23a;text-transform:uppercase;display:flex;align-items:center;gap:6px}
.bt-sec h3 small{font-family:${FU};font-size:12px;color:#aeb9c0;text-transform:none;letter-spacing:0;font-weight:600}
.bt-tiers{display:flex;gap:6px}
.bt-tier{flex:1;position:relative;display:flex;flex-direction:column;align-items:center;gap:2px;padding:6px 4px;border-radius:10px;font-weight:800;font-size:13px}
.bt-tier .bt-medal{width:26px;height:26px;opacity:1;filter:none}
.bt-tier.is-on{background:linear-gradient(#ffe27a,#f2b51c);border-color:#6a4a06;color:#3a2604}
.bt-tier:disabled{opacity:.5}
.bt-tier:disabled .bt-medal{filter:grayscale(1)}
.bt-tier .bt-won{position:absolute;right:3px;top:3px;width:16px;height:16px}
.bt-tier .bt-tlock{position:absolute;right:3px;top:3px;width:16px;height:16px}
.bt-cards{display:flex;gap:8px;overflow-x:auto;padding:2px 2px 6px;scrollbar-width:thin}
.bt-card{position:relative;flex:none;width:104px;border-radius:10px;padding:4px 4px 5px;text-align:left;
  background:linear-gradient(#2d373e,#1b2227);border:3px solid var(--rc,#6f777c);box-shadow:0 3px 6px rgba(0,0,0,.45)}
.bt-card canvas{display:block;width:100%;height:68px;border-radius:6px}
.bt-card .bt-cn{font-weight:800;font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:3px}
.bt-card .bt-cs{font-size:11px;color:#c6d0d6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bt-card .bt-cst{display:flex;gap:5px;font-size:11px;font-weight:700;margin-top:2px;align-items:center}
.bt-card .bt-cst img{width:13px;height:13px;vertical-align:-2px}
.bt-card .bt-cls{position:absolute;right:6px;top:6px;width:20px;height:20px}
.bt-card .bt-lv{position:absolute;left:6px;top:6px;font-family:${FD};font-size:11px;padding:1px 5px;border-radius:6px;background:rgba(0,0,0,.65);color:#ffd96a}
.bt-card.pickable{cursor:pointer}
.bt-card.is-picked{border-color:#ffd23a;box-shadow:0 0 0 2px #fff6c8,0 0 14px rgba(255,210,60,.8)}
.bt-card .bt-order{position:absolute;left:50%;top:44px;transform:translateX(-50%);width:28px;height:28px;border-radius:50%;
  background:radial-gradient(circle at 35% 30%,#fff3a0,#f2b51c 60%,#a06a06);border:2px solid #3a2604;color:#3a2604;
  font-family:${FD};font-size:16px;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 4px rgba(0,0,0,.5)}
.bt-rew{display:flex;flex-wrap:wrap;gap:6px}
.bt-chip{display:inline-flex;align-items:center;gap:5px;padding:4px 10px 4px 5px;border-radius:999px;background:#0e1316;border:2px solid #39444b;font-weight:800;font-size:14px}
.bt-chip img{width:22px;height:22px}
.bt-empty{display:flex;gap:10px;align-items:center;font-size:14px;color:#dfe6ea;padding:4px}
.bt-empty img{width:40px;height:40px;flex:none}
.bt-go{font-size:28px;padding:12px 10px 10px;width:100%}
.bt-hint{font-size:12px;color:#aeb9c0;text-align:center}
@media (max-width:760px){
  .bt-body{flex-direction:column}
  .bt-mapwrap{flex:0 0 41%}
  .bt-side{width:auto;flex:1;padding:8px;gap:8px;border-top:3px solid #0a0d0f}
  .bt-title{font-size:20px}
  .bt-tab{padding:6px 7px;font-size:11px}
  .bt-head-ico{display:none}
  .bt-opp canvas{width:62px;height:74px}
  .bt-go{font-size:24px;padding:10px}
}
/* ---------- fight screen ---------- */
.bt-fight canvas.bt-cv{position:absolute;left:0;top:0;width:100%;height:100%;display:block}
.bt-top{position:absolute;left:0;right:0;top:0;display:flex;justify-content:space-between;gap:8px;padding:8px 10px;pointer-events:none;z-index:2}
.bt-plate{width:min(390px,48%);border-radius:12px;padding:6px 9px 7px;pointer-events:auto}
.bt-plate.r{text-align:right}
.bt-who{display:flex;align-items:center;gap:6px;font-family:${FD};font-size:13px;color:#2a3238;text-shadow:0 1px 0 rgba(255,255,255,.7);white-space:nowrap;overflow:hidden}
.bt-plate.r .bt-who{flex-direction:row-reverse}
.bt-who img{width:18px;height:18px}
.bt-who canvas{width:24px;height:28px;border-radius:4px;border:1px solid #333}
.bt-who span{overflow:hidden;text-overflow:ellipsis}
.bt-wins{display:inline-flex;align-items:center;gap:2px;padding:0 6px;border-radius:8px;background:rgba(0,0,0,.65);color:#ffd96a;font-size:12px}
.bt-nm{display:flex;align-items:center;gap:6px;margin-top:3px}
.bt-plate.r .bt-nm{flex-direction:row-reverse}
.bt-nm img{width:22px;height:22px;flex:none}
.bt-nm b{font-family:${FD};font-weight:400;font-size:16px;color:#fff;text-shadow:0 2px 0 #000,0 0 4px #000;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.bt-nm i{flex:none;font-style:normal;font-family:${FD};font-size:12px;padding:1px 6px;border-radius:6px;background:#1b2227;color:#ffd96a;border:1px solid #000}
.bt-hp{position:relative;height:18px;margin-top:4px;border-radius:9px;background:#14191c;border:2px solid #0a0c0e;overflow:hidden;box-shadow:inset 0 2px 4px rgba(0,0,0,.6)}
.bt-hp .g,.bt-hp .f{position:absolute;left:0;top:0;bottom:0;border-radius:7px}
.bt-plate.r .bt-hp .g,.bt-plate.r .bt-hp .f{left:auto;right:0}
.bt-hp .g{background:#fff1a8;transition:width .55s ease .45s}
.bt-hp .f{background:linear-gradient(#9cf06a,#3fa52a 60%,#2a7a18);transition:width .35s ease-out,background .3s}
.bt-hp .f.mid{background:linear-gradient(#ffe07a,#e8a81c 60%,#b07a0a)}
.bt-hp .f.low{background:linear-gradient(#ff8a7a,#e0402a 60%,#a01c12)}
.bt-hp span{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-family:${FD};font-size:11.5px;color:#fff;text-shadow:0 1px 0 #000,0 0 3px #000}
.bt-gauge{display:flex;gap:3px;margin-top:4px;height:7px}
.bt-plate.r .bt-gauge{flex-direction:row-reverse}
.bt-gauge b{flex:1;border-radius:4px;background:#1b2125;border:1px solid #000;overflow:hidden;position:relative}
.bt-gauge b i{position:absolute;left:0;top:0;bottom:0;background:linear-gradient(#ffe98a,#ff9a1c);transition:width .3s}
.bt-gauge.full b i{background:linear-gradient(#fff,#ffd23a);box-shadow:0 0 8px #ffd23a}
.bt-team{position:absolute;top:118px;display:flex;flex-direction:column;gap:6px;z-index:2}
.bt-team.l{left:8px}.bt-team.r{right:8px}
.bt-tp{position:relative;width:54px;height:62px;border-radius:8px;overflow:hidden;border:2px solid #1a1f23;background:#222;box-shadow:0 2px 5px rgba(0,0,0,.55)}
.bt-tp canvas{display:block;width:100%;height:52px}
.bt-tp .m{position:absolute;left:2px;right:2px;bottom:2px;height:6px;border-radius:3px;background:#111;overflow:hidden}
.bt-tp .m i{position:absolute;left:0;top:0;bottom:0;background:#52bd31;transition:width .35s}
.bt-tp.on{border-color:#ffd23a;box-shadow:0 0 0 2px rgba(255,210,60,.5),0 0 10px rgba(255,210,60,.7)}
.bt-tp.ko{filter:grayscale(1) brightness(.5)}
.bt-tp.ko::after{content:"K.O.";position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-family:${FD};font-size:15px;color:#ff5a4a;text-shadow:0 2px 0 #000;transform:rotate(-14deg)}
.bt-bottom{position:absolute;left:0;right:0;bottom:0;display:flex;align-items:flex-end;justify-content:center;gap:10px;padding:8px 10px 10px;z-index:3;pointer-events:none}
.bt-bottom>*{pointer-events:auto}
.bt-left-ctl{position:absolute;left:10px;bottom:12px;display:flex;align-items:center;gap:8px}
.bt-round{width:52px;height:52px;border-radius:50%;display:flex;align-items:center;justify-content:center}
.bt-round img{width:30px;height:30px}
.bt-lvl{position:relative;width:52px;height:52px;display:flex;align-items:center;justify-content:center;font-family:${FD};font-size:19px;color:#fff;text-shadow:0 2px 0 #000;
  background:radial-gradient(circle at 35% 30%,#7fd0ff,#2a7ac8 60%,#123a6a);border:3px solid #0a1a2a;border-radius:14px;transform:rotate(45deg);box-shadow:0 0 0 2px #c9cfd3,0 4px 8px rgba(0,0,0,.5)}
.bt-lvl span{transform:rotate(-45deg)}
.bt-acts{display:flex;gap:8px;align-items:flex-end}
.bt-act{position:relative;width:82px;height:82px;border-radius:12px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;padding:4px 3px 5px}
.bt-act img{width:42px;height:42px;pointer-events:none}
.bt-act em{font-style:normal;font-family:${FD};font-size:10.5px;line-height:1.05;color:#263038;text-shadow:0 1px 0 rgba(255,255,255,.6);text-align:center;max-width:100%}
.bt-act:not(:disabled):hover{filter:brightness(1.08)}
.bt-act:active:not(:disabled){transform:translateY(2px) scale(.97)}
.bt-act:disabled{filter:grayscale(.85) brightness(.7)}
.bt-act .bt-eff{position:absolute;left:3px;top:3px;font-size:10px;font-weight:900;padding:0 4px;border-radius:5px;background:#2f8a1c;color:#fff}
.bt-act .bt-eff.w{background:#a01c12}
.bt-act.bt-sp{background:linear-gradient(180deg,#58606a,#2b3036);border-color:#111}
.bt-sp em{color:#fff;text-shadow:0 1px 0 #000}
.bt-sp .fill{position:absolute;left:3px;right:3px;bottom:3px;border-radius:8px;background:linear-gradient(0deg,rgba(255,120,30,.85),rgba(255,210,60,.55));transition:height .35s;pointer-events:none}
.bt-sp img,.bt-sp em{position:relative}
.bt-sp.ready{animation:bt-glow 0.9s ease-in-out infinite alternate;background:linear-gradient(180deg,#ffef9a,#ff9a1c 60%,#d2560a)}
.bt-sp.ready em{color:#3a1a02;text-shadow:0 1px 0 rgba(255,255,255,.6)}
@keyframes bt-glow{from{box-shadow:0 0 6px 2px var(--sc,#ffd23a),0 4px 10px rgba(0,0,0,.5)}to{box-shadow:0 0 22px 9px var(--sc,#ffd23a),0 4px 10px rgba(0,0,0,.5)}}
.bt-badge{position:absolute;right:-7px;top:-7px;min-width:26px;height:26px;padding:0 5px;border-radius:13px;background:radial-gradient(circle at 35% 30%,#ff8a7a,#e0201a 60%,#8a0808);
  border:2px solid #fff;color:#fff;font-family:${FD};font-size:14px;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 4px rgba(0,0,0,.6);z-index:2}
.bt-pay{position:absolute;left:50%;top:-30px;transform:translateX(-50%);display:flex;align-items:center;gap:3px;padding:2px 8px 2px 4px;border-radius:10px;white-space:nowrap;
  background:#0e1316;border:2px solid #52bd31;color:#b8ff8a;font-family:${FD};font-size:13px;box-shadow:0 2px 5px rgba(0,0,0,.6)}
.bt-pay img{width:20px;height:20px}
.bt-pay.ask{background:#52bd31;color:#fff;border-color:#fff;animation:bt-pulse .7s ease-in-out infinite}
.bt-side-ctl{position:absolute;right:8px;bottom:120px;display:flex;flex-direction:column;gap:8px;z-index:3}
.bt-sbtn{width:46px;height:46px;border-radius:50%;display:flex;align-items:center;justify-content:center}
.bt-sbtn img{width:26px;height:26px}
.bt-sbtn.off img{opacity:.45}
.bt-sbtn.off{position:relative}
.bt-sbtn.off::after{content:"";position:absolute;left:8px;right:8px;top:50%;height:4px;margin-top:-2px;background:#e0302a;border-radius:2px;transform:rotate(-40deg)}
.bt-auto{width:56px;height:34px;border-radius:17px;font-family:${FD};font-size:13px;color:#263038;align-self:flex-end}
.bt-auto.on{background:linear-gradient(#a6f572,#52bd31 50%,#2f8a1c);color:#fff;text-shadow:0 1px 0 #1d4a12;border-color:#173f0d;animation:bt-glow2 1s ease-in-out infinite alternate}
@keyframes bt-glow2{from{box-shadow:0 0 4px #9cf06a}to{box-shadow:0 0 14px 4px #9cf06a}}
.bt-flee{width:56px;height:30px;border-radius:15px;font-size:12px;align-self:flex-end}
.bt-msg{position:absolute;left:50%;bottom:118px;transform:translateX(-50%);padding:6px 14px;border-radius:10px;background:rgba(10,14,16,.85);border:2px solid #f5c518;
  font-weight:800;font-size:15px;width:max-content;max-width:calc(100% - 24px);text-align:center;z-index:4;pointer-events:none;transition:opacity .3s}
.bt-modal{position:absolute;inset:0;z-index:10;display:flex;align-items:center;justify-content:center;padding:14px;background:rgba(4,6,8,.55)}
.bt-box{position:relative;width:min(460px,100%);max-height:100%;overflow-y:auto;border-radius:16px;padding:16px 16px 14px;text-align:center}
.bt-box h2{margin:0 0 4px;font-family:${FD};font-weight:400;font-size:30px;color:#ffd23a;text-shadow:0 3px 0 #000,0 0 12px rgba(0,0,0,.6)}
.bt-box h2.lose{color:#c8d0d6}
.bt-box p{margin:6px 0;color:#dfe6ea}
.bt-box .bt-strip{height:8px;margin:-16px -16px 12px;border-radius:14px 14px 0 0}
.bt-btns{display:flex;gap:10px;justify-content:center;margin-top:12px;flex-wrap:wrap}
.bt-btns button{flex:1;min-width:130px;padding:11px 10px 9px;font-size:17px}
.bt-pick{display:grid;grid-template-columns:repeat(auto-fill,minmax(104px,1fr));gap:8px;margin-top:8px;justify-items:center}
.bt-pick .bt-card:disabled{opacity:.45;filter:grayscale(.8)}
.bt-medal-big{width:84px;height:84px;margin:6px auto 2px;border-radius:50%;border:4px solid rgba(0,0,0,.5);box-shadow:0 0 22px rgba(255,230,140,.9),0 4px 8px rgba(0,0,0,.5);
  display:flex;align-items:center;justify-content:center;font-family:${FD};font-size:13px;color:rgba(0,0,0,.6);animation:bt-pop .6s cubic-bezier(.2,1.6,.4,1)}
@keyframes bt-pop{from{transform:scale(.2) rotate(-30deg);opacity:0}to{transform:none;opacity:1}}
.bt-toggles{display:flex;gap:10px;justify-content:center;margin:10px 0}
.bt-toggles button{padding:8px 12px;font-size:14px;border-radius:10px}
@media (max-width:640px){
  .bt-plate{padding:5px 7px 6px}
  .bt-nm b{font-size:13.5px}
  .bt-who{font-size:11px}
  .bt-hp{height:16px}
  .bt-team{top:112px;gap:5px}
  .bt-tp{width:44px;height:52px}
  .bt-tp canvas{height:43px}
  .bt-bottom{padding:6px 6px 8px;gap:6px}
  .bt-acts{gap:6px}
  .bt-act{width:66px;height:70px}
  .bt-act img{width:34px;height:34px}
  .bt-act em{font-size:9px}
  .bt-left-ctl{position:absolute;left:8px;bottom:94px;gap:6px}
  .bt-round,.bt-lvl{width:42px;height:42px}
  .bt-lvl{font-size:16px}
  .bt-round img{width:24px;height:24px}
  .bt-side-ctl{bottom:94px;gap:6px}
  .bt-sbtn{width:40px;height:40px}
  .bt-msg{bottom:150px;font-size:13px}
}
.bt-cv{transition:filter 1.4s ease}
.bt-fight .bt-top,.bt-fight .bt-team,.bt-fight .bt-bottom,.bt-fight .bt-side-ctl{transition:opacity .35s ease}
.bt-fight.intro .bt-top,.bt-fight.intro .bt-team,.bt-fight.intro .bt-bottom,.bt-fight.intro .bt-side-ctl,
.bt-fight.cine .bt-top,.bt-fight.cine .bt-team,.bt-fight.cine .bt-side-ctl{opacity:0;pointer-events:none}
.bt-fight.cine .bt-bottom{opacity:.25}
.bt-cv.lose{filter:grayscale(.85) brightness(.55)}
.bt-msg.off{opacity:0}
.bt-spw{position:relative;display:flex}
.bt-pay[hidden]{display:none}
.bt-badge[hidden]{display:none}
.bt-act .bt-acc{position:absolute;right:4px;top:3px;font-size:9.5px;font-weight:900;color:#3d474e}
.bt-medal-big.m1{background:radial-gradient(circle at 35% 30%,#ffd2a0,#c07a38 55%,#7a4418)}
.bt-medal-big.m2{background:radial-gradient(circle at 35% 30%,#ffffff,#c4ccd2 55%,#7c868e)}
.bt-medal-big.m3{background:radial-gradient(circle at 35% 30%,#fff6b0,#f2c21c 55%,#a87406)}
.bt-box .bt-rew{justify-content:center;margin-top:8px}
.bt-box .bt-sub2{font-weight:800;color:#ffd96a}
.bt-box.bt-dark h2{letter-spacing:.02em}
.bt-tp{cursor:default}
@media (max-width:640px){ .bt-act .bt-acc{display:none} }
`;
  function injectStyle() {
    if (document.getElementById('bt-style')) return;
    const s = el('style');
    s.id = 'bt-style';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  // ================================================================ button icons (procedural, cached data URLs)
  const iconCache = new Map();
  const ICON_FNS = {
    bite(c) {
      const H = Hh();
      // open jaws seen from the side
      c.save(); c.translate(32, 32);
      H.smooth(c, [[-24, -4], [-14, -22], [8, -24], [26, -14], [20, -8], [4, -12], [-10, -6]], true, 0.5);
      H.fillStroke(c, H.linear(c, 0, -24, 0, -4, [[0, '#a8805a'], [1, '#6a4a30']]), '#1a0f08', 3);
      H.smooth(c, [[-24, 4], [-12, 20], [10, 22], [24, 14], [18, 9], [4, 12], [-10, 6]], true, 0.5);
      H.fillStroke(c, H.linear(c, 0, 4, 0, 22, [[0, '#8a6444'], [1, '#5a3a22']]), '#1a0f08', 3);
      c.fillStyle = '#7a1a14'; H.ellipse(c, -6, 0, 16, 5); c.fill();
      H.teeth(c, -12, -7, 20, -11, 5, 7, false, '#fff8e8');
      H.teeth(c, -12, 7, 18, 11, 5, 6, true, '#fff8e8');
      H.ellipse(c, 2, -16, 2.6, 2.6); c.fillStyle = '#ffd23a'; c.fill();
      c.restore();
    },
    claw(c) {
      c.save(); c.translate(32, 32); c.lineCap = 'round';
      for (let i = -1; i <= 1; i++) {
        c.save(); c.translate(i * 11, 0);
        c.strokeStyle = '#3a0a06'; c.lineWidth = 10;
        c.beginPath(); c.moveTo(-10, -24); c.quadraticCurveTo(6, -4, -2, 24); c.stroke();
        c.strokeStyle = '#e0402a'; c.lineWidth = 6.5; c.stroke();
        c.strokeStyle = '#fff'; c.lineWidth = 2.6;
        c.beginPath(); c.moveTo(-9, -21); c.quadraticCurveTo(5, -4, -1.5, 18); c.stroke();
        c.restore();
      }
      c.restore();
    },
    charge(c) {
      const H = Hh();
      c.save(); c.translate(32, 32); c.lineCap = 'round';
      c.strokeStyle = 'rgba(255,255,255,.85)'; c.lineWidth = 3.5;
      for (const [y, l] of [[-14, 16], [-2, 22], [10, 14]]) { c.beginPath(); c.moveTo(-28, y); c.lineTo(-28 + l, y); c.stroke(); }
      H.poly(c, [[-10, -10], [8, -10], [8, -20], [28, 0], [8, 20], [8, 10], [-10, 10]], true);
      H.fillStroke(c, H.linear(c, 0, -20, 0, 20, [[0, '#ffe07a'], [0.5, '#ff9a1c'], [1, '#d2560a']]), '#3a1a02', 3);
      c.restore();
    },
    tail(c) {
      const H = Hh();
      c.save(); c.translate(32, 32);
      c.strokeStyle = 'rgba(255,255,255,.75)'; c.lineWidth = 3; c.lineCap = 'round';
      c.beginPath(); c.arc(-4, 6, 26, -2.6, -1.2); c.stroke();
      c.beginPath(); c.arc(-4, 6, 19, -2.5, -1.4); c.stroke();
      H.limb(c, [[-26, 18], [-10, 16], [6, 8], [16, -4], [22, -18]], [16, 13, 10, 6, 2], H.linear(c, -26, 0, 22, 0, [[0, '#7d8f4a'], [1, '#a8b866']]), '#1a2208', 3);
      c.restore();
    },
    stomp(c) {
      const H = Hh();
      c.save(); c.translate(32, 30);
      c.strokeStyle = '#3a2a14'; c.lineWidth = 2.5; c.lineCap = 'round';
      for (const [a, b] of [[[-28, 22], [-16, 16]], [[28, 22], [16, 16]], [[-22, 28], [-8, 22]], [[22, 28], [8, 22]]]) { c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke(); }
      H.ellipse(c, 0, 8, 13, 12); H.fillStroke(c, '#6a4a30', '#1a0f08', 3);
      for (const a of [-0.75, 0, 0.75]) { H.ellipse(c, Math.sin(a) * 15, -8 - Math.cos(a) * 6, 5, 9, a); H.fillStroke(c, '#6a4a30', '#1a0f08', 3); }
      c.fillStyle = '#c9a06a'; H.ellipse(c, -3, 5, 5, 4); c.fill();
      c.restore();
    },
    horn(c) {
      const H = Hh();
      c.save(); c.translate(32, 34);
      star(c, 14, -14, 12, 5, '#fff2a0', '#c98a10');
      H.smooth(c, [[-24, 20], [-6, 4], [10, -12], [20, -24], [14, -6], [0, 12], [-14, 24]], true, 0.5);
      H.fillStroke(c, H.linear(c, -24, 20, 20, -24, [[0, '#a89070'], [1, '#fff4dc']]), '#2a1a0a', 3);
      c.restore();
    },
    club(c) {
      const H = Hh();
      c.save(); c.translate(32, 32);
      H.limb(c, [[-26, 22], [-12, 10], [2, -2]], [12, 9, 8], '#8a7a5a', '#1a120a', 3);
      H.ellipse(c, 10, -10, 15, 12, -0.6); H.fillStroke(c, H.radial(c, 6, -14, 2, 18, [[0, '#d8c8a0'], [1, '#6e5e40']]), '#1a120a', 3);
      c.fillStyle = '#f2ead8';
      for (const [x, y] of [[0, -20], [20, -18], [22, 0], [4, 2]]) { H.poly(c, [[x - 3, y], [x, y - 6], [x + 3, y]], true); c.fill(); }
      c.restore();
    },
    head(c) {
      const H = Hh();
      c.save(); c.translate(30, 34);
      star(c, 20, -16, 11, 4.5, '#fff2a0', '#c98a10');
      H.smooth(c, [[-22, 20], [-24, 0], [-14, -18], [4, -22], [16, -12], [18, 4], [10, 16]], true, 0.5);
      H.fillStroke(c, H.radial(c, -4, -10, 2, 28, [[0, '#e0c9a0'], [1, '#8a6a46']]), '#2a1a0a', 3);
      c.fillStyle = 'rgba(255,255,255,.5)'; H.ellipse(c, -6, -12, 8, 4, -0.4); c.fill();
      H.eye(c, 8, 2, 3.2, { angry: true });
      c.restore();
    },
    special(c, col) {
      const H = Hh();
      c.save(); c.translate(32, 32);
      star(c, 0, 0, 30, 14, '#fff6c8', col || '#ff7a1c', 12);
      c.beginPath();
      c.moveTo(4, -22); c.lineTo(-10, 4); c.lineTo(0, 4); c.lineTo(-6, 24); c.lineTo(12, -4); c.lineTo(2, -4); c.closePath();
      H.fillStroke(c, '#fff', '#3a1a02', 2.5);
      c.restore();
    },
    switch(c) {
      c.save(); c.translate(32, 32); c.lineCap = 'round';
      for (const s of [1, -1]) {
        c.save(); c.rotate(s > 0 ? 0 : PI);
        c.strokeStyle = '#0e2a10'; c.lineWidth = 11;
        c.beginPath(); c.arc(0, 0, 18, PI * 1.08, PI * 1.85); c.stroke();
        c.strokeStyle = s > 0 ? '#7ee05a' : '#4fb0f0'; c.lineWidth = 6.5; c.stroke();
        const a = PI * 1.85, x = Math.cos(a) * 18, y = Math.sin(a) * 18;
        c.beginPath(); c.moveTo(x + 9, y - 2); c.lineTo(x - 3, y - 10); c.lineTo(x - 1, y + 8); c.closePath();
        c.fillStyle = s > 0 ? '#7ee05a' : '#4fb0f0'; c.fill(); c.strokeStyle = '#0e2a10'; c.lineWidth = 2.5; c.stroke();
        c.restore();
      }
      c.restore();
    },
    pause(c) {
      c.fillStyle = '#fff'; c.strokeStyle = '#1a1a1a'; c.lineWidth = 3;
      for (const x of [17, 37]) { c.beginPath(); c.rect(x, 14, 10, 36); c.fill(); c.stroke(); }
    },
    sound(c) {
      const H = Hh();
      H.poly(c, [[10, 24], [20, 24], [32, 12], [32, 52], [20, 40], [10, 40]], true);
      H.fillStroke(c, '#fff', '#1a1a1a', 3);
      c.strokeStyle = '#fff'; c.lineWidth = 4; c.lineCap = 'round';
      c.beginPath(); c.arc(32, 32, 10, -0.8, 0.8); c.stroke();
      c.beginPath(); c.arc(32, 32, 19, -0.8, 0.8); c.stroke();
    },
    music(c) {
      const H = Hh();
      c.strokeStyle = '#1a1a1a'; c.lineWidth = 3;
      H.poly(c, [[24, 14], [52, 8], [52, 16], [24, 22]], true); H.fillStroke(c, '#fff', '#1a1a1a', 3);
      c.fillStyle = '#fff';
      c.fillRect(22, 14, 5, 30); c.strokeRect(22, 14, 5, 30);
      c.fillRect(48, 10, 5, 28); c.strokeRect(48, 10, 5, 28);
      H.ellipse(c, 18, 45, 9, 7, -0.4); H.fillStroke(c, '#fff', '#1a1a1a', 3);
      H.ellipse(c, 44, 39, 9, 7, -0.4); H.fillStroke(c, '#fff', '#1a1a1a', 3);
    },
    flee(c) {
      const H = Hh();
      c.save(); c.translate(32, 32);
      c.fillStyle = '#3a2a1a'; c.strokeStyle = '#111'; c.lineWidth = 3;
      c.beginPath(); c.rect(2, -24, 22, 48); c.fill(); c.stroke();
      c.fillStyle = '#ffd23a'; H.ellipse(c, 18, 2, 2.5, 2.5); c.fill();
      H.poly(c, [[-26, 0], [-10, -14], [-10, -6], [6, -6], [6, 6], [-10, 6], [-10, 14]], true);
      H.fillStroke(c, '#fff', '#111', 3);
      c.restore();
    },
  };
  /** Small 4-to-n branch starburst. */
  function star(c, x, y, r, ri, c1, c2, n) {
    n = n || 8;
    c.beginPath();
    for (let i = 0; i < n * 2; i++) {
      const a = -PI / 2 + i * PI / n, rr = i % 2 ? ri : r;
      if (i) c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); else c.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    c.closePath();
    c.fillStyle = Hh().radial(c, x, y, 0, r, [[0, c1], [1, c2]]);
    c.fill();
    c.strokeStyle = 'rgba(60,30,0,.7)'; c.lineWidth = 2; c.stroke();
  }
  function btIcon(name, color) {
    const key = name + '|' + (color || '');
    if (iconCache.has(key)) return iconCache.get(key);
    let url = '';
    try {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const g = c.getContext('2d');
      (ICON_FNS[name] || ICON_FNS.special)(g, color);
      url = c.toDataURL();
    } catch (e) { url = ''; }
    iconCache.set(key, url);
    return url;
  }

  // ================================================================ overlay state
  let root = null;        // overlay element (null when closed)
  let cur = null;         // tournament screen state
  let fight = null;       // running fight controller
  let resizeH = null, keyH = null;
  let fightMusic = false; // music was switched to a battle track

  function canvasCopy(src, cls) {
    const c = el('canvas', cls || '');
    c.width = src.width; c.height = src.height;
    try { c.getContext('2d').drawImage(src, 0, 0); } catch (e) { /* ignore */ }
    return c;
  }
  function npcCanvas(look, w, h, cls) {
    const c = el('canvas', cls || '');
    c.width = w * 2; c.height = h * 2;
    try { PC.ART.drawNPC(c.getContext('2d'), look, 0, 0, w * 2, h * 2, 1.2); } catch (e) { /* ignore */ }
    return c;
  }
  function rewardChips(r) {
    const keys = ['coins', 'xp', 'dollars', 'food_land', 'food_sea', 'food_ice'];
    const names = { coins: 'coin', xp: 'xp', dollars: 'dollar', food_land: 'food_land', food_sea: 'food_sea', food_ice: 'food_ice' };
    const out = [];
    for (const k of keys) if (r && r[k] > 0) out.push(`<span class="bt-chip"><img src="${iconUrl(names[k], 22)}" alt="">${k === 'xp' ? '+' : ''}${fmt(r[k])}${k === 'xp' ? ' XP' : ''}</span>`);
    return out.join('');
  }
  /** Enemy or team creature card. */
  function creatureCard(speciesId, level, name, tag) {
    const sp = PC.SPECIES[speciesId];
    const st = PC.statsAt(speciesId, level), stage = PC.stageForLevel(level);
    const card = el(tag || 'div', 'bt-card');
    card.style.setProperty('--rc', (PC.RARITY[sp.rarity] || {}).color || '#6f777c');
    card.appendChild(canvasCopy(PC.ART.portrait(speciesId, 192, 136, { stage })));
    card.insertAdjacentHTML('beforeend',
      `<span class="bt-lv">Niv. ${level}</span><img class="bt-cls" src="${iconUrl(sp.cls, 20)}" alt="${esc(PC.CLASSES[sp.cls].name)}">` +
      `<div class="bt-cn">${esc(name || sp.name)}</div>` + (name && name !== sp.name ? `<div class="bt-cs">${esc(sp.name)}</div>` : `<div class="bt-cs">${esc(PC.CLASSES[sp.cls].name)} · ${esc(PC.STAGE_NAMES[stage])}</div>`) +
      `<div class="bt-cst"><img src="${iconUrl('hp', 13)}" alt="PV">${fmt(st.hp)}<img src="${iconUrl('atk', 13)}" alt="ATQ">${st.atkMin}–${st.atkMax}</div>`);
    card.title = `${sp.name} · ${PC.CLASSES[sp.cls].name} · ${(PC.RARITY[sp.rarity] || {}).name || ''}`;
    return card;
  }
  function playerTeam(park) {
    const E = ENG();
    let list = [];
    try { if (E && E.battleTeam) list = E.battleTeam(park) || []; } catch (e) { list = []; }
    return list.filter(o => o && PC.SPECIES[o.speciesId]);
  }

  // ================================================================ tournament screen (story map)
  function showTournament() {
    if (!root) return;
    stopFight();
    root.innerHTML = '';
    const park = cur.park, stages = stagesOf(park), cleared = clearedOf(park);
    const P = (PC.DATA && PC.DATA.PARKS && PC.DATA.PARKS[park]) || { name: park };
    const scr = el('div', 'bt-screen bt-tour');
    const head = el('div', 'bt-head bt-steel');
    head.innerHTML = `<img class="bt-head-ico" src="${iconUrl('trophy', 40)}" alt="">` +
      `<div class="bt-titles"><div class="bt-title">TOURNOI</div><div class="bt-sub">${esc(P.name)} — ${Math.min(cleared, stages.length)} / ${stages.length} étapes gagnées</div></div>`;
    const tabs = el('div', 'bt-tabs');
    const order = (PC.DATA && PC.DATA.PARK_ORDER) || ['land', 'sea', 'ice'];
    const short = { land: 'Terre', sea: 'Mer', ice: 'Glace' };
    for (const p of order) {
      const b = el('button', 'bt-tab bt-steel bt-btn-steel' + (p === park ? ' is-on' : ''), short[p] || p);
      b.disabled = !parkUnlocked(p);
      b.title = b.disabled ? 'Parc pas encore débloqué' : ((PC.DATA.PARKS[p] || {}).name || p);
      b.onclick = () => { if (p !== cur.park) { sfx('click'); cur.park = p; cur.stage = null; showTournament(); } };
      tabs.appendChild(b);
    }
    head.appendChild(tabs);
    const x = el('button', 'bt-close');
    x.setAttribute('aria-label', 'Fermer');
    x.onclick = () => { sfx('click'); BT.close(); };
    head.appendChild(x);
    scr.appendChild(head);

    const body = el('div', 'bt-body');
    const wrap = el('div', 'bt-mapwrap');
    const side = el('aside', 'bt-side bt-dark');
    body.appendChild(wrap);
    body.appendChild(side);
    scr.appendChild(body);
    root.appendChild(scr);
    cur.wrap = wrap; cur.side = side;

    if (!stages.length) { side.innerHTML = '<p class="bt-hint">Aucun tournoi dans ce parc pour le moment.</p>'; return; }
    const next = Math.min(cleared + 1, stages.length);
    if (!cur.stage || cur.stage > next) cur.stage = next;
    buildMap();
    renderSide();
    // centre the selected node
    const node = cur.geom.nodes.find(nd => nd.stage === cur.stage);
    if (node) wrap.scrollTop = node.y - wrap.clientHeight / 2;
  }

  /** Node positions along a winding road, stage 1 at the bottom. */
  function mapGeom(park, w) {
    const stages = stagesOf(park), n = stages.length;
    const gap = w < 520 ? 116 : 132, padT = 150, padB = 96;
    const h = padT + (n - 1) * gap + padB;
    const amp = Math.min(w * 0.25, 230);
    const nodes = stages.map((s, i) => ({ stage: s.stage, x: Math.round(w / 2 + Math.sin(i * 1.08 + 0.55) * amp), y: Math.round(h - padB - i * gap) }));
    return { w, h, gap, nodes };
  }
  /** Catmull-Rom → cubic Bézier segments [[p1, c1, c2, p2], …]. */
  function crSegs(pts) {
    const segs = [], n = pts.length, P = i => pts[clamp(i, 0, n - 1)];
    for (let i = 0; i < n - 1; i++) {
      const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
      segs.push([p1, [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6], [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6], p2]);
    }
    return segs;
  }
  function segsPathD(segs) {
    if (!segs.length) return '';
    let d = `M${segs[0][0][0]} ${segs[0][0][1]}`;
    for (const s of segs) d += ` C${s[1][0].toFixed(1)} ${s[1][1].toFixed(1)} ${s[2][0].toFixed(1)} ${s[2][1].toFixed(1)} ${s[3][0]} ${s[3][1]}`;
    return d;
  }
  function segsTrace(ctx, segs) {
    ctx.beginPath();
    ctx.moveTo(segs[0][0][0], segs[0][0][1]);
    for (const s of segs) ctx.bezierCurveTo(s[1][0], s[1][1], s[2][0], s[2][1], s[3][0], s[3][1]);
  }
  /** Sample points along the road (for collision tests). */
  function segsSample(segs, per) {
    const out = [];
    for (const s of segs) for (let i = 0; i < per; i++) {
      const t = i / per, u = 1 - t;
      out.push([u * u * u * s[0][0] + 3 * u * u * t * s[1][0] + 3 * u * t * t * s[2][0] + t * t * t * s[3][0],
        u * u * u * s[0][1] + 3 * u * u * t * s[1][1] + 3 * u * t * t * s[2][1] + t * t * t * s[3][1]]);
    }
    return out;
  }

  function buildMap() {
    const park = cur.park, wrap = cur.wrap;
    const w = Math.max(280, Math.min(780, wrap.clientWidth || 360));
    const G = cur.geom = mapGeom(park, w);
    const cleared = clearedOf(park), n = G.nodes.length, next = Math.min(cleared + 1, n);
    const map = el('div', 'bt-map');
    map.style.width = w + 'px';
    map.style.height = G.h + 'px';
    // painted terrain
    const cv = el('canvas');
    let dpr = Math.min(2, window.devicePixelRatio || 1);
    while (w * G.h * dpr * dpr > 9e6 && dpr > 1) dpr -= 0.25;
    cv.width = Math.round(w * dpr); cv.height = Math.round(G.h * dpr);
    const ctx = cv.getContext('2d');
    ctx.scale(dpr, dpr);
    const segs = crSegs(G.nodes.map(nd => [nd.x, nd.y]));
    try { paintMap(ctx, park, G, segs, cleared); } catch (e) { console.error('battle map', e); }
    map.appendChild(cv);
    // glowing paths (cleared part solid glow, next leg animated)
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${w} ${G.h}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    const addPath = (d, stroke, width, op, cls) => {
      const p = document.createElementNS(svgNS, 'path');
      p.setAttribute('d', d); p.setAttribute('fill', 'none'); p.setAttribute('stroke', stroke);
      p.setAttribute('stroke-width', width); p.setAttribute('stroke-linecap', 'round'); p.setAttribute('opacity', op);
      if (cls) p.setAttribute('class', cls);
      svg.appendChild(p);
    };
    const done = segs.slice(0, Math.max(0, Math.min(cleared, n) - 1));
    if (done.length) {
      const d = segsPathD(done);
      addPath(d, '#fff3a0', 16, 0.28);
      addPath(d, '#ffe46a', 7, 0.85);
      addPath(d, '#ffffff', 3, 0.95, 'bt-flow');
    }
    if (cleared >= 1 && cleared < n) {
      const d = segsPathD([segs[cleared - 1]]);
      addPath(d, '#fff3a0', 12, 0.25);
      addPath(d, '#ffffff', 4, 0.9, 'bt-flow');
    }
    map.appendChild(svg);
    // nodes
    cur.nodeEls = {};
    G.nodes.forEach((nd, i) => {
      const st = stagesOf(park)[i];
      const locked = nd.stage > next, isDone = nd.stage <= cleared, isCur = nd.stage === next && !isDone;
      const b = el('button', 'bt-node' + (isDone ? ' is-done' : '') + (isCur ? ' is-cur' : '') + (locked ? ' is-lock' : ''));
      b.style.left = nd.x + 'px'; b.style.top = nd.y + 'px';
      b.innerHTML = `<b>${nd.stage}</b>` + (locked ? `<img class="bt-lockico" src="${iconUrl('lock', 22)}" alt="">` : '') +
        (isDone ? `<img class="bt-okico" src="${iconUrl('check', 22)}" alt="">` : '');
      b.setAttribute('aria-label', `Étape ${nd.stage} : ${st.name}${locked ? ' (verrouillée)' : ''}`);
      const medals = el('div', 'bt-medals');
      const m = medalOf(park, nd.stage);
      for (let t = 1; t <= 3; t++) medals.appendChild(el('i', 'bt-medal m' + t + (m >= t ? ' on' : '')));
      b.appendChild(medals);
      b.onclick = () => selectStage(nd.stage);
      map.appendChild(b);
      cur.nodeEls[nd.stage] = b;
      // opponent portrait stack beside the node
      const stack = el('div', 'bt-stack' + (locked ? ' lock' : ''));
      const right = nd.x < w / 2;
      stack.style.top = nd.y + 'px';
      stack.style.left = (right ? nd.x + 40 : nd.x - 40 - 64) + 'px';
      st.enemies.slice(0, 3).forEach((e, j) => {
        const sp = PC.SPECIES[e.species];
        if (!sp) return;
        const c = canvasCopy(PC.ART.portrait(e.species, 68, 84, { stage: PC.stageForLevel(e.level), silhouette: nd.stage > next + 1 }));
        c.style.left = (right ? j * 13 : (64 - 34) - j * 13) + 'px';
        c.style.top = (j * 4) + 'px';
        c.style.transform = `rotate(${(right ? 1 : -1) * (j * 7 - 6)}deg)`;
        c.style.borderColor = (PC.RARITY[sp.rarity] || {}).color || '#222';
        c.style.zIndex = 3 - j;
        stack.appendChild(c);
      });
      map.appendChild(stack);
    });
    wrap.innerHTML = '';
    wrap.appendChild(map);
    markSelected();
  }
  function markSelected() {
    if (!cur.nodeEls) return;
    for (const k in cur.nodeEls) cur.nodeEls[k].classList.toggle('is-sel', +k === cur.stage);
  }
  function selectStage(n) {
    const next = Math.min(clearedOf(cur.park) + 1, stagesOf(cur.park).length);
    if (n > next) {
      sfx('error');
      const b = cur.nodeEls[n];
      if (b && b.animate) b.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(0)' }], { duration: 260 });
      flashHint(`Gagne d’abord l’étape ${next} pour débloquer celle-ci !`);
      return;
    }
    sfx('click');
    cur.stage = n;
    cur.tier = null;
    markSelected();
    renderSide();
  }
  function flashHint(text) {
    if (!cur || !cur.side) return;
    let h = cur.side.querySelector('.bt-lockmsg');
    if (!h) { h = el('div', 'bt-hint bt-lockmsg'); cur.side.prepend(h); }
    h.textContent = text;
    h.style.color = '#ffd23a';
    clearTimeout(cur.hintT);
    cur.hintT = setTimeout(() => { if (h.parentNode) h.remove(); }, 2600);
  }

  /** Stage detail: opponent, medal tier, enemy team, reward, team picker and the big COMBAT button. */
  function renderSide() {
    const park = cur.park, side = cur.side, st = stageDef(park, cur.stage);
    if (!st) return;
    const medal = medalOf(park, st.stage);
    if (!cur.tier || cur.tier > Math.min(3, medal + 1)) cur.tier = Math.min(3, medal + 1);
    const tier = cur.tier, npc = npcOf(st.opponent);
    side.innerHTML = '';
    // opponent
    const opp = el('div', 'bt-opp bt-dark');
    opp.appendChild(npcCanvas(npc.look, 78, 94));
    opp.insertAdjacentHTML('beforeend', `<div><div class="bt-opp-name">${esc(npc.name)}</div><div class="bt-opp-role">${esc(npc.role || '')}</div>` +
      `<div class="bt-opp-stage">Étape ${st.stage} · ${esc(st.name)}</div>` +
      `<div class="bt-rec">${medal ? 'Médailles : ' + TIER_NAMES.slice(1, medal + 1).join(', ') : 'Pas encore gagnée'}</div></div>`);
    side.appendChild(opp);
    // tiers
    const secT = el('div', 'bt-sec');
    secT.innerHTML = '<h3>Difficulté</h3>';
    const tiers = el('div', 'bt-tiers');
    for (let t = 1; t <= 3; t++) {
      const b = el('button', 'bt-tier bt-steel bt-btn-steel' + (t === tier ? ' is-on' : ''));
      b.innerHTML = `<i class="bt-medal on m${t}"></i>${TIER_NAMES[t]}` +
        (medal >= t ? `<img class="bt-won" src="${iconUrl('check', 16)}" alt="gagnée">` : t > medal + 1 ? `<img class="bt-tlock" src="${iconUrl('lock', 16)}" alt="">` : '');
      b.disabled = t > medal + 1;
      b.title = t === 1 ? 'Adversaires de base' : t === 2 ? 'Adversaires +5 niveaux' : 'Adversaires +10 niveaux, équipe complète';
      b.onclick = () => { sfx('click'); cur.tier = t; renderSide(); };
      tiers.appendChild(b);
    }
    secT.appendChild(tiers);
    side.appendChild(secT);
    // enemies
    const enemies = enemiesFor(park, st.stage, tier);
    const secE = el('div', 'bt-sec');
    secE.innerHTML = `<h3>Équipe adverse <small>· niveau conseillé ${st.level || '?'}</small></h3>`;
    const ecards = el('div', 'bt-cards');
    enemies.forEach(e => ecards.appendChild(creatureCard(e.species, e.level, e.name)));
    secE.appendChild(ecards);
    side.appendChild(secE);
    // reward
    const rew = rewardPreview(park, st.stage, tier);
    const secR = el('div', 'bt-sec');
    secR.innerHTML = `<h3>Récompense <small>${medal >= tier ? '· déjà gagnée (bonus réduit)' : '· médaille ' + TIER_NAMES[tier]}</small></h3><div class="bt-rew">${rewardChips(rew) || '<span class="bt-hint">—</span>'}</div>`;
    side.appendChild(secR);
    // team picker
    const team = playerTeam(park);
    cur.pickedBy = cur.pickedBy || {};
    let picked = (cur.pickedBy[park] || []).filter(id => team.some(o => o.id === id));
    if (!cur.pickedBy[park]) picked = team.slice(0, 3).map(o => o.id);
    cur.pickedBy[park] = picked;
    const secP = el('div', 'bt-sec');
    secP.innerHTML = `<h3>Ton équipe <small>· touche pour choisir (3 max)</small></h3>`;
    if (!team.length) {
      secP.insertAdjacentHTML('beforeend', `<div class="bt-empty"><img src="${iconUrl('egg', 40)}" alt=""><div>Tu n’as pas encore de créature éclose dans ce parc.<br><b>Fais éclore un œuf</b>, nourris ton bébé, puis reviens combattre !</div></div>`);
    } else {
      const pcards = el('div', 'bt-cards');
      team.forEach(o => {
        const c = creatureCard(o.speciesId, o.level || 1, o.name, 'button');
        c.classList.add('pickable');
        const idx = picked.indexOf(o.id);
        if (idx >= 0) { c.classList.add('is-picked'); c.insertAdjacentHTML('beforeend', `<span class="bt-order">${idx + 1}</span>`); }
        c.onclick = () => {
          const i = picked.indexOf(o.id);
          if (i >= 0) picked.splice(i, 1);
          else if (picked.length < 3) picked.push(o.id);
          else { sfx('error'); flashHint('3 créatures maximum ! Retire-en une d’abord.'); return; }
          sfx('click');
          const sc = pcards.scrollLeft;
          renderSide();
          const nc = cur.side.querySelectorAll('.bt-cards')[1];
          if (nc) nc.scrollLeft = sc;
        };
        pcards.appendChild(c);
      });
      secP.appendChild(pcards);
    }
    side.appendChild(secP);
    const go = el('button', 'bt-go bt-btn-green', 'COMBAT !');
    go.disabled = !picked.length;
    go.onclick = () => {
      const chosen = picked.map(id => team.find(o => o.id === id)).filter(Boolean);
      if (!chosen.length) return;
      sfx('click');
      startFight({
        park, stage: st.stage, tier, stageName: st.name, opponent: npc, opponentId: st.opponent,
        team: chosen.map(o => ({ species: o.speciesId, level: o.level || 1, name: o.name, objId: o.id })),
        enemies,
      });
    };
    side.appendChild(go);
    side.insertAdjacentHTML('beforeend', `<div class="bt-hint">${team.length ? 'L’ordre de sélection est l’ordre d’entrée dans l’arène.' : ''}</div>`);
  }

  // ================================================================ map painting
  const MAP_PAL = {
    land: { base: ['#86c850', '#5c9e36'], blot: ['#9ad65e', '#4c9030', '#74b844', '#a8c860'], tuft: '#3f7a26',
      water: ['#5ab8e8', '#2a78b8'], bank: '#d9c98e', road: '#cfa86a', roadEdge: '#6e4e26', roadLine: '#ead2a0',
      tree: ['#2e7a2a', '#3f9a32', '#58b23c'], trunk: '#6a4a2a', mount: ['#9a7a58', '#5a4030', '#3a2a20'], peak: '#ff6a2a',
      cloud: ['#ffffff', '#d8e4ec'], clearing: '#b8a070' },
    sea: { base: ['#2f9fd6', '#155a96'], blot: ['#3fb6e0', '#1f6aa8', '#58c8e8', '#2a88c8'], tuft: '#7fd8f0',
      water: ['#7fe0f0', '#3ab0d8'], bank: '#f2e2a8', road: '#b8854a', roadEdge: '#5a3a1a', roadLine: '#e0b880',
      tree: ['#3f9a3a', '#5ab84a', '#2e7a2a'], trunk: '#7a5a3a', mount: ['#7a6a5a', '#4a3e34', '#2e2620'], peak: '#ff7a3a',
      cloud: ['#ffffff', '#cfe0ea'], clearing: '#f2e2a8' },
    ice: { base: ['#f2f8fc', '#c9dcea'], blot: ['#ffffff', '#d6e6f2', '#bcd2e4', '#e4eef6'], tuft: '#a8c0d4',
      water: ['#bfe8f6', '#7ac0de'], bank: '#ffffff', road: '#b4c6d6', roadEdge: '#6a8298', roadLine: '#dbe6ee',
      tree: ['#2f5a4a', '#3f6e5a', '#24483a'], trunk: '#5a4a3a', mount: ['#dce8f2', '#9ab8d0', '#6a88a4'], peak: '#ffffff',
      cloud: ['#ffffff', '#d4e2ee'], clearing: '#e4eef6' },
  };

  function paintMap(ctx, park, G, segs, cleared) {
    const H = Hh(), P = MAP_PAL[park] || MAP_PAL.land, w = G.w, h = G.h;
    const R = H.rng(park.length * 1013 + G.nodes.length * 7);
    const road = segsSample(segs, 14);
    const nearRoad = (x, y, d) => road.some(p => (p[0] - x) * (p[0] - x) + (p[1] - y) * (p[1] - y) < d * d);
    // --- base ground
    ctx.fillStyle = H.linear(ctx, 0, 0, 0, h, [[0, P.base[1]], [0.5, P.base[0]], [1, P.base[1]]]);
    ctx.fillRect(0, 0, w, h);
    const blots = Math.round(w * h / 2600);
    for (let i = 0; i < blots; i++) {
      ctx.globalAlpha = 0.18 + R() * 0.25;
      ctx.fillStyle = P.blot[i % P.blot.length];
      H.ellipse(ctx, R() * w, R() * h, 18 + R() * 60, 10 + R() * 30, R() * 3);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (park === 'sea') {
      // wave glints
      ctx.strokeStyle = 'rgba(220,250,255,.35)'; ctx.lineWidth = 1.6; ctx.lineCap = 'round';
      for (let i = 0; i < w * h / 1800; i++) {
        const x = R() * w, y = R() * h, l = 6 + R() * 10;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + l / 2, y - 3, x + l, y); ctx.stroke();
      }
    } else {
      ctx.strokeStyle = park === 'ice' ? 'rgba(150,180,205,.45)' : H.rgba(P.tuft, 0.55); ctx.lineWidth = 1.3; ctx.lineCap = 'round';
      for (let i = 0; i < w * h / 700; i++) {
        const x = R() * w, y = R() * h;
        ctx.beginPath();
        if (park === 'ice') { ctx.moveTo(x, y); ctx.quadraticCurveTo(x + 6, y - 2, x + 12, y); }
        else { ctx.moveTo(x, y); ctx.lineTo(x - 2, y - 5); ctx.moveTo(x, y); ctx.lineTo(x + 2, y - 5); }
        ctx.stroke();
      }
    }
    // --- rivers / reefs, crossing the map between two nodes
    const n = G.nodes.length;
    const riverYs = [0.3, 0.68].map(f => {
      const i = clamp(Math.round((n - 1) * f), 0, n - 2);
      return (G.nodes[i].y + G.nodes[i + 1].y) / 2;
    });
    for (const [ri, ry] of riverYs.entries()) {
      const ph = R() * TAU, amp = 16 + R() * 14;
      const yAt = x => ry + Math.sin(x / w * TAU * 0.9 + ph) * amp;
      const band = (wd, fill) => {
        ctx.beginPath();
        for (let x = -10; x <= w + 10; x += 8) ctx.lineTo(x, yAt(x) - wd / 2);
        for (let x = w + 10; x >= -10; x -= 8) ctx.lineTo(x, yAt(x) + wd / 2);
        ctx.closePath();
        ctx.fillStyle = fill; ctx.fill();
      };
      if (park === 'sea') {
        // coral reef line
        band(40, 'rgba(120,230,240,.35)');
        const cols = ['#ff7a8a', '#ffb05a', '#c07ae0', '#ff5a7a', '#7ae0a0'];
        for (let x = 0; x < w; x += 7) {
          if (nearRoad(x, yAt(x), 26)) continue;
          ctx.fillStyle = cols[(x / 7 + ri) % cols.length | 0];
          H.ellipse(ctx, x + R() * 4, yAt(x) + (R() - 0.5) * 22, 3 + R() * 4, 2.5 + R() * 3);
          ctx.fill();
        }
      } else {
        band(44, P.bank);
        band(30, H.linear(ctx, 0, ry - 30, 0, ry + 30, [[0, P.water[0]], [1, P.water[1]]]));
        ctx.strokeStyle = park === 'ice' ? 'rgba(255,255,255,.9)' : 'rgba(255,255,255,.55)'; ctx.lineWidth = 1.5;
        for (let x = 6; x < w; x += 24 + R() * 20) {
          const y = yAt(x) + (R() - 0.5) * 14;
          ctx.beginPath();
          if (park === 'ice') { ctx.moveTo(x, y); ctx.lineTo(x + 7, y - 4); ctx.lineTo(x + 12, y + 2); }
          else { ctx.moveTo(x, y); ctx.quadraticCurveTo(x + 5, y - 3, x + 10, y); }
          ctx.stroke();
        }
      }
      // bridge where the road crosses
      const crossing = road.reduce((best, p) => { const d = Math.abs(p[1] - yAt(p[0])); return d < best.d ? { d, p } : best; }, { d: 1e9, p: null }).p;
      if (crossing && park !== 'sea') {
        ctx.save(); ctx.translate(crossing[0], yAt(crossing[0]));
        ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(-18, -28, 40, 60);
        ctx.fillStyle = park === 'ice' ? '#8a7a68' : '#8a5a2a';
        ctx.fillRect(-16, -30, 32, 60);
        ctx.strokeStyle = 'rgba(40,20,5,.7)'; ctx.lineWidth = 1.5;
        for (let y = -26; y < 30; y += 6) { ctx.beginPath(); ctx.moveTo(-16, y); ctx.lineTo(16, y); ctx.stroke(); }
        ctx.fillStyle = '#5a3a1a'; ctx.fillRect(-19, -31, 4, 62); ctx.fillRect(15, -31, 4, 62);
        ctx.restore();
      }
    }
    // --- central mountain (on the side the road leaves free)
    const midY = h * 0.5;
    const roadX = road.reduce((b, p) => (Math.abs(p[1] - midY) < Math.abs(b[1] - midY) ? p : b), road[0])[0];
    const mx = roadX < w / 2 ? w * 0.74 : w * 0.26, mw = Math.min(w * 0.42, 260);
    paintMountain(ctx, park, mx, midY + mw * 0.3, mw, P, R);
    // --- forests / islands
    const clusters = Math.round(h / 150);
    for (let c = 0; c < clusters * 3 && c < 200; c++) {
      const cx = R() * w, cy = 40 + R() * (h - 80);
      if (nearRoad(cx, cy, 64) || Math.hypot(cx - mx, cy - midY) < mw * 0.55 || riverYs.some(y => Math.abs(cy - y) < 48)) continue;
      const k = 3 + Math.floor(R() * 7);
      const trees = [];
      for (let i = 0; i < k; i++) trees.push([cx + (R() - 0.5) * 70, cy + (R() - 0.5) * 44, 0.7 + R() * 0.6]);
      trees.sort((a, b) => a[1] - b[1]);
      if (park === 'sea') paintIsland(ctx, cx, cy, 34 + k * 4, P, R);
      for (const t of trees) {
        if (nearRoad(t[0], t[1], 34)) continue;
        if (park === 'ice') paintPine(ctx, t[0], t[1], t[2], P);
        else if (park === 'sea') { if (Math.hypot(t[0] - cx, t[1] - cy) < 30) paintPalm(ctx, t[0], t[1], t[2] * 0.8, P); }
        else if (R() < 0.18) paintPalm(ctx, t[0], t[1], t[2], P);
        else paintTree(ctx, t[0], t[1], t[2], P);
      }
    }
    // --- rocks / flowers
    for (let i = 0; i < h / 40; i++) {
      const x = R() * w, y = R() * h;
      if (nearRoad(x, y, 30)) continue;
      if (park === 'land' && R() < 0.6) {
        const cols = ['#ff6a8a', '#ffd23a', '#ffffff', '#c07ae0'];
        for (let j = 0; j < 5; j++) { ctx.fillStyle = cols[(i + j) % 4]; H.ellipse(ctx, x + (R() - 0.5) * 16, y + (R() - 0.5) * 10, 2.2, 2.2); ctx.fill(); }
      } else {
        const rc = park === 'ice' ? '#9ab0c2' : park === 'sea' ? '#3a5a6a' : '#8a8a80';
        H.ellipse(ctx, x, y, 7 + R() * 6, 5 + R() * 3);
        H.fillStroke(ctx, H.linear(ctx, 0, y - 8, 0, y + 6, [[0, H.shade(rc, 0.3)], [1, H.shade(rc, -0.25)]]), H.shade(rc, -0.5), 1.2);
      }
    }
    // --- road
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    segsTrace(ctx, segs); ctx.strokeStyle = 'rgba(0,0,0,.22)'; ctx.lineWidth = 30; ctx.stroke();
    if (park === 'sea') {
      // wooden pontoon
      segsTrace(ctx, segs); ctx.strokeStyle = P.roadEdge; ctx.lineWidth = 22; ctx.stroke();
      segsTrace(ctx, segs); ctx.strokeStyle = P.road; ctx.lineWidth = 17; ctx.stroke();
      segsTrace(ctx, segs); ctx.setLineDash([2.5, 5]); ctx.strokeStyle = P.roadEdge; ctx.lineWidth = 17; ctx.stroke(); ctx.setLineDash([]);
    } else {
      segsTrace(ctx, segs); ctx.strokeStyle = P.roadEdge; ctx.lineWidth = 24; ctx.stroke();
      segsTrace(ctx, segs); ctx.strokeStyle = P.road; ctx.lineWidth = 18; ctx.stroke();
      segsTrace(ctx, segs); ctx.setLineDash([7, 9]); ctx.strokeStyle = P.roadLine; ctx.lineWidth = 3; ctx.stroke(); ctx.setLineDash([]);
    }
    // --- clearings under the nodes
    for (const nd of G.nodes) {
      if (park === 'sea') paintIsland(ctx, nd.x, nd.y + 6, 50, P, R);
      H.ellipse(ctx, nd.x, nd.y + 8, 46, 22);
      ctx.fillStyle = 'rgba(0,0,0,.22)'; ctx.fill();
      H.ellipse(ctx, nd.x, nd.y + 4, 42, 20);
      H.fillStroke(ctx, H.linear(ctx, 0, nd.y - 16, 0, nd.y + 24, [[0, H.shade(P.clearing, 0.2)], [1, H.shade(P.clearing, -0.2)]]), H.shade(P.clearing, -0.45), 2);
    }
    // --- clouds over the far, locked part of the map
    const firstHidden = cleared + 2;   // stage index (1-based) under the clouds
    if (firstHidden <= n) {
      const cy = G.nodes[firstHidden - 1].y + G.gap * 0.45;
      ctx.fillStyle = H.linear(ctx, 0, 0, 0, cy, [[0, H.rgba(P.cloud[0], 0.97)], [0.85, H.rgba(P.cloud[0], 0.86)], [1, H.rgba(P.cloud[1], 0.5)]]);
      ctx.fillRect(0, 0, w, cy - 10);
      for (let x = -30; x < w + 40; x += 34 + R() * 26) {
        const r = 30 + R() * 34, y = cy - 18 + R() * 16;
        H.ellipse(ctx, x, y + r * 0.25, r * 1.1, r * 0.55); ctx.fillStyle = H.rgba(P.cloud[1], 0.9); ctx.fill();
        H.ellipse(ctx, x, y, r, r * 0.62);
        ctx.fillStyle = H.radial(ctx, x - r * 0.3, y - r * 0.4, 2, r * 1.2, [[0, '#ffffff'], [0.7, P.cloud[0]], [1, P.cloud[1]]]);
        ctx.fill();
      }
      for (let i = 0; i < cy / 60; i++) {
        const x = R() * w, y = R() * (cy - 60), r = 26 + R() * 40;
        H.ellipse(ctx, x, y, r * 1.3, r * 0.6);
        ctx.fillStyle = H.radial(ctx, x - r * 0.3, y - r * 0.3, 2, r * 1.4, [[0, 'rgba(255,255,255,.95)'], [1, H.rgba(P.cloud[1], 0.4)]]);
        ctx.fill();
      }
    }
    // vignette on the sides
    ctx.fillStyle = H.linear(ctx, 0, 0, w, 0, [[0, 'rgba(0,0,0,.28)'], [0.12, 'rgba(0,0,0,0)'], [0.88, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,.28)']]);
    ctx.fillRect(0, 0, w, h);
  }

  function paintTree(ctx, x, y, s, P) {
    const H = Hh();
    H.ellipse(ctx, x + 3 * s, y + 2 * s, 13 * s, 5 * s); ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fill();
    ctx.fillStyle = P.trunk; ctx.fillRect(x - 2 * s, y - 8 * s, 4 * s, 9 * s);
    H.ellipse(ctx, x, y - 16 * s, 14 * s, 13 * s);
    H.fillStroke(ctx, H.radial(ctx, x - 5 * s, y - 22 * s, 1, 18 * s, [[0, P.tree[2]], [0.6, P.tree[1]], [1, P.tree[0]]]), H.shade(P.tree[0], -0.5), 1.4);
    H.ellipse(ctx, x - 4 * s, y - 21 * s, 5 * s, 3.5 * s); ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.fill();
  }
  function paintPalm(ctx, x, y, s, P) {
    const H = Hh();
    H.ellipse(ctx, x + 4 * s, y + 2 * s, 12 * s, 4 * s); ctx.fillStyle = 'rgba(0,0,0,.22)'; ctx.fill();
    ctx.strokeStyle = P.trunk; ctx.lineWidth = 3.5 * s; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + 4 * s, y - 14 * s, x + 2 * s, y - 26 * s); ctx.stroke();
    for (let i = 0; i < 6; i++) {
      const a = -PI / 2 + (i - 2.5) * 0.55;
      ctx.save(); ctx.translate(x + 2 * s, y - 26 * s); ctx.rotate(a + PI / 2);
      H.smooth(ctx, [[0, 0], [-3 * s, -8 * s], [0, -17 * s], [3 * s, -8 * s]], true, 0.6);
      H.fillStroke(ctx, i % 2 ? P.tree[1] : P.tree[2], H.shade(P.tree[0], -0.5), 1);
      ctx.restore();
    }
  }
  function paintPine(ctx, x, y, s, P) {
    const H = Hh();
    H.ellipse(ctx, x + 4 * s, y + 2 * s, 11 * s, 4 * s); ctx.fillStyle = 'rgba(60,90,120,.25)'; ctx.fill();
    ctx.fillStyle = P.trunk; ctx.fillRect(x - 2 * s, y - 6 * s, 4 * s, 7 * s);
    for (let i = 0; i < 3; i++) {
      const by = y - 5 * s - i * 9 * s, bw = (13 - i * 3.5) * s;
      H.poly(ctx, [[x - bw, by], [x, by - 15 * s], [x + bw, by]], true);
      H.fillStroke(ctx, H.linear(ctx, x - bw, 0, x + bw, 0, [[0, P.tree[1]], [1, P.tree[2]]]), H.shade(P.tree[2], -0.4), 1.2);
      H.poly(ctx, [[x - bw * 0.7, by - 4 * s], [x, by - 15 * s], [x + bw * 0.5, by - 6 * s], [x, by - 8 * s]], true);
      ctx.fillStyle = 'rgba(255,255,255,.88)'; ctx.fill();
    }
  }
  function paintIsland(ctx, x, y, r, P, R) {
    const H = Hh();
    H.ellipse(ctx, x, y, r * 1.35, r * 0.75); ctx.fillStyle = 'rgba(140,240,250,.35)'; ctx.fill();
    H.ellipse(ctx, x, y, r * 1.1, r * 0.58);
    H.fillStroke(ctx, H.radial(ctx, x, y - r * 0.2, 2, r * 1.1, [[0, '#fff2c0'], [1, P.bank]]), '#c8a868', 1.5);
    H.ellipse(ctx, x + (R() - 0.5) * 6, y - r * 0.08, r * 0.72, r * 0.34);
    ctx.fillStyle = H.radial(ctx, x, y - r * 0.2, 2, r * 0.8, [[0, '#7ad05a'], [1, '#3f8a32']]);
    ctx.fill();
  }
  function paintMountain(ctx, park, x, y, w, P, R) {
    const H = Hh(), hgt = w * (park === 'ice' ? 0.72 : 0.6);
    H.ellipse(ctx, x, y, w * 0.6, w * 0.16); ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fill();
    if (park === 'sea') { paintIsland(ctx, x, y - 4, w * 0.5, P, R); }
    // main body (two side peaks + main)
    const peaks = park === 'ice' ? [[-0.28, 0.62], [0.26, 0.7], [0, 1]] : [[-0.3, 0.5], [0.3, 0.55], [0, 1]];
    for (const [dx, hk] of peaks) {
      const px = x + dx * w, ph = hgt * hk, bw = w * (dx ? 0.28 : 0.42);
      const crater = park !== 'ice' && !dx;
      H.poly(ctx, crater ? [[px - bw, y], [px - bw * 0.18, y - ph], [px + bw * 0.18, y - ph], [px + bw, y]] : [[px - bw, y], [px, y - ph], [px + bw, y]], true);
      H.fillStroke(ctx, H.linear(ctx, px - bw, 0, px + bw, 0, [[0, P.mount[0]], [0.55, P.mount[1]], [1, P.mount[2]]]), H.shade(P.mount[2], -0.4), 2);
      // ridges
      ctx.strokeStyle = 'rgba(0,0,0,.18)'; ctx.lineWidth = 2;
      for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(px + (i - 1.5) * bw * 0.12, y - ph * 0.85); ctx.lineTo(px + (i - 1.5) * bw * 0.45, y - 2); ctx.stroke(); }
      if (park === 'ice' || dx) {
        // snow caps
        H.poly(ctx, [[px - bw * 0.3, y - ph * 0.7], [px, y - ph], [px + bw * 0.3, y - ph * 0.7], [px + bw * 0.12, y - ph * 0.62], [px, y - ph * 0.72], [px - bw * 0.14, y - ph * 0.6]], true);
        ctx.fillStyle = '#ffffff'; ctx.fill();
      }
      if (crater) {
        H.ellipse(ctx, px, y - ph, bw * 0.18, bw * 0.06); ctx.fillStyle = '#ffb03a'; ctx.fill();
        ctx.strokeStyle = '#ff6a1a'; ctx.lineWidth = 4; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(px - bw * 0.05, y - ph + 2); ctx.quadraticCurveTo(px - bw * 0.15, y - ph * 0.6, px - bw * 0.12, y - ph * 0.35); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(px + bw * 0.08, y - ph + 2); ctx.quadraticCurveTo(px + bw * 0.2, y - ph * 0.7, px + bw * 0.26, y - ph * 0.45); ctx.stroke();
        ctx.fillStyle = H.radial(ctx, px, y - ph, 0, bw * 0.6, [[0, 'rgba(255,140,40,.5)'], [1, 'rgba(255,140,40,0)']]);
        ctx.fillRect(px - bw * 0.6, y - ph - bw * 0.6, bw * 1.2, bw * 1.2);
        for (let i = 0; i < 5; i++) {
          const sx = px + (R() - 0.5) * 10 + i * 6, sy = y - ph - 14 - i * 16, sr = 10 + i * 5;
          H.ellipse(ctx, sx, sy, sr, sr * 0.8); ctx.fillStyle = `rgba(${90 + i * 20},${90 + i * 20},${95 + i * 20},${0.75 - i * 0.1})`; ctx.fill();
        }
      }
    }
  }

  // ================================================================ arena painting
  /** Shared arena geometry (world px = CSS px of the fight canvas at rest). */
  function arenaGeom(L) {
    const W = L.W, H = L.H, cx = W / 2;
    const back = x => L.floorTop + Math.pow((x - cx) / (W * 0.62), 2) * H * 0.07;
    const wallH = H * 0.085;
    return { W, H, cx, back, wallH, standTop: L.floorTop - wallH - H * 0.12 };
  }

  function paintArena(ctx, park, L, m) {
    const H = Hh(), A = arenaGeom(L), W = A.W, Hh_ = A.H;
    const R = H.rng(park === 'sea' ? 77 : park === 'ice' ? 131 : 19);
    const anim = { torches: [], braziers: [], posts: [], lamps: [], vents: [], gateLights: [] };
    const x0 = -m, x1 = W + m, y0 = -m, y1 = Hh_ + m;
    // ---------- sky / water / night
    if (park === 'sea') {
      ctx.fillStyle = H.linear(ctx, 0, y0, 0, L.floorTop, [[0, '#3cc2e6'], [0.45, '#137aa8'], [1, '#063258']]);
    } else if (park === 'ice') {
      ctx.fillStyle = H.linear(ctx, 0, y0, 0, L.floorTop, [[0, '#071026'], [0.5, '#16305a'], [0.85, '#3d6690'], [1, '#7aa2c2']]);
    } else {
      ctx.fillStyle = H.linear(ctx, 0, y0, 0, L.floorTop, [[0, '#5aa8de'], [0.55, '#a8d4ea'], [0.9, '#f4dca8'], [1, '#f0c890']]);
    }
    ctx.fillRect(x0, y0, x1 - x0, L.floorTop - y0 + 2);
    if (park === 'land') {
      // sun + clouds
      ctx.fillStyle = H.radial(ctx, W * 0.78, A.standTop * 0.35, 0, W * 0.3, [[0, 'rgba(255,250,220,.95)'], [0.12, 'rgba(255,240,180,.6)'], [1, 'rgba(255,240,180,0)']]);
      ctx.fillRect(x0, y0, x1 - x0, A.standTop + m);
      for (let i = 0; i < 6; i++) {
        const cx = R() * W, cy = A.standTop * (0.15 + R() * 0.45), r = W * (0.03 + R() * 0.04);
        for (let j = 0; j < 4; j++) { H.ellipse(ctx, cx + (j - 1.5) * r * 0.9, cy + Math.sin(j * 2) * r * 0.15, r, r * 0.55); ctx.fillStyle = 'rgba(255,255,255,.75)'; ctx.fill(); }
      }
    } else if (park === 'ice') {
      for (let i = 0; i < 160; i++) {
        const x = R() * (x1 - x0) + x0, y = y0 + R() * (A.standTop - y0), r = R() < 0.1 ? 1.6 : 0.8;
        ctx.fillStyle = `rgba(255,255,255,${0.4 + R() * 0.6})`; H.ellipse(ctx, x, y, r, r); ctx.fill();
      }
    }
    // ---------- distant scenery
    const ridge = (yb, amp, col, seed, peaks) => {
      const r = H.rng(seed);
      ctx.beginPath(); ctx.moveTo(x0, yb + 40);
      for (let x = x0; x <= x1; x += W / peaks) ctx.lineTo(x, yb - amp * (0.4 + r() * 0.6));
      ctx.lineTo(x1, yb + 40); ctx.closePath(); ctx.fillStyle = col; ctx.fill();
    };
    if (park === 'land') {
      // volcano on the left with smoke
      const vx = W * 0.2, vy = A.standTop + 6, vw = W * 0.2, vh = Hh_ * 0.16;
      ridge(A.standTop + 10, Hh_ * 0.06, '#8fa8b8', 3, 9);
      H.poly(ctx, [[vx - vw, vy], [vx - vw * 0.12, vy - vh], [vx + vw * 0.12, vy - vh], [vx + vw, vy]], true);
      ctx.fillStyle = H.linear(ctx, vx - vw, 0, vx + vw, 0, [[0, '#7a6a68'], [0.6, '#5a4a4a'], [1, '#3e3434']]); ctx.fill();
      ctx.strokeStyle = 'rgba(255,120,40,.85)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(vx - vw * 0.05, vy - vh); ctx.quadraticCurveTo(vx - vw * 0.2, vy - vh * 0.5, vx - vw * 0.15, vy - vh * 0.2); ctx.stroke();
      for (let i = 0; i < 7; i++) {
        const r = vw * (0.1 + i * 0.045);
        H.ellipse(ctx, vx + i * vw * 0.07, vy - vh - r * 0.6 - i * vh * 0.22, r, r * 0.7);
        ctx.fillStyle = `rgba(${130 + i * 12},${125 + i * 12},${125 + i * 12},${0.7 - i * 0.07})`; ctx.fill();
      }
      ridge(A.standTop + 14, Hh_ * 0.035, '#6f9a7a', 5, 14);
      // jungle canopy
      for (let i = 0; i < 46; i++) {
        const x = x0 + R() * (x1 - x0), y = A.standTop + 6 - R() * Hh_ * 0.05, r = W * (0.025 + R() * 0.035);
        H.ellipse(ctx, x, y, r, r * 0.8);
        ctx.fillStyle = H.radial(ctx, x - r * 0.3, y - r * 0.4, 1, r * 1.2, [[0, '#5aa848'], [1, '#1f5a26']]); ctx.fill();
      }
    } else if (park === 'ice') {
      ridge(A.standTop + 10, Hh_ * 0.2, '#5d7c9c', 11, 6);
      // snowy caps on the far peaks
      const r = H.rng(11);
      ctx.fillStyle = 'rgba(235,245,255,.85)';
      for (let x = x0; x <= x1; x += W / 6) { const hh = Hh_ * 0.2 * (0.4 + r() * 0.6); H.poly(ctx, [[x - 22, A.standTop + 10 - hh + 26], [x, A.standTop + 10 - hh], [x + 22, A.standTop + 10 - hh + 26]], true); ctx.fill(); }
      ridge(A.standTop + 14, Hh_ * 0.08, '#8aa8c4', 13, 11);
    } else {
      // underwater rock arches and kelp silhouettes
      ridge(A.standTop + 30, Hh_ * 0.14, 'rgba(8,60,90,.75)', 17, 7);
      ridge(A.standTop + 30, Hh_ * 0.07, 'rgba(6,46,74,.9)', 23, 12);
      ctx.strokeStyle = 'rgba(10,70,70,.6)'; ctx.lineCap = 'round';
      for (let i = 0; i < 14; i++) {
        const x = x0 + R() * (x1 - x0), hh = Hh_ * (0.1 + R() * 0.14);
        ctx.lineWidth = 4 + R() * 4;
        ctx.beginPath(); ctx.moveTo(x, A.standTop + 30);
        ctx.bezierCurveTo(x + 14, A.standTop + 30 - hh * 0.3, x - 14, A.standTop + 30 - hh * 0.7, x + 6, A.standTop + 30 - hh); ctx.stroke();
      }
    }
    // ---------- floodlight towers (behind the stands)
    for (const fx of [W * 0.045, W * 0.955]) {
      const top = Math.max(y0 + 20, A.standTop - Hh_ * 0.22), bot = A.standTop + 30, tw = Math.max(16, W * 0.018);
      ctx.strokeStyle = park === 'sea' ? '#2a4a5a' : '#3a4248'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(fx - tw, bot); ctx.lineTo(fx - tw * 0.4, top); ctx.moveTo(fx + tw, bot); ctx.lineTo(fx + tw * 0.4, top); ctx.stroke();
      ctx.lineWidth = 1.5;
      for (let y = top; y < bot; y += 14) {
        const k1 = (y - top) / (bot - top), k2 = (y + 14 - top) / (bot - top);
        const a = lerp(tw * 0.4, tw, k1), b = lerp(tw * 0.4, tw, k2);
        ctx.beginPath(); ctx.moveTo(fx - a, y); ctx.lineTo(fx + b, y + 14); ctx.moveTo(fx + a, y); ctx.lineTo(fx - b, y + 14); ctx.stroke();
      }
      // lamp head
      const lw = tw * 3.2, lh = tw * 1.7;
      ctx.fillStyle = '#2a3036'; ctx.fillRect(fx - lw / 2 - 3, top - lh - 3, lw + 6, lh + 6);
      for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) {
        const lx = fx - lw / 2 + (i + 0.5) * lw / 3, ly = top - lh + (j + 0.5) * lh / 2;
        H.ellipse(ctx, lx, ly, lw / 8, lh / 5);
        ctx.fillStyle = H.radial(ctx, lx, ly, 0, lw / 8, [[0, '#ffffff'], [0.6, park === 'sea' ? '#bff6ff' : '#fff6c8'], [1, '#c8b880']]); ctx.fill();
        anim.lamps.push([lx, ly, lw / 6]);
      }
    }
    // ---------- stands with crowd (follow the back curve)
    const tiers = 4, tierH = (L.floorTop - A.wallH - A.standTop) / tiers;
    const stoneTop = park === 'ice' ? '#dfe9f2' : park === 'sea' ? '#5a7c96' : '#c9b48e';
    const stoneFace = park === 'ice' ? '#8aa2b8' : park === 'sea' ? '#2c4a62' : '#8a7454';
    const crowdCols = park === 'ice' ? ['#e0402a', '#3a7ad8', '#f2c21c', '#ffffff', '#5ab84a', '#a84ae0'] : park === 'sea' ? ['#ffd23a', '#ff7a5a', '#5ae0f0', '#ffffff', '#ff5a9a', '#7ae05a'] : ['#e0402a', '#f2c21c', '#3a8ad8', '#ffffff', '#5ab84a', '#ff8a2a'];
    const curveDy = x => A.back(x) - L.floorTop;
    for (let t = 0; t < tiers; t++) {
      const yt = A.standTop + t * tierH;
      const band = (ya, yb, fill) => {
        ctx.beginPath();
        for (let x = x0; x <= x1; x += 12) ctx.lineTo(x, ya + curveDy(x) * 0.6);
        for (let x = x1; x >= x0; x -= 12) ctx.lineTo(x, yb + curveDy(x) * 0.6);
        ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
      };
      band(yt, yt + tierH * 0.35, stoneTop);
      band(yt + tierH * 0.35, yt + tierH + 1, H.linear(ctx, 0, yt, 0, yt + tierH, [[0, stoneFace], [1, H.shade(stoneFace, -0.3)]]));
      // spectators
      const sp = Math.max(7, W / 90);
      for (let x = x0 + (t % 2) * sp / 2; x < x1; x += sp) {
        if (R() < 0.12) continue;
        const y = yt + tierH * 0.3 + curveDy(x) * 0.6, c = crowdCols[(R() * crowdCols.length) | 0];
        ctx.fillStyle = H.shade(c, -0.15); ctx.fillRect(x - sp * 0.32, y - sp * 0.2, sp * 0.64, sp * 0.75);
        ctx.fillStyle = R() < 0.5 ? '#f0c8a0' : R() < 0.5 ? '#c08a5a' : '#8a5a3a';
        H.ellipse(ctx, x, y - sp * 0.42, sp * 0.24, sp * 0.26); ctx.fill();
        if (R() < 0.08) { ctx.fillStyle = crowdCols[(R() * crowdCols.length) | 0]; ctx.fillRect(x + sp * 0.1, y - sp * 1.3, sp * 0.6, sp * 0.4); ctx.fillStyle = '#333'; ctx.fillRect(x + sp * 0.06, y - sp * 1.3, 1.2, sp * 1.1); }
      }
    }
    // ---------- back wall
    const wallPath = (ya, yb) => {
      ctx.beginPath();
      for (let x = x0; x <= x1; x += 10) ctx.lineTo(x, A.back(x) - ya);
      for (let x = x1; x >= x0; x -= 10) ctx.lineTo(x, A.back(x) - yb);
      ctx.closePath();
    };
    const wallCol = park === 'ice' ? ['#cfe8f6', '#8ab8d6'] : park === 'sea' ? ['#4a6a84', '#22384c'] : ['#b8a07a', '#7a6446'];
    wallPath(A.wallH, -2);
    ctx.fillStyle = H.linear(ctx, 0, L.floorTop - A.wallH, 0, L.floorTop, [[0, wallCol[0]], [1, wallCol[1]]]); ctx.fill();
    // blocks
    ctx.strokeStyle = park === 'sea' ? 'rgba(120,220,255,.25)' : 'rgba(40,30,20,.3)'; ctx.lineWidth = 1.2;
    const rows = 4;
    for (let r = 1; r < rows; r++) {
      ctx.beginPath();
      for (let x = x0; x <= x1; x += 10) ctx.lineTo(x, A.back(x) - A.wallH * r / rows);
      ctx.stroke();
    }
    const bw = Math.max(26, W / 26);
    for (let r = 0; r < rows; r++) for (let x = x0 + (r % 2) * bw / 2; x < x1; x += bw) {
      const yb = A.back(x) - A.wallH * r / rows;
      ctx.beginPath(); ctx.moveTo(x, yb); ctx.lineTo(x, yb - A.wallH / rows); ctx.stroke();
    }
    if (park === 'sea') {
      // cyan light strips along the wall
      ctx.strokeStyle = 'rgba(90,240,255,.85)'; ctx.lineWidth = 2.5;
      ctx.beginPath(); for (let x = x0; x <= x1; x += 10) ctx.lineTo(x, A.back(x) - A.wallH + 3); ctx.stroke();
      ctx.beginPath(); for (let x = x0; x <= x1; x += 10) ctx.lineTo(x, A.back(x) - 4); ctx.stroke();
    } else {
      // coping on top of the wall
      wallPath(A.wallH + 5, A.wallH - 2);
      ctx.fillStyle = park === 'ice' ? '#ffffff' : '#d8c8a0'; ctx.fill();
    }
    // ---------- gates
    const gate = (gx, gw, gh, big) => {
      const gy = A.back(gx);
      ctx.save();
      // hazard frame
      ctx.fillStyle = '#1b1b1b'; ctx.fillRect(gx - gw / 2 - 7, gy - gh - 7, gw + 14, gh + 7);
      ctx.save(); ctx.beginPath(); ctx.rect(gx - gw / 2 - 6, gy - gh - 6, gw + 12, gh + 6); ctx.clip();
      ctx.fillStyle = '#f5c518';
      for (let s = -gh - 20; s < gw + gh; s += 14) { ctx.beginPath(); ctx.moveTo(gx - gw / 2 - 6 + s, gy - gh - 6); ctx.lineTo(gx - gw / 2 + 1 + s, gy - gh - 6); ctx.lineTo(gx - gw / 2 + 1 + s - gh - 6, gy); ctx.lineTo(gx - gw / 2 - 6 + s - gh - 6, gy); ctx.closePath(); ctx.fill(); }
      ctx.restore();
      // doors
      const door = park === 'sea' ? ['#6a8a9e', '#2e4656'] : ['#8a949c', '#4a535a'];
      ctx.fillStyle = H.linear(ctx, 0, gy - gh, 0, gy, [[0, door[0]], [1, door[1]]]);
      ctx.fillRect(gx - gw / 2, gy - gh, gw, gh);
      ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(gx, gy - gh); ctx.lineTo(gx, gy); ctx.stroke();
      ctx.lineWidth = 1;
      for (let i = 1; i < 6; i++) { const xx = gx - gw / 2 + i * gw / 6; ctx.beginPath(); ctx.moveTo(xx, gy - gh + 4); ctx.lineTo(xx, gy - 2); ctx.stroke(); }
      ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.fillRect(gx - gw / 2, gy - gh, gw, 3);
      // rivets
      ctx.fillStyle = '#d8dee2';
      for (let i = 0; i < 4; i++) for (const yy of [gy - gh + 6, gy - gh / 2, gy - 6]) { H.ellipse(ctx, gx - gw / 2 + 5 + i * (gw - 10) / 3, yy, 1.5, 1.5); ctx.fill(); }
      if (park === 'sea') {
        H.ellipse(ctx, gx, gy - gh * 0.55, gw * 0.22, gw * 0.22); ctx.strokeStyle = 'rgba(90,240,255,.95)'; ctx.lineWidth = 3; ctx.stroke();
      } else {
        ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(gx - gw * 0.3, gy - gh * 0.62, gw * 0.6, gh * 0.12);
      }
      ctx.restore();
      anim.gateLights.push([gx - gw / 2 + 2, gy - gh - 12, big ? 6 : 4], [gx + gw / 2 - 2, gy - gh - 12, big ? 6 : 4]);
      ctx.fillStyle = '#2a2a2a';
      for (const lx of [gx - gw / 2 + 2, gx + gw / 2 - 2]) { ctx.fillRect(lx - 4, gy - gh - 16, 8, 8); }
    };
    gate(A.cx, W * 0.15, A.wallH * 1.55, true);
    gate(W * 0.2, W * 0.075, A.wallH * 0.95, false);
    gate(W * 0.8, W * 0.075, A.wallH * 0.95, false);
    // ---------- wall decorations: torches (land), ice pillars + braziers (ice), coral beds (sea)
    if (park === 'land') {
      for (const tx of [0.1, 0.34, 0.66, 0.9]) {
        const x = W * tx, y = A.back(x) - A.wallH * 0.62;
        ctx.fillStyle = '#3a2a1a'; ctx.fillRect(x - 2.5, y, 5, A.wallH * 0.3);
        ctx.fillStyle = '#5a4a3a'; ctx.beginPath(); ctx.moveTo(x - 8, y); ctx.lineTo(x + 8, y); ctx.lineTo(x + 4, y + 7); ctx.lineTo(x - 4, y + 7); ctx.closePath(); ctx.fill();
        anim.torches.push([x, y - 1, Math.max(8, W * 0.01)]);
      }
      // jungle plants peeking over the wall
      if (PC.BUILD_ART && PC.BUILD_ART.drawScenery) {
        const kinds = ['palm', 'broadleaf', 'palm', 'fern', 'palm', 'broadleaf'];
        for (let i = 0; i < 7; i++) {
          const x = W * (0.05 + i * 0.15) + (R() - 0.5) * 30;
          try { PC.BUILD_ART.drawScenery(ctx, kinds[i % kinds.length], x, A.standTop + 4, Hh_ * 0.12 + R() * Hh_ * 0.05, 0, 7 + i * 13); } catch (e) { /* optional */ }
        }
      }
    } else if (park === 'ice') {
      for (const tx of [0.08, 0.31, 0.69, 0.92]) {
        const x = W * tx, yb = A.back(x) + 4, ph = A.wallH * 2.1, pw = Math.max(16, W * 0.026);
        H.poly(ctx, [[x - pw, yb], [x - pw * 0.8, yb - ph * 0.85], [x, yb - ph], [x + pw * 0.8, yb - ph * 0.85], [x + pw, yb]], true);
        ctx.fillStyle = H.linear(ctx, x - pw, 0, x + pw, 0, [[0, 'rgba(200,240,255,.9)'], [0.45, 'rgba(120,200,240,.8)'], [1, 'rgba(60,140,200,.9)']]); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,.6)';
        ctx.beginPath(); ctx.moveTo(x - pw * 0.3, yb - 4); ctx.lineTo(x - pw * 0.2, yb - ph * 0.9); ctx.stroke();
        H.ellipse(ctx, x, yb - ph - 1, pw * 0.7, 4); ctx.fillStyle = '#ffffff'; ctx.fill();
      }
      for (const tx of [0.2, 0.42, 0.58, 0.8]) {
        const x = W * tx, yb = A.back(x) + 6, s = Math.max(10, W * 0.013);
        ctx.fillStyle = '#6a7680'; ctx.fillRect(x - s * 0.5, yb - s * 2.2, s, s * 2.2);
        ctx.fillStyle = '#ffffff'; ctx.fillRect(x - s * 0.6, yb - s * 2.3, s * 1.2, s * 0.25);
        ctx.beginPath(); ctx.moveTo(x - s * 1.3, yb - s * 2.3); ctx.lineTo(x + s * 1.3, yb - s * 2.3); ctx.lineTo(x + s * 0.8, yb - s * 1.6); ctx.lineTo(x - s * 0.8, yb - s * 1.6); ctx.closePath();
        ctx.fillStyle = '#2a2420'; ctx.fill(); ctx.strokeStyle = '#8a6a3a'; ctx.lineWidth = 1.5; ctx.stroke();
        anim.braziers.push([x, yb - s * 2.35, s * 1.1]);
      }
      if (PC.BUILD_ART && PC.BUILD_ART.drawScenery) {
        for (let i = 0; i < 6; i++) {
          const x = W * (0.03 + i * 0.19) + (R() - 0.5) * 30;
          try { PC.BUILD_ART.drawScenery(ctx, 'pine', x, A.standTop + 4, Hh_ * 0.1 + R() * Hh_ * 0.04, 0, 3 + i * 11); } catch (e) { /* optional */ }
        }
      }
    } else if (park === 'sea' && PC.BUILD_ART && PC.BUILD_ART.drawScenery) {
      const kinds = ['coral_fan', 'coral_brain', 'kelp', 'anemone', 'coral_fan', 'sea_rock', 'kelp', 'coral_brain'];
      for (let i = 0; i < 9; i++) {
        const x = W * (0.02 + i * 0.12) + (R() - 0.5) * 24;
        if (Math.abs(x - A.cx) < W * 0.1) continue;
        try { PC.BUILD_ART.drawScenery(ctx, kinds[i % kinds.length], x, A.back(x) + 6, Hh_ * 0.075 + R() * Hh_ * 0.03, 0, 5 + i * 17); } catch (e) { /* optional */ }
      }
      for (const vx of [0.27, 0.73]) anim.vents.push(W * vx);
    }
    // ---------- floor
    ctx.beginPath();
    for (let x = x0; x <= x1; x += 10) ctx.lineTo(x, A.back(x));
    ctx.lineTo(x1, y1); ctx.lineTo(x0, y1); ctx.closePath();
    const floorCol = park === 'ice' ? ['#c8dcec', '#eef6fb', '#d6e6f2'] : park === 'sea' ? ['#7aa8b4', '#e2d6a6', '#c8b682'] : ['#c49a5e', '#e8c88a', '#d2aa6a'];
    ctx.fillStyle = H.linear(ctx, 0, L.floorTop, 0, y1, [[0, floorCol[0]], [0.35, floorCol[1]], [1, floorCol[2]]]);
    ctx.fill();
    ctx.save();
    ctx.clip();
    // speckles
    const spk = Math.round(W * (Hh_ - L.floorTop) / 90);
    for (let i = 0; i < spk; i++) {
      const x = x0 + R() * (x1 - x0), y = L.floorTop + R() * (y1 - L.floorTop), r = 0.6 + R() * 1.6 * (0.4 + (y - L.floorTop) / (Hh_ - L.floorTop));
      ctx.fillStyle = park === 'ice' ? (R() < 0.5 ? 'rgba(255,255,255,.9)' : 'rgba(140,175,205,.45)') : (R() < 0.5 ? 'rgba(90,60,30,.25)' : 'rgba(255,245,215,.45)');
      H.ellipse(ctx, x, y, r, r * 0.6); ctx.fill();
    }
    // arena ring
    const ry = (L.yFront - L.yBack) * 0.72, rcY = (L.yFront + L.yBack) / 2;
    H.ellipse(ctx, A.cx, rcY, W * 0.38, ry);
    ctx.strokeStyle = park === 'sea' ? 'rgba(90,240,255,.35)' : park === 'ice' ? 'rgba(80,140,200,.3)' : 'rgba(255,255,255,.3)';
    ctx.lineWidth = Math.max(3, W * 0.005); ctx.stroke();
    H.ellipse(ctx, A.cx, rcY, W * 0.06, ry * 0.16); ctx.stroke();
    // patches: ice sheets / ripples / footprints & scratches
    if (park === 'ice') {
      for (let i = 0; i < 7; i++) {
        const x = R() * W, y = L.floorTop + (0.15 + R() * 0.8) * (Hh_ - L.floorTop), rx = W * (0.04 + R() * 0.07);
        H.ellipse(ctx, x, y, rx, rx * 0.22);
        ctx.fillStyle = H.linear(ctx, x - rx, y, x + rx, y, [[0, 'rgba(150,210,240,.55)'], [0.5, 'rgba(220,245,255,.75)'], [1, 'rgba(120,190,230,.55)']]); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(x - rx * 0.5, y - rx * 0.05); ctx.lineTo(x + rx * 0.1, y - rx * 0.1); ctx.stroke();
      }
    } else if (park === 'sea') {
      ctx.strokeStyle = 'rgba(150,120,70,.25)'; ctx.lineWidth = 2;
      for (let y = L.floorTop + 10; y < y1; y += 14 + (y - L.floorTop) * 0.05) {
        ctx.beginPath();
        for (let x = x0; x <= x1; x += 16) ctx.lineTo(x, y + Math.sin(x * 0.03 + y) * 3);
        ctx.stroke();
      }
      for (let i = 0; i < 10; i++) {
        const x = R() * W, y = L.floorTop + (0.2 + R() * 0.75) * (Hh_ - L.floorTop), s = 4 + R() * 5;
        ctx.fillStyle = R() < 0.5 ? '#ff8a6a' : '#f6e2c8';
        ctx.beginPath();
        for (let a = 0; a < 5; a++) { const an = -PI / 2 + a * TAU / 5; ctx.lineTo(x + Math.cos(an) * s, y + Math.sin(an) * s * 0.55); ctx.lineTo(x + Math.cos(an + PI / 5) * s * 0.4, y + Math.sin(an + PI / 5) * s * 0.22); }
        ctx.closePath(); ctx.fill();
      }
    } else {
      ctx.strokeStyle = 'rgba(110,70,30,.25)'; ctx.lineWidth = 2; ctx.lineCap = 'round';
      for (let i = 0; i < 14; i++) {
        const x = R() * W, y = L.floorTop + (0.1 + R() * 0.85) * (Hh_ - L.floorTop), l = 10 + R() * 26;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + l, y + (R() - 0.5) * 6); ctx.stroke();
      }
      for (let i = 0; i < 9; i++) {
        const x = R() * W, y = L.floorTop + (0.15 + R() * 0.8) * (Hh_ - L.floorTop), s = 5 + R() * 6;
        H.ellipse(ctx, x, y, s, s * 0.6); ctx.fillStyle = H.linear(ctx, 0, y - s, 0, y + s, [[0, '#b8a68a'], [1, '#6e5e48']]); ctx.fill();
      }
    }
    // shadow cast by the wall + side vignette
    ctx.fillStyle = H.linear(ctx, 0, L.floorTop, 0, L.floorTop + Hh_ * 0.08, [[0, 'rgba(0,0,0,.32)'], [1, 'rgba(0,0,0,0)']]);
    ctx.fillRect(x0, L.floorTop - 20, x1 - x0, Hh_ * 0.12);
    ctx.restore();
    // ---------- electric fence along the floor edge (land & ice)
    if (park !== 'sea') {
      const nP = 11;
      for (let i = 0; i <= nP; i++) {
        const x = lerp(W * -0.02, W * 1.02, i / nP);
        if (Math.abs(x - A.cx) < W * 0.09) continue;
        anim.posts.push([x, A.back(x) + 3]);
      }
      const ph = A.wallH * 0.75;
      ctx.strokeStyle = 'rgba(30,30,30,.8)'; ctx.lineWidth = 1.2;
      for (let wi = 1; wi <= 3; wi++) {
        ctx.beginPath();
        let started = false;
        for (let i = 0; i < anim.posts.length; i++) {
          const p = anim.posts[i], q = anim.posts[i + 1];
          const y = p[1] - ph * wi / 3.3;
          if (!started) { ctx.moveTo(p[0], y); started = true; } else ctx.lineTo(p[0], y);
          if (q && q[0] - p[0] > W * 0.15) { started = false; }
        }
        ctx.stroke();
      }
      for (const p of anim.posts) {
        ctx.fillStyle = '#2a2f33'; ctx.fillRect(p[0] - 2.5, p[1] - ph, 5, ph);
        ctx.fillStyle = '#f5c518';
        for (let wi = 1; wi <= 3; wi++) { ctx.fillRect(p[0] - 3.5, p[1] - ph * wi / 3.3 - 2, 7, 4); }
      }
      // warning signs
      for (const p of anim.posts.filter((_, i) => i % 3 === 1)) {
        const x = p[0] + W * 0.02, y = p[1] - ph * 0.5, s = Math.max(7, W * 0.008);
        H.poly(ctx, [[x, y - s], [x + s, y + s * 0.7], [x - s, y + s * 0.7]], true);
        H.fillStroke(ctx, '#f5c518', '#1b1b1b', 1.5);
        ctx.fillStyle = '#1b1b1b'; ctx.fillRect(x - 0.8, y - s * 0.4, 1.6, s * 0.65);
      }
    }
    // ---------- floor vignette
    ctx.fillStyle = H.linear(ctx, x0, 0, x1, 0, [[0, 'rgba(0,0,0,.35)'], [0.18, 'rgba(0,0,0,0)'], [0.82, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,.35)']]);
    ctx.fillRect(x0, L.floorTop - A.wallH * 2, x1 - x0, y1 - L.floorTop + A.wallH * 2);
    if (park === 'sea') {
      // glass dome ribs over the whole arena
      const dcx = A.cx, dcy = L.floorTop + Hh_ * 0.1, rx = W * 0.72, ryD = Hh_ * 0.62;
      ctx.save();
      H.ellipse(ctx, dcx, dcy, rx, ryD); ctx.fillStyle = 'rgba(120,230,255,.04)'; ctx.fill();
      for (const k of [1, 0.985]) {
        ctx.beginPath(); ctx.ellipse(dcx, dcy, rx * k, ryD * k, 0, PI, TAU);
        ctx.strokeStyle = k === 1 ? 'rgba(20,50,70,.9)' : 'rgba(110,245,255,.9)'; ctx.lineWidth = k === 1 ? 9 : 2.5; ctx.stroke();
      }
      for (const f of [-0.62, -0.3, 0.3, 0.62]) {
        ctx.beginPath(); ctx.ellipse(dcx, dcy, rx * Math.abs(f), ryD, 0, f < 0 ? PI : PI * 1.5, f < 0 ? PI * 1.5 : TAU);
        ctx.strokeStyle = 'rgba(20,50,70,.7)'; ctx.lineWidth = 5; ctx.stroke();
        ctx.strokeStyle = 'rgba(110,245,255,.45)'; ctx.lineWidth = 1.5; ctx.stroke();
      }
      ctx.restore();
    }
    return anim;
  }

  /** Animated arena layers drawn behind the creatures. */
  function drawArenaBack(ctx, park, L, anim, t) {
    const H = Hh(), A = arenaGeom(L), W = L.W;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    // floodlight glows and gate warning lights
    for (const [x, y, r] of anim.lamps) {
      const f = 0.85 + 0.15 * Math.sin(t * 7 + x);
      ctx.fillStyle = H.radial(ctx, x, y, 0, r * 4, [[0, `rgba(255,250,220,${0.55 * f})`], [1, 'rgba(255,250,220,0)']]);
      ctx.fillRect(x - r * 4, y - r * 4, r * 8, r * 8);
    }
    for (const [i, [x, y, r]] of anim.gateLights.entries()) {
      const on = Math.sin(t * 5 + i * PI) > 0;
      const col = park === 'sea' ? '90,240,255' : '255,60,30';
      ctx.fillStyle = H.radial(ctx, x, y, 0, r * 3.5, [[0, `rgba(${col},${on ? 0.95 : 0.25})`], [1, `rgba(${col},0)`]]);
      ctx.fillRect(x - r * 4, y - r * 4, r * 8, r * 8);
    }
    ctx.restore();
    if (park === 'land') {
      for (const [x, y, s] of anim.torches) flame(ctx, x, y, s, t, 0);
      // electric arcs between fence posts
      const P = anim.posts;
      if (P.length > 1) {
        const slot = Math.floor(t * 1.6), ph = (t * 1.6) % 1;
        if (ph < 0.18) {
          const i = (slot * 7) % (P.length - 1), a = P[i], b = P[i + 1];
          if (b[0] - a[0] < W * 0.15) electricArc(ctx, a[0], a[1] - A.wallH * 0.45, b[0], b[1] - A.wallH * 0.45, slot);
        }
      }
      // floating dust motes in the sun
      ctx.fillStyle = 'rgba(255,240,200,.5)';
      for (let i = 0; i < 18; i++) {
        const x = ((i * 137.5 + t * (8 + i % 5)) % (W + 40)) - 20, y = L.floorTop + ((i * 61) % 100) / 100 * (L.H - L.floorTop) * 0.8 + Math.sin(t + i) * 8;
        H.ellipse(ctx, x, y, 1.4, 1.4); ctx.fill();
      }
    } else if (park === 'ice') {
      // aurora ribbons
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let r = 0; r < 3; r++) {
        const base = A.standTop * (0.25 + r * 0.18), amp = A.standTop * 0.1;
        for (let x = -40; x < W + 40; x += 6) {
          const y = base + Math.sin(x * 0.006 + t * 0.35 + r * 2) * amp + Math.sin(x * 0.017 - t * 0.6 + r) * amp * 0.35;
          const hgt = A.standTop * (0.18 + 0.08 * Math.sin(x * 0.01 + t * 0.8 + r));
          const a = 0.1 + 0.08 * Math.sin(x * 0.02 + t * 1.3 + r * 3);
          ctx.fillStyle = H.linear(ctx, 0, y - hgt, 0, y, [[0, 'rgba(160,80,255,0)'], [0.5, `rgba(${r === 1 ? '120,90,255' : '60,255,160'},${a})`], [1, 'rgba(60,255,160,0)']]);
          ctx.fillRect(x, y - hgt, 7, hgt);
        }
      }
      ctx.restore();
      for (const [x, y, s] of anim.braziers) flame(ctx, x, y, s, t, 1);
    } else {
      // light rays from the surface
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 6; i++) {
        const x = W * (i / 5) + Math.sin(t * 0.25 + i) * W * 0.05, w = W * (0.04 + (i % 3) * 0.02);
        const a = 0.07 + 0.04 * Math.sin(t * 0.7 + i * 1.7);
        ctx.fillStyle = H.linear(ctx, 0, -40, 0, L.yFront, [[0, `rgba(200,250,255,${a})`], [1, 'rgba(200,250,255,0)']]);
        ctx.beginPath(); ctx.moveTo(x - w * 0.5, -40); ctx.lineTo(x + w * 0.5, -40); ctx.lineTo(x + w * 2.5, L.yFront); ctx.lineTo(x + w * 0.8, L.yFront); ctx.closePath(); ctx.fill();
      }
      // caustics on the sand
      for (let i = 0; i < 14; i++) {
        const x = ((i * 97) % 100) / 100 * W + Math.sin(t * 0.6 + i) * 20, y = L.floorTop + (((i * 53) % 100) / 100) * (L.H - L.floorTop);
        H.ellipse(ctx, x, y, W * 0.05, W * 0.012, Math.sin(t * 0.3 + i) * 0.3);
        ctx.fillStyle = `rgba(190,250,255,${0.05 + 0.04 * Math.sin(t * 1.4 + i)})`; ctx.fill();
      }
      ctx.restore();
      // fish swimming behind the dome
      for (let i = 0; i < 5; i++) {
        const dir = i % 2 ? 1 : -1, sp = 20 + i * 7;
        const x = dir > 0 ? ((t * sp + i * 300) % (W + 120)) - 60 : W + 60 - ((t * sp + i * 300) % (W + 120));
        const y = A.standTop * (0.3 + (i * 0.17) % 0.6) + Math.sin(t * 1.5 + i) * 6, s = 5 + (i % 3) * 2;
        ctx.save(); ctx.translate(x, y); ctx.scale(dir, 1);
        ctx.fillStyle = 'rgba(10,50,80,.55)';
        H.ellipse(ctx, 0, 0, s * 1.6, s * 0.6); ctx.fill();
        H.poly(ctx, [[-s * 1.4, 0], [-s * 2.4, -s * 0.7], [-s * 2.4, s * 0.7]], true); ctx.fill();
        ctx.restore();
      }
      // bubble columns from the vents
      for (const vx of anim.vents) for (let i = 0; i < 8; i++) {
        const ph = (t * 0.35 + i / 8) % 1, y = A.back(vx) - ph * (A.back(vx) + 20), x = vx + Math.sin(t * 3 + i * 2) * 5 * ph;
        bubble(ctx, x, y, 2 + (i % 3) * 1.5, 0.7 * (1 - ph * 0.5));
      }
    }
  }
  /** Ambient layer in front of the creatures. */
  function drawArenaFront(ctx, park, L, t) {
    const W = L.W, Hgt = L.H;
    if (park === 'ice') {
      ctx.fillStyle = 'rgba(255,255,255,.9)';
      for (let i = 0; i < 70; i++) {
        const sp = 18 + (i % 7) * 6, r = 0.8 + (i % 4) * 0.7;
        const y = ((i * 71.3 + t * sp) % (Hgt + 20)) - 10, x = ((i * 157.7) % W) + Math.sin(t * 0.8 + i) * 14;
        Hh().ellipse(ctx, x, y, r, r); ctx.fill();
      }
    } else if (park === 'sea') {
      for (let i = 0; i < 24; i++) {
        const sp = 22 + (i % 5) * 9;
        const y = Hgt + 10 - ((i * 83.1 + t * sp) % (Hgt + 30)), x = ((i * 131.3) % W) + Math.sin(t * 1.4 + i) * 8;
        bubble(ctx, x, y, 1.5 + (i % 4), 0.55);
      }
    }
  }
  function bubble(ctx, x, y, r, a) {
    ctx.save();
    ctx.globalAlpha *= a;
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU);
    ctx.fillStyle = 'rgba(200,250,255,.18)'; ctx.fill();
    ctx.strokeStyle = 'rgba(230,255,255,.85)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.9)';
    ctx.beginPath(); ctx.arc(x - r * 0.35, y - r * 0.35, r * 0.28, 0, TAU); ctx.fill();
    ctx.restore();
  }
  /** Flickering fire (kind 0 torch, 1 brazier). */
  function flame(ctx, x, y, s, t, kind) {
    const H = Hh();
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = H.radial(ctx, x, y - s, 0, s * 4, [[0, 'rgba(255,170,60,.42)'], [1, 'rgba(255,120,30,0)']]);
    ctx.fillRect(x - s * 4, y - s * 5, s * 8, s * 8);
    ctx.restore();
    const w = kind ? 1.25 : 1;
    for (let i = 0; i < 3; i++) {
      const f = Math.sin(t * (9 + i * 3) + x) * 0.18, hgt = s * (2.1 - i * 0.5) * (1 + f) * w, wd = s * (0.75 - i * 0.18) * w;
      const col = ['#ff5a1a', '#ffa22a', '#fff2a0'][i];
      ctx.beginPath();
      ctx.moveTo(x - wd, y);
      ctx.quadraticCurveTo(x - wd * 0.9, y - hgt * 0.5, x + Math.sin(t * 6 + i) * wd * 0.5, y - hgt);
      ctx.quadraticCurveTo(x + wd * 0.9, y - hgt * 0.5, x + wd, y);
      ctx.closePath();
      ctx.fillStyle = col; ctx.fill();
    }
  }
  function electricArc(ctx, x0, y0, x1, y1, seed) {
    const r = Hh().rng(seed * 31 + 7);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const [w, c] of [[5, 'rgba(120,180,255,.35)'], [1.6, 'rgba(230,245,255,.95)']]) {
      ctx.strokeStyle = c; ctx.lineWidth = w;
      ctx.beginPath(); ctx.moveTo(x0, y0);
      for (let i = 1; i < 8; i++) ctx.lineTo(lerp(x0, x1, i / 8) + (r() - 0.5) * 6, lerp(y0, y1, i / 8) + (r() - 0.5) * 14);
      ctx.lineTo(x1, y1); ctx.stroke();
    }
    ctx.restore();
  }

  // ================================================================ fight: fighters & layout
  const STOP = { stop: true };   // rejection value of tweens when a fight is aborted / closed

  function freshVis() {
    return {
      reach: 0, ox: 0, oy: 0, hop: 0, sm: 1, alpha: 1, pose: 'idle', k: 0, flash: 0, tilt: 0, sx: 1, sy: 1,
      power: 0, move: null, aura: 0, shield: 0, visible: false,
      trail: false, trailT: 0, trailCol: null, trailAdd: false, ghosts: [], dust: false, dustT: 0,
    };
  }
  function mkFighter(side, d, i) {
    const sp = PC.SPECIES[d.species];
    const level = clamp(d.level | 0 || 1, 1, PC.MAX_LEVEL || 40);
    const st = PC.statsAt(d.species, level);
    const meta = PC.ART.templateMeta(d.species) || { bounds: [-80, -90, 90, 4], shadowW: 70 };
    return {
      side, i, species: d.species, sp, level, stage: PC.stageForLevel(level), name: d.name || sp.name, cls: sp.cls,
      maxHp: st.hp, hp: st.hp, atkMin: st.atkMin, atkMax: st.atkMax, moves: movesFor(d.species), gauge: 0, ko: false,
      face: side === 'p' ? 1 : -1, tOff: Math.random() * 10, b: meta.bounds, shadowW: meta.shadowW || 70,
      home: { x: 0, y: 0 }, scale: 1, v: freshVis(),
    };
  }
  const active = (F, side) => (side === 'p' ? F.P[F.pi] : F.E[F.ei]);
  const foeOf = (F, f) => (f.side === 'p' ? F.E[F.ei] : F.P[F.pi]);
  const unitS = (f, scale) => scale * PC.STAGE_GROWTH[f.stage] * f.sp.size;
  const aliveIdx = team => team.map((f, i) => (f.ko ? -1 : i)).filter(i => i >= 0);

  /** Battle camera (§11.6): the player stands large in the foreground lower-left, the enemy smaller further back. */
  function fightLayout(W, H) {
    const portrait = H > W * 1.1;
    const floorTop = Math.round(portrait ? H * 0.4 : H * 0.46);
    const yFront = Math.round(portrait ? H - 168 : H * 0.87);
    const yBack = Math.round(floorTop + (yFront - floorTop) * (portrait ? 0.27 : 0.24));
    return { W, H, portrait, floorTop, yFront, yBack, px: W * (portrait ? 0.36 : 0.31), ex: W * (portrait ? 0.68 : 0.66) };
  }
  const persp = (L, y) => 0.5 + 0.5 * (y - L.floorTop) / Math.max(1, L.yFront - L.floorTop);
  function fitScale(f, maxW, maxH) {
    const b = f.b, g = PC.STAGE_GROWTH[f.stage] * f.sp.size;
    const bw = (b[2] - b[0]) * g, bh = (b[3] - b[1]) * g;
    // babies stay visibly smaller than Alphas, but every creature reads well
    return Math.min(maxW / bw, maxH / bh) * (0.74 + 0.26 * f.stage / 3);
  }
  function layoutFighters(F) {
    const L = F.L, pt = L.portrait;
    const boxP = [L.W * (pt ? 0.76 : 0.36), L.H * (pt ? 0.32 : 0.44)];
    const boxE = [L.W * (pt ? 0.4 : 0.24), L.H * (pt ? 0.2 : 0.26)];
    for (const f of F.P) { f.home = { x: L.px, y: L.yFront }; f.scale = fitScale(f, boxP[0], boxP[1]); }
    for (const f of F.E) { f.home = { x: L.ex, y: L.yBack }; f.scale = fitScale(f, boxE[0], boxE[1]); }
  }
  /** Where an attacker's feet go when it reaches its opponent (reach = 1), and its depth scale there. */
  function contactOf(F, f) {
    const D = foeOf(F, f), L = F.L;
    if (!D) return { x: f.home.x, y: f.home.y, r: 1 };
    const cy = D.home.y + 6;
    const r = persp(L, cy) / persp(L, f.home.y);
    const u = unitS(f, f.scale * r), du = unitS(D, D.scale);
    const dcx = D.home.x + (D.b[0] + D.b[2]) / 2 * du * D.face;
    return { x: dcx - f.face * f.b[2] * u * 0.8, y: cy, r };
  }
  /** Current ground point and scale of a fighter. */
  function fPos(F, f) {
    const v = f.v, c = contactOf(F, f), r = v.reach;
    return { x: lerp(f.home.x, c.x, r) + v.ox, y: lerp(f.home.y, c.y, r) + v.oy, s: f.scale * lerp(1, c.r, clamp(r, -0.3, 1.2)) * v.sm };
  }
  /** Body centre and size on screen (world coords). */
  function bodyPt(F, f) {
    const p = fPos(F, f), u = unitS(f, p.s), b = f.b;
    const w = (b[2] - b[0]) * u, h = (b[3] - b[1]) * u;
    return { x: p.x + (b[0] + b[2]) / 2 * u * f.face, y: p.y - f.v.hop + (b[1] + b[3]) / 2 * u, w, h, u };
  }
  function headPt(F, f) {
    const p = fPos(F, f), u = unitS(f, p.s), b = f.b;
    const c = (b[0] + b[2]) / 2;   // flips pivot on the body centre
    return { x: p.x + (c + (b[2] * 0.82 - c) * Math.sign(f.v.sx || 1)) * u * f.face, y: p.y - f.v.hop + b[1] * 0.6 * u };
  }

  // ================================================================ fight: timeline (tweens on the fight clock)
  function tween(F, dur, fn, ease) {
    return new Promise((res, rej) => {
      if (F.dead || F.aborted) { rej(STOP); return; }
      const tw = { t: 0, dur: Math.max(0.001, dur), fn, ease: ease || Ease.io, res, rej };
      F.tweens.push(tw);
    });
  }
  const wait = (F, d) => tween(F, d, () => {}, Ease.lin);
  /** Tween numeric props of obj to the given values. */
  function to(F, obj, props, dur, ease) {
    let from = null;
    return tween(F, dur, e => {
      if (!from) { from = {}; for (const k in props) from[k] = obj[k]; }
      for (const k in props) obj[k] = from[k] + (props[k] - from[k]) * e;
    }, ease);
  }
  /** Fire-and-forget tween (errors / aborts swallowed). */
  const bg = p => { p.catch(() => {}); return p; };
  function killTweens(F) {
    const l = F.tweens;
    F.tweens = [];
    for (const tw of l) tw.rej(STOP);
    if (F.chooseRej) { const r = F.chooseRej; F.chooseRej = null; F.choose = null; r(STOP); }
  }

  // ================================================================ fight: effects (particles, rings, slashes, texts…)
  function addPart(F, o) {
    if (F.parts.length > 520) return;
    F.parts.push(Object.assign({ x: 0, y: 0, vx: 0, vy: 0, g: 0, drag: 0, life: 0, max: 1, r: 3, grow: 0, col: '#fff', kind: 'dot', rot: 0, vr: 0, layer: 1, a: 1, floor: null }, o));
  }
  function addRing(F, o) { F.rings.push(Object.assign({ x: 0, y: 0, r0: 4, r1: 80, life: 0, max: 0.5, col: '#fff', w: 6, sq: 1, layer: 1, fill: false }, o)); }
  function addText(F, x, y, txt, o) { F.texts.push(Object.assign({ x, y, txt, life: 0, max: 1.15, size: 1, col: '#fff', stroke: '#1a0f08', rise: 46, screen: false, jitter: 0 }, o)); }
  function addSlash(F, o) { F.slashes.push(Object.assign({ x: 0, y: 0, ang: 0.8, len: 100, life: 0, max: 0.5, col: '#ff5a3a', w: 10, curve: 0.18 }, o)); }
  const shake = (F, a) => { F.cam.shake = Math.max(F.cam.shake, a); };
  const flash = (F, col, a) => { F.fxs.flash = Math.max(F.fxs.flash, a == null ? 1 : a); F.fxs.flashCol = col || '#fff'; };

  function sparks(F, x, y, n, col, spd, o) {
    o = o || {};
    for (let i = 0; i < n; i++) {
      const a = o.cone != null ? o.cone + rand(-0.9, 0.9) : rand(0, TAU), v = rand(0.35, 1) * (spd || 420);
      addPart(F, { x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - (o.up || 0), g: o.g == null ? 520 : o.g, drag: 2.2, max: rand(0.25, 0.6), kind: 'spark', col, r: rand(1.4, 3), layer: 1 });
    }
  }
  /** Biome puff at a ground point: dust (land), bubbles (sea), snow (ice). */
  function puff(F, x, y, n, spread, power) {
    const park = F.park, pw = power || 1;
    for (let i = 0; i < n; i++) {
      if (park === 'sea') {
        addPart(F, { x: x + rand(-spread, spread), y: y - rand(0, 30), vx: rand(-40, 40), vy: -rand(50, 170) * pw, g: -60, drag: 1.2, max: rand(0.8, 1.7), r: rand(2, 6.5), kind: 'bubble', layer: 1 });
      } else {
        const ice = park === 'ice';
        addPart(F, { x: x + rand(-spread, spread), y: y - rand(0, 8), vx: rand(-70, 70) * pw, vy: -rand(8, 55) * pw, drag: 2.6, max: rand(0.6, 1.15), r: rand(5, 11) * (0.6 + spread / 70), grow: rand(14, 34) * pw, kind: 'smoke', col: ice ? '236,246,255' : '196,166,120', layer: i % 3 ? 1 : 0, a: ice ? 0.75 : 0.6 });
        if (ice && i % 2 === 0) addPart(F, { x: x + rand(-spread, spread), y: y - 4, vx: rand(-90, 90), vy: -rand(80, 220) * pw, g: 700, max: rand(0.5, 0.9), r: rand(1.5, 3), kind: 'dot', col: '#ffffff', layer: 1, floor: y + rand(0, 12) });
        if (!ice && i % 3 === 0) addPart(F, { x: x + rand(-spread, spread), y: y - 4, vx: rand(-110, 110), vy: -rand(90, 240) * pw, g: 900, max: rand(0.5, 0.9), r: rand(1.5, 3.2), kind: 'rock', col: '#8a6e4c', vr: rand(-9, 9), layer: 1, floor: y + rand(0, 10), pts: rockPts() });
      }
    }
  }
  function rockPts() {
    const n = randInt(5, 7), pts = [];
    for (let i = 0; i < n; i++) { const a = i / n * TAU, r = rand(0.65, 1.15); pts.push([Math.cos(a) * r, Math.sin(a) * r]); }
    return pts;
  }
  function rocks(F, x, y, n, spread, col, floorY, power) {
    for (let i = 0; i < n; i++) {
      addPart(F, { x: x + rand(-spread, spread), y: y - rand(0, 10), vx: rand(-160, 160), vy: -rand(320, 720) * (power || 1), g: 1500, max: rand(0.9, 1.4), r: rand(3.5, 9), kind: 'rock', col: col || '#7a6a58', vr: rand(-10, 10), layer: 1, floor: floorY + rand(-4, 14), pts: rockPts() });
    }
  }
  function shards(F, x, y, n, spd, col) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU), v = rand(0.3, 1) * spd;
      addPart(F, { x: x + rand(-10, 10), y: y + rand(-10, 10), vx: Math.cos(a) * v, vy: Math.sin(a) * v - 80, g: 520, drag: 1.2, max: rand(0.6, 1.1), r: rand(5, 13), kind: 'shard', col: col || '#9fdcff', rot: rand(0, TAU), vr: rand(-12, 12), layer: 1 });
    }
  }
  /** Ground cracks radiating from a point (optionally glowing). */
  function addCracks(F, x, y, len, glow) {
    const branches = [], n = 6 + randInt(0, 3);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + rand(-0.3, 0.3), Lb = len * rand(0.45, 1), pts = [[0, 0]];
      let px = 0, py = 0;
      for (let s = 1; s <= 6; s++) {
        const aa = a + rand(-0.55, 0.55);
        px += Math.cos(aa) * Lb / 6; py += Math.sin(aa) * Lb / 6 * 0.3;
        pts.push([px, py]);
      }
      branches.push(pts);
    }
    F.cracks.push({ x, y, branches, life: 0, max: glow ? 2 : 1.5, glow: glow || null });
  }
  function impactFx(F, x, y, power, col) {
    const p = power || 1;
    addRing(F, { x, y, r0: 6, r1: 70 * p, max: 0.18 + 0.05 * p, fill: true, col: '#fff' });
    addRing(F, { x, y, r0: 10, r1: 90 * p, max: 0.35, col: col || '#fff6c8', w: 5 * p });
    F.rays.push({ x, y, n: 10 + Math.round(p * 4), r0: 18 * p, r1: 95 * p, life: 0, max: 0.22, col: col || '#fff3b0', rot: rand(0, 1) });
    sparks(F, x, y, Math.round(10 + 10 * p), col || '#ffe28a', 380 + 120 * p);
  }

  // ================================================================ fight: per-frame update
  function update(F, dt, rdt) {
    F.time += dt;
    F.rt += rdt;
    if (F.tweens.length) {
      for (const tw of F.tweens.slice()) {
        if (F.tweens.indexOf(tw) < 0) continue;
        tw.t += dt;
        const k = Math.min(1, tw.t / tw.dur);
        try { tw.fn(tw.ease(k), k); } catch (e) { console.error('battle tween', e); }
        if (k >= 1) { F.tweens.splice(F.tweens.indexOf(tw), 1); tw.res(); }
      }
    }
    for (const f of F.P.concat(F.E)) {
      const v = f.v;
      if (!v.visible) { v.ghosts.length = 0; continue; }
      if (v.trail) {
        v.trailT -= dt;
        if (v.trailT <= 0) {
          v.trailT = 0.03;
          const p = fPos(F, f);
          v.ghosts.push({ x: p.x, y: p.y - v.hop, s: p.s, pose: v.pose, k: v.k, sx: v.sx, sy: v.sy, tilt: v.tilt, a: v.trailAdd ? 0.5 : 0.42, col: v.trailCol, add: v.trailAdd, move: v.move, power: v.power });
          if (v.ghosts.length > 7) v.ghosts.shift();
        }
      }
      if (v.ghosts.length) { for (const g of v.ghosts) g.a -= dt * 2.1; v.ghosts = v.ghosts.filter(g => g.a > 0); }
      if (v.dust) {
        v.dustT -= dt;
        if (v.dustT <= 0) { v.dustT = 0.07; const p = fPos(F, f); puff(F, p.x - f.face * 10, p.y, 2, 16 * p.s / Math.max(0.3, f.scale), 0.7); }
      }
      if (v.aura > 0.3 && Math.random() < dt * 40) {
        const bp = bodyPt(F, f), col = SPECIALS[f.cls].glow;
        addPart(F, { x: bp.x + rand(-0.5, 0.5) * bp.w, y: bp.y + rand(-0.1, 0.5) * bp.h, vx: rand(-20, 20), vy: -rand(80, 200), g: -40, max: rand(0.5, 1), r: rand(3, 7), kind: 'flame', col, layer: 1 });
      }
    }
    // particles
    if (F.parts.length) {
      for (const p of F.parts) {
        p.life += dt;
        if (p.drag) { const d = Math.max(0, 1 - p.drag * dt); p.vx *= d; p.vy *= d; }
        p.vy += p.g * dt;
        p.x += p.vx * dt; p.y += p.vy * dt;
        p.rot += p.vr * dt;
        if (p.floor != null && p.y > p.floor && p.vy > 0) { p.y = p.floor; p.vy *= -0.32; p.vx *= 0.55; p.vr *= 0.5; if (Math.abs(p.vy) < 40) { p.vy = 0; p.g = 0; p.vx *= 0.8; } }
        if (p.kind === 'bubble') p.x += Math.sin(p.life * 7 + p.r) * 0.4;
      }
      F.parts = F.parts.filter(p => p.life < p.max);
    }
    for (const key of ['rings', 'texts', 'slashes', 'cracks', 'rays', 'jaws', 'arcs']) {
      const list = F[key];
      if (!list.length) continue;
      for (const o of list) o.life += o.real ? rdt : dt;
      F[key] = list.filter(o => o.life < o.max);
    }
    const X = F.fxs;
    if (X.flash > 0) X.flash = Math.max(0, X.flash - rdt * 3.2);
    if (F.banner) { F.banner.life += rdt; if (F.banner.life > F.banner.max) F.banner = null; }
    if (F.vs) F.vs.life += rdt;
    if (F.trophy) F.trophy.life += rdt;
    F.cam.shake *= Math.exp(-rdt * 7.5);
    if (F.cam.shake < 0.15) F.cam.shake = 0;
  }

  // ================================================================ fight: rendering
  const HAZE = { land: [255, 236, 200, 0.16], sea: [30, 120, 170, 0.26], ice: [215, 232, 255, 0.2] };

  function render(F) {
    const ctx = F.ctx, L = F.L, W = L.W, HH = L.H, t = F.time, cam = F.cam, X = F.fxs;
    ctx.setTransform(F.dpr, 0, 0, F.dpr, 0, 0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    const sh = cam.shake, st = F.rt;
    const shx = sh * (Math.sin(st * 57) * 0.6 + Math.sin(st * 23.3) * 0.4), shy = sh * (Math.sin(st * 49.7 + 1) * 0.6 + Math.sin(st * 31.1) * 0.4);
    ctx.save();
    ctx.translate(W / 2 + shx, HH / 2 + shy);
    if (cam.rot) ctx.rotate(cam.rot);
    ctx.scale(cam.z, cam.z);
    ctx.translate(-cam.x, -cam.y);
    const m = F.bgM;
    if (F.bg) ctx.drawImage(F.bg, -m, -m, W + 2 * m, HH + 2 * m);
    try { drawArenaBack(ctx, F.park, L, F.anim, t); } catch (e) { if (!F.errA) { F.errA = 1; console.error('arena anim', e); } }
    drawCracks(ctx, F);
    drawRings(ctx, F, 0);
    drawParts(ctx, F, 0);
    if (X.dim > 0.005) { ctx.fillStyle = `rgba(4,6,12,${X.dim})`; ctx.fillRect(-m - W, -m - HH, W * 3 + 2 * m, HH * 3 + 2 * m); }
    // fighters, back to front, with a depth haze between the back and front planes
    const list = F.P.concat(F.E).filter(f => f.v.visible).map(f => ({ f, y: fPos(F, f).y })).sort((a, b) => a.y - b.y);
    const mid = (L.yBack + L.yFront) / 2;
    let hazed = false;
    for (const it of list) {
      if (!hazed && it.y > mid) { drawHaze(ctx, F); hazed = true; }
      drawFighter(ctx, F, it.f);
    }
    if (!hazed) drawHaze(ctx, F);
    drawJaws(ctx, F);
    drawSlashes(ctx, F);
    drawArcs(ctx, F);
    drawRings(ctx, F, 1);
    drawRays(ctx, F);
    drawParts(ctx, F, 1);
    try { drawArenaFront(ctx, F.park, L, t); } catch (e) { /* ambient only */ }
    drawTexts(ctx, F, false);
    ctx.restore();
    // ---------- screen space
    if (X.speed > 0.01) drawSpeedLines(ctx, F);
    if (X.tint > 0.01) {
      const H = Hh(), r = Math.hypot(W, HH) * 0.62;
      ctx.fillStyle = H.radial(ctx, W / 2, HH / 2, r * 0.35, r, [[0, H.rgba(X.tintCol, 0)], [1, H.rgba(X.tintCol, 0.75 * X.tint)]]);
      ctx.fillRect(0, 0, W, HH);
    }
    if (X.bars > 0.01) {
      const bh = Math.round(HH * 0.085 * X.bars);
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, bh); ctx.fillRect(0, HH - bh, W, bh);
      ctx.fillStyle = 'rgba(245,197,24,.9)';
      ctx.fillRect(0, bh - 2, W, 2); ctx.fillRect(0, HH - bh, W, 2);
    }
    drawParts(ctx, F, 2);
    if (F.trophy) drawTrophy(ctx, F);
    if (F.banner) drawBanner(ctx, F);
    drawTexts(ctx, F, true);
    if (F.vs) drawVS(ctx, F);
    if (X.flash > 0.01) { ctx.globalAlpha = Math.min(1, X.flash) * 0.85; ctx.fillStyle = X.flashCol; ctx.fillRect(0, 0, W, HH); ctx.globalAlpha = 1; }
  }

  function drawHaze(ctx, F) {
    const L = F.L, hz = HAZE[F.park] || HAZE.land, m = F.bgM;
    const y1 = L.yBack + (L.yFront - L.yBack) * 0.55;
    const g = ctx.createLinearGradient(0, -m, 0, y1);
    g.addColorStop(0, `rgba(${hz[0]},${hz[1]},${hz[2]},${hz[3]})`);
    g.addColorStop(1, `rgba(${hz[0]},${hz[1]},${hz[2]},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(-m - L.W, -m, L.W * 3 + 2 * m, y1 + m);
  }

  function drawFighter(ctx, F, f) {
    const v = f.v;
    if (v.alpha <= 0.01) return;
    const p = fPos(F, f), t = F.time + f.tOff, u = unitS(f, p.s), b = f.b, H = Hh();
    const sea = f.sp.park === 'sea';
    // ground shadow (stays on the floor when the creature hops)
    const sw = f.shadowW * 0.5 * u * Math.abs(v.sx) * (1 - Math.min(0.45, v.hop / 260));
    if (sw > 1) {
      ctx.save();
      ctx.globalAlpha = v.alpha * (sea ? 0.32 : 0.48);
      const scx = p.x + (b[0] + b[2]) / 2 * u * f.face * 0.25;
      H.ellipse(ctx, scx, p.y, sw, sw * 0.2);
      ctx.fillStyle = H.radial(ctx, scx, p.y, 0, sw, [[0, 'rgba(0,0,0,.7)'], [0.6, 'rgba(0,0,0,.35)'], [1, 'rgba(0,0,0,0)']]);
      ctx.fill();
      ctx.restore();
    }
    const pcx = (b[0] + b[2]) / 2 * u * f.face;   // flips/squashes pivot on the body centre
    const xform = (x, y, tilt, sx, sy) => {
      ctx.translate(x, y);
      if (tilt) ctx.rotate(tilt * f.face);
      if (sx !== 1 || sy !== 1) { ctx.translate(pcx, 0); ctx.scale(sx, sy); ctx.translate(-pcx, 0); }
    };
    // after-images
    for (const g of v.ghosts) {
      ctx.save();
      if (g.add) ctx.globalCompositeOperation = 'lighter';
      xform(g.x, g.y, g.tilt, g.sx, g.sy);
      PC.ART.drawCreature(ctx, f.species, { x: 0, y: 0, scale: g.s, facing: f.face, t, pose: g.pose, k: g.k, stage: f.stage, alpha: g.a * v.alpha, shadow: false, silhouette: g.col || 'rgba(255,255,255,.85)', move: g.move || undefined, power: g.power });
      ctx.restore();
    }
    if (v.aura > 0.01) drawAuraFx(ctx, F, f, false);
    ctx.save();
    xform(p.x, p.y - v.hop, v.tilt, v.sx, v.sy);
    PC.ART.drawCreature(ctx, f.species, {
      x: 0, y: 0, scale: p.s, facing: f.face, t, pose: v.pose, k: v.k, stage: f.stage, alpha: v.alpha,
      flash: v.flash, shadow: false, move: v.move || undefined, power: v.power,
    });
    ctx.restore();
    if (v.aura > 0.01) drawAuraFx(ctx, F, f, true);
    if (v.shield > 0.01) drawShield(ctx, F, f);
  }

  function drawAuraFx(ctx, F, f, front) {
    const v = f.v, S = SPECIALS[f.cls], H = Hh(), bp = bodyPt(F, f);
    const R = Math.max(bp.w, bp.h) * 0.72, cx = bp.x, cy = bp.y;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    if (!front) {
      const pulse = 0.6 + 0.25 * Math.sin(F.rt * 15);
      ctx.globalAlpha = v.aura * pulse;
      ctx.fillStyle = H.radial(ctx, cx, cy, R * 0.05, R, [[0, H.rgba(S.glow, 0.9)], [0.4, H.rgba(S.color, 0.6)], [1, H.rgba(S.color, 0)]]);
      ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
      // flame tongues licking up around the body
      for (let i = 0; i < 16; i++) {
        const a = i / 16 * TAU, ph = (F.rt * 1.7 + i * 0.37) % 1;
        const x = cx + Math.cos(a) * bp.w * 0.48, y = cy + Math.sin(a) * bp.h * 0.42 - ph * R * 0.3;
        const l = R * (0.13 + 0.07 * Math.sin(i * 3 + F.rt * 9)) * (1 - ph * 0.5), w = l * 0.24;
        ctx.globalAlpha = v.aura * (1 - ph) * 0.75;
        ctx.beginPath();
        ctx.moveTo(x - w, y);
        ctx.quadraticCurveTo(x - w * 0.7, y - l * 0.55, x + Math.sin(F.rt * 8 + i) * w * 0.8, y - l);
        ctx.quadraticCurveTo(x + w * 0.7, y - l * 0.55, x + w, y);
        ctx.closePath();
        ctx.fillStyle = H.linear(ctx, 0, y, 0, y - l, [[0, H.rgba(S.glow, 0.95)], [0.5, H.rgba(S.color, 0.7)], [1, H.rgba(S.color, 0)]]);
        ctx.fill();
      }
    } else {
      for (let i = 0; i < 10; i++) {
        const a = F.rt * 3.2 + i / 10 * TAU;
        const x = cx + Math.cos(a) * bp.w * 0.62, y = cy + Math.sin(a) * bp.h * 0.22, behind = Math.sin(a) < 0;
        if (behind) continue;
        ctx.globalAlpha = v.aura * 0.9;
        twinkle(ctx, x, y, 4 + 3 * Math.sin(F.rt * 9 + i), S.glow);
      }
    }
    ctx.restore();
  }
  function twinkle(ctx, x, y, r, col) {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(x, y - r * 2); ctx.lineTo(x + r * 0.35, y - r * 0.35); ctx.lineTo(x + r * 2, y); ctx.lineTo(x + r * 0.35, y + r * 0.35);
    ctx.lineTo(x, y + r * 2); ctx.lineTo(x - r * 0.35, y + r * 0.35); ctx.lineTo(x - r * 2, y); ctx.lineTo(x - r * 0.35, y - r * 0.35);
    ctx.closePath(); ctx.fill();
  }
  /** Blindé super attack: glowing hexagonal shield bubble. */
  function drawShield(ctx, F, f) {
    const v = f.v, H = Hh(), bp = bodyPt(F, f);
    const rx = bp.w * 0.62, ry = bp.h * 0.7, cx = bp.x + f.face * bp.w * 0.06, cy = bp.y;
    ctx.save();
    ctx.globalAlpha = v.shield;
    H.ellipse(ctx, cx, cy, rx, ry);
    ctx.fillStyle = H.radial(ctx, cx + f.face * rx * 0.4, cy, rx * 0.1, rx * 1.1, [[0, 'rgba(160,220,255,.05)'], [0.75, 'rgba(70,160,255,.22)'], [1, 'rgba(160,230,255,.5)']]);
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = 'rgba(150,215,255,.45)';
    ctx.lineWidth = 1.5;
    const s = Math.max(10, rx * 0.2), hh = s * Math.sqrt(3) / 2;
    for (let gy = cy - ry; gy < cy + ry + hh; gy += hh * 2) {
      for (let gx = cx - rx, j = 0; gx < cx + rx + s; gx += s * 1.5, j++) {
        const yy = gy + (j % 2 ? hh : 0);
        ctx.beginPath();
        for (let q = 0; q < 6; q++) { const a = q * PI / 3; const px = gx + Math.cos(a) * s * 0.92, py = yy + Math.sin(a) * s * 0.92; if (q) ctx.lineTo(px, py); else ctx.moveTo(px, py); }
        ctx.closePath(); ctx.stroke();
      }
    }
    ctx.restore();
    ctx.globalCompositeOperation = 'lighter';
    H.ellipse(ctx, cx, cy, rx, ry);
    ctx.strokeStyle = 'rgba(120,200,255,.55)'; ctx.lineWidth = 9; ctx.stroke();
    ctx.strokeStyle = 'rgba(230,248,255,.95)'; ctx.lineWidth = 2.5; ctx.stroke();
    ctx.restore();
  }

  function drawParts(ctx, F, layer) {
    const H = Hh();
    for (const p of F.parts) {
      if (p.layer !== layer) continue;
      const k = p.life / p.max, fade = k < 0.65 ? 1 : 1 - (k - 0.65) / 0.35;
      ctx.globalAlpha = Math.max(0, p.a * fade);
      switch (p.kind) {
        case 'smoke': {
          const r = p.r + p.grow * k;
          ctx.fillStyle = H.radial(ctx, p.x, p.y, 0, r, [[0, `rgba(${p.col},0.85)`], [0.6, `rgba(${p.col},0.4)`], [1, `rgba(${p.col},0)`]]);
          ctx.fillRect(p.x - r, p.y - r, r * 2, r * 2);
          break;
        }
        case 'spark': {
          ctx.globalCompositeOperation = 'lighter';
          ctx.strokeStyle = p.col; ctx.lineWidth = p.r; ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.045, p.y - p.vy * 0.045); ctx.stroke();
          ctx.globalCompositeOperation = 'source-over';
          break;
        }
        case 'flame': {
          ctx.globalCompositeOperation = 'lighter';
          const r = p.r * (1 - k * 0.6);
          ctx.fillStyle = H.radial(ctx, p.x, p.y, 0, r * 2, [[0, H.rgba(p.col, 0.9)], [1, H.rgba(p.col, 0)]]);
          ctx.fillRect(p.x - r * 2, p.y - r * 2, r * 4, r * 4);
          ctx.globalCompositeOperation = 'source-over';
          break;
        }
        case 'rock': {
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.scale(p.r, p.r);
          H.poly(ctx, p.pts, true);
          ctx.fillStyle = p.col; ctx.fill();
          ctx.strokeStyle = 'rgba(30,20,10,.8)'; ctx.lineWidth = 1.6 / p.r; ctx.stroke();
          ctx.fillStyle = 'rgba(255,255,255,.25)'; ctx.fillRect(-0.5, -0.7, 0.6, 0.35);
          ctx.restore();
          break;
        }
        case 'shard': {
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
          ctx.globalCompositeOperation = 'lighter';
          ctx.beginPath(); ctx.moveTo(0, -p.r); ctx.lineTo(p.r * 0.45, p.r * 0.6); ctx.lineTo(-p.r * 0.5, p.r * 0.3); ctx.closePath();
          ctx.fillStyle = p.col; ctx.fill();
          ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 1; ctx.stroke();
          ctx.restore();
          break;
        }
        case 'conf': {
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.scale(1, Math.cos(p.life * 9 + p.r));
          ctx.fillStyle = p.col; ctx.fillRect(-p.r, -p.r * 0.5, p.r * 2, p.r);
          ctx.restore();
          break;
        }
        case 'bubble': bubble(ctx, p.x, p.y, p.r, 1); break;
        case 'star': ctx.globalCompositeOperation = 'lighter'; twinkle(ctx, p.x, p.y, p.r, p.col); ctx.globalCompositeOperation = 'source-over'; break;
        default: H.ellipse(ctx, p.x, p.y, p.r, p.r); ctx.fillStyle = p.col; ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
  function drawRings(ctx, F, layer) {
    const H = Hh();
    for (const r of F.rings) {
      if (r.layer !== layer || r.life < 0) continue;
      const k = r.life / r.max, rad = lerp(r.r0, r.r1, Ease.out(k));
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      if (r.fill) {
        ctx.globalAlpha = 1 - k;
        ctx.fillStyle = H.radial(ctx, r.x, r.y, 0, rad, [[0, 'rgba(255,255,255,1)'], [0.4, H.rgba(r.col === '#fff' ? '#fff6d0' : r.col, 0.8)], [1, 'rgba(255,255,255,0)']]);
        ctx.fillRect(r.x - rad, r.y - rad, rad * 2, rad * 2);
      } else {
        ctx.globalAlpha = (1 - k) * (r.a == null ? 1 : r.a);
        H.ellipse(ctx, r.x, r.y, rad, rad * r.sq);
        ctx.strokeStyle = r.col; ctx.lineWidth = r.w * (1 - k * 0.7); ctx.stroke();
        if (r.w > 3) { ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.lineWidth = r.w * 0.3 * (1 - k); ctx.stroke(); }
      }
      ctx.restore();
    }
  }
  function drawRays(ctx, F) {
    for (const r of F.rays) {
      const k = r.life / r.max;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 1 - k;
      ctx.strokeStyle = r.col; ctx.lineCap = 'round';
      for (let i = 0; i < r.n; i++) {
        const a = r.rot + i / r.n * TAU + (i % 2) * 0.15, l0 = r.r0 + (r.r1 - r.r0) * k * 0.6, l1 = r.r0 + (r.r1 - r.r0) * Ease.out(k) * (i % 2 ? 0.7 : 1);
        ctx.lineWidth = (i % 2 ? 2.5 : 4.5) * (1 - k);
        ctx.beginPath(); ctx.moveTo(r.x + Math.cos(a) * l0, r.y + Math.sin(a) * l0); ctx.lineTo(r.x + Math.cos(a) * l1, r.y + Math.sin(a) * l1); ctx.stroke();
      }
      ctx.restore();
    }
  }
  function drawCracks(ctx, F) {
    for (const c of F.cracks) {
      const k = c.life / c.max, grow = clamp(c.life / 0.16, 0, 1), fade = k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4;
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      const pass = (col, w, add) => {
        ctx.globalCompositeOperation = add ? 'lighter' : 'source-over';
        ctx.strokeStyle = col; ctx.lineWidth = w;
        for (const br of c.branches) {
          const n = Math.max(1, Math.round((br.length - 1) * grow));
          ctx.beginPath(); ctx.moveTo(br[0][0], br[0][1]);
          for (let i = 1; i <= n; i++) ctx.lineTo(br[i][0], br[i][1]);
          ctx.stroke();
        }
      };
      ctx.globalAlpha = fade;
      if (c.glow) { pass(Hh().rgba(c.glow, 0.45), 12, true); }
      pass(F.park === 'ice' ? 'rgba(40,80,120,.85)' : F.park === 'sea' ? 'rgba(60,50,30,.7)' : 'rgba(45,28,14,.9)', 4.5, false);
      if (c.glow) pass('rgba(230,255,200,.95)', 1.8, true);
      else pass('rgba(255,240,210,.25)', 1.2, false);
      ctx.restore();
    }
  }
  function drawSlashes(ctx, F) {
    for (const s of F.slashes) {
      if (s.life < 0) continue;
      const k = s.life / s.max, grow = Ease.out(clamp(k / 0.2, 0, 1)), fade = k < 0.45 ? 1 : 1 - (k - 0.45) / 0.55;
      const dx = Math.cos(s.ang), dy = Math.sin(s.ang), nx = -dy, ny = dx, N = 16;
      const x0 = s.x - dx * s.len / 2, y0 = s.y - dy * s.len / 2;
      const L = [], R = [];
      for (let i = 0; i <= N; i++) {
        const u = (i / N) * grow, bend = Math.sin(u * PI) * s.len * s.curve, taper = Math.sin((i / N) * PI);
        const px = x0 + dx * s.len * u + nx * bend, py = y0 + dy * s.len * u + ny * bend, w = s.w * (0.15 + taper);
        L.push([px + nx * w, py + ny * w]); R.push([px - nx * w * 0.35, py - ny * w * 0.35]);
      }
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.globalCompositeOperation = 'lighter';
      const shape = () => { ctx.beginPath(); ctx.moveTo(L[0][0], L[0][1]); for (const p of L) ctx.lineTo(p[0], p[1]); for (let i = R.length - 1; i >= 0; i--) ctx.lineTo(R[i][0], R[i][1]); ctx.closePath(); };
      ctx.shadowColor = s.col; ctx.shadowBlur = 16;
      shape(); ctx.fillStyle = s.col; ctx.fill();
      ctx.shadowBlur = 0;
      ctx.lineWidth = Math.max(1.5, s.w * 0.28); ctx.strokeStyle = 'rgba(255,255,255,.95)';
      ctx.beginPath();
      for (let i = 0; i <= N; i++) { const p = L[i], q = R[i]; const mx = (p[0] * 0.4 + q[0] * 0.6), my = (p[1] * 0.4 + q[1] * 0.6); if (i) ctx.lineTo(mx, my); else ctx.moveTo(mx, my); }
      ctx.stroke();
      ctx.restore();
    }
  }
  /** Jaw-snap effect: two rows of teeth closing on the target. */
  function drawJaws(ctx, F) {
    for (const j of F.jaws) {
      const k = j.life / j.max, close = Ease.in2(clamp(k / 0.3, 0, 1)), fade = k < 0.55 ? 1 : 1 - (k - 0.55) / 0.45;
      const s = j.size, gap = s * 0.62 * (1 - close) + s * 0.06;
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.translate(j.x, j.y);
      ctx.scale(j.face, 1);
      for (const side of [-1, 1]) {
        const cy = side * gap;
        ctx.beginPath();
        const pts = [];
        for (let i = 0; i <= 12; i++) { const u = i / 12 * 2 - 1; pts.push([u * s, cy + side * (1 - u * u) * s * 0.28]); }
        // jaw band
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (const p of pts) ctx.lineTo(p[0], p[1]);
        for (let i = pts.length - 1; i >= 0; i--) ctx.lineTo(pts[i][0], pts[i][1] + side * s * 0.13);
        ctx.closePath();
        ctx.fillStyle = 'rgba(255,255,255,.92)'; ctx.fill();
        ctx.strokeStyle = 'rgba(40,10,0,.85)'; ctx.lineWidth = 2; ctx.stroke();
        // teeth pointing at the other jaw
        ctx.beginPath();
        for (let i = 1; i < 12; i += 2) {
          const a = pts[i - 1], b = pts[i + 1], c = pts[i];
          ctx.moveTo(a[0], a[1]); ctx.lineTo(c[0], c[1] - side * s * 0.22); ctx.lineTo(b[0], b[1]);
        }
        ctx.fillStyle = '#fffdf2'; ctx.fill(); ctx.stroke();
      }
      ctx.restore();
    }
  }
  /** Sweeping arc (tail whips, club swings). */
  function drawArcs(ctx, F) {
    for (const a of F.arcs) {
      const k = a.life / a.max, p = Ease.out(clamp(k / 0.45, 0, 1)), fade = k < 0.4 ? 1 : 1 - (k - 0.4) / 0.6;
      const e = a.a0 + (a.a1 - a.a0) * p, s = a.a0 + (a.a1 - a.a0) * Math.max(0, p - 0.55);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';
      for (let i = 0; i < 4; i++) {
        ctx.globalAlpha = fade * (0.25 + i * 0.2);
        ctx.strokeStyle = i === 3 ? '#ffffff' : a.col;
        ctx.lineWidth = a.w * (1 - i * 0.22);
        ctx.beginPath();
        ctx.ellipse(a.x, a.y, a.r * (1 - i * 0.04), a.r * 0.62 * (1 - i * 0.04), 0, Math.min(s, e), Math.max(s, e));
        ctx.stroke();
      }
      ctx.restore();
    }
  }
  function textSize(F, sz) { return clamp(Math.min(F.L.W, F.L.H) * 0.06, 20, 40) * sz; }
  function drawTexts(ctx, F, screen) {
    const H = Hh();
    for (const tx of F.texts) {
      if (!!tx.screen !== screen || tx.life < 0) continue;
      const k = tx.life / tx.max, pop = tx.life < 0.2 ? Ease.back(tx.life / 0.2) : 1;
      const a = k > 0.72 ? 1 - (k - 0.72) / 0.28 : 1;
      const y = tx.y - tx.rise * Ease.out(k);
      const size = textSize(F, tx.size);
      ctx.save();
      ctx.globalAlpha = Math.max(0, a);
      ctx.translate(tx.x + (tx.jitter ? rand(-1, 1) * tx.jitter * 4 : 0), y + (tx.jitter ? rand(-1, 1) * tx.jitter * 3 : 0));
      ctx.scale(Math.max(0.01, pop), Math.max(0.01, pop));
      if (tx.rot) ctx.rotate(tx.rot);
      ctx.font = `${Math.round(size)}px ${FD}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
      ctx.lineWidth = Math.max(4, size * 0.2);
      ctx.strokeStyle = tx.stroke;
      ctx.strokeText(tx.txt, 0, 0);
      ctx.fillStyle = H.linear(ctx, 0, -size * 0.5, 0, size * 0.5, [[0, '#ffffff'], [0.45, tx.col], [1, H.shade(tx.col, -0.3)]]);
      ctx.fillText(tx.txt, 0, 0);
      ctx.restore();
    }
  }
  function drawSpeedLines(ctx, F) {
    const W = F.L.W, HH = F.L.H, X = F.fxs, cx = W / 2, cy = HH / 2, R = Math.hypot(W, HH) * 0.6;
    const r = Hh().rng(Math.floor(F.rt * 20));
    ctx.save();
    ctx.globalAlpha = X.speed * 0.5;
    ctx.fillStyle = '#fff';
    for (let i = 0; i < 46; i++) {
      const a = r() * TAU, w = 0.006 + r() * 0.012, r0 = R * (0.55 + r() * 0.25);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * R * 1.1, cy + Math.sin(a) * R * 1.1);
      ctx.lineTo(cx + Math.cos(a + w) * R * 1.1, cy + Math.sin(a + w) * R * 1.1);
      ctx.lineTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }
  /** Slanted banner with the name of a super attack. */
  function drawBanner(ctx, F) {
    const B = F.banner, W = F.L.W, HH = F.L.H, k = B.life / B.max, H = Hh();
    const inK = Ease.out(clamp(k / 0.18, 0, 1)), outK = Ease.in(clamp((k - 0.82) / 0.18, 0, 1));
    const x = (1 - inK) * -W + outK * W, cy = HH * 0.22, bh = clamp(HH * 0.085, 44, 70);
    ctx.save();
    ctx.translate(x, 0);
    ctx.beginPath();
    ctx.moveTo(-20, cy - bh / 2); ctx.lineTo(W + 20, cy - bh / 2 - bh * 0.25); ctx.lineTo(W + 20, cy + bh / 2 - bh * 0.25); ctx.lineTo(-20, cy + bh / 2);
    ctx.closePath();
    ctx.fillStyle = H.linear(ctx, 0, cy - bh, 0, cy + bh, [[0, H.light(B.col)], [0.5, B.col], [1, H.dark(B.col)]]);
    ctx.fill();
    ctx.lineWidth = 4; ctx.strokeStyle = '#111'; ctx.stroke();
    ctx.save(); ctx.clip();
    ctx.fillStyle = 'rgba(0,0,0,.25)';
    for (let i = -2; i < W / 24 + 2; i++) { ctx.beginPath(); ctx.moveTo(i * 24, cy + bh); ctx.lineTo(i * 24 + 12, cy + bh); ctx.lineTo(i * 24 + 12 + bh * 2, cy - bh); ctx.lineTo(i * 24 + bh * 2, cy - bh); ctx.closePath(); ctx.fill(); }
    ctx.restore();
    const size = clamp(bh * 0.58, 22, 40);
    ctx.font = `${Math.round(size)}px ${FD}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    ctx.translate(W / 2, cy - bh * 0.12);
    ctx.rotate(-Math.atan2(bh * 0.25, W));
    ctx.lineWidth = 7; ctx.strokeStyle = '#140805'; ctx.strokeText(B.txt, 0, 0);
    ctx.fillStyle = '#fff'; ctx.fillText(B.txt, 0, 0);
    ctx.restore();
  }
  function drawTrophy(ctx, F) {
    const T = F.trophy, W = F.L.W, HH = F.L.H, H = Hh();
    const k = clamp(T.life / 0.6, 0, 1), s = Ease.back(k), size = clamp(Math.min(W, HH) * 0.22, 90, 170);
    const cx = W / 2, cy = HH * 0.36 + Math.sin(T.life * 3) * 6;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.55 * k;
    ctx.translate(cx, cy);
    ctx.rotate(T.life * 0.6);
    for (let i = 0; i < 14; i++) {
      ctx.rotate(TAU / 14);
      ctx.fillStyle = H.linear(ctx, 0, 0, size * 1.6, 0, [[0, 'rgba(255,230,120,.9)'], [1, 'rgba(255,200,60,0)']]);
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(size * 1.7, -size * 0.12); ctx.lineTo(size * 1.7, size * 0.12); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(s, s);
    if (PC.ICONS && PC.ICONS.draw) PC.ICONS.draw(ctx, 'trophy', 0, 0, size);
    ctx.restore();
  }
  /** VS splash before the fight. */
  function drawVS(ctx, F) {
    const V = F.vs, W = F.L.W, HH = F.L.H, H = Hh(), k = V.life / V.max;
    if (k >= 1) { F.vs = null; return; }
    const inK = Ease.out(clamp(k / 0.18, 0, 1)), outK = Ease.in(clamp((k - 0.84) / 0.16, 0, 1));
    const cy = HH * 0.44, bh = clamp(HH * 0.17, 80, 150), sk = bh * 0.35;
    ctx.save();
    ctx.fillStyle = `rgba(0,0,0,${0.55 * inK * (1 - outK)})`;
    ctx.fillRect(0, 0, W, HH);
    const fs = clamp(Math.min(W, HH) * 0.065, 20, 40);
    // player band (from the left)
    ctx.save();
    ctx.translate((-(1 - inK) - outK) * W, 0);
    ctx.beginPath(); ctx.moveTo(0, cy - bh); ctx.lineTo(W * 0.62 + sk, cy - bh); ctx.lineTo(W * 0.62 - sk, cy); ctx.lineTo(0, cy); ctx.closePath();
    ctx.fillStyle = H.linear(ctx, 0, cy - bh, 0, cy, [[0, '#3fb0e8'], [1, '#14507a']]); ctx.fill();
    ctx.lineWidth = 4; ctx.strokeStyle = '#0a1a28'; ctx.stroke();
    if (V.pImg) ctx.drawImage(V.pImg, W * 0.36 - bh * 0.9, cy - bh * 1.28, bh * 1.8, bh * 1.35);
    ctx.font = `${Math.round(fs)}px ${FD}`; ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.lineJoin = 'round';
    const tx = Math.max(16, W * 0.04);
    ctx.lineWidth = 6; ctx.strokeStyle = '#06121c'; ctx.strokeText('TOI', tx, cy - bh * 0.5); ctx.fillStyle = '#fff'; ctx.fillText('TOI', tx, cy - bh * 0.5);
    ctx.restore();
    // opponent band (from the right)
    ctx.save();
    ctx.translate(((1 - inK) + outK) * W, 0);
    ctx.beginPath(); ctx.moveTo(W * 0.38 + sk, cy); ctx.lineTo(W, cy); ctx.lineTo(W, cy + bh); ctx.lineTo(W * 0.38 - sk, cy + bh); ctx.closePath();
    ctx.fillStyle = H.linear(ctx, 0, cy, 0, cy + bh, [[0, '#e8503a'], [1, '#6a140c']]); ctx.fill();
    ctx.lineWidth = 4; ctx.strokeStyle = '#2a0805'; ctx.stroke();
    if (V.npc) ctx.drawImage(V.npc, W - bh * 0.8 - 10, cy + bh * 0.06, bh * 0.8 * (V.npc.width / V.npc.height) * 0.83, bh * 0.94);
    ctx.textAlign = 'right';
    ctx.font = `${Math.round(fs * 0.82)}px ${FD}`;
    const nx = W - bh * 0.75 - 22;
    ctx.lineWidth = 6; ctx.strokeStyle = '#1c0604'; ctx.strokeText(V.name, nx, cy + bh * 0.4); ctx.fillStyle = '#fff'; ctx.fillText(V.name, nx, cy + bh * 0.4);
    ctx.font = `600 ${Math.round(fs * 0.45)}px ${FU}`;
    ctx.lineWidth = 4; ctx.strokeText(V.sub, nx, cy + bh * 0.72); ctx.fillStyle = '#ffd96a'; ctx.fillText(V.sub, nx, cy + bh * 0.72);
    ctx.restore();
    // hazard edge + VS
    const vsK = Ease.back(clamp((k - 0.12) / 0.2, 0, 1)) * (1 - outK);
    if (vsK > 0.01) {
      ctx.save();
      ctx.translate(W / 2, cy);
      ctx.scale(vsK, vsK);
      ctx.rotate(-0.12);
      const vs = fs * 2.3;
      ctx.font = `${Math.round(vs)}px ${FD}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
      ctx.lineWidth = 12; ctx.strokeStyle = '#000'; ctx.strokeText('VS', 0, 0);
      ctx.fillStyle = H.linear(ctx, 0, -vs * 0.5, 0, vs * 0.5, [[0, '#fff8c0'], [0.45, '#ffc21c'], [0.55, '#d27a06'], [1, '#ffe46a']]);
      ctx.fillText('VS', 0, 0);
      ctx.restore();
    }
    ctx.restore();
  }

  // ================================================================ fight: hit resolution
  const SEA_MOVE = { bite: 'bite', claw: 'claw', charge: 'charge', tail: 'tail', stomp: 'tail', horn: 'charge', club: 'tail', head: 'charge' };
  /** o.move passed to the art templates (sea templates know bite / claw / charge / tail). */
  const artMove = (f, key) => (f.sp.park === 'sea' ? SEA_MOVE[key] || 'bite' : key);
  const dirOf = (A, D) => Math.sign(D.home.x - A.home.x) || A.face;
  function trail(f, on, col, add) {
    const v = f.v;
    v.trail = on; v.trailT = 0;
    if (on) { v.trailCol = col || 'rgba(255,255,255,.85)'; v.trailAdd = !!add; }
  }
  function dustTrail(f, on) { f.v.dust = on; f.v.dustT = 0; }
  function feetPt(F, f) { const p = fPos(F, f); return { x: p.x, y: p.y }; }
  function setIdle(f) { const v = f.v; v.pose = 'idle'; v.k = 0; v.move = null; }

  /** Defender reaction: white flash, knock-back away from the attacker, rear back (and toss when strong). */
  function hurtFx(F, D, power, dir) {
    const v = D.v, tok = (v.hurtTok = (v.hurtTok || 0) + 1);
    v.pose = 'hurt'; v.k = 0; v.flash = 1;
    const kb = (16 + 26 * power) * (D.side === 'e' ? 0.75 : 1), up = power > 1.35 ? (power - 1.15) * 30 : 0;
    bg(tween(F, 0.55 + power * 0.12, (e, k) => {
      if (v.hurtTok !== tok) return;
      v.k = k;
      v.flash = Math.max(0, 1 - k * 2.4) + (k < 0.3 && Math.floor(k * 22) % 2 ? 0.35 : 0);
      const push = Math.sin(Math.min(1, k * 2.4) * PI * 0.5) * (1 - Math.max(0, (k - 0.4) / 0.6));
      v.ox = dir * kb * push;
      v.oy = (D.side === 'e' ? -0.16 : 0.1) * kb * push;
      v.tilt = -0.14 * Math.min(1.6, power) * Math.sin(k * PI);
      v.hop = up * Math.sin(Math.min(1, k * 1.7) * PI);
    }, Ease.lin).then(() => {
      if (v.hurtTok !== tok) return;
      v.ox = 0; v.oy = 0; v.tilt = 0; v.hop = 0; v.flash = 0;
      if (!D.ko) { v.pose = 'idle'; v.k = 0; }
    }));
  }
  function dodge(F, D, dir) {
    const v = D.v, tok = (v.hurtTok = (v.hurtTok || 0) + 1);
    bg(tween(F, 0.42, (e, k) => {
      if (v.hurtTok !== tok) return;
      const s = Math.sin(k * PI);
      v.hop = s * 34; v.ox = dir * 30 * s; v.tilt = -0.1 * s;
    }, Ease.lin).then(() => { if (v.hurtTok === tok) { v.hop = 0; v.ox = 0; v.tilt = 0; } }));
  }

  /** Apply a resolved attack at its impact frame: HP, gauges, numbers, labels, hurt reaction, sounds. */
  function applyHit(F, A, D, res, o) {
    if (res.applied) return;
    res.applied = true;
    o = o || {};
    const bp = bodyPt(F, D), dir = dirOf(A, D);
    if (!res.hit) {
      addText(F, bp.x, bp.y - bp.h * 0.3, 'Raté !', { col: '#dfe8ee', stroke: '#1d2a33', size: 1.05 });
      dodge(F, D, dir);
      A.gauge = Math.min(GAUGE_MAX, A.gauge + GAUGE_MISS);
      hud(F);
      return;
    }
    D.hp = Math.max(0, D.hp - res.dmg);
    A.gauge = res.special ? 0 : Math.min(GAUGE_MAX, A.gauge + (res.move.gauge || 25));
    D.gauge = Math.min(GAUGE_MAX, D.gauge + GAUGE_HIT);
    const pw = (o.power || 1) * (res.crit ? 1.25 : 1);
    hurtFx(F, D, pw, dir);
    impactFx(F, bp.x - dir * bp.w * 0.12, bp.y, Math.min(2.4, pw), o.col);
    shake(F, (o.shake || 9) * (res.crit ? 1.4 : 1));
    if (res.crit || o.special) flash(F, '#ffffff', o.special ? 1 : 0.4);
    const fp = feetPt(F, D);
    puff(F, fp.x, fp.y, 6, bp.w * 0.3, 1);
    const big = o.special ? 2.2 : res.crit ? 1.55 : 1.15;
    const nLab = (res.crit ? 1 : 0) + (res.cm !== 1 ? 1 : 0);
    const minY = (F.L.H * 0.16 + 24 - F.L.H / 2) / F.cam.z + F.cam.y + textSize(F, 0.9) * nLab + textSize(F, big) * 0.6;
    const ny = Math.max(bp.y - bp.h * 0.2, minY);
    addText(F, bp.x, ny, '-' + fmt(res.dmg), {
      size: big, col: o.special ? SPECIALS[A.cls].glow : res.crit ? '#ffa21c' : '#fff3b0', stroke: o.special ? '#1a0505' : '#2a1204',
      rise: 70, max: o.special ? 1.7 : 1.35, rot: rand(-0.08, 0.08),
    });
    let ly = ny - textSize(F, big) * 1.05;
    if (res.crit) { addText(F, bp.x, ly, 'CRITIQUE !', { size: 0.95, col: '#ff7a1c', stroke: '#2a0a00', rise: 50, max: 1.4, jitter: 0.6 }); ly -= textSize(F, 0.95); }
    if (res.cm > 1) addText(F, bp.x, ly, 'Super efficace !', { size: 0.75, col: '#8cff5a', stroke: '#0c2a06', rise: 44, max: 1.5 });
    else if (res.cm < 1) addText(F, bp.x, ly, 'Peu efficace…', { size: 0.7, col: '#a8c4dc', stroke: '#14202a', rise: 40, max: 1.5 });
    sfx(res.crit ? 'crit' : 'hit', { power: pw });
    hud(F);
  }

  // ================================================================ fight: the 8 regular moves (§11.2)
  async function mvBite(F, A, D, res, hit) {
    const v = A.v;
    v.pose = 'attack'; v.k = 0; v.move = artMove(A, 'bite');
    await to(F, v, { k: 0.3, reach: -0.06, sx: 1.05, sy: 0.94 }, 0.3, Ease.out);           // wind-up
    trail(A, true);
    await to(F, v, { k: 0.5, reach: 0.92, sx: 0.97, sy: 1.04 }, 0.17, Ease.in2);           // lunge across
    sfx('bite');
    const tp = res.hit ? bodyPt(F, D) : headPt(F, A);
    F.jaws.push({ x: tp.x - (res.hit ? A.face * tp.w * 0.08 : 0), y: tp.y, size: clamp((tp.h || 90) * 0.42, 24, 90), face: A.face, life: 0, max: 0.5 });
    await wait(F, 0.08);                                                                     // jaws snap shut
    hit({ power: 1, shake: 9 });
    trail(A, false);
    await to(F, v, { k: 0.62, sx: 1, sy: 1 }, 0.12);
    await to(F, v, { k: 1, reach: 0 }, 0.4, Ease.io);
    setIdle(A);
  }
  async function mvClaw(F, A, D, res, hit) {
    const v = A.v, sea = A.sp.park === 'sea';
    v.pose = 'attack'; v.k = 0; v.move = artMove(A, 'claw');
    await to(F, v, { k: 0.28, reach: -0.04, hop: 8 }, 0.22, Ease.out);
    trail(A, true);
    await to(F, v, { k: 0.45, reach: 0.72, hop: 0 }, 0.16, Ease.in2);
    trail(A, false);
    if (!res.hit) hit();
    const col = sea ? '#7fe8ff' : '#ff6a3a';
    for (let i = 0; i < 3; i++) {                                                            // three swipes with claw trails
      const bp = bodyPt(F, D), len = clamp(bp.h * 1.1, 60, 220);
      sfx('claw');
      const ang = (i % 2 ? PI - 0.95 : 0.95) + rand(-0.15, 0.15);
      for (let j = -1; j <= 1; j++) {
        const off = j * len * 0.13;
        addSlash(F, { x: bp.x + Math.cos(ang + PI / 2) * off + rand(-6, 6), y: bp.y + Math.sin(ang + PI / 2) * off, ang, len: len * (1 - Math.abs(j) * 0.12), col, w: clamp(len * 0.06, 4, 12), max: 0.42 });
      }
      v.k = i % 2 ? 0.4 : 0.55; v.tilt = i % 2 ? 0.07 : -0.07;
      if (res.hit) {
        if (i < 2) { D.v.flash = 0.9; shake(F, 5); sparks(F, bp.x, bp.y, 8, sea ? '#d0f8ff' : '#ffd0a0', 300); }
        else hit({ power: 1.05, shake: 10, col: sea ? '#bff4ff' : '#ffd0a0' });
      }
      await wait(F, 0.14);
    }
    await to(F, v, { k: 1, reach: 0, tilt: 0 }, 0.42, Ease.io);
    setIdle(A);
  }
  async function mvCharge(F, A, D, res, hit) {
    const v = A.v;
    v.pose = 'walk'; v.move = artMove(A, 'charge');
    dustTrail(A, true);
    await to(F, v, { reach: -0.15, sx: 1.04, sy: 0.95 }, 0.34, Ease.out);                 // back up, paw the ground
    await wait(F, 0.05);
    sfx('charge');
    trail(A, true);
    await to(F, v, { reach: 1.04, sx: 1, sy: 1 }, 0.34, Ease.in);                         // run across
    trail(A, false); dustTrail(A, false);
    v.pose = 'attack'; v.k = 0.5;
    hit({ power: 1.9, shake: 16 });                                                          // big knock-back
    if (res.hit) { const bp = bodyPt(F, D); addRing(F, { x: bp.x, y: feetPt(F, D).y, r0: 10, r1: bp.w * 0.9, sq: 0.3, w: 7, max: 0.5, layer: 0, col: '#fff3c0' }); }
    await to(F, v, { reach: 0.8, hop: 12, k: 0.75 }, 0.13, Ease.out);
    await to(F, v, { hop: 0 }, 0.1, Ease.in);
    v.pose = 'walk';
    await to(F, v, { reach: 0, k: 1 }, 0.46, Ease.io);
    setIdle(A);
  }
  /** Tail whip / club swing: turn around, whip, turn back. */
  async function mvSwing(F, A, D, res, hit, kind) {
    const v = A.v, club = kind === 'club', sea = A.sp.park === 'sea';
    v.pose = 'walk';
    await to(F, v, { reach: 0.58 }, 0.3, Ease.io);
    v.pose = 'idle';
    await to(F, v, { sx: -1 }, 0.2, Ease.io);                                               // tail towards the opponent
    if (sea) { v.pose = 'attack'; v.move = 'tail'; v.k = 0.3; }
    await to(F, v, { tilt: 0.16 }, 0.16, Ease.out);                                         // wind-up
    sfx(club ? 'club' : 'tail');
    const bp = bodyPt(F, D);
    F.arcs.push({ x: bp.x - dirOf(A, D) * bp.w * 0.1, y: bp.y + bp.h * 0.05, r: clamp(bp.w * 0.62, 50, 240), a0: club ? -2.6 : 2.4, a1: club ? -0.4 : 0.5, w: clamp(bp.h * 0.12, 6, 22), col: club ? '#ffd38a' : '#bfefff', life: 0, max: 0.42 });
    await to(F, v, { tilt: -0.22, reach: 0.7, k: 0.55 }, 0.1, Ease.in);                   // whip!
    hit({ power: club ? 1.6 : 1.3, shake: club ? 14 : 11, col: club ? '#ffe08a' : undefined });
    if (club && res.hit) {
      const p = bodyPt(F, D);
      for (let i = 0; i < 5; i++) addPart(F, { x: p.x, y: p.y - p.h * 0.35, vx: Math.cos(i / 5 * TAU) * 70, vy: Math.sin(i / 5 * TAU) * 24 - 30, max: 0.95, r: 7, kind: 'star', col: '#fff38a', layer: 1 });
      rocks(F, p.x, feetPt(F, D).y, 5, p.w * 0.3, F.park === 'ice' ? '#cfe2f0' : '#8a7458', feetPt(F, D).y, 0.5);
    }
    await to(F, v, { tilt: 0, k: 1 }, 0.2, Ease.out);
    v.pose = 'idle'; v.move = null;
    await to(F, v, { sx: 1 }, 0.2, Ease.io);
    v.pose = 'walk';
    await to(F, v, { reach: 0 }, 0.34, Ease.io);
    setIdle(A);
  }
  async function mvStomp(F, A, D, res, hit) {
    const v = A.v, sea = A.sp.park === 'sea';
    v.pose = 'walk';
    await to(F, v, { reach: 0.3 }, 0.28, Ease.io);
    v.pose = 'roar'; v.move = sea ? 'tail' : null;
    await to(F, v, { tilt: -0.32, hop: 30, sx: 0.96, sy: 1.06 }, 0.4, Ease.out);          // rear up
    await wait(F, 0.08);
    await to(F, v, { tilt: 0.06, hop: 0, sx: 1.08, sy: 0.9 }, 0.12, Ease.in);             // slam down
    sfx('stomp');
    shake(F, 16);
    const fp = feetPt(F, A), dp = feetPt(F, D), bw = bodyPt(F, A).w;
    if (sea) {                                                                               // « Raz-de-marée »: a ring of water
      for (let i = 0; i < 3; i++) addRing(F, { x: fp.x, y: fp.y, r0: 10, r1: bw * (0.8 + i * 0.5), sq: 0.28, w: 6, max: 0.55 + i * 0.12, layer: 0, col: '#bff4ff', life: -i * 0.06 });
      puff(F, fp.x, fp.y, 16, bw * 0.4, 1.4);
    } else {                                                                                 // ground quake
      addCracks(F, fp.x + A.face * bw * 0.15, fp.y, bw * 0.75, null);
      puff(F, fp.x, fp.y, 12, bw * 0.4, 1.3);
      rocks(F, fp.x, fp.y, 8, bw * 0.3, F.park === 'ice' ? '#cfe2f0' : '#8a7458', fp.y, 0.7);
      addRing(F, { x: fp.x, y: fp.y, r0: 10, r1: Math.abs(dp.x - fp.x) * 1.15 + 20, sq: 0.3, w: 8, max: 0.4, layer: 0, col: F.park === 'ice' ? '#e8f6ff' : '#ffe6b0' });
    }
    v.pose = 'idle';
    await to(F, v, { sx: 1, sy: 1 }, 0.14, Ease.out);
    hit({ power: 1.5, shake: 12 });                                                          // the quake reaches the target
    if (res.hit && !sea) rocks(F, dp.x, dp.y, 6, bodyPt(F, D).w * 0.3, F.park === 'ice' ? '#cfe2f0' : '#8a7458', dp.y, 0.6);
    await to(F, v, { tilt: 0 }, 0.2);
    v.pose = 'walk';
    await to(F, v, { reach: 0 }, 0.3, Ease.io);
    setIdle(A);
  }
  async function mvHorn(F, A, D, res, hit) {
    const v = A.v;
    v.pose = 'walk'; v.move = artMove(A, 'horn');
    dustTrail(A, true);
    await to(F, v, { reach: -0.1, tilt: 0.12 }, 0.3, Ease.out);                            // lower the horns
    trail(A, true);
    await to(F, v, { reach: 0.96 }, 0.24, Ease.in);
    trail(A, false); dustTrail(A, false);
    sfx('horn');
    v.pose = 'attack'; v.k = 0.5;
    hit({ power: 1.7, shake: 13, col: '#fff2a0' });                                          // tosses the target up
    await to(F, v, { tilt: -0.2, k: 0.7 }, 0.13, Ease.out);                                 // flick the head up
    v.pose = 'walk';
    await to(F, v, { tilt: 0, reach: 0, k: 1 }, 0.45, Ease.io);
    setIdle(A);
  }
  async function mvHead(F, A, D, res, hit) {
    const v = A.v;
    v.pose = 'walk'; v.move = artMove(A, 'head');
    await to(F, v, { reach: -0.1, tilt: 0.18 }, 0.3, Ease.out);
    trail(A, true); dustTrail(A, true);
    await to(F, v, { reach: 0.95 }, 0.22, Ease.in);
    trail(A, false); dustTrail(A, false);
    sfx('head');
    hit({ power: 1.4, shake: 12 });
    if (res.hit) {
      const hp = headPt(F, A);
      for (let i = 0; i < 6; i++) addPart(F, { x: hp.x, y: hp.y, vx: Math.cos(i / 6 * TAU) * 90, vy: Math.sin(i / 6 * TAU) * 40 - 40, g: 120, max: 0.8, r: 6, kind: 'star', col: '#fff38a', layer: 1 });
    }
    await to(F, v, { reach: 0.62, hop: 20, tilt: -0.12 }, 0.16, Ease.out);                // bounce off
    await to(F, v, { hop: 0 }, 0.12, Ease.in);
    v.pose = 'walk';
    await to(F, v, { reach: 0, tilt: 0 }, 0.34, Ease.io);
    setIdle(A);
  }
  function moveSeq(F, A, D, mv, res, hit) {
    switch (mv.key) {
      case 'bite': return mvBite(F, A, D, res, hit);
      case 'claw': return mvClaw(F, A, D, res, hit);
      case 'charge': return mvCharge(F, A, D, res, hit);
      case 'tail': return mvSwing(F, A, D, res, hit, 'tail');
      case 'club': return mvSwing(F, A, D, res, hit, 'club');
      case 'stomp': return mvStomp(F, A, D, res, hit);
      case 'horn': return mvHorn(F, A, D, res, hit);
      default: return mvHead(F, A, D, res, hit);
    }
  }

  // ================================================================ fight: SPÉCIALE cinematic (per-class flavour)
  const CHARGE = {
    async chasseur(F, A) {                       // crouch, then a red blur lunge
      const v = A.v;
      v.pose = 'attack'; v.k = 0; v.move = artMove(A, 'bite');
      await to(F, v, { k: 0.3, reach: -0.08, sy: 0.92, sx: 1.06 }, 0.22, Ease.out);
      trail(A, true, 'rgba(255,60,40,.95)', true);
      await to(F, v, { k: 0.52, reach: 0.95, sy: 1.04, sx: 0.96 }, 0.3, Ease.in2);
      trail(A, false);
    },
    async colosse(F, A) {                        // advance, rear up high and slam the ground
      const v = A.v;
      v.pose = 'walk';
      dustTrail(A, true);
      await to(F, v, { reach: 0.45 }, 0.3, Ease.io);
      dustTrail(A, false);
      v.pose = 'roar';
      await to(F, v, { tilt: -0.36, hop: 46, sy: 1.06 }, 0.3, Ease.out);
      trail(A, true, 'rgba(90,255,80,.9)', true);
      await to(F, v, { tilt: 0.08, hop: 0, sy: 0.88, sx: 1.08 }, 0.1, Ease.in);
      trail(A, false);
      sfx('stomp');
    },
    async blinde(F, A) {                         // raise a shield bubble and ram
      const v = A.v;
      await to(F, v, { shield: 1 }, 0.16, Ease.out);
      v.pose = 'walk'; v.move = artMove(A, 'charge');
      await to(F, v, { reach: -0.12 }, 0.14, Ease.out);
      trail(A, true, 'rgba(90,180,255,.95)', true);
      dustTrail(A, true);
      await to(F, v, { reach: 1.0 }, 0.28, Ease.in);
      trail(A, false); dustTrail(A, false);
    },
  };
  const IMPACT = {
    chasseur(F, A, D) {                          // giant red claw slashes
      const bp = bodyPt(F, D), len = clamp(bp.h * 1.7, 120, 380);
      [0.85, PI - 0.85, 0.15].forEach((ang, i) => {
        for (let j = -1; j <= 1; j++) {
          addSlash(F, { x: bp.x + Math.cos(ang + PI / 2) * j * len * 0.11, y: bp.y + Math.sin(ang + PI / 2) * j * len * 0.11, ang, len: len * (1 - Math.abs(j) * 0.1), col: '#ff2a1a', w: clamp(len * 0.06, 8, 20), max: 0.9, life: -i * 0.09 });
        }
      });
      sfx('claw');
      sparks(F, bp.x, bp.y, 30, '#ff5a3a', 620);
    },
    colosse(F, A, D) {                           // green ground-quake with erupting rocks
      const fa = feetPt(F, A), fd = feetPt(F, D), bp = bodyPt(F, D);
      addCracks(F, fd.x, fd.y, bp.w * 1.3, '#46d63a');
      addCracks(F, fa.x, fa.y, bp.w * 0.9, '#46d63a');
      rocks(F, fd.x, fd.y, 22, bp.w * 0.6, F.park === 'ice' ? '#cfe2f0' : F.park === 'sea' ? '#8a8270' : '#7d6448', fd.y, 1.2);
      for (let i = 0; i < 3; i++) addRing(F, { x: fd.x, y: fd.y, r0: 20, r1: bp.w * (1 + i * 0.6), sq: 0.3, w: 10, max: 0.7 + i * 0.15, layer: 0, col: '#7dff5a', life: -i * 0.1 });
      for (let i = 0; i < 18; i++) addPart(F, { x: fd.x + rand(-1, 1) * bp.w * 0.7, y: fd.y + rand(-8, 8), vx: rand(-20, 20), vy: -rand(150, 420), g: 200, max: rand(0.5, 1), r: rand(3, 7), kind: 'flame', col: '#9cff6a', layer: 1 });
      puff(F, fd.x, fd.y, 14, bp.w * 0.6, 1.6);
      shake(F, 34);
    },
    blinde(F, A, D) {                            // the shield shatters into blue shards
      const bp = bodyPt(F, D), ap = bodyPt(F, A);
      A.v.shield = 0;
      shards(F, lerp(ap.x, bp.x, 0.5), lerp(ap.y, bp.y, 0.5), 34, 620, '#8fd0ff');
      shards(F, bp.x, bp.y, 14, 420, '#e0f4ff');
      for (let i = 0; i < 2; i++) addRing(F, { x: bp.x, y: bp.y, r0: 20, r1: bp.w * 1.6, w: 6, max: 0.5, col: '#5ab8ff', life: -i * 0.1 });
      sfx('horn');
    },
  };
  async function specialSeq(F, A, D, res, hit) {
    const v = A.v, X = F.fxs, cam = F.cam, S = SPECIALS[A.cls], L = F.L;
    F.cine = true;
    F.ui.scr.classList.add('cine');
    X.tintCol = S.color;
    sfx('special', { cls: A.cls });
    const bp = bodyPt(F, A);
    // 1. the screen dims, cinematic bars, the camera zooms on the attacker
    await Promise.all([
      to(F, X, { dim: 0.62, bars: 1, tint: 0.55 }, 0.45, Ease.out),
      to(F, cam, { x: bp.x, y: bp.y, z: 1.55 }, 0.55, Ease.io),
    ]);
    // 2. class-coloured aura + roar
    v.pose = 'roar'; v.k = 0; v.move = artMove(A, 'bite');
    sfx('roar', { pitch: A.stage >= 3 ? 0.85 : 1.1, len: 1 });
    X.speed = 1;
    addText(F, L.W / 2, L.H * 0.17, S.roar, { screen: true, size: 1.9, col: S.glow, stroke: '#140404', rise: 10, max: 1.25, jitter: 1.2 });
    const hp = headPt(F, A);
    for (let i = 0; i < 3; i++) addRing(F, { x: hp.x, y: hp.y, r0: 10, r1: bp.h * 1.2, w: 4, max: 0.7, col: S.glow, life: -i * 0.18 });
    await tween(F, 1.0, (e, k) => { cam.shake = Math.max(cam.shake, 4.5 * Math.sin(k * PI)); v.aura = Math.min(1, k * 2.5); v.power = Math.min(1, k * 2); }, Ease.lin);
    X.speed = 0;
    F.banner = { txt: S.name.toUpperCase(), col: S.color, life: 0, max: 1.15 };
    // 3. slow-motion charge, the camera follows towards the target
    F.timeScale = 0.38;
    const dp = bodyPt(F, D);
    await Promise.all([to(F, cam, { x: lerp(bp.x, dp.x, 0.6), y: lerp(bp.y, dp.y, 0.6), z: 1.22 }, 0.5, Ease.io), CHARGE[A.cls](F, A, D)]);
    F.timeScale = 1;
    // 4. huge impact
    F.ui.scr.classList.remove('cine');
    hit({ special: true, power: 2.3, shake: 28, col: S.glow });
    IMPACT[A.cls](F, A, D);
    const ip = bodyPt(F, D);
    for (let i = 0; i < 3; i++) addRing(F, { x: ip.x, y: ip.y, r0: 12, r1: ip.w * (0.9 + i * 0.45) + 60, w: 12 - i * 3, max: 0.6 + i * 0.12, col: i === 1 ? '#ffffff' : S.color, life: -i * 0.07 });
    sparks(F, ip.x, ip.y, 36, S.glow, 760);
    flash(F, '#ffffff', 1);
    await wait(F, 0.7);
    // 5. back to the wide shot
    v.pose = 'walk'; v.move = null;
    await Promise.all([
      to(F, X, { dim: 0, bars: 0, tint: 0 }, 0.5, Ease.io),
      to(F, cam, { x: L.W / 2, y: L.H / 2, z: 1 }, 0.5, Ease.io),
      to(F, v, { aura: 0, power: 0, shield: 0, reach: 0, tilt: 0, hop: 0, sx: 1, sy: 1, k: 0 }, 0.55, Ease.io),
    ]);
    setIdle(A);
    F.cine = false;
  }

  // ================================================================ fight: K.O., entrances, switch, intro, outro
  async function koSeq(F, D) {
    await wait(F, 0.42);
    const v = D.v, sea = D.sp.park === 'sea';
    v.hurtTok = (v.hurtTok || 0) + 1;                       // stop the hurt reaction
    v.flash = 0;
    sfx('ko');
    const bp = bodyPt(F, D);
    addText(F, bp.x, bp.y - bp.h * 0.55, 'K.O. !', { size: 1.6, col: '#ff5a4a', stroke: '#2a0000', rise: 30, max: 1.6 });
    v.pose = 'hurt'; v.k = 0.5;
    if (sea) {
      puff(F, bp.x, bp.y, 14, bp.w * 0.3, 1);
      await to(F, v, { oy: 26, tilt: -0.55, alpha: 0, ox: 0, hop: 0 }, 1.1, Ease.in2);
    } else {
      await to(F, v, { tilt: -0.22, hop: 16, ox: 0, oy: 0 }, 0.22, Ease.out);          // stagger
      await to(F, v, { tilt: 0.12, hop: 0, sy: 0.6, sx: 1.12, oy: 4 }, 0.22, Ease.in);   // collapse
      const fp = feetPt(F, D);
      puff(F, fp.x, fp.y, 14, bp.w * 0.45, 1.2);
      shake(F, 8);
      await tween(F, 0.7, (e, k) => { v.alpha = (1 - k) * (Math.floor(k * 12) % 2 ? 0.45 : 1); }, Ease.lin);
    }
    v.visible = false; v.alpha = 0;
    hud(F);
  }
  async function roarSeq(F, f) {
    const v = f.v;
    v.pose = 'roar';
    sfx(f.stage >= 2 ? 'roar' : 'roar_small', { pitch: 1.25 - f.stage * 0.12 });
    shake(F, 3 + f.stage * 2.5);
    const hp = headPt(F, f), bp = bodyPt(F, f);
    for (let i = 0; i < 3; i++) addRing(F, { x: hp.x, y: hp.y, r0: 8, r1: bp.h * 0.9, w: 3, max: 0.6, col: 'rgba(255,255,255,.85)', life: -i * 0.15 });
    addText(F, hp.x, hp.y - bp.h * 0.25, f.stage >= 2 ? 'ROAAAR !' : 'Grrr !', { size: 0.7 + f.stage * 0.12, col: '#ffffff', stroke: '#2a1a08', rise: 26, max: 0.9, jitter: 0.5 });
    await wait(F, 0.8);
    setIdle(f);
  }
  /** A creature slides into the arena (player from the left, enemy from the right) and roars. */
  async function enterSeq(F, side, idx, quiet) {
    const f = (side === 'p' ? F.P : F.E)[idx];
    if (side === 'p') F.pi = idx; else F.ei = idx;
    f.v = freshVis();
    const v = f.v;
    v.visible = true; v.pose = 'walk';
    v.ox = side === 'p' ? -F.L.W * 0.7 : F.L.W * 0.6;
    hud(F);
    dustTrail(f, true);
    await to(F, v, { ox: 0 }, 0.8, Ease.out);
    dustTrail(f, false);
    setIdle(f);
    if (!quiet) await roarSeq(F, f);
  }
  async function switchSeq(F, side, idx) {
    const f = active(F, side), v = f.v;
    setMsg(F, side === 'p' ? `${f.name}, reviens !` : `${F.oppName} rappelle ${f.name} !`);
    await to(F, v, { sx: -1 }, 0.18, Ease.io);
    v.pose = 'walk';
    dustTrail(f, true);
    await to(F, v, { ox: side === 'p' ? -F.L.W * 0.7 : F.L.W * 0.6 }, 0.55, Ease.in);
    dustTrail(f, false);
    v.visible = false;
    const n = (side === 'p' ? F.P : F.E)[idx];
    setMsg(F, side === 'p' ? `À toi, ${n.name} !` : `${F.oppName} envoie ${n.name} !`);
    await enterSeq(F, side, idx);
  }
  async function introSeq(F) {
    F.vs = { life: 0, max: 1.9, name: F.oppName, sub: F.subTitle, npc: F.oppImg, pImg: F.pImg };
    F.ui.scr.classList.add('intro');
    sfx('unlock');
    await wait(F, 1.65);
    F.ui.scr.classList.remove('intro');
    await Promise.all([enterSeq(F, 'p', F.pi, true), enterSeq(F, 'e', F.ei, true)]);
    await roarSeq(F, active(F, 'p'));
    await roarSeq(F, active(F, 'e'));
    addText(F, F.L.W / 2, F.L.H * 0.32, 'COMBAT !', { screen: true, size: 2.3, col: '#ffd23a', stroke: '#1a0f00', rise: 0, max: 1 });
    await wait(F, 0.55);
  }
  async function victorySeq(F) {
    const W = F.L.W, HH = F.L.H;
    music('victory');
    sfx('win');
    F.trophy = { life: 0 };
    addText(F, W / 2, HH * 0.14, 'VICTOIRE !', { screen: true, size: 2.3, col: '#ffd23a', stroke: '#2a1600', rise: 0, max: 3.4 });
    const cols = ['#ff4a3a', '#ffd23a', '#52bd31', '#3aa2ff', '#ff7ae0', '#ffffff'];
    for (let i = 0; i < 140; i++) {
      addPart(F, { x: rand(0, W), y: rand(-HH * 0.6, -10), vx: rand(-40, 40), vy: rand(90, 260), g: 30, drag: 0.3, max: rand(2.8, 4.2), r: rand(4, 7), kind: 'conf', col: cols[i % cols.length], rot: rand(0, TAU), vr: rand(-6, 6), layer: 2 });
    }
    const p = active(F, 'p');
    if (p && !p.ko) bg(roarSeq(F, p));
    await wait(F, 2.7);
  }
  async function defeatSeq(F) {
    music('defeat');
    sfx('lose');
    if (F.ui.cv) F.ui.cv.classList.add('lose');
    addText(F, F.L.W / 2, F.L.H * 0.3, 'DÉFAITE…', { screen: true, size: 2.1, col: '#c8d0d6', stroke: '#101418', rise: 0, max: 2.6 });
    await wait(F, 2.2);
  }

  // ================================================================ fight: AI, turns, outcome
  /** Shared AI (enemy turns and the player's AUTO mode). */
  function aiChoose(F, side) {
    const A = active(F, side), D = active(F, side === 'p' ? 'e' : 'p');
    if (A.gauge >= GAUGE_MAX) return { type: 'special' };
    const cm = PC.classMult(A.cls, D.cls), avg = (A.atkMin + A.atkMax) / 2;
    let best = A.moves[0], bestS = -1;
    for (const m of A.moves) {
      let s = avg * m.mult * cm * m.acc / 100;
      if (A.atkMin * m.mult * cm >= D.hp) s += 10000 * m.acc / 100;     // a sure K.O.: favour accuracy
      else if (A.gauge + m.gauge >= GAUGE_MAX) s *= 1.2;                // finish charging the special
      s *= 0.85 + Math.random() * 0.3;
      if (s > bestS) { bestS = s; best = m; }
    }
    if (Math.random() < 0.12) best = A.moves[randInt(0, A.moves.length - 1)];
    return { type: 'move', move: best };
  }
  function bestNext(F, side) {
    const team = side === 'p' ? F.P : F.E, foe = active(F, side === 'p' ? 'e' : 'p');
    let bi = -1, bs = -1;
    team.forEach((f, i) => {
      if (f.ko) return;
      const s = (foe && !foe.ko ? PC.classMult(f.cls, foe.cls) : 1) * 1000 + f.hp / f.maxHp * 100 + f.level;
      if (s > bs) { bs = s; bi = i; }
    });
    return bi;
  }
  async function doAction(F, side, act) {
    const A = active(F, side), D = active(F, side === 'p' ? 'e' : 'p');
    if (act.type === 'switch') { await switchSeq(F, side, act.idx); return; }
    const special = act.type === 'special';
    const mv = special ? { key: 'special', name: SPECIALS[A.cls].name, mult: SPECIAL_MULT, acc: 100, gauge: 0 } : act.move;
    const hitOk = special || Math.random() * 100 < mv.acc;
    const cm = PC.classMult(A.cls, D.cls), crit = hitOk && Math.random() < CRIT;
    const dmg = hitOk ? Math.max(1, Math.round(randInt(A.atkMin, A.atkMax) * mv.mult * cm * (crit ? CRIT_MULT : 1))) : 0;
    const res = { hit: hitOk, crit, dmg, cm, special, move: mv };
    setMsg(F, `${A.name}${side === 'e' ? ' adverse' : ''} utilise ${special ? 'SPÉCIALE : ' + mv.name : mv.name} !`);
    const hit = o => applyHit(F, A, D, res, o);
    if (special) await specialSeq(F, A, D, res, hit);
    else await moveSeq(F, A, D, mv, res, hit);
    applyHit(F, A, D, res);   // no-op when the animation already applied it
    if (D.hp <= 0 && !D.ko) { D.ko = true; hud(F); await koSeq(F, D); }
    hud(F);
  }
  function playerChoice(F) {
    return new Promise((res, rej) => {
      F.phase = 'player';
      F.chooseRej = rej;
      F.choose = a => {
        if (F.phase !== 'player') return;
        F.phase = 'busy'; F.choose = null; F.chooseRej = null;
        if (F.modal) closeModal(F);
        res(a);
        hud(F);
      };
      if (!F.auto) setMsg(F, 'À toi de jouer !', 1.6);
      hud(F);
      if (F.auto) autoPlay(F);
    });
  }
  function autoPlay(F) {
    const tok = (F.autoTok = (F.autoTok || 0) + 1);
    bg(wait(F, 0.5).then(() => {
      if (F.auto && F.phase === 'player' && F.autoTok === tok && F.choose && !F.modal && !F.paused) F.choose(aiChoose(F, 'p'));
    }));
  }
  function pickNext(F) {
    const alive = aliveIdx(F.P);
    if (F.auto || alive.length === 1) return Promise.resolve(F.auto ? bestNext(F, 'p') : alive[0]);
    return new Promise((res, rej) => {
      F.phase = 'pick';
      F.chooseRej = rej;
      setMsg(F, 'Choisis ta prochaine créature !', 2.4);
      showPick(F, false, i => { F.chooseRej = null; F.pickCb = null; F.phase = 'busy'; res(i); });
    });
  }
  async function runFight(F) {
    try {
      await introSeq(F);
      for (;;) {
        const act = await playerChoice(F);                             // ---- player's turn
        if (act.type === 'flee') { await finishFight(F, false, true); return; }
        await doAction(F, 'p', act);
        if (!aliveIdx(F.E).length) { await finishFight(F, true); return; }
        if (active(F, 'e').ko) {                                        // next enemy enters, new round
          const n = F.E.findIndex(f => !f.ko);
          setMsg(F, `${F.oppName} envoie ${F.E[n].name} !`);
          await enterSeq(F, 'e', n);
          continue;
        }
        F.phase = 'enemy'; hud(F);                                      // ---- enemy's turn
        await wait(F, 0.35);
        await doAction(F, 'e', aiChoose(F, 'e'));
        if (!aliveIdx(F.P).length) { await finishFight(F, false); return; }
        if (active(F, 'p').ko) {
          const idx = await pickNext(F);
          setMsg(F, `À toi, ${F.P[idx].name} !`);
          await enterSeq(F, 'p', idx);
        }
      }
    } catch (e) {
      if (e === STOP) {
        if (F.aborted && !F.dead) {                                    // « Abandonner » during an animation
          F.aborted = false; F.tweens = []; F.timeScale = 1; F.cine = false; F.vs = null;
          F.ui.scr.classList.remove('cine', 'intro');
          Object.assign(F.fxs, { dim: 0, bars: 0, tint: 0, speed: 0 });
          Object.assign(F.cam, { x: F.L.W / 2, y: F.L.H / 2, z: 1 });
          finishFight(F, false, true).catch(err => { if (err !== STOP) console.error('battle', err); });
        }
        return;
      }
      console.error('battle', e);
      if (!F.dead && root && fight === F) { stopFight(); showTournament(); }
    }
  }
  /** Record the result first (closing during the celebration keeps it), then celebrate, then the result box. */
  async function finishFight(F, won, fled) {
    F.phase = 'end';
    if (F.modal) closeModal(F);
    hud(F);
    const o = F.opts;
    let reward = {}, medal = 0;
    if (o.custom) {
      try { if (typeof o.onEnd === 'function') reward = o.onEnd(!!won, { fled: !!fled }) || {}; } catch (e) { console.error('battle onEnd', e); }
    } else {
      const E = ENG();
      try { if (E && typeof E.recordBattle === 'function') reward = E.recordBattle(F.park, o.stage, !!won, o.tier || 1) || {}; } catch (e) { console.error('recordBattle', e); }
      const after = medalOf(F.park, o.stage);
      if (won && after > F.medalBefore) medal = after;
    }
    if (fled) { fightMusic = false; parkMusic(); } else if (won) await victorySeq(F); else await defeatSeq(F);
    showResult(F, won, reward, medal, fled);
  }

  // ================================================================ fight: HUD (DOM) and modals
  const localPrefs = { sound: true, music: true };
  function audioPrefs() { const s = engState(); return (s && s.settings) || localPrefs; }
  function winsOf(park) { const s = engState(); return (s && s.counters && s.counters.battlesWon && s.counters.battlesWon[park]) || 0; }
  function setMsg(F, text, dur) {
    const m = F.ui && F.ui.msg;
    if (!m) return;
    m.textContent = text;
    m.classList.remove('off');
    clearTimeout(F.msgT);
    F.msgT = setTimeout(() => m.classList.add('off'), (dur || 2.2) * 1000);
  }
  const canAct = F => F.phase === 'player' && !F.auto && !F.paused && !F.modal && !!F.choose;

  function buildFightDom(F) {
    const U = F.ui, scr = U.scr = el('div', 'bt-screen bt-fight');
    U.cv = el('canvas', 'bt-cv');
    scr.appendChild(U.cv);
    // top plates: owner, creature name + class + level, HP bar, special gauge
    const top = el('div', 'bt-top');
    const mkPlate = side => {
      const p = el('div', 'bt-plate bt-steel' + (side === 'e' ? ' r' : ''));
      const who = el('div', 'bt-who');
      if (side === 'p') {
        who.innerHTML = `<img src="${iconUrl('trophy', 18)}" alt=""><span>${esc((F.opts.playerName || 'Toi').toUpperCase())}</span>` +
          `<span class="bt-wins" title="Combats gagnés dans ce parc"><img src="${iconUrl('star', 14)}" alt="">${fmt(winsOf(F.park))}</span>`;
      } else {
        who.appendChild(npcCanvas(F.oppLook, 24, 28));
        who.insertAdjacentHTML('beforeend', `<span>${esc(F.oppName)}</span>`);
      }
      p.appendChild(who);
      p.insertAdjacentHTML('beforeend', '<div class="bt-nm"><img alt=""><b></b><i></i></div><div class="bt-hp"><div class="g"></div><div class="f"></div><span></span></div>' +
        `<div class="bt-gauge" title="Jauge SPÉCIALE">${'<b><i></i></b>'.repeat(4)}</div>`);
      top.appendChild(p);
      return { cls: p.querySelector('.bt-nm img'), nm: p.querySelector('.bt-nm b'), lv: p.querySelector('.bt-nm i'), f: p.querySelector('.bt-hp .f'), g: p.querySelector('.bt-hp .g'), txt: p.querySelector('.bt-hp span'), gauge: p.querySelector('.bt-gauge'), segs: Array.from(p.querySelectorAll('.bt-gauge i')), key: '' };
    };
    U.p = mkPlate('p'); U.e = mkPlate('e');
    scr.appendChild(top);
    // team portraits down each side
    U.tp = {};
    for (const side of ['p', 'e']) {
      const col = el('div', 'bt-team ' + (side === 'p' ? 'l' : 'r'));
      U.tp[side] = (side === 'p' ? F.P : F.E).map(f => {
        const tp = el('div', 'bt-tp');
        tp.appendChild(canvasCopy(PC.ART.portrait(f.species, 108, 104, { stage: f.stage })));
        tp.insertAdjacentHTML('beforeend', '<div class="m"><i></i></div>');
        tp.title = `${f.name} · Niv. ${f.level}`;
        col.appendChild(tp);
        return { el: tp, bar: tp.querySelector('.m i') };
      });
      scr.appendChild(col);
    }
    U.msg = el('div', 'bt-msg off');
    U.msg.setAttribute('aria-live', 'polite');
    scr.appendChild(U.msg);
    // bottom: pause + level badge, 3 moves, SPÉCIALE, CHANGER
    const bottom = el('div', 'bt-bottom');
    const left = el('div', 'bt-left-ctl');
    U.pause = el('button', 'bt-round bt-steel', `<img src="${btIcon('pause')}" alt="">`);
    U.pause.setAttribute('aria-label', 'Pause');
    U.pause.onclick = () => { sfx('click'); showPause(F); };
    U.lvlBox = el('div', 'bt-lvl', '<span></span>');
    U.lvlBox.title = 'Niveau de ta créature';
    U.lvl = U.lvlBox.querySelector('span');
    left.append(U.pause, U.lvlBox);
    bottom.appendChild(left);
    const acts = el('div', 'bt-acts');
    U.moves = [0, 1, 2].map(j => {
      const b = el('button', 'bt-act bt-steel');
      b.onclick = () => {
        const A = active(F, 'p');
        if (!canAct(F) || !A.moves[j]) return;
        sfx('click');
        F.choose({ type: 'move', move: A.moves[j] });
      };
      acts.appendChild(b);
      return b;
    });
    const spw = el('div', 'bt-spw');
    U.sp = el('button', 'bt-act bt-steel bt-sp', '<div class="fill"></div><img alt=""><em>SPÉCIALE</em><span class="bt-badge"></span>');
    U.spImg = U.sp.querySelector('img'); U.spFill = U.sp.querySelector('.fill'); U.badge = U.sp.querySelector('.bt-badge');
    U.sp.onclick = () => onSpecial(F);
    U.pay = el('button', 'bt-pay', `<img src="${iconUrl('dollar', 20)}" alt="">${SPECIAL_COST.dollars}`);
    U.pay.title = `Utiliser la SPÉCIALE tout de suite pour ${SPECIAL_COST.dollars} dollars`;
    U.pay.onclick = () => onPay(F);
    spw.append(U.sp, U.pay);
    acts.appendChild(spw);
    U.sw = el('button', 'bt-act bt-steel', `<img src="${btIcon('switch')}" alt=""><em>CHANGER</em>`);
    U.sw.title = 'Changer de créature (compte comme ton tour)';
    U.sw.onclick = () => openSwitch(F);
    acts.appendChild(U.sw);
    bottom.appendChild(acts);
    scr.appendChild(bottom);
    // right edge: sound, music, AUTO, FUIR
    const side = el('div', 'bt-side-ctl');
    U.snd = el('button', 'bt-sbtn bt-steel', `<img src="${btIcon('sound')}" alt="">`);
    U.snd.setAttribute('aria-label', 'Sons');
    U.snd.onclick = () => toggleAudio(F, 'sound');
    U.mus = el('button', 'bt-sbtn bt-steel', `<img src="${btIcon('music')}" alt="">`);
    U.mus.setAttribute('aria-label', 'Musique');
    U.mus.onclick = () => toggleAudio(F, 'music');
    U.auto = el('button', 'bt-auto bt-steel', 'AUTO');
    U.auto.title = 'Laisser ton équipe combattre toute seule';
    U.auto.onclick = () => toggleAuto(F);
    U.flee = el('button', 'bt-flee bt-btn-red', 'FUIR');
    U.flee.onclick = () => { sfx('click'); confirmFlee(F); };
    side.append(U.snd, U.mus, U.auto, U.flee);
    scr.appendChild(side);
    root.appendChild(scr);
  }

  function hud(F) {
    const U = F.ui;
    if (!U || !U.p || F.dead) return;
    for (const side of ['p', 'e']) {
      const f = active(F, side), P = U[side];
      if (!f) continue;
      const key = f.species + '|' + f.i;
      if (P.key !== key) {
        P.key = key;
        P.cls.src = iconUrl(f.cls, 22); P.cls.alt = P.cls.title = PC.CLASSES[f.cls].name;
        P.nm.textContent = f.name; P.lv.textContent = 'Niv. ' + f.level;
      }
      const pct = clamp(f.hp / f.maxHp * 100, 0, 100);
      P.f.style.width = pct + '%'; P.g.style.width = pct + '%';
      P.f.className = 'f' + (pct < 25 ? ' low' : pct < 55 ? ' mid' : '');
      P.txt.textContent = `${fmt(f.hp)} / ${fmt(f.maxHp)}`;
      P.segs.forEach((s, j) => { s.style.width = clamp((f.gauge - j * 25) / 25, 0, 1) * 100 + '%'; });
      P.gauge.classList.toggle('full', f.gauge >= GAUGE_MAX);
      const team = side === 'p' ? F.P : F.E, ai = side === 'p' ? F.pi : F.ei;
      U.tp[side].forEach((t, j) => {
        const m = team[j], r = m.hp / m.maxHp;
        t.el.classList.toggle('on', j === ai && !m.ko);
        t.el.classList.toggle('ko', m.ko);
        t.bar.style.width = clamp(r * 100, 0, 100) + '%';
        t.bar.style.background = r < 0.25 ? '#e0402a' : r < 0.55 ? '#e8a81c' : '#52bd31';
      });
    }
    const A = active(F, 'p'), D = active(F, 'e'), can = canAct(F);
    if (A) {
      const mk = A.species + '|' + A.i + '|' + (D ? D.cls : '');
      if (U.movesKey !== mk) {
        U.movesKey = mk;
        const cm = D ? PC.classMult(A.cls, D.cls) : 1;
        A.moves.forEach((m, j) => {
          const b = U.moves[j];
          if (!b) return;
          b.innerHTML = `<img src="${btIcon(m.key)}" alt=""><em>${esc(m.name)}</em><span class="bt-acc">${m.acc}%</span>` +
            (cm > 1 ? '<span class="bt-eff">+25%</span>' : cm < 1 ? '<span class="bt-eff w">−20%</span>' : '');
          b.title = `${m.name} — puissance ×${m.mult}, précision ${m.acc} %` + (m.gauge > 25 ? ', remplit vite la jauge SPÉCIALE' : '');
        });
        U.spImg.src = btIcon('special', SPECIALS[A.cls].color);
        U.sp.title = `SPÉCIALE : ${SPECIALS[A.cls].name} (×${SPECIAL_MULT}, ne rate jamais)`;
        U.sp.style.setProperty('--sc', SPECIALS[A.cls].color);
      }
      const ready = A.gauge >= GAUGE_MAX;
      U.sp.classList.toggle('ready', ready);
      U.spFill.style.height = (ready ? 0 : clamp(A.gauge / GAUGE_MAX, 0, 1) * 92) + '%';
      U.badge.hidden = ready;
      U.badge.textContent = String(Math.max(1, Math.ceil((GAUGE_MAX - A.gauge) / 40)));
      U.badge.title = 'Tours avant que la SPÉCIALE soit prête';
      U.pay.hidden = ready || !can;
      if (U.pay.hidden) U.pay.classList.remove('ask');
      U.lvl.textContent = A.level;
    }
    U.moves.forEach(b => { b.disabled = !can; });
    U.sp.disabled = !can;
    U.sw.disabled = !can || aliveIdx(F.P).length < 2;
    U.auto.classList.toggle('on', F.auto);
    U.auto.setAttribute('aria-pressed', F.auto ? 'true' : 'false');
    U.flee.disabled = !(F.phase === 'player' || F.phase === 'pick') || !!F.modal && F.phase !== 'pick';
    U.pause.disabled = F.phase === 'end';
    const pr = audioPrefs();
    U.snd.classList.toggle('off', pr.sound === false);
    U.mus.classList.toggle('off', pr.music === false);
  }

  function onSpecial(F) {
    if (!canAct(F)) return;
    const A = active(F, 'p');
    if (A.gauge >= GAUGE_MAX) { sfx('click'); F.choose({ type: 'special' }); return; }
    F.ui.pay.classList.add('ask');
    sfx('error');
    setMsg(F, `Jauge pas encore pleine : touche « ${SPECIAL_COST.dollars} $ » pour l’utiliser tout de suite !`, 2.6);
  }
  function onPay(F) {
    if (!canAct(F)) return;
    const A = active(F, 'p');
    if (A.gauge >= GAUGE_MAX) { F.choose({ type: 'special' }); return; }
    const E = ENG();
    let ok = true;
    if (E && typeof E.pay === 'function') {
      try { ok = (typeof E.canAfford !== 'function' || E.canAfford(SPECIAL_COST)) && E.pay(SPECIAL_COST) !== false; } catch (e) { ok = false; }
    }
    if (!ok) { sfx('error'); setMsg(F, 'Pas assez de dollars !', 2); return; }
    sfx('coin');
    F.choose({ type: 'special', paid: true });
  }
  function openSwitch(F) {
    if (!canAct(F) || aliveIdx(F.P).length < 2) return;
    sfx('click');
    showPick(F, true, i => F.choose && F.choose({ type: 'switch', idx: i }));
  }
  function toggleAuto(F) {
    F.auto = !F.auto;
    sfx('click');
    setMsg(F, F.auto ? 'Mode AUTO : ton équipe se bat toute seule !' : 'Mode AUTO arrêté : à toi de jouer !', 1.8);
    if (F.auto && F.phase === 'pick' && F.pickCb) { const cb = F.pickCb; closeModal(F); cb(bestNext(F, 'p')); }
    else if (F.auto && F.phase === 'player') { if (F.modal) closeModal(F); autoPlay(F); }
    hud(F);
  }
  function toggleAudio(F, kind) {
    const st = audioPrefs(), on = st[kind] === false;
    st[kind] = on;
    try {
      if (kind === 'sound' && PC.SFX && PC.SFX.setEnabled) PC.SFX.setEnabled(on);
      if (kind === 'music' && PC.MUSIC && PC.MUSIC.setEnabled) PC.MUSIC.setEnabled(on);
    } catch (e) { /* optional */ }
    if (kind === 'music' && on && F.track) music(F.phase === 'end' ? F.endTrack || F.track : F.track);
    if (kind === 'sound' && on) sfx('click');
    try { const E = ENG(); if (E && E.save) E.save(); } catch (e) { /* ignore */ }
    hud(F);
  }

  function openModal(F, cls, onDismiss) {
    if (F.modal) closeModal(F);
    const m = el('div', 'bt-modal'), box = el('div', cls);
    m.appendChild(box);
    m.onclick = e => { if (e.target === m && onDismiss) onDismiss(); };
    F.ui.scr.appendChild(m);
    F.modal = m;
    F.modalDismiss = onDismiss || null;
    hud(F);
    return box;
  }
  function closeModal(F) {
    if (!F || !F.modal) return;
    F.modal.remove();
    F.modal = null; F.modalDismiss = null;
    hud(F);
  }
  /** Creature picker: voluntary « Changer » (cancellable) or forced after a K.O. */
  function showPick(F, voluntary, cb) {
    const box = openModal(F, 'bt-box bt-dark', voluntary ? () => closeModal(F) : null);
    if (!voluntary) F.pickCb = cb;
    box.innerHTML = `<div class="bt-strip bt-hazard"></div><h2>${voluntary ? 'CHANGER' : 'K.O. !'}</h2>` +
      `<p>${voluntary ? 'Qui entre dans l’arène ? (cela compte comme ton tour)' : 'Choisis la prochaine créature !'}</p>`;
    const grid = el('div', 'bt-pick');
    F.P.forEach((f, i) => {
      const c = creatureCard(f.species, f.level, f.name, 'button');
      c.classList.add('pickable');
      c.insertAdjacentHTML('beforeend', `<div class="bt-cs">${f.ko ? 'K.O.' : `PV ${fmt(f.hp)} / ${fmt(f.maxHp)}`}</div>`);
      c.disabled = f.ko || (i === F.pi && !active(F, 'p').ko);
      c.onclick = () => { sfx('click'); F.pickCb = null; closeModal(F); cb(i); };
      grid.appendChild(c);
    });
    box.appendChild(grid);
    if (voluntary) {
      const btns = el('div', 'bt-btns'), x = el('button', 'bt-btn-steel bt-steel', 'Annuler');
      x.onclick = () => { sfx('click'); closeModal(F); };
      btns.appendChild(x);
      box.appendChild(btns);
    }
  }
  function audioToggles(F) {
    const wrap = el('div', 'bt-toggles'), pr = audioPrefs();
    const mk = (kind, label) => {
      const b = el('button', 'bt-btn-steel bt-steel', `${label} : ${pr[kind] === false ? 'non' : 'oui'}`);
      b.onclick = () => { toggleAudio(F, kind); b.textContent = `${label} : ${audioPrefs()[kind] === false ? 'non' : 'oui'}`; };
      return b;
    };
    wrap.append(mk('sound', 'Sons'), mk('music', 'Musique'));
    return wrap;
  }
  function showPause(F) {
    if (F.phase === 'end' || F.modal) return;
    F.paused = true;
    const resume = () => { F.paused = false; closeModal(F); if (F.auto && F.phase === 'player') autoPlay(F); };
    const box = openModal(F, 'bt-box bt-dark', resume);
    box.innerHTML = '<div class="bt-strip bt-hazard"></div><h2>PAUSE</h2><p>Le combat t’attend…</p>';
    box.appendChild(audioToggles(F));
    const btns = el('div', 'bt-btns');
    const go = el('button', 'bt-btn-green', 'Reprendre');
    go.onclick = () => { sfx('click'); resume(); };
    const quit = el('button', 'bt-btn-red', 'Abandonner');
    quit.onclick = () => { sfx('click'); F.paused = false; closeModal(F); confirmFlee(F); };
    btns.append(go, quit);
    box.appendChild(btns);
  }
  function confirmFlee(F) {
    if (F.phase === 'end') return;
    if (F.modal) closeModal(F);
    F.paused = true;
    const no = () => { F.paused = false; closeModal(F); if (F.phase === 'pick' && F.pickCb) showPick(F, false, F.pickCb); else if (F.auto && F.phase === 'player') autoPlay(F); };
    const box = openModal(F, 'bt-box bt-dark', no);
    box.innerHTML = '<div class="bt-strip bt-hazard"></div><h2>FUIR ?</h2><p>Si tu quittes l’arène maintenant, le combat est perdu.</p>';
    const btns = el('div', 'bt-btns');
    const n = el('button', 'bt-btn-green', 'Rester');
    n.onclick = () => { sfx('click'); no(); };
    const y = el('button', 'bt-btn-red', 'Oui, fuir');
    y.onclick = () => { sfx('click'); F.paused = false; closeModal(F); abortFight(F); };
    btns.append(n, y);
    box.appendChild(btns);
  }
  function abortFight(F) {
    if (F.phase === 'end' || F.dead) return;
    if (F.phase === 'player' && F.choose) { F.choose({ type: 'flee' }); return; }
    F.aborted = true;
    F.pickCb = null;
    killTweens(F);
  }

  function showResult(F, won, reward, medal, fled) {
    if (F.dead) return;
    const o = F.opts, chips = rewardChips(reward);
    F.endTrack = won ? 'victory' : 'defeat';
    const box = openModal(F, 'bt-box bt-dark', null);
    const sub = o.custom ? (o.title || '') : `Étape ${o.stage} · ${o.stageName || ''} — ${TIER_NAMES[o.tier || 1]}`;
    const text = won
      ? (medal ? `Nouvelle médaille : <b>${TIER_NAMES[medal]}</b> ! Tes créatures ont été formidables.` : 'Bravo ! Tes créatures ont été formidables.')
      : fled ? 'Tu as quitté l’arène. Reviens quand tes créatures seront prêtes !'
        : 'Tes créatures ont besoin de grandir : nourris-les pour les faire évoluer, puis retente ta chance !';
    box.innerHTML = '<div class="bt-strip bt-hazard"></div>' +
      `<h2 class="${won ? '' : 'lose'}">${won ? 'VICTOIRE !' : fled ? 'ABANDON' : 'DÉFAITE…'}</h2>` +
      (sub ? `<p class="bt-sub2">${esc(sub)}</p>` : '') +
      (medal ? `<div class="bt-medal-big m${medal}">${TIER_NAMES[medal].toUpperCase()}</div>` : '') +
      `<p>${text}</p>` + (chips ? `<div class="bt-rew">${chips}</div>` : '') + '<div class="bt-btns"></div>';
    const btns = box.querySelector('.bt-btns');
    const cont = el('button', 'bt-btn-green', 'Continuer');
    cont.onclick = () => {
      sfx('click');
      if (o.custom) { if (typeof o.onContinue === 'function') { try { o.onContinue(won); } catch (e) { /* ignore */ } } BT.close(); return; }
      if (cur) { cur.stage = won && (o.tier || 1) === 1 ? null : o.stage; cur.tier = null; }
      fightMusic = false;
      parkMusic();
      showTournament();
    };
    const back = el('button', 'bt-btn-steel bt-steel', 'Retour au parc');
    back.onclick = () => { sfx('click'); BT.close(); };
    btns.append(cont, back);
    setTimeout(() => { try { cont.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }, 50);
  }

  // ================================================================ fight: lifecycle
  function fightResize(F) {
    const r = F.ui.scr.getBoundingClientRect();
    const W = Math.max(280, Math.round(r.width || window.innerWidth)), HH = Math.max(300, Math.round(r.height || window.innerHeight));
    if (F.L && F.L.W === W && F.L.H === HH) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    F.ui.cv.width = Math.round(W * dpr); F.ui.cv.height = Math.round(HH * dpr);
    F.dpr = dpr;
    F.L = fightLayout(W, HH);
    layoutFighters(F);
    buildArenaBg(F);
    if (!F.cine) Object.assign(F.cam, { x: W / 2, y: HH / 2, z: 1 });
  }
  function buildArenaBg(F) {
    const L = F.L, m = Math.round(Math.max(L.W, L.H) * 0.22);
    let dpr = Math.min(2, window.devicePixelRatio || 1);
    while ((L.W + 2 * m) * (L.H + 2 * m) * dpr * dpr > 12e6 && dpr > 0.75) dpr -= 0.25;
    const c = document.createElement('canvas');
    c.width = Math.ceil((L.W + 2 * m) * dpr); c.height = Math.ceil((L.H + 2 * m) * dpr);
    const g = c.getContext('2d');
    g.scale(dpr, dpr);
    g.translate(m, m);
    let anim = { torches: [], braziers: [], posts: [], lamps: [], vents: [], gateLights: [] };
    try { anim = paintArena(g, F.park, L, m) || anim; } catch (e) {
      console.error('battle arena', e);
      g.fillStyle = '#2a3238'; g.fillRect(-m, -m, L.W + 2 * m, L.H + 2 * m);
    }
    F.bg = c; F.bgM = m; F.anim = anim;
  }
  function startLoop(F) {
    const step = now => {
      if (F.dead) return;
      F.raf = requestAnimationFrame(step);
      const dt = F.last == null ? 0.016 : Math.min(0.05, Math.max(0, (now - F.last) / 1000));
      F.last = now;
      if (!F.paused) update(F, dt * F.timeScale, dt);
      try { render(F); } catch (e) { if (!F.errR) { F.errR = 1; console.error('battle render', e); } }
    };
    F.raf = requestAnimationFrame(step);
  }
  function startFight(opts) {
    if (!root) return;
    stopFight();
    const team = (opts.team || []).filter(d => d && PC.SPECIES[d.species]).slice(0, 3);
    const enemies = (opts.enemies || []).filter(d => d && PC.SPECIES[d.species]).slice(0, 4);
    if (!team.length || !enemies.length) { if (cur) showTournament(); return; }
    root.innerHTML = '';
    const opp = opts.opponent || { name: 'Adversaire', look: {} };
    const F = fight = {
      opts, park: opts.park || 'land', time: 0, rt: 0, timeScale: 1, tweens: [],
      parts: [], rings: [], texts: [], slashes: [], cracks: [], rays: [], jaws: [], arcs: [],
      fxs: { dim: 0, bars: 0, flash: 0, flashCol: '#fff', speed: 0, tint: 0, tintCol: '#ff3b2f' },
      cam: { x: 0, y: 0, z: 1, rot: 0, shake: 0 },
      auto: !!opts.auto, paused: false, phase: 'intro', dead: false, aborted: false, cine: false, modal: null,
      oppName: opp.name || 'Adversaire', oppLook: opp.look || {},
      P: team.map((d, i) => mkFighter('p', d, i)), E: enemies.map((d, i) => mkFighter('e', d, i)), pi: 0, ei: 0,
      medalBefore: opts.custom ? 0 : medalOf(opts.park, opts.stage),
      ui: {},
    };
    F.subTitle = opts.custom ? (opts.title || '') : `Étape ${opts.stage} · ${opts.stageName || ''} · ${TIER_NAMES[opts.tier || 1]}`;
    F.oppImg = document.createElement('canvas');
    F.oppImg.width = 200; F.oppImg.height = 240;
    try { PC.ART.drawNPC(F.oppImg.getContext('2d'), F.oppLook, 0, 0, 200, 240, 1.2); } catch (e) { /* ignore */ }
    F.pImg = PC.ART.portrait(team[0].species, 200, 150, { stage: F.P[0].stage, bg: false });
    buildFightDom(F);
    fightResize(F);
    F.ctx = F.ui.cv.getContext('2d');
    // boss track for the rival, gold-medal fights, the last stage of a park and Alpha opponents
    const boss = opts.boss || opts.tier === 3 || opts.opponentId === 'krane' || (!opts.custom && opts.stage >= stagesOf(F.park).length) || F.E.some(f => f.stage >= 3);
    F.track = boss ? 'battle_boss' : 'battle';
    music(F.track);
    fightMusic = true;
    hud(F);
    startLoop(F);
    runFight(F);
  }
  function stopFight() {
    const F = fight;
    if (!F) return;
    F.dead = true;
    cancelAnimationFrame(F.raf);
    clearTimeout(F.msgT);
    killTweens(F);
    fight = null;
  }
  function parkMusic() {
    const s = engState(), p = (s && s.current) || (cur && cur.park) || 'land';
    let tr = 'park_' + p;
    try { if (PC.UI && typeof PC.UI.parkTrack === 'function') tr = PC.UI.parkTrack(p) || tr; } catch (e) { /* ignore */ }
    music(tr);
  }

  let resizeRaf = 0;
  function onResize() {
    cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(() => {
      if (!root) return;
      if (fight) { fightResize(fight); return; }
      if (cur && cur.wrap && cur.geom && cur.wrap.isConnected) {
        const w = Math.max(280, Math.min(780, cur.wrap.clientWidth || 360));
        if (Math.abs(w - cur.geom.w) > 2) { const st = cur.wrap.scrollTop; buildMap(); cur.wrap.scrollTop = st; }
      }
    });
  }
  function onKey(e) {
    if (!root) return;
    const F = fight;
    if (e.key === 'Escape') {
      e.preventDefault();
      if (!F) { BT.close(); return; }
      if (F.modal) { if (F.modalDismiss) F.modalDismiss(); return; }
      if (F.phase !== 'end') showPause(F);
      return;
    }
    if (!F || !canAct(F) || e.ctrlKey || e.metaKey || e.altKey) return;
    const A = active(F, 'p'), k = e.key.toLowerCase();
    if (k >= '1' && k <= '3') { const m = A.moves[+k - 1]; if (m) { sfx('click'); F.choose({ type: 'move', move: m }); } }
    else if (k === '4' || k === 's') onSpecial(F);
    else if (k === 'c') openSwitch(F);
  }

  // ================================================================ public API
  /** Open the tournament overlay for a park. opts: { stage, tier, onClose } */
  BT.open = function (park, opts) {
    opts = opts || {};
    try {
      injectStyle();
      const s = engState();
      if (!['land', 'sea', 'ice'].includes(park)) park = (s && s.current) || 'land';
      if (!parkUnlocked(park)) park = 'land';
      if (root) { stopFight(); root.remove(); }
      root = el('div', 'bt-root');
      root.setAttribute('role', 'dialog');
      root.setAttribute('aria-label', 'Tournoi');
      document.body.appendChild(root);
      cur = { park, stage: opts.stage || null, tier: opts.tier || null, onClose: opts.onClose || null };
      if (!resizeH) { resizeH = onResize; window.addEventListener('resize', resizeH); }
      if (!keyH) { keyH = onKey; window.addEventListener('keydown', keyH); }
      showTournament();
      return true;
    } catch (e) {
      console.error('battle open', e);
      return false;
    }
  };
  BT.close = function () {
    if (!root) return;
    stopFight();
    const onClose = cur && cur.onClose;
    if (cur) clearTimeout(cur.hintT);
    root.remove();
    root = null; cur = null;
    if (resizeH) { window.removeEventListener('resize', resizeH); resizeH = null; }
    if (keyH) { window.removeEventListener('keydown', keyH); keyH = null; }
    if (fightMusic) { fightMusic = false; parkMusic(); }
    if (onClose) { try { onClose(); } catch (e) { /* ignore */ } }
  };
  BT.isOpen = () => !!root;
  BT.movesFor = movesFor;
  BT.enemiesFor = enemiesFor;
  /**
   * Custom fight (e.g. an online team): { park, team: [{species, level, name}], enemies: [...], opponent: {name, look},
   * title, auto, boss, onEnd(won, {fled}) → reward object to display, onContinue(won) }.
   */
  BT.fight = function (opts) {
    opts = opts || {};
    if (!root) BT.open(opts.park || 'land');
    if (!root) return false;
    startFight(Object.assign({ custom: true }, opts));
    return !!fight;
  };
  /** Test / debug hook: the running fight state (null when no fight). */
  BT._fight = () => fight;
})(window.PC = window.PC || {});
