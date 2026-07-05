/**
 * packages/workspaces/src/design/game-ui/CreditsEditor.tsx
 *
 * Purpose: Plan 059 §059.2 — the credits editor, a Game UI
 * workspace citizen (credits are a player-facing screen, the
 * same species as menus; this workspace is where their design
 * grows — styling / layout / preview land here later).
 *
 * Edits commit to the session ON CHANGE like every other Studio
 * field; the project save persists them. The session write
 * preserves text verbatim (see `updateCreditsInSession`), so the
 * textarea round-trips exactly — blank lines and trailing
 * whitespace clean up at load/publish, not under the cursor.
 *
 * Implements: Plan 059 §059.2
 *
 * Status: active
 */

import {
  ActionIcon,
  Button,
  Group,
  Stack,
  Text,
  Textarea,
  TextInput
} from "@mantine/core";
import type { CreditsDefinition } from "@sugarmagic/domain";

export function CreditsEditor(props: {
  credits: CreditsDefinition;
  onChange: (credits: CreditsDefinition) => void;
}) {
  const { credits, onChange } = props;
  const sections = credits.sections;

  const updateSection = (
    index: number,
    patch: Partial<CreditsDefinition["sections"][number]>
  ) => {
    onChange({
      sections: sections.map((section, candidate) =>
        candidate === index ? { ...section, ...patch } : section
      )
    });
  };

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= sections.length) return;
    const next = [...sections];
    [next[index], next[target]] = [next[target]!, next[index]!];
    onChange({ sections: next });
  };

  return (
    <Stack gap="md">
      {sections.length === 0 && (
        <Text size="sm" c="var(--sm-color-overlay0)">
          No credits yet. An empty credits list means the game skips the
          credits roll entirely.
        </Text>
      )}
      {sections.map((section, index) => (
        <Stack
          key={index}
          gap="xs"
          p="sm"
          style={{
            border: "1px solid var(--sm-panel-border)",
            borderRadius: 8
          }}
        >
          <Group gap="xs" wrap="nowrap">
            <TextInput
              size="xs"
              style={{ flex: 1 }}
              placeholder="Section heading (e.g. WRITTEN BY)"
              value={section.heading}
              onChange={(event) =>
                updateSection(index, { heading: event.currentTarget.value })
              }
            />
            <ActionIcon
              variant="subtle"
              size="sm"
              disabled={index === 0}
              onClick={() => move(index, -1)}
              title="Move up"
            >
              ↑
            </ActionIcon>
            <ActionIcon
              variant="subtle"
              size="sm"
              disabled={index === sections.length - 1}
              onClick={() => move(index, 1)}
              title="Move down"
            >
              ↓
            </ActionIcon>
            <ActionIcon
              variant="subtle"
              size="sm"
              color="red"
              onClick={() =>
                onChange({
                  sections: sections.filter(
                    (_, candidate) => candidate !== index
                  )
                })
              }
              title="Remove section"
            >
              🗑
            </ActionIcon>
          </Group>
          <Textarea
            size="xs"
            autosize
            minRows={2}
            placeholder={"One credit per line\nNikki Leaps"}
            value={section.lines.join("\n")}
            onChange={(event) =>
              updateSection(index, {
                lines: event.currentTarget.value.split("\n")
              })
            }
          />
        </Stack>
      ))}
      <Group justify="flex-start">
        <Button
          size="compact-sm"
          variant="default"
          onClick={() =>
            onChange({ sections: [...sections, { heading: "", lines: [] }] })
          }
        >
          + Add Section
        </Button>
      </Group>
    </Stack>
  );
}
