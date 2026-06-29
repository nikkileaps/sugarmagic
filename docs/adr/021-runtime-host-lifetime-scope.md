# ADR 021: Runtime Host Lifetime — Component-Scope vs Module-Scope

## Status

Accepted.

## Context

Sugarmagic has two React mount surfaces that both construct a
`WebRuntimeHost`:

- **`targets/web/src/App.tsx`** — the deployed published-web
  bundle. Top-level React app; renders the runtime canvas via
  `<div ref={rootRef}>`. Host is created inside `useEffect`,
  lives in a `hostRef`. Subscribes to host state via React
  `useState` + setter calls from host callbacks.
- **`apps/studio/src/preview.tsx`** — Studio's preview iframe
  embedded in the editor. Receives a `PREVIEW_BOOT` postMessage
  from Studio's parent window. Host is created at module
  scope, before any React component mounts. The React overlay
  component subscribes to host state via `useSyncExternalStore`
  against the host's `ObservableValue` fields exposed at
  `host.state.*` (Plan 051).

The two files reach for different React APIs to read the same
conceptual state. That asymmetry is structurally caused, NOT
stylistic: the root DOM element each file passes into
`createWebRuntimeHost({root: ...})` becomes available at
different times.

- preview's `root` is a static `<div id="preview-root">` in the
  iframe's HTML, present at module load. Host can be
  constructed immediately at module scope; subscribers attach
  later via `useSyncExternalStore`.
- App.tsx's `root` is a `<div ref={rootRef}>` rendered BY
  React. The ref is `null` until React's first commit. Host
  cannot be constructed until `useEffect` runs after that
  commit. The natural React API for "state owned by the
  component that owns the host's lifetime" is `useState`.

Surface this rule in a single place because forgetting it leads
to the classic "works in preview, fails in prod" drift class:
someone changes one surface, forgets that the other uses a
different React subscription mechanism, and the divergence
festers.

## Decision

**The runtime host is `module`-scoped when the root DOM
element is provided statically. It is `component`-scoped when
the root is rendered by React.**

Concretely:

- **`preview.tsx` keeps module-scope host + `useSyncExternalStore`.**
  Required because the `window.addEventListener("message",
  ...)` handler reads from `host` outside any React lifecycle,
  AND because the root is static.
- **`App.tsx` keeps component-scope host + `useState`-driven
  subscription via host callbacks.** The host lives in a
  `hostRef`; `useEffect` constructs / disposes it. React owns
  the lifecycle.

`host.state.*` (`ObservableValue<T>` from Plan 051) is the
canonical source of truth in BOTH cases. React subscribers in
preview consume it directly via `useSyncExternalStore`; React
subscribers in App.tsx consume it indirectly via host callbacks
that call `setState`. The state shape, the runtime logic, and
the host code itself are identical between the two paths.

## Consequences

**Why this is the right answer:**

- React APIs match the actual ownership: `useState` for state
  owned by a component, `useSyncExternalStore` for state owned
  outside React. Each surface picks the one that matches.
- Dev-quality-of-life stays intact for App.tsx:
  - HMR re-runs `useEffect`'s cleanup + setup correctly when
    target-web code changes. Module-scope side effects would
    leak the previous host on each module reload.
  - React 18 StrictMode in dev double-mounts components to
    surface effect-cleanup bugs. Component-scope exercises the
    dispose path; module-scope doesn't.
  - `import App from "./App"` in tests is side-effect-free.
    Module-scope `createWebRuntimeHost` at import time would
    spawn a runtime in every test that imports the module.

**Why the asymmetry doesn't cause prod drift:**

The shared layer — `host` itself, `host.state.*`, the runtime
code reading from it, the gateway clients, the HUD card
getters (Plan 051 §51.3) — is identical between the two
paths. The asymmetry exists only in HOW each file's React
component wires up to `host.state.*`:

- preview: `useSyncExternalStore(host.state.X.subscribe,
  host.state.X.getSnapshot)`.
- App.tsx: `useState(active)` + the host's callback path
  (`onProvidersResolved` etc.) calls `setActive(resolved)`.

Both end up with the same React state after host state changes.
Neither is bug-prone in isolation — App.tsx's callback fires
inside the same `useEffect` that registered it, so there's no
late-subscriber race (the race Plan 051 fixed in preview
specifically because preview's host was module-scope and
React's effect attached later).

**Mitigations against drift:**

- Each file carries a docstring at the top explaining its
  scope choice and pointing to the other surface AND to this
  ADR.
- This ADR is the canonical reference. When a future change
  modifies subscription behaviour, both surfaces must be
  considered together — the ADR is the bookmark.
- If anyone is tempted to "unify" by moving App.tsx to module-
  scope, re-read the dev-quality-of-life list above. The cost
  is real.
- If anyone is tempted to "unify" by moving preview to
  component-scope, the postMessage protocol with Studio's
  parent would need to buffer or defer until the React
  component mounts. That's an architectural change to the
  parent ↔ iframe contract, not a local refactor.

**Trigger to revisit this decision:**

- If a third React surface lands (e.g. a separate debug iframe,
  a future game-list shell), it picks its scope by the same
  rule: static root → module-scope; React-rendered root →
  component-scope.
- If we ever need to mount multiple App.tsx instances on the
  same page (unlikely; would be a dev-tool side-by-side
  comparison), module-scope would block that. Component-scope
  for App.tsx is the correct choice for that future.
- If HMR or StrictMode behavior changes substantially in a
  future React version, re-evaluate the dev-quality-of-life
  argument.

## References

- [Plan 051: Runtime Handoff Load-Order Architecture](/docs/plans/051-runtime-handoff-load-order-architecture.md)
  — introduced `ObservableValue<T>` + `host.state.*`; the
  story 51.2 migration that triggered this decision.
- [`useSyncExternalStore` — React docs](https://react.dev/reference/react/useSyncExternalStore)
  — the React API preview.tsx uses to subscribe to host state.
- [`useState` — React docs](https://react.dev/reference/react/useState)
  — the React API App.tsx uses to mirror host state.
