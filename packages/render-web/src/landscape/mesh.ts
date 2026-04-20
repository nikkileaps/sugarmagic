/**
 * Web landscape mesh realization.
 *
 * Binds the runtime-core landscape splatmap buffers into Three/WebGPU
 * textures and material nodes. This is the single render-web enforcer for the
 * authored landscape surface seen in both Studio and Preview.
 */

import * as THREE from "three";
import { MeshStandardNodeMaterial } from "three/webgpu";
import { float, max, normalMap, positionWorld, texture, vec2, vec3 } from "three/tsl";
import type {
  ContentLibrarySnapshot,
  MaterialDefinition,
  RegionLandscapeState,
  TextureDefinition
} from "@sugarmagic/domain";
import { MAX_REGION_LANDSCAPE_CHANNELS } from "@sugarmagic/domain";
import { LandscapeSplatmap } from "@sugarmagic/runtime-core";
import type { AuthoredAssetResolver } from "../authoredAssetResolver";

export class RuntimeLandscapeMesh {
  readonly mesh: THREE.Mesh;
  readonly splatmap: LandscapeSplatmap;
  private readonly material: MeshStandardNodeMaterial;
  private readonly geometry: THREE.PlaneGeometry;
  private placeholder: THREE.DataTexture | null = null;
  private readonly channelColors: THREE.Color[] = [];
  private readonly splatTextures: THREE.DataTexture[] = [];

  constructor(
    private readonly size: number,
    private readonly subdivisions: number,
    resolution: number,
    private readonly assetResolver: AuthoredAssetResolver
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

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = "region-landscape-plane";
    this.mesh.position.y = 0.001;
    this.mesh.receiveShadow = true;
    this.mesh.userData.sugarmagicLandscapeSurface = true;
  }

  getResolution(): number {
    return this.splatmap.resolution;
  }

  applyLandscapeState(
    landscape: RegionLandscapeState,
    contentLibrary: ContentLibrarySnapshot | null
  ): void {
    this.mesh.visible = landscape.enabled;
    this.splatmap.load(landscape.paintPayload, landscape.channels.length);

    for (let index = 0; index < MAX_REGION_LANDSCAPE_CHANNELS; index += 1) {
      const channel = landscape.channels[index];
      this.channelColors[index].set(channel?.color ?? 0x000000);
    }

    this.rebuildSplatTextures();
    this.rebuildMaterialNodes(contentLibrary, landscape);
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
  }

  renderMaskToCanvas(channelIndex: number, canvas: HTMLCanvasElement): void {
    this.splatmap.renderChannelMask(channelIndex, canvas);
  }

  serializePaintPayload() {
    return this.splatmap.serialize();
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.splatmap.dispose();
    this.placeholder?.dispose();
    for (const texture of this.splatTextures) {
      texture.dispose();
    }
    // External textures are owned by the shared AuthoredAssetResolver;
    // disposing them here would pull the rug out from under Shader-
    // Runtime's cache for the same TextureDefinition.
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

  private getPlaceholder(): THREE.DataTexture {
    if (!this.placeholder) {
      this.placeholder = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
      this.placeholder.needsUpdate = true;
    }
    return this.placeholder;
  }

  private loadExternalTexture(
    definition: TextureDefinition | null
  ): THREE.Texture | null {
    if (!definition) {
      return null;
    }
    return this.assetResolver.resolveTextureDefinition(definition);
  }

  private materialTextureForChannel(
    material: MaterialDefinition | null,
    parameterId: string,
    contentLibrary: ContentLibrarySnapshot | null
  ): THREE.Texture | null {
    if (!material || !contentLibrary) {
      return null;
    }
    const textureDefinitionId = material.textureBindings[parameterId] ?? null;
    if (!textureDefinitionId) {
      return null;
    }
    const textureDefinition =
      contentLibrary.textureDefinitions.find(
        (definition) => definition.definitionId === textureDefinitionId
      ) ?? null;
    return this.loadExternalTexture(textureDefinition);
  }

  private channelTilingNode(materialDefinition: MaterialDefinition | null) {
    const tilingValue = materialDefinition?.parameterValues.tiling;
    return Array.isArray(tilingValue) && tilingValue.length >= 2
      ? vec2(Number(tilingValue[0]) || 1, Number(tilingValue[1]) || 1)
      : vec2(1, 1);
  }

  private rebuildMaterialNodes(
    contentLibrary: ContentLibrarySnapshot | null,
    landscape: RegionLandscapeState | null = null
  ): void {
    const placeholder = this.getPlaceholder();
    const worldUv = vec2(positionWorld.x, positionWorld.z);
    const normalizedUv = worldUv.div(float(this.size)).add(vec2(0.5, 0.5));
    const textures = this.splatTextures;
    const splat0 = texture(textures[0] ?? placeholder, normalizedUv);
    const splat1 = texture(textures[1] ?? placeholder, normalizedUv);

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

    let blendedColor: ReturnType<typeof vec3> = vec3(0, 0, 0) as ReturnType<typeof vec3>;
    let blendedRoughness: ReturnType<typeof float> = float(0) as ReturnType<typeof float>;
    let blendedMetalness: ReturnType<typeof float> = float(0) as ReturnType<typeof float>;
    let blendedAo: ReturnType<typeof float> = float(0) as ReturnType<typeof float>;
    let blendedNormalSample: ReturnType<typeof vec3> = vec3(0, 0, 0) as ReturnType<
      typeof vec3
    >;

    for (let index = 0; index < this.channelColors.length; index += 1) {
      const color = this.channelColors[index]!;
      const channel = landscape?.channels[index] ?? null;
      const materialDefinition =
        channel?.mode === "material" && channel.materialDefinitionId && contentLibrary
          ? contentLibrary.materialDefinitions.find(
              (definition) => definition.definitionId === channel.materialDefinitionId
            ) ?? null
          : null;
      const tiling = this.channelTilingNode(materialDefinition);
      const tiledUv = vec2(worldUv.x.mul(tiling.x), worldUv.y.mul(tiling.y));
      const weight = weights[index]!;

      const baseTexture = this.materialTextureForChannel(
        materialDefinition,
        "basecolor_texture",
        contentLibrary
      );
      const ormTexture = this.materialTextureForChannel(
        materialDefinition,
        "orm_texture",
        contentLibrary
      );
      const roughnessTexture = this.materialTextureForChannel(
        materialDefinition,
        "roughness_texture",
        contentLibrary
      );
      const metallicTexture = this.materialTextureForChannel(
        materialDefinition,
        "metallic_texture",
        contentLibrary
      );
      const aoTexture = this.materialTextureForChannel(
        materialDefinition,
        "ao_texture",
        contentLibrary
      );
      const normalTexture = this.materialTextureForChannel(
        materialDefinition,
        "normal_texture",
        contentLibrary
      );

      const roughnessScale =
        typeof materialDefinition?.parameterValues.roughness_scale === "number"
          ? materialDefinition.parameterValues.roughness_scale
          : 1;
      const metallicScale =
        typeof materialDefinition?.parameterValues.metallic_scale === "number"
          ? materialDefinition.parameterValues.metallic_scale
          : 0;

      const colorNode = baseTexture
        ? texture(baseTexture, tiledUv).rgb
        : vec3(color.r, color.g, color.b);
      const roughnessNode = roughnessTexture
        ? texture(roughnessTexture, tiledUv).r.mul(float(roughnessScale))
        : ormTexture
        ? texture(ormTexture, tiledUv).g.mul(float(roughnessScale))
        : float(1);
      const metalnessNode = metallicTexture
        ? texture(metallicTexture, tiledUv).r.mul(float(metallicScale))
        : ormTexture
        ? texture(ormTexture, tiledUv).b.mul(float(metallicScale))
        : float(0);
      const aoNode = aoTexture
        ? texture(aoTexture, tiledUv).r
        : ormTexture
        ? texture(ormTexture, tiledUv).r
        : float(1);
      const normalNode = normalTexture
        ? texture(normalTexture, tiledUv).rgb
        : vec3(0.5, 0.5, 1);

      blendedColor = blendedColor.add(colorNode.mul(weight)) as ReturnType<typeof vec3>;
      blendedRoughness = blendedRoughness.add(roughnessNode.mul(weight)) as ReturnType<
        typeof float
      >;
      blendedMetalness = blendedMetalness.add(metalnessNode.mul(weight)) as ReturnType<
        typeof float
      >;
      blendedAo = blendedAo.add(aoNode.mul(weight)) as ReturnType<typeof float>;
      blendedNormalSample = blendedNormalSample.add(normalNode.mul(weight)) as ReturnType<
        typeof vec3
      >;
    }

    this.material.colorNode = blendedColor;
    this.material.roughnessNode = blendedRoughness;
    this.material.metalnessNode = blendedMetalness;
    this.material.aoNode = blendedAo;
    this.material.normalNode = normalMap(blendedNormalSample);
    this.material.needsUpdate = true;
  }
}
