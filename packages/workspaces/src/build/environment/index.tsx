import { Text } from "@mantine/core";
import { PanelSection } from "@sugarmagic/ui";
import type { WorkspaceViewContribution } from "../../workspace-view";

export function useEnvironmentWorkspaceView(): WorkspaceViewContribution {
  return {
    leftPanel: (
      <PanelSection title="Environment" icon="🌅">
        <Text size="xs" c="var(--sm-color-overlay0)" p="md">
          Environment workspace — coming soon.
        </Text>
      </PanelSection>
    ),
    rightPanel: null,
    viewportOverlay: null
  };
}
