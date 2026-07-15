/**
 * Surface Studio (Plan 068.10).
 *
 * The "open what the brush created and hand-tune it" surface. A full
 * workspace takeover: the left pane is a focused preview of just the
 * selected asset (own render view + orbit); the right column stacks a
 * UV/Mask mini-view above the master-detail layer stack (reorder layers,
 * swap surfaces, tune masks). Edits write back through the slot's inline
 * override.
 *
 * 068.10b: arming a layer's painted mask (its paint action in the layer
 * stack) shows a brush strip over the viewport and lets you paint that
 * mask directly on the asset. 10c makes the UV/Mask panel a real canvas.
 */

import { useMemo, useRef, useState } from "react";
import { ActionIcon, Box, Group, Modal, Stack, Text } from "@mantine/core";
import type { AuthoringSession, Surface } from "@sugarmagic/domain";
import { LayerStackView } from "@sugarmagic/workspaces";
import { ToolOptionSlider, ToolOptionsBar } from "@sugarmagic/ui";
import type { WebRenderEngine } from "@sugarmagic/render-web";
import { SurfaceStudioViewport } from "./viewport/surfaceStudioViewport";
import { SurfaceStudioUvPanel } from "./SurfaceStudioUvPanel";
import type { ProjectionBrushSettings } from "./viewport/overlays/projection-paint";

export interface SurfaceStudioTarget {
  instanceId: string;
  assetDefinitionId: string;
  slotName: string;
  scope: "base" | "scene";
}

export interface SurfaceStudioModalProps {
  opened: boolean;
  onClose: () => void;
  engine: WebRenderEngine;
  session: AuthoringSession | null;
  /** The slot's inline surface (already forked to inline by the opener). */
  surface: Surface<"universal"> | null;
  target: SurfaceStudioTarget | null;
  slotLabel: string;
  onChangeSurface: (surface: Surface<"universal">) => void;
  brushSettings: ProjectionBrushSettings;
  onChangeBrushSettings: (settings: ProjectionBrushSettings) => void;
  readMaskTexture: (maskTextureId: string) => Promise<ImageData | null>;
  writeMaskTexture: (maskTextureId: string, imageData: ImageData) => Promise<void>;
  getMaskPreviewCanvas: (maskTextureId: string) => HTMLCanvasElement | null;
  /** Bumps when any painted mask's pixels change (repaints the UV panel). */
  maskPreviewVersion: number;
}

export function SurfaceStudioModal({
  opened,
  onClose,
  engine,
  session,
  surface,
  target,
  slotLabel,
  onChangeSurface,
  brushSettings,
  onChangeBrushSettings,
  readMaskTexture,
  writeMaskTexture,
  getMaskPreviewCanvas,
  maskPreviewVersion
}: SurfaceStudioModalProps) {
  // The always-on brush paints the SELECTED layer's mask. The toolbar is
  // always shown but greys out when the selected layer has no painted
  // mask (Plan 068.10b).
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [uvTriangles, setUvTriangles] = useState<number[] | null>(null);
  // Drag-resizable right panel (UV/Mask + Layers).
  const [panelWidth, setPanelWidth] = useState(360);
  const resizingRef = useRef(false);
  const paintMaskId = useMemo(() => {
    const layer = surface?.layers.find(
      (candidate) => candidate.layerId === selectedLayerId
    );
    return layer && layer.mask.kind === "painted"
      ? layer.mask.maskTextureId
      : null;
  }, [surface, selectedLayerId]);
  const painting = paintMaskId !== null;

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      fullScreen
      radius={0}
      withCloseButton
      transitionProps={{ duration: 0 }}
      title={
        <Text fw={700} size="sm">
          Surface Studio{slotLabel ? ` -- ${slotLabel}` : ""}
        </Text>
      }
      styles={{
        body: { height: "calc(100vh - 60px)", padding: 0 }
      }}
    >
      <Group h="100%" gap={0} wrap="nowrap" align="stretch">
        {/* Left: focused, orbitable preview of just the selected asset. */}
        <Box
          style={{
            flex: 1,
            minWidth: 0,
            position: "relative",
            background: "var(--sm-color-surface0)"
          }}
        >
          {opened ? (
            <SurfaceStudioViewport
              engine={engine}
              session={session}
              target={target}
              paintMaskId={paintMaskId}
              brushSettings={brushSettings}
              readMaskTexture={readMaskTexture}
              writeMaskTexture={writeMaskTexture}
              getMaskPreviewCanvas={getMaskPreviewCanvas}
              onPaintUvTriangles={setUvTriangles}
            />
          ) : null}
          {/* Brush options bar: the shared viewport chrome positions this
              top-left itself. Always shown; greyed + non-interactive until
              a layer with a painted mask is selected. */}
          <div
            style={{
              opacity: painting ? 1 : 0.4,
              pointerEvents: painting ? "auto" : "none"
            }}
          >
            <ToolOptionsBar>
              <ActionIcon
                variant="filled"
                color="grape"
                size="sm"
                title={
                  painting
                    ? "Surface Brush"
                    : "Select a layer with a Painted mask to paint"
                }
                aria-label="Surface Brush"
              >
                🖌
              </ActionIcon>
              <ActionIcon
                variant={brushSettings.mode === "erase" ? "filled" : "subtle"}
                color={brushSettings.mode === "erase" ? "red" : "gray"}
                size="sm"
                title="Erase"
                aria-label="Erase"
                onClick={() =>
                  onChangeBrushSettings({
                    ...brushSettings,
                    mode: brushSettings.mode === "erase" ? "paint" : "erase"
                  })
                }
              >
                🧽
              </ActionIcon>
              <ToolOptionSlider
                label="Radius"
                min={0.25}
                max={8}
                step={0.25}
                value={brushSettings.radius}
                format={(value) => `${value.toFixed(2)}m`}
                onChange={(value) =>
                  onChangeBrushSettings({ ...brushSettings, radius: value })
                }
              />
              <ToolOptionSlider
                label="Strength"
                min={0.05}
                max={1}
                step={0.05}
                value={brushSettings.strength}
                onChange={(value) =>
                  onChangeBrushSettings({ ...brushSettings, strength: value })
                }
              />
              <ToolOptionSlider
                label="Falloff"
                min={0}
                max={1}
                step={0.05}
                value={brushSettings.falloff}
                onChange={(value) =>
                  onChangeBrushSettings({ ...brushSettings, falloff: value })
                }
              />
            </ToolOptionsBar>
          </div>
        </Box>

        {/* Drag handle to resize the right panel wider/narrower. */}
        <Box
          onPointerDown={(event) => {
            resizingRef.current = true;
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (!resizingRef.current) {
              return;
            }
            const next = Math.min(
              Math.max(window.innerWidth - event.clientX, 280),
              window.innerWidth - 360
            );
            setPanelWidth(next);
          }}
          onPointerUp={(event) => {
            resizingRef.current = false;
            event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          style={{
            width: 6,
            flexShrink: 0,
            cursor: "col-resize",
            background: "var(--sm-panel-border)"
          }}
        />

        {/* Right: UV/Mask mini-view above the layer stack. */}
        <Stack
          gap={0}
          style={{
            width: panelWidth,
            flexShrink: 0,
            borderLeft: "1px solid var(--sm-panel-border)",
            background: "var(--sm-color-surface0)"
          }}
        >
          <Box
            style={{
              padding: 12,
              borderBottom: "1px solid var(--sm-panel-border)"
            }}
          >
            <Text
              size="xs"
              fw={700}
              c="var(--sm-color-subtext)"
              tt="uppercase"
              mb={8}
            >
              UV / Mask
            </Text>
            <SurfaceStudioUvPanel
              maskCanvas={paintMaskId ? getMaskPreviewCanvas(paintMaskId) : null}
              uvTriangles={uvTriangles}
              maskVersion={maskPreviewVersion}
            />
          </Box>

          <Box style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 12 }}>
            <Text
              size="xs"
              fw={700}
              c="var(--sm-color-subtext)"
              tt="uppercase"
              mb={8}
            >
              Layers
            </Text>
            {surface && target ? (
              <LayerStackView<"universal">
                surface={surface}
                allowedContext="universal"
                allowPainted
                paintOwner={{
                  scope: "instance-slot",
                  instanceId: target.instanceId,
                  assetDefinitionId: target.assetDefinitionId,
                  slotName: target.slotName
                }}
                variant="inline"
                onChangeSurface={onChangeSurface}
                onSelectedLayerChange={setSelectedLayerId}
                hidePaintInViewport
              />
            ) : (
              <Text size="xs" c="var(--sm-color-overlay0)">
                No surface on this slot.
              </Text>
            )}
          </Box>
        </Stack>
      </Group>
    </Modal>
  );
}
