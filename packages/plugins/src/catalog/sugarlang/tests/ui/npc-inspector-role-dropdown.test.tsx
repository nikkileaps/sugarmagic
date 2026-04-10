/**
 * packages/plugins/src/catalog/sugarlang/tests/ui/npc-inspector-role-dropdown.test.tsx
 *
 * Purpose: Verifies the Sugarlang NPC role inspector control.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Exercises ../../ui/shell/npc-inspector-role-dropdown and ../../ui/shell/editor-support.
 *   - Guards the Epic 12 NPC placement-tag authoring affordance.
 *
 * Implements: Epic 12 Story 12.1
 *
 * Status: active
 */

import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { NPCDefinition } from "@sugarmagic/domain";
vi.mock("@sugarmagic/ui", () => ({
  PanelSection: ({
    title,
    children
  }: {
    title: string;
    children: ReactNode;
  }) => (
    <section>
      <h2>{title}</h2>
      {children}
    </section>
  )
}));
import { NpcInspectorRoleDropdown } from "../../ui/shell/npc-inspector-role-dropdown";
import {
  getSugarlangNpcRole,
  setSugarlangNpcRole
} from "../../ui/shell/editor-support";

function createNpc(interactionMode: NPCDefinition["interactionMode"]): NPCDefinition {
  return {
    definitionId: "npc-1",
    displayName: "Orrin",
    description: "Station manager",
    interactionMode,
    lorePageId: null,
    presentation: {
      modelAssetDefinitionId: null,
      modelHeight: 1.7,
      animationAssetBindings: {
        idle: null,
        walk: null,
        run: null
      }
    }
  };
}

describe("NpcInspectorRoleDropdown", () => {
  it("round-trips the placement role through NPC metadata helpers", () => {
    const npc = createNpc("agent");
    const updated = setSugarlangNpcRole(npc, "placement");
    const cleared = setSugarlangNpcRole(updated, "");

    expect(getSugarlangNpcRole(updated)).toBe("placement");
    expect(updated.metadata?.sugarlangRole).toBe("placement");
    expect(getSugarlangNpcRole(cleared)).toBe("");
    expect(cleared.metadata).toBeUndefined();
  });

  it("renders for agent NPCs", () => {
    const markup = renderToStaticMarkup(
      <NpcInspectorRoleDropdown
        selectedNPC={createNpc("agent")}
        updateNPC={vi.fn()}
      />
    );

    expect(markup).toContain("Sugarlang Role");
    expect(markup).toContain("Placement");
  });

  it("stays hidden for scripted NPCs", () => {
    const markup = renderToStaticMarkup(
      <NpcInspectorRoleDropdown
        selectedNPC={createNpc("scripted")}
        updateNPC={vi.fn()}
      />
    );

    expect(markup).toBe("");
  });
});
