// History check: start the game in 2000, run it to 2026, and compare with what really happened.
//
//   node tools/validate.mjs [--runs 4] [--out data/validation.json] [--quick]
//
// Three ways of running 2000 -> 2026:
//   replay   every building that really went up after 2000 is put back in the year it was built;
//            the market builds nothing extra. Tests prices, storefront churn and traffic, given the real
//            built form.
//   history  only the big real decisions are made (Pleasant St rezoned, Arsenal Mall redeveloped as
//            proposed, body-shop permits granted); everything else is left to the simulated market.
//            Tests how much the model builds, and where.
//   handsoff nobody decides anything.
// Plus a traffic hold-out test on today's map: hide a fifth of the MassDOT counts, calibrate on the rest,
// and predict the hidden ones.
//
// Reference data (outside the game's own snapshot) is listed in REF with sources.
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expandSnapshot } from '../js/snapshot.js';
import { buildWorld } from '../js/world.js';
import { Sim, GROWTH } from '../js/sim.js';
import { ZONE } from '../js/config.js';
import { rewindWorld, restoreLot } from '../js/history.js';
import { seedStorefronts, SF, resetGreed } from '../js/storefronts.js';
import { nextScenario } from '../js/events.js';
import { autoUse } from '../js/vibrancy.js';

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf('--' + k);
  return i >= 0 ? args[i + 1] : d;
};
const RUNS = +opt('runs', args.includes('--quick') ? 1 : 4);
const OUT = opt('out', 'data/validation.json');
const MODES = (opt('modes', 'replay,history,handsoff')).split(',');
// --assume buzz=0.5,chainTilt=1   --sf indieExit=0.006   --preset neutral
const kv = (str) => Object.fromEntries((str || '').split(',').filter(Boolean).map((p) => { const [k, v] = p.split('='); return [k, +v]; }));
const ASSUME = kv(opt('assume', ''));
Object.assign(SF, kv(opt('sf', '')));
Object.assign(GROWTH, kv(opt('growth', '')));
const PRESET = opt('preset', 'thesis');

export const REF = {
  census: {
    2000: { pop: 32986, units: 15008 },
    2010: { pop: 31915 },
    2020: { pop: 35329, units: 16936 },
    src: 'US Census 2000, 2010 and 2020 (2020 units: year-round housing units, MA EOHLC production goals table)',
  },
  // NeighborhoodScout repeat-sales home value index for Watertown, 2000 Q1 to 2025 Q4: +187.6%
  homeValue: { ratio: 2.876, src: 'NeighborhoodScout home appreciation for Watertown, 2000 Q1–2025 Q4 (+187.6%)' },
};
const HIST_CHOICE = { 'auto-permit': 0, 'pleasant-st': 1, 'arsenal-mall': 0 };

const raw = expandSnapshot(JSON.parse(gunzipSync(readFileSync(new URL('../data/watertown.json.gz', import.meta.url)))));
const quiet = { seed: 1 };

function metrics(sim) {
  const w = sim.w;
  let units = 0, valR = 0, valC = 0, auto = 0, labs = 0;
  for (const lot of w.lots) {
    if (lot.dead || !lot.inTown) continue;
    if (lot.zone === ZONE.R || lot.mixed) units += lot.units || 0;
    const v = lot.landVal + lot.bldgVal + (lot.otherVal || 0);
    if (lot.zone === ZONE.C || lot.zone === ZONE.I) valC += v;
    else if (lot.zone === ZONE.R || lot.zone === ZONE.PARK || lot.zone === ZONE.NONE) valR += v;
    if (lot.auto ?? autoUse(lot.code3)) auto++;
    if (lot.zone === ZONE.I && lot.dens >= 3) labs++;
  }
  const sf = sim.sfStats || {};
  return {
    y: sim.y, units, pop: Math.round(sim.pop), jobs: Math.round(sim.jobs), valR, valC, auto, labs,
    shops: sf.open || 0, chains: sf.chain || 0, indies: sf.indie || 0, sig: sf.sig || 0, vacant: sf.vacant || 0,
    funds: Math.round(sim.funds / 1e6), levy: Math.round(sim.levyLimit / 1e6),
    vib: +sim.vibrancy.toFixed(1), market: +(sim.market || 1).toFixed(3), cong: +(sim.congAvg || 0).toFixed(3),
  };
}

// value of the same, untouched residential lots in both years: a repeat-sales style index
function sameLotIndex(sim, start) {
  let a = 0, b = 0;
  for (const lot of sim.w.lots) {
    if (lot.dead || !lot.inTown || lot.zone !== ZONE.R || lot.built > 0 || lot.locked || lot.reconstructed) continue;
    const v0 = start.get(lot.id);
    if (!v0) continue;
    a += v0;
    b += lot.landVal + lot.bldgVal + (lot.otherVal || 0);
  }
  return a ? b / a : NaN;
}

function runOnce(mode, seed) {
  const w = buildWorld(raw);
  w.preset = PRESET;
  rewindWorld(w, 2000);
  const sim = new Sim(w, null, { seed });
  Object.assign(sim.assume, ASSUME);
  if ('prospectors' in ASSUME) resetGreed(sim);
  const start = new Map();
  for (const lot of w.lots) if (!lot.dead && lot.inTown && lot.zone === ZONE.R) start.set(lot.id, lot.landVal + lot.bldgVal + (lot.otherVal || 0));
  if (mode === 'replay') sim.marketBuild = false;
  const traj = [metrics(sim)];
  const built = new Set();
  const decided = [];
  const replayDue = () => {
    let n = 0;
    for (const [id, f] of w.future) {
      if (f.year > sim.y) continue;
      const lot = w.lots[id];
      restoreLot(sim, lot);
      seedStorefronts(sim, lot);
      n++;
    }
    if (n) {
      sim.recalc();
      sim.walkDirty = true;
      sim.reassign(true);
    }
  };
  const months = (2026 - 2000) * 12;
  for (let m = 0; m < months; m++) {
    if (mode === 'replay' && sim.m === 0) replayDue();
    sim.tick();
    sim.gameOver = null;
    if (mode === 'history') {
      const n = nextScenario(sim);
      if (n && HIST_CHOICE[n.sc.id] != null) {
        const ch = n.sc.choices[HIST_CHOICE[n.sc.id]];
        ch.run(sim, n.ctx);
        decided.push(`${sim.y} ${n.sc.id}: ${ch.label}`);
      }
    }
    if (sim.m === 0) traj.push(metrics(sim));
  }
  for (const lot of w.lots) if (!lot.dead && lot.inTown && (lot.built > 0 || (lot.locked && mode !== 'replay'))) built.add(lot.id);
  return { mode, seed, traj, end: metrics(sim), sameLot: sameLotIndex(sim, start), built, realChanged: new Set(rewound(w)), decided, trafFit: sim.base.trafFit, growthLog: sim.growthLog || {} };
}
function rewound(w) {
  const out = [];
  for (const lot of w.lots) if (lot.reconstructed || lot.histChanged) out.push(lot.id);
  return out;
}

// AUC: probability a lot that really changed scores higher than one that didn't
function auc(scores, labels) {
  const idx = scores.map((s, i) => i).sort((a, b) => scores[a] - scores[b]);
  let rank = 0, sumPos = 0, nPos = 0, i = 0;
  while (i < idx.length) {
    let j = i;
    while (j < idx.length && scores[idx[j]] === scores[idx[i]]) j++;
    const r = (i + j + 1) / 2;
    for (let k = i; k < j; k++) if (labels[idx[k]]) { sumPos += r; nPos++; }
    rank = j;
    i = j;
  }
  void rank;
  const nNeg = labels.length - nPos;
  return nPos && nNeg ? (sumPos - (nPos * (nPos + 1)) / 2) / (nPos * nNeg) : NaN;
}

// Traffic: 5-fold hold-out on today's map, folding by counted segment (same count value) so neighbours
// of a hidden count aren't used to predict it.
function trafficHoldout() {
  const w = buildWorld(raw);
  const sim = new Sim(w, null, quiet);
  const real = Float32Array.from(w.aadt);
  const counted = Array.from(sim.roadList).filter((i) => real[i] > 0 && w.inTown[i]);
  const groups = [...new Set(counted.map((i) => real[i]))];
  const fold = new Map(groups.map((g, k) => [g, Math.floor(((Math.sin(k * 12.9898) * 43758.5453) % 1 + 1) % 1 * 5)]));
  const pred = [], obs = [], naive = [], raw0 = [];
  const byClass = {};
  for (const i of counted) (byClass[w.road[i]] = byClass[w.road[i]] || []).push(real[i]);
  for (let f = 0; f < 5; f++) {
    const hide = counted.filter((i) => fold.get(real[i]) === f);
    const train = counted.filter((i) => fold.get(real[i]) !== f);
    for (const i of hide) w.aadt[i] = 0;
    sim.calF = null;
    sim.V0 = null;
    sim.calibrateTraffic(sim.traffic);
    const cls = {};
    for (const i of train) (cls[w.road[i]] = cls[w.road[i]] || []).push(real[i]);
    const med = (a) => (a && a.length ? a.slice().sort((x, y) => x - y)[a.length >> 1] : 5000);
    for (const i of hide) {
      pred.push(sim.V0[i]);
      raw0.push(sim.M0[i]);
      naive.push(med(cls[w.road[i]]));
      obs.push(real[i]);
    }
    for (const i of hide) w.aadt[i] = real[i];
  }
  const score = (p) => {
    const a = p.map((v) => Math.log(Math.max(1, v))), b = obs.map((v) => Math.log(v));
    const mb = b.reduce((s, v) => s + v, 0) / b.length;
    let ss = 0, st = 0;
    const ape = [];
    for (let k = 0; k < a.length; k++) {
      ss += (b[k] - a[k]) ** 2;
      st += (b[k] - mb) ** 2;
      ape.push(Math.abs(p[k] / obs[k] - 1));
    }
    ape.sort((x, y) => x - y);
    return { r2: +(1 - ss / st).toFixed(3), medianError: +ape[ape.length >> 1].toFixed(3) };
  };
  return { tiles: obs.length, segments: groups.length, calibrated: score(pred), modelOnly: score(raw0), classMedian: score(naive) };
}

const t0 = Date.now();
// --merge thesis.json neutral.json: combine two runs into the file the game reads (data/validation.json)
if (args.includes('--merge')) {
  const i = args.indexOf('--merge');
  const [a, b] = [args[i + 1], args[i + 2]].map((f) => JSON.parse(readFileSync(f)));
  const merged = { generated: a.generated, ref: a.ref, real2026: a.real2026, start2000: a.start2000, traffic: a.traffic, sf: a.sf, growth: a.growth, runs: a.runs, thesis: a.modes, neutral: b.modes };
  writeFileSync(new URL('../' + OUT, import.meta.url), JSON.stringify(merged));
  console.log('merged into', OUT);
  process.exit(0);
}
if (args.includes('--traffic-only')) {
  console.log(JSON.stringify(trafficHoldout(), null, 1));
  process.exit(0);
}
const realSim = new Sim(buildWorld(raw), null, quiet);
const real2026 = metrics(realSim);
const out = { generated: new Date().toISOString(), runs: RUNS, preset: PRESET, assume: ASSUME, sf: { ...SF }, growth: { ...GROWTH }, ref: REF, real2026, modes: {} };
console.log('real 2026 (model-measured):', JSON.stringify(real2026));

let start2000 = null;
for (const mode of MODES) {
  const rs = [];
  for (let k = 0; k < RUNS; k++) {
    const r = runOnce(mode, 1000 + k);
    rs.push(r);
    if (!start2000) start2000 = r.traj[0];
    console.log(mode, k, 'end', JSON.stringify(r.end), 'sameLot', r.sameLot.toFixed(2), `${((Date.now() - t0) / 1000).toFixed(0)}s`);
    if (r.decided.length) console.log('   decided:', r.decided.join(' | '));
    console.log('   market built:', JSON.stringify(r.growthLog));
  }
  // spatial test: does the model redevelop the lots that really changed?
  let spatial = null;
  if (mode !== 'replay') {
    const any = rs[0];
    const ids = [];
    const w0 = buildWorld(raw);
    rewindWorld(w0, 2000);
    for (const lot of w0.lots) if (!lot.dead && lot.inTown && (lot.zone === ZONE.R || lot.zone === ZONE.C || lot.zone === ZONE.I)) ids.push(lot.id);
    const labels = ids.map((id) => (any.realChanged.has(id) ? 1 : 0));
    // big changes: anything that became more than a 4-unit house (apartments, labs, shops, the mall site)
    const bigLab = ids.map((id) => { const f = w0.future.get(id); return f && !(f.zone === ZONE.R && !f.mixed && (f.units || 0) <= 4) ? 1 : 0; });
    const freq = ids.map((id) => rs.reduce((s, r) => s + (r.built.has(id) ? 1 : 0), 0) / rs.length);
    const area = ids.map((id) => w0.lots[id].area);
    const nReal = labels.reduce((a, b) => a + b, 0);
    const nModel = freq.filter((f) => f > 0).length;
    const hits = ids.filter((id, k) => labels[k] && freq[k] > 0).length;
    spatial = {
      lots: ids.length, reallyChanged: nReal, modelChanged: nModel, overlap: hits,
      auc: +auc(freq, labels).toFixed(3), aucLotSize: +auc(area, labels).toFixed(3),
      bigChanged: bigLab.reduce((a, b) => a + b, 0), aucBig: +auc(freq, bigLab).toFixed(3), aucBigLotSize: +auc(area, bigLab).toFixed(3),
      lift: +((hits / Math.max(1, nModel)) / (nReal / ids.length)).toFixed(2),
    };
    console.log(mode, 'spatial', JSON.stringify(spatial));
  }
  const keys = Object.keys(rs[0].end).filter((k) => typeof rs[0].end[k] === 'number');
  const summary = {};
  for (const k of keys) {
    const v = rs.map((r) => r.end[k]).sort((a, b) => a - b);
    summary[k] = { min: v[0], median: v[v.length >> 1], max: v[v.length - 1] };
  }
  const yearly = rs[0].traj.map((m, i) => {
    const o = { y: m.y };
    for (const k of ['units', 'pop', 'market', 'shops', 'chains', 'indies', 'auto', 'vib', 'funds', 'levy']) {
      const v = rs.map((r) => r.traj[i] && r.traj[i][k]).filter((x) => x != null).sort((a, b) => a - b);
      o[k] = v[v.length >> 1];
    }
    return o;
  });
  out.modes[mode] = { summary, sameLot: rs.map((r) => +r.sameLot.toFixed(3)), spatial, yearly, decided: rs[0].decided };
}
out.start2000 = start2000;
out.traffic = trafficHoldout();
console.log('traffic holdout', JSON.stringify(out.traffic));
writeFileSync(OUT.startsWith('/') ? OUT : new URL('../' + OUT, import.meta.url), JSON.stringify(out, null, 1));
console.log('wrote', OUT, `${((Date.now() - t0) / 1000).toFixed(0)}s`);
