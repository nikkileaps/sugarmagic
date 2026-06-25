# ADR 019: Engine vs. Game Lifecycle Split

## Status

Accepted (architectural rule); production implementation is
[Plan 048](/docs/plans/048-ghcr-published-target-web-epic.md).
The stopgap shipped under Plan 046 stories 46.4 + 46.10 (the
Build Frontend button + a committed `dist/` in the game repo)
implements the rule on a "good enough for now" substrate; Plan
048 reshapes the substrate without changing the rule.

## Context

Sugarmagic ships two artifacts that look superficially similar but
move at different cadences:

- **Engine** (`@sugarmagic/target-web`): the game-agnostic browser
  runtime. New version = a sugarmagic release. Infrequent,
  deliberate, human-curated. Owned by the engine maintainer.
- **Game** (wordlark, etc.): the per-game payload -- entities,
  dialogue, scripted middleware configs, lore pointers. Changes
  every save. Owned by the game author.

Plan 045 + 046 landed without a clean separation: the deploy
flow built the engine + assembled the per-game payload + shipped
both as one Netlify deploy. That conflation makes the game repo
carry a checked-in `dist/` directory (engine output bloat in
game source control), pins all games to whichever engine commit
the game author last ran Build Frontend against, and forces a
re-build per game even when the engine hasn't moved.

The decision below splits the two lifecycles cleanly. Today's
implementation is the stopgap (committed `dist/`); the production
implementation (Plan 048) is a GHCR-published engine image that
games pin a version of and Studio offers Unity-style upgrade
prompts for. The architectural rule is the same either way; only
the substrate changes.

## Decision

### Engine bundle is game-agnostic

`@sugarmagic/target-web` is a strict consumer of `boot.json` at
runtime. It MUST NOT bake any per-game data (entity ids, dialogue
strings, lore pointers, vendor model defaults) into the build
output. The published `dist/` directory is the same byte-for-byte
output across every game that pins the same engine version.

A consequence is that `pnpm --filter @sugarmagic/target-web build`
in the engine repo produces a single artifact suitable for all
games. The engine doesn't know which game it's serving until
runtime fetches `boot.json`.

### Per-game runtime payload lives in `.sugarmagic/published-web/boot.json`

`boot.json` is the per-game contract the engine reads on boot.
SugarDeploy emits it via `buildPublishedWebManagedFiles(gameProject,
snapshot)` on every save. The payload includes:

- `schemaVersion` -- pinned to `BOOT_JSON_SCHEMA_VERSION`. The
  engine asserts compatibility on read; mismatches fail loud
  with a clear "engine version vs. boot.json version" message.
- The full normalized `GameProject` snapshot the runtime needs
  (entities, dialogues, HUD definition, asset sources, etc.).
- Plugin-specific runtime payloads keyed by `pluginBootPayloads`.

`boot.json` is git-tracked in the game repo (committed alongside
`project.sgrmagic`). It IS the per-game source of truth at
deploy time; nothing in the runtime path reads anything else
game-specific.

### Engine releases and game deploys have independent cadences

- **Engine releases** are a sugarmagic-repo concern. Today: bumping
  `@sugarmagic/target-web` and running the Build Frontend button
  in a game's Provision workspace, which copies the freshly-built
  bundle into the game's `.sugarmagic/published-web/dist/`. Plan
  048 reshapes this into a manual GHA `workflow_dispatch` that
  publishes `ghcr.io/nikkileaps/target-web:vX.Y.Z` to GHCR --
  triggered by nikki when she decides the engine is shippable.
- **Game deploys** are a per-game concern. The deploy pipeline
  (Plan 046's `deploy.yml`) consumes whatever engine artifact
  the game has pinned -- today, the committed `dist/`; with Plan
  048, the GHCR image at the version the game pinned. Game deploys
  do NOT publish new engine versions; they consume one.

### Game deploys consume a pinned engine version

Each game project carries a `frontendBundleVersion` field in the
SugarDeploy plugin state slot (Plan 048 adds this; today the
"pin" is implicit in whatever `dist/` is committed). The pin
identifies which engine artifact this game deploys against,
preserved across worktrees and `git checkout` of historical
tags. A game running `v1.0.5` today still deploys with whatever
engine version was pinned when the patch was tagged, even if
the engine has shipped multiple newer versions since.

Studio surfaces a Unity-style upgrade prompt on project open
when a newer engine version is available than the game's pin.
Users click "Upgrade" to update the pin; the upgrade IS the
opt-in. There's no auto-pull or auto-bump path.

### Engine version compatibility is a hard contract

`BOOT_JSON_SCHEMA_VERSION` is the engine/payload compatibility
token. The engine refuses to boot a `boot.json` with a
`schemaVersion` it doesn't understand. New engine versions can
expand the schema (add fields the older engine ignores) but
can't reshape it without a `BOOT_JSON_SCHEMA_VERSION` bump and
an engine major release. Bumping the schema means a coordinated
release: engine ship, game upgrade prompt fires, game author
re-deploys.

## Consequences

- Game repos stay lean once Plan 048 lands. `dist/` no longer
  needs to be committed; the pin is a single version string in
  plugin state.
- The engine ships independently of any game. nikki releases the
  engine when she wants to; games adopt it when they want to.
- Reproducing an old game deploy reduces to: `git checkout v1.0.5`,
  read the pinned engine version, pull that GHCR image, ship.
  The engine version is durable per game-version.
- Upgrade prompts give the game author explicit control over
  engine adoption. No silent breakage from an engine release
  reshaping behaviour out from under them.
- The compatibility contract is testable: a future engine release
  that bumps `BOOT_JSON_SCHEMA_VERSION` MUST be accompanied by
  test coverage proving older boot.json payloads still load
  through the schema migration path. Without that proof, the
  game-deploy pipeline that hasn't upgraded yet fails on every
  deploy.
