/**
 * Layer settings popover.
 *
 * Hosts the non-mask layer authoring controls behind a compact row-level
 * preview trigger so the layer stack remains the single interaction surface
 * for layer editing.
 */

import { ColorSwatch, Popover, UnstyledButton } from "@mantine/core";
import type {
  FlowerTypeDefinition,
  GrassTypeDefinition,
  Layer,
  MaterialDefinition,
  MaskTextureDefinition,
  RockTypeDefinition,
  ShaderGraphDocument,
  SurfaceContext,
  TextureDefinition
} from "@sugarmagic/domain";
import { useState } from "react";
import { LayerDetailPanel } from "./LayerDetailPanel";
import { previewColorForLayer } from "./utils";

export interface LayerSettingsPopoverProps {
  layer: Layer;
  isBaseLayer: boolean;
  allowedContext: SurfaceContext;
  materialDefinitions: MaterialDefinition[];
  textureDefinitions: TextureDefinition[];
  maskTextureDefinitions: MaskTextureDefinition[];
  onCreateMaskTextureDefinition?: () => Promise<MaskTextureDefinition | null> | MaskTextureDefinition | null;
  onImportMaskTextureDefinition?: () => Promise<MaskTextureDefinition | null>;
  activePaintMaskTextureId?: string | null;
  onSetActivePaintMaskTextureId?: (definitionId: string | null) => void;
  shaderDefinitions: ShaderGraphDocument[];
  grassTypeDefinitions: GrassTypeDefinition[];
  flowerTypeDefinitions: FlowerTypeDefinition[];
  rockTypeDefinitions: RockTypeDefinition[];
  onChange: (nextLayer: Layer) => void;
  onActivate?: () => void;
}

export function LayerSettingsPopover({
  layer,
  isBaseLayer,
  allowedContext,
  materialDefinitions,
  textureDefinitions,
  maskTextureDefinitions,
  onCreateMaskTextureDefinition,
  onImportMaskTextureDefinition,
  activePaintMaskTextureId,
  onSetActivePaintMaskTextureId,
  shaderDefinitions,
  grassTypeDefinitions,
  flowerTypeDefinitions,
  rockTypeDefinitions,
  onChange,
  onActivate
}: LayerSettingsPopoverProps) {
  const [opened, setOpened] = useState(false);

  return (
    <Popover
      opened={opened}
      onChange={setOpened}
      position="bottom-start"
      shadow="md"
      width={320}
    >
      <Popover.Target>
        <UnstyledButton
          aria-label="Edit layer settings"
          onClick={(event) => {
            event.stopPropagation();
            onActivate?.();
            setOpened((current) => !current);
          }}
        >
          <ColorSwatch
            color={previewColorForLayer(layer)}
            size={18}
            style={{ cursor: "pointer", flexShrink: 0 }}
          />
        </UnstyledButton>
      </Popover.Target>
      <Popover.Dropdown onClick={(event) => event.stopPropagation()}>
        <LayerDetailPanel
          layer={layer}
          isBaseLayer={isBaseLayer}
          allowedContext={allowedContext}
          materialDefinitions={materialDefinitions}
          textureDefinitions={textureDefinitions}
          maskTextureDefinitions={maskTextureDefinitions}
          onCreateMaskTextureDefinition={onCreateMaskTextureDefinition}
          onImportMaskTextureDefinition={onImportMaskTextureDefinition}
          activePaintMaskTextureId={activePaintMaskTextureId}
          onSetActivePaintMaskTextureId={onSetActivePaintMaskTextureId}
          shaderDefinitions={shaderDefinitions}
          grassTypeDefinitions={grassTypeDefinitions}
          flowerTypeDefinitions={flowerTypeDefinitions}
          rockTypeDefinitions={rockTypeDefinitions}
          onChange={onChange}
        />
      </Popover.Dropdown>
    </Popover>
  );
}
