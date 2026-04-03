import type { DocumentIdentity } from "../shared/identity";
import { createUuid } from "../shared/identity";

export interface PluginConfigurationRecord {
  identity: DocumentIdentity;
  pluginId: string;
  enabled: boolean;
  config: Record<string, unknown>;
}

export type PartialPluginConfigurationRecord = Partial<PluginConfigurationRecord> & {
  pluginId: string;
};

export function createPluginConfigurationRecord(
  pluginId: string,
  enabled = false,
  config: Record<string, unknown> = {}
): PluginConfigurationRecord {
  return {
    identity: {
      id: createUuid(),
      schema: "PluginConfiguration",
      version: 1
    },
    pluginId,
    enabled,
    config
  };
}

export function normalizePluginConfigurationRecord(
  input: PartialPluginConfigurationRecord
): PluginConfigurationRecord {
  return {
    identity: input.identity ?? {
      id: createUuid(),
      schema: "PluginConfiguration",
      version: 1
    },
    pluginId: input.pluginId,
    enabled: input.enabled ?? false,
    config: input.config ?? {}
  };
}

export function normalizePluginConfigurationRecords(
  records: Array<PluginConfigurationRecord | PartialPluginConfigurationRecord> | null | undefined
): PluginConfigurationRecord[] {
  if (!records) return [];

  const deduped = new Map<string, PluginConfigurationRecord>();
  for (const record of records) {
    const normalized = normalizePluginConfigurationRecord(record);
    deduped.set(normalized.pluginId, normalized);
  }
  return Array.from(deduped.values()).sort((left, right) =>
    left.pluginId.localeCompare(right.pluginId)
  );
}

export function getPluginConfiguration(
  records: PluginConfigurationRecord[],
  pluginId: string
): PluginConfigurationRecord | null {
  return records.find((record) => record.pluginId === pluginId) ?? null;
}

export function upsertPluginConfiguration(
  records: PluginConfigurationRecord[],
  next: PluginConfigurationRecord
): PluginConfigurationRecord[] {
  const remaining = records.filter((record) => record.pluginId !== next.pluginId);
  return [...remaining, next].sort((left, right) =>
    left.pluginId.localeCompare(right.pluginId)
  );
}

export function isPluginEnabled(
  records: PluginConfigurationRecord[],
  pluginId: string
): boolean {
  return getPluginConfiguration(records, pluginId)?.enabled === true;
}
