/**
 * Shared renderable-lifecycle reconciler (Plan 070.2).
 *
 * ONE place that turns a desired `SceneObject[]` into live THREE
 * renderables: diff (via runtime-core `computeSceneDelta`) -> load / update
 * / dispose, keyed by instanceId. Both the studio authoring viewport and
 * the game runtime host consume it, replacing two near-identical hand-
 * rolled lifecycles (the GLB clone/sanitize/scale/shadow/parent/shader
 * hydrate sequence was duplicated verbatim; see git history of
 * authoringViewport.ts + runtimeHost.ts).
 *
 * Divergences between the two hosts are absorbed by injected config, NOT
 * by branching in here: loader, url resolver, fallback factory, shadow
 * policy, the per-object "host slot" (the game stashes an AnimationMixer
 * there), the grouping gate (game instances by representationKey; studio
 * stays OFF until 070.6), and add/remove hooks (mixer attach, item-
 * collection removal). Each host keeps its own scene/view ownership; this
 * only manages the renderable subtree under an injected `parent`.
 *
 * Async-load safety: every load is guarded by a generation epoch + a
 * `desired` map. A load that resolves after its object was removed, or
 * after the object's representation changed, is discarded (its partial
 * renderable disposed) instead of attaching stale geometry.
 */

import * as THREE from "three";
import { clone as cloneSkinnedObject } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { SceneObject } from "@sugarmagic/runtime-core";
import { computeSceneDelta } from "@sugarmagic/runtime-core";
import {
  createRenderableShaderApplicationState,
  ensureShaderSetAppliedToRenderable,
  type RenderableShaderApplicationState
} from "./applyShaderToRenderable";
import type { ShaderRuntime } from "./ShaderRuntime";
import {
  disposeRenderableObject,
  sanitizeRenderableVertexFormats
} from "./renderableFallbacks";
import { normalizeModelScale } from "./renderableTransforms";
import {
  buildInstancedAssetGroup,
  type InstancedAssetGroupResult
} from "./instanced-group";

/** A live renderable managed by the reconciler. */
export interface ReconciledEntry {
  /** The wrapper Group parented under the reconciler's `parent`. */
  readonly root: THREE.Group;
  /** The SceneObject this entry currently represents. */
  object: SceneObject;
  /** representationKey at load time — a change forces a rebuild. */
  representationKey: string;
  /** false while showing a fallback (no asset URL / load or shader error). */
  loadedWithAsset: boolean;
  readonly shaderApplication: RenderableShaderApplicationState;
  /** true for an instanced-group entry (keyed by group key, not instanceId). */
  readonly instanced: boolean;
  /**
   * Host-owned scratch slot. The game stashes its `AnimationMixer` here;
   * the studio leaves it empty. The reconciler never reads it.
   */
  host: Record<string, unknown>;
  /** Set for instanced entries: the ordered member instanceIds. */
  instanceOrder?: readonly string[];
  /** Set for instanced entries: disposes the InstancedMesh build. */
  disposeGroup?: () => void;
  /** Set for instanced entries: patch one member's matrix in place (070.6). */
  updateInstance?: (index: number, transform: SceneObject["transform"]) => void;
  /** Set for instanced entries: last-applied member transforms (to detect
   *  which members moved between reconciles). */
  memberTransforms?: SceneObject["transform"][];
}

export interface RenderableReconcilerConfig {
  /** Renderables are parented here (studio: authoredRoot; game: scene). */
  parent: THREE.Object3D;
  /** Resolve an object's model to a loadable URL, or null for a fallback. */
  resolveUrl: (object: SceneObject) => string | null;
  /** Load a GLB scene from a URL. Injected so tests use a fake loader. */
  loadModel: (url: string) => Promise<THREE.Object3D>;
  /** Build the fallback subtree when there is no asset URL. */
  createFallback: (object: SceneObject) => THREE.Object3D;
  /**
   * Build the fallback subtree when a load / shader-apply ERRORS (distinct
   * from the no-asset case). The studio shows a loud magenta mesh + alert
   * here; the game just uses createFallback. Defaults to createFallback.
   */
  createErrorFallback?: (object: SceneObject, error: unknown) => THREE.Object3D;
  shaderRuntime: ShaderRuntime | null;
  /**
   * The asset-source map. MUST be reference-stable across reconciles
   * unless it truly changes: the shader-ensure fast path compares it by
   * reference, so a fresh object every frame rebuilds every renderable's
   * grass (070.2 contract).
   */
  getFileSources: () => Record<string, string>;
  /** Host shadow policy applied to a freshly-loaded renderable. */
  enableShadows?: (root: THREE.Object3D) => void;
  /** Grouping gate: game ON, studio OFF (until 070.6). */
  grouping?: boolean;
  /** With grouping ON, which objects may be instanced (game predicate). */
  isInstanceable?: (object: SceneObject) => boolean;
  /** Optional per-object validation; a message string aborts to fallback. */
  validate?: (object: SceneObject, renderable: THREE.Object3D) => string | null;
  /** Fires after an entry's renderable is live (game attaches mixers here). */
  onEntryLoaded?: (entry: ReconciledEntry, renderable: THREE.Object3D) => void;
  /** Fires when the in-flight load set drains to empty (the studio uses it
   *  to dismiss its "updating scene" toast). */
  onSettled?: () => void;
  /** Fires just before an entry is removed + disposed. */
  onEntryWillRemove?: (entry: ReconciledEntry) => void;
  logger?: { warn: (message: string, payload?: unknown) => void };
}

/**
 * Render-budget counts (Plan 070.8). `drawUnits` (singleton renderables +
 * instanced group roots) is the number that stays flat as `instances` grows —
 * that flatness IS the batching win, and the headless budget alarm asserts it.
 */
export interface RenderableStats {
  singletons: number;
  groups: number;
  /** Total placed members represented (singletons + all grouped members). */
  instances: number;
  /** Draw roots = singletons + groups; the budgeted number. */
  drawUnits: number;
}

export interface RenderableReconciler {
  /** Diff `desired` against the live set and apply add/update/remove. */
  reconcile(desired: SceneObject[]): void;
  /** Live entry for an instanceId (host per-instance cross-cutting reads). */
  get(instanceId: string): ReconciledEntry | undefined;
  /**
   * Host-driven removal of ONE singleton by instanceId (e.g. the game
   * dropping an item's visual on collection — an event, not a re-diff).
   * The next reconcile() re-adds it if still desired, so callers that also
   * drop it from the desired set get permanent removal.
   */
  remove(instanceId: string): void;
  /**
   * Drop every renderable of one asset -- singletons AND instanced groups --
   * so the next reconcile rebuilds them from the (freshly re-imported / baked)
   * source. `remove()` only reaches singletons; a brushed/scatter asset is a
   * group, so a reload path must dispose those too or it silently shows stale
   * geometry after a paint-UV bake / origin correction (070.8 review).
   */
  reloadAsset(assetDefinitionId: string): void;
  /** All live entries (singletons + instanced groups). */
  entries(): IterableIterator<ReconciledEntry>;
  /** Draw/chunk counts for the render-stats HUD + budget alarm (070.8). */
  stats(): RenderableStats;
  /** Remove + dispose everything. */
  dispose(): void;
}

function applyTransform(root: THREE.Object3D, object: SceneObject): void {
  root.position.set(
    object.transform.position[0],
    object.transform.position[1],
    object.transform.position[2]
  );
  root.rotation.set(
    object.transform.rotation[0],
    object.transform.rotation[1],
    object.transform.rotation[2]
  );
  root.scale.set(
    object.transform.scale[0],
    object.transform.scale[1],
    object.transform.scale[2]
  );
}

const GROUP_KEY_PREFIX = "instanced:";

function transformsEqual(
  a: SceneObject["transform"] | undefined,
  b: SceneObject["transform"]
): boolean {
  if (!a) return false;
  for (let i = 0; i < 3; i += 1) {
    if (
      a.position[i] !== b.position[i] ||
      a.rotation[i] !== b.rotation[i] ||
      a.scale[i] !== b.scale[i]
    ) {
      return false;
    }
  }
  return true;
}

export function createRenderableReconciler(
  config: RenderableReconcilerConfig
): RenderableReconciler {
  // instanceId -> singleton entry.
  const entries = new Map<string, ReconciledEntry>();
  // groupKey (`instanced:${representationKey}`) -> instanced entry.
  const groups = new Map<string, ReconciledEntry>();
  // instanceIds with an async load in flight.
  const pending = new Set<string>();
  // groupKeys with an async group build in flight (dedup, like `pending`).
  const pendingGroups = new Set<string>();
  // groupKey -> the LATEST desired members. A group build reads this on
  // completion (not the members captured at schedule time), so a membership
  // change during the load commits the up-to-date batch, not a stale one.
  const desiredGroupMembers = new Map<string, SceneObject[]>();
  // What the latest reconcile wants on screen, by instanceId — async loads
  // consult this on completion (not a bare generation counter, so a re-add
  // of the same id during a load still adopts).
  const desired = new Map<string, SceneObject>();
  let generation = 0;

  function hydrate(
    root: THREE.Group,
    object: SceneObject,
    gltfScene: THREE.Object3D,
    shaderApplication: RenderableShaderApplicationState
  ): boolean {
    // SkeletonUtils.clone (NOT Object3D.clone): rebinds skinned meshes to
    // cloned bones so wrapper-Group transforms move the rendered mesh.
    const renderable = cloneSkinnedObject(gltfScene) as THREE.Object3D;
    // WebGPU rejects normalized-float vertex formats -> sanitize at EVERY
    // load boundary or createRenderPipeline crashes the loop.
    sanitizeRenderableVertexFormats(renderable);
    const validationError = config.validate?.(object, renderable) ?? null;
    if (validationError) {
      config.logger?.warn("reconciler-invalid-asset", {
        instanceId: object.instanceId,
        message: validationError
      });
      root.add(config.createFallback(object));
      return false;
    }
    // Populate matrixWorld BEFORE bbox measure (skinned bboxes read bone
    // matrixWorlds; identity -> garbage bbox -> wrong scale).
    renderable.updateMatrixWorld(true);
    if (object.targetModelHeight) {
      normalizeModelScale(renderable, object.targetModelHeight);
    }
    // Skinned frustum-cull off: bind-pose bounding sphere goes stale after
    // rescale/animation and can pop the model out of view.
    renderable.traverse((child) => {
      if ((child as THREE.SkinnedMesh).isSkinnedMesh) {
        child.frustumCulled = false;
      }
    });
    config.enableShadows?.(renderable);
    // Parent BEFORE building shaders: the asset-surface bake frames the
    // mesh in WORLD XZ, so the mesh world matrix must include the instance
    // transform at build time (Plan 068.11 — building unparented baked in
    // local space -> blades sampled outside the map -> black grass).
    root.add(renderable);
    root.updateMatrixWorld(true);
    try {
      ensureShaderSetAppliedToRenderable(
        renderable,
        object,
        config.shaderRuntime,
        shaderApplication,
        config.getFileSources()
      );
    } catch (error) {
      // Shader-apply blew up (bad graph / poisoned binding). Drop the
      // partial renderable and show the error fallback.
      root.remove(renderable);
      disposeRenderableObject(renderable);
      root.add(
        config.createErrorFallback
          ? config.createErrorFallback(object, error)
          : config.createFallback(object)
      );
      return false;
    }
    return true;
  }

  function scheduleLoad(object: SceneObject, loadGeneration: number): void {
    if (pending.has(object.instanceId)) {
      return;
    }
    const url = config.resolveUrl(object);
    const root = new THREE.Group();
    root.name = object.instanceId;
    (root.userData as { sceneInstanceId?: string }).sceneInstanceId =
      object.instanceId;
    applyTransform(root, object);

    const commit = (entry: ReconciledEntry): void => {
      config.parent.add(entry.root);
      entries.set(object.instanceId, entry);
      config.onEntryLoaded?.(entry, entry.root);
    };

    if (!url) {
      root.add(config.createFallback(object));
      commit({
        root,
        object,
        representationKey: object.representationKey,
        loadedWithAsset: false,
        shaderApplication: createRenderableShaderApplicationState(),
        instanced: false,
        host: {}
      });
      return;
    }

    pending.add(object.instanceId);
    void config
      .loadModel(url)
      .then((gltfScene) => {
        pending.delete(object.instanceId);
        if (pending.size === 0) {
          config.onSettled?.();
        }
        // Stale-load guard: the object may have been removed or its
        // representation changed while we loaded.
        const latest = desired.get(object.instanceId) ?? null;
        const superseded =
          generation !== loadGeneration ||
          !latest ||
          latest.representationKey !== object.representationKey;
        if (superseded) {
          disposeRenderableObject(root);
          // If a fresh version is desired, (re)schedule it.
          if (latest && !entries.has(object.instanceId)) {
            scheduleLoad(latest, generation);
          }
          return;
        }
        const shaderApplication = createRenderableShaderApplicationState();
        const ok = hydrate(root, object, gltfScene, shaderApplication);
        commit({
          root,
          object,
          representationKey: object.representationKey,
          loadedWithAsset: ok,
          shaderApplication,
          instanced: false,
          host: {}
        });
      })
      .catch((error) => {
        pending.delete(object.instanceId);
        if (pending.size === 0) {
          config.onSettled?.();
        }
        config.logger?.warn("reconciler-load-failed", {
          instanceId: object.instanceId,
          error
        });
        if (root.children.length === 0) {
          root.add(
            config.createErrorFallback
              ? config.createErrorFallback(object, error)
              : config.createFallback(object)
          );
        }
        commit({
          root,
          object,
          representationKey: object.representationKey,
          loadedWithAsset: false,
          shaderApplication: createRenderableShaderApplicationState(),
          instanced: false,
          host: {}
        });
      });
  }

  function removeSingleton(instanceId: string): void {
    const entry = entries.get(instanceId);
    if (!entry) {
      return;
    }
    config.onEntryWillRemove?.(entry);
    config.parent.remove(entry.root);
    disposeRenderableObject(entry.root);
    entries.delete(instanceId);
  }

  function disposeGroupEntry(groupKey: string): void {
    const entry = groups.get(groupKey);
    if (!entry) {
      return;
    }
    config.onEntryWillRemove?.(entry);
    config.parent.remove(entry.root);
    entry.disposeGroup?.();
    groups.delete(groupKey);
  }

  /** Full (re)build of instanced groups from the desired instanceable set. */
  function reconcileGroups(instanceable: Map<string, SceneObject[]>): void {
    // Publish the latest desired membership so in-flight builds (below) commit
    // the up-to-date batch even if members were added/removed while loading.
    desiredGroupMembers.clear();
    for (const [rk, members] of instanceable) {
      desiredGroupMembers.set(`${GROUP_KEY_PREFIX}${rk}`, members);
    }
    // Drop groups whose membership changed or vanished.
    const desiredKeys = new Set(
      [...instanceable.keys()].map((k) => `${GROUP_KEY_PREFIX}${k}`)
    );
    for (const key of [...groups.keys()]) {
      if (!desiredKeys.has(key)) {
        disposeGroupEntry(key);
      }
    }
    for (const [representationKey, members] of instanceable) {
      const groupKey = `${GROUP_KEY_PREFIX}${representationKey}`;
      const existing = groups.get(groupKey);
      const sameMembers =
        existing &&
        existing.instanceOrder &&
        existing.instanceOrder.length === members.length &&
        members.every((m, i) => existing.instanceOrder![i] === m.instanceId);
      if (sameMembers) {
        // Membership unchanged — patch in place any member whose transform
        // moved (070.6), instead of rebuilding the whole InstancedMesh.
        if (existing!.updateInstance && existing!.memberTransforms) {
          for (let i = 0; i < members.length; i += 1) {
            const next = members[i]!.transform;
            if (!transformsEqual(existing!.memberTransforms[i], next)) {
              existing!.updateInstance(i, next);
              existing!.memberTransforms[i] = next;
              existing!.object = members[i]!;
            }
          }
        }
        continue;
      }
      if (existing) {
        disposeGroupEntry(groupKey);
      }
      // A build is already in flight for this key — don't schedule a second.
      // Its completion reads `desiredGroupMembers`, so it picks up whatever the
      // membership became (this reconcile's `members` included).
      if (pendingGroups.has(groupKey)) {
        continue;
      }
      const representative = members[0]!;
      const url = config.resolveUrl(representative);
      if (!url) {
        continue;
      }
      const loadGeneration = generation;
      const groupParent = config.parent;
      pendingGroups.add(groupKey);
      void config
        .loadModel(url)
        .then((gltfScene) => {
          pendingGroups.delete(groupKey);
          if (generation !== loadGeneration || groups.has(groupKey)) {
            return;
          }
          // Build from the LATEST desired membership, not the (possibly stale)
          // set captured when this load was scheduled. If the group is no
          // longer desired (or fell below the instancing threshold), drop it.
          const latestMembers = desiredGroupMembers.get(groupKey);
          if (!latestMembers || latestMembers.length < 2) {
            return;
          }
          const built: InstancedAssetGroupResult | null =
            buildInstancedAssetGroup({
              group: latestMembers,
              sourceScene: gltfScene,
              shaderRuntime: config.shaderRuntime,
              assetSources: config.getFileSources(),
              enableShadows: undefined
            });
          if (!built) {
            config.logger?.warn("reconciler-instanced-skipped", {
              representationKey,
              count: latestMembers.length
            });
            return;
          }
          if (generation !== loadGeneration || groups.has(groupKey)) {
            built.dispose();
            return;
          }
          groupParent.add(built.root);
          const entry: ReconciledEntry = {
            root: built.root,
            object: built.representative,
            representationKey,
            loadedWithAsset: true,
            shaderApplication: built.shaderApplication,
            instanced: true,
            host: {},
            instanceOrder: built.instanceOrder,
            disposeGroup: () => built.dispose(),
            updateInstance: (index, transform) =>
              built.updateInstance(index, transform),
            memberTransforms: latestMembers.map((m) => m.transform)
          };
          groups.set(groupKey, entry);
          config.onEntryLoaded?.(entry, built.root);
        })
        .catch((error) => {
          pendingGroups.delete(groupKey);
          config.logger?.warn("reconciler-instanced-load-failed", {
            representationKey,
            error
          });
        });
    }
  }

  function reconcile(nextDesired: SceneObject[]): void {
    // Partition into instanceable groups (>=2 members) vs singletons.
    const grouping = config.grouping === true;
    const singletons: SceneObject[] = [];
    const instanceable = new Map<string, SceneObject[]>();
    if (grouping) {
      for (const object of nextDesired) {
        if (config.isInstanceable?.(object)) {
          const list = instanceable.get(object.representationKey);
          if (list) {
            list.push(object);
          } else {
            instanceable.set(object.representationKey, [object]);
          }
        } else {
          singletons.push(object);
        }
      }
      // A representation with a single member is not worth instancing.
      for (const [key, members] of [...instanceable]) {
        if (members.length < 2) {
          instanceable.delete(key);
          singletons.push(...members);
        }
      }
    } else {
      singletons.push(...nextDesired);
    }

    // Singleton delta against the live singleton set.
    const previous = [...entries.values()].map((e) => e.object);
    const delta = computeSceneDelta(previous, singletons);
    desired.clear();
    for (const object of singletons) {
      desired.set(object.instanceId, object);
    }

    for (const id of delta.removed) {
      removeSingleton(id);
    }
    // Added + updated + a completeness sweep (covers entries lost to a
    // representation change and objects whose load is still pending).
    for (const object of singletons) {
      const entry = entries.get(object.instanceId);
      if (!entry) {
        scheduleLoad(object, generation);
        continue;
      }
      if (entry.representationKey !== object.representationKey) {
        removeSingleton(object.instanceId);
        scheduleLoad(object, generation);
        continue;
      }
      // Asset availability flipped (a fallback whose source has since
      // streamed in, or vice versa) -> rebuild. Matches the studio's
      // prior loadedWithAsset/assetSourceAvailable reconciliation.
      const assetAvailable = config.resolveUrl(object) !== null;
      if (entry.loadedWithAsset !== assetAvailable) {
        removeSingleton(object.instanceId);
        scheduleLoad(object, generation);
        continue;
      }
      entry.object = object;
      applyTransform(entry.root, object);
      ensureShaderSetAppliedToRenderable(
        entry.root.children[0] ?? entry.root,
        object,
        config.shaderRuntime,
        entry.shaderApplication,
        config.getFileSources()
      );
    }

    if (grouping) {
      reconcileGroups(instanceable);
    }
  }

  return {
    reconcile,
    get: (instanceId) => entries.get(instanceId),
    remove: (instanceId) => {
      desired.delete(instanceId);
      removeSingleton(instanceId);
    },
    reloadAsset: (assetDefinitionId) => {
      for (const id of [...entries.keys()]) {
        if (entries.get(id)?.object.assetDefinitionId === assetDefinitionId) {
          removeSingleton(id);
        }
      }
      for (const key of [...groups.keys()]) {
        if (groups.get(key)?.object.assetDefinitionId === assetDefinitionId) {
          disposeGroupEntry(key);
        }
      }
      // Next reconcile() re-adds the singletons and rebuilds the groups from
      // the current source (same convergence path as first load).
    },
    entries: function* () {
      yield* entries.values();
      yield* groups.values();
    },
    stats: () => {
      let instances = entries.size;
      for (const group of groups.values()) {
        instances += group.instanceOrder?.length ?? 0;
      }
      return {
        singletons: entries.size,
        groups: groups.size,
        instances,
        drawUnits: entries.size + groups.size
      };
    },
    dispose: () => {
      generation += 1;
      desired.clear();
      pending.clear();
      pendingGroups.clear();
      desiredGroupMembers.clear();
      for (const id of [...entries.keys()]) {
        removeSingleton(id);
      }
      for (const key of [...groups.keys()]) {
        disposeGroupEntry(key);
      }
    }
  };
}
