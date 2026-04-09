# Middleware API

Status: Updated in Epic 2; expanded further in Epic 10

This document describes the sugarlang middleware metadata seam that exists before
the full middleware pipeline lands in Epic 10.

## How Sugarlang Middlewares Read Authoring Metadata

Sugarlang middlewares do not need to look up NPC definitions directly. They read
the authored metadata already propagated into the conversation execution
context:

```ts
function prepare(execution: ConversationExecutionContext) {
  const role = execution.selection.metadata?.sugarlangRole;
  if (role === "placement") {
    // placement-specific behavior
  }
  return execution;
}
```

The propagation path is:

`NPCDefinition.metadata` -> `ConversationSelectionContext.metadata` ->
`ConversationExecutionContext.selection.metadata`

Reserved sugarlang annotation keys remain defined by Proposal 001's annotation
namespace reference. This document only covers the authoring-metadata read path
introduced in Epic 2.
