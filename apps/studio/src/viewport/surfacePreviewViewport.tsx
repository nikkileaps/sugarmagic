/**
 * Surface preview viewport.
 *
 * Studio-owned Surface Library preview panel. This is not a separate render
 * host; it mounts a RenderView on the shared WebRenderEngine so the preview
 * shares the same GPU device, ShaderRuntime, and authored asset resolver as
 * the rest of Studio.
 */

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { Box, SegmentedControl, Stack, Text } from "@mantine/core";
import type {
  ContentLibrarySnapshot,
  SurfaceDefinition
} from "@sugarmagic/domain";
import { resolveSurfaceBinding } from "@sugarmagic/runtime-core";
import {
  buildSurfaceScatterLayer,
  createRenderView,
  type RenderView,
  type SurfaceScatterBuildResult,
  type WebRenderEngine
} from "@sugarmagic/render-web";
import {
  createSurfacePreviewGeometry,
  type SurfacePreviewGeometryKind
} from "./surface-preview-samplers";

export interface SurfacePreviewViewportProps {
  engine: WebRenderEngine;
  contentLibrary: ContentLibrarySnapshot | null;
  surfaceDefinition: SurfaceDefinition | null;
  previewGeometryKind: SurfacePreviewGeometryKind;
  onChangePreviewGeometryKind: (kind: SurfacePreviewGeometryKind) => void;
}

export function SurfacePreviewViewport({
  engine,
  contentLibrary,
  surfaceDefinition,
  previewGeometryKind,
  onChangePreviewGeometryKind
}: SurfacePreviewViewportProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const renderViewRef = useRef<RenderView | null>(null);
  const previewRootRef = useRef<THREE.Group | null>(null);
  const scatterBuildsRef = useRef<SurfaceScatterBuildResult[]>([]);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const previewMeshRef = useRef<THREE.Mesh | null>(null);
  const previewCarrierMaterialRef = useRef<THREE.Material | null>(null);
  const previewManagedMaterialRef = useRef<THREE.Material | null>(null);

  const scene = useMemo(() => new THREE.Scene(), []);

  function disposeCurrentPreviewMesh() {
    const previewRoot = previewRootRef.current;
    const previewMesh = previewMeshRef.current;
    if (!previewMesh) {
      return;
    }

    if (previewRoot && previewMesh.parent === previewRoot) {
      previewRoot.remove(previewMesh);
    }

    previewMesh.geometry.dispose();
    if (previewManagedMaterialRef.current && renderViewRef.current) {
      renderViewRef.current.shaderRuntime.releaseMaterial(
        previewManagedMaterialRef.current
      );
    }
    previewCarrierMaterialRef.current?.dispose();

    previewMeshRef.current = null;
    previewCarrierMaterialRef.current = null;
    previewManagedMaterialRef.current = null;
  }

  useEffect(() => {
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
    camera.position.set(4.2, 3.2, 4.2);
    camera.lookAt(0, 0.5, 0);
    cameraRef.current = camera;

    const previewRoot = new THREE.Group();
    previewRoot.name = "surface-library-preview-root";
    previewRootRef.current = previewRoot;
    scene.add(previewRoot);

    const renderView = createRenderView({
      engine,
      scene,
      camera,
      compileProfile: "authoring-preview"
    });
    renderViewRef.current = renderView;

    const element = containerRef.current;
    if (element) {
      renderView.mount(element);
      renderView.startRenderLoop();
      const width = element.clientWidth || 1;
      const height = element.clientHeight || 1;
      renderView.resize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }

    const observer =
      element && typeof ResizeObserver !== "undefined"
        ? new ResizeObserver((entries) => {
            const next = entries[0];
            if (!next || !renderViewRef.current || !cameraRef.current) {
              return;
            }
            const width = next.contentRect.width || 1;
            const height = next.contentRect.height || 1;
            renderViewRef.current.resize(width, height);
            cameraRef.current.aspect = width / height;
            cameraRef.current.updateProjectionMatrix();
          })
        : null;
    if (observer && element) {
      observer.observe(element);
    }

    return () => {
      observer?.disconnect();
      for (const build of scatterBuildsRef.current) {
        build.dispose();
      }
      scatterBuildsRef.current = [];
      disposeCurrentPreviewMesh();
      previewRootRef.current?.clear();
      renderView.unmount();
      renderViewRef.current = null;
      previewRootRef.current = null;
      cameraRef.current = null;
    };
  }, [engine, scene]);

  useEffect(() => {
    const renderView = renderViewRef.current;
    const previewRoot = previewRootRef.current;
    const camera = cameraRef.current;
    if (!renderView || !previewRoot || !camera) {
      return;
    }

    for (const build of scatterBuildsRef.current) {
      previewRoot.remove(build.root);
      build.dispose();
    }
    scatterBuildsRef.current = [];
    disposeCurrentPreviewMesh();

    if (!contentLibrary || !surfaceDefinition) {
      return;
    }

    const resolvedSurface = resolveSurfaceBinding(
      { kind: "reference", surfaceDefinitionId: surfaceDefinition.definitionId },
      contentLibrary,
      surfaceDefinition.surface.context
    );
    if (!resolvedSurface.ok) {
      console.error("[surface-preview] failed to resolve surface", {
        surfaceDefinitionId: surfaceDefinition.definitionId,
        diagnostic: resolvedSurface.diagnostic
      });
      return;
    }

    const spec = createSurfacePreviewGeometry(previewGeometryKind);
    const carrierMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 1,
      metalness: 0
    });
    const appliedMaterial = renderView.shaderRuntime.applyShaderSet(
      {
        surface: resolvedSurface.binding,
        deform: null,
        effect: null
      },
      {
        material: carrierMaterial,
        geometry: spec.mesh.geometry,
        fileSources: engine.getAssetSources()
      }
    );
    spec.mesh.material = appliedMaterial;
    spec.mesh.castShadow = true;
    spec.mesh.receiveShadow = true;
    previewRoot.add(spec.mesh);
    previewMeshRef.current = spec.mesh;
    previewCarrierMaterialRef.current = carrierMaterial;
    previewManagedMaterialRef.current = appliedMaterial;

    for (const layer of resolvedSurface.binding.layers) {
      if (layer.kind !== "scatter") {
        continue;
      }
      const build = buildSurfaceScatterLayer(
        layer,
        spec.scatterSamplesForDensity(layer.definition.density),
        {
          contentLibrary,
          assetResolver: renderView.assetResolver,
          shaderRuntime: renderView.shaderRuntime,
          logger: engine.logger
        }
      );
      previewRoot.add(build.root);
      scatterBuildsRef.current.push(build);
    }

    camera.position.set(
      previewGeometryKind === "plane" ? 4.8 : 4.2,
      previewGeometryKind === "plane" ? 3.4 : 3.1,
      4.8
    );
    camera.lookAt(0, previewGeometryKind === "plane" ? 0 : 0.25, 0);
    camera.updateProjectionMatrix();
  }, [contentLibrary, engine, previewGeometryKind, surfaceDefinition]);

  return (
    <Stack h="100%" gap="sm" p="md">
      <SegmentedControl
        fullWidth
        value={previewGeometryKind}
        data={[
          { value: "plane", label: "Plane" },
          { value: "cube", label: "Cube" },
          { value: "sphere", label: "Sphere" }
        ]}
        onChange={(next) =>
          onChangePreviewGeometryKind(next as SurfacePreviewGeometryKind)
        }
      />
      <Box
        style={{
          position: "relative",
          flex: 1,
          minHeight: 320,
          borderRadius: "var(--mantine-radius-md)",
          overflow: "hidden",
          background: "var(--sm-color-base)"
        }}
      >
        <Box
          ref={containerRef}
          style={{ position: "absolute", inset: 0 }}
        />
        {!surfaceDefinition ? (
          <Stack
            align="center"
            justify="center"
            h="100%"
            style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
          >
            <Text size="sm" c="var(--sm-color-overlay0)">
              Select a surface to preview it.
            </Text>
          </Stack>
        ) : null}
      </Box>
    </Stack>
  );
}
