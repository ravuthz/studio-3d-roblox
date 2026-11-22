"""Build the "pixar-disney" style: soft, round, big-headed characters with their own
animations, a pastel cottage town and pastel versions of the shared sets
(see analysis/styles/pixar-disney/STYLE.md).

It keeps the same contract as the roblox style, so the engine can drive either: the same
8 bones, clip names, material names, M_Hair_* / M_Fit_* / M_Face / M_Chest object names,
set object names and town layout.

Run headless (or `npm run film assets pixar-disney`); writes character.glb, town.glb, sets.glb:
  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
      -P core/styles/pixar-disney/build.py -- core/styles/pixar-disney/assets

Every character shape is a convex hull of a few spheres (a tapered capsule, a pear, a head
with cheeks), so nothing is sculpted by hand. Blender is Z-up, the character faces -Y.
"""
import importlib.util
import math
import os
import sys

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector
from mathutils.bvhtree import BVHTree

# shared helpers come from the roblox style's builder (its own builds only run under __main__)
_spec = importlib.util.spec_from_file_location(
    "roblox_build", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "roblox", "build.py"))
B = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(B)

OUT = os.path.abspath(sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else "core/styles/pixar-disney/assets")
os.makedirs(OUT, exist_ok=True)
B.OUT = OUT  # the shared set builder writes where this style's files go
HIP = 1.45  # hip height; the roblox rig's is 2, and the clips' hip offsets are scaled to match

BONES = {  # name: (head, parent)
    "Root": ((0, 0, 0), None),
    "Hips": ((0, 0, HIP), "Root"),
    "Torso": ((0, 0, HIP + 0.05), "Hips"),
    "Head": ((0, 0, 2.9), "Torso"),
    "ArmL": ((0.84, 0, 2.58), "Torso"),
    "ArmR": ((-0.84, 0, 2.58), "Torso"),
    "LegL": ((0.37, 0, HIP), "Hips"),
    "LegR": ((-0.37, 0, HIP), "Hips"),
}

# a sphere is (radius, centre, scale=(1, 1, 1), rotation=(0, 0, 0))
HEAD = [(1.1, (0, 0.02, 3.98)),                       # cranium
        (0.62, (0.47, -0.34, 3.52)), (0.62, (-0.47, -0.34, 3.52)),   # cheeks
        (0.4, (0, -0.4, 3.24))]                       # small chin
TORSO = [(0.8, (0, -0.03, 1.88), (1, 0.84, 0.92)),    # belly
         (0.58, (0, 0, 2.5), (1.08, 0.86, 0.8))]      # chest


def sphere_bm(parts, sub):
    """bmesh with the convex hull of the given spheres."""
    co = []
    for p in parts:
        r, c = p[0], p[1]
        s = p[2] if len(p) > 2 else (1, 1, 1)
        rot = p[3] if len(p) > 3 else (0, 0, 0)
        tb = bmesh.new()
        bmesh.ops.create_icosphere(tb, subdivisions=sub, radius=r)
        m = Matrix.Translation(Vector(c)) @ Euler(rot, "XYZ").to_matrix().to_4x4() @ Matrix.Diagonal((*s, 1))
        co += [m @ v.co for v in tb.verts]
        tb.free()
    hb = bmesh.new()
    for c in co:
        hb.verts.new(c)
    bmesh.ops.convex_hull(hb, input=list(hb.verts))
    bmesh.ops.delete(hb, geom=[v for v in hb.verts if not v.link_faces], context="VERTS")
    bmesh.ops.recalc_face_normals(hb, faces=list(hb.faces))
    return hb


class Soft(B.Builder):
    def hull(self, parts, m, sub=3):
        self._merge(sphere_bm(parts, sub), m)

    def ball(self, r, c, m, s=(1, 1, 1), rot=(0, 0, 0), sub=3):
        self.hull([(r, c, s, rot)], m, sub)

    def limb(self, a, ra, b, rb, m, sub=3):
        """tapered capsule from point a (radius ra) to point b (radius rb)"""
        self.hull([(ra, a), (rb, b)], m, sub)

    def patch(self, parts, centre, th, ph, m, n=20, lift=0.02):
        """A decal that wraps the surface of the given hull: a grid of rays from `centre`,
        th degrees to each side and ph = (down, up) degrees, with a 0..1 UV."""
        hb = sphere_bm(parts, 4)
        tree = BVHTree.FromBMesh(hb)
        c = Vector(centre)
        grid = []
        for j in range(n + 1):
            row = []
            for i in range(n + 1):
                u, v = i / n, j / n
                a, e = math.radians(-th + 2 * th * u), math.radians(ph[0] + (ph[1] - ph[0]) * v)
                d = Vector((math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e)))
                hit = tree.ray_cast(c + d * 6, -d)[0]
                row.append((self.bm.verts.new(hit + d * lift), (u, v)))
            grid.append(row)
        hb.free()
        mi = self._mi(m)
        for j in range(n):
            for i in range(n):
                q = [grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]]
                f = self.bm.faces.new([x[0] for x in q])
                f.material_index = mi
                f.smooth = True
                for loop, x in zip(f.loops, q):
                    loop[self.uv].uv = x[1]


def build_character():
    B.reset()
    mat = B.mat
    arm_data = bpy.data.armatures.new("Rig")
    rig = bpy.data.objects.new("Rig", arm_data)
    bpy.context.scene.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="EDIT")
    for name, (head, parent) in BONES.items():
        b = arm_data.edit_bones.new(name)
        b.head = head
        b.tail = (head[0], head[1], head[2] + 0.5)
        b.align_roll(Vector((0, -1, 0)))
        if parent:
            b.parent = arm_data.edit_bones[parent]
    bpy.ops.object.mode_set(mode="OBJECT")

    skin, shirt, pants = mat("Skin", "#f2c9a0"), mat("Shirt", "#e9e9ee"), mat("Pants", "#2f3a56")
    shoes, hair = mat("Shoes", "#f4f4f4"), mat("Hair", "#2a2440")
    hair2, acc = mat("HairStreak", "#ffffff"), mat("Acc", "#ffd23c")
    face, chest = mat("Face", "#ffffff"), mat("Chest", "#ffffff")
    sleeve, forearm, cuff = mat("Sleeve", "#e9e9ee"), mat("Forearm", "#e9e9ee"), mat("Cuff", "#c9c9d2")
    collar, belt, shin = mat("Collar", "#c9c9d2"), mat("Belt", "#2a2422"), mat("Shin", "#2f3a56")
    hem, sole, inner = mat("PantsHem", "#262f46"), mat("Sole", "#f4f1ea"), mat("Inner", "#f4f1ea")
    skirt, pack = mat("Skirt", "#6b4fa0"), mat("Pack", "#e76f51")

    def part(name, bone, fn):
        b = Soft("M_" + name)
        fn(b)
        ob = b.finish()
        vg = ob.vertex_groups.new(name=bone)
        vg.add(range(len(ob.data.vertices)), 1.0, "REPLACE")
        ob.parent = rig
        ob.modifiers.new("Armature", "ARMATURE").object = rig
        return ob

    # ------------------------------------------------------------- body
    part("Torso", "Torso", lambda b: b.hull(TORSO, shirt, 4))
    part("Chest", "Torso", lambda b: b.patch(TORSO, (0, 0, 2.12), 36, (-30, 30), chest))
    part("Hips", "Hips", lambda b: b.ball(0.78, (0, -0.01, 1.52), pants, (1, 0.84, 0.6), sub=4))

    def head(b):
        b.hull(HEAD, skin, 4)
        b.ball(0.3, (0, 0, 2.92), skin, (1, 1, 0.8))                       # neck
        for sx in (-1, 1):
            b.ball(0.26, (sx * 1.09, 0.1, 3.74), skin, (0.5, 0.8, 1))       # ears
        b.ball(0.115, (0, -1.1, 3.6), skin, (1.1, 0.8, 0.85))               # button nose
    part("Head", "Head", head)
    # the face wraps the front of the head: eyes, brows, mouth and blush are drawn on it
    part("Face", "Head", lambda b: b.patch(HEAD, (0, 0, 3.72), 62, (-42, 42), face, n=28))

    for side, sx in (("L", 1), ("R", -1)):
        def arm(b, sx=sx):
            b.limb((sx * 0.86, 0, 2.54), 0.31, (sx * 1.04, 0, 2.08), 0.28, sleeve)
            b.limb((sx * 1.04, 0, 2.08), 0.25, (sx * 1.15, -0.02, 1.64), 0.22, forearm)
            b.hull([(0.27, (sx * 1.19, -0.04, 1.4)), (0.2, (sx * 1.2, -0.06, 1.22)),   # mitten hand
                    (0.11, (sx * 1.02, -0.2, 1.36))], skin)                          # thumb
        part("Arm" + side, "Arm" + side, arm)
        part("Fit_Short_Arm" + side, "Arm" + side,   # sleeve hem of a T-shirt
             lambda b, sx=sx: b.ball(0.31, (sx * 1.045, 0, 2.07), cuff, (1, 1, 0.3), (0, sx * -0.37, 0)))
        part("Fit_Long_Arm" + side, "Arm" + side,    # cuff at the wrist
             lambda b, sx=sx: b.ball(0.26, (sx * 1.15, -0.02, 1.64), cuff, (1, 1, 0.34), (0, sx * -0.24, 0)))

    for side, sx in (("L", 1), ("R", -1)):
        def leg(b, sx=sx):
            x = sx * 0.37
            b.limb((x, 0, 1.4), 0.37, (x, 0, 0.94), 0.32, pants)
            b.limb((x, 0, 0.94), 0.29, (x, 0, 0.5), 0.26, shin)
            b.hull([(0.3, (x, 0.1, 0.32)), (0.27, (x, -0.36, 0.29), (1.05, 1, 0.9))], shoes)
            b.hull([(0.3, (x, 0.1, 0.1), (1.04, 1.04, 0.3)), (0.28, (x, -0.38, 0.1), (1.08, 1.04, 0.3))], sole)
            b.ball(0.2, (x, -0.52, 0.2), sole, (1.1, 0.7, 0.75))            # toe cap
        part("Leg" + side, "Leg" + side, leg)
        part("Fit_Shorts_Leg" + side, "Leg" + side,
             lambda b, sx=sx: b.ball(0.345, (sx * 0.37, 0, 0.93), hem, (1, 1, 0.26)))

    # --- clothing pieces: M_Fit_<Tag>_*; a character shows the tags listed in its "fit"
    def fit_collar(b):    # shirt collar: a band and two flaps
        b.ball(0.45, (0, 0, 2.86), collar, (1.04, 0.88, 0.3))
        for sx in (-1, 1):
            b.ball(0.23, (sx * 0.2, -0.4, 2.76), collar, (1, 0.35, 0.62), (0.25, sx * 0.5, 0))

    def fit_belt(b):
        b.ball(0.8, (0, -0.02, 1.62), belt, (1.0, 0.85, 0.13), sub=4)
        b.ball(0.13, (0, -0.68, 1.62), acc, (1.2, 0.5, 0.9))

    def fit_hood(b):      # hood resting on the back, and two drawstrings
        b.ball(0.56, (0, 0.46, 2.74), shirt, (1.2, 0.72, 0.8))
        for sx in (-1, 1):
            b.limb((sx * 0.16, -0.47, 2.72), 0.035, (sx * 0.2, -0.6, 2.36), 0.035, sole, 2)

    def fit_jacket(b):    # open front: the shirt underneath and two lapels
        b.patch(TORSO, (0, 0, 2.12), 9, (-33, 34), inner, n=10, lift=0.012)
        for sx in (-1, 1):
            b.ball(0.3, (sx * 0.23, -0.5, 2.52), collar, (0.6, 0.22, 1.0), (0.2, sx * 0.3, sx * -0.35))

    def fit_tie(b):
        b.ball(0.12, (0, -0.5, 2.72), acc, (1.1, 0.7, 0.9))
        b.patch(TORSO, (0, 0, 2.12), 5.5, (-14, 27), acc, n=8, lift=0.03)

    def fit_scarf(b):
        b.ball(0.5, (0, 0, 2.86), acc, (1.12, 1.0, 0.4))
        b.limb((0.3, -0.5, 2.78), 0.15, (0.36, -0.68, 2.3), 0.13, acc)

    def fit_pack(b):      # backpack with front straps
        b.ball(0.62, (0, 0.74, 2.2), pack, (1.0, 0.6, 1.08))
        b.ball(0.3, (0, 1.06, 2.0), acc, (1.1, 0.4, 0.8))
        for sx in (-1, 1):
            b.limb((sx * 0.42, -0.47, 2.78), 0.07, (sx * 0.52, -0.66, 1.9), 0.07, pack, 2)

    for tag, fn in (("Crew", lambda b: b.ball(0.44, (0, 0, 2.86), collar, (1.02, 0.86, 0.3))),
                    ("Collar", fit_collar), ("Belt", fit_belt), ("Hood", fit_hood), ("Jacket", fit_jacket),
                    ("Tie", fit_tie), ("Scarf", fit_scarf), ("Pack", fit_pack)):
        part("Fit_%s_Torso" % tag, "Torso", fn)
    part("Fit_Skirt_Hips", "Hips", lambda b: b.hull(
        [(0.62, (0, -0.01, 1.62), (1.22, 1.05, 0.3)), (1.0, (0, -0.01, 1.02), (1.05, 0.95, 0.12))], skirt, 4))

    # ------------------------------------------------------------- hair
    def hair_zero(b):  # short and messy: a cap, a side-swept fringe and a tuft on the crown
        b.ball(1.13, (0, 0.13, 4.1), hair, (1.0, 1.0, 1.0), sub=4)
        for sx in (-1, 1):                                        # sides, down to the ears
            b.ball(0.5, (sx * 0.9, 0.12, 4.3), hair, (0.5, 1.2, 0.9), (0, sx * 0.2, 0))
        # fringe: soft overlapping locks swept to the left, hugging the forehead
        for x, z, tilt, s in ((-0.74, 4.5, 0.75, 0.9), (-0.36, 4.62, 0.5, 1.05), (0.08, 4.66, 0.3, 1.1),
                              (0.5, 4.6, 0.05, 1.0), (0.82, 4.44, -0.5, 0.85)):
            y = -math.sqrt(max(0.05, 1.1 ** 2 - x * x - (z - 3.98) ** 2)) - 0.02
            b.ball(0.4 * s, (x, y, z), hair, (0.95, 0.42, 0.62), (0.45, tilt, 0), sub=4)
        for x, y, z, rx, ry, s in ((0.1, -0.25, 5.08, -0.75, 0.5, 1.0), (-0.3, 0.05, 5.12, -0.3, -0.6, 0.95),
                                   (0.35, 0.3, 5.1, 0.35, 0.6, 0.9)):
            b.ball(0.36 * s, (x, y, z), hair, (0.7, 0.7, 1.0), (rx, ry, 0), sub=4)
    def cap(b, m, r=1.13):   # the smooth cap every hairstyle starts from
        b.ball(r, (0, 0.13, 4.1), m, sub=4)
        for sx in (-1, 1):
            b.ball(0.5, (sx * 0.9, 0.12, 4.3), m, (0.5, 1.2, 0.9), (0, sx * 0.2, 0))

    def front(x, z, out=0.0):  # a point on the forehead
        return -math.sqrt(max(0.05, 1.1 ** 2 - x * x - (z - 3.98) ** 2)) - 0.02 - out

    def hair_zeebra(b):  # a tall quiff with a white streak, and headphones
        cap(b, hair)
        for x, m, s in ((-0.42, hair, 0.95), (0.0, hair, 1.1), (0.4, hair2, 0.9)):
            b.ball(0.46 * s, (x, front(x, 4.72) + 0.1, 4.8), m, (0.8, 0.7, 1.05), (-0.35, x * 0.5, 0), sub=4)
        b.ball(0.4, (0.4, -0.1, 5.1), hair2, (0.6, 1.3, 0.6), sub=4)
        pts = [(1.3 * math.sin(a), 0.1, 4.0 + 1.3 * math.cos(a)) for a in [math.radians(d) for d in range(-78, 79, 13)]]
        for p0, p1 in zip(pts, pts[1:]):
            b.limb(p0, 0.09, p1, 0.09, acc, 2)
        for sx in (-1, 1):
            b.ball(0.4, (sx * 1.2, 0.1, 3.78), acc, (0.5, 1, 1.1))

    def hair_luna(b):  # long hair to the shoulders, a swept fringe and a moon clip
        cap(b, hair)
        b.hull([(1.1, (0, 0.3, 3.9)), (0.8, (0, 0.52, 3.0), (1.25, 0.6, 1))], hair, 4)
        for sx in (-1, 1):
            b.hull([(0.36, (sx * 1.0, -0.12, 4.2), (0.6, 1, 1)), (0.3, (sx * 1.08, -0.22, 3.2), (0.6, 1, 1))], hair)
        for x, z, tilt, s in ((-0.7, 4.52, 0.8, 0.95), (-0.25, 4.66, 0.55, 1.15), (0.3, 4.66, 0.3, 1.1), (0.78, 4.48, -0.6, 0.9)):
            b.ball(0.42 * s, (x, front(x, z), z), hair, (1.0, 0.42, 0.6), (0.45, tilt, 0), sub=4)
        b.ball(0.2, (0.78, front(0.78, 4.5, 0.2), 4.5), acc, (1, 0.5, 1))

    def hair_zip(b):  # short hair under a cap with a brim
        cap(b, hair, 1.12)
        b.ball(1.12, (0, 0.02, 4.34), acc, (1.02, 1.04, 0.86), sub=4)
        b.ball(0.78, (0, -1.24, 4.5), acc, (1.0, 0.75, 0.13), (0.12, 0, 0), sub=4)
        b.ball(0.13, (0, -1.08, 4.72), hair2, (1.3, 0.5, 1))

    def hair_zark(b):  # two antennae with glowing tips
        for sx in (-1, 1):
            b.limb((sx * 0.4, 0.05, 4.9), 0.08, (sx * 0.62, 0.05, 5.75), 0.06, hair, 2)
            b.ball(0.2, (sx * 0.64, 0.05, 5.86), acc)

    def hair_mayor(b):  # grey hair at the sides and a top hat
        for sx in (-1, 1):
            b.ball(0.5, (sx * 0.9, 0.16, 4.24), hair2, (0.5, 1.25, 0.9), (0, sx * 0.2, 0))
        b.ball(1.08, (0, 0.3, 4.0), hair2, (1.0, 0.9, 0.9), sub=4)
        b.ball(1.5, (0, 0.05, 4.92), hair, (1, 1, 0.07), sub=4)                       # brim
        b.hull([(0.92, (0, 0.05, 5.02), (1, 1, 0.12)), (0.98, (0, 0.05, 6.0), (1, 1, 0.12))], hair, 4)
        b.ball(0.96, (0, 0.05, 5.16), acc, (1, 1, 0.16), sub=4)                       # band

    def fringe(b, locks, m=None):   # soft locks hugging the forehead: (x, z, tilt, size)
        for x, z, tilt, k in locks:
            b.ball(0.42 * k, (x, front(x, z), z), m or hair, (1.0, 0.42, 0.6), (0.45, tilt, 0), sub=4)

    def hair_bo(b):  # dad: a thick side part with a swept front wave and silver temples
        cap(b, hair)
        fringe(b, ((-0.66, 4.6, 0.3, 0.9), (-0.2, 4.76, 0.1, 1.2), (0.34, 4.74, -0.25, 1.15), (0.78, 4.52, -0.6, 0.9)))
        b.ball(0.5, (0.2, -0.5, 5.0), hair, (1.5, 0.9, 0.6), (-0.3, -0.2, 0), sub=4)      # the wave
        for sx in (-1, 1):
            b.ball(0.3, (sx * 1.02, -0.22, 4.28), hair2, (0.4, 0.9, 0.8))

    def hair_mira(b):  # mum: a high bun in a scrunchie, side-swept bangs and a warm highlight
        cap(b, hair)
        fringe(b, ((-0.72, 4.5, 0.8, 0.95), (-0.28, 4.66, 0.6, 1.15), (0.26, 4.68, 0.4, 1.1), (0.76, 4.5, -0.5, 0.9)))
        fringe(b, ((-0.1, 4.78, 0.5, 0.6),), hair2)
        b.ball(0.5, (0, 0.25, 5.22), acc, (1, 1, 0.34), sub=4)
        b.ball(0.52, (0, 0.27, 5.6), hair, (1.05, 1.0, 0.9), sub=4)
        b.ball(0.24, (0.2, 0.08, 5.78), hair2, (1.1, 0.9, 0.7))

    def hair_pip(b):  # kid: a fluffy curly mop with highlight puffs
        cap(b, hair)
        puffs = ((-0.6, -0.72, 4.72), (-0.15, -0.9, 4.86), (0.34, -0.86, 4.84), (0.76, -0.6, 4.66),
                 (-0.46, -0.44, 5.14), (0.04, -0.5, 5.24), (0.52, -0.38, 5.12), (-0.3, 0.1, 5.34), (0.3, 0.14, 5.36),
                 (-0.86, -0.1, 4.82), (0.9, -0.06, 4.8), (-0.6, 0.5, 5.1), (0.02, 0.6, 5.2), (0.62, 0.52, 5.08))
        for i, (x, y, z) in enumerate(puffs):
            b.ball(0.4, (x, y, z), hair2 if i in (2, 5, 8) else hair, (1.05, 1.0, 0.92))

    def hair_kai(b):  # a middle part with curtain bangs, a layered crown and a cool side streak
        cap(b, hair)
        fringe(b, ((-0.74, 4.46, 0.9, 0.95), (-0.38, 4.7, 0.7, 1.15), (0.38, 4.7, -0.7, 1.15), (0.74, 4.46, -0.9, 0.95)))
        fringe(b, ((0.62, 4.6, -0.8, 0.55),), hair2)
        for sx in (-1, 1):
            b.ball(0.5, (sx * 0.4, -0.05, 5.02), hair, (1.0, 1.5, 0.5), (0, sx * 0.3, 0), sub=4)
        b.ball(0.26, (0.56, -0.05, 5.1), hair2, (0.5, 1.6, 0.5), (0, 0.3, 0))

    def hair_nova(b):  # a chin-length bob with dipped tips and two half-up space buns
        cap(b, hair)
        b.hull([(1.12, (0, 0.28, 3.9)), (0.86, (0, 0.5, 3.3), (1.3, 0.6, 1))], hair, 4)
        b.ball(0.5, (0, 0.62, 3.0), hair2, (2.1, 0.7, 0.5), sub=4)
        for sx in (-1, 1):
            b.hull([(0.36, (sx * 1.0, -0.1, 4.2), (0.6, 1, 1)), (0.32, (sx * 1.1, -0.18, 3.5), (0.6, 1, 1))], hair)
            b.ball(0.3, (sx * 1.14, -0.2, 3.3), hair2, (0.7, 1.1, 0.7))
            b.ball(0.3, (sx * 0.56, 0.06, 5.12), acc, (1, 1, 0.34))
            b.ball(0.4, (sx * 0.6, 0.06, 5.42), hair, (1.0, 0.96, 0.92), sub=4)
        fringe(b, ((-0.4, 4.66, 0.3, 1.1), (0.4, 4.66, -0.3, 1.1)))

    # every hairstyle the roblox style has: a cast entry names one with hair: "<Name>"
    for name, fn in (("Zero", hair_zero), ("Zeebra", hair_zeebra), ("Luna", hair_luna), ("Zip", hair_zip),
                     ("Zark", hair_zark), ("Mayor", hair_mayor), ("Bo", hair_bo), ("Mira", hair_mira),
                     ("Pip", hair_pip), ("Kai", hair_kai), ("Nova", hair_nova)):
        part("Hair_" + name, "Head", fn)

    B.bake_clips(rig, HIP / 2, clips=soft_clips())
    B.export(os.path.join(OUT, "character.glb"), True)


def soft_clips():
    """This style's own acting: small children, so everything bounces, waddles and tilts.
    Same clip names and lengths as the roblox set. The head is wider than the shoulders, so a
    raised arm stops at about 2 radians and comes a little forward."""
    S, C, P = math.sin, math.cos, math.tau

    def idle(u):
        s = S(P * u)
        return {"Hips": {"loc": (0, 0.04 * s, 0), "rot": (0, 0, 0.03 * s)}, "Torso": (0.03 * s, 0, 0.02 * S(P * u + 1)),
                "Head": (0.03 * S(P * u + 1), 0.06 * s, 0.07 * S(P * u + 0.5)),
                "ArmL": (0.05 * s, 0, 0.16 + 0.05 * s), "ArmR": (0.05 * s, 0, -0.16 - 0.05 * s)}

    def walk(u):  # a waddle: the hips roll, the arms stay out for balance
        s, c = S(P * u), C(P * u)
        return {"Hips": {"loc": (0, 0.12 * abs(c), 0), "rot": (0, 0.1 * s, 0.12 * s)},
                "Torso": (0.06, -0.12 * s, -0.08 * s), "Head": (-0.04, 0.08 * s, -0.1 * s),
                "LegL": (0.5 * s, 0, 0.05), "LegR": (-0.5 * s, 0, -0.05),
                "ArmL": (-0.35 * s, 0, 0.42 + 0.08 * c), "ArmR": (0.35 * s, 0, -0.42 - 0.08 * c)}

    def run(u):  # leaning in, arms flung back
        s, c = S(P * u), C(P * u)
        return {"Hips": {"loc": (0, 0.22 * abs(c), 0), "rot": (0.16, 0.12 * s, 0.1 * s)},
                "Torso": (0.22, -0.18 * s, 0), "Head": (-0.2, 0.08 * s, 0),
                "LegL": (0.95 * s, 0, 0), "LegR": (-0.95 * s, 0, 0),
                "ArmL": (0.5 + 0.25 * s, 0, 0.75), "ArmR": (0.5 - 0.25 * s, 0, -0.75)}

    def talk(u):
        s, s2 = S(P * u), S(P * 2 * u)
        return {"Hips": {"loc": (0, 0.05 * abs(s), 0)}, "Torso": (0.03 * s2, 0.06 * s, 0),
                "Head": (0.06 * s2, 0.1 * s, 0.06 * s),
                "ArmR": (-0.9 + 0.25 * s2, 0, -0.45 + 0.1 * s), "ArmL": (-0.6 - 0.2 * s2, 0, 0.4 + 0.1 * s)}

    def wave(u):
        s = S(P * 2 * u)
        return {"Hips": {"loc": (0, 0.06 * abs(S(P * u)), 0), "rot": (0, 0, -0.05)}, "Torso": (0, 0, -0.08 + 0.03 * s),
                "Head": (0, 0, -0.14 + 0.04 * s), "ArmR": (-0.3, 0, -1.95 + 0.3 * s), "ArmL": (0, 0, 0.2)}

    def shock(u):  # one-shot, holds the end pose
        k = min(1.0, u / 0.25)
        e = 1 - (1 - k) ** 3
        hop = 0.6 * S(math.pi * min(1.0, u / 0.4)) if u < 0.4 else 0
        w = 0.05 * S(P * 5 * u) * (1 - u)
        return {"Hips": {"loc": (0, hop, 0)}, "Torso": (-0.22 * e + w, 0, 0), "Head": (-0.2 * e, 0, w),
                "ArmL": (-0.3 * e, 0, 1.25 * e), "ArmR": (-0.3 * e, 0, -1.25 * e),
                "LegL": (0.1 * e, 0, 0.14 * e), "LegR": (-0.05 * e, 0, -0.14 * e)}

    def cheer(u):
        a = S(P * u)
        s = abs(a)
        return {"Hips": {"loc": (0, 0.5 * s, 0)}, "Torso": (-0.08, 0, 0.08 * a), "Head": (-0.14, 0, -0.1 * a),
                "ArmL": (-0.3, 0, 1.85 + 0.2 * s), "ArmR": (-0.3, 0, -1.85 - 0.2 * s),
                "LegL": (0.2 * s, 0, 0.1), "LegR": (-0.1 * s, 0, -0.1)}

    def sad(u):
        s = S(P * u)
        return {"Hips": {"loc": (0, -0.05 + 0.02 * s, 0)}, "Torso": (0.2 + 0.02 * s, 0, 0.03 * s),
                "Head": (0.42, 0.06 * s, 0.05 * s), "ArmL": (0.1, 0, 0.05), "ArmR": (0.1, 0, -0.05)}

    def point(u):
        s = S(P * u)
        return {"Hips": {"loc": (0, 0.03 * abs(s), 0)}, "Torso": (-0.04, 0.14, 0), "Head": (-0.06, 0.05, 0),
                "ArmR": (-1.5 + 0.05 * s, 0, -0.15), "ArmL": (0, 0, 0.2)}

    def lookup(u):
        s = S(P * u)
        return {"Hips": {"loc": (0, 0.02 * s, 0)}, "Torso": (-0.12, 0, 0.03 * s),
                "Head": (-0.5 + 0.03 * s, 0, 0.05 * s), "ArmL": (0, 0, 0.22), "ArmR": (0, 0, -0.22)}

    def sit(u):  # legs out in front, rocking a little
        s = S(P * u)
        return {"Hips": {"loc": (0, -1.5, 0)}, "Torso": (0.04 * s, 0, 0.03 * s), "Head": (0.04 * s, 0, 0.06 * S(P * u + 1)),
                "LegL": (-1.5, 0, 0.2), "LegR": (-1.5, 0, -0.2), "ArmL": (-0.45, 0, 0.15), "ArmR": (-0.45, 0, -0.15)}

    def handsup(u):
        s = S(P * u)
        return {"Hips": {"loc": (0, 0.03 * abs(s), 0)}, "Torso": (0.03, 0, 0), "Head": (0.1, 0, 0.05 * s),
                "ArmL": (-0.3, 0, 1.95 + 0.08 * s), "ArmR": (-0.3, 0, -1.95 - 0.08 * s)}

    def reach(u):
        s = S(P * u)
        return {"Hips": {"loc": (0, 0.03 * abs(s), 0)}, "Torso": (0.12, 0, 0), "Head": (-0.06, 0, 0.04 * s),
                "ArmL": (-1.45 + 0.06 * s, 0, -0.1), "ArmR": (-1.45 - 0.06 * s, 0, 0.1)}

    def shiver(u):
        s = S(P * 4 * u)
        return {"Hips": {"loc": (0.04 * s, -0.1, 0)}, "Torso": (0.14, 0.05 * s, 0), "Head": (0.22, -0.06 * s, 0),
                "ArmL": (-0.95, 0, -0.35 + 0.05 * s), "ArmR": (-0.95, 0, 0.35 - 0.05 * s),
                "LegL": (0, 0, -0.06), "LegR": (0, 0, 0.06)}

    def eat(u):
        s = S(P * 3 * u)
        return {"Hips": {"loc": (0, 0.03 * abs(s), 0)}, "Torso": (0.08, 0, 0), "Head": (0.1 + 0.08 * s, 0, 0),
                "ArmR": (-1.75 + 0.4 * s, 0, 0.3), "ArmL": (-1.75 - 0.4 * s, 0, -0.3)}

    def block(u):
        s = S(P * u)
        return {"Hips": {"loc": (0, 0.01 * s, 0)}, "Torso": (-0.03, 0, 0), "Head": (0.04, 0, 0),
                "ArmL": (0, 0, 1.3 + 0.03 * s), "ArmR": (0, 0, -1.3 - 0.03 * s), "LegL": (0, 0, 0.18), "LegR": (0, 0, -0.18)}

    return [("Sit", sit, 60), ("HandsUp", handsup, 60), ("Reach", reach, 60), ("Shiver", shiver, 30),
            ("Eat", eat, 60), ("Block", block, 60), ("Idle", idle, 60), ("Walk", walk, 30), ("Run", run, 20),
            ("Talk", talk, 60), ("Wave", wave, 60), ("Shock", shock, 45), ("Cheer", cheer, 30), ("Sad", sad, 90),
            ("Point", point, 60), ("LookUp", lookup, 60)]


# -------------------------------------------------------------------- town
def build_town():
    """This style's own street: pastel cottages with gable roofs, round trees and globe lamps.
    The layout matches the roblox town (road along Y, facades at x = 13.2, lamps and the tower in
    the same places, the same BoardScreen), so a film's shots work in either style."""
    import random
    B.reset()
    mat = B.mat
    rnd = random.Random(21)
    road, walk, dash = mat("ToyRoad", "#9a94ad", 0.95), mat("ToyWalk", "#f6e9d6", 0.9), mat("ToyDash", "#fff6d0", 0.9)
    curb, grass = mat("ToyCurb", "#e6d5be", 0.9), mat("ToyGrass", "#a4dc7c", 1.0)
    glass = mat("Glass", "#9fd0ee", 0.2, emit="#ffd9a0")
    frame, door = mat("ToyFrame", "#fffaf0", 0.6), mat("ToyDoor", "#7cc6b8", 0.6)
    doors = [door, mat("ToyDoor1", "#f29c8e", 0.6), mat("ToyDoor2", "#8fb7e6", 0.6), mat("ToyDoor3", "#f2c46b", 0.6)]
    trunk = mat("ToyTrunk", "#b98058", 0.9)
    leaves = [mat("ToyLeaf0", "#8fd486", 0.95), mat("ToyLeaf1", "#a9e08c", 0.95), mat("ToyBlossom", "#ffc2d4", 0.95)]
    bush = mat("ToyBush", "#7fc878", 0.95)
    flowers = [mat("ToyFlower0", "#ff8fab", 0.8), mat("ToyFlower1", "#ffd966", 0.8), mat("ToyFlower2", "#ffffff", 0.8)]
    post, lampglow = mat("ToyPost", "#8fa0c8", 0.5), mat("LampGlow", "#fff6d8", 0.4, emit="#ffe2a0")
    box_m, knob = mat("ToyPlanter", "#d9a273", 0.8), mat("ToyKnob", "#ffd23c", 0.3)
    walls = [mat("ToyWall%d" % i, h, 0.9) for i, h in enumerate(
        ["#ffdcc4", "#d3ecd9", "#ffecae", "#e6d6f5", "#cde5f7", "#ffccd8", "#fff5e3"])]
    roofs = [mat("ToyRoof%d" % i, h, 0.8) for i, h in enumerate(["#ee8f7e", "#8fb9dc", "#b596d6", "#7fc49c", "#f4b96c"])]

    g = Soft("Ground")
    L = 90
    g.box((16, 2 * L, 0.2), (0, 0, -0.1), road)
    for sx in (-1, 1):
        g.box((5, 2 * L, 0.5), (sx * 10.5, 0, 0.05), walk, 0.12, 3)
        g.box((0.5, 2 * L, 0.56), (sx * 8.05, 0, 0.06), curb, 0.12, 3)
        g.box((60, 2 * L, 0.2), (sx * 43, 0, -0.05), grass)
    for y in range(-L + 4, L, 8):
        g.box((0.5, 3.2, 0.03), (0, y, 0.012), dash)
    for i in range(7):  # crosswalk near the tower plaza
        g.box((1.2, 4.5, 0.03), (-5.4 + i * 1.8, 34, 0.014), frame)
    g.finish()

    t = Soft("Town")

    def cottage(xs, y, width, depth, floors):
        wall, roof, dr = rnd.choice(walls), rnd.choice(roofs), rnd.choice(doors)
        h = floors * 4.2 + 1.2
        cx, fx, out = xs * (13.2 + depth / 2), xs * 13.2, -xs
        t.box((depth, width, h), (cx, y, h / 2 + 0.2), wall, 0.5, 4)
        ex, wy, top = depth / 2 + 0.8, width / 2 + 0.5, h + 0.25
        t.hull([(0.42, (cx + sx * ex, y + sy * wy, top)) for sx in (-1, 1) for sy in (-1, 1)]
               + [(0.42, (cx, y + sy * wy, top + 3.4)) for sy in (-1, 1)], roof, 2)
        t.box((1.3, 1.3, 2.6), (cx + xs * depth * 0.2, y + width * 0.25, top + 2.6), wall, 0.25, 3)   # chimney
        cols = max(2, int(width // 3.8))
        for f in range(floors):
            z = 3.3 + f * 4.2
            for c in range(cols):
                wy_ = y - width / 2 + (c + 0.5) * width / cols
                if f == 0 and c == cols // 2:   # a round-topped door
                    t.box((0.3, 2.6, 3.4), (fx + out * 0.06, wy_, 1.9), frame, 0.1, 2)
                    t.ball(1.3, (fx + out * 0.06, wy_, 3.5), frame, (0.12, 1, 1))
                    t.box((0.3, 2.0, 3.2), (fx + out * 0.16, wy_, 1.8), dr, 0.08, 2)
                    t.ball(1.0, (fx + out * 0.16, wy_, 3.3), dr, (0.12, 1, 1))
                    t.ball(0.14, (fx + out * 0.36, wy_ + 0.6, 1.9), knob)
                    t.box((1.2, 3.0, 0.3), (fx + out * 0.7, wy_, 0.35), curb, 0.1, 2)   # step
                    continue
                t.box((0.3, 2.3, 2.5), (fx + out * 0.08, wy_, z), frame, 0.12, 3)
                t.box((0.3, 1.8, 2.0), (fx + out * 0.17, wy_, z), glass, 0.06, 2)
                t.box((0.34, 0.14, 2.0), (fx + out * 0.2, wy_, z), frame)
                t.box((0.34, 1.8, 0.14), (fx + out * 0.2, wy_, z), frame)
                t.box((0.6, 2.4, 0.42), (fx + out * 0.36, wy_, z - 1.5), box_m, 0.12, 3)   # flower box
                for i in range(5):
                    t.ball(0.24, (fx + out * 0.42, wy_ - 0.9 + i * 0.45, z - 1.2 + 0.06 * (i % 2)), flowers[(i + c) % 3])
        for sy in (-1, 1):   # bushes by the wall
            by = y + sy * (width / 2 - 1.1)
            t.ball(0.95, (fx + out * 0.8, by, 0.95), bush, (0.9, 1.1, 0.85))
            for i in range(3):
                t.ball(0.17, (fx + out * (1.45 + 0.1 * i), by - 0.5 + i * 0.5, 1.15 + 0.2 * (i % 2)), flowers[i])

    for xs in (-1, 1):
        y = -L + 8
        while y < L - 8:
            width = rnd.choice([9, 10.5, 12])
            cottage(xs, y + width / 2, width, rnd.choice([9, 10, 12]), rnd.choice([1, 2, 2]))
            y += width + rnd.choice([1.0, 2.0, 3.0])
    for xs in (-1, 1):
        for i, y in enumerate(range(-L + 10, L - 6, 18)):
            lx = xs * 8.9
            t.ball(0.45, (lx, y, 0.55), post, (1, 1, 0.6))
            t.limb((lx, y, 0.6), 0.16, (lx, y, 7.3), 0.12, post, 2)
            t.limb((lx, y, 7.3), 0.12, (lx - xs * 1.5, y, 7.75), 0.1, post, 2)
            t.ball(0.55, (lx - xs * 1.5, y, 7.1), lampglow)
            ty, tx = y + 9, xs * 11.6
            lf = leaves[(i + (xs > 0)) % 3]
            t.limb((tx, ty, 0.3), 0.45, (tx, ty, 4.4), 0.32, trunk, 2)
            for dx, dy, dz, r in ((0, 0, 5.8, 2.3), (1.1, 0.7, 6.9, 1.6), (-1.0, -0.6, 6.7, 1.7), (0.2, -0.9, 7.6, 1.3)):
                t.ball(r, (tx + dx, ty + dy, dz), lf, (1, 1, 0.9))
    t.finish()

    b = Soft("Tower")
    stone, body = mat("ToyStone", "#efe3d2", 0.85), mat("ToyTower", "#7a68b8", 0.6)
    b.box((18, 8, 1.0), (0, 46, 0.5), stone, 0.3, 3)
    b.box((11, 4.5, 26), (0, 47, 14), body, 0.7, 4)
    b.box((12.4, 5.4, 1.4), (0, 47, 27.6), stone, 0.45, 3)
    b.box((3, 3, 3.2), (0, 47, 29.8), stone, 0.6, 3)
    b.ball(1.3, (0, 47, 32.2), mat("TowerLight", "#ff5a4a", 0.4, emit="#ff5a4a"))
    b.finish()
    s = B.Builder("BoardScreen")
    y = 47 - 2.25 - 0.06
    s.quad([(-4.8, y, 5.5), (4.8, y, 5.5), (4.8, y, 24.5), (-4.8, y, 24.5)], mat("Screen", "#101018", 0.3))
    s.finish()
    B.export(os.path.join(OUT, "town.glb"), False)


# Colours of the shared sets in this style (bedroom, forest, car, house); the rest keep theirs.
SET_COLOURS = {
    "RoomFloor": "#e6c193", "RoomWall": "#f8e7b8", "RoomWhite": "#fffaf0", "RoomWood": "#cf9a66",
    "Rug": "#a9dccb", "Blanket": "#8fc7ec", "Pillow": "#fffaf0", "ToyBox": "#f7a8b8", "Poster": "#8fb7e6",
    "ForestGround": "#86cf7c", "Dirt": "#c79b74", "Rock": "#c1bccb", "PineTrunk": "#b07a52",
    "Pine0": "#5fbf7a", "Pine1": "#78d088", "Pine2": "#4fae6e",
    "HouseWall": "#ffe6a6", "HouseTrim": "#fffaf0", "HouseRoof": "#ee8f7e", "HouseDoor": "#7cc6b8", "Chimney": "#f2b9a0",
    "Step": "#e6d5be", "CarPaint": "#f29c8e", "Tire": "#4a4a58",
}


def build_sets():
    """The shared sets (bedroom, forest, saucer, car, mothership, family house) rebuilt for this
    style: the same layout and names, with rounder edges and the pastel colours above."""
    mat0, box0 = B.mat, B.Builder.box

    def mat(name, hex_="#ffffff", rough=0.8, emit=None):
        return mat0(name, SET_COLOURS.get(name, hex_), rough, emit)

    def box(self, size, center, m, bevel=0.0, seg=2, rot_z=0.0, rot_x=0.0, rot_y=0.0):
        soft = min(0.45, 0.2 * min(size))
        return box0(self, size, center, m, max(bevel, soft), max(seg, 3), rot_z, rot_x, rot_y)

    B.mat, B.Builder.box = mat, box
    try:
        B.build_sets()
    finally:
        B.mat, B.Builder.box = mat0, box0


if __name__ == "__main__":
    build_character()
    build_town()
    build_sets()
    print("DONE")
