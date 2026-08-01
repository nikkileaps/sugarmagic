/**
 * packages/plugins/src/catalog/sugarlang/runtime/scene-context-hud-card.ts
 *
 * Purpose: Author-facing readout of the scene context the runtime was SEEDED
 *   with -- what the game believes the current scene is about.
 *
 * WHAT THIS SHOWS, AND WHY IT IS THE "LOADED" HALF
 *   A SceneContextModel is the cached, scene-scoped half of a SITUATION: built
 *   in Studio, shipped in the boot payload, unchanging for the whole session.
 *   The other half -- who is ACTUALLY present, met/unmet, quest stage, time of
 *   day -- is overlaid live (Plan 090.3) and is deliberately NOT shown here.
 *   Seeing them separately is the point: a model listing an NPC who is not
 *   standing in front of you is exactly the bug this makes visible.
 *
 * WHY EMPTY IS THREE DIFFERENT THINGS
 *   "No concepts" can mean the scene was never built, was built before an edit
 *   so its content hash no longer matches, or was built and genuinely yielded
 *   nothing. Those need different fixes -- press Rebuild, press Rebuild, or look
 *   at the prompt -- so the card distinguishes them rather than rendering a
 *   uniform blank.
 *
 * `hostKinds: ["studio"]` -- Studio preview only, never a published build.
 *
 * Exports:
 *   - createSceneContextHudCard
 *
 * Relationships:
 *   - Reads the seeded model via the runtime services accessor. Contributes a
 *     `debug.hudCard`, the existing plugin surface, and reuses the HUD's own
 *     `sm-debug-hud__*` styles so it introduces no CSS.
 *
 * Implements: Plan 090 story 090.1
 *
 * Status: active
 */

import type {
  DebugHudCardContext,
  DebugHudCardContribution
} from "@sugarmagic/runtime-core";
import type { SceneContextModel } from "./contracts/scene-context";

const CARD_ID = "sugarlang.scene-context";

export interface CreateSceneContextHudCardArgs {
  pluginId: string;
  /** Reads the seeded model for a scene, or undefined when none was shipped. */
  getSceneContext: (sceneId: string) => SceneContextModel | undefined;
}

function appendMetric(
  container: HTMLElement,
  label: string,
  value: string
): void {
  const documentRef = container.ownerDocument ?? document;
  const row = documentRef.createElement("div");
  row.className = "sm-debug-hud__metric";
  const labelElement = documentRef.createElement("span");
  labelElement.textContent = label;
  const valueElement = documentRef.createElement("span");
  valueElement.textContent = value;
  row.append(labelElement, valueElement);
  container.appendChild(row);
}

/** Distinct source kinds for a concept, in stable order: `npc`, `lore`, ... */
function conceptSourceKinds(concept: SceneContextModel["concepts"][number]): string[] {
  return [...new Set(concept.provenance.map((entry) => entry.kind))].sort();
}

/**
 * One line per concept: `label (pos)` on the left, source kinds as a chip on the
 * right, full source ids on hover.
 *
 * The ids are UUIDs -- `lore:lore.entities.npcs.finnick_thorn`,
 * `dialogue:42670c12-cecb-...` -- so showing them inline wrapped every row onto
 * three or four lines and made a dozen concepts unreadable. The KIND is the part
 * that is scannable ("where did this come from -- an NPC? a quest?"); the exact
 * id matters only when you are chasing one specific concept, which is what the
 * tooltip is for.
 */
function renderConceptList(
  documentRef: Document,
  model: SceneContextModel
): HTMLElement {
  const list = documentRef.createElement("div");
  list.className = "sm-debug-hud__world-card";
  // Scene concepts routinely run past a dozen; without a cap the card grows
  // past the viewport and the rows below it become unreachable.
  list.style.maxHeight = "220px";
  list.style.overflowY = "auto";
  list.style.gap = "2px";

  for (const concept of model.concepts) {
    const row = documentRef.createElement("div");
    row.className = "sm-debug-hud__metric";

    const label = documentRef.createElement("span");
    label.textContent = `${concept.label}${concept.pos ? ` (${concept.pos})` : ""}${
      concept.mustComprehend ? " *" : ""
    }`;
    label.style.whiteSpace = "nowrap";
    label.style.overflow = "hidden";
    label.style.textOverflow = "ellipsis";

    const chip = documentRef.createElement("span");
    chip.textContent = conceptSourceKinds(concept).join(" ");
    // Full provenance on hover -- the detail is available without costing every
    // row three lines of UUID.
    chip.title = concept.provenance.map((entry) => entry.sourceId).join("\n");
    chip.style.whiteSpace = "nowrap";
    chip.style.flexShrink = "0";
    chip.style.fontSize = "0.85em";
    chip.style.opacity = "0.75";
    chip.style.cursor = "help";

    row.append(label, chip);
    list.appendChild(row);
  }

  return list;
}

function renderInto(
  container: HTMLElement,
  context: DebugHudCardContext,
  getSceneContext: (sceneId: string) => SceneContextModel | undefined
): void {
  const documentRef = container.ownerDocument ?? document;
  container.replaceChildren();

  const card = documentRef.createElement("div");
  card.className = "sm-debug-hud__world-card";

  const sceneId = context.gameplaySession.currentRegionId;
  if (!sceneId) {
    appendMetric(card, "Scene", "(none loaded)");
    container.appendChild(card);
    return;
  }

  appendMetric(card, "Scene", sceneId);

  const model = getSceneContext(sceneId);
  if (!model) {
    appendMetric(card, "Context", "(not built)");
    const hint = documentRef.createElement("div");
    hint.className = "sm-debug-hud__metric";
    // Naming the fix beats naming the state: "not built" is also what an
    // edited-since-Rebuild scene looks like, because the lookup is by content
    // hash and a changed scene simply misses.
    hint.textContent =
      "Press Rebuild in Studio, then restart preview. A scene edited since the last build also reads as not built.";
    hint.style.opacity = "0.7";
    card.appendChild(hint);
    container.appendChild(card);
    return;
  }

  appendMetric(card, "Concepts", String(model.concepts.length));
  appendMetric(card, "Built with", model.promptVersion);
  if (model.reviewFlag) {
    appendMetric(card, "Review", "flagged");
  }

  const prose = documentRef.createElement("div");
  prose.className = "sm-debug-hud__metric";
  prose.textContent = model.prose || "(no description)";
  prose.style.opacity = "0.85";
  card.appendChild(prose);

  if (model.concepts.length === 0) {
    const empty = documentRef.createElement("div");
    empty.className = "sm-debug-hud__metric";
    // Built, but yielded nothing -- a prompt or content problem, NOT a missing
    // build. Different fix, so it says something different.
    empty.textContent = "Built, but no concepts were found in this scene.";
    empty.style.opacity = "0.7";
    card.appendChild(empty);
  }

  if (model.concepts.length > 0) {
    card.appendChild(renderConceptList(documentRef, model));
  }

  container.appendChild(card);
}

/**
 * The card re-renders wholesale on each tick rather than diffing rows: the
 * model is immutable per scene, so the only thing that changes is WHICH scene
 * is loaded, and a full rebuild of a dozen rows is cheaper than tracking them.
 */
export function createSceneContextHudCard(
  args: CreateSceneContextHudCardArgs
): DebugHudCardContribution {
  // `updateCard` gets only a context, so the container is captured here at
  // render time -- the same closure trick the session card uses for its rows.
  let mount: HTMLElement | null = null;
  let lastRenderedSceneId: string | null = null;

  return {
    pluginId: args.pluginId,
    contributionId: "sugarlang.debug.scene-context-card",
    kind: "debug.hudCard",
    displayName: "Scene Context",
    priority: 40,
    hostKinds: ["studio"],
    payload: {
      cardId: CARD_ID,
      renderCard(container: HTMLElement, context: DebugHudCardContext) {
        mount = container;
        lastRenderedSceneId = context.gameplaySession.currentRegionId;
        renderInto(container, context, args.getSceneContext);
      },
      updateCard(context: DebugHudCardContext) {
        // Only the loaded scene can change; the model itself is immutable for
        // the session. Re-rendering on every tick would be wasted work.
        const sceneId = context.gameplaySession.currentRegionId;
        if (!mount || sceneId === lastRenderedSceneId) {
          return;
        }
        lastRenderedSceneId = sceneId;
        renderInto(mount, context, args.getSceneContext);
      },
      disposeCard() {
        mount = null;
      }
    }
  };
}
