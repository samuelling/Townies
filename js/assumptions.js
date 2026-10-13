// Model assumptions, separated by how much evidence stands behind them.
// "Thesis" mode is the game as designed: an argument that Watertown's retail is being hollowed out by
// speculative landlords, credit-tenant chains and auto-oriented land use. "Neutral" mode switches the
// stylized, argument-carrying assumptions to plain market fundamentals, so you can see which outcomes
// come from the data and standard methods, and which come from the thesis.
export const EVIDENCE = {
  data: 'Real data',
  method: 'Standard method',
  stylized: 'Stylized (the thesis)',
};

export const ASSUMPTIONS = {
  prospectors: {
    label: 'Speculating landlords',
    evidence: 'stylized',
    thesis: 0.27, neutral: 0,
    fmt: (v) => (v ? `${Math.round(v * 100)}% of owners price 20–50% above market once buzz builds, and hold out` : 'Every owner prices at the market'),
    why: 'Anecdotes and local reporting describe owners holding storefronts empty for higher rents; there is no public data on how common it is in Watertown.',
  },
  buzz: {
    label: '“Watertown is on the rise” buzz',
    evidence: 'stylized',
    thesis: 1, neutral: 0,
    fmt: (v) => (v ? 'Regional buzz builds on its own and pushes asking rents up' : 'Asking rents follow land values and foot traffic only'),
    why: 'Expectation-driven rents are real, but their size and timing here are guesses.',
  },
  chainTilt: {
    label: 'Chains win when rents rise',
    evidence: 'stylized',
    thesis: 1, neutral: 0,
    fmt: (v) => (v ? 'National chains outbid independents more often as speculation grows' : 'Chains and independents compete on equal terms'),
    why: 'Landlords and lenders prefer credit tenants; how strongly that tilts leasing in this market is assumed.',
  },
  frontage: {
    label: 'What counts as street life',
    evidence: 'stylized',
    thesis: 1, neutral: 0,
    fmt: (v) => (v ? 'Independents count more than chains; signature shops 1.6×; auto lots and parking subtract' : 'Every open business counts the same; auto lots and parking are just quiet'),
    why: 'Urban-design research (Jacobs, Gehl) supports active, varied frontage, but the specific weights are the designer’s.',
  },
  marketChains: {
    label: 'What the market builds by default',
    evidence: 'stylized',
    thesis: 0.25, neutral: 0.5,
    fmt: (v) => `When developers rebuild empty lots on their own, ${Math.round(v * 100)}% of ground-floor shops are local`,
    why: 'Large new mixed-use buildings in the region lease heavily to chains, but no local count was made.',
  },
};

export const PRESETS = { thesis: 'Thesis', neutral: 'Neutral' };

export function initAssumptions(sim, preset = 'thesis') {
  sim.assume = { preset };
  for (const [k, a] of Object.entries(ASSUMPTIONS)) sim.assume[k] = a[preset === 'neutral' ? 'neutral' : 'thesis'];
  return sim.assume;
}
export const A = (sim, k) => (sim.assume && sim.assume[k] != null ? sim.assume[k] : ASSUMPTIONS[k].thesis);
export function presetOf(sim) {
  const a = sim.assume || {};
  const isT = Object.keys(ASSUMPTIONS).every((k) => (a[k] ?? ASSUMPTIONS[k].thesis) === ASSUMPTIONS[k].thesis);
  const isN = Object.keys(ASSUMPTIONS).every((k) => (a[k] ?? ASSUMPTIONS[k].thesis) === ASSUMPTIONS[k].neutral);
  return isT ? 'thesis' : isN ? 'neutral' : 'custom';
}
