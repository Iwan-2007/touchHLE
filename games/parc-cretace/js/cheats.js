/* Crétacé Park — secret codes (cheats).
   Entry points: Options → « Code secret », or tap the level badge 5 times quickly.
   Codes are case-insensitive and ignore accents and spaces:
     DINOMAX   everything unlocked (level max, all parks, all DNA researched, every tournament stage won
               with Bronze — Argent / Or still to win —, huge resources, every egg and timer finished,
               the limited-offer creature on sale)
     RICHE     lots of coins, dollars and food
     ECLOSION  finish every egg, delivery, research and expedition right now */
(function (PC) {
  'use strict';

  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/gi, '').toUpperCase();
  const FOODS = ['food_land', 'food_sea', 'food_ice'];

  function engineReady() {
    return PC.ENGINE && PC.ENGINE.state && PC.ENGINE.debug;
  }

  function finishEverything() {
    const E = PC.ENGINE, st = E.state, t = E.now();
    E.debug.finishTimers();
    if (st.research && st.research.result == null) st.research.endsAt = t;
    if (st.expedition && st.expedition.result == null) st.expedition.endsAt = t;
    E.tick();
  }

  function giveRiches() {
    const d = PC.ENGINE.debug;
    d.give('coins', 1000000);
    d.give('dollars', 10000);
    for (const f of FOODS) d.give(f, 100000);
  }

  function unlockEverything() {
    const E = PC.ENGINE, d = E.debug, st = E.state;
    d.setLevel((PC.DATA && PC.DATA.MAX_PLAYER_LEVEL) || 30);
    d.unlockAll();
    d.researchAll();
    d.give('coins', 9999999);
    d.give('dollars', 99999);
    for (const f of FOODS) d.give(f, 999999);
    // Every tournament stage cleared with (at least) Bronze, so every stage and every Argent / Or fight is open.
    // The engine ties the two together (state.battles[p] = highest stage with a medal, rebuilt on load), so
    // the medals are written too: Argent and Or stay to be won.
    const stages = (PC.DATA && PC.DATA.BATTLE_STAGES) || {};
    st.battles = st.battles || {};
    st.medals = st.medals || {};
    for (const p of Object.keys(stages)) {
      const n = stages[p].length;
      st.battles[p] = Math.max(st.battles[p] || 0, n);
      const m = st.medals[p] = st.medals[p] || {};
      for (let s = 1; s <= n; s++) if (!(m[s] >= 1)) m[s] = 1;
    }
    // Put the offer-only creature on sale for a week.
    const offerOnly = Object.keys(PC.SPECIES || {}).find(id => PC.SPECIES[id].offerOnly && !(E.ownsSpecies && E.ownsSpecies(id)));
    if (offerOnly) st.offer = { speciesId: offerOnly, until: E.now() + 7 * 86400000 };
    finishEverything();
    E.save();
  }

  const CODES = {
    DINOMAX: { run: unlockEverything, msg: 'Code DINOMAX : tout est débloqué !' },
    TOUTDEBLOQUER: { run: unlockEverything, msg: 'Tout est débloqué !' },
    RICHE: { run: giveRiches, msg: 'Code RICHE : tu es millionnaire !' },
    ECLOSION: { run: finishEverything, msg: 'Code ÉCLOSION : tous les œufs et minuteurs sont terminés !' },
  };

  /** Apply a code. Returns {ok, msg}. */
  function apply(code) {
    const c = CODES[norm(code)];
    if (!c) return { ok: false, msg: 'Code inconnu…' };
    if (!engineReady()) return { ok: false, msg: 'Lance d’abord une partie.' };
    try { c.run(); } catch (e) { console.error(e); return { ok: false, msg: 'Le code n’a pas marché.' }; }
    if (PC.SFX && PC.SFX.play) { try { PC.SFX.play('levelup'); } catch (e) { /* silent */ } }
    if (PC.UI && PC.UI.refresh) PC.UI.refresh();
    return { ok: true, msg: c.msg };
  }

  function injectStyle() {
    if (document.getElementById('pc-cheat-style')) return;
    const s = document.createElement('style');
    s.id = 'pc-cheat-style';
    s.textContent = `
      .cheat-in { width: 100%; max-width: 320px; height: 52px; border-radius: 12px; border: 2px solid #000;
        box-shadow: 0 0 0 2px #7b858e, inset 0 3px 6px rgba(0,0,0,.6); background: #0b0f12; color: #ffd23a;
        font: 24px 'Russo One', 'Arial Black', sans-serif; letter-spacing: 4px; text-align: center; text-transform: uppercase;
        user-select: text; -webkit-user-select: text; outline: none; }
      .cheat-in:focus { box-shadow: 0 0 0 2px #ffd23a, inset 0 3px 6px rgba(0,0,0,.6); }
      .cheat-msg { min-height: 20px; font: 700 14px 'Exo 2', 'Segoe UI', sans-serif; color: #c3ccd3; }
      .cheat-msg.ok { color: #8fe04a; } .cheat-msg.bad { color: #ff6a55; }`;
    document.head.appendChild(s);
  }

  /** Open the « Code secret » box. */
  function open() {
    if (!PC.UI || !PC.UI.modal) return;
    injectStyle();
    const input = document.createElement('input');
    input.className = 'cheat-in';
    input.id = 'pc-cheat-input';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.maxLength = 20;
    input.placeholder = '• • • • •';
    input.setAttribute('aria-label', 'Code secret');
    const msg = document.createElement('div');
    msg.className = 'cheat-msg';
    msg.textContent = 'Tape un code secret puis valide.';
    let m = null;
    const submit = () => {
      const r = apply(input.value);
      msg.textContent = r.msg;
      msg.className = 'cheat-msg ' + (r.ok ? 'ok' : 'bad');
      if (r.ok) {
        if (PC.UI.toast) PC.UI.toast(r.msg, 'good');
        setTimeout(() => m && m.close(true), 700);
      } else {
        input.select();
      }
      return true; // keep the modal open until the success timeout closes it
    };
    input.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); e.stopPropagation(); });
    m = PC.UI.modal({ title: 'CODE SECRET', body: [msg, input], buttons: [{ label: 'Valider', cls: 'b-yellow', onclick: submit }] });
    setTimeout(() => input.focus(), 60);
  }

  /** Add a « Code secret » row to the Options panel. */
  function patchOptions() {
    const UI = PC.UI;
    if (!UI || !UI.openOptions || UI.openOptions._cheats) return;
    const orig = UI.openOptions;
    UI.openOptions = function () {
      const r = orig.apply(this, arguments);
      try {
        const rows = document.querySelectorAll('#pc-panels .opt-row');
        const last = rows[rows.length - 1];
        if (last && !document.getElementById('pc-cheat-row')) {
          const row = document.createElement('div');
          row.className = 'opt-row';
          row.id = 'pc-cheat-row';
          const img = document.createElement('img');
          img.src = PC.ICONS && PC.ICONS.url ? PC.ICONS.url('dna', 34) : '';
          img.alt = '';
          const label = document.createElement('span');
          label.className = 'ol';
          label.textContent = 'Code secret';
          const btn = document.createElement('button');
          btn.className = 'b b-yellow b-sm';
          btn.textContent = 'Entrer';
          btn.addEventListener('click', () => { if (PC.SFX && PC.SFX.play) PC.SFX.play('click'); open(); });
          row.append(img, label, btn);
          last.parentNode.insertBefore(row, last);
        }
      } catch (e) { console.error(e); }
      return r;
    };
    UI.openOptions._cheats = true;
  }

  // Secret shortcut: 5 quick taps on the level badge.
  let taps = [];
  function onDocPointer(e) {
    // Use the badge's position, not the event target: the first tap may open a panel over it.
    const badge = document.getElementById('pc-lvl');
    if (!badge) return;
    const r = badge.getBoundingClientRect();
    if (!r.width || e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return;
    const t = performance.now();
    taps = taps.filter(x => t - x < 2500);
    taps.push(t);
    if (taps.length >= 5) { taps = []; open(); }
  }

  PC.CHEATS = { apply, open, codes: Object.keys(CODES) };

  if (typeof document !== 'undefined') {
    patchOptions();
    document.addEventListener('pointerdown', onDocPointer, true);
  }
})(window.PC = window.PC || {});
