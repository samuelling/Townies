# MBTA bus routes, stops and timetables through the game's map, from the MBTA GTFS feed.
# Writes data/transit.json.gz (gzip, compact JSON):
#
# { "v": 1, "fetched": "YYYY-MM-DD", "source": "MBTA GTFS (feed_version ...)",
#   "bbox": {s, n, w, e},                                  map bbox the data was cut to
#   "days": {"weekday": "YYYYMMDD", "saturday": ..., "sunday": ...},   representative service days
#   "routes": [{"id": "70", "name": long name, "color": "FFC72C", "text": "000000",
#               "summary": {weekday summary, see below}, "riders": avg weekday boardings at map stops (optional)}],
#   "pieces": [[lat1e5, lon1e5, lat1e5, lon1e5, ...], ...]
#       contiguous bits of route shapes inside the bbox grown by ~150 m, Douglas-Peucker simplified (3 m),
#       deduplicated across shapes/routes. A shape that leaves and re-enters the map gives several pieces.
#   "stops": [[name, lat1e5, lon1e5, [routeIdx, ...], stop_id, [boardings, ...]], ...]   stops inside the
#       (unexpanded) bbox. The last list (only when ridership is available) is the stop's average weekday
#       boardings for each route in its route list, same order (Fall-season data from ridership.py, summed
#       over the route's trips, rounded to 0.1; 0 when the season has none for that stop/route).
#   "trips": {"weekday": [[routeIdx, pieceIdx, dir, stopIdx, sec, metres, stopIdx, sec, metres, ...], ...],
#             "saturday": [...], "sunday": [...]}
#       one row per (trip, piece). sec = seconds after the service day's midnight (can exceed 86400 for
#       GTFS 24:xx+ times). metres = distance along the piece polyline as stored (i.e. measured on the
#       simplified lat/lon points with the game's equirectangular projection). stopIdx -1 is a synthetic
#       point where the shape crosses into (metres 0) or out of (metres = piece length) the expanded bbox,
#       its time interpolated linearly by distance between the trip's neighbouring real stop times.
#       Pieces where the trip starts/ends inside the map have no synthetic point at that end.
#       Rows are sorted by first time.
#   "ridership": optional {"season", "source", "day": "weekday", "by_route": {route id: avg weekday boardings at
#       the map's stops, summed over all trips}} (from ridership.py; route/stop ids matched as-is, so a route
#       renamed since that season gets nothing) }
#
# Weekday summary per route: {"trips": [dir0, dir1], "headway": {"am": [d0, d1], "mid": .., "pm": .., "eve": ..},
#   "first": "HH:MM", "last": "HH:MM"}: trips through the map per direction; median gap in minutes between
#   successive trips (time at their first map point) per direction in AM peak 7-9, midday 10-15, PM peak
#   16-18:30, evening 19-22 (null = fewer than 2 trips in the window); first/last time any trip is on the map.
#
# Usage: python3 tools/transit/gtfs.py [--refetch]
import csv, collections, datetime, gzip, io, json, math, os, statistics, sys, urllib.request, zipfile
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..', '..')
WORK = os.environ.get('TRANSIT_WORK', os.path.join(HERE, 'work'))
OUT = os.path.join(ROOT, 'data', 'transit.json.gz')
FEED_URL = 'https://cdn.mbta.com/MBTA_GTFS.zip'
FEED = os.path.join(WORK, 'MBTA_GTFS.zip')
RIDERSHIP = os.path.join(WORK, 'ridership.json')  # written by ridership.py (optional)

S, N, W, E = 42.35446232720169, 42.39010967279831, -71.218, -71.138
LATMID = (S + N) / 2
MX = math.cos(math.radians(LATMID)) * 111320  # metres per degree lon
MY = 110574                                   # metres per degree lat
MARGIN = 150         # m, pieces are clipped to the bbox grown by this
MIN_ROUTE_M = 300    # routes with less shape than this inside the real bbox are dropped
MIN_PIECE_M = 100    # pieces with less than this inside the real bbox are dropped
DP_TOL = 3.0         # m, Douglas-Peucker tolerance
SNAP_M = 120         # m, max stop-to-shape distance considered when placing stops on a shape

# map coords in metres: x east from W, y south from N (same orientation as the game's tiles)
X0, X1 = -MARGIN, (E - W) * MX + MARGIN
Y0, Y1 = -MARGIN, (N - S) * MY + MARGIN
RX1, RY1 = (E - W) * MX, (N - S) * MY

def xy(lat, lon):
    return (np.asarray(lon) - W) * MX, (N - np.asarray(lat)) * MY

def table(z, name):
    return csv.DictReader(io.TextIOWrapper(z.open(name), 'utf-8-sig'))

def hms(t):
    if not t: return None
    h, m, s = t.split(':')
    return int(h) * 3600 + int(m) * 60 + int(s)

def hhmm(sec):
    return '%02d:%02d' % (sec // 3600, sec // 60 % 60)

# ---------------------------------------------------------------- geometry
def clip_polyline(px, py):
    """Clip a polyline to the expanded box. Returns pieces as lists of (x, y, d) with d = distance along the
    full shape, plus flags whether the piece starts/ends on the box edge (a real crossing)."""
    seglen = np.hypot(np.diff(px), np.diff(py))
    cum = np.concatenate([[0], np.cumsum(seglen)])
    pieces, cur = [], None
    for i in range(len(px) - 1):
        x0, y0, x1, y1 = px[i], py[i], px[i + 1], py[i + 1]
        dx, dy = x1 - x0, y1 - y0
        t0, t1 = 0.0, 1.0
        ok = True
        for p, q in ((-dx, x0 - X0), (dx, X1 - x0), (-dy, y0 - Y0), (dy, Y1 - y0)):
            if p == 0:
                if q < 0: ok = False; break
            else:
                r = q / p
                if p < 0:
                    if r > t1: ok = False; break
                    t0 = max(t0, r)
                else:
                    if r < t0: ok = False; break
                    t1 = min(t1, r)
        if not ok or t0 > t1 or (t0 == t1 and seglen[i] > 0):
            if cur: pieces.append(cur); cur = None
            continue
        a = (x0 + t0 * dx, y0 + t0 * dy, cum[i] + t0 * seglen[i])
        b = (x0 + t1 * dx, y0 + t1 * dy, cum[i] + t1 * seglen[i])
        if cur is None:
            cur = {'pts': [a]}
        cur['pts'].append(b)
        if t1 < 1:
            pieces.append(cur); cur = None
    if cur: pieces.append(cur)
    for p in pieces:  # a piece starting/ending away from the shape's ends is a real crossing of the box edge
        p['enter'] = p['pts'][0][2] > 1e-6
        p['exit'] = p['pts'][-1][2] < cum[-1] - 1e-6
    return pieces, cum

def inside(x, y):
    return X0 <= x <= X1 and Y0 <= y <= Y1

def inner_length(pts):
    """Length of a piece inside the real (unexpanded) bbox."""
    tot = 0.0
    for (x0, y0, _), (x1, y1, _) in zip(pts, pts[1:]):
        dx, dy = x1 - x0, y1 - y0
        t0, t1 = 0.0, 1.0
        ok = True
        for p, q in ((-dx, x0), (dx, RX1 - x0), (-dy, y0), (dy, RY1 - y0)):
            if p == 0:
                if q < 0: ok = False; break
            else:
                r = q / p
                if p < 0: t0 = max(t0, r)
                else: t1 = min(t1, r)
        if ok and t1 > t0: tot += (t1 - t0) * math.hypot(dx, dy)
    return tot

def douglas_peucker(x, y, tol):
    n = len(x)
    keep = np.zeros(n, bool); keep[0] = keep[-1] = True
    stack = [(0, n - 1)]
    while stack:
        a, b = stack.pop()
        if b <= a + 1: continue
        ax, ay, bx, by = x[a], y[a], x[b], y[b]
        dx, dy = bx - ax, by - ay
        L2 = dx * dx + dy * dy
        sx, sy = x[a + 1:b] - ax, y[a + 1:b] - ay
        if L2 == 0:
            d = np.hypot(sx, sy)
        else:
            t = np.clip((sx * dx + sy * dy) / L2, 0, 1)
            d = np.hypot(sx - t * dx, sy - t * dy)
        k = int(np.argmax(d))
        if d[k] > tol:
            m = a + 1 + k
            keep[m] = True
            stack += [(a, m), (m, b)]
    return keep

def snap_stops(px, py, cum, sx, sy):
    """Place stops (in order) on the shape with non-decreasing distance: candidates are local minima of the
    stop-to-segment distance, chosen by DP to minimise the summed offset. Returns distance along shape."""
    ax, ay = px[:-1], py[:-1]
    dx, dy = np.diff(px), np.diff(py)
    L2 = dx * dx + dy * dy
    L2[L2 == 0] = 1e-9
    cands = []
    for x, y in zip(sx, sy):
        t = np.clip(((x - ax) * dx + (y - ay) * dy) / L2, 0, 1)
        d = np.hypot(ax + t * dx - x, ay + t * dy - y)
        along = cum[:-1] + t * np.sqrt(L2)
        # local minima within SNAP_M, plus the global best as a fallback
        idx = [i for i in range(len(d)) if d[i] <= SNAP_M and (i == 0 or d[i] <= d[i - 1]) and (i == len(d) - 1 or d[i] <= d[i + 1])]
        g = int(np.argmin(d))
        if g not in idx: idx.append(g)
        cands.append([(float(along[i]), float(d[i])) for i in idx])
    # DP: cost[j][k] = min total offset with stop j at candidate k
    INF = float('inf')
    cost = [[c[1] for c in cands[0]]]
    back = [[-1] * len(cands[0])]
    for j in range(1, len(cands)):
        cj, bj = [], []
        for a, d in cands[j]:
            best, bk = INF, -1
            for k, (pa, _) in enumerate(cands[j - 1]):
                if pa <= a + 1e-6 and cost[-1][k] < best: best, bk = cost[-1][k], k
            if bk < 0:  # no monotone option: allow it, heavily penalised (keeps order by clamping later)
                bk = int(np.argmin(cost[-1])); best = cost[-1][bk] + 1e6
            cj.append(best + d); bj.append(bk)
        cost.append(cj); back.append(bj)
    k = int(np.argmin(cost[-1]))
    out = [0.0] * len(cands)
    for j in range(len(cands) - 1, -1, -1):
        out[j] = cands[j][k][0]
        k = back[j][k]
    for j in range(1, len(out)):  # enforce monotone
        out[j] = max(out[j], out[j - 1])
    return out

# ---------------------------------------------------------------- service days
def services_by_date(z):
    base = collections.defaultdict(set)  # date -> service ids
    cal = list(table(z, 'calendar.txt'))
    days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
    def dates(a, b):
        d = datetime.datetime.strptime(a, '%Y%m%d').date(); e = datetime.datetime.strptime(b, '%Y%m%d').date()
        while d <= e:
            yield d; d += datetime.timedelta(1)
    for r in cal:
        for d in dates(r['start_date'], r['end_date']):
            if r[days[d.weekday()]] == '1': base[d.strftime('%Y%m%d')].add(r['service_id'])
    holidays = set()
    for r in table(z, 'calendar_dates.txt'):
        if r['exception_type'] == '1': base[r['date']].add(r['service_id'])
        elif r['exception_type'] == '2': base[r['date']].discard(r['service_id'])
        if r.get('holiday_name'): holidays.add(r['date'])
    return base, holidays

# ---------------------------------------------------------------- main
def main():
    os.makedirs(WORK, exist_ok=True)
    if '--refetch' in sys.argv or not os.path.exists(FEED):
        print('downloading', FEED_URL)
        with urllib.request.urlopen(FEED_URL, timeout=300) as r, open(FEED + '.part', 'wb') as f:
            f.write(r.read())
        os.replace(FEED + '.part', FEED)
    fetched = datetime.date.fromtimestamp(os.path.getmtime(FEED))
    z = zipfile.ZipFile(FEED)
    info = next(table(z, 'feed_info.txt'))
    print('feed', info['feed_version'], info['feed_start_date'], '-', info['feed_end_date'])

    routes = {r['route_id']: r for r in table(z, 'routes.txt') if r['route_type'] == '3'}
    trips = [t for t in table(z, 'trips.txt') if t['route_id'] in routes]

    # shapes used by bus trips
    need = {t['shape_id'] for t in trips}
    shp = collections.defaultdict(list)
    for r in table(z, 'shapes.txt'):
        if r['shape_id'] in need:
            shp[r['shape_id']].append((int(r['shape_pt_sequence']), float(r['shape_pt_lat']), float(r['shape_pt_lon'])))
    shapes = {}
    for sid, pts in shp.items():
        pts.sort()
        lat = np.array([p[1] for p in pts]); lon = np.array([p[2] for p in pts])
        # cheap reject: no point within the expanded box and bbox of shape misses
        x, y = xy(lat, lon)
        if x.max() < X0 or x.min() > X1 or y.max() < Y0 or y.min() > Y1: continue
        pieces, cum = clip_polyline(x, y)
        pieces = [p for p in pieces if inner_length(p['pts']) >= MIN_PIECE_M]
        if pieces: shapes[sid] = dict(x=x, y=y, cum=cum, pieces=pieces)
    route_len = collections.defaultdict(float)
    for t in trips:
        s = shapes.get(t['shape_id'])
        if s: route_len[t['route_id']] = max(route_len[t['route_id']], sum(inner_length(p['pts']) for p in s['pieces']))
    cand = {r for r, L in route_len.items() if L >= MIN_ROUTE_M}
    print('candidate routes', sorted(cand, key=lambda r: int(routes[r]['route_sort_order'] or 0)))
    trips = [t for t in trips if t['route_id'] in cand and t['shape_id'] in shapes]

    # representative days: the first date (on/after the fetch date, inside the feed) of each kind whose
    # trip count through the map equals the most common count for that kind of day, skipping holidays
    sbd, holidays = services_by_date(z)
    per_service = collections.Counter(t['service_id'] for t in trips)
    start = max(info['feed_start_date'], fetched.strftime('%Y%m%d'))
    kinds = {'weekday': 2, 'saturday': 5, 'sunday': 6}
    days = {}
    for kind, wd in kinds.items():
        cnt = {}
        for d, sv in sbd.items():
            if info['feed_start_date'] <= d <= info['feed_end_date'] and d not in holidays \
                    and datetime.datetime.strptime(d, '%Y%m%d').weekday() == wd:
                cnt[d] = sum(per_service[s] for s in sv)
        mode = collections.Counter(cnt.values()).most_common(1)[0][0]
        ok = sorted(d for d, c in cnt.items() if c == mode and d >= start) or sorted(d for d, c in cnt.items() if c == mode)
        days[kind] = ok[0]
        print(kind, days[kind], mode, 'trips', {d: cnt[d] for d in sorted(cnt)})
    day_trips = {k: [t for t in trips if t['service_id'] in sbd[d]] for k, d in days.items()}
    use = {t['trip_id'] for v in day_trips.values() for t in v}

    stop_times = collections.defaultdict(list)
    for r in table(z, 'stop_times.txt'):
        if r['trip_id'] in use:
            stop_times[r['trip_id']].append((int(r['stop_sequence']), r['stop_id'], hms(r['arrival_time']), hms(r['departure_time'])))
    stops_all = {r['stop_id']: r for r in table(z, 'stops.txt')}

    # routes that actually run through the map on a representative day, in MBTA sort order
    rids = sorted({t['route_id'] for v in day_trips.values() for t in v}, key=lambda r: int(routes[r]['route_sort_order'] or 0))
    ridx = {r: i for i, r in enumerate(rids)}

    piece_ids, piece_out = {}, []   # content key -> index
    shape_piece = {}                # (shape_id, k) -> (pieceIdx, orig vertex d's, simplified cum metres)
    def piece_index(sid, k):
        if (sid, k) in shape_piece: return shape_piece[(sid, k)]
        p = shapes[sid]['pieces'][k]['pts']
        x = np.array([q[0] for q in p]); y = np.array([q[1] for q in p]); d = np.array([q[2] for q in p])
        # dedupe consecutive identical points
        m = np.concatenate([[True], np.hypot(np.diff(x), np.diff(y)) > 0.05])
        x, y, d = x[m], y[m], d[m]
        keep = douglas_peucker(x, y, DP_TOL)
        lat = np.round((N - y[keep] / MY) * 1e5).astype(int); lon = np.round((x[keep] / MX + W) * 1e5).astype(int)
        flat = []
        for a, b in zip(lat.tolist(), lon.tolist()):
            if len(flat) < 2 or flat[-2:] != [a, b]: flat += [a, b]
        key = tuple(flat)
        if key not in piece_ids:
            piece_ids[key] = len(piece_out); piece_out.append(flat)
        # cumulative metres on the stored (rounded, simplified) polyline, at each kept original vertex
        sx_, sy_ = xy(lat / 1e5, lon / 1e5)
        scum = np.concatenate([[0], np.cumsum(np.hypot(np.diff(sx_), np.diff(sy_)))])
        res = (piece_ids[key], d[keep], scum)
        shape_piece[(sid, k)] = res
        return res

    stop_idx, stop_out = {}, []
    stop_routes = collections.defaultdict(set)
    snap_cache = {}
    out_trips = {}
    trip_first = collections.defaultdict(dict)  # kind -> trip_id -> (routeIdx, dir, first time on the map)
    for kind, tl in day_trips.items():
        rows = []
        for t in tl:
            st = sorted(stop_times[t['trip_id']])
            if not st: continue
            sh = shapes[t['shape_id']]
            key = (t['shape_id'], tuple(s[1] for s in st))
            if key not in snap_cache:
                la = np.array([float(stops_all[s[1]]['stop_lat']) for s in st]); lo = np.array([float(stops_all[s[1]]['stop_lon']) for s in st])
                sx, sy = xy(la, lo)
                snap_cache[key] = (snap_stops(sh['x'], sh['y'], sh['cum'], sx, sy), sx, sy)
            dist, sx, sy = snap_cache[key]
            # stop times: fill blanks by distance interpolation
            tt = [s[3] if s[3] is not None else s[2] for s in st]
            known = [i for i, v in enumerate(tt) if v is not None]
            if len(known) < 2: continue
            ta = np.interp(dist, [dist[i] for i in known], [tt[i] for i in known])
            for i, v in enumerate(tt):
                if v is not None: ta[i] = v
            for k, pc in enumerate(sh['pieces']):
                d0, d1 = pc['pts'][0][2], pc['pts'][-1][2]
                pidx, od, scum = piece_index(t['shape_id'], k)
                along = lambda d: float(np.interp(d, od, scum))
                seq = []
                if pc['enter'] and dist[0] < d0:
                    seq.append((-1, float(np.interp(d0, dist, ta)), 0.0))
                for i, s in enumerate(st):
                    if d0 - 1e-6 <= dist[i] <= d1 + 1e-6 and 0 <= sx[i] <= RX1 and 0 <= sy[i] <= RY1:
                        sid = s[1]
                        if sid not in stop_idx:
                            r = stops_all[sid]
                            stop_idx[sid] = len(stop_out)
                            stop_out.append([r['stop_name'], round(float(r['stop_lat']) * 1e5), round(float(r['stop_lon']) * 1e5), [], sid])
                        stop_routes[sid].add(ridx[t['route_id']])
                        seq.append((stop_idx[sid], float(ta[i]), along(dist[i])))
                if pc['exit'] and dist[-1] > d1:
                    seq.append((-1, float(np.interp(d1, dist, ta)), float(scum[-1])))
                if not seq: continue
                # if the trip doesn't actually reach this piece (starts/ends beyond it), skip
                if dist[-1] < d0 or dist[0] > d1: continue
                row = [ridx[t['route_id']], pidx, int(t['direction_id'])]
                for si, sec, m in seq:
                    row += [si, int(round(sec)), int(round(m))]
                rows.append(row)
                trip_first[kind].setdefault(t['trip_id'], (ridx[t['route_id']], int(t['direction_id']), row[4]))
        rows.sort(key=lambda r: (r[4], r[0], r[2]))
        out_trips[kind] = rows
    for sid, i in stop_idx.items():
        stop_out[i][3] = sorted(stop_routes[sid])

    # weekday summaries
    windows = {'am': (7 * 3600, 9 * 3600), 'mid': (10 * 3600, 15 * 3600), 'pm': (16 * 3600, 18.5 * 3600), 'eve': (19 * 3600, 22 * 3600)}
    route_out = []
    for r in rids:
        R = routes[r]
        rows = [x for x in out_trips['weekday'] if x[0] == ridx[r]]
        # one time per trip (its first appearance on the map), even when it crosses the map in several pieces
        first = collections.defaultdict(list)
        for ri, dr, t0 in trip_first['weekday'].values():
            if ri == ridx[r]: first[dr].append(t0)
        summ = {'trips': [len(first[0]), len(first[1])], 'headway': {}}
        for w, (a, b) in windows.items():
            hw = []
            for dr in (0, 1):
                ts = sorted(v for v in first[dr] if a <= v < b)
                gaps = np.diff(ts)
                hw.append(round(float(statistics.median(gaps)) / 60, 1) if len(gaps) else None)
            summ['headway'][w] = hw
        if rows:
            summ['first'] = hhmm(min(x[4] for x in rows))
            summ['last'] = hhmm(max(x[-2] for x in rows))
        route_out.append({'id': R['route_short_name'] or r, 'name': R['route_long_name'], 'color': R['route_color'],
                          'text': R['route_text_color'], 'summary': summ})

    data = {'v': 1, 'fetched': fetched.isoformat(), 'source': 'MBTA GTFS (feed_version %s) %s' % (info['feed_version'], FEED_URL),
            'bbox': {'s': S, 'n': N, 'w': W, 'e': E}, 'days': days, 'routes': route_out,
            'pieces': piece_out, 'stops': stop_out, 'trips': out_trips}

    if os.path.exists(RIDERSHIP):
        rd = json.load(open(RIDERSHIP))
        by_route = collections.defaultdict(float)
        for sid, routes_b in rd['by_stop'].items():
            if sid in stop_idx:
                for rt, b in routes_b.items(): by_route[rt] += b
        ids = {x['id'] for x in route_out}
        br = {k: round(v) for k, v in sorted(by_route.items()) if k in ids}
        for x in route_out:
            if x['id'] in br: x['riders'] = br[x['id']]
        # boardings recorded for a route at a stop the route no longer serves (stop ids that changed since
        # that season, e.g. Watertown Sq Terminal 8178 -> 18178 for the 70/71) go to the nearest map stop
        # within 60 m that the route does serve now
        rid_of = {x['id']: ri for ri, x in enumerate(route_out)}
        moved = collections.defaultdict(lambda: collections.defaultdict(float))
        sxy = {sid: xy(stop_out[i][1] / 1e5, stop_out[i][2] / 1e5) for sid, i in stop_idx.items()}
        for sid, i in stop_idx.items():
            for rt, v in rd['by_stop'].get(sid, {}).items():
                if rt not in rid_of or rid_of[rt] in stop_out[i][3]: continue
                best, bd = None, 60.0
                for sid2, j in stop_idx.items():
                    if rid_of[rt] in stop_out[j][3]:
                        dd = math.hypot(sxy[sid][0] - sxy[sid2][0], sxy[sid][1] - sxy[sid2][1])
                        if dd < bd: best, bd = sid2, dd
                if best:
                    moved[best][rt] += v
                    print('ridership: route %s at stop %s -> %s (%.0f m), %.1f boardings' % (rt, sid, best, bd, v))
        for sid, i in stop_idx.items():
            b = dict(rd['by_stop'].get(sid, {}))
            for rt, v in moved[sid].items(): b[rt] = b.get(rt, 0) + v
            vals = []
            for ri in stop_out[i][3]:
                v = round(b.get(route_out[ri]['id'], 0), 1)
                vals.append(int(v) if v == int(v) else v)
            stop_out[i].append(vals)
        data['ridership'] = {'season': rd['season'], 'source': rd['source'], 'day': rd.get('day', 'weekday'), 'by_route': br}

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    raw = json.dumps(data, separators=(',', ':'), ensure_ascii=False).encode()
    with gzip.open(OUT, 'wb', compresslevel=9) as f: f.write(raw)
    print('routes', len(route_out), 'pieces', len(piece_out), 'stops', len(stop_out),
          {k: len(v) for k, v in out_trips.items()}, 'json', len(raw), 'gz', os.path.getsize(OUT))

if __name__ == '__main__':
    main()
