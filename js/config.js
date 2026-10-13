// Global configuration for Townies.
export const CFG = {
  // Area downloaded from OpenStreetMap (generous box around Watertown, MA).
  FETCH_BBOX: { s: 42.343, w: -71.218, n: 42.394, e: -71.138 },
  TOWN_NAME: 'Watertown',
  TOWN_ID: 314, // MassGIS town identifier for Watertown
  TILE_M: 16, // metres per tile edge (true scale)
  MARGIN_M: 450, // neighbouring-town margin kept around the town line
  CHUNK: 16, // tiles per render chunk edge
  HS: 1.15, // screen px per metre of height at zoom 1 (slight SC2000 exaggeration)
  FLOOR_M: 3.3,
  OVERPASS: [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  ],
  PARCELS:
    'https://services1.arcgis.com/hGdibHYSPO59RG1h/arcgis/rest/services/Massachusetts_Property_Tax_Parcels/FeatureServer/0/query',
  SQUARE: { lat: 42.3649, lon: -71.1856 }, // Watertown Square, start camera here
  START: { y: 2027, m: 0 },
  RAW_KEY: 'raw-v1',
  SAVE_KEY: 'save-v1',
  // Approximate starting tax rates ($ per $1,000 of assessed value).
  RATE_RES: 11.0,
  RATE_CIP: 22.0,
};

export const ZONE = { NONE: 0, R: 1, C: 2, I: 3, CIVIC: 4, PARK: 5 };
export const ZONE_NAME = ['Unzoned', 'Residential', 'Commercial', 'Industrial / R&D', 'Civic / exempt', 'Open space'];
export const ZONE_COLOR = ['#888', '#5fd35f', '#5f9fff', '#f0c840', '#d88aff', '#3faf5f'];

export const COVER = { GRASS: 0, PARK: 1, WOOD: 2, PAVED: 3, CEMETERY: 4, SPORT: 5, WETLAND: 6 };

export const ROAD_NAME = ['', 'Street', 'Collector', 'Arterial'];

// Civic facilities you can place.
//  - `radius` + `fund` key  -> emergency coverage (police / fire / school), handled in sim.computeMaps.
//  - `effect` -> a "special structure": a one-off civic amenity (SimCity rewards). Fields:
//      lvRadius / lvAmt   land-value halo (grid tiles, strength) around the building
//      approval { faction|all: points }   standing approval offset while it stands & is funded
//      upkeep             annual operating cost added to the budget as a recurring line
//      glyph              rooftop marker drawn by the renderer
//      levels             storeys (height) for the footprint
export const SERVICES = {
  police: { label: 'Police station', size: 3, cost: 12e6, radius: 130, color: '#3a5fbf', glyph: '★', levels: 2 },
  fire: { label: 'Fire station', size: 3, cost: 9e6, radius: 95, color: '#c8352b', glyph: '✚', levels: 2 },
  school: { label: 'School', size: 5, cost: 45e6, radius: 60, color: '#b8643f', glyph: '✎', levels: 3 },
  hospital: {
    label: 'Hospital', size: 5, cost: 60e6, color: '#d6e2ea', glyph: '✚', levels: 6,
    effect: { lvRadius: 48, lvAmt: 0.1, approval: { all: 5, seniors: 10 }, upkeep: 4.5e6 },
  },
  clinic: {
    label: 'Community clinic', size: 3, cost: 14e6, color: '#cfe0d8', glyph: '✚', levels: 2,
    effect: { lvRadius: 26, lvAmt: 0.06, approval: { seniors: 6, renters: 3 }, upkeep: 1.1e6 },
  },
  library: {
    label: 'Library', size: 3, cost: 18e6, color: '#c8a86a', glyph: '📖', levels: 2,
    effect: { lvRadius: 34, lvAmt: 0.09, approval: { all: 4, homeowners: 5 }, upkeep: 0.9e6 },
  },
  firehouse: {
    label: 'Firehouse (historic)', size: 2, cost: 7e6, color: '#a6402f', glyph: '✚', levels: 2,
    radius: 70, fund: 'fire',
    effect: { lvRadius: 18, lvAmt: 0.05, approval: { all: 2 }, upkeep: 0.5e6 },
  },
  museum: {
    label: 'Museum', size: 4, cost: 30e6, color: '#b9a9c9', glyph: '🏛', levels: 3,
    effect: { lvRadius: 40, lvAmt: 0.12, approval: { all: 4, business: 6 }, upkeep: 1.6e6 },
  },
  stadium: {
    label: 'Stadium', size: 7, cost: 120e6, color: '#7f8a93', glyph: '◉', levels: 5,
    effect: { lvRadius: 60, lvAmt: 0.08, approval: { all: 6, business: 10, commuters: -4 }, upkeep: 6e6 },
  },
};

// Types that are "special structures" (civic amenities) rather than plain coverage services.
export const SPECIAL = Object.keys(SERVICES).filter((k) => SERVICES[k].effect);
