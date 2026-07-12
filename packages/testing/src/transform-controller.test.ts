/**
 * Transform controller behavior tests.
 *
 * Drives the ray-based drag sessions with synthetic normalized
 * pointer events and a stub HitTestService: axis moves track the
 * cursor 1:1, the trackball rotates TOWARD the drag (the operand
 * order was inverted once), center scale stays proportionate, one
 * gesture commits once, cancel restores, and no-op drags commit
 * nothing.
 */

import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  createTransformController,
  type HitTestService,
  type NormalizedPointerEvent,
  type TransformValues
} from "@sugarmagic/workspaces";

const IDENTITY: TransformValues = {
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1]
};

function pointer(
  normalizedX: number,
  normalizedY: number,
  buttons = 0
): NormalizedPointerEvent {
  return {
    screenX: 0,
    screenY: 0,
    normalizedX,
    normalizedY,
    button: 0,
    buttons,
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false
  };
}

function makeCamera(): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  return camera;
}

interface Harness {
  controller: ReturnType<typeof createTransformController>;
  previews: TransformValues[];
  commits: TransformValues[];
  cancels: TransformValues[];
  hoverHandles: Array<string | null>;
  hoverTargets: Array<THREE.Object3D | null>;
}

function makeHarness(options: {
  gizmoHitName: string | null;
  selectHit?: { objectName: string; object: THREE.Object3D } | null;
  transform?: TransformValues;
}): Harness {
  const camera = makeCamera();
  const previews: TransformValues[] = [];
  const commits: TransformValues[] = [];
  const cancels: TransformValues[] = [];
  const hoverHandles: Array<string | null> = [];
  const hoverTargets: Array<THREE.Object3D | null> = [];

  const hitTestService = {
    testGizmo: () =>
      options.gizmoHitName
        ? {
            mode: "gizmo" as const,
            objectName: options.gizmoHitName,
            point: new THREE.Vector3(),
            distance: 1,
            object: new THREE.Object3D()
          }
        : null,
    testSelect: () =>
      options.selectHit
        ? {
            mode: "select" as const,
            objectName: options.selectHit.objectName,
            point: new THREE.Vector3(),
            distance: 1,
            object: options.selectHit.object
          }
        : null,
    testSurface: () => null,
    setCamera: () => {},
    setAuthoredRoot: () => {},
    setOverlayRoot: () => {},
    setSurfaceRoot: () => {}
  } as HitTestService;

  const start = options.transform ?? IDENTITY;
  const controller = createTransformController({
    hitTestService,
    getCamera: () => camera,
    getActiveTool: () => "move",
    onPreview: (_, values) => previews.push(values),
    onCommit: (_, values) => commits.push(values),
    onCancel: (_, values) => cancels.push(values),
    onSelect: () => {},
    onHoverHandle: (name) => hoverHandles.push(name),
    onHoverTarget: (object) => hoverTargets.push(object),
    getSelectedId: () => "instance-1",
    getTransform: () => ({
      position: [...start.position],
      rotation: [...start.rotation],
      scale: [...start.scale]
    })
  });

  return { controller, previews, commits, cancels, hoverHandles, hoverTargets };
}

// With the camera 10 out at fov 60 / aspect 1, NDC x maps to world x
// at the z=0 plane as x = ndc * 10 * tan(30deg).
const WORLD_PER_NDC = 10 * Math.tan(Math.PI / 6);

describe("transform controller drags", () => {
  it("moves along the axis 1:1 with the pointer ray", () => {
    const h = makeHarness({ gizmoHitName: "gizmo-move-x" });
    expect(h.controller.onPointerDown!(pointer(0, 0))).toBe(true);
    h.controller.onPointerMove!(pointer(0.1, 0));
    const last = h.previews.at(-1)!;
    expect(last.position[0]).toBeCloseTo(0.1 * WORLD_PER_NDC, 3);
    expect(last.position[1]).toBe(0);
    expect(last.position[2]).toBe(0);
  });

  it("commits exactly once with the final values", () => {
    const h = makeHarness({ gizmoHitName: "gizmo-move-x" });
    h.controller.onPointerDown!(pointer(0, 0));
    h.controller.onPointerMove!(pointer(0.1, 0));
    h.controller.onPointerMove!(pointer(0.2, 0));
    h.controller.onPointerUp!(pointer(0.2, 0));
    expect(h.commits).toHaveLength(1);
    expect(h.commits[0]!.position[0]).toBeCloseTo(0.2 * WORLD_PER_NDC, 3);
  });

  it("does not commit a drag that never changed anything", () => {
    const h = makeHarness({ gizmoHitName: "gizmo-move-x" });
    h.controller.onPointerDown!(pointer(0, 0));
    h.controller.onPointerUp!(pointer(0, 0));
    expect(h.commits).toHaveLength(0);
  });

  it("cancel restores the drag-start values", () => {
    const h = makeHarness({ gizmoHitName: "gizmo-move-x" });
    h.controller.onPointerDown!(pointer(0, 0));
    h.controller.onPointerMove!(pointer(0.3, 0));
    h.controller.onCancel!();
    expect(h.cancels).toHaveLength(1);
    expect(h.cancels[0]!.position).toEqual([0, 0, 0]);
    expect(h.commits).toHaveLength(0);
  });

  it("center move follows the cursor in the camera plane", () => {
    const h = makeHarness({ gizmoHitName: "gizmo-move-center" });
    h.controller.onPointerDown!(pointer(0, 0));
    h.controller.onPointerMove!(pointer(0.1, 0.1));
    const last = h.previews.at(-1)!;
    expect(last.position[0]).toBeCloseTo(0.1 * WORLD_PER_NDC, 3);
    expect(last.position[1]).toBeCloseTo(0.1 * WORLD_PER_NDC, 3);
    expect(last.position[2]).toBeCloseTo(0, 3);
  });

  it("trackball drag-down tips the top of the object TOWARD the camera", () => {
    // Camera at +Z looking -Z. Dragging DOWN must rotate around +X
    // (top of the object comes toward the viewer) -- the operand
    // order in the cross product was inverted once and shipped.
    const h = makeHarness({ gizmoHitName: "gizmo-rotate-center" });
    h.controller.onPointerDown!(pointer(0, 0));
    h.controller.onPointerMove!(pointer(0, -0.1));
    const last = h.previews.at(-1)!;
    expect(last.rotation[0]).toBeGreaterThan(0.01);
    expect(Math.abs(last.rotation[1])).toBeLessThan(1e-6);
    expect(Math.abs(last.rotation[2])).toBeLessThan(1e-6);
  });

  it("center scale grows on up-right drags, uniformly and without exploding", () => {
    const h = makeHarness({ gizmoHitName: "gizmo-scale-center" });
    h.controller.onPointerDown!(pointer(0, 0));
    h.controller.onPointerMove!(pointer(0.1, 0.1));
    const last = h.previews.at(-1)!;
    const factor = last.scale[0];
    expect(factor).toBeGreaterThan(1.2);
    expect(factor).toBeLessThan(3);
    expect(last.scale[1]).toBeCloseTo(factor, 6);
    expect(last.scale[2]).toBeCloseTo(factor, 6);
  });

  it("center scale keeps shrinking on down-left drags PAST the object's center", () => {
    // Regression: unsigned distance-from-center mappings bounce --
    // after a few pixels of shrink the cursor crosses the center and
    // the object starts GROWING again. The signed diagonal mapping
    // must shrink monotonically the further down-left the drag goes.
    const h = makeHarness({ gizmoHitName: "gizmo-scale-center" });
    h.controller.onPointerDown!(pointer(0.02, 0.02));
    h.controller.onPointerMove!(pointer(0, 0));
    const atCenter = h.previews.at(-1)!.scale[0];
    h.controller.onPointerMove!(pointer(-0.15, -0.15));
    const pastCenter = h.previews.at(-1)!.scale[0];
    expect(atCenter).toBeLessThan(1);
    expect(pastCenter).toBeLessThan(atCenter);
    expect(pastCenter).toBeGreaterThan(0);
  });
});

describe("transform controller hover", () => {
  it("reports the gizmo handle under the cursor and suppresses the target outline", () => {
    const h = makeHarness({
      gizmoHitName: "gizmo-move-x",
      selectHit: { objectName: "instance-1", object: new THREE.Object3D() }
    });
    h.controller.onHoverMove!(pointer(0, 0));
    expect(h.hoverHandles.at(-1)).toBe("gizmo-move-x");
    expect(h.hoverTargets.at(-1)).toBeNull();
  });

  it("outlines the selectable object when no handle is under the cursor", () => {
    const object = new THREE.Object3D();
    const h = makeHarness({
      gizmoHitName: null,
      selectHit: { objectName: "instance-1", object }
    });
    h.controller.onHoverMove!(pointer(0, 0));
    expect(h.hoverHandles.at(-1)).toBeNull();
    expect(h.hoverTargets.at(-1)).toBe(object);
  });

  it("freezes hover while a button is held (camera orbit)", () => {
    const h = makeHarness({ gizmoHitName: "gizmo-move-x" });
    h.controller.onHoverMove!(pointer(0, 0, 2));
    expect(h.hoverHandles).toHaveLength(0);
    expect(h.hoverTargets).toHaveLength(0);
  });

  it("clears both affordances on hover leave", () => {
    const h = makeHarness({ gizmoHitName: "gizmo-move-x" });
    h.controller.onHoverLeave!();
    expect(h.hoverHandles.at(-1)).toBeNull();
    expect(h.hoverTargets.at(-1)).toBeNull();
  });
});
