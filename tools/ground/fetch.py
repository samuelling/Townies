# Fetch MassGIS 2025 aerial imagery (true colour and colour-infrared) over the game map, as cached
# Web Mercator tiles from MassGIS's ArcGIS tile services. Tiles land in work/<service>/<z>/<y>/<x>
# (raw bytes, JPEG or PNG as served) so reruns only fetch what is missing.
#   python3 tools/ground/fetch.py            # zoom 18 (~0.44 m ground pixels at Watertown)
#   GROUND_ZOOM=19 python3 tools/ground/fetch.py
import math, os, sys, time, threading, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
WORK = os.environ.get('GROUND_WORK', os.path.join(HERE, 'work'))
Z = int(os.environ.get('GROUND_ZOOM', '18'))
BBOX = dict(s=42.35446232720169, n=42.39010967279831, w=-71.218, e=-71.138)  # the game's map (js bbox)
PAD = 0.0006  # a little margin in degrees so edge cells have whole pixels
BASE = 'https://tiles.arcgis.com/tiles/hGdibHYSPO59RG1h/arcgis/rest/services/'
SERVICES = ['Massachusetts_Aerial_Imagery_2025', 'Massachusetts_Aerial_Imagery_2025_CIR']
UA = 'Townies city-sim data build (non-commercial; github.com/samuelling/Townies)'
THREADS = 4

def tile_xy(lat, lon, z):
    n = 2 ** z
    x = (lon + 180) / 360 * n
    y = (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n
    return int(x), int(y)

def tile_range(z=Z):
    x0, y0 = tile_xy(BBOX['n'] + PAD, BBOX['w'] - PAD, z)
    x1, y1 = tile_xy(BBOX['s'] - PAD, BBOX['e'] + PAD, z)
    return x0, x1, y0, y1

def path(svc, z, y, x):
    return os.path.join(WORK, svc, str(z), str(y), str(x))

def get(url, tries=6):
    err = None
    for k in range(tries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UA})
            with urllib.request.urlopen(req, timeout=60) as r: return r.read()
        except urllib.error.HTTPError as e:
            if e.code == 404: return None  # no tile here (outside the service's coverage)
            err = e
        except Exception as e:
            err = e
        time.sleep(1.5 * (k + 1))
    raise err

def main():
    x0, x1, y0, y1 = tile_range()
    jobs = [(s, y, x) for s in SERVICES for y in range(y0, y1 + 1) for x in range(x0, x1 + 1)
            if not os.path.exists(path(s, Z, y, x))]
    total = len(SERVICES) * (x1 - x0 + 1) * (y1 - y0 + 1)
    print(f'zoom {Z}: tiles x {x0}-{x1}, y {y0}-{y1}; {total} in all, {len(jobs)} to fetch', flush=True)
    lock = threading.Lock(); st = {'done': 0, 'bytes': 0, 'missing': 0}; t0 = time.time()
    def job(j):
        s, y, x = j
        data = get(f'{BASE}{s}/MapServer/tile/{Z}/{y}/{x}')
        p = path(s, Z, y, x); os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p + '.part', 'wb') as f: f.write(data or b'')  # empty file = the service has no tile here
        os.replace(p + '.part', p)
        with lock:
            st['done'] += 1; st['bytes'] += len(data or b''); st['missing'] += data is None
            if st['done'] % 250 == 0:
                print(f"{st['done']}/{len(jobs)}  {st['bytes'] / 1e6:.0f} MB  {time.time() - t0:.0f} s", flush=True)
    with ThreadPoolExecutor(THREADS) as ex: list(ex.map(job, jobs))
    print(f"DONE {st['done']} tiles, {st['bytes'] / 1e6:.0f} MB, {st['missing']} missing, {time.time() - t0:.0f} s", flush=True)

if __name__ == '__main__':
    main()
