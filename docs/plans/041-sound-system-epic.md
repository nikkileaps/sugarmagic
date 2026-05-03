# Plan 041: Sound System Epic

**Status:** Proposed
**Date:** 2026-05-01

## Epic

### Title

Authorable game sound for Sugarmagic — imported audio clips,
reusable sound cues, music, ambience, one-shot SFX, footsteps,
spatial emitters, and runtime event playback. The authored
sound model lives in Sugarmagic's domain/project data; runtime-
core decides which sound events should happen; each target owns
the platform audio backend. The web target ports Sugarengine's
Howler.js-based playback technology without porting the old
monolithic `Game.audio.play(...)` architecture.

### Legacy Sugarengine read

Sugarengine's sound stack was small and practical:

- `src/engine/audio/AudioManager.ts` wrapped **Howler.js** and
  owned loaded `Howl`s, category volumes, fades, music transitions,
  and unload/dispose.
- `src/engine/audio/AmbientController.ts` scheduled random
  ambient one-shots/loops over the `AudioManager`.
- `src/engine/audio/types.ts` defined three categories:
  `music | sfx | ambient`.
- `src/engine/core/Game.ts` hardcoded the first content set:
  `audio/music/menu.mp3`, `audio/sfx/footstep.mp3`,
  `audio/sfx/interact.mp3`, `audio/sfx/pickup.mp3`,
  `audio/ambient/wind.mp3`, and `audio/ambient/owl.mp3`.
- `src/engine/systems/MovementSystem.ts` exposed callback hooks
  for continuous footstep playback while the player moved.
- `docs/adr/010-audio-system.md` selected Howler because it is
  small, MIT licensed, supports fades/loops/sprites/spatial audio,
  and falls back to HTML5 Audio.

The "Draco" memory was a nearby but unrelated Sugarengine feature:
`docs/adr/023-draco-mesh-compression.md` and the Draco loader code
are for compressed glTF meshes, not sound. Do not add Draco for
audio.

### What carries forward

- **Keep:** Howler.js as the web target playback backend, plus the
  proven concepts of categories, category volumes, fades, looping
  music, looping footsteps, one-shot SFX, and random ambience.
- **Rewrite:** the authored data model, project persistence, Studio
  UI, runtime event flow, and asset loading. Sugarengine hardcoded
  content paths in `Game.ts`; Sugarmagic must author and resolve
  sound through project data.
- **Delete / avoid:** target-only string calls such as
  `audio.play("pickup")` embedded throughout gameplay code. Runtime
  systems should emit typed sound events/cue requests; the target
  adapter realizes them.
- **New source of truth:** `AudioClipDefinition`s and
  `SoundCueDefinition`s in the content library, plus region-owned
  sound bindings for emitters/zones. Runtime playback state is
  derived from those definitions; it is not persisted separately.

### Goal

After this epic ships:

- Designers can import `.mp3`, `.ogg`, and `.wav` clips into the
  project under managed audio paths.
- Designers can create reusable `SoundCueDefinition`s that reference
  one or more clips, set category, volume, pitch/randomization, loop,
  fade, max instances, and optional spatial defaults.
- Designers can bind cues to gameplay events such as pickup,
  interaction, spell cast, player footstep, UI click, and quest
  reward without editing target code.
- Designers can author region ambience and spatial sound emitters:
  looping wind around an area, random owl calls, waterwheel hum near
  a placed asset, etc.
- Web preview and exported web gameplay hear the same authored
  sounds because both go through the same runtime-core sound event
  model and the same target-web audio adapter.
- Existing projects load with empty audio collections and no
  behavior changes.

### Why this epic exists

Sugarmagic currently has strong visual/runtime convergence, but no
authorable sound. If we simply paste Sugarengine's `AudioManager`
into Studio or `runtime-core`, we recreate the old split in a new
costume:

1. Gameplay code would know target playback ids instead of authored
   cues.
2. Studio preview and exported web runtime would drift.
3. Future targets would inherit browser-specific Howler assumptions.
4. Audio files would bypass the content-library / asset-source
   machinery that now owns project files.

Sound should follow the same architecture as the recent content
work: authored definitions in domain, semantic runtime behavior in
runtime-core, platform realization in targets, and Studio UI as an
authoring layer on top.

### Non-negotiable architecture boundary

```
packages/domain
  owns AudioClipDefinition, SoundCueDefinition, RegionAudioBinding

packages/io
  owns importing/copying audio files into managed project paths

packages/runtime-core
  owns semantic sound events and cue scheduling decisions
  does NOT import Howler, DOM Audio, React, or target code

targets/web
  owns Howler.js, AudioContext unlock behavior, actual playback,
  panning/fades, decode/load cache, pause/resume/dispose

apps/studio + packages/workspaces
  own authoring UI and may embed target-web preview through root
  preview APIs only, matching the Epic 039 preview-target pattern
```

Direction is one way. Domain/runtime-core never depend on
`targets/web`; target-web consumes runtime-core sound commands.
Studio does not reach into target internals. If Studio needs to
audition sound, it calls a root-exported web preview/audition entry
point, not `new Howl(...)` in editor UI.

### Authoring model

This epic has three distinct authoring concepts. Do not collapse them
into one workspace or one persisted type:

- **Audio Clips** are raw imported media files. They are managed from
  **Library > Audio** alongside other reusable project library content.
  Clips can be imported, renamed, deleted, browsed, and previewed, but
  gameplay does not bind directly to clips.
- **Sound Cues** are reusable playback recipes. They live in the
  content library as `SoundCueDefinition`s and are authored from
  **Build > Audio**. A cue wraps one or more clips and owns playback
  behavior: category, mode, volume, pitch, fades, randomization,
  spatial defaults, and retrigger/max-instance policy. The left side
  of Build > Audio is the cue list; the `+` button creates a cue.
- **Emitters and Ambience Zones** are scene/application-site objects.
  They live in `RegionDocument.audio` and are placed, drawn, selected,
  and edited in the **Layout** workspace. They reference cues, never
  clips, because their job is to say where and when reusable cue
  behavior happens in a region.

`Build > Audio` must not become a placement editor, and `Layout` must
not become a cue-definition editor. This mirrors the surface split:
library definitions are reusable intent; application sites own local
placement and binding.

### ID policy

`definitionId` fields are stable opaque identity strings generated
by the domain/factory layer. They are NOT semantic inputs. Runtime,
rendering, Studio UI, import/export, and cue resolution must not
parse meaning from an id prefix, suffix, file name, or display name.

For new project-authored audio definitions, use UUID-backed opaque
ids via the shared domain identity helper:

- `createUuid()` for `AudioClipDefinition.definitionId`
- `createUuid()` for `SoundCueDefinition.definitionId`

This deliberately avoids carrying forward the older readable-id
habit such as `${projectId}:surface:wildflower-meadow` into new
author-authored audio content. Existing content kinds may still have
legacy/project-scoped readable ids, and built-in definitions may use
stable deterministic ids when needed for starter-content seeding, but
audio implementation must treat all `definitionId` values as opaque.
If any audio code wants to branch on id shape, that is a design bug;
add explicit metadata or a typed field instead.

### Goal-line test

After 041 lands:

- A designer opens **Library > Audio**, imports `pickup.wav`, then
  opens **Build > Audio**, creates a cue named "Pickup Sparkle",
  assigns category `sfx`, wraps the imported clip, and auditions it
  with the transport. The sound plays in Studio.
- The designer binds "Pickup Sparkle" to Item Pickup globally or on
  a specific item. In game preview, collecting the item plays the
  cue once.
- The designer imports `forest_wind.ogg`, creates a looping ambient
  cue in **Build > Audio**, then opens **Layout**, places or
  draws an ambience zone in the scene, and binds the zone to that cue.
  In preview, entering the region starts/fades the ambience and
  leaving/stopping preview disposes it.
- The designer creates a random ambience cue with `owl_1.ogg` and
  `owl_2.ogg`, interval 30-90s, and places it near a tree. The cue
  schedules random calls at runtime without Studio-specific code.
- The player footstep loop starts only while movement is active and
  stops when movement stops. It is driven by runtime movement state,
  not editor callbacks.
- `rg "howler|Howl|Howler" packages/domain packages/runtime-core
packages/render-web` returns no hits.
- `rg "audio.play\\(|playSound\\(" packages/runtime-core` shows only
  typed event/cue emission, not direct target playback.
- Existing projects with no audio fields normalize to empty audio
  collections and run unchanged.

## Scope

### In scope

- **`AudioClipDefinition`** in
  `packages/domain/src/content-library/`: a managed project audio
  file with `definitionId`, `definitionKind: "audio-clip"`,
  `displayName`, `source.relativeAssetPath`, `fileName`, `mimeType`,
  and optional metadata such as duration once import can read it.
- **`SoundCueDefinition`** in the content library: reusable authored
  playback behavior that references one or more clip ids.
- **Cue categories:** `music`, `sfx`, `ambient`, `ui`, and `voice`.
  Sugarengine had three categories; Sugarmagic adds `ui` and `voice`
  now so the player settings mixer has stable slots from day one.
- **Cue playback modes:** `single`, `random`, `sequence`,
  `loop`, and `random-interval`.
- **Cue controls:** volume, pitch, random volume/pitch range, fade
  in/out, max simultaneous instances, retrigger policy, and optional
  Howler sprite segment metadata for future audio atlases.
- **Spatial cue defaults:** `spatial: false | true`, min/max
  distance, rolloff, cone settings, and whether the listener should
  be player-position or camera-position driven. Runtime stores
  semantic positions; target-web maps them to Howler panning.
- **Region-owned audio bindings:** ambient zones and sound emitters
  are authored on `RegionDocument`, because they are application-site
  truth. The reusable cue stays in the content library; the placement,
  radius/shape, trigger, and overrides live in the region.
- **Gameplay event bindings:** a project-level map from runtime event
  keys to cue ids, plus optional per-definition overrides for Player,
  Item, Spell, NPC, Quest, and UI actions where the existing authored
  kind already owns the intent.
- **Managed audio import:** `packages/io` writes audio files under
  `assets/audio/<kind-or-cue>/<sanitized-name>.<ext>` and returns an
  `AudioClipDefinition`. Asset-source collection includes those paths
  so blob URLs are available in Studio and preview.
- **Runtime sound event model:** `packages/runtime-core/src/audio/`
  defines typed `RuntimeSoundEvent`, `RuntimeSoundCommand`,
  `RuntimeAudioMixerState`, and `RuntimeAudioController` interfaces.
  Gameplay systems emit semantic events; the controller resolves cue
  definitions and produces commands for a target adapter.
- **Web target adapter:** `targets/web/src/audio/` owns Howler,
  creates/loads/unloads `Howl`s, applies category volumes, realizes
  fades/loops/randomization/spatial panning, handles browser audio
  unlock, and disposes cleanly on preview/session teardown.
- **Studio Library > Audio popover:** browse/import/rename/delete
  project-scoped reusable audio clips with editor-side file preview.
- **Build > Audio workspace:** list/detail authoring for reusable
  sound cues, center-panel cue audition transport, category/mode/
  volume/pitch/fade/spatial controls, event bindings, and mixer
  settings.
- **Layout audio objects:** viewport-backed authoring for region
  emitters and ambience zones as scene/application-site objects.
  It should feel like other Layout scene placement: central viewport,
  sound icons, radius/zone handles, right-side inspector, and cue
  selection via dropdown.
- **Game UI integration:** authored UI actions from Epic 039 can emit
  `ui-click`, `ui-hover`, and menu music events through runtime-core
  command/action handling instead of direct DOM audio.
- **Settings integration:** authored UI can bind to and update master,
  music, sfx, ambient, ui, and voice volumes. The target adapter
  applies the mixer state.
- **Tests:** domain normalization, IO import paths, asset-source
  enumeration, runtime event-to-command resolution, target-web adapter
  unit tests with a mocked Howler seam, and boundary grep tests.

### Out of scope

- **Waveform editing.** V1 previews clips but does not draw or edit
  waveforms.
- **DAW-style timelines.** Music transitions/crossfades are in scope;
  authored musical timelines/stems are not.
- **Procedural synthesis.** Imported audio files first.
- **Lip sync.** Voice category exists, but phoneme alignment is a
  future epic.
- **Occlusion/reverb simulation.** Spatial distance/panning is in
  scope; acoustic rooms, portals, and reverb buses are future work.
- **Non-web target implementation.** The model must be target-agnostic,
  but only `targets/web` gets a playback adapter in this epic.

## Shape Sketch

```ts
type SoundCategory = "music" | "sfx" | "ambient" | "ui" | "voice";

interface AudioClipDefinition {
  definitionId: string;
  definitionKind: "audio-clip";
  displayName: string;
  source: {
    relativeAssetPath: string;
    fileName: string;
    mimeType: string | null;
  };
  durationSeconds?: number | null;
}

interface SoundCueDefinition {
  definitionId: string;
  definitionKind: "sound-cue";
  displayName: string;
  category: SoundCategory;
  clips: Array<{
    audioClipDefinitionId: string;
    weight?: number;
    sprite?: { startMs: number; durationMs: number } | null;
  }>;
  playback: {
    mode: "single" | "random" | "sequence" | "loop" | "random-interval";
    volume: number;
    pitch: number;
    randomVolume?: [number, number] | null;
    randomPitch?: [number, number] | null;
    fadeInMs?: number;
    fadeOutMs?: number;
    maxInstances?: number;
    retrigger: "overlap" | "restart" | "ignore-while-playing";
    randomIntervalSeconds?: [number, number] | null;
  };
  spatial?: {
    enabled: boolean;
    refDistance: number;
    maxDistance: number;
    rolloffFactor: number;
  };
}

interface RegionSoundEmitter {
  emitterId: string;
  cueDefinitionId: string;
  position: [number, number, number];
  radius: number;
  trigger: "always" | "on-enter" | "random-interval" | "scripted";
  overrides?: Partial<SoundCueDefinition["playback"]>;
}

interface RuntimeSoundEvent {
  eventId: string;
  kind:
    | "play-cue"
    | "stop-cue"
    | "enter-audio-zone"
    | "leave-audio-zone"
    | "set-listener-pose"
    | "set-mixer-volume";
  cueDefinitionId?: string;
  position?: [number, number, number];
  sourceEntityId?: string;
}
```

## Stories

### 41.1 — Domain sound definitions and normalization

- Add `AudioClipDefinition` and `SoundCueDefinition` to
  `ContentLibrarySnapshot`.
- Add selectors, factories, CRUD authoring-session helpers, and
  normalization defaults.
- Add `audio-clip` and `sound-cue` to `ContentDefinitionKind`.
- Existing projects normalize missing arrays to `[]`.
- Decide whether built-in starter cues ship now. If they do, they
  must use engine-owned files and be marked built-in/non-deletable.

**Acceptance:**

- Domain tests prove empty legacy content libraries gain empty audio
  arrays.
- Removing an audio clip clears or warns cue references through one
  explicit helper; no silent dangling refs.
- `SoundCueDefinition` is the only reusable authored playback model.

### 41.2 — Audio import and asset-source plumbing

- Add `importAudioClipDefinition` in `packages/io`.
- Accept `.mp3`, `.ogg`, `.wav`, and MIME-compatible equivalents.
- Copy files under managed `assets/audio/` paths.
- Add audio paths to `collectRelativeAssetPaths`.
- Update Studio asset-source refresh flows so imported clips can be
  auditioned immediately.

**Acceptance:**

- Importing a clip writes a managed file and returns an
  `AudioClipDefinition`.
- Asset-source tests include clip paths.
- Existing texture/material/document imports are unchanged.

### 41.3 — Runtime audio event model

- Add `packages/runtime-core/src/audio/` with no browser imports.
- Define `RuntimeAudioController`, `RuntimeSoundEvent`,
  `RuntimeSoundCommand`, and `RuntimeAudioMixerState`.
- Runtime systems emit events; the audio controller resolves events
  against content-library cues and region bindings.
- Footsteps move from callback-style Sugarengine logic to runtime
  movement state. A movement system emits a `footstep-start` /
  `footstep-stop` semantic event, resolved through project bindings.

**Acceptance:**

- Runtime tests prove pickup/interact/footstep events resolve to cue
  commands.
- Boundary tests prove no `howler`, `Howl`, `window.AudioContext`, or
  DOM audio imports in `packages/runtime-core`.

### 41.4 — Web target Howler adapter

- Add `howler` and `@types/howler` to the workspace dependency graph.
- Implement `targets/web/src/audio/WebAudioAdapter` using Howler.js.
- Cache `Howl`s by clip definition id and source URL.
- Support category volumes, fade in/out, loop, one-shot, random clip
  selection, random interval scheduling, max instance policy, pause,
  resume, and dispose.
- Add listener pose updates and spatial panning for spatial cues.
- Handle browser audio unlock on first user gesture in preview and
  runtime.

**Acceptance:**

- Mocked adapter tests verify command realization without requiring
  real audio playback.
- Preview/session teardown unloads Howls and clears timers.
- No Howler imports outside `targets/web/src/audio/` and target root
  exports.

### 41.5 — Library > Audio clip management

- Add `Audio` to the Game > Libraries popover.
- Library > Audio owns clip import, browsing, rename, delete, and
  clip preview.
- Reuse existing editor UI components for lists, inspectors,
  dropdowns, file rows, and popovers; create reusable audio library
  components under the UI/workspace directories when needed.
- Library > Audio is not where cues are created and is not where
  emitters/zones are placed. It manages reusable clip assets only.
- Clip preview may use the shared editor audio preview surface, but it
  must not become runtime sound behavior.

**Acceptance:**

- Designer can import a clip from Library > Audio, see it in the clip
  library, preview it, rename it, and delete it through one library
  management flow.
- Imported clips are reusable inputs for cues and are available from
  Build > Audio cue clip selectors.
- All editor UI concepts introduced here are reusable components, not
  one-off JSX pasted into `App.tsx`.

### 41.6 — Build > Audio cue authoring

- Add an `audio` build workspace for reusable sound cues only.
- The left structure panel shows the cue list. The `+` action creates
  a new cue; selecting a cue opens its details.
- The center panel is the cue audition/playback UX with play, pause,
  stop, and scrub controls so designers can evaluate the authored cue
  without placing it in a scene.
- The inspector exposes display name, category, clip list, playback
  mode, volume, pitch, fade, randomization, max instances, retrigger
  policy, spatial defaults, mixer/event binding affordances, and other
  cue-level behavior.
- Runtime audition/playback goes through target-web audio commands. The
  Studio editor transport may use browser audio directly for scrub-able
  design-time preview, but it must not define runtime sound behavior.
- Build > Audio does not place sound emitters or ambience zones. It
  authors the reusable cue definitions those application sites bind to.

**Acceptance:**

- Designer can create a cue in Build > Audio, attach imported clips,
  audition it with transport controls, edit volume/playback behavior,
  and hear the changed result.
- Cue definitions are persisted in the content library and can be
  referenced from gameplay event bindings and Layout audio objects.
- No region emitter/zone placement UI exists in Build > Audio.

### 41.7 — Layout audio objects and viewport overlay

- Add sound emitters and ambience zones as Layout-placeable region
  audio objects.
- Region-owned sound emitters and ambience zones are authored from the
  Layout viewport and Layout inspector.
- Viewport overlay shows emitter icons, radii, and zone outlines.
- Inspector lets authors bind cue, trigger, radius/shape, loop/random
  behavior overrides, and enabled state.
- Selection uses shell selection state; no duplicate editor-only
  region model.

**Acceptance:**

- A placed emitter persists in `RegionDocument`.
- Moving/resizing an emitter updates the runtime region truth.
- Game preview hears the emitter through the same runtime event model.

### 41.8 — Gameplay, UI, and ambience bindings

- Add project-level sound event bindings for common events:
  `game.menu-open`, `game.menu-close`, `ui.click`, `ui.hover`,
  `player.footstep`, `item.pickup`, `interaction.activate`,
  `spell.cast-success`, `spell.cast-fail`, `quest.reward`.
- Allow specific authored definitions to override global bindings
  when they already own the intent, e.g. an Item-specific pickup cue
  or Spell-specific cast cue.
- Start/stop region ambience when active region changes.
- Route Epic 039 UI actions through runtime-core sound events.

**Acceptance:**

- Binding a cue to item pickup plays in game preview.
- Binding a cue to a menu button click plays through the target UI
  renderer without target-specific authored JS.
- Region switch stops old ambience and starts new ambience.

### 41.9 — Settings mixer and pause/resume lifecycle

- Add mixer state defaults: master, music, sfx, ambient, ui, voice.
- Settings UI can bind to the mixer values and dispatch volume
  updates.
- Preview pause/resume, tab visibility changes, and runtime teardown
  pause/stop sound according to category.
- Music can fade across menu/game transitions using authored cues,
  not hardcoded ids.

**Acceptance:**

- Changing music volume affects music only.
- Stopping preview stops all audio and clears timers.
- Restarting preview does not duplicate loops.

### 41.10 — Verification, diagnostics, and docs

- Add tests for domain, IO, asset sources, runtime command generation,
  and target adapter behavior.
- Add boundary guard coverage for Howler imports.
- Add a short ADR documenting the audio ownership split.
- Add READMEs for any new audio modules.
- Add debug logging hooks behind the existing render/runtime debug
  style, not noisy console output by default.

**Acceptance:**

- `pnpm typecheck`, focused audio tests, and boundary checks pass.
- The ADR answers:
  - What is the source of truth?
  - What is the single enforcer?
  - What Sugarengine path was replaced?
  - What can be deleted/avoided?
  - How do we verify sound works?

## UI Shape

### Build > Audio

```
Structure
  Cues
    Pickup Sparkle
    Forest Wind Loop
    Random Owl Calls

Center
  Cue audition transport
  Play / Pause / Stop / Scrub

Inspector
  Display Name
  Category
  Playback Mode
  Clip list
  Volume / Pitch / Randomization
  Fade
  Spatial defaults
```

### Layout Audio Placement

```
Viewport
  sound emitter icons
  radius rings
  ambience zone outlines

Inspector
  Cue
  Trigger
  Radius / zone
  Enabled
  Playback overrides
```

### Library > Audio

```
Structure
  pickup.wav
  forest_wind.ogg
  owl_1.ogg

Preview
  Clip playback transport
  Source path metadata

Actions
  Import Audio
  Rename
  Delete
```

## Data Flow

```
Library > Audio
    │
    ▼
ContentLibrarySnapshot.audioClipDefinitions

Build > Audio
    │
    ▼
ContentLibrarySnapshot.soundCueDefinitions

Layout
    │
    ▼
RegionDocument.audio.emitters / ambienceZones

Gameplay/UI binding editors
    │
    ▼
GameProject.soundEventBindings
    │
    ▼
runtime-core audio controller
    │  emits target-agnostic RuntimeSoundCommand[]
    ▼
target-web audio adapter
    │  Howler.js / browser audio unlock / panning / fades
    ▼
speaker output
```

## Risks and Design Notes

- **Browser autoplay restrictions:** target-web must own audio unlock
  and expose state to Studio/runtime UI. Silent failure is not
  acceptable; show "Click to enable audio" when needed.
- **Blob URL lifetime:** audio source URLs come from the same
  asset-source store as textures/models. Project switch must dispose
  Howls before old blob URLs are revoked.
- **Spatial listener choice:** v1 should default listener pose to the
  player for gameplay and camera for editor audition/preview when no
  player is active. The choice must be explicit in runtime command
  options, not guessed inside Howler.
- **One-shot spam:** cue max-instance/retrigger policy must be
  enforced in one place, the runtime audio controller, before target
  playback. Target-web can also guard defensively but must not become
  the semantic enforcer.
- **Future non-web targets:** no authored concept may expose Howler
  ids or browser-specific fields. Sprites are allowed as semantic
  clip segments; the target decides how to implement them.

## Build On / Interactions

- **Epic 037:** audio definitions follow the library-first content
  model: raw clips live in Library > Audio, while reusable cue
  behavior lives in Build > Audio.
- **Epic 038:** audio clips are file-backed project content like
  character assets, but they are reusable cue inputs rather than
  entity-owned slots.
- **Epic 039:** menu/HUD actions can emit sound events; Settings UI
  can bind to mixer volumes.
- **Epic 040:** managed-file import precedent mirrors document page
  images: files live in project folders and travel with the project.
- **Runtime spatial system:** ambience zones can eventually reuse
  region area semantics, but v1 should not block on that. Sound zones
  are authored region data and can later be cross-referenced with
  spatial areas.

## Implementation Pause Criteria

Stop after this epic when:

- Imported clips and authored cues exist in project data.
- Web preview can play authored music/SFX/ambient cues.
- A reusable cue can be authored from Build > Audio.
- A region emitter/ambience zone can be placed from Layout, bound to a
  cue, persisted in `RegionDocument.audio`, and heard.
- Footsteps/item pickup can trigger authored cues.
- No Howler/browser audio imports leak into domain/runtime-core.
- Existing projects load unchanged.

Do not continue into reverb, waveform editing, lip sync, or music
timeline authoring as part of Epic 041.
