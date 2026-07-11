/**
 * Surface Library workspace.
 *
 * Owns the Build-mode authoring surface for reusable `SurfaceDefinition`s.
 */

import { type ReactNode } from "react";
import { Badge, Group, Stack, Text } from "@mantine/core";
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
          }`
        }
        getBadge={(definition) =>
          definition.metadata?.builtIn ? "Built-in" : null
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
            // Built-ins are factory-owned (edits would be replaced on
            // the next load): show the stack read-only. Duplicate via
            // the list's context menu to get an editable copy.
            <Stack gap="sm">
              <Group gap={8} wrap="nowrap">
                <Text size="sm" fw={600} truncate>
                  {selectedDefinition.displayName}
                </Text>
                <Badge size="xs" variant="light" color="gray" style={{ flexShrink: 0 }}>
                  Built-in
                </Badge>
              </Group>
              <div style={{ opacity: 0.55, pointerEvents: "none" }} aria-disabled>
                <LayerStackView
                  surface={selectedDefinition.surface}
                  allowedContext="landscape-only"
                  allowPainted={false}
                  paintOwner={null}
                  onChangeSurface={() => {}}
                />
              </div>
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
