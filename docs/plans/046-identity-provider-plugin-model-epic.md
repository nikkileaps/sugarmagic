# Plan 046 — Identity Provider Plugin Model

**Status:** Proposed (not yet Accepted)

**Owner:** nikki + claude

**Cross-references:** [Plan 045](045-sugardeploy-cloud-run-plugin-owned-infrastructure-epic.md) (especially story 45.5.7 which lands the `gatewayAuthMode` field this epic expands).

---

## Motivation

Plan 045's 45.5.7 unblocks the gateway's public reachability so the build → push → deploy → invoke pipeline is verifiable end-to-end. But it ships a gateway with **no auth check at all** — any HTTP caller that finds the URL hits every route. That's an acceptable interim state for a verification-only deploy with no plugin routes that cost money; it's NOT acceptable as soon as SugarAgent (or any other plugin with billable LLM/embedding calls) lands.

Sugarmagic's whole premise is "plugins are the unit of capability." Authentication and per-user state should ride on that same model: identity-provider plugins contribute auth middleware that the deployment plugin's gateway consumes. The game author picks one (or none, or stacks several with priority) at deploy-time; the choice is captured in the deployment plan and flows through to the generated `server.mjs`.

The 45.5.7 conversation surfaced four candidate auth shapes worth tracking:

- **Supabase Auth** — built-in anonymous mode → real-account upgrade path, `auth.users` is a Postgres table you can join against directly, JWT validation is a 30-line middleware. Pairs naturally with using Supabase's Postgres for game state.
- **Auth0** — mature, social logins, hosted UI, but adds a vendor and gets expensive at scale; user records live in Auth0's system not yours.
- **Firebase Auth** — Google's hosted auth, generous free tier, but user records in Firebase's system not a SQL table you query.
- **Roll-your-own (old-wordlark style)** — Fastify + cookie sessions + shared alpha credentials. Proven shape, full control, all the maintenance burden.

The "right answer" for a given game depends on its player model, scale, vendor preferences, and stack. The platform shouldn't pick one; it should make all of them pluggable.

## Required outcomes

1. **A plugin contribution type for identity providers** in the SugarDeploy SDK. Each provider plugin contributes:
   - Required deployment secrets (e.g. Supabase URL + anon key + service-role key) that flow through the existing Set Value modal.
   - Validation middleware code that the generator weaves into the baseline `server.mjs`.
   - Optional Studio user-management UI (e.g. a "Users" workspace).
   - A unique identity-provider id that becomes a valid value for `gatewayAuthMode`.

2. **At least one concrete provider implementation.** Likely Supabase given the anonymous-then-upgrade alignment with wordlark's stated model, but the choice gets revisited during scoping.

3. **`gatewayAuthMode` enum expansion.** The current `"none"` stays; identity-provider ids join it. Selecting a non-`"none"` mode wires that provider's middleware into the generated `server.mjs` and shows that provider's required-secret rows in the Secrets section of the form.

4. **Per-route auth gating.** Plugin routes (proxy-route requirements from SugarAgent, etc.) get wrapped with the configured provider's middleware so an unauthenticated caller gets 401 before any billable downstream call. `/healthz` and `/readyz` stay public regardless of mode.

5. **Backward compatibility with no-auth deployments.** `gatewayAuthMode: "none"` continues to work for verification-only deploys and games that don't have billable routes. The generated README's call-out about budget risk stays.

## Open questions (resolved during epic-scoping, not now)

- **Which provider ships first?** Best guess: Supabase. Final answer depends on whether nikki commits to Postgres for game state.
- **How does the SDK expose middleware code-gen?** Provider plugins return strings? AST nodes? Compose at runtime via `server.mjs` import-of-discovered-plugins? Big design surface.
- **Per-user data model abstraction.** Do plugins query their provider's user table directly, or does Sugarmagic offer a shared "user" abstraction with provider-specific bindings underneath?
- **How does the game-side SDK look?** Each provider has its own JS SDK (`@supabase/supabase-js`, `@auth0/auth0-spa-js`, etc.). The game author shouldn't have to think about which one to import based on their gateway config — Sugarmagic could re-export the right one via the runtime plugin manifest.
- **Provider-specific Studio UI.** A "Users" workspace tied to Supabase looks different from one tied to Auth0. Does Sugarmagic provide a shared abstraction or do plugins ship their own workspaces?
- **Anonymous-to-authenticated upgrade.** Supabase has first-class support; Auth0 doesn't. How does the SDK model the "guest now, account later" promotion across providers?
- **Multiple providers simultaneously?** Some games want Google sign-in OR email/password OR guest. Does a deployment pick one or compose several? If composed, with what precedence?
- **Token refresh / session length.** Defaults vary by provider. Sugarmagic should expose this as a configurable but provide sensible defaults.

## Cross-references

- [Plan 045](045-sugardeploy-cloud-run-plugin-owned-infrastructure-epic.md) story 45.5.7 — lands the `gatewayAuthMode` field this epic expands, and the public-reachability infrastructure that real auth runs on top of.
- [Plan 045](045-sugardeploy-cloud-run-plugin-owned-infrastructure-epic.md) story 45.8.5 — the lifecycle UX overhaul that Plan 046 should slot its user-management workspace and provider-selection field into.

## Status notes

- 2026-06-19: Plan created as a stub during Plan 045 work. Concrete stories will be filled in when the epic is accepted, after Plan 045 wraps and game-side auth needs become more concrete.
