/**
 * Web landscape mesh realization.
 *
 * Binds the canonical landscape splatmap buffers into Three/WebGPU
 * textures and material nodes. This is the single render-web enforcer for the
 * authored landscape surface seen in both Studio and Preview.
 *
 * Per Story 32.12 the landscape no longer owns a hand-rolled PBR TSL
 * implementation. Instead, each Material-bound channel is evaluated
 * through the shared ShaderRuntime.evaluateMeshSurfaceBinding — the
 * same entry point mesh surfaces use — producing a ShaderSurfaceNodeSet
 * per channel. N sets are then blended by splatmap weights into the
 * final landscape material. One rendering math, two projection
 * strategies (mesh-local UV vs. world-projected UV).
 */

import * as THREE from "three";
import { MeshStandardNodeMaterial } from "three/webgpu";
import { float, max, normalMap, positionWorld, texture, vec2, vec3 } from "three/tsl";
import type {
  ContentLibrarySnapshot,
  LandscapeSurfaceSlot,
  RegionLandscapeState
} from "@sugarmagic/domain";
import {
  LandscapeSplatmap,
  MAX_REGION_LANDSCAPE_CHANNELS
} from "@sugarmagic/domain";
import {
  resolveAppearanceLayer,
  resolveSurfaceBinding
} from "@sugarmagic/runtime-core";
import type { AuthoredAssetResolver } from "../authoredAssetResolver";
import type { SurfaceScatterBuildResult } from "../scatter";
import type {
  ShaderRuntime,
  ShaderSurfaceNodeSet
} from "../ShaderRuntime";
import { buildLandscapeScatterForSurface } from "./scatter";

type TslNode = ReturnType<typeof vec3>;
type TslFloat = ReturnType<typeof float>;

function extractLandscapeSlotColor(
  slot: LandscapeSurfaceSlot | null | undefined
): number {
  if (!slot?.surface || slot.surface.kind !== "inline") {
    return 0x000000;
  }
  const baseLayer = slot.surface.surface.layers[0];
  if (!baseLayer || baseLayer.kind !== "appearance") {
    return 0x000000;
  }
  return baseLayer.content.kind === "color" ? baseLayer.content.color : 0x000000;
}

export class RuntimeLandscapeMesh {
  readonly root: THREE.Group;
  readonly mesh: THREE.Mesh;
  readonly scatterRoot: THREE.Group;
  readonly splatmap: LandscapeSplatmap;
  /**
   * The currently-active surface material. Replaced wholesale by
   * `rebuildMaterialNodes` on every binding change (not mutated in
   * place) — Three's WebGPU NodeMaterial doesn't reliably pick up a
   * replaced `colorNode` / `normalNode` / etc. even with
   * `material.needsUpdate = true`, so the only way to guarantee the
   * compiled shader reflects the new bindings is to hand Three a
   * fresh material. Retired materials are disposed after a short grace
   * period instead of immediately on swap because WebGPU render-object
   * teardown can still reference the previous material for a frame.
   */
  private material: MeshStandardNodeMaterial;
  private readonly geometry: THREE.PlaneGeometry;
  private placeholder: THREE.DataTexture | null = null;
  private readonly channelColors: THREE.Color[] = [];
  private readonly splatTextures: THREE.DataTexture[] = [];
  private scatterBuilds: SurfaceScatterBuildResult[] = [];
  private readonly retiredMaterials = new Set<MeshStandardNodeMaterial>();
  private readonly retiredMaterialTimers = new Map<MeshStandardNodeMaterial, ReturnType<typeof setTimeout>>();
  /**
   * Signature of the last-applied material state. Paint strokes
   * mutate splat textures in place and don't change the TSL node
   * structure, so we skip material rebuilds when the signature
   * hasn't changed. This keeps per-stroke cost down to the splat
   * texture upload (which Three handles correctly for DataTextures).
   */
  private lastMaterialSignature: string | null = null;
  /**
   * References of the last-applied landscape state + content library.
   * Used to skip the scatter rebuild path (which is expensive — it
   * disposes and recreates GPU compute pipelines for every scatter
   * layer) when applyLandscapeState is invoked with inputs we've
   * already applied. The texture-update callback in WebRenderEngine
   * calls applyLandscape on every texture load with the same
   * landscape ref, which would otherwise tank frame rate by
   * re-creating compute pipelines per loaded texture.
   */
  private lastAppliedLandscape: RegionLandscapeState | null = null;
  private lastAppliedContentLibrary: ContentLibrarySnapshot | null = null;
  /**
   * A reusable carrier material handed to ShaderRuntime.evaluate-
   * MeshSurfaceBinding as the `carrierMaterial` argument. The runtime
   * needs a material with a `.map` field for the legacy fallback path
   * in sampleMaterialTextureNode; we supply a bare MeshStandardMaterial
   * that has no .map set, so the resolver-returned texture always
   * wins.
   */
  private readonly carrierForEvaluation = new THREE.MeshStandardMaterial();
  private readonly logger = {
    warn(message: string, payload?: Record<string, unknown>) {
      console.warn("[landscape-scatter]", { message, ...(payload ?? {}) });
    }
  };

  constructor(
    private readonly size: number,
    private readonly subdivisions: number,
    resolution: number,
    private readonly assetResolver: AuthoredAssetResolver,
    private readonly getShaderRuntime: () => ShaderRuntime | null
  ) {
    this.geometry = new THREE.PlaneGeometry(size, size, subdivisions, subdivisions);
    this.geometry.rotateX(-Math.PI / 2);

    this.splatmap = new LandscapeSplatmap(resolution);
    this.material = new MeshStandardNodeMaterial({
      roughness: 0.95,
      metalness: 0
    });

    for (let index = 0; index < MAX_REGION_LANDSCAPE_CHANNELS; index += 1) {
      this.channelColors.push(new THREE.Color(0x808080));
    }

    this.rebuildSplatTextures();
    this.rebuildMaterialNodes(null);

    this.root = new THREE.Group();
    this.root.name = "runtime-landscape-mesh-root";
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = "region-landscape-plane";
    this.mesh.position.y = 0.001;
    this.mesh.receiveShadow = true;
    this.mesh.userData.sugarmagicLandscapeSurface = true;
    this.scatterRoot = new THREE.Group();
    this.scatterRoot.name = "region-landscape-scatter-root";
    this.root.add(this.mesh);
    this.root.add(this.scatterRoot);
  }

  getResolution(): number {
    return this.splatmap.resolution;
  }

  applyLandscapeState(
    landscape: RegionLandscapeState,
    contentLibrary: ContentLibrarySnapshot | null
  ): void {
    this.mesh.visible = landscape.enabled;

    // Skip the rebuild chain entirely when applyLandscapeState is
    // called with the SAME landscape + content-library references
    // we last applied. This catches the texture-loaded callback in
    // WebRenderEngine, which fires applyLandscape on every texture
    // load with the same `currentRegion?.landscape` reference. The
    // landscape itself didn't change; only a referenced texture did.
    // Without this guard each texture load triggers a full splat-
    // texture rebuild, material rebuild, and scatter rebuild
    // (including disposing+recreating GPU compute pipelines for
    // every scatter layer), which dominates frame time. Reference
    // equality is the right check because the engine plumbs
    // immutable snapshots — a mutated landscape produces a new ref.
    if (
      landscape === this.lastAppliedLandscape &&
      contentLibrary === this.lastAppliedContentLibrary
    ) {
      return;
    }
    this.lastAppliedLandscape = landscape;
    this.lastAppliedContentLibrary = contentLibrary;

    this.splatmap.load(landscape.paintPayload, landscape.surfaceSlots.length);

    for (let index = 0; index < MAX_REGION_LANDSCAPE_CHANNELS; index += 1) {
      const slot = landscape.surfaceSlots[index];
      const color = extractLandscapeSlotColor(slot);
      this.channelColors[index].set(color);
    }

    this.rebuildSplatTextures();
    this.rebuildMaterialNodes(contentLibrary, landscape);
    this.rebuildScatter(contentLibrary, landscape);
  }

  paintAtWorldPoint(
    channelIndex: number,
    worldX: number,
    worldZ: number,
    brushRadius: number,
    brushStrength: number,
    brushFalloff: number,
    landscape: RegionLandscapeState | null,
    contentLibrary: ContentLibrarySnapshot | null
  ): void {
    const u = worldX / this.size + 0.5;
    const v = worldZ / this.size + 0.5;
    const radiusUV = brushRadius / this.size;

    this.splatmap.paint({
      channelIndex,
      centerU: u,
      centerV: v,
      radiusUV,
      strength: brushStrength,
      falloff: brushFalloff
    });
    this.rebuildSplatTextures();
    this.rebuildMaterialNodes(contentLibrary, landscape);
    this.rebuildScatter(contentLibrary, landscape);
  }

  renderMaskToCanvas(channelIndex: number, canvas: HTMLCanvasElement): void {
    this.splatmap.renderChannelMask(channelIndex, canvas);
  }

  serializePaintPayload() {
    return this.splatmap.serialize();
  }

  dispose(): void {
    this.disposeScatterBuilds();
    this.disposeRetiredMaterials();
    this.geometry.dispose();
    this.material.dispose();
    this.carrierForEvaluation.dispose();
    this.splatmap.dispose();
    this.placeholder?.dispose();
    for (const texture of this.splatTextures) {
      texture.dispose();
    }
    // External textures are owned by the shared AuthoredAssetResolver;
    // disposing them here would pull the rug out from under Shader-
    // Runtime's cache for the same TextureDefinition.
  }

  private retireMaterial(material: MeshStandardNodeMaterial): void {
    if (material === this.material || this.retiredMaterials.has(material)) {
      return;
    }
    this.retiredMaterials.add(material);
    const timer = setTimeout(() => {
      this.retiredMaterialTimers.delete(material);
      this.retiredMaterials.delete(material);
      material.dispose();
    }, 32);
    this.retiredMaterialTimers.set(material, timer);
  }

  private disposeRetiredMaterials(): void {
    for (const timer of this.retiredMaterialTimers.values()) {
      clearTimeout(timer);
    }
    this.retiredMaterialTimers.clear();
    for (const material of this.retiredMaterials) {
      material.dispose();
    }
    this.retiredMaterials.clear();
  }

  private rebuildSplatTextures(): void {
    const buffers = this.splatmap.getBuffers();
    while (this.splatTextures.length < buffers.length) {
      const texture = new THREE.DataTexture(
        new Uint8Array(this.splatmap.resolution * this.splatmap.resolution * 4),
        this.splatmap.resolution,
        this.splatmap.resolution,
        THREE.RGBAFormat
      );
      texture.wrapS = THREE.ClampToEdgeWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.needsUpdate = true;
      this.splatTextures.push(texture);
    }

    for (let index = 0; index < this.splatTextures.length; index += 1) {
      const texture = this.splatTextures[index]!;
      const buffer = buffers[index];
      const textureData = texture.image.data;
      if (!(textureData instanceof Uint8Array)) {
        continue;
      }
      if (!buffer) {
        textureData.fill(0);
      } else {
        textureData.set(buffer);
      }
      texture.needsUpdate = true;
    }
  }

  private disposeScatterBuilds(): void {
    for (const build of this.scatterBuilds) {
      this.scatterRoot.remove(build.root);
      build.dispose();
    }
    this.scatterBuilds = [];
  }

  private rebuildScatter(
    contentLibrary: ContentLibrarySnapshot | null,
    landscape: RegionLandscapeState | null
  ): void {
    this.disposeScatterBuilds();
    if (!contentLibrary || !landscape) {
      return;
    }

    for (let channelIndex = 0; channelIndex < landscape.surfaceSlots.length; channelIndex += 1) {
      const slot = landscape.surfaceSlots[channelIndex];
      if (!slot?.surface) {
        continue;
      }
      const resolvedSurface = resolveSurfaceBinding(
        slot.surface,
        contentLibrary,
        "landscape-only"
      );
      if (!resolvedSurface.ok) {
        continue;
      }
      const builds = buildLandscapeScatterForSurface(
        resolvedSurface.binding,
        landscape,
        channelIndex,
        this.size,
        this.splatmap,
        {
          contentLibrary,
          assetResolver: this.assetResolver,
          shaderRuntime: this.getShaderRuntime(),
          logger: this.logger
        }
      );
      for (const build of builds) {
        this.scatterRoot.add(build.root);
        this.scatterBuilds.push(build);
      }
    }
  }

  private getPlaceholder(): THREE.DataTexture {
    if (!this.placeholder) {
      this.placeholder = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
      this.placeholder.needsUpdate = true;
    }
    return this.placeholder;
  }

  /**
   * Build the per-channel ShaderSurfaceNodeSet:
   *
   *   - Material-bound channel: resolve its EffectiveShaderBinding and
   *     hand it to ShaderRuntime.evaluateMeshSurfaceBinding with the
   *     landscape world-projected UV as uvOverride. The graph's tiling
   *     math multiplies uvOverride by the Material's tiling parameter,
   *     so tiling still honors the authored value — just applied to
   *     world-UV instead of mesh-local UV.
   *   - Color-mode / unbound channel: synthesize a flat set with the
   *     channel's color and neutral PBR defaults (roughness=1,
   *     metalness=0, ao=1, tangent-space-up normal). This is what the
   *     pre-32.12 hand-rolled code did implicitly; encoding it as a
   *     node set keeps the blend loop homogeneous.
   */
  private surfaceNodesForChannel(
    slot: LandscapeSurfaceSlot | null,
    channelColor: THREE.Color,
    worldUv: unknown,
    contentLibrary: ContentLibrarySnapshot | null,
    splatmapWeightNode?: (channelIndex: number) => unknown | null
  ): ShaderSurfaceNodeSet {
    const shaderRuntime = this.getShaderRuntime();
    const binding =
      slot?.surface && contentLibrary
        ? resolveSurfaceBinding(slot.surface, contentLibrary, "landscape-only")
        : null;

    if (shaderRuntime && binding?.ok) {
      const evaluated = shaderRuntime.evaluateLayerStackToNodeSet(binding.binding, {
        geometry: this.geometry,
        carrierMaterial: this.carrierForEvaluation,
        uvOverride: worldUv,
        splatmapWeightNode
      });
      if (evaluated) {
        return this.fillSurfaceNodeDefaults(evaluated, channelColor);
      }
    }

    return this.flatSurfaceNodeSet(channelColor);
  }

  /**
   * Fill in neutral defaults for any PBR channel the graph didn't wire
   * so the downstream weighted blend has a scalar for every slot.
   */
  private fillSurfaceNodeDefaults(
    evaluated: ShaderSurfaceNodeSet,
    channelColor: THREE.Color
  ): ShaderSurfaceNodeSet {
    return {
      colorNode:
        evaluated.colorNode ??
        (vec3(channelColor.r, channelColor.g, channelColor.b) as unknown),
      alphaNode: evaluated.alphaNode,
      normalNode: evaluated.normalNode ?? (vec3(0.5, 0.5, 1) as unknown),
      roughnessNode: evaluated.roughnessNode ?? (float(1) as unknown),
      metalnessNode: evaluated.metalnessNode ?? (float(0) as unknown),
      aoNode: evaluated.aoNode ?? (float(1) as unknown),
      emissiveNode: evaluated.emissiveNode,
      vertexNode: evaluated.vertexNode
    };
  }

  /**
   * No material bound (or ShaderRuntime not available yet): use the
   * channel's authored color and neutral PBR defaults. This mirrors
   * how the pre-32.12 hand-rolled path rendered color-mode channels.
   */
  private flatSurfaceNodeSet(channelColor: THREE.Color): ShaderSurfaceNodeSet {
    return {
      colorNode: vec3(channelColor.r, channelColor.g, channelColor.b) as unknown,
      alphaNode: null,
      normalNode: vec3(0.5, 0.5, 1) as unknown,
      roughnessNode: float(1) as unknown,
      metalnessNode: float(0) as unknown,
      aoNode: float(1) as unknown,
      emissiveNode: null,
      vertexNode: null
    };
  }

  /**
   * Stable string signature of the inputs that actually change the TSL
   * node structure. Splatmap contents (paint) are NOT included — those
   * flow through splat texture data updates, not the TSL graph. Only
   * channel bindings (material id, color, mode) change the graph.
   */
  private computeMaterialSignature(
    landscape: RegionLandscapeState | null,
    contentLibrary: ContentLibrarySnapshot | null
  ): string {
    const parts: string[] = [];
    const channels = landscape?.surfaceSlots ?? [];
    for (let index = 0; index < MAX_REGION_LANDSCAPE_CHANNELS; index += 1) {
      const channel = channels[index] ?? null;
      const color = extractLandscapeSlotColor(channel) || this.channelColors[index]?.getHex() || 0;
      const tilingScale = channel?.tilingScale;
      const tilingPart = tilingScale
        ? `${tilingScale[0]},${tilingScale[1]}`
        : "1,1";
      parts.push(
        `${channel?.surface?.kind ?? "none"}:${JSON.stringify(channel?.surface ?? null)}:${color.toString(16)}:${tilingPart}`
      );
    }
    parts.push(contentLibrary?.identity.id ?? "no-library");
    const shaderRuntime = this.getShaderRuntime();
    parts.push(shaderRuntime ? "runtime" : "no-runtime");
    return parts.join("|");
  }

  private rebuildMaterialNodes(
    contentLibrary: ContentLibrarySnapshot | null,
    landscape: RegionLandscapeState | null = null
  ): void {
    const signature = this.computeMaterialSignature(landscape, contentLibrary);
    if (signature === this.lastMaterialSignature) {
      // Nothing material-relevant changed (e.g. paint stroke only
      // mutated the splatmap). The existing compiled shader continues
      // to sample the updated splat textures correctly via their
      // in-place needsUpdate flag.
      return;
    }
    this.lastMaterialSignature = signature;

    const placeholder = this.getPlaceholder();
    // World-projected UV normalized to [0, 1] across the landscape
    // plane. We pass this as `uvOverride` to the shader graph so the
    // graph's material-texture `uv` input (after tiling math) samples
    // at world-space positions rather than mesh-local UV. This is what
    // makes the same `standard-pbr` graph work for both meshes (where
    // `uv()` is the primary UV attribute) and landscape (where there
    // is no meaningful mesh-local UV).
    const worldXz = vec2(positionWorld.x, positionWorld.z);
    const worldUv = worldXz.div(float(this.size)).add(vec2(0.5, 0.5));
    const textures = this.splatTextures;
    const splat0 = texture(textures[0] ?? placeholder, worldUv);
    const splat1 = texture(textures[1] ?? placeholder, worldUv);

    const weights = [
      max(
        float(0),
        float(1).sub(
          splat0.r.add(splat0.g).add(splat0.b).add(splat0.a).add(splat1.r).add(splat1.g).add(splat1.b)
        )
      ),
      splat0.r,
      splat0.g,
      splat0.b,
      splat0.a,
      splat1.r,
      splat1.g,
      splat1.b
    ];

    let blendedColor: TslNode = vec3(0, 0, 0);
    let blendedNormal: TslNode = vec3(0, 0, 0);
    let blendedRoughness: TslFloat = float(0);
    let blendedMetalness: TslFloat = float(0);
    let blendedAo: TslFloat = float(0);

    for (let index = 0; index < this.channelColors.length; index += 1) {
      const color = this.channelColors[index]!;
      const channel = landscape?.surfaceSlots[index] ?? null;
      const weight = weights[index]!;
      // Per-channel tiling: multiply the landscape world-UV by the
      // channel's tilingScale (when set) BEFORE it enters the Material's
      // shader graph. The graph's own `tiling` parameter then multiplies
      // on top. Effective repeat across the landscape = channel.tilingScale
      // × material.tiling. Channels without an override (or non-material
      // mode) pass the raw worldUv through.
      const tilingScale = channel?.tilingScale ?? null;
      const channelUv = tilingScale
        ? (worldUv as ReturnType<typeof vec2>).mul(
            vec2(tilingScale[0], tilingScale[1])
          )
        : worldUv;
      const nodeSet = this.surfaceNodesForChannel(
        channel,
        color,
        channelUv,
        contentLibrary,
        (channelIndex) => weights[channelIndex] ?? float(0)
      );

      // Each channel contributes weight × its node to the blend. Null
      // fallbacks were filled in by surfaceNodesForChannel so every
      // slot is guaranteed non-null here.
      blendedColor = blendedColor.add(
        (nodeSet.colorNode as TslNode).mul(weight)
      ) as TslNode;
      blendedNormal = blendedNormal.add(
        (nodeSet.normalNode as TslNode).mul(weight)
      ) as TslNode;
      blendedRoughness = blendedRoughness.add(
        (nodeSet.roughnessNode as TslFloat).mul(weight)
      ) as TslFloat;
      blendedMetalness = blendedMetalness.add(
        (nodeSet.metalnessNode as TslFloat).mul(weight)
      ) as TslFloat;
      blendedAo = blendedAo.add(
        (nodeSet.aoNode as TslFloat).mul(weight)
      ) as TslFloat;
    }

    // Fresh material per binding change (see field docs). We swap it
    // onto the mesh and retire the old one after a brief delay. This sidesteps a Three
    // WebGPU NodeMaterial quirk where reassigning `colorNode` etc. on
    // an already-compiled material doesn't reliably cause the
    // compiled shader / bind groups to pick up the new nodes, even
    // with `material.needsUpdate = true`.
    const nextMaterial = new MeshStandardNodeMaterial({
      roughness: 0.95,
      metalness: 0
    });
    nextMaterial.colorNode = blendedColor;
    nextMaterial.roughnessNode = blendedRoughness;
    nextMaterial.metalnessNode = blendedMetalness;
    nextMaterial.aoNode = blendedAo;
    // Wrap the blended tangent-space normal once at the end. Doing the
    // tangent-to-world reconstruction after blending keeps the weighted
    // sum in tangent space, which is the correct space for weighted
    // normal blending (blending in world space produces skewed
    // normals when the blend boundary isn't aligned with a surface
    // that shares tangent frames).
    nextMaterial.normalNode = normalMap(blendedNormal);

    const shaderRuntime = this.getShaderRuntime();
    if (shaderRuntime && contentLibrary) {
      if (landscape?.deform) {
        const deform = resolveAppearanceLayer(landscape.deform, contentLibrary, "mesh-deform");
        if (deform.ok) {
          const deformNodes = shaderRuntime.evaluateMeshDeformBinding(deform.binding, {
            geometry: this.geometry,
            carrierMaterial: nextMaterial
          });
          if (deformNodes?.vertexNode) {
            nextMaterial.positionNode = deformNodes.vertexNode as never;
          }
        }
      }
      if (landscape?.effect) {
        const effect = resolveAppearanceLayer(landscape.effect, contentLibrary, "mesh-effect");
        if (effect.ok) {
          const effectNodes = shaderRuntime.evaluateMeshEffectBinding(effect.binding, {
            geometry: this.geometry,
            carrierMaterial: nextMaterial,
            accumulator: {
              colorNode: blendedColor,
              alphaNode: null,
              normalNode: blendedNormal,
              roughnessNode: blendedRoughness,
              metalnessNode: blendedMetalness,
              aoNode: blendedAo,
              emissiveNode: null,
              vertexNode: null
            }
          });
          if (effectNodes) {
            nextMaterial.colorNode = (effectNodes.colorNode ?? blendedColor) as never;
            nextMaterial.opacityNode = (effectNodes.alphaNode ?? nextMaterial.opacityNode) as never;
            nextMaterial.normalNode = normalMap(
              (effectNodes.normalNode ?? blendedNormal) as never
            ) as never;
            nextMaterial.roughnessNode =
              (effectNodes.roughnessNode ?? blendedRoughness) as never;
            nextMaterial.metalnessNode =
              (effectNodes.metalnessNode ?? blendedMetalness) as never;
            nextMaterial.aoNode = (effectNodes.aoNode ?? blendedAo) as never;
          }
        }
      }
    }

    const previous = this.material;
    this.material = nextMaterial;
    if (this.mesh) {
      this.mesh.material = nextMaterial;
    }
    this.retireMaterial(previous);
  }
}
