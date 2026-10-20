// "Why?": the storefront model's own numbers, put into words. For any lot with storefronts it explains what
// the landlord is asking and why, what each kind of tenant can afford, how each shop is doing, and the story of
// what opened and closed here and the reasons, down to the decisions of yours nearby that moved them.
import { lotMarket, shopMargin, buzzNow } from './storefronts.js';
import { CFG } from './config.js';

const x = (v) => `${v.toFixed(2)}×`;
const pct = (v) => `${v >= 0 ? '+' : '−'}${Math.abs(Math.round(v * 100))}%`;
const plus = (v) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}`;
const M = CFG.TILE_M;

// what you did near here since taking office: projects, new buildings, new civic buildings
export function nearbyDoings(sim, lot, R = 25) {
  const out = [];
  const d = (px, py) => Math.hypot(px - lot.cx, py - lot.cy);
  for (const p of sim.projects || []) {
    if (p.stage !== 'done' && p.stage !== 'build') continue;
    const dd = d(p.cx, p.cy);
    if (dd <= R) out.push({ d: dd, text: `${p.name}${p.stage === 'build' ? ' (being built)' : ''}, ${Math.round((dd * M) / 10) * 10} m away` });
  }
  let homes = 0, jobs = 0;
  for (const l of sim.w.lots) {
    if (l.dead || !(l.built > 0) || l.year < (sim.y0 ?? CFG.START.y) || l === lot) continue;
    if (d(l.cx, l.cy) > 14) continue;
    homes += l.units || 0;
    jobs += l.jobs || 0;
  }
  if (homes >= 5) out.push({ d: 5, text: `${homes.toLocaleString()} new homes within a five-minute walk` });
  if (jobs >= 20) out.push({ d: 6, text: `${Math.round(jobs).toLocaleString()} new jobs within a five-minute walk` });
  for (const v of sim.w.services || []) {
    if (!v.alive || v.real) continue;
    const dd = d(v.x, v.y);
    if (dd <= 18) out.push({ d: dd, text: `the new ${v.type} ${Math.round((dd * M) / 10) * 10} m away` });
  }
  return out.sort((a, b) => a.d - b.d).slice(0, 3).map((o) => o.text);
}

// the landlord's asking rent, and where it's headed
function rentStory(sim, lot, m) {
  const y0 = sim.y0 ?? CFG.START.y;
  const B = buzzNow(sim);
  const lines = [];
  const heading = Math.abs(m.target - lot.ask) > 0.04 ? `, heading for ${x(m.target)}` : '';
  lines.push(`The owner is asking ${x(lot.ask)} the ${y0} rent${heading}.`);
  const bits = [];
  if (m.parts.buzz > 0.01) bits.push(`buzz about Watertown ${plus(m.parts.buzz)}${B.dev > 0.005 ? ` (your own big projects account for ${plus(1.15 * B.dev)})` : ''}`);
  if (m.parts.land > 0.01) bits.push(`rising land values near here ${plus(m.parts.land)}`);
  if (m.parts.street > 0.01) bits.push(`a livelier street ${plus(m.parts.street)}`);
  if (bits.length) lines.push(`What pushes it up: ${bits.join('; ')}.`);
  if (m.greedF > 1.05) lines.push(`This owner is a prospector, pricing ${x(m.greedF)} above that while the buzz lasts, and slow to come down when the space sits empty.`);
  if (m.capped) lines.push('A deed restriction caps the rent.');
  if (m.parts.land > 0.05) {
    const near = nearbyDoings(sim, lot);
    if (near.length) lines.push(`Land values rose with what changed nearby: ${near.join('; ')}.`);
  }
  return lines;
}

// who can afford the space
function affordStory(sim, lot, m) {
  const y0 = sim.y0 ?? CFG.START.y;
  const lines = [];
  const ffTxt = Math.abs(m.ffRaw - 1) >= 0.02 ? `foot traffic ${pct(m.ffRaw - 1)} since ${y0}` : `foot traffic about where it was in ${y0}`;
  const vTxt = Math.abs(m.vibD) >= 0.05 ? `, street life ${plus(m.vibD)}` : '';
  lines.push(`With ${ffTxt}${vTxt}, an independent here can pay up to ${x(m.indieCap)} and a chain up to ${x(m.chainCap)}${(sim.policies || {}).rentRelief ? ' (rent relief included)' : ''}.`);
  if (lot.ask <= m.indieCap) lines.push('So an independent can afford this space.');
  else if (lot.ask <= m.chainCap && !m.prot) lines.push('So when a space empties here, only a chain can afford it.');
  else if (lot.ask <= m.chainCap && m.prot) lines.push('Only a chain could afford it, and the chain-store limits keep chains out, so empty spaces wait for the rent to come down.');
  else lines.push('Nobody can afford it at this rent; the owner will have to come down.');
  return lines;
}

const health = (mg) => (mg < 0 ? 'losing money' : mg < 0.05 ? 'barely getting by' : mg < 0.15 ? 'getting by' : 'doing fine');
function shopStory(sim, lot, s, m) {
  const sm = shopMargin(sim, lot, s, m);
  const lines = [];
  const p = sm.parts;
  const reasons = [];
  if (p.rent < -0.04) reasons.push(`its rent (${x(s.rent)}) is ${p.rent < -0.15 ? 'well ' : ''}above the ${sim.y0 ?? CFG.START.y} level`);
  if (p.sales < -0.03) reasons.push('sales are down with the foot traffic');
  if (p.sales > 0.03) reasons.push('sales are up with the foot traffic');
  if (p.tech < -0.02) reasons.push('online shopping takes a cut');
  if (p.relief > 0) reasons.push('rent relief helps');
  if (p.legacy > 0) reasons.push('the legacy registry helps');
  if (s.granted) reasons.push('a City grant covers part of the rent');
  lines.push(`${s.chain ? 'A chain' : s.sig ? 'A signature independent' : 'An independent'}, ${health(sm.margin)}${reasons.length ? `: ${reasons.join(', ')}` : ''}.`);
  if (!s.popup && lot.ask > s.rent * 1.05) {
    const after = sm.margin - 0.45 * (lot.ask - s.rent);
    lines.push(`Its lease renews in ${s.lease} month${s.lease === 1 ? '' : 's'}, at the owner's asking rent (${pct(lot.ask / s.rent - 1)})${after < 0 ? ': at that rent it would lose money' : ''}.`);
  }
  return { n: s.n, chain: s.chain, sig: s.sig, margin: sm.margin, lines };
}

// one entry of the lot's history
function historyStory(sim, lot, e) {
  const lines = [];
  let head = '';
  if (e.type === 'close-rent') {
    head = `${e.n} closed: it was losing money`;
    const r = [];
    if (e.jump > 0.05) r.push(`its rent jumped ${pct(e.jump)} when the lease renewed`);
    else if (e.mparts && e.mparts.rent < -0.04) r.push(`its rent was ${x(e.rent)} the starting level`);
    if (e.mparts && e.mparts.sales < -0.03) r.push(`foot traffic had fallen ${pct(e.ff - 1)}`);
    if (e.mparts && e.mparts.tech < -0.02) r.push('online shopping had taken a cut');
    if (e.mparts && e.mparts.cushion < 0.08) r.push('it never had much of a cushion');
    if (r.length) lines.push(`Why: ${r.join('; ')}.`);
    const push = [];
    if (e.parts.buzz > 0.05) push.push(`buzz ${plus(e.parts.buzz)}`);
    if (e.parts.land > 0.05) push.push(`land values ${plus(e.parts.land)}`);
    if (push.length) lines.push(`Behind the rent: ${push.join(', ')}${e.greedF > 1.05 ? `, and an owner pricing ${x(e.greedF)} above the market` : ''}.`);
  } else if (e.type === 'close-retire') {
    head = `${e.n} closed for ordinary reasons`;
    lines.push('It was paying its way; the owner retired or moved on, as a few percent of shops do every year.');
  } else if (e.type === 'open-indie') {
    head = `${e.n} opened${e.sig ? ' ★' : ''}`;
    lines.push(e.picked ? `You brokered the lease${e.grant ? `, with a ${fmt$(e.grant)} grant covering two years of the gap between the ask and what it could pay` : ` for ${fmt$(e.fee)}`}.` : `The ask (${x(e.ask)}) was within what an independent could pay (${x(e.indieCap)}).`);
  } else if (e.type === 'open-chain') {
    head = `${e.n} (a chain) signed a lease`;
    lines.push(e.picked ? 'You let the chain have the space.' : e.ask > e.indieCap ? `The ask (${x(e.ask)}) was above what an independent could pay (${x(e.indieCap)}), so only a chain could take it.` : `An independent could have afforded it (up to ${x(e.indieCap)}), but the chain got there first: credit tenants win more leases when the buzz is high.`);
  } else if (e.type === 'holdout') {
    head = `Still empty after ${e.months} months`;
    lines.push(`The owner was holding out at ${x(e.ask)}; independents could pay ${x(e.indieCap)}${e.prot ? ' and chains were kept out' : `, chains ${x(e.chainCap)}`}.`);
  }
  return { date: e.date, head, lines };
}
const fmt$ = (v) => (v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${Math.round(v / 1000)}K`);

export function explainLot(sim, lot) {
  const m = lotMarket(sim, lot);
  return {
    rent: rentStory(sim, lot, m),
    afford: affordStory(sim, lot, m),
    shops: (lot.sf || []).filter((s) => !s.popup).map((s) => shopStory(sim, lot, s, m)),
    vacant: lot.vacant || 0,
    history: (lot.why || []).slice().reverse().map((e) => historyStory(sim, lot, e)),
  };
}
