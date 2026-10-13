// The future: technologies arrive on a plausible timeline, spread along S-curves, and reshape the
// town. The City can't stop most of them, but it chooses how to meet each one (embrace, let it
// happen, or restrict), which changes how fast it spreads and who wins.
// Adoption shares are rough illustrations for a Boston inner-ring suburb, not forecasts.
import { ZONE } from './config.js';
import { hash2, clamp } from './util.js';
import { classifyLot } from './vibrancy.js';
import { react } from './comments.js';
import { addShops } from './projects.js';
import { streetOf } from './sim.js';

// a0: share in 2027 · cap: where it levels off · rate: monthly S-curve growth at "let it happen"
export const TECH = {
  ebike: {
    name: 'E-bikes & scooters', icon: '🛴', arrive: 2027, a0: 0.05, cap: 0.35, rate: 0.03, unit: 'of short trips',
    what: 'Cheap electric bikes and scooters make a two-mile trip as easy as a short walk.',
    changes: ['Fewer car trips and less traffic', 'Shops get customers from farther away', 'Green bike lanes on the main streets if you build them'],
    stances: {
      embrace: { label: 'Protected bike lanes', fx: '$45K/mo · faster uptake · Renters ↑ · Commuters ↓', monthly: 45000, rateF: 2, approval: { renters: 2, commuters: -2 } },
      neutral: { label: 'Paint and hope', fx: 'free · slow uptake' },
      restrict: { label: 'Ban scooters on sidewalks and paths', fx: 'free · uptake stalls · Seniors ↑', rateF: 0.35, approval: { seniors: 2, renters: -1 } },
    },
  },
  ev: {
    name: 'Electric cars', icon: '🔌', arrive: 2027, a0: 0.05, cap: 0.95, rate: 0.028, unit: 'of cars',
    what: 'Electric cars need no gas and far less servicing: no oil changes, no mufflers, no tune-ups.',
    changes: ['Gas stations and repair shops lose their business and close', 'Some gas stations become charging hubs', 'Cleaner air along busy streets', 'Empty auto lots become redevelopment sites: what replaces them is up to you, or the market'],
    stances: {
      embrace: { label: 'Curbside chargers everywhere', fx: '$60K/mo · faster switch · Renters ↑', monthly: 60000, rateF: 1.6, approval: { renters: 2, homeowners: 1 } },
      neutral: { label: 'Leave it to the market', fx: 'free' },
      restrict: { label: 'Protect the auto businesses', fx: '$25K/mo in grants · slower switch · Business ↑', monthly: 25000, rateF: 0.55, approval: { business: 2, renters: -1 } },
    },
  },
  solar: {
    name: 'Rooftop solar & heat pumps', icon: '☀️', arrive: 2027, a0: 0.06, cap: 0.6, rate: 0.022, unit: 'of roofs',
    what: 'Solar panels, batteries and heat pumps move onto ordinary houses.',
    changes: ['Panels spread across the roofs of Watertown', 'Lower energy bills for owners'],
    stances: {
      embrace: { label: 'Solar-ready permits + municipal solar', fx: '$30K/mo · faster · Homeowners ↑', monthly: 30000, rateF: 1.8, approval: { homeowners: 2 } },
      neutral: { label: 'Standard permits', fx: 'free' },
      restrict: { label: 'Historic-district panel rules', fx: 'free · slower · Seniors ↑', rateF: 0.4, approval: { seniors: 1, homeowners: -1 } },
    },
  },
  remote: {
    name: 'Hybrid work', icon: '💻', arrive: 2027, a0: 0.3, cap: 0.45, rate: 0.02, unit: 'of workdays at home',
    what: 'Office workers keep spending part of the week at home.',
    changes: ['Less demand for offices', 'Daytime foot traffic moves from office parks into neighborhoods', 'Neighborhood cafés gain; office-district lunch spots lose'],
    stances: null,
  },
  timber: {
    name: 'Mass timber & modular building', icon: '🪵', arrive: 2029, a0: 0, cap: 1, rate: 0.05, unit: 'of new buildings',
    what: 'Factory-built wood structures go up faster and cheaper than steel and concrete.',
    changes: ['Construction costs fall by up to 18%', 'Projects finish sooner', 'New buildings look warmer: wood, terraces, planted roofs'],
    stances: {
      embrace: { label: 'Update the building code early', fx: '$15K/mo · faster · Homeowners ↓ ("wooden towers?")', monthly: 15000, rateF: 1.8, approval: { homeowners: -1, renters: 1 } },
      neutral: { label: 'Follow the state code', fx: 'free' },
    },
  },
  delivery: {
    name: 'Drone & robot delivery', icon: '🛸', arrive: 2031, a0: 0, cap: 0.6, rate: 0.04, unit: 'of deliveries',
    what: 'Drones and sidewalk robots bring packages and takeout in minutes.',
    changes: ['Ordinary shops lose sales; cafés, galleries and bookstores hold up, because people still go out for experiences', 'Fewer delivery vans', 'Drones buzzing overhead'],
    stances: {
      embrace: { label: 'Open drone corridors', fx: 'free · faster · Renters ↑ · Business ↓', rateF: 1.6, approval: { renters: 2, business: -1 } },
      neutral: { label: 'Permit case by case', fx: 'free' },
      restrict: { label: 'No sidewalk robots, drone curfew', fx: '$10K/mo enforcement · slower · Seniors ↑ · Homeowners ↑', monthly: 10000, rateF: 0.4, approval: { seniors: 2, homeowners: 1, renters: -1 } },
    },
  },
  robotaxi: {
    name: 'Robotaxis', icon: '🚘', arrive: 2033, a0: 0, cap: 0.6, rate: 0.045, unit: 'of car trips',
    what: 'Driverless cars you summon instead of own. They never need to park near your destination.',
    changes: ['Parking lots become surplus land and fill in with buildings', 'Empty cars cruising for the next fare add traffic unless the curb is priced', 'Pods replace cars on the streets'],
    stances: {
      embrace: { label: 'Allow, with curb & congestion pricing', fx: 'earns fees · traffic ↓ · Commuters ↓', revenue: 220000, rateF: 1.4, approval: { commuters: -2, renters: 1 } },
      neutral: { label: 'Allow, no rules', fx: 'free · traffic ↑ from empty cruising' },
      restrict: { label: 'Ban robotaxis', fx: 'free · slower · Business ↓ · Commuters ↓', rateF: 0.3, approval: { business: -2, commuters: -2, seniors: 1 } },
    },
  },
  green: {
    name: 'Green roofs & cool streets', icon: '🌿', arrive: 2036, a0: 0, cap: 0.5, rate: 0.04, unit: 'of flat roofs',
    what: 'Hotter summers make planted roofs, shade trees and permeable streets standard.',
    changes: ['Flat roofs turn green', 'Cooler, more pleasant blocks raise land values a little'],
    stances: {
      embrace: { label: 'Require them on new buildings', fx: '$20K/mo · faster · Business ↓', monthly: 20000, rateF: 1.8, approval: { business: -1, renters: 1 } },
      neutral: { label: 'Voluntary incentives', fx: 'free' },
    },
  },
  airtaxi: {
    name: 'Air taxis', icon: '🚁', arrive: 2041, a0: 0, cap: 0.3, rate: 0.05, unit: 'of trips to Logan & downtown',
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

export function initTech(sim) {
  sim.tech = { a: {}, stance: {}, arrived: {}, closures: 0, conversions: 0, hubs: 0, bucket: {} };
  for (const id of TECH_IDS) {
    sim.tech.a[id] = TECH[id].arrive <= sim.y ? TECH[id].a0 : 0;
    sim.tech.stance[id] = 'neutral';
    if (TECH[id].arrive <= sim.y) sim.tech.arrived[id] = sim.t;
  }
  sim.tech.decided = { ebike: 0, ev: 0, solar: 0 }; // the 2027 techs get their agenda items over the first year
  updateEra(sim);
}

const A = (sim, id) => (sim.tech ? sim.tech.a[id] || 0 : 0);
// growth above the 2027 level: everything in the game is calibrated to 2027
export const techD = (sim, id) => Math.max(0, A(sim, id) - (TECH[id].arrive <= 2027 ? TECH[id].a0 : 0));
export const techA = A;

// ---- effects the rest of the sim asks for ----
export function techTrafficF(sim) {
  if (!sim.tech) return 1;
  const rt = A(sim, 'robotaxi');
  const cruise = sim.tech.stance.robotaxi === 'embrace' ? -0.15 : 0.3;
  return (1 - 0.4 * techD(sim, 'ebike')) * (1 - 0.3 * techD(sim, 'remote')) * (1 + cruise * rt) * (1 - 0.08 * A(sim, 'delivery'));
}
export const techPollF = (sim) => 1 - 0.75 * techD(sim, 'ev');
export function techFootfall(sim, pn, jn) {
  const r = techD(sim, 'remote');
  return (pn * (1 + 0.8 * r) + 0.6 * jn * (1 - 1.2 * r)) * (1 + 0.35 * techD(sim, 'ebike'));
}
// share of an ordinary (non-experiential) shop's sales lost to delivery
export const techRetailF = (sim, s) => (s.sig || s.cat === 'food' || s.cat === 'service' ? 1 : 1 - 0.35 * A(sim, 'delivery'));
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
  const events = [];
  for (const id of TECH_IDS) {
    const d = TECH[id];
    if (sim.y < d.arrive) continue;
    if (T.arrived[id] == null) {
      T.arrived[id] = sim.t;
      T.a[id] = Math.max(T.a[id], 0.02);
      const item = sim.news(`${d.icon} ${d.name} arrive in Watertown`, d.what, 'big');
      react(sim, 'tech-arrive', { name: d.name.toLowerCase() }, item, 2);
    }
    const st = d.stances && d.stances[T.stance[id]];
    const r = d.rate * (st && st.rateF ? st.rateF : 1);
    const a = T.a[id];
    T.a[id] = clamp(a + r * a * (1 - a / d.cap), 0, d.cap);
    // budget lines for the City's stance
    const key = 'tech:' + id;
    if (st && st.monthly) sim.recurring[key] = { label: `${d.name}: ${st.label}`, monthly: st.monthly };
    else if (st && st.revenue) sim.recurring[key] = { label: `${d.name}: curb fees`, monthly: -st.revenue * T.a[id] / d.cap };
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
  const local = sim.policies && sim.policies.formulaRetail ? n : Math.round(n * 0.25);
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

// Agenda items: one decision per technology when it arrives (the 2027 ones spread over the first year).
const FIRST_YEAR = { ebike: 8, ev: 4, solar: 11 };
export const TECH_SCENARIOS = TECH_IDS.filter((id) => TECH[id].stances).map((id) => {
  const d = TECH[id];
  return {
    id: 'tech-' + id,
    priority: true,
    when: (s) => s.tech && s.tech.arrived[id] != null && !s.tech.decided[id] && s.t >= (FIRST_YEAR[id] != null ? FIRST_YEAR[id] : 0),
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
