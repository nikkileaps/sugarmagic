// NodeEditor is deliberately NOT re-exported here. It imports React Flow, and this
// barrel is reachable from the shipped game through `@sugarmagic/ui`, which would
// pull the whole library into the game bundle. Import it from
// `@sugarmagic/ui/node-editor` instead.
export * from "./GraphCanvas";
