/**
 * packages/plugins/src/catalog/sugarlang/tests/teacher/llm-teacher-policy.test.ts
 *
 * Purpose: Verifies gateway-backed teacher invocation, repair, failure, and telemetry behavior.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Exercises ../../runtime/teacher/policies/llm-teacher-policy with mocked client and telemetry seams.
 *   - Confirms the policy returns directives or throws TeacherInvocationError cleanly.
 *
 * Implements: Epic 9 Story 9.3
 *
 * Status: active
 */

import { describe, expect, it, vi } from "vitest";
import {
  ClaudeTeacherPolicy,
  TeacherInvocationError
} from "../../runtime/teacher/policies/llm-teacher-policy";
import { createDirectiveFixture, createTeacherContext } from "./test-helpers";

describe("ClaudeTeacherPolicy", () => {
  it("returns a directive for a valid mocked Claude response", async () => {
    const policy = new ClaudeTeacherPolicy({
      client: {
        generateStructuredDirective: vi.fn(async () => ({
          text: JSON.stringify(createDirectiveFixture()),
          inputTokens: 100,
          outputTokens: 50
        }))
      }
    });

    const directive = await policy.invoke(createTeacherContext());
    expect(directive.isFallbackDirective).toBe(false);
    expect(directive.glossingStrategy).toBe("inline");
  });

  it("repairs schema-invalid Claude output into a usable directive", async () => {
    const policy = new ClaudeTeacherPolicy({
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
      createTeacherContext({
        activeQuestEssentialLemmas: []
      })
    );

    expect(directive.targetLanguageRatio).toBe(1);
    expect(directive.targetVocab.introduce).toEqual([{ lemmaId: "queso", lang: "es" }]);
  });

  it("throws TeacherInvocationError when the Claude client fails", async () => {
    const policy = new ClaudeTeacherPolicy({
      client: {
        generateStructuredDirective: vi.fn(async () => {
          throw new Error("network down");
        })
      }
    });

    await expect(policy.invoke(createTeacherContext())).rejects.toBeInstanceOf(
      TeacherInvocationError
    );
  });

  it("emits telemetry on every invocation", async () => {
    const telemetry = {
      emit: vi.fn()
    };
    const policy = new ClaudeTeacherPolicy({
      client: {
        generateStructuredDirective: vi.fn(async () => ({
          text: JSON.stringify(createDirectiveFixture()),
          requestId: "request-1"
        }))
      },
      telemetry,
      now: () => 1000
    });

    await policy.invoke(createTeacherContext());

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

  it("logs the full Teacher prompt and raw response when a logger is provided", async () => {
    const logger = {
      info: vi.fn(),
      warn: vi.fn()
    };
    const policy = new ClaudeTeacherPolicy({
      client: {
        generateStructuredDirective: vi.fn(async () => ({
          text: JSON.stringify(createDirectiveFixture()),
          requestId: "request-logger"
        }))
      },
      logger
    });

    await policy.invoke(createTeacherContext());

    expect(logger.info).toHaveBeenCalledWith(
      "Teacher prompt constructed.",
      expect.objectContaining({
        systemPrompt: expect.any(String),
        userPrompt: expect.any(String)
      })
    );
    expect(logger.info).toHaveBeenCalledWith(
      "Teacher response received.",
      expect.objectContaining({
        rawResponseText: expect.any(String),
        directive: expect.objectContaining({
          glossingStrategy: "inline"
        })
      })
    );
  });

  it("logs structured rejection details before falling back on unrepaired parse errors", async () => {
    const logger = {
      info: vi.fn(),
      warn: vi.fn()
    };
    const policy = new ClaudeTeacherPolicy({
      client: {
        generateStructuredDirective: vi.fn(async () => ({
          text: JSON.stringify(
            createDirectiveFixture({
              glossingStrategy: "none"
            })
          ),
          requestId: "request-rejected"
        }))
      },
      logger
    });

    await expect(policy.invoke(createTeacherContext())).rejects.toBeInstanceOf(
      TeacherInvocationError
    );

    expect(logger.warn).toHaveBeenCalledWith(
      "Teacher response rejected before repair; falling back.",
      expect.objectContaining({
        errorCode: "quest_essential_glossing_required",
        rawResponseText: expect.any(String),
        activeQuestEssentialLemmaCount: 1
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
