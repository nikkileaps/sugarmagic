import { Modal, Stack, Button, Text, TextInput, Group } from "@mantine/core";
import { useState } from "react";

export interface ProjectManagerDialogProps {
  opened: boolean;
  onOpen: () => void;
  onCreate: (input: { gameName: string; slug: string }) => void;
}

export function ProjectManagerDialog({
  opened,
  onOpen,
  onCreate
}: ProjectManagerDialogProps) {
  const [step, setStep] = useState<"choose" | "create">("choose");
  const [gameName, setGameName] = useState("");
  const [slug, setSlug] = useState("");

  function handleCreate() {
    if (!gameName.trim() || !slug.trim()) return;
    onCreate({ gameName: gameName.trim(), slug: slug.trim() });
    setStep("choose");
    setGameName("");
    setSlug("");
  }

  return (
    <Modal
      opened={opened}
      onClose={() => {}}
      withCloseButton={false}
      centered
      size="lg"
      title={
        <Text fw={600} size="sm" c="var(--sm-color-text)">
          Game Manager
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
        body: {
          padding: "40px 48px 48px"
        }
      }}
    >
      {step === "choose" ? (
        <Stack gap="lg" align="center">
          <Text style={{ fontSize: 40 }}>🍬</Text>
          <Stack gap={4} align="center">
            <Text fw={700} size="xl" c="var(--sm-color-text)">
              Welcome to Sugarmagic
            </Text>
            <Text size="sm" c="var(--sm-color-overlay2)" ta="center">
              Create a new game root or open an existing game to get started.
            </Text>
          </Stack>
          <Group gap="md" mt="md" wrap="nowrap">
            <Button
              variant="filled"
              size="md"
              leftSection="+"
              onClick={() => setStep("create")}
              styles={{
                root: {
                  background: "var(--sm-action-green-bg)",
                  color: "var(--sm-accent-green)",
                  "&:hover": {
                    background: "var(--sm-action-green-bg-hover)"
                  }
                }
              }}
            >
              New Game
            </Button>
            <Button
              variant="outline"
              size="md"
              leftSection="📁"
              onClick={onOpen}
              styles={{
                root: {
                  borderColor: "var(--sm-color-surface2)",
                  color: "var(--sm-color-subtext)",
                  "&:hover": {
                    background: "var(--sm-hover-bg)"
                  }
                }
              }}
            >
              Open Game
            </Button>
          </Group>
        </Stack>
      ) : (
        <Stack gap="md">
          <Stack gap={4} align="center">
            <Text fw={700} size="lg" c="var(--sm-color-text)">
              Create New Game
            </Text>
            <Text size="sm" c="var(--sm-color-overlay2)" ta="center">
              Set up a new game project. You will choose a directory next.
            </Text>
          </Stack>
          <TextInput
            label="Game Name"
            placeholder="My Game"
            value={gameName}
            onChange={(e) => setGameName(e.currentTarget.value)}
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
            label="Slug"
            placeholder="my-game"
            value={slug}
            onChange={(e) => setSlug(e.currentTarget.value)}
            styles={{
              label: { color: "var(--sm-color-subtext)", fontSize: "var(--sm-font-size-sm)" },
              input: {
                background: "var(--sm-color-mantle)",
                borderColor: "var(--sm-panel-border)",
                color: "var(--sm-color-text)"
              }
            }}
          />
          <Group gap="sm" mt="xs">
            <Button
              variant="subtle"
              color="gray"
              onClick={() => setStep("choose")}
            >
              Back
            </Button>
            <Button
              variant="outline"
              onClick={handleCreate}
              disabled={!gameName.trim() || !slug.trim()}
              flex={1}
              styles={{
                root: {
                  borderColor: "var(--sm-accent-blue)",
                  color: "var(--sm-accent-blue)",
                  "&:hover": {
                    background: "var(--sm-active-bg)"
                  }
                }
              }}
            >
              Choose Directory & Create
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}
