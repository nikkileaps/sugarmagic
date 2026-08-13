# Sugarmagic Developer API

This directory describes the intended developer-facing API surface of Sugarmagic if the current proposal and ADR set are implemented successfully.

These documents are for engineers working on:

- Sugarmagic itself
- published web game targets
- plugin integrations
- game-root content and build tooling

They describe:

- the expected tech stack
- the intended system and package boundaries
- the domain-facing API concepts
- runtime, authoring, and publish lifecycle APIs

These are not TypeScript reference docs.

They are architecture-facing developer API documents that explain how the system should be used and extended.

## Documents

- [Overview](/Users/nikki/projects/sugarmagic/docs/api/overview.md)
- [System and Package API](/Users/nikki/projects/sugarmagic/docs/api/system-and-package-api.md)
- [Domain, Runtime, and Lifecycle API](/Users/nikki/projects/sugarmagic/docs/api/domain-runtime-and-lifecycle-api.md)
- [SugarDeploy Game Deployment](/Users/nikki/projects/sugarmagic/docs/api/sugardeploy-game-deployment.md) — onboarding a new game (Provision / Release / Deploy lifecycle, developer + player auth models, where the moving pieces live)
- [Character Wizard](/Users/nikki/projects/sugarmagic/docs/api/character-wizard.md) — static GLB to rigged, animated character in Studio (wizard steps, weight painting, edit-in-place, integration seams)
- [Animation Generation](/Users/nikki/projects/sugarmagic/docs/api/animation-generation.md) — procedural idle/walk/run with personality sliders, pose adjust, and curve editing (the animation panel)
- [Collision & Navigation](/Users/nikki/projects/sugarmagic/docs/api/collision-and-navigation.md) — runtime collision (single `resolveMove` enforcer), drawn Volumes + roles, object colliders, and navmesh bake/pathfinding (epic 069)
- [SugarAgent NPC Memory](/Users/nikki/projects/sugarmagic/docs/api/sugaragent-npc-memory.md) — two-tier memory model (IDB record + session digest), first-meeting semantics, plugin config, `__sugaragentMemory` dev handle (epic 073)
- [SugarAgent Quest-Aware NPCs](/Users/nikki/projects/sugarmagic/docs/api/sugaragent-npcs.md) — quest-context middleware, world-narrative blackboard facts, firewall contract (secrets vs nudges), no-director design, the lore relevance threshold, `canon_level` indexing depth (epic 077)
- [Quest System](/Users/nikki/projects/sugarmagic/docs/api/quest-system.md) — quest definitions, stages/nodes/actions, world flags, NPC behavior tasks, world clock, player known facts, recent events, dev handles (epics 074, 077)
- [Sugarlang Telemetry](/Users/nikki/projects/sugarmagic/docs/api/sugarlang-telemetry.md) -- event taxonomy + schema versioning, sink resolution (Studio IndexedDB vs published gateway), the `/api/sugarlang/telemetry` ingestion route, client-side PII scrub, proxy base URL env resolution (epic 081)
- [Per-Player Data](/Users/nikki/projects/sugarmagic/docs/api/per-player-data.md) -- storing something that belongs to a player rather than the game, and having it follow them to another device: local-first record stores, one table per plugin, how reconciling and conflicts work
- [Sugarlang Learner State](/Users/nikki/projects/sugarmagic/docs/api/sugarlang-learner-state.md) -- learner profile shape, what survives a reload and what follows the player to another device, CEFR posterior + post-placement calibration window, dev-only band override + `__sugarlangDebug` handle (epic 081)
- [Sugarlang Conversation Middlewares](/Users/nikki/projects/sugarmagic/docs/api/sugarlang-middlewares.md) -- the five middlewares (stages/priorities), the conversationKind turn-path guard, the `sugarlang.constraint` seam, and verify's actual enforcement scope (epic 081)
- [SugarAgent Lifecycle Contributions](/Users/nikki/projects/sugarmagic/docs/api/sugaragent-lifecycle-contributions.md) -- annotation-bus contribution contract (key format, merge semantics, per-surface consumers, cache hygiene, zero-contribution invariant) (epic 084)
- [Sugarlang Function Inventory](/Users/nikki/projects/sugarmagic/docs/api/sugarlang-competency-inventory.md) -- competencies + chunk sequences, FSRS chunk cards, interpretLexicon contributions, bake-time function tagging (epic 085)
- [Sugarlang Scripted Rendering](/Users/nikki/projects/sugarmagic/docs/api/sugarlang-scripted-rendering.md) -- rendering: baked variants per band (primary), authored English on a cache miss, intent format, four-gate bake verification, degradation order, Studio exception report (epic 086, revised epic 090)

## Relationship to Proposals and ADRs

These API docs summarize the intended implementation-facing surface implied by:

- [Sugarmagic proposals](/Users/nikki/projects/sugarmagic/README.md)
- [Sugarmagic ADRs](/Users/nikki/projects/sugarmagic/docs/adr/README.md)

If a proposal and an API doc disagree, the ADRs and later accepted architecture decisions take precedence.
