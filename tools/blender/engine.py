"""
Build the Blender pilot engine and export it for the game.

    npm run models                            # runs this with `python3` (or $BLENDER_PYTHON), then compresses it

It needs the `bpy` module (pip install bpy==5.2.2, Python 3.13), or run it with Blender itself:
`blender -b -P tools/blender/engine.py`. It writes tools/blender/engine.blend (the parts with their bevels and cuts
still live, to open and tweak by hand) and tools/blender/out/engine.glb, which gltfpack compresses (meshopt) into
public/models/engine.glb for the game.

Units are mm, the same as the game. Blender is Z up and the exporter turns that into the game's Y up: Blender X is the
car's forward (+x in the game), Blender Y is the game's -z, Blender Z is the game's y.

Every part wears one of a few named materials. The game swaps each for its own material by that name (body, trim,
wood, metal, pane, wheel, lamp), so the engine is lit and painted like every other car and can take its colour
schemes. Parts that never move are merged per material (a handful of draw calls); the wheels (`wheel_0`..`wheel_3`,
each centred on its axle so they spin in place) and the lamp stay separate.
"""

import math
import os

import bpy  # first: with the pip `bpy` module, bmesh and mathutils come with it

import bmesh
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))

# Car dimensions, from the game (src/sim/cars.ts, src/render/train-models.ts).
L = 96.0
W = 32.0
WHEEL_R = 6.5
WHEEL_W = 4.5
GROOVE_SPACING = 26.0
AXLE_X = L / 2 - 20  # bogieInset
AXLE_Z = 15.0  # AXLE_HEIGHT
DECK = 19.0  # centre of the chassis slab
TOP = DECK + 4  # top of the chassis slab

BOILER_R = 12.5
BOILER_Z = TOP + BOILER_R
BOILER_X0, BOILER_X1 = -10.0, 42.0
CAB_X0, CAB_X1 = -44.0, -12.0
CAB_TOP = TOP + 32

MATERIALS = ["body", "trim", "wood", "metal", "pane", "wheel", "lamp"]


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for name in MATERIALS:
        bpy.data.materials.new(name)


def mesh_object(name, bm, material, location=(0, 0, 0)):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(bpy.data.materials[material])
    obj = bpy.data.objects.new(name, me)
    obj.location = location
    bpy.context.scene.collection.objects.link(obj)
    return obj


def smooth(obj, angle=35):
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


def bevel(obj, width, segments=3, angle=35):
    m = obj.modifiers.new("bevel", "BEVEL")
    m.width = width
    m.segments = segments
    m.limit_method = "ANGLE"
    m.angle_limit = math.radians(angle)
    m.harden_normals = True
    m.miter_outer = "MITER_ARC"
    return obj


def box(name, material, size, location, round_=1.5, segments=3):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    obj = mesh_object(name, bm, material, location)
    smooth(obj)
    if round_ > 0:
        bevel(obj, round_, segments)
    return obj


def lathe(name, material, profile, location, axis="Z", segments=32, cap=True):
    """Spin a profile of (radius, height) points round an axis: chimneys, domes, wheels, buffers."""
    bm = bmesh.new()
    rings = []
    for r, h in profile:
        ring = []
        for i in range(segments):
            a = 2 * math.pi * i / segments
            ring.append(bm.verts.new((r * math.cos(a), r * math.sin(a), h)))
        rings.append(ring)
    for a, b in zip(rings, rings[1:]):
        for i in range(segments):
            j = (i + 1) % segments
            bm.faces.new((a[i], a[j], b[j], b[i]))
    if cap:
        for ring, flip in ((rings[0], True), (rings[-1], False)):
            if profile[rings.index(ring)][0] > 1e-3:
                f = bm.faces.new(ring)
                if flip:
                    f.normal_flip()
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    if axis == "X":
        bmesh.ops.rotate(bm, verts=bm.verts, matrix=Matrix.Rotation(math.pi / 2, 3, "Y"))
    elif axis == "Y":
        bmesh.ops.rotate(bm, verts=bm.verts, matrix=Matrix.Rotation(-math.pi / 2, 3, "X"))
    obj = mesh_object(name, bm, material, location)
    return smooth(obj, 40)


def cutter(name, size, location, cylinder_axis=None, radius=0.0, segments=32):
    """A hidden shape to cut away with a boolean."""
    bm = bmesh.new()
    if cylinder_axis:
        bmesh.ops.create_cone(bm, cap_ends=True, segments=segments, radius1=radius, radius2=radius, depth=size)
        if cylinder_axis == "X":
            bmesh.ops.rotate(bm, verts=bm.verts, matrix=Matrix.Rotation(math.pi / 2, 3, "Y"))
        elif cylinder_axis == "Y":
            bmesh.ops.rotate(bm, verts=bm.verts, matrix=Matrix.Rotation(math.pi / 2, 3, "X"))
    else:
        bmesh.ops.create_cube(bm, size=1.0)
        bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    obj.location = location
    obj.hide_render = True
    obj["cutter"] = True
    bpy.context.scene.collection.objects.link(obj)
    return obj


def cut(obj, *cutters):
    # Cut before the bevel, so the openings get rounded edges too.
    for c in cutters:
        m = obj.modifiers.new("cut", "BOOLEAN")
        m.operation = "DIFFERENCE"
        m.solver = "EXACT"
        m.object = c
        obj.modifiers.move(len(obj.modifiers) - 1, 0)
    return obj


def build():
    # ——— Chassis: a beech slab with an arch over each wheel ———
    chassis = box("chassis", "wood", (L - 6, 30, 8), (0, 0, DECK), round_=2)
    inner = GROOVE_SPACING / 2 - WHEEL_W / 2 - 1.5
    depth = W / 2 - inner + 2
    for x in (-AXLE_X, AXLE_X):
        for s in (-1, 1):
            cut(chassis, cutter("arch", depth, (x, s * (inner + depth / 2), AXLE_Z), "Y", WHEEL_R + 1.5))

    # ——— Wheels: dished, with a rounded rim; each centred on its axle so it spins in place ———
    r = WHEEL_R
    hw = WHEEL_W / 2
    wheel_profile = [(0.0, -hw + 0.6), (r - 2.4, -hw + 0.6), (r - 1.2, -hw), (r - 0.4, -hw + 0.3), (r, -hw + 1.0), (r, hw - 1.0), (r - 0.4, hw - 0.3), (r - 1.2, hw), (r - 2.4, hw - 0.6), (0.0, hw - 0.6)]
    i = 0
    for x in (AXLE_X, -AXLE_X):
        for y in (GROOVE_SPACING / 2, -GROOVE_SPACING / 2):
            lathe(f"wheel_{i}", "wheel", wheel_profile, (x, y, AXLE_Z), axis="Y", segments=28)
            # Hub: a domed metal boss on the outside face.
            s = 1 if y > 0 else -1
            hub = [(1.9, 0), (1.9, 1.2), (1.4, 2.0), (0.0, 2.3)] if s > 0 else [(0.0, -2.3), (1.4, -2.0), (1.9, -1.2), (1.9, 0)]
            lathe("hub", "metal", hub, (x, y + s * (hw - 0.6), AXLE_Z), axis="Y", segments=14)
            i += 1

    # ——— Couplers: a beech arm with a round magnet at each end ———
    for s in (-1, 1):
        box("arm", "wood", (8, 6, 4), (s * (L / 2 - 6), 0, DECK), round_=0.8)
        mag = [(0.0, -2), (4.4, -2), (5, -1.4), (5, 1.4), (4.4, 2), (0.0, 2)]
        lathe("magnet", "metal", mag, (s * (L / 2 - 2), 0, DECK), axis="X", segments=24)

    # ——— Boiler: a long drum on a saddle, with a smokebox door and two bands ———
    blen = BOILER_X1 - BOILER_X0
    lathe("boiler", "body", [(BOILER_R, 0), (BOILER_R, blen)], (BOILER_X0, 0, BOILER_Z), axis="X", segments=40)
    box("saddle", "body", (blen - 8, 18, BOILER_R), (BOILER_X0 + blen / 2 + 2, 0, TOP + BOILER_R / 2), round_=1.2)
    for bx in (BOILER_X0 + blen * 0.3, BOILER_X0 + blen * 0.72):
        band = [(BOILER_R - 0.2, -1.6), (BOILER_R + 0.6, -1.4), (BOILER_R + 1.1, -0.7), (BOILER_R + 1.2, 0), (BOILER_R + 1.1, 0.7), (BOILER_R + 0.6, 1.4), (BOILER_R - 0.2, 1.6)]
        lathe("band", "trim", band, (bx, 0, BOILER_Z), axis="X", segments=40, cap=False)
    # Smokebox door: a dark rim and a domed face with a little handle.
    door = [(BOILER_R + 0.4, 0), (BOILER_R + 0.4, 1.2), (BOILER_R - 0.6, 2.0), (BOILER_R - 1.6, 2.2), (8, 3.4), (4, 4.2), (0, 4.4)]
    lathe("smokebox", "metal", door, (BOILER_X1, 0, BOILER_Z), axis="X", segments=40)
    box("door_handle", "trim", (1.4, 1.4, 6), (BOILER_X1 + 4.6, 0, BOILER_Z), round_=0.5, segments=2)

    # ——— Chimney: flared at the foot to sit on the boiler, with a flared cap ———
    chim = [(0.0, 0), (7.0, 0), (5.2, 2.0), (4.2, 4.0), (3.9, 9.0), (4.1, 13.0), (5.6, 15.0), (6.4, 16.6), (6.2, 17.6), (4.6, 17.8), (3.4, 16.2), (0.0, 16.2)]
    lathe("chimney", "metal", chim, (BOILER_X1 - 12, 0, BOILER_Z + BOILER_R - 2.5), segments=32)

    # ——— Steam dome: a bell shape ———
    dome = [(0.0, 0), (8.0, 0), (6.4, 1.6), (5.4, 3.4), (5.2, 6.0), (4.6, 8.4), (3.2, 9.8), (1.4, 10.4), (0.0, 10.5)]
    lathe("dome", "trim", dome, (BOILER_X0 + blen * 0.5, 0, BOILER_Z + BOILER_R - 2.5), segments=32)
    # Safety valve / whistle by the cab.
    whistle = [(0.0, 0), (2.2, 0), (1.2, 1.2), (1.1, 4.5), (1.8, 5.2), (1.8, 6.6), (0.0, 7.0)]
    lathe("whistle", "trim", whistle, (BOILER_X0 + 4, 0, BOILER_Z + BOILER_R - 1), segments=16)

    # ——— Handrails along the boiler ———
    for s in (-1, 1):
        rail = [(0.7, 0), (0.7, blen - 10)]
        lathe("handrail", "metal", rail, (BOILER_X0 + 4, s * (BOILER_R + 1.6), BOILER_Z + 4), axis="X", segments=8)
        for hx in (BOILER_X0 + 8, BOILER_X1 - 10):
            box("stanchion", "metal", (1.0, 2.4, 1.0), (hx, s * (BOILER_R + 0.6), BOILER_Z + 4), round_=0.3, segments=1)

    # ——— Cab: open at the back, a window cut through each side and round spectacles in front ———
    cab_len = CAB_X1 - CAB_X0
    cab = box("cab", "body", (cab_len, W, CAB_TOP - TOP), ((CAB_X0 + CAB_X1) / 2, 0, (TOP + CAB_TOP) / 2), round_=1.6)
    wall = 2.4
    cut(
        cab,
        cutter("cab_inside", (cab_len, W - 2 * wall, CAB_TOP - TOP - 4), ((CAB_X0 + CAB_X1) / 2 - wall, 0, (TOP + CAB_TOP) / 2 + 2 + 0.01)),
        cutter("cab_window", (cab_len * 0.52, W + 4, 11), ((CAB_X0 + CAB_X1) / 2 - 1, 0, CAB_TOP - 10)),
    )
    for s in (-1, 1):
        cut(cab, cutter("spectacle", 8, (CAB_X1, s * 9.5, CAB_TOP - 8), "X", 3.4, 24))
    # Panes: printed-on sky blue, set back in the openings.
    for s in (-1, 1):
        box("pane", "pane", (cab_len * 0.52, 0.6, 11), ((CAB_X0 + CAB_X1) / 2 - 1, s * (W / 2 - wall + 0.4), CAB_TOP - 10), round_=0)
        lathe("pane", "pane", [(0.0, 0), (3.5, 0), (3.5, 0.6), (0.0, 0.6)], (CAB_X1 - wall + 0.3, s * 9.5, CAB_TOP - 8), axis="X", segments=24)
    # A dark floor and back plate inside, so the open cab reads as a room.
    box("cab_floor", "metal", (cab_len - wall - 1, W - 2 * wall - 0.4, 1.2), ((CAB_X0 + CAB_X1) / 2 - wall / 2, 0, TOP + 2.6), round_=0.3, segments=1)
    box("firebox", "metal", (3, 12, 12), (CAB_X1 - wall - 1.6, 0, TOP + 9), round_=0.8)

    # ——— Roof: an arched sheet overhanging the cab front and back ———
    bm = bmesh.new()
    roof_len = cab_len + 8
    span = W + 7
    rise = 3.5
    thick = 2.6
    n = 16
    prof = []
    for k in range(n + 1):
        y = -span / 2 + span * k / n
        z = rise * (1 - (2 * y / span) ** 2)
        prof.append((y, z))
    outer = [(y, z + thick) for y, z in prof]
    loop = prof + outer[::-1]
    front = [bm.verts.new((roof_len / 2, y, z)) for y, z in loop]
    back = [bm.verts.new((-roof_len / 2, y, z)) for y, z in loop]
    m = len(loop)
    for k in range(m):
        j = (k + 1) % m
        bm.faces.new((back[k], back[j], front[j], front[k]))
    bm.faces.new(front)
    bm.faces.new(back[::-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    roof = mesh_object("roof", bm, "trim", ((CAB_X0 + CAB_X1) / 2 - 2, 0, CAB_TOP - 1.4))
    smooth(roof, 30)
    bevel(roof, 0.9, 2, 30)

    # ——— Lamp on the cab roof (it glows to show the lever) ———
    lamp_base = [(0.0, 0), (2.6, 0), (2.6, 1.6), (0.0, 1.6)]
    lathe("lamp_base", "metal", lamp_base, ((CAB_X0 + CAB_X1) / 2 - 2, 0, CAB_TOP + rise + 1), segments=16)
    lamp = [(0.0, 0)] + [(3.2 * math.sin(math.pi * k / 10), 3.2 - 3.2 * math.cos(math.pi * k / 10)) for k in range(1, 10)] + [(0.0, 6.4)]
    lathe("lamp", "lamp", lamp, ((CAB_X0 + CAB_X1) / 2 - 2, 0, CAB_TOP + rise + 1.8), segments=20)

    # ——— Buffer beam and buffers up front ———
    box("buffer_beam", "trim", (4, W, 8), (L / 2 - 9, 0, DECK - 1), round_=1.0)
    for s in (-1, 1):
        buf = [(0.0, 0), (1.6, 0), (1.6, 3.0), (2.8, 3.4), (2.8, 4.4), (0.0, 4.6)]
        lathe("buffer", "metal", buf, (L / 2 - 7, s * 10, DECK + 1), axis="X", segments=16)


def uv_box_project(bm, scale=60.0):
    """Planar UVs from each face's main axis, one texture repeat per `scale` mm: the beech grain at a steady size."""
    uv = bm.loops.layers.uv.verify()
    for f in bm.faces:
        n = f.normal
        ax = max(range(3), key=lambda k: abs(n[k]))
        for loop in f.loops:
            co = loop.vert.co
            u, v = [(co.y, co.z), (co.x, co.z), (co.x, co.y)][ax]
            loop[uv].uv = (u / scale, v / scale)


def bake():
    """Apply every modifier, then merge the parts that never move into one mesh per material."""
    dg = bpy.context.evaluated_depsgraph_get()
    merged = {name: bmesh.new() for name in MATERIALS}
    keep = []
    for obj in list(bpy.context.scene.collection.objects):
        if obj.get("cutter"):
            continue
        me = bpy.data.meshes.new_from_object(obj.evaluated_get(dg))
        mat = obj.data.materials[0].name
        if obj.name.startswith("wheel_") or obj.name == "lamp":
            me.materials.clear()
            me.materials.append(bpy.data.materials[mat])
            keep.append((obj.name, me, obj.location.copy()))
            continue
        me.transform(obj.matrix_world)
        merged[mat].from_mesh(me)
        bpy.data.meshes.remove(me)
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj)
    # Free the old parts' names, so the wheels and lamp keep theirs (the game finds them by name).
    kept = {me for _, me, _ in keep}
    for me in list(bpy.data.meshes):
        if me not in kept:
            bpy.data.meshes.remove(me)
    out = []
    for name, me, loc in keep:
        bm = bmesh.new()
        bm.from_mesh(me)
        bpy.data.meshes.remove(me)
        uv_box_project(bm)
        obj = mesh_object(name, bm, bpy.data.materials[bm_mat(name)].name, loc)
        out.append(obj)
    for mat, bm in merged.items():
        if not bm.faces:
            bm.free()
            continue
        uv_box_project(bm)
        out.append(mesh_object(f"engine_{mat}", bm, mat))
    return out


def bm_mat(name):
    return "wheel" if name.startswith("wheel_") else "lamp"


def main():
    reset()
    build()
    # The .blend keeps the parts separate, with their bevels and cuts still live, to tweak by hand.
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, "engine.blend"))
    os.makedirs(os.path.join(HERE, "out"), exist_ok=True)
    parts = bake()
    tris = 0
    for obj in parts:
        obj.data.calc_loop_triangles()
        tris += len(obj.data.loop_triangles)
    print(f"engine: {len(parts)} meshes, {tris} triangles")
    bpy.ops.export_scene.gltf(
        filepath=os.path.join(HERE, "out", "engine.glb"),
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


main()
