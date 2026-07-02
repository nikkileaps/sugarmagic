/**
 * packages/runtime-core/src/game-state/pick-boot-lifecycle.test.ts
 *
 * Purpose: Pins the four-case truth table for `pickBootLifecycle`.
 * This is the extracted core of `runtimeHost.ts`'s boot-lifecycle
 * decision — the exact function whose missing else branch went
 * unnoticed across Plan 054-055 because no test touched it and
 * movement + E-interact bypassed the mode gate that would have
 * surfaced the bug end-to-end.
 *
 * Fixed: Paper cut #2 in docs/backlog/003-runtime-paper-cuts.md.
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import { pickBootLifecycle } from "./index";

describe("pickBootLifecycle", () => {
  it("start-menu when the menu exists AND we are not skipping it", () => {
    expect(
      pickBootLifecycle({
        startMenuExists: true,
        skipStartMenuOnBoot: false
      })
    ).toBe("start-menu");
  });

  it("playing when the menu exists but the fresh-start flag skips it", () => {
    // The New Game reset flow sets sessionStorage's fresh-start
    // flag and reloads; the boot after that pass `skipStartMenuOnBoot: true`
    // so the player drops straight into gameplay without a second
    // click on the menu.
    expect(
      pickBootLifecycle({
        startMenuExists: true,
        skipStartMenuOnBoot: true
      })
    ).toBe("playing");
  });

  it("playing when the project has no start-menu at all (nothing to show)", () => {
    // Some projects don't author a start-menu. Pre-055.7 this
    // case fell through to lifecycle stuck at "booting" with the
    // resolver treating it as "paused" — the bug.
    expect(
      pickBootLifecycle({
        startMenuExists: false,
        skipStartMenuOnBoot: false
      })
    ).toBe("playing");
  });

  it("playing when neither the menu exists nor we are skipping it (both signals point at direct gameplay)", () => {
    // Redundant but complete. Truth table needs all four rows.
    expect(
      pickBootLifecycle({
        startMenuExists: false,
        skipStartMenuOnBoot: true
      })
    ).toBe("playing");
  });
});
