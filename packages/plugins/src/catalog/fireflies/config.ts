/**
 * Fireflies plugin configuration parser.
 *
 * The domain project model intentionally treats plugin config as opaque.
 * This plugin owns its schema and fails loud when an enabled project supplies
 * malformed trigger data.
 */

import Ajv from "ajv";
import type { CastableInvocation } from "@sugarmagic/domain";

export const FIREFLIES_PLUGIN_ID = "fireflies";

export type FirefliesDifficulty = "easy" | "medium" | "hard";

export interface FirefliesTriggerConfig {
  emitKind: string;
  difficulty: FirefliesDifficulty;
  title: string;
  onSuccess?: CastableInvocation;
  onFail?: CastableInvocation;
}

export interface FirefliesPluginConfig {
  triggers: FirefliesTriggerConfig[];
}

interface FirefliesRawTriggerConfig {
  emitKind: string;
  difficulty?: FirefliesDifficulty;
  title?: string;
  onSuccess?: CastableInvocation;
  onFail?: CastableInvocation;
}

interface FirefliesRawPluginConfig {
  triggers: FirefliesRawTriggerConfig[];
}

const ajv = new Ajv({ allErrors: true, strict: false });

const castableInvocationSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "args"],
  properties: {
    id: { type: "string", minLength: 1 },
    args: {
      type: "object",
      additionalProperties: true
    }
  }
} as const;

const validateConfig = ajv.compile({
  type: "object",
  additionalProperties: false,
  required: ["triggers"],
  properties: {
    triggers: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["emitKind"],
        properties: {
          emitKind: { type: "string", minLength: 1 },
          difficulty: { enum: ["easy", "medium", "hard"] },
          title: { type: "string", minLength: 1 },
          onSuccess: castableInvocationSchema,
          onFail: castableInvocationSchema
        }
      }
    }
  }
});

export function listConfiguredFirefliesEmitKinds(
  config: Record<string, unknown> | null | undefined
): string[] {
  const triggers = Array.isArray(config?.triggers) ? config.triggers : [];
  return Array.from(
    new Set(
      triggers
        .map((trigger) =>
          trigger &&
          typeof trigger === "object" &&
          "emitKind" in trigger &&
          typeof trigger.emitKind === "string"
            ? trigger.emitKind.trim()
            : ""
        )
        .filter((emitKind) => emitKind.length > 0)
    )
  );
}

export function parseFirefliesPluginConfig(
  config: Record<string, unknown> | null | undefined
): FirefliesPluginConfig {
  const candidate = config ?? {};
  if (!validateConfig(candidate)) {
    const detail =
      validateConfig.errors
        ?.map((error) => `${error.instancePath || "/"} ${error.message}`)
        .join("; ") ?? "unknown validation error";
    throw new Error(`[fireflies] Invalid plugin config: ${detail}`);
  }

  const parsed = candidate as FirefliesRawPluginConfig;
  return {
    triggers: parsed.triggers.map((trigger) => ({
      emitKind: trigger.emitKind.trim(),
      difficulty: trigger.difficulty ?? "medium",
      title: trigger.title?.trim() || "Attunement",
      ...(trigger.onSuccess ? { onSuccess: trigger.onSuccess } : {}),
      ...(trigger.onFail ? { onFail: trigger.onFail } : {})
    }))
  };
}
