// City simulation: budget (with Massachusetts Prop 2½ levy limits), growth, traffic, services, approval.
import { CFG, ZONE, COVER, SERVICES, SPECIAL } from './config.js';
import { computeStreetLife } from './streetlife.js';
import { computePatterns } from './patterns.js';
import { weatherCapF, weatherMonthly } from './weather.js';
import { initTransit, computeTransit, transitCarF } from './transit.js';
import { eggMonthly } from './eggs.js';
import { valeMonthly } from './rival.js';
import { updateMarket, bldgF, setBldgValue } from './market.js';
import { clamp, hash2, rng, percentile, MONTHS } from './util.js';
import { computeLotMetrics, developLot, findRoad, demolish, addServiceBuilding, bldRate, buildingTiles } from './world.js';
import { frontage, classifyLot } from './vibrancy.js';
import { walkScore, walkCat } from './walkscore.js';
import { initStorefronts, storefrontsMonthly, policyApproval } from './storefronts.js';
import { react, ambient } from './comments.js';
import { initIncidents, stepIncidents, syncCrews, storm as stormFn, refreshBlocks, incidentPenalty } from './incidents.js';
import { projectsMonthly } from './projects.js';
import { meloraMonthly } from './melora.js';
import { initAssumptions, A as assumeA } from './assumptions.js';
import { junctionFactors, squareCtl } from './junctions.js';
import { buildInput, assignCore, fitToCounts, TP } from './traffic.js';
import { initTech, techMonthly, techTrafficF, techPollF, techDemand, techApproval } from './tech.js';

const CC = 4;
// traffic engineering constants: share of daily traffic in the peak hour (K), share in the peak
// direction (D), and per-lane hourly capacity of a signalized arterial (1,800/h saturation × ~0.5 green)
const PEAK_K = 0.09, PEAK_D = 0.55, LANE_VPH = 900;
const DEFAULT_LANES = [0, 2, 2, 4];
// Market redevelopment rates by zone, and how much more often big parcels get rebuilt than small ones.
// Calibrated by replaying 2000–2026 (tools/validate.mjs): with the real decisions made, the market should add
// about as many homes and jobs as really appeared, and big parcels should be where it happens.
export const GROWTH = { R: 1, C: 0.15, I: 0.3, size: 1.5, vacant: 0.06 };
const sizeW = (lot) => (GROWTH.size ? clamp(Math.pow(lot.area / 1500, GROWTH.size), 0.03, 5) : 1);

// Budget growth, calibrated by the 2000–2026 replay: newGrowth is the yearly new growth from renovations,
// additions and business equipment (share of the levy); costGrowth is department costs per year. With benefits
// at 4.5%, the whole budget grows about 4% a year, as Watertown's did (roughly ×2.8 to FY2025's ~$204M).
// tools/uncertainty.mjs samples both.
export const FISCAL = { newGrowth: 0.014, costGrowth: 0.036 };

// street-class prior for uncounted streets; fitted by 5-fold hold-out on MassDOT counts (tools/validate.mjs)
export const TRAFFIC_PRIOR = { beta: 0.2, smooth: 2000, decay: 0.99, local: 1154 };

export const FACTIONS = ['homeowners', 'renters', 'seniors', 'business', 'commuters'];
export const FACTION_LABEL = { homeowners: 'Homeowners', renters: 'Renters', seniors: 'Seniors', business: 'Business owners', commuters: 'Commuters' };
const FW = { homeowners: 0.3, renters: 0.25, seniors: 0.15, business: 0.15, commuters: 0.15 };
export const DEPTS = ['schools', 'police', 'fire', 'roads', 'parks'];
export const DEPT_LABEL = { schools: 'Schools', police: 'Police', fire: 'Fire', roads: 'Public Works', parks: 'Parks & Rec', other: 'Admin, benefits & debt' };
const DEPT_SHARE = { schools: 0.4, police: 0.1, fire: 0.09, roads: 0.11, parks: 0.04, other: 0.26 };

export class Sim {
  constructor(world, state, hooks = {}) {
    this.w = world;
    this.hooks = hooks;
    const { W, H } = world;
    this.W = W;
    this.H = H;
    this.N = W * H;
    this.Wc = Math.ceil(W / CC);
    this.Hc = Math.ceil(H / CC);
    const Nc = this.Wc * this.Hc;
    this.traffic = new Float32Array(this.N);
    this.congestion = new Float32Array(this.N);
    this.popC = new Float32Array(Nc);
    this.jobsC = new Float32Array(Nc);
    this.indC = new Float32Array(Nc);
    this.trafC = new Float32Array(Nc);
    this.crimeC = new Float32Array(Nc);
    this.pollC = new Float32Array(Nc);
    this.polCov = new Float32Array(Nc);
    this.fireCov = new Float32Array(Nc);
    this.schoolCov = new Float32Array(Nc);
    this.parkC = new Float32Array(Nc);
    this.specialC = new Float32Array(Nc);
    this.lvMod = new Float32Array(Nc).fill(1);
    this.paused = false;
    this.speed = 1;
    this.rand = rng(hooks.seed != null ? hooks.seed : Date.now() & 0xffffffff);
    this.rebuildRoadList();
    if (state) {
      Object.assign(this, state.sim);
      this.lvLocal = Float32Array.from(state.lvLocal);
      this.capLocal = Float32Array.from(state.capLocal);
      this.S0 = Float32Array.from(state.S0);
      if (state.V0 && state.M0) { this.V0 = Float32Array.from(state.V0); this.M0 = Float32Array.from(state.M0); this.calF = true; }
      this.rand = rng(Date.now() & 0xffffffff);
      if (!this.inc) initIncidents(this);
      refreshBlocks(this);
      this.recalc();
      this.computeAll();
      this.updateDemand();
      this.updateApproval();
    } else this.newGame();
  }

  get month() {
    return this.m;
  }
  get t() {
    return (this.y - (this.y0 ?? 2027)) * 12 + this.m;
  }
  dateStr() {
    return `${MONTHS[this.m]} ${this.y}`;
  }

  // ---------------- setup ----------------
  newGame() {
    const w = this.w;
    initAssumptions(this, w.preset || 'thesis');
    this.y = this.w.startYear || CFG.START.y;
    this.y0 = this.y;
    this.m = CFG.START.m;
    this.lvLocal = new Float32Array(this.Wc * this.Hc).fill(1);
    this.capLocal = new Float32Array(this.N).fill(1);
    this.flags = {};
    this.recurring = {};
    this.pending = [];
    this.seen = {};
    this.newsLog = [];
    this.history = [];
    this.approvalOff = Object.fromEntries(FACTIONS.map((f) => [f, 0]));
    this.demandMod = { R: 0, C: 0, I: 0 };
    this.fund = { schools: 1, police: 1, fire: 1, roads: 1, parks: 1 };
    this.roadCond = 1;
    this.market = 1;
    this.localMkt = 1;
    this.regional = 1;
    this.lowMonths = 0;
    this.debtMonths = 0;
    this.newGrowth = 0;
    this.gameOver = null;
    this.capBump = 0;
    // MBTA Communities / Square-area by-right zoning: lots near the Square and on Arsenal St allow density
    const [sx, sy] = w.start;
    for (const lot of w.lots) {
      if (!lot.inTown) continue;
      const d = Math.hypot(lot.cx - sx, lot.cy - sy);
      if (d < 34 && (lot.zone === ZONE.R || lot.zone === ZONE.C)) lot.dense = true;
      if (lot.road >= 0 && /arsenal/i.test(w.names[w.roadName[lot.road]] || '') && (lot.zone === ZONE.C || lot.zone === ZONE.I)) lot.dense = true;
      lot.bldgZone = lot.zone;
    }
    this.recalc(true);
    // ---- calibrate budget to the real tax base ----
    const { Vr, Vc } = this.taxBase();
    const levy0 = (Vr * CFG.RATE_RES + Vc * CFG.RATE_CIP) / 1000;
    const cipLevyShare = (Vc * CFG.RATE_CIP) / 1000 / levy0;
    const valShare = Vc / (Vr + Vc);
    this.shift = valShare > 0 ? cipLevyShare / valShare : 1;
    this.shiftMax = Math.max(1.75, Math.ceil(this.shift * 20) / 20);
    this.capShare = Math.max(0.5, Math.ceil((cipLevyShare + 0.01) * 100) / 100);
    this.levyLimit = levy0 * 1.02;
    this.levyPct = levy0 / this.levyLimit;
    this.exemption = 0.35;
    this.overrides = 0;
    const other = levy0 * 0.26;
    const budget = (levy0 + other) * 0.975;
    this.base = {
      ...this.base,
      levy0,
      other,
      budget,
      dept: Object.fromEntries(Object.entries(DEPT_SHARE).map(([k, v]) => [k, budget * v])),
      rateR0: CFG.RATE_RES,
      rateC0: CFG.RATE_CIP,
    };
    this.funds = budget * 0.1;
    if (this.w.roadLines && this.w.roadLines.length) squareCtl(this);
    this.computeAll(true);
    this.computeTraffic(true); // second pass: intersections now see real volumes
    if (this.calF) this.trafficFit();
    initStorefronts(this);
    initIncidents(this);
    initTech(this);
    initTransit(this);
    computePatterns(this);
    computeStreetLife(this);
    this.vibrancyParts(); // records the starting point for the vibrancy breakdown
    this.demand = { R: 0, C: 0, I: 0 };
    for (let k = 0; k < 6; k++) this.updateDemand();
    this.base.demR0 = this.demand.R;
    this.updateApproval(true);
    this.pushHistory(0, 0);
    this.news('Welcome, City Manager', `The City Council has hired you to run Watertown. Population ${Math.round(this.pop).toLocaleString()}, about ${(this.taxBase().V / 1e9).toFixed(1)} billion dollars of taxable property, and a lot of opinions.`, 'big');
  }

  // aggregate counts, calibration baselines
  recalc(init = false) {
    const w = this.w;
    let pop = 0, jobs = 0, cj = 0, ij = 0, units = 0;
    this.zLots = [];
    for (const lot of w.lots) {
      if (lot.dead || !lot.inTown) continue;
      const occ = lot.occ;
      if (lot.zone === ZONE.R || lot.mixed) {
        pop += lot.units * 2.3 * occ;
        units += lot.units;
      }
      jobs += lot.jobs * occ;
      if (lot.zone === ZONE.C) cj += lot.jobs * occ;
      if (lot.zone === ZONE.I) ij += lot.jobs * occ;
      if (lot.zone === ZONE.R || lot.zone === ZONE.C || lot.zone === ZONE.I) this.zLots.push(lot.id);
    }
    this.pop = pop;
    this.jobs = jobs;
    this.cjobs = cj;
    this.ijobs = ij;
    this.units = units;
    this.policeN = this.services('police').length;
    this.fireN = this.services('fire').length;
    let parks = 0;
    for (let i = 0; i < this.N; i++) if (w.inTown[i] && (w.cover[i] === COVER.PARK || w.cover[i] === COVER.SPORT || w.cover[i] === COVER.WOOD)) parks++;
    this.parkTiles = parks;
    if (init) {
      this.base = {
        pop0: pop || 1, jobs0: jobs || 1, cj0: cj || 1, ij0: ij || 1,
        roads0: this.roadList.length || 1, parks0: parks || 1, police0: this.policeN, fire0: this.fireN,
      };
    }
  }
  services(type) {
    return this.w.services.filter((s) => s.alive && s.type === type);
  }
  rebuildRoadList() {
    const r = [];
    const { road, inTown } = this.w;
    for (let i = 0; i < this.N; i++) if (road[i]) r.push(i);
    this.roadList = Int32Array.from(r);
    void inTown;
  }

  // ---------------- taxes ----------------
  taxBase() {
    let Vr = 0, Vc = 0;
    for (const lot of this.w.lots) {
      if (lot.dead || !lot.inTown) continue;
      const v = lot.landVal + lot.bldgVal + (lot.otherVal || 0);
      if (lot.zone === ZONE.R || lot.zone === ZONE.PARK || lot.zone === ZONE.NONE) Vr += v;
      else if (lot.zone === ZONE.C || lot.zone === ZONE.I) Vc += v;
    }
    return { Vr: Vr || 1, Vc: Vc || 1, V: Vr + Vc };
  }
  rates() {
    const { Vr, Vc, V } = this.taxBase();
    const limit = this.levyLimit;
    const levy = limit * this.levyPct;
    const want = (Vc / V) * this.shift;
    const cipShare = Math.min(want, this.capShare);
    const cipLevy = levy * cipShare;
    const resLevy = levy - cipLevy;
    return {
      levy, limit, Vr, Vc, V, cipShare, capped: want > this.capShare + 1e-6,
      rateR: (resLevy / Vr) * 1000,
      rateC: (cipLevy / Vc) * 1000,
    };
  }
  budgetLines() {
    const r = this.rates();
    const infl = Math.pow(1 + FISCAL.costGrowth, this.t / 12); // wages and contracts outpace general inflation
    const scale = {
      schools: Math.pow(this.pop / this.base.pop0, 0.7),
      police: 1 + 0.15 * (this.policeN - this.base.police0),
      fire: 1 + 0.15 * (this.fireN - this.base.fire0),
      roads: this.roadList.length / this.base.roads0,
      parks: this.parkTiles / this.base.parks0,
    };
    const exp = {};
    for (const d of DEPTS) exp[d] = this.base.dept[d] * this.fund[d] * scale[d] * infl;
    // benefits, pensions and health insurance grow faster than Prop 2½ allows the levy to
    exp.other = this.base.dept.other * Math.pow(1.045, this.t / 12);
    let rec = 0;
    const recLines = [];
    for (const [k, v] of Object.entries(this.recurring)) {
      rec += v.monthly * 12;
      recLines.push({ key: k, label: v.label, annual: v.monthly * 12 });
    }
    const other = this.base.other * Math.pow(1.025, this.t / 12) * Math.sqrt(this.pop / this.base.pop0) * (this.flags.grantsLost ? 0.9 : 1);
    const income = r.levy + other;
    const interest = this.funds < 0 ? -this.funds * 0.07 : 0;
    const infl2 = Math.pow(1.025, this.t / 12);
    let upkeep = 0;
    for (const { eff } of this.specialList(true)) upkeep += (eff.upkeep || 0) * infl2;
    const expenses = Object.values(exp).reduce((a, b) => a + b, 0) + rec + interest + upkeep;
    return { r, exp, rec, recLines, other, income, expenses, interest, upkeep, net: income - expenses };
  }

  // ---------------- maps ----------------
  computeAll(init = false) {
    this.computeTraffic(init);
    this.computeMaps(init);
  }
  computeTraffic(init = false) {
    const { W, H, road, lots } = this.w;
    const T = this.traffic;
    const D = new Float32Array(this.N);
    for (const lot of lots) {
      if (lot.dead || lot.road < 0) continue;
      D[lot.road] += (lot.units * 2.3 * 0.4 + lot.jobs * 0.45) * lot.occ * (lot.tripF || 1);
    }
    const tf = techTrafficF(this);
    if (tf !== 1) for (let i = 0; i < D.length; i++) D[i] *= tf;
    const rl = this.roadList;
    if (this.w.roadLines && this.w.roadLines.length) {
      // routed traffic (see js/traffic.js), scaled month to month by how many trips the town makes
      if (!this.flow || this.flow.length !== this.N) this.reassign(true);
      const scale = (this.tripsNow() / (this.flowTrips || 1)) * tf * transitCarF(this);
      T.fill(0);
      for (const i of rl) T[i] = this.flow[i] * scale;
    } else {
    T.set(D);
    const tmp = new Float32Array(this.N);
    for (let it = 0; it < 16; it++) {
      tmp.set(T);
      for (let k = 0; k < rl.length; k++) {
        const i = rl[k];
        const x = i % W, y = (i / W) | 0;
        let s = 0, n = 0;
        if (x > 0 && road[i - 1]) { s += tmp[i - 1] * road[i - 1]; n += road[i - 1]; }
        if (x < W - 1 && road[i + 1]) { s += tmp[i + 1] * road[i + 1]; n += road[i + 1]; }
        if (y > 0 && road[i - W]) { s += tmp[i - W] * road[i - W]; n += road[i - W]; }
        if (y < H - 1 && road[i + W]) { s += tmp[i + W] * road[i + W]; n += road[i + W]; }
        T[i] = D[i] + (n ? (0.9 * s) / n : 0);
      }
    }
    }
    if (init || !this.base.capC1) {
      const v1 = [];
      for (const i of rl) if (road[i] === 1) v1.push(T[i]);
      this.base.capC1 = (percentile(v1, 0.8) || 10) / 0.55;
    }
    if (!(this.calF && this.V0) && this.w.aadt) this.calibrateTraffic(T);
    const capMul = (0.82 + 0.18 * this.roadCond) * (1 + this.capBump) * weatherCapF(this);
    const jf = junctionFactors(this);
    let sum = 0, n = 0;
    if (!this.vpd || this.vpd.length !== this.N) this.vpd = new Float32Array(this.N);
    for (const i of rl) {
      const local = capMul * this.capLocal[i] * (this.incBlock ? this.incBlock[i] : 1) * (jf ? jf[i] : 1);
      let c;
      if (this.calF && this.V0) {
        // vehicles per day, pivoted on MassDOT counts (NCHRP 765 hybrid): where the model already carries a good
        // share of the counted traffic, scale the count by the model's change; where it barely uses the street,
        // add the model's change instead. Then peak-hour, peak-direction volume vs signalized capacity.
        const m = T[i] * this.base.kVeh, m0 = this.M0[i], v0 = this.V0[i];
        const vol = m0 >= 0.5 * v0 ? v0 * clamp(m / Math.max(1, m0), 0, 3) : Math.max(0.15 * v0, v0 + (m - m0));
        this.vpd[i] = vol;
        const lanes = this.w.lanes[i] || DEFAULT_LANES[road[i]];
        c = (vol * PEAK_K * PEAK_D) / (Math.max(1, lanes / 2) * LANE_VPH * local);
      } else c = T[i] / (this.base.capC1 * [0, 1, 2.6, 4.2][road[i]] * local);
      this.congestion[i] = c;
      if (road[i] >= 2 && this.w.inTown[i]) { sum += c; n++; }
    }
    this.congAvg = n ? sum / n : 0;
    if (init || this.base.cong0 == null) this.base.cong0 = this.congAvg || 0.5;
  }
  tripsNow() {
    let p = 0;
    for (const lot of this.w.lots) if (!lot.dead && lot.inTown && lot.road >= 0) p += (lot.units || 0) * TP.homeTrips * lot.occ * (lot.tripF || 1);
    return p;
  }
  // Re-route all traffic over the current street network. Synchronous on first load (and in tests);
  // afterwards in a Web Worker so the game keeps running while drivers find their new routes.
  reassign(sync = false) {
    const inp = buildInput(this, TP);
    if (sync || typeof Worker === 'undefined') {
      this.flow = assignCore(inp);
      this.flowTrips = inp.trips;
      return;
    }
    try {
      if (!this.trafficWorker) {
        this.trafficWorker = new Worker(new URL('./traffic-worker.js', import.meta.url), { type: 'module' });
        this.trafficWorker.onmessage = (e) => {
          if (e.data.id !== this.assignId) return;
          this.flow = e.data.flow;
          this.flowTrips = this.pendingTrips;
          this.computeAll();
          this.hooks.incidents && this.hooks.incidents();
        };
      }
      this.assignId = (this.assignId || 0) + 1;
      this.pendingTrips = inp.trips;
      this.trafficWorker.postMessage({ id: this.assignId, inp });
    } catch (e) {
      this.flow = assignCore(inp);
      this.flowTrips = inp.trips;
    }
  }
  // Fit the trip model to MassDOT traffic counts: one scale factor for the whole town, then a local
  // correction on each counted street that fades along the network into uncounted ones. The model then
  // moves volumes up and down from the real counts as the town changes (the "pivot-point" method).
  calibrateTraffic(T) {
    const w = this.w, { W, road } = w;
    const rl = this.roadList;
    const counted = rl.filter((i) => w.aadt[i] > 0);
    if (counted.length < 20) { this.calF = null; return; }
    const ratios = counted.filter((i) => T[i] > 0).map((i) => w.aadt[i] / T[i]).sort((a, b) => a - b);
    const k = ratios[Math.floor(ratios.length / 2)];
    // how well does the raw trip model explain the counts? (R² of log volumes, before correction)
    const routed = counted.filter((i) => T[i] > 0);
    const xs = routed.map((i) => Math.log(T[i] * k)), ys = routed.map((i) => Math.log(w.aadt[i]));
    const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
    let sxy = 0, sxx = 0, syy = 0;
    for (let j = 0; j < xs.length; j++) { sxy += (xs[j] - mx) * (ys[j] - my); sxx += (xs[j] - mx) ** 2; syy += (ys[j] - my) ** 2; }
    // Prior for a street without a count: the typical count on that class of street, nudged by the routed
    // model's volume to a small power. Held-out tests (tools/validate.mjs) showed the routed model on its own
    // predicts unseen counts worse than street class does; a weak blend plus local corrections does best.
    const med = (a) => (a.length ? a.slice().sort((x, y) => x - y)[a.length >> 1] : 0);
    const smooth = TRAFFIC_PRIOR.smooth / k;
    const cm = [0], tm = [1];
    for (const c of [1, 2, 3]) {
      const a = counted.filter((i) => road[i] === c);
      cm[c] = med(a.map((i) => w.aadt[i])) || [0, 1500, 4000, 15000][c];
      tm[c] = med(a.map((i) => T[i] + smooth)) || smooth;
    }
    // the few local streets MassDOT counts are the busy ones; an ordinary side street starts from MassDOT's own
    // default for local roads instead
    cm[1] = Math.min(cm[1], TRAFFIC_PRIOR.local);
    const prior = (i) => cm[road[i]] * Math.pow((T[i] + smooth) / tm[road[i]], TRAFFIC_PRIOR.beta);
    this.base.trafPrior = { classMedian: cm.slice(1), beta: TRAFFIC_PRIOR.beta };
    const F = new Float32Array(this.N), fixed = new Uint8Array(this.N);
    // correction factors on counted streets, capped so one odd count can't blow up its neighbours
    for (const i of counted) { F[i] = clamp(Math.log(w.aadt[i] / prior(i)), -1.5, 1.5); fixed[i] = 1; }
    const tmp = new Float32Array(this.N);
    for (let it = 0; it < 40; it++) {
      tmp.set(F);
      for (const i of rl) {
        if (fixed[i]) continue;
        const x = i % W;
        let s = 0, m = 0;
        // corrections travel along the same kind of street, not into side streets
        for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W]) if (j >= 0 && j < this.N && road[j] === road[i]) { s += tmp[j]; m++; }
        F[i] = m ? (TRAFFIC_PRIOR.decay * s) / m : 0;
      }
    }
    // base volumes: the real count where there is one, the corrected model elsewhere; and the model's own base
    this.V0 = new Float32Array(this.N);
    this.M0 = new Float32Array(this.N);
    for (const i of rl) {
      this.M0[i] = T[i] * k;
      this.V0[i] = w.aadt[i] > 0 ? w.aadt[i] : prior(i) * Math.exp(F[i]);
    }
    this.calF = true;
    this.base.kVeh = k;
    this.trafficFit(T);
  }
  // how well the routed model (before correction) explains the counts: R² of log volumes, on all counted
  // streets and on busy ones (8,000+ a day), where MassDOT figures are most often real counts
  trafficFit(T = this.traffic) {
    const w = this.w;
    const r2 = (minA) => {
      const a = [], b = [];
      for (const i of this.roadList) if (w.aadt[i] >= minA && w.inTown[i] && T[i] > 0) { a.push(Math.log(T[i])); b.push(Math.log(w.aadt[i])); }
      if (a.length < 10) return [0, a.length];
      const ma = a.reduce((p, q) => p + q, 0) / a.length, mb = b.reduce((p, q) => p + q, 0) / b.length;
      let s1 = 0, s2 = 0, s3 = 0;
      for (let j = 0; j < a.length; j++) { s1 += (a[j] - ma) * (b[j] - mb); s2 += (a[j] - ma) ** 2; s3 += (b[j] - mb) ** 2; }
      return [s2 && s3 ? (s1 * s1) / (s2 * s3) : 0, a.length];
    };
    const [rAll, n] = r2(1), [rBusy, nBusy] = r2(8000);
    this.base.trafFit = { n, r2: rAll, nBusy, r2Busy: rBusy, routed: !!this.flow, commute: !!w.commute };
  }
  computeMaps(init = false) {
    const w = this.w;
    const { W, lots, cover, inTown } = w;
    const { Wc, Hc } = this;
    const Nc = Wc * Hc;
    const ci = (x, y) => clamp(Math.floor(y / CC), 0, Hc - 1) * Wc + clamp(Math.floor(x / CC), 0, Wc - 1);
    this.popC.fill(0); this.jobsC.fill(0); this.indC.fill(0); this.trafC.fill(0); this.parkC.fill(0);
    for (const lot of lots) {
      if (lot.dead) continue;
      const c = ci(lot.cx, lot.cy);
      this.popC[c] += lot.units * 2.3 * lot.occ;
      this.jobsC[c] += lot.jobs * lot.occ;
      if (lot.zone === ZONE.I) this.indC[c] += lot.jobs * lot.occ;
    }
    for (const i of this.roadList) this.trafC[ci(i % W, (i / W) | 0)] += this.traffic[i] / 16;
    for (let i = 0; i < this.N; i++) {
      const cv = cover[i];
      if (cv === COVER.PARK || cv === COVER.WOOD || cv === COVER.SPORT || w.terrain[i] === 1) this.parkC[ci(i % W, (i / W) | 0)] += w.terrain[i] === 1 ? 0.5 : 1;
    }
    const blur = (a, passes) => {
      const t = new Float32Array(Nc);
      for (let p = 0; p < passes; p++) {
        t.set(a);
        for (let y = 0; y < Hc; y++)
          for (let x = 0; x < Wc; x++) {
            let s = 0, n = 0;
            for (let dy = -1; dy <= 1; dy++)
              for (let dx = -1; dx <= 1; dx++) {
                const xx = x + dx, yy = y + dy;
                if (xx < 0 || yy < 0 || xx >= Wc || yy >= Hc) continue;
                s += t[yy * Wc + xx];
                n++;
              }
            a[y * Wc + x] = s / n;
          }
      }
    };
    // coverage — any alive service with a radius that feeds this department contributes
    const cover2 = (arr, dept, fund) => {
      arr.fill(0);
      for (const s of this.w.services) {
        if (!s.alive) continue;
        const cfg = SERVICES[s.type];
        if (!cfg || !cfg.radius) continue;
        if ((cfg.fund || s.type) !== dept) continue;
        const Rc = cfg.radius / CC;
        const sx = s.x / CC, sy = s.y / CC;
        for (let y = Math.max(0, Math.floor(sy - Rc)); y <= Math.min(Hc - 1, Math.ceil(sy + Rc)); y++)
          for (let x = Math.max(0, Math.floor(sx - Rc)); x <= Math.min(Wc - 1, Math.ceil(sx + Rc)); x++) {
            const d = Math.hypot(x + 0.5 - sx, y + 0.5 - sy);
            const v = 1 - d / Rc;
            if (v > arr[y * Wc + x]) arr[y * Wc + x] = v;
          }
      }
      for (let i = 0; i < Nc; i++) arr[i] = Math.min(1, arr[i] * 1.4) * clamp(fund, 0, 1.2);
    };
    cover2(this.polCov, 'police', this.fund.police);
    cover2(this.fireCov, 'fire', this.fund.fire);
    cover2(this.schoolCov, 'school', this.fund.schools);
    blur(this.parkC, 2);
    const poll = this.pollC, crime = this.crimeC;
    const pf = techPollF(this);
    for (let i = 0; i < Nc; i++) {
      poll[i] = this.indC[i] * 0.004 + this.trafC[i] * 0.03 * pf;
      crime[i] = this.popC[i] * 0.002 + this.jobsC[i] * 0.0012;
    }
    blur(poll, 2);
    blur(crime, 1);
    for (let i = 0; i < Nc; i++) crime[i] *= 1 - 0.7 * Math.min(1, this.polCov[i]);
    if (init || !this.base.crimeN) {
      this.base.crimeN = percentile(crime.filter((v) => v > 0), 0.9) || 1;
      this.base.pollN = percentile(poll.filter((v) => v > 0), 0.9) || 1;
      this.base.parkN = percentile(this.parkC.filter((v) => v > 0), 0.9) || 1;
      this.base.trafN = percentile(this.trafC.filter((v) => v > 0), 0.9) || 1;
    }
    // halo from special civic structures (hospital, library, museum, …)
    this.computeSpecial();
    if (init || !this.walkS || ((this.walkDirty || this.t % 12 === 0) && this.walkT !== this.t)) {
      this.computeWalk();
      this.walkT = this.t;
    }
    this.computeVibrancy(init);
    // land value modifier relative to the starting city
    const S = new Float32Array(Nc);
    let crimeSum = 0, cn = 0;
    for (let i = 0; i < Nc; i++) {
      const cr = crime[i] / this.base.crimeN, po = poll[i] / this.base.pollN, pk = Math.min(1.5, this.parkC[i] / this.base.parkN), tr = this.trafC[i] / this.base.trafN;
      S[i] = 0.18 * pk - 0.3 * cr - 0.22 * po - 0.06 * tr + 0.08 * this.polCov[i] + 0.06 * this.fireCov[i] + this.specialC[i] + 0.22 * this.vibSat[i];
      if (this.popC[i] > 0) { crimeSum += cr; cn++; }
    }
    if (init || !this.S0) this.S0 = S.slice();
    this.crimeAvg = cn ? crimeSum / cn : 0;
    if (init || this.base.crimeAvg0 == null) this.base.crimeAvg0 = this.crimeAvg || 0.3;
    const glob = (1 + 0.12 * (this.fund.schools - 1)) * (0.94 + 0.06 * this.roadCond);
    for (let i = 0; i < Nc; i++) this.lvMod[i] = clamp(1 + 0.9 * (S[i] - this.S0[i]), 0.5, 1.8) * glob * this.lvLocal[i];
    void inTown;
  }
  // Turn storefront-economy events into news and the Main Street log.
  storefrontNews(ev) {
    this.sfLog = this.sfLog || [];
    let posted = 0;
    const st = (lot) => streetOf(lot) || 'a side street';
    for (const e of ev) {
      const s = e.shop;
      let line = null, title = null, body = '';
      if (e.type === 'close-rent') {
        line = `${s.n} closed on ${st(e.lot)}${e.jump > 0.05 ? ` after a ${Math.round(e.jump * 100)}% rent increase` : ' — sales could not keep up with the rent'}`;
        if (s.sig || s.orig) {
          title = `${s.n} to close${s.orig ? ' after years on ' + st(e.lot) : ''}`;
          body = pick(CLOSE_BODIES, this.rand());
        }
      } else if (e.type === 'close-retire') {
        line = `${s.n} on ${st(e.lot)} closed (owner retiring)`;
        if (s.orig && this.rand() < 0.3) { title = `${s.n} closing as owner retires`; body = 'No one wanted to take it over at the new rent.'; }
      } else if (e.type === 'open-indie') {
        line = `${s.n} opened on ${st(e.lot)}${s.sig ? ' ★' : ''}`;
        if (s.sig) { title = `${s.n} opens on ${st(e.lot)}`; body = pick(s.cat === 'food' ? OPEN_BODIES : OPEN_BODIES.slice(0, 2), this.rand()); }
      } else if (e.type === 'open-chain') {
        line = `${s.n} (chain) signed a lease on ${st(e.lot)}`;
        if (this.rand() < 0.5) { title = `${s.n} signs a ten-year lease on ${st(e.lot)}`; body = pick(CHAIN_BODIES, this.rand()); }
      } else if (e.type === 'holdout') {
        line = `Storefront at ${e.lot.addr || st(e.lot)} still empty after 9 months`;
        title = `Storefront at ${e.lot.addr || st(e.lot)} sits empty for nine months`;
        body = 'The owner is asking well above what the last tenant paid. A sign in the window promises "Coming soon."';
      } else if (e.type === 'popup') line = `Pop-up gallery moved into an empty storefront on ${st(e.lot)}`;
      if (line) this.sfLog.unshift({ date: this.dateStr(), t: this.t, text: line, type: e.type });
      let item = null;
      if (title && posted < 2) {
        item = this.news(title, body);
        posted++;
      }
      const ctx = { name: s ? s.n : '', street: st(e.lot), cat: s ? s.cat : '' };
      const rt = e.type === 'close-rent' ? 'close-indie' : e.type === 'close-retire' ? 'close-retire' : e.type;
      if (item || this.rand() < 0.15) react(this, rt, ctx, item);
    }
    if (this.sfLog.length > 40) this.sfLog.length = 40;
  }
  // Walk Score–style walkability per cell, from the game's own businesses, parks, schools and real intersections.
  computeWalk() {
    const w = this.w;
    const { Wc, Hc } = this;
    const Nc = Wc * Hc;
    const TM = 16; // metres per tile
    const pts = [];
    const add = (x, y, cat) => cat && pts.push(x, y, cat);
    const catIdx = { grocery: 0, restaurants: 1, shopping: 2, coffee: 3, banks: 4, parks: 5, schools: 6, books: 7, entertainment: 8 };
    const P = [];
    for (const lot of w.lots) {
      if (lot.dead || !lot.biz || !lot.biz.length) continue;
      lot.biz.forEach((n, k) => { const c = walkCat(lot.bizKind ? lot.bizKind[k] : '', n); if (c) P.push([lot.cx, lot.cy, catIdx[c]]); });
      if (/school/i.test(lot.useDesc || '')) P.push([lot.cx, lot.cy, catIdx.schools]);
    }
    for (const [x, y, k, n] of w.extPois || []) { const c = walkCat(k, n); if (c) P.push([x, y, catIdx[c]]); }
    for (const s of w.services) if (s.alive && (s.type === 'school' || s.type === 'library')) P.push([s.x, s.y, catIdx[s.type === 'school' ? 'schools' : 'books']]);
    // parks: one point per cell that is mostly green
    if (!this.parkPts) {
      this.parkPts = [];
      for (let cy = 0; cy < Hc; cy++)
        for (let cx = 0; cx < Wc; cx++) if (this.parkC[cy * Wc + cx] > 0) {
          let n = 0;
          for (let y = cy * 4; y < cy * 4 + 4 && y < w.H; y++) for (let x = cx * 4; x < cx * 4 + 4 && x < w.W; x++) if (w.cover[y * w.W + x] === COVER.PARK) n++;
          if (n >= 6) this.parkPts.push([cx * 4 + 2, cy * 4 + 2]);
        }
    }
    for (const [x, y] of this.parkPts) P.push([x, y, catIdx.parks]);
    void add;
    void pts;
    // intersection density within half a mile
    if (!this.interC) {
      const J = new Float32Array(Nc);
      for (const [x, y] of w.junctions || []) J[this.cellOf(x, y)]++;
      this.interC = new Float32Array(Nc);
      const R = 12; // cells ≈ 0.5 mi
      for (let y = 0; y < Hc; y++)
        for (let x = 0; x < Wc; x++) {
          const v = J[y * Wc + x];
          if (!v) continue;
          for (let dy = -R; dy <= R; dy++)
            for (let dx = -R; dx <= R; dx++) {
              if (dx * dx + dy * dy > R * R) continue;
              const xx = x + dx, yy = y + dy;
              if (xx >= 0 && yy >= 0 && xx < Wc && yy < Hc) this.interC[yy * Wc + xx] += v;
            }
        }
      this.hasJunctions = (w.junctions || []).length > 0;
    }
    this.walkP = P;
    // score on 2×2-cell blocks (128 m), every block inside town
    if (!this.walkS || this.walkS.length !== Nc) this.walkS = new Uint8Array(Nc);
    let s = 0, p = 0;
    for (let by = 0; by < Hc; by += 2)
      for (let bx = 0; bx < Wc; bx += 2) {
        const x = bx * 4 + 4, y = by * 4 + 4;
        const ti = Math.min(w.H - 1, y) * w.W + Math.min(w.W - 1, x);
        let any = w.inTown[ti];
        for (let dy = 0; dy < 2 && !any; dy++) for (let dx = 0; dx < 2 && !any; dx++) { const ci = (by + dy) * Wc + bx + dx; if (bx + dx < Wc && by + dy < Hc && (this.popC[ci] > 0 || this.jobsC[ci] > 0)) any = 1; }
        const ws = any ? this.walkAt(x, y) : 0;
        for (let dy = 0; dy < 2; dy++)
          for (let dx = 0; dx < 2; dx++) {
            if (bx + dx >= Wc || by + dy >= Hc) continue;
            const ci = (by + dy) * Wc + bx + dx;
            this.walkS[ci] = ws;
            if (this.popC[ci] > 0) { s += ws * this.popC[ci]; p += this.popC[ci]; }
          }
      }
    this.walkIndex = p ? s / p : 0;
    if (this.base && this.base.walk0 == null) this.base.walk0 = this.walkIndex;
    if (!this.walkC || this.walkC.length !== Nc) this.walkC = new Float32Array(Nc);
    for (let i = 0; i < Nc; i++) this.walkC[i] = 0.5 + 0.5 * (this.walkS[i] / 100);
    this.walkDirty = false;
  }
  // storefront mix within r tiles of a point (same counting as the peer benchmarks)
  mixAt(x, y, r) {
    const m = { storefronts: 0, sig: 0, chains: 0, auto: 0 };
    for (const lot of this.w.lots) {
      if (lot.dead || !lot.biz || !lot.biz.length) continue;
      if (Math.hypot(lot.cx - x, lot.cy - y) > r) continue;
      if (!lot.bizCat) classifyLot(lot);
      lot.biz.forEach((n, k) => {
        const c = lot.bizCat[k];
        if (c === 'auto') m.auto++;
        if (c === 'food' || c === 'retail' || c === 'service') {
          m.storefronts++;
          if (lot.bizChainF[k]) m.chains++;
          else if (lot.bizSig && lot.bizSig[k]) m.sig++;
        }
      });
    }
    return m;
  }
  // walkability at any point (grid coordinates); distances use a 1.25 route-detour factor
  walkAt(x, y) {
    const TM = 16, DET = 1, MAXD = 2414 / TM / 1.25;
    const lists = [[], [], [], [], [], [], [], [], []];
    for (const [px, py, k] of this.walkP || []) {
      const dx = px - x, dy = py - y;
      if (dx > MAXD || dx < -MAXD || dy > MAXD || dy < -MAXD) continue;
      const d = Math.hypot(dx, dy);
      if (d <= MAXD) lists[k].push(d * TM * DET);
    }
    const names = ['grocery', 'restaurants', 'shopping', 'coffee', 'banks', 'parks', 'schools', 'books', 'entertainment'];
    const obj = {};
    names.forEach((c, k) => (obj[c] = lists[k]));
    const ci = this.cellOf(x, y);
    const perSqMi = this.hasJunctions ? this.interC[ci] / (Math.PI * 0.25) : 200;
    return walkScore(obj, perSqMi);
  }
  // Street-life field: frontage of each lot spread over walking distance, scaled by nearby residents.
  computeVibrancy(init = false) {
    const w = this.w;
    const { Wc, Hc } = this;
    const Nc = Wc * Hc;
    if (!this.vibF || this.vibF.length !== Nc) {
      this.vibF = new Float32Array(Nc);
      this.vibC = new Float32Array(Nc);
      this.vibSat = new Float32Array(Nc);
      this.popNear = new Float32Array(Nc);
      this.jobsNear = new Float32Array(Nc);
    }
    const F = this.vibF, V = this.vibC, PN = this.popNear, JN = this.jobsNear;
    F.fill(0);
    V.fill(0);
    PN.fill(0);
    JN.fill(0);
    for (const lot of w.lots) {
      if (lot.dead || !lot.inTown) continue;
      if (lot.biz && lot.biz.length && !lot.bizCat) classifyLot(lot);
      const f = frontage(lot, w, assumeA(this, 'frontage'));
      if (f) F[this.cellOf(lot.cx, lot.cy)] += f;
    }
    if (!this.vibKernel) {
      const R = 6, k = [];
      for (let dy = -R; dy <= R; dy++)
        for (let dx = -R; dx <= R; dx++) {
          const d = Math.hypot(dx, dy);
          if (d <= R) k.push([dx, dy, 1 - d / (R + 1)]);
        }
      this.vibKernel = k;
    }
    const spread = (src, dst) => {
      for (let y = 0; y < Hc; y++)
        for (let x = 0; x < Wc; x++) {
          const v = src[y * Wc + x];
          if (!v) continue;
          for (const [dx, dy, kw] of this.vibKernel) {
            const xx = x + dx, yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= Wc || yy >= Hc) continue;
            dst[yy * Wc + xx] += v * kw;
          }
        }
    };
    spread(F, V);
    spread(this.popC, PN);
    spread(this.jobsC, JN);
    if (init || !this.base.vibRef) {
      const pos = [], pops = [];
      for (let i = 0; i < Nc; i++) {
        if (V[i] > 0 && this.popC[i] > 0) pos.push(V[i]);
        if (PN[i] > 0) pops.push(PN[i]);
      }
      this.base.vibRef = percentile(pos, 0.75) || 1;
      this.base.popRef = percentile(pops, 0.6) || 1;
    }
    let s = 0, p = 0;
    for (let i = 0; i < Nc; i++) {
      const foot = 0.4 + 0.6 * Math.min(1, PN[i] / this.base.popRef);
      const x = (V[i] * foot) / this.base.vibRef;
      const sat = x >= 0 ? 1 - Math.exp(-x) : Math.max(-0.6, x * 0.6);
      this.vibSat[i] = sat;
      if (this.popC[i] > 0) {
        s += this.popC[i] * sat;
        p += this.popC[i];
      }
    }
    this.vibrancy = p ? clamp(100 * (s / p), 0, 100) : 0;
    if (init || this.base.vib0 == null) this.base.vib0 = this.vibrancy;
    if (init || !this.base.pn0) {
      this.base.pn0 = Array.from(PN);
      this.base.vibParts0 = null;
    }
  }
  // Vibrancy recomputed with some of its terms switched off, and optionally with the starting population
  vibVariant(opts, pn = null) {
    const w = this.w, { Wc, Hc } = this;
    const Nc = Wc * Hc;
    const F = new Float32Array(Nc), V = new Float32Array(Nc);
    for (const lot of w.lots) {
      if (lot.dead || !lot.inTown) continue;
      const f = frontage(lot, w, assumeA(this, 'frontage'), opts);
      if (f) F[this.cellOf(lot.cx, lot.cy)] += f;
    }
    for (let y = 0; y < Hc; y++) for (let x = 0; x < Wc; x++) {
      const v = F[y * Wc + x];
      if (!v) continue;
      for (const [dx, dy, kw] of this.vibKernel) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < Wc && yy < Hc) V[yy * Wc + xx] += v * kw; }
    }
    const PN = pn || this.popNear;
    let s = 0, p = 0;
    for (let i = 0; i < Nc; i++) {
      const foot = 0.4 + 0.6 * Math.min(1, PN[i] / this.base.popRef);
      const x = (V[i] * foot) / this.base.vibRef;
      const sat = x >= 0 ? 1 - Math.exp(-x) : Math.max(-0.6, x * 0.6);
      if (this.popC[i] > 0) { s += this.popC[i] * sat; p += this.popC[i]; }
    }
    return p ? 100 * (s / p) : 0;
  }
  // Where the change in vibrancy since the start came from. Exact by construction (each step switches one
  // thing on): auto & parking uses (a scoring penalty in the thesis model, i.e. partly by definition), dark
  // storefronts, the shops themselves, and how many people live within a walk.
  vibrancyParts() {
    const now = { V: this.vibrancy, Vna: this.vibVariant({ noAuto: 1 }), Vp: this.vibVariant({ noAuto: 1, noDark: 1 }) };
    if (!this.base.vibParts0) {
      this.base.vibParts0 = now;
      return { auto: 0, dark: 0, shops: 0, people: 0, total: 0 };
    }
    const a = this.base.vibParts0;
    const VpFixed = this.base.pn0 ? this.vibVariant({ noAuto: 1, noDark: 1 }, this.base.pn0) : now.Vp;
    const auto = (now.V - now.Vna) - (a.V - a.Vna);
    const dark = (now.Vna - now.Vp) - (a.Vna - a.Vp);
    const shops = VpFixed - a.Vp;
    const people = now.Vp - VpFixed;
    return { auto, dark, shops, people, total: now.V - a.V };
  }
  cellOf(x, y) {
    return clamp(Math.floor(y / CC), 0, this.Hc - 1) * this.Wc + clamp(Math.floor(x / CC), 0, this.Wc - 1);
  }
  // all alive special-structure instances, with their config effect
  // onlyNew: skip facilities that were already in the real city (their effects are in the calibrated baseline)
  specialList(onlyNew = false) {
    const out = [];
    for (const s of this.w.services) {
      if (!s.alive || (onlyNew && s.real)) continue;
      const cfg = SERVICES[s.type];
      if (cfg && cfg.effect) out.push({ s, cfg, eff: cfg.effect });
    }
    return out;
  }
  // land-value halo field (chunk resolution) from special structures
  computeSpecial() {
    const { Wc, Hc } = this;
    this.specialC.fill(0);
    for (const { s, eff } of this.specialList()) {
      if (!(eff.lvAmt > 0) || !(eff.lvRadius > 0)) continue;
      const rc = eff.lvRadius / CC;
      const sx = s.x / CC, sy = s.y / CC;
      for (let y = Math.max(0, Math.floor(sy - rc)); y <= Math.min(Hc - 1, Math.ceil(sy + rc)); y++)
        for (let x = Math.max(0, Math.floor(sx - rc)); x <= Math.min(Wc - 1, Math.ceil(sx + rc)); x++) {
          const d = Math.hypot(x + 0.5 - sx, y + 0.5 - sy);
          if (d >= rc) continue;
          this.specialC[y * Wc + x] += eff.lvAmt * (1 - d / rc);
        }
    }
  }
  // standing approval offsets contributed by special structures
  specialApproval() {
    const out = {};
    for (const { eff } of this.specialList(true)) {
      if (!eff.approval) continue;
      for (const [k, v] of Object.entries(eff.approval)) out[k] = (out[k] || 0) + v;
    }
    return out;
  }

  // ---------------- monthly tick ----------------
  // advance incidents/crews in real time between monthly ticks (never past the end of this month)
  realtime(days) {
    if (!this.inc || this.gameOver) return;
    const cap = (this.t + 1) * 30 - this.inc.day;
    if (cap > 0) stepIncidents(this, Math.min(days, cap));
  }
  storm(n) {
    return stormFn(this, n);
  }
  tick() {
    if (this.gameOver) return;
    if (!this.inc) initIncidents(this);
    const catchUp = (this.t + 1) * 30 - this.inc.day;
    if (catchUp > 0) stepIncidents(this, catchUp);
    syncCrews(this);
    const prevY = this.y;
    this.m++;
    if (this.m > 11) { this.m = 0; this.y++; }
    const bl = this.budgetLines();
    const income = bl.income / 12, expenses = bl.expenses / 12;
    this.funds += income - expenses;
    this.roadCond = clamp(this.roadCond + (this.fund.roads - 1) * 0.03 + (this.fund.roads >= 1 ? 0.004 : -0.004), 0.3, 1.1);
    this.growth();
    this.computeAll();
    this.updateDemand();
    projectsMonthly(this);
    computeTransit(this);
    this.storefrontNews(storefrontsMonthly(this));
    computeStreetLife(this);
    techMonthly(this);
    meloraMonthly(this);
    valeMonthly(this);
    eggMonthly(this);
    weatherMonthly(this);
    ambient(this);
    this.updateApproval();
    this.approvalWhy = this.approvalChange();
    for (const k of FACTIONS) this.approvalOff[k] *= 0.985;
    for (const k of Object.keys(this.demandMod)) this.demandMod[k] *= 0.99;
    // scheduled consequences
    const due = this.pending.filter((p) => p.at <= this.t);
    this.pending = this.pending.filter((p) => p.at > this.t);
    for (const p of due) this.hooks.followup && this.hooks.followup(p);
    for (const [k, v] of Object.entries(this.recurring)) if (v.until != null && v.until <= this.t) delete this.recurring[k];
    this.randomEvents();
    if (this.y !== prevY) this.newYear();
    this.pushHistory(income, expenses);
    this.checkGameOver();
    this.hooks.monthly && this.hooks.monthly(this);
  }
  pushHistory(income, expenses) {
    this.history.push({ t: this.t, pop: this.pop, jobs: this.jobs, funds: this.funds, income, expenses, approval: this.approval, lv: this.avgLV(), vib: this.vibrancy, vac: this.sfStats ? this.sfStats.vacant : 0 });
    if (this.history.length > 600) this.history.shift();
  }
  avgLV() {
    let s = 0, n = 0;
    for (const lot of this.w.lots) if (!lot.dead && lot.inTown && lot.zone === ZONE.R) { s += lot.landVal / Math.max(lot.area, 60); n++; }
    return n ? s / n : 0;
  }

  newYear() {
    if (this.flow) this.reassign(); // a year of growth: drivers settle into new routes
    // annual revaluation and Prop 2½ levy limit
    const r0 = this.rates();
    let added = 0;
    updateMarket(this); // regional market (js/market.js) times a small local factor
    const bf = bldgF(this);
    for (const lot of this.w.lots) {
      if (lot.dead) continue;
      const c = this.cellOf(lot.cx, lot.cy);
      const lvm = this.lvMod[c];
      lot.landVal = lot.baseLand * lvm * this.market;
      lot.bldgVal = lot.baseBldg * (0.75 + 0.25 * lot.occ) * bf;
      void added;
    }
    // new growth: taxes on what got built this year, plus renovations, additions and business equipment
    // (personal property), which the game doesn't model building by building. That second part is calibrated
    // so a replay of 2000–2026 grows the levy about as much as Watertown's really did (to ~$165M by FY2025).
    const growth = this.newGrowth + this.levyLimit * FISCAL.newGrowth;
    this.levyLimit = this.levyLimit * 1.025 + growth;
    this.newGrowth = 0;
    const r1 = this.rates();
    if (r1.rateR > r0.rateR * 1.025) react(this, 'taxes-up', {}, null, 2);
    else if (r1.rateR < r0.rateR * 0.98) react(this, 'taxes-down', {}, null, 1);
    this.news(
      `${this.y}: New Year, New Assessments`,
      `Assessors finished the annual revaluation. Under Prop 2½ the levy limit grew 2.5% plus ${(growth / 1e6).toFixed(1)}M in new growth, to ${(this.levyLimit / 1e6).toFixed(1)}M. Residential rate ${r1.rateR.toFixed(2)} (was ${r0.rateR.toFixed(2)}), commercial ${r1.rateC.toFixed(2)} per $1,000.`,
      'big'
    );
    computePatterns(this); // A Pattern Language side measure, once a year
    this.hooks.yearly && this.hooks.yearly(this);
  }

  growth() {
    const w = this.w;
    const n = this.zLots.length;
    if (!n) return;
    const K = Math.max(40, Math.ceil(n / 30));
    const touched = [];
    let devs = 0;
    const slow = this.flags.treeOrdinance ? 0.85 : 1;
    for (let k = 0; k < K; k++) {
      const lot = w.lots[this.zLots[Math.floor(this.rand() * n)]];
      if (!lot || lot.dead || !lot.inTown || lot.under || lot.project) continue;
      const key = lot.zone === ZONE.R ? 'R' : lot.zone === ZONE.C ? 'C' : 'I';
      const d = this.demand[key];
      const c = this.cellOf(lot.cx, lot.cy);
      const crime = this.crimeC[c] / this.base.crimeN;
      const poll = this.pollC[c] / this.base.pollN;
      const des = (this.lvMod[c] - 1) * 1.5 - 0.3 * crime - (key === 'R' ? 0.35 * poll : 0) + (lot.road < 0 ? -1 : 0) + (key === 'C' ? 0.5 * this.vibSat[c] : 0.15 * this.vibSat[c]);
      const target = clamp(0.88 + 0.22 * d + 0.12 * des, 0.12, 1);
      const was = lot.occ;
      lot.occ += (target - lot.occ) * 0.12;
      if ((was < 0.3) !== (lot.occ < 0.3)) for (const id of lot.bldgs) this.hooks.invalidateBuilding && this.hooks.invalidateBuilding(w.bldgs[id]);
      if (lot.locked) continue; // finished projects keep their buildings; occupancy still responds
      const hasB = lot.bldgs.some((id) => w.bldgs[id].alive);
      const cap = lot.dense ? 4 : 2;
      let target2 = 0, why = 'vacant';
      if (!hasB && lot.road >= 0 && d > 0.05 && des > -0.6 && this.rand() < 0.25 * d * slow * GROWTH.vacant) target2 = lot.dense ? (key === 'R' ? 3 : 3) : key === 'R' ? 1 : 2;
      else if (hasB && lot.bldgZone !== lot.zone && d > 0.1 && this.rand() < 0.04 * slow) { target2 = lot.dense ? 3 : 2; why = 'rezoned'; }
      else if (hasB && lot.dens < cap && d > 0.2 && des > -0.1 && lot.area >= 250 && this.t - (lot.built || -999) > 48 && this.rand() < (lot.dense ? 0.05 : 0.025) * d * (1 + des) * slow * GROWTH[key] * sizeW(lot))
        { target2 = Math.min(cap, lot.dens + 1 + (lot.dense && lot.dens <= 2 ? 1 : 0)); why = 'denser'; }
      if (target2 > 0 && this.marketBuild !== false) { // marketBuild=false: history replay builds only what really got built
        const oldVal = lot.landVal + lot.bldgVal;
        const u0 = lot.units || 0, j0 = lot.jobs || 0;
        touched.push(...developLot(w, lot, target2, this.t));
        lot.bldgZone = lot.zone;
        lot.built = this.t;
        lot.occ = 0.6;
        computeLotMetrics(w, lot, false);
        setBldgValue(this, lot, lot.bldArea * bldRate(lot.zone));
        lot.year = this.y;
        const r = this.rates();
        const gain = lot.landVal + lot.bldgVal - oldVal;
        if (gain > 0) this.newGrowth += (gain * (key === 'R' ? r.rateR : r.rateC)) / 1000;
        devs++;
        this.devCount = (this.devCount || 0) + 1;
        // what the market built, by kind (read by tools/validate.mjs)
        const gl = (this.growthLog = this.growthLog || {});
        const g = (gl[key + ':' + why] = gl[key + ':' + why] || { n: 0, units: 0, jobs: 0 });
        g.n++;
        g.units += (lot.units || 0) - u0;
        g.jobs += Math.round((lot.jobs || 0) - j0);
        if (target2 >= 3 && this.rand() < 0.5) {
          const what = key === 'R' ? `${lot.units}-unit apartment building` : key === 'C' ? `${Math.round(lot.bldArea / 92.9) * 1000 > 0 ? Math.round(lot.bldArea * 10.76).toLocaleString() + '-square-foot ' : ''}commercial building` : 'lab building';
          const item = this.news(`New ${what} rises`, `Construction wraps up ${streetOf(lot) ? 'on ' + streetOf(lot) : 'in town'}. ${pick(DEV_QUIPS, this.rand())}`);
          if (this.rand() < 0.6) react(this, 'new-building', { street: streetOf(lot) || 'that street' }, item);
        }
      }
    }
    if (touched.length && this.hooks.invalidateTiles) this.hooks.invalidateTiles(touched);
    this.recalc();
    this.lastDevs = devs;
  }

  updateDemand() {
    const b = this.base;
    const r = this.rates();
    const resT = r.rateR / b.rateR0 - 1, cipT = r.rateC / b.rateC0 - 1;
    const cycle = 0.15 + 0.35 * Math.sin((2 * Math.PI * (this.t + 6)) / 96);
    const raw = {
      R: 0.5 + 1.2 * (this.jobs / this.pop / (b.jobs0 / b.pop0) - 1) - 1.6 * resT + 0.35 * (this.fund.schools - 1) - 0.4 * (this.crimeAvg / b.crimeAvg0 - 1) + this.demandMod.R,
      C: 0.15 + 1.4 * (this.pop / this.cjobs / (b.pop0 / b.cj0) - 1) - 2.2 * cipT - 0.6 * Math.max(0, this.congAvg - b.cong0) + 0.008 * (this.vibrancy - (b.vib0 ?? this.vibrancy)) + this.demandMod.C,
      I: cycle - 2.2 * cipT - 0.8 * (this.ijobs / b.ij0 - 1) + this.demandMod.I - (this.flags.bsl3Ban ? 0.08 : 0),
    };
    const td = techDemand(this);
    raw.R += td.R;
    raw.C += td.C;
    if (!this.demand) this.demand = { R: 0, C: 0, I: 0 };
    for (const k of ['R', 'C', 'I']) this.demand[k] = clamp(this.demand[k] * 0.6 + clamp(raw[k], -1, 1) * 0.4, -1, 1);
  }

  updateApproval(init = false) {
    const b = this.base;
    const r = this.rates();
    const billR = r.rateR / (b.rateR0 || r.rateR) - 1;
    const billC = r.rateC / (b.rateC0 || r.rateC) - 1;
    const ex = this.exemption - 0.35;
    const cong = (this.congAvg || 0) - (b.cong0 || 0);
    const crime = (this.crimeAvg || 0) / (b.crimeAvg0 || 1) - 1;
    const d = this.demand || { R: 0, C: 0, I: 0 };
    const dv = (this.vibrancy || 0) - (b.vib0 ?? this.vibrancy ?? 0);
    // every faction's approval is a sum of named reasons, so the game can say why it moved
    const T = {};
    const add = (k, why, v) => { if (v) (T[k] = T[k] || {})[why] = ((T[k] || {})[why] || 0) + v; };
    add('homeowners', 'baseline', 60); add('renters', 'baseline', 56); add('seniors', 'baseline', 58); add('business', 'baseline', 57); add('commuters', 'baseline', 56);
    add('homeowners', 'tax bills', -70 * billR); add('seniors', 'tax bills', -40 * billR); add('business', 'commercial tax rate', -70 * billC);
    add('homeowners', 'schools', 12 * (this.fund.schools - 1));
    add('homeowners', 'crime', -25 * crime); add('seniors', 'crime', -15 * crime);
    add('homeowners', 'residential exemption', 25 * ex); add('renters', 'residential exemption', -20 * ex);
    add('homeowners', 'home values', 8 * (this.market - 1)); add('renters', 'rents and prices', -10 * (this.market - 1));
    add('renters', 'housing scarcity', -25 * Math.max(0, d.R - 0.3));
    add('renters', 'parks', 6 * (this.fund.parks - 1));
    add('seniors', 'police and fire', 10 * (this.fund.police + this.fund.fire - 2));
    add('business', 'demand for shops and offices', 15 * d.C);
    add('business', 'traffic', -40 * cong); add('commuters', 'traffic', -90 * cong);
    add('business', 'road conditions', 6 * (this.roadCond - 1)); add('commuters', 'road conditions', 15 * (this.roadCond - 1));
    add('renters', 'street life', 0.6 * dv); add('homeowners', 'street life', 0.35 * dv); add('business', 'street life', 0.4 * dv); add('seniors', 'street life', 0.2 * dv);
    if (this.funds < 0) for (const k of FACTIONS) add(k, 'budget in the red', -6);
    const groups = [['projects and places', this.specialApproval()], ['Main Street policies', policyApproval(this)], ['potholes, fires and crews', Object.fromEntries(Object.entries(incidentPenalty(this)).map(([k, v]) => [k, -v]))], ['new technology', techApproval(this)]];
    for (const [why, sp] of groups) for (const [k, v] of Object.entries(sp)) {
      if (k === 'all') for (const g of FACTIONS) add(g, why, v);
      else if (FACTIONS.includes(k)) add(k, why, v);
    }
    for (const k of FACTIONS) add(k, 'your recent decisions', this.approvalOff[k]);
    this.factions = {};
    this.approvalTerms = T;
    let a = 0;
    for (const k of FACTIONS) {
      const sum = Object.values(T[k] || {}).reduce((x, y) => x + y, 0);
      this.factions[k] = clamp(sum, 0, 100);
      a += this.factions[k] * FW[k];
    }
    this.approval = a;
    void init;
  }

  // a short on-map flourish for a big event (drawn by the renderer; harmless when there isn't one)
  moment(kind, x, y, label) {
    if (this.hooks.moment) this.hooks.moment(kind, x, y, label);
  }

  // Which faction moved most since last month, and the reason that moved it most (for the HUD)
  approvalChange() {
    const prev = this.prevTerms, cur = this.approvalTerms;
    this.prevTerms = cur;
    const pa = this.prevApproval;
    this.prevApproval = this.approval;
    if (!prev || pa == null) return null;
    let best = null;
    for (const k of FACTIONS) {
      const keys = new Set([...Object.keys(prev[k] || {}), ...Object.keys(cur[k] || {})]);
      let tot = 0, top = null;
      for (const why of keys) {
        const dd = ((cur[k] || {})[why] || 0) - ((prev[k] || {})[why] || 0);
        tot += dd;
        if (why !== 'baseline' && (!top || Math.abs(dd) > Math.abs(top.d))) top = { why, d: dd };
      }
      if (!best || Math.abs(tot) > Math.abs(best.d)) best = { f: k, d: tot, top };
    }
    if (!best || Math.abs(best.d) < 2) return null;
    return { ...best, overall: this.approval - pa };
  }

  checkGameOver() {
    const bl = this.budgetLines();
    if (this.approval < 30) {
      this.lowMonths++;
      if (this.lowMonths === 4) this.news('Council grows restless', 'Several councilors say the City Manager has "lost the room." Approval is under 30%.', 'big');
      if (this.lowMonths === 9) this.news('Council schedules performance review', 'Your contract is on the agenda. Get approval above 30% soon.', 'big');
    } else this.lowMonths = Math.max(0, this.lowMonths - 1);
    if (this.funds < -0.12 * bl.expenses) {
      this.debtMonths++;
      if (this.debtMonths === 3) this.news('State warns of fiscal trouble', 'The Department of Revenue is watching the city’s deficit closely.', 'big');
    } else this.debtMonths = Math.max(0, this.debtMonths - 1);
    if (this.lowMonths >= 12) this.gameOver = { title: 'Contract not renewed', text: 'After a year of sub-30% approval, the City Council voted not to renew your contract. Somewhere, a commenter is being reminded to use their full name.' };
    else if (this.debtMonths >= 8) this.gameOver = { title: 'State receivership', text: 'The city ran a deep deficit for too long. The Commonwealth has appointed a fiscal control board.' };
  }

  // ---------------- random events ----------------
  randomEvents() {
    const w = this.w;
    // flavour
    if (this.rand() < 0.22) this.flavour();
  }

  flavour() {
    const w = this.w;
    const r = this.rand();
    if (r < 0.45) {
      const withBiz = [];
      for (let k = 0; k < 40; k++) {
        const lot = w.lots[Math.floor(this.rand() * w.lots.length)];
        if (lot && lot.biz && lot.biz.length && lot.inTown && !lot.dead) withBiz.push(lot);
      }
      if (withBiz.length) {
        const lot = withBiz[0];
        const name = lot.biz[Math.floor(this.rand() * lot.biz.length)];
        const title = pick(BIZ_HEADLINES, this.rand()).replace('{b}', name);
        if (this.newsLog.slice(0, 25).some((n) => n.title === title)) return;
        this.news(title, '');
        return;
      }
    }
    const recent = new Set(this.newsLog.slice(0, 25).map((n) => n.title));
    const fresh = TICKER.filter((t) => !recent.has(t));
    this.news(pick(fresh.length ? fresh : TICKER, this.rand()), '');
  }

  news(title, body = '', size = 'small') {
    const item = { t: this.t, date: this.dateStr(), title, body, size };
    this.newsLog.unshift(item);
    if (this.newsLog.length > 80) this.newsLog.pop();
    this.hooks.news && this.hooks.news(item);
    return item;
  }

  // ---------------- scenario effects ----------------
  // dollar amounts written in today's money shrink for earlier start years (about 3% a year)
  priceF() {
    return Math.min(1, Math.pow(1.03, this.y - 2026));
  }
  apply(eff = {}) {
    const w = this.w;
    const pf = this.priceF();
    if (eff.funds) this.funds += eff.funds * pf;
    if (eff.approval) for (const [k, v] of Object.entries(eff.approval)) {
      if (k === 'all') FACTIONS.forEach((f) => (this.approvalOff[f] += v));
      else this.approvalOff[k] = (this.approvalOff[k] || 0) + v;
    }
    if (eff.demand) for (const [k, v] of Object.entries(eff.demand)) this.demandMod[k] += v;
    if (eff.recurring) {
      const rc = eff.recurring;
      if (rc.monthly === 0) delete this.recurring[rc.key];
      else this.recurring[rc.key] = { label: rc.label, monthly: rc.monthly * pf, until: rc.months ? this.t + rc.months : null };
    }
    if (eff.bond) {
      const yrs = eff.bond.years || 20;
      const annual = (eff.bond.amount * pf * 0.04) / (1 - Math.pow(1.04, -yrs));
      this.recurring['bond:' + eff.bond.label] = { label: `Bond: ${eff.bond.label}`, monthly: annual / 12, until: this.t + yrs * 12 };
    }
    if (eff.flag) Object.assign(this.flags, eff.flag);
    if (eff.lvNear) this.lvNear(eff.lvNear);
    if (eff.capNear) this.capNear(eff.capNear);
    if (eff.later) this.pending.push({ at: this.t + eff.later.months, id: eff.later.id, data: eff.later.data || null });
    if (eff.fund) for (const [k, v] of Object.entries(eff.fund)) this.fund[k] = clamp(this.fund[k] + v, 0, 1.2);
    if (eff.capShare) this.capShare += eff.capShare;
    if (eff.news) this.news(eff.news[0], eff.news[1] || '', eff.news[2] || 'small');
    this.computeAll();
    this.updateApproval();
  }
  anchor(at) {
    if (Array.isArray(at)) return at;
    if (at === 'square') return this.w.start;
    if (at === 'river') {
      const { W, H, terrain, inTown } = this.w;
      let sx = 0, sy = 0, n = 0;
      for (let i = 0; i < W * H; i += 7) if (terrain[i] === 1 && inTown[i]) { sx += i % W; sy += (i / W) | 0; n++; }
      return n ? [sx / n, sy / n] : this.w.start;
    }
    return this.w.start;
  }
  lvNear({ at, r = 30, amt = 0.05, road }) {
    const { Wc, Hc } = this;
    if (road) {
      const re = new RegExp(road, 'i');
      const { W, roadName, names } = this.w;
      for (const i of this.roadList) {
        if (!re.test(names[roadName[i]] || '')) continue;
        const c = this.cellOf(i % W, (i / W) | 0);
        this.lvLocal[c] = clamp(this.lvLocal[c] + amt * 0.5, 0.5, 2);
      }
      return;
    }
    const [x0, y0] = this.anchor(at);
    const rc = r / CC;
    for (let y = 0; y < Hc; y++)
      for (let x = 0; x < Wc; x++) {
        const d = Math.hypot(x + 0.5 - x0 / CC, y + 0.5 - y0 / CC);
        if (d < rc) this.lvLocal[y * Wc + x] = clamp(this.lvLocal[y * Wc + x] + amt * (1 - d / rc), 0.5, 2);
      }
  }
  capNear({ at, r = 12, amt = -0.1, road }) {
    const { W, roadName, names } = this.w;
    const re = road ? new RegExp(road, 'i') : null;
    const [x0, y0] = re ? [0, 0] : this.anchor(at);
    for (const i of this.roadList) {
      if (re ? !re.test(names[roadName[i]] || '') : Math.hypot((i % W) - x0, ((i / W) | 0) - y0) > r) continue;
      this.capLocal[i] = clamp(this.capLocal[i] * (1 + amt), 0.2, 3);
    }
  }
  hasRoad(name) {
    const re = new RegExp(name, 'i');
    return this.w.names.some((n) => re.test(n));
  }
  // find a lot matching a predicate, preferring closeness to an anchor
  findLot(pred, at = null, maxD = Infinity) {
    const a = at ? this.anchor(at) : null;
    let best = null, bd = Infinity;
    for (const lot of this.w.lots) {
      if (lot.dead || !lot.inTown || !lot.tiles.length || lot.project || lot.under || lot.locked || !pred(lot)) continue;
      const d = a ? Math.hypot(lot.cx - a[0], lot.cy - a[1]) + this.rand() * 4 : this.rand();
      if (d < bd && d <= maxD) { bd = d; best = lot; }
    }
    return best;
  }
  develop(lot, dens, zone = null) {
    if (zone != null) lot.zone = zone;
    const oldVal = lot.landVal + lot.bldgVal;
    const touched = developLot(this.w, lot, dens, this.t + 101);
    lot.bldgZone = lot.zone;
    lot.built = this.t;
    lot.occ = 0.7;
    computeLotMetrics(this.w, lot, false);
    setBldgValue(this, lot, lot.bldArea * bldRate(lot.zone));
    const gain = lot.landVal + lot.bldgVal - oldVal;
    const r = this.rates();
    if (gain > 0) this.newGrowth += (gain * (lot.zone === ZONE.R ? r.rateR : r.rateC)) / 1000;
    this.hooks.invalidateTiles && this.hooks.invalidateTiles(touched.concat(lot.tiles));
    this.recalc();
    return lot;
  }

  // ---------------- player tools ----------------
  rectTiles(a, b) {
    const { W } = this.w;
    const ax = a % W, ay = (a / W) | 0, bx = b % W, by = (b / W) | 0;
    const out = [];
    for (let y = Math.min(ay, by); y <= Math.max(ay, by); y++) for (let x = Math.min(ax, bx); x <= Math.max(ax, bx); x++) out.push(y * W + x);
    return out;
  }
  lineTiles(a, b) {
    const { W } = this.w;
    const ax = a % W, ay = (a / W) | 0, bx = b % W, by = (b / W) | 0;
    const out = [];
    const horizFirst = Math.abs(bx - ax) >= Math.abs(by - ay);
    if (horizFirst) {
      for (let x = Math.min(ax, bx); x <= Math.max(ax, bx); x++) out.push(ay * W + x);
      for (let y = Math.min(ay, by); y <= Math.max(ay, by); y++) if (y !== ay) out.push(y * W + bx);
    } else {
      for (let y = Math.min(ay, by); y <= Math.max(ay, by); y++) out.push(y * W + ax);
      for (let x = Math.min(ax, bx); x <= Math.max(ax, bx); x++) if (x !== ax) out.push(by * W + x);
    }
    return out;
  }
  bAlive(i) {
    const b = this.w.bAt[i];
    return b >= 0 && this.w.bldgs[b].alive;
  }

  plan(tool, a, b, opts = {}) {
    const w = this.w;
    const { W, H, inTown, road, terrain, svcAt, lotOf } = w;
    if (a < 0) return null;
    let picked = null; // for bulldozing: the tiles actually dragged over (trees there go; a cleared lot's yard trees stay)
    if (b < 0) b = a;
    let tiles = [], cost = 0, ok = true, msg = '', p0line = null;
    if (tool === 'road') {
      // any angle, optionally bent through a control point (quadratic curve); drawn as a smooth line
      const ax = (a % W) + 0.5, ay = ((a / W) | 0) + 0.5, bx = (b % W) + 0.5, by = ((b / W) | 0) + 0.5;
      const ctrl = opts.ctrl;
      const line = [];
      const steps = ctrl ? Math.max(8, Math.ceil(Math.hypot(bx - ax, by - ay) * 1.5)) : 1;
      for (let k = 0; k <= steps; k++) {
        const t = k / steps;
        if (ctrl) line.push((1 - t) ** 2 * ax + 2 * (1 - t) * t * ctrl[0] + t * t * bx, (1 - t) ** 2 * ay + 2 * (1 - t) * t * ctrl[1] + t * t * by);
        else line.push(ax + (bx - ax) * t, ay + (by - ay) * t);
      }
      tiles = a === b ? [a] : this.polyTiles(line);
      p0line = line;
      for (const i of tiles) {
        if (!inTown[i]) { ok = false; msg = 'Outside city limits'; }
        else if (this.bAlive(i)) { ok = false; msg = 'A building is in the way — bulldoze first'; }
        else if (svcAt[i] >= 0) { ok = false; msg = 'A city facility is in the way'; }
        else if (!road[i]) cost += terrain[i] === 1 ? 450000 : 35000;
      }
      if (ok) msg = `Road: ${tiles.filter((i) => !road[i]).length} tiles`;
    } else if (tool === 'bulldoze') {
      // Auto: if the selection takes in any buildings, it's about the buildings and the roads in it are left alone;
      // a selection of nothing but road (and trees) removes the road. opts.only can force either, or 'all'.
      const sel = (opts.tiles || this.rectTiles(a, b)).filter((i) => inTown[i]);
      picked = new Set(sel);
      const anyBldg = sel.some((i) => this.bAlive(i) || svcAt[i] >= 0);
      const only = opts.only && opts.only !== 'auto' ? opts.only : anyBldg ? 'buildings' : sel.some((i) => road[i]) ? 'roads' : 'buildings';
      tiles = sel.filter((i) => (only === 'roads' ? road[i] && !this.bAlive(i) && svcAt[i] < 0 : only === 'buildings' ? !road[i] || this.bAlive(i) || svcAt[i] >= 0 : true));
      const lotsHit = new Set();
      let roadN = 0;
      for (const i of tiles) {
        if (svcAt[i] >= 0) cost += 60000;
        else if (this.bAlive(i)) {
          const li = lotOf[i];
          if (li >= 0) lotsHit.add(li);
          else cost += 20000;
        } else if (road[i]) { cost += 4000; roadN++; }
        else if (w.tree[i]) cost += 200;
      }
      for (const li of lotsHit) cost += 15000 + w.lots[li].bldArea * 25;
      // show the whole of each lot that will be cleared
      if (lotsHit.size) {
        const shown = new Set(tiles);
        for (const li of lotsHit) for (const i of w.lots[li].tiles) if (!road[i]) shown.add(i);
        tiles = [...shown];
      }
      this.bulldozeMode = only;
      msg = only === 'roads' ? (roadN ? `Remove ${roadN} road tile${roadN > 1 ? 's' : ''} · buildings untouched` : 'Roads only: drag over road') : lotsHit.size ? `Demolish ${lotsHit.size} building lot${lotsHit.size > 1 ? 's' : ''}${only === 'buildings' ? ' · roads untouched' : ''}` : only === 'buildings' ? 'Bulldoze (roads untouched)' : 'Bulldoze everything';
    } else if (tool === 'zoneR' || tool === 'zoneC' || tool === 'zoneI' || tool === 'dezone') {
      tiles = (opts.tiles || this.rectTiles(a, b)).filter((i) => inTown[i] && terrain[i] !== 1 && !road[i] && svcAt[i] < 0);
      const lotsHit = new Set();
      let fresh = 0;
      for (const i of tiles) {
        if (lotOf[i] >= 0) lotsHit.add(lotOf[i]);
        else if (!this.bAlive(i)) fresh++;
      }
      cost = lotsHit.size * 1500 + fresh * 300;
      msg = `${lotsHit.size} lots rezoned, ${fresh} new tiles`;
    } else if (tool === 'park') {
      tiles = (opts.tiles || this.rectTiles(a, b)).filter((i) => inTown[i]);
      for (const i of tiles) {
        if (terrain[i] === 1 || road[i] || this.bAlive(i) || svcAt[i] >= 0) { ok = false; msg = 'Clear the land first'; }
        else if (w.cover[i] !== COVER.PARK) cost += 25000;
      }
      if (ok) msg = 'Park';
    } else if (SERVICES[tool]) {
      const sz = SERVICES[tool].size;
      const ax = a % W, ay = (a / W) | 0;
      for (let y = ay; y < ay + sz; y++)
        for (let x = ax; x < ax + sz; x++) {
          if (x >= W || y >= H) { ok = false; continue; }
          const i = y * W + x;
          tiles.push(i);
          if (!inTown[i] || terrain[i] === 1 || road[i] || this.bAlive(i) || svcAt[i] >= 0) ok = false;
        }
      cost = SERVICES[tool].cost;
      msg = ok ? `${SERVICES[tool].label}: $${(cost / 1e6).toFixed(0)}M` : 'Needs clear, dry land inside the city';
    }
    if (ok && cost > this.funds && cost > 0) {
      ok = false;
      msg = 'Not enough funds';
    }
    if (tool !== 'develop' && tiles.some((i) => lotOf[i] >= 0 && (w.lots[lotOf[i]].project || w.lots[lotOf[i]].under))) {
      ok = false;
      msg = 'That is a project site — wait until it opens';
    }
    return { tool, tiles, cost, ok, msg, line: p0line, cls: opts.avenue ? 2 : 1, picked: picked || null };
  }
  // tiles under a polyline, 4-connected so traffic can flow along it
  polyTiles(line) {
    const { W, H } = this.w;
    const out = [], seen = new Set();
    const add = (x, y) => { if (x < 0 || y < 0 || x >= W || y >= H) return; const i = y * W + x; if (!seen.has(i)) { seen.add(i); out.push(i); } };
    let px = null, py = null;
    for (let k = 0; k + 3 < line.length; k += 2) {
      const ax = line[k], ay = line[k + 1], bx = line[k + 2], by = line[k + 3];
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) * 4));
      for (let j = 0; j <= n; j++) {
        const x = Math.floor(ax + ((bx - ax) * j) / n), y = Math.floor(ay + ((by - ay) * j) / n);
        if (px !== null && x !== px && y !== py) add(x, py); // no diagonal-only steps
        add(x, y);
        px = x; py = y;
      }
    }
    return out;
  }

  // ---------------- undo ----------------
  // Map edits (bulldoze, roads, zoning, parks, civic buildings) can be undone for a month or so afterwards.
  // Before an edit, every per-tile array is copied; afterwards only the tiles that changed are kept, along
  // with copies of the lots and buildings nearby, so an undo entry is small.
  execute(p, opts = {}) {
    if (!p || !p.ok) return false;
    const u = this.undoBegin(p);
    const r = this.executeEdit(p, opts);
    if (r) this.undoEnd(u, p);
    return r;
  }
  undoArrays() {
    const out = [];
    for (const [owner, obj] of [['w', this.w], ['s', this]]) for (const k of Object.keys(obj)) {
      const v = obj[k];
      if (ArrayBuffer.isView(v) && v.length === this.N && !['traffic', 'congestion', 'vpd', 'flow', 'jf', 'V0', 'M0', 'incBlock'].includes(k)) out.push([owner, k, v]);
    }
    return out;
  }
  undoBegin(p) {
    const w = this.w, { W, H } = w;
    let x0 = W, y0 = H, x1 = 0, y1 = 0;
    for (const i of p.tiles) { const x = i % W, y = (i / W) | 0; if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
    const ids = new Set();
    for (let y = Math.max(0, y0 - 4); y <= Math.min(H - 1, y1 + 4); y++) for (let x = Math.max(0, x0 - 4); x <= Math.min(W - 1, x1 + 4); x++) { const li = w.lotOf[y * W + x]; if (li >= 0) ids.add(li); }
    const lots = [...ids].map((id) => [id, structuredClone(w.lots[id])]);
    const alive = [];
    for (const [, l] of lots) for (const b of l.bldgs) alive.push([b, w.bldgs[b].alive]);
    for (let y = Math.max(0, y0 - 2); y <= Math.min(H - 1, y1 + 2); y++) for (let x = Math.max(0, x0 - 2); x <= Math.min(W - 1, x1 + 2); x++) { const b = w.bAt[y * W + x]; if (b >= 0) alive.push([b, w.bldgs[b].alive]); }
    return {
      arrays: this.undoArrays().map(([o, k, v]) => [o, k, v.slice()]),
      lots, alive, lotsLen: w.lots.length, bldgsLen: w.bldgs.length, roadLinesLen: (w.roadLines || []).length,
      services: structuredClone(w.services), funds: this.funds, newGrowth: this.newGrowth, t: this.t,
    };
  }
  undoEnd(u, p) {
    const diffs = [];
    const now = new Map(this.undoArrays().map(([o, k, v]) => [o + ':' + k, v]));
    for (const [o, k, old] of u.arrays) {
      const cur = now.get(o + ':' + k);
      if (!cur) continue;
      const idx = [];
      for (let i = 0; i < old.length; i++) if (old[i] !== cur[i] && !(old[i] !== old[i] && cur[i] !== cur[i])) idx.push(i);
      if (!idx.length) continue;
      const vals = new old.constructor(idx.length);
      idx.forEach((i, j) => (vals[j] = old[i]));
      diffs.push([o, k, Int32Array.from(idx), vals]);
    }
    const label = { bulldoze: 'Bulldoze', road: 'Road', zoneR: 'Residential zoning', zoneC: 'Commercial zoning', zoneI: 'Industrial zoning', dezone: 'Dezoning', park: 'Park' }[p.tool] || 'Build';
    this.undoStack = (this.undoStack || []).concat([{ ...u, arrays: null, diffs, label, cost: u.funds - this.funds, roads: p.tool === 'road' || p.tool === 'bulldoze' }]).slice(-20);
  }
  canUndo() {
    const st = (this.undoStack || []).filter((e) => this.t - e.t <= 1);
    this.undoStack = st;
    return st.length ? st[st.length - 1] : null;
  }
  undo() {
    const e = this.canUndo();
    if (!e) return null;
    this.undoStack.pop();
    const w = this.w;
    for (const [o, k, idx, vals] of e.diffs) { const arr = (o === 'w' ? w : this)[k]; if (arr) for (let j = 0; j < idx.length; j++) arr[idx[j]] = vals[j]; }
    for (const [id, clone] of e.lots) { const lot = w.lots[id]; for (const k of Object.keys(lot)) if (!(k in clone)) delete lot[k]; Object.assign(lot, clone); }
    for (let id = e.lotsLen; id < w.lots.length; id++) { w.lots[id].dead = 1; w.lots[id].tiles = []; w.lots[id].bldgs = []; }
    for (const [b, a] of e.alive) w.bldgs[b].alive = a;
    for (let b = e.bldgsLen; b < w.bldgs.length; b++) w.bldgs[b].alive = 0;
    w.services.length = 0;
    w.services.push(...e.services);
    if (w.roadLines) w.roadLines.length = Math.min(w.roadLines.length, e.roadLinesLen);
    this.funds += e.cost; // the money comes back; the months that passed don't
    this.newGrowth = e.newGrowth;
    this.rebuildRoadList();
    this.recalc();
    this.walkDirty = true;
    this.parkPts = null;
    this.computeAll();
    if (e.roads) {
      this.hooks.roadsChanged && this.hooks.roadsChanged([]);
      if (this.flow) this.reassign();
    }
    this.hooks.invalidateAll && this.hooks.invalidateAll();
    return e;
  }

  executeEdit(p, opts = {}) {
    if (!p || !p.ok) return false;
    const w = this.w;
    const { W, road, lotOf, svcAt, bldgs } = w;
    const touched = [];
    if (p.tool === 'road') {
      const cls = p.cls || 1;
      if (p.line && p.tiles.length > 1) w.roadLines.push({ cls, pts: Float32Array.from(p.line), bridge: p.tiles.some((i) => w.terrain[i] === 1), player: 1 });
      for (const i of p.tiles) {
        if (p.line) { w.osmRoad[i] = 1; w.roadCut[i] = 0; }
        if (road[i] >= cls) continue;
        road[i] = cls;
        const li = lotOf[i];
        if (li >= 0) this.removeTileFromLot(li, i);
        w.tree[i] = 0;
        touched.push(i);
      }
      this.rebuildRoadList();
      this.refreshRoadAccess(p.tiles);
      if (p.line) this.hooks.roadsChanged && this.hooks.roadsChanged(p.tiles);
      if (this.flow) this.reassign();
    } else if (p.tool === 'bulldoze') {
      const done = new Set();
      for (const i of p.tiles) {
        if (svcAt[i] >= 0) {
          const s = w.services[svcAt[i]];
          if (s) this.removeService(s, touched);
        } else if (this.bAlive(i)) {
          const li = lotOf[i];
          if (li >= 0 && !done.has(li)) {
            done.add(li);
            const lot = w.lots[li];
            for (const id of lot.bldgs) touched.push(...demolish(w, bldgs[id]));
            lot.bldgs = [];
            lot.baseBldg = 0;
            lot.bldgVal = 0;
            lot.otherVal = 0;
            for (const s of w.services) if (s.real && s.lot === li) s.alive = 0;
            computeLotMetrics(w, lot, false);
            touched.push(...lot.tiles);
          } else if (li < 0) touched.push(...demolish(w, bldgs[w.bAt[i]]));
        } else if (road[i]) {
          road[i] = 0;
          this.roadsCut = true;
          if (w.roadCut) w.roadCut[i] = 1;
          touched.push(i);
        } else if (w.tree[i] && (!p.picked || p.picked.has(i))) {
          w.tree[i] = 0;
          touched.push(i);
        }
      }
      this.rebuildRoadList();
      this.refreshRoadAccess(p.tiles);
      if (this.roadsCut && this.flow) { this.roadsCut = false; this.reassign(); }
    } else if (p.tool.startsWith('zone') || p.tool === 'dezone') {
      const zone = p.tool === 'zoneR' ? ZONE.R : p.tool === 'zoneC' ? ZONE.C : p.tool === 'zoneI' ? ZONE.I : ZONE.NONE;
      const dense = !!opts.dense;
      const lotsHit = new Set();
      const freeT = [];
      for (const i of p.tiles) {
        if (lotOf[i] >= 0) lotsHit.add(lotOf[i]);
        else if (!this.bAlive(i)) freeT.push(i);
      }
      for (const li of lotsHit) {
        const lot = w.lots[li];
        lot.zone = zone;
        lot.dense = dense;
        if (lot.bldgZone == null) lot.bldgZone = zone;
        touched.push(...lot.tiles);
      }
      // carve new 2x2 lots from bare land
      const freeSet = new Set(freeT);
      for (const i of freeT) {
        if (!freeSet.has(i)) continue;
        const x = i % W, y = (i / W) | 0;
        const tiles = [];
        for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
          const j = (y + dy) * W + x + dx;
          if (freeSet.has(j) && x + dx < W) { tiles.push(j); freeSet.delete(j); }
        }
        if (zone === ZONE.NONE) continue;
        this.newLot(tiles, zone, dense);
        touched.push(...tiles);
      }
    } else if (p.tool === 'park') {
      this.parkPts = null;
      this.walkDirty = true;
      for (const i of p.tiles) {
        w.cover[i] = COVER.PARK;
        if (lotOf[i] >= 0) this.removeTileFromLot(lotOf[i], i);
        if (hash2(i, 9, 9) < 0.45) w.tree[i] = 1;
        touched.push(i);
      }
    } else if (SERVICES[p.tool]) {
      const sz = SERVICES[p.tool].size;
      const x = p.tiles[0] % W, y = (p.tiles[0] / W) | 0;
      const b = addServiceBuilding(w, p.tool, x, y, sz);
      const s = { id: w.services.length, type: p.tool, x: x + sz / 2, y: y + sz / 2, name: `New ${SERVICES[p.tool].label}`, real: 0, lot: -1, alive: 1, bid: b.id, tiles: p.tiles.slice() };
      w.services.push(s);
      for (const i of p.tiles) {
        svcAt[i] = s.id;
        if (lotOf[i] >= 0) this.removeTileFromLot(lotOf[i], i);
        w.tree[i] = 0;
        touched.push(i);
      }
      const item = this.news(`City opens ${SERVICES[p.tool].label.toLowerCase()}`, 'A ribbon was cut. A councilor gave a speech that ran long.');
      react(this, 'service-built', { what: SERVICES[p.tool].label.toLowerCase() }, item);
    }
    this.funds -= p.cost;
    this.recalc();
    this.computeAll();
    this.hooks.invalidateTiles && this.hooks.invalidateTiles(touched);
    return true;
  }
  removeService(s, touched) {
    const w = this.w;
    s.alive = 0;
    if (s.bid != null) touched.push(...demolish(w, w.bldgs[s.bid]));
    for (const i of s.tiles || []) {
      w.svcAt[i] = -1;
      touched.push(i);
    }
  }
  removeTileFromLot(li, i) {
    const w = this.w;
    const lot = w.lots[li];
    lot.tiles = lot.tiles.filter((t) => t !== i);
    w.lotOf[i] = -1;
    if (!lot.tiles.length) lot.dead = 1;
  }
  newLot(tiles, zone, dense) {
    const w = this.w;
    const W = w.W;
    let cx = 0, cy = 0, lv = 0;
    for (const i of tiles) { cx += (i % W) + 0.5; cy += ((i / W) | 0) + 0.5; lv += w.lvBase[i]; }
    cx /= tiles.length; cy /= tiles.length;
    const area = tiles.length * 256;
    const landVal = (lv / tiles.length) * area * this.market;
    const lot = {
      id: w.lots.length, tiles, cx, cy, real: 0, zone, mixed: false, code3: '', landVal, bldgVal: 0, otherVal: 0, totalVal: landVal,
      area, bldArea: 0, units: 0, records: 1, year: 0, addr: '', useDesc: 'New city-zoned lot', style: '', stories: NaN, zoning: '', biz: [], bldgs: [],
      occ: 0.9, dens: 0, jobs: 0, pop: 0, road: -1, dense, inTown: 1, built: this.t, baseLand: landVal / this.market, baseBldg: 0, bldgZone: zone,
    };
    w.lots.push(lot);
    for (const i of tiles) w.lotOf[i] = lot.id;
    lot.road = findRoad(w, lot);
    return lot;
  }
  refreshRoadAccess(tiles) {
    const w = this.w;
    const W = w.W;
    let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
    for (const i of tiles) { const x = i % W, y = (i / W) | 0; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    for (const lot of w.lots) {
      if (lot.dead) continue;
      if (lot.cx < x0 - 8 || lot.cx > x1 + 8 || lot.cy < y0 - 8 || lot.cy > y1 + 8) continue;
      lot.road = findRoad(w, lot);
    }
  }

  // ---------------- overlays ----------------
  overlayColor(mode, i) {
    const w = this.w;
    const { W } = w;
    const x = i % W, y = (i / W) | 0;
    if (!w.inTown[i]) return null;
    const c = this.cellOf(x, y);
    const ramp = rampColor;
    switch (mode) {
      case 'zones': {
        if (w.road[i]) return [80, 80, 80, 160];
        const li = w.lotOf[i];
        if (li < 0) return null;
        const z = w.lots[li].zone;
        const col = ZONE_RGB[z];
        if (!col) return null;
        return [...col, w.lots[li].dense ? 230 : 140];
      }
      case 'landvalue': {
        if (w.terrain[i] === 1 || w.road[i]) return null;
        const v = (w.lvBase[i] * this.lvMod[c] * this.market) / (w.lvMedian * 2.2);
        return ramp(v);
      }
      case 'traffic': {
        if (!w.road[i]) return null;
        return ramp(this.congestion[i] / 1.4);
      }
      case 'crime':
        return ramp(this.crimeC[c] / (this.base.crimeN * 1.4));
      case 'pollution':
        return ramp(this.pollC[c] / (this.base.pollN * 1.4));
      case 'police':
        return ramp(1 - this.polCov[c]);
      case 'fire':
        return ramp(1 - this.fireCov[c]);
      case 'walk': {
        if (w.terrain[i] === 1 || !this.walkS) return null;
        const v = this.walkS[c] / 100;
        if (!v) return null;
        return walkColor(v);
      }
      case 'vibrancy': {
        if (w.terrain[i] === 1) return null;
        return vibColor(this.vibSat[c]);
      }
      case 'growth': {
        const li = w.lotOf[i];
        if (li < 0) return null;
        const lot = w.lots[li];
        if (lot.built > 0 && lot.year >= (this.y0 ?? CFG.START.y)) return GROWTH_RGB.built;
        if (lot.occ < 0.3) return GROWTH_RGB.aband;
        return null;
      }
    }
    return null;
  }

  // ---------------- save ----------------
  serialize() {
    const skip = new Set(['undoStack', 'calF', 'V0', 'M0', 'vpd', 'flow', 'jf', 'trafficWorker', 'w', 'hooks', 'traffic', 'congestion', 'popC', 'jobsC', 'indC', 'trafC', 'crimeC', 'pollC', 'polCov', 'fireCov', 'schoolCov', 'parkC', 'specialC', 'lvMod', 'rand', 'roadList', 'zLots', 'lvLocal', 'capLocal', 'S0', 'incBlock', 'vibF', 'vibC', 'vibSat', 'popNear', 'jobsNear', 'vibKernel', 'slKernel', 'walkS', 'walkC', 'interC', 'parkPts']);
    const sim = {};
    for (const [k, v] of Object.entries(this)) if (!skip.has(k)) sim[k] = v;
    return { sim: JSON.parse(JSON.stringify(sim)), lvLocal: Array.from(this.lvLocal), capLocal: this.capLocal, S0: Array.from(this.S0), V0: this.V0 || null, M0: this.M0 || null };
  }
}

// Overlay colour scales (shared with the legend in js/legend.js)
export function rampColor(v) {
  v = clamp(v, 0, 1);
  return [Math.round(40 + 215 * v), Math.round(200 - 150 * Math.abs(v - 0.3)), Math.round(220 * (1 - v)), 200];
}
export const walkColor = (v) => [Math.round(255 * (1 - v)), Math.round(90 + 150 * v), Math.round(70 + 120 * v), 150];
export function vibColor(v) {
  if (v < 0) return [70, 40, 34, Math.round(170 + 80 * Math.min(1, -v / 0.6))];
  if (v < 0.04) return [40, 40, 60, 90];
  return [255, Math.round(220 - 170 * v), Math.round(70 + 120 * v), Math.round(110 + 140 * v)];
}
export const ZONE_RGB = [null, [60, 220, 60], [70, 140, 255], [250, 200, 40], [200, 120, 255], [40, 150, 70]];
export const GROWTH_RGB = { built: [255, 120, 220, 220], aband: [120, 60, 40, 220] };

export function streetOf(lot) {
  if (lot.addr) {
    const s = lot.addr
      .replace(/^[0-9\-A-Za-z]*[0-9][0-9\-A-Za-z]*\s+/, '')
      .replace(/\s+(#|Unit\s*|Apt\s*|Ste\s*)?[0-9][0-9A-Za-z\-]*$/i, '')
      .trim();
    if (s) return s;
  }
  return '';
}
function pick(arr, r) {
  return arr[Math.floor(r * arr.length) % arr.length];
}

const CLOSE_BODIES = [
  'The owner says the landlord\'s new asking rent made the numbers impossible. Regulars are leaving notes on the door.',
  '"We kept hearing Watertown is on the rise," the owner said. "Apparently we\'re not invited."',
  'The listing already describes the space as "ideal for a national tenant."',
  'A handwritten sign thanks customers for the years. Someone has added a heart.',
];
const OPEN_BODIES = [
  'The owners say they picked Watertown because it "still has storefronts you can almost afford."',
  'There was a line on opening day. Of course there was.',
  'Neighbors report the smell alone has raised property values.',
];
const CHAIN_BODIES = [
  'Commenters are already counting the bank branches within a block.',
  'The landlord says the national tenant "simply offered more." The previous tenant agrees.',
  'It will have the same menu as the one in Waltham, which some consider a feature.',
];
const DEV_QUIPS = [
  'Neighbors describe the design as "rectangular."',
  'The comment section has already declared it the end of an era.',
  'At least three residents asked, "But where will everyone park?"',
  'A banner promises "luxury living." A commenter promises to never set foot in it.',
  'The developer called it "transit-oriented." The 70 bus was unavailable for comment.',
  'The rats near the construction fence have been reported to the Health Department.',
];
const BIZ_HEADLINES = [
  'Line at {b} spills onto the sidewalk',
  '{b} marks another year in business',
  'Rumor mill: is {b} expanding?',
  'Regulars swear by {b}; newcomers agree',
  '{b} adds outdoor seating, debate ensues',
  'Comment section argues about parking near {b}',
];
const TICKER = [
  'Delta celebrates another year as a triangle',
  'Editor reminds commenter, for the 4,000th time, to use full name',
  'Local rat spotted wearing hard hat near construction zone',
  'Faire on the Square rained on, declared a success anyway',
  'Armenian bakeries report brisk lahmajoun sales; diet plans postponed',
  'Watertown briefly considers renaming itself "Water-City"',
  'Overnight parking ban begins; cars seek shelter at school lots',
  'Fish ladder reports record herring traffic; Square traffic unchanged',
  'Study finds one in three cars just wants to get to the Pike',
  'Sculpture walk adds new piece; residents debate whether it is art or a bike rack',
  'Library gets new carpet; shushing unaffected',
  'Snow emergency lifted; snowbanks remain taller than most councilors',
  'Council meeting runs to 11:40 p.m.; public comment still going',
  'Resident asks, again, why it is called a Square when it has five corners',
  'Bus 70 wins award for being leisurely',
  'Coyote seen using Community Path as intended',
  'Pickleball noise complaint filed; pickleball undeterred',
  'Leaf blower debate enters its third season',
];
