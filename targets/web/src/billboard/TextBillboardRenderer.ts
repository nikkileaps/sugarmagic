/**
 * targets/web/src/billboard/TextBillboardRenderer.ts
 *
 * Purpose: Renders text billboards as pooled DOM overlays projected from world space.
 *
 * Exports:
 *   - TextBillboardRenderer
 *
 * Relationships:
 *   - Reads billboard semantics from runtime-core.
 *   - Lives entirely in the web target because it owns DOM presentation.
 *
 * Status: active
 */

import * as THREE from "three";
import { BillboardComponent, Position, type World } from "@sugarmagic/runtime-core";

interface TextBillboardRendererOptions {
  parent: HTMLElement;
}

interface TextBillboardEntry {
  element: HTMLDivElement;
  entity: number;
}

const DEFAULT_STYLE = {
  fontSize: 12,
  color: "#eef6ff",
  backgroundColor: "rgba(17, 17, 27, 0.78)",
  padding: "4px 8px",
  maxWidth: 240
} as const;

export class TextBillboardRenderer {
  private readonly parent: HTMLElement;
  private readonly container: HTMLDivElement;
  private readonly entries = new Map<number, TextBillboardEntry>();
  private readonly freeList: HTMLDivElement[] = [];
  private readonly viewProjectionMatrix = new THREE.Matrix4();
  private readonly worldPosition = new THREE.Vector4();

  constructor(options: TextBillboardRendererOptions) {
    this.parent = options.parent;
    this.container = document.createElement("div");
    this.container.className = "sm-runtime-text-billboards";
    Object.assign(this.container.style, {
      position: "absolute",
      inset: "0",
      pointerEvents: "none",
      overflow: "hidden",
      zIndex: "16"
    });
    this.parent.appendChild(this.container);
  }

  update(input: {
    world: World;
    camera: THREE.Camera;
    viewportWidth: number;
    viewportHeight: number;
  }): void {
    this.viewProjectionMatrix.multiplyMatrices(
      input.camera.projectionMatrix,
      input.camera.matrixWorldInverse
    );
    const activeEntities = new Set<number>();

    for (const entity of input.world.query(Position, BillboardComponent)) {
      const position = input.world.getComponent(entity, Position);
      const billboard = input.world.getComponent(entity, BillboardComponent);
      if (!position || !billboard || billboard.descriptor.kind !== "text") {
        continue;
      }
      if (!billboard.visible || billboard.lodState !== "billboard") {
        continue;
      }

      activeEntities.add(entity);
      const entry = this.getOrCreateEntry(entity);
      const descriptor = billboard.descriptor;
      const style = {
        ...DEFAULT_STYLE,
        ...(descriptor.style ?? {})
      };

      this.worldPosition.set(
        position.x + billboard.offset.x,
        position.y + billboard.offset.y,
        position.z + billboard.offset.z,
        1
      ).applyMatrix4(this.viewProjectionMatrix);

      if (this.worldPosition.w <= 0) {
        entry.element.style.display = "none";
        continue;
      }

      const ndcX = this.worldPosition.x / this.worldPosition.w;
      const ndcY = this.worldPosition.y / this.worldPosition.w;
      const ndcZ = this.worldPosition.z / this.worldPosition.w;

      const screenX = ((ndcX + 1) * 0.5) * input.viewportWidth;
      const screenY = ((1 - ndcY) * 0.5) * input.viewportHeight;

      entry.element.textContent = descriptor.content;
      entry.element.style.display = "block";
      entry.element.style.transform = `translate(-50%, -100%) translate(${screenX.toFixed(2)}px, ${screenY.toFixed(2)}px)`;
      entry.element.style.fontSize = `${style.fontSize}px`;
      entry.element.style.color = style.color;
      entry.element.style.background = style.backgroundColor;
      entry.element.style.padding = style.padding;
      entry.element.style.maxWidth = `${style.maxWidth}px`;
      entry.element.style.zIndex = `${Math.round((1 - ndcZ) * 10000)}`;
      entry.element.dataset.displayMode = billboard.displayMode;
    }

    for (const [entity, entry] of this.entries) {
      if (activeEntities.has(entity)) {
        continue;
      }
      this.releaseEntry(entity, entry);
    }
  }

  dispose(): void {
    for (const entry of this.entries.values()) {
      if (entry.element.parentElement === this.container) {
        this.container.removeChild(entry.element);
      }
    }
    this.entries.clear();
    this.freeList.length = 0;
    if (this.container.parentElement === this.parent) {
      this.parent.removeChild(this.container);
    }
  }

  private getOrCreateEntry(entity: number): TextBillboardEntry {
    const existing = this.entries.get(entity);
    if (existing) {
      return existing;
    }

    const element = this.freeList.pop() ?? document.createElement("div");
    element.className = "sm-runtime-text-billboard";
    Object.assign(element.style, {
      position: "absolute",
      left: "0",
      top: "0",
      borderRadius: "999px",
      fontFamily: "\"IBM Plex Mono\", monospace",
      fontWeight: "500",
      lineHeight: "1.3",
      whiteSpace: "nowrap",
      boxShadow: "0 10px 24px rgba(0, 0, 0, 0.22)"
    });
    this.container.appendChild(element);

    const entry: TextBillboardEntry = { element, entity };
    this.entries.set(entity, entry);
    return entry;
  }

  private releaseEntry(entity: number, entry: TextBillboardEntry) {
    entry.element.style.display = "none";
    this.entries.delete(entity);
    this.freeList.push(entry.element);
  }
}
