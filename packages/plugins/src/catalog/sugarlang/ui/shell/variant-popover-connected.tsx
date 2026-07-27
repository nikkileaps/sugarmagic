/**
 * packages/plugins/src/catalog/sugarlang/ui/shell/variant-popover-connected.tsx
 *
 * Purpose: Wires VariantsPopover to the authoring variant cache and generator.
 *          Loads existing band variants from IDB on mount, calls generateVariant
 *          for each DISPLAY_BAND when Generate is clicked, and saves manual edits.
 *
 * Exports:
 *   - VariantsPopoverConnected
 *
 * Relationships:
 *   - Wraps VariantsPopover with async state management.
 *   - Uses createVariantAuthoringClient from editor-support for LLM + IDB access.
 *   - Registered in contributions.ts for workspaceKind "dialogues".
 *
 * Implements: Epic 086 Story 086.3 -- wiring gap fix
 *
 * Status: active
 */

import { useState, useEffect, useRef, type ReactElement } from "react";
import type { DialogueDefinition, DialogueNodeDefinition } from "@sugarmagic/domain";
import type { BakedLineVariant } from "../../runtime/contracts/baked-variant";
import type { CEFRBand } from "../../runtime/contracts/learner-profile";
import { VariantsPopover } from "./variants-popover";
import { createVariantAuthoringClient } from "./editor-support";

export interface VariantsPopoverConnectedProps {
  node: DialogueNodeDefinition;
  onUpdateNode: (node: DialogueNodeDefinition) => void;
  targetLanguage: string;
  dialogue: DialogueDefinition | null;
  workspaceId: string;
}

const client = createVariantAuthoringClient();

export function VariantsPopoverConnected(props: VariantsPopoverConnectedProps): ReactElement {
  const { node, onUpdateNode, targetLanguage, dialogue, workspaceId } = props;
  const [bandVariants, setBandVariants] = useState<Partial<Record<CEFRBand, BakedLineVariant>>>({});
  const loadKeyRef = useRef("");

  // Reload variants from IDB whenever the node or language changes.
  useEffect(() => {
    const loadKey = `${node.nodeId}:${targetLanguage}`;
    loadKeyRef.current = loadKey;
    setBandVariants({});
    void client.getVariantsForNode(node.nodeId, node.text, targetLanguage, workspaceId).then((loaded) => {
      if (loadKeyRef.current === loadKey) {
        setBandVariants(loaded);
      }
    });
  }, [node.nodeId, node.text, targetLanguage, workspaceId]);

  async function handleGenerate(): Promise<void> {
    const dialogueDefinitionId = dialogue?.definitionId ?? "";
    const generated = await client.generateVariantsForNode(
      node.nodeId,
      node.text,
      dialogueDefinitionId,
      targetLanguage,
      workspaceId
    );
    setBandVariants((prev) => ({ ...prev, ...generated }));
  }

  async function handleUpdateVariant(band: CEFRBand, text: string): Promise<void> {
    const dialogueDefinitionId = dialogue?.definitionId ?? "";
    await client.saveVariant(node.nodeId, node.text, band, text, dialogueDefinitionId, targetLanguage, workspaceId);
    setBandVariants((prev) => ({
      ...prev,
      [band]: {
        ...(prev[band] ?? {}),
        text,
        reviewFlag: false,
        generatedByModel: "manual"
      } as BakedLineVariant
    }));
  }

  return (
    <VariantsPopover
      node={node}
      onUpdateNode={onUpdateNode}
      targetLanguage={targetLanguage}
      bandVariants={bandVariants}
      onGenerate={client.gatewayAvailable ? handleGenerate : undefined}
      onUpdateVariant={(band, text) => void handleUpdateVariant(band, text)}
    />
  );
}
