# Mechanics Authoring

Sugarmagic mechanics are project-authored stats and castables. The canonical
schema is `packages/domain/schemas/mechanics.schema.json`; use it when asking an
LLM or IDE to generate mechanics.

## Shape

- `stats[]` declares named numeric values on actors. `display` controls visual
  presentation only; `role` is the explicit runtime meaning used by systems such
  as the Caster (`"battery"`, `"resonance"`, or `null`).
- `castables[]` declares actions that check a cost, mutate stats, branch, and
  emit events.
- Consumers such as spells point at a castable with `{ id, args }`.

The four v1 ops are:

- `consume`: subtract an expression amount from `caster.stat` or `target.stat`.
- `set`: assign an expression value to `caster.stat` or `target.stat`.
- `branch`: choose nested ops from a boolean expression.
- `emit`: fire an opaque event for gameplay systems to handle.

## Expressions

Expressions support arithmetic, comparisons, `&&`, `||`, ternaries, member
access (`caster.energy`, `self.damage`, `target.hp`), dice (`roll(1d20)`), and
the built-ins `min`, `max`, `floor`, `ceil`, `clamp`, and `abs`.

There are no loops, assignments, or user-defined functions. Sequencing belongs
in the structured op list.

## JSON5 Input, JSON Persistence

Studio's Mechanics workspace accepts JSON5-style input so LLM output can include
comments, trailing commas, single quotes, and unquoted keys. On Apply, Sugarmagic
stores normalized project data as standard pretty JSON. Comments are not
preserved in `project.sgrmagic`.

## LLM Prompt Starter

Use a prompt like:

```text
Using this Sugarmagic mechanics schema:
packages/domain/schemas/mechanics.schema.json

Create a MechanicsDefinition for a simple stamina combat game. Use stats for hp,
stamina, and armor. Use one castable for a light attack that costs stamina,
rolls 1d20 against target armor, consumes target hp on hit, and emits attack-hit
or attack-miss.
```

Then paste the result into Design > Mechanics. Studio will validate both the
schema and expression references.

## Examples

See `docs/mechanics-examples/current-caster.mechanics.json5`,
`docs/mechanics-examples/rackwick.mechanics.json5`, and
`docs/mechanics-examples/dnd-5e-attacks.mechanics.json5`.
