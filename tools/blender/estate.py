"""
The rest of the estate round JARVIS's house, after Tony Stark's Malibu
house: more of the white disc-roofed pavilions — stacked at different
heights, one cantilevered out over the cliff on a great round column, one
built down into the cliff — curving white garden walls, a round helipad
with its H behind a sweeping parapet, reached by a ramp that swoops down to
the drive. The main pavilion (lair.py) is the one the station is in; these
stand round it.

Built in Blender with real geometry (lathed disc roofs with rounded lips and
skylight hatches, dark glass bands with their mullions), then each surface
gets a detail map: its colour — off-white concrete with a faint mottle,
the helipad's dark deck and paint — with the shade in its corners and under
its overhangs baked in (ambient occlusion over a couple of metres). The sun,
the sky's light and the shadows are drawn live in the browser.

  .bpy/bin/python tools/blender/estate.py                  # full: 4K maps
  .bpy/bin/python tools/blender/estate.py --size 1024 --out /tmp/estate
  .bpy/bin/python tools/blender/estate.py --preview-only --out /tmp/estate

Writes estate.glb, estate_{name}_detail_{ultra,high,low}.jpg and a Cycles
render, estate-preview.png, to public/station (or --out). Positions are
given in the browser's coordinates (x north, y up, z east; the sea to −z)
and turned into Blender's (Z-up, the sea to +Y) here; src/station/layout.ts
(ESTATE) mirrors them.
"""

import math
import os
import sys

import bpy
import bmesh  # after bpy
import numpy as np
from mathutils import Vector
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))


def arg(name, default):
    if name in sys.argv:
        return type(default)(sys.argv[sys.argv.index(name) + 1])
    return default


SIZE = arg('--size', 4096)
OUT = os.path.abspath(arg('--out', os.path.join(ROOT, 'public', 'station')))
PREVIEW_ONLY = '--preview-only' in sys.argv
PREVIEW = '--no-preview' not in sys.argv
GROUND = -0.25  # the lawn's level round the house

# ---------------------------------------------------------------- the plan
# (browser coordinates: x north, z east, y up)

WINGS = [
    # North wing, its far side out over the cliff on a great column: a glass
    # room under a broad disc, a smaller one stacked on top and set back.
    dict(c=(24.5, 8.5), floor=0.0, glass_r=9.0, h=3.4, roof_r=12.5, pier=(32.5, 10.0, 1.7)),
    dict(c=(27.5, 12.5), floor=3.99, glass_r=6.0, h=3.0, roof_r=8.8),  # 4 cm up on the roof below
    # South wing, a storey down, built into the cliff: its roof is a terrace
    # level with the house's, its glass looking out over the sea.
    dict(c=(-27.0, 2.0), floor=-3.9, glass_r=9.6, h=3.4, roof_r=11.2, pier=(-32.0, -1.0, 2.2), roof_terrace=True),
    # Behind the house: the big one, two storeys, the top disc widest.
    dict(c=(3.0, 29.0), floor=0.0, glass_r=11.0, h=3.6, roof_r=14.2),
    dict(c=(5.0, 31.5), floor=4.19, glass_r=8.2, h=3.2, roof_r=12.6),
]
HELIPAD = dict(c=(54.0, 58.0), r=9.5, top=GROUND + 2.4, gap=(2.14, 2.64))  # the parapet's opening (Blender angle), towards the ramp
# The ramp from the helipad's opening sweeping down and round to the drive's turning circle.
RAMP = [(46.7, 51.2, GROUND + 2.4), (39.0, 45.5, GROUND + 2.0), (30.0, 44.5, GROUND + 1.3), (21.0, 48.5, GROUND + 0.6), (14.0, 55.0, GROUND + 0.15), (10.0, 61.0, GROUND + 0.02)]
# Low curving garden walls between the pavilions.
WALLS = [
    [(36.0, 18.0), (40.0, 26.0), (38.0, 34.0), (31.0, 39.0)],
    [(-12.0, 20.0), (-17.0, 28.0), (-14.0, 38.0), (-6.0, 45.0), (6.0, 48.0)],
    [(-30.0, 12.0), (-34.0, 20.0), (-30.0, 30.0)],
]
# The covered link from the house's back door to the big pavilion behind.
LINK = [(0.0, 14.8), (0.8, 17.0), (1.8, 19.2)]


def B(x, z, y=0.0):
    """Browser (x, z) at height y → Blender."""
    return Vector((x, -z, y))


# ---------------------------------------------------------------- helpers

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def link(ob):
    bpy.context.scene.collection.objects.link(ob)
    return ob


def mesh(name, verts, faces, smooth=True, outward=False):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], faces)
    if outward:
        bm = bmesh.new()
        bm.from_mesh(me)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(me)
        bm.free()
    me.update()
    ob = link(bpy.data.objects.new(name, me))
    for p in ob.data.polygons:
        p.use_smooth = smooth
    return ob


def lathe(name, profile, centre, segs=192, closed=False):
    """Revolve a profile [(r, z), ...] round a vertical axis. Profiles that
    start and end on the axis make solids; `closed` ones make rings."""
    if closed:
        profile = profile + [profile[0]]
    # Clockwise in (r, z), so the faces point outwards.
    area = sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(profile, profile[1:] + profile[:1]))
    if area > 0:
        profile = profile[::-1]
    verts, faces = [], []
    n = len(profile)
    for i in range(segs):
        a = i / segs * math.tau
        for r, z in profile:
            verts.append((centre.x + r * math.cos(a), centre.y + r * math.sin(a), z))
    for i in range(segs):
        j = (i + 1) % segs
        for k in range(n - 1):
            faces.append((i * n + k, i * n + k + 1, j * n + k + 1, j * n + k))
    ob = mesh(name, verts, faces)
    # Cap the axis ends (profiles start and end at r = 0 or close themselves).
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bm.normal_update()
    bm.to_mesh(ob.data)
    bm.free()
    sharp(ob, 50)
    return ob


def sharp(ob, angle=40):
    bpy.ops.object.select_all(action='DESELECT')
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    try:
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(angle))
    except Exception:
        pass
    ob.select_set(False)


def cylinder(name, centre, r, z0, z1, segs=96, cap=True):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=cap, cap_tris=False, segments=segs, radius1=r, radius2=r, depth=z1 - z0)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = link(bpy.data.objects.new(name, me))
    ob.location = (centre.x, centre.y, (z0 + z1) / 2)
    apply_transform(ob)
    sharp(ob)
    return ob


def box(name, size, loc, rot_z=0.0):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2]))
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = link(bpy.data.objects.new(name, me))
    ob.location = loc
    ob.rotation_euler = (0, 0, rot_z)
    apply_transform(ob)
    return ob


def apply_transform(ob):
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    ob.select_set(False)


def join(name, parts):
    bpy.ops.object.select_all(action='DESELECT')
    for p in parts:
        p.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    ob.data.name = name
    return ob


def sweep(name, pts, width, z0, z1, segs_per=24):
    """A band along a smooth path through points [(x, z) or (x, z, y)]:
    `width` across, from z0 to z1 above the path's own height."""
    ctrl = [B(p[0], p[1], p[2] if len(p) > 2 else 0.0) for p in pts]
    # Catmull-Rom through the points.
    path = []
    for i in range(len(ctrl) - 1):
        p0 = ctrl[max(i - 1, 0)]
        p1, p2 = ctrl[i], ctrl[i + 1]
        p3 = ctrl[min(i + 2, len(ctrl) - 1)]
        for k in range(segs_per):
            t = k / segs_per
            t2, t3 = t * t, t * t * t
            path.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    path.append(ctrl[-1])
    verts, faces = [], []
    for i, p in enumerate(path):
        q = path[min(i + 1, len(path) - 1)] - path[max(i - 1, 0)]
        side = Vector((-q.y, q.x, 0)).normalized() * (width / 2)
        for s, h in ((-1, z0), (1, z0), (1, z1), (-1, z1)):
            verts.append(p + side * s + Vector((0, 0, h)))
    for i in range(len(path) - 1):
        a, b = i * 4, (i + 1) * 4
        for k in range(4):
            faces.append((a + k, a + (k + 1) % 4, b + (k + 1) % 4, b + k))
    faces.append((3, 2, 1, 0))
    e = (len(path) - 1) * 4
    faces.append((e, e + 1, e + 2, e + 3))
    ob = mesh(name, verts, faces, outward=True)
    sharp(ob, 35)
    return ob


# ---------------------------------------------------------------- parts

def roof_profile(R, top, t=0.55):
    """A disc roof: flat top, the lip rounding down and in, a flat soffit."""
    lip = []
    for k in range(9):
        a = k / 8 * math.pi
        lip.append((R - 0.28 + 0.28 * math.sin(a), top - 0.28 + 0.28 * math.cos(a) - (t - 0.56) * (k / 8)))
    return [(0.0, top)] + [(R - 0.9, top), (R - 0.3, top - 0.01)] + lip + [(R - 0.5, top - t), (R - 1.4, top - t + 0.02), (0.0, top - t + 0.02)]


def wing(w, white, glass, frames, glow):
    c = B(*w['c'])
    floor, h, gr, rr = w['floor'], w['h'], w['glass_r'], w['roof_r']
    top = floor + h + 0.55
    # Floor slab (its edge shows under the glass), the roof disc.
    white.append(lathe('floor', [(0.0, floor), (gr + 0.35, floor), (gr + 0.35, floor - 0.45), (gr - 0.2, floor - 0.6), (0.0, floor - 0.6)], c, 160))
    white.append(lathe('roof', roof_profile(rr, top), c, 224))
    # Skylight hatches on the roof: a raised ring and its glass.
    for k, (dr, da, hr) in enumerate(((0.32, 0.6, 1.3), (0.62, 2.7, 0.95))):
        hc = c + Vector((math.cos(da) * rr * dr, math.sin(da) * rr * dr, 0))
        white.append(lathe('hatch', [(0.0, top + 0.35), (hr - 0.15, top + 0.35), (hr, top + 0.25), (hr + 0.15, top), (0.0, top)], hc, 64))
        glass.append(cylinder('hatchglass', hc, hr - 0.2, top + 0.36, top + 0.38, 48))
    # The glass band and its mullions; a warm glow behind it after dark.
    glass.append(cylinder('band', c, gr, floor, floor + h, 160, cap=False))
    glow.append(cylinder('room', c, gr - 0.4, floor + 0.05, floor + h - 0.1, 96, cap=False))
    n = max(12, int(gr * math.tau / 2.4))
    for k in range(n):
        a = k / n * math.tau
        p = c + Vector((math.cos(a) * (gr + 0.04), math.sin(a) * (gr + 0.04), 0))
        frames.append(box('mullion', (0.09, 0.09, h - 0.16), (p.x, p.y, floor + h / 2), a))  # between sill and head
    frames.append(lathe('sill', [(gr - 0.1, floor + 0.0), (gr + 0.12, floor + 0.0), (gr + 0.12, floor + 0.08), (gr - 0.1, floor + 0.08)], c, 160, closed=True))
    frames.append(lathe('head', [(gr - 0.1, floor + h - 0.08), (gr + 0.12, floor + h - 0.08), (gr + 0.12, floor + h), (gr - 0.1, floor + h)], c, 160, closed=True))
    # A round core inside, so the glass has something behind it.
    white.append(cylinder('core', c, gr * 0.32, floor, floor + h, 64))
    if 'pier' in w:
        x, z, r = w['pier']
        pc = B(x, z)
        # The great column down the cliff, and its flared head under the slab.
        white.append(lathe('pier', [(0.0, floor - 0.6), (r + 0.9, floor - 0.6), (r + 0.2, floor - 2.2), (r, floor - 3.0), (r, -31.0), (0.0, -31.0)], pc, 96))
    if w.get('roof_terrace'):
        # A glass balustrade round the terrace on top.
        glass.append(cylinder('balustrade', c, rr - 0.6, top, top + 1.05, 160, cap=False))
        frames.append(lathe('rail', [(rr - 0.66, top + 1.02), (rr - 0.54, top + 1.02), (rr - 0.54, top + 1.08), (rr - 0.66, top + 1.08)], c, 160, closed=True))


def helipad(white, pad, paint, lights):
    c = B(*HELIPAD['c'])
    r, top = HELIPAD['r'], HELIPAD['top']
    # The raised deck on its drum.
    white.append(lathe('drum', [(0.0, GROUND - 0.3), (r + 0.4, GROUND - 0.3), (r + 0.4, top - 0.12), (r + 0.25, top), (r, top), (r, top - 0.2), (0.0, top - 0.2)], c, 192))
    pad.append(cylinder('deck', c, r, top - 0.2, top + 0.01, 192))
    # The paint: a ring, the H, the touchdown circle's outer line.
    for r0, r1 in ((r * 0.62, r * 0.68), (r - 0.55, r - 0.4)):
        paint.append(lathe('ring', [(r0, top + 0.012), (r1, top + 0.012), (r1, top + 0.022), (r0, top + 0.022)], c, 160, closed=True))
    for (sx, sy, dx, dy) in ((0.5, 3.6, -1.15, 0.0), (0.5, 3.6, 1.15, 0.0), (2.3, 0.5, 0.0, 0.0)):
        paint.append(box('H', (sx, sy, 0.012), (c.x + dx, c.y + dy, top + 0.017)))
    # The parapet: a curved wall round the deck, open towards the ramp.
    g0, g1 = HELIPAD['gap']
    segs = 96
    span = math.tau - (g1 - g0)
    verts, faces = [], []
    for i in range(segs + 1):
        a = g1 + span * i / segs
        for rr, zz in ((r + 0.15, top), (r + 0.55, top), (r + 0.55, top + 1.05), (r + 0.15, top + 1.05)):
            verts.append((c.x + rr * math.cos(a), c.y + rr * math.sin(a), zz))
    for i in range(segs):
        a, b = i * 4, (i + 1) * 4
        for k in range(4):
            faces.append((a + k, a + (k + 1) % 4, b + (k + 1) % 4, b + k))
    faces.append((3, 2, 1, 0))
    faces.append((segs * 4, segs * 4 + 1, segs * 4 + 2, segs * 4 + 3))
    wall = mesh('parapet', verts, faces, outward=True)
    sharp(wall, 35)
    white.append(wall)
    # Edge lights round the deck (lit in the browser).
    for i in range(24):
        a = i / 24 * math.tau
        if g0 < ((a + math.pi) % math.tau) - math.pi < g1:
            continue
        p = c + Vector((math.cos(a) * (r - 0.2), math.sin(a) * (r - 0.2), 0))
        lights.append(cylinder('padlight', p, 0.09, top, top + 0.06, 12))


def ramp(white, pad):
    """The ramp from the helipad down to the drive: a white band with low
    walls either side, sweeping round."""
    pad.append(sweep('rampdeck', RAMP, 4.2, -0.35, 0.0))
    for side in (-1, 1):
        pts = []
        for i, p in enumerate(RAMP):
            q = RAMP[min(i + 1, len(RAMP) - 1)]
            o = RAMP[max(i - 1, 0)]
            dx, dz = q[0] - o[0], q[1] - o[1]
            n = math.hypot(dx, dz)
            pts.append((p[0] - dz / n * 2.25 * side, p[1] + dx / n * 2.25 * side, p[2]))
        white.append(sweep('rampwall', pts, 0.35, -0.6, 0.95))


def garden(white):
    for i, pts in enumerate(WALLS):
        white.append(sweep('gardenwall', [(x, z, GROUND) for x, z in pts], 0.4, -0.3, 1.0 + 0.25 * (i % 2)))
    # The covered link: a curved glass corridor with a white roof and floor.
    white.append(sweep('linkroof', [(x, z, GROUND) for x, z in LINK], 3.6, 3.0, 3.35))
    white.append(sweep('linkfloor', [(x, z, GROUND) for x, z in LINK], 3.4, -0.1, 0.27))


def link_glass(glass):
    for side in (-1, 1):
        pts = []
        for i, (x, z) in enumerate(LINK):
            q = LINK[min(i + 1, len(LINK) - 1)]
            o = LINK[max(i - 1, 0)]
            dx, dz = q[0] - o[0], q[1] - o[1]
            n = math.hypot(dx, dz)
            pts.append((x - dz / n * 1.6 * side, z + dx / n * 1.6 * side, GROUND))
        glass.append(sweep('linkglass', pts, 0.04, 0.52, 3.0))


# ---------------------------------------------------------------- materials, bake

def material(name, color, noise_scale=0.0, rough=0.7):
    m = bpy.data.materials.new(name)
    nt = m.node_tree
    b = nt.nodes['Principled BSDF']
    b.inputs['Roughness'].default_value = rough
    if noise_scale:
        tex = nt.nodes.new('ShaderNodeTexNoise')
        tex.inputs['Scale'].default_value = noise_scale
        tex.inputs['Detail'].default_value = 8
        ramp = nt.nodes.new('ShaderNodeValToRGB')
        ramp.color_ramp.elements[0].color = tuple(v * 0.9 for v in color) + (1,)
        ramp.color_ramp.elements[1].color = tuple(min(1, v * 1.04) for v in color) + (1,)
        nt.links.new(tex.outputs['Fac'], ramp.inputs['Fac'])
        nt.links.new(ramp.outputs['Color'], b.inputs['Base Color'])
    else:
        b.inputs['Base Color'].default_value = (*color, 1)
    return m


def assign(ob, mat):
    ob.data.materials.clear()
    ob.data.materials.append(mat)
    return ob


def unwrap(ob):
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.004, area_weight=0.6, correct_aspect=True)
    bpy.ops.object.mode_set(mode='OBJECT')
    ob.select_set(False)


def bake(ob, kind, size, **kw):
    img = bpy.data.images.new(f'{ob.name}_{kind}', size, size, alpha=False)
    img.colorspace_settings.name = 'Non-Color'
    for slot in ob.material_slots:
        nt = slot.material.node_tree
        node = nt.nodes.get('bake_target') or nt.nodes.new('ShaderNodeTexImage')
        node.name = 'bake_target'
        node.image = img
        nt.nodes.active = node
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.bake(margin=8, use_clear=True, **kw)
    px = np.empty(size * size * 4, np.float32)
    img.pixels.foreach_get(px)
    bpy.data.images.remove(img)
    return px.reshape(size, size, 4)[::-1, :, :3].copy()


def save(arr, name, size):
    a = np.clip(arr, 0, 1)
    a = np.where(a <= 0.0031308, a * 12.92, 1.055 * np.power(a, 1 / 2.4) - 0.055)
    im = Image.fromarray(np.clip(a * 255 + 0.5, 0, 255).astype(np.uint8))
    for level, div in (('ultra', 1), ('high', 2), ('low', 4)):
        s = max(128, size // div)
        (im if s == im.width else im.resize((s, s), Image.LANCZOS)).save(os.path.join(OUT, f'{name}_{level}.jpg'), quality=90, optimize=True)


def bake_detail(ob, size):
    sc = bpy.context.scene
    sc.cycles.samples = 1
    albedo = bake(ob, 'albedo', size, type='DIFFUSE', pass_filter={'COLOR'})
    sc.world.light_settings.distance = 2.5
    sc.cycles.samples = 48
    ao = bake(ob, 'ao', size, type='AO')[..., :1]
    save(albedo * (0.3 + 0.7 * ao), f'estate_{ob.name}_detail', size)
    print('detail', ob.name, flush=True)


def preview():
    sc = bpy.context.scene
    world = sc.world
    nt = world.node_tree
    bg = nt.nodes['Background']
    sky = nt.nodes.new('ShaderNodeTexSky')
    sky.sun_elevation = math.radians(14)
    sky.sun_rotation = math.radians(250)
    nt.links.new(sky.outputs['Color'], bg.inputs['Color'])
    bg.inputs['Strength'].default_value = 0.3
    sea = mesh('sea', [(-900, -900, -28), (900, -900, -28), (900, 900, -28), (-900, 900, -28)], [(0, 1, 2, 3)], smooth=False)
    assign(sea, material('seam', (0.01, 0.04, 0.06), rough=0.08))
    lawn = mesh('lawn', [(-60, -10, GROUND), (110, -10, GROUND), (110, -140, GROUND), (-60, -140, GROUND)], [(0, 1, 2, 3)], smooth=False)
    assign(lawn, material('lawnm', (0.05, 0.12, 0.03), rough=0.9))
    cam = link(bpy.data.objects.new('cam', bpy.data.cameras.new('cam')))
    cam.data.lens = 30
    cam.location = B(-60, -70, 55)
    cam.rotation_euler = (B(16, 30, -4) - cam.location).to_track_quat('-Z', 'Y').to_euler()
    sc.camera = cam
    sc.render.engine = 'CYCLES'
    sc.cycles.samples = 64
    sc.cycles.use_denoising = True
    sc.render.resolution_x, sc.render.resolution_y = 1600, 900
    sc.view_settings.view_transform = 'AgX'
    sc.render.filepath = os.path.join(OUT, 'estate-preview.png')
    bpy.ops.render.render(write_still=True)
    for o in (sea, lawn, cam):
        bpy.data.objects.remove(o)
    print('preview written', flush=True)


def main():
    os.makedirs(OUT, exist_ok=True)
    reset()
    sc = bpy.context.scene
    sc.world = bpy.data.worlds.new('w')
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    white, glass, frames, glow, pad, paint, lights = [], [], [], [], [], [], []
    for w in WINGS:
        wing(w, white, glass, frames, glow)
    helipad(white, pad, paint, lights)
    ramp(white, pad)
    garden(white)
    link_glass(glass)
    concrete = material('concrete', (0.8, 0.79, 0.76), noise_scale=0.8, rough=0.7)
    asphalt = material('deck', (0.11, 0.115, 0.12), noise_scale=6.0, rough=0.85)
    white_paint = material('paint', (0.85, 0.85, 0.83), rough=0.6)
    dark = material('glassm', (0.02, 0.03, 0.04), rough=0.05)
    groups = {
        'white': assign(join('white', white), concrete),
        'pad': assign(join('pad', pad), asphalt),
        'paint': assign(join('paint', paint), white_paint),
        'glass': assign(join('glass', glass), dark),
        'frames': assign(join('frames', frames), dark),
        'glow': assign(join('glow', glow), dark),
        'lights': assign(join('lights', lights), white_paint),
    }
    # The ground, the house and the lawn shade the estate's feet.
    ground = mesh('ground', [(-120, 60, GROUND), (160, 60, GROUND), (160, -200, GROUND), (-120, -200, GROUND)], [(0, 1, 2, 3)], smooth=False)
    assign(ground, material('groundm', (0.2, 0.2, 0.2)))
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(ROOT, 'public', 'station', 'lair.glb'))
    house = [o for o in bpy.data.objects if o not in before and o.type == 'MESH']
    stone = material('housem', (0.62, 0.6, 0.56), rough=0.6)
    for o in house:
        o.data.materials.clear()
        o.data.materials.append(stone)
    if PREVIEW or PREVIEW_ONLY:
        preview()
    if PREVIEW_ONLY:
        return
    for name in ('white', 'pad'):
        unwrap(groups[name])
        bake_detail(groups[name], SIZE if name == 'white' else SIZE // 2)
    for o in [ground, *house]:
        bpy.data.objects.remove(o)
    bpy.ops.object.select_all(action='DESELECT')
    for ob in groups.values():
        ob.select_set(True)
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, 'estate.glb'), export_format='GLB', use_selection=True, export_materials='NONE', export_yup=True, export_apply=True)
    print('exported', flush=True)


main()
