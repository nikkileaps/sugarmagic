/**
 * apps/studio/src/CreditsModal.tsx
 *
 * Purpose: Plan 059 §059.2 — the project credits editor, behind
 * the project menu. Ordered sections (heading + one line per
 * text row); empty editor = the game has no credits and the
 * end-of-Scene exit sequence skips the roll.
 *
 * Edits are drafted locally and committed on Save — a credits
 * roll is a rarely-touched artifact and per-keystroke session
 * churn buys nothing here.
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
  Modal,
  Stack,
  Text,
  Textarea,
  TextInput
} from "@mantine/core";
import type { CreditsDefinition, CreditsSection } from "@sugarmagic/domain";

export interface CreditsModalProps {
  opened: boolean;
  onClose: () => void;
  credits: CreditsDefinition;
  onSave: (credits: CreditsDefinition) => void;
}

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

export function CreditsModal(props: CreditsModalProps) {
  const { opened, onClose, credits, onSave } = props;
  const [drafts, setDrafts] = useState<SectionDraft[] | null>(null);
  // Drafts initialize from the project on first render after
  // open; `null` means "not yet drafted".
  const working = drafts ?? toDrafts(credits);

  const close = () => {
    setDrafts(null);
    onClose();
  };

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
    <Modal
      opened={opened}
      onClose={close}
      title="Credits"
      centered
      size="lg"
      styles={{
        header: {
          background: "var(--sm-color-surface1)",
          borderBottom: "1px solid var(--sm-panel-border)"
        },
        title: { color: "var(--sm-color-text)", fontWeight: 600 },
        body: { background: "var(--sm-color-surface1)", padding: "20px" },
        content: { background: "var(--sm-color-surface1)" },
        close: {
          color: "var(--sm-color-overlay1)",
          "&:hover": { background: "var(--sm-active-bg)" }
        }
      }}
    >
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
          <Group gap="xs">
            <Button size="compact-sm" variant="default" onClick={close}>
              Cancel
            </Button>
            <Button
              size="compact-sm"
              onClick={() => {
                onSave(fromDrafts(working));
                close();
              }}
            >
              Save Credits
            </Button>
          </Group>
        </Group>
      </Stack>
    </Modal>
  );
}
