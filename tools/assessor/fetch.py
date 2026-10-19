# Politely fetch Watertown's assessor building records (Vision Government Solutions) for Townies.
# Keeps building attributes, sub-areas, outbuildings and a small photo thumbnail; never owners, sales or values.
import re, html, json, os, sys, time, threading, io, urllib.request, urllib.parse
from concurrent.futures import ThreadPoolExecutor
from PIL import Image
D = os.environ.get("ASSESSOR_WORK", os.path.join(os.path.dirname(os.path.abspath(__file__)), "work"))
os.makedirs(os.path.join(D, "thumbs"), exist_ok=True)
OUT = os.path.join(D, 'raw.jsonl'); TH = os.path.join(D, 'thumbs')
BASE = 'https://gis.vgsi.com/WatertownMA/'
UA = {'User-Agent': 'Townies city-sim data refresh (non-commercial art project; github.com/samuelling/Townies)'}
lock = threading.Lock()
done = set()
if os.path.exists(OUT):
    for ln in open(OUT):
        try: done.add(json.loads(ln)['pid'])
        except Exception: pass

def get(url, tries=4):
    for k in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=40) as r:
                return r.read()
        except Exception as e:
            err = e; time.sleep(2 * (k + 1))
    raise err

txt = lambda s: re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', s or ''))).strip()
def lbl(s, i):
    m = re.search(r'id="%s"[^>]*>(.*?)</' % i, s, re.S)
    return txt(m.group(1)) if m else ''
def grid(s, i):
    m = re.search(r'<table[^>]*id="%s".*?</table>' % i, s, re.S)
    if not m: return []
    rows = []
    for tr in re.findall(r'<tr[^>]*>(.*?)</tr>', m.group(0), re.S):
        tds = [txt(x) for x in re.findall(r'<td[^>]*>(.*?)</td>', tr, re.S)]
        if tds: rows.append(tds)
    return rows

photos = {}
def photo(src):
    if not src or 'default' in src.lower() or 'nopic' in src.lower(): return None
    if src in photos: return photos[src]
    name = re.sub(r'[^A-Za-z0-9]+', '_', src)[-80:] + '.jpg'
    path = os.path.join(TH, name)
    if not os.path.exists(path):
        url = urllib.parse.urljoin('https://gis.vgsi.com', urllib.parse.quote(src.replace('\\', '/'), safe='/%'))
        try:
            im = Image.open(io.BytesIO(get(url))).convert('RGB')
            im.thumbnail((320, 320)); im.save(path, quality=88)
        except Exception:
            photos[src] = None; return None
    photos[src] = name
    return name

def one(pid):
    if pid in done: return 'skip'
    s = get(BASE + 'Parcel.aspx?pid=%d' % pid).decode('utf-8', 'replace')
    mblu = lbl(s, 'MainContent_lblMblu')
    if not mblu:
        return 'empty'
    rec = {'pid': pid, 'mblu': ' '.join(t.strip() for t in mblu.split('/') if t.strip()),
           'addr': lbl(s, 'MainContent_lblLocation'), 'nb': lbl(s, 'MainContent_lblBldCount'), 'b': []}
    m = re.search(r'Use Code</td>\s*<td[^>]*>(.*?)</td>', s, re.S)
    rec['use'] = txt(m.group(1)) if m else ''
    for n in sorted(set(re.findall(r'MainContent_(ctl\d+)_grdCns', s))):
        attrs = {r[0].rstrip(':'): r[1] for r in grid(s, 'MainContent_%s_grdCns' % n) if len(r) >= 2 and r[0] != 'Field'}
        subs = [[r[0], r[2], r[3]] for r in grid(s, 'MainContent_%s_grdSub' % n) if len(r) >= 4 and r[0] and r[0] != 'Code']
        pm = re.search(r'id="MainContent_%s_imgPhoto"[^>]*src="([^"]*)"' % n, s) or re.search(r'src="([^"]*)"[^>]*id="MainContent_%s_imgPhoto"' % n, s)
        rec['b'].append({'yr': lbl(s, 'MainContent_%s_lblYearBuilt' % n), 'area': lbl(s, 'MainContent_%s_lblBldArea' % n),
                         'a': attrs, 'sub': subs, 'ph': photo(html.unescape(pm.group(1))) if pm else None})
    rec['ob'] = [[r[0], r[1], r[4] if len(r) > 4 else '', r[6] if len(r) > 6 else ''] for r in grid(s, 'MainContent_grdOb') if len(r) >= 5 and r[0] != 'Code']
    with lock:
        with open(OUT, 'a') as f: f.write(json.dumps(rec) + '\n')
    return 'ok'

if __name__ == '__main__':
    lo, hi = int(sys.argv[1]), int(sys.argv[2])
    stats = {'ok': 0, 'empty': 0, 'skip': 0, 'err': 0}
    def job(p):
        try: r = one(p)
        except Exception as e: r = 'err'; print('ERR', p, e, flush=True)
        with lock:
            stats[r] += 1
            t = sum(stats.values())
            if t % 250 == 0: print(time.strftime('%H:%M:%S'), p, stats, flush=True)
        time.sleep(0.15)
    with ThreadPoolExecutor(6) as ex: list(ex.map(job, range(lo, hi)))
    print('DONE', stats, flush=True)
