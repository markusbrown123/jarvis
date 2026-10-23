"""
Hero stills of JARVIS's drones (fpv.glb) for the loading screen, made with
the Blender Agent Skills (github.com/EL4CTEO/blender-skills): look-dev's
turntable rig (camera framed to the asset, a key/fill/rim studio rig, a
cyclorama) and rendering's render_batch (Cycles, adaptive sampling, denoised,
AgX). Run the asset QA skill on fpv.glb before rendering (qa_check.py).

  .bpy/bin/python tools/blender/drone_shots.py --skills ~/blender-skills
  .bpy/bin/python tools/blender/drone_shots.py --skills ~/blender-skills --which whoop --res 960 540 --samples 32

Writes public/station/loading/hero_quad.jpg and hero_whoop.jpg (or --out).
"""

import math
import os
import sys

import bpy
from mathutils import Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))


def arg(name, default, n=1):
    if name in sys.argv:
        i = sys.argv.index(name)
        vals = sys.argv[i + 1:i + 1 + n]
        return [type(default[0])(v) for v in vals] if n > 1 else type(default)(vals[0])
    return default


SKILLS = os.path.expanduser(arg('--skills', os.environ.get('BLENDER_SKILLS', '~/blender-skills')))
OUT = os.path.abspath(arg('--out', os.path.join(ROOT, 'public', 'station', 'loading')))
WHICH = arg('--which', 'quad,whoop').split(',')
RES = arg('--res', [1920, 1080], 2)
SAMPLES = arg('--samples', 256)
for d in ('blender-lighting-lookdev', 'blender-rendering'):
    sys.path.insert(0, os.path.join(SKILLS, 'skills', d, 'scripts'))
import render_batch  # noqa: E402
import turntable  # noqa: E402

# Per drone: lens, how much closer than the turntable's whole-turn framing,
# and the turntable frame that faces it three-quarters on (frame 1 is from behind).
SHOT = {'quad': dict(lens=70, closer=0.6, frame=43), 'whoop': dict(lens=85, closer=0.62, frame=43)}


def shot(which):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.join(ROOT, 'public', 'station', 'fpv.glb'))
    keep = [o for o in bpy.data.objects if o.name.startswith(which)]
    for o in list(bpy.data.objects):
        if o not in keep:
            bpy.data.objects.remove(o)
    sc = bpy.context.scene
    sc.render.resolution_x, sc.render.resolution_y = RES
    s = SHOT[which]
    print('turntable', turntable.run(objects=[o.name for o in keep], rig='studio', backdrop=True, frames=72, lens=s['lens'], elevation=20), flush=True)
    cam = sc.camera
    cam.location = cam.location * s['closer']
    sc.frame_set(s['frame'])
    bpy.context.view_layer.update()
    # The drone's own camera (on its gimbal) looks at the lens taking the picture.
    eye = cam.matrix_world.translation
    for g in [o for o in keep if o.name.startswith(f'{which}_cam')]:
        d = eye - g.matrix_world.translation
        g.rotation_mode = 'XYZ'
        g.rotation_euler = (max(-1.3, min(0.7, math.atan2(d.z, math.hypot(d.x, d.y)))), 0, max(-1.05, min(1.05, math.atan2(-d.x, d.y))))
    bpy.context.view_layer.update()
    centre = sum((o.matrix_world.translation for o in keep), Vector()) / len(keep)
    cam.data.dof.use_dof = True
    cam.data.dof.aperture_fstop = 8.0
    cam.data.dof.focus_distance = (cam.matrix_world.translation - centre).length
    sc.cycles.max_bounces = 12
    sc.cycles.transparent_max_bounces = 16
    os.makedirs(OUT, exist_ok=True)
    r = render_batch.run(engine='CYCLES', preset='final', samples=SAMPLES, res=list(RES), out=os.path.join(OUT, f'hero_{which}_raw_'),
                         format='PNG', frames=str(s['frame']), view='AgX', look='AgX - Punchy', device='CPU')
    print('render', which, r, flush=True)
    from PIL import Image
    for f in r.get('files', []):
        Image.open(f).convert('RGB').save(os.path.join(OUT, f'hero_{which}.jpg'), quality=88, optimize=True, progressive=True)
        os.remove(f)


for w in WHICH:
    shot(w)
