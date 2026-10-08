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
  const music = t => { try { if (PC.MUSIC && PC.MUSIC.play) PC.MUSIC.play(t); } catch (e) { /* optional */ } };
  const iconUrl = (n, s) => (PC.ICONS && PC.ICONS.url ? PC.ICONS.url(n, s || 24) : '');
  const ENG = () => PC.ENGINE || null;
  const engState = () => (PC.ENGINE && PC.ENGINE.state) || null;

  // ================================================================ rules & data
  const GAUGE_MAX = 100, GAUGE_HIT = 15, GAUGE_MISS = 15, SPECIAL_MULT = 1.8, CRIT = 0.1, CRIT_MULT = 1.5;
  const SPECIAL_COST = { dollars: 2 };
  const TIER_NAMES = ['', 'Bronze', 'Argent', 'Or'];
  const TIER_COLORS = ['', '#d08a4a', '#cfd6dc', '#ffd23a'];
  const TIER_MULT = [0, 1, 1.5, 2.25];   // reward preview only when the engine has no battleReward()

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
    const first = medalOf(park, n) < tier, m = TIER_MULT[tier] || 1, r = {};
    for (const k in st.reward) {
      if (first) r[k] = Math.round(st.reward[k] * m);
      else if (k === 'coins') r[k] = Math.round(st.reward[k] * m * 0.3);
    }
    return r;
  }

  // ================================================================ styles
  const CSS = `
.bt-root{position:fixed;inset:0;z-index:9000;font-family:${FU};color:#eef2f4;background:#0b0f12;overflow:hidden;
  user-select:none;-webkit-user-select:none;touch-action:manipulation;-webkit-tap-highlight-color:transparent;line-height:1.25}
.bt-root *{box-sizing:border-box}
.bt-root button{font:inherit;color:inherit;cursor:pointer;border:0;background:none;padding:0;margin:0}
.bt-root button:focus-visible{outline:3px solid #ffd23a;outline-offset:2px}
.bt-root button:disabled{cursor:default}
.bt-screen{position:absolute;inset:0;display:flex;flex-direction:column;min-height:0}
.bt-hidden{display:none!important}
.bt-steel{background:
  radial-gradient(circle,#f6f8f9 0 1.4px,#59636a 1.9px 2.8px,transparent 3.3px) 5px 5px/9px 9px no-repeat,
  radial-gradient(circle,#f6f8f9 0 1.4px,#59636a 1.9px 2.8px,transparent 3.3px) right 5px top 5px/9px 9px no-repeat,
  radial-gradient(circle,#f6f8f9 0 1.4px,#59636a 1.9px 2.8px,transparent 3.3px) 5px bottom 5px/9px 9px no-repeat,
  radial-gradient(circle,#f6f8f9 0 1.4px,#59636a 1.9px 2.8px,transparent 3.3px) right 5px bottom 5px/9px 9px no-repeat,
  repeating-linear-gradient(90deg,rgba(255,255,255,.06) 0 1px,rgba(0,0,0,.035) 1px 3px),
  linear-gradient(180deg,#e6eaed 0%,#b5bdc3 46%,#959ea5 54%,#cdd3d7 100%);
  border:2px solid #343c42;box-shadow:inset 0 1px 0 rgba(255,255,255,.85),inset 0 -2px 0 rgba(0,0,0,.22),0 4px 10px rgba(0,0,0,.45)}
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
.bt-sp{background:linear-gradient(180deg,#58606a,#2b3036);border-color:#111}
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
  font-weight:800;font-size:15px;white-space:nowrap;z-index:4;pointer-events:none;transition:opacity .3s}
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
        park, stage: st.stage, tier, stageName: st.name, opponent: npc,
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
