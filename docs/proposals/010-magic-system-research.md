# 010: Magic System - Where We Are and Where To Go

Status: Research report (no decisions made)
Date: 2026-08-14

This report answers three questions: what the magic system does in Sugarmagic today, what the old Sugarengine game had that never came over, and how we should close the gap while keeping game-specific ideas (resonance, the mini-game) out of the general engine. It ends with recommendations and open decisions. No code was changed; every claim below was checked against the current code, the wordlark project data, or the old repos.

## 1. Where we are now

The short version: the general machinery is in better shape than expected, and the game-specific content is thinner than expected.

### The mechanics DSL shipped and it does the math

Plan 043 ("Mechanics System") shipped in PR #39 even though the plan header still says "Proposed." What exists:

- A `MechanicsDefinition` on the GameProject: `stats[]` and `castables[]`. Stats are named numbers with min/max, decay, recharge, a display style, and a `role` (`battery`, `resonance`, or null) that tells runtime UI which meter is which. Castables are actions with typed inputs, a `cost` expression, and an `onCast` list built from exactly four ops: `consume`, `set`, `branch`, `emit`.
- A small expression language (arithmetic, comparisons, ternary, `roll(1d100)`, `min`/`max`/`floor`/`ceil`/`clamp`/`abs`, member access on `caster`/`self`/`target`). No loops, no assignments, no user functions. Evaluated by a pure tree-walking interpreter in `packages/runtime-core/src/mechanics/`; mutation happens only through the four ops via `CastableExecutor`.
- Authoring: the Mechanics workspace is a JSON5 text editor with live validation against `packages/domain/schemas/mechanics.schema.json`. Worked examples live in `docs/mechanics-examples/`, authoring guide in `docs/mechanics-authoring.md`.
- The casting math is authored data, not TypeScript. The default (and wordlark's actual) mechanics block: cost `caster.battery >= self.batteryCost`, then consume battery, then branch on `roll(1d100) <= clamp(self.chaosBase - caster.resonance * 0.8, 0, 100)`, emitting `spell-chaos` (and zeroing resonance) or `spell-success`. The engine has no hardcoded battery or resonance nouns; a CI guard enforces that.

So yes: the rules and the math live in the mechanics data, and the plumbing evaluates them.

### The Caster runtime exists

- The player entity carries a `Caster` ECS component holding a `StatCarrier` seeded from the mechanics stat defaults. `CasterSystem` ticks recharge/decay per frame. Battery and resonance persist through the `caster.stats` save participant.
- The in-game Caster is `SpellMenuUI` in runtime-core (imperative DOM, not React): the `c` key opens a modal titled "Caster / Spells" with battery and resonance meters and a card per available spell; click or Enter casts.
- A `SpellDefinition` is a thin wrapper: name, description, icon, tags, a `CastableInvocation` (`{id, args}` pointing at a castable), plus `effects[]` and `chaosEffects[]` (event, unlock, world-flag, dialogue, heal, damage). `spell-success` runs effects, `spell-chaos` runs chaosEffects. Items can also invoke castables (`trigger-castable` action).
- Studio side: Design > Spells edits spells, Design > Mechanics edits the mechanics JSON5, Design > Player edits a caster profile.

### The mini-game came over - as a generic plugin nothing uses

Plan 044 added a plugin seam: plugins can contribute a `mechanics.emitHandler` that reacts to authored `emit` events, gets a mount root, input claim/release, and `dispatchCastable` to feed results back through the executor. The Fireflies plugin (`packages/plugins/src/catalog/fireflies/`) is the port of Sugarengine's resonance mini-game, rebuilt as a generic pattern-emergence puzzle: it opens when a configured emit fires and dispatches a configured castable on success or failure. Per its own README it does not know what those castables do.

Nothing in wordlark configures it. It is a working mini-game with no trigger and no reward wiring.

### What wordlark actually authors today

The wordlark project has exactly one spell, Finder: castable `spell` with `batteryCost: 10, chaosBase: 0`, and a single `event` effect with no target. Consequences worth seeing plainly:

- With `chaosBase: 0` the chaos branch can never fire, so resonance never affects Finder.
- Nothing in shipped code or wordlark data ever raises resonance. It starts at 0, has no recharge, and is only ever set to 0.

Resonance is therefore fully inert in the game today: a meter that reads 0 forever and a term in a formula that never runs.

### Loose ends found along the way

These are not the goal of this report but should get cleaned up or folded into whatever epic comes next:

1. `PlayerCasterProfile.initialBattery / initialResonance / rechargeRate` are edited in Design > Player but nothing at runtime reads them; the StatCarrier seeds from mechanics stat defaults. Dead wiring, and a "one source of truth" violation in the authoring UI.
2. `packages/runtime-core/src/caster/math.ts` still carries the old battery-tier chaos math; only `resolveBatteryTier` is used in production (for the meter display), the chaos/recharge functions are test-only leftovers.
3. Behavior quietly changed in the port: old Sugarengine chaos rose as battery dropped (full 0% / unstable 40% / critical 80% base chaos, then resonance dampening). The current authored formula uses a per-spell `chaosBase` and ignores battery level entirely (battery only gates the cost). If low-battery-is-risky is still wanted, it has to be authored back in.
4. Doc drift: Plan 043 header says Proposed but it shipped; Proposal 002 still names `ResonancePointDefinition` and `SpellDefinition` as canonical first-class domain objects, which 043 explicitly reversed ("the engine has zero hardcoded battery or resonance"); Plan 042 (Phonowave) still describes the pre-DSL `SpellEffectType` model it was supposed to be rebuilt on top of; no ADR records the mechanics architecture decision.
5. There are zero GitHub issues for any of this; the entire system is documented only in docs/.

## 2. What the old game had that never came over

From nikkileaps/sugarengine (sugarbuilder had nothing relevant - it was geometry tooling only):

### Resonance points

A two-part model: a project-level definition (`ResonancePointConfig`: name, icon, `resonanceReward` 0-100, difficulty easy/medium/hard, optional cooldown) and region-level placements (position, definition reference, optional prompt text). The editor had a Resonance panel for definitions and placed points in regions alongside NPCs and pickups. At runtime each placement spawned an interactable rendered as a glowing purple octahedron; pressing E locked player movement and launched the mini-game; on success the caster gained the point's full reward. The authored cooldown was never actually enforced at runtime - that was a latent bug, not a feature to preserve.

### The mini-game: "Dance With the Fireflies"

A full-screen "Resonance Attunement" overlay. 24 fireflies sit on a hidden path (line, curve, loop, figure-8, spiral, zigzag) among ~35 scattered distractors plus 1-3 decoy patterns. Every 18 seconds a coherence wave briefly lights the true shape before it dissolves back into noise. The player picks which of four shape previews matches, 3 attempts, flat reward on success, 0 on failure. Difficulty tuned speed, path complexity, and decoy count. This is exactly what the Fireflies plugin re-implements.

### The caster model

Battery 0-100 with trickle recharge, resonance 0-100 that never builds on its own and is consumed entirely on every cast ("use it or lose it"), battery-tier base chaos dampened multiplicatively by resonance, spells as data with typed effects and chaosEffects. Most of this is recognizably the ancestor of what shipped in 043; the differences are the battery-tier chaos (dropped, see loose end 3) and resonance acquisition (never ported).

## 3. How other engines draw this line

Surveyed: Unreal's Gameplay Ability System, Unity ScriptableObjects / Godot Resources, Ink and Yarn Spinner, Cataclysm DDA's JSON content system, GDevelop behaviors/extensions, Ren'Py's mini-game hosting, plus boardgame.io and RPG Maker as edge cases. Full citations in the appendix. The patterns that repeat:

1. Mechanism in the engine, policy in the game. No surveyed engine names a stat. The engine ships value storage, modification pipelines, persistence, observation; the game supplies the nouns. Sugarmagic already conforms - 043's "zero hardcoded battery" rule is exactly this.
2. The boundary is a string-keyed registry of typed hooks. Data refers to behavior by name; game/plugin code registers the implementation; missing bindings fail loud at load. Our `mechanics.emitHandler` seam and castable ids are this pattern.
3. Expression-strings-in-JSON is the known failure slope. Cataclysm's Effect On Condition system accreted variables, conditionals, and recursion inside JSON until it became an untooled programming language. The systems that age well cap the data format and put real logic behind named hooks. Our DSL's hard cap (four ops, no loops, no user functions) is the right guardrail - the lesson is to hold that line when content pressure asks for a fifth op, and prefer a new emit + plugin over growing the language.
4. Mini-games are hosted activities with a lifecycle contract. Ren'Py's model: the engine owns mounting, input focus, pausing the outer world, and typed result return; the activity owns everything inside. Persistent outcomes flow back through the shared state system, never sideways. Plan 044's seam (mount root, input claim, dispatchCastable on completion) is already this shape.
5. Extract generic substrates from concrete examples, not up front. Unreal's ability system was extracted from real games, and its own community warns it is overkill until several interacting consumers exist. With one game, resonance-specific behavior belongs in project data plus at most one plugin; a generic "attribute framework" beyond what stats already give us is not warranted.

The overall verdict from precedent: the architecture we already have is the recommended one. What is missing is not machinery redesign, it is one small engine primitive and a few blocks of wordlark data.

## 4. Recommended direction

### R1: Add one engine primitive - a placed world interactable that invokes a castable

The only truly missing general capability is "a thing placed in the world that, when interacted with, dispatches a `CastableInvocation`." Items already do exactly this (`trigger-castable`); the world has no equivalent. This primitive is game-agnostic (a shrine, a lever, a charging dock, a save point are all the same shape) and it is the last link in the chain. It needs: an authoring surface (place it in a region, point it at a castable, optional prompt text and cooldown - and this time enforce the cooldown), and runtime interact handling that runs the invocation.

Deliberately not proposed: a `ResonancePointDefinition`. That was Proposal 002's framing and 043 rightly killed it. A resonance point is just a placed castable-trigger whose castable happens to emit the mini-game.

### R2: Express resonance points as wordlark data on top of R1

Pure authoring, no engine code, and it makes resonance real:

- Castable `attune`: `onCast: [{op: "emit", kind: "fireflies-open"}]`, invoked by the placed world trigger.
- Fireflies plugin config: open on `fireflies-open`, on success dispatch castable `gain-resonance`.
- Castable `gain-resonance`: `{op: "set", target: "caster.resonance", value: "min(100, caster.resonance + self.reward)"}`.
- Give Finder (and future spells) a nonzero `chaosBase` so resonance matters, and decide whether to author battery-tier risk back in (the branch conditions can express it: e.g. a chaos term that grows as `caster.battery` falls).

This is also the proof that Plan 044's "integration is pure data" claim holds; if it does not, the seam gets fixed, not bypassed.

### R3: Decide the spell acquisition model

The "spells are apps you install on the Caster" idea is not what is built. Today every project spell is registered on the caster and visibility is gated by tag allow/block lists seeded once at spawn; nothing can grant a spell mid-game. If install-an-app is still the vision (it fits the iphone-like fiction and gives quests a reward verb), that is a small system: installed-spell ids as runtime state in a save slice, a grant mechanism (quest action, item, or castable op via emit + handler), and the menu filtering on it. If tag gating is enough for now, say so and defer. This is a design decision, not an architecture one.

### R4: Reconciliation and cleanup

Fold into the epic as small stories: remove or wire the dead `PlayerCasterProfile` initial-stat fields; delete the superseded chaos math in `caster/math.ts` (keep `resolveBatteryTier` or move it); fix Plan 043's status header; update Proposal 002's canonical-definitions list; reconcile or retire Plan 042's `SpellEffectType` framing; write the missing ADR recording the mechanics architecture (stats/castables/four ops, the plugin seam, the no-hardcoded-nouns rule) since it is now a settled constraint, which is what ADRs are for here.

## 5. Open decisions

1. Spell acquisition: install model now, or tag gating for the foreseeable future? (R3)
2. Should battery level influence chaos again, as in Sugarengine, or is per-spell `chaosBase` plus resonance the intended model?
3. Resonance economy: old rules were "consumed entirely every cast" and flat mini-game rewards. Keep, or take the rackwick example's variant (successful casts build resonance, chaos resets it, slow decay)?
4. Cooldown on world triggers: authored-but-unenforced in the old game. Enforce in R1, and if so, note it must not persist as a raw wall-clock timestamp in the save slice.
5. Is the Fireflies puzzle the mini-game for resonance points, or do we want difficulty/variety beyond its easy/medium/hard axis before wiring it in?

## Appendix: sources

- Current code: `packages/domain/src/mechanics/`, `packages/runtime-core/src/mechanics/`, `packages/runtime-core/src/caster/`, `packages/plugins/src/catalog/fireflies/`, `packages/workspaces/src/design/`; wordlark project data at `~/projects/wordlark/project.sgrmagic`.
- Docs: `docs/mechanics-authoring.md`, `docs/mechanics-examples/`, plans 017, 043, 044, 042, proposals 002, 005.
- Old game: github.com/nikkileaps/sugarengine - `src/engine/resonance/`, `src/engine/ui/ResonanceGameUI.ts`, `src/engine/caster/`, `docs/adr/012-caster-spells-resonance.md`.
- Precedent: Unreal GAS (dev.epicgames.com, Understanding the Gameplay Ability System; Gameplay Attributes and Effects), Unity ScriptableObjects (unity.com/how-to/separate-game-data-logic-scriptable-objects), Godot Resources (godotlearning.com/blog/godot-resources-explained), Ink external functions (github.com/inkle/ink, RunningYourInk.md), Yarn Spinner variable storage (docs.yarnspinner.dev), Cataclysm DDA JSON/EOC docs (docs.cataclysmdda.org/JSON) and EOC bug 76079, GDevelop behaviors and extensions (wiki.gdevelop.io), Ren'Py creator-defined displayables (renpy.org/dev-doc/html/cdd.html), boardgame.io, RPG Maker plugin aliasing and notetags (forums.rpgmakerweb.com).
