/**
 * targets/web/src/version.ts
 *
 * The deployed bundle's build-time version stamp. Sourced from
 * `git describe --tags --always --dirty` inside `vite.config.ts`;
 * see that file for the resolution rules. Surfaced via:
 *
 *   - the start-menu footer chip in App.tsx
 *   - `X-Game-Version` response header (Netlify _headers, written
 *     by the vite plugin)
 *   - `GameSave.writtenByVersion` stamped on every autosave tick
 *
 * Falls back to "unknown" if the Vite define somehow didn't land
 * (shouldn't happen in normal builds — defensive null guard only).
 */

declare const __SUGARMAGIC_VERSION__: string | undefined;

export const SUGARMAGIC_VERSION: string =
  typeof __SUGARMAGIC_VERSION__ === "string" ? __SUGARMAGIC_VERSION__ : "unknown";
