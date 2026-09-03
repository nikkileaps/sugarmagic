# Golden-Hour Light Recipe

A tested set of environment values that renders the game's outdoor scenes in
rich, warm, late-afternoon light - saturated color, readable faces, visible
clouds - instead of the washed-out haze the current default environment
produces. The values were tuned against the arrival-station region through
the real render pipeline and verified by screenshot; the reference render is
[golden-hour-light.png](golden-hour-light.png).

The recipe is a diff against `wordlark:environment:default`. Apply it by
editing that definition (or authoring a variant and binding it) in the
content library.

## Why the default looks washed out

Three settings compound into the wash, in order of impact:

1. **The live fog is the `fog-tint` post-process shader, not
   `atmosphere.fog`.** The environment definition carries fog twice: once
   under `atmosphere.fog` and once as parameter overrides on the `fog-tint`
   entry in `postProcessShaders`. Editing `atmosphere.fog` produced no
   visible change; editing the `fog-tint` overrides changed the frame
   immediately. The default `fog-tint` color is a grey-white
   (`[0.87, 0.85, 0.82]`) at density `0.001`, which blankets the frame in
   neutral haze. These two representations need to be reconciled into one
   source of truth before or while applying this recipe - do not delete
   either side without diffing what each feeds.
2. **Bloom clips the sky to white.** At the default `strength 0.5 /
   threshold 0.6`, the bright sky gradient crosses the threshold and blooms
   into a white sheet across the upper frame.
3. **The sky tints every material.** Ambient light is sky-driven, so the
   sky's `topColor` becomes the ambient tint on all surfaces. The default
   violet top (`0x6e5a9e`) pushes greys toward lilac - most visible on
   rocks. A warm rose top keeps stone neutral and skin warm.

## The recipe

Lighting:

| Field | Default | Golden hour |
|---|---|---|
| `lighting.sun.azimuthDeg` | 225 | 118 |
| `lighting.sun.elevationDeg` | 45 | 30 |
| `lighting.sun.color` | `0xffd59e` | `0xffc98e` |
| `lighting.sun.intensity` | 1.25 | 1.45 |
| `lighting.ambient.intensity` | 1.25 | 1.5 |
| `lighting.rim.azimuthDeg` | 45 | 330 |
| `lighting.rim.elevationDeg` | 25 | 22 |
| `lighting.rim.color` | `0xcdd6f4` | `0xe8a8d0` |
| `lighting.rim.intensity` | 0.4 | 0.6 |

Sky:

| Field | Default | Golden hour |
|---|---|---|
| `atmosphere.sky.topColor` | `0x6e5a9e` | `0xd8a8b8` |
| `atmosphere.sky.gradientMidColor` | `0xe8a5b8` | `0xf5c0a0` |
| `atmosphere.sky.gradientMidPosition` | 0.35 | 0.32 |
| `atmosphere.sky.bottomColor` | `0xffdca8` | `0xffd9a8` |
| `atmosphere.sky.saturation` | 1.1 | 1.0 |
| `atmosphere.sky.cloudColor` | `0xfff2e0` | `0xfff0dc` |
| `atmosphere.sky.cloudOpacity` | 0.55 | 0.6 |
| `atmosphere.sky.undercastColor` | `0xffe8cc` | `0xffc890` |
| `atmosphere.sky.undercastShadowColor` | `0xc98fa8` | `0xb87860` |

Post-process overrides (the high-impact pair):

| Field | Default | Golden hour |
|---|---|---|
| `fog-tint.color` | `[0.87, 0.85, 0.82]` | `[0.93, 0.82, 0.70]` |
| `fog-tint.density` | 0.001 | 0.0005 |
| `bloom.strength` | 0.5 | 0.32 |
| `bloom.threshold` | 0.6 | 0.78 |

Sun angles are scene-direction dependent: azimuth 118 was chosen for a
specific camera. The transferable part is the elevation band (roughly 26-34
degrees for long shadows with lit faces; below ~16 the sun backlights
characters into silhouette) and the warmer color and higher intensity.

## Beyond environment data

Two contributors to the reference render live outside the environment
definition, so matching it exactly in-game needs one of these picked up:

- **A warm fill.** A shadowless camera-side fill light (`0xffe2c2` at 0.7)
  lifts character faces out of shadow. In-game the closest data-only lever
  is the higher ambient intensity above; a true fill would be a new
  lighting-rig concept.
- **Exposure.** The reference used `toneMappingExposure 1.12`; the renderer
  hardcodes 1.0 (`configureRenderer` in render-web's RenderView). An
  authored exposure field in the environment definition would make this a
  data knob.

## Hazard: cloud parameter ranges

Pushing the procedural cloud settings well past their authored values
(`cloudCoverage 0.6, cloudSoftness 0.2, cloudOpacity 0.85, cloudScale 2.8`
together) hard-hung the WebGPU renderer: the page's JS stayed alive but the
compositor stopped producing frames until reload. Until that is understood,
treat the authored cloud values as a tested envelope and change them one at
a time.

## Completeness

The tables above are a complete extraction of the tuned environment: every
field that differed from `wordlark:environment:default` is listed, so the
recipe can be applied from this document alone.
