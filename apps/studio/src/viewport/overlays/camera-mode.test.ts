/**
 * Which camera controller drives the viewport (epic #226 story 8).
 *
 * The scene composer navigates the world the way Build's Layout does,
 * but it is its OWN mode -- each mode holds a separate controller
 * instance, so panning around a region in Build does not move where the
 * composer was left looking, and the reverse.
 */

import { describe, expect, it } from "vitest";
import { resolveCameraMode } from "./authoring-camera";

describe("camera mode", () => {
  it("the composer gets its own mode, not Build's layout", () => {
    expect(resolveCameraMode("story", "layout", "composer")).toBe("composer");
    expect(resolveCameraMode("build", "layout", "composer")).toBe("layout");
  });

  it("Story's panel workspaces have no camera", () => {
    expect(resolveCameraMode("story", "layout", "structure")).toBe("inactive");
    expect(resolveCameraMode("story", "layout", "quests")).toBe("inactive");
  });

  it("Build's own modes are unchanged", () => {
    expect(resolveCameraMode("build", "landscape", "structure")).toBe(
      "landscape"
    );
    expect(resolveCameraMode("build", "spatial", "structure")).toBe("spatial");
    expect(resolveCameraMode("design", "layout", "structure")).toBe("inactive");
  });
});
