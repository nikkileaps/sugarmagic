/**
 * Minimal Mechanics authoring workspace.
 *
 * Mechanics are LLM-first project data. This v1 intentionally provides a
 * text surface with live validation rather than inventing a visual editor.
 */

import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Group, Stack, Text, Textarea } from "@mantine/core";
import type {
  ItemDefinition,
  MechanicsDefinition,
  SemanticCommand,
  SpellDefinition
} from "@sugarmagic/domain";
import {
  collectMechanicsConsumerInvocations,
  parseMechanicsJson5Input,
  validateMechanicsDefinition
} from "@sugarmagic/runtime-core";
import { Inspector, PanelSection } from "@sugarmagic/ui";
import type { WorkspaceViewContribution } from "../workspace-view";

export interface MechanicsWorkspaceViewProps {
  gameProjectId: string | null;
  mechanics: MechanicsDefinition;
  spellDefinitions: SpellDefinition[];
  itemDefinitions: ItemDefinition[];
  onCommand: (command: SemanticCommand) => void;
}

function stringifyMechanics(mechanics: MechanicsDefinition): string {
  return JSON.stringify(mechanics, null, 2);
}

export function useMechanicsWorkspaceView(
  props: MechanicsWorkspaceViewProps
): WorkspaceViewContribution {
  const { gameProjectId, mechanics, spellDefinitions, itemDefinitions, onCommand } = props;
  const [text, setText] = useState(() => stringifyMechanics(mechanics));

  useEffect(() => {
    setText(stringifyMechanics(mechanics));
  }, [mechanics]);

  const validation = useMemo(() => {
    try {
      const parsed = parseMechanicsJson5Input(text);
      const result = validateMechanicsDefinition(parsed, {
        consumers: collectMechanicsConsumerInvocations({
          spellDefinitions,
          itemDefinitions
        })
      });
      return { parsed, result };
    } catch (error) {
      return {
        parsed: null,
        result: {
          valid: false,
          issues: [
            {
              path: "/",
              message: error instanceof Error ? error.message : String(error)
            }
          ]
        }
      };
    }
  }, [itemDefinitions, spellDefinitions, text]);

  function saveMechanics() {
    if (!gameProjectId || !validation.result.valid || !validation.parsed) {
      return;
    }
    onCommand({
      kind: "UpdateMechanicsDefinition",
      target: {
        aggregateKind: "game-project",
        aggregateId: gameProjectId
      },
      subject: {
        subjectKind: "game-project",
        subjectId: gameProjectId
      },
      payload: {
        mechanics: validation.parsed as MechanicsDefinition
      }
    });
  }

  function copySchemaPath() {
    void navigator.clipboard?.writeText("/schemas/mechanics.schema.json");
  }

  return {
    leftPanel: null,
    rightPanel: (
      <Inspector selectionLabel="Mechanics">
        <PanelSection title="Project Mechanics">
          <Stack gap="sm">
            <Text size="sm" c="var(--sm-color-overlay1)">
              Paste JSON5 here. Sugarmagic validates it live and saves it as
              standard project JSON.
            </Text>
            <Group gap="xs">
              <Button
                size="xs"
                onClick={saveMechanics}
                disabled={!validation.result.valid}
              >
                Apply
              </Button>
              <Button
                size="xs"
                variant="light"
                onClick={() => setText(stringifyMechanics(mechanics))}
              >
                Discard Changes
              </Button>
              <Button size="xs" variant="subtle" onClick={copySchemaPath}>
                Copy Schema Path
              </Button>
            </Group>
          </Stack>
        </PanelSection>
      </Inspector>
    ),
    centerPanel: (
      <Stack h="100%" gap="sm" p="md">
        <Textarea
          value={text}
          onChange={(event) => setText(event.currentTarget.value)}
          autosize={false}
          minRows={24}
          styles={{
            input: {
              minHeight: "60vh",
              fontFamily: "monospace"
            }
          }}
        />
        {validation.result.valid ? (
          <Alert color="green" title="Mechanics are valid">
            Structural and semantic validation passed.
          </Alert>
        ) : (
          <Alert color="red" title="Mechanics need attention">
            <Stack gap={4}>
              {validation.result.issues.map((issue, index) => (
                <Text key={`${issue.path}-${index}`} size="xs">
                  {issue.path}: {issue.message}
                </Text>
              ))}
            </Stack>
          </Alert>
        )}
      </Stack>
    ),
    viewportOverlay: null
  };
}
