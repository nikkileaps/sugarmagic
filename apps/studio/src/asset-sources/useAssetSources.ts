/**
 * useAssetSources
 *
 * Studio-side owner of the authored-asset blob URL map. Asset definitions
 * live in the content library; each one references a file inside the
 * project directory. The Studio needs a resolvable URL per asset so
 * GLTFLoader (and anything else reading from `assetSources[path]`) can
 * fetch the underlying bytes. Blob URLs minted via `URL.createObjectURL`
 * are the mechanism; this module owns their full lifecycle.
 *
 * Contract:
 *
 * - Input: a `FileSystemDirectoryHandle` for the project root and the
 *   current list of `AssetDefinition`s.
 * - Output: a `Record<relativeAssetPath, blobUrl>` — safe for consumers to
 *   look up URLs by asset-definition path.
 * - Stability: the map is re-created ONLY when the set of asset source
 *   paths changes (assets added, removed, or renamed). Unrelated session
 *   mutations (shader binding edits, environment changes, transform tweaks)
 *   do NOT churn the map. This matters because blob URLs are ephemeral and
 *   revoking them mid-load causes GLTFLoader fetches to fail with 404.
 * - Disposal: revoked on unmount and on superseded regenerations so we
 *   don't leak object URLs into the browser's blob registry.
 *
 * Consumers should treat the returned object as read-only. Do not mutate
 * the map; do not keep references across renders (the identity is not
 * stable across regenerations — only across identical path sets).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { AssetDefinition } from "@sugarmagic/domain";
import { readBlobFile } from "@sugarmagic/io";

function revokeAssetSources(assetSources: Record<string, string>): void {
  for (const url of Object.values(assetSources)) {
    URL.revokeObjectURL(url);
  }
}

async function createAssetSourceMap(
  handle: FileSystemDirectoryHandle,
  assetDefinitions: AssetDefinition[]
): Promise<Record<string, string>> {
  const nextSources: Record<string, string> = {};
  for (const definition of assetDefinitions) {
    const pathSegments = definition.source.relativeAssetPath
      .split("/")
      .filter(Boolean);
    const blob = await readBlobFile(handle, ...pathSegments);
    if (!blob) continue;
    nextSources[definition.source.relativeAssetPath] = URL.createObjectURL(blob);
  }
  return nextSources;
}

export function useAssetSources(
  projectHandle: FileSystemDirectoryHandle | null,
  assetDefinitions: AssetDefinition[]
): Record<string, string> {
  const [assetSources, setAssetSources] = useState<Record<string, string>>({});

  // Fingerprint the SET of asset paths. Any other shape of change — shader
  // binding edits, transform tweaks, env mutations — keeps this string
  // identical and therefore avoids regenerating (and revoking) blob URLs
  // that may still be feeding in-flight GLTF loads.
  const assetSourcePathsKey = useMemo(
    () =>
      assetDefinitions
        .map((definition) => definition.source.relativeAssetPath)
        .sort()
        .join("|"),
    [assetDefinitions]
  );

  // The effect only re-fires when the path-set changes, but it needs the
  // current `assetDefinitions` list at fire time. Ref keeps the latest
  // value accessible without re-subscribing on every session mutation.
  const assetDefinitionsRef = useRef(assetDefinitions);
  assetDefinitionsRef.current = assetDefinitions;

  useEffect(() => {
    let disposed = false;
    let generatedSources: Record<string, string> = {};

    if (!projectHandle || assetDefinitionsRef.current.length === 0) {
      void Promise.resolve().then(() => {
        if (!disposed) {
          setAssetSources({});
        }
      });
      return undefined;
    }

    void createAssetSourceMap(projectHandle, assetDefinitionsRef.current).then(
      (nextSources) => {
        if (disposed) {
          revokeAssetSources(nextSources);
          return;
        }
        generatedSources = nextSources;
        setAssetSources(nextSources);
      }
    );

    return () => {
      disposed = true;
      revokeAssetSources(generatedSources);
    };
  }, [assetSourcePathsKey, projectHandle]);

  return assetSources;
}
