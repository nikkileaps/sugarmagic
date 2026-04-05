# Plan 021: Deployment Plugin and Publish Deploy Target Architecture Epic

**Status:** Proposed  
**Date:** 2026-04-04

## Epic

### Title

Add a first-class deployment plugin architecture to Sugarmagic that separates publish targets from deployment targets, allows deployment logic and generated infrastructure artifacts to live in the game root under Sugarmagic ownership, and gives plugins such as SugarAgent a clean way to declare deployment/runtime backend requirements without taking ownership of infrastructure themselves.

### Goal

Deliver a deployment architecture for Sugarmagic that:

- separates publish targets from deployment targets
- establishes `deployment plugin` as the canonical term
- names the first-party deployment plugin `SugarDeploy`
- lets deployment-specific files live in the game root without making the game root the source of truth for deployment behavior
- keeps Sugarmagic as the single author and single enforcer of generated deployment infrastructure
- allows deployment targets such as:
  - `local`
  - `google-cloud-run`
  - `aws-fargate`
- allows other plugins such as `SugarAgent` and `Sugarlang` to declare deployment/runtime requirements
- allows deployment plugins to fulfill those requirements for a selected deployment target
- avoids repeating the old boundary failure where a game root tries to own its own provisioning stack, API proxy, and cloud topology independently
- adheres to the project principles:
  - one source of truth
  - single enforcer
  - one-way dependencies
  - one type per behavior
  - goals must be verifiable

## Scope

This epic includes:

- a formal distinction between publish targets and deployment targets
- a deployment plugin contract in shared Sugarmagic architecture
- a model for plugin-declared deployment/runtime requirements
- a model for deployment-target capability fulfillment
- a model for generated deployment files living in the game root under Sugarmagic ownership
- a split between fully managed deployment artifacts and explicit extension points
- a first deployment target baseline of `local`
- architectural support for web deployments that require a companion API/proxy service
- documentation of how a future deployed web game can include:
  - frontend artifact(s)
  - game API/proxy backend
  - env/secrets mapping
  - deployment topology
- a clear path for later deployment targets such as `google-cloud-run`

## Out Of Scope

This epic does not include:

- implementing the full Cloud Run deployment target yet
- implementing the full AWS deployment target yet
- committing to Terraform specifically over every other IaC tool
- implementing complete production provisioning in this epic
- replacing all existing local preview behavior immediately
- finalizing every deployment file layout path in the game root
- solving every secret-management concern for every platform in one pass
- defining billing, auth, analytics, or multiplayer backend architecture

This epic establishes the architecture and ownership model first.

## Why this epic exists

Sugarmagic now has a clean separation between:

- domain model
- runtime-core
- target web
- plugin system
- optional plugins such as SugarAgent

But deployment still needs a real home.

We already know that a real deployed web game with SugarAgent-style capabilities will need more than a static bundle:

- browser-safe proxying for LLM calls
- server-side secret handling
- retrieval/vector access
- environment and route wiring
- service topology and packaging

The old failure mode was letting the game root become an ad hoc infrastructure system that tried to own its own deployment logic, provisioning, and cloud setup independently.

This epic exists to prevent that from happening again.

The correct model is:

- deployment artifacts may live in the game root
- but Sugarmagic, through a deployment plugin, remains the source of truth, author, validator, and updater of those artifacts

## Recommendation

### Core recommendation

Sugarmagic should introduce a first-class deployment plugin architecture.

A deployment plugin is responsible for:

- describing supported deployment targets
- fulfilling deployment/runtime requirements declared by publish targets and other plugins
- generating and validating deployment artifacts
- owning deployment orchestration for the selected target

The first-party implementation of this architecture should be named:

- `SugarDeploy`

Recommended naming rule:

- `deployment plugin` remains the generic architectural capability term
- `SugarDeploy` is the concrete first-party plugin name

Recommended cardinality rule:

- a deployment plugin is not inherently 1:1 with a deployment target
- one deployment plugin may expose multiple deployment targets
- in the first-party case, `SugarDeploy` should be allowed to house targets such as:
  - `local`
  - `google-cloud-run`
  - `aws-fargate`

### Separation recommendation

Sugarmagic should keep three concerns distinct:

1. Game project
- authored content
- project-level selections and configuration

2. Publish target
- what artifact shape is produced
- what runtime capabilities are required

3. Deployment plugin / deployment target
- how that artifact is run, hosted, packaged, routed, and provisioned for a chosen environment

This separation is critical.

A game project should not become its own infrastructure framework.

### Ownership recommendation

Deployment files may live in the game root, but Sugarmagic must retain single authorship of them.

That means:

- deployment plugin owns generation
- deployment plugin owns validation
- deployment plugin owns update/regeneration behavior
- deployment plugin owns deploy scripting semantics
- project files are storage surfaces, not the behavioral source of truth

## Proposed architecture

### 1. Publish target contract

A publish target answers:

- what are we building?

Examples:

- `web`
- later `desktop`
- later `terminal`

A publish target should define:

- artifact shape
- runtime manifest shape
- required runtime capabilities
- deployment-facing requirement descriptors

Example for `web`:

- client bundle
- runtime boot manifest
- backend requirement for API proxy if enabled plugins need server-side services

### 2. Deployment plugin contract

A deployment plugin answers:

- how is a published artifact deployed and operated?

A deployment plugin should define:

- supported deployment targets
- target-specific topology and packaging rules
- artifact generation/update rules
- validation rules
- deploy execution hooks or scripts
- env and secret mapping rules
- route and base URL wiring rules

Examples of deployment targets:

- `local`
- `google-cloud-run`
- `aws-fargate`

The first-party deployment plugin owning these targets should be:

- `SugarDeploy`

The intended relationship is:

- `SugarDeploy` = plugin
- `local` / `google-cloud-run` / `aws-fargate` = deployment targets

The plugin interface should stay clean by using an internal target-factory pattern.

Recommended conceptual shape:

- `DeploymentPlugin`
  - exposes supported `DeploymentTargetId`s
  - resolves a target handler/factory product for the selected target
- `DeploymentTargetHandler`
  - owns target-specific planning
  - owns target-specific validation
  - owns target-specific artifact generation
  - owns target-specific deploy execution

This keeps plugin identity separate from target identity while still allowing one plugin to grow a target list over time.

### 3. Requirement declaration model

Gameplay/runtime plugins such as `SugarAgent` should not own infrastructure directly.

Instead, they should declare requirements such as:

- generation proxy required
- retrieval/vector proxy required
- secret names required
- backend routes required
- healthcheck expectations required

Deployment plugins should fulfill those requirements for the selected deployment target.

This preserves one-way dependencies:

- runtime plugins declare needs
- deployment plugin fulfills them

Not:

- runtime plugin owning deployment behavior itself

Explicit dependency rule:

- runtime and publish layers must not take hard dependencies on deployment-plugin implementation types
- runtime and publish layers may depend only on shared deployment requirement interfaces or capability contracts

Correct:

- `SugarAgent` -> shared `RuntimeServiceRequirement`
- `SugarAgent` -> shared `ProxyRouteRequirement`

Incorrect:

- `SugarAgent` -> `SugarDeploy.CloudRunConfig`
- `web publish target` -> `SugarDeploy.LocalTargetHandler`

This rule must be enforced to preserve one-way dependencies.

### 3a. Requirement conflict resolution

Deployment planning must assume that multiple plugins may declare incompatible requirements.

Examples:

- Plugin A requires a Python service runtime
- Plugin B requires a Node service runtime
- Plugin A and Plugin B both require a runtime service, but not the same kind of runtime service

This means `DeploymentPlan` cannot be a naive merge of all requirements.

Recommended rule:

- deployment planning must include an explicit conflict resolution stage
- requirement conflicts must be detected, surfaced, and resolved intentionally

Recommended resolution options:

1. Shared fulfillment
- multiple requirements collapse into one shared service or provider when they are compatible

2. Separate fulfillment
- incompatible requirements are containerized or deployed separately
- this is effectively a sidecar or multi-service pattern

3. Hard failure
- if requirements cannot be reconciled for the selected deployment target, deployment planning fails with a clear validation error

The deployment system should never silently pick one plugin's runtime requirement and ignore another.

### 3b. Sidecar or multi-service strategy

Deployment targets should be allowed to satisfy plugin requirements using more than one deployable unit.

Examples:

- frontend service + game API proxy
- main API service + sidecar worker
- multiple backend services with routed responsibility boundaries

This is especially important when:

- plugins require different runtimes
- plugins require different execution models
- plugins require isolated scaling or lifecycle behavior

The deployment architecture should therefore permit:

- one `DeploymentPlan` containing multiple deployable service units
- one deployment target to map those units into the platform's topology rules

The selected deployment target may still impose constraints.

For example:

- `local` may run multiple processes or containers
- `google-cloud-run` may require one or more separately deployed services

But the architectural rule should be:

- requirement conflicts are resolved through explicit planning, not implicit flattening

### Story 0. Define the schema for `DeploymentRequirement`

Before Sugarmagic implements deployment behavior, it must define one vendor-neutral requirement schema that plugins and publish targets can emit.

This is the most important first story because it determines whether the rest of the deployment architecture stays clean.

Core rule:

- plugins and publish targets declare needs through shared requirement types
- they must not depend on deployment-target implementation types
- the schema must describe *what is needed*, not *how a specific platform implements it*

Recommended conceptual schema:

```ts
type DeploymentRequirement =
  | SecretRequirement
  | ProxyRouteRequirement
  | RuntimeServiceRequirement
  | TopologyRequirement;

interface DeploymentRequirementBase {
  requirementId: string;
  ownerId: string;
  ownerKind: "publish-target" | "plugin";
  required: boolean;
  description?: string;
  tags?: string[];
}

interface SecretRequirement extends DeploymentRequirementBase {
  kind: "secret";
  secretKey: string;
  consumption: "server-only" | "build-time";
}

interface ProxyRouteRequirement extends DeploymentRequirementBase {
  kind: "proxy-route";
  routeId: string;
  protocol: "http-json" | "sse" | "websocket";
  consumer: "browser-runtime" | "server-runtime";
  pathHint?: string;
}

interface RuntimeServiceRequirement extends DeploymentRequirementBase {
  kind: "runtime-service";
  serviceId: string;
  executionModel: "request-response" | "worker" | "scheduled-job";
  runtimeFamily?: "node" | "python" | "container";
  isolation: "shared-allowed" | "isolated-required";
}

interface TopologyRequirement extends DeploymentRequirementBase {
  kind: "topology";
  subjectId: string;
  placement:
    | "co-locate-preferred"
    | "co-locate-required"
    | "separate-service-required";
}
```

Schema intent:

- `SecretRequirement`
  - a plugin says it needs a secret of a given logical name
  - it does not say Cloud Run Secret Manager or `.env`
- `ProxyRouteRequirement`
  - a plugin says it needs a route boundary of a given shape
  - it does not say Nginx, Express, Cloud Run routing, or Vite proxy
- `RuntimeServiceRequirement`
  - a plugin says it needs a server-side execution surface
  - it may express runtime-family hints for conflict planning
  - it does not say how a specific platform provisions it
- `TopologyRequirement`
  - a plugin says whether something may be shared or must be isolated
  - it does not say how the target maps that into services or containers

Required schema rules:

1. Every requirement is owned
- `ownerId` and `ownerKind` must identify who declared the requirement

2. Every requirement is stable and addressable
- `requirementId` must be stable enough for validation, drift detection, and diagnostics

3. The schema is vendor-neutral
- no `CloudRun*`, `AWS*`, `Docker*`, or other target-specific implementation types inside the requirement contract

4. The schema is declarative
- the contract describes desired capability, not deployment mechanism

5. The schema is conflict-plannable
- it must expose enough structure for `DeploymentPlan` to detect conflicts such as incompatible runtime families or incompatible topology constraints

6. The schema is local-parity-friendly
- every requirement kind must be fulfillable by both hosted targets and `local` through corresponding providers or mocks

Correct examples:

- `SugarAgent` declares a `secret` requirement for an Anthropic provider key
- `SugarAgent` declares a `proxy-route` requirement for browser-to-backend generation requests
- `SugarAgent` declares a `runtime-service` requirement for server-side request-response execution

Incorrect examples:

- `SugarAgent` imports `SugarDeploy.CloudRunSecretBinding`
- `SugarAgent` declares `cloudRunServiceName`
- `web` publish target declares `viteProxyPort`

This story should finish with:

- one canonical `DeploymentRequirement` schema
- one clear discriminated-union contract
- one shared vocabulary for all later deployment planning work

Nothing else in deployment implementation should move ahead until this schema is reviewed.

### 4. Game-root deployment surfaces

Deployment artifacts may live in the game root.

Examples:

- generated Dockerfiles
- generated local proxy config
- generated Terraform or platform manifests
- generated env templates
- generated deploy scripts

But these should be treated as:

- Sugarmagic-managed deployment surfaces

Not:

- independent hand-maintained infrastructure systems

### 5. Managed files vs extension points

The deployment plugin should explicitly separate:

1. Managed files
- generated by Sugarmagic
- validated by Sugarmagic
- updated by Sugarmagic

2. Extension points
- narrow user-editable inputs
- explicit override fields
- platform-specific tuning knobs

Examples of extension points:

- domain names
- scaling minima/maxima
- secret reference names
- route prefix overrides
- selected region or provider settings

This allows useful customization without splitting authorship.

### 5a. Managed file sync strategy

If Sugarmagic writes a managed deployment file into the game root, the sync behavior must be explicit.

Recommended rule:

- Sugarmagic-managed deployment files are regenerated, not hand-merged
- managed files should include a clear generated header such as:
  - `GENERATED BY SUGARMAGIC - DO NOT EDIT`
- if a user manually edits a managed file, Sugarmagic should detect drift and warn before overwrite
- Sugarmagic should not silently merge arbitrary handwritten changes into managed files
- customization should happen through explicit extension points, not by patching generated files directly

Recommended regeneration behavior:

1. Sugarmagic detects that a managed file differs from the last generated form
2. Sugarmagic reports that the file has drifted from managed output
3. Sugarmagic offers a clear regenerate or overwrite action
4. Sugarmagic reminds the user that durable customization belongs in extension-point configuration

This keeps the source of truth clean and avoids pretending that handwritten edits to managed deployment artifacts are safely mergeable.

### 6. Local deployment target first

The first deployment target should be:

- `local`

`local` should be capable of:

- running the published web target locally
- standing up a local game API/proxy boundary for server-side provider calls
- reading local env configuration
- mapping browser calls to same-origin local proxy routes

This gives Sugarmagic a clean development bridge before full cloud deployment targets are added.

Important parity rule:

- `local` must not be treated as a fake special case with unrelated behavior
- `local` should fulfill the same requirement categories that hosted deployment targets fulfill
- when a hosted target uses a platform-specific provider, `local` should provide a corresponding local or mock fulfillment path for that same requirement type

Examples:

- secret requirement
  - `google-cloud-run`: cloud secret manager reference
  - `local`: `.env` or other local secret source
- proxy route requirement
  - `google-cloud-run`: deployed service route
  - `local`: same-origin local proxy route
- runtime service requirement
  - `google-cloud-run`: managed service/container
  - `local`: local process or container

The goal is not identical infrastructure. The goal is honest requirement parity.

### 6a. Local provider and mock fulfillment strategy

For each deployment requirement type, Sugarmagic should define how `local` fulfills it.

Recommended rule:

- every requirement type should have an explicit local fulfillment strategy
- if a hosted target uses a provider-specific system, `local` should map that requirement to a local or mock provider of the same conceptual type

Examples of local fulfillment providers:

- local secret provider
  - `.env`
  - local secret file
- local proxy provider
  - local same-origin proxy server
- local service runner
  - local process
  - local container
- local storage or manifest provider
  - filesystem-backed manifest or generated metadata

This makes `local` a real deployment target with verifiable behavior instead of a hand-waved convenience mode.

### 7. Web plus companion backend topology

For deployment purposes, a `web` publish target may require more than static hosting.

If enabled plugins declare server-side requirements, the deployment plugin should be able to produce a topology including:

- frontend web artifact
- game API/proxy backend
- env/secrets configuration
- route wiring between frontend and backend

This should be treated as one Sugarmagic-owned deployment shape, not as an ad hoc project-side invention.

### 7a. Backend for frontend recommendation

For `web`, the companion backend or proxy layer should be treated as a backend-for-frontend boundary.

Architectural recommendation for v1:

- default to one monolithic gateway or BFF-style service for `local` and early hosted targets such as `google-cloud-run`
- avoid starting with a fleet of microservices unless requirement conflicts truly force service separation

This keeps the system simpler while preserving room for later multi-service plans.

Recommended v1 shape:

- frontend web artifact
- one companion backend service that can host or route plugin-required backend capabilities

That companion service may fulfill things such as:

- LLM proxying
- retrieval proxying
- secret-backed provider access
- target-specific backend routing

The deployment architecture should still permit later splitting into multiple service units when requirement conflicts or scaling needs justify it.

## Keep, Modify, Discard

### Keep

1. Sugarmagic ownership of project-managed systems
- deployment should follow the same authorship discipline as the rest of the game root.

2. Plugin capability model
- plugins declaring requirements instead of directly owning unrelated systems is the right direction.

3. Clear target separation
- `web` as a publish target is still the right concept.

4. One-way dependency thinking
- deployment should fulfill runtime/plugin requirements, not invert those relationships.

### Modify

1. The idea that deployment equals hosting scripts
- deployment must be treated as a full platform/runtime topology concern, not just a script folder.

2. The idea that game roots should directly own infra behavior
- game roots may store deployment artifacts, but should not become their own deployment authority.

3. The idea that web deployment is always static-only
- web deployments may require a backend companion service depending on enabled plugin/runtime requirements.

### Discard

1. Ad hoc per-game infrastructure ownership
- no more bespoke project-managed provisioning logic becoming the hidden second system.

2. Deployment logic hidden in runtime plugins
- SugarAgent and similar plugins should not own their own platform deployment implementation.

3. Conflating publish and deploy
- building a web artifact and deploying it to Cloud Run are different behaviors and need different contracts.

## Proposed contracts

### Publish target concepts

Suggested concepts:

- `PublishTargetId`
- `PublishArtifact`
- `PublishRequirement`
- `PublishManifest`

### Deployment plugin concepts

Suggested concepts:

- `DeploymentPlugin`
- `DeploymentTargetId`
- `DeploymentTargetHandler`
- `DeploymentTargetFactory`
- `DeploymentPlan`
- `DeploymentArtifact`
- `DeploymentRequirementFulfillment`
- `DeploymentValidationResult`

### Requirement concepts

Suggested concepts:

- `RuntimeServiceRequirement`
- `ProxyRouteRequirement`
- `SecretRequirement`
- `TopologyRequirement`
- `RequirementConflict`
- `RequirementResolutionStrategy`
- `DeploymentServiceUnit`

These names are illustrative; exact naming can be refined during implementation.

## Example conceptual flow

### Authoring and selection

1. The game project selects:
- publish target: `web`
- deployment target: `local`

2. Enabled plugins declare requirements:
- `SugarAgent` requires generation proxy and retrieval proxy

3. The publish target exposes its artifact/runtime needs

### Deployment planning

4. Deployment plugin gathers:
- project deployment settings
- publish target manifest
- plugin-declared requirements

5. Deployment plugin resolves a `DeploymentPlan`

6. Deployment plugin generates or updates managed deployment files in the game root

### Execution

7. Deployment plugin runs local/deploy orchestration

8. The resulting topology serves:
- frontend web runtime
- backend game API/proxy

## Verification goals

This epic is successful when Sugarmagic can support a deployment architecture where:

1. publish targets and deployment targets are distinct concepts
2. deployment is owned by a first-class deployment plugin contract
3. one canonical vendor-neutral `DeploymentRequirement` schema exists before deployment implementation proceeds
4. deployment artifacts can live in the game root without making the game root the source of truth
5. runtime plugins can declare deployment/runtime requirements without taking ownership of infrastructure
6. a `local` deployment target can be defined as the first baseline target
7. the architecture naturally supports future targets such as `google-cloud-run`
8. the ownership model is explicit enough to avoid the previous split-brain infra failure mode
9. managed deployment file drift, warning, and overwrite behavior are explicit and testable
10. `local` has explicit fulfillment or mock-provider rules for the same requirement categories used by hosted targets
11. conflicting plugin requirements are detected and resolved explicitly, or deployment fails clearly
12. runtime and publish layers depend only on shared requirement contracts, not deployment-plugin implementation types
13. the recommended v1 web backend shape is a monolithic gateway or BFF unless explicit conflicts require multi-service deployment

## Suggested stories

0. Define the canonical vendor-neutral `DeploymentRequirement` schema and stop for review
1. Define publish target and deployment target vocabulary in shared architecture docs
2. Add deployment plugin contract and deployment requirement contract to shared plugin/runtime architecture
3. Define how game projects store selected publish target and selected deployment target
4. Define deployment-plugin-managed file layout and ownership rules for game-root deployment artifacts
5. Define managed deployment files vs explicit extension-point surfaces
6. Define managed-file drift detection, generated-file headers, and overwrite or regeneration behavior
7. Define the `local` deployment target shape, including local proxy/backend topology
8. Define local fulfillment providers or mock providers for each requirement type used by hosted targets
9. Define how runtime plugins such as SugarAgent declare deployment/runtime backend requirements
10. Define requirement conflict detection and resolution rules for deployment planning
11. Define how deployment plugins fulfill plugin-declared requirements without violating one-way dependencies
12. Define the v1 web companion backend or BFF shape and its relationship to plugin requirements
13. Define validation and regeneration rules for Sugarmagic-managed deployment surfaces
14. Define how a future `google-cloud-run` deployment target would fit the same model
15. Define a SugarDeploy execution bridge for target actions such as `deploy`, `stop`, `status`, and `health` so deployment execution remains deployment-plugin-owned rather than Studio-owned

## Open questions

1. Where should managed deployment artifacts live in the game root:
- `deployment/`
- `infrastructure/`
- `.sugarmagic/deployment/`
- some other managed path?

2. Which deployment artifacts should be fully generated vs partially templated?

3. Should `local`, `google-cloud-run`, and `aws-fargate` all live in one deployment plugin initially, or should platform-specific deployment plugins be split later?

Current naming preference:

- start with one first-party deployment plugin named `SugarDeploy`
- let `SugarDeploy` own `local` first
- decide later whether cloud-specific targets remain in `SugarDeploy` or split into sibling deployment plugins

Current structural preference:

- allow one deployment plugin to expose multiple targets
- keep target-specific behavior behind target handlers/factory resolution
- avoid a misleading 1:1 assumption between plugin identity and deployment target identity

4. How should publish targets express backend topology needs in a way that stays clean and vendor-neutral?

5. Which extension points are safe to expose without undermining single authorship?

6. Should Sugarmagic store a managed-file fingerprint or manifest to improve drift detection and overwrite messaging?

7. Which requirement categories must always have an explicit local fulfillment strategy before a hosted target is considered valid?

8. Which requirement conflicts should be resolvable through shared fulfillment, and which should force multi-service or sidecar deployment plans?

9. At what point should the default monolithic gateway or BFF shape be split into multiple service units?

## Summary

Sugarmagic should introduce a deployment plugin architecture that cleanly separates publish targets from deployment targets while preserving Sugarmagic as the single author and single enforcer of deployment behavior.

Deployment files may live in the game root, but they should be treated as Sugarmagic-managed deployment surfaces rather than ad hoc project-owned infrastructure.

This gives Sugarmagic a clean way to support:

- local proxy-backed development
- future Cloud Run or other hosted deployment targets
- plugin-declared runtime backend requirements
- one coherent deployment story without repeating the boundary failures of the old system
