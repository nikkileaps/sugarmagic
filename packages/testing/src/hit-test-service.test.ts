/**
 * HitTestService visibility tests.
 *
 * Three's Raycaster intersects hidden objects (visibility is a render
 * concern it never consults), so the service must filter them. The
 * regression here: all three gizmo mode groups coexist in the overlay
 * root with only the active one visible -- the hidden rotate
 * trackball sphere (large, centered) stole every center-handle click
 * from the move and scale gizmos.
 */

import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  createHitTestService,
  createLayoutGizmo,
  SCENE_OBJECT_MARKER_KEY
} from "@sugarmagic/workspaces";

function makeCamera(): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  return camera;
}

describe("hit-test service visibility", () => {
  it("ignores objects hidden via an invisible ancestor", () => {
    const overlayRoot = new THREE.Group();
    const material = new THREE.MeshBasicMaterial();

    const hiddenGroup = new THREE.Group();
    hiddenGroup.visible = false;
    const near = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), material);
    near.name = "hidden-near";
    near.position.set(0, 0, 2);
    hiddenGroup.add(near);
    overlayRoot.add(hiddenGroup);

    const far = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), material);
    far.name = "visible-far";
    overlayRoot.add(far);

    const service = createHitTestService();
    service.setCamera(makeCamera());
    service.setOverlayRoot(overlayRoot);

    const hit = service.testGizmo(0, 0);
    expect(hit?.objectName).toBe("visible-far");
  });

  it("resolves gizmo center clicks to the ACTIVE mode group", () => {
    const gizmo = createLayoutGizmo();
    gizmo.setVisible(true);
    const overlayRoot = new THREE.Group();
    overlayRoot.add(gizmo.root);
    overlayRoot.updateMatrixWorld(true);

    const service = createHitTestService();
    service.setCamera(makeCamera());
    service.setOverlayRoot(overlayRoot);

    // A dead-center click while each tool is active must name that
    // tool's center handle -- the hidden rotate trackball is nearer
    // to the camera than the small move/scale center handles and
    // must not steal the hit. It also must not lose to the edge-on
    // axis shaft the camera is looking straight down.
    for (const tool of ["move", "scale"] as const) {
      gizmo.setActiveTool(tool);
      const hit = service.testGizmo(0, 0);
      expect(hit?.objectName).toBe(`gizmo-${tool}-center`);
    }

    // Rotate: the x/y ring tubes legitimately cross the dead-center
    // ray at (0, 0, +-1.2) and thin rings keep priority over the
    // coarse trackball, so aim just off-center -- inside the ball,
    // clear of every ring tube.
    gizmo.setActiveTool("rotate");
    const hit = service.testGizmo(0.01, 0.01);
    expect(hit?.objectName).toBe("gizmo-rotate-center");
  });
});

describe("hit-test service select resolution", () => {
  it("resolves select hits to the tagged scene-object root, not GLB-internal mesh names", () => {
    const authoredRoot = new THREE.Group();

    // Mimic a placed-asset root the authoring viewport builds: a
    // tagged group (name = instanceId) wrapping a glTF scene whose
    // internal meshes carry their own author-given names.
    const instanceRoot = new THREE.Group();
    instanceRoot.name = "placed-asset-42";
    instanceRoot.userData[SCENE_OBJECT_MARKER_KEY] = {
      instanceId: "placed-asset-42",
      kind: "asset"
    };
    const gltfScene = new THREE.Group();
    gltfScene.name = "Scene";
    const blooms = new THREE.Mesh(
      new THREE.SphereGeometry(1, 8, 6),
      new THREE.MeshBasicMaterial()
    );
    blooms.name = "blooms";
    gltfScene.add(blooms);
    instanceRoot.add(gltfScene);
    authoredRoot.add(instanceRoot);
    authoredRoot.updateMatrixWorld(true);

    const service = createHitTestService();
    service.setCamera(makeCamera());
    service.setAuthoredRoot(authoredRoot);

    const hit = service.testSelect(0, 0);
    expect(hit?.objectName).toBe("placed-asset-42");
    expect(hit?.object).toBe(instanceRoot);
  });

  it("falls back to the generic named-node walk for untagged content", () => {
    const authoredRoot = new THREE.Group();
    const landscape = new THREE.Mesh(
      new THREE.PlaneGeometry(10, 10),
      new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })
    );
    landscape.name = "landscape-plane";
    authoredRoot.add(landscape);
    authoredRoot.updateMatrixWorld(true);

    const service = createHitTestService();
    service.setCamera(makeCamera());
    service.setAuthoredRoot(authoredRoot);

    const hit = service.testSelect(0, 0);
    expect(hit?.objectName).toBe("landscape-plane");
  });
});
