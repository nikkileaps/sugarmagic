"""
/Users/nikki/projects/sugarmagic/tooling/foilagemaker/ui.py

Purpose: Renders the Blender UI panels for FoilageMaker authoring controls.

Status: active
"""

from __future__ import annotations

import bpy

from . import generator


class VIEW3D_PT_foilagemaker(bpy.types.Panel):
    """Sidebar entry point for FoilageMaker."""

    bl_label = "FoilageMaker"
    bl_idname = "VIEW3D_PT_foilagemaker"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "FoilageMaker"

    def draw(self, context: bpy.types.Context):
        layout = self.layout
        obj = context.active_object

        header = layout.box()
        header.label(text="Sugarmagic Tree Authoring")
        header.operator("foilagemaker.create_tree", icon="OUTLINER_OB_CURVE")

        if not generator.is_foilagemaker_tree(obj):
            info = layout.box()
            info.label(text="Select a FoilageMaker tree to edit it.")
            info.label(text="Generated trees are realized meshes.")
            return

        props = obj.foilagemaker_tree

        actions = layout.row(align=True)
        actions.operator("foilagemaker.rebuild_tree", icon="FILE_REFRESH")
        actions.operator("foilagemaker.randomize_seed", icon="RNDCURVE")

        issues = generator.validate_tree_object(obj)
        error_count, warning_count = generator.summarize_validation(issues)

        export_box = layout.box()
        export_box.label(text="Export")
        export_actions = export_box.row(align=True)
        export_actions.operator("foilagemaker.validate_tree", icon="CHECKMARK")
        export_actions.operator("foilagemaker.export_to_sugarmagic", icon="EXPORT")
        if error_count:
            export_box.label(text=f"{error_count} error(s), {warning_count} warning(s)", icon="ERROR")
        elif warning_count:
            export_box.label(text=f"{warning_count} warning(s)", icon="INFO")
        else:
            export_box.label(text="Validation passed", icon="CHECKMARK")
        export_box.label(text="Writes a single .glb with embedded extras.")
        if issues:
            for issue in issues[:5]:
                icon = "ERROR" if issue["severity"] == "error" else "INFO"
                export_box.label(text=issue["message"], icon=icon)
            if len(issues) > 5:
                export_box.label(text=f"{len(issues) - 5} more issue(s) not shown.")

        presets = layout.box()
        presets.label(text="Presets")
        presets.label(text="New trees start from Clustered Stylized Canopy.")
        for preset_name in generator.get_tree_preset_names():
            op = presets.operator("foilagemaker.apply_preset", text=generator.get_tree_preset_label(preset_name))
            op.preset_name = preset_name

        general = layout.box()
        general.label(text="General")
        general.prop(props, "random_seed")

        trunk = layout.box()
        trunk.label(text="Trunk")
        trunk.prop(props, "trunk_height")
        trunk.prop(props, "trunk_radius")
        trunk.prop(props, "trunk_taper")
        trunk.prop(props, "trunk_segments")
        trunk.prop(props, "trunk_sides")
        trunk.prop(props, "trunk_displacement_strength")
        trunk.prop(props, "trunk_displacement_scale")
        trunk.prop(props, "base_flare_scale")
        trunk.prop(props, "base_flare_position")

        branches = layout.box()
        branches.label(text="Branches")
        branches.prop(props, "branch_count")
        branches.prop(props, "branch_start")
        branches.prop(props, "branch_length")
        branches.prop(props, "branch_length_randomness")
        branches.prop(props, "branch_radius")
        branches.prop(props, "branch_segments")
        branches.prop(props, "branch_sides")
        branches.prop(props, "branch_angle_offset")
        branches.prop(props, "branch_up_bias")

        secondary = layout.box()
        secondary.label(text="Secondary Branches")
        secondary.prop(props, "secondary_branch_count")
        secondary.prop(props, "secondary_branch_length")
        secondary.prop(props, "secondary_branch_randomness")
        secondary.prop(props, "secondary_branch_radius")
        secondary.prop(props, "secondary_branch_segments")
        secondary.prop(props, "secondary_branch_sides")

        leaves = layout.box()
        leaves.label(text="Canopy")
        leaves.prop(props, "display_leaf_blocks")
        leaves.prop(props, "canopy_cluster_count")
        leaves.prop(props, "canopy_radius")
        leaves.prop(props, "canopy_vertical_scale")
        leaves.prop(props, "canopy_density_multiplier")
        leaves.prop(props, "leaf_card_count")
        leaves.prop(props, "leaf_size")
        leaves.prop(props, "leaf_width")
        leaves.prop(props, "leaf_height")
        leaves.prop(props, "leaf_density")
        leaves.prop(props, "leaf_jitter")
        leaves.prop(props, "add_outer_leaves")
        leaves.prop(props, "outer_leaf_offset")
        leaves.separator()
        leaves.prop(props, "leaf_texture_variant")

        wind = layout.box()
        wind.label(text="Wind Metadata")
        wind.prop(props, "wind_scale")
        wind.prop(props, "wind_speed")
        wind.prop(props, "big_wind_multiplier")
        wind.prop(props, "small_wind_multiplier")

        notes = layout.box()
        notes.label(text="Current slice")
        notes.label(text="Procedural mesh generator with Sugarmagic export")
        notes.label(text="Runtime shader still belongs in Sugarmagic")
        notes.label(text="Export is blocked on validation errors")


CLASSES = (VIEW3D_PT_foilagemaker,)


def register():
    for cls in CLASSES:
        bpy.utils.register_class(cls)


def unregister():
    for cls in reversed(CLASSES):
        bpy.utils.unregister_class(cls)
