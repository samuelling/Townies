// A plausible floor plan for a real Watertown house, from the town assessor's card for it: how many stories
// (and whether there's a finished half story, attic or basement), how many units, rooms, bedrooms, full and
// half baths. The assessor doesn't record where the walls are, so the arrangement is a guess in the shape
// Watertown houses usually take: a stair hall down one side, the living room on the street, the kitchen at
// the back, bedrooms upstairs, and in two- and three-families a whole flat on each floor.
// Coordinates are metres: u across the front (0..W), v from the street (0) to the back (D).
import { clamp, hash2 } from './util.js';

export const FLOOR_H = 2.7, SLAB = 0.35, BASE_H = 2.2, ATTIC_H = 2.1;

const WEIGHT = { living: 1.6, kitchen: 1.1, dining: 1.0, den: 0.75, bed: 1.0, primary: 1.3, bath: 0.5, half: 0.26, utility: 1.6, storage: 1.0, rec: 2.0, laundry: 0.55, attic: 1.2 };
export const ROOM_LABEL = { living: 'Living room', kitchen: 'Kitchen', dining: 'Dining room', den: 'Den', bed: 'Bedroom', primary: 'Bedroom', bath: 'Bath', half: 'Half bath', utility: 'Boiler room', storage: 'Storage', rec: 'Family room', laundry: 'Laundry', attic: 'Attic room', hall: 'Hall' };

// u0..u1 x v0..v1 rectangle, filled front to back in rows of up to `cols` rooms, each sized by its weight
function pack(rooms, u0, v0, u1, v1) {
  const w = u1 - u0, d = v1 - v0;
  if (!rooms.length) return [];
  const cols = w >= 8.5 ? 3 : w >= 4.6 ? 2 : 1;
  // rows: consecutive rooms, but never strand a lone small bath in a row of its own
  const rows = [];
  for (let i = 0; i < rooms.length; ) {
    let n = Math.min(cols, rooms.length - i);
    if (rooms.length - (i + n) === 1 && WEIGHT[rooms[rooms.length - 1].t] < 0.6 && n < 3 && cols >= 2) n = Math.min(cols + 1, rooms.length - i);
    rows.push(rooms.slice(i, i + n));
    i += n;
  }
  const total = rooms.reduce((s, r) => s + WEIGHT[r.t], 0);
  const out = [];
  let v = v0;
  rows.forEach((row, ri) => {
    const rw = row.reduce((s, r) => s + WEIGHT[r.t], 0);
    const rd = ri === rows.length - 1 ? v1 - v : (d * rw) / total;
    let u = u0;
    row.forEach((r, ci) => {
      const cw = ci === row.length - 1 ? u1 - u : (w * WEIGHT[r.t]) / rw;
      out.push({ ...r, r: [u, v, u + cw, v + rd] });
      u += cw;
    });
    v += rd;
  });
  return out;
}

// front-to-back order for the rooms of one floor
function order(rooms, flat) {
  const pref = (r, i) => {
    switch (r.t) {
      case 'living': return 0;
      case 'den': return flat ? 0.05 : 0.25;
      case 'dining': return flat ? 0.3 : 0.5;
      case 'primary': return 0.02;
      case 'bed': return flat ? 0.35 + 0.05 * i : [0.04, 0.9, 0.92, 0.45, 0.47][r.k % 5];
      case 'bath': return flat ? 0.62 : 0.55;
      case 'half': return 0.7;
      case 'laundry': return 0.8;
      case 'kitchen': return 0.95;
      case 'rec': return 0.1;
      case 'utility': return 0.9;
      case 'storage': return 0.6;
      default: return 0.5;
    }
  };
  return rooms.map((r, i) => ({ r, p: pref(r, i) })).sort((a, b) => a.p - b.p).map((x) => x.r);
}

// what one dwelling holds: from its own card (a condominium unit) or its share of the building's
function program(card, share, area, seed) {
  let rooms, beds, fb, hb;
  if (card && card.rm > 0) {
    rooms = Math.max(2, Math.round(card.rm / share));
    beds = Math.round((card.bd || 0) / share);
    fb = Math.max(1, Math.round((card.ba || 1) / share));
    hb = Math.round((card.hb || 0) / share);
  } else {
    // no card: size it from the floor area (about 25 m² a room, a third of them bedrooms)
    rooms = clamp(Math.round(area / 25), 3, 9);
    beds = clamp(Math.round(rooms * 0.42), 1, 5);
    fb = beds >= 4 ? 2 : 1;
    hb = rooms >= 7 && hash2(seed, 3, 7) < 0.5 ? 1 : 0;
  }
  beds = clamp(beds, rooms > 2 ? 1 : 0, Math.max(0, rooms - 2));
  const list = [{ t: 'living' }, { t: 'kitchen' }];
  let spare = rooms - 2 - beds;
  if (spare > 0) { list.push({ t: 'dining' }); spare--; }
  for (let k = 0; k < Math.min(3, spare); k++) list.push({ t: 'den', label: ['Den', 'Office', 'Sunroom'][k] });
  for (let k = 0; k < beds; k++) list.push({ t: k === 0 ? 'primary' : 'bed', k });
  for (let k = 0; k < Math.min(fb, 4); k++) list.push({ t: 'bath', k });
  for (let k = 0; k < Math.min(hb, 2); k++) list.push({ t: 'half', k });
  return { rooms, beds, fb, hb, list };
}

export function floorPlan({ W, D, levels, units, card, unitCards, seed }) {
  units = clamp(units || 1, 1, 6);
  const sa = (card && card.sa) || {};
  const foot = W * D * 10.764; // sq ft
  const base = sa.BAS || foot;
  // main stories: the base floor plus each full upper story the card lists
  let upper = sa.FUS ? clamp(Math.round(sa.FUS / Math.max(1, base) + 0.25), 1, 3) : clamp(Math.floor((levels || 2) + 0.01) - 1, 0, 3);
  if (card && card.n >= 1 && !sa.FUS) upper = clamp(Math.floor(card.n + 0.01) - 1, 0, 3);
  let main = 1 + upper;
  let atticFin = !!(sa.FHS || sa.TQS || sa.FAT || sa.ATC) || (!card && (levels || 2) % 1 >= 0.4);
  // a three-family whose third flat is in a three-quarter or half story: that story is the third floor
  if (units > main && atticFin) { main++; atticFin = false; }
  const atticUnf = !atticFin && !!sa.UAT && main >= 1 + upper;
  const baseFin = !!(sa.FBM || sa.LLV);
  // which unit lives on which floor: a flat per floor (the top one gets the attic); more units than floors
  // share each floor side by side
  const cols = Math.ceil(units / main);
  const floors = [];
  const zOf = (i) => i * (FLOOR_H + SLAB);
  floors.push({ key: 'B', kind: 'basement', z: -(BASE_H + SLAB), h: BASE_H, unit: -1, rooms: [] });
  for (let i = 0; i < main; i++) floors.push({ key: String(i + 1), kind: 'main', z: zOf(i), h: FLOOR_H, unit: units === 1 ? 0 : cols > 1 ? -2 : Math.min(i, units - 1), rooms: [] });
  if (atticFin || atticUnf) floors.push({ key: 'A', kind: atticFin ? 'attic' : 'loft', z: zOf(main), h: ATTIC_H, unit: units === 1 ? 0 : cols > 1 ? -1 : units - 1, rooms: [] });
  const hw = clamp(W * 0.16, 1.0, 1.35); // the stair hall down the left side
  const stairs = (u0) => [u0, 0, u0 + hw, Math.min(D, 4.2)];

  const flatArea = (W * D) / cols;
  const progs = [];
  for (let k = 0; k < units; k++) {
    const own = unitCards && unitCards[k];
    progs.push(program(own || card, own ? 1 : units, units === 1 ? W * D * main : flatArea, seed + k));
  }

  const mainFloors = floors.filter((f) => f.kind === 'main');
  const attic = floors.find((f) => f.kind === 'attic' || f.kind === 'loft');
  if (units === 1) {
    // a single-family house: living rooms downstairs, bedrooms and full baths up
    const pr = progs[0];
    const ground = pr.list.filter((r) => ['living', 'kitchen', 'dining', 'den', 'half'].includes(r.t));
    const beds = pr.list.filter((r) => r.t === 'bed' || r.t === 'primary');
    const baths = pr.list.filter((r) => r.t === 'bath');
    const ups = mainFloors.slice(1);
    const finAttic = attic && attic.kind === 'attic';
    // a finished attic or half story takes bedrooms: most of them in a cape, one in a big house
    const nAttic = !finAttic ? 0 : !ups.length ? Math.min(2, Math.max(0, beds.length - 1)) : beds.length >= 4 ? 1 : 0;
    const atticBeds = nAttic ? beds.splice(beds.length - nAttic) : [];
    const atticBath = atticBeds.length && baths.length > Math.max(1, ups.length) ? baths.splice(baths.length - 1) : [];
    if (!ups.length) mainFloors[0].rooms = ground.concat(beds, baths);
    else {
      mainFloors[0].rooms = ground.slice();
      ups.forEach((f, i) => { f.rooms = beds.filter((_, k) => k % ups.length === i); });
      baths.forEach((b, k) => (k < ups.length ? ups[k] : mainFloors[0]).rooms.push(b));
      // too many bedrooms for the upstairs: one comes down
      for (const f of ups) if (f.rooms.length > 5) { const bi = f.rooms.findIndex((r) => r.t === 'bed'); if (bi >= 0) mainFloors[0].rooms.push(...f.rooms.splice(bi, 1)); }
    }
    if (attic) attic.rooms = finAttic ? (atticBeds.length ? atticBeds.concat(atticBath) : [{ t: 'attic' }]) : [{ t: 'storage' }];
  } else if (cols === 1) {
    // a flat per floor; the top unit's bedrooms spill into the attic when it has one
    mainFloors.forEach((f, i) => {
      const k = Math.min(i, units - 1);
      if (i >= units) { f.rooms = []; return; }
      f.rooms = progs[k].list.slice();
    });
    // more floors than units: the extra floors go to the top unit
    const top = units - 1;
    const topFloors = mainFloors.slice(top);
    if (topFloors.length > 1) {
      const pr = progs[top].list;
      topFloors[0].rooms = pr.filter((r) => ['living', 'kitchen', 'dining', 'den', 'half'].includes(r.t));
      const rest = pr.filter((r) => !['living', 'kitchen', 'dining', 'den', 'half'].includes(r.t));
      topFloors.slice(1).forEach((f, i) => { f.rooms = rest.filter((_, k) => k % (topFloors.length - 1) === i); f.unit = top; });
    }
    if (attic) {
      if (attic.kind === 'attic') {
        const tf = mainFloors[Math.min(mainFloors.length - 1, units - 1 + (topFloors.length - 1))];
        const bi = tf.rooms.findIndex((r) => r.t === 'bed');
        attic.rooms = bi >= 0 && tf.rooms.filter((r) => r.t === 'bed' || r.t === 'primary').length >= 3 ? tf.rooms.splice(bi, 1) : [{ t: 'attic' }];
      } else attic.rooms = [{ t: 'storage' }];
    }
  }
  // the basement: shared by everyone
  const bsm = floors[0];
  bsm.rooms = baseFin ? [{ t: 'rec' }, { t: 'laundry' }, { t: 'utility' }] : [{ t: 'storage' }, { t: 'laundry' }, { t: 'utility' }];

  // lay out each floor
  for (const f of floors) {
    if (cols > 1 && f.kind === 'main') {
      // side-by-side flats: each its own half (or third) of the floor, stairs between them
      const fi = mainFloors.indexOf(f);
      f.rooms = [];
      f.stair = stairs(0);
      const cw = (W - hw) / cols;
      for (let c = 0; c < cols; c++) {
        const k = fi * cols + c;
        if (k >= units) continue;
        const placed = pack(order(progs[k].list, true), hw + c * cw, 0, hw + (c + 1) * cw, D);
        for (const r of placed) r.unit = k;
        f.rooms.push(...placed);
      }
      continue;
    }
    const flat = units > 1 && f.kind === 'main';
    f.stair = f.kind === 'loft' ? null : stairs(0);
    const placed = pack(order(f.rooms, flat), f.stair ? hw : 0, 0, W, D);
    for (const r of placed) r.unit = f.unit;
    f.rooms = placed;
  }
  return { floors, units, progs, cols, main, atticFin, baseFin };
}
