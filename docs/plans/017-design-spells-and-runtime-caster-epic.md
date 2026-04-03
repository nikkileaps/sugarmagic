# Plan 017: Design Spells and Runtime Caster Epic

## Goal

Port Sugarengine's caster and spells flow into Sugarmagic with clean boundaries:

- player-owned caster configuration in `Design > Player`
- spell-definition CRUD in `Design > Spells`
- shipped casting logic and spell menu in `packages/runtime-core`
- quest/runtime condition integration through one shared spell enforcer

## Scope

- canonical `SpellDefinition` with UUID ids
- canonical player `casterProfile`
- `Design > Spells` workspace
- runtime `Caster` ECS component
- runtime `CasterManager`
- runtime spell menu UI
- quest `castSpell` objective completion
- quest `hasSpell` and `canCastSpell` conditions

## Out Of Scope

- spell placement in regions
- player spawn overrides
- SugarAgent or Sugarlang spell authoring
- full combat/health gameplay

## Architecture

- one source of truth:
  - `SpellDefinition` in domain
  - player `casterProfile` in `PlayerDefinition`
- single enforcer:
  - `CasterManager` in `runtime-core`
- ECS:
  - runtime player owns a `Caster` component
- target rule:
  - spell mechanics and UI ship from `runtime-core`
  - targets only host and mount them

## Stories

1. Domain spell definitions and player caster profile
2. `Design > Spells` workspace
3. Player workspace caster section
4. Runtime caster state and spell menu
5. Quest/world-state spell integration
