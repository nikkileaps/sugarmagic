# Compile

This module owns Sugarlang's scene-lexicon build pipeline.

It is the single source of truth for:

- scene traversal into stable `TextBlob[]`
- content-hash computation
- lemma-level lexicon compilation
- preview/runtime compile caches
- lexical chunk extraction and chunk caches
- preview handoff payloads
- publish-time artifact generation

`compileSugarlangScene` remains the only semantic compiler. Chunk extraction is a second-stage metadata pass layered on top of that artifact, keyed by the same content hash, so Preview, Studio, and publish all stay aligned on one artifact shape.
