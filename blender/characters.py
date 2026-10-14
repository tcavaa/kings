"""Seated, rigged card players in the GTA San Andreas style: low-poly but
properly proportioned bodies, a painted face texture, sculpted hair.

Exports public/models/king3d/{male,female}.glb. Each has:
  meshes  body, head_mesh (face, nose, ears, eyelids), hair, hair_b
          (two hairstyles; the runtime shows one per seat)
          (blink: move the "lids" bone 2.6 cm forward, toward -Y)
  bones   hips spine chest neck head lids, shoulder/upper_arm/forearm/hand _L/_R,
          thigh/shin/foot _L/_R (L = the character's left = +X)
  clips   idle, think, play, win, lose
  materials shirt, pants, hair, skin, face, shoes (runtime recolours per seat)
The rest pose IS the seated pose: leaning in, forearms on the table edge,
both hands holding the fan up in front of the chest.
Character faces -Y (three.js +Z); origin is the floor under the seat. The
table edge sits 0.28 m in front of the origin at height 0.75.

  blender -b -P blender/characters.py
"""
import math
import os
import shutil
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Euler, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import (OUT, blend, blur, canvas, ellipse, export_glb, grid, mat, noise, obj_from_bmesh,  # noqa: E402
                 polygon, rect, reset, save_image)

FPS = 24
TABLE_Z = 0.75

# ── painted textures ────────────────────────────────────────────────────────


def curve(img, pts, width, soft=0.004):
    """Mask of a thick polyline in UV units."""
    x, y = grid(img)
    d = np.full(x.shape, 9.0, np.float32)
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        vx, vy = x1 - x0, y1 - y0
        t = np.clip(((x - x0) * vx + (y - y0) * vy) / (vx * vx + vy * vy + 1e-9), 0, 1)
        d = np.minimum(d, np.hypot(x - (x0 + t * vx), y - (y0 + t * vy)))
    return np.clip((width - d) / soft, 0, 1)


REF = os.path.join(os.path.dirname(os.path.abspath(__file__)), "ref")
# Faces taken from the reference shots: the near half of each 3/4 face is
# mirrored into a front view. Landmarks are crop pixels: the nose line, the
# near eye's centre, and (crop row, texture row) pairs for hairline, eyes,
# mouth and chin. near = -1 when the visible half is on the image's left.
REFERENCE_FACES = {
    "nika": dict(file="nika.png", center=117, eye=92, near=-1,
                 rows=[(0, 0.0), (55, 0.25), (104, 0.505), (152, 0.735), (182, 0.86), (215, 1.0)]),
    "gio": dict(file="gio.png", center=80, eye=105, near=1,
                rows=[(0, 0.0), (55, 0.25), (100, 0.505), (148, 0.735), (175, 0.86), (215, 1.0)]),
}


def load_rgba(path):
    img = bpy.data.images.load(path)
    w, h = img.size
    px = np.array(img.pixels[:], np.float32).reshape(h, w, 4)[::-1].copy()
    bpy.data.images.remove(img)
    return px


def reference_colors(key):
    """(skin, hair) sampled from the reference crop, as 0xRRGGBB."""
    spec = REFERENCE_FACES[key]
    ref = load_rgba(os.path.join(REF, spec["file"]))
    c, n = spec["center"], spec["near"]
    eye_row = spec["rows"][2][0]
    cheek = ref[eye_row + 18:eye_row + 34, min(c + n * 22, c + n * 40):max(c + n * 22, c + n * 40), :3]
    hair = ref[18:40, c - 15:c + 15, :3]
    to_hex = lambda a: int(a[0] * 255) << 16 | int(a[1] * 255) << 8 | int(a[2] * 255)  # noqa: E731
    return to_hex(np.median(cheek.reshape(-1, 3), 0)), to_hex(np.median(hair.reshape(-1, 3), 0))


def overlay_reference(img, key):
    spec = REFERENCE_FACES[key]
    ref = load_rgba(os.path.join(REF, spec["file"]))
    rh, rw = ref.shape[:2]
    x, y = grid(img)
    scale = 0.047 / abs(spec["eye"] - spec["center"])  # texture u per crop pixel
    dist = np.abs(x - 0.5)
    cx = np.clip(spec["center"] + spec["near"] * dist / scale, 0, rw - 1)
    crop_rows, tex_rows = zip(*spec["rows"])
    cy = np.clip(np.interp(y, tex_rows, crop_rows), 0, rh - 1)
    sample = ref[cy.astype(int), cx.astype(int)]
    mask = np.clip((0.125 - dist) / 0.025, 0, 1) * np.clip((y - 0.1) / 0.06, 0, 1) * np.clip((0.95 - y) / 0.04, 0, 1)
    m = mask[..., None]
    img[..., :3] = img[..., :3] * (1 - m) + sample[..., :3] * m


def face_texture(name, female, skin, hair, eyes=0x3A2618, reference=None):
    """512² face on a cylinder: u=0.5 is the front, v (down) runs crown->chin.
    Painted like a PS2 character skin: baked form shading, heavy features."""
    s = 512
    img = canvas(s, s, skin)
    x, y = grid(img)
    dark = 0x6E3E28
    deep = 0x4A2618
    light = 0xF0C4A0 if female else 0xE2AE86
    # Form shading: the face turns away at the sides, the jaw is in shadow.
    side = np.clip((np.abs(x - 0.5) - 0.07) / 0.12, 0, 1)
    blend(img, side * 0.45, dark)
    blend(img, np.clip((y - 0.72) / 0.25, 0, 1) * 0.3, dark)
    blend(img, ellipse(img, 0.5, 0.36, 0.09, 0.1, soft=0.08) * 0.25, light)  # forehead
    for sd in (-1, 1):
        blend(img, ellipse(img, 0.5 + sd * 0.07, 0.6, 0.035, 0.03, soft=0.04) * 0.35, light)  # cheekbones
        blend(img, ellipse(img, 0.5 + sd * 0.085, 0.69, 0.03, 0.06, soft=0.05) * 0.3, dark)  # cheek hollows
        # Eye sockets.
        blend(img, ellipse(img, 0.5 + sd * 0.047, 0.5, 0.04, 0.03, soft=0.03) * 0.55, dark)
    # Hair painted onto the scalp: the hairline, temples and the back.
    hairline = 0.25 + 0.03 * ((x - 0.5) / 0.12) ** 2
    scalp = np.clip((hairline - y) / 0.008, 0, 1)
    scalp = np.maximum(scalp, ((np.abs(x - 0.5) > 0.19) & (y < (0.75 if female else 0.55))).astype(np.float32))
    scalp = np.maximum(scalp, ((np.abs(x - 0.5) > 0.13) & (y < 0.47)).astype(np.float32) * 0.9)  # temples
    blend(img, scalp, hair)
    blend(img, noise(s, s, 64, 3, 2) * scalp * 0.4, 0x000000)
    # Eyes.
    for sd in (-1, 1):
        cx, cy = 0.5 + sd * 0.047, 0.505
        blend(img, ellipse(img, cx, cy, 0.022, 0.0085, soft=0.003), 0xE8DED0)
        blend(img, ellipse(img, cx - sd * 0.002, cy, 0.0085, 0.0085, soft=0.002), eyes)
        blend(img, ellipse(img, cx - sd * 0.002, cy, 0.0038, 0.0045, soft=0.0015), 0x0A0605)
        blend(img, ellipse(img, cx - sd * 0.006, cy - 0.003, 0.0018, 0.0018, soft=0.001), 0xFFFFFF, 0.8)
        # Heavy upper lid and lash line, the "intense" GTA stare.
        blend(img, curve(img, [(cx - 0.024, cy + 0.001), (cx - 0.01, cy - 0.0085), (cx + 0.012, cy - 0.008),
                               (cx + 0.024, cy - 0.001)], 0.0028 if not female else 0.0034), 0x1A0E08)
        blend(img, curve(img, [(cx - 0.022, cy - 0.006), (cx, cy - 0.016), (cx + 0.022, cy - 0.007)], 0.004, 0.006) * 0.6, deep)
        blend(img, curve(img, [(cx - 0.018, cy + 0.008), (cx + 0.018, cy + 0.007)], 0.002, 0.005) * 0.4, deep)
        # Brows: thick and low for men (angled down to the nose), arched for women.
        inner, outer = cx - sd * 0.018, cx + sd * 0.028
        if female:
            blend(img, curve(img, [(inner, cy - 0.032), (cx + sd * 0.006, cy - 0.043), (outer, cy - 0.034)], 0.0045), 0x2A180E)
        else:
            blend(img, curve(img, [(inner, cy - 0.027), (cx + sd * 0.006, cy - 0.036), (outer, cy - 0.033)], 0.0085), hair)
            blend(img, curve(img, [(inner, cy - 0.027), (cx + sd * 0.006, cy - 0.036), (outer, cy - 0.033)], 0.0085) * 0.35, 0x000000)
    # Nose: lit bridge, shaded sides, dark nostrils.
    blend(img, rect(img, 0.493, 0.5, 0.507, 0.635, soft=0.012) * 0.35, light)
    for sd in (-1, 1):
        blend(img, curve(img, [(0.5 + sd * 0.016, 0.52), (0.5 + sd * 0.02, 0.62), (0.5 + sd * 0.028, 0.65)], 0.006, 0.012) * 0.45, dark)
        blend(img, ellipse(img, 0.5 + sd * 0.012, 0.662, 0.008, 0.0045, soft=0.003), 0x3A1C12, 0.85)
        # Nasolabial folds.
        blend(img, curve(img, [(0.5 + sd * 0.03, 0.655), (0.5 + sd * 0.042, 0.7), (0.5 + sd * 0.04, 0.74)], 0.003, 0.008) * 0.55, dark)
    blend(img, ellipse(img, 0.5, 0.645, 0.016, 0.012, soft=0.01) * 0.3, light)
    # Mouth.
    lip_top = 0x8A4A3A if not female else 0xA0403C
    lip_low = 0xA05C4A if not female else 0xB8524C
    blend(img, ellipse(img, 0.5, 0.728, 0.03, 0.007, soft=0.003), lip_top, 0.9)
    blend(img, ellipse(img, 0.5, 0.742, 0.026, 0.009, soft=0.004), lip_low, 0.9)
    blend(img, curve(img, [(0.47, 0.736), (0.485, 0.733), (0.5, 0.735), (0.515, 0.733), (0.53, 0.736)], 0.0022), 0x2A120C)
    blend(img, ellipse(img, 0.5, 0.71, 0.012, 0.006, soft=0.006) * 0.4, dark)  # philtrum
    # Chin and jaw.
    blend(img, ellipse(img, 0.5, 0.8, 0.03, 0.022, soft=0.02) * 0.3, light)
    if not female:
        blend(img, rect(img, 0.498, 0.79, 0.502, 0.815, soft=0.006) * 0.3, dark)  # cleft
        stubble = np.clip(ellipse(img, 0.5, 0.78, 0.14, 0.17, soft=0.06) - ellipse(img, 0.5, 0.62, 0.07, 0.08, soft=0.05), 0, 1)
        stubble *= (y > 0.68)
        blend(img, stubble * (0.35 + noise(s, s, 128, 7, 1) * 0.3), 0x2A221E)
        blend(img, ellipse(img, 0.5, 0.712, 0.036, 0.008, soft=0.012) * 0.35, 0x2A221E)  # upper lip shadow
    else:
        for sd in (-1, 1):
            blend(img, ellipse(img, 0.5 + sd * 0.075, 0.64, 0.03, 0.025, soft=0.03) * 0.25, 0xD07070)
            blend(img, curve(img, [(0.5 + sd * 0.025, 0.497), (0.5 + sd * 0.072, 0.49)], 0.002) * 0.5, 0x1A0E08)
    # Ears on the sides.
    for u in (0.27, 0.73):
        blend(img, ellipse(img, u, 0.55, 0.018, 0.05, soft=0.02) * 0.35, dark)
    if reference:
        overlay_reference(img, reference)
    # Pixelated: the runtime samples this with nearest filtering.
    return save_image(name, img)


def hair_texture(name):
    """Greyscale strands; the material colour tints them per seat."""
    s = 128
    img = canvas(s, s, 0xFFFFFF)
    x, y = grid(img)
    strands = (np.sin(x * 90 + noise(s, s, 8, 2, 2) * 10) * 0.5 + 0.5) ** 2
    blend(img, strands * 0.45, 0x000000)
    blend(img, noise(s, s, 32, 5, 1) * 0.3, 0x000000)
    return save_image(name, img)


def shirt_texture(name, buttons=True):
    """White base with fold shading and a button placket; tinted per seat."""
    s = 256
    img = canvas(s, s, 0xFFFFFF)
    x, y = grid(img)
    folds = (np.sin(x * 40 + noise(s, s, 6, 3, 2) * 6) * 0.5 + 0.5) ** 3
    blend(img, folds * 0.18, 0x404040)
    blend(img, noise(s, s, 16, 9, 2) * 0.15, 0x505050)
    return save_image(name, img)


# ── geometry helpers ────────────────────────────────────────────────────────


def segment(bm, p0, p1, r0, r1, segs=6, squash=1.0, cap=True):
    """Tapered prism from p0 to p1 (radii r0 -> r1). squash flattens depth."""
    return loft(bm, [p0, p1], [(r0, r0 * squash), (r1, r1 * squash)], segs, cap)


def loft(bm, points, radii, segs=8, cap=True, up=None):
    """Tube through `points` with elliptical sections radii[i] = (rx, ry);
    rx runs along the side axis, ry along the front/back axis."""
    pts = [Vector(p) for p in points]
    rings = []
    for i, p in enumerate(pts):
        a = pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]
        axis = a.normalized()
        ref = Vector(up) if up else (Vector((0, -1, 0)) if abs(axis.y) < 0.9 else Vector((0, 0, 1)))
        side = axis.cross(ref).normalized()
        front = side.cross(axis).normalized()
        rx, ry = radii[i]
        ring = []
        for k in range(segs):
            t = (k + 0.5) / segs * math.tau
            ring.append(bm.verts.new(p + side * math.cos(t) * rx + front * math.sin(t) * ry))
        rings.append(ring)
    for r0, r1 in zip(rings, rings[1:]):
        for k in range(segs):
            j = (k + 1) % segs
            bm.faces.new((r0[k], r0[j], r1[j], r1[k]))
    if cap:
        bm.faces.new(list(reversed(rings[0])))
        bm.faces.new(rings[-1])
    return [v for r in rings for v in r]


def blockbox(bm, center, size, rot=(0, 0, 0), taper=1.0):
    """Box with optional top taper (x scale of the top face)."""
    cx, cy, cz = center
    sx, sy, sz = (s / 2 for s in size)
    m = Euler(rot).to_matrix()
    verts = []
    for z in (-1, 1):
        k = taper if z > 0 else 1.0
        for x, y in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            verts.append(bm.verts.new(Vector((cx, cy, cz)) + m @ Vector((x * sx * k, y * sy, z * sz))))
    f = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    for idx in f:
        bm.faces.new([verts[i] for i in idx])
    return verts


class Part:
    """A mesh chunk rigidly bound to one bone and one material."""

    def __init__(self, bone, material):
        self.bone, self.material = bone, material
        self.bm = bmesh.new()


def build_object(name, parts, armature, smooth=False):
    obs = []
    for i, p in enumerate(parts):
        bmesh.ops.recalc_face_normals(p.bm, faces=p.bm.faces[:])
        ob = obj_from_bmesh(f"{name}_{i}", p.bm, p.material)
        vg = ob.vertex_groups.new(name=p.bone)
        vg.add(list(range(len(ob.data.vertices))), 1.0, "REPLACE")
        obs.append(ob)
    bpy.ops.object.select_all(action="DESELECT")
    for o in obs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = obs[0]
    bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    ob.data.name = name
    for poly in ob.data.polygons:
        poly.use_smooth = smooth
    ob.parent = armature
    mod = ob.modifiers.new("Armature", "ARMATURE")
    mod.object = armature
    return ob


def box_uv(ob, scale=4.0):
    me = ob.data
    if not me.uv_layers:
        me.uv_layers.new(name="UVMap")
    uv = me.uv_layers.active.data
    for poly in me.polygons:
        n = poly.normal
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            if abs(n.z) > 0.7:
                u, v = co.x, co.y
            elif abs(n.x) > abs(n.y):
                u, v = co.y, co.z
            else:
                u, v = co.x, co.z
            uv[li].uv = (u * scale, v * scale)


# ── the character ───────────────────────────────────────────────────────────


def build(gender):
    female = gender == "female"
    reset()
    k = 0.94 if female else 1.0
    sh = 0.175 if female else 0.205  # shoulder joint half width
    skin_col = 0xB57F5A if not female else 0xC99070
    hair_col = 0x1A1410 if not female else 0x3A2418
    if not female:
        skin_col, hair_col = reference_colors("nika")

    skin = mat("skin", skin_col, 0.7)
    face = mat("face", 0xFFFFFF, 0.65, image=face_texture(f"face_{gender}", female, skin_col, hair_col,
                                                          reference=None if female else "nika"))
    hair = mat("hair", 0x9A9A9A, 0.6, image=hair_texture(f"hair_{gender}"))
    shirt = mat("shirt", 0xFFFFFF, 0.85, image=shirt_texture(f"shirt_{gender}"))
    pants = mat("pants", 0x2A2C30, 0.85)
    shoes = mat("shoes", 0x1A1512, 0.4)
    belt = mat("belt", 0x24180F, 0.45)
    lid_mat = mat("eyelid", skin_col, 0.8)

    # ── skeleton (armature space == Blender world), leaning in to the table ──
    chest_top = Vector((0, -0.04, 1.04 * k))
    J = {
        "hips": ((0, 0.08, 0.53), (0, 0.07, 0.64)),
        "spine": ((0, 0.07, 0.64), (0, 0.02, 0.84 * k)),
        "chest": ((0, 0.02, 0.84 * k), tuple(chest_top)),
        "neck": (tuple(chest_top), (0, -0.06, 1.14 * k)),
        "head": ((0, -0.06, 1.14 * k), (0, -0.06, 1.38 * k)),
        "lids": ((0, -0.15, 1.27 * k), (0, -0.15, 1.25 * k)),
    }
    for side, sx in (("L", 1), ("R", -1)):
        sho = Vector((sx * sh, -0.03, 1.0 * k))
        elb = Vector((sx * (sh + 0.05), -0.27, TABLE_Z + 0.045))
        wri = Vector((sx * 0.085, -0.43, 0.94 * k))
        tip = Vector((sx * 0.055, -0.5, 0.99 * k))
        J[f"shoulder_{side}"] = ((sx * 0.04, -0.02, 1.0 * k), tuple(sho))
        J[f"upper_arm_{side}"] = (tuple(sho), tuple(elb))
        J[f"forearm_{side}"] = (tuple(elb), tuple(wri))
        J[f"hand_{side}"] = (tuple(wri), tuple(tip))
        J[f"thigh_{side}"] = ((sx * 0.1, 0.08, 0.52), (sx * 0.11, -0.36, 0.52))
        J[f"shin_{side}"] = ((sx * 0.11, -0.36, 0.52), (sx * 0.11, -0.38, 0.09))
        J[f"foot_{side}"] = ((sx * 0.11, -0.38, 0.05), (sx * 0.11, -0.53, 0.035))
    parents = {"spine": "hips", "chest": "spine", "neck": "chest", "head": "neck", "lids": "head"}
    for side in "LR":
        parents.update({f"shoulder_{side}": "chest", f"upper_arm_{side}": f"shoulder_{side}",
                        f"forearm_{side}": f"upper_arm_{side}", f"hand_{side}": f"forearm_{side}",
                        f"thigh_{side}": "hips", f"shin_{side}": f"thigh_{side}", f"foot_{side}": f"shin_{side}"})

    arm_data = bpy.data.armatures.new(f"{gender}_rig")
    rig = bpy.data.objects.new(f"{gender}_rig", arm_data)
    bpy.context.scene.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="EDIT")
    for name, (h, t) in J.items():
        b = arm_data.edit_bones.new(name)
        b.head, b.tail = h, t
        b.roll = 0
    for name, parent in parents.items():
        arm_data.edit_bones[name].parent = arm_data.edit_bones[parent]
    bpy.ops.object.mode_set(mode="OBJECT")

    body = []

    def part(bone, material):
        p = Part(bone, material)
        body.append(p)
        return p

    V = Vector
    # Pelvis, belt.
    p = part("hips", pants)
    loft(p.bm, [(0, 0.08, 0.47), (0, 0.075, 0.6)], [(0.17 if not female else 0.19, 0.12), (0.165 if not female else 0.16, 0.115)], 10)
    p = part("hips", belt)
    loft(p.bm, [(0, 0.07, 0.6), (0, 0.068, 0.64)], [(0.168, 0.118), (0.166, 0.116)], 10)
    # Torso as stacked sections: waist -> ribcage -> shoulders, leaning in.
    p = part("spine", shirt)
    loft(p.bm, [(0, 0.07, 0.63), (0, 0.055, 0.73), (0, 0.035, 0.85 * k)],
         [(0.16 if not female else 0.14, 0.11), (0.165 if not female else 0.135, 0.115), (0.18 if not female else 0.155, 0.125)], 10,
         up=(0, -1, 0))
    p = part("chest", shirt)
    loft(p.bm, [(0, 0.035, 0.84 * k), (0, 0.01, 0.94 * k), (0, -0.015, 1.0 * k), (0, -0.03, 1.045 * k)],
         [(0.185 if not female else 0.16, 0.128), (0.2 if not female else 0.17, 0.13),
          (0.215 if not female else 0.18, 0.115), (0.12, 0.085)], 10, up=(0, -1, 0))
    if female:
        for sx in (1, -1):
            loft(p.bm, [(sx * 0.07, -0.07, 0.92), (sx * 0.07, -0.13, 0.905)], [(0.058, 0.055), (0.04, 0.04)], 8)
    # Open camp collar: skin V, two flat lapels and the stand at the back.
    p = part("chest", skin)
    v0 = [p.bm.verts.new(c) for c in ((-0.045, -0.11, 1.045 * k), (0.045, -0.11, 1.045 * k), (0, -0.125, 0.93 * k))]
    p.bm.faces.new(v0)
    p = part("chest", shirt)
    for sx in (1, -1):
        lap = [p.bm.verts.new(c) for c in ((sx * 0.05, -0.115, 1.05 * k), (sx * 0.1, -0.1, 1.04 * k),
                                           (sx * 0.035, -0.13, 0.95 * k), (sx * 0.005, -0.13, 0.935 * k))]
        p.bm.faces.new(lap)
    loft(p.bm, [(0, -0.02, 1.03 * k), (0, -0.03, 1.08 * k)], [(0.075, 0.07), (0.072, 0.066)], 10, cap=False)
    # Neck.
    p = part("neck", skin)
    loft(p.bm, [(0, -0.03, 1.02 * k), (0, -0.05, 1.17 * k)], [(0.055 if not female else 0.045, 0.055), (0.05 if not female else 0.042, 0.05)], 8)
    # Arms: shoulder cap, short sleeve, bare forearm, hand around the cards.
    for side, sx in (("L", 1), ("R", -1)):
        sho, elb = V(J[f"upper_arm_{side}"][0]), V(J[f"upper_arm_{side}"][1])
        wri, tip = V(J[f"forearm_{side}"][1]), V(J[f"hand_{side}"][1])
        p = part(f"shoulder_{side}", shirt)
        loft(p.bm, [V((sx * 0.1, -0.02, 1.02 * k)), sho + V((sx * 0.02, 0, 0.0))], [(0.07, 0.08), (0.07, 0.072)], 8)
        p = part(f"upper_arm_{side}", shirt)
        mid = sho.lerp(elb, 0.5)
        loft(p.bm, [sho, mid], [(0.068, 0.07), (0.062, 0.064)], 8)
        p = part(f"upper_arm_{side}", skin)
        loft(p.bm, [mid, sho.lerp(elb, 0.8), elb], [(0.044, 0.046), (0.042, 0.044), (0.04, 0.04)], 8)
        p = part(f"forearm_{side}", skin)
        loft(p.bm, [elb, elb.lerp(wri, 0.35), wri], [(0.042, 0.04), (0.042, 0.038), (0.03, 0.022)], 8)
        # Hand: palm wrapped round the fan's lower edge, thumb over the front.
        p = part(f"hand_{side}", skin)
        d = (tip - wri).normalized()
        loft(p.bm, [wri, wri + d * 0.05, wri + d * 0.09], [(0.032, 0.016), (0.042, 0.018), (0.04, 0.016)], 6)
        for f in range(4):
            base = wri + d * 0.085 + V((-sx * (f - 1.5) * 0.017, 0, -0.012 + abs(f - 1.5) * 0.004))
            loft(p.bm, [base, base + d * 0.03 + V((0, 0.01, 0.0)), base + d * 0.045 + V((0, 0.03, -0.01))],
                 [(0.009, 0.008), (0.0085, 0.0075), (0.007, 0.006)], 5)
        tb = wri + d * 0.03 + V((-sx * 0.03, -0.012, 0.0))
        loft(p.bm, [tb, tb + V((-sx * 0.01, -0.02, 0.03)), tb + V((sx * 0.004, -0.025, 0.055))],
             [(0.012, 0.011), (0.01, 0.009), (0.008, 0.007)], 5)
    # Legs (mostly hidden by the table, but seen under it).
    for side, sx in (("L", 1), ("R", -1)):
        hip, knee = V(J[f"thigh_{side}"][0]), V(J[f"thigh_{side}"][1])
        ank = V(J[f"shin_{side}"][1])
        p = part(f"thigh_{side}", pants)
        loft(p.bm, [hip + V((0, 0.04, 0)), hip.lerp(knee, 0.5), knee], [(0.085, 0.08), (0.075, 0.07), (0.058, 0.055)], 8)
        p = part(f"shin_{side}", pants if not female else skin)
        loft(p.bm, [knee, knee.lerp(ank, 0.4), ank + V((0, 0, 0.03))],
             [(0.055, 0.055), (0.05, 0.05), (0.04, 0.04)] if not female else [(0.042, 0.042), (0.04, 0.04), (0.03, 0.03)], 8)
        p = part(f"foot_{side}", shoes)
        blockbox(p.bm, (sx * 0.11, -0.44, 0.04), (0.09, 0.22 if not female else 0.18, 0.075 if not female else 0.06))
    if female:
        p = part("hips", pants)
        loft(p.bm, [(0, 0.1, 0.56), (0, -0.4, 0.53)], [(0.21, 0.06), (0.22, 0.06)], 10)

    body_ob = build_object("body", body, rig)
    box_uv(body_ob, 3)

    # ── head: a sculpted grid, front at -Y ──
    head_parts = []
    p = Part("head", face)
    head_parts.append(p)
    hs = 0.93 if female else 1.0
    base = V((0, -0.035, 1.13 * k))  # chin level, centre of the skull's axis
    H = 0.25 * hs
    SEG, RINGS = 14, 12

    def section(t, a):
        """Radius of the head at height t (0 chin .. 1 crown), angle a (0 = front).
        A long, angular GTA head: narrow chin, hard jaw corner, flat face."""
        front = math.cos(a)
        ts = [0.0, 0.08, 0.26, 0.45, 0.66, 0.84, 0.95, 1.0]
        ws = [0.022, 0.04, 0.066 if not female else 0.058, 0.076, 0.078, 0.07, 0.048, 0.02]
        w = float(np.interp(t, ts, ws))
        df = float(np.interp(t, [0.0, 0.1, 0.3, 0.75, 0.9, 1.0], [0.072, 0.09, 0.1, 0.1, 0.075, 0.02]))
        db = float(np.interp(t, [0.0, 0.3, 0.6, 0.85, 1.0], [0.03, 0.07, 0.108, 0.1, 0.03]))
        d = df if front > 0 else db
        x = math.sin(a) * w
        y = -front * d
        if front > 0.5:  # a flat face plane
            y = -max(-y, d * 0.95)
        if 0.6 < t < 0.7 and front > 0.6:  # brow ridge
            y -= 0.007
        return x * hs, y * hs

    rings = []
    for r in range(RINGS + 1):
        t = r / RINGS
        ring = []
        for i in range(SEG):
            a = i / SEG * math.tau
            x, y = section(t, a)
            ring.append(p.bm.verts.new(base + V((x, y, t * H))))
        rings.append(ring)
    top = p.bm.verts.new(base + V((0, 0.005, H + 0.004)))
    bottom = p.bm.verts.new(base + V((0, -0.01, -0.004)))
    for r0, r1 in zip(rings, rings[1:]):
        for i in range(SEG):
            j = (i + 1) % SEG
            p.bm.faces.new((r0[i], r0[j], r1[j], r1[i]))
    for i in range(SEG):
        j = (i + 1) % SEG
        p.bm.faces.new((rings[-1][i], rings[-1][j], top))
        p.bm.faces.new((rings[0][j], rings[0][i], bottom))
    bmesh.ops.recalc_face_normals(p.bm, faces=p.bm.faces[:])
    uv = p.bm.loops.layers.uv.new("UVMap")
    for fc in p.bm.faces:
        us = []
        for loop in fc.loops:
            co = loop.vert.co - base
            us.append(0.5 + math.atan2(co.x, -co.y) / math.tau)
        if max(us) - min(us) > 0.5:
            us = [u + 1 if u < 0.5 else u for u in us]
        for loop, u in zip(fc.loops, us):
            co = loop.vert.co - base
            loop[uv].uv = (u, min(1, max(0, co.z / H)))
    # Nose: bridge, tip and nostril wings, so the profile reads.
    pn = Part("head", face)
    head_parts.append(pn)
    nz = lambda t: base.z + t * H  # noqa: E731
    fy = base.y - 0.1 * hs
    nv = [pn.bm.verts.new(c) for c in (
        (0, fy - 0.003, nz(0.52)),            # 0 bridge top, between the eyes
        (-0.008, fy + 0.003, nz(0.5)), (0.008, fy + 0.003, nz(0.5)),
        (0, fy - 0.021, nz(0.36)),            # 3 tip
        (-0.014, fy - 0.004, nz(0.33)), (0.014, fy - 0.004, nz(0.33)),  # wings
        (0, fy - 0.011, nz(0.32)),            # 6 columella
        (-0.012, fy + 0.004, nz(0.33)), (0.012, fy + 0.004, nz(0.33)),
    )]
    for f in ((0, 1, 3), (0, 3, 2), (1, 4, 3), (2, 3, 5), (3, 4, 6), (3, 6, 5), (4, 7, 6), (5, 6, 8)):
        pn.bm.faces.new([nv[i] for i in f])
    nuv = pn.bm.loops.layers.uv.new("UVMap")
    for fc in pn.bm.faces:
        for loop in fc.loops:
            co = loop.vert.co - base
            # Same cylindrical mapping as the face, so the painted nose lands on it.
            loop[nuv].uv = (0.5 + math.atan2(co.x, -co.y) / math.tau, co.z / H)
    pe = Part("head", skin)
    head_parts.append(pe)
    for sx in (1, -1):
        loft(pe.bm, [base + V((sx * 0.074 * hs, 0.012, 0.4 * H)), base + V((sx * 0.08 * hs, 0.018, 0.6 * H))],
             [(0.007, 0.018), (0.009, 0.022)], 6)
    # Eyelids, hidden inside the face over the painted eyes.
    pl = Part("lids", lid_mat)
    head_parts.append(pl)
    for sx in (1, -1):
        blockbox(pl.bm, base + V((sx * 0.033 * hs, -0.094 * hs + 0.022, 0.5 * H)), (0.05 * hs, 0.01, 0.024 * hs))
    build_object("head_mesh", head_parts, rig)

    # ── hair: two styles over the skull ──
    def hair_shell(name, hairline, volume, quiff, part_x=0.0, long=False):
        """Hair as a thick shell over the skull. In front it stops at the
        hairline; the top gets volume and a quiff swept back from the brow."""
        hp = Part("head", hair)
        rows = []
        T = [0.42, 0.55, 0.66, 0.76, 0.86, 0.94, 1.0] if not long else [-0.35, -0.05, 0.25, 0.5, 0.7, 0.86, 0.95, 1.0]
        for t in T:
            ring = []
            for i in range(SEG):
                a = i / SEG * math.tau
                front = math.cos(a)
                tt = max(t, hairline) if front > 0.35 else t
                if long and front > 0.35 and t < 0.5:
                    tt = hairline
                x, y = section(min(max(tt, 0.02), 0.99), a)
                grow = 1.0 + volume * (0.6 + 0.4 * min(1, tt))
                lift = 0.0
                if tt > 0.8:
                    lift = volume * 0.25 + quiff * max(0, front) * (1 - abs(math.sin(a)))
                if long and t < 0.45:  # long hair falls past the jaw at the back/sides
                    grow = 1.22
                    x, y = section(0.45, a)
                    if front > 0.35:
                        x *= 1.0
                ring.append(hp.bm.verts.new(base + V((x * grow + (part_x if tt > 0.9 else 0), y * grow, tt * H + lift
                                                      if not (long and t < 0.45) else t * H))))
            rows.append(ring)
        for r0, r1 in zip(rows, rows[1:]):
            for i in range(SEG):
                j = (i + 1) % SEG
                hp.bm.faces.new((r0[i], r0[j], r1[j], r1[i]))
        cap = hp.bm.verts.new(base + V((part_x, 0.004, H * 1.0 + volume * 0.3 + 0.004)))
        for i in range(SEG):
            hp.bm.faces.new((rows[-1][i], rows[-1][(i + 1) % SEG], cap))
        # Sideburns down to the ear.
        for sx in (1, -1):
            blockbox(hp.bm, base + V((sx * 0.074 * hs, -0.005, 0.56 * H)), (0.012, 0.03, 0.07))
        ob = build_object(name, [hp], rig)
        box_uv(ob, 12)
        return ob

    if female:
        hair_shell("hair", 0.74, 0.1, 0.006, long=True)
        hair_shell("hair_b", 0.75, 0.09, 0.0, part_x=0.01, long=True)
    else:
        hair_shell("hair", 0.76, 0.13, 0.03)               # thick, slicked back (Nika)
        hair_shell("hair_b", 0.77, 0.1, 0.018, part_x=-0.012)  # swept side parting (Gio)

    animate(rig, female)
    return rig


def local_rot(pb, euler):
    """Armature-space rotation about the bone head -> the bone's local quaternion."""
    rest = pb.bone.matrix_local.to_quaternion()
    world = Euler(euler).to_quaternion()
    return rest.inverted() @ world @ rest


def animate(rig, female):
    rig.animation_data_create()
    pbs = rig.pose.bones
    for pb in pbs:
        pb.rotation_mode = "QUATERNION"

    def clip(name, frames, keys, loop=True):
        """keys: {frame: {bone: (rx, ry, rz)}}; bones not listed sit at rest."""
        act = bpy.data.actions.new(name)
        rig.animation_data.action = act
        used = sorted({b for pose in keys.values() for b in pose})
        for f, pose in sorted(keys.items()):
            for b in used:
                pb = pbs[b]
                pb.rotation_quaternion = local_rot(pb, pose.get(b, (0, 0, 0)))
                pb.keyframe_insert("rotation_quaternion", frame=f)
        if loop:
            first = keys[min(keys)]
            for b in used:
                pbs[b].rotation_quaternion = local_rot(pbs[b], first.get(b, (0, 0, 0)))
                pbs[b].keyframe_insert("rotation_quaternion", frame=frames)
        track = rig.animation_data.nla_tracks.new()
        track.name = name
        strip = track.strips.new(name, 1, act)
        strip.name = name
        rig.animation_data.action = None
        for pb in pbs:
            pb.rotation_quaternion = (1, 0, 0, 0)

    s = 1 if not female else 0.8
    # idle: breathing, a slow glance, the fan settling in the hands.
    clip("idle", 96, {
        1: {"chest": (0, 0, 0), "head": (0, 0, 0), "forearm_L": (0, 0, 0), "forearm_R": (0, 0, 0)},
        24: {"chest": (-0.02, 0, 0), "head": (0.02, 0, 0.05 * s), "forearm_L": (0.03, 0, 0), "forearm_R": (0.03, 0, 0)},
        48: {"chest": (0.0, 0, 0), "head": (0.04, 0, 0.0), "forearm_L": (0, 0, 0.02), "forearm_R": (0, 0, 0.02)},
        72: {"chest": (-0.02, 0, 0), "head": (0.02, 0, -0.06 * s), "forearm_L": (0.02, 0, 0), "forearm_R": (0.02, 0, 0)},
    })
    # think: eyes on the cards, the right hand shuffling one.
    clip("think", 144, {
        1: {"chest": (0.04, 0, 0), "head": (0.2, 0.06, 0), "hand_R": (0, 0, 0), "forearm_R": (0, 0, 0)},
        36: {"chest": (0.05, 0, 0.02), "head": (0.26, 0.1, 0.04), "hand_R": (0.25, 0, 0), "forearm_R": (-0.08, 0, 0.06)},
        72: {"chest": (0.04, 0, 0), "head": (0.18, -0.05, -0.04), "hand_R": (0, 0, 0), "forearm_R": (0, 0, 0)},
        108: {"chest": (0.05, 0, -0.02), "head": (0.22, 0.05, 0.06), "hand_R": (0.18, 0, 0), "forearm_R": (-0.06, 0, 0.04)},
    })
    # play: the right arm reaches to the middle and lays a card down.
    clip("play", 28, {
        1: {"chest": (0, 0, 0), "upper_arm_R": (0, 0, 0), "forearm_R": (0, 0, 0), "hand_R": (0, 0, 0), "head": (0, 0, 0)},
        11: {"chest": (0.16, 0, -0.12), "upper_arm_R": (-0.55, 0, -0.35), "forearm_R": (0.85, 0, 0.3), "hand_R": (0.5, 0, 0),
             "head": (0.22, 0, -0.1)},
        16: {"chest": (0.18, 0, -0.12), "upper_arm_R": (-0.5, 0, -0.35), "forearm_R": (0.95, 0, 0.3), "hand_R": (0.6, 0, 0),
             "head": (0.24, 0, -0.1)},
        28: {"chest": (0, 0, 0), "upper_arm_R": (0, 0, 0), "forearm_R": (0, 0, 0), "hand_R": (0, 0, 0), "head": (0, 0, 0)},
    }, loop=False)
    # win: sit back, chin up, a satisfied nod.
    clip("win", 48, {
        1: {"chest": (0, 0, 0), "head": (0, 0, 0), "spine": (0, 0, 0)},
        12: {"chest": (-0.14, 0, 0), "spine": (-0.08, 0, 0), "head": (-0.2, 0, 0)},
        22: {"chest": (-0.13, 0, 0), "spine": (-0.08, 0, 0), "head": (0.05, 0, 0)},
        32: {"chest": (-0.12, 0, 0), "spine": (-0.06, 0, 0), "head": (-0.12, 0, 0)},
        48: {"chest": (0, 0, 0), "head": (0, 0, 0), "spine": (0, 0, 0)},
    }, loop=False)
    # lose: slump, shake the head.
    clip("lose", 48, {
        1: {"chest": (0, 0, 0), "head": (0, 0, 0), "spine": (0, 0, 0)},
        10: {"chest": (0.12, 0, 0), "spine": (0.05, 0, 0), "head": (0.28, 0, 0.2)},
        20: {"chest": (0.14, 0, 0), "spine": (0.05, 0, 0), "head": (0.3, 0, -0.2)},
        30: {"chest": (0.14, 0, 0), "spine": (0.05, 0, 0), "head": (0.28, 0, 0.18)},
        40: {"chest": (0.08, 0, 0), "spine": (0.03, 0, 0), "head": (0.18, 0, 0)},
        48: {"chest": (0, 0, 0), "head": (0, 0, 0), "spine": (0, 0, 0)},
    }, loop=False)


def export_extra_faces():
    """The second male opponent's face, swapped in at runtime for seat 2."""
    reset()
    skin, hair = reference_colors("gio")
    img = face_texture("face_male_b", False, skin, hair, reference="gio")
    shutil.copyfile(bpy.path.abspath(img.filepath), os.path.join(OUT, "face-male-b.png"))
    print("exported face-male-b.png")


if __name__ == "__main__":
    export_extra_faces()
    for gender in ("male", "female"):
        rig = build(gender)
        bpy.context.scene.render.fps = FPS
        export_glb(os.path.join(OUT, f"{gender}.glb"), [rig], animations=True,
                   extra=dict(export_skins=True, export_def_bones=False, export_morph=False,
                              export_anim_single_armature=True, export_reset_pose_bones=True))
