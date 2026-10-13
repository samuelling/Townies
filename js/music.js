// Generative ambient-but-upbeat soundtrack in a eurorack / Eno spirit, synthesized live.
// Turing-machine-style shift-register sequencers drive low-pass-gate "pings" on Euclidean
// rhythms of different lengths (so loops phase against each other), over slow pads in a big
// reverb. Drums drift in for some sections only. Plus SC2000-ish UI blips.
const BPM = 104;
const SCALE = [0, 2, 4, 7, 9, 11, 12, 14, 16, 19, 21, 23, 24]; // major pentatonic + maj7 colour
const ROOTS = [53, 50, 56, 51, 48, 53]; // F, D, Ab, Eb, C ... drifting modal centres
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
    if (Math.random() > this.lock) this.reg[this.pos] = Math.max(0, Math.min(this.range - 1, v + Math.floor(Math.random() * 5) - 2));
    this.pos = (this.pos + 1) % this.len;
    return v;
  }
}

export class Music {
  constructor() {
    this.ctx = null;
    this.on = false;
    this.sfxOn = true;
    this.step = 0;
    this.timer = null;
    this.seqA = new Turing(11, 9);
    this.seqB = new Turing(7, 6);
    this.seqBass = new Turing(5, 3);
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
    const len = Math.floor(c.sampleRate * 4.2);
    const ir = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
    this.verb.buffer = ir;
    this.verbSend = c.createGain();
    this.verbSend.gain.value = 1;
    const wet = c.createGain();
    wet.gain.value = 0.55;
    this.verbSend.connect(this.verb).connect(wet).connect(this.musicBus);
    // dotted-eighth echo
    this.delay = c.createDelay(2);
    this.delay.delayTime.value = (60 / BPM) * 0.75;
    const fb = c.createGain();
    fb.gain.value = 0.42;
    const dl = c.createBiquadFilter();
    dl.type = 'lowpass';
    dl.frequency.value = 2600;
    this.delay.connect(dl).connect(fb).connect(this.delay);
    const dOut = c.createGain();
    dOut.gain.value = 0.32;
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
  newSection(n) {
    this.sec = n;
    this.root = ROOTS[Math.floor(n / 2) % ROOTS.length];
    this.drums = n > 0 && Math.random() < 0.45;
    this.voiceB = Math.random() < 0.7;
    this.rhA = euclid(5 + Math.floor(Math.random() * 3), 16, Math.floor(Math.random() * 4));
    this.rhB = euclid(3, 10 + Math.floor(Math.random() * 3));
    this.rhBass = euclid(3, 8);
    this.rhHat = euclid(7 + Math.floor(Math.random() * 3), 16, 2);
    this.seqA.lock = 0.8 + Math.random() * 0.15;
    this.padChange = true;
  }
  // 16th-note scheduler
  schedule() {
    const c = this.ctx;
    const six = 60 / BPM / 4;
    while (this.next < c.currentTime + 0.15) {
      const s = this.step;
      if (s % 128 === 0) this.newSection(s / 128);
      if (this.padChange || s % 64 === 0) this.pad(this.next);
      this.play(this.next, s);
      this.next += six;
      this.step++;
    }
  }
  scaleNote(idx, oct = 0) {
    const i = Math.max(0, Math.min(SCALE.length - 1, idx));
    return this.root + SCALE[i] + 12 * oct;
  }
  play(t, s) {
    const six = 60 / BPM / 4;
    // main ping voice: Turing machine on a Euclidean rhythm
    if (this.rhA[s % 16]) this.ping(t, N(this.scaleNote(this.seqA.next(), 1)), 0.13, 0.35 + Math.random() * 0.4, (s % 32) / 32);
    // high bell voice on an odd-length rhythm, so it phases
    if (this.voiceB && this.rhB[s % this.rhB.length] && s % 2 === 0) this.bell(t, N(this.scaleNote(this.seqB.next() + 3, 2)), 0.06);
    // bass pulse
    if (this.rhBass[s % 8] && s % 2 === 0) this.bass(t, N(this.root - 12 + [0, 7, 12][this.seqBass.next()]), six * 3);
    // drums, sometimes
    if (this.drums) {
      if (s % 8 === 0) this.kick(t, s % 16 === 0 ? 0.9 : 0.6);
      if (this.rhHat[s % 16]) this.hat(t, 0.1 + 0.12 * Math.random());
      if (s % 16 === 12 && Math.random() < 0.7) this.click(t);
    }
  }
  pad(t) {
    this.padChange = false;
    const c = this.ctx;
    this.stopPad(t + 3);
    const notes = [this.root - 12, this.root - 5, this.root + 4, this.root + 11].map((m) => m + (Math.random() < 0.3 ? 2 : 0));
    const out = c.createGain();
    out.gain.setValueAtTime(0.0001, t);
    out.gain.linearRampToValueAtTime(0.05, t + 4);
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 700;
    f.Q.value = 2;
    const lfo = c.createOscillator();
    lfo.frequency.value = 0.05 + Math.random() * 0.05;
    const lg = c.createGain();
    lg.gain.value = 450;
    lfo.connect(lg).connect(f.frequency);
    f.connect(out);
    out.connect(this.musicBus);
    out.connect(this.verbSend);
    const oscs = [lfo];
    for (const m of notes)
      for (const det of [-6, 6]) {
        const o = c.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = N(m);
        o.detune.value = det;
        o.connect(f);
        oscs.push(o);
      }
    oscs.forEach((o) => o.start(t));
    this.padNodes = { out, oscs };
  }
  stopPad(t) {
    if (!this.padNodes || !this.ctx) return;
    const c = this.ctx;
    t = t || c.currentTime;
    const { out, oscs } = this.padNodes;
    out.gain.cancelScheduledValues(t);
    out.gain.setTargetAtTime(0.0001, t, 1.5);
    oscs.forEach((o) => o.stop(t + 8));
    this.padNodes = null;
  }
  // low-pass-gate "bongo" ping
  ping(t, f, vol, decay, pan) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = 'triangle';
    o.frequency.value = f;
    const m = c.createOscillator();
    m.frequency.value = f * 2.01;
    const mg = c.createGain();
    mg.gain.setValueAtTime(f * 0.9, t);
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
    m.frequency.value = f * 3.5;
    const mg = c.createGain();
    mg.gain.setValueAtTime(f * 1.2, t);
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
  bass(t, f, dur) {
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
    g.gain.linearRampToValueAtTime(0.32, t + 0.02);
    g.gain.setTargetAtTime(0.0001, t + dur * 0.6, 0.12);
    o.connect(g);
    o2.connect(g2).connect(g);
    g.connect(this.musicBus);
    o.start(t);
    o2.start(t);
    o.stop(t + dur + 0.8);
    o2.stop(t + dur + 0.8);
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
  sfx(kind) {
    if (!this.sfxOn) return;
    const c = this.ensure();
    if (!c) return;
    if (c.state === 'suspended') c.resume();
    const t = c.currentTime + 0.01;
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
