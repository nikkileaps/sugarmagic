/**
 * Build-mode material library workspace.
 *
 * Owns the canonical authoring surface for reusable MaterialDefinitions:
 * naming, parent-shader selection, parameter snapshots, and texture bindings.
 * The underlying source of truth still lives in the content library; this
 * workspace only edits that shared authored state.
 */

import { useEffect, useMemo, useState } from "react";
import { Button, Group, Select, Stack, Text, TextInput, UnstyledButton } from "@mantine/core";
import type {
  MaterialDefinition,
  ShaderGraphDocument,
  ShaderParameter,
  ShaderParameterValue,
  TextureDefinition
} from "@sugarmagic/domain";
import { Inspector, PanelSection } from "@sugarmagic/ui";
import type { WorkspaceViewContribution } from "../../workspace-view";
import { MaterialParameterEditor } from "../MaterialParameterEditor";

function normalizeSearchValue(value: string): string {
  return value.trim().toLowerCase();
}

function pruneMaterialParametersForShader(
  materialDefinition: MaterialDefinition,
  shaderDefinition: ShaderGraphDocument
): Pick<MaterialDefinition, "parameterValues" | "textureBindings"> {
  const parameterIds = new Set(shaderDefinition.parameters.map((parameter) => parameter.parameterId));
  const nextParameterValues = Object.fromEntries(
    Object.entries(materialDefinition.parameterValues).filter(([parameterId]) =>
      parameterIds.has(parameterId)
    )
  );
  const nextTextureBindings = Object.fromEntries(
    Object.entries(materialDefinition.textureBindings).filter(([parameterId]) =>
      parameterIds.has(parameterId)
    )
  );

  return {
    parameterValues: nextParameterValues,
    textureBindings: nextTextureBindings
  };
}

function parameterValueEqualsDefault(
  parameter: ShaderParameter,
  value: ShaderParameterValue
): boolean {
  return JSON.stringify(parameter.defaultValue) === JSON.stringify(value);
}

export interface MaterialsWorkspaceViewProps {
  materialDefinitions: MaterialDefinition[];
  textureDefinitions: TextureDefinition[];
  shaderDefinitions: ShaderGraphDocument[];
  selectedMaterialDefinitionId: string | null;
  onSelectMaterialDefinition: (definitionId: string) => void;
  onCreateMaterialDefinition: (shaderDefinitionId: string) => MaterialDefinition | null;
  onImportPbrMaterial: () => Promise<MaterialDefinition | null>;
  onImportTextureDefinition: () => Promise<TextureDefinition | null>;
  onUpdateMaterialDefinition: (
    definitionId: string,
    patch: Partial<MaterialDefinition>
  ) => void;
  onRemoveMaterialDefinition: (definitionId: string) => void;
  isMaterialReferenced: (definitionId: string) => boolean;
}

export function useMaterialsWorkspaceView(
  props: MaterialsWorkspaceViewProps
): WorkspaceViewContribution {
  const {
    materialDefinitions,
    textureDefinitions,
    shaderDefinitions,
    selectedMaterialDefinitionId,
    onSelectMaterialDefinition,
    onCreateMaterialDefinition,
    onImportPbrMaterial,
    onImportTextureDefinition,
    onUpdateMaterialDefinition,
    onRemoveMaterialDefinition,
    isMaterialReferenced
  } = props;

  const [searchValue, setSearchValue] = useState("");
  const surfaceShaderDefinitions = useMemo(
    () =>
      shaderDefinitions.filter(
        (definition) => definition.targetKind === "mesh-surface"
      ),
    [shaderDefinitions]
  );
  const defaultNewShaderId = useMemo(
    () =>
      surfaceShaderDefinitions.find(
        (definition) => definition.metadata.builtInKey === "standard-pbr"
      )?.shaderDefinitionId ??
      surfaceShaderDefinitions[0]?.shaderDefinitionId ??
      null,
    [surfaceShaderDefinitions]
  );
  const [newMaterialShaderId, setNewMaterialShaderId] = useState<string | null>(
    defaultNewShaderId
  );

  useEffect(() => {
    if (
      newMaterialShaderId &&
      surfaceShaderDefinitions.some(
        (definition) => definition.shaderDefinitionId === newMaterialShaderId
      )
    ) {
      return;
    }
    setNewMaterialShaderId(defaultNewShaderId);
  }, [defaultNewShaderId, newMaterialShaderId, surfaceShaderDefinitions]);

  const filteredMaterials = useMemo(() => {
    const search = normalizeSearchValue(searchValue);
    if (!search) {
      return materialDefinitions;
    }
    return materialDefinitions.filter((definition) => {
      const shaderLabel =
        surfaceShaderDefinitions.find(
          (shader) => shader.shaderDefinitionId === definition.shaderDefinitionId
        )?.displayName ?? "";
      return normalizeSearchValue(`${definition.displayName} ${shaderLabel}`).includes(search);
    });
  }, [materialDefinitions, searchValue, surfaceShaderDefinitions]);

  const selectedMaterial =
    materialDefinitions.find(
      (definition) => definition.definitionId === selectedMaterialDefinitionId
    ) ?? materialDefinitions[0] ?? null;
  const selectedShader =
    surfaceShaderDefinitions.find(
      (definition) => definition.shaderDefinitionId === selectedMaterial?.shaderDefinitionId
    ) ?? null;

  return {
    leftPanel: (
      <PanelSection title="Material Library" icon="🧱">
        <Stack gap="xs">
          <TextInput
            size="xs"
            placeholder="Search materials..."
            value={searchValue}
            onChange={(event) => setSearchValue(event.currentTarget.value)}
            styles={{
              input: {
                background: "var(--sm-color-base)",
                borderColor: "var(--sm-panel-border)",
                color: "var(--sm-color-text)"
              }
            }}
          />
          <Select
            size="xs"
            label="New Material Parent"
            placeholder="Choose parent shader..."
            data={surfaceShaderDefinitions.map((definition) => ({
              value: definition.shaderDefinitionId,
              label: definition.displayName
            }))}
            value={newMaterialShaderId}
            onChange={(value) => setNewMaterialShaderId(value)}
          />
          <Group grow>
            <Button
              size="xs"
              variant="light"
              disabled={!newMaterialShaderId}
              onClick={() => {
                if (!newMaterialShaderId) {
                  return;
                }
                const created = onCreateMaterialDefinition(newMaterialShaderId);
                if (created) {
                  onSelectMaterialDefinition(created.definitionId);
                }
              }}
            >
              New Material
            </Button>
            <Button
              size="xs"
              variant="light"
              onClick={async () => {
                const created = await onImportPbrMaterial();
                if (created) {
                  onSelectMaterialDefinition(created.definitionId);
                }
              }}
            >
              Import PBR Set
            </Button>
          </Group>
          <Text size="xs" c="var(--sm-color-overlay0)">
            Choose an exported texture folder. Sugarmagic infers basecolor,
            normal, ORM, roughness, metallic, and AO maps from filenames.
          </Text>
          <Button
            size="xs"
            variant="subtle"
            onClick={async () => {
              await onImportTextureDefinition();
            }}
          >
            Import Texture
          </Button>
          {filteredMaterials.length === 0 ? (
            <Text size="xs" c="var(--sm-color-overlay0)">
              {materialDefinitions.length === 0
                ? "No materials in the project yet."
                : "No materials match the current search."}
            </Text>
          ) : (
            <Stack gap={4}>
              {filteredMaterials.map((definition) => {
                const isSelected =
                  definition.definitionId === selectedMaterial?.definitionId;
                const shaderLabel =
                  surfaceShaderDefinitions.find(
                    (shader) => shader.shaderDefinitionId === definition.shaderDefinitionId
                  )?.displayName ?? "Missing Shader";
                return (
                  <UnstyledButton
                    key={definition.definitionId}
                    onClick={() => onSelectMaterialDefinition(definition.definitionId)}
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
                          : "var(--sm-color-text)",
                        transition: "var(--sm-transition-fast)",
                        "&:hover": {
                          background: isSelected
                            ? "var(--sm-active-bg-hover)"
                            : "var(--sm-hover-bg)"
                        }
                      }
                    }}
                  >
                    <Text size="xs" fw={isSelected ? 600 : 500}>
                      {definition.displayName}
                    </Text>
                    <Text size="xs" c="var(--sm-color-overlay0)">
                      {shaderLabel}
                    </Text>
                  </UnstyledButton>
                );
              })}
            </Stack>
          )}
        </Stack>
      </PanelSection>
    ),
    rightPanel: (
      <Inspector selectionLabel={selectedMaterial?.displayName ?? null}>
        {selectedMaterial ? (
          <MaterialInspectorPanel
            materialDefinition={selectedMaterial}
            shaderDefinition={selectedShader}
            shaderDefinitions={surfaceShaderDefinitions}
            textureDefinitions={textureDefinitions}
            isReferenced={isMaterialReferenced(selectedMaterial.definitionId)}
            onUpdateMaterialDefinition={onUpdateMaterialDefinition}
            onRemoveMaterialDefinition={onRemoveMaterialDefinition}
          />
        ) : (
          <Text size="xs" c="var(--sm-color-overlay0)">
            Select a material to inspect and edit it.
          </Text>
        )}
      </Inspector>
    ),
    viewportOverlay: null
  };
}

function MaterialInspectorPanel({
  materialDefinition,
  shaderDefinition,
  shaderDefinitions,
  textureDefinitions,
  isReferenced,
  onUpdateMaterialDefinition,
  onRemoveMaterialDefinition
}: {
  materialDefinition: MaterialDefinition;
  shaderDefinition: ShaderGraphDocument | null;
  shaderDefinitions: ShaderGraphDocument[];
  textureDefinitions: TextureDefinition[];
  isReferenced: boolean;
  onUpdateMaterialDefinition: (
    definitionId: string,
    patch: Partial<MaterialDefinition>
  ) => void;
  onRemoveMaterialDefinition: (definitionId: string) => void;
}) {
  const [draftDisplayName, setDraftDisplayName] = useState(materialDefinition.displayName);

  useEffect(() => {
    setDraftDisplayName(materialDefinition.displayName);
  }, [materialDefinition.definitionId, materialDefinition.displayName]);

  return (
    <Stack gap="md">
      <TextInput
        label="Display Name"
        value={draftDisplayName}
        onChange={(event) => setDraftDisplayName(event.currentTarget.value)}
        size="xs"
        styles={{
          label: {
            color: "var(--sm-color-subtext)",
            fontSize: "var(--sm-font-size-sm)",
            marginBottom: 4
          },
          input: {
            background: "var(--sm-color-base)",
            borderColor: "var(--sm-panel-border)",
            color: "var(--sm-color-text)"
          }
        }}
      />
      <Button
        size="xs"
        variant="light"
        disabled={
          !draftDisplayName.trim() || draftDisplayName.trim() === materialDefinition.displayName
        }
        onClick={() =>
          onUpdateMaterialDefinition(materialDefinition.definitionId, {
            displayName: draftDisplayName.trim()
          })
        }
      >
        Save Material Definition
      </Button>
      <Select
        label="Parent Shader"
        size="xs"
        value={materialDefinition.shaderDefinitionId}
        data={shaderDefinitions.map((definition) => ({
          value: definition.shaderDefinitionId,
          label: definition.displayName
        }))}
        onChange={(nextShaderDefinitionId) => {
          if (!nextShaderDefinitionId) {
            return;
          }
          const nextShaderDefinition =
            shaderDefinitions.find(
              (definition) => definition.shaderDefinitionId === nextShaderDefinitionId
            ) ?? null;
          if (!nextShaderDefinition) {
            return;
          }
          onUpdateMaterialDefinition(materialDefinition.definitionId, {
            shaderDefinitionId: nextShaderDefinition.shaderDefinitionId,
            ...pruneMaterialParametersForShader(materialDefinition, nextShaderDefinition)
          });
        }}
      />
      <Stack gap={4}>
        <Text size="xs" fw={600} c="var(--sm-color-subtext)" tt="uppercase">
          Parameters
        </Text>
        <MaterialParameterEditor
          materialDefinition={materialDefinition}
          shaderDefinition={shaderDefinition}
          textureDefinitions={textureDefinitions}
          onChangeParameterValue={(parameter, value) => {
            const nextValues = { ...materialDefinition.parameterValues };
            if (value === null || parameterValueEqualsDefault(parameter, value)) {
              delete nextValues[parameter.parameterId];
            } else {
              nextValues[parameter.parameterId] = value;
            }
            onUpdateMaterialDefinition(materialDefinition.definitionId, {
              parameterValues: nextValues
            });
          }}
          onChangeTextureBinding={(parameter, textureDefinitionId) => {
            const nextBindings = { ...materialDefinition.textureBindings };
            if (!textureDefinitionId) {
              delete nextBindings[parameter.parameterId];
            } else {
              nextBindings[parameter.parameterId] = textureDefinitionId;
            }
            onUpdateMaterialDefinition(materialDefinition.definitionId, {
              textureBindings: nextBindings
            });
          }}
        />
      </Stack>
      <Button
        size="xs"
        color="red"
        variant="subtle"
        disabled={isReferenced}
        onClick={() => onRemoveMaterialDefinition(materialDefinition.definitionId)}
      >
        Remove Material
      </Button>
      {isReferenced ? (
        <Text size="xs" c="var(--sm-color-overlay0)">
          Remove this material from landscape channels and asset slots before deleting it.
        </Text>
      ) : null}
    </Stack>
  );
}
