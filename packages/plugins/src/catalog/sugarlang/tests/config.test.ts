/**
 * packages/plugins/src/catalog/sugarlang/tests/config.test.ts
 *
 * Purpose: Verifies Sugarlang config normalization, including Epic 11 placement settings.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Depends on ../config.
 *   - Guards the plugin-owned placement config defaults and environment-driven debug flag.
 *
 * Implements: Epic 11 Story 11.6
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import { normalizeSugarLangPluginConfig } from "../config";

describe("normalizeSugarLangPluginConfig", () => {
  it("fills missing placement fields with sensible defaults", () => {
    expect(normalizeSugarLangPluginConfig(undefined)).toEqual({
      targetLanguage: "",
      supportLanguage: "en",
      debugLogging: false,
      verifyEnabled: false,
      chunkExtraction: {
        enabled: true
      },
      placement: {
        enabled: true,
        minAnswersForValid: "use-bank-default",
        confidenceFloor: 0.3,
        openingDialogTurns: 2,
        closingDialogTurns: 2
      }
    });
  });

  it("normalizes placement overrides and reads the plugin-scoped debug env var", () => {
    expect(
      normalizeSugarLangPluginConfig(
        {
          placement: {
            enabled: false,
            minAnswersForValid: 4.8,
            confidenceFloor: 1.4,
            openingDialogTurns: 3.2,
            closingDialogTurns: 0
          }
        },
        {
          SUGARMAGIC_SUGARLANG_DEBUG_LOGGING: "1"
        }
      )
    ).toEqual({
      targetLanguage: "",
      supportLanguage: "en",
      debugLogging: true,
      verifyEnabled: false,
      chunkExtraction: {
        enabled: true
      },
      placement: {
        enabled: false,
        minAnswersForValid: 4,
        confidenceFloor: 0.95,
        openingDialogTurns: 3,
        closingDialogTurns: 1
      }
    });
  });

  it("keeps verify disabled by default but allows an environment opt-in", () => {
    expect(
      normalizeSugarLangPluginConfig(undefined, {
        SUGARMAGIC_SUGARLANG_VERIFY_ENABLED: "true"
      })
    ).toEqual(
      expect.objectContaining({
        verifyEnabled: true
      })
    );
  });
});
