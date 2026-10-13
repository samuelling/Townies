// Guided first session for new players: a coach card that walks through the main loops and
// advances when the player actually does each thing (or taps Next).
import { el } from './util.js';
import { spawn } from './incidents.js';

const STEPS = [
  {
    title: 'Welcome to Watertown',
    text: 'This is the real town, true to scale: every street, building and parcel. You’re the new City Manager. Drag to look around; pinch or scroll to zoom. Time is paused while you learn.',
  },
  {
    title: 'Look anything up',
    text: 'Pick the Query tool (highlighted) and tap any house or shop. You’ll get the real assessor record (value, year built, style) plus how walkable and lively that spot is.',
    hl: (ui) => ui.toolBtns.query,
    enter: (ui) => ui.setTool('query'),
    done: (ui) => ui.wins.has('query'),
  },
  {
    title: 'Read the card',
    text: 'Street life and Walkability show how much is worth walking to nearby. The quote at the bottom is a neighbor’s opinion, invented but in character. Close the card when you’re ready.',
  },
  {
    title: 'The number that matters',
    text: 'Vibrancy in the status bar measures street life near where people live: independent cafés, bookstores, boutiques and galleries count most, and auto shops and parking lots count against it. Tap it to open Main Street.',
    hl: (ui) => ui.sVib,
    done: (ui) => ui.wins.has('main'),
  },
  {
    title: 'Main Street',
    text: 'Every storefront has a lease. When buzz builds, landlords raise rents, independents close, and chains or empty windows replace them. The policies here (vacancy fees, rent relief, chain limits…) are how you push back. Scroll down to see how the Square compares with Davis Square and Moody Street.',
  },
  {
    title: 'Something broke',
    text: 'A pothole just opened near the Square (🚧). Tap it on the map to send a Public Works crew. Problems left too long cost you approval.',
    enter: (ui) => {
      const s = ui.sim, w = ui.w;
      const [sx, sy] = w.start;
      let best = -1, bd = Infinity;
      for (const i of s.roadList) {
        if (!w.inTown[i] || w.road[i] < 1) continue;
        const d = Math.hypot((i % w.W) - sx, ((i / w.W) | 0) - sy);
        if (d > 6 && d < bd) { bd = d; best = i; }
      }
      s.inc.hinted = 1; // the coach card explains it; skip the generic toast
      const it = spawn(s, 'pothole', best, { tut: 1 });
      if (it) {
        ui.tutInc = it.id;
        ui.r.centerOn(it.x, it.y);
        ui.r.needs = true;
      }
    },
    done: (ui) => {
      const it = ui.sim.inc.list.find((x) => x.id === ui.tutInc);
      return !it || !!it.crew;
    },
  },
  {
    title: 'Let time run',
    text: 'Press ▶ (highlighted) to start the clock, and press it again to go faster. Each month rents reset, shops open and close, the budget books, and the Council brings you agenda items.',
    hl: (ui) => ui.speedBtn,
    done: (ui) => ui.g.speed > 0,
  },
  {
    title: 'Build something',
    text: 'Watertown is already built, so building means redevelopment. Choose the crane (Redevelop) and drag a box over a car lot or parking lot. The planner shows whether a developer would build it and the Planning Board’s odds. You don’t have to submit anything.',
    hl: (ui) => ui.toolBtns.develop,
    done: (ui) => ui.wins.has('planner'),
  },
  {
    title: 'Money',
    text: 'Open Windows → Budget. Massachusetts’ Prop 2½ lets the tax levy grow only 2.5% a year plus new construction, while costs grow faster. New growth or a voter override are the ways out.',
    done: (ui) => ui.wins.has('budget'),
  },
  {
    title: 'You’re ready',
    text: 'This is the sandbox: no deadline, just keep the Council happy and the budget balanced. For a mission, use File → New term. Help → Behind the scenes explains how every model in the game works.',
    last: true,
  },
];

export function startTutorial(ui) {
  const g = ui.g;
  g.tutorial = true;
  ui.setSpeed(0);
  let k = -1, timer = null, hlEl = null;
  const card = el('div', { class: 'coach' });
  document.body.append(card);
  const clearHl = () => {
    if (hlEl) hlEl.classList.remove('coach-hl');
    hlEl = null;
  };
  const end = () => {
    clearHl();
    clearInterval(timer);
    card.remove();
    g.tutorial = false;
    try { localStorage.setItem('townies-tutorial', 'done'); } catch (e) {}
  };
  const show = (i) => {
    k = i;
    clearHl();
    const st = STEPS[k];
    if (st.enter) st.enter(ui);
    if (st.hl) {
      hlEl = st.hl(ui);
      if (hlEl) hlEl.classList.add('coach-hl');
    }
    card.innerHTML = '';
    const next = el('button', { class: 'btn primary', onclick: () => (k + 1 < STEPS.length ? show(k + 1) : end()) }, st.last ? 'Start playing' : st.done ? 'Skip step' : 'Next');
    card.append(
      el('div', { class: 'coachbar' }, el('span', {}, `Tutorial · ${k + 1} of ${STEPS.length}`), el('button', { class: 'wclose', title: 'End tutorial', onclick: end }, '×')),
      el('b', {}, st.title),
      el('p', {}, st.text),
      el('div', { class: 'coachbtns' },
        st.last ? el('button', { class: 'btn', onclick: () => { end(); ui.behindScenes(); } }, 'Behind the scenes') : st.done ? el('small', {}, 'Waiting for you…') : el('span'),
        next)
    );
  };
  timer = setInterval(() => {
    const st = STEPS[k];
    if (st && st.done && st.done(ui)) {
      card.classList.add('ok');
      setTimeout(() => card.classList.remove('ok'), 500);
      show(k + 1);
    }
  }, 300);
  show(0);
}
