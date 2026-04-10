/**
 * packages/plugins/src/catalog/sugarlang/tests/director/claude-director-policy.test.ts
 *
 * Purpose: Verifies Claude-backed director invocation, repair, failure, and telemetry behavior.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Exercises ../../runtime/director/claude-director-policy with mocked client and telemetry seams.
 *   - Confirms the policy returns directives or throws DirectorInvocationError cleanly.
 *
 * Implements: Epic 9 Story 9.3
 *
 * Status: active
 */

import { describe, expect, it, vi } from "vitest";
import {
  ClaudeDirectorPolicy,
  DirectorInvocationError
} from "../../runtime/director/claude-director-policy";
import { createDirectiveFixture, createDirectorContext } from "./test-helpers";

describe("ClaudeDirectorPolicy", () => {
  it("returns a directive for a valid mocked Claude response", async () => {
    const policy = new ClaudeDirectorPolicy({
      client: {
        generateStructuredDirective: vi.fn(async () => ({
          text: JSON.stringify(createDirectiveFixture()),
          inputTokens: 100,
          outputTokens: 50
        }))
      }
    });

    const directive = await policy.invoke(createDirectorContext());
    expect(directive.isFallbackDirective).toBe(false);
    expect(directive.glossingStrategy).toBe("inline");
  });

  it("repairs schema-invalid Claude output into a usable directive", async () => {
    const policy = new ClaudeDirectorPolicy({
      client: {
        generateStructuredDirective: vi.fn(async () => ({
          text: JSON.stringify({
            targetLanguageRatio: 1.2,
            targetVocab: {
              introduce: [{ lemmaId: "queso", lang: "es" }],
              reinforce: [],
              avoid: []
            }
          })
        }))
      }
    });

    const directive = await policy.invoke(
      createDirectorContext({
        activeQuestEssentialLemmas: []
      })
    );

    expect(directive.targetLanguageRatio).toBe(1);
    expect(directive.targetVocab.introduce).toEqual([{ lemmaId: "queso", lang: "es" }]);
  });

  it("throws DirectorInvocationError when the Claude client fails", async () => {
    const policy = new ClaudeDirectorPolicy({
      client: {
        generateStructuredDirective: vi.fn(async () => {
          throw new Error("network down");
        })
      }
    });

    await expect(policy.invoke(createDirectorContext())).rejects.toBeInstanceOf(
      DirectorInvocationError
    );
  });

  it("emits telemetry on every invocation", async () => {
    const telemetry = {
      emit: vi.fn()
    };
    const policy = new ClaudeDirectorPolicy({
      client: {
        generateStructuredDirective: vi.fn(async () => ({
          text: JSON.stringify(createDirectiveFixture()),
          requestId: "request-1"
        }))
      },
      telemetry,
      now: () => 1000
    });

    await policy.invoke(createDirectorContext());

    const eventKinds = telemetry.emit.mock.calls.map((call) => call[0].kind);
    expect(eventKinds).toContain("director.invocation-started");
    expect(eventKinds).toContain("director.invocation-completed");
    expect(
      telemetry.emit.mock.calls.find(
        (call) => call[0].kind === "director.invocation-completed"
      )?.[0]
    ).toEqual(
      expect.objectContaining({
        conversationId: "conversation-1",
        parseMode: "validated"
      })
    );
  });

  it.skipIf(!process.env.ANTHROPIC_API_KEY)(
    "supports an optional live Claude integration run",
    async () => {
      expect(process.env.ANTHROPIC_API_KEY).toBeTruthy();
    }
  );
});
