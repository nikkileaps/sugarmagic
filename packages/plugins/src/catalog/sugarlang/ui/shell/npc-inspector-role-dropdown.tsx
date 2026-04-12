/**
 * packages/plugins/src/catalog/sugarlang/ui/shell/npc-inspector-role-dropdown.tsx
 *
 * Purpose: Renders the NPC inspector dropdown that assigns a Sugarlang role to an NPC.
 *
 * Exports:
 *   - NpcInspectorRoleDropdown
 *
 * Relationships:
 *   - Depends on authored NPC metadata and the shared NPC inspector section seam.
 *   - Is registered by contributions.ts as an Epic 12 design.section contribution.
 *
 * Implements: Proposal 001 §Cold Start Sequence / §Placement Interaction Contract
 *
 * Status: active
 */

import type { NPCDefinition } from "@sugarmagic/domain";
import { PanelSection } from "@sugarmagic/ui";
import type { ReactElement } from "react";
import {
  getSugarlangNpcRole,
  setSugarlangNpcRole,
  type SugarlangNpcRole
} from "./editor-support";

export interface NpcInspectorRoleDropdownProps {
  selectedNPC: NPCDefinition | null;
  updateNPC: (definition: NPCDefinition) => void;
}

export function NpcInspectorRoleDropdown(
  props: NpcInspectorRoleDropdownProps
): ReactElement | null {
  const { selectedNPC, updateNPC } = props;
  if (!selectedNPC || selectedNPC.interactionMode !== "agent") {
    return null;
  }

  const role = getSugarlangNpcRole(selectedNPC);

  return (
    <PanelSection title="Sugarlang Role" icon="🗣️">
      <div style={{ display: "grid", gap: "0.75rem" }}>
        <label style={{ display: "grid", gap: "0.35rem" }}>
          <span style={{ fontSize: "0.8rem", fontWeight: 600 }}>Role</span>
          <select
            aria-label="Sugarlang role"
            title="Placement NPCs run the cold-start language assessment the first time the player talks to them."
            value={role}
            onChange={(event) =>
              updateNPC(
                setSugarlangNpcRole(
                  selectedNPC,
                  (event.currentTarget.value === "placement"
                    ? event.currentTarget.value
                    : "") as SugarlangNpcRole
                )
              )
            }
            style={{
              minHeight: 32,
              borderRadius: 8,
              border: "1px solid var(--sm-panel-border)",
              background: "var(--sm-color-surface1)",
              color: "var(--sm-color-text)",
              padding: "0.4rem 0.55rem"
            }}
          >
            <option value="">None</option>
            <option value="placement">Placement</option>
          </select>
        </label>
        <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--sm-color-overlay0)" }}>
          Placement NPCs are the authored entry point into Sugarlang's cold-start assessment flow.
        </p>
      </div>
    </PanelSection>
  );
}
