# Draws the Townies app icon: a Watertown triple-decker at night, windows lit, a street lamp, a moon.
# python3 ios/tools/make_icon.py  ->  ios/Townies/Assets.xcassets/AppIcon.appiconset/AppIcon.png
import os, random
from PIL import Image, ImageDraw, ImageFilter, ImageChops

N = 2048  # drawn at 2x, then downsampled to 1024
img = Image.new('RGB', (N, N))
d = ImageDraw.Draw(img)
for y in range(N):  # night sky
    t = y / N
    d.line([(0, y), (N, y)], fill=(int(20 + 12 * t), int(28 + 6 * t), int(72 - 34 * t)))
rnd = random.Random(7)
for _ in range(80):  # stars
    x, y = rnd.randrange(N), rnd.randrange(int(N * 0.42))
    r = rnd.choice([2, 3, 3, 4])
    d.ellipse([x - r, y - r, x + r, y + r], fill=(235, 235, 255))
# a crescent moon: a disc with a disc cut out of it
mx, my, mr = int(N * 0.80), int(N * 0.17), 135
moon = Image.new('L', (N, N), 0)
md = ImageDraw.Draw(moon)
md.ellipse([mx - mr, my - mr, mx + mr, my + mr], fill=255)
md.ellipse([mx - mr + 75, my - mr - 45, mx + mr + 75, my + mr - 45], fill=0)
img.paste((250, 238, 200), (0, 0), moon)
d = ImageDraw.Draw(img)

# isometric: x runs down-right, y runs down-left, z up. Nearest corner is (max x, max y).
A = 345
W, D, H, R = 1.3, 2.0, 2.2, 0.7  # front width, depth, wall height, roof rise
cx0, cy0 = (W / 2 - D / 2) * A, (W / 2 + D / 2) * A * 0.5 - H * 0.6 * A
CX, CY = N * 0.47 - cx0, N * 0.58 - cy0
P = lambda x, y, z: (CX + (x - y) * A, CY + (x + y) * A * 0.5 - z * A)
poly = lambda pts, col, dr=None: (dr or d).polygon([P(*p) for p in pts], fill=col)

# ground, and the street in front of the house (the front faces +y)
poly([(-1.8, -1.0, 0), (3.2, -1.0, 0), (3.2, 4.4, 0), (-1.8, 4.4, 0)], (22, 50, 32))
poly([(-1.8, D + 0.75, 0), (3.2, D + 0.75, 0), (3.2, D + 1.45, 0), (-1.8, D + 1.45, 0)], (44, 44, 52))
poly([(-1.8, D + 0.62, 0), (3.2, D + 0.62, 0), (3.2, D + 0.75, 0), (-1.8, D + 0.75, 0)], (92, 92, 100))  # sidewalk

glow = Image.new('L', (N, N), 0)
g = ImageDraw.Draw(glow)

# roof plane facing away first, then the walls, then the near roof plane and the front gable
poly([(0, 0, H), (W / 2, 0, H + R), (W / 2, D, H + R), (0, D, H)], (78, 38, 34))
poly([(0, D, 0), (W, D, 0), (W, D, H), (0, D, H)], (66, 86, 146))            # front (street side)
poly([(W, 0, 0), (W, D, 0), (W, D, H), (W, 0, H)], (40, 52, 96))             # side
poly([(W / 2, 0, H + R), (W, 0, H), (W, D, H), (W / 2, D, H + R)], (104, 50, 42))
poly([(0, D, H), (W, D, H), (W / 2, D, H + R)], (74, 96, 158))               # front gable

WARM, DIM = (255, 206, 120), (32, 40, 70)
def window(pts, on):
    poly(pts, WARM if on else DIM)
    if on: g.polygon([P(*p) for p in pts], fill=255)
lit_front = [[1, 1], [0, 1], [1, 0]]
lit_side = [[1, 0, 1], [1, 1, 0], [0, 1, 1]]
for f in range(3):
    z0 = f * H / 3 + 0.2
    for k in range(3):
        y = 0.22 + k * 0.6
        window([(W + 0.002, y, z0), (W + 0.002, y + 0.3, z0), (W + 0.002, y + 0.3, z0 + 0.4), (W + 0.002, y, z0 + 0.4)], lit_side[f][k])
    for k in range(2):
        x = 0.2 + k * 0.6
        window([(x, D + 0.002, z0), (x + 0.3, D + 0.002, z0), (x + 0.3, D + 0.002, z0 + 0.4), (x, D + 0.002, z0 + 0.4)], lit_front[f][k])
window([(W / 2 - 0.1, D + 0.002, H + 0.1), (W / 2 + 0.1, D + 0.002, H + 0.1), (W / 2 + 0.1, D + 0.002, H + 0.4), (W / 2 - 0.1, D + 0.002, H + 0.4)], True)
# stacked front porches, the triple-decker's signature
PD = 0.38
for f in range(3):
    z0, z1 = f * H / 3 + 0.04, (f + 1) * H / 3 - 0.02
    poly([(0.04, D, z0), (W - 0.04, D, z0), (W - 0.04, D + PD, z0), (0.04, D + PD, z0)], (138, 138, 150))
    poly([(0.04, D + PD, z0 - 0.06), (W - 0.04, D + PD, z0 - 0.06), (W - 0.04, D + PD, z0), (0.04, D + PD, z0)], (178, 178, 188))
    for k in range(4):
        x = 0.06 + k * (W - 0.16) / 3
        poly([(x, D + PD, z0), (x + 0.05, D + PD, z0), (x + 0.05, D + PD, z1), (x, D + PD, z1)], (226, 226, 234))
    poly([(0.04, D + PD, z0 + 0.32), (W - 0.04, D + PD, z0 + 0.32), (W - 0.04, D + PD, z0 + 0.37), (0.04, D + PD, z0 + 0.37)], (226, 226, 234))
poly([(0.04, D + PD, H - 0.02), (W - 0.04, D + PD, H - 0.02), (W - 0.04, D + PD, H + 0.04), (0.04, D + PD, H + 0.04)], (226, 226, 234))

# a street lamp on the sidewalk, and its pool of light
lx, ly = W + 0.55, D + 0.7
d.line([P(lx, ly, 0), P(lx, ly, 1.5)], fill=(24, 24, 30), width=16)
lp = P(lx, ly, 1.55)
d.ellipse([lp[0] - 28, lp[1] - 20, lp[0] + 28, lp[1] + 20], fill=(255, 238, 196))
g.ellipse([lp[0] - 130, lp[1] - 100, lp[0] + 130, lp[1] + 100], fill=210)
gp = P(lx, ly, 0)
g.ellipse([gp[0] - 380, gp[1] - 180, gp[0] + 380, gp[1] + 180], fill=120)

bl = glow.filter(ImageFilter.GaussianBlur(55))
warm = Image.new('RGB', (N, N), (255, 178, 88))
img = Image.composite(warm, img, bl.point(lambda v: int(v * 0.5)))
img = img.resize((1024, 1024), Image.LANCZOS)
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'Townies', 'Assets.xcassets', 'AppIcon.appiconset', 'AppIcon.png')
img.save(out)
print('wrote', os.path.normpath(out))
