/**
 * packages/plugins/src/catalog/sugarlang/ui/shell/variants-popover.tsx
 *
 * Purpose: Renders the Variants button and popover for editing line-intent fields
 *          on the selected dialogue node.
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
 *
 * Status: active
 */

import { useState, type ReactElement } from "react";
import {
  Button,
  Group,
  Popover,
  Stack,
  Text,
  TextInput,
  Textarea
} from "@mantine/core";
import type { DialogueNodeDefinition } from "@sugarmagic/domain";

export interface VariantsPopoverProps {
  node: DialogueNodeDefinition;
  onUpdateNode: (node: DialogueNodeDefinition) => void;
  targetLanguage: string;
}

export function VariantsPopover(props: VariantsPopoverProps): ReactElement {
  const { node, onUpdateNode, targetLanguage } = props;
  const [opened, setOpened] = useState(false);

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

  return (
    <Popover
      opened={opened}
      onChange={setOpened}
      width={420}
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

      <Popover.Dropdown>
        <Group align="flex-start" gap="md" wrap="nowrap">
          <Stack gap="xs" style={{ minWidth: 60 }}>
            <Text size="xs" fw={600} tt="uppercase" c="dimmed">
              Lang
            </Text>
            <Text size="xs">{targetLanguage || "en"}</Text>
          </Stack>

          <Stack gap="sm" style={{ flex: 1 }}>
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
              description="Discrete facts this line must communicate"
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
        </Group>
      </Popover.Dropdown>
    </Popover>
  );
}
