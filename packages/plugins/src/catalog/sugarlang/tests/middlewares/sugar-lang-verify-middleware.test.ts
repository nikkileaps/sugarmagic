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
import {
  createBaseConstraint,
  createServicesStub,
  createTestExecution,
  createTestLearnerProfile,
  createTestTurn
} from "./test-helpers";

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

  it("repairs an out-of-envelope turn and returns the repaired text", async () => {
    const conformantRatioVerdict = {
      measuredRatio: 1,
      directedRatio: 0.65,
      posture: "supported",
      conformance: "conformant"
    };
    const classifierCheck = vi
      .fn()
      .mockReturnValueOnce({
        withinEnvelope: false,
        profile: {
          totalTokens: 1,
          knownTokens: 0,
          inBandTokens: 0,
          unknownTokens: 1,
          bandHistogram: { A1: 0, A2: 0, B1: 1, B2: 0, C1: 0, C2: 0 },
          outOfEnvelopeLemmas: [{ lemmaId: "complicado", lang: "es" }],
          ceilingExceededLemmas: [{ lemmaId: "complicado", lang: "es" }],
          questEssentialLemmasMatched: [],
          coverageRatio: 0.5,
          ratioCheckTokens: 1,
          resolvedTargetLanguageTokens: 0
        },
        worstViolation: { lemmaRef: { lemmaId: "complicado", lang: "es" }, surfaceForm: "complicado", cefrBand: "B1", reason: "too hard" },
        rule: "test",
        violations: [{ lemmaRef: { lemmaId: "complicado", lang: "es" }, surfaceForm: "complicado", cefrBand: "B1", reason: "too hard" }],
        exemptionsApplied: [],
        languageRatioVerdict: { ...conformantRatioVerdict, conformance: "skipped" }
      })
      .mockReturnValueOnce({
        withinEnvelope: true,
        profile: {
          totalTokens: 1,
          knownTokens: 1,
          inBandTokens: 1,
          unknownTokens: 0,
          bandHistogram: { A1: 1, A2: 0, B1: 0, B2: 0, C1: 0, C2: 0 },
          outOfEnvelopeLemmas: [],
          ceilingExceededLemmas: [],
          questEssentialLemmasMatched: [],
          coverageRatio: 1,
          ratioCheckTokens: 1,
          resolvedTargetLanguageTokens: 1
        },
        worstViolation: null,
        rule: "test",
        violations: [],
        exemptionsApplied: [],
        languageRatioVerdict: conformantRatioVerdict
      });
    const llmClient = {
      generate: vi.fn().mockResolvedValue({ text: "texto simple", requestId: null })
    };
    const services = createServicesStub({
      resolveForExecution: () => ({
        learnerStore: {
          getCurrentProfile: vi
            .fn()
            .mockResolvedValue(createTestLearnerProfile())
        },
        sceneLexiconStore: {
          ensure: vi.fn().mockResolvedValue({
            sceneId: "scene-1",
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
          check: classifierCheck
        },
        llmClient
      })
    });
    const middleware = createSugarLangVerifyMiddleware({
      services: services as never
    });
    const execution = createTestExecution();
    execution.annotations[SUGARLANG_CONSTRAINT_ANNOTATION] = createBaseConstraint({
      rawPrescription: {
        introduce: [],
        reinforce: [],
        avoid: [{ lemmaId: "complicado", lang: "es" }],
        budget: { newItemsAllowed: 0 },
        rationale: {
          candidateSetSize: 0,
          envelopeSurvivorCount: 0,
          priorityScores: [],
          reasons: []
        }
      }
    });

    const result = await middleware.finalize?.(
      execution,
      createTestTurn("texto complicado")
    );

    expect(llmClient.generate).toHaveBeenCalledTimes(1);
    expect(result?.text).toBe("texto simple");
  });

  it("triggers repair on ratio failure even with zero lemma violations (inverted from old pass-through)", async () => {
    const llmClient = {
      generate: vi.fn().mockResolvedValue({ text: "Hola amigo.", requestId: null })
    };
    const classifierCheck = vi
      .fn()
      .mockReturnValueOnce({
        withinEnvelope: true,
        profile: {
          totalTokens: 5,
          knownTokens: 0,
          inBandTokens: 0,
          unknownTokens: 5,
          bandHistogram: { A1: 0, A2: 0, B1: 0, B2: 0, C1: 0, C2: 0 },
          outOfEnvelopeLemmas: [],
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
      })
      .mockReturnValueOnce({
        withinEnvelope: true,
        profile: {
          totalTokens: 2,
          knownTokens: 2,
          inBandTokens: 2,
          unknownTokens: 0,
          bandHistogram: { A1: 2, A2: 0, B1: 0, B2: 0, C1: 0, C2: 0 },
          outOfEnvelopeLemmas: [],
          ceilingExceededLemmas: [],
          questEssentialLemmasMatched: [],
          coverageRatio: 1,
          ratioCheckTokens: 2,
          resolvedTargetLanguageTokens: 2
        },
        worstViolation: null,
        rule: "test",
        violations: [],
        exemptionsApplied: [],
        languageRatioVerdict: {
          measuredRatio: 1,
          directedRatio: 0.85,
          posture: "target-dominant",
          conformance: "conformant"
        }
      });
    const middleware = createSugarLangVerifyMiddleware({
      services: createServicesStub({
        resolveForExecution: () => ({
          learnerStore: {
            getCurrentProfile: vi.fn().mockResolvedValue(createTestLearnerProfile())
          },
          sceneLexiconStore: {
            ensure: vi.fn().mockResolvedValue({
              sceneId: "scene-1",
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

    const result = await middleware.finalize?.(
      execution,
      createTestTurn("I cannot believe this magnificent performance here")
    );

    expect(llmClient.generate).toHaveBeenCalledTimes(1);
    const repairCall = llmClient.generate.mock.calls[0][0];
    expect(repairCall.userPrompt).toContain("85%");
    expect(repairCall.userPrompt).toContain("Spanish");
    expect(result?.text).toBe("Hola amigo.");
  });

  it("triggers coverage-only repair with say-it-simpler instruction when ratio is conformant", async () => {
    const llmClient = {
      generate: vi.fn().mockResolvedValue({ text: "", requestId: null })
    };
    const middleware = createSugarLangVerifyMiddleware({
      services: createServicesStub({
        resolveForExecution: () => ({
          learnerStore: {
            getCurrentProfile: vi.fn().mockResolvedValue(createTestLearnerProfile())
          },
          sceneLexiconStore: {
            ensure: vi.fn().mockResolvedValue({
              sceneId: "scene-1",
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
              withinEnvelope: false,
              profile: {
                totalTokens: 4,
                knownTokens: 1,
                inBandTokens: 1,
                unknownTokens: 3,
                bandHistogram: { A1: 1, A2: 0, B1: 0, B2: 0, C1: 0, C2: 0 },
                outOfEnvelopeLemmas: [],
                ceilingExceededLemmas: [],
                questEssentialLemmasMatched: [],
                coverageRatio: 0.25,
                ratioCheckTokens: 4,
                resolvedTargetLanguageTokens: 3
              },
              worstViolation: null,
              rule: "test",
              violations: [],
              exemptionsApplied: [],
              languageRatioVerdict: {
                measuredRatio: 0.75,
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
    const execution = createTestExecution();
    execution.annotations[SUGARLANG_CONSTRAINT_ANNOTATION] = createBaseConstraint();

    const result = await middleware.finalize?.(execution, createTestTurn("zzzz hola qqqq bienvenidos"));

    expect(llmClient.generate).toHaveBeenCalledTimes(1);
    const repairCall = llmClient.generate.mock.calls[0][0];
    // SAY IT SIMPLER framing is now in the system prompt (083.2); user prompt carries
    // context (ratio goal, vocab constraints) not the individual instruction strings.
    expect(repairCall.systemPrompt).toContain("simpler");
    expect(result?.text).toBe("zzzz hola qqqq bienvenidos");
  });

  it("083.2: N-candidate JSON response -- scorer picks the first passing candidate by index", async () => {
    // LLM returns a JSON array of 3 candidates. All are eagerly scored; only the
    // second (index 1) passes the classifier, so it is selected.
    const candidates = ["primera falla.", "¡Hola amigo!", "otra versión."];
    const llmClient = {
      generate: vi.fn().mockResolvedValue({
        text: JSON.stringify(candidates),
        requestId: null
      })
    };
    const failProfile = {
      totalTokens: 5,
      knownTokens: 0,
      inBandTokens: 0,
      unknownTokens: 5,
      bandHistogram: { A1: 0, A2: 0, B1: 0, B2: 0, C1: 0, C2: 0 },
      outOfEnvelopeLemmas: [],
      ceilingExceededLemmas: [],
      questEssentialLemmasMatched: [],
      coverageRatio: 0,
      ratioCheckTokens: 5,
      resolvedTargetLanguageTokens: 0
    };
    const passProfile = {
      totalTokens: 2,
      knownTokens: 2,
      inBandTokens: 2,
      unknownTokens: 0,
      bandHistogram: { A1: 2, A2: 0, B1: 0, B2: 0, C1: 0, C2: 0 },
      outOfEnvelopeLemmas: [],
      ceilingExceededLemmas: [],
      questEssentialLemmasMatched: [],
      coverageRatio: 1,
      ratioCheckTokens: 2,
      resolvedTargetLanguageTokens: 2
    };
    const ratioVerdictUnder = { measuredRatio: 0, directedRatio: 0.85, posture: "target-dominant", conformance: "under-ratio" };
    const ratioVerdictPass = { measuredRatio: 1, directedRatio: 0.85, posture: "target-dominant", conformance: "conformant" };
    const classifierCheck = vi
      .fn()
      // original
      .mockReturnValueOnce({ withinEnvelope: false, profile: failProfile, worstViolation: null, rule: "test", violations: [], exemptionsApplied: [], languageRatioVerdict: ratioVerdictUnder })
      // candidate 0 -- fails
      .mockReturnValueOnce({ withinEnvelope: false, profile: failProfile, worstViolation: null, rule: "test", violations: [], exemptionsApplied: [], languageRatioVerdict: ratioVerdictUnder })
      // candidate 1 -- passes
      .mockReturnValueOnce({ withinEnvelope: true, profile: passProfile, worstViolation: null, rule: "test", violations: [], exemptionsApplied: [], languageRatioVerdict: ratioVerdictPass })
      // candidate 2 -- doesn't matter
      .mockReturnValueOnce({ withinEnvelope: true, profile: passProfile, worstViolation: null, rule: "test", violations: [], exemptionsApplied: [], languageRatioVerdict: ratioVerdictPass });

    const middleware = createSugarLangVerifyMiddleware({
      services: createServicesStub({
        resolveForExecution: () => ({
          learnerStore: { getCurrentProfile: vi.fn().mockResolvedValue(createTestLearnerProfile()) },
          sceneLexiconStore: { ensure: vi.fn().mockResolvedValue({ sceneId: "scene-1", contentHash: "hash", pipelineVersion: "v1", atlasVersion: "v1", profile: "runtime-preview", lemmas: {}, properNouns: [], anchors: [], questEssentialLemmas: [] }) },
          classifier: { check: classifierCheck },
          llmClient
        })
      }) as never
    });
    const execution = createTestExecution();
    execution.annotations[SUGARLANG_CONSTRAINT_ANNOTATION] = createBaseConstraint({ supportPosture: "target-dominant", targetLanguageRatio: 0.85 });

    const result = await middleware.finalize?.(execution, createTestTurn("I only speak English today."));

    expect(llmClient.generate).toHaveBeenCalledTimes(1);
    expect(result?.text).toBe("¡Hola amigo!");
  });

  it("083.2: ratio-only failure with no passing candidate returns best-scoring candidate over original", async () => {
    // directedRatio=1.0 (target-only), failFloor=0.7. Original is all-English (score=0).
    // Repair candidate has measuredRatio=0.5 -- still under-ratio but score=0.5 > 0.
    // repairWithBestOfN returns the candidate with selectedPasses=false.
    // violations.length===0 so autoSimplify is a no-op; candidate is the terminal result.
    const repairCandidate = "Un poco en español hoy.";
    const llmClient = {
      generate: vi.fn().mockResolvedValue({ text: repairCandidate, requestId: null })
    };
    const classifierCheck = vi
      .fn()
      .mockReturnValueOnce({
        withinEnvelope: false,
        profile: { totalTokens: 5, knownTokens: 0, inBandTokens: 0, unknownTokens: 5, bandHistogram: { A1: 0, A2: 0, B1: 0, B2: 0, C1: 0, C2: 0 }, outOfEnvelopeLemmas: [], ceilingExceededLemmas: [], questEssentialLemmasMatched: [], coverageRatio: 0, ratioCheckTokens: 5, resolvedTargetLanguageTokens: 0 },
        worstViolation: null, rule: "test", violations: [], exemptionsApplied: [],
        languageRatioVerdict: { measuredRatio: 0, directedRatio: 1.0, posture: "target-only", conformance: "under-ratio" }
      })
      .mockReturnValueOnce({
        withinEnvelope: false,
        profile: { totalTokens: 5, knownTokens: 3, inBandTokens: 3, unknownTokens: 2, bandHistogram: { A1: 3, A2: 0, B1: 0, B2: 0, C1: 0, C2: 0 }, outOfEnvelopeLemmas: [], ceilingExceededLemmas: [], questEssentialLemmasMatched: [], coverageRatio: 0.6, ratioCheckTokens: 5, resolvedTargetLanguageTokens: 3 },
        worstViolation: null, rule: "test", violations: [], exemptionsApplied: [],
        languageRatioVerdict: { measuredRatio: 0.6, directedRatio: 1.0, posture: "target-only", conformance: "under-ratio" }
      });

    const middleware = createSugarLangVerifyMiddleware({
      services: createServicesStub({
        resolveForExecution: () => ({
          learnerStore: { getCurrentProfile: vi.fn().mockResolvedValue(createTestLearnerProfile()) },
          sceneLexiconStore: { ensure: vi.fn().mockResolvedValue({ sceneId: "scene-1", contentHash: "hash", pipelineVersion: "v1", atlasVersion: "v1", profile: "runtime-preview", lemmas: {}, properNouns: [], anchors: [], questEssentialLemmas: [] }) },
          classifier: { check: classifierCheck },
          llmClient
        })
      }) as never
    });
    const execution = createTestExecution();
    execution.annotations[SUGARLANG_CONSTRAINT_ANNOTATION] = createBaseConstraint({ supportPosture: "target-only", targetLanguageRatio: 1.0 });

    const result = await middleware.finalize?.(execution, createTestTurn("I only speak English today."));

    expect(llmClient.generate).toHaveBeenCalledTimes(1);
    expect(result?.text).toBe(repairCandidate);
    expect(result?.text).not.toBe("I only speak English today.");
  });

  it("083.2: lemma-violation with empty LLM response falls through to autoSimplify", async () => {
    // LLM returns empty string -> parseCandidates returns [] -> repairWithBestOfN returns null.
    // Original has a lemma violation; autoSimplify substitutes it.
    const llmClient = {
      generate: vi.fn().mockResolvedValue({ text: "", requestId: null })
    };
    const middleware = createSugarLangVerifyMiddleware({
      services: createServicesStub({
        resolveForExecution: () => ({
          learnerStore: { getCurrentProfile: vi.fn().mockResolvedValue(createTestLearnerProfile()) },
          sceneLexiconStore: { ensure: vi.fn().mockResolvedValue({ sceneId: "scene-1", contentHash: "hash", pipelineVersion: "v1", atlasVersion: "v1", profile: "runtime-preview", lemmas: {}, properNouns: [], anchors: [], questEssentialLemmas: [] }) },
          classifier: {
            check: vi.fn().mockReturnValue({
              withinEnvelope: false,
              profile: { totalTokens: 2, knownTokens: 0, inBandTokens: 0, unknownTokens: 2, bandHistogram: { A1: 0, A2: 0, B1: 0, B2: 0, C1: 0, C2: 0 }, outOfEnvelopeLemmas: [{ lemmaId: "adelante", surfaceForm: "adelante", lang: "es" }], ceilingExceededLemmas: [], questEssentialLemmasMatched: [], coverageRatio: 0, ratioCheckTokens: 2, resolvedTargetLanguageTokens: 0 },
              worstViolation: null, rule: "test",
              violations: [{ lemmaRef: { lemmaId: "adelante", surfaceForm: "adelante", lang: "es" }, surfaceForm: "adelante", cefrBand: "B1", reason: "out-of-band" }],
              exemptionsApplied: [],
              languageRatioVerdict: { measuredRatio: 0.5, directedRatio: 0.65, posture: "supported", conformance: "conformant" }
            })
          },
          llmClient
        })
      }) as never
    });
    const execution = createTestExecution();
    execution.annotations[SUGARLANG_CONSTRAINT_ANNOTATION] = createBaseConstraint();

    const result = await middleware.finalize?.(execution, createTestTurn("Hola, adelante."));

    expect(llmClient.generate).toHaveBeenCalledTimes(1);
    // autoSimplify substituted "adelante" since repair returned nothing
    expect(result?.text?.toLowerCase()).not.toContain("adelante");
  });

  it("083.2: code-fenced JSON response is parsed correctly (live regression)", async () => {
    // Regression: LLM wraps JSON in ```json ... ``` fences; parseCandidates must
    // strip them before JSON.parse, else the raw fence string becomes the reply.
    const candidates = ["¡Hola amigo!", "Buenos dias.", "Que tal."];
    const fencedResponse = "```json\n" + JSON.stringify(candidates) + "\n```";
    const llmClient = {
      generate: vi.fn().mockResolvedValue({ text: fencedResponse, requestId: null })
    };
    const failVerdict = {
      withinEnvelope: false,
      profile: { totalTokens: 5, knownTokens: 0, inBandTokens: 0, unknownTokens: 5, bandHistogram: { A1: 0, A2: 0, B1: 0, B2: 0, C1: 0, C2: 0 }, outOfEnvelopeLemmas: [], ceilingExceededLemmas: [], questEssentialLemmasMatched: [], coverageRatio: 0, ratioCheckTokens: 5, resolvedTargetLanguageTokens: 0 },
      worstViolation: null, rule: "test", violations: [], exemptionsApplied: [],
      languageRatioVerdict: { measuredRatio: 0, directedRatio: 0.85, posture: "target-dominant", conformance: "under-ratio" }
    };
    const passVerdict = {
      withinEnvelope: true,
      profile: { totalTokens: 2, knownTokens: 2, inBandTokens: 2, unknownTokens: 0, bandHistogram: { A1: 2, A2: 0, B1: 0, B2: 0, C1: 0, C2: 0 }, outOfEnvelopeLemmas: [], ceilingExceededLemmas: [], questEssentialLemmasMatched: [], coverageRatio: 1, ratioCheckTokens: 2, resolvedTargetLanguageTokens: 2 },
      worstViolation: null, rule: "test", violations: [], exemptionsApplied: [],
      languageRatioVerdict: { measuredRatio: 1, directedRatio: 0.85, posture: "target-dominant", conformance: "conformant" }
    };
    // original fail + 3 candidates (all scored before first-pass selection)
    const classifierCheck = vi
      .fn()
      .mockReturnValueOnce(failVerdict)   // original
      .mockReturnValueOnce(passVerdict)   // candidate 0 -- passes
      .mockReturnValueOnce(passVerdict)   // candidate 1
      .mockReturnValueOnce(passVerdict);  // candidate 2
    const middleware = createSugarLangVerifyMiddleware({
      services: createServicesStub({
        resolveForExecution: () => ({
          learnerStore: { getCurrentProfile: vi.fn().mockResolvedValue(createTestLearnerProfile()) },
          sceneLexiconStore: { ensure: vi.fn().mockResolvedValue({ sceneId: "scene-1", contentHash: "hash", pipelineVersion: "v1", atlasVersion: "v1", profile: "runtime-preview", lemmas: {}, properNouns: [], anchors: [], questEssentialLemmas: [] }) },
          classifier: { check: classifierCheck },
          llmClient
        })
      }) as never
    });
    const execution = createTestExecution();
    execution.annotations[SUGARLANG_CONSTRAINT_ANNOTATION] = createBaseConstraint({ supportPosture: "target-dominant", targetLanguageRatio: 0.85 });

    const result = await middleware.finalize?.(execution, createTestTurn("I only speak English today."));

    // Must resolve to the first candidate, NOT the raw fenced JSON string.
    expect(result?.text).toBe("¡Hola amigo!");
    expect(result?.text).not.toContain("```");
  });

  it("083.2: verify-pass path makes zero LLM calls (turn-budget guard)", async () => {
    const llmClient = { generate: vi.fn() };
    const middleware = createSugarLangVerifyMiddleware({
      services: createServicesStub({
        resolveForExecution: () => ({
          learnerStore: { getCurrentProfile: vi.fn().mockResolvedValue(createTestLearnerProfile()) },
          sceneLexiconStore: { ensure: vi.fn().mockResolvedValue({ sceneId: "scene-1", contentHash: "hash", pipelineVersion: "v1", atlasVersion: "v1", profile: "runtime-preview", lemmas: {}, properNouns: [], anchors: [], questEssentialLemmas: [] }) },
          classifier: {
            check: vi.fn().mockReturnValue({
              withinEnvelope: true,
              profile: { totalTokens: 2, knownTokens: 2, inBandTokens: 2, unknownTokens: 0, bandHistogram: { A1: 2, A2: 0, B1: 0, B2: 0, C1: 0, C2: 0 }, outOfEnvelopeLemmas: [], ceilingExceededLemmas: [], questEssentialLemmasMatched: [], coverageRatio: 1, ratioCheckTokens: 2, resolvedTargetLanguageTokens: 2 },
              worstViolation: null, rule: "test", violations: [], exemptionsApplied: [],
              languageRatioVerdict: { measuredRatio: 1, directedRatio: 0.65, posture: "supported", conformance: "conformant" }
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
              sceneId: "scene-1",
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
                measuredRatio: 1,
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
          sceneLexiconStore: { ensure: vi.fn().mockResolvedValue({ sceneId: "scene-1", contentHash: "hash", pipelineVersion: "v1", atlasVersion: "v1", profile: "runtime-preview", lemmas: {}, properNouns: [], anchors: [], questEssentialLemmas: [] }) },
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
          sceneLexiconStore: { ensure: vi.fn().mockResolvedValue({ sceneId: "scene-1", contentHash: "hash", pipelineVersion: "v1", atlasVersion: "v1", profile: "runtime-preview", lemmas: {}, properNouns: [], anchors: [], questEssentialLemmas: [] }) },
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

  it("083.4: among passing candidates, prefers the one retaining voice markers", async () => {
    // Two passing candidates: index 0 strips the interjection, index 1 keeps it.
    // Voice-aware selection should pick index 1.
    const candidates = ["Buenas tardes, amigo.", "¡Ay! Buenas tardes, amigo."];
    const llmClient = {
      generate: vi.fn().mockResolvedValue({ text: JSON.stringify(candidates), requestId: null })
    };
    const passProfile = {
      totalTokens: 3, knownTokens: 3, inBandTokens: 3, unknownTokens: 0,
      bandHistogram: { A1: 3, A2: 0, B1: 0, B2: 0, C1: 0, C2: 0 },
      outOfEnvelopeLemmas: [], ceilingExceededLemmas: [], questEssentialLemmasMatched: [],
      coverageRatio: 1, ratioCheckTokens: 3, resolvedTargetLanguageTokens: 3
    };
    const ratioPass = { measuredRatio: 1, directedRatio: 0.85, posture: "target-dominant", conformance: "conformant" };
    const classifierCheck = vi.fn()
      .mockReturnValueOnce({ withinEnvelope: false, profile: passProfile, worstViolation: null, rule: "test", violations: [{ lemmaRef: { lemmaId: "x", lang: "es" }, surfaceForm: "x", cefrBand: "unknown", reason: "test" }], exemptionsApplied: [], languageRatioVerdict: { measuredRatio: 0.2, directedRatio: 0.85, posture: "target-dominant", conformance: "under-ratio" } })
      .mockReturnValue({ withinEnvelope: true, profile: passProfile, worstViolation: null, rule: "test", violations: [], exemptionsApplied: [], languageRatioVerdict: ratioPass });

    const voiceSpec = { interjections: ["ay"], hasGestureTags: false };
    const middleware = createSugarLangVerifyMiddleware({
      services: createServicesStub({
        resolveForExecution: () => ({
          learnerStore: { getCurrentProfile: vi.fn().mockResolvedValue(createTestLearnerProfile()) },
          sceneLexiconStore: { ensure: vi.fn().mockResolvedValue({
            sceneId: "scene-1", contentHash: "hash", pipelineVersion: "v1",
            atlasVersion: "v1", profile: "runtime-preview",
            lemmas: {}, properNouns: [], anchors: [], questEssentialLemmas: [],
            npcVoiceSpecs: { "npc-test": voiceSpec }
          }) },
          classifier: { check: classifierCheck },
          llmClient
        })
      }) as never
    });
    const execution = createTestExecution();
    execution.selection = { ...execution.selection, npcDefinitionId: "npc-test" };
    execution.annotations[SUGARLANG_CONSTRAINT_ANNOTATION] = createBaseConstraint({ supportPosture: "target-dominant", targetLanguageRatio: 0.85 });

    const result = await middleware.finalize?.(execution, createTestTurn("The original text here."));

    expect(result?.text).toBe("¡Ay! Buenas tardes, amigo.");
  });
});
