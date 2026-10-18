// The bridge to the iOS app's native interface. In the app (ios/), the menu bar, status bar and toolbar
// are drawn natively in SwiftUI, and Council agenda items, mission results, the lot inspector, the newspaper
// and your term open as native sheets. This module sends the game's state to Swift as JSON and runs the
// commands Swift sends back. On the web, NATIVE is false and none of this runs.
import { SPEEDS, cycles } from './daynight.js';
import { search, buildIndex } from './search.js';

export const NATIVE = typeof window !== 'undefined' && !!(window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.townies);

export function post(type, data = {}) {
  if (!NATIVE) return;
  try { window.webkit.messageHandlers.townies.postMessage(JSON.stringify({ type, ...data })); } catch (e) { /* not in the app */ }
}

// windows that become native sheets; everything else stays a web window (restyled to look at home on iOS)
export const NATIVE_SHEETS = new Set(['query', 'news', 'term']);

let ui = null, game = null, hudQueued = false, lastSearch = [], sheetBodies = new Map(), modalBox = null;

// an SVG icon -> a PNG data URL Swift can turn into a UIImage
function svgToPng(svg, size = 96) {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = c.height = size;
      c.getContext('2d').drawImage(img, 0, 0, size, size);
      res(c.toDataURL('image/png'));
    };
    img.onerror = () => res('');
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" '));
  });
}

export async function initNative(theUI, defs) {
  if (!NATIVE) return;
  ui = theUI;
  game = theUI.g;
  document.documentElement.classList.add('native-chrome');
  const icons = {};
  for (const [k, svg] of Object.entries(defs.ICON)) icons[k] = await svgToPng(svg);
  post('setup', {
    tools: defs.TOOLS.map((t) => ({ id: t.id, label: t.label, note: defs.TOOL_NOTE[t.id] || t.tip || '', icon: icons[t.id] || '' })),
    groups: defs.GROUPS.map((g) => ({ id: g.id, label: g.label, members: g.members })),
    loose: defs.TOOLS.filter((t) => !defs.GROUPS.some((g) => g.members.includes(t.id))).map((t) => t.id),
    extras: ['rotl', 'rotr', 'zin', 'zout', 'undo'].map((id) => ({ id, label: { rotl: 'Rotate left', rotr: 'Rotate right', zin: 'Zoom in', zout: 'Zoom out', undo: 'Undo' }[id], icon: icons[id] || '' })),
    overlays: defs.OVERLAYS.map(([id, label]) => ({ id, label })),
    speeds: SPEEDS.map(([name, icon, , cyc]) => ({ name, icon, cycles: !!cyc })),
    menus: Object.fromEntries(Object.entries(ui.menuDefs).map(([k, items]) => [k, items.filter((it) => it !== '-').map(([label]) => label)])),
  });
  hud();
  // haptics follow the sound effects (they're the same moments)
  const sfx = game.music.sfx.bind(game.music);
  game.music.sfx = (kind, n) => { post('haptic', { kind }); return sfx(kind, n); };
  window.townies.native = { cmd, search: nativeSearch };
}

// the status bar's contents, coalesced to once per frame
export function hud() {
  if (!NATIVE || !ui || hudQueued) return;
  hudQueued = true;
  requestAnimationFrame(() => {
    hudQueued = false;
    const s = ui.sim;
    if (!s) return;
    const d = s.demand || { R: 0, C: 0, I: 0 };
    const dv = s.vibrancy - (s.base.vib0 ?? s.vibrancy);
    const sc = s.scenario;
    post('hud', {
      date: ui.sDate ? ui.sDate.textContent : s.dateStr(),
      clock: ui.sClock ? ui.sClock.textContent : '',
      funds: ui.sFunds ? ui.sFunds.textContent : '', fundsNeg: s.funds < 0,
      pop: ui.sPop ? ui.sPop.textContent.replace(/^Pop /, '') : '',
      approval: Math.round(s.approval), approvalNeg: s.approval < 35,
      vib: Math.round(s.vibrancy || 0), vibDir: Math.abs(dv) >= 1 ? Math.sign(dv) : 0,
      inc: ui.sInc ? ui.sInc.textContent.replace(/^🚧\s*/, '') : '0', incLate: !!(ui.sInc && ui.sInc.classList.contains('neg')),
      rci: [d.R, d.C, d.I].map((v) => Math.max(-1, Math.min(1, v || 0))),
      ticker: ui.ticker ? ui.ticker.textContent : '',
      speed: game.speed, tool: ui.tool, dense: !!ui.dense, avenue: !!ui.avenue, bd: ui.bdMode || 'auto',
      overlay: ui.overlay || 'none', names: !!(ui.r && ui.r.showNames),
      canUndo: !!(s.canUndo && s.canUndo()), music: !!game.music.on, sfxOn: !!game.music.sfxOn,
      mission: sc ? { title: ui.hud ? (ui.hud.querySelector('.hudt') || {}).textContent || '' : '' } : null,
      cycles: cycles(game.speed),
    });
  });
}

// ---------- windows as native sheets ----------
// Turn a built window body into blocks Swift can lay out: headings, paragraphs, key/value rows, stories,
// comments and buttons (buttons keep their web click handlers; Swift presses them by index).
function serialize(body) {
  const blocks = [];
  const buttons = [];
  const txt = (n) => (n ? n.textContent.replace(/\s+/g, ' ').trim() : '');
  const btn = (b) => { buttons.push(b); return buttons.length - 1; };
  const walk = (node) => {
    for (const n of node.children) {
      const tag = n.tagName, cls = n.classList;
      if (cls.contains('mast')) blocks.push({ t: 'mast', text: txt(n) });
      else if (cls.contains('dateline')) blocks.push({ t: 'fine', text: txt(n) });
      else if (cls.contains('story')) blocks.push({ t: 'story', date: txt(n.querySelector('small')), title: txt(n.querySelector('b')), text: txt(n.querySelector('p')), comments: comments(n.querySelector('.cblock')) });
      else if (cls.contains('cblock')) blocks.push({ t: 'comments', comments: comments(n) });
      else if (tag === 'H1' || tag === 'H2' || tag === 'H3') blocks.push({ t: tag === 'H3' ? 'h3' : 'h2', text: txt(n) });
      else if (tag === 'H4') blocks.push({ t: 'h4', text: txt(n) });
      else if (tag === 'P') blocks.push({ t: cls.contains('fine') ? 'fine' : 'p', text: txt(n) });
      else if (tag === 'TABLE') {
        for (const tr of n.querySelectorAll('tr')) {
          const td = tr.querySelector('td');
          let v = txt(td);
          const bar = td && td.querySelector('.bar i');
          if (!v && bar) { const pct = parseInt(bar.style.width, 10) || 0; v = '▮'.repeat(Math.round(pct / 20)) + '▯'.repeat(5 - Math.round(pct / 20)) + ` ${pct}%`; }
          blocks.push({ t: 'kv', k: txt(tr.querySelector('th')), v });
        }
      } else if (cls.contains('kvline')) blocks.push({ t: 'kv', k: txt(n.children[0]), v: txt(n.children[1]) });
      else if (tag === 'BUTTON') blocks.push({ t: 'btn', label: txt(n.querySelector('b')) || txt(n), sub: txt(n.querySelector('small')), i: btn(n) });
      else if (n.children.length) walk(n);
      else if (txt(n)) blocks.push({ t: 'p', text: txt(n) });
    }
  };
  const comments = (cb) => (cb ? [...cb.querySelectorAll('.cmt')].map((c) => ({ who: txt(c.querySelector('b')), text: txt(c).replace(txt(c.querySelector('b')), '').trim() })) : []);
  walk(body);
  return { blocks, buttons };
}

export function nativeSheet(id, title, build) {
  const body = document.createElement('div');
  build(body);
  const { blocks, buttons } = serialize(body);
  sheetBodies.set(id, { buttons, body });
  post('sheet', { id, title, blocks });
}

// Council agenda items, mission results and game over: native, and the game waits for an answer
export function nativeModal(box) {
  modalBox = box;
  const q = (sel) => box.querySelector(sel);
  const txt = (n) => (n ? n.textContent.replace(/\s+/g, ' ').trim() : '');
  const choices = [...box.querySelectorAll('.choice')].map((b) => ({ label: txt(b.querySelector('b')) || txt(b), sub: txt(b.querySelector('small')) }));
  post('modal', {
    kind: box.classList.contains('agenda') ? 'agenda' : 'event',
    title: txt(q('.wbar')), date: txt(q('.agdate')), heading: txt(q('h2')),
    paras: [...box.querySelectorAll('.wbody > p:not(.fine)')].map(txt),
    lines: [...box.querySelectorAll('.kvline')].map(txt),
    fine: txt(q('p.fine')), where: !!q('button.link'), choices,
  });
}
export const nativeModalClosed = () => post('modalClose');

function nativeSearch(qs) {
  if (!ui.searchIdx) ui.searchIdx = buildIndex(ui.w);
  lastSearch = search(ui.searchIdx, qs, 12);
  return lastSearch.map((e, i) => ({ i, label: e.label, kind: e.kind, sub: e.sub || (e.town ? '' : 'nearby town') }));
}

// commands from Swift
function cmd(c) {
  if (typeof c === 'string') c = JSON.parse(c);
  const r = ui.r;
  switch (c.type) {
    case 'tool': ui.setTool(c.id); break;
    case 'speed': ui.setSpeed(c.v); break;
    case 'overlay': ui.setOverlay(c.id); break;
    case 'names': ui.setNames(!r.showNames); break;
    case 'extra':
      if (c.id === 'rotl') r.rotate(-1); else if (c.id === 'rotr') r.rotate(1);
      else if (c.id === 'zin') r.setZoom(r.z * 1.5); else if (c.id === 'zout') r.setZoom(r.z / 1.5);
      else if (c.id === 'undo') ui.undo();
      break;
    case 'toolOpt':
      if (c.opt === 'dense') ui.dense = !ui.dense;
      else if (c.opt === 'avenue') ui.avenue = !ui.avenue;
      else if (c.opt === 'bd') ui.setTool('bulldoze');
      ui.updateHint();
      break;
    case 'menu': {
      const items = ui.menuDefs[c.menu].filter((it) => it !== '-');
      if (items[c.i]) items[c.i][1]();
      break;
    }
    case 'open':
      if (c.id === 'news') ui.newsWindow(); else if (c.id === 'council') ui.councilWindow(); else if (c.id === 'mainstreet') ui.mainStreetWindow();
      else if (c.id === 'crews') ui.crewsWindow(); else if (c.id === 'term') ui.termWindow(); else if (c.id === 'budget') ui.budgetWindow();
      else if (c.id === 'comments') ui.commentsWindow();
      break;
    case 'music': ui.toggleMusic(); break;
    case 'sfx': game.music.toggleSfx(); break;
    case 'goto': if (lastSearch[c.i]) ui.goTo(lastSearch[c.i]); break;
    case 'modalChoose': {
      const b = modalBox && modalBox.querySelectorAll('.choice')[c.i];
      if (b) b.click();
      break;
    }
    case 'modalWhere': { const b = modalBox && modalBox.querySelector('button.link'); if (b) b.click(); break; }
    case 'sheetButton': { const sb = sheetBodies.get(c.id); if (sb && sb.buttons[c.i]) sb.buttons[c.i].click(); break; }
    case 'sheetClosed': sheetBodies.delete(c.id); ui.closeWin(c.id); break;
  }
  hud();
}
