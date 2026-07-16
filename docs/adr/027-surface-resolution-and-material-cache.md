# ADR 027: Surface Resolution and Material-Cache Semantics

Status: accepted
Date: 2026-07-14

Extends ADR 026 (Surface Painting Model) and ADR 013 (Surface as Layer
Stack). Written after a deliberate "is this the right data model?"
review once the paint-the-world use case had stabilized. The review
compared our model to Substance Painter (our role model -- a simpler
one) and read the actual render + cache code rather than reasoning from
memory. Conclusion: the data model is sound; do not rewrite. This ADR
records the sub-decisions that review settled, and corrects one perf
claim that a closer code read disproved.

## Context

The model (ADR 026): a material slot binds one `Surface`; a `Surface`
is a stack of `Layer`s; each layer has a `Mask` and a blend; a
`SurfaceDefinition` is a reusable library surface; an appearance layer
may be a *surface-ref* (`AppearanceContent` kind `"surface"`) embedding
another library surface, composited and masked, recursively.

Verified relationships (code, not memory):
- `SurfaceSlot.surface: SurfaceBinding | null` -- slot to surface is
  **1:1** (or none), not 1:many (`domain/src/surface/index.ts`).
- `SurfaceBinding` = inline `Surface` OR reference to one
  `SurfaceDefinition`.
- `Surface.layers: Layer[]` -- the surface *is* the stack, of **layers**
  (not surfaces). A "stack of surfaces" exists only as stacked
  surface-ref *layers* inside the one surface.

Substance parallels: material slot ~= texture set; layer stack + mask +
blend ~= identical; `SurfaceDefinition` ~= Smart Material. The one thing
Substance has no concept of is **scatter** (foliage geometry) -- we
fused geometry-scatter into the same masked layer stack so "paint a
mask -> grass appears" is one gesture. That fusion is the product's
signature feature and stays.

## Decisions

### 1. Painted/texture masks require per-instance materials -- keep mask identity in the material signature

The material cache key (`ShaderRuntime.surfaceStackSignature`) includes
each layer's full `mask`, which for a painted mask includes its
`maskTextureId`. It is tempting to read this as fragmentation ("50
painted rocks compile 50 shaders") and to "fix" it by excluding the
mask id so instances share a material. **That is wrong and must not be
done.**

The mask texture is baked into the material's node graph
(`evaluateLayerMask` -> `texture(resolvedTexture, uvNode)` ->
`applyNodeSetToMaterial`). A three.js `NodeMaterial` binds specific
textures; a material shared across meshes binds its textures once, so
two instances with different painted masks *cannot* share one material
object -- sharing would show one mask on both. Excluding the id from the
key aliases masks. The id belongs in the key.

The real performance picture:
- The renderer (three WebGPU) caches render **pipelines** by generated
  shader code. Structurally-identical materials -- same graph, different
  bound textures -- share the compiled GPU pipeline. Painted instances
  do **not** each pay a shader compile.
- The per-painted-instance cost is therefore JS node-graph construction
  + material objects + bind groups (setup + memory), not runtime GPU
  shader cost. This is inherent to per-instance coverage and acceptable
  at the hundreds scale (r8 512x512 masks ~= 256KB each).
- Instances that share a surface **without** painting (a pure library
  reference, or identical procedural masks) already share one material
  -- the flyweight of ADR 026 decision 2 holds for the un-painted case.

If profiling ever shows JS/memory pressure from many painted instances,
the lever is a shared node-graph + per-instance texture binding
(texture array/atlas + per-instance index), NOT a signature change.
Deferred until measured.

Procedural masks (perlin/voronoi/height/fresnel/gradient) genuinely
alter the shader graph and correctly stay in the signature.

### 2. Surface-ref resolves asymmetrically; centralize the scatter collector

A surface-ref layer means two different things to the two realization
paths, and this asymmetry is intentional:
- **Shading**: the referenced surface is composited as a *masked unit*
  -- its stack blends to one result, then that result blends onto the
  accumulator under the surface-ref layer's own blend + mask. This is a
  recursive node-set composite (`evaluateLayerStackToNodeSet`), and it
  is correct as-is.
- **Scatter**: nested scatter layers are *flattened* out of the
  referenced surface and realized as geometry, each gated by the
  surface-ref layer's mask combined with its own.

Because these are different treatments, a single "flatten the tree"
pass cannot serve both, and every render path that composites a surface
must *separately* remember to also realize its scatter. That asymmetry
is exactly what produced the recurring "forgot scatter" bugs
(surface-ref shaded but grew no grass; the Studio shows the surface but
no blades).

Decision: the **scatter-contribution collection** is the shared piece
and must live in one place -- a single resolver over a
`ResolvedSurfaceStack` that returns the flattened, mask-combined scatter
layers, consumed by *every* scatter build site (asset scatter now;
landscape and the Surface Studio when they need it). No render path may
re-implement surface-ref scatter flattening inline. The shading
composite legitimately stays its own recursion.

### 3. Scatter stays a Layer kind; the realization split is managed, not merged

Keep the unified user model (one masked layer stack; a layer is
appearance / scatter / emission). Do not split `Surface` into a
texturing-surface plus a scatter-set -- the fusion is the feature.
Manage the appearance-vs-scatter realization split via decision 2, not
by changing the data model.

### 4. Link over copy (surface-ref) -- validated; inline masked groups deferred

Substance drops a Smart Material as an editable *copy*. We *link*
(surface-ref is a live reference; per-instance cost is only the mask).
For a game with many instances of one surface, link is better -- one
source, edits propagate, minimal per-instance data. Keep it. The gap
vs Substance is an inline masked **group/folder** (mask several layers
together without them being a library reference); surface-ref only
covers the library-reference case. Deferred -- add only when a real
authoring need appears.

### 5. Mask-as-a-small-stack is the accepted future lever, not built now

A Substance mask is itself a small stack (a painted layer plus
procedural generators). Ours is a single `Mask` kind per layer, so
"procedural base coverage + hand-painted touch-ups on the same layer"
is impossible. This is the most user-visible Substance capability we
lack and the one that most serves the "simple style with touches of
hand-placed detail" goal. It is the accepted direction when layered
masks are actually needed; not built now (it widens the mask type and
every mask evaluator).

### 6. Explicitly NOT adopting a fixed PBR channel set

Substance composites into fixed channels (baseColor / roughness /
metal / normal / height / AO / emissive). For a stylized painterly
game, our appearance-content + material/shader path already carries the
PBR data a layer needs; a formal channel model is high cost for little
stylistic gain. Not adopted.

## Consequences

- The material cache stays keyed by full mask identity. Reviewers must
  not "optimize" it by dropping painted-mask ids.
- Scatter-contribution resolution is centralized (one resolver over the
  resolved stack); asset scatter consumes it, and the Studio/landscape
  adopt it rather than re-flattening surface-refs.
- Performance work on painted instances, if ever needed, targets
  per-instance texture binding, not the signature.
- Mask stacking and inline masked groups are named future levers with
  no implementation debt today.

## Builds on

- ADR 013 (surface as layer stack) and ADR 026 (surface painting model,
  the shared-what / per-instance-where decomposition).
- ADR 008 (material semantics and compile profiles -- the cache these
  decisions describe).
- ADR 025 (color semantics the mask sampling and surface bake obey).
- Plan 068 (the epic this review fell out of).
