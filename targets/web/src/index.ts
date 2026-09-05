export * from "./runtimeHost";
export { normalizeBootPayload } from "./bootPayload";
export * from "./bootPreviewSession";
export * from "./audio";
export {
  useAutosave,
  runAutosaveTick,
  gameSavePayloadsEqual,
  autosaveRetryDelayMs,
  AUTOSAVE_MAX_RETRY_DELAY_MS,
  AUTOSAVE_FAILURE_NOTICE_THRESHOLD,
  type AutosaveStatus,
  type AutosaveTickSource,
  type UseAutosaveOptions
} from "./save/useAutosave";
export {
  useAutosaveFailureNotice,
  type AutosaveFailureNotice
} from "./save/AutosaveFailureNotice";
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
// The questions plugins ask between the New Game press and the wipe, and the
// handshake that carries the answers across the reload.
export {
  PRE_NEW_GAME_ANSWERS_SESSION_STORAGE_KEY,
  consumePreNewGameStepAnswers,
  runPreNewGameSteps,
  writePreNewGameStepAnswers,
  type PreNewGameStepPresenter,
  type PreNewGameStepStorage
} from "./preNewGameSteps";
export { SUGARMAGIC_VERSION } from "./version";
// Plan 058 §058.6 — card styling constants shared with Studio's
// Scene properties preview so preview and runtime card can't
// drift apart.
export {
  TRANSITION_CARD_FADE_BACKGROUNDS,
  TRANSITION_CARD_FADE_TEXT_COLORS,
  TRANSITION_CARD_FONT_FAMILY
} from "./transitionCard";
// Plan 059 — the exit overlay (credits + Netflix routing) and
// the pacing formula Studio's live preview shares (§059.6).
export {
  showSceneExitOverlay,
  computeCreditsRollDurationMs
} from "./creditsRoll";
// Plan 060 §060.1 — boot asset preload phase.
export {
  preloadAssetSources,
  type AssetPreloadProgress,
  type PreloadAssetSourcesOptions
} from "./assetPreload";
