/**
 * Layer mask popover.
 *
 * Keeps layer-row mask editing in one focused interaction: a thumbnail preview
 * opens a draft mask editor, and Apply commits the authored mask back to the
 * layer stack. This keeps mask authoring out of the general detail inspector
 * while still reusing the single `MaskEditor` implementation.
 */

import { Button, Popover, Stack, UnstyledButton } from "@mantine/core";
import type {
  Mask,
  MaskTextureDefinition,
  SurfaceContext,
  TextureDefinition
} from "@sugarmagic/domain";
import { cloneMask } from "@sugarmagic/domain";
import { MaskPreview } from "@sugarmagic/ui";
import { useState } from "react";
import { MaskEditor } from "./MaskEditor";
import { sampleMask } from "./maskSampling";

export interface LayerMaskPopoverProps {
  value: Mask;
  allowedContext: SurfaceContext;
  textureDefinitions: TextureDefinition[];
  maskTextureDefinitions: MaskTextureDefinition[];
  onCreateMaskTextureDefinition?: () => Promise<MaskTextureDefinition | null> | MaskTextureDefinition | null;
  onImportMaskTextureDefinition?: () => Promise<MaskTextureDefinition | null>;
  activePaintMaskTextureId?: string | null;
  onSetActivePaintMaskTextureId?: (definitionId: string | null) => void;
  onApply: (nextMask: Mask) => void;
  onActivate?: () => void;
}

export function LayerMaskPopover({
  value,
  allowedContext,
  textureDefinitions,
  maskTextureDefinitions,
  onCreateMaskTextureDefinition,
  onImportMaskTextureDefinition,
  activePaintMaskTextureId,
  onSetActivePaintMaskTextureId,
  onApply,
  onActivate
}: LayerMaskPopoverProps) {
  const [opened, setOpened] = useState(false);
  const [draftMask, setDraftMask] = useState<Mask>(() => cloneMask(value));

  function openPopover(): void {
    onActivate?.();
    setDraftMask(cloneMask(value));
    setOpened(true);
  }

  return (
    <Popover
      opened={opened}
      onChange={(nextOpened) => {
        setOpened(nextOpened);
        if (nextOpened) {
          setDraftMask(cloneMask(value));
        }
      }}
      position="bottom-start"
      shadow="md"
      width={300}
    >
      <Popover.Target>
        <UnstyledButton
          aria-label="Edit layer mask"
          onClick={(event) => {
            event.stopPropagation();
            if (opened) {
              setOpened(false);
              return;
            }
            openPopover();
          }}
        >
          <MaskPreview
            size={40}
            sample={(u, v) => sampleMask(value, u, v)}
          />
        </UnstyledButton>
      </Popover.Target>
      <Popover.Dropdown onClick={(event) => event.stopPropagation()}>
        <Stack gap="sm">
          <MaskEditor
            showHeading={false}
            value={draftMask}
            allowedContext={allowedContext}
            textureDefinitions={textureDefinitions}
            maskTextureDefinitions={maskTextureDefinitions}
            onCreateMaskTextureDefinition={onCreateMaskTextureDefinition}
            onImportMaskTextureDefinition={onImportMaskTextureDefinition}
            activePaintMaskTextureId={activePaintMaskTextureId}
            onSetActivePaintMaskTextureId={onSetActivePaintMaskTextureId}
            onChange={setDraftMask}
          />
          <Button
            size="compact-sm"
            fullWidth
            onClick={() => {
              onApply(cloneMask(draftMask));
              setOpened(false);
            }}
          >
            Apply
          </Button>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}
