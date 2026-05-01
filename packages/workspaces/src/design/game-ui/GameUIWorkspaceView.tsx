/**
 * Structured-form authoring workspace for project-owned game UI.
 *
 * This workspace edits MenuDefinition/HUDDefinition/UITheme domain data only.
 * The center preview is supplied by Studio and embeds the target-web preview
 * entry point, preserving target rendering as the single source of truth.
 */

import { useMemo, useState } from "react";
import {
  ActionIcon,
  Box,
  Button,
  Group,
  NumberInput,
  ScrollArea,
  Select,
  Stack,
  Text,
  TextInput
} from "@mantine/core";
import type {
  HUDDefinition,
  MenuDefinition,
  SemanticCommand,
  UIBindingExpression,
  UITheme,
  UINode,
  UINodeKind
} from "@sugarmagic/domain";
import {
  createDefaultUILayoutProps,
  createUINode,
  literalUIValue,
  runtimeUIRef
} from "@sugarmagic/domain";
import { CssColorField, Inspector } from "@sugarmagic/ui";
import type { WorkspaceViewContribution } from "../../workspace-view";

type Selection =
  | { kind: "menu"; definitionId: string; nodeId: string | null }
  | { kind: "hud"; nodeId: string | null }
  | { kind: "theme" };

export interface GameUIWorkspaceViewProps {
  isActive: boolean;
  gameProjectId: string | null;
  menuDefinitions: MenuDefinition[];
  hudDefinition: HUDDefinition | null;
  uiTheme: UITheme;
  onCommand: (command: SemanticCommand) => void;
  renderPreview: (options: { initialVisibleMenuKey: string | null }) => React.ReactNode;
}

const nodeKindOptions: Array<{ value: UINodeKind; label: string }> = [
  { value: "container", label: "Container" },
  { value: "text", label: "Text" },
  { value: "button", label: "Button" },
  { value: "image", label: "Image" },
  { value: "progress-bar", label: "Progress Bar" },
  { value: "spacer", label: "Spacer" }
];

function flattenNodes(root: UINode, depth = 0): Array<{ node: UINode; depth: number }> {
  return [
    { node: root, depth },
    ...root.children.flatMap((child) => flattenNodes(child, depth + 1))
  ];
}

function findNode(root: UINode, nodeId: string | null): UINode | null {
  if (!nodeId) return root;
  if (root.nodeId === nodeId) return root;
  for (const child of root.children) {
    const found = findNode(child, nodeId);
    if (found) return found;
  }
  return null;
}

function getBindingMode(expression: UIBindingExpression | undefined): "literal" | "runtime-ref" {
  return expression?.kind === "runtime-ref" ? "runtime-ref" : "literal";
}

function getBindingLiteral(expression: UIBindingExpression | undefined): string {
  if (!expression || expression.kind !== "literal") return "";
  return typeof expression.value === "string" ? expression.value : String(expression.value ?? "");
}

function getBindingPath(expression: UIBindingExpression | undefined): string {
  return expression?.kind === "runtime-ref" ? expression.path : "";
}

function createDefaultNode(kind: UINodeKind): UINode {
  if (kind === "text") {
    return createUINode(kind, {
      styleId: "body",
      props: { text: literalUIValue("Label") }
    });
  }
  if (kind === "button") {
    return createUINode(kind, {
      styleId: "button-primary",
      layout: createDefaultUILayoutProps({ padding: 12 }),
      props: { text: literalUIValue("Button") },
      events: { onClick: { action: "start-new-game" } }
    });
  }
  if (kind === "progress-bar") {
    return createUINode(kind, {
      props: {
        value: runtimeUIRef("player.battery"),
        min: literalUIValue(0),
        max: runtimeUIRef("player.maxBattery")
      }
    });
  }
  return createUINode(kind);
}

export function useGameUIWorkspaceView(
  props: GameUIWorkspaceViewProps
): WorkspaceViewContribution {
  const {
    gameProjectId,
    menuDefinitions,
    hudDefinition,
    uiTheme,
    onCommand,
    renderPreview
  } = props;
  const [selection, setSelection] = useState<Selection>(() => ({
    kind: "menu",
    definitionId: menuDefinitions[0]?.definitionId ?? "",
    nodeId: null
  }));

  const selectedMenu = useMemo(() => {
    if (selection.kind !== "menu") return null;
    return (
      menuDefinitions.find((definition) => definition.definitionId === selection.definitionId) ??
      menuDefinitions[0] ??
      null
    );
  }, [menuDefinitions, selection]);

  const selectedRoot =
    selection.kind === "hud" ? hudDefinition?.root ?? null : selectedMenu?.root ?? null;
  const selectedNode =
    selection.kind === "theme" ? null : selectedRoot ? findNode(selectedRoot, selection.nodeId) : null;

  function target() {
    return {
      aggregateKind: "game-project" as const,
      aggregateId: gameProjectId ?? ""
    };
  }

  function updateMenu(definition: MenuDefinition, patch: Partial<MenuDefinition>) {
    if (!gameProjectId) return;
    onCommand({
      kind: "UpdateMenuDefinition",
      target: target(),
      subject: { subjectKind: "menu-definition", subjectId: definition.definitionId },
      payload: { definitionId: definition.definitionId, patch }
    });
  }

  function updateSelectedNode(patch: SemanticCommand["payload"] & Record<string, unknown>) {
    if (!gameProjectId || selection.kind === "theme" || !selectedNode) return;
    if (selection.kind === "menu" && selectedMenu) {
      onCommand({
        kind: "UpdateMenuNode",
        target: target(),
        subject: { subjectKind: "ui-node", subjectId: selectedNode.nodeId },
        payload: {
          definitionId: selectedMenu.definitionId,
          nodeId: selectedNode.nodeId,
          patch: patch as never
        }
      });
      return;
    }
    onCommand({
      kind: "UpdateHUDNode",
      target: target(),
      subject: { subjectKind: "ui-node", subjectId: selectedNode.nodeId },
      payload: {
        nodeId: selectedNode.nodeId,
        patch: patch as never
      }
    });
  }

  function addChild(kind: UINodeKind) {
    if (!gameProjectId || selection.kind === "theme" || !selectedNode) return;
    const node = createDefaultNode(kind);
    if (selection.kind === "menu" && selectedMenu) {
      onCommand({
        kind: "AddMenuNode",
        target: target(),
        subject: { subjectKind: "ui-node", subjectId: node.nodeId },
        payload: {
          definitionId: selectedMenu.definitionId,
          parentNodeId: selectedNode.nodeId,
          node
        }
      });
      setSelection({ ...selection, nodeId: node.nodeId });
      return;
    }
    onCommand({
      kind: "AddHUDNode",
      target: target(),
      subject: { subjectKind: "ui-node", subjectId: node.nodeId },
      payload: { parentNodeId: selectedNode.nodeId, node }
    });
    setSelection({ kind: "hud", nodeId: node.nodeId });
  }

  function removeSelectedNode() {
    if (!gameProjectId || selection.kind === "theme" || !selectedNode || !selectedRoot) return;
    if (selectedNode.nodeId === selectedRoot.nodeId) return;
    if (selection.kind === "menu" && selectedMenu) {
      onCommand({
        kind: "RemoveMenuNode",
        target: target(),
        subject: { subjectKind: "ui-node", subjectId: selectedNode.nodeId },
        payload: {
          definitionId: selectedMenu.definitionId,
          nodeId: selectedNode.nodeId
        }
      });
      setSelection({ ...selection, nodeId: null });
      return;
    }
    onCommand({
      kind: "RemoveHUDNode",
      target: target(),
      subject: { subjectKind: "ui-node", subjectId: selectedNode.nodeId },
      payload: { nodeId: selectedNode.nodeId }
    });
    setSelection({ kind: "hud", nodeId: null });
  }

  function updateThemeToken(token: string, value: string) {
    if (!gameProjectId) return;
    onCommand({
      kind: "UpdateUITheme",
      target: target(),
      subject: { subjectKind: "ui-theme", subjectId: gameProjectId },
      payload: {
        theme: {
          ...uiTheme,
          tokens: { ...uiTheme.tokens, [token]: value }
        }
      }
    });
  }

  const styleOptions = [
    { value: "", label: "No Style" },
    ...uiTheme.styles.map((style) => ({
      value: style.styleId,
      label: style.displayName
    }))
  ];

  const leftPanel = (
    <ScrollArea h="100%">
      <Stack gap="xs" p="sm">
        <Group justify="space-between">
          <Text size="xs" fw={700} tt="uppercase" c="var(--sm-color-subtext)">
            Game UI
          </Text>
          <Button
            size="compact-xs"
            variant="light"
            onClick={() => setSelection({ kind: "theme" })}
          >
            Theme
          </Button>
        </Group>
        <Button
          variant={selection.kind === "hud" ? "light" : "subtle"}
          justify="flex-start"
          onClick={() => setSelection({ kind: "hud", nodeId: null })}
        >
          HUD
        </Button>
        <Text size="xs" fw={700} tt="uppercase" c="var(--sm-color-subtext)" mt="sm">
          Menus
        </Text>
        {menuDefinitions.map((menu) => (
          <Box key={menu.definitionId}>
            <Button
              fullWidth
              variant={
                selection.kind === "menu" && selectedMenu?.definitionId === menu.definitionId
                  ? "light"
                  : "subtle"
              }
              justify="flex-start"
              onClick={() =>
                setSelection({
                  kind: "menu",
                  definitionId: menu.definitionId,
                  nodeId: null
                })
              }
            >
              {menu.displayName}
            </Button>
            {(selection.kind === "menu" &&
              selectedMenu?.definitionId === menu.definitionId
              ? flattenNodes(menu.root)
              : []
            ).map(({ node, depth }) => (
              <Button
                key={node.nodeId}
                size="compact-xs"
                variant={selection.kind === "menu" && selection.nodeId === node.nodeId ? "filled" : "subtle"}
                justify="flex-start"
                ml={depth * 12}
                onClick={() =>
                  setSelection({
                    kind: "menu",
                    definitionId: menu.definitionId,
                    nodeId: node.nodeId
                  })
                }
              >
                {node.kind}
              </Button>
            ))}
          </Box>
        ))}
        {selection.kind === "hud" && hudDefinition
          ? flattenNodes(hudDefinition.root).map(({ node, depth }) => (
              <Button
                key={node.nodeId}
                size="compact-xs"
                variant={selection.nodeId === node.nodeId ? "filled" : "subtle"}
                justify="flex-start"
                ml={depth * 12}
                onClick={() => setSelection({ kind: "hud", nodeId: node.nodeId })}
              >
                {node.kind}
              </Button>
            ))
          : null}
      </Stack>
    </ScrollArea>
  );

  const previewInitialMenuKey =
    selection.kind === "menu" ? selectedMenu?.menuKey ?? null : null;

  const centerPanel = (
    <Box h="100%" p="md" style={{ minHeight: 0 }}>
      <Box
        h="100%"
        style={{
          position: "relative",
          overflow: "hidden",
          borderRadius: 16,
          background:
            "radial-gradient(circle at top, rgba(93, 117, 162, 0.28), rgba(10, 10, 18, 0.98))"
        }}
      >
        {renderPreview({ initialVisibleMenuKey: previewInitialMenuKey })}
      </Box>
    </Box>
  );

  const rightPanel = (
    <Inspector
      selectionLabel={
        selection.kind === "theme"
          ? "UI Theme"
          : selectedNode
            ? `${selection.kind === "hud" ? "HUD" : selectedMenu?.displayName} · ${selectedNode.kind}`
            : selectedMenu?.displayName ?? "Game UI"
      }
      selectionIcon="🖥️"
    >
      {selection.kind === "theme" ? (
        <Stack gap="sm">
          {Object.entries(uiTheme.tokens).map(([token, value]) =>
            token.startsWith("color.") ? (
              <CssColorField
                key={token}
                label={token}
                value={value}
                onChange={(next) => updateThemeToken(token, next)}
              />
            ) : (
              <TextInput
                key={token}
                label={token}
                value={value}
                onChange={(event) => updateThemeToken(token, event.currentTarget.value)}
              />
            )
          )}
        </Stack>
      ) : selectedMenu && selection.kind === "menu" && selectedNode?.nodeId === selectedMenu.root.nodeId ? (
        <Stack gap="sm">
          <TextInput
            label="Display Name"
            value={selectedMenu.displayName}
            onChange={(event) =>
              updateMenu(selectedMenu, { displayName: event.currentTarget.value })
            }
          />
          <TextInput
            label="Menu Key"
            value={selectedMenu.menuKey}
            onChange={(event) => updateMenu(selectedMenu, { menuKey: event.currentTarget.value })}
          />
        </Stack>
      ) : null}

      {selectedNode ? (
        <Stack gap="sm" mt="sm">
          <Group justify="space-between">
            <Text size="xs" fw={700} tt="uppercase" c="var(--sm-color-subtext)">
              Node
            </Text>
            <ActionIcon
              size="sm"
              variant="subtle"
              disabled={selectedNode === selectedRoot}
              onClick={removeSelectedNode}
              aria-label="Remove UI node"
            >
              🗑
            </ActionIcon>
          </Group>
          <Select
            label="Kind"
            value={selectedNode.kind}
            data={nodeKindOptions}
            onChange={(value) => {
              if (value) updateSelectedNode({ kind: value as UINodeKind });
            }}
          />
          <Select
            label="Style"
            value={selectedNode.styleId ?? ""}
            data={styleOptions}
            onChange={(value) => updateSelectedNode({ styleId: value || null })}
          />
          <Group grow>
            <NumberInput
              label="Gap"
              value={selectedNode.layout.gap}
              onChange={(value) =>
                updateSelectedNode({
                  layout: { ...selectedNode.layout, gap: Number(value) || 0 }
                })
              }
            />
            <NumberInput
              label="Padding"
              value={selectedNode.layout.padding}
              onChange={(value) =>
                updateSelectedNode({
                  layout: { ...selectedNode.layout, padding: Number(value) || 0 }
                })
              }
            />
          </Group>
          {selectedNode.kind === "text" || selectedNode.kind === "button" ? (
            <Stack gap="xs">
              <Select
                label="Text Binding"
                value={getBindingMode(selectedNode.props.text)}
                data={[
                  { value: "literal", label: "Literal" },
                  { value: "runtime-ref", label: "Runtime Ref" }
                ]}
                onChange={(value) =>
                  updateSelectedNode({
                    props: {
                      ...selectedNode.props,
                      text:
                        value === "runtime-ref"
                          ? runtimeUIRef("region.name")
                          : literalUIValue(getBindingLiteral(selectedNode.props.text) || "Text")
                    }
                  })
                }
              />
              <TextInput
                label={
                  getBindingMode(selectedNode.props.text) === "runtime-ref"
                    ? "Runtime Path"
                    : "Text"
                }
                value={
                  getBindingMode(selectedNode.props.text) === "runtime-ref"
                    ? getBindingPath(selectedNode.props.text)
                    : getBindingLiteral(selectedNode.props.text)
                }
                onChange={(event) =>
                  updateSelectedNode({
                    props: {
                      ...selectedNode.props,
                      text:
                        getBindingMode(selectedNode.props.text) === "runtime-ref"
                          ? runtimeUIRef(event.currentTarget.value)
                          : literalUIValue(event.currentTarget.value)
                    }
                  })
                }
              />
            </Stack>
          ) : null}
          {selectedNode.kind === "progress-bar" ? (
            <Stack gap="xs">
              <TextInput
                label="Value Path"
                value={getBindingPath(selectedNode.props.value)}
                onChange={(event) =>
                  updateSelectedNode({
                    props: {
                      ...selectedNode.props,
                      value: runtimeUIRef(event.currentTarget.value)
                    }
                  })
                }
              />
              <TextInput
                label="Max Path"
                value={getBindingPath(selectedNode.props.max)}
                onChange={(event) =>
                  updateSelectedNode({
                    props: {
                      ...selectedNode.props,
                      max: runtimeUIRef(event.currentTarget.value)
                    }
                  })
                }
              />
            </Stack>
          ) : null}
          {selectedNode.kind === "button" ? (
            <TextInput
              label="On Click Action"
              value={selectedNode.events.onClick?.action ?? ""}
              onChange={(event) =>
                updateSelectedNode({
                  events: {
                    ...selectedNode.events,
                    onClick: { action: event.currentTarget.value }
                  }
                })
              }
            />
          ) : null}
          <Select
            label="Add Child"
            placeholder="Choose node kind"
            value={null}
            data={nodeKindOptions}
            onChange={(value) => {
              if (value) addChild(value as UINodeKind);
            }}
          />
        </Stack>
      ) : null}
    </Inspector>
  );

  return {
    leftPanel,
    rightPanel,
    centerPanel,
    viewportOverlay: null
  };
}
