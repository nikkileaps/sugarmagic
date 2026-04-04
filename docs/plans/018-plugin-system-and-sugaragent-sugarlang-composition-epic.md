# Plan 018: Plugin System and SugarAgent Sugarlang Composition Epic

**Status:** Proposed  
**Date:** 2026-04-03

## Epic

### Title

Create Sugarmagic's first clean plugin system by porting only the plugin infrastructure lessons from Sugarengine's optional runtime plugin architecture and conversation-host composition model while removing the old config drift, plugin-specific escape hatches, and legacy compatibility clutter. This epic does not port SugarAgent or Sugarlang themselves.

### Goal

Deliver plugin infrastructure for Sugarmagic that:

- keeps plugins optional by default
- defines how `SugarAgent` could run independently later
- defines how `Sugarlang` could run independently later
- defines how both could run together later through engine-owned composition rather than plugin-to-plugin coupling
- keeps runtime plugin behavior in `packages/runtime-core`
- keeps target code responsible only for hosting/mounting, not plugin game logic
- gives the editor one canonical plugin settings surface
- lets future plugins contribute editor workspaces and authoring sections in a clean, typed way
- adheres to the project principles:
  - one source of truth
  - single enforcer
  - one-way dependencies
  - one type per behavior
  - goals must be verifiable

This epic should port the strong end-state from Sugarengine without carrying over the messy bootstrap/config history that accumulated while SugarAgent and Sugarlang were evolving.

**Critical scope boundary**

This epic is about plugin plumbing only.

It does **not** include:

- porting SugarAgent runtime behavior
- porting Sugarlang runtime behavior
- porting Sugarlang authoring workflows
- porting SugarAgent authoring fields
- reintroducing plugin-owned gameplay features yet

SugarAgent and Sugarlang are used here only as proving examples for the infrastructure shape. The actual plugin feature ports must happen in later epics after the infrastructure exists.

## Recommendation

### Runtime recommendation

Sugarmagic should have one engine-owned plugin runtime in `packages/runtime-core`.

That runtime should own:

- plugin lifecycle
- capability registration
- ECS-aligned plugin update timing
- plugin state namespaces
- validated action/intention execution
- conversation-host composition
- capability ordering rules

### Publish and packaging recommendation

Publish must treat plugins as optional runtime features of the game, not as separately deployed runtimes.

That means:

- plugin runtime code that is needed for gameplay must ship inside the normal published game bundle
- editor-only plugin authoring UI must not ship with the published game
- targets must not require separate plugin runtime packages to be deployed alongside the game
- plugin optionality must come from project config and runtime registration, not from separate publish artifacts

Recommended packaging rule:

- `packages/runtime-core` owns the generic plugin runtime and capability registries
- plugin runtime modules live in normal workspace packages and are linked into the published game bundle when enabled for that build target
- plugin editor surfaces live in editor/workspace packages and are excluded from published gameplay targets

In other words:

- one published game bundle
- zero separate plugin-runtime deploy steps
- plugin code included only when the target build says it is needed

This keeps runtime optionality without turning plugins into operational deployment pain.

### Editor recommendation

Sugarmagic should have one canonical plugin settings surface in the app shell or project settings.

Plugins may then contribute one or both of:

- a dedicated workspace
- authoring sections inside existing workspaces

Recommended examples:

- `Sugarlang`
  - contributes a dedicated `Design` workspace
- `SugarAgent`
  - contributes project settings
  - contributes NPC authoring sections
  - contributes quest authoring sections

### Configuration recommendation

Sugarmagic should use exactly one canonical plugin configuration shape.

Recommended conceptual shape:

- `project.plugins[]`
  - `pluginId`
  - `enabled`
  - `config`

There should be no parallel top-level aliases such as:

- `project.sugaragent`
- `project.sugarlang`
- string shorthand plugin arrays
- implicit enablement through object presence

### Capability recommendation

Sugarmagic should not preserve Sugarengine's plugin-specific hooks on the generic plugin interface.

Instead, plugins should contribute typed capabilities such as:

- `conversation.provider`
- `conversation.middleware`
- `design.workspace`
- `design.section`
- `project.settings`
- `save.namespace`

This is the cleanest way to support both independence and composition.

## Why this epic exists

Sugarengine eventually reached a genuinely good plugin composition model:

- optional plugin runtime in core
- engine-owned conversation host
- SugarAgent and Sugarlang composed through host-owned seams
- no direct plugin-to-plugin calls required

But the implementation also accumulated several messy layers:

- plugin enablement could be expressed in multiple incompatible ways
- Sugarlang exported middleware/provider through ad hoc extra methods
- SugarAgent added `runAgentTurn(...)` as a plugin-specific special case on the generic plugin interface
- runtime bootstrap returned `plugins` plus side arrays of capabilities instead of using one contribution model
- some plugin loading paths existed mainly for compatibility or demo fallback rather than clean architecture

This epic exists to preserve the strong architecture while deleting the drift.

## Legacy concepts to preserve

Relevant references:

- [Sugarengine ADR-024 Plugin Architecture](/Users/nikki/projects/sugarengine/docs/adr/024-plugin-architecture.md)
- [Sugarengine Plugin API docs](/Users/nikki/projects/sugarengine/docs/api/15-plugins.md)
- [Sugarengine `PluginManager.ts`](/Users/nikki/projects/sugarengine/src/engine/plugins/PluginManager.ts)
- [Sugarengine `types.ts`](/Users/nikki/projects/sugarengine/src/engine/plugins/types.ts)
- [Sugarengine runtime plugin builder](/Users/nikki/projects/sugarengine/src/plugins/runtime.ts)
- [Sugarengine `Game.ts`](/Users/nikki/projects/sugarengine/src/engine/core/Game.ts)
- [Sugarengine `SugarAgentProviderAdapter.ts`](/Users/nikki/projects/sugarengine/src/engine/conversation/SugarAgentProviderAdapter.ts)
- [Sugarengine Sugarlang provider handoff docs](/Users/nikki/projects/sugarengine/src/plugins/sugarlang/docs/api/provider-handoff.md)
- [Sugarengine Sugarlang strategic architecture](/Users/nikki/projects/sugarengine/src/plugins/sugarlang/docs/architecture/sugarlang-strategic-architecture.md)
- [Sugarengine `ProjectMenu.tsx`](/Users/nikki/projects/sugarengine/src/editor/components/ProjectMenu.tsx)
- [Sugarengine `Editor.tsx`](/Users/nikki/projects/sugarengine/src/editor/Editor.tsx)
- [Sugarengine `SugarlangPanel.tsx`](/Users/nikki/projects/sugarengine/src/editor/panels/sugarlang/SugarlangPanel.tsx)

### Core lessons from Sugarengine

#### 1. Optional-by-default plugin runtime was correct

Sugarengine's best high-level rule was:

- plugin support is in core
- plugin instances are not
- no enabled plugins means no behavior change

Sugarmagic should preserve that rule exactly.

#### 2. Engine-owned action gate was correct

Plugins were not supposed to mutate world state directly.
They asked the engine to execute validated intents.

That should carry forward.

#### 3. ECS-aligned plugin update timing was correct

Plugin updates ran through an ECS/world system bridge.
That should carry forward.

#### 4. Conversation-host composition was the real success

The final useful architecture was:

- engine owns the conversation host
- Sugarlang contributes middleware and scripted provider behavior
- SugarAgent contributes free-form conversation behavior
- host selects providers and runs middleware
- plugins never call each other directly

That is the key design to preserve.

#### 5. Sugarlang wanted a dedicated authoring workflow

Sugarlang was not merely a runtime service.
It also had a real content-authoring workflow.

That should carry forward as a plugin-contributed workspace.

#### 6. SugarAgent wanted cross-cutting authoring, not necessarily its own workspace

SugarAgent primarily surfaced through:

- project/plugin settings
- NPC authoring
- quest authoring

That should carry forward in spirit.

## What Sugarmagic should not preserve

### 1. Multiple plugin config dialects

Sugarengine accepted too many enablement/config forms.

Examples that should not survive:

- `plugins: ["sugaragent"]`
- `plugins: [{ id: "sugaragent", enabled: true }]`
- top-level `sugaragent.enabled`
- top-level `sugarlang` object presence as implicit enablement
- demo-only special loading branches as normal runtime config paths

Sugarmagic should have one plugin config model.

### 2. Plugin-specific hooks on the generic plugin interface

Sugarengine's generic plugin type grew a `runAgentTurn(...)` special case.
That is not a clean long-term shape.

Sugarmagic should replace that with capability contributions.

### 3. Ad hoc plugin side-channel capability exports

Sugarengine Sugarlang exported:

- `getMiddleware()`
- `getProvider()`

That worked, but it is not the cleanest extensibility surface.

Sugarmagic should replace that with declared typed contributions.

### 4. Runtime bootstrap returning side arrays

`buildRuntimePluginsFromProject(...)` returning:

- `plugins`
- `conversationMiddleware`
- `conversationProviders`

is a signal that plugin contributions were not owned cleanly enough by the plugin runtime.

Sugarmagic should instead:

- instantiate enabled plugins
- collect declared contributions
- register them through engine-owned registries

### 5. Legacy inline/demo compatibility clutter

If Sugarmagic does not need a legacy inline loading model or demo-only content path, it should not inherit those branches.

## Corrected Sugarmagic direction

### Canonical plugin model

Sugarmagic should introduce a canonical plugin definition shape closer to:

- `PluginDefinition`
  - `pluginId`
  - `displayName`
  - `version`
  - `enabled`
  - `config`

at the project level, plus runtime plugin instances created from that config.

### Capability contributions

Sugarmagic should introduce declared plugin contributions closer to:

- `PluginContribution`
  - `kind`
  - `priority?`
  - `payload`

with initial kinds such as:

- `conversation.provider`
- `conversation.middleware`
- `design.workspace`
- `design.section`
- `project.settings`
- `runtime.persistence`

### Runtime ownership rule

If a plugin behavior is needed for the game to behave correctly on every target, it belongs in `packages/runtime-core`.

That includes:

- plugin lifecycle
- capability registration
- conversation composition
- plugin state persistence
- validated plugin action execution

Targets may only:

- mount plugin-driven UI surfaces
- supply environment-specific transport or host services
- translate target input/output

### Publish boundary rule

The publish pipeline must separate plugin runtime code from plugin editor code.

Runtime side:

- anything needed to play the game on a target belongs in runtime-facing packages and is eligible to be bundled into the published client
- this includes plugin runtime logic, plugin capability contributions, and any shipped plugin UI needed during gameplay

Editor side:

- plugin settings dialogs
- plugin design workspaces
- editor-only authoring helpers
- preview-only tooling

These must stay in editor/workspace packages and must not be required by the published game bundle.

The litmus test is:

- if a web, desktop, or mobile target needs it to play the game, it belongs in the runtime side and can be bundled normally
- if it only exists to author, inspect, or preview plugin behavior in the editor, it stays out of the published game

### Independence rule

`SugarAgent` and `Sugarlang` must be independently enableable.

That means:

- `SugarAgent` without `Sugarlang` still works
- `Sugarlang` without `SugarAgent` still works
- when both are enabled, composition occurs through engine-owned capability orchestration

### Cooperation rule

When both are enabled:

- Sugarlang may contribute pedagogical context and conversation middleware
- SugarAgent may contribute provider behavior for free-form turns
- the engine-owned host must bridge those through typed runtime structures
- plugins must not directly import and call each other at runtime

## Proposed editor UX

### Project-level plugin settings

Sugarmagic should provide one project/plugin settings surface where the user can:

- see which plugins are installed in this editor app
- enable or disable installed plugins
- configure plugin-level settings
- inspect plugin health or validation state

This is the canonical authoring entry point for plugin activation.

### Final install architecture rule

Plugin installation is an editor responsibility, not a runtime-target responsibility.

That means:

- the Sugarmagic editor app discovers available plugin folders
- the editor reads plugin manifests/metadata
- the editor knows which plugins are installed and therefore available to projects
- projects may only enable or disable plugins that are actually installed in the editor app
- Preview and publish consume the already-resolved installed+enabled plugin set

The published game must not:

- scan plugin folders
- manage plugin installation state
- discover plugins dynamically at gameplay runtime

Instead, publish must:

- read the project's enabled installed plugins
- include the matching runtime plugin modules in the normal game bundle
- exclude plugin editor surfaces from the published game

### Workspace contribution rule

A plugin may contribute a workspace when it owns a real authored content workflow.

Example:

- `Sugarlang`
  - contributes a `Design` workspace

### Authoring section contribution rule

A plugin may contribute sections into existing workspaces when it extends existing authored entities.

Examples:

- `SugarAgent`
  - contributes project settings
  - contributes NPC sections
  - contributes quest sections

This keeps ownership cleaner than inventing a fake standalone workspace for every plugin.

## Runtime stories

1. Canonical project plugin config and plugin registry
2. `runtime-core` plugin manager and capability registration
3. ECS plugin update bridge and plugin state namespaces
4. Engine-owned conversation host capability registration
5. Example capability registration path for a future conversation provider plugin
6. Example capability registration path for a future conversation middleware plugin
7. Infrastructure proof that multiple plugins can compose through provider and middleware ordering
8. Plugin-contributed editor settings/workspace/section model
9. Preview and published runtime boot from the same plugin config truth
10. Editor-owned plugin discovery, install state, and publish-time runtime inclusion

## Verification

This epic is complete when the following are true:

1. With no plugins enabled, Preview and the published game behave identically to the non-plugin baseline.
2. The infrastructure can register a provider-style plugin contribution without hardcoding a specific plugin name.
3. The infrastructure can register a middleware-style plugin contribution without hardcoding a specific plugin name.
4. The infrastructure can compose multiple plugins through engine-owned provider and middleware ordering.
5. No target contains plugin gameplay rules that would also be required on another target.
6. There is exactly one canonical project plugin configuration shape.
7. Plugin capabilities are registered by contribution type, not by hardcoded plugin-name conditionals.
8. Plugin state persists under per-plugin namespaces only.
9. Editor plugin UX supports both plugin settings and plugin-contributed workspaces/sections.
10. Publish produces one normal game bundle without requiring separate plugin-runtime deployment artifacts.
11. The editor distinguishes installed plugins from enabled plugins, and projects cannot enable plugins that are not installed.
12. The published game does not scan for plugins at runtime; publish resolves installed+enabled plugin runtimes ahead of time.
13. No SugarAgent or Sugarlang feature port is required for this epic to be complete.

## Out of scope for this epic

- any actual SugarAgent feature port
- any actual Sugarlang feature port
- Sugarlang runtime behavior
- Sugarlang authoring workflows
- SugarAgent runtime behavior
- SugarAgent authoring fields and quest/NPC integration
- hot-reloadable external plugin packaging format
- third-party plugin sandboxing/security hardening
- separate deployment of plugin runtimes as standalone published packages

This epic is about the core plugin plumbing and composition architecture only. The real SugarAgent and Sugarlang ports must happen in later epics that depend on this one.
