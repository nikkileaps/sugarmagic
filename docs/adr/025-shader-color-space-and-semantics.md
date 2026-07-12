# ADR 025: Shader Color Space and Semantics Rules

Status: accepted
Date: 2026-07-11

## Context

A half-day debugging spiral during card-foliage look-dev traced a
recurring "pale grass" symptom to four independent bugs that all
share one shape: a color value silently changing meaning as it
crosses a boundary (color space, type coercion, shader stage, or
texture kind). Each bug passed typecheck and the full unit suite,
because this class is semantic -- the numbers stay valid, they just
mean something different on the other side. These rules are settled;
new shader/rendering code must follow them.

## Decisions

### 1. Two color spaces, two named conversion chokepoints

Authored values (swatch hexes, color parameters, artistic color
ops) are sRGB. The render pipeline is linear. Conversion happens at
exactly two places and nowhere else:

- **Parameter materialization** (`uniformForParameter`,
  `render-web/src/ShaderRuntime.ts`): color parameter values convert
  sRGB -> linear when they become TSL literals. Parameters declared
  `colorSpace: "hdr"` opt out -- they are linear multipliers / math
  terms, not authored colors.
- **The sRGB color-op dispatcher** (`SRGB_SPACE_COLOR_OPS`,
  `render-web/src/materialize/math.ts`): artistic ops (hue,
  saturation, value -- anything a person tunes with art-tool
  intuition) are registered as pure sRGB-space builders. The
  dispatcher owns the linear -> sRGB -> op -> linear round-trip; an
  op registered there cannot forget it. Space-agnostic arithmetic
  (multiply, add, luminance) stays in the plain switch.

Rationale: HSV math on linear rgb lands perceptually sideways -- a
0.75 saturation scale in linear reads as chalk, a mild hue nudge as
washed sage.

### 2. Color semantics come from the parameter declaration, never a value's dataType

The compiler's `coerceValue` retypes a color feeding a vec3 port
(math.lerp's a/b, any vector op) to `"vec3"`. A materializer branch
gated on `value.dataType === "color"` therefore silently skips both
chokepoint behaviors for any color parameter routed through vector
math -- the parameter renders at raw sRGB values and inheritance
falls back to the seeded surface base color. Derive color-ness from
the declaration (`ir.parameters.find(...).dataType`), which coercion
cannot touch. The value's dataType describes the port contract, not
the parameter's meaning.

### 3. Fragment-stage shader graphs read vertex attributes through vertexStage()

Direct `attribute()` reads in fragment-stage node code are
unreliable on our NodeMaterial path (instanced attributes read
garbage; see `instanceOrigin` and `_tree_height` in
`ShaderRuntime.ts`). Attributes consumed by surface color graphs
are read in the vertex stage via `vertexStage()` and reach the
fragment as interpolated varyings. `positionWorld` is NOT a
substitute for per-instance data -- it lacks the instance transform
on this path.

### 4. Shaders sample bakes through readback DataTextures, never render-target textures

Sampling a render-target texture from multiple render pipelines
(e.g. the scatter LOD bins) resolves v-orientation inconsistently
per pipeline -- some pipelines sampled the ground-color bake
v-flipped while others did not. Bakes that shaders sample (the
landscape ground-color map, `RuntimeLandscapeMesh`) are published by
`readRenderTargetPixelsAsync` into a plain `DataTexture`, row-
flipped during the copy (readback rows arrive top-first). Plain
texture uploads have one deterministic sampling orientation
everywhere.

### 5. Verification: distinguishing inputs, loud values

Flat-color grounds cannot distinguish "sampled the bake" from "used
the seeded fallback" -- both produce the same pixel. Inheritance
changes are verified against a stack whose base layer color differs
from the rendered composite (white base + green texture layer), and
new shader math is first proven with a loud value (hue -80, not -18)
before trusting a subtle default.

## Consequences

- New artistic color ops register in `SRGB_SPACE_COLOR_OPS` and are
  written as pure sRGB-space functions; they get conversion for free.
- Any new `inheritSource` or color-space behavior keys off parameter
  declarations.
- Rendering claims about color matching are settled by pixels
  (screenshots / QA), not by unit tests -- this bug class is
  invisible to everything except the rendered image.
