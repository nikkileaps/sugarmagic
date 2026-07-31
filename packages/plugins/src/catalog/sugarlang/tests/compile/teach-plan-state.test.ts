/**
 * packages/plugins/src/catalog/sugarlang/tests/compile/teach-plan-state.test.ts
 *
 * Purpose: Pins the teach plan's project round-trip. Serialize and hydrate are
 *   written in different places and read by different code, so a shape mismatch
 *   between them is silent -- a bake just quietly loses its slate.
 *
 * Implements: Plan 090 story 090.11
 *
 * Status: active
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  TEACH_PLAN_DOCUMENT_VERSION,
  clearSugarlangTeachPlan,
  getSugarlangTeachPlan,
  hydrateTeachPlans,
  serializeTeachPlans
} from "../../runtime/compile/teach-plan-state";

const SLATE = {
  introduce: [{ kind: "vocabulary" as const, lemmaId: "queso", lang: "es" }],
  reinforce: [{ kind: "vocabulary" as const, lemmaId: "hola", lang: "es" }],
  avoid: []
};

function docWithOneScene() {
  return serializeTeachPlans({
    lang: "es",
    scenes: [
      {
        sceneId: "scene-dock",
        contentHash: "hash-1",
        fromSceneContext: true,
        dialogueDefinitionIds: ["dlg-finnick", "dlg-orrin"],
        bands: [
          { band: "A1", slate: SLATE, posture: "anchored" },
          { band: "B1", slate: SLATE, posture: "target-dominant" }
        ]
      }
    ]
  });
}

describe("teach plan project round-trip", () => {
  beforeEach(() => clearSugarlangTeachPlan());

  it("survives serialize -> hydrate with the slate intact", () => {
    const hydrated = hydrateTeachPlans(docWithOneScene());

    // 2 dialogues x 2 bands.
    expect(hydrated).toBe(4);
    expect(getSugarlangTeachPlan("dlg-finnick", "es", "A1")?.slate).toEqual(SLATE);
    expect(getSugarlangTeachPlan("dlg-orrin", "es", "B1")?.posture).toBe(
      "target-dominant"
    );
  });

  it("survives an actual JSON round-trip, not just an object copy", () => {
    // This is what the project file does to it. A Map or an undefined would
    // survive the in-process test above and vanish here.
    const throughJson = JSON.parse(JSON.stringify(docWithOneScene()));

    expect(hydrateTeachPlans(throughJson)).toBe(4);
    expect(getSugarlangTeachPlan("dlg-finnick", "es", "A1")?.slate).toEqual(SLATE);
  });

  it("stores per SCENE, not per dialogue", () => {
    // The Teacher answers per scene. Storing the same answer once per dialogue
    // would bloat the project document for no information gain.
    const doc = docWithOneScene();

    expect(doc.scenes).toHaveLength(1);
    expect(doc.scenes[0]!.bands).toHaveLength(2);
    expect(doc.dialogueScenes).toHaveLength(2);
  });

  it("keeps the scene content hash, so staleness is detectable", () => {
    // A plan derives from a scene's CONCEPTS and goes stale when that scene's
    // content changes. Unlike a baked variant, whose key includes the line
    // text, nothing about a plan would otherwise notice.
    expect(docWithOneScene().scenes[0]!.contentHash).toBe("hash-1");
  });

  it("hydrates NOTHING from a document written by another version", () => {
    // A project written by a different build must not stop Studio from opening,
    // and a bake with no plan is a valid bake.
    const stale = { ...docWithOneScene(), version: "000.0.0" };

    expect(hydrateTeachPlans(stale)).toBe(0);
    expect(getSugarlangTeachPlan("dlg-finnick", "es", "A1")).toBeUndefined();
  });

  it("hydrates NOTHING from junk rather than throwing", () => {
    expect(hydrateTeachPlans(undefined)).toBe(0);
    expect(hydrateTeachPlans(null)).toBe(0);
    expect(hydrateTeachPlans("nonsense")).toBe(0);
    expect(hydrateTeachPlans({ version: TEACH_PLAN_DOCUMENT_VERSION })).toBe(0);
  });

  it("ignores a dialogue pointing at a scene the document does not carry", () => {
    const doc = docWithOneScene();
    doc.dialogueScenes.push({
      dialogueDefinitionId: "dlg-orphan",
      sceneId: "scene-that-left"
    });

    expect(hydrateTeachPlans(doc)).toBe(4);
    expect(getSugarlangTeachPlan("dlg-orphan", "es", "A1")).toBeUndefined();
  });

  it("does not serve one language's plan for another", () => {
    hydrateTeachPlans(docWithOneScene());

    expect(getSugarlangTeachPlan("dlg-finnick", "es", "A1")).toBeDefined();
    expect(getSugarlangTeachPlan("dlg-finnick", "it", "A1")).toBeUndefined();
  });
});
