// A Walk Score–style walkability index, rebuilt from open data (not Walk Score's data).
// Structure follows Walk Score's published approach: distance to nine everyday amenity types with
// diminishing returns per extra place, full credit within a 5-minute walk (¼ mile), fading to about
// 12% at 1 mile and nothing past 1.5 miles, and a pedestrian-friendliness penalty for sparse street
// grids. Category weights follow those used in academic replications of the original method.
// Shared by the game (js/sim.js) and the data build (tools/fetch-data.mjs).
export const WALK_WEIGHTS = {
  grocery: [3],
  restaurants: [0.75, 0.45, 0.25, 0.25, 0.225, 0.225, 0.225, 0.225, 0.2, 0.2],
  shopping: [0.5, 0.45, 0.4, 0.35, 0.3],
  coffee: [1.25, 0.75],
  banks: [1],
  parks: [1],
  schools: [1],
  books: [1],
  entertainment: [1],
};
export const WALK_TOTAL = Object.values(WALK_WEIGHTS).reduce((s, a) => s + a.reduce((x, y) => x + y, 0), 0);

const MILE = 1609.34;
// straight-line distances are stretched to approximate walking-route distance
export const ROUTE_DETOUR = 1.25;
export function decay(m) {
  const mi = m / MILE;
  if (mi <= 0.25) return 1;
  if (mi <= 1) return 1 - 0.88 * Math.pow((mi - 0.25) / 0.75, 0.9);
  if (mi <= 1.5) return 0.12 * (1 - (mi - 1) / 0.5);
  return 0;
}

// map an OSM/Overture business kind (+ name) to a Walk Score amenity category
export function walkCat(kind = '', name = '') {
  const k = String(kind || '').toLowerCase();
  const n = String(name || '').toLowerCase();
  if (/supermarket|grocery|greengrocer|food_and_beverage_store|organic|^market$|butcher|seafood_market/.test(k)) return 'grocery';
  if (/cafe|coffee|tea_room|tea_house|bubble_tea/.test(k)) return 'coffee';
  if (/restaurant|fast_food|eatery|^bar$|_bar$|^bar_|pub|pizza|diner|grill|bistro|food_court|brewery|biergarten|ice_cream|dessert|bakery|deli/.test(k)) return 'restaurants';
  if (/book|library/.test(k)) return 'books';
  if (/^bank|bank$|credit_union|bank_or_credit/.test(k)) return 'banks';
  if (/cinema|theat|music_venue|museum|bowling|arts_centre|art_gallery|nightclub|comedy|arcade|entertainment|concert|escape/.test(k)) return 'entertainment';
  if (/^school$|primary|elementary|middle_school|high_school|kindergarten|preschool/.test(k)) return 'schools';
  if (/convenience|atm|fuel|gas|car|auto|parking|bicycle_rental|charging/.test(k)) return null;
  if (/store|shop|boutique|clothes|apparel|gift|florist|flower|hardware|pharmacy|chemist|jewel|toy|music|antique|furniture|bicycle|pet|alcohol|wine|variety|department|mall|cosmetics|optician|record|electronics|fabric|craft|stationery|second_hand|thrift|beauty_supply|shoes|sports/.test(k)) return 'shopping';
  if (!k && /books\b/.test(n)) return 'books';
  return null;
}

// Pedestrian friendliness: intersections per square mile (within ~½ mile) -> penalty up to 10%.
export function pedPenalty(intersPerSqMi) {
  if (intersPerSqMi >= 200) return 0;
  if (intersPerSqMi <= 50) return 0.1;
  return 0.1 * ((200 - intersPerSqMi) / 150);
}

// cats: { category: [distanceInMeters, ...] } (unsorted is fine)
export function walkScore(cats, intersPerSqMi = 200) {
  let pts = 0;
  for (const [c, ws] of Object.entries(WALK_WEIGHTS)) {
    const ds = (cats[c] || []).slice().sort((a, b) => a - b);
    for (let k = 0; k < ws.length && k < ds.length; k++) pts += ws[k] * decay(ds[k] * ROUTE_DETOUR);
  }
  const raw = (100 * pts) / WALK_TOTAL;
  return Math.round(Math.max(0, Math.min(100, raw * (1 - pedPenalty(intersPerSqMi)))));
}

export const walkLabel = (s) => (s >= 90 ? "Walker's Paradise" : s >= 70 ? 'Very Walkable' : s >= 50 ? 'Somewhat Walkable' : s >= 25 ? 'Car-Dependent' : 'Very Car-Dependent');
