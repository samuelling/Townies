// A side measure: how well the town squares with a handful of the town- and neighborhood-scale patterns in
// Christopher Alexander, Sara Ishikawa and Murray Silverstein's "A Pattern Language" (1977). The book is
// qualitative; each pattern here gets one plain, checkable test using the game's real data. Scores are the
// share of homes (or land, or shops) that meet the test, 0–100. The tests are this game's reading of the
// patterns, not the book's own numbers except where the book gives one (9% parking, four stories,
// a three-minute walk to green).
import { COVER, ZONE } from './config.js';
import { clamp } from './util.js';
import { ROUTES, routeTiles } from './transit.js';

// tile = 16 m
const T = (m) => m / 16;
export const PATTERNS = [
  { n: 9, id: 'work', name: 'Scattered Work', idea: 'Workplaces woven among homes, not zoned off into separate districts.', test: 'Homes with at least one job for every four residents within a short walk' },
  { n: 16, id: 'transit', name: 'Web of Public Transportation', idea: 'Everyone near a line of public transport.', test: 'Homes within a quarter mile (400 m) of a bus route' },
  { n: 17, id: 'ring', name: 'Ring Roads', idea: 'Through traffic kept on the big roads, out of neighborhoods.', test: 'Local streets where the route model sends under 3,000 cars a day (no cut-through)' },
  { n: 21, id: 'stories', name: 'Four-Story Limit', idea: 'Most buildings no higher than four stories.', test: 'Buildings four stories or lower' },
  { n: 22, id: 'parking', name: 'Nine Per Cent Parking', idea: 'Never more than 9% of the land in any area given to parking.', test: 'Land in areas (≈400 m squares) where parking lots cover 9% or less' },
  { n: 30, id: 'nodes', name: 'Activity Nodes', idea: 'Community life gathered at nodes where several shops and paths meet.', test: 'Homes within 300 m of a cluster of six or more shops' },
  { n: 35, id: 'mix', name: 'Household Mix', idea: 'Every neighborhood a mix of household types, not one kind of housing.', test: 'Homes in areas with at least three of: single houses, 2–4 units, small and large apartment buildings' },
  { n: 48, id: 'between', name: 'Housing in Between', idea: 'Homes mixed in among shops and work, so those places live at night too.', test: 'Shops with homes on the same block (within 50 m)' },
  { n: 60, id: 'green', name: 'Accessible Green', idea: 'A green within a three-minute walk of every home.', test: 'Homes within 230 m (about 750 ft) of a park or field' },
  { n: 87, id: 'owned', name: 'Individually Owned Shops', idea: 'Shops run by the people who own them, not chains.', test: 'Open storefronts that are independents' },
  { n: 89, id: 'grocery', name: 'Corner Grocery', idea: 'A small grocery within a few blocks of every home.', test: 'Homes within 300 m of a grocery, market or corner store' },
];

// distance (in tiles) from any source tile, by a two-pass chamfer transform; capped
function distField(W, H, isSrc, cap = 64) {
  const D = new Float32Array(W * H).fill(cap);
  for (let i = 0; i < W * H; i++) if (isSrc(i)) D[i] = 0;
  const a = 1, b = Math.SQRT2;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    let d = D[i];
    if (x > 0) d = Math.min(d, D[i - 1] + a);
    if (y > 0) { d = Math.min(d, D[i - W] + a); if (x > 0) d = Math.min(d, D[i - W - 1] + b); if (x < W - 1) d = Math.min(d, D[i - W + 1] + b); }
    D[i] = d;
  }
  for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
    const i = y * W + x;
    let d = D[i];
    if (x < W - 1) d = Math.min(d, D[i + 1] + a);
    if (y < H - 1) { d = Math.min(d, D[i + W] + a); if (x < W - 1) d = Math.min(d, D[i + W + 1] + b); if (x > 0) d = Math.min(d, D[i + W - 1] + b); }
    D[i] = d;
  }
  return D;
}

const GROCERY = /supermarket|convenience|grocer|greengrocer|deli|marketplace|farmers_market|butcher/;

export function computePatterns(sim) {
  const w = sim.w, { W, H, lots } = w;
  const at = (lot) => clamp(Math.floor(lot.cy), 0, H - 1) * W + clamp(Math.floor(lot.cx), 0, W - 1);
  const homes = lots.filter((l) => !l.dead && l.inTown && (l.zone === ZONE.R || l.mixed) && l.units > 0);
  const totalUnits = homes.reduce((s, l) => s + l.units, 0) || 1;
  const shareHomes = (ok) => (100 * homes.reduce((s, l) => s + (ok(l) ? l.units : 0), 0)) / totalUnits;
  const out = {};

  // 9 Scattered Work
  out.work = shareHomes((l) => { const c = sim.cellOf(l.cx, l.cy); const p = sim.popNear ? sim.popNear[c] : 0, j = sim.jobsNear ? sim.jobsNear[c] : 0; return p > 0 && j >= 0.25 * p; });
  // 16 Web of Public Transportation
  const busSet = new Set();
  if (sim.roadList) for (const r of ROUTES) for (const i of routeTiles(sim, r)) busSet.add(i);
  const Dbus = distField(W, H, (i) => busSet.has(i), 40);
  out.transit = shareHomes((l) => Dbus[at(l)] <= T(400));
  // 17 Ring Roads
  let loc = 0, quiet = 0;
  // route choice is what this pattern is about, so this uses the routed model's volumes (cut-through traffic)
  const k = (sim.base && sim.base.kVeh) || 1;
  if (sim.traffic && sim.roadList) for (const i of sim.roadList) if (w.road[i] === 1 && w.inTown[i]) { loc++; if (sim.traffic[i] * k < 3000) quiet++; }
  out.ring = loc ? (100 * quiet) / loc : 100;
  // 21 Four-Story Limit
  let nb = 0, low = 0;
  for (const b of w.bldgs) if (b.alive && b.kind !== 'garage' && b.lot >= 0 && lots[b.lot] && lots[b.lot].inTown) { nb++; if (b.levels <= 4.5) low++; }
  out.stories = nb ? (100 * low) / nb : 100;
  // 22 Nine Per Cent Parking: 25 x 25 tile areas (≈400 m), weighted by land
  const B = 25;
  let landOk = 0, landAll = 0;
  for (let by = 0; by < H; by += B) for (let bx = 0; bx < W; bx += B) {
    let land = 0, paved = 0;
    for (let y = by; y < Math.min(H, by + B); y++) for (let x = bx; x < Math.min(W, bx + B); x++) {
      const i = y * W + x;
      if (!w.inTown[i] || w.road[i] || w.terrain[i] === 1) continue;
      land++;
      if (w.cover[i] === COVER.PAVED) paved++;
    }
    for (const l of lots) if (!l.dead && l.inTown && /^33[67]$/.test(l.code3 || '') && l.cx >= bx && l.cx < bx + B && l.cy >= by && l.cy < by + B) paved += l.tiles.filter((i) => w.cover[i] !== COVER.PAVED).length;
    if (land < 40) continue;
    landAll += land;
    if (paved / land <= 0.09) landOk += land;
  }
  out.parking = landAll ? (100 * landOk) / landAll : 100;
  // 30 Activity Nodes: tiles with six or more shops within ~80 m
  const shopAt = new Float32Array(W * H);
  for (const l of lots) if (!l.dead && l.inTown && l.sf && l.sf.length) shopAt[at(l)] += l.sf.length;
  const R = 5;
  const node = new Uint8Array(W * H);
  // box sums via a summed-area table
  const S = new Float64Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) { let row = 0; for (let x = 0; x < W; x++) { row += shopAt[y * W + x]; S[(y + 1) * (W + 1) + x + 1] = S[y * (W + 1) + x + 1] + row; } }
  const box = (x0, y0, x1, y1) => S[(y1 + 1) * (W + 1) + x1 + 1] - S[y0 * (W + 1) + x1 + 1] - S[(y1 + 1) * (W + 1) + x0] + S[y0 * (W + 1) + x0];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (shopAt[y * W + x] > 0 && box(Math.max(0, x - R), Math.max(0, y - R), Math.min(W - 1, x + R), Math.min(H - 1, y + R)) >= 6) node[y * W + x] = 1;
  const Dnode = distField(W, H, (i) => node[i] === 1, 40);
  out.nodes = shareHomes((l) => Dnode[at(l)] <= T(300));
  // 35 Household Mix: ≈400 m areas, at least three housing types each holding ≥5% of the homes there
  const cls = (u) => (u <= 1 ? 0 : u <= 4 ? 1 : u < 20 ? 2 : 3);
  const areaMix = new Map();
  for (const l of homes) {
    const k = Math.floor(l.cy / B) * 1000 + Math.floor(l.cx / B);
    const a = areaMix.get(k) || [0, 0, 0, 0];
    a[cls(l.units)] += l.units;
    areaMix.set(k, a);
  }
  out.mix = shareHomes((l) => { const a = areaMix.get(Math.floor(l.cy / B) * 1000 + Math.floor(l.cx / B)); const tot = a.reduce((s, v) => s + v, 0); return a.filter((v) => v >= 0.05 * tot).length >= 3; });
  // 48 Housing in Between
  const homeAt = new Uint8Array(W * H);
  for (const l of homes) homeAt[at(l)] = 1;
  const Dh = distField(W, H, (i) => homeAt[i] === 1, 8);
  const shops = lots.filter((l) => !l.dead && l.inTown && l.sf && l.sf.length);
  out.between = shops.length ? (100 * shops.filter((l) => l.mixed || l.units > 0 || Dh[at(l)] <= T(50)).length) / shops.length : 0;
  // 60 Accessible Green
  const Dgreen = distField(W, H, (i) => w.inTown[i] && (w.cover[i] === COVER.PARK || w.cover[i] === COVER.SPORT), 40);
  out.green = shareHomes((l) => Dgreen[at(l)] <= T(230));
  // 87 Individually Owned Shops
  const sf = sim.sfStats || {};
  out.owned = sf.open ? (100 * sf.indie) / sf.open : 0;
  // 89 Corner Grocery
  const groc = new Uint8Array(W * H);
  for (const l of lots) if (!l.dead && l.inTown && (l.biz || []).some((n, k) => GROCERY.test((l.bizKind && l.bizKind[k]) || '') || /\b(market|grocer)/i.test(n))) groc[at(l)] = 1;
  const Dg = distField(W, H, (i) => groc[i] === 1, 40);
  out.grocery = shareHomes((l) => Dg[at(l)] <= T(300));

  const items = PATTERNS.map((p) => ({ n: p.n, id: p.id, score: Math.round(clamp(out[p.id] || 0, 0, 100)) }));
  const score = Math.round(items.reduce((s, it) => s + it.score, 0) / items.length);
  sim.apl = { t: sim.t, y: sim.y, score, items };
  if (!sim.apl0) sim.apl0 = sim.apl;
  return sim.apl;
}
export const patternsNow = (sim) => (sim.apl && sim.apl.t === sim.t ? sim.apl : computePatterns(sim));
