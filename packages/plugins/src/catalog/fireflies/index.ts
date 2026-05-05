/**
 * Fireflies catalog plugin.
 *
 * Registers a generic mechanics emit handler that opens the Fireflies
 * pattern puzzle and dispatches configured castables on completion.
 */

import type {
  MechanicsEmitDispatch,
  RuntimePluginInstance
} from "@sugarmagic/runtime-core";
import type { DiscoveredPluginDefinition } from "../../sdk";
import {
  FIREFLIES_PLUGIN_ID,
  listConfiguredFirefliesEmitKinds,
  parseFirefliesPluginConfig
} from "./config";
import {
  runFirefliesPuzzle,
  type FirefliesPuzzleResult,
  type FirefliesPuzzleRunner
} from "./puzzle";

export {
  FIREFLIES_PLUGIN_ID,
  listConfiguredFirefliesEmitKinds,
  parseFirefliesPluginConfig
} from "./config";
export type {
  FirefliesDifficulty,
  FirefliesPluginConfig,
  FirefliesTriggerConfig
} from "./config";
export {
  AFTERGLOW_DURATION,
  COHERENCE_PERIOD,
  DISTRACTION_FIREFLIES,
  FIREFLIES_PER_PATH,
  MAX_ATTEMPTS,
  SWEEP_DURATION,
  runFirefliesPuzzle
} from "./puzzle";
export type { FirefliesPuzzleResult, FirefliesPuzzleRunner } from "./puzzle";

export interface FirefliesRuntimePluginOptions {
  config?: Record<string, unknown>;
  runPuzzle?: FirefliesPuzzleRunner;
}

export function createFirefliesRuntimePlugin(options: {
  pluginId: string;
  displayName: string;
  config: Record<string, unknown>;
  runPuzzle: FirefliesPuzzleRunner;
}): RuntimePluginInstance {
  const emitKinds = listConfiguredFirefliesEmitKinds(options.config);
  let activePuzzle: { dispose: () => void } | null = null;

  return {
    pluginId: options.pluginId,
    displayName: options.displayName,
    config: options.config,
    contributions: [
      {
        pluginId: options.pluginId,
        contributionId: `${options.pluginId}.mechanics-emit-handler`,
        kind: "mechanics.emitHandler",
        displayName: "Fireflies Mechanics Emit Handler",
        priority: 10,
        payload: {
          emitKinds,
          setup(context) {
            const config = parseFirefliesPluginConfig(context.config);
            const triggerByKind = new Map(
              config.triggers.map((trigger) => [trigger.emitKind, trigger])
            );

            return {
              handle(dispatch: MechanicsEmitDispatch) {
                if (activePuzzle) return;
                const trigger = triggerByKind.get(dispatch.emitKind);
                if (!trigger) return;
                activePuzzle = options.runPuzzle({
                  mountRoot: context.mountRoot,
                  title: trigger.title,
                  difficulty: trigger.difficulty,
                  claimInput: context.claimInput,
                  releaseInput: context.releaseInput,
                  onComplete(result: FirefliesPuzzleResult) {
                    activePuzzle = null;
                    const invocation =
                      result === "success" ? trigger.onSuccess : trigger.onFail;
                    if (invocation) {
                      context.dispatchCastable(invocation);
                    }
                  }
                });
              },
              dispose() {
                activePuzzle?.dispose();
                activePuzzle = null;
              }
            };
          }
        }
      }
    ],
    serializeState: () => ({ enabled: true })
  };
}

export function createFirefliesPlugin(
  options: FirefliesRuntimePluginOptions = {}
) {
  return createFirefliesRuntimePlugin({
    pluginId: FIREFLIES_PLUGIN_ID,
    displayName: "Fireflies",
    config: options.config ?? {},
    runPuzzle: options.runPuzzle ?? runFirefliesPuzzle
  });
}

export const pluginDefinition: DiscoveredPluginDefinition = {
  manifest: {
    pluginId: FIREFLIES_PLUGIN_ID,
    displayName: "Fireflies",
    summary: "Pattern-emergence mini-game triggered by mechanics emits.",
    capabilityIds: ["mechanics.emitHandler"]
  },
  defaultConfig: {
    triggers: []
  },
  runtime: {
    createRuntimePlugin: ({ configuration }) =>
      createFirefliesRuntimePlugin({
        pluginId: configuration.pluginId,
        displayName: "Fireflies",
        config: configuration.config,
        runPuzzle: runFirefliesPuzzle
      })
  }
};
