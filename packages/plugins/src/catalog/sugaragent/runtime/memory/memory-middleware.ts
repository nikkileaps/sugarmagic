/**
 * packages/plugins/src/catalog/sugaragent/runtime/memory/memory-middleware.ts
 *
 * Purpose: sugaragent's first `conversation.middleware` contribution
 * (Plan 073 §D6). A CONTEXT-stage middleware that, once per
 * conversation, loads the NPC's memory record, builds the digest, and
 * memoizes both in `execution.state` (which persists across turns).
 * Every turn it republishes a compact annotation (metCount /
 * first-meeting / hasMemory) onto `execution.annotations`.
 *
 * ## Why a middleware, and why the CONTEXT stage
 *
 * The first-meeting decision (sugarlang's minimal-greeting, 073.4)
 * runs in a POLICY-stage middleware's `prepare`, and ALL middleware
 * prepares run BEFORE `provider.startSession`. So a startSession-time
 * load could never feed the greeting decision on the only turn it
 * exists for. A context-stage middleware runs before the policy stage,
 * so its annotation is visible to sugarlang regardless of priority.
 * The provider and stages then read the memoized record from state —
 * there is NO separate startSession load.
 *
 * Load-once is a hard rule (Plan 073 §D4): the digest must be
 * byte-stable within a session, so we read the record exactly once and
 * freeze it. A previous conversation's summarizer landing mid-session
 * does not re-load or mutate it.
 *
 * Implements: Plan 073 §073.3 (D6)
 *
 * Status: active
 */

import type {
  ConversationExecutionContext,
  ConversationMiddleware
} from "@sugarmagic/runtime-core";
import type { SugarAgentLogger } from "../logger";
import {
  buildMemoryAnnotation,
  buildMemoryDigest,
  DEFAULT_MEMORY_DIGEST_MAX_CHARS,
  MEMORY_ANNOTATION_KEY,
  MEMORY_STATE_KEY,
  type MemoizedNpcMemory
} from "./digest";
import type { NpcMemoryStore } from "./npc-memory-store";
import { resolveNpcMemoryStore } from "./store-registry";

export const NPC_MEMORY_MIDDLEWARE_ID = "sugaragent.memory";

function isAgentSelection(
  selection: ConversationExecutionContext["selection"]
): boolean {
  return (
    selection.conversationKind === "free-form" &&
    typeof selection.npcDefinitionId === "string" &&
    selection.npcDefinitionId.length > 0
  );
}

export interface NpcMemoryMiddlewareOptions {
  logger?: SugarAgentLogger;
  /** Hard cap on the digest text. Defaults to the module default. */
  digestMaxChars?: number;
  /** Store resolver seam (tests inject a store). Defaults to the
   *  process-wide `resolveNpcMemoryStore`. */
  resolveStore?: () => NpcMemoryStore | null;
}

/**
 * Load the memory record once, memoize record + digest in
 * `execution.state`. Safe to call every turn: after the first load it
 * returns the memoized value untouched (byte-stable digest).
 */
async function ensureMemoizedMemory(
  execution: ConversationExecutionContext,
  options: NpcMemoryMiddlewareOptions
): Promise<MemoizedNpcMemory> {
  const existing = execution.state[MEMORY_STATE_KEY] as
    | MemoizedNpcMemory
    | undefined;
  if (existing) return existing;

  const npcDefinitionId = execution.selection.npcDefinitionId as string;
  const resolveStore = options.resolveStore ?? (() => resolveNpcMemoryStore());
  const store = resolveStore();

  let record = null;
  if (store) {
    try {
      record = await store.load(npcDefinitionId);
    } catch (error) {
      options.logger?.logPluginEvent("memory-load-failed", {
        npcDefinitionId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  const memoized: MemoizedNpcMemory = {
    record,
    digest: buildMemoryDigest(
      record,
      options.digestMaxChars ?? DEFAULT_MEMORY_DIGEST_MAX_CHARS
    ),
    metCount: record?.metCount ?? 0
  };
  execution.state[MEMORY_STATE_KEY] = memoized;
  options.logger?.logPluginEvent("memory-loaded", {
    npcDefinitionId,
    metCount: memoized.metCount,
    hasDigest: memoized.digest.length > 0
  });
  return memoized;
}

/**
 * The context-stage NPC memory middleware. Priority 10 keeps it early
 * within the context stage; correctness does not depend on it (the
 * context stage already precedes the policy stage that consumes the
 * annotation).
 */
export function createNpcMemoryMiddleware(
  options: NpcMemoryMiddlewareOptions = {}
): ConversationMiddleware {
  return {
    middlewareId: NPC_MEMORY_MIDDLEWARE_ID,
    displayName: "SugarAgent NPC Memory",
    priority: 10,
    stage: "context",
    async prepare(execution) {
      if (!isAgentSelection(execution.selection)) return execution;
      const memoized = await ensureMemoizedMemory(execution, options);
      // Annotations reset each turn — republish from the memoized
      // record so the policy stage (sugarlang, 073.4) sees it.
      execution.annotations[MEMORY_ANNOTATION_KEY] =
        buildMemoryAnnotation(memoized);
      return execution;
    }
  };
}
