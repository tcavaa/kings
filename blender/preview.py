"""Quick look at the exported GLBs from the player's seat.

  blender -b -P blender/preview.py -- out.png [extra.glb@x,y,rotZ ...]
"""
import math
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import OUT, reset  # noqa: E402

args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
target = args[0] if args else "/tmp/preview.png"
reset()
scene = bpy.context.scene
bpy.ops.import_scene.gltf(filepath=os.path.join(OUT, "room.glb"))
for spec in args[1:]:
    path, _, place = spec.partition("@")
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.context.scene.objects if o not in before and o.parent is None]
    x, y, rz = (float(v) for v in (place or "0,0,0").split(","))
    for o in new:
        o.location = (x, y, 0)
        o.rotation_euler = (0, 0, rz)

# Backdrop: the Tbilisi panorama on a curved wall beyond the windows.
bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=11, depth=12, location=(0, 0, 4))
cylo = bpy.context.active_object
m = bpy.data.materials.new("pano")
m.use_nodes = True
nt = m.node_tree
for n in list(nt.nodes):
    nt.nodes.remove(n)
out = nt.nodes.new("ShaderNodeOutputMaterial")
em = nt.nodes.new("ShaderNodeEmission")
tex = nt.nodes.new("ShaderNodeTexImage")
tex.image = bpy.data.images.load(os.path.join(OUT, "tbilisi.jpg"))
coord = nt.nodes.new("ShaderNodeTexCoord")
mapping = nt.nodes.new("ShaderNodeMapping")
nt.links.new(coord.outputs["UV"], mapping.inputs["Vector"])
mapping.inputs["Scale"].default_value = (3.2, 1, 1)
mapping.inputs["Location"].default_value = (-0.75, 0, 0)
tex.extension = "CLIP"
nt.links.new(mapping.outputs["Vector"], tex.inputs["Vector"])
nt.links.new(tex.outputs["Color"], em.inputs["Color"])
nt.links.new(em.outputs["Emission"], out.inputs["Surface"])
cylo.data.materials.append(m)

world = bpy.data.worlds.new("w")
scene.world = world
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.05, 0.05, 0.08, 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.6


def light(kind, loc, energy, color, size=0.3):
    d = bpy.data.lights.new(kind + str(loc), kind)
    d.energy = energy
    d.color = color
    if hasattr(d, "shadow_soft_size"):
        d.shadow_soft_size = size
    o = bpy.data.objects.new(d.name, d)
    o.location = loc
    scene.collection.objects.link(o)
    return o


light("POINT", (-0.6, 4.1, 1.45), 120, (1, 0.75, 0.45))
light("POINT", (0, 0.1, 2.5), 260, (1, 0.85, 0.65), 0.8)
light("POINT", (-3.9, 3.7, 1.7), 80, (1, 0.75, 0.45))
light("AREA", (0, -2.5, 2.2), 300, (1, 0.9, 0.8), 2)
s = light("SUN", (0, 0, 5), 1.2, (0.7, 0.75, 1.0))
s.rotation_euler = (math.radians(50), 0, math.radians(200))

cam_data = bpy.data.cameras.new("cam")
cam_data.lens_unit = "FOV"
cam_data.angle = math.radians(float(os.environ.get("FOV", 72)))
cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam)
cam.location = tuple(float(v) for v in os.environ.get("CAM", "0,-1.75,1.33").split(","))
tgt = tuple(float(v) for v in os.environ.get("LOOK", "0,0.9,0.8").split(","))
d = [t - c for t, c in zip(tgt, cam.location)]
cam.rotation_euler = (math.atan2(math.hypot(d[0], d[1]), -d[2]), 0, math.atan2(d[1], d[0]) - math.pi / 2)
scene.camera = cam
scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = int(os.environ.get("W", 1280))
scene.render.resolution_y = int(os.environ.get("H", 720))
scene.view_settings.view_transform = "AgX"
scene.render.filepath = target
bpy.ops.render.render(write_still=True)
print("preview", target)
