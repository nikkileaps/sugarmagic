/**
 * packages/plugins/src/catalog/sugarlang/tests/ui/scene-context-hud-card.test.ts
 *
 * Purpose: Pins the Scene Context debug HUD card -- Studio-only gating, and the
 *   three different empty states it must tell apart.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Exercises ../../runtime/scene-context-hud-card against a fake context.
 *
 * Implements: Plan 090 story 090.1
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import { createSceneContextHudCard } from "../../runtime/scene-context-hud-card";
import type { SceneContextModel } from "../../runtime/contracts/scene-context";
import type { DebugHudCardContext } from "@sugarmagic/runtime-core";

/**
 * The repo runs vitest in node with no DOM (no jsdom / happy-dom anywhere), so
 * this is a minimal stand-in covering exactly what the card touches. Cheaper
 * and more honest than pulling in a DOM implementation for one component that
 * builds a dozen elements.
 */
interface FakeElement {
  tagName: string;
  className: string;
  textContent: string;
  title: string;
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
    title: "",
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

/** Flattened text of an element and everything under it. */
function readText(element: FakeElement): string {
  return [element.textContent, ...element.children.map(readText)]
    .filter((part) => part.length > 0)
    .join(" ");
}

/** Every `title` (tooltip) in the tree -- where full provenance now lives. */
function readTitles(element: FakeElement): string {
  return [element.title, ...element.children.map(readTitles)]
    .filter((part) => part.length > 0)
    .join(" ");
}

function makeContext(currentRegionId: string | null): DebugHudCardContext {
  return {
    gameplaySession: { currentRegionId }
  } as unknown as DebugHudCardContext;
}

function makeModel(overrides: Partial<SceneContextModel> = {}): SceneContextModel {
  return {
    regionId: "scene-dock",
    contentHash: "hash",
    promptVersion: "090.1.0",
    supportLanguage: "en",
    prose: "A dock where cargo boats tie up.",
    concepts: [
      {
        label: "cheese",
        pos: "noun",
        provenance: [{ sourceId: "npc:npc-orrin", kind: "npc" }]
      }
    ],
    extractedAtMs: 1,
    extractedByModel: "gateway-resolved",
    reviewFlag: false,
    ...overrides
  };
}

function render(
  getSceneContext: (regionId: string) => SceneContextModel | undefined,
  regionId: string | null = "scene-dock"
): string {
  const card = createSceneContextHudCard({
    pluginId: "sugarlang",
    getSceneContext
  });
  const container = createFakeElement("div");
  card.payload.renderCard(
    container as unknown as HTMLElement,
    makeContext(regionId)
  );
  return readText(container);
}

describe("createSceneContextHudCard", () => {
  it("is Studio-only and never appears in a published build", () => {
    const card = createSceneContextHudCard({
      pluginId: "sugarlang",
      getSceneContext: () => undefined
    });

    expect(card.hostKinds).toEqual(["studio"]);
    expect(card.kind).toBe("debug.hudCard");
  });

  it("puts the part of speech on the same line as the concept", () => {
    const text = render(() => makeModel());

    expect(text).toContain("cheese (noun)");
    expect(text).toContain("A dock where cargo boats tie up.");
  });

  it("shows the source KIND inline and the full source id only on hover", () => {
    // Source ids are UUIDs. Inline they wrapped every row onto three or four
    // lines; the kind is the scannable part, the id is for chasing one concept.
    const card = createSceneContextHudCard({
      pluginId: "sugarlang",
      getSceneContext: () => makeModel()
    });
    const container = createFakeElement("div");
    card.payload.renderCard(
      container as unknown as HTMLElement,
      makeContext("scene-dock")
    );

    expect(readText(container)).toContain("npc");
    expect(readText(container)).not.toContain("npc:npc-orrin");
    expect(readTitles(container)).toContain("npc:npc-orrin");
  });

  it("shows each distinct source kind once for a multi-source concept", () => {
    const card = createSceneContextHudCard({
      pluginId: "sugarlang",
      getSceneContext: () =>
        makeModel({
          concepts: [
            {
              label: "cheese",
              pos: "noun",
              provenance: [
                { sourceId: "npc:a", kind: "npc" },
                { sourceId: "npc:b", kind: "npc" },
                { sourceId: "quest:q1", kind: "quest" }
              ]
            }
          ]
        })
    });
    const container = createFakeElement("div");
    card.payload.renderCard(
      container as unknown as HTMLElement,
      makeContext("scene-dock")
    );

    // Two npc sources, one chip entry -- kinds are deduped.
    expect(readText(container)).toContain("npc quest");
    // ...but every id is still reachable on hover.
    const titles = readTitles(container);
    expect(titles).toContain("npc:a");
    expect(titles).toContain("npc:b");
    expect(titles).toContain("quest:q1");
  });

  it("distinguishes NOT BUILT from built-and-empty", () => {
    // These need different fixes -- press Rebuild vs look at the prompt -- so
    // they must not render the same blank.
    const notBuilt = render(() => undefined);
    const builtEmpty = render(() => makeModel({ concepts: [], prose: "A dock." }));

    expect(notBuilt).toContain("(not built)");
    expect(notBuilt).toContain("Rebuild");
    expect(builtEmpty).toContain("no concepts were found");
    expect(builtEmpty).not.toContain("(not built)");
  });

  it("says a scene edited since the build also reads as not built", () => {
    // The lookup is by content hash, so an edited scene simply misses. Without
    // saying so, "not built" sends you to press a button you already pressed.
    expect(render(() => undefined)).toContain("edited since the last build");
  });

  it("handles no scene loaded", () => {
    expect(render(() => makeModel(), null)).toContain("(none loaded)");
  });

  it("surfaces the review flag", () => {
    expect(render(() => makeModel({ reviewFlag: true }))).toContain("flagged");
  });

  it("marks must-comprehend concepts", () => {
    const text = render(() =>
      makeModel({
        concepts: [
          {
            label: "cargo",
            pos: "noun",
            provenance: [{ sourceId: "quest:q1", kind: "quest" }],
            mustComprehend: true
          }
        ]
      })
    );

    expect(text).toContain("cargo");
    expect(text).toContain("*");
  });

  it("re-renders only when the loaded scene changes", () => {
    const seen: string[] = [];
    const card = createSceneContextHudCard({
      pluginId: "sugarlang",
      getSceneContext: (regionId) => {
        seen.push(regionId);
        return makeModel({ regionId });
      }
    });
    const container = createFakeElement("div");

    card.payload.renderCard(
      container as unknown as HTMLElement,
      makeContext("scene-a")
    );
    card.payload.updateCard?.(makeContext("scene-a"));
    card.payload.updateCard?.(makeContext("scene-a"));
    card.payload.updateCard?.(makeContext("scene-b"));

    // The model is immutable per scene; ticking would be wasted work.
    expect(seen).toEqual(["scene-a", "scene-b"]);
  });
});
