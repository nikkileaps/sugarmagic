# `packages/domain/src/ui-definition`

Owns the portable authored data model for project UI: `MenuDefinition`,
`HUDDefinition`, `UINode`, bindings, actions, and `UITheme`.

This module is the source of truth for game UI documents. It contains no DOM,
React, CSS, ECS, or target-specific behavior. Runtime targets render these
definitions; Studio edits them through semantic commands.
