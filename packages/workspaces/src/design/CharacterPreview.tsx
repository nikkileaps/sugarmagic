/**
 * Character preview viewport.
 *
 * Self-contained Three.js scene used by the Player + NPC inspectors to
 * preview the bound character model with its animation clips. Mirrors
 * the architecture of `apps/studio/src/library/MaterialPreview.tsx`:
 * own renderer, scene, camera, lights, ground disc — no shared
 * `WebRenderEngine` and no shader runtime / post-process state. Plain
 * `MeshStandardMaterial` lighting; a model rendered against neutral
 * studio-style three-point lighting reads in any project palette.
 *
 * The HUD overlay surfaces a slot picker (Static / idle / walk / run —
 * filtered to bound slots) and a play / pause toggle. The slot value
 * and play state are owned by the caller (the inspector view passes
 * them down) so they round-trip through `designPreviewStore` like the
 * old viewport did.
 */

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkinnedObject } from "three/examples/jsm/utils/SkeletonUtils.js";
import { ActionIcon, Box, Group, Select, Stack, Tooltip } from "@mantine/core";
import type {
  CharacterAnimationDefinition,
  CharacterModelDefinition
} from "@sugarmagic/domain";

const gltfLoader = new GLTFLoader();

export interface CharacterPreviewSlot {
  value: string;
  label: string;
  /** Resolved animation definition for this slot, or null if unbound. */
  animation: CharacterAnimationDefinition | null;
}

export interface CharacterPreviewProps {
  /**
   * The character model to render. When null the preview shows just the
   * neutral stage (so the inspector still has visual feedback when no
   * model is bound).
   */
  model: CharacterModelDefinition | null;
  /** Target height in meters. Player or NPC `modelHeight`. */
  targetHeight: number;
  /**
   * One entry per animation slot the inspector exposes (idle / walk /
   * run for the current Player/NPC animation-bindings record). Slots
   * with `animation: null` are surfaced in the dropdown but disabled.
   */
  slots: CharacterPreviewSlot[];
  /** Currently-active slot, or null for "Static". */
  activeSlot: string | null;
  onChangeActiveSlot: (slot: string | null) => void;
  isPlaying: boolean;
  onChangePlaying: (playing: boolean) => void;
  /** path → blob URL map for resolving the .glb sources. */
  assetSources: Record<string, string>;
}

function normalizeModelScale(root: THREE.Object3D, targetHeight: number): void {
  const box = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3();
  box.getSize(size);
  if (size.y <= 0) return;
  root.scale.multiplyScalar(targetHeight / size.y);
  box.setFromObject(root);
  root.position.y -= box.min.y;
}

function disposeObject3D(root: THREE.Object3D): void {
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.geometry.dispose();
      const material = mesh.material;
      if (Array.isArray(material)) {
        for (const m of material) m.dispose();
      } else if (material) {
        material.dispose();
      }
    }
  });
}

export function CharacterPreview({
  model,
  targetHeight,
  slots,
  activeSlot,
  onChangeActiveSlot,
  isPlaying,
  onChangePlaying,
  assetSources
}: CharacterPreviewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const modelRootRef = useRef<THREE.Object3D | null>(null);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const currentActionRef = useRef<THREE.AnimationAction | null>(null);
  const clipCacheRef = useRef<Map<string, THREE.AnimationClip>>(new Map());
  const lastTimeRef = useRef<number>(0);
  const animationIdRef = useRef<number | null>(null);
  // The most recently REQUESTED model + slot. Populated synchronously
  // when props change; the async glTF load checks against these to
  // discard stale results when the user swaps quickly.
  const requestedModelIdRef = useRef<string | null>(null);
  const isPlayingRef = useRef<boolean>(isPlaying);
  isPlayingRef.current = isPlaying;

  // One-time scene + lighting + render-loop setup.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    rendererRef.current = renderer;
    container.appendChild(renderer.domElement);
    renderer.domElement.style.display = "block";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";

    const scene = new THREE.Scene();
    scene.background = null;
    sceneRef.current = scene;

    // Three-point studio rig: warm key + cool fill + soft ambient.
    // Same intent as MaterialPreview but slightly brighter to read
    // skinned-mesh details at full body distance.
    const keyLight = new THREE.DirectionalLight(0xfff1d6, 1.6);
    keyLight.position.set(2.4, 4.0, 2.4);
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xb0c8ff, 0.55);
    fillLight.position.set(-2.6, 1.8, -1.2);
    scene.add(fillLight);

    const ambient = new THREE.AmbientLight(0xffffff, 0.4);
    scene.add(ambient);

    // Neutral stage disc — same posture as the player/npc preview
    // viewports the new component replaces, just smaller and
    // unconditionally rendered (no landscape).
    const stage = new THREE.Mesh(
      new THREE.CircleGeometry(2.2, 48),
      new THREE.MeshStandardMaterial({
        color: 0x313244,
        roughness: 0.9,
        metalness: 0.02
      })
    );
    stage.rotation.x = -Math.PI / 2;
    stage.receiveShadow = true;
    scene.add(stage);

    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    camera.position.set(2.4, 1.6, 3.6);
    camera.lookAt(0, 0.9, 0);
    cameraRef.current = camera;

    const tick = () => {
      animationIdRef.current = requestAnimationFrame(tick);
      const now = performance.now();
      const delta =
        lastTimeRef.current === 0 ? 1 / 60 : (now - lastTimeRef.current) / 1000;
      lastTimeRef.current = now;
      const mixer = mixerRef.current;
      if (mixer) mixer.update(isPlayingRef.current ? delta : 0);
      const r = rendererRef.current;
      const s = sceneRef.current;
      const c = cameraRef.current;
      if (r && s && c) r.render(s, c);
    };
    tick();

    const onResize = () => {
      const r = rendererRef.current;
      const c = cameraRef.current;
      if (!r || !c || !container) return;
      const width = container.clientWidth || 1;
      const height = container.clientHeight || 1;
      r.setSize(width, height, false);
      c.aspect = width / height;
      c.updateProjectionMatrix();
    };
    onResize();
    const observer =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(onResize) : null;
    if (observer) observer.observe(container);

    return () => {
      observer?.disconnect();
      if (animationIdRef.current !== null) {
        cancelAnimationFrame(animationIdRef.current);
      }
      const root = modelRootRef.current;
      if (root) {
        scene.remove(root);
        disposeObject3D(root);
      }
      mixerRef.current?.stopAllAction();
      mixerRef.current = null;
      currentActionRef.current = null;
      clipCacheRef.current.clear();
      stage.geometry.dispose();
      (stage.material as THREE.Material).dispose();
      renderer.dispose();
      if (renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement);
      }
      modelRootRef.current = null;
      rendererRef.current = null;
      sceneRef.current = null;
      cameraRef.current = null;
    };
  }, []);

  // Load (or unload) the bound model whenever it changes.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    // Tear down previous model + mixer + clips. We always rebuild on
    // model swap so the skeleton + bind matrix come from the current
    // glTF — any kept clips would target the old skeleton.
    const previous = modelRootRef.current;
    if (previous) {
      scene.remove(previous);
      disposeObject3D(previous);
      modelRootRef.current = null;
    }
    mixerRef.current?.stopAllAction();
    mixerRef.current = null;
    currentActionRef.current = null;
    clipCacheRef.current.clear();

    if (!model) {
      requestedModelIdRef.current = null;
      return;
    }

    const requestedId = model.definitionId;
    requestedModelIdRef.current = requestedId;
    const sourceUrl = assetSources[model.source.relativeAssetPath];
    if (!sourceUrl) return;

    void gltfLoader.loadAsync(sourceUrl).then((gltf) => {
      // Discard stale loads if the user has selected a different model
      // since the request started.
      if (requestedModelIdRef.current !== requestedId) return;
      const renderable = cloneSkinnedObject(gltf.scene) as THREE.Object3D;
      renderable.updateMatrixWorld(true);
      normalizeModelScale(renderable, targetHeight);
      renderable.traverse((child) => {
        if ((child as THREE.SkinnedMesh).isSkinnedMesh) {
          child.frustumCulled = false;
        }
      });
      scene.add(renderable);
      modelRootRef.current = renderable;
      mixerRef.current = new THREE.AnimationMixer(renderable);
    });
  }, [model, targetHeight, assetSources]);

  // Load the bound animation clips for the currently-loaded model.
  // Re-runs when the slot bindings or the model identity change. We
  // load ALL bound clips up front so slot-swap is a cheap action
  // change rather than a fresh GLB parse.
  useEffect(() => {
    const mixer = mixerRef.current;
    if (!mixer || !model) return;
    const requestedId = requestedModelIdRef.current;
    let cancelled = false;

    Promise.all(
      slots.map(async (slot) => {
        if (!slot.animation) return null;
        const url = assetSources[slot.animation.source.relativeAssetPath];
        if (!url) return null;
        const animGltf = await gltfLoader.loadAsync(url);
        const clip = animGltf.animations[0];
        if (!clip) return null;
        return { slotValue: slot.value, clip };
      })
    ).then((results) => {
      if (cancelled) return;
      // Discard if the model changed during load.
      if (requestedModelIdRef.current !== requestedId) return;
      const cache = new Map<string, THREE.AnimationClip>();
      for (const result of results) {
        if (result) cache.set(result.slotValue, result.clip);
      }
      clipCacheRef.current = cache;
    });

    return () => {
      cancelled = true;
    };
    // model.definitionId triggers re-bind; slot identity is captured by
    // serializing the bound animation ids.
  }, [
    model?.definitionId,
    slots
      .map((s) => `${s.value}:${s.animation?.definitionId ?? ""}`)
      .join("|"),
    assetSources
  ]);

  // Switch the playing action when the active slot changes.
  useEffect(() => {
    const mixer = mixerRef.current;
    if (!mixer) return;
    const previous = currentActionRef.current;
    if (previous) {
      previous.stop();
      currentActionRef.current = null;
    }
    if (!activeSlot) return;
    const clip = clipCacheRef.current.get(activeSlot);
    if (!clip) return;
    const action = mixer.clipAction(clip);
    action.reset();
    action.play();
    currentActionRef.current = action;
  }, [activeSlot, model?.definitionId]);

  const dropdownData = [
    { value: "__static__", label: "Static" },
    ...slots.map((slot) => ({
      value: slot.value,
      label: slot.animation ? slot.label : `${slot.label} (unbound)`,
      disabled: !slot.animation
    }))
  ];

  return (
    <Stack h="100%" gap={0} style={{ position: "relative" }}>
      <Group
        gap="xs"
        wrap="nowrap"
        style={{
          position: "absolute",
          top: 16,
          left: 16,
          zIndex: 10,
          padding: 8,
          borderRadius: 8,
          border: "1px solid var(--sm-panel-border)",
          background: "color-mix(in srgb, var(--sm-viewport-bg) 88%, black 12%)"
        }}
      >
        <Select
          size="xs"
          w={160}
          data={dropdownData}
          value={activeSlot ?? "__static__"}
          onChange={(value) =>
            onChangeActiveSlot(
              value && value !== "__static__" ? value : null
            )
          }
          styles={{
            input: {
              background: "var(--sm-color-base)",
              borderColor: "var(--sm-panel-border)",
              color: "var(--sm-color-text)"
            },
            dropdown: {
              background: "var(--sm-color-surface1)",
              borderColor: "var(--sm-panel-border)"
            }
          }}
        />
        <Tooltip label={isPlaying ? "Pause preview" : "Play preview"}>
          <ActionIcon
            variant="subtle"
            color="blue"
            onClick={() => onChangePlaying(!isPlaying)}
            aria-label={isPlaying ? "Pause preview" : "Play preview"}
          >
            {isPlaying ? "❚❚" : "▶"}
          </ActionIcon>
        </Tooltip>
      </Group>
      <Box
        ref={containerRef}
        style={{
          flex: 1,
          minHeight: 0,
          background: "var(--sm-viewport-bg)",
          overflow: "hidden"
        }}
      />
    </Stack>
  );
}
