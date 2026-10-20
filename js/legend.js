// Legends for the map overlays: what each colour means, in units a person can interpret.
import { CFG, SERVICES, ZONE_NAME } from './config.js';
import { rampColor, walkColor, vibColor, ZONE_RGB, GROWTH_RGB } from './sim.js';

const rgba = (c) => `rgba(${c[0]},${c[1]},${c[2]},${((c[3] ?? 255) / 255).toFixed(2)})`;
const sample = (fn, a, b, n = 12) => Array.from({ length: n + 1 }, (_, k) => fn(a + ((b - a) * k) / n));
const money = (v) => (v >= 100 ? `$${Math.round(v / 10) * 10}` : `$${Math.round(v)}`);
const km = (tiles) => (tiles * CFG.TILE_M) / 1000;

// mean of a cell field over cells where people live, frozen at first use so "× average" means "× the town at the start"
function meanWhereLiving(sim, arr, key) {
  sim.base = sim.base || {};
  if (sim.base[key] == null) {
    let s = 0, n = 0;
    for (let i = 0; i < arr.length; i++) if (sim.popC[i] > 0) { s += arr[i]; n++; }
    sim.base[key] = n ? s / n : 1;
  }
  return sim.base[key] || 1;
}

export function legendFor(sim, mode) {
  const w = sim.w;
  switch (mode) {
    case 'landvalue': {
      // overlay value v = land $/m² ÷ (2.2 × the town's median), clipped at 1
      const perSqft = (v) => (v * w.lvMedian * 2.2) / 10.764;
      return {
        title: 'Land value', unit: 'assessed land, $ per sq ft',
        stops: sample(rampColor, 0, 1),
        ticks: [0, 0.25, 0.5, 0.75, 1].map((v) => ({ at: v, label: (v === 1 ? '≥' : '') + money(perSqft(v)) })),
        note: `Town median ≈ ${money(perSqft((sim.market || 1) / 2.2))}/sq ft. Rises with the market, parks and street life; falls with crime, pollution and traffic.`,
      };
    }
    case 'traffic':
      return {
        title: 'Traffic', unit: 'peak volume ÷ road capacity',
        stops: sample(rampColor, 0, 1),
        ticks: [{ at: 0, label: '0%' }, { at: 0.36, label: '50%' }, { at: 0.71, label: '100%' }, { at: 1, label: '≥140%' }],
        note: 'Under ~70% flows freely; over 100% means queues at rush hour.',
      };
    case 'crime': {
      const mean = meanWhereLiving(sim, sim.crimeC, 'crimeMeanCell');
      const x = (v) => (v * 1.4 * sim.base.crimeN) / mean;
      return {
        title: 'Crime risk', unit: `× the town average in ${sim.y0 ?? CFG.START.y}`,
        stops: sample(rampColor, 0, 1),
        ticks: [0, 0.33, 0.67, 1].map((v) => ({ at: v, label: (v === 1 ? '≥' : '') + `${x(v).toFixed(1)}×` })),
        note: 'A model index (more people and jobs, less police coverage), not reported crime.',
      };
    }
    case 'pollution': {
      const mean = meanWhereLiving(sim, sim.pollC, 'pollMeanCell');
      const x = (v) => (v * 1.4 * sim.base.pollN) / mean;
      return {
        title: 'Air pollution', unit: `× the town average in ${sim.y0 ?? CFG.START.y}`,
        stops: sample(rampColor, 0, 1),
        ticks: [0, 0.33, 0.67, 1].map((v) => ({ at: v, label: (v === 1 ? '≥' : '') + `${x(v).toFixed(1)}×` })),
        note: 'From traffic and industry. Electric cars bring it down over time.',
      };
    }
    case 'police':
    case 'fire': {
      // coverage = 1.4 × (1 − distance / radius), capped at 1 and scaled by funding; overlay shows 1 − coverage
      const R = SERVICES[mode].radius;
      const d = (cov) => km(R * (1 - cov / 1.4));
      const fund = sim.fund ? sim.fund[mode] : 1;
      return {
        title: mode === 'police' ? 'Police coverage' : 'Fire coverage', unit: 'distance to the nearest station',
        stops: sample(rampColor, 0, 1),
        ticks: [{ at: 0, label: `≤${d(1).toFixed(1)} km` }, { at: 0.5, label: `${d(0.5).toFixed(1)} km` }, { at: 1, label: `≥${km(R).toFixed(1)} km` }],
        note: `Full coverage near a station, none beyond ${km(R).toFixed(1)} km.${fund < 0.98 ? ` Funding at ${Math.round(fund * 100)}% caps coverage at ${Math.round(fund * 100)}%.` : ''}`,
      };
    }
    case 'walk':
      return {
        title: 'Walkability', unit: 'Walk Score–style index, 0–100',
        stops: sample(walkColor, 0.01, 1),
        ticks: [{ at: 0, label: '0' }, { at: 0.25, label: '25' }, { at: 0.5, label: '50' }, { at: 0.7, label: '70' }, { at: 0.9, label: '90' }, { at: 1, label: '' }],
        note: 'Under 50 car-dependent · 50–69 somewhat walkable · 70–89 very walkable · 90+ walker’s paradise (daily errands need no car). Rebuilt from open data; runs a little above Walk Score’s own numbers.',
      };
    case 'vibrancy':
      return {
        title: 'Street life', unit: 'within a 5-minute walk, 0–100',
        stops: sample(vibColor, -0.6, 1, 16),
        // the colour bar spans −0.6…1 in the model; position 0 sits at 0.6/1.6 of the bar
        ticks: [{ at: 0, label: 'dead' }, { at: 0.375, label: '0' }, { at: 0.375 + 0.625 * 0.5, label: '50' }, { at: 1, label: '100' }],
        note: 'Same scale as Vibrancy in the status bar, which averages this over every resident. Brown: auto lots, parking and empty storefronts drag the block down.',
      };
    case 'zones':
      return {
        title: 'Zoning', items: [1, 2, 3, 4, 5].map((z) => ({ color: rgba([...ZONE_RGB[z], 230]), label: ZONE_NAME[z] })).concat([{ color: 'rgba(80,80,80,0.7)', label: 'Streets' }]),
        note: 'Solid = dense zoning; faint = light.',
      };
    case 'mission':
      return sim.missionLegend || null;
    case 'growth':
      return {
        title: 'New & abandoned', items: [{ color: rgba(GROWTH_RGB.built), label: 'Built since you took office' }, { color: rgba(GROWTH_RGB.aband), label: 'Abandoned (under 30% occupied)' }],
      };
  }
  return null;
}

export function legendCss(stops) {
  return `linear-gradient(to right, ${stops.map((c, k) => `${rgba(c)} ${((k / (stops.length - 1)) * 100).toFixed(1)}%`).join(', ')})`;
}
