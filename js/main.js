import { CFG } from './config.js';
import { loadRawData, kvGet, kvSet, kvDel } from './data.js';
import { buildWorld } from './world.js';
import { Sim } from './sim.js';
import { Renderer } from './render.js';
import { UI } from './ui.js';
import { Music } from './music.js';
import { nextScenario, FOLLOWUPS } from './events.js';
import { TERMS, startScenario, scenarioMonthly } from './scenarios.js';
import { el } from './util.js';
import { rewindWorld, PAST_STARTS } from './history.js';

const MONTH_MS = [Infinity, 14000, 6000, 2000];
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

const game = { world: null, sim: null, renderer: null, ui: null, music: new Music(), speed: 1 };
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
    el('p', { class: 'tcred' }, 'Map data © OpenStreetMap contributors · Parcels & footprints: MassGIS · Places: Overture Maps · Inspired by SimCity 2000; not affiliated with Maxis/EA.')
  );
  t.append(card);
  const go = (mode, scen, year) => () => start(mode, status, btns, scen, year);
  let year = CFG.START.y;
  const pickTerm = () => {
    btns.innerHTML = '';
    const yr = (y, label, sub) => el('button', { class: `tyear${year === y ? ' on' : ''}`, onclick: () => { year = y; pickTerm(); } }, el('b', {}, label), el('small', {}, sub));
    btns.append(
      el('div', { class: 'tpick' }, 'Start in'),
      el('div', { class: 'tyears' }, yr(CFG.START.y, `${CFG.START.y}`, 'Today, from real data'), ...Object.entries(PAST_STARTS).map(([y, p]) => yr(+y, `${y}`, `${p.label} · reconstructed`))),
      el('div', { class: 'tpick' }, 'Choose your term')
    );
    for (const [id, T] of Object.entries(TERMS)) {
      if (id !== 'sandbox' && (T.start || CFG.START.y) !== year) continue;
      btns.append(el('button', { class: 'tbtn term', onclick: go('live', id, year) }, el('span', { class: 'ticon' }, T.icon), el('span', {}, el('b', {}, T.title), el('small', {}, `${T.years ? T.years + '-year term · ' : ''}${T.blurb}`))));
    }
    if (year !== CFG.START.y) btns.append(el('p', { class: 'fine' }, `Buildings newer than ${year} are removed using each property’s year built. What stood on those sites before is approximated and marked “reconstructed” when you look it up. Businesses and the street grid are today’s.`));
    btns.append(el('button', { class: 'tbtn', onclick: () => location.reload() }, '← Back'));
  };
  kvGet(CFG.SAVE_KEY).then((sv) => {
    if (sv && sv.world) {
      const when = new Date(sv.at).toLocaleDateString();
      btns.prepend(el('button', { class: 'tbtn primary', onclick: go('continue') }, `Continue (${sv.label || 'saved'} · ${when})`));
    }
  });
  btns.append(
    el('button', { class: 'tbtn primary', onclick: pickTerm }, 'New term in Watertown'),
    el('button', { class: 'tbtn term', onclick: go('live', 'tutorial') }, el('span', { class: 'ticon' }, '🎓'), el('span', {}, el('b', {}, 'Tutorial'), el('small', {}, 'New to Townies? A ten-step guided tour of the real town: looking things up, Main Street, crews, redevelopment and the budget.')))
  );
  if (params.get('auto')) start(params.get('auto'), status, btns, params.get('scenario') || 'sandbox', +params.get('year') || null);
}

async function start(mode, status, btns, scen = 'sandbox', year = null) {
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
    } else {
      const raw = await loadRawData({ refresh: mode === 'refresh', progress: log });
      log('Building Watertown tile by tile…');
      await nextFrame();
      game.world = buildWorld(raw, log);
      if (year && PAST_STARTS[year]) {
        log(`Turning the clock back to ${year}…`);
        await nextFrame();
        rewindWorld(game.world, year);
      }
    }
    try {
      const r = await fetch('data/peers.json', { cache: 'no-cache' });
      if (r.ok) game.peers = await r.json();
    } catch (e) {}
    log('Waking up the City Council…');
    await nextFrame();
    boot(state, mode === 'continue' ? null : scen);
  } catch (e) {
    console.error(e);
    status.innerHTML = '';
    status.append(
      el('div', { class: 'terr' }, `Couldn't load the map: ${e.message || e}`),
      el('p', { class: 'fine' }, 'Check your connection and try again in a minute.'),
      el('div', { class: 'tbtns' }, el('button', { class: 'tbtn primary', onclick: () => start('live', status, btns, scen, year) }, 'Try again'))
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
  };
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
  const tutorial = scen === 'tutorial';
  if (!state) startScenario(game.sim, tutorial ? 'sandbox' : scen || 'sandbox', game.peers);
  game.ui.refreshHud();
  game.ui.setSpeed(params.get('speed') ? +params.get('speed') : state && state.speed != null ? state.speed : 1);
  game.ui.musicBtn.classList.toggle('muted', !game.music.on);
  game.renderer.resize();
  if (tutorial) game.ui.startTutorial();
  else if (!state) setTimeout(() => game.ui.newsWindow(), 600);
  requestAnimationFrame(frame);
}

let last = performance.now();
let acc = 0;
function frame(now) {
  const dt = Math.min(250, now - last);
  last = now;
  const s = game.sim;
  if (s && !game.ui.modal && game.speed > 0 && !s.gameOver) {
    s.realtime((dt / MONTH_MS[game.speed]) * 30);
    acc += dt;
    if (acc >= MONTH_MS[game.speed]) {
      acc = 0;
      monthTick();
    }
  }
  if (game.renderer && game.renderer.needs) game.renderer.draw(dt);
  else if (game.renderer) game.renderer.idle();
  requestAnimationFrame(frame);
}

function monthTick() {
  const s = game.sim;
  s.tick();
  if (s.m === 9 || s.m === 11) game.renderer.invalidateAll(); // fall foliage on, then off
  game.ui.refreshStatus();
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
    at: Date.now(),
    label: `Watertown ${game.sim.dateStr()}`,
  };
  const ok = await kvSet(CFG.SAVE_KEY, data);
  if (manual) game.ui.toast(ok ? 'City saved' : 'Save failed');
}
game.save = save;
game.loadSave = () => location.reload();
game.restart = async (refresh) => {
  if (!confirm(refresh ? 'Re-download Watertown from OpenStreetMap and MassGIS? Your saved game stays.' : 'Leave this city? Unsaved progress since the last save will be lost.')) return;
  if (refresh) await kvDel(CFG.RAW_KEY);
  location.href = location.pathname;
};
document.addEventListener('visibilitychange', () => {
  if (document.hidden && game.sim) save(false);
});

titleScreen();
