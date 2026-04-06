/**
 * Scene Explorer: hierarchical structure-and-selection surface for Layout.
 *
 * Informed by Sugarbuilder's SceneExplorer. Renders a real tree with
 * folders and entities. Data is derived from canonical region truth.
 */

import { useState, type MouseEvent } from "react";
import { Box, Stack, Group, Text, ActionIcon, Menu } from "@mantine/core";

// --- Data model ---

export interface SceneExplorerEntity {
  type: "entity";
  instanceId: string;
  displayName: string;
  entityKind: "asset" | "player" | "npc" | "item";
  assetKind: string;
  assetDefinitionId: string | null;
  visible: boolean;
}

export interface SceneExplorerFolder {
  type: "folder";
  folderId: string;
  displayName: string;
  children: SceneExplorerNode[];
  isRoot?: boolean;
}

export type SceneExplorerNode = SceneExplorerEntity | SceneExplorerFolder;

export interface SceneExplorerProps {
  roots: SceneExplorerNode[];
  selectedIds: string[];
  selectedFolderId?: string | null;
  onSelect: (instanceId: string) => void;
  onSelectFolder?: (folderId: string) => void;
  onToggleVisibility?: (instanceId: string) => void;
  onRenameFolder?: (folderId: string, displayName: string) => void;
  onCreateFolder?: (parentFolderId: string | null) => void;
  onDeleteFolder?: (folderId: string) => void;
  onDuplicateEntity?: (instanceId: string) => void;
  onEditEntity?: (instanceId: string) => void;
  onDeleteEntity?: (instanceId: string) => void;
}

type ContextMenuState =
  | {
      kind: "entity";
      x: number;
      y: number;
      instanceId: string;
    }
  | {
      kind: "folder";
      x: number;
      y: number;
      folderId: string;
      isRoot: boolean;
    };

// --- Icons ---

const KIND_ICONS: Record<string, string> = {
  "builtin:cube": "📦",
  asset: "📦",
  player: "🧙",
  npc: "👤",
  item: "📦",
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
  onToggleVisibility,
  onOpenContextMenu
}: {
  node: SceneExplorerEntity;
  depth: number;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onToggleVisibility?: (id: string) => void;
  onOpenContextMenu: (event: MouseEvent, state: ContextMenuState) => void;
}) {
  return (
    <Box
      onClick={() => onSelect(node.instanceId)}
      onContextMenu={(event) => {
        event.preventDefault();
        onSelect(node.instanceId);
        onOpenContextMenu(event, {
          kind: "entity",
          x: event.clientX,
          y: event.clientY,
          instanceId: node.instanceId
        });
      }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--sm-space-sm)",
        padding: `4px var(--sm-space-sm)`,
        paddingLeft: depth * INDENT_PX + 8,
        fontSize: "var(--sm-font-size-sm)",
        color: isSelected ? "var(--sm-accent-blue)" : "var(--sm-color-text)",
        background: isSelected ? "var(--sm-active-bg)" : "transparent",
        transition: "var(--sm-transition-fast)",
        cursor: "pointer"
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
    </Box>
  );
}

function FolderRow({
  node,
  depth,
  isExpanded,
  onToggle,
  isSelected,
  selectedIds,
  selectedFolderId,
  onSelect,
  onSelectFolder,
  onToggleVisibility,
  onOpenContextMenu
}: {
  node: SceneExplorerFolder;
  depth: number;
  isExpanded: boolean;
  onToggle: () => void;
  isSelected: boolean;
  selectedIds: string[];
  selectedFolderId?: string | null;
  onSelect: (id: string) => void;
  onSelectFolder?: (folderId: string) => void;
  onToggleVisibility?: (id: string) => void;
  onOpenContextMenu: (event: MouseEvent, state: ContextMenuState) => void;
}) {
  const folderIcon = node.isRoot ? "🗺️" : "📁";

  return (
    <>
      <Box
        onClick={() => onSelectFolder?.(node.folderId)}
        onContextMenu={(event) => {
          event.preventDefault();
          onSelectFolder?.(node.folderId);
          onOpenContextMenu(event, {
            kind: "folder",
            x: event.clientX,
            y: event.clientY,
            folderId: node.folderId,
            isRoot: Boolean(node.isRoot)
          });
        }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--sm-space-xs)",
          padding: `4px var(--sm-space-sm)`,
          paddingLeft: depth * INDENT_PX + 8,
          fontSize: "var(--sm-font-size-sm)",
          color: isSelected
            ? "var(--sm-accent-blue)"
            : "var(--sm-color-subtext)",
          background: isSelected ? "var(--sm-active-bg)" : "transparent",
          transition: "var(--sm-transition-fast)",
          cursor: "pointer"
        }}
      >
        <ActionIcon
          onClick={(event) => {
            event.stopPropagation();
            onToggle();
          }}
          variant="subtle"
          size="xs"
          styles={{
            root: {
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--sm-color-overlay0)"
            }
          }}
        >
          <Text
            component="span"
            size="xs"
            style={{
              transition: "var(--sm-transition-fast)",
              transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)",
              display: "inline-block"
            }}
          >
            ▸
          </Text>
        </ActionIcon>
        <Text component="span" size="xs">
          {folderIcon}
        </Text>
        <Text size="xs" fw={500}>
          {node.displayName}
        </Text>
        <Text size="xs" c="var(--sm-color-overlay0)" ml={2}>
          ({node.children.length})
        </Text>
      </Box>
      {isExpanded &&
        node.children.map((child) => (
          <TreeNode
            key={child.type === "entity" ? child.instanceId : child.folderId}
            node={child}
            depth={depth + 1}
            selectedIds={selectedIds}
            selectedFolderId={selectedFolderId}
            onSelect={onSelect}
            onSelectFolder={onSelectFolder}
            onToggleVisibility={onToggleVisibility}
            onOpenContextMenu={onOpenContextMenu}
          />
        ))}
    </>
  );
}

function TreeNode({
  node,
  depth,
  selectedIds,
  selectedFolderId,
  onSelect,
  onSelectFolder,
  onToggleVisibility,
  onOpenContextMenu
}: {
  node: SceneExplorerNode;
  depth: number;
  selectedIds: string[];
  selectedFolderId?: string | null;
  onSelect: (id: string) => void;
  onSelectFolder?: (folderId: string) => void;
  onToggleVisibility?: (id: string) => void;
  onOpenContextMenu: (event: MouseEvent, state: ContextMenuState) => void;
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
        onOpenContextMenu={onOpenContextMenu}
      />
    );
  }

  return (
    <FolderRow
      node={node}
      depth={depth}
      isExpanded={expanded}
      onToggle={() => setExpanded((v) => !v)}
      isSelected={selectedFolderId === node.folderId}
      selectedIds={selectedIds}
      selectedFolderId={selectedFolderId}
      onSelect={onSelect}
      onSelectFolder={onSelectFolder}
      onToggleVisibility={onToggleVisibility}
      onOpenContextMenu={onOpenContextMenu}
    />
  );
}

// --- Root component ---

export function SceneExplorer({
  roots,
  selectedIds,
  selectedFolderId,
  onSelect,
  onSelectFolder,
  onToggleVisibility,
  onRenameFolder,
  onCreateFolder,
  onDeleteFolder,
  onDuplicateEntity,
  onEditEntity,
  onDeleteEntity
}: SceneExplorerProps) {
  const entityCount = countEntities(roots);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  const closeContextMenu = () => setContextMenu(null);

  const handleRenameFolder = () => {
    if (!contextMenu || contextMenu.kind !== "folder" || !onRenameFolder) return;
    const folder = findFolderById(roots, contextMenu.folderId);
    if (!folder || folder.isRoot) return;
    const nextName = window.prompt("Rename folder", folder.displayName);
    if (!nextName?.trim()) return;
    onRenameFolder(folder.folderId, nextName.trim());
    closeContextMenu();
  };

  return (
    <Stack gap={0} onClick={closeContextMenu}>
      {roots.map((node) => (
        <TreeNode
          key={node.type === "entity" ? node.instanceId : node.folderId}
          node={node}
          depth={0}
          selectedIds={selectedIds}
          selectedFolderId={selectedFolderId}
          onSelect={onSelect}
          onSelectFolder={onSelectFolder}
          onToggleVisibility={onToggleVisibility}
          onOpenContextMenu={(_event, state) => setContextMenu(state)}
        />
      ))}
      {entityCount === 0 && (
        <Text size="xs" c="var(--sm-color-overlay0)" p="md" ta="center">
          No scene objects in this region.
        </Text>
      )}
      <Menu
        opened={Boolean(contextMenu)}
        onChange={(opened) => {
          if (!opened) closeContextMenu();
        }}
        withinPortal
        closeOnItemClick
        closeOnClickOutside
        position="bottom-start"
        offset={4}
        shadow="md"
      >
        <Menu.Target>
          <Box
            style={{
              position: "fixed",
              left: contextMenu?.x ?? -9999,
              top: contextMenu?.y ?? -9999,
              width: 1,
              height: 1
            }}
          />
        </Menu.Target>
        <Menu.Dropdown>
          {contextMenu?.kind === "entity" ? (
            <>
              {findEntityById(roots, contextMenu.instanceId)?.entityKind === "asset" && (
                <>
                  <Menu.Item onClick={() => onDuplicateEntity?.(contextMenu.instanceId)}>
                    Duplicate
                  </Menu.Item>
                  <Menu.Item onClick={() => onEditEntity?.(contextMenu.instanceId)}>
                    Edit
                  </Menu.Item>
                  <Menu.Divider />
                </>
              )}
              <Menu.Item color="red" onClick={() => onDeleteEntity?.(contextMenu.instanceId)}>
                Delete
              </Menu.Item>
            </>
          ) : contextMenu?.kind === "folder" ? (
            <>
              <Menu.Item
                onClick={() =>
                  onCreateFolder?.(contextMenu.isRoot ? null : contextMenu.folderId)
                }
              >
                Add Folder
              </Menu.Item>
              {!contextMenu.isRoot && (
                <Menu.Item onClick={handleRenameFolder}>
                  Edit
                </Menu.Item>
              )}
              {!contextMenu.isRoot && (
                <>
                  <Menu.Divider />
                  <Menu.Item
                    color="red"
                    onClick={() => onDeleteFolder?.(contextMenu.folderId)}
                  >
                    Delete
                  </Menu.Item>
                </>
              )}
            </>
          ) : null}
        </Menu.Dropdown>
      </Menu>
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

function findFolderById(
  nodes: SceneExplorerNode[],
  folderId: string
): SceneExplorerFolder | null {
  for (const node of nodes) {
    if (node.type === "folder") {
      if (node.folderId === folderId) return node;
      const child = findFolderById(node.children, folderId);
      if (child) return child;
    }
  }
  return null;
}

function findEntityById(
  nodes: SceneExplorerNode[],
  instanceId: string
): SceneExplorerEntity | null {
  for (const node of nodes) {
    if (node.type === "entity") {
      if (node.instanceId === instanceId) return node;
      continue;
    }

    const child = findEntityById(node.children, instanceId);
    if (child) return child;
  }

  return null;
}
