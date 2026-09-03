/**
 * Boots run one at a time (#273).
 *
 * The bug this exists to stop: two overlapping `host.start()` calls
 * interleave their writes to host-wide state, so a registry created by the
 * later boot receives the earlier boot's registrations and the duplicate
 * throws. Which boot wins depends on how far each got, which is why it
 * reproduced only sometimes.
 *
 * These drive the ordering directly rather than through the real boot,
 * which needs three.js and a DOM.
 */

import { describe, expect, it } from "vitest";
import { createSerialRunner } from "./serialRunner";

/** A promise plus the handles to settle it from the test. */
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("serial runner", () => {
  it("does not start the second call until the first has finished", async () => {
    const runner = createSerialRunner();
    const first = deferred();
    const started: string[] = [];

    const a = runner.run(async () => {
      started.push("a");
      await first.promise;
    });
    const b = runner.run(async () => {
      started.push("b");
    });

    // The first is still in flight, so the second has not begun. This is
    // the whole invariant: without it both are mid-flight together.
    await Promise.resolve();
    expect(started).toEqual(["a"]);

    first.resolve();
    await Promise.all([a, b]);
    expect(started).toEqual(["a", "b"]);
  });

  it("runs many calls in the order they were queued", async () => {
    const runner = createSerialRunner();
    const order: number[] = [];

    await Promise.all(
      [0, 1, 2, 3, 4].map((index) =>
        runner.run(async () => {
          order.push(index);
        })
      )
    );

    expect(order).toEqual([0, 1, 2, 3, 4]);
  });

  it("gives each caller its own result", async () => {
    const runner = createSerialRunner();

    const results = await Promise.all([
      runner.run(async () => "first"),
      runner.run(async () => "second")
    ]);

    expect(results).toEqual(["first", "second"]);
  });

  it("rejects the caller whose work threw, and only that caller", async () => {
    const runner = createSerialRunner();
    const boom = new Error("boot failed");

    const failed = runner.run(async () => {
      throw boom;
    });
    const after = runner.run(async () => "still fine");

    await expect(failed).rejects.toBe(boom);
    await expect(after).resolves.toBe("still fine");
  });

  it("keeps running after a failure, so one bad boot cannot wedge the tab", async () => {
    // The failure mode this guards: if a thrown boot poisoned the chain,
    // the page would need a reload to ever boot again -- which is the
    // symptom we are removing, not one to reintroduce.
    const runner = createSerialRunner();
    const order: string[] = [];

    await runner.run(async () => {
      order.push("first");
      throw new Error("nope");
    }).catch(() => {});
    await runner.run(async () => {
      order.push("second");
    });
    await runner.run(async () => {
      order.push("third");
    });

    expect(order).toEqual(["first", "second", "third"]);
  });

  it("still serializes when a caller ignores the returned promise", async () => {
    // `preview.tsx` fires `void host.start(...)`, so nothing awaits the
    // result. Ordering cannot depend on the caller holding the promise.
    const runner = createSerialRunner();
    const first = deferred();
    const started: string[] = [];

    void runner.run(async () => {
      started.push("a");
      await first.promise;
    });
    const second = runner.run(async () => {
      started.push("b");
    });

    await Promise.resolve();
    expect(started).toEqual(["a"]);

    first.resolve();
    await second;
    expect(started).toEqual(["a", "b"]);
  });
});
