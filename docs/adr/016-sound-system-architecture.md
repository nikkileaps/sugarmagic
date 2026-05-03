# ADR 016: Sound System Architecture

## Status

Accepted.

## Context

Sugarmagic needs authorable game sound without recreating Sugarengine's
global `audio.play(...)` path. Runtime-visible sound behavior must be authored
once, resolved once, and played by targets without leaking browser APIs into
domain or runtime-core.

## Decision

- `packages/domain` owns authored sound truth: `AudioClipDefinition`,
  `SoundCueDefinition`, project-level sound event bindings, mixer settings,
  and `RegionDocument.audio`.
- `packages/runtime-core/src/audio` is the single runtime enforcer. Gameplay
  systems emit semantic events, the controller resolves those events and region
  audio state into target-neutral `RuntimeSoundCommand`s, and it has no browser
  or Howler dependency.
- `targets/web/src/audio` owns browser playback with Howler.js, including
  unlock, Howl lifetime, fades, loops, random interval scheduling, spatial
  panning, pause/resume, and teardown.
- Studio imports audio files through `packages/io`, manages reusable clips in
  Library > Audio, edits reusable sound cues in Build > Audio, and places
  emitters/ambience zones in Layout as cue application sites. Runtime playback
  goes through the target-web adapter; Studio's scrub-able editor transport is
  a design-time preview surface and does not define runtime sound behavior.
- The UI model intentionally keeps three concepts separate: Library > Audio
  manages raw clip assets, Build > Audio manages reusable cue definitions, and
  Layout manages region-owned emitters/ambience zones that bind to cues.

## Consequences

- The source of truth is the project document and content library, not target
  code or editor UI state.
- The single enforcer for runtime sound intent is `RuntimeAudioController`.
- The old Sugarengine direct playback path is replaced by semantic event
  bindings and authored cues.
- Emitters and ambience zones are application-site truth in
  `RegionDocument.audio`; they are not cue definitions and they do not bind
  directly to raw clips.
- We avoid adding target audio imports to runtime-core; this is verified by
  tests and package boundaries.

## Verification

- Existing projects normalize missing audio fields to empty collections and
  default mixer values.
- Imported clips become managed project files under `assets/audio/`.
- Runtime tests assert event and region audio state produce sound commands.
- Boundary tests assert Howler/browser audio imports do not enter
  `packages/runtime-core`.
