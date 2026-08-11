/**
 * Plugin-declared file-backed assets (Plan 092.2).
 *
 * A plugin can produce a DERIVED ARTIFACT the runtime cannot rebuild -- one
 * that needs Studio, a network service, or paid work (ADR 005 rule 3). Those
 * ship with the game as assets, so the plugin declares the file and the single
 * collector picks it up on the same footing as a model or an audio clip.
 *
 * THE PROPERTY UNDER TEST IS DECOUPLING. The collector lives in the domain and
 * must never learn any plugin's name: disabling or uninstalling a plugin has to
 * leave a project that still opens and still deploys. That is asserted three
 * ways below -- a disabled plugin is skipped, an unrelated second plugin uses
 * the identical mechanism, and the source file itself names no plugin.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  PLUGIN_ASSET_PATHS_CONFIG_KEY,
  collectFileBackedAssetPaths,
  createEmptyContentLibrarySnapshot,
  createPluginConfigurationRecord,
  type PluginConfigurationRecord
} from "@sugarmagic/domain";

function pluginDeclaring(
  pluginId: string,
  paths: unknown,
  enabled = true
): PluginConfigurationRecord {
  return createPluginConfigurationRecord(pluginId, enabled, {
    [PLUGIN_ASSET_PATHS_CONFIG_KEY]: paths
  });
}

const library = () => createEmptyContentLibrarySnapshot("test");

describe("092.2 — a plugin's derived artifacts are file-backed assets", () => {
  it("collects what an enabled plugin declares", () => {
    const paths = collectFileBackedAssetPaths({
      contentLibrary: library(),
      pluginConfigurations: [
        pluginDeclaring("sugarlang", ["assets/sugarlang/abc123.json"])
      ]
    });
    expect(paths).toContain("assets/sugarlang/abc123.json");
  });

  it("THE ONE THAT MATTERS: a disabled plugin's files are skipped", () => {
    // The uninstall question. If a disabled plugin's paths were still
    // collected, opening the project would try to load files for a plugin that
    // is not running, and the deploy would ship them. Turning a plugin off has
    // to leave a working game.
    const paths = collectFileBackedAssetPaths({
      contentLibrary: library(),
      pluginConfigurations: [
        pluginDeclaring("sugarlang", ["assets/sugarlang/abc123.json"], false)
      ]
    });
    expect(paths).toEqual([]);
  });

  it("ANY plugin can use it, not one blessed one", () => {
    // The generality check. If this mechanism only ever worked for the plugin
    // it was built for, it would be that plugin's private path wearing a
    // generic name.
    const paths = collectFileBackedAssetPaths({
      contentLibrary: library(),
      pluginConfigurations: [
        pluginDeclaring("sugarlang", ["assets/sugarlang/abc123.json"]),
        pluginDeclaring("some-other-plugin", [
          "assets/some-other-plugin/baked.bin"
        ])
      ]
    });
    expect(paths).toContain("assets/sugarlang/abc123.json");
    expect(paths).toContain("assets/some-other-plugin/baked.bin");
  });

  it("a malformed declaration cannot stop a project opening", () => {
    // `config` is opaque to the domain, so anything can be under this key.
    // Every one of these must be ignored rather than thrown on -- this
    // collector runs on project open.
    for (const junk of [null, "a string", 42, { not: "an array" }, [1, 2], [""]]) {
      expect(() =>
        collectFileBackedAssetPaths({
          contentLibrary: library(),
          pluginConfigurations: [pluginDeclaring("sugarlang", junk)]
        })
      ).not.toThrow();
    }
  });

  it("a plugin with no declaration contributes nothing", () => {
    const paths = collectFileBackedAssetPaths({
      contentLibrary: library(),
      pluginConfigurations: [
        createPluginConfigurationRecord("sugarlang", true, {})
      ]
    });
    expect(paths).toEqual([]);
  });

  it("THE ARCHITECTURAL GUARD: the collector names no plugin", () => {
    // One-way dependencies. The moment this file contains a plugin id, the
    // domain knows about a plugin and disabling that plugin stops being a
    // property the domain can honour generically.
    const source = readFileSync(
      fileURLToPath(
        new URL("../../domain/src/asset-paths.ts", import.meta.url)
      ),
      "utf8"
    );
    for (const pluginId of [
      "sugarlang",
      "sugaragent",
      "sugarprofile",
      "sugardeploy",
      "fireflies"
    ]) {
      expect(source, `asset-paths.ts must not name "${pluginId}"`).not.toContain(
        pluginId
      );
    }
  });
});
