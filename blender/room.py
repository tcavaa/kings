"""The KING club room: octagonal card table, green leather armchairs,
bookcase, lamps, paintings, rug and the big windows onto Tbilisi.

Real-world metres, table centre at the origin, floor at z=0. The local
player sits at -Y, the two opponents at the far corners (+Y). room.js loads
the GLB into a group scaled by WORLD_SCALE (1.4).

  blender -b -P blender/room.py
"""
import math
import os
import sys

import bmesh
import bpy
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import (OUT, apply_transforms, blend, blur, box, canvas, cyl, ellipse, export_glb, flat, grid,  # noqa: E402
                 join, mat, noise, obj_from_bmesh, planar_uv, polygon, prism, rect, reset, save_image, sphere)

reset()
TABLE_H = 0.745
HALF_W = HALF_D = 0.84  # regular octagon: apothem of the outer rim
REG = 1 - math.tan(math.pi / 8)  # chamfer giving equal sides

# ── painted textures ────────────────────────────────────────────────────────


def wood_tex(name, base, dark, size=256, seed=1, stretch=14):
    img = canvas(size, size, base)
    n = noise(size, size, 4, seed, 4)
    x, y = grid(img)
    grain = (np.sin((x * stretch + n * 3.2) * math.pi * 2) * 0.5 + 0.5) ** 3
    blend(img, grain * 0.55, dark)
    blend(img, noise(size, size, 24, seed + 3, 2) * 0.25, dark)
    return save_image(name, img)


def felt_tex():
    s = 256
    img = canvas(s, s, 0x1F5E46)
    blend(img, noise(s, s, 32, 5, 3) * 0.3, 0x174A37)
    blend(img, noise(s, s, 64, 9, 1) * 0.2, 0x2A7056)
    return save_image("felt", img)


def leather_tex():
    s = 128
    img = canvas(s, s, 0x1D4A3B)
    blend(img, noise(s, s, 16, 2, 3) * 0.5, 0x10301F)
    blend(img, noise(s, s, 6, 4, 2) * 0.3, 0x2E6450)
    return save_image("leather", img)


def rug_tex():
    """Caucasian rug: deep red field, navy border, rows of medallions."""
    s = 512
    img = canvas(s, s, 0x7A2422)
    x, y = grid(img)
    blend(img, noise(s, s, 48, 3, 2) * 0.25, 0x521716)
    border = ((x < 0.09) | (x > 0.91) | (y < 0.09) | (y > 0.91)).astype(np.float32)
    blend(img, border, 0x1E2B4A)
    inner = ((x < 0.105) | (x > 0.895) | (y < 0.105) | (y > 0.895)).astype(np.float32) - border
    blend(img, inner, 0xC9A060)
    # Running dog motif along the border.
    zig = (np.abs(((x * 22) % 1) - 0.5) * 2 > 0.5).astype(np.float32) * border
    blend(img, zig * 0.5, 0x8C6A3A)
    for cy in (0.3, 0.5, 0.7):
        for cx in (0.3, 0.5, 0.7):
            d = np.abs(x - cx) + np.abs(y - cy)
            blend(img, (d < 0.085).astype(np.float32), 0x1E2B4A)
            blend(img, (d < 0.062).astype(np.float32), 0xD7B375)
            blend(img, (d < 0.04).astype(np.float32), 0x7A2422)
            blend(img, (d < 0.016).astype(np.float32), 0x1E2B4A)
    return save_image("rug", img)


def wallpaper_tex():
    s = 256
    img = canvas(s, s, 0xE3D3B2)
    x, y = grid(img)
    for cx, cy in ((0.25, 0.25), (0.75, 0.75)):
        d = np.abs(x - cx) * 1.6 + np.abs(y - cy)
        blend(img, ((d > 0.14) & (d < 0.17)).astype(np.float32) * 0.5, 0xA8946F)
        blend(img, ellipse(img, cx, cy, 0.03, 0.05) * 0.5, 0xA8946F)
    blend(img, noise(s, s, 16, 8, 2) * 0.15, 0x8E7C5B)
    return save_image("wallpaper", img)


def painting_tex(name, seed, city=True):
    """A small oil painting of old Tbilisi: hillside houses and a church."""
    w, h = 384, 256
    rng = np.random.default_rng(seed)
    img = canvas(w, h, 0xC8B38A)
    x, y = grid(img)
    sky = np.clip(1 - y * 1.6, 0, 1)
    blend(img, sky, 0x9DB3C2)
    blend(img, np.clip(y * 2 - 0.6, 0, 1), 0x7C8A5B)
    # Hills.
    hill = (y > 0.38 + 0.12 * np.sin(x * 5 + seed) + 0.05 * np.sin(x * 13)).astype(np.float32)
    blend(img, hill * 0.85, 0x6E7B4C)
    if city:
        for i in range(60):
            cx, cy = rng.uniform(0.02, 0.98), rng.uniform(0.45, 0.9)
            bw, bh = rng.uniform(0.02, 0.05), rng.uniform(0.04, 0.08)
            col = [0xD9C7A0, 0xC9A27A, 0xE6D8B8, 0xB88A66][i % 4]
            blend(img, rect(img, cx - bw, cy - bh, cx + bw, cy + bh), col)
            blend(img, polygon(img, [(cx - bw * 1.2, cy - bh), (cx, cy - bh * 1.8), (cx + bw * 1.2, cy - bh)]), 0x9B4B37)
        # A church on the hill.
        blend(img, rect(img, 0.48, 0.24, 0.56, 0.42), 0xE8DCC0)
        blend(img, polygon(img, [(0.47, 0.24), (0.52, 0.12), (0.57, 0.24)]), 0x7D5A45)
    img[..., :3] = blur(img[..., :3], 1)
    blend(img, noise(h, w, 40, seed, 2) * 0.2, 0x5A4A30)
    return save_image(name, img)


def lampshade_tex():
    s = 64
    img = canvas(s, s, 0xF2D9A0)
    blend(img, noise(s, s, 8, 3, 2) * 0.3, 0xE0B870)
    return save_image("lampshade", img)


WOOD = mat("wood", 0xFFFFFF, 0.6, image=wood_tex("wood", 0x7C4A2E, 0x4A2A18, seed=2))
WOOD_LIGHT = mat("wood_light", 0xFFFFFF, 0.65, image=wood_tex("wood_light", 0x7A4A2C, 0x45291A, seed=5))
PANEL = mat("panel", 0xFFFFFF, 0.7, image=wood_tex("panel", 0x7A4A2E, 0x4E2C1A, seed=9, stretch=6))
FLOOR = mat("floor", 0xFFFFFF, 0.6, image=wood_tex("floor", 0x6A4228, 0x3E2414, seed=11, stretch=20))
FELT = mat("felt", 0xFFFFFF, 0.95, image=felt_tex())
LEATHER = mat("leather", 0xFFFFFF, 0.55, image=leather_tex())
RUG = mat("rug", 0xFFFFFF, 1.0, image=rug_tex())
WALLPAPER = mat("wallpaper", 0xFFFFFF, 0.9, image=wallpaper_tex())
GOLD = mat("gold", 0xC8A050, 0.35, metal=0.9)
BRASS = mat("brass", 0xB08A44, 0.4, metal=0.85)
CEILING = mat("ceiling", 0xEFE6D2, 0.95)
SHADE = mat("lamp_shade", 0xFFFFFF, 0.8, emit=0xFFC57A, strength=2.2, image=lampshade_tex())
BULB = mat("bulb", 0xFFE2A8, emit=0xFFE2A8, strength=8)
GLASS = mat("glass", 0x9BB3A8, 0.08)
WHISKY = mat("whisky", 0xB8651C, 0.2, emit=0x6A3008, strength=0.4)
BOTTLE = mat("bottle", 0x163A2C, 0.15)
LABEL = mat("label", 0xD9C48F, 0.7)
DARK = mat("dark_metal", 0x2B2A28, 0.5, metal=0.6)
CURTAIN = mat("curtain", 0x23453A, 0.95)
POT = mat("pot", 0xD8D0C0, 0.6)
LEAF = mat("leaf", 0x2F5A2E, 0.8)
FRAME_GOLD = mat("frame_gold", 0xA88445, 0.35, metal=0.8)
WINDOW = mat("window_frame", 0x3A2418, 0.6)
CARD_BACK = mat("card_back", 0x173F33, 0.7)

parts = []


def add(o):
    parts.append(o)
    return o


# ── floor, rug, walls, ceiling ──────────────────────────────────────────────
ROOM_X0, ROOM_X1, ROOM_Y0, ROOM_Y1, ROOM_H = -4.6, 4.6, -4.2, 4.4, 3.3
floor = add(box("floor", (ROOM_X1 - ROOM_X0, ROOM_Y1 - ROOM_Y0, 0.05), (0, 0.1, -0.025), FLOOR))
planar_uv(floor, scale=0.5)
rug = add(box("rug", (5.4, 4.6, 0.012), (0, 0.15, 0.006), RUG))
me = rug.data
me.uv_layers.new(name="UVMap")
for poly in me.polygons:
    for li in poly.loop_indices:
        co = me.vertices[me.loops[li].vertex_index].co
        me.uv_layers.active.data[li].uv = (co.x / 5.4 + 0.5, co.y / 4.6 + 0.5)
ceil = add(box("ceiling", (ROOM_X1 - ROOM_X0, ROOM_Y1 - ROOM_Y0, 0.08), (0, 0.1, ROOM_H + 0.04), CEILING))
for i in range(5):
    add(box(f"beam{i}", (ROOM_X1 - ROOM_X0, 0.22, 0.18), (0, ROOM_Y0 + 0.9 + i * 1.8, ROOM_H - 0.09), WOOD))


def wall(name, length, center, axis, window=None):
    """A wainscoted wall: panelled lower half, wallpaper above, crown moulding.
    axis 'x' runs along X (back/front walls), 'y' along Y (side walls)."""
    cx, cy = center
    along = (length, 0.12, 1) if axis == "x" else (0.12, length, 1)
    inward = (0, -1) if (axis == "x" and cy > 0) else (0, 1) if axis == "x" else ((-1, 0) if cx > 0 else (1, 0))
    obs = []
    base = box(name + "_wain", (along[0], along[1], 1.1), (cx, cy, 0.55), PANEL)
    planar_uv(base, scale=0.8)
    obs.append(base)
    upper = box(name + "_paper", (along[0], along[1], ROOM_H - 1.1), (cx, cy, 1.1 + (ROOM_H - 1.1) / 2), WALLPAPER)
    planar_uv(upper, scale=1.2)
    obs.append(upper)
    # Raised panels on the wainscot.
    n = max(1, int(length / 0.9))
    for i in range(n):
        t = -length / 2 + (i + 0.5) * length / n
        px, py = (cx + t, cy + inward[1] * 0.07) if axis == "x" else (cx + inward[0] * 0.07, cy + t)
        size = (length / n - 0.18, 0.03, 0.72) if axis == "x" else (0.03, length / n - 0.18, 0.72)
        p = box(f"{name}_p{i}", size, (px, py, 0.55), WOOD)
        planar_uv(p, scale=0.8)
        obs.append(p)
    rail = (length, 0.08, 0.07) if axis == "x" else (0.08, length, 0.07)
    off = (inward[0] * 0.06, inward[1] * 0.06)
    obs.append(box(name + "_rail", rail, (cx + off[0], cy + off[1], 1.12), WOOD))
    obs.append(box(name + "_skirt", (rail[0], rail[1], 0.14), (cx + off[0], cy + off[1], 0.07), WOOD))
    obs.append(box(name + "_crown", (rail[0], rail[1], 0.12), (cx + off[0], cy + off[1], ROOM_H - 0.06), WOOD))
    return [add(o) for o in obs]


# Back wall: panelled on the left, windows on the right.
wall("back", 4.6, (-2.3, ROOM_Y1), "x")
wall("left", ROOM_Y1 - ROOM_Y0, (ROOM_X0, 0.1), "y")
wall("front", ROOM_X1 - ROOM_X0, (0, ROOM_Y0), "x")


def window_wall(name, x0, x1, y0, y1):
    """Floor-to-ceiling window bays between wooden piers along a straight run."""
    length = math.dist((x0, y0), (x1, y1))
    ang = math.atan2(y1 - y0, x1 - x0)
    bays = max(1, round(length / 1.25))
    obs = []
    for i in range(bays + 1):
        t = i / bays
        px, py = x0 + (x1 - x0) * t, y0 + (y1 - y0) * t
        obs.append(box(f"{name}_pier{i}", (0.24, 0.3, ROOM_H), (px, py, ROOM_H / 2), PANEL, rot=(0, 0, ang)))
        if i < bays:
            mx, my = x0 + (x1 - x0) * (t + 0.5 / bays), y0 + (y1 - y0) * (t + 0.5 / bays)
            bw = length / bays - 0.24
            obs.append(box(f"{name}_sill{i}", (bw, 0.34, 0.62), (mx, my, 0.31), PANEL, rot=(0, 0, ang)))
            obs.append(box(f"{name}_sillcap{i}", (bw + 0.04, 0.4, 0.05), (mx, my, 0.64), WOOD, rot=(0, 0, ang)))
            obs.append(box(f"{name}_head{i}", (bw, 0.3, 0.35), (mx, my, ROOM_H - 0.17), PANEL, rot=(0, 0, ang)))
            # Mullions and a transom.
            obs.append(box(f"{name}_mull{i}", (0.05, 0.08, ROOM_H - 1.0), (mx, my, 0.64 + (ROOM_H - 1.0) / 2), WINDOW, rot=(0, 0, ang)))
            obs.append(box(f"{name}_tran{i}", (bw, 0.08, 0.05), (mx, my, 2.45), WINDOW, rot=(0, 0, ang)))
            obs.append(box(f"{name}_rail{i}", (bw, 0.05, 0.04), (mx, my, 1.0), WINDOW, rot=(0, 0, ang)))
    for o in obs:
        planar_uv(o, scale=0.8)
    return [add(o) for o in obs]


window_wall("win_back", 0.0, ROOM_X1, ROOM_Y1, ROOM_Y1)
window_wall("win_right", ROOM_X1, ROOM_X1, ROOM_Y1, -1.0)
wall("right_front", 3.2, (ROOM_X1, -2.6), "y")
# Heavy curtains framing the windows.
for name, loc in (("cur_a", (0.15, ROOM_Y1 - 0.25)), ("cur_b", (ROOM_X1 - 0.25, -0.9))):
    for k in range(5):
        add(cyl(f"{name}{k}", 0.09, 0.09, ROOM_H - 0.3, (loc[0] + (k * 0.11 if name == "cur_a" else 0),
                                                         loc[1] + (0 if name == "cur_a" else k * 0.11), (ROOM_H - 0.3) / 2),
                CURTAIN, segs=6))
add(cyl("cur_rod", 0.025, 0.025, 4.8, (2.3, ROOM_Y1 - 0.22, ROOM_H - 0.25), BRASS, segs=6, rot=(0, math.pi / 2, 0)))

# ── the card table ──────────────────────────────────────────────────────────


def octagon(hw, hd, cut=0.36):
    """Stretched octagon, counter-clockwise; cut = corner chamfer ratio."""
    cx, cy = hw * cut, hd * cut
    return [(hw, -hd + cy), (hw, hd - cy), (hw - cx, hd), (-hw + cx, hd), (-hw, hd - cy), (-hw, -hd + cy),
            (-hw + cx, -hd), (hw - cx, -hd)]


def bevelled_slab(name, pts, z, h, material, bevel=0.0):
    ob = prism(name, pts, h, (0, 0, z), material)
    if bevel:
        mod = ob.modifiers.new("bevel", "BEVEL")
        mod.width = bevel
        mod.segments = 2
        mod.limit_method = "ANGLE"
    return ob


# Polished rim raised above the baize, a gold edge, the felt, an inlaid line.
rim = add(bevelled_slab("table_rim", octagon(HALF_W, HALF_D, REG), TABLE_H - 0.075, 0.073, WOOD, 0.02))
planar_uv(rim, scale=0.7)
add(bevelled_slab("table_gold", octagon(HALF_W - 0.115, HALF_D - 0.115, REG), TABLE_H - 0.004, 0.006, GOLD))
# The raised, rounded wooden bumper around the baize, one piece per side.
outer = octagon(HALF_W, HALF_D, REG)
for i in range(8):
    (x0, y0), (x1, y1) = outer[i], outer[(i + 1) % 8]
    mx, my = (x0 + x1) / 2, (y0 + y1) / 2
    nx, ny = mx / math.hypot(mx, my), my / math.hypot(mx, my)
    seg = box(f"bumper{i}", (math.dist((x0, y0), (x1, y1)) + 0.02, 0.11, 0.03),
              (mx - nx * 0.055, my - ny * 0.055, TABLE_H + 0.01), WOOD, rot=(0, 0, math.atan2(y1 - y0, x1 - x0)), bevel=0.012)
    planar_uv(seg, scale=0.7)
    add(seg)
felt = add(bevelled_slab("table_felt", octagon(HALF_W - 0.125, HALF_D - 0.125, REG), TABLE_H - 0.002, 0.008, FELT))
planar_uv(felt, scale=1.2)
inner = octagon(HALF_W - 0.17, HALF_D - 0.17, REG)
for i in range(len(inner)):
    (x0, y0), (x1, y1) = inner[i], inner[(i + 1) % len(inner)]
    add(box(f"inlay{i}", (math.dist((x0, y0), (x1, y1)), 0.008, 0.002), ((x0 + x1) / 2, (y0 + y1) / 2, TABLE_H + 0.0065),
            GOLD, rot=(0, 0, math.atan2(y1 - y0, x1 - x0))))
# Apron, pedestal and feet.
add(bevelled_slab("table_apron", octagon(HALF_W - 0.08, HALF_D - 0.08, REG), TABLE_H - 0.2, 0.13, WOOD))
add(cyl("pedestal", 0.18, 0.26, 0.5, (0, 0, 0.32), WOOD, segs=8))
for k in range(4):
    a = k * math.pi / 2 + math.pi / 4
    add(box(f"foot{k}", (0.8, 0.12, 0.08), (math.cos(a) * 0.35, math.sin(a) * 0.35, 0.05), WOOD, rot=(0, 0, a)))

# The gold crown inlaid in the felt, centre far side.
CROWN_Y, CS = 0.22, 0.62
crown = [(-0.2, 0), (0.2, 0), (0.22, 0.03), (0.26, 0.15), (0.13, 0.07), (0.1, 0.18), (0.0, 0.08), (-0.1, 0.18),
         (-0.13, 0.07), (-0.26, 0.15), (-0.22, 0.03)]
c = add(prism("crown_inlay", [(x * CS, y * CS) for x, y in crown], 0.003, (0, CROWN_Y, TABLE_H + 0.006), GOLD))
for x, y in ((-0.26, 0.15), (-0.1, 0.18), (0.1, 0.18), (0.26, 0.15), (0, 0.205)):
    add(cyl(f"crown_jewel{x}", 0.012, 0.012, 0.003, (x * CS, CROWN_Y + y * CS, TABLE_H + 0.0075), GOLD, segs=8))
add(box("crown_band", (0.4 * CS, 0.02, 0.003), (0, CROWN_Y - 0.006, TABLE_H + 0.0075), GOLD))

# Brass ashtrays at the far corners; a whisky glass and cognac on the right.
for name, (x, y) in (("ashtray_l", (-0.6, 0.3)), ("ashtray_r", (0.6, 0.3))):
    add(cyl(name, 0.075, 0.082, 0.035, (x, y, TABLE_H + 0.018), BRASS, segs=10))
    add(cyl(name + "_in", 0.056, 0.056, 0.01, (x, y, TABLE_H + 0.032), DARK, segs=10))
add(cyl("glass", 0.036, 0.031, 0.085, (0.62, -0.08, TABLE_H + 0.043), GLASS, segs=10))
add(cyl("whisky", 0.033, 0.03, 0.04, (0.62, -0.08, TABLE_H + 0.022), WHISKY, segs=10))
add(cyl("table_bottle", 0.045, 0.045, 0.2, (0.64, 0.08, TABLE_H + 0.1), BOTTLE, segs=8))
add(cyl("table_bottle_shoulder", 0.045, 0.016, 0.05, (0.64, 0.08, TABLE_H + 0.225), BOTTLE, segs=8))
add(cyl("table_bottle_neck", 0.016, 0.015, 0.07, (0.64, 0.08, TABLE_H + 0.285), BOTTLE, segs=6))
add(cyl("table_bottle_label", 0.046, 0.046, 0.07, (0.64, 0.08, TABLE_H + 0.09), LABEL, segs=8, cap=False))

# ── armchairs for the two opponents ────────────────────────────────────────
# 10 and 2 o'clock, 0.28 m behind the rim (blender/characters.py rests the
# forearms on an edge at that distance).
SEATS = {"left": (-0.694, 0.827), "right": (0.694, 0.827)}


def armchair(name, x, y):
    ang = math.atan2(-x, y)  # face the table centre
    obs = [
        box(name + "_seat", (0.66, 0.6, 0.16), (0, 0.05, 0.42), LEATHER, bevel=0.03),
        box(name + "_base", (0.7, 0.66, 0.3), (0, 0.05, 0.2), WOOD, bevel=0.02),
        box(name + "_back", (0.7, 0.16, 0.85), (0, 0.38, 0.85), LEATHER, bevel=0.04),
        box(name + "_armL", (0.12, 0.66, 0.26), (-0.36, 0.05, 0.6), LEATHER, bevel=0.03),
        box(name + "_armR", (0.12, 0.66, 0.26), (0.36, 0.05, 0.6), LEATHER, bevel=0.03),
    ]
    # Brass studs along the back and arms.
    for i in range(9):
        obs.append(sphere(f"{name}_stud{i}", 0.012, (-0.33 + i * 0.0825, 0.295, 1.22), BRASS, segs=6, rings=3))
    for side in (-0.36, 0.36):
        for i in range(6):
            obs.append(sphere(f"{name}_astud{side}{i}", 0.011, (side, -0.26 + i * 0.11, 0.735), BRASS, segs=6, rings=3))
    for o in obs:
        planar_uv(o, scale=1.5)
    j = join(name, obs)
    j.location = (x, y, 0)
    j.rotation_euler = (0, 0, ang)
    return add(j)


for k, (x, y) in SEATS.items():
    armchair(f"chair_{k}", x, y)

# Spare chairs pushed against the left wall, as in the reference.
armchair("chair_spare", -3.6, 2.6).rotation_euler = (0, 0, -math.pi / 2 - 0.3)

# ── bookcase, cabinet, lamps, paintings, plants ─────────────────────────────


def bookcase(x, y, w=1.9, h=2.6):
    obs = [box("bc_back", (w, 0.05, h), (0, 0.2, h / 2), PANEL),
           box("bc_l", (0.06, 0.45, h), (-w / 2, 0, h / 2), WOOD),
           box("bc_r", (0.06, 0.45, h), (w / 2, 0, h / 2), WOOD),
           box("bc_top", (w + 0.1, 0.5, 0.08), (0, 0, h), WOOD),
           box("bc_doors", (w, 0.45, 0.75), (0, 0, 0.375), WOOD)]
    for i in range(4):
        obs.append(box(f"bc_door_panel{i}", (w / 4 - 0.08, 0.02, 0.55), (-w / 2 + (i + 0.5) * w / 4, -0.23, 0.38), WOOD_LIGHT))
        obs.append(sphere(f"bc_knob{i}", 0.015, (-w / 2 + (i + 0.5) * w / 4 + (0.12 if i % 2 == 0 else -0.12), -0.25, 0.45), BRASS,
                          segs=6, rings=3))
    rng = np.random.default_rng(4)
    colors = [0x6B2A22, 0x1F3B33, 0x2C2F45, 0x7A5A2E, 0x4A2A3A, 0x8A7550, 0x2B4A2A]
    books = {c: [] for c in colors}
    for row in range(3):
        z = 0.78 + row * 0.6
        obs.append(box(f"bc_shelf{row}", (w, 0.42, 0.04), (0, 0, z), WOOD))
        bx = -w / 2 + 0.08
        while bx < w / 2 - 0.12:
            if row == 1 and -0.2 < bx < 0.25:
                bx = 0.25  # gap for the crown ornament
                continue
            if row == 2 and 0.35 < bx < 0.75:
                bx = 0.75  # gap for the horse
                continue
            bw = rng.uniform(0.035, 0.07)
            bh = rng.uniform(0.3, 0.45)
            lean = rng.random() < 0.06
            c = colors[rng.integers(len(colors))]
            books[c].append(box(f"book{row}_{bx:.2f}", (bw, 0.28, bh), (bx + bw / 2, 0.02, z + 0.02 + bh / 2),
                                mat("book_" + hex(c), c, 0.75), rot=(0, 0.15 if lean else 0, 0)))
            bx += bw + 0.004
    for c, bs in books.items():
        if bs:
            obs.append(join("books_" + hex(c), bs))
    # Little gold crown ornament and a bronze horse.
    obs.append(prism("bc_crown", [(-0.12, 0), (0.12, 0), (0.15, 0.14), (0.07, 0.07), (0, 0.16), (-0.07, 0.07), (-0.15, 0.14)],
                     0.06, (0.02, 0.03, 1.4 + 0.02), GOLD, rot=(math.pi / 2, 0, 0)))
    horse = [box("h_body", (0.22, 0.07, 0.09), (0.55, 0, 2.15), BRASS),
             box("h_neck", (0.06, 0.06, 0.14), (0.66, 0, 2.23), BRASS, rot=(0, 0.5, 0)),
             box("h_head", (0.09, 0.05, 0.05), (0.71, 0, 2.3), BRASS, rot=(0, 0.6, 0)),
             box("h_plinth", (0.26, 0.12, 0.05), (0.55, 0, 2.02), WOOD)]
    for lx in (0.47, 0.63):
        horse.append(box(f"h_leg{lx}", (0.025, 0.025, 0.12), (lx, 0, 2.08), BRASS))
    obs.append(join("horse", horse))
    for o in obs:
        if o.data.uv_layers:
            continue
        planar_uv(o, scale=0.8)
    b = join("bookcase", obs)
    b.location = (x, y, 0)
    return add(b)


bookcase(-2.6, ROOM_Y1 - 0.3)
bookcase(-ROOM_X1 + 0.3, -1.2).rotation_euler = (0, 0, -math.pi / 2)


def table_lamp(name, x, y, z):
    obs = [cyl(name + "_base", 0.09, 0.11, 0.04, (0, 0, 0.02), BRASS, segs=10),
           cyl(name + "_stem", 0.018, 0.018, 0.42, (0, 0, 0.25), BRASS, segs=8),
           sphere(name + "_knot", 0.035, (0, 0, 0.2), BRASS, segs=8, rings=4)]
    lamp = join(name, obs)
    lamp.location = (x, y, z)
    add(lamp)
    shade = cyl(name + "_shade", 0.24, 0.14, 0.26, (x, y, z + 0.52), SHADE, segs=8, cap=False)
    shade.name = name + "_shade"
    add(shade)
    add(sphere(name + "_bulb", 0.04, (x, y, z + 0.44), BULB, segs=6, rings=4))


# Low cabinet between the bookcase and the windows, lamp and decanter on top.
cab = add(box("cabinet", (1.3, 0.45, 0.8), (-0.85, ROOM_Y1 - 0.3, 0.4), WOOD, bevel=0.01))
planar_uv(cab, scale=0.8)
for i in range(2):
    add(box(f"cab_door{i}", (0.58, 0.02, 0.6), (-1.17 + i * 0.64, ROOM_Y1 - 0.53, 0.4), WOOD_LIGHT))
table_lamp("lamp_back", -0.6, ROOM_Y1 - 0.3, 0.8)
add(cyl("decanter", 0.07, 0.05, 0.22, (-1.2, ROOM_Y1 - 0.3, 0.91), GLASS, segs=8))
add(cyl("decanter_whisky", 0.066, 0.06, 0.12, (-1.2, ROOM_Y1 - 0.3, 0.87), WHISKY, segs=8))
add(sphere("decanter_stopper", 0.035, (-1.2, ROOM_Y1 - 0.3, 1.05), GLASS, segs=6, rings=4))

# Bar cart by the windows with a cognac bottle and glasses.
cart = [box("cart_top", (0.8, 0.45, 0.03), (0, 0, 0.75), WOOD), box("cart_low", (0.8, 0.45, 0.03), (0, 0, 0.3), WOOD)]
for dx in (-0.38, 0.38):
    for dy in (-0.2, 0.2):
        cart.append(cyl(f"cart_leg{dx}{dy}", 0.012, 0.012, 0.76, (dx, dy, 0.38), BRASS, segs=6))
cart_ob = join("bar_cart", cart)
cart_ob.location = (3.4, 2.9, 0)
cart_ob.rotation_euler = (0, 0, -0.5)
add(cart_ob)
for i, (dx, dy) in enumerate(((0.0, 0.0), (0.2, 0.05))):
    add(cyl(f"bottle{i}", 0.05, 0.05, 0.24, (3.4 + dx, 2.9 + dy, 0.9), BOTTLE, segs=8))
    add(cyl(f"bottle_neck{i}", 0.02, 0.016, 0.1, (3.4 + dx, 2.9 + dy, 1.07), BOTTLE, segs=6))
    add(cyl(f"bottle_label{i}", 0.051, 0.051, 0.08, (3.4 + dx, 2.9 + dy, 0.88), LABEL, segs=8, cap=False))
add(cyl("cart_glass", 0.035, 0.03, 0.08, (3.2, 2.85, 0.81), GLASS, segs=8))

# Floor lamp in the left corner.
add(cyl("floorlamp_base", 0.18, 0.2, 0.04, (-3.9, 3.7, 0.02), BRASS, segs=10))
add(cyl("floorlamp_stem", 0.02, 0.02, 1.6, (-3.9, 3.7, 0.82), BRASS, segs=6))
add(cyl("floorlamp_shade", 0.32, 0.2, 0.34, (-3.9, 3.7, 1.75), SHADE, segs=8, cap=False))


def painting(name, image, x, y, w, h, rot):
    canvas_mat = mat(name, 0xFFFFFF, 0.8, image=image)
    frame = box(name + "_frame", (w + 0.14, 0.05, h + 0.14), (0, 0, 0), FRAME_GOLD, bevel=0.015)
    pic = box(name + "_canvas", (w, 0.02, h), (0, -0.03, 0), canvas_mat)
    me = pic.data
    me.uv_layers.new(name="UVMap")
    for poly in me.polygons:
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            me.uv_layers.active.data[li].uv = (co.x / w + 0.5, co.z / h + 0.5)
    planar_uv(frame)
    p = join(name, [pic, frame])
    p.location = (x, y, 1.95)
    p.rotation_euler = (0, 0, rot)
    return add(p)


painting("painting_back", painting_tex("painting_old_tbilisi", 3), -0.85, ROOM_Y1 - 0.1, 1.1, 0.75, 0)
painting("painting_left", painting_tex("painting_hills", 8, city=True), ROOM_X0 + 0.1, 1.6, 1.3, 0.85, -math.pi / 2)
painting("painting_front", painting_tex("painting_kura", 12), -2.0, ROOM_Y0 + 0.1, 1.2, 0.8, math.pi)

# Potted plant by the window.
add(cyl("pot", 0.18, 0.14, 0.34, (0.55, ROOM_Y1 - 0.45, 0.17), POT, segs=10))
leaves = []
for i in range(14):
    a = i * 2.4
    leaves.append(box(f"leaf{i}", (0.05, 0.3, 0.012), (0.55 + math.cos(a) * 0.12, ROOM_Y1 - 0.45 + math.sin(a) * 0.12, 0.5 + (i % 4) * 0.1),
                      LEAF, rot=(0.9, 0, a)))
add(join("plant", leaves))

# Ceiling chandelier above the table.
add(cyl("chandelier_rod", 0.015, 0.015, 0.9, (0, 0.1, ROOM_H - 0.45), BRASS, segs=6))
add(cyl("chandelier_ring", 0.45, 0.45, 0.04, (0, 0.1, ROOM_H - 0.9), BRASS, segs=12, cap=False))
for k in range(6):
    a = k * math.pi / 3
    add(cyl(f"chandelier_shade{k}", 0.08, 0.05, 0.12, (math.cos(a) * 0.45, 0.1 + math.sin(a) * 0.45, ROOM_H - 0.84),
            SHADE, segs=6, cap=False))

for o in parts:
    flat(o)

export_glb(os.path.join(OUT, "room.glb"), parts)
