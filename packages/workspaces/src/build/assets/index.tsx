import { Text } from "@mantine/core";
import { PanelSection } from "@sugarmagic/ui";
import type { WorkspaceViewContribution } from "../../workspace-view";

export function useAssetsWorkspaceView(): WorkspaceViewContribution {
  return {
    leftPanel: (
      <PanelSection title="Assets" icon="📦">
        <Text size="xs" c="var(--sm-color-overlay0)" p="md">
          Asset placement workspace — coming soon.
        </Text>
      </PanelSection>
    ),
    rightPanel: null,
    viewportOverlay: null
  };
}
