"""
/Users/nikki/projects/sugarmagic/tooling/foilagemaker/operators.py

Purpose: Registers Blender operators for FoilageMaker tree creation and
rebuild workflows.

Status: active
"""

from __future__ import annotations

import random
from pathlib import Path

import bpy
from bpy.props import StringProperty
from bpy_extras.io_utils import ExportHelper

from . import generator


class FOILAGEMAKER_OT_create_tree(bpy.types.Operator):
    """Create a new FoilageMaker tree object."""

    bl_idname = "foilagemaker.create_tree"
    bl_label = "Create Tree"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context: bpy.types.Context):
        generator.create_tree_object(context)
        return {"FINISHED"}


class FOILAGEMAKER_OT_apply_preset(bpy.types.Operator):
    """Apply a named FoilageMaker tree preset."""

    bl_idname = "foilagemaker.apply_preset"
    bl_label = "Apply Preset"
    bl_options = {"REGISTER", "UNDO"}

    preset_name: bpy.props.StringProperty(name="Preset Name")

    @classmethod
    def poll(cls, context: bpy.types.Context) -> bool:
        return generator.is_foilagemaker_tree(context.active_object)

    def execute(self, context: bpy.types.Context):
        if self.preset_name not in generator.get_tree_preset_names():
            self.report({"WARNING"}, "Unknown FoilageMaker preset.")
            return {"CANCELLED"}

        generator.apply_tree_preset(context.active_object, self.preset_name)
        return {"FINISHED"}


class FOILAGEMAKER_OT_rebuild_tree(bpy.types.Operator):
    """Rebuild the selected FoilageMaker tree mesh."""

    bl_idname = "foilagemaker.rebuild_tree"
    bl_label = "Rebuild Tree"
    bl_options = {"REGISTER", "UNDO"}

    @classmethod
    def poll(cls, context: bpy.types.Context) -> bool:
        return generator.is_foilagemaker_tree(context.active_object)

    def execute(self, context: bpy.types.Context):
        if not generator.rebuild_active_tree(context):
            self.report({"WARNING"}, "Select a FoilageMaker tree first.")
            return {"CANCELLED"}
        return {"FINISHED"}


class FOILAGEMAKER_OT_randomize_seed(bpy.types.Operator):
    """Assign a new random seed and rebuild the selected tree."""

    bl_idname = "foilagemaker.randomize_seed"
    bl_label = "Randomize Seed"
    bl_options = {"REGISTER", "UNDO"}

    @classmethod
    def poll(cls, context: bpy.types.Context) -> bool:
        return generator.is_foilagemaker_tree(context.active_object)

    def execute(self, context: bpy.types.Context):
        obj = context.active_object
        obj.foilagemaker_tree.random_seed = random.randint(0, 999_999)
        generator.rebuild_tree_object(obj)
        return {"FINISHED"}


class FOILAGEMAKER_OT_validate_tree(bpy.types.Operator):
    """Run export-safe validation against the selected FoilageMaker tree."""

    bl_idname = "foilagemaker.validate_tree"
    bl_label = "Validate Tree"
    bl_options = {"REGISTER"}

    @classmethod
    def poll(cls, context: bpy.types.Context) -> bool:
        return generator.is_foilagemaker_tree(context.active_object)

    def execute(self, context: bpy.types.Context):
        obj = context.active_object
        generator.rebuild_tree_object(obj)
        issues = generator.validate_tree_object(obj)
        error_count, warning_count = generator.summarize_validation(issues)
        if error_count:
            self.report({"ERROR"}, f"Validation found {error_count} error(s) and {warning_count} warning(s).")
            return {"CANCELLED"}
        if warning_count:
            self.report({"WARNING"}, f"Validation found {warning_count} warning(s).")
        else:
            self.report({"INFO"}, "Validation passed with no warnings.")
        return {"FINISHED"}


class FOILAGEMAKER_OT_export_to_sugarmagic(bpy.types.Operator, ExportHelper):
    """Export the selected FoilageMaker tree as a Sugarmagic-ready package."""

    bl_idname = "foilagemaker.export_to_sugarmagic"
    bl_label = "Export to Sugarmagic"
    bl_options = {"REGISTER"}

    filename_ext = ".glb"
    filter_glob: StringProperty(default="*.glb", options={"HIDDEN"})

    @classmethod
    def poll(cls, context: bpy.types.Context) -> bool:
        return generator.is_foilagemaker_tree(context.active_object)

    def invoke(self, context: bpy.types.Context, event):
        obj = context.active_object
        if obj:
            default_name = bpy.path.clean_name(obj.name).lower().replace(" ", "_")
            self.filepath = str(Path(bpy.path.abspath("//")) / f"{default_name}.glb")
        context.window_manager.fileselect_add(self)
        return {"RUNNING_MODAL"}

    def execute(self, context: bpy.types.Context):
        obj = context.active_object
        issues = generator.validate_tree_object(obj)
        error_count, warning_count = generator.summarize_validation(issues)
        if error_count:
            self.report({"ERROR"}, f"Export blocked: {error_count} validation error(s).")
            return {"CANCELLED"}
        if warning_count:
            self.report({"WARNING"}, f"Export continuing with {warning_count} warning(s).")
        try:
            glb_path = generator.export_tree_to_sugarmagic(context, obj, self.filepath)
        except Exception as exc:
            self.report({"ERROR"}, str(exc))
            return {"CANCELLED"}

        self.report(
            {"INFO"},
            f"Exported {glb_path.name}",
        )
        return {"FINISHED"}


CLASSES = (
    FOILAGEMAKER_OT_create_tree,
    FOILAGEMAKER_OT_apply_preset,
    FOILAGEMAKER_OT_rebuild_tree,
    FOILAGEMAKER_OT_randomize_seed,
    FOILAGEMAKER_OT_validate_tree,
    FOILAGEMAKER_OT_export_to_sugarmagic,
)


def register():
    for cls in CLASSES:
        bpy.utils.register_class(cls)


def unregister():
    for cls in reversed(CLASSES):
        bpy.utils.unregister_class(cls)
