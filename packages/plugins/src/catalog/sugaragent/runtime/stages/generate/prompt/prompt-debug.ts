/**
 * packages/plugins/src/catalog/sugaragent/runtime/stages/generate/prompt/prompt-debug.ts
 *
 * Purpose: Troubleshooting affordance for the constructed NPC prompt. When
 * debugLogging is on, prints the full system + user prompt to the console in a
 * readable block AND stashes the last few on `window.__sugaragentPrompts` so
 * they can be inspected programmatically (by a dev in devtools, or by an
 * automated browser session) without scrolling the console.
 *
 * Exports:
 *   - SUGARAGENT_PROMPTS_WINDOW_KEY
 *   - dumpConstructedPrompt
 *
 * Relationships:
 *   - Called by GenerateStage right after buildGeneratePrompt, gated by
 *     `context.config.debugLogging`.
 *
 * Status: active
 */

export const SUGARAGENT_PROMPTS_WINDOW_KEY = "__sugaragentPrompts";

const MAX_RETAINED_PROMPTS = 20;

export interface ConstructedPromptDump {
  npcDisplayName: string;
  systemPrompt: string;
  userPrompt: string;
  /** Milliseconds; the caller stamps it so this module stays side-effect free. */
  at: number;
}

interface DumpArgs {
  npcDisplayName: string;
  systemPrompt: string;
  userPrompt: string;
  enabled: boolean;
}

/**
 * Print + retain the constructed prompt. No-op when `enabled` is false, so it is
 * safe to call every turn. Never throws (a broken console/window must not break
 * generation).
 */
export function dumpConstructedPrompt(args: DumpArgs): void {
  if (!args.enabled) return;
  const entry: ConstructedPromptDump = {
    npcDisplayName: args.npcDisplayName,
    systemPrompt: args.systemPrompt,
    userPrompt: args.userPrompt,
    at: Date.now()
  };

  try {
    // Readable console block for eyeballing during troubleshooting.
    console.debug(
      `[sugaragent] generate:prompt (${args.npcDisplayName})\n` +
        `=== SYSTEM ===\n${args.systemPrompt}\n` +
        `=== USER ===\n${args.userPrompt}`
    );
  } catch {
    // ignore console failures
  }

  try {
    // Programmatic access: window.__sugaragentPrompts.at(-1). Browser only.
    const globalObject = globalThis as unknown as Record<string, unknown>;
    if (typeof globalObject === "object" && globalObject) {
      const existing = globalObject[SUGARAGENT_PROMPTS_WINDOW_KEY];
      const list = Array.isArray(existing) ? (existing as ConstructedPromptDump[]) : [];
      list.push(entry);
      while (list.length > MAX_RETAINED_PROMPTS) list.shift();
      globalObject[SUGARAGENT_PROMPTS_WINDOW_KEY] = list;
    }
  } catch {
    // ignore window failures
  }
}
