# Every tree in the map, from the 2021 lidar's vegetation returns, with species where Watertown Forestry's
# 2022 inventory has the tree. Writes data/trees.json.gz:
#   rows [lat*1e5, lon*1e5, height dm, crown radius dm, kind, species index (-1 none), dbh in, condition]
#   kind: 0 broadleaf, 1 evergreen (conifer), 2 flowering (cherry, pear, crabapple, lilac, redbud...)
# Evergreens are told from broadleaf trees by how much the laser hit: the survey was flown in early spring,
# before leaf-out, when only conifers have a full crown.
import gzip, json, math, os, datetime, collections
import numpy as np
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..', '..')
LW = os.environ.get('LIDAR_WORK', os.path.join(HERE, '..', 'lidar', 'work'))
TW = os.environ.get('TREES_WORK', os.path.join(HERE, 'work'))
OUT = os.path.join(ROOT, 'data', 'trees.json.gz')
CELL = 1.0  # metres (real), canopy height model resolution

def merc(lat, lon):
    return lon * 20037508.34 / 180, math.log(math.tan((90 + lat) * math.pi / 360)) * 6378137
def unmerc(x, y):
    return math.degrees(2 * math.atan(math.exp(y / 6378137)) - math.pi / 2), x * 180 / 20037508.34

dt = [('x', '<i4'), ('y', '<i4'), ('z', '<i4'), ('c', 'u1')]
veg = np.fromfile(os.path.join(LW, 'vegpoints.bin'), dtype=dt)
pts = np.fromfile(os.path.join(LW, 'points.bin'), dtype=dt)
gnd = pts[pts['c'] == 2]
k = math.cos(math.radians(42.372))  # Web Mercator -> real metres
gx0 = min(veg['x'].min(), gnd['x'].min()) / 100; gy0 = min(veg['y'].min(), gnd['y'].min()) / 100
step = CELL / k  # one cell in Web Mercator metres
def ij(a):
    return ((a['x'] / 100 - gx0) / step).astype(np.int64), ((a['y'] / 100 - gy0) / step).astype(np.int64)
ni = int(max(veg['x'].max(), gnd['x'].max()) / 100 - gx0) // int(step) + 2
nj = int((max(veg['y'].max(), gnd['y'].max()) / 100 - gy0) / step) + 2
ni = int((max(veg['x'].max(), gnd['x'].max()) / 100 - gx0) / step) + 2
print('grid', ni, nj)

# ground: lowest return per 4 m block, gaps filled from the nearest known block
B = 4
gi, gj = ij(gnd)
dtm = np.full((ni // B + 1, nj // B + 1), np.nan)
np.fmin.at(dtm, (gi // B, gj // B), gnd['z'] / 100)
mask = np.isnan(dtm)
idx = ndimage.distance_transform_edt(mask, return_distances=False, return_indices=True)
dtm = dtm[tuple(idx)]

# canopy height model: the highest vegetation return in each cell, above the ground
vi, vj = ij(veg)
hz = veg['z'] / 100 - dtm[vi // B, vj // B]
ok = (hz > 2) & (hz < 45) & (veg['c'] >= 4)
chm = np.zeros((ni, nj), np.float32)
np.maximum.at(chm, (vi[ok], vj[ok]), hz[ok])
cnt = np.zeros((ni, nj), np.float32)
np.add.at(cnt, (vi[ok], vj[ok]), 1)
chm_s = ndimage.gaussian_filter(chm, 1.0)
cnt_s = ndimage.uniform_filter(cnt, 5)
# how much of the laser got through to the ground under a crown: in a leaf-off spring flight, plenty under
# a maple or an oak, very little under a pine or a spruce
gc = np.zeros((ni, nj), np.float32)
np.add.at(gc, (gi, gj), 4.0)  # ground returns were thinned one in four
allv = np.zeros((ni, nj), np.float32)
np.add.at(allv, (vi, vj), 1)
pen_s = ndimage.uniform_filter(gc, 5) / np.maximum(ndimage.uniform_filter(gc, 5) + ndimage.uniform_filter(allv, 5), 1e-3)

# tree tops: local maxima over a window that grows with height
tops = []
mx5 = ndimage.maximum_filter(chm_s, size=5)
mx9 = ndimage.maximum_filter(chm_s, size=9)
cand = (chm_s >= 4.0) & (((chm_s >= mx5) & (chm_s < 12)) | ((chm_s >= mx9) & (chm_s >= 12)))
ci, cj = np.nonzero(cand)
print(len(ci), 'tree tops')
# crown radius: how far, on average over 8 directions, until the canopy falls below half the top's height
dirs = [(1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1)]
rows = []
for a, b in zip(ci, cj):
    h = float(chm_s[a, b]); rs = []
    for da, db in dirs:
        r = 0
        for s in range(1, 12):
            x, y = a + da * s, b + db * s
            if x < 0 or y < 0 or x >= ni or y >= nj or chm_s[x, y] < h * 0.5: break
            r = s * math.hypot(da, db)
        rs.append(r)
    rad = max(1.5, min(10.0, float(np.mean(rs)) + 0.5))
    dens = float(pen_s[a, b])
    mx = gx0 + (a + 0.5) * step; my = gy0 + (b + 0.5) * step
    lat, lon = unmerc(mx, my)
    rows.append([lat, lon, h, rad, dens])
print(len(rows), 'crowns')

# the inventory: species for the trees it covers
inv = json.load(open(os.path.join(TW, 'inventory.json')))
alive = [t for t in inv if t['status'] == 'Alive' and t['genus'] not in (None, 'NULL', '')]
species = []; sp_ix = {}
CONIFER = {'Pinus', 'Picea', 'Abies', 'Tsuga', 'Juniperus', 'Thuja', 'Taxus', 'Pseudotsuga', 'Chamaecyparis', 'Cupressus', 'Metasequoia', 'Larix', 'Cryptomeria'}
FLOWER = {'Prunus', 'Malus', 'Pyrus', 'Cercis', 'Cornus', 'Syringa', 'Amelanchier', 'Magnolia', 'Crataegus', 'Cladrastis', 'Koelreuteria', 'Styphnolobium', 'Aesculus'}
def kind_of(genus): return 1 if genus in CONIFER else 2 if genus in FLOWER else 0
COND = {'Excellent': 4, 'Good': 3, 'Fair': 2, 'Poor': 1, 'Critical': 0, 'Dead': 0}
from scipy.spatial import cKDTree
cx = np.array([merc(r[0], r[1]) for r in rows]) if rows else np.zeros((0, 2))
kd = cKDTree(cx * k)
used = set(); out = []
matched = {}
for t in alive:
    p = np.array(merc(t['lat'], t['lon'])) * k
    d, i = kd.query(p, k=3, distance_upper_bound=4.0)
    for dd, ii in zip(np.atleast_1d(d), np.atleast_1d(i)):
        if np.isfinite(dd) and ii not in used:
            used.add(ii); matched[ii] = t; break
    else:
        matched[('inv', id(t))] = t
def sp(t):
    name = t['commonname'] or t['genus']
    key = (name, t['scientific'], t['genus'])
    if key not in sp_ix: sp_ix[key] = len(species); species.append({'name': name, 'sci': t['scientific'], 'genus': t['genus']})
    return sp_ix[key]
# evergreen threshold from the inventory's own conifers vs broadleaf trees (leaf-off returns per cell)
dc = [rows[i][4] for i, t in matched.items() if isinstance(i, (int, np.integer)) and kind_of(t['genus']) == 1]
db = [rows[i][4] for i, t in matched.items() if isinstance(i, (int, np.integer)) and kind_of(t['genus']) != 1]
# Conifers are a small share of Watertown's trees, so a crown counts as evergreen only when the laser
# barely got through it: the cut lets through at most 4% of the inventory's broadleaf trees.
dcA, dbA = np.array(dc), np.array(db)
thr = float(np.percentile(dbA, 4)) if len(dbA) else 0.05
print('ground penetration: conifer median', np.median(dcA) if len(dcA) else None, 'broadleaf', np.median(dbA) if len(dbA) else None,
      '-> cut', round(thr, 3), 'catches', round(float(np.mean(dcA < thr)) if len(dcA) else 0, 2), 'of conifers')
for i, r in enumerate(rows):
    lat, lon, h, rad, dens = r
    t = matched.get(i)
    if t:
        kd_ = kind_of(t['genus']); si = sp(t); dbh = int(t['dbh'] or 0); cond = COND.get((t['condition'] or '').strip(), 3)
    else:
        kd_ = 1 if dens < thr else 0; si = -1; dbh = 0; cond = 3
    out.append([round(lat * 1e5), round(lon * 1e5), round(h * 10), round(rad * 10), kd_, si, dbh, cond])
# inventory trees the lidar didn't resolve (young street trees, mostly): sized from their trunks
for key, t in matched.items():
    if isinstance(key, tuple):
        dbh = float(t['dbh'] or 2)
        h = min(14, 2.5 + 0.55 * dbh); rad = min(6, 0.8 + 0.22 * dbh)
        out.append([round(t['lat'] * 1e5), round(t['lon'] * 1e5), round(h * 10), round(rad * 10), kind_of(t['genus']), sp(t), int(dbh), COND.get((t['condition'] or '').strip(), 3)])
print(len(out), 'trees in all;', sum(1 for o in out if o[5] >= 0), 'with species;', collections.Counter(o[4] for o in out))
data = {'v': 1, 'fetched': datetime.date.today().isoformat(),
        'source': 'USGS 3DEP lidar (2021) and Watertown Forestry 2022 tree inventory',
        'cols': ['lat1e5', 'lon1e5', 'height_dm', 'crown_dm', 'kind', 'species', 'dbh_in', 'condition'],
        'kinds': ['broadleaf', 'evergreen', 'flowering'], 'conditions': ['critical', 'poor', 'fair', 'good', 'excellent'],
        'species': species, 'rows': out}
with gzip.open(OUT, 'wt', compresslevel=9) as f: json.dump(data, f, separators=(',', ':'))
print('->', os.path.relpath(OUT), os.path.getsize(OUT) // 1024, 'kB')
