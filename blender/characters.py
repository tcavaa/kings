"""Seated, rigged low-poly card players in the GTA San Andreas style:
blocky limbs, a painted face texture, hair as texture plus a simple shell.

Exports public/models/king3d/{male,female}.glb. Each has:
  meshes  body, head_mesh (face, nose, ears, eyelids), hair
          (blink: move the "lids" bone 2.6 cm forward, toward -Y)
  bones   hips spine chest neck head lids, shoulder/upper_arm/forearm/hand _L/_R,
          thigh/shin/foot _L/_R (L = the character's left = +X)
  clips   idle, think, play, win, lose
  materials shirt, pants, hair, skin, face, shoes (runtime recolours per seat)
The rest pose IS the seated pose with both hands holding cards at the chest.
Character faces -Y (three.js +Z); origin is the floor under the seat.

  blender -b -P blender/characters.py
"""
import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Euler, Matrix, Quaternion, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import (OUT, blend, blur, canvas, ellipse, export_glb, flat, grid, mat, noise, obj_from_bmesh,  # noqa: E402
                 polygon, rect, reset, save_image)

FPS = 24

# ── face textures ───────────────────────────────────────────────────────────


def face_texture(name, female, skin, hair, eyes=0x4A3424):
    s = 256
    img = canvas(s, s, skin)
    x, y = grid(img)
    # Hair painted onto the scalp: everything high up, and the back of the head.
    hairline = 0.30 if not female else 0.27
    top = (y < hairline + 0.03 * np.cos((x - 0.5) * 6)).astype(np.float32)
    back = ((np.abs(x - 0.5) > 0.2) & (y < (0.62 if female else 0.5))).astype(np.float32)
    blend(img, np.clip(top + back, 0, 1), hair)
    blend(img, noise(s, s, 32, 3, 2) * np.clip(top + back, 0, 1) * 0.35, 0x000000)
    # Soft shading: cheek hollows and under-brow shadow.
    for side in (-1, 1):
        blend(img, ellipse(img, 0.5 + side * 0.105, 0.62, 0.04, 0.09, soft=0.06) * 0.22, 0x6A3A28)
        blend(img, ellipse(img, 0.5 + side * 0.065, 0.43, 0.05, 0.022, soft=0.03) * 0.3, 0x6A3A28)
    # Eyes.
    for side in (-1, 1):
        cx = 0.5 + side * 0.066
        blend(img, ellipse(img, cx, 0.465, 0.034, 0.017, soft=0.004), 0xEDE6DA)
        blend(img, ellipse(img, cx + side * -0.004, 0.466, 0.014, 0.015, soft=0.003), eyes)
        blend(img, ellipse(img, cx + side * -0.004, 0.466, 0.005, 0.006, soft=0.002), 0x0E0A08)
        blend(img, ellipse(img, cx + side * -0.008, 0.461, 0.0025, 0.0025, soft=0.001), 0xFFFFFF)
        # Upper lid line / lashes.
        blend(img, ellipse(img, cx, 0.455, 0.032, 0.007, soft=0.004) * (y < 0.458), 0x24160F, 0.9 if female else 0.7)
        # Brows: heavy and straight for men, thin and arched for women.
        if female:
            blend(img, ellipse(img, cx + side * 0.004, 0.405, 0.034, 0.006, soft=0.004, rot=side * -0.25), 0x2E1D14, 0.9)
        else:
            blend(img, ellipse(img, cx + side * 0.002, 0.405, 0.042, 0.014, soft=0.003, rot=side * -0.12), 0x17100B, 1.0)
    # Nose: shading down the bridge and nostrils (the nose geometry adds the profile).
    blend(img, rect(img, 0.486, 0.48, 0.496, 0.61, soft=0.01) * 0.4, 0x5A3020)
    for side in (-1, 1):
        blend(img, ellipse(img, 0.5 + side * 0.014, 0.632, 0.008, 0.005), 0x4A2A1E, 0.6)
    # Mouth.
    lip = 0xA0504A if female else 0x8A4B3E
    blend(img, ellipse(img, 0.5, 0.735, 0.04 if female else 0.042, 0.012 if female else 0.008), lip, 0.95 if female else 0.7)
    blend(img, rect(img, 0.46, 0.732, 0.54, 0.738, soft=0.004), 0x2E160F, 0.95)
    if female:
        for side in (-1, 1):
            blend(img, ellipse(img, 0.5 + side * 0.1, 0.6, 0.035, 0.03, soft=0.04) * 0.25, 0xD07070)
    else:
        # Five o'clock shadow along the jaw and upper lip.
        jaw = np.clip(ellipse(img, 0.5, 0.8, 0.16, 0.2, soft=0.1) - ellipse(img, 0.5, 0.62, 0.09, 0.08, soft=0.06), 0, 1)
        jaw = jaw * (y > 0.66)
        blend(img, jaw * 0.28, 0x2A2420)
        blend(img, ellipse(img, 0.5, 0.705, 0.05, 0.012, soft=0.02) * 0.25, 0x2A2420)
    # Ears area on the sides.
    for u in (0.27, 0.73):
        blend(img, ellipse(img, u, 0.52, 0.02, 0.06, soft=0.02) * 0.3, 0x7A4432)
    img[..., :3] = blur(img[..., :3], 0) if False else img[..., :3]
    return save_image(name, img)


def hair_texture(name, color):
    s = 64
    img = canvas(s, s, color)
    x, y = grid(img)
    blend(img, (np.sin(x * 60 + noise(s, s, 6, 2, 2) * 8) * 0.5 + 0.5) * 0.35, 0x000000)
    return save_image(name, img)


def shirt_texture(name, color, buttons=True):
    s = 64
    img = canvas(s, s, 0xFFFFFF)
    blend(img, noise(s, s, 8, 4, 2) * 0.12, 0x808080)
    return save_image(name, img)


# ── geometry helpers ────────────────────────────────────────────────────────


def segment(bm, p0, p1, r0, r1, segs=6, squash=1.0, cap=True):
    """Tapered prism from p0 to p1 (radii r0 -> r1). squash flattens depth."""
    p0, p1 = Vector(p0), Vector(p1)
    axis = (p1 - p0).normalized()
    ref = Vector((0, 0, 1)) if abs(axis.z) < 0.9 else Vector((0, 1, 0))
    u = axis.cross(ref).normalized()
    v = axis.cross(u).normalized()
    rings = []
    for p, r in ((p0, r0), (p1, r1)):
        ring = []
        for i in range(segs):
            a = (i + 0.5) / segs * math.tau
            ring.append(bm.verts.new(p + u * math.cos(a) * r + v * math.sin(a) * r * squash))
        rings.append(ring)
    for i in range(segs):
        j = (i + 1) % segs
        bm.faces.new((rings[0][i], rings[0][j], rings[1][j], rings[1][i]))
    if cap:
        bm.faces.new(list(reversed(rings[0])))
        bm.faces.new(rings[1])
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


def build_object(name, parts, armature):
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
    flat(ob)
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
    k = 0.95 if female else 1.0  # overall build
    sh = 0.185 if female else 0.215  # shoulder half width
    skin_col = 0xC08A64 if not female else 0xD39C78
    hair_col = 0x1C1612 if not female else 0x3A2418

    skin = mat("skin", skin_col, 0.75)
    face = mat("face", 0xFFFFFF, 0.7, image=face_texture(f"face_{gender}", female, skin_col, hair_col))
    hair = mat("hair", 0xFFFFFF, 0.8, image=hair_texture(f"hair_{gender}", hair_col))
    shirt = mat("shirt", 0x3A3D40 if not female else 0x7A2E3A, 0.85)
    pants = mat("pants", 0x2A2C30 if not female else 0x1E2026, 0.85)
    shoes = mat("shoes", 0x1A1512, 0.5)
    belt = mat("belt", 0x2A1E16, 0.5)
    lid_mat = mat("eyelid", skin_col, 0.8)

    # ── skeleton (armature space == Blender world) ──
    J = {
        "hips": ((0, 0.1, 0.56), (0, 0.1, 0.66)),
        "spine": ((0, 0.1, 0.66), (0, 0.09, 0.84)),
        "chest": ((0, 0.09, 0.84), (0, 0.06, 1.1 * k)),
        "neck": ((0, 0.055, 1.1 * k), (0, 0.045, 1.19 * k)),
        "head": ((0, 0.045, 1.19 * k), (0, 0.045, 1.46 * k)),
        "lids": ((0, -0.06, 1.34 * k), (0, -0.06, 1.315 * k)),
    }
    for side, sx in (("L", 1), ("R", -1)):
        J[f"shoulder_{side}"] = ((sx * 0.04, 0.07, 1.04 * k), (sx * sh, 0.08, 1.05 * k))
        J[f"upper_arm_{side}"] = ((sx * sh, 0.08, 1.04 * k), (sx * (sh + 0.04), -0.04, 0.8 * k))
        J[f"forearm_{side}"] = ((sx * (sh + 0.04), -0.04, 0.8 * k), (sx * 0.1, -0.3, 0.93 * k))
        J[f"hand_{side}"] = ((sx * 0.1, -0.3, 0.93 * k), (sx * 0.07, -0.38, 0.98 * k))
        J[f"thigh_{side}"] = ((sx * 0.1, 0.1, 0.55), (sx * 0.11, -0.36, 0.55))
        J[f"shin_{side}"] = ((sx * 0.11, -0.36, 0.55), (sx * 0.11, -0.38, 0.1))
        J[f"foot_{side}"] = ((sx * 0.11, -0.38, 0.06), (sx * 0.11, -0.52, 0.04))
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

    # ── body parts ──
    body = []

    def part(bone, material):
        p = Part(bone, material)
        body.append(p)
        return p

    # Pelvis and belt.
    p = part("hips", pants)
    blockbox(p.bm, (0, 0.08, 0.58), ((0.36 if female else 0.33), 0.26, 0.16))
    p = part("hips", belt)
    blockbox(p.bm, (0, 0.075, 0.665), ((0.325 if female else 0.32) - 0.0, 0.25, 0.035))
    # Torso: tapered towards the waist; a separate chest block so it can lean.
    p = part("spine", shirt)
    blockbox(p.bm, (0, 0.085, 0.76), ((0.29 if female else 0.32), 0.23, 0.2), taper=1.08)
    p = part("chest", shirt)
    blockbox(p.bm, (0, 0.075, 0.97 * k), (2 * sh + 0.02, 0.24, 0.27 * k), taper=1.05)
    if female:
        blockbox(p.bm, (0, -0.045, 0.955), (0.26, 0.05, 0.11), rot=(0.25, 0, 0), taper=0.9)
    # Open collar: a V of skin and two collar flaps.
    p = part("chest", skin)
    blockbox(p.bm, (0, -0.045, 1.05 * k), (0.07, 0.02, 0.1), rot=(0.1, 0, 0), taper=1.8)
    p = part("chest", shirt)
    for sx in (1, -1):
        blockbox(p.bm, (sx * 0.065, -0.035, 1.085 * k), (0.08, 0.02, 0.05), rot=(0.3, sx * 0.4, sx * -0.5))
    # Neck.
    p = part("neck", skin)
    segment(p.bm, (0, 0.055, 1.07 * k), (0, 0.05, 1.2 * k), 0.052 if female else 0.066, 0.055, segs=6)
    # Arms: short sleeves over skin, blocky hands.
    for side, sx in (("L", 1), ("R", -1)):
        sh0, el = Vector(J[f"upper_arm_{side}"][0]), Vector(J[f"upper_arm_{side}"][1])
        mid = sh0.lerp(el, 0.55)
        p = part(f"upper_arm_{side}", shirt)
        segment(p.bm, sh0 + Vector((0, 0, 0.02)), mid, 0.068, 0.06, segs=6)
        p = part(f"upper_arm_{side}", skin)
        segment(p.bm, mid, el, 0.045, 0.042, segs=6)
        p = part(f"shoulder_{side}", shirt)
        blockbox(p.bm, (sx * (sh - 0.04), 0.075, 1.04 * k), (0.12, 0.2, 0.12))
        wr = Vector(J[f"forearm_{side}"][1])
        p = part(f"forearm_{side}", skin)
        segment(p.bm, el, wr, 0.042, 0.032, segs=6)
        tip = Vector(J[f"hand_{side}"][1])
        p = part(f"hand_{side}", skin)
        segment(p.bm, wr, wr.lerp(tip, 0.6), 0.034, 0.038, segs=4, squash=0.55)
        segment(p.bm, wr.lerp(tip, 0.55), tip + (tip - wr) * 0.15, 0.036, 0.026, segs=4, squash=0.6)
        segment(p.bm, wr + Vector((-sx * 0.02, -0.01, 0.01)), wr + Vector((-sx * 0.05, -0.05, 0.04)), 0.014, 0.011, segs=4)
    # Legs.
    for side, sx in (("L", 1), ("R", -1)):
        hip, knee = Vector(J[f"thigh_{side}"][0]), Vector(J[f"thigh_{side}"][1])
        ank = Vector(J[f"shin_{side}"][1])
        p = part(f"thigh_{side}", pants)
        segment(p.bm, hip + Vector((0, 0.04, 0)), knee, 0.085 if female else 0.08, 0.06, segs=6)
        p = part(f"shin_{side}", pants if not female else skin)
        segment(p.bm, knee, ank + Vector((0, 0, 0.03)), 0.058 if not female else 0.045, 0.045 if not female else 0.035, segs=6)
        p = part(f"foot_{side}", shoes)
        blockbox(p.bm, (sx * 0.11, -0.43, 0.045), (0.09, 0.2 if not female else 0.17, 0.08 if not female else 0.07))
    if female:
        # A skirt over the thighs.
        p = part("hips", pants)
        blockbox(p.bm, (0, -0.12, 0.6), (0.38, 0.5, 0.12), taper=1.0)

    body_ob = build_object("body", body, rig)
    box_uv(body_ob)

    # ── head ──
    head_parts = []
    p = Part("head", face)
    head_parts.append(p)
    base = Vector((0, 0.045 + 0.01, 1.17 * k))
    hs = 0.95 if female else 1.0
    rings = [
        (0.00, 0.05 if not female else 0.035, 0.075, 0.02),
        (0.03, 0.078 if not female else 0.068, 0.095, 0.06),
        (0.07, 0.092, 0.102, 0.09),
        (0.11, 0.098, 0.104, 0.1),
        (0.15, 0.1, 0.103, 0.11),
        (0.19, 0.099, 0.097, 0.112),
        (0.225, 0.09, 0.085, 0.102),
        (0.255, 0.07, 0.06, 0.082),
        (0.275, 0.035, 0.03, 0.042),
    ]
    SEG = 12
    vrings = []
    for h, w, f, b in rings:
        ring = []
        for i in range(SEG):
            a = i / SEG * math.tau  # 0 = front (-Y)
            depth = f if math.cos(a) > 0 else b
            x = math.sin(a) * w * hs
            y = -math.cos(a) * depth * hs
            # Square the face off a little: GTA heads are boxy.
            if math.cos(a) > 0.3:
                y = -max(-y, depth * hs * 0.93)
            ring.append(p.bm.verts.new(base + Vector((x, y, h * hs))))
        vrings.append(ring)
    top = p.bm.verts.new(base + Vector((0, 0.01, 0.285 * hs)))
    bottom = p.bm.verts.new(base + Vector((0, -0.01, -0.005)))
    for r0, r1 in zip(vrings, vrings[1:]):
        for i in range(SEG):
            j = (i + 1) % SEG
            p.bm.faces.new((r0[i], r0[j], r1[j], r1[i]))
    for i in range(SEG):
        j = (i + 1) % SEG
        p.bm.faces.new((vrings[-1][i], vrings[-1][j], top))
        p.bm.faces.new((vrings[0][j], vrings[0][i], bottom))
    bmesh.ops.recalc_face_normals(p.bm, faces=p.bm.faces[:])
    # Cylindrical UVs, front at u=0.5; v from chin (0) to crown (1).
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
            loop[uv].uv = (u, min(1, max(0, co.z / (0.285 * hs))))
    # Nose, ears.
    pn = Part("head", skin)
    head_parts.append(pn)
    nb = base + Vector((0, -0.1 * hs, 0.1 * hs))
    nv = [pn.bm.verts.new(nb + Vector(o)) for o in ((-0.016, 0.0, 0), (0.016, 0.0, 0), (0, -0.032, 0.005),
                                                   (0, 0.0, 0.065), (0, -0.012, 0.06))]
    for f in ((0, 2, 1), (0, 4, 2), (1, 2, 4), (0, 3, 4), (1, 4, 3)):
        pn.bm.faces.new([nv[i] for i in f])
    for sx in (1, -1):
        blockbox(pn.bm, base + Vector((sx * 0.092 * hs, 0.01, 0.135 * hs)), (0.022, 0.04, 0.06))
    # Eyelids: hidden just inside the face over each painted eye; the runtime
    # slides the "lids" bone forward a couple of centimetres to blink (a rigid
    # move, so the lighting stays right).
    pl = Part("lids", lid_mat)
    head_parts.append(pl)
    for sx in (1, -1):
        blockbox(pl.bm, base + Vector((sx * 0.04 * hs, -0.094 * hs + 0.024, 0.153 * hs)), (0.05 * hs, 0.01, 0.024 * hs))
    head_ob = build_object("head_mesh", head_parts, rig)

    # ── hair shell ──
    hp = Part("head", hair)
    hb = base + Vector((0, 0.008, 0))
    hrings = [(0.12, 0.096, 0.0, 0.118), (0.17, 0.099, 0.0, 0.122), (0.215, 0.096, 0.1, 0.118),
              (0.25, 0.08, 0.085, 0.1), (0.28, 0.05, 0.05, 0.065), (0.296, 0.0, 0.0, 0.0)]
    if female:
        hrings = [(0.02, 0.1, 0.0, 0.11), (0.08, 0.102, 0.0, 0.118)] + hrings
    prev = None
    for h, w, f, b in hrings:
        ring = []
        for i in range(SEG):
            a = i / SEG * math.tau
            front = math.cos(a) > 0.2
            depth = (f if f else b * 0.2) if front else b
            ww = w * (0.7 if (front and not f) else 1.0)
            ring.append(hp.bm.verts.new(hb + Vector((math.sin(a) * ww * hs * 1.03, -math.cos(a) * depth * hs * 1.03, h * hs))))
        if prev:
            for i in range(SEG):
                j = (i + 1) % SEG
                hp.bm.faces.new((prev[i], prev[j], ring[j], ring[i]))
        prev = ring
    if female:
        # Long hair down the back and two locks framing the face.
        blockbox(hp.bm, hb + Vector((0, 0.09, -0.06)), (0.2, 0.06, 0.3), rot=(-0.12, 0, 0))
        for sx in (1, -1):
            blockbox(hp.bm, hb + Vector((sx * 0.1, -0.01, 0.06)), (0.03, 0.09, 0.24), rot=(0, sx * 0.05, 0))
        # Bangs swept across the forehead.
        blockbox(hp.bm, hb + Vector((0.02, -0.09, 0.245)), (0.16, 0.04, 0.05), rot=(0.4, 0, -0.15))
    else:
        # Quiff at the front hairline.
        blockbox(hp.bm, hb + Vector((0, -0.075, 0.255)), (0.13, 0.05, 0.025), rot=(0.35, 0, 0))
    hair_ob = build_object("hair", [hp], rig)
    box_uv(hair_ob, 10)

    # ── animation ──
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

    s = 1 if not female else 0.8  # women move a touch less broadly
    # idle: breathing, a slow glance around, the card hand settling.
    clip("idle", 96, {
        1: {"chest": (0, 0, 0), "head": (0, 0, 0), "neck": (0, 0, 0), "hand_L": (0, 0, 0), "upper_arm_R": (0, 0, 0)},
        24: {"chest": (-0.025, 0, 0), "head": (0.02, 0, 0.06 * s), "neck": (0, 0, 0.03), "hand_L": (0.05, 0, 0),
             "upper_arm_R": (-0.03, 0, 0)},
        48: {"chest": (0.0, 0, 0), "head": (0.05, 0, 0.0), "neck": (0, 0, 0), "hand_L": (0, 0.05, 0),
             "upper_arm_R": (0, 0, 0)},
        72: {"chest": (-0.025, 0, 0), "head": (0.02, 0, -0.07 * s), "neck": (0, 0, -0.03), "hand_L": (-0.03, 0, 0),
             "upper_arm_R": (-0.02, 0, 0)},
    })
    # think: studying the cards, head tilted, a finger shuffling the fan.
    clip("think", 144, {
        1: {"chest": (0.04, 0, 0), "head": (0.18, 0.08, 0), "neck": (0.05, 0, 0), "forearm_R": (0, 0, 0),
            "hand_R": (0, 0, 0)},
        36: {"chest": (0.06, 0, 0.02), "head": (0.24, 0.12, 0.05), "neck": (0.06, 0, 0), "forearm_R": (-0.15, 0, 0.1),
             "hand_R": (0.2, 0, 0)},
        72: {"chest": (0.04, 0, 0), "head": (0.16, -0.05, -0.04), "neck": (0.05, 0, 0), "forearm_R": (0, 0, 0),
             "hand_R": (0, 0, 0)},
        108: {"chest": (0.05, 0, -0.02), "head": (0.2, 0.06, 0.08), "neck": (0.05, 0, 0.02), "forearm_R": (-0.1, 0, 0.05),
              "hand_R": (0.15, 0, 0)},
    })
    # play: the right arm reaches out and lays a card in the middle.
    clip("play", 28, {
        1: {"chest": (0, 0, 0), "upper_arm_R": (0, 0, 0), "forearm_R": (0, 0, 0), "hand_R": (0, 0, 0), "head": (0, 0, 0)},
        11: {"chest": (0.18, 0, -0.1), "upper_arm_R": (-1.05, 0, -0.25), "forearm_R": (0.5, 0, 0.25), "hand_R": (0.4, 0, 0),
             "head": (0.2, 0, -0.1)},
        16: {"chest": (0.2, 0, -0.1), "upper_arm_R": (-1.0, 0, -0.25), "forearm_R": (0.62, 0, 0.25), "hand_R": (0.55, 0, 0),
             "head": (0.22, 0, -0.1)},
        28: {"chest": (0, 0, 0), "upper_arm_R": (0, 0, 0), "forearm_R": (0, 0, 0), "hand_R": (0, 0, 0), "head": (0, 0, 0)},
    }, loop=False)
    # win: lean back, chin up, a satisfied nod.
    clip("win", 48, {
        1: {"chest": (0, 0, 0), "head": (0, 0, 0), "spine": (0, 0, 0), "upper_arm_R": (0, 0, 0), "forearm_R": (0, 0, 0)},
        12: {"chest": (-0.15, 0, 0), "spine": (-0.06, 0, 0), "head": (-0.2, 0, 0), "upper_arm_R": (-0.3, 0, 0.3),
             "forearm_R": (0, 0, 0.3)},
        22: {"chest": (-0.14, 0, 0), "spine": (-0.06, 0, 0), "head": (0.05, 0, 0), "upper_arm_R": (-0.3, 0, 0.3),
             "forearm_R": (0, 0, 0.3)},
        32: {"chest": (-0.12, 0, 0), "spine": (-0.05, 0, 0), "head": (-0.12, 0, 0), "upper_arm_R": (-0.2, 0, 0.2),
             "forearm_R": (0, 0, 0.2)},
        48: {"chest": (0, 0, 0), "head": (0, 0, 0), "spine": (0, 0, 0), "upper_arm_R": (0, 0, 0), "forearm_R": (0, 0, 0)},
    }, loop=False)
    # lose: slump, shake the head.
    clip("lose", 48, {
        1: {"chest": (0, 0, 0), "head": (0, 0, 0), "spine": (0, 0, 0)},
        10: {"chest": (0.18, 0, 0), "spine": (0.08, 0, 0), "head": (0.3, 0, 0.2)},
        20: {"chest": (0.2, 0, 0), "spine": (0.08, 0, 0), "head": (0.32, 0, -0.2)},
        30: {"chest": (0.2, 0, 0), "spine": (0.08, 0, 0), "head": (0.3, 0, 0.18)},
        40: {"chest": (0.12, 0, 0), "spine": (0.05, 0, 0), "head": (0.2, 0, 0)},
        48: {"chest": (0, 0, 0), "head": (0, 0, 0), "spine": (0, 0, 0)},
    }, loop=False)


if __name__ == "__main__":
  for gender in ("male", "female"):
    rig = build(gender)
    bpy.context.scene.render.fps = FPS
    export_glb(os.path.join(OUT, f"{gender}.glb"), [rig], animations=True,
               extra=dict(export_skins=True, export_def_bones=False, export_morph=False,
                          export_anim_single_armature=True, export_reset_pose_bones=True))
