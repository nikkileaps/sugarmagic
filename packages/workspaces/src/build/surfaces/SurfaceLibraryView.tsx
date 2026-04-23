/**
 * Surface Library workspace.
 *
 * Owns the Build-mode authoring surface for reusable `SurfaceDefinition`s.
 */

import { useMemo, useState, type ReactNode } from "react";
import { ActionIcon, Menu, Stack, Text, TextInput, UnstyledButton } from "@mantine/core";
import type {
  FlowerTypeDefinition,
  GrassTypeDefinition,
  MaterialDefinition,
  MaskTextureDefinition,
  RockTypeDefinition,
  ShaderGraphDocument,
  SurfaceDefinition,
  TextureDefinition
} from "@sugarmagic/domain";
import { Inspector, PanelSection } from "@sugarmagic/ui";
import type { WorkspaceViewContribution } from "../../workspace-view";
import { SurfaceBindingEditor } from "./SurfaceBindingEditor";

export interface SurfaceLibraryViewProps {
  surfaceDefinitions: SurfaceDefinition[];
  materialDefinitions: MaterialDefinition[];
  textureDefinitions: TextureDefinition[];
  maskTextureDefinitions: MaskTextureDefinition[];
  onCreateMaskTextureDefinition?: () => Promise<MaskTextureDefinition | null> | MaskTextureDefinition | null;
  onImportMaskTextureDefinition?: () => Promise<MaskTextureDefinition | null>;
  activePaintMaskTextureId?: string | null;
  onSetActivePaintMaskTextureId?: (definitionId: string | null) => void;
  shaderDefinitions: ShaderGraphDocument[];
  grassTypeDefinitions: GrassTypeDefinition[];
  flowerTypeDefinitions: FlowerTypeDefinition[];
  rockTypeDefinitions: RockTypeDefinition[];
  selectedSurfaceDefinitionId: string | null;
  onSelectSurfaceDefinition: (definitionId: string) => void;
  onCreateSurfaceDefinition: () => SurfaceDefinition | null;
  onUpdateSurfaceDefinition: (
    definitionId: string,
    patch: Partial<SurfaceDefinition>
  ) => void;
  onRemoveSurfaceDefinition: (definitionId: string) => void;
  centerPanel?: ReactNode;
}

export function useSurfaceLibraryView(
  props: SurfaceLibraryViewProps
): WorkspaceViewContribution {
  const {
    surfaceDefinitions,
    materialDefinitions,
    textureDefinitions,
    maskTextureDefinitions,
    onCreateMaskTextureDefinition,
    onImportMaskTextureDefinition,
    activePaintMaskTextureId,
    onSetActivePaintMaskTextureId,
    shaderDefinitions,
    grassTypeDefinitions,
    flowerTypeDefinitions,
    rockTypeDefinitions,
    selectedSurfaceDefinitionId,
    onSelectSurfaceDefinition,
    onCreateSurfaceDefinition,
    onUpdateSurfaceDefinition,
    onRemoveSurfaceDefinition,
    centerPanel
  } = props;

  const [searchValue, setSearchValue] = useState("");
  const filteredDefinitions = useMemo(() => {
    const normalized = searchValue.trim().toLowerCase();
    if (!normalized) {
      return surfaceDefinitions;
    }
    return surfaceDefinitions.filter((definition) =>
      definition.displayName.toLowerCase().includes(normalized)
    );
  }, [searchValue, surfaceDefinitions]);

  const selectedDefinition =
    surfaceDefinitions.find(
      (definition) => definition.definitionId === selectedSurfaceDefinitionId
    ) ?? surfaceDefinitions[0] ?? null;

  return {
    leftPanel: (
      <PanelSection
        title="Surface Library"
        icon="🪴"
        actions={
          <Menu shadow="md" withinPortal position="bottom-end">
            <Menu.Target>
              <ActionIcon variant="subtle" size="sm" aria-label="Add surface">
                ＋
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item
                onClick={() => {
                  const created = onCreateSurfaceDefinition();
                  if (created) {
                    onSelectSurfaceDefinition(created.definitionId);
                  }
                }}
              >
                New Surface
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        }
      >
        <Stack gap="xs">
          <TextInput
            size="xs"
            placeholder="Search surfaces..."
            value={searchValue}
            onChange={(event) => setSearchValue(event.currentTarget.value)}
          />
          <Stack gap={4}>
            {filteredDefinitions.map((definition) => {
              const isSelected = definition.definitionId === selectedDefinition?.definitionId;
              return (
                <UnstyledButton
                  key={definition.definitionId}
                  onClick={() => onSelectSurfaceDefinition(definition.definitionId)}
                  styles={{
                    root: {
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "flex-start",
                      gap: 2,
                      padding: "6px 8px",
                      borderRadius: "var(--sm-radius-sm)",
                      background: isSelected ? "var(--sm-active-bg)" : "transparent",
                      color: isSelected
                        ? "var(--sm-accent-blue)"
                        : "var(--sm-color-text)"
                    }
                  }}
                >
                  <Text size="xs" fw={isSelected ? 600 : 500}>
                    {definition.displayName}
                  </Text>
                  <Text size="xs" c="var(--sm-color-overlay0)">
                    {definition.surface.layers.length} layer
                    {definition.surface.layers.length === 1 ? "" : "s"}
                  </Text>
                </UnstyledButton>
              );
            })}
          </Stack>
        </Stack>
      </PanelSection>
    ),
    rightPanel: (
      <Inspector selectionLabel={selectedDefinition?.displayName ?? null}>
        {selectedDefinition ? (
          <Stack gap="sm">
            <TextInput
              size="xs"
              label="Display Name"
              value={selectedDefinition.displayName}
              onChange={(event) =>
                onUpdateSurfaceDefinition(selectedDefinition.definitionId, {
                  displayName: event.currentTarget.value
                })
              }
            />
            <SurfaceBindingEditor
              value={{ kind: "inline", surface: selectedDefinition.surface }}
              allowedContext="landscape-only"
              surfaceDefinitions={surfaceDefinitions}
              materialDefinitions={materialDefinitions}
              textureDefinitions={textureDefinitions}
              maskTextureDefinitions={maskTextureDefinitions}
              onCreateMaskTextureDefinition={onCreateMaskTextureDefinition}
              onImportMaskTextureDefinition={onImportMaskTextureDefinition}
              activePaintMaskTextureId={activePaintMaskTextureId}
              onSetActivePaintMaskTextureId={onSetActivePaintMaskTextureId}
              shaderDefinitions={shaderDefinitions}
              grassTypeDefinitions={grassTypeDefinitions}
              flowerTypeDefinitions={flowerTypeDefinitions}
              rockTypeDefinitions={rockTypeDefinitions}
              onChange={(next) => {
                if (next?.kind === "inline") {
                  onUpdateSurfaceDefinition(selectedDefinition.definitionId, {
                    surface: next.surface
                  });
                }
              }}
            />
            <ActionIcon
              variant="subtle"
              color="red"
              aria-label="Remove surface definition"
              onClick={() => onRemoveSurfaceDefinition(selectedDefinition.definitionId)}
            >
              Remove Surface
            </ActionIcon>
          </Stack>
        ) : (
          <Text size="xs" c="var(--sm-color-overlay0)">
            Select a surface to edit it.
          </Text>
        )}
      </Inspector>
    ),
    centerPanel,
    viewportOverlay: null
  };
}
