import { useEffect, useMemo, useRef, useState } from "react";
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
  ContentLibrarySnapshot,
  ItemCategory,
  ItemDefinition,
  ItemReadableTemplate,
  ItemViewKind,
  SemanticCommand
} from "@sugarmagic/domain";
import { createDefaultItemDefinition, createDefaultReadableDocument } from "@sugarmagic/domain";
import { Inspector } from "@sugarmagic/ui";
import type { WorkspaceViewContribution } from "../workspace-view";
import type { ItemWorkspaceViewport } from "../viewport";
import { LayoutOrientationWidget } from "../build/layout/LayoutOrientationWidget";
import { createItemCameraController } from "./item-camera-controller";

export interface ItemWorkspaceViewProps {
  isActive: boolean;
  viewportReadyVersion: number;
  gameProjectId: string | null;
  itemDefinitions: ItemDefinition[];
  contentLibrary: ContentLibrarySnapshot | null;
  assetDefinitions: AssetDefinition[];
  assetSources: Record<string, string>;
  getViewport: () => ItemWorkspaceViewport | null;
  getViewportElement: () => HTMLElement | null;
  onCommand: (command: SemanticCommand) => void;
}

function toAssetOptions(assetDefinitions: AssetDefinition[]) {
  return assetDefinitions.map((definition) => ({
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

const readableTemplateOptions: Array<{ value: ItemReadableTemplate; label: string }> = [
  { value: "book", label: "Book" },
  { value: "newspaper", label: "Newspaper" },
  { value: "letter", label: "Letter" },
  { value: "postcard", label: "Postcard" },
  { value: "flyer", label: "Flyer" }
];

export function useItemWorkspaceView(
  props: ItemWorkspaceViewProps
): WorkspaceViewContribution {
  const {
    isActive,
    viewportReadyVersion,
    gameProjectId,
    itemDefinitions,
    contentLibrary,
    assetDefinitions,
    assetSources,
    getViewport,
    getViewportElement,
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
  const [cameraQuaternion, setCameraQuaternion] =
    useState<[number, number, number, number]>([0, 0, 0, 1]);
  const cameraControllerRef = useRef(createItemCameraController());
  const getViewportRef = useRef(getViewport);
  const getViewportElementRef = useRef(getViewportElement);

  useEffect(() => {
    getViewportRef.current = getViewport;
    getViewportElementRef.current = getViewportElement;
  }, [getViewport, getViewportElement]);

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

  const filteredItems = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return itemDefinitions;
    return itemDefinitions.filter((definition) =>
      definition.displayName.toLowerCase().includes(query)
    );
  }, [itemDefinitions, searchQuery]);

  const assetOptions = useMemo(() => toAssetOptions(assetDefinitions), [assetDefinitions]);

  function updateReadableDocument(
    definition: ItemDefinition,
    patch: Partial<ItemDefinition["interactionView"]["readableDocument"]>
  ) {
    updateItem({
      ...definition,
      interactionView: {
        ...definition.interactionView,
        readableDocument: {
          ...definition.interactionView.readableDocument,
          ...patch
        }
      }
    });
  }

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

  useEffect(() => {
    if (!isActive || !selectedItem) return;

    const viewport = getViewportRef.current();
    const viewportElement = getViewportElementRef.current();
    if (!viewport || !viewportElement) return;

    const targetY = Math.max(selectedItem.presentation.modelHeight * 0.5, 0.2);
    const cameraController = cameraControllerRef.current;
    cameraController.attach(
      viewport.camera,
      viewportElement,
      viewport.subscribeFrame,
      targetY
    );

    return () => {
      cameraController.detach();
    };
  }, [isActive, viewportReadyVersion, selectedItem]);

  useEffect(() => {
    if (!isActive || !selectedItem) return;
    cameraControllerRef.current.updateTarget(
      Math.max(selectedItem.presentation.modelHeight * 0.5, 0.2)
    );
  }, [isActive, selectedItem]);

  useEffect(() => {
    if (!isActive) return;
    const viewport = getViewportRef.current();
    if (!viewport) return;

    const syncOrientation = () => {
      const current = viewport.camera.quaternion;
      setCameraQuaternion([current.x, current.y, current.z, current.w]);
    };

    syncOrientation();
    return viewport.subscribeFrame(syncOrientation);
  }, [isActive, viewportReadyVersion]);

  useEffect(() => {
    if (!isActive || !selectedItem || !contentLibrary) return;
    const viewport = getViewportRef.current();
    if (!viewport) return;

    viewport.updateFromItem({
      itemDefinition: selectedItem,
      contentLibrary,
      assetSources
    });
  }, [assetSources, contentLibrary, isActive, selectedItem]);

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
                      readableDocument:
                        value === "readable"
                          ? selectedItem.interactionView.readableDocument ??
                            createDefaultReadableDocument()
                          : selectedItem.interactionView.readableDocument
                    }
                  })
                }
              />
              {(selectedItem.interactionView.kind === "readable" ||
                selectedItem.interactionView.kind === "examine" ||
                selectedItem.interactionView.kind === "consumable") && (
                <TextInput
                  label={
                    selectedItem.interactionView.kind === "readable"
                      ? "Document Title"
                      : "View Title"
                  }
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
                    label="Readable Template"
                    size="xs"
                    data={readableTemplateOptions}
                    value={selectedItem.interactionView.readableDocument.template}
                    onChange={(value) => {
                      if (!value) return;
                      updateReadableDocument(selectedItem, {
                        ...createDefaultReadableDocument(value as ItemReadableTemplate),
                        template: value as ItemReadableTemplate,
                        subtitle: selectedItem.interactionView.readableDocument.subtitle,
                        author: selectedItem.interactionView.readableDocument.author,
                        locationLine:
                          selectedItem.interactionView.readableDocument.locationLine,
                        dateLine: selectedItem.interactionView.readableDocument.dateLine
                      });
                    }}
                  />
                  <TextInput
                    label="Subtitle"
                    size="xs"
                    value={selectedItem.interactionView.readableDocument.subtitle}
                    onChange={(event) =>
                      updateReadableDocument(selectedItem, {
                        subtitle: event.currentTarget.value
                      })
                    }
                  />
                  <TextInput
                    label="Author"
                    size="xs"
                    value={selectedItem.interactionView.readableDocument.author}
                    onChange={(event) =>
                      updateReadableDocument(selectedItem, {
                        author: event.currentTarget.value
                      })
                    }
                  />
                  <Group grow>
                    <TextInput
                      label="Location Line"
                      size="xs"
                      value={selectedItem.interactionView.readableDocument.locationLine}
                      onChange={(event) =>
                        updateReadableDocument(selectedItem, {
                          locationLine: event.currentTarget.value
                        })
                      }
                    />
                    <TextInput
                      label="Date Line"
                      size="xs"
                      value={selectedItem.interactionView.readableDocument.dateLine}
                      onChange={(event) =>
                        updateReadableDocument(selectedItem, {
                          dateLine: event.currentTarget.value
                        })
                      }
                    />
                  </Group>

                  {selectedItem.interactionView.readableDocument.template === "book" && (
                    <>
                      <Textarea
                        label="Cover Blurb"
                        size="xs"
                        minRows={3}
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
                      <Stack gap="xs">
                        <Group justify="space-between">
                          <Text size="xs" fw={600} c="var(--sm-color-subtext)">
                            Pages
                          </Text>
                          <ActionIcon
                            variant="subtle"
                            size="sm"
                            aria-label="Add Page"
                            onClick={() =>
                              updateReadableDocument(selectedItem, {
                                pages: [
                                  ...selectedItem.interactionView.readableDocument.pages,
                                  ""
                                ]
                              })
                            }
                          >
                            +
                          </ActionIcon>
                        </Group>
                        {selectedItem.interactionView.readableDocument.pages.map((page, index) => (
                          <Box
                            key={`page-${index}`}
                            p="xs"
                            style={{
                              border: "1px solid var(--sm-panel-border)",
                              borderRadius: 8
                            }}
                          >
                            <Group justify="space-between" mb={6}>
                              <Text size="xs" fw={500}>
                                Page {index + 1}
                              </Text>
                              <ActionIcon
                                variant="subtle"
                                size="sm"
                                color="red"
                                disabled={
                                  selectedItem.interactionView.readableDocument.pages.length <= 1
                                }
                                aria-label={`Remove Page ${index + 1}`}
                                onClick={() =>
                                  updateReadableDocument(selectedItem, {
                                    pages:
                                      selectedItem.interactionView.readableDocument.pages.filter(
                                        (_page, pageIndex) => pageIndex !== index
                                      ) || [""]
                                  })
                                }
                              >
                                -
                              </ActionIcon>
                            </Group>
                            <Textarea
                              size="xs"
                              minRows={5}
                              autosize
                              value={page}
                              onChange={(event) =>
                                updateReadableDocument(selectedItem, {
                                  pages:
                                    selectedItem.interactionView.readableDocument.pages.map(
                                      (currentPage, pageIndex) =>
                                        pageIndex === index
                                          ? event.currentTarget.value
                                          : currentPage
                                    )
                                })
                              }
                            />
                          </Box>
                        ))}
                      </Stack>
                    </>
                  )}

                  {selectedItem.interactionView.readableDocument.template === "newspaper" && (
                    <>
                      <Textarea
                        label="Banner Copy"
                        size="xs"
                        minRows={2}
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
                      <TextInput
                        label="Edition Note"
                        size="xs"
                        value={selectedItem.interactionView.readableDocument.footer}
                        onChange={(event) =>
                          updateReadableDocument(selectedItem, {
                            footer: event.currentTarget.value
                          })
                        }
                      />
                      <Stack gap="xs">
                        <Group justify="space-between">
                          <Text size="xs" fw={600} c="var(--sm-color-subtext)">
                            Articles
                          </Text>
                          <ActionIcon
                            variant="subtle"
                            size="sm"
                            aria-label="Add Article"
                            onClick={() =>
                              updateReadableDocument(selectedItem, {
                                sections: [
                                  ...selectedItem.interactionView.readableDocument.sections,
                                  { heading: "", body: "" }
                                ]
                              })
                            }
                          >
                            +
                          </ActionIcon>
                        </Group>
                        {selectedItem.interactionView.readableDocument.sections.map(
                          (section, index) => (
                            <Box
                              key={`article-${index}`}
                              p="xs"
                              style={{
                                border: "1px solid var(--sm-panel-border)",
                                borderRadius: 8
                              }}
                            >
                              <Group justify="space-between" mb={6}>
                                <Text size="xs" fw={500}>
                                  Article {index + 1}
                                </Text>
                                <ActionIcon
                                  variant="subtle"
                                  size="sm"
                                  color="red"
                                  disabled={
                                    selectedItem.interactionView.readableDocument.sections
                                      .length <= 1
                                  }
                                  aria-label={`Remove Article ${index + 1}`}
                                  onClick={() =>
                                    updateReadableDocument(selectedItem, {
                                      sections:
                                        selectedItem.interactionView.readableDocument.sections.filter(
                                          (_section, sectionIndex) => sectionIndex !== index
                                        ) || [{ heading: "", body: "" }]
                                    })
                                  }
                                >
                                  -
                                </ActionIcon>
                              </Group>
                              <Stack gap="xs">
                                <TextInput
                                  label="Headline"
                                  size="xs"
                                  value={section.heading}
                                  onChange={(event) =>
                                    updateReadableDocument(selectedItem, {
                                      sections:
                                        selectedItem.interactionView.readableDocument.sections.map(
                                          (currentSection, sectionIndex) =>
                                            sectionIndex === index
                                              ? {
                                                  ...currentSection,
                                                  heading: event.currentTarget.value
                                                }
                                              : currentSection
                                        )
                                    })
                                  }
                                />
                                <Textarea
                                  label="Body"
                                  size="xs"
                                  minRows={4}
                                  autosize
                                  value={section.body}
                                  onChange={(event) =>
                                    updateReadableDocument(selectedItem, {
                                      sections:
                                        selectedItem.interactionView.readableDocument.sections.map(
                                          (currentSection, sectionIndex) =>
                                            sectionIndex === index
                                              ? {
                                                  ...currentSection,
                                                  body: event.currentTarget.value
                                                }
                                              : currentSection
                                        )
                                    })
                                  }
                                />
                              </Stack>
                            </Box>
                          )
                        )}
                      </Stack>
                    </>
                  )}

                  {selectedItem.interactionView.readableDocument.template === "letter" && (
                    <>
                      <Textarea
                        label="Letter Body"
                        size="xs"
                        minRows={6}
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
                      <TextInput
                        label="Sign-off"
                        size="xs"
                        value={selectedItem.interactionView.readableDocument.footer}
                        onChange={(event) =>
                          updateReadableDocument(selectedItem, {
                            footer: event.currentTarget.value
                          })
                        }
                      />
                    </>
                  )}

                  {selectedItem.interactionView.readableDocument.template === "postcard" && (
                    <>
                      <Textarea
                        label="Front Message"
                        size="xs"
                        minRows={4}
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
                      <Textarea
                        label="Back Message"
                        size="xs"
                        minRows={4}
                        autosize
                        value={selectedItem.interactionView.readableDocument.backBody}
                        onChange={(event) =>
                          updateReadableDocument(selectedItem, {
                            backBody: event.currentTarget.value
                          })
                        }
                      />
                    </>
                  )}

                  {selectedItem.interactionView.readableDocument.template === "flyer" && (
                    <>
                      <Textarea
                        label="Body Copy"
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
                      <TextInput
                        label="Footer / Call To Action"
                        size="xs"
                        value={selectedItem.interactionView.readableDocument.footer}
                        onChange={(event) =>
                          updateReadableDocument(selectedItem, {
                            footer: event.currentTarget.value
                          })
                        }
                      />
                    </>
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
