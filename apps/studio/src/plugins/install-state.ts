const INSTALLED_PLUGIN_STORAGE_KEY = "sugarmagic.editor.installed-plugin-ids.v1";

function normalizePluginIds(pluginIds: string[]): string[] {
  return Array.from(new Set(pluginIds.filter((pluginId) => pluginId.trim().length > 0)))
    .sort((left, right) => left.localeCompare(right));
}

export function readInstalledPluginIds(ownerWindow: Window = window): string[] {
  try {
    const raw = ownerWindow.localStorage.getItem(INSTALLED_PLUGIN_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? normalizePluginIds(parsed.filter((value): value is string => typeof value === "string"))
      : [];
  } catch {
    return [];
  }
}

export function writeInstalledPluginIds(
  pluginIds: string[],
  ownerWindow: Window = window
): string[] {
  const normalized = normalizePluginIds(pluginIds);
  ownerWindow.localStorage.setItem(
    INSTALLED_PLUGIN_STORAGE_KEY,
    JSON.stringify(normalized)
  );
  return normalized;
}

export function installPluginId(
  currentPluginIds: string[],
  pluginId: string,
  ownerWindow: Window = window
): string[] {
  return writeInstalledPluginIds([...currentPluginIds, pluginId], ownerWindow);
}

export function uninstallPluginId(
  currentPluginIds: string[],
  pluginId: string,
  ownerWindow: Window = window
): string[] {
  return writeInstalledPluginIds(
    currentPluginIds.filter((current) => current !== pluginId),
    ownerWindow
  );
}
