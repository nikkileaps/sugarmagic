# Plan 038: Entity-Owned Character Content (Model + Animations)

**Status:** Implemented
**Date:** 2026-04-28

## Epic

### Title

Character `.glb` files — both **models** and **animations** — are
project-content but **not** library-browsed content. Each Player and
NPC owns its model and its animation clips (idle / walk / run)
directly via inline file-pickers in its inspector. No library
popover for character content; no scene-asset dropdown polluted
with character clips; nothing crosses over into Build > Layout.

### Goal

- **Character content is its own family of content kinds**, parallel
  to `MaterialDefinition`, `TextureDefinition`, `ShaderGraphDocument`,
  but with a different authoring shape: **entity-owned**, not
  library-browsed. Two new kinds: `CharacterModelDefinition` and
  `CharacterAnimationDefinition`. Both live in the project content
  library (asset-resolved + version-controlled), but neither
  appears in `Game > Libraries`.
- **Player and NPC inspectors own the file-picker.** Clicking
  "Import Character Model…" or "Import Animation…" in a slot opens
  the system file dialog, IO copies the `.glb` into the project,
  the resulting definition's id is bound to the slot atomically.
  No "first import to library, then pick from dropdown" two-step.
- **Runtime resolution moves with the bindings.**
  `runtime-core/src/{player,npc}/index.ts` resolve the model id
  through `characterModelDefinitions` and each animation slot id
  through `characterAnimationDefinitions`. The legacy general-asset
  lookup for character content is gone.
- **Build > Layout's asset list stops surfacing character glbs.**
  Scene-placement is for scene props; character content lives in
  its own collections, so it never enters `assetDefinitions` and
  the Layout asset list naturally stays clean.

### Why this epic exists

Before this epic, both player models and player animations were
imported as general `AssetDefinition`s through Build > Layout,
then selected in the Player inspector by browsing the same
dropdown that listed every tree, rock, and decor model in the
project. Two distinct concerns were conflated through a single
list:

- **Scene props** — placed many times in the world, transforms,
  surface slots, deform / effect bindings. Content-library item.
- **Character content** — bound 1:1 to a specific character
  definition (model) or to a specific slot on it (animation
  clip). No transforms, no surface slots, no scene presence.

That conflation produced three day-to-day frictions:

1. The Layout scene graph filled up with character files nobody
   wanted to place.
2. The Player inspector's animation dropdown listed every tree
   and rock alongside the actual walk-cycle clips.
3. Authors had to import a model or animation as a "Layout
   asset" via a workspace that has nothing to do with character
   authoring.

The library-first content model from Plan 037 already established
the pattern that distinct authored kinds get distinct collections
and distinct authoring surfaces. Plan 038 extends that pattern
with a second flavor — **entity-owned** content kinds, for
content that is bound to a specific entity rather than browsed
across many. Materials/Textures/Shaders are library-browsed
(many surfaces share one shader). Models/Animations are
entity-owned (one model per character; one animation per slot).

### Goal-line test

After 038 lands:

- `grep -r "modelAssetDefinitionId" packages/runtime-core/src/{player,npc}/`
  shows the field is resolved through `characterModelDefinitions`,
  not `assetDefinitions`.
- `grep -r "animationAssetBindings" packages/runtime-core/src/{player,npc}/`
  shows each slot id is resolved through
  `characterAnimationDefinitions`, not `assetDefinitions` and not
  the (now-deleted) `animationDefinitions`.
- `grep -rn "AnimationDefinition\b" packages/` returns no hits in
  domain / runtime / studio code paths. The interface is gone.
  `CharacterAnimationDefinition` replaces it.
- `Game > Libraries` shows three entries: Materials, Textures,
  Shaders. No Animations entry. The Library popover never opens
  on character content.
- The Player inspector's Model field and three Animation Slot
  fields are file-pickers (Import / Replace / Clear), not
  dropdowns sourced from any library collection.
- Importing a `.glb` via "Import Animation…" on the Player's
  walk slot, then entering Play, walks the player. Runtime
  resolution end-to-end.

## Scope

### In scope

- **`CharacterModelDefinition` interface** in
  `packages/domain/src/content-library/index.ts`. Carries
  `definitionId`, `definitionKind: "character-model"`,
  `displayName`, `source: { relativeAssetPath, fileName,
  mimeType }`. No additional metadata in v1.
- **`CharacterAnimationDefinition` interface** in
  `packages/domain/src/content-library/index.ts`. Same shape as
  `CharacterModelDefinition` plus `clipNames: string[]` (parsed
  from the glb at import — kept for display + future per-clip
  selection).
- **`ContentLibrarySnapshot.characterModelDefinitions: CharacterModelDefinition[]`
  and `.characterAnimationDefinitions: CharacterAnimationDefinition[]`**
  fields, both with `[]` default and load-time normalization for
  legacy snapshots.
- **`createDefaultCharacterModelDefinition` and
  `createDefaultCharacterAnimationDefinition` factories**, plus
  three CRUD helpers per kind in
  `packages/domain/src/authoring-session/index.ts`
  (`add{X}DefinitionToSession`,
  `update{X}DefinitionInSession`,
  `remove{X}DefinitionFromSession`). Removal cascades to clear
  any Player or NPC binding pointing at the deleted id.
- **Shell + Studio asset-source stores walk both new kinds.**
  `packages/shell/src/asset-sources/index.ts:collectRelativeAssetPaths`
  and `apps/studio/src/asset-sources/useAssetSources.ts` walk
  `characterModelDefinitions` and `characterAnimationDefinitions`
  alongside textures + scene assets, so the project's blob URL
  map includes character glbs.
- **`importCharacterModelDefinition` and
  `importCharacterAnimationDefinition` in `packages/io`.** Both
  accept `.glb` only, copy under
  `assets/imported/character-{models,animations}/<sanitized>.glb`,
  return a fully-formed definition. Animation importer extracts
  clip names via the existing GLB JSON parser; model importer
  doesn't need to introspect.
- **Player + NPC inspector file-picker rows.** Each character
  inspector shows:
  - **Model**: file-picker row. When unbound, "Import Character
    Model…" button. When bound, file display name + path +
    "Replace…" / "Clear" actions. Stale binding (id missing
    from `characterModelDefinitions`) shows a red "re-import"
    message.
  - **Animation slots** (idle / walk / run): three identical
    file-picker rows. Same Import / Replace / Clear pattern.
    Same stale-binding handling.
- **Player + NPC runtime resolution.**
  `runtime-core/src/{player,npc}/index.ts` resolve the model id
  through `getCharacterModelDefinition` and each animation slot
  id through `getCharacterAnimationDefinition`. Stale bindings
  emit `missing-model` / `missing-animation` warnings and the
  slot just doesn't bind (capsule fallback for the model;
  no clip for an animation slot).
- **Retirement of the `AnimationDefinition` library kind.**
  Delete the interface, factory, CRUD helpers, lookups, the
  `animationDefinitions` field on `ContentLibrarySnapshot`,
  the `Game > Libraries > Animations` menu entry, the
  `"animations"` entry in `LibraryKind`, the animations branch
  in `LibraryPopover`, the `AnimationDetails` component, the
  `handleImportAnimationDefinition` /
  `handleRemoveAnimationDefinition` /
  `handleDuplicateAnimationDefinition` handlers in `App.tsx`,
  the asset-source plumbing for it, and the animation-import
  test that targeted it. Per AGENTS.md "prefer deletion over
  coexistence" — no parallel paths.
- **Layout asset-import animation hint stays.** The IO
  `importSourceAsset` flow already surfaces a warning when an
  imported glb has zero meshes and ≥1 animation tracks. The
  message is updated to direct the author to the Player/NPC
  inspector rather than the (now-deleted) Animations library.

### Out of scope

- **Migrating existing animation-binding values.** The user has
  very few animations bound today and the rebind cost via the
  inspector is small. Stale ids resolve to `null`, the inspector
  shows "Bound model is missing — re-import," the runtime emits
  a `missing-animation` warning. User re-binds.
- **Per-clip selection from a multi-clip glb.** V1 binds the
  whole `CharacterAnimationDefinition` to a slot and uses the
  first clip. `clipNames` is stored for future per-clip
  selection.
- **Sharing a single animation across multiple characters.**
  The user explicitly chose not to share — each character carries
  its own animation files. If sharing becomes important later,
  add a "(also) browse from existing character animations"
  affordance to the file-picker.
- **A character-content browser at all.** No popover, no list.
  If you want to see what character content is in the project,
  open a Player/NPC inspector.
- **Item / Spell / other entity slots.** Today only Player and
  NPC have model + animation bindings. If new entity kinds want
  the same pattern, they pick up the same content kinds and the
  same file-picker UI.

## Shape sketch

```ts
// packages/domain/src/content-library/index.ts

export interface CharacterModelDefinition {
  definitionId: string;
  definitionKind: "character-model";
  displayName: string;
  source: {
    relativeAssetPath: string;
    fileName: string;
    mimeType: string | null;
  };
}

export interface CharacterAnimationDefinition {
  definitionId: string;
  definitionKind: "character-animation";
  displayName: string;
  source: {
    relativeAssetPath: string;
    fileName: string;
    mimeType: string | null;
  };
  /** Animation clip names parsed from the glb at import. */
  clipNames: string[];
}

export interface ContentLibrarySnapshot {
  // existing fields...
  characterModelDefinitions: CharacterModelDefinition[];
  characterAnimationDefinitions: CharacterAnimationDefinition[];
  // animationDefinitions: REMOVED — replaced by characterAnimationDefinitions
}
```

```ts
// packages/workspaces/src/design/PlayerWorkspaceView.tsx — sketch

// Was:
//   <Select label="Walk" data={animationOptions} value={...} onChange={...} />
//
// Becomes (one row per slot):
boundAnimation ? (
  <Group gap="xs">
    <Text>{boundAnimation.displayName}</Text>
    <Button onClick={replaceAnimation(slot)}>Replace…</Button>
    <Button onClick={clearAnimation(slot)} color="red">Clear</Button>
  </Group>
) : (
  <Button onClick={importAnimationFor(slot)}>Import Animation…</Button>
);
```

## Stories

### 38.1 — Entity-owned domain kinds + asset-source plumbing

**Outcome:** `CharacterModelDefinition` and
`CharacterAnimationDefinition` interfaces, factories, three
CRUD helpers per kind. Both fields added to
`ContentLibrarySnapshot` with `[]` defaults + load-time
normalization. Shell + Studio asset-source stores walk both
new kinds so the project's blob URL map covers character
glbs. Removing a definition cascades to clear any Player or
NPC binding pointing at it (so Play doesn't show stale ids
no longer in scope).

**Files touched:**
- `packages/domain/src/content-library/index.ts` — new
  interfaces, fields, normalizers, factories, lookups.
- `packages/domain/src/authoring-session/index.ts` — six CRUD
  helpers (three per kind), plus `getAllCharacter*Definitions`.
- `packages/shell/src/asset-sources/index.ts` — extend
  `collectRelativeAssetPaths` to walk both new kinds.
- `apps/studio/src/asset-sources/useAssetSources.ts` — same
  extension on the Studio-side path collector.
- `packages/testing/src/character-model-definition.test.ts` —
  exists; covers CRUD round-trip + cascading binding clear.
- `packages/testing/src/character-animation-definition.test.ts` —
  new. Same shape as the model test, plus `clipNames` survival
  through CRUD round-trip.

### 38.2 — IO importers

**Outcome:** `importCharacterModelDefinition` and
`importCharacterAnimationDefinition` in `packages/io`, both
mirroring the existing `importTextureDefinition` /
`importPbrTextureSet` shape. Animation importer parses
`clipNames` from the glb (same `readGlbChunks` +
`collectAnimationClipNames` path the old animation library
importer used). Studio is a thin consumer; no GLTFLoader code
in `apps/studio/src/library/` or in any inspector view.

**Files touched:**
- `packages/io/src/imports/index.ts` — add request / result
  types and both importer functions plus their public
  file-picker entry points (`pickCharacterModelFile` /
  `pickCharacterAnimationFile`).
- `packages/testing/src/animation-import.test.ts` — exists;
  retarget to assert the new
  `importCharacterAnimationDefinition` produces a
  `CharacterAnimationDefinition` with the right `clipNames`.

### 38.3 — Player + NPC inspector file-picker UI

**Outcome:** `PlayerWorkspaceView` and `NPCWorkspaceView` show
file-picker rows for the model field AND each animation slot
(idle / walk / run). Each row: display name + relative path
when bound; "Import Character Model…" / "Import Animation…"
button when not. Both sections share the same Replace / Clear
affordance. Stale bindings render a red "re-import" hint.
The `assetDefinitions` prop is dropped from both views (the
character meshes never came from `assetDefinitions` anyway
post-38.1, and the animation slots don't either post-38.4).

**Files touched:**
- `packages/workspaces/src/design/PlayerWorkspaceView.tsx` —
  add `onImportCharacterAnimationDefinition` prop + slot-by-
  slot file-picker rendering. Drop `animationDefinitions`
  prop dependency.
- `packages/workspaces/src/design/NPCWorkspaceView.tsx` — same.
- `packages/workspaces/src/design/animation-options.ts` —
  delete (no longer needed; was the dropdown-source helper).
- `packages/workspaces/src/design/index.tsx` — thread
  `onImportCharacterAnimationDefinition` through to both
  views; drop the now-unused animation-options re-export.
- `apps/studio/src/App.tsx` —
  `handleImportCharacterAnimationDefinition` calls the IO
  importer and `addCharacterAnimationDefinitionToSession`,
  returns the new definition so the inspector can bind it
  atomically.

### 38.4 — Runtime resolution swap

**Outcome:** `runtime-core/src/player/index.ts` and
`runtime-core/src/npc/index.ts` resolve animation slot ids via
`getCharacterAnimationDefinition` (replacing
`getAnimationDefinition`). The model lookup already routes
through `getCharacterModelDefinition`. Diagnostic warning
text is updated to direct authors to the inspector (no more
"check the animation library").

**Files touched:**
- `packages/runtime-core/src/player/index.ts` — swap import
  + the per-slot lookup.
- `packages/runtime-core/src/npc/index.ts` — same.

### 38.5 — Retire AnimationDefinition library kind

**Outcome:** All AnimationDefinition library plumbing is
deleted. Per AGENTS.md "prefer deletion over coexistence" —
no compat shim, no parallel path.

Deletions:
- `AnimationDefinition` interface, factory, normalizer,
  CRUD helpers, lookups in `packages/domain/`.
- `animationDefinitions` field on `ContentLibrarySnapshot` +
  references in normalizers.
- `"animations"` from `LibraryKind` in `packages/shell/`.
- `Game > Libraries > Animations` menu entry in `App.tsx`.
- `handleImportAnimationDefinition` /
  `handleRemoveAnimationDefinition` /
  `handleDuplicateAnimationDefinition` in `App.tsx`.
- Animations branch in `LibraryPopover.tsx`; props for
  `animationDefinitions`, `onImportAnimationDefinition`,
  `onRemoveAnimationDefinition`,
  `onDuplicateAnimationDefinition`.
- `apps/studio/src/library/AnimationDetails.tsx` — delete file.
- Asset-source plumbing for `animationDefinitions` in shell
  and Studio.
- `packages/testing/src/animation-definition.test.ts` —
  delete file.
- `packages/testing/src/animation-options.test.ts` — delete
  file.
- `packages/testing/src/animation-import.test.ts` — retarget
  (per 38.2) rather than delete.

Updates:
- The IO layout asset-import animation-only hint message is
  updated to direct authors to the Player/NPC inspector
  ("Did you mean to import this as a character animation?
  Open the Player or NPC inspector and use Import
  Animation… on a slot.") rather than the deleted library.

**Files touched:** every file listed above.

## Success criteria

- **Player + NPC inspectors have file-picker rows for model
  and three animation slots.** Manual: open Design > Player
  with no model and no animations bound; the inspector
  shows four "Import…" buttons.
- **Importing via the inspector binds atomically.** Clicking
  "Import Animation…" on the walk slot opens a file picker;
  on success, the slot immediately shows the bound file's
  display name. No second step.
- **Runtime resolves bindings end-to-end.** Bind a model
  and a walk animation on the Player; enter Play; press W;
  the player walks. No `missing-model` or `missing-animation`
  warning in the runtime log for freshly-bound slots.
- **Layout asset list shows only scene props.** Character
  glbs imported via the inspector do not appear in
  Build > Layout's asset list.
- **`Game > Libraries` shows Materials / Textures / Shaders
  only.** No Animations entry.
- **Existing project files load.** Snapshots without the
  new fields hydrate to `[]`. Snapshots that still carry the
  legacy `animationDefinitions` field are silently dropped
  during normalization (the field is no longer part of the
  type).
- **Stale bindings are graceful.** Pre-epic
  `animationAssetBindings` ids that pointed at old
  `AnimationDefinition` ids now resolve to `null` in the
  new collection. The inspector shows a "Bound animation
  is missing — re-import" message; the runtime emits a
  `missing-animation` warning at load and continues.

## Risks

- **Lossy migration of existing animation bindings.** Any
  Player/NPC binding pointing at an `AnimationDefinition`
  id from the old library is unresolvable after 38.5. The
  failure mode is graceful (re-import via inspector), but
  the user has to redo the bind once. Mitigation: the user
  has very few animations bound today; rebind cost is small.
- **`AnimationDefinition` field deletion.** Old project
  files carrying `animationDefinitions: [...]` will have
  the field stripped on next save. If a user reverts to a
  pre-038 build, those bindings are gone permanently. This
  is the AGENTS.md "prefer deletion over coexistence"
  posture — accepted explicitly.
- **Import-path duplication.** With `importCharacterModel*`,
  `importCharacterAnimation*`, `importTexture*`,
  `importMaskTexture*`, `importPbrTextureSet`, and
  `importSourceAsset`, the IO imports module is a family
  of similarly-shaped functions. If a sixth importer joins
  the family and the duplication grows uncomfortable,
  extract a shared `pickAndCopyGlb` / `pickAndCopyImage`
  helper. Not pre-extracted.

## Builds on

- [Plan 037: Library-First Content Model](037-library-first-content-model-epic.md)
  — 037 established library-browsed content kinds (Materials,
  Textures, Shaders). 038 introduces the complementary
  pattern: entity-owned content kinds for content that's
  bound 1:1 to a specific entity rather than browsed across
  many uses.
- [ADR 015: Library-First Content Model](../adr/015-library-first-content-model.md)
  — 038 extends 015's "distinct authored kinds get distinct
  collections" principle with the additional axis of
  *authoring surface*: library-browsed for shared content,
  inspector-owned file-picker for entity-bound content.

## Design evolution

This epic shipped in two passes. The first pass (committed
mid-epic) modeled animations as a library kind parallel to
materials / textures / shaders, with a `Game > Libraries >
Animations` popover. After living with that for a moment,
the user observed two things:

1. The inspector still had to pick from a dropdown — a
   two-step "first import to library, then bind from
   dropdown" workflow with no real benefit since
   animations are 1:1 with their character.
2. The model field had the same problem in reverse: a
   dropdown sourced from `assetDefinitions` (the scene
   asset list), which was the original symptom of the
   epic's existence.

The fix for the model came first (CharacterModelDefinition,
inline file-picker). Once that landed, applying the same
pattern to animations was the obvious cleanup. The library
kind was retired and this plan was rewritten from scratch
to present the two patterns as the coherent architecture
they are: library-browsed for shared content, entity-owned
for character-bound content.
