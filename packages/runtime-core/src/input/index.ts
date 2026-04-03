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
  addMovementLock: (id: string) => void;
  removeMovementLock: (id: string) => void;
  isMovementLocked: () => boolean;
  onRightDrag: ((dx: number, dy: number) => void) | null;
  onScroll: ((delta: number) => void) | null;
}

export function createRuntimeInputManager(): RuntimeInputManager {
  const keys = new Set<string>();
  const keysJustPressed = new Set<string>();
  const movementLocks = new Set<string>();
  let isDragging = false;
  let lastPointerX = 0;
  let lastPointerY = 0;

  function handleKeyDown(e: KeyboardEvent) {
    const key = e.key.toLowerCase();
    if (!keys.has(key)) {
      keysJustPressed.add(key);
    }
    keys.add(key);
  }

  function handleKeyUp(e: KeyboardEvent) {
    keys.delete(e.key.toLowerCase());
  }

  function handlePointerDown(e: PointerEvent) {
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
    e.preventDefault();
    manager.onScroll?.(e.deltaY > 0 ? 1 : -1);
  }

  function handleContextMenu(e: Event) {
    e.preventDefault();
  }

  const manager: RuntimeInputManager = {
    onRightDrag: null,
    onScroll: null,

    attach(el: HTMLElement) {
      el.addEventListener("keydown", handleKeyDown);
      el.addEventListener("keyup", handleKeyUp);
      el.addEventListener("pointerdown", handlePointerDown);
      el.addEventListener("pointermove", handlePointerMove);
      el.addEventListener("pointerup", handlePointerUp);
      el.addEventListener("wheel", handleWheel, { passive: false });
      el.addEventListener("contextmenu", handleContextMenu);
      el.tabIndex = 0;
      el.focus();
    },

    detach() {
      // Listeners will be GC'd with the element (preview window closes)
      keys.clear();
      isDragging = false;
    },

    getInput(): RuntimeInputState {
      if (movementLocks.size > 0) {
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

    addMovementLock(id: string) {
      movementLocks.add(id);
    },

    removeMovementLock(id: string) {
      movementLocks.delete(id);
    },

    isMovementLocked() {
      return movementLocks.size > 0;
    }
  };

  return manager;
}
