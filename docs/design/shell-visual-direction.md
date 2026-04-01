# Shell Visual Direction

**Epic:** Plan 002 — Shell Visual Foundation  
**Date:** 2026-03-31

## Visual posture

Sugarmagic studio is a tool-product shell for region authoring and runtime playback. The visual system should feel like a professional creative tool — quiet chrome, viewport-centered composition, legible state.

## Sugarengine inheritance

The Sugarmagic shell inherits the established Sugarengine visual system as its initial baseline. This is a concrete implementation rule, not a suggestion.

### Palette

Sugarengine uses a Catppuccin Mocha dark theme. Sugarmagic inherits this palette directly:

| Token | Hex | Role |
|-------|-----|------|
| `text` | `#cdd6f4` | Primary text |
| `subtext` | `#bac2de` | Secondary text |
| `overlay2` | `#9399b2` | Dimmed text, placeholders |
| `overlay0` | `#6c7086` | Muted text, hints |
| `surface2` | `#45475a` | Borders, dividers |
| `surface1` | `#313244` | Elevated surfaces, panels |
| `base` | `#1e1e2e` | Main shell background |
| `mantle` | `#181825` | Deep background, inset areas |
| `crust` | `#1a1a2e` | Document/HTML background |

Semantic accent colors:

| Token | Hex | Semantic role |
|-------|-----|---------------|
| `blue` | `#89b4fa` | Selection, active states, NPC |
| `green` | `#a6e3a1` | Success, start, active |
| `yellow` | `#f9e2af` | Conditions, warnings, items |
| `red` | `#f38ba8` | Errors, triggers |
| `mauve` | `#cba6f7` | Inspectables, badges |
| `teal` | `#94e2d5` | Resonance points |
| `peach` | `#fab387` | VFX, effects |

### Icons

Sugarengine uses native emoji as its icon system. Sugarmagic inherits this:

| Concept | Emoji |
|---------|-------|
| Dialogues | 💬 |
| Quests | 📜 |
| NPCs | 👤 |
| Items | 🎒 |
| Spells | ✨ |
| Resonance | 🦋 |
| VFX | 🔥 |
| Player | 🧙 |
| Inspections | 🔍 |
| Regions | 🗺️ |

Spawn type icons:

| Type | Emoji |
|------|-------|
| NPC | 👤 |
| Item Pickup | 📦 |
| Inspectable | 🔍 |
| Resonance Point | 🦋 |
| VFX Effect | ✨ |
| Trigger | ⚡ |

### Component library

Mantine v9 is the backing component library for shell and layout primitives. Sugarengine uses Mantine v8 — Sugarmagic adopts the current major for its fresh foundation.

## Shell visual layers

| Layer | Role | Visual treatment |
|-------|------|-----------------|
| App frame | Outermost chrome | `crust`/`mantle` background, minimal decoration |
| ProductMode navigation | Top-level lane switching | Compact bar, active mode highlighted with `blue` accent |
| Workspace header | Identifies current editing surface | Subtle region below mode nav, `surface1` background |
| Panel surfaces | Structure tree, inspector, status | `surface1` background, `surface2` borders, inset from viewport |
| Viewport surface | Central authored-content area | `base` background, visually dominant, takes remaining space |
| Status surface | Shell status and readiness | Bottom strip, `mantle` background, dimmed text |

## Visual emphasis

**Emphasized:** Viewport (largest area, darkest undecorated surface), active ProductMode, active workspace identity.

**Subordinate:** Panel chrome, status bar, inactive modes, shell frame edges.

## Anti-goals

- No marketing-page or SaaS card layouts
- No enterprise dashboard styling
- No purple-on-white defaults
- No generic stacked-card composition
- No inventing a new palette — use Sugarengine's
- No new icon library — use emoji or tabler if no emoji works
- No published-game UI inheritance from editor shell
- No one-off app-local component styling for reusable surfaces