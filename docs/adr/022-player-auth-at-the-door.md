# ADR 022: Player Auth at the Door

## Status

Accepted.

## Context

A deployed sugarmagic game and its marketing/launch site live on
different origins of the same parent domain (e.g.
`game.wordlarkhollow.com` and `wordlarkhollow.com`). Player
accounts are Supabase Auth (ADR 020). Early builds rendered
account chrome inside the game — a persistent signed-in pill,
an in-game sign-in/upgrade modal — which sat over the viewport
and conflated two products: the game and the account system.

The genre convention (Palia, RuneScape) is the opposite: the
site owns the account; the launcher/page establishes the session
BEFORE the game boots; the game renders no account chrome and
trusts the handoff.

## Decision

**Auth happens at the door (the site's Play page), not in the
room (the game).**

1. **The site owns the account surface.** Sign-in, sign-up,
   sign-out, and any future account management live on the
   game's launch page in the game's site repo. The engine ships
   the contract, not the page.
2. **The session travels by parent-domain cookie.** When
   SugarProfile's `sessionCookieDomain` setting is present (e.g.
   `.wordlarkhollow.com`), the Supabase client persists its
   session via a chunked cookie storage adapter
   (`packages/plugins/src/catalog/sugarprofile/runtime/cookie-session-storage.ts`)
   instead of per-origin localStorage, so every subdomain shares
   one session. Values are plain URI-encoded JSON split across
   `key.0..key.N` cookies (~4KB ceiling); the chunk NAMING
   mirrors @supabase/ssr but the encoding does not — the two are
   not interchangeable. The adapter only engages when the
   current hostname is covered by the configured domain
   (localhost preview keeps localStorage).
3. **The site runs a byte-format twin of the adapter.** Cross-
   repo import isn't available, so the site repo carries a copy
   (wordlark: `src/lib/gameSessionStorage.ts`). Both files carry
   paired-file warnings; a format change must land on both sides
   or the handoff silently breaks.
4. **The game renders no account chrome.** No pill, no badge.
   Identity is a quiet line on the start menu. The in-game
   `LoginModal` survives only as the required-sign-in fallback:
   it mounts when `allowAnonymous` is off and no session exists
   (a direct-URL visitor to an accounts-only game).
5. **Exit returns to the door.** The `exit-to-site` UI action
   force-saves, then navigates to SugarProfile's `playPageUrl`.
   Authored exit buttons hide entirely in builds with no Play
   page configured. Quit-to-menu keeps its in-game meaning;
   exiting does NOT sign the player out — sign-out is an
   explicit act on the site.
6. **Anonymous play is a per-game choice.** The engine keeps
   `allowAnonymous`; a game may run accounts-only (wordlark
   does) or guest-first. Guest upgrade, where used, belongs on
   the site (`auth.updateUser` preserves the user id, so
   progress carries over).

## Constraint that binds future work

**"Account exists" and "can play" must remain separable beats.**
Subscription payment will join the sign-up flow later; an
entitlement check must be able to slot between session
establishment and game entry without rework. Do not build
anything that hard-wires "session exists = can play."

## Consequences

- The Play page and the game must agree on three values:
  Supabase project URL + publishable key, and the cookie domain.
  The engine side is SugarProfile plugin config; the site side
  is the site repo's config module.
- Session lifetime is governed by Supabase token refresh, not
  cookie Max-Age; either surface refreshes the shared cookie.
- Games without a site lose nothing: no `sessionCookieDomain`
  means per-origin localStorage sessions, no `playPageUrl` means
  no exit affordance — the pre-door behavior.

## Code

- `packages/plugins/src/catalog/sugarprofile/runtime/cookie-session-storage.ts`
- `packages/plugins/src/catalog/sugarprofile/index.ts` (config + client wiring)
- `packages/runtime-core/src/ui-actions/index.ts` (`exit-to-site`)
- `targets/web/src/GameUILayer.tsx` (identity line + exit-button gating)
- wordlark-web: `src/pages/play.astro`, `src/lib/gameSessionStorage.ts`,
  `src/config/gameAccount.ts`
