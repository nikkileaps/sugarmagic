/**
 * packages/plugins/src/catalog/sugarlang/runtime/middlewares/sugar-lang-context-middleware.ts
 *
 * Purpose: Reserves the context-stage middleware that prescribes lexical budgets and activates placement flow state.
 *
 * Exports:
 *   - createSugarLangContextMiddleware
 *
 * Relationships:
 *   - Depends on the ConversationMiddleware interface and sugarlang config.
 *   - Will write `sugarlang.prescription` and `sugarlang.placementFlow` annotations in Epic 10.
 *
 * Implements: Proposal 001 §End-to-End Turn Flow / §Placement Interaction Contract
 *
 * Status: skeleton (no implementation yet; see Epic 10)
 */

import type { ConversationMiddleware } from "@sugarmagic/runtime-core";
import type { SugarLangPluginConfig } from "../../config";

export function createSugarLangContextMiddleware(
  _config: SugarLangPluginConfig
): ConversationMiddleware {
  return {
    middlewareId: "sugarlang.context",
    displayName: "Sugarlang Context Middleware",
    priority: 10,
    stage: "context",
    prepare() {
      throw new Error("TODO: Epic 10");
    }
  };
}
