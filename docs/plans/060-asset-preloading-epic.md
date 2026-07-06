# Plan 060 — Asset preloading + delivery (don't start the game before its files)

Status: proposed
Owner: nikki + claude
Date: 2026-07-05

Related: Plan 059 (its prod dress rehearsal surfaced this — deployed music started seconds late because the mp3 only began downloading when the track was first played). The 059 asset-shipping fix (`collectFileBackedAssetPaths` + boot.json's site-relative `assetSources` map + the workflow shipping `assets/`) is this plan's substrate: the runtime now knows, at boot, the complete list of every file it will ever need and where to get it.

## Framing

The "Loading game data" screen currently covers boot.json fetch, provider/save resolution, and world construction — and nothing else. Every file-backed asset loads LAZILY at first use:

- **Audio**: the web adapter constructs the Howl (and starts the download) on the first `play-cue` for that clip. A menu theme authored at 3MB starts downloading when the menu appears and plays whenever enough has buffered — the delay nikki observed in prod (2026-07-05).
- **Models / textures**: the render side resolves URLs at spawn and streams GLBs after gameplay is already interactive — meshes pop in late. Wordlark hasn't noticed only because its prod content is mostly builtins + procedural landscape; the first real GLB in prod will.

The intent (nikki, 2026-07-05): the game should not start until its assets are loaded — the loading screen should mean something.

## Design decisions / tensions

- **Preload everything vs. Scene-scoped.** Bake-everything (Plan 058 tension #1) means the full asset list is small today — preload it all, keep the logic dumb. When a game's asset payload grows, the refinement is priority tiers: current-Scene assets gate the loading screen, the rest warm in the background. Design the preloader so the input is "a list of paths" — swapping in a filtered/prioritized list later is additive.
- **Audio unlock is orthogonal.** Browsers block audio PLAYBACK until the first user gesture regardless of preloading. Preloading still wins: it puts the bytes in the browser cache so playback is instant the moment the gesture lands. The loading screen must not wait on "audio playing" — only on "audio fetched."
- **Loading UX honesty.** A progress readout ("Loading assets 3/12") beats a spinner; failures should degrade per-asset (warn + continue, matching the adapter's existing missing-source tolerance), never hang the boot.

## Stories

### 060.1 — Boot preload phase (gate the game on fetched assets)

- New boot step between provider resolution and world spawn: fetch every URL in `state.assetSources` (the map is already the complete file-backed asset list per Plan 059's collector). `fetch()` into the HTTP cache is sufficient — the render/audio loaders re-request by URL and hit cache; no in-memory handoff needed for v1.
- Progress surfaced on the existing loading screen: per-asset counter, current file name optional. Failures warn and continue (per-asset tolerance, no boot hang); a hard timeout per asset keeps a dead CDN from bricking the game.
- Preview (Studio) uses blob URLs that are already local — the preload phase should be near-instant there; verify it doesn't regress preview boot time.
- Lifecycle: the world spawn + entry title sequence wait for the gate. The 059 entry sequence then genuinely masks a READY world instead of a loading one.

### 060.2 — Cache headers for deployed assets

- Netlify currently serves `/assets/*` with `max-age=0, must-revalidate` (observed 2026-07-05) — every visit re-downloads everything.
- Ship a `_headers` file in the published-web managed files with immutable caching for `/assets/*`, made safe by **deploy-time URL stamping** (decided at implementation, 2026-07-05, prompted by nikki's cache-busting question): the workflow rewrites the dist boot.json's `assetSources` values to `path?v=<deployed sha>`. New deploy = new URLs = browsers fetch fresh with zero manual busting, for nikki and players alike; the sha in DevTools also identifies which publish a request came from. Stamp is per-deploy (all assets re-download once per deploy) — per-file hashing is the deferred upgrade.
- boot.json stays `max-age=0, must-revalidate` (it must update on every deploy — it is the URL source).

### 060.3 — Verify in prod + measure

- Deploy to wordlark: cold-load → loading screen shows asset progress → menu appears with music ready to start on first gesture (no multi-second lag).
- Second visit: assets served from cache; loading phase near-instant.
- Regression pass: Studio preview boot time unchanged; Scene advance reload (which re-boots) benefits from the HTTP cache and stays fast.

## Defers

- **Scene-scoped preload priority** (the tension above) — gate on current-Scene assets only, background-warm the rest. Revisit trigger: a game whose full asset payload makes the all-assets gate noticeably slow (multi-MB GLB libraries).
- **Per-file content hashing** — the per-deploy `?v=<sha>` stamp re-downloads ALL assets on every deploy; content-hashed per-file versions would re-download only changed files. Revisit trigger: asset payloads large enough that a routine deploy's full re-download is noticeable (multi-MB GLB libraries / the Plan 058 load-per-Scene defer). Immutable caching itself shipped in 060.2.
- **Streaming-priority hints** (preload critical, lazy-load distant regions) — needs the spatial model; far future.
