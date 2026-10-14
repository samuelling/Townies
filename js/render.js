// SimCity-2000-style isometric renderer with chunk caching.
import { CFG, ZONE, COVER, ZONE_COLOR, SERVICES } from './config.js';
import { weatherFoot, WF_AVG } from './weather.js';
import { ROUTES, routeLines } from './transit.js';
import { homeLot, irvingSeason, halloweenSeason, decoratedLots, yardPoint } from './eggs.js';
import { hexRgb, shade, hash2, clamp } from './util.js';
import { INC, DEPTS } from './incidents.js';

const LEVELS = [0.25, 0.5, 1, 2];
const CACHE_PX = 48e6; // chunk cache budget in pixels (~190 MB of canvas)
const CH = CFG.CHUNK;
const HS = CFG.HS;
const GREY = [128, 128, 132];

const C = {
  grass: hexRgb('#5e9134'),
  park: hexRgb('#4f9a35'),
  wood: hexRgb('#3e7428'),
  paved: hexRgb('#8f8d86'),
  cemetery: hexRgb('#6c9648'),
  sport: hexRgb('#6fae43'),
  wetland: hexRgb('#5f8a55'),
  water: hexRgb('#2c64b4'),
  lawn: hexRgb('#6fa13e'),
  plaza: hexRgb('#a7a39a'),
  yard: hexRgb('#a49d8a'),
  civic: hexRgb('#7aa64a'),
  svc: hexRgb('#9b9890'),
  dirt: hexRgb('#9c7b55'),
};
const ZONE_RGB = ZONE_COLOR.map(hexRgb);

export class Renderer {
  constructor(canvas, world, sim) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.world = world;
    this.sim = sim;
    this.rot = 0;
    this.z = 1;
    this.cam = { x: world.start[0], y: world.start[1] };
    this.cache = new Map();
    this.cachePx = 0;
    this.ncx = Math.ceil(world.W / CH);
    this.ncy = Math.ceil(world.H / CH);
    this.ver = new Int32Array(this.ncx * this.ncy);
    this.anchors = Array.from({ length: this.ncx * this.ncy }, () => []);
    this.knownB = 0;
    this.registerBuildings();
    this.indexRoadLines();
    this.overlayMode = 'none';
    this.overlayCanvas = null;
    this.preview = null;
    this.hover = -1;
    this.time = 0;
    this.needs = true;
    this.carsOn = true;
    this.resize();
  }

  // ---------- geometry ----------
  rxy(x, y) {
    const { W, H } = this.world;
    switch (this.rot) {
      case 1: return [H - y, x];
      case 2: return [W - x, H - y];
      case 3: return [y, W - x];
      default: return [x, y];
    }
  }
  unrot(rx, ry) {
    const { W, H } = this.world;
    switch (this.rot) {
      case 1: return [ry, H - rx];
      case 2: return [W - rx, H - ry];
      case 3: return [W - ry, rx];
      default: return [rx, ry];
    }
  }
  scale() {
    return this.z * this.dpr;
  }
  camScreen(s) {
    const [rx, ry] = this.rxy(this.cam.x, this.cam.y);
    return [(rx - ry) * 16 * s, (rx + ry) * 8 * s];
  }
  screenToGrid(cssX, cssY) {
    const s = this.scale();
    const [cx, cy] = this.camScreen(s);
    const X = cssX * this.dpr - this.cw / 2 + cx;
    const Y = cssY * this.dpr - this.ch / 2 + cy;
    const a = X / (16 * s), b = Y / (8 * s);
    return this.unrot((a + b) / 2, (b - a) / 2);
  }
  // grid → CSS pixel position of a point on the ground
  gridToScreen(x, y) {
    const s = this.scale();
    const [cx, cy] = this.camScreen(s);
    const [rx, ry] = this.rxy(x, y);
    return [((rx - ry) * 16 * s - cx + this.cw / 2) / this.dpr, ((rx + ry) * 8 * s - cy + this.ch / 2) / this.dpr];
  }
  // tiles whose centers fall inside a rectangle drawn on the screen (what you dragged, not a diamond)
  tilesInScreenRect(p0, p1) {
    const x0 = Math.min(p0[0], p1[0]), x1 = Math.max(p0[0], p1[0]), y0 = Math.min(p0[1], p1[1]), y1 = Math.max(p0[1], p1[1]);
    const cs = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(([x, y]) => this.screenToGrid(x, y));
    const { W, H } = this.world;
    const gx0 = Math.max(0, Math.floor(Math.min(...cs.map((c) => c[0]))) - 1), gx1 = Math.min(W - 1, Math.ceil(Math.max(...cs.map((c) => c[0]))) + 1);
    const gy0 = Math.max(0, Math.floor(Math.min(...cs.map((c) => c[1]))) - 1), gy1 = Math.min(H - 1, Math.ceil(Math.max(...cs.map((c) => c[1]))) + 1);
    const out = [];
    for (let y = gy0; y <= gy1; y++) for (let x = gx0; x <= gx1; x++) {
      const [sx, sy] = this.gridToScreen(x + 0.5, y + 0.5);
      if (sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1) out.push(y * W + x);
    }
    return out;
  }
  // what's drawn under the pointer: a tall building in front wins over the ground behind it
  pickTile(cssX, cssY) {
    const g = this.screenToGrid(cssX, cssY);
    const { W, H, bAt, bldgs } = this.world;
    const s = this.scale();
    const [rx, ry] = this.rxy(g[0], g[1]);
    for (let k = 7; k >= 1; k -= 0.5) {
      const [x, y] = this.unrot(rx + k, ry + k);
      const ix = Math.floor(x), iy = Math.floor(y);
      if (ix < 0 || iy < 0 || ix >= W || iy >= H) continue;
      const bi = bAt[iy * W + ix];
      if (bi < 0) continue;
      const b = bldgs[bi];
      if (!b || !b.alive) continue;
      const hpx = (b.h || b.levels * 3.2) * HS * s;
      if (hpx >= k * 16 * s) return iy * W + ix;
    }
    void cssX;
    return this.tileAt(cssX, cssY);
  }
  tileAt(cssX, cssY) {
    const [x, y] = this.screenToGrid(cssX, cssY);
    const ix = Math.floor(x), iy = Math.floor(y);
    if (ix < 0 || iy < 0 || ix >= this.world.W || iy >= this.world.H) return -1;
    return iy * this.world.W + ix;
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.cw = Math.max(1, Math.round(r.width * this.dpr));
    this.ch = Math.max(1, Math.round(r.height * this.dpr));
    this.canvas.width = this.cw;
    this.canvas.height = this.ch;
    this.needs = true;
  }
  setZoom(z, cssX, cssY) {
    z = clamp(z, 0.18, 2.6);
    if (cssX != null) {
      const before = this.screenToGrid(cssX, cssY);
      this.z = z;
      const after = this.screenToGrid(cssX, cssY);
      this.cam.x += before[0] - after[0];
      this.cam.y += before[1] - after[1];
    } else this.z = z;
    this.clampCam();
    this.needs = true;
  }
  panBy(dxCss, dyCss) {
    const s = this.scale();
    const X = -dxCss * this.dpr, Y = -dyCss * this.dpr;
    const a = X / (16 * s), b = Y / (8 * s);
    const drx = (a + b) / 2, dry = (b - a) / 2;
    const [ux, uy] = this.unrot(drx, dry);
    const [ox, oy] = this.unrot(0, 0);
    this.cam.x += ux - ox;
    this.cam.y += uy - oy;
    this.clampCam();
    this.needs = true;
  }
  clampCam() {
    this.cam.x = clamp(this.cam.x, 0, this.world.W);
    this.cam.y = clamp(this.cam.y, 0, this.world.H);
  }
  centerOn(x, y) {
    this.cam.x = x;
    this.cam.y = y;
    this.clampCam();
    this.needs = true;
  }
  rotate(d) {
    this.rot = (this.rot + d + 4) % 4;
    this.cache.clear();
    this.cachePx = 0;
    this.needs = true;
  }

  // ---------- invalidation ----------
  registerBuildings() {
    const { bldgs, W, H } = this.world;
    for (let k = this.knownB; k < bldgs.length; k++) {
      const b = bldgs[k];
      const cx = clamp(Math.floor(b.cx / CH), 0, this.ncx - 1);
      const cy = clamp(Math.floor(b.cy / CH), 0, this.ncy - 1);
      if (b.cx < -2 || b.cy < -2 || b.cx > W + 2 || b.cy > H + 2) continue;
      this.anchors[cy * this.ncx + cx].push(b.id);
      this.ver[cy * this.ncx + cx]++;
    }
    this.knownB = bldgs.length;
  }
  indexRoadLines() {
    const lines = this.world.roadLines;
    this.lineIdx = null;
    if (!lines || !lines.length) return;
    const idx = Array.from({ length: this.ncx * this.ncy }, () => []);
    lines.forEach((ln, li) => {
      const p = ln.pts;
      const seen = new Set();
      for (let k = 0; k + 3 < p.length; k += 2) {
        const x0 = Math.min(p[k], p[k + 2]) - 1.2, x1 = Math.max(p[k], p[k + 2]) + 1.2;
        const y0 = Math.min(p[k + 1], p[k + 3]) - 1.2, y1 = Math.max(p[k + 1], p[k + 3]) + 1.2;
        for (let cy = Math.max(0, Math.floor(y0 / CH)); cy <= Math.min(this.ncy - 1, Math.floor(y1 / CH)); cy++)
          for (let cx = Math.max(0, Math.floor(x0 / CH)); cx <= Math.min(this.ncx - 1, Math.floor(x1 / CH)); cx++) {
            const c = cy * this.ncx + cx;
            if (!seen.has(c)) {
              seen.add(c);
              idx[c].push(li);
            }
          }
      }
    });
    this.lineIdx = idx;
  }
  invalidateTiles(list) {
    const { W } = this.world;
    const seen = new Set();
    for (const i of list) {
      const x = i % W, y = (i / W) | 0;
      for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const cx = Math.floor((x + dx) / CH), cy = Math.floor((y + dy) / CH);
        if (cx < 0 || cy < 0 || cx >= this.ncx || cy >= this.ncy) continue;
        const k = cy * this.ncx + cx;
        if (!seen.has(k)) {
          seen.add(k);
          this.ver[k]++;
        }
      }
    }
    this.needs = true;
  }
  invalidateBuilding(b) {
    const cx = clamp(Math.floor(b.cx / CH), 0, this.ncx - 1);
    const cy = clamp(Math.floor(b.cy / CH), 0, this.ncy - 1);
    this.ver[cy * this.ncx + cx]++;
    this.needs = true;
  }
  techA(id) {
    return this.sim && this.sim.tech ? this.sim.tech.a[id] || 0 : 0;
  }
  // inset copy of a screen polygon toward its centroid
  inset(pts, k) {
    let cx = 0, cy = 0;
    for (const p of pts) { cx += p[0]; cy += p[1]; }
    cx /= pts.length; cy /= pts.length;
    return pts.map((p) => [cx + (p[0] - cx) * k, cy + (p[1] - cy) * k]);
  }
  solarPanel(g, poly, L) {
    this.fillPoly(g, poly, '#2b4170', L >= 1 ? 'rgba(200,215,240,0.6)' : null);
    if (L >= 2) {
      g.strokeStyle = 'rgba(180,200,235,0.45)';
      g.lineWidth = 0.6;
      g.beginPath();
      for (const t of [0.25, 0.5, 0.75]) {
        const a = [poly[0][0] + (poly[1][0] - poly[0][0]) * t, poly[0][1] + (poly[1][1] - poly[0][1]) * t];
        const b = [poly[3][0] + (poly[2][0] - poly[3][0]) * t, poly[3][1] + (poly[2][1] - poly[3][1]) * t];
        g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]);
      }
      g.stroke();
    }
  }
  invalidateAll() {
    for (let i = 0; i < this.ver.length; i++) this.ver[i]++;
    this.needs = true;
  }

  // ---------- chunk cache ----------
  getChunk(cx, cy, L, layer, allowRender) {
    const ci = cy * this.ncx + cx;
    const key = `${layer}${L}:${ci}`;
    let e = this.cache.get(key);
    if (e && e.ver === this.ver[ci]) {
      this.cache.delete(key);
      this.cache.set(key, e);
      return e;
    }
    if (!allowRender) return e || null; // stale is better than nothing
    if (e && e.c) this.cachePx -= e.c.width * e.c.height;
    e = layer === 'g' ? this.renderGround(cx, cy, L) : this.renderObjects(cx, cy, L);
    e.ver = this.ver[ci];
    this.cache.set(key, e);
    this.cachePx += e.c ? e.c.width * e.c.height : 0;
    while (this.cachePx > CACHE_PX && this.cache.size > 8) {
      const [k0, v0] = this.cache.entries().next().value;
      this.cache.delete(k0);
      this.cachePx -= v0.c ? v0.c.width * v0.c.height : 0;
    }
    return e;
  }
  chunkCorners(cx, cy, L) {
    const { W, H } = this.world;
    const x0 = cx * CH, y0 = cy * CH, x1 = Math.min(W, x0 + CH), y1 = Math.min(H, y0 + CH);
    let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity;
    for (const [x, y] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) {
      const [rx, ry] = this.rxy(x, y);
      const sx = (rx - ry) * 16 * L, sy = (rx + ry) * 8 * L;
      mnx = Math.min(mnx, sx); mxx = Math.max(mxx, sx);
      mny = Math.min(mny, sy); mxy = Math.max(mxy, sy);
    }
    return { x0, y0, x1, y1, mnx, mny, mxx, mxy };
  }
  mkCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(w));
    c.height = Math.max(1, Math.ceil(h));
    return c;
  }

  // ---------- ground ----------
  renderGround(cx, cy, L) {
    const w = this.world;
    const { W, H } = w;
    const cc = this.chunkCorners(cx, cy, L);
    const ox = cc.mnx - 2, oy = cc.mny - 2;
    const c = this.mkCanvas(cc.mxx - cc.mnx + 4, cc.mxy - cc.mny + 4);
    const g = c.getContext('2d');
    const P = (x, y) => {
      const [rx, ry] = this.rxy(x, y);
      return [(rx - ry) * 16 * L - ox, (rx + ry) * 8 * L - oy];
    };
    const poly = (pts, fill) => {
      g.beginPath();
      for (let k = 0; k < pts.length; k++) {
        const [px, py] = P(pts[k][0], pts[k][1]);
        if (k) g.lineTo(px, py);
        else g.moveTo(px, py);
      }
      g.closePath();
      g.fillStyle = fill;
      g.fill();
    };
    const diamond = (x, y, fill, seam) => {
      const a = P(x, y), b = P(x + 1, y), d = P(x + 1, y + 1), e = P(x, y + 1);
      g.beginPath();
      g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.lineTo(d[0], d[1]); g.lineTo(e[0], e[1]);
      g.closePath();
      g.fillStyle = fill;
      g.fill();
      if (seam) {
        g.strokeStyle = fill;
        g.lineWidth = 0.9;
        g.stroke();
      }
    };
    const { terrain, road, cover, lotOf, inTown, svcAt, path } = w;
    const osmRoad = this.lineIdx ? w.osmRoad : null, roadCut = w.roadCut;
    const tileRoads = [], cutTiles = [];
    const lots = w.lots;
    const detail = L >= 0.5;
    for (let y = cc.y0; y < cc.y1; y++)
      for (let x = cc.x0; x < cc.x1; x++) {
        const i = y * W + x;
        const v = 0.95 + 0.1 * hash2(x, y, 1);
        let col, kind = 0;
        if (terrain[i] === 1) {
          col = C.water;
          kind = 1;
        } else if (svcAt[i] >= 0) col = C.svc;
        else {
          const cv = cover[i];
          const li = lotOf[i];
          const lot = li >= 0 ? lots[li] : null;
          if (lot && lot.under) { col = C.dirt; kind = 7; }
          else if (cv === COVER.PARK) col = C.park;
          else if (cv === COVER.WOOD) col = C.wood;
          else if (cv === COVER.CEMETERY) { col = C.cemetery; kind = 4; }
          else if (cv === COVER.SPORT) { col = C.sport; kind = 5; }
          else if (cv === COVER.WETLAND) { col = C.wetland; kind = 6; }
          else if (lot) {
            const developed = lot.bldgs.length > 0;
            if (cv === COVER.PAVED) col = C.paved;
            else if (!developed && (lot.zone === ZONE.R || lot.zone === ZONE.C || lot.zone === ZONE.I)) {
              col = C.grass;
              kind = 10 + lot.zone;
            }
            else if (lot.zone === ZONE.C) col = C.plaza;
            else if (lot.zone === ZONE.I) col = C.yard;
            else if (lot.zone === ZONE.CIVIC) col = C.civic;
            else col = C.lawn;
          } else if (cv === COVER.PAVED) col = C.paved;
          else col = C.grass;
        }
        const fill = shade(col, v);
        diamond(x, y, fill, true);
        if (roadCut && roadCut[i] && osmRoad && osmRoad[i]) cutTiles.push([x, y, fill]);
        if (detail) {
          if (kind === 1) {
            if (hash2(x, y, 4) < 0.35) {
              const a = P(x + 0.3, y + 0.5), b = P(x + 0.65, y + 0.5);
              g.strokeStyle = 'rgba(190,220,255,0.45)';
              g.lineWidth = Math.max(1, L);
              g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
            }
          } else if (kind === 4) {
            g.fillStyle = '#c9c9c4';
            for (let k = 0; k < 3; k++) {
              const p = P(x + 0.2 + 0.6 * hash2(x, y, 20 + k), y + 0.2 + 0.6 * hash2(x, y, 30 + k));
              g.fillRect(p[0] - L, p[1] - 2 * L, 2 * L, 2 * L);
            }
          } else if (kind === 5) {
            const a = P(x, y + 0.5), b = P(x + 1, y + 0.5);
            g.strokeStyle = 'rgba(255,255,255,0.5)';
            g.lineWidth = Math.max(0.7, 0.8 * L);
            g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
          } else if (kind >= 11) {
            // SC2000-style zoned-but-empty land
            const zc = ZONE_RGB[kind - 10];
            const pts = [[x + 0.15, y + 0.15], [x + 0.85, y + 0.15], [x + 0.85, y + 0.85], [x + 0.15, y + 0.85]];
            g.beginPath();
            pts.forEach((q, k) => { const p = P(q[0], q[1]); k ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]); });
            g.closePath();
            g.strokeStyle = shade(zc, 1);
            g.lineWidth = Math.max(1, L * 1.2);
            g.stroke();
            const m = P(x + 0.5, y + 0.5);
            g.fillStyle = shade(zc, 1);
            g.fillRect(m[0] - 1.5 * L, m[1] - 1.5 * L, 3 * L, 3 * L);
          } else if (!road[i] && col !== C.paved && col !== C.plaza && col !== C.yard && col !== C.svc) {
            g.fillStyle = 'rgba(30,60,10,0.28)';
            for (let k = 0; k < 2; k++) {
              const p = P(x + 0.15 + 0.7 * hash2(x, y, 40 + k), y + 0.15 + 0.7 * hash2(x, y, 50 + k));
              g.fillRect(p[0], p[1], Math.max(1, L), Math.max(1, L));
            }
          }
          if (path[i] && !road[i] && terrain[i] !== 1) {
            const p = P(x + 0.5, y + 0.5);
            g.strokeStyle = '#c9b88f';
            g.lineWidth = Math.max(1, 1.6 * L);
            g.beginPath();
            let any = false;
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
              const nx = x + dx, ny = y + dy;
              if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
              const ni = ny * W + nx;
              if (path[ni] || road[ni]) {
                const q = P(x + 0.5 + dx * 0.5, y + 0.5 + dy * 0.5);
                g.moveTo(p[0], p[1]);
                g.lineTo(q[0], q[1]);
                any = true;
              }
            }
            if (any) g.stroke();
          }
        }
        if (road[i] && !(osmRoad && osmRoad[i] && !roadCut[i])) tileRoads.push(i);
      }
    // real streets as smooth lines at their true angles
    if (osmRoad) this.drawRoadLines(g, P, cc, cx, cy, L);
    for (const [x, y, fill] of cutTiles) diamond(x, y, fill, true);
    for (const i of tileRoads) this.drawRoad(g, P, poly, i % W, (i / W) | 0, road[i], terrain[i] === 1, L);
    // construction fences around project sites
    if (L >= 0.5) {
      g.strokeStyle = '#f2c200';
      g.lineWidth = Math.max(1, 1.6 * L);
      g.setLineDash([3 * L, 2 * L]);
      g.beginPath();
      for (let y = cc.y0; y < cc.y1; y++)
        for (let x = cc.x0; x < cc.x1; x++) {
          const i = y * W + x;
          const li = lotOf[i];
          if (li < 0 || !lots[li].under) continue;
          const u = lots[li].under;
          const same = (j) => lotOf[j] >= 0 && lots[lotOf[j]].under === u;
          if (x + 1 < W && !same(i + 1)) { const a = P(x + 1, y), b = P(x + 1, y + 1); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); }
          if (x > 0 && !same(i - 1)) { const a = P(x, y), b = P(x, y + 1); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); }
          if (y + 1 < H && !same(i + W)) { const a = P(x, y + 1), b = P(x + 1, y + 1); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); }
          if (y > 0 && !same(i - W)) { const a = P(x, y), b = P(x + 1, y); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); }
        }
      g.stroke();
      g.setLineDash([]);
    }
    // town line + neighbour shading
    for (let y = cc.y0; y < cc.y1; y++)
      for (let x = cc.x0; x < cc.x1; x++) {
        const i = y * W + x;
        if (!inTown[i]) diamond(x, y, 'rgba(18,20,34,0.34)', false);
      }
    if (L >= 0.25) {
      g.strokeStyle = 'rgba(255,240,170,0.75)';
      g.lineWidth = Math.max(1, 1.5 * L);
      g.setLineDash([4 * L, 3 * L]);
      g.beginPath();
      for (let y = cc.y0; y < cc.y1; y++)
        for (let x = cc.x0; x < cc.x1; x++) {
          const i = y * W + x;
          if (!inTown[i]) continue;
          if (x + 1 < W && !inTown[i + 1]) { const a = P(x + 1, y), b = P(x + 1, y + 1); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); }
          if (x > 0 && !inTown[i - 1]) { const a = P(x, y), b = P(x, y + 1); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); }
          if (y + 1 < H && !inTown[i + W]) { const a = P(x, y + 1), b = P(x + 1, y + 1); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); }
          if (y > 0 && !inTown[i - W]) { const a = P(x, y), b = P(x + 1, y); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); }
        }
      g.stroke();
      g.setLineDash([]);
    }
    return { c, ox, oy, L };
  }

  drawRoadLines(g, P, cc, cx, cy, L) {
    const ids = this.lineIdx[cy * this.ncx + cx];
    if (!ids.length) return;
    const lines = this.world.roadLines;
    const RW = [0, 0.55, 0.75, 0.95];
    g.save();
    const c0 = P(cc.x0, cc.y0), c1 = P(cc.x1, cc.y0), c2 = P(cc.x1, cc.y1), c3 = P(cc.x0, cc.y1);
    g.beginPath();
    g.moveTo(c0[0], c0[1]); g.lineTo(c1[0], c1[1]); g.lineTo(c2[0], c2[1]); g.lineTo(c3[0], c3[1]);
    g.closePath();
    g.clip();
    const o = P(0, 0), ax = P(1, 0), ay = P(0, 1);
    g.setTransform(ax[0] - o[0], ax[1] - o[1], ay[0] - o[0], ay[1] - o[1], o[0], o[1]);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    const trace = (ln) => {
      const p = ln.pts;
      g.beginPath();
      g.moveTo(p[0], p[1]);
      for (let k = 2; k < p.length; k += 2) g.lineTo(p[k], p[k + 1]);
    };
    const byCls = [[], [], [], []];
    for (const li of ids) byCls[lines[li].cls].push(lines[li]);
    for (let c = 1; c <= 3; c++)
      for (const ln of byCls[c]) {
        trace(ln);
        g.strokeStyle = ln.bridge ? '#d9d7cd' : '#b9b7ab';
        g.lineWidth = RW[c] + (ln.bridge ? 0.16 : 0.22);
        g.stroke();
      }
    const bikes = this.sim && this.sim.tech && this.sim.tech.stance.ebike === 'embrace' && this.sim.tech.arrived.ebike != null;
    for (let c = 1; c <= 3; c++)
      for (const ln of byCls[c]) {
        trace(ln);
        if (bikes && c === 2 && !ln.bridge) {
          // protected bike lanes: green strips along both curbs
          g.strokeStyle = '#3f9a5a';
          g.lineWidth = RW[c] + 0.1;
          g.stroke();
          g.strokeStyle = '#4b4d53';
          g.lineWidth = RW[c] - 0.14;
          g.stroke();
          continue;
        }
        g.strokeStyle = c === 3 ? '#3e4045' : '#4b4d53';
        g.lineWidth = RW[c];
        g.stroke();
      }
    if (L >= 1) {
      g.lineCap = 'butt';
      for (let c = 2; c <= 3; c++)
        for (const ln of byCls[c]) {
          trace(ln);
          g.strokeStyle = '#e8c547';
          g.lineWidth = 0.045;
          g.setLineDash(c === 3 ? [] : [0.45, 0.35]);
          g.stroke();
        }
      g.setLineDash([]);
    }
    g.restore();
  }

  drawRoad(g, P, poly, x, y, cls, bridge, L) {
    const { W, H, road } = this.world;
    const i = y * W + x;
    const E = x + 1 < W && road[i + 1], Wn = x > 0 && road[i - 1], S = y + 1 < H && road[i + W], N = y > 0 && road[i - W];
    const w = [0, 0.5, 0.62, 0.74][cls];
    const rects = (hw) => {
      const a = 0.5 - hw, b = 0.5 + hw;
      const r = [[a, a, b, b]];
      if (E) r.push([0.5, a, 1, b]);
      if (Wn) r.push([0, a, 0.5, b]);
      if (S) r.push([a, 0.5, b, 1]);
      if (N) r.push([a, 0, b, 0.5]);
      return r;
    };
    const fillR = (list, col) => {
      for (const [a, b, c2, d] of list) poly([[x + a, y + b], [x + c2, y + b], [x + c2, y + d], [x + a, y + d]], col);
    };
    if (!bridge) fillR(rects(w / 2 + 0.09), '#b9b7ab');
    else fillR(rects(w / 2 + 0.05), '#d4d2c8');
    fillR(rects(w / 2), cls === 3 ? '#3e4045' : '#4b4d53');
    if (L >= 1) {
      const straightEW = (E || Wn) && !N && !S;
      const straightNS = (N || S) && !E && !Wn;
      if ((straightEW || straightNS) && cls >= 2) {
        const a = straightEW ? P(x, y + 0.5) : P(x + 0.5, y);
        const b = straightEW ? P(x + 1, y + 0.5) : P(x + 0.5, y + 1);
        g.strokeStyle = '#e8c547';
        g.lineWidth = Math.max(1, 0.9 * L);
        g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
      } else if (straightEW || straightNS) {
        const a = straightEW ? P(x + 0.2, y + 0.5) : P(x + 0.5, y + 0.2);
        const b = straightEW ? P(x + 0.45, y + 0.5) : P(x + 0.5, y + 0.45);
        g.strokeStyle = 'rgba(255,255,255,0.55)';
        g.lineWidth = Math.max(1, 0.7 * L);
        g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
      }
    }
  }

  // ---------- buildings, trees ----------
  renderObjects(cx, cy, L) {
    const w = this.world;
    const { W, H, bldgs, tree, road, terrain, bAt } = w;
    const cc = this.chunkCorners(cx, cy, L);
    const objs = [];
    for (const id of this.anchors[cy * this.ncx + cx]) {
      const b = bldgs[id];
      if (!b.alive) continue;
      const [rx, ry] = this.rxy(b.cx, b.cy);
      objs.push({ d: rx + ry, b });
    }
    for (let y = cc.y0; y < cc.y1; y++)
      for (let x = cc.x0; x < cc.x1; x++) {
        const i = y * W + x;
        if (!tree[i] || road[i] || terrain[i] === 1 || bAt[i] >= 0 || w.svcAt[i] >= 0) continue;
        const tx = x + 0.25 + 0.5 * hash2(x, y, 61), ty = y + 0.25 + 0.5 * hash2(x, y, 62);
        const [rx, ry] = this.rxy(tx, ty);
        objs.push({ d: rx + ry, t: [tx, ty, i] });
      }
    if (!objs.length) return { c: null };
    objs.sort((a, b) => a.d - b.d);
    // bounds
    let mnx = cc.mnx, mny = cc.mny, mxx = cc.mxx, mxy = cc.mxy;
    for (const o of objs) {
      const pts = o.b ? o.b.pts : [[o.t[0], o.t[1]]];
      const hpx = o.b ? (o.b.h + (o.b.kind === 'church' ? 16 : o.b.kind === 'house' ? 10 : 6)) * HS * L : 12 * HS * L;
      for (const q of pts) {
        const [rx, ry] = this.rxy(q[0], q[1]);
        const sx = (rx - ry) * 16 * L, sy = (rx + ry) * 8 * L;
        if (sx - 8 * L < mnx) mnx = sx - 8 * L;
        if (sx + 8 * L > mxx) mxx = sx + 8 * L;
        if (sy - hpx < mny) mny = sy - hpx;
        if (sy + 4 > mxy) mxy = sy + 4;
      }
    }
    const ox = mnx - 4, oy = mny - 4;
    const c = this.mkCanvas(mxx - mnx + 8, mxy - mny + 8);
    const g = c.getContext('2d');
    const P = (x, y, hm = 0) => {
      const [rx, ry] = this.rxy(x, y);
      return [(rx - ry) * 16 * L - ox, (rx + ry) * 8 * L - oy - hm * HS * L];
    };
    for (const o of objs) {
      if (o.b) this.drawBuilding(g, P, o.b, L);
      else this.drawTree(g, P, o.t, L);
    }
    return { c, ox, oy, L };
  }

  drawTree(g, P, [tx, ty, i], L) {
    const w = this.world;
    const out = !w.inTown[i];
    const r = (3.4 + 1.6 * hash2(i, 3, 3)) * L;
    const base = P(tx, ty, 0);
    const top = P(tx, ty, 5.5);
    if (L < 0.5) {
      g.fillStyle = out ? '#3c5a34' : '#2f6a28';
      g.fillRect(top[0] - r * 0.8, top[1] - r * 0.6, r * 1.6, r * 1.4);
      return;
    }
    g.strokeStyle = '#5a3f26';
    g.lineWidth = Math.max(1, 1.2 * L);
    g.beginPath(); g.moveTo(base[0], base[1]); g.lineTo(top[0], top[1] + r * 0.5); g.stroke();
    const autumn = this.sim && this.sim.month >= 9 && this.sim.month <= 10 && hash2(i, 5, 5) < 0.35;
    g.fillStyle = autumn ? (hash2(i, 6, 6) < 0.5 ? '#b8662a' : '#c9a23a') : out ? '#3d6034' : '#2e6b28';
    g.beginPath(); g.ellipse(top[0], top[1], r, r * 0.95, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = autumn ? 'rgba(255,220,140,0.35)' : 'rgba(140,200,90,0.45)';
    g.beginPath(); g.ellipse(top[0] - r * 0.3, top[1] - r * 0.3, r * 0.5, r * 0.45, 0, 0, Math.PI * 2); g.fill();
  }

  rdir(dx, dy) {
    switch (this.rot) {
      case 1: return [-dy, dx];
      case 2: return [-dx, -dy];
      case 3: return [dy, -dx];
      default: return [dx, dy];
    }
  }

  drawBuilding(g, P, b, L) {
    const w = this.world;
    const lot = b.lot >= 0 ? w.lots[b.lot] : null;
    const ci = Math.floor(b.cy) * w.W + Math.floor(b.cx);
    const outside = !lot && !(w.inTown[ci] === 1);
    const aband = lot && lot.occ < 0.3;
    const mixAmt = aband ? 0.55 : outside ? 0.38 : 0;
    const mix = aband ? [70, 60, 50] : GREY;
    if (!b._rgb) {
      b._rgb = hexRgb(b.col);
      b._roof = hexRgb(b.roofCol);
      b._col2 = b.col2 ? hexRgb(b.col2) : null;
      b._trim = hexRgb(b.trim || '#f4f1ea');
    }
    const st = { mix, mixAmt, aband, stroke: L >= 1 ? 'rgba(0,0,0,0.3)' : null };
    if (b.obb && b.kind === 'house') return this.drawHouse(g, P, b, L, st);
    return this.drawBox(g, P, b, L, st);
  }

  fillPoly(g, pts, col, stroke) {
    g.beginPath();
    pts.forEach((p, k) => (k ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])));
    g.closePath();
    g.fillStyle = col;
    g.fill();
    if (stroke) {
      g.strokeStyle = stroke;
      g.lineWidth = 0.6;
      g.stroke();
    }
  }

  // visible walls of a footprint, sorted far->near, with screen-space shading factor
  visibleWalls(G0) {
    const n = G0.length;
    let sa = 0;
    for (let k = 0; k < n; k++) {
      const a = G0[k], c2 = G0[(k + 1) % n];
      sa += a[0] * c2[1] - c2[0] * a[1];
    }
    const out = [];
    for (let k = 0; k < n; k++) {
      const a = G0[k], c2 = G0[(k + 1) % n];
      const ex = c2[0] - a[0], ey = c2[1] - a[1];
      const nx = sa > 0 ? ey : -ey, ny = sa > 0 ? -ex : ex;
      const len = Math.hypot(nx, ny) || 1;
      out.push({ k, v: ny > 0, d: (a[1] + c2[1]) / 2, f: 0.84 - 0.2 * (nx / len) });
    }
    return out;
  }

  // quad on a wall between fractions t0..t1 along edge a->c and heights z0..z1 (metres)
  wallQuad(g, P, a, c, t0, t1, z0, z1, fill, off = 0, nrm = null) {
    const ox = nrm ? nrm[0] * off : 0, oy = nrm ? nrm[1] * off : 0;
    const x0 = a[0] + (c[0] - a[0]) * t0 + ox, y0 = a[1] + (c[1] - a[1]) * t0 + oy;
    const x1 = a[0] + (c[0] - a[0]) * t1 + ox, y1 = a[1] + (c[1] - a[1]) * t1 + oy;
    const p0 = P(x0, y0, z0), p1 = P(x1, y1, z0), p2 = P(x1, y1, z1), p3 = P(x0, y0, z1);
    g.beginPath();
    g.moveTo(p0[0], p0[1]); g.lineTo(p1[0], p1[1]); g.lineTo(p2[0], p2[1]); g.lineTo(p3[0], p3[1]);
    g.closePath();
    g.fillStyle = fill;
    g.fill();
  }

  // ---------- flat-roofed buildings with facade styles ----------
  drawBox(g, P, b, L, st) {
    const { mix, mixAmt, stroke, aband } = st;
    const pts = b.pts, n = pts.length, h = b.h;
    const wall = b._rgb, roofC = b._roof, c2 = b._col2, trim = b._trim;
    const G0 = pts.map((q) => P(q[0], q[1], 0));
    const T0 = pts.map((q) => P(q[0], q[1], h));
    const walls = this.visibleWalls(G0).filter((x) => x.v).sort((p, q) => p.d - q.d);
    const corniced = b.arch === 'brick' || b.arch === 'garden' || b.arch === 'precast' || b.arch === 'modern';
    for (const wl of walls) {
      const k = wl.k, k2 = (k + 1) % n;
      this.fillPoly(g, [G0[k], G0[k2], T0[k2], T0[k]], shade(wall, wl.f, mix, mixAmt), stroke);
      if (L >= 0.5 && !aband) this.facade(g, P, b, pts[k], pts[k2], L, wl.f, k === b.front, st);
      if (L >= 1 && k === b.front && b.kind !== 'shop') {
        const lt = b.lot >= 0 ? this.world.lots[b.lot] : null;
        if (lt && lt.vacant > 0) {
          this.wallQuad(g, P, pts[k], pts[k2], 0.3, 0.7, 0.5, 2.6, 'rgba(28,28,30,0.9)');
          this.wallQuad(g, P, pts[k], pts[k2], 0.36, 0.64, 1.1, 2.0, '#f4f1e6');
          if (L >= 1.5) this.wallQuad(g, P, pts[k], pts[k2], 0.4, 0.6, 1.4, 1.7, '#c0392b');
        }
      }
      if (corniced && L >= 0.5) this.wallQuad(g, P, pts[k], pts[k2], 0, 1, h - 0.7, h, shade(b.arch === 'modern' ? (c2 || wall) : trim, wl.f * 0.92, mix, mixAmt));
    }
    this.fillPoly(g, T0, shade(roofC, 1.02, mix, mixAmt), stroke);
    const lotB = b.lot >= 0 ? this.world.lots[b.lot] : null;
    const plainRoof = b.arch !== 'lab' && b.arch !== 'church' && b.arch !== 'garage' && !aband && b.area > 0.25;
    if (plainRoof && L >= 0.5) {
      const green = b.era === 'future' || hash2(b.id, 43, 5) < 0.9 * this.techA('green');
      if (green) this.fillPoly(g, this.inset(T0, 0.84), shade([104, 156, 78], 1, mix, mixAmt));
      if (hash2(b.id, 41, 3) < 0.8 * this.techA('solar')) {
        const k = green ? 0.42 : 0.62;
        this.solarPanel(g, this.inset(T0, k), L);
      }
    }
    if (lotB && lotB.evHub && L >= 0.5) {
      const p = P(b.cx, b.cy, h + 3);
      g.fillStyle = 'rgba(30,140,90,0.9)';
      g.beginPath();
      g.arc(p[0], p[1], Math.round(9 * L), 0, Math.PI * 2);
      g.fill();
      g.font = `bold ${Math.round(11 * L)}px sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = '#fff';
      g.fillText('⚡', p[0], p[1]);
      g.textBaseline = 'alphabetic';
    }
    if (L < 0.5) return;
    if (b.arch === 'lab' && b.area > 0.8) {
      // big rooftop mechanical penthouse, the lab-building giveaway
      const s = Math.sqrt(b.area) * 0.42;
      this.box(g, P, b.cx - s / 2, b.cy - s / 2, s, s * 0.8, h, 4.5, [190, 196, 199], mix, mixAmt);
    } else if (b.area > 1.2 && b.arch !== 'church' && b.arch !== 'garage') {
      const s = Math.min(0.45, Math.sqrt(b.area) * 0.11);
      this.box(g, P, b.cx - s / 2, b.cy - s / 2, s, s * 0.7, h, 1.8, [150, 150, 150], mix, mixAmt);
      if (b.area > 4) this.box(g, P, b.cx + s, b.cy + s * 0.4, s * 0.7, s * 0.6, h, 1.4, [165, 165, 160], mix, mixAmt);
    }
    if (b.kind === 'church') {
      const s = 0.22;
      const [tx, ty] = pts.reduce((m, q) => (q[0] + q[1] > m[0] + m[1] ? q : m), pts[0]);
      const sx = b.cx + (tx - b.cx) * 0.55 - s / 2, sy = b.cy + (ty - b.cy) * 0.55 - s / 2;
      this.box(g, P, sx, sy, s, s, h, 7, wall, mix, mixAmt);
      const ap = P(sx + s / 2, sy + s / 2, h + 7 + 9);
      const k1 = P(sx, sy + s, h + 7), k2 = P(sx + s, sy + s, h + 7), k3 = P(sx + s, sy, h + 7);
      this.fillPoly(g, [k1, k2, ap], shade([230, 230, 225], 0.95, mix, mixAmt));
      this.fillPoly(g, [k2, k3, ap], shade([230, 230, 225], 0.75, mix, mixAmt));
    }
    const glyph = b.svcType && SERVICES[b.svcType] ? SERVICES[b.svcType].glyph
      : b.kind === 'police' ? '★' : b.kind === 'fire' ? '✚' : b.kind === 'school' ? '✎' : null;
    if (glyph && L >= 0.5) {
      const big = b.svcType && SERVICES[b.svcType] && SERVICES[b.svcType].effect;
      const p = P(b.cx, b.cy, h + 3);
      g.font = `bold ${Math.round((big ? 12 : 9) * L)}px sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      // plate behind the glyph so emoji/symbols read on any roof colour
      if (big) {
        const rr = Math.round(10 * L);
        g.fillStyle = 'rgba(20,22,26,0.55)';
        g.beginPath();
        g.arc(p[0], p[1], rr, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = '#fff';
      g.fillText(glyph, p[0], p[1]);
      g.textBaseline = 'alphabetic';
    }
  }

  facade(g, P, b, a, c, L, f, front, st) {
    const { mix, mixAmt } = st;
    const floors = Math.max(1, Math.round(b.levels));
    const lenM = Math.hypot(c[0] - a[0], c[1] - a[1]) * CFG.TILE_M;
    const fh = b.h / floors;
    const Q = (t0, t1, z0, z1, col) => this.wallQuad(g, P, a, c, t0, t1, z0, z1, col);
    const glass = `rgba(${Math.round(60 + 30 * f)},${Math.round(90 + 30 * f)},${Math.round(125 + 25 * f)},0.92)`;
    const dark = 'rgba(35,45,70,0.8)';
    const arch = b.arch;
    const shop = b.kind === 'shop' && arch !== 'bigbox';
    if (arch === 'bigbox') {
      if (front) {
        Q(0.42, 0.58, 0, 3.2, glass);
        if (b.sign) Q(0.3, 0.7, b.h - 2.6, b.h - 0.6, shade(hexRgb(b.sign), f, mix, mixAmt));
      }
      return;
    }
    if (arch === 'warehouse') {
      if (front && L >= 1) {
        const nd = Math.max(1, Math.floor(lenM / 9));
        for (let k = 0; k < nd; k++) Q((k + 0.25) / nd, (k + 0.75) / nd, 0, 3.6, shade([90, 92, 96], f, mix, mixAmt));
      }
      if (L >= 1) for (let z = 1.5; z < b.h - 0.5; z += 1.5) Q(0, 1, z, z + 0.12, 'rgba(0,0,0,0.08)');
      Q(0.05, 0.95, b.h - 1.6, b.h - 1.0, dark);
      return;
    }
    if (arch === 'garage') {
      if (front) Q(0.2, 0.8, 0, 2.2, shade([200, 200, 196], f * 0.9, mix, mixAmt));
      return;
    }
    if (arch === 'glass' || arch === 'lab') {
      const sp = b._col2 && arch === 'glass' ? shade(b._col2, f, mix, mixAmt) : null;
      for (let fl = 0; fl < floors; fl++) {
        if (arch === 'lab') Q(0.03, 0.97, fl * fh + fh * 0.3, fl * fh + fh * 0.88, shade(b._col2, f * 1.05, mix, mixAmt));
        else Q(0.02, 0.98, fl * fh + 0.25 * fh, (fl + 1) * fh - 0.08, glass);
        if (sp && L >= 1) Q(0.02, 0.98, (fl + 1) * fh - 0.35, (fl + 1) * fh, sp);
      }
      if (arch === 'lab' && L >= 1) {
        const nf = Math.floor(lenM / 3);
        for (let k = 1; k < nf; k++) Q(k / nf - 0.006, k / nf + 0.006, 0.3 * fh, b.h, 'rgba(255,255,255,0.55)');
      }
      return;
    }
    // punched-window styles: brick, garden, precast, modern, strip, church
    const nWin = Math.max(1, Math.floor(lenM / (arch === 'church' ? 4.5 : 3.4)));
    if (arch === 'modern' && b._col2 && L >= 0.5) {
      const np = Math.max(2, Math.round(lenM / 7));
      for (let k = 0; k < np; k += 2) Q(k / np, (k + 1) / np, shop ? fh : 0.3, b.h - 0.7, shade(b._col2, f, mix, mixAmt));
    }
    if (L < 1) return;
    const framed = L >= 2 && (arch === 'brick' || arch === 'garden');
    const trimCol = shade(b._trim, f, mix, mixAmt);
    for (let fl = 0; fl < floors; fl++) {
      if ((shop || (arch === 'modern' && b.kind !== 'apt')) && fl === 0) {
        const lt = b.lot >= 0 ? this.world.lots[b.lot] : null;
        const vac = lt && lt.vacant > 0;
        const allVac = vac && !(lt.sf && lt.sf.length);
        Q(0.06, 0.94, 0.15 * fh, 0.72 * fh, allVac ? 'rgba(28,28,30,0.9)' : glass);
        if (b.awning && front && !allVac) Q(0.04, 0.96, 0.74 * fh, 0.9 * fh, b.awning);
        if (vac && front) {
          Q(allVac ? 0.3 : 0.62, allVac ? 0.7 : 0.9, 0.36 * fh, 0.6 * fh, '#f4f1e6');
          if (L >= 1.5) Q(allVac ? 0.35 : 0.65, allVac ? 0.65 : 0.87, 0.45 * fh, 0.52 * fh, '#c0392b');
        }
        continue;
      }
      if (nWin * floors > 300) {
        Q(0.04, 0.96, (fl + 0.3) * fh, (fl + 0.75) * fh, dark);
        continue;
      }
      const tall = arch === 'church' || arch === 'modern';
      for (let k = 0; k < nWin; k++) {
        const t0 = (k + (tall ? 0.3 : 0.28)) / nWin, t1 = (k + (tall ? 0.7 : 0.72)) / nWin;
        const z0 = (fl + (tall ? 0.15 : 0.3)) * fh, z1 = (fl + (tall ? 0.85 : 0.75)) * fh;
        if (framed) Q(t0 - 0.03 / nWin, t1 + 0.03 / nWin, z0 - 0.12, z1 + 0.12, trimCol);
        Q(t0, t1, z0, z1, arch === 'modern' ? glass : dark);
      }
    }
    if (front && !shop && b.kind !== 'church') Q(0.46, 0.54, 0, Math.min(2.4, fh * 0.75), 'rgba(40,30,25,0.85)');
  }

  // ---------- pitched-roof houses ----------
  drawHouse(g, P, b, L, st) {
    const { mix, mixAmt, stroke } = st;
    const q = b.obb;
    const h = b.h;
    const wall = b._rgb, roofC = b._roof, trim = b._trim;
    const wF = Math.hypot(q[1][0] - q[0][0], q[1][1] - q[0][1]) || 0.01;
    const dD = Math.hypot(q[3][0] - q[0][0], q[3][1] - q[0][1]) || 0.01;
    const u = [(q[1][0] - q[0][0]) / wF, (q[1][1] - q[0][1]) / wF];
    const v = [(q[3][0] - q[0][0]) / dD, (q[3][1] - q[0][1]) / dD];
    const mid = (a, c) => [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2];
    const H3 = (p, z) => [p[0], p[1], z];
    const type = b.roof || 'gableFB';
    const slope = b.slope || 0.9;
    const qh = q.map((p) => H3(p, h));
    let planes = [], gables = [];
    let ridge = null;
    if (type === 'gableFB') {
      const rh = Math.min(7.5, ((wF * CFG.TILE_M) / 2) * slope);
      const Ra = H3(mid(q[0], q[1]), h + rh), Rb = H3(mid(q[2], q[3]), h + rh);
      planes = [[qh[3], qh[0], Ra, Rb], [Ra, qh[1], qh[2], Rb]];
      gables = [{ e: 0, tri: [qh[0], qh[1], Ra] }, { e: 2, tri: [qh[2], qh[3], Rb] }];
      ridge = [Ra, Rb];
    } else if (type === 'gableS' || type === 'hip') {
      const rh = Math.min(7.5, ((dD * CFG.TILE_M) / 2) * slope);
      let Ra = H3(mid(q[3], q[0]), h + rh), Rb = H3(mid(q[1], q[2]), h + rh);
      if (type === 'hip') {
        const ins = Math.min(dD / 2, wF / 2);
        Ra = [Ra[0] + u[0] * ins, Ra[1] + u[1] * ins, Ra[2]];
        Rb = [Rb[0] - u[0] * ins, Rb[1] - u[1] * ins, Rb[2]];
        planes = [[qh[0], qh[1], Rb, Ra], [qh[2], qh[3], Ra, Rb], [qh[3], qh[0], Ra], [qh[1], qh[2], Rb]];
      } else {
        planes = [[qh[0], qh[1], Rb, Ra], [qh[2], qh[3], Ra, Rb]];
        gables = [{ e: 1, tri: [qh[1], qh[2], Rb] }, { e: 3, tri: [qh[3], qh[0], Ra] }];
      }
      ridge = [Ra, Rb];
    } else planes = [qh];
    const S = (p) => P(p[0], p[1], p[2]);
    const G0 = q.map((p) => P(p[0], p[1], 0));
    const T0 = q.map((p) => P(p[0], p[1], h));
    const vis = this.visibleWalls(G0);
    // walls
    for (const wl of vis.filter((x) => x.v).sort((p, r) => p.d - r.d)) {
      const k = wl.k, k2 = (k + 1) % 4;
      this.fillPoly(g, [G0[k], G0[k2], T0[k2], T0[k]], shade(wall, wl.f, mix, mixAmt), stroke);
      if (L >= 1 && !st.aband) this.houseWindows(g, P, b, q[k], q[k2], L, wl.f, k === 0, st);
      if (type === 'flat' && L >= 0.5) this.wallQuad(g, P, q[k], q[k2], -0.02, 1.02, h - 0.6, h + 0.25, shade(trim, wl.f * 0.95, mix, mixAmt));
    }
    // porches on the street side
    if (b.porch && L >= 1 && vis[0].v && !st.aband) this.porches(g, P, b, q, u, v, L, vis[0].f, st);
    // gable ends
    for (const gb of gables) {
      const wl = vis[gb.e];
      if (!wl.v) continue;
      const tri = gb.tri.map(S);
      this.fillPoly(g, tri, shade(wall, wl.f, mix, mixAmt), stroke);
      if (L >= 1 && !st.aband) {
        // attic window
        const a = q[gb.e], c = q[(gb.e + 1) % 4];
        const rh = gb.tri[2][2] - h;
        if (rh > 2.2) this.wallQuad(g, P, a, c, 0.44, 0.56, h + rh * 0.18, h + rh * 0.5, 'rgba(35,45,70,0.8)');
      }
    }
    // roof planes, far to near, shaded by their normal
    const [lx, ly, lz] = [-0.62, -0.1, 0.78];
    const planesD = planes.map((pl) => {
      let d = 0;
      for (const p of pl) {
        const [rx, ry] = this.rxy(p[0], p[1]);
        d += rx + ry;
      }
      const a = pl[0], b2 = pl[1], c = pl[2];
      const ux = b2[0] - a[0], uy = b2[1] - a[1], uz = (b2[2] - a[2]) / CFG.TILE_M;
      const vx = c[0] - a[0], vy = c[1] - a[1], vz = (c[2] - a[2]) / CFG.TILE_M;
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      if (nz < 0) { nx = -nx; ny = -ny; nz = -nz; }
      const [rnx, rny] = this.rdir(nx, ny);
      const nl = Math.hypot(rnx, rny, nz) || 1;
      const lit = (rnx * lx + rny * ly + nz * lz) / nl;
      return { pl, d: d / pl.length, f: 0.62 + 0.45 * Math.max(0, lit) };
    });
    planesD.sort((p, r) => p.d - r.d);
    for (const { pl, f } of planesD) this.fillPoly(g, pl.map(S), shade(roofC, f, mix, mixAmt), stroke);
    if (L >= 0.5 && !st.aband && hash2(b.id, 41, 3) < this.techA('solar')) {
      // panels on the sunniest roof plane
      let best = null;
      for (const pd of planesD) if (pd.pl.length === 4 && (!best || pd.f > best.f)) best = pd;
      if (best) {
        const poly = this.inset(best.pl.map(S), 0.72);
        this.solarPanel(g, poly, L);
      } else if (type === 'flat') this.solarPanel(g, this.inset(T0, 0.6), L);
    }
    if (ridge && L >= 1) {
      const a = S(ridge[0]), c = S(ridge[1]);
      g.strokeStyle = shade(roofC, 0.55, mix, mixAmt);
      g.lineWidth = Math.max(1, 0.7 * L);
      g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(c[0], c[1]); g.stroke();
      // chimney on older houses
      const lot = b.lot >= 0 ? this.world.lots[b.lot] : null;
      if (lot && lot.year && lot.year < 1945 && hash2(b.id, 2, 2) < 0.6) {
        const t = 0.72;
        const x = ridge[0][0] + (ridge[1][0] - ridge[0][0]) * t, y = ridge[0][1] + (ridge[1][1] - ridge[0][1]) * t;
        this.box(g, P, x - 0.04, y - 0.04, 0.08, 0.08, ridge[0][2] - 1.2, 2.2, [140, 72, 55], mix, mixAmt);
      }
    }
    if (type === 'flat' && L >= 1) {
      // decker roof edge
      g.strokeStyle = shade(trim, 0.8, mix, mixAmt);
      g.lineWidth = 1;
      g.beginPath();
      T0.forEach((p, k) => (k ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])));
      g.closePath();
      g.stroke();
    }
  }

  houseWindows(g, P, b, a, c, L, f, front, st) {
    const floors = Math.max(1, Math.round(b.levels));
    const fh = b.h / Math.max(1, b.levels);
    const lenM = Math.hypot(c[0] - a[0], c[1] - a[1]) * CFG.TILE_M;
    const nWin = Math.max(1, Math.min(6, Math.floor(lenM / 3.2)));
    const dark = 'rgba(38,48,72,0.85)';
    const trim = L >= 2 ? shade(b._trim, f, st.mix, st.mixAmt) : null;
    for (let fl = 0; fl < floors; fl++) {
      for (let k = 0; k < nWin; k++) {
        if (front && fl === 0 && b.porch !== 3 && k === Math.floor(nWin / 2)) continue; // door goes here
        const t0 = (k + 0.32) / nWin, t1 = (k + 0.68) / nWin;
        const z0 = fl * fh + fh * 0.32, z1 = fl * fh + fh * 0.8;
        if (trim) this.wallQuad(g, P, a, c, t0 - 0.03 / nWin, t1 + 0.03 / nWin, z0 - 0.15, z1 + 0.15, trim);
        this.wallQuad(g, P, a, c, t0, t1, z0, z1, dark);
      }
    }
    if (front) {
      const k = Math.floor(nWin / 2);
      this.wallQuad(g, P, a, c, (k + 0.36) / nWin, (k + 0.64) / nWin, 0, 2.2, shade([92, 58, 42], f, st.mix, st.mixAmt));
    }
  }

  porches(g, P, b, q, u, v, L, f, st) {
    const { mix, mixAmt } = st;
    const floors = Math.min(b.porch, Math.max(1, Math.round(b.levels)));
    const fh = b.h / Math.max(1, b.levels);
    const [t0, t1] = b.arch === 'decker' ? [0.05, 0.95] : b.arch === 'twofam' ? [0.06, 0.6] : [0.12, 0.88];
    const wF = Math.hypot(q[1][0] - q[0][0], q[1][1] - q[0][1]);
    const d = 0.13;
    const A = [q[0][0] + u[0] * wF * t0, q[0][1] + u[1] * wF * t0];
    const B = [q[0][0] + u[0] * wF * t1, q[0][1] + u[1] * wF * t1];
    const A2 = [A[0] - v[0] * d, A[1] - v[1] * d], B2 = [B[0] - v[0] * d, B[1] - v[1] * d];
    const trim = shade(b._trim, f, mix, mixAmt);
    const trimTop = shade(b._trim, 1.05, mix, mixAmt);
    const deck = shade([128, 118, 104], f, mix, mixAmt);
    const quad = (p, z) => [P(p[0][0], p[0][1], z), P(p[1][0], p[1][1], z), P(p[2][0], p[2][1], z), P(p[3][0], p[3][1], z)];
    for (let fl = 0; fl < floors; fl++) {
      const z0 = fl * fh + 0.35, z1 = (fl + 1) * fh;
      this.fillPoly(g, quad([A, B, B2, A2], z0), deck);
      g.strokeStyle = trim;
      g.lineWidth = Math.max(1, 0.8 * L);
      g.beginPath();
      for (const p of [A2, B2, [(A2[0] + B2[0]) / 2, (A2[1] + B2[1]) / 2]]) {
        const s0 = P(p[0], p[1], z0), s1 = P(p[0], p[1], z1);
        g.moveTo(s0[0], s0[1]);
        g.lineTo(s1[0], s1[1]);
      }
      g.stroke();
      const r0 = P(A2[0], A2[1], z0), r1 = P(B2[0], B2[1], z0), r2 = P(B2[0], B2[1], z0 + 0.95), r3 = P(A2[0], A2[1], z0 + 0.95);
      this.fillPoly(g, [r0, r1, r2, r3], trim);
      if (fl === floors - 1) this.fillPoly(g, quad([A, B, B2, A2], z1), trimTop);
    }
  }

  box(g, P, x, y, sx, sy, z0, hgt, rgb, mix, mixAmt) {
    const A = P(x, y + sy, z0), B = P(x + sx, y + sy, z0), Cc = P(x + sx, y, z0);
    const A2 = P(x, y + sy, z0 + hgt), B2 = P(x + sx, y + sy, z0 + hgt), C2 = P(x + sx, y, z0 + hgt), D2 = P(x, y, z0 + hgt);
    // pick two visible faces based on rotation: draw all four sides cheaply sorted
    const faces = [
      [P(x, y, z0), P(x + sx, y, z0), C2, D2],
      [Cc, P(x + sx, y, z0), C2, B2],
      [A, B, B2, A2],
      [P(x, y, z0), A, A2, D2],
    ].map((f) => ({ f, d: (f[0][1] + f[1][1]) / 2, nx: f[1][0] - f[0][0] }));
    faces.sort((p, q) => p.d - q.d);
    for (const { f, nx } of faces) {
      g.beginPath();
      f.forEach((p, k) => (k ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])));
      g.closePath();
      g.fillStyle = shade(rgb, nx > 0 ? 0.8 : 0.62, mix, mixAmt);
      g.fill();
    }
    g.beginPath();
    [D2, C2, B2, A2].forEach((p, k) => (k ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])));
    g.closePath();
    g.fillStyle = shade(rgb, 1, mix, mixAmt);
    g.fill();
  }

  // ---------- overlay ----------
  setOverlay(mode) {
    this.overlayMode = mode;
    this.refreshOverlay();
  }
  refreshOverlay() {
    const mode = this.overlayMode;
    if (mode === 'none' || !this.sim) {
      this.overlayCanvas = null;
      this.needs = true;
      return;
    }
    const { W, H } = this.world;
    if (!this.overlayCanvas) this.overlayCanvas = this.mkCanvas(W, H);
    const oc = this.overlayCanvas;
    if (oc.width !== W) { oc.width = W; oc.height = H; }
    const g = oc.getContext('2d');
    const img = g.createImageData(W, H);
    const d = img.data;
    for (let i = 0; i < W * H; i++) {
      const c = this.sim.overlayColor(mode, i);
      if (!c) continue;
      d[i * 4] = c[0]; d[i * 4 + 1] = c[1]; d[i * 4 + 2] = c[2]; d[i * 4 + 3] = c[3];
    }
    g.putImageData(img, 0, 0);
    this.needs = true;
  }

  gridTransform(ctx, s, offX, offY) {
    const p = (x, y) => {
      const [rx, ry] = this.rxy(x, y);
      return [(rx - ry) * 16 * s + offX, (rx + ry) * 8 * s + offY];
    };
    const o = p(0, 0), ax = p(1, 0), ay = p(0, 1);
    ctx.setTransform(ax[0] - o[0], ax[1] - o[1], ay[0] - o[0], ay[1] - o[1], o[0], o[1]);
  }

  // While nothing else is happening, quietly render every chunk at the lowest detail so that zooming
  // all the way out shows the whole town immediately instead of filling it in square by square.
  idle() {
    if (this.prewarmDone) return;
    const t0 = performance.now();
    this.prewarmK = this.prewarmK || 0;
    const n = this.ncx * this.ncy;
    while (this.prewarmK < n * 2 && performance.now() - t0 < 6) {
      const k = this.prewarmK++;
      const ci = k % n, layer = k < n ? 'g' : 'o';
      this.getChunk(ci % this.ncx, Math.floor(ci / this.ncx), LEVELS[0], layer, true);
    }
    if (this.prewarmK >= n * 2) this.prewarmDone = true;
  }

  // ---------- frame ----------
  draw(dt) {
    this.time += dt;
    this.registerBuildings();
    const ctx = this.ctx;
    const s = this.scale();
    let L = LEVELS[LEVELS.length - 1];
    for (const lv of LEVELS) if (lv >= s * 0.92) { L = lv; break; }
    const [csx, csy] = this.camScreen(s);
    const offX = this.cw / 2 - csx, offY = this.ch / 2 - csy;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0b0f17';
    ctx.fillRect(0, 0, this.cw, this.ch);

    // visible chunks
    const vis = [];
    const margin = 160 * s;
    for (let cy = 0; cy < this.ncy; cy++)
      for (let cx = 0; cx < this.ncx; cx++) {
        const cc = this.chunkCorners(cx, cy, s);
        if (cc.mxx + offX < -40 || cc.mnx + offX > this.cw + 40 || cc.mxy + offY < -40 || cc.mny + offY - margin > this.ch) continue;
        const [rx, ry] = this.rxy((cx + 0.5) * CH, (cy + 0.5) * CH);
        vis.push({ cx, cy, d: rx + ry });
      }
    vis.sort((a, b) => a.d - b.d);
    // Pick a detail level whose visible chunks all fit in the cache at once. Otherwise, zoomed out on a
    // high-DPI screen, chunks evict each other forever and squares keep re-rendering across the map.
    const PX_PER_CHUNK = 2.6 * (32 * CH) * (16 * CH); // ground + buildings at L = 1, in pixels
    const fits = (lv) => vis.length * PX_PER_CHUNK * lv * lv < CACHE_PX * (lv === this.lastL ? 0.7 : 0.6);
    while (L > LEVELS[0] && !fits(L)) L = LEVELS[LEVELS.indexOf(L) - 1];
    this.lastL = L;
    const k = s / L;
    ctx.imageSmoothingEnabled = k < 0.999;
    const deadline = performance.now() + 12;
    let budget = 2; // always make some progress, then render until the frame's time is used up
    let incomplete = false;
    const blit = (e) => {
      if (!e || !e.c) return;
      const kk = s / e.L;
      ctx.drawImage(e.c, e.ox * kk + offX, e.oy * kk + offY, e.c.width * kk, e.c.height * kk);
    };
    const fetch = (v, layer) => {
      const fresh = this.getChunk(v.cx, v.cy, L, layer, false);
      const ci = v.cy * this.ncx + v.cx;
      if (fresh && fresh.ver === this.ver[ci]) return fresh;
      let any = fresh;
      if (!any) for (const lv of LEVELS) { const e = this.cache.get(`${layer}${lv}:${ci}`); if (e) { any = e; break; } }
      if (budget > 0 || performance.now() < deadline) {
        budget--;
        // nothing to show yet: a quick low-detail pass first, so the map never has holes; refine next frames
        if (!any && L > LEVELS[0]) {
          incomplete = true;
          return this.getChunk(v.cx, v.cy, LEVELS[0], layer, true);
        }
        return this.getChunk(v.cx, v.cy, L, layer, true);
      }
      incomplete = true;
      return any || null;
    };
    for (const v of vis) blit(fetch(v, 'g'));

    if (this.overlayCanvas) {
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.globalAlpha = 0.55;
      this.gridTransform(ctx, s, offX, offY);
      ctx.drawImage(this.overlayCanvas, 0, 0);
      ctx.restore();
    }
    let carsDrawn = false;
    if (this.carsOn && s >= 0.9 && this.sim) {
      carsDrawn = this.drawCars(ctx, s, offX, offY);
      if (this.lineIdx) carsDrawn = this.drawLineCars(ctx, s, offX, offY, vis) || carsDrawn;
      carsDrawn = this.drawBuses(ctx, s, offX, offY) || carsDrawn;
      if (this.lineIdx) carsDrawn = this.drawPeople(ctx, s, offX, offY, vis) || carsDrawn;
    }
    const spooky = this.drawHalloween(ctx, s, offX, offY, 'ground');
    for (const v of vis) blit(fetch(v, 'o'));
    if (spooky) this.drawHalloween(ctx, s, offX, offY, 'glow');
    // snow on the ground: a light white wash while the snowpack lasts
    if (this.sim && this.sim.wxc && this.sim.wxc.month && this.sim.wxc.month.pack >= 1) {
      ctx.fillStyle = `rgba(245,248,255,${Math.min(0.16, 0.05 + this.sim.wxc.month.pack * 0.01)})`;
      ctx.fillRect(0, 0, this.cw, this.ch);
    }
    const skyAnim = this.drawSky(ctx, s, offX, offY) || this.drawMoments(ctx, s, offX, offY);
    const incAnim = this.drawIncidents(ctx, s, offX, offY) || skyAnim;
    this.drawPreview(ctx, s, offX, offY);
    this.needs = incomplete || carsDrawn || (incAnim && !this.sim.paused) || !!(this.moments && this.moments.length);
    if (!incomplete && !this.prewarmDone && performance.now() < deadline - 6) this.idle();
  }

  // People on the sidewalks, as many as the street life there supports (the same field that drives vibrancy):
  // a lively block of shops fills up, a strip of car lots stays empty however many cars go by. Cyclists ride
  // where e-bikes have caught on. Fewer in bad weather.
  drawPeople(ctx, s, offX, offY, vis) {
    const w = this.world, sim = this.sim;
    if (s < 1.2 || !sim.vibSat) return false;
    const [vx0, vy0, vx1, vy1] = this.visibleRect();
    if ((vx1 - vx0) * (vy1 - vy0) > 14000) return false;
    const t = sim.paused ? this.frozenT2 || this.time : this.time;
    const P = (x, y, hm = 0) => { const [rx, ry] = this.rxy(x, y); return [(rx - ry) * 16 * s + offX, (rx + ry) * 8 * s + offY - hm * HS * s]; };
    const wf = sim.wxc && sim.wxc.month ? clamp(weatherFoot(sim) / WF_AVG, 0.75, 1.15) : 1;
    const bikes = Math.min(0.5, 0.06 + 0.5 * this.techA('ebike') + (sim.flags && sim.flags.bikeLane ? 0.1 : 0));
    const shirts = ['#c0392b', '#2b5fb8', '#f1c40f', '#27ae60', '#8e44ad', '#ecf0f1', '#e67e22', '#34495e'];
    const RW = [0, 0.55, 0.75, 0.95];
    const step = 0.55;
    const seen = new Set();
    let drew = false;
    for (const v of vis)
      for (const li of this.lineIdx[v.cy * this.ncx + v.cx]) {
        if (seen.has(li)) continue;
        seen.add(li);
        const ln = w.roadLines[li];
        if (ln.cls > 2 && !/Street|Avenue|Road/.test(ln.name || '')) continue; // highways: nobody walks the Pike
        const p = ln.pts;
        let acc = 0;
        for (let k = 0; k + 3 < p.length; k += 2) {
          const ax = p[k], ay = p[k + 1], bx = p[k + 2], by = p[k + 3];
          const len = Math.hypot(bx - ax, by - ay);
          if (len < 1e-4) continue;
          const mx = (ax + bx) / 2, my = (ay + by) / 2;
          if (mx < vx0 - 2 || mx > vx1 + 2 || my < vy0 - 2 || my > vy1 + 2) { acc += len; continue; }
          const life = Math.max(0, sim.vibSat[sim.cellOf(mx, my)] || 0);
          const dens = clamp((0.012 + 0.7 * life * life) * wf, 0, 0.7);
          const ux = (bx - ax) / len, uy = (by - ay) / len, nx = -uy, ny = ux;
          for (const side of [1, -1]) {
            const off = (RW[ln.cls] * 0.5 + 0.12) * side;
            const j0 = Math.ceil(acc / step), j1 = Math.floor((acc + len) / step);
            for (let j = j0; j <= j1; j++) {
              const h = hash2(li * 13 + j, side + 3, 7);
              if (h > dens) continue;
              const dir = hash2(li, j, side) < 0.5 ? 1 : -1;
              const bike = hash2(li, j, side + 9) < bikes;
              const sp = bike ? 0.0009 : 0.00018;
              // each walker paces back and forth around their own spot on the block
              const u = j * step - acc + Math.sin(t * sp * 6 + j) * step * 0.45 * dir;
              if (u < 0 || u > len) continue;
              const o = bike ? (RW[ln.cls] * 0.5 - 0.02) * side : off;
              const x = ax + ux * u + nx * o, y = ay + uy * u + ny * o;
              // walkers stay off the roadway (wide and divided roads have their other half there)
              if (!bike) { const ti = Math.floor(y) * w.W + Math.floor(x); if (x < 0 || y < 0 || x >= w.W || y >= w.H || w.road[ti]) continue; }
              const g = P(x, y, 0);
              const col = shirts[Math.floor(hash2(li, j, side + 5) * shirts.length)];
              if (bike) {
                ctx.strokeStyle = '#222'; ctx.lineWidth = Math.max(0.8, 0.35 * s);
                const q = P(x + ux * 0.07, y + uy * 0.07, 0), r2 = P(x - ux * 0.07, y - uy * 0.07, 0);
                ctx.beginPath(); ctx.arc(q[0], q[1], 0.9 * s, 0, Math.PI * 2); ctx.arc(r2[0], r2[1], 0.9 * s, 0, Math.PI * 2); ctx.stroke();
                ctx.fillStyle = col; ctx.fillRect(g[0] - 0.6 * s, g[1] - 3.2 * s, 1.2 * s, 2 * s);
                ctx.fillStyle = '#e8c39e'; ctx.beginPath(); ctx.arc(g[0], g[1] - 3.8 * s, 0.6 * s, 0, Math.PI * 2); ctx.fill();
              } else {
                ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.fillRect(g[0] - 0.7 * s, g[1] - 0.2 * s, 1.4 * s, 0.5 * s);
                ctx.fillStyle = '#333'; ctx.fillRect(g[0] - 0.5 * s, g[1] - 1.6 * s, 1 * s, 1.6 * s);
                ctx.fillStyle = col; ctx.fillRect(g[0] - 0.6 * s, g[1] - 3.2 * s, 1.2 * s, 1.7 * s);
                ctx.fillStyle = ['#e8c39e', '#c68e63', '#8d5a3b', '#f1d2b6'][Math.floor(h * 97) % 4];
                ctx.beginPath(); ctx.arc(g[0], g[1] - 3.8 * s, 0.6 * s, 0, Math.PI * 2); ctx.fill();
              }
              drew = true;
            }
          }
          acc += len;
        }
      }
    return drew;
  }

  // MBTA buses on their real routes; more of them when service is better (js/transit.js)
  drawBuses(ctx, s, offX, offY) {
    const w = this.world, sim = this.sim;
    if (!sim.transit || !w.roadLines) return false;
    const [vx0, vy0, vx1, vy1] = this.visibleRect();
    if ((vx1 - vx0) * (vy1 - vy0) > 40000) return false;
    const t = sim.paused ? this.frozenT2 || this.time : this.time;
    const P = (x, y, hm = 0) => { const [rx, ry] = this.rxy(x, y); return [(rx - ry) * 16 * s + offX, (rx + ry) * 8 * s + offY - hm * HS * s]; };
    let drew = false;
    for (const r of ROUTES) {
      const head = 28 / ((sim.transit.freq[r.id] || 1) * (sim.transit.lanes[r.id] ? 1.15 : 1)); // tiles between buses
      for (const li of routeLines(w, r)) {
        const p = w.roadLines[li].pts;
        let acc = 0;
        for (let k = 0; k + 3 < p.length; k += 2) {
          const ax = p[k], ay = p[k + 1], bx = p[k + 2], by = p[k + 3];
          const len = Math.hypot(bx - ax, by - ay);
          if (len < 1e-4) continue;
          const mx = (ax + bx) / 2, my = (ay + by) / 2;
          if (mx < vx0 - 3 || mx > vx1 + 3 || my < vy0 - 3 || my > vy1 + 3) { acc += len; continue; }
          const ux = (bx - ax) / len, uy = (by - ay) / len, nx = -uy, ny = ux;
          for (const dir of [1, -1]) {
            const phase = ((((t * 0.0008 * dir) + li * 3.7) % head) + head) % head;
            const j0 = Math.ceil((acc - phase) / head), j1 = Math.floor((acc + len - phase) / head);
            for (let j = j0; j <= j1; j++) {
              const u = j * head + phase - acc;
              const off = 0.2 * dir;
              const cx = ax + ux * u + nx * off, cy = ay + uy * u + ny * off;
              const fx = ux * 0.32, fy = uy * 0.32, sx = nx * 0.1, sy = ny * 0.1;
              const q = [[cx - fx - sx, cy - fy - sy], [cx + fx - sx, cy + fy - sy], [cx + fx + sx, cy + fy + sy], [cx - fx + sx, cy - fy + sy]];
              const poly = (h, col) => { ctx.fillStyle = col; ctx.beginPath(); q.forEach((c, n) => { const pp = P(c[0], c[1], h); n ? ctx.lineTo(pp[0], pp[1]) : ctx.moveTo(pp[0], pp[1]); }); ctx.closePath(); ctx.fill(); };
              poly(0, 'rgba(0,0,0,0.35)');
              poly(2.6, '#e9ebe8');
              // the yellow MBTA stripe along the side facing the viewer
              const a = P(q[0][0], q[0][1], 1.6), b2 = P(q[1][0], q[1][1], 1.6);
              ctx.strokeStyle = '#f2c200'; ctx.lineWidth = Math.max(1, 1.1 * s);
              ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b2[0], b2[1]); ctx.stroke();
              drew = true;
            }
          }
          acc += len;
        }
      }
    }
    return drew;
  }

  // ---- moments: ribbon cuttings, lab openings, plazas, the first big snow ----
  addMoment(kind, x, y, label) {
    this.moments = (this.moments || []).filter((m) => this.time - m.t0 < m.life);
    this.moments.push({ kind, x, y, label: label || '', t0: this.time, life: kind === 'snow' ? 7000 : 4500 });
    this.needs = true;
  }
  drawMoments(ctx, s, offX, offY) {
    if (!this.moments || !this.moments.length) return false;
    const now = this.time;
    this.moments = this.moments.filter((m) => now - m.t0 < m.life);
    if (!this.moments.length) return false;
    const P = (x, y, hm = 0) => { const [rx, ry] = this.rxy(x, y); return [(rx - ry) * 16 * s + offX, (rx + ry) * 8 * s + offY - hm * HS * s]; };
    const W = this.cw / this.dpr, H = this.ch / this.dpr;
    for (const m of this.moments) {
      const u = (now - m.t0) / m.life; // 0 → 1
      const fade = u < 0.1 ? u / 0.1 : u > 0.75 ? (1 - u) / 0.25 : 1;
      if (m.kind === 'snow') {
        // flakes drifting down over the whole view
        ctx.save();
        ctx.globalAlpha = 0.85 * fade;
        ctx.fillStyle = '#fff';
        for (let k = 0; k < 160; k++) {
          const x = (hash2(k, 3, 1) * W + Math.sin((now / 900) + k) * 12) % W;
          const y = ((hash2(k, 3, 2) * H + (now - m.t0) * (0.03 + 0.04 * hash2(k, 3, 3))) % H);
          const r = 1 + 2 * hash2(k, 3, 4);
          ctx.beginPath(); ctx.arc(x * this.dpr, y * this.dpr, r * this.dpr, 0, Math.PI * 2); ctx.fill();
        }
        ctx.globalAlpha = 0.18 * fade;
        ctx.fillRect(0, 0, this.cw, this.ch);
        ctx.restore();
        continue;
      }
      if (m.x == null) continue;
      const base = P(m.x, m.y, 6);
      ctx.save();
      ctx.globalAlpha = fade;
      // confetti (or, for labs, rising bubbles)
      const n = m.kind === 'lab' ? 26 : 60;
      for (let k = 0; k < n; k++) {
        const ang = hash2(k, 9, 1) * Math.PI * 2, sp = 0.6 + hash2(k, 9, 2);
        const tt = (now - m.t0) / 1000;
        let x, y;
        if (m.kind === 'lab') { x = base[0] + Math.cos(ang) * 14 * s * sp; y = base[1] - tt * 22 * s * sp; ctx.strokeStyle = '#4aa3df'; ctx.lineWidth = Math.max(1, s); ctx.beginPath(); ctx.arc(x, y, 2 * s * sp, 0, Math.PI * 2); ctx.stroke(); continue; }
        x = base[0] + Math.cos(ang) * tt * 40 * s * sp;
        y = base[1] - Math.sin(ang) * tt * 30 * s * sp + tt * tt * 26 * s;
        ctx.fillStyle = ['#e74c3c', '#f1c40f', '#2ecc71', '#3498db', '#9b59b6', '#ffffff'][k % 6];
        ctx.fillRect(x, y, 4 * s, 2.2 * s);
      }
      // a banner that floats up
      const label = (m.kind === 'lab' ? '🧪 ' : m.kind === 'plaza' ? '🌳 ' : '✂️ ') + (m.label || 'Ribbon cutting');
      ctx.font = `bold ${Math.round(12 * this.dpr)}px sans-serif`;
      const tw = ctx.measureText(label).width + 12 * this.dpr;
      const by = base[1] - 18 * s - u * 24 * this.dpr;
      ctx.fillStyle = 'rgba(255,253,240,0.95)'; ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5 * this.dpr;
      ctx.fillRect(base[0] - tw / 2, by - 13 * this.dpr, tw, 18 * this.dpr); ctx.strokeRect(base[0] - tw / 2, by - 13 * this.dpr, tw, 18 * this.dpr);
      ctx.fillStyle = '#000'; ctx.textAlign = 'center'; ctx.fillText(label, base[0], by + 1 * this.dpr);
      ctx.restore();
    }
    return true;
  }

  // Halloween: one yard on Irving Street from September (see js/eggs.js), the neighbors in October.
  // Drawn live each frame (not cached) so it comes and goes with the season.
  drawHalloween(ctx, s, offX, offY, pass) {
    const sim = this.sim;
    if (!sim || s < 0.7) return false;
    const home = homeLot(this.world), homeOn = home && irvingSeason(sim), hood = halloweenSeason(sim);
    if (!homeOn && !hood) return false;
    const [x0, y0, x1, y1] = this.visibleRect();
    if ((x1 - x0) * (y1 - y0) > 60000) return false;
    const P = (x, y, hm = 0) => { const [rx, ry] = this.rxy(x, y); return [(rx - ry) * 16 * s + offX, (rx + ry) * 8 * s + offY - hm * HS * s]; };
    const inView = (x, y) => x > x0 - 2 && x < x1 + 2 && y > y0 - 2 && y < y1 + 4;
    let drew = false;
    if (pass === 'glow') {
      if (homeOn && inView(home.cx, home.cy)) {
        // red uplights: a pool of light on the yard that washes up the front of the house
        const [yx, yy] = yardPoint(this.world, home);
        const flick = 0.9 + 0.1 * Math.sin(this.time * 0.004) * Math.sin(this.time * 0.0017);
        ctx.save();
        const pools = [[yx, yy, 0, 30, 0.5], [(yx + home.cx) / 2, (yy + home.cy) / 2, 1.4, 44, 0.42]];
        for (const [mode, col] of [['source-over', '205,18,22'], ['lighter', '150,10,10']]) {
          ctx.globalCompositeOperation = mode;
          for (const [x, y, h, r, a] of pools) {
            const p = P(x, y, h);
            const gr = ctx.createRadialGradient(p[0], p[1], 0, p[0], p[1], r * s);
            gr.addColorStop(0, `rgba(${col},${(mode === 'lighter' ? a * 0.6 : a) * flick})`);
            gr.addColorStop(1, `rgba(${col},0)`);
            ctx.fillStyle = gr;
            ctx.beginPath(); ctx.ellipse(p[0], p[1], r * s, r * s * 0.75, 0, 0, Math.PI * 2); ctx.fill();
          }
        }
        ctx.restore();
        // the display itself sits on top: it's the point of the yard
        this.skeletonYard(ctx, P, s, home);
        drew = true;
      }
      return drew;
    }
    if (hood && s >= 1) {
      for (const d of decoratedLots(sim)) {
        const [x, y, ux = 0, uy = 1] = d.yard;
        if (!inView(x, y)) continue;
        this.decor(ctx, P, s, d, x, y, -uy, ux);
        drew = true;
      }
    }
    if (homeOn && inView(home.cx, home.cy)) drew = true; // drawn in the glow pass
    return drew;
  }
  decor(ctx, P, s, d, x, y, px, py) {
    const k = (n) => hash2(d.seed, n, 7);
    if (d.kind === 'pumpkins') {
      for (let n = 0; n < 3; n++) {
        const p = P(x + px * (n - 1) * 0.16, y + py * (n - 1) * 0.16, 0.25);
        const r = (1.6 + 0.8 * k(n)) * s;
        ctx.fillStyle = '#e8741c'; ctx.beginPath(); ctx.ellipse(p[0], p[1], r * 1.2, r, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#4b6b2a'; ctx.fillRect(p[0] - 0.3 * s, p[1] - r - 0.8 * s, 0.7 * s, 0.9 * s);
        if (n === 1) { ctx.fillStyle = '#ffd34d'; ctx.fillRect(p[0] - 0.8 * s, p[1] - 0.3 * s, 0.5 * s, 0.5 * s); ctx.fillRect(p[0] + 0.3 * s, p[1] - 0.3 * s, 0.5 * s, 0.5 * s); }
      }
    } else if (d.kind === 'ghost') {
      const p = P(x, y, 0);
      const h = 7 * s, r = 2.6 * s;
      ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.beginPath(); ctx.ellipse(p[0], p[1], r * 1.2, r * 0.5, 0, 0, Math.PI * 2); ctx.fill();
      const lean = (k(1) - 0.5) * 2 * s;
      ctx.fillStyle = '#f6f6f2';
      ctx.beginPath(); ctx.moveTo(p[0] - r, p[1]); ctx.quadraticCurveTo(p[0] - r + lean, p[1] - h, p[0] + lean, p[1] - h); ctx.quadraticCurveTo(p[0] + r + lean, p[1] - h, p[0] + r, p[1]); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#222'; ctx.fillRect(p[0] + lean - 1.1 * s, p[1] - h * 0.72, 0.7 * s, 0.9 * s); ctx.fillRect(p[0] + lean + 0.4 * s, p[1] - h * 0.72, 0.7 * s, 0.9 * s);
    } else if (d.kind === 'tombs') {
      for (let n = 0; n < 3; n++) {
        const p = P(x + px * (n - 1) * 0.2, y + py * (n - 1) * 0.2, 0);
        const w = 1.8 * s, h = (2.6 + 0.8 * k(n)) * s;
        ctx.fillStyle = '#9aa0a6'; ctx.beginPath(); ctx.moveTo(p[0] - w, p[1]); ctx.lineTo(p[0] - w, p[1] - h + w); ctx.arc(p[0], p[1] - h + w, w, Math.PI, 0); ctx.lineTo(p[0] + w, p[1]); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#6d7378'; ctx.fillRect(p[0] - w * 0.5, p[1] - h * 0.55, w, 0.4 * s);
      }
    } else {
      // orange string lights along the front of the house
      for (let n = 0; n < 9; n++) {
        const t = (n - 4) / 4;
        const p = P(x + px * t * 0.45 - (1 - Math.abs(t)) * 0.02, y + py * t * 0.45, 2.6 - 0.25 * Math.cos(t * 3));
        ctx.fillStyle = n % 3 === 1 ? '#a46cff' : '#ff9a2e';
        ctx.beginPath(); ctx.arc(p[0], p[1], 0.8 * s, 0, Math.PI * 2); ctx.fill();
      }
    }
  }
  skeletonYard(ctx, P, s0, home) {
    const s = s0 * 1.6; // drawn a bit larger than life so the yard reads at street zoom
    const [cx, cy, ux = 0, uy = 1] = yardPoint(this.world, home, 0.42);
    const px = -uy, py = ux;
    const at = (a, r, h = 0) => P(cx + Math.cos(a) * r * 0.9, cy + Math.sin(a) * r * 0.9, h);
    const bone = '#f3eee2', ring = s0 >= 1.2;
    // the cairn
    const c = P(cx, cy, 0);
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(c[0], c[1], 5 * s, 2.4 * s, 0, 0, Math.PI * 2); ctx.fill();
    for (const [dy, r, col] of [[0, 4.2, '#77736c'], [-1.6, 3.2, '#8a857c'], [-3, 2.1, '#9b968c']]) { ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(c[0], c[1] + dy * s, r * s, r * 0.55 * s, 0, 0, Math.PI * 2); ctx.fill(); }
    // a skull with antlers on top
    ctx.fillStyle = bone; ctx.beginPath(); ctx.arc(c[0], c[1] - 4.1 * s, 0.9 * s, 0, Math.PI * 2); ctx.fill();
    const pole = (a, r) => {
      const b = at(a, r, 0), t = at(a, r, 4.2);
      ctx.strokeStyle = '#d9c9a3'; ctx.lineWidth = Math.max(1, 0.6 * s);
      ctx.beginPath(); ctx.moveTo(b[0], b[1]); ctx.lineTo(t[0], t[1]); ctx.stroke();
      ctx.fillStyle = bone; ctx.beginPath(); ctx.ellipse(t[0], t[1], 0.9 * s, 1.2 * s, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#e7dcc4'; ctx.lineWidth = Math.max(0.8, 0.45 * s);
      ctx.beginPath();
      for (const sd of [-1, 1]) { ctx.moveTo(t[0], t[1] - 0.8 * s); ctx.lineTo(t[0] + sd * 2.2 * s, t[1] - 3 * s); ctx.lineTo(t[0] + sd * 3.4 * s, t[1] - 3.6 * s); ctx.moveTo(t[0] + sd * 1.4 * s, t[1] - 2.2 * s); ctx.lineTo(t[0] + sd * 1.2 * s, t[1] - 4 * s); }
      ctx.stroke();
    };
    // skeletons kneeling and reaching toward the cairn, in a ring
    const skel = (a, r) => {
      const f = at(a, r, 0), hd = at(a, r * 0.82, 1.5);
      ctx.strokeStyle = bone; ctx.lineWidth = Math.max(1, 0.55 * s);
      ctx.beginPath();
      ctx.moveTo(f[0], f[1]); ctx.lineTo(hd[0], hd[1] + 1.2 * s); // spine, leaning in
      const rib = [(f[0] + hd[0]) / 2, (f[1] + hd[1]) / 2 + 0.6 * s];
      for (const o of [-0.5, 0.3]) { ctx.moveTo(rib[0] - 1.1 * s, rib[1] + o * s); ctx.lineTo(rib[0] + 1.1 * s, rib[1] + o * s); }
      const hand = at(a, r * 0.6, 0.6);
      ctx.moveTo(rib[0], rib[1] - 0.8 * s); ctx.lineTo(hand[0], hand[1]); // arm reaching out
      ctx.moveTo(f[0], f[1]); ctx.lineTo(f[0] + 1.6 * s, f[1] + 0.4 * s); // folded legs
      ctx.moveTo(f[0], f[1]); ctx.lineTo(f[0] - 1.4 * s, f[1] + 0.5 * s);
      ctx.stroke();
      ctx.fillStyle = bone; ctx.beginPath(); ctx.arc(hd[0], hd[1], 0.95 * s, 0, Math.PI * 2); ctx.fill();
      if (ring) { ctx.fillStyle = '#222'; ctx.fillRect(hd[0] - 0.5 * s, hd[1] - 0.2 * s, 0.35 * s, 0.35 * s); ctx.fillRect(hd[0] + 0.15 * s, hd[1] - 0.2 * s, 0.35 * s, 0.35 * s); }
    };
    // three still figures in pink, behind the cairn (toward the house)
    const kid = (o) => {
      const p = P(cx - ux * 0.32 + px * o * 0.17, cy - uy * 0.32 + py * o * 0.17, 0);
      ctx.fillStyle = '#e9a8b4'; ctx.beginPath(); ctx.moveTo(p[0] - 1.2 * s, p[1] - 0.4 * s); ctx.lineTo(p[0] + 1.2 * s, p[1] - 0.4 * s); ctx.lineTo(p[0] + 0.7 * s, p[1] - 4 * s); ctx.lineTo(p[0] - 0.7 * s, p[1] - 4 * s); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#e8c8a8'; ctx.beginPath(); ctx.arc(p[0], p[1] - 4.9 * s, 0.85 * s, 0, Math.PI * 2); ctx.fill();
    };
    const back = Math.atan2(-uy, -ux);
    const items = [];
    for (let n = 0; n < 8; n++) { const a = back + Math.PI * 0.35 + (n / 7) * Math.PI * 1.3; items.push([a, () => skel(a, 0.42)]); }
    for (const a of [back - 0.9, back + 0.9, back - 2.3, back + 2.3]) items.push([a, () => pole(a, 0.58)]);
    // paint back to front so nearer things overlap farther ones
    const depth = (a) => { const q = at(a, 0.5); return q[1]; };
    const kids = [-1, 0, 1];
    const order = items.map(([a, f]) => [depth(a), f]).concat(kids.map((o) => [P(cx - ux * 0.32 + px * o * 0.17, cy - uy * 0.32 + py * o * 0.17, 0)[1], () => kid(o)]));
    order.sort((p1, p2) => p1[0] - p2[0]);
    for (const [, f] of order) f();
  }

  // robotaxi: white pod with a teal sensor dome
  podTop(ctx, P, pts) {
    let cx = 0, cy = 0;
    for (const q of pts) { cx += q[0]; cy += q[1]; }
    cx /= 4; cy /= 4;
    ctx.fillStyle = '#37b3a6';
    ctx.beginPath();
    pts.forEach((q, n) => { const pp = P(cx + (q[0] - cx) * 0.45, cy + (q[1] - cy) * 0.45, 1.9); n ? ctx.lineTo(pp[0], pp[1]) : ctx.moveTo(pp[0], pp[1]); });
    ctx.closePath(); ctx.fill();
  }

  // delivery drones and air taxis
  drawSky(ctx, s, offX, offY) {
    if (!this.sim || !this.sim.tech || s < 0.4) return false;
    const nD = Math.round(900 * this.techA('delivery')), nA = Math.round(140 * this.techA('airtaxi'));
    if (!nD && !nA) return false;
    const { W, H } = this.world;
    const [x0, y0, x1, y1] = this.visibleRect();
    const t = this.sim.paused ? this.frozenT3 || (this.frozenT3 = this.time) : ((this.frozenT3 = 0), this.time);
    const P = (x, y, hm = 0) => {
      const [rx, ry] = this.rxy(x, y);
      return [(rx - ry) * 16 * s + offX, (rx + ry) * 8 * s + offY - hm * HS * s];
    };
    let drew = false;
    const fly = (k, salt, speed, z, draw) => {
      // each craft shuttles along its own straight line across town
      const ax = hash2(k, salt, 1) * W, ay = hash2(k, salt, 2) * H;
      const ang = hash2(k, salt, 3) * Math.PI * 2;
      const span = 60 + 140 * hash2(k, salt, 4);
      const u = ((t * speed + hash2(k, salt, 5) * span * 2) % (span * 2));
      const d = u < span ? u : span * 2 - u;
      const x = ax + Math.cos(ang) * d, y = ay + Math.sin(ang) * d;
      if (x < x0 - 2 || x > x1 + 2 || y < y0 - 2 || y > y1 + 6) return;
      const g0 = P(x, y, 0), a = P(x, y, z);
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.beginPath(); ctx.ellipse(g0[0], g0[1], 3 * s, 1.5 * s, 0, 0, Math.PI * 2); ctx.fill();
      draw(a, k);
      drew = true;
    };
    for (let k = 0; k < nD; k++)
      fly(k, 71, 0.0018, 28 + 10 * hash2(k, 71, 6), (a) => {
        const r = 2.2 * s;
        ctx.fillStyle = '#2b2d33';
        ctx.fillRect(a[0] - r, a[1] - 0.5 * s, r * 2, 1 * s);
        ctx.fillStyle = 'rgba(210,215,225,0.85)';
        for (const [dx, dy] of [[-r, -0.6 * s], [r, -0.6 * s], [-r * 0.6, 0.7 * s], [r * 0.6, 0.7 * s]]) { ctx.beginPath(); ctx.ellipse(a[0] + dx, a[1] + dy, 1.4 * s, 0.6 * s, 0, 0, Math.PI * 2); ctx.fill(); }
        ctx.fillStyle = '#e3b63c';
        ctx.fillRect(a[0] - 0.8 * s, a[1] + 0.5 * s, 1.6 * s, 1.4 * s);
      });
    for (let k = 0; k < nA; k++)
      fly(k, 83, 0.004, 90, (a, kk) => {
        ctx.fillStyle = '#f4f6f8';
        ctx.beginPath(); ctx.ellipse(a[0], a[1], 5 * s, 2.2 * s, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#9aa3ad';
        ctx.lineWidth = Math.max(1, 0.8 * s);
        ctx.beginPath(); ctx.moveTo(a[0] - 9 * s, a[1] - 0.5 * s); ctx.lineTo(a[0] + 9 * s, a[1] - 0.5 * s); ctx.stroke();
        ctx.fillStyle = '#37b3a6';
        ctx.fillRect(a[0] - 1.5 * s, a[1] - 1.2 * s, 3 * s, 1.2 * s);
        if (Math.floor(this.time / 400 + kk) % 2) { ctx.fillStyle = '#ff3b30'; ctx.fillRect(a[0] - 0.8 * s, a[1] - 3 * s, 1.6 * s, 1.6 * s); }
      });
    return drew && !this.sim.paused;
  }

  visibleRect() {
    const pts = [[0, 0], [this.cw, 0], [0, this.ch], [this.cw, this.ch]].map(([x, y]) => this.screenToGrid(x / this.dpr, y / this.dpr));
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    return [Math.max(0, Math.floor(Math.min(...xs)) - 1), Math.max(0, Math.floor(Math.min(...ys)) - 1), Math.min(this.world.W - 1, Math.ceil(Math.max(...xs)) + 1), Math.min(this.world.H - 1, Math.ceil(Math.max(...ys)) + 4)];
  }

  drawCars(ctx, s, offX, offY) {
    const { W, H, road, terrain } = this.world;
    const traffic = this.sim.congestion;
    if (!traffic) return false;
    const [x0, y0, x1, y1] = this.visibleRect();
    if ((x1 - x0) * (y1 - y0) > 40000) return false;
    const t = this.sim.paused ? this.frozenT || (this.frozenT = this.time) : ((this.frozenT = 0), this.time);
    const v = 0.0011;
    const sp = 1.15;
    const P = (x, y, hm = 0) => {
      const [rx, ry] = this.rxy(x, y);
      return [(rx - ry) * 16 * s + offX, (rx + ry) * 8 * s + offY - hm * HS * s];
    };
    const colors = ['#d23c3c', '#e8e8e8', '#2b5fb8', '#222', '#e3b63c', '#6a6a6a', '#3b8a4a'];
    const podShare = this.techA('robotaxi');
    let drew = false;
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const i = y * W + x;
        const cls = road[i];
        if (!cls) continue;
        if (this.lineIdx && this.world.osmRoad[i] && !this.world.roadCut[i]) continue;
        const E = x + 1 < W && road[i + 1], Wn = x > 0 && road[i - 1], S = y + 1 < H && road[i + W], N = y > 0 && road[i - W];
        const ew = (E || Wn) && !N && !S, ns = (N || S) && !E && !Wn;
        if (!ew && !ns) continue;
        const dens = clamp(traffic[i] * 0.8 + 0.06, 0, 0.95);
        for (const dir of [1, -1]) {
          const lane = dir > 0 ? 0.36 : 0.64;
          const along0 = ew ? x : y;
          const row = ew ? y : x;
          const shift = dir * t * v * (cls === 3 ? 1.3 : 1);
          const kmin = Math.ceil((along0 - shift) / sp - 1), kmax = Math.floor((along0 + 1 - shift) / sp);
          for (let kk = kmin; kk <= kmax; kk++) {
            const pos = kk * sp + shift + ((hash2(kk, row, dir) * 0.6) % sp);
            if (pos < along0 || pos >= along0 + 1) continue;
            if (hash2(kk, row, dir + 7) > dens) continue;
            const cx = ew ? pos : x + lane, cy = ew ? y + lane : pos;
            const lx = ew ? 0.13 : 0.07, ly = ew ? 0.07 : 0.13;
            const pod = hash2(kk, row, 13) < podShare;
            const col = pod ? '#eef4f3' : colors[Math.floor(hash2(kk, row, 3) * colors.length)];
            const z = terrain[i] === 1 ? 0 : 0;
            const pts = [[cx - lx, cy - ly], [cx + lx, cy - ly], [cx + lx, cy + ly], [cx - lx, cy + ly]];
            ctx.fillStyle = 'rgba(0,0,0,0.35)';
            ctx.beginPath();
            pts.forEach((q, k2) => { const p = P(q[0], q[1], z); k2 ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); });
            ctx.closePath(); ctx.fill();
            ctx.fillStyle = col;
            ctx.beginPath();
            pts.forEach((q, k2) => { const p = P(q[0], q[1], 1.4); k2 ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); });
            ctx.closePath(); ctx.fill();
            if (pod) this.podTop(ctx, P, pts);
            drew = true;
          }
        }
      }
    return drew && !this.sim.paused;
  }

  drawLineCars(ctx, s, offX, offY, vis) {
    const w = this.world;
    const cong = this.sim.congestion;
    const { W, H } = w;
    const [vx0, vy0, vx1, vy1] = this.visibleRect();
    if ((vx1 - vx0) * (vy1 - vy0) > 40000) return false;
    const t = this.sim.paused ? this.frozenT2 || (this.frozenT2 = this.time) : ((this.frozenT2 = 0), this.time);
    const P = (x, y, hm = 0) => {
      const [rx, ry] = this.rxy(x, y);
      return [(rx - ry) * 16 * s + offX, (rx + ry) * 8 * s + offY - hm * HS * s];
    };
    const RW = [0, 0.55, 0.75, 0.95];
    const colors = ['#d23c3c', '#e8e8e8', '#2b5fb8', '#222', '#e3b63c', '#6a6a6a', '#3b8a4a'];
    const seen = new Set();
    const sp = 1.3;
    const podShare = this.techA('robotaxi');
    let drew = false;
    for (const v of vis)
      for (const li of this.lineIdx[v.cy * this.ncx + v.cx]) {
        if (seen.has(li)) continue;
        seen.add(li);
        const ln = w.roadLines[li];
        const p = ln.pts;
        const speed = 0.0011 * (ln.cls === 3 ? 1.3 : 1);
        let acc = 0;
        for (let k = 0; k + 3 < p.length; k += 2) {
          const ax = p[k], ay = p[k + 1], bx = p[k + 2], by = p[k + 3];
          const len = Math.hypot(bx - ax, by - ay);
          if (len < 1e-4) continue;
          const mx = (ax + bx) / 2, my = (ay + by) / 2;
          if (mx < vx0 - 2 || mx > vx1 + 2 || my < vy0 - 2 || my > vy1 + 2) { acc += len; continue; }
          const ux = (bx - ax) / len, uy = (by - ay) / len, nx = -uy, ny = ux;
          for (const dir of [1, -1]) {
            const off = RW[ln.cls] * 0.24 * dir;
            const phase = (((t * speed * dir) % sp) + sp) % sp;
            const j0 = Math.ceil((acc - phase) / sp), j1 = Math.floor((acc + len - phase) / sp);
            for (let j = j0; j <= j1; j++) {
              const u = j * sp + phase - acc;
              const cxp = ax + ux * u + nx * off, cyp = ay + uy * u + ny * off;
              const ti = Math.floor(cyp) * W + Math.floor(cxp);
              if (cxp < 0 || cyp < 0 || cxp >= W || cyp >= H) continue;
              const dens = clamp((cong[ti] || 0) * 0.8 + 0.06, 0, 0.9);
              if (hash2(li * 7 + j, k, dir + 5) > dens) continue;
              const fx = ux * 0.14, fy = uy * 0.14, sx = nx * 0.07, sy = ny * 0.07;
              const q = [[cxp - fx - sx, cyp - fy - sy], [cxp + fx - sx, cyp + fy - sy], [cxp + fx + sx, cyp + fy + sy], [cxp - fx + sx, cyp - fy + sy]];
              ctx.fillStyle = 'rgba(0,0,0,0.35)';
              ctx.beginPath();
              q.forEach((c, n) => { const pp = P(c[0], c[1], 0); n ? ctx.lineTo(pp[0], pp[1]) : ctx.moveTo(pp[0], pp[1]); });
              ctx.closePath(); ctx.fill();
              const pod = hash2(li, j, dir + 13) < podShare;
              ctx.fillStyle = pod ? '#eef4f3' : colors[Math.floor(hash2(li, j, dir) * colors.length)];
              ctx.beginPath();
              q.forEach((c, n) => { const pp = P(c[0], c[1], 1.4); n ? ctx.lineTo(pp[0], pp[1]) : ctx.moveTo(pp[0], pp[1]); });
              ctx.closePath(); ctx.fill();
              if (pod) this.podTop(ctx, P, q);
              drew = true;
            }
          }
          acc += len;
        }
      }
    return drew && !this.sim.paused;
  }

  drawIncidents(ctx, s, offX, offY) {
    const sim = this.sim;
    this.incHits = [];
    const building = (sim && sim.projects ? sim.projects : []).filter((p) => p.stage === 'build');
    for (const p of building) this.drawCrane(ctx, s, offX, offY, p);
    if (!sim || !sim.inc || !sim.inc.list.length && !sim.inc.crews.some((c) => c.state !== 'idle')) return building.length > 0;
    const I = sim.inc;
    const d = this.dpr;
    const P = (x, y, hm = 0) => {
      const [rx, ry] = this.rxy(x, y);
      return [(rx - ry) * 16 * s + offX, (rx + ry) * 8 * s + offY - hm * HS * s];
    };
    const on = (px, py) => px > -40 && py > -60 && px < this.cw + 40 && py < this.ch + 60;
    // ground effects: snow drifts, flooding
    for (const it of I.list) {
      if (it.type !== 'snow' && it.type !== 'watermain') continue;
      const [px, py] = P(it.x, it.y);
      if (!on(px, py)) continue;
      const r = (it.type === 'snow' ? 3.2 : 1.6) * 16 * s;
      ctx.fillStyle = it.type === 'snow' ? 'rgba(248,250,255,0.62)' : 'rgba(60,120,210,0.5)';
      ctx.beginPath();
      ctx.ellipse(px, py, r, r / 2, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // crews
    for (const c of I.crews) {
      if (c.state === 'idle') continue;
      const [px, py] = P(c.x, c.y, 1);
      if (!on(px, py)) continue;
      const w = Math.max(6 * d, 9 * s), h = w * 0.6;
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(px - w / 2 + 2, py - h / 2 + 3, w, h);
      ctx.fillStyle = DEPTS[c.dept].truck;
      ctx.strokeStyle = '#111';
      ctx.lineWidth = Math.max(1, d);
      ctx.fillRect(px - w / 2, py - h / 2, w, h);
      ctx.strokeRect(px - w / 2, py - h / 2, w, h);
      if (c.state === 'work' && Math.floor(this.time / 300) % 2) {
        ctx.fillStyle = c.dept === 'fire' ? '#ff4040' : '#ffb000';
        ctx.beginPath();
        ctx.arc(px, py - h, Math.max(2 * d, 3 * s), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // incident markers (constant screen size, bobbing)
    const bob = sim.paused ? 0 : Math.sin(this.time / 260) * 3 * d;
    const R = Math.max(9, Math.min(14, 12 * Math.sqrt(s))) * d;
    for (const it of I.list) {
      const def = INC[it.type];
      const [gx, gy] = P(it.x, it.y, it.type === 'fire' ? 9 : 0);
      if (!on(gx, gy)) continue;
      if (it.type === 'fire') {
        for (let k = 0; k < 3; k++) {
          const fx = gx + (k - 1) * 5 * d * Math.max(0.6, s), fl = (8 + 6 * Math.sin(this.time / 90 + k * 2)) * d * Math.max(0.6, s);
          ctx.fillStyle = k === 1 ? '#ffcf3a' : '#ff6a1a';
          ctx.beginPath();
          ctx.moveTo(fx - 4 * d, gy);
          ctx.lineTo(fx, gy - fl);
          ctx.lineTo(fx + 4 * d, gy);
          ctx.fill();
        }
      }
      const py = gy - R * 2.4 + (it.working ? 0 : bob);
      const age = I.day - it.born;
      const u = age / def.grace;
      const col = it.working ? '#2e9e44' : it.crew ? '#2b6fd0' : u < 0.6 ? '#e8b400' : u < 1 ? '#e67e22' : '#d0312d';
      ctx.strokeStyle = 'rgba(0,0,0,0.45)';
      ctx.lineWidth = d;
      ctx.beginPath();
      ctx.moveTo(gx, gy);
      ctx.lineTo(gx, py + R);
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = col;
      ctx.lineWidth = 3 * d;
      ctx.beginPath();
      ctx.arc(gx, py, R, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.font = `${Math.round(R * 1.15)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#000';
      ctx.fillText(def.icon, gx, py + d);
      this.incHits.push({ id: it.id, x: gx / d, y: py / d, r: (R / d) * 1.5 });
    }
    return true;
  }
  drawCrane(ctx, s, offX, offY, p) {
    const P = (x, y, hm = 0) => {
      const [rx, ry] = this.rxy(x, y);
      return [(rx - ry) * 16 * s + offX, (rx + ry) * 8 * s + offY - hm * HS * s];
    };
    const [bx, by] = P(p.cx, p.cy, 0);
    if (bx < -200 || bx > this.cw + 200 || by < -50 || by > this.ch + 400) return;
    const H = 34;
    const [tx, ty] = P(p.cx, p.cy, H);
    const ang = this.time / 4000 + p.id;
    const jx = Math.cos(ang) * 4, jy = Math.sin(ang) * 4;
    const [ex, ey] = P(p.cx + jx, p.cy + jy, H);
    const [cx2, cy2] = P(p.cx - jx * 0.35, p.cy - jy * 0.35, H);
    ctx.strokeStyle = '#e3a21a';
    ctx.lineWidth = Math.max(1.5, 2.2 * s);
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(tx, ty);
    ctx.moveTo(cx2, cy2);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    ctx.strokeStyle = '#333';
    ctx.lineWidth = Math.max(1, s);
    const [hx, hy] = P(p.cx + jx * 0.8, p.cy + jy * 0.8, H - 14);
    const [hx0, hy0] = P(p.cx + jx * 0.8, p.cy + jy * 0.8, H);
    ctx.beginPath();
    ctx.moveTo(hx0, hy0);
    ctx.lineTo(hx, hy);
    ctx.stroke();
    ctx.fillStyle = '#555';
    ctx.fillRect(cx2 - 3 * s, cy2 - 2 * s, 6 * s, 4 * s);
  }
  incidentAt(cssX, cssY) {
    let best = null, bd = Infinity;
    for (const h of this.incHits || []) {
      const dd = Math.hypot(h.x - cssX, h.y - cssY);
      if (dd < h.r && dd < bd) { bd = dd; best = h.id; }
    }
    return best;
  }

  drawPreview(ctx, s, offX, offY) {
    const { W } = this.world;
    const P = (x, y) => {
      const [rx, ry] = this.rxy(x, y);
      return [(rx - ry) * 16 * s + offX, (rx + ry) * 8 * s + offY];
    };
    const dia = (i, fill, strokeCol) => {
      const x = i % W, y = (i / W) | 0;
      const a = P(x, y), b = P(x + 1, y), c = P(x + 1, y + 1), d = P(x, y + 1);
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(c[0], c[1]); ctx.lineTo(d[0], d[1]); ctx.closePath();
      if (fill) { ctx.fillStyle = fill; ctx.fill(); }
      if (strokeCol) { ctx.strokeStyle = strokeCol; ctx.lineWidth = Math.max(1, s); ctx.stroke(); }
    };
    if (this.preview && this.preview.tiles) {
      const ok = this.preview.ok;
      const col = this.preview.color || (ok ? 'rgba(120,255,140,0.35)' : 'rgba(255,80,80,0.4)');
      for (const i of this.preview.tiles) dia(i, col, null);
      const ln = this.preview.line;
      if (ln && ln.length >= 4) {
        ctx.strokeStyle = ok ? 'rgba(255,255,255,0.9)' : 'rgba(255,120,120,0.9)';
        ctx.lineWidth = Math.max(2, 3 * s);
        ctx.setLineDash([6 * s, 4 * s]);
        ctx.beginPath();
        for (let k = 0; k + 1 < ln.length; k += 2) { const q = P(ln[k], ln[k + 1]); k ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); }
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    if (this.hover >= 0) dia(this.hover, null, 'rgba(255,255,255,0.85)');
    if (this.selLot != null) {
      const lot = this.world.lots[this.selLot];
      if (lot) for (const i of lot.tiles) dia(i, 'rgba(255,255,120,0.25)', null);
    }
  }
}
