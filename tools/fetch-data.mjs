#!/usr/bin/env node
// Builds data/watertown.json.gz, the map snapshot the game loads.
//   Map:        OpenStreetMap via a Geofabrik extract (pre-cut to OPL by osmium in the workflow),
//               falling back to the Overpass API if no extract is supplied.
//   Parcels:    MassGIS statewide property tax parcels (assessed values, use, year, style...).
//   Footprints: MassGIS Building Structures, used to fill in buildings missing from OSM.
//   Businesses: Overture Maps places (pre-downloaded GeoJSON), merged with OSM points of interest.
// Flags: --opl <file>  --places <file>  --demo  --out <path>  --no-massgis
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CFG } from '../js/config.js';
import { overpassQuery, PARCEL_FIELDS, compactRaw, townCrop, SNAPSHOT_PATH } from '../js/snapshot.js';

const args = process.argv.slice(2);
const arg = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : null);
const DEMO = args.includes('--demo');
const OUT = arg('--out') || SNAPSHOT_PATH;
const OPL = arg('--opl');
const PLACES = arg('--places');
const NO_MASSGIS = args.includes('--no-massgis');
const LOG = dirname(OUT) + '/refresh-log.txt';
const UA = 'Townies/1.0 (city sim; https://github.com/samuelling/Townies)';
const STRUCTURES = 'https://services1.arcgis.com/hGdibHYSPO59RG1h/arcgis/rest/services/Building_Structures/FeatureServer/0/query';
const OVERPASS = [...CFG.OVERPASS, 'https://overpass.private.coffee/api/interpreter'];
const lines = [];
const log = (...m) => {
  const s = `[${new Date().toISOString()}] ${m.join(' ')}`;
  console.log(s);
  lines.push(s);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function writeLog(ok) {
  mkdirSync(dirname(LOG), { recursive: true });
  writeFileSync(LOG, `${ok ? 'OK' : 'FAILED'}\n${lines.join('\n')}\n`);
}

// ---------------------------------------------------------------- OSM: Geofabrik/osmium OPL
const NAT = new Set(['water', 'wood', 'wetland', 'scrub', 'grassland']);
// Same selection as the Overpass query in js/snapshot.js
function wanted(type, t) {
  if (type === 'r' && t.boundary === 'administrative' && String(t.admin_level) === '8' && t.name === CFG.TOWN_NAME) return true;
  if (type !== 'n' && t.building) return true;
  if (type === 'w' && (t.highway || t.waterway)) return true;
  if (type === 'w' && t.natural && NAT.has(t.natural)) return true;
  if (type === 'r' && (t.natural === 'water' || t.waterway === 'riverbank')) return true;
  if (type !== 'n' && (t.landuse || t.leisure)) return true;
  if (type !== 'r' && (t.amenity || t.shop)) return true;
  if (type === 'n' && (t.office || t.craft || t.tourism || t.healthcare || t.natural === 'tree')) return true;
  return false;
}
const unesc = (s) => s.replace(/%([0-9a-fA-F]+)%/g, (_, h) => String.fromCodePoint(parseInt(h, 16)));
function parseTags(f) {
  const t = {};
  if (!f) return t;
  for (const kv of f.split(',')) {
    const i = kv.indexOf('=');
    if (i > 0) t[unesc(kv.slice(0, i))] = unesc(kv.slice(i + 1));
  }
  return t;
}
function parseOPL(file) {
  const text = readFileSync(file, 'utf8');
  const nodes = [], ways = new Map(), rels = [];
  for (const line of text.split('\n')) {
    if (!line) continue;
    const kind = line[0];
    const fields = line.split(' ');
    const id = fields[0].slice(1);
    let tags = {}, x = null, y = null, N = null, M = null;
    for (const f of fields.slice(1)) {
      const c = f[0], v = f.slice(1);
      if (c === 'T') tags = parseTags(v);
      else if (c === 'x') x = v === '' ? null : +v;
      else if (c === 'y') y = v === '' ? null : +v;
      else if (c === 'N') N = v;
      else if (c === 'M') M = v;
    }
    if (kind === 'n') {
      if (x != null && y != null && Object.keys(tags).length) nodes.push({ id, lat: y, lon: x, tags });
    } else if (kind === 'w') {
      const geometry = [];
      if (N)
        for (const ref of N.split(',')) {
          const m = /^n-?\d+x(-?[\d.]+)y(-?[\d.]+)$/.exec(ref);
          if (m) geometry.push({ lat: +m[2], lon: +m[1] });
        }
      ways.set(id, { tags, geometry });
    } else if (kind === 'r') {
      const members = [];
      if (M)
        for (const mm of M.split(',')) {
          const m = /^([nwr])(-?\d+)@(.*)$/.exec(mm);
          if (m) members.push({ type: m[1], ref: m[2], role: unesc(m[3]) });
        }
      rels.push({ id, tags, members });
    }
  }
  const out = [];
  for (const n of nodes) if (wanted('n', n.tags)) out.push({ type: 'node', lat: n.lat, lon: n.lon, tags: n.tags });
  for (const w of ways.values()) if (w.geometry.length >= 2 && Object.keys(w.tags).length && wanted('w', w.tags)) out.push({ type: 'way', tags: w.tags, geometry: w.geometry });
  for (const r of rels) {
    if (!wanted('r', r.tags)) continue;
    const members = [];
    for (const m of r.members) {
      if (m.type !== 'w') continue;
      const w = ways.get(m.ref);
      if (w && w.geometry.length >= 2) members.push({ type: 'way', role: m.role, geometry: w.geometry });
    }
    if (members.length) out.push({ type: 'relation', tags: r.tags, members });
  }
  log(`OPL ${file}: ${nodes.length} tagged nodes, ${ways.size} ways, ${rels.length} relations -> ${out.length} elements kept`);
  return out;
}

// ---------------------------------------------------------------- OSM: Overpass fallback
async function fetchOverpass() {
  const body = 'data=' + encodeURIComponent(overpassQuery(CFG.FETCH_BBOX));
  for (const url of OVERPASS) {
    try {
      log(`Overpass: ${url}`);
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA, Accept: 'application/json' },
        body,
        signal: AbortSignal.timeout(150000),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
      const j = await r.json();
      if (!j.elements || j.elements.length < 1000) throw new Error(`only ${j.elements ? j.elements.length : 0} elements`);
      log(`  got ${j.elements.length} elements`);
      return j.elements;
    } catch (e) {
      log(`  failed: ${e.message}`);
    }
  }
  throw new Error('All Overpass servers failed');
}

// ---------------------------------------------------------------- MassGIS (ArcGIS feature services)
async function arcgis(url, params) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
        body: new URLSearchParams(params).toString(),
        signal: AbortSignal.timeout(120000),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      if (j.error) throw new Error(`${j.error.code}: ${j.error.message} ${(j.error.details || []).join(' ')}`);
      return j;
    } catch (e) {
      log(`  MassGIS request failed (attempt ${attempt + 1}): ${e.message}`);
      await sleep(4000 * (attempt + 1));
    }
  }
  throw new Error('MassGIS unavailable');
}
async function arcgisAll(url, wheres, outFields, label) {
  let ids = null, where = null;
  for (const w of wheres) {
    try {
      const j = await arcgis(url, { where: w, returnIdsOnly: 'true', f: 'json' });
      const n = (j.objectIds || []).length;
      log(`${label}: ${n} ids for ${w}`);
      if (n > 100) {
        ids = j.objectIds.sort((a, b) => a - b);
        where = w;
        break;
      }
    } catch (e) {
      log(`  ${label} ${w}: ${e.message}`);
    }
  }
  if (!ids) throw new Error(`No ${label} ids returned`);
  const feats = [];
  const CH = 400;
  for (let i = 0; i < ids.length; i += CH) {
    const j = await arcgis(url, {
      objectIds: ids.slice(i, i + CH).join(','),
      outFields: outFields.join(','),
      returnGeometry: 'true',
      outSR: '4326',
      geometryPrecision: '6',
      f: 'geojson',
    });
    feats.push(...(j.features || []));
  }
  log(`${label}: ${feats.length} records (${where})`);
  return feats;
}
const fetchParcels = () =>
  arcgisAll(CFG.PARCELS, [`TOWN_ID=${CFG.TOWN_ID}`, `TOWN_ID='${CFG.TOWN_ID}'`, `CITY='${CFG.TOWN_NAME.toUpperCase()}'`], PARCEL_FIELDS, 'MassGIS parcels');
const fetchStructures = () =>
  arcgisAll(STRUCTURES, [`TOWN_ID=${CFG.TOWN_ID} AND (ARCHIVED IS NULL OR ARCHIVED <> 'Y')`, `TOWN_ID=${CFG.TOWN_ID}`], ['STRUCT_ID', 'SOURCEDATE', 'AREA_SQ_FT'], 'MassGIS footprints');

// ---------------------------------------------------------------- geometry helpers (lat/lon, small area)
function ringOf(geo) {
  return geo.map((p) => [p.lon, p.lat]);
}
function pip(ring, x, y) {
  let ins = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) ins = !ins;
  }
  return ins;
}
function centroid(ring) {
  let sx = 0, sy = 0, n = 0;
  for (const [x, y] of ring) {
    sx += x;
    sy += y;
    n++;
  }
  return [sx / n, sy / n];
}
function bboxOf(ring) {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (const [x, y] of ring) {
    if (x < a) a = x;
    if (y < b) b = y;
    if (x > c) c = x;
    if (y > d) d = y;
  }
  return [a, b, c, d];
}
class Grid {
  constructor(cell = 0.0005) {
    this.cell = cell;
    this.m = new Map();
  }
  key(x, y) {
    return `${Math.floor(x / this.cell)},${Math.floor(y / this.cell)}`;
  }
  add(bb, item) {
    for (let x = Math.floor(bb[0] / this.cell); x <= Math.floor(bb[2] / this.cell); x++)
      for (let y = Math.floor(bb[1] / this.cell); y <= Math.floor(bb[3] / this.cell); y++) {
        const k = `${x},${y}`;
        if (!this.m.has(k)) this.m.set(k, []);
        this.m.get(k).push(item);
      }
  }
  near(x, y) {
    return this.m.get(this.key(x, y)) || [];
  }
}

// MassGIS footprints that don't overlap any OSM building become extra buildings.
function gapFillBuildings(osm, structures) {
  const grid = new Grid();
  const osmB = [];
  for (const e of osm) {
    if (!e.tags || !e.tags.building) continue;
    const rings = e.type === 'way' ? [e.geometry] : (e.members || []).filter((m) => m.role !== 'inner').map((m) => m.geometry);
    for (const g of rings) {
      if (!g || g.length < 4) continue;
      const r = ringOf(g);
      const it = { r, c: centroid(r) };
      grid.add(bboxOf(r), it);
      osmB.push(it);
    }
  }
  let added = 0;
  for (const f of structures) {
    const g = f.geometry;
    if (!g) continue;
    const r0 = g.type === 'Polygon' ? g.coordinates[0] : g.type === 'MultiPolygon' ? g.coordinates[0][0] : null;
    if (!r0 || r0.length < 4) continue;
    if ((f.properties && f.properties.AREA_SQ_FT) < 150) continue;
    const [cx, cy] = centroid(r0);
    const bb = bboxOf(r0);
    let hit = false;
    for (const it of grid.near(cx, cy))
      if (pip(it.r, cx, cy)) {
        hit = true;
        break;
      }
    if (!hit)
      for (const it of grid.near(cx, cy)) {
        const [x, y] = it.c;
        if (x >= bb[0] && x <= bb[2] && y >= bb[1] && y <= bb[3] && pip(r0, x, y)) {
          hit = true;
          break;
        }
      }
    if (hit) continue;
    osm.push({ type: 'way', tags: { building: 'yes', src: 'massgis' }, geometry: r0.map(([lon, lat]) => ({ lat, lon })) });
    added++;
  }
  log(`MassGIS footprints: ${osmB.length} OSM buildings checked, ${added} missing buildings added`);
  return added;
}

// ---------------------------------------------------------------- Overture places
const parseMaybe = (v) => {
  if (typeof v !== 'string') return v;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
};
const norm = (s) => String(s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');
function mergePlaces(osm, file) {
  const fc = JSON.parse(readFileSync(file, 'utf8'));
  const feats = fc.features || [];
  // index named OSM points of interest
  const grid = new Grid(0.001);
  for (const e of osm) {
    const t = e.tags || {};
    if (!t.name || !(t.shop || t.amenity || t.office || t.craft || t.tourism || t.healthcare)) continue;
    let x, y;
    if (e.type === 'node') [x, y] = [e.lon, e.lat];
    else if (e.geometry) [x, y] = centroid(ringOf(e.geometry));
    else continue;
    grid.add([x, y, x, y], { n: norm(t.name), x, y });
  }
  let kept = 0, dup = 0, low = 0;
  for (const f of feats) {
    const p = f.properties || {};
    const g = f.geometry;
    if (!g || g.type !== 'Point') continue;
    const [lon, lat] = g.coordinates;
    const names = parseMaybe(p.names) || {};
    const name = names.primary || (typeof p.names === 'string' ? '' : '');
    if (!name) continue;
    const status = p.operating_status;
    const conf = p.confidence == null ? 0.6 : +p.confidence;
    if (status === 'permanently_closed' || status === 'closed' || conf < 0.5) {
      low++;
      continue;
    }
    const tax = parseMaybe(p.taxonomy) || {};
    const cats = parseMaybe(p.categories) || {};
    const cat = p.basic_category || tax.primary || cats.primary || '';
    if (/bridge|landmark|monument|structure|geograph|river|lake|pond|neighbo|^city$|street|road|highway|residential|apartment|condo|^park$|playground|trail|^home$/i.test(cat)) {
      low++;
      continue;
    }
    const n = norm(name);
    let isDup = false;
    for (let dx = -1; dx <= 1 && !isDup; dx++)
      for (let dy = -1; dy <= 1 && !isDup; dy++)
        for (const it of grid.near(lon + dx * 0.001, lat + dy * 0.001)) {
          if (Math.abs(it.x - lon) < 0.0012 && Math.abs(it.y - lat) < 0.0009 && (it.n === n || (n.length > 5 && (it.n.includes(n) || n.includes(it.n))))) {
            isDup = true;
            break;
          }
        }
    if (isDup) {
      dup++;
      continue;
    }
    osm.push({ type: 'node', lat, lon, tags: { name, place_cat: String(cat), src: 'overture' } });
    grid.add([lon, lat, lon, lat], { n, x: lon, y: lat });
    kept++;
  }
  log(`Overture places: ${feats.length} in file, ${kept} added, ${dup} already in OSM, ${low} closed/low-confidence skipped`);
  return kept;
}

// ---------------------------------------------------------------- main
async function main() {
  let raw;
  const sources = { osm: null, parcels: 0, footprintsAdded: 0, places: 0 };
  if (DEMO) {
    const { makeDemoRaw } = await import('../js/demo.js');
    raw = makeDemoRaw();
    sources.osm = 'demo';
    log('Using the procedural demo town');
  } else {
    let osm;
    if (OPL && existsSync(OPL)) {
      osm = parseOPL(OPL);
      sources.osm = 'geofabrik';
    } else {
      log(OPL ? `No OPL file at ${OPL}; falling back to Overpass` : 'No --opl given; using Overpass');
      osm = await fetchOverpass();
      sources.osm = 'overpass';
    }
    let parcels = null, parcelError = null;
    try {
      parcels = await fetchParcels();
      sources.parcels = parcels.length;
    } catch (e) {
      parcelError = e.message;
      log(`Parcels failed: ${e.message}`);
    }
    if (!NO_MASSGIS)
      try {
        sources.footprintsAdded = gapFillBuildings(osm, await fetchStructures());
      } catch (e) {
        log(`Footprint gap-fill skipped: ${e.message}`);
      }
    if (PLACES && existsSync(PLACES))
      try {
        sources.places = mergePlaces(osm, PLACES);
      } catch (e) {
        log(`Overture merge skipped: ${e.message}`);
      }
    else log('No Overture places file; businesses from OpenStreetMap only');
    raw = { osm, parcels, parcelError, fetched: new Date().toISOString() };
  }
  raw.sources = sources;
  const crop = townCrop(raw.osm, CFG.MARGIN_M + 150);
  if (!crop) throw new Error(`No boundary relation for ${CFG.TOWN_NAME} — refusing to write a snapshot`);
  const snap = compactRaw(raw, crop);
  const nB = snap.ways.filter((w) => w[0].building).length + snap.rels.filter((r) => r[0].building).length;
  const nR = snap.ways.filter((w) => w[0].highway).length;
  const nP = snap.nodes.filter((n) => n[2].name).length;
  log(`Kept ${snap.nodes.length} nodes (${nP} named places), ${snap.ways.length} ways (${nB} buildings, ${nR} streets/paths), ${snap.rels.length} relations, ${snap.parcels.length} parcels`);
  if (!DEMO) {
    if (nB < 2000) throw new Error(`Only ${nB} buildings — refusing to write a snapshot`);
    if (snap.parcels.length < 2000) throw new Error(`Only ${snap.parcels.length} parcels — refusing to overwrite the snapshot`);
  }
  const json = JSON.stringify(snap);
  const gz = gzipSync(json, { level: 9 });
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, gz);
  log(`Wrote ${OUT}: ${(json.length / 1e6).toFixed(1)} MB JSON, ${(gz.length / 1e6).toFixed(2)} MB gzipped. Sources: ${JSON.stringify(sources)}`);
}

export { parseOPL, gapFillBuildings, mergePlaces };
if (import.meta.url === pathToFileURL(process.argv[1]).href)
  main()
  .then(() => writeLog(true))
  .catch((e) => {
    log(`ERROR: ${e.stack || e.message}`);
    writeLog(false);
    process.exit(1);
  });
