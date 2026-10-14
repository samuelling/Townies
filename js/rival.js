// Preston Vale of Vale Harbor Partners: the out-of-town developer who keeps coming back with the
// chain-heavy, garage-wrapped version of every site. The opposite of the town's loudest commenters: where they slow everything
// down, he wants everything bigger and sooner. His "ambition" (0–100) rises with buzz and with wins,
// falls when he's turned down, and decides how often he shows up. Fictional; not based on any real
// person or company.
import { ZONE } from './config.js';
import { clamp, fmtMoney } from './util.js';
import { react } from './comments.js';
import { addShops } from './projects.js';
import { classifyLot } from './vibrancy.js';
import { syncBiz } from './storefronts.js';

export function vale(sim) {
  if (!sim.vale) sim.vale = { ambition: 35, wins: 0, losses: 0, homes: 0, chains: 0, legal: 0 };
  return sim.vale;
}
export const ambitionLabel = (v) => (v >= 80 ? 'Relentless' : v >= 60 ? 'Bullish' : v >= 40 ? 'Circling' : v >= 20 ? 'Testing the waters' : 'Looking at Waltham');
const bump = (sim, d) => { const v = vale(sim); v.ambition = clamp(v.ambition + d, 0, 100); };
const streetOf = (lot) => (lot.addr || '').replace(/^[0-9\-A-Za-z]*[0-9][0-9\-A-Za-z]*\s+/, '').trim();
const NAMES = ['The Vale at {S}', '{S} Commons', 'One {S}', 'The Foundry on {S}', '{S} Yards', 'Harbor Point {S}'];

export function valeMonthly(sim) {
  const v = vale(sim);
  // buzz and strong demand bring him back; quiet years send him elsewhere
  const d = sim.demand ? Math.max(0, sim.demand.R + sim.demand.C) : 0;
  const target = clamp(38 + 55 * (sim.hype || 0) + 15 * d + 6 * (sim.megaprojects || 0), 0, 95);
  v.ambition = clamp(v.ambition + (target - v.ambition) * 0.04, 0, 100);
  if (sim.rand() < 0.02 + 0.03 * (v.ambition / 100)) react(sim, 'vale-ambient', {}, null, 1);
}
export function valeStatus(sim) {
  const v = vale(sim);
  return { ...v, label: ambitionLabel(v.ambition), legalStr: fmtMoney(v.legal) };
}

// a big, underused site he'd like: car lots, parking, old industry, near a main road
function pickSite(s) {
  const c = s.w.lots.filter((l) => !l.dead && l.inTown && !l.project && !l.under && !l.locked && l.area >= 2500 && l.road >= 0 && s.w.road[l.road] >= 2 && (l.auto || l.zone === ZONE.I || (l.zone === ZONE.C && (l.dens || 0) <= 2)) && !(l.units > 4));
  if (!c.length) return null;
  c.sort((a, b) => b.area - a.area);
  const lot = c[Math.floor(s.rand() * Math.min(8, c.length))];
  const st = streetOf(lot) || (s.w.names[s.w.roadName[lot.road]] || 'Arsenal St');
  const homes = Math.max(60, Math.min(420, Math.round(lot.area / 30)));
  return { id: lot.id, cx: lot.cx, cy: lot.cy, street: st, homes, name: NAMES[Math.floor(s.rand() * NAMES.length)].replace('{S}', st.replace(/\s+(St|Street|Ave|Avenue|Rd|Road)$/i, '')) };
}

// follow-ups (registered in events.js FOLLOWUPS)
export const VALE_FOLLOWUPS = {
  'vale-done': (s, d) => {
    const lot = s.w.lots[d.id];
    if (!lot || lot.dead) return;
    lot.project = null;
    s.develop(lot, 4, ZONE.R);
    lot.zone = ZONE.C;
    lot.mixed = true;
    lot.bldgZone = ZONE.C;
    lot.locked = 1;
    lot.units = d.homes;
    lot.dens = 4;
    lot.code3 = '';
    lot.biz = [];
    lot.bizKind = [];
    lot.bizChain = [];
    addShops(s, lot, d.local, d.chains, d.local > d.chains);
    classifyLot(lot);
    lot.auto = false;
    s.walkDirty = true;
    s.megaprojects = (s.megaprojects || 0) + 1;
    s.recalc();
    s.reassign && s.reassign();
    const v = vale(s);
    v.homes += d.homes;
    v.chains += d.chains;
    const item = s.news(`${d.name} opens`, `${d.homes.toLocaleString()} apartments over ${d.local + d.chains} storefronts${d.chains > d.local ? ', mostly national names' : ', mostly local'}, and a garage. Preston Vale cuts the ribbon with oversized scissors.`, 'big');
    s.moment && s.moment('ribbon', lot.cx, lot.cy, d.name);
    react(s, 'vale-win', { name: d.name }, item, 3);
  },
  'vale-appeal': (s, d) => {
    const v = vale(s);
    const cost = 250e3 * (s.priceF ? s.priceF() : 1);
    v.legal += cost;
    if (s.rand() < 0.35) {
      s.apply({ funds: -cost, approval: { homeowners: -2, business: 1 }, news: [`Vale wins appeal over ${d.name}`, 'A judge finds the denial "arbitrary." The project goes ahead as pitched; the City pays its lawyers anyway.', 'big'] });
      VALE_FOLLOWUPS['vale-done'](s, { ...d, local: 1, chains: 4 });
      v.wins++;
    } else {
      s.apply({ funds: -cost, approval: { homeowners: 1 }, news: [`Court upholds denial of ${d.name}`, `Legal bills: ${fmtMoney(cost)}. Vale says he'll "be back with a better plan."`] });
      bump(s, -10);
    }
  },
  'vale-flip': (s, d) => {
    const lot = s.w.lots[d.id];
    if (!lot || !lot.sf) return;
    const gone = lot.sf.filter((x) => !x.chain).map((x) => x.n);
    lot.sf = lot.sf.filter((x) => x.chain);
    lot.vacant = (lot.vacant || 0) + gone.length;
    lot.vacantSince = s.t;
    lot.greed = 1.5;
    lot.ask = Math.max(lot.ask || 1, 1.45);
    syncBiz(lot);
    s.walkDirty = true;
    const item = s.news(`${gone[0] || 'The shops'} ${gone.length > 1 ? 'and neighbors are' : 'is'} out at ${d.street}`, `Vale Harbor's leasing agent says the spaces are "being repositioned for credit tenants." The windows are papered over.`);
    react(s, 'close-rent', { name: gone[0] || 'the shop' }, item, 2);
  },
};

export const VALE_SCENARIOS = [
  {
    id: 'vale-pitch',
    cooldown: 26,
    when: (s) => s.t >= 8 && vale(s).ambition >= 35,
    prep: (s) => pickSite(s),
    title: (s, c) => `Vale Harbor Pitches ${c.name}`,
    text: (s, c) => `Preston Vale of Vale Harbor Partners wants to replace a ${c.street} site with ${c.name}: about ${c.homes} apartments, a 600-space garage and a ground floor of “curated national retail.” He has renderings, a traffic study he paid for, and a slide titled “Watertown Is Ready.” It would pay a lot in taxes.`,
    choices: [
      { label: 'Approve it as pitched', fx: (s, c) => `${c.homes} homes in 2 years · 4 chains, 1 local shop · tax base ↑ · garage traffic`, run: (s, c) => {
        const lot = s.w.lots[c.id];
        if (lot) lot.project = 'vale';
        const v = vale(s);
        v.wins++;
        bump(s, 15);
        if (s.mel) s.mel.steam = Math.min(100, s.mel.steam + 12);
        s.pending.push({ at: s.t + 24, id: 'vale-done', data: { ...c, local: 1, chains: 4 } });
        const item = s.news(`Planning Board approves ${c.name}`, 'Construction starts this spring. Vale thanks “the Watertown community” three times in one sentence.', 'big');
        s.apply({ approval: { business: 3, renters: 1, homeowners: -2, commuters: -2 } });
        react(s, 'vale-pitch', { name: c.name }, item, 3);
      } },
      { label: 'Counter: local shops, 15% affordable', fx: '−$3M incentive · he might walk', run: (s, c) => {
        if (s.rand() < 0.6) {
          const lot = s.w.lots[c.id];
          if (lot) lot.project = 'vale';
          vale(s).wins++;
          bump(s, 5);
          s.pending.push({ at: s.t + 28, id: 'vale-done', data: { ...c, homes: Math.round(c.homes * 0.9), local: 3, chains: 2 } });
          s.apply({ funds: -3e6, approval: { renters: 3, business: 1, homeowners: -1 }, news: [`Vale takes the deal on ${c.name}`, 'Smaller garage, local storefronts, 15% affordable. Everyone claims they got what they wanted.'] });
        } else {
          vale(s).losses++;
          bump(s, -10);
          s.apply({ approval: { business: -2 }, news: [`Vale walks away from ${c.street}`, '“The numbers don’t work,” he says, on his way to a meeting in Waltham.'] });
        }
      } },
      { label: 'Turn it down', fx: 'Homeowners ↑ · Business ↓ · he may appeal', run: (s, c) => {
        vale(s).losses++;
        bump(s, -5);
        if (s.rand() < 0.5) s.pending.push({ at: s.t + 8, id: 'vale-appeal', data: c });
        const item = s.news(`Board rejects ${c.name}`, 'Vale’s lawyer takes notes the whole time, which nobody finds reassuring.');
        s.apply({ approval: { homeowners: 2, seniors: 1, business: -2 } });
        react(s, 'vale-loss', { name: c.name }, item, 2);
      } },
    ],
  },
  {
    id: 'vale-height',
    cooldown: 40,
    when: (s) => s.t >= 14 && vale(s).ambition >= 60,
    prep: (s) => {
      const st = ['Arsenal St', 'Pleasant St', 'Galen St', 'N Beacon St'].find((name) => s.w.lots.some((l) => !l.dead && l.inTown && (l.addr || '').endsWith(name) && l.zone !== ZONE.R && !l.dense));
      return st ? { street: st } : null;
    },
    title: (s, c) => `Taller on ${c.street}?`,
    text: (s, c) => `Vale Harbor and two other developers ask the Council to raise the height limit along ${c.street} from four stories to eight. They say it's the only way to “unlock housing.” It would also unlock their land values.`,
    choices: [
      { label: 'Raise it', fx: 'more homes and offices can come · rents ↑ · Business ↑', run: (s, c) => {
        for (const l of s.w.lots) if (!l.dead && l.inTown && (l.addr || '').endsWith(c.street) && l.zone !== ZONE.R) l.dense = true;
        bump(s, 10);
        s.hype = Math.min(0.8, (s.hype || 0) + 0.05);
        s.apply({ demand: { C: 0.08, R: 0.05 }, approval: { business: 4, renters: 1, homeowners: -2 }, news: [`${c.street} goes to eight stories`, 'Land prices along the corridor jump before the ink is dry.'] });
      } },
      { label: 'Raise it, with ground-floor shops required', fx: 'homes · local storefronts · slower', run: (s, c) => {
        for (const l of s.w.lots) if (!l.dead && l.inTown && (l.addr || '').endsWith(c.street) && l.zone !== ZONE.R) { l.dense = true; l.mixed = true; }
        bump(s, 3);
        s.apply({ demand: { C: 0.04, R: 0.04 }, approval: { business: 2, renters: 2, homeowners: -1 }, news: [`${c.street} upzoned, with strings`, 'New buildings need storefronts facing the street. Vale calls it “a challenge we embrace.”'] });
      } },
      { label: 'Keep four stories', fx: 'Homeowners ↑ · he cools off', run: (s, c) => {
        bump(s, -12);
        s.apply({ approval: { homeowners: 2, business: -2 }, news: ['Height limit stays', `Vale says he'll "focus on other markets." His LinkedIn says otherwise.`] });
      } },
    ],
  },
  {
    id: 'vale-buyout',
    cooldown: 30,
    when: (s) => s.t >= 10 && vale(s).ambition >= 50,
    prep: (s) => {
      const c = s.w.lots.filter((l) => !l.dead && l.inTown && l.sf && l.sf.length >= 2 && l.sf.some((x) => !x.chain && x.sig) && !l.rentCap && !l.project);
      if (!c.length) return null;
      const lot = c[Math.floor(s.rand() * c.length)];
      const shop = lot.sf.find((x) => !x.chain && x.sig);
      return { id: lot.id, cx: lot.cx, cy: lot.cy, street: streetOf(lot) || 'Main St', shop: shop.n, n: lot.sf.length };
    },
    title: (s, c) => `Vale Harbor Buys ${c.street}?`,
    text: (s, c) => `The family that has owned the little building with ${c.shop} and ${c.n - 1} other shop${c.n > 2 ? 's' : ''} is selling. Vale Harbor has made a strong offer. Everyone knows what happens to the rents after that. The City has a few weeks to do something, or not.`,
    choices: [
      { label: 'The City buys it first', fx: (s) => `−${fmtMoney(1.6e6 * (s.priceF ? s.priceF() : 1))} · rents stay put for 15 years · Renters ↑`, run: (s, c) => {
        const lot = s.w.lots[c.id];
        if (lot) { lot.rentCap = 1.0; lot.rentCapUntil = s.t + 180; lot.greed = 1; }
        bump(s, -6);
        s.apply({ funds: -1.6e6, approval: { renters: 3, seniors: 1, homeowners: -1 }, news: [`City buys the ${c.street} storefronts`, `${c.shop} and its neighbors get fifteen years of stable rent. Vale says he's "disappointed but respects the process."`] });
      } },
      { label: 'Find a local buyer', fx: '−$40K in staff time · maybe', run: (s, c) => {
        if (s.rand() < 0.45) {
          const lot = s.w.lots[c.id];
          if (lot) { lot.greed = 1; lot.rentCap = 1.1; lot.rentCapUntil = s.t + 120; }
          s.apply({ funds: -40e3, approval: { renters: 2 }, news: [`Local buyer outbids Vale on ${c.street}`, 'A group of neighbors and two of the shop owners pool their money. Nobody is getting rich; nobody is getting evicted.'] });
        } else {
          vale(s).wins++;
          bump(s, 6);
          s.pending.push({ at: s.t + 8, id: 'vale-flip', data: c });
          s.apply({ funds: -40e3, news: [`Vale Harbor closes on ${c.street}`, 'No local buyer could match the offer.'] });
        }
      } },
      { label: 'It’s a private sale', fx: 'free · the shops probably go', run: (s, c) => {
        vale(s).wins++;
        bump(s, 8);
        s.pending.push({ at: s.t + 8, id: 'vale-flip', data: c });
        s.apply({ approval: { renters: -2, business: 1 }, news: [`Vale Harbor buys ${c.street} storefronts`, `${c.shop}'s owner says the new landlord "hasn't returned any calls."`] });
      } },
    ],
  },
];
