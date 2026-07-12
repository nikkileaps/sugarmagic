/**
 * Layout viewport gizmos: move, rotate, and scale for the selected placed object.
 *
 * Gizmo visuals are editor/tool overlays — not authored scene truth.
 * They live in the overlay root of the runtime viewport.
 */

import * as THREE from "three";
import type { TransformTool } from "../../interaction/tool-state";
import { gizmoHandleName } from "../../interaction/gizmo-contract";

const AXIS_COLORS = {
  x: 0xf38ba8,
  y: 0xa6e3a1,
  z: 0x89b4fa
};

type Axis = "x" | "y" | "z";
const AXES: Axis[] = ["x", "y", "z"];

function configureOverlayMesh(
  mesh: THREE.Mesh,
  renderOrder: number
): THREE.Mesh {
  mesh.renderOrder = renderOrder;

  if (Array.isArray(mesh.material)) {
    for (const material of mesh.material) {
      material.depthTest = false;
      material.depthWrite = false;
      material.toneMapped = false;
    }
  } else {
    mesh.material.depthTest = false;
    mesh.material.depthWrite = false;
    mesh.material.toneMapped = false;
  }

  return mesh;
}

// --- Move gizmo: shafts + cone tips ---

function createMoveHandle(axis: Axis, color: number): THREE.Group {
  const group = new THREE.Group();
  group.name = gizmoHandleName("move", axis);

  const direction =
    axis === "x" ? new THREE.Vector3(1, 0, 0)
    : axis === "y" ? new THREE.Vector3(0, 1, 0)
    : new THREE.Vector3(0, 0, 1);

  const mat = new THREE.MeshBasicMaterial({ color, depthTest: false });

  const shaft = configureOverlayMesh(new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.04, 1.5, 8),
    mat
  ), 999);
  shaft.position.copy(direction.clone().multiplyScalar(0.75));
  if (axis === "x") shaft.rotation.z = -Math.PI / 2;
  if (axis === "z") shaft.rotation.x = Math.PI / 2;
  shaft.name = gizmoHandleName("move", axis);
  group.add(shaft);

  const cone = configureOverlayMesh(new THREE.Mesh(
    new THREE.ConeGeometry(0.1, 0.25, 12),
    mat
  ), 999);
  cone.position.copy(direction.clone().multiplyScalar(1.625));
  if (axis === "x") cone.rotation.z = -Math.PI / 2;
  if (axis === "z") cone.rotation.x = Math.PI / 2;
  cone.name = gizmoHandleName("move", axis);
  group.add(cone);

  return group;
}

// --- Rotate gizmo: torus rings per axis ---

function createRotateHandle(axis: Axis, color: number): THREE.Group {
  const group = new THREE.Group();
  group.name = gizmoHandleName("rotate", axis);

  const mat = new THREE.MeshBasicMaterial({
    color,
    depthTest: false,
    side: THREE.DoubleSide
  });

  const ring = configureOverlayMesh(new THREE.Mesh(
    new THREE.TorusGeometry(1.2, 0.03, 8, 48),
    mat
  ), 999);
  ring.name = gizmoHandleName("rotate", axis);

  // A torus's rotation axis is its local Z. Orient each ring so its
  // AXIS matches its name: x-ring faces sideways, y-ring lies FLAT
  // (the horizontal yaw ring in this Y-up world), z-ring keeps the
  // default upright orientation. The y/z orientations were swapped
  // for a long time -- the flat ring was blue and rolled the object
  // around Z when everyone (correctly) grabbed it expecting yaw.
  if (axis === "x") ring.rotation.y = Math.PI / 2;
  if (axis === "y") ring.rotation.x = Math.PI / 2;
  // axis === "z" stays upright (default torus axis IS Z)

  group.add(ring);
  return group;
}

// --- Scale gizmo: shafts + cube tips ---

function createScaleHandle(axis: Axis, color: number): THREE.Group {
  const group = new THREE.Group();
  group.name = gizmoHandleName("scale", axis);

  const direction =
    axis === "x" ? new THREE.Vector3(1, 0, 0)
    : axis === "y" ? new THREE.Vector3(0, 1, 0)
    : new THREE.Vector3(0, 0, 1);

  const mat = new THREE.MeshBasicMaterial({ color, depthTest: false });

  const shaft = configureOverlayMesh(new THREE.Mesh(
    new THREE.CylinderGeometry(0.03, 0.03, 1.2, 8),
    mat
  ), 999);
  shaft.position.copy(direction.clone().multiplyScalar(0.6));
  if (axis === "x") shaft.rotation.z = -Math.PI / 2;
  if (axis === "z") shaft.rotation.x = Math.PI / 2;
  shaft.name = gizmoHandleName("scale", axis);
  group.add(shaft);

  const cube = configureOverlayMesh(new THREE.Mesh(
    new THREE.BoxGeometry(0.15, 0.15, 0.15),
    mat
  ), 999);
  cube.position.copy(direction.clone().multiplyScalar(1.3));
  cube.name = gizmoHandleName("scale", axis);
  group.add(cube);

  return group;
}

// --- Center handles: manipulate all axes at once ---

const CENTER_COLOR = 0xcdd6f4;

function createMoveCenter(): THREE.Mesh {
  const handle = configureOverlayMesh(
    new THREE.Mesh(
      new THREE.OctahedronGeometry(0.14),
      new THREE.MeshBasicMaterial({ color: CENTER_COLOR, depthTest: false })
    ),
    999
  );
  handle.name = gizmoHandleName("move", "center");
  return handle;
}

function createScaleCenter(): THREE.Mesh {
  const handle = configureOverlayMesh(
    new THREE.Mesh(
      new THREE.BoxGeometry(0.2, 0.2, 0.2),
      new THREE.MeshBasicMaterial({ color: CENTER_COLOR, depthTest: false })
    ),
    999
  );
  handle.name = gizmoHandleName("scale", "center");
  return handle;
}

function createRotateCenter(): THREE.Mesh {
  // Trackball: a faint sphere inside the rings (radius under the
  // rings' 1.2 so ring silhouettes stay grabbable around it).
  const handle = configureOverlayMesh(
    new THREE.Mesh(
      new THREE.SphereGeometry(0.95, 24, 16),
      new THREE.MeshBasicMaterial({
        color: CENTER_COLOR,
        transparent: true,
        opacity: 0.12,
        depthTest: false
      })
    ),
    998
  );
  handle.name = gizmoHandleName("rotate", "center");
  return handle;
}

// --- Composite gizmo ---

export interface LayoutGizmo {
  root: THREE.Group;
  setPosition: (pos: [number, number, number]) => void;
  setScale: (scale: number) => void;
  setVisible: (visible: boolean) => void;
  setActiveTool: (tool: TransformTool) => void;
  /** Brighten the handle under the cursor (null = clear). */
  setHoveredHandle: (handleName: string | null) => void;
  dispose: () => void;
}

export function createLayoutGizmo(): LayoutGizmo {
  // NOTE: the gizmo is WORLD-ALIGNED by design -- object rotation is
  // never applied to the root, because the transform controller's
  // drag math works in world axes. Rendering local axes over world
  // math sent rotated objects sideways (gizmo v2, 2026-07-12).
  const root = new THREE.Group();
  root.name = "layout-gizmo";
  root.renderOrder = 999;

  const moveGroup = new THREE.Group();
  moveGroup.name = "gizmo-move";
  for (const axis of AXES) moveGroup.add(createMoveHandle(axis, AXIS_COLORS[axis]));
  moveGroup.add(createMoveCenter());
  root.add(moveGroup);

  const rotateGroup = new THREE.Group();
  rotateGroup.name = "gizmo-rotate";
  for (const axis of AXES) rotateGroup.add(createRotateHandle(axis, AXIS_COLORS[axis]));
  rotateGroup.add(createRotateCenter());
  root.add(rotateGroup);

  const scaleGroup = new THREE.Group();
  scaleGroup.name = "gizmo-scale";
  for (const axis of AXES) scaleGroup.add(createScaleHandle(axis, AXIS_COLORS[axis]));
  scaleGroup.add(createScaleCenter());
  root.add(scaleGroup);

  root.visible = false;

  function showOnly(tool: TransformTool) {
    moveGroup.visible = tool === "move";
    rotateGroup.visible = tool === "rotate";
    scaleGroup.visible = tool === "scale";
  }

  showOnly("move");

  // Hover highlight: collect the material behind every named handle
  // once; brighten on hover, restore the base color on clear.
  const handleMaterials = new Map<
    string,
    Array<{ material: THREE.MeshBasicMaterial; baseColor: THREE.Color }>
  >();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || !object.name) return;
    const material = object.material as THREE.MeshBasicMaterial;
    const entries = handleMaterials.get(object.name) ?? [];
    if (!entries.some((entry) => entry.material === material)) {
      entries.push({ material, baseColor: material.color.clone() });
    }
    handleMaterials.set(object.name, entries);
  });
  let hoveredHandle: string | null = null;

  return {
    root,
    setPosition(pos) {
      root.position.set(...pos);
    },
    setScale(scale) {
      root.scale.setScalar(scale);
    },
    setVisible(visible) {
      root.visible = visible;
    },
    setActiveTool(tool) {
      showOnly(tool);
    },
    setHoveredHandle(handleName) {
      if (handleName === hoveredHandle) return;
      if (hoveredHandle) {
        for (const entry of handleMaterials.get(hoveredHandle) ?? []) {
          entry.material.color.copy(entry.baseColor);
        }
      }
      hoveredHandle = handleName;
      if (handleName) {
        for (const entry of handleMaterials.get(handleName) ?? []) {
          entry.material.color
            .copy(entry.baseColor)
            .lerp(new THREE.Color(0xffffff), 0.45);
        }
      }
    },
    dispose() {
      root.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          const material = object.material;
          if (Array.isArray(material)) {
            material.forEach((entry) => entry.dispose());
          } else {
            material.dispose();
          }
        }
      });
    }
  };
}

// --- Origin marker ---

export interface OriginMarker {
  root: THREE.Group;
  setPosition: (pos: [number, number, number]) => void;
  setVisible: (visible: boolean) => void;
  dispose: () => void;
}

export function createOriginMarker(): OriginMarker {
  const root = new THREE.Group();
  root.name = "origin-marker";
  root.renderOrder = 998;

  const mat = new THREE.MeshBasicMaterial({ color: 0xfab387, depthTest: false });
  root.add(
    configureOverlayMesh(
      new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 8), mat),
      998
    )
  );
  root.visible = false;

  return {
    root,
    setPosition(pos) { root.position.set(...pos); },
    setVisible(visible) { root.visible = visible; },
    dispose() { disposeOverlayGroup(root); }
  };
}

// --- World cursor ---

export interface WorldCursor {
  root: THREE.Group;
  setPosition: (pos: [number, number, number]) => void;
  setVisible: (visible: boolean) => void;
  dispose: () => void;
}

export function createWorldCursor(): WorldCursor {
  const root = new THREE.Group();
  root.name = "world-cursor";
  root.renderOrder = 997;

  const ringMat = new THREE.MeshBasicMaterial({
    color: 0xcba6f7, side: THREE.DoubleSide, depthTest: false
  });
  const ring = configureOverlayMesh(
    new THREE.Mesh(new THREE.RingGeometry(0.2, 0.25, 32), ringMat),
    997
  );
  ring.rotation.x = -Math.PI / 2;
  root.add(ring);

  const dotMat = new THREE.MeshBasicMaterial({ color: 0xcba6f7, depthTest: false });
  root.add(
    configureOverlayMesh(
      new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), dotMat),
      997
    )
  );

  root.visible = true;

  return {
    root,
    setPosition(pos) { root.position.set(...pos); },
    setVisible(visible) { root.visible = visible; },
    dispose() { disposeOverlayGroup(root); }
  };
}

// --- Selection hover hull ---

export interface SelectionHoverHull {
  root: THREE.Group;
  /** Rebuild the hull around a scene object (null clears it). */
  setTarget: (target: THREE.Object3D | null) => void;
  /** Per-frame: follow the target's current world transform. */
  syncTransform: () => void;
  dispose: () => void;
}

/**
 * Hover affordance: an enlarged back-face shell in selection orange
 * around the object under the cursor -- the standard editor "this is
 * selectable" outline, done as geometry (no post-process pass).
 * Hull meshes SHARE the target's geometries; only the one hull
 * material is owned here.
 */
export function createSelectionHoverHull(): SelectionHoverHull {
  const root = new THREE.Group();
  root.name = "selection-hover-hull";
  root.visible = false;
  root.matrixAutoUpdate = false;

  const material = new THREE.MeshBasicMaterial({
    color: 0xfab387,
    side: THREE.BackSide,
    toneMapped: false,
    depthWrite: false
  });

  const HULL_SCALE = 1.035;
  let target: THREE.Object3D | null = null;
  const inverseTarget = new THREE.Matrix4();
  const relative = new THREE.Matrix4();

  function rebuild() {
    root.clear();
    if (!target) return;
    target.updateWorldMatrix(true, true);
    inverseTarget.copy(target.matrixWorld).invert();
    target.traverse((object) => {
      // Skinned meshes deform on the GPU; a static hull clone would
      // show the bind pose. Placed props are the audience here.
      if (!(object instanceof THREE.Mesh) || (object as THREE.SkinnedMesh).isSkinnedMesh) {
        return;
      }
      const hull = new THREE.Mesh(object.geometry, material);
      // Visual-only: the hull shares the overlay root with the gizmo
      // and would otherwise intercept its hit-test rays.
      hull.raycast = () => {};
      hull.matrixAutoUpdate = false;
      relative.multiplyMatrices(inverseTarget, object.matrixWorld);
      hull.matrix.copy(relative);
      hull.renderOrder = 1;
      root.add(hull);
    });
  }

  return {
    root,
    setTarget(next) {
      if (next === target) return;
      target = next;
      root.visible = Boolean(next);
      rebuild();
      this.syncTransform();
    },
    syncTransform() {
      if (!target) return;
      // Target removed from the scene without a pointermove to re-aim
      // the hull (delete key, undo, representation swap): clear it,
      // or a ghost outline follows a detached root with disposed
      // geometries until the cursor next moves.
      if (!target.parent) {
        target = null;
        root.visible = false;
        root.clear();
        return;
      }
      target.updateWorldMatrix(true, false);
      root.matrix
        .copy(target.matrixWorld)
        .scale(new THREE.Vector3(HULL_SCALE, HULL_SCALE, HULL_SCALE));
    },
    dispose() {
      root.clear();
      material.dispose();
    }
  };
}

function disposeOverlayGroup(root: THREE.Group): void {
  root.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.geometry.dispose();
      const material = object.material;
      if (Array.isArray(material)) {
        material.forEach((entry) => entry.dispose());
      } else {
        material.dispose();
      }
    }
  });
}
