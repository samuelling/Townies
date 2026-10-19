# Optional: average weekday bus boardings by stop and route, from the MBTA's open data
# "MBTA Bus Ridership by Trip, Season, Route/Line, and Stop" (CC0, ArcGIS item 8daf4a33925a4df59183f860826d29ee).
# Takes the most recent season in the archive, sums the per-trip average boardings over all weekday trips
# for each (stop, route), and writes work/ridership.json, which gtfs.py folds into data/transit.json.gz
# (summed over the stops on the map, per route). Run this before gtfs.py.
import csv, collections, io, json, os, re, sys, urllib.request, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
WORK = os.environ.get('TRANSIT_WORK', os.path.join(HERE, 'work'))
ITEM = '8daf4a33925a4df59183f860826d29ee'
URL = f'https://www.arcgis.com/sharing/rest/content/items/{ITEM}/data'
SRC = os.path.join(WORK, 'ridership.zip')
OUT = os.path.join(WORK, 'ridership.json')

os.makedirs(WORK, exist_ok=True)
if '--refetch' in sys.argv or not os.path.exists(SRC):
    print('downloading', URL)
    with urllib.request.urlopen(URL, timeout=600) as r, open(SRC + '.part', 'wb') as f:
        f.write(r.read())
    os.replace(SRC + '.part', SRC)

z = zipfile.ZipFile(SRC)
def season_key(name):
    m = re.search(r'(Spring|Summer|Fall|Winter)_(\d{4})', name)
    return (int(m.group(2)), ['Winter', 'Spring', 'Summer', 'Fall'].index(m.group(1))) if m else (0, 0)
csvs = sorted((n for n in z.namelist() if n.endswith('.csv')), key=season_key)
name = csvs[-1]
print('using', name)
by = collections.defaultdict(lambda: collections.defaultdict(float))
season = None
# column names differ between seasons ("route_id"/"GTFS route_id", "day_type_name"/"Day Type", "Weekday"/"Wkdy")
rd = csv.reader(io.TextIOWrapper(z.open(name), 'utf-8-sig'))
head = [h.strip().lower() for h in next(rd)]
def col(*names):
    for n in names:
        if n in head: return head.index(n)
    raise SystemExit('no column %s in %s' % (names, head))
c_route, c_stop = col('route_id', 'gtfs route_id'), col('stop_id', 'gtfs stop_id')
c_day, c_season = col('day_type_name', 'day type'), col('season', 'year')
c_b = col('average_boardings', 'boardings')
for r in rd:
    if r[c_day].strip().lower() not in ('weekday', 'wkdy'): continue
    season = r[c_season]
    if r[c_b]: by[r[c_stop].strip()][r[c_route].strip()] += float(r[c_b])
json.dump({'season': season, 'day': 'weekday',
           'source': 'MBTA Bus Ridership by Trip, Season, Route/Line, and Stop (mbta-massdot.opendata.arcgis.com, item %s, %s)' % (ITEM, os.path.basename(name)),
           'by_stop': {s: {k: round(v, 1) for k, v in d.items()} for s, d in by.items()}},
          open(OUT, 'w'), separators=(',', ':'))
print(season, len(by), 'stops ->', OUT)
