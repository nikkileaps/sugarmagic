/**
 * VFXRendererRegistry.
 *
 * Per-kind dispatch helper for VFX rendering. Owns one peer renderer per
 * VFXDefinitionKind; partitions an incoming RuntimeVFXSnapshot[] by kind and
 * delegates each partition to the right renderer.
 *
 * Adding a future kind = registering a new entry here. There is no
 * exhaustive switch in the call site — the registry is the seam.
 */

import * as THREE from "three";
import type {
  RuntimeVFXEmitterSnapshot,
  RuntimeVFXPointLightSnapshot,
  RuntimeVFXRibbonStreamerSnapshot,
  RuntimeVFXShaderBillboardSnapshot,
  RuntimeVFXSnapshot
} from "@sugarmagic/runtime-core";
import { InstancedParticleRenderer } from "./InstancedParticleRenderer";
import { LightVFXRenderer } from "./LightVFXRenderer";
import { RibbonStreamerRenderer } from "./RibbonStreamerRenderer";
import { ShaderBillboardRenderer } from "./ShaderBillboardRenderer";

export interface VFXKindRenderer<S extends RuntimeVFXSnapshot> {
  sync(snapshots: S[], camera: THREE.Camera | null): void;
  dispose(): void;
}

export class VFXRendererRegistry {
  private readonly particleRenderer: InstancedParticleRenderer;
  private readonly billboardRenderer: ShaderBillboardRenderer;
  private readonly streamerRenderer: RibbonStreamerRenderer;
  private readonly lightRenderer: LightVFXRenderer;

  constructor(scene: THREE.Scene) {
    this.particleRenderer = new InstancedParticleRenderer(scene);
    this.billboardRenderer = new ShaderBillboardRenderer(scene);
    this.streamerRenderer = new RibbonStreamerRenderer(scene);
    this.lightRenderer = new LightVFXRenderer(scene);
  }

  sync(snapshots: RuntimeVFXSnapshot[], camera: THREE.Camera | null): void {
    const particles: RuntimeVFXEmitterSnapshot[] = [];
    const billboards: RuntimeVFXShaderBillboardSnapshot[] = [];
    const streamers: RuntimeVFXRibbonStreamerSnapshot[] = [];
    const lights: RuntimeVFXPointLightSnapshot[] = [];

    for (const snapshot of snapshots) {
      switch (snapshot.kind) {
        case "particle-emitter":
          particles.push(snapshot);
          break;
        case "shader-billboard":
          billboards.push(snapshot);
          break;
        case "ribbon-streamer":
          streamers.push(snapshot);
          break;
        case "point-light":
          lights.push(snapshot);
          break;
      }
    }

    this.particleRenderer.sync(particles, camera);
    this.billboardRenderer.sync(billboards, camera);
    this.streamerRenderer.sync(streamers, camera);
    this.lightRenderer.sync(lights, camera);
  }

  dispose(): void {
    this.particleRenderer.dispose();
    this.billboardRenderer.dispose();
    this.streamerRenderer.dispose();
    this.lightRenderer.dispose();
  }
}
