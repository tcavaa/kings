"""Renders the dusk view of Tbilisi seen through the club windows.

Mtatsminda ridge with the TV tower and the park's ferris wheel, Narikala
floodlit on the left, the Mtkvari with a lit bridge, and Soviet blocks and
old balconied houses in front. Output: public/models/king3d/tbilisi.jpg,
mapped onto a curved backdrop outside the windows by room.js.

  blender -b -P blender/tbilisi.py
"""
import math
import os
import random
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import OUT, box, cyl, hex_rgb, join, prism, reset, sphere  # noqa: E402

random.seed(7)
reset()
scene = bpy.context.scene

_mats = {}


def m(name, color, emit=None, strength=0.0, rough=0.9):
    if name in _mats:
        return _mats[name]
    mt = bpy.data.materials.new(name)
    mt.use_nodes = True
    b = mt.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = hex_rgb(color)
    b.inputs["Roughness"].default_value = rough
    if emit is not None:
        b.inputs["Emission Color"].default_value = hex_rgb(emit)
        b.inputs["Emission Strength"].default_value = strength
    _mats[name] = mt
    return mt


def windows_mat(name, wall, lit=0xFFC56E, density=0.42, cols=10.0, rows=14.0, glow=6.0):
    """Facade with a grid of windows, a random share of them lit."""
    if name in _mats:
        return _mats[name]
    mt = bpy.data.materials.new(name)
    mt.use_nodes = True
    nt = mt.node_tree
    n, l = nt.nodes, nt.links
    b = n["Principled BSDF"]
    coord = n.new("ShaderNodeTexCoord")
    mapping = n.new("ShaderNodeMapping")
    mapping.inputs["Scale"].default_value = (cols, cols, rows)
    l.new(coord.outputs["Generated"], mapping.inputs["Vector"])
    sep = n.new("ShaderNodeSeparateXYZ")
    l.new(mapping.outputs["Vector"], sep.inputs["Vector"])
    # Window cell masks from fractional parts.
    frac_x = n.new("ShaderNodeMath"); frac_x.operation = "FRACT"
    frac_y = n.new("ShaderNodeMath"); frac_y.operation = "FRACT"
    l.new(sep.outputs["X"], frac_x.inputs[0])
    l.new(sep.outputs["Z"], frac_y.inputs[0])
    # Facades use Generated X across both axes of a box; use X+Y for width.
    add = n.new("ShaderNodeMath"); add.operation = "ADD"
    l.new(sep.outputs["X"], add.inputs[0]); l.new(sep.outputs["Y"], add.inputs[1])
    l.new(add.outputs[0], frac_x.inputs[0])
    mx = n.new("ShaderNodeMapRange"); mx.inputs["From Min"].default_value = 0.25; mx.inputs["From Max"].default_value = 0.27
    mx2 = n.new("ShaderNodeMapRange"); mx2.inputs["From Min"].default_value = 0.75; mx2.inputs["From Max"].default_value = 0.73
    l.new(frac_x.outputs[0], mx.inputs["Value"]); l.new(frac_x.outputs[0], mx2.inputs["Value"])
    my = n.new("ShaderNodeMapRange"); my.inputs["From Min"].default_value = 0.3; my.inputs["From Max"].default_value = 0.32
    my2 = n.new("ShaderNodeMapRange"); my2.inputs["From Min"].default_value = 0.8; my2.inputs["From Max"].default_value = 0.78
    l.new(frac_y.outputs[0], my.inputs["Value"]); l.new(frac_y.outputs[0], my2.inputs["Value"])
    m1 = n.new("ShaderNodeMath"); m1.operation = "MULTIPLY"
    m2 = n.new("ShaderNodeMath"); m2.operation = "MULTIPLY"
    m3 = n.new("ShaderNodeMath"); m3.operation = "MULTIPLY"
    l.new(mx.outputs[0], m1.inputs[0]); l.new(mx2.outputs[0], m1.inputs[1])
    l.new(my.outputs[0], m2.inputs[0]); l.new(my2.outputs[0], m2.inputs[1])
    l.new(m1.outputs[0], m3.inputs[0]); l.new(m2.outputs[0], m3.inputs[1])
    # Random per-cell on/off from white noise on the floored cell coordinate.
    floor = n.new("ShaderNodeVectorMath"); floor.operation = "FLOOR"
    l.new(mapping.outputs["Vector"], floor.inputs[0])
    obj = n.new("ShaderNodeObjectInfo")
    offs = n.new("ShaderNodeVectorMath"); offs.operation = "ADD"
    l.new(floor.outputs[0], offs.inputs[0]); l.new(obj.outputs["Random"], offs.inputs[1])
    wn = n.new("ShaderNodeTexWhiteNoise"); wn.noise_dimensions = "3D"
    l.new(offs.outputs[0], wn.inputs["Vector"])
    thr = n.new("ShaderNodeMath"); thr.operation = "LESS_THAN"; thr.inputs[1].default_value = density
    l.new(wn.outputs["Value"], thr.inputs[0])
    lit_mask = n.new("ShaderNodeMath"); lit_mask.operation = "MULTIPLY"
    l.new(m3.outputs[0], lit_mask.inputs[0]); l.new(thr.outputs[0], lit_mask.inputs[1])
    # Slight warm/cool variation between windows.
    tint = n.new("ShaderNodeMix"); tint.data_type = "RGBA"
    tint.inputs["A"].default_value = hex_rgb(lit)
    tint.inputs["B"].default_value = hex_rgb(0xFFE7B0)
    l.new(wn.outputs["Color"], tint.inputs["Factor"])
    base = n.new("ShaderNodeMix"); base.data_type = "RGBA"
    base.inputs["A"].default_value = hex_rgb(wall)
    base.inputs["B"].default_value = hex_rgb(0x1B2030)
    l.new(m3.outputs[0], base.inputs["Factor"])
    l.new(base.outputs["Result"], b.inputs["Base Color"])
    l.new(tint.outputs["Result"], b.inputs["Emission Color"])
    em = n.new("ShaderNodeMath"); em.operation = "MULTIPLY"; em.inputs[1].default_value = glow
    l.new(lit_mask.outputs[0], em.inputs[0])
    l.new(em.outputs[0], b.inputs["Emission Strength"])
    b.inputs["Roughness"].default_value = 0.95
    _mats[name] = mt
    return mt


# ── sky: dusk gradient, pink at the horizon to deep violet blue up top ──────
world = bpy.data.worlds.new("dusk")
scene.world = world
world.use_nodes = True
wn = world.node_tree.nodes
wl = world.node_tree.links
bg = wn["Background"]
tc = wn.new("ShaderNodeTexCoord")
sep = wn.new("ShaderNodeSeparateXYZ")
wl.new(tc.outputs["Generated"], sep.inputs["Vector"])
ramp = wn.new("ShaderNodeValToRGB")
cr = ramp.color_ramp
cr.elements[0].position = 0.0
cr.elements[0].color = hex_rgb(0xF0A07A)
cr.elements[1].position = 0.42
cr.elements[1].color = hex_rgb(0x1F2550)
e = cr.elements.new(0.05); e.color = hex_rgb(0xE08E80)
e = cr.elements.new(0.12); e.color = hex_rgb(0xA37390)
e = cr.elements.new(0.22); e.color = hex_rgb(0x5A4F86)
wl.new(sep.outputs["Z"], ramp.inputs["Fac"])
wl.new(ramp.outputs["Color"], bg.inputs["Color"])
bg.inputs["Strength"].default_value = 0.8

# A few soft clouds catching the last light.
for i in range(9):
    c = sphere(f"cloud{i}", 1, (random.uniform(-260, 260), 420 + random.uniform(-40, 60), random.uniform(70, 120)),
               m("cloud", 0xC98A8C, emit=0xE7A08E, strength=0.35), segs=12, rings=6,
               scale=(random.uniform(30, 60), 8, random.uniform(2.5, 5)))

# ── Mtatsminda ridge ────────────────────────────────────────────────────────
ridge_mat = m("ridge", 0x262433, rough=1)
far_ridge = m("far_ridge", 0x4A4462, rough=1)


def ridge(name, y, base_z, peaks, width, mat, depth=40):
    pts = [(-width, base_z - 30)]
    steps = 90
    for i in range(steps + 1):
        x = -width + 2 * width * i / steps
        h = base_z
        for px, ph, pw in peaks:
            h += ph * math.exp(-((x - px) / pw) ** 2)
        h += math.sin(x * 0.11) * 1.2 + math.sin(x * 0.037 + 1) * 2
        pts.append((x, h))
    pts.append((width, base_z - 30))
    ob = prism(name, pts, depth, (0, y, 0), mat, rot=(math.pi / 2, 0, 0))
    return ob, pts


# Distant Trialeti hills, then the Mtatsminda ridge carrying the tower.
ridge("trialeti", 520, 10, [(-200, 40, 120), (150, 55, 140), (330, 30, 90)], 520, far_ridge)
TOWER_X = 40
mt_ob, mt_pts = ridge("mtatsminda", 300, 0, [(TOWER_X, 105, 110), (-120, 70, 120), (220, 66, 130), (-300, 40, 90)], 480, ridge_mat)


def ridge_height(x):
    for (x1, z1), (x2, z2) in zip(mt_pts[1:-2], mt_pts[2:-1]):
        if x1 <= x <= x2:
            return z1 + (z2 - z1) * (x - x1) / (x2 - x1)
    return 0


# Houses on the slopes: scattered warm lights.
dot = m("slope_light", 0xFFC67A, emit=0xFFC67A, strength=12)
dots = []
for i in range(900):
    x = random.uniform(-380, 380)
    top = ridge_height(x)
    z = random.uniform(-6, top * random.uniform(0.25, 0.85))
    if z > top - 4:
        continue
    dots.append(box(f"d{i}", (random.uniform(0.6, 1.4), 0.3, random.uniform(0.5, 0.9)), (x, 258, z), dot))
join("slope_lights", dots)

# TV tower: three tapering legs with platforms, red and white bands, lit tip.
tz = ridge_height(TOWER_X) - 2
white = m("tower_white", 0xE6E1DC, emit=0xF4D7C0, strength=0.9)
red = m("tower_red", 0xB8382F, emit=0xD9463A, strength=1.2)
beacon = m("beacon", 0xFF5040, emit=0xFF4030, strength=40)
tower_h = 95
parts = []
for leg in range(3):
    a = leg * 2 * math.pi / 3
    bx, by = math.cos(a) * 9, math.sin(a) * 9
    for seg in range(6):
        z0 = seg * tower_h * 0.6 / 6
        k0 = 1 - seg / 6 * 0.9
        k1 = 1 - (seg + 1) / 6 * 0.9
        x0, y0 = bx * k0, by * k0
        x1, y1 = bx * k1, by * k1
        length = math.dist((x0, y0, z0), (x1, y1, z0 + tower_h * 0.1))
        c = cyl(f"leg{leg}{seg}", 0.9, 0.9, length, ((x0 + x1) / 2 + TOWER_X, 275 + (y0 + y1) / 2, tz + z0 + tower_h * 0.05),
                red if seg % 2 else white, segs=5)
        c.rotation_euler = (math.atan2(-(y1 - y0), tower_h * 0.1) * -1, math.atan2(x1 - x0, tower_h * 0.1), 0)
        parts.append(c)
for i, z in enumerate((0.2, 0.38, 0.56)):
    parts.append(cyl(f"ring{i}", 7.5 * (1 - z * 1.4), 7.5 * (1 - z * 1.4), 1.8, (TOWER_X, 275, tz + tower_h * z),
                     white, segs=10))
for i in range(8):
    z0 = tower_h * (0.6 + i * 0.05)
    parts.append(cyl(f"mast{i}", 1.4 - i * 0.12, 1.3 - i * 0.12, tower_h * 0.05, (TOWER_X, 275, tz + z0 + tower_h * 0.025),
                     red if i % 2 else white, segs=6))
join("tv_tower", parts)
for i, z in enumerate((0.2, 0.38, 0.56, 0.85, 1.0)):
    for k in range(4):
        a = k * math.pi / 2
        sphere(f"bl{i}{k}", 0.9, (TOWER_X + math.cos(a) * 3 * (1 - z), 271, tz + tower_h * z), beacon, segs=6, rings=4)

# Ferris wheel and the funicular restaurant on the ridge, to the right.
fx = TOWER_X + 70
fz = ridge_height(fx) + 1
wheel_mat = m("wheel", 0xFFFFFF, emit=0xFFD9A0, strength=8)
spokes = []
for i in range(16):
    a = i * math.pi / 8
    spokes.append(box(f"sp{i}", (0.25, 0.25, 14), (fx, 275, fz + 14), wheel_mat, rot=(0, a, 0)))
rim = cyl("rim", 14, 14, 0.6, (fx, 275, fz + 14), wheel_mat, segs=32, cap=False, rot=(math.pi / 2, 0, 0))
join("ferris", spokes + [rim])
box("funicular", (26, 4, 7), (TOWER_X - 45, 280, ridge_height(TOWER_X - 45) - 3),
    windows_mat("funic_w", 0x6F6A6A, density=0.9, cols=8, rows=3, glow=10))

# ── Narikala fortress, floodlit, on its own hill to the left ────────────────
nar = m("narikala", 0xC79A63, emit=0xE7A05A, strength=1.6)
hill = prism("nar_hill", [(-90, -40), (-60, 18), (-35, 32), (-10, 36), (12, 22), (40, -40)], 30, (-210, 240, 0),
             m("nar_hill", 0x2E2B38), rot=(math.pi / 2, 0, 0))
walls = []
for i, (x, z, w, h) in enumerate([(-255, 30, 22, 9), (-232, 37, 10, 15), (-222, 39, 30, 8), (-200, 33, 8, 13), (-188, 28, 20, 7)]):
    walls.append(box(f"nw{i}", (w, 4, h), (x, 215, z), nar))
    for k in range(int(w // 3)):
        walls.append(box(f"nc{i}{k}", (1.4, 4, 1.6), (x - w / 2 + 1.5 + k * 3, 215, z + h / 2 + 0.8), nar))
join("narikala", walls)
sphere("church", 3.5, (-215, 214, 44), nar, segs=8, rings=4, scale=(1, 1, 1.3))

# ── Mtkvari river and a lit bridge across the bottom left ───────────────────
river = m("river", 0x2A3557, emit=0x6A5A8A, strength=0.25, rough=0.15)
box("river", (420, 90, 0.5), (-120, 190, -14), river)
bridge = m("bridge", 0xD7B27C, emit=0xFFCF8A, strength=3)
br = [box("deck", (150, 5, 1.5), (-140, 170, -8), bridge)]
for i in range(6):
    br.append(box(f"pier{i}", (2, 5, 6), (-205 + i * 26, 170, -11), m("pier", 0x5B4A52)))
for i in range(30):
    sphere(f"lamp{i}", 0.5, (-212 + i * 5, 168, -6.5), dot, segs=6, rings=4)
join("bridge", br)
# Lamp reflections in the water.
for i in range(18):
    box(f"refl{i}", (0.6, 0.2, random.uniform(3, 8)), (-210 + i * 8.5, 160, -14.5), m("refl", 0xFFB060, emit=0xFFB060, strength=3))

# ── the city in front: Soviet blocks, old houses with balconies, trees ──────
facades = [
    windows_mat("block_a", 0x4E4A55, density=0.3),
    windows_mat("block_b", 0x46424F, density=0.24, lit=0xFFD08A),
    windows_mat("block_c", 0x5A524E, density=0.34, lit=0xFFB866),
    windows_mat("block_d", 0x3E4352, density=0.2, lit=0xF8E0B4),
]
roof = m("roof", 0x3C3A44)
tile_roof = m("tile_roof", 0x7A3F33)
for i in range(110):
    x = random.uniform(-330, 330)
    y = random.uniform(60, 230)
    if -200 < x < -40 and 150 < y < 215:  # keep the river clear
        continue
    near = 1 - (y - 60) / 170
    if random.random() < 0.55:
        w, d, h = random.uniform(10, 18), random.uniform(8, 12), random.uniform(28, 62)
    else:
        w, d, h = random.uniform(12, 30), random.uniform(10, 14), random.uniform(14, 26)
    h *= 0.45 + near * 0.45
    b = box(f"b{i}", (w, d, h), (x, y, h / 2 - 20), facades[i % 4])
    if h < 30 and random.random() < 0.6:
        prism(f"r{i}", [(-w / 2 - 1, 0), (0, 4), (w / 2 + 1, 0)], d + 2, (x, y + d / 2 + 1, h - 20), tile_roof,
              rot=(math.pi / 2, 0, 0))
    else:
        box(f"rt{i}", (w * 0.3, d * 0.3, 2), (x, y, h - 20 + 1), roof)
        if random.random() < 0.25:
            sphere(f"rl{i}", 0.5, (x, y - d / 2, h - 18), beacon, segs=6, rings=4)

# Cypress and plane-tree silhouettes in front of the blocks.
tree = m("tree", 0x1E2A2A, rough=1)
for i in range(80):
    x = random.uniform(-340, 340)
    y = random.uniform(40, 70)
    if random.random() < 0.4:
        sphere(f"cy{i}", 1, (x, y, -12), tree, segs=6, rings=5, scale=(2.2, 2.2, random.uniform(9, 14)))
    else:
        s = random.uniform(5, 9)
        sphere(f"tr{i}", 1, (x, y, -16 + s * 0.4), tree, segs=7, rings=5, scale=(s, s, s * 0.8))

box("ground", (1400, 700, 1), (0, 300, -20.5), m("ground", 0x1C1A24, rough=1))
# Scattered street lights between the blocks.
for i in range(160):
    sphere(f"st{i}", 0.4, (random.uniform(-340, 340), random.uniform(35, 240), -19.6), dot, segs=6, rings=4)

# ── camera and render ───────────────────────────────────────────────────────
cam_data = bpy.data.cameras.new("cam")
cam_data.lens_unit = "FOV"
cam_data.angle = math.radians(118)
cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam)
cam.location = (0, -30, 26)
cam.rotation_euler = (math.radians(89), 0, 0)
scene.camera = cam

moon = bpy.data.lights.new("sunset", "SUN")
moon.energy = 0.5
moon.color = (1.0, 0.62, 0.5)
lo = bpy.data.objects.new("sunset", moon)
lo.rotation_euler = (math.radians(80), 0, math.radians(200))
scene.collection.objects.link(lo)

engines = [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items]
scene.render.engine = "BLENDER_EEVEE" if "BLENDER_EEVEE" in engines else engines[0]
if hasattr(scene, "eevee"):
    scene.eevee.taa_render_samples = 32
    for attr in ("use_bloom",):
        if hasattr(scene.eevee, attr):
            setattr(scene.eevee, attr, True)
scene.view_settings.view_transform = "AgX" if "AgX" in [i.identifier for i in scene.view_settings.bl_rna.properties["view_transform"].enum_items] else "Filmic"
scene.view_settings.look = "None"
scene.render.resolution_x = int(os.environ.get("W", 4096))
scene.render.resolution_y = int(os.environ.get("H", 1536))
scene.render.image_settings.file_format = "JPEG"
scene.render.image_settings.quality = 86
target = os.environ.get("OUT_FILE", os.path.join(OUT, "tbilisi.jpg"))
scene.render.filepath = target
bpy.ops.render.render(write_still=True)
print("rendered", target)
