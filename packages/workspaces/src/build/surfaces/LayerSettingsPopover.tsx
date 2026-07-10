/**
 * Layer settings popover.
 *
 * Hosts the non-mask layer authoring controls behind a compact row-level
 * preview trigger so the layer stack remains the single interaction surface
 * for layer editing.
 */

import { ColorSwatch, Popover, UnstyledButton } from "@mantine/core";
import type { Layer } from "@sugarmagic/domain";
import { useState } from "react";
import { LayerDetailPanel } from "./LayerDetailPanel";
import { previewColorForLayer } from "./utils";

export interface LayerSettingsPopoverProps {
  layer: Layer;
  isBaseLayer: boolean;
  onChange: (nextLayer: Layer) => void;
  onActivate?: () => void;
}

export function LayerSettingsPopover({
  layer,
  isBaseLayer,
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
      withinPortal={false}
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
          onChange={onChange}
        />
      </Popover.Dropdown>
    </Popover>
  );
}
