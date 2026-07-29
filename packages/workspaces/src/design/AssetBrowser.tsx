/**
 * AssetBrowser
 *
 * Modal for picking an ALREADY-IMPORTED asset from the content library, with
 * an import-new escape hatch. Emits an asset definition id.
 *
 * Why this exists: inspector model fields were import-only (`InlineAssetField`
 * opens the OS file dialog on click), so binding an item to a GLB already in
 * the library meant re-importing it from disk -- which copies the bytes into
 * the project again and mints a second definition, since ids are derived from
 * the filename stem. Browsing was simply not offered anywhere except the
 * Layout "Add Asset" modal.
 *
 * NOT to be confused with `LibraryPopover` (Game > Libraries > Assets). That is
 * a MANAGEMENT surface -- rename, remove, set collider -- and has no selection
 * output. This one only answers "which asset?" and closes.
 *
 * Shape follows `AnimationLibraryBrowser` deliberately: same modal chrome,
 * search box, click-to-highlight list, Cancel/Assign footer, and the same
 * clear-on-close rule (a stale selection carried into the next open is how you
 * silently assign the wrong thing).
 */

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
import type { AssetDefinition, AssetKind } from "@sugarmagic/domain";

export interface AssetBrowserProps {
  opened: boolean;
  assetDefinitions: AssetDefinition[];
  /** Restrict the list to one kind. Omit to show every asset. */
  assetKind?: AssetKind;
  title?: string;
  onSelect: (definitionId: string) => void;
  onClose: () => void;
  /**
   * Import a new asset from disk. When provided, the modal grows an "Import
   * new..." action; resolving with an id assigns it immediately, so importing
   * and picking stay one gesture. Resolve null when the author cancels the OS
   * dialog.
   */
  onImportNew?: () => Promise<string | null>;
}

const KIND_GLYPH: Record<AssetKind, string> = {
  model: "📦",
  foliage: "🌳"
};

export function AssetBrowser({
  opened,
  assetDefinitions,
  assetKind,
  title,
  onSelect,
  onClose,
  onImportNew
}: AssetBrowserProps) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  const handleClose = () => {
    setQuery("");
    setSelectedId(null);
    onClose();
  };

  const trimmed = query.trim().toLowerCase();
  const items = assetDefinitions.filter((definition) => {
    if (assetKind && definition.assetKind !== assetKind) return false;
    if (!trimmed) return true;
    return definition.displayName.toLowerCase().includes(trimmed);
  });

  // Fall back to the first row so Assign is never disabled on a non-empty list
  // just because the author has not clicked yet.
  const selected =
    items.find((definition) => definition.definitionId === selectedId) ??
    items[0] ??
    null;

  const runImport = async () => {
    if (!onImportNew) return;
    setImporting(true);
    try {
      const definitionId = await onImportNew();
      if (definitionId) {
        onSelect(definitionId);
        handleClose();
      }
    } finally {
      setImporting(false);
    }
  };

  return (
    <Modal
      opened={opened}
      onClose={handleClose}
      title={title ?? "Choose Asset"}
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
          placeholder="Search assets..."
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          autoFocus
        />
      </Box>
      <ScrollArea style={{ flex: 1, minHeight: 0 }}>
        <Stack gap={2} p="xs">
          {items.map((definition) => {
            const isSelected =
              definition.definitionId === (selected?.definitionId ?? null);
            return (
              <Box
                key={definition.definitionId}
                onClick={() => setSelectedId(definition.definitionId)}
                onDoubleClick={() => {
                  onSelect(definition.definitionId);
                  handleClose();
                }}
                style={{
                  cursor: "pointer",
                  padding: "6px 10px",
                  borderRadius: 6,
                  background: isSelected ? "var(--sm-active-bg)" : "transparent",
                  border: `1px solid ${isSelected ? "var(--sm-accent-blue)" : "transparent"}`
                }}
              >
                <Text size="sm" fw={isSelected ? 600 : 500}>
                  {KIND_GLYPH[definition.assetKind]} {definition.displayName}
                </Text>
                <Text size="xs" c="var(--sm-color-overlay0)">
                  {definition.source.fileName}
                </Text>
              </Box>
            );
          })}
          {items.length === 0 ? (
            <Text size="xs" c="var(--sm-color-overlay0)" ta="center" mt="md">
              {trimmed
                ? `No assets match "${query}".`
                : "No assets imported yet."}
            </Text>
          ) : null}
        </Stack>
      </ScrollArea>
      <Group
        justify="space-between"
        p="xs"
        style={{ borderTop: "1px solid var(--sm-panel-border)", flex: "0 0 auto" }}
      >
        {onImportNew ? (
          <Button size="xs" variant="subtle" onClick={runImport} loading={importing}>
            Import new...
          </Button>
        ) : (
          <span />
        )}
        <Group gap="xs">
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
      </Group>
    </Modal>
  );
}
