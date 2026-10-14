// Help → "Behind the scenes": why the game exists and how each model works.
// Numbers quoted here are the ones the code uses; live figures come from the running city.
import { el, fmtInt } from './util.js';
import { NOTICE, FICTION } from './credits.js';
import { WALK_WEIGHTS } from './walkscore.js';
import { CAT_WEIGHT } from './vibrancy.js';
import { CFG } from './config.js';
import { PATTERNS } from './patterns.js';

const P = (...k) => el('p', {}, ...k);
const H = (t) => el('h4', {}, t);
const B = (t) => el('b', {}, t);
const I = (t) => el('i', {}, t);
const A = (href, t) => el('a', { href, target: '_blank', rel: 'noopener' }, t);
const NOTE = (...k) => el('div', { class: 'btsnote' }, ...k);
const LIST = (...items) => el('ul', {}, ...items.map((x) => el('li', {}, ...[].concat(x))));
const TABLE = (head, rows) => el('table', { class: 'peers' }, el('tr', {}, ...head.map((h) => el('th', {}, h))), ...rows.map((r) => el('tr', { class: r.home ? 'home' : '' }, ...r.cells.map((c) => el('td', {}, String(c))))));

const CENSUS_2020 = 35329;

export const CHAPTERS = [
  {
    id: 'why', title: 'Why this game',
    build: (g) => [
      el('p', { class: 'lead' }, 'SimCity starts in an empty field. Watertown isn’t one.'),
      P('It is four square miles built out generations ago, wedged between Boston, Cambridge, Newton and Waltham. In a place like this, the interesting decisions aren’t where to lay the first road. They’re about what an already-built town lets itself turn into.'),
      P('Townies starts from an opinion, held by the Watertown resident who made it. Decades of planning and zoning decisions left the town with a glut of auto shops, car lots and parking where a main street could be, and very little good retail space. Today, most of what gets built is the big developer project in the ', I('Arsenal Yards'), ' mold: new, shiny and lucrative, but light on character.'),
      P('So the core problem is balance. You need enough growth to pay the bills and house people, but you can’t let developers set the terms. And you have to bring back ', B('vibrancy'), ': streets people actually walk, lined with the shops that make a place feel like itself, like coffee shops, bookstores, boutiques and galleries.'),
      P('Those shops are fragile for a specific reason, and the game models it directly. Once word gets out that a town is “on the rise,” landlords start pricing for the town they expect rather than the one they have. Rents jump, and the independents that created the buzz can’t pay. Storefronts then sit dark while owners wait for a bigger tenant.'),
      NOTE(B('Doing nothing is not neutral. '), 'Leave the game running untouched for 15 years and the town hollows out: independents drop from about 320 to under 100, chains rise from about 50 to over 250, and the budget drifts into the red. That is the thesis model’s outcome, not a forecast. Checked against what really happened from 2000 to 2026, it hollows Main Street out faster than history did (see “How accurate is it?”); with the neutral model, independents slip more gently, to about 240.'),
      P('Think of it less like building a sandcastle and more like tending a garden someone else planted. The beds are already there; your job is deciding what to weed, what to feed, and what to let grow.'),
    ],
  },
  {
    id: 'map', title: 'The real map',
    build: (g) => {
      const w = g.world, s = g.sim, st = w.stats || {}, src = w.sources || {};
      return [
        P(`Every tile is ${CFG.TILE_M} m (about 52 ft) across, true to scale. What you see is assembled from four public sources:`),
        LIST(
          [B('OpenStreetMap'), ': streets, footprints, rivers, parks and many businesses, via Geofabrik’s daily Massachusetts extract.'],
          [B('MassGIS tax parcels'), ': every parcel’s assessed land and building value, use code, year built, units and house style.'],
          [B('MassGIS building structures'), `: footprints that OpenStreetMap is missing${src.footprintsAdded ? ` (${fmtInt(src.footprintsAdded)} filled in)` : ''}.`],
          [B('Overture Maps places'), `: business listings${src.places ? ` (${fmtInt(src.places)} merged)` : ''}, combined with OpenStreetMap’s and cleaned of duplicates and non-businesses like ATMs, parking and car-share spots.`]
        ),
        P(`That adds up to ${st.buildings ? fmtInt(st.buildings) + ' buildings on ' + fmtInt(st.lots) + ' lots' : 'every building and lot in town'}. Your browser doesn’t query any map servers. A scheduled job on GitHub rebuilds a single compressed snapshot (about 2 MB) every other month, and the game loads that.`),
        H('Buildings that look like the real ones'),
        P('Heights come from OpenStreetMap floor counts or the assessor’s story count. Houses take their shape from the assessor’s style field: a “Decker” gets a triple-decker’s stacked porches, a “Cape” a steep low roof, a “Colonial” two full stories under a gable, and so on. Where the style is blank, the year built makes the guess (a 1955 house is likely a ranch or cape). Colors are randomized within realistic palettes, because no public dataset records what color your neighbor painted their siding.'),
        H('People'),
        P(`Population is homes × 2.3 people × occupancy. Unit counts come from the assessor, or from the use code or floor area when they’re missing. That gives about ${fmtInt(Math.round(s.pop / 100) * 100)} residents today, against ${fmtInt(CENSUS_2020)} in the 2020 Census, which is close enough to trust the shape of the town.`),
      ];
    },
  },
  {
    id: 'past', title: 'Starting in 2000',
    build: (g) => {
      const w = g.world;
      return [
        P('The default game starts in 2026 with the real town. You can also start in 2000 and play through the decisions that made today’s Watertown: whether to grant one more body-shop permit, what Pleasant Street becomes, what replaces the Arsenal Mall.'),
        P('How far back the data goes decides how honest that can be. Every property record includes the year its building was built, so anything newer than 2000 can be removed. What stood on those sites before isn’t in any dataset, because demolished buildings leave no record. Small houses keep a house; bigger sites get a stand-in (light industry, a parking lot or an auto shop, chosen by chance), and the Arsenal Yards site goes back to being the Arsenal Mall. Everything reconstructed says so when you look it up.'),
        P('Values are deflated to 2000 dollars using Watertown’s real price history, and history plays out on schedule: online shopping and smartphones spread, the 2008 crash freezes lending, Kendall Square spills over the river in the mid-2010s, the pandemic empties the Square in 2020, and the lab boom cools in 2023. Business listings and the street grid are today’s, because there is no usable record of 2000’s storefronts.'),
        P('The same reconstruction powers the history check: replay 2000 to 2026 and compare the result with today’s real town. See “How accurate is it?” for the scorecard.'),
        P('Earlier than about 2000, too much would be invented, so the game doesn’t go further back. Old maps exist (fire-insurance maps and atlases back to the 1800s), but they’re images that would have to be traced by hand.'),
        w && w.startYear ? NOTE(`This game started in ${w.startYear}. ${fmtInt(w.rewound || 0)} sites were reconstructed. The real town in 2026 has ${fmtInt(w.real ? w.real.units : 0)} homes.`) : null,
      ];
    },
  },
  {
    id: 'accuracy', title: 'How accurate is it?',
    build: () => {
      const box = el('div', {}, P('Loading the history check…'));
      fetch('data/validation.json').then((r) => r.json()).then((v) => {
        box.replaceChildren(...accuracyChapter(v));
      }).catch(() => box.replaceChildren(P('The history check results aren’t available right now (data/validation.json).')));
      return [
        el('p', { class: 'lead' }, 'Start the game in 2000, run it to 2026, and see whether it lands on the Watertown that really exists.'),
        box,
      ];
    },
  },
  {
    id: 'unsure', title: 'How sure is it?',
    build: () => {
      const box = el('div', {}, P('Loading the uncertainty runs…'));
      fetch('data/uncertainty.json').then((r) => r.json()).then((u) => box.replaceChildren(...uncertaintyChapter(u))).catch(() => box.replaceChildren(P('The uncertainty runs aren’t available right now (data/uncertainty.json).')));
      return [el('p', { class: 'lead' }, 'One run of a model is one guess. Here are many, with the parts nobody knows drawn from plausible ranges.'), box];
    },
  },
  {
    id: 'tax', title: 'Taxes & Prop 2½',
    build: () => [
      P('The budget follows real Massachusetts municipal finance, which is unusual and very constraining.'),
      LIST(
        [B('Proposition 2½'), ' caps the total property tax levy. Each year the limit can grow by 2.5%, plus “new growth” (the taxes on whatever got built or improved that year). Going beyond that takes an override vote at the ballot box.'],
        [B('Split tax rates'), ': the town can shift the levy onto commercial and industrial property, up to a state cap. Watertown does, which is why labs and offices matter so much to its budget.'],
        [B('Residential exemption'), ': lowers the bills of owner-occupants and raises everyone else’s, including landlords, whose tenants pay it in rent.']
      ),
      P('The levy is a leash that lengthens only 2.5% a year, while health insurance, pensions and benefits grow closer to 4–5%. That gap is built in, as it is in real towns, so standing still slowly runs you out of money. Your ways out are new growth, which means letting things get built, or asking voters for an override and spending political capital.'),
      P('Approval is tracked for five groups: homeowners, renters, seniors, business owners and commuters. Most decisions trade one against another.'),
    ],
  },
  {
    id: 'vib', title: 'Vibrancy',
    build: (g) => {
      const s = g.sim;
      const pct = (v) => `${v > 0 ? '+' : ''}${v.toFixed(2)}`;
      return [
        P('Vibrancy is the game’s measure of what’s on the street: how much worth walking to there is near where people live, and whether enough people are around to use it. It’s built in four steps.'),
        H('1 · Frontage'),
        P('Every lot gets a frontage score from what’s in it, using each business’s category from OpenStreetMap or Overture:'),
        TABLE(['Use', 'Weight'], [
          { cells: ['Food & drink', pct(CAT_WEIGHT.food)] }, { cells: ['Shops', pct(CAT_WEIGHT.retail)] }, { cells: ['Services (salons, gyms, banks…)', pct(CAT_WEIGHT.service)] },
          { cells: ['Civic (library, church…)', pct(CAT_WEIGHT.civic)] }, { cells: ['Office', pct(CAT_WEIGHT.office)] }, { cells: ['Auto-oriented business', pct(CAT_WEIGHT.auto)] },
        ]),
        P('Chains count for 45% of an independent. ', B('Signature'), ' independents (coffee, books, boutiques, galleries, records, bakeries and the like) count 1.6×. Dark storefronts subtract. A lot whose assessor use code is auto sales, repair, fuel, car wash or parking (Massachusetts codes 330–338) is ', I('dead frontage'), ', a gap in the street that makes the next block less pleasant to walk to.'),
        H('2 · Spread over a walk'),
        P('Each lot’s score spreads to everywhere within about 400 m (a five-minute walk), fading with distance like a streetlight’s glow: brightest at the door, gone by the next neighborhood.'),
        H('3 · Scaled by foot traffic'),
        P('A great block with nobody living near it doesn’t feel alive. So the spread-out score is multiplied by a foot-traffic factor based on how many residents live within the same walk.'),
        H('4 · Diminishing returns'),
        P('Finally it passes through a saturating curve (1 − e⁻ˣ). A first café on a block matters enormously; a ninth barely registers. Your city’s Vibrancy is the average of that over every resident, so it measures what people experience from their own front door, not the best block in town.'),
        NOTE(`Today: ${s.vibrancy.toFixed(1)} (started at ${s.base.vib0.toFixed(1)}). The number is relative: it’s calibrated to the starting city, and what matters is which way it moves.`),
        P('Vibrancy feeds back into land values, which raise rents, which is where the next chapter starts.'),
        H('A built-in circularity, and the check on it'),
        P('In the thesis model, auto uses and parking are scored as dead frontage. That is the game’s premise, not something it finds out: remove an auto shop and vibrancy rises by definition, even if nothing replaces it. Measured on the 12 auto parcels nearest the Square, just clearing them raises vibrancy about 0.6 points, about half of what converting them to two ordinary shops each does. In the neutral model there is no penalty, and clearing them alone changes nothing.'),
        P('Two things keep that honest. The Main Street window splits any change in vibrancy into its sources: shops and storefronts, dark storefronts, people within a walk, and (in the thesis model) the auto-and-parking scoring, labeled as true by definition. And there is a second, outcome measure, ', B('walking trips a day'), ', that doesn’t score land uses at all.'),
        H('Walking trips'),
        P('A standard accessibility model, the kind transport planners use: each resident and worker walks more when more places worth walking to are within a short walk, with each destination counting less the farther away it is (fading over about 250 m). Restaurants, shops, services, civic buildings and parks are destinations. An auto shop or a parking lot simply isn’t one: it earns nothing and costs nothing. So the number only moves when something worth walking to opens or closes, or when more people live and work nearby. It is scaled so that about one in ten residents’ trips are on foot at the start, near what travel surveys find for older inner suburbs. It is an estimate, not a count.'),
        P('The Auto Row mission now asks for walking trips to rise, not vibrancy, so converting lots only counts if people then walk there. It still doesn’t test the thesis against the real world: that would take pedestrian counts or foot-traffic data, and none is public for Watertown.'),
        s.streetLife ? NOTE(`Today: about ${fmtInt(s.streetLife.trips)} walking trips a day (${s.streetLife.change >= 0 ? '+' : '−'}${Math.abs(s.streetLife.change * 100).toFixed(1)}% since the start).`) : null,
      ];
    },
  },
  {
    id: 'rent', title: 'Landlords & leases',
    build: () => [
      P('This is the heart of the game. Every storefront on a commercial or mixed-use lot has a tenant with a lease, or it’s empty.'),
      H('What landlords ask'),
      P('Each owner has an asking rent that chases a target. The target rises with land values, with vibrancy nearby, and with ', B('hype'), ', the regional buzz that Watertown is “the next Somerville.” Hype builds by itself and feeds on any rise in vibrancy. Big developments and a redone Square add to it.'),
      P('About 27% of owners are ', B('prospectors'), '. Once the buzz builds, they price 20–50% above the market and wait. Rents move like a ratchet: up a notch quickly, down only slowly. A prospector with an empty storefront barely cuts the price in the first year. After a year, and especially after two, even they start to cave.'),
      H('Who can pay'),
      P('Leases run five years for independents and ten for chains. At renewal, the rent resets to whatever the landlord is asking now. A shop survives if its sales, driven by foot traffic and vibrancy, cover the new rent. If they don’t, it closes, and the news usually says it was “after a 38% rent increase.”'),
      P('When a space opens, independents and chains both look at it. Chains can pay more and sign longer leases. In a calm market most interested tenants are independents, but the more speculation, the more often a credit tenant wins: a bank branch, a phone store, an urgent care.'),
      H('Your tools'),
      LIST(
        [B('Vacant storefront fee'), ': makes waiting expensive, so landlords cut faster.'],
        [B('Rent relief'), ': the City covers part of independents’ rent.'],
        [B('Legacy registry'), ': helps long-standing independents.'],
        [B('Chain-store limits'), ': a special permit for chains in the Square and along Main and Mt Auburn Streets. Spaces may sit empty longer.'],
        [B('Pop-up arts'), ': galleries fill long-empty windows until a tenant signs.'],
        [B('Deed-restricted rents'), ': on City-led infill projects, which keep new storefronts affordable for decades.']
      ),
      NOTE('All rents are an index relative to the year you start (1.00 = then), because real commercial asking rents aren’t public data. The real map sets the starting point; the dynamics describe what happens after you take office.'),
    ],
  },
  {
    id: 'walk', title: 'Walkability',
    build: () => {
      const cats = Object.entries(WALK_WEIGHTS).map(([k, v]) => `${k} ${v.reduce((a, b) => a + b, 0).toFixed(1)}`);
      return [
        P('Walk Score doesn’t offer its data for games, so Townies rebuilds a Walk Score–style index from open data using the method Walk Score has published:'),
        LIST(
          ['Distance from each spot to the nearest few places in nine everyday categories (points per category: ', cats.join(', '), '). Extra places in a category count for less: the third restaurant adds less than the first.'],
          'Full credit within a quarter mile (a five-minute walk), fading to about 12% at one mile and to nothing past a mile and a half.',
          'Straight-line distances are stretched by 25% to approximate real walking routes.',
          'A penalty of up to 10% where streets are sparse, measured by real intersections from OpenStreetMap (fewer than 200 per square mile within a half mile).'
        ),
        P('It’s recomputed as shops open and close, parks are built and projects finish, so your decisions show up in it.'),
        NOTE(B('Honest caveat: '), 'the index runs about 10 points higher than Walk Score’s published citywide figure for Watertown. Walk Score uses real street routing and its own business database, and this doesn’t. Treat it as a relative measure, good for comparing places and tracking change, not as a substitute for the real score.'),
      ];
    },
  },
  {
    id: 'traffic', title: 'Traffic & intersections',
    build: (g) => {
      const s = g.sim, w = g.world, tc = w.trafficCounts, fit = s.base && s.base.trafFit;
      return [
        P('Traffic starts from real counts. MassDOT’s Road Inventory publishes an average daily traffic count (AADT) and the number of lanes for most streets in town' + (tc ? `: ${fmtInt(tc.segments)} segments here, mostly counted or estimated around ${tc.yearMedian}.` : '.')),
        H('Who drives where'),
        P('On top of the counts sits a small version of the model regional planners use. Homes produce trips and jobs and shops attract them. The arterials at the town line bring in commuters and through traffic, because Watertown sits between Boston, Cambridge, Newton and Waltham. Each trip takes the fastest route over the real street grid, slowed by congestion and by intersection delay. The routing is re-run a few times so traffic spreads out instead of piling onto one street.'),
        w.commute ? P(`Commuting comes from the Census (LEHD LODES ${w.commute.year}): ${fmtInt(w.commute.totals.inbound)} people commute into Watertown jobs, ${fmtInt(w.commute.totals.outbound)} residents commute out, and only ${fmtInt(w.commute.totals.internal)} both live and work here. Their trips enter and leave by the arterial pointing toward their town: Boston and Cambridge to the east, Waltham to the west, Newton to the south.`) : null,
        P('The model’s settings (how much through traffic, travel speeds by street type, how far people go for errands) were tuned to match the MassDOT counts.' + (fit && fit.r2 ? ` Before any correction, the routed model explains about ${Math.round(fit.r2 * 100)}% of the street-to-street variation in counted traffic across ${fmtInt(fit.n)} counted street tiles${fit.nBusy ? `, and about ${Math.round(fit.r2Busy * 100)}% among busy streets (8,000+ a day), where counts are most reliable` : ''}, on a log scale. Placeholder figures MassDOT assigns to local streets (marked “not applicable”) are left out; only counts count.` : '')),
        P('The game then starts each counted street at its actual count, and the model only moves volumes up or down from there as the town changes (the “pivot-point” method). A street without a count starts from the typical count for its class of street (for ordinary side streets, MassDOT’s own default of about 1,150 a day, because the few local streets it does count are the busy ones), nudged a little by the routed model and corrected toward counted neighbours. That mix came out of a hold-out test (see “How accurate is it?”): on counts it never saw, it does better than either the routed model or street class alone.'),
        H('Buses'),
        P('Watertown has no subway, so its transit is the MBTA bus: the 57 down Galen Street, the 70 along Main and Arsenal Streets, the 71 up Mount Auburn Street and the 73 on Belmont Street. Ridership on each is modeled from the people and jobs within a short walk of the route; it rises when car traffic gets worse (people switch) and falls when the buses are stuck in that same traffic, unless they have their own lane. The total is scaled to a round assumption of about 9,000 weekday boardings in town, not measured stop by stop (the only published route figure found was the 57’s 10,094 weekday boardings in 2012, most of them outside Watertown). Riders gained or lost change the number of car trips the traffic model routes.'),
        H('From volumes to jams'),
        P('Rush-hour volume is taken as 9% of daily traffic, 55% of it in the peak direction. That is compared with about 900 cars per lane per hour, a typical signalized arterial. Over 100% means queues. Mount Auburn, Main, North Beacon and Watertown Streets all come out near or over capacity, which matches anyone’s commute.'),
        H('Intersections'),
        P('Signals, roundabouts and rotaries use simplified Highway Capacity Manual formulas. A signal gives each approach a share of green, minus a few seconds lost at every change, so a six-way square like Watertown’s wastes a lot of green. A roundabout’s entry can only use gaps in the traffic already circling, so its capacity drops steeply as the circle fills. Today’s signal at the Square is calibrated to carry today’s counted traffic at capacity. Crash changes are the FHWA and IIHS averages for converting a signal.'),
        P('When you rebuild an intersection, drivers re-route over the following months: a slower junction sheds traffic to side streets, and a faster one attracts more. A big roundabout that fails on today’s volumes can work once some traffic finds other routes, or once e-bikes and robotaxis change the numbers.'),
        NOTE(B('Limits: '), 'the counts are from the mid-2010s; the bus model is crude; trips are daily averages, not real turning-movement counts; and roundabout flows assume trips spread evenly to the other streets. Good for comparing options, not for designing a real intersection.'),
      ];
    },
  },
  {
    id: 'apl', title: 'A Pattern Language',
    build: () => [
      P('In 1977 Christopher Alexander, Sara Ishikawa and Murray Silverstein published A Pattern Language: 253 patterns for building towns, neighborhoods and houses that people find alive and comfortable. Much of what this game calls vibrancy is in there: shops owned by the people who run them, corner groceries, greens close to every home, housing mixed in with work.'),
      P('The book is qualitative, so the game turns eleven of its town- and neighborhood-scale patterns into one plain test each, measured on the real map every year (Windows → A Pattern Language):'),
      LIST(...PATTERNS.map((p) => [B(`${p.n}. ${p.name}: `), `${p.idea} `, I(`Test: ${p.test}.`)])),
      P('Each score is the share of homes (or shops, or land, or local streets) that pass, from 0 to 100, and the overall score is their average. It is a side measure: it changes nothing in the simulation, it just tells you how your Watertown reads to someone who carries the book around.'),
      NOTE(B('Today’s Watertown '), 'passes most tests easily (it is mostly two- and three-story houses, close to buses and parks) and does worst on activity nodes and corner groceries: shops are spread along a few corridors rather than gathered in walkable clusters, and many neighborhoods are a long walk from food.'),
    ],
  },
  {
    id: 'peers', title: 'Peer towns',
    build: (g) => {
      const c = (g.peers && g.peers.centers) || [];
      const rows = c.slice().sort((a, b) => b.sig - a.sig).map((p) => ({ home: p.home, cells: [p.name, p.walk, p.storefronts, p.sig, `${Math.round(p.chainShare * 100)}%`, p.auto] }));
      return [
        P('To test the game’s premise against something real, the data build runs the same analysis on main streets around Watertown. It draws a 600 m circle (about a seven-minute walk) around each center and counts what’s there, using the same OpenStreetMap and Overture data and the same rules for chains, signature shops and auto uses.'),
        rows.length ? TABLE(['Center', 'Walk', 'Shops', '★', 'Chains', '🚗'], rows) : P(I('Peer data did not load.')),
        P('★ = signature independents; 🚗 = auto-oriented businesses. Watertown Square has about half the storefronts of Davis Square or Coolidge Corner, and barely half their signature independents. Belmont Center has more signature shops with only 60% as many storefronts. Within a seven-minute walk of the Square there are 27 auto-oriented businesses. That’s on par with Moody Street, but three to six times what Davis, Coolidge Corner or Newton Centre have.'),
        P('That gap is a mission (“Catch Moody Street”), and the Main Street window shows the same table live as your Watertown changes.'),
        NOTE('These are counts from open listings, which miss some businesses and keep a few that have closed. They’re best read side by side, since every center is measured the same way.'),
      ];
    },
  },
  {
    id: 'proj', title: 'Projects & hearings',
    build: () => [
      P('SimCity’s joy is building. With Watertown already built, building means ', B('redevelopment'), ': pick parcels, choose a program, and take it to the Planning Board.'),
      LIST(
        [B('Developer megaproject'), ': apartments over chain retail and a garage. The developer pays and the tax base jumps, but there’s little character.'],
        [B('Main Street infill'), ': the City buys the land and sells it lot by lot to small builders under design rules. It costs you the gap between purchase and resale, and makes streets people walk.'],
        [B('Apartments'), ': market-rate with affordable units, or 100% affordable through a nonprofit.'],
        [B('Lab / R&D'), ': a huge tax base, no street life, and a cyclical market.'],
        [B('Public plaza'), ': pure cost, with a big lift to everything around it.']
      ),
      H('Will a developer build it?'),
      P('Each private project runs a simple pro forma: construction cost per square meter, about $45,000 per structured parking space, and sale values scaled by local land value. Developers walk away below roughly a 12% return. Ask for more affordable homes, more local shops or less parking, and you may need to allow another floor to keep the numbers working.'),
      H('Will the Board approve it?'),
      P('The hearing adds up reasons, and the planner shows every one before you submit:'),
      LIST(
        'Height next to single- and two-family homes, residents displaced, and beloved businesses lost all count against.',
        'Affordable homes, storefronts reserved for locals, a plaza, transit money, and replacing car lots all count for.',
        'City-led projects get credit for a public process, and your own approval rating helps or hurts.'
      ),
      P('The total becomes approval odds through an S-shaped curve. Like a jury on the fence, small concessions matter a lot when a project is borderline and barely at all when it’s a sure thing either way.'),
      P('Approved projects get fences, cranes and a construction timeline. Their tenants, traffic and taxes arrive when they open.'),
    ],
  },
  {
    id: 'future', title: 'The future',
    build: (g) => {
      const s = g.sim;
      return [
        P('Time doesn’t stop in 2026. Technologies arrive on a plausible timeline and spread along S-curves: slowly at first, then quickly, then leveling off. The arrival years are informed guesses, and the curves are illustrations for an inner-ring Boston suburb, not forecasts.'),
        P('You can’t stop most of them. When each one arrives, the Council decides how the City meets it: embrace it, let it happen, or restrict it. That choice speeds or slows the spread and decides who wins.'),
        LIST(
          [B('Electric cars'), ' need no gas and far less servicing, so the auto row empties out on its own. That isn’t automatically good news. An empty repair shop is still dead frontage, and if you do nothing the market eventually rebuilds those lots the Arsenal Yards way: apartments over national chains. Main Street infill is how you do better.'],
          [B('Robotaxis'), ' don’t need to park near their riders, so surface parking lots become surplus land. Unpriced, empty cars cruising for the next fare add traffic; curb and congestion pricing turns that around.'],
          [B('Delivery drones and robots'), ' cut sales at ordinary shops. Cafés, galleries and bookstores hold up, because people still go out for experiences. That makes signature shops matter even more.'],
          [B('Hybrid work'), ' moves daytime foot traffic from office districts into neighborhoods.'],
          [B('Mass timber'), ' makes construction up to 18% cheaper and faster, so more projects pencil out.'],
          [B('E-bikes, solar, green roofs and air taxis'), ' change traffic, energy bills, land values and how much noise the neighbors hear.']
        ),
        P('The landscape changes with them. Solar panels spread across the roofs, gas stations become charging hubs, bike lanes appear when you build them, robotaxi pods replace cars, drones fill the sky, and new buildings take on the look of their era: warm mass timber in the 2030s, terraced glass and greenery in the 2040s.'),
        s && s.tech ? NOTE(`Today: electric cars are ${Math.round(s.tech.a.ev * 100)}% of the fleet and solar is on ${Math.round(s.tech.a.solar * 100)}% of roofs. Windows → Technology shows the full timeline.`) : null,
      ];
    },
  },
  {
    id: 'weather', title: 'Weather',
    build: (g) => [
      P('The weather is generated day by day from Boston’s real climate normals (Logan Airport, NOAA 1991–2020): average highs and lows, total precipitation and the number of wet days for each month. It’s the method hydrologists and crop models use: wet and dry days come in runs (a Markov chain matched to each month’s wet-day count), rain amounts are drawn to match monthly totals, temperatures wander around the normal with day-to-day persistence, and a wet day turns to snow when it’s cold enough.'),
      P('Run over many years it lands close to the record: about 45 inches of snow a year against Boston’s 49, with winters from barely 15 inches to over 70. It reproduces the character of Watertown weather, not the weather of any actual day: a game started in 2000 won’t replay the real blizzards of 2015.'),
      H('What it does in the game'),
      LIST(
        'A snowfall of 3 inches or more needs plowing; big storms make the news, and the first snow of each season gets a moment on the map.',
        'Wet months and snow on the ground slow traffic a little; snow-narrowed streets more.',
        'Pleasant months bring people out: storefronts see more foot traffic in May than in a slushy February.',
        'Heat waves (three or more days over 90°F) make the news.'
      ),
      H('Climate change'),
      P('Temperatures shift with a warming trend, one of the labeled assumptions (Model assumptions → Climate warming): by default 0.4°F a decade from the 1991–2020 normals, with options for none or twice that. Warming turns some snow into rain, adds hot days, and makes downpours a little heavier. Massachusetts has warmed about 3.5°F since 1900, faster in recent decades (NOAA).'),
    ],
  },
  {
    id: 'inc', title: 'Crews & incidents',
    build: () => [
      P('Between monthly ticks, the town keeps happening in days: potholes, water main breaks, downed trees, unplowed streets after a storm, building fires and rat complaints.'),
      P('Tap one to send the nearest free crew. The number of crews follows your department budgets. You can turn on auto-dispatch per department instead, but it’s slower (paperwork first) and runs on overtime. Problems left too long cost approval with the groups they affect. Water main breaks and storms eventually get fixed by emergency contractors at double the price, and fires burn buildings down.'),
      P('Quick fixes build a little goodwill. Both the goodwill and the damage are capped, so one bad blizzard can’t end your career on its own.'),
    ],
  },
  {
    id: 'voices', title: 'The comment section',
    build: () => [
      P('Part of Watertown’s charm is the small-town drama a few miles from downtown Boston. The Council agenda items are fictionalized riffs on storylines that keep recurring in local coverage, especially ', A('https://www.watertownmanews.com', 'Watertown News'), ' and its comment threads: parking in the Square, lab buildings next to houses, bike lanes, the post office, the dam and the herring run, school budgets versus seniors.'),
      P('The commenters are a fixed cast of invented regulars, each with a predictable hobbyhorse, who react to what you do. None of them is a real person, and none of their lines are quoted from real comments.'),
      P('The Watertown Townie newspaper, the ticker and the neighbor quotes in Query all draw from the same templates, filled in with real street names and the simulated businesses involved.'),
      H('Melora'),
      P('One regular is more than a voice. Melora shows up at Planning Board hearings, gets them continued with a binder of concerns, rallies neighbors to lower a project’s odds, files records requests and circulates petitions. Every month of delay eats into a developer’s margin, and sometimes the developer walks away. She means well and occasionally catches something real, like miscounted affordable units or a tree worth saving. More often, though, her wins leave a lot empty while nearby rents keep rising.'),
      P('Her mood (the meter in the Comment Section) rises with big projects and with being brushed off, and falls when she wins or feels heard. Meeting with her costs a little and calms her down. Giving her a title calms her down too, but then every future permit crosses her desk. She is an archetype drawn from many comment sections, not a portrait of anyone.'),
    ],
  },
  {
    id: 'terms', title: 'Terms & reviews',
    build: () => [
      P('Each term is a mission with a deadline: convert Auto Row, raise vibrancy, build the state’s required 1,701 homes without killing the Square, catch Moody Street, survive a lab bust, or hold onto independents through a rent spike. The sandbox has no deadline.'),
      P('Every three years the Council reviews your contract. Average approval, whether reserves are positive, and whether your goals are on track add up to a grade from A to F. An F ends the term.'),
      P('Each mission was tested two ways: left alone, it must be lost, and a simple automated strategy must be able to win it.'),
    ],
  },
  {
    id: 'limits', title: 'What’s simplified',
    build: () => [
      P('A model is a map, not the territory. Where the game is guessing:'),
      NOTE(B('Try the neutral model. '), 'Help → Model assumptions (or “Neutral” on the title screen) switches the thesis-carrying assumptions to plain market fundamentals: no speculating landlords, no self-feeding buzz, chains and independents on equal terms, every open business counting the same. Left alone for 15 years, the thesis model hollows out Main Street; the neutral model mostly doesn’t. The budget squeeze happens in both, because it comes from Prop 2½ and cost growth, not from the thesis.'),
      LIST(
        [B('Rents'), ' are an index, not dollars. Real commercial asking rents aren’t public.'],
        [B('Chains and signature shops'), ' are identified by brand tags, a list of known chain names, and business categories. Some will be misclassified.'],
        [B('Business listings'), ' lag reality: some closed places linger and some new ones are missing.'],
        [B('Shop economics'), ' are stylized. Each shop’s sales follow foot traffic and vibrancy, not its actual books.'],
        [B('People'), ' are a flat 2.3 per home. Real household sizes vary by neighborhood.'],
        [B('Development economics'), ' use round regional numbers for costs and values. They’re tuned so that plausible projects pencil out and implausible ones don’t, not to appraise any particular site.'],
        [B('The 15-year hollowing-out'), ' is what this model does when left alone. It’s an argument, not a prediction.']
      ),
    ],
  },
  {
    id: 'sound', title: 'Sound',
    build: () => [
      P('The music is generated live in your browser; there are no recordings. It borrows from a modular synthesizer. Shift-register sequencers (like the Turing Machine module) slowly mutate short melodic loops, which pluck plucky “low-pass gate” voices on Euclidean rhythms of different lengths, so the patterns drift in and out of phase. Underneath, slow pads sit in a large reverb. Drums wander in for some sections and out for others.'),
      P('The aim was Eno’s ambient records with a bit more pulse: chill, but never asleep.'),
    ],
  },
  {
    id: 'src', title: 'Sources & credits',
    build: () => [
      LIST(
        [A('https://www.openstreetmap.org/copyright', 'OpenStreetMap'), ' contributors (ODbL), via ', A('https://download.geofabrik.de/north-america/us/massachusetts.html', 'Geofabrik')],
        [A('https://www.mass.gov/info-details/massgis-data-property-tax-parcels', 'MassGIS property tax parcels'), ' and ', A('https://www.mass.gov/info-details/massgis-data-building-structures-2-d', 'building structures'), ', Commonwealth of Massachusetts'],
        [A('https://docs.overturemaps.org/guides/places/', 'Overture Maps places'), ' (CDLA-Permissive-2.0)'],
        [A('https://geo-massdot.opendata.arcgis.com/', 'MassDOT Road Inventory'), ' (traffic counts, lanes); ', A('https://highways.dot.gov/safety/proven-safety-countermeasures/roundabouts', 'FHWA on roundabouts'), ' (crash effects); Highway Capacity Manual, 6th ed. (signal and roundabout capacity and delay)'],
        [A('https://lehd.ces.census.gov/data/', 'US Census Bureau LEHD LODES'), ' (commute flows; public domain)'],
        [A('https://www.walkscore.com/methodology.shtml', 'Walk Score methodology'), ', the structure of the walkability index (no Walk Score data is used)'],
        [A('https://www.mass.gov/info-details/levy-limits-a-primer-on-proposition-2-12', 'Levy Limits: A Primer on Proposition 2½'), ', MA Division of Local Services'],
        [A('https://www.watertownmanews.com', 'Watertown News'), ', inspiration for the agenda']
      ),
      P(FICTION),
      P(NOTICE, ' Source code: ', A('https://github.com/samuelling/Townies', 'github.com/samuelling/Townies'), '.'),
    ],
  },
];

// ---- "How accurate is it?" ----
const med = (m, k) => (m && m.summary && m.summary[k] ? m.summary[k].median : NaN);
const rng = (m, k) => (m && m.summary && m.summary[k] ? [m.summary[k].min, m.summary[k].max] : [NaN, NaN]);
const pct = (x) => `${Math.round(x * 100)}%`;
const bil = (x) => `$${(x / 1e9).toFixed(1)}B`;
function accuracyChapter(v) {
  const real = v.real2026, s0 = v.start2000, T = v.thesis || {}, N = v.neutral || {};
  const share = (m) => med(m, 'chains') / Math.max(1, med(m, 'chains') + med(m, 'indies'));
  const realShare = real.chains / (real.chains + real.indies);
  const span = (m, k, f = fmtInt) => { const [a, b] = rng(m, k); return a === b ? f(a) : `${f(a)}–${f(b)}`; };
  const grow = (m) => med(m, 'units') - s0.units;
  const levy = (m) => { const y = m && m.yearly ? m.yearly.find((r) => r.y === 2025) : null; return y && y.levy ? `$${y.levy}M` : '–'; };
  const rows = [
    { cells: ['New homes, 2000→2026', `+${fmtInt(real.units - s0.units)}`, `+${fmtInt(grow(T.history))}`, `+${fmtInt(grow(N.history))}`] },
    { cells: ['Jobs in town', fmtInt(real.jobs), span(T.history, 'jobs'), span(N.history, 'jobs')] },
    { cells: ['Residential value', bil(real.valR), bil(med(T.history, 'valR')), bil(med(N.history, 'valR'))] },
    { cells: ['Commercial value', bil(real.valC), bil(med(T.history, 'valC')), bil(med(N.history, 'valC'))] },
    { cells: ['Storefronts open', fmtInt(real.shops), span(T.replay, 'shops'), span(N.replay, 'shops')] },
    { cells: ['Chain share of shops', pct(realShare), pct(share(T.replay)), pct(share(N.replay))] },
    { cells: ['Independents', fmtInt(real.indies), span(T.replay, 'indies'), span(N.replay, 'indies')] },
    { cells: ['Auto-use lots', fmtInt(real.auto), span(T.history, 'auto'), span(N.history, 'auto')] },
    { cells: ['Tax levy, FY2025', '$165M', levy(T.replay), levy(N.replay)] },
  ];
  const tr = v.traffic;
  const sp = (T.history && T.history.spatial) || {};
  return [
    P('The check runs the game three ways, several times each with different random seeds:'),
    LIST(
      [B('Replay'), ': every building that really went up after 2000 appears in the year it was built, and the market builds nothing extra. This tests prices, storefronts and traffic given the real built form.'],
      [B('Real decisions'), ': only the big real choices are made (body-shop permits granted, Pleasant Street rezoned, the Arsenal Mall redeveloped as proposed). Everything else is up to the simulated market. This tests how much the model builds, and where.'],
      [B('Hands off'), ': nobody decides anything.']
    ),
    P('Then it compares 2026 in the game with 2026 in the data, measured the same way. Values are in each year’s dollars.'),
    TABLE(['', 'Real 2026', 'Thesis model', 'Neutral model'], rows),
    el('p', { class: 'fine' }, 'Homes, jobs, values and auto lots: the real-decisions run. Storefronts and the levy: the replay. Ranges are the spread across seeds. Homes are counted from assessor records, which miss about 6–9% of the units the Census counts (15,008 in 2000 and 16,936 in 2020), consistently in both years.'),
    H('What the first run got wrong, and what was tuned'),
    P('The first time through, before any tuning, the game missed badly in five places. Each fix uses one or two plain-meaning knobs, set from data the check then doesn’t grade itself on, or from published rates:'),
    LIST(
      [B('It built far too much. '), 'The market added about 5,900 homes where reality added about 1,470. Most came from filling Watertown’s ~720 empty parcels; in reality only 36 of them (5%) were built on by 2026, because most are slivers, backlots and protected land. Empty-lot building is now about one-seventeenth as likely, and redevelopment favors big parcels (real redevelopment happened almost entirely on large commercial and industrial sites: lot size alone picks those out with an AUC of 0.94). The Arsenal Mall choice now builds about 400 apartments, like the real Arsenal Yards, instead of thousands.'],
      [B('Prices rose too slowly. '), 'The old market grew about 4% a year with demand. Values now follow Watertown’s real price history (about ×2.9 since 2000, including the 2008 dip), with local supply and demand nudging around it. That makes prices an input, not a prediction; see Model assumptions for the rate after 2026.'],
      [B('Chains took over. '), 'Every version of the storefront model drifted toward chains even with the thesis switched off, because chains almost never closed (a 139-year average lifetime). Shops now close near real retail exit rates, about 5–7% a year, and an affordable independent almost always gets a free storefront; chains win where rents outrun what independents can pay. New independents are now the real mix too: mostly restaurants, salons, cleaners and gyms, with about one in seven a café, bakery, bookshop or similar.'],
      [B('The budget sank. '), 'With growth corrected, the city ran ever-deeper deficits, because the game only counted taxes on new buildings as “new growth.” Real Watertown’s levy roughly tripled from 2000 to about $165M in FY2025, partly from renovations, additions and business equipment that the game doesn’t model one by one. Those now add 1.4% of the levy a year, and department costs grow 3.6% a year (benefits 4.5%), so a replay of 2000–2026 lands near the real levy and roughly balanced, as the real town did.'],
      [B('Traffic on streets without counts. '), 'The first hold-out test hid a fifth of the MassDOT counts and asked the model to predict them. It did worse than simply guessing the typical count for that kind of street. It also turned out that most of the “counts” on local streets were MassDOT placeholders (1,154 cars a day on every local street, marked “not applicable”), which are no longer treated as data.'],
    ),
    H('What the check says about the thesis'),
    P(`With the neutral model, a replay of 2000–2026 ends with chains at ${pct(share(N.replay))} of storefronts, against ${pct(realShare)} in reality. With the thesis switched on (speculating landlords, “on the rise” buzz, chains favored as rents climb) it ends at ${pct(share(T.replay))}. Even at a tenth of its designed strength, the buzz noticeably raises the chain share (to about 24% in a test run).`),
    NOTE(B('Honest reading: '), 'Watertown’s storefronts today look more like the neutral model’s 2026 than the thesis model’s. As built, the thesis machinery hollows out Main Street faster than history did. That doesn’t mean speculation isn’t real; the strongest signal in the data is that chains got new, expensive space (about 27% of storefronts in post-2000 buildings are chains, against about 12% in older ones), which the plain rent mechanism already produces. The thesis model stays in the game as an argument to play with, labeled as such.'),
    H('Traffic'),
    tr ? P(`Hidden-count test on today’s map (${fmtInt(tr.tiles)} counted street tiles, five folds by count segment). On a log scale the calibrated model explains ${pct(Math.max(0, tr.calibrated.r2))} of the variation in counts it never saw (typical error ${pct(tr.calibrated.medianError)}). Guessing the typical count for that class of street explains ${pct(Math.max(0, tr.classMedian.r2))} (typical error ${pct(tr.classMedian.medianError)}). The routed model alone, without counts nearby, does worse than either, so the game now leans on street class and nearby counts, and uses the routed model mainly for how traffic changes when you change the town.`) : null,
    H('Where change happens'),
    P(`Of ${fmtInt(sp.lots || 0)} parcels, ${fmtInt(sp.bigChanged || 0)} really became something big (apartments, labs, the mall site) between 2000 and 2026. Across runs, how often the model rebuilt each parcel predicts which ones with an AUC of ${(sp.aucBig || 0).toFixed(2)} (0.5 is chance; lot size alone gets ${(sp.aucBigLotSize || 0).toFixed(2)}). The model now builds about the right amount (a bit less than history did), but not in the right places: real redevelopment followed specific owners and specific deals that no market model of this kind can see.`),
    H('What this can’t test'),
    LIST(
      'There is no record of 2000’s storefronts, so the 2000 shops are today’s minus the ones in newer buildings. The storefront test is really “does churn over 26 years keep the mix stable?”, not “does it reproduce history?”.',
      'Vacancy: the model ends with about 16% of storefronts empty; there is no good public figure for Watertown to compare.',
      'Traffic counts are mostly from 2009–2016, so 2000 traffic is borrowed from them, and there is nothing to check traffic change against.',
      'Prices are now an input through 2026, so the value rows above test the deflating and the local factor, not price prediction.',
      'Commercial value still comes out too high: new commercial buildings are valued at average construction cost, while real commercial assessments vary hugely.'
    ),
    el('p', { class: 'fine' }, `Run ${new Date(v.generated).toLocaleDateString()}, ${v.runs} seeds per mode. Census figures: 2000, 2010 and 2020 decennial counts. Price history: NeighborhoodScout repeat-sales appreciation for Watertown. Reproduce with node tools/validate.mjs.`),
  ];
}

// ---- "How sure is it?" ----
const SVGNS = 'http://www.w3.org/2000/svg';
const sv = (tag, attrs = {}, ...kids) => { const n = document.createElementNS(SVGNS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); for (const c of kids) n.append(c); return n; };
const STRAT_COL = { handsoff: '#8a8f98', mainstreet: '#c0392b', build: '#2b6cb0' };
function fanChart(u, key, title, fmt) {
  const W = 300, H = 150, L = 44, R = 8, T = 18, Bm = 22;
  const years = u.years, y0 = u.startY;
  let lo = Infinity, hi = -Infinity;
  for (const st of Object.values(u.strategies)) for (const [a, , c] of st.bands[key]) { lo = Math.min(lo, a); hi = Math.max(hi, c); }
  if (hi - lo < 1e-6) hi = lo + 1;
  const pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
  const X = (i) => L + ((W - L - R) * i) / years, Y = (v) => T + (H - T - Bm) * (1 - (v - lo) / (hi - lo));
  const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, class: 'fan', role: 'img', 'aria-label': title });
  svg.append(sv('text', { x: L, y: 12, class: 'fan-t' }, title));
  for (const f of [0, 0.5, 1]) {
    const v = lo + (hi - lo) * f, y = Y(v);
    svg.append(sv('line', { x1: L, x2: W - R, y1: y, y2: y, class: 'fan-grid' }), sv('text', { x: L - 4, y: y + 3, class: 'fan-ax', 'text-anchor': 'end' }, fmt(v)));
  }
  for (const i of [0, years / 2, years]) svg.append(sv('text', { x: X(i), y: H - 6, class: 'fan-ax', 'text-anchor': i === 0 ? 'start' : i === years ? 'end' : 'middle' }, String(y0 + i)));
  for (const [st, d] of Object.entries(u.strategies)) {
    const b = d.bands[key];
    const top = b.map((q, i) => `${X(i)},${Y(q[2])}`), bot = b.map((q, i) => `${X(i)},${Y(q[0])}`).reverse();
    svg.append(sv('polygon', { points: top.concat(bot).join(' '), fill: STRAT_COL[st], 'fill-opacity': 0.14 }));
    svg.append(sv('polyline', { points: b.map((q, i) => `${X(i)},${Y(q[1])}`).join(' '), fill: 'none', stroke: STRAT_COL[st], 'stroke-width': 2 }));
  }
  return svg;
}
function uncertaintyChapter(u) {
  const pct = (x) => `${Math.round(x * 100)}%`;
  const R = u.ranges;
  const name = { vib: 'Vibrancy', walk: 'walking trips', indies: 'independent shops', funds: 'reserves' };
  const top = (k) => (u.drivers[k] || []).slice(0, 2).map(([p, c]) => `${R[p] ? R[p].label.toLowerCase() : p} (${c > 0 ? 'more → higher' : 'more → lower'})`).join(' and ');
  return [
    P(`Each of ${u.draws} runs draws its own values for the knobs below, then plays ${u.years} years from ${u.startY} under three simple strategies, reusing the same draws for each strategy so they're compared fairly. Bands show the middle 80% of outcomes (10th to 90th percentile); lines are medians. No Council agenda, no Melora, no Vale: just the model's slow forces.`),
    el('div', { class: 'fanlegend' }, ...Object.entries(u.strategies).map(([k, d]) => el('span', {}, el('i', { style: `background:${STRAT_COL[k]}` }), d.label))),
    el('div', { class: 'fans' },
      fanChart(u, 'vib', 'Vibrancy', (v) => v.toFixed(0)),
      u.strategies.handsoff.bands.walk ? fanChart(u, 'walk', 'Walking trips a day', (v) => `${(v / 1000).toFixed(1)}k`) : null,
      fanChart(u, 'indies', 'Independent shops', (v) => fmtInt(v)),
      fanChart(u, 'funds', 'City reserves ($M)', (v) => v.toFixed(0)),
      fanChart(u, 'approval', 'Approval (%)', (v) => v.toFixed(0))),
    H('Which choices hold up?'),
    LIST(
      `Main Street policies end with more independent shops than doing nothing in ${pct(u.pairs['mainstreet:indies'])} of draws, higher vibrancy in ${pct(u.pairs['mainstreet:vib'])}, and more money in the bank in ${pct(u.pairs['mainstreet:funds'])}.`,
      `Rebuilding auto lots ends with higher vibrancy than doing nothing in ${pct(u.pairs['build:vib'])} of draws, more homes in ${pct(u.pairs['build:homes'])}, and more money in the bank in ${pct(u.pairs['build:funds'])}.`,
      ...(u.pairs['build:walk'] != null ? [`Walking trips, which don't score auto uses at all: rebuilding auto lots ends higher in ${pct(u.pairs['build:walk'])} of draws, Main Street policies in ${pct(u.pairs['mainstreet:walk'])}.`] : [])
    ),
    el('p', { class: 'fine' }, 'Vibrancy comparisons involving auto lots are partly true by definition in the thesis model (auto uses are scored as dead frontage); walking trips is the cleaner test. See the Vibrancy chapter.'),
    P('A choice that wins in nearly every draw is robust: it holds up even if the model is wrong in any of these ways. One that wins about half the time depends on things nobody knows yet. (With this many runs, “every draw” means roughly 9 in 10 or better, not certainty.)'),
    H('What the spread depends on'),
    LIST(...['vib', 'walk', 'indies', 'funds'].filter((k) => u.drivers[k]).map((k) => `${name[k][0].toUpperCase() + name[k].slice(1)} (hands off) depends most on ${top(k)}.`)),
    el('p', { class: 'fine' }, 'Measured with a standardized rank regression across the runs, so each knob gets credit only for its own effect.'),
    H('The ranges'),
    TABLE(['Uncertain knob', 'Low', 'High'], Object.values(R).map((d) => ({ cells: [d.label, rangeFmt(d, d.lo), rangeFmt(d, d.hi)] }))),
    el('p', { class: 'fine' }, `Run ${new Date(u.generated).toLocaleDateString()}. Reproduce with node tools/uncertainty.mjs. Ranges are judgment calls around the calibrated values, wide on purpose.`),
  ];
}
function rangeFmt(d, v) {
  if (/growth after|cost growth/i.test(d.label)) return `${(v * 100).toFixed(1)}%/yr`;
  if (/renovations/i.test(d.label)) return `${(v * 100).toFixed(1)}% of levy`;
  if (/closures/i.test(d.label)) return `${(v * 1200).toFixed(1)}%/yr`;
  if (/homebuilding/i.test(d.label)) return `×${v.toFixed(2)}`;
  if (/warming/i.test(d.label)) return `${v.toFixed(1)}°F/decade`;
  return `${Math.round(v * 100)}%`;
}

export function behindScenes(ui, start = 'why') {
  ui.btsCh = ui.btsCh || start;
  ui.win('bts', 'Behind the scenes', (body) => {
    const k = Math.max(0, CHAPTERS.findIndex((c) => c.id === ui.btsCh));
    const ch = CHAPTERS[k];
    const go = (id) => () => {
      ui.btsCh = id;
      ui.wins.get('bts').refresh();
      ui.wins.get('bts').body.scrollTop = 0;
    };
    const nav = el('div', { class: 'btsnav' }, ...CHAPTERS.map((c) => el('button', { class: c.id === ch.id ? 'on' : '', onclick: go(c.id) }, c.title)));
    let content;
    try {
      content = ch.build(ui.g);
    } catch (e) {
      content = [P('This page could not be built: ' + e.message)];
    }
    const prev = CHAPTERS[k - 1], next = CHAPTERS[k + 1];
    body.append(
      nav,
      el('h3', {}, ch.title),
      el('div', { class: 'btsbody' }, ...content),
      el('div', { class: 'btsfoot' },
        prev ? el('button', { class: 'btn', onclick: go(prev.id) }, `← ${prev.title}`) : el('span'),
        next ? el('button', { class: 'btn', onclick: go(next.id) }, `${next.title} →`) : el('span'))
    );
  }, { cls: 'bts' });
}
