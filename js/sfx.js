// Sound effects, all synthesized with Web Audio (no samples): the construction drill, a jackhammer for roads,
// the bulldozer's diesel and falling debris, rubber stamps for zoning, birds for parks, a gavel for Council
// votes, a siren for crews, a cash-register "ching" for ribbon cuttings, and a tape-rewind for Undo.
// Each function takes the Music object (for its AudioContext, noise buffer and effects bus) and a start time.

const rnd = (a, b) => a + Math.random() * (b - a);

function env(c, t, peak, attack, hold, release) {
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.setValueAtTime(peak, t + attack + hold);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
  return g;
}
function noiseSrc(m, t, dur) {
  const s = m.ctx.createBufferSource();
  s.buffer = m.noise;
  s.loop = true;
  s.start(t, Math.random() * 0.8);
  s.stop(t + dur + 0.1);
  return s;
}
function filt(c, type, f, q = 1) {
  const n = c.createBiquadFilter();
  n.type = type;
  n.frequency.value = f;
  n.Q.value = q;
  return n;
}
function tone(m, t, type, f0, f1, dur, vol, out) {
  const c = m.ctx;
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = env(c, t, vol, 0.005, 0, dur);
  o.connect(g).connect(out || m.sfxBus);
  o.start(t);
  o.stop(t + dur + 0.05);
}
function tick(m, t, f, vol, dur = 0.04, q = 4) {
  const c = m.ctx;
  noiseSrc(m, t, dur).connect(filt(c, 'bandpass', f, q)).connect(env(c, t, vol, 0.002, 0, dur)).connect(m.sfxBus);
}
// a struck metal bell: a few inharmonic partials that ring out
function bell(m, t, f, vol = 0.12, dur = 1.2) {
  for (const [r, v] of [[1, 1], [2.76, 0.45], [5.4, 0.25], [8.93, 0.12]]) if (f * r < 16000) tone(m, t, 'sine', f * r, f * r, dur / Math.sqrt(r), vol * v);
}

// The construction drill: a chattering motor, noise chopped ~25 times a second, rising as it bites.
export function drill(m, t, dur = 0.7, pitch = 1, vol = 0.22) {
  const c = m.ctx;
  const rate = rnd(22, 28) * pitch;
  const chop = c.createGain();
  chop.gain.value = 0.5;
  const lfo = c.createOscillator();
  lfo.type = 'square';
  lfo.frequency.setValueAtTime(rate, t);
  lfo.frequency.linearRampToValueAtTime(rate * 1.18, t + dur * 0.5);
  lfo.frequency.linearRampToValueAtTime(rate * 0.92, t + dur);
  const depth = c.createGain();
  depth.gain.value = 0.5;
  lfo.connect(depth).connect(chop.gain);
  const out = env(c, t, vol, 0.025, Math.max(0.02, dur - 0.12), 0.09);
  chop.connect(out).connect(m.sfxBus);
  noiseSrc(m, t, dur).connect(filt(c, 'bandpass', rnd(1500, 1900) * pitch, 1.6)).connect(chop);
  const mo = c.createOscillator();
  mo.type = 'sawtooth';
  mo.frequency.setValueAtTime(120 * pitch, t);
  mo.frequency.linearRampToValueAtTime(165 * pitch, t + dur * 0.4);
  mo.frequency.linearRampToValueAtTime(130 * pitch, t + dur);
  const mg = c.createGain();
  mg.gain.value = 0.5;
  mo.connect(filt(c, 'lowpass', 1100, 0.8)).connect(mg).connect(chop);
  for (const n of [lfo, mo]) { n.start(t); n.stop(t + dur + 0.1); }
}

// Roads: a jackhammer (slower, lower, with a thump on every blow) then the roller's rumble.
export function road(m, t, n = 6) {
  const dur = Math.min(1.1, 0.35 + n * 0.03);
  const hits = Math.round(dur * 15);
  for (let k = 0; k < hits; k++) {
    const tk = t + k / 15 + rnd(-0.004, 0.004);
    tone(m, tk, 'sine', 140, 55, 0.05, 0.15);
    tick(m, tk, rnd(700, 1000), 0.14, 0.035, 2);
  }
  const c = m.ctx;
  noiseSrc(m, t + dur, 0.5).connect(filt(c, 'lowpass', 180, 0.7)).connect(env(c, t + dur, 0.25, 0.08, 0.15, 0.3)).connect(m.sfxBus);
}

// Bulldozing: diesel growl, a crash of falling masonry, then debris clattering down.
export function bulldoze(m, t, n = 1) {
  const c = m.ctx;
  const big = 0.6 * Math.min(1, 0.4 + n * 0.06);
  const eng = c.createOscillator();
  eng.type = 'sawtooth';
  eng.frequency.value = 46;
  const wob = c.createOscillator();
  wob.frequency.value = 7;
  const wg = c.createGain();
  wg.gain.value = 5;
  wob.connect(wg).connect(eng.frequency);
  eng.connect(filt(c, 'lowpass', 320, 1.2)).connect(env(c, t, 0.14, 0.06, 0.35, 0.35)).connect(m.sfxBus);
  for (const o of [eng, wob]) { o.start(t); o.stop(t + 0.9); }
  const tc = t + 0.18;
  noiseSrc(m, tc, 1.1).connect(filt(c, 'lowpass', 260, 0.7)).connect(env(c, tc, 0.55 * big, 0.02, 0.1, 0.8)).connect(m.sfxBus);
  noiseSrc(m, tc, 0.5).connect(filt(c, 'bandpass', 900, 0.8)).connect(env(c, tc, 0.25 * big, 0.01, 0.03, 0.35)).connect(m.sfxBus);
  for (let k = 0; k < 6 + Math.round(6 * big); k++) tick(m, tc + 0.05 + Math.pow(Math.random(), 1.6) * 0.75, rnd(1800, 5000), rnd(0.05, 0.14), rnd(0.03, 0.08), 3);
}

// Zoning: a rubber stamp (thump and snap) with a little two-note chime that differs by zone.
const CHIME = { zoneR: [784, 988], zoneC: [659, 988], zoneI: [392, 523], dezone: [523, 392] };
export function stamp(m, t, kind = 'zoneR') {
  tone(m, t, 'sine', 170, 60, 0.09, 0.2);
  tick(m, t, 3200, 0.1, 0.03, 2);
  const [a, b] = CHIME[kind] || CHIME.zoneR;
  tone(m, t + 0.05, 'triangle', a, a, 0.12, 0.07);
  tone(m, t + 0.13, 'triangle', b, b, 0.16, 0.07);
}

// Parks: rustling leaves and a couple of birds.
export function park(m, t) {
  const c = m.ctx;
  noiseSrc(m, t, 0.4).connect(filt(c, 'highpass', 4500, 0.7)).connect(env(c, t, 0.06, 0.05, 0.1, 0.25)).connect(m.sfxBus);
  for (const [dt, f] of [[0.05, 3300], [0.17, 3900], [0.36, 3500]]) {
    tone(m, t + dt, 'sine', f, f * 1.35, 0.06, 0.06);
    tone(m, t + dt + 0.07, 'sine', f * 1.2, f * 0.95, 0.05, 0.05);
  }
}

// A new civic building: the drill, then a bell for the ribbon.
export function civic(m, t) {
  drill(m, t, 0.8);
  bell(m, t + 0.95, 1046, 0.1, 1.4);
}

// Ribbon cutting: applause-ish crowd hiss, a cash-register ching.
export function ribbon(m, t) {
  const c = m.ctx;
  tick(m, t, 6000, 0.12, 0.05, 1);
  bell(m, t + 0.03, 2093, 0.07, 0.6);
  bell(m, t + 0.12, 2637, 0.07, 0.7);
  for (let k = 0; k < 40; k++) tick(m, t + 0.2 + Math.random() * 1.2, rnd(1500, 3500), rnd(0.02, 0.05), 0.025, 2);
  noiseSrc(m, t + 0.2, 1.3).connect(filt(c, 'bandpass', 2400, 0.6)).connect(env(c, t + 0.2, 0.04, 0.2, 0.5, 0.6)).connect(m.sfxBus);
}

// Council votes: two raps of a gavel on wood.
export function gavel(m, t) {
  for (const dt of [0, 0.22]) {
    tone(m, t + dt, 'sine', 420, 180, 0.06, 0.2);
    tick(m, t + dt, 1400, 0.13, 0.05, 3);
  }
}

// Crews dispatched: a short siren wail.
export function siren(m, t) {
  const c = m.ctx;
  const o = c.createOscillator();
  o.type = 'triangle';
  o.frequency.setValueAtTime(650, t);
  o.frequency.linearRampToValueAtTime(980, t + 0.35);
  o.frequency.linearRampToValueAtTime(650, t + 0.7);
  o.frequency.linearRampToValueAtTime(980, t + 1.05);
  o.connect(filt(c, 'lowpass', 2500)).connect(env(c, t, 0.08, 0.05, 0.85, 0.2)).connect(m.sfxBus);
  o.start(t);
  o.stop(t + 1.2);
}

// Undo: a tape rewinding.
export function rewind(m, t) {
  const c = m.ctx;
  const o = c.createOscillator();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(300, t);
  o.frequency.exponentialRampToValueAtTime(1600, t + 0.28);
  const chop = c.createGain();
  chop.gain.value = 0.5;
  const l = c.createOscillator();
  l.frequency.value = 38;
  const lg = c.createGain();
  lg.gain.value = 0.5;
  l.connect(lg).connect(chop.gain);
  o.connect(filt(c, 'bandpass', 1200, 1)).connect(chop).connect(env(c, t, 0.08, 0.02, 0.2, 0.08)).connect(m.sfxBus);
  for (const n of [o, l]) { n.start(t); n.stop(t + 0.35); }
}

// Somebody building somewhere in view: three distant hammer taps.
export function hammer(m, t) {
  const f = rnd(900, 1300);
  for (let k = 0; k < 3; k++) tick(m, t + k * rnd(0.16, 0.2), f, 0.35, 0.04, 6);
}

// Planning Board submission: paper shuffle and a stamp.
export function submit(m, t) {
  const c = m.ctx;
  noiseSrc(m, t, 0.25).connect(filt(c, 'bandpass', 3500, 0.8)).connect(env(c, t, 0.08, 0.03, 0.05, 0.15)).connect(m.sfxBus);
  tone(m, t + 0.25, 'sine', 170, 60, 0.09, 0.2);
  tick(m, t + 0.25, 3000, 0.1, 0.03, 2);
}

// 117 Irving St in season: an organ chord and a theremin swoop.
export function spooky(m, t) {
  for (const f of [146.8, 174.6, 220, 277.2]) {
    tone(m, t, 'sawtooth', f, f, 1.6, 0.04);
  }
  const c = m.ctx;
  const o = c.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(500, t + 0.2);
  o.frequency.exponentialRampToValueAtTime(900, t + 0.7);
  o.frequency.exponentialRampToValueAtTime(420, t + 1.5);
  const v = c.createOscillator();
  v.frequency.value = 6;
  const vg = c.createGain();
  vg.gain.value = 14;
  v.connect(vg).connect(o.frequency);
  o.connect(env(c, t + 0.2, 0.09, 0.15, 0.8, 0.4)).connect(m.sfxBus);
  for (const n of [o, v]) { n.start(t + 0.2); n.stop(t + 1.7); }
}

// Snow: a soft chime.
export function snow(m, t) {
  for (const [dt, f] of [[0, 2093], [0.15, 2637], [0.32, 3136]]) bell(m, t + dt, f, 0.03, 0.8);
}
