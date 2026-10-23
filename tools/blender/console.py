"""
Builds the JARVIS Station's centre console in Blender and bakes it for the
live scene.

The console is a raised round platform with a wide C-shaped command desk on
it. Blender models it (curves with real bevels), gives it procedural
materials — brushed steel, seamed panels, a vented plinth — and then Cycles
bakes them into texture sets the browser can show in real time:

  albedo   the surface colour
  orm      ambient occlusion (R, ray-traced), roughness (G), metalness (B)
  normal   the panel seams, vents and brushing as surface relief

The light strips and the glass inlay are exported as their own meshes so
the scene can light them in JARVIS's colour live.

Run it from the repo root (it needs Blender's Python module, ~400 MB):

  python3 -m venv .bpy && .bpy/bin/pip install bpy pillow
  .bpy/bin/python tools/blender/console.py              # 4K bake + preview
  .bpy/bin/python tools/blender/console.py --size 1024  # quick test

Writes public/station/console.glb, public/station/{desk,dais,chair}_{albedo,
orm,normal}_{ultra,high,low}.jpg (4096/2048/1024 for desk and platform,
half that for the chair), and a Cycles render, console-preview.png.

Blender is Z-up with the desk opening towards +Y; the glTF export turns
that into three.js's Y-up with the desk facing −Z (the back of the room).
"""

import math
import os
import sys

import bpy
import numpy as np
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'public', 'station')


def arg(name, default):
    if name in sys.argv:
        return type(default)(sys.argv[sys.argv.index(name) + 1])
    return default


SIZE = arg('--size', 4096)
SAMPLES = arg('--samples', 48)
PREVIEW_SAMPLES = arg('--preview-samples', 96)
PREVIEW = '--no-preview' not in sys.argv

# Dimensions (metres). The platform sits on the island deck.
DAIS_R = 2.05
TIER2_R = 1.9
TIER1_H = 0.12
DAIS_TOP = 0.22
DESK_IN = 0.95
DESK_OUT = 1.7
DESK_SPAN = math.radians(200)
DESK_Z = DAIS_TOP + 0.70  # underside of the top
DESK_T = 0.06
FORWARD = math.pi / 2  # +Y
STEP_SPAN = math.radians(56)
PEDESTALS = [-70, 0, 70]  # degrees from forward
RISER_IN = DESK_OUT - 0.32  # the raised back shelf the monitors stand on
RISER_H = 0.07
MONITORS = [-72, -28, 28, 72]  # degrees from forward
MON_R = DESK_OUT - 0.17
CHAIR_Y = 0.2  # the chair sits a little forward of the centre


# ---------------------------------------------------------------- geometry

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def to_mesh(ob, name):
    """Evaluate a curve (bevels and all) into a plain mesh object."""
    # New objects and their transforms only exist for evaluation after an update.
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    out = bpy.data.objects.new(name, me)
    out.matrix_world = ob.matrix_world
    bpy.context.scene.collection.objects.link(out)
    bpy.data.objects.remove(ob)
    out.name = name  # free now, so no ".001"
    return out


def outline(r_in, r_out, span, centre, res):
    """Points of an annulus sector (or a full ring/disc when span is 2π)."""
    if span >= math.tau - 1e-6:
        outer = [(r_out * math.cos(a), r_out * math.sin(a)) for a in np.linspace(0, math.tau, res, endpoint=False)]
        inner = [(r_in * math.cos(a), r_in * math.sin(a)) for a in np.linspace(0, math.tau, res, endpoint=False)] if r_in > 0 else None
        return [outer] + ([inner[::-1]] if inner else [])
    a0, a1 = centre - span / 2, centre + span / 2
    pts = [(r_out * math.cos(a), r_out * math.sin(a)) for a in np.linspace(a0, a1, res)]
    pts += [(r_in * math.cos(a), r_in * math.sin(a)) for a in np.linspace(a1, a0, res)]
    return [pts]


def slab(name, r_in, r_out, z0, z1, span=math.tau, centre=FORWARD, bevel=0.01, res=160):
    """A flat piece cut from a ring, extruded between z0 and z1 with rounded edges."""
    cu = bpy.data.curves.new(name, 'CURVE')
    cu.dimensions = '2D'
    cu.fill_mode = 'BOTH'
    for loop in outline(r_in, r_out, span, centre, res):
        sp = cu.splines.new('POLY')
        sp.points.add(len(loop) - 1)
        for i, (x, y) in enumerate(loop):
            sp.points[i].co = (x, y, 0, 1)
        sp.use_cyclic_u = True
    h = z1 - z0
    cu.bevel_depth = min(bevel, h / 2 - 1e-4)
    cu.bevel_resolution = 3
    cu.extrude = max(0.0, h / 2 - cu.bevel_depth)
    cu.offset = -cu.bevel_depth  # keep the outline where it was drawn
    ob = bpy.data.objects.new(name, cu)
    ob.location.z = (z0 + z1) / 2
    bpy.context.scene.collection.objects.link(ob)
    return to_mesh(ob, name)


def block(name, size, loc, rot_z, bevel=0.012):
    me = bpy.data.meshes.new(name)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    import bmesh

    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=2.0)  # ±1, so size is half-extents
    for v in bm.verts:
        v.co.x *= size[0]
        v.co.y *= size[1]
        v.co.z *= size[2]
    bm.to_mesh(me)
    bm.free()
    ob.location = loc
    ob.rotation_euler.z = rot_z
    mod = ob.modifiers.new('bevel', 'BEVEL')
    mod.width = bevel
    mod.segments = 3
    mod.limit_method = 'ANGLE'
    # New objects and their transforms only exist for evaluation after an update.
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    me2 = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    out = bpy.data.objects.new(name, me2)
    out.matrix_world = ob.matrix_world
    bpy.context.scene.collection.objects.link(out)
    bpy.data.objects.remove(ob)
    out.name = name  # free now, so no ".001"
    return out


def join(name, parts):
    bpy.ops.object.select_all(action='DESELECT')
    for p in parts:
        p.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    ob.data.name = name
    # Bake-ready: transforms applied, smooth shading where the bevels are.
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(35))
    return ob


# ---------------------------------------------------------------- materials

def node(nt, kind, loc=(0, 0), **props):
    n = nt.nodes.new(kind)
    n.location = loc
    for k, v in props.items():
        setattr(n, k, v)
    return n


def material(name, base, base2, metal, rough, rough_var, bump_kind, bump_strength=0.25, brush=False):
    """Principled steel/panel with colour variation, brushed roughness and baked-in relief."""
    m = bpy.data.materials.new(name)
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    link = nt.links.new
    coord = node(nt, 'ShaderNodeTexCoord', (-1400, 0))
    # Colour: two close tones mottled by large, soft noise.
    mottle = node(nt, 'ShaderNodeTexNoise', (-1000, 300))
    mottle.inputs['Scale'].default_value = 6.0
    mottle.inputs['Detail'].default_value = 6.0
    link(coord.outputs['Object'], mottle.inputs['Vector'])
    ramp = node(nt, 'ShaderNodeValToRGB', (-700, 300))
    ramp.color_ramp.elements[0].color = (*base, 1)
    ramp.color_ramp.elements[1].color = (*base2, 1)
    link(mottle.outputs['Fac'], ramp.inputs['Fac'])
    link(ramp.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Metallic'].default_value = metal
    # Roughness: brushing is noise stretched hard along one axis.
    mapping = node(nt, 'ShaderNodeMapping', (-1200, -200))
    mapping.inputs['Scale'].default_value = (1.0, 1.0, 1.0) if not brush else (1.0, 1.0, 140.0)
    link(coord.outputs['Object'], mapping.inputs['Vector'])
    streak = node(nt, 'ShaderNodeTexNoise', (-1000, -200))
    streak.inputs['Scale'].default_value = 60.0 if brush else 30.0
    streak.inputs['Detail'].default_value = 10.0
    link(mapping.outputs['Vector'], streak.inputs['Vector'])
    rmap = node(nt, 'ShaderNodeMapRange', (-700, -200))
    rmap.inputs['To Min'].default_value = rough - rough_var
    rmap.inputs['To Max'].default_value = rough + rough_var
    link(streak.outputs['Fac'], rmap.inputs['Value'])
    link(rmap.outputs['Result'], bsdf.inputs['Roughness'])
    # Relief.
    height = relief(nt, coord, bump_kind)
    bump = node(nt, 'ShaderNodeBump', (-300, -500))
    bump.inputs['Strength'].default_value = bump_strength
    bump.inputs['Distance'].default_value = 0.004
    if brush:
        # Brushed steel: the streaks are in the relief too.
        both = node(nt, 'ShaderNodeMath', (-500, -500), operation='ADD')
        link(height, both.inputs[0])
        link(streak.outputs['Fac'], both.inputs[1])
        height = both.outputs['Value']
    link(height, bump.inputs['Height'])
    link(bump.outputs['Normal'], bsdf.inputs['Normal'])
    m['metal'] = metal
    return m


def relief(nt, coord, kind):
    """Height for the surface's detail: panel seams, polar floor plates, vents, or none."""
    link = nt.links.new
    if kind == 'panels':
        brick = node(nt, 'ShaderNodeTexBrick', (-1000, -600))
        brick.inputs['Scale'].default_value = 3.2
        brick.inputs['Mortar Size'].default_value = 0.012
        brick.inputs['Mortar Smooth'].default_value = 0.2
        brick.inputs['Color1'].default_value = (1, 1, 1, 1)
        brick.inputs['Color2'].default_value = (1, 1, 1, 1)
        brick.inputs['Mortar'].default_value = (0, 0, 0, 1)
        brick.offset = 0.0
        brick.inputs['Brick Width'].default_value = 1.2
        brick.inputs['Row Height'].default_value = 0.6
        link(coord.outputs['Object'], brick.inputs['Vector'])
        return brick.outputs['Color']
    if kind == 'plates':
        # Floor plates on the platform: radial seams every 15° and rings every 0.45 m.
        sep = node(nt, 'ShaderNodeSeparateXYZ', (-1200, -600))
        link(coord.outputs['Object'], sep.inputs['Vector'])
        ang = node(nt, 'ShaderNodeMath', (-1000, -550), operation='ARCTAN2')
        link(sep.outputs['Y'], ang.inputs[0])
        link(sep.outputs['X'], ang.inputs[1])
        ang24 = node(nt, 'ShaderNodeMath', (-850, -550), operation='MULTIPLY')
        ang24.inputs[1].default_value = 24 / math.tau
        link(ang.outputs['Value'], ang24.inputs[0])
        vlen = node(nt, 'ShaderNodeVectorMath', (-1000, -700), operation='LENGTH')
        link(coord.outputs['Object'], vlen.inputs[0])
        rings = node(nt, 'ShaderNodeMath', (-850, -700), operation='MULTIPLY')
        rings.inputs[1].default_value = 1 / 0.45
        link(vlen.outputs['Value'], rings.inputs[0])
        seams = []
        for i, src in enumerate((ang24, rings)):
            fr = node(nt, 'ShaderNodeMath', (-700, -550 - i * 150), operation='PINGPONG')
            fr.inputs[1].default_value = 0.5
            link(src.outputs['Value'], fr.inputs[0])
            sm = node(nt, 'ShaderNodeMath', (-550, -550 - i * 150), operation='GREATER_THAN')
            sm.inputs[1].default_value = 0.015 if i == 0 else 0.012
            link(fr.outputs['Value'], sm.inputs[0])
            seams.append(sm)
        both = node(nt, 'ShaderNodeMath', (-400, -600), operation='MINIMUM')
        link(seams[0].outputs['Value'], both.inputs[0])
        link(seams[1].outputs['Value'], both.inputs[1])
        return both.outputs['Value']
    if kind == 'vents':
        wave = node(nt, 'ShaderNodeTexWave', (-1000, -600))
        wave.wave_type = 'BANDS'
        wave.bands_direction = 'Z'
        wave.inputs['Scale'].default_value = 9.0
        wave.inputs['Distortion'].default_value = 0.0
        link(coord.outputs['Object'], wave.inputs['Vector'])
        sharp = node(nt, 'ShaderNodeMath', (-800, -600), operation='GREATER_THAN')
        sharp.inputs[1].default_value = 0.25
        link(wave.outputs['Fac'], sharp.inputs[0])
        return sharp.outputs['Value']
    noise = node(nt, 'ShaderNodeTexNoise', (-1000, -600))
    noise.inputs['Scale'].default_value = 120.0
    link(coord.outputs['Object'], noise.inputs['Vector'])
    return noise.outputs['Fac']


def assign(ob, mat):
    ob.data.materials.clear()
    ob.data.materials.append(mat)


# ---------------------------------------------------------------- chair

def cushion(name, size, loc, rot_x=0.0, level=2):
    """A box rounded off by subdivision: the chair's padded parts."""
    me = bpy.data.meshes.new(name)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    import bmesh

    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=2.0)  # ±1, so size is half-extents
    for v in bm.verts:
        v.co.x *= size[0]
        v.co.y *= size[1]
        v.co.z *= size[2]
    bm.to_mesh(me)
    bm.free()
    ob.location = loc
    ob.rotation_euler.x = rot_x
    bev = ob.modifiers.new('bevel', 'BEVEL')
    bev.width = min(size) * 0.22
    bev.segments = 2
    sub = ob.modifiers.new('sub', 'SUBSURF')
    sub.levels = level
    sub.render_levels = level
    # New objects and their transforms only exist for evaluation after an update.
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    me2 = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    out = bpy.data.objects.new(name, me2)
    out.matrix_world = ob.matrix_world
    bpy.context.scene.collection.objects.link(out)
    bpy.data.objects.remove(ob)
    out.name = name  # free now, so no ".001"
    return out


def build_chair(frame, soft):
    """A command chair facing the desk (+Y), with light down its back.

    Built part to part so everything touches: hub and five legs on castors,
    the gas lift, the seat pan and cushion, a back leaning 12° that starts at
    the seat's rear edge, the headrest above it, a spine behind them both,
    and arms on brackets off the pan.
    """
    y = CHAIR_Y
    seat_z = DAIS_TOP + 0.48
    parts = []
    base_z = DAIS_TOP + 0.075
    hub = slab('hub', 0, 0.06, base_z - 0.025, base_z + 0.025, bevel=0.008, res=32)
    hub.location.y = y
    assign(hub, frame)
    parts.append(hub)
    for i in range(5):
        a = i / 5 * math.tau + math.pi / 2
        leg = block(f'leg{i}', (0.15, 0.022, 0.014), (0.17 * math.cos(a), y + 0.17 * math.sin(a), base_z), a, bevel=0.007)
        assign(leg, frame)
        wheel = cushion(f'wheel{i}', (0.028, 0.018, 0.028), (0.31 * math.cos(a), y + 0.31 * math.sin(a), DAIS_TOP + 0.028), level=1)
        wheel.rotation_euler.z = a
        assign(wheel, soft)
        parts += [leg, wheel]
    lift = slab('lift', 0, 0.032, base_z, seat_z - 0.09, bevel=0.006, res=32)
    lift.location.y = y
    assign(lift, frame)
    pan = block('pan', (0.22, 0.22, 0.015), (0, y, seat_z - 0.075), 0, bevel=0.008)
    assign(pan, frame)
    seat = cushion('seat', (0.27, 0.26, 0.06), (0, y, seat_z))
    assign(seat, soft)
    parts += [lift, pan, seat]
    # The back: its lower edge on the seat's rear, leaning back 12°.
    lean = math.radians(12)
    up = (0.0, -math.sin(lean), math.cos(lean))
    behind = (0.0, -math.cos(lean), -math.sin(lean))
    foot = (0.0, y - 0.26 + 0.02, seat_z + 0.06)

    def along(d, k, b=0.0):
        return (foot[0] + up[0] * d + behind[0] * b, foot[1] + up[1] * d + behind[1] * b, foot[2] + up[2] * d + behind[2] * b)

    back = cushion('back', (0.25, 0.055, 0.34), along(0.34, 0), lean)
    head = cushion('head', (0.15, 0.05, 0.07), along(0.77, 0), lean)
    spine = block('spine', (0.035, 0.015, 0.42), along(0.36, 0, 0.07), 0, bevel=0.008)
    spine.rotation_euler.x = lean
    assign(back, soft)
    assign(head, soft)
    assign(spine, frame)
    parts += [back, head, spine]
    for side in (-1, 1):
        bracket = block(f'bracket{side}', (0.045, 0.02, 0.012), (side * 0.27, y - 0.02, seat_z - 0.065), 0, bevel=0.005)
        post = block(f'post{side}', (0.016, 0.02, 0.13), (side * 0.305, y - 0.02, seat_z + 0.065), 0, bevel=0.006)
        rest = cushion(f'arm{side}', (0.04, 0.17, 0.02), (side * 0.305, y, seat_z + 0.215), level=1)
        assign(bracket, frame)
        assign(post, frame)
        assign(rest, soft)
        parts += [bracket, post, rest]
    chair = join('chair', parts)
    # Two strips of light down the back, on the side seen from behind.
    lights = []
    for side in (-1, 1):
        x, sy, sz = along(0.34, 0, 0.058)
        strip = block(f'emit_chair{side}', (0.006, 0.003, 0.27), (side * 0.17, sy, sz), 0, bevel=0.002)
        strip.rotation_euler.x = lean
        lights.append(strip)
    return chair, lights


# ---------------------------------------------------------------- build

def build():
    reset()
    sc = bpy.context.scene
    steel = material('steel', (0.034, 0.039, 0.05), (0.05, 0.056, 0.07), 0.9, 0.3, 0.1, 'none', 0.08, brush=True)
    panel = material('panel', (0.018, 0.021, 0.03), (0.026, 0.03, 0.04), 0.7, 0.45, 0.08, 'panels', 0.35)
    plate = material('plate', (0.03, 0.034, 0.045), (0.042, 0.047, 0.06), 0.78, 0.36, 0.08, 'plates', 0.45)
    vent = material('vent', (0.014, 0.016, 0.022), (0.02, 0.023, 0.03), 0.6, 0.55, 0.06, 'vents', 0.5)
    soft = material('soft', (0.016, 0.017, 0.02), (0.024, 0.025, 0.03), 0.0, 0.62, 0.08, 'none', 0.12)

    # Platform: a vented outer tier, a plated top tier, a step at the back.
    t1 = slab('tier1', 0, DAIS_R, 0, TIER1_H, bevel=0.014)
    assign(t1, vent)
    t2 = slab('tier2', 0, TIER2_R, TIER1_H - 0.01, DAIS_TOP, bevel=0.012)
    assign(t2, plate)
    step = slab('step', DAIS_R - 0.05, DAIS_R + 0.38, 0, 0.11, STEP_SPAN, -math.pi / 2, bevel=0.012, res=48)
    assign(step, plate)
    dais = join('dais', [t1, t2, step])

    # Desk: top, front skirt, plinth, three pedestals.
    top = slab('top', DESK_IN, DESK_OUT, DESK_Z, DESK_Z + DESK_T, DESK_SPAN, bevel=0.014)
    assign(top, steel)
    skirt = slab('skirt', DESK_OUT - 0.09, DESK_OUT - 0.05, DAIS_TOP + 0.08, DESK_Z, DESK_SPAN - math.radians(4), bevel=0.008)
    assign(skirt, panel)
    plinth = slab('plinth', DESK_OUT - 0.32, DESK_OUT - 0.04, DAIS_TOP - 0.005, DAIS_TOP + 0.09, DESK_SPAN - math.radians(4), bevel=0.012)
    assign(plinth, vent)
    peds = []
    for deg in PEDESTALS:
        a = FORWARD + math.radians(deg)
        r = (DESK_IN + 0.08 + DESK_OUT - 0.1) / 2
        p = block(f'ped{deg}', ((DESK_OUT - 0.1 - DESK_IN - 0.08) / 2, 0.17, (DESK_Z - DAIS_TOP) / 2), (r * math.cos(a), r * math.sin(a), (DESK_Z + DAIS_TOP) / 2), a)
        assign(p, panel)
        peds.append(p)
    riser = slab('riser', RISER_IN, DESK_OUT - 0.02, DESK_Z + DESK_T - 0.01, DESK_Z + DESK_T + RISER_H, DESK_SPAN - math.radians(8), bevel=0.012)
    assign(riser, steel)
    # End panels closing each side of the desk.
    caps = []
    for side in (-1, 1):
        a = FORWARD + side * (DESK_SPAN / 2 - math.radians(1.2))
        r = (DESK_IN + DESK_OUT) / 2
        cap = block(f'cap{side}', ((DESK_OUT - DESK_IN) / 2, 0.035, (DESK_Z + DESK_T + 0.05 - DAIS_TOP) / 2), (r * math.cos(a), r * math.sin(a), (DESK_Z + DESK_T + 0.05 + DAIS_TOP) / 2), a, bevel=0.012)
        assign(cap, panel)
        caps.append(cap)
    # Monitor stands on the shelf: foot, pole, arm. Each screen hangs on an
    # empty named mon_N that the browser finds and fills.
    stands = []
    mounts = []
    shelf = DESK_Z + DESK_T + RISER_H
    for i, deg in enumerate(MONITORS):
        a = FORWARD + math.radians(deg)
        x, y = MON_R * math.cos(a), MON_R * math.sin(a)
        foot = slab(f'foot{i}', 0, 0.075, shelf - 0.002, shelf + 0.014, bevel=0.005, res=32)
        foot.location.x, foot.location.y = x, y
        pole = block(f'pole{i}', (0.016, 0.016, 0.17), (x, y, shelf + 0.17), a, bevel=0.006)
        arm = block(f'arm{i}', (0.06, 0.02, 0.02), (x - 0.04 * math.cos(a), y - 0.04 * math.sin(a), shelf + 0.33), a, bevel=0.006)
        for part in (foot, pole, arm):
            assign(part, steel)
            stands.append(part)
        mount = bpy.data.objects.new(f'mon_{i}', None)
        # The screen's centre, a hand's width in front of the arm, facing the chair.
        mx, my = (MON_R - 0.1) * math.cos(a), (MON_R - 0.1) * math.sin(a)
        mount.location = (mx, my, shelf + 0.33)
        # Local −Y faces the chair and +Z is up, which glTF turns into a
        # three.js node whose +Z faces the chair and +Y is up. Leaned back 6°.
        mount.rotation_euler = (math.radians(-6), 0, a - math.pi / 2)
        bpy.context.scene.collection.objects.link(mount)
        mounts.append(mount)
    # A padded wrist rest along the edge you sit at.
    rest = slab('rest', DESK_IN - 0.035, DESK_IN + 0.075, DESK_Z + DESK_T - 0.012, DESK_Z + DESK_T + 0.028, DESK_SPAN - math.radians(6), bevel=0.019)
    assign(rest, soft)
    desk = join('desk', [top, skirt, plinth, riser, rest, *caps, *peds, *stands])
    chair, chair_lights = build_chair(steel, soft)

    # Separate pieces lit live in the browser.
    glass = slab('glass', DESK_IN + 0.1, RISER_IN - 0.03, DESK_Z + DESK_T - 0.002, DESK_Z + DESK_T + 0.004, DESK_SPAN - math.radians(16), bevel=0.002)
    lights = [
        slab('emit_dais', TIER2_R + 0.02, TIER2_R + 0.045, TIER1_H - 0.004, TIER1_H + 0.006, bevel=0.002),
        slab('emit_step', DAIS_R + 0.35, DAIS_R + 0.38, 0.105, 0.112, STEP_SPAN - math.radians(4), -math.pi / 2, bevel=0.002, res=48),
        slab('emit_inner', DESK_IN + 0.012, DESK_IN + 0.022, DESK_Z - 0.03, DESK_Z - 0.004, DESK_SPAN - math.radians(6), bevel=0.002),
        slab('emit_edge', DESK_OUT - 0.004, DESK_OUT + 0.008, DESK_Z + 0.018, DESK_Z + 0.03, DESK_SPAN - math.radians(2), bevel=0.002),
        # The shelf's face towards the chair, a line of light under the monitors.
        slab('emit_riser', RISER_IN - 0.006, RISER_IN + 0.002, DESK_Z + DESK_T + 0.022, DESK_Z + DESK_T + 0.034, DESK_SPAN - math.radians(10), bevel=0.002),
    ]
    for side in (-1, 1):
        a = FORWARD + side * (DESK_SPAN / 2 - math.radians(1.2))
        r = (DESK_IN + DESK_OUT) / 2
        lights.append(block(f'emit_cap{side}', (0.2, 0.038, 0.006), (r * math.cos(a), r * math.sin(a), DESK_Z - 0.12), a, bevel=0.002))
    # Two holo pads set into the top, either side of the keyboard.
    for side in (-1, 1):
        a = FORWARD + side * math.radians(32)
        r = DESK_IN + 0.2
        pad = slab(f'emit_pad{side}', 0.085, 0.1, DESK_Z + DESK_T - 0.001, DESK_Z + DESK_T + 0.004, bevel=0.001, res=48)
        pad.location.x, pad.location.y = r * math.cos(a), r * math.sin(a)
        lights.append(pad)
    lights += chair_lights
    for deg in PEDESTALS:
        a = FORWARD + math.radians(deg)
        r = DESK_IN + 0.072
        strip = block(f'emit_ped{deg}', (0.004, 0.012, 0.26), (r * math.cos(a), r * math.sin(a), DAIS_TOP + 0.36), a, bevel=0.002)
        lights.append(strip)
    for ob in [glass, *lights]:
        bpy.context.view_layer.objects.active = ob
        ob.select_set(True)
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        ob.select_set(False)

    # The island deck under it all, so the bake sees the contact.
    bpy.ops.mesh.primitive_plane_add(size=14, location=(0, 0, 0))
    bpy.context.active_object.name = 'ground'
    world = bpy.data.worlds.new('world')
    if hasattr(world, 'use_nodes'):
        world.use_nodes = True
    sc.world = world
    world.light_settings.distance = 0.6  # AO reach (metres)
    return desk, dais, chair, [glass], lights, mounts


# ---------------------------------------------------------------- bake

def unwrap(ob):
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.004, area_weight=0.6, correct_aspect=True)
    bpy.ops.object.mode_set(mode='OBJECT')


def target(ob, img):
    for slot in ob.material_slots:
        nt = slot.material.node_tree
        n = nt.nodes.get('bake_target') or nt.nodes.new('ShaderNodeTexImage')
        n.name = 'bake_target'
        n.image = img
        nt.nodes.active = n


def bake(ob, kind, size, **kw):
    img = bpy.data.images.new(f'{ob.name}_{kind}', size, size, alpha=False)
    img.colorspace_settings.name = 'sRGB' if kind == 'albedo' else 'Non-Color'
    target(ob, img)
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.bake(margin=8, use_clear=True, **kw)
    px = np.empty(size * size * 4, np.float32)
    img.pixels.foreach_get(px)
    return px.reshape(size, size, 4)[::-1, :, :3]  # Blender's rows start at the bottom


def metal_map(ob, size):
    """Metalness has no bake pass: bake each material's value as emission."""
    saved = []
    for slot in ob.material_slots:
        b = slot.material.node_tree.nodes['Principled BSDF']
        v = slot.material['metal']
        saved.append((b, b.inputs['Emission Color'].default_value[:], b.inputs['Emission Strength'].default_value))
        b.inputs['Emission Color'].default_value = (v, v, v, 1)
        b.inputs['Emission Strength'].default_value = 1.0
    out = bake(ob, 'metal', size, type='EMIT')
    for b, c, s in saved:
        b.inputs['Emission Color'].default_value = c
        b.inputs['Emission Strength'].default_value = s
    return out[..., 0]


def save(arr, name, size, quality=90):
    """Write the full size and the smaller ones the lower quality levels use.

    Files are named by quality level (ultra, high, low) so every object has
    all three whatever size it was baked at."""
    im = Image.fromarray(np.clip(arr * 255 + 0.5, 0, 255).astype(np.uint8))
    for level, div in (('ultra', 1), ('high', 2), ('low', 4)):
        s = max(256, size // div)
        (im if s == im.width else im.resize((s, s), Image.LANCZOS)).save(os.path.join(OUT, f'{name}_{level}.jpg'), quality=quality, optimize=True)


def bake_all(ob, size):
    unwrap(ob)
    sc = bpy.context.scene
    sc.cycles.samples = 1
    albedo = bake(ob, 'albedo', size, type='DIFFUSE', pass_filter={'COLOR'})
    rough = bake(ob, 'rough', size, type='ROUGHNESS')[..., 0]
    metal = metal_map(ob, size)
    normal = bake(ob, 'normal', size, type='NORMAL', normal_space='TANGENT')
    sc.cycles.samples = SAMPLES
    ao = bake(ob, 'ao', size, type='AO')[..., 0]
    # A light blur takes the sampling grain out of the occlusion.
    k = np.pad(ao, 1, mode='edge')
    ao = sum(k[1 + dy : 1 + dy + size, 1 + dx : 1 + dx + size] for dy in (-1, 0, 1) for dx in (-1, 0, 1)) / 9
    save(albedo, f'{ob.name}_albedo', size)
    save(np.stack([ao, rough, metal], -1), f'{ob.name}_orm', size, 92)
    save(normal, f'{ob.name}_normal', size, 94)


def export(objs):
    bpy.ops.object.select_all(action='DESELECT')
    for ob in objs:
        ob.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=os.path.join(OUT, 'console.glb'),
        export_format='GLB',
        use_selection=True,
        export_materials='NONE',
        export_tangents=True,
        export_yup=True,
        export_apply=True,
    )


# ---------------------------------------------------------------- preview

def preview():
    """A full Cycles render of the console, lit like the room."""
    sc = bpy.context.scene
    glow = bpy.data.materials.new('glow')
    nt = glow.node_tree
    b = nt.nodes['Principled BSDF']
    b.inputs['Emission Color'].default_value = (0.35, 0.45, 1.0, 1)
    b.inputs['Emission Strength'].default_value = 12.0
    b.inputs['Base Color'].default_value = (0, 0, 0, 1)
    glassm = bpy.data.materials.new('glassm')
    g = glassm.node_tree.nodes['Principled BSDF']
    g.inputs['Base Color'].default_value = (0.01, 0.015, 0.025, 1)
    g.inputs['Roughness'].default_value = 0.05
    g.inputs['Metallic'].default_value = 0.2
    for ob in bpy.data.objects:
        if ob.type != 'MESH':
            continue
        if ob.name.startswith('emit_'):
            assign(ob, glow)
        elif ob.name == 'glass':
            assign(ob, glassm)
        elif ob.name == 'ground':
            gm = bpy.data.materials.new('groundm')
            gb = gm.node_tree.nodes['Principled BSDF']
            gb.inputs['Base Color'].default_value = (0.02, 0.022, 0.03, 1)
            gb.inputs['Metallic'].default_value = 0.8
            gb.inputs['Roughness'].default_value = 0.35
            assign(ob, gm)
    world = sc.world
    bg = world.node_tree.nodes['Background'] if world.node_tree and 'Background' in world.node_tree.nodes else None
    if bg:
        bg.inputs['Color'].default_value = (0.006, 0.006, 0.012, 1)
    for name, loc, energy, color, size in [
        ('key', (3, -4, 6), 900, (0.95, 0.93, 1.0), 3),
        ('rim', (-4, 5, 3), 500, (0.45, 0.4, 1.0), 2),
        ('fill', (0, -6, 1.5), 140, (1.0, 0.65, 0.4), 4),
    ]:
        ld = bpy.data.lights.new(name, 'AREA')
        ld.energy = energy
        ld.color = color
        ld.size = size
        lo = bpy.data.objects.new(name, ld)
        lo.location = loc
        lo.rotation_euler = (0, 0, 0)
        sc.collection.objects.link(lo)
        direction = -lo.location.normalized()
        lo.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    cam.data.lens = 32
    cam.location = (0, -4.6, 2.2)
    sc.collection.objects.link(cam)
    from mathutils import Vector

    cam.rotation_euler = (Vector((0, 0.6, 0.8)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
    sc.camera = cam
    sc.render.resolution_x = 1600
    sc.render.resolution_y = 900
    sc.cycles.samples = PREVIEW_SAMPLES
    sc.cycles.use_denoising = True
    sc.view_settings.view_transform = 'AgX'
    sc.render.filepath = os.path.join(OUT, 'console-preview.png')
    bpy.ops.render.render(write_still=True)


def main():
    os.makedirs(OUT, exist_ok=True)
    desk, dais, chair, extras, lights, mounts = build()
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    for ob, size in ((desk, SIZE), (dais, SIZE), (chair, max(512, SIZE // 2))):
        bake_all(ob, size)
        print('baked', ob.name, flush=True)
    export([desk, dais, chair, *extras, *lights, *mounts])
    print('exported', os.path.join(OUT, 'console.glb'), flush=True)
    if PREVIEW:
        # The preview uses the procedural materials, so render before anything is swapped.
        preview()
        print('preview written', flush=True)


main()
