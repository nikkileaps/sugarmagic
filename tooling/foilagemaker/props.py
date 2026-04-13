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

    display_leaf_blocks: bpy.props.BoolProperty(
        name="Display Blocks",
        default=False,
        update=_update_tree,
    )
    canopy_cluster_count: bpy.props.IntProperty(
        name="Cluster Count",
        default=4,
        min=1,
        soft_max=12,
        update=_update_tree,
    )
    canopy_radius: bpy.props.FloatProperty(
        name="Cluster Radius",
        default=1.04,
        min=0.1,
        soft_max=4.0,
        update=_update_tree,
    )
    canopy_vertical_scale: bpy.props.FloatProperty(
        name="Vertical Scale",
        default=1.05,
        min=0.2,
        soft_max=2.5,
        update=_update_tree,
    )
    canopy_density_multiplier: bpy.props.FloatProperty(
        name="Density Multiplier",
        default=24.5,
        min=1.0,
        soft_max=80.0,
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
    leaf_density: bpy.props.IntProperty(
        name="Density",
        default=5,
        min=1,
        soft_max=12,
        update=_update_tree,
    )
    leaf_jitter: bpy.props.FloatProperty(
        name="Scatter",
        default=0.98,
        min=0.0,
        soft_max=2.0,
        update=_update_tree,
    )
    add_outer_leaves: bpy.props.BoolProperty(
        name="Add Outer Leaves",
        default=True,
        update=_update_tree,
    )
    outer_leaf_offset: bpy.props.FloatProperty(
        name="Outer Offset",
        default=0.95,
        min=0.0,
        soft_max=3.0,
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
