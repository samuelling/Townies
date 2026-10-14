// Street life: an outcome measure that doesn't score land uses as good or bad. It estimates how many trips
// people make on foot each day, with a standard accessibility (gravity) model: residents and workers walk
// more when more places worth walking to are within a short walk, falling off with distance. Shops,
// restaurants, services, civic buildings and parks are destinations; an auto shop or a parking lot simply
// isn't one (it earns nothing and loses nothing). So clearing an auto lot does nothing here by itself; only
// what replaces it, or more people nearby, moves the number.
//
// Scaled to a round assumption: at the start, about one in ten of residents' trips are on foot, near what
// travel surveys find for older inner suburbs (resident trips ~3.5 a day). An estimate, not a count.
import { ZONE, COVER } from './config.js';

const WEIGHT = { food: 1, retail: 0.85, service: 0.6, civic: 0.5, office: 0.15, auto: 0, none: 0 };
const L_M = 250; // distance decay, metres
const R_CELLS = 12;
const TRIPS_RES = 3.5, TRIPS_JOB = 1.0, WALK_SHARE0 = 0.1;

export function computeStreetLife(sim) {
  const w = sim.w, { Wc, Hc } = sim;
  const Nc = Wc * Hc;
  const cellM = (sim.w.W / Wc) * 16; // metres per cell
  const A = new Float32Array(Nc);
  for (const lot of w.lots) {
    if (lot.dead || !lot.inTown) continue;
    const c = sim.cellOf(lot.cx, lot.cy);
    if (lot.sf && lot.sf.length) for (const s of lot.sf) A[c] += WEIGHT[s.cat] ?? 0.5;
    const n = lot.biz ? lot.biz.length : 0;
    for (let k = 0; k < n; k++) {
      const cat = lot.bizCat ? lot.bizCat[k] : 'none';
      if (cat === 'food' || cat === 'retail' || cat === 'service') continue; // counted above, as open storefronts
      A[c] += WEIGHT[cat] ?? 0;
    }
    if (lot.zone === ZONE.CIVIC) A[c] += 0.5;
  }
  for (let i = 0; i < w.W * w.H; i++) if (w.inTown[i] && (w.cover[i] === COVER.PARK || w.cover[i] === COVER.SPORT)) A[sim.cellOf(i % w.W, (i / w.W) | 0)] += 0.02;
  if (!sim.slKernel) {
    const k = [];
    for (let dy = -R_CELLS; dy <= R_CELLS; dy++) for (let dx = -R_CELLS; dx <= R_CELLS; dx++) {
      const d = Math.hypot(dx, dy) * cellM;
      if (d <= R_CELLS * cellM) k.push([dx, dy, Math.exp(-d / L_M)]);
    }
    sim.slKernel = k;
  }
  // accessibility of each populated cell
  let resTrips = 0, jobTrips = 0;
  const acc = new Float32Array(Nc);
  for (let y = 0; y < Hc; y++) for (let x = 0; x < Wc; x++) {
    const i = y * Wc + x;
    if (!(sim.popC[i] > 0) && !(sim.jobsC[i] > 0)) continue;
    let a = 0;
    for (const [dx, dy, kw] of sim.slKernel) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < Wc && yy < Hc) a += A[yy * Wc + xx] * kw; }
    acc[i] = a;
  }
  if (!sim.base.slHalf) {
    // half-saturation set from the starting town, so the starting walk share comes out at WALK_SHARE0 overall
    const vals = [];
    for (let i = 0; i < Nc; i++) if (sim.popC[i] > 0) vals.push(acc[i]);
    vals.sort((a, b) => a - b);
    sim.base.slHalf = vals[vals.length >> 1] || 1;
  }
  const H = sim.base.slHalf;
  for (let i = 0; i < Nc; i++) {
    if (!acc[i]) continue;
    const share = acc[i] / (acc[i] + H);
    resTrips += (sim.popC[i] || 0) * TRIPS_RES * share;
    jobTrips += (sim.jobsC[i] || 0) * TRIPS_JOB * share;
  }
  if (!sim.base.slScale) sim.base.slScale = (WALK_SHARE0 * TRIPS_RES * (sim.pop || 1)) / Math.max(1, resTrips);
  const trips = Math.round((resTrips + jobTrips) * sim.base.slScale);
  if (sim.base.sl0 == null) sim.base.sl0 = trips;
  sim.streetLife = { trips, change: sim.base.sl0 ? trips / sim.base.sl0 - 1 : 0 };
  return sim.streetLife;
}
