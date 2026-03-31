# ADR 004: Command and Transaction Boundary

**Status:** Accepted
**Date:** 2026-03-31

## Context

A unified authoring/runtime product cannot rely on ad hoc mutation of canonical documents.

Without a formal boundary:

- view code will mutate authored truth directly
- half-finished interactions will leak into canonical state
- undo/redo will become inconsistent across ProductModes
- plugin behavior will create side mutation paths

## Decision

All canonical authored mutations must pass through a formal command and transaction boundary.

The required mutation path is:

1. user or tool intent
2. semantic command
3. validation
4. transaction
5. canonical mutation
6. derived refresh

Undo and redo operate on committed authoring transactions only.

## Rules

1. UI, tools, runtime preview, and plugins do not mutate canonical documents directly.
2. Preview is not commit.
3. Commands must be semantic, not arbitrary field patches.
4. Transactions must provide atomic canonical mutation boundaries.
5. Undo/redo history targets committed authoring transactions.

## Consequences

### Positive

- authored truth gets one mutation path
- undo/redo becomes architecture, not convenience
- preview and commit remain cleanly separated

### Tradeoffs

- up-front command design is required
- some seemingly simple operations will need explicit semantic commands

## Builds On

- [Proposal 008: Command and Transaction Architecture](/Users/nikki/projects/sugarmagic/docs/proposals/008-command-and-transaction-architecture.md)
- [Proposal 005: Sugarmagic System Architecture](/Users/nikki/projects/sugarmagic/docs/proposals/005-sugarmagic-system-architecture.md)
