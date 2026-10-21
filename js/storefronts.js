// Storefront economy: leases, landlord asking rents, foot traffic, closures and vacancies.
// Everything is relative to the starting city (index 1.0 = rents and foot traffic in the starting year), so the
// real data sets the starting point and the dynamics come from what changes after you take office.
import { ZONE } from './config.js';
import { weatherFoot, WF_AVG } from './weather.js';
import { bizCategory, classifyLot, isSignature } from './vibrancy.js';
import { clamp, hash2 } from './util.js';
import { techFootfall, techRetailF } from './tech.js';
import { A } from './assumptions.js';

const STOREFRONT = new Set(['food', 'retail', 'service']);
// Turnover, calibrated in tools/validate.mjs against Watertown's storefronts today: shops close for ordinary
// reasons (retirement, a better offer, a chain trimming locations) near retail establishment exit rates (roughly
// 5–7% a year). In a calm market an affordable independent almost always gets the space; chains win where rents
// have run past what independents can pay. Replaying 2000–2026 with these lands near today's ~15% chain share.
export const SF = { indieExit: 0.006, chainExit: 0.004, chainFill: 0.01, leaseUp: 0.45 };

export const POLICIES = {
  vacancyFee: { label: 'Vacant storefront fee', blurb: 'Owners pay $2,000/mo per storefront left empty over 6 months. Landlords cut asking rents faster; property owners are not amused.' },
  rentRelief: { label: 'Small-business rent relief', blurb: 'City covers part of the rent for independent storefronts ($600/mo each). Expensive, but buys time.' },
  legacy: { label: 'Legacy business registry', blurb: 'Long-standing independents get grants and lease help. Cheap, popular with seniors.' },
  formulaRetail: { label: 'Chain-store limits (Square & Main St)', blurb: 'National chains need a special permit in the Square and along Main St / Mt Auburn St. Fewer chains, but spaces can stay empty longer.' },
  popups: { label: 'Pop-up arts program', blurb: 'Empty storefronts host rotating galleries and makers until a tenant signs ($3,000/mo each).' },
  gfDesign: { label: 'Ground-floor design rules', blurb: 'New mixed-use buildings must build small, shallow storefront bays with restaurant venting and grease traps. Costs developers (a few fewer projects); cafés, restaurants and shops can actually move in.' },
  gfDeed: { label: 'Rent-restricted storefronts', blurb: 'New mixed-use buildings deed-restrict their storefronts near today\'s rents for 15 years, for independents. Developers build a few fewer projects.' },
  serviceCap: { label: 'Limit on service tenants', blurb: 'Gyms, salons, spas and banks need a special permit once they fill a third of a building\'s storefronts. Livelier ground floors; some spaces wait longer.' },
};
// what a developer's ground floor is built for: deep, unvented boxes at pro-forma rents suit appointment
// businesses (they don't need passers-by) and credit tenants; restaurants and most shops can't fit or can't pay
const SERVICE_NAMES = [['{P} Boxing Club', 'fitness'], ['Iron {P} Fitness', 'fitness'], ['{P} Barre', 'fitness'], ['{P} Cycle Studio', 'fitness'], ['Luxe {P} Salon', 'hairdresser'], ['{P} Nail Bar', 'nails'], ['Serenity Day Spa', 'beauty'], ['{P} Med Spa', 'beauty'], ['{P} Brow & Lash', 'beauty'], ['{P} Wax Studio', 'beauty']];
const isService = (s) => (s.cat || bizCategory(s.k, s.n)) === 'service' || /bank|dentist|clinic|fitness/.test(s.k || '');
function serviceName(rand) {
  const [n, k] = pick(SERVICE_NAMES, rand());
  return { n: n.replace('{P}', pick(PLACE, rand())), k, sig: false };
}
// the service-tenant limit: a building whose storefronts are a third or more gyms, salons, spas and banks takes no more
function serviceCapped(sim, lot) {
  if (!(sim.policies || {}).serviceCap) return false;
  const n = (lot.sf || []).length + (lot.vacant || 0);
  return n >= 2 && (lot.sf || []).filter(isService).length + 1 > n / 3;
}
// an empty storefront in a developer's ground floor that wasn't built to the design rules
export const rawGF = (lot) => !!lot.newGF && !lot.newGF.design;

const PLACE = ['Coolidge', 'Arsenal', 'Charles', 'Galen', 'Bemis', 'Square', 'Riverside', 'Spring St', 'Pequossette', 'Saltonstall', 'Whitney', 'Orchard', 'Elm', 'Delta', 'Mill', 'Common', 'Union', 'Fifth Corner', 'Dam', 'Herring Run'];
const NAMES = {
  coffee: ['{P} Coffee', 'Little {P} Café', 'Grist & Grind', 'The Daily Pour', 'Second Shift Coffee', '{P} Roasters'],
  books: ['{P} Books', 'Dog-Ear Books', 'Marginalia', 'The Reading Room', 'Spine & Page'],
  boutique: ['{P} Goods', 'Thread & Needle', 'Magpie Vintage', 'Odd Lot', 'Paper Moon Gifts', 'Second Hand Rose'],
  gallery: ['Gallery {N}', '{P} Arts Collective', 'Storefront Studio', 'The Kiln', 'Small Works'],
  records: ['Groove {P}', 'B-Side Records', 'Needle Drop'],
  bakery: ['{P} Bakehouse', 'Sesame & Salt', 'Lavash Corner', 'Morning Bun'],
  restaurant: ['{P} Kitchen', 'Taverna {P}', 'The {P} Grill', 'Little Yerevan', 'Hand & Hearth', 'Mezze House', 'Noodle Bar {P}'],
  service: ['{P} Barbers', 'Fold Laundry', 'Stitch Tailoring', 'Clip Joint', 'Sweat {P} Yoga'],
  retail: ['{P} Hardware', '{P} Market', 'Plant Lady', 'Bike Shed', 'Cheese & Co.'],
};
const KIND_FOR = { coffee: 'cafe', books: 'books', boutique: 'boutique', gallery: 'art_gallery', records: 'music', bakery: 'bakery', restaurant: 'restaurant', service: 'hairdresser', retail: 'convenience' };
// Fictional chains / credit tenants who can outbid independents
const CHAINS = [
  ['Granite Federal Bank', 'bank'], ['MetroCell Wireless', 'mobile_phone'], ['Beanstream Coffee', 'cafe'], ['Burrito Depot', 'fast_food'],
  ['SmileBright Dental', 'dentist'], ['FitBox', 'fitness'], ['QuickMart', 'convenience'], ['Sprout Salads', 'fast_food'], ['Bay Urgent Care', 'clinic'], ['Pawsome Pet Supply', 'pet'],
];

function pick(arr, r) {
  return arr[Math.floor(r * arr.length) % arr.length];
}
// what kind of independent takes an empty storefront, weighted like Watertown's real independents today
// (mostly restaurants, salons, barbers, cleaners, gyms; about one in seven is a café, bakery, bookshop or similar)
const INDIE_MIX = [['restaurant', 0.3], ['service', 0.35], ['retail', 0.2], ['coffee', 0.04], ['bakery', 0.04], ['boutique', 0.03], ['books', 0.015], ['gallery', 0.015], ['records', 0.01]];
function indieType(r) {
  let a = 0;
  for (const [t, p] of INDIE_MIX) if ((a += p) >= r) return t;
  return 'restaurant';
}
function indieName(rand) {
  const type = indieType(rand());
  const n = pick(NAMES[type], rand()).replace('{P}', pick(PLACE, rand())).replace('{N}', String(10 + Math.floor(rand() * 90)));
  return { n, k: KIND_FOR[type], sig: ['coffee', 'books', 'boutique', 'gallery', 'records', 'bakery'].includes(type) };
}

// how far above the market this owner prices once buzz builds (see js/assumptions.js)
export function greedFor(sim, lot) {
  const g = hash2(lot.id, 91, 7);
  return g < A(sim, 'prospectors') ? 1.22 + 0.3 * hash2(lot.id, 92, 7) : 1 + 0.08 * g;
}
export function resetGreed(sim) {
  for (const lot of sim.w.lots) if (!lot.dead) lot.greed = greedFor(sim, lot);
}

export function inProtectedDistrict(sim, lot) {
  const [sx, sy] = sim.w.start;
  return Math.hypot(lot.cx - sx, lot.cy - sy) < 40 || /\b(Main St|Mt Auburn|Mount Auburn|Galen St)\b/i.test(lot.addr || '');
}

// Footfall field (residents + workers within walking distance, times walkability) relative to start.
function footfall(sim, c) {
  const pn = sim.popNear ? sim.popNear[c] : 0;
  const jn = sim.jobsNear ? sim.jobsNear[c] : 0;
  const walk = sim.walkC ? sim.walkC[c] : 1;
  return techFootfall(sim, pn, jn) * walk;
}

export function initStorefronts(sim) {
  const w = sim.w;
  sim.policies = sim.policies || {};
  sim.hype = sim.hype || 0;
  sim.sfLog = sim.sfLog || [];
  sim.sfStats = { open: 0, vacant: 0, chain: 0, sig: 0, closures: 0, openings: 0 };
  const r = (k) => hash2(k, 77, 3);
  let n = 0;
  for (const lot of w.lots) {
    if (lot.dead || !lot.inTown) continue;
    if (lot.biz && lot.biz.length && !lot.bizCat) classifyLot(lot);
    lot.ask = lot.ask || 1;
    lot.vacant = lot.vacant || 0;
    // about a quarter of owners are "prospectors": they price for the Watertown they expect, not the one they have
    if (lot.greed == null) lot.greed = greedFor(sim, lot);
    seedLot(sim, lot, () => r(n++));
  }
  refreshStats(sim);
}

// A lot's storefronts from its real business list (at game start, or when a historical replay rebuilds it).
function seedLot(sim, lot, rnd) {
  lot.sf = [];
  lot.vacant = lot.vacant || 0;
  // only commercial and mixed-use parcels have storefronts (home businesses on house lots don't)
  if (!(lot.zone === ZONE.C || lot.mixed || lot.shops)) return;
  if (lot.biz && lot.biz.length && !lot.bizCat) classifyLot(lot);
  (lot.biz || []).forEach((name, k) => {
    const cat = lot.bizCat[k];
    if (!STOREFRONT.has(cat)) return;
    const chain = !!lot.bizChainF[k];
    const kind = lot.bizKind ? lot.bizKind[k] : '';
    const sig = isSignature(kind, name, chain);
    const h = rnd();
    lot.sf.push({
      n: name, k: kind, cat, chain, sig, orig: 1,
      lease: 1 + Math.floor(h * 60), // months left on the current lease
      rent: 1, // rent locked in at signing (index)
      cushion: chain ? 0.25 + 0.25 * h : sig ? 0.03 + 0.17 * h : 0.07 + 0.25 * h,
      since: sim.t || 0,
    });
  });
  if (lot.sf.length) {
    const c = sim.cellOf(lot.cx, lot.cy);
    lot.ff0 = footfall(sim, c) || 1;
    lot.vib0 = sim.vibSat ? sim.vibSat[c] : 0;
    lot.storefronts = lot.sf.length;
  }
}
export function seedStorefronts(sim, lot) {
  seedLot(sim, lot, () => sim.rand());
  refreshStats(sim);
}

function refreshStats(sim) {
  const st = { open: 0, vacant: 0, chain: 0, sig: 0, indie: 0, ask: 0, askN: 0 };
  for (const lot of sim.w.lots) {
    if (!lot.sf || lot.dead) continue;
    for (const s of lot.sf) {
      st.open++;
      if (s.chain) st.chain++;
      else st.indie++;
      if (s.sig) st.sig++;
    }
    st.vacant += lot.vacant || 0;
    if (lot.storefronts) {
      st.ask += lot.ask;
      st.askN++;
    }
  }
  st.askAvg = st.askN ? st.ask / st.askN : 1;
  sim.sfStats = { ...sim.sfStats, ...st };
}

export function syncBiz(lot) {
  // rebuild the lot's business list: live storefronts first, then the lot's non-storefront businesses
  const others = [];
  (lot.biz || []).forEach((n, k) => {
    if (!STOREFRONT.has(lot.bizCat[k])) others.push([n, lot.bizKind ? lot.bizKind[k] : '', lot.bizCat[k], lot.bizChainF[k], lot.bizSig ? lot.bizSig[k] : 0]);
  });
  const all = lot.sf.map((s) => [s.n, s.k, s.cat, s.chain ? 1 : 0, s.sig ? 1 : 0]).concat(others);
  lot.biz = all.map((a) => a[0]);
  lot.bizKind = all.map((a) => a[1]);
  lot.bizCat = all.map((a) => a[2]);
  lot.bizChainF = all.map((a) => a[3]);
  lot.bizSig = all.map((a) => a[4] || 0);
}

export function openShop(sim, lot, shop) {
  lot.sf = lot.sf || [];
  lot.sf.push(shop);
  lot.vacant = Math.max(0, (lot.vacant || 0) - 1);
  lot.storefronts = Math.max(lot.storefronts || 0, lot.sf.length + lot.vacant);
  syncBiz(lot);
}

// "Watertown is on the rise": the buzz landlords price on. devBuzz is the part your own big projects add.
export function buzzNow(sim) {
  const devBuzz = Math.min(0.25, (sim.megaprojects || 0) * 0.06 + (sim.flags.squareDone ? 0.08 : 0));
  const on = A(sim, 'buzz');
  return { hype: ((sim.hype || 0) + devBuzz) * on, dev: devBuzz * on, base: (sim.hype || 0) * on };
}
// One lot's storefront market this month: foot traffic and street life against the start, what the landlord
// wants and why, and what each kind of tenant can afford. The monthly step runs on these numbers, and the
// Why? window explains them.
export function lotMarket(sim, lot, hype = buzzNow(sim).hype, wf = weatherFoot(sim) / WF_AVG) {
  const c = sim.cellOf(lot.cx, lot.cy);
  if (!lot.ff0) {
    lot.ff0 = footfall(sim, c) || 1;
    lot.vib0 = sim.vibSat ? sim.vibSat[c] : 0;
  }
  const ffRaw = footfall(sim, c) / (lot.ff0 || 1);
  const ff = ffRaw * wf;
  const vibD = (sim.vibSat ? sim.vibSat[c] : 0) - (lot.vib0 || 0);
  const lvRise = Math.max(0, sim.lvMod[c] - 1);
  const greed = lot.greed || 1;
  const parts = { land: 1.6 * lvRise, buzz: 1.15 * hype, street: 0.45 * Math.max(0, vibD) };
  const greedF = 1 + (greed - 1) * Math.min(1, hype * 4);
  let target = (1 + parts.land + parts.buzz + parts.street) * greedF;
  const capped = lot.rentCap && sim.t < (lot.rentCapUntil || 0);
  if (capped) target = Math.min(target, lot.rentCap); // deed-restricted storefronts
  const rev = Math.pow(Math.max(0.2, ff), 0.6) * (1 + 0.25 * vibD);
  const P = sim.policies || {};
  const indieCap = 1 + (0.1 + 0.5 * (rev - 1)) / 0.45 + (P.rentRelief ? 0.27 : 0);
  const chainCap = 1 + (0.3 + 0.6 * (rev - 1)) / 0.45;
  return { c, ff, ffRaw, wf, vibD, lvRise, greed, greedF, parts, target, capped, rev, indieCap, chainCap, hype, prot: !!(P.formulaRetail && inProtectedDistrict(sim, lot)) };
}
// a shop's monthly margin (above zero it pays its way), split into its parts
export function shopMargin(sim, lot, s, m = lotMarket(sim, lot)) {
  const P = sim.policies || {};
  const rev = m.rev * techRetailF(sim, s);
  const parts = { cushion: s.cushion, sales: 0.5 * (rev - 1), rent: -0.45 * (s.rent - 1), relief: !s.chain && P.rentRelief ? 0.12 : 0, legacy: !s.chain && s.orig && P.legacy ? 0.06 : 0, tech: 0.5 * (rev - m.rev) };
  return { margin: parts.cushion + parts.sales + parts.rent + parts.relief + parts.legacy, parts, rev };
}
// what the Why? window keeps about a change on the lot (the numbers, not the words)
function why(lot, sim, type, s, m, extra = {}) {
  lot.why = lot.why || [];
  lot.why.push({ t: sim.t, date: sim.dateStr(), type, n: s ? s.n : '', chain: s ? !!s.chain : false, sig: s ? !!s.sig : false, ask: lot.ask, ff: m.ffRaw, vibD: m.vibD, parts: m.parts, greedF: m.greedF, indieCap: m.indieCap, chainCap: m.chainCap, prot: m.prot, ...extra });
  if (lot.why.length > 6) lot.why.shift();
}
export const DEALS_PER_MONTH = 2; // the small-business office's capacity to broker leases

// Monthly storefront economy. Returns notable events for the news/comment feed.
export function storefrontsMonthly(sim) {
  const w = sim.w;
  if (!sim.sfStats) initStorefronts(sim);
  const P = sim.policies;
  const events = [];
  const rand = sim.rand;
  // buzz feeds on vibrancy and fades when the place hollows out
  // (before the 2010s life-science boom, nobody was calling Watertown "the next Somerville")
  const buzzOn = A(sim, 'buzz');
  sim.hype = buzzOn ? clamp((sim.hype || 0) + (sim.y < 2013 ? 0.0012 : 0.0042) + 0.0009 * (sim.vibrancy - sim.base.vib0), 0, 0.8) : 0;
  const hype = buzzNow(sim).hype;
  sim.dealsLeft = DEALS_PER_MONTH;
  let popups = 0, reliefN = 0, vacantOld = 0;
  const wf = weatherFoot(sim) / WF_AVG; // seasons: busier in good weather, quieter in a cold wet month
  for (const lot of w.lots) {
    if (lot.dead || !lot.inTown || !lot.storefronts || lot.under) continue;
    const m = lotMarket(sim, lot, hype, wf);
    const { ff, vibD, greed } = m;
    // landlords' asking rent: follows buzz up quickly, comes down slowly (and slower still when empty)
    const target = m.target;
    const vacantNow = lot.vacant > 0;
    if (target > lot.ask) lot.ask += (target - lot.ask) * 0.05;
    else {
      // owners hold out, but a year or two of empty windows wears anyone down
      const months = vacantNow ? sim.t - (lot.vacantSince ?? sim.t) : 0;
      const holdRate = greed > 1.15 ? (months > 24 ? 0.025 : months > 12 ? 0.012 : 0.003) : 0.012;
      lot.ask -= (lot.ask - target) * (vacantNow ? (P.vacancyFee ? 0.06 : holdRate) : 0.01);
    }
    // even with no better offer, a prospector waits; a vacancy fee makes waiting expensive
    if (vacantNow && P.vacancyFee && sim.t - (lot.vacantSince ?? sim.t) >= 6) lot.ask *= 0.985;
    const protectedD = P.formulaRetail && inProtectedDistrict(sim, lot);
    // tenants
    let changed = false;
    for (let k = lot.sf.length - 1; k >= 0; k--) {
      const s = lot.sf[k];
      if (s.popup) {
        s.lease--;
        if (s.lease <= 0) {
          lot.sf.splice(k, 1);
          lot.vacant++;
          changed = true;
        } else popups++;
        continue;
      }
      s.lease--;
      if (s.lease <= 0) {
        // lease renewal: rent resets to the landlord's current asking rent
        const jump = lot.ask / s.rent - 1;
        s.rent = lot.ask;
        s.lease = 60;
        if (jump > 0.15 && !s.chain) s.shock = jump;
      }
      const sm = shopMargin(sim, lot, s, m);
      const margin = sm.margin;
      if (!s.chain && P.rentRelief) reliefN++;
      const retire = s.chain || /bank|credit|financ|insurance/i.test(s.k || s.n) ? SF.chainExit : SF.indieExit;
      const pClose = margin < 0 ? Math.min(0.45, 0.06 + 0.6 * -margin) : retire;
      if (rand() < pClose) {
        lot.sf.splice(k, 1);
        lot.vacant++;
        lot.vacantSince = sim.t;
        changed = true;
        sim.sfStats.closures = (sim.sfStats.closures || 0) + 1;
        why(lot, sim, margin < 0 ? 'close-rent' : 'close-retire', s, m, { margin, mparts: sm.parts, rent: s.rent, jump: s.shock || 0, since: s.since });
        if (!s.chain) events.push({ type: margin < 0 ? 'close-rent' : 'close-retire', shop: s, lot, jump: s.shock || 0 });
      }
    }
    // fill vacancies
    if (lot.vacant > 0 && lot.bldgs.length) {
      const months = sim.t - (lot.vacantSince ?? sim.t);
      if (months >= 6) vacantOld += lot.vacant;
      const rev = m.rev;
      // what each kind of tenant can afford, as a rent index
      const indieCap = m.indieCap, chainCap = m.chainCap;
      const interest = clamp(SF.leaseUp * rev, 0.04, 0.5);
      if (rand() < interest) {
        const indieOk = lot.ask <= indieCap;
        const chainOk = !protectedD && lot.ask <= chainCap;
        let shop = null;
        const capped = serviceCapped(sim, lot);
        // a raw developer box: gyms, salons and spas can pay a chain's rent there (they don't live on passers-by);
        // cafés, restaurants and most shops would need to pay for venting and build-out on top of the rent
        const raw = rawGF(lot);
        const serviceOk = raw && !capped && lot.ask <= chainCap * 0.97;
        const fitOk = !raw || lot.ask <= indieCap - 0.15;
        if (serviceOk && (!fitOk || rand() < 0.65) && rand() > Math.min(0.5, 0.15 + 0.4 * hype)) {
          const nm = serviceName(rand);
          shop = { n: nm.n, k: nm.k, cat: bizCategory(nm.k, nm.n), chain: false, sig: false, orig: 0, lease: 120, rent: lot.ask, cushion: 0.12, since: sim.t };
        } else if (indieOk && fitOk && (!chainOk || rand() > Math.min(0.55, SF.chainFill + 0.5 * hype * A(sim, 'chainTilt')))) {
          let nm = indieName(rand);
          if (capped && nm.k === 'hairdresser') nm = indieName(rand);
          if (!(capped && nm.k === 'hairdresser')) shop = { n: nm.n, k: nm.k, cat: bizCategory(nm.k, nm.n), chain: false, sig: nm.sig, orig: 0, lease: 60, rent: lot.ask, cushion: indieCap - lot.ask > 0 ? Math.min(0.3, 0.45 * (indieCap - lot.ask)) : 0.02, since: sim.t };
        } else if (chainOk) {
          let [n, k] = pick(CHAINS, rand());
          if (capped && isService({ n, k })) [n, k] = pick(CHAINS, rand());
          if (!(capped && isService({ n, k }))) shop = { n, k, cat: bizCategory(k, n), chain: true, sig: false, orig: 0, lease: 120, rent: lot.ask, cushion: 0.3, since: sim.t };
        }
        if (shop) {
          openShop(sim, lot, shop);
          why(lot, sim, shop.chain ? 'open-chain' : 'open-indie', shop, m, { indieOk, chainOk });
          lot.vacantSince = lot.vacant > 0 ? lot.vacantSince : null;
          changed = true;
          sim.sfStats.openings = (sim.sfStats.openings || 0) + 1;
          events.push({ type: shop.chain ? 'open-chain' : 'open-indie', shop, lot });
        } else if (months === 9) {
          why(lot, sim, 'holdout', null, m, { months });
          events.push({ type: 'holdout', lot });
        }
      }
      // pop-ups fill long-empty spaces
      if (P.popups && lot.vacant > 0 && months >= 4 && rand() < 0.3) {
        const nm = { n: `${pick(PLACE, rand())} Pop-up Gallery`, k: 'art_gallery' };
        openShop(sim, lot, { n: nm.n, k: nm.k, cat: 'retail', chain: false, sig: true, popup: true, orig: 0, lease: 6, rent: 0.3, cushion: 0.5, since: sim.t });
        changed = true;
        events.push({ type: 'popup', lot });
      }
    }
    if (changed) {
      sim.walkDirty = true;
      syncBiz(lot);
      sim.hooks.invalidateBuilding && lot.bldgs.forEach((id) => sim.hooks.invalidateBuilding(w.bldgs[id]));
    }
  }
  // policy costs / revenues on the budget
  const set = (key, on, label, monthly) => {
    if (on) sim.recurring[key] = { label, monthly: monthly * (sim.priceF ? sim.priceF() : 1) };
    else delete sim.recurring[key];
  };
  set('pol:relief', P.rentRelief, 'Small-business rent relief', reliefN * 600);
  set('pol:legacy', P.legacy, 'Legacy business registry', 15000);
  set('pol:formula', P.formulaRetail, 'Chain-store permit review', 6000);
  set('pol:popups', P.popups, 'Pop-up arts program', popups * 3000);
  set('pol:svccap', P.serviceCap, 'Service-tenant permit review', 3000);
  set('pol:vacfee', P.vacancyFee, 'Vacant storefront fees', -vacantOld * 2000);
  refreshStats(sim);
  return events;
}

// Standing approval effects of the Main Street policies
export function policyApproval(sim) {
  const P = sim.policies || {};
  const o = {};
  const add = (k, v) => (o[k] = (o[k] || 0) + v);
  if (P.vacancyFee) { add('business', -4); add('renters', 1); }
  if (P.rentRelief) { add('business', 3); add('homeowners', -1); add('renters', 1); }
  if (P.legacy) { add('seniors', 2); add('homeowners', 1); }
  if (P.formulaRetail) { add('business', -3); add('homeowners', 2); add('renters', 1); }
  if (P.popups) { add('renters', 2); }
  if (P.gfDesign) { add('business', -1); add('renters', 1); }
  if (P.gfDeed) { add('business', -2); add('renters', 1); add('homeowners', 1); }
  if (P.serviceCap) { add('business', -2); add('homeowners', 1); }
  return o;
}

// ---- storefronts for lease: the player's pick ----
// Each empty storefront has up to three applicants: an ordinary independent (a restaurant, a salon, a shop), a
// signature one the office has recruited (a café, bakery, bookshop, gallery...: thinner margins, so it can pay
// a little less), and, where the landlord's ask allows one and chain limits don't forbid it, a chain. The City's small-business office can close a deal this month (two a month):
// signing the independent costs a broker's fee, plus a grant covering two years of the gap when the ask is
// above what an independent can pay; letting the chain in costs nothing. Left alone, the market fills the space
// exactly as before.
const GAP_RENT = 3000; // dollars a month per rent-index point for a typical storefront
export function applicants(sim, lot) {
  if (!lot.vacant) return null;
  const m = lotMarket(sim, lot);
  const seed = (lot.vacantSince ?? 0) * 31 + lot.id;
  let k = 0;
  const r = () => hash2(seed, 401, k++);
  let nm = indieName(r);
  for (let t = 0; t < 6 && nm.sig; t++) nm = indieName(r);
  const pf = sim.priceF ? sim.priceF() : 1;
  const fee = Math.round(5000 * pf);
  const grantFor = (cap) => { const gap = Math.max(0, lot.ask - cap); return gap > 0 ? Math.round((gap * GAP_RENT * 24 * pf) / 1000) * 1000 : 0; };
  const raw = rawGF(lot), capped = serviceCapped(sim, lot);
  // in a raw developer box the independent who wants the space is a gym, salon or spa, and can pay like a chain;
  // anyone else pays for venting and build-out on top of the rent
  if (raw && !capped) nm = serviceName(r);
  for (let t = 0; t < 6 && capped && nm.k === 'hairdresser'; t++) nm = indieName(r);
  const fit = raw ? 0.15 : 0;
  const indie = { n: nm.n, k: nm.k, cat: bizCategory(nm.k, nm.n), chain: false, sig: false, cap: raw && !capped ? m.chainCap * 0.97 : m.indieCap - fit };
  indie.grant = grantFor(indie.cap);
  const SIG = ['coffee', 'bakery', 'books', 'boutique', 'gallery', 'records'];
  const st = SIG[Math.floor(r() * SIG.length)];
  const sn = pick(NAMES[st], r()).replace('{P}', pick(PLACE, r())).replace('{N}', String(10 + Math.floor(r() * 90)));
  const sig = { n: sn, k: KIND_FOR[st], cat: bizCategory(KIND_FOR[st], sn), chain: false, sig: true, cap: m.indieCap - 0.12 - fit };
  sig.grant = grantFor(sig.cap);
  let [cn, ck] = pick(CHAINS, r());
  for (let t = 0; t < 6 && capped && isService({ n: cn, k: ck }); t++) [cn, ck] = pick(CHAINS, r());
  const chain = !m.prot && lot.ask <= m.chainCap && !(capped && isService({ n: cn, k: ck })) ? { n: cn, k: ck, cat: bizCategory(ck, cn), chain: true, sig: false } : null;
  return { m, raw, indie, sig, chain, fee, grant: indie.grant, gap: Math.max(0, lot.ask - m.indieCap), months: sim.t - (lot.vacantSince ?? sim.t) };
}
export function signTenant(sim, lot, which) {
  const a = applicants(sim, lot);
  if (!a) return { error: 'That storefront has been let.' };
  if ((sim.dealsLeft ?? DEALS_PER_MONTH) <= 0) return { error: 'The small-business office has closed two deals this month already.' };
  let shop, cost = 0;
  if (which === 'chain') {
    if (!a.chain) return { error: 'No chain can make the numbers work here.' };
    shop = { ...a.chain, orig: 0, lease: 120, rent: lot.ask, cushion: 0.3, since: sim.t };
  } else {
    const c = which === 'sig' ? a.sig : a.indie;
    cost = a.fee + c.grant;
    if (sim.funds < cost) return { error: 'Not enough in reserves.' };
    sim.funds -= cost;
    // the grant brings the rent the shop pays down to what it can afford, for the lease's first two years
    const { cap, grant, ...base } = c;
    shop = { ...base, orig: 0, lease: grant ? 24 : 60, rent: Math.min(lot.ask, cap), cushion: Math.max(0.04, grant ? 0.06 : Math.min(0.3, 0.45 * (cap - lot.ask))), since: sim.t, granted: grant || 0 };
  }
  sim.dealsLeft = (sim.dealsLeft ?? DEALS_PER_MONTH) - 1;
  openShop(sim, lot, shop);
  why(lot, sim, shop.chain ? 'open-chain' : 'open-indie', shop, a.m, { picked: true, grant: shop.granted || 0, fee: shop.chain ? 0 : a.fee });
  if (!lot.vacant) lot.vacantSince = null;
  sim.sfStats.openings = (sim.sfStats.openings || 0) + 1;
  sim.walkDirty = true;
  sim.hooks.invalidateBuilding && lot.bldgs.forEach((id) => sim.hooks.invalidateBuilding(sim.w.bldgs[id]));
  refreshStats(sim);
  return { shop, cost };
}
