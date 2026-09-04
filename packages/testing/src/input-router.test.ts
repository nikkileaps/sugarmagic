/**
 * How a gesture ends.
 *
 * A controller that is never told its gesture ended keeps whatever it put on
 * screen, so every way the router can drop a gesture has to cancel it first.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createInputRouter } from "@sugarmagic/workspaces";

// The router listens for Escape on the window. These tests run without a DOM,
// so it gets somewhere harmless to register that listener.
const hadWindow = "window" in globalThis;
beforeEach(() => {
  if (hadWindow) return;
  (globalThis as { window?: unknown }).window = {
    addEventListener: () => {},
    removeEventListener: () => {}
  };
});
afterEach(() => {
  if (hadWindow) return;
  delete (globalThis as { window?: unknown }).window;
});

/**
 * Stands in for the DOM element the router attaches to, and hands back the
 * listeners it registered so a gesture can be driven without a browser.
 */
function makeViewport() {
  const listeners = new Map<string, (event: unknown) => void>();
  const element = {
    addEventListener: (type: string, listener: (event: unknown) => void) => {
      listeners.set(type, listener);
    },
    removeEventListener: (type: string) => {
      listeners.delete(type);
    },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
    setPointerCapture: () => {},
    releasePointerCapture: () => {}
  } as unknown as HTMLElement;

  return {
    element,
    pointerDown: () =>
      listeners.get("pointerdown")?.({
        clientX: 50,
        clientY: 50,
        button: 0,
        buttons: 1,
        pointerId: 1,
        shiftKey: false,
        ctrlKey: false,
        altKey: false,
        metaKey: false
      })
  };
}

/** A controller that accepts every pointer-down and counts its cancels. */
function makeController(id = "test-controller") {
  let cancels = 0;
  return {
    controller: {
      id,
      onPointerDown: () => true,
      onCancel: () => {
        cancels += 1;
      }
    },
    cancelCount: () => cancels
  };
}

describe("ending a gesture", () => {
  it("has no gesture to cancel before anything is pressed", () => {
    const router = createInputRouter();
    const { controller, cancelCount } = makeController();
    router.pushController(controller);

    expect(router.activeControllerId()).toBeNull();
    expect(router.cancelActiveGesture()).toBe(false);
    expect(cancelCount()).toBe(0);
  });

  it("tells the controller when its gesture is cancelled", () => {
    const router = createInputRouter();
    const viewport = makeViewport();
    const { controller, cancelCount } = makeController();
    router.pushController(controller);
    router.attach(viewport.element);
    viewport.pointerDown();
    expect(router.activeControllerId()).toBe("test-controller");

    expect(router.cancelActiveGesture()).toBe(true);
    expect(cancelCount()).toBe(1);
    expect(router.activeControllerId()).toBeNull();
  });

  it("cancels a gesture that is still running when the router detaches", () => {
    const router = createInputRouter();
    const viewport = makeViewport();
    const { controller, cancelCount } = makeController();
    router.pushController(controller);
    router.attach(viewport.element);
    viewport.pointerDown();

    router.detach();

    expect(cancelCount()).toBe(1);
    expect(router.activeControllerId()).toBeNull();
  });

  it("cancels a gesture whose controller is removed mid-way through", () => {
    const router = createInputRouter();
    const viewport = makeViewport();
    const { controller, cancelCount } = makeController();
    router.pushController(controller);
    router.attach(viewport.element);
    viewport.pointerDown();

    router.popController(controller.id);

    expect(cancelCount()).toBe(1);
    expect(router.activeControllerId()).toBeNull();
  });

  it("cancels a gesture only once", () => {
    const router = createInputRouter();
    const viewport = makeViewport();
    const { controller, cancelCount } = makeController();
    router.pushController(controller);
    router.attach(viewport.element);
    viewport.pointerDown();

    router.cancelActiveGesture();
    router.detach();

    expect(cancelCount()).toBe(1);
  });
});
