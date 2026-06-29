/**
 * packages/runtime-core/src/input-modes/registry.ts
 *
 * Purpose: the single keyboard-listener-owning registry that
 * Plan 050 introduces. Replaces six scattered
 * `window.addEventListener("keydown")` calls — one per shortcut
 * handler (inventory, quest journal, document, spell menu,
 * dialogue, debug HUD) — with one window listener that reads
 * the active `RuntimeMode` from `UIStateStore` and dispatches
 * to handlers whose declared modes match.
 *
 * Handler authors register intent
 * (`{actionId, modes, key, handler}`); they don't own the
 * listener lifecycle, the input-element-focus check, or the
 * "should I fire right now?" logic. That all lives here.
 *
 * Status: active (Story 50.2)
 */

import type { UIStateStore } from "../ui-context";
import {
  resolveRuntimeMode,
  type RuntimeMode
} from "./runtime-mode";

/**
 * Public API: caller-provided fields for a new action
 * registration.
 *
 * - `actionId` is a developer-facing identifier; the registry
 *   refuses to register two actions with the same id (catches
 *   accidental double-mount).
 * - `modes` is the set of modes in which this action fires.
 *   Include `"any"` for shortcuts that should fire regardless
 *   of mode (e.g. debug HUD diagnostics).
 * - `key` is the `KeyboardEvent.key` value to match
 *   (case-insensitive — `"i"` matches both unshifted and
 *   shifted `I`). Use the DOM canonical names for non-printable
 *   keys: `"Escape"`, `"Enter"`, `"ArrowUp"`, etc.
 * - `handler` receives the original `KeyboardEvent`. It owns
 *   `event.preventDefault()` if the action consumes the
 *   keystroke.
 */
export interface RegisterRuntimeActionInput {
  actionId: string;
  modes: ReadonlyArray<RuntimeMode>;
  key: string;
  handler: (event: KeyboardEvent) => void;
}

export interface RegisteredAction {
  readonly actionId: string;
  readonly modes: ReadonlyArray<RuntimeMode>;
  readonly key: string;
  readonly handler: (event: KeyboardEvent) => void;
}

/**
 * Inputs to the pure dispatch planner. Extracted as its own
 * function so the registry's keydown logic is tested without
 * mocking a DOM event.
 */
export interface KeydownDispatchInput {
  actions: ReadonlyArray<RegisteredAction>;
  /** The mode `resolveRuntimeMode` returned for the current state. */
  mode: Exclude<RuntimeMode, "any">;
  /** `event.key` as received from the DOM. */
  eventKey: string;
  /**
   * True when focus is inside an input / textarea / contenteditable
   * — the registry skips dispatch entirely so typing into a Studio
   * config field doesn't co-fire a game shortcut. Pre-50.2 every
   * handler did this check inline; centralising it here makes
   * "input typing wins over game shortcuts" a single-enforcer rule.
   */
  isInputFocused: boolean;
}

/**
 * Pure function: given the registered actions, the current
 * mode, and the event's key + focus context, return the
 * subset of actions that should fire (in registration order).
 *
 * Filter rules:
 *   - `isInputFocused === true` -> empty result (nothing fires).
 *   - action's `modes` must include the current mode OR `"any"`.
 *   - action's `key` (lowercased) must equal `eventKey` (lowercased).
 *
 * Multiple actions may match; all of them fire. Conflicts on
 * (mode x key) are flagged at registration time (TODO when 50.3+
 * migration surfaces real cases) rather than silently chosen.
 */
export function planKeydownDispatch(
  input: KeydownDispatchInput
): RegisteredAction[] {
  if (input.isInputFocused) return [];
  const normalizedKey = input.eventKey.toLowerCase();
  return input.actions.filter((action) => {
    const matchesMode =
      action.modes.includes(input.mode) || action.modes.includes("any");
    if (!matchesMode) return false;
    return action.key.toLowerCase() === normalizedKey;
  });
}

/**
 * Minimal subset of `EventTarget` the registry uses. Lets tests
 * pass a plain `{addEventListener, removeEventListener}` mock
 * without a DOM. Production callers pass `globalThis.window`.
 */
export interface RuntimeActionRegistryTarget {
  addEventListener(
    type: "keydown",
    listener: (event: KeyboardEvent) => void
  ): void;
  removeEventListener(
    type: "keydown",
    listener: (event: KeyboardEvent) => void
  ): void;
}

export interface RuntimeActionRegistry {
  /**
   * Register a new action. Returns an unregister function the
   * handler's owner calls on unmount. Throws synchronously if
   * `actionId` is already registered.
   */
  register(input: RegisterRuntimeActionInput): () => void;
  /** Test seam: snapshot of currently-registered actions. */
  getRegisteredActions(): ReadonlyArray<RegisteredAction>;
  /**
   * Eagerly tear down the window listener and clear all
   * registrations. Used by tests + by hosts that swap registries
   * mid-flight (e.g. Studio preview re-mounts on hot reload).
   */
  dispose(): void;
}

export interface CreateRuntimeActionRegistryOptions {
  stateStore: UIStateStore;
  /**
   * Where to install the keydown listener. Defaults to
   * `globalThis.window` so production callers don't have to
   * thread it through. Tests inject a mock target.
   */
  target?: RuntimeActionRegistryTarget;
  /**
   * Decides whether focus is inside an input / textarea /
   * contenteditable — when true, dispatch is skipped. Defaults
   * to the standard DOM check. Tests can inject `() => false`
   * to bypass DOM dependencies in pure-node environments.
   */
  isInputContext?: (target: EventTarget | null) => boolean;
}

function defaultIsInputContext(target: EventTarget | null): boolean {
  // Guard against the symbol being undefined in non-DOM contexts
  // (Node tests without jsdom). When HTMLElement is absent we
  // can't be inside an input field anyway.
  if (typeof HTMLElement === "undefined") return false;
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLInputElement) return true;
  if (target instanceof HTMLTextAreaElement) return true;
  if (target.isContentEditable) return true;
  return false;
}

function defaultTarget(): RuntimeActionRegistryTarget {
  if (typeof window === "undefined") {
    throw new Error(
      "[input-modes/registry] no default `target` available — " +
        "running outside a browser, pass `options.target` explicitly."
    );
  }
  return window as unknown as RuntimeActionRegistryTarget;
}

export function createRuntimeActionRegistry(
  options: CreateRuntimeActionRegistryOptions
): RuntimeActionRegistry {
  const target: RuntimeActionRegistryTarget =
    options.target ?? defaultTarget();
  const isInputContext = options.isInputContext ?? defaultIsInputContext;
  const actions = new Map<string, RegisteredAction>();
  let listenerInstalled = false;

  function onKeyDown(event: KeyboardEvent): void {
    const matches = planKeydownDispatch({
      actions: Array.from(actions.values()),
      mode: resolveRuntimeMode(options.stateStore.getState()),
      eventKey: event.key,
      isInputFocused: isInputContext(event.target)
    });
    for (const action of matches) {
      action.handler(event);
    }
  }

  function installListenerIfNeeded(): void {
    if (listenerInstalled) return;
    target.addEventListener("keydown", onKeyDown);
    listenerInstalled = true;
  }

  function uninstallListenerIfEmpty(): void {
    if (!listenerInstalled) return;
    if (actions.size > 0) return;
    target.removeEventListener("keydown", onKeyDown);
    listenerInstalled = false;
  }

  return {
    register(input) {
      if (actions.has(input.actionId)) {
        throw new Error(
          `[input-modes/registry] action "${input.actionId}" is ` +
            `already registered. Unregister the prior instance ` +
            `before re-registering.`
        );
      }
      const stored: RegisteredAction = {
        actionId: input.actionId,
        modes: Object.freeze([...input.modes]),
        key: input.key,
        handler: input.handler
      };
      actions.set(input.actionId, stored);
      installListenerIfNeeded();
      return () => {
        if (actions.get(input.actionId) === stored) {
          actions.delete(input.actionId);
          uninstallListenerIfEmpty();
        }
      };
    },
    getRegisteredActions() {
      return Array.from(actions.values());
    },
    dispose() {
      actions.clear();
      uninstallListenerIfEmpty();
    }
  };
}
