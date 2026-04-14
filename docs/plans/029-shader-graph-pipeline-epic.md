# Plan 029: Shader Graph Pipeline Epic

**Status:** Proposed  
**Date:** 2026-04-13

## Epic

### Title

WebGPU shader graph authoring, compilation, and runtime pipeline.

### Goal

Build a visual shader graph system that lets authors create TSL-based shaders for vertex displacement, fragment effects, and post-processing — then compile and apply those shaders at runtime on top of standard PBR materials loaded from external tools (Substance Designer, etc.).

PBR materials (albedo, normal, roughness, metalness texture maps) are NOT authored in Sugarmagic — they come from dedicated material authoring tools and are loaded as texture sets. Sugarmagic's shader graph operates ON TOP of those materials: displacing vertices (wind, water), modifying fragments (dissolve, glow, fog), reading PBR maps as inputs (height-based displacement, roughness-driven effects), and composing post-processing chains.

The MVP shader is foliage wind sway — replacing the hardcoded billboard wind animation with an authored, tunable, graph-based shader that works on actual 3D foliage meshes.

### Why this epic exists

The codebase has four separate hardcoded TSL shader implementations (landscape splatmap, sky gradient, billboard wind sway, bloom post-process) with no shared authoring, compilation, or management infrastructure. Each one is hand-built in code. Adding new effects (water ripple, height displacement, dissolve, custom fog) requires writing new TSL code inline in the renderer. There is no way for an author to create, tune, or preview shader effects without a developer.

Plan 028 (Foliage) is paused because the foliage wind shader needs to work on actual 3D meshes, not just billboards. This requires a proper shader pipeline.

### Relationship to Proposal 009

Proposal 009 (Material Compilation and Shader Pipeline Architecture) defines the high-level architecture: one semantic compiler, one IR, three compile profiles (authoring-preview, runtime-preview, published-target). This epic implements the shader half of that vision. The material half (PBR texture set management, slot binding) is a simpler separate concern — it's just loading and assigning textures to standard PBR slots, not a graph.

### Architecture layers

The shader graph pipeline has four layers with strict one-way dependencies and testable contracts between each.

```
┌─────────────────────────────────────────────────────────┐
│  AUTHORING (packages/workspaces, packages/shell)        │
│  Visual graph editor UI, node palette, preview panel    │
│  Produces: ShaderGraphDocument (canonical authored truth)│
└──────────────────────┬──────────────────────────────────┘
                       │ ShaderGraphDocument (domain contract)
┌──────────────────────▼──────────────────────────────────┐
│  DOMAIN (packages/domain)                               │
│  ShaderGraphDocument, ShaderNodeDefinition,              │
│  ShaderPortDefinition, ShaderEdgeDefinition              │
│  Pure data types — no rendering, no compilation          │
└──────────────────────┬──────────────────────────────────┘
                       │ ShaderGraphDocument
┌──────────────────────▼──────────────────────────────────┐
│  COMPILER (packages/runtime-core/src/shader/)           │
│  ShaderSemanticCompiler: validate → normalize → IR      │
│  ShaderIR: platform-agnostic intermediate representation│
│  Profile-aware: authoring-preview, runtime, published   │
│  Pure functions — no Three.js, no DOM, fully testable   │
└──────────────────────┬──────────────────────────────────┘
                       │ ShaderIR (compiled intermediate)
┌──────────────────────▼──────────────────────────────────┐
│  FINALIZATION (targets/web/src/shader/)                  │
│  TSLFinalizer: ShaderIR → Three.js TSL node graph       │
│  Creates MeshStandardNodeMaterial / MeshBasicNodeMaterial│
│  Assigns positionNode, colorNode, etc. from compiled IR │
│  Owns GPU resource lifecycle — disposal, cache, warmup  │
└─────────────────────────────────────────────────────────┘
```

**Dependency direction:** Authoring → Domain → Compiler → Finalization. Never backwards. The compiler never imports Three.js. The domain never imports the compiler. Authoring never imports the finalizer.

### Runtime enforcer: ShaderRuntime

One system owns the full shader lifecycle at runtime. This is the `ShaderRuntime`, instantiated once per gameplay session in the web host. It is the single authority for:

- **IR compile cache** — keyed by `shaderDefinitionId + documentRevision + compileProfile`. The semantic compiler is a pure function; the `ShaderRuntime` decides when to call it and caches the result. A graph that hasn't changed does not recompile.
- **Finalized material cache** — keyed by `shaderDefinitionId + documentRevision + compileProfile + targetKind`. Once the TSL finalizer produces a material node configuration, the `ShaderRuntime` caches it. Entities sharing the same shader and parameters share the same finalized material instance.
- **Uniform updates** — when a parameter override changes at runtime (e.g. inspector tweak), the `ShaderRuntime` updates the uniform value on the cached finalized material. No recompilation, no re-finalization — just a uniform write.
- **Profile-aware recompilation** — when the compile profile changes (e.g. switching from authoring-preview to runtime-preview), the `ShaderRuntime` invalidates the caches for the old profile and recompiles/re-finalizes with the new one.
- **Disposal** — when an entity is removed, the `ShaderRuntime` decrements the ref count on its finalized material. When ref count hits zero, it schedules disposal (with a grace period to avoid thrashing during scene transitions). On session end, all caches are flushed.
- **Diagnostics** — the `ShaderRuntime` collects compiler diagnostics and exposes them via a `getShaderDiagnostics(shaderDefinitionId)` API. The shader graph editor and the debug HUD read from this.

```typescript
/**
 * Target-specific application context. The caller provides the right
 * shape for the shader's targetKind; the ShaderRuntime dispatches to
 * the correct finalizer internally.
 */
type ShaderApplyTarget =
  | { targetKind: "mesh-surface" | "mesh-deform"; material: MeshStandardNodeMaterial }
  | { targetKind: "billboard-surface"; material: MeshBasicNodeMaterial }
  | { targetKind: "post-process"; renderPipeline: RenderPipeline };

interface ShaderRuntime {
  /**
   * Compile (if needed), finalize, and apply a shader to its target.
   * - mesh-surface / mesh-deform: modifies the MeshStandardNodeMaterial's nodes
   * - billboard-surface: modifies the MeshBasicNodeMaterial's nodes
   * - post-process: composes onto the RenderPipeline's outputNode
   *
   * Returns the material instance to use (may be the original, a shared
   * template, or a per-instance clone depending on parameter overrides).
   * For post-process, returns null (pipeline is modified in place).
   */
  applyShader(
    binding: EffectiveShaderBinding,
    target: ShaderApplyTarget
  ): { material: MeshStandardNodeMaterial | MeshBasicNodeMaterial } | null;

  /** Update a parameter uniform without recompilation. */
  updateParameter(shaderDefinitionId: string, parameterId: string, value: unknown): void;

  /** Force recompilation (e.g. after graph edit in the shader editor). */
  invalidate(shaderDefinitionId: string): void;

  /** Change compile profile and invalidate all caches. */
  setCompileProfile(profile: RuntimeCompileProfile): void;

  /** Read diagnostics for a shader. */
  getDiagnostics(shaderDefinitionId: string): ShaderIRDiagnostic[];

  /** Clean up all cached materials and IR. */
  dispose(): void;
}
```

The caller is responsible for providing the correct `ShaderApplyTarget` variant — the web host knows whether it's creating a mesh, a billboard, or configuring post-processing. The `ShaderRuntime` validates that the shader graph's `targetKind` matches the provided target and throws if mismatched (e.g. applying a `mesh-deform` shader to a `post-process` target).

No other system compiles shaders, caches materials, updates uniforms, or disposes shader resources. The web host calls `ShaderRuntime.applyShader()` during scene object instantiation. The shader graph editor calls `ShaderRuntime.invalidate()` after graph edits. The inspector calls `ShaderRuntime.updateParameter()` for live tweaking. One enforcer, one cache, one lifecycle owner.

### What a shader graph IS and IS NOT in Sugarmagic

**IS:**
- A directed acyclic graph of typed nodes with typed ports and typed edges
- An authored document persisted in the project, versioned, undoable
- Compiled to a platform-agnostic IR, then finalized to TSL for WebGPU
- Applied to entities/materials at runtime via a shader binding on the scene object

**IS NOT:**
- A material editor — PBR materials come from Substance Designer as texture maps
- A replacement for Three.js built-in materials — shaders augment `MeshStandardNodeMaterial`, they don't replace the PBR pipeline
- A compute shader system (future epic if needed)
- A visual scripting language for game logic

### Graph target kinds

Every shader graph has a `targetKind` that determines what outputs are valid, what builtins are available, and which finalizer handles it. One graph system, multiple targets:

| Target kind | Purpose | Valid outputs | Finalizer applies to |
|---|---|---|---|
| `mesh-surface` | Fragment effects on mesh materials (dissolve, glow, tint, fresnel) | `FragmentOutput`, `EmissiveOutput` | `material.colorNode`, `material.emissiveNode`, `material.opacityNode` |
| `mesh-deform` | Vertex displacement on meshes (wind sway, breathe, wave) | `VertexOutput` | `material.positionNode` |
| `post-process` | Full-screen post-processing effects (bloom tuning, color grading, fog) | `PostProcessOutput` | `RenderPipeline.outputNode` composition |
| `billboard-surface` | Fragment effects specific to billboard quads (tint, opacity fade) | `FragmentOutput` | Billboard material `colorNode`, `opacityNode` |

**Rules:**
- A graph's `targetKind` is set at creation time and cannot change (you don't convert a mesh-deform graph into a post-process graph).
- The node palette filters to only show nodes valid for the current target kind. For example, `VertexDisplacement` only appears for `mesh-deform`; `PostProcessOutput` only appears for `post-process`.
- The semantic compiler validates that the graph's outputs match its `targetKind`. A `mesh-surface` graph with a `VertexOutput` is a compile error.
- The finalizer dispatches to the correct application method based on `targetKind`. This keeps one compiler with multiple finalization strategies — not separate compilers per target.

### Billboard shader participation

Billboards (Plan 026) create their materials in `BillboardRenderer` (`targets/web/src/billboard/BillboardRenderer.ts`) using `MeshBasicNodeMaterial`. The current wind sway is hardcoded in `createBillboardMaterial()` (line 82). The shader graph replaces this path.

**Verified current types (as of Plan 026 implementation):**

| Type | File | Purpose |
|---|---|---|
| `FoliageBillboardAsset` | `packages/runtime-core/src/billboard/index.ts` (line 84) | Semantic asset descriptor. Fields: `texturePath`, `size`, `tintColor?`, `windSwayAmplitude?`, `lodThresholds?` |
| `BillboardDescriptor` | `packages/runtime-core/src/billboard/index.ts` | Discriminated union: `"sprite"` / `"text"` / `"impostor"`. Sprite has `atlasId` + `frameIndex`. |
| `BillboardComponent` | `packages/runtime-core/src/billboard/index.ts` (line 92) | ECS component. Fields: `descriptor`, `orientation`, `displayMode`, `size`, `offset`, `lodThresholds?`, `enabled`, `visible`, `lodState` |
| `ResolvedBillboardAsset` | `targets/web/src/billboard/BillboardAssetRegistry.ts` (line 28) | GPU-resolved asset. Fields: `assetKey`, `texture: THREE.Texture`, `uv: UVRect`, `tintColor?`, `windSwayAmplitude?` |
| `BillboardAssetRegistry` | `targets/web/src/billboard/BillboardAssetRegistry.ts` | Owns texture lifecycle. `resolve(descriptor) → ResolvedBillboardAsset \| null` |
| `BillboardRenderer` | `targets/web/src/billboard/BillboardRenderer.ts` | Creates `InstancedMesh` per group. Calls `createBillboardMaterial(asset)` for each unique asset. |

**How a `billboard-surface` graph reaches the billboard renderer:**

1. `FoliageBillboardAsset` gains a `shaderDefinitionId: string | null` field. This is the shader binding for billboard foliage — same pattern as `AssetDefinition.defaultShaderDefinitionId` for meshes.
2. `ResolvedBillboardAsset` gains a corresponding `shaderDefinitionId: string | null` (passed through from the registry resolution).
3. `createBillboardMaterial()` in `BillboardRenderer.ts` changes: instead of hardcoding wind sway TSL, it creates a bare `MeshBasicNodeMaterial` with texture sampling only (color + opacity from atlas), then calls `ShaderRuntime.applyShader()` with `target: { targetKind: "billboard-surface", material }`.
4. The `ShaderRuntime` compiles the graph (same compiler as mesh shaders), then dispatches to the `billboard-surface` finalization path which applies fragment ops to `colorNode`/`opacityNode` and vertex ops to `positionNode` (for wind displacement).
5. `BillboardRenderer` does NOT compile or finalize shaders — it hands the material to `ShaderRuntime` and uses the returned material. One enforcer.

**What changes vs. the current hardcoded wind:**
- `createBillboardMaterial()` (BillboardRenderer.ts line 82) stops inlining the `sin()` / `positionLocal` / `time` wind sway TSL (lines 94-102)
- `windSwayAmplitude` is removed from `FoliageBillboardAsset` and `ResolvedBillboardAsset` — it becomes a shader parameter override
- `tintColor` stays on the asset (it's a texture sampling concern, not a shader graph concern)

**Key constraint:** `billboard-surface` graphs may NOT use builtins that require mesh geometry attributes (`localNormal`, `worldNormal`) since billboard quads don't have meaningful normals. The compiler validates this via the builtin catalog's `validTargetKinds`.

### Post-process shader ownership

Post-process shaders are NOT bound to entities or placed instances. They are bound to the **environment definition** — the same authored document that already owns bloom, fog, SSAO, and sky settings.

**Concrete persisted type:**

| Domain type | File | New field(s) | Persisted in |
|---|---|---|---|
| `EnvironmentDefinition` | `packages/domain/src/content-library/index.ts` | `postProcessShaders: PostProcessShaderBinding[]` | Content library (game project) |

```typescript
interface PostProcessShaderBinding {
  shaderDefinitionId: string;
  /** Execution order — lower runs first. Multiple post-process shaders compose in sequence. */
  order: number;
  /** Parameter overrides for this binding. Same shape as instance overrides. */
  parameterOverrides: ShaderParameterOverride[];
  /** Enable/disable without removing. */
  enabled: boolean;
}
```

**Why the environment definition:**
- A region already binds to an environment definition via `RegionEnvironmentBinding.defaultEnvironmentId`.
- The environment definition already owns the render pipeline configuration (bloom, fog, SSAO).
- Post-process shaders are a per-environment concern, not a per-entity or per-instance concern.
- Multiple regions can share an environment definition and get the same post-process chain.
- Switching environments (e.g. entering a cave) switches the post-process chain along with the lighting.

**Runtime path:**
1. When a region loads, `resolveSceneObjects` reads the region's environment binding → environment definition → `postProcessShaders[]`.
2. The web host passes each enabled binding (sorted by `order`) to `ShaderRuntime.applyShader()` with `target: { targetKind: "post-process", renderPipeline }`.
3. The `ShaderRuntime` compiles each graph, then the TSL finalizer composes them onto the `RenderPipeline.outputNode` in sequence: `sceneColor → shader1 → shader2 → ... → final output`.
4. Parameter overrides on each binding become uniforms on that shader's post-process pass.
5. When the environment changes (region transition, authored edit), the web host calls `invalidate()` for the old post-process shaders and applies the new ones.

**Commands:**
- `AddPostProcessShader` — adds a `PostProcessShaderBinding` to an `EnvironmentDefinition`
- `UpdatePostProcessShaderOrder` — reorders the chain
- `UpdatePostProcessShaderParameter` — overrides a parameter on a binding
- `TogglePostProcessShader` — sets `enabled`
- `RemovePostProcessShader` — removes from the chain

**Relationship to existing bloom/fog/SSAO:** The hardcoded bloom in `RuntimeRenderGraph` is a v0 post-process effect. Once the shader graph pipeline ships, bloom should be migrated to an authored `post-process` shader graph that ships as a built-in environment preset, replacing the hardcoded `bloom()` TSL call. Fog and SSAO can follow the same migration path. This is a future cleanup, not a requirement for this epic.

### Revision model, invalidation, and live-edit safety

#### What counts as a revision

A shader graph revision is a monotonically increasing integer stored on the `ShaderGraphDocument`:

```typescript
interface ShaderGraphDocument {
  // ... existing fields
  revision: number;  // incremented on every persisted mutation
}
```

Every command that mutates the graph (`UpdateShaderNode`, `AddShaderEdge`, `RemoveShaderEdge`, `UpdateShaderParameter`, etc.) increments `revision` by 1. Undo decrements it back. The revision is part of the persisted document — it survives save/load cycles.

The cache key includes the revision: `${shaderDefinitionId}:${revision}:${profile}`. This means:

- **Edit** → revision increments → cache miss → recompile + re-finalize
- **Undo** → revision decrements to a previously seen value → cache HIT if the old entry hasn't been evicted yet. Fast undo preview.
- **Redo** → revision increments again → cache hit or miss depending on eviction

#### Invalidation flow during live editing

When the author edits a shader graph in the Studio editor:

1. The command mutates the `ShaderGraphDocument` and increments `revision`.
2. The shader graph editor calls `ShaderRuntime.invalidate(shaderDefinitionId)`.
3. `invalidate()` does NOT evict cache entries for old revisions — it marks the shader as dirty. On the next `applyShader()` call, the `ShaderRuntime` reads the current `revision` from the document, discovers the cache key doesn't match, and recompiles.
4. Old cache entries (previous revisions) remain in the cache briefly for undo support. They are evicted via LRU policy — the cache holds at most N revisions per shader (default: 3). This means undo up to 3 steps back is instant; beyond that, recompilation occurs.

#### Material swap safety

When a recompilation produces a new base material template, entities currently using the old template must switch to the new one. This happens safely because:

1. The `ShaderRuntime` tracks which entities reference which cache entries (via ref counts).
2. On recompilation, the new base template is finalized.
3. The `ShaderRuntime` iterates all entities bound to the invalidated shader and calls `applyShader()` again, which now resolves to the new cache entry.
4. The old base template's ref count drops to zero → scheduled for disposal after the grace period.
5. Per-instance clones are invalidated and re-cloned from the new base template.

**Critical rule:** the swap happens on the next `applyShader()` pass, NOT synchronously during `invalidate()`. This avoids mutating materials mid-frame. The sequence is:

```
Frame N:   Author edits graph → command increments revision → invalidate() marks dirty
Frame N+1: Render loop calls applyShader() for each entity → cache miss → recompile → 
           finalize new template → swap entities to new material → old template ref drops → 
           schedule disposal
Frame N+2: Old template disposed (if grace period is 0) or held briefly for undo
```

No entity ever renders with a half-swapped material. The swap is atomic per entity — either the old material or the new material, never a mix.

#### Undo/redo interaction

- **Undo** is just another command that mutates the document and changes the revision. The `ShaderRuntime` sees a different revision on the next `applyShader()` pass and resolves from cache (hit) or recompiles (miss).
- The `ShaderRuntime` does NOT subscribe to undo/redo events. It is stateless with respect to edit history — it only sees the current `revision` on the document.
- The shader graph editor calls `invalidate()` after both do and undo. The `ShaderRuntime` handles both cases identically.

### Resolution split: runtime-core vs web target

The shader pipeline has a strict split between what runtime-core decides and what the web target executes:

**runtime-core owns (pure data, no GPU):**
- Resolving the effective shader binding (three-tier override walk) during `resolveSceneObjects()`. The output is `effectiveShader: { shaderDefinitionId, parameters, targetKind } | null` on the `SceneObject`.
- Resolving the post-process shader chain from the environment definition. The output is `effectivePostProcessChain: PostProcessShaderBinding[]` on the resolved environment.
- Compiling `ShaderGraphDocument` → `ShaderIR` via the semantic compiler. This is a pure function.
- Validating target kind compatibility, type coercion, and graph structure.

**web target owns (GPU, Three.js, materials):**
- The `ShaderRuntime` — caching, finalization, material cloning, uniform updates, disposal.
- The `TSLFinalizer` — converting IR ops to TSL node graphs on actual `NodeMaterial` instances.
- Deciding when to call the compiler (cache miss logic).
- Applying finalized materials to Three.js meshes / billboard quads / render pipeline.
- The web host render loop calls `ShaderRuntime.applyShader()` with the right `ShaderApplyTarget`.

**The boundary contract:**
- runtime-core produces `ShaderIR` and `EffectiveShaderBinding` — pure data.
- web target consumes them and produces GPU state.
- runtime-core NEVER creates materials, textures, or uniform handles.
- web target NEVER resolves shader bindings from authored documents or validates graph structure.

This prevents duplicated policy: binding resolution is one place (runtime-core), material application is one place (web target/ShaderRuntime).

### Node registry validation rule

The `ShaderNodeDefinition` registry is the single enforcer of what constitutes a valid node configuration. Persisted `ShaderGraphDocument` data is validated against the registry at every boundary:

**What the registry enforces:**
- `ShaderNodeInstance.nodeType` must match a registered `ShaderNodeDefinition.nodeType`. Unknown node types are rejected.
- `ShaderNodeInstance.settings` must validate against the node definition's `ShaderSettingDefinition[]`. Every setting key must exist in the definition. Every value must match the setting's `dataType` and `constraints` (min/max/step/enumValues). Extra keys not in the definition are rejected.
- `ShaderEdge` connections must respect port types. Source port `dataType` must be compatible with target port `dataType` per the coercion rules. Edges to/from ports that don't exist on the node definition are rejected.
- Node target kind filtering: a node definition with `validTargetKinds: ["mesh-deform"]` cannot appear in a `mesh-surface` graph. The validator rejects it.

**When validation runs:**
1. **On command execution** — every `UpdateShaderNode`, `AddShaderEdge` command validates the proposed change against the registry BEFORE persisting. Invalid changes are rejected with a diagnostic. The authored document never contains invalid state.
2. **On document load** — when a `ShaderGraphDocument` is loaded from persistence, it is validated against the current registry. If the registry has evolved (a node type was removed, a setting constraint tightened), load-time validation emits warnings and the graph editor shows the invalid nodes with error markers. The document is still loaded — it is not silently corrupted — but it cannot compile until the author fixes the flagged nodes.
3. **On compilation** — the semantic compiler re-validates as a defense-in-depth check. This catches any edge case where a document was persisted before a registry update. Compilation fails with diagnostics if validation fails.

**What is NOT tolerated in persisted truth:**
- `settings: Record<string, unknown>` with arbitrary keys that don't match the node definition
- Setting values outside declared constraints (e.g. `strength: 999` when max is 2)
- Edges connecting ports that don't exist on the source or target node
- Node types not present in the registry

The `settings` field on `ShaderNodeInstance` is typed as `Record<string, unknown>` in the TypeScript interface for serialization flexibility, but the runtime meaning is: **every key must be a `settingId` from the node definition, and every value must pass the setting's type and constraint validation.** The registry is the schema; the document is the data.

### Shader binding ownership

Shader bindings follow a three-tier override model using the actual persisted domain types. Each tier can override the one above it. The runtime resolves the effective binding by walking the chain.

**Concrete types that gain shader fields:**

| Domain type | File | New field(s) | Persisted in |
|---|---|---|---|
| `AssetDefinition` | `packages/domain/src/content-library/index.ts` | `defaultShaderDefinitionId: string \| null` | Content library (game project) |
| `PlacedAssetInstance` | `packages/domain/src/region-authoring/index.ts` | `shaderOverride: { shaderDefinitionId: string } \| null`, `shaderParameterOverrides: ShaderParameterOverride[]` | `RegionDocument.scene.placedAssets[]` |
| `RegionNPCPresence` | `packages/domain/src/region-authoring/index.ts` | `shaderOverride: { shaderDefinitionId: string } \| null`, `shaderParameterOverrides: ShaderParameterOverride[]` | `RegionDocument.scene.npcPresences[]` |
| `RegionItemPresence` | `packages/domain/src/region-authoring/index.ts` | `shaderOverride: { shaderDefinitionId: string } \| null`, `shaderParameterOverrides: ShaderParameterOverride[]` | `RegionDocument.scene.itemPresences[]` |

`RegionPlayerPresence` does NOT get shader fields — the player mesh is engine-managed, not author-shaded.

```typescript
// Shared override shape, added to PlacedAssetInstance, RegionNPCPresence, RegionItemPresence:
interface ShaderParameterOverride {
  parameterId: string;
  value: number | number[] | string;  // must match the parameter's ShaderDataType
}
```

**Tier 1: Asset definition default** — `AssetDefinition.defaultShaderDefinitionId`. Applies to ALL placed instances of this asset. Set in the Asset Library workspace (Build mode). Example: "Oak Tree" asset definition → foliage wind shader.

**Tier 2: Placed-instance shader override** — `PlacedAssetInstance.shaderOverride` (or `RegionNPCPresence.shaderOverride`, `RegionItemPresence.shaderOverride`). Overrides the asset default for THIS specific placed instance. Set in the Layout workspace (Design mode) inspector. Example: a particular oak tree near a cave uses a "cave wind" shader.

**Tier 3: Placed-instance parameter overrides** — `PlacedAssetInstance.shaderParameterOverrides[]`. Overrides individual parameter values without changing the shader graph. Example: `windStrength: 0.05` on a sheltered courtyard tree.

**Resolution order at runtime (`resolveSceneObjects`):**

```
1. Read shaderDefinitionId from placed-instance .shaderOverride
   ↓ (if null)
2. Read shaderDefinitionId from AssetDefinition.defaultShaderDefinitionId
   ↓ (if null)
3. No shader applied — standard PBR material only

For parameters:
1. Start with ShaderGraphDocument.parameters[].defaultValue
2. Merge placed-instance .shaderParameterOverrides on top (shallow per-parameterId)
```

**Commands:**
- `SetAssetDefaultShader` — sets `AssetDefinition.defaultShaderDefinitionId`
- `SetPlacedAssetShaderOverride` — sets `PlacedAssetInstance.shaderOverride`
- `SetPlacedAssetShaderParameterOverride` — adds/updates/removes entries in `PlacedAssetInstance.shaderParameterOverrides`
- Equivalent commands for NPC and item presences

### Type system

#### ShaderDataType

Every port on every node has a `ShaderDataType`. This is the canonical type system for the entire pipeline — domain, compiler, IR, and finalizer all use the same type identifiers.

```typescript
type ShaderDataType =
  | "float"      // scalar
  | "vec2"       // 2-component vector
  | "vec3"       // 3-component vector (position, color RGB, direction)
  | "vec4"       // 4-component vector (color RGBA, quaternion)
  | "color"      // alias for vec3 in the IR, but renders a color picker in the editor
  | "texture2d"  // texture sampler reference (not a value — a binding)
  | "bool";      // boolean flag (for toggles, branch nodes)
```

`color` is semantically distinct from `vec3` in the editor (shows a color picker instead of 3 float fields) but compiles to `vec3` in the IR. The compiler treats them as interchangeable.

#### Compatibility and coercion rules

Edges connect an output port to an input port. The compiler validates type compatibility and applies implicit coercion where safe:

| Source type | Target type | Rule |
|---|---|---|
| `float` | `float` | Direct — no coercion |
| `float` | `vec2` | Splat — `float → vec2(f, f)` |
| `float` | `vec3` | Splat — `float → vec3(f, f, f)` |
| `float` | `vec4` | Splat — `float → vec4(f, f, f, f)` |
| `vec2` | `vec3` | **Error** — ambiguous (which component is zero?) |
| `vec3` | `vec4` | **Error** — ambiguous (what is w?) |
| `vec4` | `vec3` | Swizzle — `vec4 → vec4.xyz` (implicit truncation, compiler warning) |
| `vec3` | `vec2` | Swizzle — `vec3 → vec3.xy` (implicit truncation, compiler warning) |
| `vec3` | `color` | Direct — same underlying type |
| `color` | `vec3` | Direct — same underlying type |
| `texture2d` | anything else | **Error** — textures must go through a `TextureSample` node first |
| `bool` | `float` | Coerce — `true → 1.0`, `false → 0.0` |
| `float` | `bool` | **Error** — use a comparison node instead |
| any | `texture2d` | **Error** — texture ports only accept texture bindings |

**Rules:**
- Float-to-vector splatting is always safe and silent.
- Vector truncation (vec4→vec3, vec3→vec2) is allowed but emits a compiler warning — it may indicate a mistake.
- Widening vectors (vec2→vec3, vec3→vec4) is an error — use `CombineVector` node explicitly.
- Texture types never coerce to value types and vice versa.

#### Builtin catalog

Builtins are named values injected by the runtime, not authored by the user. They are available as input nodes in the graph and resolve to TSL builtins in the finalizer.

| Builtin name | ShaderDataType | TSL equivalent | Available in target kinds |
|---|---|---|---|
| `time` | `float` | `time` | all |
| `deltaTime` | `float` | `deltaTime` | all |
| `worldPosition` | `vec3` | `positionWorld` | mesh-surface, mesh-deform, billboard-surface |
| `localPosition` | `vec3` | `positionLocal` | mesh-surface, mesh-deform, billboard-surface |
| `worldNormal` | `vec3` | `normalWorld` | mesh-surface, mesh-deform |
| `localNormal` | `vec3` | `normalLocal` | mesh-surface, mesh-deform |
| `uv` | `vec2` | `uv()` | mesh-surface, mesh-deform, billboard-surface |
| `vertexColor` | `vec4` | `attribute("color")` | mesh-surface, mesh-deform |
| `cameraPosition` | `vec3` | `cameraPosition` | all |
| `viewDirection` | `vec3` | `positionViewDirection` | mesh-surface, mesh-deform, billboard-surface |
| `screenUV` | `vec2` | `screenUV` | post-process |
| `sceneColor` | `vec4` | scene pass output texture | post-process |
| `sceneDepth` | `float` | scene pass depth texture | post-process |

The compiler validates that a graph only references builtins available for its `targetKind`. Referencing `screenUV` in a `mesh-deform` graph is a compile error.

#### Node-setting schemas

Each node type in the `ShaderNodeDefinition` registry declares:
- **Input ports** — typed (`portId: string`, `dataType: ShaderDataType`, `optional: boolean`)
- **Output ports** — typed (`portId: string`, `dataType: ShaderDataType`)
- **Settings** — per-node authored configuration that is NOT a port connection. These are static values set in the node's inspector panel, not driven by edges.

```typescript
interface ShaderNodeDefinition {
  nodeType: string;                       // e.g. "math.sin", "effect.wind-sway"
  displayName: string;
  category: string;                       // e.g. "math", "input", "effect", "output"
  validTargetKinds: ShaderTargetKind[];   // which graph target kinds allow this node
  inputPorts: ShaderPortDefinition[];
  outputPorts: ShaderPortDefinition[];
  settings: ShaderSettingDefinition[];
}

interface ShaderPortDefinition {
  portId: string;
  displayName: string;
  dataType: ShaderDataType;
  optional: boolean;                      // optional inputs use a default value if unconnected
  defaultValue?: number | number[];       // default for optional unconnected inputs
}

interface ShaderSettingDefinition {
  settingId: string;
  displayName: string;
  dataType: "float" | "int" | "bool" | "enum" | "string";
  defaultValue: unknown;
  constraints?: {
    min?: number;
    max?: number;
    step?: number;
    enumValues?: string[];
  };
}
```

**Example: `effect.wind-sway` node definition:**

```typescript
{
  nodeType: "effect.wind-sway",
  displayName: "Wind Sway",
  category: "effect",
  validTargetKinds: ["mesh-deform"],
  inputPorts: [
    { portId: "position", displayName: "Position", dataType: "vec3", optional: true },
    { portId: "time", displayName: "Time", dataType: "float", optional: true },
    { portId: "mask", displayName: "Mask", dataType: "float", optional: true, defaultValue: 1.0 }
  ],
  outputPorts: [
    { portId: "displacement", displayName: "Displacement", dataType: "vec3" }
  ],
  settings: [
    { settingId: "strength", displayName: "Strength", dataType: "float", defaultValue: 0.3, constraints: { min: 0, max: 2, step: 0.05 } },
    { settingId: "frequency", displayName: "Frequency", dataType: "float", defaultValue: 1.6, constraints: { min: 0.1, max: 5, step: 0.1 } },
    { settingId: "spatialScale", displayName: "Spatial Scale", dataType: "float", defaultValue: 0.35, constraints: { min: 0.01, max: 2, step: 0.05 } }
  ]
}
```

Settings are serialized in the `ShaderNodeInstance.settings` record. They are constant at compile time — the compiler inlines them as literals in the IR. Parameters (from `ShaderParameter`) are different: they are uniforms that can change at runtime.

### Node categories (v1)

**Input nodes:**
- `Time` — elapsed time for animation
- `WorldPosition` — vertex world position
- `LocalPosition` — vertex local position
- `UV` — texture coordinates
- `VertexColor` — vertex COLOR_0 attribute
- `CameraPosition` — camera world position
- `TextureSample` — sample a texture (albedo, normal, height, custom) at UV
- `Parameter` — authored float/vec2/vec3/vec4/color parameter exposed to the inspector

**Math nodes:**
- `Add`, `Subtract`, `Multiply`, `Divide`
- `Sin`, `Cos`, `Pow`, `Sqrt`, `Abs`, `Clamp`, `Lerp`
- `Dot`, `Cross`, `Normalize`, `Length`
- `SplitVector` (vec3 → x, y, z), `CombineVector` (x, y, z → vec3)

**Effect nodes:**
- `VertexDisplacement` — offset vertex position (wind, wave, breathe)
- `HeightDisplacement` — read height map, displace along normal
- `FresnelEffect` — view-angle-dependent rim glow
- `Dissolve` — alpha cutoff driven by noise + threshold
- `WindSway` — high-level wind node (wraps sin-based sway with frequency, amplitude, phase)

**Output nodes:**
- `VertexOutput` — final vertex position modification
- `FragmentOutput` — final fragment color/alpha modification
- `EmissiveOutput` — emissive contribution

### Shader definition domain model

```typescript
type ShaderTargetKind = "mesh-surface" | "mesh-deform" | "post-process" | "billboard-surface";

interface ShaderGraphDocument {
  shaderDefinitionId: string;
  displayName: string;
  targetKind: ShaderTargetKind;
  nodes: ShaderNodeInstance[];
  edges: ShaderEdge[];
  parameters: ShaderParameter[];
  metadata: Record<string, unknown>;
}

interface ShaderNodeInstance {
  nodeId: string;
  nodeType: string;  // e.g. "math.sin", "input.time", "effect.wind-sway"
  position: { x: number; y: number };  // graph editor position
  settings: Record<string, unknown>;  // node-specific authored settings
}

interface ShaderEdge {
  edgeId: string;
  sourceNodeId: string;
  sourcePortId: string;
  targetNodeId: string;
  targetPortId: string;
}

interface ShaderParameter {
  parameterId: string;
  displayName: string;
  dataType: "float" | "vec2" | "vec3" | "vec4" | "color" | "texture";
  defaultValue: unknown;
}
```

### Shader IR (intermediate representation)

The IR is the output of the semantic compiler. It is platform-agnostic — no Three.js types, no TSL references. The finalizer reads it and produces TSL.

```typescript
interface ShaderIR {
  shaderDefinitionId: string;
  targetKind: ShaderTargetKind;
  vertexOps: ShaderIROp[];      // ordered vertex operations (mesh-deform only)
  fragmentOps: ShaderIROp[];    // ordered fragment operations (mesh-surface, billboard-surface)
  postProcessOps: ShaderIROp[]; // ordered post-process operations (post-process only)
  parameters: ShaderIRParameter[];
  textureSlots: ShaderIRTextureSlot[];
  diagnostics: ShaderIRDiagnostic[];
}

interface ShaderIROp {
  opId: string;
  opKind: string;  // e.g. "sin", "multiply", "sample-texture", "displace-vertex"
  inputs: Record<string, ShaderIRValue>;
  output: ShaderIRValue;
}

type ShaderIRValue =
  | { kind: "literal"; dataType: string; value: number | number[] }
  | { kind: "reference"; opId: string; portId: string }
  | { kind: "builtin"; name: string }  // e.g. "time", "worldPosition", "uv"
  | { kind: "parameter"; parameterId: string }
  | { kind: "texture-sample"; slotId: string; uvRef: ShaderIRValue };
```

---

## Stories

### Story 29.1 — ShaderGraphDocument domain model

**Tasks:**

1. Define `ShaderGraphDocument`, `ShaderNodeInstance`, `ShaderEdge`, `ShaderParameter` in `packages/domain/src/shader-graph/`.
2. Define `ShaderNodeDefinition` registry — a static catalog of available node types with their port signatures (input ports, output ports, data types). This is the node palette.
3. Define serialization/deserialization for shader graph documents (JSON).
4. Add `shaderDefinitionId` binding to `ContentDefinitionKind` and the content library.
5. Commands: `CreateShaderGraph`, `UpdateShaderNode`, `AddShaderEdge`, `RemoveShaderEdge`, `UpdateShaderParameter`.
6. Add `defaultShaderDefinitionId: string | null` to `AssetDefinition`.
7. Add `shaderOverride: { shaderDefinitionId: string } | null` and `shaderParameterOverrides: ShaderParameterOverride[]` to `RegionScenePresence`.
8. Commands: `SetAssetDefaultShader`, `SetInstanceShaderOverride`, `SetInstanceShaderParameterOverride`.

**Acceptance:**

- Shader graph documents can be created, serialized, and deserialized.
- Node definition registry lists all v1 node types with typed ports.
- Asset definitions can declare a default shader.
- Placed instances can override the shader and/or individual parameters.
- Domain types have zero runtime-core or Three.js dependencies.
- Unit tests verify serialization round-trip, graph validation, and binding resolution.

---

### Story 29.2 — ShaderSemanticCompiler (runtime-core)

**Tasks:**

1. Create `packages/runtime-core/src/shader/compiler.ts`.
2. Implement `compileShaderGraph(document: ShaderGraphDocument): ShaderIR`.
3. Validation: detect cycles, type mismatches, disconnected outputs, missing required inputs.
4. Topological sort: order operations so each op's inputs are computed before the op runs.
5. Normalization: canonicalize redundant subgraphs, constant-fold literal-only branches.
6. Emit `ShaderIRDiagnostic` warnings/errors for validation failures.
7. The compiler is a pure function — no Three.js, no DOM, no side effects.

**Acceptance:**

- Compiles a valid shader graph to IR.
- Rejects cyclic graphs with a diagnostic.
- Rejects type mismatches (e.g. float → vec3 port) with a diagnostic.
- Topological order is correct — no op references an uncomputed input.
- Constant folding reduces `Multiply(2.0, 3.0)` to `Literal(6.0)`.
- Unit tests cover: valid graphs, cycles, type errors, constant folding, disconnected nodes.

---

### Story 29.3 — ShaderIR type definitions and contract

**Tasks:**

1. Define `ShaderIR`, `ShaderIROp`, `ShaderIRValue`, `ShaderIRParameter`, `ShaderIRTextureSlot`, `ShaderIRDiagnostic` in `packages/runtime-core/src/shader/ir.ts`.
2. These are the contract types between the compiler and the finalizer. The compiler writes them, the finalizer reads them.
3. Include a `validate(ir: ShaderIR): ShaderIRDiagnostic[]` function that the finalizer can call before attempting finalization — defensive layer.
4. No Three.js dependencies. Pure TypeScript interfaces.

**Acceptance:**

- IR types are importable from runtime-core without pulling in Three.js.
- Validation catches malformed IR (missing op references, unknown builtins).
- Contract is documented with JSDoc on every interface and field.

---

### Story 29.4 — Target-specific TSL finalizers (web target)

The compiler is shared. The finalizers are NOT. Each target kind gets its own concrete finalizer function — not a generic base class, not a polymorphic interface. The targets have genuinely different capabilities, material types, and application semantics. Hiding those differences behind an abstraction would create a leaky generalization that makes every target harder to debug.

**Finalizer files:**

| Target kind | File | Entry function | Receives | Applies to |
|---|---|---|---|---|
| `mesh-surface` | `targets/web/src/shader/finalize-mesh-surface.ts` | `finalizeMeshSurface(ir, material)` | `ShaderIR`, `MeshStandardNodeMaterial` | `material.colorNode`, `material.emissiveNode`, `material.opacityNode` |
| `mesh-deform` | `targets/web/src/shader/finalize-mesh-deform.ts` | `finalizeMeshDeform(ir, material)` | `ShaderIR`, `MeshStandardNodeMaterial` | `material.positionNode`, `material.normalNode` |
| `billboard-surface` | `targets/web/src/shader/finalize-billboard.ts` | `finalizeBillboard(ir, material)` | `ShaderIR`, `MeshBasicNodeMaterial` | `material.colorNode`, `material.opacityNode`, `material.positionNode` |
| `post-process` | `targets/web/src/shader/finalize-post-process.ts` | `finalizePostProcess(ir, pipeline)` | `ShaderIR`, `RenderPipeline` | `pipeline.outputNode` composition |

Each finalizer is a standalone function. They may share low-level TSL helpers (e.g. `buildTSLOpNode(op)` that maps `"sin"` → `sin(input)`) via a shared `targets/web/src/shader/tsl-ops.ts` utility, but the top-level application logic is per-target.

**Why separate files, not one generic finalizer:**

- `MeshStandardNodeMaterial` has `colorNode`, `emissiveNode`, `normalNode`, `positionNode`, `roughnessNode`, `metalnessNode`. Mesh surface shaders may write any of these.
- `MeshBasicNodeMaterial` has `colorNode`, `opacityNode`, `positionNode` but NOT `emissiveNode`, `normalNode`, `roughnessNode`. A generic finalizer that tries to set `material.emissiveNode` on a billboard material would silently fail or crash.
- `RenderPipeline` has no material at all — it composes TSL node chains onto `outputNode`. The "apply" semantics are fundamentally different (chaining passes vs setting material properties).
- Debugging: when a mesh shader looks wrong, you look in `finalize-mesh-surface.ts`. When a billboard shader looks wrong, you look in `finalize-billboard.ts`. No indirection, no base class dispatch to trace through.

**Shared TSL op builder:**

```typescript
// targets/web/src/shader/tsl-ops.ts
// Maps IR ops to TSL nodes. Used by all finalizers.
function buildTSLNode(op: ShaderIROp, resolvedInputs: Map<string, TSLNode>): TSLNode {
  switch (op.opKind) {
    case "sin": return sin(resolvedInputs.get("input")!);
    case "multiply": return resolvedInputs.get("a")!.mul(resolvedInputs.get("b")!);
    case "sample-texture": return texture(resolvedTexture, resolvedUV);
    // ... etc
  }
}
```

This is a pure mapping function — it does not know what material type it's building for. Each finalizer walks its own IR op list (`vertexOps`, `fragmentOps`, or `postProcessOps`), calls `buildTSLNode()` for each op, then applies the result to the target-specific output slot.

**Tasks:**

1. Create `targets/web/src/shader/tsl-ops.ts` — shared IR op → TSL node mapper.
2. Create `targets/web/src/shader/finalize-mesh-surface.ts` — walks `ir.fragmentOps`, builds TSL graph, assigns to `MeshStandardNodeMaterial` fragment slots.
3. Create `targets/web/src/shader/finalize-mesh-deform.ts` — walks `ir.vertexOps`, builds TSL graph, assigns to `MeshStandardNodeMaterial.positionNode`.
4. Create `targets/web/src/shader/finalize-billboard.ts` — walks `ir.fragmentOps` + `ir.vertexOps`, builds TSL graph, assigns to `MeshBasicNodeMaterial` slots. Validates that no `MeshStandardNodeMaterial`-only slots are referenced.
5. Create `targets/web/src/shader/finalize-post-process.ts` — walks `ir.postProcessOps`, builds TSL chain, composes onto `RenderPipeline.outputNode`.
6. Each finalizer: receives the compiled IR and the target object, applies nodes, returns uniform handles for parameter updates. Owns no lifecycle — the `ShaderRuntime` owns lifecycle.
7. Error handling: if an IR op is unsupported by a finalizer, log a warning with the op kind and target kind, skip it (graceful degradation).

**Acceptance:**

- Mesh surface finalizer correctly assigns `colorNode`, `emissiveNode`, `opacityNode`.
- Mesh deform finalizer correctly assigns `positionNode`. Wind sway IR produces the same result as the hardcoded billboard wind.
- Billboard finalizer rejects `emissiveNode`/`normalNode` ops with a warning.
- Post-process finalizer composes multiple passes in sequence on `outputNode`.
- Shared `tsl-ops.ts` is unit-testable independently of any material type.
- Each finalizer is debuggable in isolation — no shared base class dispatch.

---

### Story 29.5 — ShaderRuntime: single runtime enforcer (web target)

#### Material sharing vs per-instance parameter overrides

The `ShaderRuntime` caches at two levels, and per-instance parameters live at a third:

**Level 1: IR cache** — keyed by `shaderDefinitionId + revision + profile`. Pure data, shared by everything using the same shader graph version. Cheap to cache, never cloned.

**Level 2: Base material template** — one finalized `MeshStandardNodeMaterial` per unique `shaderDefinitionId + revision + profile`. The TSL finalizer builds the node graph (positionNode, colorNode, etc.) on this template. This template is NEVER assigned directly to a mesh. It is the blueprint.

**Level 3: Per-instance material instance** — when `applyShader()` is called for an entity, the `ShaderRuntime` determines whether the entity has parameter overrides:
- **No overrides** → the entity shares the base material template directly. 10 oak trees with identical parameters share 1 material instance. This is the common case and the performance win.
- **Has overrides** → the `ShaderRuntime` clones the base template (`material.clone()`) and applies the overrides as uniform values on the clone. This entity gets its own material instance. The clone shares the compiled shader program (GPU-side) — only the uniform buffer differs. So 10 oak trees with 2 having custom `windStrength` = 1 shared material + 2 cloned materials = 3 material instances, not 10.

**Cache key for per-instance materials:** `shaderDefinitionId + revision + profile + sorted(parameterOverrides)`. If two instances have the exact same override set, they share the same clone. This prevents pathological cases where 100 instances with `windStrength: 0.05` each get 100 clones — they share 1 clone.

**Uniform update path:** `updateParameter()` on the `ShaderRuntime` takes a `shaderDefinitionId + parameterId + value`. It updates:
1. The base template's uniform (affects all entities with no overrides)
2. All per-instance clones that don't override that specific parameter (they inherit from the template)
3. Does NOT touch clones that have their own override for that parameter

**Disposal:** Ref-counting applies to both the base template and per-instance clones. When an entity is removed, its material ref is released. Clones with zero refs are disposed after the grace period. The base template is disposed only when all entities (shared + cloned) are gone.

**Tasks:**

1. Create `targets/web/src/shader/ShaderRuntime.ts`.
2. Implement the `ShaderRuntime` interface as defined in the architecture section.
3. IR compile cache: `Map<string, ShaderIR>` keyed by `${shaderDefinitionId}:${revision}:${profile}`.
4. Base material template cache: `Map<string, BaseMaterialEntry>` keyed by `${shaderDefinitionId}:${revision}:${profile}`. Each entry holds the finalized material template, ref count, and disposal timer.
5. Per-instance material cache: `Map<string, ClonedMaterialEntry>` keyed by `${shaderDefinitionId}:${revision}:${profile}:${overrideHash}`. Entries that share the same override hash share the same clone.
6. `applyShader(entity, material, binding)`:
   - Check IR cache → compile if miss
   - Check base template cache → finalize if miss
   - If binding has no parameter overrides → assign base template to entity, increment base ref count
   - If binding has overrides → compute override hash → check clone cache → clone if miss → apply override uniforms → assign clone to entity, increment clone ref count
7. `updateParameter()`: update base template uniform + propagate to non-overriding clones. No recompilation.
8. `invalidate()`: remove all cache entries (IR, base templates, clones) for the given `shaderDefinitionId`, triggering recompilation on next `applyShader()` call.
9. `setCompileProfile()`: flush all caches, store new profile.
10. Ref-counting and disposal: separate ref counts for base templates and clones. Grace period on both. Full flush on `dispose()`.
11. `getDiagnostics()`: return diagnostics from the most recent compilation of the given shader.
12. Instantiated once in the web host at session start. Destroyed at session end.

**Acceptance:**

- 10 oak trees with the same shader and no parameter overrides share 1 material instance.
- 10 oak trees where 2 have `windStrength: 0.05` override = 1 base + 1 clone = 2 material instances, not 10.
- 2 oak trees with identical override sets share the same clone (override hash match).
- Parameter tweaks in the inspector update immediately without recompilation.
- `invalidate()` after a graph edit triggers recompilation on the next frame.
- Profile change flushes caches and recompiles with new profile.
- Ref-counted disposal prevents texture/material leaks.
- No other system compiles, caches, or disposes shader resources.

---

### Story 29.6 — Shader binding on scene objects

**Tasks:**

1. `resolveSceneObjects()` resolves the effective shader binding for each scene object using the three-tier ownership model:
   - Tier 1: `assetDefinition.defaultShaderDefinitionId`
   - Tier 2: `presence.shaderOverride.shaderDefinitionId`
   - Tier 3: `presence.shaderParameterOverrides` merged onto default parameters
2. The resolved binding is written onto the `SceneObject` as `effectiveShader: { shaderDefinitionId: string; parameters: Record<string, unknown> } | null`.
3. When a scene object has an effective shader binding, the web host:
   - Loads the shader graph document from the content library
   - Compiles it via the semantic compiler
   - Finalizes it onto the object's material via the TSL finalizer
   - Applies parameter overrides as uniform values
4. Shader compilation is cached per `shaderDefinitionId + revision`. Recompile only when the graph changes. Parameter-only changes update uniforms without recompilation.
5. The compile profile (authoring-preview vs runtime-preview vs published) determines which optimizations and debug hooks are included.

**Acceptance:**

- Asset default shader applies to all instances unless overridden.
- Instance-level shader override replaces the asset default.
- Instance-level parameter overrides modify uniform values without recompilation.
- Changing the shader graph in the editor triggers recompilation and live update in Preview.
- Cache prevents recompilation on every frame.

---

### Story 29.7 — MVP foliage wind shader

#### Engine-owned helper nodes

The raw math for foliage wind (sin wave + spatial frequency + height falloff + vertex color mask) is 8-10 nodes when built from primitives. That's fine for a shader engineer, but awkward for an author who just wants "this tree sways in the wind." The node registry should include **engine-owned high-level helper nodes** that encapsulate common patterns:

| Helper node | Category | What it encapsulates | Exposed settings |
|---|---|---|---|
| `effect.wind-sway` | effect | Sin-based sway with spatial frequency, height falloff, and mask input | `strength`, `frequency`, `spatialScale` |
| `effect.wind-gust` | effect | Intermittent gust bursts layered on top of base sway | `gustStrength`, `gustInterval`, `gustDuration` |
| `effect.height-falloff` | effect | Normalizes local Y position to [0,1] for height-based masking | `baseHeight`, `topHeight` |
| `input.vertex-wind-mask` | input | Reads vertex color channel commonly used as a wind paint mask from Blender | `channel` (R/G/B/A) |

These are first-class nodes in the registry — not macros, not subgraphs. They compile to multiple IR ops internally (the compiler expands them), but the author sees one node with clear settings. This is the same pattern as Unreal's Material Functions or Unity's Sub Graphs, but simpler: they're just built-in node types that the compiler knows how to expand.

**Convention:** engine-owned helper nodes use the `effect.*` and `input.*` namespace prefixes. Authors cannot create nodes in these namespaces. Future helpers (water ripple, dissolve, snow accumulation) follow the same pattern — add to the registry, implement the compiler expansion, ship as a built-in.

The default foliage wind graph uses the helper nodes, not raw math:

```
[Time] ──→ [effect.wind-sway (strength=0.3, frequency=1.6)] ──→ [VertexOutput]
                    ↑
[input.vertex-wind-mask (channel=R)] ──→ mask port
```

Three nodes, not ten. An author can open the graph and tweak `strength` and `frequency` without understanding sin waves.

**Tasks:**

1. Register the `effect.wind-sway`, `effect.wind-gust`, `effect.height-falloff`, and `input.vertex-wind-mask` helper nodes in the node definition registry.
2. Implement compiler expansion for each helper node: the semantic compiler expands `effect.wind-sway` into the equivalent IR ops (sin, multiply, add, displace-vertex) during compilation. The expansion is deterministic and tested.
3. Create a default "Foliage Wind" shader graph document that ships with Sugarmagic, using the helper nodes.
4. Graph structure:
   - Input: `Time`, `input.vertex-wind-mask`
   - Effect: `effect.wind-sway` (strength=0.3, frequency=1.6, spatialScale=0.35)
   - Output: `VertexOutput`
   - Parameter: `windStrength` (float, default 0.3), `windFrequency` (float, default 1.6), `windDirection` (vec2, default [1, 0])
5. Apply this shader to foliage scene objects by default when no custom shader is assigned.
6. Remove the hardcoded billboard wind sway and replace with the shader graph version.
7. Parameters are tunable in the inspector per foliage asset.

**Acceptance:**

- Foliage meshes sway in the wind using the authored shader graph, not hardcoded TSL.
- The default foliage graph uses helper nodes (3 nodes), not raw math (10+ nodes).
- An author can open the graph, see `effect.wind-sway`, and adjust strength/frequency without understanding the underlying math.
- Helper node expansion produces IR that is identical in behavior to the hand-built equivalent.
- Wind parameters (strength, frequency, direction) are adjustable in the Studio inspector.
- Vertex color wind mask from Blender modulates sway per-vertex.
- Billboard wind sway is removed — all wind goes through the shader graph.

---

### Story 29.8 — Shader graph editor UI (authoring)

The shader graph editor lives under the **Render** top-level tab in Studio as its own workspace, alongside Environment and any future render-related workspaces. The layout is inspired by the Sugarbuilder `MaterialEditor` (three-column grid: list + canvas + properties/preview).

**Layout:**

```
┌─ Render ─────────────────────────────────────────────────┐
│  Shaders ▾   Environments ▾                              │
├──────────────┬─────────────────────────┬─────────────────┤
│ Shader List  │   Graph Canvas          │  Properties     │
│              │                         │                 │
│ ▸ Foliage    │   [Time]──→[WindSway]──→│  ┌───────────┐  │
│   Wind       │         ↑               │  │ Preview   │  │
│ ▸ Water      │   [VertexMask]──────────│  │  (mesh)   │  │
│   Ripple     │                         │  └───────────┘  │
│ ▸ Dissolve   │                         │  Wind Sway      │
│              │                         │  ─────────────  │
│ + New Shader │                         │  Strength: 0.3  │
│              │                         │  Frequency: 1.6 │
│              │                         │  Spatial:  0.35 │
├──────────────┴─────────────────────────┴─────────────────┤
│  Diagnostics: ✓ 0 errors, 0 warnings                    │
└──────────────────────────────────────────────────────────┘
```

- **Left panel:** Shader definition list (all `ShaderGraphDocument`s in the content library). Create/delete/rename. Grouped or flat.
- **Center panel:** The graph canvas. Nodes are draggable, ports snap to edges, edge wires follow curves. This is the heart of the editor — same interaction model as Sugarbuilder's `MaterialEditorCanvas`.
- **Right panel (top):** Live 3D preview showing the shader applied to a configurable preview mesh (sphere, plane, or the actual foliage asset). Updates on every graph edit (debounced). Uses the authoring-preview compile profile.
- **Right panel (bottom):** Node properties inspector. When a node is selected, shows its settings (sliders, color pickers, dropdowns per the `ShaderSettingDefinition` schema). When no node is selected, shows the shader's global parameters.
- **Bottom bar:** Diagnostics strip — inline compiler warnings/errors with node links.

**Tasks:**

1. Register a "Shader Graph" workspace under the Render tab in Studio.
2. Implement the three-column layout: shader list, graph canvas, properties + preview.
3. Graph canvas:
   - Draggable nodes with typed port connectors
   - Port-to-port edge creation via drag
   - Typed port colors: `float` = grey, `vec2` = teal, `vec3` = purple, `vec4` = pink, `color` = orange, `texture2d` = blue, `bool` = green
   - Node palette: filterable by category, respects `validTargetKinds` for the current graph's `targetKind`
   - Helper nodes (`effect.wind-sway`, etc.) appear as single compact nodes, not expanded subgraphs
4. Properties panel: reads `ShaderSettingDefinition` schemas from the node registry, renders typed editors (float slider with min/max, color picker, enum dropdown, etc.)
5. Preview panel: renders a 3D mesh with the compiled shader applied. Mesh is configurable (sphere, plane, custom asset). Compiles JIT on every edit (debounced 200ms) using the authoring-preview profile.
6. All mutations dispatch through the domain command system — undo/redo compatible.
7. The editor reads the `ShaderNodeDefinition` registry for the node palette.
8. Diagnostics strip shows compiler warnings/errors. Clicking an error highlights the offending node in the canvas.

**Acceptance:**

- Authors can visually create a shader graph by dragging nodes and connecting ports.
- Type mismatches are shown as red ports / error indicators.
- The node palette only shows nodes valid for the current graph's `targetKind`.
- Helper nodes appear as single compact nodes with settings in the properties panel.
- Live preview updates within 200ms of graph edit.
- Undo/redo works for all graph operations.
- The workspace lives under the Render tab.

---

### Story 29.9 — Compile profile integration and diagnostics

**Tasks:**

1. The semantic compiler accepts a `compileProfile: RuntimeCompileProfile` parameter.
2. Authoring-preview profile: include debug diagnostic nodes, allow inspection hooks, skip optimization.
3. Runtime-preview profile: standard compilation, no debug nodes.
4. Published-target profile: full constant folding, dead-op elimination, shader warmup hints.
5. Diagnostics panel in the shader graph editor shows compiler warnings/errors inline on the graph.
6. Debug overlay in Preview: when the debug HUD is open, shader compilation stats (compile time, op count, parameter count) are visible via a `debug.hudCard` contribution.

**Acceptance:**

- Authoring-preview compiles include debug inspection hooks.
- Published-target compiles produce smaller IR with constant folding.
- Compiler diagnostics render inline on the graph nodes that caused them.
- Debug HUD shows shader compilation stats in Preview.

---

## QA gates

- [ ] Shader graph documents serialize/deserialize without loss.
- [ ] Semantic compiler detects cycles, type mismatches, and disconnected outputs.
- [ ] Compiler has zero Three.js imports — fully testable without GPU.
- [ ] TSL finalizer produces visually correct output matching the hardcoded implementations.
- [ ] Foliage wind shader works on 3D meshes (not just billboards).
- [ ] Shader parameters are tunable at runtime without recompilation.
- [ ] Compile profiles produce different output (debug hooks in authoring, optimized in published).
- [ ] Live preview in the shader graph editor updates within 200ms of graph edit.
- [ ] Cache prevents recompilation when shader graph hasn't changed.
- [ ] All existing tests pass — no regressions.
- [ ] Zero domain→compiler or compiler→finalizer reverse dependencies.

## Relationship to other plans

- **Proposal 009** — this epic implements the shader half of the material compilation architecture.
- **Plan 028 (Foliage)** — paused pending this epic. Story 29.6 delivers the foliage wind shader that unblocks 028.
- **Plan 026 (Billboard)** — the billboard wind sway is replaced by the shader graph version in Story 29.6.
- **Future material loading epic** — PBR texture set loading (Substance exports) is a separate, simpler concern. The shader graph can read PBR maps via `TextureSample` nodes.
- **Future post-processing epic** — the shader graph could be extended to author post-processing chains, replacing the hardcoded bloom setup.
