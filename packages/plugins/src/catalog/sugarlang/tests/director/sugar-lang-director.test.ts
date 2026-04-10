/**
 * packages/plugins/src/catalog/sugarlang/tests/director/sugar-lang-director.test.ts
 *
 * Purpose: Verifies the Director facade's cache, Claude, fallback, and calibration wiring.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Exercises ../../runtime/director/sugar-lang-director with mock policies and a real cache.
 *   - Treats the facade as the canonical entry point for downstream middleware.
 *
 * Implements: Epic 9 Story 9.7
 *
 * Status: active
 */

import {
  RUNTIME_BLACKBOARD_FACT_DEFINITIONS,
  createRuntimeBlackboard
} from "@sugarmagic/runtime-core";
import { describe, expect, it, vi } from "vitest";
import {
  ClaudeDirectorPolicy,
  DirectorInvocationError
} from "../../runtime/director/claude-director-policy";
import { DirectiveCache } from "../../runtime/director/directive-cache";
import { FallbackDirectorPolicy } from "../../runtime/director/fallback-director-policy";
import { SugarLangDirector } from "../../runtime/director/sugar-lang-director";
import { SUGARLANG_BLACKBOARD_FACT_DEFINITIONS } from "../../runtime/learner/fact-definitions";
import { createDirectiveFixture, createDirectorContext } from "./test-helpers";

function createFacade() {
  const blackboard = createRuntimeBlackboard({
    definitions: [
      ...RUNTIME_BLACKBOARD_FACT_DEFINITIONS,
      ...SUGARLANG_BLACKBOARD_FACT_DEFINITIONS
    ]
  });
  const cache = new DirectiveCache({ blackboard, now: () => 1000 });
  return { blackboard, cache };
}

describe("SugarLangDirector", () => {
  it("short-circuits on cache hit", async () => {
    const { cache } = createFacade();
    cache.set("conversation-1", createDirectiveFixture());
    const claudePolicy = {
      invoke: vi.fn(async () => createDirectiveFixture())
    };
    const director = new SugarLangDirector({
      claudePolicy,
      fallbackPolicy: new FallbackDirectorPolicy(),
      cache
    });

    const directive = await director.invoke(createDirectorContext());
    expect(claudePolicy.invoke).not.toHaveBeenCalled();
    expect(directive.isFallbackDirective).toBe(false);
  });

  it("returns and caches a successful Claude directive", async () => {
    const { cache } = createFacade();
    const claudeDirective = createDirectiveFixture({
      rationale: "Claude success."
    });
    const claudePolicy = {
      invoke: vi.fn(async () => claudeDirective)
    };
    const director = new SugarLangDirector({
      claudePolicy,
      fallbackPolicy: new FallbackDirectorPolicy(),
      cache
    });

    const directive = await director.invoke(createDirectorContext());
    expect(directive.rationale).toBe("Claude success.");
    expect(cache.get("conversation-1")).toEqual(claudeDirective);
  });

  it("falls back and caches when Claude fails", async () => {
    const { cache } = createFacade();
    const claudePolicy = {
      invoke: vi.fn(async () => {
        throw new DirectorInvocationError("hard floor violated", "director-deferred-override");
      })
    };
    const director = new SugarLangDirector({
      claudePolicy,
      fallbackPolicy: new FallbackDirectorPolicy(),
      cache
    });

    const directive = await director.invoke(
      createDirectorContext({
        probeFloorState: {
          turnsSinceLastProbe: 30,
          totalPendingLemmas: 3,
          softFloorReached: true,
          hardFloorReached: true,
          hardFloorReason: "turns-since-probe"
        }
      })
    );

    expect(directive.isFallbackDirective).toBe(true);
    expect(directive.comprehensionCheck.triggerReason).toBe(
      "director-deferred-override"
    );
    expect(cache.get("conversation-1")?.isFallbackDirective).toBe(true);
  });

  it("flows calibration state through before Claude invocation", async () => {
    const { cache } = createFacade();
    const claudePolicy = {
      invoke: vi.fn(async (context) => {
        expect(context.calibrationActive).toBe(true);
        return createDirectiveFixture();
      })
    };
    const director = new SugarLangDirector({
      claudePolicy,
      fallbackPolicy: new FallbackDirectorPolicy(),
      cache
    });
    const context = createDirectorContext();
    context.learner.assessment.cefrConfidence = 0.4;
    context.learner.currentSession!.turns = 3;

    await director.invoke(context);
    expect(claudePolicy.invoke).toHaveBeenCalledTimes(1);
  });

  it("supports an end-to-end mocked Claude policy path", async () => {
    const { cache } = createFacade();
    const claudePolicy = new ClaudeDirectorPolicy({
      client: {
        generateStructuredDirective: vi.fn(async () => ({
          text: JSON.stringify(createDirectiveFixture())
        }))
      }
    });
    const director = new SugarLangDirector({
      claudePolicy,
      fallbackPolicy: new FallbackDirectorPolicy(),
      cache
    });

    const directive = await director.invoke(createDirectorContext());
    expect(directive.isFallbackDirective).toBe(false);
  });
});
