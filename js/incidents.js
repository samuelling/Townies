// Clickable problems and the crews that fix them (the tycoon-style minute-to-minute loop).
// Time runs in "days" (30 per month). Incidents appear on the map; tap one to send the nearest free
// crew, or let auto-dispatch handle a department (slower: paperwork first). Unhandled problems cost
// approval every day past their grace period; fires burn buildings down.
import { ZONE, SERVICES } from './config.js';
import { clamp } from './util.js';
import { demolish, computeLotMetrics } from './world.js';
import { react } from './comments.js';

export const INC = {
  pothole: { dept: 'pw', icon: '🚧', label: 'Pothole', work: 3, grace: 45, cost: 2500, pen: { commuters: 0.5, homeowners: 0.2 } },
  watermain: { dept: 'pw', icon: '💧', label: 'Water main break', work: 6, grace: 3, cost: 60000, pen: { homeowners: 2, business: 1.5 }, block: 0.25, r: 3, selfFix: 25, selfMsg: 'An emergency contractor fixed it, at double the price.' },
  snow: { dept: 'pw', icon: '❄️', label: 'Unplowed street', work: 2, grace: 5, cost: 9000, pen: { commuters: 1.2, seniors: 0.6 }, block: 0.35, r: 5, selfFix: 25 },
  tree: { dept: 'pw', icon: '🌳', label: 'Tree down', work: 2.5, grace: 6, cost: 4000, pen: { commuters: 0.6, homeowners: 0.3 }, block: 0.4, r: 2, selfFix: 30 },
  fire: { dept: 'fire', icon: '🔥', label: 'Building fire', work: 1.5, grace: 3, cost: 15000, pen: {} },
  rats: { dept: 'health', icon: '🐀', label: 'Rat complaints', work: 6, grace: 50, cost: 3000, pen: { homeowners: 0.6, renters: 0.3 } },
};
export const DEPTS = {
  pw: { label: 'Public Works', unit: 'crew', truck: '#f1c232' },
  fire: { label: 'Fire', unit: 'engine', truck: '#c8352b' },
  health: { label: 'Health', unit: 'inspector', truck: '#ffffff' },
};

export function initIncidents(sim) {
  sim.inc = { list: [], id: 1, auto: { pw: false, fire: true, health: false }, crews: [], day: sim.t * 30, hinted: 0, fixed: 0 };
  syncCrews(sim);
}

// crew counts follow funding and stations
export function syncCrews(sim) {
  const I = sim.inc;
  const want = {
    pw: Math.max(1, Math.round(5 * sim.fund.roads)),
    fire: Math.max(1, sim.w.services.filter((s) => s.alive && SERVICES[s.type] && (SERVICES[s.type].fund || s.type) === 'fire').length),
    health: Math.max(1, Math.round(2 * Math.min(1.2, (sim.fund.parks + 1) / 2))),
  };
  const depot = (dept, k) => {
    if (dept === 'fire') {
      const st = sim.w.services.filter((s) => s.alive && SERVICES[s.type] && (SERVICES[s.type].fund || s.type) === 'fire');
      if (st.length) return [st[k % st.length].x, st[k % st.length].y];
    }
    return [sim.w.start[0] + (k % 3) - 1, sim.w.start[1] + 2];
  };
  for (const dept of Object.keys(want)) {
    const have = I.crews.filter((c) => c.dept === dept);
    for (let k = have.length; k < want[dept]; k++) {
      const [x, y] = depot(dept, k);
      I.crews.push({ id: `${dept}${k}`, dept, x, y, hx: x, hy: y, state: 'idle', inc: null, t0: 0, t1: 0, fx: x, fy: y });
    }
    // remove extra idle crews when budgets are cut
    let extra = have.length - want[dept];
    for (let k = I.crews.length - 1; k >= 0 && extra > 0; k--) {
      const c = I.crews[k];
      if (c.dept === dept && c.state === 'idle') {
        I.crews.splice(k, 1);
        extra--;
      }
    }
  }
}

function roadTile(sim, minCls = 1, nearTree = false) {
  const { road, inTown, tree, W } = sim.w;
  for (let k = 0; k < 40; k++) {
    const i = sim.roadList[Math.floor(sim.rand() * sim.roadList.length)];
    if (!inTown[i] || road[i] < minCls) continue;
    if (minCls === 1 && road[i] === 1 && sim.rand() < 0.5) continue; // busier streets wear faster
    if (nearTree && !(tree[i - 1] || tree[i + 1] || tree[i - W] || tree[i + W])) continue;
    if (sim.inc.list.some((x) => Math.abs((x.tile % W) - (i % W)) + Math.abs(((x.tile / W) | 0) - ((i / W) | 0)) < 4)) continue;
    return i;
  }
  return -1;
}

export function spawn(sim, type, tile, extra = {}) {
  if (tile < 0) return null;
  const W = sim.w.W;
  const it = { id: sim.inc.id++, type, tile, x: (tile % W) + 0.5, y: ((tile / W) | 0) + 0.5, born: sim.inc.day, crew: null, ...extra };
  sim.inc.list.push(it);
  if (INC[type].block) refreshBlocks(sim);
  if (!sim.inc.hinted && type !== 'fire' && sim.hooks.hint) {
    sim.inc.hinted = 1;
    sim.hooks.hint(`${INC[type].icon} ${INC[type].label}! Tap it on the map to send a crew, or turn on auto-dispatch under Windows → Crews.`);
  }
  sim.hooks.incidents && sim.hooks.incidents();
  return it;
}

// a winter storm buries the main streets
export function storm(sim, n = 14) {
  let made = 0;
  for (let k = 0; k < n * 3 && made < n; k++) if (spawn(sim, 'snow', roadTile(sim, 2))) made++;
  return made;
}

export function refreshBlocks(sim) {
  const { W, H } = sim.w;
  if (!sim.incBlock || sim.incBlock.length !== W * H) sim.incBlock = new Float32Array(W * H);
  sim.incBlock.fill(1);
  for (const it of sim.inc.list) {
    const d = INC[it.type];
    if (!d.block) continue;
    const cx = it.tile % W, cy = (it.tile / W) | 0;
    for (let y = Math.max(0, cy - d.r); y <= Math.min(H - 1, cy + d.r); y++)
      for (let x = Math.max(0, cx - d.r); x <= Math.min(W - 1, cx + d.r); x++) {
        const i = y * W + x;
        sim.incBlock[i] = Math.min(sim.incBlock[i], d.block + (1 - d.block) * (Math.hypot(x - cx, y - cy) / (d.r + 1)));
      }
  }
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export function dispatch(sim, incId, manual = true) {
  const it = sim.inc.list.find((x) => x.id === incId);
  if (!it || it.crew) return manual ? 'A crew is already on the way.' : null;
  const dept = INC[it.type].dept;
  let best = null, bd = Infinity;
  for (const c of sim.inc.crews) {
    if (c.dept !== dept || c.state !== 'idle') continue;
    const d = Math.hypot(c.x - it.x, c.y - it.y);
    if (d < bd) { bd = d; best = c; }
  }
  if (!best) return `All ${DEPTS[dept].label} ${DEPTS[dept].unit}s are busy.`;
  const speed = dept === 'fire' ? 130 : dept === 'health' ? 80 : 55; // tiles per day (the town is ~400 tiles across)
  best.state = 'travel';
  best.inc = it.id;
  best.fx = best.x;
  best.fy = best.y;
  best.t0 = sim.inc.day;
  best.t1 = sim.inc.day + 0.15 + bd / speed;
  it.crew = best.id;
  it.manual = manual;
  return null;
}

function finish(sim, it, how = 'crew') {
  const d = INC[it.type];
  sim.inc.list = sim.inc.list.filter((x) => x !== it);
  // auto-dispatched jobs run on overtime; emergency contractors cost double
  sim.funds -= d.cost * (how === 'self' && it.type === 'watermain' ? 2 : how === 'self' ? 0 : it.manual ? 1 : 1.4);
  if (how === 'crew') sim.inc.fixed++;
  const late = sim.inc.day - it.born - d.grace;
  // a quick, hands-on fix earns a little goodwill
  if (how === 'crew' && it.manual && late <= 0) {
    for (const f of Object.keys(d.pen)) sim.approvalOff[f] += 0.25;
    sim.inc.quick = (sim.inc.quick || 0) + 1;
  }
  if (it.type === 'fire') {
    sim.news(`Firefighters save building${it.street ? ' on ' + it.street : ''}`, 'Crews knocked the fire down quickly. Neighbors brought coffee.');
  } else if (late > 30 && sim.rand() < 0.5) {
    react(sim, 'fixed-late', { what: d.label.toLowerCase(), street: it.street || 'my street', days: Math.round(sim.inc.day - it.born) }, null, 1);
  }
  if (d.block) refreshBlocks(sim);
  sim.hooks.incidents && sim.hooks.incidents();
}

function burnDown(sim, it) {
  const w = sim.w;
  sim.inc.list = sim.inc.list.filter((x) => x !== it);
  const lot = it.lot != null ? w.lots[it.lot] : null;
  if (lot && lot.bldgs.length) {
    const touched = [];
    for (const id of lot.bldgs) touched.push(...demolish(w, w.bldgs[id]));
    lot.bldgs = [];
    lot.baseBldg = 0;
    lot.bldgVal = 0;
    if (lot.sf) { lot.vacant = (lot.vacant || 0) + lot.sf.length; lot.sf = []; }
    computeLotMetrics(w, lot, false);
    sim.hooks.invalidateTiles && sim.hooks.invalidateTiles(touched);
    const item = sim.news(`Multi-alarm fire destroys building${it.street ? ' on ' + it.street : ''}`, 'Nobody was hurt, but the building is a total loss. Residents ask how long the engines took to arrive.', 'big');
    react(sim, 'fire-lost', { street: it.street || 'that street' }, item);
    sim.approvalOff.seniors -= 2;
    sim.approvalOff.homeowners -= 1;
    sim.recalc();
  }
  for (const c of sim.inc.crews) if (c.inc === it.id) { c.state = 'return'; c.inc = null; c.t0 = sim.inc.day; c.fx = c.x; c.fy = c.y; c.t1 = sim.inc.day + 0.1 + Math.hypot(c.x - c.hx, c.y - c.hy) / 120; }
  sim.hooks.incidents && sim.hooks.incidents();
}

function streetName(sim, tile) {
  const w = sim.w;
  const n = w.names[w.roadName[tile]];
  if (n) return n;
  const li = w.lotOf[tile];
  return li >= 0 && w.lots[li].addr ? w.lots[li].addr.replace(/^[0-9\-A-Za-z]*[0-9][0-9\-A-Za-z]*\s+/, '') : '';
}

function maybeSpawn(sim) {
  const I = sim.inc;
  const m = sim.m;
  const winter = m <= 2 || m === 11;
  const r = sim.rand;
  const open = (t) => I.list.filter((x) => x.type === t).length;
  // potholes bloom with the freeze-thaw of late winter and early spring
  const pRate = 0.1 * (1.35 - sim.roadCond) * (m >= 1 && m <= 3 ? 2.4 : 1);
  if (open('pothole') < 30 && r() < pRate) {
    const t = roadTile(sim, 1);
    if (t >= 0) spawn(sim, 'pothole', t, { street: streetName(sim, t) });
  }
  if (r() < 0.011 * (winter ? 1.8 : 1)) {
    const t = roadTile(sim, 1);
    if (t >= 0) {
      const it = spawn(sim, 'watermain', t, { street: streetName(sim, t) });
      if (it && r() < 0.5) sim.news(`Water main break on ${it.street || 'a side street'}`, 'Water service is off for a few blocks. Public Works says crews are "aware."');
    }
  }
  if (winter && !open('snow') && r() < 0.012) {
    const n = storm(sim, 8 + Math.floor(r() * 8));
    if (n) sim.news('Snowstorm buries the main streets', `${n} major streets need plowing. Overnight parking ban in effect.`);
  }
  if (m >= 5 && m <= 8 && r() < 0.01) {
    let n = 0;
    for (let k = 0; k < 6; k++) {
      const t = roadTile(sim, 1, true);
      if (t >= 0 && spawn(sim, 'tree', t, { street: streetName(sim, t) })) n++;
    }
    if (n) sim.news('Thunderstorm brings down trees', `${n} streets blocked by fallen limbs.`);
  }
  // fires: rarer where fire coverage is good
  const avgFire = sim.fireCov.length ? sim.fireCov.reduce((a, b) => a + b, 0) / sim.fireCov.length : 0;
  if (r() < 0.004 * (1.5 - Math.min(1, avgFire * 2.5)) && sim.zLots.length) {
    const lot = sim.w.lots[sim.zLots[Math.floor(r() * sim.zLots.length)]];
    if (lot && lot.bldgs.length && !lot.dead && !I.list.some((x) => x.lot === lot.id)) {
      const tile = lot.tiles[Math.floor(lot.tiles.length / 2)];
      spawn(sim, 'fire', tile, { lot: lot.id, street: streetName(sim, lot.road >= 0 ? lot.road : tile) });
    }
  }
  // rats follow construction and restaurants
  const under = sim.w.lots.filter((l) => l.under && !l.dead);
  if (open('rats') < 8 && r() < 0.006 + 0.004 * under.length) {
    const src = under.length && r() < 0.6 ? under[Math.floor(r() * under.length)] : sim.w.lots[sim.zLots[Math.floor(r() * sim.zLots.length)]];
    if (src && !src.dead && src.zone !== ZONE.PARK) spawn(sim, 'rats', src.tiles[0], { street: streetName(sim, src.road >= 0 ? src.road : src.tiles[0]) });
  }
}

// advance the incident world by `days` (in ≤1-day steps)
export function stepIncidents(sim, days) {
  const I = sim.inc;
  if (!I) return;
  let left = days;
  while (left > 1e-6) {
    const d = Math.min(1, left);
    left -= d;
    const before = Math.floor(I.day);
    I.day += d;
    const newDay = Math.floor(I.day) > before;
    if (newDay) maybeSpawn(sim);
    // crews
    for (const c of I.crews) {
      if (c.state === 'idle') continue;
      const it = c.inc != null ? I.list.find((x) => x.id === c.inc) : null;
      const u = clamp((I.day - c.t0) / Math.max(1e-3, c.t1 - c.t0), 0, 1);
      if (c.state === 'travel') {
        if (!it) { c.state = 'return'; c.t0 = I.day; c.fx = c.x; c.fy = c.y; c.t1 = I.day + 0.1 + Math.hypot(c.x - c.hx, c.y - c.hy) / 120; continue; }
        c.x = c.fx + (it.x - c.fx) * u;
        c.y = c.fy + (it.y - c.fy) * u;
        if (u >= 1) { c.state = 'work'; c.t0 = I.day; c.t1 = I.day + INC[it.type].work; it.working = 1; }
      } else if (c.state === 'work') {
        if (!it) { c.state = 'return'; c.t0 = I.day; c.fx = c.x; c.fy = c.y; c.t1 = I.day + 0.1 + Math.hypot(c.x - c.hx, c.y - c.hy) / 120; continue; }
        if (u >= 1) {
          finish(sim, it);
          c.state = 'return';
          c.inc = null;
          c.t0 = I.day;
          c.fx = c.x;
          c.fy = c.y;
          c.t1 = I.day + 0.1 + Math.hypot(c.x - c.hx, c.y - c.hy) / 120;
          // keep working nearby when auto-dispatch is on
        }
      } else if (c.state === 'return') {
        c.x = c.fx + (c.hx - c.fx) * u;
        c.y = c.fy + (c.hy - c.fy) * u;
        if (u >= 1) { c.state = 'idle'; c.x = c.hx; c.y = c.hy; }
      }
    }
    // auto-dispatch: oldest first, after a few days of paperwork (fires go immediately)
    for (const it of I.list) {
      if (it.crew) continue;
      const dept = INC[it.type].dept;
      if (!I.auto[dept]) continue;
      if (dept !== 'fire' && I.day - it.born < 4) continue;
      dispatch(sim, it.id, false);
    }
    // consequences
    for (const it of [...I.list]) {
      const def = INC[it.type];
      const over = I.day - it.born - def.grace;
      if (over <= 0) continue;
      if (it.type === 'fire' && !it.working) {
        burnDown(sim, it);
        continue;
      }
      if (it.working) continue;
      if (def.selfFix && over > def.selfFix) {
        finish(sim, it, 'self');
        continue;
      }
      if (it.type === 'rats' && newDay && over > 30 && sim.rand() < 0.02 && I.list.filter((x) => x.type === 'rats').length < 10) {
        const W = sim.w.W;
        const t = it.tile + (Math.floor(sim.rand() * 9) - 4) + W * (Math.floor(sim.rand() * 9) - 4);
        if (t >= 0 && t < sim.N && sim.w.lotOf[t] >= 0) spawn(sim, 'rats', t, { street: it.street });
      }
      if (newDay && Math.floor(over) === 20 && def.dept === 'pw' && sim.rand() < 0.5) react(sim, 'unfixed', { what: def.label.toLowerCase(), street: it.street || 'my street' }, null, 1);
    }
  }
}

// Current approval drag from late, unattended problems (recomputed every month, capped per group).
export function incidentPenalty(sim) {
  const out = {};
  const I = sim.inc;
  if (!I) return out;
  for (const it of I.list) {
    const def = INC[it.type];
    if (it.working || I.day - it.born <= def.grace) continue;
    for (const [f, v] of Object.entries(def.pen)) out[f] = (out[f] || 0) + v;
  }
  for (const f of Object.keys(out)) out[f] = Math.min(14, out[f]);
  return out;
}

export function incidentStats(sim) {
  const I = sim.inc;
  if (!I) return { open: 0, late: 0 };
  let late = 0;
  for (const it of I.list) if (I.day - it.born > INC[it.type].grace && !it.working) late++;
  return { open: I.list.length, late };
}
