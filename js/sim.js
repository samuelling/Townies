// City simulation: budget (with Massachusetts Prop 2½ levy limits), growth, traffic, services, approval.
import { CFG, ZONE, COVER, SERVICES } from './config.js';
import { clamp, hash2, rng, percentile, MONTHS } from './util.js';
import { computeLotMetrics, developLot, findRoad, demolish, addServiceBuilding, bldRate, buildingTiles } from './world.js';

const CC = 4;
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
    this.lvMod = new Float32Array(Nc).fill(1);
    this.paused = false;
    this.speed = 1;
    this.rand = rng(Date.now() & 0xffffffff);
    this.rebuildRoadList();
    if (state) {
      Object.assign(this, state.sim);
      this.lvLocal = Float32Array.from(state.lvLocal);
      this.capLocal = Float32Array.from(state.capLocal);
      this.S0 = Float32Array.from(state.S0);
      this.rand = rng(Date.now() & 0xffffffff);
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
    return (this.y - CFG.START.y) * 12 + this.m;
  }
  dateStr() {
    return `${MONTHS[this.m]} ${this.y}`;
  }

  // ---------------- setup ----------------
  newGame() {
    const w = this.w;
    this.y = CFG.START.y;
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
    this.computeAll(true);
    this.demand = { R: 0, C: 0, I: 0 };
    for (let k = 0; k < 6; k++) this.updateDemand();
    this.updateApproval(true);
    this.pushHistory(0, 0);
    this.news('Welcome, City Manager', `The City Council has hired you to run ${this.w.demo ? 'Demoville' : 'Watertown'}. Population ${Math.round(this.pop).toLocaleString()}, about ${(this.taxBase().V / 1e9).toFixed(1)} billion dollars of taxable property, and a lot of opinions.`, 'big');
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
    const infl = Math.pow(1.025, this.t / 12);
    const scale = {
      schools: Math.pow(this.pop / this.base.pop0, 0.7),
      police: 1 + 0.15 * (this.policeN - this.base.police0),
      fire: 1 + 0.15 * (this.fireN - this.base.fire0),
      roads: this.roadList.length / this.base.roads0,
      parks: this.parkTiles / this.base.parks0,
    };
    const exp = {};
    for (const d of DEPTS) exp[d] = this.base.dept[d] * this.fund[d] * scale[d] * infl;
    exp.other = this.base.dept.other * Math.pow(1.02, this.t / 12);
    let rec = 0;
    const recLines = [];
    for (const [k, v] of Object.entries(this.recurring)) {
      rec += v.monthly * 12;
      recLines.push({ key: k, label: v.label, annual: v.monthly * 12 });
    }
    const other = this.base.other * Math.pow(1.025, this.t / 12) * Math.sqrt(this.pop / this.base.pop0) * (this.flags.grantsLost ? 0.9 : 1);
    const income = r.levy + other;
    const interest = this.funds < 0 ? -this.funds * 0.07 : 0;
    const expenses = Object.values(exp).reduce((a, b) => a + b, 0) + rec + interest;
    return { r, exp, rec, recLines, other, income, expenses, interest, net: income - expenses };
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
      D[lot.road] += (lot.units * 2.3 * 0.4 + lot.jobs * 0.45) * lot.occ;
    }
    T.set(D);
    const rl = this.roadList;
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
    if (init || !this.base.capC1) {
      const v1 = [];
      for (const i of rl) if (road[i] === 1) v1.push(T[i]);
      this.base.capC1 = (percentile(v1, 0.8) || 10) / 0.55;
    }
    const capMul = (0.82 + 0.18 * this.roadCond) * (1 + this.capBump);
    let sum = 0, n = 0;
    for (const i of rl) {
      const cap = this.base.capC1 * [0, 1, 2.6, 4.2][road[i]] * capMul * this.capLocal[i];
      const c = T[i] / cap;
      this.congestion[i] = c;
      if (road[i] >= 2 && this.w.inTown[i]) { sum += c; n++; }
    }
    this.congAvg = n ? sum / n : 0;
    if (init || this.base.cong0 == null) this.base.cong0 = this.congAvg || 0.5;
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
    // coverage
    const cover2 = (arr, type, R, fund) => {
      arr.fill(0);
      const Rc = R / CC;
      for (const s of this.services(type)) {
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
    cover2(this.polCov, 'police', SERVICES.police.radius, this.fund.police);
    cover2(this.fireCov, 'fire', SERVICES.fire.radius, this.fund.fire);
    cover2(this.schoolCov, 'school', SERVICES.school.radius, this.fund.schools);
    blur(this.parkC, 2);
    const poll = this.pollC, crime = this.crimeC;
    for (let i = 0; i < Nc; i++) {
      poll[i] = this.indC[i] * 0.004 + this.trafC[i] * 0.03;
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
    // land value modifier relative to the starting city
    const S = new Float32Array(Nc);
    let crimeSum = 0, cn = 0;
    for (let i = 0; i < Nc; i++) {
      const cr = crime[i] / this.base.crimeN, po = poll[i] / this.base.pollN, pk = Math.min(1.5, this.parkC[i] / this.base.parkN), tr = this.trafC[i] / this.base.trafN;
      S[i] = 0.18 * pk - 0.3 * cr - 0.22 * po - 0.06 * tr + 0.08 * this.polCov[i] + 0.06 * this.fireCov[i];
      if (this.popC[i] > 0) { crimeSum += cr; cn++; }
    }
    if (init || !this.S0) this.S0 = S.slice();
    this.crimeAvg = cn ? crimeSum / cn : 0;
    if (init || this.base.crimeAvg0 == null) this.base.crimeAvg0 = this.crimeAvg || 0.3;
    const glob = (1 + 0.12 * (this.fund.schools - 1)) * (0.94 + 0.06 * this.roadCond);
    for (let i = 0; i < Nc; i++) this.lvMod[i] = clamp(1 + 0.9 * (S[i] - this.S0[i]), 0.5, 1.8) * glob * this.lvLocal[i];
    void inTown;
  }
  cellOf(x, y) {
    return clamp(Math.floor(y / CC), 0, this.Hc - 1) * this.Wc + clamp(Math.floor(x / CC), 0, this.Wc - 1);
  }

  // ---------------- monthly tick ----------------
  tick() {
    if (this.gameOver) return;
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
    this.updateApproval();
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
    this.history.push({ t: this.t, pop: this.pop, jobs: this.jobs, funds: this.funds, income, expenses, approval: this.approval, lv: this.avgLV() });
    if (this.history.length > 600) this.history.shift();
  }
  avgLV() {
    let s = 0, n = 0;
    for (const lot of this.w.lots) if (!lot.dead && lot.inTown && lot.zone === ZONE.R) { s += lot.landVal / Math.max(lot.area, 60); n++; }
    return n ? s / n : 0;
  }

  newYear() {
    // annual revaluation and Prop 2½ levy limit
    const r0 = this.rates();
    let added = 0;
    const mkt = this.market;
    this.market *= 1 + 0.025 + 0.05 * clamp(this.demand.R, -1, 1);
    for (const lot of this.w.lots) {
      if (lot.dead) continue;
      const c = this.cellOf(lot.cx, lot.cy);
      const lvm = this.lvMod[c];
      lot.landVal = lot.baseLand * lvm * this.market;
      lot.bldgVal = lot.baseBldg * (0.75 + 0.25 * lot.occ) * (this.market / mkt > 1 ? Math.sqrt(this.market) : 1);
      void added;
    }
    const growth = this.newGrowth;
    this.levyLimit = this.levyLimit * 1.025 + growth;
    this.newGrowth = 0;
    const r1 = this.rates();
    this.news(
      `${this.y}: New Year, New Assessments`,
      `Assessors finished the annual revaluation. Under Prop 2½ the levy limit grew 2.5% plus ${(growth / 1e6).toFixed(1)}M in new growth, to ${(this.levyLimit / 1e6).toFixed(1)}M. Residential rate ${r1.rateR.toFixed(2)} (was ${r0.rateR.toFixed(2)}), commercial ${r1.rateC.toFixed(2)} per $1,000.`,
      'big'
    );
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
      if (!lot || lot.dead || !lot.inTown) continue;
      const key = lot.zone === ZONE.R ? 'R' : lot.zone === ZONE.C ? 'C' : 'I';
      const d = this.demand[key];
      const c = this.cellOf(lot.cx, lot.cy);
      const crime = this.crimeC[c] / this.base.crimeN;
      const poll = this.pollC[c] / this.base.pollN;
      const des = (this.lvMod[c] - 1) * 1.5 - 0.3 * crime - (key === 'R' ? 0.35 * poll : 0) + (lot.road < 0 ? -1 : 0);
      const target = clamp(0.88 + 0.22 * d + 0.12 * des, 0.12, 1);
      const was = lot.occ;
      lot.occ += (target - lot.occ) * 0.12;
      if ((was < 0.3) !== (lot.occ < 0.3)) for (const id of lot.bldgs) this.hooks.invalidateBuilding && this.hooks.invalidateBuilding(w.bldgs[id]);
      const hasB = lot.bldgs.some((id) => w.bldgs[id].alive);
      const cap = lot.dense ? 4 : 2;
      let target2 = 0;
      if (!hasB && lot.road >= 0 && d > 0.05 && des > -0.6 && this.rand() < 0.25 * d * slow) target2 = lot.dense ? (key === 'R' ? 3 : 3) : key === 'R' ? 1 : 2;
      else if (hasB && lot.bldgZone !== lot.zone && d > 0.1 && this.rand() < 0.04 * slow) target2 = lot.dense ? 3 : 2;
      else if (hasB && lot.dens < cap && d > 0.2 && des > -0.1 && lot.area >= 250 && this.t - (lot.built || -999) > 48 && this.rand() < (lot.dense ? 0.05 : 0.025) * d * (1 + des) * slow)
        target2 = Math.min(cap, lot.dens + 1 + (lot.dense && lot.dens <= 2 ? 1 : 0));
      if (target2 > 0) {
        const oldVal = lot.landVal + lot.bldgVal;
        touched.push(...developLot(w, lot, target2, this.t));
        lot.bldgZone = lot.zone;
        lot.built = this.t;
        lot.occ = 0.6;
        computeLotMetrics(w, lot, false);
        lot.bldgVal = lot.bldArea * bldRate(lot.zone) * this.market;
        lot.baseBldg = lot.bldgVal / this.market;
        lot.year = this.y;
        const r = this.rates();
        const gain = lot.landVal + lot.bldgVal - oldVal;
        if (gain > 0) this.newGrowth += (gain * (key === 'R' ? r.rateR : r.rateC)) / 1000;
        devs++;
        this.devCount = (this.devCount || 0) + 1;
        if (target2 >= 3 && this.rand() < 0.5) {
          const what = key === 'R' ? `${lot.units}-unit apartment building` : key === 'C' ? `${Math.round(lot.bldArea / 92.9) * 1000 > 0 ? Math.round(lot.bldArea * 10.76).toLocaleString() + '-square-foot ' : ''}commercial building` : 'lab building';
          this.news(`New ${what} rises`, `Construction wraps up ${streetOf(lot) ? 'on ' + streetOf(lot) : 'in town'}. ${pick(DEV_QUIPS, this.rand())}`);
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
      C: 0.15 + 1.4 * (this.pop / this.cjobs / (b.pop0 / b.cj0) - 1) - 2.2 * cipT - 0.6 * Math.max(0, this.congAvg - b.cong0) + this.demandMod.C,
      I: cycle - 2.2 * cipT - 0.8 * (this.ijobs / b.ij0 - 1) + this.demandMod.I - (this.flags.bsl3Ban ? 0.08 : 0),
    };
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
    const f = {
      homeowners: 60 - 70 * billR + 12 * (this.fund.schools - 1) - 25 * crime + 25 * ex + 8 * (this.market - 1),
      renters: 56 - 25 * Math.max(0, d.R - 0.3) - 20 * ex - 10 * (this.market - 1) + 6 * (this.fund.parks - 1),
      seniors: 58 - 40 * billR + 10 * (this.fund.police + this.fund.fire - 2) - 15 * crime,
      business: 57 - 70 * billC + 15 * d.C - 40 * cong + 6 * (this.roadCond - 1),
      commuters: 56 - 90 * cong + 15 * (this.roadCond - 1),
    };
    if (this.funds < 0) for (const k of FACTIONS) f[k] -= 6;
    this.factions = {};
    let a = 0;
    for (const k of FACTIONS) {
      this.factions[k] = clamp(f[k] + this.approvalOff[k], 0, 100);
      a += this.factions[k] * FW[k];
    }
    this.approval = a;
    void init;
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
    // fires
    const avgFire = this.fireN ? this.fireCov.reduce((a, b) => a + b, 0) / this.fireCov.length : 0;
    if (this.rand() < 0.12 * (1.5 - Math.min(1, avgFire * 2.5))) {
      const lot = w.lots[this.zLots[Math.floor(this.rand() * this.zLots.length)]];
      if (lot && lot.bldgs.length) {
        const c = this.cellOf(lot.cx, lot.cy);
        const save = this.fireCov[c] * this.fund.fire;
        const st = streetOf(lot);
        if (this.rand() > 0.3 + save * 0.65) {
          const touched = [];
          for (const id of lot.bldgs) touched.push(...demolish(w, w.bldgs[id]));
          lot.bldgs = [];
          lot.baseBldg = 0;
          lot.bldgVal = 0;
          computeLotMetrics(w, lot, false);
          this.hooks.invalidateTiles && this.hooks.invalidateTiles(touched);
          this.news(`Multi-alarm fire${st ? ' on ' + st : ''}`, 'Nobody was hurt, but the building is a total loss. Residents ask whether fire coverage is adequate in that part of town.', 'big');
          this.approvalOff.seniors -= 2;
          this.recalc();
        } else {
          this.news(`Quick work by firefighters${st ? ' on ' + st : ''}`, 'Crews knocked down a kitchen fire within minutes. Neighbors brought them coffee.');
        }
      }
    }
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
        this.news(pick(BIZ_HEADLINES, this.rand()).replace('{b}', name), '');
        return;
      }
    }
    this.news(pick(TICKER, this.rand()), '');
  }

  news(title, body = '', size = 'small') {
    const item = { t: this.t, date: this.dateStr(), title, body, size };
    this.newsLog.unshift(item);
    if (this.newsLog.length > 80) this.newsLog.pop();
    this.hooks.news && this.hooks.news(item);
  }

  // ---------------- scenario effects ----------------
  apply(eff = {}) {
    const w = this.w;
    if (eff.funds) this.funds += eff.funds;
    if (eff.approval) for (const [k, v] of Object.entries(eff.approval)) {
      if (k === 'all') FACTIONS.forEach((f) => (this.approvalOff[f] += v));
      else this.approvalOff[k] = (this.approvalOff[k] || 0) + v;
    }
    if (eff.demand) for (const [k, v] of Object.entries(eff.demand)) this.demandMod[k] += v;
    if (eff.recurring) {
      const rc = eff.recurring;
      if (rc.monthly === 0) delete this.recurring[rc.key];
      else this.recurring[rc.key] = { label: rc.label, monthly: rc.monthly, until: rc.months ? this.t + rc.months : null };
    }
    if (eff.bond) {
      const yrs = eff.bond.years || 20;
      const annual = (eff.bond.amount * 0.04) / (1 - Math.pow(1.04, -yrs));
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
      if (lot.dead || !lot.inTown || !lot.tiles.length || !pred(lot)) continue;
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
    lot.bldgVal = lot.bldArea * bldRate(lot.zone) * this.market;
    lot.baseBldg = lot.bldgVal / this.market;
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
    if (b < 0) b = a;
    let tiles = [], cost = 0, ok = true, msg = '';
    if (tool === 'road') {
      tiles = this.lineTiles(a, b);
      for (const i of tiles) {
        if (!inTown[i]) { ok = false; msg = 'Outside city limits'; }
        else if (this.bAlive(i)) { ok = false; msg = 'A building is in the way — bulldoze first'; }
        else if (svcAt[i] >= 0) { ok = false; msg = 'A city facility is in the way'; }
        else if (!road[i]) cost += terrain[i] === 1 ? 450000 : 35000;
      }
      if (ok) msg = `Road: ${tiles.filter((i) => !road[i]).length} tiles`;
    } else if (tool === 'bulldoze') {
      tiles = this.rectTiles(a, b).filter((i) => inTown[i]);
      const lotsHit = new Set();
      for (const i of tiles) {
        if (svcAt[i] >= 0) cost += 60000;
        else if (this.bAlive(i)) {
          const li = lotOf[i];
          if (li >= 0) lotsHit.add(li);
          else cost += 20000;
        } else if (road[i]) cost += 4000;
        else if (w.tree[i]) cost += 200;
      }
      for (const li of lotsHit) cost += 15000 + w.lots[li].bldArea * 25;
      msg = lotsHit.size ? `Demolish ${lotsHit.size} building lot${lotsHit.size > 1 ? 's' : ''}` : 'Bulldoze';
    } else if (tool === 'zoneR' || tool === 'zoneC' || tool === 'zoneI' || tool === 'dezone') {
      tiles = this.rectTiles(a, b).filter((i) => inTown[i] && terrain[i] !== 1 && !road[i] && svcAt[i] < 0);
      const lotsHit = new Set();
      let fresh = 0;
      for (const i of tiles) {
        if (lotOf[i] >= 0) lotsHit.add(lotOf[i]);
        else if (!this.bAlive(i)) fresh++;
      }
      cost = lotsHit.size * 1500 + fresh * 300;
      msg = `${lotsHit.size} lots rezoned, ${fresh} new tiles`;
    } else if (tool === 'park') {
      tiles = this.rectTiles(a, b).filter((i) => inTown[i]);
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
    return { tool, tiles, cost, ok, msg };
  }

  execute(p, opts = {}) {
    if (!p || !p.ok) return false;
    const w = this.w;
    const { W, road, lotOf, svcAt, bldgs } = w;
    const touched = [];
    if (p.tool === 'road') {
      for (const i of p.tiles) {
        if (road[i]) continue;
        road[i] = 1;
        const li = lotOf[i];
        if (li >= 0) this.removeTileFromLot(li, i);
        w.tree[i] = 0;
        touched.push(i);
      }
      this.rebuildRoadList();
      this.refreshRoadAccess(p.tiles);
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
          touched.push(i);
        } else if (w.tree[i]) {
          w.tree[i] = 0;
          touched.push(i);
        }
      }
      this.rebuildRoadList();
      this.refreshRoadAccess(p.tiles);
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
      this.news(`City opens ${SERVICES[p.tool].label.toLowerCase()}`, 'A ribbon was cut. A councilor gave a speech that ran long.');
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
    const ramp = (v) => {
      v = clamp(v, 0, 1);
      return [Math.round(40 + 215 * v), Math.round(200 - 150 * Math.abs(v - 0.3)), Math.round(220 * (1 - v)), 200];
    };
    switch (mode) {
      case 'zones': {
        if (w.road[i]) return [80, 80, 80, 160];
        const li = w.lotOf[i];
        if (li < 0) return null;
        const z = w.lots[li].zone;
        const col = [null, [60, 220, 60], [70, 140, 255], [250, 200, 40], [200, 120, 255], [40, 150, 70]][z];
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
      case 'growth': {
        const li = w.lotOf[i];
        if (li < 0) return null;
        const lot = w.lots[li];
        if (lot.built > 0 && lot.year >= CFG.START.y) return [255, 120, 220, 220];
        if (lot.occ < 0.3) return [120, 60, 40, 220];
        return null;
      }
    }
    return null;
  }

  // ---------------- save ----------------
  serialize() {
    const skip = new Set(['w', 'hooks', 'traffic', 'congestion', 'popC', 'jobsC', 'indC', 'trafC', 'crimeC', 'pollC', 'polCov', 'fireCov', 'schoolCov', 'parkC', 'lvMod', 'rand', 'roadList', 'zLots', 'lvLocal', 'capLocal', 'S0']);
    const sim = {};
    for (const [k, v] of Object.entries(this)) if (!skip.has(k)) sim[k] = v;
    return { sim: JSON.parse(JSON.stringify(sim)), lvLocal: Array.from(this.lvLocal), capLocal: this.capLocal, S0: Array.from(this.S0) };
  }
}

export function streetOf(lot) {
  if (lot.addr) {
    const s = lot.addr.replace(/^[0-9\-A-Za-z]*[0-9][0-9\-A-Za-z]*\s+/, '').trim();
    if (s) return s;
  }
  return '';
}
function pick(arr, r) {
  return arr[Math.floor(r * arr.length) % arr.length];
}

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
