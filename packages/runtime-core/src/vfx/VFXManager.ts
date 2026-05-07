/**
 * VFXManager.
 *
 * Owns the active VFX layers across all hosts. Dispatches by definition.kind:
 *   - "particle-emitter" runs a per-frame simulation via VFXEmitter
 *   - "shader-billboard", "ribbon-streamer", "point-light" are static — the
 *     manager tracks position + definition + renderOrder and the renderer
 *     reads from the snapshots each frame
 *
 * Non-particle kinds don't have a simulation step (animation lives entirely
 * in the renderer's TSL nodes / per-frame intensity update for lights).
 */

import {
  getVFXDefinition,
  type ContentLibrarySnapshot,
  type VFXVector3
} from "@sugarmagic/domain";
import { VFXEmitter } from "./VFXEmitter";
import type {
  RuntimeVFXEmitterSnapshot,
  RuntimeVFXHost,
  RuntimeVFXPointLightSnapshot,
  RuntimeVFXRibbonStreamerSnapshot,
  RuntimeVFXShaderBillboardSnapshot,
  RuntimeVFXSnapshot
} from "./types";

interface StaticVFXEntry {
  bindingKey: string;
  hostId: string;
  definitionId: string;
  position: VFXVector3;
  renderOrder: number;
}

export class VFXManager {
  private contentLibrary: ContentLibrarySnapshot;
  private readonly emitters = new Map<string, VFXEmitter>();
  private readonly staticEntries = new Map<string, StaticVFXEntry>();

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
    for (const [bindingKey, entry] of this.staticEntries.entries()) {
      if (!getVFXDefinition(contentLibrary, entry.definitionId)) {
        this.staticEntries.delete(bindingKey);
      }
    }
  }

  syncHosts(hosts: RuntimeVFXHost[]): void {
    const liveBindingKeys = new Set(
      hosts.map((host) => `${host.definitionId}:${host.hostId}`)
    );

    for (const [emitterId, emitter] of this.emitters.entries()) {
      if (!liveBindingKeys.has(emitterId)) {
        emitter.shutdown();
        this.emitters.delete(emitterId);
      }
    }

    for (const [bindingKey] of this.staticEntries) {
      if (!liveBindingKeys.has(bindingKey)) {
        this.staticEntries.delete(bindingKey);
      }
    }

    for (const host of hosts) {
      const definition = getVFXDefinition(this.contentLibrary, host.definitionId);
      if (!definition) {
        continue;
      }
      const bindingKey = `${host.definitionId}:${host.hostId}`;

      if (definition.kind === "particle-emitter") {
        const existing = this.emitters.get(bindingKey);
        if (existing) {
          existing.setBasePosition(host.position);
          existing.renderOrder = host.renderOrder;
          continue;
        }
        this.emitters.set(
          bindingKey,
          new VFXEmitter({
            emitterId: bindingKey,
            hostId: host.hostId,
            definition,
            position: host.position,
            renderOrder: host.renderOrder
          })
        );
        continue;
      }

      // Static (non-simulated) kinds: just track position/order/definition.
      this.staticEntries.set(bindingKey, {
        bindingKey,
        hostId: host.hostId,
        definitionId: host.definitionId,
        position: host.position,
        renderOrder: host.renderOrder
      });
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

  getStaticEntryCount(): number {
    return this.staticEntries.size;
  }

  getSnapshots(): RuntimeVFXSnapshot[] {
    const snapshots: RuntimeVFXSnapshot[] = [];

    for (const emitter of this.emitters.values()) {
      snapshots.push(emitter.snapshot());
    }

    for (const entry of this.staticEntries.values()) {
      const definition = getVFXDefinition(
        this.contentLibrary,
        entry.definitionId
      );
      if (!definition) continue;
      switch (definition.kind) {
        case "shader-billboard": {
          const snapshot: RuntimeVFXShaderBillboardSnapshot = {
            kind: "shader-billboard",
            bindingKey: entry.bindingKey,
            hostId: entry.hostId,
            renderOrder: entry.renderOrder,
            definition,
            position: entry.position
          };
          snapshots.push(snapshot);
          break;
        }
        case "ribbon-streamer": {
          const snapshot: RuntimeVFXRibbonStreamerSnapshot = {
            kind: "ribbon-streamer",
            bindingKey: entry.bindingKey,
            hostId: entry.hostId,
            renderOrder: entry.renderOrder,
            definition,
            position: entry.position
          };
          snapshots.push(snapshot);
          break;
        }
        case "point-light": {
          const snapshot: RuntimeVFXPointLightSnapshot = {
            kind: "point-light",
            bindingKey: entry.bindingKey,
            hostId: entry.hostId,
            renderOrder: entry.renderOrder,
            definition,
            position: entry.position
          };
          snapshots.push(snapshot);
          break;
        }
        case "particle-emitter":
          // Particle-emitter entries live in `emitters`, not `staticEntries`.
          // If we land here it's a sync bug — definition kind must have
          // changed mid-session. Skip silently rather than rendering nothing.
          break;
      }
    }

    return snapshots;
  }

  /**
   * @deprecated Returns only particle-emitter snapshots for backwards
   * compatibility with pre-045.7 callers. New code should use
   * `getSnapshots()` and dispatch by `kind`.
   */
  getEmitterSnapshots(): RuntimeVFXEmitterSnapshot[] {
    return [...this.emitters.values()].map((emitter) => emitter.snapshot());
  }

  clear(): void {
    for (const emitter of this.emitters.values()) {
      emitter.shutdown();
    }
    this.emitters.clear();
    this.staticEntries.clear();
  }
}
