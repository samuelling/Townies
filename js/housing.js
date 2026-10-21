// Housing: what kinds of homes the town has, who they're affordable to, and the rules new buildings are built
// under. The levers are the ones Watertown actually fights over:
//  - the inclusionary rule: the share of homes in a new building that must be deed-restricted affordable.
//    Higher yields more affordable homes per building, and fewer buildings: each affordable unit is money the
//    developer doesn't make, and marginal projects stop penciling out.
//  - height limits, by kind of zoning. Taller lets more homes (and more affordable ones) onto a lot and makes
//    podium buildings pay; it also brings shadows, "character" fights at every hearing, and homeowners' anger.
//  - what developers have to do with the ground floor of a mixed-use building (see storefronts.js): left alone
//    they build deep, unvented boxes at top-of-market rents that only chains, gyms, salons and spas will lease.
// The state counts deed-restricted homes on its Subsidized Housing Inventory (SHI). Below 10%, a developer can
// file a "comprehensive permit" under Chapter 40B and override local zoning; at 10% the town has a safe harbor.
// A rental building with at least 25% affordable homes counts on the SHI in full.
import { ZONE } from './config.js';
import { clamp, hash2 } from './util.js';
import { syncBiz } from './storefronts.js';

// Watertown's rules and counts (sources in js/bts.js and README.md)
export const HOUSING_REAL = {
  iz: 0.15, // inclusionary share for buildings of 20+ homes (12.5% for 6-19), Zoning Ordinance 5.07, since 2016
  izMin: 6, // buildings with at least this many homes owe it
  shiUnits: 1263, // homes on the state's Subsidized Housing Inventory (EOHLC, 9/30/2025): 7.46%
  shiDenom: 16936, // the inventory's denominator: 2020 Census year-round homes
  // stories allowed by right: single- and two-family districts 35 ft / 2.5 stories; the Pleasant St corridor,
  // Arsenal St and the Watertown Square districts mostly 5 (with step-backs); industrial 55 ft
  heights: { R: 2.5, M: 5, C: 5 },
  bonus: true, // Watertown Square: an extra story for deeper affordability
};
export const HTYPE = {
  single: 'Single-family houses', multi: 'Two- and three-families', condo: 'Condos', apts: 'Apartment buildings', mixed: 'Homes over shops',
  newmkt: 'New market-rate (since you took office)', newaff: 'New affordable (deed-restricted)',
};
const CODE_TYPE = { 101: 'single', 102: 'condo', 104: 'multi', 105: 'multi', 106: 'single', 109: 'multi', 111: 'apts', 112: 'apts', 125: 'apts', 140: 'apts', 13: 'mixed', 14: 'mixed', 31: 'mixed' };

export function housingPolicy(sim) {
  if (!sim.hp) sim.hp = { iz: HOUSING_REAL.iz, hR: HOUSING_REAL.heights.R, hM: HOUSING_REAL.heights.M, hC: HOUSING_REAL.heights.C, bonus: HOUSING_REAL.bonus };
  return sim.hp;
}
export function housingState(sim) {
  if (!sim.housing) sim.housing = { shiAdded: 0, affAdded: 0, mktAdded: 0, condoAdded: 0, tall: 0, filings: 0, safe: false, log: [] };
  return sim.housing;
}
export function lotHousingType(lot) {
  if (lot.hNew) return lot.affU >= lot.units ? 'newaff' : 'newmkt';
  return CODE_TYPE[+lot.code3] || (lot.mixed ? 'mixed' : lot.units >= 6 ? 'apts' : lot.units >= 2 ? 'multi' : 'single');
}

// the height limit that applies to a lot (stories)
// (neighborhoods, i.e. light residential; multifamily and mixed-use districts, i.e. dense residential and mixed
// use; commercial and lab districts)
const capKey = (lot) => (lot.muZ || lot.mixed || (lot.zone === ZONE.R && lot.dense) ? 'M' : lot.zone === ZONE.R ? 'R' : 'C');
export function heightCap(sim, lot) {
  const P = housingPolicy(sim);
  return { R: P.hR, M: P.hM, C: P.hC }[capKey(lot)];
}

// how much more or less likely a market builder is to go ahead under today's rules, against the real ones:
// each point of inclusionary share above the real rule costs about 3% of the projects; a mid-rise cap below four
// stories means no podium building pays; each story above the real cap makes the land a little more worth it
export function feasibility(sim, lot) {
  const P = housingPolicy(sim);
  const S = sim.policies || {};
  const izF = clamp(1 - 3 * (P.iz - HOUSING_REAL.iz), 0.25, 1.4);
  const k = capKey(lot), cap = heightCap(sim, lot), base = HOUSING_REAL.heights[k];
  const hF = clamp(1 + 0.07 * (cap - base), 0.5, 1.5) * (k === 'M' && cap < 4 && cap < base ? 0.5 : 1);
  const gfF = lot.muZ ? (S.gfDesign ? 0.93 : 1) * (S.gfDeed ? 0.92 : 1) : 1;
  return izF * hF * gfF;
}

// new homes, wherever they come from (market growth, projects, the developer, a 40B): who they're for
export function recordHomes(sim, lot, units, opts = {}) {
  if (!(units > 0)) return;
  const P = housingPolicy(sim), H = housingState(sim);
  const nonprofit = !!opts.nonprofit;
  // the rule: 6-19 homes owe 2.5 points less than 20+; a bonus story's homes are all affordable
  const izRate = units >= 20 ? P.iz : Math.max(0, P.iz - 0.025);
  let aff = nonprofit ? units : opts.aff != null ? opts.aff : units >= HOUSING_REAL.izMin ? Math.round(units * izRate) : 0;
  if (!nonprofit && opts.aff == null && lot.bonusFloor && opts.stories > 1) aff = Math.min(units, aff + Math.round(units / opts.stories));
  const condo = !nonprofit && (opts.condo != null ? opts.condo : sim.rand() < 0.35 + 0.3 * clamp((sim.market || 1) - 1, 0, 1));
  lot.hNew = 1;
  lot.affU = (lot.affU || 0) + aff;
  lot.tenure = condo ? 'condo' : 'rental';
  H.affAdded += aff;
  H.mktAdded += units - aff;
  if (condo) H.condoAdded += units - aff;
  // the state counts every home in a rental building that's at least a quarter affordable
  const shi = !condo && aff >= 0.25 * units ? units : aff;
  lot.shiU = (lot.shiU || 0) + shi;
  H.shiAdded += shi;
  const stories = opts.stories || 0;
  if (stories >= 6 && nearHouses(sim, lot)) H.tall++;
  H.log.unshift({ date: sim.dateStr(), name: opts.name || lot.addr || 'New building', units, aff, condo, shi, stories, lot: lot.id, why: opts.why || '' });
  if (H.log.length > 20) H.log.pop();
}
// a building came down: its deed-restricted homes come off the inventory
export function removeHomes(sim, lot) {
  const H = housingState(sim);
  if (lot.shiU) { H.shiAdded -= lot.shiU; lot.shiU = 0; }
  if (lot.affU) { H.affAdded -= lot.affU; lot.affU = 0; }
}
function nearHouses(sim, lot) {
  for (const l of sim.w.lots) {
    if (l === lot || l.dead || l.zone !== ZONE.R || !(l.units > 0) || l.units > 3) continue;
    if (Math.abs(l.cx - lot.cx) < 6 && Math.abs(l.cy - lot.cy) < 6) return true;
  }
  return false;
}

export function shiNow(sim) {
  const H = housingState(sim);
  const units = HOUSING_REAL.shiUnits + H.shiAdded;
  return { units, pct: (100 * units) / HOUSING_REAL.shiDenom, denom: HOUSING_REAL.shiDenom };
}

export function housingStats(sim) {
  const by = Object.fromEntries(Object.keys(HTYPE).map((k) => [k, 0]));
  let units = 0;
  for (const l of sim.w.lots) {
    if (l.dead || !l.inTown || !(l.units > 0)) continue;
    units += l.units;
    if (l.hNew) { by.newaff += l.affU || 0; by.newmkt += l.units - (l.affU || 0); }
    else by[lotHousingType(l)] += l.units;
  }
  return { units, by, shi: shiNow(sim), H: housingState(sim), P: housingPolicy(sim) };
}

// standing approval, by reason (sim.js adds these to each faction's terms)
export function housingApproval(sim) {
  const P = housingPolicy(sim), H = housingState(sim), R = HOUSING_REAL;
  const out = [];
  const g = (why, o) => out.push([why, o]);
  g('affordable homes', { renters: Math.min(8, H.affAdded / 40), seniors: Math.min(2, H.affAdded / 150) });
  const dIz = P.iz - R.iz;
  g('the inclusionary rule', { renters: clamp(25 * dIz, -4, 4), business: clamp(-30 * dIz, -6, 4), homeowners: clamp(-6 * dIz, -1, 1) });
  const up = Math.max(0, P.hM - R.heights.M) + 2 * Math.max(0, P.hR - R.heights.R) + 0.5 * Math.max(0, P.hC - R.heights.C);
  const down = Math.max(0, R.heights.M - P.hM) + 2 * Math.max(0, R.heights.R - P.hR);
  g('height limits', { homeowners: -1.3 * up + 0.7 * Math.min(3, down), seniors: -0.6 * up, renters: 0.6 * up - 0.8 * down, business: 0.8 * up - 1 * down });
  g('tall buildings next door', { homeowners: -Math.min(6, 0.8 * H.tall), seniors: -Math.min(2, 0.3 * H.tall) });
  return out;
}

// existing homes at the start: tag the town's mixed-use parcels as mixed-use zoning
export function initHousing(sim) {
  housingPolicy(sim);
  housingState(sim);
  for (const l of sim.w.lots) if (!l.dead && l.mixed && l.zone === ZONE.C) l.muZ = true;
}

// The market put up a building (sim.buildLot calls this right after the walls go up): hold it to the height
// limit, and on mixed-use zoning make it a developer's mixed-use block: homes over a ground floor of storefronts.
export function shapeNewBuilding(sim, lot) {
  const w = sim.w, P = housingPolicy(sim);
  let cap = heightCap(sim, lot);
  // the affordability bonus: one more story by right if its homes are affordable (not next to houses)
  lot.bonusFloor = !!(P.bonus && capKey(lot) === 'M' && lot.dense && !nearHouses(sim, lot));
  if (lot.bonusFloor) cap += 1;
  let stories = 0;
  for (const id of lot.bldgs) {
    const b = w.bldgs[id];
    if (lot.muZ) {
      b.kind = 'shop';
      b.levels = lot.dense ? cap : Math.min(3, cap);
      b.proc = 1;
      b.arch = hash2(b.id, 7, 7) < 0.75 ? 'modern' : 'brick';
      const cols = b.arch === 'brick' ? ['#a4523c', '#9a4a36', '#b0603f'] : ['#3a3d42', '#6d7680', '#e9e7e2', '#8a5a44', '#b9b2a6'];
      b.col = cols[Math.floor(hash2(b.id, 3, 3) * cols.length)];
      b.col2 = b.arch === 'modern' ? '#d9d4ca' : null;
      b.trim = '#efe9dc';
      b.roofCol = '#77746e';
      b.awning = null;
      b.roof = 'flat';
      b.h = b.levels * 3.3;
    } else if (b.levels > cap) {
      b.levels = cap;
      b.h = cap * 3.1;
    }
    stories = Math.max(stories, b.levels);
  }
  if (lot.muZ) {
    // a body shop or a parking lot rebuilt as homes over shops stops being auto-oriented
    if (lot.auto) sim.autoConverted = (sim.autoConverted || 0) + 1;
    lot.mixed = true; lot.auto = false; lot.code3 = ''; lot.hist = null; lot.reconstructed = null;
    lot.useDesc = 'Mixed use: homes over storefronts';
  }
  return stories;
}

// a developer's ground floor: the storefronts open empty, priced at the pro forma, unless the rules say otherwise
export function newGroundFloor(sim, lot) {
  const w = sim.w, S = sim.policies || {};
  let fr = 0;
  for (const i of lot.tiles) if (w.road[i - 1] || w.road[i + 1] || w.road[i - w.W] || w.road[i + w.W]) fr++;
  const n = Math.max(1, Math.min(8, Math.round(fr * 1.1)));
  lot.sf = [];
  lot.biz = []; lot.bizKind = []; lot.bizCat = []; lot.bizChainF = []; lot.bizSig = [];
  lot.storefronts = n;
  lot.vacant = n;
  lot.vacantSince = sim.t;
  lot.newGF = { design: !!S.gfDesign, deed: !!S.gfDeed, t: sim.t };
  lot.greed = S.gfDeed ? 1 : 1.35; // the lender underwrote the pro forma rent; the developer holds out for it
  lot.ask = S.gfDeed ? 1.0 : S.gfDesign ? 1.25 : 1.45;
  if (S.gfDeed) { lot.rentCap = 1.05; lot.rentCapUntil = sim.t + 180; }
  lot.ff0 = null;
  syncBiz(lot);
}

// monthly: the state's 10% line
export function housingMonthly(sim) {
  const H = housingState(sim), pct = shiNow(sim).pct;
  if (pct >= 10 && !H.safe) {
    H.safe = true;
    sim.news('Watertown reaches the state’s 10%', 'With a tenth of its homes on the subsidized inventory, the town can turn down 40B comprehensive permits that don’t fit its zoning. Housing advocates point out that 10% was always meant to be a floor.', 'big');
  } else if (pct < 9.8 && H.safe) H.safe = false;
}
