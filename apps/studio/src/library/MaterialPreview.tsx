/**
 * Material preview viewport.
 *
 * Renders a single material on a primitive (cube / plane / sphere)
 * with default sugarengine lighting. Pure THREE.MeshStandardMaterial
 * using the material's PBR fields directly — bypasses the shader
 * runtime so library browsing is fast and library-side. Library
 * popover use only.
 */

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { Box, SegmentedControl, Stack } from "@mantine/core";
import type {
  MaterialDefinition,
  TextureDefinition
} from "@sugarmagic/domain";
import type { AuthoredAssetResolver } from "@sugarmagic/render-web";
import {
  applyMaterialToPreviewShader,
  createMaterialPreviewShader
} from "./materialPreviewShader";

export type MaterialPreviewGeometryKind = "cube" | "plane" | "sphere";

export interface MaterialPreviewProps {
  material: MaterialDefinition | null;
  geometryKind: MaterialPreviewGeometryKind;
  onChangeGeometryKind: (kind: MaterialPreviewGeometryKind) => void;
  /** For resolving texture-map references from material.pbr.*Map fields. */
  textureDefinitions: TextureDefinition[];
  assetResolver: AuthoredAssetResolver | null;
}

function createPrimitiveGeometry(
  kind: MaterialPreviewGeometryKind
): THREE.BufferGeometry {
  if (kind === "plane") {
    const geometry = new THREE.PlaneGeometry(1.0, 1.0);
    geometry.rotateX(-Math.PI / 2);
    return geometry;
  }
  if (kind === "sphere") {
    return new THREE.SphereGeometry(0.55, 48, 32);
  }
  return new THREE.BoxGeometry(0.8, 0.8, 0.8);
}

export function MaterialPreview({
  material,
  geometryKind,
  onChangeGeometryKind,
  textureDefinitions,
  assetResolver
}: MaterialPreviewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const meshRef = useRef<THREE.Mesh | null>(null);
  const materialRef = useRef<THREE.MeshStandardMaterial | null>(null);
  const animationIdRef = useRef<number | null>(null);

  // One-time scene setup. WebGL (not WebGPU) — preview doesn't need
  // the heavyweight WebGPU pipeline; a plain MeshStandardMaterial
  // shows PBR fields just fine.
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

    // Default sugarengine-style lighting: warm key + cool fill +
    // gentle ambient. Matches the "default lighting" the user asked
    // for (a neutral readable light, not a stylized rig).
    const keyLight = new THREE.DirectionalLight(0xfff1d6, 1.4);
    keyLight.position.set(2.2, 3.5, 2.0);
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xb0c8ff, 0.45);
    fillLight.position.set(-2.5, 1.5, -1.0);
    scene.add(fillLight);

    const ambient = new THREE.AmbientLight(0xffffff, 0.35);
    scene.add(ambient);

    // FOV chosen wider than typical (45) so the cube fits comfortably
    // even when the preview area is portrait-oriented (tall and
    // narrow), since horizontal FOV = 2*atan(tan(fov/2)*aspect) and
    // a tall aspect contracts horizontal FOV. Camera distance kept
    // back enough that all three primitives (cube/plane/sphere) frame
    // similarly without per-shape camera offsets.
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(2.6, 2.0, 2.6);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    // Single shared preview shader for the whole library — see
    // ./materialPreviewShader.ts. Mutated in place when the
    // selected material changes; never re-allocated per material.
    const previewShader = createMaterialPreviewShader();
    materialRef.current = previewShader;

    const tick = () => {
      animationIdRef.current = requestAnimationFrame(tick);
      const mesh = meshRef.current;
      if (mesh) {
        // Slow auto-rotate so material reads at multiple angles.
        mesh.rotation.y += 0.008;
      }
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
      if (animationIdRef.current !== null) cancelAnimationFrame(animationIdRef.current);
      const mesh = meshRef.current;
      if (mesh) {
        scene.remove(mesh);
        mesh.geometry.dispose();
      }
      materialRef.current?.dispose();
      renderer.dispose();
      if (renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement);
      }
      meshRef.current = null;
      materialRef.current = null;
      rendererRef.current = null;
      sceneRef.current = null;
      cameraRef.current = null;
    };
  }, []);

  // Swap geometry whenever geometryKind changes.
  useEffect(() => {
    const scene = sceneRef.current;
    const material = materialRef.current;
    if (!scene || !material) return;
    const previous = meshRef.current;
    if (previous) {
      scene.remove(previous);
      previous.geometry.dispose();
    }
    const geometry = createPrimitiveGeometry(geometryKind);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = geometryKind === "plane" ? -0.1 : 0;
    scene.add(mesh);
    meshRef.current = mesh;
  }, [geometryKind]);

  // Apply selected material's PBR fields + texture maps to the
  // shared preview shader. Re-runs when the resolver's texture-def
  // list changes (after a fresh import) so newly-imported textures
  // bind without needing to re-select the material.
  useEffect(() => {
    const previewShader = materialRef.current;
    if (!previewShader) return;
    applyMaterialToPreviewShader(previewShader, material, {
      textureDefinitions,
      assetResolver
    });
  }, [material, textureDefinitions, assetResolver]);

  const segmentedData = useMemo(
    () => [
      { value: "cube", label: "Cube" },
      { value: "plane", label: "Plane" },
      { value: "sphere", label: "Sphere" }
    ],
    []
  );

  return (
    <Stack h="100%" gap="sm">
      <SegmentedControl
        size="xs"
        value={geometryKind}
        data={segmentedData}
        onChange={(value) => onChangeGeometryKind(value as MaterialPreviewGeometryKind)}
      />
      <Box
        ref={containerRef}
        style={{
          flex: 1,
          minHeight: 280,
          borderRadius: "var(--mantine-radius-md)",
          background: "var(--sm-color-base)",
          overflow: "hidden",
          position: "relative"
        }}
      />
    </Stack>
  );
}
