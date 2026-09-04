/**
 * One place decides which command each scene-object kind commits a transform
 * through.
 *
 * This was decided in three places once, and the copy the context menu used
 * ended in an unguarded "anything else is an NPC". A marker reaching it would
 * have fired a presence command for an id no presence had: nothing changes,
 * nothing errors.
 */

import { describe, expect, it } from "vitest";
import {
  singleTransformCommand,
  transformCommitFor
} from "@sugarmagic/workspaces";
import type { SceneObject } from "@sugarmagic/runtime-core";

const VALUES = {
  position: [1, 2, 3] as [number, number, number],
  rotation: [0, 0.5, 0] as [number, number, number],
  scale: [2, 2, 2] as [number, number, number]
};

const EVERY_KIND: SceneObject["kind"][] = [
  "asset",
  "player",
  "npc",
  "item",
  "marker"
];

describe("which command a kind commits through", () => {
  it("has an answer for every scene-object kind", () => {
    for (const kind of EVERY_KIND) {
      expect(() => transformCommitFor(kind)).not.toThrow();
    }
  });

  it("sends a marker through a patch and everything else through a transform", () => {
    expect(transformCommitFor("marker")).toEqual({ via: "marker-patch" });
    for (const kind of ["asset", "player", "npc", "item"] as const) {
      expect(transformCommitFor(kind).via).toBe("transform");
    }
  });

  it("gives each kind its own command, never sharing one", () => {
    const commands = EVERY_KIND.map(
      (kind) => singleTransformCommand(kind, "region-1", "thing-1", VALUES).kind
    );
    expect(new Set(commands).size).toBe(EVERY_KIND.length);
  });

  it("never calls a marker an NPC", () => {
    const command = singleTransformCommand(
      "marker",
      "region-1",
      "spawn_1",
      VALUES
    );
    expect(command.kind).toBe("UpdateRegionMarker");
    expect(command.subject.subjectKind).toBe("region-marker");
  });

  it("names a placed asset by instanceId and a presence by presenceId", () => {
    const asset = singleTransformCommand("asset", "region-1", "crate", VALUES);
    const npc = singleTransformCommand("npc", "region-1", "warden", VALUES);
    expect(asset.payload).toMatchObject({ instanceId: "crate" });
    expect(npc.payload).toMatchObject({ presenceId: "warden" });
  });

  it("carries the transform it was given", () => {
    const command = singleTransformCommand(
      "player",
      "region-1",
      "player_1",
      VALUES
    );
    expect(command.payload).toMatchObject({
      position: [1, 2, 3],
      rotation: [0, 0.5, 0],
      scale: [2, 2, 2]
    });
  });

  it("targets the region it was given", () => {
    const command = singleTransformCommand(
      "item",
      "forest_north",
      "key",
      VALUES
    );
    expect(command.target).toEqual({
      aggregateKind: "region-document",
      aggregateId: "forest_north"
    });
  });
});
