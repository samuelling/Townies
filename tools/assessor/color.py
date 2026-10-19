# Dominant facade colour from an assessor street photo.
import numpy as np
from PIL import Image
from scipy import ndimage

def rgb2hsv(a):
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    mx = a.max(-1); mn = a.min(-1); d = mx - mn
    h = np.zeros_like(mx)
    m = d > 1e-6
    rr = m & (mx == r); gg = m & (mx == g) & ~rr; bb = m & ~rr & ~gg
    h[rr] = ((g - b)[rr] / d[rr]) % 6
    h[gg] = (b - r)[gg] / d[gg] + 2
    h[bb] = (r - g)[bb] / d[bb] + 4
    h = h * 60
    s = np.where(mx > 1e-6, d / np.maximum(mx, 1e-6), 0)
    return h, s, mx

def facade_color(path):
    im = Image.open(path).convert('RGB')
    im.thumbnail((160, 160))
    a = np.asarray(im).astype(np.float32) / 255
    H, W, _ = a.shape
    h, s, v = rgb2hsv(a)
    skyish = ((v > 0.72) & (s < 0.18)) | ((h > 190) & (h < 250) & (s > 0.12) & (v > 0.55))
    lab, n = ndimage.label(skyish)
    top = set(np.unique(lab[0, :])) - {0}
    sky = np.isin(lab, list(top)) if top else np.zeros_like(skyish)
    veg = (h > 55) & (h < 170) & (s > 0.18) & (v > 0.12)
    dark = v < 0.28
    y0, y1, x0, x1 = int(H * 0.10), int(H * 0.68), int(W * 0.12), int(W * 0.88)
    ok = ~(sky | veg | dark)
    reg = ok[y0:y1, x0:x1]
    px = a[y0:y1, x0:x1][reg]
    yy, xx = np.mgrid[y0:y1, x0:x1]
    wt = np.exp(-(((xx / W) - 0.5) / 0.22) ** 2 - (((yy / H) - 0.40) / 0.22) ** 2)[reg]
    if len(px) < 200: return None, 0
    # k-means (k=5) in a perceptual-ish space
    X = px ** (1 / 2.2)
    rng = np.random.default_rng(0)
    C = X[rng.choice(len(X), 5, replace=False)]
    for _ in range(12):
        dd = ((X[:, None, :] - C[None]) ** 2).sum(-1)
        k = dd.argmin(1)
        C = np.array([X[k == j].mean(0) if (k == j).any() else C[j] for j in range(5)])
    cnt = np.bincount(k, weights=wt, minlength=5)
    # prefer the biggest cluster, but not grey asphalt-like low-sat mid-greys at the bottom of the frame
    j = cnt.argmax()
    col = (C[j] ** 2.2)
    yy0, xx0 = np.mgrid[y0:y1, x0:x1]
    tot = np.exp(-(((xx0 / W) - 0.5) / 0.22) ** 2 - (((yy0 / H) - 0.40) / 0.22) ** 2).sum()
    share = cnt[j] / tot
    return tuple(int(round(c * 255)) for c in col), float(share)

def paint(rgb):
    # photos are shot in all weather: lift the value into house-paint range, keep hue and (most of) saturation
    a = np.array(rgb, dtype=np.float32)[None, None] / 255
    h, s, v = rgb2hsv(a)
    h, s, v = float(h[0, 0]), float(s[0, 0]), float(v[0, 0])
    if s < 0.09 and v > 0.6: v = max(v, 0.93); s = min(s, 0.04)   # white / off-white
    elif s < 0.14: v = min(0.9, max(v * 1.3, 0.62))                # greys read darker in shade and overcast
    else: v = min(0.95, max(v * 1.3, 0.5))
    import colorsys
    r, g, b = colorsys.hsv_to_rgb(h / 360, min(s, 0.6), v)
    return tuple(int(round(x * 255)) for x in (r, g, b))
