"""
JARVIS's drones, modelled in Blender: a 5-inch freestyle FPV quad and a
tiny whoop, built part by part the way the real ones are.

  5-inch quad   true-X carbon frame (5 mm arms with lightening slots,
                chamfered edges), aluminium standoffs, a two-board flight
                stack, four 2306 motors (black vented bells with a gold
                band, copper windings showing through, prop nuts), teal
                tri-blade 5.1" props, an orange FPV camera tilted up 30° in
                black TPU side plates, a GoPro in its TPU cradle on the top
                plate, a 6S pack strapped on behind it with its leads, XT60
                and a red cap, a lollipop antenna out the back, LED strips
                under the arms
  tiny whoop    translucent blue ducts with guard ribs and feet on a
                moulded frame, silver motors wired to the board, clear
                3-blade props, the board showing under a silver camera cage
                with a big lens, a long antenna, a 1S pack underneath

Textures (carbon twill, the pack's wrap) are drawn here with numpy and
packed into the file; everything else is plain PBR (anodised metal,
plastics, copper, glass). Each rotor (bell + prop) is its own object so the
browser can spin it.

  .bpy/bin/python tools/blender/fpv.py            # writes public/station/fpv.glb + fpv-preview.png

Real sizes, metres; Blender Z-up with the nose towards +Y (three.js −Z).
"""

import math
import os
import sys

import bpy
import bmesh  # after bpy
import numpy as np
from mathutils import Matrix, Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'public', 'station')
TMP = os.path.join(ROOT, '.bpy', 'tmp')
PREVIEW = '--no-preview' not in sys.argv


# ---------------------------------------------------------------- helpers

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def link(ob):
    bpy.context.scene.collection.objects.link(ob)
    return ob


def apply_mods(ob):
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    ob.modifiers.clear()
    old = ob.data
    ob.data = me
    bpy.data.meshes.remove(old)
    return ob


def mesh_from(name, verts, faces, smooth=True):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], faces)
    me.update()
    ob = link(bpy.data.objects.new(name, me))
    for p in ob.data.polygons:
        p.use_smooth = smooth
    return ob


def outline_slab(name, pts, thickness, z, bevel=0.0006, holes=()):
    """A flat part from a 2D outline (and holes), extruded and chamfered."""
    cu = bpy.data.curves.new(name, 'CURVE')
    cu.dimensions = '2D'
    cu.fill_mode = 'BOTH'
    for loop in (pts, *holes):
        sp = cu.splines.new('POLY')
        sp.points.add(len(loop) - 1)
        for i, (x, y) in enumerate(loop):
            sp.points[i].co = (x, y, 0, 1)
        sp.use_cyclic_u = True
    cu.extrude = thickness / 2 - bevel
    cu.bevel_depth = bevel
    cu.bevel_resolution = 1
    cu.offset = -bevel
    ob = link(bpy.data.objects.new(name, cu))
    ob.location.z = z + thickness / 2
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    out = link(bpy.data.objects.new(name, me))
    out.matrix_world = ob.matrix_world
    bpy.data.objects.remove(ob)
    return out


def circle(cx, cy, r, n=32, a0=0.0, a1=math.tau):
    return [(cx + r * math.cos(a), cy + r * math.sin(a)) for a in np.linspace(a0, a1, n, endpoint=False)]


def capsule(x0, y0, x1, y1, w0, w1, n=12):
    """A tapered bar with round ends from (x0, y0) to (x1, y1)."""
    ang = math.atan2(y1 - y0, x1 - x0)
    pts = [(x1 + w1 / 2 * math.cos(a), y1 + w1 / 2 * math.sin(a)) for a in np.linspace(ang - math.pi / 2, ang + math.pi / 2, n)]
    pts += [(x0 + w0 / 2 * math.cos(a), y0 + w0 / 2 * math.sin(a)) for a in np.linspace(ang + math.pi / 2, ang + 3 * math.pi / 2, n)]
    return pts


def rounded_rect(w, h, r, n=8, cx=0.0, cy=0.0):
    pts = []
    for (sx, sy, a0) in ((1, 1, 0), (-1, 1, math.pi / 2), (-1, -1, math.pi), (1, -1, 1.5 * math.pi)):
        ccx, ccy = cx + sx * (w / 2 - r), cy + sy * (h / 2 - r)
        pts += [(ccx + r * math.cos(a), ccy + r * math.sin(a)) for a in np.linspace(a0, a0 + math.pi / 2, n)]
    return pts


def cyl(name, r, h, z=0.0, n=32, x=0.0, y=0.0, bevel=0.0, r_top=None):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=n, radius1=r, radius2=r if r_top is None else r_top, depth=h)
    bm.to_mesh(me)
    bm.free()
    ob = link(bpy.data.objects.new(name, me))
    ob.location = (x, y, z + h / 2)
    if bevel:
        m = ob.modifiers.new('b', 'BEVEL')
        m.width = bevel
        m.segments = 2
        m.limit_method = 'ANGLE'
        apply_mods(ob)
    for p in ob.data.polygons:
        p.use_smooth = True
    sharp(ob)
    return ob


def box(name, sx, sy, sz, loc=(0, 0, 0), bevel=0.0, rot=None):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=2.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * sx / 2, v.co.y * sy / 2, v.co.z * sz / 2))
    bm.to_mesh(me)
    bm.free()
    ob = link(bpy.data.objects.new(name, me))
    ob.location = loc
    if rot:
        ob.rotation_euler = rot
    if bevel:
        m = ob.modifiers.new('b', 'BEVEL')
        m.width = bevel
        m.segments = 3
        apply_mods(ob)
        for p in ob.data.polygons:
            p.use_smooth = True
        sharp(ob)
    return ob


def sharp(ob, angle=40):
    """Smooth where curved, crisp at real edges."""
    try:
        bpy.context.view_layer.objects.active = ob
        ob.select_set(True)
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(angle))
        ob.select_set(False)
    except Exception:
        pass


def cut(ob, cutter):
    m = ob.modifiers.new('cut', 'BOOLEAN')
    m.operation = 'DIFFERENCE'
    m.solver = 'EXACT'
    m.object = cutter
    cutter.hide_render = True
    apply_mods(ob)
    bpy.data.objects.remove(cutter)
    return ob


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


def bake_transform(ob):
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


def pivot(ob, at):
    """Put an object's origin at a point (where it turns), keeping the mesh where it is."""
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.context.scene.cursor.location = at
    bpy.ops.object.origin_set(type='ORIGIN_CURSOR')
    ob.select_set(False)


# ---------------------------------------------------------------- textures

def save_png(arr, name):
    os.makedirs(TMP, exist_ok=True)
    path = os.path.join(TMP, name)
    h, w = arr.shape[:2]
    img = bpy.data.images.new(name, w, h, alpha=True)
    rgba = np.ones((h, w, 4), np.float32)
    rgba[..., :3] = arr[..., :3]
    img.pixels.foreach_set(rgba[::-1].ravel())
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()
    return img


def carbon_twill(n=512, tows=16):
    """2x2 twill weave: tows over and under in diagonal steps, each tow with
    fibre sheen across it, all under a glossy resin."""
    y, x = np.mgrid[0:n, 0:n].astype(np.float32) / n * tows
    ix, iy = np.floor(x), np.floor(y)
    fx, fy = x - ix, y - iy
    over = ((ix + iy) % 4) < 2  # warp on top
    across = np.where(over, fy, fx)
    along = np.where(over, fx, fy)
    tow = np.sin(across * math.pi) ** 0.6
    fibre = 0.85 + 0.15 * np.sin(along * math.pi * 24 + across * 3)
    shade = np.where(over, 0.95, 0.75)
    v = 0.045 + 0.075 * tow * fibre * shade
    alb = np.stack([v, v * 1.02, v * 1.08], -1)
    rough = 0.22 + 0.25 * (1 - tow)
    return alb, rough


def pack_wrap(w=512, h=256):
    """The battery's wrap: dark with a bold stripe and blocks of print."""
    from PIL import Image, ImageDraw, ImageFont

    im = Image.new('RGB', (w, h), (16, 16, 19))
    d = ImageDraw.Draw(im)
    d.rectangle([0, h * 0.44, w * 0.62, h * 0.58], fill=(232, 112, 22))
    try:
        f = ImageFont.truetype('DejaVuSans-Bold.ttf', 20)
        s = ImageFont.truetype('DejaVuSans.ttf', 16)
    except Exception:
        f = s = ImageFont.load_default()
    d.text((18, h * 0.445), 'JARVIS  6S  1300', font=f, fill=(20, 20, 22))
    d.text((18, 24), '22.2V  ·  120C  ·  LiPo', font=s, fill=(200, 200, 205))
    d.text((18, h - 44), 'FLIGHT PACK  //  DATA LINK', font=s, fill=(160, 160, 170))
    for i in range(6):
        d.rectangle([w - 120 + i * 16, 22, w - 108 + i * 16, 40], fill=(90, 220, 140) if i < 5 else (60, 60, 64))
    return np.asarray(im, np.float32) / 255


# ---------------------------------------------------------------- materials

def principled(name, color, metal=0.0, rough=0.5, alpha=1.0, emission=None, strength=0.0, coat=0.0):
    m = bpy.data.materials.new(name)
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Metallic'].default_value = metal
    b.inputs['Roughness'].default_value = rough
    if coat:
        b.inputs['Coat Weight'].default_value = coat
    if alpha < 1:
        b.inputs['Alpha'].default_value = alpha
        try:
            m.surface_render_method = 'BLENDED'
        except Exception:
            pass
    if emission:
        b.inputs['Emission Color'].default_value = (*emission, 1)
        b.inputs['Emission Strength'].default_value = strength
    return m


def textured(name, img, rough_img=None, rough=0.4, metal=0.0, scale=1.0):
    m = bpy.data.materials.new(name)
    nt = m.node_tree
    b = nt.nodes['Principled BSDF']
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = img
    nt.links.new(tex.outputs['Color'], b.inputs['Base Color'])
    if rough_img is not None:
        rt = nt.nodes.new('ShaderNodeTexImage')
        rt.image = rough_img
        rt.image.colorspace_settings.name = 'Non-Color'
        sep = nt.nodes.new('ShaderNodeSeparateColor')
        nt.links.new(rt.outputs['Color'], sep.inputs['Color'])
        nt.links.new(sep.outputs['Green'], b.inputs['Roughness'])
    else:
        b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    b.inputs['Coat Weight'].default_value = 0.6
    b.inputs['Coat Roughness'].default_value = 0.08
    return m


def assign(ob, mat):
    ob.data.materials.clear()
    ob.data.materials.append(mat)
    return ob


def cube_uv(ob, size):
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.cube_project(cube_size=size)
    bpy.ops.object.mode_set(mode='OBJECT')
    return ob


# ---------------------------------------------------------------- props

def prop_mesh(name, radius, hub_r, blades, chord_max, pitch_root, pitch_tip, hand=1, sections=22, chord_pts=9, thick=0.0013):
    """Blades with a real twist and an airfoil-ish section, round a hub."""
    verts = []
    faces = []
    for b in range(blades):
        base = b * math.tau / blades
        start = len(verts)
        for i in range(sections + 1):
            t = i / sections
            r = hub_r + (radius - hub_r) * t
            chord = chord_max * (0.55 + 0.9 * t * (1 - t) * 1.6) * (1 - 0.65 * t ** 3)
            pitch = math.radians(pitch_root + (pitch_tip - pitch_root) * t) * hand
            sweep = 0.12 * t * t  # tips swept back a little
            th = thick * (1 - 0.6 * t)
            for side in (1, -1):
                for j in range(chord_pts):
                    u = j / (chord_pts - 1)
                    x = (u - 0.35) * chord  # from leading edge to trailing
                    z = side * th * 0.5 * math.sin(math.pi * u) ** 0.7 + 0.25 * th * math.sin(math.pi * u)
                    # Twist the section about the blade's axis.
                    xr = x * math.cos(pitch) - z * math.sin(pitch)
                    zr = x * math.sin(pitch) + z * math.cos(pitch)
                    a = base + sweep * hand
                    verts.append((r * math.cos(a) - xr * math.sin(a) * hand, r * math.sin(a) + xr * math.cos(a) * hand, zr))
        row = chord_pts * 2
        for i in range(sections):
            for side in range(2):
                for j in range(chord_pts - 1):
                    a0 = start + i * row + side * chord_pts + j
                    b0 = a0 + row
                    f = (a0, a0 + 1, b0 + 1, b0) if side == 0 else (a0, b0, b0 + 1, a0 + 1)
                    faces.append(f)
        # Close the tip and the edges.
        for i in range(sections):
            top0 = start + i * row
            bot0 = top0 + chord_pts
            faces.append((top0, top0 + row, bot0 + row, bot0))
            faces.append((top0 + chord_pts - 1, bot0 + chord_pts - 1, bot0 + row + chord_pts - 1, top0 + row + chord_pts - 1))
        tip = start + sections * row
        faces.append(tuple(range(tip, tip + chord_pts)) + tuple(range(tip + row - 1, tip + chord_pts - 1, -1)))
    ob = mesh_from(name, verts, faces)
    hub = cyl(name + '_hub', hub_r * 1.25, thick * 6, z=-thick * 2, n=24)
    return join(name, [ob, hub])


# ---------------------------------------------------------------- 5-inch quad

def motor(name, x, y, z, mats, r=0.0142, h=0.009):
    base = cyl(name + '_base', r * 0.93, 0.006, z=z, x=x, y=y, bevel=0.0008)
    assign(base, mats['alu'])
    stator = cyl(name + '_stator', r * 0.78, h * 0.85, z=z + 0.006, x=x, y=y, n=24)
    assign(stator, mats['copper'])
    bell = cyl(name + '_bell', r, h - 0.0005, z=z + 0.0065, x=x, y=y, n=48, bevel=0.0009)
    # Vents round the bell, the windings showing through.
    for k in range(6):
        a = k * math.tau / 6
        c = box('vent', 0.006, 0.03, h * 0.5, loc=(x + math.cos(a) * r, y + math.sin(a) * r, z + 0.006 + h * 0.5), rot=(0, 0, a + math.pi / 2))
        cut(bell, c)
    # The printed band: proud of the bell (so the two never fight), below its vents.
    band = cyl(name + '_band', r + 0.0007, h * 0.1, z=z + 0.0067, x=x, y=y, n=48)
    cut(band, cyl('bandin', r - 0.0004, h, z=z + 0.005, x=x, y=y, n=48))
    assign(band, mats['gold'])
    top = cyl(name + '_cap', r * 0.98, 0.0016, z=z + 0.006 + h, x=x, y=y, n=48, bevel=0.0006)
    for k in range(4):
        a = k * math.tau / 4 + math.pi / 4
        cut(top, cyl('hole', 0.0028, 0.01, z=z + h, x=x + math.cos(a) * r * 0.55, y=y + math.sin(a) * r * 0.55, n=12))
    shaft = cyl(name + '_shaft', 0.0025, 0.011, z=z + 0.0069 + h, x=x, y=y, n=16)
    nut = cyl(name + '_nut', 0.0045, 0.006, z=z + 0.006 + h + 0.004, x=x, y=y, n=6, bevel=0.0005)
    rotor_parts = [bell, band, top, shaft, nut]
    for o in (bell, top):
        assign(o, mats['bell'])
    for o in (shaft, nut):
        assign(o, mats['alu'])
    return [base, stator], rotor_parts, z + 0.006 + h + 0.003


def quad(mats):
    S = 0.08  # motor positions: ±S, ±S (226 mm diagonal)
    parts = []
    # Arms: one-piece 5 mm carbon, tapering, round pads at the motors, slots cut through.
    arms = []
    for sx, sy in ((1, 1), (-1, 1), (1, -1), (-1, -1)):
        a = outline_slab('arm', capsule(sx * 0.008, sy * 0.012, sx * S, sy * S, 0.019, 0.026), 0.005, 0.0, bevel=0.0007)
        slot = outline_slab('slot', capsule(sx * 0.03, sy * 0.032, sx * 0.058, sy * 0.06, 0.006, 0.006), 0.02, -0.005)
        cut(a, slot)
        for k in range(4):  # motor screw holes
            ang = k * math.tau / 4 + math.pi / 4
            cut(a, cyl('h', 0.0012, 0.02, z=-0.005, x=sx * S + math.cos(ang) * 0.008, y=sy * S + math.sin(ang) * 0.008, n=10))
        cut(a, cyl('c', 0.003, 0.02, z=-0.005, x=sx * S, y=sy * S, n=16))
        arms.append(a)
    # One piece, as they're cut from one sheet (no overlapping faces where they meet).
    for a in arms[1:]:
        m = arms[0].modifiers.new('u', 'BOOLEAN')
        m.operation = 'UNION'
        m.solver = 'EXACT'
        m.object = a
        apply_mods(arms[0])
        bpy.data.objects.remove(a)
    arms = arms[:1]
    bottom = outline_slab('bottom', rounded_rect(0.044, 0.1, 0.008), 0.003, 0.005, bevel=0.0006)
    top = outline_slab('top', rounded_rect(0.038, 0.094, 0.007), 0.002, 0.031, bevel=0.0005)
    cut(top, outline_slab('topslot', rounded_rect(0.014, 0.04, 0.005, cy=-0.012), 0.02, 0.02))
    frame = join('frame', arms + [bottom, top])
    cube_uv(frame, 0.06)
    assign(frame, mats['carbon'])
    parts.append(frame)
    # Standoffs and the flight stack between the plates.
    for x in (-0.014, 0.014):
        for y in (-0.04, 0.04):
            parts.append(assign(cyl('standoff', 0.0028, 0.023, z=0.008, x=x, y=y, n=6, bevel=0.0004), mats['anod']))
    for z, c in ((0.013, mats['pcb']), (0.021, mats['pcb2'])):
        parts.append(assign(box('board', 0.036, 0.036, 0.0016, loc=(0, -0.002, z), bevel=0.0004), c))
        for k in range(7):
            parts.append(assign(box('chip', 0.004 + (k % 3) * 0.002, 0.004 + (k % 2) * 0.003, 0.0012, loc=(-0.012 + (k % 4) * 0.008, -0.014 + (k // 4) * 0.02, z + 0.0014)), mats['chip']))
    parts.append(assign(cyl('cap', 0.005, 0.016, z=0.0, x=0.0, y=-0.055, n=20), mats['capacitor']))
    # FPV camera between the TPU side plates, on a gimbal: its own object,
    # level here, pivoting where it's mounted; the browser aims it at
    # whatever the drone is looking at.
    cam = []
    body = box('cam', 0.019, 0.019, 0.019, loc=(0, 0.048, 0.022), bevel=0.0015)
    lens = cyl('lens', 0.0072, 0.012, z=-0.006, n=32, bevel=0.0006)
    lens.rotation_euler = (math.radians(90), 0, 0)
    lens.location = (0, 0.06, 0.022)
    glass = cyl('glass', 0.0055, 0.001, z=0, n=32)
    glass.rotation_euler = (math.radians(90), 0, 0)
    glass.location = (0, 0.0665, 0.022)
    for o, m in ((body, mats['tpu']), (lens, mats['plastic']), (glass, mats['glass'])):
        assign(o, m)
        cam.append(o)
    for o in cam:
        bake_transform(o)
    fpv_cam = join('quad_cam', cam)
    pivot(fpv_cam, (0, 0.048, 0.022))
    for x in (-0.0105, 0.0105):
        side = outline_slab('tpu', rounded_rect(0.03, 0.026, 0.006, cy=0.047), 0.0025, 0.0, bevel=0.0005)
        side.rotation_euler = (0, math.radians(90), 0)
        side.location = (x - 0.00125, 0, 0.022)  # just outside the camera
        bake_transform(side)
        side.location = (0, 0, 0)
        parts.append(assign(side, mats['tpu_black']))
    # The pack: rounded, wrapped, strapped on behind the GoPro, with its
    # leads to an XT60 and the red cap of a spare plug.
    pack = box('pack', 0.034, 0.064, 0.032, loc=(0, -0.02, 0.033 + 0.016), bevel=0.004)
    cube_uv(pack, 0.08)
    parts.append(assign(pack, mats['wrap']))
    for y in (-0.036, -0.006):
        strap = box('strap', 0.0352, 0.01, 0.0332, loc=(0, y, 0.0491), bevel=0.0015)
        parts.append(assign(strap, mats['strap']))
    lead_pts = [(0.008, -0.05, 0.044), (0.011, -0.057, 0.041), (0.013, -0.061, 0.036)]
    for k, m in ((0, mats['red']), (1, mats['black'])):
        cu = bpy.data.curves.new('lead', 'CURVE')
        cu.dimensions = '3D'
        sp = cu.splines.new('BEZIER')
        sp.bezier_points.add(len(lead_pts) - 1)
        for i, p in enumerate(lead_pts):
            bp = sp.bezier_points[i]
            bp.co = (p[0] - k * 0.006, p[1], p[2])
            bp.handle_left_type = bp.handle_right_type = 'AUTO'
        cu.bevel_depth = 0.0022
        cu.bevel_resolution = 3
        ob = link(bpy.data.objects.new('lead', cu))
        bpy.context.view_layer.update()
        me = bpy.data.meshes.new_from_object(ob.evaluated_get(bpy.context.evaluated_depsgraph_get()))
        lead = link(bpy.data.objects.new('lead', me))
        bpy.data.objects.remove(ob)
        parts.append(assign(lead, m))
    parts.append(assign(box('xt60', 0.008, 0.016, 0.008, loc=(0.012, -0.062, 0.034), bevel=0.001), mats['xt60']))
    parts.append(assign(box('cap', 0.007, 0.009, 0.007, loc=(-0.012, -0.05, 0.068), bevel=0.0012), mats['red']))
    # A GoPro in its TPU cradle, tilted up like the FPV camera: the body,
    # its big square lens housing, the glass, the button.
    gp = []
    gbody = box('gopro', 0.031, 0.022, 0.03, loc=(0, 0.03, 0.033 + 0.017), bevel=0.0025)
    gp.append(assign(gbody, mats['gopro']))
    hood = box('gphood', 0.024, 0.006, 0.024, loc=(0.0, 0.0425, 0.051), bevel=0.0025)
    gp.append(assign(hood, mats['gopro']))
    gglass = box('gpglass', 0.018, 0.0012, 0.018, loc=(0.0, 0.0464, 0.051), bevel=0.0004)
    gp.append(assign(gglass, mats['glass']))
    glens = cyl('gplens', 0.0058, 0.0012, z=0, n=32)
    glens.rotation_euler = (math.radians(90), 0, 0)
    glens.location = (0, 0.0468, 0.051)
    gp.append(assign(glens, mats['plastic']))
    gp.append(assign(cyl('gpbtn', 0.0035, 0.0012, z=0.033 + 0.032, x=0.0, y=0.026, n=20), mats['red']))
    gpiv = Vector((0, 0.03, 0.035))
    grot = Matrix.Translation(gpiv) @ Matrix.Rotation(math.radians(18), 4, 'X') @ Matrix.Translation(-gpiv)  # uptilted, as they fly
    for o in gp:
        bake_transform(o)
        o.data.transform(grot)
    parts += gp
    cradle = outline_slab('cradle', rounded_rect(0.036, 0.03, 0.004, cy=0.03), 0.003, 0.033, bevel=0.0006)
    parts.append(assign(cradle, mats['tpu_black']))
    for x in (-0.0175, 0.0175):
        wing = box('cradlewing', 0.003, 0.024, 0.02, loc=(x, 0.03, 0.044), bevel=0.001)
        parts.append(assign(wing, mats['tpu_black']))
    # Lollipop antenna out the back.
    mount = box('antmount', 0.012, 0.012, 0.01, loc=(-0.009, -0.059, 0.038), bevel=0.002)
    parts.append(assign(mount, mats['tpu_black']))
    coax = cyl('coax', 0.0012, 0.05, z=0, n=10)
    coax.rotation_euler = (math.radians(40), 0, 0)  # up and back
    coax.location = (-0.009, -0.052, 0.042)
    bake_transform(coax)
    parts.append(assign(coax, mats['black']))
    bulb = cyl('bulb', 0.0055, 0.003, z=-0.0015, n=24, bevel=0.0012)
    bulb.rotation_euler = (math.radians(40), 0, 0)
    bulb.location = (-0.009, -0.0695, 0.0635)
    bake_transform(bulb)
    parts.append(assign(bulb, mats['clear']))
    # LED strips under the arms (lit in the browser in JARVIS's colours).
    leds = []
    for sx, sy in ((1, 1), (-1, 1), (1, -1), (-1, -1)):
        leds.append(outline_slab('led', capsule(sx * 0.025, sy * 0.027, sx * 0.062, sy * 0.064, 0.004, 0.004), 0.0012, -0.0012))
    led = join('quad_led', leds)
    assign(led, mats['led'])
    # Motors and rotors.
    rotors = []
    for name, sx, sy, hand in (('fl', -1, 1, 1), ('fr', 1, 1, -1), ('rl', -1, -1, -1), ('rr', 1, -1, 1)):
        fixed, spin, ztop = motor('m_' + name, sx * S, sy * S, 0.005, mats)
        parts += fixed
        p = prop_mesh('prop', 0.065, 0.006, 3, 0.021, 26, 11, hand=hand)
        p.location = (sx * S, sy * S, ztop)
        assign(p, mats['prop'])
        bake_transform(p)
        rotor = join('quad_rotor_' + name, spin)
        for o in (rotor,):
            bake_transform(o)
        rotor_full = join('quad_rotor_' + name, [rotor, p])
        # Origin on the motor's axis, so it can spin in place.
        rotor_full.select_set(True)
        bpy.context.view_layer.objects.active = rotor_full
        bpy.context.scene.cursor.location = (sx * S, sy * S, 0)
        bpy.ops.object.origin_set(type='ORIGIN_CURSOR')
        rotors.append(rotor_full)
    body = join('quad_body', parts)
    return body, led, rotors, fpv_cam


# ---------------------------------------------------------------- tiny whoop

def tube(name, pts, r, res=4):
    """A round wire or bar along points."""
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
    bpy.context.view_layer.update()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(bpy.context.evaluated_depsgraph_get()))
    out = link(bpy.data.objects.new(name, me))
    bpy.data.objects.remove(ob)
    for p in out.data.polygons:
        p.use_smooth = True
    return out


def whoop(mats):
    S = 0.0265  # 75 mm wheelbase
    parts = []
    frame = []
    for sx, sy in ((1, 1), (-1, 1), (1, -1), (-1, -1)):
        x, y = sx * S, sy * S
        # The duct: a ring with a rolled lip, and guard ribs curving down
        # and in under it to a small foot ring.
        frame.append(outline_slab('duct', circle(x, y, 0.0206, 64), 0.011, 0.0, bevel=0.0005, holes=[circle(x, y, 0.0192, 64)[::-1]]))
        frame.append(outline_slab('lip', circle(x, y, 0.0216, 64), 0.0016, 0.011, bevel=0.0005, holes=[circle(x, y, 0.0196, 64)[::-1]]))
        out = math.atan2(sy, sx)
        for k in range(7):
            a = out + (k - 3) * math.radians(36)
            ca, sa = math.cos(a), math.sin(a)
            frame.append(tube('rib', [(x + ca * 0.0204, y + sa * 0.0204, 0.004), (x + ca * 0.0206, y + sa * 0.0206, -0.002), (x + ca * 0.0165, y + sa * 0.0165, -0.0085)], 0.0009, 2))
        frame.append(outline_slab('foot', circle(x, y, 0.0172, 48), 0.0014, -0.0095, bevel=0.0003, holes=[circle(x, y, 0.0152, 48)[::-1]]))
        # Motor mount on four spokes across the duct's bottom.
        frame.append(cyl('mmount', 0.0048, 0.0022, z=0.0, x=x, y=y, n=24))
        for k in range(4):
            a = math.pi / 4 + k * math.pi / 2
            frame.append(outline_slab('spoke', capsule(x, y, x + math.cos(a) * 0.0196, y + math.sin(a) * 0.0196, 0.0026, 0.002, 6), 0.0016, 0.0))
    frame.append(outline_slab('center', rounded_rect(0.032, 0.036, 0.007), 0.0022, 0.0, bevel=0.0005))
    # (As thick as the spokes, so the union merges their tops into one.)
    frame += [outline_slab('warm', capsule(sx * 0.009, sy * 0.009, sx * S * 0.7, sy * S * 0.7, 0.007, 0.006, 6), 0.0016, 0.0) for sx, sy in ((1, 1), (-1, 1), (1, -1), (-1, -1))]
    # One moulded piece: union everything into the centre plate, so the
    # translucent plastic has no overlapping faces inside it.
    hub = frame[-5]
    coll = bpy.data.collections.new('frameparts')
    bpy.context.scene.collection.children.link(coll)
    for o in frame:
        if o is not hub:
            for c in o.users_collection:
                c.objects.unlink(o)
            coll.objects.link(o)
    m = hub.modifiers.new('u', 'BOOLEAN')
    m.operation = 'UNION'
    m.solver = 'EXACT'
    m.operand_type = 'COLLECTION'
    m.collection = coll
    apply_mods(hub)
    for o in list(coll.objects):
        bpy.data.objects.remove(o)
    bpy.data.collections.remove(coll)
    hub.name = 'whoop_frame'
    parts.append(assign(hub, mats['whoop']))
    # The all-in-one board on its grommets: black, with its chips, the
    # receiver's red board and a few parts.
    parts.append(assign(box('fc', 0.026, 0.026, 0.0012, loc=(0, -0.002, 0.0045), bevel=0.0003), mats['pcb2']))
    for k, (cx, cy, w, d) in enumerate(((-0.006, -0.006, 0.006, 0.006), (0.006, -0.008, 0.004, 0.004), (0.007, 0.002, 0.003, 0.005), (-0.007, 0.004, 0.004, 0.003), (0.0, -0.011, 0.008, 0.002))):
        parts.append(assign(box('chip', w, d, 0.0012, loc=(cx, cy, 0.0057)), mats['chip']))
    parts.append(assign(box('rx', 0.009, 0.011, 0.0016, loc=(-0.0032, -0.004, 0.0068), bevel=0.0003), mats['rxboard']))
    for gx in (-0.0105, 0.0105):
        for gy in (-0.0125, 0.0085):
            parts.append(assign(cyl('grommet', 0.0016, 0.004, z=0.0018, x=gx, y=gy, n=12), mats['black']))
    # The silver camera cage: two side cheeks on a top bridge, the camera
    # held between them looking out of the nose, tilted up.
    cage = []
    for x in (-0.0085, 0.0085):
        cheek = outline_slab('cheek', [(-0.012, 0.0), (0.016, 0.0), (0.018, 0.006), (0.012, 0.019), (-0.004, 0.02), (-0.012, 0.008)], 0.0018, 0.0, bevel=0.0004,
                             holes=[circle(0.008, 0.011, 0.0032, 20)[::-1]])
        cheek.rotation_euler = (math.radians(90), 0, math.radians(90))
        cheek.location = (x + 0.0009, 0, 0.0055)
        bake_transform(cheek)
        cage.append(cheek)
    cage.append(box('bridge', 0.019, 0.016, 0.0018, loc=(0, -0.003, 0.0235), bevel=0.0006))
    cage.append(box('cagebase', 0.019, 0.006, 0.0018, loc=(0, 0.012, 0.0068), bevel=0.0005))
    parts.append(assign(join('cage', cage), mats['silver']))
    camb = box('wcam', 0.0145, 0.012, 0.0135, loc=(0, 0.011, 0.0135), bevel=0.0012)
    barrel = cyl('wbarrel', 0.0052, 0.007, z=0, n=32, bevel=0.0005)
    barrel.rotation_euler = (math.radians(-90), 0, 0)
    barrel.location = (0, 0.0175, 0.0135)
    ring = cyl('wring', 0.0058, 0.0016, z=0, n=32, bevel=0.0004)
    ring.rotation_euler = (math.radians(-90), 0, 0)
    ring.location = (0, 0.0235, 0.0135)
    lens = cyl('wlens', 0.0042, 0.0008, z=0, n=32)
    lens.rotation_euler = (math.radians(-90), 0, 0)
    lens.location = (0, 0.0247, 0.0135)
    cam = [assign(camb, mats['plastic']), assign(barrel, mats['plastic']), assign(ring, mats['silver']), assign(lens, mats['glass'])]
    for o in cam:
        bake_transform(o)
    fpv_cam = join('whoop_cam', cam)  # on a gimbal too, like the quad's
    pivot(fpv_cam, (0, 0.011, 0.0135))
    # The antenna: a black whip up and back from the cage, white at the tip.
    parts.append(assign(tube('whip', [(0.004, -0.008, 0.024), (0.006, -0.014, 0.04), (0.008, -0.02, 0.058)], 0.0011, 3), mats['black']))
    parts.append(assign(tube('whiptip', [(0.008, -0.02, 0.058), (0.0088, -0.0224, 0.066)], 0.0006, 2), mats['white']))
    # The 1S pack underneath, in its slot.
    parts.append(assign(box('1s', 0.012, 0.042, 0.008, loc=(0, -0.002, -0.0039), bevel=0.0015), mats['wrap_small']))
    rotors = []
    for name, sx, sy, hand in (('fl', -1, 1, 1), ('fr', 1, 1, -1), ('rl', -1, -1, -1), ('rr', 1, -1, 1)):
        x, y = sx * S, sy * S
        # Silver motor on the mount, its three wires running in to the board.
        parts.append(assign(cyl('wm', 0.0042, 0.0055, z=0.0022, x=x, y=y, n=24, bevel=0.0004), mats['alu']))
        for k, m in enumerate((mats['black'], mats['white'], mats['black'])):
            off = (k - 1) * 0.0011
            nx, ny = -sy * off, sx * off
            parts.append(assign(tube('wire', [(x * 0.8 + nx, y * 0.8 + ny, 0.0028), (x * 0.6 + nx, y * 0.6 + ny, 0.0032), (x * 0.4 + nx, y * 0.4 + ny, 0.0046)], 0.00045, 2), m))
        p = prop_mesh('wprop', 0.0158, 0.0025, 3, 0.0075, 24, 14, hand=hand, sections=12, chord_pts=7, thick=0.0006)
        p.location = (x, y, 0.0085)
        assign(p, mats['prop_clear'])
        bake_transform(p)
        p.name = 'whoop_rotor_' + name
        bpy.context.view_layer.objects.active = p
        bpy.context.scene.cursor.location = (x, y, 0)
        bpy.ops.object.select_all(action='DESELECT')
        p.select_set(True)
        bpy.ops.object.origin_set(type='ORIGIN_CURSOR')
        rotors.append(p)
    led = join('whoop_led', [outline_slab('wled', circle(sx * S, sy * S, 0.0207, 32), 0.0008, -0.0008, holes=[circle(sx * S, sy * S, 0.019, 32)[::-1]]) for sx, sy in ((1, 1), (-1, 1), (1, -1), (-1, -1))])
    assign(led, mats['led'])
    body = join('whoop_body', parts)
    return body, led, rotors, fpv_cam


# ---------------------------------------------------------------- scene

def materials():
    alb, rough = carbon_twill()
    carbon_img = save_png(alb, 'carbon.png')
    rough_img = save_png(np.repeat(rough[..., None], 3, -1), 'carbon_rough.png')
    wrap = save_png(pack_wrap(), 'wrap.png')
    return {
        'carbon': textured('carbon', carbon_img, rough_img),
        'wrap': textured('pack', wrap, rough=0.35),
        'wrap_small': textured('pack1s', wrap, rough=0.35),
        'alu': principled('aluminium', (0.72, 0.72, 0.74), 1.0, 0.28),
        'anod': principled('anodised', (0.55, 0.08, 0.06), 1.0, 0.3),
        'bell': principled('bell', (0.12, 0.13, 0.16), 1.0, 0.25),
        'copper': principled('copper', (0.85, 0.42, 0.2), 1.0, 0.35),
        'pcb': principled('pcb', (0.02, 0.09, 0.05), 0.0, 0.4),
        'pcb2': principled('pcb2', (0.03, 0.03, 0.035), 0.0, 0.4),
        'chip': principled('chip', (0.02, 0.02, 0.022), 0.0, 0.3),
        'capacitor': principled('capacitor', (0.05, 0.08, 0.2), 0.0, 0.35),
        'plastic': principled('plastic', (0.025, 0.025, 0.028), 0.0, 0.45),
        'glass': principled('lensglass', (0.02, 0.03, 0.05), 0.0, 0.03, coat=1.0),
        'tpu': principled('tpu', (0.85, 0.32, 0.05), 0.0, 0.6),
        'strap': principled('strap', (0.03, 0.03, 0.03), 0.0, 0.8),
        'red': principled('lead_red', (0.6, 0.03, 0.03), 0.0, 0.45),
        'black': principled('lead_black', (0.02, 0.02, 0.02), 0.0, 0.45),
        'xt60': principled('xt60', (0.85, 0.65, 0.05), 0.0, 0.4),
        'clear': principled('clear', (0.8, 0.85, 0.9), 0.0, 0.1, alpha=0.6),
        'prop': principled('prop', (0.12, 0.62, 0.75), 0.0, 0.18, alpha=0.92),
        'prop_clear': principled('prop_clear', (0.85, 0.88, 0.9), 0.0, 0.2, alpha=0.8),
        'gold': principled('gold', (0.92, 0.7, 0.22), 1.0, 0.3),
        'gopro': principled('gopro', (0.03, 0.03, 0.035), 0.0, 0.55),
        'tpu_black': principled('tpu_black', (0.035, 0.035, 0.04), 0.0, 0.7),
        'silver': principled('silver', (0.72, 0.73, 0.76), 0.9, 0.32),
        'rxboard': principled('rxboard', (0.5, 0.05, 0.04), 0.0, 0.4),
        'white': principled('white', (0.85, 0.85, 0.85), 0.0, 0.4),
        'led': principled('led', (0.0, 0.0, 0.0), 0.0, 0.4, emission=(0.45, 0.55, 1.0), strength=6.0),
        'whoop': principled('whoop', (0.3, 0.62, 0.88), 0.0, 0.25, alpha=0.78),
    }


def preview(objs):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.samples = 96
    sc.cycles.use_denoising = True
    sc.render.resolution_x, sc.render.resolution_y = 1600, 900
    sc.view_settings.view_transform = 'AgX'
    world = bpy.data.worlds.new('w')
    sc.world = world
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.3, 0.32, 0.36, 1)
    sc.view_settings.exposure = -0.3
    for loc, energy, size in (((0.3, -0.25, 0.35), 9, 0.3), ((-0.35, 0.2, 0.25), 4, 0.4), ((0, 0.4, 0.05), 2, 0.5)):
        l = bpy.data.lights.new('l', 'AREA')
        l.energy = energy
        l.size = size
        lo = link(bpy.data.objects.new('l', l))
        lo.location = loc
        lo.rotation_euler = (Vector((0, 0, 0.02)) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    floor = mesh_from('floor', [(-1, -1, -0.004), (1, -1, -0.004), (1, 1, -0.004), (-1, 1, -0.004)], [(0, 1, 2, 3)], smooth=False)
    assign(floor, principled('floor', (0.5, 0.5, 0.52), 0.0, 0.6))
    cam = link(bpy.data.objects.new('cam', bpy.data.cameras.new('cam')))
    cam.data.lens = 50
    cam.location = (0.36, 0.34, 0.19)
    cam.rotation_euler = (Vector((0.075, 0.0, 0.03)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
    sc.camera = cam
    sc.render.filepath = os.path.join(OUT, 'fpv-preview.png')
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(floor)
    print('preview written', flush=True)


def aim(cam, at):
    """Turn a gimballed camera (looking along +Y at rest) towards a point, within its travel."""
    bpy.context.view_layer.update()
    d = Vector(at) - cam.matrix_world.translation
    yaw = max(-1.05, min(1.05, math.atan2(-d.x, d.y)))
    pitch = max(-1.3, min(0.7, math.atan2(d.z, math.hypot(d.x, d.y))))
    cam.rotation_euler = (pitch, 0, yaw)


def main():
    reset()
    mats = materials()
    q_body, q_led, q_rotors, q_cam = quad(mats)
    w_body, w_led, w_rotors, w_cam = whoop(mats)
    whoop_all = [w_body, w_led, *w_rotors, w_cam]
    # Side by side for the preview; the browser places each at its own origin.
    for o in whoop_all:
        o.location.x += 0.17
    if PREVIEW:
        # Both cameras look at the lens taking the picture.
        for c in (q_cam, w_cam):
            aim(c, (0.36, 0.34, 0.19))
        preview([q_body, w_body])
    for o in whoop_all:
        o.location.x -= 0.17
    for c in (q_cam, w_cam):
        c.rotation_euler = (0, 0, 0)  # exported level; the browser aims them
    bpy.ops.object.select_all(action='DESELECT')
    for o in [q_body, q_led, *q_rotors, q_cam, *whoop_all]:
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, 'fpv.glb'), export_format='GLB', use_selection=True, export_yup=True, export_apply=True, export_image_format='JPEG')
    print('exported', flush=True)


main()
