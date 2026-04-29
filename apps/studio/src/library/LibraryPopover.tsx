/**
 * Library popover.
 *
 * Single owner of the Game > Libraries > {kind} dialog. Renders the
 * library kinds (Materials / Textures / Shaders — Surfaces are NOT a
 * library kind per Plan 037; character models + animations are NOT
 * library kinds per Plan 038, they're entity-owned and authored via
 * the Player/NPC inspector file-pickers) with a list-on-left +
 * preview-on-right layout. Reads `activeLibrary` from the shell
 * store; the menu trigger lives in App.tsx's Game menu.
 */

import { useMemo, useState } from "react";
import { useStore } from "zustand";
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
import type {
  MaterialDefinition,
  ShaderGraphDocument,
  TextureDefinition
} from "@sugarmagic/domain";
import type { AuthoredAssetResolver } from "@sugarmagic/render-web";
import type { ShellStore } from "@sugarmagic/shell";
import { MaterialPreview, type MaterialPreviewGeometryKind } from "./MaterialPreview";
import { TexturePreview } from "./TexturePreview";

export interface LibraryPopoverProps {
  shellStore: ShellStore;
  materialDefinitions: MaterialDefinition[];
  textureDefinitions: TextureDefinition[];
  shaderDefinitions: ShaderGraphDocument[];
  /** For resolving texture refs in MaterialPreview. */
  assetResolver: AuthoredAssetResolver | null;
  isMaterialReferenced: (definitionId: string) => boolean;
  onCreateMaterialDefinition: () => MaterialDefinition | null;
  onImportPbrMaterial: () => Promise<MaterialDefinition | null>;
  onImportTextureDefinition: () => Promise<TextureDefinition | null>;
  onRemoveMaterialDefinition: (definitionId: string) => void;
  /**
   * Open a shader in the Render workspace's shader-graph editor.
   * Called when the user clicks "Edit in Shader Graph" on a shader
   * in the Shaders popover. Implementation closes the popover and
   * navigates the shell to render → shaders with the target loaded.
   */
  onEditShaderInGraph: (shaderDefinitionId: string) => void;
}

interface ListItem {
  id: string;
  displayName: string;
  isBuiltIn: boolean;
}

function getMaterialItems(definitions: MaterialDefinition[]): ListItem[] {
  return definitions.map((d) => ({
    id: d.definitionId,
    displayName: d.displayName,
    isBuiltIn: Boolean(d.metadata?.builtIn)
  }));
}

function getTextureItems(definitions: TextureDefinition[]): ListItem[] {
  return definitions.map((d) => ({
    id: d.definitionId,
    displayName: d.displayName,
    isBuiltIn: false
  }));
}

function getShaderItems(definitions: ShaderGraphDocument[]): ListItem[] {
  return definitions.map((d) => ({
    id: d.shaderDefinitionId,
    displayName: d.displayName,
    isBuiltIn: Boolean(d.metadata?.builtIn)
  }));
}

export function LibraryPopover({
  shellStore,
  materialDefinitions,
  textureDefinitions,
  shaderDefinitions,
  assetResolver,
  isMaterialReferenced,
  onCreateMaterialDefinition,
  onImportPbrMaterial,
  onImportTextureDefinition,
  onRemoveMaterialDefinition,
  onEditShaderInGraph
}: LibraryPopoverProps) {
  const activeLibrary = useStore(shellStore, (s) => s.activeLibrary);
  const onClose = () => shellStore.getState().setActiveLibrary(null);

  const allItems: ListItem[] = useMemo(() => {
    if (activeLibrary === "materials") return getMaterialItems(materialDefinitions);
    if (activeLibrary === "textures") return getTextureItems(textureDefinitions);
    if (activeLibrary === "shaders") return getShaderItems(shaderDefinitions);
    return [];
  }, [
    activeLibrary,
    materialDefinitions,
    textureDefinitions,
    shaderDefinitions
  ]);

  const [searchState, setSearchState] = useState<{
    library: typeof activeLibrary;
    query: string;
  }>({ library: null, query: "" });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [geometryKind, setGeometryKind] = useState<MaterialPreviewGeometryKind>("cube");
  // Keep search scoped to the active library without an effect-driven reset.
  // React's hooks lint rejects synchronous setState in effects, so the query
  // carries its library key and naturally reads as empty after kind changes.
  const searchQuery =
    searchState.library === activeLibrary ? searchState.query : "";

  const items: ListItem[] = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return allItems;
    return allItems.filter((item) =>
      item.displayName.toLowerCase().includes(query)
    );
  }, [allItems, searchQuery]);

  // Derive fallback selection instead of mutating state when filters or library
  // kind changes. This preserves the old "first visible item is selected"
  // behavior while avoiding an auto-select effect.
  const effectiveSelectedId =
    activeLibrary !== null && selectedId && items.some((i) => i.id === selectedId)
      ? selectedId
      : items[0]?.id ?? null;

  const selectedMaterial =
    activeLibrary === "materials"
      ? materialDefinitions.find((d) => d.definitionId === effectiveSelectedId) ?? null
      : null;
  const selectedTexture =
    activeLibrary === "textures"
      ? textureDefinitions.find((d) => d.definitionId === effectiveSelectedId) ?? null
      : null;
  const selectedShader =
    activeLibrary === "shaders"
      ? shaderDefinitions.find((d) => d.shaderDefinitionId === effectiveSelectedId) ?? null
      : null;

  const titleText =
    activeLibrary === "materials"
      ? "Materials"
      : activeLibrary === "textures"
        ? "Textures"
        : activeLibrary === "shaders"
          ? "Shaders"
          : "Library";

  return (
    <Modal
      opened={activeLibrary !== null}
      onClose={onClose}
      title={`${titleText} Library`}
      size="xl"
      styles={{
        // Modal.Content is a fixed-height flex column; Modal.Body
        // takes the remaining height and clips overflow so the
        // ScrollArea inside the LEFT list column owns scrolling
        // (instead of the whole popover scrolling as one giant page).
        content: {
          height: "min(720px, 90vh)",
          display: "flex",
          flexDirection: "column"
        },
        body: {
          padding: 0,
          flex: 1,
          minHeight: 0,
          overflow: "hidden",
          display: "flex"
        }
      }}
    >
      <Group
        gap={0}
        align="stretch"
        wrap="nowrap"
        style={{ flex: 1, minHeight: 0, width: "100%" }}
      >
        {/* LEFT: list */}
        <Stack
          gap={0}
          style={{
            flex: "0 0 280px",
            minHeight: 0,
            borderRight: "1px solid var(--sm-panel-border)",
            background: "var(--sm-color-surface0)"
          }}
        >
          <Group gap="xs" p="xs" style={{ borderBottom: "1px solid var(--sm-panel-border)", flex: "0 0 auto" }}>
            {activeLibrary === "materials" ? (
              <>
                <Button size="xs" onClick={() => onCreateMaterialDefinition()}>
                  New
                </Button>
                <Button size="xs" variant="light" onClick={() => void onImportPbrMaterial()}>
                  Import PBR
                </Button>
              </>
            ) : activeLibrary === "textures" ? (
              <Button size="xs" onClick={() => void onImportTextureDefinition()}>
                Import Texture
              </Button>
            ) : null}
          </Group>
          <Box p="xs" style={{ borderBottom: "1px solid var(--sm-panel-border)", flex: "0 0 auto" }}>
            <TextInput
              size="xs"
              placeholder={`Search ${titleText.toLowerCase()}...`}
              value={searchQuery}
              onChange={(event) =>
                setSearchState({
                  library: activeLibrary,
                  query: event.currentTarget.value
                })
              }
            />
          </Box>
          <ScrollArea style={{ flex: 1, minHeight: 0 }}>
            <Stack gap={2} p="xs">
              {items.map((item) => {
                const isSelected = item.id === effectiveSelectedId;
                return (
                  <Box
                    key={item.id}
                    onClick={() => setSelectedId(item.id)}
                    style={{
                      cursor: "pointer",
                      padding: "6px 10px",
                      borderRadius: 6,
                      background: isSelected
                        ? "var(--sm-active-bg)"
                        : "transparent",
                      border: `1px solid ${isSelected ? "var(--sm-accent-blue)" : "transparent"}`
                    }}
                  >
                    <Text size="sm" fw={isSelected ? 600 : 500}>
                      {item.displayName}
                    </Text>
                    <Text size="xs" c="var(--sm-color-overlay0)">
                      {item.isBuiltIn ? "built-in" : "project"}
                    </Text>
                  </Box>
                );
              })}
              {items.length === 0 ? (
                <Text size="xs" c="var(--sm-color-overlay0)" ta="center" mt="md">
                  {searchQuery.trim()
                    ? `No ${titleText.toLowerCase()} match "${searchQuery}".`
                    : `No ${titleText.toLowerCase()} yet.`}
                </Text>
              ) : null}
            </Stack>
          </ScrollArea>
        </Stack>

        {/* RIGHT: preview + details */}
        <Stack
          gap="md"
          p="md"
          style={{ flex: 1, minWidth: 0 }}
        >
          {activeLibrary === "materials" ? (
            <>
              <MaterialPreview
                material={selectedMaterial}
                geometryKind={geometryKind}
                onChangeGeometryKind={setGeometryKind}
                textureDefinitions={textureDefinitions}
                assetResolver={assetResolver}
              />
              {selectedMaterial ? (
                <Stack gap={4}>
                  <Text size="md" fw={700}>
                    {selectedMaterial.displayName}
                  </Text>
                  <Text size="xs" c="var(--sm-color-overlay0)">
                    {selectedMaterial.metadata?.builtIn ? "built-in" : "project"}
                  </Text>
                  {!selectedMaterial.metadata?.builtIn ? (
                    <Group gap="xs" mt="xs">
                      <Button
                        size="xs"
                        variant="subtle"
                        color="red"
                        disabled={isMaterialReferenced(selectedMaterial.definitionId)}
                        onClick={() => onRemoveMaterialDefinition(selectedMaterial.definitionId)}
                      >
                        Delete
                      </Button>
                    </Group>
                  ) : null}
                </Stack>
              ) : null}
            </>
          ) : activeLibrary === "textures" ? (
            <>
              <TexturePreview texture={selectedTexture} assetResolver={assetResolver} />
              {selectedTexture ? (
                <Stack gap={4}>
                  <Text size="md" fw={700}>
                    {selectedTexture.displayName}
                  </Text>
                  <Text size="xs" c="var(--sm-color-overlay0)">
                    project
                  </Text>
                </Stack>
              ) : null}
            </>
          ) : activeLibrary === "shaders" ? (
            selectedShader ? (
              <Stack gap="md">
                <Stack gap={4}>
                  <Text size="md" fw={700}>
                    {selectedShader.displayName}
                  </Text>
                  <Text size="xs" c="var(--sm-color-overlay0)">
                    {selectedShader.metadata?.builtIn ? "built-in" : "project"}
                    {" · "}
                    target: {selectedShader.targetKind}
                    {" · "}
                    {selectedShader.nodes.length} nodes,{" "}
                    {selectedShader.edges.length} edges
                  </Text>
                </Stack>
                <Group gap="xs">
                  <Button
                    size="xs"
                    onClick={() =>
                      onEditShaderInGraph(selectedShader.shaderDefinitionId)
                    }
                  >
                    Edit in Shader Graph
                  </Button>
                </Group>
                <Text size="xs" c="var(--sm-color-overlay0)">
                  Shaders don't have a single canonical preview — the
                  same graph can render differently as a surface,
                  deform, effect, or post-process. Open the graph in
                  the Render workspace to inspect or edit.
                </Text>
              </Stack>
            ) : (
              <Stack h="100%" align="center" justify="center">
                <Text size="sm" c="var(--sm-color-overlay0)">
                  Select a shader to inspect.
                </Text>
              </Stack>
            )
          ) : null}
        </Stack>
      </Group>
    </Modal>
  );
}
