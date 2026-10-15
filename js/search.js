// Find a street, an address, a business or a landmark, and fly the map to it.
const ABBR = { st: 'street', ave: 'avenue', av: 'avenue', rd: 'road', dr: 'drive', pl: 'place', ct: 'court', ter: 'terrace', terr: 'terrace', ln: 'lane', pkwy: 'parkway', sq: 'square', blvd: 'boulevard', hwy: 'highway', mt: 'mount', n: 'north', s: 'south', e: 'east', w: 'west' };
const norm = (t) => String(t || '').toLowerCase().replace(/[.,'’]/g, '').replace(/\s+/g, ' ').trim();
const words = (t) => norm(t).split(' ').filter(Boolean).map((x) => ABBR[x] || x);

export function buildIndex(world) {
  const out = [];
  const inTown = (x, y) => world.inTown[Math.floor(y) * world.W + Math.floor(x)] === 1;
  // streets: every road line with that name, centred on its longest piece
  const by = new Map();
  world.roadLines.forEach((ln, li) => {
    if (!ln.name) return;
    const p = ln.pts;
    let len = 0;
    for (let k = 2; k + 1 < p.length; k += 2) len += Math.hypot(p[k] - p[k - 2], p[k + 1] - p[k - 1]);
    // same name in Watertown and next door (there's a Pleasant Street in Belmont too) are different streets
    const m0 = Math.floor(p.length / 4) * 2;
    const key = ln.name + (inTown(p[m0], p[m0 + 1]) ? '' : ' (nearby)');
    const e = by.get(key) || { name: ln.name, lines: [], best: null, len: 0, total: 0 };
    e.lines.push(li);
    e.total += len;
    if (len > e.len) { e.len = len; const m = Math.floor(p.length / 4) * 2; e.best = [p[m], p[m + 1]]; }
    by.set(key, e);
  });
  for (const e of by.values()) out.push({ kind: 'street', label: e.name, x: e.best[0], y: e.best[1], lines: e.lines, town: inTown(e.best[0], e.best[1]), w: Math.min(3, e.total / 40) });
  // addresses and businesses
  for (const lot of world.lots) {
    if (lot.dead) continue;
    const town = !!lot.inTown;
    if (lot.addr) out.push({ kind: 'address', label: lot.addr, x: lot.cx, y: lot.cy, lot: lot.id, town, w: 0 });
    (lot.biz || []).forEach((n) => n && out.push({ kind: 'place', label: n, sub: lot.addr || '', x: lot.cx, y: lot.cy, lot: lot.id, town, w: 0.5 }));
  }
  for (const b of world.bldgs) if (b.alive && b.name) out.push({ kind: 'place', label: b.name, x: b.cx, y: b.cy, lot: b.lot, town: inTown(b.cx, b.cy), w: 0.8 });
  for (const sv of world.services || []) if (sv.alive && sv.name) out.push({ kind: 'place', label: sv.name, x: sv.x, y: sv.y, lot: sv.lot, town: inTown(sv.x, sv.y), w: 0.8 });
  for (const e of out) e.key = words(e.label);
  return out;
}

// best matches for what's been typed so far: every typed word must start a word in the name (the last one
// may be partial); streets and places in Watertown rank first
export function search(index, q, n = 9) {
  const qs = words(q);
  if (!qs.length) return [];
  const res = [];
  const seen = new Set();
  for (const e of index) {
    let score = 0, ok = true;
    for (let i = 0; i < qs.length; i++) {
      const t = qs[i], last = i === qs.length - 1;
      const k = e.key.findIndex((x) => (last ? x.startsWith(t) : x === t || x.startsWith(t)));
      if (k < 0) { ok = false; break; }
      score += k === i ? 3 : 1;
    }
    if (!ok) continue;
    if (e.key.join(' ').startsWith(qs.join(' '))) score += 4;
    score += (e.town ? 3 : 0) + (e.kind === 'street' ? 2 : 0) + e.w - e.key.length * 0.05;
    res.push({ e, score });
  }
  // the best of any duplicates (the same name in two places keeps the one in Watertown)
  return res.sort((a, b) => b.score - a.score).filter(({ e }) => {
    const id = `${e.kind}:${e.label}:${e.sub || ''}:${e.kind === 'street' ? e.town : ''}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  }).slice(0, n).map((r) => r.e);
}
