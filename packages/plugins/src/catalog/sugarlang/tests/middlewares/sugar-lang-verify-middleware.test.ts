/**
 * packages/plugins/src/catalog/sugarlang/tests/middlewares/sugar-lang-verify-middleware.test.ts
 *
 * Purpose: Verifies repair and fallback behavior in the Sugarlang verify middleware.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Depends on ../../runtime/middlewares/sugar-lang-verify-middleware.
 *   - Uses shared middleware test fixtures from ./test-helpers.
 *
 * Implements: Epic 10 Story 10.4
 *
 * Status: active
 */

import { PLAYER_VO_SPEAKER } from "@sugarmagic/domain";
import { describe, expect, it, vi } from "vitest";
import {
  createSugarLangVerifyMiddleware,
  computeVoiceRetentionScore
} from "../../runtime/middlewares/sugar-lang-verify-middleware";
import { SUGARLANG_CONSTRAINT_ANNOTATION } from "../../runtime/middlewares/shared";
import { MemoryTelemetrySink } from "../../runtime/telemetry/telemetry";
import {
  createBaseConstraint,
  createServicesStub,
  createTestExecution,
  createTestLearnerProfile,
  createTestTurn
} from "./test-helpers";

// Shared ratio-verdict fixtures for the readability-ceiling gate (090.11).
const RATIO_VERDICT_A1_TOO_DENSE = {
        withinEnvelope: true,
        profile: {
          totalTokens: 10,
          knownTokens: 10,
          inBandTokens: 10,
          unknownTokens: 0,
          bandHistogram: { A1: 10, A2: 0, B1: 0, B2: 0, C1: 0, C2: 0 },
          outOfEnvelopeLemmas: [],
          ceilingExceededLemmas: [],
          questEssentialLemmasMatched: [],
          coverageRatio: 1,
          ratioCheckTokens: 10,
          resolvedTargetLanguageTokens: 10
        },
        worstViolation: null,
        rule: "test",
        violations: [],
        exemptionsApplied: [],
        languageRatioVerdict: {
          measuredRatio: 0.92,
          directedRatio: 0.3,
          posture: "anchored",
          conformance: "over-ratio"
        }
      };
const RATIO_VERDICT_A1_OFF_TARGET = {
        withinEnvelope: true,
        profile: {
          totalTokens: 10,
          knownTokens: 10,
          inBandTokens: 10,
          unknownTokens: 0,
          bandHistogram: { A1: 10, A2: 0, B1: 0, B2: 0, C1: 0, C2: 0 },
          outOfEnvelopeLemmas: [],
          ceilingExceededLemmas: [],
          questEssentialLemmasMatched: [],
          coverageRatio: 1,
          ratioCheckTokens: 10,
          resolvedTargetLanguageTokens: 10
        },
        worstViolation: null,
        rule: "test",
        violations: [],
        exemptionsApplied: [],
        languageRatioVerdict: {
          measuredRatio: 0.45,
          directedRatio: 0.3,
          posture: "anchored",
          conformance: "over-ratio"
        }
      };
const RATIO_VERDICT_A1_ON_TARGET = {
        withinEnvelope: true,
        profile: {
          totalTokens: 10,
          knownTokens: 10,
          inBandTokens: 10,
          unknownTokens: 0,
          bandHistogram: { A1: 10, A2: 0, B1: 0, B2: 0, C1: 0, C2: 0 },
          outOfEnvelopeLemmas: [],
          ceilingExceededLemmas: [],
          questEssentialLemmasMatched: [],
          coverageRatio: 1,
          ratioCheckTokens: 10,
          resolvedTargetLanguageTokens: 10
        },
        worstViolation: null,
        rule: "test",
        violations: [],
        exemptionsApplied: [],
        languageRatioVerdict: {
          measuredRatio: 0.3,
          directedRatio: 0.3,
          posture: "anchored",
          conformance: "conformant"
        }
      };
const RATIO_VERDICT_C2_FULL_TARGET = {
        withinEnvelope: true,
        profile: {
          totalTokens: 10,
          knownTokens: 10,
          inBandTokens: 10,
          unknownTokens: 0,
          bandHistogram: { A1: 10, A2: 0, B1: 0, B2: 0, C1: 0, C2: 0 },
          outOfEnvelopeLemmas: [],
          ceilingExceededLemmas: [],
          questEssentialLemmasMatched: [],
          coverageRatio: 1,
          ratioCheckTokens: 10,
          resolvedTargetLanguageTokens: 10
        },
        worstViolation: null,
        rule: "test",
        violations: [],
        exemptionsApplied: [],
        languageRatioVerdict: {
          measuredRatio: 1,
          directedRatio: 1,
          posture: "anchored",
          conformance: "conformant"
        }
      };

const FAILING_VERDICT_FIXTURE = {
        withinEnvelope: false,
        profile: {
          totalTokens: 5,
          knownTokens: 0,
          inBandTokens: 0,
          unknownTokens: 5,
          bandHistogram: { A1: 0, A2: 0, B1: 0, B2: 0, C1: 0, C2: 0 },
          outOfEnvelopeLemmas: [
            { lemmaId: "equilátero", lang: "es" },
            { lemmaId: "hipotenusa", lang: "es" },
            { lemmaId: "isósceles", lang: "es" }
          ],
          ceilingExceededLemmas: [],
          questEssentialLemmasMatched: [],
          coverageRatio: 0,
          ratioCheckTokens: 5,
          resolvedTargetLanguageTokens: 0
        },
        worstViolation: null,
        rule: "test",
        violations: [],
        exemptionsApplied: [],
        languageRatioVerdict: {
          measuredRatio: 0,
          directedRatio: 0.85,
          posture: "target-dominant",
          conformance: "under-ratio"
        }
      };

describe("SugarLangVerifyMiddleware", () => {
  it("temporarily bypasses verification when verify is disabled in Sugarlang config", async () => {
    const classifierCheck = vi.fn();
    const middleware = createSugarLangVerifyMiddleware({
      services: createServicesStub({
        getConfig: () => ({
          targetLanguage: "es",
          supportLanguage: "en",
          debugLogging: true,
          verifyEnabled: false,
          chunkExtraction: {
            enabled: true
          },
          placement: {
            enabled: true,
            minAnswersForValid: "use-bank-default" as const,
            confidenceFloor: 0.3,
            openingDialogTurns: 2,
            closingDialogTurns: 2
          }
        }),
        resolveForExecution: () => ({
          learnerStore: {
            getCurrentProfile: vi.fn()
          },
          sceneLexiconStore: {
            ensure: vi.fn()
          },
          classifier: {
            check: classifierCheck
          },
          llmClient: {
            generate: vi.fn()
          }
        })
      }) as never
    });
    const execution = createTestExecution();
    execution.annotations[SUGARLANG_CONSTRAINT_ANNOTATION] = createBaseConstraint();
    const turn = createTestTurn("texto complicado");

    const result = await middleware.finalize?.(execution, turn);

    expect(result).toEqual(turn);
    expect(classifierCheck).not.toHaveBeenCalled();
  });

  it("bypasses verification for scripted NPC conversations", async () => {
    const classifierCheck = vi.fn();
    const llmClient = {
      generate: vi.fn()
    };
    const middleware = createSugarLangVerifyMiddleware({
      services: createServicesStub({
        resolveForExecution: () => ({
          learnerStore: {
            getCurrentProfile: vi
              .fn()
              .mockResolvedValue(createTestLearnerProfile())
          },
          sceneLexiconStore: {
            ensure: vi.fn()
          },
          classifier: {
            check: classifierCheck
          },
          llmClient
        })
      }) as never
    });
    const execution = createTestExecution({
      selection: {
        conversationKind: "scripted-dialogue",
        npcDefinitionId: "npc-1",
        npcDisplayName: "Marisol",
        interactionMode: "scripted",
        targetLanguage: "es",
        supportLanguage: "en",
        metadata: {}
      }
    });
    execution.annotations[SUGARLANG_CONSTRAINT_ANNOTATION] = createBaseConstraint();
    const turn = createTestTurn("texto complicado");

    const result = await middleware.finalize?.(execution, turn);

    expect(result).toEqual(turn);
    expect(classifierCheck).not.toHaveBeenCalled();
    expect(llmClient.generate).not.toHaveBeenCalled();
  });

  it("bypasses verification for player voice-over turns", async () => {
    const classifierCheck = vi.fn();
    const llmClient = {
      generate: vi.fn()
    };
    const middleware = createSugarLangVerifyMiddleware({
      services: createServicesStub({
        getPlayerDefinitionId: () => "player-1",
        resolveForExecution: () => ({
          learnerStore: {
            getCurrentProfile: vi
              .fn()
              .mockResolvedValue(createTestLearnerProfile())
          },
          sceneLexiconStore: {
            ensure: vi.fn()
          },
          classifier: {
            check: classifierCheck
          },
          llmClient
        })
      }) as never
    });
    const execution = createTestExecution();
    execution.annotations[SUGARLANG_CONSTRAINT_ANNOTATION] = createBaseConstraint();
    const turn = {
      ...createTestTurn("I can't believe I'm here."),
      speakerId: PLAYER_VO_SPEAKER.speakerId,
      speakerLabel: PLAYER_VO_SPEAKER.displayName
    };

    const result = await middleware.finalize?.(execution, turn);

    expect(result).toEqual(turn);
    expect(classifierCheck).not.toHaveBeenCalled();
    expect(llmClient.generate).not.toHaveBeenCalled();
  });

  it("THE ONE THAT MATTERS: a failing verdict never alters the turn and never calls a model", async () => {
    // The gate is gone (sugarmagic-latency-psm; nikki 2026-08-06). Before it,
    // this exact input -- out of envelope AND under ratio -- bought a 5-12s
    // best-of-3 repair call and the player read a rewrite. Verify now
    // computes, records, and passes the line through untouched. Measured
    // before the change: the gate fired on ~100% of turns, essentially always
    // wrongly.
    const llmClient = {
      generate: vi.fn().mockResolvedValue({ text: "should never be called", requestId: null })
    };
    const classifierCheck = vi.fn().mockReturnValue(FAILING_VERDICT_FIXTURE);
    const middleware = createSugarLangVerifyMiddleware({
      services: createServicesStub({
        resolveForExecution: () => ({
          learnerStore: {
            getCurrentProfile: vi.fn().mockResolvedValue(createTestLearnerProfile())
          },
          sceneLexiconStore: {
            ensure: vi.fn().mockResolvedValue({
              regionId: "scene-1",
              contentHash: "hash",
              pipelineVersion: "v1",
              atlasVersion: "v1",
              profile: "runtime-preview",
              lemmas: {},
              properNouns: [],
              anchors: [],
              questEssentialLemmas: []
            })
          },
          classifier: { check: classifierCheck },
          llmClient
        })
      }) as never
    });
    const execution = createTestExecution();
    execution.annotations[SUGARLANG_CONSTRAINT_ANNOTATION] = createBaseConstraint({
      supportPosture: "target-dominant",
      targetLanguageRatio: 0.85
    });

    const original = "This entire line is English and out of envelope.";
    const result = await middleware.finalize?.(execution, {
      speakerLabel: "NPC",
      text: original
    } as never);

    expect((result as { text: string }).text).toBe(original);
    expect(llmClient.generate).not.toHaveBeenCalled();
    expect(classifierCheck).toHaveBeenCalledTimes(1);
  });

  it("the repair machinery is gone from the module surface", async () => {
    // The grep exits in code form: a re-added export fails here before it
    // fails a shell grep nobody runs.
    const module_ = await import("../../runtime/middlewares/sugar-lang-verify-middleware");
    expect((module_ as Record<string, unknown>)["repairWithBestOfN"]).toBeUndefined();
    expect((module_ as Record<string, unknown>)["scoreCandidateVerdict"]).toBeUndefined();
    expect(module_.computeVoiceRetentionScore).toBeDefined();
  });

  it("083.2: verify-pass path makes zero LLM calls (turn-budget guard)", async () => {
    const llmClient = { generate: vi.fn() };
    const middleware = createSugarLangVerifyMiddleware({
      services: createServicesStub({
        resolveForExecution: () => ({
          learnerStore: { getCurrentProfile: vi.fn().mockResolvedValue(createTestLearnerProfile()) },
          sceneLexiconStore: { ensure: vi.fn().mockResolvedValue({ regionId: "scene-1", contentHash: "hash", pipelineVersion: "v1", atlasVersion: "v1", profile: "runtime-preview", lemmas: {}, properNouns: [], anchors: [], questEssentialLemmas: [] }) },
          classifier: {
            check: vi.fn().mockReturnValue({
              withinEnvelope: true,
              profile: { totalTokens: 2, knownTokens: 2, inBandTokens: 2, unknownTokens: 0, bandHistogram: { A1: 2, A2: 0, B1: 0, B2: 0, C1: 0, C2: 0 }, outOfEnvelopeLemmas: [], ceilingExceededLemmas: [], questEssentialLemmasMatched: [], coverageRatio: 1, ratioCheckTokens: 2, resolvedTargetLanguageTokens: 2 },
              worstViolation: null, rule: "test", violations: [], exemptionsApplied: [],
              languageRatioVerdict: { measuredRatio: 0.65, directedRatio: 0.65, posture: "supported", conformance: "conformant" }
            })
          },
          llmClient
        })
      }) as never
    });
    const execution = createTestExecution();
    execution.annotations[SUGARLANG_CONSTRAINT_ANNOTATION] = createBaseConstraint();

    await middleware.finalize?.(execution, createTestTurn("Hola amigo."));

    expect(llmClient.generate).not.toHaveBeenCalled();
  });

  it("does not trigger quest-essential repair on a generic opening turn that is not quest-focused", async () => {
    const llmClient = {
      generate: vi.fn()
    };
    const middleware = createSugarLangVerifyMiddleware({
      services: createServicesStub({
        resolveForExecution: () => ({
          learnerStore: {
            getCurrentProfile: vi
              .fn()
              .mockResolvedValue(createTestLearnerProfile())
          },
          sceneLexiconStore: {
            ensure: vi.fn().mockResolvedValue({
              regionId: "scene-1",
              contentHash: "hash",
              pipelineVersion: "v1",
              atlasVersion: "v1",
              profile: "runtime-preview",
              lemmas: {},
              properNouns: [],
              anchors: [],
              questEssentialLemmas: []
            })
          },
          classifier: {
            check: vi.fn().mockReturnValue({
              withinEnvelope: true,
              profile: {
                totalTokens: 7,
                knownTokens: 7,
                inBandTokens: 7,
                unknownTokens: 0,
                bandHistogram: { A1: 7, A2: 0, B1: 0, B2: 0, C1: 0, C2: 0 },
                outOfEnvelopeLemmas: [],
                ceilingExceededLemmas: [],
                questEssentialLemmasMatched: [],
                coverageRatio: 1,
                ratioCheckTokens: 7,
                resolvedTargetLanguageTokens: 7
              },
              worstViolation: null,
              rule: "test",
              violations: [],
              exemptionsApplied: [],
              languageRatioVerdict: {
                measuredRatio: 0.65,
                directedRatio: 0.65,
                posture: "supported",
                conformance: "conformant"
              }
            })
          },
          llmClient
        })
      }) as never
    });
    const baseExecution = createTestExecution();
    const execution = createTestExecution({
      input: null,
      runtimeContext: {
        ...baseExecution.runtimeContext!,
        activeQuestObjectives: {
          questId: "quest-1",
          displayName: "Lost Luggage",
          stageId: "stage-1",
          stageDisplayName: "Find the suitcase",
          objectives: [
            {
              nodeId: "objective-1",
              displayName: "Find suitcase",
              description: "Ask about the suitcase."
            }
          ]
        }
      }
    });
    execution.annotations[SUGARLANG_CONSTRAINT_ANNOTATION] = createBaseConstraint({
      questEssentialLemmas: [
        {
          lemmaRef: { lemmaId: "maleta", lang: "es" },
          sourceObjectiveDisplayName: "Find suitcase",
          supportLanguageGloss: "suitcase"
        }
      ]
    });

    const result = await middleware.finalize?.(
      execution,
      createTestTurn("Hello. What can I help you with today?")
    );

    expect(result?.text).toBe("Hello. What can I help you with today?");
    expect(llmClient.generate).not.toHaveBeenCalled();
  });

  // Plan 084.6 -- deterministic bypass
  it("084.6: deterministic-backend turn skips repair but still runs classifier (zero LLM calls)", async () => {
    const classifierCheck = vi.fn().mockReturnValue({
      withinEnvelope: false,
      profile: { totalTokens: 5, knownTokens: 0, inBandTokens: 0, unknownTokens: 5, bandHistogram: { A1: 0, A2: 0, B1: 0, B2: 0, C1: 0, C2: 0 }, outOfEnvelopeLemmas: [], ceilingExceededLemmas: [], questEssentialLemmasMatched: [], coverageRatio: 0, ratioCheckTokens: 5, resolvedTargetLanguageTokens: 0 },
      worstViolation: null, rule: "test", violations: [], exemptionsApplied: [],
      languageRatioVerdict: { measuredRatio: 0, directedRatio: 0.85, posture: "target-dominant", conformance: "under-ratio" }
    });
    const llmClient = { generate: vi.fn() };
    const middleware = createSugarLangVerifyMiddleware({
      services: createServicesStub({
        resolveForExecution: () => ({
          learnerStore: { getCurrentProfile: vi.fn().mockResolvedValue(createTestLearnerProfile()) },
          sceneLexiconStore: { ensure: vi.fn().mockResolvedValue({ regionId: "scene-1", contentHash: "hash", pipelineVersion: "v1", atlasVersion: "v1", profile: "runtime-preview", lemmas: {}, properNouns: [], anchors: [], questEssentialLemmas: [] }) },
          classifier: { check: classifierCheck },
          llmClient
        })
      }) as never
    });
    const execution = createTestExecution();
    execution.annotations[SUGARLANG_CONSTRAINT_ANNOTATION] = createBaseConstraint({ supportPosture: "target-dominant", targetLanguageRatio: 0.85 });
    const turn = createTestTurn("Sorry, I need to get back to my work.");
    turn.diagnostics = { llmBackend: "deterministic" };

    const result = await middleware.finalize?.(execution, turn);

    // Classifier ran (ratio telemetry recorded) but no repair call.
    expect(classifierCheck).toHaveBeenCalledTimes(1);
    expect(llmClient.generate).not.toHaveBeenCalled();
    // Text unchanged.
    expect(result?.text).toBe("Sorry, I need to get back to my work.");
  });

  it("084.6: moderation-deflected turn skips repair regardless of llmBackend", async () => {
    const classifierCheck = vi.fn().mockReturnValue({
      withinEnvelope: false,
      profile: { totalTokens: 5, knownTokens: 0, inBandTokens: 0, unknownTokens: 5, bandHistogram: { A1: 0, A2: 0, B1: 0, B2: 0, C1: 0, C2: 0 }, outOfEnvelopeLemmas: [], ceilingExceededLemmas: [], questEssentialLemmasMatched: [], coverageRatio: 0, ratioCheckTokens: 5, resolvedTargetLanguageTokens: 0 },
      worstViolation: null, rule: "test", violations: [], exemptionsApplied: [],
      languageRatioVerdict: { measuredRatio: 0, directedRatio: 0.85, posture: "target-dominant", conformance: "under-ratio" }
    });
    const llmClient = { generate: vi.fn() };
    const middleware = createSugarLangVerifyMiddleware({
      services: createServicesStub({
        resolveForExecution: () => ({
          learnerStore: { getCurrentProfile: vi.fn().mockResolvedValue(createTestLearnerProfile()) },
          sceneLexiconStore: { ensure: vi.fn().mockResolvedValue({ regionId: "scene-1", contentHash: "hash", pipelineVersion: "v1", atlasVersion: "v1", profile: "runtime-preview", lemmas: {}, properNouns: [], anchors: [], questEssentialLemmas: [] }) },
          classifier: { check: classifierCheck },
          llmClient
        })
      }) as never
    });
    const execution = createTestExecution();
    execution.annotations[SUGARLANG_CONSTRAINT_ANNOTATION] = createBaseConstraint({ supportPosture: "target-dominant", targetLanguageRatio: 0.85 });
    const turn = createTestTurn("Hmm, I'm not sure how to respond to that.");
    // Simulate moderation-deflected stamp (llmBackend is still "anthropic").
    turn.diagnostics = { llmBackend: "anthropic", moderationDeflected: true };

    const result = await middleware.finalize?.(execution, turn);

    expect(classifierCheck).toHaveBeenCalledTimes(1);
    expect(llmClient.generate).not.toHaveBeenCalled();
    expect(result?.text).toBe("Hmm, I'm not sure how to respond to that.");
  });

  describe("083.4: computeVoiceRetentionScore", () => {
    it("returns 1 (neutral) when spec is null", () => {
      expect(computeVoiceRetentionScore("any text", null)).toBe(1);
    });

    it("returns 1 (neutral) when spec has no interjections and no gesture tags", () => {
      expect(computeVoiceRetentionScore("any text", { interjections: [], hasGestureTags: false })).toBe(1);
    });

    it("scores 1 when the interjection is present in the candidate", () => {
      expect(computeVoiceRetentionScore("¡Ay, qué sorpresa!", { interjections: ["ay"], hasGestureTags: false })).toBe(1);
    });

    it("scores 0 when the interjection is absent from the candidate", () => {
      expect(computeVoiceRetentionScore("Qué sorpresa.", { interjections: ["ay"], hasGestureTags: false })).toBe(0);
    });

    it("scores 1 when gesture tag is present and spec requires it", () => {
      expect(computeVoiceRetentionScore("*sweeps hat* Buenas tardes.", { interjections: [], hasGestureTags: true })).toBe(1);
    });

    it("scores 0 when gesture tag is absent and spec requires it", () => {
      expect(computeVoiceRetentionScore("Buenas tardes.", { interjections: [], hasGestureTags: true })).toBe(0);
    });

    it("scores 0.5 when interjection present but gesture tag stripped", () => {
      expect(computeVoiceRetentionScore("¡Ay! Buenas tardes.", { interjections: ["ay"], hasGestureTags: true })).toBe(0.5);
    });

    it("scores 1 when both interjection and gesture tag are present", () => {
      expect(computeVoiceRetentionScore("*sweeps hat* ¡Ay! Buenas tardes.", { interjections: ["ay"], hasGestureTags: true })).toBe(1);
    });
  });

  it("083.5: emits verify.drift-sample with turn index and voice retention score", async () => {
    const passProfile = {
      totalTokens: 3, knownTokens: 3, inBandTokens: 3, unknownTokens: 0,
      bandHistogram: { A1: 3, A2: 0, B1: 0, B2: 0, C1: 0, C2: 0 },
      outOfEnvelopeLemmas: [], ceilingExceededLemmas: [], questEssentialLemmasMatched: [],
      coverageRatio: 1, ratioCheckTokens: 3, resolvedTargetLanguageTokens: 3
    };
    const classifierCheck = vi.fn().mockReturnValue({
      withinEnvelope: true, profile: passProfile, worstViolation: null, rule: "test",
      violations: [], exemptionsApplied: [],
      languageRatioVerdict: { measuredRatio: 0.85, directedRatio: 0.85, posture: "target-dominant", conformance: "conformant" }
    });
    const sink = new MemoryTelemetrySink();
    const middleware = createSugarLangVerifyMiddleware({
      services: createServicesStub({
        resolveForExecution: () => ({
          learnerStore: { getCurrentProfile: vi.fn().mockResolvedValue(createTestLearnerProfile()) },
          sceneLexiconStore: { ensure: vi.fn().mockResolvedValue({
            regionId: "scene-1", contentHash: "hash", pipelineVersion: "v1",
            atlasVersion: "v1", profile: "runtime-preview",
            lemmas: {}, properNouns: [], anchors: [], questEssentialLemmas: [],
            npcVoiceSpecs: { "npc-1": { interjections: ["ay"], hasGestureTags: false } }
          }) },
          classifier: { check: classifierCheck },
          llmClient: null
        })
      }) as never,
      telemetry: sink
    });
    const execution = createTestExecution();
    // Simulate 3 history entries to set turn index
    (execution.state["sugaragent.session"] as { history: unknown[] }).history = [
      { role: "user", text: "hola" },
      { role: "assistant", text: "hola amigo" },
      { role: "user", text: "como estas" }
    ];
    execution.annotations[SUGARLANG_CONSTRAINT_ANNOTATION] = createBaseConstraint({
      supportPosture: "target-dominant",
      targetLanguageRatio: 0.85
    });

    await middleware.finalize?.(execution, createTestTurn("¡Ay! Hola amigo."));

    const events = await sink.query({ eventKinds: ["verify.drift-sample"] });
    expect(events).toHaveLength(1);
    const drift = events[0] as Extract<typeof events[0], { kind: "verify.drift-sample" }>;
    expect(drift.turnIndex).toBe(3);
    expect(drift.measuredRatio).toBe(0.85);
    expect(drift.directedRatio).toBe(0.85);
    expect(drift.ratioConformance).toBe("conformant");
    expect(drift.withinEnvelope).toBe(true);
    // "¡Ay! Hola amigo." contains the interjection "ay" -- score should be 1
    expect(drift.voiceRetentionScore).toBe(1);
  });

  it("090.11: an A1 line merely OFF-TARGET does not spend a repair call", async () => {
    // 0.45 against a directed 0.3 is already `over-ratio` -- off-target and
    // perfectly readable. Repairing every one of these would mean a second LLM
    // call on most turns to correct a tuning miss rather than a broken turn.
    // This is why the trigger is the readability ceiling and NOT `over-ratio`.
    const llmClient = { generate: vi.fn() };
    const classifierCheck = vi.fn().mockReturnValue(RATIO_VERDICT_A1_OFF_TARGET);
    const middleware = createSugarLangVerifyMiddleware({
      services: createServicesStub({
        resolveForExecution: () => ({
          learnerStore: {
            getCurrentProfile: vi.fn().mockResolvedValue(createTestLearnerProfile())
          },
          sceneLexiconStore: {
            ensure: vi.fn().mockResolvedValue({
              regionId: "scene-1",
              contentHash: "hash",
              pipelineVersion: "v1",
              atlasVersion: "v1",
              profile: "runtime-preview",
              lemmas: {},
              properNouns: [],
              anchors: [],
              questEssentialLemmas: []
            })
          },
          classifier: { check: classifierCheck },
          llmClient
        })
      }) as never
    });
    const execution = createTestExecution();
    execution.annotations[SUGARLANG_CONSTRAINT_ANNOTATION] = createBaseConstraint({
      supportPosture: "anchored",
      targetLanguageRatio: 0.3,
      learnerCefr: "A1"
    });

    await middleware.finalize?.(
      execution,
      createTestTurn("Hello there, buenos dias traveller.")
    );

    expect(llmClient.generate).not.toHaveBeenCalled();
  });

  it("090.11: a C2 line at 100% target language is never repaired for density", async () => {
    // A fully target-language line is the GOAL at C2. There is no ceiling, and
    // the guard must not invent one.
    const llmClient = { generate: vi.fn() };
    const classifierCheck = vi.fn().mockReturnValue(RATIO_VERDICT_C2_FULL_TARGET);
    const middleware = createSugarLangVerifyMiddleware({
      services: createServicesStub({
        resolveForExecution: () => ({
          learnerStore: {
            getCurrentProfile: vi.fn().mockResolvedValue(createTestLearnerProfile())
          },
          sceneLexiconStore: {
            ensure: vi.fn().mockResolvedValue({
              regionId: "scene-1",
              contentHash: "hash",
              pipelineVersion: "v1",
              atlasVersion: "v1",
              profile: "runtime-preview",
              lemmas: {},
              properNouns: [],
              anchors: [],
              questEssentialLemmas: []
            })
          },
          classifier: { check: classifierCheck },
          llmClient
        })
      }) as never
    });
    const execution = createTestExecution();
    execution.annotations[SUGARLANG_CONSTRAINT_ANNOTATION] = createBaseConstraint({
      supportPosture: "target-only",
      targetLanguageRatio: 1,
      learnerCefr: "C2"
    });

    await middleware.finalize?.(
      execution,
      createTestTurn("El barco llega manana por la manana temprano.")
    );

    expect(llmClient.generate).not.toHaveBeenCalled();
  });
});
