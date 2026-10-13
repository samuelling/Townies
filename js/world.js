// Builds the playable tile world from raw OpenStreetMap + MassGIS parcel data.
import { CFG, ZONE, COVER } from './config.js';
import { makeProj, fillSegs, traverse, signedArea, centroid, simplify, obb, maxRect } from './geo.js';
import { hash2, median, percentile, titleCase } from './util.js';

const ROAD_CLASS = {
  motorway: 3, motorway_link: 3, trunk: 3, trunk_link: 3, primary: 3, primary_link: 3,
  secondary: 2, secondary_link: 2, tertiary: 2, tertiary_link: 2,
  residential: 1, unclassified: 1, living_street: 1, road: 1,
};
const PATHS = new Set(['footway', 'cycleway', 'path', 'pedestrian', 'bridleway', 'track']);
// Overture categories that aren't businesses
const NOT_BIZ = /bridge|landmark|monument|structure|geograph|river|lake|pond|neighbo|^city$|street|road|highway|residential|apartment|condo|^park$|playground|trail|^home$/i;
const SERVICE_AMEN = { police: 'police', fire_station: 'fire', school: 'school', library: 'library', townhall: 'townhall' };

export const PAL = {
  house: ['#e6dcc0', '#c9d8e2', '#efe9da', '#bccaa6', '#dcbfa5', '#e4d9b6', '#adbccc', '#d2c3da', '#f2ecd9', '#cfb08e', '#9fb9a8', '#e8c9a0'],
  houseRoof: ['#55565f', '#6b4b3c', '#4d596a', '#783f36', '#59625b', '#3f434a'],
  apt: ['#b5654a', '#c48a5d', '#a99f92', '#c9b9a0', '#9c5a46', '#d2c6b2'],
  shop: ['#ddd0b2', '#cbb89c', '#e3d5c2', '#bfa98d', '#d8c7a7'],
  office: ['#9fb3c8', '#b8c4ce', '#a6b8bf', '#c3cbd2'],
  ind: ['#c0bfb6', '#cbc4af', '#a9b2b6', '#b8b1a1'],
  lab: ['#cfd8de', '#b9c9d3', '#dfe3e2'],
  civic: ['#b0563f', '#a85b44', '#bd7756'],
  school: ['#b8643f', '#c27450'],
  church: ['#ece6d6', '#d9cdb5', '#b9624a'],
  garage: ['#a3a19b', '#b4b0a6'],
  flatRoof: ['#7d7c78', '#8a8780', '#6f6f70', '#9a958a'],
};
const DEFAULT_LEVELS = { house: 2.5, apt: 3.5, shop: 1.3, office: 3, ind: 2, lab: 3.5, civic: 2.5, school: 2.5, church: 2.5, garage: 1, police: 2, fire: 2 };

function kindFromTags(t) {
  const b = t.building;
  if (['house', 'detached', 'semidetached_house', 'terrace', 'bungalow', 'cabin', 'farm'].includes(b)) return 'house';
  if (['apartments', 'dormitory', 'hotel'].includes(b)) return 'apt';
  if (['retail', 'commercial', 'supermarket', 'kiosk'].includes(b)) return 'shop';
  if (b === 'office') return 'office';
  if (['industrial', 'warehouse', 'manufacture', 'factory'].includes(b)) return 'ind';
  if (['church', 'chapel', 'cathedral', 'mosque', 'synagogue', 'temple', 'religious'].includes(b) || t.amenity === 'place_of_worship') return 'church';
  if (['school', 'university', 'college', 'kindergarten'].includes(b) || t.amenity === 'school') return 'school';
  if (['civic', 'public', 'government', 'hospital', 'fire_station', 'police', 'townhall', 'library', 'train_station', 'transportation'].includes(b)) return 'civic';
  if (['garage', 'garages', 'shed', 'carport', 'roof', 'hut', 'parking', 'service'].includes(b)) return 'garage';
  if (b === 'residential') return 'auto-res';
  return 'auto';
}

// MA DOR property use code -> zone
export function parseUse(code) {
  let c = String(code || '').replace(/[^0-9]/g, '');
  if (!c) return null;
  if (c[0] === '0' && c.length >= 3) {
    const prim = c[1] === '0' ? c[2] : c[1];
    const z = prim === '1' ? ZONE.R : prim === '3' ? ZONE.C : prim === '4' ? ZONE.I : ZONE.R;
    return { zone: z, mixed: true, vacant: false, code3: c.slice(0, 3) };
  }
  const c3 = c.slice(0, 3);
  const vacant = ['130', '131', '132', '106', '390', '391', '392', '440', '441', '442'].includes(c3);
  const k = c[0];
  let zone = ZONE.R;
  if (k === '1') zone = ZONE.R;
  else if (k === '2' || k === '6' || k === '7' || k === '8') zone = ZONE.PARK;
  else if (k === '3') zone = ZONE.C;
  else if (k === '4') zone = ZONE.I;
  else if (k === '9') zone = c3 === '908' ? ZONE.R : ZONE.CIVIC;
  return { zone, mixed: false, vacant, code3: c3 };
}
const UNITS_BY_CODE = { 101: 1, 102: 1, 103: 1, 104: 2, 105: 3, 109: 2, 111: 6, 112: 24, 121: 8, 908: 40 };

const num = (v) => {
  const n = parseFloat(v);
  return isFinite(n) ? n : NaN;
};

function pick(arr, r) {
  return arr[Math.floor(r * arr.length) % arr.length];
}

// ---- architecture: pick a look for each building from assessor style, year, units and OSM tags ----
const SIDING = ['#eeeae0', '#d9dcd6', '#e6dcc0', '#efe3b8', '#c9d3bf', '#b9c9d6', '#8fa3b5', '#c8b79c', '#a7b3a0', '#e9e4d4', '#9aa7ad', '#d8c3a5', '#f3f0e8', '#c4cbd0'];
const VICT = ['#4f6b4a', '#7a3b3b', '#c99a3a', '#5b6f8a', '#8a6a4a', '#6d4f6b', '#2f4f5f'];
const ROOFS = ['#4a4c52', '#55565f', '#3f434a', '#5d4a3e', '#62656b', '#6b4b3c', '#44474d'];
const BRICK = ['#a4523c', '#9a4a36', '#b0603f', '#8c4a3a', '#a85a46'];
const GARDEN = ['#b89a74', '#a88a66', '#c7ad86', '#9c8466'];
const MODERN = [['#3a3d42', '#e8e6e1'], ['#b4593e', '#c9c6bf'], ['#6d7680', '#efece6'], ['#2f3a45', '#c8b89a'], ['#e9e7e2', '#7d8790'], ['#8a5a44', '#d9d4ca']];
const SIGNS = ['#c0392b', '#1f5fa8', '#e67e22', '#2e7d32', '#7b3f99'];
// arch -> [roof type, slope, default storeys, front porch floors]
export const HOUSE_ARCH = {
  decker: ['flat', 0, 3, 3],
  twofam: ['gableFB', 1.0, 2.5, 2],
  conventional: ['gableFB', 1.0, 2.5, 1],
  victorian: ['gableFB', 1.4, 2.5, 1],
  colonial: ['gableS', 0.85, 2, 0],
  cape: ['gableS', 1.3, 1.5, 0],
  ranch: ['hip', 0.45, 1, 0],
  bungalow: ['gableS', 0.7, 1.5, 1],
  contemp: ['gableS', 0.45, 2, 0],
};

let cssCtx = null;
function cssHex(s) {
  if (!s || typeof document === 'undefined') return null;
  if (!cssCtx) cssCtx = document.createElement('canvas').getContext('2d');
  cssCtx.fillStyle = '#010203';
  cssCtx.fillStyle = String(s).trim();
  const v = cssCtx.fillStyle;
  return v === '#010203' || !/^#[0-9a-f]{6}$/i.test(v) ? null : v;
}

export function styleBuilding(b, lot) {
  const r = hash2(b.id, 7, 3),
    r2 = hash2(b.id, 11, 5),
    r3 = hash2(b.id, 13, 9);
  const k = b.kind;
  const st = ((lot && lot.style) || '').toUpperCase();
  const yr = (lot && lot.year) || (b.proc ? 2030 : 0);
  const units = lot ? lot.units : 0;
  const m2 = b.area * 256;
  let arch = 'box';
  b.trim = '#f4f1ea';
  b.col2 = null;
  b.sign = null;
  b.awning = null;
  if (k === 'house') {
    if (b.arch && HOUSE_ARCH[b.arch]) arch = b.arch;
    else if (/DECKER|THREE|3 ?FAM/.test(st) || (units === 3 && b.levels >= 2.8)) arch = 'decker';
    else if (/TWO|2 ?FAM|DUPLEX/.test(st) || units === 2) arch = 'twofam';
    else if (/COLONIAL|GARRISON|FEDERAL|SALTBOX|TOWN|ROW/.test(st)) arch = 'colonial';
    else if (/CAPE/.test(st)) arch = 'cape';
    else if (/RANCH|SPLIT|RAISED/.test(st)) arch = 'ranch';
    else if (/VICTOR|QUEEN|MANSARD|EMPIRE|STICK/.test(st)) arch = 'victorian';
    else if (/BUNGALOW/.test(st)) arch = 'bungalow';
    else if (/CONTEMP|MODERN/.test(st)) arch = 'contemp';
    else if (/CONVENTIONAL|OLD STYLE/.test(st)) arch = 'conventional';
    else if (units >= 3 && b.levels >= 2.8) arch = 'decker';
    else if (units === 2) arch = 'twofam';
    else if (yr > 1945 && yr < 1975) arch = r < 0.6 ? 'ranch' : 'cape';
    else arch = r < 0.5 ? 'conventional' : 'colonial';
    const [roof, slope, lv, porch] = HOUSE_ARCH[arch];
    b.roof = roof;
    b.slope = slope;
    b.porch = porch;
    if (b.lvSrc !== 'osm' && b.lvSrc !== 'assessor') b.levels = lv;
    const shape = b.roofShape;
    if (shape === 'flat') b.roof = 'flat';
    else if (shape === 'hipped' || shape === 'pyramidal') b.roof = 'hip';
    else if (shape === 'gabled' && b.roof === 'flat') b.roof = 'gableFB';
    b.col = arch === 'victorian' ? pick(VICT, r) : pick(SIDING, r);
    b.roofCol = pick(ROOFS, r2);
    if (b.material === 'brick') b.col = pick(BRICK, r);
    if (arch === 'victorian') b.trim = r3 < 0.5 ? '#f4f1ea' : '#e8d9a8';
  } else {
    if (k === 'apt') arch = yr >= 2005 || b.proc ? 'modern' : yr && yr < 1950 ? 'brick' : yr ? 'garden' : r < 0.5 ? 'brick' : 'garden';
    else if (k === 'shop') arch = m2 > 2500 && b.levels <= 2.2 ? 'bigbox' : yr >= 2005 || b.proc ? 'modern' : (yr && yr < 1960) || (!yr && r < 0.6) ? 'brick' : 'strip';
    else if (k === 'office') arch = yr >= 1995 || b.proc ? 'glass' : r < 0.5 ? 'brick' : 'precast';
    else if (k === 'lab') arch = 'lab';
    else if (k === 'ind') arch = m2 > 1800 ? 'warehouse' : 'strip';
    else if (k === 'civic' || k === 'school' || k === 'police' || k === 'fire') arch = 'brick';
    else if (k === 'church') arch = 'church';
    else if (k === 'garage') arch = 'garage';
    b.roof = 'flat';
    const flatRoof = pick(PAL.flatRoof, r2);
    if (arch === 'brick') { b.col = pick(BRICK, r); b.trim = '#e8e2d4'; }
    else if (arch === 'garden') b.col = pick(GARDEN, r);
    else if (arch === 'modern') { const [a, c] = pick(MODERN, r); b.col = a; b.col2 = c; }
    else if (arch === 'glass') { b.col = '#7f95ab'; b.col2 = '#cfd6dc'; }
    else if (arch === 'lab') { b.col = '#dfe3e4'; b.col2 = '#6f8aa3'; }
    else if (arch === 'bigbox') { b.col = pick(['#d8cdb5', '#cfc6b4', '#e0d8c8'], r); b.sign = pick(SIGNS, r2); }
    else if (arch === 'warehouse') b.col = pick(['#a9adb0', '#c2bfb5', '#b5b0a2'], r);
    else if (arch === 'precast') b.col = pick(['#cfc7b6', '#bdb6a8'], r);
    else if (arch === 'church') b.col = pick(PAL.church, r);
    else if (arch === 'garage') b.col = pick(PAL.garage, r);
    else b.col = pick(PAL.shop, r);
    b.roofCol = arch === 'lab' ? '#cfd3d6' : flatRoof;
    if (k === 'shop' && arch !== 'bigbox') b.awning = pick(['#c0392b', '#2e7d32', '#1f5fa8', '#d68910', '#7b3f99'], r2);
    if (k === 'police') { b.col = '#c9ccd4'; b.roofCol = '#3a5fbf'; arch = 'precast'; }
    if (k === 'fire') { b.col = '#b5523e'; b.roofCol = '#c8352b'; }
  }
  const oc = cssHex(b.osmColour), orc = cssHex(b.osmRoofColour);
  if (oc) b.col = oc;
  if (orc) b.roofCol = orc;
  b.arch = arch;
  b.h = (k === 'garage' ? 1 : b.levels) * CFG.FLOOR_M;
  b._rgb = null;
}

// Which side of each building faces the street.
export function assignFront(world, b) {
  const { W, H, road } = world;
  const lot = b.lot >= 0 ? world.lots[b.lot] : null;
  let tx = null, ty = null;
  if (lot && lot.road >= 0) { tx = (lot.road % W) + 0.5; ty = ((lot.road / W) | 0) + 0.5; }
  else {
    const cx = Math.floor(b.cx), cy = Math.floor(b.cy);
    let bd = Infinity;
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx, y = cy + dy;
        if (x < 0 || y < 0 || x >= W || y >= H || !road[y * W + x]) continue;
        const d = dx * dx + dy * dy;
        if (d < bd) { bd = d; tx = x + 0.5; ty = y + 0.5; }
      }
  }
  const poly = b.obb || b.pts;
  if (tx == null) { b.front = 0; return; }
  let vx = tx - b.cx, vy = ty - b.cy;
  const vl = Math.hypot(vx, vy) || 1;
  vx /= vl; vy /= vl;
  let best = 0, bs = -Infinity;
  for (let k = 0; k < poly.length; k++) {
    const a = poly[k], c = poly[(k + 1) % poly.length];
    const mx = (a[0] + c[0]) / 2 - b.cx, my = (a[1] + c[1]) / 2 - b.cy;
    const ml = Math.hypot(mx, my) || 1;
    const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
    const s = ((mx * vx + my * vy) / ml) * (b.obb ? 1 : Math.min(1, len * 1.5));
    if (s > bs) { bs = s; best = k; }
  }
  if (b.obb) {
    const o = b.obb;
    b.obb = [o[best], o[(best + 1) % 4], o[(best + 2) % 4], o[(best + 3) % 4]];
    b.front = 0;
  } else b.front = best;
}

export function buildWorld(raw, progress = () => {}) {
  const els = raw.osm;
  const F = CFG.FETCH_BBOX;
  const latC = ((F.s + F.n) / 2) * (Math.PI / 180);

  // ---- town boundary & world bounds ----
  const townRel = els.find(
    (e) => e.type === 'relation' && e.tags && e.tags.boundary === 'administrative' && e.tags.name === CFG.TOWN_NAME && String(e.tags.admin_level) === '8'
  );
  const relWays = (rel) =>
    (rel.members || []).filter((m) => m.type === 'way' && Array.isArray(m.geometry)).map((m) => ({ role: m.role, geo: m.geometry.filter(Boolean) }));
  let bbox = { ...F };
  if (townRel) {
    let s = 90, n = -90, w = 180, e = -180;
    for (const m of relWays(townRel))
      for (const p of m.geo) {
        s = Math.min(s, p.lat); n = Math.max(n, p.lat);
        w = Math.min(w, p.lon); e = Math.max(e, p.lon);
      }
    const dLat = CFG.MARGIN_M / 110574,
      dLon = CFG.MARGIN_M / (111320 * Math.cos(latC));
    bbox = { s: Math.max(F.s, s - dLat), n: Math.min(F.n, n + dLat), w: Math.max(F.w, w - dLon), e: Math.min(F.e, e + dLon) };
  }
  const proj = makeProj(bbox);
  const { W, H } = proj;
  const N = W * H;
  const G = (lat, lon) => proj.toGrid(lat, lon);
  const gpts = (geo) => geo.map((p) => G(p.lat, p.lon));
  const inB = (x, y) => x >= 0 && y >= 0 && x < W && y < H;

  const terrain = new Uint8Array(N);
  const road = new Uint8Array(N);
  const path = new Uint8Array(N);
  const cover = new Uint8Array(N);
  const zoneHint = new Uint8Array(N);
  const inTown = new Uint8Array(N);
  const lotOf = new Int32Array(N).fill(-1);
  const bAt = new Int32Array(N).fill(-1);
  const svcAt = new Int16Array(N).fill(-1);
  const tree = new Uint8Array(N);
  const roadName = new Uint16Array(N);
  const names = [''];
  const nameIdx = new Map();

  progress('Surveying the town line…');
  if (townRel) fillSegs(relWays(townRel).map((m) => gpts(m.geo)), W, H, (i) => (inTown[i] = 1));
  else inTown.fill(1);

  // ---- classify elements ----
  const water = [], riverLines = [], covers = [], hints = [], roads = [], paths = [], rawB = [], pois = [], treePts = [];
  const closed = (p) => p.length > 3 && Math.abs(p[0][0] - p[p.length - 1][0]) < 1e-6 && Math.abs(p[0][1] - p[p.length - 1][1]) < 1e-6;
  const coverOf = (t) => {
    if (t.landuse === 'cemetery' || t.amenity === 'grave_yard') return COVER.CEMETERY;
    if (t.natural === 'wood' || t.landuse === 'forest' || t.natural === 'scrub') return COVER.WOOD;
    if (t.natural === 'wetland') return COVER.WETLAND;
    if (['pitch', 'track', 'stadium'].includes(t.leisure)) return COVER.SPORT;
    if (['park', 'garden', 'playground', 'nature_reserve', 'dog_park', 'recreation_ground', 'common', 'golf_course'].includes(t.leisure)) return COVER.PARK;
    if (['recreation_ground', 'village_green', 'meadow'].includes(t.landuse) || t.natural === 'grassland') return COVER.PARK;
    if (t.amenity === 'parking' && t.parking !== 'underground' && t.parking !== 'multi-storey') return COVER.PAVED;
    if (['railway', 'brownfield', 'construction'].includes(t.landuse)) return COVER.PAVED;
    return -1;
  };
  const hintOf = (t) => {
    if (t.landuse === 'residential') return ZONE.R;
    if (t.landuse === 'commercial' || t.landuse === 'retail') return ZONE.C;
    if (t.landuse === 'industrial') return ZONE.I;
    if (['education', 'institutional', 'religious', 'military'].includes(t.landuse) || t.amenity === 'school') return ZONE.CIVIC;
    return 0;
  };
  const poiKind = (t) => t.shop || t.amenity || t.office || t.craft || t.tourism || t.healthcare || t.place_cat || '';

  for (const e of els) {
    const t = e.tags || {};
    if (e.type === 'node') {
      if (t.natural === 'tree') treePts.push(G(e.lat, e.lon));
      else if (t.src === 'overture' && NOT_BIZ.test(t.place_cat || '')) continue;
      else if (t.name || SERVICE_AMEN[t.amenity]) pois.push({ name: t.name || '', kind: poiKind(t), amen: t.amenity, pt: G(e.lat, e.lon) });
      continue;
    }
    if (e === townRel) continue;
    let polys, roles;
    if (e.type === 'way') {
      if (!e.geometry) continue;
      polys = [gpts(e.geometry.filter(Boolean))];
      roles = ['outer'];
    } else {
      const ms = relWays(e);
      polys = ms.map((m) => gpts(m.geo));
      roles = ms.map((m) => m.role);
    }
    if (!polys.length || polys[0].length < 2) continue;

    if (t.building && t.building !== 'no') {
      polys.forEach((p, i) => {
        if (roles[i] !== 'inner' && closed(p)) rawB.push({ p, t });
      });
      if (t.name && (t.amenity || t.shop || t.office || t.tourism || t.healthcare) || SERVICE_AMEN[t.amenity]) {
        pois.push({ name: t.name || '', kind: poiKind(t), amen: t.amenity, pt: centroid(polys[0]) });
      }
      continue;
    }
    if (t.highway) {
      if (t.area === 'yes' || t.tunnel === 'yes' || t.tunnel === 'culvert') continue;
      let cls = ROAD_CLASS[t.highway] || 0;
      if (!cls && t.highway === 'service' && !t.service && t.name) cls = 1;
      if (cls) roads.push({ p: polys[0], cls, name: t.name || '', bridge: t.bridge && t.bridge !== 'no' });
      else if (PATHS.has(t.highway) && !/^(sidewalk|crossing|traffic_island|access_aisle)$/.test(t.footway || '') && (t.highway !== 'footway' || t.name)) paths.push(polys[0]);
      continue;
    }
    const isArea = e.type === 'relation' || closed(polys[0]);
    if (isArea && (t.natural === 'water' || t.waterway === 'riverbank' || t.landuse === 'reservoir' || t.landuse === 'basin' || (t.water && t.natural !== 'wetland'))) {
      water.push(polys);
      continue;
    }
    if (t.waterway === 'river' || t.waterway === 'canal') {
      if (t.tunnel !== 'yes' && t.tunnel !== 'culvert') riverLines.push(polys[0]);
      continue;
    }
    if (isArea) {
      const c = coverOf(t);
      const area = Math.abs(signedArea(polys[0]));
      if (c >= 0) covers.push({ polys, c, area });
      const h = hintOf(t);
      if (h) hints.push({ polys, h, area });
    }
    if ((t.name && (t.amenity || t.shop || t.office || t.tourism || t.healthcare)) || SERVICE_AMEN[t.amenity]) {
      pois.push({ name: t.name || '', kind: poiKind(t), amen: t.amenity, pt: centroid(polys[0]) });
    }
  }

  // ---- rasterise land cover, zoning hints, water ----
  progress('Planting grass and pouring the Charles River…');
  covers.sort((a, b) => b.area - a.area).forEach((cv) => fillSegs(cv.polys, W, H, (i) => (cover[i] = cv.c)));
  hints.sort((a, b) => b.area - a.area).forEach((hv) => fillSegs(hv.polys, W, H, (i) => (zoneHint[i] = hv.h)));
  for (const wp of water) fillSegs(wp, W, H, (i) => (terrain[i] = 1));
  if (!water.length) {
    for (const p of riverLines)
      for (let k = 0; k + 1 < p.length; k++)
        traverse(p[k][0], p[k][1], p[k + 1][0], p[k + 1][1], (x, y) => {
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) if (inB(x + dx, y + dy)) terrain[(y + dy) * W + x + dx] = 1;
        });
  }

  // ---- roads ----
  progress('Paving the streets…');
  const osmRoad = new Uint8Array(N);
  const roadCut = new Uint8Array(N);
  const roadLines = [];
  for (const r of roads) {
    if (!r.bridge)
      for (let k = 0; k + 1 < r.p.length && !r.bridge; k++) {
        const mx = Math.floor((r.p[k][0] + r.p[k + 1][0]) / 2), my = Math.floor((r.p[k][1] + r.p[k + 1][1]) / 2);
        if (inB(mx, my) && terrain[my * W + mx] === 1) r.bridge = true;
      }
    const sp = r.p.length > 2 ? simplify(r.p, 0.04) : r.p;
    const flat = new Float32Array(sp.length * 2);
    sp.forEach((q, k) => { flat[k * 2] = q[0]; flat[k * 2 + 1] = q[1]; });
    roadLines.push({ cls: r.cls, pts: flat, bridge: !!r.bridge });
  }
  for (const r of roads) {
    let ni = 0;
    if (r.name) {
      ni = nameIdx.get(r.name);
      if (ni === undefined) {
        ni = names.length;
        names.push(r.name);
        nameIdx.set(r.name, ni);
      }
    }
    for (let k = 0; k + 1 < r.p.length; k++)
      traverse(r.p[k][0], r.p[k][1], r.p[k + 1][0], r.p[k + 1][1], (x, y) => {
        if (!inB(x, y)) return;
        const i = y * W + x;
        osmRoad[i] = 1;
        if (r.cls >= road[i]) {
          road[i] = r.cls;
          if (ni) roadName[i] = ni;
        } else if (!roadName[i] && ni) roadName[i] = ni;
      });
  }
  for (const p of paths)
    for (let k = 0; k + 1 < p.length; k++)
      traverse(p[k][0], p[k][1], p[k + 1][0], p[k + 1][1], (x, y) => {
        if (inB(x, y)) path[y * W + x] = 1;
      });

  // ---- buildings ----
  progress('Raising buildings…');
  const bldgs = [];
  for (const rb of rawB) {
    let p = rb.p;
    let anyIn = false;
    for (const q of p) if (q[0] > -1 && q[1] > -1 && q[0] < W + 1 && q[1] < H + 1) { anyIn = true; break; }
    if (!anyIn) continue;
    p = simplify(p.slice(0, -1), 0.07);
    let a = signedArea(p);
    if (a < 0) { p.reverse(); a = -a; }
    if (a < 0.05) continue;
    const t = rb.t;
    let lv = num(t['building:levels']);
    if (!isFinite(lv) && t.height) lv = num(String(t.height).replace(/[^0-9.]/g, '')) / 3.2;
    if (isFinite(lv) && t['roof:levels']) lv += 0.5;
    const [cx, cy] = centroid(p);
    bldgs.push({
      id: bldgs.length, pts: p, area: a, cx, cy, levels: isFinite(lv) && lv > 0 ? Math.min(lv, 40) : NaN, lvSrc: isFinite(lv) && lv > 0 ? 'osm' : 'default',
      kind: kindFromTags(t), name: t.name || '', alive: 1, lot: -1, proc: 0,
      osmColour: t['building:colour'] || null, osmRoofColour: t['roof:colour'] || null, roofShape: t['roof:shape'] || null, material: t['building:material'] || null,
    });
  }
  const stamp = (b) => {
    let n = 0;
    fillSegs([b.pts.concat([b.pts[0]])], W, H, (i) => {
      if (bAt[i] < 0) bAt[i] = b.id;
      n++;
    });
    const cx = Math.floor(b.cx), cy = Math.floor(b.cy);
    if (!n && inB(cx, cy) && bAt[cy * W + cx] < 0) bAt[cy * W + cx] = b.id;
  };
  // big buildings first so they own their tiles
  [...bldgs].sort((x, y) => y.area - x.area).forEach(stamp);

  // ---- lots from MassGIS parcels ----
  progress('Reading the assessor’s ledger…');
  const lots = [];
  const tileFree = (i) => lotOf[i] < 0 && !road[i] && terrain[i] !== 1;
  const parcels = raw.parcels || [];
  if (parcels.length) {
    const groups = new Map();
    for (const f of parcels) {
      const p = f.properties || {};
      const key = p.LOC_ID || p.MAP_PAR_ID || 'o' + p.OBJECTID;
      let g = groups.get(key);
      if (!g) groups.set(key, (g = { props: [], geom: null }));
      g.props.push(p);
      if (!g.geom && f.geometry) g.geom = f.geometry;
    }
    for (const g of groups.values()) {
      if (!g.geom) continue;
      const polysLL = g.geom.type === 'Polygon' ? g.geom.coordinates : g.geom.type === 'MultiPolygon' ? g.geom.coordinates.flat() : [];
      const rings = polysLL.map((r) => r.map(([lon, lat]) => G(lat, lon)));
      if (!rings.length || rings[0].length < 3) continue;
      const tiles = [];
      fillSegs(rings, W, H, (i) => {
        if (tileFree(i)) tiles.push(i);
      });
      const [ccx, ccy] = centroid(rings[0].slice(0, -1));
      if (!tiles.length) {
        const x = Math.floor(ccx), y = Math.floor(ccy);
        if (!inB(x, y) || !tileFree(y * W + x)) continue;
        tiles.push(y * W + x);
      }
      const P = g.props;
      const prim = P.reduce((a, b) => ((+b.TOTAL_VAL || 0) > (+a.TOTAL_VAL || 0) ? b : a), P[0]);
      const sum = (k) => P.reduce((s, p) => s + (num(p[k]) || 0), 0);
      const use = parseUse(prim.USE_CODE);
      const years = P.map((p) => num(p.YEAR_BUILT)).filter((y) => y > 1600 && y < 2100);
      let lotSize = Math.max(...P.map((p) => num(p.LOT_SIZE) || 0));
      const lu = String(prim.LOT_UNITS || '').toUpperCase();
      let areaM = lu.startsWith('S') ? lotSize * 0.0929 : lotSize > 0 && (lu.startsWith('A') || lotSize < 60) ? lotSize * 4046.86 : lotSize * 0.0929;
      if (!(areaM > 20)) areaM = tiles.length * 256;
      let units = sum('UNITS');
      if (use && use.code3 === '102') units = Math.max(units, P.length);
      const lot = {
        id: lots.length, tiles, cx: ccx, cy: ccy, real: 1,
        zone: use ? use.zone : 0, mixed: use ? use.mixed : false, vacantCode: use ? use.vacant : false, code3: use ? use.code3 : '',
        landVal: sum('LAND_VAL'), bldgVal: sum('BLDG_VAL'), otherVal: sum('OTHER_VAL'),
        totalVal: sum('TOTAL_VAL'), area: areaM,
        bldArea: sum('BLD_AREA') * 0.0929 || sum('RES_AREA') * 0.0929,
        units, records: P.length,
        year: years.length ? Math.min(...years) : 0,
        addr: titleCase(prim.SITE_ADDR || ''), useDesc: titleCase(prim.USE_DESC || '').replace(/^Imputed\s*-\s*/i, ''), style: titleCase(prim.STYLE || ''),
        stories: num(prim.STORIES), zoning: String(prim.ZONING || '').trim(), fy: prim.FY || '',
        biz: [], bldgs: [], occ: 0.95, dens: 0, jobs: 0, pop: 0, road: -1, dense: false, inTown: 1, built: 0,
      };
      if (!lot.totalVal) lot.totalVal = lot.landVal + lot.bldgVal + lot.otherVal;
      lots.push(lot);
      for (const i of tiles) lotOf[i] = lot.id;
    }
  }

  // ---- attach buildings to lots (and invent lots where parcels are missing) ----
  progress('Matching buildings to parcels…');
  const bTiles = (b) => {
    const out = [];
    fillSegs([b.pts.concat([b.pts[0]])], W, H, (i) => out.push(i));
    if (!out.length) {
      const x = Math.floor(b.cx), y = Math.floor(b.cy);
      if (inB(x, y)) out.push(y * W + x);
    }
    return out;
  };
  for (const b of bldgs) {
    const x = Math.floor(b.cx), y = Math.floor(b.cy);
    let li = inB(x, y) ? lotOf[y * W + x] : -1;
    let ts = null;
    if (li < 0) {
      ts = bTiles(b);
      for (const i of ts) if (lotOf[i] >= 0) { li = lotOf[i]; break; }
    }
    if (li < 0 && !parcels.length && inB(x, y) && inTown[y * W + x]) {
      ts = ts || bTiles(b);
      const free = ts.filter(tileFree);
      if (free.length) {
        const hz = zoneHint[free[0]];
        const k = b.kind;
        const zone = k === 'house' || k === 'apt' || k === 'auto-res' ? ZONE.R : k === 'shop' || k === 'office' ? ZONE.C : k === 'ind' ? ZONE.I : k === 'church' || k === 'school' || k === 'civic' ? ZONE.CIVIC : hz || ZONE.R;
        const lot = { id: lots.length, tiles: free, cx: b.cx, cy: b.cy, real: 0, zone, mixed: false, code3: '', landVal: 0, bldgVal: 0, otherVal: 0, totalVal: 0, area: free.length * 256, bldArea: 0, units: 0, records: 1, year: 0, addr: '', useDesc: '', style: '', stories: NaN, zoning: '', biz: [], bldgs: [], occ: 0.95, dens: 0, jobs: 0, pop: 0, road: -1, dense: false, inTown: 1, built: 0 };
        lots.push(lot);
        for (const i of free) lotOf[i] = lot.id;
        li = lot.id;
      }
    }
    if (li >= 0) {
      b.lot = li;
      lots[li].bldgs.push(b.id);
    }
  }

  // lot inTown / zone defaults
  for (const lot of lots) {
    const x = Math.floor(lot.cx), y = Math.floor(lot.cy);
    lot.inTown = lot.real ? 1 : inB(x, y) ? inTown[y * W + x] : inTown[lot.tiles[0]];
    if (!lot.zone) lot.zone = zoneHint[lot.tiles[0]] || ZONE.R;
  }

  // ---- finalize building kinds, heights, colours ----
  for (const b of bldgs) {
    const lot = b.lot >= 0 ? lots[b.lot] : null;
    const m2 = b.area * 256;
    let k = b.kind;
    if (k === 'auto' || k === 'auto-res') {
      const z = lot ? lot.zone : zoneHint[Math.floor(b.cy) * W + Math.floor(b.cx)] || (k === 'auto-res' ? ZONE.R : 0);
      if (z === ZONE.R || k === 'auto-res') k = m2 < 280 && !(lot && lot.units >= 4) ? 'house' : 'apt';
      else if (z === ZONE.C) k = (lot && lot.code3.startsWith('34')) || b.levels >= 4 || m2 > 4000 ? 'office' : 'shop';
      else if (z === ZONE.I) k = (lot && /lab|research|r ?& ?d/i.test(lot.useDesc)) || b.levels >= 3 ? 'lab' : 'ind';
      else if (z === ZONE.CIVIC) k = lot && /school/i.test(lot.useDesc) ? 'school' : lot && lot.code3 === '906' ? 'church' : 'civic';
      else k = m2 < 200 ? 'house' : 'shop';
    }
    if (k === 'garage' && m2 > 1500) k = 'shop';
    b.kind = k;
    if (!isFinite(b.levels)) {
      let lv = DEFAULT_LEVELS[k] || 2;
      if (lot && isFinite(lot.stories) && lot.stories > 0 && lot.stories < 30 && k !== 'garage') {
        const biggest = lot.bldgs.reduce((m, id) => (bldgs[id].area > m ? bldgs[id].area : m), 0);
        if (b.area >= biggest) {
          lv = lot.stories;
          b.lvSrc = 'assessor';
        }
      }
      if (k === 'apt' && lot && lot.units >= 40) lv = Math.max(lv, 5);
      b.levels = lv;
    }
    if (k === 'house' && b.pts.length >= 4) {
      const o = obb(b.pts);
      if (o && o.area <= b.area * 1.6) b.obb = o.c;
    }
    styleBuilding(b, lot);
  }

  // ---- businesses & landmarks ----
  const services = [];
  for (const p of pois) {
    const x = Math.floor(p.pt[0]), y = Math.floor(p.pt[1]);
    if (!inB(x, y)) continue;
    let li = lotOf[y * W + x];
    for (let d = 1; li < 0 && d <= 1; d++)
      for (let dy = -d; dy <= d && li < 0; dy++)
        for (let dx = -d; dx <= d && li < 0; dx++) if (inB(x + dx, y + dy)) li = lotOf[(y + dy) * W + x + dx];
    if (li >= 0 && p.name && lots[li].biz.length < 14 && !lots[li].biz.includes(p.name)) {
      lots[li].biz.push(p.name);
      (lots[li].bizKind || (lots[li].bizKind = []))[lots[li].biz.length - 1] = p.kind || '';
    }
    const st = SERVICE_AMEN[p.amen];
    if (st && inTown[y * W + x]) {
      if (!services.some((s) => s.type === st && Math.hypot(s.x - p.pt[0], s.y - p.pt[1]) < 8))
        services.push({ id: services.length, type: st, x: p.pt[0], y: p.pt[1], name: p.name || '', real: 1, lot: li, alive: 1 });
    }
  }

  // ---- trees ----
  progress('Planting trees…');
  for (const [tx, ty] of treePts) {
    const x = Math.floor(tx), y = Math.floor(ty);
    if (inB(x, y)) {
      const i = y * W + x;
      if (!road[i] && terrain[i] !== 1 && bAt[i] < 0) tree[i] = 2;
    }
  }
  for (let i = 0; i < N; i++) {
    if (tree[i] || road[i] || terrain[i] === 1 || bAt[i] >= 0) continue;
    const x = i % W, y = (i / W) | 0;
    const li = lotOf[i];
    const c = cover[i];
    let p = 0.1;
    if (c === COVER.WOOD) p = 0.85;
    else if (c === COVER.PARK) p = 0.4;
    else if (c === COVER.CEMETERY) p = 0.3;
    else if (c === COVER.WETLAND) p = 0.35;
    else if (c === COVER.PAVED || c === COVER.SPORT) p = 0.02;
    else if (li >= 0) p = lots[li].zone === ZONE.R ? 0.3 : lots[li].zone === ZONE.CIVIC ? 0.2 : 0.05;
    if (hash2(x, y, 99) < p) tree[i] = 1;
  }

  const world = {
    W, H, bbox, terrain, road, path, cover, osmRoad, roadCut, roadLines, zoneHint, inTown, lotOf, bAt, svcAt, tree, roadName, names,
    lots, bldgs, services, lvBase: new Float32Array(N),
    townFound: !!townRel, hasParcels: parcels.length > 0, parcelError: raw.parcelError || null,
    fetched: raw.fetched, source: raw.source || 'live', demo: !!raw.demo, sources: raw.sources || null,
  };

  // ---- lot metrics, road access, land value field ----
  progress('Appraising land values…');
  for (const lot of lots) {
    computeLotMetrics(world, lot, true);
    lot.road = findRoad(world, lot);
  }
  for (const b of bldgs) assignFront(world, b);
  buildLandValue(world);

  const [sx, sy] = proj.toGrid(CFG.SQUARE.lat, CFG.SQUARE.lon);
  world.start = inB(sx, sy) ? [sx, sy] : [W / 2, H / 2];
  world.stats = { buildings: bldgs.length, lots: lots.length, roads: roads.length, pois: pois.length };
  return world;
}

export function worldProj(world) {
  return makeProj(world.bbox);
}

export function findRoad(world, lot) {
  const { W, H, road } = world;
  const cx = Math.floor(lot.cx), cy = Math.floor(lot.cy);
  for (const i of lot.tiles) {
    const x = i % W, y = (i / W) | 0;
    if ((x > 0 && road[i - 1]) || (x < W - 1 && road[i + 1]) || (y > 0 && road[i - W]) || (y < H - 1 && road[i + W])) {
      return x > 0 && road[i - 1] ? i - 1 : x < W - 1 && road[i + 1] ? i + 1 : y > 0 && road[i - W] ? i - W : i + W;
    }
  }
  for (let r = 1; r <= 5; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = cx + dx, y = cy + dy;
        if (x >= 0 && y >= 0 && x < W && y < H && road[y * W + x]) return y * W + x;
      }
  return -1;
}

const BLD_RATE = { [ZONE.R]: 2600, [ZONE.C]: 3000, [ZONE.I]: 3600, [ZONE.CIVIC]: 3000, [ZONE.PARK]: 500 };
const LAND_RATE = { [ZONE.R]: 900, [ZONE.C]: 1100, [ZONE.I]: 950, [ZONE.CIVIC]: 800, [ZONE.PARK]: 300 };

// Units, jobs, density for a lot. `init` sets values from assessor data; later calls derive from buildings.
export function computeLotMetrics(world, lot, init = false) {
  const { bldgs } = world;
  let floor = 0;
  for (const id of lot.bldgs) {
    const b = bldgs[id];
    if (b.alive && b.kind !== 'garage') floor += b.area * 256 * b.levels * 0.85;
  }
  if (init && lot.bldArea > 0) floor = lot.bldArea;
  if (!init || !(lot.bldArea > 0)) lot.bldArea = floor;
  const z = lot.zone;
  const hasB = lot.bldgs.some((id) => bldgs[id].alive);
  if (z === ZONE.R) {
    if (init) {
      if (!(lot.units > 0)) lot.units = UNITS_BY_CODE[+lot.code3] || (hasB ? Math.max(1, Math.round(floor / 110)) : 0);
      if (lot.mixed) lot.units = Math.max(1, lot.units);
    } else lot.units = hasB ? Math.max(1, Math.round(floor / 95)) : 0;
    if (!hasB && !lot.real) lot.units = 0;
    lot.dens = lot.units <= 0 ? 0 : lot.units === 1 ? 1 : lot.units <= 3 ? 2 : lot.units < 20 ? 3 : 4;
    lot.jobs = lot.mixed ? floor * 0.25 / 30 : 0;
  } else if (z === ZONE.C || z === ZONE.I || z === ZONE.CIVIC) {
    lot.units = 0;
    lot.jobs = floor / (z === ZONE.C ? 30 : z === ZONE.I ? 45 : 70);
    lot.dens = floor <= 0 ? 0 : floor < 900 ? 1 : floor < 4000 ? 2 : floor < 15000 ? 3 : 4;
  } else {
    lot.units = 0;
    lot.jobs = 0;
    lot.dens = 0;
  }
  if (!hasB && init && lot.vacantCode) lot.dens = 0;
  if (init) {
    if (!lot.real || !(lot.totalVal > 0)) {
      lot.landVal = lot.area * (LAND_RATE[z] || 800) * (0.8 + 0.4 * hash2(lot.id, 3, 1));
      lot.bldgVal = floor * (BLD_RATE[z] || 2500);
      lot.otherVal = 0;
      lot.totalVal = lot.landVal + lot.bldgVal;
    }
    lot.baseLand = lot.landVal;
    lot.baseBldg = lot.bldgVal + lot.otherVal;
    lot.dense = lot.dens >= 3;
  }
}

export const bldRate = (z) => BLD_RATE[z] || 2500;

function buildLandValue(world) {
  const { W, H, lots, lvBase, terrain } = world;
  const N = W * H;
  const vals = [];
  for (const lot of lots) {
    const per = lot.landVal / Math.max(lot.area, 60);
    if (!(per > 0)) continue;
    vals.push(per);
    for (const i of lot.tiles) lvBase[i] = per;
  }
  const lo = percentile(vals, 0.03), hi = percentile(vals, 0.97);
  for (let i = 0; i < N; i++) if (lvBase[i]) lvBase[i] = Math.min(hi, Math.max(lo, lvBase[i]));
  const med = median(vals) || 900;
  const tmp = new Float32Array(N);
  for (let pass = 0; pass < 60; pass++) {
    let changed = 0;
    tmp.set(lvBase);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (tmp[i]) continue;
        let s = 0, n = 0;
        if (x > 0 && tmp[i - 1]) { s += tmp[i - 1]; n++; }
        if (x < W - 1 && tmp[i + 1]) { s += tmp[i + 1]; n++; }
        if (y > 0 && tmp[i - W]) { s += tmp[i - W]; n++; }
        if (y < H - 1 && tmp[i + W]) { s += tmp[i + W]; n++; }
        if (n) { lvBase[i] = s / n; changed++; }
      }
    if (!changed) break;
  }
  for (let i = 0; i < N; i++) if (!lvBase[i]) lvBase[i] = med;
  world.lvMedian = med;
  void terrain;
}

// ---- tile helpers shared by sim/UI ----
export function buildingTiles(world, b) {
  const { W, H } = world;
  const out = [];
  fillSegs([b.pts.concat([b.pts[0]])], W, H, (i) => out.push(i));
  if (!out.length) {
    const x = Math.floor(b.cx), y = Math.floor(b.cy);
    if (x >= 0 && y >= 0 && x < W && y < H) out.push(y * W + x);
  }
  return out;
}

export function demolish(world, b) {
  if (!b.alive) return [];
  b.alive = 0;
  const ts = buildingTiles(world, b);
  for (const i of ts) if (world.bAt[i] === b.id) world.bAt[i] = -1;
  return ts;
}

function addBuilding(world, o) {
  const b = { id: world.bldgs.length, alive: 1, proc: 1, name: '', lvSrc: 'assessor', ...o };
  const [cx, cy] = centroid(b.pts);
  b.cx = cx;
  b.cy = cy;
  b.area = Math.abs(signedArea(b.pts));
  if (b.kind === 'house' && !b.obb) b.obb = b.pts.slice();
  styleBuilding(b, b.lot >= 0 ? world.lots[b.lot] : null);
  assignFront(world, b);
  world.bldgs.push(b);
  for (const i of buildingTiles(world, b)) if (world.bAt[i] < 0) world.bAt[i] = b.id;
  return b;
}

const PROC_LEVELS = {
  [ZONE.R]: [0, 2.5, 3, 5, 10],
  [ZONE.C]: [0, 1.5, 3, 6, 12],
  [ZONE.I]: [0, 1.5, 2.5, 4, 6],
  [ZONE.CIVIC]: [0, 2, 2.5, 3, 4],
};

// Replace whatever is on a lot with a procedurally generated building at density `dens`.
export function developLot(world, lot, dens, seed = 0) {
  const { W, bldgs } = world;
  const touched = [];
  for (const id of lot.bldgs) touched.push(...demolish(world, bldgs[id]));
  lot.bldgs = [];
  if (!lot.tiles.length || dens <= 0) return touched;
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (const i of lot.tiles) {
    const x = i % W, y = (i / W) | 0;
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const mask = new Uint8Array(w * h);
  for (const i of lot.tiles) {
    if (world.svcAt[i] >= 0) continue;
    mask[(((i / W) | 0) - y0) * w + (i % W) - x0] = 1;
  }
  const r = maxRect(mask, w, h);
  if (!r.area) return touched;
  const z = lot.zone;
  const lv = (PROC_LEVELS[z] || PROC_LEVELS[ZONE.R])[Math.min(4, dens)];
  const rx = x0 + r.x, ry = y0 + r.y;
  const rand = (k) => hash2(lot.id, seed, k);
  const box = (ax, ay, bx, by, inset) => [
    [ax + inset, ay + inset], [bx - inset, ay + inset], [bx - inset, by - inset], [ax + inset, by - inset],
  ];
  if (z === ZONE.R && dens <= 2) {
    // a row of houses, roughly one per 1x2 tiles
    const along = r.w >= r.h;
    const L = along ? r.w : r.h, D = along ? r.h : r.w;
    const step = dens === 1 ? 1.4 : 1.2;
    const n = Math.max(1, Math.floor(L / step));
    const rows = Math.max(1, Math.floor(D / 2.2));
    for (let rr = 0; rr < rows; rr++)
      for (let k = 0; k < n; k++) {
        const a = (k * L) / n, bb = ((k + 1) * L) / n;
        const c0 = (rr * D) / rows, c1 = ((rr + 1) * D) / rows;
        const ins = 0.12 + rand(k + rr * 31) * 0.06;
        const pts = along ? box(rx + a, ry + c0, rx + bb, ry + c1, ins) : box(rx + c0, ry + a, rx + c1, ry + bb, ins);
        // houses are longer front-to-back
        const o = along ? [pts[1], pts[2], pts[3], pts[0]] : pts;
        const b = addBuilding(world, { pts, kind: 'house', levels: lv, lot: lot.id, obb: o, arch: dens === 1 ? (rand(k) < 0.5 ? 'colonial' : 'conventional') : 'twofam' });
        lot.bldgs.push(b.id);
      }
  } else {
    const kind =
      z === ZONE.R ? 'apt' : z === ZONE.C ? (dens >= 3 ? 'office' : 'shop') : z === ZONE.I ? (dens >= 3 ? 'lab' : 'ind') : lot.svc ? lot.svc : 'civic';
    const ins = Math.min(0.25, 0.08 + 0.04 * Math.min(r.w, r.h));
    const pts = box(rx, ry, rx + r.w, ry + r.h, ins);
    const b = addBuilding(world, { pts, kind, levels: lv + Math.floor(rand(9) * (dens >= 3 ? 3 : 1)), lot: lot.id });
    lot.bldgs.push(b.id);
  }
  for (const id of lot.bldgs) touched.push(...buildingTiles(world, bldgs[id]));
  return touched;
}

export function addServiceBuilding(world, type, x, y, size) {
  const kind = type === 'school' ? 'school' : type;
  const pts = [[x + 0.15, y + 0.15], [x + size - 0.15, y + 0.15], [x + size - 0.15, y + size - 0.15], [x + 0.15, y + size - 0.15]];
  return addBuilding(world, { pts, kind, levels: type === 'school' ? 3 : 2, lot: -1 });
}
