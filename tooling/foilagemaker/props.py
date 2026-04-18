"""
/Users/nikki/projects/sugarmagic/tooling/foilagemaker/props.py

Purpose: Defines the persistent FoilageMaker tree authoring properties exposed
in Blender UI panels.

Status: active
"""

from __future__ import annotations

import bpy

from . import generator


def _update_tree(self, context: bpy.types.Context):
    obj = getattr(context, "active_object", None)
    if not generator.is_foilagemaker_tree(obj):
        return
    if bool(obj.get(generator.SUPPRESS_UPDATE_KEY)):
        return
    generator.rebuild_tree_object(obj)


def _canopy_custom_collection_poll(self, collection: bpy.types.Collection) -> bool:
    """Accept any collection. Filtering of individual objects (mesh-only,
    no self-reference to the tree itself) happens at extraction time in
    generator._extract_custom_shape_mesh, so authors can freely use a
    mixed collection and the non-mesh / self-referential objects are
    simply ignored during scatter.
    """
    return collection is not None


class FoliageMakerTreeProperties(bpy.types.PropertyGroup):
    random_seed: bpy.props.IntProperty(
        name="Random Seed",
        default=0,
        min=0,
        soft_max=999_999,
        update=_update_tree,
    )

    trunk_height: bpy.props.FloatProperty(
        name="Height",
        default=5.0,
        min=1.0,
        soft_max=20.0,
        update=_update_tree,
    )
    trunk_radius: bpy.props.FloatProperty(
        name="Width",
        default=0.22,
        min=0.03,
        soft_max=2.0,
        update=_update_tree,
    )
    trunk_taper: bpy.props.FloatProperty(
        name="Taper",
        default=0.72,
        min=0.0,
        max=0.95,
        update=_update_tree,
    )
    trunk_segments: bpy.props.IntProperty(
        name="Resolution Height",
        default=14,
        min=3,
        soft_max=48,
        update=_update_tree,
    )
    trunk_sides: bpy.props.IntProperty(
        name="Resolution Width",
        default=8,
        min=3,
        soft_max=16,
        update=_update_tree,
    )
    trunk_displacement_strength: bpy.props.FloatProperty(
        name="Disp. Strength",
        default=1.4,
        min=0.0,
        soft_max=6.0,
        update=_update_tree,
    )
    trunk_displacement_scale: bpy.props.FloatProperty(
        name="Disp. Scale",
        default=1.0,
        min=0.05,
        soft_max=5.0,
        update=_update_tree,
    )
    base_flare_scale: bpy.props.FloatProperty(
        name="Base Scale",
        default=1.6,
        min=1.0,
        soft_max=3.0,
        update=_update_tree,
    )
    base_flare_position: bpy.props.FloatProperty(
        name="Base Position",
        default=0.24,
        min=0.01,
        max=0.75,
        subtype="FACTOR",
        update=_update_tree,
    )

    branch_count: bpy.props.IntProperty(
        name="Density",
        default=14,
        min=0,
        soft_max=40,
        update=_update_tree,
    )
    branch_start: bpy.props.FloatProperty(
        name="Start From",
        default=0.28,
        min=0.0,
        max=0.95,
        subtype="FACTOR",
        update=_update_tree,
    )
    branch_length: bpy.props.FloatProperty(
        name="Length",
        default=2.2,
        min=0.1,
        soft_max=8.0,
        update=_update_tree,
    )
    branch_length_randomness: bpy.props.FloatProperty(
        name="Length Randomness",
        default=0.25,
        min=0.0,
        max=0.9,
        subtype="FACTOR",
        update=_update_tree,
    )
    branch_radius: bpy.props.FloatProperty(
        name="Width",
        default=0.08,
        min=0.005,
        soft_max=0.5,
        update=_update_tree,
    )
    branch_segments: bpy.props.IntProperty(
        name="Resolution Length",
        default=4,
        min=2,
        soft_max=12,
        update=_update_tree,
    )
    branch_sides: bpy.props.IntProperty(
        name="Resolution Width",
        default=5,
        min=3,
        soft_max=10,
        update=_update_tree,
    )
    branch_angle_offset: bpy.props.FloatProperty(
        name="Angle Offset",
        default=0.0,
        subtype="ANGLE",
        soft_min=-3.14159,
        soft_max=3.14159,
        update=_update_tree,
    )
    branch_up_bias: bpy.props.FloatProperty(
        name="Up Bias",
        default=0.42,
        min=0.0,
        max=1.0,
        subtype="FACTOR",
        update=_update_tree,
    )

    secondary_branch_count: bpy.props.IntProperty(
        name="Density",
        default=3,
        min=0,
        soft_max=12,
        update=_update_tree,
    )
    secondary_branch_length: bpy.props.FloatProperty(
        name="Length",
        default=0.95,
        min=0.05,
        soft_max=4.0,
        update=_update_tree,
    )
    secondary_branch_randomness: bpy.props.FloatProperty(
        name="Length Randomness",
        default=0.2,
        min=0.0,
        max=0.9,
        subtype="FACTOR",
        update=_update_tree,
    )
    secondary_branch_radius: bpy.props.FloatProperty(
        name="Width",
        default=0.028,
        min=0.002,
        soft_max=0.2,
        update=_update_tree,
    )
    secondary_branch_segments: bpy.props.IntProperty(
        name="Resolution Length",
        default=3,
        min=2,
        soft_max=8,
        update=_update_tree,
    )
    secondary_branch_sides: bpy.props.IntProperty(
        name="Resolution Width",
        default=4,
        min=3,
        soft_max=8,
        update=_update_tree,
    )

    # ── Canopy shape (0.15.0) ────────────────────────────────────────────
    # Replaces the 0.14-and-earlier cluster-blob + taper system. The new
    # model builds a procedural canopy silhouette (sphere / cone / teardrop),
    # scatters leaf cards across its SURFACE, and lets the shape itself
    # define the outline — so a triangular tree is literally "pick the
    # cone" rather than "tune seven sliders until the blobs happen to look
    # triangular." The shape mesh is a staging structure; only the leaf
    # cards it generates end up in the exported GLB.
    canopy_shape: bpy.props.EnumProperty(
        name="Shape",
        description=(
            "Silhouette of the canopy. Leaves are scattered across this "
            "shape's surface, so the outline is guaranteed to match."
        ),
        items=[
            ("sphere", "Sphere", "Round blob — classic deciduous look"),
            ("cone", "Cone", "Triangular / pine-ish silhouette"),
            (
                "teardrop",
                "Teardrop",
                "Rounded base, pointed top — stylized triangular deciduous",
            ),
            (
                "custom",
                "Custom Mesh",
                (
                    "Scatter leaves on a mesh you author yourself. Pick "
                    "any mesh object from the scene (sculpted, modeled, or "
                    "a primitive). The chosen mesh is used only as a "
                    "scatter surface; it doesn't end up in the exported "
                    "GLB — only the leaves do."
                ),
            ),
        ],
        default="sphere",
        update=_update_tree,
    )
    canopy_custom_collection: bpy.props.PointerProperty(
        name="Custom Shape Collection",
        description=(
            "Collection whose mesh objects are combined into the canopy "
            "scatter surface when Shape is set to Custom Mesh. Leaves are "
            "distributed across every mesh in the collection (including "
            "nested sub-collections), weighted by surface area so larger "
            "pieces get proportionally more leaves. Non-mesh objects in "
            "the collection are ignored. Move, rotate, or scale each "
            "mesh in the viewport and the canopy tracks — each mesh's "
            "own world transform is honored. Add or remove meshes from "
            "the collection in the outliner at any time; the tree "
            "rebuilds from whatever's currently in the collection."
        ),
        type=bpy.types.Collection,
        poll=_canopy_custom_collection_poll,
        update=_update_tree,
    )
    canopy_size: bpy.props.FloatProperty(
        name="Size",
        description="Horizontal radius of the canopy shape at its widest point.",
        default=1.1,
        min=0.1,
        soft_max=4.0,
        update=_update_tree,
    )
    canopy_vertical_scale: bpy.props.FloatProperty(
        name="Vertical Scale",
        description=(
            "Vertical extent relative to canopy Size. 1.0 = as tall as wide "
            "(sphere reads as a ball). 2.0 = elongated upward. Controls "
            "cone / teardrop height as well."
        ),
        default=1.2,
        min=0.2,
        soft_max=3.5,
        update=_update_tree,
    )
    canopy_base_offset: bpy.props.FloatProperty(
        name="Base Offset",
        description=(
            "Vertical position of the canopy's base relative to the top "
            "of the trunk, in Blender units. 0 = canopy sits right at the "
            "trunk top. Negative values push it DOWN — set it negative "
            "enough to reach the height where branches start and the "
            "canopy will cover the branched portion of the tree. Positive "
            "values float the canopy above the trunk top."
        ),
        default=-0.2,
        soft_min=-20.0,
        soft_max=5.0,
        update=_update_tree,
    )
    leaf_count: bpy.props.IntProperty(
        name="Leaf Count",
        description=(
            "Total number of leaf sprays scattered across the canopy "
            "surface. Each spray produces leaf_card_count cards, so the "
            "rendered leaf-card count is roughly Leaf Count × Cards."
        ),
        default=140,
        min=8,
        soft_max=600,
        update=_update_tree,
    )
    leaf_card_count: bpy.props.IntProperty(
        name="Cards",
        default=4,
        min=2,
        soft_max=8,
        update=_update_tree,
    )
    leaf_size: bpy.props.FloatProperty(
        name="Scale",
        default=1.22,
        min=0.02,
        soft_max=3.0,
        update=_update_tree,
    )
    leaf_width: bpy.props.FloatProperty(
        name="Width",
        default=0.82,
        min=0.1,
        soft_max=2.0,
        update=_update_tree,
    )
    leaf_height: bpy.props.FloatProperty(
        name="Height",
        default=0.88,
        min=0.1,
        soft_max=2.0,
        update=_update_tree,
    )
    # Leaf texture library is bundled in `foilagemaker/textures/`. The "mixed"
    # option atlases the first four `_transparency.png` files into a 2x2 grid
    # so each leaf card variant samples a different one (variety). Picking a
    # specific leavesTexture0N uses just that texture for every leaf card
    # (uniform look). Changing this triggers a tree rebuild which re-bakes
    # the Blender leaf image and re-runs the material assignment.
    leaf_texture_variant: bpy.props.EnumProperty(
        name="Leaf Texture",
        description="Which bundled leaf texture to bake into the canopy",
        items=[
            ("mixed", "Mixed Atlas (01–04)", "Atlas the first four bundled textures"),
            ("leavesTexture01", "Leaves 01", ""),
            ("leavesTexture02", "Leaves 02", ""),
            ("leavesTexture03", "Leaves 03", ""),
            ("leavesTexture04", "Leaves 04", ""),
            ("leavesTexture05", "Leaves 05", ""),
            ("leavesTexture06", "Leaves 06", ""),
            ("leavesTexture07", "Leaves 07", ""),
            ("leavesTexture08", "Leaves 08", ""),
            ("leavesTexture09", "Leaves 09", ""),
            ("leavesTexture10", "Leaves 10", ""),
            ("leavesTexture11", "Leaves 11", ""),
            ("leavesTexture12", "Leaves 12", ""),
        ],
        default="leavesTexture01",
        update=_update_tree,
    )

    wind_scale: bpy.props.FloatProperty(
        name="Wind Scale",
        default=2.5,
        min=0.0,
        soft_max=8.0,
        update=_update_tree,
    )
    wind_speed: bpy.props.FloatProperty(
        name="Wind Speed",
        default=1.0,
        min=0.0,
        soft_max=5.0,
        update=_update_tree,
    )
    big_wind_multiplier: bpy.props.FloatProperty(
        name="Big Wind Multiplier",
        default=1.0,
        min=0.0,
        soft_max=5.0,
        update=_update_tree,
    )
    small_wind_multiplier: bpy.props.FloatProperty(
        name="Small Wind Multiplier",
        default=1.0,
        min=0.0,
        soft_max=5.0,
        update=_update_tree,
    )


CLASSES = (FoliageMakerTreeProperties,)


def register():
    for cls in CLASSES:
        bpy.utils.register_class(cls)
    bpy.types.Object.foilagemaker_tree = bpy.props.PointerProperty(
        type=FoliageMakerTreeProperties
    )


def unregister():
    del bpy.types.Object.foilagemaker_tree
    for cls in reversed(CLASSES):
        bpy.utils.unregister_class(cls)
