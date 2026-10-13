// Traffic assignment: who drives where, along which streets.
// A small four-step model, the way regional planners do it, at the scale of a town:
//  1. trip generation: homes produce trips, jobs and shops attract them; arterials at the town line
//     bring in commuters and through traffic (Watertown sits between Boston, Cambridge, Newton and Waltham)
//  2. distribution: a gravity model (nearer destinations are likelier)
//  3. route choice: shortest travel time over the actual street grid, slowed by congestion and by
//     intersection delay (signals, roundabouts), re-run a few times so traffic spreads out (MSA)
//  4. result: vehicles per day on every street tile
// Parameters were tuned so the result best matches MassDOT traffic counts (see tools/ and Behind the scenes).
import { clamp } from './util.js';

export const TP = {
  zone: 12, // tiles per traffic zone edge
  homeTrips: 6.5, // daily vehicle trips per home
  jobTrips: 2.2, // per job (commute + visitors)
  thru: 1.4, // through/commuter trips at the town line, relative to all internal trips
  extPow: 3, // how strongly through traffic favours bigger roads at the town line
  beta: 0.15, // gravity decay per minute of travel
  speeds: [0, 7, 12.5, 17], // m/s by road class (local, collector, arterial): ~16, 28, 38 mph
  iters: 2,
};

// binary heap of [cost, node]
class Heap {
  constructor() { this.k = []; this.v = []; }
  push(c, n) { const k = this.k, v = this.v; let i = k.length; k.push(c); v.push(n); while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= c) break; k[i] = k[p]; v[i] = v[p]; i = p; } k[i] = c; v[i] = n; }
  pop() {
    const k = this.k, v = this.v, top = v[0], last = k.length - 1;
    const c = k[last], n = v[last];
    k.pop(); v.pop();
    if (last > 0) {
      let i = 0;
      for (;;) { let l = 2 * i + 1; if (l >= last) break; if (l + 1 < last && k[l + 1] < k[l]) l++; if (k[l] >= c) break; k[i] = k[l]; v[i] = v[l]; i = l; }
      k[i] = c; v[i] = n;
    }
    return top;
  }
  get size() { return this.k.length; }
}

// Everything the assignment needs, as plain arrays (so it can run in a Web Worker)
export function buildInput(sim, prm = TP) {
  const w = sim.w;
  const { W, H, road, inTown, lots } = w;
  const N = W * H;
  const rl = sim.roadList;
  // ---- zones (internal) ----
  const ZW = Math.ceil(W / prm.zone), ZH = Math.ceil(H / prm.zone);
  const prod = new Float32Array(ZW * ZH), attr = new Float32Array(ZW * ZH), node = new Int32Array(ZW * ZH).fill(-1);
  const best = new Float32Array(ZW * ZH);
  for (const lot of lots) {
    if (lot.dead || lot.road < 0 || !lot.inTown) continue;
    const z = Math.min(ZH - 1, Math.floor(lot.cy / prm.zone)) * ZW + Math.min(ZW - 1, Math.floor(lot.cx / prm.zone));
    const p = (lot.units || 0) * prm.homeTrips * lot.occ;
    const a = (lot.jobs || 0) * prm.jobTrips * lot.occ * (lot.tripF || 1);
    prod[z] += p * (lot.tripF || 1);
    attr[z] += a;
    if (p + a > best[z]) { best[z] = p + a; node[z] = lot.road; }
  }
  const zones = [];
  for (let z = 0; z < ZW * ZH; z++) if (node[z] >= 0 && prod[z] + attr[z] > 0) zones.push({ n: node[z], P: prod[z], A: attr[z], ext: 0 });
  const totalInt = zones.reduce((s, z) => s + z.P, 0);
  // ---- external stations: main roads crossing the town line ----
  const ext = [];
  for (const i of rl) {
    if (!inTown[i] || road[i] < 2) continue;
    const x = i % W;
    if ([x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W].some((j) => j < 0 || j >= N || (road[j] && !inTown[j]))) {
      if (ext.some((e) => Math.abs((e.n % W) - x) + Math.abs(((e.n / W) | 0) - ((i / W) | 0)) < 6)) continue;
      const lanes = w.lanes && w.lanes[i] ? w.lanes[i] : road[i] >= 3 ? 4 : 2;
      ext.push({ n: i, wgt: Math.pow(road[i], prm.extPow) * lanes });
    }
  }
  const wSum = ext.reduce((s, e) => s + e.wgt, 0) || 1;
  const extTrips = totalInt * prm.thru;
  for (const e of ext) { e.P = (extTrips * e.wgt) / wSum; e.A = e.P; e.ext = 1; zones.push(e); }
  // ---- link costs (seconds per tile) ----
  const base = new Float32Array(N);
  for (const i of rl) base[i] = 16 / prm.speeds[road[i] || 1];
  const jdelay = new Float32Array(N);
  for (const c of w.ctl || []) {
    if (!c.last) continue;
    const R = (c.r || 0) + 1.5;
    for (let y = Math.floor(c.y - R); y <= Math.ceil(c.y + R); y++)
      for (let x = Math.floor(c.x - R); x <= Math.ceil(c.x + R); x++) {
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const i = y * W + x;
        if (road[i] && Math.hypot(x + 0.5 - c.x, y + 0.5 - c.y) <= R) jdelay[i] = Math.min(240, c.last.delay) / 3;
      }
  }
  const capDay = new Float32Array(N);
  for (const i of rl) { const lanes = (w.lanes && w.lanes[i]) || (road[i] >= 3 ? 4 : 2); capDay[i] = (Math.max(1, lanes / 2) * 800) / (0.09 * 0.55); }
  const zn = new Int32Array(zones.length), zP = new Float64Array(zones.length), zA = new Float64Array(zones.length), zE = new Uint8Array(zones.length);
  zones.forEach((z, k) => { zn[k] = z.n; zP[k] = z.P; zA[k] = z.A; zE[k] = z.ext; });
  return { W, H, N, road: road.slice(), rl: Int32Array.from(rl), base, jdelay, capDay, zn, zP, zA, zE, prm: { beta: prm.beta, iters: prm.iters }, nInt: zones.length - ext.length, ext: ext.length, trips: totalInt };
}

export function assignCore(inp) {
  const { W, N, road, rl, base, jdelay, capDay, zn, zP, zA, prm } = inp;
  const Z = zn.length;
  let flow = new Float32Array(N);
  const cost = new Float32Array(N);
  const dist = new Float64Array(N), pred = new Int32Array(N), order = new Int32Array(N), settled = new Uint8Array(N);
  const loc = new Float64Array(N);
  const nbr = [0, 0, 0, 0];
  for (let it = 0; it < prm.iters; it++) {
    for (const i of rl) cost[i] = base[i] * (1 + 0.15 * Math.pow(flow[i] / capDay[i], 4)) + jdelay[i];
    const add = new Float32Array(N);
    for (let oz = 0; oz < Z; oz++) {
      const o = { n: zn[oz], P: zP[oz] };
      if (!(o.P > 0)) continue;
      // shortest travel-time tree from this origin (Dijkstra)
      for (const i of rl) { dist[i] = Infinity; settled[i] = 0; }
      const hp = new Heap();
      dist[o.n] = 0; pred[o.n] = -1; hp.push(0, o.n);
      let cnt = 0;
      while (hp.size) {
        const u = hp.pop();
        if (settled[u]) continue;
        settled[u] = 1;
        order[cnt++] = u;
        const du = dist[u], x = u % W;
        nbr[0] = x > 0 ? u - 1 : -1; nbr[1] = x < W - 1 ? u + 1 : -1; nbr[2] = u >= W ? u - W : -1; nbr[3] = u + W < N ? u + W : -1;
        for (let q = 0; q < 4; q++) {
          const v = nbr[q];
          if (v < 0 || !road[v] || settled[v]) continue;
          const nd = du + cost[v];
          if (nd < dist[v]) { dist[v] = nd; pred[v] = u; hp.push(nd, v); }
        }
      }
      // gravity: trips spread over destinations by attraction × e^(−β·minutes)
      let tot = 0;
      for (let dz = 0; dz < Z; dz++) {
        const dn = zn[dz];
        if (dz === oz || !(zA[dz] > 0) || !settled[dn]) continue;
        tot += zA[dz] * Math.exp((-prm.beta * dist[dn]) / 60);
      }
      if (!tot) continue;
      for (let dz = 0; dz < Z; dz++) {
        const dn = zn[dz];
        if (dz === oz || !(zA[dz] > 0) || !settled[dn]) continue;
        loc[dn] += (o.P * zA[dz] * Math.exp((-prm.beta * dist[dn]) / 60)) / tot;
      }
      // push trips from destinations back up the tree toward the origin
      for (let k = cnt - 1; k > 0; k--) {
        const u = order[k], v = loc[u];
        if (!v) continue;
        add[u] += v;
        loc[pred[u]] += v;
        loc[u] = 0;
      }
      add[o.n] += loc[o.n];
      loc[o.n] = 0;
    }
    // method of successive averages
    const a = 1 / (it + 1);
    for (const i of rl) flow[i] = flow[i] * (1 - a) + add[i] * a;
  }
  return flow;
}

export function assignTraffic(sim, prm = TP) {
  const inp = buildInput(sim, prm);
  return { flow: assignCore(inp), zones: inp.zn.length, ext: inp.ext, trips: inp.trips };
}

// R² of log volumes vs counts on counted tiles (used for tuning and reported in the game)
export function fitToCounts(sim, flow) {
  const w = sim.w;
  const xs = [], ys = [];
  for (const i of sim.roadList) if (w.aadt[i] > 0 && w.inTown[i] && flow[i] > 0) { xs.push(Math.log(flow[i])); ys.push(Math.log(w.aadt[i])); }
  if (xs.length < 10) return { n: xs.length, r2: 0 };
  const mx = xs.reduce((a, b) => a + b) / xs.length, my = ys.reduce((a, b) => a + b) / ys.length;
  let sxy = 0, sxx = 0, syy = 0;
  for (let j = 0; j < xs.length; j++) { sxy += (xs[j] - mx) * (ys[j] - my); sxx += (xs[j] - mx) ** 2; syy += (ys[j] - my) ** 2; }
  return { n: xs.length, r2: sxx && syy ? (sxy * sxy) / (sxx * syy) : 0, slope: sxx ? sxy / sxx : 0 };
}
export { clamp };
