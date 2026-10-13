// Street-life ("vibrancy") model.
// Every business and every lot contributes "frontage": independent cafés, restaurants and shops
// create life; offices a little; auto-oriented uses (repair, dealers, gas, car washes, parking lots)
// are dead frontage. Chains count for less than independents. A walking-distance kernel spreads
// frontage into a field, scaled by how many people live nearby to actually use it.
import { ZONE, COVER } from './config.js';

// Well-known national/regional chains (heuristic; OSM/Overture `brand` tags also mark chains).
export const CHAIN_RE =
  /\b(dunkin|starbucks|cvs|walgreens|rite aid|mcdonald|burger king|wendy|taco bell|kfc|chick-fil-a|popeyes|subway|domino|pizza hut|papa john|little caesars|chipotle|panera|sweetgreen|cava|qdoba|five guys|shake shack|panda express|wingstop|dairy queen|ihop|applebee|olive garden|bertucci|not your average joe|peet'?s|stop & shop|star market|shaw'?s|market basket|whole foods|trader joe|wegmans|aldi|target|walmart|costco|home depot|lowe'?s|best buy|staples|petco|petsmart|marshalls|tj ?maxx|homegoods|old navy|ulta|sephora|t-mobile|verizon|at&t|boost mobile|metro by t|h&r block|jiffy lube|midas|meineke|firestone|autozone|advance auto|napa auto|pep boys|valvoline|mobil|shell|gulf|sunoco|citgo|exxon|speedway|irving|7-eleven|cumberland farms|bank of america|santander|citizens bank|td bank|chase|wells fargo|keybank|planet fitness|orangetheory|crunch fitness|la fitness|anytime fitness|supercuts|great clips|sport clips|century 21|re\/max|coldwell banker|keller williams|dollar tree|family dollar|total wine|enterprise rent|hertz|avis|u-haul|radioshack|gamestop|lenscrafters|visionworks|massage envy|european wax|the ups store|mattress firm|sleep number|ikea|toyota of|honda of|best western|marriott|hilton|hampton inn|residence inn|courtyard)\b/i;

const NOT_BIZ = /^(atm|bicycle_rental|charging_station|vending_machine|post_box|bench|toilets|parking_entrance|bicycle_parking|telephone|drinking_water|waste_basket|recycling|shelter|bus_station|taxi)$|bitcoin|bluebikes/i;
const AUTO = /auto|^car$|car_|_car|fuel|gas_station|tire|tyre|parking|vehicle|motorcycle|oil_change|towing|body_shop|truck/i;
const FOOD = /restaurant|eatery|cafe|coffee|bakery|^bar$|_bar|bar_|pub|pizza|fast_food|food_court|ice_cream|dessert|deli|tea_|brew|bistro|grill|diner|juice|donut|bagel|sandwich|food_and_beverage|butcher|seafood|cheese|chocolate|confection|biergarten/i;
const RETAIL = /store|shop|boutique|book|clothes|apparel|gift|florist|flower|hardware|grocery|market|supermarket|convenience|pharmacy|chemist|jewel|toy|music|antique|furniture|bicycle$|pet|alcohol|wine|cannabis|variety|department|mall|shopping|cosmetics|optician|records|tiles|electronics|fabric|craft|stationery|second_hand|thrift|kiosk/i;
const SERVICE = /beauty|hairdresser|barber|salon|nail|laundry|dry_clean|tailor|spa|fitness|gym|yoga|studio|dance|bank|post_office|cinema|theat|museum|gallery|arts|entertainment|bowling|climb|club|hotel|music_venue|nightclub|veterinar|animal/i;
const CIVIC = /library|community|social|worship|church|place_of_learning|school|civic|food_bank|town_?hall|government|historic/i;

export const CAT_WEIGHT = { food: 1.0, retail: 0.85, service: 0.45, civic: 0.25, office: 0.12, auto: -0.7, none: 0 };
export const CAT_LABEL = { food: 'Food & drink', retail: 'Shop', service: 'Services', civic: 'Civic', office: 'Office', auto: 'Auto-oriented', none: '' };

export function bizCategory(kind = '', name = '') {
  const k = String(kind || '');
  if (NOT_BIZ.test(k) || NOT_BIZ.test(name)) return 'none';
  if (AUTO.test(k)) return 'auto';
  if (FOOD.test(k)) return 'food';
  if (RETAIL.test(k)) return 'retail';
  if (SERVICE.test(k)) return 'service';
  if (CIVIC.test(k)) return 'civic';
  if (!k && /auto|tire|collision|car wash|motors|garage|gas\b|fuel|lube/i.test(name)) return 'auto';
  return 'office';
}
export const isChain = (name = '', brand = '') => !!brand || CHAIN_RE.test(name);
// "Signature" independents: coffee, books, boutiques, galleries, records, bakeries… the places people mean by vibrancy.
const SIG_RE = /cafe|coffee|tea_|book|boutique|cloth|apparel|fashion|gift|vintage|second_hand|thrift|art|gallery|record|music|bakery|florist|flower|wine|cheese|toy|craft|antique|bistro|dessert|ice_cream|chocolate|bicycle/i;
export const isSignature = (kind, name, chain) => !chain && (SIG_RE.test(kind || '') || /books|bakery|café|cafe|coffee|gallery|records|vintage/i.test(name || ''));

// MA DOR auto-oriented commercial use codes: 330 sales, 331 supplies, 332 repair, 333 fuel, 334 service station,
// 335 car wash, 336 parking garage, 337 parking lot, 338 other motor vehicle.
export const autoUse = (code3) => /^33[0-8]$/.test(code3 || '');

// Prepare per-lot business categories once (and again whenever a lot's businesses change).
export function classifyLot(lot) {
  const n = lot.biz ? lot.biz.length : 0;
  lot.bizCat = new Array(n);
  lot.bizChainF = new Array(n);
  lot.bizSig = new Array(n);
  for (let k = 0; k < n; k++) {
    const kind = lot.bizKind && lot.bizKind[k];
    lot.bizCat[k] = bizCategory(kind, lot.biz[k]);
    lot.bizChainF[k] = (lot.bizChain && lot.bizChain[k]) || isChain(lot.biz[k]) ? 1 : 0;
    lot.bizSig[k] = ['food', 'retail', 'service'].includes(lot.bizCat[k]) && isSignature(kind, lot.biz[k], lot.bizChainF[k]) ? 1 : 0;
  }
  lot.auto = autoUse(lot.code3) || (n > 0 && lot.bizCat.filter((c) => c === 'auto').length * 2 > lot.bizCat.filter((c) => c !== 'none').length);
}

// Frontage score for one lot: positive = street life, negative = dead frontage.
export function frontage(lot, world) {
  if (lot.dead || lot.under) return lot.under ? -0.2 : 0;
  let f = 0, cnt = 0;
  const n = lot.biz ? lot.biz.length : 0;
  if (n && !lot.bizCat) classifyLot(lot);
  for (let k = 0; k < n && cnt < 5; k++) {
    const c = lot.bizCat[k];
    if (c === 'none') continue;
    f += CAT_WEIGHT[c] * (lot.bizChainF[k] && CAT_WEIGHT[c] > 0 ? 0.45 : 1) * (lot.bizSig && lot.bizSig[k] ? 1.6 : 1);
    cnt++;
  }
  if (lot.vacant) f -= 0.35 * Math.min(3, lot.vacant); // dark storefronts
  if (lot.auto && !n) f -= lot.code3 === '337' ? 0.9 : 1.2;
  else if (lot.auto) f -= 0.4;
  if (lot.zone === ZONE.C && lot.occ < 0.5) f -= 0.35; // empty storefronts
  if (lot.zone === ZONE.C && !lot.bldgs.length && world.cover[lot.tiles[0]] === COVER.PAVED) f -= 0.3;
  return f * (lot.zone === ZONE.C || lot.zone === ZONE.I || lot.mixed || n ? 1 : 0.5) * Math.max(0.3, lot.occ);
}
