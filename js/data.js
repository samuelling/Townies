import { CFG } from './config.js';
import { overpassQuery, PARCEL_FIELDS as PF, expandSnapshot, SNAPSHOT_PATH } from './snapshot.js';

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

// ---------- OpenStreetMap via Overpass (live fallback) ----------
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

// ---------- MassGIS property tax parcels (live fallback) ----------
const PARCEL_FIELDS = PF.join(',');

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

// ---------- pre-built snapshot (data/watertown.json.gz, refreshed by a GitHub Action) ----------
export async function fetchSnapshot(progress) {
  progress('Unfolding the map of Watertown…');
  const r = await fetch(SNAPSHOT_PATH, { cache: 'no-cache' });
  if (!r.ok) throw new Error('No map snapshot (' + r.status + ')');
  const total = +r.headers.get('content-length') || 0;
  let bytes;
  if (r.body && r.body.getReader) {
    const reader = r.body.getReader();
    const chunks = [];
    let n = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      n += value.length;
      progress(`Unfolding the map of Watertown… ${(n / 1e6).toFixed(1)}${total ? ' / ' + (total / 1e6).toFixed(1) : ''} MB`);
    }
    bytes = new Uint8Array(n);
    let o = 0;
    for (const c of chunks) {
      bytes.set(c, o);
      o += c.length;
    }
  } else bytes = new Uint8Array(await r.arrayBuffer());
  let text;
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot unzip the map');
    const ds = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    text = await new Response(ds).text();
  } else text = new TextDecoder().decode(bytes); // server already decompressed it
  return expandSnapshot(JSON.parse(text));
}

// ---------- the town assessor's building records (data/assessor.json.gz, built by tools/assessor/) ----------
// Wall material, roof shape and cover, fireplaces, porches and a siding colour read from the assessor's photo.
// Optional: without it, buildings fall back to the state parcel data alone.
export async function fetchAssessor(path = 'data/assessor.json.gz') {
  try {
    const r = await fetch(path, { cache: 'no-cache' });
    if (!r.ok) return null;
    const bytes = new Uint8Array(await r.arrayBuffer());
    let text;
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
      if (typeof DecompressionStream === 'undefined') return null;
      text = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
    } else text = new TextDecoder().decode(bytes);
    return JSON.parse(text);
  } catch (e) {
    console.warn('Missing ' + path, e);
    return null;
  }
}

// roofs measured from the 2021 USGS lidar (data/lidar.json.gz, built by tools/lidar/): optional too
export const fetchLidar = () => fetchAssessor('data/lidar.json.gz');
// every tree, from the lidar and the town's 2022 inventory (data/trees.json.gz, built by tools/trees/)
export const fetchTrees = () => fetchAssessor('data/trees.json.gz');
// unmapped backyard roofs the lidar found (data/yards.json.gz, built by tools/yards/)
export const fetchYards = () => fetchAssessor('data/yards.json.gz');
// MBTA bus routes, stops and timetables (data/transit.json.gz, built by tools/transit/)
export const fetchTransit = () => fetchAssessor('data/transit.json.gz');

export async function loadRawData({ refresh = false, progress = () => {} } = {}) {
  const forceLive = typeof location !== 'undefined' && new URLSearchParams(location.search).has('live');
  if (!forceLive) {
    try {
      return await fetchSnapshot(progress);
    } catch (e) {
      console.warn('Snapshot unavailable, falling back to live download', e);
    }
  }
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
