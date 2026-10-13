// Intersections: traffic signals, modern roundabouts and old-style rotaries.
// Capacity and delay follow the Highway Capacity Manual (6th ed.) in simplified form:
//  - signals: saturation flow 1,800 veh/h/lane × green share; more legs → more phases → more lost time
//  - roundabouts: entry capacity falls exponentially with the traffic already circulating past the entry
//    (single-lane c = 1380·e^(−0.00102·vc); two-lane ≈ 1420·e^(−0.00085·vc) + 1350·e^(−0.00092·vc))
//  - delay: HCM control-delay formulas; level of service (LOS) from HCM thresholds
// Volumes come from the calibrated traffic model (MassDOT counts), converted to the peak hour.
import { CFG, COVER } from './config.js';
import { clamp, fmtMoney } from './util.js';

const PEAK_K = 0.09, PEAK_D = 0.55, SAT = 1800, T_H = 0.25;

export const DESIGNS = {
  signal: { label: 'Traffic signal', short: 'Signal', blurb: 'What most of Watertown has today. Every extra leg needs its own green phase, and each phase wastes a few seconds of “all red.”', cost: 0, r: 0, months: 0, crash: 1, lv: 0 },
  adaptive: { label: 'Adaptive signals', short: 'Smart signal', blurb: 'Same intersection, with detectors and signal timing that adjusts to traffic. Cheap, quick, modest gains.', cost: 1.2e6, r: 0, months: 4, crash: 0.95, lv: 0, lostF: 0.75, cycle: 80 },
  fourcorners: { label: 'Four Corners (close one leg)', short: 'Four Corners', blurb: 'Take the least-used street out of the intersection and turn it into a plaza. Fewer phases means more green for everyone else, though some traffic has to find another route.', cost: 30e6, r: 0, months: 24, crash: 0.8, lv: 0.12, plaza: true },
  rb1: { label: 'Single-lane roundabout', short: 'Roundabout', blurb: 'Compact modern roundabout: slow (15–20 mph), very safe, short crossings with a refuge island. Runs out of capacity on very busy intersections.', cost: 9e6, r: 1.4, months: 10, crash: 0.22, lv: 0.04, lanes: 1 },
  rb2: { label: 'Two-lane roundabout', short: '2-lane roundabout', blurb: 'More capacity in a bigger footprint. Safer than a signal, but pedestrians cross two lanes at a time and drivers change lanes inside.', cost: 15e6, r: 2.0, months: 14, crash: 0.6, lv: 0.01, lanes: 2 },
  rotary: { label: 'Old-style rotary', short: 'Rotary', blurb: 'The big Massachusetts rotary: wide, fast, with weaving. Moves a lot of cars, but it is a pedestrian moat and a crash magnet.', cost: 22e6, r: 3.4, months: 18, crash: 1.15, lv: -0.05, lanes: 2, capF: 1.1, extraDelay: 4 },
};
export const DESIGN_ORDER = ['signal', 'adaptive', 'fourcorners', 'rb1', 'rb2', 'rotary'];

const LOS_SIG = [10, 20, 35, 55, 80];
const LOS_RB = [10, 15, 25, 35, 50];
const losOf = (d, x, th) => (x > 1 ? 'F' : 'ABCDEF'[th.findIndex((t) => d <= t) < 0 ? 5 : th.findIndex((t) => d <= t)]);

// ---- legs: where main streets cross a circle around the intersection ----
export function findLegs(sim, cx, cy, R = 7) {
  const w = sim.w;
  const hits = [];
  for (const ln of w.roadLines) {
    if (ln.ring) continue;
    const p = ln.pts;
    for (let k = 0; k + 3 < p.length; k += 2) {
      const ax = p[k] - cx, ay = p[k + 1] - cy, bx = p[k + 2] - cx, by = p[k + 3] - cy;
      const dx = bx - ax, dy = by - ay;
      const A = dx * dx + dy * dy, B = 2 * (ax * dx + ay * dy), C = ax * ax + ay * ay - R * R;
      const disc = B * B - 4 * A * C;
      if (A < 1e-9 || disc < 0) continue;
      for (const sg of [-1, 1]) {
        const t = (-B + sg * Math.sqrt(disc)) / (2 * A);
        if (t < 0 || t > 1) continue;
        const x = cx + ax + dx * t, y = cy + ay + dy * t;
        const ti = Math.floor(y) * w.W + Math.floor(x);
        if (ln.cls < 2 && !(w.aadt && w.aadt[ti] >= 5000)) continue;
        hits.push({ ang: Math.atan2(y - cy, x - cx), x, y, cls: ln.cls, nm: w.roadName[ti] || 0 });
      }
    }
  }
  hits.sort((a, b) => a.ang - b.ang);
  const legs = [];
  for (const h of hits) {
    const last = legs[legs.length - 1];
    // nearby crossings of the same street are one leg; different streets stay separate unless almost on top
    if (last && Math.abs(h.ang - last.ang) < (h.nm && last.nm && h.nm !== last.nm ? 0.1 : 0.3)) continue;
    legs.push(h);
  }
  if (legs.length > 1 && Math.abs(legs[0].ang + 2 * Math.PI - legs[legs.length - 1].ang) < 0.3) legs.pop();
  const { W, H } = w;
  for (const L of legs) {
    // nearest road tile to the crossing point: volume and lanes come from there
    let best = -1, bd = 9;
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) {
        const x = Math.floor(L.x) + dx, y = Math.floor(L.y) + dy;
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const i = y * W + x;
        if (!w.road[i]) continue;
        const d = Math.hypot(x + 0.5 - L.x, y + 0.5 - L.y);
        if (d < bd) { bd = d; best = i; }
      }
    L.tile = best;
    L.lanes = best >= 0 ? w.lanes[best] || (w.road[best] >= 3 ? 4 : 2) : 2;
  }
  return legs.filter((L) => L.tile >= 0).slice(0, 7);
}

// inbound peak-hour volume per leg (veh/h)
export function legVolumes(sim, legs) {
  return legs.map((L) => {
    const vpd = sim.vpd && sim.vpd[L.tile] > 0 ? sim.vpd[L.tile] : 6000;
    return vpd * PEAK_K * PEAK_D;
  });
}

// ---- performance of a design for given legs/volumes ----
export function evaluate(design, legs, vols, calib = 1) {
  const D = DESIGNS[design];
  let n = legs.length;
  let v = vols.slice(), lanes = legs.map((L) => clamp(Math.round(L.lanes / 2), 1, 3)), angs = legs.map((L) => L.ang);
  let dropped = -1;
  if (D.plaza && n >= 4) {
    // close the least-used leg; half its traffic shifts to the others, half finds another route
    dropped = v.indexOf(Math.min(...v));
    const moved = v[dropped] * 0.5;
    v.splice(dropped, 1); lanes.splice(dropped, 1); angs.splice(dropped, 1);
    n--;
    v = v.map((x) => x + moved / n);
  }
  const res = { design, n, legs: [] };
  if (!D.lanes) {
    // signal: phases, lost time, green share
    const phases = n <= 3 ? 2 : n - 1;
    const Cyc = D.cycle || 90;
    const lost = 4 * phases * (D.lostF || 1);
    const gC = (Cyc - lost) / phases / Cyc;
    for (let i = 0; i < n; i++) {
      const c = lanes[i] * SAT * gC * calib; // calib: turn lanes and geometry the simple model can't see
      const X = v[i] / c;
      const d1 = (0.5 * Cyc * (1 - gC) ** 2) / (1 - Math.min(1, X) * gC);
      const d2 = 900 * T_H * (X - 1 + Math.sqrt((X - 1) ** 2 + (8 * 0.5 * X) / (c * T_H)));
      res.legs.push({ v: v[i], c, X, d: d1 + d2 });
    }
    res.th = LOS_SIG;
    res.conflicts = [0, 0, 0, 9, 32, 60, 100, 150][n] || 150;
    res.ped = `${Math.max(...lanes) * 2} lanes, with a walk signal (average wait ${Math.round(((Cyc - 20) ** 2) / (2 * Cyc))} s)`;
  } else {
    // roundabout: circulating flow past each entry, assuming trips spread evenly to the other legs
    const order = angs.map((a, i) => [a, i]).sort((p, q) => p[0] - q[0]).map((p) => p[1]);
    const pos = new Array(n);
    order.forEach((li, k) => (pos[li] = k));
    for (let i = 0; i < n; i++) {
      let vc = 0;
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        // counter-clockwise from entry j: a trip to destination d passes entry i if i lies strictly between
        for (let d = 0; d < n; d++) {
          if (d === j) continue;
          const sj = pos[j], si = (pos[i] - sj + n) % n, sd = (pos[d] - sj + n) % n;
          if (si > 0 && si < sd) vc += v[j] / (n - 1);
        }
      }
      let c = D.lanes === 1 ? 1380 * Math.exp(-0.00102 * vc) : 1420 * Math.exp(-0.00085 * vc) + 1350 * Math.exp(-0.00092 * vc);
      c *= D.capF || 1;
      const X = v[i] / c;
      const d = 3600 / c + 900 * T_H * (X - 1 + Math.sqrt((X - 1) ** 2 + ((3600 / c) * X) / (450 * T_H))) + 5 * Math.min(X, 1) + (D.extraDelay || 0);
      res.legs.push({ v: v[i], c, X, d, vc });
    }
    res.th = LOS_RB;
    res.conflicts = D.lanes === 1 ? 2 * n : design === 'rotary' ? 8 * n : 6 * n;
    res.ped = D.lanes === 1 ? 'one lane at a time, with a refuge island; drivers going 15–20 mph' : design === 'rotary' ? 'two or three fast lanes, no signal' : 'two lanes at a time; drivers yield, mostly';
  }
  const vt = res.legs.reduce((a, l) => a + l.v, 0) || 1;
  res.delay = res.legs.reduce((a, l) => a + l.v * Math.min(l.d, 300), 0) / vt;
  res.X = Math.max(...res.legs.map((l) => l.X));
  res.los = losOf(res.delay, res.X, res.th);
  res.queue = Math.max(...res.legs.map((l) => (l.v * Math.min(l.d, 300)) / 3600));
  res.cap = res.legs.reduce((a, l) => a + l.c, 0);
  res.crash = D.crash;
  res.dropped = dropped;
  return res;
}

// ---- the Square (and any other controlled intersection) in the traffic model ----
export function squareCtl(sim) {
  const w = sim.w;
  if (!w.ctl) w.ctl = [];
  let c = w.ctl.find((x) => x.id === 'square');
  if (!c) {
    // the junction near the Square where the most main streets actually pass through
    const [sx, sy] = w.start;
    let x = sx, y = sy, bestN = -1, bestD = 1e9;
    const segDist = (px, py, ax, ay, bx, by) => { const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy || 1e-9; const t = clamp(((px - ax) * dx + (py - ay) * dy) / L, 0, 1); return Math.hypot(ax + dx * t - px, ay + dy * t - py); };
    for (const [jx, jy] of w.junctions || []) {
      const dj = Math.hypot(jx - sx, jy - sy);
      if (dj > 10) continue;
      let n = 0;
      for (const ln of w.roadLines) {
        if (ln.cls < 2 && !(w.aadt && w.aadt[Math.floor(ln.pts[1]) * w.W + Math.floor(ln.pts[0])] >= 5000)) continue;
        const p = ln.pts;
        for (let k = 0; k + 3 < p.length; k += 2) if (segDist(jx, jy, p[k], p[k + 1], p[k + 2], p[k + 3]) < 1.3) { n++; break; }
      }
      if (n > bestN || (n === bestN && dj < bestD)) { bestN = n; bestD = dj; x = jx; y = jy; }
    }
    c = { id: 'square', name: 'Watertown Square', x, y, design: sim.flags && sim.flags.squareDone ? 'fourcorners' : 'signal', r: 0 };
    w.ctl.push(c);
  }
  if (!c.legs) c.legs = findLegs(sim, c.x, c.y, Math.max(7, (c.r || 0) + 3)).map((L) => ({ ang: L.ang, x: L.x, y: L.y, tile: L.tile, lanes: L.lanes }));
  return c;
}

// capacity multiplier per road tile near controlled intersections, relative to an ordinary arterial
// (the base model assumes ~800 veh/h per lane, i.e. a simple two-phase signal)
export function junctionFactors(sim) {
  const w = sim.w;
  if (!w.ctl || !w.ctl.length || !w.roadLines) return null;
  if (!sim.jf || sim.jf.length !== sim.N) sim.jf = new Float32Array(sim.N);
  const jf = sim.jf;
  jf.fill(1);
  for (const c of w.ctl) {
    if (!c.legs || !c.legs.length) continue;
    const vols = legVolumes(sim, c.legs);
    if (c.calib == null && c.id === 'square' && sim.vpd && sim.vpd.some((v) => v > 0)) {
      // today's signal demonstrably carries today's counted traffic: calibrate it to run at capacity
      const ev0 = evaluate('signal', c.legs, vols, 1);
      c.calib = clamp(ev0.X / 0.97, 1, 5);
    }
    const ev = evaluate(c.design, c.legs, vols, c.calib || 1);
    const base = c.legs.reduce((a, L) => a + clamp(Math.round(L.lanes / 2), 1, 3) * 800, 0);
    const f = clamp(ev.cap / base, 0.25, 2.5);
    c.last = { delay: ev.delay, los: ev.los, X: ev.X };
    const R = (c.r || 0) + 3.5;
    const { W } = w;
    for (let y = Math.floor(c.y - R); y <= Math.ceil(c.y + R); y++)
      for (let x = Math.floor(c.x - R); x <= Math.ceil(c.x + R); x++) {
        if (x < 0 || y < 0 || x >= W || y >= w.H) continue;
        if (Math.hypot(x + 0.5 - c.x, y + 0.5 - c.y) > R) continue;
        jf[y * W + x] = f;
      }
  }
  return jf;
}

// ---- building a design ----
// returns { ok, msg, cost, tiles, demolish: [lot ids] } for a preview, or applies it when apply = true
export function planDesign(sim, c, design, apply = false) {
  const w = sim.w, { W, H } = w;
  const D = DESIGNS[design];
  const pf = sim.priceF ? sim.priceF() : 1;
  let cost = D.cost * pf;
  const ring = [], island = [], lotsHit = new Set();
  if (D.r) {
    const R = D.r;
    for (let y = Math.floor(c.y - R - 1); y <= Math.ceil(c.y + R + 1); y++)
      for (let x = Math.floor(c.x - R - 1); x <= Math.ceil(c.x + R + 1); x++) {
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const i = y * W + x;
        const d = Math.hypot(x + 0.5 - c.x, y + 0.5 - c.y);
        if (d <= R + 0.7 && d >= R - 0.7) ring.push(i);
        else if (d < R - 0.7) island.push(i);
        else continue;
        if (w.bAt[i] >= 0 && w.bldgs[w.bAt[i]].alive && w.lotOf[i] >= 0) lotsHit.add(w.lotOf[i]);
      }
    for (const li of lotsHit) cost += (w.lots[li].landVal + w.lots[li].bldgVal) * 1.2; // eminent domain at a premium
  }
  const bad = [...ring, ...island].some((i) => !w.inTown[i] || w.terrain[i] === 1 || w.svcAt[i] >= 0);
  const out = { ok: !bad, cost, tiles: [...ring, ...island], lots: [...lotsHit], msg: bad ? 'Too close to the river, a city facility, or the town line' : '' };
  if (!apply || !out.ok) return out;
  // --- apply ---
  const touched = [];
  for (const li of lotsHit) {
    const lot = w.lots[li];
    for (const id of lot.bldgs) w.bldgs[id].alive && (w.bldgs[id].alive = 0);
    lot.bldgs = [];
    lot.bldgVal = 0;
    lot.baseBldg = 0;
    lot.units = 0;
    lot.jobs = 0;
    lot.biz = [];
    lot.sf = [];
    lot.storefronts = 0;
    lot.vacant = 0;
    touched.push(...lot.tiles);
  }
  for (const i of [...ring, ...island]) if (w.bAt[i] >= 0) w.bAt[i] = -1;
  if (D.r) {
    clipLines(w, c.x, c.y, D.r);
    for (const i of ring) {
      w.road[i] = design === 'rotary' ? 3 : 2;
      w.osmRoad[i] = 1;
      w.roadCut[i] = 0;
      w.tree[i] = 0;
      if (w.lotOf[i] >= 0) sim.removeTileFromLot(w.lotOf[i], i);
    }
    for (const i of island) {
      w.road[i] = 0;
      if (w.osmRoad[i]) w.roadCut[i] = 1;
      w.cover[i] = COVER.PARK;
      if (w.lotOf[i] >= 0) sim.removeTileFromLot(w.lotOf[i], i);
      w.tree[i] = (i * 2654435761) % 7 === 0 ? 1 : 0;
    }
    const pts = [];
    for (let k = 0; k <= 36; k++) { const a = (k / 36) * Math.PI * 2; pts.push(c.x + Math.cos(a) * D.r, c.y + Math.sin(a) * D.r); }
    w.roadLines.push({ cls: design === 'rotary' ? 3 : 2, pts: Float32Array.from(pts), bridge: false, ring: 1 });
    touched.push(...ring, ...island);
  }
  if (D.plaza && c.legs && c.legs.length >= 4) {
    // close the least-used leg between 1.5 and 5 tiles from the center and make it a lawn
    const vols = legVolumes(sim, c.legs);
    const L = c.legs[vols.indexOf(Math.min(...vols))];
    const ux = Math.cos(L.ang), uy = Math.sin(L.ang);
    for (let t = 1.2; t <= 5; t += 0.25)
      for (const off of [-0.6, 0, 0.6]) {
        const x = Math.floor(c.x + ux * t - uy * off), y = Math.floor(c.y + uy * t + ux * off);
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const i = y * W + x;
        if (!w.road[i]) { if (w.lotOf[i] < 0 && w.bAt[i] < 0) w.cover[i] = COVER.PARK; continue; }
        w.road[i] = 0;
        if (w.osmRoad[i]) w.roadCut[i] = 1;
        w.cover[i] = COVER.PARK;
        touched.push(i);
      }
    c.closed = L.ang;
  }
  c.design = design;
  c.r = D.r || 0;
  c.legs = null; // re-detect legs against the new geometry
  squareLegs(sim, c);
  sim.funds -= cost;
  sim.rebuildRoadList();
  sim.refreshRoadAccess(touched.length ? touched : [Math.floor(c.y) * W + Math.floor(c.x)]);
  if (D.lv) sim.lvNear({ at: [c.x, c.y], r: 18, amt: D.lv });
  if (D.months) {
    sim.capNear({ at: [c.x, c.y], r: (D.r || 0) + 8, amt: -0.25 });
    sim.pending.push({ at: sim.t + D.months, id: 'junction-done', data: { id: c.id, x: c.x, y: c.y, r: (D.r || 0) + 8, design } });
  }
  sim.walkDirty = true;
  sim.parkPts = null;
  sim.hooks.roadsChanged && sim.hooks.roadsChanged(touched);
  if (sim.flow && sim.reassign) sim.reassign();
  sim.computeAll();
  sim.updateApproval();
  return out;
}

function squareLegs(sim, c) {
  c.legs = findLegs(sim, c.x, c.y, Math.max(7, (c.r || 0) + 3)).map((L) => ({ ang: L.ang, x: L.x, y: L.y, tile: L.tile, lanes: L.lanes }));
}

// cut every road polyline at a circle, keeping the parts outside (so streets end at the ring)
export function clipLines(w, cx, cy, R) {
  const out = [];
  for (const ln of w.roadLines) {
    const p = ln.pts;
    let cur = [];
    const inside = (x, y) => Math.hypot(x - cx, y - cy) < R;
    let touched = false;
    for (let k = 0; k + 1 < p.length; k += 2) {
      const x = p[k], y = p[k + 1];
      const pin = inside(x, y);
      if (k > 0) {
        const px = p[k - 2], py = p[k - 1];
        const ppin = inside(px, py);
        if (pin !== ppin) {
          // boundary crossing
          touched = true;
          const t = crossT(px - cx, py - cy, x - cx, y - cy, R);
          const bx = px + (x - px) * t, by = py + (y - py) * t;
          if (!ppin) { cur.push(bx, by); if (cur.length >= 4) out.push({ ...ln, pts: Float32Array.from(cur) }); cur = []; }
          else cur = [bx, by];
        } else if (pin) touched = true;
      }
      if (!pin) cur.push(x, y);
    }
    if (!touched) { out.push(ln); continue; }
    if (cur.length >= 4) out.push({ ...ln, pts: Float32Array.from(cur) });
  }
  w.roadLines.length = 0;
  w.roadLines.push(...out);
}
function crossT(ax, ay, bx, by, R) {
  const dx = bx - ax, dy = by - ay;
  const A = dx * dx + dy * dy, B = 2 * (ax * dx + ay * dy), C = ax * ax + ay * ay - R * R;
  const disc = Math.max(0, B * B - 4 * A * C);
  const t1 = (-B - Math.sqrt(disc)) / (2 * A), t2 = (-B + Math.sqrt(disc)) / (2 * A);
  return t1 >= 0 && t1 <= 1 ? t1 : clamp(t2, 0, 1);
}

// a roundabout anywhere: the nearest street intersection to a tapped tile
export function ctlAt(sim, x, y) {
  const w = sim.w;
  let best = null, bd = 3.5;
  for (const [jx, jy] of w.junctions || []) {
    const d = Math.hypot(jx - x, jy - y);
    if (d < bd) { bd = d; best = [jx, jy]; }
  }
  const [cx, cy] = best || [x + 0.5, y + 0.5];
  const sq = squareCtl(sim);
  if (Math.hypot(sq.x - cx, sq.y - cy) < 5) return sq;
  let c = w.ctl.find((k) => Math.hypot(k.x - cx, k.y - cy) < 2);
  if (!c) {
    c = { id: `j${Math.round(cx)}_${Math.round(cy)}`, name: 'Intersection', x: cx, y: cy, design: 'signal', r: 0, temp: 1 };
    squareLegs(sim, c);
  }
  return c;
}
export function adoptCtl(sim, c) {
  if (!sim.w.ctl.includes(c)) { delete c.temp; sim.w.ctl.push(c); }
}

export const fmtCost = (v) => fmtMoney(v);
export { CFG };
