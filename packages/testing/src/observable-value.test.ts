/**
 * Story 51.1 — ObservableValue primitive tests.
 *
 * Validates the snapshot+subscribe contract that the rest of
 * Plan 051 will lean on. The shape matches React's
 * `useSyncExternalStore` so React subscribers Just Work, and
 * the no-op-on-equal-set behaviour is what keeps spurious
 * re-renders out of subscribed components.
 */

import { describe, expect, it, vi } from "vitest";
import { createObservableValue } from "@sugarmagic/runtime-core";

describe("createObservableValue", () => {
  it("getSnapshot returns the initial value", () => {
    const store = createObservableValue<number>(42);
    expect(store.getSnapshot()).toBe(42);
  });

  it("set updates the snapshot", () => {
    const store = createObservableValue<number>(1);
    store.set(2);
    expect(store.getSnapshot()).toBe(2);
  });

  it("subscribe fires the listener on a value-changing set", () => {
    const store = createObservableValue<number>(0);
    const listener = vi.fn();
    store.subscribe(listener);
    store.set(1);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("subscribe does NOT fire when the new value is Object.is-equal to the current", () => {
    const store = createObservableValue<number>(5);
    const listener = vi.fn();
    store.subscribe(listener);
    store.set(5);
    expect(listener).not.toHaveBeenCalled();
  });

  it("Object.is treats NaN === NaN (subscribers do not fire on NaN-to-NaN)", () => {
    // Object.is(NaN, NaN) is true; === would be false. The store
    // follows Object.is per React's contract.
    const store = createObservableValue<number>(Number.NaN);
    const listener = vi.fn();
    store.subscribe(listener);
    store.set(Number.NaN);
    expect(listener).not.toHaveBeenCalled();
  });

  it("Object.is treats -0 and +0 as distinct (subscribers DO fire)", () => {
    // Object.is(-0, +0) is false; === would be true. Same
    // contract as React.
    const store = createObservableValue<number>(0);
    const listener = vi.fn();
    store.subscribe(listener);
    store.set(-0);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("multiple subscribers all fire on a single set", () => {
    const store = createObservableValue<string>("a");
    const a = vi.fn();
    const b = vi.fn();
    const c = vi.fn();
    store.subscribe(a);
    store.subscribe(b);
    store.subscribe(c);
    store.set("b");
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    expect(c).toHaveBeenCalledTimes(1);
  });

  it("unsubscribe stops the listener from firing on future sets", () => {
    const store = createObservableValue<string>("x");
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.set("y");
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    store.set("z");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("unsubscribe is idempotent — calling it twice is a no-op", () => {
    const store = createObservableValue<number>(0);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    unsubscribe();
    expect(() => unsubscribe()).not.toThrow();
    store.set(1);
    expect(listener).not.toHaveBeenCalled();
  });

  it("late subscribers immediately see the current value via getSnapshot (no replay race)", () => {
    // The whole reason this primitive exists: a subscriber
    // attached AFTER the value has changed still reads the
    // current value via `getSnapshot()`. The Plan 047 §47.10
    // late-subscriber race is structurally impossible here.
    const store = createObservableValue<string>("initial");
    store.set("updated");
    const listener = vi.fn();
    const lateSubscriber = () => {
      // simulate React's useSyncExternalStore behaviour: read
      // the snapshot at subscribe time, then listen for future
      // changes.
      const initial = store.getSnapshot();
      expect(initial).toBe("updated"); // not "initial"!
      store.subscribe(listener);
    };
    lateSubscriber();
    store.set("further");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot()).toBe("further");
  });

  it("works with reference types (Object.is on identity, not deep equality)", () => {
    // Two distinct objects with same shape are NOT equal under
    // Object.is — the store fires. Callers that want
    // structural equality should compare upstream before
    // calling set().
    const objA = { x: 1 };
    const objB = { x: 1 };
    const store = createObservableValue(objA);
    const listener = vi.fn();
    store.subscribe(listener);
    store.set(objB);
    expect(listener).toHaveBeenCalledTimes(1);
    // Setting the same object reference is a no-op.
    store.set(objB);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
