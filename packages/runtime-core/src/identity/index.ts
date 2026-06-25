/**
 * packages/runtime-core/src/identity/index.ts
 *
 * Purpose: Public contract for "who is playing this game right now."
 * A `UserIdentityProvider` is the runtime hook every plugin queries
 * when it needs to key its per-user state on a stable id.
 *
 * Sugarmagic ships a default `AnonymousLocalIdentityProvider` (in
 * `./anonymous-local`) so a bare game without any plugins still has
 * an identity to key on. The SugarProfile plugin (Plan 047)
 * contributes a `SupabaseIdentityProvider` that overrides the default
 * with a real Supabase user when the plugin is enabled.
 *
 * Naming: `User` is the human at the keyboard. The in-game avatar
 * (height, walkSpeed, casterProfile, etc.) is `PlayerDefinition`,
 * which lives on `GameProject` and is unrelated to this contract.
 *
 * Implements: Plan 047 §Story 47.1
 *
 * Status: active
 */

/**
 * The human-at-the-keyboard's identity for the lifetime of this
 * runtime session. `userId` is stable for a given user across sign-
 * ins / sign-outs (the anonymous user's UUID is preserved when they
 * upgrade to credentialed via `linkAnonymousToCredentials`).
 */
export interface User {
  /** Stable across credential upgrades for the same human. */
  userId: string;
  /** Human-readable label. May be the email's local-part, a chosen
   *  display name, or null for an anonymous user who hasn't supplied
   *  either. Never used to key state — use `userId` for that. */
  displayName: string | null;
  /** Set when the user has credentialed (email/password or social).
   *  Null for anonymous users. */
  email: string | null;
  /** True when the user has no credentials attached and is identified
   *  only by a locally-generated id. Flips to false when
   *  `linkAnonymousToCredentials` succeeds. */
  isAnonymous: boolean;
  /** ISO timestamp when this user record was first observed. */
  createdAt: string;
}

export type UserIdentityChangeListener = (user: User | null) => void;

export interface SignInWithPasswordInput {
  email: string;
  password: string;
}

/**
 * Thrown by `UserIdentityProvider` implementations whose capability
 * surface doesn't cover the requested operation. The default
 * anonymous-local provider throws this for `signIn` / `signUp` /
 * `linkAnonymousToCredentials` since credentialed auth requires a
 * plugin (SugarProfile or similar).
 *
 * The thrown error carries the canonical plugin id authors should
 * install to unlock the operation, so UIs can surface a "Install
 * SugarProfile to sign in" affordance instead of a generic error.
 */
export class NotSupportedError extends Error {
  readonly suggestedPluginId: string | null;
  constructor(message: string, suggestedPluginId: string | null = null) {
    super(message);
    this.name = "NotSupportedError";
    this.suggestedPluginId = suggestedPluginId;
  }
}

/**
 * Runtime contract for resolving "the current user." Every plugin
 * that owns per-user state reads this to obtain the `userId` it
 * keys its store on.
 *
 * Implementation contract:
 *   - `currentUser()` MUST return a stable `User` for the duration
 *     of a session unless `signIn` / `signOut` /
 *     `linkAnonymousToCredentials` runs. Returning a fresh `User`
 *     object every call is fine; returning a fresh `userId` is not.
 *   - `onChange` MUST fire when the user identity changes (sign-in,
 *     sign-out, link). The listener receives the new `User` or
 *     `null` if the session is cleared.
 *   - `signOut()` for providers that support credentialed users
 *     returns to anonymous; the same `userId` is NOT preserved.
 *   - `linkAnonymousToCredentials` MUST preserve `userId` (so
 *     per-user state stays addressable across the upgrade).
 *   - Operations the implementation doesn't support MUST throw
 *     `NotSupportedError` rather than silently no-op.
 */
export interface UserIdentityProvider {
  currentUser(): User | null;
  onChange(listener: UserIdentityChangeListener): () => void;
  signIn(input: SignInWithPasswordInput): Promise<User>;
  signUp(input: SignInWithPasswordInput): Promise<User>;
  signOut(): Promise<void>;
  linkAnonymousToCredentials(
    input: SignInWithPasswordInput
  ): Promise<User>;
}

export {
  createAnonymousLocalIdentityProvider,
  type AnonymousLocalIdentityProviderOptions
} from "./anonymous-local";
