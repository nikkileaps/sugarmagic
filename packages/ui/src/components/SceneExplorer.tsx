/**
 * Scene Explorer: hierarchical structure-and-selection surface for Layout.
 *
 * Informed by Sugarbuilder's SceneExplorer. Renders a real tree with
 * folders and entities. Data is derived from canonical region truth.
 */

import { useState, useCallback } from "react";
import { Stack, Group, Text, UnstyledButton, ActionIcon } from "@mantine/core";

// --- Data model ---

export interface SceneExplorerEntity {
  type: "entity";
  instanceId: string;
  displayName: string;
  assetKind: string;
  visible: boolean;
}

export interface SceneExplorerFolder {
  type: "folder";
  folderId: string;
  displayName: string;
  children: SceneExplorerNode[];
}

export type SceneExplorerNode = SceneExplorerEntity | SceneExplorerFolder;

export interface SceneExplorerProps {
  roots: SceneExplorerNode[];
  selectedIds: string[];
  onSelect: (instanceId: string) => void;
  onToggleVisibility?: (instanceId: string) => void;
}

// --- Icons ---

const KIND_ICONS: Record<string, string> = {
  "builtin:cube": "📦",
  asset: "📦",
  light: "💡",
  decal: "🎨",
  marker: "📍",
  default: "📦"
};

function getKindIcon(assetKind: string): string {
  return KIND_ICONS[assetKind] ?? KIND_ICONS.default;
}

// --- Tree node components ---

const INDENT_PX = 16;

function EntityRow({
  node,
  depth,
  isSelected,
  onSelect,
  onToggleVisibility
}: {
  node: SceneExplorerEntity;
  depth: number;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onToggleVisibility?: (id: string) => void;
}) {
  return (
    <UnstyledButton
      onClick={() => onSelect(node.instanceId)}
      w="100%"
      styles={{
        root: {
          display: "flex",
          alignItems: "center",
          gap: "var(--sm-space-sm)",
          padding: `4px var(--sm-space-sm)`,
          paddingLeft: depth * INDENT_PX + 8,
          fontSize: "var(--sm-font-size-sm)",
          color: isSelected ? "var(--sm-accent-blue)" : "var(--sm-color-text)",
          background: isSelected ? "var(--sm-active-bg)" : "transparent",
          transition: "var(--sm-transition-fast)",
          "&:hover": {
            background: isSelected
              ? "var(--sm-active-bg-hover)"
              : "var(--sm-hover-bg)"
          }
        }
      }}
    >
      <Group gap={6} wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
        <Text component="span" size="xs">
          {getKindIcon(node.assetKind)}
        </Text>
        <Text size="xs" truncate fw={isSelected ? 600 : 400}>
          {node.displayName}
        </Text>
      </Group>
      {onToggleVisibility && (
        <ActionIcon
          variant="subtle"
          size="xs"
          onClick={(e) => {
            e.stopPropagation();
            onToggleVisibility(node.instanceId);
          }}
          styles={{
            root: {
              color: node.visible
                ? "var(--sm-color-overlay2)"
                : "var(--sm-color-overlay0)",
              "&:hover": { background: "var(--sm-hover-bg)" }
            }
          }}
        >
          {node.visible ? "👁" : "👁‍🗨"}
        </ActionIcon>
      )}
    </UnstyledButton>
  );
}

function FolderRow({
  node,
  depth,
  isExpanded,
  onToggle,
  selectedIds,
  onSelect,
  onToggleVisibility
}: {
  node: SceneExplorerFolder;
  depth: number;
  isExpanded: boolean;
  onToggle: () => void;
  selectedIds: string[];
  onSelect: (id: string) => void;
  onToggleVisibility?: (id: string) => void;
}) {
  return (
    <>
      <UnstyledButton
        onClick={onToggle}
        w="100%"
        styles={{
          root: {
            display: "flex",
            alignItems: "center",
            gap: "var(--sm-space-xs)",
            padding: `4px var(--sm-space-sm)`,
            paddingLeft: depth * INDENT_PX + 8,
            fontSize: "var(--sm-font-size-sm)",
            color: "var(--sm-color-subtext)",
            transition: "var(--sm-transition-fast)",
            "&:hover": { background: "var(--sm-hover-bg)" }
          }
        }}
      >
        <Text
          component="span"
          size="xs"
          c="var(--sm-color-overlay0)"
          style={{
            transition: "var(--sm-transition-fast)",
            transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)",
            display: "inline-block",
            width: 12
          }}
        >
          ▸
        </Text>
        <Text component="span" size="xs">
          📁
        </Text>
        <Text size="xs" fw={500}>
          {node.displayName}
        </Text>
        <Text size="xs" c="var(--sm-color-overlay0)" ml={2}>
          ({node.children.length})
        </Text>
      </UnstyledButton>
      {isExpanded &&
        node.children.map((child) => (
          <TreeNode
            key={child.type === "entity" ? child.instanceId : child.folderId}
            node={child}
            depth={depth + 1}
            selectedIds={selectedIds}
            onSelect={onSelect}
            onToggleVisibility={onToggleVisibility}
          />
        ))}
    </>
  );
}

function TreeNode({
  node,
  depth,
  selectedIds,
  onSelect,
  onToggleVisibility
}: {
  node: SceneExplorerNode;
  depth: number;
  selectedIds: string[];
  onSelect: (id: string) => void;
  onToggleVisibility?: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);

  if (node.type === "entity") {
    return (
      <EntityRow
        node={node}
        depth={depth}
        isSelected={selectedIds.includes(node.instanceId)}
        onSelect={onSelect}
        onToggleVisibility={onToggleVisibility}
      />
    );
  }

  return (
    <FolderRow
      node={node}
      depth={depth}
      isExpanded={expanded}
      onToggle={() => setExpanded((v) => !v)}
      selectedIds={selectedIds}
      onSelect={onSelect}
      onToggleVisibility={onToggleVisibility}
    />
  );
}

// --- Root component ---

export function SceneExplorer({
  roots,
  selectedIds,
  onSelect,
  onToggleVisibility
}: SceneExplorerProps) {
  const entityCount = countEntities(roots);

  return (
    <Stack gap={0}>
      {roots.map((node) => (
        <TreeNode
          key={node.type === "entity" ? node.instanceId : node.folderId}
          node={node}
          depth={0}
          selectedIds={selectedIds}
          onSelect={onSelect}
          onToggleVisibility={onToggleVisibility}
        />
      ))}
      {entityCount === 0 && (
        <Text size="xs" c="var(--sm-color-overlay0)" p="md" ta="center">
          No placed objects in this region.
        </Text>
      )}
    </Stack>
  );
}

function countEntities(nodes: SceneExplorerNode[]): number {
  let count = 0;
  for (const node of nodes) {
    if (node.type === "entity") count++;
    else count += countEntities(node.children);
  }
  return count;
}
