"""
Foliage textures for the station's trees, the way games draw them: leaves
as alpha-cut cards, so a few quads read as hundreds of leaves.

  frond     palm fronds, side by side: on the left a green one (a
            yellow-green midrib, pairs of long, narrow leaflets angled
            towards the tip, shorter at either end, a few torn or missing,
            lighter at the leaflet tips); on the right a dead one, straw
            brown, its leaflets hanging and more of them gone
  leaves    a cluster of broad leaves (oak/ficus-like) round a few twigs,
            overlapping, each with its midrib and a light-to-dark gradient
  cypress   a flame of dense, scale-leaved sprays for Italian cypress
  scrub     a clump of small, dusty grey-green chaparral leaves
  palmbark  a palm trunk's diamond pattern of old leaf bases (tiles up)
  bark      furrowed bark for the broad trees (tiles)

  python3 tools/textures/foliage.py

Writes public/station/foliage/{frond,leaves,cypress,scrub}.png (RGBA) and
{palmbark,bark}.jpg. Drawn 4x over and filtered down so leaf edges are
smooth; colours are bled out under the transparent areas so mipmaps don't
fringe dark. Needs numpy and Pillow.
"""

import math
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'public', 'station', 'foliage')
SS = 4  # supersampling
rng = np.random.default_rng(23)


def bleed(rgba, passes=24):
    """Spread colour into transparent pixels (alpha untouched), so filtering
    and mipmaps blend leaf colour rather than black at the edges."""
    a = rgba[..., 3:4] > 8
    col = rgba[..., :3].astype(np.float32)
    have = a[..., 0].copy()
    for _ in range(passes):
        if have.all():
            break
        acc = np.zeros_like(col)
        n = np.zeros(have.shape, np.float32)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            sh = np.roll(np.roll(have, dy, 0), dx, 1)
            acc += np.roll(np.roll(col, dy, 0), dx, 1) * sh[..., None]
            n += sh
        grow = (~have) & (n > 0)
        col[grow] = acc[grow] / n[grow][:, None]
        have |= grow
    col[~have] = col[have].mean(0)
    out = rgba.copy()
    out[..., :3] = np.clip(col, 0, 255).astype(np.uint8)
    return out


def finish(img, size, name):
    small = img.resize(size, Image.LANCZOS)
    arr = bleed(np.asarray(small).copy())
    Image.fromarray(arr, 'RGBA').save(os.path.join(OUT, name), optimize=True)
    print('wrote', name, size)


def vary(base, amount):
    return tuple(int(max(0, min(255, c * (1 + rng.normal(0, amount))))) for c in base)


def leaf_shape(cx, cy, length, width, angle, tip=0.0):
    """A lanceolate leaf as a polygon: widest a third of the way along, pointed."""
    pts_l, pts_r = [], []
    ca, sa = math.cos(angle), math.sin(angle)
    for k in range(13):
        t = k / 12
        w = width * math.sin(math.pi * t ** 0.75) * (1 - 0.15 * t)
        bend = tip * t * t * length
        for side, pts in ((1, pts_l), (-1, pts_r)):
            x, y = t * length, side * w / 2 + bend
            pts.append((cx + x * ca - y * sa, cy + x * sa + y * ca))
    return pts_l + pts_r[::-1]


def frond(W=256, H=1024):
    S = SS
    img = Image.new('RGBA', (2 * W * S, H * S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    for half, dead in ((0, False), (1, True)):
        cx = (half + 0.5) * W * S
        # Leaflet pairs from the base (bottom) to the tip (top).
        n = 46
        for i in range(n):
            t = (i + 0.5) / n
            y = H * S * (0.98 - 0.95 * t)
            L = W * S * 0.5 * (0.35 + 0.65 * math.sin(math.pi * min(1, t * 1.15) ** 0.8)) * (1 - 0.35 * t)
            for side in (-1, 1):
                if rng.random() < (0.22 if dead else 0.06):  # torn off
                    continue
                # Out to the side and up towards the tip (image y grows down),
                # steeper further along; a dead frond's leaflets hang back.
                up = math.radians((62 + 16 * t) if dead else (38 + 18 * t))
                a = math.atan2(-math.sin(up), side * math.cos(up))
                base, tipc, crease = ((128, 98, 60), (152, 124, 80), (98, 74, 44)) if dead else ((58, 104, 34), (86, 128, 46), (44, 82, 26))
                pts = leaf_shape(cx, y, L * (0.85 + 0.3 * rng.random()) * (0.8 if dead else 1), W * S * (0.035 if dead else 0.045), a, tip=0.06 * side)
                d.polygon(pts, fill=vary(base, 0.12) + (255,))
                # A lighter tip half and a crease down each leaflet.
                d.polygon(pts[6:13] + pts[13:20], fill=vary(tipc, 0.1) + (255,))
                mx, my = pts[0]
                ex, ey = (pts[12][0] + pts[13][0]) / 2, (pts[12][1] + pts[13][1]) / 2
                d.line([(mx, my), (ex, ey)], fill=vary(crease, 0.08) + (255,), width=S)
        # The midrib on top.
        rib, shade = ((140, 112, 72), (112, 88, 56)) if dead else ((150, 150, 82), (118, 122, 64))
        d.line([(cx, H * S * 0.99), (cx, H * S * 0.02)], fill=rib + (255,), width=int(5 * S))
        d.line([(cx - S, H * S * 0.99), (cx - S, H * S * 0.02)], fill=shade + (255,), width=int(2 * S))
    finish(img, (2 * W, H), 'frond.png')


def leaves(N=512, count=260, base=(54, 98, 34), name='leaves.png', size=(0.11, 0.05), twigs=True):
    S = SS
    img = Image.new('RGBA', (N * S, N * S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    c = N * S / 2
    if twigs:
        for k in range(5):
            a = rng.random() * math.tau
            d.line([(c, c), (c + math.cos(a) * c * 0.8, c + math.sin(a) * c * 0.8)], fill=(70, 56, 40, 255), width=int(3 * S))
    for k in range(count):
        # Denser in the middle, ragged at the edge.
        r = c * 0.86 * math.sqrt(rng.random())
        a = rng.random() * math.tau
        x, y = c + math.cos(a) * r, c + math.sin(a) * r
        L = N * S * size[0] * (0.7 + 0.6 * rng.random())
        w = N * S * size[1] * (0.7 + 0.5 * rng.random())
        ang = a + rng.normal(0, 0.6)
        light = 0.75 + 0.5 * (1 - r / c) + rng.normal(0, 0.1)
        col = tuple(int(max(0, min(255, v * light))) for v in vary(base, 0.12))
        pts = leaf_shape(x - math.cos(ang) * L / 2, y - math.sin(ang) * L / 2, L, w, ang, tip=rng.normal(0, 0.05))
        d.polygon(pts, fill=col + (255,))
        hi = tuple(min(255, int(v * 1.18)) for v in col)
        d.polygon(pts[2:11] + pts[15:24], fill=hi + (255,))
        d.line([pts[0], ((pts[12][0] + pts[13][0]) / 2, (pts[12][1] + pts[13][1]) / 2)], fill=tuple(int(v * 0.75) for v in col) + (255,), width=max(1, S // 2))
    finish(img, (N, N), name)


def cypress(W=256, H=512):
    S = SS
    img = Image.new('RGBA', (W * S, H * S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # Dense upright sprays, a flame shape: narrow at the top and bottom.
    for k in range(1400):
        t = rng.random()
        half = W * S * 0.46 * math.sin(math.pi * (0.08 + 0.9 * t)) ** 0.7
        x = W * S / 2 + rng.normal(0, 0.45) * half
        if abs(x - W * S / 2) > half:
            continue
        y = H * S * (0.98 - 0.96 * t)
        L = H * S * (0.02 + 0.03 * rng.random())
        ang = -math.pi / 2 + rng.normal(0, 0.45)
        shade = 0.7 + 0.5 * (1 - abs(x - W * S / 2) / max(half, 1)) * rng.random()
        col = tuple(int(v * shade) for v in vary((34, 62, 30), 0.15))
        d.polygon(leaf_shape(x, y, L, L * 0.45, ang), fill=col + (255,))
    finish(img, (W, H), 'cypress.png')


def bark(W, H, name, palm=False):
    y, x = np.mgrid[0:H, 0:W].astype(np.float32)
    n = np.zeros((H, W), np.float32)
    for f, a in ((4, 0.5), (9, 0.3), (23, 0.2)):
        g = rng.random((f, f))
        up = np.asarray(Image.fromarray((g * 255).astype(np.uint8)).resize((W, H), Image.BICUBIC), np.float32) / 255
        n += a * up
    if palm:
        # Diamond leaf-base scars: two sets of diagonal ridges crossing.
        u, v = x / W * 6, y / H * 12
        dia = np.minimum(np.abs(((u + v) % 1) - 0.5), np.abs(((u - v) % 1) - 0.5)) * 2
        ridge = np.clip(1 - dia * 3, 0, 1)
        base = np.stack([0.42 + 0.0 * n, 0.37 + 0.0 * n, 0.3 + 0.0 * n], -1)
        col = base * (0.62 + 0.38 * n[..., None]) * (0.7 + 0.45 * ridge[..., None])
    else:
        # Vertical furrows, wandering.
        fur = np.abs(np.sin((x / W * 14 + n * 3) * math.pi))
        col = np.stack([0.33, 0.27, 0.21])[None, None, :] * (0.55 + 0.45 * fur[..., None]) * (0.75 + 0.35 * n[..., None])
    Image.fromarray(np.clip(col * 255, 0, 255).astype(np.uint8)).save(os.path.join(OUT, name), quality=88)
    print('wrote', name)


def main():
    os.makedirs(OUT, exist_ok=True)
    frond()
    leaves()
    leaves(N=512, count=950, base=(70, 84, 56), name='scrub.png', size=(0.042, 0.021), twigs=False)
    cypress()
    bark(256, 512, 'palmbark.jpg', palm=True)
    bark(256, 256, 'bark.jpg')


main()
