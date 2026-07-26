/**
 * packages/plugins/src/catalog/sugarlang/tests/middlewares/execution-gates.test.ts
 *
 * Purpose: Verifies that shouldRunSugarlangForExecution and isScriptedMode
 *          gate on conversationKind, covering all five entry paths.
 *
 * Entry paths tested:
 *   1. interact-agent  -- free-form + npcDefinitionId (NPC free-form conversation)
 *   2. interact-scripted -- free-form NPC defined as scripted, starts scripted-dialogue
 *   3. followup .start -- scripted-dialogue, no interactionMode
 *   4. quest .start    -- scripted-dialogue, no interactionMode
 *   5. spell .start    -- scripted-dialogue, no interactionMode
 *
 * Implements: Story 081.3 structural guard
 *
 * Status: active
 */

import { describe, it, expect } from "vitest";
import {
  shouldRunSugarlangForExecution,
  isScriptedMode
} from "../../runtime/middlewares/shared";
import { createTestExecution } from "./test-helpers";

describe("shouldRunSugarlangForExecution", () => {
  it("path 1 (interact-agent): returns true for free-form with npcDefinitionId", () => {
    const execution = createTestExecution({
      selection: {
        conversationKind: "free-form",
        npcDefinitionId: "npc-1",
        npcDisplayName: "Marisol",
        targetLanguage: "es",
        supportLanguage: "en",
        metadata: {}
      }
    });
    expect(shouldRunSugarlangForExecution(execution)).toBe(true);
  });

  it("path 2 (interact-scripted): returns true for scripted-dialogue with interactionMode scripted", () => {
    const execution = createTestExecution({
      selection: {
        conversationKind: "scripted-dialogue",
        npcDefinitionId: "npc-1",
        npcDisplayName: "Marisol",
        interactionMode: "scripted",
        dialogueDefinitionId: "dlg-1",
        targetLanguage: "es",
        supportLanguage: "en",
        metadata: {}
      }
    });
    expect(shouldRunSugarlangForExecution(execution)).toBe(true);
  });

  it("path 3 (followup .start): returns true for scripted-dialogue with no interactionMode", () => {
    const execution = createTestExecution({
      selection: {
        conversationKind: "scripted-dialogue",
        dialogueDefinitionId: "followup-dlg-1",
        targetLanguage: "es",
        supportLanguage: "en",
        metadata: {}
      }
    });
    expect(shouldRunSugarlangForExecution(execution)).toBe(true);
  });

  it("path 4 (quest .start): returns true for scripted-dialogue with no interactionMode", () => {
    const execution = createTestExecution({
      selection: {
        conversationKind: "scripted-dialogue",
        dialogueDefinitionId: "quest-dlg-1",
        targetLanguage: "es",
        supportLanguage: "en",
        metadata: {}
      }
    });
    expect(shouldRunSugarlangForExecution(execution)).toBe(true);
  });

  it("path 5 (spell .start): returns true for scripted-dialogue with no interactionMode", () => {
    const execution = createTestExecution({
      selection: {
        conversationKind: "scripted-dialogue",
        dialogueDefinitionId: "spell-dlg-1",
        targetLanguage: "es",
        supportLanguage: "en",
        metadata: {}
      }
    });
    expect(shouldRunSugarlangForExecution(execution)).toBe(true);
  });

  it("returns false for free-form without npcDefinitionId", () => {
    const execution = createTestExecution({
      selection: {
        conversationKind: "free-form",
        npcDefinitionId: undefined,
        targetLanguage: "es",
        supportLanguage: "en",
        metadata: {}
      }
    });
    expect(shouldRunSugarlangForExecution(execution)).toBe(false);
  });
});

describe("isScriptedMode", () => {
  it("returns true for scripted-dialogue (paths 2-5)", () => {
    const execution = createTestExecution({
      selection: {
        conversationKind: "scripted-dialogue",
        dialogueDefinitionId: "dlg-1",
        targetLanguage: "es",
        supportLanguage: "en",
        metadata: {}
      }
    });
    expect(isScriptedMode(execution)).toBe(true);
  });

  it("returns false for free-form (path 1)", () => {
    const execution = createTestExecution({
      selection: {
        conversationKind: "free-form",
        npcDefinitionId: "npc-1",
        npcDisplayName: "Marisol",
        targetLanguage: "es",
        supportLanguage: "en",
        metadata: {}
      }
    });
    expect(isScriptedMode(execution)).toBe(false);
  });

  it("is not fooled by interactionMode: scripted when conversationKind is free-form", () => {
    const execution = createTestExecution({
      selection: {
        conversationKind: "free-form",
        npcDefinitionId: "npc-1",
        interactionMode: "scripted",
        targetLanguage: "es",
        supportLanguage: "en",
        metadata: {}
      }
    });
    expect(isScriptedMode(execution)).toBe(false);
  });
});
