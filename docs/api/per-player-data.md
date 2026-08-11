# Per-player data

How a plugin stores something that belongs to a **player** rather than to the
game, and has it follow them to another device.

For the reasoning behind these rules, see
[ADR 029](/docs/adr/029-per-player-data-that-follows-the-player.md).

## What this is for

Things a player accumulates: which words they have met and how well they know
each one, what level they are, what an NPC remembers about them. Not game
content, and not where the player is standing — that is the save.

Two homes exist and the choice between them is mechanical:

| use | when |
|---|---|
| a **save slice** (`SaveParticipant`) | small state you can produce instantly. It is collected on every autosave tick and the whole save is re-serialised to detect change, so nothing unbounded belongs here. |
| a **record store** (this document) | anything larger, anything read asynchronously, or anything that should follow the player to another device. |

## The shape

A store holds **records**, each with a key you choose. Reads and writes go to
the player's device and return immediately. If the store syncs, reconciling
with the player's account happens afterwards on its own schedule.

Two kinds, and they are different types so you cannot mix them up:

```ts
// Stays on this device. Invisible to the sync engine.
const cache = createLocalRecordStore<Thing>({
  pluginId: MY_PLUGIN_ID,
  storeId: "scratch",
  schemaVersion: 1
});

// Follows the player to their other devices.
const words = createSyncedRecordStore<Word>({
  pluginId: MY_PLUGIN_ID,
  storeId: "words",
  schemaVersion: 1,
  table: MY_WORD_TABLE
});
```

Both refuse to open before an account has resolved, because storage opened
without one is shared by everyone using that browser. Resolve the account
first and defer; do not catch this and carry on.

## If it syncs, you own a table

A synced store declares the table its records land in, and your plugin ships
the migration that creates it. Your fields are **real columns**, so the
database can index and constrain them and answer questions about them.

```ts
export const MY_WORD_TABLE: RemoteTableSpec<Word> = {
  tableName: "myplugin_words",
  toColumns: (word) => ({ difficulty: word.difficulty, band: word.band }),
  fromColumns: (row) => ({
    difficulty: Number(row.difficulty),
    band: String(row.band)
  })
};
```

**Four columns are not yours.** The mechanism owns `user_id`, `record_key`,
`deleted` and `updated_at`; your table must declare them and your `toColumns`
must not write them. Writing one is refused when the store is created.

`fromColumns` receives a row that came over a network. Check it rather than
trusting it — an unrecognised value should read as the safest option, not as
itself.

**Migrations are new numbered files.** Never edit one that has been applied:
the Supabase CLI records what it has run by filename and skips the rest, so an
edit changes nothing and reports success.

## Deleting

`delete` writes a **tombstone** rather than removing the row, and so does
`clear` on a synced store. Removing it outright would let the next reconcile
hand the record straight back, and the delete would look like it silently
failed.

## What reconciling does

On its own schedule, and on signing in, reconnecting, and the tab being
hidden — never on the autosave tick:

1. Send records changed on this device since last time.
2. Ask for records the account has seen since a watermark.
3. Where both changed, the **later** one wins, judged by the timestamp the
   database stamped.

A record edited here and not yet sent is never overwritten by a pull; it has
not had its turn. Those cases are counted and logged rather than swallowed,
because a local edit lost silently is indistinguishable from data loss when
someone reports it a week later.

A failed pass loses nothing — the records stay queued and the next pass retries
them — and the gap between passes grows while it keeps failing, rather than
hammering a backend that is down.

## Boot

The first reconcile is part of loading the game, alongside the world. A player
cannot reach anything before their own data is there.

If loading overruns, the player is offered the choice to start anyway. It is
never taken silently: starting before the world or the player's data has
arrived looks like a broken game rather than a loading one.

## Naming

Every database and key a game creates on a player's device leads with the
**game's id**, built by one function. A player installed a game; the tool that
built it does not belong on their disk.

It also keeps projects apart. Studio Preview serves every project from one
origin, so without the game in the name two projects read and write each
other's data.

Studio's own storage is the opposite case and keeps its own name.

## Two things that will bite

**Studio Preview does not reconcile.** It reads and writes locally against the
real project's configuration, so syncing would write an author's throwaway
sessions into the live database as though a player had played them. Anything
you do in Preview stays on your machine, and an empty table after previewing is
correct.

**Nothing records whether a reconcile happened.** A pass that moved forty
records and a pass that never ran look the same from outside. If you need to
know, read the rows. Tracked as `sugarmagic-observability-ecs`.

## Related

- [ADR 029](/docs/adr/029-per-player-data-that-follows-the-player.md) — why it
  is shaped this way
- [ADR 020](/docs/adr/020-sugarprofile-user-management-architecture.md) — where
  per-player data lives relative to identity and saves
- [Learner state](/docs/api/sugarlang-learner-state.md) — the first user of
  this mechanism
