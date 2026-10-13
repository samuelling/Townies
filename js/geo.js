import { CFG } from './config.js';

// Local equirectangular projection: lat/lon -> grid tile coordinates (x east, y south).
export function makeProj(b) {
  const latMid = ((b.s + b.n) / 2) * (Math.PI / 180);
  const kx = (Math.cos(latMid) * 111320) / CFG.TILE_M;
  const ky = 110574 / CFG.TILE_M;
  return {
    bbox: b,
    kx,
    ky,
    W: Math.ceil((b.e - b.w) * kx),
    H: Math.ceil((b.n - b.s) * ky),
    toGrid: (lat, lon) => [(lon - b.w) * kx, (b.n - lat) * ky],
    toLatLon: (x, y) => [b.n - y / ky, b.w + x / kx],
  };
}

// Even-odd scanline fill at tile centres over a set of polylines whose segments
// together form closed rings (works for multipolygon member ways without stitching).
export function fillSegs(polys, W, H, cb) {
  let minY = Infinity,
    maxY = -Infinity;
  for (const p of polys)
    for (const q of p) {
      if (q[1] < minY) minY = q[1];
      if (q[1] > maxY) maxY = q[1];
    }
  if (!isFinite(minY)) return 0;
  const y0 = Math.max(0, Math.floor(minY - 0.5));
  const y1 = Math.min(H - 1, Math.ceil(maxY));
  let n = 0;
  const xs = [];
  for (let y = y0; y <= y1; y++) {
    const yc = y + 0.5;
    xs.length = 0;
    for (const p of polys) {
      for (let i = 0; i + 1 < p.length; i++) {
        const a = p[i],
          b = p[i + 1];
        if (a[1] <= yc !== b[1] <= yc) xs.push(a[0] + ((yc - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
      }
    }
    if (xs.length < 2) continue;
    xs.sort((u, v) => u - v);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      let xa = Math.ceil(xs[k] - 0.5),
        xb = Math.floor(xs[k + 1] - 0.5);
      if (xa < 0) xa = 0;
      if (xb > W - 1) xb = W - 1;
      for (let x = xa; x <= xb; x++) {
        cb(y * W + x, x, y);
        n++;
      }
    }
  }
  return n;
}

export function pointInPolys(polys, x, y) {
  let inside = false;
  for (const p of polys)
    for (let i = 0; i + 1 < p.length; i++) {
      const a = p[i],
        b = p[i + 1];
      if (a[1] <= y !== b[1] <= y && x < a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1])) inside = !inside;
    }
  return inside;
}

// 4-connected grid traversal (Amanatides & Woo) from point a to point b.
export function traverse(ax, ay, bx, by, cb) {
  let x = Math.floor(ax),
    y = Math.floor(ay);
  const ex = Math.floor(bx),
    ey = Math.floor(by);
  const dx = bx - ax,
    dy = by - ay;
  const sx = Math.sign(dx),
    sy = Math.sign(dy);
  const tdx = dx !== 0 ? Math.abs(1 / dx) : Infinity;
  const tdy = dy !== 0 ? Math.abs(1 / dy) : Infinity;
  let tmx = dx > 0 ? (x + 1 - ax) / dx : dx < 0 ? (ax - x) / -dx : Infinity;
  let tmy = dy > 0 ? (y + 1 - ay) / dy : dy < 0 ? (ay - y) / -dy : Infinity;
  cb(x, y);
  const n = Math.abs(ex - x) + Math.abs(ey - y);
  for (let i = 0; i < n; i++) {
    if (tmx < tmy) {
      x += sx;
      tmx += tdx;
    } else {
      y += sy;
      tmy += tdy;
    }
    cb(x, y);
  }
}

export function signedArea(p) {
  let a = 0;
  for (let i = 0, n = p.length; i < n; i++) {
    const q = p[i],
      r = p[(i + 1) % n];
    a += q[0] * r[1] - r[0] * q[1];
  }
  return a / 2;
}

export function centroid(p) {
  let a = 0,
    cx = 0,
    cy = 0;
  for (let i = 0, n = p.length; i < n; i++) {
    const q = p[i],
      r = p[(i + 1) % n];
    const f = q[0] * r[1] - r[0] * q[1];
    a += f;
    cx += (q[0] + r[0]) * f;
    cy += (q[1] + r[1]) * f;
  }
  if (Math.abs(a) < 1e-9) {
    let sx = 0,
      sy = 0;
    for (const q of p) {
      sx += q[0];
      sy += q[1];
    }
    return [sx / p.length, sy / p.length];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

// Douglas-Peucker simplification of an open ring (no closing duplicate).
export function simplify(pts, tol) {
  if (pts.length <= 4) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  const t2 = tol * tol;
  while (stack.length) {
    const [i0, i1] = stack.pop();
    const a = pts[i0],
      b = pts[i1];
    const dx = b[0] - a[0],
      dy = b[1] - a[1];
    const L = dx * dx + dy * dy || 1e-12;
    let md = -1,
      mi = -1;
    for (let i = i0 + 1; i < i1; i++) {
      const p = pts[i];
      let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const ex = a[0] + t * dx - p[0],
        ey = a[1] + t * dy - p[1];
      const d = ex * ex + ey * ey;
      if (d > md) {
        md = d;
        mi = i;
      }
    }
    if (md > t2) {
      keep[mi] = 1;
      stack.push([i0, mi], [mi, i1]);
    }
  }
  const out = pts.filter((_, i) => keep[i]);
  return out.length >= 3 ? out : pts;
}

function hull(pts) {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [],
    up = [];
  for (const q of p) {
    while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop();
    lo.push(q);
  }
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop();
    up.push(q);
  }
  up.pop();
  lo.pop();
  return lo.concat(up);
}

// Minimum-area oriented bounding box; returns 4 corners with c0->c1 the long side.
export function obb(pts) {
  const h = hull(pts);
  if (h.length < 3) return null;
  let best = null;
  for (let i = 0; i < h.length; i++) {
    const a = h[i],
      b = h[(i + 1) % h.length];
    let ux = b[0] - a[0],
      uy = b[1] - a[1];
    const L = Math.hypot(ux, uy);
    if (L < 1e-9) continue;
    ux /= L;
    uy /= L;
    const vx = -uy,
      vy = ux;
    let mnu = Infinity,
      mxu = -Infinity,
      mnv = Infinity,
      mxv = -Infinity;
    for (const q of h) {
      const u = q[0] * ux + q[1] * uy,
        v = q[0] * vx + q[1] * vy;
      if (u < mnu) mnu = u;
      if (u > mxu) mxu = u;
      if (v < mnv) mnv = v;
      if (v > mxv) mxv = v;
    }
    const area = (mxu - mnu) * (mxv - mnv);
    if (!best || area < best.area) best = { area, ux, uy, vx, vy, mnu, mxu, mnv, mxv };
  }
  if (!best) return null;
  let { ux, uy, vx, vy, mnu, mxu, mnv, mxv } = best;
  const P = (u, v) => [u * ux + v * vx, u * uy + v * vy];
  let c = [P(mnu, mnv), P(mxu, mnv), P(mxu, mxv), P(mnu, mxv)];
  if (mxu - mnu < mxv - mnv) c = [c[1], c[2], c[3], c[0]];
  return { c, area: best.area };
}

// Largest axis-aligned rectangle of set tiles in a small bitmap.
export function maxRect(mask, w, h) {
  const hist = new Int32Array(w);
  let best = { area: 0, x: 0, y: 0, w: 0, h: 0 };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) hist[x] = mask[y * w + x] ? hist[x] + 1 : 0;
    const st = [];
    for (let x = 0; x <= w; x++) {
      const hh = x < w ? hist[x] : 0;
      let start = x;
      while (st.length && st[st.length - 1][1] >= hh) {
        const [sx, sh] = st.pop();
        const area = sh * (x - sx);
        if (area > best.area) best = { area, x: sx, y: y - sh + 1, w: x - sx, h: sh };
        start = sx;
      }
      st.push([start, hh]);
    }
  }
  return best;
}
