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
import {
  resolveBinding,
  type UIContextStore,
  type UIStateStore
} from "@sugarmagic/runtime-core";
import { compileLayout } from "./ui/layout";
import { compileStyleDefinition, compileThemeVariables, findStyle } from "./ui/applyTheme";
import { UIContainer } from "./ui/UIContainer";
import { UIText } from "./ui/UIText";
import { UIButton } from "./ui/UIButton";
import { UIImage } from "./ui/UIImage";
import { UIProgressBar } from "./ui/UIProgressBar";
import { UISpacer } from "./ui/UISpacer";

export interface GameUILayerProps {
  hudDefinition: HUDDefinition | null;
  menuDefinitions: MenuDefinition[];
  theme: UITheme;
  uiContextStore: UIContextStore;
  uiStateStore: UIStateStore;
  onAction: (action: UIActionExpression) => void;
}

function useRuntimeStore<TState>(store: {
  getState(): TState;
  subscribe(listener: () => void): () => void;
}): TState {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}

function nodeStyle(node: UINode, theme: UITheme): CSSProperties {
  return {
    ...compileLayout(node.layout, node.anchor),
    ...compileStyleDefinition(findStyle(theme, node.styleId), theme)
  };
}

function renderNode(input: {
  node: UINode;
  theme: UITheme;
  context: ReturnType<UIContextStore["getState"]>;
  onAction: (action: UIActionExpression) => void;
}): JSX.Element {
  const { node, theme, context, onAction } = input;
  const style = nodeStyle(node, theme);
  const children = node.children.map((child) =>
    renderNode({ node: child, theme, context, onAction })
  );

  if (node.kind === "text") {
    return (
      <UIText
        key={node.nodeId}
        text={resolveBinding(node.props.text, context)}
        style={style}
      />
    );
  }

  if (node.kind === "button") {
    return (
      <UIButton
        key={node.nodeId}
        text={resolveBinding(node.props.text, context)}
        style={style}
        action={node.events.onClick}
        onAction={onAction}
      >
        {children}
      </UIButton>
    );
  }

  if (node.kind === "image") {
    return (
      <UIImage
        key={node.nodeId}
        src={resolveBinding(node.props.src, context)}
        alt={resolveBinding(node.props.alt, context)}
        style={style}
      />
    );
  }

  if (node.kind === "progress-bar") {
    return (
      <UIProgressBar
        key={node.nodeId}
        value={resolveBinding(node.props.value, context)}
        min={resolveBinding(node.props.min, context)}
        max={resolveBinding(node.props.max, context)}
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
  const context = useRuntimeStore(props.uiContextStore);
  const state = useRuntimeStore(props.uiStateStore);
  const visibleMenu =
    state.visibleMenuKey === null
      ? null
      : props.menuDefinitions.find(
          (definition) => definition.menuKey === state.visibleMenuKey
        ) ?? null;

  return (
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
        ? renderNode({
            node: props.hudDefinition.root,
            theme: props.theme,
            context,
            onAction: props.onAction
          })
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
          {renderNode({
            node: visibleMenu.root,
            theme: props.theme,
            context,
            onAction: props.onAction
          })}
        </div>
      ) : null}
    </div>
  );
}
