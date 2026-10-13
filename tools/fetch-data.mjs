#!/usr/bin/env node
// Downloads Watertown from OpenStreetMap (Overpass) and the MassGIS tax parcels,
// trims it to what the game needs, and writes data/watertown.json.gz.
// Run by .github/workflows/refresh-data.yml; also runnable locally: node tools/fetch-data.mjs
// Flags: --demo (use the procedural demo town instead of the network), --out <path>
import { writeFileSync, mkdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { dirname } from 'node:path';
import { CFG } from '../js/config.js';
import { overpassQuery, PARCEL_FIELDS, compactRaw, townCrop, SNAPSHOT_PATH } from '../js/snapshot.js';

const args = process.argv.slice(2);
const DEMO = args.includes('--demo');
const OUT = args.includes('--out') ? args[args.indexOf('--out') + 1] : SNAPSHOT_PATH;
const LOG = dirname(OUT) + '/refresh-log.txt';
const UA = 'Townies/1.0 (city sim; https://github.com/samuelling/Townies)';
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

async function fetchOverpass() {
  const body = 'data=' + encodeURIComponent(overpassQuery(CFG.FETCH_BBOX));
  for (let attempt = 0; attempt < 3; attempt++) {
    for (const url of OVERPASS) {
      try {
        log(`Overpass: ${url} (attempt ${attempt + 1})`);
        const r = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA, Accept: 'application/json' },
          body,
          signal: AbortSignal.timeout(300000),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
        const j = await r.json();
        if (!j.elements || j.elements.length < 1000) throw new Error(`only ${j.elements ? j.elements.length : 0} elements`);
        if (j.remark) log(`  remark: ${j.remark}`);
        log(`  got ${j.elements.length} elements`);
        return j.elements;
      } catch (e) {
        log(`  failed: ${e.message}`);
      }
    }
    await sleep(30000 * (attempt + 1));
  }
  throw new Error('All Overpass servers failed');
}

async function arcgis(params) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await fetch(CFG.PARCELS, {
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
      await sleep(5000 * (attempt + 1));
    }
  }
  throw new Error('MassGIS unavailable');
}

async function fetchParcels() {
  const wheres = [`TOWN_ID=${CFG.TOWN_ID}`, `TOWN_ID='${CFG.TOWN_ID}'`, `CITY='${CFG.TOWN_NAME.toUpperCase()}'`];
  let ids = null, where = null;
  for (const w of wheres) {
    try {
      const j = await arcgis({ where: w, returnIdsOnly: 'true', f: 'json' });
      const n = (j.objectIds || []).length;
      log(`MassGIS ids for ${w}: ${n}`);
      if (n > 100) {
        ids = j.objectIds.sort((a, b) => a - b);
        where = w;
        break;
      }
    } catch (e) {
      log(`  ${w}: ${e.message}`);
    }
  }
  if (!ids) throw new Error('No parcel ids returned');
  const feats = [];
  const CH = 400;
  for (let i = 0; i < ids.length; i += CH) {
    const j = await arcgis({
      objectIds: ids.slice(i, i + CH).join(','),
      outFields: PARCEL_FIELDS.join(','),
      returnGeometry: 'true',
      outSR: '4326',
      geometryPrecision: '6',
      f: 'geojson',
    });
    feats.push(...(j.features || []));
    if ((i / CH) % 5 === 0) log(`  parcels ${feats.length}/${ids.length}`);
  }
  log(`MassGIS: ${feats.length} parcel records (${where})`);
  return feats;
}

async function main() {
  let raw;
  if (DEMO) {
    const { makeDemoRaw } = await import('../js/demo.js');
    raw = makeDemoRaw();
    log('Using the procedural demo town');
  } else {
    const osm = await fetchOverpass();
    let parcels = null, parcelError = null;
    try {
      parcels = await fetchParcels();
    } catch (e) {
      parcelError = e.message;
      log(`Parcels failed: ${e.message}`);
    }
    raw = { osm, parcels, parcelError, fetched: new Date().toISOString() };
  }
  const crop = townCrop(raw.osm, CFG.MARGIN_M + 150);
  if (!crop) throw new Error(`No boundary relation for ${CFG.TOWN_NAME} — refusing to write a snapshot`);
  const snap = compactRaw(raw, crop);
  const nB = snap.ways.filter((w) => w[0].building).length + snap.rels.filter((r) => r[0].building).length;
  const nR = snap.ways.filter((w) => w[0].highway).length;
  log(`Kept ${snap.nodes.length} nodes, ${snap.ways.length} ways (${nB} buildings, ${nR} highways), ${snap.rels.length} relations, ${snap.parcels.length} parcels`);
  if (!DEMO) {
    if (nB < 2000) throw new Error(`Only ${nB} buildings — refusing to write a snapshot`);
    if (snap.parcels.length < 2000) throw new Error(`Only ${snap.parcels.length} parcels — refusing to overwrite the snapshot`);
  }
  const json = JSON.stringify(snap);
  const gz = gzipSync(json, { level: 9 });
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, gz);
  log(`Wrote ${OUT}: ${(json.length / 1e6).toFixed(1)} MB JSON, ${(gz.length / 1e6).toFixed(2)} MB gzipped`);
}

main()
  .then(() => writeLog(true))
  .catch((e) => {
    log(`ERROR: ${e.stack || e.message}`);
    writeLog(false);
    process.exit(1);
  });
