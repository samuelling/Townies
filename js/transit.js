// Buses. Watertown has no subway; the MBTA bus is its transit. With data/transit.json.gz (built by
// tools/transit/ from the MBTA's GTFS feed) every route through the map runs on its real path and its real
// timetable for a weekday, a Saturday and a Sunday, stopping at its real stops. Without it, four routes
// follow their streets by name.
//
// Ridership on each route is modeled from the people and jobs within a short walk of it, nudged up when car
// traffic gets worse (people switch) and down when the buses are stuck in that same traffic (unless they have
// their own lane). Each route starts at its measured boardings at its Watertown stops (the MBTA's Fall 2025
// counts), or, without the data, at a round assumption shared by the four. Riders above or below the
// starting level take cars off the road, which the traffic model sees.
import { clamp } from './util.js';
import { makeProj, traverse } from './geo.js';

export const ROUTES = [
  { id: '57', label: '57 · Watertown Yard – Kenmore', streets: /^Galen Street$/, color: '#f2c200' },
  { id: '70', label: '70 · Waltham – Watertown Sq – Central Sq', streets: /^(Main Street|Arsenal Street)$/, color: '#f2c200' },
  { id: '71', label: '71 · Watertown Sq – Harvard', streets: /^Mount Auburn Street$/, color: '#f2c200' },
  { id: '73', label: '73 · Waverley – Harvard', streets: /^Belmont Street$/, color: '#f2c200' },
];

// ---- the real network ----
let NET = null;
export const transitNet = () => NET;
const DAY_KINDS = ['weekday', 'saturday', 'sunday'];
export function setTransitData(data, world) {
  if (!data || !data.routes || !data.pieces || !world || !world.bbox) return null;
  const pr = makeProj(world.bbox), M = 16; // metres per tile
  const pieces = data.pieces.map((flat) => {
    const n = flat.length / 2, x = new Float32Array(n), y = new Float32Array(n), cum = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      const [gx, gy] = pr.toGrid(flat[2 * k] / 1e5, flat[2 * k + 1] / 1e5);
      x[k] = gx; y[k] = gy;
      if (k) cum[k] = cum[k - 1] + Math.hypot(gx - x[k - 1], gy - y[k - 1]);
    }
    return { x, y, cum, n };
  });
  const tileIn = (gx, gy) => { const xi = Math.floor(gx), yi = Math.floor(gy); return xi >= 0 && yi >= 0 && xi < world.W && yi < world.H ? yi * world.W + xi : -1; };
  const stops = data.stops.map(([name, la, lo, rs, sid, ons]) => {
    const [x, y] = pr.toGrid(la / 1e5, lo / 1e5);
    const i = tileIn(x, y);
    return { name, x, y, routes: rs, ons: ons || null, inTown: i >= 0 && world.inTown[i] === 1 };
  });
  const routes = data.routes.map((r, k) => ({ ...r, k, pieces: new Set(), townStops: 0, townRiders: 0 }));
  const trips = {};
  for (const kind of DAY_KINDS) {
    trips[kind] = ((data.trips && data.trips[kind]) || []).map((row) => {
      const [ri, pc, dir] = row, m = (row.length - 3) / 3;
      const st = new Int32Array(m), t = new Float32Array(m), d = new Float32Array(m);
      for (let j = 0; j < m; j++) { st[j] = row[3 + 3 * j]; t[j] = row[4 + 3 * j]; d[j] = row[5 + 3 * j] / M; }
      if (routes[ri]) routes[ri].pieces.add(pc);
      return { r: ri, pc, dir, st, t, d, t0: t[0], t1: t[m - 1] };
    });
  }
  for (const st of stops)
    st.routes.forEach((ri, j) => {
      const r = routes[ri];
      if (!r || !st.inTown) return;
      r.townStops++;
      if (st.ons) r.townRiders += st.ons[j] || 0;
    });
  const byRoute = (data.ridership && data.ridership.by_route) || {};
  for (const r of routes) {
    // boardings at the Watertown stops; without per-stop counts, the route's map-wide count
    r.riders = st0(stops) ? Math.round(r.townRiders) : r.townStops ? byRoute[r.id] || r.riders || 0 : 0;
    r.head = r.summary && r.summary.headway ? r.summary.headway : null;
  }
  NET = { pieces, stops, routes, trips, days: data.days, source: data.source, fetched: data.fetched, season: data.ridership && data.ridership.season };
  // the routes the sim models: the ones that stop in Watertown
  ROUTES.length = 0;
  for (const r of routes)
    if (r.townStops > 0 && r.riders >= 20) ROUTES.push({ id: r.id, label: `${r.id} · ${r.name.replace(/ - /g, ' – ')}`, color: '#' + (r.color || 'f2c200'), net: r, riders0: r.riders });
  return NET;
}
const st0 = (stops) => stops.some((s) => s.ons);
// the typical wait at a route's stop, in minutes: half its headway at that hour (weekday)
// (null when the route doesn't run then; dflt without the timetable)
export function headwayMin(r, hour = 8, dflt = 10) {
  const h = r && r.net && r.net.head;
  if (!h) return dflt;
  const slot = hour < 9.5 ? 'am' : hour < 15.5 ? 'mid' : hour < 18.75 ? 'pm' : 'eve';
  const v = (h[slot] || []).filter((x) => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}
// a point at distance d (tiles) along a piece, with its heading
export function pieceAt(pc, d) {
  const { x, y, cum, n } = pc;
  if (d <= 0) return [x[0], y[0], x[1] - x[0], y[1] - y[0]];
  if (d >= cum[n - 1]) return [x[n - 1], y[n - 1], x[n - 1] - x[n - 2], y[n - 1] - y[n - 2]];
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= d) lo = m; else hi = m; }
  const f = (d - cum[lo]) / (cum[hi] - cum[lo] || 1);
  return [x[lo] + (x[hi] - x[lo]) * f, y[lo] + (y[hi] - y[lo]) * f, x[hi] - x[lo], y[hi] - y[lo]];
}

const BASE_RIDERS = 9000; // weekday boardings in town, all four routes, at the start (an assumption)
const CAR_PER_RIDER = 0.6; // each extra rider is about this many fewer car trips

// the in-town road tiles a route runs along (cached on the world, out of the save)
function cache(w, key) {
  if (!Object.prototype.hasOwnProperty.call(w, key)) Object.defineProperty(w, key, { value: {}, enumerable: false, writable: true });
  return w[key];
}
export function routeTiles(sim, r) {
  const w = sim.w;
  const C = cache(w, r.net ? '_netTiles' : '_routeTiles2');
  if (!C[r.id]) {
    const out = [];
    if (r.net) {
      const seen = new Set();
      const take = (x, y) => {
        if (x < 0 || y < 0 || x >= w.W || y >= w.H) return;
        let i = y * w.W + x;
        if (!w.road[i]) { const j = [i - 1, i + 1, i - w.W, i + w.W].find((q) => q >= 0 && q < w.road.length && w.road[q]); if (j == null) return; i = j; }
        if (w.inTown[i] && !seen.has(i)) { seen.add(i); out.push(i); }
      };
      for (const pc of r.net.pieces) {
        const P = NET.pieces[pc];
        for (let k = 0; k + 1 < P.n; k++) traverse(P.x[k], P.y[k], P.x[k + 1], P.y[k + 1], take);
      }
    } else for (const i of sim.roadList) if (w.inTown[i] && r.streets.test(w.names[w.roadName[i]] || '')) out.push(i);
    C[r.id] = out;
  }
  return C[r.id];
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
  if (NET) {
    // each route starts at its own measured boardings (a city saved before the real network re-bases here)
    if (!T.kr) { T.kr = {}; T.riders0 = null; }
    const known = ROUTES.filter((r) => r.riders0 > 0 && raw[r.id] > 0);
    const kAvg = known.length ? known.reduce((a, r) => a + r.riders0 / raw[r.id], 0) / known.length : T.k || 0;
    for (const r of ROUTES) {
      if (T.kr[r.id] == null && raw[r.id] > 0) T.kr[r.id] = r.riders0 > 0 ? r.riders0 / raw[r.id] : kAvg;
      T.riders[r.id] = Math.round((raw[r.id] || 0) * (T.kr[r.id] || 0));
      riders += T.riders[r.id];
    }
  } else
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
    text: () => { const r = ROUTES.find((x) => x.id === '70'); const h = r && r.net ? Math.round(headwayMin(r, 12) || 20) : 20; return `The 70 comes about every ${h} minutes midday, and nobody plans their life around a schedule like that. The MBTA offers to add trips if the City chips in. It would make Arsenal Street and Main Street livable without a car.`; },
    choices: [
      { label: 'Pay for half again as many buses', fx: (s) => `−$${Math.round(1.1 * pf(s) * 10) / 10}M/yr · ridership ↑ · fewer cars`, run: (s) => {
        s.transit.freq['70'] = 1.5;
        s.apply({ recurring: { key: 'bus70', label: 'Extra 70 bus service', monthly: 1.1e6 / 12 }, approval: { renters: 3, commuters: 1, seniors: 1 }, news: ['More buses on the 70', 'Riders say it’s the first time they’ve left the house without checking an app.'] });
      } },
      { label: 'Not with our money', fx: 'nothing changes', run: (s) => s.apply({ approval: { renters: -1 }, news: ['Bus service stays as is', 'The MBTA says it will "continue to evaluate service levels."'] }) },
    ],
  },
];
