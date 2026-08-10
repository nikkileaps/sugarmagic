/**
 * packages/testing/src/storage-names.test.ts
 *
 * Purpose: Storage a game creates on a player's device is named for the GAME
 *   (Plan 092.6).
 *
 * THE TWO BUGS THIS LOCKS OUT
 *   Every store used to compose its own database name, and several ended up
 *   with no game in the name at all. A published game is isolated by its
 *   origin so it survived that; Studio Preview serves every project from ONE
 *   origin, so two projects read and wrote each other's saves and learner data
 *   with no sign anything was wrong.
 *
 *   The second is quieter: those names led with the name of the TOOL. A
 *   player's device carries the name of the game they chose to play. The
 *   toolchain is not their concern and does not belong on their disk.
 *
 * Status: active
 */

import { afterEach, describe, expect, it } from "vitest";
import {
  gameScopedStorageName,
  getActiveGameId,
  registerActiveGameId
} from "@sugarmagic/runtime-core";

afterEach(() => registerActiveGameId(null));

describe("092.6 - storage on a player's device is named for the game", () => {
  it("THE ONE THAT MATTERS: the name leads with the game, not the toolchain", () => {
    registerActiveGameId("wordlark");
    const name = gameScopedStorageName("saves");

    expect(name.startsWith("wordlark")).toBe(true);
    // The tool that built the game has no business on the player's disk.
    expect(name).not.toContain("sugarmagic");
  });

  it("two games on one origin get different names for the same store", () => {
    // This is Studio Preview: one origin, many projects. Without the game id
    // both projects opened the same database and neither could tell.
    registerActiveGameId("wordlark");
    const first = gameScopedStorageName("saves", "user-a");
    registerActiveGameId("some-other-game");
    const second = gameScopedStorageName("saves", "user-a");

    expect(first).not.toBe(second);
  });

  it("REFUSES to name storage before the game is known", () => {
    // A name with no game in it is a database shared by every game on the
    // origin. Failing is the only outcome that cannot be missed.
    registerActiveGameId(null);
    expect(() => gameScopedStorageName("saves")).toThrow(/before the game id is known/);
  });

  it("treats a blank game id as no game id", () => {
    // An empty string would otherwise produce ":saves" and silently collide.
    registerActiveGameId("");
    expect(getActiveGameId()).toBeNull();
    expect(() => gameScopedStorageName("saves")).toThrow();
  });

  it("joins the parts in the order given, skipping empty ones", () => {
    registerActiveGameId("wordlark");
    expect(gameScopedStorageName("records", "sugarlang", "cards", "user-a")).toBe(
      "wordlark:records:sugarlang:cards:user-a"
    );
    expect(gameScopedStorageName("saves", "")).toBe("wordlark:saves");
  });
});
