import { useEffect, useMemo, useState } from "react";
import {
  ActionIcon,
  Box,
  Checkbox,
  Group,
  Menu,
  NumberInput,
  ScrollArea,
  Select,
  Stack,
  Text,
  TextInput,
  Textarea,
  Tooltip
} from "@mantine/core";
import type {
  AssetDefinition,
  DocumentDefinition,
  ItemCategory,
  ItemDefinition,
  ItemViewKind,
  SemanticCommand
} from "@sugarmagic/domain";
import type {
  DesignPreviewState,
  DesignPreviewStore
} from "@sugarmagic/shell";
import { createDefaultItemDefinition } from "@sugarmagic/domain";
import { Inspector } from "@sugarmagic/ui";
import type { WorkspaceViewContribution } from "../workspace-view";
import { LayoutOrientationWidget } from "../build/layout/LayoutOrientationWidget";
import { useVanillaStoreSelector } from "../use-vanilla-store";

export interface ItemWorkspaceViewProps {
  isActive: boolean;
  gameProjectId: string | null;
  itemDefinitions: ItemDefinition[];
  documentDefinitions: DocumentDefinition[];
  assetDefinitions: AssetDefinition[];
  designPreviewStore: DesignPreviewStore;
  onCommand: (command: SemanticCommand) => void;
}

const IDENTITY_QUATERNION: [number, number, number, number] = [0, 0, 0, 1];

function toAssetOptions(assetDefinitions: AssetDefinition[]) {
  return assetDefinitions.map((definition) => ({
    value: definition.definitionId,
    label: definition.displayName
  }));
}

function toDocumentOptions(documentDefinitions: DocumentDefinition[]) {
  return documentDefinitions.map((definition) => ({
    value: definition.definitionId,
    label: definition.displayName
  }));
}

const categoryOptions: Array<{ value: ItemCategory; label: string }> = [
  { value: "misc", label: "Misc" },
  { value: "quest", label: "Quest" },
  { value: "gift", label: "Gift" },
  { value: "key", label: "Key" }
];

const viewKindOptions: Array<{ value: ItemViewKind; label: string }> = [
  { value: "none", label: "None" },
  { value: "readable", label: "Readable" },
  { value: "examine", label: "Examine" },
  { value: "consumable", label: "Consumable" }
];

export function useItemWorkspaceView(
  props: ItemWorkspaceViewProps
): WorkspaceViewContribution {
  const {
    isActive,
    gameProjectId,
    itemDefinitions,
    documentDefinitions,
    assetDefinitions,
    designPreviewStore,
    onCommand
  } = props;

  const [selectedItemId, setSelectedItemId] = useState<string | null>(
    itemDefinitions[0]?.definitionId ?? null
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    definitionId: string;
  } | null>(null);
  const cameraQuaternion = useVanillaStoreSelector(
    designPreviewStore,
    (state: DesignPreviewState) =>
      state.cameraFraming?.quaternion ?? IDENTITY_QUATERNION
  );

  const effectiveSelectedItemId = useMemo(() => {
    if (itemDefinitions.length === 0) return null;
    if (
      selectedItemId &&
      itemDefinitions.some((definition) => definition.definitionId === selectedItemId)
    ) {
      return selectedItemId;
    }
    return itemDefinitions[0]!.definitionId;
  }, [itemDefinitions, selectedItemId]);

  const selectedItem = useMemo(
    () =>
      itemDefinitions.find(
        (definition) => definition.definitionId === effectiveSelectedItemId
      ) ?? null,
    [effectiveSelectedItemId, itemDefinitions]
  );

  useEffect(() => {
    if (!isActive || !selectedItem) return;
    designPreviewStore.getState().beginPreview(selectedItem.definitionId);
    return () => {
      designPreviewStore.getState().endPreview();
    };
  }, [designPreviewStore, isActive, selectedItem]);

  const filteredItems = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return itemDefinitions;
    return itemDefinitions.filter((definition) =>
      definition.displayName.toLowerCase().includes(query)
    );
  }, [itemDefinitions, searchQuery]);

  const assetOptions = useMemo(() => toAssetOptions(assetDefinitions), [assetDefinitions]);
  const documentOptions = useMemo(
    () => toDocumentOptions(documentDefinitions),
    [documentDefinitions]
  );

  function createItem() {
    if (!gameProjectId) return;
    const nextDefinition = createDefaultItemDefinition({
      displayName: `Item ${itemDefinitions.length + 1}`
    });
    onCommand({
      kind: "CreateItemDefinition",
      target: {
        aggregateKind: "game-project",
        aggregateId: gameProjectId
      },
      subject: {
        subjectKind: "item-definition",
        subjectId: nextDefinition.definitionId
      },
      payload: {
        definition: nextDefinition
      }
    });
    setSelectedItemId(nextDefinition.definitionId);
  }

  function updateItem(nextDefinition: ItemDefinition) {
    if (!gameProjectId) return;
    onCommand({
      kind: "UpdateItemDefinition",
      target: {
        aggregateKind: "game-project",
        aggregateId: gameProjectId
      },
      subject: {
        subjectKind: "item-definition",
        subjectId: nextDefinition.definitionId
      },
      payload: {
        definition: nextDefinition
      }
    });
  }

  function deleteItem(definitionId: string) {
    if (!gameProjectId) return;
    onCommand({
      kind: "DeleteItemDefinition",
      target: {
        aggregateKind: "game-project",
        aggregateId: gameProjectId
      },
      subject: {
        subjectKind: "item-definition",
        subjectId: definitionId
      },
      payload: {
        definitionId
      }
    });
    setContextMenu(null);
    if (effectiveSelectedItemId === definitionId) {
      const remaining = itemDefinitions.filter(
        (definition) => definition.definitionId !== definitionId
      );
      setSelectedItemId(remaining[0]?.definitionId ?? null);
    }
  }

  return {
    leftPanel: (
      <Stack gap={0} h="100%" style={{ minHeight: 0 }} onClick={() => setContextMenu(null)}>
        <Group
          justify="space-between"
          px="md"
          py="sm"
          style={{
            borderBottom: "1px solid var(--sm-panel-border)",
            color: "var(--sm-color-subtext)"
          }}
        >
          <Text size="xs" fw={600} tt="uppercase">
            Items
          </Text>
          <Tooltip label="Add Item">
            <ActionIcon variant="subtle" size="sm" onClick={createItem} aria-label="Add Item">
              +
            </ActionIcon>
          </Tooltip>
        </Group>
        <Box p="sm" style={{ borderBottom: "1px solid var(--sm-panel-border)" }}>
          <TextInput
            size="xs"
            placeholder="Search items..."
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.currentTarget.value)}
          />
        </Box>
        <ScrollArea style={{ flex: 1, minHeight: 0 }}>
          <Stack gap={4} p="xs">
            {filteredItems.map((definition) => {
              const isSelected = effectiveSelectedItemId === definition.definitionId;
              return (
                <Box
                  key={definition.definitionId}
                  px="sm"
                  py="xs"
                  style={{
                    borderRadius: 8,
                    cursor: "pointer",
                    background: isSelected ? "var(--sm-active-bg)" : "transparent",
                    color: isSelected
                      ? "var(--sm-accent-blue)"
                      : "var(--sm-color-text)"
                  }}
                  onClick={() => setSelectedItemId(definition.definitionId)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setSelectedItemId(definition.definitionId);
                    setContextMenu({
                      x: event.clientX,
                      y: event.clientY,
                      definitionId: definition.definitionId
                    });
                  }}
                >
                  <Text size="sm" fw={500} truncate>
                    {definition.displayName}
                  </Text>
                </Box>
              );
            })}
            {filteredItems.length === 0 && (
              <Text size="xs" c="var(--sm-color-overlay0)" p="md" ta="center">
                No items yet.
              </Text>
            )}
          </Stack>
        </ScrollArea>
        <Menu
          opened={Boolean(contextMenu)}
          onChange={(opened) => {
            if (!opened) setContextMenu(null);
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
            <Menu.Item
              color="red"
              onClick={() => {
                if (!contextMenu) return;
                deleteItem(contextMenu.definitionId);
              }}
            >
              Delete
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </Stack>
    ),

    rightPanel: (
      <Inspector
        selectionLabel={selectedItem?.displayName ?? "Item"}
        selectionIcon="📦"
      >
        {selectedItem ? (
          <Stack gap="lg">
            <Stack gap="xs">
              <Text size="xs" fw={600} tt="uppercase" c="var(--sm-color-subtext)">
                Identity
              </Text>
              <TextInput
                label="Display Name"
                size="xs"
                value={selectedItem.displayName}
                onChange={(event) =>
                  updateItem({
                    ...selectedItem,
                    displayName: event.currentTarget.value
                  })
                }
              />
              <Textarea
                label="Description"
                size="xs"
                minRows={3}
                autosize
                value={selectedItem.description ?? ""}
                onChange={(event) =>
                  updateItem({
                    ...selectedItem,
                    description: event.currentTarget.value.trim().length > 0
                      ? event.currentTarget.value
                      : undefined
                  })
                }
              />
              <Select
                label="Category"
                size="xs"
                data={categoryOptions}
                value={selectedItem.category}
                onChange={(value) =>
                  value &&
                  updateItem({
                    ...selectedItem,
                    category: value as ItemCategory
                  })
                }
              />
            </Stack>

            <Stack gap="xs">
              <Text size="xs" fw={600} tt="uppercase" c="var(--sm-color-subtext)">
                Inventory
              </Text>
              <Checkbox
                label="Stackable"
                checked={selectedItem.inventory.stackable}
                onChange={(event) =>
                  updateItem({
                    ...selectedItem,
                    inventory: {
                      ...selectedItem.inventory,
                      stackable: event.currentTarget.checked,
                      maxStack: event.currentTarget.checked
                        ? Math.max(2, selectedItem.inventory.maxStack)
                        : 1
                    }
                  })
                }
              />
              <NumberInput
                label="Max Stack"
                size="xs"
                min={1}
                max={999}
                disabled={!selectedItem.inventory.stackable}
                value={selectedItem.inventory.maxStack}
                onChange={(value) => {
                  if (typeof value !== "number") return;
                  updateItem({
                    ...selectedItem,
                    inventory: {
                      ...selectedItem.inventory,
                      maxStack: Math.max(1, Math.floor(value))
                    }
                  });
                }}
              />
              <Checkbox
                label="Giftable"
                checked={selectedItem.inventory.giftable}
                onChange={(event) =>
                  updateItem({
                    ...selectedItem,
                    inventory: {
                      ...selectedItem.inventory,
                      giftable: event.currentTarget.checked
                    }
                  })
                }
              />
            </Stack>

            <Stack gap="xs">
              <Text size="xs" fw={600} tt="uppercase" c="var(--sm-color-subtext)">
                Model
              </Text>
              <Select
                label="Model Asset"
                size="xs"
                clearable
                data={assetOptions}
                value={selectedItem.presentation.modelAssetDefinitionId}
                onChange={(value) =>
                  updateItem({
                    ...selectedItem,
                    presentation: {
                      ...selectedItem.presentation,
                      modelAssetDefinitionId: value
                    }
                  })
                }
              />
              <NumberInput
                label="Model Height"
                size="xs"
                min={0.1}
                max={4}
                step={0.05}
                value={selectedItem.presentation.modelHeight}
                onChange={(value) => {
                  if (typeof value !== "number") return;
                  updateItem({
                    ...selectedItem,
                    presentation: {
                      ...selectedItem.presentation,
                      modelHeight: value
                    }
                  });
                }}
              />
            </Stack>

            <Stack gap="xs">
              <Text size="xs" fw={600} tt="uppercase" c="var(--sm-color-subtext)">
                Interaction View
              </Text>
              <Select
                label="View Type"
                size="xs"
                data={viewKindOptions}
                value={selectedItem.interactionView.kind}
                onChange={(value) =>
                  value &&
                  updateItem({
                    ...selectedItem,
                    interactionView: {
                      ...selectedItem.interactionView,
                      kind: value as ItemViewKind,
                      documentDefinitionId:
                        value === "readable"
                          ? selectedItem.interactionView.documentDefinitionId ??
                            documentDefinitions[0]?.definitionId ??
                            null
                          : selectedItem.interactionView.documentDefinitionId
                    }
                  })
                }
              />
              {(selectedItem.interactionView.kind === "examine" ||
                selectedItem.interactionView.kind === "consumable") && (
                <TextInput
                  label="View Title"
                  size="xs"
                  value={selectedItem.interactionView.title}
                  onChange={(event) =>
                    updateItem({
                      ...selectedItem,
                      interactionView: {
                        ...selectedItem.interactionView,
                        title: event.currentTarget.value
                      }
                    })
                  }
                />
              )}

              {selectedItem.interactionView.kind === "readable" && (
                <>
                  <Select
                    label="Document"
                    size="xs"
                    searchable
                    data={documentOptions}
                    value={selectedItem.interactionView.documentDefinitionId}
                    onChange={(value) => {
                      if (!value) return;
                      updateItem({
                        ...selectedItem,
                        interactionView: {
                          ...selectedItem.interactionView,
                          documentDefinitionId: value
                        }
                      });
                    }}
                  />
                  {documentDefinitions.length === 0 ? (
                    <Text size="xs" c="var(--sm-color-overlay0)">
                      Create a document in Design &gt; Documents, then bind it here.
                    </Text>
                  ) : (
                    <Text size="xs" c="var(--sm-color-overlay0)">
                      Readable items now open a shared document definition. Edit the
                      actual content in Design &gt; Documents.
                    </Text>
                  )}
                </>
              )}

              {(selectedItem.interactionView.kind === "examine" ||
                selectedItem.interactionView.kind === "consumable") && (
                <Textarea
                  label="View Body"
                  size="xs"
                  minRows={5}
                  autosize
                  value={selectedItem.interactionView.body}
                  onChange={(event) =>
                    updateItem({
                      ...selectedItem,
                      interactionView: {
                        ...selectedItem.interactionView,
                        body: event.currentTarget.value
                      }
                    })
                  }
                />
              )}
              {selectedItem.interactionView.kind === "consumable" && (
                <TextInput
                  label="Consume Label"
                  size="xs"
                  value={selectedItem.interactionView.consumeLabel}
                  onChange={(event) =>
                    updateItem({
                      ...selectedItem,
                      interactionView: {
                        ...selectedItem.interactionView,
                        consumeLabel: event.currentTarget.value
                      }
                    })
                  }
                />
              )}
            </Stack>
          </Stack>
        ) : (
          <Text size="xs" c="var(--sm-color-overlay0)">
            No item selected.
          </Text>
        )}
      </Inspector>
    ),

    viewportOverlay: isActive && selectedItem ? (
      <LayoutOrientationWidget quaternion={cameraQuaternion} />
    ) : null
  };
}
