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

    // The system half now carries the curriculum too (222.9) -- ~1600 of
    // instructions plus ~900 of competency list. Both blocks are cacheable, so
    // this half is paid for once per language rather than every turn.
    expect(systemTokens).toBeGreaterThan(350);
    expect(systemTokens).toBeLessThan(2800);
    expect(userTokens).toBeGreaterThan(200);
    // The per-turn half is now ONLY what changes per turn: learner state,
    // scene, NPC, dialogue. It was 3138 tokens before 222.7 grouped the
    // competency list and 222.9 moved it into the cached half.
    expect(userTokens).toBeLessThan(700);
  });

  it("returns stable cache markers for the static prompt portion", () => {
    const prompt = buildTeacherPrompt(createTeacherContext());
    // Two, because they go stale for different reasons: instructions change
    // when a prompt constant is edited, the curriculum every time a phrase is
    // authored. There used to be eight naming individual constants, which were
    // labels for a mechanism that did not exist.
    expect(prompt.cacheMarkers).toEqual([
      "teacher.system.instructions",
      "teacher.system.curriculum"
    ]);
    expect(prompt.systemBlocks.map((block) => block.cache)).toEqual([true, true]);
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

  it("says the relationship is unknown when there was no conversation to read", () => {
    // A directive shared by every NPC is planned with no recent turns AT ALL,
    // which is not the same as reading the conversation and finding none. Read
    // as a first meeting, it would ask for a greeting from an NPC the player is
    // twenty turns into talking to.
    const base = createTeacherContext();
    const situation = { ...base.situation! };
    delete situation.recentTurns;
    delete situation.turnsSinceLastProbe;
    const prompt = buildTeacherPrompt({ ...base, situation });

    expect(prompt.user).toContain("relationship state: (unknown)");
    expect(prompt.user).toContain("opening turn: (unknown)");
    expect(prompt.user).not.toContain(
      "A brief greeting or tiny self-introduction is enough."
    );
    // Turns since the last probe are conversation state too, so the prompt must
    // not state a count it never read.
    expect(prompt.user).toContain("turnsSinceLastProbe=(unknown)");
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
