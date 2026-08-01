# Backlog: Sugarlang naming cleanups

**Source:** Running collector for sugarlang names that describe the wrong thing and have cost real confusion in review or debugging. Each is a rename, not a behavior change -- but several cross a plugin seam or a persisted contract, so none is free.

**Date opened:** 2026-07-29

## Items

### 1. `interpretLexicon` is not a lexicon -- rename to `socialMoveCues`

**Severity:** Low (pure clarity, no behavior)

**Symptom:** "Lexicon" in this codebase means the atlas -- the whole word stock of a language, behind `LexicalAtlasProvider`. `interpretLexicon` is nothing of the sort: it is four fixed keyword lists (`greeting`, `farewell`, `gratitude`, `acknowledgement`, `INTERPRET_LEXICON_CATEGORIES` at `runtime/contracts/function-inventory.ts:26-31`) of target-language surface forms, handed to sugaragent so `detectSocialMove` (`sugaragent/runtime/stages/interpretation.ts:117`) can recognize a player typing `adiós` when its own patterns are English-only.

It is about understanding PLAYER INPUT, not about vocabulary or teaching. No bands, no lemmas, no atlas. Sitting in the same conversation as `sceneLexicon` and the atlas, the name actively misleads -- it read as a third dictionary during the Plan 090 domain work.

**Action:** Rename to `socialMoveCues` (or similar -- the categories ARE social moves, and `SocialMove` is already the return type of the consumer).

**Cost / blast radius:**
- Cross-plugin contract field: `sugaragent/runtime/contributions.ts:64` and `:85`, plus its validator at `:113-114` and the default at `:96`. Sugaragent is the OWNER of that contract shape, so the rename starts there.
- Sugarlang producer side: `buildInterpretLexicon` (`sugar-lang-teacher-middleware.ts:95`), `buildInterpretLexiconFromInventory` (`runtime/inventory/function-inventory-loader.ts:176`), `InterpretLexiconCategory` + `INTERPRET_LEXICON_CATEGORIES` + `interpretLexiconCategory` (`runtime/contracts/function-inventory.ts`).
- **It is authored data, so this is a MIGRATION, not just a rename.** `interpretLexiconCategory` is declared in `data/schemas/function-inventory.schema.json:58-61` (enum-constrained) and used on 4 entries in `data/languages/es/function-inventory.json`. Italian has no function inventory yet, so es is the only file today -- but the schema is the shipped contract for anyone adding a language. Rename schema + data + the loader together, or Ajv rejects the inventory at load.

**Do NOT bundle with:** the `sceneLexicon` -> scene-vocabulary rename, which is owned by Plan 090.2. Different seam, different story; doing both at once makes the 090 diff unreadable.

**Trigger:** next time anything touches the sugaragent contribution contract. There is a pointer comment at `buildInterpretLexicon` in the teacher middleware.
