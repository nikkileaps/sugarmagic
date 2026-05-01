/**
 * React context for the runtime stores consumed by authored UI leaves.
 *
 * Provided once by GameUILayer; leaf components subscribe to only their own
 * bindings via useResolvedBinding so a single ECS value change re-renders
 * only the bound leaves rather than the entire authored tree.
 */

import { createContext, useContext, type ReactNode } from "react";
import type { UIActionExpression } from "@sugarmagic/domain";
import type { UIContextStore } from "@sugarmagic/runtime-core";

interface UIRuntimeBridge {
  contextStore: UIContextStore;
  onAction: (action: UIActionExpression) => void;
}

const UIRuntimeBridgeContext = createContext<UIRuntimeBridge | null>(null);

export function UIRuntimeBridgeProvider(props: {
  contextStore: UIContextStore;
  onAction: (action: UIActionExpression) => void;
  children: ReactNode;
}) {
  return (
    <UIRuntimeBridgeContext.Provider
      value={{ contextStore: props.contextStore, onAction: props.onAction }}
    >
      {props.children}
    </UIRuntimeBridgeContext.Provider>
  );
}

export function useUIRuntimeBridge(): UIRuntimeBridge {
  const bridge = useContext(UIRuntimeBridgeContext);
  if (!bridge) {
    throw new Error("UI leaf rendered outside UIRuntimeBridgeProvider");
  }
  return bridge;
}
