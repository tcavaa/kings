"""First-person hands: the left grips the card fan (thumb in front of the
cards, fingers behind), the right points with the index finger.

Objects hand_left / hand_right; origin of each is the grip / fingertip
anchor. Camera looks along +Y. Materials skin and sleeve are recoloured at
runtime (gender, outfit).

  blender -b -P blender/hands.py
"""
import os
import sys

import bmesh
import bpy
from mathutils import Euler, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import OUT, export_glb, flat, mat, obj_from_bmesh, reset  # noqa: E402
from characters import blockbox, segment  # noqa: E402

reset()
SKIN = mat("skin", 0xC08A64, 0.75)
SLEEVE = mat("sleeve", 0x2E3436, 0.85)
CUFF = mat("cuff", 0xE8E2D4, 0.8)


def finger(bm, base, direction, length, r=0.0105, bend=(0, 0, 0), joints=3):
    p = Vector(base)
    d = Vector(direction).normalized()
    seg = length / joints
    for j in range(joints):
        q = p + d * seg
        segment(bm, p, q, r * (1 - j * 0.08), r * (1 - (j + 1) * 0.08), segs=4, squash=0.8)
        d = (Euler(bend).to_matrix() @ d).normalized()
        p = q


def make(name, build):
    skin_bm, sleeve_bm, cuff_bm = bmesh.new(), bmesh.new(), bmesh.new()
    build(skin_bm, sleeve_bm, cuff_bm)
    obs = []
    for bm, m, n in ((skin_bm, SKIN, "skin"), (sleeve_bm, SLEEVE, "sleeve"), (cuff_bm, CUFF, "cuff")):
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        obs.append(obj_from_bmesh(f"{name}_{n}", bm, m))
    bpy.ops.object.select_all(action="DESELECT")
    for o in obs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = obs[0]
    bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    flat(ob)
    return ob


def left(skin, sleeve, cuff):
    # Palm upright behind the bottom of the fan; wrist below and toward the camera.
    blockbox(skin, (0, 0.025, -0.04), (0.085, 0.03, 0.095), rot=(0.25, 0, 0))
    for i in range(4):
        x = -0.03 + i * 0.02
        finger(skin, (x, 0.03, 0.0), (0, -0.25, 1), 0.07 - abs(i - 1.5) * 0.008, bend=(0.5, 0, 0))
    # Thumb across the front of the cards.
    finger(skin, (0.045, 0.005, -0.06), (-0.4, -0.6, 1), 0.07, r=0.013, bend=(0.2, 0, -0.2), joints=2)
    segment(skin, (0, 0.035, -0.09), (0.01, 0.07, -0.16), 0.035, 0.032, segs=6, squash=0.8)
    segment(cuff, (0.01, 0.07, -0.16), (0.015, 0.085, -0.185), 0.042, 0.042, segs=6)
    segment(sleeve, (0.015, 0.085, -0.18), (0.08, 0.3, -0.62), 0.05, 0.075, segs=6)


def right(skin, sleeve, cuff):
    # Index finger out along +Y, the rest curled into the palm.
    blockbox(skin, (0, -0.07, 0), (0.088, 0.09, 0.03))
    finger(skin, (-0.03, -0.025, 0.005), (0, 1, 0), 0.085, bend=(0, 0, 0))
    for i in range(3):
        finger(skin, (-0.008 + i * 0.02, -0.03, 0.0), (0, 1, -0.4), 0.06, bend=(-0.9, 0, 0), joints=2)
    finger(skin, (-0.045, -0.08, -0.005), (-0.5, 0.8, -0.2), 0.055, r=0.013, joints=2)
    segment(skin, (0, -0.11, 0), (0.0, -0.18, -0.02), 0.036, 0.034, segs=6, squash=0.7)
    segment(cuff, (0.0, -0.18, -0.02), (0.0, -0.205, -0.025), 0.044, 0.044, segs=6)
    segment(sleeve, (0.0, -0.2, -0.025), (0.06, -0.62, -0.18), 0.052, 0.08, segs=6)


obs = [make("hand_left", left), make("hand_right", right)]
export_glb(os.path.join(OUT, "hands.glb"), obs)
