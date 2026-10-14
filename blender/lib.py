"""Shared helpers for the KING 3D asset scripts (run inside Blender).

Blender is Z-up and the glTF exporter converts to three.js' Y-up:
Blender (x, y, z) -> three (x, z, -y). Characters face Blender -Y, which is
three's +Z (toward the local player's camera).
"""
import math
import os

import bmesh
import bpy
import numpy as np

ROOT = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(ROOT)
OUT = os.path.join(REPO, "public", "models", "king3d")
TEX = os.path.join(ROOT, "build", "textures")
os.makedirs(OUT, exist_ok=True)
os.makedirs(TEX, exist_ok=True)


def reset():
    _materials.clear()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for block in (bpy.data.meshes, bpy.data.materials, bpy.data.images, bpy.data.actions):
        for item in list(block):
            block.remove(item)


def hex_rgb(value):
    if isinstance(value, str):
        value = int(value.lstrip("#"), 16)
    r, g, b = (value >> 16) & 255, (value >> 8) & 255, value & 255
    # Authoring colours are sRGB; Blender materials are linear.
    lin = lambda c: (c / 255) / 12.92 if c / 255 <= 0.04045 else ((c / 255 + 0.055) / 1.055) ** 2.4
    return (lin(r), lin(g), lin(b), 1.0)


_materials = {}


def mat(name, color=0xFFFFFF, rough=0.85, metal=0.0, emit=None, strength=1.0, image=None, alpha=None):
    if name in _materials:
        return _materials[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nodes = m.node_tree.nodes
    bsdf = nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = hex_rgb(color)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if image:
        tex = nodes.new("ShaderNodeTexImage")
        tex.image = image if isinstance(image, bpy.types.Image) else load_image(image)
        tex.interpolation = "Linear"
        m.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
        if alpha:
            m.node_tree.links.new(tex.outputs["Alpha"], bsdf.inputs["Alpha"])
            m.blend_method = "BLEND" if hasattr(m, "blend_method") else None
    if emit is not None:
        bsdf.inputs["Emission Color"].default_value = hex_rgb(emit)
        bsdf.inputs["Emission Strength"].default_value = strength
        if image and emit == "image":
            pass
    _materials[name] = m
    return m


def emissive_image_mat(name, image, strength=1.0):
    """Unlit-looking material: image drives both colour and emission."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nodes = m.node_tree.nodes
    bsdf = nodes.get("Principled BSDF")
    tex = nodes.new("ShaderNodeTexImage")
    tex.image = image if isinstance(image, bpy.types.Image) else load_image(image)
    m.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    m.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Emission Color"])
    bsdf.inputs["Emission Strength"].default_value = strength
    bsdf.inputs["Roughness"].default_value = 1
    _materials[name] = m
    return m


def load_image(path):
    img = bpy.data.images.load(path, check_existing=True)
    return img


def save_image(name, rgba, srgb=True):
    """rgba: float array (h, w, 4) in 0..1, row 0 = TOP of the picture."""
    h, w = rgba.shape[:2]
    img = bpy.data.images.new(name, width=w, height=h, alpha=True)
    img.pixels.foreach_set(np.ascontiguousarray(rgba[::-1]).astype(np.float32).ravel())
    path = os.path.join(TEX, name + ".png")
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    bpy.data.images.remove(img)
    return load_image(path)


def obj_from_bmesh(name, bm, material=None, parent=None):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    if material:
        ob.data.materials.append(material)
    if parent:
        ob.parent = parent
    return ob


def box(name, size, loc=(0, 0, 0), material=None, rot=(0, 0, 0), bevel=0.0, parent=None):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=size, verts=bm.verts)
    if bevel:
        bmesh.ops.bevel(bm, geom=bm.edges[:], offset=bevel, segments=1, affect="EDGES")
    ob = obj_from_bmesh(name, bm, material, parent)
    ob.location = loc
    ob.rotation_euler = rot
    return ob


def cyl(name, r1, r2, depth, loc=(0, 0, 0), material=None, segs=12, rot=(0, 0, 0), cap=True, parent=None):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=cap, cap_tris=False, segments=segs,
                          radius1=r1, radius2=r2, depth=depth)
    ob = obj_from_bmesh(name, bm, material, parent)
    ob.location = loc
    ob.rotation_euler = rot
    return ob


def sphere(name, r, loc=(0, 0, 0), material=None, segs=10, rings=6, scale=(1, 1, 1), parent=None):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=rings, radius=r)
    bmesh.ops.scale(bm, vec=scale, verts=bm.verts)
    ob = obj_from_bmesh(name, bm, material, parent)
    ob.location = loc
    return ob


def prism(name, points, height, loc=(0, 0, 0), material=None, rot=(0, 0, 0), parent=None):
    """Extrude a 2D polygon (x, y list, counter-clockwise) along +Z."""
    bm = bmesh.new()
    verts = [bm.verts.new((x, y, 0)) for x, y in points]
    face = bm.faces.new(verts)
    ext = bmesh.ops.extrude_face_region(bm, geom=[face])
    top = [v for v in ext["geom"] if isinstance(v, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, vec=(0, 0, height), verts=top)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    ob = obj_from_bmesh(name, bm, material, parent)
    ob.location = loc
    ob.rotation_euler = rot
    return ob


def join(name, objects):
    objects = [o for o in objects if o]
    bpy.ops.object.select_all(action="DESELECT")
    for o in objects:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    ob.data.name = name
    return ob


def apply_transforms(ob):
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


def flat(ob):
    for p in ob.data.polygons:
        p.use_smooth = False


def smooth(ob):
    for p in ob.data.polygons:
        p.use_smooth = True


def planar_uv(ob, axis="y", scale=1.0):
    """Box-ish planar projection so tiling textures land in world units."""
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


def export_glb(path, objects=None, animations=False, extra=None):
    bpy.ops.object.select_all(action="DESELECT")
    targets = objects or [o for o in bpy.context.scene.objects]
    for o in targets:
        o.select_set(True)
        for c in o.children_recursive:
            c.select_set(True)
    kwargs = dict(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_texcoords=True,
        export_normals=True,
        export_materials="EXPORT",
        export_image_format="AUTO",
        export_animations=animations,
        export_cameras=False,
        export_lights=False,
    )
    if animations:
        kwargs.update(export_animation_mode="NLA_TRACKS", export_force_sampling=True,
                      export_optimize_animation_size=True)
    if extra:
        kwargs.update(extra)
    bpy.ops.export_scene.gltf(**kwargs)
    print("exported", path, os.path.getsize(path) // 1024, "KB")


# ── tiny numpy raster helpers for painted textures ──────────────────────────

def canvas(w, h, color):
    img = np.zeros((h, w, 4), np.float32)
    img[:] = srgb01(color)
    return img


def srgb01(color):
    if isinstance(color, str):
        color = int(color.lstrip("#"), 16)
    return ((color >> 16 & 255) / 255, (color >> 8 & 255) / 255, (color & 255) / 255, 1.0)


def grid(img):
    h, w = img.shape[:2]
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    return xs / w, ys / h


def blend(img, mask, color, opacity=1.0):
    c = np.array(srgb01(color), np.float32)
    m = np.clip(mask, 0, 1)[..., None] * opacity
    img[:] = img * (1 - m) + c * m


def ellipse(img, cx, cy, rx, ry, soft=0.004, rot=0.0):
    """Anti-aliased ellipse mask in UV units (0..1, y down)."""
    x, y = grid(img)
    dx, dy = x - cx, y - cy
    if rot:
        c, s = math.cos(rot), math.sin(rot)
        dx, dy = dx * c + dy * s, -dx * s + dy * c
    d = np.sqrt((dx / rx) ** 2 + (dy / ry) ** 2)
    edge = soft / max(min(rx, ry), 1e-4)
    return np.clip((1 - d) / max(edge, 1e-4), 0, 1)


def rect(img, x0, y0, x1, y1, soft=0.0015):
    x, y = grid(img)
    a = np.clip((x - x0) / soft, 0, 1) * np.clip((x1 - x) / soft, 0, 1)
    b = np.clip((y - y0) / soft, 0, 1) * np.clip((y1 - y) / soft, 0, 1)
    return a * b


def polygon(img, pts):
    """Even-odd polygon mask; pts in UV (y down)."""
    x, y = grid(img)
    inside = np.zeros(x.shape, bool)
    n = len(pts)
    for i in range(n):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % n]
        cond = ((y1 > y) != (y2 > y)) & (x < (x2 - x1) * (y - y1) / ((y2 - y1) or 1e-9) + x1)
        inside ^= cond
    return inside.astype(np.float32)


def noise(h, w, scale=8, seed=1, octaves=3):
    rng = np.random.default_rng(seed)
    out = np.zeros((h, w), np.float32)
    amp, total = 1.0, 0.0
    for o in range(octaves):
        s = scale * 2 ** o
        small = rng.random((s + 1, s + 1)).astype(np.float32)
        ys = np.linspace(0, s, h)
        xs = np.linspace(0, s, w)
        y0 = np.floor(ys).astype(int).clip(0, s - 1)
        x0 = np.floor(xs).astype(int).clip(0, s - 1)
        fy = (ys - y0)[:, None]
        fx = (xs - x0)[None, :]
        fy, fx = fy * fy * (3 - 2 * fy), fx * fx * (3 - 2 * fx)
        a = small[y0][:, x0]
        b = small[y0][:, x0 + 1]
        c = small[y0 + 1][:, x0]
        d = small[y0 + 1][:, x0 + 1]
        out += amp * ((a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy)
        total += amp
        amp *= 0.5
    return out / total


def blur(img, r=2):
    out = img.copy()
    for axis in (0, 1):
        acc = np.zeros_like(out)
        for k in range(-r, r + 1):
            acc += np.roll(out, k, axis=axis)
        out = acc / (2 * r + 1)
    return out
