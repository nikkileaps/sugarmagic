/**
 * Project-owned game UI authored data.
 *
 * MenuDefinition, HUDDefinition, UINode, and UITheme are portable domain data:
 * they do not contain DOM, CSS, React components, or target-specific code.
 * Runtime targets render this tree through their own output layer while Studio
 * edits the same authored truth through semantic commands.
 */

import { createScopedId } from "../shared";

export type UINodeKind =
  | "container"
  | "text"
  | "button"
  | "image"
  | "progress-bar"
  | "spacer";

export type UIAnchor =
  | "top-left"
  | "top-center"
  | "top-right"
  | "center-left"
  | "center"
  | "center-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";

export interface UILayoutProps {
  direction: "row" | "column";
  gap: number;
  padding: number;
  align: "start" | "center" | "end" | "stretch";
  justify: "start" | "center" | "end" | "between" | "around";
  width: "auto" | "fill" | number;
  height: "auto" | "fill" | number;
}

export type UIBindingExpression =
  | { kind: "literal"; value: unknown }
  | {
      kind: "runtime-ref";
      path: string;
      format?: "percent" | "integer" | "decimal-1" | null;
    };

export interface UIActionExpression {
  action: string;
  args?: Record<string, unknown>;
}

export interface UINode {
  nodeId: string;
  kind: UINodeKind;
  styleId: string | null;
  layout: UILayoutProps;
  anchor: UIAnchor | null;
  props: Record<string, UIBindingExpression>;
  events: Record<string, UIActionExpression>;
  children: UINode[];
}

export interface UIStyleDefinition {
  styleId: string;
  displayName: string;
  properties: {
    color?: string;
    background?: string;
    fontSize?: string;
    fontFamily?: string;
    fontWeight?: string;
    borderRadius?: string;
    borderColor?: string;
    borderWidth?: string;
    opacity?: number;
  };
}

export interface UITheme {
  tokens: Record<string, string>;
  styles: UIStyleDefinition[];
}

export interface MenuDefinition {
  /** Authored document identity used by editor/session/history systems. */
  definitionId: string;
  definitionKind: "menu";
  displayName: string;
  /**
   * Stable runtime/action address. Runtime visible-menu state uses this key,
   * never the authored definitionId.
   */
  menuKey: string;
  root: UINode;
}

export interface HUDDefinition {
  definitionId: string;
  definitionKind: "hud";
  root: UINode;
}

export function literalUIValue(value: unknown): UIBindingExpression {
  return { kind: "literal", value };
}

export function runtimeUIRef(
  path: string,
  format?: "percent" | "integer" | "decimal-1" | null
): UIBindingExpression {
  return { kind: "runtime-ref", path, format };
}

export function createDefaultUILayoutProps(
  patch: Partial<UILayoutProps> = {}
): UILayoutProps {
  return {
    direction: "column",
    gap: 12,
    padding: 16,
    align: "center",
    justify: "center",
    width: "auto",
    height: "auto",
    ...patch
  };
}

export function createUINode(
  kind: UINodeKind,
  patch: Partial<UINode> = {}
): UINode {
  return normalizeUINode({
    nodeId: patch.nodeId ?? `ui-node:${createScopedId(kind)}`,
    kind,
    styleId: patch.styleId ?? null,
    layout: patch.layout ?? createDefaultUILayoutProps(),
    anchor: patch.anchor ?? null,
    props: patch.props ?? {},
    events: patch.events ?? {},
    children: patch.children ?? []
  });
}

export function normalizeUINode(node: Partial<UINode> & Pick<UINode, "kind">): UINode {
  return {
    nodeId: node.nodeId ?? `ui-node:${createScopedId(node.kind)}`,
    kind: node.kind,
    styleId: node.styleId ?? null,
    layout: createDefaultUILayoutProps(node.layout),
    anchor: node.anchor ?? null,
    props: node.props ?? {},
    events: node.events ?? {},
    children: (node.children ?? []).map((child) => normalizeUINode(child))
  };
}

export function createDefaultUITheme(): UITheme {
  return {
    tokens: {
      "color.text": "#f6f1ff",
      "color.muted": "#beb7d8",
      "color.surface": "rgba(18, 18, 32, 0.82)",
      "color.surfaceStrong": "rgba(29, 29, 52, 0.92)",
      "color.surfaceMuted": "rgba(15, 17, 28, 0.45)",
      "color.primary": "#ff4aa2",
      "color.primaryText": "#fff7fb",
      "font.body": "Avenir Next, Nunito, sans-serif",
      "font.heading": "Georgia, ui-serif, serif",
      "radius.panel": "24px",
      "radius.button": "999px"
    },
    styles: [
      {
        styleId: "panel",
        displayName: "Panel",
        properties: {
          color: "color.text",
          background: "color.surface",
          fontFamily: "font.body",
          borderRadius: "radius.panel",
          borderColor: "rgba(255, 255, 255, 0.16)",
          borderWidth: "1px"
        }
      },
      {
        styleId: "heading",
        displayName: "Heading",
        properties: {
          color: "color.text",
          fontFamily: "font.heading",
          fontSize: "44px",
          fontWeight: "700"
        }
      },
      {
        styleId: "body",
        displayName: "Body",
        properties: {
          color: "color.text",
          fontFamily: "font.body",
          fontSize: "16px"
        }
      },
      {
        styleId: "button-primary",
        displayName: "Primary Button",
        properties: {
          color: "color.primaryText",
          background: "color.primary",
          fontFamily: "font.body",
          fontSize: "16px",
          fontWeight: "700",
          borderRadius: "radius.button"
        }
      },
      {
        styleId: "button-hud",
        displayName: "HUD Button",
        properties: {
          color: "color.text",
          background: "color.surfaceMuted",
          fontFamily: "font.body",
          fontSize: "22px",
          fontWeight: "500",
          borderRadius: "12px",
          borderColor: "rgba(255, 255, 255, 0.12)",
          borderWidth: "1px"
        }
      }
    ]
  };
}

export function normalizeUITheme(theme: Partial<UITheme> | null | undefined): UITheme {
  const fallback = createDefaultUITheme();
  return {
    tokens: { ...fallback.tokens, ...(theme?.tokens ?? {}) },
    styles:
      theme?.styles && theme.styles.length > 0
        ? theme.styles.map((style) => ({
            styleId: style.styleId,
            displayName: style.displayName,
            properties: { ...style.properties }
          }))
        : fallback.styles
  };
}

export function createDefaultStartMenu(projectId: string): MenuDefinition {
  const root = createUINode("container", {
    nodeId: `${projectId}:ui:start-menu:root`,
    styleId: "panel",
    layout: createDefaultUILayoutProps({
      gap: 18,
      padding: 36,
      width: 420,
      align: "stretch"
    }),
    children: [
      createUINode("text", {
        nodeId: `${projectId}:ui:start-menu:title`,
        styleId: "heading",
        props: {
          text: literalUIValue("Sugarmagic")
        }
      }),
      createUINode("button", {
        nodeId: `${projectId}:ui:start-menu:new-game`,
        styleId: "button-primary",
        layout: createDefaultUILayoutProps({ padding: 14, width: "fill" }),
        props: {
          text: literalUIValue("New Game")
        },
        events: {
          onClick: { action: "start-new-game" }
        }
      }),
      createUINode("button", {
        nodeId: `${projectId}:ui:start-menu:settings`,
        styleId: "button-primary",
        layout: createDefaultUILayoutProps({ padding: 14, width: "fill" }),
        props: {
          text: literalUIValue("Settings")
        }
      })
    ]
  });

  return {
    definitionId: `${projectId}:menu:start`,
    definitionKind: "menu",
    displayName: "Start Menu",
    menuKey: "start-menu",
    root
  };
}

export function createDefaultPauseMenu(projectId: string): MenuDefinition {
  return {
    definitionId: `${projectId}:menu:pause`,
    definitionKind: "menu",
    displayName: "Pause Menu",
    menuKey: "pause-menu",
    root: createUINode("container", {
      nodeId: `${projectId}:ui:pause-menu:root`,
      styleId: "panel",
      layout: createDefaultUILayoutProps({
        gap: 16,
        padding: 32,
        width: 360,
        align: "stretch"
      }),
      children: [
        createUINode("text", {
          nodeId: `${projectId}:ui:pause-menu:title`,
          styleId: "heading",
          props: { text: literalUIValue("Paused") }
        }),
        createUINode("button", {
          nodeId: `${projectId}:ui:pause-menu:resume`,
          styleId: "button-primary",
          layout: createDefaultUILayoutProps({ padding: 14, width: "fill" }),
          props: { text: literalUIValue("Resume") },
          events: { onClick: { action: "resume-game" } }
        }),
        createUINode("button", {
          nodeId: `${projectId}:ui:pause-menu:quit`,
          styleId: "button-primary",
          layout: createDefaultUILayoutProps({ padding: 14, width: "fill" }),
          props: { text: literalUIValue("Main Menu") },
          events: { onClick: { action: "quit-to-menu" } }
        })
      ]
    })
  };
}

export function createDefaultHUD(projectId: string): HUDDefinition {
  return {
    definitionId: `${projectId}:hud:default`,
    definitionKind: "hud",
    root: createUINode("container", {
      nodeId: `${projectId}:ui:hud:root`,
      layout: createDefaultUILayoutProps({
        direction: "column",
        padding: 20,
        align: "start",
        justify: "start",
        width: "fill",
        height: "fill"
      }),
      children: [
        createUINode("container", {
          nodeId: `${projectId}:ui:hud:bottom-bar`,
          anchor: "bottom-center",
          layout: createDefaultUILayoutProps({
            direction: "row",
            gap: 12,
            padding: 0
          }),
          children: [
            createUINode("button", {
              nodeId: `${projectId}:ui:hud:inventory`,
              styleId: "button-hud",
              layout: createDefaultUILayoutProps({ padding: 8 }),
              props: { text: literalUIValue("🎒") },
              events: { onClick: { action: "open-inventory" } }
            }),
            createUINode("button", {
              nodeId: `${projectId}:ui:hud:caster`,
              styleId: "button-hud",
              layout: createDefaultUILayoutProps({ padding: 8 }),
              props: { text: literalUIValue("✨") },
              events: { onClick: { action: "open-caster" } }
            }),
            createUINode("button", {
              nodeId: `${projectId}:ui:hud:main`,
              styleId: "button-hud",
              layout: createDefaultUILayoutProps({ padding: 8 }),
              props: { text: literalUIValue("🏠") },
              events: { onClick: { action: "quit-to-menu" } }
            })
          ]
        })
      ]
    })
  };
}

export function normalizeMenuDefinition(
  definition: Partial<MenuDefinition>,
  fallbackProjectId: string,
  fallbackIndex = 0
): MenuDefinition {
  const fallback = createDefaultStartMenu(fallbackProjectId);
  const displayName =
    typeof definition.displayName === "string" && definition.displayName.trim()
      ? definition.displayName
      : `Menu ${fallbackIndex + 1}`;
  return {
    definitionId:
      definition.definitionId ??
      `${fallbackProjectId}:menu:${displayName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    definitionKind: "menu",
    displayName,
    menuKey:
      definition.menuKey ??
      displayName.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    root: normalizeUINode(definition.root ?? fallback.root)
  };
}

export function normalizeHUDDefinition(
  definition: Partial<HUDDefinition> | null | undefined,
  projectId: string
): HUDDefinition {
  const fallback = createDefaultHUD(projectId);
  return {
    definitionId: definition?.definitionId ?? fallback.definitionId,
    definitionKind: "hud",
    root: normalizeUINode(definition?.root ?? fallback.root)
  };
}

export function createDefaultMenuDefinitions(projectId: string): MenuDefinition[] {
  return [createDefaultStartMenu(projectId), createDefaultPauseMenu(projectId)];
}
