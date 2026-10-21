# Who shops at Watertown's stores, and from how far: an estimate of each store's yearly sales and of the share
# that comes from people who live outside Watertown. Writes data/retail.json.gz.
#
# Nobody publishes a store's sales, and where shoppers come from is only in paid phone-location data, so this
# is a model, built from open data and labelled as an estimate everywhere it shows: a nested Huff gravity model.
#  - Demand: every 2020 Census block group within 25 km, times what a person spends a year at each kind of store
#    (U.S. Census retail sales by kind of business / U.S. population; SPEND below).
#  - Supply: every comparable store in the region (Overture Maps places, tools/retail/places.py), each weighted by
#    its size relative to a typical independent of its kind (chains: company sales per store; BRANDS below).
#  - Choice: a block group spends more at nearer and bigger stores (exp(-distance / reach)), first choosing among a
#    kind's sub-markets (pizza, sushi, Armenian food) and then among their stores; an outside option (online, out
#    of the region) takes the rest. A store with twins all around gets mostly its own neighbours; one with no like
#    within miles reaches much farther.
#  - Out: each Watertown store's sales, and the shares from outside Watertown and from 8 km or more away.
#  - Specialty: Overture's categories can't tell an Armenian bakery from any bakery, so a short, sourced list
#    (specialty.json) marks Watertown's best-known destination food shops and the words that identify their
#    competitors.
import gzip, json, math, os, re, sys, datetime, collections
import numpy as np
import shapefile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..', '..')
WORK = os.path.join(HERE, 'work')
OUT = os.path.join(ROOT, 'data', 'retail.json.gz')
LAT0, LON0 = 42.3709, -71.1828  # Watertown
R_KM = 25

def km(lat1, lon1, lat2, lon2):
    return np.hypot((lat2 - lat1) * 110.574, (lon2 - lon1) * 111.320 * math.cos(math.radians(42.37)))

# ---- kinds of store: [reach (km, the e-folding length of an exponential decay), typical sales $k/yr of an
# independent and of a chain store (for sizing stores against each other), unused]
# Distance: a pizza place's pull halves every ~1 km, a Home Depot's every ~4 km.
CLASSES = {
    'supermarket': (2.5, 20000, 30000, 0.8), 'grocery': (2.5, 2500, 2500, 0.5), 'convenience': (1.0, 1200, 1600, 0.8),
    'liquor': (1.5, 2000, 2500, 0.8), 'pharmacy': (1.5, 2500, 10000, 0.9), 'restaurant': (2.5, 1300, 2600, 0.15),
    'quick': (1.5, 800, 1400, 0.3), 'cafe': (1.2, 500, 1500, 0.5), 'bakery': (2.0, 600, 900, 0.35), 'bar': (2.5, 1000, 1800, 0.4),
    'apparel': (5.0, 500, 3500, 0.3), 'general': (5.0, 3000, 15000, 0.6), 'home': (6.0, 2000, 10000, 0.5),
    'electronics': (6.0, 800, 2500, 0.5), 'furnishings': (7.0, 1500, 6000, 0.4), 'specialty': (4.0, 500, 3000, 0.25),
    'personal': (1.5, 300, 600, 0.6), 'fitness': (2.0, 700, 1500, 0.4), 'entertainment': (6.0, 3000, 5000, 0.3),
    'cannabis': (6.0, 6000, 6000, 0.9),
}
SPECIALTY_L = 8.0
# how distinct a kind's sub-markets are (1 = any one will do, lower = people want this cuisine / this specialty)
RHO = {'restaurant': 0.7, 'quick': 0.8, 'grocery': 0.65, 'bakery': 0.75, 'specialty': 0.6, 'apparel': 0.7, 'bar': 0.7,
       'home': 0.7, 'furnishings': 0.7, 'electronics': 0.8, 'fitness': 0.6, 'entertainment': 0.6}
OUTSIDE = 0.25
# what each resident spends a year at each kind of store, $: U.S. Census retail and food-service sales by kind
# of business (Annual Retail Trade Survey / Monthly Retail Trade, 2024) divided by U.S. population, rounded,
# with groceries split between supermarkets and specialty grocers and food service split by type
SPEND = {'supermarket': 2400, 'grocery': 300, 'convenience': 180, 'liquor': 220, 'pharmacy': 1100, 'restaurant': 1550,
         'quick': 1350, 'cafe': 280, 'bakery': 180, 'bar': 180, 'apparel': 900, 'general': 2350, 'home': 1450,
         'electronics': 270, 'furnishings': 330, 'specialty': 600, 'personal': 260, 'fitness': 130, 'entertainment': 70,
         'cannabis': 230}
MA_SPEND = 1.15
FAR_KM = 8  # 'from far away': past the next town over, past plenty of other stores  # Greater Boston incomes run above the national average

def nest_of(s):
    return ('spec', s['fine']) if s['spec'] else ('fine', s['fine'])
def attract(s, sales_i, sales_c):
    """A store's size relative to a typical independent of its kind."""
    b = s['brand']
    v = BRANDS.get(b) if b else None
    return (v or (sales_c if b else sales_i)) / sales_i
  # km: people cross the metro for a food tradition they can't get nearby
def classify(primary, basic, hier):
    p, h = primary or '', hier or ''
    if p in ('supermarket',) or (p == 'grocery_store' and False): return 'supermarket'
    if p in ('grocery_store', 'specialty_grocery_store', 'international_grocery_store', 'asian_grocery_store', 'butcher_shop', 'seafood_market', 'farmers_market', 'health_food_store', 'meat_shop', 'cheese_shop', 'deli', 'food_and_beverage_store'): return 'grocery'
    if p in ('convenience_store', 'tobacco_shop', 'vape_shop'): return 'convenience'
    if p in ('liquor_store', 'wine_shop', 'beer_wine_and_spirits'): return 'liquor'
    if 'pharmacy' in p or p == 'drugstore': return 'pharmacy'
    if p in ('cannabis_dispensary',): return 'cannabis'
    if p in ('pizza_restaurant', 'sandwich_shop', 'fast_food_restaurant', 'burger_restaurant', 'chicken_wings_restaurant', 'hot_dog_restaurant', 'sub_shop', 'bagel_shop', 'takeout_restaurant', 'chicken_restaurant'): return 'quick'
    if p in ('coffee_shop', 'tea_room', 'cafe', 'bubble_tea'): return 'cafe'
    if p in ('bakery', 'donut_shop', 'ice_cream_shop', 'dessert_shop', 'frozen_yogurt_shop', 'pastry_shop', 'chocolatier', 'candy_store', 'patisserie_cake_shop', 'cupcake_shop'): return 'bakery'
    if p in ('bar', 'pub', 'brewery', 'cocktail_bar', 'wine_bar', 'sports_bar', 'beer_bar', 'taproom', 'lounge'): return 'bar'
    if '/restaurant/' in h or p.endswith('_restaurant') or p == 'restaurant': return 'restaurant'
    if '/casual_eatery' in h or p in ('fast_food_restaurant', 'sandwich_shop', 'pizza_restaurant', 'burger_restaurant'): return 'quick'
    if 'fashion_and_apparel' in h or p in ('shoe_store', 'clothing_store', 'jewelry_store', 'accessories_store'): return 'apparel'
    if p in ('department_store', 'discount_store', 'warehouse_club', 'big_box_store', 'variety_store', 'outlet_store', 'shopping'): return 'general'
    if 'hardware_home_and_garden' in h or p in ('hardware_store', 'home_improvement_store', 'garden_center', 'nursery_and_gardening'): return 'home'
    if p in ('electronics_store', 'mobile_phone_store', 'computer_store', 'appliance_store'): return 'electronics'
    if p in ('furniture_store', 'home_goods_store', 'mattress_store', 'kitchen_supply_store', 'lighting_store', 'rug_store'): return 'furnishings'
    if p in ('book_store', 'bookstore', 'music_store', 'record_store', 'gift_shop', 'flowers_and_gifts_store', 'florist', 'toy_store', 'hobby_store', 'art_supply_store', 'craft_store', 'sporting_goods_store', 'bicycle_shop', 'pet_store', 'cosmetic_and_beauty_supply', 'beauty_supply_store', 'antique_store', 'thrift_store', 'vintage_store', 'second_hand_store', 'eyewear_store', 'optical_store', 'stationery_store', 'video_game_store', 'musical_instrument_store', 'paint_store', 'fabric_store', 'tiles', 'flooring_store'): return 'specialty'
    if basic in ('specialty_store', 'flowers_and_gifts_store', 'sporting_goods_store'): return 'specialty'
    if p in ('hair_salon', 'barber', 'beauty_salon', 'nail_salon', 'spa', 'day_spa', 'massage', 'massage_therapy', 'waxing', 'eyebrow_service', 'tanning_salon', 'tattoo_parlor', 'skin_care'): return 'personal'
    if p in ('gym', 'fitness_studio', 'yoga_studio', 'pilates_studio', 'climbing_gym', 'boxing_gym', 'cycling_studio', 'rock_climbing'): return 'fitness'
    if p in ('movie_theater', 'cinema', 'bowling_alley', 'arcade', 'escape_room', 'amusement_center', 'trampoline_park'): return 'entertainment'
    return None

# per-store sales for the big chains in town, $k/yr: company revenue / stores, from recent annual reports, rounded
BRANDS = {
    'target': 55000, 'the home depot': 60000, 'home depot': 60000, 'best buy': 40000, 'marshalls': 14000, 'tj maxx': 14000,
    'old navy': 8000, 'roche bros.': 30000, 'roche bros': 30000, 'star market': 30000, 'whole foods market': 40000,
    "trader joe's": 25000, 'stop & shop': 30000, 'market basket': 45000, 'cvs pharmacy': 10000, 'cvs': 10000,
    'walgreens': 9000, 'starbucks': 1800, "dunkin'": 1100, 'dunkin': 1100, 'chipotle mexican grill': 3000, 'chipotle': 3000,
    'shake shack': 4000, 'ulta beauty': 6000, 'nike': 8000, 'gap factory': 4000, "victoria's secret": 4000, 'petco': 4000,
    'staples': 6000, 'ace hardware': 3000, 'sweetgreen': 2800, "mcdonald's": 3500, 'panera bread': 3000,
}
SKIP = re.compile(r'^cvs beauty|minuteclinic|^cvs photo|target (optical|pharmacy)|^atm\\b|redbox|coinstar|amazon (locker|hub)', re.I)
SUPERMARKETS = re.compile(r"roche bros|star market|whole foods|trader joe|stop & shop|market basket|shaw'?s|wegmans|h mart|hannaford|aldi|big y|costco|bj'?s", re.I)

def norm(s):
    return re.sub(r'[^a-z0-9]', '', (s or '').lower().replace('&', 'and'))

def main():
    places = json.load(open(os.path.join(WORK, 'region-places.json')))
    spec = json.load(open(os.path.join(HERE, 'specialty.json')))
    spec_names = {norm(n): m for m, d in spec['markets'].items() for n in d['names']}
    spec_words = {m: re.compile(d['words'], re.I) for m, d in spec['markets'].items()}
    # Watertown's boundary, from the game's snapshot
    snap = json.load(gzip.open(os.path.join(ROOT, 'data', 'watertown.json.gz')))
    segs = []
    for t, ms in snap['rels']:
        if t and t.get('boundary') == 'administrative' and t.get('name') == 'Watertown':
            for role, flat in ms:
                a = c = 0; pts = []
                for k in range(0, len(flat) - 1, 2):
                    a += flat[k]; c += flat[k + 1]; pts.append((a / 1e6, c / 1e6))
                segs += list(zip(pts[:-1], pts[1:]))
    S = np.array([[p[0][0], p[0][1], p[1][0], p[1][1]] for p in segs])
    def in_town(lat, lon):
        lat = np.atleast_1d(lat); lon = np.atleast_1d(lon)
        y1, x1, y2, x2 = S[:, 0][None], S[:, 1][None], S[:, 2][None], S[:, 3][None]
        cross = ((y1 > lat[:, None]) != (y2 > lat[:, None])) & (lon[:, None] < (x2 - x1) * (lat[:, None] - y1) / (y2 - y1 + 1e-12) + x1)
        return (cross.sum(1) % 2) == 1
    # demand: 2020 Census blocks, gathered into block groups
    r = shapefile.Reader(dbf=open(os.path.join(WORK, 'tl_2020_25_tabblock20.dbf'), 'rb'))
    bg = collections.defaultdict(lambda: [0.0, 0.0, 0.0])
    for rec in r.iterRecords(fields=['GEOID20', 'INTPTLAT20', 'INTPTLON20', 'POP20']):
        g, la, lo, pop = rec[0], float(rec[1]), float(rec[2]), rec[3]
        if pop <= 0 or km(LAT0, LON0, la, lo) > R_KM + 3: continue
        e = bg[g[:12]]; e[0] += pop; e[1] += pop * la; e[2] += pop * lo
    BG = np.array([[e[1] / e[0], e[2] / e[0], e[0]] for e in bg.values()])
    bglat, bglon, bgpop = BG[:, 0], BG[:, 1], BG[:, 2]
    bg_in = in_town(bglat, bglon)
    print(len(BG), 'block groups,', int(bgpop.sum()), 'people,', int(bgpop[bg_in].sum()), 'in Watertown')
    # the stores
    stores = []; seen = {}
    for nm, la, lo, prim, brand, conf, basic, hier in places:
        if conf < 0.5: continue
        cls = classify(prim, basic, hier)
        if not cls: continue
        if cls == 'grocery' and (brand and SUPERMARKETS.search(brand) or SUPERMARKETS.search(nm)): cls = 'supermarket'
        mk = spec_names.get(norm(nm))
        if not mk:
            for m, rx in spec_words.items():
                if cls in ('grocery', 'bakery', 'restaurant', 'quick') and rx.search(nm + ' ' + (prim or '')): mk = m; break
        if SKIP.search(nm): continue
        b = (brand or '').lower() or (nm.lower() if nm.lower() in BRANDS else None)
        key = norm(b or nm)[:10]  # the same name within 250 m: one store listed twice
        if any(km(la, lo, a, o) < 0.25 for a, o in seen.get(key, ())): continue
        seen.setdefault(key, []).append((la, lo))
        stores.append({'n': nm, 'lat': la, 'lon': lo, 'cls': cls, 'fine': mk if mk else (prim or cls), 'spec': bool(mk), 'brand': b})
    sl = np.array([s['lat'] for s in stores]); so = np.array([s['lon'] for s in stores])
    s_in = in_town(sl, so)
    print(len(stores), 'comparable stores in the region,', int(s_in.sum()), 'in Watertown')
    by_cls = collections.defaultdict(list); by_fine = collections.defaultdict(list)
    for i, s in enumerate(stores):
        by_cls[s['cls']].append(i); by_fine[s['fine']].append(i)
    # Nested Huff (a nested logit): each block group spends its yearly budget for a kind of store (SPEND) across
    # that kind's sub-markets -- pizza, sushi, Armenian food -- and within a sub-market across its stores, each
    # weighted by its size and exp(-distance / reach). RHO < 1 makes sub-markets distinct: the one Persian
    # restaurant in a sea of pizza places still gets the area's Persian-food budget, from farther away.
    # An outside option (online, out of the region, doing without) takes about a fifth where stores are typical.
    out = []; capture = {}
    for c, idx_c in by_cls.items():
        L0, sales_i, sales_c, wc = CLASSES[c]
        rho = RHO.get(c, 0.85)
        nests = collections.defaultdict(list)
        for i in idx_c: nests[nest_of(stores[i])].append(i)
        I, F, A = {}, {}, {}
        for g, idx in nests.items():
            L = SPECIALTY_L if g[0] == 'spec' else L0
            idx = np.array(idx)
            d = km(bglat[:, None], bglon[:, None], sl[idx][None], so[idx][None])
            a = np.array([attract(stores[i], sales_i, sales_c) for i in idx])
            F[g] = np.exp(-d / L) * a[None]  # [block group, store]
            I[g] = F[g].sum(1)
        tot = sum(v ** rho for v in I.values())
        O = OUTSIDE * np.median(tot)
        denom = tot + O
        budget = bgpop * SPEND[c] * MA_SPEND / 1000  # $k a year
        capture[c] = 0.0
        for g, idx in nests.items():
            pn = I[g] ** rho / denom  # share of the budget going to this sub-market
            within = F[g] / np.maximum(I[g], 1e-30)[:, None]
            dollars = budget[:, None] * pn[:, None] * within  # [block group, store]
            for k, i in enumerate(idx):
                if not s_in[i]: continue
                s = stores[i]
                col = dollars[:, k]
                sales = float(col.sum())
                share_out = float(col[~bg_in].sum() / max(sales, 1e-9))
                far = float(col[km(bglat, bglon, s['lat'], s['lon']) > FAR_KM].sum() / max(sales, 1e-9))
                capture[c] += float(col[bg_in].sum()) / float(budget[bg_in].sum())
                dd = km(s['lat'], s['lon'], sl[nests[g]], so[nests[g]])
                same = int(((dd > 0.05) & (dd < 8)).sum())
                nearest = float(np.min(dd[dd > 0.05])) if (dd > 0.05).any() else 99.0
                out.append([s['n'], round(s['lat'] * 1e5), round(s['lon'] * 1e5), c, g[1], 1 if s['brand'] else 0, int(round(sales)), round(share_out * 100), same, round(min(nearest, 99), 1), round(far * 100)])
    out.sort(key=lambda o: (o[1], o[2]))
    # typical values for shops the game invents, by the kind of shop it invents
    def med(f, col):
        v = [o[col] for o in out if f(o)]
        return int(np.median(v)) if v else 0
    GAME = {'restaurant': 'restaurant', 'service': 'personal', 'retail': 'specialty', 'coffee': 'cafe', 'bakery': 'bakery', 'books': 'specialty', 'boutique': 'apparel', 'gallery': 'specialty', 'records': 'specialty'}
    defaults = {g: [med(lambda o, c=c: o[3] == c and not o[5], 6), med(lambda o, c=c: o[3] == c and not o[5], 7)] for g, c in GAME.items()}
    defaults['chain'] = [med(lambda o: o[5] == 1, 6), med(lambda o: o[5] == 1, 7)]
    data = {'v': 1, 'fetched': datetime.date.today().isoformat(),
            'source': 'Estimates: a nested Huff gravity model of 2020 Census block-group populations and their per-person spending by kind of store (U.S. Census retail sales / population), shopping among Overture Maps places within 25 km',
            'cols': ['name', 'lat1e5', 'lon1e5', 'class', 'market', 'chain', 'sales_k', 'out_pct', 'like_within_8km', 'nearest_like_km', 'far_pct'],
            'stores': out, 'defaults': defaults, 'classes': {c: {'reach_km': v[0], 'spend_per_person': SPEND[c]} for c, v in CLASSES.items()},
            'specialty': {m: {'source': d['source']} for m, d in spec['markets'].items()}}
    with gzip.open(OUT, 'wt', compresslevel=9) as f: json.dump(data, f, separators=(',', ':'))
    tot = sum(o[6] for o in out); outside = sum(o[6] * o[7] / 100 for o in out)
    print(len(out), 'Watertown stores; estimated sales $%.0fM/yr, from out of town $%.0fM (%.0f%%)' % (tot / 1000, outside / 1000, 100 * outside / max(tot, 1)))
    top = sorted(out, key=lambda o: -o[6] * o[7])[:15]
    for o in top: print('  %-32s %-12s $%5.1fM  %2d%% far %2d%% out' % (o[0][:32], o[3], o[6] / 1000, o[10], o[7]) + '  like-within-8km %3d  nearest %.1f km' % (o[8], o[9])) if False else print('  %-32s %-12s $%5.1fM  %2d%% out  like-within-8km %3d  nearest %.1f km' % (o[0][:32], o[3], o[6] / 1000, o[7], o[8], o[9]))
    uniq = sorted([o for o in out if not o[5]], key=lambda o: -o[10])[:12]
    print('most out-of-town independents:')
    for o in uniq: print('  %-32s %-12s %-24s $%4.1fM %2d%% out %2d%% far  like %3d  nearest %.1f km' % (o[0][:32], o[3], o[4][:24], o[6] / 1000, o[7], o[10], o[8], o[9]))
    print('Watertown residents\' choices that land on a Watertown store (sum of probabilities over stores, by class):')
    print('  ' + ', '.join('%s %.0f%%' % (c, 100 * v) for c, v in sorted(capture.items(), key=lambda kv: -kv[1])))
    print('->', os.path.relpath(OUT), os.path.getsize(OUT) // 1024, 'kB')

if __name__ == '__main__':
    main()
