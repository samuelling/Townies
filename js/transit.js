// Buses. Watertown has no subway; the MBTA bus is its transit: the 57 (Galen St to Kenmore), the 70
// (Main St and Arsenal St, Waltham to Central Square), the 71 (Mount Auburn St to Harvard) and the 73
// (Belmont St to Harvard), most of them meeting in Watertown Square.
//
// Crude on purpose. Ridership on each route is modeled from the people and jobs within a short walk of
// it, nudged up when car traffic gets worse (people switch) and down when the buses are stuck in that same
// traffic (unless they have their own lane). It's scaled to a round assumption (about 9,000 boardings a
// weekday inside town across the four routes), not measured stop by stop. Riders above or below the
// starting level take cars off the road, which the traffic model sees.
import { clamp } from './util.js';

export const ROUTES = [
  { id: '57', label: '57 · Watertown Yard – Kenmore', streets: /^Galen Street$/, color: '#f2c200' },
  { id: '70', label: '70 · Waltham – Watertown Sq – Central Sq', streets: /^(Main Street|Arsenal Street)$/, color: '#f2c200' },
  { id: '71', label: '71 · Watertown Sq – Harvard', streets: /^Mount Auburn Street$/, color: '#f2c200' },
  { id: '73', label: '73 · Waverley – Harvard', streets: /^Belmont Street$/, color: '#f2c200' },
];
const BASE_RIDERS = 9000; // weekday boardings in town, all four routes, at the start (an assumption)
const CAR_PER_RIDER = 0.6; // each extra rider is about this many fewer car trips

export function routeTiles(sim, r) {
  const w = sim.w;
  w._routeTiles = w._routeTiles || {};
  if (!w._routeTiles[r.id]) {
    const out = [];
    for (const i of sim.roadList) if (w.inTown[i] && r.streets.test(w.names[w.roadName[i]] || '')) out.push(i);
    w._routeTiles[r.id] = out;
  }
  return w._routeTiles[r.id];
}
export function routeLines(world, r) {
  world._routeLines = world._routeLines || {};
  if (!world._routeLines[r.id]) world._routeLines[r.id] = world.roadLines.map((ln, k) => (r.streets.test(ln.name || '') ? k : -1)).filter((k) => k >= 0);
  return world._routeLines[r.id];
}

export function initTransit(sim) {
  sim.transit = sim.transit || { lanes: {}, freq: {}, riders: {}, riders0: null, catch0: {} };
  computeTransit(sim);
  return sim.transit;
}

// monthly: who's within a walk of each route, how bad traffic is, and what that does to ridership
export function computeTransit(sim) {
  const T = sim.transit || initTransit(sim);
  if (!sim.popNear || !sim.roadList) return T;
  const W = sim.W;
  const cong0 = sim.base.cong0 || 0.5;
  const carPush = 1 + 0.6 * Math.max(0, (sim.congAvg || 0) - cong0);
  let total = 0;
  const raw = {};
  for (const r of ROUTES) {
    const tiles = routeTiles(sim, r);
    if (!tiles.length) { raw[r.id] = 0; continue; }
    let catchSum = 0, congSum = 0, n = 0;
    for (let k = 0; k < tiles.length; k += 6) {
      const i = tiles[k];
      const c = sim.cellOf(i % W, (i / W) | 0);
      catchSum += (sim.popNear[c] || 0) + 0.6 * (sim.jobsNear ? sim.jobsNear[c] || 0 : 0);
      congSum += sim.congestion[i] || 0;
      n++;
    }
    const routeCong = n ? congSum / n : 0;
    const stuck = T.lanes[r.id] ? 1.12 : 1 - 0.25 * clamp(routeCong - 0.9, 0, 1);
    raw[r.id] = (n ? catchSum / n : 0) * Math.sqrt(tiles.length) * stuck * (T.freq[r.id] || 1) * carPush * (sim.techTransitF ? sim.techTransitF() : 1);
    total += raw[r.id];
  }
  if (!T.k && total > 0) T.k = BASE_RIDERS / total;
  let riders = 0;
  for (const r of ROUTES) {
    T.riders[r.id] = Math.round((raw[r.id] || 0) * (T.k || 0));
    riders += T.riders[r.id];
  }
  T.total = riders;
  if (T.riders0 == null) T.riders0 = riders;
  // extra riders leave cars at home (or fewer riders take them out)
  const trips = Math.max(1, sim.tripsNow ? sim.tripsNow() : 1);
  T.carF = clamp(1 - (CAR_PER_RIDER * (riders - T.riders0)) / trips, 0.85, 1.1);
  return T;
}
export const transitCarF = (sim) => (sim.transit && sim.transit.carF) || 1;

const pf = (s) => (s.priceF ? s.priceF() : 1);
export const TRANSIT_SCENARIOS = [
  {
    id: 'bus-lanes',
    cooldown: 30,
    when: (s) => s.transit && s.t >= 6 && s.y >= 2018 && ROUTES.some((r) => !s.transit.lanes[r.id]),
    prep: (s) => {
      const open = ROUTES.filter((r) => !s.transit.lanes[r.id] && routeTiles(s, r).length > 40);
      if (!open.length) return null;
      const r = open.find((x) => x.id === '71') || open[Math.floor(s.rand() * open.length)];
      const tiles = routeTiles(s, r);
      const mid = tiles[tiles.length >> 1];
      return { id: r.id, street: s.w.names[s.w.roadName[mid]], cx: mid % s.W, cy: (mid / s.W) | 0, riders: s.transit.riders[r.id] || 0 };
    },
    title: (s, c) => `Bus Lanes on ${c.street}?`,
    text: (s, c) => `The ${c.id} carries about ${c.riders.toLocaleString()} riders a weekday through town, and at rush hour it crawls in the same traffic as everyone else. The MBTA will pay for most of a red bus-only lane on ${c.street} if the City gives up a travel lane and some parking. Bus riders are for it. Drivers are not.`,
    choices: [
      { label: 'All-day bus lanes', fx: '−$900K · buses faster, more riders · one less lane for cars · Commuters ↓', run: (s, c) => {
        s.transit.lanes[c.id] = true;
        const r = ROUTES.find((x) => x.id === c.id);
        for (const i of routeTiles(s, r)) s.capLocal[i] *= 0.94;
        s.apply({ funds: -900e3, approval: { renters: 2, commuters: -2, business: -1 }, news: [`Red lanes on ${c.street}`, 'The paint goes down over a weekend. By Tuesday the bus is beating the cars.'] });
      } },
      { label: 'Rush hour only', fx: '−$300K · a smaller boost · parking stays off-peak', run: (s, c) => {
        s.transit.freq[c.id] = (s.transit.freq[c.id] || 1) * 1.06;
        const r = ROUTES.find((x) => x.id === c.id);
        for (const i of routeTiles(s, r)) s.capLocal[i] *= 0.98;
        s.apply({ funds: -300e3, approval: { renters: 1, commuters: -1 }, news: [`Peak-hour bus lanes for ${c.street}`, 'Cars can park in them after 9 a.m. Enforcement is "a work in progress."'] });
      } },
      { label: 'Keep the lanes for cars', fx: 'Commuters ↑ · Renters ↓', run: (s, c) => s.apply({ approval: { commuters: 1, renters: -2 }, news: ['No bus lanes for now', `Riders on the ${c.id} keep crawling.`] }) },
    ],
  },
  {
    id: 'bus-frequency',
    cooldown: 40,
    when: (s) => s.transit && s.t >= 12 && !(s.transit.freq['70'] > 1.2),
    title: 'More Buses on the 70?',
    text: () => 'The 70 runs every 20 minutes on a good day, and nobody plans their life around a good day. The MBTA offers to add trips if the City chips in. It would make Arsenal Street and Main Street livable without a car.',
    choices: [
      { label: 'Pay for buses every 10 minutes', fx: (s) => `−$${Math.round(1.1 * pf(s) * 10) / 10}M/yr · ridership ↑ · fewer cars`, run: (s) => {
        s.transit.freq['70'] = 1.5;
        s.apply({ recurring: { key: 'bus70', label: 'Extra 70 bus service', monthly: 1.1e6 / 12 }, approval: { renters: 3, commuters: 1, seniors: 1 }, news: ['The 70 every 10 minutes', 'Riders say it’s the first time they’ve left the house without checking an app.'] });
      } },
      { label: 'Not with our money', fx: 'nothing changes', run: (s) => s.apply({ approval: { renters: -1 }, news: ['Bus service stays as is', 'The MBTA says it will "continue to evaluate service levels."'] }) },
    ],
  },
];
