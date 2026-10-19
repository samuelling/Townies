# Fetch the 2021 USGS 3DEP lidar (QL1, "MA_CentralEastern_1_2021") for the map area from the public
# Entwine Point Tile copy on AWS, keeping only building (class 6) and ground (class 2) returns.
# Writes points.bin: little-endian records of int32 x, int32 y (EPSG:3857 centimetres), int32 z (cm), uint8 class.
import json, math, os, sys, io, struct, threading, urllib.request
from concurrent.futures import ThreadPoolExecutor
import numpy as np, laspy

BASE = 'https://s3-us-west-2.amazonaws.com/usgs-lidar-public/MA_CentralEastern_1_2021/'
OUT = os.environ.get('LIDAR_WORK', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'work'))
os.makedirs(OUT, exist_ok=True)
CROP = dict(s=42.3531, n=42.3915, w=-71.2244, e=-71.1327)
MAXD = int(os.environ.get('LIDAR_DEPTH', '10'))  # depths 0-10 add up to about 2.5 points per square metre

def merc(lat, lon):
    x = lon * 20037508.34 / 180
    y = math.log(math.tan((90 + lat) * math.pi / 360)) * 6378137
    return x, y
x0, y0 = merc(CROP['s'], CROP['w']); x1, y1 = merc(CROP['n'], CROP['e'])

def get(url, tries=5):
    for k in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=60) as r: return r.read()
        except Exception as e:
            err = e
    raise err

ept = json.loads(get(BASE + 'ept.json'))
B = ept['bounds']
def nbounds(d, x, y, z):
    w = (B[3] - B[0]) / 2 ** d
    return B[0] + x * w, B[1] + y * w, B[0] + (x + 1) * w, B[1] + (y + 1) * w
def hits(d, x, y):
    a, b, c, e = nbounds(d, x, y, 0)
    return not (c < x0 or a > x1 or e < y0 or b > y1)

nodes = []
def walk(hkey):
    h = json.loads(get(BASE + 'ept-hierarchy/' + hkey + '.json'))
    subs = []
    for key, n in h.items():
        d, x, y, z = map(int, key.split('-'))
        if d > MAXD or not hits(d, x, y): continue
        if n == -1: subs.append(key)
        elif n > 0: nodes.append(key)
    for s in subs: walk(s)
walk('0-0-0-0')
nodes = sorted(set(nodes), key=lambda k: int(k.split('-')[0]))
print(len(nodes), 'nodes to depth', MAXD, flush=True)

lock = threading.Lock()
# LIDAR_SET=veg keeps the vegetation returns (classes 3-5) instead, for finding trees (tools/trees/)
VEG = os.environ.get('LIDAR_SET') == 'veg'
out = open(os.path.join(OUT, 'vegpoints.bin' if VEG else 'points.bin'), 'wb')
stats = {'pts': 0, 'kept': 0, 'done': 0}
def job(key):
    data = get(BASE + 'ept-data/' + key + '.laz')
    las = laspy.read(io.BytesIO(data))
    c = np.asarray(las.classification)
    X, Y, Z = np.asarray(las.x), np.asarray(las.y), np.asarray(las.z)
    # every building return; one ground return in four (only the ground level around each building matters)
    keepg = (c == 2) & (np.arange(len(c)) % 4 == 0)
    keep = ((c == 3) | (c == 4) | (c == 5)) if VEG else ((c == 6) | keepg)
    m = keep & (X >= x0) & (X <= x1) & (Y >= y0) & (Y <= y1)
    rec = np.zeros(int(m.sum()), dtype=[('x', '<i4'), ('y', '<i4'), ('z', '<i4'), ('c', 'u1')])
    rec['x'] = np.round(X[m] * 100); rec['y'] = np.round(Y[m] * 100); rec['z'] = np.round(Z[m] * 100); rec['c'] = c[m]
    with lock:
        out.write(rec.tobytes())
        stats['pts'] += len(c); stats['kept'] += len(rec); stats['done'] += 1
        if stats['done'] % 200 == 0: print(stats, flush=True)
with ThreadPoolExecutor(12) as ex: list(ex.map(job, nodes))
out.close()
print('DONE', stats, flush=True)
