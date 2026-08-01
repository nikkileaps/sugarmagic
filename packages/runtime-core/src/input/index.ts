/**
 * InputManager: runtime input for preview gameplay.
 *
 * Ported from Sugarengine's InputManager.
 * WASD/Arrow keys → moveX/moveY normalized input.
 * Movement lock stack for UI contexts.
 */

export interface RuntimeInputState {
  moveX: number;
  moveY: number;
  isDragging: boolean;
}

export interface RuntimeInputManager {
  attach: (element: HTMLElement) => void;
  detach: () => void;
  getInput: () => RuntimeInputState;
  isInteractPressed: () => boolean;
  consumeInteract: () => void;
  endFrame: () => void;
  addWorldInputLock: (id: string) => void;
  removeWorldInputLock: (id: string) => void;
  isWorldInputLocked: () => boolean;
  onRightDrag: ((dx: number, dy: number) => void) | null;
  onScroll: ((delta: number) => void) | null;
}

export function createRuntimeInputManager(): RuntimeInputManager {
  const keys = new Set<string>();
  const keysJustPressed = new Set<string>();
  /**
   * While any lock is held, the game world stops taking player input: no
   * movement, no camera zoom, no camera orbit. Every overlay claims one on open
   * and releases it on close, keyed by owner so two overlays cannot unlock each
   * other.
   *
   * This was called `movementLocks` and gated ONLY movement, which meant the
   * camera stayed live under every overlay in the game -- scrolling over a
   * dialogue card zoomed the scene behind it. Widening it here rather than
   * per-overlay keeps one enforcer: an overlay that claims the lock is
   * inert-by-default, instead of each having to remember to suppress the
   * camera itself.
   */
  const worldInputLocks = new Set<string>();
  let isDragging = false;
  let lastPointerX = 0;
  let lastPointerY = 0;
  let attachedWindow: Window | null = null;

  function isTextInputTarget(event: KeyboardEvent): boolean {
    const target = event.target;
    return (
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLInputElement ||
      (target instanceof HTMLElement && target.isContentEditable)
    );
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (isTextInputTarget(e)) return;
    const key = e.key.toLowerCase();
    if (!keys.has(key)) {
      keysJustPressed.add(key);
    }
    keys.add(key);
  }

  function handleKeyUp(e: KeyboardEvent) {
    if (isTextInputTarget(e)) return;
    keys.delete(e.key.toLowerCase());
  }

  function handlePointerDown(e: PointerEvent) {
    if (worldInputLocks.size > 0) return;
    if (e.button === 2) {
      isDragging = true;
      lastPointerX = e.clientX;
      lastPointerY = e.clientY;
    }
  }

  function handlePointerMove(e: PointerEvent) {
    if (isDragging) {
      const dx = e.clientX - lastPointerX;
      const dy = e.clientY - lastPointerY;
      lastPointerX = e.clientX;
      lastPointerY = e.clientY;
      manager.onRightDrag?.(dx, dy);
    }
  }

  function handlePointerUp(e: PointerEvent) {
    if (e.button === 2) isDragging = false;
  }

  function handleWheel(e: WheelEvent) {
    // Still swallowed while locked, so the page behind never scrolls -- but the
    // camera does not act on it.
    e.preventDefault();
    if (worldInputLocks.size > 0) return;
    manager.onScroll?.(e.deltaY > 0 ? 1 : -1);
  }

  function handleContextMenu(e: Event) {
    e.preventDefault();
  }

  const manager: RuntimeInputManager = {
    onRightDrag: null,
    onScroll: null,

    attach(el: HTMLElement) {
      // Keyboard on window so input survives focus moving to overlay buttons
      // (start menu, pause menu, etc.). Text-input guard above prevents WASD
      // hijacking when the user is typing in a Studio inspector field.
      const win = el.ownerDocument?.defaultView ?? window;
      win.addEventListener("keydown", handleKeyDown);
      win.addEventListener("keyup", handleKeyUp);
      attachedWindow = win;
      el.addEventListener("pointerdown", handlePointerDown);
      el.addEventListener("pointermove", handlePointerMove);
      el.addEventListener("pointerup", handlePointerUp);
      el.addEventListener("wheel", handleWheel, { passive: false });
      el.addEventListener("contextmenu", handleContextMenu);
    },

    detach() {
      attachedWindow?.removeEventListener("keydown", handleKeyDown);
      attachedWindow?.removeEventListener("keyup", handleKeyUp);
      attachedWindow = null;
      keys.clear();
      isDragging = false;
    },

    getInput(): RuntimeInputState {
      if (worldInputLocks.size > 0) {
        return { moveX: 0, moveY: 0, isDragging };
      }

      let moveX = 0;
      let moveY = 0;
      if (keys.has("w") || keys.has("arrowup")) moveY -= 1;
      if (keys.has("s") || keys.has("arrowdown")) moveY += 1;
      if (keys.has("a") || keys.has("arrowleft")) moveX -= 1;
      if (keys.has("d") || keys.has("arrowright")) moveX += 1;

      // Normalize diagonal
      if (moveX !== 0 && moveY !== 0) {
        const len = Math.sqrt(moveX * moveX + moveY * moveY);
        moveX /= len;
        moveY /= len;
      }

      return { moveX, moveY, isDragging };
    },

    isInteractPressed() {
      return keysJustPressed.has("e");
    },

    consumeInteract() {
      keysJustPressed.delete("e");
    },

    endFrame() {
      keysJustPressed.clear();
    },

    addWorldInputLock(id: string) {
      worldInputLocks.add(id);
    },

    removeWorldInputLock(id: string) {
      worldInputLocks.delete(id);
    },

    isWorldInputLocked() {
      return worldInputLocks.size > 0;
    }
  };

  return manager;
}
