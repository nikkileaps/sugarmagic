/**
 * packages/workspaces/src/design/game-ui/CreditsEditor.tsx
 *
 * Purpose: Plan 059 §059.2 — the credits editor, a Game UI
 * workspace citizen (credits are a player-facing screen, the
 * same species as menus; this workspace is where their design
 * grows — styling / layout / preview land here later).
 *
 * Ordered sections (heading + one credit line per text row);
 * drafts locally, commits on Save. Empty = the game has no
 * credits and the end-of-Scene exit sequence skips the roll.
 *
 * Implements: Plan 059 §059.2
 *
 * Status: active
 */

import { useState } from "react";
import {
  ActionIcon,
  Button,
  Group,
  Stack,
  Text,
  Textarea,
  TextInput
} from "@mantine/core";
import type { CreditsDefinition, CreditsSection } from "@sugarmagic/domain";

interface SectionDraft {
  heading: string;
  /** One credit line per text row. */
  linesText: string;
}

function toDrafts(credits: CreditsDefinition): SectionDraft[] {
  return credits.sections.map((section) => ({
    heading: section.heading,
    linesText: section.lines.join("\n")
  }));
}

function fromDrafts(drafts: SectionDraft[]): CreditsDefinition {
  const sections: CreditsSection[] = drafts.map((draft) => ({
    heading: draft.heading.trim(),
    lines: draft.linesText
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
  }));
  return { sections };
}

export function CreditsEditor(props: {
  credits: CreditsDefinition;
  onSave: (credits: CreditsDefinition) => void;
}) {
  const [drafts, setDrafts] = useState<SectionDraft[] | null>(null);
  const working = drafts ?? toDrafts(props.credits);

  const update = (index: number, patch: Partial<SectionDraft>) => {
    setDrafts(
      working.map((draft, candidate) =>
        candidate === index ? { ...draft, ...patch } : draft
      )
    );
  };

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= working.length) return;
    const next = [...working];
    [next[index], next[target]] = [next[target]!, next[index]!];
    setDrafts(next);
  };

  return (
    <Stack gap="md">
      {working.length === 0 && (
        <Text size="sm" c="var(--sm-color-overlay0)">
          No credits yet. An empty credits list means the game skips the
          credits roll entirely.
        </Text>
      )}
      {working.map((draft, index) => (
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
              value={draft.heading}
              onChange={(event) =>
                update(index, { heading: event.currentTarget.value })
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
              disabled={index === working.length - 1}
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
                setDrafts(working.filter((_, candidate) => candidate !== index))
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
            value={draft.linesText}
            onChange={(event) =>
              update(index, { linesText: event.currentTarget.value })
            }
          />
        </Stack>
      ))}
      <Group justify="space-between">
        <Button
          size="compact-sm"
          variant="default"
          onClick={() =>
            setDrafts([...working, { heading: "", linesText: "" }])
          }
        >
          + Add Section
        </Button>
        <Button
          size="compact-sm"
          disabled={drafts === null}
          onClick={() => {
            props.onSave(fromDrafts(working));
            setDrafts(null);
          }}
        >
          Save Credits
        </Button>
      </Group>
    </Stack>
  );
}
