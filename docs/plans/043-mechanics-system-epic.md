# Plan 043: Mechanics System Epic

**Status:** Proposed
**Date:** 2026-05-03

## Epic

### Title

A general, data-driven gameplay-mechanics layer for Sugarmagic
— project-defined **stats** (named numeric values on actors),
**castables** (anything an actor can do that consumes / produces
stats and rolls dice), and **formulas** written in a small
LLM-friendly expression mini-language. Mechanics live in
project data as a JSON block on `GameProject`, authored via
JSON5 in Studio (input format only) and persisted as standard
JSON. Validated against an exported JSON Schema. The engine has zero hardcoded "battery" or "resonance"
or "HP" — those are all just stats a project happens to define.
The first consumer is the existing Caster: battery becomes a
stat, spell becomes a castable, chaos becomes a formula, and
the resonance system from sugarengine is re-implemented as
_authored mechanics_, not engine code.

### Goal

- **One new top-level project field** — `gameProject.mechanics:
MechanicsDefinition` — containing the project's stats,
  castables, and formulas. Defaults to a minimal valid empty
  shape on legacy projects; the change is additive.
- **Stats as first-class authored content.** A `StatDefinition`
  has id, displayName, default, min/max, optional decay,
  optional recharge, a display hint (`"battery" | "bar" |
"number" | "percentage"`), and an explicit runtime role
  (`"battery" | "resonance" | null`). Engine treats them all
  as named floats; the display hint tells UI how to render,
  while role tells runtime systems which stat carries Caster
  meaning.
- **Castables as the unit of "thing an actor does."** A
  `CastableDefinition` has costs, an `onCast` op list driven
  by expression-language formulas, and emits structured
  events that downstream engine listeners (spell-effect
  dispatcher, UI, audio) react to. Spells are one kind of
  castable; future games can ship attacks, skills,
  conversation moves, etc. without engine changes.
- **Four canonical ops:** `consume` (mutate stat by negative
  delta), `set` (assign stat to value), `branch` (conditional
  with then/else op lists), `emit` (fire structured event for
  downstream listeners). Deliberately small. NO `apply` op —
  it would have re-introduced spell-system knowledge into the
  mechanics layer. Spell-level effects (heal, dialogue,
  unlock) stay on `SpellDefinition.effects[]` and are
  dispatched by the existing engine-side spell-effect handler
  in response to `emit` events from the cast.
- **Tiny LLM-friendly expression mini-language** for what's
  inside cost / amount / condition / value strings — arithmetic,
  comparisons, member access (`caster.battery`,
  `self.batteryCost`, `target.hp`), dice (`roll(1d20)`,
  `roll(3d6+2)`), ternary, and a small built-in function set
  (`min`, `max`, `floor`, `ceil`, `clamp`). No loops, no
  user-defined functions, no assignment — sequencing comes from
  the surrounding structured ops.
- **Schema-first validation pipeline.** The mechanics shape is
  defined as a JSON Schema (Draft 2020-12), validated by Ajv
  on project load AND project save AND publish-time. A second
  semantic pass verifies expression strings parse cleanly,
  reference real stat ids, and don't reference undefined
  castable args. Both passes fail loud — runtime never sees an
  invalid mechanics block.
- **Public schema artifact.** The compiled JSON Schema ships
  as `schemas/mechanics.schema.json` so any LLM, IDE, or
  external tool can consume it without depending on Sugarmagic
  TypeScript.
- **Caster port as the proof.** The existing Caster
  (`packages/runtime-core/src/caster/`) gets refactored to read
  its battery and chaos rules from the project's mechanics
  block. Today's hardcoded `battery` / `maxBattery` /
  `castSpell` flow becomes an authored stat + authored castable.
  Resonance from sugarengine then ports as more _authored
  mechanics_, not engine code — proving the system works for
  both the current game and a future RPG with totally different
  stats.

### Why this epic exists

Sugarengine baked the magic system into engine code — Battery,
Resonance, and chaos rolls were TypeScript constants and
methods, not authored data. Porting that wholesale into
Sugarmagic would lock the engine to one specific gameplay
shape: the magical iPhone fantasy. Anything else (a stamina
RPG, a tabletop-style combat system, a Stardew-style energy
loop) would require either ignoring the existing system or
forking the engine.

The right pattern is data-driven. Every game built on
Sugarmagic gets to declare its own stats, costs, and formulas.
The engine ships generic execution machinery — it knows how to
read stat values, evaluate expressions, roll dice, and apply
structured operations. It does NOT know what "battery" means.

This is also an explicit AI-author bet. The user's intended
authoring workflow is "ask an LLM to implement these
mechanics," not "drag boxes around in a visual editor." That
constraint pushes the design toward:

- Familiar formats LLMs already produce reliably (JSON5)
- A schema artifact so any AI can validate before submitting
- Verbose-and-structured over terse-and-clever
- Small, explicit grammar for the inner expression language

The mechanics system is therefore both an engine generalization
AND an LLM-friendly content target.

### Goal-line test

After this epic lands:

- A new `mechanics` field exists on every project file.
- Authoring the existing Caster mechanics (battery, recharge,
  chaos roll, spell consumes battery, optional resonance
  dampener) is a JSON block in `gameProject.mechanics`,
  authored via JSON5 in Studio and persisted as JSON. No
  engine code references "battery" by name.
- An LLM prompted with "implement a basic D&D 5e style attack
  system in Sugarmagic mechanics DSL" against the published
  schema produces a valid mechanics block on the first or
  second try, no manual corrections.
- Saving an invalid mechanics block (typo'd stat reference,
  malformed expression, missing required field) produces a
  human-readable error in Studio at save time, not at runtime
  cast time.
- The wordlarky game's Phonowave / future-podcast spell
  remains a separate epic and depends on this one being in
  place — castables are how it's expressed.

## Scope

### In scope

**Owned by `packages/domain`:**

- Types: `MechanicsDefinition`, `StatDefinition`,
  `CastableDefinition` (including `inputs: CastableInput[]`),
  `CastableInput`, `CastableOp` (discriminated union),
  `CastableInvocation` (`{ id, args }` — what consumers like
  spells embed to fire a castable),
  `ExpressionString` (branded string type), and supporting types.
- `createDefaultMechanicsDefinition()` factory (the
  Caster-equivalent default block).
- `normalizeMechanicsDefinition()` and the corresponding
  `mechanics` field on `GameProject` with normalizer integration.
- JSON Schema artifact: `packages/domain/schemas/mechanics.schema.json`.

**Owned by `packages/runtime-core/src/mechanics/`:**

- Expression mini-language: tokenizer → recursive-descent
  parser → AST → tree-walking evaluator. Pure, deterministic,
  no side effects. Imports `ExpressionString` and the schema
  types from `@sugarmagic/domain`.
- Dice primitive: `roll(NdM)`, `roll(NdM+K)`, `roll(NdM-K)`.
  Pluggable RNG so tests can pin the seed.
- Stats runtime: `StatCarrier` per actor, get/set/mutate,
  modifier registry (so future systems can register temporary
  buffs without rewriting carriers), event hooks
  (`onStatChanged`).
- Castable executor: interprets the structured op list
  (canonical ops: `consume`, `set`, `branch`, `emit`),
  resolves expressions, fires `emit` events through a
  caller-supplied callback that the gameplay session wires to
  the engine's existing event-dispatch surfaces (spell-effect
  dispatcher, audio cues, UI listeners, etc.). The mechanics
  layer never imports from `caster/` or `dialogue/` or any
  other engine subsystem — emits cross those seams via the
  callback.
- Two-stage validators: **structural** (Ajv against domain's
  schema) + **semantic** (uses the parser to check expression
  references and types). Both live here because both need
  parser/runtime concerns; io and apps/studio import them via
  `@sugarmagic/runtime-core`.
- Caster refactor: existing battery / chaos / spell flow
  becomes a thin adapter that reads from the project's
  mechanics block and routes through the executor. The
  `Caster` ECS component becomes a `StatCarrier` plus the spell
  list it knows about.
- Studio mechanics editor: minimal v1. A single JSON5 textarea
  with live Ajv validation feedback (line-numbered errors). NOT
  a visual editor. Authors who want help write to an LLM; the
  textarea is just a place to paste the result. Future visual
  editor is a separate epic.
- Reference / docs: at least three worked example mechanics
  files committed under `docs/mechanics-examples/` — one
  re-implementing today's Caster, one Rackwick (battery +
  resonance + chaos), one tabletop-style (HP / fatigue /
  charisma / d20 attacks) — so LLMs have few-shot examples and
  humans can copy-and-modify.

### Out of scope

- **Visual editor for mechanics.** The DSL is deliberately
  LLM-first; building a visual node-graph editor is a separate,
  much larger epic that should wait until at least 2-3 games
  have shipped real mechanics blocks.
- **Status effects, buffs, debuffs with durations.** A
  modifier registry exists so a future story can layer
  durations on top, but v1 only ships permanent mutations.
- **Cross-actor mechanics (AoE, target groups).** Castables
  affect `caster` and `target`, both single actors. Multi-target
  ops are an additive future story.
- **Real-time formula re-evaluation** (e.g., "this castable
  costs more when caster.fatigue is high — recompute every
  frame"). Costs are evaluated once at cast-time. Persistent
  per-frame formulas would be a separate "formula reactivity"
  story.
- **In-DSL persistence / save-state / world-flags.** Mechanics
  describe how a single cast resolves; the existing
  blackboard / world-state / quest systems own persistence. A
  castable can `emit` an event the existing systems handle, but
  the DSL itself is read-only against world state.
- **Replacing the existing SpellEffectType union with mechanics
  immediately.** The Caster keeps its spell list; we route
  cast-time resolution through the new executor but do NOT
  rip out spell-effect-type until at least one full game cycle
  validates the mechanics path. Cleanup is a follow-up story
  inside this same epic (43.7) gated on the port working.
- **Phonowave / podcast browser.** Plan 042 (Phonowave
  Podcasts) consumes this mechanics system but ships
  separately — the Phonowave spell becomes a castable, and
  podcast playback is a side-effect op the mechanics executor
  can dispatch. Implementation order: 043 lands first, then
  042 builds on top.

## Shape sketch

### Project file shape

```json5
{
  identity: { ... },
  // ...existing project fields...
  mechanics: {
    stats: [
      {
        id: "battery",
        displayName: "Battery",
        default: 100,
        min: 0,
        max: 100,
        recharge: { ratePerSecond: 1 },
        display: "battery",
        role: "battery"
      },
      {
        id: "resonance",
        displayName: "Resonance",
        default: 0, min: 0, max: 100,
        display: "bar",
        role: "resonance"
      }
    ],
    castables: [
      {
        id: "spell",
        // `inputs` declares the schema of `self.*` for this
        // castable. Every consumer (e.g. a SpellDefinition)
        // provides values for these inputs via `castable.args`.
        // The semantic validator uses this list to verify that
        // every `self.X` reference resolves to a declared input.
        //
        // Note what's NOT here: no "effects" / "chaosEffects"
        // input. The mechanics layer handles stat mutations
        // and emits structured events. Spell-level effects
        // (heal, dialogue, unlock) live on
        // `SpellDefinition.effects[]` and are dispatched by
        // the existing engine-side spell-effect handler when
        // it receives the matching emit.
        inputs: [
          { id: "batteryCost", type: "number", description: "Battery consumed per cast" },
          { id: "chaosBase",   type: "number", description: "Base chaos chance (0-100)" }
        ],
        cost: "caster.battery >= self.batteryCost",
        onCast: [
          { op: "consume", target: "caster.battery", amount: "self.batteryCost" },
          {
            op: "branch",
            condition: "roll(1d100) > (self.chaosBase - caster.resonance * 0.8)",
            then: [
              { op: "emit", kind: "spell-chaos" },
              { op: "set", target: "caster.resonance", value: "0" }
            ],
            else: [
              { op: "emit", kind: "spell-success" }
            ]
          }
        ]
      }
    ]
  }
}
```

Cast-time event flow (Rackwick):

```
Player picks Fireball spell
  → Caster builds cast scope:
      caster = player StatCarrier
      self   = spell.castable.args = { batteryCost: 30, chaosBase: 50 }
  → Mechanics executor runs spell castable's onCast list
      consume battery  → StatCarrier mutated
      branch on chaos  → either emit "spell-chaos" or "spell-success"
  → Existing spell-effect dispatcher (engine code, unchanged)
    listens for these emits, finds the spell that triggered it,
    runs spell.effects[] or spell.chaosEffects[] through the
    existing SpellEffectDefinition handler.
```

### Consumer-side: how a spell links to a castable

A `SpellDefinition` declares which castable it uses and provides
the args the castable's `inputs` schema requires:

```json5
{
  definitionId: "fireball",
  displayName: "Fireball",
  // ...existing identity / icon / tags...
  castable: {
    id: "spell",
    args: {
      batteryCost: 30,
      chaosBase: 50,
      effects: [
        /* ... */
      ],
      chaosEffects: [
        /* ... */
      ]
    }
  }
}
```

At cast time, the executor builds `self` from `castable.args`,
not from the spell's other fields. Spells (and any future
castable consumer — items, podcasts, dialogue moves)
participate in the system via this single contract.

### Inner expression grammar (tiny)

```
expression := ternary
ternary    := logical ("?" expression ":" expression)?
logical    := equality (("&&" | "||") equality)*
equality   := comparison (("==" | "!=") comparison)*
comparison := term (("<" | ">" | "<=" | ">=") term)*
term       := factor (("+" | "-") factor)*
factor     := unary (("*" | "/" | "%") unary)*
unary      := ("!" | "-")? primary
primary    := number | string | boolean
            | "(" expression ")"
            | call
            | member
            | dice
call       := identifier "(" (expression ("," expression)*)? ")"
member     := identifier ("." identifier)*
dice       := "roll(" diceLiteral ")"
diceLiteral := <integer> "d" <integer> (("+" | "-") <integer>)?
```

Built-in identifiers: `caster`, `self`, `target`, plus
`min`, `max`, `floor`, `ceil`, `clamp`, `abs`, `roll`.

### Module layout

**Domain owns the data shape — types, factory, normalizer, schema:**

```
packages/domain/src/mechanics/
  index.ts                 # MechanicsDefinition, StatDefinition,
                           # CastableDefinition, CastableOp,
                           # ExpressionString (branded string),
                           # createDefaultMechanicsDefinition,
                           # normalizeMechanicsDefinition

packages/domain/schemas/
  mechanics.schema.json    # public, exported, LLM-consumable
```

**Runtime-core owns execution machinery — parsing, evaluating,
running:**

```
packages/runtime-core/src/mechanics/
  index.ts                 # public API (re-exports)
  expression/
    tokenizer.ts
    parser.ts
    ast.ts
    evaluator.ts
    dice.ts
  validation/
    structural.ts          # Ajv against domain's schema
    semantic.ts            # reference + expression checks (uses parser)
  runtime/
    StatCarrier.ts
    StatModifierRegistry.ts
    CastableExecutor.ts
    EventEmitter.ts
  README.md
```

Runtime-core imports types from `@sugarmagic/domain` (already
allowed). The split mirrors every other domain in the
codebase: `SpellDefinition`, `DocumentDefinition`, and
`ItemDefinition` all live in `packages/domain/src/<kind>/`,
with their runtime systems (caster, document-reader, inventory)
in `packages/runtime-core/src/<system>/`.

## Stories

### 43.1 — Schema + reference examples

**Goal:** lock the JSON Schema and the inner expression grammar
first, then continue directly into domain/runtime implementation
on the same branch. The schema and examples are the design
contract for the rest of the epic.

- Author the JSON Schema for `MechanicsDefinition`,
  `StatDefinition`, `CastableDefinition` (including its
  `inputs[]` schema declaring allowed `self.*` references),
  `CastableInput` (id + type + optional default + optional
  description), the `op` discriminated union, and
  `ExpressionString` (with a regex/format hint, not a parse —
  semantic validation happens later).
- Schema also covers the **consumer side**: a
  `CastableInvocation` block (`{ id: castableId, args: Record<string, unknown> }`)
  that any definition wanting to fire a castable embeds. The
  spell schema in Story 43.7 will include this.
- Write three example mechanics files under `docs/mechanics-examples/`:
  - `current-caster.mechanics.json5` — the Sugarmagic Caster as
    it works today, expressed as mechanics
  - `rackwick.mechanics.json5` — battery + resonance + chaos
    dampening, ported from sugarengine semantics
  - `dnd-5e-attacks.mechanics.json5` — HP, AC, dexterity, 1d20
    - str vs. AC, damage roll on hit, demonstrates the schema
      handles a totally different game
- The schema + examples are committed before the runtime stories
  consume them, so later stories have a concrete contract to test
  against.

**Files touched:**

- `packages/domain/schemas/mechanics.schema.json` (new)
- `docs/mechanics-examples/*.mechanics.json5` (new)
- `docs/mechanics-examples/README.md` (new — explains the
  format for LLM consumption)

### 43.2 — Domain types + project field + legacy normalization

- TypeScript interfaces matching the schema 1:1.
- `mechanics: MechanicsDefinition` field on `GameProject`.
- **`createDefaultMechanicsDefinition()` factory** in domain
  returns the Caster-equivalent mechanics block (battery stat
  with recharge, spell castable with battery-cost +
  chaos-roll). This is the same content as
  `current-caster.mechanics.json5` from Story 43.1, but
  expressed in TypeScript so it can be referenced at
  normalization time.
- **`normalizeGameProject()` fills in `mechanics` from the
  factory if the field is absent.** Legacy projects loaded
  from disk get the explicit default in memory; on first
  save, that default is written to the project file. From
  then on, the project owns its mechanics — the same way
  every other normalized field works.
- **No runtime fallback anywhere.** Runtime-core ALWAYS reads
  `gameProject.mechanics` and trusts that it is populated.
  If someone hand-edits a project file to remove the field,
  the normalizer fills it back in on the next load. There is
  no "what if mechanics is missing" branch in any runtime
  code path.
- Round-trip tests for: legacy project (no field) →
  normalized → save → legacy field present and matches the
  factory output; populated project preserves its mechanics
  through round-trip; empty mechanics block (`{ stats: [],
castables: [] }`) is also valid (a game that wants no
  default Caster behavior can author this explicitly).
- TS types are derived to match the JSON Schema; if Ajv +
  json-schema-to-typescript is available it's used to generate
  them, otherwise hand-authored with a test that asserts schema
  conformance.

**Files touched:**

- `packages/domain/src/mechanics/index.ts` (new — types +
  `createDefaultMechanicsDefinition`)
- `packages/domain/src/game-project/index.ts` (field + normalizer)
- `packages/domain/src/index.ts` (re-export)
- `packages/testing/src/mechanics-domain.test.ts` (new —
  including the legacy-project round-trip test)

### 43.3 — Expression mini-language

- Tokenizer for the grammar in the shape sketch above.
- Recursive-descent parser producing a tagged AST.
- Tree-walking evaluator with a pluggable scope object
  (`{ caster, self, target }` plus built-in functions).
- Dice primitive with a pluggable RNG (default
  `Math.random`, override for tests).
- Per-token error messages that point at the offending
  position in the source string (not just "parse error").
- Heavy unit-test coverage for the language itself: every
  operator, every precedence rule, dice combinations, error
  cases.

**Files touched:**

- `packages/runtime-core/src/mechanics/expression/*` (new)
- `packages/testing/src/mechanics-expression.test.ts` (new)

### 43.4 — Stats runtime + carriers

- `StatCarrier` interface with get / set / mutate / subscribe.
- Modifier registry (named modifiers can register to alter a
  stat's effective value or transform mutations); used later by
  potential buff/debuff systems but ships with NO built-in
  modifiers in v1.
- Stats are initialized from a `MechanicsDefinition.stats[]`
  list when the carrier is created.
- Recharge / decay tickers driven from the gameplay session
  update loop; stat changes emit events that downstream
  systems (HUD, audio cues) can subscribe to.

**Files touched:**

- `packages/runtime-core/src/mechanics/runtime/StatCarrier.ts` (new)
- `packages/runtime-core/src/mechanics/runtime/StatModifierRegistry.ts` (new)
- `packages/runtime-core/src/mechanics/runtime/EventEmitter.ts` (new)
- `packages/testing/src/mechanics-stats.test.ts` (new)

### 43.5 — Castable executor

- The structured `op` interpreter. Four canonical ops:
  - **`consume`** — `{ op: "consume", target: "<stat-path>", amount: "<expression>" }`. Mutates the targeted stat by `-amount`. Stat-bounds clamping is handled by the StatCarrier from Story 43.4.
  - **`set`** — `{ op: "set", target: "<stat-path>", value: "<expression>" }`. Assigns the targeted stat to the evaluated value.
  - **`branch`** — `{ op: "branch", condition: "<expression>", then: CastableOp[], else: CastableOp[] }`. Recursively executes nested op lists.
  - **`emit`** — `{ op: "emit", kind: "<event-name>", payload?: Record<string, unknown> }`. Fires through a caller-supplied callback; that's how mechanics talks to the rest of the engine without depending on it.
- **NO `apply` op.** Spell-level effects live on `SpellDefinition.effects[]` and are dispatched by the existing engine-side spell-effect handler (in `caster/CasterManager.ts`) when it receives the matching emit. Mechanics never touches `SpellEffectDefinition`. Same pattern for any future "rich effect bag" — it lives on its owning definition and listens for an emit kind.
- **Executor construction takes a callback bag**, not direct engine access:
  ```ts
  createCastableExecutor({
    mechanics: MechanicsDefinition,
    rng?: () => number,            // overridable for tests
    emit: (kind: string, payload?: Record<string, unknown>) => void,
  })
  ```
  The `emit` callback is wired by gameplay-session to whatever event-dispatch surface is appropriate. Mechanics has zero imports from `caster/`, `dialogue/`, `audio/`, etc.
- Cast-time scope construction: `{ caster, self, target }` populated from carriers + the castable invocation's `args` + an optional target carrier.
- Cost validation step (evaluates the cost expression as a boolean) BEFORE running any onCast op, so a failed cost produces no side effects.
- Result type: `success | cost-failed | runtime-error`, with enough info for the UI layer to render appropriate feedback. (Note: cast-time runtime errors — like a divide-by-zero in a formula — should be vanishingly rare because the semantic validator from 43.6 catches them at edit time, but the executor still needs a defensive surface.)
- Integration tests using the three reference example mechanics files from 43.1 — actually run a cast through each, with a captured `emit` callback, and assert both the resulting stat values AND the emitted event sequence.

**Files touched:**

- `packages/runtime-core/src/mechanics/runtime/CastableExecutor.ts` (new)
- `packages/runtime-core/src/mechanics/index.ts` (public API)
- `packages/testing/src/mechanics-castable.test.ts` (new)

### 43.6 — Two-stage validation pipeline

- **Structural:** Ajv compiled against the JSON Schema from
  43.1, applied to the `mechanics` field. Errors are
  human-readable (Ajv's default messages get a thin friendlier
  wrapper that points at the offending JSON path).
- **Semantic:** for every expression string in the mechanics
  block:
  - Parse it (using the parser from 43.3); fail with a pointer
    to the source position.
  - Walk the AST checking that every `caster.X` reference
    resolves to a defined stat id in `mechanics.stats[]`.
  - Walk the AST checking that every `self.X` reference
    resolves to a declared input id in this castable's
    `inputs[]`. **This is the contract that catches typos and
    undeclared args.**
  - Walk the AST checking that every `target.X` reference
    resolves against the target actor's stats (when the
    castable declares it accepts a target).
  - Check operator type compatibility (no comparing booleans
    with `<`, etc.) — limited to what's tractable without
    full type inference.
- For every consumer that embeds a `CastableInvocation` (e.g.
  a SpellDefinition with a `castable: { id, args }` field),
  also validate:
  - The referenced `castable.id` exists in `mechanics.castables[]`.
  - Every required input from the castable's `inputs[]` has a
    value in `args`.
  - Each arg value's type matches the input's declared type.

**Both validators live in
`packages/runtime-core/src/mechanics/validation/`.** They're
pure functions: data in, validation result out.

**Where validation runs (callers, not the validator's home):**

- **Studio editor** (apps/studio → Story 43.8) — runs both
  validators on every edit; surfaces errors inline; gates save.
- **Runtime gameplay-session boot** (runtime-core itself) —
  runs both validators when initializing a session; fails
  loud and refuses to boot if invalid. Catches the
  hand-edited-the-file-bypassing-Studio case.
- **Publish pipeline** (apps/studio's publish workflow, which
  CAN import runtime-core) — runs both validators before
  emitting any publish artifact; refuses to publish on failure.

**`packages/io` does NOT validate.** io owns bytes-and-paths;
schema-aware validation requires runtime-core types and the
expression parser, and io can't depend on runtime-core (per
`tooling/check-package-boundaries.mjs`). The data-shape
guarantee comes from io reading bytes → domain normalizer
filling in defaults → runtime/Studio validators catching
anything malformed before use.

**Files touched:**

- `packages/runtime-core/src/mechanics/validation/structural.ts` (new)
- `packages/runtime-core/src/mechanics/validation/semantic.ts` (new)
- `packages/runtime-core/src/coordination/gameplay-session.ts`
  (validate at boot)
- `apps/studio/src/publish/...` (validate before publish — exact
  file depends on where the publish workflow currently lives)
- `packages/testing/src/mechanics-validation.test.ts` (new)

### 43.7 — Caster port onto the new system

- The existing `Caster` ECS component is split: stat values
  (battery, maxBattery, etc.) move into a `StatCarrier`
  initialized from `gameProject.mechanics.stats`. Spell list
  stays where it is.
- **`SpellDefinition` gains a `castable: CastableInvocation`
  field** (`{ id: castableId, args: Record<string, unknown> }`).
  - The `id` references a `CastableDefinition` in
    `mechanics.castables[]`.
  - `args` provides values for that castable's declared
    `inputs[]` (the `self.*` shape).
  - **The Caster treats `spell.castable.id` as an opaque key.**
    No engine code compares it to a string literal; lookup is
    via `mechanics.castables.find(c => c.id === spell.castable.id)`.
    A different game can name its spell castable
    `"fire-magic"` or `"incantation"` and the Caster works
    identically.
  - **No `MechanicsDefinition.casterSpellCastableId` setting.**
    Each spell explicitly carries its own castable id; nothing
    project-wide tells the engine "this is the spell castable."
    The closest thing to a "default" lives entirely in Studio
    UX (Story 43.8): when authoring a new spell, the workspace
    offers a Select of available castables, defaulting to "you
    must pick one" rather than auto-selecting. Authoring
    convenience, not runtime contract.
  - `spell.castable` is the only authored invocation source
    of truth. There is no parallel `SpellDefinition.batteryCost`
    field and no normalizer path that folds old spell cost
    fields into `castable.args`.
  - Creating a new spell in Studio may seed the selected
    castable's declared input defaults as authoring
    convenience. Loading/normalizing existing data must not
    invent a castable id or inject default args; malformed
    spell invocation data fails the mechanics consumer
    validation path instead.
- `CasterManager.castSpell` becomes a thin adapter that
  builds the cast scope (`caster` = player's StatCarrier,
  `self` = the spell's `castable.args`, `target` = optional)
  and dispatches through `CastableExecutor`. The chaos
  formula comes from the mechanics block; no hardcoded chaos
  rolls in runtime-core.
- **The existing spell-effect dispatcher subscribes to
  mechanics emits.** When `gameplay-session` constructs the
  `CastableExecutor`, it passes an `emit` callback that
  routes events to the existing engine event surfaces.
  `CasterManager` registers handlers for at least
  `spell-success` and `spell-chaos` emit kinds — when one
  fires, the handler looks up the in-flight spell, picks
  `spell.effects[]` or `spell.chaosEffects[]` accordingly,
  and runs them through the existing `SpellEffectDefinition`
  dispatcher (unchanged from today). This is the seam: the
  mechanics layer never imports `SpellEffectDefinition`, the
  spell-effect dispatcher never imports anything from
  `mechanics/`, and they meet through opaque emit kinds.
- Convention: emit kinds for spell-driven cast resolution
  follow the pattern `spell-<outcome>` (`spell-success`,
  `spell-chaos`). A different game's castable could emit
  `attack-hit` / `attack-miss` / whatever — the Caster only
  cares about its own conventions, and only because it was
  authored to subscribe to them. No engine-wide registry of
  emit kinds.
- **No runtime fallback.** Domain normalization (Story 43.2)
  guarantees `gameProject.mechanics` is always populated by
  the time runtime sees the project — legacy projects get the
  Caster-equivalent default at load time and write it
  explicitly on first save. The Caster trusts that
  `gameProject.mechanics` exists; if it doesn't, that's a
  domain-layer bug, not a runtime concern.
- Same applies to spells: every loaded `SpellDefinition` must
  carry an explicit `castable` field that validates against
  the project mechanics block. The Caster does NOT have a
  "what if the spell has no castable" repair branch.

**Files touched:**

- `packages/domain/src/spell-definition/index.ts`
  (add `castable: CastableInvocation` field; normalizer folds
  legacy typed fields into it)
- `packages/runtime-core/src/caster/CasterManager.ts`
- `packages/runtime-core/src/components/Caster.ts` (or
  wherever it lives — split state out)
- `packages/runtime-core/src/coordination/gameplay-session.ts`
  (wire the StatCarrier into the gameplay session)
- `packages/testing/src/caster-mechanics.test.ts` (new)
- `packages/testing/src/spell-castable-normalization.test.ts` (new)

### 43.8 — Studio mechanics editor (minimal v1)

- New "Mechanics" tab under Design (or under Build, decide
  during the story — probably Design since mechanics are
  project-scoped, like Spells / Items / Documents).
- **Input/persistence split:** the editor textarea accepts
  **JSON5** (comments, trailing commas, single quotes — all
  fine). On save, the parsed object is persisted as standard
  pretty JSON via the existing project-save pipeline.
  Comments and trailing commas are intentionally lost on
  save; this matches the project file's existing JSON
  serialization and avoids dragging in a comment-preserving
  serializer (see Risk #5). The user's editor session retains
  what they typed until they save.
- Single textarea bound to a _string_ representation of
  `gameProject.mechanics` (not the live object), with:
  - Syntax highlighting if cheap (Mantine's `Code` /
    `JsonInput` or a lightweight Monaco; if it's painful,
    plain Textarea + Ajv-error-list-below is acceptable v1)
  - Parse via `json5.parse` on every edit; structural
    validation via Ajv against the schema; semantic
    validation via the parser-based reference checker
  - Inline error list from both validators with line/column
    pointers
  - Save button is disabled while the textarea contents are
    invalid OR auto-saves only when valid (decide during the
    story; "auto-save when valid" is friendlier)
  - On save: `JSON.stringify(parsedObject, null, 2)` written
    to `gameProject.mechanics` via the standard project-save
    pipeline. Reload the editor reads from the persisted
    JSON; if the user wants comments back, they paste again.
  - A "Copy schema URL" button that copies the path/URL to
    `mechanics.schema.json` so the user can paste it into an
    LLM prompt
  - A "Reload from file" / "Discard unsaved changes" affordance
    so the user can recover from an in-flight invalid edit
- NOT a visual / node editor. The DSL is LLM-first; the
  textarea is the authoring surface.

**Files touched:**

- `packages/workspaces/src/design/MechanicsWorkspaceView.tsx` (new)
- `packages/workspaces/src/design/index.tsx` (wire it in)
- `packages/shell/src/index.ts` (extend `DesignWorkspaceKind`
  with `"mechanics"`)
- `apps/studio/src/App.tsx` (commands + projection wiring)

### 43.9 — Public schema artifact + AI-author docs

- The `mechanics.schema.json` from Story 43.1 is exported in
  a stable, externally-fetchable location (committed to the
  repo, served by Studio's dev server, and copied into any
  publish artifact).
- A short authoring guide at `docs/mechanics-authoring.md`
  explaining:
  - The shape of the DSL and the inner expression grammar
  - How to ask an LLM to produce mechanics (with prompt
    examples)
  - How to validate locally (Ajv CLI + the schema URL)
  - Pointers to the three reference examples
  - **Persistence note:** the editor accepts JSON5 (comments,
    trailing commas, single quotes) but the project file
    persists pure JSON. Comments are lost on save. For design
    rationale, use a separate `mechanics-notes.md` or commit
    messages — not inline comments.
- README in `packages/runtime-core/src/mechanics/` for
  Sugarmagic engineers consuming the runtime.

**Files touched:**

- `docs/mechanics-authoring.md` (new)
- `packages/runtime-core/src/mechanics/README.md` (new)
- (Schema and examples already created in 43.1; this story
  exposes them via dev-server route + publish-pipeline copy)

## Success criteria

- All `pnpm typecheck`, `pnpm test`, `pnpm lint` pass.
- Goal-line test holds: an LLM prompted with the published
  schema produces a valid `current-caster.mechanics.json5`
  equivalent on first or second try with no manual cleanup.
- Wordlarky's project file contains an explicit mechanics
  block; runtime gameplay (cast a spell, consume battery,
  recharge battery) behaves identically to before this epic.
- Saving an invalid mechanics block in Studio produces
  human-readable error feedback at save time, not at runtime.
- The published schema artifact validates the three reference
  example files without errors.
- No engine code in `runtime-core` references the strings
  `"battery"`, `"resonance"`, or `"hp"` outside of test
  fixtures. (The default mechanics block lives in domain via
  `createDefaultMechanicsDefinition()`, not in runtime-core.)
- **No engine code in `runtime-core` compares any
  `castable.id` to a string literal.** Castable ids are
  opaque keys; the Caster looks one up via
  `mechanics.castables.find(c => c.id === spell.castable.id)`
  and dispatches whatever it finds. Enforced by a lint check
  similar to the existing render-engine boundary script:
  fail CI if a regex like `castable\.id\s*===\s*"` appears
  anywhere in `packages/runtime-core/src/`.
- No "what if mechanics is missing" branches anywhere in
  runtime-core. Domain normalization guarantees the field is
  populated; runtime trusts it.

## Risks

1. **Expression-language scope creep.** The grammar is
   deliberately tiny. The first time someone asks for "let me
   define a function" or "let me reference a global variable"
   we need to push back. The grammar grows in a follow-up
   epic, never inside this one.
2. **Validation error UX.** Ajv's raw error messages are
   notoriously unfriendly. Plan to spend real time on the
   thin wrapper that turns them into actionable feedback —
   this is the difference between "LLMs self-correct on second
   try" and "humans give up."
3. **Caster mechanics regression.** The existing Caster works
   and games depend on it. Story 43.7 must include
   side-by-side parity tests (today's behavior vs. mechanics-
   driven behavior) before we trust the new path.
4. **Domain default leaking world specifics.** Because the
   default mechanics block ships in `packages/domain` (so
   normalization can apply it), domain ends up shipping the
   Caster-equivalent stats (`battery`) by name. That's a
   deliberate trade — domain knowing about "battery" is
   acceptable because (a) the default is a NAMED factory, not
   a hidden runtime branch, and (b) any project can override
   it by writing its own mechanics block (which then persists
   on save). If a future game wants Sugarmagic to ship with a
   different default (or no default), the factory's contents
   are the single point of change — not scattered runtime
   special-casing.
5. **JSON5 vs. JSON — input vs. persistence.** JSON5 is the
   **input format only** (Studio editor textarea, LLM output,
   hand-edits). The persisted `project.sgrmagic` is and remains
   pure JSON, written via the existing
   `JSON.stringify(obj, null, 2)` path that all other project
   data already uses. **Comments and trailing commas in JSON5
   input are lost on save.** This is deliberate:
   - A comment-preserving JSON5 serializer is fragile (the
     `json5` npm package's `stringify` does not preserve
     comments; alternatives like `jsonc-parser` are
     comment-aware but break under non-trivial edits).
   - Mixing formats in `project.sgrmagic` (pretty JSON
     elsewhere, JSON5 in the mechanics block) breaks standard
     tooling — `jq`, GitHub diff renderers, JSON-aware editors.
   - The JSON Schema artifact is the canonical contract for
     "what fields exist and what they mean." LLMs prompted
     with the schema don't need inline comments to author
     correctly. Design rationale lives in `mechanics-notes.md`
     or commit messages, not in persisted data.
   - Standard tooling working on the project file matters
     more than preserving authoring comments past the first
     save.

   **Implementation:** parse with the `json5` npm package on
   read (handles JSON, JSON5, JSONC interchangeably);
   validate the parsed object with Ajv against the JSON
   Schema; on save, write via standard `JSON.stringify` with
   2-space indentation, like every other field in
   `project.sgrmagic`. No new persistence code path.

## Builds on

- **Plan 037 (Library-First Content Model)** — the
  managed-file pattern for project-scoped data.
- **Plan 041 (Sound System)** — same pattern of "engine
  primitive + authored definitions on `GameProject` +
  cross-package wiring" that we're following here.
- **AGENTS.md "Single Enforcer" rule** — castable execution is
  ONE place (the executor); no parallel "spell cast" path
  outside of it.
- **Existing Ajv usage** in
  `packages/plugins/src/catalog/sugarlang/runtime/compile/extract-chunks.ts`
  — the validator pattern is already established in the
  codebase.

## Notes for AI authors of mechanics blocks

- The published `mechanics.schema.json` is the canonical
  contract. Validate against it before submitting.
- Keep expression strings short and explicit. Prefer
  `caster.battery >= self.batteryCost` over clever
  rewrites.
- Use comments (JSON5 supports `//`) generously. Mechanics
  blocks are read by humans AND by future you.
- When in doubt, copy from one of the three reference
  examples in `docs/mechanics-examples/` and modify.
- The expression mini-language is deliberately small. If you
  feel like you need a function, an assignment, or a loop,
  you're outside the DSL — consider whether the structural
  ops can express what you want.
