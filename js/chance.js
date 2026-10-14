// Less on rails. Three sources of surprise:
//   1. Council decisions land bigger or smaller than billed: each faction's reaction and each cost is drawn
//      around the stated effect (costs tend to run over more often than under).
//   2. Some decisions come back months later with a twist, good or bad.
//   3. Curveballs: things that just happen to a town (a shop goes viral, a sinkhole, a windfall, a lawsuit),
//      and a few that need a decision with uncertain odds.
import { ZONE } from './config.js';
import { clamp } from './util.js';
import { monthWeather, NORMALS } from './weather.js';

const FACTIONS = ['homeowners', 'renters', 'seniors', 'business', 'commuters'];

const gauss = (r) => { const u = Math.max(1e-9, r()), v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const pick = (a, r) => a[Math.floor(r() * a.length) % a.length];
const k$ = (v) => (Math.abs(v) >= 1e6 ? `$${(Math.abs(v) / 1e6).toFixed(1)}M` : `$${Math.round(Math.abs(v) / 1000)}K`);

// ---- 1. noisy outcomes ----
export function beginDecision(sim) {
  const r = sim.rand;
  const f = {};
  for (const k of FACTIONS) f[k] = clamp(Math.exp(0.38 * gauss(r)), 0.35, 1.9);
  sim.fxNoise = { f, cost: clamp(Math.exp(0.12 + 0.18 * gauss(r)), 0.8, 1.7), gain: clamp(Math.exp(-0.05 + 0.15 * gauss(r)), 0.7, 1.3) };
}
export function endDecision(sim, title, label) {
  sim.fxNoise = null;
  // ---- 2. a twist, months later ----
  if (sim.rand() < 0.3) {
    const good = sim.rand() < 0.5;
    sim.pending.push({ at: sim.t + 3 + Math.floor(sim.rand() * 7), id: 'twist', data: { title, label, good } });
    sim.twists = (sim.twists || 0) + 1;
  }
}
const TWIST_GOOD = [
  ['A quiet win from {label}', 'Months later, the decision on “{title}” is working better than anyone expected. Nobody is writing letters about it, which in Watertown is praise.'],
  ['“{title}”: the upside nobody predicted', 'A side effect of {label} turns out to be popular. Staff are quietly taking credit.'],
  ['State notices {title}', 'Boston holds up Watertown’s approach as a model and sends a small grant to keep it going.'],
  ['{label}: under budget', 'The final invoices are lower than the estimate. The Finance Committee asks for this in writing.'],
];
const TWIST_BAD = [
  ['Unintended consequences of {label}', 'The decision on “{title}” is causing a problem nobody raised at the meeting. A few people who did raise it would like that noted.'],
  ['{label}: the bill comes due', 'Costs nobody budgeted for are showing up months later. Change orders, mostly.'],
  ['Second thoughts on “{title}”', 'A neighborhood group that missed the meeting has found out. They have a petition, a website and a lot of free time.'],
  ['Legal challenge to {label}', 'An abutter sues. The City will probably win, slowly and expensively.'],
];
export function twist(sim, d) {
  const r = sim.rand;
  const [t, b] = pick(d.good ? TWIST_GOOD : TWIST_BAD, r);
  const fill = (x) => x.replace(/\{title\}/g, d.title).replace(/\{label\}/g, (d.label || 'that decision').replace(/\.$/, ''));
  const who = pick(FACTIONS, r);
  const amt = (d.good ? 1 : -1) * (1 + Math.floor(r() * 3));
  const money = d.good ? (r() < 0.5 ? 50e3 + r() * 350e3 : 0) : -(r() < 0.6 ? 100e3 + r() * 500e3 : 0);
  sim.apply({ approval: { [who]: amt, all: d.good ? 0.5 : -0.5 }, funds: money, news: [fill(t), fill(b) + (money ? ` (${money > 0 ? '+' : '−'}${k$(money)})` : '')] });
}

// ---- 3a. curveballs that just happen ----
function randomShop(sim, pred) {
  const c = [];
  for (const l of sim.w.lots) if (!l.dead && l.inTown && l.sf) for (const s of l.sf) if (pred(s, l)) c.push([l, s]);
  return c.length ? c[Math.floor(sim.rand() * c.length)] : null;
}
const streetOf = (lot) => (lot.addr || '').replace(/^[0-9\-A-Za-z]*[0-9][0-9\-A-Za-z]*\s+/, '').trim();
const INSTANT = [
  { id: 'viral', p: 1, run: (s) => {
    const hit = randomShop(s, (x) => !x.chain && (x.cat === 'food' || x.sig));
    if (!hit) return false;
    const [lot, sh] = hit;
    sh.cushion += 0.3; sh.lease = Math.max(sh.lease, 36);
    s.lvNear({ at: [lot.cx, lot.cy], r: 6, amt: 0.02 });
    s.hype = Math.min(0.8, (s.hype || 0) + 0.02);
    s.moment && s.moment('ribbon', lot.cx, lot.cy, `${sh.n} goes viral`);
    s.apply({ approval: { business: 1, renters: 1 }, news: [`${sh.n} goes viral`, `A video of ${sh.n}${streetOf(lot) ? ` on ${streetOf(lot)}` : ''} hits a few million views. The line is down the block by Saturday. Neighbors are thrilled and also can’t park.`] });
    return true;
  } },
  { id: 'sinkhole', p: 0.7, run: (s) => {
    const rl = s.roadList.filter((i) => s.w.road[i] >= 2 && s.w.inTown[i]);
    if (!rl.length) return false;
    const i = rl[Math.floor(s.rand() * rl.length)];
    const x = i % s.W, y = (i / s.W) | 0, st = s.w.names[s.w.roadName[i]] || 'a main road';
    s.capNear({ at: [x, y], r: 3, amt: -0.25 });
    s.pending.push({ at: s.t + 3 + Math.floor(s.rand() * 3), id: 'curve-fix', data: { x, y, st } });
    s.apply({ funds: -(250e3 + s.rand() * 300e3), approval: { commuters: -2 }, news: [`Sinkhole on ${st}`, 'A 1920s water main finally gives up. Two lanes are closed until the crews can rebuild the street bed.'] });
    return true;
  } },
  { id: 'grant', p: 0.6, run: (s) => {
    const amt = Math.round((0.8 + s.rand() * 2.4) * 10) / 10;
    s.apply({ funds: amt * 1e6, approval: { all: 0.5 }, news: [`$${amt}M state grant for Watertown`, 'A MassWorks-style infrastructure grant comes through after two years of applications. Nobody remembers who wrote it.'] });
    return true;
  } },
  { id: 'lawsuit', p: 0.5, run: (s) => {
    const amt = Math.round((0.4 + s.rand() * 1.6) * 10) / 10;
    s.apply({ funds: -amt * 1e6, approval: { homeowners: -1 }, news: [`City settles lawsuit for $${amt}M`, 'An old dispute over a sewer easement finally ends, with a check.'] });
    return true;
  } },
  { id: 'company', p: 0.6, run: (s) => {
    const n = 150 + Math.floor(s.rand() * 450);
    s.apply({ demand: { C: 0.08 }, approval: { business: 2 }, news: [`${n}-person company signs a lease in Watertown`, 'A growing firm takes two floors that sat empty since the pandemic. The lunch places on Arsenal Street notice first.'] });
    return true;
  } },
  { id: 'outage', p: 0.5, when: (s) => monthWeather(s).hotDays >= 2, run: (s) => {
    s.apply({ approval: { seniors: -2, all: -0.5 }, news: ['Heat knocks out power to the East End', 'Eversource restores it overnight. The library’s air conditioning has never been more popular.'] });
    return true;
  } },
];
export function curveballMonthly(sim) {
  if (sim.t < 2 || sim.rand() > 0.12) return null;
  sim.curveLog = sim.curveLog || [];
  const opts = INSTANT.filter((e) => !e.when || e.when(sim));
  const tot = opts.reduce((a, e) => a + e.p, 0);
  let x = sim.rand() * tot;
  for (const e of opts) {
    x -= e.p;
    if (x <= 0) {
      const ok = e.run(sim);
      if (ok) sim.curveLog = sim.curveLog.concat([sim.y + ':' + e.id]).slice(-30);
      return ok ? e.id : null;
    }
  }
  return null;
}

// ---- 3b. curveballs that need a decision, with odds ----
const roll = (s, p) => s.rand() < p;
export const CURVE_SCENARIOS = [
  {
    id: 'curve-employer',
    cooldown: 36,
    priority: true, // when it comes up, it comes up: these jump the agenda queue
    when: (s) => s.t >= 6 && s.rand() < 0.035,
    prep: (s) => ({ jobs: 250 + Math.floor(s.rand() * 500) }),
    title: (s, c) => `${c.jobs} Jobs Might Leave`,
    text: (s, c) => `A biotech company with ${c.jobs} employees in town says its lease is up and Waltham is offering a deal. Their CEO would “love to stay.” Their real-estate broker would love a tax break.`,
    choices: [
      { label: 'Offer a tax agreement', fx: '−$1.5M over 5 yrs · good odds they stay (~65%)', run: (s, c) => {
        s.apply({ recurring: { key: 'tif-emp', label: 'Tax agreement (employer)', monthly: 25e3, months: 60 } });
        if (roll(s, 0.65)) s.apply({ approval: { business: 3 }, news: ['Biotech stays in Watertown', `${c.jobs} jobs stay put. The ribbon is for a lease extension, which is a first.`] });
        else s.apply({ approval: { business: -2, homeowners: -2 }, demand: { I: -0.1 }, news: ['Biotech leaves anyway', 'They took the tax break offer to Waltham and got a better one. The City pays nothing further, but it stings.'] });
      } },
      { label: 'Help with permits and parking', fx: 'free · decent odds (~40%)', run: (s, c) => {
        if (roll(s, 0.4)) s.apply({ approval: { business: 2 }, news: ['Biotech stays, for a parking garage permit', 'Sometimes the deal is just a faster permit.'] });
        else s.apply({ approval: { business: -3 }, demand: { I: -0.1 }, news: [`${c.jobs} jobs leave for Waltham`, 'The lunch places on Arsenal Street notice first.'] });
      } },
      { label: 'Let them go', fx: 'jobs leave · Business ↓', run: (s, c) => s.apply({ approval: { business: -4, homeowners: 1 }, demand: { I: -0.15 }, news: [`${c.jobs} jobs leave for Waltham`, 'The City says it won’t “chase companies with tax money.” The company says it won’t miss the traffic.'] }) },
    ],
  },
  {
    id: 'curve-festival',
    cooldown: 24,
    priority: true,
    when: (s) => s.t >= 4 && s.m >= 4 && s.m <= 8 && s.rand() < 0.1,
    prep: (s) => ({ street: s.rand() < 0.5 ? 'Main Street' : 'Mount Auburn Street' }),
    title: (s, c) => `Close ${c.street} for a Festival?`,
    text: (s, c) => `Local businesses want to close ${c.street} for a Saturday street festival next month: music, food trucks, kids’ chalk art. It could be the day people remember the town by, or it could rain.`,
    choices: [
      { label: 'Close the street, fund it', fx: '−$60K · great if the weather holds', run: (s, c) => {
        const rainout = roll(s, Math.min(0.6, NORMALS.wetDays[(s.m + 1) % 12] / 30 + 0.05)); // a wet day in an ordinary month
        if (!rainout) {
          s.lvNear({ at: 'square', r: 18, amt: 0.015 });
          s.apply({ funds: -60e3, approval: { renters: 3, business: 3, commuters: -1 }, news: [`Thousands turn out for ${c.street} festival`, 'Sunny, crowded, and everyone stays later than planned. Three shops sell out by 4 p.m.'] });
          s.moment && s.moment('plaza', s.w.start[0], s.w.start[1], 'Street festival');
        } else s.apply({ funds: -60e3, approval: { business: -1, commuters: -1 }, news: [`Rain washes out ${c.street} festival`, 'A soggy brass band plays to eleven umbrellas. The food trucks leave early.'] });
      } },
      { label: 'Let them run it on the sidewalk', fx: 'free · smaller', run: (s) => s.apply({ approval: { business: 1 }, news: ['Sidewalk sale, not a festival', 'Pleasant enough. Nobody will remember it.'] }) },
      { label: 'Not this year', fx: 'Business ↓', run: (s) => s.apply({ approval: { business: -2, renters: -1 } }) },
    ],
  },
  {
    id: 'curve-mandate',
    cooldown: 40,
    priority: true,
    when: (s) => s.t >= 10 && s.rand() < 0.02,
    title: 'An Unfunded Mandate',
    text: () => 'A new state rule requires every town to replace its lead service lines on a fixed schedule. It’s the right thing to do. The state is offering loans, not money.',
    choices: [
      { label: 'Do it fast', fx: '≈ −$3M · Homeowners ↑ · costs uncertain', run: (s) => s.apply({ funds: -(2 + s.rand() * 2.5) * 1e6, approval: { homeowners: 2, renters: 2 }, news: ['Lead pipes out by next year', 'Crews dig up half the side streets at once. Parents are relieved; drivers are not.'] }) },
      { label: 'Stretch it over ten years', fx: '−$400K/yr', run: (s) => s.apply({ recurring: { key: 'leadlines', label: 'Lead service line replacement', monthly: 400e3 / 12, months: 120 }, news: ['Lead pipes on the slow plan', 'Ten years, one neighborhood at a time.'] }) },
    ],
  },
];
// a sinkhole's street, back in service
export const CHANCE_FOLLOWUPS = {
  twist: (s, d) => twist(s, d),
  'curve-fix': (s, d) => s.apply({ capNear: { at: [d.x, d.y], r: 3, amt: 1 / 3 }, approval: { commuters: 1 }, news: [`${d.st} reopens`, 'New pipe, new pavement, and for one brief week, no potholes.'] }),
};
void ZONE;
