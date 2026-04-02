# Backlog: Bootstrap Review Follow-ups

**Source:** Principal engineer review of Plan 001 implementation  
**Date:** 2026-03-31

## Items

### 1. Tighten boundary checker allowlist to match actual dependencies

**Severity:** Medium

The `tooling/check-package-boundaries.mjs` allowlist is more permissive than current reality. For example, `@sugarmagic/productmodes` is allowed to import from `domain`, `runtime-core`, `plugins`, `io`, and `ui` — but it currently imports nothing and architecturally should import very little (ProductModes are shell composition concepts per ADR 002, not domain owners). Similar gaps exist for `runtime-core → plugins`, `io → plugins`, and `targets/web → io, plugins`.

**Action:** Tighten the allowlist to reflect only the dependencies each package actually needs. Widen deliberately when a dependency is actually introduced, with a comment explaining why.

### 2. Remove unused zustand dependency from targets/web

**Severity:** Low

`@sugarmagic/target-web` declares `zustand` as a dependency in its `package.json` but never imports it. Dead dependency.

**Action:** Remove `zustand` from `targets/web/package.json` dependencies.

### 3. Add boundary check to vitest so pnpm test catches violations

**Severity:** Info

Running `pnpm test` alone does not catch boundary violations — only `pnpm lint` or `pnpm verify` does. A developer who runs only tests could miss an architectural violation.

**Action:** Consider adding a vitest test in the testing package that invokes the boundary checker, or document that `pnpm verify` is the expected validation command.

### 4. Hoisted node_modules resolution caveat

**Severity:** Info

The boundary checker validates `package.json` deps and source imports but cannot prevent someone from adding an import that TypeScript resolves via hoisted `node_modules` without declaring the dependency in `package.json`. pnpm's strict isolation mostly prevents this, but it's worth monitoring.

**Action:** No immediate action. pnpm strict mode handles this. Revisit if phantom dependencies become an issue.

### 5. scripts/ directory is empty

**Severity:** Info

The `scripts/` directory contains only a README. Acceptable for bootstrap but should gain real content as development proceeds.

**Action:** No immediate action. Will be populated naturally as build/dev scripts are needed.
