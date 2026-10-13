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
  melodia: { name: 'Melodia', color: '#b0306a', faction: 'homeowners', bio: 'Has attended every public meeting since 2009. Reads every appendix. Brings a binder. Means well, which is the problem.' },
};

const fill = (t, c) => t.replace(/\{(\w+)\}/g, (_, k) => (c[k] != null ? String(c[k]) : ''));

// Templates per event type: [castKey, text] — picked 1–3 per event.
const T = {
  'close-indie': [
    ['melodia', 'This is the developers\' fault. All of them. I have been saying it for years.'],
    ['foodie', 'Another one. {name} was the reason I walked down {street} at all.'],
    ['foodie', 'RIP {name}. Watch it become a phone store.'],
    ['lifer', 'First the post office, now {name}. What is left?'],
    ['carol', 'Everyone says "support small business" and then the landlord triples the rent. {name} never stood a chance.'],
    ['mall', "Sad, but there's a great one at Arsenal Yards with parking."],
    ['yimby', 'Small shops need customers who live within walking distance. Build more homes near {street} and places like {name} survive.'],
    ['tom', 'The market has spoken. The City should not be in the business of picking winners.'],
  ],
  'tech-arrive': [
    ['melodia', 'Has anyone studied the cumulative impacts of {name} on our neighborhoods? I have some questions. I have printed them.'],
    ['lifer', 'I remember when the future was a Walkman. Now it is {name}.'],
    ['tom', 'Who pays for the infrastructure for {name}? Asking for every taxpayer.'],
    ['yimby', 'Great, now can we have {name} AND enough homes?'],
    ['barb', 'Whatever {name} is, I hope it comes with a bike lane.'],
    ['mall', 'Arsenal Yards will have {name} first, mark my words.'],
    ['dad', 'Is {name} safe around kids? Has anyone asked?'],
  ],
  'tech-autoclose': [
    ['pete', 'Forty years of oil changes and brake jobs on {street}. Electric cars don\'t need us. I get it, but it stings.'],
    ['pete', 'They\'ll miss us the first time a robot can\'t fix a pothole-bent rim.'],
    ['yimby', 'That lot on {street} could hold sixty homes and a café. Please, not another chain pharmacy.'],
    ['foodie', 'Put a bakery where the service bays were. I\'m begging.'],
    ['lifer', 'My father bought gas there. End of an era.'],
    ['carol', 'Watch the asking rent on that corner. The owner\'s already "exploring options."'],
  ],
  'tech-hub': [
    ['barb', 'Sixteen chargers and a coffee counter on {street}. Fine, I\'ll admit the coffee is good.'],
    ['mall', 'Finally somewhere to charge that isn\'t a garage.'],
    ['tom', 'Who\'s paying for the new transformer? Not the meter, I bet.'],
  ],
  'tech-parking': [
    ['melodia', 'Where will VISITORS park? Where will GRANDPARENTS park? Nobody thinks about grandparents.'],
    ['yimby', 'We paved paradise, then the robotaxis un-needed the parking lot. Build homes!'],
    ['mall', 'Where am I supposed to park?? Oh right. I don\'t, anymore.'],
    ['foodie', 'Apartments over a chain burrito place. The future is so convenient and so beige.'],
    ['dad', 'More people, fewer parked cars, same crosswalk. Can we fix the crosswalk?'],
  ],
  'tech-redev': [
    ['melodia', 'Another out-of-town developer. Another box. I will be submitting comments.'],
    ['carol', 'New ground-floor rents on {street}: national tenant pricing. Of course.'],
    ['yimby', 'Homes where the oil changes used to be. I\'ll take it.'],
    ['foodie', 'Another one of those buildings. Wake me when a real restaurant moves in.'],
    ['pete', 'Used to be a garage. Now it\'s "luxury living." Huh.'],
  ],
  'melodia-delay': [
    ['melodia', 'All I asked for was time to read it properly. Is that so much to ask? Apparently 212 pages is "a lot."'],
    ['yimby', 'Melodia singlehandedly added two months and a few hundred thousand dollars to {name}. Every month of delay is rent for somebody.'],
    ['lifer', 'Good for Melodia. Somebody has to read these things.'],
    ['tom', 'Staff overtime to process the binder. Who do you think pays for that?'],
    ['carol', 'Every month that block sits there, my landlord gets more ideas.'],
  ],
  'melodia-testify': [
    ['melodia', 'I spoke for my allotted three minutes. Then I yielded my time to myself, from my husband\'s card.'],
    ['yimby', 'She got applause for opposing homes for the people who will one day bag her groceries.'],
    ['dad', 'To be fair, the traffic point was a good one. The hawk part, less so.'],
    ['lifer', 'Melodia said what a lot of us are thinking.'],
  ],
  'melodia-point': [
    ['melodia', 'This is why we READ THE DOCUMENTS, people.'],
    ['yimby', 'Okay. Credit where due. Melodia found a real one.'],
    ['tom', 'A broken clock, etc. But yes, good catch.'],
  ],
  'melodia-win': [
    ['melodia', 'A victory for the neighborhood! Now let\'s talk about what SHOULD go there. (A park. Obviously a park.)'],
    ['yimby', 'The lot will be a fenced-off weed farm for another decade. Congrats.'],
    ['carol', 'So nothing gets built and my rent still goes up. Cool.'],
    ['lifer', 'Melodia fought for us. I don\'t care what the YIMBYs say.'],
  ],
  'melodia-aftermath': [
    ['yimby', 'Remember when Melodia "saved" that block? Rents within three blocks are up again. Supply and demand did not get the memo.'],
    ['melodia', 'The site is still there for the right project. I have some ideas. I have printed them.'],
    ['carol', 'A year of nothing. My landlord says the neighborhood is "in demand."'],
  ],
  'melodia-ambient': [
    ['melodia', 'Reminder: Planning Board meets Tuesday. Agenda posted on page 6 of the PDF. Bring water, it runs late.'],
    ['melodia', 'I have filed a public records request about the trees on School Street. Updates to follow. Many updates.'],
    ['melodia', 'As someone who has lived here 31 years: this town used to have CHARACTER. And parking.'],
    ['melodia', 'I am not a NIMBY. I just think every project should be smaller, shorter, further away, and also a park.'],
    ['melodia', 'Why was the meeting moved to 6:30? Who benefits? (Developers.)'],
    ['melodia', 'I support affordable housing. Just not like this, not there, and not yet.'],
    ['melodia', 'Has anyone else noticed the crosswalk paint on Main Street is a slightly different white? I have emailed the DPW.'],
    ['editor', 'Editor\'s note: Melodia, comments are limited to 500 words. Please stop splitting them into parts 1 through 9.'],
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
    ['melodia', 'And THIS is what the new buildings bring. I warned everyone.'],
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
    ['melodia', 'Did anyone do a shadow study for {street}? Asking for the tomatoes in my garden.'],
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
    ['melodia', 'I sat on Main Street for three hours with a clicker. The numbers do not lie. Well, the City\'s numbers might.'],
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
  'fixed-late': [
    ['dad', 'The {what} on {street} is finally fixed. Only took {days} days.'],
    ['tom', '{days} days for one {what}. Where does the Public Works budget go?'],
    ['lifer', 'They fixed the {what} on {street}. I will believe it lasts when I see it.'],
  ],
  unfixed: [
    ['dad', 'That {what} on {street} has been there for weeks. I have reported it to the city app three times.'],
    ['mall', 'Lost a hubcap to the {what} on {street}. Thanks, City Hall.'],
    ['barb', 'The {what} on {street} nearly threw me off my bike.'],
  ],
  'fire-lost': [
    ['lifer', 'Where were the engines? We used to have a station closer to {street}.'],
    ['dad', 'Thank god everyone got out. How long did the trucks take?'],
    ['tom', 'This is what happens when you cut the fire budget.'],
  ],
  'project-proposed': [
    ['melodia', 'I am NOT anti-development. I am anti-THIS development. Has anyone read Appendix F of the {name} filing? I have.'],
    ['melodia', '{floors} stories on {street}?? I will be at the hearing. I hope my neighbors will be too. Bring your questions.'],
    ['lifer', '{floors} stories on {street}? This is not Cambridge.'],
    ['yimby', 'More homes near transit and shops. Approve it.'],
    ['dad', 'Has anyone done a traffic study for {street} at school pickup?'],
    ['foodie', 'Will the ground floor be real shops or another bank and a phone store?'],
    ['tom', 'Who pays for the extra school seats?'],
    ['pete', 'And where do the businesses on that block go? Nobody ever asks us.'],
    ['mall', 'As long as there is a garage, I am in.'],
  ],
  'project-continued': [
    ['melodia', 'The Board made the right call. There were 31 unanswered questions. I counted.'],
    ['yimby', 'Four hours of public comment to decide nothing. Classic.'],
    ['lifer', 'Good. Slow down.'],
  ],
  'project-denied': [
    ['melodia', 'This is what happens when residents show up. Thank you to everyone who stayed until 11:40.'],
    ['yimby', 'And rents go up again. Congratulations, everyone.'],
    ['lifer', 'The neighborhood spoke. Thank you to the Board.'],
    ['carol', 'Something has to happen on that block eventually.'],
  ],
  'project-approved': [
    ['melodia', 'Approved without a cumulative impacts study. I said this at the meeting. I will say it again at the next one.'],
    ['dad', 'Construction on {street} for two years. Pray for us.'],
    ['yimby', '{name} approved! Shovels in the ground.'],
    ['lifer', 'Mark my words: we will regret {name}.'],
  ],
  'project-open-mega': [
    ['mall', '{name} is open and it has everything! Free parking for two hours!'],
    ['foodie', 'Walked {name}. A bank, a phone store, a salad chain and a gym. Could be anywhere in America.'],
    ['yimby', 'Hundreds of new neighbors at {name}. That is a win, chains or not.'],
    ['lifer', 'Another glass box with a garage. This is the new Watertown, I guess.'],
  ],
  'project-open-infill': [
    ['foodie', 'The new storefronts on {street} are exactly what this town needed. Bookstore! Bakery! Actual people on the sidewalk!'],
    ['carol', 'Rents capped for fifteen years on {street}. That is how you keep a small shop alive.'],
    ['lifer', 'Okay. The new buildings on {street} actually look like they belong here.'],
    ['tom', 'Lovely. How much did the City pay for that land again?'],
    ['barb', 'Rode down {street} and had to slow down because there were PEOPLE. Love it.'],
  ],
  'project-open-housing': [
    ['yimby', 'Keys handed out at {name} today. Real homes for real people.'],
    ['dad', 'More kids for the schools. Hope the budget keeps up.'],
    ['lifer', 'Where will they all park?'],
  ],
  'project-open-lab': [
    ['tom', 'Finally, a big commercial taxpayer. That is what keeps my bill down.'],
    ['foodie', 'A lab. With a lobby. Nobody will ever walk past it on purpose.'],
    ['dad', 'Rush hour on {street} just got worse.'],
  ],
  'project-open-plaza': [
    ['foodie', 'Got a coffee at the kiosk in {name} and sat in the sun. Felt like a real town square.'],
    ['lifer', 'They built a place to sit downtown. About time.'],
    ['barb', '{name} is full of kids and dogs and people. This is what downtown is for.'],
    ['tom', 'Nice park. Expensive park.'],
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
  if (!lot) return '';
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
