# NPC lore page convention

An agentified NPC's character lives entirely on **one lore wiki page** -- the
page referenced by `NpcDefinition.lorePageId`. There is no persona authored
anywhere else. That one page feeds three layers of what the NPC knows, split by
reserved section headings.

This is the authoring contract for Plan 072 (SugarAgent Persona + Knowledge
Architecture). Story 072.1 defines the convention and the parser; later stories
load the card into the prompt (072.3/072.4) and serve it through the gateway
(072.2).

## The three layers

| Section heading | Layer | Where it goes |
|---|---|---|
| `## Persona`, `## Voice` | Persona card | Loaded whole at conversation start into the (cached) system prompt. Never searched, never truncated. |
| every other section | Core knowledge | Same load, same moment, same system prompt. What the NPC *always* knows. |
| `## Secrets` | Excluded | Never enters any prompt, and never enters the vector index (ingest skips it). A place to author unrevealable truths. |

Everything on the page except `## Secrets` is **potentially player-visible**
until epic E adds quest-stage gating. `## Secrets` is the only guaranteed-hidden
section today: it is stripped from the persona card, from core knowledge, and
from the ingest chunks, so it can never surface in a conversation or a search.

Note that persona/voice/core sections DO stay in the vector index: another NPC
must be able to retrieve this NPC's page as world lore ("who is Maren?" asked of
the blacksmith). Only `## Secrets` is withheld from the index.

## Frontmatter

Required: an `id`. This is the canonical page id used everywhere (bindings,
retrieval, the card fetch). Example:

```
---
id: lore.npc.maren
title: Maren
---
```

A page with no frontmatter `id` is skipped by ingest entirely (with a warning),
same as before this convention.

## Reserved headings: exact match, any level, case-insensitive

- Designation matches the section's **slug** (the heading lowercased and
  hyphenated), so `## Persona`, `## PERSONA`, and `# persona` all designate the
  persona card. Heading **level** does not matter (`#` through `######`).
- Only an **exact** reserved word counts. `## Persona` is the card;
  `## Persona and Backstory` (slug `persona-and-backstory`) is core knowledge.
  `## Secrets` is hidden; `## Secret` (singular) is not -- it is core knowledge.
- Reserved slugs: `persona`, `voice` (persona card); `secrets` (excluded).
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
Feuds -- fondly -- with Tomas the miller over flour prices.

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
