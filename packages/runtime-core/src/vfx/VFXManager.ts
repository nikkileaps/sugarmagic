/**
 * VFXManager.
 *
 * Owns active VFX emitters keyed by runtime host id. It accepts domain
 * definitions and host positions, then exposes immutable snapshots for render
 * targets to realize.
 */

import {
  getVFXDefinition,
  type ContentLibrarySnapshot,
  type VFXVector3
} from "@sugarmagic/domain";
import { VFXEmitter } from "./VFXEmitter";
import type { RuntimeVFXEmitterSnapshot } from "./types";

export class VFXManager {
  private contentLibrary: ContentLibrarySnapshot;
  private readonly emitters = new Map<string, VFXEmitter>();

  constructor(contentLibrary: ContentLibrarySnapshot) {
    this.contentLibrary = contentLibrary;
  }

  setContentLibrary(contentLibrary: ContentLibrarySnapshot): void {
    this.contentLibrary = contentLibrary;
    for (const [emitterId, emitter] of this.emitters.entries()) {
      if (!getVFXDefinition(contentLibrary, emitter.definition.definitionId)) {
        emitter.shutdown();
        this.emitters.delete(emitterId);
      }
    }
  }

  syncHosts(
    hosts: Array<{
      hostId: string;
      definitionId: string;
      position: VFXVector3;
    }>
  ): void {
    const liveHostIds = new Set(hosts.map((host) => host.hostId));
    for (const [emitterId, emitter] of this.emitters.entries()) {
      if (!liveHostIds.has(emitter.hostId)) {
        emitter.shutdown();
        this.emitters.delete(emitterId);
      }
    }

    for (const host of hosts) {
      const definition = getVFXDefinition(this.contentLibrary, host.definitionId);
      if (!definition) {
        continue;
      }
      const emitterId = `${host.definitionId}:${host.hostId}`;
      const existing = this.emitters.get(emitterId);
      if (existing) {
        existing.setBasePosition(host.position);
        continue;
      }
      this.emitters.set(
        emitterId,
        new VFXEmitter({
          emitterId,
          hostId: host.hostId,
          definition,
          position: host.position
        })
      );
    }
  }

  update(deltaSeconds: number): void {
    for (const emitter of this.emitters.values()) {
      emitter.update(deltaSeconds);
    }
  }

  getEmitterCount(): number {
    return this.emitters.size;
  }

  getSnapshots(): RuntimeVFXEmitterSnapshot[] {
    return [...this.emitters.values()].map((emitter) => emitter.snapshot());
  }

  clear(): void {
    for (const emitter of this.emitters.values()) {
      emitter.shutdown();
    }
    this.emitters.clear();
  }
}
