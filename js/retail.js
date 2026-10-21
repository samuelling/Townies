// Who shops here, and from how far. Each storefront gets an estimate of its yearly sales and of the share that
// comes from outside Watertown, and from 8 km or more away (past the next town over, past plenty of other
// stores). The numbers come from data/retail.json.gz (tools/retail/draw.py): a gravity model of where the
// region's people shop, run over every comparable store within 25 km. Real shops are looked up by name; shops
// the game invents take the typical figures for their kind. Sales then move with each shop's foot traffic.
// Informational: nothing here feeds approval, vibrancy or the missions.
import { makeProj } from './geo.js';
import { shopMargin, lotMarket } from './storefronts.js';

let RT = null;
const norm = (s) => (s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, '').replace(/watertown/g, '');

// the game's shop kinds (OpenStreetMap tags) to the model's kinds of store
const KIND_CLASS = {
  supermarket: 'supermarket', convenience: 'convenience', alcohol: 'liquor', wine: 'liquor', pharmacy: 'pharmacy', chemist: 'pharmacy',
  restaurant: 'restaurant', fast_food: 'quick', food_court: 'quick', cafe: 'cafe', coffee: 'cafe', bakery: 'bakery', pastry: 'bakery',
  ice_cream: 'bakery', confectionery: 'bakery', bar: 'bar', pub: 'bar', biergarten: 'bar', clothes: 'apparel', shoes: 'apparel',
  jewelry: 'apparel', boutique: 'apparel', bag: 'apparel', department_store: 'general', variety_store: 'general', general: 'general',
  doityourself: 'home', hardware: 'home', garden_centre: 'home', paint: 'home', electronics: 'electronics', mobile_phone: 'electronics',
  computer: 'electronics', furniture: 'furnishings', interior_decoration: 'furnishings', kitchen: 'furnishings', books: 'specialty',
  gift: 'specialty', music: 'specialty', art_gallery: 'specialty', art: 'specialty', toys: 'specialty', sports: 'specialty',
  bicycle: 'specialty', pet: 'specialty', florist: 'specialty', second_hand: 'specialty', hairdresser: 'personal', beauty: 'personal',
  nails: 'personal', massage: 'personal', cosmetics: 'personal', tattoo: 'personal', fitness_centre: 'fitness', sports_centre: 'fitness',
  cinema: 'entertainment', bowling_alley: 'entertainment', cannabis: 'cannabis', deli: 'grocery', greengrocer: 'grocery', butcher: 'grocery',
  seafood: 'grocery', cheese: 'grocery',
};
const CAT_CLASS = { food: 'restaurant', retail: 'specialty', service: 'personal' };

const pctile = (a, p) => {
  if (!a.length) return 0;
  const s = a.slice().sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};

export function setRetailData(data, world) {
  RT = null;
  if (!data || !data.stores || !world || !world.bbox) return null;
  const pr = makeProj(world.bbox);
  const C = Object.fromEntries(data.cols.map((c, i) => [c, i]));
  const stores = data.stores.map((r) => {
    const [x, y] = pr.toGrid(r[C.lat1e5] / 1e5, r[C.lon1e5] / 1e5);
    return { n: r[C.name], key: norm(r[C.name]), x, y, cls: r[C.class], market: r[C.market], chain: !!r[C.chain], sales: r[C.sales_k] * 1000, out: r[C.out_pct] / 100, far: r[C.far_pct] / 100, like8: r[C.like_within_8km], nearest: r[C.nearest_like_km] };
  });
  // typical figures by kind, for shops the game invents: independents at the median, signature shops (the ones
  // you recruit for being one of a kind) at the reach of the farthest-drawing quarter of their kind
  const typ = {};
  for (const cls of new Set(stores.map((s) => s.cls))) {
    const ind = stores.filter((s) => s.cls === cls && !s.chain), ch = stores.filter((s) => s.cls === cls && s.chain);
    const pick = (arr, f, p) => pctile(arr.map(f), p);
    typ[cls] = {
      indie: { sales: pick(ind, (s) => s.sales, 0.5), out: pick(ind, (s) => s.out, 0.5), far: pick(ind, (s) => s.far, 0.5) },
      sig: { sales: pick(ind, (s) => s.sales, 0.5), out: pick(ind, (s) => s.out, 0.75), far: pick(ind, (s) => s.far, 0.75) },
      chain: ch.length >= 2 ? { sales: pick(ch, (s) => s.sales, 0.5), out: pick(ch, (s) => s.out, 0.5), far: pick(ch, (s) => s.far, 0.5) } : null,
    };
  }
  RT = { v: data.v, fetched: data.fetched, stores, typ, cache: new WeakMap() };
  return RT;
}
export const retailReady = () => !!RT;

// businesses that aren't shopping: banks, post offices, clubs, hotels, schools, offices
const NOT_SHOPPING = /bank|atm|post|shipping|food_bank|social_club|veteran|hotel|motel|hostel|school|academy|college|church|worship|clinic|dentist|doctor|medical|hospital|insurance|estate|lawyer|attorney|account|office|agency|charity|community|government|library|performing_arts|car_dealer|automotive|vehicle|auto_|gas_station|fuel|storage|funeral/;
function classOf(s) {
  const k = s.k || '';
  if (KIND_CLASS[k]) return KIND_CLASS[k];
  if (NOT_SHOPPING.test(k)) return null;
  if (/fitness|gym|sport|yoga|pilates|martial|dance/.test(k)) return 'fitness';
  if (/beauty|salon|nail|barber|tattoo|spa|laundry|laundr|dry_clean|tailor|groom|cosmetic|skin|massage/.test(k)) return 'personal';
  if (/coffee|cafe|tea/.test(k)) return 'cafe';
  if (/bakery|dessert|donut|ice_cream/.test(k)) return 'bakery';
  if (/pizza|sandwich|fast_food|burger|deli|takeout/.test(k)) return 'quick';
  if (/restaurant|food|eatery|diner|grill/.test(k)) return 'restaurant';
  if (/bar|pub|brewery|taproom|lounge/.test(k)) return 'bar';
  if (/grocery|market|butcher|seafood/.test(k)) return 'grocery';
  if (/clothing|apparel|shoe|jewel|fashion/.test(k)) return 'apparel';
  if (/electronic|phone|computer|appliance/.test(k)) return 'electronics';
  if (/furniture|home_goods|mattress|decor/.test(k)) return 'furnishings';
  if (/hardware|home_improvement|garden|building_supply|tile|flooring/.test(k)) return 'home';
  return CAT_CLASS[s.cat] || 'specialty';
}
// how alike two store names are: one is the other plus more, or they share most of a long beginning
function sameName(a, b) {
  if (a.length < 3 || b.length < 3) return false;
  if (a === b) return true;
  const n = Math.min(a.length, b.length);
  if (n >= 5 && (a.startsWith(b) || b.startsWith(a))) return true;
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  return i >= 8 && i >= 0.85 * n;
}
// the shop's yearly sales at the start, and where its customers come from
export function retailOf(lot, s) {
  if (!RT) return null;
  let r = RT.cache.get(s);
  if (r !== undefined) return r;
  const cls = classOf(s);
  if (!cls) { RT.cache.set(s, null); return null; }
  const k = norm(s.n);
  let best = null, bd = 1e9;
  if (k.length >= 3 && lot) {
    for (const st of RT.stores) {
      const d = Math.hypot(st.x - lot.cx, st.y - lot.cy);
      if (d > 30 || d >= bd) continue; // within ~480 m of the lot's middle (Arsenal Yards is big)
      if (sameName(k, st.key)) { best = st; bd = d; }
    }
  }
  if (best) r = { ...best, real: true };
  else {
    const t = RT.typ[cls] || RT.typ.specialty;
    const f = (s.chain && t.chain) || (s.sig ? t.sig : t.indie);
    r = { n: s.n, cls, chain: !!s.chain, sales: f.sales * (s.chain && !t.chain ? 3 : 1), out: f.out, far: f.far, real: false };
  }
  RT.cache.set(s, r);
  return r;
}
// a would-be tenant's figures (the lease window's applicants)
export const retailFor = (a) => retailOf(null, a);

// the whole town this month: sales follow each shop's revenue (foot traffic, street life, online shopping)
export function retailNow(sim) {
  if (!RT) return null;
  const T = { sales: 0, out: 0, far: 0, outChain: 0, outIndie: 0, farChain: 0, farIndie: 0, shops: 0, real: 0, top: [] };
  for (const lot of sim.w.lots) {
    if (!lot.sf || !lot.sf.length || lot.dead) continue;
    let m = null;
    for (const s of lot.sf) {
      if (s.popup) continue;
      const r = retailOf(lot, s);
      if (!r) continue;
      m = m || lotMarket(sim, lot, undefined, 1); // the year's sales: leave out this month's weather
      const f = Math.max(0.2, shopMargin(sim, lot, s, m).rev);
      const sales = r.sales * f, out = sales * r.out, far = sales * r.far;
      T.sales += sales; T.out += out; T.far += far; T.shops++;
      if (r.real) T.real++;
      if (s.chain) { T.outChain += out; T.farChain += far; } else { T.outIndie += out; T.farIndie += far; }
      T.top.push({ n: s.n, lot: lot.id, chain: !!s.chain, sig: !!s.sig, sales, out, far, farPct: r.far });
    }
  }
  T.top.sort((a, b) => b.far - a.far);
  T.top = T.top.slice(0, 8);
  return T;
}
export function retailMonthly(sim) {
  const T = retailNow(sim);
  if (!T) return;
  sim.retail = { sales: T.sales, out: T.out, far: T.far, outChain: T.outChain, outIndie: T.outIndie, farChain: T.farChain, farIndie: T.farIndie, shops: T.shops, real: T.real };
  if (!sim.retail0) sim.retail0 = { ...sim.retail, t: sim.t };
}

// one shop, in words, for Why?
export function retailLine(lot, s, sim) {
  const r = retailOf(lot, s);
  if (!r) return null;
  const f = sim ? Math.max(0.2, shopMargin(sim, lot, s, lotMarket(sim, lot, undefined, 1)).rev) : 1;
  const $ = (v) => (v >= 1e6 ? `$${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1)}M` : `$${Math.round(v / 1e4) * 10}K`);
  const reach = r.far >= 0.4 ? 'a destination: most of its customers drive past plenty of other options to get here' : r.far >= 0.2 ? 'people come from across the area' : r.out >= 0.6 ? 'mostly a neighborhood shop, for Watertown and the towns next door' : 'mostly a Watertown shop';
  return `Sales around ${$(r.sales * f)} a year (${r.real ? 'an estimate for this store' : `typical for its kind`}); ${Math.round(r.out * 100)}% from outside Watertown, ${Math.round(r.far * 100)}% from 8 km or more away: ${reach}.`;
}
export const fmtM = (v) => `$${(v / 1e6).toFixed(v >= 1e8 ? 0 : 1)}M`;
