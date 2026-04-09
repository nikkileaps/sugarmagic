/**
 * packages/plugins/src/catalog/sugarlang/runtime/middlewares/sugar-lang-observe-middleware.ts
 *
 * Purpose: Reserves the analysis-stage middleware that collects observations and updates learner state.
 *
 * Exports:
 *   - createSugarLangObserveMiddleware
 *
 * Relationships:
 *   - Depends on the ConversationMiddleware interface and sugarlang config.
 *   - Will write `sugarlang.observation` and learner-state updates in Epic 10.
 *
 * Implements: Proposal 001 §End-to-End Turn Flow / §Implicit Signal Collection
 *
 * Status: skeleton (no implementation yet; see Epic 10)
 */

import type { ConversationMiddleware } from "@sugarmagic/runtime-core";
import type { SugarLangPluginConfig } from "../../config";

export function createSugarLangObserveMiddleware(
  _config: SugarLangPluginConfig
): ConversationMiddleware {
  return {
    middlewareId: "sugarlang.observe",
    displayName: "Sugarlang Observe Middleware",
    priority: 90,
    stage: "analysis",
    finalize() {
      throw new Error("TODO: Epic 10");
    }
  };
}
