/**
 * Library popover.
 *
 * Single owner of the Game > Libraries > {kind} dialog. Renders the
 * library kinds (Assets / Materials / Textures / Shaders / Audio /
 * Animations) with a list-on-left + preview-on-right layout.
 * Reads `activeLibrary` from the shell store; the menu trigger
 * lives in App.tsx's Game menu.
 *
 * Assets joined the library kinds 2026-07-09 (they predate the
 * library pattern and used to be a whole Build workspace).
 * Animations joined 2026-07-20 (AnimLib 3, Plan 070).
 */

import { useMemo, useState } from "react";
import { useStore } from "zustand";
import {
  ActionIcon,
  Box,
  Button,
  Group,
  Modal,
  ScrollArea,
  Stack,
  Text,
  TextInput,
  Tooltip
} from "@mantine/core";
import type {
  AnimationLibraryDefinition,
  AssetDefinition,
  AudioClipDefinition,
  ContentLibrarySnapshot,
  MaterialDefinition,
  ShaderGraphDocument,
  TextureDefinition
} from "@sugarmagic/domain";
import type { AuthoredAssetResolver } from "@sugarmagic/render-web";
import type { ShellStore } from "@sugarmagic/shell";
import { AudioTransport } from "@sugarmagic/ui";
import { AssetDefinitionInspector } from "@sugarmagic/workspaces";
import {
  MaterialPreview,
  type MaterialPreviewGeometryKind
} from "./MaterialPreview";
import { TexturePreview } from "./TexturePreview";

export interface LibraryPopoverProps {
  shellStore: ShellStore;
  materialDefinitions: MaterialDefinition[];
  textureDefinitions: TextureDefinition[];
  shaderDefinitions: ShaderGraphDocument[];
  audioClipDefinitions: AudioClipDefinition[];
  assetDefinitions: AssetDefinition[];
  animationLibraryDefinitions: AnimationLibraryDefinition[];
  /** Full snapshot + scatter/mask defs for the asset inspector. */
  contentLibrary: ContentLibrarySnapshot | null;
  assetSources: Record<string, string>;
  /** For resolving texture refs in MaterialPreview. */
  assetResolver: AuthoredAssetResolver | null;
  isMaterialReferenced: (definitionId: string) => boolean;
  isTextureReferenced: (definitionId: string) => boolean;
  isAssetReferenced: (definitionId: string) => boolean;
  /** Preselects this asset when the Assets library opens (the
   *  "Edit definition" affordance on a placed instance). */
  assetsPreselectId: string | null;
  onRemoveTextureDefinition: (definitionId: string) => void;
  onCreateMaterialDefinition: () => MaterialDefinition | null;
  onImportPbrMaterial: () => Promise<MaterialDefinition | null>;
  onImportTextureDefinition: () => Promise<TextureDefinition | null>;
  onImportAudioClipDefinition: () => Promise<AudioClipDefinition | null>;
  onImportAssetDefinition: () => Promise<AssetDefinition | null>;
  onImportAnimationLibrary: () => Promise<AnimationLibraryDefinition[] | null>;
  onUpdateAssetDefinition: (definitionId: string, displayName: string) => void;
  onRemoveAssetDefinition: (definitionId: string) => void;
  /** #358 -- re-pivot the asset's GLB to bottom-center (Auto Correct
   *  Origin button in the asset detail panel). */
  onCorrectAssetOrigin: (definitionId: string) => void | Promise<void>;
  /** Plan 069.6 -- set the asset DEFINITION collider shape (type-level
   *  default all instances inherit). */
  onSetAssetColliderShape: (
    definitionId: string,
    shape: import("@sugarmagic/domain").AssetColliderShape
  ) => void | Promise<void>;
  onUpdateAudioClipDefinition: (
    definitionId: string,
    patch: Partial<AudioClipDefinition>
  ) => void;
  onUpdateAnimationLibraryDefinition: (
    definitionId: string,
    displayName: string
  ) => void;
  onRemoveMaterialDefinition: (definitionId: string) => void;
  onRemoveAudioClipDefinition: (definitionId: string) => void;
  onRemoveAnimationLibraryDefinition: (definitionId: string) => void;
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

function getAudioItems(definitions: AudioClipDefinition[]): ListItem[] {
  return definitions.map((d) => ({
    id: d.definitionId,
    displayName: d.displayName,
    isBuiltIn: false
  }));
}

function assetKindIcon(definition: AssetDefinition): string {
  return definition.assetKind === "foliage" ? "🌳" : "📦";
}

function assetKindLabel(definition: AssetDefinition): string {
  return definition.assetKind === "foliage" ? "Foliage" : "Model";
}

function getAssetItems(definitions: AssetDefinition[]): ListItem[] {
  return definitions.map((d) => ({
    id: d.definitionId,
    displayName: `${assetKindIcon(d)} ${d.displayName}`,
    isBuiltIn: false
  }));
}

function getAnimationLibraryItems(
  definitions: AnimationLibraryDefinition[]
): ListItem[] {
  return definitions.map((d) => ({
    id: d.definitionId,
    displayName: d.displayName,
    isBuiltIn: false
  }));
}

export function LibraryPopover({
  shellStore,
  materialDefinitions,
  textureDefinitions,
  shaderDefinitions,
  audioClipDefinitions,
  assetDefinitions,
  animationLibraryDefinitions,
  contentLibrary,
  assetSources,
  assetResolver,
  isMaterialReferenced,
  isTextureReferenced,
  isAssetReferenced,
  assetsPreselectId,
  onRemoveTextureDefinition,
  onCreateMaterialDefinition,
  onImportPbrMaterial,
  onImportTextureDefinition,
  onImportAudioClipDefinition,
  onImportAssetDefinition,
  onImportAnimationLibrary,
  onUpdateAssetDefinition,
  onRemoveAssetDefinition,
  onCorrectAssetOrigin,
  onSetAssetColliderShape,
  onUpdateAudioClipDefinition,
  onUpdateAnimationLibraryDefinition,
  onRemoveMaterialDefinition,
  onRemoveAudioClipDefinition,
  onRemoveAnimationLibraryDefinition,
  onEditShaderInGraph
}: LibraryPopoverProps) {
  const activeLibrary = useStore(shellStore, (s) => s.activeLibrary);
  const onClose = () => shellStore.getState().setActiveLibrary(null);

  const allItems: ListItem[] = useMemo(() => {
    if (activeLibrary === "assets") return getAssetItems(assetDefinitions);
    if (activeLibrary === "materials")
      return getMaterialItems(materialDefinitions);
    if (activeLibrary === "textures")
      return getTextureItems(textureDefinitions);
    if (activeLibrary === "shaders") return getShaderItems(shaderDefinitions);
    if (activeLibrary === "audio") return getAudioItems(audioClipDefinitions);
    if (activeLibrary === "animations")
      return getAnimationLibraryItems(animationLibraryDefinitions);
    return [];
  }, [
    activeLibrary,
    assetDefinitions,
    audioClipDefinitions,
    materialDefinitions,
    textureDefinitions,
    shaderDefinitions,
    animationLibraryDefinitions
  ]);

  const [searchState, setSearchState] = useState<{
    library: typeof activeLibrary;
    query: string;
  }>({ library: null, query: "" });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [geometryKind, setGeometryKind] =
    useState<MaterialPreviewGeometryKind>("cube");
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
  // behavior while avoiding an auto-select effect. The Assets kind
  // honors an externally-requested preselect ("Edit definition" on a
  // placed instance) ahead of the first-item default.
  const effectiveSelectedId =
    activeLibrary !== null &&
    selectedId &&
    items.some((i) => i.id === selectedId)
      ? selectedId
      : activeLibrary === "assets" &&
          assetsPreselectId &&
          items.some((i) => i.id === assetsPreselectId)
        ? assetsPreselectId
        : (items[0]?.id ?? null);

  const selectedMaterial =
    activeLibrary === "materials"
      ? (materialDefinitions.find(
          (d) => d.definitionId === effectiveSelectedId
        ) ?? null)
      : null;
  const selectedTexture =
    activeLibrary === "textures"
      ? (textureDefinitions.find(
          (d) => d.definitionId === effectiveSelectedId
        ) ?? null)
      : null;
  const selectedShader =
    activeLibrary === "shaders"
      ? (shaderDefinitions.find(
          (d) => d.shaderDefinitionId === effectiveSelectedId
        ) ?? null)
      : null;
  const selectedAudioClip =
    activeLibrary === "audio"
      ? (audioClipDefinitions.find(
          (d) => d.definitionId === effectiveSelectedId
        ) ?? null)
      : null;
  const selectedAsset =
    activeLibrary === "assets"
      ? (assetDefinitions.find(
          (d) => d.definitionId === effectiveSelectedId
        ) ?? null)
      : null;
  const selectedAnimationLibrary =
    activeLibrary === "animations"
      ? (animationLibraryDefinitions.find(
          (d) => d.definitionId === effectiveSelectedId
        ) ?? null)
      : null;

  const titleText =
    activeLibrary === "assets"
      ? "Assets"
      : activeLibrary === "materials"
        ? "Materials"
        : activeLibrary === "textures"
          ? "Textures"
          : activeLibrary === "shaders"
            ? "Shaders"
            : activeLibrary === "audio"
              ? "Audio"
              : activeLibrary === "animations"
                ? "Animations"
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
          <Group
            gap="xs"
            p="xs"
            style={{
              borderBottom: "1px solid var(--sm-panel-border)",
              flex: "0 0 auto"
            }}
          >
            {activeLibrary === "assets" ? (
              <Button
                size="xs"
                onClick={() => void onImportAssetDefinition()}
              >
                Import Asset
              </Button>
            ) : activeLibrary === "materials" ? (
              <>
                <Button size="xs" onClick={() => onCreateMaterialDefinition()}>
                  New
                </Button>
                <Button
                  size="xs"
                  variant="light"
                  onClick={() => void onImportPbrMaterial()}
                >
                  Import PBR
                </Button>
              </>
            ) : activeLibrary === "textures" ? (
              <Button
                size="xs"
                onClick={() => void onImportTextureDefinition()}
              >
                Import Texture
              </Button>
            ) : activeLibrary === "audio" ? (
              <Button
                size="xs"
                onClick={() => void onImportAudioClipDefinition()}
              >
                Import Audio
              </Button>
            ) : activeLibrary === "animations" ? (
              <Button
                size="xs"
                onClick={() => void onImportAnimationLibrary()}
              >
                Import GLB
              </Button>
            ) : null}
          </Group>
          <Box
            p="xs"
            style={{
              borderBottom: "1px solid var(--sm-panel-border)",
              flex: "0 0 auto"
            }}
          >
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
                <Text
                  size="xs"
                  c="var(--sm-color-overlay0)"
                  ta="center"
                  mt="md"
                >
                  {searchQuery.trim()
                    ? `No ${titleText.toLowerCase()} match "${searchQuery}".`
                    : `No ${titleText.toLowerCase()} yet.`}
                </Text>
              ) : null}
            </Stack>
          </ScrollArea>
        </Stack>

        {/* RIGHT: preview + details */}
        <Stack gap="md" p="md" style={{ flex: 1, minWidth: 0 }}>
          {activeLibrary === "assets" ? (
            selectedAsset && contentLibrary ? (
              <ScrollArea style={{ flex: 1, minHeight: 0 }}>
                <Stack gap="md" pr="sm">
                  <Group justify="space-between" align="center">
                    <Text size="md" fw={700}>
                      {assetKindIcon(selectedAsset)}{" "}
                      {selectedAsset.displayName}
                      <Text
                        span
                        size="xs"
                        c="var(--sm-color-overlay0)"
                        ml={8}
                      >
                        {assetKindLabel(selectedAsset)}
                      </Text>
                    </Text>
                    <Tooltip
                      label={
                        isAssetReferenced(selectedAsset.definitionId)
                          ? "Placed in a region or referenced by scatter/surfaces — remove those first"
                          : "Delete asset from the library"
                      }
                    >
                      <ActionIcon
                        variant="subtle"
                        color="red"
                        disabled={isAssetReferenced(
                          selectedAsset.definitionId
                        )}
                        onClick={() =>
                          onRemoveAssetDefinition(selectedAsset.definitionId)
                        }
                        aria-label="Delete asset"
                      >
                        🗑
                      </ActionIcon>
                    </Tooltip>
                  </Group>
                  <AssetDefinitionInspector
                    key={selectedAsset.definitionId}
                    assetDefinition={selectedAsset}
                    onUpdateAssetDefinition={onUpdateAssetDefinition}
                    onCorrectOrigin={onCorrectAssetOrigin}
                    onSetColliderShape={onSetAssetColliderShape}
                  />
                </Stack>
              </ScrollArea>
            ) : (
              <Stack h="100%" align="center" justify="center">
                <Text size="sm" c="var(--sm-color-overlay0)">
                  Import a .glb / .gltf to add it to the library.
                </Text>
              </Stack>
            )
          ) : activeLibrary === "materials" ? (
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
                    {selectedMaterial.metadata?.builtIn
                      ? "built-in"
                      : "project"}
                  </Text>
                  {!selectedMaterial.metadata?.builtIn ? (
                    <Group gap="xs" mt="xs">
                      <Button
                        size="xs"
                        variant="subtle"
                        color="red"
                        disabled={isMaterialReferenced(
                          selectedMaterial.definitionId
                        )}
                        onClick={() =>
                          onRemoveMaterialDefinition(
                            selectedMaterial.definitionId
                          )
                        }
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
              {selectedTexture ? (
                <Group justify="flex-end" mb={-8}>
                  <Tooltip
                    label={
                      isTextureReferenced(selectedTexture.definitionId)
                        ? "In use by a material or surface — remove those references first"
                        : "Delete texture from the library"
                    }
                  >
                    <ActionIcon
                      variant="subtle"
                      color="red"
                      disabled={isTextureReferenced(
                        selectedTexture.definitionId
                      )}
                      onClick={() =>
                        onRemoveTextureDefinition(selectedTexture.definitionId)
                      }
                      aria-label="Delete texture"
                    >
                      🗑
                    </ActionIcon>
                  </Tooltip>
                </Group>
              ) : null}
              <TexturePreview
                texture={selectedTexture}
                assetResolver={assetResolver}
              />
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
                  Shaders don't have a single canonical preview — the same graph
                  can render differently as a surface, deform, effect, or
                  post-process. Open the graph in the Render workspace to
                  inspect or edit.
                </Text>
              </Stack>
            ) : (
              <Stack h="100%" align="center" justify="center">
                <Text size="sm" c="var(--sm-color-overlay0)">
                  Select a shader to inspect.
                </Text>
              </Stack>
            )
          ) : activeLibrary === "audio" ? (
            <>
              <AudioTransport
                sourceUrl={
                  selectedAudioClip
                    ? (assetSources[
                        selectedAudioClip.source.relativeAssetPath
                      ] ?? null)
                    : null
                }
                label={selectedAudioClip?.displayName ?? "Audio Preview"}
                disabledReason="Select or import an audio clip to preview."
              />
              {selectedAudioClip ? (
                <Stack gap="sm">
                  <TextInput
                    label="Display Name"
                    value={selectedAudioClip.displayName}
                    onChange={(event) =>
                      onUpdateAudioClipDefinition(
                        selectedAudioClip.definitionId,
                        {
                          displayName: event.currentTarget.value
                        }
                      )
                    }
                  />
                  <Stack gap={2}>
                    <Text size="xs" c="var(--sm-color-overlay0)">
                      {selectedAudioClip.source.fileName}
                    </Text>
                    <Text size="xs" c="var(--sm-color-overlay0)">
                      {selectedAudioClip.source.relativeAssetPath}
                    </Text>
                  </Stack>
                  <Group gap="xs">
                    <Button
                      size="xs"
                      variant="subtle"
                      color="red"
                      onClick={() =>
                        onRemoveAudioClipDefinition(
                          selectedAudioClip.definitionId
                        )
                      }
                    >
                      Delete
                    </Button>
                  </Group>
                </Stack>
              ) : null}
            </>
          ) : activeLibrary === "animations" ? (
            selectedAnimationLibrary ? (
              <Stack gap="sm">
                <TextInput
                  label="Display Name"
                  value={selectedAnimationLibrary.displayName}
                  onChange={(event) =>
                    onUpdateAnimationLibraryDefinition(
                      selectedAnimationLibrary.definitionId,
                      event.currentTarget.value
                    )
                  }
                />
                <Stack gap={2}>
                  <Text size="xs" c="var(--sm-color-overlay0)">
                    {selectedAnimationLibrary.origin === "generated"
                      ? "generated"
                      : "imported"}{" "}
                    · {selectedAnimationLibrary.clipNames.length}{" "}
                    {selectedAnimationLibrary.clipNames.length === 1
                      ? "clip"
                      : "clips"}
                  </Text>
                  <Text size="xs" c="var(--sm-color-overlay0)">
                    {selectedAnimationLibrary.source.fileName}
                  </Text>
                </Stack>
                {selectedAnimationLibrary.clipNames.length > 0 ? (
                  <Stack gap={2}>
                    <Text size="xs" fw={600}>
                      Clips
                    </Text>
                    {selectedAnimationLibrary.clipNames.map((name) => (
                      <Text key={name} size="xs" c="var(--sm-color-subtext)">
                        {name}
                      </Text>
                    ))}
                  </Stack>
                ) : null}
                {selectedAnimationLibrary.origin !== "generated" ? (
                  <Group gap="xs">
                    <Button
                      size="xs"
                      variant="subtle"
                      color="red"
                      onClick={() =>
                        onRemoveAnimationLibraryDefinition(
                          selectedAnimationLibrary.definitionId
                        )
                      }
                    >
                      Delete
                    </Button>
                  </Group>
                ) : null}
              </Stack>
            ) : (
              <Stack h="100%" align="center" justify="center">
                <Text size="sm" c="var(--sm-color-overlay0)">
                  Import a Blender GLB to add animation clips.
                </Text>
              </Stack>
            )
          ) : null}
        </Stack>
      </Group>
    </Modal>
  );
}
