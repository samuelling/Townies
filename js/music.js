// Generative ambient soundtrack in a eurorack / Eno spirit, synthesized live.
// Everything is drawn from one major key at a time: a slow diatonic chord progression (pads + bass)
// and a sparse Turing-machine melody on the key's pentatonic scale, snapped to chord tones on the
// beat, so nothing ever clashes. Keys only move by a fourth or fifth (sharing most notes), with the
// echoes ducked at the change. Soft drums drift in for some sections only. Plus UI blips.
import * as FX from './sfx.js';
const BPM = 88;
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const PENT = [0, 1, 2, 4, 5]; // scale degrees 1 2 3 5 6
// uplifting progressions as scale degrees (0 = I, 3 = IV, 4 = V, 5 = vi, 1 = ii)
const PROGS = [[0, 4, 5, 3], [0, 3, 0, 4], [5, 3, 0, 4], [0, 5, 3, 4], [3, 0, 4, 0], [0, 1, 3, 4]];
const CHORD = 32; // 16th-notes per chord (two bars)
const N = (m) => 440 * Math.pow(2, (m - 69) / 12);
const euclid = (k, n, rot = 0) => Array.from({ length: n }, (_, i) => ((i + rot) * k) % n < k);

class Turing {
  constructor(len, range) {
    this.len = len;
    this.range = range;
    this.reg = Array.from({ length: len }, () => Math.floor(Math.random() * range));
    this.pos = 0;
    this.lock = 0.9; // probability a value is kept (higher = more repetition)
  }
  next() {
    const v = this.reg[this.pos];
    if (Math.random() > this.lock) this.reg[this.pos] = Math.max(0, Math.min(this.range - 1, v + Math.floor(Math.random() * 3) - 1));
    this.pos = (this.pos + 1) % this.len;
    return v;
  }
}

export class Music {
  constructor() {
    this.ctx = null;
    this.on = false;
    let saved = null;
    try { saved = localStorage.getItem('townies-sfx'); } catch (e) { /* storage off */ }
    this.sfxOn = saved !== '0';
    this.lastFx = {};
    this.step = 0;
    this.timer = null;
    this.key = 50; // D
    this.seqA = new Turing(13, 8);
    this.seqB = new Turing(7, 5);
    this.newSection(0);
  }
  ensure() {
    if (this.ctx) return this.ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    const c = (this.ctx = new AC());
    this.master = c.createGain();
    this.master.gain.value = 0.34;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -20;
    comp.ratio.value = 3;
    this.master.connect(comp).connect(c.destination);
    this.musicBus = c.createGain();
    this.musicBus.gain.value = 0;
    this.musicBus.connect(this.master);
    this.sfxBus = c.createGain();
    this.sfxBus.gain.value = 0.7;
    this.sfxBus.connect(this.master);
    // big generated reverb
    this.verb = c.createConvolver();
    const len = Math.floor(c.sampleRate * 3.6);
    const ir = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    this.verb.buffer = ir;
    this.verbSend = c.createGain();
    this.verbSend.gain.value = 1;
    const wet = c.createGain();
    wet.gain.value = 0.5;
    this.verbSend.connect(this.verb).connect(wet).connect(this.musicBus);
    // dotted-eighth echo
    this.delay = c.createDelay(2);
    this.delay.delayTime.value = (60 / BPM) * 0.75;
    this.fb = c.createGain();
    this.fb.gain.value = 0.36;
    const dl = c.createBiquadFilter();
    dl.type = 'lowpass';
    dl.frequency.value = 2200;
    this.delay.connect(dl).connect(this.fb).connect(this.delay);
    const dOut = c.createGain();
    dOut.gain.value = 0.28;
    dl.connect(dOut).connect(this.musicBus);
    dOut.connect(this.verbSend);
    // noise
    const nl = c.sampleRate;
    this.noise = c.createBuffer(1, nl, c.sampleRate);
    const nd = this.noise.getChannelData(0);
    for (let i = 0; i < nl; i++) nd[i] = Math.random() * 2 - 1;
    return c;
  }
  async toggle(force) {
    const c = this.ensure();
    if (!c) return false;
    if (c.state === 'suspended') await c.resume();
    this.on = force != null ? force : !this.on;
    const t = c.currentTime;
    this.musicBus.gain.cancelScheduledValues(t);
    this.musicBus.gain.setTargetAtTime(this.on ? 1 : 0, t, 0.6);
    if (this.on && !this.timer) {
      this.next = c.currentTime + 0.1;
      this.timer = setInterval(() => this.schedule(), 30);
    }
    if (!this.on && this.timer)
      setTimeout(() => {
        if (!this.on && this.timer) {
          clearInterval(this.timer);
          this.timer = null;
          this.stopPad();
        }
      }, 2500);
    return this.on;
  }
  // a section is one pass through a four-chord progression
  newSection(n, t) {
    this.sec = n;
    if (n > 0 && n % 4 === 0) this.modulate(t);
    this.prog = PROGS[Math.floor(Math.random() * PROGS.length)];
    this.drums = n > 1 && Math.random() < 0.3;
    this.voiceB = Math.random() < 0.45;
    this.rhA = euclid(3 + Math.floor(Math.random() * 3), 16, Math.floor(Math.random() * 4));
    this.rhB = euclid(2, 11 + Math.floor(Math.random() * 3));
    this.rhHat = euclid(5, 16, 2);
    this.seqA.lock = 0.82 + Math.random() * 0.13;
  }
  // move to a neighbouring key (up a fourth or a fifth): six of seven notes stay the same
  modulate(t) {
    let k = this.key + (Math.random() < 0.5 ? 5 : 7);
    while (k > 55) k -= 12;
    while (k < 45) k += 12;
    this.key = k;
    if (this.fb && t != null) {
      // duck the echo so old-key notes don't ring into the new key
      this.fb.gain.setTargetAtTime(0.05, t - 0.6, 0.15);
      this.fb.gain.setTargetAtTime(0.36, t + 1.5, 0.8);
    }
  }
  // 16th-note scheduler
  schedule() {
    const c = this.ctx;
    const six = 60 / BPM / 4;
    while (this.next < c.currentTime + 0.15) {
      const s = this.step;
      if (s % (CHORD * 4) === 0) this.newSection(s / (CHORD * 4), this.next);
      if (s % CHORD === 0) {
        this.deg = this.prog[(s / CHORD) % 4];
        this.pad(this.next);
      }
      this.play(this.next, s);
      this.next += six;
      this.step++;
    }
  }
  // MIDI note for scale degree d (can exceed 6) in the current key
  note(d, oct = 0) {
    return this.key + MAJOR[((d % 7) + 7) % 7] + 12 * (oct + Math.floor(d / 7));
  }
  chordTones(oct) {
    return [0, 2, 4].map((k) => this.note(this.deg + k, oct));
  }
  melody(i, snap) {
    let m = this.note(PENT[i % 5] + 7 * Math.floor(i / 5), 1);
    if (snap) {
      // on strong beats, land on the nearest chord tone
      const ct = [...this.chordTones(1), ...this.chordTones(2)];
      m = ct.reduce((a, b) => (Math.abs(b - m) < Math.abs(a - m) ? b : a));
    }
    return m;
  }
  play(t, s) {
    const six = 60 / BPM / 4;
    const inChord = s % CHORD;
    // main ping voice: Turing machine on a sparse Euclidean rhythm, with rests
    if (this.rhA[s % 16] && Math.random() < 0.8) {
      const v = this.seqA.next();
      this.ping(t, N(this.melody(v, s % 4 === 0)), 0.1, 0.4 + Math.random() * 0.4, (s % 32) / 32);
    }
    // high bell on an odd-length rhythm so it phases; chord tones only
    if (this.voiceB && this.rhB[s % this.rhB.length] && s % 2 === 0 && Math.random() < 0.7) {
      const ct = this.chordTones(2);
      this.bell(t, N(ct[this.seqB.next() % 3]), 0.045);
    }
    // bass: the chord root, held, with a soft fifth halfway through
    if (inChord === 0) this.bass(t, N(this.note(this.deg, -1)), six * 14, 0.3);
    else if (inChord === 20 && Math.random() < 0.5) this.bass(t, N(this.note(this.deg + 4, -1)), six * 8, 0.16);
    // soft drums, some sections only
    if (this.drums) {
      if (s % 16 === 0 || (s % 16 === 10 && Math.random() < 0.3)) this.kick(t, s % 16 === 0 ? 0.6 : 0.35);
      if (this.rhHat[s % 16] && Math.random() < 0.8) this.hat(t, 0.06 + 0.06 * Math.random());
      if (s % 32 === 24 && Math.random() < 0.4) this.click(t);
    }
  }
  pad(t) {
    const c = this.ctx;
    this.stopPad(t + 0.3);
    // root low, then 3rd, 5th and the 9th above, voiced close to the last chord
    const center = this.key + 12;
    const raw = [this.note(this.deg + 2), this.note(this.deg + 4), this.note(this.deg + 1, 1)];
    const voiced = raw.map((m) => { while (m - center > 7) m -= 12; while (center - m > 6) m += 12; return m; });
    const notes = [this.note(this.deg, -1), ...voiced];
    const out = c.createGain();
    out.gain.setValueAtTime(0.0001, t);
    out.gain.linearRampToValueAtTime(0.045, t + 1.8);
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 800;
    f.Q.value = 0.8;
    const lfo = c.createOscillator();
    lfo.frequency.value = 0.06 + Math.random() * 0.04;
    const lg = c.createGain();
    lg.gain.value = 300;
    lfo.connect(lg).connect(f.frequency);
    f.connect(out);
    out.connect(this.musicBus);
    out.connect(this.verbSend);
    const oscs = [lfo];
    notes.forEach((m, k) => {
      for (const det of [-3, 3]) {
        const o = c.createOscillator();
        o.type = k === 0 ? 'sine' : 'triangle';
        o.frequency.value = N(m);
        o.detune.value = det;
        o.connect(f);
        oscs.push(o);
      }
    });
    oscs.forEach((o) => o.start(t));
    this.padNodes = { out, oscs };
  }
  stopPad(t) {
    if (!this.padNodes || !this.ctx) return;
    const c = this.ctx;
    t = t || c.currentTime;
    const { out, oscs } = this.padNodes;
    out.gain.cancelScheduledValues(t);
    out.gain.setTargetAtTime(0.0001, t, 0.9);
    oscs.forEach((o) => o.stop(t + 6));
    this.padNodes = null;
  }
  // low-pass-gate "bongo" ping
  ping(t, f, vol, decay, pan) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = 'triangle';
    o.frequency.value = f;
    const m = c.createOscillator();
    m.frequency.value = f * 2;
    const mg = c.createGain();
    mg.gain.setValueAtTime(f * 0.6, t);
    mg.gain.exponentialRampToValueAtTime(1, t + decay);
    m.connect(mg).connect(o.frequency);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 3;
    lp.frequency.setValueAtTime(Math.min(9000, f * 9), t);
    lp.frequency.exponentialRampToValueAtTime(f * 0.9, t + decay);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay * 1.4);
    let node = g;
    if (c.createStereoPanner) {
      const p = c.createStereoPanner();
      p.pan.value = Math.sin(pan * Math.PI * 2) * 0.5;
      g.connect(p);
      node = p;
    }
    o.connect(lp).connect(g);
    node.connect(this.musicBus);
    node.connect(this.delay);
    node.connect(this.verbSend);
    o.start(t);
    m.start(t);
    o.stop(t + decay * 1.5 + 0.05);
    m.stop(t + decay * 1.5 + 0.05);
  }
  bell(t, f, vol) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.frequency.value = f;
    const m = c.createOscillator();
    m.frequency.value = f * 3; // integer ratio keeps the partials in tune
    const mg = c.createGain();
    mg.gain.setValueAtTime(f * 0.8, t);
    mg.gain.exponentialRampToValueAtTime(1, t + 1.2);
    m.connect(mg).connect(o.frequency);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
    o.connect(g);
    g.connect(this.verbSend);
    g.connect(this.delay);
    g.connect(this.musicBus);
    o.start(t);
    m.start(t);
    o.stop(t + 2.3);
    m.stop(t + 2.3);
  }
  bass(t, f, dur, vol = 0.3) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.value = f;
    const o2 = c.createOscillator();
    o2.type = 'triangle';
    o2.frequency.value = f * 2;
    const g2 = c.createGain();
    g2.gain.value = 0.15;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.04);
    g.gain.setTargetAtTime(0.0001, t + dur * 0.7, 0.3);
    o.connect(g);
    o2.connect(g2).connect(g);
    g.connect(this.musicBus);
    o.start(t);
    o2.start(t);
    o.stop(t + dur + 1.6);
    o2.stop(t + dur + 1.6);
  }
  kick(t, v) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.frequency.setValueAtTime(95, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.15);
    const g = c.createGain();
    g.gain.setValueAtTime(0.45 * v, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    o.connect(g).connect(this.musicBus);
    o.start(t);
    o.stop(t + 0.45);
  }
  noiseHit(t, type, freq, q, vol, dur, bus) {
    const c = this.ctx;
    const s = c.createBufferSource();
    s.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(bus || this.musicBus);
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.05);
  }
  hat(t, v) {
    this.noiseHit(t, 'highpass', 8000, 0.8, v * 0.6, 0.035);
  }
  click(t) {
    this.noiseHit(t, 'bandpass', 2600, 6, 0.25, 0.05);
    this.noiseHit(t, 'bandpass', 2600, 6, 0.08, 0.05, this.verbSend);
  }

  // ---- sound effects ----
  toggleSfx() {
    this.sfxOn = !this.sfxOn;
    try { localStorage.setItem('townies-sfx', this.sfxOn ? '1' : '0'); } catch (e) { /* storage off */ }
    return this.sfxOn;
  }
  // n: how big the action was (tiles, lots), for sounds that scale
  sfx(kind, n = 1) {
    if (!this.sfxOn) return;
    const c = this.ensure();
    if (!c) return;
    if (c.state === 'suspended') c.resume();
    const t = c.currentTime + 0.01;
    // the same sound twice within a moment would just pile up
    const now = performance.now();
    if (now - (this.lastFx[kind] || 0) < 120) return;
    this.lastFx[kind] = now;
    const synth = {
      drill: () => FX.drill(this, t, Math.min(1.3, 0.45 + 0.04 * n)),
      road: () => FX.road(this, t, n),
      bulldoze: () => FX.bulldoze(this, t, n),
      zoneR: () => FX.stamp(this, t, 'zoneR'), zoneC: () => FX.stamp(this, t, 'zoneC'), zoneI: () => FX.stamp(this, t, 'zoneI'), dezone: () => FX.stamp(this, t, 'dezone'),
      park: () => FX.park(this, t),
      civic: () => FX.civic(this, t),
      ribbon: () => FX.ribbon(this, t),
      gavel: () => FX.gavel(this, t),
      siren: () => FX.siren(this, t),
      rewind: () => FX.rewind(this, t),
      hammer: () => FX.hammer(this, t),
      submit: () => FX.submit(this, t),
      spooky: () => FX.spooky(this, t),
      snow: () => FX.snow(this, t),
    }[kind];
    if (synth) return synth();
    const blip = (f0, f1, dur, type = 'square', vol = 0.08) => {
      const o = c.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(f1, t + dur);
      const g = c.createGain();
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 2400;
      o.connect(f).connect(g).connect(this.sfxBus);
      o.start(t);
      o.stop(t + dur + 0.02);
    };
    if (kind === 'build') { blip(520, 780, 0.09); setTimeout(() => this.sfxOn && blip(780, 1040, 0.08), 70); }
    else if (kind === 'zone') blip(660, 660, 0.06, 'triangle', 0.1);
    else if (kind === 'click') blip(900, 700, 0.03, 'square', 0.05);
    else if (kind === 'bulldoze') this.noiseHit(t, 'lowpass', 600, 0.5, 0.5, 0.35, this.sfxBus);
    else if (kind === 'error') blip(220, 160, 0.18, 'sawtooth', 0.06);
    else if (kind === 'alert') { blip(880, 880, 0.12, 'triangle', 0.1); setTimeout(() => this.sfxOn && blip(660, 660, 0.16, 'triangle', 0.1), 140); }
    else if (kind === 'news') blip(1200, 900, 0.05, 'triangle', 0.06);
  }
}
