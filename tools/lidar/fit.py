# Fit each building's roof from the 2021 lidar (points.bin from fetch.py): ground level, eave and ridge
# heights, which way the ridge runs, and the roof's form (flat, gable, hip, gambrel, mansard).
# Writes data/lidar.json.gz: rows of [lat*1e5, lon*1e5, eave dm, top dm, form, ridge bearing deg, fit quality %].
import gzip, json, math, os, sys, datetime
import numpy as np
from matplotlib.path import Path

HERE = os.path.dirname(os.path.abspath(__file__))
W = os.environ.get('LIDAR_WORK', os.path.join(HERE, 'work'))
ROOT = os.path.join(HERE, '..', '..')
OUT = os.path.join(ROOT, 'data', 'lidar.json.gz')
FORMS = ['flat', 'gable', 'hip', 'gambrel', 'mansard', 'shed']

def merc(lat, lon):
    return lon * 20037508.34 / 180, math.log(math.tan((90 + lat) * math.pi / 360)) * 6378137

# ---- building footprints, as the game builds them (OpenStreetMap ways with a building tag) ----
snap = json.load(gzip.open(os.path.join(ROOT, 'data', 'watertown.json.gz')))
def dec(flat):
    a = b = 0; out = []
    for i in range(0, len(flat) - 1, 2):
        a += flat[i]; b += flat[i + 1]; out.append((a / 1e6, b / 1e6))
    return out
foots = []
for tags, flat in snap['ways']:
    if not tags or 'building' not in tags: continue
    pts = dec(flat)
    if len(pts) < 4: continue
    foots.append(pts)
for tags, ms in snap['rels']:
    if not tags or 'building' not in tags: continue
    for role, flat in ms:
        if role == 'outer':
            pts = dec(flat)
            if len(pts) >= 4: foots.append(pts)
print(len(foots), 'footprints')

# ---- points ----
rec = np.fromfile(os.path.join(W, 'points.bin'), dtype=[('x', '<i4'), ('y', '<i4'), ('z', '<i4'), ('c', 'u1')])
X = rec['x'] / 100.0; Y = rec['y'] / 100.0; Z = rec['z'] / 100.0; C = rec['c']
print(len(rec), 'points,', int((C == 6).sum()), 'building')
CELL = 8.0
cx = np.floor(X / CELL).astype(np.int64); cy = np.floor(Y / CELL).astype(np.int64)
key = cx * 1000003 + cy
order = np.argsort(key, kind='stable')
skey = key[order]
def near(x0, y0, x1, y1):
    idx = []
    for i in range(int(math.floor(x0 / CELL)), int(math.floor(x1 / CELL)) + 1):
        for j in range(int(math.floor(y0 / CELL)), int(math.floor(y1 / CELL)) + 1):
            k = i * 1000003 + j
            a = np.searchsorted(skey, k, 'left'); b = np.searchsorted(skey, k, 'right')
            if b > a: idx.append(order[a:b])
    return np.concatenate(idx) if idx else np.zeros(0, dtype=np.int64)

def hull(p):
    p = sorted(set(map(tuple, p)))
    if len(p) < 3: return p
    def cross(o, a, b): return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lo, up = [], []
    for q in p:
        while len(lo) >= 2 and cross(lo[-2], lo[-1], q) <= 0: lo.pop()
        lo.append(q)
    for q in reversed(p):
        while len(up) >= 2 and cross(up[-2], up[-1], q) <= 0: up.pop()
        up.append(q)
    return lo[:-1] + up[:-1]
def min_rect(p):
    h = np.array(hull(p))
    best = None
    for i in range(len(h)):
        e = h[(i + 1) % len(h)] - h[i]
        n = np.hypot(*e)
        if n < 1e-6: continue
        u = e / n; v = np.array([-u[1], u[0]])
        a = h @ u; b = h @ v
        area = (a.max() - a.min()) * (b.max() - b.min())
        if best is None or area < best[0]: best = (area, u, v, a.min(), a.max(), b.min(), b.max())
    return best

def lsq(cols, z, w=None):
    A = np.column_stack(cols + [np.ones_like(z)])
    keep = np.ones(len(z), bool) if w is None else w
    for _ in range(3):  # trimmed least squares: drop chimneys, dormers, porch roofs and trees, refit
        coef, *_ = np.linalg.lstsq(A[keep], z[keep], rcond=None)
        r = z - A @ coef
        s = max(0.25, 2.5 * float(np.median(np.abs(r[keep]))))
        nk = np.abs(r) < s
        if nk.sum() < 10 or (nk == keep).all(): break
        keep = nk
    return coef, float(np.sqrt(np.mean(r[keep] ** 2))), float(keep.mean())

rows = []
skipped = 0
for foot in foots:
    lat0 = sum(p[0] for p in foot) / len(foot); lon0 = sum(p[1] for p in foot) / len(foot)
    k = math.cos(math.radians(lat0))  # Web Mercator metres -> real metres
    poly = np.array([merc(a, b) for a, b in foot])
    bx0, by0 = poly.min(0); bx1, by1 = poly.max(0)
    ids = near(bx0 - 12, by0 - 12, bx1 + 12, by1 + 12)
    if not len(ids): skipped += 1; continue
    px, py, pz, pc = X[ids], Y[ids], Z[ids], C[ids]
    path = Path(poly)
    inpoly = path.contains_points(np.column_stack([px, py]))
    inside = inpoly & (pc == 6)
    ring = (pc == 2) & ~inpoly
    area = abs(np.sum(poly[:-1, 0] * poly[1:, 1] - poly[1:, 0] * poly[:-1, 1])) / 2 * k * k
    if inside.sum() < max(12, area * 0.4) or ring.sum() < 4: skipped += 1; continue
    ground = float(np.median(pz[ring]))
    rel = pz[inside] - ground
    sel = (rel > 1.5) & (rel < 200)
    zx, zy, zz = px[inside][sel], py[inside][sel], rel[sel]
    if len(zz) < 12: skipped += 1; continue
    top = float(np.percentile(zz, 97))
    # the roof in the building's own frame: u along the long side, v across
    mr = min_rect(poly)
    _, u, v, a0, a1, b0, b1 = mr
    U = (np.column_stack([zx, zy]) @ u - (a0 + a1) / 2) * k
    V = (np.column_stack([zx, zy]) @ v - (b0 + b1) / 2) * k
    L, Wd = (a1 - a0) * k, (b1 - b0) * k
    if Wd > L: U, V, L, Wd, u, v = V, U, Wd, L, v, u
    dl = np.clip(Wd / 2 - np.abs(V), 0, None)   # to the long eaves: a ridge along the long axis
    ds = np.clip(L / 2 - np.abs(U), 0, None)    # to the short eaves: a ridge along the short axis
    dm = np.minimum(dl, ds)
    fits = {}
    fits['flat'] = lsq([], zz)
    fits['gable_l'] = lsq([dl], zz)
    fits['gable_s'] = lsq([ds], zz)
    rise = top - float(np.percentile(zz, 8))
    gl, gs = fits['gable_l'], fits['gable_s']
    long_ridge = gl[1] <= gs[1] * 1.08 or L / max(Wd, 0.1) > 1.6
    d_eave, d_end, half, endhalf = (dl, ds, Wd / 2, L / 2) if long_ridge else (ds, dl, L / 2, Wd / 2)
    g = gl if long_ridge else gs
    eave, k = g[0][1], g[0][0]
    form = 'gable'
    setback = 0.0
    if rise < 0.9 or k < 0.12 or fits['flat'][1] < 0.35:
        form = 'flat'
    else:
        # hip or gable: how far short of the main roof's ends does the ridge stop? A gable's ridge runs to the
        # gable walls; a hip's stops about half the house's width short of each end. Only the main roof counts
        # (points above its eave), so low porch roofs at the ends don't read as hips.
        t_along = U if long_ridge else V
        main = zz > eave + 0.3
        high = zz > eave + 0.75 * max(0.5, k * half)
        setback = 0.0
        if main.sum() >= 10 and high.sum() >= 5:
            E = np.percentile(t_along[main], 98) - np.percentile(t_along[main], 2)
            Hx = np.percentile(t_along[high], 98) - np.percentile(t_along[high], 2)
            setback = (E - Hx) / 2 / max(0.5, half)
        hp = lsq([dm], zz)
        if setback > 0.55 and hp[1] < g[1] * 1.1:
            form = 'hip'; eave = hp[0][1]; k = hp[0][0]
        # a gambrel's slope breaks: steep low, shallow high; a mansard is steep sides under a flat top
        kn = 0.22 * half * 2
        gb = lsq([np.minimum(d_eave, kn), np.clip(d_eave - kn, 0, None)], zz)
        if False and form == 'gable' and gb[1] < g[1] * 0.85 and gb[0][0] > 1.5 * max(gb[0][1], 0.05) and gb[0][0] > 0.8:
            form = 'gambrel'; eave = gb[0][2]
        km = min(1.6, 0.25 * Wd)
        ms = lsq([np.minimum(dm, km), np.clip(dm - km, 0, None)], zz)
        if False and ms[1] < min(g[1], fits['flat'][1]) * 0.8 and ms[0][0] > 1.0 and abs(ms[0][1]) < 0.25:
            form = 'mansard'; eave = ms[0][2]
    if form == 'flat': eave = top
    eave = float(min(max(eave, 1.8), top))
    ax = u if long_ridge else v
    # the ridge itself: the line the highest roof points make (the main block's ridge, even on an L- or
    # T-shaped house whose footprint's long axis runs the other way)
    hi = zz > top - 0.35
    if hi.sum() >= 6:
        P2 = np.column_stack([zx[hi], zy[hi]]); P2 = P2 - P2.mean(0)
        ev, evec = np.linalg.eigh(np.cov(P2.T))
        if ev[1] > 4 * max(ev[0], 1e-6):
            ax = evec[:, 1]
    bearing = (math.degrees(math.atan2(ax[0], ax[1])) + 180) % 180
    best = {'flat': fits['flat'], 'gable': g}.get(form, g)
    q = max(0.0, 1 - best[1] / max(0.5, rise if form != 'flat' else 1.5)) * min(1.0, best[2] / 0.7)
    code = {'flat': 0, 'gable': 1, 'hip': 2, 'gambrel': 3, 'mansard': 4}[form]
    rows.append([round(lat0 * 1e5), round(lon0 * 1e5), round(eave * 10), round(top * 10), code, round(bearing), round(q * 100), round(setback * 100)])
print(len(rows), 'roofs fitted,', skipped, 'skipped')
import collections
print('forms', collections.Counter(FORMS[r[4]] for r in rows))
data = {'v': 1, 'fetched': datetime.date.today().isoformat(), 'source': 'USGS 3DEP lidar, 2021 Central Eastern Massachusetts (QL1)',
        'cols': ['lat1e5', 'lon1e5', 'eave_dm', 'top_dm', 'form', 'ridge_bearing', 'quality', 'hip_setback'], 'forms': FORMS, 'rows': rows}
with gzip.open(OUT, 'wt', compresslevel=9) as f: json.dump(data, f, separators=(',', ':'))
print('->', os.path.relpath(OUT), os.path.getsize(OUT) // 1024, 'kB')
