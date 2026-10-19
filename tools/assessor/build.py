# Turn the fetched assessor records into data/assessor.json.gz for the game: per parcel (MassGIS MAP_PAR_ID,
# which is the assessor's map/block/lot), each building's style, stories, wall material, roof shape and cover,
# fireplaces, porch areas and a siding colour read from the street photo. No owners, sales or values.
import json, gzip, os, re, sys, datetime
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from color import facade_color, paint

W = os.environ.get('ASSESSOR_WORK', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'work'))
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'data', 'assessor.json.gz')
VERSION = 2

def wall(v):
    v = (v or '').lower()
    if not v or v[:2].isdigit(): return None
    if 'brick' in v: return 'brick'
    if 'stucco' in v: return 'stucco'
    if 'stone' in v: return 'stone'
    if 'shing' in v or 'shake' in v or 'cedar' in v: return 'shingle'
    if 'asbest' in v: return 'asbestos'
    if 'conc' in v or 'precast' in v or 'block' in v or 'cement' in v: return 'concrete'
    if 'glass' in v: return 'glass'
    if 'stl' in v or 'steel' in v or 'metal' in v or 'correg' in v: return 'metal'
    if 'vinyl' in v: return 'vinyl'
    if 'alum' in v: return 'aluminum'
    if 'clap' in v or 'wood' in v or 'board' in v: return 'clapboard'
    return None

def roof(v):
    v = (v or '').lower()
    for k in ('gambrel', 'mansard', 'hip', 'flat', 'shed', 'salt', 'gable'):
        if k in v: return 'saltbox' if k == 'salt' else k
    return None

def cover(v):
    v = (v or '').lower()
    if 'slate' in v: return 'slate'
    if 'asph' in v or 'comp' in v or 'f gls' in v or 'fiberg' in v: return 'asphalt'
    if 'tar' in v or 'gravel' in v: return 'tar'
    if 'membr' in v: return 'membrane'
    if 'rubber' in v or 'epdm' in v: return 'rubber'
    if 'metal' in v or 'tin' in v or 'copper' in v: return 'metal'
    if 'wood' in v or 'shake' in v: return 'wood'
    if 'tile' in v or 'clay' in v: return 'tile'
    return None

def floor_kind(v):
    v = (v or '').lower()
    if 'hard' in v or 'parquet' in v or 'soft' in v or 'pine' in v or 'engineer' in v: return 'wood'
    if 'carpet' in v: return 'carpet'
    if 'lamin' in v or 'plank' in v: return 'plank'
    if 'ceram' in v or 'tile' in v or 'ston' in v: return 'tile'
    if 'vinyl' in v or 'lino' in v: return 'vinyl'
    if 'conc' in v: return 'concrete'
    return None

def heat_kind(v):
    v = (v or '').lower()
    if 'steam' in v: return 'steam'
    if 'h/w' in v or 'hot w' in v or 'radiant' in v: return 'hw'
    if 'h/a' in v: return 'air'
    if 'pump' in v: return 'hp'
    if 'bb' in v or 'baseb' in v: return 'bb'
    return None

# the sub-areas that say how the house is stacked: base floor, upper stories, half / three-quarter stories,
# finished and unfinished attics and basements
STACK = ('BAS', 'FUS', 'FHS', 'TQS', 'FAT', 'ATC', 'UAT', 'UBM', 'FBM', 'LLV')

def num(v):
    try: return float(str(v).replace(',', ''))
    except Exception: return None

PORCH = {'FOP': 0, 'FSP': 0, 'EFP': 1, 'FEP': 1, 'BAL': 2, 'UOP': 2, 'UEP': 2, 'WDK': 3, 'RDK': 3}
recs, cols = {}, {}
n = nc = 0
for ln in open(os.path.join(W, 'raw.jsonl')):
    r = json.loads(ln)
    if not r.get('mblu') or not r.get('b'): continue
    out = []
    for b in r['b']:
        a = b['a']
        if not a: continue
        sub = {}
        for code, gross, liv in b['sub']:
            g = num(gross) or 0
            sub[code] = sub.get(code, 0) + g
        p = [0, 0, 0, 0]
        for code, g in sub.items():
            if code in PORCH: p[PORCH[code]] += g
        rec = {
            's': a.get('Style') or None,
            'n': num(a.get('Stories')),
            'w': wall(a.get('Exterior Wall 1') or a.get('Ext Wall 1')),
            'w2': wall(a.get('Exterior Wall 2') or a.get('Ext Wall 2')),
            'r': roof(a.get('Roof Structure')),
            'c': cover(a.get('Roof Cover')),
            'f': int(num(a.get('Fireplace(s)')) or 0) if a.get('Fireplace(s)') not in (None, '') else None,
            'u': int(num(a.get('Living Units') or a.get('Residential Units')) or 0) or None,
            'la': int(num(b.get('area')) or 0) or None,
            'y': int(num(b.get('yr')) or 0) or None,
            'bd': int(num(a.get('Bedrooms')) or 0) or None,
            'ba': int(num(a.get('Full Baths')) or 0) or None,
            'hb': int(num(a.get('Half Baths')) or 0) or None,
            'rm': int(num(a.get('Total Rooms')) or 0) or None,
        }
        if any(p): rec['p'] = [int(x) for x in p]
        sa = {k: int(sub[k]) for k in STACK if sub.get(k)}
        if sa: rec['sa'] = sa
        fk = floor_kind(a.get('Int Floor 1'))
        if fk: rec['fl'] = fk
        hk = heat_kind(a.get('Heat Type'))
        if hk: rec['ht'] = hk
        kt = int(num(a.get('Kitchens')) or 0)
        if 0 < kt < 20: rec['kt'] = kt
        ac = num(a.get('AC Percent'))
        if ac: rec['ac'] = int(ac)
        if (a.get('Model') or '').startswith('Res Condo'): rec['condo'] = 1
        if sub.get('FGR'): rec['g'] = int(sub['FGR'])
        if b.get('ph'):
            ph = os.path.join(W, 'thumbs', b['ph'])
            if b['ph'] not in cols and os.path.exists(ph):
                try: cols[b['ph']] = facade_color(ph)
                except Exception: cols[b['ph']] = (None, 0)
            c, share = cols.get(b['ph'], (None, 0))
            if c and share >= 0.18:
                rec['col'] = '#%02x%02x%02x' % paint(c); rec['cs'] = round(share, 2); nc += 1
        out.append({k: v for k, v in rec.items() if v is not None})
    if not out: continue
    ob = []
    for code, desc, size, _ in r.get('ob', []):
        kind = 'garage' if code.startswith('FGR') else 'shed' if code.startswith('SHD') else 'pool' if code.startswith('SPL') else 'barn' if code.startswith('BRN') else 'carport' if code.startswith('FCP') else None
        sz = num(re.sub(r'[^0-9.]', '', size or '')) if size else None
        if kind: ob.append([kind, int(sz or 0)])
    e = {'a': r.get('addr') or None, 'b': out}
    if ob: e['ob'] = ob
    recs[r['mblu']] = e
    n += 1
data = {'v': VERSION, 'fetched': datetime.date.today().isoformat(), 'source': 'Town of Watertown Assessor, via Vision Government Solutions', 'recs': recs}
with gzip.open(OUT, 'wt', compresslevel=9) as f: json.dump(data, f, separators=(',', ':'))
print(f'{n} parcels, {nc} buildings with a photo colour -> {os.path.relpath(OUT)} ({os.path.getsize(OUT)/1e3:.0f} kB)')
