/**
 * packages/plugins/src/catalog/sugarlang/ui/shell/variant-report.tsx
 *
 * Purpose: Studio shell panel showing flagged baked line variants.
 *
 * Exports:
 *   - VariantReport
 *   - VariantReportProps
 *
 * Relationships:
 *   - Registered as a design.section contribution in contributions.ts for workspaceKind "sugarlang".
 *   - Receives flagged variants via getFlaggedVariants prop.
 *
 * Implements: Epic 086 Story 086.3 -- exception report panel
 *
 * Status: active
 */

import type { ReactElement } from "react";
import { Badge, Group, ScrollArea, Stack, Text } from "@mantine/core";
import type { BakedLineVariant } from "../../runtime/contracts/baked-variant";
import {
  describeGradedTextSource,
  gradedTextSourceKey
} from "../../runtime/contracts/graded-text";

export interface VariantReportProps {
  getFlaggedVariants: () => BakedLineVariant[];
}

function failedGates(variant: BakedLineVariant): string[] {
  const gates: string[] = [];
  if (!variant.verdict.envelopePasses) gates.push("envelope");
  if (!variant.verdict.ratioPasses) gates.push("ratio");
  if (variant.verdict.voiceRetentionScore < 1.0) gates.push("voice");
  if (!variant.verdict.fidelityPasses) gates.push("fidelity");
  return gates;
}

export function VariantReport(props: VariantReportProps): ReactElement {
  const flagged = props.getFlaggedVariants();

  if (flagged.length === 0) {
    return (
      <Text size="xs" c="dimmed">
        No flagged variants. All baked variants passed verification.
      </Text>
    );
  }

  return (
    <Stack gap="xs">
      <Text size="xs" c="dimmed">
        Flagged variants do not ship. Fix the source line or regenerate.
      </Text>
      <ScrollArea style={{ maxHeight: 480 }}>
        <Stack gap="sm">
          {flagged.map((variant) => {
            const gates = failedGates(variant);
            const key = `${gradedTextSourceKey(variant.source)}/${variant.lang}/${variant.band}`;
            return (
              <Stack key={key} gap={4} style={{ borderLeft: "2px solid var(--mantine-color-red-6)", paddingLeft: 8 }}>
                <Group gap="xs" align="center">
                  <Text size="xs" fw={600}>
                    {describeGradedTextSource(variant.source)}
                  </Text>
                  <Badge size="xs" color="blue" variant="outline">
                    {variant.lang}
                  </Badge>
                  <Badge size="xs" color="grape" variant="outline">
                    {variant.band}
                  </Badge>
                  <Badge size="xs" color="red">
                    Flagged
                  </Badge>
                </Group>
                <Text size="xs" c="dimmed" style={{ fontStyle: "italic" }}>
                  {variant.text}
                </Text>
                {gates.length > 0 && (
                  <Text size="xs" c="red">
                    Failed: {gates.join(", ")}
                  </Text>
                )}
              </Stack>
            );
          })}
        </Stack>
      </ScrollArea>
    </Stack>
  );
}
