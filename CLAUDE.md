# Project Context

You are working on a project called Sugarmagic Studio. Sugarmagic strives to be an all in one game creation studio. Specifically narrative focused games. It is not meant to make multiplayer games or combat games.

Build one application where:

- the authored region is the runtime region
- the edit view and play view use the same runtime systems
- visual truth does not depend on export/import validation loops
- region authoring and runtime playback live in one coherent product

# General Guidelines
- Do not assume you know. Look it up. Read the code. Research it on the internet. Confirm it with Nikki.
- When in doubt read the domain terms and the domain model documents.
- You are a partner with a software engineer.
- The general workflow is: 1. Write the epic with Nikki. 2. Break the epic down into stories. 3. Run the epic review. 4. Do the first story: run the read-the-code SKILL first to survey what already exists, then implement. 5. BEFORE COMMIT tell Nikki a short summary of what you just implemented in PLAIN ENGLISH, DOMAIN TERMS. 6. Commit when Nikki tells you to. 7. Do all stories for epic in this manner 8. When stories are done run the review. 9. When review has succeeded and NIKKI SAYS SO open pull request in github. 10. Nikki will review PR and merge. The End.

# Writing Instructions

- When interacting with Nikki in the terminal: Use plain english with a task based approach. Keep writing concise and clear. Keep sentences short and understandable. Do not introduce new terms when a domain term, software engineering term, or a plain english term will suffice. Avoid idioms, slang, jargon, abbreviations, acronyms. Your audience are software engineers and architects. You are working in a software engineering domain. Do not assume that the reader knows the code inside and out, but they will be familiar with the domain.
- Grep the repo and docs before introducing a noun. Never overload term that already means something here, and never invent one when an existing word will do.

Use the technical-writing SKILL to help write good technical docs. 

# Architecture
Sugarmagic Studio is a browser-based authoring tool for creating 3D narrative games, built as a pnpm/TypeScript monorepo where Studio and the shipped game are two front ends over the same core packages — Studio in React, the game runtime in vanilla DOM with three.js/WebGPU underneath, and a pure domain layer both depend on.
- **Dependencies run one way.** Core declares an interface; a plugin supplies the implementation (`GameSaveStore`, `RemoteRecordStorageAdapter`). Core and the host never name a specific plugin — there are tests that read the source and fail if one appears.
- **Runtime degrades, build fails loud.** A player mid-session keeps playing: fall back, log, carry on. A bake, deploy or compile pass does the opposite — nikki is the user there and wants to know it broke.
- **Layered packages**: domain is pure data model and rules; runtime-core is the game — ECS-style world with systems, dialogue, inventory, quests, save, sync — and knows nothing about React; render-web is three.js on WebGPU with shaders authored as graphs and compiled to
  TSL; workspaces/ui/shell are the Studio front end; testing holds the cross-package suite.
- **Plugin catalog** A catalog of functionality outside of the basic runtime Plugins: sugarlang (language teaching — teacher, learner model, graded text, CEFR), sugaragent (NPC conversation pipeline), sugarprofile (accounts, saves, per-account sync), sugardeploy (publishing). Core declares interfaces; plugins supply implementations and contribute runtime middleware, Studio UI, and deployment steps.
- **Project** A "project" is files on disk — project.sgrmagic, content-library.sgrmagic, regions/*.json, assets/, masks, navmesh. Studio reads and writes them directly; there's no project server.

# State Management
- Runtime-core never depends on React or zustand. It exposes ObservableValue (snapshot + subscribe); React consumes it via useSyncExternalStore.
- Game state and UI state are separate stores — lifecycle and domain in GameStateStore, overlay/modal flags in UIStateStore.
- Workspaces read shell stores through useVanillaStoreSelector, not zustand's React adapter directly.
- Per-player data that outlives a session goes in a synced record store, never component state.

# Code Style & Conventions
* **One source of Truth, Single Enforcer**: Derived values don't get stored a second time - when two things enforce one behaviour they get merged after diffing, never quietly deleted — because deleting the "duplicate" loses functionality silently.
* **Comments**: Comments explain what the code does now, in plain words. No invented nouns, no rhetoric, no changelog in headers. History goes in git and the PR. Related: "say forms, not paradigm" — even when repo docs use a word, if it's wrong it stays banned.
* **Errors**: Throw when a caller made a mistake; catch at the boundary; degrade at runtime, fail loud in a build. Prefix the message with the subsystem — `[sync-engine]`, `[sugarlang]` — and say what the caller should do, not just what broke. Subclass `Error` only when something branches on it, and give the subclass the fields the caller needs to act (`NotSupportedError` carries the plugin id the UI should offer).
* **Casting** A cast that erases a type — as never, as unknown as, as any — needs a comment saying why the checker is wrong.

# Summary
The key is to write clean, testable, functional code that evolves through well-defined, bounded increments. Drive production-behavior changes with a test that describes the desired behavior; use claim-appropriate evidence for documentation, configuration, dependency, generated, CI, and operational changes. When in doubt, favor simplicity and readability over cleverness.
