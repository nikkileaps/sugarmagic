/**
 * packages/plugins/src/catalog/sugarlang/tests/teacher/realization-outcome.test.ts
 *
 * Purpose: Pins the one implementation of "did the slate reach the text",
 *   which the en3 baseline reads and the realization trace prints.
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import { realizationOutcome } from "../../runtime/teacher/teacher-trace";

describe("did the slate reach the text", () => {
  it("THE ONE THAT MATTERS: counts a slated item landed via ANY of its forms", () => {
    // `estación` counts whether the line said `estación` or `estaciones` --
    // realization writes whatever the sentence needs.
    const outcome = realizationOutcome("Hay dos estaciones aquí.", [
      { asked: "estación", forms: ["estaciones", "estacion"] },
      { asked: "queso", forms: ["quesos"] }
    ]);

    expect(outcome.asked).toBe(2);
    expect(outcome.landed).toBe(1);
    expect(outcome.landedEntries.map((entry) => entry.asked)).toEqual(["estación"]);
  });

  it("is case-insensitive, because lines capitalize", () => {
    const outcome = realizationOutcome("¡Queso fresco!", [
      { asked: "queso", forms: [] }
    ]);
    expect(outcome.landed).toBe(1);
  });

  it("an empty slate asks for nothing and lands nothing", () => {
    const outcome = realizationOutcome("Hola.", []);
    expect(outcome).toMatchObject({ asked: 0, landed: 0 });
  });
});
