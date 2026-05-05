/**
 * Fireflies end-to-end contract fixture.
 *
 * Mirrors the data-only integration shape: an item triggers a castable, that
 * castable emits an event, the plugin opens, and puzzle success dispatches a
 * second castable that mutates the player's stats.
 */

import { describe, expect, it, vi } from "vitest";
import {
  createDefaultItemDefinition,
  type CastableInvocation,
  type MechanicsDefinition
} from "@sugarmagic/domain";
import { createFirefliesRuntimePlugin } from "@sugarmagic/plugins";
import {
  createCastableExecutor,
  createStatCarrier,
  executeTriggerCastableItemInteraction,
  type MechanicsEmitDispatch,
  type MechanicsEmitHandlerContribution
} from "@sugarmagic/runtime-core";

describe("fireflies data-only integration chain", () => {
  it("runs item interact to emit handler to completion castable", () => {
    const mechanics: MechanicsDefinition = {
      stats: [
        {
          id: "focus",
          displayName: "Focus",
          default: 0,
          min: 0,
          max: 100,
          decay: null,
          recharge: null,
          display: "bar",
          role: null
        }
      ],
      castables: [
        {
          id: "open-focus-puzzle",
          displayName: "Open Focus Puzzle",
          inputs: [],
          cost: null,
          acceptsTarget: false,
          onCast: [{ op: "emit", kind: "focus.puzzle.open" }]
        },
        {
          id: "gain-focus",
          displayName: "Gain Focus",
          inputs: [
            { id: "amount", type: "number", required: true, default: 25 }
          ],
          cost: null,
          acceptsTarget: false,
          onCast: [
            {
              op: "set",
              target: "caster.focus",
              value: "min(caster.focus + self.amount, 100)"
            }
          ]
        }
      ]
    };
    const item = createDefaultItemDefinition({
      definitionId: "item-focus-point",
      displayName: "Focus Point"
    });
    item.interactionView = {
      ...item.interactionView,
      kind: "trigger-castable",
      castableInvocation: {
        id: "open-focus-puzzle",
        args: {}
      }
    };
    const caster = createStatCarrier(mechanics);
    const completion = {
      current: null as ((result: "success" | "fail") => void) | null
    };
    const plugin = createFirefliesRuntimePlugin({
      pluginId: "fireflies",
      displayName: "Fireflies",
      config: {
        triggers: [
          {
            emitKind: "focus.puzzle.open",
            difficulty: "medium",
            onSuccess: {
              id: "gain-focus",
              args: { amount: 25 }
            }
          }
        ]
      },
      runPuzzle: (options) => {
        completion.current = options.onComplete;
        return { dispose: vi.fn() };
      }
    });
    const contribution = plugin
      .contributions[0] as MechanicsEmitHandlerContribution;
    const setup = contribution.payload.setup({
      mountRoot: {} as HTMLElement,
      config: plugin.config ?? {},
      dispatchCastable(invocation: CastableInvocation) {
        return createCastableExecutor({ mechanics }).execute({
          invocation,
          caster,
          target: null
        });
      },
      claimInput: vi.fn(),
      releaseInput: vi.fn()
    });

    const result = executeTriggerCastableItemInteraction({
      mechanics,
      itemDefinition: item,
      caster,
      emit: (kind, payload) =>
        setup.handle({
          emitKind: kind,
          payload,
          caster: caster as MechanicsEmitDispatch["caster"],
          target: null
        })
    });
    completion.current?.("success");

    expect(result.status).toBe("success");
    expect(caster.get("focus")).toBe(25);
  });
});
