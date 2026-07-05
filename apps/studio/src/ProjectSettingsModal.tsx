/**
 * apps/studio/src/ProjectSettingsModal.tsx
 *
 * Purpose: the project Settings surface — a sidebar modal for
 * project-scope configuration that would otherwise accrete as
 * one-off menu items and workspace inspector sections. Opened
 * from the project menu ("Settings...").
 *
 * Sections:
 *   - Credits (Plan 059 §059.2) — the end-of-Scene credits roll.
 *     Drafted locally, committed on Save (rarely-touched
 *     artifact).
 *   - Music (Plan 059 §059.1) — project music slots (menu /
 *     in-game / credits theme), moved here from the Build > Audio
 *     inspector. Selects commit immediately.
 *
 * Adding a section = one sidebar entry + one component below.
 *
 * Status: active
 */

import { useState } from "react";
import {
  ActionIcon,
  Button,
  Group,
  Modal,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
  UnstyledButton
} from "@mantine/core";
import type {
  CreditsDefinition,
  CreditsSection,
  MusicBindings
} from "@sugarmagic/domain";

export interface ProjectSettingsModalProps {
  opened: boolean;
  onClose: () => void;
  credits: CreditsDefinition;
  onSaveCredits: (credits: CreditsDefinition) => void;
  musicBindings: MusicBindings;
  onUpdateMusicBindings: (patch: Partial<MusicBindings>) => void;
  soundCueDefinitions: { definitionId: string; displayName: string }[];
}

type SettingsSectionKey = "credits" | "music";

const SECTIONS: Array<{ key: SettingsSectionKey; label: string }> = [
  { key: "credits", label: "Credits" },
  { key: "music", label: "Music" }
];

// --- Credits section ---------------------------------------------

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

function CreditsSettings(props: {
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

// --- Music section -----------------------------------------------

function MusicSettings(props: {
  musicBindings: MusicBindings;
  onUpdateMusicBindings: (patch: Partial<MusicBindings>) => void;
  soundCueDefinitions: { definitionId: string; displayName: string }[];
}) {
  const cueOptions = props.soundCueDefinitions.map((cue) => ({
    value: cue.definitionId,
    label: cue.displayName
  }));
  return (
    <Stack gap="sm">
      <Select
        size="xs"
        label="Menu music"
        placeholder="(none)"
        clearable
        data={cueOptions}
        value={props.musicBindings.menuMusicId}
        onChange={(value) =>
          props.onUpdateMusicBindings({ menuMusicId: value ?? null })
        }
      />
      <Select
        size="xs"
        label="In-game music (optional)"
        placeholder="(silence — recommended)"
        clearable
        data={cueOptions}
        value={props.musicBindings.defaultBackgroundMusicId}
        onChange={(value) =>
          props.onUpdateMusicBindings({
            defaultBackgroundMusicId: value ?? null
          })
        }
      />
      <Select
        size="xs"
        label="Credits theme"
        placeholder="(none)"
        clearable
        data={cueOptions}
        value={props.musicBindings.creditsThemeMusicId}
        onChange={(value) =>
          props.onUpdateMusicBindings({ creditsThemeMusicId: value ?? null })
        }
      />
    </Stack>
  );
}

// --- Modal shell ---------------------------------------------------

export function ProjectSettingsModal(props: ProjectSettingsModalProps) {
  const [activeSection, setActiveSection] =
    useState<SettingsSectionKey>("credits");

  return (
    <Modal
      opened={props.opened}
      onClose={props.onClose}
      title="Settings"
      centered
      size="56rem"
      styles={{
        header: {
          background: "var(--sm-color-surface1)",
          borderBottom: "1px solid var(--sm-panel-border)"
        },
        title: { color: "var(--sm-color-text)", fontWeight: 600 },
        body: { background: "var(--sm-color-surface1)", padding: 0 },
        content: { background: "var(--sm-color-surface1)" },
        close: {
          color: "var(--sm-color-overlay1)",
          "&:hover": { background: "var(--sm-active-bg)" }
        }
      }}
    >
      <Group align="stretch" gap={0} wrap="nowrap" style={{ minHeight: 380 }}>
        <Stack
          gap={2}
          p="sm"
          style={{
            width: 160,
            flexShrink: 0,
            borderRight: "1px solid var(--sm-panel-border)"
          }}
        >
          {SECTIONS.map((section) => (
            <UnstyledButton
              key={section.key}
              onClick={() => setActiveSection(section.key)}
              style={{
                padding: "8px 12px",
                borderRadius: 6,
                fontSize: "var(--sm-font-size-sm)",
                color: "var(--sm-color-text)",
                background:
                  activeSection === section.key
                    ? "var(--sm-active-bg)"
                    : "transparent"
              }}
            >
              {section.label}
            </UnstyledButton>
          ))}
        </Stack>
        <Stack gap="md" p="lg" style={{ flex: 1 }}>
          {activeSection === "credits" ? (
            <CreditsSettings
              credits={props.credits}
              onSave={props.onSaveCredits}
            />
          ) : (
            <MusicSettings
              musicBindings={props.musicBindings}
              onUpdateMusicBindings={props.onUpdateMusicBindings}
              soundCueDefinitions={props.soundCueDefinitions}
            />
          )}
        </Stack>
      </Group>
    </Modal>
  );
}
