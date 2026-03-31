# Plan 002: Shell Visual Foundation Epic

**Status:** Proposed  
**Date:** 2026-03-31

## Epic

### Title

Establish the Sugarmagic shell visual foundation.

### Goal

Replace bootstrap placeholder styling with an intentional first-pass shell design for `apps/studio` so follow-on feature work lands inside a coherent product surface instead of inside temporary presentation scaffolding.

This epic exists to make the visual shell architecture, shared UI tokens, reusable tool-product surfaces, and viewport-centered layout real before deeper authoring workflows begin.

### Why this epic exists

The bootstrap epic proved:

- package boundaries
- thin host composition
- shared runtime seams
- ProductMode shell structure
- workspace-centered shell orchestration

What it did not try to solve was final shell design.

Right now the studio host is structurally correct but visually provisional. If we leave that state in place for too long, Sugarmagic risks drifting into:

- placeholder styles that become permanent by inertia
- app-local CSS that bypasses shared UI ownership
- generic dashboard presentation that weakens the product identity
- shell surfaces that do not clearly communicate ProductMode, Workspace, viewport, and panel roles
- feature work landing into a visual system that was never intentionally designed

This epic turns the shell from “bootstrap readable” into “intentional authoring product foundation.”

### Architectural and product clarification

This visual pass should explicitly preserve:

- `apps/studio` as a thin composition host
- `packages/ui` as the shared home for reusable visual tokens and UI primitives
- `packages/shell` as the owner of shell structure and orchestration contracts
- `ProductMode` as the top-level shell lane
- `Workspace` as the concrete editing surface within a `ProductMode`
- the viewport as the central authored-content surface

This epic is about shell visual language, not feature behavior. It must not introduce:

- fake feature implementations
- duplicate state ownership
- app-local visual ownership for reusable shell concepts
- visual structures that imply alternate architecture or hidden domain owners

### Visual direction clarification

This epic should bias toward:

- a tool-product shell, not a marketing page
- a viewport-first composition, not a card-in-the-middle layout
- expressive but disciplined typography
- a grounded color system with atmosphere and depth
- strong legibility between shell, panel, workspace, and viewport surfaces
- reusable UI styling primitives rather than one-off app styles

This epic should explicitly avoid:

- default “enterprise dashboard” styling
- generic SaaS card layouts
- visually flattening all shell surfaces into the same treatment
- arbitrary one-off component styling in app code
- purple-on-white defaults or dark-mode-by-default styling without intent

### Architectural references

- [AGENTS.md](/Users/nikki/projects/sugarmagic/AGENTS.md)
- [README.md](/Users/nikki/projects/sugarmagic/README.md)
- [ADR 001: Single Runtime Authoring Rule](/Users/nikki/projects/sugarmagic/docs/adr/001-single-runtime-authoring-rule.md)
- [ADR 002: ProductMode Shell](/Users/nikki/projects/sugarmagic/docs/adr/002-productmode-shell.md)
- [API 001: Tech Stack and Platform API](/Users/nikki/projects/sugarmagic/docs/api/overview.md)
- [API 002: System and Package API](/Users/nikki/projects/sugarmagic/docs/api/system-and-package-api.md)
- [API 003: Domain, Runtime, and Lifecycle API](/Users/nikki/projects/sugarmagic/docs/api/domain-runtime-and-lifecycle-api.md)
- [Proposal 004: Sugarmagic ProductMode Shell](/Users/nikki/projects/sugarmagic/docs/proposals/004-productmode-shell.md)
- [Proposal 005: Sugarmagic System Architecture](/Users/nikki/projects/sugarmagic/docs/proposals/005-sugarmagic-system-architecture.md)

### Scope

In scope:

- shell visual direction for `apps/studio`
- shared design tokens and visual primitives in `packages/ui`
- shell frame, mode switcher, workspace header, panel surfaces, viewport framing, and status surfaces
- clear visual separation of ProductMode, Workspace, viewport, and panel layers
- responsive behavior for common working widths
- visual verification criteria for the shell foundation

Out of scope:

- final gameplay, region, landscape, VFX, or graph workflows
- deep feature-specific panel implementations
- published target redesign beyond token alignment where legitimately shared
- branding site work or marketing surfaces
- animation-heavy polish beyond a small amount of purposeful shell motion if needed

### Epic acceptance criteria

- `apps/studio` no longer reads as a bootstrap placeholder.
- The shell has a coherent visual language that matches the documented product direction.
- The viewport is visually central and shell surfaces feel intentional.
- Shared visual tokens and reusable presentation primitives live in `packages/ui`.
- Styling decisions preserve documented architecture boundaries and ownership.
- ProductMode, Workspace, viewport, and panel roles are visually legible.
- The shell is ready for follow-on implementation without requiring a visual reset.

### Epic definition of done

- All stories below are complete.
- `apps/studio` presents a coherent first-pass shell design at bootstrap level.
- Shared visual tokens and reusable shell-facing primitives exist in the correct permanent homes.
- The result is verifiable through visual QA and does not weaken one-way dependencies or ownership boundaries.

## Story 1

### Title

Define the shell visual direction and design constraints.

### Objective

Capture the first intentional visual direction for Sugarmagic studio so follow-on shell styling work is consistent rather than improvised.

### References

- [AGENTS.md](/Users/nikki/projects/sugarmagic/AGENTS.md)
- [Proposal 004: Sugarmagic ProductMode Shell](/Users/nikki/projects/sugarmagic/docs/proposals/004-productmode-shell.md)
- [Proposal 005: Sugarmagic System Architecture](/Users/nikki/projects/sugarmagic/docs/proposals/005-sugarmagic-system-architecture.md)

### Tasks

1. Define the intended shell mood, visual posture, and product feel for Sugarmagic studio.
2. Define the key visual layers of the shell:
   - app frame
   - ProductMode navigation
   - Workspace header
   - panel surfaces
   - viewport surface
   - status surfaces
3. Define what must be visually emphasized and what must remain visually subordinate.
4. Define explicit anti-goals so implementation does not drift into generic dashboard styling.
5. Record any visual decisions that affect reusable UI token needs.

### Acceptance criteria

- The team can describe the intended shell visual direction in concrete terms.
- The shell’s major surfaces have clear visual roles.
- Visual anti-goals are explicit enough to guide implementation tradeoffs.
- The direction reinforces ProductMode and Workspace structure rather than obscuring it.

### Definition of done

- The visual direction is documented or summarized in implementation-facing notes.
- Follow-on stories can execute without inventing their own competing visual language.

## Story 2

### Title

Establish shared design tokens and styling foundation in `packages/ui`.

### Objective

Create the permanent shared home for foundational shell visuals so reusable styling concepts do not live ad hoc inside `apps/studio`.

### References

- [API 002: `/packages/ui` API](/Users/nikki/projects/sugarmagic/docs/api/system-and-package-api.md)
- [Proposal 005: Package Ownership](/Users/nikki/projects/sugarmagic/docs/proposals/005-sugarmagic-system-architecture.md)
- [AGENTS.md](/Users/nikki/projects/sugarmagic/AGENTS.md)

### Tasks

1. Define shared CSS variables or token exports for:
   - color
   - typography
   - spacing
   - radius
   - borders
   - elevation
   - motion timing where needed
2. Define shell surface treatments that can be reused across app-frame, panel, and status presentations.
3. Define viewport-adjacent styling primitives separately from panel surface primitives.
4. Keep tokens semantic rather than tied to one temporary screen layout.
5. Avoid creating a shared styling layer that duplicates shell orchestration ownership.

### Acceptance criteria

- Shared visual tokens exist in the package intended to own reusable UI presentation concerns.
- The token layer is useful for both current shell work and future shared surfaces.
- Styling primitives do not require app-local duplication to be useful.
- Tokens are semantic enough to support iteration without a full rename pass.

### Definition of done

- `packages/ui` contains the foundational visual token layer for the shell.
- Reusable shell styling work can depend on shared tokens rather than one-off literals.

## Story 3

### Title

Create reusable shell-facing UI primitives.

### Objective

Translate the visual foundation into reusable shell-oriented primitives so the studio host can compose a real tool shell without accumulating one-off markup and CSS.

### References

- [API 002: `/packages/ui` API](/Users/nikki/projects/sugarmagic/docs/api/system-and-package-api.md)
- [API 002: `/packages/shell` API](/Users/nikki/projects/sugarmagic/docs/api/system-and-package-api.md)
- [Proposal 004: Sugarmagic ProductMode Shell](/Users/nikki/projects/sugarmagic/docs/proposals/004-productmode-shell.md)

### Tasks

1. Define reusable visual primitives for shell frame composition.
2. Define reusable visual primitives for:
   - ProductMode navigation
   - workspace headers
   - panel shells
   - status strips
   - viewport framing
3. Ensure the primitives are compositional and do not own application state.
4. Ensure the primitives can represent active, inactive, hovered, selected, and focused states clearly.
5. Keep primitive boundaries narrow enough that future feature-specific UI can build on them without rewriting them.

### Acceptance criteria

- Shared shell-facing primitives exist for the main shell surfaces.
- The primitives are presentation-oriented and do not absorb domain or orchestration logic.
- ProductMode and Workspace affordances have a reusable visual language.
- The host app can compose the shell without bespoke one-off surface implementations.

### Definition of done

- The main shell surfaces are backed by shared reusable presentation primitives.
- Future shells and workspaces can reuse these primitives with minimal duplication.

## Story 4

### Title

Redesign the studio host shell around ProductMode, Workspace, and viewport structure.

### Objective

Apply the new visual system to `apps/studio` so the current bootstrap host reads like the beginning of a real authoring product.

### References

- [ADR 002: ProductMode Shell](/Users/nikki/projects/sugarmagic/docs/adr/002-productmode-shell.md)
- [API 002: `/apps/studio` API](/Users/nikki/projects/sugarmagic/docs/api/system-and-package-api.md)
- [Proposal 004: Sugarmagic ProductMode Shell](/Users/nikki/projects/sugarmagic/docs/proposals/004-productmode-shell.md)

### Tasks

1. Replace the bootstrap card layout in `apps/studio` with a real shell composition.
2. Give ProductMode navigation a first-class location and visual treatment.
3. Introduce a Workspace-visible shell region that communicates the active editing surface clearly.
4. Keep the viewport central in both layout hierarchy and visual emphasis.
5. Introduce purposeful panel and status regions that feel like tool-product surfaces rather than placeholders.
6. Preserve thin-host architecture by composing shared primitives rather than embedding a second UI system directly in the app.

### Acceptance criteria

- The studio shell reads as an authoring tool, not a placeholder card.
- ProductMode and Workspace are visually distinct and understandable.
- The viewport is the visual center of the shell.
- Panel and status surfaces support the shell structure without overwhelming it.
- The implementation preserves app-as-composition-host discipline.

### Definition of done

- `apps/studio` presents a coherent first-pass tool shell.
- The host layout is ready to receive real workspace implementations without structural restyling.

## Story 5

### Title

Make interaction state and shell state visibly legible.

### Objective

Ensure the visual system communicates state clearly so users can trust mode selection, active workspace, panel state, and shell readiness at a glance.

### References

- [API 003: State Ownership and Lifecycle Guidance](/Users/nikki/projects/sugarmagic/docs/api/domain-runtime-and-lifecycle-api.md)
- [Proposal 004: Sugarmagic ProductMode Shell](/Users/nikki/projects/sugarmagic/docs/proposals/004-productmode-shell.md)
- [Plan 001: Bootstrap Project Foundation Epic](/Users/nikki/projects/sugarmagic/docs/plans/001-bootstrap-project-foundation-epic.md)

### Tasks

1. Define visual treatments for active and inactive ProductModes.
2. Define visible affordances for current Workspace identity and shell readiness.
3. Define panel and status state treatments that are readable without looking decorative-only.
4. Ensure interactive states remain clear for hover, focus, and active shell controls.
5. Keep visual state presentation aligned with actual state ownership rather than inventing misleading fake states.

### Acceptance criteria

- Mode state, workspace state, and shell status are visibly legible.
- Interactive controls communicate state changes clearly.
- Styling does not imply nonexistent feature behavior.
- State legibility supports trust and long-session usability.

### Definition of done

- The shell visually communicates the current editing lane and working context with minimal ambiguity.
- State presentation is aligned with the actual bootstrap contracts.

## Story 6

### Title

Support common authoring window sizes without collapsing the shell.

### Objective

Ensure the first-pass shell design holds together at realistic working sizes so the product remains usable during implementation, QA, and daily development.

### References

- [AGENTS.md](/Users/nikki/projects/sugarmagic/AGENTS.md)
- [API 001: Tech Stack and Platform API](/Users/nikki/projects/sugarmagic/docs/api/overview.md)
- [Proposal 005: Sugarmagic System Architecture](/Users/nikki/projects/sugarmagic/docs/proposals/005-sugarmagic-system-architecture.md)

### Tasks

1. Verify the shell at common desktop authoring sizes.
2. Verify the shell at laptop-scale widths.
3. Verify the shell at narrower development-window widths.
4. Adjust layout, spacing, and prioritization so the viewport remains central and shell controls stay usable.
5. Keep responsive behavior simple and intentional rather than adding a second mobile-style UI product.

### Acceptance criteria

- The shell remains legible and usable at common development and QA window sizes.
- ProductMode, Workspace, viewport, and panel structure remain understandable as the window changes.
- The shell does not collapse back into a generic stacked card layout.
- Responsive decisions preserve the desktop-first authoring intent.

### Definition of done

- The shell has a credible working-size range for real use.
- Follow-on implementation does not need to immediately revisit shell layout just to remain usable.

## Story 7

### Title

Keep `targets/web` aligned without turning this epic into a target redesign.

### Objective

Apply only the legitimately shared visual foundation to the published web target while keeping this epic focused on the studio shell.

### References

- [API 002: `/targets/web` API](/Users/nikki/projects/sugarmagic/docs/api/system-and-package-api.md)
- [Proposal 005: Shared Runtime for Web Targets](/Users/nikki/projects/sugarmagic/docs/proposals/005-sugarmagic-system-architecture.md)
- [AGENTS.md](/Users/nikki/projects/sugarmagic/AGENTS.md)

### Tasks

1. Apply shared token improvements to `targets/web` only where they are genuinely reusable.
2. Keep target-specific styling minimal and bootstrap-appropriate.
3. Avoid building studio-shell-specific chrome into the published target.
4. Ensure the target remains visually compatible with the shared design foundation without competing for epic scope.

### Acceptance criteria

- Shared tokens can be consumed by both studio and target where appropriate.
- `targets/web` does not become an accidental second design effort.
- The target remains thin and aligned with shared presentation foundations.

### Definition of done

- Shared visual foundation changes do not break or visually orphan the published target.
- The epic remains centered on the studio shell.

## Story 8

### Title

Add verification and QA guidance for the shell visual foundation.

### Objective

Make the visual foundation verifiable so the shell does not become “looks fine to me” work with no shared standard.

### References

- [AGENTS.md](/Users/nikki/projects/sugarmagic/AGENTS.md)
- [Plan 001: Bootstrap Project Foundation Epic](/Users/nikki/projects/sugarmagic/docs/plans/001-bootstrap-project-foundation-epic.md)
- [API 002: System and Package API](/Users/nikki/projects/sugarmagic/docs/api/system-and-package-api.md)

### Tasks

1. Define visual QA scenarios for:
   - ProductMode switching
   - workspace readability
   - viewport centrality
   - panel legibility
   - common width behavior
2. Add any lightweight verification notes or smoke checks needed to ensure the shell still builds and runs cleanly.
3. Document what is intentionally final enough for follow-on work versus what remains provisional.
4. Record any architectural guardrails learned during implementation that should be fed back into docs.

### Acceptance criteria

- The shell visual pass has shared QA expectations.
- The result is reviewable against explicit criteria rather than taste alone.
- Build and run verification still pass after the styling work.
- Any implementation-driven architecture clarifications are written down.

### Definition of done

- The shell visual foundation is testable and reviewable.
- Future implementation work has a clear visual baseline and known remaining gaps.
