/**
 * Surface Studio (Plan 068.10).
 *
 * The "open what the brush created and hand-tune it" surface. A full
 * workspace takeover: the LIVE shared viewport relocates into the left
 * pane (App mounts it into `viewportContainerRef` while the Studio is
 * open, so it renders the actual selected asset and paints exactly like
 * the main viewport -- one active viewport, no second render). The right
 * column stacks a UV/Mask mini-view above the master-detail layer stack
 * (reorder layers, swap surfaces, tune masks). Edits write straight back
 * through the slot's inline override.
 *
 * 10c makes the UV/Mask panel a real paintable canvas.
 */

import { Box, Group, Modal, Stack, Text } from "@mantine/core";
import type { AuthoringSession, Surface } from "@sugarmagic/domain";
import { LayerStackView } from "@sugarmagic/workspaces";
import type { WebRenderEngine } from "@sugarmagic/render-web";
import { SurfaceStudioViewport } from "./viewport/surfaceStudioViewport";

export interface SurfaceStudioTarget {
  instanceId: string;
  assetDefinitionId: string;
  slotName: string;
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
}

export function SurfaceStudioModal({
  opened,
  onClose,
  engine,
  session,
  surface,
  target,
  slotLabel,
  onChangeSurface
}: SurfaceStudioModalProps) {
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      fullScreen
      radius={0}
      withCloseButton
      // No transition: the left container must be in the DOM immediately
      // so App's mount effect can relocate the viewport into it.
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
        {/* Left: focused preview of just the selected asset (own render
            view + orbit), showing the surface being edited. */}
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
            />
          ) : null}
        </Box>

        {/* Right: UV/Mask mini-view above the layer stack. */}
        <Stack
          gap={0}
          style={{
            width: 340,
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
            <Box
              style={{
                aspectRatio: "1 / 1",
                width: "100%",
                borderRadius: "var(--sm-radius-sm)",
                border: "1px dashed var(--sm-panel-border)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center"
              }}
            >
              <Text size="xs" c="var(--sm-color-overlay0)">
                UV canvas (10c)
              </Text>
            </Box>
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
