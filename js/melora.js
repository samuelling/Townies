// Melora: the town's most dedicated public commenter. She means well (she reads every filing and
// sometimes catches something real), but her interventions mostly delay things, cost money, and
// leave lots empty while rents climb. Her "steam" (0–100) rises with development and with being
// brushed off, falls when she wins or feels heard, and drives how often she shows up.
// An archetype, not a portrait: fictional, and not based on any one person.
import { clamp, fmtMoney } from './util.js';
import { react } from './comments.js';

export function mel(sim) {
  if (!sim.mel) sim.mel = { steam: 35, wins: 0, delays: 0, cost: 0, walked: 0, points: 0, warden: false, pauseUntil: -1, aftermath: [], binder: 47 };
  return sim.mel;
}
export const steamLabel = (v) => (v >= 80 ? 'On the warpath' : v >= 60 ? 'Fired up' : v >= 40 ? 'Simmering' : v >= 20 ? 'Keeping an eye on things' : 'Gardening');
const bump = (sim, d) => { const m = mel(sim); m.steam = clamp(m.steam + d, 0, 100); };

const PREFS = { mega: 1.3, lab: 1.4, housing: 1.15, infill: 0.75, plaza: 0.25 };

// called when a project is filed
export function meloraOnSubmit(sim, p) {
  bump(sim, p.prog === 'plaza' ? -3 : p.prog === 'infill' ? 4 : 9);
}

// Before the Planning Board votes. Returns true if she got the hearing continued (no vote this month).
export function meloraAtHearing(sim, p) {
  if (sim.flags && sim.flags.noMelora) return false;
  const m = mel(sim);
  const show = clamp((0.25 + 0.6 * (m.steam / 100)) * (PREFS[p.prog] || 1) * (m.warden ? 1.2 : 1), 0, 0.95);
  if (sim.rand() > show) return false;
  const pf = sim.priceF ? sim.priceF() : 1;
  if (!p.melDelayed && sim.rand() < 0.5) {
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
  const penalty = (0.04 + 0.08 * (m.steam / 100)) * (m.warden ? 0.7 : 1);
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

// after the vote
export function meloraAfterVote(sim, p, approved) {
  if (!mel(sim)) return;
  if (approved) bump(sim, p.prog === 'plaza' ? -5 : 10);
  else if (p.melPenalty || p.melDelayed) {
    const m = mel(sim);
    m.wins++;
    bump(sim, -15);
    react(sim, 'melora-win', { name: p.name }, null, 1);
    aftermath(sim, p);
  }
}

// a year later, the lot is still what it was, and the rents nearby are higher
function aftermath(sim, p) {
  mel(sim).aftermath.push({ at: sim.t + 12, name: p.name, cx: p.cx, cy: p.cy, homes: p.o.homes || 0 });
}

export function meloraMonthly(sim) {
  const m = mel(sim);
  // drifts back toward a baseline simmer; active projects keep her busy
  const hearings = (sim.projects || []).filter((p) => p.stage === 'hearing').length;
  const building = (sim.projects || []).filter((p) => p.stage === 'build').length;
  m.steam = clamp(m.steam + (32 - m.steam) * 0.05 + hearings * 0.8 + building * 0.15, 0, 100);
  for (const a of m.aftermath.filter((x) => x.at <= sim.t)) {
    sim.lvNear({ at: [a.cx, a.cy], r: 16, amt: 0.015 });
    sim.hype = Math.min(0.8, (sim.hype || 0) + 0.01);
    const item = sim.news(`A year after ${a.name} died, the site is unchanged`, `${a.homes ? `The ${a.homes} homes went to a town that said yes. ` : ''}Asking rents within a few blocks are up again. Melora calls the outcome "a win for the neighborhood."`);
    react(sim, 'melora-aftermath', {}, item, 2);
  }
  m.aftermath = m.aftermath.filter((x) => x.at > sim.t);
  // she posts. A lot.
  if (sim.rand() < 0.12 + m.steam / 400) react(sim, 'melora-ambient', {}, null, 1);
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
    id: 'melora-petition',
    cooldown: 30,
    when: (s) => s.t >= 6 && mel(s).steam >= 58 && !pauseActive(s),
    title: 'Melora’s Petition to “Pause and Reflect”',
    text: (s) => `Melora has collected ${400 + Math.round(mel(s).steam * 6)} signatures (she knocked on every door on her street twice) for a 12-month pause on all new development "until we understand the cumulative impacts." She is at every meeting, in every comment thread, and on the local access channel. She sincerely believes she is saving the town.`,
    choices: [
      { label: 'Sit down with her and listen', fx: '−$40K · she cools off · nothing pauses', run: (s) => { bump(s, -35); s.apply({ funds: -40e3, approval: { homeowners: 1, seniors: 1 }, news: ['City Manager meets Melora for coffee', 'Three hours, two refills, one 47-page binder. She leaves feeling heard, for now.'] }); } },
      { label: 'Adopt the 12-month pause', fx: 'no new projects for a year · rents ↑ · Homeowners ↑ · Renters ↓', run: (s) => { mel(s).pauseUntil = s.t + 12; mel(s).wins++; bump(s, -30); s.hype = Math.min(0.8, (s.hype || 0) + 0.12); s.apply({ demand: { R: -0.25, C: -0.12 }, approval: { homeowners: 4, seniors: 2, renters: -5, business: -4 }, news: ['Council adopts development pause', 'Melora thanks "everyone who showed up." Landlords quietly raise asking rents on everything already built.', 'big'] }); } },
      { label: 'Thank her for her input', fx: 'free · she escalates', run: (s) => { bump(s, 22); s.apply({ approval: { homeowners: -2 }, later: { months: 3, id: 'melora-records' }, news: ['Council receives petition, takes no action', 'Melora announces she will "be filing some records requests."'] }); } },
    ],
  },
  {
    id: 'melora-tree',
    cooldown: 36,
    when: (s) => s.t >= 8 && mel(s).steam >= 40 && (s.projects || []).some((p) => p.stage === 'build' && p.prog !== 'plaza'),
    prep: (s) => { const p = (s.projects || []).find((q) => q.stage === 'build' && q.prog !== 'plaza'); return p ? { p, cx: p.cx, cy: p.cy, id: p.ids[0] } : null; },
    title: 'Melora and the Sycamore',
    text: (s, { p }) => `Melora has discovered a 90-year-old sycamore at the edge of the ${p.name} site, and she has a point: it is a lovely tree. She has also organized a vigil, a GoFundMe for an arborist, and a 24-hour "tree watch" rota. Construction crews are standing around.`,
    choices: [
      { label: 'Redesign around the tree', fx: '4-month delay · the block gets a little nicer', run: (s, { p }) => { p.at += 4; s.lvNear({ at: [p.cx, p.cy], r: 8, amt: 0.02 }); mel(s).points++; bump(s, -15); s.apply({ approval: { homeowners: 2, business: -1 }, news: ['The sycamore stays', 'Architects redraw the corner. The tree is, admittedly, beautiful.'] }); } },
      { label: 'Proceed as approved', fx: 'on schedule · Homeowners ↓ · she escalates', run: (s) => { bump(s, 18); s.apply({ approval: { homeowners: -3, seniors: -1 }, news: ['Sycamore comes down at 7 a.m.', 'Melora livestreams it. The video has more views than the last three Council meetings combined.'] }); } },
      { label: 'Appoint her honorary Tree Warden', fx: '−$15K/yr · she calms down · reviews every future permit', run: (s) => { mel(s).warden = true; bump(s, -40); s.apply({ recurring: { key: 'melora-warden', label: 'Tree Warden stipend', monthly: 1250 }, approval: { homeowners: 1 }, news: ['Melora named Tree Warden', 'She accepts with a 20-minute speech and a new laminated badge. Every permit now crosses her desk.'] }); } },
    ],
  },
  {
    id: 'melora-parking',
    cooldown: 40,
    when: (s) => s.t >= 10 && mel(s).steam >= 45 && (s.flags.bikeLane || (s.tech && s.tech.stance.ebike === 'embrace') || s.flags.squarePlan === 'build'),
    title: 'Melora Counts the Cars',
    text: () => 'Melora spent a week on a folding chair counting parked cars on Main Street (her total: 1,138, "conservatively") and has concluded that the new street design will "destroy small business." The shop owners she quotes are mostly the ones who already closed. Some of her numbers are even right.',
    choices: [
      { label: 'Commission a real parking study', fx: '−$60K · settles it · she disputes the methodology', run: (s) => s.apply({ funds: -60e3, news: ['Parking study finds plenty of spaces', 'Average occupancy: 61%. Melora questions why the counts were done "on a Tuesday."'] }) },
      { label: 'Restore the parking', fx: 'Homeowners ↑ · Renters ↓ · street life ↓', run: (s) => { mel(s).wins++; bump(s, -20); s.capNear({ at: 'square', r: 14, amt: 0.03 }); s.lvNear({ at: 'square', r: 16, amt: -0.02 }); s.apply({ approval: { homeowners: 2, seniors: 2, renters: -3 }, news: ['Parking returns to Main Street', 'Melora declares victory. The bike lane becomes a loading zone, then a parking space again.'] }); } },
      { label: 'Ignore it', fx: 'free · she escalates', run: (s) => { bump(s, 15); s.apply({ approval: { homeowners: -1 } }); } },
    ],
  },
];

// follow-up used by the petition's "thank her" branch (registered in events.js FOLLOWUPS)
export function meloraRecords(s) {
  const m = mel(s);
  const pf = s.priceF ? s.priceF() : 1;
  const cost = (90e3 + 1500 * m.steam) * pf;
  m.cost += cost;
  s.apply({ funds: -cost / pf, news: [`Records request #${m.binder} arrives`, `Melora has asked for "all communications containing the word 'density' since 2019." Staff estimate ${fmtMoney(cost)} in overtime. She is within her rights.`] });
  react(s, 'melora-ambient', {}, null, 1);
}
