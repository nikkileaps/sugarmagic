/**
 * packages/plugins/src/catalog/sugarlang/ui/shell/item-view-variants-connected.tsx
 *
 * Purpose: Studio section for grading an item's Examine text into the target
 * language at each display band.
 *
 * Exports:
 *   - ItemViewVariantsConnected
 *
 * Relationships:
 *   - Drives the VariantAuthoringClient's item-view methods.
 *   - Mirrors variant-popover-connected.tsx (the dialogue-node equivalent).
 *
 * Implements: Epic 086 Story 086.3 (item view grading trigger, 2026-07-28)
 *
 * Status: active
 *
 * WHY A MANUAL BUTTON
 *
 * Same reason the dialogue side has one: the automated `variantPipeline` on the
 * compile scheduler has no production call site, so a per-thing button is the
 * only working trigger today. When automated baking lands it will run the same
 * registry and write the same records -- this becomes a "regrade now" nicety
 * rather than the only way in.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, Group, Stack, Text } from "@mantine/core";
import type { ItemDefinition } from "@sugarmagic/domain";
import type { CEFRBand } from "../../runtime/contracts/learner-profile";
import type { BakedLineVariant } from "../../runtime/contracts/baked-variant";
import { createVariantAuthoringClient } from "./editor-support";

const BANDS: CEFRBand[] = ["B1", "B2", "C1", "C2"];

export interface ItemViewVariantsConnectedProps {
  item: ItemDefinition | null;
  targetLanguage: string | null;
  workspaceId: string;
}

/** Only these view kinds render title/body prose; the rest have nothing to grade. */
const GRADABLE_KINDS = new Set(["examine", "consumable"]);

export function ItemViewVariantsConnected({
  item,
  targetLanguage,
  workspaceId
}: ItemViewVariantsConnectedProps) {
  const client = useMemo(() => createVariantAuthoringClient(), []);
  const [variants, setVariants] = useState<Partial<Record<CEFRBand, BakedLineVariant>>>(
    {}
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const body = item?.interactionView.body ?? "";
  const gradable =
    item !== null && GRADABLE_KINDS.has(item.interactionView.kind) && body.trim().length > 0;

  useEffect(() => {
    if (!item || !targetLanguage || !gradable) {
      setVariants({});
      return;
    }
    let cancelled = false;
    void client
      .getVariantsForItemView(item.definitionId, "body", body, targetLanguage, workspaceId)
      .then((loaded) => {
        if (!cancelled) setVariants(loaded);
      })
      .catch(() => {
        if (!cancelled) setVariants({});
      });
    return () => {
      cancelled = true;
    };
  }, [client, item, targetLanguage, workspaceId, body, gradable]);

  const generate = useCallback(async () => {
    if (!item || !targetLanguage) return;
    setBusy(true);
    setError(null);
    try {
      const generated = await client.generateVariantsForItemView(
        item.definitionId,
        "body",
        body,
        targetLanguage,
        workspaceId
      );
      setVariants(generated);
      if (Object.keys(generated).length === 0) {
        setError("No variants generated. Check the gateway is configured.");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Generation failed.");
    } finally {
      setBusy(false);
    }
  }, [client, item, targetLanguage, workspaceId, body]);

  if (!item) return null;

  if (!targetLanguage) {
    return (
      <Text size="xs" c="var(--sm-color-overlay0)">
        Set a target language in Sugarlang settings to grade item text.
      </Text>
    );
  }

  if (!gradable) {
    return (
      <Text size="xs" c="var(--sm-color-overlay0)">
        Add Examine body text to grade it into {targetLanguage}.
      </Text>
    );
  }

  return (
    <Stack gap="xs">
      <Group gap="xs" align="center">
        <Button size="compact-xs" onClick={() => void generate()} loading={busy}>
          Generate {targetLanguage} variants
        </Button>
        {!client.gatewayAvailable ? (
          <Text size="xs" c="var(--mantine-color-yellow-6)">
            Gateway not configured
          </Text>
        ) : null}
      </Group>

      {error ? (
        <Text size="xs" c="var(--mantine-color-red-6)">
          {error}
        </Text>
      ) : null}

      {BANDS.map((band) => {
        const variant = variants[band];
        return (
          <Stack key={band} gap={2}>
            <Group gap="xs" align="center">
              <Badge size="xs" variant="outline" color="grape">
                {band}
              </Badge>
              {variant?.reviewFlag ? (
                <Badge size="xs" color="red" variant="light">
                  flagged
                </Badge>
              ) : null}
            </Group>
            <Text size="xs" c={variant ? undefined : "var(--sm-color-overlay0)"}>
              {variant?.text ?? "not generated"}
            </Text>
          </Stack>
        );
      })}

      <Text size="xs" c="var(--sm-color-overlay0)">
        Flagged variants are not shown to players -- the item falls back to English.
      </Text>
    </Stack>
  );
}
