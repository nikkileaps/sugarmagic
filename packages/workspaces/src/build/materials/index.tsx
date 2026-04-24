/**
 * Build-mode material library workspace.
 *
 * Owns the canonical authoring surface for reusable MaterialDefinitions:
 * naming, parent-shader selection, parameter snapshots, and texture bindings.
 * The underlying source of truth still lives in the content library; this
 * workspace only edits that shared authored state.
 */

import { useEffect, useMemo, useState } from "react";
import {
  ActionIcon,
  Button,
  Menu,
  Modal,
  Select,
  Stack,
  Text,
  TextInput,
  UnstyledButton
} from "@mantine/core";
import type {
  MaterialDefinition,
  ShaderGraphDocument,
  ShaderParameter,
  ShaderParameterValue,
  TextureDefinition
} from "@sugarmagic/domain";
import { isBuiltInMaterialDefinition } from "@sugarmagic/domain";
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
  onDuplicateMaterialDefinition: (sourceDefinitionId: string) => string | null;
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
    onDuplicateMaterialDefinition,
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

  function handleCreateMaterial(): void {
    if (!defaultNewShaderId) {
      return;
    }
    const created = onCreateMaterialDefinition(defaultNewShaderId);
    if (created) {
      onSelectMaterialDefinition(created.definitionId);
    }
  }

  async function handleImportPbrSet(): Promise<void> {
    const created = await onImportPbrMaterial();
    if (created) {
      onSelectMaterialDefinition(created.definitionId);
    }
  }

  return {
    leftPanel: (
      <PanelSection
        title="Material Library"
        icon="🧱"
        actions={
          <Menu shadow="md" withinPortal position="bottom-end">
            <Menu.Target>
              <ActionIcon variant="subtle" size="sm" aria-label="Add material thing">
                ＋
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item disabled={!defaultNewShaderId} onClick={handleCreateMaterial}>
                New Material
              </Menu.Item>
              <Menu.Item onClick={() => void handleImportPbrSet()}>
                Import PBR Set
              </Menu.Item>
              <Menu.Item onClick={() => void onImportTextureDefinition()}>
                Import Texture
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        }
      >
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
            onDuplicateMaterialDefinition={onDuplicateMaterialDefinition}
            onSelectMaterialDefinition={onSelectMaterialDefinition}
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
  onDuplicateMaterialDefinition,
  onSelectMaterialDefinition,
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
  onDuplicateMaterialDefinition: (sourceDefinitionId: string) => string | null;
  onSelectMaterialDefinition: (definitionId: string) => void;
  onRemoveMaterialDefinition: (definitionId: string) => void;
}) {
  const [draftDisplayName, setDraftDisplayName] = useState(materialDefinition.displayName);
  // Deferred edit held open while the duplicate-to-edit confirmation modal
  // is visible. Set when the user attempts to mutate a built-in material:
  // the modal tells them we'll fork a copy, and if they confirm we replay
  // this patch against the newly-created duplicate.
  const [pendingBuiltInEdit, setPendingBuiltInEdit] = useState<
    Partial<MaterialDefinition> | null
  >(null);

  useEffect(() => {
    setDraftDisplayName(materialDefinition.displayName);
  }, [materialDefinition.definitionId, materialDefinition.displayName]);

  const isBuiltIn = isBuiltInMaterialDefinition(materialDefinition);

  /**
   * Intercept mutations on built-in materials. Instead of writing the patch
   * to the engine-owned definition (which would be discarded on the next
   * normalize pass anyway), queue the patch and open the confirmation
   * modal. On confirm we duplicate the built-in, select the copy, and
   * replay the patch against the new id.
   */
  function handleUpdate(patch: Partial<MaterialDefinition>): void {
    if (isBuiltIn) {
      setPendingBuiltInEdit(patch);
      return;
    }
    onUpdateMaterialDefinition(materialDefinition.definitionId, patch);
  }

  function confirmDuplicateAndApply(): void {
    const patch = pendingBuiltInEdit;
    if (!patch) {
      setPendingBuiltInEdit(null);
      return;
    }
    const newId = onDuplicateMaterialDefinition(materialDefinition.definitionId);
    setPendingBuiltInEdit(null);
    if (!newId) return;
    onSelectMaterialDefinition(newId);
    onUpdateMaterialDefinition(newId, patch);
  }

  return (
    <Stack gap="md">
      <Modal
        opened={pendingBuiltInEdit !== null}
        onClose={() => setPendingBuiltInEdit(null)}
        title="Duplicate to edit?"
        size="sm"
        centered
        withinPortal
      >
        <Stack gap="sm">
          <Text size="sm">
            <Text component="span" fw={600}>
              {materialDefinition.displayName}
            </Text>
            {" "}is a built-in material. Built-ins can&apos;t be edited directly — they
            refresh from the engine on every project load.
          </Text>
          <Text size="sm" c="var(--sm-color-subtext)">
            Create a copy to edit? Existing bindings on scatter layers, assets,
            and landscape channels will keep pointing at the built-in until you
            re-bind them to the copy.
          </Text>
          <Stack gap="xs">
            <Button size="xs" onClick={confirmDuplicateAndApply}>
              Duplicate &amp; edit
            </Button>
            <Button size="xs" variant="subtle" onClick={() => setPendingBuiltInEdit(null)}>
              Cancel
            </Button>
          </Stack>
        </Stack>
      </Modal>
      {isBuiltIn ? (
        <Text size="xs" c="var(--sm-color-overlay0)">
          Built-in material. Edits will prompt to duplicate into a local copy.
        </Text>
      ) : null}
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
          handleUpdate({
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
          handleUpdate({
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
            handleUpdate({
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
            handleUpdate({
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
