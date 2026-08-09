# Italian Data

## Target Variety: Standard Italian

Standard Italian is what is taught, broadcast and written everywhere, so there
is no regional substitution table the way Spanish has one. The regional
differences are dialect rather than a second standard.

Phrases are authored **correct for Italian, not translated from Spanish** --
the passato prossimo rather than a one-word preterite, Lei plus a third-person
verb rather than a politeness pronoun. See
`scripts/data-prep/EXPONENT-AUTHORING.md`.

## Provenance

`cefrlex.json` was seeded once from the Italian Kelly list and has been a
source file ever since. **There is no importer.** `derive-italian-frequency.ts`
exists and produced `frequency.json` once; `build-italian-cefrlex.ts` is cited
by older documents and does not exist.

`exponents.json`, `always-target.json` and `english-collisions.json` are
LLM-authored and reviewed by hand.

- Kelly project: <https://spraakbanken.gu.se/projekt/kelly>
- Italian Kelly download: <https://ssharoff.github.io/kelly/it_m3.xls>

## Files

- `cefrlex.json` -- atlas version `it-kelly-2026-04-09`, **6,449 lemmas**
  - Bands: A1 1,022, A2 1,399, B1 1,521, B2 1,362, C1 1,015, C2 130
  - Band provenance: 4,973 `kelly`, 1,476 `claude-classified` for the lemmas
    Kelly lists without placing
  - Forms: 259 verb, 48 noun, 100 adjective
  - Forms provenance: **all 407 are `authored`**, none generated. The other
    6,042 lemmas have no forms yet and are filled as authoring reaches them.
- `morphology.json` -- 41,423 surfaces, derived
- `frequency.json` -- Kelly rank order as a monotonic frequency proxy
- `exponents.json` -- 635 competencies, 2,519 cards, 2,863 wordings, 28 lemma
  overrides (1%)
- `competency-inventory.json` -- 65 lessons, 635 of 635 competencies taught
- `placement-questionnaire.json` -- 10 questions, `minAnswersForValid = 6`
- `always-target.json` -- `dropsSubjectPronouns: true`
- `english-collisions.json` -- authored from knowledge of both languages, not
  measured from captured violations the way Spanish's was

Older documents refer to `kelly-subset.json` and `review-queue.yaml`. Neither
file exists.

## Where Italian stands against Spanish

Full parity on what is taught -- both ship all 635 competencies across 65
lessons. The dictionary is smaller (6,449 lemmas against 10,618), which is a
recognition-breadth difference rather than a teaching one: a player typing a
rarer Italian word is likelier to go unrecognised.

Fewer entries carry forms, but every one that does was written by hand rather
than generated. That is why Italian needs 28 lemma overrides where Spanish
needs 388 -- a missing form shows up as a build failure and gets fixed in the
dictionary, which is where it belongs.

## Re-Run

From the repo root, after editing `cefrlex.json` or `exponents.json`:

- `pnpm exec tsx scripts/data-prep/build-morphology.ts it`
- `pnpm exec tsx scripts/data-prep/build-competency-inventory.ts it`
- `pnpm exec tsx scripts/data-prep/build-placement-questionnaires.ts`
