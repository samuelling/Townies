// The future: technologies arrive on a plausible timeline, spread along S-curves, and reshape the
// town. The City can't stop most of them, but it chooses how to meet each one (embrace, let it
// happen, or restrict), which changes how fast it spreads and who wins.
// Adoption shares are rough illustrations for a Boston inner-ring suburb, not forecasts.
import { ZONE } from './config.js';
import { hash2, clamp } from './util.js';
import { classifyLot } from './vibrancy.js';
import { react } from './comments.js';
import { addShops } from './projects.js';
import { A as assumeA } from './assumptions.js';
import { streetOf } from './sim.js';

// hist: known adoption by year (followed exactly until its last year) · cap: where it levels off ·
// rate: monthly S-curve growth after that, at "let it happen". Techs without hist arrive in `arrive`.
export const TECH = {
  ecommerce: {
    name: 'Online shopping', icon: '📦', hist: [[1999, 0.005], [2005, 0.025], [2010, 0.05], [2015, 0.08], [2019, 0.12], [2020, 0.2], [2026, 0.22]], cap: 0.3, rate: 0.01, unit: 'of retail spending',
    what: 'People buy more and more of their everyday goods online.',
    changes: ['Ordinary shops lose sales', 'Restaurants, cafés and services hold up, because you can’t download a haircut'],
    stances: null,
  },
  smartphone: {
    name: 'Smartphones', icon: '📱', hist: [[2007, 0.02], [2010, 0.3], [2014, 0.65], [2019, 0.85], [2026, 0.92]], cap: 0.95, rate: 0.02, unit: 'of adults',
    what: 'Everyone carries a map, reviews and photos of every café in their pocket.',
    changes: ['Distinctive independents get discovered: signature shops gain customers'],
    stances: null,
  },
  ridehail: {
    name: 'Ride-hailing', icon: '🚕', hist: [[2012, 0.002], [2015, 0.03], [2019, 0.07], [2020, 0.03], [2023, 0.06], [2026, 0.07]], cap: 0.09, rate: 0.01, unit: 'of car trips',
    what: 'Tap a phone and a car comes. Fewer people need to park, but there are more cars circling.',
    changes: ['A little more traffic around the Square', 'A little less need for parking'],
    stances: {
      embrace: { label: 'Pickup zones + per-ride fee', fx: 'earns fees · Commuters ↑', revenue: 35000, approval: { commuters: 1 } },
      neutral: { label: 'Let the state regulate it', fx: 'free' },
    },
  },
  ebike: {
    name: 'E-bikes & scooters', icon: '🛴', hist: [[2017, 0.005], [2022, 0.03], [2026, 0.05]], cap: 0.35, rate: 0.03, unit: 'of short trips',
    what: 'Cheap electric bikes and scooters make a two-mile trip as easy as a short walk.',
    changes: ['Fewer car trips and less traffic', 'Shops get customers from farther away', 'Green bike lanes on the main streets if you build them'],
    stances: {
      embrace: { label: 'Protected bike lanes', fx: '$45K/mo · faster uptake · Renters ↑ · Commuters ↓', monthly: 45000, rateF: 2, approval: { renters: 2, commuters: -2 } },
      neutral: { label: 'Paint and hope', fx: 'free · slow uptake' },
      restrict: { label: 'Ban scooters on sidewalks and paths', fx: 'free · uptake stalls · Seniors ↑', rateF: 0.35, approval: { seniors: 2, renters: -1 } },
    },
  },
  ev: {
    name: 'Electric cars', icon: '🔌', hist: [[2011, 0.001], [2018, 0.01], [2022, 0.025], [2026, 0.05]], cap: 0.95, rate: 0.028, unit: 'of cars',
    what: 'Electric cars need no gas and far less servicing: no oil changes, no mufflers, no tune-ups.',
    changes: ['Gas stations and repair shops lose their business and close', 'Some gas stations become charging hubs', 'Cleaner air along busy streets', 'Empty auto lots become redevelopment sites: what replaces them is up to you, or the market'],
    stances: {
      embrace: { label: 'Curbside chargers everywhere', fx: '$60K/mo · faster switch · Renters ↑', monthly: 60000, rateF: 1.6, approval: { renters: 2, homeowners: 1 } },
      neutral: { label: 'Leave it to the market', fx: 'free' },
      restrict: { label: 'Protect the auto businesses', fx: '$25K/mo in grants · slower switch · Business ↑', monthly: 25000, rateF: 0.55, approval: { business: 2, renters: -1 } },
    },
  },
  solar: {
    name: 'Rooftop solar & heat pumps', icon: '☀️', hist: [[2008, 0.003], [2014, 0.015], [2020, 0.04], [2026, 0.06]], cap: 0.6, rate: 0.022, unit: 'of roofs',
    what: 'Solar panels, batteries and heat pumps move onto ordinary houses.',
    changes: ['Panels spread across the roofs of Watertown', 'Lower energy bills for owners'],
    stances: {
      embrace: { label: 'Solar-ready permits + municipal solar', fx: '$30K/mo · faster · Homeowners ↑', monthly: 30000, rateF: 1.8, approval: { homeowners: 2 } },
      neutral: { label: 'Standard permits', fx: 'free' },
      restrict: { label: 'Historic-district panel rules', fx: 'free · slower · Seniors ↑', rateF: 0.4, approval: { seniors: 1, homeowners: -1 } },
    },
  },
  remote: {
    name: 'Hybrid work', icon: '💻', hist: [[1999, 0.03], [2019, 0.06], [2020, 0.45], [2022, 0.33], [2026, 0.3]], cap: 0.45, rate: 0.02, unit: 'of workdays at home',
    what: 'Office workers keep spending part of the week at home.',
    changes: ['Less demand for offices', 'Daytime foot traffic moves from office parks into neighborhoods', 'Neighborhood cafés gain; office-district lunch spots lose'],
    stances: null,
  },
  timber: {
    name: 'Mass timber & modular building', icon: '🪵', arrive: 2029, cap: 1, rate: 0.05, unit: 'of new buildings',
    what: 'Factory-built wood structures go up faster and cheaper than steel and concrete.',
    changes: ['Construction costs fall by up to 18%', 'Projects finish sooner', 'New buildings look warmer: wood, terraces, planted roofs'],
    stances: {
      embrace: { label: 'Update the building code early', fx: '$15K/mo · faster · Homeowners ↓ ("wooden towers?")', monthly: 15000, rateF: 1.8, approval: { homeowners: -1, renters: 1 } },
      neutral: { label: 'Follow the state code', fx: 'free' },
    },
  },
  delivery: {
    name: 'Drone & robot delivery', icon: '🛸', arrive: 2031, cap: 0.6, rate: 0.04, unit: 'of deliveries',
    what: 'Drones and sidewalk robots bring packages and takeout in minutes.',
    changes: ['Ordinary shops lose sales; cafés, galleries and bookstores hold up, because people still go out for experiences', 'Fewer delivery vans', 'Drones buzzing overhead'],
    stances: {
      embrace: { label: 'Open drone corridors', fx: 'free · faster · Renters ↑ · Business ↓', rateF: 1.6, approval: { renters: 2, business: -1 } },
      neutral: { label: 'Permit case by case', fx: 'free' },
      restrict: { label: 'No sidewalk robots, drone curfew', fx: '$10K/mo enforcement · slower · Seniors ↑ · Homeowners ↑', monthly: 10000, rateF: 0.4, approval: { seniors: 2, homeowners: 1, renters: -1 } },
    },
  },
  robotaxi: {
    name: 'Robotaxis', icon: '🚘', arrive: 2033, cap: 0.6, rate: 0.045, unit: 'of car trips',
    what: 'Driverless cars you summon instead of own. They never need to park near your destination.',
    changes: ['Parking lots become surplus land and fill in with buildings', 'Empty cars cruising for the next fare add traffic unless the curb is priced', 'Pods replace cars on the streets'],
    stances: {
      embrace: { label: 'Allow, with curb & congestion pricing', fx: 'earns fees · traffic ↓ · Commuters ↓', revenue: 220000, rateF: 1.4, approval: { commuters: -2, renters: 1 } },
      neutral: { label: 'Allow, no rules', fx: 'free · traffic ↑ from empty cruising' },
      restrict: { label: 'Ban robotaxis', fx: 'free · slower · Business ↓ · Commuters ↓', rateF: 0.3, approval: { business: -2, commuters: -2, seniors: 1 } },
    },
  },
  green: {
    name: 'Green roofs & cool streets', icon: '🌿', arrive: 2036, cap: 0.5, rate: 0.04, unit: 'of flat roofs',
    what: 'Hotter summers make planted roofs, shade trees and permeable streets standard.',
    changes: ['Flat roofs turn green', 'Cooler, more pleasant blocks raise land values a little'],
    stances: {
      embrace: { label: 'Require them on new buildings', fx: '$20K/mo · faster · Business ↓', monthly: 20000, rateF: 1.8, approval: { business: -1, renters: 1 } },
      neutral: { label: 'Voluntary incentives', fx: 'free' },
    },
  },
  airtaxi: {
    name: 'Air taxis', icon: '🚁', arrive: 2041, cap: 0.3, rate: 0.05, unit: 'of trips to Logan & downtown',
    what: 'Quiet-ish electric aircraft hop from rooftop pads to Logan and the Seaport in minutes.',
    changes: ['Business travelers love it', 'Neighbors hear it', 'Aircraft in the sky over the Square'],
    stances: {
      embrace: { label: 'Vertiport on Arsenal Yards', fx: 'business ↑ · noise · Homeowners ↓', rateF: 1.5, approval: { business: 3, homeowners: -2 } },
      neutral: { label: 'Let the FAA decide', fx: 'free' },
      restrict: { label: 'No landing pads in town', fx: 'free · quieter · Business ↓', rateF: 0.2, approval: { business: -2, homeowners: 2 } },
    },
  },
};
export const TECH_IDS = Object.keys(TECH);
for (const d of Object.values(TECH)) if (d.hist) d.arrive = d.hist[0][0];

// adoption at a (fractional) year from the known history
function histAt(d, yf) {
  const h = d.hist;
  if (yf < h[0][0]) return 0;
  for (let k = 1; k < h.length; k++) if (yf <= h[k][0]) return h[k - 1][1] + ((h[k][1] - h[k - 1][1]) * (yf - h[k - 1][0])) / (h[k][0] - h[k - 1][0]);
  return h[h.length - 1][1];
}
const yearF = (sim) => sim.y + sim.m / 12;

// Things that happened (they only play out if your game starts before them)
const HISTORY = [
  { y: 2008, m: 8, run: (s) => { s.apply({ demand: { R: -0.35, C: -0.3, I: -0.3 }, approval: { all: -2 }, news: ['Wall Street meltdown hits Main Street', 'Lending freezes. Projects stall, shops cut hours, and the For Lease signs multiply.', 'big'] }); s.hype = 0; } },
  { y: 2014, m: 5, run: (s) => s.apply({ demand: { I: 0.5, R: 0.15 }, news: ['Kendall Square spills over the river', 'Life-science companies priced out of Cambridge are touring Watertown’s old industrial buildings.', 'big'] }) },
  { y: 2020, m: 2, run: (s) => { s.shock = { until: s.t + 10, f: 0.82 }; s.hype = 0; s.apply({ demand: { C: -0.35 }, approval: { business: -4 }, news: ['Pandemic closes the Square', 'Restaurants switch to takeout, offices empty out, and the sidewalks go quiet. Nobody knows for how long.', 'big'] }); s.apply({ funds: 9e6, news: ['Federal relief money arrives', 'Washington sends the town millions for recovery. Everyone has an idea for it.'] }); } },
  { y: 2023, m: 3, run: (s) => s.apply({ demand: { I: -0.6 }, news: ['The lab boom cools', 'Venture funding dries up. New lab buildings open with "Available" banners.', 'big'] }) },
];

export function initTech(sim) {
  sim.tech = { a: {}, base: {}, stance: {}, arrived: {}, decided: {}, closures: 0, conversions: 0, hubs: 0, bucket: {}, hist: 0 };
  fillTech(sim);
  updateEra(sim);
}
// also upgrades saves from before the history/base fields existed
function fillTech(sim) {
  const T = sim.tech;
  T.base = T.base || {};
  T.decided = T.decided || {};
  for (const id of TECH_IDS) {
    const d = TECH[id];
    if (T.a[id] == null) T.a[id] = d.hist ? histAt(d, yearF(sim)) : 0;
    if (T.base[id] == null) T.base[id] = T.a[id];
    if (!T.stance[id]) T.stance[id] = 'neutral';
    if (T.arrived[id] == null && d.arrive <= sim.y && sim.t === 0) T.arrived[id] = 0;
  }
  if (T.hist == null) T.hist = HISTORY.findIndex((h) => h.y * 12 + h.m >= sim.y * 12 + sim.m + 1);
  if (T.hist < 0) T.hist = HISTORY.length;
}

const A = (sim, id) => (sim.tech ? sim.tech.a[id] || 0 : 0);
// growth since the game began: everything in the game is calibrated to the starting city
export const techD = (sim, id) => (sim.tech ? Math.max(0, A(sim, id) - (sim.tech.base[id] || 0)) : 0);
export const techA = A;

// ---- effects the rest of the sim asks for ----
export function techTrafficF(sim) {
  if (!sim.tech) return 1;
  const rt = A(sim, 'robotaxi');
  const cruise = sim.tech.stance.robotaxi === 'embrace' ? -0.15 : 0.3;
  return (1 - 0.4 * techD(sim, 'ebike')) * (1 - 0.3 * techD(sim, 'remote')) * (1 + cruise * rt) * (1 - 0.08 * A(sim, 'delivery')) * (1 + 0.6 * techD(sim, 'ridehail'));
}
export const techPollF = (sim) => 1 - 0.75 * techD(sim, 'ev');
export function techFootfall(sim, pn, jn) {
  const r = techD(sim, 'remote');
  return (pn * (1 + 0.5 * r) + 0.6 * jn * (1 - 0.8 * r)) * (1 + 0.35 * techD(sim, 'ebike'));
}
// share of an ordinary (non-experiential) shop's sales lost to delivery
export function techRetailF(sim, s) {
  const shock = sim.shock && sim.t < sim.shock.until ? sim.shock.f : 1;
  if (s.sig) return shock * (1 + 0.15 * techD(sim, 'smartphone'));
  if (s.cat === 'food' || s.cat === 'service') return shock;
  return shock * (1 - 0.35 * A(sim, 'delivery') - 0.8 * techD(sim, 'ecommerce'));
}
export const techBuildCostF = (sim) => 1 - 0.18 * A(sim, 'timber');
export const techBuildTimeF = (sim) => 1 - 0.25 * A(sim, 'timber');
export function techDemand(sim) {
  const r = techD(sim, 'remote');
  return { R: 0.5 * r, C: -0.7 * r };
}
export function techApproval(sim) {
  const o = {};
  if (!sim.tech) return o;
  const add = (k, v) => (o[k] = (o[k] || 0) + v);
  for (const id of TECH_IDS) {
    const st = TECH[id].stances && TECH[id].stances[sim.tech.stance[id]];
    if (st && st.approval && sim.tech.arrived[id] != null) for (const [k, v] of Object.entries(st.approval)) add(k, v);
  }
  add('homeowners', 4 * techD(sim, 'solar'));
  const air = A(sim, 'airtaxi');
  if (sim.tech.stance.airtaxi !== 'restrict') add('homeowners', -8 * air);
  add('business', 6 * air);
  return o;
}

// ---- monthly ----
export function techMonthly(sim) {
  if (!sim.tech) initTech(sim);
  const T = sim.tech;
  if (!T.base) fillTech(sim);
  const events = [];
  while (T.hist < HISTORY.length && HISTORY[T.hist].y * 12 + HISTORY[T.hist].m <= sim.y * 12 + sim.m) HISTORY[T.hist++].run(sim);
  const yf = yearF(sim);
  for (const id of TECH_IDS) {
    const d = TECH[id];
    if (sim.y < d.arrive) continue;
    if (T.arrived[id] == null) {
      T.arrived[id] = sim.t;
      T.a[id] = Math.max(T.a[id], d.hist ? histAt(d, yf) : 0.02);
      const item = sim.news(`${d.icon} ${d.name} arrive${/s$/.test(d.name) ? '' : 's'} in Watertown`, d.what, 'big');
      react(sim, 'tech-arrive', { name: d.name.toLowerCase() }, item, 2);
    }
    const st = d.stances && d.stances[T.stance[id]];
    const a = T.a[id];
    if (d.hist && yf <= d.hist[d.hist.length - 1][0]) T.a[id] = histAt(d, yf); // the known past
    else {
      const r = d.rate * (st && st.rateF ? st.rateF : 1);
      T.a[id] = clamp(a + r * Math.max(a, 0.002) * (1 - a / d.cap), 0, d.cap);
    }
    // budget lines for the City's stance
    const key = 'tech:' + id;
    const pf = sim.priceF ? sim.priceF() : 1;
    if (st && st.monthly) sim.recurring[key] = { label: `${d.name}: ${st.label}`, monthly: st.monthly * pf };
    else if (st && st.revenue) sim.recurring[key] = { label: `${d.name}: curb fees`, monthly: (-st.revenue * pf * T.a[id]) / d.cap };
    else delete sim.recurring[key];
  }
  evShakeout(sim, events);
  parkingShakeout(sim, events);
  // landscape repaints when shares move enough to notice
  let repaint = false;
  for (const id of ['solar', 'green', 'ebike']) {
    const b = Math.floor(A(sim, id) * 20);
    if (T.bucket[id] !== b) { T.bucket[id] = b; repaint = true; }
  }
  const era = updateEra(sim);
  if (repaint && sim.hooks.invalidateAll) sim.hooks.invalidateAll();
  if (era && sim.hooks.invalidateAll) sim.hooks.invalidateAll();
  return events;
}

// what new buildings look like
function updateEra(sim) {
  const w = sim.w;
  const prev = w.era || null;
  const timber = A(sim, 'timber'), green = A(sim, 'green');
  w.era = sim.y >= 2044 || green > 0.25 ? 'future' : timber > 0.3 ? 'timber' : null;
  if (w.era !== prev && w.era && prev !== w.era) {
    if (w.era === 'timber') sim.news('New buildings are made of wood now', 'Mass-timber frames go up in weeks. The new look: warm wood, deep balconies, planted roofs.');
    if (w.era === 'future') sim.news('The look of the 2040s', 'Terraced glass and greenery: new buildings are designed for hotter summers and fewer cars.');
    return true;
  }
  return false;
}

// Electric cars hollow out the auto row. Repair shops and gas stations close; a few stations become
// charging hubs; after a while the market redevelops what's left empty.
const REPAIR = /^33[1-4]$/;
function evShakeout(sim, events) {
  const d = techD(sim, 'ev');
  if (d < 0.03) return;
  const T = sim.tech;
  for (const lot of sim.w.lots) {
    if (lot.dead || !lot.inTown || lot.project || lot.under || lot.locked) continue;
    if (lot.evClosed) {
      // sat empty a while: a developer buys it, unless it's in a project
      if (sim.t - lot.evClosed > 18 && sim.demand.R > -0.2 && sim.rand() < 0.02 + 0.03 * A(sim, 'robotaxi')) marketRedevelop(sim, lot, 'auto', events);
      continue;
    }
    if (lot.evHub || !(REPAIR.test(lot.code3 || '') || (lot.auto && lot.bldgs.length && lot.code3 !== '336' && lot.code3 !== '337'))) continue;
    if (sim.rand() > 0.0045 * d / 0.5) continue;
    const fuel = lot.code3 === '333' || lot.code3 === '334' || (lot.bizKind || []).some((k) => /fuel|gas/.test(k || ''));
    if (fuel && sim.rand() < 0.35 && T.hubs < 14) {
      lot.evHub = 1;
      T.hubs++;
      const item = sim.news(`Gas station${lot.addr ? ' at ' + lot.addr : ''} becomes a charging hub`, 'The pumps come out; sixteen fast chargers and a coffee counter go in.');
      react(sim, 'tech-hub', { street: streetOf(lot) || 'that corner' }, item, 1);
      sim.hooks.invalidateBuilding && lot.bldgs.forEach((id) => sim.hooks.invalidateBuilding(sim.w.bldgs[id]));
      continue;
    }
    const name = (lot.biz && lot.biz.find((n, k) => lot.bizCat && lot.bizCat[k] === 'auto')) || (fuel ? 'A gas station' : 'An auto repair shop');
    lot.evClosed = sim.t;
    lot.occ = 0.12;
    if (lot.biz) {
      const keep = lot.biz.map((n, k) => (lot.bizCat && lot.bizCat[k] === 'auto' ? -1 : k)).filter((k) => k >= 0);
      lot.biz = keep.map((k) => lot.biz[k]);
      if (lot.bizKind) lot.bizKind = keep.map((k) => lot.bizKind[k]);
      if (lot.bizChain) lot.bizChain = keep.map((k) => lot.bizChain[k]);
      classifyLot(lot);
    }
    T.closures++;
    sim.walkDirty = true;
    if (T.closures <= 3 || sim.rand() < 0.3) {
      const item = sim.news(`${name}${lot.addr ? ' on ' + streetOf(lot) : ''} closes`, fuel ? 'Half the cars that pass are electric now. The owner says the math stopped working.' : 'Electric cars barely need us, the owner says: no oil, no exhaust, no transmissions.');
      react(sim, 'tech-autoclose', { name, street: streetOf(lot) || 'that street' }, item, 2);
    }
    sim.hooks.invalidateBuilding && lot.bldgs.forEach((id) => sim.hooks.invalidateBuilding(sim.w.bldgs[id]));
  }
}

// Robotaxis don't park downtown: surface lots become surplus and get built on.
function parkingShakeout(sim, events) {
  const a = A(sim, 'robotaxi');
  if (a < 0.05) return;
  for (const lot of sim.w.lots) {
    if (lot.dead || !lot.inTown || lot.project || lot.under || lot.locked || lot.zone === ZONE.PARK) continue;
    const parking = lot.code3 === '337' || (lot.code3 === '336' && lot.bldgs.length === 0);
    if (!parking || lot.tiles.length < 3) continue;
    if (sim.rand() > 0.006 * a) continue;
    marketRedevelop(sim, lot, 'parking', events);
  }
}

// The market's default answer: apartments over national-chain ground floors (the Arsenal Yards path).
// Main Street infill projects are how a player can do better.
function marketRedevelop(sim, lot, why, events) {
  const w = sim.w;
  const was = lot.addr || streetOf(lot) || 'a lot downtown';
  lot.dense = true;
  lot.code3 = '';
  lot.useDesc = why === 'parking' ? 'Apartments (former parking lot)' : 'Apartments (former auto business)';
  lot.biz = [];
  lot.bizKind = [];
  lot.bizChain = [];
  lot.evClosed = null;
  lot.evHub = null;
  sim.develop(lot, lot.tiles.length >= 10 ? 4 : 3, ZONE.R);
  lot.zone = ZONE.C;
  lot.mixed = true;
  lot.bldgZone = ZONE.C;
  lot.locked = 1;
  lot.units = Math.max(lot.units || 0, Math.round(lot.tiles.length * 2.2));
  lot.auto = false;
  const n = Math.max(1, Math.min(4, Math.round(lot.tiles.length / 5)));
  const local = sim.policies && sim.policies.formulaRetail ? n : Math.round(n * assumeA(sim, 'marketChains'));
  addShops(sim, lot, local, n - local, false);
  classifyLot(lot);
  lot.auto = false;
  sim.tech.conversions++;
  sim.walkDirty = true;
  sim.recalc();
  const item = sim.news(
    why === 'parking' ? `Parking lot${was ? ' at ' + was : ''} becomes apartments` : `Old auto lot${was ? ' at ' + was : ''} becomes apartments`,
    why === 'parking' ? 'With robotaxis doing the driving, the owner says the lot was "a field of empty asphalt." Ground-floor tenants: mostly national chains.' : 'A developer bought the empty lot. Ground-floor tenants: mostly national chains, with rents to match.'
  );
  react(sim, why === 'parking' ? 'tech-parking' : 'tech-redev', { street: streetOf(lot) || 'that street' }, item, 2);
  events.push({ type: 'redev', lot });
}

export function setStance(sim, id, stance) {
  if (!sim.tech) initTech(sim);
  sim.tech.stance[id] = stance;
  sim.tech.decided[id] = 1;
  if (id === 'ebike' && sim.hooks.invalidateAll) sim.hooks.invalidateAll();
  sim.updateApproval();
}

// Agenda items: one decision per technology when it arrives (ones already here at the start are spread over the first year).
const FIRST_YEAR = { ebike: 8, ev: 4, solar: 11, ridehail: 14 };
export const TECH_SCENARIOS = TECH_IDS.filter((id) => TECH[id].stances).map((id) => {
  const d = TECH[id];
  return {
    id: 'tech-' + id,
    priority: true,
    when: (s) => s.tech && s.tech.arrived[id] != null && !s.tech.decided[id] && s.t >= (s.tech.arrived[id] === 0 && FIRST_YEAR[id] != null ? FIRST_YEAR[id] : s.tech.arrived[id]),
    title: `${d.icon} ${d.name}`,
    text: () => `${d.what} ${d.changes.join('. ')}. How should the City respond? (You can change this later under Windows → Technology.)`,
    choices: Object.entries(d.stances).map(([k, st]) => ({ label: st.label, fx: st.fx, run: (s) => setStance(s, id, k) })),
  };
});

export function techStatus(sim, id) {
  const d = TECH[id];
  const a = A(sim, id);
  if (sim.y < d.arrive) return { future: true, text: d.arrive - sim.y <= 3 ? `Expected around ${d.arrive}` : 'On the horizon' };
  return { a, text: `${Math.round(a * 100)}% ${d.unit}` };
}
