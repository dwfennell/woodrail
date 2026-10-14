"""
A small toolkit for modelling Woodrail's toys in Blender (run by the model scripts beside it, with `bpy`).

The look is a wooden toy's: chunky shapes, every edge rounded, lacquer over beech. Units are mm, the same as the game.
Blender is Z up; the glTF exporter turns that into the game's Y up. Blender X is the game's +x, Blender Y the game's -z.

Materials are named for what the game swaps in by name (see src/render/blender-models.ts):
  "wood"            natural beech            "metal"   the dark magnet/metal
  "coal"            coal                     "lamp"    an engine's lamp (glows to show the lever)
  "lacquer #rrggbb" lacquer paint in that colour
  "lacquer fixed #rrggbb"  the same, kept in every colour variant of a catalogue model (faces)

Moving parts (wheels, the lamp) are kept as their own nodes, centred where they turn; everything else in a model is
merged into one mesh per material, so a model costs a handful of draw calls.
"""

import math
import os

import bpy  # first: with the pip `bpy` module, bmesh and mathutils come with it

import bmesh
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))

# The parts of the model being built (`begin` .. `finish`).
_parts = []


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def material(name):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    if name.startswith("lacquer #") or name.startswith("lacquer fixed #"):
        h = name.split("#")[1]
        srgb = [int(h[i : i + 2], 16) / 255 for i in (0, 2, 4)]
        lin = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in srgb]
        m.diffuse_color = (*lin, 1)
    else:
        m.diffuse_color = {
            "wood": (0.75, 0.55, 0.33, 1),
            "cut": (0.5, 0.36, 0.22, 1),
            "metal": (0.02, 0.02, 0.02, 1),
            "coal": (0.01, 0.01, 0.01, 1),
            "lamp": (1, 0.6, 0.15, 1),
            "glass": (0.6, 0.8, 0.9, 1),
            "felt": (0.07, 0.19, 0.03, 1),
            "water": (0.02, 0.12, 0.35, 1),
            "road": (0.27, 0.25, 0.23, 1),
        }.get(name, (0.5, 0.5, 0.5, 1))
    return m


def paint(color):
    """The material name for lacquer in `color` (#rrggbb)."""
    return f"lacquer {color.lower()}"


def _link(name, bm, mat, location):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(material(mat))
    obj = bpy.data.objects.new(name, me)
    obj.location = location
    bpy.context.scene.collection.objects.link(obj)
    _parts.append(obj)
    return obj


def _smooth(obj, angle=35):
    """Smooth shading, keeping edges sharper than `angle` crisp (the bevel then rounds them)."""
    me = obj.data
    me.shade_smooth()
    bm = bmesh.new()
    bm.from_mesh(me)
    for e in bm.edges:
        if len(e.link_faces) == 2 and e.calc_face_angle(0) > math.radians(angle):
            e.smooth = False
    bm.to_mesh(me)
    bm.free()
    return obj


def round_edges(obj, width, segments=3, angle=35):
    """Round edges sharper than `angle` (normals are set when the model is baked: see `_set_normals`)."""
    if width <= 0:
        return obj
    m = obj.modifiers.new("bevel", "BEVEL")
    m.width = width
    m.segments = segments
    m.limit_method = "ANGLE"
    m.angle_limit = math.radians(angle)
    m.miter_outer = "MITER_ARC"
    return obj


def moving(obj):
    """Keep this part as its own node (wheels, the lamp), named as it is."""
    obj["moving"] = True
    return obj


# ——— Shapes ———


def box(mat, size, at, r=1.5, seg=None, name="box"):
    """A box `size` (x, y, z) centred at `at`, edges rounded by `r` (in more steps for big roundings)."""
    seg = seg or (4 if r >= 3 else 3)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    obj = _smooth(_link(name, bm, mat, at))
    return round_edges(obj, min(r, min(size) / 2 - 0.05), seg)


def lathe(mat, profile, at, axis="Z", seg=32, name="lathe"):
    """Spin a profile of (radius, height) points round an axis: chimneys, domes, wheels, posts."""
    bm = bmesh.new()
    rings = []
    for r, h in profile:
        rings.append([bm.verts.new((r * math.cos(2 * math.pi * i / seg), r * math.sin(2 * math.pi * i / seg), h)) for i in range(seg)])
    for a, b in zip(rings, rings[1:]):
        for i in range(seg):
            j = (i + 1) % seg
            bm.faces.new((a[i], a[j], b[j], b[i]))
    for k, flip in ((0, True), (-1, False)):
        if profile[k][0] > 1e-3:
            f = bm.faces.new(rings[k])
            if flip:
                f.normal_flip()
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    _orient(bm, axis)
    return _smooth(_link(name, bm, mat, at), 40)


def cylinder(mat, r, length, at, axis="Z", seg=24, round_=1.0, name="cylinder"):
    """A cylinder centred at `at` with rounded ends (a lathe with an arc at each rim)."""
    h = length / 2
    k = min(round_, r * 0.9, h * 0.9)
    prof = [(0.0, -h)]
    for i in range(4):
        a = math.pi / 2 * i / 3
        prof.append((r - k + k * math.sin(a), -h + k - k * math.cos(a)))
    for i in range(4):
        a = math.pi / 2 * i / 3
        prof.append((r - k + k * math.cos(a), h - k + k * math.sin(a)))
    prof.append((0.0, h))
    return lathe(mat, prof, at, axis, seg, name)


def ball(mat, r, at, seg=20, name="ball", squash=1.0):
    prof = [(r * math.sin(math.pi * i / 8), -r * squash * math.cos(math.pi * i / 8)) for i in range(9)]
    prof[0] = (0.0, prof[0][1])
    prof[-1] = (0.0, prof[-1][1])
    return lathe(mat, prof, at, "Z", seg, name)


def dome(mat, r, h, at, seg=32, name="dome"):
    """Half a (squashed) ball on its flat side."""
    prof = [(0.0, 0.0)] + [(r * math.cos(math.pi / 2 * i / 6), h * math.sin(math.pi / 2 * i / 6)) for i in range(7)]
    prof[-1] = (0.0, h)
    return lathe(mat, prof, at, "Z", seg, name)


def arch_roof(mat, length, span, rise, thick, at, r=0.9, seg=16, name="roof"):
    """An arched roof sheet along X: `span` wide, rising `rise` in the middle, `thick` thick; `at` is its eaves' base."""
    bm = bmesh.new()
    prof = []
    for k in range(seg + 1):
        y = -span / 2 + span * k / seg
        prof.append((y, rise * (1 - (2 * y / span) ** 2)))
    loop = prof + [(y, z + thick) for y, z in prof][::-1]
    front = [bm.verts.new((length / 2, y, z)) for y, z in loop]
    back = [bm.verts.new((-length / 2, y, z)) for y, z in loop]
    n = len(loop)
    for k in range(n):
        j = (k + 1) % n
        bm.faces.new((back[k], back[j], front[j], front[k]))
    bm.faces.new(front)
    bm.faces.new(back[::-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    obj = _smooth(_link(name, bm, mat, at), 30)
    return round_edges(obj, r, 3, 30)


def bar(mat, a, b, r, seg=8, name="bar"):
    """A round rod from point a to point b."""
    a, b = Vector(a), Vector(b)
    d = b - a
    obj = cylinder(mat, r, d.length, (0, 0, 0), "Z", seg, r * 0.6, name)
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(d.normalized())
    obj.location = (a + b) / 2
    return obj


def lumps(mat, at, size, count=34, lump=4.2, seed=1, name="lumps", subdivisions=1):
    """A heap of coal lumps over a footprint `size` (x, y), heaped `size[2]` high in the middle: faceted, flat-shaded."""
    import random

    rnd = random.Random(seed)
    bm = bmesh.new()
    for _ in range(count):
        x = (rnd.random() - 0.5) * size[0]
        y = (rnd.random() - 0.5) * size[1]
        z = (1 - math.hypot(2 * x / size[0], 2 * y / size[1])) * size[2] + rnd.random() * 1.5
        piece = bmesh.ops.create_icosphere(bm, subdivisions=subdivisions, radius=lump * (0.35 + rnd.random() * 0.3))["verts"]
        stretch = Vector((1 + rnd.random() * 0.5, 1 + rnd.random() * 0.3, 1))
        for v in piece:
            v.co = Vector((v.co.x * stretch.x, v.co.y * stretch.y, v.co.z))
        rot = Matrix.Rotation(rnd.random() * 3, 3, "X") @ Matrix.Rotation(rnd.random() * 3, 3, "Z")
        bmesh.ops.rotate(bm, verts=piece, matrix=rot)
        for v in piece:
            v.co.z *= 0.8
            v.co += Vector((x, y, max(0.0, z)))
    obj = _link(name, bm, mat, at)
    obj["flat"] = True
    return obj


def _orient(bm, axis):
    if axis == "X":
        bmesh.ops.rotate(bm, verts=bm.verts, matrix=Matrix.Rotation(math.pi / 2, 3, "Y"))
    elif axis == "Y":
        bmesh.ops.rotate(bm, verts=bm.verts, matrix=Matrix.Rotation(-math.pi / 2, 3, "X"))


# ——— Cuts ———


def cutter_box(size, at):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    return _cutter(bm, at)


def cutter_boxes(boxes):
    """One cutter made of several boxes ((size, at) pairs): one boolean for many openings is far more robust."""
    bm = bmesh.new()
    for size, at in boxes:
        made = bmesh.ops.create_cube(bm, size=1.0)["verts"]
        bmesh.ops.scale(bm, vec=Vector(size), verts=made)
        bmesh.ops.translate(bm, vec=Vector(at), verts=made)
    return _cutter(bm, (0, 0, 0))


def cutter_cylinder(r, length, at, axis="Z", seg=24):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r, radius2=r, depth=length)
    _orient(bm, axis)
    return _cutter(bm, at)


def _cutter(bm, at):
    me = bpy.data.meshes.new("cutter")
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new("cutter", me)
    obj.location = at
    obj["cutter"] = True
    obj.display_type = "WIRE"
    bpy.context.scene.collection.objects.link(obj)
    _parts.append(obj)
    return obj


def cut(obj, *cutters):
    """Cut the shapes out of `obj` before its bevel, so the openings are rounded as much as its edges (doors, arches)."""
    for c in cutters:
        m = obj.modifiers.new("cut", "BOOLEAN")
        m.operation = "DIFFERENCE"
        m.solver = "EXACT"
        m.object = c
        obj.modifiers.move(len(obj.modifiers) - 1, 0)
    return obj


def recess(obj, cutter):
    """
    Cut a shallow shape into `obj` after its bevel, its edges left crisp (window recesses): the body's big rounding
    would melt a shallow recess away, and rounding it afterwards builds stray faces across the openings.
    """
    m = obj.modifiers.new("recess", "BOOLEAN")
    m.operation = "DIFFERENCE"
    m.solver = "EXACT"
    m.object = cutter
    return obj


# ——— Building, baking and export ———


def begin():
    _parts.clear()


SMOOTH_ANGLE = 50


def _set_normals(me, angle=SMOOTH_ANGLE):
    """
    Each corner's normal: the area-weighted average of the faces round its vertex that turn less than `angle` from its
    own face. Roundings (cut in steps under `angle`) shade smooth; edges sharper than that stay crisp; and a flat face
    stays flat even where cuts have split it into slivers, because its big faces outweigh a rounding's thin strips.
    """
    limit = math.cos(math.radians(angle))
    around = [[] for _ in me.vertices]
    for p in me.polygons:
        for v in p.vertices:
            around[v].append(p.index)
    polys = me.polygons
    normals = [None] * len(me.loops)
    for p in polys:
        n = p.normal
        for li in p.loop_indices:
            acc = Vector((0, 0, 0))
            for q in around[me.loops[li].vertex_index]:
                qn = polys[q].normal
                if n.dot(qn) >= limit:
                    acc += qn * polys[q].area
            normals[li] = acc.normalized() if acc.length > 1e-12 else n.copy()
    me.shade_smooth()
    me.normals_split_custom_set(normals)


def _uv_project(me, scale=60.0):
    """Planar UVs from each face's main axis, one texture repeat per `scale` mm: the beech grain at a steady size."""
    uv = me.uv_layers.new(name="UVMap") if not me.uv_layers else me.uv_layers[0]
    for poly in me.polygons:
        n = poly.normal
        ax = max(range(3), key=lambda k: abs(n[k]))
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            u, v = [(co.y, co.z), (co.x, co.z), (co.x, co.y)][ax]
            uv.data[li].uv = (u / scale, v / scale)


def finish(name, layout_at=(0, 0, 0), pivots=()):
    """
    Bake the parts built since `begin` into model `name`: modifiers applied, still parts joined per material, moving
    parts kept whole. Returns the model's root (an empty at `layout_at`, where it sits in the .blend).

    `pivots` are empties (named parts that move: an arm, a head, a flag), each parented to the pivot it hangs from or
    to none. A part whose "owner" is a pivot's name is joined, per material, into a mesh under that pivot, in its
    space, so turning the pivot turns it.

    Meshes are copied and joined with Blender's own operations, never through bmesh, which would drop the custom
    normals the bevels and weighted-normal passes leave (and with them the crisp shading of flat faces).
    """
    dg = bpy.context.evaluated_depsgraph_get()
    root = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(root)
    by_name = {p.name: p for p in pivots}
    groups = {}
    baked = []
    for obj in _parts:
        if obj.get("cutter"):
            continue
        me = bpy.data.meshes.new_from_object(obj.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
        mat = obj.data.materials[0].name
        me.materials.clear()
        me.materials.append(material(mat))
        owner = by_name.get(obj.get("owner", ""))
        if obj.get("moving"):
            # Keep it whole, its origin where it turns.
            part = bpy.data.objects.new(obj.name, me)
            part.matrix_world = obj.matrix_world
        else:
            space = owner.matrix_world.inverted() if owner else Matrix.Identity(4)
            me.transform(space @ obj.matrix_world)
            part = bpy.data.objects.new(f"{name}:{mat}", me)
            groups.setdefault((owner.name if owner else "", mat), []).append(part)
        _uv_project(me)
        if obj.get("flat"):
            me.shade_flat()
        else:
            _set_normals(me, obj.get("smooth_angle", SMOOTH_ANGLE))
        bpy.context.scene.collection.objects.link(part)
        baked.append(part)
    old = list(_parts)
    _parts.clear()
    for obj in old:
        data = obj.data
        bpy.data.objects.remove(obj)
        if data and data.users == 0:
            bpy.data.meshes.remove(data)
    merged = {id(p) for g in groups.values() for p in g}
    keep = [(p, None) for p in baked if id(p) not in merged]
    for (owner, mat), objs in sorted(groups.items()):
        if len(objs) > 1:
            with bpy.context.temp_override(active_object=objs[0], selected_editable_objects=objs, selected_objects=objs):
                bpy.ops.object.join()
        objs[0].name = f"{name}:{mat}"
        keep.append((objs[0], by_name.get(owner)))
    for p in pivots:
        if p.parent is None:
            world = p.matrix_world.copy()
            p.parent = root
            p.matrix_world = world
    tris = 0
    for obj, owner in keep:
        if owner:
            obj.parent = owner
            obj.matrix_parent_inverse = Matrix.Identity(4)
            obj.matrix_basis = Matrix.Identity(4)
        else:
            obj.parent = root
        obj.data.calc_loop_triangles()
        tris += len(obj.data.loop_triangles)
    root.location = layout_at
    print(f"  {name}: {len(keep)} meshes, {len(pivots)} pivots, {tris} triangles")
    return root


def save_and_export(stem):
    """Save tools/blender/<stem>.blend and export tools/blender/out/<stem>.glb (gltfpack compresses it for the game)."""
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, f"{stem}.blend"))
    os.makedirs(os.path.join(HERE, "out"), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=os.path.join(HERE, "out", f"{stem}.glb"),
        export_format="GLB",
        export_yup=True,
        export_apply=True,
        export_texcoords=True,
        export_normals=True,
        export_materials="EXPORT",
        export_animations=False,
        export_cameras=False,
        export_lights=False,
    )
