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

ADDON_VERSION = "0.11.1"
TREE_KIND = "tree"
OBJECT_KIND_KEY = "foilagemaker_kind"
ASSET_KIND_KEY = "sugarmagic_asset_kind"
VERSION_KEY = "foilagemaker_version"
SUPPRESS_UPDATE_KEY = "_foilagemaker_suppress_update"
LEAF_IMAGE_NAME = "FoilageMakerLeafSprite"
LEAF_COLOR_ATTRIBUTE = "FoilageMakerLeafColor"
DEFAULT_TREE_PRESET = "clustered_stylized"
_TREE_PRESET_LABELS = {
    "clustered_stylized": "Clustered Stylized Canopy",
    "round_deciduous": "Round Deciduous",
    "tall_pine_ish": "Tall Pine-ish",
}
PROTOTYPE_TEXTURE_ROOT = Path(
    "/Users/nikki/projects/sugarmagic/tooling/.foilagemaker-prototype-textures/textures"
)
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
    buffers = _build_tree_mesh(props)
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

    _apply_uvs(mesh, buffers)
    _apply_vertex_colors(mesh, buffers)
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

    if props.display_leaf_blocks:
        issues.append(
            {
                "severity": "error",
                "message": "Disable Display Blocks before export so guide canopy geometry is not emitted.",
            }
        )
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

    if props.leaf_density < 2:
        issues.append(
            {
                "severity": "warning",
                "message": "Leaf density is very low; exported trees may read sparse in-game.",
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


@dataclass
class _CanopyCluster:
    center: Vector
    radius_x: float
    radius_y: float
    radius_z: float
    surface_sprays: int
    interior_sprays: int
    outer_bias: float


def _build_tree_mesh(props) -> _MeshBuffers:
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

    canopy_clusters = _build_canopy_clusters(
        leaf_tips=leaf_tips,
        canopy_center=canopy_center,
        props=props,
        rng=rng,
    )
    for cluster in canopy_clusters:
        _add_canopy_cluster(buffers, cluster, props, rng, leaf_variant_count)

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


def _build_canopy_clusters(
    leaf_tips: list[Vector],
    canopy_center: Vector,
    props,
    rng: random.Random,
) -> list[_CanopyCluster]:
    if leaf_tips:
        source_points = list(leaf_tips)
    else:
        source_points = [canopy_center]

    desired = max(2, int(props.canopy_cluster_count))
    central = Vector((0.0, 0.0, 0.0))
    for point in source_points:
        central += point
    central /= max(1, len(source_points))
    central = central.lerp(canopy_center, 0.3)

    base_surface = max(12, int(props.leaf_density * props.canopy_density_multiplier))
    clusters: list[_CanopyCluster] = [
        _CanopyCluster(
            center=central,
            radius_x=props.canopy_radius * 0.92,
            radius_y=props.canopy_radius * 0.9,
            radius_z=props.canopy_radius * props.canopy_vertical_scale * 0.82,
            surface_sprays=max(10, int(base_surface * 0.5)),
            interior_sprays=max(6, int(base_surface * 0.28)),
            outer_bias=0.74,
        )
    ]

    if desired > 1:
        anchors = _pick_canopy_anchor_points(source_points, central, desired - 1)

        for bucket_index, anchor in enumerate(anchors):
            direction = anchor - central
            if direction.length < 0.001:
                angle = math.tau * bucket_index / max(1, desired - 1)
                direction = Vector((math.cos(angle), math.sin(angle), 0.15))
            direction = direction.normalized()

            anchor_distance = max(props.canopy_radius * 0.65, (anchor - central).length)
            radial_distance = anchor_distance * rng.uniform(0.95, 1.25)
            lift = props.canopy_radius * rng.uniform(0.08, 0.28)
            merged_center = central + Vector(
                (
                    direction.x * radial_distance,
                    direction.y * radial_distance,
                    direction.z * radial_distance * 0.35 + lift,
                )
            )
            radius_scale = rng.uniform(0.82, 1.12)
            radius_x = props.canopy_radius * radius_scale
            radius_y = props.canopy_radius * rng.uniform(0.8, 1.08)
            radius_z = props.canopy_radius * props.canopy_vertical_scale * rng.uniform(0.78, 1.02)
            surface = max(8, int(base_surface * rng.uniform(0.44, 0.68)))
            clusters.append(
                _CanopyCluster(
                    center=merged_center,
                    radius_x=radius_x,
                    radius_y=radius_y,
                    radius_z=radius_z,
                    surface_sprays=surface,
                    interior_sprays=max(4, int(surface * 0.34)),
                    outer_bias=rng.uniform(0.8, 0.93),
                )
            )

    if props.add_outer_leaves:
        satellites = clusters[1:] if len(clusters) > 1 else clusters[:1]
        bridge_limit = min(2, len(satellites))
        for cluster in satellites[:bridge_limit]:
            bridge_center = central.lerp(cluster.center, 0.42)
            clusters.append(
                _CanopyCluster(
                    center=bridge_center,
                    radius_x=cluster.radius_x * 0.56,
                    radius_y=cluster.radius_y * 0.56,
                    radius_z=cluster.radius_z * 0.5,
                    surface_sprays=max(4, int(cluster.surface_sprays * 0.18)),
                    interior_sprays=max(2, int(cluster.interior_sprays * 0.12)),
                    outer_bias=0.84,
                )
            )

    return clusters


def _pick_canopy_anchor_points(
    source_points: list[Vector],
    central: Vector,
    count: int,
) -> list[Vector]:
    if count <= 0:
        return []
    if len(source_points) <= count:
        return list(source_points)

    anchors: list[Vector] = []
    remaining = sorted(source_points, key=lambda point: point.z, reverse=True)
    anchors.append(remaining.pop(0))

    while remaining and len(anchors) < count:
        best_index = 0
        best_score = -1.0
        for index, point in enumerate(remaining):
            min_distance = min((point - anchor).length for anchor in anchors)
            radial_bonus = (point - central).length * 0.35
            height_bonus = max(0.0, point.z - central.z) * 0.15
            score = min_distance + radial_bonus + height_bonus
            if score > best_score:
                best_score = score
                best_index = index
        anchors.append(remaining.pop(best_index))

    return anchors


def _add_canopy_cluster(
    buffers: _MeshBuffers,
    cluster: _CanopyCluster,
    props,
    rng: random.Random,
    leaf_variant_count: int,
) -> None:
    if props.display_leaf_blocks:
        _add_canopy_guide(
            buffers=buffers,
            center=cluster.center,
            radius_x=cluster.radius_x,
            radius_y=cluster.radius_y,
            radius_z=cluster.radius_z,
            material_index=2,
        )

    for _ in range(cluster.surface_sprays):
        point, normal = _sample_ellipsoid_shell(cluster, props, rng)
        point += normal * rng.uniform(0.0, props.outer_leaf_offset * 0.12)
        _add_leaf_spray(
            buffers=buffers,
            center=point,
            normal=normal,
            leaf_size=props.leaf_size * rng.uniform(0.72, 1.2),
            leaf_width_bias=props.leaf_width * rng.uniform(0.9, 1.1),
            leaf_height_bias=props.leaf_height * rng.uniform(0.9, 1.1),
            card_count=max(2, int(props.leaf_card_count)),
            material_index=1,
            color_hint=_sample_leaf_color(point, cluster, rng, interior=False),
            rng=rng,
            leaf_variant_count=leaf_variant_count,
        )

    for _ in range(cluster.interior_sprays):
        point, normal = _sample_ellipsoid_interior(cluster, props, rng)
        point += normal * rng.uniform(-props.leaf_size * 0.08, props.leaf_size * 0.04)
        _add_leaf_spray(
            buffers=buffers,
            center=point,
            normal=normal.lerp(Vector((0.0, 0.0, 1.0)), 0.2).normalized(),
            leaf_size=props.leaf_size * rng.uniform(0.55, 0.9),
            leaf_width_bias=props.leaf_width * rng.uniform(0.9, 1.1),
            leaf_height_bias=props.leaf_height * rng.uniform(0.9, 1.1),
            card_count=max(2, int(props.leaf_card_count) - 1),
            material_index=1,
            color_hint=_sample_leaf_color(point, cluster, rng, interior=True),
            rng=rng,
            leaf_variant_count=leaf_variant_count,
        )


def _sample_ellipsoid_shell(
    cluster: _CanopyCluster, props, rng: random.Random
) -> tuple[Vector, Vector]:
    theta = rng.uniform(0.0, math.tau)
    phi = math.acos(rng.uniform(-1.0, 1.0))
    local = Vector(
        (
            math.sin(phi) * math.cos(theta),
            math.sin(phi) * math.sin(theta),
            math.cos(phi),
        )
    )
    shell_bias = cluster.outer_bias
    radius_factor = shell_bias + (1.0 - shell_bias) * pow(rng.random(), 2.3)
    radius_factor += rng.uniform(-props.leaf_jitter * 0.04, props.leaf_jitter * 0.04)
    radius_factor = max(0.55, radius_factor)
    scaled = Vector(
        (
            local.x * cluster.radius_x * radius_factor,
            local.y * cluster.radius_y * radius_factor,
            local.z * cluster.radius_z * radius_factor,
        )
    )
    point = cluster.center + scaled
    normal = Vector(
        (
            scaled.x / max(cluster.radius_x * cluster.radius_x, 0.0001),
            scaled.y / max(cluster.radius_y * cluster.radius_y, 0.0001),
            scaled.z / max(cluster.radius_z * cluster.radius_z, 0.0001),
        )
    ).normalized()
    return point, normal


def _sample_ellipsoid_interior(
    cluster: _CanopyCluster, props, rng: random.Random
) -> tuple[Vector, Vector]:
    theta = rng.uniform(0.0, math.tau)
    phi = math.acos(rng.uniform(-1.0, 1.0))
    distance = pow(rng.random(), 1.8) * 0.82
    local = Vector(
        (
            math.sin(phi) * math.cos(theta),
            math.sin(phi) * math.sin(theta),
            math.cos(phi),
        )
    ) * distance
    scaled = Vector(
        (
            local.x * cluster.radius_x,
            local.y * cluster.radius_y,
            local.z * cluster.radius_z,
        )
    )
    point = cluster.center + scaled
    normal = Vector(
        (
            scaled.x / max(cluster.radius_x * cluster.radius_x, 0.0001),
            scaled.y / max(cluster.radius_y * cluster.radius_y, 0.0001),
            scaled.z / max(cluster.radius_z * cluster.radius_z, 0.0001),
        )
    )
    if normal.length == 0.0:
        normal = Vector((0.0, 0.0, 1.0))
    return point, normal.normalized()


def _sample_leaf_color(
    point: Vector,
    cluster: _CanopyCluster,
    rng: random.Random,
    interior: bool,
) -> tuple[float, float, float, float]:
    vertical_min = cluster.center.z - cluster.radius_z
    vertical_max = cluster.center.z + cluster.radius_z
    top_factor = _clamp01((point.z - vertical_min) / max(vertical_max - vertical_min, 0.0001))
    bottom_color = Vector((0.21, 0.41, 0.16))
    top_color = Vector((0.73, 0.88, 0.44))
    random_color = Vector(
        (
            rng.uniform(0.88, 1.05),
            rng.uniform(0.92, 1.08),
            rng.uniform(0.86, 1.02),
        )
    )
    color = bottom_color.lerp(top_color, pow(top_factor, 0.9))
    color = Vector((color.x * random_color.x, color.y * random_color.y, color.z * random_color.z))
    if interior:
        color *= 0.72
    exterior_bias = 0.38 if interior else 0.86
    shade_bias = _clamp01(top_factor * 0.58 + exterior_bias * 0.42)
    return (_clamp01(color.x), _clamp01(color.y), _clamp01(color.z), shade_bias)


def _add_canopy_guide(
    buffers: _MeshBuffers,
    center: Vector,
    radius_x: float,
    radius_y: float,
    radius_z: float,
    material_index: int,
) -> None:
    rings = 6
    sides = 10
    ring_indices: list[list[int]] = []
    for ring in range(rings + 1):
        v = ring / rings
        phi = (v - 0.5) * math.pi
        ring_radius = math.cos(phi)
        z = math.sin(phi)
        indices: list[int] = []
        for side in range(sides):
            angle = math.tau * side / sides
            point = center + Vector(
                (
                    math.cos(angle) * ring_radius * radius_x,
                    math.sin(angle) * ring_radius * radius_y,
                    z * radius_z,
                )
            )
            indices.append(
                _append_vertex(
                    buffers,
                    point,
                    color=(0.8, 0.9, 0.8, 0.14),
                )
            )
        ring_indices.append(indices)

    for ring in range(rings):
        current_ring = ring_indices[ring]
        next_ring = ring_indices[ring + 1]
        for side in range(sides):
            next_side = (side + 1) % sides
            buffers.add_face(
                (
                    current_ring[side],
                    current_ring[next_side],
                    next_ring[next_side],
                    next_ring[side],
                ),
                material_index,
                smooth=True,
            )


def _add_leaf_spray(
    buffers: _MeshBuffers,
    center: Vector,
    normal: Vector,
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
    v0 = _append_vertex(
        buffers,
        center - right * half_width - up * half_height,
        color_hint,
        normal_override=normal,
    )
    v1 = _append_vertex(
        buffers,
        center + right * half_width - up * half_height,
        color_hint,
        normal_override=normal,
    )
    v2 = _append_vertex(
        buffers,
        center + right * half_width + up * half_height,
        color_hint,
        normal_override=normal,
    )
    v3 = _append_vertex(
        buffers,
        center - right * half_width + up * half_height,
        color_hint,
        normal_override=normal,
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
) -> int:
    buffers.verts.append((position.x, position.y, position.z))
    buffers.vertex_colors.append(color)
    buffers.vertex_normal_overrides.append(normal_override.copy() if normal_override else None)
    return len(buffers.verts) - 1


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
    prototype_paths = _get_prototype_leaf_paths()
    if prototype_paths:
        return _ensure_prototype_leaf_atlas(prototype_paths)
    return _ensure_generated_leaf_sprite()


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


def _get_prototype_leaf_paths() -> list[Path]:
    if not PROTOTYPE_TEXTURE_ROOT.exists():
        return []
    return sorted(PROTOTYPE_TEXTURE_ROOT.glob("leavesTexture*_transparency.png"))[:4]


def _get_leaf_variant_count() -> int:
    return max(1, len(_get_prototype_leaf_paths()[:4]))


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
            "display_leaf_blocks": False,
            "canopy_cluster_count": 4,
            "canopy_radius": 1.04,
            "canopy_vertical_scale": 1.05,
            "canopy_density_multiplier": 24.5,
            "leaf_card_count": 4,
            "leaf_size": 1.22,
            "leaf_width": 0.82,
            "leaf_height": 0.88,
            "leaf_density": 5,
            "leaf_jitter": 0.98,
            "add_outer_leaves": True,
            "outer_leaf_offset": 0.95,
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
            "display_leaf_blocks": False,
            "canopy_cluster_count": 5,
            "canopy_radius": 1.08,
            "canopy_vertical_scale": 1.02,
            "canopy_density_multiplier": 28.0,
            "leaf_card_count": 4,
            "leaf_size": 1.05,
            "leaf_width": 0.96,
            "leaf_height": 0.82,
            "leaf_density": 5,
            "leaf_jitter": 0.84,
            "add_outer_leaves": True,
            "outer_leaf_offset": 0.8,
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
            "display_leaf_blocks": False,
            "canopy_cluster_count": 6,
            "canopy_radius": 0.72,
            "canopy_vertical_scale": 1.48,
            "canopy_density_multiplier": 20.0,
            "leaf_card_count": 4,
            "leaf_size": 0.82,
            "leaf_width": 0.68,
            "leaf_height": 1.05,
            "leaf_density": 4,
            "leaf_jitter": 0.9,
            "add_outer_leaves": True,
            "outer_leaf_offset": 0.64,
            "wind_scale": 2.5,
            "wind_speed": 1.0,
            "big_wind_multiplier": 1.0,
            "small_wind_multiplier": 1.0,
        },
    }
