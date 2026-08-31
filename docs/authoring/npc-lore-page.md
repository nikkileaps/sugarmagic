# NPC lore page convention

An agentified NPC's character lives entirely on **one lore wiki page** -- the
page referenced by `NpcDefinition.lorePageId`. There is no persona authored
anywhere else. That one page feeds three layers of what the NPC knows, split by
reserved section headings.

This is the authoring contract for Plan 072 (SugarAgent Persona + Knowledge
Architecture). Story 072.1 defines the convention and the parser; later stories
load the card into the prompt (072.3/072.4) and serve it through the gateway
(072.2).

## The layers

| Section heading | Layer | Where it goes |
|---|---|---|
| `## Persona`, `## Voice` | Persona card | Loaded whole at conversation start into the (cached) system prompt. Never searched, never truncated. |
| every other section | Core knowledge | Same load, same moment, same system prompt. What the NPC *always* knows. |
| `## Secrets` | Withheld | Never enters any prompt, and never enters the vector index. A place to author unrevealable truths. |

`## Relationships` is core knowledge like any other section, and is also read
line by line. Each line carrying a markdown link is one entry -- the link text
is the other character's name, the target is their page id, and the rest of the
line is what this character knows of them:

```markdown
## Relationships

[Tomas the Miller](lore.entities.npcs.tomas) -- Feuds with him, fondly, over
flour prices.
```

A line with no link continues the entry above it, so a description can wrap.
When quest world context lands on a page this character has a line about, the
NPC is given the line instead of the page. With no line they get the page,
labelled with whose it is. A section written as prose still loads as core
knowledge; it just yields no entries.

## What is hidden, and what is not

Everything on the page except `## Secrets` is **potentially player-visible**
until epic E adds quest-stage gating. `## Secrets` is stripped from the persona
card, from core knowledge, and from the ingest chunks, so it cannot surface in a
conversation or a search. It never leaves the gateway at all.

A character's recovery strategies -- what it does when it cannot understand the
player -- are NOT authored here. They are game data, not world knowledge, so
they live on the NPC in Studio (Design > NPCs > Recovery) and travel in the
project file. The heading `## Recovery` is not reserved; a page that still
carries one reads as ordinary core knowledge.

Note that persona/voice/core sections DO stay in the vector index: another NPC
must be able to retrieve this NPC's page as world lore ("who is Maren?" asked of
the blacksmith). A page marked `canon_level: soft` withholds all of its contents
-- see below.

## Metadata

The block at the top of the page, between `---` lines.

Required: an `id`. This is the canonical page id used everywhere (bindings,
retrieval, the card fetch). Example:

```
---
id: lore.npc.maren
title: Maren
---
```

A page with no `id` is skipped by ingest entirely (with a warning), same as
before this convention.

### `canon_level` -- how deeply the page is indexed

Optional. `hard` (the default, and what a page without the key gets) or `soft`.

**`hard`** -- one search chunk per section. The page's contents are findable.

**`soft`** -- one chunk carrying the page's id and title and nothing else. A
search can discover the page EXISTS but cannot reach anything described inside
it.

```
---
id: lore.media.podcasts.archivado.episode_01
title: Archivado -- Episodio 1
canon_level: soft
---
```

Use `soft` for in-world media: a documentary, a book, a broadcast. Such a page
is as true as any other, so excluding it would be wrong. The problem is
distance. The world contains the podcast; the podcast contains a suitcase. Index
its contents and every noun inside somebody else's story competes with the same
noun in the world itself -- a player asking about a lost suitcase gets a scene
where a character packs one, which is a correct match and the wrong answer.

Indexing only the identity removes the competition without removing the page. A
player asking about the *Handbook for the Recently Transported* still finds it,
because that query matches its title.

The markdown is untouched either way. What the game can reach is not: it reads
lore only from the search index, so a `soft` page reaches it as an identity and
nothing else. An NPC bound to one loads no persona at all and falls back to its
name and the game's tone. Use `soft` for in-world media, never for a character
someone talks to.

`## Secrets` exclusion applies at both levels.

Changing a page's level needs no migration. Run Update Lore and the chunks
rearrange themselves -- flip to `soft` and the section chunks are deleted, flip
back and they return. An unrecognized value is reported in the ingest warnings
and treated as `hard`.

## Reserved headings: exact match, any level, case-insensitive

- Designation matches the section's **slug** (the heading lowercased and
  hyphenated), so `## Persona`, `## PERSONA`, and `# persona` all designate the
  persona card. Heading **level** does not matter (`#` through `######`).
- Only an **exact** reserved word counts. `## Persona` is the card;
  `## Persona and Backstory` (slug `persona-and-backstory`) is core knowledge.
  `## Secrets` is hidden; `## Secret` (singular) is not -- it is core knowledge.
- Reserved slugs: `persona`, `voice` (persona card); `secrets` (withheld).
- Content before the first heading becomes an implicit `Overview` section and
  lands in **core knowledge**.

Missing persona sections is legal: the card is simply empty and only core
knowledge loads. A misauthored page never bricks an NPC (it degrades to name +
game tone).

## Worked example

```markdown
---
id: lore.npc.maren
title: Maren the Baker
---

Maren has run the bakery on the square for thirty years.

## Persona
Warm but brisk. Proud of her sourdough starter, which she named "Gerald".
Impatient with dawdlers; soft on children and stray cats.

## Voice
Short, clipped sentences. Calls everyone "love". Never swears; says "sugar"
instead.

## Work
Opens before dawn. Sells bread, buns, and the seasonal spiced loaf. Trades
gossip for a discount.

## Relationships
[Tomas the Miller](lore.entities.npcs.tomas) -- Feuds with him, fondly, over
flour prices.

## Secrets
Maren is the last of the Aldermere line. She does not know this herself yet;
it becomes revealable only after the "Heir's Locket" quest reaches stage 3.
```

For this page:

- **Persona card** (system prompt, cached): the `## Persona` and `## Voice`
  sections, verbatim.
- **Core knowledge** (system prompt, cached): the implicit Overview ("Maren has
  run the bakery..."), `## Work`, and `## Relationships`.
- **Excluded**: `## Secrets` -- never in a prompt, never ingested, never
  retrievable. (The quest-stage revelation it hints at is a later epic; today
  it is simply hidden.)
