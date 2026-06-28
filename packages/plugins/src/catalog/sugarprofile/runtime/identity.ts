/**
 * packages/plugins/src/catalog/sugarprofile/runtime/identity.ts
 *
 * Purpose: SugarProfile's implementation of `UserIdentityProvider`
 * against Supabase Auth. Wraps `@supabase/supabase-js`'s auth
 * surface so the runtime-core contract is satisfied identically to
 * the anonymous-local default; the runtime contribution mechanism
 * (Plan 047 §47.2) swaps this in when SugarProfile is enabled with
 * a non-empty `supabaseUrl` + `supabaseAnonKey`.
 *
 * Implements: Plan 047 §Story 47.7
 *
 * Status: active
 */

import {
  createClient,
  type AuthChangeEvent,
  type AuthError,
  type Session,
  type SupabaseClient,
  type User as SupabaseUser
} from "@supabase/supabase-js";
import {
  NotSupportedError,
  type SignInWithPasswordInput,
  type User,
  type UserIdentityChangeListener,
  type UserIdentityProvider
} from "@sugarmagic/runtime-core";

export interface SupabaseIdentityProviderOptions {
  /** Supabase project URL. Required unless `client` is supplied. */
  supabaseUrl: string;
  /** Supabase anon key. Required unless `client` is supplied. */
  supabaseAnonKey: string;
  /** When true (default), new players are signed in anonymously on
   *  first `currentUser()` call. When false, `currentUser()` returns
   *  null until explicit `signIn` / `signUp`. */
  allowAnonymous: boolean;
  /** Optional pre-constructed client. Tests inject a mock; prod
   *  defers to `createClient(url, anonKey)`. */
  client?: SupabaseClient;
}

function normalizeUser(supabaseUser: SupabaseUser | null): User | null {
  if (!supabaseUser) return null;
  const displayName =
    typeof supabaseUser.user_metadata?.display_name === "string"
      ? supabaseUser.user_metadata.display_name
      : null;
  return {
    userId: supabaseUser.id,
    displayName,
    email: supabaseUser.email ?? null,
    // Supabase marks anonymous users via `is_anonymous` on the user
    // object (set true by signInAnonymously, flipped to false when
    // updateUser sets credentials). The field is present on every
    // sufficiently-modern auth-js release; fall through to false if
    // absent so we don't claim a real user is anonymous on an older
    // client.
    isAnonymous:
      typeof (supabaseUser as { is_anonymous?: boolean }).is_anonymous ===
      "boolean"
        ? Boolean((supabaseUser as { is_anonymous?: boolean }).is_anonymous)
        : false,
    createdAt: supabaseUser.created_at ?? new Date(0).toISOString()
  };
}

function userFromSession(session: Session | null): User | null {
  return normalizeUser(session?.user ?? null);
}

function throwIfAuthError(error: AuthError | null, operation: string): void {
  if (error) {
    throw new Error(
      `[sugarprofile] supabase auth ${operation} failed: ${error.message}`
    );
  }
}

/**
 * Constructs a `UserIdentityProvider` backed by Supabase Auth.
 *
 * Initialization: on construction, the provider asynchronously
 * pulls the current session (if any). If no session exists and
 * `allowAnonymous` is true, it kicks off `signInAnonymously` so
 * the player has an identity by the time the runtime renders.
 * `currentUser()` returns `null` during this brief async window
 * and the resolved user thereafter; `onChange` listeners fire when
 * the session settles.
 *
 * Hot-swap to credentialed via `linkAnonymousToCredentials`: the
 * Supabase `updateUser({ email, password })` call preserves the
 * underlying `id` and flips `is_anonymous` to false, so per-user
 * state keyed on `userId` survives the upgrade.
 */
export function createSupabaseIdentityProvider(
  options: SupabaseIdentityProviderOptions
): UserIdentityProvider {
  const client =
    options.client ??
    createClient(options.supabaseUrl, options.supabaseAnonKey, {
      auth: {
        // Persist the session in localStorage so a page reload keeps
        // the user signed in. Default for browser usage; named
        // explicitly here for clarity.
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false
      }
    });

  let currentUserCache: User | null = null;
  const listeners = new Set<UserIdentityChangeListener>();

  function emit(next: User | null): void {
    currentUserCache = next;
    for (const listener of listeners) listener(next);
  }

  // Async bootstrap: pull existing session, fall back to anonymous
  // sign-in when allowed. The `void` discards the promise — listeners
  // get notified via the auth-state-change subscription below when
  // the session settles, so concurrent `currentUser()` calls just
  // return `null` until then.
  void (async () => {
    try {
      const { data: sessionData, error: sessionError } =
        await client.auth.getSession();
      if (sessionError) {
        console.warn(
          "[sugarprofile] supabase getSession failed",
          sessionError
        );
      }
      const existingUser = userFromSession(sessionData.session ?? null);
      if (existingUser) {
        emit(existingUser);
        return;
      }
      if (options.allowAnonymous) {
        const { data: anonData, error: anonError } =
          await client.auth.signInAnonymously();
        if (anonError) {
          console.error(
            "[sugarprofile] supabase signInAnonymously failed",
            anonError
          );
          return;
        }
        const newUser = userFromSession(anonData.session ?? null);
        if (newUser) emit(newUser);
      }
    } catch (error) {
      console.error("[sugarprofile] supabase identity bootstrap failed", error);
    }
  })();

  // Subscribe to auth-state changes so sign-in / sign-out / token
  // refresh flips the cached user + notifies React subscribers
  // (UserContext) without per-tick polling.
  const subscriptionHandle = client.auth.onAuthStateChange(
    (_event: AuthChangeEvent, session: Session | null) => {
      const next = userFromSession(session);
      emit(next);
    }
  );

  return {
    currentUser(): User | null {
      return currentUserCache;
    },
    onChange(listener: UserIdentityChangeListener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async signIn(input: SignInWithPasswordInput): Promise<User> {
      const { data, error } = await client.auth.signInWithPassword({
        email: input.email,
        password: input.password
      });
      throwIfAuthError(error, "signIn");
      const next = userFromSession(data.session ?? null);
      if (!next) {
        throw new Error(
          "[sugarprofile] supabase signIn returned no session. Check the project's auth settings."
        );
      }
      emit(next);
      return next;
    },
    async signUp(input: SignInWithPasswordInput): Promise<User> {
      const { data, error } = await client.auth.signUp({
        email: input.email,
        password: input.password
      });
      throwIfAuthError(error, "signUp");
      const next =
        userFromSession(data.session ?? null) ?? normalizeUser(data.user);
      if (!next) {
        throw new Error(
          "[sugarprofile] supabase signUp returned no user. Email confirmation may be required by the project's auth settings; check Supabase dashboard."
        );
      }
      emit(next);
      return next;
    },
    async signOut(): Promise<void> {
      const { error } = await client.auth.signOut();
      throwIfAuthError(error, "signOut");
      emit(null);
      subscriptionHandle.data.subscription.unsubscribe();
    },
    async linkAnonymousToCredentials(
      input: SignInWithPasswordInput
    ): Promise<User> {
      const beforeUser = currentUserCache;
      if (!beforeUser) {
        throw new NotSupportedError(
          "[sugarprofile] linkAnonymousToCredentials requires a current anonymous user. Sign in or call signUp directly.",
          "sugarprofile"
        );
      }
      if (!beforeUser.isAnonymous) {
        throw new NotSupportedError(
          "[sugarprofile] linkAnonymousToCredentials requires the current user to be anonymous. The user is already credentialed.",
          "sugarprofile"
        );
      }
      const { data, error } = await client.auth.updateUser({
        email: input.email,
        password: input.password
      });
      throwIfAuthError(error, "linkAnonymousToCredentials");
      const next = normalizeUser(data.user);
      if (!next) {
        throw new Error(
          "[sugarprofile] supabase updateUser returned no user after link."
        );
      }
      if (next.userId !== beforeUser.userId) {
        throw new Error(
          `[sugarprofile] supabase linkAnonymousToCredentials changed userId (${beforeUser.userId} -> ${next.userId}). Per-user state would orphan; refusing to complete the link.`
        );
      }
      emit(next);
      return next;
    },
    async getAccessToken(): Promise<string | null> {
      // Story 47.9.5 — supabase-js auto-refreshes the access token
      // in the background (autoRefreshToken: true above), so
      // getSession() reads from its in-memory + localStorage cache
      // without any network call on the hot path. The token rotates
      // mid-session; per-request callers invoke this on every fetch
      // so the latest value lands on the wire transparently.
      try {
        const { data, error } = await client.auth.getSession();
        if (error) {
          console.warn(
            "[sugarprofile] supabase getSession failed in getAccessToken",
            error
          );
          return null;
        }
        return data.session?.access_token ?? null;
      } catch (error) {
        console.warn("[sugarprofile] getAccessToken threw", error);
        return null;
      }
    }
  };
}
