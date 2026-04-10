# Editor Contributions API

Status: Updated in Epic 12

This document tracks the Studio-facing contribution surfaces owned by
Sugarlang. These are editor affordances only. They sit on top of the runtime
compiler, placement loader, and quest contract without becoming a second source
of truth.

## Shared Primitive

`ui/shell/placement-questionnaire-panel.tsx` remains the reusable questionnaire
primitive introduced in Epic 11. Epic 12 does not repurpose it into project
authoring; it stays the shell-side form renderer for the runtime questionnaire
flow.

## Contribution Registration

The canonical registration point is:

`packages/plugins/src/catalog/sugarlang/ui/shell/contributions.ts`

Sugarlang contributes:

- One `design.workspace`: `sugarlang`
- Five `design.section` surfaces:
  - NPC inspector role dropdown
  - Scene density histogram
  - Quest placement event hint
  - Compile status + rebuild panel
  - Placement question bank viewer

The Studio host mounts these sections generically through the plugin shell
contribution contract in `packages/plugins/src/shell/index.ts`.

## NPC Inspector Role Dropdown

File:

`packages/plugins/src/catalog/sugarlang/ui/shell/npc-inspector-role-dropdown.tsx`

Workspace:

- `npcs`

Behavior:

- Only renders for `interactionMode === "agent"`
- Writes `NPCDefinition.metadata.sugarlangRole = "placement"`
- Clears the key when the role returns to `None`

## Scene Density Histogram

File:

`packages/plugins/src/catalog/sugarlang/ui/shell/scene-density-histogram.tsx`

Workspace:

- `layout`

Behavior:

- Compiles the active region under `authoring-preview`
- Shows per-band lemma counts for `A1` through `C2`
- Surfaces authoring diagnostics emitted by the compiler

## Compile Status And Rebuild

File:

`packages/plugins/src/catalog/sugarlang/ui/shell/manual-rebuild-button.tsx`

Workspace:

- `sugarlang`

Behavior:

- Reads authoring-preview cache status from the IndexedDB compile cache
- Shows cached / stale / missing scene counts
- Invalidates the cache and rebuilds every scene through the shared authoring scheduler
- Reports rebuild progress and last rebuild timestamp

## Placement Question Bank Viewer

File:

`packages/plugins/src/catalog/sugarlang/ui/shell/placement-question-bank-viewer.tsx`

Workspace:

- `sugarlang`

Behavior:

- Loads the canonical plugin-shipped `placement-questionnaire.json`
- Groups questions by CEFR band
- Stays read-only in v1

## Quest Placement Event Hint

File:

`packages/plugins/src/catalog/sugarlang/ui/shell/quest-node-event-hint.tsx`

Workspace:

- `quests`

Behavior:

- Detects when the selected quest node targets an NPC tagged with
  `metadata.sugarlangRole === "placement"`
- Suggests `sugarlang.placement.completed`
- Writes that event name into the selected quest node when accepted
