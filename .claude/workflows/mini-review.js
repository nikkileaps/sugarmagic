export const meta = {
  name: 'mini-review',
  description: 'Cheap 3-finder branch review: correctness, architecture, tests. No verify swarm; main loop triages.',
  whenToUse: 'Pre-PR sanity review of the current branch against main. Invoke with optional args: {base: "main"}.',
  phases: [{ title: 'Find', detail: 'three finders, one lens each, scoped to the branch diff' }],
}

const base = (args && args.base) || 'main'

const FINDINGS_SCHEMA = {
  type: 'object',
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['title', 'file', 'severity', 'description'],
        properties: {
          title: { type: 'string' },
          file: { type: 'string' },
          line: { type: 'number' },
          severity: { type: 'string', enum: ['high', 'medium', 'low'] },
          description: { type: 'string', description: 'What is wrong, why it matters, and the evidence (quote the code).' },
          suggestedFix: { type: 'string' },
        },
      },
    },
  },
}

const COMMON = `You are reviewing a feature branch in the sugarmagic repo (a pnpm
monorepo: region authoring studio + runtime playback).

Scope: ONLY what this branch changed. Run:
  git diff ${base}...HEAD --stat
  git diff ${base}...HEAD
  git log --oneline ${base}..HEAD
Then Read the touched files IN FULL (not just hunks) so you judge
changes in their real context. Follow call sites when a change's
safety depends on how it is used.

Report only issues INTRODUCED or made worse by this branch. Do not
report pre-existing problems in untouched code. Do not report style
nits. Every finding needs concrete evidence from the code - no
speculation. If you find nothing for your lens, return an empty
findings array; do not pad.

severity: high = would ship a real bug or contract break;
medium = likely problem or fragile pattern worth fixing before merge;
low = worth knowing, would not block the PR.`

phase('Find')
log(`mini-review: 3 finders over diff vs ${base}`)

const LENSES = [
  {
    key: 'correctness',
    prompt: `${COMMON}

Your lens: CORRECTNESS AND REGRESSIONS.
Hunt for: logic errors, off-by-ones, inverted conditions, races and
async hazards (in-flight work vs state changes, stale closures,
missing cancellation), resource leaks (undisposed GPU objects, event
listeners, subscriptions), null/undefined paths, math mistakes
(coordinate spaces, signs, radians vs degrees, color spaces), and
behavior regressions for existing callers of changed code.`,
  },
  {
    key: 'architecture',
    prompt: `${COMMON}

Your lens: ARCHITECTURE AND CONTRACTS.
First read AGENTS.md at the repo root and skim docs/api/system-and-package-api.md
for the package boundary rules. Hunt for: violations of one-source-of-truth
and single-enforcer principles (duplicate resolution/validation logic),
one-way dependency breaks between packages, editor logic leaking into
runtime packages (or vice versa), new state placed in the wrong store
or layer, semantic commands bypassed by direct mutation, public
contracts changed without their docs (docs/api) or tests following,
and legacy code paths the change should have deleted but left behind.`,
  },
  {
    key: 'tests-and-edges',
    prompt: `${COMMON}

Your lens: TESTS AND EDGE CASES.
Look at what tests exist for the changed code (packages/testing/src).
Hunt for: new behavior with no test that would catch its regression,
tests that assert too loosely to fail when the code breaks, flaky
patterns (randomness, timing, order dependence - this repo has a
zero-tolerance flake policy), and unhandled degenerate inputs in the
new code: empty sets, zero/negative sizes, parallel or zero-length
vectors, missing optional fields, first-run/no-state conditions.`,
  },
]

const results = await parallel(
  LENSES.map((lens) => () =>
    agent(lens.prompt, {
      label: `find:${lens.key}`,
      phase: 'Find',
      schema: FINDINGS_SCHEMA,
    }).then((r) => ({ lens: lens.key, findings: r.findings }))
  )
)

const all = results
  .filter(Boolean)
  .flatMap((r) => r.findings.map((f) => ({ ...f, lens: r.lens })))

const order = { high: 0, medium: 1, low: 2 }
all.sort((a, b) => order[a.severity] - order[b.severity])

log(`mini-review: ${all.length} raw findings (${all.filter((f) => f.severity === 'high').length} high)`)

return {
  base,
  findingCount: all.length,
  findings: all,
  note: 'Raw finder output - NOT verified. Main loop must triage each finding against the actual code before reporting.',
}
