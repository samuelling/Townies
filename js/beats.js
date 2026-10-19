// Small, personal agenda items: one named shop, one corner, one tree, one wall. Fictionalized, but always
// about a specific real place on the map, with a consequence you can see the next month.
import { ZONE } from './config.js';
import { syncBiz } from './storefronts.js';

const streetOfLot = (lot) => (lot.addr || '').replace(/^[0-9\-A-Za-z]*[0-9][0-9\-A-Za-z]*\s+/, '').trim();
const roadNameAt = (s, i) => (s.w.roadName && s.w.roadName[i] >= 0 ? s.w.names[s.w.roadName[i]] || '' : '');
const pct = (x) => `${Math.round(x * 100)}%`;
const k$ = (v) => `$${Math.round(v / 1000)}K`;

function closeShop(s, lot, shop) {
  const k = lot.sf.indexOf(shop);
  if (k < 0) return;
  lot.sf.splice(k, 1);
  lot.vacant = (lot.vacant || 0) + 1;
  lot.vacantSince = s.t;
  syncBiz(lot);
  s.walkDirty = true;
  s.hooks.invalidateBuilding && lot.bldgs.forEach((id) => s.hooks.invalidateBuilding(s.w.bldgs[id]));
}
function shopAt(s, ctx) {
  const lot = s.w.lots[ctx.id];
  return lot && lot.sf ? lot.sf.find((x) => x.n === ctx.shop) : null;
}
// a road tile on a busy street near a point, for crosswalks
function busyTileNear(s, x, y, r) {
  const { W, road } = s.w;
  let best = -1, bd = 1e9;
  for (let yy = Math.max(0, Math.floor(y - r)); yy <= Math.min(s.H - 1, Math.ceil(y + r)); yy++)
    for (let xx = Math.max(0, Math.floor(x - r)); xx <= Math.min(W - 1, Math.ceil(x + r)); xx++) {
      const i = yy * W + xx;
      if (road[i] < 2 || !s.w.inTown[i]) continue;
      const d = Math.hypot(xx - x, yy - y);
      if (d < bd) { bd = d; best = i; }
    }
  return best;
}

// tree names keep their place names: a Norway maple, a Japanese tree lilac
const PROPER_TREE = /^(London|Alberta|Alleghany|Osage|Okame|Higan|Shubert|Nuttall|Indian|Norway|Japanese|American|Amur|Austrian|Chinese|European|Kentucky|Callery|Bradford|Scots|Colorado|Eastern|Freeman|Kwanzan|Yoshino|Turkish|Persian|Siberian|English|Ohio|Washington|Canadian|Korean|Black Hills|Sargent|Kousa|Cleveland|Chanticleer|Princeton|Accolade|Autumn Blaze|Armstrong|Crimson King|Schwedler|Douglas|Serbian|Carolina|Ginkgo)$/;
export const BEAT_SCENARIOS = [
  {
    id: 'beat-lease',
    cooldown: 14,
    when: (s) => s.t >= 3,
    prep: (s) => {
      const cands = [];
      for (const lot of s.w.lots) {
        if (lot.dead || !lot.inTown || !lot.sf || lot.under) continue;
        for (const sh of lot.sf) if (!sh.chain && !sh.popup && !sh.saved && (sh.sig || sh.orig) && sh.lease <= 4 && lot.ask > sh.rent * 1.12) cands.push([lot, sh]);
      }
      if (!cands.length) return null;
      const [lot, sh] = cands[Math.floor(s.rand() * cands.length)];
      return { id: lot.id, cx: lot.cx, cy: lot.cy, shop: sh.n, street: streetOfLot(lot), jump: lot.ask / sh.rent - 1, sig: sh.sig };
    },
    title: (s, c) => `${c.shop}’s Lease`,
    text: (s, c) => `${c.shop}${c.street ? ` on ${c.street}` : ''} has been part of the block for years${c.sig ? ', the kind of place people give directions by' : ''}. The lease is up soon and the landlord wants ${pct(c.jump)} more. The owner says that's the end, and the regulars have started a petition. Nothing obliges the City to do anything.`,
    choices: [
      { label: 'Cover the gap for five years', fx: (s, c) => `−${k$(18000 * (1 + c.jump))}/yr · the shop stays · Renters ↑`,
        run: (s, c) => {
          const sh = shopAt(s, c);
          if (sh) { sh.lease = 60; sh.saved = 1; sh.cushion += 0.15; }
          s.apply({ recurring: { key: `keep:${c.id}:${c.shop}`, label: `Rent help: ${c.shop}`, monthly: 1500 * (1 + c.jump), months: 60 }, approval: { renters: 2, seniors: 1, business: -1 }, news: [`City steps in to keep ${c.shop}`, `A five-year rent agreement keeps the lights on${c.street ? ` on ${c.street}` : ''}. Other shop owners are asking how they qualify.`] });
        } },
      { label: 'Broker a deal with the landlord', fx: '−$20K · maybe a smaller increase', run: (s, c) => {
        const sh = shopAt(s, c);
        if (s.rand() < 0.55 && sh) {
          sh.rent = sh.rent * (1 + c.jump / 2); sh.lease = 60; sh.saved = 1;
          s.apply({ funds: -20e3, approval: { renters: 1, business: 1 }, news: [`${c.shop} signs a new lease`, `The landlord came down to ${pct(c.jump / 2)}. Everyone says the meeting was "productive," which means it was tense.`] });
        } else {
          if (sh) closeShop(s, s.w.lots[c.id], sh);
          s.apply({ funds: -20e3, approval: { renters: -1 }, news: [`Talks fail; ${c.shop} will close`, 'The landlord says a national tenant has already toured the space.'] });
        }
      } },
      { label: 'It’s a private lease', fx: 'the shop closes · regulars grieve', run: (s, c) => {
        const sh = shopAt(s, c);
        if (sh) closeShop(s, s.w.lots[c.id], sh);
        s.apply({ approval: { renters: -2, seniors: -1, business: 1 }, news: [`${c.shop} closes`, `A sign in the window thanks “every single one of you.”${c.street ? ` Another empty storefront on ${c.street}.` : ''}`] });
      } },
    ],
  },
  {
    id: 'beat-crosswalk',
    cooldown: 20,
    when: (s) => s.t >= 4,
    prep: (s) => {
      const sch = s.w.services.filter((v) => v.alive && v.type === 'school');
      for (let k = 0; k < 8 && sch.length; k++) {
        const v = sch[Math.floor(s.rand() * sch.length)];
        const i = busyTileNear(s, v.x, v.y, 6);
        if (i < 0 || (s.flags.crosswalks || []).includes(i)) continue;
        const st = roadNameAt(s, i);
        if (!st) continue;
        return { cx: i % s.w.W, cy: (i / s.w.W) | 0, tile: i, street: st, what: v.name || 'the school' };
      }
      return null;
    },
    title: (s, c) => `A Crosswalk on ${c.street}`,
    text: (s, c) => `Parents near ${c.what} say crossing ${c.street} is a dare: four lanes of cars, a faded stripe and a near-miss last week. They want a raised crosswalk with flashing beacons. Commuters say it'll slow the street down. (It will, a little. That's the idea.)`,
    choices: [
      { label: 'Build a raised crosswalk', fx: '−$90K · safer crossing · street a bit slower · Commuters ↓', run: (s, c) => {
        s.flags.crosswalks = (s.flags.crosswalks || []).concat([c.tile]);
        s.capNear({ at: [c.cx, c.cy], r: 2, amt: -0.04 });
        s.lvNear({ at: [c.cx, c.cy], r: 6, amt: 0.01 });
        s.apply({ funds: -90e3, approval: { renters: 2, seniors: 2, homeowners: 1, commuters: -1 }, news: [`Raised crosswalk coming to ${c.street}`, 'Kids will cross on a speed table with flashing lights by spring.'] });
      } },
      { label: 'Repaint it and add a sign', fx: '−$8K · a little safer', run: (s, c) => s.apply({ funds: -8e3, approval: { renters: 1 }, news: [`Fresh paint on ${c.street}`, 'Parents say it is a start. Drivers say they didn’t notice.'] }) },
      { label: 'Leave it as is', fx: 'Renters ↓ · Seniors ↓', run: (s, c) => s.apply({ approval: { renters: -2, seniors: -1, commuters: 1 }, news: ['No crosswalk for now', `The petition about ${c.street} gets 300 more signatures overnight.`] }) },
    ],
  },
  {
    id: 'beat-tree',
    cooldown: 24,
    when: (s) => s.t >= 6 && s.w.tree,
    prep: (s) => {
      const { W, tree, road, inTown } = s.w;
      // a real street tree from the town's inventory: a big one by a street, with its real species
      const T = s.w.trees;
      if (T) {
        for (let k = 0; k < 400; k++) {
          const j = Math.floor(s.rand() * T.n);
          if (T.sp[j] < 0 || T.dbh[j] < 20) continue;
          const i = Math.floor(T.y[j]) * W + Math.floor(T.x[j]);
          if (!tree[i] || !inTown[i]) continue;
          const r = [i, i - 1, i + 1, i - W, i + W].find((q) => q >= 0 && q < tree.length && road[q] >= 1);
          if (r == null) continue;
          const st = roadNameAt(s, r);
          if (!st) continue;
          const name = s.w.treeSpecies[T.sp[j]].name.split(' ').map((x) => (PROPER_TREE.test(x) ? x : x.toLowerCase())).join(' ');
          return { cx: i % W, cy: (i / W) | 0, tile: i, street: st, kind: name, dbh: T.dbh[j] };
        }
      }
      for (let k = 0; k < 400; k++) {
        const i = Math.floor(s.rand() * tree.length);
        if (!tree[i] || !inTown[i]) continue;
        const r = [i - 1, i + 1, i - W, i + W].find((j) => j >= 0 && j < tree.length && road[j] === 1);
        if (r == null) continue;
        const st = roadNameAt(s, r);
        if (!st) continue;
        return { cx: i % W, cy: (i / W) | 0, tile: i, street: st, kind: ['red oak', 'sugar maple', 'London plane', 'American elm', 'linden'][Math.floor(s.rand() * 5)] };
      }
      return null;
    },
    title: (s, c) => `The ${c.kind[0].toUpperCase() + c.kind.slice(1)} on ${c.street}`,
    text: (s, c) => `A ${c.dbh ? `${c.dbh}-inch` : 'ninety-year-old'} ${c.kind} on ${c.street} has lifted the sidewalk into a ramp. Public Works wants it down before someone trips; the neighbors want it saved and have tied a ribbon around it. The comment section has already weighed in, twice.`,
    choices: [
      { label: 'Bump the sidewalk around it', fx: '−$35K · the tree stays · Homeowners ↑', run: (s, c) => {
        s.lvNear({ at: [c.cx, c.cy], r: 4, amt: 0.01 });
        s.apply({ funds: -35e3, approval: { homeowners: 2, seniors: 1 }, news: [`The ${c.kind} on ${c.street} stays`, 'The new sidewalk curves around it. Dogs approve.'] });
      } },
      { label: 'Take it down, plant three saplings', fx: '−$6K · shade returns in 20 years', run: (s, c) => {
        s.w.tree[c.tile] = 0;
        s.hooks.invalidateTiles && s.hooks.invalidateTiles([c.tile]);
        s.apply({ funds: -6e3, approval: { homeowners: -1 }, news: [`${c.street} loses its ${c.kind}`, 'Three saplings go in, each about as tall as a fourth-grader.'] });
      } },
      { label: 'Take it down', fx: '−$2K · Homeowners ↓', run: (s, c) => {
        s.w.tree[c.tile] = 0;
        s.hooks.invalidateTiles && s.hooks.invalidateTiles([c.tile]);
        s.apply({ funds: -2e3, approval: { homeowners: -3, seniors: -1 }, news: [`Stump grinders on ${c.street}`, 'Neighbors leave flowers on the stump. It is that kind of street.'] });
      } },
    ],
  },
  {
    id: 'beat-mural',
    cooldown: 22,
    when: (s) => s.t >= 5,
    prep: (s) => {
      const c = s.w.lots.filter((l) => !l.dead && l.inTown && !l.mural && l.zone === ZONE.C && l.bldgs.length && l.road >= 0 && s.w.road[l.road] >= 2 && (l.auto || !(l.sf && l.sf.some((x) => x.sig))));
      if (!c.length) return null;
      const lot = c[Math.floor(s.rand() * c.length)];
      return { id: lot.id, cx: lot.cx, cy: lot.cy, street: streetOfLot(lot) || roadNameAt(s, lot.road) };
    },
    title: (s, c) => `A Mural on ${c.street || 'Main Street'}`,
    text: (s, c) => `A local artist wants to paint the blank side wall of a building${c.street ? ` on ${c.street}` : ''}: forty feet of river, herons and the old Arsenal. The owner is fine with it if somebody else pays.`,
    choices: [
      { label: 'Pay for it', fx: '−$15K · the block gets a landmark · Renters ↑', run: (s, c) => {
        const lot = s.w.lots[c.id];
        if (lot) { lot.mural = 1; s.walkDirty = true; s.hooks.invalidateBuilding && lot.bldgs.forEach((id) => s.hooks.invalidateBuilding(s.w.bldgs[id])); }
        s.lvNear({ at: [c.cx, c.cy], r: 5, amt: 0.01 });
        s.apply({ funds: -15e3, approval: { renters: 2, business: 1 }, news: [`Mural goes up${c.street ? ` on ${c.street}` : ''}`, 'People keep stopping to take pictures, which is the point.'] });
      } },
      { label: 'Find a sponsor', fx: 'free · maybe', run: (s, c) => {
        if (s.rand() < 0.5) {
          const lot = s.w.lots[c.id];
          if (lot) { lot.mural = 1; s.walkDirty = true; }
          s.apply({ approval: { renters: 1 }, news: ['A bank sponsors the mural', 'Its logo is in the corner, small. Mostly.'] });
        } else s.apply({ approval: { renters: -1 }, news: ['Mural on hold', 'No sponsor yet. The wall stays beige.'] });
      } },
      { label: 'Beige is fine', fx: 'nothing changes', run: (s) => s.apply({ approval: { renters: -1 }, news: ['No mural for now', 'The artist takes the design to Waltham.'] }) },
    ],
  },
];
