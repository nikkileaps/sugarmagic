/**
 * Mechanics domain tests.
 *
 * Guards the project-owned mechanics source of truth and legacy project
 * normalization behavior.
 */

import { describe, expect, it } from "vitest";
import {
  createDefaultGameProject,
  createDefaultMechanicsDefinition,
  normalizeGameProject
} from "@sugarmagic/domain";

describe("mechanics domain", () => {
  it("normalizes legacy projects with an explicit default mechanics block", () => {
    const project = createDefaultGameProject("Mechanics", "mechanics-test");
    const normalized = normalizeGameProject({
      ...project,
      mechanics: undefined
    } as never);

    expect(normalized.mechanics).toEqual(createDefaultMechanicsDefinition());
  });

  it("preserves explicitly empty mechanics blocks", () => {
    const project = createDefaultGameProject("Mechanics", "mechanics-test");
    const normalized = normalizeGameProject({
      ...project,
      mechanics: { stats: [], castables: [] }
    });

    expect(normalized.mechanics).toEqual({ stats: [], castables: [] });
  });
});
