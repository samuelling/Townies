// The comment section: a cast of recurring (entirely fictional) regulars who react to what you do.
// Inspired by the tone of local-news comment threads; no real people or real commenters.
import { hash2 } from './util.js';

export const CAST = {
  lifer: { name: 'LifelongWatertowner', color: '#7a5c3a', faction: 'seniors', bio: 'Born at the old hospital. Remembers when the Square had a Woolworth.' },
  dad: { name: 'EastEndDad', color: '#2b5fb8', faction: 'homeowners', bio: 'Two kids, one minivan, strong opinions about crosswalks.' },
  barb: { name: 'BikeLaneBarb', color: '#2e8a5f', faction: 'renters', bio: 'Rides the Community Path year-round. Yes, in February.' },
  pete: { name: 'PleasantStPete', color: '#a0522d', faction: 'business', bio: 'Runs a body shop his father opened in 1971.' },
  foodie: { name: 'SquareFoodie', color: '#c0392b', faction: 'renters', bio: 'Has eaten at every restaurant on Main St, including the ones that closed.' },
  tom: { name: 'TaxpayerTom', color: '#555', faction: 'homeowners', bio: 'Reads the budget. All of it.' },
  yimby: { name: 'YIMBYinWatertown', color: '#7b3f99', faction: 'renters', bio: 'Rents a one-bedroom for what her parents paid for a house.' },
  carol: { name: 'CoolidgeSqCarol', color: '#d68910', faction: 'business', bio: 'Owns a little shop near Coolidge Square. Knows exactly what her rent is.' },
  mall: { name: 'ArsenalYardsFan', color: '#1f7a8c', faction: 'commuters', bio: 'Thinks the parking garage is the best thing to happen to Watertown.' },
};

const fill = (t, c) => t.replace(/\{(\w+)\}/g, (_, k) => (c[k] != null ? String(c[k]) : ''));

// Templates per event type: [castKey, text] — picked 1–3 per event.
const T = {
  'close-indie': [
    ['foodie', 'Another one. {name} was the reason I walked down {street} at all.'],
    ['foodie', 'RIP {name}. Watch it become a phone store.'],
    ['lifer', 'First the post office, now {name}. What is left?'],
    ['carol', 'Everyone says "support small business" and then the landlord triples the rent. {name} never stood a chance.'],
    ['mall', "Sad, but there's a great one at Arsenal Yards with parking."],
    ['yimby', 'Small shops need customers who live within walking distance. Build more homes near {street} and places like {name} survive.'],
    ['tom', 'The market has spoken. The City should not be in the business of picking winners.'],
  ],
  'close-retire': [
    ['lifer', 'End of an era. {name} was there when my kids were small.'],
    ['foodie', 'Someone please take over {name}. Same recipes, same sign, I do not care.'],
    ['carol', 'Hope the landlord gives the next tenant a fair shot at that space on {street}.'],
    ['yimby', 'Congrats on retiring! Now let us see who can actually afford that rent.'],
  ],
  'open-indie': [
    ['foodie', 'Went to {name} on opening day. Get the {dish}. Trust me.'],
    ['foodie', 'Stopped into {name}. This is exactly what {street} needed.'],
    ['lifer', 'Give it six months.'],
    ['barb', 'Any chance {name} could get a bike rack out front?'],
    ['carol', 'Welcome to the neighborhood, {name}! Make sure your lease is longer than five years.'],
    ['dad', 'Kids already begging to go to {name}. Please slow down on {street}, people.'],
  ],
  'open-chain': [
    ['foodie', '{name}. On {street}. We have become a highway rest stop.'],
    ['mall', 'Finally! Love {name}.'],
    ['yimby', 'Better than an empty window, I guess.'],
    ['carol', 'Chains can sign ten-year leases at prices no independent can touch. That is the whole problem.'],
    ['lifer', 'How many of these do we need?'],
  ],
  holdout: [
    ['carol', 'That storefront would rent tomorrow at a sane price. The owner is waiting for a bank branch.'],
    ['yimby', 'Tax empty storefronts. Other cities do.'],
    ['tom', "It's their property. They can leave it empty if they want."],
    ['foodie', 'Nine months of brown paper in the window. Very vibrant.'],
  ],
  'policy-on:vacancyFee': [
    ['carol', 'Finally. Empty windows are not a business plan.'],
    ['tom', 'Telling owners what to do with their own property. Unbelievable.'],
    ['yimby', 'Good. Next: legalize apartments over every storefront.'],
  ],
  'policy-on:rentRelief': [
    ['carol', 'This is what keeps the lights on for shops like mine. Thank you.'],
    ['tom', 'So we are paying landlords with tax money now. Got it.'],
    ['foodie', 'Worth every penny if it keeps the bakery open.'],
  ],
  'policy-on:legacy': [
    ['lifer', 'About time someone noticed the places that were here before the labs.'],
    ['pete', 'Does a body shop count as a legacy business? Asking for my father.'],
  ],
  'policy-on:formulaRetail': [
    ['foodie', 'Yes! No more drive-through-in-a-strip-mall vibes in the Square.'],
    ['mall', 'So I have to drive to Waltham for a burrito now?'],
    ['tom', 'Government deciding which businesses we are allowed to have. What could go wrong.'],
  ],
  'policy-on:popups': [
    ['foodie', 'The pop-up gallery on Main St is the best thing to happen there in a year.'],
    ['lifer', 'Art in the old shoe store window. Okay, it is nice.'],
  ],
  'policy-off': [
    ['carol', 'And just like that, it is gone. Small businesses will remember this.'],
    ['tom', 'Good riddance.'],
  ],
  'taxes-up': [
    ['tom', 'Residential rate up again. Cut spending first.'],
    ['lifer', 'I am on a fixed income. Every year it goes up. Every year.'],
    ['yimby', 'Grow the tax base and the rate goes down. More homes, more shops.'],
  ],
  'taxes-down': [
    ['tom', 'Finally some relief. Now do it again.'],
    ['dad', "Nice, but don't touch the school budget."],
  ],
  'new-building': [
    ['yimby', 'More homes near {street}! This is how we stay a place people can live.'],
    ['lifer', 'Another box. Where will all these people park?'],
    ['dad', 'Great. More traffic on {street} at school pickup.'],
    ['foodie', 'More neighbors means more customers for the shops on {street}. I am in.'],
  ],
  'vibrancy-down': [
    ['foodie', 'Walked the Square tonight. Three empty windows on one block. This is how it starts.'],
    ['carol', 'Our foot traffic is down and our rent is up. Something has to give.'],
    ['lifer', 'The Square used to be the place. Now it is where you wait at the light.'],
  ],
  'vibrancy-up': [
    ['foodie', 'Main Street on a Friday night felt alive. Did not expect to say that.'],
    ['barb', 'Rode through the Square at 9pm and there were people everywhere. Love it.'],
  ],
  'traffic-bad': [
    ['dad', '25 minutes to get from Coolidge Square to the Square. That is 1.5 miles.'],
    ['mall', 'Just build more parking and widen the roads. Simple.'],
    ['barb', 'Or… hear me out… a bus that comes on time.'],
  ],
  'deficit': [
    ['tom', 'We are in the red. I said this would happen. I said it at public comment. Twice.'],
  ],
  agendaGood: [
    ['{who}', 'Finally, someone at City Hall listened on {topic}.'],
    ['{who}', 'Good call on {topic}. Did not expect that from this administration.'],
  ],
  agendaBad: [
    ['{who}', 'Typical. Nobody asked us about {topic}.'],
    ['{who}', 'Mark my words, {topic} will be a disaster. Remember who decided this.'],
    ['{who}', 'I spoke at public comment about {topic} for my full three minutes. Was anyone listening?'],
  ],
  'auto-closed': [
    ['pete', 'They will miss us when they need a timing belt and the nearest shop is in Waltham.'],
    ['foodie', 'Good riddance to another lot full of half-repaired cars.'],
    ['lifer', '{name} fixed my car for thirty years.'],
  ],
  'service-built': [
    ['dad', 'A new {what}! Long overdue.'],
    ['tom', 'And what will the {what} cost us every year after the ribbon is cut?'],
  ],
};
const DISHES = ['lamb sandwich', 'cardamom bun', 'lahmajoun', 'cortado', 'manti', 'pistachio croissant', 'spinach pie', 'egg sandwich'];
const BY_FACTION = { homeowners: ['dad', 'tom'], renters: ['yimby', 'barb', 'foodie'], seniors: ['lifer'], business: ['carol', 'pete'], commuters: ['mall'] };

export function react(sim, type, ctx = {}, newsItem = null, max = 2) {
  const pool = T[type];
  if (!pool) return [];
  sim.comments = sim.comments || [];
  const out = [];
  const used = new Set();
  const r = sim.rand;
  const n = Math.min(max, 1 + Math.floor(r() * max));
  for (let tries = 0; tries < 8 && out.length < n; tries++) {
    const [who0, text] = pool[Math.floor(r() * pool.length)];
    const who = who0 === '{who}' ? ctx.who : who0;
    if (!who || used.has(who) || used.has(text)) continue;
    if (text.includes('{dish}') && ctx.cat && ctx.cat !== 'food') continue;
    used.add(who);
    used.add(text);
    const c = { t: sim.t, date: sim.dateStr(), who, text: fill(text, { dish: DISHES[Math.floor(r() * DISHES.length)], ...ctx }), re: newsItem ? newsItem.title : ctx.re || '' };
    out.push(c);
    sim.comments.unshift(c);
  }
  // the editor's eternal plea
  if (out.length && r() < 0.08) {
    const c = { t: sim.t, date: sim.dateStr(), who: 'editor', text: `Editor's note: ${CAST[out[0].who] ? CAST[out[0].who].name : 'Commenters'}, please use your full first and last name when commenting.`, re: out[0].re };
    out.push(c);
    sim.comments.unshift(c);
  }
  if (newsItem) newsItem.comments = (newsItem.comments || []).concat(out);
  if (sim.comments.length > 150) sim.comments.length = 150;
  if (out.length && sim.hooks.comment) sim.hooks.comment(out[0]);
  return out;
}

// After an agenda choice: the factions it pleased or angered speak up.
export function reactAgenda(sim, title, approval = {}) {
  const entries = Object.entries(approval).filter(([k]) => k !== 'all');
  if (approval.all) for (const f of Object.keys(BY_FACTION)) entries.push([f, approval.all]);
  entries.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  const topic = title.replace(/[?.!]$/, '');
  for (const [f, v] of entries.slice(0, 2)) {
    if (Math.abs(v) < 2) continue;
    const who = BY_FACTION[f] ? BY_FACTION[f][Math.floor(sim.rand() * BY_FACTION[f].length)] : null;
    if (who) react(sim, v > 0 ? 'agendaGood' : 'agendaBad', { who, topic: `"${topic}"`, re: title }, null, 1);
  }
}

// Monthly mood: occasionally someone weighs in on how things are going.
export function ambient(sim) {
  if (sim.rand() > 0.35) return;
  const dv = sim.vibrancy - (sim.base.vib0 ?? sim.vibrancy);
  const last = sim.lastVibSay ?? sim.base.vib0 ?? sim.vibrancy;
  if (sim.vibrancy < last - 2.5) {
    sim.lastVibSay = sim.vibrancy;
    return react(sim, 'vibrancy-down', {}, null, 2);
  }
  if (sim.vibrancy > last + 2.5) {
    sim.lastVibSay = sim.vibrancy;
    return react(sim, 'vibrancy-up', {}, null, 1);
  }
  if ((sim.congAvg || 0) > (sim.base.cong0 || 0) + 0.08 && sim.rand() < 0.4) return react(sim, 'traffic-bad', {}, null, 2);
  if (sim.funds < 0 && sim.rand() < 0.4) return react(sim, 'deficit', {}, null, 1);
  void dv;
}

// What a neighbor on this block would say (deterministic per lot and season).
export function neighborQuote(sim, lot, c) {
  const lines = [];
  const vib = sim.vibSat ? sim.vibSat[c] : 0;
  const traf = sim.trafC[c] / (sim.base.trafN || 1);
  if (lot.under) lines.push('The jackhammers start at 7 a.m. sharp. Every. Single. Day.');
  if (lot.auto) lines.push('It is all tire shops and parking lots out here. Nobody walks this stretch unless their car is in the shop.');
  if (lot.vacant) lines.push(`That storefront has been empty for months. The landlord wants ${lot.ask > 1.3 ? 'Back Bay' : 'silly'} money for it.`);
  if (vib > 0.8) lines.push('I can walk to coffee, the bakery and a bookstore. I am never moving.');
  else if (vib > 0.5) lines.push('There are a few good spots within walking distance. Would love a decent bookstore.');
  else if (vib < 0.15 && lot.units) lines.push('Nice and quiet, but I have to drive for a cup of coffee.');
  if (traf > 1.3) lines.push('Cut-through traffic is brutal at rush hour. Waze sends everyone down our street.');
  if (sim.crimeC[c] / (sim.base.crimeN || 1) > 1.2) lines.push('Two catalytic converters stolen on this block last month.');
  if (lot.units && lot.dens <= 2 && sim.rates && lot.landVal > 0 && sim.market > 1.15) lines.push('Our assessment went up again. Love the house, hate the bill.');
  if (!lines.length) lines.push(lot.units ? 'It is a good street. People say hi. The plows could come sooner.' : 'Business is steady. Parking is the number one complaint.');
  const k = Math.floor(hash2(lot.id, sim.t >> 2, 5) * lines.length);
  return lines[k];
}
