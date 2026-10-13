// Regional housing market. Watertown doesn't set its own prices: most of what happens to home values here
// is the Boston-area market, with local supply and demand nudging around it. So prices are driven by an
// outside index (real history up to now, an assumed growth rate after) times a small local factor.
import { A } from './assumptions.js';
import { clamp } from './util.js';

// Watertown home values relative to 2000. Anchored to repeat-sales appreciation for Watertown
// (NeighborhoodScout: ×1.61 by late 2015, ×2.11 by late 2020, ×2.88 by late 2025); the 2000s boom, the
// 2008 bust and the slow recovery between anchors follow the shape of the Boston Case-Shiller index
// (approximate). 2026 continues the last year's trend.
export const HPI = {
  2000: 1.0, 2001: 1.11, 2002: 1.22, 2003: 1.32, 2004: 1.43, 2005: 1.49, 2006: 1.47, 2007: 1.43, 2008: 1.37, 2009: 1.31,
  2010: 1.33, 2011: 1.31, 2012: 1.33, 2013: 1.42, 2014: 1.51, 2015: 1.61, 2016: 1.7, 2017: 1.79, 2018: 1.88, 2019: 1.95,
  2020: 2.11, 2021: 2.4, 2022: 2.67, 2023: 2.7, 2024: 2.79, 2025: 2.88, 2026: 2.94,
};
const LAST = 2026;
// assessors value the whole property at market, so buildings follow the same index as land (repeat-sales
// indices measure the whole property too); kept as a knob in case a split is ever wanted
export const BLDG_ELASTICITY = 1;

// regional index for a year; after the data runs out, grows at the assumed rate
export function regionalIndex(sim, y) {
  if (y <= 2000) return HPI[2000];
  if (y <= LAST) return HPI[Math.floor(y)];
  return HPI[LAST] * Math.pow(1 + A(sim, 'regional'), y - LAST);
}

// called each new year: market = regional index since the start year × local factor
export function updateMarket(sim) {
  // local supply and demand move Watertown off the regional trend, but only relative to how they stood at the
  // start (the regional history already contains Watertown's own past); a level, not a compounding drift
  const d = clamp(sim.demand ? sim.demand.R : 0, -1, 1) - (sim.base && sim.base.demR0 != null ? sim.base.demR0 : 0);
  sim.localMkt = clamp(0.7 * (sim.localMkt || 1) + 0.3 * (1 + 0.15 * d), 0.85, 1.2);
  sim.regional = regionalIndex(sim, sim.y) / regionalIndex(sim, sim.y0 || sim.y);
  sim.market = sim.regional * sim.localMkt;
  return sim.market;
}

// how much values have risen from a past start year to today (used to deflate the 2000 map)
export const sinceYear = (y) => HPI[LAST] / HPI[y];

// Building values move with the market to the BLDG_ELASTICITY power. bldgF scales start-year values to now;
// nowB converts a 2026-dollar construction value to today's dollars in whatever year the game is in.
export const bldgF = (sim) => Math.pow(sim.market || 1, BLDG_ELASTICITY);
const startR = (sim) => regionalIndex(sim, sim.y0 || sim.y) / HPI[LAST];
export const nowB = (sim) => Math.pow(startR(sim) * (sim.market || 1), BLDG_ELASTICITY);
// set a lot's building value from a 2026-dollar figure
export function setBldgValue(sim, lot, v2026) {
  lot.bldgVal = v2026 * nowB(sim);
  lot.baseBldg = lot.bldgVal / bldgF(sim);
}
