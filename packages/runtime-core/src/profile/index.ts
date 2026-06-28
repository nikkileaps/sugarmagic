/**
 * packages/runtime-core/src/profile/index.ts
 *
 * Purpose: Public contract for "per-user authored data outside the
 * game-progress save." Identity (`UserIdentityProvider`) answers
 * "who's playing." `GameSaveStore` answers "where in the game."
 * `UserProfileStore` answers "what does this user prefer" —
 * display name, locale (language preference), arbitrary
 * preferences JSON. Owned by the SugarProfile plugin (Plan 047);
 * other plugins (Sugarlang's support-language lookup, future
 * audio-volume preferences, etc.) read it via the runtime
 * contribution mechanism instead of writing their own per-user
 * tables.
 *
 * No default implementation in core. Anonymous-local play has no
 * profile concept; the resolver returns `null` when no plugin
 * contributes, and consumers gracefully fall through to their own
 * defaults.
 *
 * Implements: Plan 047 §Story 47.8
 *
 * Status: active
 */

/**
 * The per-user authored profile. SugarProfile-owned schema; other
 * plugins read fields they care about via the runtime contribution
 * mechanism. `preferences` is a plugin-extension catch-all — keys
 * are namespaced by plugin (e.g. `"sugarlang.uiLocale"`,
 * `"ui.audio.master"`).
 */
export interface UserProfile {
  userId: string;
  /** User-chosen display name. Null when the user has not yet set
   *  one; consumers fall back to email-local-part or the userId. */
  displayName: string | null;
  /** BCP 47 locale code. Sugarlang reads this for the player's
   *  support language; the published-web shell reads it for UI
   *  language. Defaults to "en" when the profile row is fresh. */
  locale: string;
  /** Plugin-extensible namespaced preferences. Plugins read
   *  their own keys; the schema is intentionally untyped at the
   *  contract level so plugins don't depend on each other. */
  preferences: Record<string, unknown>;
  /** ISO timestamp of the most recent update. */
  updatedAt: string;
}

/** Patch shape for `update()`. All fields optional; passing
 *  `undefined` leaves the column alone. `preferences` REPLACES the
 *  entire preferences blob — use `setPreference()` for merge
 *  semantics. */
export interface UserProfilePatch {
  displayName?: string | null;
  locale?: string;
  preferences?: Record<string, unknown>;
}

/**
 * Read + write contract for `UserProfile`. Backed by SugarProfile
 * (Supabase Postgres) when contributed; resolver returns `null`
 * when no plugin contributes (the anonymous-local case where the
 * concept of "profile" doesn't apply).
 *
 * Implementation contract:
 *   - `load(userId)` returns `null` when no profile row exists.
 *     SugarProfile's auto-create trigger means this should be rare
 *     once a user has signed up — but the contract permits null
 *     for the pre-sign-up window.
 *   - `update(userId, patch)` is an upsert: missing rows get
 *     created with the patch values + defaults for the rest.
 *     Returns the updated row.
 *   - `setPreference(userId, key, value)` merges `{ [key]: value }`
 *     into `preferences` without clobbering siblings. Convenience
 *     wrapper to avoid the load-merge-update dance in callers.
 */
export interface UserProfileStore {
  load(userId: string): Promise<UserProfile | null>;
  update(userId: string, patch: UserProfilePatch): Promise<UserProfile>;
  setPreference(
    userId: string,
    key: string,
    value: unknown
  ): Promise<void>;
}
