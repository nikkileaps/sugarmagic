/**
 * Surface Library workspace.
 *
 * Owns the Build-mode authoring surface for reusable `SurfaceDefinition`s.
 */

import { type ReactNode } from "react";
import { Stack, Text } from "@mantine/core";
import type { SurfaceDefinition } from "@sugarmagic/domain";
import { DraftTextInput, Inspector, PanelSectionList } from "@sugarmagic/ui";
import type { WorkspaceViewContribution } from "../../workspace-view";
import { LayerStackView } from "./LayerStackView";

export interface SurfaceLibraryViewProps {
  surfaceDefinitions: SurfaceDefinition[];
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
    selectedSurfaceDefinitionId,
    onSelectSurfaceDefinition,
    onCreateSurfaceDefinition,
    onUpdateSurfaceDefinition,
    onRemoveSurfaceDefinition,
    centerPanel
  } = props;

  const selectedDefinition =
    surfaceDefinitions.find(
      (definition) => definition.definitionId === selectedSurfaceDefinitionId
    ) ??
    surfaceDefinitions[0] ??
    null;

  return {
    leftPanel: (
      <PanelSectionList
        title="Surface Library"
        icon="🪴"
        items={surfaceDefinitions}
        selectedId={selectedDefinition?.definitionId ?? null}
        getId={(definition) => definition.definitionId}
        getLabel={(definition) => definition.displayName}
        getDescription={(definition) =>
          `${definition.surface.layers.length} layer${
            definition.surface.layers.length === 1 ? "" : "s"
          }`
        }
        onSelect={(definitionId) => onSelectSurfaceDefinition(definitionId)}
        searchPlaceholder="Search surfaces..."
        createLabel="Add surface"
        onCreate={() => {
          const created = onCreateSurfaceDefinition();
          if (created) {
            onSelectSurfaceDefinition(created.definitionId);
          }
        }}
        contextActions={[
          {
            label: "Delete",
            color: "red",
            onSelect: (definition) =>
              onRemoveSurfaceDefinition(definition.definitionId)
          }
        ]}
      />
    ),
    rightPanel: (
      <Inspector selectionLabel={selectedDefinition?.displayName ?? null}>
        {selectedDefinition ? (
          <Stack gap="sm">
            <DraftTextInput
              key={selectedDefinition.definitionId}
              size="xs"
              label="Display Name"
              value={selectedDefinition.displayName}
              onCommit={(displayName) =>
                onUpdateSurfaceDefinition(selectedDefinition.definitionId, {
                  displayName
                })
              }
            />
            <LayerStackView
              surface={selectedDefinition.surface}
              allowedContext="landscape-only"
              allowPainted={false}
              paintOwner={null}
              onChangeSurface={(surface) => {
                onUpdateSurfaceDefinition(selectedDefinition.definitionId, {
                  surface
                });
              }}
            />
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
