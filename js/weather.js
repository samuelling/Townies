// Weather: a stochastic daily weather generator driven by Boston's real climate normals (Logan Airport,
// NOAA 1991–2020), the way hydrologists and farm models do it. Wet and dry days cluster (a two-state Markov
// chain matched to each month's number of wet days), rain amounts follow an exponential distribution matched
// to monthly totals, temperatures wander around the monthly normal with day-to-day persistence, and it snows
// when a wet day is cold enough. A warming trend, one of the labeled assumptions, shifts temperatures
// (and so the rain/snow mix) as the years go by. It reproduces the character of Watertown's weather, not the
// actual weather of any particular past day.
import { hash2, clamp } from './util.js';
import { A } from './assumptions.js';

// month by month: mean daily high and low (°F), precipitation (in), days with ≥0.01 in
export const NORMALS = {
  hi: [36.8, 39.0, 45.5, 56.4, 66.5, 76.2, 82.1, 80.4, 73.1, 62.1, 51.6, 42.2],
  lo: [23.1, 24.6, 31.1, 40.8, 50.3, 59.7, 66.0, 65.1, 58.2, 47.5, 37.9, 29.2],
  precip: [3.39, 3.21, 4.17, 3.63, 3.25, 3.89, 3.27, 3.23, 3.56, 4.03, 3.66, 4.3],
  wetDays: [11.8, 10.6, 11.6, 11.6, 11.8, 10.9, 9.4, 9.0, 9.0, 10.5, 10.3, 11.9],
  snow: [14.3, 14.4, 9.0, 1.6, 0, 0, 0, 0, 0, 0.2, 0.7, 9.0], // for checking the generator (49.2 in a year)
};
const SD = [7.5, 7.5, 7, 6.5, 6, 5, 4.5, 4.5, 5, 6, 6.5, 7.5]; // day-to-day spread of daily mean temperature
const DAYS = 30;
const PERSIST = 0.32; // wet-day persistence
const PHI = 0.62; // temperature persistence
const NORMAL_YEAR = 2005; // the middle of 1991–2020

// a small seeded random stream for one month, so a given month's weather is the same every time
function stream(y, m, salt) {
  let k = 0;
  return () => hash2(y * 12 + m, salt, k++);
}
const gauss = (r) => { const u = Math.max(1e-9, r()), v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

export const warmingF = (sim) => A(sim, 'warming') || 0; // °F per decade

export function monthWeather(sim, y = sim.y, m = sim.m) {
  const key = y * 12 + m;
  sim.wxc = sim.wxc || {};
  if (sim.wxc.key === key && sim.wxc.month) return sim.wxc.month;
  const prev = sim.wxc.prev && sim.wxc.prev.key === key - 1 ? sim.wxc.prev : sim.wxc.month && sim.wxc.key === key - 1 ? sim.wxc.month : null;
  const r = stream(y, m, 17 + (sim.w && sim.w.W ? sim.w.W % 97 : 0));
  const warm = (warmingF(sim) * (y + m / 12 - NORMAL_YEAR)) / 10;
  const wetFrac = NORMALS.wetDays[m] / 30.4;
  const pWW = wetFrac + PERSIST * (1 - wetFrac), pWD = wetFrac * (1 - PERSIST);
  const meanAmt = NORMALS.precip[m] / NORMALS.wetDays[m];
  // heavier downpours with warming (a few percent per degree; labeled with the warming assumption)
  const wetter = 1 + 0.02 * Math.max(0, warm);
  let wet = prev ? prev.lastWet : r() < wetFrac;
  let anom = prev ? prev.lastAnom * PHI : gauss(r) * SD[m];
  let pack = prev ? prev.pack : 0;
  const days = [];
  let precip = 0, snow = 0, wetN = 0, snowN = 0, hot = 0, maxSnow = 0;
  for (let d = 0; d < DAYS; d++) {
    wet = r() < (wet ? pWW : pWD);
    anom = PHI * anom + Math.sqrt(1 - PHI * PHI) * SD[m] * gauss(r);
    const mean = (NORMALS.hi[m] + NORMALS.lo[m]) / 2 + anom + warm;
    const half = (NORMALS.hi[m] - NORMALS.lo[m]) / 2 * (wet ? 0.7 : 1.05);
    const hi = mean + half, lo = mean - half;
    const amt = wet ? -Math.log(Math.max(1e-6, r())) * meanAmt * wetter : 0;
    // snow when it's cold enough; around freezing it's a mix
    const frac = clamp((34 - mean) / 9, 0, 1);
    const sn = amt * frac * 11; // about 11 inches of snow per inch of water
    pack = Math.max(0, pack + sn - Math.max(0, mean - 32) * 0.35 - (wet && frac < 0.5 ? amt * 2 : 0));
    days.push({ hi: Math.round(hi), lo: Math.round(lo), rain: +(amt * (1 - frac)).toFixed(2), snow: +sn.toFixed(1), pack: +pack.toFixed(1) });
    precip += amt;
    snow += sn;
    if (amt >= 0.01) wetN++;
    if (sn >= 0.1) snowN++;
    if (hi >= 90) hot++;
    maxSnow = Math.max(maxSnow, sn);
  }
  const month = {
    key, y, m, days, precip: +precip.toFixed(2), snow: +snow.toFixed(1), wetDays: wetN, snowDays: snowN, hotDays: hot, maxSnow: +maxSnow.toFixed(1),
    hi: Math.round(days.reduce((s, d) => s + d.hi, 0) / DAYS), lo: Math.round(days.reduce((s, d) => s + d.lo, 0) / DAYS),
    pack: +pack.toFixed(1), lastWet: wet, lastAnom: anom, warm: +warm.toFixed(2),
  };
  sim.wxc = { key, month, prev: sim.wxc.month || null };
  return month;
}

export const weatherDay = (sim, d) => monthWeather(sim).days[clamp(Math.floor(d), 0, DAYS - 1)];

// how much weather slows traffic this month (wet roads, snow-narrowed lanes)
export function weatherCapF(sim) {
  const w = monthWeather(sim);
  const snowyDays = w.days.filter((d) => d.snow >= 1 || d.pack >= 3).length;
  return (1 - 0.06 * (w.wetDays / DAYS) - 0.18 * (snowyDays / DAYS)) / CAP_AVG;
}
// people walk and shop more in pleasant weather; cold, wet months keep them in (and online)
export function weatherFoot(sim) {
  const w = monthWeather(sim);
  const mean = (w.hi + w.lo) / 2;
  const comfort = 1 - Math.abs(mean - 64) / 40; // 1 at ~64°F, 0 at ~24°F or ~104°F
  return clamp(0.94 + 0.12 * comfort - 0.05 * (w.wetDays / DAYS) - 0.04 * (w.snowDays / 10), 0.86, 1.08);
}
// the year-round average of weatherFoot and weatherCapF in today's climate, so seasons swing around 1
export const WF_AVG = (() => {
  let t = 0;
  for (let m = 0; m < 12; m++) {
    const mean = (NORMALS.hi[m] + NORMALS.lo[m]) / 2;
    t += clamp(0.94 + 0.12 * (1 - Math.abs(mean - 64) / 40) - 0.05 * (NORMALS.wetDays[m] / DAYS) - 0.04 * ((NORMALS.snow[m] > 1 ? NORMALS.snow[m] / 3 : 0) / 10), 0.86, 1.08);
  }
  return t / 12;
})();
export const CAP_AVG = 0.97;

export const WX_ICON = (w) => (w.snow >= 4 ? '❄' : w.hotDays >= 3 ? '☀' : w.wetDays >= 14 ? '☂' : w.pack >= 2 ? '❄' : (w.hi + w.lo) / 2 >= 60 ? '☀' : '⛅');

// once a month: the weather news, and the first snow
export function weatherMonthly(sim) {
  const w = monthWeather(sim);
  sim.wxLog = (sim.wxLog || []).filter((x) => x.key !== w.key).concat([{ key: w.key, y: w.y, m: w.m, hi: w.hi, lo: w.lo, precip: w.precip, snow: w.snow, wetDays: w.wetDays, hotDays: w.hotDays, maxSnow: w.maxSnow }]).slice(-36);
  const big = w.days.reduce((b, d, i) => (d.snow > (b ? w.days[b.i].snow : 0) ? { i } : b), null);
  if (w.maxSnow >= 10) {
    sim.news(`Nor'easter dumps ${Math.round(w.maxSnow)} inches`, 'Plows run all night, the parking ban is on, and every corner gets a snowbank taller than the kids.', 'big');
    sim.moment && sim.moment('snow');
  } else if (w.snow >= 0.5 && !(sim.wxSeason && sim.wxSeason.y === seasonYear(w))) {
    sim.wxSeason = { y: seasonYear(w) };
    sim.news('First snow of the season', `${w.snow >= 3 ? `${Math.round(w.snow)} inches` : 'A dusting'} on the rooftops. Someone on Main Street is already shoveling a sidewalk that doesn't need it.`);
    sim.moment && sim.moment('snow');
  }
  let run = 0, best = 0;
  for (const d of w.days) { run = d.hi >= 90 ? run + 1 : 0; best = Math.max(best, run); }
  if (best >= 3) sim.news(`Heat wave: ${best} days over 90°`, 'Cooling centers open at the library and the senior center. The splash pad has a line.');
  void big;
}
const seasonYear = (w) => (w.m >= 7 ? w.y : w.y - 1);
