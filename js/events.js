// Council agenda: scenarios inspired by recurring storylines in Watertown local news.
// All text is original, paraphrased, and fictionalised; no private individuals are named.
import { ZONE } from './config.js';
import { fmtMoney } from './util.js';
import { FACTIONS } from './sim.js';

const near = (s, lot, at, r) => {
  const [x, y] = s.anchor(at);
  return Math.hypot(lot.cx - x, lot.cy - y) < r;
};
const hasRNear = (s, lot, r) => {
  for (const o of s.w.lots) if (!o.dead && o.zone === ZONE.R && o.dens <= 2 && Math.hypot(o.cx - lot.cx, o.cy - lot.cy) < r) return true;
  return false;
};
const labCount = (s) => s.w.lots.filter((l) => !l.dead && l.inTown && l.zone === ZONE.I && l.dens >= 3).length;

export const SCENARIOS = [
  {
    id: 'square-plan',
    when: (s) => s.t >= 2,
    title: 'Four Corners, or Fewer Lanes?',
    text: () =>
      'Engineers have finished drawing the Square redesign that pulls one road out of the five-way intersection, turns acres of asphalt into lawn and plaza, and adds protected bike lanes. There is no construction money yet. Commuters are convinced it will choke Main Street at rush hour (a third of the cars just want the Pike). Supporters say wider roads only fill up, and a downtown people want to linger in is the point.',
    choices: [
      { label: 'Build Four Corners', fx: '$30M bond · 2 yrs of construction · Square land value ↑ · Commuters ↓', run: (s) => s.apply({ bond: { amount: 30e6, label: 'Square redesign' }, capNear: { at: 'square', r: 14, amt: -0.2 }, approval: { business: -4, commuters: -6, renters: 4 }, later: { months: 24, id: 'square-done' }, flag: { squarePlan: 'build' }, news: ['Square redesign breaks ground', 'Orange barrels bloom across downtown. Detours expected through 2029.', 'big'] }) },
      { label: 'Just retime the signals', fx: '−$1.2M · small traffic gain', run: (s) => s.apply({ funds: -1.2e6, capNear: { at: 'square', r: 14, amt: 0.06 }, approval: { commuters: 3, renters: -2 }, news: ['Square gets new signal timing', 'Drivers report it feels about 4% better. Pedestrians report the walk signal is still short.'] }) },
      { label: 'Shelve it for now', fx: 'free · "study fatigue"', run: (s) => s.apply({ approval: { renters: -4, business: -2 }, flag: { studyFatigue: 1 }, news: ['Square plan heads back to the shelf', 'Residents note it is the third plan to visit that shelf.'] }) },
    ],
  },
  {
    id: 'square-garage',
    when: (s) => s.t >= 5,
    title: 'Should Cars Get Stairs?',
    text: () =>
      'The City Manager’s office has a public-private proposal for the municipal lot behind the drugstore: a 4–5 story parking garage, an apartment building, and a small park. Groundwater rules out building underground, so the garage would replace a small block that houses a long-running family restaurant, a salon and a laundromat. Some residents want quick errands on a surface lot, some want more parking for snow emergencies, and others want green space, not "another Malden."',
    choices: [
      { label: 'Garage + housing partnership', fx: '−$4M · new apartments · Seniors ↑ · Business ↓', run: (s) => {
        const lot = s.findLot((l) => l.zone === ZONE.C || l.zone === ZONE.R, 'square', 18);
        if (lot) s.develop(lot, 4, ZONE.R);
        s.apply({ funds: -4e6, approval: { seniors: 4, commuters: 2, business: -3, renters: 2 }, lvNear: { at: 'square', r: 20, amt: 0.04 }, news: ['Garage-and-housing deal approved', 'A beloved little block will be replaced. A commenter starts a petition to save the laundromat’s sign.'] });
      } },
      { label: 'Garage only', fx: '$14M bond · Seniors ↑ · Renters ↓', run: (s) => s.apply({ bond: { amount: 14e6, label: 'Square garage' }, approval: { seniors: 6, commuters: 3, renters: -3 }, capNear: { at: 'square', r: 10, amt: -0.04 }, news: ['City will build a garage', 'Cars to get stairs. People, for now, do not get homes.'] }) },
      { label: 'Streetscape only', fx: '−$1.5M · charm preserved', run: (s) => s.apply({ funds: -1.5e6, lvNear: { at: 'square', r: 18, amt: 0.03 }, approval: { seniors: -3, homeowners: 2 }, news: ['Square gets benches, bulbs and new trees', 'The surface lot survives. So does the laundromat.'] }) },
    ],
  },
  {
    id: 'by-right-box',
    when: (s) => s.t >= 9 && s.demand.R > 0.2,
    prep: (s) => s.findLot((l) => l.dense && l.zone === ZONE.R && l.dens <= 2 && l.tiles.length >= 2, 'square', 40),
    title: 'The Box',
    text: (s, lot) =>
      `A developer has filed a six-story, 40-unit building ${lot.addr ? 'at ' + lot.addr : 'near the Square'} under the new by-right zoning, with half as many parking spaces as units. Neighbors are happy the eyesore lot will finally be filled, and unhappy that the design is, in a word, rectangular. Under by-right rules you can't say no, but you can push.`,
    choices: [
      { label: 'Push for a design upgrade', fx: 'delay · Homeowners ↑ · nicer building', run: (s, lot) => s.apply({ approval: { homeowners: 3 }, later: { months: 3, id: 'build-lot', data: { lot: lot.id, dens: 4, zone: ZONE.R } }, news: ['Developer agrees to add a courtyard', 'The building will still be rectangular, but with plants.'] }) },
      { label: 'Approve as filed', fx: 'fast housing · Renters ↑ · Homeowners ↓', run: (s, lot) => { s.develop(lot, 4, ZONE.R); s.apply({ approval: { renters: 3, homeowners: -2 }, news: ['By-right building approved as filed', 'Neighbors describe it as "rectangular."'] }); } },
      { label: 'Offer a façade grant', fx: '−$250K · everyone mostly fine', run: (s, lot) => { s.develop(lot, 4, ZONE.R); s.apply({ funds: -250e3, approval: { homeowners: 1, renters: 2 }, news: ['City chips in for brick', 'The façade grant buys a cornice and a lot of goodwill.'] }); } },
    ],
  },
  {
    id: 'lab-next-door',
    when: (s) => s.t >= 3 && s.demand.I > 0.15,
    prep: (s) => s.findLot((l) => (l.zone === ZONE.I || l.zone === ZONE.C) && l.dens <= 2 && l.tiles.length >= 3 && hasRNear(s, l, 6)),
    cooldown: 30,
    title: 'A Lab Next Door',
    text: (s, lot) =>
      `A life-science developer wants to replace ${lot.useDesc ? 'the ' + lot.useDesc.toLowerCase() : 'an old building'}${lot.addr ? ' at ' + lot.addr : ''} with a lab, right up against a street of two-families. It would pay a fortune in commercial taxes. Neighbors point out the town already has dozens of lab buildings in four square miles, and some of them are half empty.`,
    choices: [
      { label: 'Approve the lab', fx: 'big tax base ↑ · traffic ↑ · Homeowners ↓', run: (s, lot) => { s.develop(lot, 4, ZONE.I); s.apply({ approval: { homeowners: -5, business: 3 }, lvNear: { at: [lot.cx, lot.cy], r: 8, amt: -0.04 }, flag: { labs: (s.flags.labs || 0) + 1 }, news: ['Lab approved', 'The town achieves record pipette density.'] }); } },
      { label: 'Require mixed use', fx: 'apartments instead · Renters ↑', run: (s, lot) => { lot.dense = true; s.develop(lot, 3, ZONE.R); s.apply({ approval: { renters: 3, homeowners: 1 }, news: ['Lab becomes apartments with a café', 'The developer grumbles, then pivots.'] }); } },
      { label: 'Reject it', fx: 'Homeowners ↑ · Business ↓ · lab demand ↓', run: (s) => s.apply({ approval: { homeowners: 4, business: -3 }, demand: { I: -0.1 }, news: ['Council rejects lab next to homes', 'Neighbors celebrate with a block party. The developer files elsewhere.'] }) },
    ],
  },
  {
    id: 'lab-bust',
    when: (s) => s.t >= 14 && (s.demand.I < -0.15 || (s.flags.labs || 0) >= 2),
    cooldown: 40,
    title: 'Tenant Search Enters Third Year',
    text: () =>
      'The life-science boom has cooled. Brand-new lab buildings sit with "available" banners, and a well-known landlord just sold a huge site at a steep loss. Empty labs still pay taxes for now, but owners are appealing their assessments.',
    run: (s) => { for (const l of s.w.lots) if (!l.dead && l.zone === ZONE.I && l.dens >= 3) l.occ *= 0.7; },
    choices: [
      { label: 'Offer tax incentives', fx: '−$150K/mo for 2 yrs · lab demand ↑', run: (s) => s.apply({ recurring: { key: 'labinc', label: 'Lab tenant incentives', monthly: 150e3, months: 24 }, demand: { I: 0.18 }, approval: { homeowners: -2, business: 2 } }) },
      { label: 'Let empty labs become housing', fx: 'some labs → apartments · Renters ↑', run: (s) => {
        let n = 0;
        for (const l of s.w.lots) if (!l.dead && l.inTown && l.zone === ZONE.I && l.dens >= 3 && l.occ < 0.6 && n < 3) { l.zone = ZONE.R; l.dense = true; n++; }
        s.apply({ approval: { renters: 4, business: -2 }, demand: { R: 0.05 }, news: ['Empty labs may become apartments', `${n} lab sites rezoned. Converting fume hoods to kitchens is "complicated," says one architect.`] });
      } },
      { label: 'Ride it out', fx: 'free · the cycle turns, eventually', run: (s) => s.apply({ news: ['City will wait out lab slump', 'Officials note the industry is "cyclical." Commenters note the vacancy rate.'] }) },
    ],
  },
  {
    id: 'mall-cancel',
    when: (s) => s.t >= 11 && s.demand.I < 0.2,
    prep: (s) => { let best = null; for (const l of s.w.lots) if (!l.dead && l.inTown && l.zone === ZONE.C && (!best || l.area > best.area)) best = l; return best; },
    title: 'Mall Remains Mall',
    text: (s, lot) =>
      `The owner of the big East End shopping center${lot.addr ? ' (' + lot.addr + ')' : ''} has dropped plans for a giant lab campus and sold the site for millions less than it paid. The new owner says it will stay retail. Some residents mourn the green spaces that were promised; others are relieved the big-box store isn't going anywhere.`,
    choices: [
      { label: 'Offer an incentive to revive it', fx: '−$8M · lab demand ↑', run: (s) => s.apply({ funds: -8e6, demand: { I: 0.15 }, approval: { homeowners: -3 }, news: ['City dangles incentive for East End campus', 'Developers say they will "take a look." Nobody holds their breath.'] }) },
      { label: 'Let it go', fx: 'free · shoppers content', run: (s) => s.apply({ approval: { homeowners: 2, seniors: 2 }, news: ['Mall remains mall', 'Shoppers report feeling fine about it.'] }) },
      { label: 'Rezone it for housing', fx: 'big site → dense residential · Renters ↑', run: (s, lot) => { lot.zone = ZONE.R; lot.dense = true; s.apply({ approval: { renters: 5, business: -3 }, news: ['Mall site rezoned for homes', 'Thousands of future neighbors, eventually.'] }); } },
    ],
  },
  {
    id: 'bsl3',
    when: (s) => s.t >= 16 && labCount(s) >= 3,
    title: 'What Exactly Happens in There?',
    text: () =>
      'A resident op-ed series argues the volunteer biosafety committee can’t really check what dozens of labs are doing, and calls for a ban on higher-hazard (BSL-3) labs. Critics call it alarmist and point out none operate in town today. The Board of Health wants direction.',
    choices: [
      { label: 'Hire lab inspectors', fx: '−$35K/mo · Seniors ↑ · slight lab chill', run: (s) => s.apply({ recurring: { key: 'labinsp', label: 'Biosafety inspectors', monthly: 35e3 }, approval: { seniors: 3, homeowners: 2 }, demand: { I: -0.03 } }) },
      { label: 'Ban BSL-3 labs', fx: 'lab demand ↓ · Homeowners ↑ · Business ↓', run: (s) => s.apply({ flag: { bsl3Ban: 1 }, approval: { homeowners: 5, business: -4 }, news: ['Council bans highest-hazard labs', 'Committee assures residents the remaining labs are "probably doing what they say."'] }) },
      { label: 'Keep the current process', fx: 'free · small risk of a scare', run: (s) => s.apply({ flag: { labRisk: 1 }, approval: { homeowners: -2 } }) },
    ],
  },
  {
    id: 'cap',
    when: (s) => s.rates().capped,
    cooldown: 36,
    title: 'The Classification Cliff',
    text: (s) =>
      `Commercial property has grown so fast that an obscure state formula caps how much of the tax levy you can shift onto businesses (currently ${(s.capShare * 100).toFixed(0)}%). The excess lands on homeowners next year. Last time this happened, it took a home-rule petition and a unanimous House vote to fix.`,
    choices: [
      { label: 'Lobby the State House', fx: '−$150K · fix in ~2.5 yrs (maybe)', run: (s) => s.apply({ funds: -150e3, later: { months: 30, id: 'cap-lobby' }, news: ['City files home-rule petition', 'Local legislators promise to shepherd it through. Bring snacks.'] }) },
      { label: 'Accept the shift', fx: 'Homeowners ↓↓', run: (s) => s.apply({ approval: { homeowners: -8, seniors: -4 }, news: ['Homeowners brace for bigger bills', 'An arcane formula briefly becomes the most hated thing in town.'] }) },
      { label: 'Cut department budgets 5%', fx: 'services ↓ · Seniors ↓', run: (s) => s.apply({ fund: { schools: -0.05, police: -0.05, fire: -0.05, roads: -0.05, parks: -0.05 }, approval: { seniors: -3, homeowners: 1 } }) },
    ],
  },
  {
    id: 'tax-night',
    when: (s) => s.m === 10,
    cooldown: 11,
    title: 'Tax Classification Hearing',
    text: (s) => {
      const r = s.rates();
      return `It's November, which means the Council sets the tax rate. Under the current settings the residential rate is $${r.rateR.toFixed(2)} and the commercial rate is $${r.rateC.toFixed(2)} per $1,000. You can adjust the levy, the commercial shift, and the residential exemption (owner-occupants only) in the Budget.`;
    },
    choices: [
      { label: 'Open the budget', fx: 'review rates', run: (s) => s.hooks.openBudget && s.hooks.openBudget() },
      { label: 'Keep the current rates', fx: '', run: () => {} },
    ],
  },
  {
    id: 'road-diet',
    when: (s) => s.t >= 7 && s.hasRoad('Mount Auburn'),
    title: 'Mt. Auburn Street Goes on a Diet',
    text: () =>
      'Mt. Auburn Street east of Common Street has a crash problem. The design on the table cuts four travel lanes to two, adds buffered bike lanes, crossing beacons and a granite seat wall at Coolidge Square. Opponents warn of side-street backups and slower ambulances. Parents who bike their kids to school are cautiously thrilled.',
    choices: [
      { label: 'Road diet', fx: 'Mt. Auburn capacity ↓ · land value ↑ · Commuters ↓', run: (s) => s.apply({ capNear: { road: 'Mount Auburn', amt: -0.25 }, lvNear: { road: 'Mount Auburn', amt: 0.06 }, approval: { commuters: -6, renters: 3, seniors: -2 }, later: { months: 4, id: 'construction-biz' }, news: ['Mt. Auburn Street loses weight, gains benches', 'Construction to last several years. Businesses ask who to call.', 'big'] }) },
      { label: 'Signals only', fx: '−$600K', run: (s) => s.apply({ funds: -600e3, capNear: { road: 'Mount Auburn', amt: 0.04 }, approval: { commuters: 1, renters: -2 } }) },
      { label: 'Peak-hour bus lanes', fx: '−$900K · Renters ↑ · Commuters ↓', run: (s) => s.apply({ funds: -900e3, capNear: { road: 'Mount Auburn', amt: -0.1 }, approval: { renters: 4, commuters: -3 } }) },
    ],
  },
  {
    id: 'rats',
    when: (s) => s.t >= 6 && (s.devCount || 0) >= 6,
    cooldown: 36,
    title: 'The Rat Years',
    text: () =>
      'Big construction projects have stirred up the neighborhood rats. Residents along the work zones are buying their own bait boxes and are not happy about it. Public Health has three options, one of which involves pumpkins.',
    choices: [
      { label: 'Smart traps on the corridors', fx: '−$15K/mo for 2 yrs · no harm to hawks', run: (s) => s.apply({ recurring: { key: 'rats', label: 'Smart rat traps', monthly: 15e3, months: 24 }, approval: { homeowners: 2, seniors: 1 } }) },
      { label: 'Cheap poison bait', fx: '−$50K · local owls unimpressed', run: (s) => s.apply({ funds: -50e3, approval: { homeowners: 1, renters: -1 }, news: ['City lays poison bait', 'Birdwatchers report fewer hawks. Rats report fewer rats.'] }) },
      { label: 'Ask residents to bring pumpkins inside', fx: 'free · regional TV notices', run: (s) => s.apply({ approval: { all: -1 }, news: ['Jack-o’-lanterns asked to shelter indoors', 'Boston TV crews arrive. The rats decline interviews.', 'big'] }) },
    ],
  },
  {
    id: 'blizzard',
    when: (s) => (s.m === 0 || s.m === 1) && s.rand() < 0.35,
    cooldown: 10,
    title: 'Nineteen Inches',
    text: () =>
      'A nor’easter buried the city overnight. Public Works has been plowing for 40 hours straight and is now hauling snowbanks away by truck. Sidewalks are a mess, and the new sidewalk-shoveling rule is about to get its first real test.',
    run: (s) => { s.apply({ funds: s.flags.noParkingBan ? -2.4e6 : -1.2e6 }); s.storm(s.flags.noParkingBan ? 26 : 18); },
    choices: [
      { label: 'Fine people who don’t shovel', fx: '+$80K · Seniors ↓ · walkable sidewalks', run: (s) => s.apply({ funds: 80e3, approval: { seniors: -5, renters: 1, commuters: 2 } }) },
      { label: 'Fund a volunteer shovel corps', fx: '−$120K · Seniors ↑', run: (s) => s.apply({ funds: -120e3, approval: { seniors: 5, homeowners: 1 } }) },
      { label: 'Warnings only', fx: 'free · icy sidewalks', run: (s) => s.apply({ approval: { commuters: -2, seniors: -1 }, news: ['Plow leaves thoughtful four-foot gift at every driveway', ''] }) },
    ],
  },
  {
    id: 'parking-ban',
    when: (s) => s.m === 11 && s.t >= 10,
    title: 'The Overnight Parking Ban',
    text: () =>
      'From January to April, no car may stay on a city street between 1 and 6 a.m. It makes plowing possible, and it sends renters without driveways on a nightly migration to school lots. A councilor wants to revisit it.',
    choices: [
      { label: 'Keep the ban', fx: 'Renters ↓ · plowing stays efficient', run: (s) => s.apply({ approval: { renters: -2 } }) },
      { label: 'Sell overnight permits', fx: '+$20K/mo · Renters ↑', run: (s) => s.apply({ recurring: { key: 'permits', label: 'Overnight parking permits', monthly: -20e3 }, approval: { renters: 3 } }) },
      { label: 'Lift the ban', fx: 'Renters ↑↑ · snow cleanup costs double', run: (s) => s.apply({ flag: { noParkingBan: 1 }, approval: { renters: 5, commuters: -3 } }) },
    ],
  },
  {
    id: 'str',
    when: (s) => s.t >= 18,
    title: 'Hotel Houses',
    text: () =>
      'Short-term rentals under 31 days are banned, and code enforcement has started mailing polite letters to suspected hosts. Some residents worry about investors turning houses into de facto hotels. Some seniors want to rent a spare room to afford staying in their homes.',
    choices: [
      { label: 'Keep the ban', fx: 'Renters ↑ · Business ↓', run: (s) => s.apply({ approval: { renters: 2, business: -1 } }) },
      { label: 'Owner-occupied only', fx: '+$15K/mo · Seniors ↑', run: (s) => s.apply({ recurring: { key: 'str', label: 'Short-term rental fees', monthly: -15e3 }, approval: { seniors: 4, homeowners: 2, renters: -1 } }) },
      { label: 'Allow them all', fx: '+$45K/mo · Renters ↓ · housing tighter', run: (s) => s.apply({ recurring: { key: 'str', label: 'Short-term rental fees', monthly: -45e3 }, approval: { renters: -5, homeowners: -2, business: 2 }, demand: { R: 0.06 } }) },
    ],
  },
  {
    id: 'victory-field',
    when: (s) => s.t >= 15,
    title: 'Turf vs. Grass at Victory Field',
    text: () =>
      'The high school field is worn out. Athletic staff want turf and lights for more practice hours; neighbors want grass; and someone has asked how many commemorative bricks were ever sold.',
    choices: [
      { label: 'New turf', fx: '−$1.6M · families ↑', run: (s) => s.apply({ funds: -1.6e6, approval: { homeowners: 2, renters: 1, seniors: -1 } }) },
      { label: 'Natural grass', fx: '−$0.9M · neighbors ↑', run: (s) => s.apply({ funds: -0.9e6, approval: { homeowners: 3 } }) },
      { label: 'Turf plus a field house', fx: '$6M bond · equity ↑', run: (s) => s.apply({ bond: { amount: 6e6, label: 'Field house' }, approval: { homeowners: 3, renters: 2 } }) },
    ],
  },
  {
    id: 'dam',
    when: (s) => s.t >= 19,
    title: 'Take Out the Dam?',
    text: () =>
      'The little dam near the Square has been there in one form or another since the 1630s, when it powered a grist mill. Herring advocates and climate planners want it gone; the state says it is in fair shape but would be a significant hazard if it ever failed.',
    choices: [
      { label: 'Lobby for removal', fx: '−$200K · riverfront ↑ in 3 yrs', run: (s) => s.apply({ funds: -200e3, later: { months: 36, id: 'dam-out' }, approval: { renters: 2, homeowners: 1 } }) },
      { label: 'Repair it', fx: '−$2.5M · status quo', run: (s) => s.apply({ funds: -2.5e6, approval: { seniors: 1 } }) },
      { label: 'Leave it alone', fx: 'free', run: () => {} },
    ],
  },
  {
    id: 'little-greenough',
    when: (s) => s.t >= 12 && s.m >= 3 && s.m <= 6 && s.hasRoad('Greenough'),
    title: 'Little Greenough Weekends',
    text: () =>
      'Hundreds of residents have petitioned to close the riverside stretch of Greenough Boulevard to cars on weekends, like Memorial Drive in Cambridge. Kids learn to bike there. Arsenal Yards traffic uses it too. The comments section has re-litigated old-timers vs. newcomers for 300 replies.',
    choices: [
      { label: 'Weekend closures', fx: 'riverfront ↑ · small traffic spillover', run: (s) => s.apply({ capNear: { road: 'Greenough', amt: -0.12 }, lvNear: { at: 'river', r: 40, amt: 0.03 }, approval: { renters: 3, homeowners: 1, commuters: -2 } }) },
      { label: 'Close it for good', fx: 'riverfront ↑↑ · Commuters ↓↓', run: (s) => s.apply({ capNear: { road: 'Greenough', amt: -0.6 }, lvNear: { at: 'river', r: 50, amt: 0.06 }, approval: { renters: 5, commuters: -7, business: -2 } }) },
      { label: 'Keep it open', fx: 'Commuters ↑', run: (s) => s.apply({ approval: { commuters: 2, renters: -3 } }) },
    ],
  },
  {
    id: 'post-office',
    when: (s) => s.t >= 4,
    title: 'Where Do We Mail Letters?',
    text: () =>
      'The Square’s post office closed for a redevelopment project "for at least two years," and the building is already gone. Residents without cars, and plenty of seniors, want it back. Others note there are branches nearby and blame the Postal Service, not City Hall.',
    choices: [
      { label: 'Offer space in a city building', fx: '−$7.5K/mo · Seniors ↑', run: (s) => s.apply({ recurring: { key: 'po', label: 'Post office space subsidy', monthly: 7.5e3 }, approval: { seniors: 5, homeowners: 1 } }) },
      { label: 'Write to Congress', fx: '−$20K · maybe, someday', run: (s) => s.apply({ funds: -20e3, later: { months: 18, id: 'po-maybe' } }) },
      { label: 'Accept it', fx: 'Seniors ↓', run: (s) => s.apply({ approval: { seniors: -3 }, news: ['Residents mail letter asking where to mail letters', ''] }) },
    ],
  },
  {
    id: 'restaurant',
    when: (s) => s.t >= 8 && s.rand() < 0.5,
    title: 'Last Plate Served',
    text: () =>
      'A beloved family restaurant in the Square is closing after decades, between the construction fences and the wait for new residents to move in upstairs. Regulars are devastated. The comment section is split between "if only they’d held on" and "redevelopment pushes out the little guy."',
    choices: [
      { label: 'Small-business bridge loans', fx: '−$300K · Business ↑', run: (s) => s.apply({ funds: -300e3, approval: { business: 4 }, demand: { C: 0.05 } }) },
      { label: 'Waive outdoor dining fees', fx: '−$8K/mo · Business ↑', run: (s) => s.apply({ recurring: { key: 'dining', label: 'Outdoor dining fee waiver', monthly: 8e3 }, approval: { business: 2, renters: 1 } }) },
      { label: 'Nothing to be done', fx: 'Business ↓', run: (s) => { const lot = s.findLot((l) => l.zone === ZONE.C && l.bldgs.length > 0, 'square', 25); if (lot) lot.occ = 0.2; s.apply({ approval: { business: -3, seniors: -1 } }); } },
    ],
  },
  {
    id: 'trees',
    when: (s) => s.t >= 21,
    title: 'Pine Departs After Decades of Service',
    text: () =>
      'New owners cut down a healthy 50-foot pine on their lot, and the call for a private-property tree ordinance is back. Shade and stormwater on one side; a homeowner’s right to sun for their tomato garden on the other. The tree warden has little say over private land.',
    choices: [
      { label: 'Tree ordinance', fx: 'growth slows ~15% · Homeowners split', run: (s) => s.apply({ flag: { treeOrdinance: 1 }, approval: { homeowners: 1, renters: 2, business: -2 } }) },
      { label: 'Street-tree planting program', fx: '−$500K · trees planted', run: (s) => {
        const w = s.w;
        let n = 0;
        const touched = [];
        for (let k = 0; k < 6000 && n < 400; k++) {
          const i = Math.floor(s.rand() * w.W * w.H);
          if (!w.inTown[i] || w.road[i] || w.terrain[i] === 1 || s.bAlive(i) || w.svcAt[i] >= 0 || w.tree[i]) continue;
          const x = i % w.W, y = (i / w.W) | 0;
          if (!(w.road[i - 1] || w.road[i + 1] || w.road[i - w.W] || w.road[i + w.W])) continue;
          w.tree[i] = 1; touched.push(i); n++; void x; void y;
        }
        s.hooks.invalidateTiles && s.hooks.invalidateTiles(touched);
        s.apply({ funds: -500e3, lvNear: { at: 'square', r: 200, amt: 0.01 }, approval: { homeowners: 2, renters: 2 }, news: ['Hundreds of street trees planted', 'Squirrels approve.'] });
      } },
      { label: 'Leave it to owners', fx: 'free', run: (s) => s.apply({ approval: { homeowners: -1 } }) },
    ],
  },
  {
    id: 'walker-pond',
    when: (s) => s.t >= 10,
    title: 'Pond Remains Pond Pending Further Study',
    text: () =>
      'The city spent over $11 million buying the land around a pond. Now there’s a fight over what it should become: winding paths and vernal pools, or ballfields. Residents balked at a year-long, $90,000 study that would produce only a concept plan.',
    choices: [
      { label: 'Passive nature park', fx: '−$600K · nearby land value ↑', run: (s) => s.apply({ funds: -600e3, lvNear: { at: 'square', r: 200, amt: 0.005 }, approval: { homeowners: 2, seniors: 2 } }) },
      { label: 'Active recreation', fx: '$4M bond · families ↑', run: (s) => s.apply({ bond: { amount: 4e6, label: 'Pond recreation' }, approval: { renters: 2, homeowners: 2, seniors: -1 } }) },
      { label: 'Commission the study', fx: '−$90K · nothing for a year', run: (s) => s.apply({ funds: -90e3, approval: { all: -1 }, news: ['Pond study begins', 'The pond is unaware.'] }) },
    ],
  },
  {
    id: 'lumberyard',
    when: (s) => s.t >= 15,
    prep: (s) => s.findLot((l) => l.zone === ZONE.I && l.dens <= 2 && l.tiles.length >= 4),
    title: 'A Lumberyard for Sale',
    text: (s, lot) =>
      `During the lab slump, a long-fought-over industrial site${lot.addr ? ' at ' + lot.addr : ''} is available through a "friendly taking." Ideas include affordable housing, a Public Works yard, or a senior center. Some say $9 million is a lot to pay and takes property off the tax rolls.`,
    choices: [
      { label: 'Buy it for affordable housing', fx: '−$9.2M · Renters ↑↑ · housing in 2 yrs', run: (s, lot) => s.apply({ funds: -9.2e6, approval: { renters: 6, homeowners: -2 }, later: { months: 24, id: 'build-lot', data: { lot: lot.id, dens: 4, zone: ZONE.R } }, news: ['City buys lumberyard', 'Then holds a meeting on what a lumberyard is for.'] }) },
      { label: 'Let the market decide', fx: 'free', run: () => {} },
      { label: 'Rezone it for housing', fx: 'Renters ↑ · Homeowners ↓', run: (s, lot) => { lot.zone = ZONE.R; lot.dense = true; s.apply({ approval: { renters: 3, homeowners: -2 } }); } },
    ],
  },
  {
    id: 'petition',
    when: (s) => s.t >= 12 && s.factions && s.factions.homeowners < 50,
    cooldown: 48,
    title: '600 Signatures',
    text: () =>
      'About 600 residents signed a petition to cut allowed building bulk downtown nearly in half and to strengthen buffers between homes and industrial zones. They say zoning gets amended whenever a developer asks. Planning staff say studies already underway will address it.',
    choices: [
      { label: 'Adopt the petition', fx: 'growth ↓ · Homeowners ↑↑', run: (s) => { for (const l of s.w.lots) if (l.dense && l.zone !== ZONE.I && s.rand() < 0.5) l.dense = false; s.apply({ approval: { homeowners: 7, renters: -4, business: -3 }, demand: { R: -0.1, C: -0.05 } }); } },
      { label: 'Fold it into the master plan', fx: 'neutral, delayed', run: (s) => s.apply({ approval: { homeowners: 1 } }) },
      { label: 'Reject it', fx: 'Homeowners ↓', run: (s) => s.apply({ approval: { homeowners: -5 }, news: ['600 signatures meet "no second"', ''] }) },
    ],
  },
  {
    id: 'school-vs-seniors',
    when: (s) => s.t >= 7,
    title: 'Seventh Graders or Seniors?',
    text: () =>
      'The middle school rebuild has climbed from $87M to about $112M. Parts of the building are a century old. The finance office warns the borrowing could push back a new Senior Center and work in the Square, especially with lab tax growth slowing.',
    choices: [
      { label: 'Build the middle school', fx: '$112M project, ~$67M bond after state share · Seniors ↓', run: (s) => s.apply({ bond: { amount: 67e6, label: 'Middle school', years: 25 }, lvNear: { at: 'square', r: 400, amt: 0.03 }, approval: { homeowners: 4, renters: 2, seniors: -4 }, demand: { R: 0.05 } }) },
      { label: 'Build the senior center first', fx: '$25M bond · Seniors ↑↑', run: (s) => s.apply({ bond: { amount: 25e6, label: 'Senior center' }, approval: { seniors: 8, homeowners: -2 } }) },
      { label: 'Cheap repairs', fx: '−$8M now · may trigger accessibility costs', run: (s) => s.apply({ funds: -8e6, later: { months: 14, id: 'ada' }, approval: { homeowners: -1 } }) },
    ],
  },
  {
    id: 'shuttle',
    when: (s) => s.t >= 10 && s.congAvg > (s.base.cong0 || 0) + 0.05,
    title: 'The Town With No Subway',
    text: () =>
      'Bus 70 just won an advocacy group’s award for slowest bus. A $1 developer-funded shuttle to Harvard Square carries about 700 riders a month; a second route on Arsenal Street is ready to open. Riders want shelters and stops near daycare. Drivers want everyone else on the bus.',
    choices: [
      { label: 'Expand the shuttles', fx: '−$10K/mo · Commuters ↑', run: (s) => s.apply({ recurring: { key: 'shuttle', label: 'Shuttle subsidy', monthly: 10e3 }, approval: { commuters: 2, renters: 2 }, capNear: { at: 'square', r: 400, amt: 0.03 } }) },
      { label: 'Bus lanes on Arsenal St', fx: 'Arsenal capacity ↓ · Renters ↑', run: (s) => s.apply({ funds: -500e3, capNear: { road: 'Arsenal', amt: -0.12 }, lvNear: { road: 'Arsenal', amt: 0.04 }, approval: { renters: 4, commuters: -1 } }) },
      { label: 'Do nothing', fx: 'free', run: (s) => s.apply({ approval: { commuters: -2 } }) },
    ],
  },
  {
    id: 'bike-lane',
    when: (s) => s.t >= 13,
    title: '22 Parking Spaces Hold Vigil',
    text: () =>
      'Uphill bike lanes on a street leading to the schools and Victory Field would cost about 22 on-street parking spaces, including a few in front of an optometrist. "Nobody uses bike lanes," say some. "That’s because there aren’t any," say others.',
    choices: [
      { label: 'Paint the bike lanes', fx: '−$80K · Renters ↑ · Business ↓', run: (s) => s.apply({ funds: -80e3, approval: { renters: 3, homeowners: 1, business: -2 } }) },
      { label: 'Shared-lane arrows only', fx: '−$30K', run: (s) => s.apply({ funds: -30e3, approval: { renters: -1 } }) },
    ],
  },
  {
    id: 'coyotes',
    when: (s) => s.t >= 8 && s.rand() < 0.2,
    title: 'Coyotes in the East End',
    text: () => 'A pack of coyotes attacked dogs on a late-night walk near the bike path. Animal control has issued warnings. Commenters debate whether 11 p.m. on a dark path was wise.',
    choices: [
      { label: 'Fund animal control', fx: '−$60K', run: (s) => s.apply({ funds: -60e3, approval: { homeowners: 2, seniors: 1 } }) },
      { label: 'Light the Community Path', fx: '−$350K · Renters ↑', run: (s) => s.apply({ funds: -350e3, approval: { renters: 3, homeowners: 2 } }) },
      { label: 'Public advisory', fx: 'free', run: (s) => s.apply({ news: ['Coyote seen using Community Path as intended', ''] }) },
    ],
  },
  {
    id: 'pickleball',
    when: (s) => s.t >= 11,
    title: 'Pickleball Comes to the Park',
    text: () => 'Recreation wants permanent pickleball courts at a neighborhood park, three years ahead of schedule. Players are thrilled. Neighbors have heard the noise, which they compare to "a woodpecker with a grudge."',
    choices: [
      { label: 'Build the courts', fx: '−$400K · Seniors ↑ · neighbors grumble', run: (s) => s.apply({ funds: -400e3, approval: { seniors: 4, homeowners: -1 } }) },
      { label: 'Keep the tennis courts', fx: 'free', run: (s) => s.apply({ approval: { seniors: -2 } }) },
    ],
  },
  {
    id: 'faire',
    when: (s) => s.m === 5 && s.t >= 5,
    cooldown: 11,
    title: 'Faire on the Square',
    text: () => 'The annual Faire on the Square is coming up: local bands, Armenian pastries, a bouncy castle and a forecast of 60% chance of rain. Sponsor it?',
    choices: [
      { label: 'Sponsor the Faire', fx: '−$60K · everyone ↑', run: (s) => s.apply({ funds: -60e3, approval: { all: 2, business: 1 }, news: ['Faire on the Square rained on, declared a success anyway', ''] }) },
      { label: 'Skip it this year', fx: 'free · grumbling', run: (s) => s.apply({ approval: { all: -1 } }) },
    ],
  },
];

export const FOLLOWUPS = {
  'square-done': (s) => s.apply({ flag: { squareDone: 1 }, capNear: { at: 'square', r: 14, amt: 0.1 }, lvNear: { at: 'square', r: 30, amt: 0.15 }, approval: { business: 8, renters: 4, homeowners: 3, commuters: 2 }, demand: { C: 0.15 }, news: ['The new Square opens', 'The fifth corner is now a lawn. People are sitting on it. On purpose.', 'big'] }),
  'construction-biz': (s) => s.apply({ approval: { business: -4 }, news: ['Bakery remains open, accessible by gravel path and determination', 'Business owners along the construction zone ask for help.'] }),
  'cap-lobby': (s) => {
    if (s.rand() < 0.75) s.apply({ capShare: 0.05, approval: { homeowners: 6, seniors: 3 }, news: ['Governor signs Watertown tax relief bill', 'The House vote was unanimous. Homeowners are spared; commercial property takes one for the team.', 'big'] });
    else s.apply({ approval: { homeowners: -3 }, news: ['Tax relief bill stalls in committee', 'Legislators promise to try again next session.'] });
  },
  'dam-out': (s) => s.apply({ lvNear: { at: 'river', r: 50, amt: 0.05 }, approval: { all: 2 }, news: ['Dam comes out; herring rush upstream', '300,000 fish thank the Council by swimming past it.', 'big'] }),
  'po-maybe': (s) => (s.rand() < 0.4 ? s.apply({ approval: { seniors: 6 }, news: ['Post office returns to the Square', 'There was a line on opening day. Of course there was.'] }) : s.apply({ news: ['Postal Service "still evaluating" Square location', ''] })),
  ada: (s) => s.apply({ funds: -12e6, approval: { homeowners: -3 }, news: ['Repairs trigger accessibility upgrades', 'The cheap fix turns out to require $12M in accessibility work.', 'big'] }),
  'build-lot': (s, d) => {
    const lot = s.w.lots[d.lot];
    if (lot && !lot.dead && !lot.project && !lot.under) {
      lot.dense = true;
      s.develop(lot, d.dens, d.zone);
      s.news(`New building opens${lot.addr ? ' at ' + lot.addr : ''}`, 'Move-in day traffic briefly rivals the Square.');
    }
  },
  override: (s, d) => {
    const support = (s.factions.homeowners * 0.5 + s.factions.renters * 0.3 + s.factions.seniors * 0.2) - 50 - d.pct * 120;
    const p = 1 / (1 + Math.exp(-support / 6));
    if (s.rand() < p) {
      s.levyLimit *= 1 + d.pct;
      s.overrides++;
      s.apply({ approval: { homeowners: -3 }, news: [`Override passes`, `Voters approve a ${(d.pct * 100).toFixed(1)}% Prop 2½ override. The levy limit rises to ${fmtMoney(s.levyLimit)}.`, 'big'] });
    } else s.apply({ approval: { homeowners: -2, seniors: -2 }, news: ['Override fails at the ballot box', `Voters said no. Turnout was ${Math.round(18 + s.rand() * 15)}%.`, 'big'] });
  },
};

// Pacing: at least AGENDA.minGap months between items, then a AGENDA.chance roll each month.
// Time-sensitive items (tax hearing, the classification cliff, blizzards) skip the roll.
export const AGENDA = { minGap: 3, chance: 0.4 };
const PRIORITY = new Set(['tax-night', 'cap', 'blizzard']);

export function nextScenario(s) {
  if (s.gameOver) return null;
  if (s.t - (s.lastScenarioT ?? -99) < AGENDA.minGap) return null;
  const eligible = [];
  for (const sc of SCENARIOS) {
    const last = s.seen[sc.id];
    if (last != null && (!sc.cooldown || s.t - last < sc.cooldown)) continue;
    let ok = false;
    try { ok = sc.when(s); } catch (e) { ok = false; }
    if (ok) eligible.push(sc);
  }
  if (!eligible.length) return null;
  let pool = eligible.filter((sc) => PRIORITY.has(sc.id));
  if (!pool.length) {
    if (s.rand() > AGENDA.chance) return null;
    pool = eligible.slice();
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(s.rand() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
  }
  for (const sc of pool) {
    let ctx = null;
    if (sc.prep) {
      ctx = sc.prep(s);
      if (!ctx) continue;
    }
    s.seen[sc.id] = s.t;
    s.lastScenarioT = s.t;
    if (sc.run) sc.run(s, ctx);
    return { sc, ctx };
  }
  return null;
}
export { FACTIONS };
