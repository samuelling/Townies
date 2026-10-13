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

export const SERVICES = {
  police: { label: 'Police station', size: 3, cost: 12e6, radius: 130, color: '#3a5fbf' },
  fire: { label: 'Fire station', size: 3, cost: 9e6, radius: 95, color: '#c8352b' },
  school: { label: 'School', size: 5, cost: 45e6, radius: 60, color: '#b8643f' },
};
