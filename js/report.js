// End-of-term report card: "the Watertown you built", one screen, easy to screenshot or copy.
import { TERMS, goalStatus } from './scenarios.js';
import { autoUse } from './vibrancy.js';
import { patternsNow } from './patterns.js';
import { retailNow } from './retail.js';
import { shiNow, housingState } from './housing.js';

const FACTIONS = ['homeowners', 'renters', 'seniors', 'business', 'commuters'];
const FLABEL = { homeowners: 'Homeowners', renters: 'Renters', seniors: 'Seniors', business: 'Business owners', commuters: 'Commuters' };

// the numbers the card compares, taken at the start of a term and again whenever the card is shown
export function termSnapshot(sim) {
  const w = sim.w;
  let auto = 0;
  for (const lot of w.lots) if (!lot.dead && lot.inTown && !lot.evClosed && (lot.auto ?? autoUse(lot.code3))) auto++;
  const [sx, sy] = w.start;
  const sq = (w.ctl || []).find((c) => c.id === 'square');
  const sf = sim.sfStats || {};
  const rt = retailNow(sim);
  return {
    t: sim.t, date: sim.dateStr(), y: sim.y,
    pop: Math.round(sim.pop), units: sim.units, jobs: Math.round(sim.jobs),
    vib: +(sim.vibrancy || 0).toFixed(1), walk: sim.walkAt ? Math.round(sim.walkAt(sx, sy)) : null,
    sig: sf.sig || 0, chains: sf.chain || 0, indies: sf.indie || 0, vacant: sf.vacant || 0, auto,
    funds: sim.funds, approval: Math.round(sim.approval),
    factions: Object.fromEntries(FACTIONS.map((f) => [f, Math.round((sim.factions || {})[f] || 0)])),
    sqDelay: sq && sq.last ? Math.round(sq.last.delay) : null, sqLos: sq && sq.last ? sq.last.los : null,
    melWins: sim.mel ? sim.mel.wins || 0 : 0,
    autoConverted: sim.autoConverted || 0,
    apl: patternsNow(sim).score,
    walkTrips: sim.streetLife ? sim.streetLife.trips : null,
    shopOut: rt ? rt.out : null, shopFar: rt ? rt.far : null,
    shi: +shiNow(sim).pct.toFixed(1), affNew: housingState(sim).affAdded,
  };
}

const money = (v) => `${v < 0 ? '−' : ''}$${Math.abs(v / 1e6).toFixed(1)}M`;
const int = (v) => Math.round(v).toLocaleString();
const sgn = (v, f = int) => (v > 0 ? '+' : v < 0 ? '−' : '±') + f(Math.abs(v));

export function reportCard(sim) {
  const sc = sim.scenario || null;
  const T = sc ? TERMS[sc.id] : null;
  const now = termSnapshot(sim);
  // games saved before report cards existed: rebuild the start from what was kept
  const h0 = sim.history && sim.history.length ? sim.history[0] : null;
  const a = (sc && sc.snap0) || {
    t: sc ? sc.startT : 0, date: '', pop: h0 ? Math.round(h0.pop) : now.pop, units: sc ? sc.start.units : now.units, jobs: h0 ? Math.round(h0.jobs) : now.jobs,
    vib: sc ? +(sc.start.vib || now.vib).toFixed(1) : now.vib, walk: null, sig: sc ? sc.start.sig : now.sig, chains: null, indies: sc ? sc.start.indie : now.indies,
    vacant: 0, auto: null, funds: h0 ? h0.funds : now.funds, approval: h0 ? Math.round(h0.approval) : now.approval, factions: null, sqDelay: null, melWins: 0, autoConverted: 0,
  };
  const years = Math.max(0, (now.t - a.t) / 12);
  const rows = [];
  const row = (label, from, to, fmt, good, note) => {
    if (from == null || to == null) return;
    const d = to - from;
    rows.push({ label, from: fmt(from), to: fmt(to), delta: d === 0 ? '±0' : sgn(d, fmt), good: d === 0 ? 0 : good(d) ? 1 : -1, note });
  };
  const up = (d) => d > 0, down = (d) => d < 0;
  row('Population', a.pop, now.pop, int, up);
  row('Homes', a.units, now.units, int, up);
  row('Affordable homes built', a.affNew, now.affNew, int, up);
  row('On the state’s affordable list (%)', a.shi, now.shi, (v) => `${v.toFixed(1)}%`, up);
  row('Jobs', a.jobs, now.jobs, int, up);
  row('Vibrancy', a.vib, now.vib, (v) => v.toFixed(1), up);
  row('Walking trips a day (estimate)', a.walkTrips, now.walkTrips, int, up);
  row('Walkability at the Square', a.walk, now.walk, int, up);
  row('Independent shops', a.indies, now.indies, int, up);
  row('Signature shops', a.sig, now.sig, int, up);
  row('Chain stores', a.chains, now.chains, int, down);
  row('Empty storefronts', a.vacant, now.vacant, int, down);
  row('Shopping by out-of-towners a year (estimate)', a.shopOut, now.shopOut, money, up);
  row('…by shoppers from 8+ km away', a.shopFar, now.shopFar, money, up);
  row('Auto-oriented parcels', a.auto, now.auto, int, down);
  row('Rush-hour delay at the Square (s)', a.sqDelay, now.sqDelay, int, down);
  row('Pattern Language fit (0–100)', a.apl, now.apl, int, up);
  row('City reserves', a.funds, now.funds, money, up);
  row('Approval', a.approval, now.approval, (v) => `${int(v)}%`, up);

  const projects = (sim.projects || []).filter((p) => p.stage === 'done' && p.start >= (a.t || 0) - 36)
    .map((p) => ({ name: p.name, prog: p.prog, homes: (p.o && p.o.homes) || 0, jobs: Math.round((p.o && p.o.jobs) || 0), shops: (p.o && p.o.storefronts) || 0 }))
    .sort((x, y) => y.homes + y.jobs / 2 + y.shops * 20 - (x.homes + x.jobs / 2 + x.shops * 20));

  const goals = sc ? goalStatus(sim) : [];
  const done = sc && sc.done;
  // grade: goals (when there are any), the town's health, the books and the room
  let score = 0, of = 0;
  if (goals.length) { score += 4 * goals.filter((g) => g.met).length / goals.length + 2 * goals.reduce((s, g) => s + g.prog, 0) / goals.length; of += 6; }
  const dv = now.vib - a.vib, di = a.indies ? (now.indies - a.indies) / a.indies : 0;
  score += dv >= 3 ? 2 : dv >= 0 ? 1.4 : dv >= -2 ? 0.8 : 0; of += 2;
  score += di >= 0 ? 1 : di >= -0.1 ? 0.6 : di >= -0.25 ? 0.3 : 0; of += 1;
  score += now.funds >= 0 ? 1.5 : now.funds > -10e6 ? 0.7 : 0; of += 1.5;
  score += now.approval >= 60 ? 1.5 : now.approval >= 50 ? 1.1 : now.approval >= 40 ? 0.6 : 0; of += 1.5;
  const frac = score / of;
  const grade = frac >= 0.88 ? 'A' : frac >= 0.75 ? 'B' : frac >= 0.6 ? 'C' : frac >= 0.45 ? 'D' : 'F';

  // factions that moved most since the start
  const moved = a.factions ? FACTIONS.map((f) => ({ f, d: now.factions[f] - a.factions[f] })).sort((x, y) => Math.abs(y.d) - Math.abs(x.d)) : [];

  return { title: T ? T.title : 'Watertown', from: a.date || '', to: now.date, years, rows, projects: projects.slice(0, 3), goals, done, grade, now, start: a, moved, headlines: headlines(sim, a, now, projects, done) };
}

function headlines(sim, a, now, projects, done) {
  const out = [];
  const dh = now.units - a.units, dv = now.vib - a.vib, dI = now.indies - a.indies, dC = a.chains != null ? now.chains - a.chains : 0;
  const dA = a.auto != null ? now.auto - a.auto : 0;
  const big = projects[0];
  if (dh >= 800) out.push(`Watertown adds ${int(dh)} homes${dv >= 0 ? ' and the Square keeps its spark' : ', but the streets feel emptier'}.`);
  else if (dh >= 200) out.push(`${int(dh)} new homes later, ${dv >= 1 ? 'the town is livelier than it has been in years' : 'the town looks a lot like it did'}.`);
  else out.push(dv >= 2 ? 'Barely a new home, but the sidewalks are full.' : 'A quiet term: hardly anything new got built.');
  if (dA <= -5) out.push(`${int(-dA)} body shops, car lots and parking lots became places people walk to.`);
  if (dI <= -25 && dC >= 15) out.push(`Chains move in as ${int(-dI)} independents close; the “for lease” signs come down with national logos behind them.`);
  else if (dI >= 15) out.push(`${int(dI)} more independent shops than when you started. Somebody is buying all that sourdough.`);
  if (big && big.homes + big.jobs > 100) out.push(`Biggest ribbon-cutting: ${big.name}${big.homes ? ` (${int(big.homes)} homes)` : big.jobs ? ` (${int(big.jobs)} jobs)` : ''}.`);
  if (now.funds < -5e6) out.push(`The books end ${money(now.funds)} in the red; the state is reading the minutes.`);
  else if (now.funds - a.funds > 20e6) out.push(`Reserves up ${money(now.funds - a.funds)}. The Finance Committee is almost smiling.`);
  if (done) out.unshift(done.won ? 'Mission accomplished.' : `Term over: ${done.why || 'not every goal was met'}`);
  return out.slice(0, 4);
}

export function reportText(rc) {
  const lines = [`TOWNIES · ${rc.title} · ${rc.from ? rc.from + ' – ' : ''}${rc.to} · Grade ${rc.grade}`];
  for (const h of rc.headlines) lines.push(`“${h}”`);
  for (const r of rc.rows) lines.push(`${r.label}: ${r.from} → ${r.to} (${r.delta})`);
  if (rc.projects.length) lines.push(`Built: ${rc.projects.map((p) => p.name).join(', ')}`);
  lines.push('Watertown, MA, as simulated in Townies (samuelling.github.io/Townies)');
  return lines.join('\n');
}

export { FLABEL };
