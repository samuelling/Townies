// Halloween on Irving Street. Every fall, from September, one yard on Irving Street fills with skeletons
// gathered around a stone cairn, antlered skulls on poles, three very still children, and red light. In
// October the rest of the neighborhood catches up with pumpkins, inflatable ghosts and foam tombstones,
// and a few houses across town join in. (A real yard; the people who live there asked for it.)
import { ZONE } from './config.js';
import { hash2 } from './util.js';

const HOME = /^117\s+Irving\s+St\b/i;
const NEAR = 28; // tiles (~450 m): "the neighborhood"

export const irvingSeason = (sim) => !!sim && (sim.m === 8 || sim.m === 9); // September and October
export const halloweenSeason = (sim) => !!sim && sim.m === 9; // October

export function homeLot(world) {
  if (world._egg === undefined) world._egg = world.lots.find((l) => !l.dead && HOME.test(l.addr || '')) || null;
  return world._egg;
}

// a point in the front yard: from the house toward its street
export function yardPoint(world, lot, depth = 0.55) {
  let bx = lot.cx, by = lot.cy;
  const b = lot.bldgs.map((id) => world.bldgs[id]).filter((x) => x && x.alive).sort((a, c) => c.area - a.area)[0];
  if (b) { bx = b.cx; by = b.cy; }
  if (lot.road < 0) return [bx, by + 0.6];
  const rx = (lot.road % world.W) + 0.5, ry = Math.floor(lot.road / world.W) + 0.5;
  const dx = rx - bx, dy = ry - by, d = Math.hypot(dx, dy) || 1;
  const reach = Math.min(d - 0.35, Math.max(0.5, d * depth));
  return [bx + (dx / d) * reach, by + (dy / d) * reach, dx / d, dy / d];
}

// which houses decorate this year, and how; rerolled each year, denser near Irving Street
export function decoratedLots(sim) {
  const w = sim.w;
  if (sim._halloweenY === sim.y && sim._halloween) return sim._halloween;
  const home = homeLot(w);
  const out = [];
  for (const lot of w.lots) {
    if (lot.dead || !lot.inTown || lot === home || lot.zone !== ZONE.R || !lot.bldgs.length || lot.units > 4 || lot.road < 0) continue;
    const near = home ? Math.hypot(lot.cx - home.cx, lot.cy - home.cy) < NEAR : false;
    const r = hash2(lot.id, sim.y, 31);
    if (r > (near ? 0.42 : 0.05)) continue;
    const k = hash2(lot.id, sim.y, 32);
    out.push({ id: lot.id, kind: k < 0.4 ? 'pumpkins' : k < 0.62 ? 'ghost' : k < 0.82 ? 'tombs' : 'lights', yard: yardPoint(w, lot), seed: lot.id * 7 + sim.y });
  }
  sim._halloween = out;
  sim._halloweenY = sim.y;
  return out;
}

// once a year, the neighborhood notices
export function eggMonthly(sim) {
  const home = homeLot(sim.w);
  if (!home) return;
  if (sim.m === 8) sim.news('The skeletons are back on Irving Street', 'A ring of them, kneeling around a stone cairn, with antlered skulls on poles and three very still children in pink dresses. At night it all glows red. Drivers slow down; some stop. It is only September.');
  else if (sim.m === 9) sim.news('Halloween creeps across the East End', 'Pumpkins on the steps, inflatable ghosts listing in the wind, and foam tombstones with puns on them. One house on Irving Street started a month ago and is not sorry.');
}

export const EGG_NOTE = 'September and October: a full skeleton gathering in the front yard, lit red at night. Locally famous.';
