import { Modal, Stack, Button, Text, TextInput, Group } from "@mantine/core";
import { useState } from "react";

export interface CreateRegionDialogProps {
  opened: boolean;
  onClose: () => void;
  onCreate: (input: { displayName: string; regionId: string }) => void;
}

export function CreateRegionDialog({
  opened,
  onClose,
  onCreate
}: CreateRegionDialogProps) {
  const [displayName, setDisplayName] = useState("");
  const [regionId, setRegionId] = useState("");

  function handleCreate() {
    if (!displayName.trim() || !regionId.trim()) return;
    onCreate({ displayName: displayName.trim(), regionId: regionId.trim() });
    setDisplayName("");
    setRegionId("");
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      centered
      size="sm"
      title={
        <Text fw={600} size="sm" c="var(--sm-color-text)">
          New Region
        </Text>
      }
      styles={{
        content: {
          background: "var(--sm-color-base)",
          borderRadius: "var(--sm-radius-lg)",
          border: "1px solid var(--sm-panel-border)"
        },
        header: {
          background: "var(--sm-color-surface1)",
          borderBottom: "1px solid var(--sm-panel-border)",
          padding: "var(--sm-space-md) var(--sm-space-xl)"
        },
        body: { padding: "var(--sm-space-xl)" }
      }}
    >
      <Stack gap="md">
        <TextInput
          label="Display Name"
          placeholder="Forest North"
          value={displayName}
          onChange={(e) => setDisplayName(e.currentTarget.value)}
          styles={{
            label: { color: "var(--sm-color-subtext)", fontSize: "var(--sm-font-size-sm)" },
            input: {
              background: "var(--sm-color-mantle)",
              borderColor: "var(--sm-panel-border)",
              color: "var(--sm-color-text)"
            }
          }}
        />
        <TextInput
          label="Region ID"
          placeholder="forest-north"
          value={regionId}
          onChange={(e) => setRegionId(e.currentTarget.value)}
          styles={{
            label: { color: "var(--sm-color-subtext)", fontSize: "var(--sm-font-size-sm)" },
            input: {
              background: "var(--sm-color-mantle)",
              borderColor: "var(--sm-panel-border)",
              color: "var(--sm-color-text)"
            }
          }}
        />
        <Group gap="sm" mt="xs" justify="flex-end">
          <Button variant="subtle" color="gray" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="filled"
            disabled={!displayName.trim() || !regionId.trim()}
            onClick={handleCreate}
            styles={{
              root: {
                background: "var(--sm-action-green-bg)",
                color: "var(--sm-accent-green)",
                "&:hover": { background: "var(--sm-action-green-bg-hover)" }
              }
            }}
          >
            Create Region
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
