/**
 * Plan 075.3 -- moderation middleware (two checkpoints)
 *
 * prepare (policy stage): checks player input before the pipeline starts.
 *   - Calls /api/sugaragent/generate/moderate against the player's text.
 *   - If flagged: annotates the context with MODERATION_INPUT_FLAG_KEY.
 *     The pipeline can see this annotation; the InterpretStage uses it
 *     to substitute an in-character deflection intent.
 *   - Fail-open on errors: the annotation is not set, the pipeline proceeds.
 *
 * finalize (policy stage, ordered AFTER sugarlang.verify): moderates whatever
 *   text the player actually sees, from any provider. If flagged: replaces the
 *   turn text with an in-character deflection line.
 *   - Fail-open on errors: returns the original turn unchanged.
 *
 * Status: active
 */

import type {
  ConversationExecutionContext,
  ConversationMiddleware,
  ConversationTurnEnvelope
} from "@sugarmagic/runtime-core";
import type { ModerationProvider } from "../clients";

export const MODERATION_MIDDLEWARE_ID = "sugaragent.moderation";
export const MODERATION_INPUT_FLAG_KEY = "sugaragent.moderationInputFlagged";

const INPUT_DEFLECTIONS = [
  "Hmm, I'm not sure how to respond to that.",
  "That's not something I can really help with right now.",
  "I'd rather talk about something else, if that's alright."
];

const OUTPUT_DEFLECTIONS = [
  "Sorry, I can't quite say that -- let me think of another way to put it.",
  "I'm not sure that came out right. Can we try again?",
  "Hmm, I think I got a bit turned around there."
];

function pickDeflection(pool: string[], seed: string): string {
  const idx = seed.length % pool.length;
  return pool[idx] ?? pool[0]!;
}

export interface ModerationMiddlewareOptions {
  moderationProvider: ModerationProvider | null;
  enabled: boolean;
}

export function createModerationMiddleware(
  options: ModerationMiddlewareOptions
): ConversationMiddleware {
  const { moderationProvider, enabled } = options;

  return {
    middlewareId: MODERATION_MIDDLEWARE_ID,
    displayName: "SugarAgent Moderation",
    priority: 20,
    stage: "policy",

    async prepare(
      context: ConversationExecutionContext
    ): Promise<ConversationExecutionContext> {
      if (!enabled || !moderationProvider) return context;

      const playerText =
        context.input?.kind === "free_text" ? context.input.text.trim() : "";

      if (!playerText) return context;

      try {
        const result = await moderationProvider.moderate({ text: playerText });
        if (result.flagged || result.blocklisted) {
          return {
            ...context,
            annotations: {
              ...context.annotations,
              [MODERATION_INPUT_FLAG_KEY]: {
                flagged: true,
                categories: result.categories,
                blocklisted: result.blocklisted
              }
            }
          };
        }
      } catch {
        // Fail-open: don't gate on moderation outage.
      }

      return context;
    },

    async finalize(
      context: ConversationExecutionContext,
      turn: ConversationTurnEnvelope | null
    ): Promise<ConversationTurnEnvelope | null> {
      if (!enabled || !moderationProvider || !turn) return turn;

      // Check if input was already flagged -- if so, replace with in-character deflection.
      const inputFlagged = context.annotations[MODERATION_INPUT_FLAG_KEY];
      if (inputFlagged) {
        const deflection = pickDeflection(INPUT_DEFLECTIONS, turn.text ?? "");
        return { ...turn, text: deflection };
      }

      const outputText = turn.text?.trim() ?? "";
      if (!outputText) return turn;

      try {
        const result = await moderationProvider.moderate({ text: outputText });
        if (result.flagged || result.blocklisted) {
          const deflection = pickDeflection(OUTPUT_DEFLECTIONS, outputText);
          return { ...turn, text: deflection };
        }
      } catch {
        // Fail-open.
      }

      return turn;
    }
  };
}
