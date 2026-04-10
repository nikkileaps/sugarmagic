# Scene Lexicon Compilation API

Status: Updated in Epic 3; expanded further in Epic 6

This document records the compiled scene-lexicon artifact shape.

## Core Artifact

`CompiledSceneLexicon` includes:

- `sceneId`
- `contentHash`
- `pipelineVersion`
- `atlasVersion`
- `profile: RuntimeCompileProfile`
- `lemmas: Record<string, SceneLemmaInfo>`
- `properNouns`
- `anchors`
- `questEssentialLemmas`
- optional `sources`
- optional `diagnostics`
- optional `chunks`

## Supporting Types

- `SourceLocation`
- `SceneAuthorWarning`
- `SceneLemmaInfo`
- `QuestEssentialLemma`
- `LexicalChunk`
- `CompileCacheKey`

## Lexical Chunks

`LexicalChunk` is part of the contract in Epic 3 even though runtime chunk
population lands later in Epic 14. `CompiledSceneLexicon.chunks` is therefore
optional: freshly compiled scenes may not have chunk data yet, while later
background extraction can populate it without changing the schema.

## Atlas Version Source

Epic 4 makes `atlasVersion` a data-backed value sourced from
`data/languages/<lang>/cefrlex.json` through `CefrLexAtlasProvider`. That keeps
scene-lexicon compilation tied to the actual lexical atlas snapshot instead of a
hardcoded compile constant.

Current source patterns:

- Spanish: ELELex import
- Italian: Kelly import with frequency-derived backfill
