// Help → "Behind the scenes": why the game exists and how each model works.
// Numbers quoted here are the ones the code uses; live figures come from the running city.
import { el, fmtInt } from './util.js';
import { WALK_WEIGHTS } from './walkscore.js';
import { CAT_WEIGHT } from './vibrancy.js';
import { CFG } from './config.js';

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
      NOTE(B('Doing nothing is not neutral. '), 'Leave the game running untouched for 15 years and the town hollows out: independents drop from about 340 to under 100, chains rise from about 30 to over 200, and the budget drifts into the red. That is the model’s outcome, not a forecast, but it’s the pressure the game is built around.'),
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
        P('Vibrancy is the game’s measure of street life: how much worth walking to there is near where people live, and whether enough people are around to use it. It’s built in four steps.'),
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
      NOTE('All rents are an index relative to 2027 (1.00 = today), because real commercial asking rents aren’t public data. The real map sets the starting point; the dynamics describe what happens after you take office.'),
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
        [A('https://www.walkscore.com/methodology.shtml', 'Walk Score methodology'), ', the structure of the walkability index (no Walk Score data is used)'],
        [A('https://www.mass.gov/info-details/levy-limits-a-primer-on-proposition-2-12', 'Levy Limits: A Primer on Proposition 2½'), ', MA Division of Local Services'],
        [A('https://www.watertownmanews.com', 'Watertown News'), ', inspiration for the agenda']
      ),
      P('Inspired by SimCity 2000. Not affiliated with Maxis or Electronic Arts. Source code: ', A('https://github.com/samuelling/Townies', 'github.com/samuelling/Townies'), '.'),
    ],
  },
];

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
