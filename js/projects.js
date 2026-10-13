// Redevelopment projects: the "build" verb for a town that's already built.
// Draw a site over real parcels -> pick a program -> negotiate -> public hearing -> construction -> ribbon.
// Land costs come from real assessed values; holdouts, displacement, and politics come from what's there.
import { ZONE, COVER } from './config.js';
import { setBldgValue, bldgF } from './market.js';
import { clamp, hash2, fmtMoney } from './util.js';
import { developLot, demolish, computeLotMetrics, bldRate, eraStyle } from './world.js';
import { classifyLot } from './vibrancy.js';
import { react } from './comments.js';
import { openShop } from './storefronts.js';
import { techBuildCostF, techBuildTimeF } from './tech.js';
import { meloraOnSubmit, meloraAtHearing, meloraAfterVote, pauseActive } from './melora.js';

const M2 = 256; // m² per tile
export const PROGRAMS = {
  mega: {
    label: 'Developer megaproject', who: 'developer', icon: '🏗',
    blurb: 'Arsenal Yards–style mixed use: apartments over national-chain retail and a garage. Fast and lucrative — the developer buys the land — but light on character.',
    defaults: { floors: 7, affordable: 10, local: 0, plaza: false, parking: 1.0, transit: 0 },
  },
  infill: {
    label: 'Main Street infill', who: 'city', icon: '🏪',
    blurb: 'The City assembles the land and sells it lot-by-lot to small builders under design rules: 3–4 stories, storefronts at the sidewalk, no curb cuts. Slow and expensive; makes streets people want to walk.',
    defaults: { floors: 4, deedRent: true, upper: 'homes' },
  },
  housing: {
    label: 'Apartments', who: 'developer', icon: '🏢',
    blurb: 'Residential building. Market-rate with inclusionary units, or 100% affordable with a nonprofit and a City subsidy.',
    defaults: { floors: 5, affordable: 13, nonprofit: false, parking: 0.75 },
  },
  lab: {
    label: 'Lab / R&D', who: 'developer', icon: '🧪',
    blurb: 'Life-science building. Huge commercial tax base and jobs, zero street life, lots of traffic, and the lab market is cyclical.',
    defaults: { floors: 6, parking: 1.2, transit: 0 },
  },
  plaza: {
    label: 'Public plaza & green', who: 'city', icon: '🌳',
    blurb: 'The City buys the land and makes a public square: trees, seating, a café kiosk. Pure cost, big lift to everything around it.',
    defaults: { kiosk: true },
  },
};

// ---------- site analysis ----------
export function siteFromRect(sim, a, b) {
  const w = sim.w;
  const W = w.W;
  const x0 = Math.min(a % W, b % W), x1 = Math.max(a % W, b % W);
  const y0 = Math.min((a / W) | 0, (b / W) | 0), y1 = Math.max((a / W) | 0, (b / W) | 0);
  const cnt = new Map();
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const li = w.lotOf[y * W + x];
      if (li >= 0) cnt.set(li, (cnt.get(li) || 0) + 1);
    }
  const lots = [];
  const ends = new Set([w.lotOf[a], w.lotOf[b]]);
  for (const [li, n] of cnt) {
    const lot = w.lots[li];
    if (lot.dead || !lot.inTown || lot.project || !lot.tiles.length) continue;
    if (lot.zone === ZONE.CIVIC || lot.zone === ZONE.PARK) continue;
    const centroidIn = lot.cx >= x0 && lot.cx <= x1 + 1 && lot.cy >= y0 && lot.cy <= y1 + 1;
    if (n / lot.tiles.length < 0.35 && !centroidIn && !ends.has(li)) continue;
    lots.push(li);
  }
  return lots.slice(0, 40);
}

export function analyze(sim, lotIds, exclude = new Set()) {
  const w = sim.w;
  const ids = lotIds.filter((i) => !exclude.has(i));
  const s = { ids, frontage: 0, tiles: 0, area: 0, value: 0, acq: 0, homes: 0, residents: 0, jobs: 0, biz: [], indie: 0, sig: 0, auto: 0, holdouts: [], tax: 0, cx: 0, cy: 0, nearHomes: 0, legacy: 0 };
  const r = sim.rates();
  for (const li of ids) {
    const lot = w.lots[li];
    const v = lot.landVal + lot.bldgVal + (lot.otherVal || 0);
    s.tiles += lot.tiles.length;
    for (const i of lot.tiles) if (w.road[i - 1] || w.road[i + 1] || w.road[i - w.W] || w.road[i + w.W]) s.frontage++;
    s.area += lot.area || lot.tiles.length * M2;
    s.value += v;
    s.homes += lot.units || 0;
    s.residents += Math.round((lot.units || 0) * 2.3 * lot.occ);
    s.jobs += Math.round((lot.jobs || 0) * lot.occ);
    s.tax += (v * (lot.zone === ZONE.R ? r.rateR : r.rateC)) / 1000;
    s.cx += lot.cx * lot.tiles.length;
    s.cy += lot.cy * lot.tiles.length;
    if (lot.auto) s.auto++;
    if (lot.biz && lot.biz.length) {
      if (!lot.bizCat) classifyLot(lot);
      lot.biz.forEach((n, k) => {
        if (lot.bizCat[k] === 'none') return;
        s.biz.push(n);
        if (!lot.bizChainF[k]) s.indie++;
        if (lot.bizSig && lot.bizSig[k]) s.sig++;
      });
    }
    if (lot.sf && lot.sf.some((x) => x.orig && !x.chain)) s.legacy++;
    // owners who won't sell at assessed value
    const h = hash2(lot.id, 404, 9);
    const p = lot.greed > 1.15 ? 0.45 : lot.units === 1 ? 0.22 : lot.units ? 0.12 : 0.1;
    let mult = 1.15;
    if (h < p) {
      mult = 1.8 + 1.2 * hash2(lot.id, 405, 9);
      s.holdouts.push({ id: lot.id, addr: lot.addr || 'parcel', ask: v * mult, base: v });
    }
    s.acq += v * mult;
  }
  if (s.tiles) {
    s.cx /= s.tiles;
    s.cy /= s.tiles;
  }
  // neighbors who'll come to the hearing
  for (const lot of w.lots) {
    if (lot.dead || lot.zone !== ZONE.R || lot.dens > 2 || ids.includes(lot.id)) continue;
    if (Math.hypot(lot.cx - s.cx, lot.cy - s.cy) < 9) s.nearHomes++;
  }
  const c = sim.cellOf(s.cx, s.cy);
  s.lv = sim.lvMod[c] * sim.market;
  s.vib = sim.vibSat ? sim.vibSat[c] : 0;
  return s;
}

// ---------- program economics ----------
export function evaluate(sim, site, prog, t) {
  const P = PROGRAMS[prog];
  const pf = sim.priceF ? sim.priceF() : 1;
  const A = site.area; // m²
  const o = { prog, homes: 0, affordable: 0, storefronts: 0, localShops: 0, chainShops: 0, jobs: 0, floorArea: 0, newValue: 0, cityCost: 0, months: 24, devFeas: null, trips: 0, vibGain: 0, notes: [] };
  const lv = site.lv || 1;
  const vibF = 1 + (site.vib || 0);
  if (prog === 'mega') {
    const cover = t.plaza ? 0.5 : 0.6;
    const fa = A * cover * t.floors;
    o.storefronts = Math.max(2, Math.round(site.frontage * 0.8));
    const retail = Math.min(A * cover, o.storefronts * 300);
    // structured parking (≈30 m²/space) comes out of the building
    o.homes = Math.max(0, Math.round(((fa - retail) * 0.8 - (retail / 1000) * 2 * 30) / (90 + 30 * t.parking * 0.8)));
    o.affordable = Math.round((o.homes * t.affordable) / 100);
    o.localShops = Math.round((o.storefronts * t.local) / 100);
    o.chainShops = o.storefronts - o.localShops;
    o.jobs = Math.round(retail / 35);
    o.floorArea = fa;
    const spaces = Math.round(o.homes * t.parking + (retail / 1000) * 2);
    const cost = site.acq + fa * 3900 * techBuildCostF(sim) * pf + spaces * 45000 * pf + (t.plaza ? A * 0.15 * 600 * pf : 0) + t.transit * 1e6 * pf;
    const value = (o.homes - o.affordable) * 820000 * pf * lv + o.affordable * 260000 * pf + retail * 5200 * pf * vibF * (1 - 0.25 * (t.local / 100));
    o.devFeas = (value - cost) / cost - 0.12;
    o.newValue = fa * 3300 * pf * lv + site.value * 0.3;
    o.months = 22 + Math.round(t.floors * 2);
    o.trips = o.homes * (0.5 + 0.5 * t.parking) + o.jobs * 0.6;
    o.spaces = spaces;
  } else if (prog === 'infill') {
    const fa = A * 0.6 * t.floors;
    o.floorArea = fa;
    o.storefronts = Math.max(site.ids.length, Math.round(site.frontage * 1.1));
    const retail = Math.min(A * 0.6, o.storefronts * 130);
    o.localShops = o.storefronts;
    o.homes = t.upper === 'homes' ? Math.round(((fa - retail) * 0.82) / 85) : 0;
    o.jobs = Math.round(retail / 30) + (t.upper === 'offices' ? Math.round((fa - retail) / 25) : 0);
    const resale = site.value * 0.55 * (t.deedRent ? 0.8 : 1);
    o.cityCost = Math.max(0, site.acq - resale);
    o.newValue = fa * 3000 * pf * lv;
    o.months = 18 + site.ids.length * 3;
    o.trips = o.homes * 0.45 + o.jobs * 0.4;
  } else if (prog === 'housing') {
    const fa = A * 0.65 * t.floors;
    o.floorArea = fa;
    o.homes = Math.round((fa * 0.8) / 85);
    o.affordable = t.nonprofit ? o.homes : Math.round((o.homes * t.affordable) / 100);
    const spaces = Math.round(o.homes * t.parking);
    const cost = site.acq + fa * 5200 * techBuildCostF(sim) * pf + spaces * 40000 * pf;
    const value = (o.homes - o.affordable) * 760000 * pf * lv + o.affordable * 260000 * pf;
    if (t.nonprofit) {
      o.cityCost = Math.max(0, cost * 0.92 - value) * 0.35; // state & federal credits cover the rest
      o.devFeas = 0.05;
    } else o.devFeas = (value - cost) / cost - 0.12;
    o.newValue = fa * 3100 * pf * lv;
    o.months = 20 + t.floors * 2;
    o.trips = o.homes * (0.45 + 0.5 * t.parking);
    o.spaces = spaces;
  } else if (prog === 'lab') {
    const fa = A * 0.6 * t.floors;
    o.floorArea = fa;
    o.jobs = Math.round(fa / 45);
    const spaces = Math.round((fa / 1000) * 2.5 * t.parking);
    const cost = site.acq + fa * 6200 * techBuildCostF(sim) * pf + spaces * 45000 * pf + t.transit * 1e6 * pf;
    const labMkt = clamp(1 + 0.5 * (sim.demand ? sim.demand.I : 0), 0.6, 1.5);
    const value = fa * 8300 * pf * labMkt;
    o.devFeas = (value - cost) / cost - 0.12;
    o.newValue = fa * 5200 * pf;
    o.months = 26 + t.floors * 2;
    o.trips = o.jobs * (0.45 + 0.5 * t.parking);
    o.spaces = spaces;
    if (labMkt < 0.9) o.notes.push('Lab demand is weak — expect vacancies.');
  } else if (prog === 'plaza') {
    o.cityCost = site.acq + A * 550 + (t.kiosk ? 400000 : 0);
    o.storefronts = t.kiosk ? 1 : 0;
    o.localShops = o.storefronts;
    o.months = 10;
    o.newValue = 0;
  }
  // street life gained vs lost (rough frontage math, same weights as the vibrancy model)
  const sigShare = prog === 'infill' ? 0.5 : prog === 'plaza' ? 1 : 0.3;
  o.vibGain = o.localShops * (1 + 0.6 * sigShare) + o.chainShops * 0.45 + (prog === 'plaza' ? 3 : 0) + (prog === 'mega' && t.plaza ? 1.2 : 0) - (o.spaces ? Math.min(2, o.spaces / 300) : 0);
  o.vibLost = site.indie * 1.0 + site.sig * 0.6 - site.auto * 1.1;
  o.taxNow = site.tax;
  const r = sim.rates();
  o.taxNew = (o.newValue * (prog === 'housing' || (prog === 'infill' && t.upper === 'homes') ? (r.rateR + r.rateC) / 2 : prog === 'plaza' ? 0 : r.rateC)) / 1000;
  o.months = Math.max(6, Math.round(o.months * techBuildTimeF(sim)));
  return o;
}

export function devMood(f) {
  if (f == null) return null;
  if (f > 0.12) return ['Eager', '#145a14'];
  if (f > 0.03) return ['Interested', '#3a7a1a'];
  if (f > -0.02) return ['Grumbling', '#a06a00'];
  return ['Walks away', '#b00'];
}

// ---------- hearing ----------
export function hearingScore(sim, site, prog, t, o, reasons = null) {
  let s = 0.55;
  const add = (label, v) => {
    s += v;
    if (reasons && Math.abs(v) >= 0.015) reasons.push([label, v]);
  };
  const floors = t.floors || 1;
  const nb = Math.min(1, site.nearHomes / 12);
  add(`${floors} stories next to ${site.nearHomes} single- and two-family homes`, -0.035 * Math.max(0, floors - 4) * nb);
  add(`${site.residents} residents displaced`, -Math.min(0.2, 0.012 * site.residents));
  add(`${site.indie} independent business${site.indie === 1 ? '' : 'es'} displaced`, -0.03 * site.indie);
  add('Displaces a beloved long-time business', -0.05 * site.legacy);
  // replacing car lots with something people can walk to is popular (except on Pleasant St)
  add(prog === 'infill' || prog === 'plaza' ? `Replaces ${site.auto} auto-oriented lot${site.auto === 1 ? '' : 's'}` : 'Auto shop owners object', prog === 'infill' || prog === 'plaza' ? 0.03 * site.auto : -0.01 * site.auto);
  if (o.affordable) add(`${o.affordable} affordable homes`, Math.min(0.3, (1.1 * o.affordable) / Math.max(1, o.homes)) * (t.nonprofit ? 0.8 : 1));
  if (prog === 'mega') {
    add('Storefronts reserved for local businesses', 0.25 * (t.local / 100));
    add('Public plaza', t.plaza ? 0.08 : 0);
    add('Transit & streetscape money', 0.02 * t.transit);
    add('Garage traffic', -0.12 * Math.max(0, t.parking - 0.7) * Math.min(1, o.homes / 200));
  }
  if (prog === 'lab') {
    add('Transit & streetscape money', 0.02 * t.transit);
    add('Labs next to homes', -0.1 * nb);
  }
  if (prog === 'infill' || prog === 'plaza') add('City-led, public process', 0.1);
  if (o.homes > 150) add(`Scale: ${o.homes} new homes`, -0.05);
  add(`Your approval (${Math.round(sim.approval)}%)`, 0.006 * (sim.approval - 50));
  return clamp(s, 0, 1);
}
export const hearingOdds = (score) => 1 / (1 + Math.exp(-(score - 0.47) * 9));

// ---------- lifecycle ----------
export function submit(sim, siteIds, prog, t, name) {
  const site = analyze(sim, siteIds, new Set(t.exclude || []));
  if (!site.ids.length) return { error: 'Pick at least one parcel for the site.' };
  if (pauseActive(sim) && prog !== 'plaza') return { error: `Development pause in effect for ${sim.mel.pauseUntil - sim.t} more month${sim.mel.pauseUntil - sim.t === 1 ? '' : 's'} (Melora's petition). Only parks and plazas can be filed.` };
  const o = evaluate(sim, site, prog, t);
  if (o.devFeas != null && !(o.devFeas >= -0.02) && !(prog === 'housing' && t.nonprofit)) return { error: 'The developer walked away: the numbers do not work. Allow more floors or ask for less.' };
  if (o.cityCost > 0 && sim.funds - o.cityCost < -0.15 * sim.budgetLines().expenses) return { error: `The City can't cover ${fmtMoney(o.cityCost)} right now, even with borrowing.` };
  sim.projects = sim.projects || [];
  const p = { id: (sim.projId = (sim.projId || 0) + 1), name, prog, t, ids: site.ids, stage: 'hearing', at: sim.t + 2, cx: site.cx, cy: site.cy, o, site: { homes: site.homes, indie: site.indie, auto: site.auto, sig: site.sig, residents: site.residents, nearHomes: site.nearHomes, legacy: site.legacy, value: site.value, acq: site.acq } };
  for (const li of site.ids) sim.w.lots[li].project = p.id;
  sim.projects.push(p);
  meloraOnSubmit(sim, p);
  const item = sim.news(`${name} goes to a public hearing`, `${PROGRAMS[prog].label}: ${o.homes ? o.homes + ' homes, ' : ''}${o.storefronts ? o.storefronts + ' storefronts, ' : ''}${o.jobs ? o.jobs + ' jobs, ' : ''}on ${site.ids.length} parcels. The Planning Board hears it in two months.`, 'big');
  react(sim, 'project-proposed', { name, street: streetName(sim, site), floors: t.floors || '' }, item, 3);
  return { project: p };
}

function streetName(sim, site) {
  const lot = sim.w.lots[site.ids ? site.ids[0] : site];
  return lot && lot.addr ? lot.addr.replace(/^[0-9\-A-Za-z]*[0-9][0-9\-A-Za-z]*\s+/, '').replace(/\s+[0-9][0-9A-Za-z\-]*$/, '') : 'the site';
}

export function projectsMonthly(sim) {
  for (const p of sim.projects || []) {
    if (p.stage === 'hearing' && sim.t >= p.at) hearing(sim, p);
    else if (p.stage === 'build') {
      if (p.prog === 'infill') buildInfillStep(sim, p);
      if (sim.t >= p.at) complete(sim, p);
    }
  }
}

function hearing(sim, p) {
  if (meloraAtHearing(sim, p)) return; // continued, or the developer walked
  const site = { ...p.site, ids: p.ids, cx: p.cx, cy: p.cy };
  const score = hearingScore(sim, site, p.prog, p.t, p.o) - (p.melPenalty || 0);
  const pr = hearingOdds(score);
  const roll = sim.rand();
  p.score = score;
  if (roll < pr) {
    startBuild(sim, p, false);
  } else if (roll < pr + 0.18 && p.t.floors > 3 && !p.continued) {
    p.t.floors -= 1;
    p.o = evaluate(sim, { ...analyze(sim, p.ids), cx: p.cx, cy: p.cy }, p.prog, p.t);
    if (p.o.devFeas != null && !(p.o.devFeas >= -0.02) && !(p.prog === 'housing' && p.t.nonprofit)) {
      p.stage = 'denied';
      for (const li of p.ids) sim.w.lots[li].project = null;
      const item = sim.news(`Developer pulls out of ${p.name}`, 'The Board approved it one story shorter, and the developer says the numbers no longer work.', 'big');
      react(sim, 'project-denied', { name: p.name }, item, 2);
      return;
    }
    startBuild(sim, p, true);
  } else if (!p.continued && roll < pr + 0.35) {
    p.continued = 1;
    p.at = sim.t + 3;
    p.melPenalty = 0;
    const item = sim.news(`Hearing on ${p.name} continued`, 'After four hours of public comment the Board asked for "more information" and adjourned at 11:40 p.m.');
    react(sim, 'project-continued', { name: p.name }, item, 2);
  } else {
    p.stage = 'denied';
    for (const li of p.ids) sim.w.lots[li].project = null;
    meloraAfterVote(sim, p, false);
    const item = sim.news(`${p.name} denied`, `The Board voted it down. ${p.prog === 'mega' || p.prog === 'lab' ? 'The developer says it will "explore other communities."' : 'Back to the drawing board.'}`, 'big');
    react(sim, 'project-denied', { name: p.name }, item, 2);
  }
}

function startBuild(sim, p, conditions) {
  const w = sim.w;
  meloraAfterVote(sim, p, true);
  p.stage = 'build';
  p.start = sim.t;
  p.at = sim.t + p.o.months;
  if (p.o.cityCost > 0) {
    if (sim.funds >= p.o.cityCost) sim.funds -= p.o.cityCost;
    else sim.apply({ bond: { amount: p.o.cityCost, label: `${p.name} (#${p.id})`, years: 20 } });
  }
  sim.apply({ flag: {} });
  // acquisition & demolition (Main Street infill demolishes as each parcel is rebuilt)
  const touched = [];
  for (const li of p.ids) {
    const lot = w.lots[li];
    lot.under = p.id;
    lot.locked = 1;
    if (p.prog !== 'infill') {
      for (const id of lot.bldgs) touched.push(...demolish(w, w.bldgs[id]));
      lot.bldgs = [];
      clearLot(lot);
    }
    touched.push(...lot.tiles);
  }
  sim.capNear({ at: [p.cx, p.cy], r: 10, amt: -0.1 });
  sim.hooks.invalidateTiles && sim.hooks.invalidateTiles(touched);
  sim.recalc();
  const item = sim.news(
    `${p.name} approved${conditions ? ' — one story shorter' : ''}`,
    `${conditions ? 'The Board approved it with conditions. ' : ''}Construction starts now and should take about ${Math.round(p.o.months / 12 * 10) / 10} years. ${p.site.auto ? `${p.site.auto} auto-oriented business${p.site.auto > 1 ? 'es' : ''} will relocate or close. ` : ''}${p.site.indie ? `${p.site.indie} independent business${p.site.indie > 1 ? 'es' : ''} on the site must find new homes.` : ''}`,
    'big'
  );
  react(sim, 'project-approved', { name: p.name, street: streetName(sim, p) }, item, 2);
  if (p.site.auto) react(sim, 'auto-closed', { name: 'the shop on ' + streetName(sim, p) }, item, 1);
}

function clearLot(lot) {
  lot.baseBldg = 0;
  lot.bldgVal = 0;
  lot.otherVal = 0;
  lot.units = 0;
  lot.jobs = 0;
  if (lot.sf) lot.sf = [];
  lot.vacant = 0;
  lot.storefronts = 0;
  lot.biz = [];
  lot.bizKind = [];
  lot.bizCat = [];
  lot.bizChainF = [];
  lot.bizSig = [];
  lot.auto = false;
}

const LOCAL_NAMES = ['Arax Corner Café', 'Bound & Found Books', 'Mill Street Records', 'Galen Gallery', 'Pequossette Provisions', 'The Herring Run Bakery', 'Second Story Vintage', 'Fifth Corner Coffee', 'Square Cheese Shop', 'Little Gore Tea', 'Riverbend Florist', 'Saltonstall Bike Works', 'Coolidge Kitchen', 'Delta Dumplings', 'Orchard Ice Cream'];
const LOCAL_KINDS = ['cafe', 'books', 'music', 'art_gallery', 'deli', 'bakery', 'second_hand', 'cafe', 'cheese', 'tea', 'florist', 'bicycle', 'restaurant', 'restaurant', 'ice_cream'];
const CHAIN_NAMES = [['Granite Federal Bank', 'bank'], ['MetroCell Wireless', 'mobile_phone'], ['Beanstream Coffee', 'cafe'], ['Burrito Depot', 'fast_food'], ['FitBox', 'fitness'], ['Sprout Salads', 'fast_food'], ['SmileBright Dental', 'dentist'], ['QuickMart', 'convenience']];

export function addShops(sim, lot, local, chains, deed) {
  lot.storefronts = local + chains;
  lot.sf = [];
  lot.vacant = 0;
  for (let k = 0; k < local; k++) {
    const j = Math.floor(sim.rand() * LOCAL_NAMES.length);
    const sig = /cafe|books|music|art|bakery|second|cheese|tea|florist|bicycle|ice/.test(LOCAL_KINDS[j]);
    openShop(sim, lot, { n: LOCAL_NAMES[j], k: LOCAL_KINDS[j], cat: /restaurant|cafe|deli|bakery|cheese|tea|ice/.test(LOCAL_KINDS[j]) ? 'food' : 'retail', chain: false, sig, orig: 0, lease: 120, rent: 1, cushion: 0.2, since: sim.t });
  }
  for (let k = 0; k < chains; k++) {
    const [n, kd] = CHAIN_NAMES[Math.floor(sim.rand() * CHAIN_NAMES.length)];
    openShop(sim, lot, { n, k: kd, cat: kd === 'bank' || kd === 'dentist' ? 'service' : kd === 'fast_food' || kd === 'cafe' ? 'food' : 'retail', chain: true, sig: false, orig: 0, lease: 120, rent: 1.3, cushion: 0.3, since: sim.t });
  }
  lot.vacant = 0;
  lot.ask = deed ? 1 : Math.max(lot.ask || 1, 1.25);
  if (deed) {
    lot.rentCap = 1.08;
    lot.rentCapUntil = sim.t + 180;
  }
  lot.ff0 = null;
}

function buildInfillStep(sim, p) {
  // rebuild parcels one at a time across the construction period
  const w = sim.w;
  const n = p.ids.length;
  const due = Math.min(n, Math.floor(((sim.t - p.start) / p.o.months) * n));
  p.done = p.done || 0;
  while (p.done < due) {
    const lot = w.lots[p.ids[p.done]];
    rebuildInfillLot(sim, p, lot);
    p.done++;
  }
}

function rebuildInfillLot(sim, p, lot) {
  const w = sim.w;
  const touched = [];
  for (const id of lot.bldgs) touched.push(...demolish(w, w.bldgs[id]));
  lot.bldgs = [];
  clearLot(lot);
  lot.zone = ZONE.C;
  lot.mixed = p.t.upper === 'homes';
  lot.dense = true;
  touched.push(...developLot(w, lot, 3, sim.t + lot.id));
  for (const id of lot.bldgs) {
    const b = w.bldgs[id];
    b.kind = 'shop';
    b.levels = p.t.floors;
    b.lvSrc = 'assessor';
    b.arch = sim.rand() < 0.6 ? 'brick' : 'modern';
    b.proc = 1;
    restyle(b);
    if (b.arch === 'modern') eraStyle(w, b);
  }
  const fa = lot.area * 0.6 * p.t.floors;
  const gf = lot.area * 0.6;
  lot.units = lot.mixed ? Math.max(1, Math.round(((fa - gf) * 0.82) / 85)) : 0;
  lot.jobs = Math.round(gf / 40) + (p.t.upper === 'offices' ? Math.round((fa - gf) / 25) : 0);
  lot.bldArea = fa;
  setBldgValue(sim, lot, fa * 3000);
  lot.occ = 0.9;
  lot.under = null;
  lot.year = sim.y;
  lot.built = sim.t;
  lot.useDesc = 'Mixed use: storefronts with ' + (lot.mixed ? 'apartments' : 'offices') + ' above';
  let fr = 0;
  for (const i of lot.tiles) if (w.road[i - 1] || w.road[i + 1] || w.road[i - w.W] || w.road[i + w.W]) fr++;
  const shops = Math.max(1, Math.min(8, Math.round(fr * 1.1)));
  addShops(sim, lot, shops, 0, p.t.deedRent);
  sim.newGrowth += (lot.bldgVal * sim.rates().rateC) / 1000;
  sim.hooks.invalidateTiles && sim.hooks.invalidateTiles(touched.concat(lot.tiles));
}

function restyle(b) {
  // recolor procedurally built buildings with the facade palette
  const cols = b.arch === 'brick' ? ['#a4523c', '#9a4a36', '#b0603f', '#8c4a3a'] : ['#3a3d42', '#6d7680', '#e9e7e2', '#8a5a44'];
  b.col = cols[Math.floor(hash2(b.id, 3, 3) * cols.length)];
  b.col2 = b.arch === 'modern' ? '#d9d4ca' : null;
  b.trim = '#efe9dc';
  b.roofCol = '#77746e';
  b.awning = ['#c0392b', '#2e7d32', '#1f5fa8', '#d68910', '#7b3f99'][Math.floor(hash2(b.id, 5, 5) * 5)];
  b.roof = 'flat';
  b.h = b.levels * 3.3;
  b._rgb = null;
}

function complete(sim, p) {
  const w = sim.w;
  const o = p.o;
  const touched = [];
  if (p.prog === 'infill') {
    while ((p.done || 0) < p.ids.length) {
      rebuildInfillLot(sim, p, w.lots[p.ids[p.done]]);
      p.done = (p.done || 0) + 1;
    }
  } else {
    // merge the site into one lot
    // the first parcel that still exists becomes the merged site
    const alive = p.ids.filter((li) => w.lots[li] && !w.lots[li].dead);
    if (!alive.length) {
      p.stage = 'done';
      p.doneAt = sim.t;
      return;
    }
    const main = w.lots[alive[0]];
    for (const li of alive.slice(1)) {
      const lot = w.lots[li];
      for (const i of lot.tiles) {
        w.lotOf[i] = main.id;
        main.tiles.push(i);
      }
      main.area += lot.area;
      main.landVal += lot.landVal;
      main.baseLand += lot.baseLand;
      lot.tiles = [];
      lot.dead = 1;
      lot.under = null;
    }
    let cx = 0, cy = 0;
    for (const i of main.tiles) { cx += (i % w.W) + 0.5; cy += ((i / w.W) | 0) + 0.5; }
    main.cx = cx / main.tiles.length;
    main.cy = cy / main.tiles.length;
    main.under = null;
    main.locked = 1;
    main.year = sim.y;
    main.built = sim.t;
    main.occ = 0.85;
    if (p.prog === 'plaza') {
      for (const i of main.tiles) {
        w.cover[i] = COVER.PARK;
        if (hash2(i, 31, 3) < 0.35) w.tree[i] = 1;
      }
      main.zone = ZONE.PARK;
      main.useDesc = 'Public plaza';
      if (p.t.kiosk) {
        main.zone = ZONE.C;
        addShops(sim, main, 1, 0, true);
        main.useDesc = 'Public plaza with café kiosk';
      }
      sim.lvNear({ at: [main.cx, main.cy], r: 22, amt: 0.08 });
    } else {
      const zone = p.prog === 'lab' ? ZONE.I : p.prog === 'housing' ? ZONE.R : ZONE.C;
      main.zone = zone;
      main.dense = true;
      main.mixed = p.prog === 'mega';
      touched.push(...developLot(w, main, 4, sim.t + main.id));
      for (const id of main.bldgs) {
        const b = w.bldgs[id];
        b.levels = p.t.floors;
        b.lvSrc = 'assessor';
        b.kind = p.prog === 'lab' ? 'lab' : p.prog === 'housing' ? 'apt' : 'shop';
        b.arch = p.prog === 'lab' ? 'lab' : 'modern';
        b.proc = 1;
        if (p.prog === 'lab') { b.col = '#dfe3e4'; b.col2 = '#6f8aa3'; b.roofCol = '#cfd3d6'; b.h = b.levels * 3.3; b._rgb = null; b.roof = 'flat'; b.awning = null; }
        else restyle(b);
        if (p.prog !== 'lab') eraStyle(w, b);
        if (p.prog === 'housing') b.awning = null;
      }
      main.units = o.homes;
      main.jobs = o.jobs;
      main.bldArea = o.floorArea;
      main.bldgVal = o.newValue;
      main.baseBldg = o.newValue / bldgF(sim);
      main.tripF = p.t.parking != null ? 0.55 + 0.45 * p.t.parking : 1;
      main.useDesc = PROGRAMS[p.prog].label + (o.affordable ? ` (${o.affordable} affordable homes)` : '');
      main.affordable = o.affordable;
      if (o.storefronts) addShops(sim, main, o.localShops, o.chainShops, p.prog === 'mega' && p.t.local >= 50);
      if (p.prog === 'mega') sim.megaprojects = (sim.megaprojects || 0) + 1;
      if (p.prog === 'lab') sim.flags.labs = (sim.flags.labs || 0) + 1;
      sim.newGrowth += (o.newValue * (zone === ZONE.R ? sim.rates().rateR : sim.rates().rateC)) / 1000;
    }
    touched.push(...main.tiles);
  }
  p.stage = 'done';
  p.doneAt = sim.t;
  if (sim.flow && sim.reassign) sim.reassign();
  sim.capNear({ at: [p.cx, p.cy], r: 10, amt: 0.11 });
  for (const li of p.ids) {
    const lot = w.lots[li];
    lot.project = null;
    lot.under = null;
  }
  // politics of the finished thing
  const ap = {};
  if (o.affordable) ap.renters = Math.min(6, o.affordable / 15);
  if (p.prog === 'plaza') ap.all = 2;
  if (p.prog === 'infill') { ap.renters = (ap.renters || 0) + 2; ap.homeowners = 1; ap.business = 2; }
  if (p.prog !== 'lab') sim.autoConverted = (sim.autoConverted || 0) + (p.site.auto || 0);
  if (p.prog === 'mega') { ap.business = 3; ap.commuters = -2; }
  sim.apply({ approval: ap });
  sim.hooks.invalidateTiles && sim.hooks.invalidateTiles(touched);
  sim.walkDirty = true;
  sim.parkPts = null;
  sim.recalc();
  sim.computeAll();
  sim.moment && sim.moment(p.prog === 'lab' ? 'lab' : p.prog === 'plaza' ? 'plaza' : 'ribbon', p.cx, p.cy, p.name);
  const item = sim.news(`Ribbon cut at ${p.name}`, ribbonText(p), 'big');
  react(sim, `project-open-${p.prog}`, { name: p.name, street: streetName(sim, p) }, item, 3);
}

function ribbonText(p) {
  const o = p.o;
  const bits = [];
  if (o.homes) bits.push(`${o.homes} homes${o.affordable ? ` (${o.affordable} affordable)` : ''}`);
  if (o.storefronts) bits.push(`${o.storefronts} storefront${o.storefronts > 1 ? 's' : ''}${o.localShops && o.chainShops ? ` (${o.localShops} local)` : o.chainShops ? ' leased to national chains' : ' for local businesses'}`);
  if (o.jobs) bits.push(`about ${o.jobs} jobs`);
  return `${bits.join(', ')}. A councilor cut the ribbon with oversized scissors.`;
}

export const projectName = (sim, prog, site) => {
  const st = streetName(sim, site).replace(/\s+(St|Street|Ave|Av|Avenue|Rd|Road)$/i, '');
  const pick = (a) => a[Math.floor(sim.rand() * a.length)];
  if (prog === 'mega') return pick([`${st} Yards`, `The Residences at ${st}`, `${st} Commons`, `${st} Crossing`]);
  if (prog === 'infill') return `${st} Main Street`;
  if (prog === 'housing') return pick([`${st} Apartments`, `The ${st}`, `${st} Homes`]);
  if (prog === 'lab') return pick([`${st} Innovation Center`, `${st} Life Science Campus`, `One ${st}`]);
  return pick([`${st} Plaza`, `${st} Green`, `${st} Commons Park`]);
};
