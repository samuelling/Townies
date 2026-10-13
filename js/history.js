// "Start in 2000": rewinds today's real map to an approximate year-2000 Watertown.
// Every building whose assessor record says it was built after the start year is removed. Small
// residential lots keep a house (most new houses replaced old ones); bigger sites get a stand-in
// predecessor (light industry, a surface parking lot or an auto shop, or the Arsenal Mall near
// Arsenal Yards), clearly flagged as reconstructed. Values are deflated to the start year.
import { ZONE, COVER } from './config.js';
import { hash2 } from './util.js';
import { developLot, demolish, computeLotMetrics, styleBuilding, bldRate } from './world.js';
import { classifyLot } from './vibrancy.js';
import { makeProj } from './geo.js';
import { PEER_CENTERS } from './peers.js';

export const PAST_STARTS = { 2000: { label: 'Before the boom', land: 0.3, bldg: 0.45 } };

const AUTO_NAMES = ['{S} Auto Body', '{S} Service Center', 'Tire & Brake of {S}', '{S} Transmission', 'Quick Lube', '{S} Motors', 'Collision Experts', '{S} Muffler'];
const STREETS = ['Arsenal', 'Pleasant', 'Main', 'Galen', 'Coolidge', 'Bacon', 'School', 'Waverley', 'Bridge'];

export function rewindWorld(world, year) {
  const cfg = PAST_STARTS[year];
  if (!cfg) return world;
  const { lots, W } = world;
  // remember the real present for "how did you do against history?"
  const real = { year: 2026, units: 0, auto: 0 };
  for (const lot of lots) {
    if (lot.dead || !lot.inTown) continue;
    if (lot.zone === ZONE.R || lot.mixed) real.units += lot.units || 0;
    if (lot.biz && lot.biz.length) classifyLot(lot);
    else lot.auto = /^33[0-8]$/.test(lot.code3 || '');
    if (lot.auto) real.auto++;
  }
  world.real = real;
  const arsenal = PEER_CENTERS.find((c) => c.id === 'wt-arsenal');
  const [ax, ay] = arsenal ? makeProj(world.bbox).toGrid(arsenal.lat, arsenal.lon) : [-1e9, -1e9];
  const touched = { n: 0 };
  for (const lot of lots) {
    // the Arsenal Mall parcel still carries the old mall's year on its assessor card
    const mallSite = /Shopping Centers?\/Malls?/i.test(lot.useDesc || '') && Math.hypot(lot.cx - ax, lot.cy - ay) < 25;
    if (mallSite && !(lot.year > year)) lot.year = 2020;
    if (lot.dead || !lot.inTown || !lot.real || !(lot.year > year) || lot.svc) continue;
    if (lot.zone === ZONE.CIVIC || lot.zone === ZONE.PARK) continue;
    const builtYear = lot.year;
    const small = (lot.zone === ZONE.R && !lot.mixed && (lot.units || 0) <= 4) || lot.bldgs.every((id) => world.bldgs[id].kind === 'house');
    if (small) {
      // the house that stood here before; same footprint, older record
      lot.year = 1920 + Math.floor(hash2(lot.id, 5, 9) * 45);
      lot.units = Math.min(lot.units || 1, 2);
      lot.reconstructed = builtYear;
      lot.hist = 'house';
      continue;
    }
    const r = hash2(lot.id, 7, 13);
    const nearMall = mallSite || (Math.hypot(lot.cx - ax, lot.cy - ay) < 22 && builtYear >= 2015);
    let kind = nearMall ? 'mall' : lot.area >= 4000 ? (r < 0.65 ? 'industrial' : 'parking') : r < 0.4 ? 'auto' : r < 0.75 ? 'industrial' : 'parking';
    for (const id of lot.bldgs) demolish(world, world.bldgs[id]);
    lot.bldgs = [];
    lot.biz = [];
    lot.bizKind = [];
    lot.bizChain = [];
    lot.units = 0;
    lot.mixed = false;
    lot.reconstructed = builtYear;
    lot.hist = kind;
    lot.year = 1955 + Math.floor(hash2(lot.id, 6, 9) * 30);
    lot.style = '';
    lot.stories = NaN;
    if (kind === 'parking') {
      lot.zone = ZONE.C;
      lot.code3 = '337';
      lot.useDesc = 'Parking lot (reconstructed)';
      for (const i of lot.tiles) world.cover[i] = COVER.PAVED;
    } else if (kind === 'mall') {
      lot.zone = ZONE.C;
      lot.code3 = '323';
      lot.useDesc = 'Shopping mall (reconstructed)';
      developLot(world, lot, 1, 2000 + lot.id);
      lot.biz = ['Arsenal Mall anchor store', 'Mall food court', 'Discount clothing outlet', 'Home improvement superstore'].slice(0, lot.area > 6000 ? 4 : 2);
      lot.bizKind = ['department_store', 'food_court', 'clothes', 'doityourself'].slice(0, lot.biz.length);
      lot.bizChain = lot.biz.map(() => 1);
    } else if (kind === 'auto') {
      lot.zone = ZONE.C;
      lot.code3 = '332';
      lot.useDesc = 'Auto repair (reconstructed)';
      developLot(world, lot, 1, 2000 + lot.id);
      const nm = AUTO_NAMES[Math.floor(hash2(lot.id, 8, 9) * AUTO_NAMES.length)].replace('{S}', STREETS[Math.floor(hash2(lot.id, 9, 9) * STREETS.length)]);
      lot.biz = [nm];
      lot.bizKind = ['car_repair'];
      lot.bizChain = [0];
    } else {
      lot.zone = ZONE.I;
      lot.code3 = '400';
      lot.useDesc = 'Light industrial (reconstructed)';
      developLot(world, lot, lot.area > 6000 ? 2 : 1, 2000 + lot.id);
    }
    // predecessors are old buildings, not new construction
    for (const id of lot.bldgs) {
      const b = world.bldgs[id];
      b.proc = 0;
      styleBuilding(b, lot);
    }
    lot.bldgZone = lot.zone;
    computeLotMetrics(world, lot, false);
    lot.bldgVal = lot.bldArea * bldRate(lot.zone);
    lot.otherVal = 0;
    lot.dense = false;
    lot.bizCat = null;
    if (lot.biz.length) classifyLot(lot);
    touched.n++;
  }
  // back to start-year dollars
  for (const lot of lots) {
    if (lot.dead) continue;
    lot.landVal *= cfg.land;
    lot.bldgVal *= cfg.bldg;
    lot.otherVal = (lot.otherVal || 0) * cfg.bldg;
    lot.totalVal = lot.landVal + lot.bldgVal + lot.otherVal;
    lot.baseLand = lot.landVal;
    lot.baseBldg = lot.bldgVal + lot.otherVal;
  }
  for (let i = 0; i < world.lvBase.length; i++) world.lvBase[i] *= cfg.land;
  world.lvMedian *= cfg.land;
  world.startYear = year;
  world.rewound = touched.n;
  void W;
  return world;
}
