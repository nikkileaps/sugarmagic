/**
 * packages/plugins/src/catalog/sugarlang/tests/teacher/schema-parser.test.ts
 *
 * Purpose: Verifies strict Teacher'sJSON parsing, repair logic, and hard-rule enforcement.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Exercises ../../runtime/teacher/schema-parser with prescription-safe fixtures.
 *   - Protects the no-invention and hard-floor enforcement rules from silent drift.
 *
 * Implements: Epic 9 Story 9.2
 *
 * Status: active
 */

import { describe, expect, it, vi } from "vitest";
import {
  parseDirective,
  repairDirective
} from "../../runtime/teacher/schema-parser";
import { createDirectiveFixture, createTeacherContext } from "./test-helpers";
import { unavailable } from "../../runtime/situation";
import type { SceneContextModel } from "../../runtime/contracts/scene-context";

/**
 * A context whose situation has no quest-essential concept -- the default
 * fixture's "ticket" concept is mustComprehend, which forces parenthetical/
 * inline glossing (090.4). Tests unrelated to that enforcement use this so
 * they are not coupled to it.
 */
function contextWithNoQuestEssential() {
  const base = createTeacherContext();
  return {
    ...base,
    situation: {
      ...base.situation!,
      sceneContext: unavailable<SceneContextModel>()
    }
  };
}

describe("parseDirective", () => {
  it("parses valid JSON into a directive", () => {
    const json = JSON.stringify(createDirectiveFixture());
    const result = parseDirective(json, {
      context: createTeacherContext()
    });

    expect("directive" in result).toBe(true);
    if ("directive" in result) {
      expect(result.directive.glossingStrategy).toBe("inline");
    }
  });

  it("repairs missing required fields from prescription defaults", () => {
    const context = createTeacherContext();
    const partial = {
      supportPosture: "supported",
      targetLanguageRatio: 0.5
    };

    const repaired = repairDirective(partial, context);

    // 090.4 INVERTED THIS. It used to assert that a directive with no
    // targetVocab was REFILLED from the prescription. That snap-back is what
    // made the prescription the real author of every repaired directive while
    // it looked like the Teacher's own output -- so removing the prompt fence
    // alone would have changed nothing here.
    //
    // An empty list is now an empty list. "The Teacher named nothing usable for
    // this turn" is a legitimate answer and has to be legible as one; refilling
    // it invents a decision nobody made.
    expect(repaired.targetVocab.introduce).toEqual([]);
    expect(repaired.targetVocab.reinforce).toEqual([]);
    expect(repaired.glossingStrategy).toBe("parenthetical");
  });

  it("no longer drops lemmas the prescription did not contain", () => {
    const context = createTeacherContext();
    const repaired = repairDirective(
      {
        targetVocab: {
          introduce: [
            { lemmaId: "invented", lang: "es" },
            { lemmaId: "queso", lang: "es" }
          ],
          reinforce: [],
          avoid: []
        }
      },
      context
    );

    // 090.4: the whole point. `invented` is not in the prescription and it
    // SURVIVES, because prescription membership no longer bounds what the
    // Teacher may name. That fence is exactly why an agent NPC could never be
    // taught a word the compile-time lexical scan had missed.
    //
    // Sanitization still applies -- malformed refs, duplicates and
    // quest-essential lemmas are still filtered -- so this is a narrowing of
    // the filter, not its removal.
    expect(repaired.targetVocab.introduce).toEqual([
      { kind: "vocabulary", lemmaId: "invented", lang: "es" },
      { kind: "vocabulary", lemmaId: "queso", lang: "es" }
    ]);
  });

  it("returns a structured error for malformed JSON", () => {
    const result = parseDirective("{ invalid json", {
      context: createTeacherContext()
    });

    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error.code).toBe("invalid_json");
    }
  });

  it("parses Claude-style fenced JSON and normalizes common schema drift", () => {
    const context = contextWithNoQuestEssential();
    const result = parseDirective(
      `\`\`\`json
{
  "targetVocab": {
    "introduce": [],
    "reinforce": [],
    "avoid": []
  },
  "supportPosture": "anchored",
  "targetLanguageRatio": 0.2,
  "interactionStyle": "listening_first",
  "glossingStrategy": "none",
  "sentenceComplexityCap": "single-clause",
  "comprehensionCheck": {
    "trigger": false,
    "probeStyle": "none",
    "targetLemmas": [],
    "triggerReason": "No pending provisional evidence; hard floor not reached.",
    "characterVoiceReminder": null,
    "acceptableResponseForms": []
  },
  "directiveLifetime": {
    "maxTurns": 1,
    "invalidateOn": ["learner_produces_target", "scene_change"]
  },
  "citedSignals": [
    "session_turns=0",
    "probable_first_meeting=true"
  ],
  "rationale": "Tiny greeting is enough.",
  "confidenceBand": "high",
  "isFallbackDirective": false
}
\`\`\``,
      {
        context
      }
    );

    expect("directive" in result).toBe(true);
    if ("directive" in result) {
      expect(result.directive.glossingStrategy).toBe("none");
      expect(result.directive.comprehensionCheck).toEqual({
        trigger: false,
        probeStyle: "none",
        targetLemmas: []
      });
      expect(result.directive.directiveLifetime).toEqual({
        maxTurns: 1,
        invalidateOn: ["location_change"]
      });
    }
  });

  it("normalizes a null probeStyle to none when comprehensionCheck.trigger is false", () => {
    const context = contextWithNoQuestEssential();
    const result = parseDirective(
      `\`\`\`json
{
  "targetVocab": {
    "introduce": [],
    "reinforce": [],
    "avoid": []
  },
  "supportPosture": "anchored",
  "targetLanguageRatio": 0.2,
  "interactionStyle": "listening_first",
  "glossingStrategy": "none",
  "sentenceComplexityCap": "single-clause",
  "comprehensionCheck": {
    "trigger": false,
    "probeStyle": null,
    "targetLemmas": [],
    "triggerReason": null,
    "characterVoiceReminder": null,
    "acceptableResponseForms": null
  },
  "directiveLifetime": {
    "maxTurns": 1,
    "invalidateOn": ["learner_produces_output", "scene_change"]
  },
  "citedSignals": ["session_turns=0"],
  "rationale": "Tiny greeting is enough.",
  "confidenceBand": "high",
  "isFallbackDirective": false
}
\`\`\``,
      {
        context
      }
    );

    expect("directive" in result).toBe(true);
    if ("directive" in result) {
      expect(result.directive.comprehensionCheck).toEqual({
        trigger: false,
        probeStyle: "none",
        targetLemmas: []
      });
    }
  });

  it("090.11: coerces BARE STRING lemmas into the full teachable shape, kind included", () => {
    // THE BUG THIS PINS. This coercion exists so a Teacher answering
    // `introduce: ["queso"]` is accepted rather than rejected. It produced
    // `{lemmaId, lang}` and omitted `kind` -- but 090.4 made a teachable a
    // discriminated union whose schema requires ["kind", "lemmaId", "lang"]
    // with no default. So the leniency path built precisely the object
    // validation rejects: the parse failed and the Teacher silently fell back
    // to the deterministic policy.
    //
    // Nothing caught it because no test exercised the string form at all.
    const fixture = createDirectiveFixture() as unknown as Record<string, unknown>;
    fixture.targetVocab = { introduce: ["queso"], reinforce: [], avoid: [] };

    const result = parseDirective(JSON.stringify(fixture), {
      context: contextWithNoQuestEssential()
    });

    expect("directive" in result).toBe(true);
    if ("directive" in result) {
      expect(result.directive.targetVocab.introduce[0]).toMatchObject({
        kind: "vocabulary",
        lemmaId: "queso"
      });
    }
  });

  it("090.11: leaves an already-shaped competency entry alone", () => {
    // Coercion must only lift BARE STRINGS. A competency has no bare-string
    // form, so defaulting kind to "vocabulary" cannot swallow one -- but an
    // object that already declares its kind must pass through untouched.
    const fixture = createDirectiveFixture() as unknown as Record<string, unknown>;
    fixture.targetVocab = {
      introduce: [{ kind: "competency", competencyId: "greet", lang: "es" }],
      reinforce: [],
      avoid: []
    };

    const result = parseDirective(JSON.stringify(fixture), {
      context: contextWithNoQuestEssential()
    });

    expect("directive" in result).toBe(true);
    if ("directive" in result) {
      expect(result.directive.targetVocab.introduce[0]).toMatchObject({
        kind: "competency",
        competencyId: "greet"
      });
    }
  });

  it("clamps targetLanguageRatio to the POSTURE's band, not just to [0,1]", () => {
    // 090.4 tightened this. It used to assert 1.5 -> 1.0, i.e. the only bound
    // was the unit interval, so a directive claiming "anchored" could ask for
    // 100% target language and pass. Observed in play at a milder scale: the
    // Teacher answered "anchored" with 0.4 against a table saying 0.3.
    //
    // Repair with no posture defaults to `supported` (0.65), so the band is
    // 0.55-0.75 and 1.5 lands on 0.75.
    const repaired = repairDirective(
      { targetLanguageRatio: 1.5 },
      createTeacherContext()
    );

    expect(repaired.supportPosture).toBe("supported");
    expect(repaired.targetLanguageRatio).toBe(0.75);
  });

  it("falls back to the posture's centre when the ratio is missing", () => {
    const repaired = repairDirective({}, createTeacherContext());

    expect(repaired.targetLanguageRatio).toBe(0.65);
  });

  it("rejects a directive that ignores the hard floor requirement", () => {
    // 090.4: hard floor is derived from turnsSinceLastProbe >= 25.
    const base = createTeacherContext();
    const context = {
      ...base,
      situation: { ...base.situation!, turnsSinceLastProbe: 26 }
    };
    const telemetry = {
      emit: vi.fn()
    };

    const result = parseDirective(JSON.stringify(createDirectiveFixture()), {
      context,
      telemetry
    });

    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error.code).toBe("hard_floor_violated");
    }
    expect(telemetry.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "comprehension.teacher-hard-floor-violated",
        conversationId: "conversation-1"
      })
    );
  });

  it("2026-07-31: ACCEPTS glossingStrategy none even with quest-essential lemmas", () => {
    // THE INVERSION OF THE OLD TEST, and the old one was pinning a bug.
    //
    // This used to assert that "none" was REJECTED when the scene had
    // quest-essential lemmas. But the Teacher prompt offers exactly one value
    // for glossingStrategy -- "none" -- so the rule rejected the only answer the
    // Teacher was ever told it could give. Deterministic parse failure for every
    // quest-essential scene, and because SugarLangTeacher answers a parse
    // failure with the deterministic fallback, four months of those scenes ran
    // on the fallback with nothing surfaced.
    //
    // Hover is the mechanism now, and the hover is also the signal -- it becomes
    // a hovered-introduce observation. The old test passed the whole time,
    // faithfully protecting the thing that was broken.
    const context = createTeacherContext();
    const telemetry = { emit: vi.fn() };

    const result = parseDirective(
      JSON.stringify(createDirectiveFixture({ glossingStrategy: "none" })),
      { context, telemetry }
    );

    expect("directive" in result).toBe(true);
    if ("directive" in result) {
      expect(result.directive.glossingStrategy).toBe("none");
    }
  });
});
