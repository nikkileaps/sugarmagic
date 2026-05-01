/**
 * Per-binding subscription hook for authored UI leaves.
 *
 * Returns the resolved value for a single UIBindingExpression and re-renders
 * the calling component ONLY when that specific binding's resolved value
 * changes (Object.is comparison via useSyncExternalStore). This is the
 * fine-grained selector pattern called for in plan 039 §39.3.
 */

import { useSyncExternalStore } from "react";
import type { UIBindingExpression } from "@sugarmagic/domain";
import { resolveBinding } from "@sugarmagic/runtime-core";
import { useUIRuntimeBridge } from "./UIContextProvider";

export function useResolvedBinding(
  binding: UIBindingExpression | undefined
): unknown {
  const { contextStore } = useUIRuntimeBridge();
  return useSyncExternalStore(
    contextStore.subscribe,
    () => resolveBinding(binding, contextStore.getState()),
    () => resolveBinding(binding, contextStore.getState())
  );
}
