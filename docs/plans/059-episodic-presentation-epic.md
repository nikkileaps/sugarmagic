# Plan 059 — Episodic presentation layer (end-of-Scene sequence + Episodes menu)

Status: proposed
Owner: nikki + claude
Date: 2026-07-04

Related: Plan 058 (Scenes content model — this plan is the presentation layer over that model; `campaign.progression`, `transitionConfig`, and `advanceToNextScene` are its substrate). Plan 055 (SaveParticipant model — the replay-sandbox tension below has save-shape implications). Blocks on nothing; 058 must be merged first.

## Framing

058 gave the engine Scenes as a content + progression model: overlays compose per Scene, quests advance the campaign, a title card marks entry. What's missing is the *feel* of an episodic game — the Netflix/prestige-TV rhythm where an episode ENDS as an event: music, credits, a beat to breathe, then either a one-button slide into the next episode or a graceful return to a browsable episode list.

Genre survey (2026-07-04, see 058-era discussion): Telltale / Life is Strange / As Dusk Falls converge on the same loop — end card, (stats), credits, next-episode hook, auto-advance or menu return. Episode selection is universally a dedicated main-menu surface (cards with title / synopsis / lock state / completed marker), never an overload of Continue. As Dusk Falls is the closest reference for the requested feel: continuous binge by default, menu when you stop.

## Decisions already made (2026-07-04, nikki)

1. **Replay semantics: forward-only for v1** — the Episodes menu can only jump to the player's current frontier Scene; completed Scenes are visible but not enterable. **Designed-for future: sandbox replay mode** — see the central design tension below. Every data structure this plan introduces must not paint us out of that corner.
2. **Credits are project-level** — one authored credits roll, shown after every Scene's end sequence. No per-Scene credits.
3. **End-of-sequence routing, Netflix-style**:
   - Next Scene unlocked → a "Next: <Scene title>" button that (a) advances immediately on press and (b) visually FILLS over a countdown (~10s), auto-advancing when full.
   - No next Scene unlocked → after credits, a "Back to Episodes" button; no countdown. Player lands on the Episodes menu.

## Central design tension — the future sandbox replay mode

The eventual goal (nikki, 2026-07-04): a completed Scene can be revisited as a SANDBOX — all authored content in its END state (quests complete, story beats resolved), player wanders the environments, examines items, and talks to agentified NPCs — explicitly as language practice in sugarlang-enabled games. The real save is untouched; leaving the sandbox returns to the frontier.

Not built in this plan, but these constraints bind NOW:

- **Never let live-save writes assume "the active Scene is the frontier Scene."** The sandbox will boot a non-frontier Scene with persistence suppressed or redirected. Concretely: the autosave source, `campaign.progression` serialization, and `world.presence` writes should stay behind host-owned seams (they already are, post-055/058) so a future "sandbox session" flag can no-op or fork them in ONE place, not N.
- **"End state" needs a definition.** A sandbox visit wants quests-complete / items-collected-or-not? / NPCs in final positions. Cheapest robust source: a per-Scene END-STATE SNAPSHOT — when the player completes a Scene, capture the relevant slices (quest flags, NPC positions, world.presence for that Scene) into a `sceneEndStates[sceneId]` record. Decision deferred, but 059's completion path should be built so inserting "capture snapshot at completion" later is additive (a hook point at Scene-complete, not a rewrite).
- **Dialogue/agent availability in end state** — sugarlang conversation availability is quest-gated today; sandbox mode will need an "everything conversational stays conversational" override. Plugin-context concern, noted for the sandbox story, no 059 action.

## Stories

### 059.1 — Background music / soundtrack system (unblocks everything musical)

The deferred trigger from Plan 058 fires here: `Scene.audioOverride` exists with no system to apply it, and the end-of-Scene sequence needs music.

- Runtime music channel: play / crossfade / stop a looping music track, routed through the existing `audioMixer.music` volume. Howler-based like the SFX path, host-owned lifetime (survives assembly rebuilds).
- Project-level default background music binding + per-Scene `audioOverride.backgroundMusicId` finally applied at Scene load (falls through per the 058 type contract). Remove the corresponding Defers entry in Plan 058.
- End-sequence music: the end-of-Scene sequence (059.3) gets its own track slot (project-level "credits theme", authored with the credits).
- Studio authoring: project settings surface for default music + credits theme; Scene properties panel's audio override becomes editable (it's currently UI-less by design).

### 059.2 — Project-level credits definition + authoring

- Domain: `creditsDefinition` on GameProject — ordered sections (heading + lines), plus `creditsThemeMusicId`. Normalizer + defaults (empty = skip credits entirely in the runtime sequence).
- Studio: minimal credits editor (Publish or a project-settings surface — decide at implementation; it's a rarely-touched artifact).
- Runtime: a credits roll renderer (DOM overlay in the `sceneTransitionCard` family — same non-React rationale), skippable by input, music under it via 059.1.

### 059.3 — End-of-Scene sequence (replaces bare advance-reload)

The `advanceToNextScene` path stops being "card then reload" and becomes the authored sequence:

1. **End card** — the COMPLETED Scene's `transitionConfig` repurposed as its end card ("End of Scene 1" framing is the author's choice of title text). Note the semantic flip from 058: the card belonged to the *entered* Scene; the genre survey says end cards belong to the *finished* episode. Migration consideration: wordlark's existing authored cards (if any) move intent from "entry" to "exit" — acceptable pre-release, called out in the story.
2. **Credits** — project-level roll (059.2), skippable, with credits theme (059.1). Skipped entirely when no credits are authored.
3. **Routing screen** — per decision 3: filling "Next: <title>" countdown button when a next Scene is unlocked (press = advance now; full = auto-advance); "Back to Episodes" otherwise. Both paths keep the force-save + skip-start-menu reload machinery from 058.5 — the sequence happens BEFORE the reload, the reload lands either in the next Scene or on the Episodes menu.
4. Scene-complete hook point: a single host function marks the Scene completed + (future) captures the end-state snapshot — the sandbox insertion point per the design tension.

### 059.4 — Episodes menu (start-menu surface + post-credits destination)

- A dedicated Episodes screen: one card per Scene — `displayName`, `description` (synopsis), completed marker, lock state (from `campaign.progression` + unlock conditions), and the current frontier highlighted.
- Forward-only v1: only the frontier Scene is enterable ("Continue" on its card); completed cards render their state but are not clickable-to-play (visual affordance reserved for the future sandbox replay).
- Entry points: start-menu item ("Episodes" — label follows `scenesUiLabel`), and the post-credits "Back to Episodes" routing (059.3).
- Implementation surface: decide menuDefinitions-authored vs built-in screen at implementation time; lean built-in (like the start menu chrome) since its content is entirely derived from Scenes + save state, not authored layout.

### 059.5 — End-to-end verify + wordlark dress rehearsal

- Author in wordlark: credits + credits theme, end cards on both Scenes, default + per-Scene music.
- Full loop: play Scene 1 → complete final quest → end card → credits w/ music → filling Next button → auto-advance into Scene 2 → play → complete → credits → no next Scene → Back to Episodes → menu shows Scene 1 + 2 completed.
- Hard-refresh + Continue mid-sequence and post-sequence: campaign state correct in all cases.

## Defers

- **Sandbox replay mode** (the central tension above) — its own epic when we get there; 059 only preserves the insertion points.
- Per-Scene credits, next-episode teaser reels, Telltale-style choice stats.
- Episode thumbnails on the Episodes menu (needs a capture/asset story; cards are text-first in v1).
- Auto-advance countdown duration as an authored setting (hardcode ~10s in v1).
