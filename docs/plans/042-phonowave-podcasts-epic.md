# Plan 042: Phonowave Podcasts Epic

**Status:** Proposed
**Date:** 2026-05-03

## Epic

### Title

In-world podcast playback for Sugarmagic — game designers
author podcasts and episodes, then bind them to a **Phonowave**
spell that the player casts from their Caster. Casting Phonowave
opens a Spotify-style browser: list of podcasts → list of
episodes → episode player with transport controls. No new "apps
framework" — apps in this world ARE spells, so Phonowave joins
the spell catalog as a new kind of effect, not a parallel system.

### Goal

- **Two new project-scoped definitions:** `PodcastDefinition`
  with embedded `PodcastEpisode[]`. Each episode references
  exactly one `audioClipDefinitionId` from the audio library.
  Authored under a new Design > Podcasts workspace.
- **One new `SpellEffectType`** — `"open-phonowave"` joining the
  existing `event | unlock | world-flag | dialogue | heal | damage`
  union in `packages/domain/src/spell-definition/index.ts`.
- **Phonowave is a regular authored spell.** Designers create a
  spell (e.g. "Phonowave"), give it the `open-phonowave` effect,
  and it shows up in the Caster spell grid alongside Fireball or
  whatever else. No special-casing in the spell list UI.
- **A new self-contained runtime UI** — the Phonowave browser:
  podcast list view → episode list view → episode player with
  play / pause / stop / seek / Back. Opens when the
  `open-phonowave` effect fires; closes when the player presses
  Escape. Mounts and disposes alongside the gameplay session.
- **Episode playback uses the existing audio controller** from
  Plan 041. No parallel audio path. The episode player wraps a
  one-cue / one-clip play call and exposes transport.
- **Per-game inclusion is automatic.** A game that doesn't author
  a Phonowave spell simply doesn't have podcast playback —
  nothing to disable, nothing to gate. A game that does author
  one but with zero podcasts authored shows an empty browser
  with a friendly empty state.

### Why this epic exists

The Caster device in Sugarmagic's world is the player's magical
iPhone — apps on it ARE spells, both metaphors collapse into
one. Adding a podcast player to the Caster therefore should NOT
introduce an "apps" framework that runs parallel to the spell
system. It should ride on the spell system: a podcast player is
just a spell that opens a UI instead of dealing damage.

Plan 041 shipped the underlying audio infrastructure
(`AudioClipDefinition`, `SoundCueDefinition`, the runtime audio
controller, the WebAudioAdapter). Plan 042 stacks on top to
deliver the first **gameplay-facing** consumer of authored audio
that goes beyond fire-and-forget cues — namely, browsable
collections of long-form audio with transport controls.

The framing also keeps inclusion clean: every game built on
Sugarmagic ALREADY has spells; it does NOT already have a
"podcast subsystem." If the spell catalog is the inclusion
mechanism, no game pays a tax for a feature it doesn't use.

### Goal-line test

After 042 lands:

- A designer in Studio creates a Podcast under Design > Podcasts
  with displayName `"Mim Investigates"`. Adds two episodes
  (`"Trailer"`, `"Episode 1: The Bell"`) and binds each to an
  imported audio clip from Library > Audio.
- They create a Spell under Design > Spells named `"Phonowave"`
  with effect type `open-phonowave`.
- They run the game. Player presses `C` to open the Caster.
  The spell grid shows their existing spells plus Phonowave.
  Player picks Phonowave → browser opens to podcast list →
  click `Mim Investigates` → episode list → click `Trailer` →
  episode player loads with transport controls → click play →
  trailer audio plays through the Music or Voice mixer category
  (designer's choice, defaulting to Voice).
- Player presses Pause → audio pauses. Click Stop → audio
  stops. Click Back → returns to episode list. Press Escape →
  closes the browser entirely; Caster stays open. Press Escape
  again → Caster closes.
- A second game built on Sugarmagic that authors no Phonowave
  spell sees nothing different about its Caster — no empty app
  slot, no gated UI, just spells.

## Scope

### In scope

- **Domain:**
  - Add `"open-phonowave"` to `SpellEffectType`.
  - New `PodcastDefinition` interface: `definitionId`,
    `displayName`, `description`, `coverArtAssetPath: string | null`
    (managed file, optional), `episodes: PodcastEpisode[]`.
  - New `PodcastEpisode` interface: `episodeId`, `displayName`,
    `description?`, `audioClipDefinitionId: string`,
    `durationSeconds?: number | null` (optional metadata).
  - New `podcastDefinitions: PodcastDefinition[]` field on
    `GameProject`. Defaults to `[]` for legacy projects;
    normalizer drops nothing.
- **Commands:**
  - `CreatePodcastDefinition`, `UpdatePodcastDefinition`,
    `DeletePodcastDefinition`.
  - `AddPodcastEpisode`, `UpdatePodcastEpisode`,
    `RemovePodcastEpisode`, `ReorderPodcastEpisode`.
  - Authoring session command handlers + history support.
- **IO:**
  - New `packages/io/src/podcast-cover-art/index.ts` exporting
    `writePodcastCoverArtFile(handle, podcastDefinitionId, blob):
    Promise<string>` — writes to
    `assets/podcasts/<sanitizedId>/cover.png`. Mirrors the mask
    + item-thumbnail + document-page managed-file pattern.
- **Asset sources:**
  - Extend `collectRelativeAssetPaths` in
    `packages/shell/src/asset-sources/index.ts` to enumerate
    every `gameProject.podcastDefinitions[].coverArtAssetPath`
    for non-null values.
- **Studio Podcasts workspace** (new
  `packages/workspaces/src/design/PodcastWorkspaceView.tsx`):
  - Left panel: list of podcasts with add/delete (mirrors the
    Documents workspace pattern).
  - Center panel: per-podcast detail showing the episode list
    with reorderable rows, each row exposing the episode's
    audio clip via the existing `<Select>` clip picker pattern.
    "Add Episode" button. Episode row also shows the bound
    clip's filename + a small audition Play button (uses
    `AudioTransport`).
  - Right panel: per-podcast inspector — display name,
    description (Textarea), cover art picker (uses
    `InlineAssetField`-style file picker for the cover image).
- **Spell editor:**
  - Spell-effect-type dropdown gains an `Open Phonowave` option.
  - Selecting it surfaces no extra fields — the spell's effect
    is purely "open the browser," with no per-spell podcast
    binding (the browser shows ALL authored podcasts).
- **Runtime browser UI** (new
  `packages/runtime-core/src/phonowave/index.ts`):
  - Self-contained DOM overlay similar in shape to
    `RuntimeDocumentReaderUI` and `RuntimeSpellMenuUI`.
  - Three views: podcast list, episode list (for the selected
    podcast), episode player (transport).
  - Back button on episode-list and player views; Escape closes
    the whole browser.
  - Resolves cover-art and audio URLs through the same
    `getAssetUrl`-style callback the inventory and document
    reader already use.
  - Plays episodes through the existing
    `RuntimeAudioController` via a synthesized one-shot cue
    (`category: "voice"` by default, overridable via a future
    per-podcast setting — out of scope for v1).
- **Spell-effect handler wiring** in
  `packages/runtime-core/src/caster/CasterManager.ts` (or its
  effect dispatch site): when an effect's `type ===
  "open-phonowave"` resolves, call into the browser UI's
  `open()` instead of hitting the dialogue / damage / heal
  branches.
- **Tests:**
  - Domain round-trip for the new types and command handlers.
  - Spell-effect dispatch routes `open-phonowave` correctly.
  - Browser UI integration test: open via spell, navigate
    podcast → episode → play, verify the audio adapter receives
    the right cue.

### Out of scope

- **Per-podcast or per-episode unlock conditions.** All authored
  podcasts are visible from the moment the player has the
  Phonowave spell. Quest-gated visibility is an obvious future
  feature; defer until a designer asks for it.
- **Listened / unlistened state, resume position, playlists,
  download management.** The player can seek inside the current
  episode but no per-episode persistence. v1 = walking radio,
  not Spotify-state-engine.
- **Live transcripts or per-episode chapters.** Visual UI shows
  episode title + description only.
- **Spatial / 3D-positioned episodes.** Phonowave audio is 2D
  through the Voice (or Music) mixer category. If you want a
  podcast playing FROM a radio in the world, that's a region
  emitter authored with the cue system from 041 — different
  feature.
- **Authoring podcasts as projectable cues that other systems
  can trigger.** A podcast is browser-only. If a designer wants
  the same audio fired from a non-browser context (e.g. quest
  reward), they create a separate `SoundCueDefinition` referencing
  the same `AudioClipDefinition` — no new linkage.
- **Multiple cover-art images per podcast** (square, banner,
  hero). One cover per podcast.
- **Browser styling theme tokens.** Uses the same dark-translucent
  styling family as the spell menu and document reader. Authored
  theming via `UITheme` is a Plan 039 concern; if Phonowave grows
  custom skinning later, that's its own follow-up.

## Shape sketch

```
Domain
  SpellEffectType = "event" | "unlock" | "world-flag"
                  | "dialogue" | "heal" | "damage"
                  | "open-phonowave"   (NEW)

  PodcastDefinition (NEW)
    definitionId
    displayName
    description
    coverArtAssetPath: string | null
    episodes: PodcastEpisode[]

  PodcastEpisode (NEW)
    episodeId
    displayName
    description?
    audioClipDefinitionId
    durationSeconds?

  GameProject {
    …existing…
    podcastDefinitions: PodcastDefinition[]   (NEW; default [])
  }

Project file
  assets/
    podcasts/
      <podcastId>/
        cover.png

Authoring
  Design > Spells: "Phonowave" spell, effect = open-phonowave
  Design > Podcasts: podcasts + episodes
  Library > Audio: imported clips (existing)

Runtime flow
  Player presses C
    → SpellMenu opens (existing)
  Player picks Phonowave
    → CasterManager dispatches the spell's effect
    → effect type "open-phonowave" routes to phonowaveUi.open()
    → browser overlay mounts

  Phonowave browser
    podcast list   →   episode list   →   episode player
                  ←   Back            ←   Back
    [Esc] closes the whole browser at any view
```

## Stories

### 42.1 — Domain types + commands

- Extend `SpellEffectType` union with `"open-phonowave"`.
- Add `PodcastDefinition` + `PodcastEpisode` interfaces with
  factory + normalizer.
- Add `podcastDefinitions` field on `GameProject` with default
  + normalizer.
- Add commands: `CreatePodcastDefinition`,
  `UpdatePodcastDefinition`, `DeletePodcastDefinition`,
  `AddPodcastEpisode`, `UpdatePodcastEpisode`,
  `RemovePodcastEpisode`, `ReorderPodcastEpisode`.
- Authoring session handlers + history support.
- Round-trip + normalizer tests.

**Files touched:**
- `packages/domain/src/spell-definition/index.ts`
- `packages/domain/src/podcast-definition/index.ts` (new)
- `packages/domain/src/game-project/index.ts`
- `packages/domain/src/commands/index.ts`
- `packages/domain/src/authoring-session/index.ts`
- `packages/domain/src/index.ts`
- `packages/testing/src/podcast-definition.test.ts` (new)

### 42.2 — IO + asset-source enumeration

- Add `writePodcastCoverArtFile` IO helper.
- Extend `collectRelativeAssetPaths` to include
  `podcastDefinitions[].coverArtAssetPath` non-null entries.
- Test that asset-source store loads cover art on project open.

**Files touched:**
- `packages/io/src/podcast-cover-art/index.ts` (new)
- `packages/io/src/index.ts` (re-export)
- `packages/shell/src/asset-sources/index.ts`
- `packages/testing/src/asset-source-store.test.ts` (extend)

### 42.3 — Studio Podcasts workspace

- New `Design > Podcasts` workspace with left list / center
  episode editor / right inspector.
- Center panel uses the same generous-spacing pattern as the
  audio cue clips list (post-041 fix): each episode is its own
  bordered card with a clip Select on its own row, name +
  description fields below, and a small audition Play button
  using `AudioTransport`.
- Right panel inspector: name, description, cover art picker.
- Wire `onAppendPodcastCoverArt` callback through the design
  workspace props the same way `onGenerateItemThumbnail` and
  `onAppendDocumentPage` are.

**Files touched:**
- `packages/workspaces/src/design/PodcastWorkspaceView.tsx` (new)
- `packages/workspaces/src/design/index.tsx` (wire it in)
- `packages/shell/src/index.ts` (extend `DesignWorkspaceKind`
  with `"podcasts"`)
- `apps/studio/src/App.tsx` (handler + projection wiring)

### 42.4 — Spell editor "Open Phonowave" effect option

- The existing spell-effect-type dropdown in the spell editor
  gains an `Open Phonowave` option mapped to
  `"open-phonowave"`. No additional fields when selected.

**Files touched:**
- `packages/workspaces/src/design/SpellWorkspaceView.tsx`

### 42.5 — Runtime Phonowave browser UI

- New `packages/runtime-core/src/phonowave/index.ts` exporting
  `createRuntimePhonowaveBrowser(parentContainer, options)`.
  Options: `getAssetUrl`, `audioController`,
  `getPodcastDefinitions: () => PodcastDefinition[]`,
  `getAudioClipDefinitions: () => AudioClipDefinition[]`.
- Three sub-views (podcast list, episode list, episode player)
  with internal navigation state.
- Episode player builds a one-cue-one-clip play call into the
  audio controller; transport controls (play/pause/stop/seek)
  drive the underlying Howl via the controller, NOT direct
  Howler access (the audio adapter owns Howler).
- Escape closes the entire browser; Back navigates one level.
- Movement-lock + can-open coordination with other modal UIs
  via the inputManager pattern already used by inventory and
  document reader.
- Inject default styling — dark translucent overlay matching
  the existing modal family (spell menu, document reader).

**Files touched:**
- `packages/runtime-core/src/phonowave/index.ts` (new)
- `packages/runtime-core/src/index.ts` (re-export)
- Possibly extend `RuntimeAudioController` if the existing
  cue API can't cleanly express "play this single clip with
  transport controls" — verify before story starts.

### 42.6 — Spell-effect dispatch wiring

- Caster spell-effect dispatch (in `CasterManager.ts` or its
  call site in `gameplay-session.ts`) gains a branch for
  `effect.type === "open-phonowave"` that opens the browser.
- Browser UI is created in `gameplay-session.ts` alongside the
  other modal UIs (inventory, document reader, item view) and
  passed through to the caster's effect dispatcher.
- Integration test: cast a Phonowave spell, browser opens,
  navigate to an episode, play, verify audio command queued.

**Files touched:**
- `packages/runtime-core/src/caster/CasterManager.ts`
- `packages/runtime-core/src/coordination/gameplay-session.ts`
- `packages/testing/src/phonowave-flow.test.ts` (new)

## Success criteria

- All `pnpm typecheck`, `pnpm test`, `pnpm lint` pass.
- Goal-line test passes end-to-end in a real Studio session.
- A game project that authors no Phonowave spell behaves
  identically to before this epic — same Caster, same spell
  grid, no Phonowave anywhere.
- A game with a Phonowave spell but zero podcasts shows an
  empty-state browser with a friendly message, not a crash.
- Cover art images stored under `assets/podcasts/<id>/cover.png`
  are NOT visible in the texture browser (managed-file pattern
  preserved).
- No new `WebGPURenderer` or `Howler` instantiation sites
  outside the existing sanctioned host modules.

## Risks

1. **Transport controls coupling.** The existing
   `RuntimeAudioController` is fire-and-forget for cues. Adding
   "pause this active instance and resume later" may need new
   methods (`pauseInstance`, `resumeInstance`,
   `seekInstance`). If it grows past a couple of methods,
   pause to confirm the API shape rather than letting the
   audio controller bloat.
2. **Modal UI contention.** Phonowave joins inventory, document
   reader, item view, dialogue, spell menu in the modal-stacking
   game. Verify the input-lock + can-open guards behave when
   the player tries to open the inventory while a podcast is
   playing — paused? muted? keep playing? v1 default: keep
   playing in the background; let the player open inventory
   without stopping audio.
3. **Episode reorder + active playback.** If the player is
   listening to episode 3 of a podcast and the designer
   reorders it to position 1 mid-session, the browser's
   navigation index could point at a different episode. Cover
   with: when `episodes` array changes while the player view
   is open, refresh the player against the still-bound
   `episodeId`, not array index.
4. **Cover-art file orphans.** Same pattern as Plan 040 image
   pages and Plan 040's item thumbnails — deleting a podcast
   doesn't sweep its cover-art file. Acceptable for v1; the
   same eventual "tidy project" tool would address all
   managed-file orphans together.

## Builds on

- **Plan 037 (Library-First Content Model)** — managed-file
  pattern for project-scoped binary assets (cover art).
- **Plan 040 (Image-Page Documents)** — same managed-file
  shape for `assets/<type>/<id>/<file>.png`, same
  asset-source enumeration extension.
- **Plan 041 (Sound System)** — `AudioClipDefinition`,
  `SoundCueDefinition`, `RuntimeAudioController`, and the
  WebAudioAdapter all already exist. Plan 042 is the first
  consumer that needs transport-style playback rather than
  fire-and-forget cues.
