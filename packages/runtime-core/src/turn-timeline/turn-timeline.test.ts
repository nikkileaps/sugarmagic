/**
 * packages/runtime-core/src/turn-timeline/turn-timeline.test.ts
 *
 * Purpose: Pins that the timeline prints, and that it reports the time nobody
 *   instrumented rather than hiding it.
 *
 * Status: active
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  beginTurnTimeline,
  endTurnTimeline,
  markTurnPhase,
  noteTurnFact
} from "./index";

afterEach(() => vi.restoreAllMocks());

function captureTimeline(run: () => void): string {
  const lines: string[] = [];
  vi.spyOn(console, "info").mockImplementation((...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  });
  run();
  return lines.join("\n");
}

describe("the turn timeline", () => {
  it("THE ONE THAT MATTERS: reports the time nobody instrumented", () => {
    // The whole point of the spike. If the phases sum to less than the wall
    // clock, the difference is where the seconds went that nothing measured --
    // and a timeline that quietly drops it would confirm whatever we already
    // believed.
    const output = captureTimeline(() => {
      beginTurnTimeline("Finnick Thorn", 1000);
      markTurnPhase("Generate", 600);
      endTurnTimeline(2000);
    });

    // Started at 1000, ended at 2000: a 1000ms turn of which 600 was measured.
    expect(output).toContain("1000ms total");
    expect(output).toMatch(/\(unaccounted\)\s+400ms/);
  });

  it("orders phases by cost, because the biggest one is the question", () => {
    const output = captureTimeline(() => {
      beginTurnTimeline("npc", 0);
      markTurnPhase("Judge", 900);
      markTurnPhase("Generate", 6000);
      markTurnPhase("Retrieve", 1400);
      endTurnTimeline(8300);
    });

    const order = ["Generate", "Retrieve", "Judge"].map((label) => output.indexOf(label));
    expect(order[0]).toBeLessThan(order[1]!);
    expect(order[1]).toBeLessThan(order[2]!);
  });

  it("carries the facts that decide whether a phase is worth attacking", () => {
    // A slow path that rarely runs is not worth optimising, so the counts have
    // to sit beside the timings rather than in a separate place.
    const output = captureTimeline(() => {
      beginTurnTimeline("npc", 0);
      markTurnPhase("Teacher", 2100);
      noteTurnFact("teacherCache", "miss:learner_change");
      noteTurnFact("verifyRepair", true);
      endTurnTimeline(2100);
    });

    expect(output).toContain("teacherCache=miss:learner_change");
    expect(output).toContain("verifyRepair=true");
  });

  it("a mark with no timeline open is ignored, not thrown", () => {
    // This is a diagnostic. It must never be the reason a turn fails.
    expect(() => {
      markTurnPhase("Generate", 100);
      noteTurnFact("k", 1);
      endTurnTimeline();
    }).not.toThrow();
  });

  it("an abandoned timeline is replaced by the next turn", () => {
    const output = captureTimeline(() => {
      beginTurnTimeline("abandoned", 0);
      markTurnPhase("Generate", 5000);
      beginTurnTimeline("next", 0);
      markTurnPhase("Teacher", 10);
      endTurnTimeline(10);
    });

    expect(output).toContain("next");
    expect(output).not.toContain("abandoned");
    expect(output).not.toContain("5000ms");
  });
});
