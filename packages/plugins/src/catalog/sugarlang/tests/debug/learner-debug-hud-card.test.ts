/**
 * packages/plugins/src/catalog/sugarlang/tests/debug/learner-debug-hud-card.test.ts
 *
 * Purpose: Pins that a card key becomes a readable name, and that the debug
 *   card degrades rather than throwing when there is nothing to show.
 *
 * Relationships:
 *   - Exercises runtime/inventory/card-display-name.ts against the SHIPPED
 *     inventory, and runtime/learner-debug-hud-card.ts against the fake DOM
 *     the scene-context card test established (the repo runs vitest in node
 *     with no DOM implementation anywhere).
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import {
  cardDisplayName,
  isChunkCardKey
} from "../../runtime/inventory/card-display-name";
import { createLearnerDebugHudCard } from "../../runtime/learner-debug-hud-card";
import { getAllInventoryChunks } from "../../runtime/inventory/competency-inventory-loader";
import type { DebugHudCardContext } from "@sugarmagic/runtime-core";

interface FakeElement {
  tagName: string;
  className: string;
  textContent: string;
  style: Record<string, string>;
  children: FakeElement[];
  ownerDocument: { createElement: (tag: string) => FakeElement };
  append: (...nodes: FakeElement[]) => void;
  appendChild: (node: FakeElement) => void;
  replaceChildren: () => void;
}

function createFakeElement(tagName: string): FakeElement {
  const element: FakeElement = {
    tagName,
    className: "",
    textContent: "",
    style: {},
    children: [],
    ownerDocument: { createElement: createFakeElement },
    append: (...nodes) => element.children.push(...nodes),
    appendChild: (node) => {
      element.children.push(node);
    },
    replaceChildren: () => {
      element.children.length = 0;
      element.textContent = "";
    }
  };
  return element;
}

function readText(element: FakeElement): string {
  return [element.textContent, ...element.children.map(readText)]
    .filter((part) => part.length > 0)
    .join(" ");
}

const EMPTY_TURN = { lastObservation: null, curriculumState: null };
const CONTEXT = {} as unknown as DebugHudCardContext;

function makeCard(getSnapshot: () => Promise<null>) {
  return createLearnerDebugHudCard({
    pluginId: "sugarlang",
    getSnapshot,
    getTurnState: () => EMPTY_TURN,
    getTargetLanguage: () => "es"
  });
}

describe("a card key becomes something a human can read", () => {
  it("THE POINT: a competency card resolves to its display name", () => {
    // `chunk:que_tal` in a debug list is unreadable, and that unreadability is
    // the stated reason competency cards were kept out of the Teacher prompt.
    const chunk = getAllInventoryChunks("es")[0];
    const name = cardDisplayName(`chunk:${chunk.chunkId}`, "es");
    expect(name).not.toContain("chunk:");
    expect(name.length).toBeGreaterThan(0);
  });

  it("leaves a word alone -- it is already readable", () => {
    expect(cardDisplayName("queso", "es")).toBe("queso");
  });

  it("falls back to the key when the chunk is unknown", () => {
    // An inventory edit can remove a chunk while a card for it survives. The
    // key is what you would grep for, so showing it beats showing nothing.
    expect(cardDisplayName("chunk:not_a_real_chunk", "es")).toBe(
      "chunk:not_a_real_chunk"
    );
  });

  it("does not resolve for a language with no inventory", () => {
    expect(cardDisplayName("chunk:que_tal", "it")).toBe("chunk:que_tal");
  });

  it("knows which keys are competencies", () => {
    expect(isChunkCardKey("chunk:que_tal")).toBe(true);
    expect(isChunkCardKey("queso")).toBe(false);
  });
});

describe("the card degrades instead of throwing", () => {
  it("says no learner is bound rather than rendering blank", () => {
    // "No learner yet" and "a learner with nothing in it" look identical if
    // both render empty, and they are debugged differently.
    const host = createFakeElement("div");
    makeCard(async () => null).payload.renderCard(
      host as unknown as HTMLElement,
      CONTEXT
    );
    expect(readText(host)).toContain("no learner bound");
  });

  it("survives a snapshot that rejects", async () => {
    // A debug card must never break the frame it draws in.
    const host = createFakeElement("div");
    const contribution = makeCard(async () => {
      throw new Error("store unavailable");
    });
    expect(() =>
      contribution.payload.renderCard(host as unknown as HTMLElement, CONTEXT)
    ).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    expect(readText(host)).toContain("no learner bound");
  });

  it("is a studio-only contribution", () => {
    // It reads a learner store that only the authoring host has wired.
    expect(makeCard(async () => null).hostKinds).toEqual(["studio"]);
  });

  it("does not draw after disposal", () => {
    // updateCard keeps firing on the HUD tick; drawing into a detached mount
    // is how a debug card leaks a node per frame.
    const host = createFakeElement("div");
    const contribution = makeCard(async () => null);
    contribution.payload.renderCard(host as unknown as HTMLElement, CONTEXT);
    contribution.payload.disposeCard?.();
    host.replaceChildren();
    contribution.payload.updateCard?.(CONTEXT);
    expect(readText(host)).toBe("");
  });
});
