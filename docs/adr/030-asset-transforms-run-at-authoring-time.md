# ADR 030: Asset transforms run at authoring time

## Status

Accepted. Supersedes [ADR 010: Asset Pipeline Layers](/Users/nikki/projects/sugarmagic/docs/adr/010-asset-pipeline-layers.md).

## A word this ADR deliberately avoids

**Publish** is already a top-level Studio productmode
(`packages/productmodes/src/publish/index.ts`): "Package and ship the game",
with SugarDeploy contributing Provision, Release, and Deploy workspaces into
it. `package` is its baseline workspace kind, and `published-web` names the
built artifact directory.

None of those are what this ADR is about. This ADR is about **converting an
asset's bytes** — re-encoding a texture, compressing geometry — and about
which moment in the workflow that conversion happens in. It uses "transform"
for that, and never "publish".

ADR 010 used "Publisher" for a layer that would own those conversions, which is
part of why it read as authoritative long after it stopped being true.

## Context

ADR 010 was written when no game had been distributed. It reserved
`packages/io/src/publish/` for a future layer and assigned it per-target asset
conversions behind a `targetKind` switch.

Games have shipped since, and that work was built elsewhere:
`packages/plugins/src/deployment/` produces `boot.json` and the Netlify
`_headers` file, generates the deploy workflow, and stages the project's
assets. The SugarDeploy plugin drives it.

`packages/io/src/publish/` stayed ten lines of types for four months, consumed
only by a test harness that fabricated a path string. Reserving a seam did not
cause anyone to use it; the implementation grew where the work was.

Meanwhile a real pattern for converting assets did emerge, without an ADR: the
navmesh bake, the paint-UV and origin-correct passes, and sugarlang's compiled
artifacts all run in Studio, write the derived file into the project with
`writeBlobFile`, and declare a path that `collectFileBackedAssetPaths` picks
up. That is four independent implementations of the same shape.

## Decision

**An asset transform runs at authoring time by default.** It converts the file,
writes the result into the project, and declares its path. Studio and the
shipped game then read the same bytes.

This is preferred because:

- The result is visible in Studio before anything is deployed, so a bad
  conversion is caught by looking at it rather than by shipping it.
- There is no divergence to reason about. "The authored region is the runtime
  region" extends to the bytes underneath it.
- It is testable without a deploy round trip.
- It already has four working precedents in this repo.

**A deploy-time transform is the exception**, correct only when the output is
genuinely specific to one target — a format that target can read and another
cannot. It buys automation and costs you a shipped artifact nobody has looked
at. Choosing it requires saying why the output cannot be target-neutral.

**Where the deploy artifact is assembled:** `packages/plugins/src/deployment/`.
There is no separate layer in `packages/io/` for it.
`packages/io/src/publish/`, its test harness, and the orphaned
`PublishArtifactSpec` domain type are deleted rather than left standing as a
promise.

## What carries forward from ADR 010

**Identity survives a transform.** `relativeAssetPath` remains the lookup key;
only the bytes and the resolved URL change. `assetSources` is
`Record<relativeAssetPath, url>` in `boot.json`, and every content-library
definition references its file by that path. A transform that renames the key
breaks every definition pointing at it.

**Layer direction.** Runtime-core imports nothing from render-web or any
target; render-web and `targets/web/` consume snapshots and `assetSources`
with no reverse coupling. `tooling/check-package-boundaries.mjs` enforces it.

That has a direct consequence for decoders. Anything needing a renderer — for
instance three's `KTX2Loader`, which throws without `.detectSupport(renderer)`
— cannot be constructed in runtime-core, which may not import render-web. Such
a decoder is configured by the host once the renderer exists and injected,
following the repo's rule that core declares the interface and the host
supplies the implementation. A decoder needing no renderer, such as meshopt,
has no such constraint.

## Consequences

- One place to look for how the deploy artifact is built.
- No stub standing in for a decision made elsewhere.
- A transform must state when it runs and why, rather than inheriting a
  location from an ADR.
- Bulk conversions of existing projects become Studio actions, which means they
  need the things Studio actions need: progress, a failure report, and a story
  for the definitions that reference the converted files.
- A second target still needs an interface-extraction step. Unchanged from
  ADR 010, and still cheaper with a concrete second target in hand.

## Builds On

- [ADR 009: Game Root Contract](/Users/nikki/projects/sugarmagic/docs/adr/009-game-root-contract.md)
