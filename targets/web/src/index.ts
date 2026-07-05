export * from "./runtimeHost";
export * from "./bootPreviewSession";
export * from "./audio";
export {
  useAutosave,
  runAutosaveTick,
  gameSavePayloadsEqual,
  type AutosaveTickSource,
  type UseAutosaveOptions
} from "./save/useAutosave";
export {
  migrateLocalSaveToCloud,
  type MigrateLocalSaveToCloudOptions,
  type MigrateLocalSaveToCloudResult
} from "./save/migrate-local-to-cloud";
export {
  waitForActiveUser,
  type WaitForActiveUserOptions
} from "./save/waitForActiveUser";
export {
  FRESH_START_SESSION_STORAGE_KEY,
  consumeFreshStartFlag
} from "./save/freshStart";
export { SUGARMAGIC_VERSION } from "./version";
// Plan 058 §058.6 — card styling constants shared with Studio's
// Scene properties preview so preview and runtime card can't
// drift apart.
export {
  SCENE_CARD_FADE_BACKGROUNDS,
  SCENE_CARD_FADE_TEXT_COLORS,
  SCENE_CARD_FONT_FAMILY
} from "./sceneTransitionCard";
// Plan 059 §059.2 — credits roll (consumed by the 059.3 exit
// sequence; exported for potential Studio preview reuse).
export { showCreditsRoll } from "./creditsRoll";
