/**
 * Surface Library workspace.
 *
 * Owns the Build-mode authoring surface for reusable `SurfaceDefinition`s.
 */

import { type ReactNode } from "react";
import { Button, Stack, Text } from "@mantine/core";
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
  /** "Duplicate to edit" — returns the new user-owned copy's id. */
  onDuplicateSurfaceDefinition: (definitionId: string) => string | null;
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
    onDuplicateSurfaceDefinition,
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
          }${definition.metadata?.builtIn ? " · built-in" : ""}`
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
            label: "Duplicate",
            onSelect: (definition) => {
              const newId = onDuplicateSurfaceDefinition(
                definition.definitionId
              );
              if (newId) {
                onSelectSurfaceDefinition(newId);
              }
            }
          },
          {
            label: "Delete",
            color: "red",
            onSelect: (definition) => {
              // Deleting a built-in is a no-op lie — the factory
              // resurrects it on the next load.
              if (definition.metadata?.builtIn) return;
              onRemoveSurfaceDefinition(definition.definitionId);
            }
          }
        ]}
      />
    ),
    rightPanel: (
      <Inspector selectionLabel={selectedDefinition?.displayName ?? null}>
        {selectedDefinition ? (
          selectedDefinition.metadata?.builtIn ? (
            // Built-ins are factory-owned: edits would be silently
            // replaced on the next project load. Procreate-brush
            // model — duplicate into a user-owned copy to edit.
            <Stack gap="sm">
              <Text size="xs" c="var(--sm-color-overlay0)">
                Built-in preset. Duplicate it to make an editable copy —
                edits to the original do not persist.
              </Text>
              <Button
                size="xs"
                onClick={() => {
                  const newId = onDuplicateSurfaceDefinition(
                    selectedDefinition.definitionId
                  );
                  if (newId) {
                    onSelectSurfaceDefinition(newId);
                  }
                }}
              >
                Duplicate to Edit
              </Button>
            </Stack>
          ) : (
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
          )
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
