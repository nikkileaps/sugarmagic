# 092: The Deployed Game Teaches

Paul is the first outside player. He can already reach the game, sign up, save
and talk to NPCs. What he cannot do is learn anything: every scripted line
renders in authored English at every band, item and document text the same,
and the Teacher has no idea what any scene is about.

Status: Draft, NOT LOCKED. epic-review ran 3 rounds without converging; a
narrowly-scoped investigation then established the ground truth below, three
stories were split out to `sugarmagic-scene-vocab-o8f`, and a confirming pass
found four more real issues, now applied.

Two open forks are deliberately NOT resolved here -- when variants enter the
payload (092.4) and where the bake-coverage check runs (092.5). nikki's call,
2026-08-09: decide each at the top of its own story, with the code in front of
you, rather than blocking the whole plan on two guesses. Each story below says
so at the point of the fork. Everything else is executable as written.
Branch: data-homes

## Ground truth: what actually reaches the runtime today

Traced link by link in Studio Preview, with a hash probe run against the real
wordlark project. This replaces three rounds of plan-level guessing.

| chain | preview today | why | prod needs |
|---|---|---|---|
| **scene contexts** | consumption LIVE; ASSEMBLY hash-gated | runtime lookup is by `sceneId`, no hash -- but getting a model INTO the payload goes through a hash that any edit invalidates (backlog 013) | the payload, captured at extraction time |
| **variants** | LIVE, but structurally preview-only | a same-origin IndexedDB read (`studioWorkspaceId`), not a payload | variants IN the payload + `MemoryVariantCache` |
| **lexicons** | plumbing live, **seed inert** | runtime recomputes a DIFFERENT hash and overwrites the seed | out of scope -- `sugarmagic-scene-vocab-o8f` |
| **authored chunks** | **DEAD, and dead in Preview too** | wrong IndexedDB database; preview self-populates a chunk-less lexicon first | out of scope -- same ticket |

Every chunk match in the game today comes from the bundled competency
inventory (`getAllInventoryExponents`), which is compiled into the JS and works
identically in prod -- so chunk matching is not broken for Paul, it is just
not yet informed by authored scenes.

### The scene vocabulary pipeline is broken, and it is SOMEBODY ELSE'S ticket

`sugarmagic-scene-vocab-o8f`. Three compounding faults: lore text is folded
into a scene's vocabulary (supply) when it belongs on the concept side
(demand); the bake and the runtime therefore compute different scene content
hashes, so the seeded lexicon is never used; and authored chunks reach the
classifier by no route at all, in production OR in Preview.

**Deliberately out of this epic.** The two things Paul actually needs are
immune to all of it: scene contexts are keyed by `sceneId`, and variants are
keyed by `nodeId + text` (`dialogue-node-source.ts:70-72`) -- neither touches
the scene content hash. And authored chunks have never worked, so nothing
regresses by leaving them alone.

Do not fold it back in without re-reading that ticket; the three faults have
to be fixed in order, and the first one probably dissolves the second.

### Dead paths that read as working

These fooled three rounds of review. Each verified by finding zero callers:

- `seedPreviewLexicons` early-returns on `payload.lexicons`; the field is
  `compiledScenes` (`runtime-services.ts:318`). `previewLexicons` is therefore
  always empty, so `sceneLexiconStore.seed()` at `:1016` never runs. Only
  integration tests send the shape it wants.
- `mergeChunks` (`scene-lexicon-store.ts:25,59`) -- zero callers.
- `"sugarlang.scene-chunks-updated"` -- emitted through an optional hook never
  supplied at the sole construction site (`editor-support.ts:639-658`); no
  listener exists.
- `serializeState`/`loadState` -- dispatch implemented
  (`runtime-core/src/plugins/index.ts:514-530`), zero call sites, five plugins
  producing `{enabled}` into a void.
- `publishSugarlangArtifacts` -- zero production callers, node-only imports
  (`:21-23`), profile-mismatched (`:88`).
- Line-intent cache -- constructed and written, never read
  (`runtime-services.ts:918,936`).

### The workspace-id mismatch, concretely

Studio's bake writes chunks into `sugarlang-compile-cache:sugarlang-studio:{projectId}`
(`editor-support.ts:591` via `resolveStudioCompileWorkspaceId`). Preview boot
reads `sugarlang-compile-cache:{navigationWorkspaceId}` (`App.tsx:824` passes
`snapshot.activeWorkspaceId`). Different databases. And preview compiles fresh
and `cache.set`s into the nav-workspace DB first
(`catalog/sugarlang/preview-boot.ts:112-114`), so the later `get` HITS and
returns a chunk-less lexicon. The in-file comment claims the compile cache
"survives the mismatch because it can recompile" -- true for lemmas, false for
chunks.

## The transport

`pluginBootPayloads` is a plain `Record<string, unknown>` handed to
`host.start` (`runtimeHost.ts:326`) -- nothing about it is preview-only.
`buildBootJsonPayload` simply never emits the key
(`published-web.ts:103-175`), which the live `boot.json` confirms.

`pluginConfigurations` already reaches production (`published-web.ts:119`; the
deployed file carries 212 bytes of sugarlang settings). Teach plans already
persist a derived artifact there via `UpdatePluginConfiguration`
(`ui/shell/contributions.ts:141-162`) -- though note that precedent is
Studio-only by its own header: "Nothing in a shipped game reads or writes
this" (`teach-plan-state.ts:45-47`). The write half is proven; the read half
is new work.

**Caveat to record in 092.1:** `normalizeSugarLangPluginConfig`
(`config.ts:117+`) returns only declared fields and discards unknown keys, so
artifacts must be read raw off `context.configuration.config[KEY]`, bypassing
the plugin's own normalizer.

### Why not project-directory sidecars yet

1. **`packages/plugins` cannot write to the project directory** -- deps are
   mantine, domain, runtime-core, ui, supabase-js, ajv; no `@sugarmagic/io`.
   Every bake writer lives there. The mask writer is Studio-side, passed down
   as a callback.
2. **Transport is not free.** Deploy stages a FIXED list
   (`github-workflow.ts:481-512`). `git add -A` reaches the game repo
   (`sugardeploy/host/middleware.ts:2143,2381`) but nothing stages sidecars
   into the Netlify `dist/`. Also needs a template version bump (`:56`) with a
   ledger entry (`:97`), a game-repo re-save, and cache headers.
3. **Correction from round 2:** an earlier draft claimed managed-file drift
   would halt saving "including boot.json". Wrong -- `project.sgrmagic` and
   regions are written at `project-lifecycle/index.ts:384-396`, BEFORE the
   drift check at `:418`, and that early return is unreachable because
   `drifted` is a subset of `changed` and Studio always passes
   `overwriteManagedFiles` when `changed > 0` (`App.tsx:561`).

Sidecars remain right eventually, on ADR 005 grounds. Deferred with a trigger.

## Stories

Ordered so the cheapest real win lands first. 092.3 alone gives the deployed
Teacher its scene concepts -- though see that story: the cheap half is the
reading, not the getting.

### 092.1 Amend ADR 005 with the travel rule
Amend in place; write no competing taxonomy. Content: derived projections the
RUNTIME cannot rebuild must travel with the game, because a rebake needs
Studio, a gateway and money. Name the transport, the untyped-channel caveat
above, and the tension with ADR 005's own Context ("'One source of truth' is
often misread as 'one giant file'... editor bloat leaking into runtime load
paths", `:8`) with sidecars named as the end state.
**Exit:** ADR 005 amended in place; sugarlang storage docs link to it; no
second taxonomy document exists.

### 092.2 Put the sugarlang payload into boot.json
`buildBootJsonPayload` emits `pluginBootPayloads.sugarlang`, sourced from the
plugin config slot written at bake time. This is the transport every story
below rides. Payload shape stays `SugarlangPreviewBootPayload` so preview and
prod share one contract; extend the type where a story below requires it
(variants), rather than inventing a parallel shape.

Bake must persist without an explicit save -- `UpdatePluginConfiguration` only
sets `isDirty` (`authoring-session/index.ts:1338`) and `requestSave` is absent
from `PluginDesignSectionRenderProps` (`packages/plugins/src/shell/index.ts:79-101`).
Today IndexedDB covers a tab close; after this it must not lose gateway-funded
work. Batch to ONE write per bake: every command pushes a whole-project
checkpoint onto an undo stack that is never truncated (32 sites), so per-band
writes would bury Ctrl+Z. Serialization must be deterministic or every save
pops the overwrite dialog (`App.tsx:519-545`).
**CAPTURE AT EXTRACTION TIME, NEVER RE-DERIVE AT DEPLOY.** The obvious move --
reuse `buildSugarlangPreviewBootPayload` to assemble the payload -- is a trap.
That builder looks each model up by `{contentHash, supportLanguage,
promptVersion}` (`runtime/compile/preview-boot.ts:81-86`), so any edit since
the last Rebuild misses and ships nothing. That is `docs/backlog/013`, found in
play 2026-07-31: "Editing any authored content in a scene changes its content
hash, so the cached model no longer matches and the runtime reports it
absent." The hash is also impure -- assembly resolves lore through the gateway
first -- so a run without a gateway URL silently ships zero. Write artifacts
into the config slot where they are PRODUCED, with the hash already in hand.

Pattern to copy for the single write: `editor-support.ts:745` fires
`onTeachPlanDocument` exactly once after the scheduler stops, and
`contributions.ts:140-162` turns it into one command. A third save option the
list above omits: `plugins/sdk.ts:36` + `App.tsx:584` already implement a
silent save for workspace views.
**Depends on:** 092.1.
**Exit:** a deployed `boot.json` contains `pluginBootPayloads.sugarlang`; bake,
close the tab without saving, reopen -- artifacts still present; one bake
produces one undo entry; two consecutive saves are byte-identical; and editing
a scene after a Rebuild still ships that scene's artifacts (the backlog-013
case).

### 092.3 Scene contexts reach the deployed Teacher
**CONSUMPTION is free; ASSEMBLY is not.** Once a model is in the payload it
travels whole and is looked up by `sceneId` with no hash and no workspace
involved -- bake writes `sceneId: input.region.identity.id`
(`scene-traversal.ts:642`), the runtime reads the same
(`runtime-core/src/spatial/index.ts:417`), seeding is a plain map
(`runtime-cache-state.ts:83`), and the Teacher asks for it by id
(`teacher-middleware.ts:361` -> `runtime-services.ts:421`).

But GETTING a model into the payload goes through the hash lookup 092.2 warns
about, and that failure is invisible -- the only signal is a `console.warn`
(`preview-boot.ts:93`), and the HUD says "(not built)" whether the build never
ran or the key merely disagreed. So this story's real work is proving the
model is there, not proving the Teacher can read it.
**Depends on:** 092.2.
**Exit:** on a browser that has never run Studio, the boot log shows scene
context models seeded > 0 and an NPC turn cites something specific to the
scene; a scene edited AFTER its last Rebuild still ships its model; and a
missing model reports WHY -- never built vs key mismatch -- rather than a bare
zero. Studio's "they will not teach what your scenes are about" warning no
longer describes production.

### 092.4 Variants reach the deployed game
Chain D is structurally preview-only: it reads Studio's IndexedDB by
`studioWorkspaceId`, and a deployed origin has no such database. Variants must
ride the payload and be served from `MemoryVariantCache`
(`variant-cache.ts:85`), which already implements the same interface.

Both construction sites gate on `studioWorkspaceId` and must be handled:
`getVariantCache()` (`runtime-services.ts:393-399`, item views) and the
per-conversation cache (`:915-917`). Preview keeps its live IndexedDB read so
a hand-edited variant still appears with no save
(`variant-popover-connected.tsx:43-79`).

**Resolve before Lock: when do variants enter the payload?** They have no bulk
bake -- `docs/backlog/007`: "bulk variant baking has never existed in
production" -- so they arrive from per-node popover clicks
(`contributions.ts:274,286` -> `editor-support.ts:847-848`). Writing config on
every click hits exactly the undo-checkpoint problem 092.2 exists to avoid, and
a deploy-time sweep needs `listEntries()` plus per-key `get()` because the
interface has no bulk read (`variant-cache.ts:55-61`). Pick a collection
moment. **DECIDE THIS FIRST, before writing any of this story** -- it changes
what the story is.

If a bulk bake IS added, size the seeded cache explicitly:
`MemoryVariantCache` defaults to `maxEntries: 400` and `set()` evicts LRU
silently (`variant-cache.ts:92,144`). 100 lines x 6 bands is 600 -- it would
drop a third of them with no warning.
**Depends on:** 092.2.
**Exit:** on a clean browser, a scripted beginner line renders its baked
variant rather than English, and item text likewise; editing a variant in
Studio still shows in Preview with no save.

### 092.5 Deploy preflight: unbaked scenes fail loud
Runtime degrades, build fails loud. Preflight must fail on a scene NEVER baked,
not only a stale one -- the bake covers only the scene Studio has open
(`editor-support.ts:585-590`), so "only chapter one is baked" is the likely
real failure.

The check runs host-side, but note the hash is NOT pure: it needs gateway lore
resolution. Either the host makes that call, or Studio posts a computed
coverage report. **DECIDE THIS FIRST, before writing any of this story** -- it
is the difference between a small story and a large one.
The existing `Verify boot.json exists` gate (`github-workflow.ts:386-391`) is
the shape.

**COVERAGE IS PER REGION, NOT PER NARRATIVE SCENE, AND MUST SAY SO.** The
artifact key `sceneId` is the REGION id (`scene-traversal.ts:642`), and the
bake composes ONE `activeScene` overlay across all regions
(`editor-support.ts:584-588`) after invalidating the cache (`:599`). So a
project baked under Scene 1 reads as fully covered, and seeding overwrites per
region id. Naming coverage per (region, narrative Scene) needs a hash per pair
-- real work that belongs with `sugarmagic-boot-scoping-j24`, not here. Scope
this story's exit to regions and say why.
**Depends on:** 092.2.
**Exit:** deploying with one REGION unbaked fails preflight naming it;
rebaking clears it; a fully-baked project dispatches. The story states in
writing that a second narrative Scene over an already-baked region is NOT
covered, and points at the deferred ticket.

### 092.6 Learner profile survives a reload
Known defect: `docs/api/sugarlang-learner-state.md:89-98` states the CEFR
posterior, `estimatedCefrBand`, the `assessment` record and placement status
do not survive reload; `persistence.ts:306-311` writes only to
`blackboard.setFact`. Paul is re-placed every time he returns.

It must NOT ship as a `SaveParticipant` -- that contract says "A participant is
NOT a hatch for plugin domain data to ride in GameSave"
(`save/participant.ts:10-13`), and ADR 020 names "sugarlang's learner
blackboard" explicitly (`:47-57`).

**Put it next to the cards; that needs no new seam.** ADR 020 prescribes a
plugin-owned store keyed on `userId`, and one already exists for the sibling
data -- `IndexedDBCardStore`, opened as `sugarlang-card-store:${profileId}`
(`card-store.ts:32,268`). `persistence.ts:296-311` already holds both the card
store and the profile at the same call where it writes the blackboard fact, so
the profile core becomes a record beside the cards. This is the decision that
sets the story's size: `serializeState`/`loadState` is the other candidate and
**has zero call sites**, so choosing it would mean owning the persist and
restore call sites too. Two earlier drafts of this plan picked seams without
checking whether anything called them.
**Depends on:** nothing.
**Exit:** place, hard-refresh, band and placement status still there. State
explicitly what a second device gets -- the band restores but cards are
device-local, and a band with no cards is a behaviour someone signs off.

### 092.7 Delete the dead code, or wire it up
Leave it better than we found it. The functions listed under "Dead paths" above
exist, look like working infrastructure, and are called by nothing -- they are
what fooled three rounds of review, and two stories in this epic were written
against them before anyone checked.

Every entry gets one of two answers: USED by a named story, or DELETED with a
grep exit. Deleting is the default; something is kept only if a story here
actually calls it and names it. Where a test is the only caller, the test goes
with the code -- `seedPreviewLexicons` has green tests for a branch that never
runs, which is exactly how it stayed hidden. EXCEPT where a test exists to keep
a path DEAD: `tests/middlewares/sugar-lang-scripted-middleware.test.ts:77-105`
guards the deleted intent read path and must outlive its subject.
**Depends on:** 092.4 and 092.6 -- the two stories that might claim one.
Run it LAST so the answers are decisions, not guesses.
**Exit:** each item is USED-by-`<story>` or DELETED; for every DELETED item a
grep over source AND tests returns nothing; suite green, and each removed test
names the code it covered.

### 092.8 Truth repairs
- `runtime-services.ts:390` claims a published game has "nothing graded
  anyway" -- false once 092.4 lands.
- Studio cites `public.game_save`
  (`apps/studio/src/plugins/catalog/sugarprofile/index.tsx:626`); the table is
  `saves`. Depends on nothing; do it first.
- `catalog/sugarlang/preview-boot.ts:121-128` claims the compile cache
  "survives the mismatch" -- true for lemmas, false for chunks. Fix once 092.7
  lands.
**Depends on:** 092.4 (first item only; the others depend on nothing).
**Exit:** `grep -rn game_save --include='*.ts' --include='*.tsx'` over source
finds nothing; both comments describe shipped behavior.

## Deferred, with triggers

- **Sidecar artifact files.** Right eventually on ADR 005 grounds. **Trigger:**
  when `boot.json` or `project.sgrmagic` growth from artifacts is what a player
  or author waits on. Cost: GHA staging step, template bump + ledger entry,
  game-repo re-save, cache headers (`/assets/*` is `immutable,
  max-age=31536000`, and only `.assetSources` gets the `?v=<sha>` stamp).
- **Episode-scoping the published artifact.** `sugarmagic-boot-scoping-j24`.
  Must key on (region, scene) -- `sceneId` is the REGION id
  (`scene-traversal.ts:642`).
- **Preview writing to the production database.** `sugarmagic-preview-data-bu1`.
- **Cross-device learner cards.** Cards are device-local because the store is
  IndexedDB (`runtime-services.ts:221-229`), not because persistence is
  missing. Not a recorded non-goal. **Trigger:** a tester plays on two machines
  and reports lost progress.

## Sizing

~100 variant records at ~400 bytes is about 50 KB against a 1.9 MB `boot.json`
and a 9.6 MB bundle. No optimisation warranted now. Later: variants are keyed
by target language, but scene contexts are NOT -- they key on
`supportLanguage` because "concepts are English, so one extraction serves every
target language" (`editor-support.ts:688-690`). And `getTargetLanguage` cannot
read a per-player language yet (`runtime-services.ts:366-374`), so a deployment
has one language today.

## The Supabase invariant

**sugarmagic never writes rows to Supabase; deployment is the only door.** Only
tables are `saves`/`profiles`; deploy only EMITS migration files
(`deployment/supabase.ts:164-183`), applied by the explicit Apply Migration
button. RLS scopes every row to its owner and `handle_new_user()` creates
Paul's profile on signup (`supabase.ts:89-135`), so one shared database for dev
and prod is correct at this size.

## Verification

Paul, on a machine that has never run Studio, signs up and plays: scripted
lines render in graded target language at his band, item and document text too,
the Teacher speaks to what the scene is actually about, and his band and
progress are still there when he comes back.
