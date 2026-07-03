# Plan 058 — Parts content model + progress persistence

Status: placeholder / not yet designed
Owner: nikki + claude
Date: 2026-07-01, rescoped 2026-07-02

Related: Plan 055 (SaveParticipant model — the persistence mechanism this plan will plug into). Downstream users: quest authoring, dialogue authoring, world/region authoring, content release / gating.

## Framing (2026-07-02 rescope)

The game is structured into **Parts** — chunks of authored narrative content that unlock and release sequentially over calendar time or by player progress. Authors label parts per-project according to their game's tone (`"Chapter"` / `"Episode"` / `"Act"` / `"Book"` / whatever fits); the engine only knows they're Parts.

**Regions are sets within a project.** A given region (Town Square, Cave, Player House) may appear in Part 1, Part 3, and Part 5, with different casts, quests, and ambient dialogue layered on top each time. Regions live in the project's shared library; parts compose onto them.

**No "Season" concept in the engine.** An earlier draft included Seasons as the level above Parts, but a "next season" (e.g. moving from Wordlark Hollow to Rackwick City) is a genuinely new project with its own regions, mechanics, and world — separate Studio project. Player identity carries via SugarProfile (already handles it); any cross-project meta-progression would be a plugin, not engine core. The engine stays lean: Parts are the single narrative-partition primitive.

Author-side label mapping is a per-project setting (e.g. `partsUiLabel: "Chapter"`) that renders "Chapter 3" / "Episode 3" / "Act 3" in the game's UI without changing the engine's `Part` primitive.

## Goal

After this epic:

- Content authors create Parts and slot content into them in a well-defined way, without cloning shared regions or standing-cast characters.
- Runtime knows which Part(s) are currently unlocked for the player and gates loading/visibility accordingly.
- Player progression (which part they're on, which they've completed) persists across sessions via a `SaveParticipant` (per Plan 055).
- Additive-only content contract: shipping Part N doesn't break saves from mid-Part (N-1).

## Central design tensions

### 1. Composition, not scoping

Regions/dialogues/NPCs need to be *composed* onto by a Part, not owned by one. If Region X appears in Part 1, 3, and 5, each Part adds/replaces the cast, active quests, and ambient dialogue *in that region* without cloning the region. Additive-layer model rather than nested namespaces.

Concrete: a Part is likely a bundle of *presence definitions*, *quest definitions*, *dialogue definitions* that reference existing library entries (regions, NPC definitions) by id. The runtime composes them onto the shared world when the Part is active.

### 2. Unlock / release mechanics

Two viable models, cascading tradeoffs:

- **Bake-everything, gate at runtime.** All Part content ships in the deployed bundle; the game refuses to surface content whose Part isn't yet unlocked for the player. Simpler distribution, requires runtime gating logic everywhere content is loaded. Risk: leakage (savvy players can peek at unreleased content by editing local state).
- **Load-per-part.** Only the Parts currently unlocked are loaded / fetched. Cleaner separation but complicates content addressing, save-load-time, and rollback.

Pick one before authoring tools start expanding.

### 3. Save safety across content deploys

If Part 3 ships while a player is mid-Part 2, their save must not break. Implies an **additive-only content contract**: existing content definition IDs cannot be renamed or deleted, only added to. Renames become deprecations with content-layer aliases. This is a rule for both engine internals and content-authoring UX (Studio should refuse destructive edits on shipped content).

### 4. Cross-Part presence state (link to Plan 055)

Plan 055's `world.presence` slice is currently Part-agnostic (`Record<regionId, string[]>`). If a future Part needs to un-collect a presence in a shared region to re-story it, this needs a Part dimension. See Plan 055 open-question. Decision goes here, back-migrates 055.

### 5. What persists in the save

At minimum, a new `campaign.progression` SaveParticipant carrying:

- `currentPartId`
- `completedPartIds`
- Possibly per-Part chapter markers, if quests-within-a-Part need finer-grained "you've read past this beat" tracking beyond what `quest.manager` already gives us

Everything else stays where it is per 055's participant model.

## Not yet decided

- How do Parts end / transition? (Cutscene? Auto-advance on quest completion? Player-triggered "next part" call?)
- Authoring-side: does Studio get a first-class Parts workspace, or do Parts appear as a facet on existing workspaces (quest / dialogue / world)?
- Content-library separation: is there a hard boundary between "library asset" (region, standing NPC def) and "Part content" (presences, quests, ambient dialogue), or is everything in one project with Part metadata tagging what belongs where?
- Does unlock respect a wall-clock schedule (Part 2 unlocks 2026-09-15) or a player-controlled marker (Part 2 unlocks when you finish Part 1's finale)? Both?
- Where does the per-project label ("Chapter" / "Episode" / etc.) live? Probably a `partsUiLabel: string` field on the project definition, but Studio needs a small UI for setting it.

## Prerequisites

- Plan 055 shipped and stable. ✅ Done.
- Plan 056 shipped and stable (caster.stats + npc.behavior participants). ✅ Done (pending merge).
- At least one authored Part as a test bed. Ideally wordlark's current sandbox doubles as "Part 1" so the model has a concrete first customer.

## Defers

- Cross-project meta-progression (a "Wordlark Hollow completed unlocks something in Rackwick City" concept). Not engine core; plugin territory if it ever ships.
- Per-Part achievements / metrics rollup (adjacent to Plan 020 telemetry).
- Content-side i18n / localization scoping by Part.
- Multi-Part scheduling / calendar UI (Studio surface for authoring "Part 2 unlocks 2026-09-15").
