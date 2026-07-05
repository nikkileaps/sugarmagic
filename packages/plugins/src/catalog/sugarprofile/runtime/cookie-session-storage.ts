/**
 * packages/plugins/src/catalog/sugarprofile/runtime/cookie-session-storage.ts
 *
 * Purpose: Plan 061 §061.1 — a Supabase `auth.storage` adapter
 * that persists the session in COOKIES scoped to a parent domain
 * (e.g. `.wordlarkhollow.com`) instead of per-origin
 * localStorage. This is what lets the Play page
 * (wordlarkhollow.com) and the game (game.wordlarkhollow.com)
 * share one auth session — the Palia model: auth at the door,
 * the game trusts the handoff.
 *
 * Chunking: a Supabase session JSON (access JWT + refresh token +
 * metadata) can exceed the ~4KB per-cookie limit, so values are
 * split across `${key}.0`, `${key}.1`, ... and reassembled by
 * reading ascending indices until one is missing — the same
 * scheme Supabase's own @supabase/ssr package uses, so a session
 * written by a Play page built on that package is readable here
 * and vice versa.
 *
 * The adapter matches auth-js's `SupportedStorage` shape
 * (getItem/setItem/removeItem, sync returns are fine). It is
 * deliberately dependency-free — document.cookie only.
 *
 * Status: active
 */

/** Keep chunks comfortably under the 4KB cookie ceiling once the
 *  attribute suffix (domain/path/max-age/...) is added. Matches
 *  @supabase/ssr's chunk size. */
const MAX_CHUNK_SIZE = 3180;

/** One year. Supabase rewrites the cookie on every token refresh,
 *  so the practical lifetime is the refresh token's, not this. */
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

function readCookie(name: string): string | null {
  const prefix = `${name}=`;
  for (const part of document.cookie.split("; ")) {
    if (part.startsWith(prefix)) {
      return decodeURIComponent(part.slice(prefix.length));
    }
  }
  return null;
}

function writeCookie(
  name: string,
  value: string,
  cookieDomain: string,
  maxAgeSeconds: number
): void {
  document.cookie = [
    `${name}=${encodeURIComponent(value)}`,
    `Domain=${cookieDomain}`,
    "Path=/",
    `Max-Age=${maxAgeSeconds}`,
    "SameSite=Lax",
    "Secure"
  ].join("; ");
}

function deleteCookie(name: string, cookieDomain: string): void {
  writeCookie(name, "", cookieDomain, 0);
}

export interface CookieSessionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function createCookieSessionStorage(
  cookieDomain: string
): CookieSessionStorage {
  return {
    getItem(key: string): string | null {
      // Un-chunked cookie first (small sessions / foreign writers).
      const whole = readCookie(key);
      if (whole !== null) return whole;
      const chunks: string[] = [];
      for (let index = 0; ; index += 1) {
        const chunk = readCookie(`${key}.${index}`);
        if (chunk === null) break;
        chunks.push(chunk);
      }
      return chunks.length > 0 ? chunks.join("") : null;
    },

    setItem(key: string, value: string): void {
      this.removeItem(key);
      // encodeURIComponent expansion counts against the cookie
      // limit, so chunk the ENCODED length back down to raw slices.
      if (encodeURIComponent(value).length <= MAX_CHUNK_SIZE) {
        writeCookie(key, value, cookieDomain, COOKIE_MAX_AGE_SECONDS);
        return;
      }
      let index = 0;
      let rest = value;
      while (rest.length > 0) {
        let sliceLength = Math.min(rest.length, MAX_CHUNK_SIZE);
        while (
          encodeURIComponent(rest.slice(0, sliceLength)).length >
          MAX_CHUNK_SIZE
        ) {
          sliceLength = Math.floor(sliceLength * 0.9);
        }
        writeCookie(
          `${key}.${index}`,
          rest.slice(0, sliceLength),
          cookieDomain,
          COOKIE_MAX_AGE_SECONDS
        );
        rest = rest.slice(sliceLength);
        index += 1;
      }
    },

    removeItem(key: string): void {
      deleteCookie(key, cookieDomain);
      for (let index = 0; ; index += 1) {
        if (readCookie(`${key}.${index}`) === null) break;
        deleteCookie(`${key}.${index}`, cookieDomain);
      }
    }
  };
}
