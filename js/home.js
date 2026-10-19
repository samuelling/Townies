// EXPERIMENTAL: "Step inside" — a cutaway of one home and the household living in it, on the game's clock.
// A mockup to see whether a citizen's-eye view adds anything. Everything the household feels comes from the
// city model (traffic on the way to work, the buses, what's within walking distance, the weather, the tax rate,
// the bedtimes the night lights already use); nothing here feeds back into the city except a diary.
// The house itself follows the town assessor's card (js/floorplan.js): stories, attic and basement, units,
// rooms, bedrooms, baths, heating, floors and fireplaces. Only the placement of the walls is a guess.
// To remove: delete this file and the "Step inside" button in ui.js.
import { CFG, ZONE } from './config.js';
import { clamp, hash2, el, fmtMoney } from './util.js';
import { ROUTES, routeTiles, transitNet, headwayMin } from './transit.js';
import { weatherDay } from './weather.js';
import { BEDTIMES, groupOf, clock, twilight, skyTint, SPEEDS } from './daynight.js';
import { homeLot, irvingSeason } from './eggs.js';
import { floorPlan, SLAB, ROOM_LABEL } from './floorplan.js';

const M = CFG.TILE_M; // metres per tile
const NAMES = ['Dana', 'Luis', 'Priya', 'Theo', 'Mara', 'Jun', 'Rosa', 'Ike', 'Noor', 'Ben', 'Ada', 'Kofi', 'Lena', 'Omar', 'June', 'Pavel'];
const KID = ['Milo', 'Ana', 'Rui', 'Zoe', 'Kai', 'Lila', 'Sol', 'Bea'];
const FOOD = /restaurant|eatery|fast_food|cafe|coffee|bakery|bar$|pub|pizza|diner|ice_cream|deli|sandwich|food/;
const SHOP = /store|shop|market|grocery|pharmacy|book|florist|boutique|bakery/;
const uniq = (list) => list.filter((x, i) => list.findIndex((y) => y.n === x.n) === i);
// floors: what the assessor says the main finish is (hardwood in most of Watertown), tile in kitchens and baths,
// concrete in an unfinished basement, boards in the attic
const FLOOR_COL = { wood: '#b98b5e', carpet: '#a9a3b4', plank: '#b39470', tile: '#d6d2c8', vinyl: '#cfc6b0', concrete: '#a8a59d' };
function floorCol(t, finish, kind) {
  if (kind === 'basement') return t === 'rec' ? FLOOR_COL.carpet : FLOOR_COL.concrete;
  if (t === 'kitchen' || t === 'bath' || t === 'half' || t === 'laundry') return t === 'kitchen' ? FLOOR_COL.vinyl : FLOOR_COL.tile;
  if (kind === 'attic' || kind === 'loft') return '#b0956f';
  if (finish === 'carpet' && (t === 'bed' || t === 'primary' || t === 'den')) return FLOOR_COL.carpet;
  return FLOOR_COL[finish] || FLOOR_COL.wood;
}

export const canStepInside = (lot) => !!lot && !lot.dead && (lot.zone === ZONE.R || lot.mixed) && lot.units > 0 && lot.units <= 6 && lot.bldgs && lot.bldgs.length > 0;

// ---------- the building, floor by floor ----------
function shell(world, lot) {
  const bs = lot.bldgs.map((id) => world.bldgs[id]).filter((b) => b && b.alive);
  const b = bs.sort((p, q) => (q.area || 0) - (p.area || 0))[0];
  if (!b) return null;
  let q = b.obb;
  if (!q) {
    // no oriented box: use the footprint's bounding rectangle
    const xs = b.pts.map((p) => p[0]), ys = b.pts.map((p) => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    q = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  }
  const W = clamp(Math.hypot(q[1][0] - q[0][0], q[1][1] - q[0][1]) * M, 5, 30);
  const D = clamp(Math.hypot(q[3][0] - q[0][0], q[3][1] - q[0][1]) * M, 6, 30);
  // the assessor's card: the building's own, or each condominium unit's
  const card = b.asr || null;
  // condominium units, ground floor first (each unit's card says which of its floor areas is the base)
  const unitCards = lot.asrUnits && lot.asrUnits.length > 1 ? lot.asrUnits.slice().sort((p, q) => ((q.sa && q.sa.BAS) || 0) - ((p.sa && p.sa.BAS) || 0)) : null;
  const units = clamp(unitCards ? unitCards.length : lot.units || 1, 1, 6);
  // a condominium's cards describe units, not the building: its height comes from the map, or the unit count
  let levels = b.levels || 2;
  if (unitCards && b.lvSrc !== 'osm' && b.lvSrc !== 'assessor') levels = units <= 3 ? Math.max(2, units) + 0.5 : 3;
  const fp = floorPlan({ W, D, levels, units, card: unitCards ? { ...card, sa: null, rm: 0 } : card, unitCards, seed: lot.id });
  return { b, W, D, units, card, unitCards, fp };
}

// ---------- what the city looks like from this front door ----------
function surroundings(game, lot) {
  const s = game.sim, w = game.world;
  const near = [];
  let shops = 0, food = 0, auto = 0;
  for (const l of w.lots) {
    if (l.dead || !l.inTown || l === lot) continue;
    const d = Math.hypot(l.cx - lot.cx, l.cy - lot.cy) * M;
    if (d > 900) continue;
    if (l.auto) auto++;
    (l.biz || []).forEach((n, k) => {
      const kind = (l.bizKind && l.bizKind[k]) || '';
      if (FOOD.test(kind)) { food++; if (n) near.push({ n, kind, d, lot: l }); }
      else if (SHOP.test(kind)) shops++;
    });
  }
  near.sort((a, b) => a.d - b.d);
  near.splice(12);
  // the bus: nearest route within ~10 minutes' walk
  let bus = null;
  const net = transitNet();
  if (s.transit && net) {
    // the nearest real stop within ~10 minutes' walk, and its most frequent route
    for (const st of net.stops) {
      const d = Math.hypot(st.x - lot.cx, st.y - lot.cy) * M;
      if (d >= 800 || (bus && d >= bus.walkM)) continue;
      const rs = st.routes.map((ri) => ROUTES.find((r) => r.net && r.net.k === ri)).filter(Boolean);
      if (!rs.length) continue;
      rs.sort((p, q) => (headwayMin(p, 8) || 99) - (headwayMin(q, 8) || 99));
      bus = { r: rs[0], walkM: d, stop: st.name };
    }
  } else if (s.transit)
    for (const r of ROUTES) {
      let best = Infinity;
      for (const i of routeTiles(s, r)) best = Math.min(best, Math.hypot((i % w.W) + 0.5 - lot.cx, ((i / w.W) | 0) + 0.5 - lot.cy) * M);
      if (best < 800 && (!bus || best < bus.walkM)) bus = { r, walkM: best };
    }
  // traffic on the way out of town: rush-hour congestion on the bigger roads around here
  let cs = 0, cn = 0;
  const R = 14;
  for (let y = Math.max(0, Math.floor(lot.cy) - R); y <= Math.min(w.H - 1, Math.floor(lot.cy) + R); y++)
    for (let x = Math.max(0, Math.floor(lot.cx) - R); x <= Math.min(w.W - 1, Math.floor(lot.cx) + R); x++) {
      const i = y * w.W + x;
      if (w.road[i] >= 2 && s.congestion) { cs += s.congestion[i]; cn++; }
    }
  const cong = cn ? cs / cn : 0.6;
  const snowy = (() => { const d = weatherDay(s, Math.floor(game.frac * 30)); return d && (d.snow >= 3 || d.pack >= 6); })();
  const drive = Math.round(22 + 26 * clamp(cong - 0.45, 0, 1.4) + (snowy ? 12 : 0));
  let busMin = null, lanes = false;
  if (bus) {
    const freq = (s.transit.freq && s.transit.freq[bus.r.id]) || 1;
    lanes = !!(s.transit.lanes && s.transit.lanes[bus.r.id]);
    const wait = (bus.r.net ? headwayMin(bus.r, 8) || 30 : 10) / freq;
    const ride = 30 * (lanes ? 0.82 : 1) * (1 + 0.5 * clamp(cong - 0.6, 0, 1)) + (snowy ? 6 : 0);
    busMin = Math.round(bus.walkM / 80 + wait / 2 + ride);
  }
  const bike = snowy ? null : 31;
  const school = w.services.filter((v) => v.alive && v.type === 'school').map((v) => Math.hypot(v.x - lot.cx, v.y - lot.cy) * M).sort((a, b) => a - b)[0];
  return { near, food, shops, auto, bus, busMin, lanes, drive, bike, cong, snowy, schoolM: school || 1200 };
}

// ---------- the household ----------
function household(lot, unit, sh) {
  const seed = lot.id * 7 + unit;
  // sized to the bedrooms the assessor counts: a couple in the big one, children in the others
  const beds = sh.fp.progs[unit] ? sh.fp.progs[unit].beds : 2;
  const adults = beds >= 2 ? (hash2(seed, 1, 1) < 0.8 ? 2 : 1) : hash2(seed, 1, 1) < 0.45 ? 2 : 1;
  const kids = beds >= 2 ? clamp(beds - 1 - (hash2(seed, 2, 1) < 0.35 ? 1 : 0), 0, 3) : 0;
  const tier = groupOf(hash2(lot.bldgs[0] || lot.id, 91, 3)); // the same bedtime group the city's night lights use
  const people = [];
  for (let k = 0; k < adults; k++) people.push({ name: NAMES[(Math.floor(hash2(seed, 3, 1) * NAMES.length) + k * 5) % NAMES.length], kid: false, col: ['#3d6db5', '#b5473d', '#4a8a4a', '#8a5ab5'][Math.floor(hash2(seed, 5 + k, 1) * 4)], wfh: hash2(seed, 9 + k, 1) < 0.28 });
  for (let k = 0; k < kids; k++) people.push({ name: KID[(Math.floor(hash2(seed, 13, 1) * KID.length) + k * 3) % KID.length], kid: true, col: ['#e3a83a', '#d0568f', '#3aa3a0'][k % 3] });
  return { people, tier, unit };
}

// where each person should be at this hour: a room type, 'out' (with a reason) or 'sleep'
function whereIs(p, hour, ctx) {
  const { weekend, commute, dinnerOut, bed, schoolClosed } = ctx;
  const wake = p.kid ? 7 : 6.4 + 0.5 * hash2(p.name.length, 2, 3);
  const sleepAt = p.kid ? 20.5 : bed;
  const hn = (hour - 12 + 24) % 24; // hours since noon, so the night doesn't wrap
  if (hn >= ((sleepAt - 12 + 24) % 24) && hn < wake + 12) return { t: 'bed', sleep: true };
  if (hour < wake + 0.3) return { t: 'bath' };
  if (!weekend) {
    if (p.kid && !schoolClosed) {
      if (hour < 7.9) return { t: 'kitchen' };
      if (hour < 15.1) return { out: 'school' };
    } else if (!p.kid && !p.wfh) {
      const leave = 8.8 - commute / 60, back = 17.3 + commute / 60;
      if (hour < leave) return { t: 'kitchen' };
      if (hour < back) return { out: 'work' };
    } else if (!p.kid && p.wfh && hour >= 9 && hour < 17.3) return { t: 'living', work: true };
  } else if (hour >= 10.5 && hour < 12.5 && !p.kid) return { out: 'square' };
  if (dinnerOut && hour >= 18.4 && hour < 20) return { out: 'dinner' };
  if (!dinnerOut && hour >= 17.6 && hour < 18.6 && !p.kid) return { t: 'kitchen' };
  if (hour >= 18.6 && hour < 19.4) return { t: dinnerOut ? 'living' : 'kitchen', eat: true };
  return { t: hour > 20.5 && p.kid ? 'bed' : 'living' };
}

// ---------- drawing ----------
function box(g, P, u, v, w, d, z, h, col, shade = 1) {
  const c = col.match(/\w\w/g).map((x) => parseInt(x, 16));
  const sh = (k) => `rgb(${c.map((x) => Math.round(x * k * shade)).join(',')})`;
  const A = P(u, v, z + h), B = P(u + w, v, z + h), C = P(u + w, v + d, z + h), Dd = P(u, v + d, z + h);
  const a0 = P(u, v, z), b0 = P(u + w, v, z), d0 = P(u, v + d, z);
  g.fillStyle = sh(0.78); poly(g, [a0, b0, B, A]); // front face (toward the street)
  g.fillStyle = sh(0.62); poly(g, [a0, d0, Dd, A]); // left face
  g.fillStyle = sh(1); poly(g, [A, B, C, Dd]);
}
function poly(g, pts) {
  g.beginPath();
  pts.forEach((p, k) => (k ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])));
  g.closePath();
  g.fill();
}
const FURN = {
  living: (b, r) => { const [u0, v0, u1, v1] = r; b(u0 + 0.4, v1 - 1.2, Math.min(2.4, u1 - u0 - 0.8), 0.9, 0, 0.8, '#6b4f7a'); b(u0 + (u1 - u0) / 2 - 0.6, v0 + 0.5, 1.2, 0.35, 0, 0.9, '#2a2a30'); b(u0 + (u1 - u0) / 2 - 0.5, v0 + 1.4, 1, 0.6, 0, 0.4, '#8a6a4a'); },
  bed: (b, r) => { const [u0, v0, u1, v1] = r; const w = Math.min(1.4, u1 - u0 - 0.8); b(u0 + 0.3, v1 - 2.2, w, 1.95, 0, 0.5, '#e8e2d6'); b(u0 + 0.3, v1 - 0.55, w, 0.3, 0.5, 0.15, '#ffffff'); b(u1 - 1.0, v0 + 0.3, 0.8, 0.5, 0, 1.0, '#7a5a3a'); },
  primary: (b, r) => { const [u0, v0, u1, v1] = r; const w = Math.min(1.9, u1 - u0 - 0.8); b(u0 + 0.3, v1 - 2.3, w, 2.0, 0, 0.5, '#e8e2d6'); b(u0 + 0.3, v1 - 0.6, w, 0.3, 0.5, 0.15, '#ffffff'); b(u1 - 1.0, v0 + 0.3, 0.8, 0.5, 0, 1.0, '#7a5a3a'); },
  kitchen: (b, r) => { const [u0, v0, u1, v1] = r; b(u0 + 0.1, v1 - 0.7, u1 - u0 - 0.2, 0.6, 0, 0.9, '#efeae0'); b(u1 - 0.7, v0 + 0.4, 0.6, Math.max(0.6, v1 - v0 - 1.2), 0, 0.9, '#efeae0'); b(u0 + 0.8, v0 + 0.8, 1.2, 0.9, 0, 0.75, '#9a7650'); },
  bath: (b, r) => { const [u0, , u1, v1] = r; b(u0 + 0.15, v1 - 0.85, Math.min(1.6, u1 - u0 - 0.3), 0.72, 0, 0.55, '#f6f6f6'); b(u1 - 0.6, v1 - 1.8, 0.42, 0.5, 0, 0.45, '#ffffff'); },
  half: (b, r) => { const [u0, , u1, v1] = r; b(u0 + 0.15, v1 - 0.65, 0.42, 0.5, 0, 0.45, '#ffffff'); b(Math.min(u1 - 0.6, u0 + 0.8), v1 - 0.55, 0.5, 0.4, 0, 0.85, '#f6f6f6'); },
  dining: (b, r) => { const [u0, v0, u1, v1] = r; b(u0 + (u1 - u0) / 2 - 0.8, v0 + (v1 - v0) / 2 - 0.5, 1.6, 1.0, 0, 0.75, '#7a5638'); },
  den: (b, r) => { const [u0, v0, u1, v1] = r; b(u1 - 1.5, v0 + 0.3, 1.2, 0.6, 0, 0.75, '#7a5a3a'); b(u0 + 0.3, v1 - 0.5, Math.min(1.8, u1 - u0 - 0.6), 0.35, 0, 1.8, '#8a6a4a'); },
  rec: (b, r) => { const [u0, v0, u1, v1] = r; b(u0 + 0.4, v1 - 1.2, Math.min(2.4, u1 - u0 - 0.8), 0.9, 0, 0.8, '#5a6b7a'); b(u0 + (u1 - u0) / 2 - 0.6, v0 + 0.5, 1.2, 0.35, 0, 0.9, '#2a2a30'); },
  laundry: (b, r) => { const [u0, , , v1] = r; b(u0 + 0.2, v1 - 0.75, 0.65, 0.65, 0, 0.9, '#f2f2f2'); b(u0 + 0.95, v1 - 0.75, 0.65, 0.65, 0, 0.9, '#f2f2f2'); },
  storage: (b, r) => { const [u0, v0, u1, v1] = r; for (let k = 0; k < 3; k++) b(u0 + 0.3 + k * 0.8, v1 - 0.8 - (k % 2) * 0.5, 0.6, 0.6, 0, 0.5 + 0.2 * (k % 2), '#a88a5e'); b(u1 - 0.6, v0 + 0.3, 0.4, clamp(v1 - v0 - 0.6, 0.5, 2.4), 0, 1.5, '#a39d90'); },
  attic: (b, r) => { const [u0, v0, u1] = r; b(u0 + 0.5, v0 + 0.6, 1.1, 0.6, 0, 0.75, '#7a5a3a'); b(u1 - 1.2, v0 + 0.5, 0.8, 0.8, 0, 0.45, '#a88a5e'); },
};
// the boiler or furnace and water heater, by the assessor's heating type
const UTILITY = (ht) => (b, r) => {
  const [u0, , u1, v1] = r;
  if (ht === 'air') b(u0 + 0.3, v1 - 1.1, 0.8, 0.8, 0, 1.4, '#9aa0a6'); // furnace
  else if (ht === 'hp' || ht === 'bb') b(u0 + 0.3, v1 - 0.9, 0.6, 0.6, 0, 1.0, '#c9ccce'); // just a panel and the water heater
  else b(u0 + 0.3, v1 - 1.2, 1.0, 0.9, 0, 1.2, ht === 'steam' ? '#5a4a3e' : '#7a3a32'); // boiler
  b(Math.min(u1 - 0.7, u0 + 1.6), v1 - 0.7, 0.5, 0.5, 0, 1.5, '#d8dcdc'); // water heater
};

const WALL_WORD = { vinyl: 'vinyl siding', aluminum: 'aluminum siding', clapboard: 'clapboards', shingle: 'wood shingles', asbestos: 'asbestos shingles', brick: 'brick', stucco: 'stucco', stone: 'stone' };
const HEAT_WORD = { hw: 'hot-water radiators', steam: 'steam radiators', air: 'forced hot air', hp: 'heat pumps', bb: 'electric baseboards' };
function cardSummary(sh, unit) {
  const c = sh.card, pr = sh.fp.progs[unit];
  if (!c && !sh.unitCards) return 'No card for this building, so its rooms are sized from the floor area.';
  const u = sh.unitCards ? sh.unitCards[unit] : c;
  const bits = [];
  if (u && u.y) bits.push(`Built ${u.y}`);
  if (c && c.s) bits.push(c.s);
  bits.push(`${pr.rooms} rooms, ${pr.beds} bedroom${pr.beds === 1 ? '' : 's'}, ${pr.fb} bath${pr.fb === 1 ? '' : 's'}${pr.hb ? ` and ${pr.hb} half` : ''}${sh.units > 1 ? (sh.unitCards ? ' in this unit' : ' per unit') : ''}`);
  const fl = sh.fp;
  bits.push(`${fl.main} stor${fl.main === 1 ? 'y' : 'ies'}${fl.atticFin ? ' plus a finished attic' : ''}, ${fl.baseFin ? 'finished' : 'unfinished'} basement`);
  const src = (u && u.ht) ? u : c;
  if (src && HEAT_WORD[src.ht]) bits.push(HEAT_WORD[src.ht] + (src.ac >= 50 ? ', central air' : ''));
  if (src && src.fl) bits.push(`${{ wood: 'hardwood', carpet: 'carpeted', plank: 'plank', tile: 'tile', vinyl: 'vinyl', concrete: 'concrete' }[src.fl]} floors`);
  if (c && c.f) bits.push(`${c.f} fireplace${c.f > 1 ? 's' : ''}`);
  if (c && WALL_WORD[c.w]) bits.push(`${WALL_WORD[c.w]} outside`);
  return bits.join(' · ') + '.';
}

export function openHome(game, lot) {
  const sh = shell(game.world, lot);
  if (!sh) return;
  const fp = sh.fp;
  const floors = fp.floors;
  const mine = lot === homeLot(game.world);
  const myUnit = mine ? Math.min(sh.units - 1, 1) : Math.floor(hash2(lot.id, 5, 5) * sh.units);
  const hh = household(lot, myUnit, sh);
  const st = (lot.home = lot.home || {});
  st.mode = st.mode || null;
  const finish = (sh.unitCards && sh.unitCards[myUnit] && sh.unitCards[myUnit].fl) || (sh.card && sh.card.fl) || 'wood';
  const heat = (sh.unitCards && sh.unitCards[myUnit] && sh.unitCards[myUnit].ht) || (sh.card && sh.card.ht) || 'hw';
  const roomUnit = (fl, rm) => (rm.unit != null && rm.unit >= 0 ? rm.unit : fl.unit);
  const mineIn = (fl, rm) => roomUnit(fl, rm) === myUnit;
  // where the household's rooms are: each person's bedroom, and which floor each room is on
  const myRooms = [];
  floors.forEach((fl, fi) => fl.rooms.forEach((rm) => { if (mineIn(fl, rm)) myRooms.push({ rm, fi }); }));
  const bedsMine = myRooms.filter((x) => x.rm.t === 'primary' || x.rm.t === 'bed');
  const roomFor = (p, t, work) => {
    const pi = hh.people.indexOf(p);
    if (t === 'bed') {
      if (!p.kid) return bedsMine.find((x) => x.rm.t === 'primary') || bedsMine[0];
      const kidIx = hh.people.filter((q) => q.kid).indexOf(p);
      return bedsMine.filter((x) => x.rm.t === 'bed')[kidIx] || bedsMine[bedsMine.length - 1];
    }
    if (t === 'bath') { const bs = myRooms.filter((x) => x.rm.t === 'bath' || x.rm.t === 'half'); return bs[pi % Math.max(1, bs.length)]; }
    if (t === 'living' && work) return myRooms.find((x) => x.rm.t === 'den') || myRooms.find((x) => x.rm.t === 'living');
    return myRooms.find((x) => x.rm.t === t) || myRooms.find((x) => x.rm.t === 'living') || myRooms[0];
  };
  let view = Math.max(0, floors.findIndex((f, fi) => f.kind === 'main' && f.rooms.some((rm) => mineIn(f, rm) && rm.t === 'living')));
  const diary = [];
  const prevWhere = new Map();
  const pos = new Map();
  const prevSpeed = game.speed;
  if (!SPEEDS[game.speed][3]) game.ui.setSpeed(1); // the house runs on the slow clock

  // ---- DOM ----
  const cv = el('canvas', { class: 'hv-canvas' });
  const side = el('div', { class: 'hv-side' });
  const title = `${lot.addr || 'A home in Watertown'}${sh.units > 1 ? ` · unit ${myUnit + 1} of ${sh.units}` : ''}`;
  const floorBtns = el('div', { class: 'hv-floors' });
  const close = () => { cancelAnimationFrame(raf); root.remove(); if (!SPEEDS[prevSpeed][3]) game.ui.setSpeed(prevSpeed); };
  const root = el('div', { class: 'homeview' },
    el('div', { class: 'wbar' }, el('button', { class: 'wclose', title: 'Back to the city', onclick: close }, '×'), el('span', {}, `${title} — experimental`)),
    el('div', { class: 'hv-main' }, el('div', { class: 'hv-stage' }, cv, floorBtns), side));
  document.body.append(root);
  const FLOOR_NAME = { B: 'Basement', A: 'Attic' };
  const drawFloorBtns = () => {
    floorBtns.innerHTML = '';
    for (let f = floors.length - 1; f >= 0; f--)
      floorBtns.append(el('button', { class: `hv-fb${f === view ? ' on' : ''}`, title: FLOOR_NAME[floors[f].key] || `Floor ${floors[f].key}`, onclick: () => { view = f; drawFloorBtns(); } }, floors[f].key));
  };
  drawFloorBtns();

  const dayNum = () => Math.floor(game.frac * 30 + 0.3) + 1;
  const ctxFor = (env) => {
    const d = dayNum();
    const dow = (d + game.sim.m * 3 + game.sim.y) % 7; // a made-up but steady weekday
    const mode = st.mode || (env.busMin && env.busMin < env.drive + 8 ? 'bus' : 'drive');
    const commute = mode === 'bus' && env.busMin ? env.busMin : mode === 'bike' && env.bike ? env.bike : env.drive;
    const wx = weatherDay(game.sim, d - 1) || {};
    const bt = BEDTIMES[hh.tier];
    return { weekend: dow >= 5, dow, mode, commute, dinnerOut: st.dinner === dayNum() + game.sim.m * 31 + game.sim.y * 400, bed: bt.bed == null ? 25.5 : bt.bed < 12 ? bt.bed + 24 : bt.bed, schoolClosed: (wx.snow || 0) >= 6, wx };
  };

  let env = surroundings(game, lot), envT = performance.now();
  const renderSide = () => {
    const s = game.sim, cx = ctxFor(env);
    const r = s.rates();
    const value = (lot.landVal + lot.bldgVal) / Math.max(1, lot.units);
    const taxMo = (value * r.rateR) / 1000 / 12;
    const rentMo = (value * 0.052) / 12;
    side.innerHTML = '';
    const sec = (t) => side.append(el('h4', {}, t));
    const kv = (k, v, cls) => side.append(el('div', { class: 'kvline' }, el('span', {}, k), el('b', { class: cls || '' }, v)));
    side.append(el('div', { class: 'hv-clock' }, `${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][cx.dow]} ${dayNum()} · ${clock(game.renderer.tod)}`, el('small', {}, ` ${cx.wx.hi ?? ''}°/${cx.wx.lo ?? ''}°${cx.wx.snow >= 0.5 ? ` · ${cx.wx.snow}" snow` : cx.wx.rain >= 0.1 ? ' · rain' : ''}`)));
    const speedRow = el('div', { class: 'hv-speed' });
    for (const [v, lab] of [[0, '❚❚'], [1, '🐌'], [2, '🦥']]) speedRow.append(el('button', { class: game.speed === v ? 'on' : '', onclick: () => { game.ui.setSpeed(v); renderSide(); } }, lab));
    speedRow.append(el('button', { title: 'Skip to 6 a.m. tomorrow', onclick: () => { const d = Math.min(29.99, Math.floor(game.frac * 30 + 0.3) + 1 + 6 / 24 - 0.3); game.frac = Math.min(0.9999, Math.max(game.frac, d / 30)); } }, '⏭ morning'));
    side.append(speedRow);
    sec(mine ? 'You live here' : 'Who lives here');
    side.append(el('div', { class: 'hv-people' }, ...hh.people.map((p) => {
      const w = whereIs(p, game.renderer.tod, cx);
      const where = w.out ? { work: `at work (${cx.mode === 'bus' ? `the ${env.bus ? env.bus.r.id : ''} bus` : cx.mode})`, school: 'at school', square: 'out at the Square', dinner: `at ${st.where || 'dinner'}` }[w.out] : w.sleep ? 'asleep' : w.work ? 'working from home' : w.eat ? 'eating' : `in the ${w.t === 'bed' ? 'bedroom' : w.t === 'living' ? 'living room' : w.t}`;
      return el('div', {}, el('i', { style: `background:${p.col}` }), `${p.name}${p.kid ? ' (kid)' : ''}: ${where}`);
    })));
    sec('Getting to work');
    const pick = (m) => { st.mode = m; renderSide(); };
    const opts = [['drive', `🚗 Drive · ${env.drive} min`, true], ['bus', env.bus ? `🚌 The ${env.bus.r.id} · ${env.busMin} min${env.lanes ? ' (bus lane)' : ''}` : '🚌 No bus nearby', !!env.bus], ['bike', env.bike ? `🚲 Bike · ${env.bike} min` : '🚲 Not in this snow', !!env.bike]];
    side.append(el('div', { class: 'hv-choices' }, ...opts.map(([m, lab, ok]) => el('button', { class: `choice${cx.mode === m ? ' on' : ''}`, disabled: !ok, onclick: () => ok && pick(m) }, lab))));
    side.append(el('p', { class: 'fine' }, `Rush hour on the main roads around here runs at ${Math.round(env.cong * 100)}% of capacity.${env.bus ? ` The nearest bus stop${env.bus.stop ? `, ${env.bus.stop},` : ''} is a ${Math.max(1, Math.round(env.bus.walkM / 80))}-minute walk.` : ''}`));
    sec('Within a 10-minute walk');
    side.append(el('p', {}, `${env.food} places to eat, ${env.shops} shops, ${env.auto} auto-oriented lots.`));
    if (env.near.length) {
      const today = dayNum() + game.sim.m * 31 + game.sim.y * 400;
      side.append(el('div', { class: 'hv-choices' },
        el('button', { class: `choice${st.dinner !== today ? ' on' : ''}`, onclick: () => { st.dinner = null; renderSide(); } }, '🍳 Cook dinner at home'),
        ...uniq(env.near).slice(0, 3).map((pl) => el('button', { class: `choice${st.dinner === today && st.where === pl.n ? ' on' : ''}`, onclick: () => { st.dinner = today; st.where = pl.n; note(`Dinner out tonight at ${pl.n}: one more walking trip on the street.`); renderSide(); } }, `🚶 Walk to ${pl.n} · ${Math.max(1, Math.round(pl.d / 80))} min`))));
    }
    sec('The assessor’s card');
    side.append(el('p', {}, cardSummary(sh, myUnit)));
    side.append(el('p', { class: 'fine' }, 'The rooms, bedrooms, baths, stories, attic, basement, heating, floors and fireplaces are from the town assessor. Where the walls go is a guess in the usual Watertown pattern: the assessor doesn’t record floor plans.'));
    sec('This month');
    kv('Property tax (per unit)', `${fmtMoney(taxMo)}/mo`);
    kv('If renting, about', `${fmtMoney(rentMo)}/mo`);
    side.append(el('p', { class: 'fine' }, `From this lot's assessed value (${fmtMoney(value)} per unit) and the residential rate of $${r.rateR.toFixed(2)} per $1,000. Rent is a rough 5% gross yield.`));
    if (mine && irvingSeason(s)) side.append(el('p', { class: 'fine' }, '🎃 The yard is set up. It comes out after dark.'));
    sec('Diary');
    side.append(el('div', { class: 'hv-diary' }, ...(diary.length ? diary.slice(-8).reverse().map((d) => el('div', {}, el('b', {}, d.t), ' ', d.s)) : [el('div', { class: 'fine' }, 'Nothing yet today.')])));
  };
  const note = (s) => diary.push({ t: clock(game.renderer.tod), s });

  // ---- animation ----
  let raf = 0, lastSide = 0, last = performance.now();
  const frame = (now) => {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(100, now - last);
    last = now;
    if (now - envT > 4000) { env = surroundings(game, lot); envT = now; }
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const rect = cv.getBoundingClientRect();
    if (cv.width !== Math.round(rect.width * dpr) || cv.height !== Math.round(rect.height * dpr)) { cv.width = Math.round(rect.width * dpr); cv.height = Math.round(rect.height * dpr); }
    const g = cv.getContext('2d');
    const hour = game.renderer.tod;
    const cx = ctxFor(env);
    // sky behind the house follows the same twilight as the map
    const tint = skyTint(twilight(hour, game.sim.m));
    const dark = clamp((255 - tint[2]) / 165, 0, 1);
    g.setTransform(1, 0, 0, 1, 0, 0);
    const sky = g.createLinearGradient(0, 0, 0, cv.height);
    sky.addColorStop(0, `rgb(${Math.round(120 * tint[0] / 255)},${Math.round(170 * tint[1] / 255)},${Math.round(225 * tint[2] / 255)})`);
    sky.addColorStop(1, `rgb(${Math.round(200 * tint[0] / 255)},${Math.round(215 * tint[1] / 255)},${Math.round(230 * tint[2] / 255)})`);
    g.fillStyle = sky;
    g.fillRect(0, 0, cv.width, cv.height);
    // isometric projection: u across the front, v toward the back, z up; the street corner is nearest
    const top = floors[floors.length - 1];
    const span = sh.W + sh.D + 6;
    const S = Math.min(cv.width / (span * 0.92), cv.height / (span * 0.5 + top.z + top.h + 3.2)) * 0.92;
    const ox = cv.width / 2 - (sh.W - sh.D) * 0.866 * S / 2, oy = cv.height - (sh.W + sh.D) * 0.03 * S - 3.5 * 0.5 * S - 8 - 2.6 * S;
    const P = (u, v, z) => [ox + (u - v) * 0.866 * S, oy - (u + v) * 0.5 * S - z * S];
    const B = (z0) => (u, v, w, d, z, h, col) => box(g, P, u, v, w, d, z0 + z, h, col, 1 - 0.55 * dark);
    const card = sh.card || {};
    const fl = floors[view];
    const z0 = fl.z;
    const below = fl.kind === 'basement';
    // ground and the yard (seen from below when we're in the basement)
    const zg = -SLAB;
    g.fillStyle = `rgb(${Math.round(92 * tint[0] / 255)},${Math.round(140 * tint[1] / 255)},${Math.round(70 * tint[2] / 255)})`;
    const yard = 3;
    const porch = card.p && card.p[0] + card.p[1] >= 25, deck = card.p && card.p[3] >= 40;
    if (!below) {
      poly(g, [P(-yard, -yard - 3, zg), P(sh.W + yard, -yard - 3, zg), P(sh.W + yard, sh.D + yard, zg), P(-yard, sh.D + yard, zg)]);
      g.fillStyle = `rgb(${Math.round(120 * tint[0] / 255)},${Math.round(118 * tint[1] / 255)},${Math.round(112 * tint[2] / 255)})`;
      poly(g, [P(-yard, -yard - 3, zg + 0.01), P(sh.W + yard, -yard - 3, zg + 0.01), P(sh.W + yard, -yard - 0.5, zg + 0.01), P(-yard, -yard - 0.5, zg + 0.01)]); // sidewalk
    } else {
      // the earth around the cellar, cut away
      g.fillStyle = '#6b5440';
      poly(g, [P(sh.W, -0.3, z0 - SLAB), P(sh.W + 0.6, -0.3, z0 - SLAB), P(sh.W + 0.6, sh.D + 0.6, z0 - SLAB), P(sh.W + 0.6, sh.D + 0.6, zg), P(sh.W, sh.D, zg), P(sh.W, -0.3, zg)]);
      poly(g, [P(-0.3, sh.D, z0 - SLAB), P(sh.W + 0.6, sh.D, z0 - SLAB), P(sh.W + 0.6, sh.D + 0.6, z0 - SLAB), P(sh.W + 0.6, sh.D + 0.6, zg), P(-0.3, sh.D + 0.6, zg), P(-0.3, sh.D, zg)]);
    }
    // September and October, after dark, at the one house in town that goes all out
    if (mine && irvingSeason(game.sim) && dark > 0.35 && !below) {
      const c0 = P(sh.W * 0.5, -2.2, zg);
      const gr = g.createRadialGradient(c0[0], c0[1], 0, c0[0], c0[1], 7 * S);
      gr.addColorStop(0, `rgba(215,20,24,${0.75 * dark})`);
      gr.addColorStop(1, 'rgba(215,20,24,0)');
      g.fillStyle = gr;
      g.beginPath(); g.ellipse(c0[0], c0[1], 7 * S, 3.6 * S, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#f4efe6';
      g.lineWidth = Math.max(1, 0.08 * S);
      for (let k = 0; k < 7; k++) {
        const u = sh.W * (0.15 + 0.7 * hash2(k, 3, 9)), v = -0.8 - 2.4 * hash2(k, 4, 9);
        const b0 = P(u, v, zg), t0 = P(u, v, zg + 1.6 + 0.3 * hash2(k, 5, 9));
        g.beginPath(); g.moveTo(b0[0], b0[1]); g.lineTo(t0[0], t0[1]); // spine
        for (let r = 0; r < 4; r++) { const y = t0[1] + (b0[1] - t0[1]) * (0.18 + r * 0.1); g.moveTo(t0[0] - 0.25 * S, y); g.lineTo(t0[0] + 0.25 * S, y); }
        g.stroke();
        g.fillStyle = '#f4efe6';
        g.beginPath(); g.arc(t0[0], t0[1] - 0.15 * S, 0.2 * S, 0, Math.PI * 2); g.fill();
      }
    }
    // the back deck, and the front porch the card lists (drawn on the ground floor)
    if (deck && !below) B(zg)(sh.W * 0.3, sh.D, Math.min(4, sh.W * 0.6), 2.6, 0, 0.5, '#9a7a56');
    // floors below the one we're looking at: solid, closed (the cellar is underground)
    for (let fi = 0; fi < view; fi++) {
      const lo = floors[fi];
      if (lo.kind === 'basement') continue;
      B(lo.z - SLAB)(0, 0, sh.W, sh.D, 0, lo.h + SLAB, '#d9cdb5');
      for (let k = 0; k < 3; k++) {
        const u = (k + 0.3) * sh.W / 3;
        const lit = dark > 0.3 && hash2(fi, k, lot.id) < 0.5;
        g.fillStyle = lit ? '#ffd27f' : 'rgba(40,55,85,0.85)';
        poly(g, [P(u, 0, lo.z + 0.9), P(u + 1, 0, lo.z + 0.9), P(u + 1, 0, lo.z + 2.1), P(u, 0, lo.z + 2.1)]);
      }
    }
    if (porch && view > 0 && !below) {
      // the porch roof seen past the first floor
      const pz = floors.find((f) => f.kind === 'main').z;
      B(pz + 2.6)(sh.W * 0.08, -2.2, sh.W * 0.84, 2.2, 0, 0.18, '#7d7266');
    }
    // the floor we're on, cut away: slab, back walls, rooms, furniture, people
    g.fillStyle = below ? '#4d4a45' : '#5c5246';
    poly(g, [P(0, 0, z0), P(sh.W, 0, z0), P(sh.W, 0, z0 - SLAB), P(0, 0, z0 - SLAB)]);
    poly(g, [P(0, 0, z0), P(0, sh.D, z0), P(0, sh.D, z0 - SLAB), P(0, 0, z0 - SLAB)]);
    if (porch && fl.kind === 'main' && fl === floors.find((f) => f.kind === 'main')) {
      const enc = card.p[1] > card.p[0];
      B(z0 - SLAB)(sh.W * 0.08, -2.2, sh.W * 0.84, 2.2, 0, SLAB, '#9b8466');
      if (enc) {
        B(z0)(sh.W * 0.08, -2.2, sh.W * 0.84, 0.12, 0, 0.9, '#e8dcc4');
        g.fillStyle = 'rgba(150,190,230,0.55)';
        poly(g, [P(sh.W * 0.1, -2.2, z0 + 0.95), P(sh.W * 0.9, -2.2, z0 + 0.95), P(sh.W * 0.9, -2.2, z0 + 2.2), P(sh.W * 0.1, -2.2, z0 + 2.2)]);
      } else for (const u of [sh.W * 0.1, sh.W * 0.5, sh.W * 0.88]) B(z0)(u, -2.15, 0.14, 0.14, 0, 2.5, '#f2ede2');
    }
    const someoneIn = (rm) => hh.people.some((p) => { const w = whereIs(p, hour, cx); if (w.out || w.sleep) return false; const rf = roomFor(p, w.t, w.work); return rf && rf.rm === rm; });
    // hall and stairs
    if (fl.stair) {
      const hw = fl.stair[2];
      g.fillStyle = floorCol('hall', finish, fl.kind);
      poly(g, [P(0, 0, z0), P(hw, 0, z0), P(hw, sh.D, z0), P(0, sh.D, z0)]);
    }
    for (const rm of fl.rooms) {
      const [u0, v0, u1, v1] = rm.r;
      const c = floorCol(rm.t, finish, fl.kind).match(/\w\w/g).map((x) => parseInt(x, 16));
      const home = mineIn(fl, rm);
      const lit = dark > 0.25 && (home ? someoneIn(rm) : hash2(view, rm.r[0] * 7 + rm.r[1], lot.id) < 0.4);
      const k = lit ? 1 : 1 - 0.6 * dark;
      g.fillStyle = `rgb(${c.map((x) => Math.round(x * k * (home ? 1 : 0.9))).join(',')})`;
      poly(g, [P(u0, v0, z0), P(u1, v0, z0), P(u1, v1, z0), P(u0, v1, z0)]);
      if (rm.t === 'kitchen' || rm.t === 'bath' || rm.t === 'half') {
        // tile joints
        g.strokeStyle = 'rgba(0,0,0,0.08)';
        g.lineWidth = 1;
        g.beginPath();
        for (let u = Math.ceil(u0 / 0.6) * 0.6; u < u1; u += 0.6) { const a2 = P(u, v0, z0), b2 = P(u, v1, z0); g.moveTo(a2[0], a2[1]); g.lineTo(b2[0], b2[1]); }
        for (let v = Math.ceil(v0 / 0.6) * 0.6; v < v1; v += 0.6) { const a2 = P(u0, v, z0), b2 = P(u1, v, z0); g.moveTo(a2[0], a2[1]); g.lineTo(b2[0], b2[1]); }
        g.stroke();
      }
      if (lit) {
        const m = P((u0 + u1) / 2, (v0 + v1) / 2, z0);
        const gr = g.createRadialGradient(m[0], m[1], 0, m[0], m[1], (u1 - u0 + v1 - v0) * 0.45 * S);
        gr.addColorStop(0, 'rgba(255,214,140,0.35)');
        gr.addColorStop(1, 'rgba(255,214,140,0)');
        g.fillStyle = gr;
        poly(g, [P(u0, v0, z0), P(u1, v0, z0), P(u1, v1, z0), P(u0, v1, z0)]);
      }
    }
    // room names, faintly, on the floor
    g.font = `${Math.round(Math.max(9, 0.5 * S))}px Geneva, Tahoma, sans-serif`;
    g.textAlign = 'center';
    g.fillStyle = 'rgba(60,45,30,0.5)';
    for (const rm of fl.rooms) {
      const [u0, v0, u1, v1] = rm.r;
      const m = P(u0 + (u1 - u0) * 0.5, v0 + (v1 - v0) * 0.22, z0);
      const lab = rm.label || ROOM_LABEL[rm.t] || '';
      g.fillText(fp.cols > 1 && fl.kind === 'main' ? `${lab} (${roomUnit(fl, rm) + 1})` : lab, m[0], m[1]);
    }
    g.textAlign = 'left';
    // back walls, full height, with windows onto the night or the day (none below ground)
    const H = fl.h;
    const wallC = below ? '#b4b0a6' : '#e8dcc4';
    const wc = wallC.match(/\w\w/g).map((x) => parseInt(x, 16));
    const wk = 1 - 0.5 * dark;
    g.fillStyle = `rgb(${wc.map((x) => Math.round(x * wk * 0.82)).join(',')})`;
    poly(g, [P(sh.W, 0, z0), P(sh.W, sh.D, z0), P(sh.W, sh.D, z0 + H), P(sh.W, 0, z0 + H)]);
    g.fillStyle = `rgb(${wc.map((x) => Math.round(x * wk * 0.94)).join(',')})`;
    poly(g, [P(0, sh.D, z0), P(sh.W, sh.D, z0), P(sh.W, sh.D, z0 + H), P(0, sh.D, z0 + H)]);
    if (fl.kind === 'attic' || fl.kind === 'loft') {
      // under the roof: the slope comes down to knee walls
      g.fillStyle = `rgba(90,70,55,${0.35 + 0.3 * dark})`;
      poly(g, [P(sh.W, 0, z0 + H), P(sh.W, sh.D, z0 + H), P(sh.W * 0.5, sh.D, z0 + H + 1.6), P(sh.W * 0.5, 0, z0 + H + 1.6)]);
    }
    const winC = `rgb(${Math.round(150 * tint[0] / 255)},${Math.round(190 * tint[1] / 255)},${Math.round(230 * tint[2] / 255)})`;
    const winsBack = [], winsSide = [];
    const wz0 = below ? z0 + H - 0.55 : z0 + 0.9, wz1 = below ? z0 + H - 0.15 : z0 + Math.min(2.2, H - 0.3);
    const nb = Math.max(2, Math.floor(sh.W / 3)), ns = Math.max(2, Math.floor(sh.D / 3.5));
    g.fillStyle = winC;
    for (let k = 0; k < nb; k++) { const u = (k + 0.35) * sh.W / nb; winsBack.push(u); poly(g, [P(u, sh.D, wz0), P(u + 0.9, sh.D, wz0), P(u + 0.9, sh.D, wz1), P(u, sh.D, wz1)]); }
    for (let k = 0; k < ns; k++) { const v = (k + 0.35) * sh.D / ns; winsSide.push(v); poly(g, [P(sh.W, v, wz0), P(sh.W, v + 0.9, wz0), P(sh.W, v + 0.9, wz1), P(sh.W, v, wz1)]); }
    // furniture, stairs, heat and people, far to near
    const items = [];
    const put = (u, v, w, d, z, h, col) => items.push({ depth: u + w / 2 + v + d / 2, draw: () => B(z0)(u, v, w, d, z, h, col) });
    for (const rm of fl.rooms) {
      const f = rm.t === 'utility' ? UTILITY(heat) : FURN[rm.t];
      if (f) f(put, rm.r);
    }
    // the stair: treads climbing toward the back, in the hall by the front door
    if (fl.stair && view < floors.length - 1) {
      const [s0, , s1, sv1] = fl.stair;
      const n = 10, run = (sv1 - 0.4) / n, rise = (fl.h + SLAB) / n;
      for (let k = 0; k < n; k++) put(s0 + 0.08, 0.4 + k * run, s1 - s0 - 0.16, run, k * rise, rise, below ? '#8f8a80' : '#8a6a4a');
    }
    // a fireplace in the living room for each one the card counts (the first one, at least)
    if (card.f > 0 && !below) {
      const lr = fl.rooms.find((rm) => rm.t === 'living' && mineIn(fl, rm)) || (fl.kind === 'main' && fp.cols === 1 ? fl.rooms.find((rm) => rm.t === 'living') : null);
      if (lr) {
        const [, v0, u1, v1] = lr.r;
        const vm = (v0 + v1) / 2;
        put(u1 - 0.55, vm - 0.8, 0.55, 1.6, 0, 1.15, '#9c4f3c');
        put(u1 - 0.4, vm - 0.45, 0.4, 0.9, 1.15, fl.h - 1.15, '#a8604a');
        if (dark > 0.4 && (game.sim.m >= 10 || game.sim.m <= 2)) items.push({ depth: u1 - 0.6 + vm, draw: () => { const m = P(u1 - 0.58, vm, z0 + 0.35); g.fillStyle = 'rgba(255,150,60,0.85)'; g.beginPath(); g.ellipse(m[0], m[1], 0.22 * S, 0.14 * S, 0, 0, Math.PI * 2); g.fill(); } });
      }
    }
    // radiators under the windows (hot water or steam), registers in the floor (forced air), heat pump heads
    if (!below && fl.kind !== 'loft') {
      for (const u of winsBack) {
        if (heat === 'hw' || heat === 'steam') put(u - 0.05, sh.D - 0.22, 1.0, 0.16, 0.05, 0.6, heat === 'steam' ? '#d8d4c8' : '#f0eee8');
        else if (heat === 'bb') put(u - 0.4, sh.D - 0.1, 1.8, 0.08, 0.05, 0.18, '#f0eee8');
        else if (heat === 'air') items.push({ depth: u + sh.D - 0.3, draw: () => { g.fillStyle = 'rgba(40,40,40,0.55)'; poly(g, [P(u + 0.2, sh.D - 0.45, z0 + 0.01), P(u + 0.6, sh.D - 0.45, z0 + 0.01), P(u + 0.6, sh.D - 0.3, z0 + 0.01), P(u + 0.2, sh.D - 0.3, z0 + 0.01)]); } });
      }
      if (heat === 'hp') put(sh.W * 0.5, sh.D - 0.25, 0.9, 0.2, 2.0, 0.3, '#f4f4f4');
    }
    // interior partitions: low walls, the Sims way, with a doorway in each
    const wallBits = (u0, v0, u1, v1, along) => {
      const len = along === 'u' ? u1 - u0 : v1 - v0;
      if (len < 1.6) return put(u0 - (along === 'v' ? 0.06 : 0), v0 - (along === 'u' ? 0.06 : 0), along === 'u' ? len : 0.12, along === 'u' ? 0.12 : len, 0, 0.9, '#cfc4ae');
      const d0 = 0.35, d1 = d0 + 0.85;
      if (along === 'u') { put(u0, v0 - 0.06, d0, 0.12, 0, 0.9, '#cfc4ae'); put(u0 + d1, v0 - 0.06, len - d1, 0.12, 0, 0.9, '#cfc4ae'); }
      else { put(u0 - 0.06, v0, 0.12, d0, 0, 0.9, '#cfc4ae'); put(u0 - 0.06, v0 + d1, 0.12, len - d1, 0, 0.9, '#cfc4ae'); }
    };
    for (const rm of fl.rooms) {
      const [u0, v0, u1, v1] = rm.r;
      if (v0 > 0.01) wallBits(u0, v0, u1, v0, 'u');
      if (u0 > 0.01) wallBits(u0, v0, u0, v1, 'v');
    }
    hh.people.forEach((p, i) => {
      const w = whereIs(p, hour, cx);
      const key = w.out ? 'out:' + w.out : w.sleep ? 'sleep' : w.t;
      const was = prevWhere.get(p.name);
      if (was !== undefined && was !== key) {
        if (w.out === 'work') note(`${p.name} leaves for work: ${cx.mode === 'bus' ? `the ${env.bus ? env.bus.r.id : ''} bus, ${cx.commute} min${env.lanes ? ', and the bus lane helps' : ''}` : cx.mode === 'bike' ? `bike, ${cx.commute} min` : `driving, ${cx.commute} min${env.cong > 0.85 ? ' in heavy traffic' : ''}`}.`);
        else if (was === 'out:work') note(`${p.name} is home from work.`);
        else if (w.out === 'school') note(`${p.name} heads to school${env.schoolM < 1200 ? `, a ${Math.round(env.schoolM / 80)}-minute walk` : ' by car'}.`);
        else if (w.out === 'square') note(`${p.name} walks to the Square.`);
        else if (w.out === 'dinner') note(`Out to dinner at ${st.where || 'a place nearby'}.`);
        else if (w.sleep && !p.kid) note(`${p.name} goes to bed.`);
      }
      prevWhere.set(p.name, key);
      let tgt = null;
      if (!w.out) {
        const rf = roomFor(p, w.sleep ? 'bed' : w.t, w.work);
        if (rf && rf.fi === view) {
          const [u0, v0, u1, v1] = rf.rm.r;
          tgt = [u0 + (u1 - u0) * (0.3 + 0.4 * hash2(i, 1, 7)), v0 + (v1 - v0) * (0.3 + 0.4 * hash2(i, 2, 7))];
          if (w.sleep) { const bw = Math.min(rf.rm.t === 'primary' ? 1.9 : 1.4, u1 - u0 - 0.8); tgt = [u0 + 0.3 + bw * (rf.rm.t === 'primary' && !p.kid ? (i % 2 ? 0.7 : 0.3) : 0.5), v1 - 1.3]; }
        }
      }
      let ps = pos.get(p.name);
      if (!ps || ps.f !== view) ps = { u: tgt ? tgt[0] : 0.6, v: tgt ? tgt[1] : 1.5, a: tgt ? 1 : 0, f: view };
      const goal = tgt || [0.6, 1.5]; // off up (or down) the stairs
      const sp = 0.004 * dt * (game.speed === 0 ? 0 : 1) * 2;
      const du = goal[0] - ps.u, dv = goal[1] - ps.v, dist = Math.hypot(du, dv);
      if (dist > 0.05) { ps.u += (du / dist) * Math.min(dist, sp); ps.v += (dv / dist) * Math.min(dist, sp); }
      ps.a = clamp(ps.a + (tgt ? 1 : dist < 0.3 ? -1 : 0) * dt / 400, 0, 1);
      pos.set(p.name, ps);
      if (ps.a <= 0.01) return;
      items.push({ depth: ps.u + ps.v, draw: () => {
        const ht = p.kid ? 1.2 : 1.75, z = z0 + (w.sleep ? 0.55 : 0);
        const base = P(ps.u, ps.v, z), top2 = P(ps.u, ps.v, z + (w.sleep ? 0.3 : ht));
        g.globalAlpha = ps.a;
        g.fillStyle = 'rgba(0,0,0,0.25)';
        g.beginPath(); g.ellipse(base[0], base[1], 0.35 * S, 0.18 * S, 0, 0, Math.PI * 2); g.fill();
        if (w.sleep) { g.fillStyle = p.col; g.beginPath(); g.ellipse(top2[0], top2[1], 0.5 * S, 0.22 * S, -0.5, 0, Math.PI * 2); g.fill(); g.fillStyle = '#f0c9a0'; g.beginPath(); g.arc(top2[0] - 0.45 * S, top2[1] - 0.15 * S, 0.17 * S, 0, Math.PI * 2); g.fill(); }
        else {
          g.fillStyle = p.col;
          g.beginPath(); g.ellipse(base[0], (base[1] + top2[1]) / 2 + 0.1 * S, 0.22 * S, (base[1] - top2[1]) / 2, 0, 0, Math.PI * 2); g.fill();
          g.fillStyle = '#f0c9a0';
          g.beginPath(); g.arc(top2[0], top2[1] - 0.05 * S, 0.17 * S, 0, Math.PI * 2); g.fill();
        }
        g.globalAlpha = 1;
        if (w.sleep && Math.floor(now / 900 + i) % 2) { g.fillStyle = '#fff'; g.font = `${Math.round(0.45 * S)}px sans-serif`; g.fillText('z', top2[0] + 0.2 * S, top2[1] - 0.6 * S); }
      } });
    });
    items.sort((a2, b2) => b2.depth - a2.depth);
    for (const it of items) it.draw();
    // stubs of the cut-away front walls
    B(z0)(0, -0.08, sh.W, 0.16, 0, 0.35, below ? '#b4b0a6' : '#e8dcc4');
    B(z0)(-0.08, 0, 0.16, sh.D, 0, 0.35, below ? '#b4b0a6' : '#e8dcc4');
    // floors above: just a ghost outline
    g.strokeStyle = 'rgba(255,255,255,0.35)';
    g.lineWidth = 1;
    for (let f = view + 1; f < floors.length; f++) {
      const z = floors[f].z + 0.6;
      g.beginPath();
      [[0, 0], [sh.W, 0], [sh.W, sh.D], [0, sh.D], [0, 0]].forEach(([u, v], k) => { const p2 = P(u, v, z); k ? g.lineTo(p2[0], p2[1]) : g.moveTo(p2[0], p2[1]); });
      g.stroke();
    }
    // labels
    g.font = `${Math.round(11 * dpr)}px Geneva, Tahoma, sans-serif`;
    g.fillStyle = dark > 0.5 ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.6)';
    const unitsHere = [...new Set(fl.rooms.map((rm) => roomUnit(fl, rm)).filter((u) => u >= 0))];
    g.fillText(`${FLOOR_NAME[fl.key] || `Floor ${fl.key}`}${sh.units > 1 && unitsHere.length ? ` · unit ${unitsHere.map((u) => u + 1).join(' & ')}${unitsHere.includes(myUnit) ? ' (this household)' : ''}` : ''}`, 10 * dpr, 18 * dpr);
    const away = hh.people.filter((p) => whereIs(p, hour, cx).out);
    if (away.length) g.fillText(`Out: ${away.map((p) => p.name).join(', ')}`, 10 * dpr, 34 * dpr);
    if (now - lastSide > 700) { lastSide = now; renderSide(); }
  };
  renderSide();
  raf = requestAnimationFrame(frame);
}
