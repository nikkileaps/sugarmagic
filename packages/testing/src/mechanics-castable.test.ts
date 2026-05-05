/**
 * Mechanics castable executor tests.
 *
 * Executes authored example mechanics through the single castable executor.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type {
  CastableInvocation,
  MechanicsDefinition
} from "@sugarmagic/domain";
import {
  createCastableExecutor,
  createStatCarrier,
  parseMechanicsJson5Input
} from "@sugarmagic/runtime-core";

function readExample(name: string): MechanicsDefinition {
  return parseMechanicsJson5Input(
    readFileSync(
      join(process.cwd(), "docs", "mechanics-examples", name),
      "utf8"
    )
  ) as MechanicsDefinition;
}

describe("mechanics castables", () => {
  it("runs the current caster example and emits success", () => {
    const mechanics = readExample("current-caster.mechanics.json5");
    const caster = createStatCarrier(mechanics);
    const events: string[] = [];
    const executor = createCastableExecutor({
      mechanics,
      rng: () => 0.99,
      emit: (kind) => events.push(kind)
    });
    const invocation: CastableInvocation = {
      id: "spell",
      args: { batteryCost: 25, chaosBase: 0 }
    };

    const result = executor.execute({ invocation, caster });

    expect(result.status).toBe("success");
    expect(caster.get("battery")).toBe(75);
    expect(events).toEqual(["spell-success"]);
  });

  it("runs the dnd attack example against a target", () => {
    const mechanics = readExample("dnd-5e-attacks.mechanics.json5");
    const caster = createStatCarrier(mechanics);
    const target = createStatCarrier(mechanics);
    const events: string[] = [];
    const executor = createCastableExecutor({
      mechanics,
      rng: () => 0.99,
      emit: (kind) => events.push(kind)
    });

    const result = executor.execute({
      invocation: {
        id: "weapon-attack",
        args: { strengthMod: 5, damageBonus: 2 }
      },
      caster,
      target
    });

    expect(result.status).toBe("success");
    expect(target.get("hp")).toBe(2);
    expect(caster.get("fatigue")).toBe(1);
    expect(events).toEqual(["attack-hit"]);
  });
});
