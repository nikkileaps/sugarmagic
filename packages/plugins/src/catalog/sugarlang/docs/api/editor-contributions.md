# Editor Contributions API

Status: Updated in Epic 11, to be expanded further in Epic 12

This document tracks the Studio-facing UI primitives and contribution surfaces
owned by sugarlang.

## Placement Questionnaire Panel

Epic 11 adds a reusable shell-side form primitive at:

`packages/plugins/src/catalog/sugarlang/ui/shell/placement-questionnaire-panel.tsx`

It renders the plugin-owned `PlacementQuestionnaire` contract as a diegetic
all-at-once form and enforces the same minimum-answer submission rule as the
runtime host questionnaire path.

This component is the reusable UI primitive. Wiring it into concrete Studio
workspaces and other shell contribution slots remains Epic 12 work.

## Future Epic 12 Scope

Epic 12 will expand this document with the concrete design-section and
design-workspace contributions for:

- NPC inspector role controls
- Placement bank viewing
- Compile diagnostics
- Quest authoring hints
- Manual rebuild affordances
