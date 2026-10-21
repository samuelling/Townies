// Melora: the town's most dedicated public commenter, and a recurring obstacle. She means well (she reads every
// filing and sometimes catches something real), but her interventions mostly delay things, cost money, and leave
// lots empty while rents climb. Her "steam" (0–100) rises with development and with being brushed off, falls
// when she wins or feels heard, and drives how often she shows up. She doesn't get a card of her own; you know
// her by what she does:
//   - at Planning Board hearings: binders that get them continued, testimony that sinks the odds
//   - after an approval: an abutters' appeal to the Land Court that stalls construction for months
//   - on the map: appeals and demolition-delay reviews that put cleared or rezoned lots on hold
//   - month to month: records requests, Open Meeting Law complaints, and petitions
//   - and if you keep brushing her off, a campaign against the City Manager.
// Listening cools her down; giving in rewards her; changing the rules on public comment blunts her, at a price.
// An archetype, not a portrait: fictional, and not based on any one person.
import { clamp, fmtMoney } from './util.js';
import { react } from './comments.js';
import { ZONE } from './config.js';

export function mel(sim) {
  if (!sim.mel) sim.mel = { steam: 40, wins: 0, delays: 0, cost: 0, walked: 0, points: 0, warden: false, pauseUntil: -1, aftermath: [], binder: 47, snubs: 0, appeals: 0, holds: 0 };
  const m = sim.mel;
  m.snubs = m.snubs || 0;
  m.appeals = m.appeals || 0;
  m.holds = m.holds || 0;
  return m;
}
export const steamLabel = (v) => (v >= 80 ? 'On the warpath' : v >= 60 ? 'Fired up' : v >= 40 ? 'Simmering' : v >= 20 ? 'Keeping an eye on things' : 'Gardening');
const bump = (sim, d) => { const m = mel(sim); m.steam = clamp(m.steam + d, 0, 100); };
const snub = (sim, d) => { const m = mel(sim); m.snubs++; bump(sim, d); };
const off = (sim) => !!(sim.flags && sim.flags.noMelora);
const rules = (sim) => !!(sim.flags && sim.flags.melRules);

const PREFS = { mega: 1.3, lab: 1.4, housing: 1.15, infill: 0.8, plaza: 0.25 };

// called when a project is filed
export function meloraOnSubmit(sim, p) {
  bump(sim, p.prog === 'plaza' ? -3 : p.prog === 'infill' ? 5 : p.prog === 'mega' ? 14 : 11);
}

// Before the Planning Board votes. Returns true if she got the hearing continued (no vote this month).
export function meloraAtHearing(sim, p) {
  if (off(sim)) return false;
  const m = mel(sim);
  const show = clamp((0.3 + 0.6 * (m.steam / 100)) * (PREFS[p.prog] || 1) * (m.warden ? 1.2 : 1) * (rules(sim) ? 0.6 : 1), 0, 0.95);
  if (sim.rand() > show) return false;
  const pf = sim.priceF ? sim.priceF() : 1;
  if (!p.melDelayed && sim.rand() < (rules(sim) ? 0.25 : 0.55)) {
    // the binder
    p.melDelayed = 1;
    const months = 2 + Math.floor(sim.rand() * 2) + (m.warden ? 1 : 0);
    p.at = sim.t + months;
    m.delays++;
    m.binder++;
    const staff = 35000 * pf;
    sim.funds -= staff;
    m.cost += staff;
    let walked = false;
    if (p.o.devFeas != null) {
      // carrying costs: every month of delay eats the developer's margin
      p.o.devFeas -= 0.015 * months;
      if (p.o.devFeas < -0.02 && !(p.prog === 'housing' && p.t.nonprofit)) walked = true;
    } else if (p.o.cityCost) p.o.cityCost *= 1 + 0.02 * months;
    if (walked) {
      p.stage = 'denied';
      for (const li of p.ids) sim.w.lots[li].project = null;
      m.walked++;
      m.wins++;
      bump(sim, -20);
      const item = sim.news(`Developer abandons ${p.name} after delays`, `Melora's ${m.binder}-page binder of concerns sent the hearing back for "further review." By the time it returned, the financing had expired.`, 'big');
      react(sim, 'melora-win', { name: p.name }, item, 3);
      aftermath(sim, p);
      return true;
    }
    const item = sim.news(`Melora gets ${p.name} hearing continued`, `She submitted a ${m.binder}-page binder (tabbed, color-coded) at 9:58 p.m. The Board voted to continue the hearing ${months} months to "give it the attention it deserves."`);
    react(sim, 'melora-delay', { name: p.name }, item, 3);
    return true;
  }
  // she testifies
  const penalty = (0.04 + 0.08 * (m.steam / 100)) * (m.warden ? 0.7 : 1) * (rules(sim) ? 0.6 : 1);
  p.melPenalty = (p.melPenalty || 0) + penalty;
  if (sim.rand() < 0.25 && (p.prog === 'mega' || p.prog === 'housing') && p.t.affordable != null && p.t.affordable < 25) {
    // she has a point
    p.t.affordable += 5;
    m.points++;
    const item = sim.news(`Melora catches a real problem in ${p.name}`, 'Buried in an appendix, she found the affordable units were counted twice. The developer agrees to add five percent more. Even her critics nod.');
    react(sim, 'melora-point', { name: p.name }, item, 2);
  } else {
    const item = sim.news(`Melora speaks for 40 minutes on ${p.name}`, 'Topics included shadows, the 1987 master plan, parking, a hawk she saw once, and "what this town used to be." Several neighbors clapped.');
    react(sim, 'melora-testify', { name: p.name }, item, 2);
  }
  return false;
}

// after the vote. Approved projects may face an abutters' appeal to the Land Court.
export function meloraAfterVote(sim, p, approved) {
  if (off(sim)) return;
  const m = mel(sim);
  if (approved) {
    bump(sim, p.prog === 'plaza' ? -5 : 10);
    if (p.prog === 'plaza') return;
    const pr = clamp((0.05 + 0.32 * (m.steam / 100)) * (PREFS[p.prog] || 1) * (rules(sim) ? 0.7 : 1), 0, 0.4);
    if (sim.rand() < pr) {
      const months = 6 + Math.floor(sim.rand() * 7);
      p.at += months;
      p.appeal = { t: sim.t, months, odds: 0.8, done: false };
      m.appeals++;
      const pf = sim.priceF ? sim.priceF() : 1;
      const legal = 80e3 * pf;
      sim.funds -= legal;
      m.cost += legal;
      m.pendingAppeal = p.id;
      const item = sim.news(`Melora and ten neighbors appeal ${p.name} to the Land Court`, `Construction is on hold while the case is heard, likely ${months} months. The City has hired outside counsel (${fmtMoney(legal)} so far). Melora says she is "just asking the court to read it."`, 'big');
      react(sim, 'melora-delay', { name: p.name }, item, 3);
    }
  } else if (p.melPenalty || p.melDelayed) {
    m.wins++;
    bump(sim, -15);
    react(sim, 'melora-win', { name: p.name }, null, 1);
    aftermath(sim, p);
  }
}

// She watches the permit log too. Clearing old buildings or rezoning next to homes can draw an appeal or a
// demolition-delay review that puts those lots on hold (nothing gets built there until it runs out).
export function meloraOnEdit(sim, tool, lots) {
  if (off(sim) || !lots.length) return;
  const m = mel(sim);
  const live = lots.filter((l) => l && !l.dead && l.inTown);
  if (!live.length) return;
  const pf = sim.priceF ? sim.priceF() : 1;
  let kind = null;
  if (tool === 'bulldoze' && live.some((l) => l.real && l.year && l.year < 1930)) kind = 'demo';
  else if ((tool === 'zoneC' || tool === 'zoneI' || tool === 'zoneM') && live.some((l) => l.bldgZone === ZONE.R || nearHomes(sim, l))) kind = 'rezone';
  else if (tool === 'zoneR' && live.some((l) => l.dense)) kind = 'rezone';
  if (!kind) return;
  const pr = clamp((kind === 'demo' ? 0.15 : 0.1) + 0.4 * (m.steam / 100), 0, 0.6) * (rules(sim) ? 0.7 : 1);
  if (sim.rand() > pr) return;
  const months = kind === 'demo' ? 6 + Math.floor(sim.rand() * 7) : 3 + Math.floor(sim.rand() * 4);
  for (const l of live) l.stay = Math.max(l.stay || 0, sim.t + months);
  m.holds++;
  bump(sim, 4);
  const cost = 20e3 * pf;
  sim.funds -= cost;
  m.cost += cost;
  const street = live[0].addr ? live[0].addr.replace(/^\d+[A-Z]?\s+/, '') : 'that block';
  const item = kind === 'demo'
    ? sim.news(`Melora asks the Historical Commission to review the ${street} demolition`, `The buildings were already gone, but the review still applies: nothing new can go up there for ${months} months. She brought photographs from 1962.`)
    : sim.news(`Melora appeals the ${street} rezoning`, `She filed with the Zoning Board of Appeals at 4:59 p.m. on the last possible day. The lots are on hold for about ${months} months while it's heard.`);
  react(sim, 'melora-delay', { name: `the ${street} rezoning` }, item, 2);
}
const nearHomes = (sim, lot) => {
  const w = sim.w;
  for (const l2 of w.lots) if (!l2.dead && l2.zone === ZONE.R && l2.units && Math.abs(l2.cx - lot.cx) < 5 && Math.abs(l2.cy - lot.cy) < 5) return true;
  return false;
};

// a year later, the lot is still what it was, and the rents nearby are higher
function aftermath(sim, p) {
  mel(sim).aftermath.push({ at: sim.t + 12, name: p.name, cx: p.cx, cy: p.cy, homes: p.o.homes || 0 });
}

export function meloraMonthly(sim) {
  if (off(sim)) return;
  const m = mel(sim);
  const pf = sim.priceF ? sim.priceF() : 1;
  // drifts back toward a baseline simmer; active projects keep her busy
  const hearings = (sim.projects || []).filter((p) => p.stage === 'hearing').length;
  const building = (sim.projects || []).filter((p) => p.stage === 'build').length;
  const base = sim.flags && sim.flags.melHours ? 22 : 40;
  m.steam = clamp(m.steam + (base - m.steam) * 0.05 + hearings * 0.9 + building * 0.2, 0, 100);
  for (const a of m.aftermath.filter((x) => x.at <= sim.t)) {
    sim.lvNear({ at: [a.cx, a.cy], r: 16, amt: 0.015 });
    sim.hype = Math.min(0.8, (sim.hype || 0) + 0.01);
    const item = sim.news(`A year after ${a.name} died, the site is unchanged`, `${a.homes ? `The ${a.homes} homes went to a town that said yes. ` : ''}Asking rents within a few blocks are up again. Melora calls the outcome "a win for the neighborhood."`);
    react(sim, 'melora-aftermath', {}, item, 2);
  }
  m.aftermath = m.aftermath.filter((x) => x.at > sim.t);
  // Land Court rulings
  for (const p of sim.projects || []) {
    const a = p.appeal;
    if (!a || a.done || p.stage !== 'build' || sim.t < a.t + a.months) continue;
    a.done = true;
    if (m.pendingAppeal === p.id) m.pendingAppeal = null;
    if (sim.rand() < a.odds) {
      bump(sim, 8);
      const item = sim.news(`Land Court dismisses the appeal of ${p.name}`, `The judge found the neighbors hadn't shown they'd be harmed. Construction resumes, ${a.months} months late. Melora is "weighing her options."`);
      react(sim, 'project-approved', { name: p.name }, item, 1);
    } else {
      const k = 0.8;
      for (const f of ['homes', 'affordable', 'jobs', 'storefronts']) if (p.o[f]) p.o[f] = Math.round(p.o[f] * k);
      if (p.t.floors) p.t.floors = Math.max(2, p.t.floors - 1);
      m.wins++;
      bump(sim, -20);
      const item = sim.news(`Land Court sides with Melora on ${p.name}`, `The judge sent it back for a smaller building. It loses a floor and about a fifth of what it would have held. Melora brings a cake to the courthouse.`, 'big');
      react(sim, 'melora-win', { name: p.name }, item, 3);
    }
  }
  // the steady drip
  if (sim.rand() < Math.max(0, m.steam - 45) / 700) meloraRecords(sim);
  else if (sim.rand() < m.steam / 1800) {
    const cost = 25e3 * pf;
    sim.funds -= cost;
    m.cost += cost;
    sim.news('Open Meeting Law complaint filed', `Melora says a quorum of the Council "exchanged glances" about the budget at a ribbon cutting. The Attorney General's office will review it. Legal costs so far: ${fmtMoney(cost)}.`);
    react(sim, 'melora-ambient', {}, null, 1);
  } else if (sim.m === 9 && !m.skeletons && sim.rand() < 0.3) {
    m.skeletons = sim.y;
    sim.news('Complaint: "excessive skeletons" on Irving Street', 'Melora has asked Inspectional Services whether one front yard has "more skeletons than the bylaw contemplates." An inspector visited, admired the antlers, and found no violation.');
  }
  if (m.skeletons && m.skeletons !== sim.y && sim.m === 0) m.skeletons = 0;
  // she posts. A lot.
  if (sim.rand() < 0.15 + m.steam / 350) react(sim, 'melora-ambient', {}, null, 1);
}

// development pause (from her petition) blocks new filings
export const pauseActive = (sim) => sim.mel && sim.mel.pauseUntil > sim.t;

export function meloraStatus(sim) {
  const m = mel(sim);
  return { ...m, label: steamLabel(m.steam), costStr: fmtMoney(m.cost) };
}

// Her own agenda items
export const MELORA_SCENARIOS = [
  {
    id: 'melora-appeal',
    priority: true,
    cooldown: 0,
    when: (s) => !off(s) && s.mel && s.mel.pendingAppeal && (s.projects || []).some((p) => p.id === s.mel.pendingAppeal && p.appeal && !p.appeal.done && !p.appeal.handled),
    prep: (s) => { const p = s.projects.find((q) => q.id === s.mel.pendingAppeal); return p ? { p } : null; },
    title: (s, { p }) => `The ${p.name} Appeal`,
    text: (s, { p }) => `Melora and ten abutters have appealed ${p.name} to the Land Court. The site sits fenced and idle, the developer is paying interest, and the City's outside counsel is billing by the hour. Counsel thinks the City wins about four times in five, in ${p.appeal.months} months or so.`,
    choices: [
      { label: 'Fight it to a ruling', fx: (s, c) => `−$120K more legal · about ${c ? c.p.appeal.months : 9} months · 80% the City wins, else a smaller building`, run: (s, { p }) => { p.appeal.handled = 1; snub(s, 8); s.apply({ funds: -120e3, approval: { business: 1, renters: 1, homeowners: -1 }, news: ['City will fight the appeal', `Melora: "See you in court." She has already reserved a seat.`] }); } },
      { label: 'Settle: trim it, add a pocket park', fx: '−$150K · a tenth smaller · back to work in 2 months · she cools off', run: (s, { p }) => {
        p.appeal.handled = 1; p.appeal.done = true; s.mel.pendingAppeal = null;
        p.at -= Math.max(0, p.appeal.months - 2);
        for (const f of ['homes', 'affordable', 'jobs', 'storefronts']) if (p.o[f]) p.o[f] = Math.round(p.o[f] * 0.9);
        s.lvNear({ at: [p.cx, p.cy], r: 6, amt: 0.01 });
        s.mel.wins++; bump(s, -30);
        s.apply({ funds: -150e3, approval: { homeowners: 2, renters: -1 }, news: [`${p.name} appeal settled`, 'A little shorter, a little greener, and two months behind instead of a year. Melora calls it "a model for how this should work." She means every project.'] });
      } },
      { label: 'Ask the judge to require an appeal bond', fx: '−$25K · about even odds she can’t post it and drops the case · if she can, nothing changes', run: (s, { p }) => {
        p.appeal.handled = 1;
        if (s.rand() < 0.5) {
          p.appeal.done = true; s.mel.pendingAppeal = null;
          p.at -= Math.max(0, p.appeal.months - 1);
          snub(s, 18);
          s.apply({ funds: -25e3, approval: { business: 2, homeowners: -2 }, news: ['Melora drops her appeal', 'The judge required a bond she couldn’t raise. Construction restarts next month. She calls it "justice for sale" in a letter that runs two pages.'] });
        } else {
          snub(s, 10);
          s.apply({ funds: -25e3, approval: { homeowners: -1 }, news: ['Neighbors post Melora’s bond', 'A bake sale, a GoFundMe and one very generous retired dentist. The appeal goes on.'] });
        }
      } },
    ],
  },
  {
    id: 'melora-petition',
    cooldown: 30,
    when: (s) => !off(s) && s.t >= 6 && mel(s).steam >= 58 && !pauseActive(s),
    title: 'Melora’s Petition to “Pause and Reflect”',
    text: (s) => `Melora has collected ${400 + Math.round(mel(s).steam * 6)} signatures (she knocked on every door on her street twice) for a 12-month pause on all new development "until we understand the cumulative impacts." She is at every meeting, in every comment thread, and on the local access channel. She sincerely believes she is saving the town.`,
    choices: [
      { label: 'Sit down with her and listen', fx: '−$40K · she cools off · nothing pauses', run: (s) => { bump(s, -35); s.mel.snubs = Math.max(0, s.mel.snubs - 1); s.apply({ funds: -40e3, approval: { homeowners: 1, seniors: 1 }, news: ['City Manager meets Melora for coffee', 'Three hours, two refills, one 47-page binder. She leaves feeling heard, for now.'] }); } },
      { label: 'Adopt the 12-month pause', fx: 'no new projects for a year · rents ↑ · Homeowners ↑ · Renters ↓', run: (s) => { mel(s).pauseUntil = s.t + 12; mel(s).wins++; bump(s, -30); s.hype = Math.min(0.8, (s.hype || 0) + 0.12); s.apply({ demand: { R: -0.25, C: -0.12 }, approval: { homeowners: 4, seniors: 2, renters: -5, business: -4 }, news: ['Council adopts development pause', 'Melora thanks "everyone who showed up." Landlords quietly raise asking rents on everything already built.', 'big'] }); } },
      { label: 'Thank her for her input', fx: 'free · she escalates', run: (s) => { snub(s, 22); s.apply({ approval: { homeowners: -2 }, later: { months: 3, id: 'melora-records' }, news: ['Council receives petition, takes no action', 'Melora announces she will "be filing some records requests."'] }); } },
    ],
  },
  {
    id: 'melora-tree',
    cooldown: 36,
    when: (s) => !off(s) && s.t >= 8 && mel(s).steam >= 40 && (s.projects || []).some((p) => p.stage === 'build' && p.prog !== 'plaza'),
    prep: (s) => { const p = (s.projects || []).find((q) => q.stage === 'build' && q.prog !== 'plaza'); return p ? { p, cx: p.cx, cy: p.cy, id: p.ids[0] } : null; },
    title: 'Melora and the Sycamore',
    text: (s, { p }) => `Melora has discovered a 90-year-old sycamore at the edge of the ${p.name} site, and she has a point: it is a lovely tree. She has also organized a vigil, a GoFundMe for an arborist, and a 24-hour "tree watch" rota. Construction crews are standing around.`,
    choices: [
      { label: 'Redesign around the tree', fx: '4-month delay · the block gets a little nicer', run: (s, { p }) => { p.at += 4; s.lvNear({ at: [p.cx, p.cy], r: 8, amt: 0.02 }); mel(s).points++; bump(s, -15); s.apply({ approval: { homeowners: 2, business: -1 }, news: ['The sycamore stays', 'Architects redraw the corner. The tree is, admittedly, beautiful.'] }); } },
      { label: 'Proceed as approved', fx: 'on schedule · Homeowners ↓ · she escalates', run: (s) => { snub(s, 18); s.apply({ approval: { homeowners: -3, seniors: -1 }, news: ['Sycamore comes down at 7 a.m.', 'Melora livestreams it. The video has more views than the last three Council meetings combined.'] }); } },
      { label: 'Appoint her honorary Tree Warden', fx: '−$15K/yr · she calms down · reviews every future permit', run: (s) => { mel(s).warden = true; bump(s, -40); s.apply({ recurring: { key: 'melora-warden', label: 'Tree Warden stipend', monthly: 1250 }, approval: { homeowners: 1 }, news: ['Melora named Tree Warden', 'She accepts with a 20-minute speech and a new laminated badge. Every permit now crosses her desk.'] }); } },
    ],
  },
  {
    id: 'melora-parking',
    cooldown: 40,
    when: (s) => !off(s) && s.t >= 10 && mel(s).steam >= 45 && (s.flags.bikeLane || (s.tech && s.tech.stance.ebike === 'embrace') || s.flags.squarePlan === 'build' || (s.transit && Object.values(s.transit.lanes || {}).some(Boolean))),
    title: 'Melora Counts the Cars',
    text: () => 'Melora spent a week on a folding chair counting parked cars on Main Street (her total: 1,138, "conservatively") and has concluded that the new street design will "destroy small business." The shop owners she quotes are mostly the ones who already closed. Some of her numbers are even right.',
    choices: [
      { label: 'Commission a real parking study', fx: '−$60K · settles it · she disputes the methodology', run: (s) => s.apply({ funds: -60e3, news: ['Parking study finds plenty of spaces', 'Average occupancy: 61%. Melora questions why the counts were done "on a Tuesday."'] }) },
      { label: 'Restore the parking', fx: 'Homeowners ↑ · Renters ↓ · street life ↓', run: (s) => { mel(s).wins++; bump(s, -20); s.capNear({ at: 'square', r: 14, amt: 0.03 }); s.lvNear({ at: 'square', r: 16, amt: -0.02 }); s.apply({ approval: { homeowners: 2, seniors: 2, renters: -3 }, news: ['Parking returns to Main Street', 'Melora declares victory. The bike lane becomes a loading zone, then a parking space again.'] }); } },
      { label: 'Ignore it', fx: 'free · she escalates', run: (s) => { snub(s, 15); s.apply({ approval: { homeowners: -1 } }); } },
    ],
  },
  {
    // the counterplay: change the rules she plays by, or give her somewhere to put it
    id: 'melora-rules',
    cooldown: 60,
    when: (s) => !off(s) && s.t >= 12 && mel(s).delays + mel(s).appeals + mel(s).holds >= 2 && !(s.flags.melRules || s.flags.melHours),
    title: 'Reforming Public Comment',
    text: (s) => `Between continued hearings, appeals and records requests, staff estimate Melora has cost the City ${fmtMoney(mel(s).cost)} and added months to ${mel(s).delays + mel(s).appeals} projects. The Council is considering rules: written comments due 48 hours before a hearing, three minutes per speaker, no yielding time to yourself. Others suggest the City Manager simply hold monthly office hours.`,
    choices: [
      { label: 'Adopt the new rules', fx: 'her hearing delays and appeals blunted for good · Homeowners ↓ · Seniors ↓ · she is furious', run: (s) => { s.flags.melRules = 1; bump(s, 25); s.apply({ approval: { homeowners: -3, seniors: -2, business: 2, renters: 1 }, news: ['Council adopts public comment rules', 'Three minutes, written comments in advance. Melora reads a 40-minute statement into the record during the vote, which is allowed, because the rules start next month.', 'big'] }); } },
      { label: 'Hold monthly office hours', fx: '−$30K/yr · she simmers lower from now on', run: (s) => { s.flags.melHours = 1; bump(s, -20); s.mel.snubs = 0; s.apply({ recurring: { key: 'melora-hours', label: 'City Manager office hours', monthly: 2500 }, approval: { homeowners: 2, seniors: 1 }, news: ['City Manager starts monthly office hours', 'First Thursday of the month. Melora is first in line, with a binder and a thermos.'] }); } },
      { label: 'Leave it as it is', fx: 'free', run: (s) => s.apply({ news: ['No change to public comment', 'Melora: "Democracy is messy. I am the mess."'] }) },
    ],
  },
  {
    // too many brush-offs and she comes for you
    id: 'melora-recall',
    priority: true,
    cooldown: 48,
    when: (s) => !off(s) && s.t >= 12 && mel(s).snubs >= 3 && mel(s).steam >= 72,
    title: 'Melora Wants You Gone',
    text: (s) => `After ${mel(s).snubs} brush-offs, Melora has launched a campaign to have the Council remove the City Manager: lawn signs, a website, and a petition at the Farmers' Market. ${s.approval >= 55 ? 'Most residents are happy enough with how things are going.' : 'With approval where it is, some councilors are listening.'}`,
    choices: [
      { label: 'Apologize and do a listening tour', fx: '−$50K · she stands down · Business ↓', run: (s) => { bump(s, -50); s.mel.snubs = 0; s.apply({ funds: -50e3, approval: { homeowners: 2, seniors: 2, business: -2 }, news: ['City Manager launches listening tour', 'Eleven neighborhood meetings in six weeks. Melora attends all eleven. She asks a question at each, the same one.'] }); } },
      { label: 'Ride it out', fx: (s) => `free · ${s.approval >= 55 ? 'likely fizzles' : 'risky: a Council censure would hurt'} (${Math.round(rideOdds(s) * 100)}% it fizzles)`, run: (s) => {
        s.mel.snubs = 1;
        if (s.rand() < rideOdds(s)) { bump(s, -10); s.apply({ approval: { homeowners: -1 }, news: ['Campaign against City Manager fizzles', 'The lawn signs come down by Thanksgiving. Melora says she is "pacing herself."'] }); }
        else { bump(s, -25); s.apply({ funds: -200e3, approval: { homeowners: -4, seniors: -3, renters: -2, business: -2, commuters: -2 }, news: ['Council censures the City Manager', 'Not a firing, but close: an outside review of "communication practices," at the City’s expense. Melora watches from the front row.', 'big'] }); }
      } },
      { label: 'Give her the development pause', fx: 'no new projects for a year · she declares victory', run: (s) => { mel(s).pauseUntil = s.t + 12; mel(s).wins++; s.mel.snubs = 0; bump(s, -45); s.hype = Math.min(0.8, (s.hype || 0) + 0.12); s.apply({ demand: { R: -0.25, C: -0.12 }, approval: { homeowners: 3, renters: -5, business: -4 }, news: ['City Manager agrees to a development pause', 'Melora drops the campaign. Rents, as usual, do not pause.', 'big'] }); } },
    ],
  },
];
const rideOdds = (s) => clamp(0.3 + (s.approval - 40) / 40, 0.15, 0.9);

// follow-up used by the petition's "thank her" branch (registered in events.js FOLLOWUPS)
export function meloraRecords(s) {
  const m = mel(s);
  const pf = s.priceF ? s.priceF() : 1;
  const cost = (90e3 + 1500 * m.steam) * pf;
  m.cost += cost;
  m.binder++;
  s.apply({ funds: -cost / pf, news: [`Records request #${m.binder} arrives`, `Melora has asked for "all communications containing the word 'density' since 2019." Staff estimate ${fmtMoney(cost)} in overtime. She is within her rights.`] });
  react(s, 'melora-ambient', {}, null, 1);
}
