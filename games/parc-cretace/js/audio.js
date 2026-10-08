/* Crétacé Park — audio: PC.SFX (sound effects) and PC.MUSIC (adaptive music).
   Everything is synthesised live with the Web Audio API: no audio files, no network.

   Design notes
   - Every sound / instrument is a function (ac, out, t, ...) that builds a small node graph on ANY
     BaseAudioContext, so the exact same code renders into an OfflineAudioContext for tests
     (PC.SFX.render / PC.MUSIC.render).
   - Graph: sfx bus ─┬────────────────────────────┐
                     └ send → sfx reverb ─────────┤
            music players → music bus → duck ─────┼→ compressor → master → soft limiter → out
            music reverb (per-voice sends) → music bus
   - Music = data (chord progressions + note strings, see TRACKS) played by a lookahead step
     sequencer (setInterval 25 ms, notes scheduled on AudioContext time).
   - Never throws: a missing / blocked AudioContext simply means silence. */
(function (PC) {
  'use strict';

  const W = typeof window !== 'undefined' ? window : {};
  const AC = W.AudioContext || W.webkitAudioContext || null;
  const OAC = W.OfflineAudioContext || W.webkitOfflineAudioContext || null;
  const HAS_DOC = typeof document !== 'undefined';

  // ---------- tuning ----------
  const LEVEL = { master: 0.9, sfx: 0.78, music: 0.42, sfxRev: 0.13 };
  const LOOKAHEAD = 0.16;   // seconds of music scheduled ahead
  const TIMER_MS = 25;      // scheduler period
  const XFADE = 1.5;        // cross-fade between looping tracks
  const EPS = 0.0001;

  // ---------- small utils ----------
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const rnd = (a, b) => a + Math.random() * (b - a);
  const noop = () => {};
  const PCS = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const acc = (s) => (s === '#' ? 1 : s === 'b' ? -1 : 0);

  /** 'C#5' → 73, 'Bb3' → 58 (C4 = 60). */
  function noteNum(tok) {
    const m = /^([A-G])([#b]?)(-?\d)$/.exec(tok);
    return m ? 12 * (+m[3] + 1) + PCS[m[1]] + acc(m[2]) : null;
  }

  const QUAL = {
    '': [0, 4, 7], m: [0, 3, 7], 7: [0, 4, 7, 10], m7: [0, 3, 7, 10], maj7: [0, 4, 7, 11],
    sus4: [0, 5, 7], sus2: [0, 2, 7], dim: [0, 3, 6], add9: [0, 4, 7, 14], madd9: [0, 3, 7, 14],
    5: [0, 7], 6: [0, 4, 7, 9], m6: [0, 3, 7, 9], aug: [0, 4, 8], '7sus4': [0, 5, 7, 10],
  };
  /** 'F#m7' / 'Dm/F' → { root, ivs, bass } (pitch classes 0..11, ivs = intervals above root). */
  function parseChord(name) {
    const m = /^([A-G])([#b]?)([^/]*)(?:\/([A-G])([#b]?))?$/.exec(name);
    if (!m) return { name, root: 0, ivs: QUAL[''], bass: 0, _v: {} };
    const root = (PCS[m[1]] + acc(m[2]) + 12) % 12;
    const bass = m[4] ? (PCS[m[4]] + acc(m[5]) + 12) % 12 : root;
    return { name, root, ivs: QUAL[m[3]] || QUAL[''], bass, _v: {} };
  }
  /** Lowest note ≥ base with pitch class pc. */
  const above = (base, pc) => base + (((pc - base) % 12) + 12) % 12;
  /** Close voicing of a chord inside [center-6, center+6). */
  function voicing(ch, center) {
    if (!ch._v[center]) {
      const set = {};
      ch.ivs.forEach((iv) => { set[above(center - 6, (ch.root + iv) % 12)] = 1; });
      ch._v[center] = Object.keys(set).map(Number).sort((a, b) => a - b);
    }
    return ch._v[center];
  }
  /** idx-th chord tone counted upwards from the root placed at/above base. */
  function arpNote(ch, base, idx) {
    const n = ch.ivs.length;
    return above(base, ch.root) + ch.ivs[idx % n] + 12 * Math.floor(idx / n);
  }
  /** Bass rhythm letter → note. R/r root (slash bass honoured), 5 fifth, 8 octave, 3 third, 7 seventh. */
  function bassNote(ch, base, k) {
    const r = above(base, ch.root);
    switch (k) {
      case 'R': case 'r': return above(base, ch.bass);
      case '5': return r + 7;
      case '8': return r + 12;
      case '3': return r + ch.ivs[1];
      case '7': return r + (ch.ivs[3] != null ? ch.ivs[3] : 10);
      default: return r;
    }
  }

  // ---------- per-context resources (noise, reverb impulse, shaper curves) ----------
  const RES = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
  function R(ac) {
    let r = RES && RES.get(ac);
    if (r) return r;
    r = { curves: {} };
    const sr = ac.sampleRate;
    const nb = ac.createBuffer(1, Math.floor(sr * 2), sr);
    const d = nb.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    r.noise = nb;
    r.ir = makeIR(ac, 2.4, 2.6);
    if (RES) RES.set(ac, r);
    return r;
  }
  // Synthetic hall impulse: decaying noise that darkens over time.
  function makeIR(ac, sec, decay) {
    const sr = ac.sampleRate, len = Math.max(1, Math.floor(sr * sec));
    const buf = ac.createBuffer(2, len, sr);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const x = i / len;
        lp += (0.85 - 0.72 * x) * ((Math.random() * 2 - 1) - lp);
        d[i] = lp * Math.pow(1 - x, decay) * (i < sr * 0.012 ? i / (sr * 0.012) : 1);
      }
    }
    return buf;
  }
  function driveCurve(ac, k) {
    const r = R(ac);
    if (!r.curves[k]) {
      const n = 1024, c = new Float32Array(n), norm = Math.tanh(k);
      for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(k * x) / norm; }
      r.curves[k] = c;
    }
    return r.curves[k];
  }
  // Transparent below 0.75, soft knee above, hard ceiling ≈ 0.935 (never reaches 1.0).
  let SOFTCLIP = null;
  function softClip() {
    if (!SOFTCLIP) {
      const n = 2048;
      SOFTCLIP = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const x = (i / (n - 1)) * 2 - 1, ax = Math.abs(x);
        SOFTCLIP[i] = ax < 0.75 ? x : Math.sign(x) * (0.75 + 0.235 * Math.tanh((ax - 0.75) / 0.235));
      }
    }
    return SOFTCLIP;
  }

  // ---------- node helpers ----------
  function gn(ac, v, dest) { const g = ac.createGain(); g.gain.value = v; if (dest) g.connect(dest); return g; }
  function flt(ac, type, f, q, dest) {
    const b = ac.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q == null ? 0.7 : q;
    if (dest) b.connect(dest); return b;
  }
  function osc(ac, type, f, t, stop, dest, det) {
    const o = ac.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t);
    if (det) o.detune.value = det;
    if (dest) o.connect(dest);
    o.start(t); o.stop(stop); return o;
  }
  function noiseSrc(ac, t, dur, dest) {
    const s = ac.createBufferSource(); s.buffer = R(ac).noise; s.loop = true;
    s.connect(dest); s.start(t, Math.random() * 1.8); s.stop(t + dur); return s;
  }
  function shaper(ac, k, dest) {
    const w = ac.createWaveShaper(); w.curve = driveCurve(ac, k); if (dest) w.connect(dest); return w;
  }
  function panner(ac, p, dest) {
    if (!ac.createStereoPanner) return dest;
    const n = ac.createStereoPanner(); n.pan.value = clamp(p, -1, 1); n.connect(dest); return n;
  }

  // ---------- envelopes ----------
  // 0 → v (linear, a) → hold h → ~0 (exponential, d). Returns end time.
  function envAD(p, t, a, v, d, h) {
    v = Math.max(v, 2 * EPS); h = h || 0;
    p.setValueAtTime(0, t);
    p.linearRampToValueAtTime(v, t + a);
    if (h > 0) p.setValueAtTime(v, t + a + h);
    p.exponentialRampToValueAtTime(EPS, t + a + h + d);
    return t + a + h + d;
  }
  // 0 → v (a), hold until t+dur, linear release r. Returns end time.
  function envAHR(p, t, a, v, dur, r) {
    const end = t + Math.max(a, dur);
    p.setValueAtTime(0, t);
    p.linearRampToValueAtTime(v, t + a);
    p.setValueAtTime(v, end);
    p.linearRampToValueAtTime(0, end + r);
    return end + r;
  }
  // Attack, decay to sustain level s·v, note-off at t+dur, linear release r. Returns end time.
  function envADSR(p, t, a, d, s, v, dur, r) {
    const ta = t + a, end = Math.max(t + dur, ta + 0.005), tc = Math.max(d / 3, 0.001);
    p.setValueAtTime(0, t);
    p.linearRampToValueAtTime(v, ta);
    p.setTargetAtTime(v * s, ta, tc);
    p.setValueAtTime(v * s + (v - v * s) * Math.exp(-(end - ta) / tc), end);
    p.linearRampToValueAtTime(0, end + r);
    return end + r;
  }

  // ---------- generic voices used by SFX and drums ----------
  /** Pitched blip: o = {type, f, f2 (glide target), sw (glide time), a, h, d, v, lp, q, det, dest}. */
  function tone(ac, out, t, o) {
    const a = o.a != null ? o.a : 0.003, d = o.d != null ? o.d : 0.2, h = o.h || 0;
    if (o.f >= ac.sampleRate * 0.45) return null;
    const os = ac.createOscillator(); os.type = o.type || 'sine';
    os.frequency.setValueAtTime(o.f, t);
    if (o.f2) os.frequency.exponentialRampToValueAtTime(o.f2, t + (o.sw != null ? o.sw : a + h + d));
    if (o.det) os.detune.value = o.det;
    const g = gn(ac, 0, out);
    if (o.lp) { const f = flt(ac, 'lowpass', o.lp, o.q, g); os.connect(f); } else os.connect(g);
    const end = envAD(g.gain, t, a, o.v != null ? o.v : 0.3, d, h);
    os.start(t); os.stop(end + 0.03);
    return os;
  }
  /** Filtered noise burst: o = {type, f, f2, sw, q, a, h, d, v}. */
  function nz(ac, out, t, o) {
    const a = o.a != null ? o.a : 0.002, d = o.d != null ? o.d : 0.1, h = o.h || 0;
    const f = flt(ac, o.type || 'bandpass', o.f, o.q != null ? o.q : 1);
    if (o.f2) { f.frequency.setValueAtTime(o.f, t); f.frequency.exponentialRampToValueAtTime(o.f2, t + (o.sw != null ? o.sw : a + h + d)); }
    const g = gn(ac, 0, out); f.connect(g);
    const end = envAD(g.gain, t, a, o.v != null ? o.v : 0.3, d, h);
    noiseSrc(ac, t, end - t + 0.03, f);
  }
  /** Random high pentatonic pings. */
  function sparkle(ac, out, t, n, spread, v) {
    const notes = [84, 86, 88, 91, 93, 96, 98, 100];
    for (let i = 0; i < n; i++) {
      const ti = t + Math.random() * spread, f = mtof(notes[(Math.random() * notes.length) | 0]);
      tone(ac, out, ti, { f, a: 0.002, d: rnd(0.12, 0.3), v: v * rnd(0.5, 1) });
      tone(ac, out, ti, { f: f * 2.01, a: 0.001, d: 0.06, v: v * 0.25 });
    }
  }
  /** Little rising "bloop" bubbles. */
  function bubbles(ac, out, t, n, spread, v) {
    for (let i = 0; i < n; i++) {
      const ti = t + Math.random() * spread, f = rnd(320, 900);
      tone(ac, out, ti, { f, f2: f * rnd(1.8, 2.7), sw: rnd(0.04, 0.08), a: 0.004, d: rnd(0.05, 0.09), v: v * rnd(0.5, 1) });
    }
  }
  function chirp(ac, out, t, f1, f2, dur, v) {
    const os = osc(ac, 'sine', f1, t, t + dur + 0.05, null);
    os.frequency.exponentialRampToValueAtTime(f2, t + dur * 0.7);
    os.frequency.exponentialRampToValueAtTime(f2 * 0.85, t + dur);
    const g = gn(ac, 0, out); os.connect(g);
    envAD(g.gain, t, 0.01, v, dur * 0.8, dur * 0.1);
  }
  function fmBell(ac, out, t, f, ratio, idx, idxDecay, dec, v) {
    const end = t + dec + 0.05;
    const car = osc(ac, 'sine', f, t, end, null), mod = osc(ac, 'sine', f * ratio, t, end, null);
    const mg = gn(ac, 0); mod.connect(mg); mg.connect(car.frequency);
    mg.gain.setValueAtTime(f * ratio * idx, t);
    mg.gain.exponentialRampToValueAtTime(Math.max(f * ratio * idx * 0.02, 0.01), t + idxDecay);
    const g = gn(ac, 0, out); car.connect(g);
    envAD(g.gain, t, 0.002, v, dec);
  }

  // ---------- music instruments: fn(ac, out, t, midi | [midi], dur, vel, voiceDef) ----------
  const INST = {
    marimba(ac, out, t, m, dur, v) {
      const f = mtof(m), dec = clamp(1.5 - (m - 55) * 0.03, 0.35, 1.5);
      tone(ac, out, t, { f, a: 0.002, d: dec, v: v * 0.62 });
      tone(ac, out, t, { f: f * 3.93, a: 0.001, d: dec * 0.15, v: v * 0.2 });
      tone(ac, out, t, { f: f * 10.2, a: 0.0008, d: 0.022, v: v * 0.05 });
    },
    kalimba(ac, out, t, m, dur, v) {
      const f = mtof(m);
      tone(ac, out, t, { f, a: 0.002, d: 1.1, v: v * 0.55 });
      tone(ac, out, t, { type: 'triangle', f: f * 2, a: 0.002, d: 0.22, v: v * 0.1 });
      tone(ac, out, t, { f: f * 6.15, a: 0.001, d: 0.05, v: v * 0.16 });
    },
    celesta(ac, out, t, m, dur, v) { fmBell(ac, out, t, mtof(m), 4, 0.45, 0.5, 2.2, v * 0.42); },
    glass(ac, out, t, m, dur, v) {
      const f = mtof(m);
      fmBell(ac, out, t, f, 7, 0.25, 0.25, 3.0, v * 0.36);
      tone(ac, out, t, { f: f * 2, a: 0.002, d: 0.9, v: v * 0.08 });
    },
    bell(ac, out, t, m, dur, v) { fmBell(ac, out, t, mtof(m), 3.5, 0.8, 1.2, 3.2, v * 0.38); },
    pad(ac, out, t, ms, dur, v, o) {
      const lp = flt(ac, 'lowpass', (o && o.cut) || 900, 0.5), g = gn(ac, 0, out); lp.connect(g);
      const end = envAHR(g.gain, t, (o && o.attack) || 0.6, v * 0.42 / Math.sqrt(ms.length), dur, (o && o.release) || 0.9);
      ms.forEach((m) => { osc(ac, 'sawtooth', mtof(m), t, end + 0.03, lp, -9); osc(ac, 'sawtooth', mtof(m), t, end + 0.03, lp, 9); });
    },
    softpad(ac, out, t, ms, dur, v, o) {
      const lp = flt(ac, 'lowpass', (o && o.cut) || 1500, 0.4), g = gn(ac, 0, out); lp.connect(g);
      const end = envAHR(g.gain, t, (o && o.attack) || 1.2, v * 0.6 / Math.sqrt(ms.length), dur, (o && o.release) || 1.6);
      const lfo = osc(ac, 'sine', 0.35, t, end, null), lg = gn(ac, 450); lfo.connect(lg); lg.connect(lp.frequency);
      ms.forEach((m) => { osc(ac, 'triangle', mtof(m), t, end + 0.03, lp, -6); osc(ac, 'sawtooth', mtof(m), t, end + 0.03, lp, 7); });
    },
    strings(ac, out, t, ms, dur, v, o) {
      const lp = flt(ac, 'lowpass', (o && o.cut) || 2400, 0.6), hp = flt(ac, 'highpass', 170, 0.7);
      const g = gn(ac, 0, out); lp.connect(hp); hp.connect(g);
      const end = envAHR(g.gain, t, (o && o.attack) || 0.35, v * 0.4 / Math.sqrt(ms.length), dur, (o && o.release) || 0.7);
      const lfo = osc(ac, 'sine', 5.3, t, end, null), lg = gn(ac, 9); lfo.connect(lg);
      ms.forEach((m) => {
        [-7, 6].forEach((det) => { const os = osc(ac, 'sawtooth', mtof(m), t, end + 0.03, lp, det); lg.connect(os.detune); });
      });
    },
    stacc(ac, out, t, m, dur, v) {
      const f = mtof(m), lp = flt(ac, 'lowpass', Math.min(f * 6, 4000), 0.8), g = gn(ac, 0, out); lp.connect(g);
      const end = envAD(g.gain, t, 0.006, v * 0.32, Math.min(0.16, dur + 0.05));
      osc(ac, 'sawtooth', f, t, end + 0.03, lp, -6); osc(ac, 'sawtooth', f, t, end + 0.03, lp, 6);
    },
    choir(ac, out, t, ms, dur, v) {
      const g = gn(ac, 0, out), sum = gn(ac, 1);
      const end = envAHR(g.gain, t, 0.55, v * 1.6 / Math.sqrt(ms.length), dur, 1.0);
      [[650, 5, 1], [1080, 7, 0.55], [2600, 9, 0.2]].forEach((fm) => {
        const b = flt(ac, 'bandpass', fm[0], fm[1]); sum.connect(b); b.connect(gn(ac, fm[2], g));
      });
      const lfo = osc(ac, 'sine', 4.8, t, end, null), lg = gn(ac, 13); lfo.connect(lg);
      ms.forEach((m) => {
        [-11, 10].forEach((det) => { const os = osc(ac, 'sawtooth', mtof(m), t, end + 0.03, sum, det); lg.connect(os.detune); });
      });
    },
    brass(ac, out, t, m, dur, v, o) { brassVoice(ac, out, t, m, dur, v, 1, 0.025); },
    horn(ac, out, t, m, dur, v) { brassVoice(ac, out, t, m, dur, v, 0.55, 0.06); },
    lowbrass(ac, out, t, m, dur, v) { brassVoice(ac, out, t, m, dur, v * 1.2, 0.7, 0.04); },
    lead(ac, out, t, m, dur, v) {   // soft flute / ocarina
      const f = mtof(m), g = gn(ac, 0, out);
      const end = envADSR(g.gain, t, 0.07, 0.2, 0.85, v * 0.36, dur, 0.25);
      const vib = osc(ac, 'sine', 5, t, end, null), vg = gn(ac, 0); vib.connect(vg);
      vg.gain.setValueAtTime(0, t); vg.gain.linearRampToValueAtTime(14, t + 0.45);
      const o1 = osc(ac, 'sine', f, t, end + 0.03, g); vg.connect(o1.detune);
      const o2 = osc(ac, 'triangle', f * 2, t, end + 0.03, gn(ac, 0.12, g)); vg.connect(o2.detune);
      noiseSrc(ac, t, end - t, flt(ac, 'bandpass', f * 2, 2.5, gn(ac, 0.05, g)));
    },
    oboe(ac, out, t, m, dur, v) {   // reedy sad lead
      const f = mtof(m), g = gn(ac, 0, out);
      const bp = flt(ac, 'bandpass', f * 3, 0.9, gn(ac, 1.4, g));
      const end = envADSR(g.gain, t, 0.06, 0.25, 0.8, v * 0.4, dur, 0.3);
      const vib = osc(ac, 'sine', 4.6, t, end, null), vg = gn(ac, 0); vib.connect(vg);
      vg.gain.setValueAtTime(0, t); vg.gain.linearRampToValueAtTime(16, t + 0.5);
      const os = osc(ac, 'sawtooth', f, t, end + 0.03, bp); vg.connect(os.detune);
      osc(ac, 'sine', f, t, end + 0.03, gn(ac, 0.25, g));
    },
    pluckbass(ac, out, t, m, dur, v) {
      const f = mtof(m), g = gn(ac, 0, out), lp = flt(ac, 'lowpass', f * 6, 1.2, g);
      lp.frequency.setValueAtTime(f * 7, t); lp.frequency.exponentialRampToValueAtTime(f * 2, t + 0.22);
      const end = envAD(g.gain, t, 0.004, v * 0.7, Math.min(0.65, dur + 0.25));
      osc(ac, 'triangle', f, t, end + 0.03, lp); osc(ac, 'sine', f, t, end + 0.03, gn(ac, 0.6, g));
    },
    synbass(ac, out, t, m, dur, v) {
      const f = mtof(m), g = gn(ac, 0, out), lp = flt(ac, 'lowpass', f * 8, 5, g);
      lp.frequency.setValueAtTime(f * 10, t); lp.frequency.exponentialRampToValueAtTime(f * 2.4, t + 0.14);
      const end = envADSR(g.gain, t, 0.004, 0.12, 0.6, v * 0.42, dur, 0.04);
      osc(ac, 'sawtooth', f, t, end + 0.03, lp); osc(ac, 'square', f, t, end + 0.03, gn(ac, 0.45, lp), 5);
    },
    distbass(ac, out, t, m, dur, v) {
      const f = mtof(m), g = gn(ac, 0, out), lp = flt(ac, 'lowpass', 1700, 1, g), ws = shaper(ac, 3, lp);
      const pre = flt(ac, 'lowpass', f * 9, 4, ws);
      pre.frequency.setValueAtTime(f * 12, t); pre.frequency.exponentialRampToValueAtTime(f * 3, t + 0.16);
      const end = envADSR(g.gain, t, 0.004, 0.12, 0.65, v * 0.36, dur, 0.04);
      osc(ac, 'sawtooth', f, t, end + 0.03, pre); osc(ac, 'sine', f / 2, t, end + 0.03, gn(ac, 0.8, g));
    },
    subbass(ac, out, t, m, dur, v) {
      const f = mtof(m), g = gn(ac, 0, out);
      const end = envADSR(g.gain, t, 0.05, 0.3, 0.85, v * 0.62, dur, 0.35);
      osc(ac, 'sine', f, t, end + 0.03, g); osc(ac, 'triangle', f * 2, t, end + 0.03, gn(ac, 0.1, g));
    },
    timpani(ac, out, t, m, dur, v) {
      const f = mtof(m);
      tone(ac, out, t, { f: f * 1.04, f2: f, sw: 0.1, a: 0.003, d: 1.3, v: v * 0.62 });
      tone(ac, out, t, { f: f * 1.505, a: 0.003, d: 0.45, v: v * 0.18 });
      nz(ac, out, t, { type: 'lowpass', f: 500, q: 0.7, d: 0.07, v: v * 0.35 });
    },
  };
  ['pad', 'softpad', 'strings', 'choir'].forEach((k) => { INST[k].poly = true; });

  function brassVoice(ac, out, t, m, dur, v, bright, att) {
    const f = mtof(m), g = gn(ac, 0, out), lp = flt(ac, 'lowpass', f, 1.4, g);
    lp.frequency.setValueAtTime(f * 1.2, t);
    lp.frequency.linearRampToValueAtTime(Math.min(f * 7 * bright, 12000), t + att + 0.02);
    lp.frequency.exponentialRampToValueAtTime(Math.min(f * 3.2 * bright, 9000), t + att + 0.28);
    const end = envADSR(g.gain, t, att, 0.25, 0.72, v * 0.4, dur, 0.12);
    [-6, 6].forEach((det) => {
      const os = osc(ac, 'sawtooth', f * 0.965, t, end + 0.03, lp, det);
      os.frequency.exponentialRampToValueAtTime(f, t + 0.05);   // little lip "scoop"
    });
  }

  // ---------- drums: fn(ac, out, t, vel) ----------
  const DRUM = {
    kick(ac, out, t, v) {
      tone(ac, out, t, { f: 150, f2: 42, sw: 0.13, a: 0.002, d: 0.32, v: v * 0.9 });
      nz(ac, out, t, { type: 'highpass', f: 2500, d: 0.012, v: v * 0.22 });
    },
    kick2(ac, out, t, v) {
      tone(ac, out, t, { f: 125, f2: 38, sw: 0.1, a: 0.002, d: 0.26, v: v * 0.95 });
      tone(ac, out, t, { type: 'triangle', f: 320, f2: 80, sw: 0.04, a: 0.001, d: 0.04, v: v * 0.3 });
    },
    snare(ac, out, t, v) {
      nz(ac, out, t, { type: 'highpass', f: 1200, q: 0.7, d: 0.16, v: v * 0.5 });
      nz(ac, out, t, { type: 'bandpass', f: 3500, q: 0.8, d: 0.08, v: v * 0.22 });
      tone(ac, out, t, { type: 'triangle', f: 210, f2: 170, sw: 0.05, d: 0.07, v: v * 0.35 });
    },
    clap(ac, out, t, v) {
      for (let i = 0; i < 3; i++) nz(ac, out, t + i * 0.011, { f: 1500, q: 1.2, d: i === 2 ? 0.14 : 0.012, v: v * 0.45 });
    },
    hat(ac, out, t, v) { nz(ac, out, t, { type: 'highpass', f: 7500, q: 0.8, d: 0.035, v: v * 0.28 }); },
    ohat(ac, out, t, v) { nz(ac, out, t, { type: 'highpass', f: 7000, q: 0.8, d: 0.22, v: v * 0.22 }); },
    shaker(ac, out, t, v) { nz(ac, out, t, { f: 6500, q: 1.2, a: 0.012, d: 0.05, v: v * 0.3 }); },
    congaLo(ac, out, t, v) {
      tone(ac, out, t, { f: 200, f2: 168, sw: 0.03, a: 0.002, d: 0.22, v: v * 0.5 });
      nz(ac, out, t, { f: 2200, q: 1, d: 0.01, v: v * 0.15 });
    },
    congaHi(ac, out, t, v) {
      tone(ac, out, t, { f: 300, f2: 262, sw: 0.03, a: 0.002, d: 0.15, v: v * 0.45 });
      nz(ac, out, t, { f: 3000, q: 1, d: 0.008, v: v * 0.15 });
    },
    block(ac, out, t, v) {
      tone(ac, out, t, { f: 1650, a: 0.001, d: 0.05, v: v * 0.26 });
      tone(ac, out, t, { f: 2470, a: 0.001, d: 0.025, v: v * 0.1 });
    },
    tomLo(ac, out, t, v) {
      tone(ac, out, t, { f: 115, f2: 80, sw: 0.25, a: 0.002, d: 0.35, v: v * 0.6 });
      nz(ac, out, t, { type: 'lowpass', f: 1500, d: 0.05, v: v * 0.2 });
    },
    tomHi(ac, out, t, v) {
      tone(ac, out, t, { f: 175, f2: 125, sw: 0.2, a: 0.002, d: 0.28, v: v * 0.55 });
      nz(ac, out, t, { type: 'lowpass', f: 2200, d: 0.04, v: v * 0.2 });
    },
    taiko(ac, out, t, v) {
      tone(ac, out, t, { f: 95, f2: 48, sw: 0.25, a: 0.002, d: 0.75, v: v * 0.85 });
      tone(ac, out, t, { type: 'triangle', f: 72, f2: 50, sw: 0.2, a: 0.002, d: 0.4, v: v * 0.3 });
      nz(ac, out, t, { type: 'lowpass', f: 700, d: 0.12, v: v * 0.45 });
    },
    crash(ac, out, t, v) {
      nz(ac, out, t, { type: 'highpass', f: 4500, q: 0.5, a: 0.002, d: 1.6, v: v * 0.3 });
      nz(ac, out, t, { f: 9000, q: 1, d: 0.9, v: v * 0.14 });
    },
  };
  const DV = { x: 0.8, X: 1.1, o: 0.42, O: 0.8 };

  // ---------- ambience helpers for tracks ----------
  function wind(ac, out, t, dur, v) {
    const bp = flt(ac, 'bandpass', 420, 0.9), g = gn(ac, 0, out); bp.connect(g);
    bp.frequency.setValueAtTime(380, t);
    bp.frequency.linearRampToValueAtTime(rnd(700, 1000), t + dur * 0.5);
    bp.frequency.linearRampToValueAtTime(450, t + dur);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + dur * 0.5); g.gain.linearRampToValueAtTime(0, t + dur);
    noiseSrc(ac, t, dur + 0.05, bp);
  }
  function whale(ac, out, t, v) {
    const f = rnd(200, 260), os = osc(ac, 'sine', f, t, t + 3.2, null);
    os.frequency.linearRampToValueAtTime(f * 1.5, t + 1.2);
    os.frequency.linearRampToValueAtTime(f * 0.85, t + 3);
    const vib = osc(ac, 'sine', 3.5, t, t + 3.2, null), vg = gn(ac, 18); vib.connect(vg); vg.connect(os.detune);
    const lp = flt(ac, 'lowpass', 700, 1), g = gn(ac, 0, out); os.connect(lp); lp.connect(g);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + 0.8); g.gain.linearRampToValueAtTime(v * 0.7, t + 2.2); g.gain.linearRampToValueAtTime(0, t + 3.1);
  }
  function riser(ac, out, t, dur, v) {
    const bp = flt(ac, 'bandpass', 400, 1.6), g = gn(ac, 0, out); bp.connect(g);
    bp.frequency.setValueAtTime(400, t); bp.frequency.exponentialRampToValueAtTime(6000, t + dur);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + dur * 0.97); g.gain.linearRampToValueAtTime(0, t + dur);
    noiseSrc(ac, t, dur + 0.05, bp);
    const lp = flt(ac, 'lowpass', 1800, 1), g2 = gn(ac, 0, out); lp.connect(g2);
    const os = osc(ac, 'sawtooth', 160, t, t + dur + 0.05, lp); os.frequency.exponentialRampToValueAtTime(900, t + dur);
    g2.gain.setValueAtTime(0, t); g2.gain.linearRampToValueAtTime(v * 0.3, t + dur * 0.97); g2.gain.linearRampToValueAtTime(0, t + dur);
  }
  const ICE_TWINKLE = [88, 91, 93, 95, 98, 100];   // E minor pentatonic, very high
  const FX = {
    sea(pl, c, out) {
      if (c.s % 4 === 0 && Math.random() < 0.25) bubbles(pl.ac, out, c.t + Math.random() * c.sd * 3, 2 + ((Math.random() * 4) | 0), 0.5, 0.2);
      if (c.bar === 0 && c.s === 0 && pl.secIdx % 2 === 1 && Math.random() < 0.7) whale(pl.ac, out, c.t + 0.4, 0.22);
    },
    ice(pl, c, out) {
      if (c.s === 0 && c.bar % 2 === 0 && Math.random() < 0.65) wind(pl.ac, out, c.t, c.sd * 30, 0.32);
      if (c.s % 2 === 0 && Math.random() < 0.05) {
        const m = ICE_TWINKLE[(Math.random() * ICE_TWINKLE.length) | 0];
        fmBell(pl.ac, out, c.t, mtof(m), 7, 0.2, 0.2, 1.4, 0.07);
      }
    },
    battle(pl, c, out) {
      if (c.sec.riser && c.lastBar && c.s === 0) riser(pl.ac, out, c.t, c.sd * 16, 0.22);
    },
    victory(pl, c, out) {
      const ac = pl.ac;
      if (c.bar === 1 && c.s >= 8) DRUM.snare(ac, out, c.t, 0.25 + (c.s - 8) * 0.06);   // snare roll into the last chord
      if (c.bar === 2 && c.s === 0) {
        DRUM.crash(ac, out, c.t, 1.1); DRUM.taiko(ac, out, c.t, 1);
        INST.timpani(ac, out, c.t, 36, 1, 0.9);
        sparkle(ac, out, c.t + 0.05, 10, 1.2, 0.09);
        [72, 76, 79, 84, 88].forEach((m, i) => INST.celesta(ac, out, c.t + 0.05 + i * 0.07, m, 0.5, 0.45));
      }
    },
  };

  // ---------- tracks (original compositions) ----------
  // Notes: melody strings are tokens of `res` 16th-steps each (default 2 = eighth notes):
  //   'C5' starts a note, '-' holds the previous one, '.' is a rest, 'C5+E5' is a dyad, '|' is ignored.
  // Chords: one entry per 4/4 bar; 'F G' splits the bar in two. Bass rhythm letters: see bassNote().
  // Drum strings: one char per 16th; x normal, X accent, o ghost, O open hat. Each section is 4 bars;
  // the order loops, and voices vary with the loop pass (inst / pattern arrays, `passes`, `mel2`).
  const TRACKS = {
    title: {   // epic adventure theme — D minor with a heroic major lift
      bpm: 100, loop: true, rev: 0.32,
      order: ['A', 'A2', 'B', 'B2'],
      sections: {
        A:  { chords: ['Dm', 'Bb', 'F', 'C'],  mel: 'D5 - - A4 D5 - E5 F5 | F5 - - - E5 - D5 - | C5 - - - A4 - C5 - | G4 - - - - - . .' },
        A2: { chords: ['Dm', 'Bb', 'C', 'A'],  mel: 'D5 - - A4 D5 - E5 F5 | G5 - - - F5 - D5 - | E5 - - - G5 - - E5 | A5 - - - - - . .' },
        B:  { chords: ['Bb', 'C', 'F', 'Dm'],  mel: 'F5 - - - D5 - F5 - | G5 - - - E5 - G5 - | A5 - - - - - C6 - | A5 - G5 - F5 - E5 -' },
        B2: { chords: ['Bb', 'C', 'D', 'D'],   mel: 'F5 - - - D5 - F5 - | G5 - - - A5 - Bb5 - | A5 - - - - - - - | F#5 - - - D5 - . .', fill: true },
      },
      voices: [
        { id: 'lead', kind: 'mel', inst: 'brass', vel: 0.5, pan: 0.05 },
        { id: 'horn', kind: 'mel', inst: 'horn', vel: 0.32, oct: -12, pan: -0.2, only: ['B', 'B2'] },
        { id: 'ost', kind: 'arp', inst: 'stacc', res: 1, base: 50, vel: 0.36, pan: -0.3,
          pat: [[0, -1, 0, 1, 0, -1, 0, 2], [0, 0, 1, 0, 2, 0, 1, 2]] },
        { id: 'str', kind: 'chord', inst: 'strings', center: 62, vel: 0.3, pan: 0.25 },
        { id: 'choir', kind: 'chord', inst: 'choir', center: 67, vel: 0.22, only: ['B', 'B2'] },
        { id: 'bass', kind: 'bass', inst: 'lowbrass', base: 33, rhythm: 'R-------R---5---', vel: 0.34 },
        { id: 'timp', kind: 'bass', inst: 'timpani', base: 38, rhythm: 'R.......R.R.....', vel: 0.5, rev: 0.45 },
        { id: 'dr', kind: 'drums', vel: 0.6, crash: true, sets: {
          main: { taiko: 'X.....x.x...x...', tomLo: '..........o...x.',
                  fill: { taiko: 'X.....x.x.x.X.X.', tomLo: '........x.x.xxxx', tomHi: '....x.x.x.x.xxxx' } } } },
      ],
    },

    park_land: {   // warm jungle adventure — F major, marimba & kalimba
      bpm: 104, swing: 0.12, loop: true, rev: 0.22,
      order: ['A', 'A2', 'B', 'B2'],
      sections: {
        A:  { chords: ['F', 'Am', 'Bb', 'C'],  mel: 'F5 - C5 A4 C5 - D5 C5 | A4 - - . E5 - C5 A4 | D5 - Bb4 F4 Bb4 - C5 D5 | E5 - C5 - G4 - . .',
              mel2: 'F5 - C5 A4 C5 - D5 C5 | A4 - - . E5 - C5 A4 | D5 - Bb4 F4 Bb4 - C5 D5 | E5 - G5 - C6 - . .' },
        A2: { chords: ['F', 'Am', 'Bb', 'C'],  mel: 'F5 - C5 A4 C5 - D5 C5 | A4 - - . E5 - G5 E5 | F5 - D5 - Bb4 D5 C5 Bb4 | G4 A4 Bb4 C5 E5 - - .' },
        B:  { chords: ['Dm', 'Bb', 'F', 'C'],  mel: 'D5 - - E5 F5 - E5 D5 | D5 - C5 - Bb4 - . F4 | A4 - C5 - F5 - E5 F5 | G5 - - - E5 - C5 -', drum: 'b' },
        B2: { chords: ['Gm', 'Bb', 'C', 'C'],  mel: 'Bb4 - D5 - G5 - F5 D5 | F5 - D5 - Bb4 - C5 D5 | E5 - - G5 - - C5 - | E5 F5 G5 - - - . .', drum: 'b', fill: true },
      },
      voices: [
        { id: 'mel', kind: 'mel', inst: ['marimba', 'kalimba'], vel: 0.62, pan: -0.12, rev: 0.25 },
        { id: 'flute', kind: 'chord', inst: 'lead', top: true, center: 74, vel: 0.2, passes: [1], only: ['B', 'B2'], pan: 0.3 },
        { id: 'arp', kind: 'arp', inst: ['kalimba', 'marimba'], res: 2, base: 60, vel: 0.3, pan: 0.32,
          pat: [[-1, 2, -1, 1, -1, 2, 0, 1], [-1, 1, 2, -1, 3, -1, 2, 1]] },
        { id: 'pad', kind: 'chord', inst: 'pad', center: 57, vel: 0.22, cut: 850 },
        { id: 'bass', kind: 'bass', inst: 'pluckbass', base: 36, rhythm: 'R..R..5.R...5.8.', vel: 0.5 },
        { id: 'dr', kind: 'drums', vel: 0.5, rev: 0.12, sets: {
          main: { kick: 'x.....x...x.....', shaker: 'xoxoxoxoxoxoxoxo', congaLo: '..x.....o.x.....', congaHi: '....x.......x..x', block: '...x......x.....' },
          b: { kick: 'x.......x.......', shaker: 'xoxoxoxoxoxoxoxo', congaLo: 'x.....x.x.....x.', congaHi: '..x.x.....x.x.x.', block: '...x......x.....',
               fill: { congaHi: '..x.x.x.xxxxxxxx', congaLo: 'x.....x.x.x.x.x.', block: '' } } } },
      ],
    },

    park_sea: {   // calm underwater — D major 7ths, slow pads, bell arpeggios, bubbles, distant whales
      bpm: 72, loop: true, rev: 0.5,
      order: ['A', 'B', 'A2', 'C'],
      sections: {
        A:  { chords: ['Dmaj7', 'Gmaj7', 'Bm7', 'A'],      mel: 'A5 - - - F#5 - E5 - | D5 - - - - - B4 - | D5 - E5 - F#5 - - A5 | E5 - - - - - . .' },
        B:  { chords: ['Em7', 'Gmaj7', 'Dmaj7', 'Asus4'],  mel: 'B4 - D5 - G5 - F#5 - | F#5 - - - D5 - - - | E5 - F#5 - A5 - - - | . . . . . . . .' },
        A2: { chords: ['Dmaj7', 'Gmaj7', 'Bm7', 'A'],      mel: 'A5 - - - F#5 - E5 - | D5 - - - B5 - A5 - | F#5 - - - E5 - D5 - | C#5 - - - - - . .' },
        C:  { chords: ['Gmaj7', 'Em7', 'Dmaj7', 'Asus4 A'], mel: '. . . . . . . . | . . . . . . . . | . . . . . . . . | . . . . . . . .' },
      },
      voices: [
        { id: 'lead', kind: 'mel', inst: 'lead', vel: 0.5, pan: -0.15, rev: 0.55, del: 0.18 },
        { id: 'bells', kind: 'arp', inst: 'celesta', res: 2, base: 72, vel: 0.3, pan: 0.32, del: 0.32, rev: 0.5,
          pat: [[0, 1, 2, 3, 4, 3, 2, 1], [4, 2, 3, 1, 2, 0, 1, 2], [0, 2, 4, 6, 5, 3, 2, 1]] },
        { id: 'pad', kind: 'chord', inst: 'softpad', center: 57, vel: 0.3, rev: 0.6 },
        { id: 'bass', kind: 'bass', inst: 'subbass', base: 38, rhythm: 'R-------5-------', vel: 0.42, rev: 0.1 },
        { id: 'fx', kind: 'fx', fn: FX.sea, vel: 0.55, rev: 0.6, del: 0.25 },
      ],
    },

    park_ice: {   // glassy bells, slow strings, sparse — E minor, wind gusts and ice twinkles
      bpm: 66, loop: true, rev: 0.55,
      order: ['A', 'B', 'A2', 'B2'],
      sections: {
        A:  { chords: ['Emadd9', 'Cmaj7', 'Am7', 'Bsus4 B'], mel: 'E5 - - - B5 - - - | G5 - - - F#5 - E5 - | C6 - - - B5 - A5 - | F#5 - - - - - - -' },
        B:  { chords: ['Em', 'G', 'D', 'Cmaj7'],             mel: 'G5 - - - - - F#5 - | D5 - - - - - . . | A5 - - - F#5 - D5 - | E5 - - - - - . .' },
        A2: { chords: ['Emadd9', 'Cmaj7', 'Am7', 'Bsus4 B'], mel: 'E5 - - - B5 - - - | G5 - - - B5 - C6 - | E6 - - - D6 - C6 - | B5 - - - - - . .' },
        B2: { chords: ['Am7', 'Cmaj7', 'Bsus4', 'B'],        mel: 'C6 - - - B5 - A5 - | G5 - - - E5 - - - | F#5 - - - E5 - - - | D#5 - - - - - . .' },
      },
      voices: [
        { id: 'mel', kind: 'mel', inst: ['celesta', 'glass'], vel: 0.55, pan: 0.1, del: 0.28, rev: 0.6 },
        { id: 'str', kind: 'chord', inst: 'strings', center: 55, vel: 0.3, attack: 1.4, release: 1.6, cut: 1800, rev: 0.6 },
        { id: 'glass', kind: 'arp', inst: 'glass', res: 4, base: 76, vel: 0.22, pan: 0.38, del: 0.4,
          pat: [[-1, 2, -1, 1], [0, -1, -1, 3], [-1, -1, 2, -1]] },
        { id: 'bass', kind: 'bass', inst: 'subbass', base: 36, rhythm: 'R---------------', vel: 0.4, rev: 0.1 },
        { id: 'fx', kind: 'fx', fn: FX.ice, vel: 0.5, rev: 0.7 },
      ],
    },

    battle: {   // energetic — E minor, driving drums, bass ostinato, brass stabs, rising C→D→Eb→F build
      bpm: 140, loop: true, rev: 0.14,
      order: ['A', 'A2', 'B', 'C'],
      sections: {
        A:  { chords: ['Em', 'Em', 'C', 'D'],  mel: 'E5 - . E5 G5 - B5 - | A5 - G5 - F#5 - E5 - | G5 - . G5 E5 - C5 - | D5 - F#5 - A5 - - -' },
        A2: { chords: ['Em', 'Em', 'C', 'B'],  mel: 'E5 - . E5 G5 - B5 - | C6 - B5 - A5 - G5 - | E5 - . E5 G5 - C6 - | B5 - - - D#5 - F#5 -' },
        B:  { chords: ['Am', 'Em', 'Am', 'B'], mel: 'A4 - C5 - E5 - . . | B4 - E5 - G5 - . . | C5 - E5 - A5 - G5 - | F#5 - - - D#5 - B4 -', drum: 'half' },
        C:  { chords: ['C', 'D', 'Eb', 'F'],   mel: 'G5 - - - - - - - | A5 - - - - - - - | Bb5 - - - - - - - | C6 - - - A5 - B5 -',
              drum: 'build', ramp: true, riser: true },
      },
      voices: [
        { id: 'lead', kind: 'mel', inst: 'brass', vel: 0.48 },
        { id: 'lead2', kind: 'mel', inst: 'horn', vel: 0.26, oct: -12, pan: -0.25, passes: [1] },
        { id: 'stab', kind: 'chord', inst: 'brass', center: 62, rhythm: 'x-.x-.x-....x-..', vel: 0.17, pan: 0.25, mute: ['C'] },
        { id: 'str', kind: 'arp', inst: 'stacc', res: 1, base: 52, pat: [0, 1, 2, 1], vel: 0.26, pan: -0.3, only: ['B', 'C'] },
        { id: 'bass', kind: 'bass', inst: 'synbass', base: 36, rhythm: 'R.RRR.RRR.RR8.58', vel: 0.48, rev: 0.03 },
        { id: 'dr', kind: 'drums', vel: 0.62, rev: 0.08, crash: true, sets: {
          main: { kick: 'X.....x.x.x.....', snare: '....X.......X...', hat: 'xoxoxoxoxoxoxoOo',
                  fill: { snare: '....X.....x.XxXX', tomHi: '........x.x.....', tomLo: '............x.x.' } },
          half: { kick: 'X.......x.x.....', snare: '........X.......', hat: 'x.x.x.x.x.x.x.x.', tomLo: '..............x.',
                  fill: { snare: '........X...xxxx', tomHi: '....x.x.........' } },
          build: { kick: 'x...x...x...x...', snare: 'x.x.x.x.x.x.x.x.', hat: 'x.x.x.x.x.x.x.x.',
                   fill: { snare: 'xxxxxxxxxxxxxxxx', kick: 'x.x.x.x.x.x.x.x.', hat: '' } } } },
        { id: 'fx', kind: 'fx', fn: FX.battle, vel: 0.5, rev: 0.3 },
      ],
    },

    battle_boss: null,   // built below as a heavier, faster variant of `battle`

    victory: {   // short fanfare, no loop
      bpm: 126, loop: false, tail: 2.2, rev: 0.3, res: 1,
      order: ['V'],
      sections: {
        V: { chords: ['C', 'F G', 'C'],
             mel: 'G4 . G4 . G4 . C5 - - - - - E5 - G5 - | A5 - - - F5 - A5 - B5 - - - G5 - B5 - | C6 - - - - - - - - - - - - - - -' },
      },
      voices: [
        { id: 'lead', kind: 'mel', inst: 'brass', vel: 0.55 },
        { id: 'lead2', kind: 'mel', inst: 'horn', vel: 0.3, oct: -12, pan: -0.2 },
        { id: 'str', kind: 'chord', inst: 'strings', center: 60, vel: 0.3, pan: 0.2 },
        { id: 'final', kind: 'chord', inst: 'brass', center: 64, rhythm: 'X---------------', vel: 0.26, bars: [2] },
        { id: 'bass', kind: 'bass', inst: 'lowbrass', base: 36, rhythm: 'R-------R-------', vel: 0.36 },
        { id: 'fx', kind: 'fx', fn: FX.victory, vel: 0.55, rev: 0.35 },
      ],
    },

    defeat: {   // short sad cadence, no loop — A minor, i – iv6 – V – i
      bpm: 84, loop: false, tail: 2.6, rev: 0.4,
      order: ['D'],
      sections: {
        D: { chords: ['Am', 'Dm/F E', 'Am'], mel: 'E5 - - - D5 - C5 - | D5 - - - B4 - G#4 - | A4 - - - - - - -' },
      },
      voices: [
        { id: 'lead', kind: 'mel', inst: 'oboe', vel: 0.55 },
        { id: 'str', kind: 'chord', inst: 'strings', center: 57, vel: 0.3, attack: 0.5 },
        { id: 'bass', kind: 'bass', inst: 'subbass', base: 33, rhythm: 'R-------R-------', vel: 0.42 },
        { id: 'timp', kind: 'bass', inst: 'timpani', base: 33, rhythm: 'R...............', vel: 0.32, bars: [0, 2] },
      ],
    },
  };

  // Boss battle: same skeleton, faster, Phrygian menace section, distorted bass, choir, double kick.
  (function () {
    const b = TRACKS.battle;
    TRACKS.battle_boss = {
      bpm: 158, loop: true, rev: 0.16,
      order: ['X', 'A', 'X2', 'A2', 'C'],
      sections: {
        X:  { chords: ['Em', 'F', 'Em', 'F'], drum: 'main',
              mel: 'E5 - - B4 E5 - F5 - | G5 - F5 - E5 - . . | E5 - - B4 E5 - F5 - | A5 - G5 - F5 - . .' },
        X2: { chords: ['Em', 'F', 'C', 'B'], drum: 'main',
              mel: 'E5 - - B4 E5 - F5 - | A5 - G5 - F5 - . . | G5 - - E5 G5 - C6 - | B5 - - - - - . .' },
        A: b.sections.A, A2: b.sections.A2, C: b.sections.C,
      },
      voices: [
        { id: 'lead', kind: 'mel', inst: 'brass', vel: 0.48 },
        { id: 'lead2', kind: 'mel', inst: 'horn', vel: 0.3, oct: -12, pan: -0.25 },
        { id: 'choir', kind: 'chord', inst: 'choir', center: 64, vel: 0.2 },
        { id: 'stab', kind: 'chord', inst: 'brass', center: 58, rhythm: 'X-.x-.x-..x-x-..', vel: 0.17, pan: 0.25, mute: ['C'] },
        { id: 'str', kind: 'arp', inst: 'stacc', res: 1, base: 52, pat: [0, 1, 0, 2, 0, 1, 0, 3], vel: 0.24, pan: -0.3 },
        { id: 'bass', kind: 'bass', inst: 'distbass', base: 36, rhythm: 'RRR.RRR.RR8.RR5.', vel: 0.48, rev: 0.03 },
        { id: 'dr', kind: 'drums', vel: 0.62, rev: 0.08, crash: true, sets: {
          main: { kick2: 'X.x.x.x.X.x.x.x.', snare: '....X.......X...', hat: 'xxxxxxxxxxxxxxOx', clap: '....x.......x...',
                  fill: { snare: '....X...x.xxXXXX', tomHi: '........x.x.x...', tomLo: '..........x.x.xx' } },
          build: { kick2: 'x.x.x.x.x.x.x.x.', snare: 'x.x.x.x.x.x.x.x.', hat: 'x.x.x.x.x.x.x.x.',
                   fill: { snare: 'xxxxxxxxxxxxxxxx', kick2: 'xxxxxxxxxxxxxxxx', hat: '' } } } },
        { id: 'fx', kind: 'fx', fn: FX.battle, vel: 0.5, rev: 0.3 },
      ],
    };
  })();

  const TRACK_ALIAS = { land: 'park_land', sea: 'park_sea', ice: 'park_ice', boss: 'battle_boss', intro: 'title', win: 'victory', lose: 'defeat' };

  // Pre-parse note strings and chord charts (once, at load; pure data, no DOM).
  function parseLine(str, res, bars) {
    const out = [];
    for (let b = 0; b < bars; b++) out.push({});
    let pos = 0, last = null;
    str.replace(/\|/g, ' ').trim().split(/\s+/).forEach((tk) => {
      if (tk === '-') { if (last) last.len += res; }
      else if (tk === '.') last = null;
      else {
        const ms = tk.split('+').map(noteNum).filter((m) => m != null);
        const bar = Math.floor(pos / 16);
        if (ms.length && bar < bars) { last = { ms, len: res }; out[bar][pos % 16] = last; } else last = null;
      }
      pos += res;
    });
    out.steps = pos;
    return out;
  }
  function prepTrack(tr) {
    tr.sd = 60 / tr.bpm / 4;
    Object.keys(tr.sections).forEach((name) => {
      const sec = tr.sections[name];
      if (sec._prepped) return;
      sec._prepped = true; sec.name = sec.name || name; sec.bars = sec.chords.length;
      sec.cm = sec.chords.map((str) => {
        const parts = str.trim().split(/\s+/), len = 16 / parts.length, arr = [];
        parts.forEach((p, i) => { const ch = parseChord(p); ch.start = i * len; ch.len = len; for (let k = 0; k < len; k++) arr.push(ch); });
        return arr;
      });
      sec.lines = {};
      ['mel', 'mel2'].forEach((k) => { if (sec[k]) sec.lines[k] = parseLine(sec[k], sec.res || tr.res || 2, sec.bars); });
    });
    tr.voices.forEach((v) => {
      if (v.kind === 'drums') Object.keys(v.sets).forEach((k) => {
        const s = v.sets[k];
        s._fill = Object.assign({}, s, s.fill || {}); delete s._fill.fill; delete s._fill._fill;
      });
    });
  }
  Object.keys(TRACKS).forEach((k) => prepTrack(TRACKS[k]));

  // ---------- sequencer ----------
  const pick = (x, pass) => (Array.isArray(x) ? x[pass % x.length] : x);
  const jit = (r) => r * rnd(0.9, 1.05);
  function playInst(name, ac, out, t, ms, dur, vel, v) {
    const fn = INST[name];
    if (!fn) return;
    if (fn.poly) fn(ac, out, t, ms, dur, vel, v);
    else for (let i = 0; i < ms.length; i++) fn(ac, out, t, ms[i], dur, vel, v);
  }
  const VOICE = {
    mel(pl, v, c, out) {
      const L = c.sec.lines, key = v.line || 'mel';
      const line = (c.pass % 2 === 1 && L[key + '2']) || L[key];
      const ev = line && line[c.bar][c.s];
      if (!ev) return;
      const oct = pick(v.oct || 0, c.pass);
      playInst(pick(v.inst, c.pass), pl.ac, out, c.t, ev.ms.map((m) => m + oct), ev.len * c.sd * (v.legato || 0.92), jit(c.ramp), v);
    },
    chord(pl, v, c, out) {
      let dur, vel = 1;
      if (v.rhythm) {
        const k = v.rhythm[c.s];
        if (k !== 'x' && k !== 'X') return;
        let n = 1; while (v.rhythm[c.s + n] === '-') n++;
        dur = n * c.sd; vel = k === 'X' ? 1.2 : 0.95;
      } else {
        if (c.chord.start !== c.s) return;
        dur = c.chord.len * c.sd;
      }
      let ms = voicing(c.chord, v.center || 60);
      if (v.top) ms = [ms[ms.length - 1]];
      playInst(pick(v.inst, c.pass), pl.ac, out, c.t, ms, dur, jit(c.ramp) * vel, v);
    },
    arp(pl, v, c, out) {
      const res = v.res || 2;
      if (c.s % res) return;
      const pat = Array.isArray(v.pat[0]) ? v.pat[c.pass % v.pat.length] : v.pat;
      const idx = pat[(c.s / res + c.bar * (16 / res)) % pat.length];
      if (idx == null || idx < 0) return;
      const m = arpNote(c.chord, v.base || 60, idx);
      playInst(pick(v.inst, c.pass), pl.ac, out, c.t, [m], (v.len || res) * c.sd, jit(c.ramp) * (c.s % 4 === 0 ? 1 : 0.85), v);
    },
    bass(pl, v, c, out) {
      const k = v.rhythm[c.s];
      if (!k || k === '.' || k === '-') return;
      let n = 1; while (v.rhythm[c.s + n] === '-') n++;
      playInst(pick(v.inst, c.pass), pl.ac, out, c.t, [bassNote(c.chord, v.base || 36, k)], n * c.sd * 0.9, jit(c.ramp) * (k === 'r' ? 0.7 : 1), v);
    },
    drums(pl, v, c, out) {
      const set = v.sets[c.sec.drum || 'main'] || v.sets.main;
      const fill = c.lastBar && set.fill && c.sec.fill !== false && (c.sec.fill || c.lastSec || c.pass % 2 === 1);
      const pat = fill ? set._fill : set;
      if (v.crash && c.bar === 0 && c.s === 0 && !c.sec.noCrash) DRUM.crash(pl.ac, out, c.t, 0.85);
      for (const part in pat) {
        if (part === 'fill' || part === '_fill') continue;
        const k = pat[part][c.s], vel = DV[k];
        if (!vel) continue;
        const fn = k === 'O' && part === 'hat' ? DRUM.ohat : DRUM[part];
        if (fn) fn(pl.ac, out, c.t, vel * c.ramp * rnd(0.88, 1.05));
      }
    },
    fx(pl, v, c, out) { v.fn(pl, c, out); },
  };

  /** One playing instance of a track, rendering into graph G (live or offline). */
  function Player(G, name, t0, fadeIn) {
    const ac = G.ac, tr = TRACKS[name];
    this.G = G; this.ac = ac; this.name = name; this.tr = tr; this.sd = tr.sd;
    const lvl = tr.gain || 1;
    this.fader = gn(ac, 0, G.music);
    this.wet = gn(ac, 0, G.musicRev);
    [this.fader, this.wet].forEach((g) => {
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(lvl, t0 + Math.max(0.02, fadeIn));
    });
    this.nodes = [this.fader, this.wet];
    this.dly = null;
    if (tr.voices.some((v) => v.del)) {   // shared dotted-eighth echo for bells
      const d = ac.createDelay(2), fb = gn(ac, 0.36), lp = flt(ac, 'lowpass', 2800, 0.5);
      d.delayTime.value = tr.sd * 3;
      d.connect(lp); lp.connect(fb); fb.connect(d); d.connect(this.fader);
      this.dly = d; this.nodes.push(d, fb, lp);
    }
    this.ch = tr.voices.map((v) => {
      const g = gn(ac, v.vel != null ? v.vel : 0.5);
      const o = v.pan ? panner(ac, v.pan, this.fader) : (g.connect(this.fader), g);
      if (o !== g) g.connect(o);
      const rv = v.rev != null ? v.rev : tr.rev || 0;
      if (rv > 0) { const s = gn(ac, rv, this.wet); o.connect(s); }
      if (v.del && this.dly) { const s = gn(ac, v.del, this.dly); o.connect(s); }
      this.nodes.push(g, o);
      return g;
    });
    this.secIdx = 0; this.bar = 0; this.s = 0; this.pass = 0;
    this.next = t0; this.ended = false; this.endTime = Infinity; this.stopAt = Infinity;
  }
  Player.prototype.curSec = function () { return this.tr.sections[this.tr.order[this.secIdx]]; };
  Player.prototype.advance = function () {
    this.next += this.sd;
    if (++this.s < 16) return;
    this.s = 0;
    if (++this.bar < this.curSec().bars) return;
    this.bar = 0;
    if (++this.secIdx < this.tr.order.length) return;
    this.secIdx = 0; this.pass++;
    if (!this.tr.loop) { this.ended = true; this.endTime = this.next + (this.tr.tail || 2); }
  };
  Player.prototype.step = function (t) {
    const tr = this.tr, sec = this.curSec(), s = this.s, bar = this.bar;
    const c = {
      t: t + (s % 2 ? (tr.swing || 0) * this.sd : 0), s, bar, sec, pass: this.pass, sd: this.sd,
      chord: sec.cm[bar][s], lastBar: bar === sec.bars - 1, lastSec: this.secIdx === tr.order.length - 1,
      ramp: sec.ramp ? 0.72 + 0.45 * (bar * 16 + s) / (sec.bars * 16) : 1,
    };
    for (let i = 0; i < tr.voices.length; i++) {
      const v = tr.voices[i];
      if (v.only && v.only.indexOf(sec.name) < 0) continue;
      if (v.mute && v.mute.indexOf(sec.name) >= 0) continue;
      if (v.passes && v.passes.indexOf(this.pass % (v.passMod || 2)) < 0) continue;
      if (v.bars && v.bars.indexOf(bar) < 0) continue;
      try { VOICE[v.kind](this, v, c, this.ch[i]); } catch (e) { /* one bad note must not stop the music */ }
    }
  };
  Player.prototype.scheduleUntil = function (until) {
    let guard = 0;
    while (!this.ended && this.next < until && this.next < this.stopAt && guard++ < 4096) {
      this.step(this.next);
      this.advance();
    }
  };
  Player.prototype.fadeOut = function (dur) {
    const now = this.ac.currentTime;
    [this.fader, this.wet].forEach((g) => {
      try {
        const v = g.gain.value;
        g.gain.cancelScheduledValues(now);
        g.gain.setValueAtTime(v, now);
        g.gain.linearRampToValueAtTime(0, now + dur);
      } catch (e) { /* ignore */ }
    });
    this.stopAt = Math.min(this.stopAt, now + dur);
    this.fading = true;
  };
  Player.prototype.dispose = function () {
    this.nodes.forEach((n) => { try { n.disconnect(); } catch (e) { /* ignore */ } });
    this.nodes = [];
  };

  // ---------- master graph (works on AudioContext and OfflineAudioContext) ----------
  function buildGraph(ac, opts) {
    opts = opts || {};
    const G = { ac };
    G.comp = ac.createDynamicsCompressor();
    G.comp.threshold.value = -16; G.comp.knee.value = 10; G.comp.ratio.value = 3.5;
    G.comp.attack.value = 0.006; G.comp.release.value = 0.22;
    G.master = gn(ac, LEVEL.master);
    G.comp.connect(G.master);
    if (opts.noLimiter) G.master.connect(ac.destination);
    else {
      G.limiter = ac.createWaveShaper(); G.limiter.curve = softClip();
      G.master.connect(G.limiter); G.limiter.connect(ac.destination);
    }
    const ir = R(ac).ir;
    // sound effects + a touch of hall reverb
    G.sfx = gn(ac, LEVEL.sfx, G.comp);
    G.sfxRev = ac.createConvolver(); G.sfxRev.buffer = ir; G.sfxRev.connect(G.comp);
    G.sfx.connect(gn(ac, LEVEL.sfxRev, G.sfxRev));
    // music bus → duck → master; the music reverb sits inside the music bus
    G.duck = gn(ac, 1, G.comp);
    G.music = gn(ac, LEVEL.music, G.duck);
    G.musicRev = ac.createConvolver(); G.musicRev.buffer = ir; G.musicRev.connect(G.music);
    return G;
  }

  // =====================================================================
  //                         SOUND EFFECTS LIBRARY
  //   fn(ac, out, t, opts) → approximate duration in seconds
  // =====================================================================
  function knock(ac, out, t, v, f) {
    tone(ac, out, t, { f: f || 220, f2: (f || 220) * 0.5, sw: 0.08, a: 0.002, d: 0.12, v: v });
    nz(ac, out, t, { f: 900, q: 1.5, d: 0.05, v: v * 0.7 });
  }
  function crack(ac, out, t, v) {
    nz(ac, out, t, { type: 'highpass', f: 2500, q: 1, d: 0.025, v });
    tone(ac, out, t, { type: 'square', f: 1400, a: 0.001, d: 0.012, v: v * 0.15 });
  }
  function boom(ac, out, t, v, f0, f1, d) {
    const ws = shaper(ac, 2, gn(ac, 1, out));
    tone(ac, ws, t, { f: f0 || 90, f2: f1 || 30, sw: (d || 0.8) * 0.6, a: 0.003, d: d || 0.8, v });
  }
  function whoosh(ac, out, t, dur, f0, f1, v, q) {
    nz(ac, out, t, { f: f0, f2: f1, sw: dur, q: q || 1.2, a: dur * 0.6, d: dur * 0.4, v });
  }
  function slash(ac, out, t, v) {
    nz(ac, out, t, { f: 4200, f2: 900, sw: 0.09, q: 2, a: 0.012, d: 0.08, v });
    tone(ac, out, t, { type: 'sawtooth', f: 3200, f2: 1400, sw: 0.06, a: 0.002, d: 0.05, v: v * 0.06 });
  }
  function clang(ac, out, t, v) {
    fmBell(ac, out, t, 640, 2.76, 1.2, 0.3, 0.9, v);
    fmBell(ac, out, t, 1210, 1.41, 0.8, 0.2, 0.5, v * 0.6);
    nz(ac, out, t, { type: 'highpass', f: 3000, d: 0.05, v: v * 0.8 });
  }
  function rumble(ac, out, t, dur, v) {
    nz(ac, out, t, { type: 'lowpass', f: 180, q: 0.5, a: 0.02, d: dur, v });
  }
  function debris(ac, out, t, n, spread, v) {
    for (let i = 0; i < n; i++) nz(ac, out, t + Math.random() * spread, { f: rnd(1500, 3500), q: 2, d: 0.03, v: v * rnd(0.5, 1) });
  }
  function arpUp(ac, out, t, notes, gap, v, type, d) {
    notes.forEach((m, i) => {
      tone(ac, out, t + i * gap, { type: type || 'triangle', f: mtof(m), a: 0.003, d: d || 0.3, v });
      tone(ac, out, t + i * gap, { f: mtof(m + 12), a: 0.002, d: (d || 0.3) * 0.6, v: v * 0.3 });
    });
  }
  /** Synth creature roar: detuned saws + sub square, growl AM, distortion, mouth formant, breath noise. */
  function roarCore(ac, out, t, o) {
    const p = o.pitch || 1, L = o.L, f = o.f * p, end = t + L;
    const env = gn(ac, 0, out);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.75 * o.v, t + 0.1 * L);
    env.gain.linearRampToValueAtTime(o.v, t + 0.42 * L);
    env.gain.linearRampToValueAtTime(0.85 * o.v, t + 0.72 * L);
    env.gain.exponentialRampToValueAtTime(0.001, end);
    // mouth: lowpass opening then closing + a vowel formant in parallel
    const lp = flt(ac, 'lowpass', 600, 1, env);
    lp.frequency.setValueAtTime(500, t); lp.frequency.linearRampToValueAtTime(o.open, t + 0.35 * L); lp.frequency.linearRampToValueAtTime(700, end);
    const form = flt(ac, 'bandpass', 600, 2.2, gn(ac, 0.7, env));
    form.frequency.setValueAtTime(380, t); form.frequency.linearRampToValueAtTime(820, t + 0.4 * L); form.frequency.linearRampToValueAtTime(450, end);
    const drive = shaper(ac, o.drive, gn(ac, 0.5));
    drive.connect(lp); drive.connect(form);
    // growl amplitude modulation
    const am = gn(ac, 0.62, drive);
    const lfo = osc(ac, 'sine', o.am, t, end + 0.05, null), lg = gn(ac, 0.38); lfo.connect(lg); lg.connect(am.gain);
    lfo.frequency.linearRampToValueAtTime(o.am * 0.7, end);
    // pitch contour + rough vibrato
    const vib = osc(ac, 'sine', 6.5, t, end + 0.05, null), vg = gn(ac, 35); vib.connect(vg);
    const srcs = [['sawtooth', 1, 0, 0.55], ['sawtooth', 1.007, 8, 0.45], ['square', 0.5, 0, 0.4], ['sawtooth', 2.98, 0, 0.12]];
    srcs.forEach((s) => {
      const os = osc(ac, s[0], f * 0.8 * s[1], t, end + 0.05, gn(ac, s[3], am), s[2]);
      os.frequency.linearRampToValueAtTime(f * 1.3 * s[1], t + 0.3 * L);
      os.frequency.linearRampToValueAtTime(f * 1.1 * s[1], t + 0.7 * L);
      os.frequency.linearRampToValueAtTime(f * 0.7 * s[1], end);
      vg.connect(os.detune);
    });
    // breath: gritty (through the distortion) + airy (clean)
    noiseSrc(ac, t, L + 0.05, flt(ac, 'bandpass', 700, 0.7, gn(ac, 0.55, am)));
    const air = flt(ac, 'bandpass', 1300, 0.6, gn(ac, 0.22, env));
    air.frequency.setValueAtTime(900, t); air.frequency.linearRampToValueAtTime(2200, t + 0.4 * L); air.frequency.linearRampToValueAtTime(800, end);
    noiseSrc(ac, t, L + 0.05, air);
  }

  const RANK = (r) => { const order = PC.RARITY_ORDER || ['commun', 'rare', 'super', 'legendaire', 'mythique']; return Math.max(0, order.indexOf(r)); };

  const S = {
    click(ac, out, t) {
      tone(ac, out, t, { f: 1250, f2: 820, sw: 0.04, a: 0.001, d: 0.05, v: 0.32 });
      nz(ac, out, t, { type: 'highpass', f: 4000, d: 0.008, v: 0.12 });
      return 0.08;
    },
    coin(ac, out, t) {
      tone(ac, out, t, { type: 'square', f: 987.8, a: 0.002, d: 0.07, v: 0.14, lp: 6000 });
      tone(ac, out, t + 0.075, { type: 'square', f: 1318.5, a: 0.002, d: 0.34, v: 0.14, lp: 6000 });
      tone(ac, out, t + 0.075, { f: 2637, a: 0.002, d: 0.25, v: 0.12 });
      return 0.45;
    },
    food(ac, out, t) {
      tone(ac, out, t, { f: 300, f2: 620, sw: 0.08, a: 0.004, d: 0.12, v: 0.42 });
      nz(ac, out, t + 0.02, { f: 2500, q: 1.2, d: 0.06, v: 0.4 });
      nz(ac, out, t + 0.1, { f: 1700, q: 1.2, d: 0.07, v: 0.34 });
      tone(ac, out, t + 0.12, { type: 'triangle', f: 880, f2: 1320, sw: 0.1, a: 0.004, d: 0.16, v: 0.16 });
      return 0.35;
    },
    build(ac, out, t) {
      for (let i = 0; i < 3; i++) knock(ac, out, t + i * 0.14, 0.5 + i * 0.08, 230 - i * 20);
      debris(ac, out, t + 0.05, 5, 0.35, 0.12);
      arpUp(ac, out, t + 0.48, [72, 76, 79, 84], 0.06, 0.18, 'triangle', 0.45);
      sparkle(ac, out, t + 0.6, 5, 0.4, 0.07);
      return 1.1;
    },
    hatch(ac, out, t) {
      crack(ac, out, t, 0.45); crack(ac, out, t + 0.17, 0.55); crack(ac, out, t + 0.3, 0.7);
      nz(ac, out, t + 0.42, { type: 'lowpass', f: 1400, d: 0.12, v: 0.35 });
      knock(ac, out, t + 0.42, 0.25, 300);
      chirp(ac, out, t + 0.56, 900, 1700, 0.13, 0.28);
      chirp(ac, out, t + 0.74, 1000, 2000, 0.17, 0.3);
      sparkle(ac, out, t + 0.5, 7, 0.7, 0.08);
      return 1.35;
    },
    levelup(ac, out, t) {
      [60, 64, 67, 72, 76, 79, 84].forEach((m, i) => {
        tone(ac, out, t + i * 0.065, { type: 'square', f: mtof(m), a: 0.002, d: 0.22, v: 0.07, lp: 3500 });
        tone(ac, out, t + i * 0.065, { type: 'triangle', f: mtof(m), a: 0.002, d: 0.3, v: 0.16 });
      });
      [72, 76, 79, 84].forEach((m) => {
        tone(ac, out, t + 0.5, { type: 'triangle', f: mtof(m), a: 0.01, h: 0.2, d: 0.9, v: 0.1 });
        tone(ac, out, t + 0.5, { f: mtof(m + 12), a: 0.01, d: 0.6, v: 0.04 });
      });
      sparkle(ac, out, t + 0.45, 8, 0.8, 0.08);
      return 1.7;
    },
    research(ac, out, t) {
      [1200, 1600, 1400, 2000, 1800, 1500, 2200, 1700, 1900, 2400].forEach((f, i) => {
        tone(ac, out, t + i * 0.07, { type: 'square', f, a: 0.001, d: 0.04, v: 0.06, lp: 6000 });
      });
      tone(ac, out, t, { type: 'sawtooth', f: 110, f2: 220, sw: 0.8, a: 0.15, d: 0.7, v: 0.14, lp: 700 });
      tone(ac, out, t, { f: 440, f2: 880, sw: 0.8, a: 0.2, d: 0.6, v: 0.05 });
      return 1.0;
    },
    success(ac, out, t) {
      [67, 72, 76].forEach((m, i) => tone(ac, out, t + i * 0.09, { type: 'triangle', f: mtof(m), a: 0.003, d: 0.25, v: 0.22 }));
      [72, 76, 79, 84].forEach((m) => tone(ac, out, t + 0.28, { type: 'triangle', f: mtof(m), a: 0.008, h: 0.15, d: 0.7, v: 0.11 }));
      tone(ac, out, t + 0.28, { type: 'square', f: mtof(84), a: 0.004, d: 0.5, v: 0.04, lp: 4000 });
      sparkle(ac, out, t + 0.3, 7, 0.6, 0.08);
      return 1.2;
    },
    fail(ac, out, t) {
      [[64, 0, 0.25], [63, 0.28, 0.25], [62, 0.56, 0.7]].forEach((n, i) => {
        const ti = t + n[1], f = mtof(n[0]), lp = flt(ac, 'lowpass', 400, 4), g = gn(ac, 0, out); lp.connect(g);
        lp.frequency.setValueAtTime(350, ti); lp.frequency.linearRampToValueAtTime(1600, ti + 0.08); lp.frequency.linearRampToValueAtTime(400, ti + n[2]);
        const end = envAHR(g.gain, ti, 0.02, 0.2, n[2], 0.08);
        const os = osc(ac, 'sawtooth', f, ti, end + 0.03, lp);
        if (i === 2) os.frequency.linearRampToValueAtTime(f * 0.94, end);
        osc(ac, 'sawtooth', f, ti, end + 0.03, lp, 10);
      });
      return 1.4;
    },
    roar(ac, out, t, o) {
      roarCore(ac, out, t, { pitch: o.pitch, L: 1.5 * (o.len || 1), f: 92, v: 0.95, drive: 3.5, am: 31, open: 2300 });
      boom(ac, out, t, 0.45, 75, 38, 0.5);
      rumble(ac, out, t + 0.1, 1.1, 0.25);
      return 1.6 * (o.len || 1);
    },
    roar_small(ac, out, t, o) {
      roarCore(ac, out, t, { pitch: o.pitch, L: 0.7 * (o.len || 1), f: 190, v: 0.7, drive: 2, am: 38, open: 3200 });
      return 0.75 * (o.len || 1);
    },
    hit(ac, out, t, o) {
      const p = o.power != null ? clamp(o.power, 0, 1) : 0.6, v = 0.7 + 0.3 * p;
      tone(ac, out, t, { f: 160, f2: 45, sw: 0.15, a: 0.002, d: 0.22, v: v * 0.75 });
      nz(ac, out, t, { type: 'lowpass', f: 2600, f2: 600, sw: 0.1, d: 0.12, v: v * 0.55 });
      nz(ac, out, t, { f: 1200, q: 0.8, d: 0.04, v: v * 0.3 });
      return 0.35;
    },
    crit(ac, out, t) {
      tone(ac, out, t, { f: 180, f2: 40, sw: 0.2, a: 0.002, d: 0.3, v: 0.8 });
      nz(ac, out, t, { type: 'lowpass', f: 4000, f2: 500, sw: 0.15, d: 0.18, v: 0.6 });
      crack(ac, out, t, 0.6);
      fmBell(ac, out, t + 0.01, 1250, 2.76, 1, 0.25, 0.5, 0.22);
      sparkle(ac, out, t + 0.03, 5, 0.25, 0.08);
      return 0.6;
    },
    special(ac, out, t, o) {
      // charge-up (0 → 0.82 s): rising filtered noise, rising tone with tremolo
      whoosh(ac, out, t, 0.82, 200, 3800, 0.42, 2);
      const lp = flt(ac, 'lowpass', 1200, 2), g = gn(ac, 0, out), trem = gn(ac, 0.7, g); lp.connect(trem);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.16, t + 0.8); g.gain.linearRampToValueAtTime(0, t + 0.86);
      const lfo = osc(ac, 'sine', 9, t, t + 0.9, null), lgn = gn(ac, 0.3); lfo.connect(lgn); lgn.connect(trem.gain);
      lfo.frequency.linearRampToValueAtTime(24, t + 0.82);
      const os = osc(ac, 'sawtooth', 180, t, t + 0.9, lp); os.frequency.exponentialRampToValueAtTime(900, t + 0.82);
      // impact
      const ti = t + 0.85;
      boom(ac, out, ti, 0.85, 95, 28, 0.9);
      nz(ac, out, ti, { type: 'lowpass', f: 3500, f2: 300, sw: 0.5, d: 0.55, v: 0.6 });
      crack(ac, out, ti, 0.5);
      if (o.cls === 'chasseur') { slash(ac, out, ti - 0.06, 0.45); slash(ac, out, ti + 0.02, 0.4); slash(ac, out, ti + 0.1, 0.35); }
      else if (o.cls === 'colosse') { rumble(ac, out, ti, 1.2, 0.5); debris(ac, out, ti + 0.05, 8, 0.7, 0.15); }
      else if (o.cls === 'blinde') clang(ac, out, ti, 0.3);
      else sparkle(ac, out, ti, 6, 0.4, 0.08);
      return 1.9;
    },
    bite(ac, out, t) {
      nz(ac, out, t, { f: 600, q: 1, a: 0.05, d: 0.1, v: 0.18 });
      const ti = t + 0.11;
      crack(ac, out, ti, 0.7); crack(ac, out, ti + 0.018, 0.5);
      nz(ac, out, ti + 0.01, { f: 1200, q: 0.7, d: 0.1, v: 0.4 });
      tone(ac, out, ti, { f: 210, f2: 60, sw: 0.1, a: 0.002, d: 0.13, v: 0.55 });
      return 0.4;
    },
    claw(ac, out, t) {
      for (let i = 0; i < 3; i++) slash(ac, out, t + i * 0.065, 0.45 - i * 0.05);
      return 0.4;
    },
    charge(ac, out, t) {
      [0, 0.16, 0.29, 0.39, 0.47].forEach((d, i) => {
        tone(ac, out, t + d, { f: 115, f2: 50, sw: 0.1, a: 0.002, d: 0.12, v: 0.35 + i * 0.05 });
        nz(ac, out, t + d, { type: 'lowpass', f: 450, d: 0.06, v: 0.22 });
      });
      whoosh(ac, out, t + 0.2, 0.42, 300, 2200, 0.32);
      tone(ac, out, t + 0.63, { f: 120, f2: 40, sw: 0.25, a: 0.002, d: 0.3, v: 0.65 });
      nz(ac, out, t + 0.63, { type: 'lowpass', f: 1600, d: 0.2, v: 0.45 });
      return 0.95;
    },
    tail(ac, out, t) {
      whoosh(ac, out, t, 0.2, 350, 2600, 0.38, 1.5);
      nz(ac, out, t + 0.2, { type: 'highpass', f: 2000, d: 0.03, v: 0.65 });
      tone(ac, out, t + 0.2, { f: 190, f2: 60, sw: 0.1, a: 0.002, d: 0.13, v: 0.48 });
      return 0.45;
    },
    stomp(ac, out, t) {
      boom(ac, out, t, 0.85, 70, 28, 1.0);
      rumble(ac, out, t, 1.1, 0.6);
      debris(ac, out, t + 0.1, 7, 0.6, 0.12);
      return 1.2;
    },
    horn(ac, out, t) {   // horn gore: rush + piercing thud
      whoosh(ac, out, t, 0.3, 250, 1800, 0.32);
      tone(ac, out, t + 0.3, { f: 140, f2: 45, sw: 0.15, a: 0.002, d: 0.22, v: 0.7 });
      nz(ac, out, t + 0.3, { f: 1800, q: 1.5, d: 0.07, v: 0.45 });
      crack(ac, out, t + 0.31, 0.45);
      return 0.6;
    },
    club(ac, out, t) {   // tail-club smash: heavy swing + bony crunch
      whoosh(ac, out, t, 0.28, 180, 900, 0.4, 0.9);
      boom(ac, out, t + 0.28, 0.7, 110, 35, 0.35);
      nz(ac, out, t + 0.28, { f: 900, q: 0.8, d: 0.12, v: 0.5 });
      debris(ac, out, t + 0.3, 4, 0.2, 0.15);
      return 0.7;
    },
    head(ac, out, t) {   // dome head-butt: hollow bonk
      whoosh(ac, out, t, 0.18, 300, 1500, 0.2);
      tone(ac, out, t + 0.18, { f: 420, f2: 170, sw: 0.12, a: 0.001, d: 0.16, v: 0.55 });
      nz(ac, out, t + 0.18, { f: 700, q: 6, d: 0.14, v: 0.5 });
      tone(ac, out, t + 0.18, { f: 140, f2: 50, sw: 0.1, a: 0.002, d: 0.15, v: 0.5 });
      return 0.5;
    },
    ko(ac, out, t) {
      const lp = flt(ac, 'lowpass', 700, 1.5), g = gn(ac, 0, out); lp.connect(g);
      envAD(g.gain, t, 0.05, 0.22, 0.6);
      const os = osc(ac, 'sawtooth', 230, t, t + 0.7, lp); os.frequency.exponentialRampToValueAtTime(70, t + 0.65);
      tone(ac, out, t + 0.55, { f: 95, f2: 35, sw: 0.3, a: 0.003, d: 0.5, v: 0.8 });
      nz(ac, out, t + 0.55, { type: 'lowpass', f: 800, a: 0.02, d: 0.5, v: 0.32 });
      debris(ac, out, t + 0.6, 4, 0.3, 0.1);
      return 1.2;
    },
    win(ac, out, t) {
      [60, 64, 67].forEach((m, i) => brassVoice(ac, out, t + i * 0.1, m + 12, 0.08, 0.5, 1, 0.01));
      [72, 76, 79, 84].forEach((m) => brassVoice(ac, out, t + 0.3, m, 0.8, 0.28, 1, 0.02));
      nz(ac, out, t + 0.3, { type: 'highpass', f: 5000, d: 1.2, v: 0.16 });
      sparkle(ac, out, t + 0.35, 8, 0.8, 0.08);
      return 1.6;
    },
    lose(ac, out, t) {
      [[67, 0, 0.22], [63, 0.25, 0.22], [60, 0.5, 0.9]].forEach((n, i) => {
        const f = mtof(n[0]);
        const os = tone(ac, out, t + n[1], { type: 'triangle', f, a: 0.01, h: n[2] * 0.5, d: n[2], v: 0.3 });
        if (os && i === 2) os.frequency.linearRampToValueAtTime(f * 0.96, t + n[1] + 1.2);
        tone(ac, out, t + n[1], { f: f / 2, a: 0.01, h: n[2] * 0.5, d: n[2], v: 0.18 });
      });
      return 1.6;
    },
    error(ac, out, t) {
      tone(ac, out, t, { type: 'square', f: 155, a: 0.002, h: 0.06, d: 0.04, v: 0.2, lp: 1200 });
      tone(ac, out, t + 0.13, { type: 'square', f: 140, a: 0.002, h: 0.08, d: 0.05, v: 0.2, lp: 1200 });
      return 0.3;
    },
    feed(ac, out, t) {
      [0, 0.15, 0.3].forEach((d) => {
        tone(ac, out, t + d, { f: 180, f2: 80, sw: 0.06, a: 0.002, d: 0.08, v: 0.35 });
        nz(ac, out, t + d + 0.01, { f: 1500, q: 0.8, d: 0.07, v: 0.35 });
      });
      tone(ac, out, t + 0.45, { type: 'triangle', f: 520, f2: 740, sw: 0.15, a: 0.02, d: 0.2, v: 0.16 });
      return 0.75;
    },
    evolve(ac, out, t) {
      const g = gn(ac, 0, out);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.14, t + 1.1); g.gain.linearRampToValueAtTime(0, t + 1.3);
      const trem = gn(ac, 0.7, g), lfo = osc(ac, 'sine', 8, t, t + 1.35, null), lg = gn(ac, 0.3); lfo.connect(lg); lg.connect(trem.gain);
      [-14, -5, 5, 14].forEach((det) => {
        const os = osc(ac, 'sine', 300, t, t + 1.35, trem, det);
        os.frequency.exponentialRampToValueAtTime(1200, t + 1.2);
      });
      whoosh(ac, out, t, 1.2, 500, 6000, 0.18, 1.5);
      const ti = t + 1.25;
      boom(ac, out, ti, 0.35, 80, 40, 0.6);
      [72, 76, 79, 84, 88].forEach((m) => tone(ac, out, ti, { type: 'triangle', f: mtof(m), a: 0.01, h: 0.3, d: 1.1, v: 0.09 }));
      [84, 88, 91, 96].forEach((m, i) => fmBell(ac, out, ti + 0.05 + i * 0.07, mtof(m), 4, 0.45, 0.4, 1.2, 0.12));
      sparkle(ac, out, ti, 12, 1.2, 0.08);
      return 2.6;
    },
    card(ac, out, t, o) {
      nz(ac, out, t, { type: 'highpass', f: 1500, f2: 4500, sw: 0.05, q: 0.7, a: 0.003, d: 0.06, v: 0.35 });
      whoosh(ac, out, t, 0.12, 800, 2600, 0.14);
      tone(ac, out, t, { f: 600, f2: 900, sw: 0.05, a: 0.002, d: 0.05, v: 0.1 });
      const r = RANK(o.rarity);
      if (r >= 1) arpUp(ac, out, t + 0.08, [79, 84, 88, 91, 96].slice(0, r + 1), 0.06, 0.12, 'triangle', 0.35);
      if (r >= 3) sparkle(ac, out, t + 0.15, 6 + r * 2, 0.6, 0.08);
      return 0.35 + r * 0.25;
    },
    expedition(ac, out, t, o) {
      const park = o.park || 'land';
      if (park === 'sea') {
        [0, 0.7].forEach((d, i) => {
          tone(ac, out, t + d, { f: 1150, a: 0.004, d: 0.7, v: 0.26 - i * 0.08 });
          tone(ac, out, t + d, { f: 2300, a: 0.004, d: 0.2, v: 0.05 });
        });
        bubbles(ac, out, t + 0.2, 8, 1.0, 0.18);
        tone(ac, out, t, { type: 'sawtooth', f: 60, f2: 80, sw: 1.2, a: 0.3, d: 1.0, v: 0.12, lp: 300 });
      } else {
        [0, 0.24].forEach((d) => {
          tone(ac, out, t + d, { type: 'square', f: 440, a: 0.005, h: 0.1, d: 0.05, v: 0.08, lp: 1800 });
          tone(ac, out, t + d, { type: 'square', f: 554, a: 0.005, h: 0.1, d: 0.05, v: 0.08, lp: 1800 });
        });
        const lp = flt(ac, 'lowpass', 400, 2), g = gn(ac, 0, out), am = gn(ac, 0.6, g); lp.connect(am);
        envAD(g.gain, t + 0.3, 0.25, 0.32, 0.9, 0.2);
        const lfo = osc(ac, 'square', 28, t + 0.3, t + 1.7, null), lg = gn(ac, 0.35); lfo.connect(lg); lg.connect(am.gain);
        const os = osc(ac, 'sawtooth', 55, t + 0.3, t + 1.7, lp); os.frequency.exponentialRampToValueAtTime(115, t + 1.0);
        os.frequency.exponentialRampToValueAtTime(90, t + 1.6);
        if (park === 'ice') for (let i = 0; i < 6; i++) fmBell(ac, out, t + 0.4 + i * 0.12, rnd(2600, 3400), 1.41, 0.6, 0.1, 0.25, 0.05);
      }
      return 1.6;
    },
    splash(ac, out, t) {
      nz(ac, out, t, { type: 'lowpass', f: 4500, f2: 600, sw: 0.3, a: 0.005, d: 0.35, v: 0.5 });
      nz(ac, out, t, { f: 1500, q: 0.6, d: 0.2, v: 0.28 });
      tone(ac, out, t, { f: 140, f2: 60, sw: 0.1, a: 0.002, d: 0.12, v: 0.3 });
      bubbles(ac, out, t + 0.1, 7, 0.5, 0.24);
      return 0.8;
    },
    unlock(ac, out, t) {
      nz(ac, out, t, { f: 1800, q: 3, d: 0.04, v: 0.5 });
      tone(ac, out, t, { type: 'square', f: 900, f2: 600, sw: 0.03, a: 0.001, d: 0.03, v: 0.1 });
      nz(ac, out, t + 0.12, { f: 1200, q: 3, d: 0.05, v: 0.5 });
      tone(ac, out, t + 0.12, { f: 200, f2: 90, sw: 0.06, a: 0.002, d: 0.08, v: 0.35 });
      [79, 84, 88, 91].forEach((m, i) => fmBell(ac, out, t + 0.3 + i * 0.08, mtof(m), 4, 0.45, 0.4, 1.0, 0.16));
      sparkle(ac, out, t + 0.4, 6, 0.6, 0.07);
      return 1.3;
    },
  };
  const SFX_ALIAS = {
    super: 'special', speciale: 'special', attack: 'hit', victory: 'win', defeat: 'lose', collect: 'coin',
    tap: 'click', button: 'click', egg: 'hatch', griffe: 'claw', morsure: 'bite', queue: 'tail',
    pietinement: 'stomp', corne: 'horn', massue: 'club', tete: 'head', swim: 'splash',
  };
  const DUCK = { roar: 1.5, roar_small: 0.6, special: 1.1 };

  // =====================================================================
  //                      LIVE ENGINE (one AudioContext)
  // =====================================================================
  let G = null;              // live graph
  let failed = false;        // creation failed: stay silent forever
  let sfxOn = true, musicOn = true;
  let hiddenSuspended = false, resumeAskedAt = -1e9;
  let wanted = null;         // track requested by the game (null = silence)
  let active = null;         // Player currently playing `wanted`
  let players = [];          // all players (incl. fading ones)
  let timer = null;
  const lastPlay = {};

  const nowMs = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
  function settings() {
    try {
      const s = PC.ENGINE && PC.ENGINE.state && PC.ENGINE.state.settings;
      return s && typeof s === 'object' ? s : null;
    } catch (e) { return null; }
  }
  const sfxAllowed = () => { const s = settings(); return s && 'sound' in s ? s.sound !== false : sfxOn; };
  const musicAllowed = () => { const s = settings(); return s && 'music' in s ? s.music !== false : musicOn; };
  const isHidden = () => HAS_DOC && !!document.hidden;
  function activated() {
    try { const ua = W.navigator && W.navigator.userActivation; return !ua || ua.hasBeenActive; } catch (e) { return true; }
  }

  function ensure(create) {
    if (G || failed || !create || !AC) return G;
    try {
      const ac = new AC({ latencyHint: 'interactive' });
      G = buildGraph(ac);
      try { ac.addEventListener('statechange', onStateChange); } catch (e) { /* old webkit */ }
    } catch (e) { G = null; failed = true; }
    return G;
  }
  function resume() {
    if (!G) return;
    try {
      if (G.ac.state !== 'running' && G.ac.state !== 'closed' && !isHidden()) {
        resumeAskedAt = nowMs();
        const p = G.ac.resume();
        if (p && p.then) p.then(() => { if (G && G.ac.state === 'running') detachGestures(); tick(); }, noop);
      }
    } catch (e) { /* ignore */ }
  }
  function onStateChange() {
    if (!G) return;
    // iOS "interrupted" or a system suspend while visible: wait for the next gesture to resume.
    if (G.ac.state !== 'running' && !isHidden() && !hiddenSuspended) attachGestures();
  }
  /** Create/resume the AudioContext. Call from a user gesture (also done automatically). */
  function unlock() {
    try {
      if (!activated() && !G) return false;
      if (!ensure(true)) return false;
      resume();
      try {   // iOS: a silent buffer started inside the gesture fully unlocks output
        const b = G.ac.createBuffer(1, 1, 22050), s = G.ac.createBufferSource();
        s.buffer = b; s.connect(G.ac.destination); s.start(0);
      } catch (e) { /* ignore */ }
      if (G.ac.state === 'running') detachGestures();
      reconcile(); ensureTimer();
      return true;
    } catch (e) { return false; }
  }
  // Can we schedule sound right now? (running, or a resume was just requested inside a gesture)
  function canSound() {
    if (!G || isHidden()) return false;
    const st = G.ac.state;
    if (st === 'running') return true;
    if (st === 'closed') return false;
    resume();
    return nowMs() - resumeAskedAt < 1500;
  }

  // One-time gesture listeners (capture phase, so they run before game handlers).
  const GESTURES = ['pointerdown', 'pointerup', 'mousedown', 'touchend', 'keydown', 'click'];
  let gesturesOn = false;
  function onGesture() { unlock(); }
  function attachGestures() {
    if (gesturesOn || typeof W.addEventListener !== 'function') return;
    gesturesOn = true;
    GESTURES.forEach((e) => { try { W.addEventListener(e, onGesture, { capture: true, passive: true }); } catch (x) { /* ignore */ } });
  }
  function detachGestures() {
    if (!gesturesOn) return;
    gesturesOn = false;
    GESTURES.forEach((e) => { try { W.removeEventListener(e, onGesture, { capture: true }); } catch (x) { /* ignore */ } });
  }
  attachGestures();

  // Pause everything (music included) while the page is hidden; resume when visible again.
  if (HAS_DOC && document.addEventListener) {
    document.addEventListener('visibilitychange', () => {
      if (!G) return;
      try {
        if (document.hidden) {
          if (G.ac.state === 'running') { hiddenSuspended = true; const p = G.ac.suspend(); if (p && p.catch) p.catch(noop); }
        } else if (hiddenSuspended) {
          hiddenSuspended = false; resume();
        }
      } catch (e) { /* ignore */ }
    });
  }

  // ---------- music state machine ----------
  function reconcile() {
    if (!G) return;
    const want = wanted && musicAllowed() && G.ac.state !== 'closed' ? wanted : null;
    if (active && active.name === want && !active.ended) return;
    const oneShot = want && TRACKS[want].loop === false;
    const had = !!active;
    if (active) {
      if (!active.ended) active.fadeOut(oneShot ? 0.6 : want ? XFADE : 1.0);
      active = null;
    }
    if (want) {
      const t0 = G.ac.currentTime + 0.06;
      active = new Player(G, want, t0, oneShot ? 0.02 : had ? XFADE : 1.0);
      players.push(active);
      active.scheduleUntil(t0 + LOOKAHEAD);
    }
  }
  function ensureTimer() {
    if (timer || !G) return;
    timer = setInterval(tick, TIMER_MS);
  }
  function tick() {
    if (!G) return;
    try {
      reconcile();
      const now = G.ac.currentTime;
      for (let i = players.length - 1; i >= 0; i--) {
        const p = players[i];
        if (p.next < now - 0.2) while (p.next < now && !p.ended) p.advance();   // fell behind: skip, stay in time
        p.scheduleUntil(now + LOOKAHEAD);
        const doneFade = p.fading && now > p.stopAt + 3;
        const doneEnd = p.ended && now > p.endTime;
        if (doneFade || doneEnd) {
          p.dispose(); players.splice(i, 1);
          if (p === active) { active = null; if (wanted === p.name && !p.tr.loop) wanted = null; }
        }
      }
      if (!wanted && !players.length) { clearInterval(timer); timer = null; }
    } catch (e) { /* never throw from the timer */ }
  }

  // =====================================================================
  //                              PUBLIC API
  // =====================================================================
  const SFX = PC.SFX = {
    names: Object.keys(S),
    unlock,
    /** play(name, {vol, pitch (roars), cls (special), rarity (card), park (expedition), power (hit)}) → bool */
    play(name, opts) {
      try {
        const key = S[name] ? name : SFX_ALIAS[name];
        if (!key || !sfxAllowed()) return false;
        if (!G && activated()) ensure(true);
        if (!canSound()) return false;
        const now = G.ac.currentTime;
        if (now - (lastPlay[key] || -1) < 0.035) return false;   // de-duplicate spam
        lastPlay[key] = now;
        const o = opts || {};
        const out = gn(G.ac, o.vol != null ? clamp(+o.vol || 0, 0, 2) : 1, G.sfx);
        const dur = S[key](G.ac, out, now + 0.01, o) || 1;
        setTimeout(() => { try { out.disconnect(); } catch (e) { /* ignore */ } }, (dur + 1) * 1000);
        if (DUCK[key]) MUSIC.duck(DUCK[key] * (o.len || 1));
        return true;
      } catch (e) { return false; }
    },
    setEnabled(b) {
      sfxOn = !!b;
      const s = settings(); if (s) s.sound = sfxOn;
      if (sfxOn) unlock();
    },
    get enabled() { return sfxAllowed(); },
    get ready() { return !!G && G.ac.state === 'running'; },
    /** Test helper: render one effect offline → Promise<AudioBuffer|null>. */
    render(name, opts, seconds, gopts) {
      const key = S[name] ? name : SFX_ALIAS[name];
      return renderOffline(seconds || 3, gopts, (g) => {
        if (!key) return;
        const out = gn(g.ac, 1, g.sfx);
        S[key](g.ac, out, 0.02, opts || {});
      });
    },
  };

  const MUSIC = PC.MUSIC = {
    tracks: Object.keys(TRACKS),
    unlock,
    /** play(track): cross-fades (1.5 s) to the track; looping tracks keep playing, victory/defeat play once. */
    play(track) {
      try {
        const name = TRACKS[track] ? track : TRACK_ALIAS[track];
        if (!name) return false;
        if (wanted === name && active && active.name === name && !active.fading) return true;
        wanted = name;
        if (!G && activated()) ensure(true);
        reconcile(); ensureTimer();
        return true;
      } catch (e) { return false; }
    },
    stop(fade) {
      try {
        wanted = null;
        if (active) { active.fadeOut(fade != null ? Math.max(0.02, fade) : 1.2); active = null; }
      } catch (e) { /* ignore */ }
    },
    setEnabled(b) {
      musicOn = !!b;
      const s = settings(); if (s) s.music = musicOn;
      try { if (musicOn) unlock(); reconcile(); ensureTimer(); } catch (e) { /* ignore */ }
    },
    get enabled() { return musicAllowed(); },
    /** Lower the music for `seconds` (used automatically during roars). */
    duck(seconds) {
      if (!G) return;
      try {
        const p = G.duck.gain, now = G.ac.currentTime, hold = Math.max(0.1, +seconds || 1);
        p.cancelScheduledValues(now);
        p.setValueAtTime(p.value, now);
        p.linearRampToValueAtTime(0.3, now + 0.08);
        p.setValueAtTime(0.3, now + hold);
        p.linearRampToValueAtTime(1, now + hold + 0.7);
      } catch (e) { /* ignore */ }
    },
    /** Name of the requested track (null when stopped or after a one-shot ended). */
    get current() { return wanted; },
    get playing() { return !!active && !active.fading && !!G && G.ac.state === 'running'; },
    /** Test helper: render `seconds` of a track offline → Promise<AudioBuffer|null>. */
    render(track, seconds, gopts) {
      const name = TRACKS[track] ? track : TRACK_ALIAS[track];
      const sec = seconds || 10;
      return renderOffline(sec, gopts, (g) => {
        if (!name) return;
        const p = new Player(g, name, 0.05, 0.02);
        p.scheduleUntil(sec);
      });
    },
    _tracks: TRACKS,
  };

  function renderOffline(seconds, gopts, fill) {
    try {
      if (!OAC) return Promise.resolve(null);
      const sr = (gopts && gopts.sampleRate) || 44100;
      const ac = new OAC(2, Math.ceil(seconds * sr), sr);
      const g = buildGraph(ac, gopts);
      fill(g);
      return ac.startRendering();
    } catch (e) { return Promise.resolve(null); }
  }
})(window.PC = window.PC || {});
