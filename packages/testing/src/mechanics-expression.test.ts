/**
 * Mechanics expression language tests.
 *
 * Guards operator precedence, member access, ternaries, built-ins, and dice.
 */

import { describe, expect, it } from "vitest";
import { evaluateExpression, parseExpression } from "@sugarmagic/runtime-core";

describe("mechanics expressions", () => {
  it("evaluates arithmetic with normal precedence", () => {
    expect(evaluateExpression("1 + 2 * 3", { scope: {} })).toBe(7);
  });

  it("evaluates member access and ternaries", () => {
    expect(
      evaluateExpression("caster.hp > 0 ? self.hit : self.miss", {
        scope: {
          caster: { hp: 3 },
          self: { hit: "yes", miss: "no" }
        }
      })
    ).toBe("yes");
  });

  it("evaluates built-ins and deterministic dice", () => {
    expect(
      evaluateExpression("clamp(roll(2d6+1), 0, 10)", {
        scope: {},
        rng: () => 0
      })
    ).toBe(3);
  });

  it("reports syntax errors with positions", () => {
    expect(() => parseExpression("caster.")).toThrow(/character/i);
  });
});
