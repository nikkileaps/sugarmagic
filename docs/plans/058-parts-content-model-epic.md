# Plan 058 — Parts content model + progress persistence

Status: placeholder / not yet designed
Owner: nikki + claude
Date: 2026-07-01, rescoped 2026-07-02 (framing pass 2)

Related: Plan 055 (SaveParticipant model — the persistence mechanism this plan will plug into). Downstream users: quest authoring, dialogue authoring, world/region authoring, content release / gating.

## Framing (2026-07-02 pass 2)

The game is structured into **Parts** — chunks of authored narrative content that unlock and release sequentially over calendar time or by player progress. Authors label parts per-project according to their game's tone (`"Chapter"` / `"Episode"` / `"Act"` / `"Book"` / whatever fits); the engine only knows they're Parts.

### Part is an editor context, not a content bundle

The mental model matches **Unity Scenes** or **UE5 Data Layers**: switching Parts changes what the editor shows you. You don't see all Parts at once with a filter chip — you pick a Part in Studio's top bar and every workspace scopes to that Part's content. Quests workspace shows Part 3 quests. Dialogues shows Part 3 dialogues. Region composition shows Part 3's cast overlaid on the shared regions. Feels like switching branches in Git, or opening a different Scene in Unity.

Underneath, the data model is dead simple: **each authored item carries an optional `partId` field**. Runtime and editor both filter by "does this item belong to a Part that's currently in scope?" The complexity we spent time worrying about (composition semantics, bundle boundaries, cross-Part references) mostly evaporates when Parts are just tags with editor context switching.

### Regions and standing cast live in the shared library

**Regions are shared across Parts within a project.** A region (Town Square, Cave, Player House) may appear in Part 1, Part 3, and Part 5. Regions have no `partId` — they live in the project's shared library, visible in every Part context. Same for **standing-cast NPC definitions**, **shared item definitions**, and **shared dialogue definitions**.

What DOES carry a `partId`:
- **Presences** (which NPCs / items are placed in a region for this Part)
- **Part-specific quests** (this Part's main quest, side quests)
- **Part-specific dialogues** (dialogues that only make sense in this Part's story context)
- **Region composition overrides** (Part 3 makes Town Square look wintry; Part 5 makes it flooded — same region, different Part-scoped presentation)

The engine composes: at boot, gather all items where `partId ∈ unlockedParts` (plus items with no `partId`, which are shared library). The runtime scene builder feeds those to the world. No "content bundles" primitive needed; presence lists are already what they are, just filtered.

### No "Season" concept in the engine

Earlier drafts included Seasons as the level above Parts, but a "next season" (e.g. Wordlark Hollow -> Rackwick City) is a genuinely new project with its own regions, mechanics, and world. Separate Studio project. Player identity carries via SugarProfile (already handles it); any cross-project meta-progression would be a plugin, not engine core. Parts are the single narrative-partition primitive.

Author-side label mapping is a per-project setting (e.g. `partsUiLabel: "Chapter"`) that renders "Chapter 3" / "Episode 3" / "Act 3" in the game's UI without changing the engine's `Part` primitive.

## Goal

After this epic:

- Studio's top bar has a Part selector next to the Project title + version chip (`[Wordlark Hollow] [v1] [Part 3: The Reckoning]`). Switching Parts scopes what every Design workspace shows.
- Every Part-scoped content type (quests, dialogues, presences, region composition) gains an optional `partId` field, edited via the natural authoring surface — usually implicit (you're in Part 3's context when you create it) rather than a manual dropdown.
- Runtime knows which Parts are currently unlocked for the player and filters content accordingly at scene build time.
- Player progression (which Part they're on, which they've completed) persists across sessions via a new `campaign.progression` SaveParticipant.
- Additive-only content contract: shipping Part N doesn't break saves from mid-Part (N-1).

## Central design tensions

### 1. Unlock / release mechanics

Two viable models:

- **Bake-everything, gate at runtime.** All Part content ships in the deployed bundle; the runtime scene builder filters by unlocked Parts. Simpler distribution and rollback, requires runtime gating to be watertight. Risk: leakage — savvy players can edit local state to peek at unreleased content, but that's a boundary the current engine already accepts (nothing prevents them from editing IndexedDB).
- **Load-per-Part.** Only the Parts currently unlocked are loaded/fetched. Cleaner separation but complicates content addressing and save-load-time. Overkill unless Part content becomes genuinely huge or spoiler-sensitive.

Recommendation: bake-everything for v1, revisit if we find a real need.

### 2. Save safety across content deploys

If Part 3 ships while a player is mid-Part 2, their save must not break. Implies an **additive-only content contract**: existing content definition IDs cannot be renamed or deleted, only added to. Renames become deprecations with content-layer aliases. This is a rule for both engine internals and content-authoring UX (Studio should refuse destructive edits on shipped content).

### 3. Cross-Part presence state (link to Plan 055)

Plan 055's `world.presence` slice is currently Part-agnostic (`Record<regionId, string[]>`). If a future Part needs to un-collect a presence in a shared region to re-story it, this needs a Part dimension. Bump the slice to `Record<regionId, Record<partId, string[]>>` and migrate when the pattern comes up. Not blocking for v1 (single Part).

### 4. What persists in the save

A new `campaign.progression` SaveParticipant carrying:

- `currentPartId` — which Part the player is actively in
- `unlockedPartIds: string[]` — which Parts they've unlocked (may or may not include the current one; a player can be "in" Part 3 with Parts 1-3 unlocked)
- `completedPartIds: string[]` — subset of unlocked that have been marked complete (some content unlocks on completion, not just visit)

Everything else stays where it is per 055's participant model.

## Not yet decided

- **How does a Part end / transition?** Cutscene? Auto-advance on a specific quest completion? Player-triggered "next Part" call? Author-side hook so games can implement transitions differently.
- **Authoring UI for the Part selector.** Nested inside the project button as a two-level dropdown, or sibling in the top bar? (Sketch from earlier discussion: `Sugarmagic | Wordlark Hollow | v1 | Part 3: The Reckoning | Design ...`)
- **Cross-Part authoring views.** Sometimes you want to see "all quests across all Parts" (rename lint, dependency check, overview). The Part selector could have a special "All Parts" mode, or those cross-Part views live in a dedicated Lint / Overview workspace. Unresolved.
- **Where does `partsUiLabel` live?** Project-level setting? Per-Part override? Both?
- **Unlock schedule authoring.** Wall-clock schedule (Part 2 unlocks 2026-09-15) vs. player-progress marker (Part 2 unlocks when Part 1's finale quest completes) vs. both? Studio needs a small UI for whichever we pick.
- **Region composition override authoring.** How do authors say "Town Square in Part 5 has these presences" vs. "Town Square in Part 3 has these"? Same region document, different scoped presence lists? Or scoped presence lists live in Part-owned files that reference the shared region?

## Prerequisites

- Plan 055 shipped and stable. ✅ Done.
- Plan 056 shipped and stable (caster.stats + npc.behavior participants). ✅ Done (pending merge).
- At least one authored Part as a test bed. Ideally wordlark's current sandbox doubles as "Part 1" so the model has a concrete first customer.

## Defers

- Cross-project meta-progression (a "Wordlark Hollow completed unlocks something in Rackwick City" concept). Not engine core; plugin territory if it ever ships.
- Per-Part achievements / metrics rollup (adjacent to Plan 020 telemetry).
- Content-side i18n / localization scoping by Part.
- Multi-Part scheduling / calendar UI (Studio surface for authoring "Part 2 unlocks 2026-09-15") — comes with the unlock-schedule tension resolution.
- Load-per-Part distribution model (see tension #1). Bake-everything for v1.
