/**
 * Mechanics validation tests.
 *
 * Guards structural schema checks, semantic expression reference checks, and
 * consumer invocation validation.
 */

import { describe, expect, it } from "vitest";
import { createDefaultMechanicsDefinition } from "@sugarmagic/domain";
import { validateMechanicsDefinition } from "@sugarmagic/runtime-core";

describe("mechanics validation", () => {
  it("accepts the default mechanics block", () => {
    const result = validateMechanicsDefinition(
      createDefaultMechanicsDefinition()
    );
    expect(result.valid).toBe(true);
  });

  it("rejects unknown self references", () => {
    const mechanics = createDefaultMechanicsDefinition();
    mechanics.castables[0] = {
      ...mechanics.castables[0]!,
      cost: "caster.battery >= self.missing"
    };

    const result = validateMechanicsDefinition(mechanics);

    expect(result.valid).toBe(false);
    expect(
      result.issues.some((issue) => issue.message.includes("missing"))
    ).toBe(true);
  });

  it("rejects spell castable invocations missing required args", () => {
    const mechanics = createDefaultMechanicsDefinition();
    mechanics.castables[0] = {
      ...mechanics.castables[0]!,
      inputs: mechanics.castables[0]!.inputs.map((input) =>
        input.id === "chaosBase"
          ? { id: input.id, type: input.type, required: true }
          : input
      )
    };
    const result = validateMechanicsDefinition(mechanics, {
      consumers: [
        {
          label: "/spell",
          invocation: { id: "spell", args: { batteryCost: 10 } }
        }
      ]
    });

    expect(result.valid).toBe(false);
    expect(
      result.issues.some((issue) => issue.message.includes("chaosBase"))
    ).toBe(true);
  });

  it("rejects spell castable invocations without a declared castable", () => {
    const mechanics = createDefaultMechanicsDefinition();
    const result = validateMechanicsDefinition(mechanics, {
      consumers: [
        {
          label: "/spell",
          invocation: { id: "", args: {} }
        }
      ]
    });

    expect(result.valid).toBe(false);
    expect(
      result.issues.some((issue) =>
        issue.message.includes('Unknown castable ""')
      )
    ).toBe(true);
  });

  it("rejects duplicate stat roles", () => {
    const mechanics = createDefaultMechanicsDefinition();
    mechanics.stats.push({
      id: "backupBattery",
      displayName: "Backup Battery",
      default: 50,
      min: 0,
      max: 100,
      decay: null,
      recharge: null,
      display: "bar",
      role: "battery"
    });

    const result = validateMechanicsDefinition(mechanics);

    expect(result.valid).toBe(false);
    expect(
      result.issues.some((issue) =>
        issue.message.includes('Duplicate stat role "battery"')
      )
    ).toBe(true);
  });
});
