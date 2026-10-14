"""First-person hands in dark jacket sleeves.

hand_left grips the card fan: palm behind the cards, fingers along their
backs, the thumb pressed across the faces. Its origin is the fan's pivot
(the lower middle of the fan); +Z runs up the cards, -Y toward the camera.
hand_right points with the index finger along +Y; origin at the fingertip
end of the palm. Materials skin / sleeve / cuff are recoloured at runtime.

  blender -b -P blender/hands.py
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector as V

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import OUT, export_glb, mat, obj_from_bmesh, reset  # noqa: E402
from characters import loft  # noqa: E402

reset()
SKIN = mat("skin", 0xB98260, 0.7)
SLEEVE = mat("sleeve", 0x2E3436, 0.85)
CUFF = mat("cuff", 0xE8E2D4, 0.8)


def finger(bm, joints, radius):
    """A finger through joint points, tapering to a rounded tip."""
    n = len(joints)
    radii = [(radius * (1 - 0.12 * i), radius * 0.85 * (1 - 0.12 * i)) for i in range(n)]
    loft(bm, joints, radii, 6)


def make(name, build):
    parts = {"skin": bmesh.new(), "sleeve": bmesh.new(), "cuff": bmesh.new()}
    build(parts)
    obs = []
    for key, m in (("skin", SKIN), ("sleeve", SLEEVE), ("cuff", CUFF)):
        bm = parts[key]
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        obs.append(obj_from_bmesh(f"{name}_{key}", bm, m))
    bpy.ops.object.select_all(action="DESELECT")
    for o in obs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = obs[0]
    bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    for p in ob.data.polygons:
        p.use_smooth = False
    return ob


def left(p):
    skin, sleeve, cuff = p["skin"], p["sleeve"], p["cuff"]
    # Palm upright behind the lower cards.
    loft(skin, [V((-0.005, 0.03, -0.13)), V((0.0, 0.026, -0.08)), V((0.005, 0.022, -0.025))],
         [(0.034, 0.02), (0.046, 0.022), (0.047, 0.018)], 8, up=(0, -1, 0))
    # Fingers up the backs of the cards, curling slightly toward the camera.
    for i in range(4):
        x = -0.03 + i * 0.02
        L = 0.085 - abs(i - 1.3) * 0.012
        b = V((x, 0.02, -0.02))
        finger(skin, [b, b + V((0.004, 0.0, L * 0.45)), b + V((0.008, -0.006, L * 0.8)), b + V((0.01, -0.016, L))], 0.0095)
    # The thumb, thick, across the faces of the fan.
    t0 = V((-0.042, 0.005, -0.085))
    finger(skin, [t0, t0 + V((0.012, -0.022, 0.03)), t0 + V((0.03, -0.03, 0.06)), t0 + V((0.048, -0.032, 0.082))], 0.0135)
    # Wrist and forearm away down-left toward the camera.
    w = V((-0.01, 0.03, -0.14))
    loft(skin, [w, w + V((-0.01, -0.02, -0.05))], [(0.033, 0.024), (0.034, 0.025)], 8)
    c0 = w + V((-0.01, -0.02, -0.05))
    loft(cuff, [c0, c0 + V((-0.006, -0.01, -0.025))], [(0.04, 0.032), (0.041, 0.033)], 8)
    s0 = c0 + V((-0.006, -0.01, -0.02))
    loft(sleeve, [s0, s0 + V((-0.07, -0.16, -0.3)), s0 + V((-0.14, -0.3, -0.55))], [(0.048, 0.042), (0.06, 0.055), (0.07, 0.065)], 8)


def right(p):
    skin, sleeve, cuff = p["skin"], p["sleeve"], p["cuff"]
    # Back of the hand, flat-ish, tilted: index finger out along +Y.
    loft(skin, [V((0, -0.1, 0.0)), V((0, -0.06, 0.004)), V((0, -0.01, 0.006))],
         [(0.036, 0.016), (0.046, 0.018), (0.047, 0.015)], 8, up=(0, 0, 1))
    # Index finger extended.
    b = V((-0.03, 0.0, 0.006))
    finger(skin, [b, b + V((0.0, 0.035, 0.0)), b + V((0.0, 0.062, -0.004)), b + V((0.0, 0.085, -0.012))], 0.0098)
    # The other three curled under the palm.
    for i in range(3):
        b = V((-0.008 + i * 0.019, -0.002, 0.004))
        finger(skin, [b, b + V((0.0, 0.03, -0.012)), b + V((0.0, 0.03, -0.04)), b + V((0.0, 0.006, -0.048))], 0.0095)
    # Thumb tucked along the side.
    t0 = V((-0.045, -0.07, -0.004))
    finger(skin, [t0, t0 + V((-0.008, 0.03, -0.006)), t0 + V((-0.004, 0.058, -0.012))], 0.0125)
    w = V((0, -0.1, 0.0))
    loft(skin, [w, w + V((0.006, -0.05, -0.012))], [(0.034, 0.024), (0.034, 0.025)], 8)
    c0 = w + V((0.006, -0.05, -0.012))
    loft(cuff, [c0, c0 + V((0.003, -0.025, -0.006))], [(0.041, 0.033), (0.042, 0.034)], 8)
    s0 = c0 + V((0.003, -0.02, -0.005))
    loft(sleeve, [s0, s0 + V((0.08, -0.3, -0.12)), s0 + V((0.16, -0.6, -0.26))], [(0.048, 0.042), (0.06, 0.055), (0.07, 0.065)], 8)


obs = [make("hand_left", left), make("hand_right", right)]
export_glb(os.path.join(OUT, "hands.glb"), obs)
