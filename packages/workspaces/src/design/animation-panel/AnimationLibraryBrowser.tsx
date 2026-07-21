import { useState } from "react";
import {
  Box,
  Button,
  Group,
  Modal,
  ScrollArea,
  Stack,
  Text,
  TextInput
} from "@mantine/core";
import type { AnimationLibraryDefinition } from "@sugarmagic/domain";

export interface AnimationLibraryBrowserProps {
  opened: boolean;
  animationLibraryDefinitions: AnimationLibraryDefinition[];
  onSelect: (definitionId: string) => void;
  onClose: () => void;
}

export function AnimationLibraryBrowser({
  opened,
  animationLibraryDefinitions,
  onSelect,
  onClose
}: AnimationLibraryBrowserProps) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // The modal stays mounted with `opened` toggled, so stale search
  // text + selection would carry over to the next open (and invite
  // assigning the wrong clip). Clear on every close path.
  const handleClose = () => {
    setQuery("");
    setSelectedId(null);
    onClose();
  };

  const items = animationLibraryDefinitions.filter((d) =>
    query.trim()
      ? d.displayName.toLowerCase().includes(query.trim().toLowerCase())
      : true
  );

  const selected = items.find((d) => d.definitionId === selectedId) ?? items[0] ?? null;

  return (
    <Modal
      opened={opened}
      onClose={handleClose}
      title="Choose from Animation Library"
      size="md"
      styles={{
        content: {
          height: "min(500px, 80vh)",
          display: "flex",
          flexDirection: "column"
        },
        body: {
          padding: 0,
          flex: 1,
          minHeight: 0,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column"
        }
      }}
    >
      <Box
        p="xs"
        style={{ borderBottom: "1px solid var(--sm-panel-border)", flex: "0 0 auto" }}
      >
        <TextInput
          size="xs"
          placeholder="Search animations..."
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          autoFocus
        />
      </Box>
      <ScrollArea style={{ flex: 1, minHeight: 0 }}>
        <Stack gap={2} p="xs">
          {items.map((item) => {
            const isSelected = item.definitionId === (selected?.definitionId ?? null);
            return (
              <Box
                key={item.definitionId}
                onClick={() => setSelectedId(item.definitionId)}
                style={{
                  cursor: "pointer",
                  padding: "6px 10px",
                  borderRadius: 6,
                  background: isSelected ? "var(--sm-active-bg)" : "transparent",
                  border: `1px solid ${isSelected ? "var(--sm-accent-blue)" : "transparent"}`
                }}
              >
                <Text size="sm" fw={isSelected ? 600 : 500}>
                  {item.displayName}
                </Text>
                <Text size="xs" c="var(--sm-color-overlay0)">
                  {item.origin === "generated" ? "generated" : "imported"}{" "}
                  {item.clipNames.length > 0 ? `· ${item.clipNames[0]}` : ""}
                </Text>
              </Box>
            );
          })}
          {items.length === 0 ? (
            <Text size="xs" c="var(--sm-color-overlay0)" ta="center" mt="md">
              {query.trim()
                ? `No animations match "${query}".`
                : "No animations in the library yet. Import a GLB via Libraries > Animations."}
            </Text>
          ) : null}
        </Stack>
      </ScrollArea>
      <Group
        justify="flex-end"
        p="xs"
        style={{ borderTop: "1px solid var(--sm-panel-border)", flex: "0 0 auto" }}
      >
        <Button size="xs" variant="subtle" onClick={handleClose}>
          Cancel
        </Button>
        <Button
          size="xs"
          disabled={!selected}
          onClick={() => {
            if (selected) {
              onSelect(selected.definitionId);
              handleClose();
            }
          }}
        >
          Assign
        </Button>
      </Group>
    </Modal>
  );
}
