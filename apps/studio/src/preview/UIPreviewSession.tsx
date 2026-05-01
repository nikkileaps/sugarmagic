/**
 * Studio wrapper around the web target's public UI preview entry point.
 *
 * This is the only Studio component that imports @sugarmagic/target-web for
 * game UI authoring. It owns the PreviewSession lifecycle and does not reach
 * into target internals.
 */

import { useEffect, useRef } from "react";
import type { GameProject } from "@sugarmagic/domain";
import { bootPreviewSession, type PreviewSession } from "@sugarmagic/target-web";
import { createSampleRuntimeUIContext } from "./sampleRuntimeContext";

export interface UIPreviewSessionProps {
  project: GameProject | null;
  initialVisibleMenuKey: string | null;
}

export function UIPreviewSession(props: UIPreviewSessionProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const sessionRef = useRef<PreviewSession | null>(null);

  useEffect(() => {
    if (!mountRef.current || !props.project) return;
    sessionRef.current?.dispose();
    sessionRef.current = bootPreviewSession({
      project: props.project,
      mountInto: mountRef.current,
      sampleRuntimeContext: createSampleRuntimeUIContext(),
      initialVisibleMenuKey: props.initialVisibleMenuKey
    });
    return () => {
      sessionRef.current?.dispose();
      sessionRef.current = null;
    };
  }, [props.initialVisibleMenuKey, props.project]);

  useEffect(() => {
    if (!props.project) return;
    sessionRef.current?.update(props.project);
  }, [props.project]);

  return <div ref={mountRef} style={{ position: "absolute", inset: 0 }} />;
}
