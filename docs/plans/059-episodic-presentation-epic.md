# Plan 059 — Episodic presentation layer (end-of-Scene sequence + Episodes menu)

Status: implemented (059.1-059.6), verified by nikki 2026-07-05
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

- Runtime music channel: play / crossfade / stop a looping music track, routed through the existing `audioMixer.music` volume. Howler-based like the SFX path, host-owned lifetime (survives assembly rebuilds). Implemented as a thin `setMusicTrack` method over the existing platform-free audio command model — the adapter already had looping, fades, and the music mixer category.
- Project-level default background music binding + per-Scene `audioOverride.backgroundMusicId` finally applied at Scene load (falls through per the 058 type contract). Remove the corresponding Defers entry in Plan 058.
- **Menu music slot** (added 2026-07-04, nikki): `musicBindings.menuMusicId` plays over the start menu, crossfades away at start-menu -> playing, returns on quit-to-menu. The intended IN-GAME default is SILENCE (BotW model — see the conditional-music Defers entry); the in-game slot exists but is recommended empty.
- End-sequence music: the end-of-Scene sequence (059.3) gets its own track slot (project-level "credits theme", authored with the credits).
- Studio authoring: Build > Audio gains a Music section (menu / in-game / credits theme pickers); Scene properties panel's audio override becomes editable.

### 059.2 — Project-level credits definition + authoring

- Domain: `creditsDefinition` on GameProject — ordered sections (heading + lines), plus `creditsThemeMusicId`. Normalizer + defaults (empty = skip credits entirely in the runtime sequence).
- Studio: credits editor landed in the **Game UI workspace** (2026-07-05, nikki — credits are a player-facing screen, same species as menus, and that workspace is where richer design + preview grow). Edits commit on change like every other Studio field; the session preserves text verbatim and normalization happens at load/publish so typing never fights the cursor.
- Runtime: a credits roll renderer (DOM overlay in the `sceneTransitionCard` family — same non-React rationale), music under it via 059.1. The "skippable by any input" idea was superseded 2026-07-05: the routing button rendered OVER the credits (see 059.3) is the only control.

### 059.3 — Entry + exit sequences (replaces bare advance-reload)

**Decision (2026-07-04, nikki, superseding the earlier "semantic flip" idea): the Scene title card stays an ENTRY card, exactly as 058 authored it.** Netflix model: you select the episode (or press Next), the show's title plays, then the episode's title, then content. Credits belong to the exit; titles belong to the entry. No repurposing, no migration of card intent.

**Exit sequence** — runs when the Scene completes, BEFORE the reload (over the finished world). Refined 2026-07-05 (nikki): credits and routing are ONE overlay, not two steps — the routing control sits in the bottom-right corner OVER the rolling credits, exactly like Netflix:

1. Force-save, then the exit overlay fades in (black) with the credits scrolling (skipped when none authored) and the credits theme under everything.
2. **Routing control, bottom-right over the credits**: filling "Next: <Scene title>" countdown button when a next Scene is unlocked (press = advance now; full = auto-advance ~10s — long credits get cut short mid-roll, Netflix binge behavior); after the finale, a "Back to <label>s" button with no countdown — the credits finish and the screen holds until pressed. No "press any key to skip"; the button is the interaction.
3. Both paths keep 058.5's force-save + skip-start-menu reload machinery; the reload lands either in the next Scene or on the Episodes screen.
4. Scene-complete hook point: `hostMarkSceneCompleted` — the single host function that marks completion; the future end-state snapshot capture inserts there (sandbox insertion point per the design tension). A null advance target is the FINALE case, not an error.

**Entry sequence** — runs AFTER the reload, at boot into a freshly-entered Scene (doubles as a loading mask; identical whether entry came from the Next button or the Episodes menu):

1. **Optional intro slot** — reserved for a future authored opening (logo sting / cold-open video); v1 ships without it, the sequence just starts at step 2. Slot documented so adding it later is additive.
2. **Game title card** — the project's title ("the show's title"). Minimal authored config (project-level; reuse the card renderer).
3. **Scene title card** — the entered Scene's `transitionConfig` (unchanged 058 semantics), fading into gameplay.

**Resume rule**: plain Continue mid-Scene does NOT replay the entry sequence — titles fire only on fresh Scene entry (Netflix doesn't re-run the title when you resume an episode halfway). Mechanically: the reload handshake carries an "entering Scene fresh" marker; a boot without it (normal Continue, hard refresh) goes straight to gameplay.

### 059.4 — Episodes menu (start-menu surface + post-credits destination)

- A dedicated Episodes screen: one card per Scene — `displayName`, `description` (synopsis), completed marker, lock state (from `campaign.progression` + unlock conditions), and the current frontier highlighted.
- Forward-only v1: only the frontier Scene is enterable ("Continue" on its card); completed cards render their state but are not clickable-to-play (visual affordance reserved for the future sandbox replay).
- Entry points: start-menu item ("Episodes" — label follows `scenesUiLabel`), and the post-credits "Back to Episodes" routing (059.3).
- Implementation surface: decide menuDefinitions-authored vs built-in screen at implementation time; lean built-in (like the start menu chrome) since its content is entirely derived from Scenes + save state, not authored layout.

### 059.5 — End-to-end verify + wordlark dress rehearsal

- Author in wordlark: credits + credits theme, game title card, Scene title cards on both Scenes, default + per-Scene music.
- Full loop: play Scene 1 → complete final quest → credits w/ music + filling Next button bottom-right → reload → game title → "Scene 2" title card → gameplay in Scene 2 → complete → credits → Back to Scenes → start menu with Episodes open, Scene 1 + 2 completed.
- Episodes-menu Continue on the frontier card RESUMES gameplay (no title replay) — corrected from the original sketch 2026-07-05: the frontier card resumes a Scene in progress, and the resume rule (titles only on fresh Scene entry) governs. Titles play only when the campaign ADVANCES into a Scene.
- Resume rule: hard-refresh + Continue mid-Scene boots straight to gameplay, NO title replay; campaign state correct in all cases.
- Verified by nikki 2026-07-05 through the exit-overlay refinement.

### 059.6 — Live credits preview in Game UI (pulled forward from Defers, 2026-07-05)

Executed out of numeric order (before 059.4/059.5) at nikki's call — no reason to wait.

- Selecting Credits in the Game UI workspace renders a LIVE looping roll preview in the center panel (the slot menus preview in), showing exactly what the runtime renders: normalized content (blanks dropped), same typography/colors/pacing as the runtime exit overlay (`showSceneExitOverlay`) — shared constants + a shared duration formula so preview and runtime can't drift.
- Updates as the author types (session commits per keystroke per 059.2); loops with a short pause between cycles.
- Styled credits design (fonts / colors / images / timing beyond plain sections) remains future work in Defers below.

## Defers

- **Styled credits design** (2026-07-05) — styling beyond plain text sections (logos, per-section fonts/colors, timing control). The 059.6 preview makes each future styling decision checkable without an in-game round trip. Revisit trigger: the first time credits content needs more than text (a logo, a styled heading).
- **Conditional / ambient music system** (2026-07-05, nikki) — the intended in-game music model is BotW / Elder Scrolls: SILENCE as the default gameplay state, with music as punctuation — stingers on timers, condition combinations, actions. 059.1 ships the substrate (the music channel + menu-music slot + optional per-Scene track) with silence as the recommended in-game default; the conditional trigger system (condition evaluation, cooldowns, priorities) is its own future story.
- **Sandbox replay mode** (the central tension above) — its own epic when we get there; 059 only preserves the insertion points.
- Per-Scene credits, next-episode teaser reels, Telltale-style choice stats.
- Episode thumbnails on the Episodes menu (needs a capture/asset story; cards are text-first in v1).
- Auto-advance countdown duration as an authored setting (hardcode ~10s in v1).
