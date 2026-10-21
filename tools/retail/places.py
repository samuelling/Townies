# Every business listed by Overture Maps within about 15 miles of Watertown (the competition each Watertown
# shop faces), into work/region-places.json: [name, lat, lon, category, brand, confidence, basic category, hierarchy].
# Reads the public GeoParquet release straight from S3 through the HTTPS proxy when one is set.
import os, json, sys, time
import pyarrow.dataset as ds, pyarrow.compute as pc
from pyarrow import fs
REL = os.environ.get('OVERTURE_RELEASE', '2026-09-23.1')
W, S, E, N = -71.475, 42.155, -70.885, 42.585
proxy = os.environ.get('HTTPS_PROXY') or os.environ.get('https_proxy')
s3 = fs.S3FileSystem(anonymous=True, region='us-west-2', **({'proxy_options': proxy} if proxy else {}))
path = f'overturemaps-us-west-2/release/{REL}/theme=places/type=place/'
d = ds.dataset(path, filesystem=s3, format='parquet')
f = (pc.field('bbox', 'xmin') >= W) & (pc.field('bbox', 'xmax') <= E) & (pc.field('bbox', 'ymin') >= S) & (pc.field('bbox', 'ymax') <= N)
t0 = time.time()
tab = d.to_table(filter=f, columns=['names', 'taxonomy', 'basic_category', 'brand', 'confidence', 'bbox', 'operating_status'])
print(tab.num_rows, 'places', round(time.time() - t0), 's')
out = []
for r in tab.to_pylist():
    nm = (r.get('names') or {}).get('primary')
    if not nm: continue
    tx = r.get('taxonomy') or {}
    cat = tx.get('primary') or ''
    hier = '/'.join(tx.get('hierarchy') or [])
    br = r.get('brand') or {}
    brand = ((br.get('names') or {}).get('primary')) if br else None
    if r.get('operating_status') and r['operating_status'] != 'open': continue
    b = r['bbox']
    out.append([nm, round(b['ymin'], 6), round(b['xmin'], 6), cat, brand, round(r.get('confidence') or 0, 2), r.get('basic_category') or '', hier])
os.makedirs(os.path.join(os.path.dirname(__file__), 'work'), exist_ok=True)
json.dump(out, open(os.path.join(os.path.dirname(__file__), 'work', 'region-places.json'), 'w'))
print(len(out), 'kept')
