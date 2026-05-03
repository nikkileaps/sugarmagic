/**
 * React DOM renderer for authored game UI in the web target.
 *
 * This component is target output code. Studio reuses it only by embedding the
 * web target through bootPreviewSession; domain/runtime-core do not import it.
 */

import { useSyncExternalStore } from "react";
import type { CSSProperties, JSX } from "react";
import type {
  HUDDefinition,
  MenuDefinition,
  UIActionExpression,
  UINode,
  UITheme
} from "@sugarmagic/domain";
import type { UIContextStore, UIStateStore } from "@sugarmagic/runtime-core";
import { compileLayout } from "./ui/layout";
import {
  compileStyleDefinition,
  compileThemeVariables,
  findStyle
} from "./ui/applyTheme";
import { UIContainer } from "./ui/UIContainer";
import { UIText } from "./ui/UIText";
import { UIButton } from "./ui/UIButton";
import { UIImage } from "./ui/UIImage";
import { UIProgressBar } from "./ui/UIProgressBar";
import { UISpacer } from "./ui/UISpacer";
import { UIRuntimeBridgeProvider } from "./ui/UIContextProvider";

export interface GameUILayerProps {
  hudDefinition: HUDDefinition | null;
  menuDefinitions: MenuDefinition[];
  theme: UITheme;
  uiContextStore: UIContextStore;
  uiStateStore: UIStateStore;
  onAction: (action: UIActionExpression) => void;
  onHover: (action: UIActionExpression | null) => void;
}

function nodeStyle(node: UINode, theme: UITheme): CSSProperties {
  return {
    ...compileLayout(node.layout, node.anchor),
    ...compileStyleDefinition(findStyle(theme, node.styleId), theme)
  };
}

function renderNode(input: { node: UINode; theme: UITheme }): JSX.Element {
  const { node, theme } = input;
  const style = nodeStyle(node, theme);
  const children = node.children.map((child) =>
    renderNode({ node: child, theme })
  );

  if (node.kind === "text") {
    return <UIText key={node.nodeId} text={node.props.text} style={style} />;
  }

  if (node.kind === "button") {
    return (
      <UIButton
        key={node.nodeId}
        text={node.props.text}
        style={style}
        action={node.events.onClick}
      >
        {children}
      </UIButton>
    );
  }

  if (node.kind === "image") {
    return (
      <UIImage
        key={node.nodeId}
        src={node.props.src}
        alt={node.props.alt}
        style={style}
      />
    );
  }

  if (node.kind === "progress-bar") {
    return (
      <UIProgressBar
        key={node.nodeId}
        value={node.props.value}
        min={node.props.min}
        max={node.props.max}
        style={style}
      />
    );
  }

  if (node.kind === "spacer") {
    return <UISpacer key={node.nodeId} style={style} />;
  }

  return (
    <UIContainer key={node.nodeId} style={style}>
      {children}
    </UIContainer>
  );
}

export function GameUILayer(props: GameUILayerProps): JSX.Element {
  // Subscribe only to the state store here (visible-menu changes are rare and
  // need to swap the whole overlay). The context store is consumed leaf-by-leaf
  // through useResolvedBinding so per-frame ECS updates re-render only the
  // bound nodes — see plan 039 §39.3.
  const state = useSyncExternalStore(
    props.uiStateStore.subscribe,
    props.uiStateStore.getState,
    props.uiStateStore.getState
  );
  const visibleMenu =
    state.visibleMenuKey === null
      ? null
      : (props.menuDefinitions.find(
          (definition) => definition.menuKey === state.visibleMenuKey
        ) ?? null);

  return (
    <UIRuntimeBridgeProvider
      contextStore={props.uiContextStore}
      onAction={props.onAction}
      onHover={props.onHover}
    >
      <div
        data-sugarmagic-game-ui-layer
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 40,
          overflow: "hidden",
          pointerEvents: "none",
          color: "var(--sm-game-ui-color-text, #f6f1ff)",
          fontFamily: "var(--sm-game-ui-font-body, sans-serif)",
          ...compileThemeVariables(props.theme)
        }}
      >
        {props.hudDefinition
          ? renderNode({ node: props.hudDefinition.root, theme: props.theme })
          : null}
        {visibleMenu ? (
          <div
            data-sugarmagic-visible-menu={visibleMenu.menuKey}
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              pointerEvents: "auto",
              background: "rgba(7, 7, 15, 0.38)"
            }}
          >
            {renderNode({ node: visibleMenu.root, theme: props.theme })}
          </div>
        ) : null}
      </div>
    </UIRuntimeBridgeProvider>
  );
}
