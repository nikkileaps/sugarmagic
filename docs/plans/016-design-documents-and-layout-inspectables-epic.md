# Plan 016: Design Documents and Layout Inspectables Epic

**Status:** Proposed  
**Date:** 2026-04-03

## Epic

### Title

Create the first real shared document-definition and inspectable scene-behavior slice in Sugarmagic by preserving Sugarengine's useful inspection behavior while deliberately avoiding a duplicate content model now that Sugarmagic already has rich readable item templates.

### Goal

Deliver a truthful inspectable system in Sugarmagic by:

- introducing a real shared project-owned `DocumentDefinition` authored system
- preserving the useful Sugarengine inspection loop:
  - world object in the region
  - `Press E` interaction prompt
  - shipped runtime inspection reader overlay
- avoiding a second parallel content model for books, newspapers, letters, postcards, flyers, signs, and plaques
- making both `ItemDefinition` and inspectable scene behavior able to reference the same authored document truth
- keeping inspectable placement in `Build > Layout`, not in the document workspace
- keeping runtime implementation ECS-native so inspectables are world interaction behavior, not target-host glue
- shipping the runtime inspection reader UI from `runtime-core`, not editor UI

This epic should make inspectables feel like a natural extension of the world instead of a one-off subsystem while keeping content, placement, and gameplay responsibilities clean.

## Recommendation

### Core recommendation

Do **not** port Sugarengine's inspection content model as a completely separate authored system.

Instead:

- create one canonical `DocumentDefinition` model
- let `ItemDefinition` optionally reference a document definition when its interaction view is `readable`
- let placed scene things in `Layout` gain an optional `Inspectable` behavior that references that same document definition
- keep one family of shipped runtime readers in `runtime-core`

This gives Sugarmagic one source of truth for authored world-reading content.

### Workspace recommendation

Recommended first shape:

- `Design > Documents`
  - left panel for document CRUD and search
  - center preview surface or editor canvas
  - right panel for selected document properties

Not:

- `Design > Inspectables`

Because what the author is really creating is document/lore/signage content, not the region placement record.

### Placement recommendation

Inspectable authoring should stay in `Build > Layout`.

Recommended flow:

- place or select the actual scene thing in `Layout`
  - for example:
    - a sign asset
    - a plaque mesh
    - a poster object
- in the selected scene thing's inspector, click:
  - `Make Inspectable`
- an `Inspectable` section appears on that selected scene thing
- set:
  - `Document`
  - `Prompt Text`
- the selected scene thing is now the inspectable world object

This means the system always knows both:

- which thing in the world is inspectable
  - the selected scene thing
- which document it shows
  - the `Document` field in that thing's inspector

This keeps the split clean:

- `Design > Documents`
  - what the readable/examinable content is
- `Build > Layout`
  - which scene things are inspectable and what document they show
- `runtime-core`
  - how inspection interaction and runtime reading work

### Runtime recommendation

Runtime inspectable behavior should be split into clear shared runtime concerns:

- `DocumentDefinition`
  - project-owned authored content truth
- scene-owned `Inspectable` behavior / component assignment
  - region-authored link between a placed scene thing and a document definition
- `Inspectable` ECS component
  - world interaction truth
- shared runtime interaction system
  - determines when the player can inspect a nearby object
- shipped runtime inspection reader UI
  - document overlay for world inspection

### ECS boundary clarification

The runtime implementation should stay ECS-native.

ECS should own:

- inspectable behavior on scene things
- nearby interaction resolution
- prompt availability
- inspection open/close state transitions
- optional future read-state events

ECS should **not** own per-template content rendering differences.

Document format rendering should remain a data-driven shipped UI concern in `runtime-core`, not five different gameplay systems.

### Host boundary rule

The same target rule still applies:

- if the logic is needed on every target to play the game, it belongs in `runtime-core`
- if it only mounts shared runtime behavior into a specific target, it belongs in the target host

That means:

- inspectable interaction rules
- runtime reader UI behavior
- prompt visibility rules
- inspection open/close gameplay locking

all belong in `runtime-core`

## Why this epic exists

Sugarengine had a useful inspectable gameplay concept:

- world-anchored non-collectable readable object
- same `E` interaction family as NPCs
- shipped runtime inspection overlay
- support for simple signs and richer newspapers/documents

That part is worth preserving.

What is **not** worth preserving literally is the duplicated content architecture:

- separate inspection content definitions
- separate runtime inspection content shape
- separate document rendering path from items

Now that Sugarmagic already has richer readable item templates, recreating a second parallel authored content system would give us:

- duplicate schemas
- duplicate runtime readers
- duplicate authoring UX
- duplicate plugin seams later for Sugarlang

This epic exists to preserve the useful gameplay behavior while collapsing the content truth into one shared document system.

## Legacy concepts to preserve

Relevant references:

- [Sugarengine `InspectionPanel.tsx`](/Users/nikki/projects/sugarengine/src/editor/panels/inspection/InspectionPanel.tsx)
- [Sugarengine `InspectionUI.ts`](/Users/nikki/projects/sugarengine/src/engine/ui/InspectionUI.ts)
- [Sugarengine `Inspectable.ts`](/Users/nikki/projects/sugarengine/src/engine/components/Inspectable.ts)
- [Sugarengine `InspectionManager.ts`](/Users/nikki/projects/sugarengine/src/engine/inspection/InspectionManager.ts)
- [Sugarengine `InteractionSystem.ts`](/Users/nikki/projects/sugarengine/src/engine/systems/InteractionSystem.ts)
- [Sugarengine `SpawnInspector.tsx`](/Users/nikki/projects/sugarengine/src/editor/panels/region/SpawnInspector.tsx)
- [Sugarengine `RegionDetail.tsx`](/Users/nikki/projects/sugarengine/src/editor/panels/region/RegionDetail.tsx)

Concepts to preserve:

- inspectables are non-collectable world interaction targets
- inspectables use the same interaction/prompt family as other nearby interactables
- inspectables are world-attached interactions
- prompt text is customizable
- runtime reader UI is shipped game UI, not editor UI
- simple and rich document formats both exist

Concepts to deliberately improve:

- all canonical ids become UUIDs
- document content becomes a shared authored truth used by both items and inspectables
- inspectable assignment moves into Sugarmagic's Layout scene inspector flow
- gameplay rules stay in `runtime-core`
- no duplicate document renderer family separate from item readable templates

## Proposed domain model

### Document definition

Introduce a canonical project-owned `DocumentDefinition`:

- `definitionId: UUID`
- `displayName`
- `subtitle?`
- `documentTemplate`
  - `book`
  - `newspaper`
  - `letter`
  - `postcard`
  - `flyer`
  - `sign`
  - `plaque`
- document body fields
  - shared structured content model appropriate to the template
- optional presentation metadata
  - author
  - location line
  - date line
  - footer
  - hero/header image asset id later if needed
- optional preview model asset definition id later if needed

### Item linkage

Allow `ItemDefinition` readable content to reference a document definition instead of duplicating the full text payload inline.

Recommended direction:

- keep `readable` as the gameplay concept
- gradually move rich readable items toward:
  - `documentDefinitionId: UUID | null`

### Inspectable scene behavior

Introduce an inspectable behavior that can be attached to a placed scene thing:

- `behaviorId: UUID`
- `documentDefinitionId: UUID`
- `promptText?`

The scene thing already owns the world transform.

So the inspectable association is explicit and concrete:

- the selected scene thing is the inspectable object
- the attached inspectable behavior chooses which document opens

This is a better fit for plaques, signs, posters, and wall-mounted world details than creating a second floating scene presence.

## Sugarmagic workspace recommendation

### `Design > Documents`

Recommended right-panel sections:

- `Identity`
  - display name
  - subtitle
- `Template`
  - document template selection
- `Content`
  - template-specific fields
- `Presentation`
  - optional metadata and future visuals

### Center surface

The document workspace should use a center preview/editing surface.

Recommended first behavior:

- enough room to preview the selected document layout
- right panel still owns the canonical fields
- future richer editing UX can live here without changing the domain boundary

### `Build > Layout`

Layout should gain:

- a scene-thing inspector action:
  - `Make Inspectable`
- an `Inspectable` inspector section on selected scene things
- searchable `Document` picker inside that section
- `Prompt Text` editing inside that section

Recommended first UX:

1. place/select a scene thing
2. click `Make Inspectable`
3. choose a document from the `Document` picker
4. optionally change `Prompt Text`

This keeps inspectables aligned with the actual world thing the player sees instead of introducing a second disconnected object.

## Runtime UI recommendation

The shipped runtime inspection UI should live in `runtime-core`.

Recommended first runtime UI surfaces:

- `Inspection Reader UI`
  - uses the same document template family as runtime item readers
  - world-inspection presentation, not inventory presentation
- shared interaction prompt usage
  - `Press E to inspect`

These are game UI, not editor UI.

## Story breakdown

### Story 1: Canonical document definitions

Create project-owned canonical document definitions in the domain model with UUID identity and command/session support.

### Story 2: `Design > Documents` workspace shell

Create the workspace with:

- left-panel list and CRUD
- center preview/editing surface
- right-panel document properties

### Story 3: Shared document template model

Generalize the readable document templates so one canonical document schema can support:

- `book`
- `newspaper`
- `letter`
- `postcard`
- `flyer`
- `sign`
- `plaque`

### Story 4: Item-to-document integration seam

Extend item readable authoring/runtime so items can reference shared document definitions instead of duplicating long-form content inline.

### Story 5: Inspectable behavior assignment in `Build > Layout`

Extend the Layout scene inspector so selected scene things can be marked inspectable, bound to a shared document definition, and given prompt text.

### Story 6: ECS inspectable interaction loop

Implement shared runtime inspectable components/systems so nearby inspectables can surface prompts and open document inspection cleanly.

### Story 7: Shipped runtime inspection reader UI

Port the runtime inspection overlay as shipped game UI in `runtime-core`, using the shared document templates instead of a duplicate renderer path.

### Story 8: Runtime interaction arbitration

Integrate inspectables with the existing shared runtime interaction system so NPCs, items, and inspectables behave coherently when near each other.

### Story 9: Plugin seam preservation

Keep the document/inspection system ready for future Sugarlang and SugarAgent enrichment without letting plugin-owned semantics distort the first core slice.

## Done definition

This epic is done when:

- `Design > Documents` exists and supports real document CRUD
- document ids are UUIDs
- items can reference shared document definitions for readable content
- scene things can be marked inspectable in `Build > Layout`
- placed inspectables can be inspected in Preview
- runtime inspection UI is visible and usable in Preview
- inspectable prompts use the shared interaction runtime path
- document template rendering is shared across items and inspectables
- target hosts are not hiding core inspection rules outside `runtime-core`

## Risks

- recreating Sugarengine's inspection content system as a duplicate source of truth
- smuggling inspectable gameplay rules back into the target host
- under-designing shared document content and boxing ourselves into item-specific assumptions
- over-coupling inspectables to inventory/item semantics when they are a distinct world behavior
- failing to keep one shipped reader family for both items and inspectables

## Recommended implementation order

1. canonical `DocumentDefinition` domain model
2. `Design > Documents` workspace shell
3. shared document template model for items + inspectables
4. `Layout` inspectable behavior assignment
5. ECS inspectable interaction loop
6. shipped runtime inspection reader UI
7. item-to-document integration seam
8. interaction arbitration cleanup
