// SimCity-2000-flavoured interface: menubar, toolbar, status bar, windows, agenda dialogs, input.
import { CFG, ZONE, ZONE_NAME, SERVICES, ROAD_NAME } from './config.js';
import { el, fmtMoney, fmtInt, clamp } from './util.js';
import { FACTIONS, FACTION_LABEL, DEPTS, DEPT_LABEL, streetOf } from './sim.js';

const ICON = {
  query: '<svg viewBox="0 0 24 24"><circle cx="10" cy="10" r="6" fill="none" stroke="#000" stroke-width="2.4"/><path d="M14.5 14.5l6 6" stroke="#000" stroke-width="3"/><text x="10" y="13.5" font-size="9" text-anchor="middle" font-weight="bold">?</text></svg>',
  pan: '<svg viewBox="0 0 24 24"><path d="M8 11V5a1.5 1.5 0 013 0v5V3.5a1.5 1.5 0 013 0V10V5a1.5 1.5 0 013 0v6V8a1.5 1.5 0 013 0v7c0 4-3 7-7 7s-5-1.5-7-4l-3-4.5c-.7-1 .8-2.3 1.8-1.4L8 14z" fill="#f2d3b0" stroke="#000" stroke-width="1.3"/></svg>',
  bulldoze: '<svg viewBox="0 0 24 24"><rect x="7" y="9" width="10" height="7" fill="#f1c232" stroke="#000"/><rect x="10" y="5" width="5" height="5" fill="#f1c232" stroke="#000"/><path d="M2 12h4v6H2z" fill="#888" stroke="#000"/><rect x="6" y="16" width="13" height="4" rx="2" fill="#333"/></svg>',
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
const OVERLAYS = [
  ['none', 'None'], ['zones', 'Zones'], ['landvalue', 'Land value'], ['traffic', 'Traffic'], ['crime', 'Crime'], ['pollution', 'Pollution'], ['police', 'Police coverage'], ['fire', 'Fire coverage'], ['growth', 'New & abandoned'],
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
    const winItems = [['Budget', () => this.budgetWindow()], ['City Council', () => this.councilWindow()], ['Graphs', () => this.graphsWindow()], ['Map', () => this.mapWindow()], ['Newspaper', () => this.newsWindow()]];
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
    for (const t of TOOLS) {
      const b = el('button', { class: 'tool', title: `${t.label}${t.key ? ' (' + t.key + ')' : ''}`, onclick: () => this.setTool(t.id) });
      b.innerHTML = ICON[t.id];
      this.toolBtns[t.id] = b;
      tb.append(b);
    }
    tb.append(el('div', { class: 'tsep' }));
    for (const [id, fn, tip] of [['rotl', () => this.r.rotate(-1), 'Rotate left (,)'], ['rotr', () => this.r.rotate(1), 'Rotate right (.)'], ['zin', () => this.r.setZoom(this.r.z * 1.5), 'Zoom in (+)'], ['zout', () => this.r.setZoom(this.r.z / 1.5), 'Zoom out (−)']]) {
      const b = el('button', { class: 'tool', title: tip, onclick: () => { fn(); this.g.music.sfx('click'); } });
      b.innerHTML = ICON[id];
      tb.append(b);
    }

    const sb = document.getElementById('statusbar');
    sb.innerHTML = '';
    this.sDate = el('span', { class: 'sdate' });
    this.sFunds = el('span', { class: 'sfunds' });
    this.sPop = el('span', { class: 'spop' });
    this.sAppr = el('button', { class: 'sappr', onclick: () => this.councilWindow() });
    this.rci = el('canvas', { class: 'rci', width: 54, height: 40, title: 'Demand: Residential, Commercial, Industrial' });
    this.ticker = el('button', { class: 'ticker', onclick: () => this.newsWindow() });
    sb.append(el('div', { class: 'srow' }, this.sDate, this.sFunds, this.sPop, this.sAppr, this.rci), this.ticker);
    this.hint = document.getElementById('toolhint');
    this.setTool('query');
    this.refreshStatus();
  }
  closeMenus() {
    document.querySelectorAll('.menu.open').forEach((m) => m.classList.remove('open'));
  }

  setTool(id) {
    if (this.tool === id && id.startsWith('zone')) this.dense = !this.dense;
    else if (this.tool !== id && id.startsWith('zone')) this.dense = false;
    this.tool = id;
    for (const [k, b] of Object.entries(this.toolBtns)) b.classList.toggle('on', k === id);
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
    const n = s.newsLog[0];
    if (n) this.ticker.textContent = `📰 ${n.title}`;
  }

  toast(msg) {
    const t = el('div', { class: 'toast' }, msg);
    document.body.append(t);
    setTimeout(() => t.classList.add('out'), 1600);
    setTimeout(() => t.remove(), 2200);
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
      if (!w.inTown[i]) head = `Outside ${w.demo ? 'Demoville' : 'Watertown'} — neighbouring town`;
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
          row('Use', lot.useDesc || ZONE_NAME[lot.zone]),
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
          row('Businesses', lot.biz.length ? lot.biz.map((n, k) => { const kd = lot.bizKind && lot.bizKind[k]; return kd && kd !== 'yes' ? `${n} (${String(kd).replace(/_/g, ' ')})` : n; }).join(' · ') : '')
        );
        if (lot.built > 0 && lot.year >= CFG.START.y) add(row('Note', 'Built during your term'));
      } else head = 'Open land';
      if (w.inTown[i] && w.terrain[i] !== 1) {
        add(
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
      const series = [['Population', (h) => h.pop, '#2a7a2a'], ['Jobs', (h) => h.jobs, '#2a4fa8'], ['Reserves', (h) => h.funds, '#a87a00'], ['Approval', (h) => h.approval, '#a82a6a'], ['Res. land $/m²', (h) => h.lv, '#555']];
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
      body.append(el('div', { class: 'mast' }, `The ${this.w.demo ? 'Demoville' : 'Watertown'} Townie`), el('div', { class: 'dateline' }, `${s.dateStr()} · Price: one civic grievance`));
      if (top) body.append(el('h2', { class: 'headline' }, top.title), top.body ? el('p', {}, top.body) : null);
      const list = el('div', { class: 'stories' });
      for (const n of s.newsLog.slice(0, 18)) {
        if (n === top) continue;
        list.append(el('div', { class: 'story' }, el('small', {}, n.date), el('b', {}, n.title), n.body ? el('p', {}, n.body) : null));
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
        try { ch.run(this.sim, ctx); } catch (e) { console.error(e); }
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
    const dragTools = new Set(['bulldoze', 'road', 'zoneR', 'zoneC', 'zoneI', 'dezone', 'park']);
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
      if (mode === 'pan' && !moved && this.tool === 'query') this.query(this.r.tileAt(p[0], p[1]));
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
    this.sim.execute(p, { dense: this.dense });
    this.g.music.sfx(p.tool === 'bulldoze' ? 'bulldoze' : p.tool.startsWith('zone') || p.tool === 'dezone' ? 'zone' : 'build');
    this.r.refreshOverlay();
    this.refreshStatus();
    this.updateHint();
  }
}

function bar(v, wide = false) {
  const b = el('span', { class: `bar${wide ? ' wide' : ''}` });
  const f = el('i', { style: `width:${Math.round(clamp(v, 0, 1) * 100)}%;background:${v > 0.66 ? (wide ? '#3a3' : '#c33') : v > 0.33 ? '#da3' : wide ? '#c33' : '#3a3'}` });
  b.append(f);
  return b;
}
export { streetOf };
