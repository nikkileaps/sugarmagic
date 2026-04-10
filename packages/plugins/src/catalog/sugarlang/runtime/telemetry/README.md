# Sugarlang Telemetry

This module is the single source of truth for Sugarlang runtime telemetry.

It owns:

- the canonical event schema
- sink implementations for tests and Studio preview
- rationale-trace reconstruction
- debug-panel data aggregation

Gameplay systems should only emit typed telemetry events through this module.
Studio debug panels should only query through this module. That keeps event
shape, persistence, and debug reconstruction aligned behind one contract.
