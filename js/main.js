import { CFG } from './config.js';
import { loadRawData, fetchAssessor, fetchLidar, fetchTrees, fetchYards, fetchTransit, fetchGround, kvGet, kvSet, kvDel } from './data.js';
import { SHORT_CREDITS } from './credits.js';
import { setTransitData } from './transit.js';
import { buildWorld, applyAssessor, applyLidar, applyTrees, applyYards, applyGround } from './world.js';
import { Sim } from './sim.js';
import { Renderer } from './render.js';
import { UI } from './ui.js';
import { Music } from './music.js';
import { nextScenario, FOLLOWUPS } from './events.js';
import { TERMS, startScenario, scenarioMonthly } from './scenarios.js';
import { el } from './util.js';
import { rewindWorld, PAST_STARTS } from './history.js';
import { SPEEDS, DEFAULT_SPEED, OLD_SPEED, cycles } from './daynight.js';

const QUIPS = [
  'Reticulating splines…',
  'Counting triple-deckers…',
  'Measuring the Square’s five corners…',
  'Arguing about parking…',
  'Locating the 70 bus…',
  'Assessing pipettes…',
  'Raising the levy limit by exactly 2.5%…',
  'Reminding commenters to use their full names…',
  'Teaching herring to climb ladders…',
];

const game = { world: null, sim: null, renderer: null, ui: null, music: new Music(), speed: DEFAULT_SPEED, frac: 0 };
window.townies = game;
const params = new URLSearchParams(location.search);
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

function titleScreen() {
  const t = document.getElementById('title');
  t.innerHTML = '';
  t.style.display = 'flex';
  const status = el('div', { class: 'tstatus' });
  const btns = el('div', { class: 'tbtns' });
  const card = el(
    'div',
    { class: 'tcard' },
    el('div', { class: 'tlogo' }, 'TOWNIES'),
    el('div', { class: 'tsub' }, 'A city sim of Watertown, Massachusetts'),
    el('div', { class: 'tsky' }, ...Array.from({ length: 22 }, (_, k) => el('i', { style: `height:${14 + ((k * 37) % 44)}px;background:${['#c7d6e0', '#dcbfa5', '#b5654a', '#9fb3c8', '#e6dcc0'][k % 5]}` }))),
    el('p', { class: 'tblurb' }, 'Four square miles, true to scale: every street, building and parcel, with real assessed values. You’re the new City Manager. The Council is watching. So is the comment section.'),
    btns,
    status,
    el('p', { class: 'tcred' }, SHORT_CREDITS)
  );
  t.append(card);
  let preset = 'thesis';
  const go = (mode, scen, year) => () => start(mode, status, btns, scen, year, preset);
  let year = CFG.START.y;
  const custom = () => year !== CFG.START.y || preset !== 'thesis';
  const settingsLine = () => `${year === CFG.START.y ? `Starting in ${year}` : `Starting in ${year} (${PAST_STARTS[year].label.toLowerCase()}, reconstructed)`} · ${preset === 'thesis' ? 'thesis model' : 'neutral model'}`;
  const home = () => {
    btns.innerHTML = '';
    btns.append(
      el('button', { class: 'tbtn primary', onclick: pickTerm }, 'New term in Watertown'),
      el('button', { class: 'tbtn term', onclick: go('live', 'tutorial') }, el('span', { class: 'ticon' }, '🎓'), el('span', {}, el('b', {}, 'Tutorial'), el('small', {}, 'New to Townies? A ten-step guided tour of the real town: looking things up, Main Street, crews, redevelopment and the budget.'))),
      el('button', { class: 'tlink', onclick: advanced }, custom() ? `Advanced: ${settingsLine()}` : 'Advanced start options')
    );
    if (savedBtn) btns.prepend(savedBtn);
  };
  // start year and model assumptions live here, out of the way
  const advanced = () => {
    btns.innerHTML = '';
    const yr = (y, label, sub) => el('button', { class: `tyear${year === y ? ' on' : ''}`, onclick: () => { year = y; advanced(); } }, el('b', {}, label), el('small', {}, sub));
    btns.append(
      el('div', { class: 'tpick' }, 'Advanced start'),
      el('div', { class: 'tsub2' }, 'Start in'),
      el('div', { class: 'tyears' }, yr(CFG.START.y, `${CFG.START.y}`, 'Today, from real data'), ...Object.entries(PAST_STARTS).map(([y, p]) => yr(+y, `${y}`, `${p.label} · reconstructed`))),
      year !== CFG.START.y ? el('p', { class: 'fine' }, `Buildings newer than ${year} are removed using each property’s year built. What stood on those sites before is approximated and marked “reconstructed” when you look it up. Businesses and the street grid are today’s.`) : '',
      el('div', { class: 'tsub2' }, 'Model'),
      el('div', { class: 'tyears' },
        el('button', { class: `tyear${preset === 'thesis' ? ' on' : ''}`, onclick: () => { preset = 'thesis'; advanced(); } }, el('b', {}, 'Thesis'), el('small', {}, 'As designed: speculating landlords, chains winning in a hot market, auto lots as dead frontage')),
        el('button', { class: `tyear${preset === 'neutral' ? ' on' : ''}`, onclick: () => { preset = 'neutral'; advanced(); } }, el('b', {}, 'Neutral'), el('small', {}, 'Purer city simulation: those assumptions switched to plain market fundamentals'))),
      el('button', { class: 'tbtn primary', onclick: home }, 'Done')
    );
  };
  const pickTerm = () => {
    btns.innerHTML = '';
    btns.append(el('div', { class: 'tpick' }, 'Choose your term'));
    if (custom()) btns.append(el('button', { class: 'tlink', onclick: advanced }, `${settingsLine()} · change`));
    for (const [id, T] of Object.entries(TERMS)) {
      if (id !== 'sandbox' && (T.start || CFG.START.y) !== year) continue;
      btns.append(el('button', { class: 'tbtn term', onclick: go('live', id, year) }, el('span', { class: 'ticon' }, T.icon), el('span', {}, el('b', {}, T.title), el('small', {}, `${T.years ? T.years + '-year term · ' : ''}${T.blurb}`))));
    }
    btns.append(el('button', { class: 'tbtn', onclick: home }, '← Back'));
  };
  let savedBtn = null;
  kvGet(CFG.SAVE_KEY).then((sv) => {
    if (sv && sv.world) {
      const when = new Date(sv.at).toLocaleDateString();
      savedBtn = el('button', { class: 'tbtn primary', onclick: go('continue') }, `Continue (${sv.label || 'saved'} · ${when})`);
      if (btns.querySelector('.tlink') && !btns.querySelector('.tpick')) btns.prepend(savedBtn);
    }
  });
  home();
  if (params.get('auto')) start(params.get('auto'), status, btns, params.get('scenario') || 'sandbox', +params.get('year') || null, params.get('model') || 'thesis');
}

async function start(mode, status, btns, scen = 'sandbox', year = null, preset = 'thesis') {
  btns.style.display = 'none';
  const log = (msg) => {
    status.innerHTML = '';
    status.append(el('div', { class: 'tmsg' }, msg), el('div', { class: 'tquip' }, QUIPS[Math.floor(Math.random() * QUIPS.length)]));
  };
  try {
    if (localStorage.getItem('townies-music') !== '0' && !params.get('auto')) game.music.toggle(true);
  } catch (e) {}
  try {
    let state = null;
    if (mode === 'continue') {
      log('Opening your saved city…');
      const sv = await kvGet(CFG.SAVE_KEY);
      game.world = sv.world;
      state = sv;
      // a city saved before the assessor's building records were added picks them up now
      const asr = await fetchAssessor();
      if (asr && game.world.asrV !== asr.v) { log('Reading the assessor’s building cards…'); await nextFrame(); applyAssessor(game.world, asr); }
      const lid = await fetchLidar();
      if (lid && game.world.lidV !== lid.v) { log('Measuring roofs from the lidar…'); await nextFrame(); applyLidar(game.world, lid); }
      const trees = await fetchTrees();
      if (trees && game.world.treeV !== trees.v) { log('Planting every tree where it really stands…'); await nextFrame(); applyTrees(game.world, trees); }
      const yards = await fetchYards();
      if (asr || yards) applyYards(game.world, asr, yards);
      const ground = await fetchGround();
      if (ground) applyGround(game.world, ground);
    } else {
      const raw = await loadRawData({ refresh: mode === 'refresh', progress: log });
      raw.assessor = await fetchAssessor();
      raw.lidar = await fetchLidar();
      raw.trees = await fetchTrees();
      raw.yards = await fetchYards();
      raw.ground = await fetchGround();
      log('Building Watertown tile by tile…');
      await nextFrame();
      game.world = buildWorld(raw, log);
      if (year && PAST_STARTS[year]) {
        log(`Turning the clock back to ${year}…`);
        await nextFrame();
        rewindWorld(game.world, year);
      }
      game.world.preset = preset;
    }
    try {
      const r = await fetch('data/peers.json', { cache: 'no-cache' });
      if (r.ok) game.peers = await r.json();
    } catch (e) {}
    // the MBTA's real routes, stops and timetables (optional: without them the buses follow their streets)
    setTransitData(await fetchTransit(), game.world);
    log('Waking up the City Council…');
    await nextFrame();
    boot(state, mode === 'continue' ? null : scen);
  } catch (e) {
    console.error(e);
    status.innerHTML = '';
    status.append(
      el('div', { class: 'terr' }, `Couldn't load the map: ${e.message || e}`),
      el('p', { class: 'fine' }, 'Check your connection and try again in a minute.'),
      el('div', { class: 'tbtns' }, el('button', { class: 'tbtn primary', onclick: () => start('live', status, btns, scen, year, preset) }, 'Try again'))
    );
  }
}

function boot(state, scen = null) {
  const hooks = {
    invalidateTiles: (t) => game.renderer && game.renderer.invalidateTiles(t),
    invalidateBuilding: (b) => game.renderer && game.renderer.invalidateBuilding(b),
    invalidateAll: () => game.renderer && game.renderer.invalidateAll(),
    roadsChanged: () => { if (game.renderer) { game.renderer.indexRoadLines(); game.renderer.invalidateAll(); game.renderer.prewarmDone = false; game.renderer.prewarmK = 0; } },
    news: (n) => {
      if (game.ui) game.ui.refreshStatus();
      if (n.size === 'big' && game.ui) game.music.sfx('news');
    },
    followup: (p) => FOLLOWUPS[p.id] && FOLLOWUPS[p.id](game.sim, p.data || {}),
    yearly: () => save(false),
    openBudget: () => game.ui && game.ui.budgetWindow(),
    hint: (msg) => game.ui && game.ui.toast(msg, 6000),
    incidents: () => {
      if (game.ui) game.ui.refreshIncidents();
      if (game.renderer) game.renderer.needs = true;
    },
    comment: () => {},
    moment: (kind, x, y, label) => {
      if (game.renderer) game.renderer.addMoment(kind, x, y, label);
      if (game.music.ctx) game.music.sfx(kind === 'snow' ? 'snow' : 'ribbon'); // only once the player has made a sound
    },
    // the market put up a building: if it's on screen and the game isn't racing, a few hammer taps
    built: (lot) => {
      const r = game.renderer;
      if (!r || !game.ui || !game.music.ctx || game.speed > 4 || game.ui.modal) return;
      const [x0, y0, x1, y1] = r.visibleRect();
      if (lot.cx < x0 || lot.cx > x1 || lot.cy < y0 || lot.cy > y1 || r.scale() < 0.5) return;
      const now = performance.now();
      if (now - (game.lastHammer || 0) < 2500) return;
      game.lastHammer = now;
      game.music.sfx('hammer');
    },
  };
  // Older saves name the town's loudest commenter differently; carry them over to Melora.
  if (state && state.sim && state.sim.sim) {
    try {
      state.sim.sim = JSON.parse(JSON.stringify(state.sim.sim).replace(/Melodia/g, 'Melora').replace(/melodia/g, 'melora'));
    } catch (e) { /* keep the save as it was */ }
  }
  game.sim = new Sim(game.world, state ? state.sim : null, hooks);
  const canvas = document.getElementById('view');
  document.getElementById('title').style.display = 'none';
  document.getElementById('app').classList.add('live');
  game.renderer = new Renderer(canvas, game.world, game.sim);
  if (state && state.cam) {
    game.renderer.cam = state.cam;
    game.renderer.rot = state.rot || 0;
    game.renderer.z = state.z || 1;
  } else game.renderer.z = window.innerWidth < 700 ? 0.75 : 1;
  game.ui = new UI(game);
  try { game.renderer.showNames = localStorage.getItem('townies-names') === '1'; } catch (e) { /* storage off */ }
  const tutorial = scen === 'tutorial';
  if (!state) startScenario(game.sim, tutorial ? 'sandbox' : scen || 'sandbox', game.peers);
  game.ui.refreshHud();
  if (state && state.frac != null) game.frac = state.frac;
  game.ui.setSpeed(params.get('speed') ? +params.get('speed') : state && state.speed != null ? (state.speedV === 2 ? state.speed : OLD_SPEED[state.speed] ?? DEFAULT_SPEED) : DEFAULT_SPEED);
  game.ui.musicBtn.classList.toggle('muted', !game.music.on);
  game.renderer.resize();
  if (tutorial) game.ui.startTutorial();
  else if (!state && !params.has('nonews')) setTimeout(() => game.ui.newsWindow(), 600);
  requestAnimationFrame(frame);
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(250, now - last);
  last = now;
  const s = game.sim;
  // game.frac: how far through the month we are (kept as a fraction so changing speed doesn't jump the clock)
  if (s && !game.ui.modal && game.speed > 0 && !s.gameOver) {
    const ms = SPEEDS[game.speed][2];
    s.realtime((dt / ms) * 30);
    game.frac += dt / ms;
    if (game.frac >= 1) {
      game.frac = 0;
      monthTick();
    }
  }
  if (game.renderer) {
    // time of day: each month starts a little after 7 a.m. on the 1st
    const r = game.renderer;
    r.tod = ((game.frac * 30 + 0.3) % 1) * 24;
    r.dom = Math.floor(game.frac * 30 + 0.3) + 1; // day of the month, for the bus timetable
    r.dayCycle = cycles(game.speed) || (game.speed === 0 && cycles(game.lastSpeed));
    if (game.ui && r.dayCycle) game.ui.refreshClock(r.tod, Math.floor(game.frac * 30 + 0.3) + 1);
  }
  if (game.renderer && game.renderer.needs) game.renderer.draw(dt);
  else if (game.renderer) game.renderer.idle();
  requestAnimationFrame(frame);
}

function monthTick() {
  const s = game.sim;
  s.tick();
  if (s.m === 3 || s.m === 4 || s.m === 9 || s.m === 10 || s.m === 11) game.renderer.invalidateAll(); // blossom, leaves out, fall colour, bare
  game.ui.refreshStatus();
  game.ui.refreshUndo();
  if (s.approvalWhy) game.ui.approvalNote([[s.approvalWhy.f, s.approvalWhy.d]], s.approvalWhy.top ? s.approvalWhy.top.why : '');
  game.ui.refreshWins();
  if (game.renderer.overlayMode !== 'none') game.renderer.refreshOverlay();
  game.renderer.needs = true;
  if (s.gameOver) return game.ui.gameOver(s.gameOver);
  const sev = scenarioMonthly(s);
  game.ui.refreshHud();
  if (sev) return game.ui.scenarioEvent(sev);
  if (game.tutorial) return;
  const next = nextScenario(s);
  if (next) game.ui.agenda(next.sc, next.ctx);
}
game.monthTick = monthTick;

async function save(manual) {
  if (!game.sim) return;
  const r = game.renderer;
  const data = {
    v: 1,
    world: game.world,
    sim: game.sim.serialize(),
    cam: { ...r.cam },
    rot: r.rot,
    z: r.z,
    speed: game.speed,
    speedV: 2,
    frac: game.frac,
    at: Date.now(),
    label: `Watertown ${game.sim.dateStr()}`,
  };
  const ok = await kvSet(CFG.SAVE_KEY, data);
  if (manual) game.ui.toast(ok ? 'City saved' : 'Save failed');
}
game.save = save;
game.loadSave = () => location.reload();
game.restart = async (refresh) => {
  const msg = refresh ? 'Re-download Watertown from OpenStreetMap and MassGIS? Your saved game stays.' : 'Leave this city? Unsaved progress since the last save will be lost.';
  if (!(game.ui ? await game.ui.ask(msg, refresh ? 'Re-download' : 'Leave') : confirm(msg))) return;
  if (refresh) await kvDel(CFG.RAW_KEY);
  location.href = location.pathname;
};
document.addEventListener('visibilitychange', () => {
  if (document.hidden && game.sim) save(false);
});

titleScreen();
