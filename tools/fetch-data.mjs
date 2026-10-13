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
import { walkScore, walkCat, walkLabel } from '../js/walkscore.js';
import { bizCategory, isChain, isSignature } from '../js/vibrancy.js';
import { PEER_CENTERS, MIX_RADIUS_M } from '../js/peers.js';

const args = process.argv.slice(2);
const arg = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : null);
const DEMO = args.includes('--demo');
const OUT = arg('--out') || SNAPSHOT_PATH;
const OPL = arg('--opl');
const PLACES = arg('--places');
const REGION_OPL = arg('--region-opl');
const REGION_PLACES = arg('--region-places');
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
// street classes that count toward intersection density (not sidewalks, driveways or highways)
const STREET = new Set(['primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'living_street', 'pedestrian', 'primary_link', 'secondary_link', 'tertiary_link', 'trunk']);
function parseOPL(file, opts = {}) {
  const text = readFileSync(file, 'utf8');
  const nodes = [], ways = new Map(), rels = [];
  const degree = new Map(), nodeLoc = new Map();
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
      const street = STREET.has(tags.highway) && tags.area !== 'yes';
      if (N) {
        const refs = N.split(',');
        refs.forEach((ref, k) => {
          const m = /^n(-?\d+)x(-?[\d.]+)y(-?[\d.]+)$/.exec(ref);
          if (!m) return;
          geometry.push({ lat: +m[3], lon: +m[2] });
          if (street) {
            const end = k === 0 || k === refs.length - 1;
            degree.set(m[1], (degree.get(m[1]) || 0) + (end ? 1 : 2));
            nodeLoc.set(m[1], [+m[3], +m[2]]);
          }
        });
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
  const junctions = [];
  for (const [nid, d] of degree) if (d >= 3) junctions.push(nodeLoc.get(nid));
  out.junctions = junctions;
  log(`OPL ${file}: ${nodes.length} tagged nodes, ${ways.size} ways, ${rels.length} relations -> ${out.length} elements kept, ${junctions.length} street intersections`);
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

// ---------------------------------------------------------------- peer benchmarks
const R_EARTH = 6371000;
function meters(lat1, lon1, lat2, lon2) {
  const x = ((lon2 - lon1) * Math.PI) / 180 * Math.cos((((lat1 + lat2) / 2) * Math.PI) / 180);
  const y = ((lat2 - lat1) * Math.PI) / 180;
  return Math.hypot(x, y) * R_EARTH;
}
function poisFrom(osm, placesFile) {
  const pois = [];
  const parks = [];
  for (const e of osm) {
    const t = e.tags || {};
    let lat, lon;
    if (e.type === 'node') [lat, lon] = [e.lat, e.lon];
    else if (e.geometry && e.geometry.length) {
      const c = centroid(ringOf(e.geometry));
      [lon, lat] = c;
    } else if (e.members && e.members[0]) {
      const c = centroid(ringOf(e.members[0].geometry));
      [lon, lat] = c;
    } else continue;
    if (t.leisure === 'park' || t.leisure === 'playground' || t.leisure === 'nature_reserve' || t.landuse === 'recreation_ground') {
      const g = e.geometry || (e.members && e.members[0] && e.members[0].geometry) || [];
      parks.push(g.length ? g.filter((_, i) => i % 3 === 0).map((p) => [p.lat, p.lon]).concat([[lat, lon]]) : [[lat, lon]]);
      continue;
    }
    const kind = t.shop || t.amenity || t.office || t.craft || t.tourism || t.healthcare || t.leisure || '';
    if (!kind || (!t.name && !/school|library|cinema|theatre/.test(kind))) continue;
    pois.push({ lat, lon, kind, name: t.name || '', brand: t.brand || '' });
  }
  if (placesFile && existsSync(placesFile)) {
    const fc = JSON.parse(readFileSync(placesFile, 'utf8'));
    const seen = new Set(pois.map((p) => norm(p.name) + '@' + p.lat.toFixed(3) + ',' + p.lon.toFixed(3)));
    for (const f of fc.features || []) {
      const p = f.properties || {};
      if (!f.geometry || f.geometry.type !== 'Point') continue;
      const names = parseMaybe(p.names) || {};
      const name = names.primary;
      if (!name || p.operating_status === 'permanently_closed' || (p.confidence != null && +p.confidence < 0.5)) continue;
      const tax = parseMaybe(p.taxonomy) || {};
      const cats = parseMaybe(p.categories) || {};
      const brand = parseMaybe(p.brand) || {};
      const [lon, lat] = f.geometry.coordinates;
      const key = norm(name) + '@' + lat.toFixed(3) + ',' + lon.toFixed(3);
      if (seen.has(key)) continue;
      seen.add(key);
      pois.push({ lat, lon, kind: p.basic_category || tax.primary || cats.primary || '', name, brand: (brand.names && brand.names.primary) || '' });
    }
  }
  return { pois, parks };
}
function benchmarks(osm, junctions, placesFile) {
  const { pois, parks } = poisFrom(osm, placesFile);
  log(`Benchmarks: ${pois.length} places, ${parks.length} parks, ${junctions.length} intersections in the region`);
  const out = [];
  for (const c of PEER_CENTERS) {
    const cats = {};
    const mix = { storefronts: 0, food: 0, retail: 0, service: 0, sig: 0, chains: 0, auto: 0, offices: 0 };
    for (const p of pois) {
      const d = meters(c.lat, c.lon, p.lat, p.lon);
      if (d > 2414) continue;
      const wc = walkCat(p.kind, p.name);
      if (wc) (cats[wc] ||= []).push(d);
      if (d <= MIX_RADIUS_M) {
        const cat = bizCategory(p.kind, p.name);
        if (cat === 'auto') mix.auto++;
        else if (cat === 'office') mix.offices++;
        if (cat === 'food' || cat === 'retail' || cat === 'service') {
          mix.storefronts++;
          mix[cat]++;
          const ch = isChain(p.name, p.brand);
          if (ch) mix.chains++;
          else if (isSignature(p.kind, p.name, false)) mix.sig++;
        }
      }
    }
    for (const g of parks) {
      let best = Infinity;
      for (const [la, lo] of g) best = Math.min(best, meters(c.lat, c.lon, la, lo));
      if (best <= 2414) (cats.parks ||= []).push(best);
    }
    let inter = 0;
    for (const [la, lo] of junctions) if (meters(c.lat, c.lon, la, lo) <= 804.7) inter++;
    const perSqMi = inter / (Math.PI * 0.25);
    const ws = walkScore(cats, perSqMi);
    const areaKm2 = Math.PI * (MIX_RADIUS_M / 1000) ** 2;
    out.push({
      ...c, walk: ws, walkLabel: walkLabel(ws), interPerSqMi: Math.round(perSqMi),
      storefronts: mix.storefronts, perKm2: Math.round(mix.storefronts / areaKm2), sig: mix.sig, sigPerKm2: Math.round(mix.sig / areaKm2),
      chains: mix.chains, chainShare: mix.storefronts ? +(mix.chains / mix.storefronts).toFixed(2) : 0, auto: mix.auto, food: mix.food, retail: mix.retail, service: mix.service,
      sigShare: mix.storefronts ? +(mix.sig / mix.storefronts).toFixed(2) : 0,
    });
    log(`  ${c.name.padEnd(18)} walk ${ws} (${Math.round(perSqMi)} int/mi²) · ${mix.storefronts} storefronts in ${MIX_RADIUS_M} m · ${mix.sig} signature · ${mix.chains} chains · ${mix.auto} auto`);
  }
  return out;
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
      sources.junctions = osm.junctions.length;
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
    raw = { osm, parcels, parcelError, fetched: new Date().toISOString(), junctions: osm.junctions || null };
    if (REGION_OPL && existsSync(REGION_OPL)) {
      try {
        const reg = parseOPL(REGION_OPL);
        const peers = benchmarks(reg, reg.junctions, REGION_PLACES);
        writeFileSync(dirname(OUT) + '/peers.json', JSON.stringify({ generated: raw.fetched, radius: MIX_RADIUS_M, method: 'Walk Score-style index rebuilt from OpenStreetMap + Overture Maps; not Walk Score data.', centers: peers }, null, 1));
      } catch (e) {
        log(`Peer benchmarks skipped: ${e.stack || e.message}`);
      }
    } else log('No region extract; peer benchmarks not updated');
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
