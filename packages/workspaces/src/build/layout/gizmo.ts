/**
 * Layout viewport gizmos: move, rotate, and scale for the selected placed object.
 *
 * Gizmo visuals are editor/tool overlays — not authored scene truth.
 * They live in the overlay root of the runtime viewport.
 */

import * as THREE from "three";
import type { TransformTool } from "../../interaction/tool-state";

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
  group.name = `gizmo-move-${axis}`;

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
  shaft.name = `gizmo-move-${axis}`;
  group.add(shaft);

  const cone = configureOverlayMesh(new THREE.Mesh(
    new THREE.ConeGeometry(0.1, 0.25, 12),
    mat
  ), 999);
  cone.position.copy(direction.clone().multiplyScalar(1.625));
  if (axis === "x") cone.rotation.z = -Math.PI / 2;
  if (axis === "z") cone.rotation.x = Math.PI / 2;
  cone.name = `gizmo-move-${axis}`;
  group.add(cone);

  return group;
}

// --- Rotate gizmo: torus rings per axis ---

function createRotateHandle(axis: Axis, color: number): THREE.Group {
  const group = new THREE.Group();
  group.name = `gizmo-rotate-${axis}`;

  const mat = new THREE.MeshBasicMaterial({
    color,
    depthTest: false,
    side: THREE.DoubleSide
  });

  const ring = configureOverlayMesh(new THREE.Mesh(
    new THREE.TorusGeometry(1.2, 0.03, 8, 48),
    mat
  ), 999);
  ring.name = `gizmo-rotate-${axis}`;

  if (axis === "x") ring.rotation.y = Math.PI / 2;
  if (axis === "z") ring.rotation.x = Math.PI / 2;
  // axis === "y" stays flat (default)

  group.add(ring);
  return group;
}

// --- Scale gizmo: shafts + cube tips ---

function createScaleHandle(axis: Axis, color: number): THREE.Group {
  const group = new THREE.Group();
  group.name = `gizmo-scale-${axis}`;

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
  shaft.name = `gizmo-scale-${axis}`;
  group.add(shaft);

  const cube = configureOverlayMesh(new THREE.Mesh(
    new THREE.BoxGeometry(0.15, 0.15, 0.15),
    mat
  ), 999);
  cube.position.copy(direction.clone().multiplyScalar(1.3));
  cube.name = `gizmo-scale-${axis}`;
  group.add(cube);

  return group;
}

// --- Composite gizmo ---

export interface LayoutGizmo {
  root: THREE.Group;
  setPosition: (pos: [number, number, number]) => void;
  setRotation: (rot: [number, number, number]) => void;
  setScale: (scale: number) => void;
  setVisible: (visible: boolean) => void;
  setActiveTool: (tool: TransformTool) => void;
}

export function createLayoutGizmo(): LayoutGizmo {
  const root = new THREE.Group();
  root.name = "layout-gizmo";
  root.renderOrder = 999;

  const moveGroup = new THREE.Group();
  moveGroup.name = "gizmo-move";
  for (const axis of AXES) moveGroup.add(createMoveHandle(axis, AXIS_COLORS[axis]));
  root.add(moveGroup);

  const rotateGroup = new THREE.Group();
  rotateGroup.name = "gizmo-rotate";
  for (const axis of AXES) rotateGroup.add(createRotateHandle(axis, AXIS_COLORS[axis]));
  root.add(rotateGroup);

  const scaleGroup = new THREE.Group();
  scaleGroup.name = "gizmo-scale";
  for (const axis of AXES) scaleGroup.add(createScaleHandle(axis, AXIS_COLORS[axis]));
  root.add(scaleGroup);

  root.visible = false;

  function showOnly(tool: TransformTool) {
    moveGroup.visible = tool === "move";
    rotateGroup.visible = tool === "rotate";
    scaleGroup.visible = tool === "scale";
  }

  showOnly("move");

  return {
    root,
    setPosition(pos) {
      root.position.set(...pos);
    },
    setRotation(rot) {
      root.rotation.set(...rot);
    },
    setScale(scale) {
      root.scale.setScalar(scale);
    },
    setVisible(visible) {
      root.visible = visible;
    },
    setActiveTool(tool) {
      showOnly(tool);
    }
  };
}

// --- Origin marker ---

export interface OriginMarker {
  root: THREE.Group;
  setPosition: (pos: [number, number, number]) => void;
  setVisible: (visible: boolean) => void;
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
    setVisible(visible) { root.visible = visible; }
  };
}

// --- World cursor ---

export interface WorldCursor {
  root: THREE.Group;
  setPosition: (pos: [number, number, number]) => void;
  setVisible: (visible: boolean) => void;
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
    setVisible(visible) { root.visible = visible; }
  };
}
