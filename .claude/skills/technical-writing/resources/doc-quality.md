# Docs Quality Engineering: Docs Are Tested Behavior

Docs should be written as clearly and concisely as possible. Use the doc-types skill to figure out which type of doc is being written.

# Lifecycle: State, Not Age
Maintained documentation describes current truth. Keep an active plan or specification workspace only while its outcome is unfinished. Delete it when the outcome ships or its assumptions are superseded; do not assign completed specifications a time-to-live or retain them as an informal archive. Git already preserves the history.

Documentation-only changes do not inherently require running typecheck or tests.

Errors are documentation: every error carries an identifier, cause, and remediation. An API reference documenting only the happy path documents half the API.
