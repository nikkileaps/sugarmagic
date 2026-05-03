/**
 * Build audio workspace exports.
 *
 * Keeps the workspace contribution behind a small module boundary so Build
 * mode can mount region audio authoring without owning its implementation.
 */

export * from "./AudioWorkspaceView";
