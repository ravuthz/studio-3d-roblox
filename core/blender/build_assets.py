"""Build the pilot's 3D assets procedurally and export them as GLB.

Run headless:
  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
      -P core/blender/build_assets.py -- core/assets

Outputs:
  character.glb  one blocky rig (8 bones), body parts, hair/accessory variants for
                 Zero, Zeebra, Luna and Zip, and baked animation clips
  town.glb       a street set with houses, lamps, trees and a count-board tower
  sets.glb       bedroom, forest, car, ship, the family house
  dog.glb        a blocky four-legged dog with its own rig (7 bones) and clips

Blender is Z-up and the character faces -Y; the glTF exporter converts to Y-up,
so in Three.js the character faces +Z.
"""
import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

OUT = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else "core/assets"
OUT = os.path.abspath(OUT)
os.makedirs(OUT, exist_ok=True)
FPS = 30


# ----------------------------------------------------------------- helpers
def srgb(hex_):
    h = hex_.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c] + [1.0]


_mats = {}


def mat(name, hex_="#ffffff", rough=0.8, emit=None):
    if name in _mats:
        return _mats[name]
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except Exception:
        pass
    bsdf = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = srgb(hex_)
    bsdf.inputs["Roughness"].default_value = rough
    if emit:
        bsdf.inputs["Emission Color"].default_value = srgb(emit)
        bsdf.inputs["Emission Strength"].default_value = 1.0
    _mats[name] = m
    return m


class Builder:
    """Accumulates boxes and blobs into one mesh with several materials."""

    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.new("UVMap")
        self.mats = []

    def _mi(self, m):
        if m not in self.mats:
            self.mats.append(m)
        return self.mats.index(m)

    def _merge(self, tb, m):
        """Copy a finished primitive into the mesh: one material, smooth faces and
        box-projected UVs in studs (1 UV unit = 1 stud), so tiling textures line up
        across neighbouring boxes."""
        tb.normal_update()
        mi = self._mi(m)
        vmap = {v: self.bm.verts.new(v.co) for v in tb.verts}
        for f in tb.faces:
            nf = self.bm.faces.new([vmap[v] for v in f.verts])
            nf.material_index = mi
            nf.smooth = True
            n = f.normal
            ax = max(range(3), key=lambda i: abs(n[i]))
            for loop, src in zip(nf.loops, f.verts):
                c = src.co
                loop[self.uv].uv = (c.x, c.y) if ax == 2 else (c.y, c.z) if ax == 0 else (c.x, c.z)
        tb.free()

    def box(self, size, center, m, bevel=0.0, seg=2, rot_z=0.0, rot_x=0.0, rot_y=0.0):
        tb = bmesh.new()
        r = bmesh.ops.create_cube(tb, size=1.0)
        bmesh.ops.scale(tb, vec=Vector(size), verts=r["verts"])
        if bevel > 0:
            bmesh.ops.bevel(tb, geom=list(tb.edges), offset=bevel, segments=seg,
                            profile=0.5, affect="EDGES")
        rot = Matrix.Rotation(rot_z, 4, "Z") @ Matrix.Rotation(rot_y, 4, "Y") @ Matrix.Rotation(rot_x, 4, "X")
        bmesh.ops.transform(tb, matrix=Matrix.Translation(Vector(center)) @ rot, verts=list(tb.verts))
        self._merge(tb, m)

    def blob(self, radius, center, m, scale=(1, 1, 1), sub=2):
        tb = bmesh.new()
        r = bmesh.ops.create_icosphere(tb, subdivisions=sub, radius=radius)
        bmesh.ops.scale(tb, vec=Vector(scale), verts=r["verts"])
        bmesh.ops.translate(tb, vec=Vector(center), verts=r["verts"])
        self._merge(tb, m)

    def quad(self, corners, m, uv=(0, 0, 1, 1)):
        """corners: bl, br, tr, tl; gets the UV rectangle uv = (u0, v0, u1, v1), 0..1 by default."""
        vs = [self.bm.verts.new(c) for c in corners]
        f = self.bm.faces.new(vs)
        f.material_index = self._mi(m)
        u0, v0, u1, v1 = uv
        for loop, uv in zip(f.loops, [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]):
            loop[self.uv].uv = uv

    def finish(self, collection=None):
        me = bpy.data.meshes.new(self.name)
        self.bm.normal_update()
        self.bm.to_mesh(me)
        self.bm.free()
        for m in self.mats:
            me.materials.append(m)
        me.set_sharp_from_angle(angle=math.radians(50))
        ob = bpy.data.objects.new(self.name, me)
        (collection or bpy.context.scene.collection).objects.link(ob)
        wn = ob.modifiers.new("WeightedNormal", "WEIGHTED_NORMAL")
        wn.keep_sharp = True
        wn.weight = 60
        return ob


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    _mats.clear()
    bpy.context.scene.render.fps = FPS


def export(path, animations):
    bpy.ops.object.select_all(action="SELECT")
    kw = dict(filepath=path, export_format="GLB", use_selection=True, export_apply=True,
              export_yup=True, export_animations=animations, export_skins=True,
              export_materials="EXPORT")
    if animations:
        kw.update(export_animation_mode="NLA_TRACKS", export_force_sampling=True,
                  export_optimize_animation_size=False, export_frame_range=False)
    bpy.ops.export_scene.gltf(**kw)
    print("EXPORTED", path, round(os.path.getsize(path) / 1024), "KB")


# --------------------------------------------------------------- character
BONES = {  # name: (head, parent)
    "Root": ((0, 0, 0), None),
    "Hips": ((0, 0, 2), "Root"),
    "Torso": ((0, 0, 2.05), "Hips"),
    "Head": ((0, 0, 4), "Torso"),
    "ArmL": ((1.5, 0, 3.8), "Torso"),
    "ArmR": ((-1.5, 0, 3.8), "Torso"),
    "LegL": ((0.5, 0, 2), "Hips"),
    "LegR": ((-0.5, 0, 2), "Hips"),
}


def build_character():
    reset()
    arm_data = bpy.data.armatures.new("Rig")
    rig = bpy.data.objects.new("Rig", arm_data)
    bpy.context.scene.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="EDIT")
    for name, (head, parent) in BONES.items():
        b = arm_data.edit_bones.new(name)
        b.head = head
        b.tail = (head[0], head[1], head[2] + 0.5)
        b.align_roll(Vector((0, -1, 0)))  # local Z = character front, local X = world X
        if parent:
            b.parent = arm_data.edit_bones[parent]
    bpy.ops.object.mode_set(mode="OBJECT")

    skin, shirt, pants = mat("Skin", "#f2c9a0"), mat("Shirt", "#e9e9ee"), mat("Pants", "#2f3a56")
    shoes, hair = mat("Shoes", "#f4f4f4"), mat("Hair", "#2a2440")
    hair2, acc = mat("HairStreak", "#ffffff"), mat("Acc", "#ffd23c")
    face, chest = mat("Face", "#ffffff"), mat("Chest", "#ffffff")
    # clothing materials: the engine colours them per character (see makeActor in stage.js)
    sleeve, forearm, cuff = mat("Sleeve", "#e9e9ee"), mat("Forearm", "#e9e9ee"), mat("Cuff", "#c9c9d2")
    collar, belt, shin = mat("Collar", "#c9c9d2"), mat("Belt", "#2a2422"), mat("Shin", "#2f3a56")
    hem, sole, inner = mat("PantsHem", "#262f46"), mat("Sole", "#f4f1ea"), mat("Inner", "#f4f1ea")
    skirt, pack = mat("Skirt", "#6b4fa0"), mat("Pack", "#e76f51")

    def part(name, bone, fn):
        b = Builder("M_" + name)
        fn(b)
        ob = b.finish()
        vg = ob.vertex_groups.new(name=bone)
        vg.add(range(len(ob.data.vertices)), 1.0, "REPLACE")
        ob.parent = rig
        ob.modifiers.new("Armature", "ARMATURE").object = rig
        return ob

    part("Torso", "Torso", lambda b: b.box((2, 1, 2), (0, 0, 3), shirt, 0.09, 3))
    # the chest decal floats in front of the thin clothing pieces (they reach y = -0.55)
    part("Chest", "Torso", lambda b: b.quad(
        [(-0.92, -0.566, 2.08), (0.92, -0.566, 2.08), (0.92, -0.566, 3.92), (-0.92, -0.566, 3.92)], chest))
    part("Head", "Head", lambda b: b.box((1.3, 1.3, 1.2), (0, 0, 4.63), skin, 0.24, 4))
    part("Face", "Head", lambda b: b.quad(
        [(-0.6, -0.662, 4.03), (0.6, -0.662, 4.03), (0.6, -0.662, 5.23), (-0.6, -0.662, 5.23)], face))
    for side, x in (("L", 1.5), ("R", -1.5)):
        def arm(b, x=x):
            b.box((0.96, 0.96, 0.82), (x, 0, 3.59), sleeve, 0.09, 3)
            b.box((0.92, 0.92, 0.7), (x, 0, 2.88), forearm, 0.08, 3)
            b.box((0.9, 0.9, 0.6), (x, 0, 2.3), skin, 0.12, 3)
        part("Arm" + side, "Arm" + side, arm)
        part("Fit_Long_Arm" + side, "Arm" + side,
             lambda b, x=x: b.box((1.0, 1.0, 0.2), (x, 0, 2.66), cuff, 0.05, 2))
        part("Fit_Short_Arm" + side, "Arm" + side,
             lambda b, x=x: b.box((1.02, 1.02, 0.16), (x, 0, 3.24), cuff, 0.05, 2))
    for side, x in (("L", 0.5), ("R", -0.5)):
        def leg(b, x=x):
            b.box((0.96, 0.96, 0.92), (x, 0, 1.59), pants, 0.07, 3)
            b.box((0.93, 0.93, 0.84), (x, 0, 0.75), shin, 0.06, 3)
            b.box((1.0, 1.25, 0.34), (x, -0.12, 0.29), shoes, 0.1, 3)
            b.box((1.05, 1.31, 0.14), (x, -0.12, 0.07), sole, 0.04, 2)
            b.box((1.03, 0.32, 0.24), (x, -0.63, 0.24), sole, 0.08, 2)   # toe cap
            b.box((0.5, 0.34, 0.05), (x, -0.42, 0.47), sole, 0.02, 1)    # laces
        part("Leg" + side, "Leg" + side, leg)
        part("Fit_Shorts_Leg" + side, "Leg" + side,
             lambda b, x=x: b.box((1.0, 1.0, 0.14), (x, 0, 1.17), hem, 0.04, 2))

    # --- clothing pieces: M_Fit_<Tag>_*; a character shows the tags listed in its "fit"
    def fit_crew(b):      # ribbed neckband
        b.box((1.16, 1.07, 0.2), (0, 0, 3.91), collar, 0.05, 2)

    def fit_collar(b):    # shirt collar: two flaps and a back band
        for sx in (-1, 1):
            b.box((0.52, 0.09, 0.36), (sx * 0.3, -0.535, 3.8), collar, 0.03, 2, rot_y=sx * 0.45)
        b.box((1.2, 0.1, 0.3), (0, 0.52, 3.86), collar, 0.03, 2)

    def fit_belt(b):
        b.box((2.05, 1.05, 0.22), (0, 0, 2.12), belt, 0.04, 2)
        b.box((0.36, 0.08, 0.26), (0, -0.55, 2.12), acc, 0.03, 2)

    def fit_hood(b):      # hood on the back, front pocket, drawstrings
        b.box((1.5, 0.46, 0.8), (0, 0.66, 3.62), shirt, 0.2, 3)
        b.box((1.25, 0.08, 0.62), (0, -0.535, 2.6), cuff, 0.03, 2)
        for sx in (-1, 1):
            b.box((0.08, 0.06, 0.55), (sx * 0.24, -0.545, 3.55), sole, 0.02, 1)

    def fit_jacket(b):    # open front: inner shirt strip and lapels
        b.box((0.6, 0.07, 1.92), (0, -0.525, 3.0), inner, 0.02, 1)
        for sx in (-1, 1):
            b.box((0.34, 0.08, 0.9), (sx * 0.42, -0.545, 3.5), collar, 0.03, 2, rot_y=sx * 0.25)

    def fit_tie(b):
        b.box((0.3, 0.07, 0.24), (0, -0.56, 3.8), acc, 0.03, 2)
        b.box((0.26, 0.06, 1.05), (0, -0.56, 3.2), acc, 0.03, 2)

    def fit_scarf(b):
        b.box((1.5, 1.16, 0.3), (0, 0, 3.93), acc, 0.12, 3)
        b.box((0.42, 0.12, 0.85), (0.42, -0.58, 3.45), acc, 0.05, 2)

    def fit_pack(b):      # backpack with front straps
        b.box((1.5, 0.55, 1.6), (0, 0.79, 3.05), pack, 0.18, 3)
        b.box((1.0, 0.14, 0.6), (0, 1.1, 2.7), acc, 0.05, 2)
        for sx in (-1, 1):
            b.box((0.24, 0.06, 1.94), (sx * 0.62, -0.53, 3.02), pack, 0.02, 1)

    for tag, fn in (("Crew", fit_crew), ("Collar", fit_collar), ("Belt", fit_belt), ("Hood", fit_hood),
                    ("Jacket", fit_jacket), ("Tie", fit_tie), ("Scarf", fit_scarf), ("Pack", fit_pack)):
        part("Fit_%s_Torso" % tag, "Torso", fn)
    part("Fit_Skirt_Hips", "Hips", lambda b: b.box((2.2, 1.3, 0.95), (0, 0, 1.66), skirt, 0.14, 3))

    # --- hair and accessories, one object per character, all on the Head bone
    def hair_zero(b):
        b.box((1.44, 1.44, 0.5), (0, 0.02, 5.1), hair, 0.16, 3)
        b.box((1.44, 0.5, 0.9), (0, 0.52, 4.72), hair, 0.14, 3)
        for i, x in enumerate((-0.48, -0.16, 0.16, 0.48)):
            b.box((0.34, 0.26, 0.24 + 0.07 * (i % 2)), (x, -0.62, 4.98 - 0.035 * (i % 2)), hair, 0.07, 2)
        for x, y, rz in ((-0.3, -0.1, 0.5), (0.25, 0.15, -0.4), (0.0, -0.35, 0.2)):
            b.box((0.36, 0.36, 0.42), (x, y, 5.42), hair, 0.1, 2, rot_z=rz, rot_x=0.35)

    def hair_zeebra(b):
        b.box((1.44, 1.44, 0.46), (0, 0.02, 5.1), hair, 0.14, 3)
        b.box((1.44, 0.5, 0.8), (0, 0.52, 4.78), hair, 0.14, 3)
        b.box((1.2, 1.15, 0.42), (0, -0.05, 5.48), hair, 0.12, 3)
        b.box((0.3, 1.2, 0.46), (0.3, -0.07, 5.5), hair2, 0.1, 3)
        b.box((0.3, 0.3, 0.42), (0.3, -0.64, 4.98), hair2, 0.08, 2)
        # headphones
        b.box((1.66, 0.22, 0.2), (0, 0.05, 5.74), acc, 0.07, 2)
        for x in (-0.78, 0.78):
            b.box((0.2, 0.2, 1.0), (x, 0.05, 5.25), acc, 0.07, 2)
            b.box((0.3, 0.62, 0.62), (x * 1.03, 0.05, 4.68), acc, 0.12, 3)

    def hair_luna(b):
        b.box((1.46, 1.46, 0.5), (0, 0.02, 5.1), hair, 0.16, 3)
        b.box((1.5, 0.42, 1.95), (0, 0.6, 4.22), hair, 0.16, 3)
        for x in (-0.7, 0.7):
            b.box((0.3, 0.62, 1.5), (x, 0.12, 4.42), hair, 0.1, 3)
        b.box((0.62, 0.3, 0.3), (-0.3, -0.63, 4.97), hair, 0.08, 2)
        b.box((0.62, 0.3, 0.22), (0.34, -0.63, 5.01), hair, 0.08, 2)
        b.blob(0.2, (0.62, -0.5, 5.12), acc, (1, 0.5, 1))  # moon hair clip

    def hair_zip(b):
        b.box((1.42, 1.42, 0.3), (0, 0.02, 4.95), hair, 0.1, 3)
        b.box((1.42, 0.45, 0.6), (0, 0.52, 4.72), hair, 0.12, 3)
        b.box((1.48, 1.48, 0.46), (0, 0.02, 5.26), acc, 0.18, 3)   # cap
        b.box((1.2, 0.62, 0.12), (0, -0.92, 5.1), acc, 0.05, 2)    # brim
        b.box((0.3, 0.06, 0.2), (0, -0.74, 5.3), hair2, 0.02, 1)   # badge

    def hair_zark(b):  # two antennae with glowing tips
        for sx in (-1, 1):
            b.box((0.16, 0.16, 0.95), (sx * 0.42, 0.05, 5.62), hair, 0.05, 2, rot_z=0, rot_x=0)
            b.blob(0.2, (sx * 0.42, 0.05, 6.18), acc)

    def hair_mayor(b):  # top hat
        b.box((1.42, 1.42, 0.3), (0, 0.02, 4.95), hair2, 0.1, 3)
        b.box((1.42, 0.45, 0.6), (0, 0.52, 4.72), hair2, 0.12, 3)
        b.box((1.95, 1.95, 0.14), (0, 0, 5.3), hair, 0.05, 2)
        b.box((1.25, 1.25, 1.15), (0, 0, 5.92), hair, 0.08, 3)
        b.box((1.3, 1.3, 0.24), (0, 0, 5.5), acc, 0.04, 2)

    def hair_bo(b):  # thick side-parted dad hair with swept front wave and silver temple streaks
        b.box((1.44, 1.44, 0.44), (0, 0.04, 5.12), hair, 0.15, 3)
        b.box((1.44, 0.44, 0.88), (0, 0.54, 4.74), hair, 0.14, 3)
        b.box((1.02, 1.36, 0.34), (0.20, -0.06, 5.38), hair, 0.13, 3, rot_y=-0.12)
        b.box((0.46, 1.32, 0.22), (-0.48, -0.02, 5.30), hair, 0.09, 2, rot_y=0.14)
        b.box((0.88, 0.30, 0.24), (0.18, -0.64, 5.08), hair, 0.09, 2, rot_y=-0.18)
        for sx in (-1, 1):
            b.box((0.20, 0.62, 0.62), (sx * 0.67, 0.16, 4.82), hair, 0.07, 2)
            b.box((0.22, 0.30, 0.26), (sx * 0.68, -0.18, 4.72), hair2, 0.06, 2)
            b.box((0.18, 0.24, 0.34), (sx * 0.67, -0.20, 4.46), hair, 0.05, 2)

    def hair_mira(b):  # warm high top-bun with scrunchie, side-swept bangs and caramel highlight
        b.box((1.44, 1.44, 0.46), (0, 0.04, 5.10), hair, 0.16, 3)
        b.box((1.42, 0.44, 0.96), (0, 0.54, 4.72), hair, 0.14, 3)
        for sx in (-1, 1):
            b.box((0.22, 0.72, 0.78), (sx * 0.67, 0.12, 4.76), hair, 0.08, 2)
            b.box((0.18, 0.24, 0.68), (sx * 0.64, -0.40, 4.62), hair, 0.06, 2)
        b.box((0.92, 0.28, 0.24), (-0.22, -0.63, 5.04), hair, 0.09, 2, rot_y=0.14)
        b.box((0.52, 0.26, 0.20), (0.46, -0.62, 5.07), hair, 0.08, 2, rot_y=-0.16)
        b.box((0.36, 0.28, 0.16), (-0.18, -0.65, 5.14), hair2, 0.06, 2, rot_y=0.14)
        b.box((0.78, 0.78, 0.18), (0, 0.20, 5.38), acc, 0.08, 3)
        b.blob(0.46, (0, 0.22, 5.72), hair, (1.08, 1.0, 0.88), sub=3)
        b.blob(0.24, (0.18, 0.04, 5.84), hair2, (1.1, 0.9, 0.7), sub=2)

    def hair_pip(b):  # playful fluffy curly mop-top with bouncy highlight puffs
        b.box((1.40, 1.40, 0.42), (0, 0.04, 5.06), hair, 0.16, 3)
        b.box((1.42, 0.48, 0.86), (0, 0.52, 4.70), hair, 0.15, 3)
        for cx, cy, cz, r, m in (
            (-0.46, -0.32, 5.26, 0.34, hair), (0.0, -0.44, 5.30, 0.36, hair), (0.46, -0.32, 5.24, 0.33, hair2),
            (-0.34, 0.14, 5.44, 0.38, hair), (0.26, 0.12, 5.46, 0.40, hair), (-0.04, -0.14, 5.52, 0.36, hair2),
            (-0.48, 0.42, 5.20, 0.34, hair), (0.02, 0.48, 5.26, 0.36, hair), (0.48, 0.40, 5.20, 0.34, hair),
        ):
            b.blob(r, (cx, cy, cz), m, (1.05, 1.0, 0.92), sub=2)
        for sx in (-1, 1):
            b.blob(0.28, (sx * 0.66, -0.12, 4.92), hair, (0.85, 1.05, 1.05), sub=2)
            b.blob(0.26, (sx * 0.66, 0.28, 4.78), hair, (0.85, 1.05, 1.05), sub=2)
        b.blob(0.22, (-0.36, -0.60, 5.05), hair, (1.15, 0.85, 0.85), sub=2)
        b.blob(0.23, (0.04, -0.62, 5.07), hair2, (1.15, 0.85, 0.85), sub=2)
        b.blob(0.21, (0.40, -0.58, 5.03), hair, (1.1, 0.85, 0.85), sub=2)

    def hair_kai(b):  # modern middle-parted curtain bangs with layered crown and cool side streak
        b.box((1.48, 1.48, 0.46), (0, 0.04, 5.14), hair, 0.17, 3)
        b.box((1.44, 0.48, 1.04), (0, 0.54, 4.68), hair, 0.15, 3)
        b.box((0.72, 1.38, 0.28), (-0.36, -0.02, 5.36), hair, 0.12, 3, rot_y=0.14)
        b.box((0.72, 1.38, 0.28), (0.36, -0.02, 5.36), hair, 0.12, 3, rot_y=-0.14)
        b.box((0.60, 0.28, 0.30), (-0.42, -0.60, 5.02), hair, 0.10, 2, rot_y=0.28, rot_z=-0.10)
        b.box((0.60, 0.28, 0.30), (0.42, -0.60, 5.02), hair, 0.10, 2, rot_y=-0.28, rot_z=0.10)
        b.box((0.22, 0.26, 0.30), (0.56, -0.58, 5.00), hair2, 0.08, 2, rot_y=-0.28, rot_z=0.10)
        b.box((0.24, 1.24, 0.24), (0.48, -0.04, 5.38), hair2, 0.09, 2, rot_y=-0.14)
        for sx in (-1, 1):
            b.box((0.24, 0.78, 0.94), (sx * 0.69, 0.02, 4.66), hair, 0.09, 2)

    def hair_nova(b):  # flared chin-length bob with dipped tips and twin half-up space-buns
        b.box((1.48, 1.48, 0.46), (0, 0.04, 5.12), hair, 0.16, 3)
        b.box((1.50, 0.46, 1.15), (0, 0.56, 4.62), hair, 0.15, 3)
        b.box((1.66, 0.56, 0.34), (0, 0.60, 4.10), hair2, 0.13, 3)
        for sx in (-1, 1):
            b.box((0.28, 0.86, 1.02), (sx * 0.72, -0.04, 4.62), hair, 0.10, 3)
            b.box((0.36, 0.76, 0.34), (sx * 0.80, -0.06, 4.12), hair2, 0.12, 3, rot_y=-sx * 0.26)
        b.box((0.62, 0.26, 0.24), (-0.34, -0.62, 5.04), hair, 0.08, 2, rot_y=0.12)
        b.box((0.62, 0.26, 0.24), (0.34, -0.62, 5.04), hair, 0.08, 2, rot_y=-0.12)
        for sx in (-1, 1):
            b.box((0.46, 0.46, 0.15), (sx * 0.46, 0.04, 5.38), acc, 0.06, 2, rot_y=-sx * 0.20)
            b.blob(0.35, (sx * 0.50, 0.04, 5.65), hair, (1.0, 0.96, 0.92), sub=3)

    # HAIR STYLES: name -> builder. To add one, write hair_<name>(b) above (boxes and blobs on the
    # head; the head box spans x/y -0.65..0.65 and z 4.03..5.23, front is -y; use the materials
    # hair, hair2 (HairStreak) and acc), add it here, run `npm run film assets`, then set
    # hair: "<Name>" on a cast entry in core/engine/stage.js.
    HAIR_STYLES = {
        "Zero": hair_zero, "Zeebra": hair_zeebra, "Luna": hair_luna, "Zip": hair_zip,
        "Zark": hair_zark, "Mayor": hair_mayor,
        "Bo": hair_bo, "Mira": hair_mira, "Pip": hair_pip, "Kai": hair_kai, "Nova": hair_nova,
    }
    for name, fn in HAIR_STYLES.items():
        part("Hair_" + name, "Head", fn)

    bake_clips(rig)
    export(os.path.join(OUT, "character.glb"), True)


def bake_clips(rig):
    """Each clip is a pose function of normalised time u in [0, 1)."""
    S, C, PI2 = math.sin, math.cos, math.tau

    def idle(u):
        s = S(PI2 * u)
        return {"Hips": {"loc": (0, 0.03 * s, 0)}, "Torso": (0.015 * s, 0, 0),
                "Head": (0.02 * S(PI2 * u + 1), 0.04 * S(PI2 * u), 0),
                "ArmL": (0, 0, 0.06 + 0.02 * s), "ArmR": (0, 0, -0.06 - 0.02 * s)}

    def walk(u):
        s = S(PI2 * u)
        return {"Hips": {"loc": (0, 0.09 * abs(C(PI2 * u)), 0), "rot": (0, 0.06 * s, 0)},
                "Torso": (0.05, -0.1 * s, 0), "Head": (-0.03, 0.06 * s, 0),
                "LegL": (0.62 * s, 0, 0), "LegR": (-0.62 * s, 0, 0),
                "ArmL": (-0.55 * s, 0, 0.05), "ArmR": (0.55 * s, 0, -0.05)}

    def run(u):
        s = S(PI2 * u)
        return {"Hips": {"loc": (0, 0.18 * abs(C(PI2 * u)), 0), "rot": (0.1, 0.1 * s, 0)},
                "Torso": (0.2, -0.16 * s, 0), "Head": (-0.14, 0.08 * s, 0),
                "LegL": (1.0 * s, 0, 0), "LegR": (-1.0 * s, 0, 0),
                "ArmL": (-1.0 * s - 0.2, 0, 0.1), "ArmR": (1.0 * s - 0.2, 0, -0.1)}

    def talk(u):
        s, s2 = S(PI2 * u), S(PI2 * 2 * u)
        return {"Hips": {"loc": (0, 0.03 * s, 0)}, "Torso": (0.02 * s2, 0.05 * s, 0),
                "Head": (0.05 * s2, 0.09 * s, 0.03 * s),
                "ArmR": (-0.75 + 0.18 * s2, 0, -0.22 + 0.06 * s),
                "ArmL": (-0.12 + 0.05 * s, 0, 0.08)}

    def wave(u):
        s = S(PI2 * 2 * u)
        return {"Hips": {"loc": (0, 0.03 * S(PI2 * u), 0)}, "Torso": (0, 0, -0.04),
                "Head": (0, 0, -0.08 + 0.02 * s),
                "ArmR": (0, 0, -2.55 + 0.38 * s), "ArmL": (0, 0, 0.08)}

    def shock(u):  # one-shot, holds the end pose
        k = min(1.0, u / 0.25)
        e = 1 - (1 - k) ** 3
        over = 1 + 0.25 * S(math.pi * k) * (1 - k)
        hop = 0.45 * S(math.pi * min(1.0, u / 0.45)) if u < 0.45 else 0
        w = 0.03 * S(PI2 * 6 * u) * (1 - u)
        return {"Hips": {"loc": (0, hop, 0)}, "Torso": (-0.2 * e * over + w, 0, 0),
                "Head": (-0.16 * e, 0, 0),
                "ArmL": (-0.35 * e, 0, 1.15 * e * over), "ArmR": (-0.35 * e, 0, -1.15 * e * over),
                "LegL": (0.12 * e, 0, 0.08 * e), "LegR": (-0.05 * e, 0, -0.08 * e)}

    def cheer(u):
        s = abs(S(PI2 * u))
        return {"Hips": {"loc": (0, 0.4 * s, 0)}, "Torso": (-0.06, 0, 0), "Head": (-0.12, 0, 0),
                "ArmL": (0, 0, 2.7 + 0.2 * s), "ArmR": (0, 0, -2.7 - 0.2 * s),
                "LegL": (0.15 * s, 0, 0), "LegR": (-0.1 * s, 0, 0)}

    def sad(u):
        s = S(PI2 * u)
        return {"Hips": {"loc": (0, -0.03 + 0.015 * s, 0)}, "Torso": (0.16 + 0.015 * s, 0, 0),
                "Head": (0.38, 0.05 * s, 0), "ArmL": (0.08, 0, 0.02), "ArmR": (0.08, 0, -0.02)}

    def point(u):
        s = S(PI2 * u)
        return {"Hips": {"loc": (0, 0.02 * s, 0)}, "Torso": (-0.03, 0.12, 0), "Head": (-0.05, 0, 0),
                "ArmR": (-1.5 + 0.04 * s, 0, -0.1), "ArmL": (0, 0, 0.08)}

    def lookup(u):
        s = S(PI2 * u)
        return {"Hips": {"loc": (0, 0.02 * s, 0)}, "Torso": (-0.1, 0, 0),
                "Head": (-0.5 + 0.02 * s, 0, 0), "ArmL": (0, 0, 0.1), "ArmR": (0, 0, -0.1)}

    def sit(u):
        s = S(PI2 * u)
        return {"Hips": {"loc": (0, -1.5, 0)}, "Torso": (0.02 * s, 0, 0), "Head": (0.03 * s, 0, 0),
                "LegL": (-1.5, 0, 0.04), "LegR": (-1.5, 0, -0.04),
                "ArmL": (-0.35, 0, 0.06), "ArmR": (-0.35, 0, -0.06)}

    def handsup(u):
        s = S(PI2 * u)
        return {"Hips": {"loc": (0, 0.02 * s, 0)}, "Torso": (0.03, 0, 0), "Head": (0.12, 0, 0),
                "ArmL": (0, 0, 2.6 + 0.05 * s), "ArmR": (0, 0, -2.6 - 0.05 * s)}

    def reach(u):
        s = S(PI2 * u)
        return {"Hips": {"loc": (0, 0.02 * s, 0)}, "Torso": (0.1, 0, 0), "Head": (-0.05, 0, 0),
                "ArmL": (-1.45 + 0.05 * s, 0, -0.12), "ArmR": (-1.45 - 0.05 * s, 0, 0.12)}

    def shiver(u):
        s = S(PI2 * 4 * u)
        return {"Hips": {"loc": (0.05 * s, -0.12, 0)}, "Torso": (0.12, 0.05 * s, 0), "Head": (0.22, -0.05 * s, 0),
                "ArmL": (-0.95, 0, -0.42 + 0.04 * s), "ArmR": (-0.95, 0, 0.42 - 0.04 * s),
                "LegL": (0, 0, -0.08), "LegR": (0, 0, 0.08)}

    def eat(u):
        s = S(PI2 * 3 * u)
        return {"Hips": {"loc": (0, 0.03 * abs(s), 0)}, "Torso": (0.08, 0, 0), "Head": (0.1 + 0.08 * s, 0, 0),
                "ArmR": (-2.0 + 0.45 * s, 0, 0.35), "ArmL": (-2.0 - 0.45 * s, 0, -0.35)}

    def block(u):
        s = S(PI2 * u)
        return {"Hips": {"loc": (0, 0.01 * s, 0)}, "Torso": (-0.03, 0, 0), "Head": (0.04, 0, 0),
                "ArmL": (0, 0, 1.35 + 0.03 * s), "ArmR": (0, 0, -1.35 - 0.03 * s),
                "LegL": (0, 0, 0.16), "LegR": (0, 0, -0.16)}

    clips = [("Sit", sit, 60), ("HandsUp", handsup, 60), ("Reach", reach, 60), ("Shiver", shiver, 30),
             ("Eat", eat, 60), ("Block", block, 60),
             ("Idle", idle, 60), ("Walk", walk, 30), ("Run", run, 20), ("Talk", talk, 60),
             ("Wave", wave, 60), ("Shock", shock, 45), ("Cheer", cheer, 30), ("Sad", sad, 90),
             ("Point", point, 60), ("LookUp", lookup, 60)]
    bake_actions(rig, clips)


def bake_actions(rig, clips):
    """Keys every (name, pose_fn, frames) clip on the rig and stacks them as NLA tracks."""
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="POSE")
    for pb in rig.pose.bones:
        pb.rotation_mode = "XYZ"
    rig.animation_data_create()
    made = []
    for name, fn, n in clips:
        act = bpy.data.actions.new(name)
        rig.animation_data.action = act
        for f in range(n + 1):
            pose = fn(f / n)
            for pb in rig.pose.bones:
                v = pose.get(pb.name, (0, 0, 0))
                loc, rot = (0, 0, 0), v
                if isinstance(v, dict):
                    loc, rot = v.get("loc", (0, 0, 0)), v.get("rot", (0, 0, 0))
                pb.location = loc
                pb.rotation_euler = rot
                pb.keyframe_insert("location", frame=f + 1)
                pb.keyframe_insert("rotation_euler", frame=f + 1)
        made.append((name, act, n))
    rig.animation_data.action = None
    for name, act, n in made:
        tr = rig.animation_data.nla_tracks.new()
        tr.name = name
        tr.strips.new(name, 1, act)
    for pb in rig.pose.bones:
        pb.location = (0, 0, 0)
        pb.rotation_euler = (0, 0, 0)
    bpy.ops.object.mode_set(mode="OBJECT")


# --------------------------------------------------------------------- dog
DOG_BONES = {  # name: (head, parent); the dog faces -Y like the character
    "Root": ((0, 0, 0), None),
    "Body": ((0, 0, 1.55), "Root"),
    "Head": ((0, -1.15, 2.0), "Body"),
    "Tail": ((0, 1.3, 1.9), "Body"),
    "LegFL": ((0.42, -0.85, 1.15), "Body"),
    "LegFR": ((-0.42, -0.85, 1.15), "Body"),
    "LegBL": ((0.42, 0.85, 1.15), "Body"),
    "LegBR": ((-0.42, 0.85, 1.15), "Body"),
}


def build_dog():
    """A blocky dog, about 2.9 studs tall at the head. Materials Fur, Patch, Paw, Nose, Collar,
    Tag are coloured per dog in stage.js (DOGS); Face is the drawn face (eyes on the head,
    mouth on the snout, one texture). Ear styles are M_Ears_<Style> objects, picked by "ears"."""
    reset()
    arm_data = bpy.data.armatures.new("DogRig")
    rig = bpy.data.objects.new("DogRig", arm_data)
    bpy.context.scene.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="EDIT")
    for name, (head, parent) in DOG_BONES.items():
        b = arm_data.edit_bones.new(name)
        b.head = head
        b.tail = (head[0], head[1], head[2] + 0.4)
        b.align_roll(Vector((0, -1, 0)))
        if parent:
            b.parent = arm_data.edit_bones[parent]
    bpy.ops.object.mode_set(mode="OBJECT")

    fur, patch, paw = mat("Fur", "#d9a066"), mat("Patch", "#8a5a32"), mat("Paw", "#f3e2c7")
    nose, collar, tag = mat("Nose", "#2a1e1a", 0.4), mat("Collar", "#d8463f", 0.6), mat("Tag", "#ffd23c", 0.3)
    face = mat("Face", "#ffffff")

    def part(name, bone, fn):
        b = Builder("D_" + name)
        fn(b)
        ob = b.finish()
        vg = ob.vertex_groups.new(name=bone)
        vg.add(range(len(ob.data.vertices)), 1.0, "REPLACE")
        ob.parent = rig
        ob.modifiers.new("Armature", "ARMATURE").object = rig
        return ob

    def body(b):
        b.box((1.36, 2.55, 1.16), (0, 0, 1.55), fur, 0.20, 3)
        b.box((1.16, 1.65, 0.14), (0, 0.08, 0.99), paw, 0.05, 2)        # light belly
        b.box((1.16, 0.42, 0.88), (0, -1.16, 1.48), paw, 0.12, 3)       # fluffy cream chest
        b.box((1.39, 1.16, 0.16), (0, 0.14, 2.06), patch, 0.07, 2)      # back saddle patch
    part("Body", "Body", body)

    def head(b):
        b.box((1.18, 1.04, 1.04), (0, -1.55, 2.32), fur, 0.18, 3)
        b.box((0.36, 0.26, 0.14), (0, -1.52, 2.84), fur, 0.06, 2, rot_x=0.14)  # soft head tuft
        b.box((0.70, 0.54, 0.48), (0, -2.30, 2.04), paw, 0.11, 3)       # snout
        b.box((0.32, 0.18, 0.20), (0, -2.58, 2.22), nose, 0.07, 2)      # nose
        b.box((1.26, 0.44, 0.22), (0, -1.14, 1.84), collar, 0.07, 2, rot_x=-0.28)
        b.blob(0.15, (0, -1.42, 1.62), tag, (1.05, 0.42, 1.05))
    part("Head", "Head", head)
    # face texture: top 60 % = eyes (head front), bottom 40 % = mouth (snout front)
    part("Face", "Head", lambda b: (
        b.quad([(-0.56, -2.082, 2.24), (0.56, -2.082, 2.24), (0.56, -2.082, 2.80), (-0.56, -2.082, 2.80)],
               face, (0, 0.4, 1, 1)),
        b.quad([(-0.32, -2.582, 1.82), (0.32, -2.582, 1.82), (0.32, -2.582, 2.10), (-0.32, -2.582, 2.10)],
               face, (0.25, 0, 0.75, 0.4))))

    def ears_floppy(b):
        for sx in (-1, 1):
            b.box((0.24, 0.54, 0.24), (sx * 0.62, -1.52, 2.74), patch, 0.08, 2, rot_y=-sx * 0.28)
            b.box((0.20, 0.56, 0.80), (sx * 0.68, -1.52, 2.38), patch, 0.08, 2, rot_y=sx * 0.20)

    def ears_pointy(b):
        for sx in (-1, 1):
            b.box((0.36, 0.18, 0.5), (sx * 0.36, -1.45, 2.95), patch, 0.06, 2, rot_y=-sx * 0.2)
    # EAR STYLES: name -> builder, picked by "ears" on a dog in stage.js (DOGS)
    for name, fn in {"Floppy": ears_floppy, "Pointy": ears_pointy}.items():
        part("Ears_" + name, "Head", fn)

    def tail(b):
        b.box((0.28, 0.28, 0.92), (0, 1.48, 2.25), fur, 0.09, 2, rot_x=-0.48)
        b.blob(0.24, (0, 1.74, 2.68), patch, (0.95, 1.0, 1.15), sub=2)
    part("Tail", "Tail", tail)

    for side, x, y in (("FL", 0.42, -0.85), ("FR", -0.42, -0.85), ("BL", 0.42, 0.85), ("BR", -0.42, 0.85)):
        def leg(b, x=x, y=y):
            b.box((0.44, 0.44, 1.0), (x, y, 0.65), fur, 0.08, 2)
            b.box((0.5, 0.56, 0.24), (x, y - 0.05, 0.12), paw, 0.08, 2)
        part("Leg" + side, "Leg" + side, leg)

    bake_dog_clips(rig)
    export(os.path.join(OUT, "dog.glb"), True)


def bake_dog_clips(rig):
    """Dog clips, same pose-function format as bake_clips. Rotation X on a leg swings its foot
    backwards (negative = forwards); on Body, positive tips the nose down."""
    S, C, PI2 = math.sin, math.cos, math.tau

    def idle(u):
        s = S(PI2 * u)
        return {"Body": {"loc": (0, 0.025 * s, 0)}, "Head": (0.04 * S(PI2 * u + 1), 0.12 * S(PI2 * u), 0.05 * s),
                "Tail": (0, 0.35 * S(PI2 * 4 * u), 0)}

    def walk(u):
        s = S(PI2 * u)
        return {"Body": {"loc": (0, 0.05 * abs(C(PI2 * u)), 0), "rot": (0, 0.04 * s, 0)},
                "Head": (0.04 * S(PI2 * 2 * u), -0.05 * s, 0), "Tail": (0, 0.3 * S(PI2 * 2 * u), 0),
                "LegFL": (0.5 * s, 0, 0), "LegBR": (0.5 * s, 0, 0),
                "LegFR": (-0.5 * s, 0, 0), "LegBL": (-0.5 * s, 0, 0)}

    def run(u):  # gallop: front pair, then back pair
        s, c = S(PI2 * u), C(PI2 * u)
        return {"Body": {"loc": (0, 0.25 * max(0, s), 0), "rot": (0.14 * c, 0, 0)},
                "Head": (-0.12 * c, 0, 0), "Tail": (-0.4, 0.2 * s, 0),
                "LegFL": (0.9 * s, 0, 0), "LegFR": (0.9 * S(PI2 * u - 0.4), 0, 0),
                "LegBL": (-0.9 * s, 0, 0), "LegBR": (-0.9 * S(PI2 * u - 0.4), 0, 0)}

    def sit_pose(s, lean=0.55):
        return {"Body": {"loc": (0, -0.42, -0.1), "rot": (-lean, 0, 0)},
                "LegFL": (lean, 0, 0), "LegFR": (lean, 0, 0),
                "LegBL": (lean - 1.55, 0, 0.05), "LegBR": (lean - 1.55, 0, -0.05),
                "Head": (lean * 0.8 + 0.03 * s, 0, 0)}

    def sit(u):
        s = S(PI2 * u)
        p = sit_pose(s)
        p["Tail"] = (-0.5, 0.3 * S(PI2 * 3 * u), 0)
        return p

    def bark(u):  # two barks per loop: head snaps up, body pushes forward, tail wags fast
        k = abs(S(PI2 * 2 * u)) ** 3
        return {"Body": {"loc": (0, 0.06 * k, -0.08 * k), "rot": (-0.08 * k, 0, 0)},
                "Head": (-0.3 * k, 0, 0), "Tail": (-0.2, 0.45 * S(PI2 * 6 * u), 0),
                "LegFL": (-0.12 * k, 0, 0), "LegFR": (-0.12 * k, 0, 0)}

    def beg(u):  # sitting up on the back legs, front paws up and paddling
        s = S(PI2 * u)
        p = sit_pose(s, 1.05)
        p["Body"]["loc"] = (0, -0.25 + 0.04 * s, 0.1)
        p["LegFL"] = (0.1 + 0.25 * S(PI2 * 2 * u), 0, 0)
        p["LegFR"] = (0.1 + 0.25 * S(PI2 * 2 * u + 1.2), 0, 0)
        p["Head"] = (0.85 + 0.06 * s, 0, 0.12 * s)
        p["Tail"] = (0, 0.3 * S(PI2 * 4 * u), 0)
        return p

    def sleep(u):  # lying down, legs tucked, head on the paws, slow breathing
        s = S(PI2 * u)
        return {"Body": {"loc": (0, -1.0 + 0.03 * s, 0)},
                "LegFL": (-1.5, 0, 0.1), "LegFR": (-1.5, 0, -0.1),
                "LegBL": (1.5, 0, 0.1), "LegBR": (1.5, 0, -0.1),
                "Head": (0.35, 0.25, 0.1), "Tail": (-0.9, 0.6, 0)}

    clips = [("Idle", idle, 60), ("Walk", walk, 30), ("Run", run, 16), ("Sit", sit, 60),
             ("Bark", bark, 30), ("Beg", beg, 60), ("Sleep", sleep, 120)]
    bake_actions(rig, clips)


# -------------------------------------------------------------------- town
def build_town():
    reset()
    rnd = random.Random(7)
    road, walk, dash = mat("Road", "#5b5560", 0.95), mat("Sidewalk", "#cfc6bb", 0.9), mat("Dash", "#f1e3b0", 0.9)
    curb, grass = mat("Curb", "#a89f96", 0.9), mat("Grass", "#7fb069", 1.0)
    glass = mat("Glass", "#35506e", 0.25, emit="#ffd9a0")
    frame, door = mat("Frame", "#f7f1e6", 0.7), mat("Door", "#7a4b34", 0.7)
    roof = mat("Roof", "#8d4f45", 0.85)
    trunk, leaf = mat("Trunk", "#7a5136", 0.9), mat("Leaf", "#5f9e58", 0.95)
    metal, lampglow = mat("Metal", "#3b3f4a", 0.5), mat("LampGlow", "#fff1c2", 0.4, emit="#ffe2a0")
    red, white = mat("AwningRed", "#d8463f", 0.8), mat("AwningWhite", "#f6efe6", 0.8)
    walls = [mat("Wall%d" % i, h, 0.9) for i, h in enumerate(
        ["#e8c9a8", "#c9d6c3", "#e4b7a0", "#d7c4dc", "#bcd0e0", "#f0dcae", "#c98f7e", "#b9a79a"])]

    g = Builder("Ground")
    L = 90
    g.box((16, 2 * L, 0.2), (0, 0, -0.1), road)
    for sx in (-1, 1):
        g.box((5, 2 * L, 0.5), (sx * 10.5, 0, 0.05), walk, 0.08, 2)
        g.box((0.5, 2 * L, 0.56), (sx * 8.05, 0, 0.06), curb, 0.06, 2)
        g.box((60, 2 * L, 0.2), (sx * 43, 0, -0.05), grass)
    for y in range(-L + 4, L, 8):
        g.box((0.4, 3.4, 0.03), (0, y, 0.012), dash)
    for i in range(7):  # crosswalk near the count-board plaza
        g.box((1.2, 4.5, 0.03), (-5.4 + i * 1.8, 34, 0.014), frame)
    g.finish()

    t = Builder("Town")

    def house(x_sign, y, width, depth, floors, wall, pitched):
        h = floors * 4.6 + 1.0
        cx = x_sign * (13.2 + depth / 2)
        t.box((depth, width, h), (cx, y, h / 2 + 0.3), wall, 0.18, 2)
        fx = x_sign * 13.2  # facade plane
        out = -x_sign
        # cornice / roof
        if pitched:
            t.box((depth + 1.2, width + 1.0, 0.7), (cx, y, h + 0.6), roof, 0.15, 2)
            t.box((depth * 0.62, width + 0.6, 1.6), (cx, y, h + 1.6), roof, 0.5, 2)
        else:
            t.box((depth + 0.9, width + 0.7, 0.8), (cx, y, h + 0.65), frame, 0.15, 2)
        cols = max(2, int(width // 3.6))
        for f in range(floors):
            z = 3.4 + f * 4.6 + 0.3
            for c in range(cols):
                wy = y - width / 2 + (c + 0.5) * width / cols
                if f == 0 and c == cols // 2:
                    t.box((0.3, 2.3, 3.7), (fx + out * 0.08, wy, 2.15), frame)
                    t.box((0.3, 1.8, 3.3), (fx + out * 0.16, wy, 1.95), door)
                    continue
                t.box((0.3, 2.2, 2.5), (fx + out * 0.08, wy, z), frame)
                t.box((0.3, 1.75, 2.05), (fx + out * 0.17, wy, z), glass)
                t.box((0.34, 0.14, 2.05), (fx + out * 0.2, wy, z), frame)
                t.box((0.34, 1.75, 0.14), (fx + out * 0.2, wy, z), frame)
        if rnd.random() < 0.55:  # striped awning over the ground floor
            n = int(width // 1.0) - 1
            for i in range(n):
                wy = y - (n - 1) / 2 + i
                t.box((2.2, 1.0, 0.16), (fx + out * 1.05, wy, 4.75), red if i % 2 else white,
                      rot_z=0, rot_x=0)

    for x_sign in (-1, 1):
        y = -L + 8
        while y < L - 8:
            width = rnd.choice([9, 10.5, 12, 13.5])
            house(x_sign, y + width / 2, width, rnd.choice([9, 10, 12]), rnd.choice([2, 2, 3, 3, 4]),
                  rnd.choice(walls), rnd.random() < 0.45)
            y += width + rnd.choice([0.0, 0.0, 1.5])
    for x_sign in (-1, 1):
        for y in range(-L + 10, L - 6, 18):
            lx = x_sign * 8.9
            t.box((0.5, 0.5, 0.5), (lx, y, 0.55), metal, 0.08, 2)
            t.box((0.22, 0.22, 7.2), (lx, y, 3.9), metal, 0.05, 2)
            t.box((1.7, 0.2, 0.2), (lx - x_sign * 0.75, y, 7.4), metal, 0.05, 2)
            t.box((0.7, 0.7, 0.5), (lx - x_sign * 1.5, y, 7.15), lampglow, 0.14, 2)
            ty = y + 9
            tx = x_sign * 11.6
            t.box((0.7, 0.7, 4.2), (tx, ty, 2.4), trunk, 0.12, 2)
            for dx, dy, dz, r in ((0, 0, 5.6, 2.1), (0.9, 0.6, 6.6, 1.5), (-0.8, -0.5, 6.4, 1.6)):
                t.blob(r, (tx + dx, ty + dy, dz), leaf, (1, 1, 0.85))
    t.finish()

    # count-board tower in a plaza at the end of the street (behind the cast)
    b = Builder("Tower")
    stone, dark = mat("Stone", "#8f8a99", 0.85), mat("TowerDark", "#2a2c3a", 0.6)
    b.box((18, 8, 1.0), (0, 46, 0.5), stone, 0.2, 2)
    b.box((11, 4.5, 26), (0, 47, 14), dark, 0.3, 2)
    b.box((12.4, 5.4, 1.4), (0, 47, 27.6), stone, 0.3, 2)
    b.box((3, 3, 3.2), (0, 47, 29.8), stone, 0.3, 2)
    b.blob(1.3, (0, 47, 32.2), mat("TowerLight", "#ff5a4a", 0.4, emit="#ff5a4a"))
    b.finish()
    s = Builder("BoardScreen")
    y = 47 - 2.25 - 0.06
    s.quad([(-4.8, y, 5.5), (4.8, y, 5.5), (4.8, y, 24.5), (-4.8, y, 24.5)], mat("Screen", "#101018", 0.3))
    s.finish()

    export(os.path.join(OUT, "town.glb"), False)


def build_sets():
    """Extra sets and props at character scale; each object is placed in Three.js."""
    reset()
    rnd = random.Random(11)
    PI2 = math.tau

    # --- Zero's bedroom (open towards -Y)
    r = Builder("Room")
    wood, wall = mat("RoomFloor", "#c79a6b", 0.8), mat("RoomWall", "#9ec5e8", 0.95)
    white, dark = mat("RoomWhite", "#f6f1e7", 0.8), mat("RoomWood", "#7a4b34", 0.8)
    r.box((24, 18, 0.4), (0, 0, -0.2), wood)
    r.box((9, 6, 0.06), (1, -2, 0.03), mat("Rug", "#6aa6d6", 1.0), 0.02, 1)
    r.box((24, 0.5, 13), (0, 8.75, 6.5), wall)
    for sx in (-1, 1):
        r.box((0.5, 18, 13), (sx * 12.25, 0, 6.5), wall)
    r.box((24.5, 0.3, 0.7), (0, 8.4, 0.35), white)
    r.box((7, 0.3, 6.2), (5, 8.42, 7), white, 0.05, 1)
    for x, y in ((-11.2, 3.3), (-1.8, 3.3), (-11.2, 8.1), (-1.8, 8.1)):
        r.box((0.5, 0.5, 2.7), (x, y, 1.35), dark, 0.05, 1)
    r.box((10, 5.4, 0.5), (-6.5, 5.7, 2.95), dark, 0.08, 2)
    r.box((9.6, 5.0, 0.9), (-6.5, 5.7, 3.65), white, 0.2, 3)
    r.box((6.5, 5.1, 0.95), (-4.9, 5.7, 3.72), mat("Blanket", "#e2574c", 0.9), 0.2, 3)
    r.box((2.2, 3.4, 0.6), (-10.1, 5.7, 4.35), mat("Pillow", "#fdf6e3", 0.9), 0.2, 3)
    r.box((0.5, 5.4, 3.2), (-11.45, 5.7, 4.3), dark, 0.1, 2)
    r.box((7, 3.4, 0.35), (6.5, -1.5, 2.9), dark, 0.06, 2)
    for x, y in ((3.3, -2.9), (9.7, -2.9), (3.3, -0.1), (9.7, -0.1)):
        r.box((0.4, 0.4, 2.75), (x, y, 1.38), dark)
    r.box((0.8, 0.8, 0.2), (9.2, -0.8, 3.18), mat("LampBase", "#3b3f4a", 0.5), 0.05, 1)
    r.box((0.16, 0.16, 1.1), (9.2, -0.8, 3.8), mat("LampBase", "#3b3f4a", 0.5))
    r.box((1.1, 1.1, 0.8), (9.2, -0.8, 4.7), mat("RoomLamp", "#fff1c2", 0.4, emit="#ffe2a0"), 0.2, 3)
    r.box((0.8, 6, 0.3), (11.6, 3, 6), dark)
    for i, hx in enumerate(("#e76f51", "#2a9d8f", "#e9c46a", "#577590", "#b56576")):
        r.box((0.7, 0.5, 1.5 - 0.15 * (i % 2)), (11.55, 0.9 + i * 0.75, 6.9), mat("Book%d" % i, hx, 0.9))
    r.box((4.2, 0.1, 3.2), (-6.5, 8.45, 9), mat("Poster", "#27304f", 0.9))
    r.blob(0.9, (-6.5, 8.38, 9), mat("PosterPlanet", "#f2b632", 0.9), (1, 0.15, 1))
    r.box((3, 2.2, 2), (-9.3, -5, 1), mat("ToyBox", "#7fb069", 0.9), 0.15, 2)
    r.finish()
    w = Builder("RoomWindow")
    w.quad([(2.2, 8.2, 4.4), (7.8, 8.2, 4.4), (7.8, 8.2, 9.6), (2.2, 8.2, 9.6)], mat("RoomWindowMat", "#35506e", 0.3))
    w.finish()

    # --- forest clearing with a crater
    f = Builder("Forest")
    f.box((240, 240, 0.4), (0, 0, -0.2), mat("ForestGround", "#2f5d3a", 1.0))
    f.blob(10, (0, 0, -0.2), mat("Dirt", "#4a3528", 1.0), (1, 1, 0.09))
    rock = mat("Rock", "#6b6b78", 0.95)
    for i in range(14):
        a = i / 14 * PI2
        f.box((2.4, 2.2, 1.4 + rnd.random()), (9 * math.cos(a), 9 * math.sin(a), 0.5), rock, 0.5, 2, rot_z=rnd.random() * 3)
    trunk = mat("PineTrunk", "#5a3d2b", 0.95)
    leaves = [mat("Pine%d" % i, h, 0.95) for i, h in enumerate(("#1f6b45", "#267a4f", "#1a5a3c"))]
    n = 0
    while n < 70:
        a, d = rnd.random() * PI2, 17 + rnd.random() * 85
        x, y = d * math.cos(a), d * math.sin(a)
        if y < -4 and abs(x) < 10:
            continue  # keep the camera corridor clear
        k = 0.8 + rnd.random() * 0.7
        lf = rnd.choice(leaves)
        f.box((1.0 * k, 1.0 * k, 5 * k), (x, y, 2.5 * k), trunk, 0.15, 1)
        for rr, zz in ((3.6, 6.3), (2.9, 9.4), (2.0, 12.2)):
            f.blob(rr * k, (x, y, zz * k), lf, (1, 1, 1.05))
        n += 1
    f.finish()

    s = Builder("Saucer")
    hull = mat("SaucerHull", "#b9c2d0", 0.35)
    s.blob(4.6, (0, 0, 1.7), hull, (1, 1, 0.26), sub=3)
    s.blob(2.3, (0, 0, 2.5), mat("SaucerGlass", "#7de8c0", 0.2, emit="#7de8c0"), (1, 1, 0.85), sub=3)
    for i in range(8):
        a = i / 8 * PI2
        s.box((0.6, 0.6, 0.35), (3.7 * math.cos(a), 3.7 * math.sin(a), 1.45), mat("SaucerLight", "#b6ff6a", 0.3, emit="#b6ff6a"), 0.1, 1)
    for i in range(3):
        a = i / 3 * PI2
        s.box((0.3, 0.3, 1.6), (2.6 * math.cos(a), 2.6 * math.sin(a), 0.7), hull)
    s.finish()

    # --- car (front towards -Y)
    c = Builder("Car")
    paint, glass, tire = mat("CarPaint", "#d8463f", 0.45), mat("CarGlass", "#9fd3e6", 0.2), mat("Tire", "#22222a", 0.9)
    c.box((5.6, 11, 2.2), (0, 0, 2.1), paint, 0.4, 3)
    c.box((5.0, 5.4, 2.0), (0, 0.8, 4.0), paint, 0.45, 3)
    c.box((4.3, 0.2, 1.25), (0, -1.86, 4.1), glass)
    c.box((4.3, 0.2, 1.25), (0, 3.46, 4.1), glass)
    for sx in (-1, 1):
        c.box((0.2, 4.2, 1.25), (sx * 2.46, 0.8, 4.1), glass)
        for sy in (-3.4, 3.5):
            c.box((1.0, 2.3, 2.3), (sx * 2.6, sy, 1.15), tire, 0.5, 3)
        c.box((1.1, 0.2, 0.6), (sx * 1.8, -5.46, 2.5), mat("CarLight", "#fff1c2", 0.3, emit="#ffe2a0"))
    c.box((5.9, 0.5, 0.6), (0, -5.4, 1.3), mat("Bumper", "#c9c9d2", 0.5), 0.1, 2)
    c.box((5.9, 0.5, 0.6), (0, 5.4, 1.3), mat("Bumper", "#c9c9d2", 0.5), 0.1, 2)
    c.finish()

    # --- mothership (centred on the origin)
    m = Builder("Mothership")
    m.blob(60, (0, 0, 0), mat("ShipHull", "#2c3340", 0.4), (1, 1, 0.16), sub=4)
    m.blob(22, (0, 0, 6), mat("ShipDome", "#3d4758", 0.35), (1, 1, 0.45), sub=3)
    for i in range(20):
        a = i / 20 * PI2
        m.box((5, 5, 1.4), (44 * math.cos(a), 44 * math.sin(a), -6.2), mat("ShipLight", "#7dffa0", 0.3, emit="#7dffa0"), 0.6, 2, rot_z=a)
    m.blob(11, (0, 0, -9), mat("ShipHatch", "#d8ffe0", 0.3, emit="#b6ff6a"), (1, 1, 0.14), sub=3)
    m.finish()

    # --- the family house (front towards -Y)
    h = Builder("House")
    hw, white2 = mat("HouseWall", "#f0d27a", 0.9), mat("HouseTrim", "#f7f1e6", 0.8)
    roof = mat("HouseRoof", "#b5533c", 0.85)
    h.box((22, 12, 13), (0, 0, 6.5), hw, 0.25, 2)
    h.box((23.6, 13.6, 0.8), (0, 0, 13.4), roof, 0.2, 2)
    h.box((17, 13.9, 2.2), (0, 0, 14.9), roof, 0.5, 2)
    h.box((9, 14.1, 1.8), (0, 0, 16.9), roof, 0.5, 2)
    h.box((2, 2, 4), (7, 2, 17), mat("Chimney", "#8d4f45", 0.9), 0.15, 2)
    h.box((4.4, 0.4, 6.6), (-4, -6.05, 3.3), white2)
    h.box((3.6, 0.4, 6.0), (-4, -6.15, 3.0), mat("HouseDoor", "#2a9d8f", 0.7), 0.05, 1)
    h.blob(0.22, (-2.8, -6.4, 3.0), mat("Knob", "#ffd23c", 0.3))
    h.box((6, 2.2, 0.4), (-4, -7.1, 0.2), mat("Step", "#b9b2a8", 0.9), 0.08, 1)
    h.box((7, 0.4, 6.2), (5, -6.05, 6.5), white2, 0.05, 1)
    for x in (-6.5, 6.5):
        h.box((3.4, 0.4, 2.6), (x, -6.05, 11), white2)
        h.box((2.8, 0.4, 2.0), (x, -6.12, 11), mat("HouseGlass", "#35506e", 0.25, emit="#ffd9a0"))
    h.finish()
    hwq = Builder("HouseWindow")
    hwq.quad([(2.2, -6.3, 3.8), (7.8, -6.3, 3.8), (7.8, -6.3, 9.2), (2.2, -6.3, 9.2)], mat("HouseWindowMat", "#35506e", 0.3))
    hwq.finish()

    export(os.path.join(OUT, "sets.glb"), False)


build_character()
build_dog()
build_town()
build_sets()
print("DONE")
