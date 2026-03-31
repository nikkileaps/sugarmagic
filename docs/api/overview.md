# API 001: Tech Stack and Platform API

## Purpose

This document explains the expected platform and technology stack for Sugarmagic and describes the high-level platform-facing API assumptions for engineers working on the app, published web targets, and supporting tooling.

## Platform Targets

Sugarmagic is expected to support three closely related execution contexts.

1. `studio`
- the Sugarmagic authoring application
- shell UI, ProductModes, authoring tools, preview, and playtest

2. `preview`
- local browser-hosted runtime preview and playtest inside the same runtime family

3. `published-web`
- deployable game target hosted on the web, such as Google Cloud Run serving the web app and game assets

The architectural rule is:

- these contexts share one runtime semantics layer
- they differ in shell, packaging, and compile profile behavior

## Core Stack

### Language and build

Sugarmagic is expected to use:

- TypeScript as the primary implementation language
- modern ESM module boundaries
- Vite-compatible bundling for web-facing entry points
- workspace-style internal modules inside one repo

### Rendering and graphics

Sugarmagic is expected to use:

- Three.js as the rendering foundation
- `WebGPURenderer` as the primary rendering path
- TSL / node-material semantics as the primary material language

This means engineers should assume:

- one material semantics layer
- one runtime rendering model
- compile profiles for authoring preview, runtime preview, and published targets

### Browser execution

Sugarmagic is expected to rely on:

- browser main thread for shell UI and render-host coordination
- Web Workers for heavy deterministic background jobs
- transferables for large binary payload exchange where appropriate
- optional WASM acceleration behind worker-friendly contracts when profiling justifies it

### UI model

Sugarmagic is expected to use:

- a shell-oriented component architecture
- `zustand` as the default store technology for shell and authoring-session state
- reusable UI components
- ProductMode-based top-level composition
- runtime-backed viewport hosting

The UI stack itself is less important than the architectural rule:

- UI composes domain and runtime systems
- UI does not become the owner of domain truth or runtime semantics
- stores coordinate shell and session state, but do not define canonical authored meaning

### State management

Sugarmagic is expected to distinguish clearly between store-backed application state and authoritative authored or runtime state.

- `zustand` should be used for shell state, ProductMode state, selection state, tool-session coordination state, and other UI-facing application/session state
- canonical authored truth should remain owned by domain documents and their command/transaction boundary
- live simulation state should remain owned by `Runtime Session` and runtime coordinators

The important rule is:

- `zustand` is part of the app stack
- `zustand` is not the canonical domain model
- `zustand` is not a bypass around commands and transactions

### State placement guidelines

Use local component state when:

- the state matters only to one mounted component or a small leaf subtree
- losing the state on unmount is acceptable
- the state does not affect shell coordination or authored meaning

Use `zustand` when:

- multiple components need shared shell or authoring-session coordination
- the state represents ProductMode, navigation, selection, tool-session, or panel behavior
- stable selectors and shared actions improve clarity

Use domain documents plus commands and transactions when:

- the state changes authored meaning
- the state must participate in undo and redo
- the runtime and publish flows must agree on the same semantic result

Use runtime session state when:

- the state exists because simulation is running
- the state should be isolated to preview or playtest
- the state should be discarded or reset with the runtime session

### State lifetime and scoping guideline

Sugarmagic should scope state narrowly and restore it deliberately.

- local UI state should die with the component unless explicitly lifted
- tool-session state should die when the tool session resolves
- ProductMode-scoped state should not leak into other ProductModes unless explicitly declared cross-mode
- workspace and viewport state should survive ordinary composition changes inside the same working context
- runtime-session state should be discarded with the runtime session

### Camera guideline

Camera state should default to viewport/workspace scope, not app-global scope.

The normal expectation should be:

- switching ProductModes does not randomly reset the camera
- playtest snapshots and restores the authoring camera context
- transient tool framing or temporary runtime cameras do not overwrite the normal authoring camera unless explicitly requested

## Runtime Delivery Model

The published web game target should be a thin host around the shared runtime modules.

In practical terms, that means:

- the deployed web game boots the shared runtime
- it loads authored game-root content or published derivatives
- it starts the game using the same runtime semantics used by Sugarmagic preview/playtest

### Important developer implication

Engineers should design runtime-facing modules to be:

- package-stable
- build-stable
- consumable by both Sugarmagic and published web targets

That does not force one distribution strategy.

It does mean the runtime API must be clean enough to support:

- internal workspace consumption
- published package consumption
- thin target-shell integration

## Platform-Facing API Expectations

The platform-facing API should expose these broad capabilities.

### Runtime boot API

A runtime consumer should be able to:

1. create a runtime host
2. provide content root and runtime configuration
3. load a game project or published target manifest
4. start preview or play mode
5. dispose the runtime cleanly

### Asset resolution API

A runtime consumer should be able to:

1. resolve root-relative authored asset paths
2. resolve published target asset paths
3. swap resolver strategy by platform without changing domain meaning

### Save/session API

A host should be able to:

1. create an isolated runtime session
2. persist or discard session state according to host policy
3. keep authored content separate from play/session persistence

### Worker/job API

A host should be able to:

1. submit heavy deterministic jobs
2. receive version-tagged results
3. cancel or ignore stale work
4. apply accepted deltas through authoritative coordinators

## Graphics Capability API Expectations

The runtime should expose capability-aware configuration instead of leaking low-level renderer decisions everywhere.

That means a consumer should be able to ask for or provide:

- supported rendering tier
- enabled compile profile
- target capability hints
- warmup/precompile policy
- debug/inspection policy

The consumer should not need to know how every shader or node graph is assembled internally.

## Published Web Target Expectations

If Sugarmagic is implemented successfully, a published web target should look like this architecturally:

1. thin app shell
2. runtime boot layer
3. asset/content resolver
4. shared runtime modules
5. game-root content or publish artifacts

In other words:

- the published game is not a separate semantic engine
- it is a delivery shell around the same runtime family

## Non-Goals of the Platform API

This API description is not defining:

- exact npm package names
- exact Vite config shapes
- exact cloud deployment manifests
- exact React component APIs

Those are implementation details that should be derived later.

## Builds On

- [ADR 001: Single Runtime Authoring Rule](/Users/nikki/projects/sugarmagic/docs/adr/001-single-runtime-authoring-rule.md)
- [ADR 007: Execution and Concurrency Model](/Users/nikki/projects/sugarmagic/docs/adr/007-execution-and-concurrency-model.md)
- [ADR 008: Material Semantics and Compile Profiles](/Users/nikki/projects/sugarmagic/docs/adr/008-material-semantics-and-compile-profiles.md)
- [ADR 009: Game Root Contract](/Users/nikki/projects/sugarmagic/docs/adr/009-game-root-contract.md)
