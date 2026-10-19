# Fetch Watertown Forestry's 2022 public tree inventory (the "2022 Tree Inventory" theme on the town's
# MapGeo site, served as vector tiles from its CARTO named map). Keeps location, species, trunk diameter,
# condition and status; drops the inspectors' names and form links.
import json, math, os, sys, urllib.request
import mapbox_vector_tile

HERE = os.path.dirname(os.path.abspath(__file__))
W = os.environ.get('TREES_WORK', os.path.join(HERE, 'work'))
os.makedirs(W, exist_ok=True)
HOST = 'https://mapstudio.mapgeo.io/user/mapgeoprod/api/v1/map'
NAMED = 'tpl_4341bef6_c15b_11ed_bde7_8ec690ec29cb'
CROP = dict(s=42.3531, n=42.3915, w=-71.2244, e=-71.1327)
Z = 16
KEEP = ('commonname', 'scientific', 'genus', 'cultivar', 'dbh', 'condition', 'status', 'growingspa', 'numberofst', 'wires', 'address', 'parkname', 'dateadded', 'cartodb_id')

req = urllib.request.Request(f'{HOST}/named/{NAMED}', data=b'{"layer0":1}', headers={'Content-Type': 'application/json'})
lg = json.loads(urllib.request.urlopen(req, timeout=60).read())['layergroupid']

def tile(lat, lon):
    n = 2 ** Z
    return int((lon + 180) / 360 * n), int((1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n)
x0, y0 = tile(CROP['n'], CROP['w']); x1, y1 = tile(CROP['s'], CROP['e'])
trees = {}
for tx in range(x0, x1 + 1):
    for ty in range(y0, y1 + 1):
        data = urllib.request.urlopen(f'{HOST}/{lg}/1/{Z}/{tx}/{ty}.mvt', timeout=60).read()
        if not data: continue
        t = mapbox_vector_tile.decode(data)
        for layer in t.values():
            ext = layer.get('extent', 4096)
            for f in layer['features']:
                g = f['geometry']
                if g['type'] != 'Point': continue
                px, py = g['coordinates']
                # tile pixel -> lon/lat (mapbox_vector_tile flips y so the origin is bottom-left)
                n = 2 ** Z
                lon = (tx + px / ext) / n * 360 - 180
                yy = ty + (1 - py / ext)
                lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * yy / n))))
                p = f['properties']
                trees[p.get('cartodb_id')] = {'lat': round(lat, 6), 'lon': round(lon, 6), **{k: p.get(k) for k in KEEP}}
print(len(trees), 'trees')
json.dump(list(trees.values()), open(os.path.join(W, 'inventory.json'), 'w'))
