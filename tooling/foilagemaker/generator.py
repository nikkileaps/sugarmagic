"""
/Users/nikki/projects/sugarmagic/tooling/foilagemaker/generator.py

Purpose: Owns procedural FoilageMaker tree mesh generation and object rebuild
logic for Blender authoring.

Status: active
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass, field
from pathlib import Path

import bpy
from mathutils import Quaternion, Vector

ADDON_VERSION = "0.12.1"
TREE_KIND = "tree"
OBJECT_KIND_KEY = "foilagemaker_kind"
ASSET_KIND_KEY = "sugarmagic_asset_kind"
VERSION_KEY = "foilagemaker_version"
SUPPRESS_UPDATE_KEY = "_foilagemaker_suppress_update"
LEAF_IMAGE_NAME = "FoilageMakerLeafSprite"
LEAF_COLOR_ATTRIBUTE = "FoilageMakerLeafColor"
# Custom glTF vertex attributes. The glTF 2.0 spec requires custom (user-defined)
# attribute names to start with an underscore. Blender's glTF exporter preserves
# attribute names exactly when they already start with "_", so these string
# constants must match the TSL `attribute()` calls in ShaderRuntime.ts.
SPHERE_NORMAL_ATTRIBUTE = "_SPHERE_NORMAL"
TREE_HEIGHT_ATTRIBUTE = "_TREE_HEIGHT"
DEFAULT_TREE_PRESET = "clustered_stylized"
_TREE_PRESET_LABELS = {
    "clustered_stylized": "Clustered Stylized Canopy",
    "round_deciduous": "Round Deciduous",
    "tall_pine_ish": "Tall Pine-ish",
}
_PLUGIN_DIR = Path(__file__).resolve().parent
# Bundled leaf texture library. Ships with the add-on zip under
# `foilagemaker/textures/`. Each authored tree picks which texture to use
# via its `leaf_texture_variant` property (see props.py). `mixed` mode
# atlases the first four `_transparency.png` files; a specific variant
# (`leavesTexture03` etc.) uses just that single file as the leaf sprite.
LEAF_TEXTURE_DIR = _PLUGIN_DIR / "textures"
VERTEX_WARNING_THRESHOLD = 12_000
VERTEX_ERROR_THRESHOLD = 30_000
POLYGON_WARNING_THRESHOLD = 4_000
POLYGON_ERROR_THRESHOLD = 12_000


def is_foilagemaker_tree(obj: bpy.types.Object | None) -> bool:
    return bool(obj and obj.type == "MESH" and obj.get(OBJECT_KIND_KEY) == TREE_KIND)


def create_tree_object(context: bpy.types.Context) -> bpy.types.Object:
    mesh = bpy.data.meshes.new("FoilageMakerTreeMesh")
    obj = bpy.data.objects.new("FoilageMaker Tree", mesh)
    obj[OBJECT_KIND_KEY] = TREE_KIND
    obj[ASSET_KIND_KEY] = "foliage"
    obj[VERSION_KEY] = ADDON_VERSION
    context.collection.objects.link(obj)
    context.view_layer.objects.active = obj
    obj.select_set(True)
    apply_tree_preset(obj, DEFAULT_TREE_PRESET)
    return obj


def rebuild_tree_object(obj: bpy.types.Object) -> None:
    if not is_foilagemaker_tree(obj):
        return

    props = obj.foilagemaker_tree
    buffers = _build_tree_mesh(props, tree_obj=obj)
    mesh = obj.data
    mesh.clear_geometry()
    mesh.from_pydata(buffers.verts, [], buffers.faces)
    mesh.update(calc_edges=True)
    mesh.validate(verbose=False)
    _assign_materials(obj)

    for index, polygon in enumerate(mesh.polygons):
        if index < len(buffers.face_materials):
            polygon.material_index = buffers.face_materials[index]
        if index < len(buffers.face_smooth):
            polygon.use_smooth = buffers.face_smooth[index]

    _finalize_tree_height(buffers)
    _apply_uvs(mesh, buffers)
    _apply_vertex_colors(mesh, buffers)
    _apply_sphere_normal_attribute(mesh, buffers)
    _apply_tree_height_attribute(mesh, buffers)
    _apply_custom_normals(mesh, buffers)

    obj[ASSET_KIND_KEY] = "foliage"
    obj[VERSION_KEY] = ADDON_VERSION
    obj["foilagemaker_wind_scale"] = props.wind_scale
    obj["foilagemaker_wind_speed"] = props.wind_speed
    obj["foilagemaker_big_wind_multiplier"] = props.big_wind_multiplier
    obj["foilagemaker_small_wind_multiplier"] = props.small_wind_multiplier
    obj["foilagemaker_leaf_color_attribute"] = LEAF_COLOR_ATTRIBUTE
    obj["foilagemaker_leaf_color_rgb"] = "canopy_tint_gradient"
    obj["foilagemaker_leaf_color_alpha"] = "sun_exterior_bias"
    obj["foilagemaker_uv_layer"] = "UVMap"


def rebuild_active_tree(context: bpy.types.Context) -> bool:
    obj = context.active_object
    if not is_foilagemaker_tree(obj):
        return False

    rebuild_tree_object(obj)
    return True


def apply_tree_preset(obj: bpy.types.Object, preset_name: str) -> None:
    if not is_foilagemaker_tree(obj):
        return

    presets = _get_tree_presets()
    values = presets.get(preset_name)
    if not values:
        return

    obj[SUPPRESS_UPDATE_KEY] = True
    try:
        props = obj.foilagemaker_tree
        for key, value in values.items():
            setattr(props, key, value)
    finally:
        obj[SUPPRESS_UPDATE_KEY] = False

    rebuild_tree_object(obj)


def get_tree_preset_names() -> list[str]:
    return list(_get_tree_presets().keys())


def get_tree_preset_label(preset_name: str) -> str:
    return _TREE_PRESET_LABELS.get(preset_name, preset_name.replace("_", " ").title())


def validate_tree_object(obj: bpy.types.Object | None) -> list[dict[str, str]]:
    issues: list[dict[str, str]] = []
    if not is_foilagemaker_tree(obj):
        issues.append(
            {
                "severity": "error",
                "message": "Select a FoilageMaker tree before validating or exporting.",
            }
        )
        return issues

    mesh = obj.data
    materials = {material.name for material in mesh.materials if material}
    color_attributes = {attribute.name for attribute in mesh.color_attributes}
    uv_layers = {layer.name for layer in mesh.uv_layers}
    props = obj.foilagemaker_tree

    if "UVMap" not in uv_layers:
        issues.append(
            {
                "severity": "error",
                "message": "Mesh is missing the UVMap layer required by the foliage shader.",
            }
        )
    if LEAF_COLOR_ATTRIBUTE not in color_attributes:
        issues.append(
            {
                "severity": "error",
                "message": "Mesh is missing the FoilageMakerLeafColor attribute required for foliage tinting.",
            }
        )
    if not getattr(mesh, "has_custom_normals", False):
        issues.append(
            {
                "severity": "error",
                "message": "Mesh is missing custom normals, so canopy soft-shading data would be lost.",
            }
        )
    if "FoilageMaker Trunk" not in materials or "FoilageMaker Leaves" not in materials:
        issues.append(
            {
                "severity": "error",
                "message": "Tree must have both trunk and leaf material slots before export.",
            }
        )
    if bpy.data.images.get(LEAF_IMAGE_NAME) is None:
        issues.append(
            {
                "severity": "warning",
                "message": "Leaf atlas image is missing in the current Blender session and will be regenerated on rebuild.",
            }
        )

    vertex_count = len(mesh.vertices)
    polygon_count = len(mesh.polygons)
    if vertex_count > VERTEX_ERROR_THRESHOLD:
        issues.append(
            {
                "severity": "error",
                "message": f"Vertex count {vertex_count} exceeds the hard budget of {VERTEX_ERROR_THRESHOLD}.",
            }
        )
    elif vertex_count > VERTEX_WARNING_THRESHOLD:
        issues.append(
            {
                "severity": "warning",
                "message": f"Vertex count {vertex_count} exceeds the soft budget of {VERTEX_WARNING_THRESHOLD}.",
            }
        )

    if polygon_count > POLYGON_ERROR_THRESHOLD:
        issues.append(
            {
                "severity": "error",
                "message": f"Polygon count {polygon_count} exceeds the hard budget of {POLYGON_ERROR_THRESHOLD}.",
            }
        )
    elif polygon_count > POLYGON_WARNING_THRESHOLD:
        issues.append(
            {
                "severity": "warning",
                "message": f"Polygon count {polygon_count} exceeds the soft budget of {POLYGON_WARNING_THRESHOLD}.",
            }
        )

    if props.leaf_count < 16:
        issues.append(
            {
                "severity": "warning",
                "message": "Leaf count is very low; exported trees may read sparse in-game.",
            }
        )

    return issues


def summarize_validation(issues: list[dict[str, str]]) -> tuple[int, int]:
    errors = sum(1 for issue in issues if issue["severity"] == "error")
    warnings = sum(1 for issue in issues if issue["severity"] == "warning")
    return errors, warnings


def export_tree_to_sugarmagic(
    context: bpy.types.Context,
    obj: bpy.types.Object,
    glb_path: str | Path,
) -> Path:
    if not is_foilagemaker_tree(obj):
        raise ValueError("Active object is not a FoilageMaker tree.")

    rebuild_tree_object(obj)
    issues = validate_tree_object(obj)
    error_count, warning_count = summarize_validation(issues)
    if error_count:
        messages = "; ".join(issue["message"] for issue in issues if issue["severity"] == "error")
        raise ValueError(f"Export blocked by validation errors: {messages}")

    export_path = Path(glb_path)
    if export_path.suffix.lower() != ".glb":
        export_path = export_path.with_suffix(".glb")
    export_path.parent.mkdir(parents=True, exist_ok=True)

    previous_active = context.view_layer.objects.active
    previous_selection = list(context.selected_objects)
    export_object = _create_export_object(context, obj)

    try:
        bpy.ops.object.select_all(action="DESELECT")
        export_object.select_set(True)
        context.view_layer.objects.active = export_object
        bpy.ops.export_scene.gltf(
            filepath=str(export_path),
            export_format="GLB",
            use_selection=True,
            export_apply=True,
            export_texcoords=True,
            export_normals=True,
            export_tangents=False,
            export_attributes=True,
            export_all_vertex_colors=True,
            export_vertex_color="ACTIVE",
            export_active_vertex_color_when_no_material=True,
            export_materials="EXPORT",
            export_extras=True,
            export_image_format="AUTO",
            export_yup=True,
        )
    finally:
        if export_object.name in bpy.data.objects:
            bpy.data.objects.remove(export_object, do_unlink=True)
        bpy.ops.object.select_all(action="DESELECT")
        for selected in previous_selection:
            if selected and selected.name in bpy.data.objects:
                selected.select_set(True)
        if previous_active and previous_active.name in bpy.data.objects:
            context.view_layer.objects.active = previous_active

    return export_path


@dataclass
class _MeshBuffers:
    verts: list[tuple[float, float, float]] = field(default_factory=list)
    vertex_colors: list[tuple[float, float, float, float]] = field(default_factory=list)
    vertex_normal_overrides: list[Vector | None] = field(default_factory=list)
    # Fake per-cluster "sphere normal" for painterly lighting. Leaf-card vertices
    # store normalize(vertexPos - clusterCenter); trunk vertices keep (0,0,0)
    # (sampled via lerp against world-normal in the shader so the trunk falls
    # through to using its real surface normal).
    vertex_sphere_normals: list[tuple[float, float, float]] = field(default_factory=list)
    # Post-pass 0..1 altitude within the tree. 0 at base of trunk, 1 at top
    # of highest canopy cluster. Drives the tree-wide top-warm / bottom-cool
    # color gradient in the foliage-surface shader.
    vertex_tree_height: list[float] = field(default_factory=list)
    faces: list[tuple[int, ...]] = field(default_factory=list)
    face_materials: list[int] = field(default_factory=list)
    face_smooth: list[bool] = field(default_factory=list)
    face_uvs: list[list[tuple[float, float]] | None] = field(default_factory=list)

    def add_face(
        self,
        face: tuple[int, ...],
        material_index: int,
        smooth: bool = True,
        uv_coords: list[tuple[float, float]] | None = None,
    ) -> None:
        self.faces.append(face)
        self.face_materials.append(material_index)
        self.face_smooth.append(smooth)
        self.face_uvs.append(uv_coords)


def _build_tree_mesh(
    props,
    tree_obj: bpy.types.Object | None = None,
) -> _MeshBuffers:
    rng = random.Random(int(props.random_seed))
    buffers = _MeshBuffers()
    leaf_variant_count = _get_leaf_variant_count()

    trunk_points = _build_trunk_points(props, rng)
    trunk_radii = _build_trunk_radii(props, len(trunk_points))

    _add_tapered_path(
        buffers=buffers,
        points=trunk_points,
        radii=trunk_radii,
        sides=max(6, int(props.trunk_sides)),
        material_index=0,
        cap_start=True,
        cap_end=False,
    )

    leaf_tips: list[Vector] = []
    canopy_center = trunk_points[-1].copy()

    for branch_index in range(max(0, int(props.branch_count))):
        branch_seed = int(props.random_seed) * 1009 + branch_index * 917 + 17
        branch_rng = random.Random(branch_seed)
        branch_points, branch_radius = _build_branch_points(
            branch_index, trunk_points, props, branch_rng
        )
        _add_tapered_path(
            buffers=buffers,
            points=branch_points,
            radii=_linear_radii(branch_radius, branch_radius * 0.2, len(branch_points)),
            sides=max(4, int(props.branch_sides)),
            material_index=0,
            cap_start=False,
            cap_end=True,
        )
        leaf_tips.append(branch_points[-1])

        secondary_count = max(0, int(props.secondary_branch_count))
        for secondary_index in range(secondary_count):
            secondary_points, secondary_radius = _build_secondary_branch_points(
                branch_points, props, branch_rng, secondary_index
            )
            _add_tapered_path(
                buffers=buffers,
                points=secondary_points,
                radii=_linear_radii(
                    secondary_radius,
                    max(secondary_radius * 0.15, 0.0025),
                    len(secondary_points),
                ),
                sides=max(3, int(props.secondary_branch_sides)),
                material_index=0,
                cap_start=False,
                cap_end=True,
            )
            leaf_tips.append(secondary_points[-1])

    # 0.15.0 canopy pipeline: scatter leaves on a procedural shape mesh.
    # The shape mesh is a staging structure only — leaves are the output,
    # the shape itself never ends up in the exported GLB or the Blender
    # viewport. Silhouette is guaranteed to match the chosen shape.
    _scatter_leaves_on_canopy_shape(
        buffers=buffers,
        canopy_center=canopy_center,
        props=props,
        rng=rng,
        leaf_variant_count=leaf_variant_count,
        tree_obj=tree_obj,
    )

    return buffers


def _build_trunk_points(props, rng: random.Random) -> list[Vector]:
    points = [Vector((0.0, 0.0, 0.0))]
    lateral = Vector((0.0, 0.0, 0.0))
    segment_count = max(2, int(props.trunk_segments))
    for segment in range(1, segment_count + 1):
        t = segment / segment_count
        step = props.trunk_height / segment_count
        angle = rng.uniform(0.0, math.tau)
        displacement = (
            props.trunk_displacement_strength
            * max(0.1, props.trunk_displacement_scale)
            * t
            / segment_count
        )
        lateral += Vector((math.cos(angle), math.sin(angle), 0.0)) * displacement
        points.append(Vector((lateral.x, lateral.y, step * segment)))
    return points


def _build_trunk_radii(props, point_count: int) -> list[float]:
    radii: list[float] = []
    denominator = max(point_count - 1, 1)
    for index in range(point_count):
        t = index / denominator
        taper_scale = max(0.12, 1.0 - (props.trunk_taper * t))
        if t < props.base_flare_position:
            base_t = 1.0 - (t / max(props.base_flare_position, 0.001))
            flare_scale = 1.0 + (props.base_flare_scale - 1.0) * base_t
        else:
            flare_scale = 1.0
        radii.append(max(0.01, props.trunk_radius * taper_scale * flare_scale))
    return radii


def _build_branch_points(
    branch_index: int,
    trunk_points: list[Vector],
    props,
    rng: random.Random,
) -> tuple[list[Vector], float]:
    base_t = props.branch_start + rng.random() * max(0.0, 1.0 - props.branch_start)
    start, tangent = _sample_path(trunk_points, base_t)
    angle = (
        (math.tau * branch_index / max(1, int(props.branch_count)))
        + props.branch_angle_offset
        + rng.uniform(-0.45, 0.45)
    )
    outward = Vector((math.cos(angle), math.sin(angle), 0.0))
    upward = Vector((0.0, 0.0, 1.0))
    direction = outward.lerp(upward, props.branch_up_bias).normalized()
    direction = direction.lerp(tangent.normalized(), 0.2).normalized()

    length_variation = 1.0 + rng.uniform(
        -props.branch_length_randomness, props.branch_length_randomness
    )
    length = props.branch_length * length_variation * (0.6 + (1.0 - base_t) * 0.4)
    length = max(length, props.trunk_radius * 2.0)

    segment_count = max(2, int(props.branch_segments))
    points = [start]
    for segment in range(1, segment_count + 1):
        u = segment / segment_count
        bend = direction.lerp(upward, u * 0.35).normalized()
        sideways = _basis_right(direction) * rng.uniform(-0.08, 0.08) * length * u
        point = (
            start
            + bend * (length * u)
            + upward * (length * 0.12 * u * u)
            + sideways
        )
        points.append(point)

    return points, max(props.branch_radius, 0.01)


def _build_secondary_branch_points(
    branch_points: list[Vector],
    props,
    rng: random.Random,
    secondary_index: int,
) -> tuple[list[Vector], float]:
    u = rng.uniform(0.25, 0.85)
    start, tangent = _sample_path(branch_points, u)
    right = _basis_right(tangent)
    around = Quaternion(
        tangent.normalized(),
        math.tau * secondary_index / max(1, props.secondary_branch_count),
    )
    lateral = around @ right
    upward = Vector((0.0, 0.0, 1.0))
    direction = (
        tangent.normalized() * 0.45 + lateral * 0.8 + upward * 0.35
    ).normalized()

    length_variation = 1.0 + rng.uniform(
        -props.secondary_branch_randomness, props.secondary_branch_randomness
    )
    length = max(
        props.secondary_branch_length * length_variation,
        props.secondary_branch_radius * 8.0,
    )

    segment_count = max(2, int(props.secondary_branch_segments))
    points = [start]
    for segment in range(1, segment_count + 1):
        ratio = segment / segment_count
        bend = direction.lerp(upward, ratio * 0.25).normalized()
        point = start + bend * (length * ratio) + upward * (length * 0.08 * ratio * ratio)
        points.append(point)

    return points, max(props.secondary_branch_radius, 0.005)


def _scatter_leaves_on_canopy_shape(
    buffers: _MeshBuffers,
    canopy_center: Vector,
    props,
    rng: random.Random,
    leaf_variant_count: int,
    tree_obj: bpy.types.Object | None = None,
) -> None:
    """Build a procedural canopy shape (sphere / cone / teardrop), scatter
    leaf cards across its surface, and write the resulting leaf geometry
    into `buffers`.

    The shape mesh itself is a STAGING structure — it lives only inside
    this function, feeds position/normal data into the leaf-card generator,
    and is discarded. Only the leaf cards end up in the output mesh (and
    therefore in the exported GLB). Silhouette is guaranteed to match the
    chosen shape because leaves can only land on its surface.
    """
    horizontal_radius = max(0.05, float(getattr(props, "canopy_size", 1.1)))
    vertical_scale = max(0.1, float(getattr(props, "canopy_vertical_scale", 1.2)))
    # canopy_base_offset is in Blender units, not a fraction of canopy
    # size. That means a value of -3 literally drops the canopy base 3
    # meters below the trunk top regardless of how big the canopy is —
    # which is what authors actually want when lining the canopy up with
    # where branches start.
    base_offset = float(getattr(props, "canopy_base_offset", -0.2))
    shape_kind = str(getattr(props, "canopy_shape", "sphere"))
    leaf_count = max(8, int(getattr(props, "leaf_count", 140)))

    canopy_base_z = canopy_center.z + base_offset
    shape_center = Vector((canopy_center.x, canopy_center.y, canopy_base_z))

    if shape_kind == "custom":
        custom_collection = getattr(props, "canopy_custom_collection", None)
        shape_verts, shape_tris = _extract_custom_shape_mesh(
            custom_collection, tree_obj
        )
        if not shape_verts or not shape_tris:
            # Collection empty, unset, or contains no valid mesh objects.
            # Fall back to a sphere so the author still sees a canopy
            # instead of a bald trunk, signaling visually that nothing's
            # wired up yet.
            shape_verts, shape_tris = _build_sphere_shape_mesh(
                shape_center, horizontal_radius, vertical_scale
            )
    elif shape_kind == "cone":
        shape_verts, shape_tris = _build_cone_shape_mesh(
            shape_center, horizontal_radius, vertical_scale
        )
    elif shape_kind == "teardrop":
        shape_verts, shape_tris = _build_teardrop_shape_mesh(
            shape_center, horizontal_radius, vertical_scale
        )
    else:  # sphere / default
        shape_verts, shape_tris = _build_sphere_shape_mesh(
            shape_center, horizontal_radius, vertical_scale
        )

    points = _scatter_points_on_mesh(shape_verts, shape_tris, leaf_count, rng)
    if not points:
        return

    # Canopy z-bounds for leaf-color height gradient. Using the actual
    # scatter-point span (not the shape mesh bounds) gives the top-of-
    # canopy vs. bottom-of-canopy colors the right reference even if the
    # scatter happens to miss the pole of the shape.
    z_min = min(p[0].z for p in points)
    z_max = max(p[0].z for p in points)
    z_range = max(0.001, z_max - z_min)

    # Reference centroid for the `_SPHERE_NORMAL` vertex attribute bake.
    # The foliage shader in Sugarmagic uses it as the anchor from which it
    # derives a smooth per-cluster-style normal. For scatter-on-shape the
    # shape centroid is the right reference — it makes every scattered
    # leaf shade as if it were on the surface of the shape "sphere."
    shape_centroid = Vector((0.0, 0.0, 0.0))
    for v in shape_verts:
        shape_centroid += v
    if shape_verts:
        shape_centroid /= len(shape_verts)

    for point, normal in points:
        top_factor = _clamp01((point.z - z_min) / z_range)
        color = _sample_scattered_leaf_color(top_factor, rng)
        # Light outward push so leaf cards don't ride exactly on the shape
        # surface — slight offset reads as fluff and avoids Z-fighting when
        # neighboring cards share a triangle face.
        jitter_push = rng.uniform(0.0, props.leaf_size * 0.08)
        _add_leaf_spray(
            buffers=buffers,
            center=point + normal * jitter_push,
            normal=normal,
            cluster_center=shape_centroid,
            leaf_size=props.leaf_size * rng.uniform(0.72, 1.2),
            leaf_width_bias=props.leaf_width * rng.uniform(0.9, 1.1),
            leaf_height_bias=props.leaf_height * rng.uniform(0.9, 1.1),
            card_count=max(2, int(props.leaf_card_count)),
            material_index=1,
            color_hint=color,
            rng=rng,
            leaf_variant_count=leaf_variant_count,
        )


# ── Procedural canopy shape meshes ──────────────────────────────────────
# All three shape generators share the same "rings of segments" topology,
# so they can feed a single _scatter_points_on_mesh pass. They return
# (vertices, triangles) where triangles are (i0, i1, i2) tuples referring
# into the vertex list.

_SHAPE_MESH_RINGS = 14
_SHAPE_MESH_SEGMENTS = 24


def _build_sphere_shape_mesh(
    base_center: Vector,
    horizontal_radius: float,
    vertical_scale: float,
) -> tuple[list[Vector], list[tuple[int, int, int]]]:
    # Sphere whose BOTTOM (south pole) sits at base_center. Total vertical
    # extent is horizontal_radius * vertical_scale * 2 (the "diameter"
    # along Z), matching the intuition that a vertical_scale of 1 makes
    # a ball as tall as it is wide.
    vertical_radius = horizontal_radius * vertical_scale
    verts: list[Vector] = []
    for ring in range(_SHAPE_MESH_RINGS + 1):
        lat = (ring / _SHAPE_MESH_RINGS) * math.pi - math.pi / 2  # -π/2 .. +π/2
        ring_factor = math.cos(lat)
        z = base_center.z + vertical_radius * (math.sin(lat) + 1.0)  # shift so south pole sits at base
        for seg in range(_SHAPE_MESH_SEGMENTS):
            angle = math.tau * seg / _SHAPE_MESH_SEGMENTS
            verts.append(
                Vector(
                    (
                        base_center.x + horizontal_radius * ring_factor * math.cos(angle),
                        base_center.y + horizontal_radius * ring_factor * math.sin(angle),
                        z,
                    )
                )
            )
    return verts, _shape_mesh_tris(_SHAPE_MESH_RINGS, _SHAPE_MESH_SEGMENTS)


def _build_cone_shape_mesh(
    base_center: Vector,
    base_radius: float,
    vertical_scale: float,
) -> tuple[list[Vector], list[tuple[int, int, int]]]:
    # Cone with base disc at base_center, apex at base_center +
    # (0, 0, base_radius * vertical_scale). Linear taper — the most direct
    # way to produce a triangular silhouette.
    apex_height = base_radius * vertical_scale
    verts: list[Vector] = []
    for ring in range(_SHAPE_MESH_RINGS + 1):
        t = ring / _SHAPE_MESH_RINGS
        radius = base_radius * (1.0 - t)
        z = base_center.z + apex_height * t
        for seg in range(_SHAPE_MESH_SEGMENTS):
            angle = math.tau * seg / _SHAPE_MESH_SEGMENTS
            verts.append(
                Vector(
                    (
                        base_center.x + radius * math.cos(angle),
                        base_center.y + radius * math.sin(angle),
                        z,
                    )
                )
            )
    return verts, _shape_mesh_tris(_SHAPE_MESH_RINGS, _SHAPE_MESH_SEGMENTS)


def _build_teardrop_shape_mesh(
    base_center: Vector,
    horizontal_radius: float,
    vertical_scale: float,
) -> tuple[list[Vector], list[tuple[int, int, int]]]:
    # Teardrop: rounded (hemisphere-ish) lower third, linear taper to a
    # point across the upper two thirds. Softer than a pure cone — reads
    # as stylized deciduous rather than conifer.
    total_height = horizontal_radius * vertical_scale
    # Round-base cutoff: 0.35 means the lower 35% of the height follows a
    # half-sphere curve (wider at base, swelling to max radius); the
    # remaining 65% tapers linearly to zero.
    round_base_fraction = 0.35
    verts: list[Vector] = []
    for ring in range(_SHAPE_MESH_RINGS + 1):
        t = ring / _SHAPE_MESH_RINGS
        if t < round_base_fraction:
            # Hemisphere-like swell from 0 up to horizontal_radius over the
            # first round_base_fraction of height.
            s = t / round_base_fraction  # 0..1 within the round region
            radius = horizontal_radius * math.sin(s * math.pi / 2)
        else:
            # Linear taper from max radius down to 0.
            s = (t - round_base_fraction) / (1.0 - round_base_fraction)
            radius = horizontal_radius * (1.0 - s)
        z = base_center.z + total_height * t
        for seg in range(_SHAPE_MESH_SEGMENTS):
            angle = math.tau * seg / _SHAPE_MESH_SEGMENTS
            verts.append(
                Vector(
                    (
                        base_center.x + radius * math.cos(angle),
                        base_center.y + radius * math.sin(angle),
                        z,
                    )
                )
            )
    return verts, _shape_mesh_tris(_SHAPE_MESH_RINGS, _SHAPE_MESH_SEGMENTS)


def _extract_custom_shape_mesh(
    custom_collection: bpy.types.Collection | None,
    tree_obj: bpy.types.Object | None,
) -> tuple[list[Vector], list[tuple[int, int, int]]]:
    """Combine every mesh object in `custom_collection` (recursively) into a
    single (vertices, triangles) buffer for leaf scattering.

    The caller scatters points on this combined surface; because points
    are weighted by triangle area, bigger meshes in the collection
    naturally get proportionally more leaves. Each mesh's own world
    transform is honored independently — the author can position/rotate/
    scale each piece freely in the viewport.

    Vertices are returned in TREE-LOCAL space. The transform chain per
    source mesh is: object-local → world (object.matrix_world) →
    tree-local (inverse of tree_obj.matrix_world). That keeps leaf
    positions consistent no matter where the tree's own origin sits.

    Filters applied:
      - Only MESH-type objects are processed (lights / empties / curves
        in the collection are silently ignored).
      - FoilageMaker trees are filtered out so a tree that shares a
        collection with its canopy meshes doesn't accidentally scatter
        leaves on its own trunk (and doesn't create a rebuild feedback
        loop).
      - `all_objects` is used so nested sub-collections count too.

    Each source mesh is evaluated through the depsgraph, so modifiers and
    shape-key deforms are baked in — authors can sculpt live and see the
    scatter track.

    Faces with more than 3 verts are fan-triangulated. Correct for
    convex polygons; concave n-gons could produce slightly off tris, but
    authored canopy shapes are essentially always convex.
    """
    if custom_collection is None:
        return [], []

    tree_world_matrix = (
        tree_obj.matrix_world if tree_obj is not None else None
    )
    tree_world_inverse = (
        tree_world_matrix.inverted() if tree_world_matrix is not None else None
    )
    depsgraph = bpy.context.evaluated_depsgraph_get()

    combined_verts: list[Vector] = []
    combined_tris: list[tuple[int, int, int]] = []

    for obj in custom_collection.all_objects:
        if obj is None or obj.type != "MESH":
            continue
        if obj.get(OBJECT_KIND_KEY) == TREE_KIND:
            # Don't scatter on other FoilageMaker trees — would produce
            # leaves on their trunks and, if the OWN tree shares this
            # collection, a rebuild feedback loop.
            continue

        evaluated = obj.evaluated_get(depsgraph)
        try:
            eval_mesh = evaluated.to_mesh()
        except RuntimeError:
            continue
        if eval_mesh is None:
            continue

        try:
            if tree_world_inverse is not None:
                transform = tree_world_inverse @ obj.matrix_world
            else:
                transform = obj.matrix_world

            base_index = len(combined_verts)
            for vertex in eval_mesh.vertices:
                combined_verts.append(transform @ vertex.co)

            for polygon in eval_mesh.polygons:
                loop_indices = list(polygon.loop_indices)
                if len(loop_indices) < 3:
                    continue
                vert_indices = [
                    base_index + eval_mesh.loops[li].vertex_index
                    for li in loop_indices
                ]
                # Fan-triangulate (v0, vi, vi+1) for i in [1 .. n-2].
                for i in range(1, len(vert_indices) - 1):
                    combined_tris.append(
                        (vert_indices[0], vert_indices[i], vert_indices[i + 1])
                    )
        finally:
            # Release the evaluated mesh copy — leaking these accumulates
            # memory and can crash Blender across many rebuilds.
            evaluated.to_mesh_clear()

    return combined_verts, combined_tris


def _shape_mesh_tris(
    rings: int, segments: int
) -> list[tuple[int, int, int]]:
    """Stitch a ring * segments vertex grid into a triangulated surface.

    Emits two triangles per quad. Zero-area degenerate triangles at the
    poles (where several vertices collapse to the same point) are harmless
    because the scatter pass filters them out by area threshold.
    """
    tris: list[tuple[int, int, int]] = []
    for ring in range(rings):
        for seg in range(segments):
            next_seg = (seg + 1) % segments
            v00 = ring * segments + seg
            v01 = ring * segments + next_seg
            v10 = (ring + 1) * segments + seg
            v11 = (ring + 1) * segments + next_seg
            tris.append((v00, v10, v11))
            tris.append((v00, v11, v01))
    return tris


def _scatter_points_on_mesh(
    verts: list[Vector],
    tris: list[tuple[int, int, int]],
    count: int,
    rng: random.Random,
) -> list[tuple[Vector, Vector]]:
    """Distribute `count` points randomly across the surface, weighted by
    triangle area (uniform density per unit area). Returns (position,
    normal) pairs.
    """
    if count <= 0 or not tris or not verts:
        return []

    tri_data: list[tuple[Vector, Vector, Vector, float, Vector]] = []
    cumulative_areas: list[float] = []
    running_total = 0.0
    for tri in tris:
        v0, v1, v2 = verts[tri[0]], verts[tri[1]], verts[tri[2]]
        edge1 = v1 - v0
        edge2 = v2 - v0
        cross = edge1.cross(edge2)
        area = cross.length * 0.5
        if area < 1e-9:
            continue
        normal = cross.normalized()
        tri_data.append((v0, v1, v2, area, normal))
        running_total += area
        cumulative_areas.append(running_total)

    if not tri_data or running_total <= 0.0:
        return []

    results: list[tuple[Vector, Vector]] = []
    for _ in range(count):
        target = rng.uniform(0.0, running_total)
        # Linear search over cumulative areas — N is small (N_rings * N_segments
        # * 2, typically < 700), so bisect-vs-linear doesn't meaningfully matter.
        chosen_index = 0
        for i, cumulative in enumerate(cumulative_areas):
            if cumulative >= target:
                chosen_index = i
                break
        v0, v1, v2, _area, normal = tri_data[chosen_index]
        # Uniform barycentric sampling over the triangle: reflect if the
        # (u, v) lands in the opposite triangle of the parallelogram.
        u = rng.random()
        v = rng.random()
        if u + v > 1.0:
            u = 1.0 - u
            v = 1.0 - v
        w = 1.0 - u - v
        point = v0 * w + v1 * u + v2 * v
        results.append((point, normal))
    return results


def _sample_scattered_leaf_color(
    top_factor: float,
    rng: random.Random,
) -> tuple[float, float, float, float]:
    """Vertex color for a leaf card on the canopy shape.

    RGB: cool/dark at the canopy base, bright/warm at the top, with a
    small per-leaf random nudge so batches don't render as a solid flat
    tint. Alpha: "exterior bias" gate used by the foliage shader's warm-
    sun term. Scattered leaves are all on the exterior of the shape
    surface, so we use a single high-ish bias rather than the old
    interior/exterior split.
    """
    top_factor = _clamp01(top_factor)
    bottom_color = Vector((0.21, 0.41, 0.16))
    top_color = Vector((0.73, 0.88, 0.44))
    color = bottom_color.lerp(top_color, pow(top_factor, 0.9))
    jitter = Vector(
        (
            rng.uniform(0.88, 1.05),
            rng.uniform(0.92, 1.08),
            rng.uniform(0.86, 1.02),
        )
    )
    color = Vector((color.x * jitter.x, color.y * jitter.y, color.z * jitter.z))
    exterior_bias = 0.78
    return (_clamp01(color.x), _clamp01(color.y), _clamp01(color.z), exterior_bias)


def _add_leaf_spray(
    buffers: _MeshBuffers,
    center: Vector,
    normal: Vector,
    cluster_center: Vector,
    leaf_size: float,
    leaf_width_bias: float,
    leaf_height_bias: float,
    card_count: int,
    material_index: int,
    color_hint: tuple[float, float, float, float],
    rng: random.Random,
    leaf_variant_count: int,
) -> None:
    normal = normal.normalized()
    for card_index in range(card_count):
        rotation = rng.uniform(0.0, math.tau) + (math.pi / max(1, card_count)) * card_index
        tilt_axis = _basis_right(normal)
        card_normal = (Quaternion(tilt_axis, rng.uniform(-0.35, 0.35)) @ normal).normalized()
        card_center = center + normal * rng.uniform(-leaf_size * 0.05, leaf_size * 0.05)
        scale = rng.uniform(0.88, 1.14)
        variant_index = rng.randrange(max(1, leaf_variant_count))
        _add_leaf_card(
            buffers=buffers,
            center=card_center,
            normal=card_normal,
            cluster_center=cluster_center,
            height=leaf_size * _resolve_leaf_dimension_scale(leaf_height_bias) * scale,
            width=leaf_size * _resolve_leaf_dimension_scale(leaf_width_bias) * scale,
            rotation=rotation,
            material_index=material_index,
            color_hint=color_hint,
            uv_rect=_resolve_leaf_uv_rect(variant_index, leaf_variant_count),
        )


def _add_tapered_path(
    buffers: _MeshBuffers,
    points: list[Vector],
    radii: list[float],
    sides: int,
    material_index: int,
    cap_start: bool,
    cap_end: bool,
) -> None:
    if len(points) < 2:
        return

    rings: list[list[int]] = []
    for index, point in enumerate(points):
        if index == len(points) - 1:
            tangent = (points[index] - points[index - 1]).normalized()
        else:
            tangent = (points[index + 1] - points[index]).normalized()
        right = _basis_right(tangent)
        forward = tangent.cross(right).normalized()
        ring: list[int] = []
        for side in range(sides):
            angle = math.tau * side / sides
            offset = (right * math.cos(angle) + forward * math.sin(angle)) * radii[index]
            ring.append(
                _append_vertex(
                    buffers,
                    point + offset,
                    color=(0.5, 0.35, 0.2, 1.0),
                )
            )
        rings.append(ring)

    for index in range(len(rings) - 1):
        ring_a = rings[index]
        ring_b = rings[index + 1]
        for side in range(sides):
            next_side = (side + 1) % sides
            buffers.add_face(
                (
                    ring_a[side],
                    ring_a[next_side],
                    ring_b[next_side],
                    ring_b[side],
                ),
                material_index,
                smooth=True,
            )

    if cap_start:
        _add_ring_cap(buffers, points[0], rings[0], material_index, invert=True)
    if cap_end:
        _add_ring_cap(buffers, points[-1], rings[-1], material_index, invert=False)


def _add_ring_cap(
    buffers: _MeshBuffers,
    center: Vector,
    ring: list[int],
    material_index: int,
    invert: bool,
) -> None:
    center_index = _append_vertex(buffers, center, color=(0.5, 0.35, 0.2, 1.0))
    for index in range(len(ring)):
        next_index = (index + 1) % len(ring)
        if invert:
            face = (center_index, ring[next_index], ring[index])
        else:
            face = (center_index, ring[index], ring[next_index])
        buffers.add_face(face, material_index, smooth=True)


def _add_leaf_card(
    buffers: _MeshBuffers,
    center: Vector,
    normal: Vector,
    cluster_center: Vector,
    height: float,
    width: float,
    rotation: float,
    material_index: int,
    color_hint: tuple[float, float, float, float],
    uv_rect: tuple[float, float, float, float],
) -> None:
    normal = normal.normalized()
    right = _basis_right(normal)
    up = normal.cross(right).normalized()
    rotation_q = Quaternion(normal, rotation)
    right = rotation_q @ right
    up = rotation_q @ up

    half_width = width * 0.5
    half_height = height * 0.5
    p0 = center - right * half_width - up * half_height
    p1 = center + right * half_width - up * half_height
    p2 = center + right * half_width + up * half_height
    p3 = center - right * half_width + up * half_height
    v0 = _append_vertex(
        buffers,
        p0,
        color_hint,
        normal_override=normal,
        sphere_normal=_sphere_normal_for(p0, cluster_center),
    )
    v1 = _append_vertex(
        buffers,
        p1,
        color_hint,
        normal_override=normal,
        sphere_normal=_sphere_normal_for(p1, cluster_center),
    )
    v2 = _append_vertex(
        buffers,
        p2,
        color_hint,
        normal_override=normal,
        sphere_normal=_sphere_normal_for(p2, cluster_center),
    )
    v3 = _append_vertex(
        buffers,
        p3,
        color_hint,
        normal_override=normal,
        sphere_normal=_sphere_normal_for(p3, cluster_center),
    )
    uv_u0, uv_v0, uv_u1, uv_v1 = uv_rect
    buffers.add_face(
        (v0, v1, v2, v3),
        material_index,
        smooth=True,
        uv_coords=[
            (uv_u0, uv_v0),
            (uv_u1, uv_v0),
            (uv_u1, uv_v1),
            (uv_u0, uv_v1),
        ],
    )


def _append_vertex(
    buffers: _MeshBuffers,
    position: Vector,
    color: tuple[float, float, float, float] = (1.0, 1.0, 1.0, 1.0),
    normal_override: Vector | None = None,
    sphere_normal: tuple[float, float, float] | None = None,
) -> int:
    buffers.verts.append((position.x, position.y, position.z))
    buffers.vertex_colors.append(color)
    buffers.vertex_normal_overrides.append(normal_override.copy() if normal_override else None)
    # (0,0,0) signals "no sphere normal for this vertex" — the foliage shader
    # falls back to the real world-normal for trunk/branch vertices via a
    # length check so the painterly look stays on leaves only.
    buffers.vertex_sphere_normals.append(sphere_normal or (0.0, 0.0, 0.0))
    buffers.vertex_tree_height.append(0.0)  # filled in by post-pass
    return len(buffers.verts) - 1


def _sphere_normal_for(
    position: Vector, cluster_center: Vector
) -> tuple[float, float, float]:
    offset = position - cluster_center
    if offset.length < 1e-5:
        return (0.0, 0.0, 1.0)
    n = offset.normalized()
    return (n.x, n.y, n.z)


def _apply_uvs(mesh: bpy.types.Mesh, buffers: _MeshBuffers) -> None:
    uv_layer = mesh.uv_layers.get("UVMap") or mesh.uv_layers.new(name="UVMap")
    loop_cursor = 0
    for face_index, polygon in enumerate(mesh.polygons):
        uv_coords = buffers.face_uvs[face_index]
        if uv_coords is None or len(uv_coords) != polygon.loop_total:
            uv_coords = [(0.0, 0.0)] * polygon.loop_total
        for local_loop_index, loop_index in enumerate(polygon.loop_indices):
            uv_layer.data[loop_index].uv = uv_coords[local_loop_index]
            loop_cursor += 1


def _apply_vertex_colors(mesh: bpy.types.Mesh, buffers: _MeshBuffers) -> None:
    for attribute in list(mesh.color_attributes):
        if attribute.name == LEAF_COLOR_ATTRIBUTE:
            mesh.color_attributes.remove(attribute)
    attribute = mesh.color_attributes.new(
        name=LEAF_COLOR_ATTRIBUTE,
        type="FLOAT_COLOR",
        domain="POINT",
    )
    for index, color in enumerate(buffers.vertex_colors):
        attribute.data[index].color = color


def _finalize_tree_height(buffers: _MeshBuffers) -> None:
    """Post-pass: fill vertex_tree_height with 0..1 altitude along the tree.

    Leaf vertices (identified by their non-zero sphere_normal) are normalized
    against the CANOPY-only Z range so a leaf at the bottom of the canopy
    gets tree_height=0 and a leaf at the top of the canopy gets 1. This is
    what makes the painterly top-warm / bottom-cool gradient separate
    visually — if we used the whole-tree range instead, canopy leaves would
    only cover the top half of the gradient and never reach bottomColor.

    Trunk vertices fall back to whole-tree normalization so the trunk
    itself also shows a subtle bottom-to-top hue shift.
    """
    if not buffers.verts:
        return

    leaf_indices = [
        i for i, sn in enumerate(buffers.vertex_sphere_normals)
        if (sn[0] * sn[0] + sn[1] * sn[1] + sn[2] * sn[2]) > 1e-8
    ]
    tree_min_z = min(v[2] for v in buffers.verts)
    tree_max_z = max(v[2] for v in buffers.verts)
    tree_span = max(tree_max_z - tree_min_z, 1e-5)

    if leaf_indices:
        leaf_min_z = min(buffers.verts[i][2] for i in leaf_indices)
        leaf_max_z = max(buffers.verts[i][2] for i in leaf_indices)
        leaf_span = max(leaf_max_z - leaf_min_z, 1e-5)
    else:
        leaf_min_z = tree_min_z
        leaf_span = tree_span

    leaf_set = set(leaf_indices)
    heights: list[float] = []
    for i, vertex in enumerate(buffers.verts):
        if i in leaf_set:
            h = (vertex[2] - leaf_min_z) / leaf_span
        else:
            h = (vertex[2] - tree_min_z) / tree_span
        heights.append(max(0.0, min(1.0, h)))
    buffers.vertex_tree_height = heights


def _apply_sphere_normal_attribute(mesh: bpy.types.Mesh, buffers: _MeshBuffers) -> None:
    _remove_attribute_if_present(mesh, SPHERE_NORMAL_ATTRIBUTE)
    attribute = mesh.attributes.new(
        name=SPHERE_NORMAL_ATTRIBUTE,
        type="FLOAT_VECTOR",
        domain="POINT",
    )
    for index, vec in enumerate(buffers.vertex_sphere_normals):
        attribute.data[index].vector = vec


def _apply_tree_height_attribute(mesh: bpy.types.Mesh, buffers: _MeshBuffers) -> None:
    _remove_attribute_if_present(mesh, TREE_HEIGHT_ATTRIBUTE)
    attribute = mesh.attributes.new(
        name=TREE_HEIGHT_ATTRIBUTE,
        type="FLOAT",
        domain="POINT",
    )
    for index, value in enumerate(buffers.vertex_tree_height):
        attribute.data[index].value = value


def _remove_attribute_if_present(mesh: bpy.types.Mesh, name: str) -> None:
    existing = mesh.attributes.get(name)
    if existing is not None:
        mesh.attributes.remove(existing)


def _apply_custom_normals(mesh: bpy.types.Mesh, buffers: _MeshBuffers) -> None:
    normals = [tuple(vertex.normal) for vertex in mesh.vertices]
    has_override = False
    for index, override in enumerate(buffers.vertex_normal_overrides):
        if override is None:
            continue
        normals[index] = (override.x, override.y, override.z)
        has_override = True
    if has_override:
        mesh.normals_split_custom_set_from_vertices(normals)


def _sample_path(points: list[Vector], t: float) -> tuple[Vector, Vector]:
    clamped = max(0.0, min(1.0, t))
    scaled = clamped * (len(points) - 1)
    index = min(int(math.floor(scaled)), len(points) - 2)
    local_t = scaled - index
    start = points[index]
    end = points[index + 1]
    position = start.lerp(end, local_t)
    tangent = (end - start).normalized()
    return position, tangent


def _basis_right(axis: Vector) -> Vector:
    axis = axis.normalized()
    reference = Vector((0.0, 0.0, 1.0))
    if abs(axis.dot(reference)) > 0.95:
        reference = Vector((0.0, 1.0, 0.0))
    right = axis.cross(reference)
    if right.length == 0.0:
        right = Vector((1.0, 0.0, 0.0))
    return right.normalized()


def _linear_radii(start: float, end: float, count: int) -> list[float]:
    if count <= 1:
        return [start]
    return [start + (end - start) * (index / (count - 1)) for index in range(count)]


def _resolve_leaf_dimension_scale(value: float) -> float:
    return max(0.2, min(2.0, value))


def _create_export_object(
    context: bpy.types.Context,
    source_obj: bpy.types.Object,
) -> bpy.types.Object:
    export_mesh = source_obj.data.copy()
    export_obj = source_obj.copy()
    export_obj.data = export_mesh
    export_obj.name = f"{source_obj.name} Export"
    export_obj.hide_render = False
    context.collection.objects.link(export_obj)
    _assign_export_materials(export_obj, source_obj)
    return export_obj


def _assign_export_materials(
    obj: bpy.types.Object,
    source_obj: bpy.types.Object,
) -> None:
    trunk_material = _ensure_export_trunk_material()
    leaf_material = _ensure_export_leaf_material()
    source_material_indices = [
        polygon.material_index for polygon in source_obj.data.polygons
    ]
    materials = obj.data.materials
    materials.clear()
    materials.append(trunk_material)
    materials.append(leaf_material)

    for polygon_index, polygon in enumerate(obj.data.polygons):
        source_index = (
            source_material_indices[polygon_index]
            if polygon_index < len(source_material_indices)
            else 0
        )
        polygon.material_index = 1 if source_index == 1 else 0


def _ensure_export_trunk_material():
    material = bpy.data.materials.get("FoilageMaker Export Trunk")
    if material is None:
        material = bpy.data.materials.new(name="FoilageMaker Export Trunk")

    material.use_nodes = True
    material.blend_method = "OPAQUE"
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()

    output = nodes.new("ShaderNodeOutputMaterial")
    shader = nodes.new("ShaderNodeBsdfPrincipled")
    shader.inputs["Base Color"].default_value = (0.42, 0.27, 0.16, 1.0)
    shader.inputs["Roughness"].default_value = 0.95
    shader.inputs["Specular IOR Level"].default_value = 0.0
    links.new(shader.outputs["BSDF"], output.inputs["Surface"])
    return material


def _ensure_export_leaf_material():
    # NOTE ON ALPHA MODE (2026-04-18):
    #
    # The glTF alphaMode carried out of this exporter is currently NOT the
    # source of truth for how foliage renders in Sugarmagic. The
    # Sugarmagic web shader runtime (packages/render-web/src/ShaderRuntime.ts,
    # applyIRToMaterial) forces every shader graph that outputs an
    # opacityNode into MASK-mode cutout rendering regardless of what the
    # GLB's alphaMode says (transparent=false, alphaTest=0.5, depthWrite=
    # true). That's the only way we got correct near-leaf-occludes-inner-
    # branch behavior across all lighting presets without the "see through
    # the front leaves to the trunk" bug.
    #
    # So: the CLIP / alpha_threshold=0.5 we set here is correct in spirit
    # (it matches what Sugarmagic does downstream anyway) but the specific
    # value bakes no longer matter — the engine overrides them. Keep the
    # CLIP setting for two reasons: (1) it keeps Blender's preview
    # viewport looking right for authors working in Blender, (2) it makes
    # the GLB "honest" about its intent if it's ever loaded somewhere
    # other than Sugarmagic.
    #
    # TODO: revisit once we have a per-shader alpha-mode control in
    # Sugarmagic (BLEND for glass / soft edges, MASK for foliage, OPAQUE
    # for solid). At that point the GLB's authored alphaMode can become
    # authoritative again and this exporter's blend_method choice starts
    # mattering. Until then, don't spend time tuning alphaMode here —
    # tune it in Sugarmagic's ShaderRuntime.
    material = bpy.data.materials.get("FoilageMaker Export Leaves")
    if material is None:
        material = bpy.data.materials.new(name="FoilageMaker Export Leaves")

    material.use_nodes = True
    material.blend_method = "CLIP"
    material.alpha_threshold = 0.5
    if hasattr(material, "show_transparent_back"):
        material.show_transparent_back = False

    image = _ensure_leaf_sprite_image()
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()

    output = nodes.new("ShaderNodeOutputMaterial")
    shader = nodes.new("ShaderNodeBsdfPrincipled")
    shader.inputs["Roughness"].default_value = 1.0
    shader.inputs["Specular IOR Level"].default_value = 0.0

    texture = nodes.new("ShaderNodeTexImage")
    texture.image = image
    texture.interpolation = "Linear"

    links.new(texture.outputs["Color"], shader.inputs["Base Color"])
    links.new(texture.outputs["Alpha"], shader.inputs["Alpha"])
    links.new(shader.outputs["BSDF"], output.inputs["Surface"])
    return material


def _assign_materials(obj: bpy.types.Object) -> None:
    trunk_material = _ensure_trunk_material()
    leaf_material = _ensure_leaf_material()
    canopy_material = _ensure_canopy_material()

    materials = obj.data.materials
    materials.clear()
    materials.append(trunk_material)
    materials.append(leaf_material)
    materials.append(canopy_material)


def _ensure_trunk_material():
    material = bpy.data.materials.get("FoilageMaker Trunk")
    if material is None:
        material = bpy.data.materials.new(name="FoilageMaker Trunk")

    material.use_nodes = True
    material.blend_method = "OPAQUE"
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()

    output = nodes.new("ShaderNodeOutputMaterial")
    shader = nodes.new("ShaderNodeBsdfPrincipled")
    shader.inputs["Base Color"].default_value = (0.36, 0.22, 0.13, 1.0)
    shader.inputs["Roughness"].default_value = 0.92
    shader.inputs["Specular IOR Level"].default_value = 0.12

    noise = nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 8.0
    noise.inputs["Detail"].default_value = 4.0
    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (0.28, 0.16, 0.08, 1.0)
    ramp.color_ramp.elements[1].color = (0.52, 0.34, 0.19, 1.0)
    links.new(noise.outputs["Fac"], ramp.inputs["Fac"])
    links.new(ramp.outputs["Color"], shader.inputs["Base Color"])
    links.new(shader.outputs["BSDF"], output.inputs["Surface"])
    return material


def _ensure_leaf_material():
    material = bpy.data.materials.get("FoilageMaker Leaves")
    if material is None:
        material = bpy.data.materials.new(name="FoilageMaker Leaves")

    material.use_nodes = True
    material.blend_method = "HASHED"
    if hasattr(material, "show_transparent_back"):
        material.show_transparent_back = False

    image = _ensure_leaf_sprite_image()
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()

    output = nodes.new("ShaderNodeOutputMaterial")
    shader = nodes.new("ShaderNodeBsdfPrincipled")
    shader.inputs["Roughness"].default_value = 0.96
    shader.inputs["Specular IOR Level"].default_value = 0.08
    shader.inputs["Subsurface Weight"].default_value = 0.08
    shader.inputs["Subsurface Radius"].default_value = (0.4, 0.9, 0.18)

    texture = nodes.new("ShaderNodeTexImage")
    texture.image = image
    texture.interpolation = "Linear"

    attribute = nodes.new("ShaderNodeAttribute")
    attribute.attribute_name = LEAF_COLOR_ATTRIBUTE

    multiply = nodes.new("ShaderNodeMixRGB")
    multiply.blend_type = "MULTIPLY"
    multiply.inputs["Fac"].default_value = 1.0

    alpha_ramp = nodes.new("ShaderNodeValToRGB")
    alpha_ramp.color_ramp.elements[0].position = 0.14
    alpha_ramp.color_ramp.elements[0].color = (0.0, 0.0, 0.0, 1.0)
    alpha_ramp.color_ramp.elements[1].position = 0.84
    alpha_ramp.color_ramp.elements[1].color = (1.0, 1.0, 1.0, 1.0)

    transparent = nodes.new("ShaderNodeBsdfTransparent")
    mix_shader = nodes.new("ShaderNodeMixShader")

    links.new(attribute.outputs["Color"], multiply.inputs["Color1"])
    links.new(texture.outputs["Color"], multiply.inputs["Color2"])
    links.new(multiply.outputs["Color"], shader.inputs["Base Color"])
    links.new(texture.outputs["Alpha"], alpha_ramp.inputs["Fac"])
    links.new(alpha_ramp.outputs["Color"], shader.inputs["Alpha"])
    links.new(alpha_ramp.outputs["Color"], mix_shader.inputs["Fac"])
    links.new(transparent.outputs["BSDF"], mix_shader.inputs[1])
    links.new(shader.outputs["BSDF"], mix_shader.inputs[2])
    links.new(mix_shader.outputs["Shader"], output.inputs["Surface"])

    return material


def _ensure_canopy_material():
    material = bpy.data.materials.get("FoilageMaker Canopy Guide")
    if material is None:
        material = bpy.data.materials.new(name="FoilageMaker Canopy Guide")

    material.use_nodes = True
    material.blend_method = "BLEND"
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()

    output = nodes.new("ShaderNodeOutputMaterial")
    shader = nodes.new("ShaderNodeBsdfPrincipled")
    shader.inputs["Base Color"].default_value = (0.56, 0.82, 0.58, 1.0)
    shader.inputs["Roughness"].default_value = 1.0
    shader.inputs["Alpha"].default_value = 0.12
    links.new(shader.outputs["BSDF"], output.inputs["Surface"])
    return material


def _ensure_leaf_sprite_image():
    variant = _get_active_leaf_texture_variant()
    if variant == "mixed":
        prototype_paths = _get_mixed_atlas_leaf_paths()
        if prototype_paths:
            return _ensure_prototype_leaf_atlas(prototype_paths)
    elif variant:
        single_path = _get_single_leaf_texture_path(variant)
        if single_path is not None:
            return _ensure_single_leaf_image(single_path)
    return _ensure_generated_leaf_sprite()


def _ensure_single_leaf_image(path: "Path"):
    """Load a specific bundled leaf texture as the one-and-only leaf sprite.

    Replaces any existing `LEAF_IMAGE_NAME` image so the leaf material's
    image reference stays stable across texture swaps. The image is packed
    so the .blend file stays self-contained after the user saves, matching
    the behavior of the atlas / generated paths.
    """
    existing = bpy.data.images.get(LEAF_IMAGE_NAME)
    if existing is not None:
        bpy.data.images.remove(existing)
    image = bpy.data.images.load(str(path))
    image.name = LEAF_IMAGE_NAME
    image.pack()
    image.use_fake_user = True
    return image


def _get_active_leaf_texture_variant() -> str | None:
    """Return the active tree's `leaf_texture_variant`, or None if no foliage
    tree is currently the context's active object.

    Reads from bpy.context rather than taking an explicit parameter because
    the leaf-material / leaf-sprite code path is shared across several
    entry points (initial creation, rebuild, validation, export) and
    threading the tree object through every call is more churn than it's
    worth — the rebuild path that actually matters always runs with the
    tree selected as the active object.
    """
    context = getattr(bpy, "context", None)
    obj = getattr(context, "active_object", None) if context else None
    if not is_foilagemaker_tree(obj):
        return None
    return getattr(obj.foilagemaker_tree, "leaf_texture_variant", None)


def _ensure_generated_leaf_sprite():
    image = _ensure_image(LEAF_IMAGE_NAME, 128, 128)
    image.generated_color = (1.0, 1.0, 1.0, 0.0)
    image.use_fake_user = True

    pixels: list[float] = []
    blobs = [
        (-0.18, -0.08, 0.42, 0.3),
        (0.1, -0.12, 0.38, 0.28),
        (-0.06, 0.07, 0.46, 0.34),
        (0.24, 0.08, 0.3, 0.24),
    ]
    for y in range(128):
        ny = (y / 127.0) * 2.0 - 1.0
        for x in range(128):
            nx = (x / 127.0) * 2.0 - 1.0
            alpha = 0.0
            for cx, cy, rx, ry in blobs:
                dx = (nx - cx) / rx
                dy = (ny - cy) / ry
                distance = dx * dx + dy * dy
                influence = max(0.0, 1.0 - distance)
                alpha = max(alpha, influence * influence * (3.0 - 2.0 * influence))
            alpha = pow(_clamp01(alpha), 0.82)
            pixels.extend((1.0, 1.0, 1.0, alpha))

    image.pixels = pixels
    image.pack()
    return image


def _ensure_prototype_leaf_atlas(prototype_paths: list[Path]):
    source_images = [
        bpy.data.images.load(str(path), check_existing=True)
        for path in prototype_paths[:4]
    ]
    if not source_images:
        return _ensure_generated_leaf_sprite()

    source_width = source_images[0].size[0]
    source_height = source_images[0].size[1]
    atlas_columns = 1 if len(source_images) == 1 else 2
    atlas_rows = 1 if len(source_images) <= 2 else 2
    atlas_width = source_width * atlas_columns
    atlas_height = source_height * atlas_rows
    atlas = _ensure_image(LEAF_IMAGE_NAME, atlas_width, atlas_height)
    atlas.use_fake_user = True

    pixels = [0.0] * (atlas_width * atlas_height * 4)
    for index, source_image in enumerate(source_images):
        tile_x = index % atlas_columns
        tile_y = index // atlas_columns
        source_pixels = list(source_image.pixels[:])
        _blit_rgba_tile(
            target_pixels=pixels,
            target_width=atlas_width,
            target_height=atlas_height,
            source_pixels=source_pixels,
            source_width=source_width,
            source_height=source_height,
            tile_x=tile_x * source_width,
            tile_y=tile_y * source_height,
        )

    atlas.pixels = pixels
    atlas.pack()
    return atlas


def _get_mixed_atlas_leaf_paths() -> list[Path]:
    """First four `_transparency.png` files in the bundled textures dir, for
    the "mixed" variant that atlases multiple leaf textures into one image.
    """
    if not LEAF_TEXTURE_DIR.exists():
        return []
    return sorted(LEAF_TEXTURE_DIR.glob("leavesTexture*_transparency.png"))[:4]


def _get_single_leaf_texture_path(variant: str) -> Path | None:
    """Path to the bundled `<variant>_transparency.png`, or None if missing.

    `variant` is an identifier like "leavesTexture03". Returning None makes
    the caller fall through to the procedural-atlas fallback so a missing
    bundled texture degrades gracefully rather than crashing the add-on.
    """
    if not LEAF_TEXTURE_DIR.exists():
        return None
    path = LEAF_TEXTURE_DIR / f"{variant}_transparency.png"
    if not path.exists():
        return None
    return path


def _get_leaf_variant_count() -> int:
    """How many leaf-card UV cells the atlas exposes. The cell layout below
    (see `_resolve_leaf_uv_rect`) uses this to pick which quadrant of the
    atlas a given leaf-card instance samples.

    In "mixed" mode we expose up to 4 cells (one per atlased texture). In
    single-texture mode there's exactly 1 cell covering the full UV range,
    so every card samples the same texture.
    """
    if _get_active_leaf_texture_variant() == "mixed":
        return max(1, len(_get_mixed_atlas_leaf_paths()[:4]))
    return 1


def _resolve_leaf_uv_rect(
    variant_index: int, variant_count: int
) -> tuple[float, float, float, float]:
    if variant_count <= 1:
        return (0.0, 0.0, 1.0, 1.0)
    columns = 1 if variant_count == 1 else 2
    rows = 1 if variant_count <= 2 else 2
    cell_width = 1.0 / columns
    cell_height = 1.0 / rows
    column = variant_index % columns
    row = variant_index // columns
    u0 = column * cell_width
    v0 = row * cell_height
    u1 = u0 + cell_width
    v1 = v0 + cell_height
    return (u0, v0, u1, v1)


def _ensure_image(name: str, width: int, height: int):
    image = bpy.data.images.get(name)
    if image is None:
        image = bpy.data.images.new(name, width=width, height=height, alpha=True)
        return image
    if image.size[0] != width or image.size[1] != height:
        bpy.data.images.remove(image)
        image = bpy.data.images.new(name, width=width, height=height, alpha=True)
    return image


def _blit_rgba_tile(
    target_pixels: list[float],
    target_width: int,
    target_height: int,
    source_pixels: list[float],
    source_width: int,
    source_height: int,
    tile_x: int,
    tile_y: int,
) -> None:
    for y in range(source_height):
        for x in range(source_width):
            source_index = (y * source_width + x) * 4
            target_index = ((tile_y + y) * target_width + (tile_x + x)) * 4
            target_pixels[target_index : target_index + 4] = source_pixels[
                source_index : source_index + 4
            ]


def _clamp01(value: float) -> float:
    return max(0.0, min(1.0, value))


def _get_tree_presets() -> dict[str, dict[str, float | int | bool]]:
    return {
        "clustered_stylized": {
            "random_seed": 0,
            "trunk_height": 5.2,
            "trunk_radius": 0.22,
            "trunk_taper": 0.72,
            "trunk_segments": 14,
            "trunk_sides": 8,
            "trunk_displacement_strength": 1.35,
            "trunk_displacement_scale": 1.0,
            "base_flare_scale": 1.6,
            "base_flare_position": 0.24,
            "branch_count": 14,
            "branch_start": 0.28,
            "branch_length": 2.2,
            "branch_length_randomness": 0.25,
            "branch_radius": 0.08,
            "branch_segments": 4,
            "branch_sides": 5,
            "branch_angle_offset": 0.0,
            "branch_up_bias": 0.42,
            "secondary_branch_count": 3,
            "secondary_branch_length": 0.95,
            "secondary_branch_randomness": 0.2,
            "secondary_branch_radius": 0.03,
            "secondary_branch_segments": 3,
            "secondary_branch_sides": 4,
            "canopy_shape": "sphere",
            "canopy_size": 1.1,
            "canopy_vertical_scale": 1.15,
            "canopy_base_offset": -0.25,
            "leaf_count": 160,
            "leaf_card_count": 4,
            "leaf_size": 1.22,
            "leaf_width": 0.82,
            "leaf_height": 0.88,
            "wind_scale": 2.5,
            "wind_speed": 1.0,
            "big_wind_multiplier": 1.0,
            "small_wind_multiplier": 1.0,
        },
        "round_deciduous": {
            "random_seed": 0,
            "trunk_height": 5.4,
            "trunk_radius": 0.24,
            "trunk_taper": 0.7,
            "trunk_segments": 14,
            "trunk_sides": 8,
            "trunk_displacement_strength": 1.1,
            "trunk_displacement_scale": 0.9,
            "base_flare_scale": 1.7,
            "base_flare_position": 0.22,
            "branch_count": 16,
            "branch_start": 0.26,
            "branch_length": 2.15,
            "branch_length_randomness": 0.18,
            "branch_radius": 0.085,
            "branch_segments": 4,
            "branch_sides": 5,
            "branch_angle_offset": 0.0,
            "branch_up_bias": 0.5,
            "secondary_branch_count": 4,
            "secondary_branch_length": 0.9,
            "secondary_branch_randomness": 0.16,
            "secondary_branch_radius": 0.028,
            "secondary_branch_segments": 3,
            "secondary_branch_sides": 4,
            "canopy_shape": "sphere",
            "canopy_size": 1.18,
            "canopy_vertical_scale": 1.0,
            "canopy_base_offset": -0.3,
            "leaf_count": 200,
            "leaf_card_count": 4,
            "leaf_size": 1.05,
            "leaf_width": 0.96,
            "leaf_height": 0.82,
            "wind_scale": 2.5,
            "wind_speed": 1.0,
            "big_wind_multiplier": 1.0,
            "small_wind_multiplier": 1.0,
        },
        "tall_pine_ish": {
            "random_seed": 0,
            "trunk_height": 7.6,
            "trunk_radius": 0.18,
            "trunk_taper": 0.78,
            "trunk_segments": 18,
            "trunk_sides": 8,
            "trunk_displacement_strength": 0.75,
            "trunk_displacement_scale": 0.7,
            "base_flare_scale": 1.45,
            "base_flare_position": 0.18,
            "branch_count": 12,
            "branch_start": 0.35,
            "branch_length": 1.75,
            "branch_length_randomness": 0.22,
            "branch_radius": 0.06,
            "branch_segments": 4,
            "branch_sides": 5,
            "branch_angle_offset": 0.0,
            "branch_up_bias": 0.62,
            "secondary_branch_count": 2,
            "secondary_branch_length": 0.72,
            "secondary_branch_randomness": 0.18,
            "secondary_branch_radius": 0.02,
            "secondary_branch_segments": 3,
            "secondary_branch_sides": 4,
            "canopy_shape": "cone",
            "canopy_size": 0.85,
            "canopy_vertical_scale": 2.2,
            "canopy_base_offset": -0.3,
            "leaf_count": 220,
            "leaf_card_count": 4,
            "leaf_size": 0.82,
            "leaf_width": 0.68,
            "leaf_height": 1.05,
            "wind_scale": 2.5,
            "wind_speed": 1.0,
            "big_wind_multiplier": 1.0,
            "small_wind_multiplier": 1.0,
        },
    }
