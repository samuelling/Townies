import { CFG } from './config.js';

// ---------- tiny IndexedDB key/value store ----------
let dbp = null;
function db() {
  if (!dbp)
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open('townies', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  return dbp;
}
export async function kvGet(k) {
  try {
    const d = await db();
    return await new Promise((res, rej) => {
      const q = d.transaction('kv').objectStore('kv').get(k);
      q.onsuccess = () => res(q.result);
      q.onerror = () => rej(q.error);
    });
  } catch (e) {
    console.warn('kvGet', e);
    return undefined;
  }
}
export async function kvSet(k, v) {
  try {
    const d = await db();
    await new Promise((res, rej) => {
      const t = d.transaction('kv', 'readwrite');
      t.objectStore('kv').put(v, k);
      t.oncomplete = res;
      t.onerror = () => rej(t.error);
    });
    return true;
  } catch (e) {
    console.warn('kvSet', e);
    return false;
  }
}
export async function kvDel(k) {
  try {
    const d = await db();
    await new Promise((res) => {
      const t = d.transaction('kv', 'readwrite');
      t.objectStore('kv').delete(k);
      t.oncomplete = res;
      t.onerror = res;
    });
  } catch (e) {}
}

// ---------- OpenStreetMap via Overpass ----------
function overpassQuery(b) {
  const bb = `${b.s},${b.w},${b.n},${b.e}`;
  return `[out:json][timeout:180][maxsize:1073741824];
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

async function readWithProgress(resp, onBytes) {
  if (!resp.body || !resp.body.getReader) return await resp.text();
  const reader = resp.body.getReader();
  const chunks = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    n += value.length;
    onBytes(n);
  }
  const all = new Uint8Array(n);
  let o = 0;
  for (const c of chunks) {
    all.set(c, o);
    o += c.length;
  }
  return new TextDecoder().decode(all);
}

export async function fetchOSM(progress) {
  const q = overpassQuery(CFG.FETCH_BBOX);
  let lastErr = null;
  for (const url of CFG.OVERPASS) {
    try {
      progress(`Asking OpenStreetMap for every street and building in ${CFG.TOWN_NAME}… (${new URL(url).host})`);
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(q),
      });
      if (!resp.ok) throw new Error(`Overpass ${resp.status}`);
      const txt = await readWithProgress(resp, (n) =>
        progress(`Downloading map data from OpenStreetMap… ${(n / 1e6).toFixed(1)} MB`)
      );
      const json = JSON.parse(txt);
      if (!json.elements || json.elements.length < 100) throw new Error('Overpass returned too little data');
      return json.elements;
    } catch (e) {
      console.warn('Overpass failed', url, e);
      lastErr = e;
    }
  }
  throw lastErr || new Error('Overpass unavailable');
}

// ---------- MassGIS property tax parcels ----------
const PARCEL_FIELDS = [
  'OBJECTID', 'LOC_ID', 'MAP_PAR_ID', 'TOWN_ID', 'BLDG_VAL', 'LAND_VAL', 'OTHER_VAL', 'TOTAL_VAL', 'FY',
  'LOT_SIZE', 'LOT_UNITS', 'USE_CODE', 'USE_DESC', 'SITE_ADDR', 'ZONING', 'YEAR_BUILT', 'BLD_AREA',
  'UNITS', 'RES_AREA', 'STYLE', 'STORIES', 'NUM_ROOMS',
].join(',');

export async function fetchParcels(progress) {
  const wheres = [`TOWN_ID=${CFG.TOWN_ID}`, `TOWN_ID='${CFG.TOWN_ID}'`];
  let lastErr = null;
  for (const where of wheres) {
    try {
      const feats = [];
      for (let page = 0; page < 40; page++) {
        const p = new URLSearchParams({
          where,
          outFields: PARCEL_FIELDS,
          returnGeometry: 'true',
          outSR: '4326',
          f: 'geojson',
          geometryPrecision: '6',
          orderByFields: 'OBJECTID',
          resultOffset: String(page * 2000),
          resultRecordCount: '2000',
        });
        progress(`Downloading assessor parcels from MassGIS… ${feats.length.toLocaleString()} so far`);
        const r = await fetch(CFG.PARCELS + '?' + p.toString());
        if (!r.ok) throw new Error('MassGIS ' + r.status);
        const j = await r.json();
        if (j.error) throw new Error(j.error.message || 'MassGIS error');
        const fs = j.features || [];
        feats.push(...fs);
        const more = (j.properties && j.properties.exceededTransferLimit) || j.exceededTransferLimit || fs.length === 2000;
        if (!fs.length || !more) break;
      }
      if (feats.length > 50) return feats;
      throw new Error('No parcels returned');
    } catch (e) {
      console.warn('Parcels failed', where, e);
      lastErr = e;
    }
  }
  throw lastErr;
}

export async function loadRawData({ refresh = false, progress = () => {} } = {}) {
  if (!refresh) {
    const cached = await kvGet(CFG.RAW_KEY);
    if (cached && cached.osm && cached.osm.length) {
      progress('Loading Watertown from your device…');
      return cached;
    }
  }
  const osm = await fetchOSM(progress);
  let parcels = null,
    parcelError = null;
  try {
    parcels = await fetchParcels(progress);
  } catch (e) {
    parcelError = String(e.message || e);
  }
  const raw = { osm, parcels, parcelError, fetched: new Date().toISOString(), source: 'live' };
  progress('Saving map to your device for next time…');
  await kvSet(CFG.RAW_KEY, raw);
  return raw;
}
