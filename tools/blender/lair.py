"""
Builds the JARVIS Station's house — a round glass pavilion on a sea cliff,
in the spirit of Tony Stark's Malibu house — in Blender, and bakes its
lighting with Cycles for the live scene.

Inside: a polished travertine floor round a black marble stage (the console
and the six zones stand on it), board-formed concrete walls behind, a white
ceiling with a raised coffer over the console, and across the front half a
curved wall of floor-to-ceiling glass in slim black frames, its middle
panel slid open. Outside: a travertine terrace with an infinity pool and a
glass balustrade at the cliff edge, the roof cantilevered out over it with
a ribbon of light under its lip, limestone cliffs dropping to the sea, and
gardens either side. The browser draws the sky, the sun, the sea and the
pool's water live.

Each baked surface gets two maps:

  detail   its colour — travertine pores and veins, marble veins, hairline
           cracks, board marks — with crevices darkened (short-range ambient
           occlusion), at full resolution
  light    the light falling on it, bounced round the house by Cycles and
           denoised, with three kinds of light kept apart in its channels:
             red    the house's warm lights (downlights, uplights, coves,
                    LED strips)
             green  JARVIS's own light (the halo in the coffer, the line
                    round the stage, the glow of the console and zones)
             blue   daylight from the sky, through the glass and round the
                    terrace
           so the browser can colour each live: JARVIS's light in his
           current colour, the sky's by the real time of day. (For that
           bake every surface is made grey, so the channels don't mix.)
           Direct sun and moonlight are added live too, with the shadows of
           the window frames and the roof worked out in the shader.

The floor, stage, terrace and walls also get normal maps. Frames, rails,
glass and the light strips are exported as their own meshes.

Run from the repo root (Blender's Python module, ~400 MB):

  python3 -m venv .bpy && .bpy/bin/pip install bpy pillow
  .bpy/bin/python tools/blender/lair.py                      # full bake
  .bpy/bin/python tools/blender/lair.py --size 512 --light 256 --samples 8 --out /tmp/lair
  .bpy/bin/python tools/blender/lair.py --preview-only --out /tmp/lair   # just a render

Optional: `pip install oidn` for denoising (its bundled libtbb may need a
`libtbb.so.12` symlink next to it); without it a gentler filter is used.

Writes lair.glb, {name}_{detail,light}_{ultra,high,low}.jpg, normal maps and
a Cycles render, lair-preview.png, to public/station (or --out). Blender is
Z-up with the window towards +Y; glTF turns that into three.js's Y-up with
the window at −Z, which is where the console's chair faces. The sizes here
are mirrored in src/station/layout.ts (HOUSE).
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


def arg(name, default):
    if name in sys.argv:
        return type(default)(sys.argv[sys.argv.index(name) + 1])
    return default


SIZE = arg('--size', 4096)  # detail maps
LIGHT = arg('--light', 2048)  # lightmaps
SAMPLES = arg('--samples', 64)
OUT = os.path.abspath(arg('--out', os.path.join(ROOT, 'public', 'station')))
PREVIEW = '--no-preview' not in sys.argv
PREVIEW_ONLY = '--preview-only' in sys.argv
# Rebake only the lighting (the detail maps from an earlier run still fit:
# the model and its UVs come out the same every time).
LIGHT_ONLY = '--light-only' in sys.argv
# Light is stored as light / LM_SCALE so bright spots survive 8 bits.
LM_SCALE = 6.0

R = 15.0  # the house: glass and back wall
WALL_T = 0.4
H = 4.6  # ceiling
STAGE_R = 8.1
STAGE_H = 0.16
FORWARD = math.pi / 2  # +Y: out of the window
GLASS_A0, GLASS_A1 = 0.0, math.pi  # the front half is glass
BAYS = 13
DOOR = BAYS // 2  # the middle bay stands open onto the terrace
COFFER_R = 4.2
DECK_A0, DECK_A1 = -math.radians(8), math.pi + math.radians(8)
DECK_R = 24.0
RAIL_R = 23.7
POOL_R0, POOL_R1 = 17.8, 21.2
POOL_A0, POOL_A1 = FORWARD - math.radians(40), FORWARD + math.radians(40)
POOL_D = 1.3
SEA = -28.0


def roof_edge(a):
    """The roof's outline: a long cantilever over the terrace, tight at the back."""
    w = max(0.0, math.cos(a - FORWARD)) ** 1.3
    return R + 1.2 + 3.9 * w + 0.7 * math.sin(2 * a + 0.6) * w


def cliff_edge(a):
    """Where the land ends: just past the terrace in front, far off behind."""
    da = abs(math.atan2(math.sin(a - FORWARD), math.cos(a - FORWARD)))
    t = min(1.0, max(0.0, (da - math.radians(95)) / math.radians(55)))
    return DECK_R + 0.4 + 40.0 * t * t * (3 - 2 * t) + (0.25 + t) * noise.noise(Vector((math.cos(a) * 3, math.sin(a) * 3, 0.5)))


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


def arc(fr, a0, a1, res):
    """Points along a curve at radius fr(a) (a number or a function of a)."""
    f = fr if callable(fr) else (lambda a: fr)
    return [(f(a) * math.cos(a), f(a) * math.sin(a)) for a in np.linspace(a0, a1, res)]


def slab(name, loops, z0, z1, bevel=0.0):
    """An extruded 2D shape: the first loop is the outline, the rest holes."""
    cu = bpy.data.curves.new(name, 'CURVE')
    cu.dimensions = '2D'
    cu.fill_mode = 'BOTH'
    for loop in loops:
        sp = cu.splines.new('POLY')
        sp.points.add(len(loop) - 1)
        for i, (x, y) in enumerate(loop):
            sp.points[i].co = (x, y, 0, 1)
        sp.use_cyclic_u = True
    h = z1 - z0
    cu.bevel_depth = min(bevel, h / 2 - 1e-4) if bevel else 0.0
    cu.bevel_resolution = 2
    cu.extrude = max(0.0, h / 2 - cu.bevel_depth)
    cu.offset = -cu.bevel_depth
    ob = link(bpy.data.objects.new(name, cu))
    ob.location.z = (z0 + z1) / 2
    return evaluated(ob, name)


def sector(name, r_in, r_out, z0, z1, a0, a1, bevel=0.01, res=None):
    """A slab cut from a ring between angles a0..a1 (or a full disc/ring)."""
    full = a1 - a0 >= math.tau - 1e-6
    res = res or max(16, int(abs(a1 - a0) / math.tau * 256))
    if full:
        loops = [arc(r_out, 0, math.tau, res + 1)[:-1]]
        if r_in > 0:
            loops.append(arc(r_in, math.tau, 0, res + 1)[:-1])
    else:
        loops = [arc(r_out, a0, a1, res) + arc(r_in, a1, a0, res)]
    return slab(name, loops, z0, z1, bevel)


def box(name, half, loc, rot_z=0.0, bevel=0.01, shape=None):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=2.0)
    for v in bm.verts:
        x, y, z = v.co.x * half[0], v.co.y * half[1], v.co.z * half[2]
        if shape:
            x, y, z = shape(x, y, z)
        v.co = Vector((x, y, z))
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


def blob(name, loc, radius, squash, seed):
    """A lumpy ball: a shrub or a tree's crown."""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=3, radius=radius)
    for v in bm.verts:
        d = v.co.normalized()
        k = 1 + 0.28 * noise.noise(d * 2.2 + Vector((seed, seed * 1.3, 0))) + 0.1 * noise.noise(d * 6 + Vector((seed, 0, seed)))
        v.co = Vector((v.co.x * k, v.co.y * k, v.co.z * k * squash))
    bm.to_mesh(me)
    bm.free()
    ob = link(bpy.data.objects.new(name, me))
    ob.location = loc
    for p in ob.data.polygons:
        p.use_smooth = True
    return ob


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


# ---------------------------------------------------------------- node helpers

def new_mat(name):
    m = bpy.data.materials.new(name)
    return m, m.node_tree, m.node_tree.nodes['Principled BSDF']


def n(nt, kind, **inputs):
    node = nt.nodes.new(kind)
    for k, v in inputs.items():
        if k.startswith('_'):
            setattr(node, k[1:], v)
        else:
            put(nt, node.inputs[k], v)
    return node


def put(nt, inp, v):
    if isinstance(v, bpy.types.NodeSocket):
        nt.links.new(v, inp)
    else:
        inp.default_value = v


def op(nt, operation, a, b=0.0, c=0.0):
    m = nt.nodes.new('ShaderNodeMath')
    m.operation = operation
    for i, v in enumerate((a, b, c)):
        put(nt, m.inputs[i], v)
    return m.outputs[0]


def remap(nt, x, f0, f1, t0, t1, smooth=False):
    m = n(nt, 'ShaderNodeMapRange', Value=x, **{'From Min': f0, 'From Max': f1, 'To Min': t0, 'To Max': t1})
    if smooth:
        m.interpolation_type = 'SMOOTHSTEP'
    m.clamp = True
    return m.outputs['Result']


def coords(nt):
    return n(nt, 'ShaderNodeTexCoord').outputs['Object']


def stretch(nt, vec, sx, sy, sz, offset=(0, 0, 0)):
    m = n(nt, 'ShaderNodeMapping', Vector=vec)
    m.inputs['Scale'].default_value = (sx, sy, sz)
    m.inputs['Location'].default_value = offset
    return m.outputs['Vector']


def tex_noise(nt, vec, scale, detail=6.0, rough=0.55, distortion=0.0, out='Fac'):
    return n(nt, 'ShaderNodeTexNoise', Vector=vec, Scale=scale, Detail=detail, Roughness=rough, Distortion=distortion).outputs[out]


def mul(nt, col, k):
    """Colour times a value (or another colour)."""
    m = n(nt, 'ShaderNodeMix', _data_type='RGBA', _blend_type='MULTIPLY', Factor=1.0)
    put(nt, m.inputs[6], col)
    put(nt, m.inputs[7], k)
    return m.outputs[2]


def blend(nt, fac, a, b):
    m = n(nt, 'ShaderNodeMix', _data_type='RGBA', Factor=fac)
    put(nt, m.inputs[6], a)
    put(nt, m.inputs[7], b)
    return m.outputs[2]


def veins(nt, vec, scale, width, distortion=2.0, detail=6.0):
    """Marble veins: thin lines along a warped noise's contour."""
    nz = tex_noise(nt, vec, scale, detail, 0.6, distortion)
    d = op(nt, 'ABSOLUTE', op(nt, 'SUBTRACT', nz, 0.5))
    return remap(nt, d, 0.0, width, 1.0, 0.0, smooth=True)


def cracks(nt, vec, scale, width, amount):
    """Hairline cracks: wiggly cell edges, only here and there."""
    warp = tex_noise(nt, vec, scale * 3.0, 4.0, 0.5, 0.0, out='Color')
    shifted = n(nt, 'ShaderNodeVectorMath', _operation='SUBTRACT', **{})
    put(nt, shifted.inputs[0], warp)
    shifted.inputs[1].default_value = (0.5, 0.5, 0.5)
    scaled = n(nt, 'ShaderNodeVectorMath', _operation='SCALE')
    nt.links.new(shifted.outputs[0], scaled.inputs[0])
    scaled.inputs['Scale'].default_value = 0.45 / scale
    moved = n(nt, 'ShaderNodeVectorMath', _operation='ADD')
    put(nt, moved.inputs[0], vec)
    nt.links.new(scaled.outputs[0], moved.inputs[1])
    vo = n(nt, 'ShaderNodeTexVoronoi', _feature='DISTANCE_TO_EDGE', Scale=scale)
    nt.links.new(moved.outputs[0], vo.inputs['Vector'])
    line = remap(nt, vo.outputs['Distance'], 0.0, width * scale, 1.0, 0.0, smooth=True)
    where = remap(nt, tex_noise(nt, stretch(nt, vec, 1, 1, 1, (17.3, 4.1, 9.7)), scale * 0.6, 3.0), 1.0 - amount, 1.06 - amount, 0.0, 1.0, smooth=True)
    return op(nt, 'MULTIPLY', line, where)


def finish(nt, b, color, rough, height, strength, distance=0.004):
    put(nt, b.inputs['Base Color'], color)
    put(nt, b.inputs['Roughness'], rough)
    bump = n(nt, 'ShaderNodeBump', Strength=strength, Distance=distance, Height=height)
    nt.links.new(bump.outputs['Normal'], b.inputs['Normal'])


# ---------------------------------------------------------------- materials

def travertine(name, rough, slab_w=2.4, slab_h=1.2):
    """Cream travertine in big offset slabs: streaky bands, pores, faint
    veins, hairline cracks and the odd darker slab."""
    m, nt, b = new_mat(name)
    co = coords(nt)
    brick = n(nt, 'ShaderNodeTexBrick', Vector=co, Scale=1.0, Bias=0.0, **{'Mortar Size': 0.004, 'Mortar Smooth': 0.3, 'Brick Width': slab_w, 'Row Height': slab_h})
    brick.offset = 0.5
    brick.inputs['Color1'].default_value = (0.47, 0.41, 0.32, 1)
    brick.inputs['Color2'].default_value = (0.56, 0.5, 0.4, 1)
    brick.inputs['Mortar'].default_value = (0, 0, 0, 1)
    seam = brick.outputs['Fac']
    streak = tex_noise(nt, stretch(nt, co, 0.35, 5.0, 1.0), 2.2, 8.0, 0.55, 0.3)
    pores_v = n(nt, 'ShaderNodeTexVoronoi', Vector=stretch(nt, co, 1.0, 4.5, 1.0), Scale=38.0).outputs['Distance']
    pores = op(nt, 'MULTIPLY', remap(nt, pores_v, 0.0, 0.13, 1.0, 0.0, smooth=True), remap(nt, tex_noise(nt, co, 1.3, 2.0), 0.4, 0.7, 0.2, 1.0))
    vein = veins(nt, co, 0.22, 0.012, 2.2)
    crack = cracks(nt, co, 0.42, 0.004, 0.42)
    col = mul(nt, brick.outputs['Color'], remap(nt, streak, 0.3, 0.72, 0.84, 1.07))
    col = mul(nt, col, op(nt, 'SUBTRACT', 1.0, op(nt, 'MULTIPLY', pores, 0.4)))
    col = mul(nt, col, op(nt, 'SUBTRACT', 1.0, op(nt, 'MULTIPLY', vein, 0.16)))
    col = mul(nt, col, op(nt, 'SUBTRACT', 1.0, op(nt, 'MULTIPLY', crack, 0.6)))
    col = mul(nt, col, op(nt, 'SUBTRACT', 1.0, op(nt, 'MULTIPLY', seam, 0.55)))
    r = op(nt, 'ADD', rough, op(nt, 'ADD', op(nt, 'MULTIPLY', pores, 0.3), op(nt, 'MULTIPLY', crack, 0.4)))
    height = op(nt, 'SUBTRACT', op(nt, 'MULTIPLY', streak, 0.05), op(nt, 'ADD', seam, op(nt, 'ADD', op(nt, 'MULTIPLY', crack, 0.7), op(nt, 'MULTIPLY', pores, 0.45))))
    finish(nt, b, col, r, height, 0.6, 0.003)
    return m


def black_marble(name):
    """Nero Marquina: near-black, white veins, laid in rings and spokes."""
    m, nt, b = new_mat(name)
    co = coords(nt)
    cloud = remap(nt, tex_noise(nt, co, 0.6, 6.0), 0.3, 0.7, 0.75, 1.3)
    base = mul(nt, (0.011, 0.011, 0.013, 1), cloud)
    v1 = veins(nt, co, 0.2, 0.006, 2.6, 7.0)
    v2 = op(nt, 'MULTIPLY', veins(nt, stretch(nt, co, 1, 1, 1, (5.1, 2.3, 0.7)), 0.85, 0.0035, 1.6, 5.0), 0.5)
    crack = cracks(nt, co, 0.5, 0.0035, 0.5)
    v = op(nt, 'MAXIMUM', op(nt, 'MAXIMUM', v1, v2), op(nt, 'MULTIPLY', crack, 0.7))
    col = blend(nt, v, base, (0.34, 0.33, 0.305, 1))
    # Rings and spokes, like stone laid round a centre.
    sep = n(nt, 'ShaderNodeSeparateXYZ', Vector=co)
    ang = op(nt, 'ARCTAN2', sep.outputs['Y'], sep.outputs['X'])
    spokes = op(nt, 'PINGPONG', op(nt, 'MULTIPLY', ang, 36 / math.tau), 0.5)
    ln = n(nt, 'ShaderNodeVectorMath', _operation='LENGTH')
    put(nt, ln.inputs[0], co)
    rings = op(nt, 'PINGPONG', op(nt, 'MULTIPLY', ln.outputs['Value'], 1 / 1.35), 0.5)
    seam = op(nt, 'MAXIMUM', remap(nt, spokes, 0.0, 0.008, 1.0, 0.0), remap(nt, rings, 0.0, 0.004, 1.0, 0.0))
    col = mul(nt, col, op(nt, 'SUBTRACT', 1.0, op(nt, 'MULTIPLY', seam, 0.7)))
    rough = op(nt, 'ADD', 0.07, op(nt, 'ADD', op(nt, 'MULTIPLY', v, 0.08), op(nt, 'MULTIPLY', tex_noise(nt, co, 30.0, 4.0), 0.06)))
    height = op(nt, 'SUBTRACT', 0.0, op(nt, 'ADD', seam, op(nt, 'MULTIPLY', crack, 0.5)))
    finish(nt, b, col, rough, height, 0.5, 0.003)
    return m


def concrete(name, board=0.25):
    """Board-formed concrete: plank marks, tie holes, the odd crack."""
    m, nt, b = new_mat(name)
    co = coords(nt)
    sep = n(nt, 'ShaderNodeSeparateXYZ', Vector=co)
    z = sep.outputs['Z']
    u = op(nt, 'MULTIPLY', op(nt, 'ARCTAN2', sep.outputs['Y'], sep.outputs['X']), R)
    plank = op(nt, 'FLOOR', op(nt, 'DIVIDE', z, board))
    rnd = n(nt, 'ShaderNodeTexWhiteNoise', _noise_dimensions='1D', W=plank).outputs['Value']
    line = remap(nt, op(nt, 'PINGPONG', op(nt, 'DIVIDE', z, board), 0.5), 0.0, 0.025, 1.0, 0.0)
    grain = tex_noise(nt, stretch(nt, co, 0.6, 0.6, 14.0), 3.0, 8.0, 0.6)
    mott = tex_noise(nt, co, 0.8, 6.0, 0.6)
    tu = op(nt, 'SUBTRACT', op(nt, 'FRACT', op(nt, 'DIVIDE', u, 0.9)), 0.5)
    tv = op(nt, 'SUBTRACT', op(nt, 'FRACT', op(nt, 'DIVIDE', op(nt, 'ADD', z, 0.375), 0.75)), 0.5)
    tie = remap(nt, op(nt, 'ADD', op(nt, 'MULTIPLY', tu, tu), op(nt, 'MULTIPLY', tv, tv)), 0.0, 0.0012, 1.0, 0.0, smooth=True)
    crack = cracks(nt, co, 0.6, 0.004, 0.3)
    tone = op(nt, 'MULTIPLY', remap(nt, rnd, 0, 1, 0.9, 1.08), remap(nt, mott, 0.3, 0.7, 0.86, 1.1))
    tone = op(nt, 'MULTIPLY', tone, remap(nt, grain, 0.3, 0.7, 0.92, 1.05))
    col = mul(nt, (0.29, 0.275, 0.255, 1), tone)
    dark = op(nt, 'MAXIMUM', op(nt, 'MAXIMUM', op(nt, 'MULTIPLY', line, 0.35), op(nt, 'MULTIPLY', tie, 0.7)), op(nt, 'MULTIPLY', crack, 0.55))
    col = mul(nt, col, op(nt, 'SUBTRACT', 1.0, dark))
    height = op(nt, 'SUBTRACT', op(nt, 'MULTIPLY', grain, 0.3), op(nt, 'ADD', line, op(nt, 'ADD', tie, crack)))
    finish(nt, b, col, 0.82, height, 0.45, 0.006)
    return m


def plaster(name, color=(0.62, 0.6, 0.56)):
    m, nt, b = new_mat(name)
    co = coords(nt)
    tone = remap(nt, tex_noise(nt, co, 1.5, 6.0), 0.3, 0.7, 0.95, 1.04)
    finish(nt, b, mul(nt, (*color, 1), tone), 0.88, tex_noise(nt, co, 40.0, 4.0), 0.05, 0.002)
    return m


def tiles(name):
    """Pool mosaic: small glass tiles in aqua."""
    m, nt, b = new_mat(name)
    co = coords(nt)
    brick = n(nt, 'ShaderNodeTexBrick', Vector=co, Scale=1.0, Bias=0.0, **{'Mortar Size': 0.002, 'Mortar Smooth': 0.2, 'Brick Width': 0.025, 'Row Height': 0.025})
    brick.offset = 0.0
    brick.inputs['Color1'].default_value = (0.04, 0.26, 0.3, 1)
    brick.inputs['Color2'].default_value = (0.09, 0.38, 0.4, 1)
    brick.inputs['Mortar'].default_value = (0.5, 0.52, 0.5, 1)
    finish(nt, b, brick.outputs['Color'], 0.15, op(nt, 'SUBTRACT', 0.0, brick.outputs['Fac']), 0.4, 0.002)
    return m


def bronze(name):
    """The two pillars framing the glass: dark bronze-clad, brushed."""
    m, nt, b = new_mat(name)
    co = coords(nt)
    brush = tex_noise(nt, stretch(nt, co, 40.0, 40.0, 0.4), 4.0, 6.0)
    patina = tex_noise(nt, co, 1.2, 6.0)
    col = mul(nt, (0.16, 0.095, 0.055, 1), op(nt, 'MULTIPLY', remap(nt, brush, 0.3, 0.7, 0.85, 1.12), remap(nt, patina, 0.3, 0.7, 0.75, 1.15)))
    # Metallic in the browser; flat here so its colour bakes.
    finish(nt, b, col, 0.4, brush, 0.15, 0.002)
    return m


def flat(name, color, metal=0.0, rough=0.5):
    m, nt, b = new_mat(name)
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Metallic'].default_value = metal
    b.inputs['Roughness'].default_value = rough
    return m


def limestone(name):
    """The cliffs: pale layered limestone, weathered."""
    m, nt, b = new_mat(name)
    co = coords(nt)
    sep = n(nt, 'ShaderNodeSeparateXYZ', Vector=co)
    warp = tex_noise(nt, co, 0.08, 4.0)
    strata = op(nt, 'SINE', op(nt, 'MULTIPLY', op(nt, 'MULTIPLY_ADD', warp, 6.0, sep.outputs['Z']), 1.7))
    big = tex_noise(nt, co, 0.05, 6.0, 0.6)
    grit = tex_noise(nt, co, 3.0, 10.0, 0.7)
    ramp = n(nt, 'ShaderNodeValToRGB', Fac=op(nt, 'MULTIPLY_ADD', strata, 0.1, big))
    ramp.color_ramp.elements[0].color = (0.2, 0.18, 0.145, 1)
    ramp.color_ramp.elements[1].color = (0.5, 0.45, 0.37, 1)
    streak = remap(nt, tex_noise(nt, stretch(nt, co, 1.0, 1.0, 0.15), 0.4, 5.0), 0.45, 0.75, 1.0, 0.6)
    col = mul(nt, mul(nt, ramp.outputs['Color'], remap(nt, grit, 0.3, 0.7, 0.8, 1.1)), streak)
    finish(nt, b, col, 0.9, op(nt, 'MULTIPLY_ADD', strata, 0.3, grit), 0.8, 0.08)
    return m


def garden(name):
    """Ground round the house: grass, earth and stones."""
    m, nt, b = new_mat(name)
    co = coords(nt)
    patch = tex_noise(nt, co, 0.3, 6.0, 0.6)
    fine = tex_noise(nt, co, 6.0, 8.0, 0.7)
    col = blend(nt, remap(nt, patch, 0.4, 0.62, 0.0, 1.0, smooth=True), (0.045, 0.075, 0.025, 1), (0.11, 0.085, 0.055, 1))
    col = mul(nt, col, remap(nt, fine, 0.3, 0.7, 0.7, 1.2))
    finish(nt, b, col, 0.95, fine, 0.6, 0.05)
    return m


def foliage(name, c0, c1):
    m, nt, b = new_mat(name)
    co = coords(nt)
    v = tex_noise(nt, co, 4.0, 6.0, 0.7)
    leaf = n(nt, 'ShaderNodeTexVoronoi', Vector=co, Scale=14.0).outputs['Distance']
    col = mul(nt, blend(nt, v, (*c0, 1), (*c1, 1)), remap(nt, leaf, 0.0, 0.4, 0.55, 1.1))
    finish(nt, b, col, 0.75, leaf, 0.6, 0.03)
    return m


def emission(name, color, strength, channel):
    m, nt, b = new_mat(name)
    b.inputs['Base Color'].default_value = (0, 0, 0, 1)
    b.inputs['Emission Color'].default_value = (*color, 1)
    b.inputs['Emission Strength'].default_value = strength
    m['channel'] = channel
    return m


def assign(ob, mat):
    ob.data.materials.clear()
    ob.data.materials.append(mat)
    return ob


# ---------------------------------------------------------------- terrain

def cliff_band(name, rows=44, cols=520):
    """The cliff face all round, from the lip down into the sea: steep,
    ledged, leaning out a little towards the bottom. Faces point out."""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    grid = []
    for j in range(rows + 1):
        t = j / rows
        z = -0.2 + (SEA - 3.0 + 0.2) * t
        row = []
        for i in range(cols):
            a = math.tau * i / cols
            p = Vector((math.cos(a) * 9, math.sin(a) * 9, z * 0.3))
            r = cliff_edge(a) + 0.15 + 6.0 * t ** 1.6 + (2.2 * fbm(p * 0.7) + 0.6 * fbm(p * 3.0, 4)) * min(1.0, t * 6)
            strata = z * 0.9 + 1.2 * fbm(p * 0.5, 3)
            r += 0.5 * abs((strata % 2.0) - 1.0) ** 3 * min(1.0, t * 8)
            row.append(bm.verts.new((math.cos(a) * r, math.sin(a) * r, z)))
        grid.append(row)
    for j in range(rows):
        for i in range(cols):
            k = (i + 1) % cols
            bm.faces.new((grid[j][i], grid[j][k], grid[j + 1][k], grid[j + 1][i]))
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    ob = link(bpy.data.objects.new(name, me))
    for p in ob.data.polygons:
        p.use_smooth = True
    return ob


def plants(leaf_a, leaf_b, trunk):
    """Shrubs along the terrace's ends and round the house, a few trees."""
    rng = np.random.default_rng(7)
    shrubs, crowns, trunks = [], [], []
    for i in range(70):
        side = rng.choice([-1, 1])
        if i < 40:  # either end of the terrace
            a = (DECK_A0 - rng.uniform(0.02, 0.5)) if side < 0 else (DECK_A1 + rng.uniform(0.02, 0.5))
            r = rng.uniform(R + 1.5, cliff_edge(a) - 1.2)
        else:  # round the back
            a = rng.uniform(DECK_A1 + 0.5, DECK_A0 + math.tau - 0.5)
            r = rng.uniform(R + 2.0, R + 12.0)
        s = rng.uniform(0.35, 0.95)
        shrubs.append(blob(f'shrub{i}', (r * math.cos(a), r * math.sin(a), -0.2 + s * 0.4), s, rng.uniform(0.55, 0.85), i * 1.7))
    for i in range(9):
        a = (DECK_A0 - rng.uniform(0.12, 0.6)) if i % 2 else (DECK_A1 + rng.uniform(0.12, 0.6))
        if i > 6:
            a = rng.uniform(DECK_A1 + 0.6, DECK_A0 + math.tau - 0.6)
        r = rng.uniform(R + 3.0, min(R + 9.0, cliff_edge(a) - 2.0))
        x, y = r * math.cos(a), r * math.sin(a)
        h = rng.uniform(3.8, 6.5)
        trunks.append(box(f'trunk{i}', (0.12, 0.12, h / 2), (x, y, -0.2 + h / 2), rng.uniform(0, 3), bevel=0.04, shape=lambda x_, y_, z_: (x_ * (0.7 if z_ > 0 else 1.2), y_ * (0.7 if z_ > 0 else 1.2), z_)))
        for k in range(3):
            off = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), 0)) * 1.1
            crowns.append(blob(f'crown{i}_{k}', (x + off.x, y + off.y, -0.2 + h - 0.3 + rng.uniform(-0.5, 0.6)), rng.uniform(1.1, 1.8), 0.62, i * 3.1 + k))
    for ob in shrubs:
        assign(ob, leaf_a)
    for ob in crowns:
        assign(ob, leaf_b)
    for ob in trunks:
        assign(ob, trunk)
    return join('plants', shrubs + crowns + trunks)


# ---------------------------------------------------------------- build

def build():
    reset()
    sc = bpy.context.scene
    floor_m = travertine('floor_m', 0.1)
    deck_m = travertine('deck_m', 0.42, 2.8, 1.4)
    stage_m = black_marble('stage_m')
    wall_m = concrete('wall_m')
    ceil_m = plaster('ceiling_m')
    tile_m = tiles('pool_m')
    pillar_m = bronze('pillar_m')
    frame_m = flat('frame_m', (0.018, 0.018, 0.02), 0.85, 0.3)
    rail_m = flat('rail_m', (0.62, 0.62, 0.64), 1.0, 0.18)
    rock_m = limestone('cliff_m')
    ground_m = garden('terrain_m')
    leaf_a = foliage('leaf_a', (0.02, 0.06, 0.015), (0.06, 0.11, 0.03))
    leaf_b = foliage('leaf_b', (0.025, 0.055, 0.02), (0.07, 0.1, 0.035))
    bark = flat('bark', (0.07, 0.05, 0.035), 0.0, 0.9)
    warm = emission('warm', (1.0, 0.72, 0.45), 14.0, 'warm')
    cool = emission('cool', (0.55, 0.65, 1.0), 10.0, 'cool')

    parts = {}
    # Inside: travertine floor round the black marble stage.
    parts['floor'] = assign(sector('floor', STAGE_R - 0.05, R + 0.2, -0.05, 0.0, 0, math.tau, bevel=0.0, res=192), floor_m)
    parts['stage'] = assign(sector('stage', 0, STAGE_R, -0.02, STAGE_H, 0, math.tau, bevel=0.03, res=192), stage_m)

    # The back half: board-formed concrete, in three parts so the overview
    # can cut the one nearest the camera away.
    walls = {
        'wall_left': (GLASS_A1, math.radians(225)),
        'wall_front': (math.radians(225), math.radians(315)),
        'wall_right': (math.radians(315), math.tau),
    }
    for name, (a0, a1) in walls.items():
        parts[name] = assign(sector(name, R, R + WALL_T, 0.0, H + 0.05, a0, a1, bevel=0.0), wall_m)

    # Roof: one slab, the ceiling inside and a cantilever out over the
    # terrace, with a raised coffer over the console.
    outline = arc(roof_edge, 0, math.tau, 361)[:-1]
    hole = arc(COFFER_R, math.tau, 0, 129)[:-1]
    roof = slab('roof_slab', [outline, hole], H, H + 0.55, bevel=0.05)
    coffer_wall = sector('coffer_wall', COFFER_R, COFFER_R + 0.3, H + 0.5, H + 1.2, 0, math.tau, bevel=0.0, res=128)
    coffer_cap = sector('coffer_cap', 0, COFFER_R + 0.3, H + 1.2, H + 1.35, 0, math.tau, bevel=0.0, res=128)
    parts['roof'] = assign(join('roof', [roof, coffer_wall, coffer_cap]), ceil_m)

    # The glass wall's frame: slim black mullions, a channel top and bottom,
    # two black trims across the ceiling; the rail on the terrace.
    step = (GLASS_A1 - GLASS_A0) / BAYS
    frames = []
    for i in range(BAYS + 1):
        a = GLASS_A0 + step * i
        frames.append(box(f'mull{i}', (0.07, 0.03, H / 2), (R * math.cos(a), R * math.sin(a), H / 2), a, bevel=0.008))
    for i in range(BAYS):
        if i == DOOR:
            continue
        a0, a1 = GLASS_A0 + step * i, GLASS_A0 + step * (i + 1)
        frames.append(sector(f'sill{i}', R - 0.06, R + 0.06, 0.0, 0.05, a0, a1, bevel=0.005, res=24))
    frames.append(sector('head', R - 0.07, R + 0.07, H - 0.07, H, GLASS_A0, GLASS_A1, bevel=0.005))
    for r, a0, a1 in ((10.6, math.radians(200), math.radians(340)), (12.2, math.radians(30), math.radians(150))):
        frames.append(sector(f'trim{r}', r - 0.05, r + 0.05, H - 0.03, H, a0, a1, bevel=0.005))
    parts_frames = assign(join('frames', frames), frame_m)

    rail = []
    n_posts = int((DECK_A1 - DECK_A0) * RAIL_R / 2.6)
    for i in range(n_posts + 1):
        a = DECK_A0 + (DECK_A1 - DECK_A0) * i / n_posts
        rail.append(box(f'post{i}', (0.025, 0.025, 0.54), (RAIL_R * math.cos(a), RAIL_R * math.sin(a), 0.54), a, bevel=0.006))
    rail.append(sector('handrail', RAIL_R - 0.03, RAIL_R + 0.03, 1.04, 1.09, DECK_A0, DECK_A1, bevel=0.02))
    parts_rail = assign(join('rail', rail), rail_m)

    # Bronze pillars where the glass meets the concrete, leaning out a little.
    pillars = []
    for a in (GLASS_A0, GLASS_A1):
        def lean(x, y, z):
            return (x + (0.45 if z > 0 else 0.0), y * (1.0 if z > 0 else 0.72), z)
        pillars.append(box(f'pillar{a:.1f}', (0.55, 0.42, (H + 0.3) / 2), ((R + 0.25) * math.cos(a), (R + 0.25) * math.sin(a), (H + 0.3) / 2), a, bevel=0.03, shape=lean))
    parts['pillars'] = assign(join('pillars', pillars), pillar_m)

    # Terrace, pool and garden.
    deck_outline = arc(R, DECK_A0, DECK_A1, 160) + arc(DECK_R, DECK_A1, DECK_A0, 220)
    pool_hole = arc(POOL_R1, POOL_A1, POOL_A0, 80) + arc(POOL_R0, POOL_A0, POOL_A1, 70)
    parts['deck'] = assign(slab('deck', [deck_outline, pool_hole], -0.05, 0.0), deck_m)
    pool = [
        sector('pool_floor', POOL_R0, POOL_R1, -POOL_D - 0.1, -POOL_D, POOL_A0, POOL_A1, bevel=0.0),
        sector('pool_in', POOL_R0 - 0.12, POOL_R0, -POOL_D - 0.1, 0.0, POOL_A0, POOL_A1, bevel=0.0),
        sector('pool_out', POOL_R1, POOL_R1 + 0.12, -POOL_D - 0.1, -0.06, POOL_A0, POOL_A1, bevel=0.0),
    ]
    for a, d in ((POOL_A0, -1), (POOL_A1, 1)):
        e = 0.12 / POOL_R0
        pool.append(sector(f'pool_end{d}', POOL_R0 - 0.12, POOL_R1 + 0.12, -POOL_D - 0.1, 0.0, min(a, a + d * e), max(a, a + d * e), bevel=0.0, res=4))
    parts['pool'] = assign(join('pool', pool), tile_m)

    land_outline = arc(cliff_edge, 0, math.tau, 361)[:-1]
    land_hole = arc(DECK_R, DECK_A0, DECK_A1, 160) + arc(R + WALL_T, DECK_A1, DECK_A0 + math.tau, 200)
    land_hole.reverse()
    terrain = assign(slab('terrain', [land_outline, land_hole], -0.45, -0.2), ground_m)
    cliff = assign(cliff_band('cliff'), rock_m)
    greenery = plants(leaf_a, leaf_b, bark)

    # The house's lights.
    led = []
    # A cove of light round the top of the glass and the walls.
    led.append(sector('cove', R - 0.12, R - 0.08, H - 0.075, H - 0.045, 0, math.tau, bevel=0.0, res=256))
    # Under the roof's lip, and along the terrace's edge.
    lip = arc(lambda a: roof_edge(a) - 0.1, 0, math.tau, 361)[:-1]
    lip_in = arc(lambda a: roof_edge(a) - 0.16, math.tau, 0, 361)[:-1]
    led.append(slab('lip', [lip, lip_in], H - 0.02, H + 0.005))
    led.append(sector('deck_edge', RAIL_R - 0.24, RAIL_R - 0.2, 0.0, 0.02, DECK_A0, DECK_A1, bevel=0.0))
    # Recessed downlights, each a real spot in the bake.
    spots = []
    for ring, count in ((6.6, 10), (11.6, 18)):
        for i in range(count):
            a = math.tau * (i + 0.5) / count
            spots.append(((ring * math.cos(a), ring * math.sin(a), H - 0.01), None, 110, 70))
    for i in range(11):
        a = FORWARD + math.radians(-60 + 12 * i)
        rr = (R + roof_edge(a)) / 2 + 0.4
        if roof_edge(a) - R > 2.2:
            spots.append(((rr * math.cos(a), rr * math.sin(a), H - 0.01), None, 140, 80))
    # Uplights grazing the concrete.
    for i in range(14):
        a = GLASS_A1 + 0.18 + (math.pi - 0.36) * i / 13
        x, y = (R - 0.45) * math.cos(a), (R - 0.45) * math.sin(a)
        spots.append(((x, y, 0.03), Vector((R * math.cos(a), R * math.sin(a), 3.6)), 400, 50))
        led.append(box(f'up{i}', (0.09, 0.09, 0.012), (x, y, 0.012), a, bevel=0.006))
    for i, (loc, aim, energy, angle) in enumerate(spots):
        sl = bpy.data.lights.new(f'spot{i}', 'SPOT')
        sl.energy = energy
        sl.color = (1.0, 0.74, 0.5)
        sl.spot_size = math.radians(angle)
        sl.spot_blend = 0.55
        sl.shadow_soft_size = 0.04
        sl['channel'] = 'warm'
        so = link(bpy.data.objects.new(f'spot{i}', sl))
        so.location = loc
        if aim is not None:
            so.rotation_euler = (aim - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
        if loc[2] > 1:
            can = sector(f'can{i}', 0, 0.07, H - 0.012, H - 0.004, 0, math.tau, bevel=0.0, res=16)
            can.location.x, can.location.y = loc[0], loc[1]
            led.append(can)
    led_warm = assign(join('led_warm', led), warm)
    halo = assign(sector('emit_halo', COFFER_R - 0.08, COFFER_R - 0.04, H + 0.04, H + 0.08, 0, math.tau, bevel=0.0, res=160), cool)
    edge = assign(sector('emit_stage', STAGE_R + 0.005, STAGE_R + 0.02, 0.05, 0.08, 0, math.tau, bevel=0.003, res=192), cool)
    # The console's screens and the zones' holograms light the stage.
    glow = bpy.data.lights.new('stage_glow', 'AREA')
    glow.energy = 220
    glow.size = 6
    glow.color = (0.55, 0.62, 1.0)
    glow['channel'] = 'cool'
    go = link(bpy.data.objects.new('stage_glow', glow))
    go.location = (0, 0, H - 0.4)

    # Glass: the wall (its middle bay open) and the balustrade.
    panes = []
    for i in range(BAYS):
        if i == DOOR:
            continue
        a0, a1 = GLASS_A0 + step * i + 0.002, GLASS_A0 + step * (i + 1) - 0.002
        panes.append(sector(f'pane{i}', R - 0.01, R + 0.01, 0.05, H - 0.07, a0, a1, bevel=0.0, res=24))
    panes.append(sector('balustrade', RAIL_R - 0.01, RAIL_R + 0.01, 0.06, 1.04, DECK_A0, DECK_A1, bevel=0.0))
    glass = join('glass', panes)

    # Daylight: the sky all round (blue channel in the light bake).
    world = bpy.data.worlds.new('sky')
    sc.world = world
    if not world.node_tree.nodes.get('Background'):
        out = world.node_tree.nodes.new('ShaderNodeOutputWorld')
        world.node_tree.links.new(world.node_tree.nodes.new('ShaderNodeBackground').outputs[0], out.inputs['Surface'])
    unlit = {'frames': parts_frames, 'rail': parts_rail, 'terrain': terrain, 'cliff': cliff, 'plants': greenery}
    emitters = [led_warm, halo, edge]
    return parts, unlit, emitters, glass


# ---------------------------------------------------------------- light-bake mode

def light_bake_mode():
    """Grey every surface and give each kind of light its own channel."""
    for m in bpy.data.materials:
        nt = m.node_tree
        b = nt.nodes.get('Principled BSDF') if nt else None
        if b is None:
            continue
        if 'channel' in m:
            b.inputs['Emission Color'].default_value = (1, 0, 0, 1) if m['channel'] == 'warm' else (0, 1, 0, 1)
            continue
        bc = b.inputs['Base Color']
        if bc.is_linked:
            src = bc.links[0].from_socket
            bw = nt.nodes.new('ShaderNodeRGBToBW')
            nt.links.new(src, bw.inputs[0])
            nt.links.new(bw.outputs[0], bc)
        else:
            c = bc.default_value
            y = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
            bc.default_value = (y, y, y, 1)
        b.inputs['Metallic'].default_value = 0.0
    for lamp in bpy.data.lights:
        lamp.color = (1, 0, 0) if lamp.get('channel') == 'warm' else (0, 1, 0)
    world = bpy.context.scene.world
    bg = world.node_tree.nodes.get('Background')
    for l in list(bg.inputs['Color'].links):  # the preview's sunset sky
        world.node_tree.links.remove(l)
    bg.inputs['Color'].default_value = (0, 0, 1, 1)
    bg.inputs['Strength'].default_value = 1.0


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


def save(arr, name, size, srgb, quality=90, subsampling=-1):
    """Write ultra (full), high (half) and low (quarter) versions."""
    a = np.clip(arr, 0, 1)
    if srgb:
        a = np.where(a <= 0.0031308, a * 12.92, 1.055 * np.power(a, 1 / 2.4) - 0.055)
    im = Image.fromarray(np.clip(a * 255 + 0.5, 0, 255).astype(np.uint8))
    for level, div in (('ultra', 1), ('high', 2), ('low', 4)):
        s = max(128, size // div)
        (im if s == im.width else im.resize((s, s), Image.LANCZOS)).save(os.path.join(OUT, f'{name}_{level}.jpg'), quality=quality, optimize=True, subsampling=subsampling)


def bake_detail(ob, size, normal_map):
    sc = bpy.context.scene
    sc.cycles.samples = 1
    albedo = bake(ob, 'albedo', size, type='DIFFUSE', pass_filter={'COLOR'})
    sc.world.light_settings.distance = 0.35
    sc.cycles.samples = 24
    ao = bake(ob, 'ao', size, type='AO')[..., :1]
    # Detail: colour with its crevices darkened. (Albedo is linear here;
    # it's saved as sRGB.)
    save(albedo * (0.35 + 0.65 * ao), f'{ob.name}_detail', size, srgb=True)
    if normal_map:
        sc.cycles.samples = 1
        nrm = bake(ob, 'normal', size, type='NORMAL', normal_space='TANGENT')
        save(nrm, f'{ob.name}_normal', size, srgb=False, quality=94)
    print('detail', ob.name, flush=True)


def bake_light(ob, size):
    """Light falling on the surface, bounced: red warm, green JARVIS, blue sky."""
    sc = bpy.context.scene
    sc.cycles.samples = SAMPLES
    light = bake(ob, 'light', size, float_buffer=True, type='DIFFUSE', pass_filter={'DIRECT', 'INDIRECT'})
    sc.cycles.samples = 1
    nrm_ws = bake(ob, 'normal', size, type='NORMAL', normal_space='OBJECT')
    for c, label in enumerate(('warm', 'jarvis', 'sky')):
        ch = light[..., c]
        print(f'  {label}: p50 {np.percentile(ch, 50):.3f}  p99 {np.percentile(ch, 99):.3f}  max {ch.max():.3f}', flush=True)
    light = denoise(np.clip(light / LM_SCALE, 0, 1), np.full_like(light, 0.5), nrm_ws * 2 - 1)
    # 4:4:4 so the three channels don't bleed into each other.
    save(light, f'{ob.name}_light', size, srgb=True, quality=92, subsampling=0)
    print('light', ob.name, flush=True)


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
    """A Cycles render from the console's chair at sunset, looking out."""
    sc = bpy.context.scene
    world = sc.world
    nt = world.node_tree
    bg = nt.nodes.get('Background')
    try:
        sky = nt.nodes.new('ShaderNodeTexSky')
        sky.sun_elevation = math.radians(4)
        sky.sun_rotation = math.radians(100)
        nt.links.new(sky.outputs['Color'], bg.inputs['Color'])
        bg.inputs['Strength'].default_value = 0.25
    except Exception as e:
        print('  no sky texture:', e, flush=True)
        bg.inputs['Color'].default_value = (0.35, 0.3, 0.32, 1)
        bg.inputs['Strength'].default_value = 0.4
    sea = link(bpy.data.objects.new('sea', bpy.data.meshes.new('sea')))
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=900)
    bm.to_mesh(sea.data)
    bm.free()
    sea.location.z = SEA
    assign(sea, flat('sea_m', (0.01, 0.03, 0.05), 0.0, 0.05))
    cam = link(bpy.data.objects.new('cam', bpy.data.cameras.new('cam')))
    cam.data.lens = 22
    cam.location = (0, -4.6, 2.7)
    look = Vector((0, 30, 0.6))
    if '--aerial' in sys.argv:  # from out over the sea, above the roof
        cam.location = (-38, 62, 26)
        look = Vector((0, 4, -4))
    cam.rotation_euler = (look - cam.location).to_track_quat('-Z', 'Y').to_euler()
    sc.camera = cam
    sc.render.resolution_x = arg('--preview-width', 1600)
    sc.render.resolution_y = sc.render.resolution_x * 9 // 16
    sc.cycles.samples = arg('--preview-samples', 128)
    sc.cycles.use_denoising = True
    sc.view_settings.view_transform = 'AgX'
    sc.render.filepath = os.path.join(OUT, 'lair-preview.png')
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(sea)
    bpy.data.objects.remove(cam)
    bg.inputs['Strength'].default_value = 1.0
    print('preview written', flush=True)


def main():
    os.makedirs(OUT, exist_ok=True)
    parts, unlit, emitters, glass = build()
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.max_bounces = 6
    sc.cycles.diffuse_bounces = 4
    glass.hide_render = True  # drawn live; for the bakes the glass is open
    if (PREVIEW or PREVIEW_ONLY) and not LIGHT_ONLY:
        preview()
    if PREVIEW_ONLY:
        return
    plan = {
        'floor': (SIZE, LIGHT, True),
        'stage': (SIZE, LIGHT, True),
        'deck': (SIZE, LIGHT, True),
        'pool': (SIZE // 4, LIGHT // 4, False),
        'wall_left': (SIZE // 2, LIGHT // 2, True),
        'wall_front': (SIZE // 2, LIGHT // 2, True),
        'wall_right': (SIZE // 2, LIGHT // 2, True),
        'roof': (SIZE // 2, LIGHT // 2, False),
        'pillars': (SIZE // 4, LIGHT // 4, False),
    }
    detail_only = {'terrain': (SIZE // 2, True), 'cliff': (SIZE // 2, True), 'plants': (SIZE // 4, False)}
    for name in plan:
        unwrap(parts[name])
    for name in detail_only:
        unwrap(unlit[name])
    if not LIGHT_ONLY:
        for name, (ds, _, nm) in plan.items():
            bake_detail(parts[name], max(256, ds), nm)
        for name, (ds, nm) in detail_only.items():
            bake_detail(unlit[name], max(256, ds), nm)
    light_bake_mode()
    for name, (_, ls, _) in plan.items():
        bake_light(parts[name], max(128, ls))
    glass.hide_render = False
    export([*parts.values(), *unlit.values(), *emitters, glass])


main()
