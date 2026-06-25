/**
 * apps/studio/src/plugins/PluginSchemaSettingsPanel.tsx
 *
 * Purpose: Schema-rendered settings panel for plugins that declare a
 * `pluginSettingsSchema` on their discovered definition (Story 46.16).
 * Reads the live per-game plugin config record + the schema, renders
 * one Mantine input per field, dispatches UpdatePluginConfiguration
 * on change. Honors `showWhen` for conditional fields and groups
 * adjacent fields with the same `group` under a section header.
 *
 * The component is the default rendering path used by the auto-mount
 * helper in `apps/studio/src/plugins/catalog/index.ts`; plugins that
 * want custom UI ship their own hand-written workspace and may still
 * embed this panel for the schema-driven fields.
 *
 * Implements: Plan 046 §Story 46.16
 *
 * Status: active
 */

import {
  Group,
  NumberInput,
  Select,
  Stack,
  Switch,
  Text,
  TextInput
} from "@mantine/core";
import {
  getPluginConfiguration,
  type PluginConfigurationRecord,
  type SemanticCommand
} from "@sugarmagic/domain";
import {
  ensureDiscoveredPluginConfiguration,
  getDiscoveredPluginDefinition,
  type PluginSettingsSchemaField
} from "@sugarmagic/plugins";

export interface PluginSchemaSettingsPanelProps {
  pluginId: string;
  gameProjectId: string | null;
  pluginConfigurations: PluginConfigurationRecord[];
  onCommand: (command: SemanticCommand) => void;
}

function isShowWhenSatisfied(
  field: PluginSettingsSchemaField,
  currentConfig: Record<string, unknown>
): boolean {
  if (!field.showWhen) return true;
  const sibling = currentConfig[field.showWhen.configKey];
  return sibling === field.showWhen.equals;
}

function readFieldValue(
  field: PluginSettingsSchemaField,
  currentConfig: Record<string, unknown>
): string | number | boolean {
  const raw = currentConfig[field.configKey];
  if (field.type === "boolean") {
    if (typeof raw === "boolean") return raw;
    if (typeof field.default === "boolean") return field.default;
    return false;
  }
  if (field.type === "number") {
    if (typeof raw === "number" && Number.isFinite(raw)) return raw;
    if (typeof field.default === "number") return field.default;
    return 0;
  }
  if (typeof raw === "string") return raw;
  if (typeof field.default === "string") return field.default;
  return "";
}

export function PluginSchemaSettingsPanel(
  props: PluginSchemaSettingsPanelProps
) {
  const { pluginId, gameProjectId, pluginConfigurations, onCommand } = props;
  const definition = getDiscoveredPluginDefinition(pluginId);
  const schema = definition?.pluginSettingsSchema;

  if (!definition) {
    return (
      <Text size="sm" c="var(--sm-color-subtext)">
        Plugin "{pluginId}" is not installed.
      </Text>
    );
  }
  if (!schema || schema.length === 0) {
    return (
      <Text size="sm" c="var(--sm-color-subtext)">
        Plugin "{pluginId}" declares no settings schema.
      </Text>
    );
  }

  const configuration = ensureDiscoveredPluginConfiguration(
    pluginConfigurations,
    pluginId,
    true
  );
  const currentConfig =
    (getPluginConfiguration(pluginConfigurations, pluginId)?.config ??
      configuration.config ??
      {}) as Record<string, unknown>;

  function updateConfig(patch: Record<string, unknown>) {
    if (!gameProjectId) return;
    onCommand({
      kind: "UpdatePluginConfiguration",
      target: {
        aggregateKind: "plugin-config",
        aggregateId: configuration.identity.id
      },
      subject: {
        subjectKind: "plugin-configuration",
        subjectId: configuration.identity.id
      },
      payload: {
        configuration: {
          ...configuration,
          enabled: true,
          config: {
            ...(configuration.config ?? {}),
            ...patch
          }
        }
      }
    });
  }

  const visible = schema.filter((field) =>
    isShowWhenSatisfied(field, currentConfig)
  );

  // Group adjacent fields with the same `group` into a Stack with a
  // sticky uppercase header. Fields without a `group` render flush at
  // the panel top level.
  const groups: Array<{
    group: string | undefined;
    fields: PluginSettingsSchemaField[];
  }> = [];
  for (const field of visible) {
    const last = groups[groups.length - 1];
    if (last && last.group === field.group) {
      last.fields.push(field);
    } else {
      groups.push({ group: field.group, fields: [field] });
    }
  }

  return (
    <Stack gap="lg">
      <Stack gap={4}>
        <Text fw={700} size="lg">
          {definition.manifest.displayName}
        </Text>
        <Text size="sm" c="var(--sm-color-subtext)">
          {definition.manifest.summary}
        </Text>
      </Stack>
      {groups.map((group, index) => (
        <Stack key={`${group.group ?? "_"}-${index}`} gap="xs">
          {group.group ? (
            <Text size="xs" fw={600} tt="uppercase" c="var(--sm-color-subtext)">
              {group.group}
            </Text>
          ) : null}
          {group.fields.map((field) => (
            <PluginSchemaField
              key={field.configKey}
              field={field}
              value={readFieldValue(field, currentConfig)}
              onChange={(value) =>
                updateConfig({ [field.configKey]: value })
              }
            />
          ))}
        </Stack>
      ))}
    </Stack>
  );
}

interface PluginSchemaFieldProps {
  field: PluginSettingsSchemaField;
  value: string | number | boolean;
  onChange: (value: string | number | boolean) => void;
}

function PluginSchemaField(props: PluginSchemaFieldProps) {
  const { field, value, onChange } = props;
  switch (field.type) {
    case "text":
      return (
        <TextInput
          label={field.label}
          description={field.description}
          placeholder={field.placeholder}
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.currentTarget.value)}
        />
      );
    case "select":
      return (
        <Select
          label={field.label}
          description={field.description}
          data={(field.options ?? []).map((opt) => ({
            value: opt.value,
            label: opt.label
          }))}
          value={typeof value === "string" ? value : ""}
          onChange={(next) => onChange(next ?? "")}
        />
      );
    case "number":
      return (
        <NumberInput
          label={field.label}
          description={field.description}
          min={field.min}
          max={field.max}
          value={typeof value === "number" ? value : 0}
          onChange={(next) =>
            onChange(
              typeof next === "number" && Number.isFinite(next)
                ? next
                : typeof field.default === "number"
                  ? field.default
                  : 0
            )
          }
        />
      );
    case "boolean":
      return (
        <Group justify="space-between" align="center" wrap="nowrap">
          <Stack gap={0}>
            <Text size="sm" fw={500}>
              {field.label}
            </Text>
            {field.description ? (
              <Text size="xs" c="var(--sm-color-subtext)">
                {field.description}
              </Text>
            ) : null}
          </Stack>
          <Switch
            checked={value === true}
            onChange={(event) => onChange(event.currentTarget.checked)}
          />
        </Group>
      );
  }
}
