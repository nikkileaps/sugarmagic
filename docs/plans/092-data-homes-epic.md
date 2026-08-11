# 092: The Deployed Game Teaches

Paul is the first outside player. He can already reach the game, sign up, save
and talk to NPCs. What he cannot do is learn anything: every scripted line
renders in authored English at every band, item and document text the same,
and the Teacher has no idea what any scene is about.

Status: Draft, NOT LOCKED. epic-review ran 3 rounds without converging; a
narrowly-scoped investigation then established the ground truth below, three
stories were split out to `sugarmagic-scene-vocab-o8f`, and a confirming pass
found four more real issues, now applied.

Then nikki corrected the transport: these artifacts ARE assets and belong in
`assets/`, following the baked-navmesh precedent -- which removes the deploy
work the earlier drafts feared.

One open fork remains, deliberately NOT resolved here: when variants enter the
artifact set (092.4). nikki's call, 2026-08-09: decide it at the top of its own
story, with the code in front of you, rather than blocking the whole plan on a
guess. The story says so at the point of the fork. The other fork -- where a
bake-coverage check runs -- left with the preflight story; see Deferred.
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

## The transport: they are assets, and assets already work

nikki, 2026-08-09: this is data that must be downloaded to the player's browser
before they can play. That is the definition of an asset, and `assets/` is the
concern that owns it. No exception to any rule is needed.

**The precedent is the baked navmesh**, which is the same shape exactly: a
Studio-side bake produces it, it is written into `assets/` as a binary,
referenced off the region (`region.navMesh.assetPath`), and it ships. Plan
069.8 built it, and there is a regression test guarding it because when the
path was NOT collected, "NPC pathfinding silently fall[s] back to
straight-line after a restart... even though the bake persisted fine"
(`packages/testing/src/navmesh-asset-path.test.ts:4-9`). Same artifact shape,
same silent-degradation failure, already solved.

**One collector does both jobs.** `collectFileBackedAssetPaths`
(`domain/src/asset-paths.ts:28`) is "the single collector that decides which
files re-load into the asset-source store on project open (and ship to
deployed games)". Adding a source to it gets reload-on-open AND
ship-to-production from one edit.

**And deploy already carries them, unconditionally:**

    if [ -d assets ]; then
      mkdir -p .sugarmagic/published-web/dist/assets
      cp -R assets/. .sugarmagic/published-web/dist/assets/
    fi

(`github-workflow.ts:509-512`.) No workflow change, no
`SUGARDEPLOY_WORKFLOW_TEMPLATE_VERSION` bump, no ledger entry, no game-repo
re-save. Earlier drafts of this plan listed all four as the cost of shipping
files; they are the cost of shipping files to a NEW location, not to
`assets/`.

**Cache headers come out right for free.** `/assets/*` is `immutable,
max-age=31536000` (`published-web.ts:200-212`), which is correct when the
filename carries the content hash -- and the hash is already the cache key the
bake computes.

### What is actually left to build

One thing: the bake cannot write files. Every bake writer lives in
`packages/plugins`, whose dependencies are mantine, domain, runtime-core, ui,
supabase-js and ajv -- no `@sugarmagic/io`. Studio has that capability and
already hands it down as a callback to the mask painter
(`apps/studio/src/App.tsx:2160,2378,2431` -> `writeBlobFile`/`writeMaskFile`).
The same move works here.

### The config slot is NOT the answer, and the earlier drafts were wrong

Rounds 1 and 2 of epic-review moved this plan onto
`pluginConfigurations[sugarlang]`, reasoning that it was the only transport
already reaching production. That was true and beside the point: it puts
derived output inside `project.sgrmagic` AND inside the file the game fetches
before it renders anything, which is the exact failure ADR 005's Context
names -- "'One source of truth' is often misread as 'one giant file'. That
leads to editor bloat leaking into runtime load paths" (`:8`). Recorded so the
reasoning is not rediscovered and repeated.

The teach-plan document stays where it is (`teach-plan-state.ts`); it is small
and Studio-only. This is about the artifacts a PLAYER needs.

## Stories

Ordered so the cheapest real win lands first. 092.3 alone gives the deployed
Teacher its scene concepts -- though see that story: the cheap half is the
reading, not the getting.

### 092.1 Record the rule in ADR 005
Amend in place; write no competing taxonomy. One rule, one clarification:

**A derived artifact the PLAYER's machine cannot rebuild is an asset.** ADR
005 rule 3 calls derived runtime projections disposable, which is too loose:
losing one costs a rebake, and a rebake needs Studio, a gateway and money, so
a player can never perform it. Anything in that class travels with the game
the way the baked navmesh already does (Plan 069.8).

Also record: hand-edited variants (`saveVariant` writes
`generatedByModel: "manual"`, `editor-support.ts:985-997`) are AUTHORED
content sitting in a derived store, and must never live only there.

**Do NOT record a "config slot" rule.** Earlier drafts of this plan routed
artifacts through `pluginConfigurations`; that is superseded, and the reasoning
against it is in the transport section above so it is not rediscovered.
**Exit:** ADR 005 amended in place; sugarlang storage docs link to it; no
second taxonomy document exists; the amendment cites the navmesh precedent.

### 092.2 The bake writes artifact files into `assets/`
Scene context models and variants are written as files under the project's
`assets/`, named by their content hash, and registered through
`collectFileBackedAssetPaths` (`domain/src/asset-paths.ts:28`) exactly as
`region.navMesh.assetPath` is. That one registration gets both jobs --
re-load on project open, and ship to the deployed game -- and deploy carries
`assets/` wholesale already (`github-workflow.ts:509-512`), so there is no
workflow work.

**What this story actually builds:** a way for the bake to write a file.
`packages/plugins` has no `@sugarmagic/io`; Studio does, and already passes
that capability down as a callback to the mask painter
(`App.tsx:2160,2378,2431`). Follow that shape.

**Write the artifact where it is PRODUCED, with its hash in hand.** Do not
re-derive the set later by looking models up by
`{contentHash, supportLanguage, promptVersion}` -- that is
`buildSugarlangPreviewBootPayload` (`runtime/compile/preview-boot.ts:81-86`),
and any edit since the last Rebuild misses it and ships nothing. That is
`docs/backlog/013`, found in play 2026-07-31: "Editing any authored content in
a scene changes its content hash, so the cached model no longer matches and
the runtime reports it absent." The lookup is also impure (it resolves lore
through the gateway), so a run without a gateway URL silently ships zero.

**Filenames are STABLE, not content-hashed** (corrected 2026-08-09, during
the story). An earlier draft required content hashes in the name to beat the
`immutable, max-age=31536000` header on `/assets/*`. Plan 060 already solved
that: the deploy stamps EVERY `assetSources` URL with the deploy sha --
`jq '.assetSources |= with_entries(.value += "?v=" + $v)'`
(`github-workflow.ts:494`) -- "New deploy -> new URLs -> browsers fetch fresh
with no manual cache busting... Pairs with the immutable Cache-Control".

Stable names matter for more than tidiness: a changing filename changes the
DECLARED PATH LIST, and that list lives in the project, so every edit would
write the session and push an undo checkpoint. With stable names the path
list is written once and left alone -- so a file write costs nothing on the
session side, and the "one write per bake" rule below applies only to the
declaration, not to the artifacts.

IndexedDB is demoted to a read cache. Studio's reader must rehydrate from the
files -- `readSugarlangCompileStatus` derives everything from IndexedDB
`listEntries()` (`editor-support.ts:267-299,372-374`) and would otherwise
report a fresh browser as un-baked. Hand-edited variants must survive the
same trip.

One config write, not one per artifact: `editor-support.ts:745` fires
`onTeachPlanDocument` exactly once after the scheduler stops -- copy that shape
for the path declaration. Artifact FILES may be written as they are produced;
they never touch the session.
**Depends on:** 092.1.
**Exit:** bake, clear ALL browser storage, reopen the project -- Studio reports
the artifacts present and Rebuild finds nothing stale; the files are in
`assets/` and survive a fresh clone; a hand-edited variant survives the same
test; a scene edited AFTER its last Rebuild still produces artifacts; two
consecutive bakes of unchanged content produce byte-identical files.

### 092.3 Scene contexts reach the deployed Teacher
**CONSUMPTION is free; PRODUCTION is not.** Once a model is in the artifact
set it travels whole and is looked up by `sceneId` with no hash and no workspace
involved -- bake writes `sceneId: input.region.identity.id`
(`scene-traversal.ts:642`), the runtime reads the same
(`runtime-core/src/spatial/index.ts:417`), seeding is a plain map
(`runtime-cache-state.ts:83`), and the Teacher asks for it by id
(`teacher-middleware.ts:361` -> `runtime-services.ts:421`). The runtime fetches
the artifact file the way it fetches any other asset.

But GETTING a model into the artifact set goes through the hash lookup 092.2
warns about, and that failure is invisible -- the only signal is a `console.warn`
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
ship as files (092.2) and be served from `MemoryVariantCache`
(`variant-cache.ts:85`), which already implements the same interface.

Both construction sites gate on `studioWorkspaceId` and must be handled:
`getVariantCache()` (`runtime-services.ts:462`, item views, consumed by
`display-text-resolver.ts:168` via `manifest.ts:160`) and the per-conversation
cache (`:1018`, consumed by `sugar-lang-scripted-middleware.ts:174,344`). Preview keeps its live IndexedDB read so
a hand-edited variant still appears with no save
(`variant-popover-connected.tsx:43-79`).

**When do variants enter the artifact set?** They have no bulk
bake -- `docs/backlog/007`: "bulk variant baking has never existed in
production" -- so they arrive from per-node popover clicks
(`contributions.ts:274,286` -> `editor-support.ts:847-848`). Writing config on
every click hits exactly the undo-checkpoint problem 092.2 exists to avoid, and
a deploy-time sweep needs `listEntries()` plus per-key `get()` because the
interface has no bulk read (`variant-cache.ts:55-61`). Pick a collection
moment -- most likely a sweep at bake/save time, since a click cannot write a
file on its own.

**RESOLVED by 092.2: a sweep at save time**, exactly as guessed above.
`collectVariantArtifact` walks `listEntries()` and reads each key, prunes stale
machine drafts and KEEPS hand-written ones, and the file is written when the
project saves. There are 28 entries in wordlark's artifact today, one of them
hand-authored. Nothing further to decide here.

The seeded cache must be sized explicitly:
`MemoryVariantCache` defaults to `maxEntries: 400` and 10 MB, and `set()`
evicts least-recently-used silently (`variant-cache.ts:92-93,144`). 100 lines x
6 bands is 600 -- it would drop a third of them with no warning.
**Depends on:** 092.2.
Also fix the comment on `getVariantCache()` claiming a published game has
"nothing graded anyway" -- this story is what makes it false, so it does not
belong in 092.8.
**Exit:** on a clean browser, a scripted beginner line renders its baked
variant rather than English, and item text likewise; editing a variant in
Studio still shows in Preview with no save.

### 092.6 A player's own data lives locally and syncs to their account
The word history is not tied to the account AT ALL. `IndexedDBCardStore` opens
`sugarlang-card-store:${profileId}` (`card-store.ts:268`) where `profileId` is
`buildLearnerId` = `${playerEntityId}:${targetLanguage}:${supportLanguage}`
(`runtime-services.ts:213-218`). No `userId` in it. So two accounts on one
machine SHARE a word history, and one account on two machines gets two. Its two
siblings key the same way -- `TeachRecordStore`
(`teach-record-store.ts:32,141-146`) and `EncounterDebtLedger`
(`encounter-debt-ledger.ts:42,293-298`). Syncing any of them as they stand
would push one player's words into another player's row, so the re-key is not
a nicety, it gates everything else here.

Separately the profile CORE -- the level, the placement record -- is not in a
store at all. `persistence.ts:306-311` writes it to `blackboard.setFact`, which
is memory for the life of the tab, and `:241-247` reads it back from there or
falls to a default. Paul is re-placed every session.

Earlier drafts said this must not ride in the game save, citing
`participant.ts:10-13` and ADR 020 `:47-57`. nikki: that ADR is misleading --
plugin data MAY travel the save path provided it is namespaced to the plugin,
opt-in, and absent entirely when the plugin is not installed. ADR 020 is
amended by this epic to say so. But the save path is still the wrong road HERE,
for a mechanical reason the earlier drafts missed: `SaveParticipant.serialize()`
is SYNCHRONOUS (`participant.ts:70`, "Sync, cheap; called every autosave tick")
and the word history lives behind async IndexedDB. It cannot be read there.

**The shape is local-primary with background sync**, which is the standard
local-first arrangement: the device holds the primary copy, the server is a
sync peer rather than a gatekeeper, and reconciliation is last-write-wins on a
server-stamped timestamp. Sizing says this is not exotic -- one record is ~305
bytes, and the entire dictionary at 11k words is 3.2 MB. The only thing that
was ever expensive is cadence, and sync has its own.

**Nothing in core or the host may name a plugin.** `runtimeHost.ts:63,1986,1990`
already imports `SUGARPROFILE_PLUGIN_ID` and branches on it to read
`playPageUrl`; that is the drift this mechanism must not repeat. Guard it the
way 092.1 guarded the asset collector -- a test that reads the source and fails
if a plugin name appears in it.

**Two customers prove the shape.** sugaragent's `NpcMemoryStore` has the same
unmet need and is ALREADY keyed correctly -- `userId` + `playthroughId` from
`getActiveUserId()`/`getActivePlaythroughId()`, throwing rather than writing
under a null key (`npc-memory-store.ts:528-537`). It is the model to copy and
the second customer to design against. It is NOT converted in this epic;
converting it is the proof the mechanism generalised, and belongs to whoever
needs NPC memory to follow a player.

Split into four stories. Order is forced: the key is wrong, so nothing may sync
until it is right.

#### 092.6.1 Re-key a player's local data to their account
Every per-player store this plugin owns keys on the account, reading
`getActiveUserId()` from runtime-core (NOT from another plugin), and refuses to
construct when identity has not settled rather than writing under a null key --
`npc-memory-store.ts:530-536` is the exact precedent, including the error text
pointing the caller at deferred construction.

Existing local data is DROPPED, not migrated: it cannot be attributed to an
account after the fact, so there is nothing to migrate it to. Learner data is
disposable in this project. `resetSugarlangLearnerDatabases`
(`reset-learner-data.ts:93-157`) already enumerates and deletes by DB-name
prefix and is the tool for it -- note it does not currently cover
`sugaragent-npc-memory:*` or `sugarmagic-saves` and must not start.
**Depends on:** nothing.
**Exit:** two accounts on one browser have separate word histories; one account
signing in twice on one browser sees one. Constructing a store before identity
resolves throws with a message naming the fix. A grep shows no per-player store
keyed without a `userId`.

#### 092.6.2 A general store any plugin can use: local primary, synced to the account
Runtime-core gains a keyed per-user record store. Local backing is IndexedDB
(memory fallback, as every existing plugin store already does) and is the
source of every read and write -- a local write IS the state. Reuse what is
here: `listPage(cursor, limit)` + `bulkSet` + `CARD_STORE_PAGE_SIZE = 250`
(`card-store.ts:25,164-176,192`) are the paging and batching shapes; the sync
wrapper is a Decorator over a plain local store, mirroring
`createSerializedSaveStore` (`serialized-store.ts:62`) including its
`Symbol.for` idempotency brand (`:49,65-68,98`) so wrapping twice is safe.

The remote backing is an INTERFACE in runtime-core with the Supabase
implementation contributed by a plugin, exactly as `GameSaveStore` is today
(`plugins/index.ts:311-319` for the contribution, `:604-627` for the
priority-wins resolver, `save-store.ts:55` for the Supabase impl). That is what
keeps core free of plugin names, and it means a project with no account plugin
installed still gets a working local store.

SYNCED VS LOCAL-ONLY IS DECLARED AT CREATION, NOT PER RECORD. A plugin asks for
a local store or a synced store and they are different types; only the synced
one carries sync metadata and a remote backing, and only synced stores are
registered with the sync loop. You cannot accidentally sync a local store, and
you cannot declare a synced one and forget to wire it. Plenty here must stay
local and must be named as such in the API docs: the Studio compile caches, the
telemetry ring buffer, project handles.

Record-shape migration is a PARAMETER of the store -- a current version plus an
upgrade function applied on read -- so plugins get it right by default rather
than by discipline. `migrateNpcMemoryRecord` (`npc-memory-store.ts:359-388`,
called at all four read sites) is the worked example; note it bumped the record
version without bumping `DB_VERSION` (`:54,69`) because no index changed.

ADR 020 IS AMENDED BY THIS STORY. It currently says plugin-domain data "lives
with that plugin in its OWN store" (`:47-57`) in terms that read as a ban on
the save path, and `participant.ts:10-13` repeats it. Both are rewritten to
state the actual rule: plugin data may travel a shared path when it is
namespaced to the plugin, opt-in, and absent when the plugin is not installed --
and that a per-player record store is the right home for data too large or too
async for a save slice. Without this the next author reads the old rule and
rebuilds the hand-rolled store.
**Depends on:** nothing (buildable alongside 092.6.1).
**Exit:** a throwaway plugin can declare one synced store and one local store,
write to both, and only the synced one appears in the sync registry. Core and
host source contain no plugin name -- enforced by a test that reads the files,
per 092.1. With no account plugin installed the local store still works. ADR
020 and `participant.ts` state the amended rule, and neither still reads as a
blanket ban.

#### 092.6.3 The sync loop
Push records marked dirty, pull records newer than a per-store watermark,
resolve last-write-wins on the server-stamped timestamp. Deletes propagate as
tombstones or they resurrect on the next pull. Dirty tracking is
append-on-mutation, which already exists as `changedCards`
(`persistence.ts:66,300-304`, pushed by `learner-state-reducer.ts:409-416`).

NOTHING IN THE REPO DOES LAST-WRITE-WINS TODAY -- `lastPlayed` and
`profiles.updated_at` are stamped by every writer and read by nobody, so the
comparison is new code with no precedent to copy. The server stamps the
ordering timestamp because client clocks are not trustworthy. The known hazard
is the silent overwrite: a local write that succeeded is quietly replaced by a
remote version that won. Log it rather than swallow it.

Sync runs on its OWN cadence and on triggers (sign-in, reconnect, tab hidden),
never on the autosave heartbeat -- that path stringifies its whole payload
every 5s to detect change (`useAutosave.ts:124-136`) and must stay small.

EACH PLUGIN OWNS ITS OWN TABLE, with real typed columns, and ships the
migration that creates it. The mechanism requires four columns of any such
table -- `user_id` (what row-level security scopes on), `record_key`,
`deleted`, and a trigger-stamped `updated_at` -- and the plugin supplies the
rest. One shared table holding every plugin's data as opaque JSON was the
first attempt and it was wrong: nothing could be indexed, constrained, or
asked a question. "How many words at this band does this player know" has to
be answerable by the database, not by pulling every row into the browser.

Core stays free of plugin names because the remote implementation is HANDED a
table rather than choosing one, and the deploy collects migrations by
iterating enabled plugins.

MIGRATIONS ARE NEW NUMBERED FILES, NEVER EDITS TO AN EARLIER ONE. `supabase
db push` records what it has applied by filename version and skips the rest --
"only the timestamps are compared" -- so editing a file a project already ran
changes nothing and reports success. Note `deployment/supabase.ts:29`
hardcodes `sugarprofile` to gate migration generation at all; that is an
existing coupling this extends rather than creates.

**Depends on:** 092.6.2.
**Exit:** a record written on browser A appears on browser B for the same
account after a sync, and does not appear for a different account. A delete on
A removes it from B. Editing the same record on both resolves to the later
write and says so in the log. With the network down, reads and writes keep
working and reconcile on reconnect.

#### 092.6.4 The level and the word history follow the player
Sugarlang's word history moves onto the synced store, and the profile core --
the level, the placement record -- stops living on the blackboard and becomes a
record beside it. `persistence.ts:296-311` already holds both the store and the
profile at the same call, so this is a change of destination, not of structure.
Retrievability stays derived on read (`persistence.ts:268-288`) and is still
not persisted; syncing a decayed value would bake in the instant it was read.
**Depends on:** 092.6.1, 092.6.3.
**Exit:** place, hard-refresh, level and placement status still there. Sign in
on a second machine and both the level AND the word history arrive. The API
docs state what a player gets on a new device and what happens when two devices
disagree.

### 092.7 Delete the dead code, or wire it up
Leave it better than we found it. The functions listed under "Dead paths" above
exist, look like working infrastructure, and are called by nothing -- they are
what fooled three rounds of review, and two stories in this epic were written
against them before anyone checked.

Every entry gets one of two answers: USED by a named story, or DELETED with a
grep exit. Deleting is the default; something is kept only if a story here
actually calls it and names it. Where a test is the only caller, the test goes
with the code -- `seedPreviewLexicons` has green tests for a branch that never
runs, which is exactly how it stayed hidden.

NO TEST EXISTS TO KEEP A PATH DEAD. An earlier draft carved out
`sugar-lang-scripted-middleware.test.ts` as guarding a deleted path and so
having to outlive its subject. nikki, reading it: a test whose subject is
absent code is confusing and keeps the ghost around. She is right, and the
carve-out was wrong for a second reason -- what those tests assert is a PRESENT
property (rendering a scripted line costs zero gateway calls) across two
inputs. Reframed in present tense; the second input is the hard case rather
than a duplicate, so nothing was removed.
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

- **Failing a deploy that ships an unbaked region.** Moved out to
  `sugarmagic-deploy-preflight-15i`. It guards against shipping without
  authored teaching content; this epic is about that content reaching a
  deployed game at all. The fork it turns on is unresolved and stated in the
  ticket: the content hash needs gateway lore resolution, so either the deploy
  makes that call or Studio hands over a coverage report.

- **Per-player data scoped by something other than a player.** The sync engine
  keys records on the player, deliberately. Widening that field to a
  general-purpose scope was considered and rejected: it works on the device,
  where it is only part of a database name, and cannot work in the database,
  whose isolation rule is "you may only read rows whose user_id is your
  account". **Trigger:** something genuinely needs per-chapter or per-region
  records. **Then:** add a column to that plugin's table plus a matching
  security rule -- not a wider key. The note lives on `RecordStoreKey.userId`
  too, which is where someone will actually be standing when they need it.

- **Episode-scoping the published artifact.** `sugarmagic-boot-scoping-j24`.
  Must key on (region, scene) -- `sceneId` is the REGION id
  (`scene-traversal.ts:642`). NOW COVERS THE VARIANT FILE TOO: 092.4 ships
  every graded line for every episode in one file loaded whole, so the
  in-memory cache needs a hard ceiling sized to the whole game. That number is
  a workaround for the missing scope, and getting it wrong renders authored
  English silently. **Trigger:** the ceiling has to be raised, or a line
  renders English where graded text exists.
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
