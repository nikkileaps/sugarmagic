/**
 * InputRouter: normalizes DOM events and routes them to the active
 * interaction controller.
 *
 * Based on Sugarbuilder ADR 056. The router owns input normalization
 * and dispatch — individual tools/controllers own interpretation.
 */

export interface NormalizedPointerEvent {
  screenX: number;
  screenY: number;
  normalizedX: number;
  normalizedY: number;
  button: number;
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

export interface InteractionController {
  id: string;
  onPointerDown?: (event: NormalizedPointerEvent) => boolean;
  onPointerMove?: (event: NormalizedPointerEvent) => void;
  onPointerUp?: (event: NormalizedPointerEvent) => void;
  onCancel?: () => void;
}

export interface InputRouter {
  attach: (element: HTMLElement) => void;
  detach: () => void;
  pushController: (controller: InteractionController) => void;
  popController: (id: string) => void;
  activeControllerId: () => string | null;
}

function normalizePointerEvent(
  event: PointerEvent,
  rect: DOMRect
): NormalizedPointerEvent {
  return {
    screenX: event.clientX,
    screenY: event.clientY,
    normalizedX: ((event.clientX - rect.left) / rect.width) * 2 - 1,
    normalizedY: -((event.clientY - rect.top) / rect.height) * 2 + 1,
    button: event.button,
    shiftKey: event.shiftKey,
    ctrlKey: event.ctrlKey,
    altKey: event.altKey,
    metaKey: event.metaKey
  };
}

export function createInputRouter(): InputRouter {
  const controllers: InteractionController[] = [];
  let element: HTMLElement | null = null;
  let activeController: InteractionController | null = null;

  function getTopController(): InteractionController | null {
    return controllers.length > 0
      ? controllers[controllers.length - 1]
      : null;
  }

  function handlePointerDown(event: PointerEvent) {
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const normalized = normalizePointerEvent(event, rect);

    const controller = getTopController();
    if (controller?.onPointerDown?.(normalized)) {
      activeController = controller;
      element.setPointerCapture(event.pointerId);
    }
  }

  function handlePointerMove(event: PointerEvent) {
    if (!element || !activeController) return;
    const rect = element.getBoundingClientRect();
    const normalized = normalizePointerEvent(event, rect);
    activeController.onPointerMove?.(normalized);
  }

  function handlePointerUp(event: PointerEvent) {
    if (!element || !activeController) return;
    const rect = element.getBoundingClientRect();
    const normalized = normalizePointerEvent(event, rect);
    activeController.onPointerUp?.(normalized);
    activeController = null;
    element.releasePointerCapture(event.pointerId);
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape" && activeController) {
      activeController.onCancel?.();
      activeController = null;
    }
  }

  return {
    attach(el: HTMLElement) {
      element = el;
      el.addEventListener("pointerdown", handlePointerDown);
      el.addEventListener("pointermove", handlePointerMove);
      el.addEventListener("pointerup", handlePointerUp);
      window.addEventListener("keydown", handleKeyDown);
    },

    detach() {
      if (element) {
        element.removeEventListener("pointerdown", handlePointerDown);
        element.removeEventListener("pointermove", handlePointerMove);
        element.removeEventListener("pointerup", handlePointerUp);
      }
      window.removeEventListener("keydown", handleKeyDown);
      element = null;
      activeController = null;
    },

    pushController(controller: InteractionController) {
      controllers.push(controller);
    },

    popController(id: string) {
      const idx = controllers.findIndex((c) => c.id === id);
      if (idx !== -1) {
        if (activeController?.id === id) {
          activeController.onCancel?.();
          activeController = null;
        }
        controllers.splice(idx, 1);
      }
    },

    activeControllerId() {
      return activeController?.id ?? null;
    }
  };
}
