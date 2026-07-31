/**
 * packages/plugins/src/catalog/sugarlang/ui/shell/variants-popover.tsx
 *
 * Purpose: Renders the Variants button and popover for editing line-intent fields
 *          and viewing baked band variants for the selected dialogue node.
 *
 * Exports:
 *   - VariantsPopover
 *   - VariantsPopoverProps
 *
 * Relationships:
 *   - Registered as a design.section contribution in contributions.ts for workspaceKind "dialogues".
 *   - Receives the selected node + updateNode callback from the dialogue inspector seam.
 *
 * Implements: Epic 086 Story 086.1 -- line-intent model / Variants popover (intent fields)
 *             Epic 086 Story 086.3 -- band variant fields + generate button
 *
 * Status: active
 */

import { useState, type ReactElement } from "react";
import {
  Badge,
  Button,
  Group,
  Loader,
  Popover,
  Skeleton,
  Stack,
  Text,
  TextInput,
  Textarea
} from "@mantine/core";
import type { DialogueNodeDefinition } from "@sugarmagic/domain";
import type { BakedLineVariant } from "../../runtime/contracts/baked-variant";
import { VARIANT_BANDS } from "../../runtime/contracts/baked-variant";
import type { CEFRBand } from "../../runtime/cefr";

// 090.11: shared with the bake so a baked A1 variant is never invisible here.
const DISPLAY_BANDS = VARIANT_BANDS;

export interface VariantsPopoverProps {
  node: DialogueNodeDefinition;
  onUpdateNode: (node: DialogueNodeDefinition) => void;
  targetLanguage: string;
  bandVariants?: Partial<Record<CEFRBand, BakedLineVariant>>;
  onGenerate?: () => Promise<void>;
  onUpdateVariant?: (band: CEFRBand, text: string) => void;
}

export function VariantsPopover(props: VariantsPopoverProps): ReactElement {
  const { node, onUpdateNode, targetLanguage, bandVariants, onGenerate, onUpdateVariant } = props;
  const [opened, setOpened] = useState(false);
  const [generating, setGenerating] = useState(false);

  const intent = node.intent ?? {};

  function handleFactsBlur(value: string): void {
    const facts = value
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    onUpdateNode({
      ...node,
      intent: {
        ...intent,
        mustConveyFacts: facts.length > 0 ? facts : undefined
      }
    });
  }

  function handleBeatBlur(value: string): void {
    onUpdateNode({
      ...node,
      intent: {
        ...intent,
        beat: value.trim() || undefined
      }
    });
  }

  function handleVoiceNoteBlur(value: string): void {
    onUpdateNode({
      ...node,
      intent: {
        ...intent,
        voiceNote: value.trim() || undefined
      }
    });
  }

  async function handleGenerate(): Promise<void> {
    if (!onGenerate || generating) return;
    setGenerating(true);
    try {
      await onGenerate();
    } finally {
      setGenerating(false);
    }
  }

  return (
    <Popover
      opened={opened}
      onChange={setOpened}
      width={460}
      position="bottom-start"
      withArrow
      shadow="md"
    >
      <Popover.Target>
        <Button
          size="xs"
          variant="subtle"
          onClick={() => setOpened((o) => !o)}
        >
          Variants
        </Button>
      </Popover.Target>

      <Popover.Dropdown style={{ maxHeight: "80vh", overflowY: "auto" }}>
        <Stack gap="md">
          <Stack gap="sm">
            <Text size="xs" fw={600} tt="uppercase" c="dimmed">
              Intent
            </Text>

            <Textarea
              label="Must-Convey Facts"
              size="xs"
              minRows={2}
              autosize
              placeholder="One fact per line"
              defaultValue={(intent.mustConveyFacts ?? []).join("\n")}
              onBlur={(event) => handleFactsBlur(event.currentTarget.value)}
              description="Auto-extracted. Override: one item per line -- either a target-language vocab word (base form) or a short English fact."
            />

            <TextInput
              label="Dramatic Beat"
              size="xs"
              placeholder="e.g. reluctant reveal"
              defaultValue={intent.beat ?? ""}
              onBlur={(event) => handleBeatBlur(event.currentTarget.value)}
            />

            <TextInput
              label="Voice Note"
              size="xs"
              placeholder="e.g. warm but guarded"
              defaultValue={intent.voiceNote ?? ""}
              onBlur={(event) =>
                handleVoiceNoteBlur(event.currentTarget.value)
              }
            />
          </Stack>

          <Stack gap="sm">
            <Group justify="space-between" align="center">
              <Group gap="xs" align="center">
                <Text size="xs" fw={600} tt="uppercase" c="dimmed">
                  Band Variants
                </Text>
                <Text size="xs" c="dimmed">{targetLanguage || "en"}</Text>
              </Group>
              <Button
                size="xs"
                variant="light"
                onClick={() => void handleGenerate()}
                disabled={generating || !onGenerate}
                leftSection={generating ? <Loader size={10} /> : undefined}
              >
                {generating ? "Generating..." : "Generate"}
              </Button>
            </Group>
            {DISPLAY_BANDS.map((band) => {
              const variant = bandVariants?.[band];
              return (
                <Stack key={band} gap={4}>
                  <Group gap="xs" align="center">
                    <Text size="xs" fw={500}>
                      {band} Variant
                    </Text>
                    {variant?.reviewFlag && (
                      <Badge size="xs" color="red">
                        Flagged
                      </Badge>
                    )}
                  </Group>
                  {generating ? (
                    <Skeleton height={52} radius="sm" />
                  ) : (
                    <Textarea
                      size="xs"
                      minRows={2}
                      autosize
                      placeholder={`Generated ${band} variant will appear here`}
                      defaultValue={variant?.text ?? ""}
                      onBlur={(event) => {
                        const value = event.currentTarget.value.trim();
                        if (value && onUpdateVariant) {
                          onUpdateVariant(band, value);
                        }
                      }}
                    />
                  )}
                </Stack>
              );
            })}
          </Stack>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}
