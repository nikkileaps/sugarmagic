/**
 * packages/domain/src/dialogue-definition/index.test.ts
 *
 * Purpose: Verifies dialogue speaker resolution -- the single answer to "whose
 * voice is this node?".
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Tests resolveDialogueSpeaker / speakerNpcDefinitionId / isPlayerSpeaker
 *     in ./index, which replaced several hand-rolled built-in-speaker
 *     comparisons across sugarlang, runtime-core and workspaces.
 *
 * Implements: Plan 090 Story 090.1
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import {
  BUILT_IN_DIALOGUE_SPEAKERS,
  EXCERPT_SPEAKER,
  NARRATOR_SPEAKER,
  PLAYER_SPEAKER,
  PLAYER_VO_SPEAKER,
  isPlayerSpeaker,
  resolveDialogueSpeaker,
  speakerNpcDefinitionId
} from "./index";

describe("resolveDialogueSpeaker", () => {
  it("resolves each built-in speaker id to its own kind", () => {
    expect(resolveDialogueSpeaker(PLAYER_SPEAKER.speakerId, null)).toEqual({
      kind: "player"
    });
    expect(resolveDialogueSpeaker(PLAYER_VO_SPEAKER.speakerId, null)).toEqual({
      kind: "player-vo"
    });
    expect(resolveDialogueSpeaker(NARRATOR_SPEAKER.speakerId, null)).toEqual({
      kind: "narrator"
    });
    expect(resolveDialogueSpeaker(EXCERPT_SPEAKER.speakerId, null)).toEqual({
      kind: "excerpt"
    });
  });

  it("covers every built-in speaker, so adding one cannot silently fall through", () => {
    for (const speaker of BUILT_IN_DIALOGUE_SPEAKERS) {
      expect(resolveDialogueSpeaker(speaker.speakerId, "npc-orrin")).toEqual({
        kind: speaker.kind
      });
    }
  });

  it("treats any non-built-in id as an NPC", () => {
    expect(resolveDialogueSpeaker("npc-finnick", "npc-orrin")).toEqual({
      kind: "npc",
      npcDefinitionId: "npc-finnick"
    });
  });

  it("falls back to the bound NPC when no speaker is set", () => {
    // The authoring default: an unset speaker on an NPC dialogue means the NPC
    // is talking. This was previously folklore duplicated across call sites.
    expect(resolveDialogueSpeaker(undefined, "npc-orrin")).toEqual({
      kind: "npc",
      npcDefinitionId: "npc-orrin"
    });
  });

  it("returns null when there is neither a speaker nor a bound NPC", () => {
    expect(resolveDialogueSpeaker(undefined, null)).toBeNull();
    expect(resolveDialogueSpeaker(null, undefined)).toBeNull();
    expect(resolveDialogueSpeaker("", null)).toBeNull();
  });

  it("prefers an explicit speaker over the bound NPC", () => {
    expect(
      resolveDialogueSpeaker(PLAYER_SPEAKER.speakerId, "npc-orrin")
    ).toEqual({ kind: "player" });
  });
});

describe("speakerNpcDefinitionId", () => {
  it("returns the id for NPC speakers and undefined for everyone else", () => {
    expect(
      speakerNpcDefinitionId({ kind: "npc", npcDefinitionId: "npc-finnick" })
    ).toBe("npc-finnick");
    expect(speakerNpcDefinitionId({ kind: "player" })).toBeUndefined();
    expect(speakerNpcDefinitionId({ kind: "narrator" })).toBeUndefined();
    expect(speakerNpcDefinitionId(null)).toBeUndefined();
  });
});

describe("isPlayerSpeaker", () => {
  it("is true for the player and their voice-over only", () => {
    expect(isPlayerSpeaker({ kind: "player" })).toBe(true);
    expect(isPlayerSpeaker({ kind: "player-vo" })).toBe(true);
  });

  it("is false for narration, excerpts, NPCs and nobody", () => {
    // Not the complement of speakerNpcDefinitionId: narrator and excerpt are
    // neither the player nor an NPC.
    expect(isPlayerSpeaker({ kind: "narrator" })).toBe(false);
    expect(isPlayerSpeaker({ kind: "excerpt" })).toBe(false);
    expect(
      isPlayerSpeaker({ kind: "npc", npcDefinitionId: "npc-orrin" })
    ).toBe(false);
    expect(isPlayerSpeaker(null)).toBe(false);
  });
});
