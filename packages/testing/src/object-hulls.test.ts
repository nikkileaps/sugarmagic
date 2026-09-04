import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  ACTIVE_HULL_COLOR,
  createObjectHulls,
  SELECTED_HULL_COLOR
} from "@sugarmagic/workspaces";

/** A scene object as the viewport draws one: a named root over a mesh. */
function placedProp(name: string): THREE.Object3D {
  const root = new THREE.Group();
  root.name = name;
  root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)));
  return root;
}

/** Hulls only follow objects that are in the scene, so parent them. */
function sceneWith(...objects: THREE.Object3D[]): THREE.Scene {
  const scene = new THREE.Scene();
  for (const object of objects) scene.add(object);
  return scene;
}

describe("Object hulls", () => {
  it("outlines nothing until given a target", () => {
    const hulls = createObjectHulls("test");
    expect(hulls.root.children).toHaveLength(0);
  });

  it("outlines every target it is given", () => {
    const [a, b, c] = [placedProp("a"), placedProp("b"), placedProp("c")];
    sceneWith(a, b, c);
    const hulls = createObjectHulls("test");

    hulls.setTargets([
      { object: a, color: SELECTED_HULL_COLOR },
      { object: b, color: SELECTED_HULL_COLOR },
      { object: c, color: ACTIVE_HULL_COLOR }
    ]);

    expect(hulls.root.children).toHaveLength(3);
  });

  it("drops the outline of a target that is no longer given", () => {
    const [a, b] = [placedProp("a"), placedProp("b")];
    sceneWith(a, b);
    const hulls = createObjectHulls("test");

    hulls.setTargets([
      { object: a, color: SELECTED_HULL_COLOR },
      { object: b, color: SELECTED_HULL_COLOR }
    ]);
    hulls.setTargets([{ object: b, color: SELECTED_HULL_COLOR }]);

    expect(hulls.root.children).toHaveLength(1);
  });

  it("draws the active target in a different colour from a selected one", () => {
    const [selected, active] = [placedProp("a"), placedProp("b")];
    sceneWith(selected, active);
    const hulls = createObjectHulls("test");

    hulls.setTargets([
      { object: selected, color: SELECTED_HULL_COLOR },
      { object: active, color: ACTIVE_HULL_COLOR }
    ]);

    const colors = hulls.root.children.map((group) => {
      const mesh = group.children[0] as THREE.Mesh;
      return (mesh.material as THREE.MeshBasicMaterial).color.getHex();
    });
    expect(new Set(colors).size).toBe(2);
    expect(ACTIVE_HULL_COLOR).not.toBe(SELECTED_HULL_COLOR);
  });

  it("rebuilds a target's outline when its colour changes", () => {
    const prop = placedProp("a");
    sceneWith(prop);
    const hulls = createObjectHulls("test");

    hulls.setTargets([{ object: prop, color: SELECTED_HULL_COLOR }]);
    hulls.setTargets([{ object: prop, color: ACTIVE_HULL_COLOR }]);

    expect(hulls.root.children).toHaveLength(1);
    const mesh = hulls.root.children[0].children[0] as THREE.Mesh;
    expect((mesh.material as THREE.MeshBasicMaterial).color.getHex()).toBe(
      ACTIVE_HULL_COLOR
    );
  });

  it("shares the target's geometry rather than cloning it", () => {
    const prop = placedProp("a");
    sceneWith(prop);
    const hulls = createObjectHulls("test");

    hulls.setTargets([{ object: prop, color: SELECTED_HULL_COLOR }]);

    const source = prop.children[0] as THREE.Mesh;
    const hull = hulls.root.children[0].children[0] as THREE.Mesh;
    expect(hull.geometry).toBe(source.geometry);
  });

  it("stops outlining a target that has left the scene", () => {
    const prop = placedProp("a");
    const scene = sceneWith(prop);
    const hulls = createObjectHulls("test");
    hulls.setTargets([{ object: prop, color: SELECTED_HULL_COLOR }]);

    scene.remove(prop);
    hulls.syncTransform();

    expect(hulls.root.children).toHaveLength(0);
  });

  it("does not outline instanced members, which batch into one mesh", () => {
    const prop = placedProp("a");
    prop.userData.sugarmagicSceneObject = { instanceId: "a", instanced: true };
    sceneWith(prop);
    const hulls = createObjectHulls("test");

    hulls.setTargets([{ object: prop, color: SELECTED_HULL_COLOR }]);

    expect(hulls.root.children[0].children).toHaveLength(0);
  });

  it("does not outline skinned meshes, which would show the bind pose", () => {
    const root = new THREE.Group();
    root.name = "character";
    root.add(new THREE.SkinnedMesh(new THREE.BoxGeometry(1, 1, 1)));
    sceneWith(root);
    const hulls = createObjectHulls("test");

    hulls.setTargets([{ object: root, color: SELECTED_HULL_COLOR }]);

    expect(hulls.root.children[0].children).toHaveLength(0);
  });

  it("follows the target's world transform", () => {
    const prop = placedProp("a");
    sceneWith(prop);
    const hulls = createObjectHulls("test");
    hulls.setTargets([{ object: prop, color: SELECTED_HULL_COLOR }]);

    prop.position.set(5, 0, -2);
    hulls.syncTransform();

    const position = new THREE.Vector3().setFromMatrixPosition(
      hulls.root.children[0].matrix
    );
    expect(position.x).toBeCloseTo(5);
    expect(position.z).toBeCloseTo(-2);
  });
});
