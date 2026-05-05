/**
 * Trigger-castable item interaction tests.
 *
 * Verifies item interactions enter mechanics through the runtime castable
 * executor instead of introducing a second item-specific behavior path.
 */

import { describe, expect, it } from "vitest";
import {
  createDefaultItemDefinition,
  createDefaultMechanicsDefinition
} from "@sugarmagic/domain";
import {
  collectMechanicsConsumerInvocations,
  createStatCarrier,
  executeTriggerCastableItemInteraction,
  validateMechanicsDefinition
} from "@sugarmagic/runtime-core";

describe("trigger-castable item interactions", () => {
  it("dispatches the configured castable with the player carrier as caster", () => {
    const mechanics = createDefaultMechanicsDefinition();
    mechanics.castables.push({
      id: "gain-focus",
      displayName: "Gain Focus",
      inputs: [{ id: "amount", type: "number", required: true, default: 5 }],
      cost: null,
      acceptsTarget: false,
      onCast: [
        { op: "set", target: "caster.resonance", value: "self.amount" },
        { op: "emit", kind: "focus.gained", payload: { source: "item" } }
      ]
    });
    const item = createDefaultItemDefinition({
      definitionId: "item-focus-beacon",
      displayName: "Focus Beacon"
    });
    item.interactionView = {
      ...item.interactionView,
      kind: "trigger-castable",
      castableInvocation: {
        id: "gain-focus",
        args: { amount: 12 }
      }
    };
    const caster = createStatCarrier(mechanics);
    const emitted: string[] = [];

    const result = executeTriggerCastableItemInteraction({
      mechanics,
      itemDefinition: item,
      caster,
      emit: (kind) => emitted.push(kind)
    });

    expect(result.status).toBe("success");
    expect(caster.get("resonance")).toBe(12);
    expect(emitted).toEqual(["focus.gained"]);
  });

  it("validates trigger-castable item consumers against mechanics", () => {
    const mechanics = createDefaultMechanicsDefinition();
    const item = createDefaultItemDefinition();
    item.interactionView = {
      ...item.interactionView,
      kind: "trigger-castable",
      castableInvocation: {
        id: "missing-castable",
        args: {}
      }
    };

    const result = validateMechanicsDefinition(mechanics, {
      consumers: collectMechanicsConsumerInvocations({
        spellDefinitions: [],
        itemDefinitions: [item]
      })
    });

    expect(result.valid).toBe(false);
    expect(result.issues[0]?.message).toContain("Unknown castable");
  });
});
