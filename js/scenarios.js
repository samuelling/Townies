// Terms of office: scenarios with goals and deadlines, plus Council contract reviews every three years.
import { CFG } from './config.js';
import { termSnapshot } from './report.js';
import { makeProj } from './geo.js';
import { PEER_CENTERS, MIX_RADIUS_M } from './peers.js';
import { shopMargin, lotMarket } from './storefronts.js';
import { ROUTES, routeTiles } from './transit.js';

const squareSig = (sim) => {
  const c = PEER_CENTERS.find((p) => p.id === 'wt-square');
  const [x, y] = makeProj(sim.w.bbox).toGrid(c.lat, c.lon);
  return sim.mixAt(x, y, MIX_RADIUS_M / 16).sig;
};

// ---- where to look: the lots that matter for a goal, for the map overlay in "Your term" ----
export const SPOT_KIND = {
  auto: { label: 'Auto-oriented lot (car lot, body shop, gas station)', rgb: [235, 96, 30] },
  vacant: { label: 'Empty storefront', rgb: [250, 205, 40] },
  risk: { label: 'Independent shop at risk', rgb: [214, 52, 160] },
  site: { label: 'Redevelopment site near a bus route or the Square', rgb: [50, 130, 235] },
};
const squareXY = (sim) => {
  const c = PEER_CENTERS.find((p) => p.id === 'wt-square');
  return makeProj(sim.w.bbox).toGrid(c.lat, c.lon);
};
const nearSquare = (sim, lot, r = MIX_RADIUS_M / CFG.TILE_M) => { const [x, y] = squareXY(sim); return Math.hypot(lot.cx - x, lot.cy - y) <= r; };
const live = (sim) => sim.w.lots.filter((l) => !l.dead && l.inTown && !l.under);
export const SPOTS = {
  auto: (sim) => live(sim).filter((l) => l.auto && !l.evClosed).map((l) => [l.id, 'auto']),
  vacant: (sim, near) => live(sim).filter((l) => l.storefronts && l.vacant > 0 && (!near || nearSquare(sim, l))).map((l) => [l.id, 'vacant']),
  risk: (sim, near) => live(sim).filter((l) => l.sf && l.sf.length && (!near || nearSquare(sim, l))).filter((l) => { const m = lotMarket(sim, l); return l.sf.some((sh) => !sh.chain && !sh.popup && shopMargin(sim, l, sh, m).margin < 0.05); }).map((l) => [l.id, 'risk']),
  site: (sim) => {
    const onRoute = new Set();
    for (const r of ROUTES) for (const i of routeTiles(sim, r)) onRoute.add(i);
    const W = sim.w.W;
    const near = (l) => nearSquare(sim, l, 45) || l.tiles.some((i) => [i, i - 1, i + 1, i - W, i + W, i - 2, i + 2, i - 2 * W, i + 2 * W].some((q) => onRoute.has(q)));
    return live(sim).filter((l) => !l.project && l.area >= 1500 && !(l.units > 4) && (l.auto || l.zone === 3 || (l.zone === 2 && (l.dens || 0) <= 2) || l.hist === 'parking') && near(l)).map((l) => [l.id, 'site']);
  },
};
export function goalSpots(sim, ids) {
  const out = new Map();
  for (const id of ids) for (const [li, k] of id(sim)) if (!out.has(li)) out.set(li, k);
  return out;
}

export const TERMS = {
  sandbox: {
    title: 'City Manager (sandbox)', years: 0, icon: '🏛',
    blurb: 'No mission, no deadline. Keep the Council happy and the budget balanced, and run Watertown your way.',
    goals: [],
  },
  autorow: {
    title: 'Auto Row to Main Street', years: 6, icon: '🚗',
    blurb: 'Decades of zoning left Watertown with a glut of repair shops, car lots and parking where a main street should be. Turn at least eight auto-oriented parcels into places people walk to, and make sure they do: walking trips in town have to rise 4% — without losing the room.',
    goals: [
      { how: 'Use the Redevelop tool (🏗) to drag a box over car lots, body shops and gas stations and propose homes and shops there. Each converted lot counts once its project opens, so start early: hearings and construction take months.', spots: [SPOTS.auto], id: 'auto', label: 'Auto-oriented parcels converted', target: 8, measure: (s) => s.autoConverted || 0, fmt: (v) => `${v}` },
      // the outcome, not the scoring: converting a lot only counts if people then walk there (js/streetlife.js)
      { how: 'People walk when shops are close to where they live: put homes and storefronts on the converted lots, keep empty storefronts filled (Main Street → Storefronts for lease), and make the streets around them pleasant.', spots: [SPOTS.vacant, SPOTS.auto], id: 'walk', label: 'Walking trips', target: 0.04, measure: (s) => walkGain(s), fmt: (v) => `${v >= 0 ? '+' : '−'}${Math.abs(v * 100).toFixed(1)}%` },
    ],
    floor: { approval: 45 },
  },
  vibrancy: {
    title: 'The Vibrancy Mandate', years: 5, icon: '☕',
    blurb: 'The Council wants the Square to feel alive again: coffee, books, galleries, people on the sidewalk at 9 p.m. Left alone, Main Street loses a couple of points over five years. Raise Vibrancy by 2 instead, and keep approval above 45 while you do it.',
    goals: [
      { how: 'Street life comes from open storefronts, especially independents, and people living within a walk of them. Fill empty ones (Storefronts for lease), protect the shops at risk (rent relief, the legacy registry), zone parking lots and car lots near the Square for mixed use with the ground-floor rules on, and consider a Main Street infill project or a plaza.', spots: [SPOTS.vacant, SPOTS.risk], id: 'vib', label: 'Vibrancy gain', target: 2, measure: (s) => s.vibrancy - s.base.vib0, fmt: (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}` },
      { how: 'Signature shops are cafés, bakeries, bookshops, boutiques, galleries and record stores. When you sign a tenant, pick the ★ ones; keep rents in reach with rent relief or chain limits.', spots: [SPOTS.vacant, SPOTS.risk], id: 'sig', label: 'Signature shops citywide', target: (s) => (s.scenario.start.sig || 50) + 20, measure: (s) => (s.sfStats ? s.sfStats.sig : 0), fmt: (v) => `${v}` },
    ],
    floor: { approval: 45 },
  },
  homes: {
    title: '1,701 Homes', years: 6, icon: '🏘',
    blurb: 'The state says Watertown must make room for at least 1,701 homes near transit. Build them — without killing what is left of the Square. Vibrancy may not fall more than 2 points.',
    goals: [
      { how: 'Redevelop parking lots, auto lots and old industrial sites near the bus routes and the Square into apartments, or zone them dense residential. Big sites add homes fastest; every project needs a hearing.', spots: [SPOTS.site], id: 'homes', label: 'New homes', target: 1701, measure: (s) => s.units - (s.scenario.start.units || s.units), fmt: (v) => `${Math.round(v)}` },
      { how: "Build homes without bulldozing storefronts: pick sites without shops, and keep the Square's storefronts filled and its independents open.", spots: [SPOTS.risk, SPOTS.vacant], id: 'vibkeep', label: 'Vibrancy change', target: -2, measure: (s) => s.vibrancy - s.base.vib0, fmt: (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}`, keep: true },
    ],
    floor: { approval: 40 },
  },
  moody: {
    title: 'Catch Moody Street', years: 7, icon: '📚',
    blurb: "Waltham's Moody Street has nearly twice the signature independents of Watertown Square within a seven-minute walk. Close the gap.",
    goals: [
      { how: 'Within a seven-minute walk of the Square: fill empty storefronts with ★ independents (Storefronts for lease), keep rents in reach (rent relief, chain limits), and bring more people within a walk.', spots: [(s) => SPOTS.vacant(s, true), (s) => SPOTS.risk(s, true)], id: 'sqsig', label: 'Signature shops near the Square', target: (s) => { const p = (s.peersRef || []).find((c) => c.id === 'moody'); return p ? p.sig : 45; }, measure: squareSig, fmt: (v) => `${v}` },
    ],
    floor: { approval: 40 },
  },
  labbust: {
    title: 'The Lab Bust', years: 4, icon: '🧪',
    blurb: 'The life-science boom is over. Half-empty lab buildings are appealing their assessments and the tax base is wobbling. Keep the budget out of the red every year, keep empty storefronts to about one in nine (around 46 today), and do it without an override. Expect to trim department budgets.',
    setup: (s) => {
      s.demandMod.I = -0.9;
      for (const l of s.w.lots) if (!l.dead && l.zone === 3 && l.dens >= 3) { l.occ *= 0.6; l.baseBldg *= 0.7; }
      s.flags.labs = 3;
      // lab owners win assessment appeals: refunds come out of reserves, and the hit to new growth lingers
      s.funds -= 9e6;
      s.recurring.abate = { label: 'Lab assessment abatements', monthly: 450000, until: s.t + 36 };
      s.base.other *= 0.95;
      s.approvalOff.homeowners -= 3;
    },
    goals: [
      { how: "Watch the Budget: hold off on big projects and new civic buildings, collect fees where you can, and don't let reserves dip below zero at the end of a December.", spots: [], id: 'solvent', label: 'Years ending in the black', target: 4, measure: (s) => s.scenario.blackYears || 0, fmt: (v) => `${v}` },
      { how: "Sign tenants for empty storefronts (Storefronts for lease), letting chains in where independents can't pay; a vacancy fee pushes landlords to cut their asks.", spots: [SPOTS.vacant], id: 'vac', label: 'Empty storefronts (at most 11%)', target: (s) => Math.round(0.11 * ((s.scenario.start.sf || 373))), measure: (s) => (s.sfStats ? s.sfStats.vacant : 0), fmt: (v) => `${v}`, max: true },
    ],
    fail: (s) => (s.overrides || 0) > 0 ? 'You asked voters for an override.' : null,
    floor: { approval: 40 },
  },
  boom: {
    title: 'Before the Boom', years: 26, icon: '⏪', start: 2000, noEarly: true,
    blurb: 'It’s 2000. The Arsenal Mall is aging, Pleasant Street is warehouses and body shops, and Kendall Square hasn’t spilled over the river yet. For 26 years you face the decisions that made today’s Watertown. Beat history: reach 2026 with at least as many homes as the real town has, more signature shops near the Square, and fewer auto-oriented parcels.',
    goals: [
      { how: 'Say yes to housing: redevelop parking, auto and industrial sites near the bus routes, and zone for density.', spots: [SPOTS.site], id: 'homes', label: 'Homes (at least real 2026)', target: (s) => (s.w.real ? s.w.real.units : 15000), measure: (s) => s.units, fmt: (v) => fmtK(v) },
      { how: 'Signature shops within a seven-minute walk of the Square: fill empty storefronts there with ★ independents and keep the ones you have.', spots: [(s) => SPOTS.vacant(s, true), (s) => SPOTS.risk(s, true)], id: 'sqsig', label: 'Signature shops near the Square (beat real 2026)', target: (s) => { const p = (s.peersRef || []).find((c) => c.id === 'wt-square'); return (p ? p.sig : 28) + 1; }, measure: squareSig, fmt: (v) => `${v}` },
      { how: 'Redevelop car lots, body shops and gas stations (Redevelop tool) as history offers them.', spots: [SPOTS.auto], id: 'auto', label: 'Auto-oriented parcels (at most real 2026)', target: (s) => (s.w.real ? s.w.real.auto : 60), measure: (s) => autoCount(s), fmt: (v) => `${v}`, max: true },
    ],
    floor: { approval: 35 },
  },
  rents: {
    title: "The Rent's Too High", years: 5, icon: '🏷',
    blurb: 'Word is out that Watertown is "the next Somerville." Landlords on Main St and Mt Auburn St are already asking 30% more. Keep at least 92% of the independent storefronts open over the next five years, and keep the Square as lively as it is today.',
    setup: (s) => {
      s.hype = 0.1; // the buzz is just starting; it builds on its own from here
      for (const l of s.w.lots) if (l.storefronts && !l.dead) l.ask = (l.ask || 1) * 1.3;
    },
    goals: [
      { how: 'Rents are jumping 30%. Rent relief and the legacy registry buy your independents time, chain limits keep credit tenants out of the Square and Main St, and when a space empties, sign an independent before a chain gets it.', spots: [SPOTS.risk, SPOTS.vacant], id: 'indie', label: 'Independent storefronts', target: (s) => Math.ceil(0.92 * (s.scenario.start.indie || 330)), measure: (s) => (s.sfStats ? s.sfStats.indie : 0), fmt: (v) => `${v}`, keep: true },
      { how: 'Keep the Square as lively as it is: fill empty storefronts and keep its independents open.', spots: [(s) => SPOTS.vacant(s, true), (s) => SPOTS.risk(s, true)], id: 'vibkeep', label: 'Vibrancy change', target: 0, measure: (s) => s.vibrancy - s.base.vib0, fmt: (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}`, keep: true },
    ],
    floor: { approval: 40 },
  },
};

const fmtK = (v) => Math.round(v).toLocaleString();
function walkGain(s) {
  const a = s.scenario && s.scenario.snap0 && s.scenario.snap0.walkTrips;
  return a && s.streetLife ? s.streetLife.trips / a - 1 : 0;
}
function autoCount(s) {
  if (s._autoT === s.t) return s._autoN;
  let n = 0;
  for (const l of s.w.lots) if (!l.dead && l.inTown && l.auto && !l.evClosed) n++;
  s._autoT = s.t;
  s._autoN = n;
  return n;
}
const tgt = (g, s) => (typeof g.target === 'function' ? g.target(s) : g.target);
export function goalStatus(sim) {
  const sc = sim.scenario;
  if (!sc) return [];
  const T = TERMS[sc.id];
  return T.goals.map((g) => {
    const v = g.measure(sim);
    const t = tgt(g, sim);
    const met = g.max ? v <= t : g.keep ? v >= t : v >= t;
    const prog = g.max ? (v <= t ? 1 : Math.max(0, 1 - (v - t) / Math.max(1, t))) : g.keep ? (v >= t ? 1 : 0) : Math.max(0, Math.min(1, v / Math.max(1e-6, t)));
    return { ...g, value: v, target: t, met, prog };
  });
}

export function startScenario(sim, id, peers) {
  const T = TERMS[id] || TERMS.sandbox;
  sim.peersRef = peers ? peers.centers : null;
  sim.scenario = {
    id, startT: sim.t, deadline: T.years ? sim.t + T.years * 12 : null,
    start: { units: sim.units, indie: sim.sfStats ? sim.sfStats.indie : 0, sig: sim.sfStats ? sim.sfStats.sig : 0, sf: sim.sfStats ? (sim.sfStats.open || 0) + (sim.sfStats.vacant || 0) : 0, vib: sim.vibrancy },
    lowMonths: 0, reviews: [], blackYears: 0, done: null, nextReview: sim.t + 36,
  };
  if (T.setup) T.setup(sim);
  sim.computeAll();
  sim.updateApproval();
  sim.scenario.snap0 = termSnapshot(sim);
  sim.news(`New term: ${T.title}`, T.blurb, 'big');
}

// called monthly; returns an event for the UI (review / win / loss) or null
export function scenarioMonthly(sim) {
  const sc = sim.scenario;
  if (!sc || sc.done) return null;
  const T = TERMS[sc.id];
  if (T.floor && sim.approval < T.floor.approval) sc.lowMonths++;
  else sc.lowMonths = Math.max(0, sc.lowMonths - 1);
  if (sim.m === 0 && sim.t > sc.startT) {
    if (sim.funds >= 0) sc.blackYears++;
  }
  const fail = T.fail && T.fail(sim);
  if (fail) return finish(sim, false, fail);
  if (T.floor && sc.lowMonths >= 9) return finish(sim, false, `Approval stayed under ${T.floor.approval}% for nine months.`);
  const goals = goalStatus(sim);
  // early win when every goal is met (and "keep" goals hold)
  if (goals.length && goals.every((g) => g.met) && !goals.every((g) => g.keep || g.max)) {
    const allNonKeep = goals.filter((g) => !g.keep && !g.max);
    if (allNonKeep.length && allNonKeep.every((g) => g.met) && sc.id !== 'labbust' && !T.noEarly) return finish(sim, true);
  }
  if (sc.deadline != null && sim.t >= sc.deadline) return finish(sim, goals.every((g) => g.met), goals.every((g) => g.met) ? null : 'Time ran out before every goal was met.');
  if (sim.t >= sc.nextReview) {
    sc.nextReview += 36;
    return review(sim);
  }
  return null;
}

function review(sim) {
  const sc = sim.scenario;
  const H = sim.history.slice(-12);
  const avgAppr = H.length ? H.reduce((a, h) => a + h.approval, 0) / H.length : sim.approval;
  const goals = goalStatus(sim);
  const elapsed = sc.deadline ? (sim.t - sc.startT) / (sc.deadline - sc.startT) : 1;
  const onTrack = goals.length ? goals.filter((g) => g.keep || g.max ? g.met : g.prog >= elapsed * 0.7).length / goals.length : 1;
  let score = 0;
  score += avgAppr >= 55 ? 2 : avgAppr >= 45 ? 1 : 0;
  score += sim.funds >= 0 ? 1 : 0;
  score += onTrack >= 0.99 ? 2 : onTrack >= 0.5 ? 1 : 0;
  const grade = score >= 5 ? 'A' : score >= 4 ? 'B' : score >= 3 ? 'C' : score >= 2 ? 'D' : 'F';
  const rec = { t: sim.t, date: sim.dateStr(), grade, approval: Math.round(avgAppr), funds: sim.funds, onTrack };
  sc.reviews.push(rec);
  if (grade === 'F') return finish(sim, false, 'The Council voted not to renew your contract.');
  sim.news(`Council renews City Manager's contract (grade ${grade})`, `Average approval ${Math.round(avgAppr)}%, reserves ${sim.funds >= 0 ? 'positive' : 'in the red'}${goals.length ? `, goals ${Math.round(onTrack * 100)}% on track` : ''}.`, 'big');
  return { type: 'review', rec };
}

function finish(sim, won, why = null) {
  const sc = sim.scenario;
  const goals = goalStatus(sim);
  let stars = 0;
  if (won) {
    stars = 1;
    const early = sc.deadline ? (sc.deadline - sim.t) / (sc.deadline - sc.startT) : 0;
    const margin = goals.filter((g) => !g.keep && !g.max).every((g) => g.value >= g.target * 1.25);
    if (early > 0.2 || margin) stars = 2;
    if (early > 0.2 && sim.approval >= 55) stars = 3;
  }
  sc.done = { won, stars, why, t: sim.t, date: sim.dateStr() };
  return { type: won ? 'win' : 'lose', stars, why, goals };
}

export { CFG };
