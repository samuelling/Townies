// Procedural stand-in town in the same raw format as the live OSM/MassGIS download.
// Used for the offline "Demoville" mode and for automated testing.
import { CFG } from './config.js';
import { rng } from './util.js';

export function makeDemoRaw() {
  const B = CFG.FETCH_BBOX;
  const latMid = ((B.s + B.n) / 2) * (Math.PI / 180);
  const OX = 1900, OY = 1700; // town origin, metres from the bbox NW corner
  const LL = (mx, my) => ({ lat: B.n - (OY + my) / 110574, lon: B.w + (OX + mx) / (111320 * Math.cos(latMid)) });
  const r = rng(12345);
  const els = [];
  let id = 1;
  const way = (pts, tags) => {
    const g = pts.map(([x, y]) => LL(x, y));
    els.push({ type: 'way', id: id++, tags, geometry: g });
  };
  const rect = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]];
  const parcels = [];
  const parcel = (pts, props) => {
    parcels.push({
      type: 'Feature',
      properties: { TOWN_ID: CFG.TOWN_ID, LOC_ID: 'D' + parcels.length, OBJECTID: parcels.length + 1, LOT_UNITS: 'S', FY: 2026, ...props },
      geometry: { type: 'Polygon', coordinates: [pts.map(([x, y]) => { const p = LL(x, y); return [p.lon, p.lat]; })] },
    });
  };

  // town boundary (irregular)
  const TWn = 2600, THn = 1950;
  const bnd = [];
  for (let k = 0; k <= 12; k++) bnd.push([(k / 12) * TWn, -40 + 60 * Math.sin(k)]);
  for (let k = 1; k <= 8; k++) bnd.push([TWn + 50 * Math.sin(k * 2), (k / 8) * THn]);
  for (let k = 11; k >= 0; k--) bnd.push([(k / 12) * TWn, THn]);
  for (let k = 7; k >= 1; k--) bnd.push([-40 * Math.cos(k), (k / 8) * THn]);
  bnd.push(bnd[0]);
  els.push({
    type: 'relation', id: id++, tags: { boundary: 'administrative', admin_level: '8', name: CFG.TOWN_NAME, type: 'boundary' },
    members: [{ type: 'way', role: 'outer', geometry: bnd.map(([x, y]) => LL(x, y)) }],
  });

  // river along the south edge
  const up = [], lo = [];
  for (let x = -700; x <= TWn + 700; x += 50) {
    const y = THn - 60 + 45 * Math.sin(x / 260);
    up.push([x, y]);
    lo.push([x, y + 95]);
  }
  const riverPoly = up.concat(lo.reverse()).concat([up[0]]);
  els.push({ type: 'relation', id: id++, tags: { natural: 'water', water: 'river', name: 'Charles River', type: 'multipolygon' }, members: [{ type: 'way', role: 'outer', geometry: riverPoly.map(([x, y]) => LL(x, y)) }] });
  way(up.map(([x, y]) => [x, y + 47]), { waterway: 'river', name: 'Charles River' });

  // streets
  const SX = 112, SY = 96;
  const vNames = ['Elm St', 'Maple St', 'Spring St', 'Bacon St', 'Walnut St', 'Chestnut St', 'Orchard St', 'Fayette St', 'Melendy Ave', 'Boylston St', 'Hazel St', 'Cuba St', 'Ladd St', 'Cross St', 'Pine St', 'Cedar St', 'Russell Ave', 'Grove St', 'Edenfield Ave', 'Bigelow Ave', 'Palfrey St', 'Lovell Rd', 'Merrill Rd', 'Prentiss St', 'Lincoln St', 'Hovey St', 'Irma Ave'];
  const hNames = ['Belmont St', 'Common St', 'Church St', 'Summer St', 'Garfield St', 'School St', 'Lexington St', 'Waverley Ave', 'Mount Auburn Street', 'Barnard Ave', 'Riverside St', 'Whites Ave', 'Dexter Ave', 'Arsenal Street', 'Arlington St', 'Bridge St', 'Greenough Boulevard', 'Pleasant Street', 'Galen St', 'Water St'];
  const xsV = [], ysH = [];
  for (let x = -560; x <= TWn + 560; x += SX) xsV.push(x);
  for (let y = -380; y <= THn - 120; y += SY) ysH.push(y);
  xsV.forEach((x, k) => way([[x, -420], [x, THn - 110 + 45 * Math.sin(x / 260) - 10]], { highway: 'residential', name: vNames[k % vNames.length] }));
  ysH.forEach((y, k) => {
    const nm = hNames[k % hNames.length];
    const hw = /Mount Auburn|Arsenal/.test(nm) ? 'primary' : /Common|Lexington|Pleasant/.test(nm) ? 'tertiary' : 'residential';
    way([[-620, y], [TWn + 620, y]], { highway: hw, name: nm });
  });
  way([[-300, THn - 160], [TWn * 0.45, 700], [TWn + 600, -300]], { highway: 'primary', name: 'Main Street' });
  way([[-600, THn - 130], [TWn + 600, THn - 130]].map(([x, y]) => [x, y]), { highway: 'secondary', name: 'Greenough Boulevard' });
  way([[200, -300], [260, THn - 200]], { highway: 'footway', name: 'Community Path' });

  // a park, a cemetery, a school yard
  way(rect(4 * SX + 8, 3 * SY - 380 + 8, SX * 2 - 16, SY * 2 - 16), { leisure: 'park', name: 'Saltonstall Park' });
  way(rect(TWn - 3 * SX, 8 * SY - 380, SX * 2.5, SY * 3), { landuse: 'cemetery', name: 'Ridgelawn' });
  way(rect(-560, -380, 900, 500), { natural: 'wood' });

  const isComm = (cx, cy) => {
    const dMain = Math.abs((cy - (THn - 160)) - ((700 - (THn - 160)) / (TWn * 0.45 + 300)) * (cx + 300));
    return dMain < 70 || Math.abs(cy - ysH[8]) < 55;
  };
  const isInd = (cx, cy) => Math.abs(cy - ysH[13]) < 90 && cx > TWn * 0.35;
  const styles = ['TWO FAMILY', 'TWO FAMILY', 'DECKER', 'COLONIAL', 'CAPE COD', 'CONVENTIONAL', 'VICTORIAN', 'RANCH'];
  const shopNames = ['Demo Diner', 'Square Books', 'Arax Market', 'Sevan Bakery', 'Coolidge Coffee', 'Fifth Corner Pizza', 'Pond Cleaners', 'Bridge Street Hardware', 'Mount Auburn Barbers', 'The Herring', 'Charles River Cycles'];
  let shopK = 0;
  for (let a = 0; a + 1 < xsV.length; a++)
    for (let b = 0; b + 1 < ysH.length; b++) {
      const x0 = xsV[a] + 9, x1 = xsV[a + 1] - 9, y0 = ysH[b] + 9, y1 = ysH[b + 1] - 9;
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      if (cy > THn - 170 + 45 * Math.sin(cx / 260)) continue;
      if (a === 4 && b === 3) continue; // park
      if (cx > TWn - 3 * SX && cy > 8 * SY - 380 && cy < 11 * SY - 380) continue;
      const inside = cx > 0 && cx < TWn && cy > 0 && cy < THn;
      if (isInd(cx, cy)) {
        const w = x1 - x0 - 10, h = y1 - y0 - 10;
        const lab = r() < 0.5;
        way(rect(x0 + 5, y0 + 5, w, h), { building: lab ? 'office' : 'industrial', 'building:levels': String(lab ? 4 + Math.floor(r() * 3) : 2) });
        if (inside) parcel(rect(x0, y0, x1 - x0, y1 - y0), { USE_CODE: lab ? '4000' : '401', USE_DESC: lab ? 'RESEARCH & DEV' : 'WAREHOUSE', SITE_ADDR: `${100 + a * 10} ARSENAL ST`, LAND_VAL: 6e6, BLDG_VAL: lab ? 40e6 : 6e6, TOTAL_VAL: lab ? 46e6 : 12e6, YEAR_BUILT: lab ? 2019 : 1958, BLD_AREA: w * h * 10.76 * (lab ? 5 : 2), LOT_SIZE: (x1 - x0) * (y1 - y0) * 10.76, STORIES: lab ? 5 : 2 });
        continue;
      }
      if (a === 9 && b === 6) {
        way(rect(x0 + 10, y0 + 10, x1 - x0 - 20, (y1 - y0) / 2), { building: 'school', amenity: 'school', name: 'Demo Middle School' });
        if (inside) parcel(rect(x0, y0, x1 - x0, y1 - y0), { USE_CODE: '903', USE_DESC: 'MUNICIPAL SCHOOL', SITE_ADDR: '68 WAVERLEY AVE', LAND_VAL: 5e6, BLDG_VAL: 30e6, TOTAL_VAL: 35e6, YEAR_BUILT: 1926 });
        continue;
      }
      // two rows of lots facing the vertical streets
      const comm = isComm(cx, cy);
      const lotH = comm ? 24 : 16;
      for (let side = 0; side < 2; side++)
        for (let y = y0; y + lotH <= y1 + 0.1; y += lotH) {
          const lx0 = side ? cx : x0, lx1 = side ? x1 : cx;
          const n = Math.round((y - y0) / lotH) * 2 + 2 + side;
          const street = vNames[(a + side) % vNames.length].toUpperCase();
          const addr = `${n * 2 + (side ? 1 : 0)} ${street}`;
          const lotPts = rect(lx0, y, lx1 - lx0, lotH);
          if (comm) {
            const bw = (lx1 - lx0) - 4, bh = lotH - 2;
            const bx = side ? lx0 + 2 : lx0 + 2;
            way(rect(bx, y + 1, bw, bh), { building: 'retail', 'building:levels': String(1 + Math.floor(r() * 3)) });
            if (inside) {
              const nm = shopNames[shopK++ % shopNames.length];
              els.push({ type: 'node', id: id++, tags: { shop: 'bakery', name: nm }, ...LL(bx + bw / 2, y + bh / 2) });
              parcel(lotPts, { USE_CODE: '325', USE_DESC: 'STORE/SHOP', SITE_ADDR: addr, LAND_VAL: 1.1e6, BLDG_VAL: 1.4e6, TOTAL_VAL: 2.5e6, YEAR_BUILT: 1920 + Math.floor(r() * 60), BLD_AREA: bw * bh * 10.76 * 2, LOT_SIZE: (lx1 - lx0) * lotH * 10.76, STORIES: 2 });
            }
          } else {
            const st = styles[Math.floor(r() * styles.length)];
            const units = st === 'DECKER' ? 3 : st === 'TWO FAMILY' ? 2 : 1;
            const hw = 8 + r() * 2, hd = st === 'DECKER' ? 16 : 12 + r() * 4;
            const front = side ? lx1 - 6 - hd : lx0 + 6;
            way(rect(front, y + (lotH - hw) / 2, hd, hw), { building: 'house' });
            if (inside) {
              const code = units === 3 ? '105' : units === 2 ? '104' : '101';
              const yb = 1890 + Math.floor(r() * 80);
              parcel(lotPts, { USE_CODE: code, USE_DESC: units === 3 ? 'THREE FAM RES' : units === 2 ? 'TWO FAM RES' : 'SINGLE FAM RES', STYLE: st, SITE_ADDR: addr, UNITS: units, LAND_VAL: 450e3 + r() * 150e3, BLDG_VAL: 300e3 + r() * 300e3, TOTAL_VAL: 0, YEAR_BUILT: yb, BLD_AREA: hw * hd * 10.76 * (units + 1), LOT_SIZE: (lx1 - lx0) * lotH * 10.76, STORIES: st === 'DECKER' ? 3 : st === 'RANCH' ? 1 : st === 'CAPE COD' ? 1.5 : 2 });
              const p = parcels[parcels.length - 1].properties;
              p.TOTAL_VAL = p.LAND_VAL + p.BLDG_VAL;
            }
          }
        }
    }
  // services
  const svc = (x, y, amenity, name) => {
    way(rect(x, y, 30, 22), { building: 'civic', amenity, name });
  };
  svc(TWn * 0.45, 640, 'townhall', 'Demo City Hall');
  svc(TWn * 0.42, 560, 'police', 'Demo Police HQ');
  svc(TWn * 0.2, 260, 'fire_station', 'Engine 1');
  svc(TWn * 0.8, 980, 'fire_station', 'Engine 2');
  for (let k = 0; k < 120; k++) els.push({ type: 'node', id: id++, tags: { natural: 'tree' }, ...LL(r() * TWn, r() * THn * 0.9) });
  return { osm: els, parcels, demo: true, source: 'demo', fetched: new Date().toISOString() };
}
