# ADR 010: Asset Pipeline Layers

**Status:** Accepted
**Date:** 2026-04-18

## Context

Sugarmagic has one end-to-end asset pipeline from external file to rendered frame, spanning six distinct layers. Two layers are currently stubs or single-target implementations that will need to grow later. Before they grow, the shape they take should be captured so the growth is an extension — not a rewrite that re-negotiates the whole chain.

The layers as they stand today:

1. **Importer** (`packages/io/src/imports/`) — file picker, per-kind contract analysis, copy into `{gameRoot}/assets/…`, emits `AssetDefinition` / `TextureDefinition`.
2. **Domain registry** (`packages/domain/src/content-library/`) — `ContentLibrarySnapshot` with `assetDefinitions[]`, `textureDefinitions[]`, `materialDefinitions[]`, `shaderDefinitions[]`, `environmentDefinitions[]`. Identity is the `definitionId` string. Persisted via the session to `{gameRoot}/project.sgrmagic`.
3. **Runtime-core contract** (`packages/runtime-core/`) — pure logic on pure data. `resolveSceneObjects(region, { contentLibrary, … })` emits `SceneObject[]` carrying only domain identity and relative paths. Never handles bytes, URLs, or GPU artifacts.
4. **Asset source bridge** — `assetSources: Record<relativeAssetPath, platformURL>`. The bridge between "relative path" (domain) and "fetchable URL" (platform). Minted differently per context: Studio uses `useAssetSources` over FS Access, Preview receives the map via `postMessage`, a future published build receives it from the publish manifest.
5. **Target host** — owns the platform-specific tick loop and integrates runtime-core scene data with the target's rendering stack. Today: `targets/web/src/runtimeHost.ts`.
6. **Target artifact resolver** — takes `(contentLibrary, assetSources)` and produces target-specific artifacts (for web: `three.Texture` instances, GLB scenes). Today: `AuthoredAssetResolver` in `packages/render-web/`, plus direct GLTFLoader calls for meshes.

Two layers are deliberately incomplete:

- **Publisher** (`packages/io/src/publish/`) is a stub — only request/response types declared. No packaging pipeline exists yet because no game has reached distribution.
- **Target abstraction** does not exist as a named interface — the contract between runtime-core and the target host is informal. There is only one target (web), so no second target exists to validate the interface against.

## Decision

Do not build the publisher or the target-abstraction interface until there is concrete pressure to do so (a game ready to distribute; a second target in flight). Accept the current state as correct for a single-target project at authoring maturity, and capture the shape both extensions will take so the wait doesn't lose the decisions.

### Publisher shape when it lands

Inputs:

- `rootPath` (the game root)
- `targetKind` (e.g. `"web"`, later `"native"` / etc. — already typed on `PublishArtifactSpec`)

Outputs:

- `{gameRoot}/publish/{targetKind}/` containing the packaged bundle
- A manifest file listing every asset by `relativeAssetPath` → `targetSpecificURL` (plus per-target transforms applied: texture compression format, mesh optimization flags, etc.)

Rules:

- **Identity survives publish.** `relativeAssetPath` remains the lookup key; only the URL changes. The runtime-side shape (`assetSources: Record<relPath, string>`) is identical across Studio, Preview, and published builds — the producer is what differs.
- **Publisher owns per-target transforms.** Texture compression, mesh LOD generation, audio format conversion, etc. all live behind the `targetKind` switch. The domain and runtime-core layers stay target-blind.
- **The manifest is the contract.** The target's bootloader reads it to build its `assetSources` map — no ad-hoc URL construction in the target.

### Target abstraction shape when it lands

Today the contract between runtime-core and the target host is informal but already correctly shaped:

- Runtime-core imports nothing from render-web or any `targets/*`.
- Render-web and `targets/web/` consume `ContentLibrarySnapshot`, `SceneObject[]`, and `assetSources` — no reverse coupling.

When a second target appears, crystallize the informal contract into a named interface (`TargetHost` / `TargetAssetResolver` / whatever the second target reveals as load-bearing). Do **not** invent the interface speculatively — let the second target surface what runtime-core is currently exposing implicitly. That is the real evidence for the shape.

Until that happens, the one-way dependency discipline (enforced by `tooling/check-package-boundaries.mjs`) is the honest guarantee that the day a second target arrives, runtime-core won't need to change — the new target will plug in at the same layer as `targets/web/`.

## Consequences

### Positive

- No premature abstractions. The interface between runtime-core and targets stays informal until a real second target proves what it needs.
- The publisher stub doesn't lie about capability. `publish/index.ts` has types only; nothing falsely claims to package builds.
- Preview can iterate fast without blocking on publish infrastructure — `postMessage` of in-memory `assetSources` sidesteps the publish pipeline entirely, which is correct for the iteration loop.
- When the publisher and target abstraction land, they're extensions (new files, new implementations of existing shapes) rather than rewrites of the runtime or domain layers.

### Tradeoffs

- A second target cannot ship without a brief interface-extraction step first. Accepted: doing that step with a concrete second target in hand is cheaper than guessing at it today.
- The publisher stub is a standing reminder that distribution is not yet implemented. Accepted: naming it `publish` with typed inputs but no bundler is more honest than either deleting the stub or building an empty pipeline.
- Render-web being the single target artifact producer today creates a mild naming smell (`AuthoredAssetResolver` could be read as universal, but it's web-specific). Accepted: renaming would churn a lot of call sites, and its location in `packages/render-web/` already communicates the constraint unambiguously.

## Builds On

- [ADR 009: Game Root Contract](/Users/nikki/projects/sugarmagic/docs/adr/009-game-root-contract.md)
- [Plan 032: Material System and Library Epic](/Users/nikki/projects/sugarmagic/docs/plans/032-material-system-and-library-epic.md) — Story 32.10 (shared authored-asset resolver boundary) is the render-web-owned implementation of layer 6 for the web target.
