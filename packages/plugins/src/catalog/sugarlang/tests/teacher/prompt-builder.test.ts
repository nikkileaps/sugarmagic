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
  DIRECTOR_COMPREHENSION_GUIDANCE_BLOCK,
  buildTeacherPrompt,
  estimatePromptTokens,
  formatPendingProvisional
} from "../../runtime/teacher/prompt-builder";
import { createTeacherContext } from "./test-helpers";

describe("buildTeacherPrompt", () => {
  it("assembles the expected prompt slices for a fixture context", () => {
    const prompt = buildTeacherPrompt(createTeacherContext());

    expect(prompt.system).toContain("You are the Sugarlang Teacher.");
    expect(prompt.user).toContain("LEARNER STATE:");
    expect(prompt.user).toContain("RELATIONSHIP STATE:");
    expect(prompt.user).toContain("SCENE SNAPSHOT:");
    expect(prompt.user).toContain("RECENT DIALOGUE:");
    expect(prompt.user).toContain("LEXICAL PRESCRIPTION:");
    expect(prompt.user).toContain("PENDING PROVISIONAL EVIDENCE:");
    expect(prompt.user).toContain("TURN-SHAPING HINTS:");
    expect(prompt.user).not.toContain("QUEST-ESSENTIAL LEMMAS");
  });

  it("keeps the prompt within the expected token budget envelope", () => {
    const prompt = buildTeacherPrompt(createTeacherContext());
    const systemTokens = estimatePromptTokens(prompt.system);
    const userTokens = estimatePromptTokens(prompt.user);

    expect(systemTokens).toBeGreaterThan(350);
    expect(systemTokens).toBeLessThan(1800);
    expect(userTokens).toBeGreaterThan(200);
    expect(userTokens).toBeLessThan(900);
  });

  it("returns stable cache markers for the static prompt portion", () => {
    const prompt = buildTeacherPrompt(createTeacherContext());
    expect(prompt.cacheMarkers).toEqual([
      "director.system.role",
      "director.system.rubric",
      "director.system.cefr",
      "director.system.schema",
      "director.system.constraints",
      "director.system.comprehension-guidance",
      "director.user.template"
    ]);
  });

  it("includes the comprehension guidance block verbatim in the system prompt", () => {
    const prompt = buildTeacherPrompt(createTeacherContext());
    expect(prompt.system).toContain(DIRECTOR_COMPREHENSION_GUIDANCE_BLOCK);
  });

  it("formats pending provisional evidence readably", () => {
    const output = formatPendingProvisional(createTeacherContext());

    expect(output).toContain("hola (A1): 1 units, pending for 3 turns");
    expect(output).toContain("billete (A2): 2 units, pending for 7 turns");
    expect(output).toContain("queso (A2): 1 units, pending for 5 turns");
    expect(output).toContain("Total pending: 3 lemmas");
  });

  it("surfaces the soft floor recommendation in the user prompt", () => {
    const prompt = buildTeacherPrompt(
      createTeacherContext({
        probeFloorState: {
          turnsSinceLastProbe: 12,
          totalPendingLemmas: 3,
          softFloorReached: true,
          hardFloorReached: false
        }
      })
    );

    expect(prompt.user).toContain("SOFT FLOOR - probe recommended");
  });

  it("surfaces the hard floor requirement in the user prompt", () => {
    const prompt = buildTeacherPrompt(
      createTeacherContext({
        probeFloorState: {
          turnsSinceLastProbe: 26,
          totalPendingLemmas: 3,
          softFloorReached: true,
          hardFloorReached: true,
          hardFloorReason: "turns-since-probe"
        }
      })
    );

    expect(prompt.user).toContain(
      "The hard probe floor is active. This turn must trigger a comprehension check."
    );
    expect(prompt.user).toContain("HARD FLOOR - probe REQUIRED this turn");
  });

  it("renders a no-pending message instead of a blank provisional section", () => {
    const output = formatPendingProvisional(
      createTeacherContext({
        pendingProvisionalLemmas: [],
        probeFloorState: {
          turnsSinceLastProbe: 1,
          totalPendingLemmas: 0,
          softFloorReached: false,
          hardFloorReached: false
        }
      })
    );

    expect(output).toContain("No pending provisional evidence.");
  });

  it("surfaces first-meeting guidance when there is no prior dialogue", () => {
    const prompt = buildTeacherPrompt(
      createTeacherContext({
        recentTurns: []
      })
    );

    expect(prompt.user).toContain("relationship state: probable_first_meeting");
    expect(prompt.user).toContain("A brief greeting or tiny self-introduction is enough.");
  });
});
