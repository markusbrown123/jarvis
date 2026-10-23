"""
Machined metal plating for the station's hardware — the drones, their
docks, the floor plates round the console and the zone pads: a tileable
texture set of panels with seams, rivets, vent slots, brushing and fine
scratches, and dirt worked into the grooves.

  python3 tools/textures/metal.py

Writes public/station/metal_albedo.jpg, metal_orm.jpg (red: ambient
occlusion, green: roughness, blue: metalness — glTF's order) and
metal_normal.jpg, 1024 px, tiling seamlessly. Needs numpy and Pillow.
"""

import os

import numpy as np
from PIL import Image

N = 1024
OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'public', 'station')
rng = np.random.default_rng(11)


def blur(a, r, axis):
    """Box blur along one axis, wrapping (so the result still tiles)."""
    out = np.zeros_like(a)
    for k in range(-r, r + 1):
        out += np.roll(a, k, axis=axis)
    return out / (2 * r + 1)


def smooth_noise(cells):
    """Value noise that tiles: random grid, bicubic-ish upsampled."""
    g = rng.random((cells, cells))
    img = Image.fromarray((g * 255).astype(np.uint8)).resize((N, N), Image.BICUBIC)
    a = np.asarray(img, np.float32) / 255
    # Blend with a shifted copy so the wrap seam disappears.
    return (a + np.roll(np.roll(a, N // 2, 0), N // 2, 1)) / 2


y, x = np.mgrid[0:N, 0:N].astype(np.float32)
P = N // 4  # four panels a side
px, py = x % P, y % P
pid = (y // P) * 4 + (x // P)

# Seams between panels: grooves a few pixels wide.
edge = np.minimum(np.minimum(px, P - 1 - px), np.minimum(py, P - 1 - py))
groove = np.clip(1 - (edge - 1.0) / 2.5, 0, 1)

# Rivets inset from each panel's corners.
rivet = np.zeros((N, N), np.float32)
for cx in (14, P - 15):
    for cy in (14, P - 15):
        d = np.hypot(px - cx, py - cy)
        rivet = np.maximum(rivet, np.clip(1 - (d / 5.0) ** 2, 0, 1))

# Vent slots on a few panels.
vent = np.zeros((N, N), np.float32)
for p in (5, 10, 15):
    on = pid == p
    slot = ((py % 18) < 7) & (px > 40) & (px < P - 40) & (py > 40) & (py < P - 40)
    vent = np.where(on & slot, 1.0, vent)
vent = blur(blur(vent, 1, 0), 1, 1)

# Brushing: fine streaks, horizontal on some panels, vertical on others.
raw = rng.standard_normal((N, N)).astype(np.float32)
brush_h = blur(raw, 40, 1)
brush_v = blur(raw, 40, 0)
horizontal = ((pid + (pid // 4)) % 2 == 0)
brush = np.where(horizontal, brush_h, brush_v)
brush = (brush - brush.mean()) / (brush.std() + 1e-6)

# Each panel its own shade, a little wear, and fine scratches.
tone = rng.uniform(0.86, 1.1, 16)[pid.astype(int)]
wear = smooth_noise(12)
scratch = np.zeros((N, N), np.float32)
for _ in range(260):
    x0, y0 = rng.uniform(0, N, 2)
    ang = rng.uniform(0, np.pi)
    length = rng.uniform(15, 90)
    for t in np.linspace(0, 1, int(length)):
        sx = int(x0 + np.cos(ang) * t * length) % N
        sy = int(y0 + np.sin(ang) * t * length) % N
        scratch[sy, sx] = 1.0
scratch = blur(scratch, 1, 0) * 0.7 + scratch * 0.3

height = -groove * 1.0 + rivet * 0.7 - vent * 0.8 + brush * 0.015 - scratch * 0.08

# Colour: light grey metal, darker in grooves and vents, scratches bright.
base = 0.6 * tone * (0.92 + 0.12 * wear)
alb = base * (1 - 0.55 * groove) * (1 - 0.6 * vent) + scratch * 0.12
albedo = np.stack([alb * 0.98, alb, alb * 1.03], -1)

rough = 0.3 + 0.045 * brush + 0.08 * (wear - 0.5) + 0.45 * groove + 0.3 * vent - 0.12 * scratch
ao = 1 - 0.55 * groove - 0.6 * vent - 0.25 * blur(blur(rivet, 3, 0), 3, 1)
metal = 1 - 0.5 * groove
orm = np.stack([ao, rough, metal], -1)

# Normal map from the height field (tangent space, +Y up in the image).
dx = (np.roll(height, -1, 1) - np.roll(height, 1, 1)) * 2.5
dy = (np.roll(height, -1, 0) - np.roll(height, 1, 0)) * 2.5
nrm = np.stack([-dx, dy, np.ones_like(dx)], -1)
nrm /= np.linalg.norm(nrm, axis=-1, keepdims=True)


def save(a, name, srgb):
    a = np.clip(a, 0, 1)
    if srgb:
        a = np.where(a <= 0.0031308, a * 12.92, 1.055 * np.power(a, 1 / 2.4) - 0.055)
    Image.fromarray((a * 255 + 0.5).astype(np.uint8)).save(os.path.join(OUT, name), quality=92, optimize=True)


save(albedo, 'metal_albedo.jpg', True)
save(orm, 'metal_orm.jpg', False)
save(nrm * 0.5 + 0.5, 'metal_normal.jpg', False)
print('metal textures written')
