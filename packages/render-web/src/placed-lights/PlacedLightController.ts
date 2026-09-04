/**
 * Placed light scene controller.
 *
 * Turns the placed lights an author put in a region into concrete three.js
 * lights. Peer of the environment scene controller: that one owns the sun, the
 * rim light and ambient; this one owns everything an author placed by hand. A
 * placed light adds to the sun, never replaces it.
 *
 * Studio and the published game both drive this, so a lantern lights the Build
 * viewport and the running game identically.
 *
 * WHY THIS RECONCILES IN PLACE. three.js bakes the number of lights into the
 * shader cache key, so adding a light to the scene or taking one out
 * recompiles every material, while writing an existing light's color,
 * intensity or position is a free uniform write. Every apply therefore mutates
 * the lights it already has, and touches the scene graph only when a light
 * appears, disappears, is switched off, or changes kind. A light whose
 * intensity animates every frame costs nothing; a light being toggled costs a
 * frame hitch.
 */

import * as THREE from "three";
import { RectAreaLightNode } from "three/webgpu";
import { RectAreaLightTexturesLib } from "three/examples/jsm/lights/RectAreaLightTexturesLib.js";
import type { PlacedLight, PlacedLightKind } from "@sugarmagic/domain";

export interface PlacedLightController {
  /**
   * Make the scene hold exactly these lights. Pass the COMPOSED list (the
   * region's own lights plus the active Scene's), not the region document's
   * own, or a Scene's candles never light anything.
   */
  apply: (lights: readonly PlacedLight[]) => void;
  clear: () => void;
  dispose: () => void;
}

type PlacedThreeLight =
  | THREE.PointLight
  | THREE.SpotLight
  | THREE.RectAreaLight;

interface LiveLight {
  /** What the light was built as. A different kind is a different three.js
   *  class, so it cannot be mutated into the new one. */
  kind: PlacedLightKind;
  light: PlacedThreeLight;
  /**
   * Spot only. three.js aims a spot light at an object rather than by its own
   * rotation, so the target lives in the scene beside the light.
   */
  target: THREE.Object3D | null;
}

/**
 * Which way a light points before the author rotates it: straight down, the
 * way a lamp hangs. Blender's lights point down their local -Z with no
 * rotation, which is down in its Z-up world; this is the same thing said in a
 * Y-up world, so a Blender author's rotations mean what they expect.
 */
const UNROTATED_DIRECTION = new THREE.Vector3(0, -1, 0);

/** Physically based falloff. Intensity is candela for point and spot lights,
 *  so this is pinned rather than authored. */
const PHYSICAL_DECAY = 2;

function emissionDirection(light: PlacedLight): THREE.Vector3 {
  const rotation = new THREE.Euler(
    light.transform.rotation[0],
    light.transform.rotation[1],
    light.transform.rotation[2],
    "XYZ"
  );
  return UNROTATED_DIRECTION.clone().applyEuler(rotation);
}

/** Where a spot light aims, or where an area light faces: one metre along the
 *  direction it emits. */
function aimPoint(light: PlacedLight): THREE.Vector3 {
  const [x, y, z] = light.transform.position;
  return emissionDirection(light).add(new THREE.Vector3(x, y, z));
}

/**
 * An area light shades through lookup tables three.js does not ship loaded,
 * and renders black without them. They are global to the process and cost
 * about 80kb to build, so they are built once, here — the only place that
 * makes an area light — rather than at renderer setup, where a second
 * renderer or a one-shot frame capture would have to remember to do it too.
 * A project with no area lights never pays for them.
 */
let areaLightTablesLoaded = false;

function loadAreaLightTables(): void {
  if (areaLightTablesLoaded) return;
  RectAreaLightNode.setLTC(RectAreaLightTexturesLib.init());
  areaLightTablesLoaded = true;
}

function createLight(authored: PlacedLight): PlacedThreeLight {
  switch (authored.kind) {
    case "point":
      return new THREE.PointLight();
    case "spot":
      return new THREE.SpotLight();
    case "area":
      loadAreaLightTables();
      return new THREE.RectAreaLight();
  }
}

export function createPlacedLightController(
  scene: THREE.Scene
): PlacedLightController {
  const live = new Map<string, LiveLight>();

  function removeEntry(instanceId: string, entry: LiveLight): void {
    scene.remove(entry.light);
    if (entry.target) {
      scene.remove(entry.target);
    }
    entry.light.dispose();
    live.delete(instanceId);
  }

  function addEntry(authored: PlacedLight): LiveLight {
    const light = createLight(authored);
    // A placed light is fill; the environment's sun owns shadows, and keeps
    // its cascades. Revisit when a fireplace should throw the chair's shadow:
    // a spot costs one shadow map, a point costs six faces, and a
    // RectAreaLight cannot cast one at all.
    light.castShadow = false;
    scene.add(light);

    let target: THREE.Object3D | null = null;
    if (light instanceof THREE.SpotLight) {
      target = new THREE.Object3D();
      scene.add(target);
      light.target = target;
    }

    const entry: LiveLight = { kind: authored.kind, light, target };
    live.set(authored.instanceId, entry);
    return entry;
  }

  /**
   * Write the authored values onto the light that is already in the scene.
   * Every one of these is a uniform write, which is why it runs on every
   * apply rather than being diffed.
   */
  function updateEntry(entry: LiveLight, authored: PlacedLight): void {
    const [x, y, z] = authored.transform.position;
    entry.light.color.setHex(authored.color);
    entry.light.intensity = authored.intensity;
    entry.light.position.set(x, y, z);

    if (entry.light instanceof THREE.PointLight) {
      entry.light.distance = authored.radius ?? 0;
      entry.light.decay = PHYSICAL_DECAY;
      return;
    }

    if (entry.light instanceof THREE.SpotLight) {
      entry.light.distance = authored.radius ?? 0;
      entry.light.decay = PHYSICAL_DECAY;
      entry.light.angle =
        (authored.spot?.angleDeg ?? 0) * THREE.MathUtils.DEG2RAD;
      entry.light.penumbra = authored.spot?.penumbra ?? 0;
      // A spot lands a pool of light where it points and nothing in the air
      // between. Revisit when a window pool reads flat without a shaft.
      entry.target?.position.copy(aimPoint(authored));
      return;
    }

    // Area. No reach cutoff and no decay in three.js; intensity is nits.
    entry.light.width = authored.area?.width ?? 0;
    entry.light.height = authored.area?.height ?? 0;
    // A rect light emits from one face and is aimed by its own rotation.
    entry.light.lookAt(aimPoint(authored));
  }

  function apply(lights: readonly PlacedLight[]): void {
    // A light sits where the author left it. Nothing carries one, so there is
    // no per-frame follow here. Revisit at the first lantern an NPC holds or
    // a torch on a moving cart: the light would have to track a renderable
    // rather than an authored transform.
    //
    // Off means gone, not dim: a disabled light never reaches the scene, in
    // Studio or in play.
    const wanted = lights.filter((light) => light.enabled);
    const keep = new Set(wanted.map((light) => light.instanceId));

    for (const [instanceId, entry] of [...live]) {
      if (!keep.has(instanceId)) {
        removeEntry(instanceId, entry);
      }
    }

    for (const authored of wanted) {
      const existing = live.get(authored.instanceId);
      if (existing && existing.kind !== authored.kind) {
        removeEntry(authored.instanceId, existing);
      }
      updateEntry(
        live.get(authored.instanceId) ?? addEntry(authored),
        authored
      );
    }
  }

  function clear(): void {
    for (const [instanceId, entry] of [...live]) {
      removeEntry(instanceId, entry);
    }
  }

  return {
    apply,
    clear,
    dispose: clear
  };
}
