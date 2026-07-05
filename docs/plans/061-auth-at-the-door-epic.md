# Plan 061 — Auth at the door (launch-page sign-in, chrome-free game)

Status: implemented (061.1-061.4); 061.5 prod verification pending
Owner: nikki + claude
Date: 2026-07-05

Related: Plan 047 (SugarProfile — the identity provider, anonymous-first design, LoginModal + SignedInBadge this plan relocates). Plan 046 (published-web target — the deployed game this de-chromes). Plan 059 (start menu / quit-to-menu lifecycle the exit flow hangs off).

## Framing

Today the deployed game wears its account state on its face: the SignedInBadge pill sits permanently in the top-right corner over the game viewport (Plan 047 story 47.7.5), and sign-in happens through an in-game modal. It's in the way (nikki, 2026-07-05).

Genre survey (2026-07-05): Palia runs its entire account layer OUTSIDE the game — a dedicated accounts site (accounts.palia.com) for email/password, or platform identity (Steam) when launched there; the launcher establishes the session BEFORE the game boots, and in-game there is no persistent account chrome at all. RuneScape has used the same shape for two decades: website owns the account, "Play" hands a session to the game, the game assumes you're you. The pattern: **auth at the door, not in the room.** The game is full-bleed; the website is the airlock.

Target UX (nikki): sign in on the page that launches the game; Play boots the game with the session already established and zero account chrome; exiting the game returns you to the Play page.

## Decisions

1. **Session handoff: cookie-domain Supabase session.** `wordlarkhollow.com` and `game.wordlarkhollow.com` are different ORIGINS, so Supabase's default per-origin localStorage session does not travel. Chosen fix: switch the Supabase client to cookie-based session storage scoped to the parent domain (`.wordlarkhollow.com`) so the Play page and the game share the session natively — the same shape as Palia's `*.palia.com` properties. Rejected: URL-fragment token handoff (more moving parts, token hygiene concerns); same-origin proxy via Netlify rewrites (couples the site and game deploys).
2. **Anonymous-first survives.** The door is optional, not a gate: the Play page offers "Play as guest" which boots the game exactly as today (anonymous session on first boot, Plan 047). Because the session cookie is domain-shared, the guest's anonymous session is visible to the SITE too — so "create an account to keep your progress" upgrade (linkAnonymousToCredentials) moves to the site and still migrates progress in place.
3. **The launch page is per-game site territory; sugarmagic ships the contract.** wordlark's Play page lives in the wordlark-web repo. What sugarmagic owns: the SugarProfile plugin config that makes the handoff work (cookie domain, `playPageUrl`) and the game-side behavior (trust the session, exit redirects). Other games implement their own door against the same contract.
4. **Quit stays in-game; Exit leaves.** Quit-to-menu keeps its current meaning (back to the start menu, session intact). The start menu gains an "Exit" affordance that redirects to `playPageUrl` — that's the "kicks you back to the Play Game screen" beat.
5. **(2026-07-05, nikki) The Play page ships public-but-unlinked** (noindex, no nav entry) on the pre-launch site; it gets linked when the game goes public.
6. **(2026-07-05, nikki) Subscription payment joins sign-up LATER — standing constraint.** Nothing in this epic may collapse "account exists" and "can play" into one inseparable step; an entitlement check must be able to slot between them without rework. Sign-up living on the site (where a checkout can mount) and the game's boot-time session trust being one seam are the two load-bearing choices.
7. **(2026-07-05, nikki) There is ONE Supabase project and it is the game's auth** — wordlark-web docs that called it a "waitlist" were misframed (the waitlist is Mailchimp). The Play page signs into the same project the game's SugarProfile config points at.
8. **Implementation decisions:** `playPageUrl` lives in SugarProfile config beside `sessionCookieDomain` (both halves of the door contract in one panel). The site-side cookie adapter is a byte-format TWIN copied into wordlark-web (`src/lib/gameSessionStorage.ts`) — cross-repo import isn't available, so both files carry a paired-file warning; the chunk naming mirrors @supabase/ssr but the value encoding is plain URI-encoded JSON (NOT ssr-compatible). The in-game LoginModal survives required-mode-only; SignedInBadge and the upgrade mode were deleted (upgrade lives on the Play page via `auth.updateUser`).

## Stories

### 061.1 — Cookie-domain session storage in SugarProfile

- Supabase client in the published-web runtime uses a cookie storage adapter with a configurable cookie domain (plugin config: `sessionCookieDomain`, e.g. `.wordlarkhollow.com`). Unset = current localStorage behavior (Studio preview, localhost, games without a site).
- Anonymous sessions ride the same cookie — required by decision 2.
- Verify: sign in on any `*.wordlarkhollow.com` origin, session visible on the other.

### 061.2 — De-chrome the game

- Remove the SignedInBadge pill from the deployed game entirely.
- The in-game LoginModal stops being the primary sign-in: with a session cookie present the game boots straight into it; with none (and anonymous-first on) it boots a guest. The modal survives only as a fallback for direct-URL visitors when anonymous-first is OFF (a game that requires accounts must still be playable when someone bookmarks game.*).
- Identity becomes a quiet start-menu line ("playing as <name>" / "guest"), not an overlay over gameplay.

### 061.3 — Exit to the Play page

- New `playPageUrl` plugin config (SugarProfile or deployment settings — decide at implementation; it's a per-game published-web concern).
- Start menu gains an Exit button (authored default menus get it like the Episodes button did) whose action redirects to `playPageUrl`. Hidden when no URL is configured.
- Sign-out moves to the site; if the game ever needs it (fallback modal path), signing out also exits to the door.

### 061.4 — wordlark's Play page (wordlark-web repo)

- Landing page with Play: Supabase sign-in / sign-up / play-as-guest against the SAME Supabase project (config comes from the game's published runtime env — document the wiring).
- Signed-in state shows "Play" + account bits (email, sign out, upgrade-from-guest per decision 2).
- Play button navigates to game.wordlarkhollow.com; the cookie session does the rest.

### 061.5 — Verify the full loop in prod

- Sign in on wordlarkhollow.com -> Play -> game boots signed in, NO pill, no modal.
- Guest loop: Play as guest -> game boots anonymous -> back on the site, upgrade to account -> progress intact in-game.
- Exit from the start menu lands on the Play page with session intact; sign out on the site; revisiting the game direct-URL behaves per 061.2.

## Defers

- **OAuth / platform identity providers** (Google, Discord — the "Login with Steam" analog). The cookie-domain session makes these a Play-page-only change later.
- **Multi-game account portal** (one FoxLeapMoon account across games) — needs its own accounts.* thinking; single-game cookie domain is deliberately narrower.
- **In-game account management UI** — explicitly not wanted; the site owns it. Revisit only if a platform (itch embed, etc.) can't host a door page.
