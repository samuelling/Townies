# Ground cover for the whole map at 4 m (a quarter of a game tile): lawn and planting, pavement, bare
# ground, water, artificial turf and sport courts, roofs and tree canopy, so the map can draw real
# driveways, parking lots and pools instead of uniform lawn.
#
# Inputs:
#   work/<service>/18/<y>/<x>  MassGIS 2025 aerial tiles, true colour and colour-infrared (fetch.py)
#   $LIDAR_WORK/points.bin, vegpoints.bin  the 2021 USGS lidar (tools/lidar/fetch.py; LIDAR_SET=veg)
# Output: data/ground.bin.gz = gzip of one line of JSON header + "\n" + w*h class bytes, row 0 north.
#
# Every 0.44 m aerial pixel gets a class from its colour and its "NDVI" (near-infrared vs red, from the
# colour-infrared tiles), plus the lidar for roofs and tree crowns; the 4 m cell takes the majority, except
# that a pool takes the cell when it covers 35% of it. The imagery was flown in spring 2025 before leaf-out,
# so lawns are greening and deciduous crowns are bare: the game draws its own trees (tools/trees/), so a cell
# under a crown carries the ground seen through the branches, and class 6 (canopy) is left only where the
# ground truly can't be seen: evergreen crowns, and deep shadow under a crown with no usable neighbours.
#   GROUND_DEBUG=1 also writes per-pixel arrays to work/ for the validation renders (validate.py)
import gzip, json, math, os, sys, time, datetime
import numpy as np
from scipy import ndimage
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..', '..')
WORK = os.environ.get('GROUND_WORK', os.path.join(HERE, 'work'))
LW = os.environ.get('LIDAR_WORK', os.path.join(HERE, '..', 'lidar', 'work'))
OUT = os.path.join(ROOT, 'data', 'ground.bin.gz')
sys.path.insert(0, HERE)
import fetch  # noqa: E402  (bbox, tile range, services)

BB = fetch.BBOX
LATMID = (BB['s'] + BB['n']) / 2
KX = math.cos(math.radians(LATMID)) * 111320 / 16
KY = 110574 / 16
W = math.ceil((BB['e'] - BB['w']) * KX); H = math.ceil((BB['n'] - BB['s']) * KY)
C = 4                 # cells per tile edge
CW, CH = W * C, H * C  # 1648 x 988
L = 16                # lidar grid: 1 m (16 per tile edge)
LWD, LHT = W * L, H * L
CLASSES = ['grass', 'paved', 'bare', 'water', 'turf', 'roof', 'canopy']
GRASS, PAVED, BARE, WATER, TURF, ROOF, CANOPY = range(7)
SHADOW = 7            # per-pixel only: too dark to call, left to the cell's other pixels or its neighbours
NODATA = 255
Z = fetch.Z

def fresh(cache, sources):
    """A cached intermediate is reused only while it is newer than everything it was made from."""
    return os.path.exists(cache) and all(not os.path.exists(s) or os.path.getmtime(s) < os.path.getmtime(cache) for s in sources)

def merc_lonlat(mx, my):
    return mx * 180 / 20037508.34, np.degrees(2 * np.arctan(np.exp(my / 6378137)) - np.pi / 2)

# ---------------------------------------------------------------- lidar: roofs and crowns on a 1 m grid
def lidar_grids():
    cache = os.path.join(WORK, 'lidar_grids.npz')
    if fresh(cache, [os.path.join(LW, 'points.bin'), os.path.join(LW, 'vegpoints.bin')]):
        z = np.load(cache); return z['bld'], z['veg'], z['pen']
    t0 = time.time()
    dt = [('x', '<i4'), ('y', '<i4'), ('z', '<i4'), ('c', 'u1')]
    pts = np.memmap(os.path.join(LW, 'points.bin'), dtype=dt, mode='r')
    veg = np.memmap(os.path.join(LW, 'vegpoints.bin'), dtype=dt, mode='r')
    def grid_ij(a, res):
        lon, lat = merc_lonlat(a['x'] / 100.0, a['y'] / 100.0)
        return np.floor((lon - BB['w']) * KX * res).astype(np.int32), np.floor((BB['n'] - lat) * KY * res).astype(np.int32)
    CH_ = 4_000_000
    # ground: lowest ground return in each 4 m cell, gaps (under buildings, water) from the nearest cell
    dtm = np.full((CH, CW), np.inf, np.float32)
    for k in range(0, len(pts), CH_):
        a = np.asarray(pts[k:k + CH_]); a = a[a['c'] == 2]
        i, j = grid_ij(a, C); ok = (i >= 0) & (j >= 0) & (i < CW) & (j < CH)
        np.minimum.at(dtm, (j[ok], i[ok]), a['z'][ok] / 100.0)
    miss = ~np.isfinite(dtm)
    idx = ndimage.distance_transform_edt(miss, return_distances=False, return_indices=True)
    dtm = dtm[tuple(idx)]
    # 4 m minimum is biased low on slopes and kerbs; a 3x3 median of it is a steadier ground level
    dtm = ndimage.median_filter(dtm, 3)
    def heights(arr, cls_ok, cnt=None, w=1.0):
        g = np.zeros((LHT, LWD), np.float32)
        for k in range(0, len(arr), CH_):
            a = np.asarray(arr[k:k + CH_]); a = a[cls_ok(a['c'])]
            i, j = grid_ij(a, L); ok = (i >= 0) & (j >= 0) & (i < LWD) & (j < LHT)
            i, j, zz = i[ok], j[ok], a['z'][ok] / 100.0
            h = zz - dtm[j // (L // C), i // (L // C)]
            np.maximum.at(g, (j, i), h.astype(np.float32))
            if cnt is not None: np.add.at(cnt, (j, i), w)
        return g
    gcnt = np.zeros((LHT, LWD), np.float32); vcnt = np.zeros((LHT, LWD), np.float32)
    bld = heights(pts, lambda c: c == 6)
    heights(pts, lambda c: c == 2, gcnt, 4.0)  # ground returns were thinned one in four
    vg = heights(veg, lambda c: c >= 3, vcnt)
    vg = heights(veg, lambda c: c >= 4)
    # how much of the laser got through to the ground (5 m window), as in tools/trees/fit.py: in a leaf-off
    # spring flight plenty gets through a maple or an oak, very little through a pine or a spruce
    gs, vs = ndimage.uniform_filter(gcnt, 5), ndimage.uniform_filter(vcnt, 5)
    pen = gs / np.maximum(gs + vs, 1e-3)
    os.makedirs(WORK, exist_ok=True)
    np.savez(cache, bld=bld.astype(np.float16), veg=vg.astype(np.float16), pen=pen.astype(np.float16))
    print(f'lidar grids {time.time() - t0:.0f} s', flush=True)
    return bld.astype(np.float16), vg.astype(np.float16), pen.astype(np.float16)

# ---------------------------------------------------------------- OpenStreetMap: water bodies and buildings
def osm_grids():
    """Water bodies (ponds, reservoirs, the Charles) and building footprints from the game's own OSM
    snapshot (data/watertown.json.gz), rasterised on the 1 m lidar grid."""
    cache = os.path.join(WORK, 'osm_grids.npz')
    if fresh(cache, [os.path.join(ROOT, 'data', 'watertown.json.gz')]):
        z = np.load(cache); return z['water'], z['bld']
    from PIL import ImageDraw
    d = json.load(gzip.open(os.path.join(ROOT, 'data', 'watertown.json.gz'), 'rt'))
    def pts(flat):
        a = np.cumsum(np.asarray(flat[0::2], np.float64)) / 1e6; b = np.cumsum(np.asarray(flat[1::2], np.float64)) / 1e6
        return np.stack([(b - BB['w']) * KX * L, (BB['n'] - a) * KY * L], 1)
    def is_water(t): return t.get('natural') == 'water' or t.get('waterway') == 'riverbank' or t.get('landuse') in ('reservoir', 'basin')
    out = {}
    for kind, test in (('water', is_water), ('bld', lambda t: 'building' in t)):
        im = Image.new('L', (LWD, LHT), 0); dr = ImageDraw.Draw(im)
        for t, p in d['ways']:
            if not test(t) or len(p) < 6: continue
            q = pts(p)
            if np.abs(q[0] - q[-1]).max() > 0.5: continue  # not a closed ring (a member of a relation)
            dr.polygon([tuple(v) for v in q], fill=1)
        g = np.asarray(im).copy()
        # multipolygon relations: even-odd fill over all member segments (rings may be split across ways)
        for t, mem in d['rels']:
            if not test(t): continue
            segs = []
            for role, flat in mem:
                q = pts(flat)
                if len(q) > 1: segs.append(np.concatenate([q[:-1], q[1:]], 1))
            if not segs: continue
            S = np.concatenate(segs)
            y0 = max(int(np.floor(S[:, [1, 3]].min())), 0); y1 = min(int(np.ceil(S[:, [1, 3]].max())), LHT)
            ya, yb = np.minimum(S[:, 1], S[:, 3]), np.maximum(S[:, 1], S[:, 3])
            for j in range(y0, y1):
                yc = j + 0.5
                m = (ya <= yc) & (yb > yc)
                if not m.any(): continue
                s = S[m]; xs = np.sort(s[:, 0] + (yc - s[:, 1]) * (s[:, 2] - s[:, 0]) / (s[:, 3] - s[:, 1]))
                for xa, xb in zip(xs[0::2], xs[1::2]):
                    a, b = max(int(np.ceil(xa - 0.5)), 0), min(int(np.floor(xb - 0.5)) + 1, LWD)
                    if b > a: g[j, a:b] ^= 1
        out[kind] = g.astype(bool)
    np.savez_compressed(cache, **out)
    return out['water'], out['bld']

# ---------------------------------------------------------------- imagery mosaics
def mosaic(svc):
    x0, x1, y0, y1 = fetch.tile_range()
    out = np.zeros(((y1 - y0 + 1) * 256, (x1 - x0 + 1) * 256, 3), np.uint8)
    have = np.zeros(out.shape[:2], bool)
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            p = fetch.path(svc, Z, y, x)
            if not os.path.exists(p) or os.path.getsize(p) == 0: continue
            im = Image.open(p)
            a = np.asarray(im.convert('RGBA'))
            sl = (slice((y - y0) * 256, (y - y0 + 1) * 256), slice((x - x0) * 256, (x - x0 + 1) * 256))
            out[sl] = a[..., :3]; have[sl] = a[..., 3] > 0
    return out, have

def pixel_geometry():
    """Per mosaic column / row: the game-grid x and y (in tiles) of the pixel centre. The two are separable
    because both projections are rectangular in lon and in lat."""
    x0, x1, y0, y1 = fetch.tile_range()
    n = 2 ** Z * 256
    cols = np.arange((x1 - x0 + 1) * 256); rows = np.arange((y1 - y0 + 1) * 256)
    lon = (x0 * 256 + cols + 0.5) / n * 360 - 180
    lat = np.degrees(np.arctan(np.sinh(np.pi * (1 - 2 * (y0 * 256 + rows + 0.5) / n))))
    return (lon - BB['w']) * KX, (BB['n'] - lat) * KY

# ---------------------------------------------------------------- per-pixel classification
# Thresholds are empirical (the tiles are JPEG and contrast-stretched, so these are not reflectances),
# tuned against side-by-side renders of the imagery and the result.
T = dict(
    ndvi_veg=0.11,      # near-infrared over red above this: living (or greening) vegetation
    ndvi_veg_dark=0.18,  # ... in shadow, where the ratio is noisier
    ngvi_veg=0.12,      # and near-infrared over green above this (tells grass from plastic turf)
    dark=55,            # mean RGB below this is shadow
    canopy_h=3.0,       # lidar crown height (m) for tree canopy
    roof_h=2.0,         # lidar building return height (m) for a roof
    pool_min=8, pool_max=3000,   # m^2: a pool-coloured patch outside these is something else
    evergreen_pen=0.08,  # lidar ground penetration below this under a green crown: an evergreen
    evergreen_ndvi=0.35, evergreen_br=100,  # or a dark, strongly green crown seen in the imagery itself
    pond_min=200,       # m^2: smallest unmapped pond or cove
    turf_min=120,       # m^2: turf fields and courts are big; green cars and tarps are not
    new_roof_max=150,   # m^2: a lidar building with no OSM footprint is kept only if shed-sized
)
PX_M2 = (2 * math.pi * 6378137 / 2 ** Z / 256 * math.cos(math.radians(LATMID))) ** 2  # ground area of a pixel

def features(rgb, cir):
    R, G, B = (rgb[..., k].astype(np.float32) for k in range(3))
    N, r2 = cir[..., 0].astype(np.float32), cir[..., 1].astype(np.float32)
    return R, G, B, N, (N - r2) / (N + r2 + 1.0), (R + G + B) / 3

def classify_ground(rgb, cir):
    """Ground classes from the imagery alone, before roofs and crowns. Returns class, pool and turf masks."""
    R, G, B, N, ndvi, br = features(rgb, cir)
    g2 = cir[..., 2].astype(np.float32)
    # near-infrared over the green band: living leaves reflect far more NIR than green (0.2-0.45 here);
    # green-dyed plastic turf reflects green about as much as NIR (~0.05), though its NDVI looks leafy
    ngvi = (N - g2) / (N + g2 + 1.0)
    mx = np.maximum(np.maximum(R, G), B); mn = np.minimum(np.minimum(R, G), B)
    sat = (mx - mn) / (mx + 1.0)
    dark = br < T['dark']
    veg = np.where(dark, ndvi > T['ndvi_veg_dark'], ndvi > T['ndvi_veg']) & (ngvi > T['ngvi_veg']) & (B < np.maximum(R, G) + 8)
    cls = np.full(R.shape, PAVED, np.uint8)
    # bare ground: warm (red over blue), brighter than asphalt, not vegetated
    # (brick sidewalks and warm concrete are close: those are narrow, bare patches get an opening below)
    cls[(~veg) & (R - B > 20) & (br > 95) & (sat > 0.135)] = BARE
    cls[veg] = GRASS
    cls[dark & ~veg] = SHADOW
    # pools (open or under a winter cover, the imagery is from April): teal-cyan, and the water or the
    # cover soaks up near-infrared, where blue sport courts and tarps reflect it. Shadows are blue too
    # (skylight), but darker.
    pool = (G - R >= 18) & (B - R >= 22) & (B - G >= -8) & (B - G <= 16) & (N < 0.75 * br) & (ndvi < 0.25) & (br > 82)
    # artificial turf (green but not alive), blue acrylic courts, red-pink running tracks
    turf = (~veg) & (~pool) & (
        ((G > R + 8) & (G > B + 6) & (ngvi < T['ngvi_veg']) & (br > 60)) |
        ((B - R >= 30) & (B - G >= 10) & (N >= 0.8 * br)) |
        ((R - G >= 28) & (R - B >= 35) & (B >= G - 12) & (br > 90)))
    return cls, pool, turf

def components(mask, amin, amax):
    """Keep the connected patches of a mask whose area (m^2) is within [amin, amax]."""
    lab, n = ndimage.label(mask)
    if n == 0: return mask
    area = np.bincount(lab.ravel()) * PX_M2
    ok = (area >= amin) & (area <= amax); ok[0] = False
    return ok[lab]

def main():
    t0 = time.time()
    bld, vegh, pen = lidar_grids()
    owater, obld = osm_grids()
    # lidar roofs: close the 1 m speckle (two or three returns per square metre)
    lroof = ndimage.binary_closing(bld.astype(np.float32) >= T['roof_h'], np.ones((3, 3), bool), border_value=0) | (bld.astype(np.float32) >= T['roof_h'])
    # a lidar building with no OSM footprint nearby is a shed or garage OSM missed, or a building torn
    # down since 2021; keep it only if it is shed-sized. An OSM footprint with no lidar under it is a
    # building put up since 2021 (Arsenal Yards, Pleasant St...).
    near = ndimage.binary_dilation(obld, iterations=3)
    lonly = lroof & ~near
    lab, n = ndimage.label(lonly); area = np.bincount(lab.ravel()); okc = area <= T['new_roof_max']; okc[0] = False
    roof1 = (lroof & near) | okc[lab]
    del lab
    # crowns: the leaf-off returns are sparse; a 3 m grey closing fills them in
    vh = ndimage.grey_closing(vegh.astype(np.float32), size=(3, 3))
    canopy1 = vh >= T['canopy_h']
    print(f'lidar + osm ready {time.time() - t0:.0f} s', flush=True)
    rgb, have1 = mosaic(fetch.SERVICES[0])
    cir, have2 = mosaic(fetch.SERVICES[1])
    have = have1 & have2; del have1, have2
    gx, gy = pixel_geometry()
    ci = np.floor(gx * C).astype(np.int64); cj = np.floor(gy * C).astype(np.int64)
    li = np.clip(np.floor(gx * L).astype(np.int64), 0, LWD - 1); lj = np.clip(np.floor(gy * L).astype(np.int64), 0, LHT - 1)
    cols = np.nonzero((ci >= 0) & (ci < CW))[0]; rows = np.nonzero((cj >= 0) & (cj < CH))[0]
    c0, c1, r0_, r1_ = cols[0], cols[-1] + 1, rows[0], rows[-1] + 1
    rgb = rgb[r0_:r1_, c0:c1]; cir = cir[r0_:r1_, c0:c1]; have = have[r0_:r1_, c0:c1]
    ci, li = ci[c0:c1], li[c0:c1]; cj, lj = cj[r0_:r1_], lj[r0_:r1_]
    print(f'mosaics {rgb.shape} {time.time() - t0:.0f} s', flush=True)
    hh, ww = rgb.shape[:2]
    cls = np.empty((hh, ww), np.uint8); pool = np.empty((hh, ww), bool); turf = np.empty((hh, ww), bool)
    canc = np.zeros((hh, ww), bool)
    STRIP = 512
    for a in range(0, hh, STRIP):
        b = min(a + STRIP, hh)
        cls[a:b], pool[a:b], turf[a:b] = classify_ground(rgb[a:b], cir[a:b])
    # pools and turf are judged as patches: big enough to be one, small enough not to be a lake or a roof
    def lid(grid, a, b): return grid[lj[a:b]][:, li]
    # (not on or against a roof: a leaning roof edge in the imagery lands outside its lidar footprint)
    roofnear = ndimage.binary_dilation(roof1 | obld, iterations=2)
    for a in range(0, hh, STRIP):
        b = min(a + STRIP, hh)
        w = lid(owater, a, b)
        pool[a:b] &= ~lid(roofnear, a, b) & ~w; turf[a:b] &= ~lid(roof1 | obld, a, b) & ~w
    del roofnear
    pool = ndimage.binary_opening(pool, np.ones((3, 3), bool))
    # judged as a whole patch: a pool (or its cover) is teal and dark in near-infrared; blue courts and
    # playground surfaces are bluer and brighter in near-infrared
    lab, n = ndimage.label(pool)
    if n:
        sums = np.zeros((3, n + 1))
        for a in range(0, hh, STRIP):
            b = min(a + STRIP, hh); l = lab[a:b]; m = l > 0
            if not m.any(): continue
            R, G, B, N, ndvi, br = features(rgb[a:b], cir[a:b])
            sums[0] += np.bincount(l[m], minlength=n + 1)
            sums[1] += np.bincount(l[m], weights=(B - G)[m], minlength=n + 1)
            sums[2] += np.bincount(l[m], weights=(N / np.maximum(br, 1))[m], minlength=n + 1)
        cnt = np.maximum(sums[0], 1); area = sums[0] * PX_M2
        ok = (area >= T['pool_min']) & (area <= T['pool_max']) & (sums[1] / cnt <= 11) & (sums[2] / cnt <= 0.67)
        ok[0] = False
        pool = ok[lab]
    del lab
    turf = components(turf, T['turf_min'], 1e9)
    # open water OSM doesn't map (marinas, coves, new ponds): very dark in near-infrared, in big patches
    # (shadows are rarely that dark in NIR, and never for long)
    dw = np.empty((hh, ww), bool)
    for a in range(0, hh, STRIP):
        b = min(a + STRIP, hh)
        R, G, B, N, ndvi, br = features(rgb[a:b], cir[a:b])
        dw[a:b] = (N < 45) & (N < 0.5 * br) & (ndvi < 0.05) & (B >= R) & ~lid(roof1 | obld, a, b)
    dw = components(ndimage.binary_opening(dw, np.ones((5, 5), bool)), T['pond_min'], 1e12)
    cls[turf] = TURF; cls[dw] = WATER; cls[pool] = WATER
    del dw
    # bare ground comes in patches; a strip under ~2 m wide is a brick sidewalk or a kerb, so paved
    for a in range(0, hh, STRIP):
        b = min(a + STRIP, hh); pa, pb = max(a - 8, 0), min(b + 8, hh)
        bare = cls[pa:pb] == BARE
        thin = bare & ~ndimage.binary_opening(bare, np.ones((5, 5), bool))
        cls[a:b][thin[a - pa:a - pa + (b - a)]] = PAVED
    print(f'pixels classified {time.time() - t0:.0f} s', flush=True)
    for a in range(0, hh, STRIP):
        b = min(a + STRIP, hh); c = cls[a:b]
        veg = (c == GRASS)
        R, G, B, N, ndvi, br = features(rgb[a:b], cir[a:b])
        # mapped water bodies: water unless something stands in or over it
        w = lid(owater, a, b) & ~veg & (c != TURF)
        c[w] = WATER
        # roofs: lidar (with OSM's say on what has been built or torn down since), and OSM footprints of
        # new buildings where the imagery shows no vegetation (the game draws its own trees, so a roof
        # stays a roof under an overhanging crown)
        roof = lid(roof1, a, b) | (lid(obld, a, b) & ~veg)
        c[roof] = ROOF
        # under a crown the cell keeps the ground the April imagery sees through the bare branches. Only an
        # evergreen crown hides it: green in the imagery, and the laser barely got through it (or dark,
        # strongly green foliage). Deep shadow under a crown stays unknown and is settled per cell below.
        under = lid(canopy1, a, b) & ~roof
        ever = under & veg & ((lid(pen, a, b) < T['evergreen_pen']) |
                              ((ndvi > T['evergreen_ndvi']) & (br < T['evergreen_br'])))
        c[ever] = CANOPY
        c[~have[a:b]] = NODATA
        canc[a:b] = under
    del rgb, cir
    print(f'roofs and crowns {time.time() - t0:.0f} s', flush=True)
    NC = SHADOW + 1
    counts = np.zeros((CH * CW, NC), np.int32)
    poolc = np.zeros(CH * CW, np.int32); undc = np.zeros(CH * CW, np.int32)
    for a in range(0, hh, STRIP):
        b = min(a + STRIP, hh)
        c = cls[a:b]; ok = c != NODATA
        cell = (cj[a:b, None] * CW + ci[None, :])
        counts += np.bincount((cell[ok] * NC + c[ok]).ravel(), minlength=CH * CW * NC).reshape(-1, NC).astype(np.int32)
        pm = ok & pool[a:b] & (c == WATER)
        poolc += np.bincount(cell[pm].ravel(), minlength=CH * CW).astype(np.int32)
        undc += np.bincount(cell[ok & canc[a:b]].ravel(), minlength=CH * CW).astype(np.int32)
    if os.environ.get('GROUND_DEBUG'):
        np.save(os.path.join(WORK, 'pixcls.npy'), cls)
        json.dump({'r0': int(r0_), 'c0': int(c0)}, open(os.path.join(WORK, 'pixcls.json'), 'w'))
    del cls, pool, turf, canc
    tot = counts.sum(1)
    known = counts[:, :SHADOW]; nknown = known.sum(1)
    out = np.argmax(known, 1).astype(np.uint8)
    out[nknown == 0] = NODATA
    # a cell that is mostly shadow: its few visible pixels are a weak guess; let the neighbours weigh in
    unsure = (nknown < 0.25 * np.maximum(tot, 1)) & (tot > 0)
    # pools are small and they matter: one takes the cell at 35%
    out[(poolc >= 0.35 * np.maximum(tot, 1)) & (tot > 0)] = WATER
    out = out.reshape(CH, CW); unsure = unsure.reshape(CH, CW)
    crown = (undc >= 0.5 * np.maximum(tot, 1)).reshape(CH, CW)
    out = cleanup(out, unsure, crown)
    write(out)
    print(f'done {time.time() - t0:.0f} s', flush=True)

def mode_filter(a, size=3):
    """Most common class in each size x size window (ties keep the centre)."""
    n = len(CLASSES)
    best = a.copy(); bestc = np.zeros(a.shape, np.int32)
    for k in range(n):
        c = ndimage.uniform_filter((a == k).astype(np.float32), size) * size * size
        c = np.rint(c).astype(np.int32) + (a == k)  # centre counts a little extra: ties keep it
        m = c > bestc
        best[m] = k; bestc[m] = c[m]
    return best, bestc

def cleanup(out, unsure, crown):
    # shadow-dominated cells and no-data inside the map: their neighbours' majority
    for _ in range(4):
        fill = unsure | (out == NODATA)
        if not fill.any(): break
        src = np.where(fill, NODATA, out)
        best, bc = mode_filter(src, 3)
        upd = fill & (bc > 1) & (best != NODATA)
        out = np.where(upd, best, out); unsure = unsure & ~upd
    # still unknown with nothing usable around: a crown if the lidar has one there, otherwise the nearest
    # known cell
    left = unsure | (out == NODATA)
    out = np.where(left & crown, CANOPY, out)
    left &= ~crown
    if left.any():
        idx = ndimage.distance_transform_edt(left | (out == NODATA), return_distances=False, return_indices=True)
        out = np.where(left | (out == NODATA), out[tuple(idx)], out)
    # salt and pepper: a cell with no neighbour of its own class joins the majority around it, and so does
    # a cell with just one unless it is pavement (a one-cell driveway or path, which must survive) or water
    best, bc = mode_filter(out, 3)
    same = np.zeros(out.shape, np.int32)
    p = np.pad(out, 1, mode='edge')
    for dj in (-1, 0, 1):
        for di in (-1, 0, 1):
            if dj == 0 and di == 0: continue
            same += (p[1 + dj:1 + dj + out.shape[0], 1 + di:1 + di + out.shape[1]] == out)
    lone = (((same == 0) & (bc >= 5)) | ((same == 1) & (bc >= 6) & (out != PAVED))) & (out != WATER)
    out = np.where(lone, best, out)
    return out

def write(out):
    hdr = {'v': 1, 'fetched': datetime.date.today().isoformat(),
           'source': 'MassGIS 2025 aerial imagery (RGB + CIR) and USGS 3DEP lidar (2021)',
           'w': CW, 'h': CH, 'cell_tiles': 1 / C, 'bbox': {k: BB[k] for k in ('s', 'n', 'w', 'e')}, 'classes': CLASSES}
    raw = (json.dumps(hdr, separators=(',', ':')) + '\n').encode() + out.astype(np.uint8).tobytes()
    with open(OUT, 'wb') as f: f.write(gzip.compress(raw, compresslevel=9))
    fr = np.bincount(out.ravel(), minlength=256)
    print('->', os.path.relpath(OUT), os.path.getsize(OUT) // 1024, 'kB;',
          ', '.join(f'{n} {fr[k] / out.size:.1%}' for k, n in enumerate(CLASSES)), f'nodata {fr[NODATA] / out.size:.2%}', flush=True)

if __name__ == '__main__':
    main()
