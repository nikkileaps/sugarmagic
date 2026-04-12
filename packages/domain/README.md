# `packages/domain`

Canonical authored documents and domain invariants.

Owns:

- canonical document types
- semantic commands
- transactions
- history
- validation contracts

Does not own:

- shell UI state
- runtime scene instances

References:

- [API 002: `/packages/domain` API](/Users/nikki/projects/sugarmagic/docs/api/system-and-package-api.md)
- [Proposal 002: Sugarmagic Domain Model](/Users/nikki/projects/sugarmagic/docs/proposals/002-sugarmagic-domain-model.md)

## Plugin Metadata Convention

Plugins that attach metadata to domain entities must use their plugin id as a
namespace prefix on each key. For example, the sugarlang plugin uses keys such
as `sugarlangRole` and `sugarlangPlacementQuestionOverrideId`.

Reserved prefixes today:

- `sugarlang`

Future plugins that want to reserve a prefix should update this list in the PR
that introduces the new metadata contract.
