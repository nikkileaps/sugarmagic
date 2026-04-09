/**
 * packages/plugins/src/catalog/sugarlang/runtime/middlewares/sugar-lang-director-middleware.ts
 *
 * Purpose: Reserves the policy-stage middleware that invokes the Director and writes merged constraints.
 *
 * Exports:
 *   - createSugarLangDirectorMiddleware
 *
 * Relationships:
 *   - Depends on the ConversationMiddleware interface and sugarlang config.
 *   - Will read `sugarlang.prescription` and write `sugarlang.directive` and `sugarlang.constraint` annotations in Epic 10.
 *
 * Implements: Proposal 001 §End-to-End Turn Flow
 *
 * Status: skeleton (no implementation yet; see Epic 10)
 */

import type { ConversationMiddleware } from "@sugarmagic/runtime-core";
import type { SugarLangPluginConfig } from "../../config";

export function createSugarLangDirectorMiddleware(
  _config: SugarLangPluginConfig
): ConversationMiddleware {
  return {
    middlewareId: "sugarlang.director",
    displayName: "Sugarlang Director Middleware",
    priority: 30,
    stage: "policy",
    prepare() {
      throw new Error("TODO: Epic 10");
    }
  };
}
