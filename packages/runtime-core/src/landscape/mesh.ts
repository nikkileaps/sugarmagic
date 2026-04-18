import * as THREE from "three";
import { MeshStandardNodeMaterial } from "three/webgpu";
import { float, max, positionWorld, texture, vec2, vec3 } from "three/tsl";
import type { RegionLandscapeState } from "@sugarmagic/domain";
import { MAX_REGION_LANDSCAPE_CHANNELS } from "@sugarmagic/domain";
import { LandscapeSplatmap } from "./splatmap";

export class RuntimeLandscapeMesh {
  readonly mesh: THREE.Mesh;
  readonly splatmap: LandscapeSplatmap;
  private material: MeshStandardNodeMaterial;
  private geometry: THREE.PlaneGeometry;
  private placeholder: THREE.DataTexture | null = null;
  private channelColors: THREE.Color[] = [];

  constructor(
    private size: number,
    private subdivisions: number,
    resolution: number
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

    this.rebuildMaterialNodes();

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = "region-landscape-plane";
    this.mesh.position.y = 0.001;
    this.mesh.receiveShadow = true;
    this.mesh.userData.sugarmagicLandscapeSurface = true;
  }

  getResolution(): number {
    return this.splatmap.resolution;
  }

  applyLandscapeState(landscape: RegionLandscapeState): void {
    this.mesh.visible = landscape.enabled;
    this.splatmap.load(landscape.paintPayload, landscape.channels.length);

    for (let index = 0; index < MAX_REGION_LANDSCAPE_CHANNELS; index += 1) {
      const channel = landscape.channels[index];
      this.channelColors[index].set(channel?.color ?? 0x000000);
    }

    this.rebuildMaterialNodes();
  }

  paintAtWorldPoint(
    channelIndex: number,
    worldX: number,
    worldZ: number,
    brushRadius: number,
    brushStrength: number,
    brushFalloff: number
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
  }

  private getPlaceholder(): THREE.DataTexture {
    if (!this.placeholder) {
      // All-zero placeholder: represents "no channel painted anywhere".
      // With all-zero splat samples the base-channel weight in
      // rebuildMaterialNodes evaluates to 1 (full base), which is the
      // correct default for a freshly-created landscape with no paint
      // data. A white (255,255,255,255) placeholder would instead mean
      // "every paint channel is fully painted everywhere," driving the
      // base weight to zero and blending the (typically undefined, thus
      // black) non-base channel colors on top — that's what was showing
      // up as a pitch-black ground on new regions.
      this.placeholder = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
      this.placeholder.needsUpdate = true;
    }
    return this.placeholder;
  }

  private rebuildMaterialNodes(): void {
    const placeholder = this.getPlaceholder();
    const worldUv = vec2(positionWorld.x, positionWorld.z);
    const normalizedUv = worldUv.div(float(this.size)).add(vec2(0.5, 0.5));
    const textures = this.splatmap.getTextures();
    const splat0 = texture(textures[0] ?? placeholder, normalizedUv);
    const splat1 = texture(textures[1] ?? placeholder, normalizedUv);

    const weights = [
      max(
        float(0),
        float(1).sub(
          splat0.r.add(splat0.g).add(splat0.b).add(splat0.a)
            .add(splat1.r).add(splat1.g).add(splat1.b)
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

    const blended = this.channelColors.reduce<ReturnType<typeof vec3>>(
      (node, color, index) =>
        node.add(
          vec3(color.r, color.g, color.b).mul(weights[index])
        ) as ReturnType<typeof vec3>,
      vec3(0, 0, 0)
    );

    this.material.colorNode = blended;
    this.material.needsUpdate = true;
  }
}
