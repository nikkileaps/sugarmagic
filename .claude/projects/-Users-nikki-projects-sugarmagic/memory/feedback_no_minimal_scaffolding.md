---
name: No minimal shortcuts for architectural scaffolding
description: User strongly prefers implementing correct architecture from the start rather than minimal-first approaches
type: feedback
---

Do not propose "minimal" or "narrow" first-pass implementations for architectural systems like interaction handling, hit testing, input routing, etc. Scaffold the correct architecture from the beginning even if only one feature uses it initially.

**Why:** The user has observed that coming back to rework minimal implementations into proper architecture doesn't happen reliably. Half-measures become permanent. "That way is darkness."

**How to apply:** When planning implementation of systems that have a known correct architecture (from Sugarbuilder ADRs or industry patterns), implement the full architectural shape even if only a subset is wired up. For example: build a real HitTestService and InputRouter even if only the move gizmo uses them at first.
