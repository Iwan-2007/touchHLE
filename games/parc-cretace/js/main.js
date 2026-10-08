/* Crétacé Park — boot and wiring (owned by the ui agent).
   Title screen → PC.ENGINE.init() → PC.ISO.createView(canvas) → setPark → wiring (taps, engine events,
   render loop, ENGINE.tick every 250 ms, resize, save on pagehide, window.claude.hot). */
(function (PC) {
  'use strict';
  const UI = PC.UI || {};
  let view = null, booted = false, loopOn = false;

  const E = () => PC.ENGINE || null;
  function sfx(name, opts) {
    const s = E() && E().state;
    if (s && s.settings && s.settings.sound === false) return;
    try { if (PC.SFX && PC.SFX.play) PC.SFX.play(name, opts); } catch (e) { /* audio optional */ }
  }
  function viewCall(fn, ...a) {
    if (view && typeof view[fn] === 'function') { try { return view[fn](...a); } catch (e) { console.error('view.' + fn, e); } }
    return undefined;
  }
  const center = o => [o.gx + (o.w || 1) / 2, o.gy + (o.h || 1) / 2];
  const RES_COLORS = { coins: '#ffd23a', dollars: '#8fe04a', food_land: '#b4f06a', food_sea: '#7fd0ff', food_ice: '#ffb0a0', xp: '#7fd0ff' };
  const fmt = n => (UI.fmt ? UI.fmt(n) : String(Math.round(n)));

  /** A hot-reload snapshot is usable when it looks like a v2 engine state. */
  function validState(d) {
    const s = d && typeof d === 'object' && d.state && typeof d.state === 'object' ? d.state : d;
    return s && typeof s === 'object' && s.v === 2 && s.player && s.parks ? s : null;
  }

  // ---------------------------------------------------------------------------
  // Engine events → park effects (floats, bursts), sounds and UI popups
  // ---------------------------------------------------------------------------
  function wireEngine() {
    const EN = E();
    if (!EN || typeof EN.on !== 'function') return;
    EN.on('change', () => { if (UI.refresh) UI.refresh(); });
    EN.on('toast', e => { if (UI.toast && e) UI.toast(e.text, e.kind); });
    const pass = name => EN.on(name, e => { if (UI.handleEvent) UI.handleEvent(name, e); });
    ['levelup', 'research', 'researchStart', 'expedition', 'promo', 'mission', 'side', 'feed', 'unlock', 'park', 'sell', 'battle', 'cards', 'offer']
      .forEach(pass);
    EN.on('collect', e => {
      if (!e || !e.obj) return;
      const [x, y] = center(e.obj);
      sfx(e.res === 'coins' || e.res === 'dollars' ? 'coin' : 'food');
      viewCall('addFloat', x, y, '+' + fmt(e.amount), RES_COLORS[e.res] || '#fff', e.res === 'coins' ? 'coin' : e.res);
    });
    EN.on('hatched', e => {
      if (!e || !e.obj) return;
      const [x, y] = center(e.obj);
      sfx('hatch');
      viewCall('addBurst', x, y, 'hatch');
      const sp = (PC.SPECIES || {})[e.obj.speciesId];
      viewCall('addFloat', x, y, 'Éclos !', '#ffe066', 'egg');
      if (UI.toast && sp) UI.toast('Bienvenue ' + (e.obj.name || '') + ' le ' + sp.name + ' !', 'good');
    });
    EN.on('feed', e => {
      if (!e || !e.obj) return;
      const [x, y] = center(e.obj);
      sfx('feed');
      if (e.levelUp) {
        viewCall('addBurst', x, y, e.stageUp ? 'evolve' : 'level');
        viewCall('addFloat', x, y, 'Niv. ' + e.level + ' !', '#ffe066', 'star');
      }
    });
    EN.on('build', e => {
      if (!e || !e.obj) return;
      const [x, y] = center(e.obj);
      sfx('build');
      viewCall('addBurst', x, y, 'build');
    });
    EN.on('buy', e => {
      if (!e || !e.obj) return;
      const [x, y] = center(e.obj);
      sfx('build');
      viewCall('addBurst', x, y, 'stars');
    });
    EN.on('move', e => { if (e && e.obj) { const [x, y] = center(e.obj); viewCall('addBurst', x, y, 'build'); } });
    EN.on('upgrade', e => {
      if (!e || !e.obj) return;
      const [x, y] = center(e.obj);
      viewCall('addBurst', x, y, 'stars');
      viewCall('addFloat', x, y, 'Niv. ' + e.level, '#ffe066', 'star');
    });
    EN.on('activate', e => {
      if (!e || !e.obj) return;
      const [x, y] = center(e.obj);
      sfx('click');
      viewCall('addFloat', x, y, (e.order && e.order.name) || 'Livraison', '#ffffff', 'clock');
    });
    EN.on('speedup', e => { if (e && e.obj) { const [x, y] = center(e.obj); sfx('success'); viewCall('addBurst', x, y, 'stars'); } });
    EN.on('sell', e => {
      if (!e || !e.obj) return;
      const [x, y] = center(e.obj);
      if (e.refund && e.refund.coins) viewCall('addFloat', x, y, '+' + fmt(e.refund.coins), RES_COLORS.coins, 'coin');
    });
    EN.on('levelup', () => { const s = EN.state; if (s) { const c = viewCenter(); viewCall('addBurst', c[0], c[1], 'level'); } });
  }
  function viewCenter() {
    const m = (PC.ISO && PC.ISO.MAP) || 24;
    return [m / 2, m / 2];
  }

  // ---------------------------------------------------------------------------
  // View, render loop, timers
  // ---------------------------------------------------------------------------
  function createView() {
    const canvas = document.getElementById('pc-canvas');
    if (!canvas || !PC.ISO || typeof PC.ISO.createView !== 'function') return null;
    try {
      const v = PC.ISO.createView(canvas);
      const s = E() && E().state;
      if (v && s && typeof v.setPark === 'function') v.setPark(s.current);
      return v;
    } catch (e) { console.error('ISO.createView', e); return null; }
  }
  function loop(ts) {
    if (view && typeof view.render === 'function') {
      try { view.render(ts / 1000); } catch (e) { if (!loop.warned) { loop.warned = true; console.error('view.render', e); } }
    }
    requestAnimationFrame(loop);
  }
  function startLoops() {
    if (loopOn) return;
    loopOn = true;
    requestAnimationFrame(loop);
    setInterval(() => { try { const EN = E(); if (EN && EN.tick) EN.tick(); } catch (e) { console.error('ENGINE.tick', e); } }, 250);
    let rt = 0;
    window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => viewCall('resize'), 60); });
    const save = () => { try { const EN = E(); if (EN && EN.save) EN.save(); } catch (e) { /* storage may be blocked */ } };
    window.addEventListener('pagehide', save);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') save(); });
  }

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------
  function boot(hotState) {
    if (booted) return;
    booted = true;
    const EN = E();
    try { if (EN && EN.init) EN.init(hotState || undefined); } catch (e) { console.error('ENGINE.init', e); }
    view = createView();
    if (UI.setView) UI.setView(view);
    if (view) view.onTap = hit => { if (UI.onTap) UI.onTap(hit); };
    if (UI.init) UI.init();
    wireEngine();
    startLoops();
    const play = () => {
      if (UI.playIntro) UI.playIntro(() => { if (UI.startGame) UI.startGame(); });
      else if (UI.startGame) UI.startGame();
    };
    if (hotState) {
      // Hot reload: straight back into the park.
      if (UI.startGame) UI.startGame();
    } else if (UI.showTitle) UI.showTitle(play);
    else play();
  }

  function start() {
    const hot = window.claude && window.claude.hot;
    if (hot) {
      try { if (typeof hot.snapshot === 'function') hot.snapshot(() => (PC.ENGINE ? PC.ENGINE.state : null)); } catch (e) { /* optional */ }
      if (typeof hot.ready === 'function') {
        let called = false;
        const go = d => { if (called) return; called = true; boot(validState(d)); };
        try {
          const r = hot.ready(go);
          if (r && typeof r.then === 'function') r.then(go, () => go(null));
          else if (r !== undefined) go(r);
        } catch (e) { go(null); }
        setTimeout(() => go(null), 1500);
        return;
      }
      if (hot.data !== undefined) { boot(validState(hot.data)); return; }
    }
    boot(null);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})(window.PC = window.PC || {});
