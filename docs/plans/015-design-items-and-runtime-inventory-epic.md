# Plan 015: Design Items and Runtime Inventory Epic

**Status:** Proposed  
**Date:** 2026-04-03

## Epic

### Title

Create the first real item-definition, pickup, and inventory slice in Sugarmagic by faithfully porting Sugarengine's item database, runtime inventory loop, and shipped item UI while keeping item placement in `Build > Layout`, all identities UUID-backed, and runtime behavior ECS-native.

### Goal

Deliver the first truthful item-authoring and item-runtime slice in Sugarmagic by:

- introducing a real `Design > Items` workspace
- preserving the useful Sugarengine item workflow:
  - left panel for item CRUD and search
  - center preview surface
  - right panel for selected item properties
- defining canonical project-owned item definitions with UUID identity
- keeping item placement out of `Design > Items` and in `Build > Layout`
- making region-scoped item presences work the same way `Player` and `NPC` presences now do in Sugarmagic
- porting the real runtime inventory loop into `runtime-core`:
  - collect item in world
  - add to inventory
  - show shipped runtime feedback
  - trigger quest collect progression
  - support `hasItem` checks in runtime conditions
- preserving Sugarengine's useful item interaction model:
  - readable items
  - examine items
  - consumable items
- shipping runtime inventory UI and item-view UI from `runtime-core`, not editor UI
- keeping runtime implementation ECS-native so pickups, interaction, and collection are enforced by shared runtime systems/components rather than target-specific glue

This epic should make items a first-class authored system in Sugarmagic without mixing definition authoring, scene placement, inventory state, and plugin-owned semantics into one blurred surface.

## Recommendation

### Workspace recommendation

`Items` should be a `Design` workspace.

Recommended first shape:

- `Design > Items`
  - left panel for item list and CRUD
  - center preview viewport
  - right panel for selected item properties

This should follow the useful structure Sugarengine ended up with, but align with Sugarmagic's stronger viewport + inspector conventions instead of overloading the center with form-heavy detail cards.

### Runtime recommendation

Runtime item behavior should be split into clear shared runtime concerns:

- `ItemDefinition`
  - project-owned authored truth
- `RegionItemPresence`
  - region-owned placement truth
- `InventoryManager`
  - runtime-owned inventory state
- `ItemPickup` / collectible ECS components
  - runtime world interaction truth
- shipped runtime item UI
  - inventory overlay
  - item-view overlay
  - pickup notification

### Placement recommendation

Item placement should stay in `Build > Layout`, not in the item workspace.

Recommended flow:

- `Layout` `Add` menu includes `Item`
- selecting `Item` opens a searchable picker of item definitions
- selecting one creates a region-owned item presence at origin
- dragging it in the viewport defines where it spawns
- `Scene Explorer` shows the item by display name, like other scene things
- inspector shows explicit spawn position values

This keeps the split clean:

- `Design > Items`
  - what the item is
- `Build > Layout`
  - where the item exists in the region
- `runtime-core`
  - how the item is collected, stored, viewed, and consumed during gameplay

### Boundary clarification

The following do **not** belong in the first `Design > Items` workspace:

- region placement
- pickup coordinates
- spawn rules
- inventory runtime state
- pickup collection logic
- target-specific input/UI glue
- SugarAgent or Sugarlang item-grounding extensions

In particular:

- `Item definition`
  - belongs in `Design > Items`
- `Item presence in a region`
  - belongs in `Build > Layout`
- `Inventory state`
  - belongs in `runtime-core`
- `Pickup collection behavior`
  - belongs in `runtime-core`
- `Inventory UI / item-view UI`
  - belong in shipped runtime UI inside `runtime-core`

## Why this epic exists

Items in Sugarengine worked well because they formed a full loop, not just a database:

- authors defined items
- regions spawned pickups
- gameplay let the player collect them
- runtime inventory tracked them
- item views let the player read/examine/use them
- quests could react to collection
- conditions could query inventory state

That full loop is worth preserving.

What should **not** be preserved is the old split and leakage around it:

- string ids used as canonical identity
- placement authoring separated into older region forms
- pickups treated as a special side path outside the more general interaction architecture
- editor/runtime distinctions blurred in places where shipped UI should have owned the behavior

This epic exists to preserve the strong gameplay loop while cleaning the seams.

## Legacy concepts to preserve

Relevant references:

- [Sugarengine `ItemPanel.tsx`](/Users/nikki/projects/sugarengine/src/editor/panels/item/ItemPanel.tsx)
- [Sugarengine `ItemDetail.tsx`](/Users/nikki/projects/sugarengine/src/editor/panels/item/ItemDetail.tsx)
- [Sugarengine `ItemInspector.tsx`](/Users/nikki/projects/sugarengine/src/editor/panels/item/ItemInspector.tsx)
- [Sugarengine `InventoryManager.ts`](/Users/nikki/projects/sugarengine/src/engine/inventory/InventoryManager.ts)
- [Sugarengine `types.ts`](/Users/nikki/projects/sugarengine/src/engine/inventory/types.ts)
- [Sugarengine `InventoryUI.ts`](/Users/nikki/projects/sugarengine/src/engine/ui/inventory/InventoryUI.ts)
- [Sugarengine `ItemViewUI.ts`](/Users/nikki/projects/sugarengine/src/engine/ui/inventory/ItemViewUI.ts)
- [Sugarengine `ItemPickup.ts`](/Users/nikki/projects/sugarengine/src/engine/components/ItemPickup.ts)
- [Sugarengine `Game.ts`](/Users/nikki/projects/sugarengine/src/engine/core/Game.ts)

Concepts to preserve:

- item CRUD and search
- categories:
  - `quest`
  - `gift`
  - `key`
  - `misc`
- stackable vs non-stackable rules
- max stack
- giftable filtering
- model-backed or fallback item representation
- item interaction view model:
  - `readable`
  - `examine`
  - `consumable`
- inventory add/remove events
- collect-objective integration
- inventory-backed condition checks

Concepts to deliberately improve:

- all canonical ids become UUIDs
- item placement moves into the new Layout scene-presence flow
- pickups participate in shared runtime ECS + interaction architecture
- shipped runtime UI and gameplay orchestration stay in `runtime-core`

## Proposed domain model

### Item definition

Introduce a canonical project-owned `ItemDefinition`:

- `definitionId: UUID`
- `displayName`
- `description`
- `category`
- `stackingPolicy`
  - stackable or not
  - max stack where applicable
- `giftable`
- `presentation`
  - optional model asset definition id
  - optional icon asset definition id
  - target model height or scale policy
  - optional fallback color
- `interactionView`
  - `none`
  - `readable`
  - `examine`
  - `consumable`

### Item view model

Preserve the useful authored interaction types:

- `readable`
  - content or structured readable data
  - later readable layout variants
- `examine`
  - simple inspect/examine presentation
- `consumable`
  - action label and runtime use behavior seam

### Region item presence

Introduce region-owned item presences:

- `presenceId: UUID`
- `itemDefinitionId: UUID`
- `displayName`
- `transform`
- `quantity`

This is the item equivalent of the player and NPC scene-presence path already in Sugarmagic.

### Runtime inventory state

Introduce a shared runtime inventory model owned by `runtime-core`:

- inventory slots
- quantity per item definition
- item-added and item-removed events
- giftable filtering
- `hasItem` / `getQuantity`

## Runtime architecture recommendation

### ECS recommendation

The runtime implementation should stay ECS-native.

Recommended shared runtime pieces:

- `ItemPickup` component
  - item definition id
  - quantity
  - collected state if needed
  - pickup radius / collision radius
- runtime interaction/pickup system
  - determines when a nearby item can be collected
  - surfaces prompt text
  - resolves `E` interaction into collection
- `InventoryManager`
  - owns runtime item possession state
- shared runtime gameplay coordinator
  - feeds pickup collection into:
    - inventory add
    - pickup notification
    - quest collect progression
    - item availability removal

### Host boundary rule

The same target rule still applies:

- if the logic is needed on every target to play the game, it belongs in `runtime-core`
- if it only mounts shared runtime behavior into a specific target, it belongs in the target host

That means:

- inventory UI behavior
- item-view behavior
- pickup logic
- collect-objective wiring
- inventory condition checks

all belong in `runtime-core`

## Sugarmagic workspace recommendation

### `Design > Items`

Recommended right-panel sections:

- `Identity`
  - display name
  - description
- `Category`
  - quest / gift / key / misc
- `Stacking`
  - stackable
  - max stack
- `Interaction`
  - none / readable / examine / consumable
- `Presentation`
  - model asset
  - icon asset
  - target height/scale
  - fallback color if useful

### Center viewport

The item workspace should use a preview viewport.

Recommended preview behavior:

- if model is bound:
  - show the model
- otherwise:
  - show a clean item fallback representation
- camera is orbit-style, consistent with other design previews
- interaction view settings should not run gameplay here, but the authored item representation should be visible

### `Build > Layout`

Layout should gain:

- `Add > Item`
- searchable item-definition picker
- item scene entries in `Scene Explorer`
- inspector spawn transform fields

This keeps item placement aligned with the same scene-authoring model already established for player and NPC placement.

## Runtime UI recommendation

The shipped runtime item UI should live in `runtime-core`.

Recommended first runtime UI surfaces:

- `Inventory UI`
  - toggleable overlay
  - item slot list/grid
  - tooltip metadata
- `Item View UI`
  - readable / examine / consumable presentation
- `Item Pickup Notification`
  - short feedback when items are collected

These are game UI, not editor UI.

## Story breakdown

### Story 1: Canonical item definitions

Create project-owned canonical item definitions in the domain model with UUID identity and command/session support.

### Story 2: `Design > Items` workspace shell

Create the workspace with:

- left-panel list and CRUD
- center preview viewport
- right-panel item properties

### Story 3: Item presentation preview

Preview bound item models or fallback item representations in the center viewport using shared runtime-core preview semantics.

### Story 4: Item interaction-view authoring

Port the first interaction view types:

- `readable`
- `examine`
- `consumable`

Readable layout variants may start simple and expand later.

### Story 5: Readable document templates and shipped readers

Extend the `readable` interaction view into a richer authored document system while keeping the architecture clean:

- readable document formats:
  - `book`
  - `newspaper`
  - `letter`
  - `postcard`
  - `flyer`
- authored readable content stays data-driven in item definitions
- shipped readers/renderers live in `runtime-core`
- ECS remains responsible for:
  - world item presence
  - pickup/use/read interaction state
  - inventory ownership
  - optional first-read or read-state events
- document format rendering does **not** become a new ECS mechanic per subtype

This story exists to support a richer authored world without muddying the ECS boundary. The runtime should treat these as one gameplay concept, `readable`, rendered through different shipped reader templates.

### Story 6: Region item placement in `Build > Layout`

Extend the Layout scene-presence flow so items can be added, shown in the scene tree, moved in the viewport, and edited numerically in the inspector.

### Story 7: Shared runtime inventory manager

Implement the central runtime inventory system in `runtime-core` with stacking, item queries, and event hooks.

### Story 8: ECS item pickup loop

Implement shared runtime pickup components/systems so item presences in the region can be collected through gameplay and removed from the world cleanly.

### Story 9: Shipped runtime inventory and item-view UI

Port the runtime inventory overlay, item-view overlay, and pickup notification as shipped game UI in `runtime-core`.

This story also owns the shipped runtime readers for the supported readable templates.

### Story 10: Quest and condition integration

Integrate inventory with the existing shared runtime quest/dialogue systems:

- collect objectives
- `hasItem` conditions
- future remove-item/give-item quest actions

### Story 11: Runtime state persistence seam

Define the runtime/session seam for persisting collected item presence state and inventory state so the first slice is not boxed into editor-only preview assumptions.

## Done definition

This epic is done when:

- `Design > Items` exists and supports real item CRUD
- item ids are UUIDs
- items can be placed in `Build > Layout`
- placed items can be collected in Preview
- collected items enter a shared runtime inventory
- runtime inventory UI is visible and usable in Preview
- item view UI works for the supported view types
- readable document templates work for the supported reader types
- collect objectives can complete from item collection
- inventory-backed conditions work in runtime dialogue/quest logic
- target hosts are not hiding core inventory/pickup rules outside `runtime-core`

## Risks

- mixing item definition concerns with item placement concerns again
- smuggling pickup or inventory gameplay logic back into the target host
- under-modeling readable items and painting ourselves into a corner
- turning readable formats into bespoke gameplay systems instead of one readable concept with template-driven rendering
- over-porting Sugarengine-specific UI complexity before the new runtime seams are stable
- failing to keep item collection, inventory state, and quest progression under one shared runtime enforcer

## Recommended implementation order

1. canonical `ItemDefinition` domain model
2. `Design > Items` workspace shell
3. item preview viewport
4. `Layout` item placement
5. shared runtime inventory manager
6. ECS pickup loop
7. shipped inventory UI and item-view UI
8. readable document templates and readers
9. quest/condition integration
