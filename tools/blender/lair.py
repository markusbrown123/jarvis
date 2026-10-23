"""
Builds the JARVIS Station's room — a lair cut into a sea cliff — in Blender
and bakes its lighting with Cycles for the live scene.

Rock walls and a rock ceiling (the cave), a polished dark stone floor with
a raised stage in the middle for the console and the six zones, and across
the back a 130° wall of glass in steel mullions looking out over the sea
(the browser draws the sky and the water live behind it).

Lighting is baked the way games do it, in two layers per surface:

  detail   the surface colour with its crevices darkened (short-range
           ambient occlusion), at full resolution — crisp up close
  light    the light falling on it: moonlight through the window with the
           mullions' shadows, the blue-hour sky, the warm ceiling coves and
           the uplights on the rock, bounced around the room (Cycles global
           illumination), denoised with Open Image Denoise when available

The browser multiplies the two. The floor also gets a normal map, for its
live reflections. Glass and the live light strips are exported as their own
meshes.

Run from the repo root (Blender's Python module, ~400 MB):

  python3 -m venv .bpy && .bpy/bin/pip install bpy pillow
  .bpy/bin/python tools/blender/lair.py                    # full bake
  .bpy/bin/python tools/blender/lair.py --size 512 --light 256 --samples 8  # quick test

Optional: `pip install oidn` for denoising (its bundled libtbb may need a
`libtbb.so.12` symlink next to it); without it a gentler filter is used.

Writes public/station/lair.glb, public/station/{name}_{detail,light}_{ultra,
high,low}.jpg, floor/stage normal maps, and a Cycles render, lair-preview.png.
Blender is Z-up with the window towards +Y; glTF turns that into three.js's
Y-up with the window at −Z, which is where the console's chair faces.
"""

import math
import os
import sys

import bpy
import bmesh  # registered by bpy, so it comes after it
import numpy as np
from mathutils import Vector, noise
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'public', 'station')


def arg(name, default):
    if name in sys.argv:
        return type(default)(sys.argv[sys.argv.index(name) + 1])
    return default


SIZE = arg('--size', 4096)  # detail maps
LIGHT = arg('--light', 2048)  # lightmaps
SAMPLES = arg('--samples', 96)
PREVIEW = '--no-preview' not in sys.argv
# Lighting is stored as light / LM_SCALE so bright spots survive 8 bits.
LM_SCALE = 4.0

R = 15.0  # rock wall radius
H = 9.0  # ceiling height
STAGE_R = 8.1
STAGE_H = 0.16
WIN_R = 14.5
WIN_SPAN = math.radians(130)
FORWARD = math.pi / 2  # +Y: the window
SILL = 0.6
HEAD = 7.4
MULLIONS = 12
# The rock band in three parts, so the overview can cut the front one away.
ROCK_PARTS = {
    'rock_left': (FORWARD + WIN_SPAN / 2 - 0.02, math.radians(225)),
    'rock_front': (math.radians(225), math.radians(315)),
    'rock_right': (math.radians(315), FORWARD - WIN_SPAN / 2 + math.tau + 0.02),
}
MOON_ELEV = math.radians(17)
MOON_AZ = FORWARD - math.radians(14)  # a little to the right of centre, seen from inside


# ---------------------------------------------------------------- helpers

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def link(ob):
    bpy.context.scene.collection.objects.link(ob)
    return ob


def evaluated(ob, name):
    """Bake modifiers/curves into a plain mesh object called name."""
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    out = bpy.data.objects.new(name + '_tmp', me)
    out.matrix_world = ob.matrix_world
    link(out)
    bpy.data.objects.remove(ob)
    out.name = name
    out.data.name = name
    return out


def sector(name, r_in, r_out, z0, z1, a0, a1, bevel=0.01, res=None):
    """A slab cut from a ring between angles a0..a1 (or a full disc/ring)."""
    full = a1 - a0 >= math.tau - 1e-6
    res = res or max(16, int(abs(a1 - a0) / math.tau * 256))
    cu = bpy.data.curves.new(name, 'CURVE')
    cu.dimensions = '2D'
    cu.fill_mode = 'BOTH'
    loops = []
    if full:
        loops.append([(r_out * math.cos(a), r_out * math.sin(a)) for a in np.linspace(0, math.tau, res, endpoint=False)])
        if r_in > 0:
            loops.append([(r_in * math.cos(a), r_in * math.sin(a)) for a in np.linspace(math.tau, 0, res, endpoint=False)])
    else:
        pts = [(r_out * math.cos(a), r_out * math.sin(a)) for a in np.linspace(a0, a1, res)]
        pts += [(r_in * math.cos(a), r_in * math.sin(a)) for a in np.linspace(a1, a0, res)]
        loops.append(pts)
    for loop in loops:
        sp = cu.splines.new('POLY')
        sp.points.add(len(loop) - 1)
        for i, (x, y) in enumerate(loop):
            sp.points[i].co = (x, y, 0, 1)
        sp.use_cyclic_u = True
    h = z1 - z0
    cu.bevel_depth = min(bevel, h / 2 - 1e-4)
    cu.bevel_resolution = 2
    cu.extrude = max(0.0, h / 2 - cu.bevel_depth)
    cu.offset = -cu.bevel_depth
    ob = link(bpy.data.objects.new(name, cu))
    ob.location.z = (z0 + z1) / 2
    return evaluated(ob, name)


def box(name, half, loc, rot_z=0.0, bevel=0.01):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=2.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * half[0], v.co.y * half[1], v.co.z * half[2]))
    bm.to_mesh(me)
    bm.free()
    ob = link(bpy.data.objects.new(name, me))
    ob.location = loc
    ob.rotation_euler.z = rot_z
    if bevel:
        m = ob.modifiers.new('bevel', 'BEVEL')
        m.width = bevel
        m.segments = 2
    return evaluated(ob, name)


def join(name, parts):
    bpy.ops.object.select_all(action='DESELECT')
    for p in parts:
        p.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    ob.name = name
    ob.data.name = name
    return ob


def fbm(p, octaves=5):
    return noise.fractal(p, 0.55, 2.1, octaves, noise_basis='PERLIN_ORIGINAL')


# ---------------------------------------------------------------- rock

def rock_band(name, a0, a1, seg_per_rad=40, rows=56):
    """A cave wall: a cylinder band from a0 to a1, pushed in and out by noise.

    Faces point inwards. The rock bulges towards the room near the window's
    edges, framing it, and leans in at the top where it meets the ceiling.
    """
    cols = max(8, int((a1 - a0) * seg_per_rad))
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    grid = []
    for j in range(rows + 1):
        z = -0.3 + (H + 0.9) * j / rows
        row = []
        for i in range(cols + 1):
            a = a0 + (a1 - a0) * i / cols
            d = Vector((math.cos(a), math.sin(a), 0))
            p = Vector((math.cos(a) * 3.1, math.sin(a) * 3.1, z * 0.32))
            # Large lumpy forms, then strata: ledges that wander along the wall.
            r = R + 1.1 * fbm(p * 0.6) + 0.35 * fbm(p * 2.2, 4)
            strata = z * 2.3 + 1.6 * fbm(p * 0.8, 3)
            r -= 0.22 * (abs((strata % 2.0) - 1.0) ** 3)
            # Rock masses either side of the window.
            for edge in (FORWARD + WIN_SPAN / 2, FORWARD - WIN_SPAN / 2):
                da = math.atan2(math.sin(a - edge), math.cos(a - edge))
                r -= 1.1 * math.exp(-(da / 0.09) ** 2)
            # Leaning in towards the ceiling, out a little at the floor.
            r -= 0.9 * max(0.0, (z - H * 0.65) / (H * 0.35)) ** 2
            row.append(bm.verts.new((d.x * r, d.y * r, z)))
        grid.append(row)
    for j in range(rows):
        for i in range(cols):
            # Wound so the faces look into the room.
            bm.faces.new((grid[j][i], grid[j + 1][i], grid[j + 1][i + 1], grid[j][i + 1]))
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    ob = link(bpy.data.objects.new(name, me))
    for p in ob.data.polygons:
        p.use_smooth = True
    return ob


def rock_ceiling():
    """A rock vault: a disc with its underside pushed down by noise, coves cut in."""
    me = bpy.data.meshes.new('ceiling')
    bm = bmesh.new()
    rings, segs = 40, 160
    verts = []
    for j in range(rings + 1):
        rr = (R + 0.6) * j / rings
        row = []
        for i in range(segs if j else 1):
            a = math.tau * i / segs
            x, y = rr * math.cos(a), rr * math.sin(a)
            p = Vector((x * 0.22, y * 0.22, 7.0))
            z = H + 0.6 - 0.7 * (0.5 + 0.5 * fbm(p)) - 0.15 * fbm(p * 4, 3)
            # Coves: two shallow channels the light rings sit in.
            for cove in (2.4, 6.0):
                z += 0.35 * math.exp(-((rr - cove) / 0.45) ** 2)
            row.append(bm.verts.new((x, y, z)))
        verts.append(row)
    for i in range(segs):
        bm.faces.new((verts[0][0], verts[1][(i + 1) % segs], verts[1][i]))
    for j in range(1, rings):
        for i in range(segs):
            bm.faces.new((verts[j][i], verts[j][(i + 1) % segs], verts[j + 1][(i + 1) % segs], verts[j + 1][i]))
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    ob = link(bpy.data.objects.new('ceiling', me))
    for p in ob.data.polygons:
        p.use_smooth = True
    return ob


# ---------------------------------------------------------------- materials

def new_mat(name):
    m = bpy.data.materials.new(name)
    return m, m.node_tree, m.node_tree.nodes['Principled BSDF']


def n(nt, kind, **inputs):
    node = nt.nodes.new(kind)
    for k, v in inputs.items():
        if k.startswith('_'):
            setattr(node, k[1:], v)
        else:
            node.inputs[k].default_value = v
    return node


def rock_material():
    """Dark layered rock: big mottling, wandering strata, fine grit."""
    m, nt, b = new_mat('rock')
    L = nt.links.new
    co = n(nt, 'ShaderNodeTexCoord')
    big = n(nt, 'ShaderNodeTexNoise', Scale=0.25, Detail=6.0, Roughness=0.6)
    L(co.outputs['Object'], big.inputs['Vector'])
    # Strata: bands along the height, bent by noise.
    warp = n(nt, 'ShaderNodeTexNoise', Scale=0.5, Detail=4.0)
    L(co.outputs['Object'], warp.inputs['Vector'])
    sep = n(nt, 'ShaderNodeSeparateXYZ')
    L(co.outputs['Object'], sep.inputs['Vector'])
    bend = n(nt, 'ShaderNodeMath', _operation='MULTIPLY_ADD')
    L(warp.outputs['Fac'], bend.inputs[0])
    bend.inputs[1].default_value = 1.4
    L(sep.outputs['Z'], bend.inputs[2])
    band = n(nt, 'ShaderNodeMath', _operation='MULTIPLY')
    band.inputs[1].default_value = 3.1
    L(bend.outputs['Value'], band.inputs[0])
    sine = n(nt, 'ShaderNodeMath', _operation='SINE')
    L(band.outputs['Value'], sine.inputs[0])
    grit = n(nt, 'ShaderNodeTexNoise', Scale=9.0, Detail=12.0, Roughness=0.7)
    L(co.outputs['Object'], grit.inputs['Vector'])
    # Colour: cool grey to warm umber by the big noise, banded, gritty.
    ramp = n(nt, 'ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].color = (0.028, 0.03, 0.034, 1)
    ramp.color_ramp.elements[1].color = (0.12, 0.105, 0.09, 1)
    mixf = n(nt, 'ShaderNodeMath', _operation='MULTIPLY_ADD')
    L(sine.outputs['Value'], mixf.inputs[0])
    mixf.inputs[1].default_value = 0.12
    L(big.outputs['Fac'], mixf.inputs[2])
    L(mixf.outputs['Value'], ramp.inputs['Fac'])
    gritc = n(nt, 'ShaderNodeMapRange', **{'To Min': 0.75, 'To Max': 1.1})
    L(grit.outputs['Fac'], gritc.inputs['Value'])
    mix = n(nt, 'ShaderNodeMix', _data_type='RGBA', _blend_type='MULTIPLY', Factor=1.0)
    L(ramp.outputs['Color'], mix.inputs[6])
    L(gritc.outputs['Result'], mix.inputs[7])
    L(mix.outputs[2], b.inputs['Base Color'])
    b.inputs['Roughness'].default_value = 0.86
    height = n(nt, 'ShaderNodeMath', _operation='MULTIPLY_ADD')
    L(sine.outputs['Value'], height.inputs[0])
    height.inputs[1].default_value = 0.35
    L(grit.outputs['Fac'], height.inputs[2])
    bump = n(nt, 'ShaderNodeBump', Strength=0.7, Distance=0.05)
    L(height.outputs['Value'], bump.inputs['Height'])
    L(bump.outputs['Normal'], b.inputs['Normal'])
    return m


def stone_material(name, base, base2, rough, slab, seam=0.006, radial=False):
    """Polished dark stone in large slabs with fine seams."""
    m, nt, b = new_mat(name)
    L = nt.links.new
    co = n(nt, 'ShaderNodeTexCoord')
    vary = n(nt, 'ShaderNodeTexNoise', Scale=0.6, Detail=6.0)
    L(co.outputs['Object'], vary.inputs['Vector'])
    grain = n(nt, 'ShaderNodeTexNoise', Scale=24.0, Detail=10.0)
    L(co.outputs['Object'], grain.inputs['Vector'])
    ramp = n(nt, 'ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].color = (*base, 1)
    ramp.color_ramp.elements[1].color = (*base2, 1)
    L(vary.outputs['Fac'], ramp.inputs['Fac'])
    if radial:
        # Rings and spokes, like stone laid round a centre.
        sep = n(nt, 'ShaderNodeSeparateXYZ')
        L(co.outputs['Object'], sep.inputs['Vector'])
        ang = n(nt, 'ShaderNodeMath', _operation='ARCTAN2')
        L(sep.outputs['Y'], ang.inputs[0])
        L(sep.outputs['X'], ang.inputs[1])
        spokes = n(nt, 'ShaderNodeMath', _operation='MULTIPLY')
        spokes.inputs[1].default_value = 36 / math.tau
        L(ang.outputs['Value'], spokes.inputs[0])
        ln = n(nt, 'ShaderNodeVectorMath', _operation='LENGTH')
        L(co.outputs['Object'], ln.inputs[0])
        rings = n(nt, 'ShaderNodeMath', _operation='MULTIPLY')
        rings.inputs[1].default_value = 1 / slab
        L(ln.outputs['Value'], rings.inputs[0])
        seams = []
        for src, w in ((spokes, 0.02), (rings, seam / slab)):
            pp = n(nt, 'ShaderNodeMath', _operation='PINGPONG')
            pp.inputs[1].default_value = 0.5
            L(src.outputs['Value'], pp.inputs[0])
            gt = n(nt, 'ShaderNodeMath', _operation='GREATER_THAN')
            gt.inputs[1].default_value = w
            L(pp.outputs['Value'], gt.inputs[0])
            seams.append(gt)
        seam_mask = n(nt, 'ShaderNodeMath', _operation='MINIMUM')
        L(seams[0].outputs['Value'], seam_mask.inputs[0])
        L(seams[1].outputs['Value'], seam_mask.inputs[1])
        mask_out = seam_mask.outputs['Value']
    else:
        brick = n(nt, 'ShaderNodeTexBrick', Scale=1.0 / slab, **{'Mortar Size': seam, 'Mortar Smooth': 0.1, 'Brick Width': 1.0, 'Row Height': 1.0, 'Bias': 0.0})
        brick.inputs['Color1'].default_value = (1, 1, 1, 1)
        brick.inputs['Color2'].default_value = (1, 1, 1, 1)
        brick.inputs['Mortar'].default_value = (0, 0, 0, 1)
        brick.offset = 0.5
        L(co.outputs['Object'], brick.inputs['Vector'])
        mask_out = brick.outputs['Fac']
        inv = n(nt, 'ShaderNodeMath', _operation='SUBTRACT')
        inv.inputs[0].default_value = 1.0
        L(brick.outputs['Fac'], inv.inputs[1])
        mask_out = inv.outputs['Value']
    darken = n(nt, 'ShaderNodeMapRange', **{'To Min': 0.45, 'To Max': 1.0})
    L(mask_out, darken.inputs['Value'])
    mix = n(nt, 'ShaderNodeMix', _data_type='RGBA', _blend_type='MULTIPLY', Factor=1.0)
    L(ramp.outputs['Color'], mix.inputs[6])
    L(darken.outputs['Result'], mix.inputs[7])
    L(mix.outputs[2], b.inputs['Base Color'])
    rmap = n(nt, 'ShaderNodeMapRange', **{'To Min': rough - 0.06, 'To Max': rough + 0.08})
    L(grain.outputs['Fac'], rmap.inputs['Value'])
    L(rmap.outputs['Result'], b.inputs['Roughness'])
    b.inputs['Metallic'].default_value = 0.0
    bump = n(nt, 'ShaderNodeBump', Strength=0.5, Distance=0.004)
    L(mask_out, bump.inputs['Height'])
    L(bump.outputs['Normal'], b.inputs['Normal'])
    return m


def steel_material():
    m, nt, b = new_mat('frame')
    b.inputs['Base Color'].default_value = (0.03, 0.033, 0.04, 1)
    b.inputs['Metallic'].default_value = 0.9
    b.inputs['Roughness'].default_value = 0.35
    return m


def concrete_material():
    m, nt, b = new_mat('concrete')
    L = nt.links.new
    co = n(nt, 'ShaderNodeTexCoord')
    nz = n(nt, 'ShaderNodeTexNoise', Scale=3.0, Detail=10.0)
    L(co.outputs['Object'], nz.inputs['Vector'])
    ramp = n(nt, 'ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].color = (0.05, 0.05, 0.055, 1)
    ramp.color_ramp.elements[1].color = (0.09, 0.09, 0.095, 1)
    L(nz.outputs['Fac'], ramp.inputs['Fac'])
    L(ramp.outputs['Color'], b.inputs['Base Color'])
    b.inputs['Roughness'].default_value = 0.8
    return m


def emission(name, color, strength):
    m, nt, b = new_mat(name)
    b.inputs['Base Color'].default_value = (0, 0, 0, 1)
    b.inputs['Emission Color'].default_value = (*color, 1)
    b.inputs['Emission Strength'].default_value = strength
    return m


def assign(ob, mat):
    ob.data.materials.clear()
    ob.data.materials.append(mat)


# ---------------------------------------------------------------- build

def build():
    reset()
    sc = bpy.context.scene
    rock = rock_material()
    floor_m = stone_material('floor_m', (0.028, 0.03, 0.036), (0.045, 0.047, 0.055), 0.22, 2.4)
    stage_m = stone_material('stage_m', (0.02, 0.022, 0.028), (0.034, 0.036, 0.044), 0.16, 1.35, radial=True)
    frame = steel_material()
    concrete = concrete_material()
    warm = emission('warm', (1.0, 0.72, 0.45), 18.0)
    cool = emission('cool', (0.55, 0.65, 1.0), 10.0)
    up = emission('uplight', (1.0, 0.68, 0.4), 30.0)

    parts = {}
    for name, (a0, a1) in ROCK_PARTS.items():
        ob = rock_band(name, a0, a1)
        assign(ob, rock)
        parts[name] = ob
    ceil = rock_ceiling()
    assign(ceil, rock)
    parts['ceiling'] = ceil

    floor = sector('floor', STAGE_R - 0.05, R + 1.2, -0.05, 0.0, 0, math.tau, bevel=0.0, res=192)
    assign(floor, floor_m)
    parts['floor'] = floor
    stage = sector('stage', 0, STAGE_R, -0.02, STAGE_H, 0, math.tau, bevel=0.03, res=192)
    assign(stage, stage_m)
    parts['stage'] = stage

    # The window wall: sill, header, mullions and a transom, in steel and concrete.
    a0, a1 = FORWARD - WIN_SPAN / 2, FORWARD + WIN_SPAN / 2
    sill = sector('sill', WIN_R - 0.25, WIN_R + 0.45, -0.02, SILL, a0, a1, bevel=0.02)
    head = sector('head', WIN_R - 0.35, WIN_R + 0.45, HEAD, H + 0.7, a0, a1, bevel=0.02)
    for ob in (sill, head):
        assign(ob, concrete)
    frames = []
    for i in range(MULLIONS + 1):
        a = a0 + (a1 - a0) * i / MULLIONS
        mull = box(f'mull{i}', (0.18, 0.09, (HEAD - SILL) / 2), (WIN_R * math.cos(a), WIN_R * math.sin(a), (HEAD + SILL) / 2), a, bevel=0.015)
        assign(mull, frame)
        frames.append(mull)
    transom = sector('transom', WIN_R - 0.12, WIN_R + 0.12, 2.75, 2.88, a0, a1, bevel=0.01)
    assign(transom, frame)
    window = join('window', [sill, head, transom, *frames])
    parts['window'] = window

    # Lights that are part of the room: ceiling coves, uplights on the rock.
    lights = []
    for r, mat, nm in ((2.4, cool, 'emit_halo'), (6.0, warm, 'cove_warm')):
        ring = sector(nm, r - 0.05, r + 0.05, H + 0.1, H + 0.2, 0, math.tau, bevel=0.01, res=160)
        assign(ring, mat)
        lights.append(ring)
    ups = []
    for i in range(14):
        a = FORWARD + WIN_SPAN / 2 + 0.25 + (math.tau - WIN_SPAN - 0.5) * i / 13
        x, y = (R - 1.6) * math.cos(a), (R - 1.6) * math.sin(a)
        u = box(f'up{i}', (0.09, 0.09, 0.012), (x, y, 0.012), a, bevel=0.006)
        assign(u, up)
        ups.append(u)
        # The light itself: a warm spot grazing up the rock face.
        sl = bpy.data.lights.new(f'upspot{i}', 'SPOT')
        sl.energy = 900
        sl.color = (1.0, 0.7, 0.42)
        sl.spot_size = math.radians(58)
        sl.spot_blend = 0.6
        sl.shadow_soft_size = 0.05
        so = link(bpy.data.objects.new(f'upspot{i}', sl))
        so.location = (x, y, 0.05)
        aim = Vector((R * math.cos(a), R * math.sin(a), 4.2)) - so.location
        so.rotation_euler = aim.to_track_quat('-Z', 'Y').to_euler()
    uplights = join('uplights', ups)
    edge = sector('emit_stage', STAGE_R + 0.005, STAGE_R + 0.02, 0.05, 0.08, 0, math.tau, bevel=0.003, res=192)
    assign(edge, cool)
    lights += [uplights, edge]

    glass = sector('glass', WIN_R - 0.01, WIN_R + 0.01, SILL, HEAD, a0, a1, bevel=0.0)

    # Moonlight from outside the window; blue-hour sky behind it.
    world = bpy.data.worlds.new('sky')
    sc.world = world
    bg = world.node_tree.nodes.get('Background')
    if bg:
        bg.inputs['Color'].default_value = (0.03, 0.05, 0.11, 1)
        bg.inputs['Strength'].default_value = 1.6
    moon = bpy.data.lights.new('moon', 'SUN')
    moon.energy = 1.4
    moon.color = (0.62, 0.72, 1.0)
    moon.angle = math.radians(0.6)
    mo = link(bpy.data.objects.new('moon', moon))
    d = Vector((math.cos(MOON_AZ) * math.cos(MOON_ELEV), math.sin(MOON_AZ) * math.cos(MOON_ELEV), math.sin(MOON_ELEV)))
    mo.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()
    # A soft cool light over the stage, as the console's monitors and the
    # zones would give off.
    pool = bpy.data.lights.new('pool', 'AREA')
    pool.energy = 260
    pool.size = 6
    pool.color = (0.55, 0.62, 1.0)
    po = link(bpy.data.objects.new('pool', pool))
    po.location = (0, 0, 6.5)
    return parts, lights, glass


# ---------------------------------------------------------------- bake

def unwrap(ob):
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.003, area_weight=0.5, correct_aspect=True)
    bpy.ops.object.mode_set(mode='OBJECT')


def bake(ob, kind, size, float_buffer=False, **kw):
    img = bpy.data.images.new(f'{ob.name}_{kind}', size, size, alpha=False, float_buffer=float_buffer)
    img.colorspace_settings.name = 'sRGB' if kind == 'albedo' else 'Non-Color'
    for slot in ob.material_slots:
        nt = slot.material.node_tree
        node = nt.nodes.get('bake_target') or nt.nodes.new('ShaderNodeTexImage')
        node.name = 'bake_target'
        node.image = img
        nt.nodes.active = node
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.bake(margin=6, use_clear=True, **kw)
    px = np.empty(size * size * 4, np.float32)
    img.pixels.foreach_get(px)
    bpy.data.images.remove(img)
    return px.reshape(size, size, 4)[::-1, :, :3].copy()


def denoise(color, albedo, normal):
    """Clean the bake's sampling noise. Expects colour in 0..1 (OIDN's LDR mode)."""
    try:
        import oidn

        out = np.zeros_like(color)
        h, w = color.shape[:2]
        dev = oidn.NewDevice()
        oidn.CommitDevice(dev)
        f = oidn.NewFilter(dev, 'RT')
        for name, arr in (('color', color), ('albedo', albedo), ('normal', normal), ('output', out)):
            oidn.SetSharedFilterImage(f, name, np.ascontiguousarray(arr, np.float32), oidn.FORMAT_FLOAT3, w, h)
        oidn.CommitFilter(f)
        oidn.ExecuteFilter(f)
        oidn.ReleaseFilter(f)
        oidn.ReleaseDevice(dev)
        print('  denoised with OIDN', flush=True)
        return out
    except Exception as e:  # no OIDN: a normal-aware blur instead
        print('  OIDN unavailable, filtering instead:', e, flush=True)
        out = color.copy()
        for _ in range(3):
            pad = np.pad(out, ((2, 2), (2, 2), (0, 0)), mode='edge')
            npad = np.pad(normal, ((2, 2), (2, 2), (0, 0)), mode='edge')
            acc = np.zeros_like(out)
            wsum = np.zeros(out.shape[:2] + (1,), np.float32)
            h, w = out.shape[:2]
            for dy in range(-2, 3):
                for dx in range(-2, 3):
                    nb = npad[2 + dy : 2 + dy + h, 2 + dx : 2 + dx + w]
                    wgt = np.clip((nb * normal).sum(-1, keepdims=True), 0, 1) ** 8 * math.exp(-(dx * dx + dy * dy) / 4)
                    acc += pad[2 + dy : 2 + dy + h, 2 + dx : 2 + dx + w] * wgt
                    wsum += wgt
            out = acc / np.maximum(wsum, 1e-6)
        return out


def save(arr, name, size, srgb, quality=90):
    """Write ultra (full), high (half) and low (quarter) versions."""
    a = np.clip(arr, 0, 1)
    if srgb:
        a = np.where(a <= 0.0031308, a * 12.92, 1.055 * np.power(a, 1 / 2.4) - 0.055)
    im = Image.fromarray(np.clip(a * 255 + 0.5, 0, 255).astype(np.uint8))
    for level, div in (('ultra', 1), ('high', 2), ('low', 4)):
        s = max(128, size // div)
        (im if s == im.width else im.resize((s, s), Image.LANCZOS)).save(os.path.join(OUT, f'{name}_{level}.jpg'), quality=quality, optimize=True)


def bake_surface(ob, detail_size, light_size, normal_map=False):
    sc = bpy.context.scene
    unwrap(ob)
    sc.cycles.samples = 1
    albedo = bake(ob, 'albedo', detail_size, type='DIFFUSE', pass_filter={'COLOR'})
    sc.world.light_settings.distance = 0.35
    sc.cycles.samples = 24
    ao = bake(ob, 'ao', detail_size, type='AO')[..., :1]
    # Detail: colour with its crevices darkened. (Albedo is linear here;
    # it's saved as sRGB.)
    save(albedo * (0.35 + 0.65 * ao), f'{ob.name}_detail', detail_size, srgb=True)
    if normal_map:
        sc.cycles.samples = 1
        nrm = bake(ob, 'normal', detail_size, type='NORMAL', normal_space='TANGENT')
        save(nrm, f'{ob.name}_normal', detail_size, srgb=False, quality=94)
    # Light: everything falling on the surface, bounced, at lightmap size.
    sc.cycles.samples = SAMPLES
    light = bake(ob, 'light', light_size, float_buffer=True, type='DIFFUSE', pass_filter={'DIRECT', 'INDIRECT'})
    sc.cycles.samples = 1
    alb_small = bake(ob, 'albedo', light_size, type='DIFFUSE', pass_filter={'COLOR'})
    nrm_ws = bake(ob, 'normal', light_size, type='NORMAL', normal_space='OBJECT')
    light = denoise(np.clip(light / LM_SCALE, 0, 1), np.full_like(alb_small, 0.5), nrm_ws * 2 - 1)
    save(light, f'{ob.name}_light', light_size, srgb=True, quality=92)
    print('baked', ob.name, flush=True)


def export(objs):
    bpy.ops.object.select_all(action='DESELECT')
    for ob in objs:
        ob.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=os.path.join(OUT, 'lair.glb'),
        export_format='GLB',
        use_selection=True,
        export_materials='NONE',
        export_tangents=True,
        export_yup=True,
        export_apply=True,
    )
    print('exported', flush=True)


def preview():
    """A full Cycles render from the console's chair, looking out of the window."""
    sc = bpy.context.scene
    glass = bpy.data.objects.get('glass')
    if glass:
        glass.hide_render = True
    cam = link(bpy.data.objects.new('cam', bpy.data.cameras.new('cam')))
    cam.data.lens = 24
    cam.location = (0, -4.4, 2.5)
    cam.rotation_euler = (Vector((0, 8, 1.6)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
    sc.camera = cam
    sc.render.resolution_x = 1600
    sc.render.resolution_y = 900
    sc.cycles.samples = arg('--preview-samples', 128)
    sc.cycles.use_denoising = True
    sc.view_settings.view_transform = 'AgX'
    sc.render.filepath = os.path.join(OUT, 'lair-preview.png')
    bpy.ops.render.render(write_still=True)
    print('preview written', flush=True)


def main():
    os.makedirs(OUT, exist_ok=True)
    parts, lights, glass = build()
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.max_bounces = 6
    sc.cycles.diffuse_bounces = 4
    # The glass is drawn live; for the bake the window is open.
    glass.hide_render = True
    plan = [
        ('floor', SIZE, LIGHT, True),
        ('stage', SIZE, LIGHT, True),
        ('rock_left', SIZE // 2, LIGHT // 2, False),
        ('rock_front', SIZE // 2, LIGHT // 2, False),
        ('rock_right', SIZE // 2, LIGHT // 2, False),
        ('window', SIZE // 2, LIGHT // 2, False),
        ('ceiling', SIZE // 2, LIGHT // 2, False),
    ]
    for name, ds, ls, nm in plan:
        bake_surface(parts[name], max(256, ds), max(128, ls), nm)
    glass.hide_render = False
    export([*parts.values(), *lights, glass])
    if PREVIEW:
        preview()


main()
