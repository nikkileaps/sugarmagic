/**
 * targets/web/src/identity/useUserContext.ts
 *
 * Purpose: React-side bindings for the published-web bundle's
 * identity + save infrastructure. App.tsx constructs the active
 * `UserIdentityProvider` and `GameSaveStore` at boot, mounts them on
 * the `UserContext` via `UserContextProvider`, and any descendent
 * component (today: none; future: SugarProfile's login modal, plugin
 * UIs surfacing "Logged in as X") reads them via `useUserContext`.
 *
 * The runtime itself (the three.js canvas, the game world) reads the
 * resolved `userId` + `savedGame` directly during `host.start`; it
 * doesn't need to subscribe to the React context because the runtime
 * is not a React tree. This module exists for the React-side UI
 * around the runtime canvas (login affordances, plugin-contributed
 * modals, plus future SugarProfile in 47.10).
 *
 * Implements: Plan 047 §Story 47.5
 *
 * Status: active
 */

import {
  createContext,
  createElement,
  useContext,
  type ReactNode
} from "react";
import type {
  GameSaveStore,
  User,
  UserIdentityProvider
} from "@sugarmagic/runtime-core";

export interface UserContextValue {
  /** The user the runtime is keyed on for this session. Stable for
   *  the lifetime of the page; signed-in changes flow through
   *  `identityProvider.onChange`. */
  user: User;
  /** The active identity provider. Default is
   *  AnonymousLocalIdentityProvider; SugarProfile (Plan 047 §47.7)
   *  overrides via the runtime contribution mechanism. */
  identityProvider: UserIdentityProvider;
  /** The active save store. Default is IndexedDBGameSaveStore;
   *  SugarProfile overrides similarly. */
  saveStore: GameSaveStore;
}

const UserContext = createContext<UserContextValue | null>(null);

export interface UserContextProviderProps {
  value: UserContextValue;
  children: ReactNode;
}

export function UserContextProvider(props: UserContextProviderProps) {
  return createElement(
    UserContext.Provider,
    { value: props.value },
    props.children
  );
}

/**
 * Reads the active `UserContextValue` from the React tree. Throws
 * when used outside a `UserContextProvider` — the published-web
 * bundle's boot path ALWAYS mounts the provider before rendering
 * runtime UI, so missing-provider is a programmer error rather than
 * a runtime condition. Catching the throw in a SugarProfile login
 * modal would mean the modal was rendered too early.
 */
export function useUserContext(): UserContextValue {
  const value = useContext(UserContext);
  if (!value) {
    throw new Error(
      "[target-web] useUserContext was called outside a UserContextProvider. Mount the provider in App.tsx's boot path before rendering UI that reads identity or save state."
    );
  }
  return value;
}
