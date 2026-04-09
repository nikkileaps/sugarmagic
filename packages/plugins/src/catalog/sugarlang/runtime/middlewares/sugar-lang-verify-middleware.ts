/**
 * packages/plugins/src/catalog/sugarlang/runtime/middlewares/sugar-lang-verify-middleware.ts
 *
 * Purpose: Reserves the analysis-stage middleware that verifies generated turns against the comprehension envelope.
 *
 * Exports:
 *   - createSugarLangVerifyMiddleware
 *
 * Relationships:
 *   - Depends on the ConversationMiddleware interface and sugarlang config.
 *   - Will read `sugarlang.constraint` and `sugarlang.directive` annotations in Epic 10.
 *
 * Implements: Proposal 001 §End-to-End Turn Flow
 *
 * Status: skeleton (no implementation yet; see Epic 10)
 */

import type { ConversationMiddleware } from "@sugarmagic/runtime-core";
import type { SugarLangPluginConfig } from "../../config";

export function createSugarLangVerifyMiddleware(
  _config: SugarLangPluginConfig
): ConversationMiddleware {
  return {
    middlewareId: "sugarlang.verify",
    displayName: "Sugarlang Verify Middleware",
    priority: 20,
    stage: "analysis",
    finalize() {
      throw new Error("TODO: Epic 10");
    }
  };
}
