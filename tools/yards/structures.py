# Backyard structures the maps leave out: garages, sheds, cabanas and carports that the 2021 lidar sees as
# building returns but that have no footprint in OpenStreetMap or MassGIS. Reads the lidar points from
# tools/lidar/fetch.py (points.bin) and the game's footprints from data/watertown.json.gz.
# Writes data/yards.json.gz: rows [lat1e5, lon1e5, length dm, width dm, bearing deg, eave dm, top dm, points].
# Alone, about a third of these are real sheds and garages (the rest are bits of houses the footprints missed),
# so the game only uses one where the assessor's card lists an outbuilding the map lacks, on that lot.
import gzip, json, math, os, datetime
import numpy as np
from scipy import ndimage
from matplotlib.path import Path

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..', '..')
LW = os.environ.get('LIDAR_WORK', os.path.join(HERE, '..', 'lidar', 'work'))
WORK = os.path.join(HERE, 'work'); os.makedirs(WORK, exist_ok=True)
K = math.cos(math.radians(42.372))  # Web Mercator metres -> real metres here

def merc(lat, lon):
    return lon * 20037508.34 / 180, math.log(math.tan((90 + lat) * math.pi / 360)) * 6378137
def unmerc(x, y):
    return math.degrees(2 * math.atan(math.exp(y / 6378137)) - math.pi / 2), x * 180 / 20037508.34

rec = np.fromfile(os.path.join(LW, 'points.bin'), dtype=[('x', '<i4'), ('y', '<i4'), ('z', '<i4'), ('c', 'u1')])
X = rec['x'] / 100.0; Y = rec['y'] / 100.0; Z = rec['z'] / 100.0; C = rec['c']
x0, y0 = X.min(), Y.min()
step = 1.0 / K  # a 1 m (real) cell in Web Mercator metres
ni = int((X.max() - x0) / step) + 2; nj = int((Y.max() - y0) / step) + 2
I = ((X - x0) / step).astype(np.int64); J = ((Y - y0) / step).astype(np.int64)
print('grid', ni, nj, len(rec), 'points')

# ground: lowest return per 4 m block, holes filled from the nearest block
B = 4
g = C == 2
dtm = np.full((ni // B + 1, nj // B + 1), np.nan)
np.fmin.at(dtm, (I[g] // B, J[g] // B), Z[g])
idx = ndimage.distance_transform_edt(np.isnan(dtm), return_distances=False, return_indices=True)
dtm = dtm[tuple(idx)]

b = (C == 6)
hb = Z[b] - dtm[I[b] // B, J[b] // B]
ok = (hb > 1.6) & (hb < 14)
bi, bj, bh = I[b][ok], J[b][ok], hb[ok]
occ = np.zeros((ni, nj), bool); occ[bi, bj] = True

# every footprint the game already has, grown by a metre and a half (eaves overhang, footprints drift)
snap = json.load(gzip.open(os.path.join(ROOT, 'data', 'watertown.json.gz')))
def dec(flat):
    a = c = 0; out = []
    for k in range(0, len(flat) - 1, 2):
        a += flat[k]; c += flat[k + 1]; out.append((a / 1e6, c / 1e6))
    return out
foots = []
for tags, flat in snap['ways']:
    if tags and 'building' in tags:
        p = dec(flat)
        if len(p) >= 4: foots.append(p)
for tags, ms in snap['rels']:
    if tags and 'building' in tags:
        for role, flat in ms:
            if role == 'outer':
                p = dec(flat)
                if len(p) >= 4: foots.append(p)
mask = np.zeros((ni, nj), bool)
for p in foots:
    poly = np.array([merc(a, c) for a, c in p])
    gi = (poly[:, 0] - x0) / step; gj = (poly[:, 1] - y0) / step
    a0, a1 = int(max(0, gi.min() - 1)), int(min(ni - 1, gi.max() + 1)); b0, b1 = int(max(0, gj.min() - 1)), int(min(nj - 1, gj.max() + 1))
    if a1 < a0 or b1 < b0: continue
    aa, bb = np.meshgrid(np.arange(a0, a1 + 1), np.arange(b0, b1 + 1), indexing='ij')
    inside = Path(np.column_stack([gi, gj])).contains_points(np.column_stack([aa.ravel() + 0.5, bb.ravel() + 0.5]))
    mask[aa.ravel()[inside], bb.ravel()[inside]] = True
mask = ndimage.binary_dilation(mask, iterations=3)  # 3 m: additions and porches the footprint missed aren't sheds
print(len(foots), 'footprints masked')

free = ndimage.binary_closing(occ, iterations=1) & ~mask
lab, n = ndimage.label(free)
print(n, 'candidate blobs')
# points per blob
pl = lab[bi, bj]
order = np.argsort(pl, kind='stable'); pls = pl[order]
starts = np.searchsorted(pls, np.arange(n + 2))
sizes = ndimage.sum(free, lab, index=np.arange(1, n + 1))

def min_rect(P):
    from scipy.spatial import ConvexHull
    try: h = P[ConvexHull(P).vertices]
    except Exception: return None
    best = None
    for k in range(len(h)):
        e = h[(k + 1) % len(h)] - h[k]; L = np.hypot(*e)
        if L < 1e-6: continue
        u = e / L; v = np.array([-u[1], u[0]])
        a = h @ u; c = h @ v
        area = (a.max() - a.min()) * (c.max() - c.min())
        if best is None or area < best[0]: best = (area, u, a.max() - a.min(), c.max() - c.min())
    return best

rows = []
for k in range(1, n + 1):
    area = sizes[k - 1]
    if area < 5 or area > 130: continue
    sel = order[starts[k]:starts[k + 1]]
    if len(sel) < 10: continue
    # metres in a local frame
    px = (bi[sel] + 0.5) * 1.0; py = (bj[sel] + 0.5) * 1.0
    P = np.unique(np.column_stack([px, py]), axis=0)
    if len(P) < 5: continue
    r = min_rect(P)
    if not r: continue
    _, u, Lr, Wr = r
    Lr += 1.0; Wr += 1.0  # cell centres -> edges
    if Wr > Lr: Lr, Wr = Wr, Lr; u = np.array([-u[1], u[0]])
    if Wr < 1.8 or Lr > 16 or Lr / Wr > 4.5: continue  # walls, fences, hedges and long thin things aren't sheds
    if area < 0.55 * Lr * Wr: continue  # ragged: a tree or a tangle, not a roof
    hh = bh[sel]
    top = float(np.percentile(hh, 90)); eave = float(np.percentile(hh, 15))
    if top < 2.0 or top > 7.0: continue
    # a roof is a plane or a pair of planes; a misclassified tree crown isn't
    Q = np.column_stack([px, py]); Q = Q - Q.mean(0)
    vv = np.abs(Q @ np.array([-u[1], u[0]]))
    best = 9
    for cols in ([Q[:, 0], Q[:, 1]], [vv]):
        A = np.column_stack(cols + [np.ones(len(hh))])
        co, *_ = np.linalg.lstsq(A, hh, rcond=None)
        best = min(best, float(np.sqrt(np.mean((hh - A @ co) ** 2))))
    if best > 0.45: continue
    cxm = x0 + px.mean() * step; cym = y0 + py.mean() * step
    lat, lon = unmerc(cxm, cym)
    bearing = (math.degrees(math.atan2(u[0], u[1])) + 180) % 180
    rows.append([round(lat * 1e5), round(lon * 1e5), round(Lr * 10), round(Wr * 10), round(bearing), round(eave * 10), round(top * 10), int(len(sel))])
print(len(rows), 'structures')
OUT = os.path.join(ROOT, 'data', 'yards.json.gz')
data = {'v': 1, 'fetched': datetime.date.today().isoformat(), 'source': 'USGS 3DEP lidar (2021): building returns outside every mapped footprint',
        'cols': ['lat1e5', 'lon1e5', 'length_dm', 'width_dm', 'bearing', 'eave_dm', 'top_dm', 'points'], 'rows': rows}
with gzip.open(OUT, 'wt', compresslevel=9) as f: json.dump(data, f, separators=(',', ':'))
json.dump(data, open(os.path.join(WORK, 'structures.json'), 'w'))
print('->', os.path.relpath(OUT), os.path.getsize(OUT) // 1024, 'kB')
import collections
print('areas', collections.Counter(min(150, (r[2] * r[3] // 100) // 10 * 10) for r in rows).most_common(12))
