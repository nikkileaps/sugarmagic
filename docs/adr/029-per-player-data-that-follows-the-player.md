# ADR 029: Per-player data that follows the player

## Status

Accepted.

## Context

A player accumulates things that belong to them rather than to the game: which
words they have met and how well they know each one, what level they are, what
an NPC remembers about them. Before this, every one of those lived in one
browser and nowhere else.

Three problems came from that, and only the first was obvious.

**It did not follow anyone.** Sign in on a second machine and you were a new
person. Worse, the level and the words were stored differently — the words in
real storage, the level only in memory — so a returning player arrived with
their whole vocabulary and no level attached to it, and was put through
placement again. Every session.

**It was not keyed to the account.** The storage name identified the player
character and the language pair, not the person. Two accounts on one browser
shared one word history. Nothing failed; it silently mixed people together.

**Every plugin solved it again.** Four separate stores existed, each with its
own interface, its own database, its own memory fallback, and its own idea of
how to key a player. Most of them got the keying wrong, and there was no single
place where "this is how per-player data works" was written down or enforced.

## Decision

### The device holds the primary copy; the account is a peer

Reads and writes go to local storage and return immediately. Reconciling with
the player's account happens afterwards, on its own schedule. A local write IS
the state.

This is the standard local-first arrangement, and it is chosen for two
properties beyond offline play. It keeps a turn's cost independent of the
network, and it keeps data that grows off the save path — the shared save is
re-serialised whole on every autosave tick to detect change, so anything
unbounded there makes every tick more expensive.

### Synced and local-only are different types

A plugin asks for a store that syncs or a store that does not, and gets a
different type. Only a synced store carries reconciliation bookkeeping and
registers with the sync engine.

Stated as a rule because the alternative — one store with a flag — makes both
mistakes possible: syncing a scratch cache, and declaring something synced then
forgetting to wire it. Compile caches, the telemetry buffer and project handles
are local-only and say so where they are created.

### Each plugin owns its own table, with real columns

A synced store declares the table its records land in, and the plugin ships the
migration that creates it. Fields the game reasons about are columns.

The first attempt put every plugin's records into one shared table as opaque
JSON. It worked and it was wrong: nothing could be indexed, constrained, or
asked a question. "How many words at this level does this player know" is a
question the database should answer, not something the browser answers by
downloading every row and parsing it.

The mechanism owns exactly four columns of any such table and no more:

| column | why it is not the plugin's |
|---|---|
| `user_id` | what row-level security scopes every read and write on |
| `record_key` | which record |
| `deleted` | a tombstone, so a delete survives the next reconcile |
| `updated_at` | stamped by the database; the ordering authority for conflicts |

A plugin writing one of those is refused at construction rather than on the
wire.

### The runtime declares the backend; a plugin supplies it

Runtime-core states what a backend must do. The plugin that owns accounts
implements it, the same split already used for identity and saves. Two
consequences are deliberate: the runtime never learns which backend a project
uses, and a project with no account plugin installed still gets working local
storage that simply never leaves the device.

### Conflicts resolve last-write-wins, on the database's clock

The timestamp is stamped by the database, never sent by the client — client
clocks disagree, and a device with a wrong one would win every argument it took
part in.

Last-write-wins is right for this data: one person, occasionally two devices,
rarely at once. Anything cleverer is unjustified until real loss is observed.

The known hazard of the scheme is a local write quietly losing to a remote one,
so that case is counted and reported rather than swallowed. A record edited
locally and not yet sent is never overwritten by a pull — it has not had its
turn.

### Storage on a player's device is named for the GAME

Every database and key a game creates leads with the game's id, and one
function builds those names. A player installed a game; the tool that built it
is not their concern and does not belong on their disk.

The practical reason is sharper than the principled one: Studio Preview serves
every project from a single origin, so without the game in the name, two
projects read and write each other's saves and learner data with nothing to
show for it. Published games are isolated by origin and were never at risk,
which is exactly why this went unnoticed.

Studio's own storage is the opposite case and keeps its own name: the author
really is using the editor.

### A player's data is in place before they can use it

The first reconcile is part of the same readiness phase as loading the world,
with one progress readout and one deadline. It is not a background pass racing
the player: reach a conversation before the pull lands and the game teaches
words already known, then corrects itself later with nothing to show it was
wrong.

When readiness overruns, the player is told and chooses whether to start
anyway. Starting a game whose world or whose data has not arrived looks like a
broken game rather than a loading one, so it is not a decision to make on their
behalf.

### Records are scoped to a person, and stay that way

The scope of a record is the account. Widening it to a general-purpose scope
was considered and rejected: it works on the device, where it is only part of a
name, and cannot work in the database, whose isolation rule is "you may only
read rows whose owner is you". A field holding something that is not an account
gives that rule nothing to check.

Data scoped by something else — per chapter, per playthrough — is a column on
that plugin's table plus a matching rule, not a wider key.

## Consequences

**A plugin adding per-player data writes a table and a migration, not a store.**
The keying, the local storage, the reconciliation, the conflict rule and the
naming all come with the mechanism.

**Migrations are new numbered files, never edits to an applied one.** The
Supabase CLI records what it has applied by filename and skips the rest, so
editing a file a project already ran changes nothing and reports success.

**Studio Preview does not reconcile.** It reads and writes locally against the
real project's configuration, so syncing would write an author's throwaway
sessions into the live database as though a player had played them. Revisit if
a development backend ever exists.

**One file per plugin store is loaded whole**, so its size tracks the whole game
rather than the episode being played, and the in-memory ceiling has to be sized
for the whole game. That ceiling is a workaround for the missing scope, not a
considered limit — see `sugarmagic-boot-scoping-j24`.

**Nothing records whether a reconcile happened.** A pass that moved forty
records and a pass that never ran look identical from outside. Tracked as
`sugarmagic-observability-ecs`; the obstacle is structural, since the runtime
has no recorder of its own.

## References

- [ADR 020](/docs/adr/020-sugarprofile-user-management-architecture.md) — where
  per-player data lives, and the two homes available to a plugin
- [API: per-player data](/docs/api/per-player-data.md) — the working
  description of the mechanism
