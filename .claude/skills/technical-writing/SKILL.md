---
name: technical-writing
description: "Writing developer-facing prose that can be skimmed first and trusted enough to finish — READMEs, guides, tutorials, reference docs, proposals, PR descriptions, release notes. Use when creating or editing any technical document, when a doc reads as a wall of text, when claims need receipts, or when docs must serve AI agents as well as humans. Covers reader-first structure, falsifiable claims, docs-as-behavior verification, and agent-readable reference shape. For diagram choice and syntax see diagrams; for API reference semantics see api-design; for CLI help text see cli-design."
---

# Technical Writing: Skimmed First, Trusted Enough to Finish

Developers skim before they commit. A document earns the full read by answering three questions in its first screen: what is this, why should I care, and how do I start. Everything below serves that contract.

| Resource | Load when... |
|----------|-------------|
| `resources/doc-types.md` | Choosing what KIND of page to write — minimalism scoped per type |
| `resources/readme.md` | Writing or overhauling a README — the cognitive funnel, short-vs-long resolved, README-driven development |
| `resources/doc-quality.md` | Making docs enforceable — prose lint, executable examples, link checking, friction logs, timeless-docs, every-page-is-page-one |
| `resources/agent-docs.md` | Docs serving AI agents — the honest llms.txt verdict, markdown endpoints, RAG-chunkable pages |
| `resources/formatting.md` | Structural rules — titles, headings, paragraphs, lists, intros/outros, tables of contents |
| `resources/api-docs.md` | Docs serving other engineers or developers - explantory type docs that describe the current state of the project, application, or system |

## One Primary Type Per Page

Choose the page's primary type: explanatory, how-to, reference, conceptual, summary, narrative. Supporting material may cross a boundary when that helps the same job. Split the page when mixed purposes make the next action, completeness contract, or intended audience unclear. This isnt' to say that reference type writing cannot be used in a page that is primarily of conceptual type, but mixing in other types should be sparse and the bulk of the writing shoudl be in the identified primary type.

## Principles

- **Reader-first** — lead with the payoff; the reader's understanding, knowledge, or next action is the organizing principle, not the system's internal structure. Name things by what readers recognize then go from the general to the specific as needed.
- **Scannable** — clear headings that summarize their section's payoff, short paragraphs, purposeful emphasis. Add a heading when it gives a skimmer a useful landmark; do not optimize for a word-count quota.
- **Plain and direct** — active voice, second person for instructions, short sentences for complex ideas. Complete sentences beat fragments and arrow chains: readable matters more than terse.

## Maintained Docs Describe Current Truth

Keep references to ephemeral planning documents ( such as epics, stories, etc ) out of maintained docs. Keep references to specific code sparse and if its necessary always updated.
