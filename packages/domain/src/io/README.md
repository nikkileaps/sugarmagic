# Domain IO

This module owns canonical load-time normalization for persisted domain
documents.

Its job is to take older or partially-populated authored payloads coming off
disk and upgrade them into the current domain shape before the rest of the
system touches them.

This keeps migration logic at the IO boundary instead of scattering legacy
field handling across authoring-session, runtime, and UI code.
