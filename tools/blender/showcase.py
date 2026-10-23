"""
Cycles stills of JARVIS's house and its estate on the cliff — the opening's
loading screen shows them while the live station loads, like a game's.

The scene is the station's own: the house (lair.glb) and the estate
(estate.glb) with their baked detail maps, the land round the bay worked
out exactly as the browser does (src/station/coastland.ts, ported here),
the estate's palms, cypresses, trees, drive and lawn (estate.tsx's
planting), houses and the coast road along the cliff tops (coast.tsx), and
a simulated ocean. Lighting, rendering and the scattering of chaparral over
the hills use the Blender Agent Skills (github.com/EL4CTEO/blender-skills):
blender-time-of-day's scene_mood (a measured sky and sun for the hour),
blender-geometry-nodes' gn_builder (the scatter recipe), and
blender-rendering's render_batch.

  .bpy/bin/python tools/blender/showcase.py --skills ~/blender-skills
  .bpy/bin/python tools/blender/showcase.py --skills ~/blender-skills --shots aerial --res 960 540 --samples 32

Shots: aerial (golden hour, from out over the bay — the estate on its
headland), cliff (sunset, low on the water under the cantilevered wing),
night (the estate lit up). Writes public/station/loading/<shot>.jpg (or --out).
"""

import math
import os
import sys

import bpy
import bmesh  # after bpy
import numpy as np
from mathutils import Matrix, Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
STATION = os.path.join(ROOT, 'public', 'station')


def arg(name, default, n=1):
    if name in sys.argv:
        i = sys.argv.index(name)
        vals = sys.argv[i + 1:i + 1 + n]
        return [type(default[0])(v) for v in vals] if n > 1 else type(default)(vals[0])
    return default


SKILLS = os.path.expanduser(arg('--skills', os.environ.get('BLENDER_SKILLS', '~/blender-skills')))
OUT = os.path.abspath(arg('--out', os.path.join(STATION, 'loading')))
SHOTS = arg('--shots', 'aerial,cliff,night').split(',')
RES = arg('--res', [1920, 1080], 2)
SAMPLES = arg('--samples', 256)
TEX = arg('--textures', 'ultra')
for d in ('blender-time-of-day', 'blender-rendering', 'blender-geometry-nodes'):
    sys.path.insert(0, os.path.join(SKILLS, 'skills', d, 'scripts'))
import gn_builder  # noqa: E402
import render_batch  # noqa: E402
import scene_mood  # noqa: E402

# ---------------------------------------------------------------- the plan (mirrors src/station/layout.ts)

SEA = -28.0
DECK_R = 24.0
ESTATE_WINGS = [(24.5, 8.5, 12.5), (-27.0, 2.0, 11.2), (3.0, 29.0, 14.2)]
HELIPAD = (54.0, 58.0, 9.5)
TURN = (8.5, 66.0, 8.0)
LAWN = dict(x=24.0, z=46.0, rx=60.0, rz=48.0, y=-0.25)
BAY = dict(cx=0.0, cz=-575.0, r=628.0, mouth=-820.0, slant=0.12)


def B(x, z, y=0.0):
    """Browser (x, y up, z) → Blender (x, -z, y)."""
    return Vector((x, -z, y))


# ---------------------------------------------------------------- the land (port of coastland.ts)

def smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def _hash(x, y):
    h = np.sin(x * 127.1 + y * 311.7) * 43758.5453
    return h - np.floor(h)


def noise(x, y):
    ix, iy = np.floor(x), np.floor(y)
    fx, fy = x - ix, y - iy
    ux, uy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)
    a, b, c, d = _hash(ix, iy), _hash(ix + 1, iy), _hash(ix, iy + 1), _hash(ix + 1, iy + 1)
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy


def fbm(x, y, octaves):
    v, a = 0.0, 0.5
    for _ in range(octaves):
        v = v + a * noise(x, y)
        x, y = 1.6 * x + 1.2 * y + 7.1, -1.2 * x + 1.6 * y + 3.3
        a *= 0.5
    return v / (1 - 2 * a)


def ridged(x, y, octaves):
    v, a = 0.0, 0.5
    for _ in range(octaves):
        n = 1 - np.abs(noise(x, y) * 2 - 1)
        v = v + a * n * n
        x, y = 1.6 * x + 1.2 * y + 7.1, -1.2 * x + 1.6 * y + 3.3
        a *= 0.5
    return v


def shore(x, z):
    dx, dz = x - BAY['cx'], z - BAY['cz']
    th = np.arctan2(dx, dz)
    wig = 9 * np.sin(5 * th + 1.3) + 5 * np.sin(13 * th + 0.4) + 2.5 * np.sin(29 * th + 2.1)
    bay = np.hypot(dx, dz) - BAY['r'] + wig
    mouth = z - BAY['mouth'] - BAY['slant'] * x + 18 * np.sin(x * 0.006 + 1)
    return np.minimum(bay, mouth)


def cliff_edge(x, z):
    a = np.arctan2(-z, x)
    da = np.abs(np.arctan2(np.sin(a - math.pi / 2), np.cos(a - math.pi / 2)))
    t = np.clip((da - 1.658) / 0.96, 0, 1)
    return DECK_R + 0.4 + 40 * t * t * (3 - 2 * t)


def lawn_norm(x, z):
    return np.hypot((x - LAWN['x']) / LAWN['rx'], (z - LAWN['z']) / LAWN['rz'])


def ground(x, z):
    """Height of the land (browser y) and how far inland (m) — as coastland.ts's ground()."""
    x, z = np.asarray(x, float), np.asarray(z, float)
    s = shore(x, z)
    rH = np.hypot(x, z)
    top = -0.25 + 9 * smooth(55, 160, rH) * fbm(x * 0.02 + 6, z * 0.02, 3) + 30 * smooth(90, 520, rH) * (0.55 + 0.75 * fbm(x * 0.004 + 3, z * 0.004, 3))
    beach = 1.5 + 9 * fbm(x * 0.01, z * 0.01 + 7, 2) * smooth(70, 300, rH)
    along = smooth(80, 220, rH)
    t = s - 14 * smooth(0.56, 0.78, fbm(x * 0.022 + 2, z * 0.022 + 9, 3)) * along
    sheer = 1 - smooth(0.38, 0.68, fbm(x * 0.005 + 8, z * 0.005, 3)) * along
    face = 7 + 32 * (1 - sheer) + 7 * fbm(x * 0.02 + 1, z * 0.02, 2)
    h_beach = SEA - 1.6 + 2.4 * np.minimum(1, s / beach)
    u = np.clip((t - beach) / face, 0, 1)
    cliff = np.where(u < 0.3, 0.14 * np.power(u / 0.3, 0.7), 0.14 + 0.86 * np.power(np.maximum(u - 0.3, 0) / 0.7, 0.5))
    prof = sheer * cliff + (1 - sheer) * u * u * (3 - 2 * u)
    h_face = SEA + 0.8 + (top - SEA - 0.8) * prof + 2.2 * (fbm(x * 0.11, z * 0.11, 3) - 0.5) * np.sin(math.pi * u)
    k = t - beach - face
    far = smooth(45, 240, rH)
    hills = 0.07 * k + 330 * smooth(250, 1500, k) * (0.45 + 0.8 * fbm(x * 0.0016, z * 0.0016 + 5, 4))
    ridges = 46 * ridged(x * 0.0045, z * 0.0045, 4) * smooth(30, 320, k)
    canyon = np.power(1 - np.abs(fbm(x * 0.0032 + 4, z * 0.0032 + 1, 3) * 2 - 1), 6)
    h_in = top + far * (hills + ridges - 34 * canyon * smooth(25, 260, k)) + 1.4 * (fbm(x * 0.05, z * 0.05, 3) - 0.5) * smooth(4, 20, k)
    lawn = 1 - smooth(0.85, 1.05, lawn_norm(x, z))
    h_in = h_in + (LAWN['y'] - h_in) * lawn
    h = np.where(t < beach, h_beach, np.where(t < beach + face, h_face, h_in))
    h = np.where(s < 0, SEA - 1.6 + np.maximum(s, -40) * 0.5, h)
    h = np.where(rH < cliff_edge(x, z) - 1.5, np.minimum(h, -0.6), h)
    return h, s


def stand_y(x, z):
    """Where something stands on the estate (the house's island top is at −0.2)."""
    return float(max(ground(x, z)[0], -0.2))


def rng(seed):
    s = [seed]

    def r():
        s[0] = (s[0] * 16807) % 2147483647
        return s[0] / 2147483647
    return r


# ---------------------------------------------------------------- helpers

def link(ob, coll=None):
    (coll or bpy.context.scene.collection).objects.link(ob)
    return ob


def mesh_object(name, verts, faces, smooth_shade=True):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], [tuple(f) for f in faces])
    me.update()
    ob = link(bpy.data.objects.new(name, me))
    if smooth_shade:
        me.shade_smooth()
    return ob


def node(nt, kind, loc=(0, 0), **props):
    n = nt.nodes.new(kind)
    n.location = loc
    for k, v in props.items():
        setattr(n, k, v)
    return n


def mix_rgb(nt, fac, a, b, loc=(0, 0)):
    m = node(nt, 'ShaderNodeMix', loc, data_type='RGBA')
    for sock, v in ((m.inputs[0], fac), (m.inputs[6], a), (m.inputs[7], b)):
        if isinstance(v, bpy.types.NodeSocket):
            nt.links.new(v, sock)
        elif isinstance(v, (int, float)):
            sock.default_value = v
        else:
            sock.default_value = (*v, 1)
    return m.outputs[2]


def map_range(nt, value, a, b, c=0.0, d=1.0, loc=(0, 0)):
    m = node(nt, 'ShaderNodeMapRange', loc)
    m.inputs['From Min'].default_value, m.inputs['From Max'].default_value = a, b
    m.inputs['To Min'].default_value, m.inputs['To Max'].default_value = c, d
    nt.links.new(value, m.inputs['Value'])
    return m.outputs['Result']


def pbsdf(m):
    return next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')


def simple(name, color, rough=0.5, metal=0.0, emission=None, strength=0.0, transmission=0.0, ior=1.45, alpha=1.0, thin=False):
    m = bpy.data.materials.new(name)
    b = pbsdf(m)
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    b.inputs['IOR'].default_value = ior
    b.inputs['Transmission Weight'].default_value = transmission
    b.inputs['Alpha'].default_value = alpha
    if thin:
        b.inputs['Thin Wall'].default_value = True
    if emission:
        b.inputs['Emission Color'].default_value = (*emission, 1)
        b.inputs['Emission Strength'].default_value = strength
    return m


def textured(name, path, rough=0.6, metal=0.0, normal=None, coat=0.0):
    m = bpy.data.materials.new(name)
    nt = m.node_tree
    b = pbsdf(m)
    tex = node(nt, 'ShaderNodeTexImage', (-500, 200))
    tex.image = bpy.data.images.load(path, check_existing=True)
    nt.links.new(tex.outputs['Color'], b.inputs['Base Color'])
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    b.inputs['Coat Weight'].default_value = coat
    if normal and os.path.exists(normal):
        nm = node(nt, 'ShaderNodeTexImage', (-700, -200))
        nm.image = bpy.data.images.load(normal, check_existing=True)
        nm.image.colorspace_settings.name = 'Non-Color'
        nmap = node(nt, 'ShaderNodeNormalMap', (-350, -200))
        nmap.inputs['Strength'].default_value = 0.6
        nt.links.new(nm.outputs['Color'], nmap.inputs['Color'])
        nt.links.new(nmap.outputs['Normal'], b.inputs['Normal'])
    return m


def assign(ob, mat):
    ob.data.materials.clear()
    ob.data.materials.append(mat)
    return ob


def import_glb(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    return {o.name: o for o in bpy.data.objects if o not in before and o.type == 'MESH'}


# ---------------------------------------------------------------- materials

def land_material():
    """The ground, as coastland.ts shades it: sandstone where it's steep (reddish,
    layered, streaked), chaparral in clumps over dry grass, the estate's mown
    lawn, sand at the water."""
    m = bpy.data.materials.new('land')
    nt = m.node_tree
    b = pbsdf(m)
    geo = node(nt, 'ShaderNodeNewGeometry', (-1800, 0))
    sep = node(nt, 'ShaderNodeSeparateXYZ', (-1600, -300))
    nt.links.new(geo.outputs['Normal'], sep.inputs['Vector'])
    pos = node(nt, 'ShaderNodeSeparateXYZ', (-1600, 300))
    nt.links.new(geo.outputs['Position'], pos.inputs['Vector'])
    # Rock: thin wavering strata, big weathered patches, cracks, and scrub
    # clinging on in patches, as on the reference's cliffs.
    wave = node(nt, 'ShaderNodeTexWave', (-1300, 600), wave_type='BANDS', bands_direction='Z')
    wave.inputs['Scale'].default_value = 0.55
    wave.inputs['Distortion'].default_value = 2.5
    wave.inputs['Detail'].default_value = 6.0
    wave.inputs['Detail Scale'].default_value = 1.5
    nt.links.new(geo.outputs['Position'], wave.inputs['Vector'])
    wea = node(nt, 'ShaderNodeTexNoise', (-1300, 350))
    wea.inputs['Scale'].default_value = 0.035
    wea.inputs['Detail'].default_value = 10.0
    wea.inputs['Roughness'].default_value = 0.62
    nt.links.new(geo.outputs['Position'], wea.inputs['Vector'])
    grain = node(nt, 'ShaderNodeTexNoise', (-1300, 800))
    grain.inputs['Scale'].default_value = 0.9
    grain.inputs['Detail'].default_value = 12.0
    grain.inputs['Roughness'].default_value = 0.6
    nt.links.new(geo.outputs['Position'], grain.inputs['Vector'])
    # Joints run down the face: cells stretched tall, wobbled by noise.
    stretch = node(nt, 'ShaderNodeVectorMath', (-1500, 1050), operation='MULTIPLY')
    stretch.inputs[1].default_value = (0.5, 0.5, 0.09)
    wob = node(nt, 'ShaderNodeVectorMath', (-1450, 1200), operation='ADD')
    nt.links.new(geo.outputs['Position'], wob.inputs[0])
    nt.links.new(grain.outputs['Color'], wob.inputs[1])
    nt.links.new(wob.outputs[0], stretch.inputs[0])
    crack = node(nt, 'ShaderNodeTexVoronoi', (-1300, 1050), feature='DISTANCE_TO_EDGE')
    crack.inputs['Scale'].default_value = 1.0
    nt.links.new(stretch.outputs[0], crack.inputs['Vector'])
    rock = mix_rgb(nt, map_range(nt, wea.outputs['Fac'], 0.3, 0.72, 0, 1, (-1050, 650)), (0.2, 0.11, 0.065), (0.42, 0.27, 0.17), (-850, 650))
    rock = mix_rgb(nt, map_range(nt, wave.outputs['Fac'], 0.3, 1.0, 0, 0.35, (-1050, 850)), rock, (0.5, 0.4, 0.31), (-650, 700))
    rock = mix_rgb(nt, map_range(nt, crack.outputs['Distance'], 0.0, 0.03, 0.45, 0, (-1050, 1050)), rock, (0.07, 0.045, 0.03), (-450, 750))
    rock = mix_rgb(nt, map_range(nt, grain.outputs['Fac'], 0.3, 0.7, 0, 0.25, (-1050, 450)), rock, (0.12, 0.08, 0.05), (-450, 550))
    # Chaparral: dark clumps on dry gold, thicker down the gullies and where it's flatter.
    clump = node(nt, 'ShaderNodeTexNoise', (-1300, 50))
    clump.inputs['Scale'].default_value = 0.09
    clump.inputs['Detail'].default_value = 6.0
    nt.links.new(geo.outputs['Position'], clump.inputs['Vector'])
    gully = node(nt, 'ShaderNodeAttribute', (-1300, -150), attribute_name='_gully')
    add = node(nt, 'ShaderNodeMath', (-1050, 50), operation='ADD')
    nt.links.new(clump.outputs['Fac'], add.inputs[0])
    gm = node(nt, 'ShaderNodeMath', (-1200, -150), operation='MULTIPLY')
    nt.links.new(gully.outputs['Fac'], gm.inputs[0])
    gm.inputs[1].default_value = 0.5
    nt.links.new(gm.outputs[0], add.inputs[1])
    cover = map_range(nt, add.outputs[0], 0.44, 0.56, 0, 1, (-850, 50))
    fine = node(nt, 'ShaderNodeTexNoise', (-1300, -350))
    fine.inputs['Scale'].default_value = 1.4
    nt.links.new(geo.outputs['Position'], fine.inputs['Vector'])
    brush = mix_rgb(nt, fine.outputs['Fac'], (0.02, 0.032, 0.014), (0.07, 0.085, 0.04), (-850, -200))
    dry = mix_rgb(nt, fine.outputs['Fac'], (0.3, 0.23, 0.13), (0.19, 0.15, 0.09), (-850, -400))
    veg = mix_rgb(nt, cover, dry, brush, (-650, -150))
    # The lawn: mown stripes.
    # The estate's lawn (coastland.ts's ellipse; browser z is Blender -y), on the flat.
    ex = node(nt, 'ShaderNodeMath', (-1500, -1000), operation='MULTIPLY_ADD')
    nt.links.new(pos.outputs['X'], ex.inputs[0])
    ex.inputs[1].default_value, ex.inputs[2].default_value = 1 / LAWN['rx'], -LAWN['x'] / LAWN['rx']
    ez = node(nt, 'ShaderNodeMath', (-1500, -1150), operation='MULTIPLY_ADD')
    nt.links.new(pos.outputs['Y'], ez.inputs[0])
    ez.inputs[1].default_value, ez.inputs[2].default_value = -1 / LAWN['rz'], -LAWN['z'] / LAWN['rz']
    comb = node(nt, 'ShaderNodeCombineXYZ', (-1350, -1050))
    nt.links.new(ex.outputs[0], comb.inputs['X'])
    nt.links.new(ez.outputs[0], comb.inputs['Y'])
    ln = node(nt, 'ShaderNodeVectorMath', (-1200, -1050), operation='LENGTH')
    nt.links.new(comb.outputs[0], ln.inputs[0])
    inside = map_range(nt, ln.outputs['Value'], 0.96, 0.82, 0, 1, (-1050, -1050))
    flat = map_range(nt, sep.outputs['Z'], 0.85, 0.95, 0, 1, (-1050, -1250))
    lm = node(nt, 'ShaderNodeMath', (-850, -1100), operation='MULTIPLY')
    nt.links.new(inside, lm.inputs[0])
    nt.links.new(flat, lm.inputs[1])
    lawn = lm
    stripes = node(nt, 'ShaderNodeTexWave', (-1050, -650), wave_type='BANDS', bands_direction='X', wave_profile='SAW')
    stripes.inputs['Scale'].default_value = 0.06
    nt.links.new(geo.outputs['Position'], stripes.inputs['Vector'])
    grass = mix_rgb(nt, map_range(nt, stripes.outputs['Fac'], 0.45, 0.55, 0, 1, (-850, -800)), (0.075, 0.16, 0.032), (0.095, 0.2, 0.042), (-650, -700))
    veg = mix_rgb(nt, lawn.outputs[0], veg, grass, (-450, -300))
    patches = node(nt, 'ShaderNodeTexNoise', (-1300, -1100))
    patches.inputs['Scale'].default_value = 0.06
    patches.inputs['Detail'].default_value = 6.0
    nt.links.new(geo.outputs['Position'], patches.inputs['Vector'])
    rock = mix_rgb(nt, map_range(nt, patches.outputs['Fac'], 0.5, 0.6, 0, 0.92, (-650, 900)), rock, brush, (-250, 850))
    # Rock where it's steep, sand at the water.
    slope = node(nt, 'ShaderNodeMath', (-1300, -900), operation='SUBTRACT')
    slope.inputs[0].default_value = 1.0
    nt.links.new(sep.outputs['Z'], slope.inputs[1])
    rocky = map_range(nt, slope.outputs[0], 0.36, 0.55, 0, 1, (-650, 200))
    col = mix_rgb(nt, rocky, veg, rock, (-250, 100))
    sand = map_range(nt, pos.outputs['Z'], SEA + 1.9, SEA + 0.9, 0, 1, (-450, 450))
    col = mix_rgb(nt, sand, col, (0.5, 0.42, 0.32), (-50, 200))
    nt.links.new(col, b.inputs['Base Color'])
    b.inputs['Roughness'].default_value = 0.92
    hgt = node(nt, 'ShaderNodeMath', (-450, -300), operation='MULTIPLY_ADD')
    nt.links.new(grain.outputs['Fac'], hgt.inputs[0])
    hgt.inputs[1].default_value = 0.6
    nt.links.new(map_range(nt, crack.outputs['Distance'], 0.0, 0.06, 0, 1, (-650, -350)), hgt.inputs[2])
    bump = node(nt, 'ShaderNodeBump', (-250, -300))
    bump.inputs['Strength'].default_value = 0.8
    bump.inputs['Distance'].default_value = 0.35
    nt.links.new(hgt.outputs[0], bump.inputs['Height'])
    nt.links.new(bump.outputs['Normal'], b.inputs['Normal'])
    return m


def water_material():
    m = bpy.data.materials.new('sea')
    nt = m.node_tree
    b = pbsdf(m)
    foam = node(nt, 'ShaderNodeAttribute', (-700, 200), attribute_name='foam')
    f = map_range(nt, foam.outputs['Fac'], 0.25, 0.9, 0, 0.9, (-500, 200))
    col = mix_rgb(nt, f, (0.004, 0.028, 0.04), (0.8, 0.84, 0.86), (-250, 200))
    nt.links.new(col, b.inputs['Base Color'])
    r = map_range(nt, foam.outputs['Fac'], 0.25, 0.9, 0.02, 0.6, (-250, 0))
    nt.links.new(r, b.inputs['Roughness'])
    b.inputs['IOR'].default_value = 1.333
    b.inputs['Subsurface Weight'].default_value = 0.0
    return m


def leaf_material(name, use_color=True, base=(0.05, 0.09, 0.03)):
    m = bpy.data.materials.new(name)
    nt = m.node_tree
    b = pbsdf(m)
    if use_color:
        a = node(nt, 'ShaderNodeVertexColor', (-500, 200))
        a.layer_name = 'Col'
        nt.links.new(a.outputs['Color'], b.inputs['Base Color'])
    else:
        info = node(nt, 'ShaderNodeObjectInfo', (-700, 200))
        col = mix_rgb(nt, info.outputs['Random'], base, tuple(v * 1.6 for v in base), (-400, 200))
        nt.links.new(col, b.inputs['Base Color'])
    b.inputs['Roughness'].default_value = 0.7
    b.inputs['Subsurface Weight'].default_value = 0.15
    return m


# ---------------------------------------------------------------- the land

def coast_terrain(na=1200, nr=300, R0=16.0, R1=2600.0):
    j = np.arange(nr)
    i = np.arange(na)
    r = R0 * np.power(R1 / R0, j / (nr - 1))
    a = i / na * math.tau
    rr, aa = np.meshgrid(r, a, indexing='ij')
    x, z = np.sin(aa) * rr, -np.cos(aa) * rr
    h, s = ground(x, z)
    # Valleys (lower than their neighbours): the brush grows thick there.
    around = (np.roll(h, 1, 1) + np.roll(h, -1, 1) + np.vstack([h[:1], h[:-1]]) + np.vstack([h[1:], h[-1:]])) / 4
    gully = np.clip((around - h) / (0.02 * rr), 0, 1)
    lawn = (1 - smooth(0.82, 0.96, lawn_norm(x, z))) * (h > -1.0)
    # Chaparral scatter density (per m²): on the gentler land, near enough to see.
    dzr = np.gradient(h, axis=0) / np.gradient(rr, axis=0)
    dza = np.gradient(h, axis=1) / (rr * (math.tau / na))
    steep = np.hypot(dzr, dza)
    scrub = 0.05 * (steep < 0.7) * (s > 14) * (lawn < 0.05) * (rr > cliff_edge(x, z) + 3) * (1 - smooth(500, 900, rr)) * (0.4 + 0.9 * fbm(x * 0.03 + 4, z * 0.03, 3))
    verts = np.stack([x, -z, h], -1).reshape(-1, 3)
    wet = (s < -2).reshape(nr, na)
    idx = np.arange(nr * na).reshape(nr, na)
    a0 = idx[:-1, :]
    b0 = np.roll(idx, -1, 1)[:-1, :]
    c0 = idx[1:, :]
    d0 = np.roll(idx, -1, 1)[1:, :]
    keep = ~(wet[:-1, :] & np.roll(wet, -1, 1)[:-1, :] & wet[1:, :] & np.roll(wet, -1, 1)[1:, :])
    quads = np.stack([a0, c0, d0, b0], -1)[keep]
    ob = mesh_object('coast', verts, quads)
    me = ob.data
    if me.polygons[len(me.polygons) // 2].normal.z < 0:
        me.flip_normals()
    for name, arr in (('_gully', gully), ('_lawn', lawn), ('_scrub', scrub)):
        at = me.attributes.new(name, 'FLOAT', 'POINT')
        at.data.foreach_set('value', arr.ravel().astype(np.float32))
    return ob


def blob_mesh(name, rock=False, subdiv=3):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=1.0)
    for v in bm.verts:
        p = v.co
        n1 = noise(p.x * 2.1 + 5, p.y * 2.1 + p.z * 1.7)
        n2 = noise(p.x * 5.3 + p.z * 3.1, p.y * 5.3 + 11)
        n3 = noise(p.z * 11 + p.x * 4, p.y * 11 - 3)
        k = 0.75 + 0.35 * n1 + 0.1 * n2 if rock else 0.7 + 0.26 * n1 + 0.16 * n2 + 0.1 * n3
        v.co = p * float(k)
        if v.co.z < -0.3:
            v.co.z = -0.3 - (v.co.z + 0.3) * 0.2
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    if not rock:
        me.shade_smooth()
    return me


def scatter_scrub(terrain):
    """Chaparral over the hills: the skills' Geometry Nodes scatter recipe, its density
    from the terrain's _scrub attribute."""
    shrub = link(bpy.data.objects.new('shrub', blob_mesh('shrub')))
    assign(shrub, leaf_material('scrub', use_color=False, base=(0.03, 0.045, 0.02)))
    shrub.hide_render = True
    shrub.hide_viewport = True
    spec = {
        'name': 'GN_Scatter',
        'inputs': [['Geometry', 'GEOMETRY'], ['Density', 'FLOAT', 10, {'min': 0}], ['Seed', 'INT', 0],
                   ['Instance', 'OBJECT'], ['Scale Min', 'FLOAT', 0.8], ['Scale Max', 'FLOAT', 1.2]],
        'outputs': [['Geometry', 'GEOMETRY']],
        'nodes': {
            'dist': ['GeometryNodeDistributePointsOnFaces', {'distribute_method': 'RANDOM'}],
            'obj': ['GeometryNodeObjectInfo', {'transform_space': 'RELATIVE'}],
            'rnd': ['FunctionNodeRandomValue', {'data_type': 'FLOAT'}],
            'inst': ['GeometryNodeInstanceOnPoints'],
            'join': ['GeometryNodeJoinGeometry']},
        'links': [['in.Geometry', 'dist.Mesh'], ['in.Density', 'dist.Density'], ['in.Seed', 'dist.Seed'],
                  ['in.Instance', 'obj.Object'], ['dist.Points', 'inst.Points'], ['obj.Geometry', 'inst.Instance'],
                  ['dist.Rotation', 'inst.Rotation'],
                  ['in.Scale Min', 'rnd.Min'], ['in.Scale Max', 'rnd.Max'], ['in.Seed', 'rnd.Seed'], ['rnd.Value', 'inst.Scale'],
                  ['inst.Instances', 'join.Geometry'], ['in.Geometry', 'join.Geometry'], ['join.Geometry', 'out.Geometry']]}
    res = gn_builder.run(spec=spec, apply_to=terrain.name, set=['Density=@_scrub', 'Seed=7', 'Scale Min=0.7', 'Scale Max=2.0', 'Instance=shrub'])
    print('scatter', {k: res.get(k) for k in ('ok', 'evaluated', 'node_warnings', 'error') if k in res}, flush=True)


def surf(coll):
    """Breaking surf: a band of foam round the foot of the house's cliff and along the bay's beaches."""
    foam = bpy.data.materials.new('surf')
    nt = foam.node_tree
    b = pbsdf(foam)
    n = node(nt, 'ShaderNodeTexNoise', (-600, 0))
    n.inputs['Scale'].default_value = 0.35
    n.inputs['Detail'].default_value = 8
    geo = node(nt, 'ShaderNodeNewGeometry', (-800, 0))
    nt.links.new(geo.outputs['Position'], n.inputs['Vector'])
    alpha = map_range(nt, n.outputs['Fac'], 0.45, 0.62, 0, 0.95, (-350, 0))
    nt.links.new(alpha, b.inputs['Alpha'])
    b.inputs['Base Color'].default_value = (0.85, 0.88, 0.9, 1)
    b.inputs['Roughness'].default_value = 0.5
    rings = []
    # Round the house's cliff (outside.tsx's cliffFoot).
    pts = []
    for k in range(721):
        a = k / 720 * math.tau
        x, z = math.cos(a), -math.sin(a)
        r = float(cliff_edge(np.array(x * 30), np.array(z * 30))) + 5.2
        pts.append((x * r, z * r))
    rings.append(pts)
    # Along the bay: where its shore meets the water.
    line = []
    for th in np.linspace(-1.95, 1.95, 2400):
        d = Vector((math.sin(th), math.cos(th)))
        lo, hi = BAY['r'] - 80, BAY['r'] + 60
        for _ in range(26):
            mid = (lo + hi) / 2
            if float(shore(np.array(BAY['cx'] + d.x * mid), np.array(BAY['cz'] + d.y * mid))) < 1.2:
                lo = mid
            else:
                hi = mid
        line.append((BAY['cx'] + d.x * lo, BAY['cz'] + d.y * lo))
    rings.append(line)
    for k, pts in enumerate(rings):
        verts, faces = [], []
        for i, (x, z) in enumerate(pts):
            q = pts[min(i + 1, len(pts) - 1)]
            o = pts[max(i - 1, 0)]
            dx, dz = q[0] - o[0], q[1] - o[1]
            nrm = math.hypot(dx, dz) or 1
            sx, sz = dz / nrm, -dx / nrm
            for w in (-3.5, 2.5):
                verts.append(B(x + sx * w, z + sz * w, SEA + 0.12))
            if i:
                faces.append((i * 2 - 2, i * 2 - 1, i * 2 + 1, i * 2))
        assign(mesh_object(f'surf{k}', verts, faces), foam)


def ocean():
    bpy.ops.mesh.primitive_plane_add(size=2)
    ob = bpy.context.object
    ob.name = 'ocean'
    m = ob.modifiers.new('ocean', 'OCEAN')
    m.geometry_mode = 'GENERATE'
    m.spatial_size = 200
    m.repeat_x = m.repeat_y = 20
    m.resolution = 12
    m.viewport_resolution = 4
    m.wave_scale = 0.55
    m.choppiness = 0.9
    m.wind_velocity = 6.5
    m.use_foam = True
    m.foam_coverage = 0.35
    m.foam_layer_name = 'foam'
    m.wave_alignment = 0.4
    m.wave_direction = math.radians(200)
    m.time = 12.0
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    bb = [ev.matrix_world @ Vector(c) for c in ev.bound_box]
    cx = (min(p.x for p in bb) + max(p.x for p in bb)) / 2
    cy = (min(p.y for p in bb) + max(p.y for p in bb)) / 2
    ob.location = (-cx, -cy + 900, SEA)
    assign(ob, water_material())
    return ob


# ---------------------------------------------------------------- the house and the estate

def unfold_cliff(ob):
    """lair.tsx's unfold: weld the seams, smooth out the folds (Taubin), keep the lip."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bm.verts.ensure_lookup_table()
    lip = max(v.co.z for v in bm.verts) - 0.4
    for it in range(8):
        f = -0.53 if it % 2 else 0.5
        new = {}
        for v in bm.verts:
            if v.co.z > lip or not v.link_edges:
                continue
            avg = sum((e.other_vert(v).co for e in v.link_edges), Vector()) / len(v.link_edges)
            new[v] = v.co + (avg - v.co) * f
        for v, c in new.items():
            v.co = c
    bm.normal_update()
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.shade_smooth()


def clear_plants(ob):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    mw = ob.matrix_world
    gone = []
    for f in bm.faces:
        c = mw @ f.calc_center_median()
        x, z = c.x, -c.y
        if any(math.hypot(x - wx, z - wz) < wr + 1 for wx, wz, wr in ESTATE_WINGS) or math.hypot(x - 1, z - 17) < 3.5:
            gone.append(f)
    bmesh.ops.delete(bm, geom=gone, context='FACES')
    bm.to_mesh(ob.data)
    bm.free()


def house(land):
    parts = import_glb(os.path.join(STATION, 'lair.glb'))
    tex = lambda n, kind='detail': os.path.join(STATION, f'{n}_{kind}_{TEX}.jpg')  # noqa: E731
    looks = {
        'floor': dict(rough=0.14, coat=0.2), 'stage': dict(rough=0.1, coat=0.3), 'deck': dict(rough=0.45),
        'pool': dict(rough=0.25), 'wall_left': dict(rough=0.86), 'wall_front': dict(rough=0.86), 'wall_right': dict(rough=0.86),
        'roof': dict(rough=0.9), 'pillars': dict(rough=0.32, metal=0.7), 'plants': dict(rough=0.8),
    }
    for n, ob in parts.items():
        base = n.split('.')[0]
        if base in looks:
            assign(ob, textured(base, tex(base), normal=tex(base, 'normal'), **looks[base]))
        elif base in ('terrain', 'cliff'):
            assign(ob, land)
            if base == 'cliff':
                unfold_cliff(ob)
        elif base == 'glass':
            assign(ob, simple('glass', (0.9, 0.95, 0.97), rough=0.0, transmission=1.0, ior=1.5, thin=True))
        elif base in ('frames',):
            assign(ob, simple('frames', (0.02, 0.02, 0.022), rough=0.3, metal=0.85))
        elif base == 'rail':
            assign(ob, simple('rail', (0.77, 0.78, 0.8), rough=0.18, metal=1.0))
        elif base.startswith('led'):
            assign(ob, simple('led', (0, 0, 0), emission=(1.0, 0.72, 0.45), strength=12))
        elif base.startswith('emit'):
            assign(ob, simple('jarvis', (0, 0, 0), emission=(0.45, 0.52, 1.0), strength=8))
        if base == 'plants':
            clear_plants(ob)
    # The pool's water.
    a0, a1 = math.pi / 2 - math.radians(40), math.pi / 2 + math.radians(40)
    verts, faces = [], []
    n = 96
    for k in range(n + 1):
        a = a0 + (a1 - a0) * k / n
        for r in (17.8, 21.2):
            verts.append((r * math.cos(a), r * math.sin(a), -0.06))
        if k:
            faces.append((k * 2 - 2, k * 2 - 1, k * 2 + 1, k * 2))
    assign(mesh_object('poolwater', verts, faces), simple('poolwater', (0.35, 0.75, 0.78), rough=0.02, transmission=1.0, ior=1.333))
    return parts


def estate(glow_strength):
    parts = import_glb(os.path.join(STATION, 'estate.glb'))
    for n, ob in parts.items():
        base = n.split('.')[0]
        if base in ('white', 'pad'):
            assign(ob, textured('estate_' + base, os.path.join(STATION, f'estate_{base}_detail_{TEX}.jpg'), rough=0.7 if base == 'white' else 0.85))
        elif base == 'paint':
            assign(ob, simple('paint', (0.85, 0.85, 0.83), rough=0.6))
        elif base == 'glass':
            assign(ob, simple('eglass', (0.02, 0.03, 0.04), rough=0.03, metal=0.0, ior=1.6))
        elif base == 'frames':
            assign(ob, simple('eframes', (0.02, 0.02, 0.022), rough=0.35, metal=0.8))
        elif base == 'glow':
            assign(ob, simple('eglow', (0.05, 0.045, 0.04), rough=0.8, emission=(1.0, 0.62, 0.32), strength=glow_strength))
        elif base == 'lights':
            assign(ob, simple('padlights', (0.2, 0.2, 0.2), emission=(0.6, 0.75, 1.0), strength=glow_strength * 3))
    return parts


# ---------------------------------------------------------------- the grounds (port of estate.tsx)

def palm_mesh():
    """estate.tsx's palm: a ringed, curving trunk; a crown of folded, serrated, drooping fronds."""
    H = 10.0
    verts, faces, cols = [], [], []
    along, around = 28, 10
    for i in range(along + 1):
        t = i / along
        cx = 1.1 * t ** 1.7
        r = 0.2 - 0.06 * t + 0.16 * (1 - t) ** 8
        ring = 0.72 + 0.28 * (0 if math.sin(t * H * 3.4 * math.pi) > 0.6 else 1)
        for k in range(around):
            a = k / around * math.tau
            verts.append(B(cx + math.cos(a) * r, math.sin(a) * r, t * H))
            cols.append((0.42 * ring, 0.36 * ring, 0.29 * ring))
    for i in range(along):
        for k in range(around):
            a = i * around + k
            b = i * around + (k + 1) % around
            faces.append((a, b, b + around, a + around))
    trunk_faces = len(faces)
    top = Vector((1.1, H, 0.0))  # browser coords
    r = rng(5)
    for f in range(17):
        az = f / 17 * math.tau + r() * 0.3
        inner = f % 3 == 0
        el = 0.75 + r() * 0.3 if inner else 0.15 + r() * 0.35
        L = (2.6 if inner else 3.4) * (0.85 + r() * 0.3)
        droop = 0.5 if inner else 1.6 + r() * 0.8
        d = Vector((math.cos(az) * math.cos(el), math.sin(el), math.sin(az) * math.cos(el)))
        side = Vector((-math.sin(az), 0, math.cos(az)))
        n = 16
        base = len(verts)
        for i in range(n + 1):
            s = i / n
            sp = top + d * (s * L)
            sp.y -= droop * s * s * L * 0.45
            w = 0.62 * math.sin(math.pi * s ** 0.75) * (1 if i % 2 else 0.45)
            for sd in (-1, 0, 1):
                p = sp + side * (sd * w)
                if sd:
                    p.y -= w * 0.45
                verts.append(B(p.x, p.z, p.y))
                g = 0.75 + 0.35 * s + (0 if sd else 0.1)
                cols.append((0.09 * g + 0.04 * s, 0.17 * g, 0.045 * g))
        for i in range(n):
            a = base + i * 3
            b = a + 3
            faces += [(a, b, b + 1, a + 1), (a + 1, b + 1, b + 2, a + 2)]
    ob = mesh_object('palm', verts, faces)
    me = ob.data
    ca = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
    ca.data.foreach_set('color', np.hstack([np.array(cols), np.ones((len(cols), 1))]).ravel().astype(np.float32))
    trunk = leaf_material('palmtrunk')
    pbsdf(trunk).inputs['Subsurface Weight'].default_value = 0.0
    pbsdf(trunk).inputs['Roughness'].default_value = 0.95
    me.materials.append(trunk)
    me.materials.append(leaf_material('frond'))
    mi = np.zeros(len(faces), np.int32)
    mi[trunk_faces:] = 1
    me.polygons.foreach_set('material_index', mi)
    return ob


def catmull(ctrl, step=2.0):
    """A smooth path through points, sampled every `step` metres."""
    pts = [Vector(p) for p in ctrl]
    dense = []
    for i in range(len(pts) - 1):
        p0, p1, p2, p3 = pts[max(i - 1, 0)], pts[i], pts[i + 1], pts[min(i + 2, len(pts) - 1)]
        for k in range(40):
            t = k / 40
            dense.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
    dense.append(pts[-1])
    out, acc = [dense[0]], 0.0
    for a, b in zip(dense, dense[1:]):
        acc += (b - a).length
        if acc >= step:
            out.append(b)
            acc = 0.0
    return out


def drive_path():
    t = TURN
    ctrl = [(t[0], t[1]), (t[0] + 5, t[1] + 14), (t[0] + 18, t[1] + 24), (t[0] + 36, t[1] + 30)]
    last = Vector(ctrl[-1])
    away = Vector((last.x, last.y + 575)).normalized()
    while float(lawn_norm(np.array(last.x), np.array(last.y))) < 1.2:
        last += away * 1.5
    ctrl.append((last.x, last.y))
    return catmull(ctrl)  # Vector((x, z))


def ribbon(name, path, width, lift, mat):
    verts, faces = [], []
    for i, p in enumerate(path):
        q = path[min(i + 1, len(path) - 1)]
        o = path[max(i - 1, 0)]
        side = Vector((q.y - o.y, -(q.x - o.x))).normalized() * (width / 2)
        y = max(stand_y(p.x + side.x, p.y + side.y), stand_y(p.x - side.x, p.y - side.y), stand_y(p.x, p.y)) + lift
        verts += [B(p.x + side.x, p.y + side.y, y), B(p.x - side.x, p.y - side.y, y)]
        if i:
            faces.append((i * 2 - 2, i * 2 - 1, i * 2 + 1, i * 2))
    return assign(mesh_object(name, verts, faces, smooth_shade=False), mat)


def planting(drive):
    r = rng(71)
    hx, hz, hr = HELIPAD
    tx, tz, tr = TURN

    def clear(x, z, pad):
        if math.hypot(x, z) < 22 + pad:
            return False
        if any(math.hypot(x - wx, z - wz) < wr + pad for wx, wz, wr in ESTATE_WINGS):
            return False
        if math.hypot(x - hx, z - hz) < hr + 2 + pad:
            return False
        d = math.hypot(x - tx, z - tz)
        if tr + pad > d > 1:
            return False
        for k in range(11):
            u = k / 10
            if math.hypot(x - (hx - 7.3 + (tx - hx + 7.3) * u), z - (hz - 6.8 + (tz - 5 - hz + 6.8) * u)) < 4 + pad:
                return False
        if any(math.hypot(x - p.x, z - p.y) < 4.2 + pad for p in drive):
            return False
        g = ground(x, z)
        return float(lawn_norm(np.array(x), np.array(z))) < 1.02 and (float(g[1]) > 3 or math.hypot(x, z) < float(cliff_edge(np.array(x), np.array(z))) - 3)

    palms = [(tx, tz, 1.15, r() * 6.28)]
    for i in range(4, len(drive) - 2, 6):
        p, q = drive[i], drive[i + 1]
        sx, sz = q.y - p.y, -(q.x - p.x)
        n = math.hypot(sx, sz)
        for sd in (-1, 1):
            x, z = p.x + sx / n * 6 * sd, p.y + sz / n * 6 * sd
            if clear(x, z, 0.5):
                palms.append((x, z, 0.9 + r() * 0.35, r() * 6.28))
    tries = 0
    while len(palms) < 34 and tries < 4000:
        tries += 1
        wx, wz, wr = ESTATE_WINGS[int(r() * len(ESTATE_WINGS))]
        a = r() * math.tau
        d = wr + 3 + r() * 14
        x, z = wx + math.cos(a) * d, wz + math.sin(a) * d
        if clear(x, z, 1.5) and all(math.hypot(p[0] - x, p[1] - z) > 5 for p in palms):
            palms.append((x, z, 0.85 + r() * 0.45, r() * 6.28))
    cypress = []
    for x0, z0, x1, z1, n in ((-12, 22, -16, 42, 6), (36, 20, 40, 34, 5), (-28, 13, -32, 28, 5)):
        for k in range(n):
            x = x0 + (x1 - x0) * k / (n - 1) + (r() - 0.5)
            z = z0 + (z1 - z0) * k / (n - 1) + (r() - 0.5)
            if clear(x, z, 0.5):
                cypress.append((x, z, 0.85 + r() * 0.35, r() * 6.28))
    broad = []
    tries = 0
    while len(broad) < 40 and tries < 6000:
        tries += 1
        a = r() * math.tau
        k = 0.78 + r() * 0.2
        x, z = LAWN['x'] + math.cos(a) * LAWN['rx'] * k, LAWN['z'] + math.sin(a) * LAWN['rz'] * k
        if (x > LAWN['x'] and r() < 0.6) or not clear(x, z, 2):
            continue
        if any(math.hypot(b[0] - x, b[1] - z) < 6 for b in broad) or any(math.hypot(p[0] - x, p[1] - z) < 4 for p in palms):
            continue
        broad.append((x, z, 0.8 + r() * 0.6, r() * 6.28))
    return palms, cypress, broad


def grounds():
    paving = simple('paving', (0.62, 0.59, 0.53), rough=0.82)
    drive = drive_path()
    ribbon('drive', drive, 6, 0.06, paving)
    tx, tz, tr = TURN
    bpy.ops.mesh.primitive_circle_add(vertices=64, radius=tr, fill_type='NGON', location=B(tx, tz, LAWN['y'] + 0.07))
    assign(bpy.context.object, paving)
    bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=3.2, depth=0.3, location=B(tx, tz, LAWN['y'] + 0.15))
    assign(bpy.context.object, simple('bed', (0.09, 0.16, 0.05), rough=0.9))
    palms, cypress, broad = planting(drive)
    palm = palm_mesh()
    palm.hide_render = palm.hide_viewport = True
    for k, (x, z, s, yaw) in enumerate(palms):
        o = link(bpy.data.objects.new(f'palm{k}', palm.data))
        o.location = B(x, z, stand_y(x, z) - 0.1)
        o.rotation_euler = (0, 0, -yaw)
        o.scale = (s, s, s)
    leaves = blob_mesh('leaves')
    leafmat = leaf_material('leaves', use_color=False, base=(0.035, 0.07, 0.025))
    leaves.materials.append(leafmat)
    bark = simple('bark', (0.23, 0.18, 0.14), rough=0.95)
    r = rng(17)
    for k, (x, z, s, yaw) in enumerate(cypress):
        o = link(bpy.data.objects.new(f'cypress{k}', leaves))
        o.location = B(x, z, stand_y(x, z) + 4.6 * s)
        o.scale = (1.05 * s, 1.05 * s, 5.2 * s)
        o.rotation_euler = (0, 0, yaw)
    for k, (x, z, s, yaw) in enumerate(broad):
        y = stand_y(x, z)
        h = 3.2 * s
        bpy.ops.mesh.primitive_cylinder_add(vertices=8, radius=0.22 * s, depth=h, location=B(x, z, y + h / 2))
        assign(bpy.context.object, bark)
        for j in range(4):
            a = yaw + j / 4 * math.tau
            d = 1.6 * s if j else 0
            w = (2.2 if j else 2.8) * s * (0.85 + r() * 0.3)
            o = link(bpy.data.objects.new(f'tree{k}_{j}', leaves))
            o.location = B(x + math.cos(a) * d, z + math.sin(a) * d, y + h + (0.6 if j else 1.5) * s)
            o.scale = (w, w, w * 0.8)
            o.rotation_euler = (0, 0, r() * 6.28)
    print('grounds', len(palms), 'palms', len(cypress), 'cypress', len(broad), 'trees', flush=True)


def homes_and_road():
    """coast.tsx's houses along the cliff tops and the coast road (simplified)."""
    r = rng(29)
    walls = [simple(f'hwall{k}', c, rough=0.8) for k, c in enumerate(((0.83, 0.81, 0.77), (0.72, 0.66, 0.56), (0.5, 0.5, 0.48), (0.28, 0.21, 0.16)))]
    roofs = [simple('hroof0', (0.86, 0.85, 0.83), rough=0.7), simple('hroof1', (0.06, 0.06, 0.065), rough=0.6)]
    hglass = simple('hglass', (0.02, 0.025, 0.03), rough=0.04, ior=1.6)
    homes = []
    tries = 0
    while len(homes) < 90 and tries < 9000:
        tries += 1
        d = 140 + r() ** 1.2 * 1050
        a = r() * math.tau
        x, z = math.sin(a) * d, -math.cos(a) * d
        h, s = (float(v) for v in ground(x, z))
        row = 48 < s < 170
        if not row and (s < 170 or s > 650 or r() < 0.55):
            continue
        if float(lawn_norm(np.array(x), np.array(z))) < 1.4 or float(fbm(np.array(x * 0.006 + 1), np.array(z * 0.006 + 4), 3)) < 0.46:
            continue
        e = 2
        hx = float(ground(x + e, z)[0] - ground(x - e, z)[0])
        hz = float(ground(x, z + e)[0] - ground(x, z - e)[0])
        if 1 - 1 / math.sqrt(1 + (hx * hx + hz * hz) / (4 * e * e)) > 0.2:
            continue
        if any(math.hypot(o[0] - x, o[1] - z) < 32 for o in homes):
            continue
        yaw = math.atan2(BAY['cx'] - x, BAY['cz'] - z)
        homes.append((x, z, h, yaw, 11 + r() * 9, 8 + r() * 5, 3.2 + r() * 0.8, r() < 0.6, int(r() * 4), 0 if r() < 0.7 else 1))
    for k, (x, z, y, yaw, w, d, hh, up, wc, rc) in enumerate(homes):
        f = Vector((math.sin(yaw), math.cos(yaw)))
        for st in range(2 if up else 1):
            ww, dd = (w * 0.62, d * 0.7) if st else (w, d)
            base = y + (hh + 0.35 if st else 0)
            back = -d * 0.18 if st else 0
            cx, cz = x + f.x * back, z + f.y * back
            for kind, size, zc, mat, fwd in (
                ('w', (ww, dd, hh + (0 if st else 2.5)), base + (hh - (0 if st else 2.5)) / 2, walls[wc], 0.0),
                ('r', (ww + 1.2, dd + 2.2, 0.35), base + hh + 0.17, roofs[rc], 0.5),
                ('g', (ww * 0.88, 0.12, hh * 0.8), base + hh * 0.46, hglass, dd / 2 + 0.03)):
                bpy.ops.mesh.primitive_cube_add(size=1, location=B(cx + f.x * fwd, cz + f.y * fwd, zc))
                o = bpy.context.object
                o.scale = (size[0], size[1], size[2])
                o.rotation_euler = (0, 0, -yaw)
                assign(o, mat)
    # The road: 32 m in from the cliff tops, round the back of the estate.
    pts = []
    for th in np.arange(-1.95, 1.95, 0.004):
        d = Vector((math.sin(th), math.cos(th)))
        lo, hi = BAY['r'] - 40, BAY['r'] + 160
        for _ in range(24):
            mid = (lo + hi) / 2
            if float(shore(np.array(BAY['cx'] + d.x * mid), np.array(BAY['cz'] + d.y * mid))) < 32:
                lo = mid
            else:
                hi = mid
        if float(shore(np.array(BAY['cx'] + d.x * lo), np.array(BAY['cz'] + d.y * lo))) > 40:
            continue
        while float(lawn_norm(np.array(BAY['cx'] + d.x * lo), np.array(BAY['cz'] + d.y * lo))) < 1.18 and lo < BAY['r'] + 400:
            lo += 1.5
        x, z = BAY['cx'] + d.x * lo, BAY['cz'] + d.y * lo
        if math.hypot(x, z) > 70:
            pts.append(Vector((x, z)))
    road = simple('asphalt', (0.06, 0.06, 0.065), rough=0.85)
    for k in range(0, len(pts) - 1, 200):  # in pieces, so gaps don't bridge
        ribbon(f'road{k}', pts[k:k + 201], 9, 0.25, road)
    print('homes', len(homes), 'road points', len(pts), flush=True)


# ---------------------------------------------------------------- shots

SHOT = {
    # from out over the bay, high, like an establishing shot of the estate on its headland
    'aerial': dict(time='golden', heading=-40, cam=(-128, 58, -96), look=(20, -4, 30), lens=30, glow=0.0),
    # low on the water under the cantilevered north wing, the cliff and the house above
    'cliff': dict(time='sunset', heading=-25, cam=(55, -22, -60), look=(18, -2, 6), lens=26, glow=2.0),
    # the estate lit up after dark
    'night': dict(time='night', heading=-40, cam=(-95, 38, -60), look=(14, -2, 20), lens=32, glow=8.0),
}


def haze(strength):
    """Aerial perspective: the mist pass mixed toward the horizon's colour."""
    sc = bpy.context.scene
    sc.view_layers[0].use_pass_mist = True
    sc.world.mist_settings.start = 120
    sc.world.mist_settings.depth = 2600
    sc.world.mist_settings.falloff = 'QUADRATIC'
    ng = bpy.data.node_groups.new('SC_Haze', 'CompositorNodeTree')
    ng.interface.new_socket('Image', in_out='OUTPUT', socket_type='NodeSocketColor')
    rl = ng.nodes.new('CompositorNodeRLayers')
    out = ng.nodes.new('NodeGroupOutput')
    mix = ng.nodes.new('ShaderNodeMix')
    mix.data_type = 'RGBA'
    k = ng.nodes.new('ShaderNodeMath')
    k.operation = 'MULTIPLY'
    k.inputs[1].default_value = strength
    ng.links.new(rl.outputs['Mist'], k.inputs[0])
    ng.links.new(k.outputs[0], mix.inputs[0])
    ng.links.new(rl.outputs['Image'], mix.inputs[6])
    mix.inputs[7].default_value = (0.62, 0.66, 0.74, 1)
    ng.links.new(mix.outputs[2], out.inputs[0])
    sc.compositing_node_group = ng
    sc.render.compositor_device = 'CPU'  # no GPU (or OpenGL) on a render box
    return mix


def main():
    os.makedirs(OUT, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    land = land_material()
    terrain = coast_terrain()
    assign(terrain, land)
    print('terrain', len(terrain.data.vertices), 'verts', flush=True)
    scatter_scrub(terrain)
    surf(None)
    ocean()
    house(land)
    grounds()
    homes_and_road()
    cam = link(bpy.data.objects.new('cam', bpy.data.cameras.new('cam')))
    cam.data.clip_start = 0.5
    cam.data.clip_end = 6000
    sc.camera = cam
    sc.render.resolution_x, sc.render.resolution_y = RES
    for name in SHOTS:
        s = SHOT[name]
        est = estate(s['glow'])
        cam.location = B(s['cam'][0], s['cam'][2], s['cam'][1])
        cam.rotation_euler = (B(s['look'][0], s['look'][2], s['look'][1]) - cam.location).to_track_quat('-Z', 'Y').to_euler()
        cam.data.lens = s['lens']
        mood = scene_mood.run(time=s['time'], heading=s['heading'])
        print('mood', {k: mood.get(k) for k in ('ok', 'key', 'exposure', 'warnings') if k in mood}, flush=True)
        mix = haze(0.55 if name != 'night' else 0.25)
        if name == 'night':
            mix.inputs[7].default_value = (0.02, 0.025, 0.04, 1)
        sc.cycles.max_bounces = 8
        sc.cycles.transparent_max_bounces = 12
        r = render_batch.run(engine='CYCLES', preset='final', samples=SAMPLES, res=list(RES), out=os.path.join(OUT, f'{name}_raw_'),
                             format='PNG', frames='1', view='AgX', look='AgX - Base Contrast', device='CPU')
        print('render', name, r, flush=True)
        for f in r.get('files', []):
            from PIL import Image
            Image.open(f).convert('RGB').save(os.path.join(OUT, f'{name}.jpg'), quality=86, optimize=True, progressive=True)
            os.remove(f)
        for o in est.values():
            bpy.data.objects.remove(o)


main()
