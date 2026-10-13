// Shared by the browser and tools/fetch-data.mjs (no DOM use here).
// Defines the data queries and a compact, delta-encoded snapshot format that
// expands back into the same "raw" shape the live download produces.
import { CFG } from './config.js';

export const SNAPSHOT_PATH = 'data/watertown.json.gz';

export function overpassQuery(b = CFG.FETCH_BBOX) {
  const bb = `${b.s},${b.w},${b.n},${b.e}`;
  return `[out:json][timeout:240][maxsize:1073741824];
(
  rel["boundary"="administrative"]["admin_level"="8"]["name"="${CFG.TOWN_NAME}"](${bb});
  way["building"](${bb});
  rel["building"](${bb});
  way["highway"](${bb});
  way["waterway"](${bb});
  way["natural"~"^(water|wood|wetland|scrub|grassland)$"](${bb});
  rel["natural"="water"](${bb});
  rel["waterway"="riverbank"](${bb});
  way["landuse"](${bb});
  rel["landuse"](${bb});
  way["leisure"](${bb});
  rel["leisure"](${bb});
  way["amenity"](${bb});
  node["amenity"](${bb});
  node["shop"](${bb});
  way["shop"](${bb});
  node["office"](${bb});
  node["craft"](${bb});
  node["tourism"](${bb});
  node["healthcare"](${bb});
  node["natural"="tree"](${bb});
);
out geom;`;
}

// Assessor fields the game uses. Owner fields are deliberately never requested.
export const PARCEL_FIELDS = [
  'OBJECTID', 'LOC_ID', 'MAP_PAR_ID', 'TOWN_ID', 'BLDG_VAL', 'LAND_VAL', 'OTHER_VAL', 'TOTAL_VAL', 'FY',
  'LOT_SIZE', 'LOT_UNITS', 'USE_CODE', 'USE_DESC', 'SITE_ADDR', 'ZONING', 'YEAR_BUILT', 'BLD_AREA',
  'UNITS', 'RES_AREA', 'STYLE', 'STORIES', 'NUM_ROOMS',
];

// OSM tags the world builder reads.
const KEEP_TAGS = new Set([
  'name', 'building', 'building:levels', 'height', 'roof:levels', 'building:colour', 'roof:colour', 'roof:shape', 'building:material',
  'highway', 'area', 'tunnel', 'service', 'waterway', 'natural', 'water', 'landuse', 'leisure', 'parking',
  'amenity', 'shop', 'office', 'craft', 'tourism', 'healthcare', 'boundary', 'admin_level', 'type', 'place_cat', 'src',
]);

const Q = 1e6;
function enc(pts, latKey, lonKey) {
  // pts: array of objects or [a,b] pairs -> flat delta-encoded ints [a0,b0,da,db,...]
  const out = [];
  let pa = 0, pb = 0;
  for (const p of pts) {
    if (!p) continue;
    const a = Math.round((latKey ? p[latKey] : p[0]) * Q);
    const b = Math.round((lonKey ? p[lonKey] : p[1]) * Q);
    out.push(a - pa, b - pb);
    pa = a;
    pb = b;
  }
  return out;
}
function dec(flat) {
  const out = [];
  let a = 0, b = 0;
  for (let i = 0; i + 1 < flat.length; i += 2) {
    a += flat[i];
    b += flat[i + 1];
    out.push([a / Q, b / Q]);
  }
  return out;
}
function keepTags(t) {
  if (!t) return {};
  const o = {};
  for (const [k, v] of Object.entries(t)) if (KEEP_TAGS.has(k)) o[k] = v;
  return o;
}

// Bounding box of the town boundary relation, expanded by `marginM` metres.
export function townCrop(osm, marginM) {
  const rel = osm.find(
    (e) => e.type === 'relation' && e.tags && e.tags.boundary === 'administrative' && e.tags.name === CFG.TOWN_NAME && String(e.tags.admin_level) === '8'
  );
  if (!rel) return null;
  let s = 90, n = -90, w = 180, e = -180;
  for (const m of rel.members || [])
    for (const p of m.geometry || []) {
      if (!p) continue;
      s = Math.min(s, p.lat); n = Math.max(n, p.lat);
      w = Math.min(w, p.lon); e = Math.max(e, p.lon);
    }
  const latC = ((s + n) / 2) * (Math.PI / 180);
  const dLat = marginM / 110574, dLon = marginM / (111320 * Math.cos(latC));
  return { s: s - dLat, n: n + dLat, w: w - dLon, e: e + dLon };
}

// raw {osm, parcels, ...} -> compact JSON-able object. Elements wholly outside `crop` are dropped
// (relations are kept whole so their rings stay closed).
export function compactRaw(raw, crop = null) {
  const inC = (lat, lon) => !crop || (lat >= crop.s && lat <= crop.n && lon >= crop.w && lon <= crop.e);
  const anyIn = (geo) => !crop || geo.some((p) => p && inC(p.lat, p.lon));
  const nodes = [], ways = [], rels = [];
  for (const e of raw.osm) {
    const tags = keepTags(e.tags);
    if (e.type === 'node') {
      if (e.lat == null || !inC(e.lat, e.lon)) continue;
      nodes.push([Math.round(e.lat * Q), Math.round(e.lon * Q), tags]);
    } else if (e.type === 'way') {
      if (!e.geometry || !anyIn(e.geometry)) continue;
      ways.push([tags, enc(e.geometry, 'lat', 'lon')]);
    } else if (e.type === 'relation') {
      const ms = (e.members || []).filter((m) => m.type === 'way' && Array.isArray(m.geometry));
      if (!ms.length || !ms.some((m) => anyIn(m.geometry))) continue;
      rels.push([tags, ms.map((m) => [m.role || '', enc(m.geometry, 'lat', 'lon')])]);
    }
  }
  const parcels = [];
  for (const f of raw.parcels || []) {
    if (!f.geometry) continue;
    const g = f.geometry;
    const rings = g.type === 'Polygon' ? g.coordinates : g.type === 'MultiPolygon' ? g.coordinates.flat() : [];
    if (!rings.length) continue;
    const props = {};
    for (const k of PARCEL_FIELDS) {
      const v = f.properties ? f.properties[k] : null;
      if (v !== null && v !== undefined && v !== '') props[k] = v;
    }
    parcels.push([props, rings.map((r) => enc(r.map(([lon, lat]) => [lat, lon])))]);
  }
  return {
    v: 1,
    fetched: raw.fetched || new Date().toISOString(),
    parcelError: raw.parcelError || null,
    sources: raw.sources || null,
    crop,
    nodes,
    ways,
    rels,
    parcels,
  };
}

// compact -> raw shape consumed by buildWorld()
export function expandSnapshot(s) {
  const osm = [];
  for (const [lat, lon, tags] of s.nodes) osm.push({ type: 'node', lat: lat / Q, lon: lon / Q, tags });
  for (const [tags, flat] of s.ways) osm.push({ type: 'way', tags, geometry: dec(flat).map(([lat, lon]) => ({ lat, lon })) });
  for (const [tags, ms] of s.rels)
    osm.push({ type: 'relation', tags, members: ms.map(([role, flat]) => ({ type: 'way', role, geometry: dec(flat).map(([lat, lon]) => ({ lat, lon })) })) });
  const parcels = s.parcels.map(([properties, rings]) => ({
    type: 'Feature',
    properties,
    geometry: { type: 'Polygon', coordinates: rings.map((r) => dec(r).map(([lat, lon]) => [lon, lat])) },
  }));
  return { osm, parcels, parcelError: s.parcelError, fetched: s.fetched, sources: s.sources || null, source: 'snapshot' };
}
