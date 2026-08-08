# Spanish Data

## Target Variety: Latin American Spanish

Decided 2026-08-05. `exponents.json` carries Latin American forms -- `carro`,
`boleto`, `computadora`, `lentes` -- and `ustedes` rather than `vosotros`.

This governs what the game TEACHES. The dictionary and morphology index still
carry peninsular forms, including `vosotros` conjugations, because a player may
type one or meet one in authored text and failing to recognise it would be a
bug. Production is narrow; recognition is wide.

See `scripts/data-prep/EXPONENT-AUTHORING.md` for the substitution table.

## Provenance

`cefrlex.json` was seeded once from ELELex and has been a source file ever
since. **There is no importer.** `scripts/data-prep/import-elelex.ts` is cited
by older documents and does not exist. To change the dictionary, edit it; see
`scripts/data-prep/DICTIONARY-AUTHORING.md`.

`exponents.json`, `always-target.json` and `english-collisions.json` are
LLM-authored and reviewed by hand.

- ELELex reference project: <https://cental.uclouvain.be/cefrlex/elelex/download/>

## Files

- `cefrlex.json` -- atlas version `es-elelex-2026-04-09`, **10,618 lemmas**
  - Bands: A1 3,198, A2 2,591, B1 1,850, B2 1,352, C1 1,627, C2 0
  - Band provenance: 10,519 `cefrlex`, 99 `claude-classified`
  - Forms: 1,447 verb, 6,000 noun, 2,336 adjective
  - Forms provenance: 9,378 `generated`, 405 `authored`, 835 with no forms.
    **None are `reviewed`** -- 88% of the forms are machine output that nobody
    has checked, which is the honest state of this file.
- `morphology.json` -- 103,229 surfaces, derived
- `exponents.json` -- 635 competencies, 2,526 cards, 2,896 wordings, 388 lemma
  overrides (13%)
- `competency-inventory.json` -- 65 lessons, 635 of 635 competencies taught
- `placement-questionnaire.json` -- 10 questions, `minAnswersForValid = 6`
- `always-target.json` -- `dropsSubjectPronouns: true`
- `english-collisions.json` -- measured from captured violations

Spanish ships no `frequency.json`; only Italian has one.

## Licensing

The atlas derives from the public ELELex source. Keep the citation and license
requirements here, and rerun the schema tests after any refresh.

## Re-Run

From the repo root, after editing `cefrlex.json` or `exponents.json`:

- `pnpm exec tsx scripts/data-prep/build-morphology.ts es`
- `pnpm exec tsx scripts/data-prep/build-competency-inventory.ts es`
- `pnpm exec tsx scripts/data-prep/build-placement-questionnaires.ts`
