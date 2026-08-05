/**
 * packages/plugins/src/catalog/sugarlang/tests/teacher/prompt-builder.test.ts
 *
 * Purpose: Verifies deterministic Teacher prompt assembly and formatter outputs.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Exercises ../../runtime/teacher/prompt-builder against hand-crafted TeacherContext fixtures.
 *   - Locks the static comprehension guidance block so prompt drift is reviewable.
 *
 * Implements: Epic 9 Story 9.1
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import {
  TEACHER_COMPREHENSION_GUIDANCE_BLOCK,
  TEACHER_PRAGMATIC_FEEDBACK_BLOCK,
  buildTeacherPrompt,
  estimatePromptTokens,
  formatPendingProvisional
} from "../../runtime/teacher/prompt-builder";
import { createTeacherContext } from "./test-helpers";
import { createLemmaCard } from "../learner/test-helpers";

describe("buildTeacherPrompt", () => {
  it("assembles the expected prompt slices for a fixture context", () => {
    const prompt = buildTeacherPrompt(createTeacherContext());

    expect(prompt.system).toContain("You are the Sugarlang Teacher.");
    expect(prompt.user).toContain("LEARNER STATE:");
    expect(prompt.user).toContain("RELATIONSHIP STATE:");
    expect(prompt.user).toContain("SCENE SNAPSHOT:");
    expect(prompt.user).toContain("RECENT DIALOGUE:");
    expect(prompt.user).toContain("SITUATION:");
    expect(prompt.user).toContain("PENDING PROVISIONAL EVIDENCE:");
    expect(prompt.user).toContain("TURN-SHAPING HINTS:");
    expect(prompt.user).not.toContain("QUEST-ESSENTIAL LEMMAS");
    // 090.4: the budgeter's shortlist is no longer shown to the Teacher. It was
    // not binding after the fence came out, and a block carrying a "budget" and
    // a "rationale" anchors the model whatever the instructions say.
    expect(prompt.user).not.toContain("LEXICAL PRESCRIPTION:");
  });

  it("keeps the prompt within the expected token budget envelope", () => {
    const prompt = buildTeacherPrompt(createTeacherContext());
    const systemTokens = estimatePromptTokens(prompt.system);
    const userTokens = estimatePromptTokens(prompt.user);

    expect(systemTokens).toBeGreaterThan(350);
    expect(systemTokens).toBeLessThan(1800);
    expect(userTokens).toBeGreaterThan(200);
    // The user half carries the competency list, so it grows with authoring.
    // 222.7 grouped that list under lesson names and dropped the can-do
    // descriptors, which were most of its size: a fully authored A1 went from
    // ~3140 tokens to ~1380.
    //
    // It still grows -- nothing filters the list by band -- so this stays a
    // tripwire. The remaining fixes are a band window (deferred to the epic
    // that ships A2, where it can actually exclude something) and moving the
    // list into the cached half (222.9). Raising this number is not one of them.
    expect(userTokens).toBeLessThan(1700);
  });

  it("returns stable cache markers for the static prompt portion", () => {
    const prompt = buildTeacherPrompt(createTeacherContext());
    expect(prompt.cacheMarkers).toEqual([
      "teacher.system.role",
      "teacher.system.rubric",
      "teacher.system.cefr",
      "teacher.system.schema",
      "teacher.system.constraints",
      "teacher.system.comprehension-guidance",
      "teacher.system.pragmatic-feedback",
      "teacher.user.template"
    ]);
  });

  it("includes the comprehension guidance block verbatim in the system prompt", () => {
    const prompt = buildTeacherPrompt(createTeacherContext());
    expect(prompt.system).toContain(TEACHER_COMPREHENSION_GUIDANCE_BLOCK);
  });

  it("formats pending provisional evidence readably", () => {
    const output = formatPendingProvisional(createTeacherContext());

    expect(output).toContain("hola (A1): 1 units, pending for 3 turns");
    expect(output).toContain("billete (A2): 2 units, pending for 7 turns");
    expect(output).toContain("queso (A2): 1 units, pending for 5 turns");
    expect(output).toContain("Total pending: 3 lemmas");
  });

  // 090.4: the probe floors are DERIVED (learner/pacing-signals.ts), so these
  // set the conversation turn count that produces them rather than injecting
  // the state directly. Soft floor needs >= 15 turns AND >= 5 pending; the
  // fixture carries 3 pending, so the soft-floor case supplies its own cards.
  it("surfaces the soft floor recommendation in the user prompt", () => {
    const base = createTeacherContext();
    const prompt = buildTeacherPrompt({
      ...base,
      learner: {
        ...base.learner,
        currentSession: { ...base.learner.currentSession!, turns: 10 },
        lemmaCards: Object.fromEntries(
          ["uno", "dos", "tres", "cuatro", "cinco"].map((lemmaId) => [
            lemmaId,
            createLemmaCard(lemmaId, "A1", {
              provisionalEvidence: 1,
              provisionalEvidenceFirstSeenTurn: 9
            })
          ])
        )
      },
      situation: { ...base.situation!, turnsSinceLastProbe: 20 }
    });

    expect(prompt.user).toContain("SOFT FLOOR - probe recommended");
  });

  it("surfaces the hard floor requirement in the user prompt", () => {
    const base = createTeacherContext();
    const prompt = buildTeacherPrompt({
      ...base,
      situation: { ...base.situation!, turnsSinceLastProbe: 26 }
    });

    expect(prompt.user).toContain(
      "The hard probe floor is active. This turn must trigger a comprehension check."
    );
    expect(prompt.user).toContain("HARD FLOOR - probe REQUIRED this turn");
  });

  it("renders a no-pending message instead of a blank provisional section", () => {
    const base = createTeacherContext();
    const output = formatPendingProvisional({
      ...base,
      learner: { ...base.learner, lemmaCards: {} },
      situation: { ...base.situation!, turnsSinceLastProbe: 1 }
    });

    expect(output).toContain("No pending provisional evidence.");
  });

  it("surfaces first-meeting guidance when there is no prior dialogue", () => {
    const base = createTeacherContext();
    const prompt = buildTeacherPrompt({
      ...base,
      situation: { ...base.situation!, recentTurns: [] }
    });

    expect(prompt.user).toContain("relationship state: probable_first_meeting");
    expect(prompt.user).toContain("A brief greeting or tiny self-introduction is enough.");
  });

  it("085.6: includes the pragmatic feedback block verbatim in the system prompt", () => {
    const prompt = buildTeacherPrompt(createTeacherContext());
    expect(prompt.system).toContain(TEACHER_PRAGMATIC_FEEDBACK_BLOCK);
  });

  it("085.6: pragmatic feedback block prohibits explicit correction", () => {
    expect(TEACHER_PRAGMATIC_FEEDBACK_BLOCK).toContain("NEVER");
    expect(TEACHER_PRAGMATIC_FEEDBACK_BLOCK).toContain("warmth");
    expect(TEACHER_PRAGMATIC_FEEDBACK_BLOCK).toContain("confusion");
  });
});
