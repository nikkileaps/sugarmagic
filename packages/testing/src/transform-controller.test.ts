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
  type SelectionIntent,
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
  buttons = 0,
  modifiers: { shiftKey?: boolean } = {}
): NormalizedPointerEvent {
  return {
    screenX: 0,
    screenY: 0,
    normalizedX,
    normalizedY,
    button: 0,
    buttons,
    shiftKey: modifiers.shiftKey ?? false,
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
    // This harness drags a single object, so the reported batch is unwrapped
    // back to one transform and every assertion below reads as it always did.
    onPreview: (subjects) => previews.push(...subjects.map((s) => s.values)),
    onCommit: (subjects) => commits.push(...subjects.map((s) => s.values)),
    onCancel: (subjects) => cancels.push(...subjects.map((s) => s.values)),
    onSelect: () => {},
    onHoverHandle: (name) => hoverHandles.push(name),
    onHoverTarget: (object) => hoverTargets.push(object),
    getSelectedIds: () => ["instance-1"],
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

/**
 * A move drag covers the whole selection. Move is the pivot-independent
 * transform, so every object takes the same translation and the selection
 * keeps its spacing.
 */
describe("dragging many objects", () => {
  /** Three props in a row on x, at 0, 5 and 20. */
  const ROW: Record<string, TransformValues> = {
    prop_a: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    prop_b: { position: [5, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    prop_c: { position: [20, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }
  };

  function rowHarness(handle: string) {
    const previews: Array<
      Array<{ instanceId: string; values: TransformValues }>
    > = [];
    const commits: Array<
      Array<{ instanceId: string; values: TransformValues }>
    > = [];
    const cancels: Array<
      Array<{ instanceId: string; values: TransformValues }>
    > = [];
    const hitTestService = {
      testGizmo: () => ({
        mode: "gizmo" as const,
        objectName: handle,
        point: new THREE.Vector3(),
        distance: 1,
        object: new THREE.Object3D()
      }),
      testSelect: () => null,
      testSurface: () => null,
      setCamera: () => {},
      setAuthoredRoot: () => {},
      setOverlayRoot: () => {},
      setSurfaceRoot: () => {}
    } as HitTestService;

    const controller = createTransformController({
      hitTestService,
      getCamera: () => makeCamera(),
      getActiveTool: () => "move",
      onPreview: (subjects) => previews.push([...subjects]),
      onCommit: (subjects) => commits.push([...subjects]),
      onCancel: (subjects) => cancels.push([...subjects]),
      onSelect: () => {},
      onHoverHandle: () => {},
      onHoverTarget: () => {},
      getSelectedIds: () => ["prop_a", "prop_b", "prop_c"],
      getTransform: (instanceId) => {
        const found = ROW[instanceId];
        return found
          ? {
              position: [...found.position],
              rotation: [...found.rotation],
              scale: [...found.scale]
            }
          : null;
      }
    });
    return { controller, previews, commits, cancels };
  }

  it("moves every selected object by the same amount", () => {
    const h = rowHarness("gizmo-move-x");
    h.controller.onPointerDown!(pointer(0, 0));
    h.controller.onPointerMove!(pointer(0.1, 0));

    const last = h.previews.at(-1)!;
    const shift = 0.1 * WORLD_PER_NDC;
    expect(last).toHaveLength(3);
    expect(last[0].values.position[0]).toBeCloseTo(shift, 3);
    expect(last[1].values.position[0]).toBeCloseTo(5 + shift, 3);
    expect(last[2].values.position[0]).toBeCloseTo(20 + shift, 3);
  });

  it("keeps the spacing between the objects", () => {
    const h = rowHarness("gizmo-move-x");
    h.controller.onPointerDown!(pointer(0, 0));
    h.controller.onPointerMove!(pointer(0.3, 0));

    const [a, b, c] = h.previews.at(-1)!.map((s) => s.values.position[0]);
    expect(b - a).toBeCloseTo(5, 3);
    expect(c - b).toBeCloseTo(15, 3);
  });

  it("commits the whole selection in one call", () => {
    const h = rowHarness("gizmo-move-x");
    h.controller.onPointerDown!(pointer(0, 0));
    h.controller.onPointerMove!(pointer(0.1, 0));
    h.controller.onPointerUp!(pointer(0.1, 0));

    expect(h.commits).toHaveLength(1);
    expect(h.commits[0].map((s) => s.instanceId)).toEqual([
      "prop_a",
      "prop_b",
      "prop_c"
    ]);
  });

  it("cancels every object back to where it started", () => {
    const h = rowHarness("gizmo-move-x");
    h.controller.onPointerDown!(pointer(0, 0));
    h.controller.onPointerMove!(pointer(0.4, 0));
    h.controller.onCancel!();

    expect(h.cancels).toHaveLength(1);
    expect(h.cancels[0].map((s) => s.values.position[0])).toEqual([0, 5, 20]);
  });

  it("anchors the drag at the pivot, not at the first object", () => {
    // The three origins average to (25/3, 0, 0). A centre drag reads the
    // pointer against that plane, so the gizmo the author grabbed is the one
    // the maths uses.
    const h = rowHarness("gizmo-move-center");
    expect(h.controller.onPointerDown!(pointer(0, 0))).toBe(true);
    h.controller.onPointerMove!(pointer(0.1, 0));
    const last = h.previews.at(-1)!;
    expect(last[1].values.position[0] - last[0].values.position[0]).toBeCloseTo(
      5,
      3
    );
  });
});

/**
 * What a click asks the selection to do. The controller reads the modifier and
 * names the intent; deciding what the selection then holds is the store's job.
 */
describe("selection intent", () => {
  function selectionHarness(hit: string | null) {
    const selects: SelectionIntent[] = [];
    const object = new THREE.Object3D();
    const hitTestService = {
      testGizmo: () => null,
      testSelect: () =>
        hit === null
          ? null
          : {
              mode: "select" as const,
              objectName: hit,
              point: new THREE.Vector3(),
              distance: 1,
              object
            },
      testSurface: () => null,
      setCamera: () => {},
      setAuthoredRoot: () => {},
      setOverlayRoot: () => {},
      setSurfaceRoot: () => {}
    } as HitTestService;

    const controller = createTransformController({
      hitTestService,
      getCamera: () => makeCamera(),
      getActiveTool: () => "move",
      onPreview: () => {},
      onCommit: () => {},
      onCancel: () => {},
      onSelect: (intent) => selects.push(intent),
      onHoverHandle: () => {},
      onHoverTarget: () => {},
      getSelectedIds: () => [],
      getTransform: () => ({ ...IDENTITY })
    });
    return { controller, selects };
  }

  it("a plain click replaces the whole selection", () => {
    const { controller, selects } = selectionHarness("prop_a");
    controller.onPointerDown!(pointer(0, 0));
    expect(selects).toEqual([{ kind: "replace", instanceId: "prop_a" }]);
  });

  it("a shift-click toggles the clicked object", () => {
    const { controller, selects } = selectionHarness("prop_a");
    controller.onPointerDown!(pointer(0, 0, 0, { shiftKey: true }));
    expect(selects).toEqual([{ kind: "toggle", instanceId: "prop_a" }]);
  });

  it("clicking empty space clears the selection", () => {
    const { controller, selects } = selectionHarness(null);
    controller.onPointerDown!(pointer(0, 0));
    expect(selects).toEqual([{ kind: "clear" }]);
  });

  it("shift-clicking empty space clears rather than toggling nothing", () => {
    const { controller, selects } = selectionHarness(null);
    controller.onPointerDown!(pointer(0, 0, 0, { shiftKey: true }));
    expect(selects).toEqual([{ kind: "clear" }]);
  });
});

/**
 * Locking (epic #226 story 8). The scene composer draws the region so an
 * author can see where things sit, and lets them edit only the Scene's
 * overlay. "Locked" has to hold for picking, hovering AND dragging, or it
 * is only cosmetic.
 */
describe("selection locking", () => {
  function lockingHarness(locked: string) {
    const selects: SelectionIntent[] = [];
    const hovers: Array<THREE.Object3D | null> = [];
    const object = new THREE.Object3D();
    const hitTestService = {
      testGizmo: () => null,
      testSelect: () => ({
        mode: "select" as const,
        objectName: locked,
        point: new THREE.Vector3(),
        distance: 1,
        object
      }),
      testSurface: () => null,
      setCamera: () => {},
      setAuthoredRoot: () => {},
      setOverlayRoot: () => {},
      setSurfaceRoot: () => {}
    } as HitTestService;

    const controller = createTransformController({
      hitTestService,
      getCamera: () => makeCamera(),
      getActiveTool: () => "move",
      onPreview: () => {},
      onCommit: () => {},
      onCancel: () => {},
      onSelect: (id) => selects.push(id),
      onHoverHandle: () => {},
      onHoverTarget: (hit) => hovers.push(hit),
      getSelectedIds: () => [locked],
      getTransform: () => ({ ...IDENTITY }),
      isSelectable: (instanceId) => instanceId !== locked
    });
    return { controller, selects, hovers };
  }

  it("clicking a locked object selects nothing, not the thing behind it", () => {
    const { controller, selects } = lockingHarness("region:station-wall");
    controller.onPointerDown!(pointer(0, 0));
    expect(selects).toEqual([{ kind: "clear" }]);
  });

  it("a locked object gets no hover cue", () => {
    const { controller, hovers } = lockingHarness("region:station-wall");
    controller.onHoverMove!(pointer(0, 0));
    expect(hovers).toEqual([null]);
  });
});
