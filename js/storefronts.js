// Storefront economy: leases, landlord asking rents, foot traffic, closures and vacancies.
// Everything is relative to the starting city (index 1.0 = 2027 rents / 2027 foot traffic), so the
// real data sets the starting point and the dynamics come from what changes after you take office.
import { ZONE } from './config.js';
import { bizCategory, classifyLot, isSignature } from './vibrancy.js';
import { clamp, hash2 } from './util.js';

const STOREFRONT = new Set(['food', 'retail', 'service']);

export const POLICIES = {
  vacancyFee: { label: 'Vacant storefront fee', blurb: 'Owners pay $2,000/mo per storefront left empty over 6 months. Landlords cut asking rents faster; property owners are not amused.' },
  rentRelief: { label: 'Small-business rent relief', blurb: 'City covers part of the rent for independent storefronts ($600/mo each). Expensive, but buys time.' },
  legacy: { label: 'Legacy business registry', blurb: 'Long-standing independents get grants and lease help. Cheap, popular with seniors.' },
  formulaRetail: { label: 'Chain-store limits (Square & Main St)', blurb: 'National chains need a special permit in the Square and along Main St / Mt Auburn St. Fewer chains, but spaces can stay empty longer.' },
  popups: { label: 'Pop-up arts program', blurb: 'Empty storefronts host rotating galleries and makers until a tenant signs ($3,000/mo each).' },
};

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
function indieName(rand) {
  const type = pick(Object.keys(NAMES), rand());
  const n = pick(NAMES[type], rand()).replace('{P}', pick(PLACE, rand())).replace('{N}', String(10 + Math.floor(rand() * 90)));
  return { n, k: KIND_FOR[type], sig: ['coffee', 'books', 'boutique', 'gallery', 'records', 'bakery'].includes(type) };
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
  return (pn + 0.6 * jn) * walk;
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
    if (lot.greed == null) {
      const g = hash2(lot.id, 91, 7);
      lot.greed = g < 0.27 ? 1.22 + 0.3 * hash2(lot.id, 92, 7) : 1 + 0.08 * g;
    }
    lot.sf = [];
    // only commercial and mixed-use parcels have storefronts (home businesses on house lots don't)
    if (!(lot.zone === ZONE.C || lot.mixed)) continue;
    (lot.biz || []).forEach((name, k) => {
      const cat = lot.bizCat[k];
      if (!STOREFRONT.has(cat)) return;
      const chain = !!lot.bizChainF[k];
      const kind = lot.bizKind ? lot.bizKind[k] : '';
      const sig = isSignature(kind, name, chain);
      const h = r(n++);
      lot.sf.push({
        n: name, k: kind, cat, chain, sig, orig: 1,
        lease: 1 + Math.floor(h * 60), // months left on the current lease
        rent: 1, // rent locked in at signing (index)
        cushion: chain ? 0.25 + 0.25 * h : sig ? 0.03 + 0.17 * h : 0.07 + 0.25 * h,
        since: 0,
      });
    });
    if (lot.sf.length) {
      const c = sim.cellOf(lot.cx, lot.cy);
      lot.ff0 = footfall(sim, c) || 1;
      lot.vib0 = sim.vibSat ? sim.vibSat[c] : 0;
      lot.storefronts = lot.sf.length;
    }
  }
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

function syncBiz(lot) {
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

// Monthly storefront economy. Returns notable events for the news/comment feed.
export function storefrontsMonthly(sim) {
  const w = sim.w;
  if (!sim.sfStats) initStorefronts(sim);
  const P = sim.policies;
  const events = [];
  const rand = sim.rand;
  // "Watertown is on the rise": regional spillover plus buzz from your own successes
  const devBuzz = Math.min(0.25, (sim.megaprojects || 0) * 0.06 + (sim.flags.squareDone ? 0.08 : 0));
  // buzz feeds on vibrancy and fades when the place hollows out
  sim.hype = clamp((sim.hype || 0) + 0.0042 + 0.0009 * (sim.vibrancy - sim.base.vib0), 0, 0.8);
  const hype = sim.hype + devBuzz;
  let popups = 0, reliefN = 0, vacantOld = 0;
  for (const lot of w.lots) {
    if (lot.dead || !lot.inTown || !lot.storefronts) continue;
    const c = sim.cellOf(lot.cx, lot.cy);
    const ff = footfall(sim, c) / (lot.ff0 || 1);
    const vibD = (sim.vibSat ? sim.vibSat[c] : 0) - (lot.vib0 || 0);
    const lvRise = Math.max(0, sim.lvMod[c] - 1);
    // landlords' asking rent: follows buzz up quickly, comes down slowly (and slower still when empty)
    const greed = lot.greed || 1;
    const target = (1 + 1.6 * lvRise + 1.15 * hype + 0.45 * Math.max(0, vibD)) * (1 + (greed - 1) * Math.min(1, hype * 4));
    const vacantNow = lot.vacant > 0;
    if (target > lot.ask) lot.ask += (target - lot.ask) * 0.05;
    else lot.ask -= (lot.ask - target) * (vacantNow ? (P.vacancyFee ? 0.06 : greed > 1.15 ? 0.003 : 0.012) : 0.01);
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
      const rev = Math.pow(Math.max(0.2, ff), 0.6) * (1 + 0.25 * vibD) * (s.chain ? 1 : 1);
      let margin = s.cushion + 0.5 * (rev - 1) - 0.45 * (s.rent - 1);
      if (!s.chain && P.rentRelief) {
        margin += 0.12;
        reliefN++;
      }
      if (!s.chain && s.orig && P.legacy) margin += 0.06;
      const retire = s.chain ? 0.0008 : 0.0022;
      const pClose = margin < 0 ? Math.min(0.45, 0.06 + 0.6 * -margin) : retire;
      if (rand() < pClose) {
        lot.sf.splice(k, 1);
        lot.vacant++;
        lot.vacantSince = sim.t;
        changed = true;
        sim.sfStats.closures = (sim.sfStats.closures || 0) + 1;
        if (!s.chain) events.push({ type: margin < 0 ? 'close-rent' : 'close-retire', shop: s, lot, jump: s.shock || 0 });
      }
    }
    // fill vacancies
    if (lot.vacant > 0) {
      const months = sim.t - (lot.vacantSince ?? sim.t);
      if (months >= 6) vacantOld += lot.vacant;
      const rev = Math.pow(Math.max(0.2, ff), 0.6) * (1 + 0.25 * vibD);
      // what each kind of tenant can afford, as a rent index
      const indieCap = 1 + (0.1 + 0.5 * (rev - 1)) / 0.45 + (P.rentRelief ? 0.27 : 0);
      const chainCap = 1 + (0.3 + 0.6 * (rev - 1)) / 0.45;
      const interest = clamp(0.18 * rev, 0.04, 0.35);
      if (rand() < interest) {
        const indieOk = lot.ask <= indieCap;
        const chainOk = !protectedD && lot.ask <= chainCap;
        let shop = null;
        if (indieOk && (!chainOk || rand() < 0.45)) {
          const nm = indieName(rand);
          shop = { n: nm.n, k: nm.k, cat: bizCategory(nm.k, nm.n), chain: false, sig: nm.sig, orig: 0, lease: 60, rent: lot.ask, cushion: indieCap - lot.ask > 0 ? Math.min(0.3, 0.45 * (indieCap - lot.ask)) : 0.02, since: sim.t };
        } else if (chainOk) {
          const [n, k] = pick(CHAINS, rand());
          shop = { n, k, cat: bizCategory(k, n), chain: true, sig: false, orig: 0, lease: 120, rent: lot.ask, cushion: 0.3, since: sim.t };
        }
        if (shop) {
          openShop(sim, lot, shop);
          lot.vacantSince = lot.vacant > 0 ? lot.vacantSince : null;
          changed = true;
          sim.sfStats.openings = (sim.sfStats.openings || 0) + 1;
          events.push({ type: shop.chain ? 'open-chain' : 'open-indie', shop, lot });
        } else if (months === 9) events.push({ type: 'holdout', lot });
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
      syncBiz(lot);
      sim.hooks.invalidateBuilding && lot.bldgs.forEach((id) => sim.hooks.invalidateBuilding(w.bldgs[id]));
    }
  }
  // policy costs / revenues on the budget
  const set = (key, on, label, monthly) => {
    if (on) sim.recurring[key] = { label, monthly };
    else delete sim.recurring[key];
  };
  set('pol:relief', P.rentRelief, 'Small-business rent relief', reliefN * 600);
  set('pol:legacy', P.legacy, 'Legacy business registry', 15000);
  set('pol:formula', P.formulaRetail, 'Chain-store permit review', 6000);
  set('pol:popups', P.popups, 'Pop-up arts program', popups * 3000);
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
  return o;
}
