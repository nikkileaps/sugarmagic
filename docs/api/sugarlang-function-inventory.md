# API 016: Sugarlang Function Inventory

## Purpose

The function inventory is a hand-curated catalogue of communicative
functions (e.g. "greet", "thank", "farewell") paired with the formulaic
chunk sequences (e.g. "buenos dias", "hasta luego") that realize them.
It drives the curriculum spine: which chunks the learner needs to acquire,
in what order, and which four-category interpret-lexicon slots each function
fills for social-move detection.

## Files

| Role | Path |
|------|------|
| JSON schema | `packages/plugins/src/catalog/sugarlang/data/schemas/function-inventory.schema.json` |
| Spanish seed data | `packages/plugins/src/catalog/sugarlang/data/languages/es/function-inventory.json` |
| TypeScript contracts | `packages/plugins/src/catalog/sugarlang/runtime/contracts/function-inventory.ts` |
| Runtime loader | `packages/plugins/src/catalog/sugarlang/runtime/inventory/function-inventory-loader.ts` |
| Tests | `packages/plugins/src/catalog/sugarlang/tests/data/function-inventory.test.ts` |

## Data Shape

The JSON root (`FunctionInventory`):

```typescript
interface FunctionInventory {
  schemaVersion: "1";
  lang: string;               // BCP-47, e.g. "es"
  functions: FunctionEntry[];
}
```

Each `FunctionEntry`:

```typescript
interface FunctionEntry {
  functionId: string;         // stable slug, e.g. "greet"
  displayName: string;        // human label for Studio
  cefrDescriptor: string;     // CEFR can-do descriptor
  band: CEFRBand;             // "A1".."C2" -- lowest band the function targets
  placementGateBand?: CEFRBand; // if set, station manager teaches these before discovery
  isItemZero?: boolean;       // true for meta-language chunks (taught unconditionally)
  interpretLexiconCategory?: "farewell" | "greeting" | "gratitude" | "acknowledgement";
  chunks: Record<string, InventoryChunk[]>;  // key = BCP-47 lang
}
```

Each `InventoryChunk`:

```typescript
interface InventoryChunk {
  chunkId: string;            // stable slug, e.g. "buenos_dias"
  normalizedForm: string;     // underscore-lowercased -- join key to scene-extracted chunks
  surfaceForms: string[];     // human-readable variants (diacritics/punctuation preserved)
  cefrBand: CEFRBand;
  constituentLemmas: string[];
}
```

## Loader API

Import from `runtime/inventory/function-inventory-loader`:

```typescript
// Load the full inventory for a language (throws if missing).
loadFunctionInventory(lang: string): FunctionInventory

// All InventoryChunk objects across all functions (used by observe middleware).
getAllInventoryChunks(lang: string): InventoryChunk[]

// Build the interpretLexicon contribution for interpretation.ts's detectSocialMove.
buildInterpretLexiconFromInventory(lang: string): Record<string, string[]>

// Class form -- inject a different data map in tests.
class FunctionInventoryLoader {
  constructor(dataByLang?: Partial<Record<string, unknown>>)
  load(lang: string): FunctionInventory
  getFunctions(lang: string): FunctionEntry[]
  getChunks(functionId: string, lang: string): InventoryChunk[]
  getAllChunks(lang: string): InventoryChunk[]
  buildInterpretLexicon(lang: string): Record<string, string[]>
}
```

## Item-Zero Functions

Functions with `isItemZero: true` contain meta-language chunks
("no entiendo", "mas despacio", "como se dice", "que es").
The station manager teaches these to learners below `placementGateBand`
before any scene discovery begins; they are not subject to the CEFR gate
check. See epic 085 for the teaching protocol.

## InterpretLexicon Integration

Functions with `interpretLexiconCategory` set contribute their `surfaceForms`
to the four-slot interpretLexicon consumed by `detectSocialMove` in
`sugaragent/runtime/stages/interpretation.ts`. Call
`buildInterpretLexiconFromInventory("es")` to obtain the full category map.
This replaces the hand-rolled `SPANISH_INTERPRET_LEXICON` constant (removed in
epic 085 story 085.6).

## normalizedForm Join Key

`InventoryChunk.normalizedForm` is the join key to scene-extracted
`LexicalChunk.normalizedForm` objects in `CompiledSceneLexicon.chunks`.
The scene-extraction pipeline uses the same underscore-lowercased convention.

## Adding a New Language

1. Create `data/languages/{lang}/function-inventory.json` matching the schema.
2. Import it in `function-inventory-loader.ts` and add to `DEFAULT_INVENTORY_DATA`.
3. Add schema-validation + loader tests mirroring the `es` suite.
4. Add `interpretLexiconCategory` entries only if `detectSocialMove` is
   live for that language (currently `es` only).
