# Sugarlang Telemetry

This module is the single source of truth for Sugarlang runtime telemetry.

It owns:

- the canonical event schema
- sink implementations: the gateway sink, a no-op, and an in-memory one for
  tests

Gameplay systems should only emit typed telemetry events through this module.
Delivery is one path everywhere -- Studio, Preview and the published game all
send to the gateway, which writes each event to stdout. Events are read there:
`docker compose logs` locally, Cloud Logging in production.
