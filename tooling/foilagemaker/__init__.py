"""
/Users/nikki/projects/sugarmagic/tooling/foilagemaker/__init__.py

Purpose: Registers the FoilageMaker Blender add-on and its module boundaries.

Status: active
"""

bl_info = {
    "name": "FoilageMaker",
    "author": "Sugarmagic",
    "version": (0, 11, 2),
    "blender": (4, 0, 0),
    "location": "View3D > Sidebar > FoilageMaker",
    "description": "Create export-safe stylized procedural trees for Sugarmagic.",
    "category": "Object",
}

from . import generator, operators, props, ui


def register():
    props.register()
    operators.register()
    ui.register()


def unregister():
    ui.unregister()
    operators.unregister()
    props.unregister()
