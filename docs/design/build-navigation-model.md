# Build Navigation Model

**Epic:** Plan 004 — Build Layout Workspace Navigation  
**Date:** 2026-04-01

## Navigation hierarchy

```
ProductMode (top bar)          → Build
  Build Workspace Kind (sub-nav) → Layout | Environment | Assets
    Region (subject selector)    → forest_north
      = Active Workspace         → LayoutWorkspace(forest_north)
```

## Activation rule

The active Build workspace is the intersection of three independent selections:

1. **ProductMode** — must be `Build`
2. **Build Workspace Kind** — one of `Layout`, `Environment`, `Assets`
3. **Region** — the authored subject being edited

These three selections are independent. Changing the region does not change the workspace kind. Changing the workspace kind does not change the region.

## Workspace identity

The active workspace ID is derived deterministically:

```
build:{workspaceKind}:{regionId}
```

Examples:
- `build:layout:forest_north`
- `build:environment:forest_north`
- `build:assets:forest_north`

## State ownership

| State | Owner | Lives in |
|-------|-------|----------|
| Active ProductMode | Shell coordination | `packages/shell` store |
| Active Build workspace kind | Shell coordination | `packages/shell` store |
| Active region ID | Shell coordination | `packages/shell` store |
| Derived workspace ID | Computed from above three | Not stored, derived |
| Workspace-scoped selection | Shell coordination | `packages/shell` store |
| Workspace-scoped tool session | Shell coordination | `packages/shell` store |
| Canonical region documents | Domain authoring session | `packages/domain` |
| Gizmo state, drag sessions | Workspace implementation | `packages/workspaces/build/layout` |

## Shell presentation

When `Build` is active, the header shows:

```
┌──────────────────────────────────────────────────────────────┐
│ Sugarmagic │ 📁 Game ▾ │ ✨Design │ 🗺️ Build │ 🔥 Render  │
├──────────────────────────────────────────────────────────────┤
│ [Region: forest_north ▾]  │  Layout │ Environment │ Assets  │
└──────────────────────────────────────────────────────────────┘
```

- The top row is the ProductMode bar (unchanged)
- The second row is the Build sub-nav: region selector + workspace-kind tabs
- The second row only appears when Build is the active ProductMode

## Anti-patterns

- Do NOT make Layout a top-level ProductMode
- Do NOT use the left panel as the primary router between Build workspace kinds
- Do NOT nest workspace-kind selectors under regions in the tree
- Do NOT store canonical region truth in the Build workspace-kind state
- Do NOT create parallel region state per workspace kind
- Do NOT let the Build sub-nav become a second source of authored truth

## Package ownership

| Package | Role in Build navigation |
|---------|-------------------------|
| `packages/productmodes` | Descriptors only. Does not own workspace implementations. |
| `packages/workspaces/build/layout` | LayoutWorkspace implementation, gizmo, interaction sessions |
| `packages/shell` | Coordination state: active mode, workspace kind, region, selection |
| `apps/studio` | Authoring viewport host, overlay root, viewport contracts consumed by Build workspaces |
| `packages/domain` | Canonical mutation path only |
