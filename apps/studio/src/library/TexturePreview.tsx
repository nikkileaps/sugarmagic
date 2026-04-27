/**
 * Texture preview.
 *
 * Single-purpose component for the Textures library popover: shows
 * the selected TextureDefinition's image bytes via a blob URL from
 * the asset resolver. No Three.js scene needed — textures are 2D
 * source images, an <img> is the right tool.
 */

import { useMemo } from "react";
import { Box, Stack, Text } from "@mantine/core";
import type { TextureDefinition } from "@sugarmagic/domain";
import type { AuthoredAssetResolver } from "@sugarmagic/render-web";

export interface TexturePreviewProps {
  texture: TextureDefinition | null;
  assetResolver: AuthoredAssetResolver | null;
}

export function TexturePreview({ texture, assetResolver }: TexturePreviewProps) {
  const url = useMemo(() => {
    if (!texture || !assetResolver) return null;
    return assetResolver.resolveAssetUrl(texture.source.relativeAssetPath);
  }, [texture, assetResolver]);

  if (!texture) {
    return (
      <Stack h="100%" align="center" justify="center">
        <Text size="sm" c="var(--sm-color-overlay0)">
          Select a texture to preview.
        </Text>
      </Stack>
    );
  }

  return (
    <Stack h="100%" gap="sm">
      <Box
        style={{
          flex: 1,
          minHeight: 280,
          borderRadius: "var(--mantine-radius-md)",
          background:
            // Checkerboard so transparent textures (PNGs with alpha)
            // are visibly identifiable as transparent rather than
            // blending into the modal background.
            "repeating-conic-gradient(var(--sm-color-surface0) 0% 25%, var(--sm-color-surface1) 0% 50%) 50% / 24px 24px",
          overflow: "hidden",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 16
        }}
      >
        {url ? (
          <img
            src={url}
            alt={texture.displayName}
            style={{
              maxWidth: "100%",
              maxHeight: "100%",
              imageRendering: "auto"
            }}
          />
        ) : (
          <Text size="sm" c="var(--sm-color-overlay0)">
            Could not resolve texture source.
          </Text>
        )}
      </Box>
      <Stack gap={2}>
        <Text size="xs" c="var(--sm-color-overlay0)">
          {texture.source.fileName} · {texture.colorSpace} · packing:{" "}
          {texture.packing}
        </Text>
      </Stack>
    </Stack>
  );
}
