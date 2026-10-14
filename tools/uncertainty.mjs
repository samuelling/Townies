// Uncertainty bands: run the next ten years many times with the model's uncertain knobs drawn from
// plausible ranges, under a few simple strategies, and record the spread of outcomes. The same parameter
// draws are reused for every strategy, so strategies are compared draw by draw ("does B beat A even
// when the model is wrong in this particular way?").
//
//   node tools/uncertainty.mjs [--draws 16] [--years 10] [--part 0/2] [--out file]
//   node tools/uncertainty.mjs --merge a.json b.json ...      -> data/uncertainty.json
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expandSnapshot } from '../js/snapshot.js';
import { buildWorld } from '../js/world.js';
import { Sim, GROWTH, FISCAL } from '../js/sim.js';
import { SF, resetGreed } from '../js/storefronts.js';
import { PROGRAMS, analyze, evaluate, hearingScore, hearingOdds, submit, projectName } from '../js/projects.js';
import { rng } from '../js/util.js';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };

// what is uncertain, and over what range (uniform draws)
export const RANGES = {
  regional: { label: 'Regional price growth after 2026', lo: 0.02, hi: 0.06, fmt: (v) => `${(v * 100).toFixed(1)}%/yr` },
  buzz: { label: '“On the rise” buzz (thesis strength)', lo: 0, hi: 1, fmt: (v) => `${Math.round(v * 100)}%` },
  prospectors: { label: 'Share of speculating landlords', lo: 0, hi: 0.3, fmt: (v) => `${Math.round(v * 100)}%` },
  indieExit: { label: 'Independent shop closures', lo: 0.004, hi: 0.008, fmt: (v) => `${(v * 1200).toFixed(1)}%/yr` },
  chainFill: { label: 'Chains winning an affordable space', lo: 0, hi: 0.05, fmt: (v) => `${Math.round(v * 100)}%` },
  growthR: { label: 'Market homebuilding rate', lo: 0.5, hi: 1.5, fmt: (v) => `×${v.toFixed(2)}` },
  newGrowth: { label: 'New growth from renovations', lo: 0.008, hi: 0.02, fmt: (v) => `${(v * 100).toFixed(1)}% of levy` },
  costGrowth: { label: 'Department cost growth', lo: 0.03, hi: 0.042, fmt: (v) => `${(v * 100).toFixed(1)}%/yr` },
  warming: { label: 'Climate warming', lo: 0, hi: 0.8, fmt: (v) => `${v.toFixed(1)}°F/decade` },
};
export const STRATEGIES = {
  handsoff: 'Hands off',
  mainstreet: 'Main Street policies (rent relief, legacy registry, chain limits, vacancy fee)',
  build: 'Rebuild auto lots as mixed-use infill',
};

const raw = expandSnapshot(JSON.parse(gunzipSync(readFileSync(new URL('../data/watertown.json.gz', import.meta.url)))));
const base = { SF: { ...SF }, GROWTH: { ...GROWTH }, FISCAL: { ...FISCAL } };

function draw(k) {
  const r = rng(9000 + k * 7919);
  const out = {};
  for (const [key, d] of Object.entries(RANGES)) out[key] = d.lo + (d.hi - d.lo) * r();
  return out;
}
function apply(p) {
  Object.assign(SF, base.SF, { indieExit: p.indieExit, chainFill: p.chainFill });
  Object.assign(GROWTH, base.GROWTH, { R: base.GROWTH.R * p.growthR });
  Object.assign(FISCAL, base.FISCAL, { newGrowth: p.newGrowth, costGrowth: p.costGrowth });
}
const metrics = (sim) => ({
  vib: +sim.vibrancy.toFixed(2), indies: sim.sfStats.indie, chains: sim.sfStats.chain, funds: Math.round(sim.funds / 1e5) / 10,
  approval: +sim.approval.toFixed(1), homes: sim.units, walk: sim.streetLife ? sim.streetLife.trips : 0,
});

function run(p, strategy, years, k) {
  apply(p);
  const w = buildWorld(raw);
  const sim = new Sim(w, null, { seed: 500 + k });
  Object.assign(sim.assume, { regional: p.regional, buzz: p.buzz, prospectors: p.prospectors, warming: p.warming });
  resetGreed(sim);
  sim.inc.auto = { pw: true, fire: true, health: true };
  if (strategy === 'mainstreet') sim.policies = { rentRelief: true, legacy: true, formulaRetail: true, vacancyFee: true };
  const [sx, sy] = w.start;
  const autoLots = strategy === 'build' ? w.lots.filter((l) => l.inTown && !l.dead && l.auto && !l.units).sort((a, b) => Math.hypot(a.cx - sx, a.cy - sy) - Math.hypot(b.cx - sx, b.cy - sy)) : [];
  const used = new Set();
  const out = [metrics(sim)];
  for (let m = 0; m < years * 12; m++) {
    if (strategy === 'build' && m % 3 === 0 && sim.funds > 0) {
      for (const lot of autoLots.slice(0, 50)) {
        if (used.has(lot.id) || lot.project || lot.dead) continue;
        const site = analyze(sim, [lot.id]);
        if (site.holdouts.length) continue;
        const t = { ...PROGRAMS.infill.defaults };
        const o = evaluate(sim, site, 'infill', t);
        if (hearingOdds(hearingScore(sim, site, 'infill', t, o)) < 0.5) continue;
        if (!submit(sim, [lot.id], 'infill', t, projectName(sim, 'infill', site)).error) { used.add(lot.id); break; }
      }
    }
    sim.tick();
    sim.gameOver = null;
    if (sim.m === 0) out.push(metrics(sim));
  }
  return out;
}

if (args.includes('--merge')) {
  const files = args.slice(args.indexOf('--merge') + 1);
  const parts = files.map((f) => JSON.parse(readFileSync(f)));
  const runs = parts.flatMap((p) => p.runs);
  const years = parts[0].years, startY = parts[0].startY;
  const strategies = {};
  const q = (a, f) => { const s = a.slice().sort((x, y) => x - y); const i = (s.length - 1) * f, lo = Math.floor(i); return +(s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo)).toFixed(2); };
  for (const st of Object.keys(STRATEGIES)) {
    const rs = runs.filter((r) => r.strategy === st);
    const bands = {};
    for (const key of Object.keys(rs[0].traj[0])) bands[key] = rs[0].traj.map((_, yi) => { const v = rs.map((r) => r.traj[yi][key]); return [q(v, 0.1), q(v, 0.5), q(v, 0.9)]; });
    strategies[st] = { label: STRATEGIES[st], bands };
  }
  // paired comparisons at the end of the horizon
  const ends = {};
  for (const r of runs) (ends[r.draw] = ends[r.draw] || {})[r.strategy] = r.traj[r.traj.length - 1];
  const pairs = {};
  for (const st of ['mainstreet', 'build']) for (const key of ['vib', 'walk', 'indies', 'funds', 'approval', 'homes']) {
    const ds = Object.values(ends).filter((e) => e[st] && e.handsoff);
    pairs[`${st}:${key}`] = +(ds.filter((e) => e[st][key] > e.handsoff[key]).length / Math.max(1, ds.length)).toFixed(2);
  }
  // which uncertain knob matters most for vibrancy under hands-off (rank correlation)
  const ho = runs.filter((r) => r.strategy === 'handsoff');
  const rank = (a) => { const idx = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]); const rk = new Array(a.length); idx.forEach(([, i], k) => (rk[i] = k)); return rk; };
  const corr = (a, b) => { const n = a.length, ma = a.reduce((s, v) => s + v, 0) / n, mb = b.reduce((s, v) => s + v, 0) / n; let sab = 0, saa = 0, sbb = 0; for (let i = 0; i < n; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) ** 2; sbb += (b[i] - mb) ** 2; } return saa && sbb ? sab / Math.sqrt(saa * sbb) : 0; };
  // standardized rank regression: each knob's effect with the others held fixed, so knobs that happen to be
  // correlated in a small sample don't borrow each other's credit
  const solve = (A, b) => { const n = b.length; const M = A.map((row, i) => row.concat([b[i]])); for (let c = 0; c < n; c++) { let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r; [M[c], M[p]] = [M[p], M[c]]; if (Math.abs(M[c][c]) < 1e-12) continue; for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; } } return M.map((row, i) => (Math.abs(row[i]) < 1e-12 ? 0 : row[n] / row[i])); };
  const z = (a) => { const m = a.reduce((s, v) => s + v, 0) / a.length, sd = Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length) || 1; return a.map((v) => (v - m) / sd); };
  const knobs = Object.keys(RANGES);
  const X = knobs.map((p) => z(rank(ho.map((r) => r.params[p]))));
  const drivers = {};
  for (const key of ['vib', 'walk', 'indies', 'funds']) {
    const y = z(rank(ho.map((r) => r.traj[r.traj.length - 1][key])));
    const XtX = knobs.map((_, i) => knobs.map((_, j) => X[i].reduce((s, v, k) => s + v * X[j][k], 0) + (i === j ? 0.5 : 0))); // a touch of ridge for 9 knobs and few runs
    const Xty = knobs.map((_, i) => X[i].reduce((s, v, k) => s + v * y[k], 0));
    const beta = solve(XtX, Xty);
    drivers[key] = knobs.map((p, i) => [p, +beta[i].toFixed(2), +corr(X[i], y).toFixed(2)]).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  }
  const out = { generated: new Date().toISOString(), startY, years, draws: Object.keys(ends).length, ranges: Object.fromEntries(Object.entries(RANGES).map(([k, d]) => [k, { label: d.label, lo: d.lo, hi: d.hi }])), strategies, pairs, drivers };
  writeFileSync(new URL('../' + opt('out', 'data/uncertainty.json'), import.meta.url), JSON.stringify(out));
  console.log('merged', runs.length, 'runs;', JSON.stringify(pairs), JSON.stringify(drivers.vib.slice(0, 3)));
  process.exit(0);
}

const DRAWS = +opt('draws', 16), YEARS = +opt('years', 10);
const [part, nParts] = (opt('part', '0/1')).split('/').map(Number);
const runs = [];
const t0 = Date.now();
for (let k = part; k < DRAWS; k += nParts) {
  const p = draw(k);
  for (const st of Object.keys(STRATEGIES)) {
    const traj = run(p, st, YEARS, k);
    runs.push({ draw: k, strategy: st, params: p, traj });
    const e = traj[traj.length - 1];
    console.log(`draw ${k} ${st.padEnd(10)} vib ${e.vib} indies ${e.indies} chains ${e.chains} funds ${e.funds}M appr ${e.approval} homes ${e.homes}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
}
writeFileSync(opt('out', `uncertainty-part${part}.json`), JSON.stringify({ startY: 2026, years: YEARS, runs }));
