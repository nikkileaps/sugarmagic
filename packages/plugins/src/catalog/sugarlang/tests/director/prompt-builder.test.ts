/**
 * packages/plugins/src/catalog/sugarlang/tests/director/prompt-builder.test.ts
 *
 * Purpose: Verifies deterministic Director prompt assembly and formatter outputs.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Exercises ../../runtime/director/prompt-builder against hand-crafted DirectorContext fixtures.
 *   - Locks the static comprehension guidance block so prompt drift is reviewable.
 *
 * Implements: Epic 9 Story 9.1
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import {
  DIRECTOR_COMPREHENSION_GUIDANCE_BLOCK,
  buildDirectorPrompt,
  estimatePromptTokens,
  formatPendingProvisional
} from "../../runtime/director/prompt-builder";
import { createDirectorContext } from "./test-helpers";

describe("buildDirectorPrompt", () => {
  it("assembles the expected prompt slices for a fixture context", () => {
    const prompt = buildDirectorPrompt(createDirectorContext());

    expect(prompt.system).toContain("You are the Sugarlang Director.");
    expect(prompt.user).toContain("LEARNER SUMMARY:");
    expect(prompt.user).toContain("SCENE TEACHABLE INDEX:");
    expect(prompt.user).toContain("RECENT DIALOGUE:");
    expect(prompt.user).toContain("LEXICAL PRESCRIPTION:");
    expect(prompt.user).toContain("PENDING PROVISIONAL EVIDENCE:");
    expect(prompt.user).toContain("QUEST-ESSENTIAL LEMMAS");
  });

  it("keeps the prompt within the expected token budget envelope", () => {
    const prompt = buildDirectorPrompt(createDirectorContext());
    const systemTokens = estimatePromptTokens(prompt.system);
    const userTokens = estimatePromptTokens(prompt.user);

    expect(systemTokens).toBeGreaterThan(1200);
    expect(systemTokens).toBeLessThan(2600);
    expect(userTokens).toBeGreaterThan(200);
    expect(userTokens).toBeLessThan(900);
  });

  it("returns stable cache markers for the static prompt portion", () => {
    const prompt = buildDirectorPrompt(createDirectorContext());
    expect(prompt.cacheMarkers).toEqual([
      "director.system.role",
      "director.system.rubric",
      "director.system.cefr",
      "director.system.schema",
      "director.system.constraints",
      "director.system.comprehension-guidance"
    ]);
  });

  it("includes the comprehension guidance block verbatim in the system prompt", () => {
    const prompt = buildDirectorPrompt(createDirectorContext());
    expect(prompt.system).toContain(DIRECTOR_COMPREHENSION_GUIDANCE_BLOCK);
  });

  it("formats pending provisional evidence readably", () => {
    const output = formatPendingProvisional(createDirectorContext());

    expect(output).toContain("hola (A1): 1 units, pending for 3 turns");
    expect(output).toContain("billete (A2): 2 units, pending for 7 turns");
    expect(output).toContain("queso (A2): 1 units, pending for 5 turns");
    expect(output).toContain("Total pending: 3 lemmas");
  });

  it("surfaces the soft floor recommendation in the user prompt", () => {
    const prompt = buildDirectorPrompt(
      createDirectorContext({
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
    const prompt = buildDirectorPrompt(
      createDirectorContext({
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
      "REQUIREMENT: This turn MUST trigger a comprehension check."
    );
    expect(prompt.user).toContain("HARD FLOOR - probe REQUIRED this turn");
  });

  it("renders a no-pending message instead of a blank provisional section", () => {
    const output = formatPendingProvisional(
      createDirectorContext({
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
});
