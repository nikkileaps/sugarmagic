---
name: Panel is a layout-only term
description: Never suffix content components with "Panel" — that term is reserved for layout containers (HeaderPanel, LeftPanel, etc.)
type: feedback
---

"Panel" is reserved strictly for layout containers in the ShellFrame (HeaderPanel, LeftPanel, CenterPanel, RightPanel, BottomPanel). Content components that go *inside* a panel must not use the "Panel" suffix.

**Why:** We explicitly separated layout terms from semantic content terms. Mixing them defeats the purpose.

**How to apply:** Name content components by what they are: `Inspector`, `SceneExplorer`, `StatusBar` — never `InspectorPanel`, `SceneExplorerPanel`, etc.
