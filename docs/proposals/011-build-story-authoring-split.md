# 011: Build and Story - splitting set building from set dressing

Status: Proposal (no decisions made, nothing built)
Date: 2026-08-24

This proposal comes out of a design conversation during Epic 207 (quest lifecycle
and NPC mode switching). Story 1 landed `Episode` in the domain; story 2 is meant
to give Studio a way to author a second one. Working out where that authoring
surface belongs surfaced a larger question about how Studio's product modes are
scoped, and this document captures the answer we arrived at so it is not lost.

Nothing here is scheduled. Epic 207 does not depend on it. Every claim about
current behavior was checked against the code.

## 1. The problem

Studio has four product modes. Two of them matter here:

- **Build** edits a region: landscape, navmesh, volumes, markers, placed assets.
  Its context selector is a region dropdown (`BuildProductModeView.tsx:512-527`),
  shared by the layout, landscape, spatial, behavior and audio workspaces.
- **Design** edits project-scoped definitions: player, NPCs, world flags, items,
  spells, documents, dialogues, quests, game UI, mechanics. All ten are flat lists
  on `GameProject`. Design renders the same sub-nav component as Build
  (`design/index.tsx:355`) but passes no context selector, because it has no
  context to select.

That split is already correct, and it already matches a rule the domain states
outright in `docs/api/domain-model.md`: *a definition owns what a thing IS; it
never owns where the thing is placed.* Build is the placement half. Design is the
definition half.

**The narrative structure fits neither.** An Episode is not a place and not a
definition. Its Scenes carry per-region overlays -- placements -- but the reason
those placements exist is the story, not the set.

Today the active Scene lives in a top-bar dropdown, ambient across the whole app
(`AuthoringSession.activeSceneId`, documented as the Ambient Context pattern).
Build composes it onto whatever region is selected; Design ignores it entirely.
So the app has a global selector that scopes exactly one product mode, and the
mode it scopes already has a different selector of its own.

## 2. The observation that unlocked it

Nothing in either product mode is Episode-scoped. Build is region-scoped, Design
is project-scoped. A global Episode selector would therefore scope nothing, which
is why it kept feeling wrong to place it.

Meanwhile there is a real seam already in the code, and it is currently handled
by a control rather than by structure. `PlacementScope = "base" | { sceneId }`
(`commands/index.ts:77`) is a create-time choice, surfaced as a Scope dropdown
and a `ScopeBadge` in Build. Every placement action has to ask the author which
layer they meant.

## 3. The proposal

**Build owns the base. Story owns the overlay.**

A new product mode, `Story`, sits alongside Design and Build. It holds the
narrative: Episodes, Scenes, quests, dialogue, and the dressing of a Scene into a
region.

The scope question then answers itself:

- In **Build**, everything you place is base. The permanent set -- what a player
  sees in a region with no Scene active, which is exactly what free roam is
  (Epic 207 story 12: "free roam is not a Scene. It is a region with no Scene
  overlay applied").
- In **Story**, everything you place is the selected Scene's overlay.

Neither mode needs a scope control, because the mode has already said which layer
you are writing to. The Scope dropdown and `ScopeBadge` retire. Moving an existing
placement between layers stays a deliberate operation
(`convertAssetScopeInSession`), not an ambient setting.

### Workspaces

`Story` would hold:

- **Structure** -- Episodes, their gates and chapter cards, their ordered Scenes,
  and `episodeEndRouting`.
- **Quests** -- moved from Design.
- **Dialogue** -- moved from Design.
- **Staging** -- a viewport for dressing the selected Scene into a region.

Quests and dialogue move because of a containment chain the code already
enforces: nothing in the domain references a dialogue definition except a quest
node (`QuestNodeDefinition.dialogueDefinitionId`; `NPCDefinition` and
`RegionNPCPresence` have no dialogue field at all). So dialogue belongs to the
quest that uses it, and if a quest belongs to a Scene, both are narrative rather
than definitional.

Whether a quest is genuinely contained by one Scene is an open question -- see
Open decisions.

### The Staging viewport, and the rule that makes it work

Left panel is a tree of Episodes and Scenes; expanding a Scene shows what it
places. Two selectors at the top, both narrative: which Scene, and which of its
regions is being dressed.

```
Story                                    [ Arrival  v ]  [ arrival-station  v ]

  SCENE EXPLORER              |                          |  INSPECTOR
  v Wordlark Hollow           |                          |
      v Arrival               |       [ viewport ]       |  Finnick
          Horace              |                          |  NPC presence
          Finnick             |                          |  position / rotation
          brass key           |                          |  condition
      > Finding that Guy      |                          |
  ---------------             |
  BASE (from Build)           |
      Landscape          (x)  |
      dock-platform-small (x) |
```

**The load-bearing rule: in Story the base renders but is not editable.** An
author dressing a Scene needs the dock and the landscape visible or they are
placing NPCs into a void -- but if the dock can be dragged from here, the split is
a lie and the scope toggle is back by another name. Base rows render greyed and
unselectable; clicking one offers "Edit in Build" rather than selecting it.

The mirror holds in Build: base is editable, Scene overlays hidden or ghosted.

**Staging composes the shared viewport primitives; it does not relocate Build's
viewport.** Same picking, same gizmo, same render view, different data source and
a locked base layer. Two independent viewport implementations would drift.

### Renaming

`SceneExplorer` (`packages/ui/src/components/SceneExplorer.tsx`) should become
`RegionExplorer` regardless of whether this proposal proceeds. It shows a region's
contents, sits directly beneath a dropdown that says "Default Region", and is
labelled SCENE EXPLORER -- while `Scene` is a domain term meaning something else
entirely. The panel and the control above it currently disagree about what the
author is looking at.

## 4. What this does not solve

- **A Scene dressing more than one region.** Epic 207 story 5 collapses
  `regionOverlays: Record<regionId, overlay>` to a single region. The live project
  already violates that: `Arrival` overlays both `default` and `arrival-station`.
  A quest that sends the player from a village shop to a harbor wants the Scene to
  dress both. Story 5's actual complaint is narrower -- `startingRegionId` and the
  overlay map are two answers to "which region does this Scene happen in" -- and is
  satisfiable by a constraint (the starting region must be one of the overlay
  keys) rather than a collapse. That is an amendment to an unbuilt story, not a
  consequence of this proposal.
- **A quest separated by story time.** Talk to an NPC now, pay off two chapters
  later. Distance is solvable by a Scene dressing several regions plus story 11's
  doors; elapsed story time is not. Such a quest either spans Scenes or is written
  as two quests chained by a `questCompleted` condition, which already works.

## 5. Open decisions

1. **Can a quest span Scenes?** If no, quests nest inside a Scene and single
   ownership is true by construction. If yes, quests stay project-scoped and carry
   the Scene they belong to; the authoring surface looks identical either way, and
   the difference only shows the first time a quest refuses to sit in one Scene.
   Epic 207 story 6 has to answer this regardless of this proposal.
2. **Does Story get its own viewport, or does Build gain a Scene-overlay mode?**
   This proposal assumes the former. The latter is cheaper and keeps one viewport,
   at the cost of Build carrying two scopes again.
3. **Where do landscape and spatial live?** Both are pure region base -- a Scene
   never overlays terrain or a navmesh. They stay in Build under this proposal,
   which is consistent, but it means Build keeps a region selector while Story has
   a Scene selector, and an author moving between them switches context.

## 6. Relationship to Epic 207

None of Epic 207's twelve stories depend on this. The epic is about the narrative
domain -- Episodes, gates, presences, quest lifecycle, region transitions -- and
its Studio surfaces are small.

Story 2 ("Studio authors Episodes") is the one place they touch. The
recommendation is to build story 2 in the existing Manage Scenes modal, keep it
deliberately minimal, and let real use across stories 3 through 12 inform this
proposal rather than settling Studio's information architecture before anyone has
authored a second Episode.
