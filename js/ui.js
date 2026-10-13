// SimCity-2000-flavoured interface: menubar, toolbar, status bar, windows, agenda dialogs, input.
import { CFG, ZONE, ZONE_NAME, SERVICES, ROAD_NAME } from './config.js';
import { el, fmtMoney, fmtInt, clamp } from './util.js';
import { FACTIONS, FACTION_LABEL, DEPTS, DEPT_LABEL, streetOf } from './sim.js';
import { POLICIES } from './storefronts.js';
import { CAST, react, reactAgenda, neighborQuote } from './comments.js';
import { INC, DEPTS as CREW_DEPTS, dispatch, incidentStats } from './incidents.js';
import { walkLabel } from './walkscore.js';
import { TERMS, goalStatus } from './scenarios.js';
import { PEER_CENTERS, MIX_RADIUS_M } from './peers.js';
import { makeProj } from './geo.js';
import { PROGRAMS, siteFromRect, analyze, evaluate, hearingScore, hearingOdds, submit, devMood, projectName } from './projects.js';

const ICON = {
  query: '<svg viewBox="0 0 24 24"><circle cx="10" cy="10" r="6" fill="none" stroke="#000" stroke-width="2.4"/><path d="M14.5 14.5l6 6" stroke="#000" stroke-width="3"/><text x="10" y="13.5" font-size="9" text-anchor="middle" font-weight="bold">?</text></svg>',
  pan: '<svg viewBox="0 0 24 24"><path d="M8 11V5a1.5 1.5 0 013 0v5V3.5a1.5 1.5 0 013 0V10V5a1.5 1.5 0 013 0v6V8a1.5 1.5 0 013 0v7c0 4-3 7-7 7s-5-1.5-7-4l-3-4.5c-.7-1 .8-2.3 1.8-1.4L8 14z" fill="#f2d3b0" stroke="#000" stroke-width="1.3"/></svg>',
  bulldoze: '<svg viewBox="0 0 24 24"><rect x="7" y="9" width="10" height="7" fill="#f1c232" stroke="#000"/><rect x="10" y="5" width="5" height="5" fill="#f1c232" stroke="#000"/><path d="M2 12h4v6H2z" fill="#888" stroke="#000"/><rect x="6" y="16" width="13" height="4" rx="2" fill="#333"/></svg>',
  develop: '<svg viewBox="0 0 24 24"><path d="M5 22V4h2v18" fill="#e3a21a" stroke="#000" stroke-width="0.8"/><path d="M4 4h17v2H4z" fill="#e3a21a" stroke="#000" stroke-width="0.8"/><path d="M18 6v6" stroke="#000" stroke-width="1"/><rect x="16" y="12" width="4" height="3" fill="#777" stroke="#000" stroke-width="0.8"/><rect x="9" y="15" width="10" height="7" fill="#b5654a" stroke="#000" stroke-width="0.8"/><path d="M11 17h2M15 17h2M11 19.5h2M15 19.5h2" stroke="#2a3a55" stroke-width="1.2"/></svg>',
  road: '<svg viewBox="0 0 24 24"><path d="M8 2h8l4 20H4z" fill="#555"/><path d="M12 4v3M12 10v3M12 16v4" stroke="#f1c232" stroke-width="1.6"/></svg>',
  zoneR: '<svg viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" fill="#5fd35f" stroke="#000"/><text x="12" y="17" font-size="14" text-anchor="middle" font-weight="bold" font-family="sans-serif">R</text></svg>',
  zoneC: '<svg viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" fill="#5f9fff" stroke="#000"/><text x="12" y="17" font-size="14" text-anchor="middle" font-weight="bold" font-family="sans-serif">C</text></svg>',
  zoneI: '<svg viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" fill="#f0c840" stroke="#000"/><text x="12" y="17" font-size="14" text-anchor="middle" font-weight="bold" font-family="sans-serif">I</text></svg>',
  dezone: '<svg viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" fill="#bbb" stroke="#000"/><path d="M6 6l12 12M18 6L6 18" stroke="#c00" stroke-width="2.5"/></svg>',
  park: '<svg viewBox="0 0 24 24"><rect x="11" y="14" width="2" height="7" fill="#6b4a2b"/><circle cx="12" cy="10" r="7" fill="#3a8a2c" stroke="#000"/></svg>',
  police: '<svg viewBox="0 0 24 24"><path d="M12 2l8 3v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V5z" fill="#3a5fbf" stroke="#000"/><path d="M12 7l1.4 3 3.2.3-2.4 2 .8 3.2L12 14l-3 1.5.8-3.2-2.4-2 3.2-.3z" fill="#f1c232"/></svg>',
  fire: '<svg viewBox="0 0 24 24"><path d="M12 2c2 4 6 6 6 11a6 6 0 01-12 0c0-3 2-4 2-7 2 1 3 3 3 5 1-3 1-6 1-9z" fill="#e24a2b" stroke="#000"/><path d="M12 13c1 2 3 3 3 5a3 3 0 01-6 0c0-1 1-2 1-3 1 1 2 1 2-2z" fill="#f1c232"/></svg>',
  school: '<svg viewBox="0 0 24 24"><path d="M2 9l10-5 10 5-10 5z" fill="#b8643f" stroke="#000"/><path d="M6 11v5c3 2 9 2 12 0v-5l-6 3z" fill="#d68a5f" stroke="#000"/></svg>',
  hospital: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="1.5" fill="#dfe8ee" stroke="#000"/><path d="M12 7v10M7 12h10" stroke="#c8352b" stroke-width="3"/></svg>',
  clinic: '<svg viewBox="0 0 24 24"><rect x="5" y="6" width="14" height="13" rx="1.5" fill="#d2e4dc" stroke="#000"/><path d="M12 9v7M8.5 12.5h7" stroke="#2e8a5f" stroke-width="2.4"/></svg>',
  library: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="1" fill="#c8a86a" stroke="#000"/><path d="M12 6v12" stroke="#000" stroke-width="1.4"/><path d="M5 8h5M5 11h5M14 8h5M14 11h5" stroke="#6b4a2b" stroke-width="1.2"/></svg>',
  firehouse: '<svg viewBox="0 0 24 24"><path d="M4 10l8-5 8 5v9H4z" fill="#a6402f" stroke="#000"/><rect x="9" y="12" width="6" height="7" fill="#f1c232" stroke="#000"/></svg>',
  museum: '<svg viewBox="0 0 24 24"><path d="M3 9l9-5 9 5z" fill="#cdbcdd" stroke="#000"/><path d="M5 10v7M9 10v7M15 10v7M19 10v7" stroke="#6d4f6b" stroke-width="1.8"/><rect x="3" y="18" width="18" height="2.5" fill="#b9a9c9" stroke="#000"/></svg>',
  stadium: '<svg viewBox="0 0 24 24"><ellipse cx="12" cy="12" rx="10" ry="7" fill="#9aa3ab" stroke="#000"/><ellipse cx="12" cy="12" rx="5" ry="3.4" fill="#5f8a4a" stroke="#000"/></svg>',
  rotl: '<svg viewBox="0 0 24 24"><path d="M5 12a7 7 0 1 0 2-5" fill="none" stroke="#000" stroke-width="2.4"/><path d="M3 3v6h6" fill="none" stroke="#000" stroke-width="2.4"/></svg>',
  rotr: '<svg viewBox="0 0 24 24"><path d="M19 12a7 7 0 1 1-2-5" fill="none" stroke="#000" stroke-width="2.4"/><path d="M21 3v6h-6" fill="none" stroke="#000" stroke-width="2.4"/></svg>',
  zin: '<svg viewBox="0 0 24 24"><circle cx="10" cy="10" r="7" fill="#fff" stroke="#000" stroke-width="2"/><path d="M15 15l6 6" stroke="#000" stroke-width="3"/><path d="M6.5 10h7M10 6.5v7" stroke="#000" stroke-width="2"/></svg>',
  zout: '<svg viewBox="0 0 24 24"><circle cx="10" cy="10" r="7" fill="#fff" stroke="#000" stroke-width="2"/><path d="M15 15l6 6" stroke="#000" stroke-width="3"/><path d="M6.5 10h7" stroke="#000" stroke-width="2"/></svg>',
};
const TOOLS = [
  { id: 'query', label: 'Query', key: 'q', tip: 'Tap a building, parcel or street to see its real data.' },
  { id: 'pan', label: 'Pan', key: 'h', tip: 'Drag to move around. Two fingers pinch to zoom.' },
  { id: 'bulldoze', label: 'Bulldoze', key: 'b', tip: 'Drag a box to demolish buildings, roads or trees.' },
  { id: 'road', label: 'Road', key: 'd', tip: 'Drag to build a road. Bridges over water cost more.' },
  { id: 'develop', label: 'Redevelop', key: 'v', tip: 'Drag a box over parcels to plan a redevelopment project.' },
  { id: 'zoneR', label: 'Residential', key: '1', tip: 'Drag to zone residential. Tap again to switch light/dense.' },
  { id: 'zoneC', label: 'Commercial', key: '2', tip: 'Drag to zone commercial. Tap again to switch light/dense.' },
  { id: 'zoneI', label: 'Industrial / R&D', key: '3', tip: 'Drag to zone industrial or lab. Tap again to switch light/dense.' },
  { id: 'dezone', label: 'De-zone', key: '4', tip: 'Drag to remove zoning from lots.' },
  { id: 'park', label: 'Park', key: 'p', tip: 'Drag over clear land to make a park.' },
  { id: 'police', label: 'Police station', key: '', tip: 'Tap to place a 3×3 police station ($12M).' },
  { id: 'fire', label: 'Fire station', key: '', tip: 'Tap to place a 3×3 fire station ($9M).' },
  { id: 'school', label: 'School', key: '', tip: 'Tap to place a 5×5 school ($45M).' },
  { id: 'clinic', label: 'Community clinic', key: '', tip: 'Tap to place a 3×3 clinic ($14M). Lifts nearby land value; seniors & renters approve.' },
  { id: 'library', label: 'Library', key: '', tip: 'Tap to place a 3×3 library ($18M). Raises land value and overall approval.' },
  { id: 'firehouse', label: 'Firehouse (historic)', key: '', tip: 'Tap to place a 2×2 firehouse ($7M). Adds fire coverage with small-town charm.' },
  { id: 'museum', label: 'Museum', key: '', tip: 'Tap to place a 4×4 museum ($30M). Strong land-value halo; business approves.' },
  { id: 'hospital', label: 'Hospital', key: '', tip: 'Tap to place a 5×5 hospital ($60M). Big land-value & approval boost; high upkeep.' },
  { id: 'stadium', label: 'Stadium', key: '', tip: 'Tap to place a 7×7 stadium ($120M). Civic pride & business — commuters grumble about traffic.' },
];
// SC2000-style grouped tools: one toolbar button opens a flyout of its members.
const GROUPS = [
  { id: 'zone', label: 'Zones', members: ['zoneR', 'zoneC', 'zoneI', 'dezone'] },
  { id: 'civic', label: 'Civic buildings', members: ['police', 'fire', 'firehouse', 'school', 'library', 'clinic', 'hospital', 'museum', 'stadium', 'park'] },
];
const TOOL_NOTE = {
  zoneR: 'Homes · tap again for dense', zoneC: 'Shops & offices · tap again for dense', zoneI: 'Industry & labs · tap again for dense', dezone: 'Remove zoning',
  police: '$12M · 3×3 · cuts crime', fire: '$9M · 3×3 · fewer fires', school: '$45M · 5×5 · raises land value', park: '$25K per tile',
  firehouse: '$7M · 2×2 · fire cover + charm', library: '$18M · 3×3 · land value, approval', clinic: '$14M · 3×3 · seniors & renters',
  hospital: '$60M · 5×5 · big boost, high upkeep', museum: '$30M · 4×4 · land value, business', stadium: '$120M · 7×7 · pride, but traffic',
};
const OVERLAYS = [
  ['none', 'None'], ['vibrancy', 'Vibrancy (street life)'], ['walk', 'Walkability'], ['zones', 'Zones'], ['landvalue', 'Land value'], ['traffic', 'Traffic'], ['crime', 'Crime'], ['pollution', 'Pollution'], ['police', 'Police coverage'], ['fire', 'Fire coverage'], ['growth', 'New & abandoned'],
];
const SPEEDS = [['Pause', 0], ['Turtle', 1], ['Llama', 2], ['Cheetah', 3]];

export class UI {
  constructor(game) {
    this.g = game;
    this.tool = 'query';
    this.dense = false;
    this.wins = new Map();
    this.z = 10;
    this.modal = null;
    this.build();
    this.bindInput();
  }
  get sim() { return this.g.sim; }
  get w() { return this.g.world; }
  get r() { return this.g.renderer; }

  // ---------------- chrome ----------------
  build() {
    const mb = document.getElementById('menubar');
    mb.innerHTML = '';
    const menu = (label, items) => {
      const m = el('div', { class: 'menu' }, el('button', { class: 'mlabel' }, label));
      const dd = el('div', { class: 'dropdown' });
      for (const it of items) {
        if (it === '-') { dd.append(el('hr')); continue; }
        dd.append(el('button', { onclick: () => { this.closeMenus(); it[1](); } }, it[0]));
      }
      m.append(dd);
      m.firstChild.addEventListener('click', (e) => {
        e.stopPropagation();
        const open = m.classList.contains('open');
        this.closeMenus();
        if (!open) m.classList.add('open');
      });
      return m;
    };
    const fileItems = [['Save city', () => this.g.save(true)], ['Load last save', () => this.g.loadSave()], ['New term (restart)', () => this.g.restart()], '-', ['Re-download map data', () => this.g.restart(true)], ['About Townies', () => this.aboutWindow()]];
    const winItems = [['Main Street', () => this.mainStreetWindow()], ['Projects', () => this.projectsWindow()], ['Crews', () => this.crewsWindow()], ['Comment Section', () => this.commentsWindow()], ['Budget', () => this.budgetWindow()], ['City Council', () => this.councilWindow()], ['Graphs', () => this.graphsWindow()], ['Map', () => this.mapWindow()], ['Newspaper', () => this.newsWindow()]];
    const ovItems = OVERLAYS.map(([k, l]) => [l, () => this.setOverlay(k)]);
    const spItems = SPEEDS.map(([l, v]) => [l, () => this.setSpeed(v)]);
    this.musicBtn = el('button', { class: 'mbtn muted', title: 'Music on/off', onclick: () => this.toggleMusic() }, '♪');
    this.speedBtn = el('button', { class: 'mbtn', title: 'Speed', onclick: () => this.cycleSpeed() }, '▶');
    mb.append(
      el('div', { class: 'logo' }, 'TOWNIES'),
      menu('File', fileItems),
      Object.assign(menu('Speed', spItems), { className: 'menu m-speed' }),
      menu('Windows', winItems),
      menu('Overlay', ovItems),
      el('div', { class: 'spacer' }),
      this.speedBtn,
      this.musicBtn
    );
    document.addEventListener('click', () => this.closeMenus());

    const tb = document.getElementById('toolbar');
    tb.innerHTML = '';
    this.toolBtns = {};
    this.groupBtns = {};
    this.groupCur = { zone: 'zoneR', civic: 'police' };
    for (const t of TOOLS) {
      if (GROUPS.some((g) => g.members.includes(t.id))) continue;
      const b = el('button', { class: 'tool', title: `${t.label}${t.key ? ' (' + t.key + ')' : ''}`, onclick: () => this.setTool(t.id) });
      b.innerHTML = ICON[t.id];
      this.toolBtns[t.id] = b;
      tb.append(b);
    }
    for (const g of GROUPS) {
      const b = el('button', { class: 'tool group', title: g.label, onclick: (e) => { e.stopPropagation(); this.toggleFlyout(g, b); } });
      this.groupBtns[g.id] = b;
      tb.append(b);
    }
    this.paintGroups();
    tb.append(el('div', { class: 'tsep' }));
    for (const [id, fn, tip] of [['rotl', () => this.r.rotate(-1), 'Rotate left (,)'], ['rotr', () => this.r.rotate(1), 'Rotate right (.)'], ['zin', () => this.r.setZoom(this.r.z * 1.5), 'Zoom in (+)'], ['zout', () => this.r.setZoom(this.r.z / 1.5), 'Zoom out (−)']]) {
      const b = el('button', { class: `tool${id.startsWith('z') ? ' zoombtn' : ''}${id === 'rotl' ? ' rotl' : ''}`, title: tip, onclick: () => { fn(); this.g.music.sfx('click'); } });
      b.innerHTML = ICON[id];
      tb.append(b);
    }
    document.addEventListener('click', () => this.closeFlyout());

    const sb = document.getElementById('statusbar');
    sb.innerHTML = '';
    this.sDate = el('span', { class: 'sdate' });
    this.sFunds = el('span', { class: 'sfunds' });
    this.sPop = el('span', { class: 'spop' });
    this.sInc = el('button', { class: 'sinc', title: 'Open problems around town. Tap for Crews.', onclick: () => this.crewsWindow() });
    this.sVib = el('button', { class: 'svib', title: 'Vibrancy: street life within walking distance of homes. Tap for Main Street.', onclick: () => this.mainStreetWindow() });
    this.sAppr = el('button', { class: 'sappr', onclick: () => this.councilWindow() });
    this.rci = el('canvas', { class: 'rci', width: 54, height: 40, title: 'Demand: Residential, Commercial, Industrial' });
    this.ticker = el('button', { class: 'ticker', onclick: () => (this.tickerMode === 'c' ? this.commentsWindow() : this.newsWindow()) });
    this.tickerFlip = 0;
    clearInterval(this.tickerTimer);
    this.tickerTimer = setInterval(() => this.rotateTicker(), 7000);
    sb.append(el('div', { class: 'srow' }, this.sDate, this.sFunds, this.sPop, this.sAppr, this.sVib, this.sInc, this.rci), this.ticker);
    this.hint = document.getElementById('toolhint');
    this.hud = el('button', { class: 'hud', onclick: () => this.termWindow() });
    document.getElementById('viewport').append(this.hud);
    this.setTool('query');
    this.refreshStatus();
  }
  closeMenus() {
    document.querySelectorAll('.menu.open').forEach((m) => m.classList.remove('open'));
  }

  paintGroups() {
    for (const g of GROUPS) {
      const b = this.groupBtns[g.id];
      const active = g.members.includes(this.tool);
      if (active) this.groupCur[g.id] = this.tool;
      b.innerHTML = ICON[this.groupCur[g.id]] + '<i class="tri"></i><b class="glabel">' + (g.id === 'zone' ? 'Zone' : 'Civic') + '</b>';
      b.classList.toggle('on', active);
    }
  }
  toggleFlyout(g, btn) {
    if (this.flyout && this.flyout.dataset.g === g.id) return this.closeFlyout();
    this.closeFlyout();
    const fl = el('div', { class: 'flyout' });
    fl.dataset.g = g.id;
    fl.append(el('div', { class: 'fhead' }, g.label));
    for (const id of g.members) {
      const t = TOOLS.find((x) => x.id === id);
      const ic = el('span', { class: 'ficon' });
      ic.innerHTML = ICON[id];
      fl.append(el('button', { class: `fitem${this.tool === id ? ' on' : ''}`, onclick: (e) => { e.stopPropagation(); this.setTool(id); this.closeFlyout(); } }, ic, el('span', {}, el('b', {}, t.label), el('small', {}, TOOL_NOTE[id] || ''))));
    }
    fl.addEventListener('click', (e) => e.stopPropagation());
    document.body.append(fl);
    const r = btn.getBoundingClientRect();
    if (window.innerWidth <= 700) {
      const tb = document.getElementById('toolbar').getBoundingClientRect();
      fl.style.left = '6px';
      fl.style.right = '6px';
      fl.style.bottom = `${window.innerHeight - tb.top + 6}px`;
    } else {
      fl.style.left = `${r.right + 6}px`;
      fl.style.top = `${Math.min(r.top, window.innerHeight - fl.offsetHeight - 8)}px`;
    }
    this.flyout = fl;
    btn.classList.add('open');
    this.g.music && this.g.music.sfx('click');
  }
  closeFlyout() {
    if (!this.flyout) return;
    this.flyout.remove();
    this.flyout = null;
    for (const b of Object.values(this.groupBtns || {})) b.classList.remove('open');
  }

  setTool(id) {
    if (this.tool === id && id.startsWith('zone')) this.dense = !this.dense;
    else if (this.tool !== id && id.startsWith('zone')) this.dense = false;
    this.tool = id;
    for (const [k, b] of Object.entries(this.toolBtns)) b.classList.toggle('on', k === id);
    if (this.groupBtns) this.paintGroups();
    this.r && (this.r.preview = null);
    this.updateHint();
    this.g.music && this.g.music.sfx('click');
  }
  updateHint(extra) {
    const t = TOOLS.find((x) => x.id === this.tool);
    if (!t) return;
    const dens = this.tool.startsWith('zone') ? ` <b class="chip" id="densechip">${this.dense ? 'DENSE' : 'LIGHT'}</b>` : '';
    this.hint.innerHTML = `<b>${t.label}</b>${dens} <span>${extra || t.tip}</span>`;
    const chip = document.getElementById('densechip');
    if (chip) chip.onclick = () => { this.dense = !this.dense; this.updateHint(); };
  }
  setOverlay(k) {
    this.r.setOverlay(k);
    this.overlay = k;
    this.toast(k === 'none' ? 'Overlay off' : `Overlay: ${OVERLAYS.find((o) => o[0] === k)[1]}`);
    const mw = this.wins.get('map');
    if (mw) mw.refresh();
  }
  setSpeed(v) {
    this.g.speed = v;
    this.sim.paused = v === 0;
    this.speedBtn.textContent = ['❚❚', '▶', '▶▶', '▶▶▶'][v];
    this.speedBtn.title = SPEEDS[v][0];
    this.r.needs = true;
  }
  cycleSpeed() {
    this.setSpeed((this.g.speed + 1) % 4);
    this.toast(SPEEDS[this.g.speed][0]);
  }
  async toggleMusic() {
    const on = await this.g.music.toggle();
    this.musicBtn.classList.toggle('muted', !on);
    try { localStorage.setItem('townies-music', on ? '1' : '0'); } catch (e) {}
  }

  refreshStatus() {
    const s = this.sim;
    if (!s) return;
    this.sDate.textContent = s.dateStr();
    this.sFunds.textContent = fmtMoney(s.funds);
    this.sFunds.classList.toggle('neg', s.funds < 0);
    this.sPop.textContent = `Pop ${fmtInt(s.pop)}`;
    if (s.vibrancy != null) {
      const dv = s.vibrancy - (s.base.vib0 ?? s.vibrancy);
      this.sVib.textContent = `Vibrancy ${Math.round(s.vibrancy)}${Math.abs(dv) >= 1 ? (dv > 0 ? ' ▲' : ' ▼') : ''}`;
      this.sVib.classList.toggle('up', dv >= 1);
      this.sVib.classList.toggle('neg', dv <= -1);
    }
    this.sAppr.textContent = `Approval ${Math.round(s.approval)}%`;
    this.sAppr.classList.toggle('neg', s.approval < 35);
    const g = this.rci.getContext('2d');
    g.clearRect(0, 0, 54, 40);
    g.fillStyle = '#000';
    g.fillRect(0, 19, 54, 1);
    const d = s.demand || { R: 0, C: 0, I: 0 };
    [['R', '#5fd35f'], ['C', '#5f9fff'], ['I', '#f0c840']].forEach(([k, c], j) => {
      const v = clamp(d[k], -1, 1) * 18;
      g.fillStyle = c;
      g.fillRect(4 + j * 17, v > 0 ? 19 - v : 20, 12, Math.abs(v) || 1);
      g.fillStyle = '#000';
      g.font = 'bold 8px sans-serif';
      g.fillText(k, 7 + j * 17, v > 0 ? 38 : 8);
    });
    this.refreshIncidents();
    const n = s.newsLog[0];
    if (n && this.tickerMode !== 'c') this.ticker.textContent = `📰 ${n.title}`;
  }

  refreshIncidents() {
    const s = this.sim;
    if (!s || !this.sInc) return;
    const st = incidentStats(s);
    this.sInc.textContent = st.open ? `🚧 ${st.open}` : '🚧 0';
    this.sInc.classList.toggle('neg', st.late > 0);
    const w = this.wins.get('crews');
    if (w) w.refresh();
  }
  sendCrew(id) {
    const s = this.sim;
    const it = s.inc.list.find((x) => x.id === id);
    const msg = dispatch(s, id, true);
    if (msg) {
      this.toast(msg);
      this.g.music.sfx('error');
    } else {
      this.toast(`${CREW_DEPTS[INC[it.type].dept].label} ${CREW_DEPTS[INC[it.type].dept].unit} on the way${it.street ? ' to ' + it.street : ''}`);
      this.g.music.sfx('build');
    }
    this.refreshIncidents();
    this.r.needs = true;
  }
  crewsWindow() {
    this.win('crews', 'Crews', (body) => {
      const s = this.sim;
      const I = s.inc;
      if (!I) return;
      body.append(el('p', { class: 'fine' }, 'Tap a problem on the map (or Send below) to dispatch the nearest free crew. Auto-dispatch handles a department for you, but waits on paperwork and pays overtime (+40%). Quick hands-on fixes earn goodwill.'));
      for (const [dk, dd] of Object.entries(CREW_DEPTS)) {
        const crews = I.crews.filter((c) => c.dept === dk);
        const busy = crews.filter((c) => c.state !== 'idle').length;
        const cb = el('input', { type: 'checkbox' });
        cb.checked = !!I.auto[dk];
        cb.addEventListener('change', () => { I.auto[dk] = cb.checked; this.g.music.sfx('zone'); });
        body.append(el('div', { class: 'crewrow' }, el('b', {}, dd.label), el('span', {}, `${crews.length - busy}/${crews.length} ${dd.unit}s free`), el('label', { class: 'auto' }, cb, ' auto')));
      }
      const list = [...I.list];
      list.sort((a, b) => (I.day - b.born) / INC[b.type].grace - (I.day - a.born) / INC[a.type].grace);
      body.append(el('h4', {}, `Open problems (${I.list.length})`));
      if (!list.length) body.append(el('p', { class: 'fine' }, 'All quiet. Enjoy it.'));
      for (const it of list.slice(0, 25)) {
        const def = INC[it.type];
        const age = Math.floor(I.day - it.born);
        const late = I.day - it.born > def.grace;
        const status = it.working ? 'working' : it.crew ? 'on the way' : late ? `${age}d — late` : `${age}d`;
        body.append(el('div', { class: `incrow${late && !it.crew ? ' late' : ''}` },
          el('span', { class: 'ii' }, def.icon),
          el('button', { class: 'link', onclick: () => { this.r.centerOn(it.x, it.y); if (this.r.z < 1) this.r.setZoom(1.4); } }, `${def.label}${it.street ? ' · ' + it.street : ''}`),
          el('small', {}, status),
          it.crew ? '' : el('button', { class: 'btn', onclick: () => this.sendCrew(it.id) }, 'Send')));
      }
      body.append(el('p', { class: 'fine' }, `Fixed so far: ${I.fixed}${I.quick ? ` · ${I.quick} quick hands-on fixes` : ''}. Crew counts follow the Public Works and Fire budgets.`));
    });
  }
  toast(msg, ms = 1600) {
    const t = el('div', { class: 'toast' }, msg);
    document.body.append(t);
    setTimeout(() => t.classList.add('out'), ms);
    setTimeout(() => t.remove(), ms + 600);
  }

  // ---------------- windows ----------------
  win(id, title, build, opts = {}) {
    let w = this.wins.get(id);
    if (w) {
      w.el.style.zIndex = ++this.z;
      w.refresh();
      return w;
    }
    const body = el('div', { class: 'wbody' });
    const close = el('button', { class: 'wclose', title: 'Close', onclick: () => this.closeWin(id) }, '×');
    const bar = el('div', { class: 'wbar' }, close, el('span', {}, title));
    const node = el('div', { class: `win ${opts.cls || ''}`, style: `z-index:${++this.z}` }, bar, body);
    document.getElementById('windows').append(node);
    const n = this.wins.size;
    if (window.innerWidth > 700) {
      node.style.left = `${opts.x ?? 80 + n * 28}px`;
      node.style.top = `${opts.y ?? 70 + n * 24}px`;
    }
    w = { el: node, body, refresh: () => { body.innerHTML = ''; build(body); } };
    this.wins.set(id, w);
    w.refresh();
    node.addEventListener('pointerdown', () => (node.style.zIndex = ++this.z));
    // drag by title bar
    bar.addEventListener('pointerdown', (e) => {
      if (window.innerWidth <= 700 || e.target === close) return;
      const sx = e.clientX - node.offsetLeft, sy = e.clientY - node.offsetTop;
      const mv = (ev) => { node.style.left = `${ev.clientX - sx}px`; node.style.top = `${Math.max(0, ev.clientY - sy)}px`; };
      const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
      window.addEventListener('pointermove', mv);
      window.addEventListener('pointerup', up);
    });
    return w;
  }
  closeWin(id) {
    const w = this.wins.get(id);
    if (w) { w.el.remove(); this.wins.delete(id); }
    if (id === 'query') { this.r.selLot = null; this.r.needs = true; }
  }
  refreshWins() {
    for (const [id, w] of this.wins) if (id !== 'query' && id !== 'about') w.refresh();
  }

  // ---------------- query ----------------
  query(i) {
    const w = this.w, s = this.sim;
    if (i < 0) return;
    const x = i % w.W, y = (i / w.W) | 0;
    const li = w.lotOf[i];
    const lot = li >= 0 ? w.lots[li] : null;
    this.r.selLot = lot && !lot.dead ? li : null;
    this.r.needs = true;
    const c = s.cellOf(x, y);
    const row = (k, v) => (v === '' || v == null ? null : el('tr', {}, el('th', {}, k), el('td', {}, v)));
    this.win('query', 'Query', (body) => {
      const t = el('table', { class: 'kv' });
      const add = (...rs) => rs.forEach((r) => r && t.append(r));
      let head = '';
      if (!w.inTown[i]) head = 'Outside Watertown — neighbouring town';
      else if (w.terrain[i] === 1) head = w.road[i] ? `Bridge — ${w.names[w.roadName[i]] || 'unnamed'}` : 'Water';
      else if (w.road[i]) {
        head = w.names[w.roadName[i]] || 'Unnamed street';
        add(row('Type', ROAD_NAME[w.road[i]]), row('Traffic', `${Math.round(s.congestion[i] * 100)}% of capacity`), row('Condition', `${Math.round(s.roadCond * 100)}%`));
      } else if (w.svcAt[i] >= 0) {
        const sv = w.services[w.svcAt[i]];
        head = sv.name;
        add(row('Facility', SERVICES[sv.type] ? SERVICES[sv.type].label : sv.type));
      } else if (lot && !lot.dead) {
        head = lot.addr || (lot.real ? 'Parcel (no street number)' : 'Lot');
        const names = lot.bldgs.map((id) => w.bldgs[id]).filter((b) => b.alive && b.name).map((b) => b.name);
        const sv = w.services.find((q) => q.real && q.lot === li && q.alive);
        const v = lot.landVal + lot.bldgVal + (lot.otherVal || 0);
        add(
          row('Landmark', names.length ? names.slice(0, 3).join(', ') : sv && sv.name ? sv.name : ''),
          row('Use', (lot.useDesc || ZONE_NAME[lot.zone]) + (lot.auto ? ' — auto-oriented, dead frontage' : '')),
          row('Zone', `${ZONE_NAME[lot.zone]}${lot.dense ? ' · dense' : ''}${lot.zoning ? ` (city district ${lot.zoning})` : ''}`),
          row('Style', lot.style),
          row('Built', lot.year ? String(lot.year) : ''),
          row('Assessed', `${fmtMoney(v)}${lot.real && s.t < 12 ? ` (FY${lot.fy || ''})` : ''}`),
          row('  land / bldg', `${fmtMoney(lot.landVal)} / ${fmtMoney(lot.bldgVal + (lot.otherVal || 0))}`),
          row('Lot size', `${fmtInt(lot.area * 10.764)} sq ft`),
          row('Floor area', lot.bldArea > 0 ? `${fmtInt(lot.bldArea * 10.764)} sq ft` : ''),
          row('Homes', lot.units ? `${lot.units} unit${lot.units > 1 ? 's' : ''} · ~${Math.round(lot.units * 2.3 * lot.occ)} residents` : ''),
          row('Jobs', lot.jobs >= 1 ? `~${Math.round(lot.jobs * lot.occ)}` : ''),
          row('Occupancy', `${Math.round(lot.occ * 100)}%${lot.occ < 0.3 ? ' (abandoned)' : ''}`),
          row('Storefronts', lot.storefronts ? `${(lot.sf || []).length} open${lot.vacant ? ` · ${lot.vacant} for lease` : ''} · asking rent ${lot.ask >= 1.005 ? '+' : ''}${Math.round((lot.ask - 1) * 100)}% vs 2027${lot.greed > 1.15 ? ' (owner holding out)' : ''}` : ''),
          row('Businesses', lot.biz.length ? lot.biz.map((n, k) => { const kd = lot.bizKind && lot.bizKind[k]; const ch = lot.bizChainF && lot.bizChainF[k] ? ', chain' : ''; return kd && kd !== 'yes' ? `${n} (${String(kd).replace(/_/g, ' ')}${ch})` : ch ? `${n} (chain)` : n; }).join(' · ') : '')
        );
        if (lot.built > 0 && lot.year >= CFG.START.y) add(row('Note', 'Built during your term'));
      } else head = 'Open land';
      if (w.inTown[i] && w.terrain[i] !== 1) {
        add(
          row('Street life', s.vibSat ? streetLife(s.vibSat[c]) : ''),
          row('Walkability', s.walkP ? (() => { const ws = s.walkAt(x + 0.5, y + 0.5); return `${ws} · ${walkLabel(ws)}`; })() : ''),
          row('A neighbor says', s.trafC && lot && !lot.dead ? el('i', { class: 'quote' }, `“${neighborQuote(s, lot, c)}”`) : ''),
          row('Land value', `×${s.lvMod[c].toFixed(2)} vs. today`),
          row('Crime', bar(s.crimeC[c] / (s.base.crimeN * 1.3))),
          row('Pollution', bar(s.pollC[c] / (s.base.pollN * 1.3))),
          row('Police / Fire', `${Math.round(s.polCov[c] * 100)}% / ${Math.round(s.fireCov[c] * 100)}%`)
        );
      }
      body.append(el('h3', {}, head), t);
      if (lot && lot.real) body.append(el('p', { class: 'fine' }, 'Assessor data: MassGIS property tax parcels. Values change as you play.'));
    }, { x: window.innerWidth - 380, y: 70 });
  }

  // ---------------- budget ----------------
  budgetWindow() {
    this.win('budget', 'Budget', (body) => {
      const s = this.sim;
      const bl = s.budgetLines();
      const r = bl.r;
      const sec = (t) => el('h4', {}, t);
      const slider = (label, val, min, max, step, fmt, on) => {
        const out = el('span', { class: 'sval' }, fmt(val));
        const inp = el('input', { type: 'range', min, max, step, value: val });
        inp.addEventListener('input', () => { on(+inp.value); out.textContent = fmt(+inp.value); });
        inp.addEventListener('change', () => this.wins.get('budget') && this.wins.get('budget').refresh());
        return el('div', { class: 'srow2' }, el('label', {}, label), inp, out);
      };
      body.append(
        sec('Property tax (Prop 2½)'),
        el('div', { class: 'kvline' }, el('span', {}, 'Levy limit'), el('b', {}, fmtMoney(r.limit))),
        slider('Levy', s.levyPct, 0.85, 1, 0.01, (v) => `${Math.round(v * 100)}% · ${fmtMoney(r.limit * v)}`, (v) => (s.levyPct = v)),
        slider('Commercial shift', s.shift, 1, s.shiftMax, 0.01, (v) => `${v.toFixed(2)}×`, (v) => (s.shift = v)),
        slider('Res. exemption', s.exemption, 0, 0.35, 0.05, (v) => `${Math.round(v * 100)}%`, (v) => (s.exemption = v)),
        el('div', { class: 'rates' },
          el('div', {}, el('small', {}, 'Residential'), el('b', {}, `$${r.rateR.toFixed(2)}`)),
          el('div', {}, el('small', {}, 'Commercial / Ind.'), el('b', {}, `$${r.rateC.toFixed(2)}`)),
          el('div', {}, el('small', {}, 'per $1,000'), el('b', {}, r.capped ? 'at cap' : `${Math.round(r.cipShare * 100)}% on CIP`))
        ),
        el('div', { class: 'kvline' }, el('span', {}, 'State aid, excise & fees'), el('b', {}, fmtMoney(bl.other))),
        el('div', { class: 'kvline tot' }, el('span', {}, 'Revenue / yr'), el('b', {}, fmtMoney(bl.income))),
        sec('Departments')
      );
      for (const d of DEPTS)
        body.append(slider(DEPT_LABEL[d], s.fund[d], 0.5, 1.2, 0.05, (v) => `${Math.round(v * 100)}% · ${fmtMoney((bl.exp[d] / s.fund[d]) * v)}`, (v) => (s.fund[d] = v)));
      body.append(el('div', { class: 'kvline' }, el('span', {}, DEPT_LABEL.other), el('b', {}, fmtMoney(bl.exp.other))));
      for (const l of bl.recLines) body.append(el('div', { class: 'kvline' }, el('span', {}, l.label), el('b', { class: l.annual < 0 ? 'pos' : '' }, l.annual < 0 ? '+' + fmtMoney(-l.annual) : fmtMoney(l.annual))));
      if (bl.upkeep) body.append(el('div', { class: 'kvline' }, el('span', {}, 'Civic facilities (operating)'), el('b', {}, fmtMoney(bl.upkeep))));
      if (bl.interest) body.append(el('div', { class: 'kvline' }, el('span', {}, 'Short-term borrowing interest'), el('b', {}, fmtMoney(bl.interest))));
      body.append(
        el('div', { class: 'kvline tot' }, el('span', {}, 'Expenses / yr'), el('b', {}, fmtMoney(bl.expenses))),
        el('div', { class: `kvline tot ${bl.net < 0 ? 'neg' : 'pos'}` }, el('span', {}, 'Net / yr'), el('b', {}, fmtMoney(bl.net))),
        el('div', { class: 'kvline' }, el('span', {}, 'Reserves'), el('b', {}, fmtMoney(s.funds)))
      );
      const pend = s.pending.some((p) => p.id === 'override');
      const pctSel = el('select', {}, ...[0.025, 0.05, 0.075, 0.1].map((v) => el('option', { value: v }, `${(v * 100).toFixed(1)}%`)));
      body.append(
        sec('Ask the voters'),
        pend
          ? el('p', { class: 'fine' }, 'An override question is on the next ballot.')
          : el('div', { class: 'srow2' }, el('label', {}, 'Override'), pctSel, el('button', { class: 'btn', onclick: () => {
              s.pending.push({ at: s.t + 2, id: 'override', data: { pct: +pctSel.value } });
              s.news('Override heads to the ballot', `The Council voted to ask voters for a ${(+pctSel.value * 100).toFixed(1)}% Prop 2½ override. Yard signs appear overnight.`, 'big');
              this.wins.get('budget').refresh();
              this.refreshStatus();
            } }, 'Put on ballot')),
        el('p', { class: 'fine' }, 'Massachusetts caps the levy at last year’s limit +2.5% plus new growth. Raising it further needs voters. The shift moves the levy onto commercial & industrial property (up to a state cap). The exemption lowers bills for owner-occupants and raises them for landlords, condos and businesses’ rents.')
      );
    }, { cls: 'wide' });
  }

  mainStreetWindow() {
    this.win('main', 'Main Street', (body) => {
      const s = this.sim;
      const st = s.sfStats || {};
      const dv = s.vibrancy - (s.base.vib0 ?? s.vibrancy);
      const total = (st.open || 0) + (st.vacant || 0);
      const stat = (label, val, sub) => el('div', { class: 'mstat' }, el('small', {}, label), el('b', {}, val), sub ? el('i', {}, sub) : null);
      body.append(
        el('div', { class: 'mstats' },
          stat('Vibrancy', `${Math.round(s.vibrancy)}`, `${dv >= 0 ? '+' : ''}${dv.toFixed(1)} since you took office`),
          stat('Storefronts open', `${st.open || 0}`, `${st.vacant || 0} for lease (${total ? Math.round((100 * (st.vacant || 0)) / total) : 0}%)`),
          stat('Independents', `${st.indie || 0}`, `${st.chain || 0} chains · ${st.sig || 0} signature`),
          stat('Asking rents', `${(st.askAvg || 1) >= 1 ? '+' : ''}${Math.round(((st.askAvg || 1) - 1) * 100)}%`, `vs 2027 · buzz ${Math.round((s.hype || 0) * 100)}`)
        ),
        el('div', { class: 'kvline' }, el('span', {}, 'Walkability where people live'), el('b', {}, `${Math.round(s.walkIndex || 0)} · ${walkLabel(s.walkIndex || 0)}`)),
        this.peerTable(),
        el('p', { class: 'fine' }, 'Signature independents (coffee, books, boutiques, galleries, bakeries) make a street feel alive and are the first to go when landlords chase the "Watertown is on the rise" rents. Chains and bank branches can pay more, and add less.'),
        el('button', { class: 'btn', onclick: () => this.setOverlay(this.overlay === 'vibrancy' ? 'none' : 'vibrancy') }, this.overlay === 'vibrancy' ? 'Hide vibrancy map' : 'Show vibrancy map'),
        el('h4', {}, 'Policies')
      );
      s.policies = s.policies || {};
      for (const [k, p] of Object.entries(POLICIES)) {
        const rec = s.recurring['pol:' + { vacancyFee: 'vacfee', rentRelief: 'relief', legacy: 'legacy', formulaRetail: 'formula', popups: 'popups' }[k]];
        const cost = rec ? (rec.monthly < 0 ? `+${fmtMoney(-rec.monthly * 12)}/yr` : `${fmtMoney(rec.monthly * 12)}/yr`) : '';
        const cb = el('input', { type: 'checkbox' });
        cb.checked = !!s.policies[k];
        cb.addEventListener('change', () => {
          s.policies[k] = cb.checked;
          const item = s.news(cb.checked ? `Council adopts ${p.label.toLowerCase()}` : `Council repeals ${p.label.toLowerCase()}`, '');
          react(s, cb.checked ? 'policy-on:' + k : 'policy-off', {}, item);
          s.updateApproval();
          this.refreshStatus();
          this.g.music.sfx('zone');
        });
        body.append(el('label', { class: 'policy' }, cb, el('span', {}, el('b', {}, p.label), cost ? el('em', {}, ` ${cost}`) : null, el('small', {}, p.blurb))));
      }
      body.append(el('h4', {}, 'Recent openings & closings'));
      const log = el('div', { class: 'sflog' });
      for (const l of (s.sfLog || []).slice(0, 12)) log.append(el('div', { class: `sfl ${l.type}` }, el('small', {}, l.date), ' ', l.text));
      if (!(s.sfLog || []).length) log.append(el('p', { class: 'fine' }, 'Nothing yet. Leases turn over every few years.'));
      body.append(log);
    }, { cls: 'wide' });
  }

  rotateTicker() {
    const s = this.sim;
    if (!s || !this.ticker) return;
    this.tickerFlip++;
    const c = (s.comments || []).filter((x) => x.who !== 'editor' && s.t - x.t < 4);
    if (this.tickerFlip % 2 === 1 && c.length) {
      const x = c[(this.tickerFlip >> 1) % Math.min(3, c.length)];
      this.tickerMode = 'c';
      this.ticker.textContent = `💬 ${CAST[x.who] ? CAST[x.who].name : x.who}: ${x.text}`;
    } else {
      this.tickerMode = 'n';
      const n = s.newsLog[0];
      if (n) this.ticker.textContent = `📰 ${n.title}`;
    }
  }
  avatar(who) {
    const c = CAST[who];
    const a = el('span', { class: 'avatar', style: `background:${c ? c.color : '#222'}` }, c ? c.name.replace(/[^A-Z]/g, '').slice(0, 2) : 'Ed');
    return a;
  }
  commentBlock(list) {
    if (!list || !list.length) return '';
    const box = el('div', { class: 'cblock' });
    for (const c of list.slice(0, 4)) box.append(el('div', { class: `cmt${c.who === 'editor' ? ' ed' : ''}` }, this.avatar(c.who), el('span', {}, el('b', {}, c.who === 'editor' ? 'Editor' : CAST[c.who] ? CAST[c.who].name : c.who), ' ', c.text)));
    return box;
  }
  commentsWindow() {
    this.win('comments', 'Comment Section', (body) => {
      const s = this.sim;
      body.append(el('p', { class: 'fine' }, 'The regulars. Fictional, but you have met them. Comments react to what you do; tap a block with Query to hear from a neighbor.'));
      const list = el('div', { class: 'cfeed' });
      for (const c of (s.comments || []).slice(0, 40)) {
        list.append(el('div', { class: `cmt${c.who === 'editor' ? ' ed' : ''}` }, this.avatar(c.who),
          el('span', {}, el('b', {}, c.who === 'editor' ? 'Editor' : CAST[c.who] ? CAST[c.who].name : c.who), el('small', {}, ` ${c.date}${c.re ? ' · re: ' + c.re : ''}`), el('br'), c.text)));
      }
      if (!(s.comments || []).length) list.append(el('p', { class: 'fine' }, 'Quiet for now. Give it a month.'));
      body.append(list, el('h4', {}, 'The regulars'));
      for (const [k, c] of Object.entries(CAST)) body.append(el('div', { class: 'cmt' }, this.avatar(k), el('span', {}, el('b', {}, c.name), ' — ', c.bio)));
    }, { cls: 'wide' });
  }

  projectPlanner(ids) {
    const sim = this.sim;
    const prev = this.planState && this.planState.ids.join() === ids.join() ? this.planState : null;
    this.planState = prev || { ids, exclude: new Set(), prog: 'infill', t: { ...PROGRAMS.infill.defaults }, name: null, showParcels: false };
    const st = this.planState;
    this.closeWin('planner');
    this.win('planner', 'Plan a project', (body) => {
      const site = analyze(sim, st.ids, st.exclude);
      if (!st.name || st.nameProg !== st.prog) {
        st.name = projectName(sim, st.prog, site);
        st.nameProg = st.prog;
      }
      const o = evaluate(sim, site, st.prog, st.t);
      const reasons = [];
      const hs = hearingScore(sim, site, st.prog, st.t, o, reasons);
      const odds = hearingOdds(hs);
      const acres = (site.area / 4046.86).toFixed(1);
      body.append(
        el('div', { class: 'psite' }, el('b', {}, `${site.ids.length} parcel${site.ids.length === 1 ? '' : 's'} · ${acres} acres`), ` · assessed ${fmtMoney(site.value)} · tax today ${fmtMoney(site.tax)}/yr`),
        el('div', { class: 'psite' }, [site.homes ? `🏠 ${site.homes} homes (${site.residents} residents)` : '', site.indie ? `🏪 ${site.indie} independent businesses${site.sig ? ` (${site.sig} signature)` : ''}` : '', site.auto ? `🚗 ${site.auto} auto-oriented lots` : '', site.holdouts.length ? `✋ ${site.holdouts.length} holdout owner${site.holdouts.length > 1 ? 's' : ''}` : ''].filter(Boolean).join(' · ') || 'Nothing much here today.'),
        el('button', { class: 'link', onclick: () => { st.showParcels = !st.showParcels; this.wins.get('planner').refresh(); } }, st.showParcels ? 'Hide parcels' : 'Choose parcels…')
      );
      if (st.showParcels) {
        const box = el('div', { class: 'parcels' });
        for (const li of st.ids) {
          const lot = this.w.lots[li];
          const ho = site.holdouts.find((h) => h.id === li) || analyze(sim, [li]).holdouts[0];
          const cb = el('input', { type: 'checkbox' });
          cb.checked = !st.exclude.has(li);
          cb.addEventListener('change', () => { if (cb.checked) st.exclude.delete(li); else st.exclude.add(li); this.wins.get('planner').refresh(); });
          const flags = [lot.units ? `🏠${lot.units}` : '', lot.auto ? '🚗' : '', lot.bizSig && lot.bizSig.some(Boolean) ? '★' : '', ho ? `✋ asks ${fmtMoney(ho.ask)}` : ''].filter(Boolean).join(' ');
          box.append(el('label', { class: 'parcel' }, cb, el('span', {}, `${lot.addr || 'Parcel'} — ${lot.useDesc || ''}`), el('small', {}, `${fmtMoney(lot.landVal + lot.bldgVal)} ${flags}`)));
        }
        body.append(box);
      }
      // program cards
      const cards = el('div', { class: 'progs' });
      for (const [k, p] of Object.entries(PROGRAMS)) {
        cards.append(el('button', { class: `prog${st.prog === k ? ' on' : ''}`, onclick: () => { st.prog = k; st.t = { ...p.defaults }; this.wins.get('planner').refresh(); } }, el('span', { class: 'pi' }, p.icon), el('b', {}, p.label), el('small', {}, p.who === 'city' ? 'City-led' : 'Private developer')));
      }
      body.append(el('h4', {}, 'Program'), cards, el('p', { class: 'fine' }, PROGRAMS[st.prog].blurb));
      // terms
      const terms = el('div', { class: 'terms' });
      const slider = (key, label, min, max, step, fmt) => {
        const out = el('span', { class: 'sval' }, fmt(st.t[key]));
        const inp = el('input', { type: 'range', min, max, step, value: st.t[key] });
        inp.addEventListener('input', () => { st.t[key] = +inp.value; out.textContent = fmt(st.t[key]); });
        inp.addEventListener('change', () => this.wins.get('planner').refresh());
        terms.append(el('div', { class: 'srow2' }, el('label', {}, label), inp, out));
      };
      const check = (key, label) => {
        const cb = el('input', { type: 'checkbox' });
        cb.checked = !!st.t[key];
        cb.addEventListener('change', () => { st.t[key] = cb.checked; this.wins.get('planner').refresh(); });
        terms.append(el('label', { class: 'tcheck' }, cb, ' ', label));
      };
      const pr = st.prog;
      if (pr === 'mega' || pr === 'housing' || pr === 'lab' || pr === 'infill') slider('floors', 'Stories', pr === 'infill' ? 3 : 3, pr === 'infill' ? 5 : pr === 'lab' ? 9 : 12, 1, (v) => `${v}`);
      if (pr === 'mega' || (pr === 'housing' && !st.t.nonprofit)) slider('affordable', 'Affordable homes', 0, 30, 1, (v) => `${v}%`);
      if (pr === 'mega') slider('local', 'Local-only storefronts', 0, 100, 25, (v) => `${v}%`);
      if (pr === 'mega' || pr === 'housing' || pr === 'lab') slider('parking', 'Parking per home/1,000 m²', 0, 1.5, 0.25, (v) => v.toFixed(2));
      if (pr === 'mega' || pr === 'lab') slider('transit', 'Transit & streetscape $', 0, 5, 0.5, (v) => `$${v}M`);
      if (pr === 'mega') check('plaza', 'Include a public plaza');
      if (pr === 'housing') check('nonprofit', '100% affordable with a nonprofit (City subsidy)');
      if (pr === 'infill') {
        check('deedRent', 'Deed-restrict storefront rents for 15 years (costs more up front)');
        const sel = el('select', {}, el('option', { value: 'homes' }, 'Apartments upstairs'), el('option', { value: 'offices' }, 'Offices upstairs'));
        sel.value = st.t.upper;
        sel.addEventListener('change', () => { st.t.upper = sel.value; this.wins.get('planner').refresh(); });
        terms.append(el('div', { class: 'srow2' }, el('label', {}, 'Upper floors'), sel, el('span', {})));
      }
      if (pr === 'plaza') check('kiosk', 'Café kiosk (leased to a local operator)');
      body.append(el('h4', {}, 'Terms'), terms);
      // projection
      const mood = devMood(o.devFeas);
      const outlook = odds > 0.75 ? ['Likely', '#145a14'] : odds > 0.5 ? ['Toss-up, leaning yes', '#3a7a1a'] : odds > 0.25 ? ['Uphill', '#a06a00'] : ['Long shot', '#b00'];
      const kv = (k, v, cls) => el('div', { class: `kvline${cls ? ' ' + cls : ''}` }, el('span', {}, k), el('b', {}, v));
      body.append(
        el('h4', {}, 'What you get'),
        o.homes ? kv('Homes', `${o.homes}${o.affordable ? ` (${o.affordable} affordable)` : ''}`) : '',
        o.storefronts ? kv('Storefronts', `${o.storefronts}${o.chainShops ? ` · ${o.localShops} local / ${o.chainShops} chain` : ' · local'}`) : '',
        o.jobs ? kv('Jobs', fmtInt(o.jobs)) : '',
        kv('Property tax / yr', `${fmtMoney(o.taxNow)} → ${fmtMoney(o.taxNew)}`),
        kv('Street life', `+${o.vibGain.toFixed(1)} added · −${Math.max(0, o.vibLost).toFixed(1)} lost`, o.vibGain - Math.max(0, o.vibLost) > 0 ? 'pos' : 'neg'),
        kv('City cost', o.cityCost ? fmtMoney(o.cityCost) : 'none (developer pays)', o.cityCost ? 'neg' : ''),
        kv('Construction', `~${Math.round((o.months / 12) * 10) / 10} years`),
        mood ? el('div', { class: 'kvline' }, el('span', {}, 'Developer'), el('b', { style: `color:${mood[1]}` }, mood[0])) : '',
        el('div', { class: 'kvline' }, el('span', {}, 'Planning Board outlook'), el('b', { style: `color:${outlook[1]}` }, `${outlook[0]} (${Math.round(odds * 100)}%)`)),
        el('div', { class: 'reasons' }, ...reasons.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 5).map(([l, v]) => el('div', { class: v > 0 ? 'pos' : 'neg' }, `${v > 0 ? '▲' : '▼'} ${l}`))),
        ...o.notes.map((n) => el('p', { class: 'warn' }, n))
      );
      const nameIn = el('input', { type: 'text', value: st.name, class: 'pname' });
      nameIn.addEventListener('input', () => (st.name = nameIn.value));
      body.append(
        el('div', { class: 'srow2' }, el('label', {}, 'Project name'), nameIn, el('span', {})),
        el('div', { class: 'choices' },
          el('button', { class: 'choice', onclick: () => {
            const res = submit(sim, st.ids, st.prog, { ...st.t, exclude: [...st.exclude] }, st.name);
            if (res.error) { this.toast(res.error, 4000); this.g.music.sfx('error'); return; }
            this.g.music.sfx('build');
            this.closeWin('planner');
            this.planState = null;
            this.refreshStatus();
            this.r.needs = true;
            this.toast(`${st.name} filed. Hearing in two months.`, 3000);
          } }, el('b', {}, 'Submit to the Planning Board'), el('small', {}, mood && mood[0] === 'Walks away' && !(st.prog === 'housing' && st.t.nonprofit) ? 'The developer will not sign at these terms.' : 'Public hearing in two months.')),
          el('button', { class: 'choice', onclick: () => { this.closeWin('planner'); this.planState = null; } }, el('b', {}, 'Cancel')))
      );
    }, { cls: 'wide planner', x: 100, y: 60 });
  }

  projectsWindow() {
    this.win('projects', 'Projects', (body) => {
      const s = this.sim;
      const list = [...(s.projects || [])].reverse();
      body.append(el('p', { class: 'fine' }, 'Use the Redevelop tool (crane) to outline a site over parcels. Target car lots and parking, keep homes out of the outline, and the hearing gets easier.'));
      if (!list.length) body.append(el('p', { class: 'fine' }, 'No projects yet.'));
      for (const p of list) {
        const stage = p.stage === 'hearing' ? `Hearing ${p.at - s.t <= 0 ? 'this month' : 'in ' + (p.at - s.t) + ' mo'}` : p.stage === 'build' ? `Building · ${Math.round((100 * (s.t - p.start)) / Math.max(1, p.at - p.start))}%` : p.stage === 'done' ? `Opened ${p.doneAt != null ? '' : ''}` : 'Denied';
        body.append(el('div', { class: `projrow ${p.stage}` }, el('span', { class: 'pi' }, PROGRAMS[p.prog].icon), el('button', { class: 'link', onclick: () => this.r.centerOn(p.cx, p.cy) }, p.name), el('small', {}, stage)));
      }
    });
  }

  refreshHud() {
    const s = this.sim;
    if (!s || !this.hud) return;
    const sc = s.scenario;
    if (!sc) { this.hud.style.display = 'none'; return; }
    const T = TERMS[sc.id];
    this.hud.style.display = '';
    this.hud.innerHTML = '';
    const left = sc.deadline != null ? sc.deadline - s.t : null;
    this.hud.append(el('div', { class: 'hudt' }, `${T.icon} ${T.title}`, el('small', {}, sc.done ? (sc.done.won ? ` · done ${'★'.repeat(sc.done.stars)}` : ' · ended') : left != null ? ` · ${Math.floor(left / 12)}y ${left % 12}m left` : ` · review ${Math.max(0, sc.nextReview - s.t)} mo`)));
    for (const g of goalStatus(s)) {
      this.hud.append(el('div', { class: `hudg${g.met ? ' met' : ''}` }, el('span', {}, g.label), el('i', {}, el('em', { style: `width:${Math.round(g.prog * 100)}%` })), el('b', {}, `${g.fmt(g.value)}${g.keep ? ` (≥ ${g.fmt(g.target)})` : g.max ? ` / ${g.target}` : ` / ${g.fmt(g.target)}`}`)));
    }
  }
  termWindow() {
    this.win('term', 'Your term', (body) => {
      const s = this.sim;
      const sc = s.scenario;
      if (!sc) return;
      const T = TERMS[sc.id];
      body.append(el('h3', {}, `${T.icon} ${T.title}`), el('p', {}, T.blurb));
      if (sc.deadline != null) body.append(el('p', { class: 'fine' }, `Deadline: ${Math.floor((sc.deadline - s.t) / 12)} years ${(sc.deadline - s.t) % 12} months from now.${T.floor ? ` Approval must not stay under ${T.floor.approval}% (now ${sc.lowMonths} month${sc.lowMonths === 1 ? '' : 's'} under).` : ''}`));
      for (const g of goalStatus(s)) body.append(el('div', { class: 'kvline' }, el('span', {}, `${g.met ? '✅' : '⬜'} ${g.label}`), el('b', {}, `${g.fmt(g.value)} / ${g.fmt(g.target)}`)));
      body.append(el('h4', {}, 'Contract reviews (every 3 years)'));
      if (!sc.reviews.length) body.append(el('p', { class: 'fine' }, `First review ${sc.nextReview - s.t} months from now. The Council looks at approval, the budget, and progress on your goals.`));
      for (const r of sc.reviews) body.append(el('div', { class: 'kvline' }, el('span', {}, r.date), el('b', {}, `Grade ${r.grade} · approval ${r.approval}%`)));
    });
  }
  scenarioEvent(ev) {
    this.g.music.sfx('alert');
    const s = this.sim;
    const T = TERMS[s.scenario.id];
    let box;
    if (ev.type === 'review') {
      box = el('div', { class: 'win modal' }, el('div', { class: 'wbar' }, el('span', {}, 'Contract review')), el('div', { class: 'wbody' },
        el('h2', {}, `Grade: ${ev.rec.grade}`), el('p', {}, `The Council renewed your contract. Average approval ${ev.rec.approval}% over the last year; reserves ${ev.rec.funds >= 0 ? 'positive' : 'in the red'}.`),
        el('div', { class: 'choices' }, el('button', { class: 'choice', onclick: () => this.closeModal() }, el('b', {}, 'Back to work')))));
    } else {
      const won = ev.type === 'win';
      box = el('div', { class: 'win modal' }, el('div', { class: 'wbar' }, el('span', {}, won ? 'Mission accomplished' : 'Term over')), el('div', { class: 'wbody' },
        el('h2', {}, won ? `${T.title} ${'★'.repeat(ev.stars)}${'☆'.repeat(3 - ev.stars)}` : T.title),
        el('p', {}, won ? 'The Council, the comment section and (most of) Pleasant St agree: you did it.' : ev.why || 'The term ended without every goal met.'),
        ...ev.goals.map((g) => el('div', { class: 'kvline' }, el('span', {}, `${g.met ? '✅' : '❌'} ${g.label}`), el('b', {}, `${g.fmt(g.value)} / ${g.fmt(g.target)}`))),
        el('div', { class: 'choices' },
          el('button', { class: 'choice', onclick: () => { this.closeModal(); this.refreshHud(); } }, el('b', {}, 'Keep governing'), el('small', {}, 'continue in sandbox')),
          el('button', { class: 'choice', onclick: () => this.g.restart() }, el('b', {}, 'Start a new term')))));
    }
    this.showModal(box);
  }

  peerTable() {
    const s = this.sim;
    const peers = (this.g.peers && this.g.peers.centers) || [];
    if (!peers.length) return '';
    const proj = makeProj(this.w.bbox);
    const area = Math.PI * (MIX_RADIUS_M / 1000) ** 2;
    const rows = peers.map((p) => {
      if (!p.home) return { ...p, live: false };
      const [x, y] = proj.toGrid(p.lat, p.lon);
      const m = s.mixAt(x, y, MIX_RADIUS_M / 16);
      return { ...p, walk: s.walkAt(x, y), perKm2: Math.round(m.storefronts / area), sigPerKm2: Math.round(m.sig / area), chainShare: m.storefronts ? m.chains / m.storefronts : 0, auto: m.auto, live: true, x, y };
    });
    rows.sort((a, b) => b.walk - a.walk || b.sigPerKm2 - a.sigPerKm2);
    const t = el('table', { class: 'peers' }, el('tr', {}, el('th', {}, 'Center'), el('th', {}, 'Walk'), el('th', { title: 'storefronts per km² within a 7-minute walk' }, 'Shops'), el('th', { title: 'signature independents per km²' }, '★'), el('th', {}, 'Chains'), el('th', { title: 'auto-oriented businesses within 600 m' }, '🚗')));
    for (const r of rows) {
      t.append(el('tr', { class: r.home ? 'home' : '' },
        el('td', {}, r.live ? el('button', { class: 'link', onclick: () => this.r.centerOn(r.x, r.y) }, r.name) : `${r.name}, ${r.town}`),
        el('td', {}, String(r.walk)), el('td', {}, String(r.perKm2)), el('td', {}, String(r.sigPerKm2)), el('td', {}, `${Math.round(r.chainShare * 100)}%`), el('td', {}, String(r.auto))));
    }
    return el('div', {}, el('h4', {}, 'How we compare'), t, el('p', { class: 'fine' }, `Walkability is a Walk Score–style index rebuilt from open data (not Walk Score's own scores). Peer figures from the ${this.g.peers.generated ? new Date(this.g.peers.generated).toLocaleDateString() : ''} data snapshot; Watertown rows are live.`));
  }

  councilWindow() {
    this.win('council', 'City Council', (body) => {
      const s = this.sim;
      body.append(el('div', { class: 'big' }, `${Math.round(s.approval)}%`), el('p', { class: 'fine' }, 'Approval of the City Manager. Below 30% for a year and the Council won’t renew your contract.'));
      for (const f of FACTIONS) body.append(el('div', { class: 'frow' }, el('span', {}, FACTION_LABEL[f]), bar(s.factions[f] / 100, true), el('b', {}, `${Math.round(s.factions[f])}`)));
      if (s.lowMonths) body.append(el('p', { class: 'warn' }, `Approval has been under 30% for ${s.lowMonths} month(s).`));
    });
  }

  graphsWindow() {
    this.win('graphs', 'Graphs', (body) => {
      const s = this.sim;
      const H = s.history;
      const series = [['Population', (h) => h.pop, '#2a7a2a'], ['Jobs', (h) => h.jobs, '#2a4fa8'], ['Reserves', (h) => h.funds, '#a87a00'], ['Approval', (h) => h.approval, '#a82a6a'], ['Vibrancy', (h) => h.vib || 0, '#c0602a'], ['Empty storefronts', (h) => h.vac || 0, '#7a2a2a'], ['Res. land $/m²', (h) => h.lv, '#555']];
      for (const [name, f, col] of series) {
        const c = el('canvas', { width: 300, height: 60, class: 'graph' });
        const g = c.getContext('2d');
        const vals = H.map(f);
        const mn = Math.min(...vals), mx = Math.max(...vals);
        g.fillStyle = '#fff';
        g.fillRect(0, 0, 300, 60);
        g.strokeStyle = col;
        g.lineWidth = 2;
        g.beginPath();
        vals.forEach((v, k) => {
          const x = vals.length > 1 ? (k / (vals.length - 1)) * 296 + 2 : 150;
          const y = 56 - (mx > mn ? ((v - mn) / (mx - mn)) * 50 : 25);
          k ? g.lineTo(x, y) : g.moveTo(x, y);
        });
        g.stroke();
        const last = vals[vals.length - 1] || 0;
        const fmt = name === 'Reserves' ? fmtMoney(last) : name === 'Approval' ? `${Math.round(last)}%` : name.startsWith('Res.') ? `$${Math.round(last)}` : fmtInt(last);
        body.append(el('div', { class: 'gl' }, el('span', {}, name), el('b', {}, fmt)), c);
      }
    });
  }

  mapWindow() {
    this.win('map', 'Map', (body) => {
      const w = this.w;
      const sc = Math.min(260 / w.W, 220 / w.H);
      const c = el('canvas', { width: Math.round(w.W * sc), height: Math.round(w.H * sc), class: 'minimap' });
      const off = document.createElement('canvas');
      off.width = w.W;
      off.height = w.H;
      const g = off.getContext('2d');
      const img = g.createImageData(w.W, w.H);
      const d = img.data;
      const ov = this.overlay && this.overlay !== 'none' ? this.overlay : null;
      for (let i = 0; i < w.W * w.H; i++) {
        let col;
        const oc = ov ? this.sim.overlayColor(ov, i) : null;
        if (oc) col = oc;
        else if (w.terrain[i] === 1) col = [44, 100, 180];
        else if (w.road[i]) col = [70, 70, 75];
        else if (w.lotOf[i] >= 0) {
          const z = w.lots[w.lotOf[i]].zone;
          col = [[110, 150, 80], [120, 190, 100], [130, 160, 210], [210, 190, 110], [180, 150, 200], [70, 140, 70]][z];
        } else if (w.cover[i] === 1 || w.cover[i] === 2) col = [60, 120, 50];
        else col = [94, 145, 52];
        if (!w.inTown[i]) col = col.map((v) => v * 0.45);
        d[i * 4] = col[0]; d[i * 4 + 1] = col[1]; d[i * 4 + 2] = col[2]; d[i * 4 + 3] = 255;
      }
      g.putImageData(img, 0, 0);
      const cg = c.getContext('2d');
      cg.imageSmoothingEnabled = false;
      cg.drawImage(off, 0, 0, c.width, c.height);
      cg.strokeStyle = '#fff';
      cg.lineWidth = 2;
      cg.strokeRect(this.r.cam.x * sc - 6, this.r.cam.y * sc - 6, 12, 12);
      c.addEventListener('pointerdown', (e) => {
        const rect = c.getBoundingClientRect();
        this.r.centerOn(((e.clientX - rect.left) / rect.width) * w.W, ((e.clientY - rect.top) / rect.height) * w.H);
        this.wins.get('map').refresh();
      });
      body.append(c, el('p', { class: 'fine' }, 'North is up. Tap to jump.'));
    });
  }

  newsWindow() {
    this.win('news', 'Newspaper', (body) => {
      const s = this.sim;
      const top = s.newsLog.find((n) => n.size === 'big') || s.newsLog[0];
      body.append(el('div', { class: 'mast' }, 'The Watertown Townie'), el('div', { class: 'dateline' }, `${s.dateStr()} · Price: one civic grievance`));
      if (top) body.append(el('h2', { class: 'headline' }, top.title), top.body ? el('p', {}, top.body) : null, this.commentBlock(top.comments));
      const list = el('div', { class: 'stories' });
      for (const n of s.newsLog.slice(0, 18)) {
        if (n === top) continue;
        list.append(el('div', { class: 'story' }, el('small', {}, n.date), el('b', {}, n.title), n.body ? el('p', {}, n.body) : null, this.commentBlock(n.comments)));
      }
      body.append(list);
    }, { cls: 'paper' });
  }

  aboutWindow() {
    this.win('about', 'About Townies', (body) => {
      const w = this.w;
      body.append(
        el('p', {}, 'A city-building game set in the real Watertown, Massachusetts, inspired by SimCity 2000. Not affiliated with Maxis or EA.'),
        el('p', {}, `Every tile is ${CFG.TILE_M} m across, true to scale. Streets, buildings, rivers, parks and businesses come from OpenStreetMap; parcels, assessed values, year built and use come from the MassGIS statewide property tax parcels. Council agenda items are fictionalised riffs on recurring local storylines.`),
        el('p', { class: 'fine' }, `Map data © OpenStreetMap contributors (ODbL), via Geofabrik. Parcels and building footprints: MassGIS (Bureau of Geographic Information), Commonwealth of Massachusetts. Business listings: Overture Maps Foundation (CDLA-Permissive-2.0). ${w.sources && w.sources.footprintsAdded ? `${fmtInt(w.sources.footprintsAdded)} buildings filled in from MassGIS; ` : ''}${w.sources && w.sources.places ? `${fmtInt(w.sources.places)} businesses from Overture. ` : ''}${w.stats ? `${fmtInt(w.stats.buildings)} buildings, ${fmtInt(w.stats.lots)} lots.` : ''} ${w.hasParcels ? '' : 'Parcel data was unavailable; values are estimated.'} Data downloaded ${w.fetched ? new Date(w.fetched).toLocaleDateString() : ''}.`),
        el('p', { class: 'fine' }, 'Keys: Q query · H pan · B bulldoze · D road · 1/2/3 zone R/C/I · P park · , . rotate · + − zoom · space pause · arrows pan.')
      );
    });
  }

  // ---------------- agenda dialogs ----------------
  agenda(sc, ctx) {
    this.g.music.sfx('alert');
    const box = el('div', { class: 'win modal agenda' });
    box.append(el('div', { class: 'wbar' }, el('span', {}, 'City Council Agenda')));
    const body = el('div', { class: 'wbody' });
    body.append(el('div', { class: 'agdate' }, this.sim.dateStr()), el('h2', {}, sc.title), el('p', {}, sc.text(this.sim, ctx)));
    if (ctx && ctx.cx != null) {
      body.append(el('button', { class: 'link', onclick: () => { this.r.centerOn(ctx.cx, ctx.cy); this.r.selLot = ctx.id; } }, '📍 Show me where'));
      this.r.selLot = ctx.id;
      this.r.centerOn(ctx.cx, ctx.cy);
    }
    const choices = el('div', { class: 'choices' });
    for (const ch of sc.choices) {
      choices.append(el('button', { class: 'choice', onclick: () => {
        const before = { ...this.sim.approvalOff };
        try { ch.run(this.sim, ctx); } catch (e) { console.error(e); }
        const delta = {};
        for (const k of Object.keys(this.sim.approvalOff)) delta[k] = this.sim.approvalOff[k] - (before[k] || 0);
        try { reactAgenda(this.sim, sc.title, delta); } catch (e) { console.error(e); }
        this.closeModal();
        this.refreshStatus();
        this.refreshWins();
        this.r.refreshOverlay();
        this.r.selLot = null;
        this.g.music.sfx('build');
      } }, el('b', {}, ch.label), ch.fx ? el('small', {}, ch.fx) : null));
    }
    body.append(choices);
    box.append(body);
    this.showModal(box);
  }
  showModal(box) {
    this.closeModal();
    const back = el('div', { class: 'backdrop' }, box);
    document.body.append(back);
    this.modal = back;
  }
  closeModal() {
    if (this.modal) this.modal.remove();
    this.modal = null;
  }
  gameOver(go) {
    const box = el('div', { class: 'win modal' }, el('div', { class: 'wbar' }, el('span', {}, 'Game over')), el('div', { class: 'wbody' }, el('h2', {}, go.title), el('p', {}, go.text), el('div', { class: 'choices' },
      el('button', { class: 'choice', onclick: () => this.g.restart() }, el('b', {}, 'Start a new term')),
      el('button', { class: 'choice', onclick: () => { this.sim.gameOver = null; this.sim.lowMonths = 0; this.sim.debtMonths = 0; this.closeModal(); } }, el('b', {}, 'Keep playing anyway'), el('small', {}, 'sandbox mode'))
    )));
    this.showModal(box);
  }

  // ---------------- input ----------------
  bindInput() {
    const cv = document.getElementById('view');
    const pts = new Map();
    let mode = null; // 'pan' | 'tool' | 'pinch'
    let start = null, moved = false, startTile = -1, lastPinch = null;
    const pos = (e) => {
      const r = cv.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };
    const dragTools = new Set(['bulldoze', 'road', 'zoneR', 'zoneC', 'zoneI', 'dezone', 'park', 'develop']);
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('pointerdown', (e) => {
      if (!this.r) return;
      cv.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, pos(e));
      if (pts.size === 2) {
        mode = 'pinch';
        this.r.preview = null;
        const [a, b] = [...pts.values()];
        lastPinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), c: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] };
        return;
      }
      start = pos(e);
      moved = false;
      const isTouch = e.pointerType !== 'mouse';
      if (e.button === 1 || e.button === 2 || this.tool === 'pan' || (this.tool === 'query' && true)) mode = 'pan';
      else mode = 'tool';
      if (e.button === 2 || e.button === 1) mode = 'pan';
      startTile = this.r.tileAt(start[0], start[1]);
      if (mode === 'tool') this.updatePlan(startTile, startTile);
      void isTouch;
    });
    cv.addEventListener('pointermove', (e) => {
      if (!this.r) return;
      const p = pos(e);
      if (!pts.has(e.pointerId)) {
        if (e.pointerType === 'mouse') {
          const t = this.r.tileAt(p[0], p[1]);
          if (t !== this.r.hover) {
            this.r.hover = t;
            this.r.needs = true;
            if (SERVICES[this.tool]) this.updatePlan(t, t);
          }
        }
        return;
      }
      const prev = pts.get(e.pointerId);
      pts.set(e.pointerId, p);
      if (mode === 'pinch' && pts.size === 2) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        const c = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        this.r.panBy(c[0] - lastPinch.c[0], c[1] - lastPinch.c[1]);
        this.r.setZoom(this.r.z * (d / lastPinch.d), c[0], c[1]);
        lastPinch = { d, c };
        return;
      }
      if (Math.hypot(p[0] - start[0], p[1] - start[1]) > 6) moved = true;
      if (mode === 'pan') this.r.panBy(p[0] - prev[0], p[1] - prev[1]);
      else if (mode === 'tool' && dragTools.has(this.tool)) this.updatePlan(startTile, this.r.tileAt(p[0], p[1]));
    });
    const end = (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId);
      if (mode === 'pinch') {
        if (pts.size === 0) mode = null;
        return;
      }
      if (pts.size) return;
      const p = pos(e);
      const hitInc = !moved && (this.tool === 'query' || this.tool === 'pan') ? this.r.incidentAt(p[0], p[1]) : null;
      if (hitInc != null) this.sendCrew(hitInc);
      else if (mode === 'pan' && !moved && this.tool === 'query') this.query(this.r.tileAt(p[0], p[1]));
      else if (mode === 'tool') {
        const endT = dragTools.has(this.tool) ? this.r.tileAt(p[0], p[1]) : startTile;
        this.updatePlan(startTile, endT);
        this.commit();
      }
      mode = null;
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', (e) => { pts.delete(e.pointerId); mode = null; if (this.r) this.r.preview = null; });
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (!this.r) return;
      const p = pos(e);
      if (e.ctrlKey || Math.abs(e.deltaY) >= Math.abs(e.deltaX)) this.r.setZoom(this.r.z * Math.pow(1.0018, -e.deltaY * (e.ctrlKey ? 4 : 1)), p[0], p[1]);
      else this.r.panBy(-e.deltaX, 0);
    }, { passive: false });
    window.addEventListener('keydown', (e) => {
      if (!this.r || e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
      const k = e.key;
      const t = TOOLS.find((x) => x.key && x.key === k.toLowerCase());
      if (t) return this.setTool(t.id);
      if (k === ',') this.r.rotate(-1);
      else if (k === '.') this.r.rotate(1);
      else if (k === '+' || k === '=') this.r.setZoom(this.r.z * 1.4);
      else if (k === '-' || k === '_') this.r.setZoom(this.r.z / 1.4);
      else if (k === ' ') { e.preventDefault(); this.setSpeed(this.g.speed ? 0 : 1); }
      else if (k === 'ArrowLeft') this.r.panBy(120, 0);
      else if (k === 'ArrowRight') this.r.panBy(-120, 0);
      else if (k === 'ArrowUp') this.r.panBy(0, 120);
      else if (k === 'ArrowDown') this.r.panBy(0, -120);
      else if (k === 'Escape') { this.r.preview = null; this.setTool('query'); }
    });
    window.addEventListener('resize', () => this.r && this.r.resize());
  }
  updatePlan(a, b) {
    if (this.tool === 'develop') {
      if (a < 0) return;
      const ids = siteFromRect(this.sim, a, b < 0 ? a : b);
      const tiles = ids.flatMap((li) => this.w.lots[li].tiles);
      this.plan = { tool: 'develop', ids, tiles, ok: ids.length > 0, cost: 0, msg: ids.length ? `${ids.length} parcel${ids.length > 1 ? 's' : ''} selected` : 'Drag over private parcels (not parks or civic land)' };
      this.r.preview = { tiles, ok: ids.length > 0, color: 'rgba(255,200,40,0.45)' };
      this.r.needs = true;
      this.updateHint(this.plan.msg);
      return;
    }
    const p = this.sim.plan(this.tool, a, b, { dense: this.dense });
    this.plan = p;
    if (!p) { this.r.preview = null; return; }
    const color = this.tool.startsWith('zone') && p.ok ? { zoneR: 'rgba(95,211,95,0.45)', zoneC: 'rgba(95,159,255,0.45)', zoneI: 'rgba(240,200,64,0.5)' }[this.tool] : null;
    this.r.preview = { tiles: p.tiles, ok: p.ok, color };
    this.r.needs = true;
    this.updateHint(`${p.msg}${p.cost ? ' · ' + fmtMoney(p.cost) : ''}`);
  }
  commit() {
    const p = this.plan;
    this.r.preview = null;
    this.r.needs = true;
    if (!p) return;
    if (!p.ok) {
      this.g.music.sfx('error');
      this.toast(p.msg || "Can't build there");
      return;
    }
    if (!p.tiles.length) return;
    if (p.tool === 'develop') {
      this.projectPlanner(p.ids);
      return;
    }
    this.sim.execute(p, { dense: this.dense });
    this.g.music.sfx(p.tool === 'bulldoze' ? 'bulldoze' : p.tool.startsWith('zone') || p.tool === 'dezone' ? 'zone' : 'build');
    this.r.refreshOverlay();
    this.refreshStatus();
    this.updateHint();
  }
}

function streetLife(v) {
  if (v < -0.15) return 'Dead frontage (auto & parking)';
  if (v < 0.08) return '○○○○○ quiet';
  const n = Math.max(1, Math.min(5, Math.round(v * 5)));
  return '●'.repeat(n) + '○'.repeat(5 - n) + (v > 0.85 ? ' lively' : '');
}

function bar(v, wide = false) {
  const b = el('span', { class: `bar${wide ? ' wide' : ''}` });
  const f = el('i', { style: `width:${Math.round(clamp(v, 0, 1) * 100)}%;background:${v > 0.66 ? (wide ? '#3a3' : '#c33') : v > 0.33 ? '#da3' : wide ? '#c33' : '#3a3'}` });
  b.append(f);
  return b;
}
export { streetOf };
