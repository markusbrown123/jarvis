"""
Dum-E: Tony Stark's workshop robot arm, for JARVIS's build bay, modelled in
Blender part by part like the real industrial arms it's based on.

  base      a heavy round plate bolted down (eight hex bolts), a plinth
  yaw       a turntable and a yoke of two side plates, the shoulder's motor
            caps (yellow, as industrial arms mark their joints) and a red
            status light
  upper     the shoulder hub, twin rails with lightening holes and cross
            ties, a hydraulic piston (black barrel, chrome rod) and a cable
            loom running up to the elbow, whose caps it carries
  fore      the elbow hub and a tapered forearm with its own cable
  wrist     the wrist hub and block
  roll      the rotary wrist joint and the claw's palm
  finger_a/b  two jointed fingers with rubber pads

Each moving part is its own object with its origin on its joint, parented to
the one before, so the browser turns joints by rotating nodes:
yaw about the vertical, upper/fore/wrist about X (pitch), roll about the
forearm's own axis, the fingers about Y (open and close).

  $S/bvenv/bin/python tools/blender/dume.py [--preview out.png]   # writes public/station/dume.glb

Real sizes, metres; Blender Z-up, standing upright; about 1.8 m tall.
"""

import math
import os
import sys

import bpy
import bmesh  # after bpy
from mathutils import Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'public', 'station', 'dume.glb')
PREVIEW = sys.argv[sys.argv.index('--preview') + 1] if '--preview' in sys.argv else None

# Joint heights, standing straight up.
YAW_Z = 0.20
SHOULDER_Z = 0.46
ELBOW_Z = 1.08
WRIST_Z = 1.58
ROLL_Z = 1.66
FINGER_Z = 1.77
FINGER_X = 0.045


# ---------------------------------------------------------------- helpers

def link(ob):
    bpy.context.scene.collection.objects.link(ob)
    return ob


def select_only(ob):
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob


def apply_mods(ob):
    select_only(ob)
    for m in list(ob.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)


def bevelled(ob, width, segments=2):
    m = ob.modifiers.new('bevel', 'BEVEL')
    m.width = width
    m.segments = segments
    m.limit_method = 'ANGLE'
    m.angle_limit = math.radians(40)
    m.harden_normals = True
    apply_mods(ob)
    return ob


def shade(ob):
    """Smooth where it's curved, sharp at the hard edges."""
    for p in ob.data.polygons:
        p.use_smooth = True
    try:
        select_only(ob)
        bpy.ops.object.shade_auto_smooth(angle=math.radians(35))
    except Exception:
        pass
    return ob


def cyl(name, r, h, center, axis='Z', n=32, bevel=0.0, r_top=None):
    """A cylinder of height h centred on `center`, along an axis."""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=n, radius1=r, radius2=r if r_top is None else r_top, depth=h)
    bm.to_mesh(me)
    bm.free()
    ob = link(bpy.data.objects.new(name, me))
    ob.location = center
    ob.rotation_euler = {'Z': (0, 0, 0), 'X': (0, math.pi / 2, 0), 'Y': (math.pi / 2, 0, 0)}[axis]
    if bevel:
        bevelled(ob, bevel)
    return ob


def box(name, sx, sy, sz, center, bevel=0.0, taper=None):
    """A box centred on `center`; `taper` scales its top face (x, y)."""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        tx, ty = taper if (taper and v.co.z > 0) else (1.0, 1.0)
        v.co = Vector((v.co.x * sx * tx, v.co.y * sy * ty, v.co.z * sz))
    bm.to_mesh(me)
    bm.free()
    ob = link(bpy.data.objects.new(name, me))
    ob.location = center
    if bevel:
        bevelled(ob, bevel)
    return ob


def tube(name, pts, r, res=6):
    """A hose or cable through points."""
    cu = bpy.data.curves.new(name, 'CURVE')
    cu.dimensions = '3D'
    sp = cu.splines.new('BEZIER')
    sp.bezier_points.add(len(pts) - 1)
    for i, p in enumerate(pts):
        bp = sp.bezier_points[i]
        bp.co = p
        bp.handle_left_type = bp.handle_right_type = 'AUTO'
    cu.bevel_depth = r
    cu.bevel_resolution = res
    cu.use_fill_caps = True
    ob = link(bpy.data.objects.new(name, cu))
    select_only(ob)
    bpy.ops.object.convert(target='MESH')
    return bpy.context.view_layer.objects.active


def cut(ob, cutters):
    """Subtract cutters (deleted afterwards)."""
    for c in cutters:
        m = ob.modifiers.new('cut', 'BOOLEAN')
        m.operation = 'DIFFERENCE'
        m.solver = 'EXACT'
        m.object = c
        apply_mods(ob)
        bpy.data.objects.remove(c)
    return ob


def material(name, color, metal=0.0, rough=0.5, emission=None, strength=0.0):
    m = bpy.data.materials.new(name)
    b = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Metallic'].default_value = metal
    b.inputs['Roughness'].default_value = rough
    if emission:
        b.inputs['Emission Color'].default_value = (*emission, 1)
        b.inputs['Emission Strength'].default_value = strength
    return m


def assign(ob, mat):
    ob.data.materials.clear()
    ob.data.materials.append(mat)
    return shade(ob)


def join(name, parts, origin):
    """One object of the parts, its origin on its joint."""
    bpy.ops.object.select_all(action='DESELECT')
    for p in parts:
        p.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = ob.data.name = name
    select_only(ob)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.context.scene.cursor.location = origin
    bpy.ops.object.origin_set(type='ORIGIN_CURSOR')
    return ob


def parent(child, to):
    bpy.ops.object.select_all(action='DESELECT')
    child.select_set(True)
    to.select_set(True)
    bpy.context.view_layer.objects.active = to
    bpy.ops.object.parent_set(type='OBJECT', keep_transform=True)


# ---------------------------------------------------------------- the arm

def build():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    M = {
        'paint': material('dume_paint', (0.085, 0.09, 0.1), 0.7, 0.38),
        'dark': material('dume_dark', (0.035, 0.036, 0.04), 0.4, 0.48),
        'steel': material('dume_steel', (0.62, 0.63, 0.65), 1.0, 0.28),
        'chrome': material('dume_chrome', (0.88, 0.89, 0.9), 1.0, 0.1),
        'rubber': material('dume_rubber', (0.018, 0.018, 0.02), 0.0, 0.85),
        'accent': material('dume_accent', (0.95, 0.3, 0.0), 0.2, 0.4),
        'led': material('dume_led', (0.1, 0.0, 0.0), 0.0, 0.4, emission=(1.0, 0.06, 0.04), strength=12.0),
    }

    # Base: a heavy plate bolted down, and a plinth.
    plate = assign(cyl('plate', 0.34, 0.05, (0, 0, 0.025), n=64, bevel=0.008), M['dark'])
    bolts = [assign(cyl(f'bolt{k}', 0.018, 0.016, (0.28 * math.cos(a), 0.28 * math.sin(a), 0.058), n=6, bevel=0.002), M['steel'])
             for k, a in enumerate(math.radians(22.5 + 45 * i) for i in range(8))]
    plinth = assign(cyl('plinth', 0.2, 0.15, (0, 0, 0.125), n=48, bevel=0.01, r_top=0.18), M['paint'])
    base = join('dume_base', [plate, *bolts, plinth], (0, 0, 0))

    # Yaw: turntable, yoke, the shoulder's motor caps, status light.
    table = assign(cyl('table', 0.22, 0.06, (0, 0, YAW_Z + 0.03), n=48, bevel=0.008), M['paint'])
    ring = assign(cyl('ring', 0.225, 0.012, (0, 0, YAW_Z + 0.004), n=48), M['accent'])
    plates = []
    for sx in (-1, 1):
        p = box(f'yoke{sx}', 0.05, 0.26, 0.3, (sx * 0.135, 0, YAW_Z + 0.06 + 0.15), bevel=0.012)
        cutters = [cyl('hole', 0.035, 0.08, (sx * 0.135, 0.055, YAW_Z + 0.13), axis='X', n=24)]
        plates.append(assign(cut(p, cutters), M['paint']))
    caps = [assign(cyl(f'cap{sx}', 0.11, 0.05, (sx * 0.185, 0, SHOULDER_Z), axis='X', n=48, bevel=0.008), M['accent']) for sx in (-1, 1)]
    hubs = [assign(cyl(f'capc{sx}', 0.04, 0.012, (sx * 0.214, 0, SHOULDER_Z), axis='X', n=24), M['steel']) for sx in (-1, 1)]
    led = assign(cyl('led', 0.012, 0.01, (0.16, 0.135, YAW_Z + 0.24), axis='Y', n=16), M['led'])
    yaw = join('dume_yaw', [table, ring, *plates, *caps, *hubs, led], (0, 0, YAW_Z))

    # Upper arm: shoulder hub, twin rails with lightening holes and ties,
    # piston, cable loom, the elbow's caps.
    hub = assign(cyl('shub', 0.085, 0.21, (0, 0, SHOULDER_Z), axis='X', n=48), M['dark'])
    rails = []
    L = ELBOW_Z - SHOULDER_Z
    for sx in (-1, 1):
        r = box(f'rail{sx}', 0.034, 0.11, L + 0.1, (sx * 0.07, 0, (SHOULDER_Z + ELBOW_Z) / 2), bevel=0.008)
        holes = [cyl('h', 0.03, 0.06, (sx * 0.07, 0, SHOULDER_Z + L * f), axis='X', n=24) for f in (0.3, 0.52, 0.74)]
        rails.append(assign(cut(r, holes), M['paint']))
    ties = [assign(box(f'tie{i}', 0.11, 0.09, 0.02, (0, 0, SHOULDER_Z + L * f), bevel=0.004), M['dark']) for i, f in enumerate((0.18, 0.86))]
    barrel = assign(cyl('barrel', 0.026, 0.3, (0, -0.085, SHOULDER_Z + 0.24), n=24, bevel=0.004), M['dark'])
    rod = assign(cyl('rod', 0.012, 0.2, (0, -0.085, SHOULDER_Z + 0.48), n=16), M['chrome'])
    lugs = [assign(cyl(f'lug{i}', 0.02, 0.05, (0, -0.085, z), axis='X', n=16), M['steel']) for i, z in enumerate((SHOULDER_Z + 0.09, SHOULDER_Z + 0.58))]
    loom = assign(tube('loom', [(0.0, 0.07, SHOULDER_Z + 0.02), (0.02, 0.085, SHOULDER_Z + 0.3), (0.0, 0.08, ELBOW_Z - 0.12), (0.0, 0.06, ELBOW_Z - 0.02)], 0.011), M['rubber'])
    loom2 = assign(tube('loom2', [(-0.025, 0.065, SHOULDER_Z + 0.02), (-0.03, 0.08, SHOULDER_Z + 0.32), (-0.02, 0.075, ELBOW_Z - 0.1)], 0.008), M['rubber'])
    ecaps = [assign(cyl(f'ecap{sx}', 0.072, 0.04, (sx * 0.107, 0, ELBOW_Z), axis='X', n=40, bevel=0.006), M['accent']) for sx in (-1, 1)]
    upper = join('dume_upper', [hub, *rails, *ties, barrel, rod, *lugs, loom, loom2, *ecaps], (0, 0, SHOULDER_Z))

    # Forearm: elbow hub and a tapered beam with a cable.
    ehub = assign(cyl('ehub', 0.06, 0.17, (0, 0, ELBOW_Z), axis='X', n=40), M['dark'])
    FL = WRIST_Z - ELBOW_Z
    beam = assign(box('beam', 0.09, 0.1, FL, (0, 0, (ELBOW_Z + WRIST_Z) / 2), bevel=0.01, taper=(0.75, 0.75)), M['paint'])
    stripe = assign(box('stripe', 0.092, 0.102, 0.03, (0, 0, ELBOW_Z + FL * 0.35), taper=(0.92, 0.92)), M['accent'])
    cable = assign(tube('cable', [(0.0, 0.06, ELBOW_Z + 0.05), (0.01, 0.065, ELBOW_Z + FL * 0.5), (0.0, 0.045, WRIST_Z - 0.02)], 0.008), M['rubber'])
    wcaps = [assign(cyl(f'wcap{sx}', 0.048, 0.03, (sx * 0.06, 0, WRIST_Z), axis='X', n=32, bevel=0.004), M['dark']) for sx in (-1, 1)]
    fore = join('dume_fore', [ehub, beam, stripe, cable, *wcaps], (0, 0, ELBOW_Z))

    # Wrist (pitch), then roll and the claw's palm.
    whub = assign(cyl('whub', 0.042, 0.09, (0, 0, WRIST_Z), axis='X', n=32), M['steel'])
    wblock = assign(box('wblock', 0.07, 0.07, 0.07, (0, 0, WRIST_Z + 0.045), bevel=0.008), M['paint'])
    wrist = join('dume_wrist', [whub, wblock], (0, 0, WRIST_Z))

    rcyl = assign(cyl('rcyl', 0.045, 0.06, (0, 0, ROLL_Z + 0.03), n=40, bevel=0.004), M['dark'])
    rring = assign(cyl('rring', 0.047, 0.01, (0, 0, ROLL_Z + 0.012), n=40), M['accent'])
    palm = assign(box('palm', 0.13, 0.075, 0.05, (0, 0, FINGER_Z - 0.015), bevel=0.008), M['paint'])
    roll = join('dume_roll', [rcyl, rring, palm], (0, 0, ROLL_Z))

    fingers = []
    for sx, nm in ((1, 'a'), (-1, 'b')):
        x0 = sx * FINGER_X
        knuckle = assign(cyl(f'kn{nm}', 0.016, 0.06, (x0, 0, FINGER_Z), axis='Y', n=20), M['steel'])
        low = box(f'low{nm}', 0.024, 0.05, 0.09, (x0 + sx * 0.012, 0, FINGER_Z + 0.045), bevel=0.005)
        low.rotation_euler = (0, sx * math.radians(-12), 0)
        top = box(f'top{nm}', 0.022, 0.046, 0.075, (x0 + sx * 0.012, 0, FINGER_Z + 0.12), bevel=0.005)
        top.rotation_euler = (0, sx * math.radians(14), 0)
        pad = box(f'pad{nm}', 0.008, 0.044, 0.06, (x0 - sx * 0.002, 0, FINGER_Z + 0.125))
        fingers.append(join(f'dume_finger_{nm}', [knuckle, assign(low, M['dark']), assign(top, M['dark']), assign(pad, M['rubber'])], (x0, 0, FINGER_Z)))

    # The chain: base → yaw → upper → fore → wrist → roll → fingers.
    parent(yaw, base)
    parent(upper, yaw)
    parent(fore, upper)
    parent(wrist, fore)
    parent(roll, wrist)
    for f in fingers:
        parent(f, roll)
    return [base, yaw, upper, fore, wrist, roll, *fingers]


def pose(parts, angles):
    """A curious pose for the preview: leaning forward, claw half open."""
    by = {o.name: o for o in parts}
    by['dume_yaw'].rotation_euler = (0, 0, math.radians(angles[0]))
    by['dume_upper'].rotation_euler = (math.radians(angles[1]), 0, 0)
    by['dume_fore'].rotation_euler = (math.radians(angles[2]), 0, 0)
    by['dume_wrist'].rotation_euler = (math.radians(angles[3]), 0, 0)
    by['dume_finger_a'].rotation_euler = (0, math.radians(-angles[4]), 0)
    by['dume_finger_b'].rotation_euler = (0, math.radians(angles[4]), 0)


def preview(parts, path):
    sc = bpy.context.scene
    pose(parts, (-35, -28, -62, -38, 14))
    floor = link(bpy.data.objects.new('floor', bpy.data.meshes.new('floor')))
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=4)
    bm.to_mesh(floor.data)
    bm.free()
    assign(floor, material('floor', (0.5, 0.48, 0.45), 0.0, 0.6))
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    link(cam)
    cam.location = (1.55, -1.75, 1.35)
    cam.rotation_euler = (Vector((0, 0.1, 0.85)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
    cam.data.lens = 32
    sc.camera = cam
    for loc, e in (((3, -2, 4), 900), ((-3, -1, 2.5), 300), ((0, 3, 3), 500)):
        L = bpy.data.objects.new('l', bpy.data.lights.new('l', 'AREA'))
        L.data.energy = e
        L.data.size = 2
        L.location = loc
        L.rotation_euler = (Vector((0, 0, 0.8)) - L.location).to_track_quat('-Z', 'Y').to_euler()
        link(L)
    w = bpy.data.worlds.new('w')
    w.color = (0.05, 0.05, 0.06)
    sc.world = w
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = 24
    sc.cycles.use_denoising = True
    sc.render.resolution_x, sc.render.resolution_y = 960, 720
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print('preview', path, flush=True)
    pose(parts, (0, 0, 0, 0, 0))
    bpy.data.objects.remove(floor)


def main():
    parts = build()
    tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in parts)
    print('dume', len(parts), 'parts', tris, 'tris', flush=True)
    if PREVIEW:
        preview(parts, PREVIEW)
    bpy.ops.object.select_all(action='DESELECT')
    for o in parts:
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_yup=True, export_apply=True)
    print('exported', OUT, flush=True)


main()
