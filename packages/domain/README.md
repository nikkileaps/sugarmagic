# `packages/domain`

Canonical authored documents and domain invariants.

Owns:

- canonical document types
- semantic commands
- transactions
- history
- validation contracts
- one content-library asset system for both generic model assets and specialized foliage assets

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

## Asset Library Boundary

The content library remains one canonical asset-definition system.

- `assetKind: "model"` represents general imported meshes and props.
- `assetKind: "foliage"` represents authored foliage GLBs that still live in the same asset library.

Domain owns that distinction so import, authoring preview, and runtime preview do
not invent parallel foliage registries.

Future plugins that want to reserve a prefix should update this list in the PR
that introduces the new metadata contract.
