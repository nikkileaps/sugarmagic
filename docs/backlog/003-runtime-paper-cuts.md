# Backlog: Runtime paper cuts

**Source:** Running collector for runtime-side robustness gaps found in code review / debugging. Each one is a real correctness hazard that survived shipping; individually low-severity, worth clearing before they compound.

## Items

### 1. `hostQuitToMenu` doesn't clear `activeOverlayMenuKey` [FIXED — this branch]

**Severity:** Low (edge case, but leaves the runtime in an inconsistent state)

**Symptom:** Player opens a dialogue with an NPC, presses `Q` to pause, clicks Quit-to-Menu from the pause menu. Lifecycle transitions to `"start-menu"` but `uiState.activeOverlayMenuKey` stays `"dialogue"` from when the dialogue panel called `show()`. When the player clicks Continue back into gameplay, mode returns to `"dialogue"` immediately (because lifecycle `"playing"` + overlay key `"dialogue"` -> resolver returns `"dialogue"`). The dialogue panel's DOM has been sitting stale the whole time.

**Root cause:** `hostQuitToMenu` (`targets/web/src/runtimeHost.ts:929`) only sets lifecycle. There's no companion cleanup of `activeOverlayMenuKey`, no `dialogueManager.end("cancelled")` call, no "clear all active overlays" seam. Overlays are individually responsible for calling `hide()` and each has its own effects (dialogue: `presenter.hide()` -> `activeOverlayMenuKey: null` at `DialoguePanel.ts:797`), but nothing invokes that from the lifecycle transition.

**Action:** Either (a) add a "cancel all active overlays" step to `hostQuitToMenu` (probably the cleanest — the pause menu quit action should end any in-flight dialogue / close inventory / etc.), or (b) make GameUILayer's render decision "if lifecycle is not `"playing"`, ignore `activeOverlayMenuKey`" (already happens for rendering, but the RESOLVER still returns `"dialogue"`, which is a separate bug). Prefer (a); it's a real cleanup semantic, not a resolver band-aid.

### 2. Zero test coverage for the boot -> lifecycle transition [FIXED — this branch]

**Severity:** Medium (a shippable bug already slipped through here once — Plan 054 fresh-start branch, fixed 2026-07-01)

**Symptom:** The bug in `runtimeHost.ts:1697-1710` (skipStartMenuOnBoot / no-start-menu paths silently left lifecycle at `"booting"`, killing every mode-gated keyboard action) survived Plan 054's completion and every subsequent verification pass because none of them tested a keyboard shortcut through a fresh New Game click. Movement (WASD) and `E`-to-interact both bypass the mode gate, so the game looked functional except for dialogue advance / inventory `i` / quest journal `j`. Found while debugging 055.4, but the root cause was pre-055.

**Root cause:** `packages/testing/src/` has zero tests exercising the boot-time lifecycle decision. The whole block that decides "call showStartMenu vs. transition directly to playing" is only reachable through a full `createWebRuntimeHost({...}).start(...)` setup, which requires Three.js, ECS world, plugin bootstrap, saved-game loading — expensive scaffolding to stand up in a test.

**Action:** Extract the boot-time lifecycle decision into a small pure helper: `pickBootLifecycle({startMenuExists, skipStartMenuOnBoot}) -> "start-menu" | "playing"`. Move the transition call into a one-line switch off that return value. The helper is trivially unit-testable and its four-case truth table pins the behavior. Ancillary: an integration test that boots a minimal host and asserts `getState().lifecycle` post-`start()` is `"playing"` for the fresh-start case would catch any future regressions in the wiring layer, but the pure helper is the cheapest first step.

**Meta-lesson:** Any function whose bug can be silently hidden by unrelated systems (input manager here bypassing the action registry) deserves either (a) direct test coverage or (b) an assertion that the transition landed. Prefer (a).

### 3. Region items spawn through TWO independent paths — visual mesh vs ECS Interactable

**Severity:** Medium (already caused one bug; will cause more)

**Symptom:** In 055.6, filtering item presences with `shouldSkipItemPresence` in `registerItemInteractables` (`packages/runtime-core/src/coordination/gameplay-session.ts`) correctly suppressed the E prompt for already-collected items — but the visual three.js mesh still spawned because it's rendered by a totally separate iteration over `region.scene.itemPresences` at `targets/web/src/runtimeHost.ts:1519` (`resolveSceneObjects` -> mesh spawn loop). Fixed by adding a second identical filter to the mesh path. Two filters means two places to remember, and next time we need to filter (e.g., episode-scoped presence gating for Plan 056) we'll forget again.

**Root cause:** "Should this item be in the world?" has no single source of truth. The three.js renderer iterates `region.scene.itemPresences` -> `resolveSceneObjects` (visual). The gameplay assembly ALSO iterates `region.scene.itemPresences` -> `registerItemInteractables` (ECS Interactable). Both derive from the same authored list but neither subscribes to the other. Any filter has to be applied in both places, and there's no compile-time check that we did.

**Action:** Fold both spawn paths behind a single "presence spawn pipeline" — a host-owned iteration over `region.scene.itemPresences` (and later NPC + inspectable presences) that applies filters ONCE, then hands off spawn semantics to a renderer callback and an ECS callback. Filters (world.presence collected-list, future episode gating, future proximity culling) live at the pipeline level. Renderer and gameplay-session become downstream consumers instead of independent iterators.

**Meta-lesson (again):** When the same concept lives in two systems, expect one to be updated and the other to not. AGENTS.md's "one source of truth" rule is load-bearing; the moment you notice a copy of iteration logic, either unify or flag for unification. Two-way inconsistency bugs are silent by construction — the systems don't know about each other.

### 4. Tag Patch Version happily tags the same commit as an existing tag [FIXED — this branch]

**Severity:** Low (rarely hit in normal flow, but confusing when it does bite)

**Symptom:** 2026-07-02 incident. Nikki hit "Tag Patch Version" in the Release workspace while wordlark HEAD was still on the `v1.0.0` commit (deploy 1's auto-sync had nothing to commit -> HEAD unchanged from the auto-bootstrap tag). The endpoint tagged `v1.0.1` onto the same commit as `v1.0.0`. Both tags now point at the same commit. `git describe` (used by the version chip) tie-breaks between them nondeterministically — displayed `v1.0.0-N-g<sha>` instead of `v1.0.1-N-g<sha>` after the next deploy advanced HEAD.

**Root cause:** `sugardeploy-tag-patch-version` endpoint (`packages/plugins/src/catalog/sugardeploy/host/middleware.ts:3058`) validates that HEAD is a descendant of the base tag but doesn't check whether HEAD is EXACTLY AT an existing `v*.*.*` tag. When HEAD is on an existing tag, a patch bump is meaningless — the new tag can't produce a distinguishable `git describe` output because both tags are 0 commits away from HEAD.

**Action:** In the endpoint, after the base-tag ancestor check, run `git tag --points-at HEAD --list 'v*.*.*'`. If it returns any tag, refuse with a message explaining that the author needs at least one commit past the existing tag before Tag Patch Version means anything. The Deploy auto-sync usually creates that commit; if the author hasn't deployed since the last tag, nothing has changed and the patch bump would be spurious anyway.
