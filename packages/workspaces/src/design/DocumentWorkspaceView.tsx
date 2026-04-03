import { useMemo, useState } from "react";
import {
  ActionIcon,
  Box,
  Group,
  Menu,
  ScrollArea,
  Select,
  Stack,
  Text,
  TextInput,
  Textarea,
  Tooltip
} from "@mantine/core";
import type {
  DocumentDefinition,
  DocumentTemplate,
  SemanticCommand
} from "@sugarmagic/domain";
import { createDefaultDocumentDefinition } from "@sugarmagic/domain";
import { Inspector } from "@sugarmagic/ui";
import type { WorkspaceViewContribution } from "../workspace-view";

export interface DocumentWorkspaceViewProps {
  isActive: boolean;
  gameProjectId: string | null;
  documentDefinitions: DocumentDefinition[];
  onCommand: (command: SemanticCommand) => void;
}

const templateOptions: Array<{ value: DocumentTemplate; label: string }> = [
  { value: "book", label: "Book" },
  { value: "newspaper", label: "Newspaper" },
  { value: "letter", label: "Letter" },
  { value: "postcard", label: "Postcard" },
  { value: "flyer", label: "Flyer" },
  { value: "sign", label: "Sign" },
  { value: "plaque", label: "Plaque" }
];

export function useDocumentWorkspaceView(
  props: DocumentWorkspaceViewProps
): WorkspaceViewContribution {
  const { gameProjectId, documentDefinitions, onCommand } = props;
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(
    documentDefinitions[0]?.definitionId ?? null
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    definitionId: string;
  } | null>(null);

  const effectiveSelectedDocumentId = useMemo(() => {
    if (documentDefinitions.length === 0) return null;
    if (
      selectedDocumentId &&
      documentDefinitions.some((definition) => definition.definitionId === selectedDocumentId)
    ) {
      return selectedDocumentId;
    }
    return documentDefinitions[0]?.definitionId ?? null;
  }, [documentDefinitions, selectedDocumentId]);

  const selectedDocument = useMemo(
    () =>
      documentDefinitions.find(
        (definition) => definition.definitionId === effectiveSelectedDocumentId
      ) ?? null,
    [documentDefinitions, effectiveSelectedDocumentId]
  );

  const filteredDocuments = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return documentDefinitions;
    return documentDefinitions.filter(
      (definition) =>
        definition.displayName.toLowerCase().includes(query) ||
        (definition.subtitle ?? "").toLowerCase().includes(query)
    );
  }, [documentDefinitions, searchQuery]);

  function createDocument() {
    if (!gameProjectId) return;
    const definition = createDefaultDocumentDefinition({
      displayName: `Document ${documentDefinitions.length + 1}`
    });
    onCommand({
      kind: "CreateDocumentDefinition",
      target: {
        aggregateKind: "game-project",
        aggregateId: gameProjectId
      },
      subject: {
        subjectKind: "document-definition",
        subjectId: definition.definitionId
      },
      payload: { definition }
    });
    setSelectedDocumentId(definition.definitionId);
  }

  function updateDocument(definition: DocumentDefinition) {
    if (!gameProjectId) return;
    onCommand({
      kind: "UpdateDocumentDefinition",
      target: {
        aggregateKind: "game-project",
        aggregateId: gameProjectId
      },
      subject: {
        subjectKind: "document-definition",
        subjectId: definition.definitionId
      },
      payload: { definition }
    });
  }

  function deleteDocument(definitionId: string) {
    if (!gameProjectId) return;
    onCommand({
      kind: "DeleteDocumentDefinition",
      target: {
        aggregateKind: "game-project",
        aggregateId: gameProjectId
      },
      subject: {
        subjectKind: "document-definition",
        subjectId: definitionId
      },
      payload: { definitionId }
    });
    setContextMenu(null);
    if (effectiveSelectedDocumentId === definitionId) {
      const remaining = documentDefinitions.filter(
        (definition) => definition.definitionId !== definitionId
      );
      setSelectedDocumentId(remaining[0]?.definitionId ?? null);
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
            Documents
          </Text>
          <Tooltip label="Add Document">
            <ActionIcon variant="subtle" size="sm" onClick={createDocument} aria-label="Add Document">
              +
            </ActionIcon>
          </Tooltip>
        </Group>
        <Box p="sm" style={{ borderBottom: "1px solid var(--sm-panel-border)" }}>
          <TextInput
            size="xs"
            placeholder="Search documents..."
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.currentTarget.value)}
          />
        </Box>
        <ScrollArea style={{ flex: 1, minHeight: 0 }}>
          <Stack gap={4} p="xs">
            {filteredDocuments.map((definition) => {
              const isSelected = effectiveSelectedDocumentId === definition.definitionId;
              return (
                <Box
                  key={definition.definitionId}
                  px="sm"
                  py="xs"
                  style={{
                    borderRadius: 8,
                    cursor: "pointer",
                    background: isSelected ? "var(--sm-active-bg)" : "transparent",
                    color: isSelected ? "var(--sm-accent-blue)" : "var(--sm-color-text)"
                  }}
                  onClick={() => setSelectedDocumentId(definition.definitionId)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setSelectedDocumentId(definition.definitionId);
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
                  <Text size="xs" c="var(--sm-color-overlay0)" truncate>
                    {templateOptions.find((option) => option.value === definition.template)?.label}
                  </Text>
                </Box>
              );
            })}
            {filteredDocuments.length === 0 && (
              <Text size="xs" c="var(--sm-color-overlay0)" p="md" ta="center">
                No documents yet.
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
                deleteDocument(contextMenu.definitionId);
              }}
            >
              Delete
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </Stack>
    ),

    centerPanel: (
      <Box
        style={{
          height: "100%",
          background: "var(--sm-color-bg)",
          padding: 24,
          overflow: "auto"
        }}
      >
        {selectedDocument ? (
          <Box
            style={{
              maxWidth: 880,
              margin: "0 auto",
              minHeight: "100%",
              border: "1px solid var(--sm-panel-border)",
              borderRadius: 18,
              background: "linear-gradient(180deg, rgba(36,36,54,0.98), rgba(24,24,37,0.98))",
              padding: 28,
              boxShadow: "0 18px 48px rgba(0,0,0,0.22)"
            }}
          >
            <Text size="xs" tt="uppercase" fw={700} c="var(--sm-accent-blue)">
              {selectedDocument.template}
            </Text>
            <Text size="2rem" fw={800} mt={8} mb={4}>
              {selectedDocument.displayName}
            </Text>
            {(selectedDocument.subtitle ?? "").trim().length > 0 && (
              <Text c="var(--sm-color-subtext)" mb="md">
                {selectedDocument.subtitle}
              </Text>
            )}
            <Group gap="md" mb="lg">
              {selectedDocument.author.trim().length > 0 && (
                <Text size="sm" c="var(--sm-color-overlay0)">
                  {selectedDocument.author}
                </Text>
              )}
              {selectedDocument.locationLine.trim().length > 0 && (
                <Text size="sm" c="var(--sm-color-overlay0)">
                  {selectedDocument.locationLine}
                </Text>
              )}
              {selectedDocument.dateLine.trim().length > 0 && (
                <Text size="sm" c="var(--sm-color-overlay0)">
                  {selectedDocument.dateLine}
                </Text>
              )}
            </Group>
            {selectedDocument.body.trim().length > 0 && (
              <Text style={{ whiteSpace: "pre-wrap", lineHeight: 1.75 }} mb="lg">
                {selectedDocument.body}
              </Text>
            )}
            {selectedDocument.pages.some((page) => page.trim().length > 0) && (
              <Stack gap="md" mb="lg">
                {selectedDocument.pages.map((page, index) =>
                  page.trim().length > 0 ? (
                    <Box
                      key={`page-${index}`}
                      p="md"
                      style={{
                        border: "1px solid var(--sm-panel-border)",
                        borderRadius: 12,
                        background: "rgba(255,255,255,0.02)"
                      }}
                    >
                      <Text size="xs" tt="uppercase" fw={700} c="var(--sm-color-subtext)" mb="xs">
                        Page {index + 1}
                      </Text>
                      <Text style={{ whiteSpace: "pre-wrap", lineHeight: 1.75 }}>{page}</Text>
                    </Box>
                  ) : null
                )}
              </Stack>
            )}
            {selectedDocument.sections.some(
              (section) => section.heading.trim().length > 0 || section.body.trim().length > 0
            ) && (
              <Stack gap="md">
                {selectedDocument.sections.map((section, index) =>
                  section.heading.trim().length > 0 || section.body.trim().length > 0 ? (
                    <Box
                      key={`section-${index}`}
                      p="md"
                      style={{
                        border: "1px solid var(--sm-panel-border)",
                        borderRadius: 12,
                        background: "rgba(255,255,255,0.02)"
                      }}
                    >
                      {section.heading.trim().length > 0 && (
                        <Text fw={700} mb="xs">
                          {section.heading}
                        </Text>
                      )}
                      <Text style={{ whiteSpace: "pre-wrap", lineHeight: 1.75 }}>{section.body}</Text>
                    </Box>
                  ) : null
                )}
              </Stack>
            )}
            {(selectedDocument.backBody.trim().length > 0 || selectedDocument.footer.trim().length > 0) && (
              <Box mt="lg" pt="md" style={{ borderTop: "1px solid var(--sm-panel-border)" }}>
                {selectedDocument.backBody.trim().length > 0 && (
                  <Text style={{ whiteSpace: "pre-wrap", lineHeight: 1.75 }} mb="sm">
                    {selectedDocument.backBody}
                  </Text>
                )}
                {selectedDocument.footer.trim().length > 0 && (
                  <Text size="sm" c="var(--sm-color-subtext)">
                    {selectedDocument.footer}
                  </Text>
                )}
              </Box>
            )}
          </Box>
        ) : (
          <Stack align="center" justify="center" h="100%" gap="md">
            <Text size="xl">📚</Text>
            <Text c="dimmed">Select a document to edit.</Text>
          </Stack>
        )}
      </Box>
    ),

    rightPanel: (
      <Inspector selectionLabel={selectedDocument?.displayName ?? "Document"} selectionIcon="📚">
        {selectedDocument ? (
          <Stack gap="lg">
            <Stack gap="xs">
              <Text size="xs" fw={600} tt="uppercase" c="var(--sm-color-subtext)">
                Identity
              </Text>
              <TextInput
                label="Display Name"
                size="xs"
                value={selectedDocument.displayName}
                onChange={(event) =>
                  updateDocument({ ...selectedDocument, displayName: event.currentTarget.value })
                }
              />
              <TextInput
                label="Subtitle"
                size="xs"
                value={selectedDocument.subtitle ?? ""}
                onChange={(event) =>
                  updateDocument({
                    ...selectedDocument,
                    subtitle:
                      event.currentTarget.value.trim().length > 0
                        ? event.currentTarget.value
                        : undefined
                  })
                }
              />
              <Select
                label="Template"
                size="xs"
                data={templateOptions}
                value={selectedDocument.template}
                onChange={(value) =>
                  value && updateDocument({ ...selectedDocument, template: value as DocumentTemplate })
                }
              />
            </Stack>

            <Stack gap="xs">
              <Text size="xs" fw={600} tt="uppercase" c="var(--sm-color-subtext)">
                Metadata
              </Text>
              <TextInput
                label="Author"
                size="xs"
                value={selectedDocument.author}
                onChange={(event) =>
                  updateDocument({ ...selectedDocument, author: event.currentTarget.value })
                }
              />
              <TextInput
                label="Location Line"
                size="xs"
                value={selectedDocument.locationLine}
                onChange={(event) =>
                  updateDocument({
                    ...selectedDocument,
                    locationLine: event.currentTarget.value
                  })
                }
              />
              <TextInput
                label="Date Line"
                size="xs"
                value={selectedDocument.dateLine}
                onChange={(event) =>
                  updateDocument({ ...selectedDocument, dateLine: event.currentTarget.value })
                }
              />
              <TextInput
                label="Footer"
                size="xs"
                value={selectedDocument.footer}
                onChange={(event) =>
                  updateDocument({ ...selectedDocument, footer: event.currentTarget.value })
                }
              />
            </Stack>

            <Stack gap="xs">
              <Text size="xs" fw={600} tt="uppercase" c="var(--sm-color-subtext)">
                Content
              </Text>
              <Textarea
                label="Body"
                size="xs"
                minRows={6}
                autosize
                value={selectedDocument.body}
                onChange={(event) =>
                  updateDocument({ ...selectedDocument, body: event.currentTarget.value })
                }
              />
              <Textarea
                label="Back Body"
                size="xs"
                minRows={4}
                autosize
                value={selectedDocument.backBody}
                onChange={(event) =>
                  updateDocument({ ...selectedDocument, backBody: event.currentTarget.value })
                }
              />
            </Stack>
          </Stack>
        ) : (
          <Text size="xs" c="var(--sm-color-overlay0)">
            No document selected.
          </Text>
        )}
      </Inspector>
    ),

    viewportOverlay: null
  };
}
