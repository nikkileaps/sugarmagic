/**
 * Live scene inventory (Perf tooling).
 *
 * Attaches over CDP to a running preview and categorizes the live scene
 * graph via the dev-only `window.__sugarmagicDebug` handle -- the true
 * anatomy of the frame (what the draw-call / geometry counts are made
 * of), read-only, no app spelunking.
 *
 * Requires the debug Chrome from measure-live's SETUP (dedicated
 * --user-data-dir, port 9222; NO vsync flags -- they blank the window),
 * with the preview open + in a scene.
 *
 *   node driver/inventory.mjs [--port=9222]
 */

import { chromium } from "playwright-core";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "true"];
  })
);
const PORT = Number(args.port ?? 9222);
const log = (...m) => console.log("[inv]", ...m);

async function main() {
  const browser = await chromium.connectOverCDP(`http://localhost:${PORT}`);
  const pages = browser.contexts().flatMap((c) => c.pages());
  const preview =
    pages.find((p) => p.url().includes("preview.html")) ??
    pages.find((p) => p.url().includes("preview"));
  if (!preview) {
    console.log("pages:", pages.map((p) => p.url()));
    throw new Error("no preview page found (open the preview + get into a scene)");
  }
  log("preview:", preview.url());

  const report = await preview.evaluate(() => {
    const dbg = globalThis.__sugarmagicDebug;
    if (!dbg) return { error: "no __sugarmagicDebug handle (dev build only)" };
    const scene = dbg.scene;
    if (!scene) return { error: "no scene yet" };

    const cats = new Map();
    const patterns = new Map();
    let meshes = 0;
    let instancedMeshes = 0;
    let totalInstances = 0;
    const geoUuids = new Set();
    let visibleDraws = 0;

    const bump = (map, key, inst) => {
      const e = map.get(key) ?? { count: 0, instanced: 0, instances: 0, visible: 0 };
      e.count += 1;
      if (inst.isInstanced) e.instanced += 1;
      e.instances += inst.instances;
      if (inst.visible) e.visible += 1;
      map.set(key, e);
    };

    scene.traverse((o) => {
      const isMesh = o.isMesh || o.isInstancedMesh;
      if (!isMesh) return;
      const isInstanced = !!o.isInstancedMesh;
      const instances = isInstanced ? o.count ?? 0 : 1;
      const visible = o.visible;
      meshes += isInstanced ? 0 : 1;
      if (isInstanced) instancedMeshes += 1;
      totalInstances += instances;
      if (o.geometry?.uuid) geoUuids.add(o.geometry.uuid);
      if (visible) visibleDraws += Array.isArray(o.material) ? o.material.length : 1;

      const name = o.name || "(unnamed)";
      const category = name.split(":")[0] || o.type;
      const info = { isInstanced, instances, visible };
      bump(cats, category, info);
      // Pattern: strip long ids to see structure (keep near/far/billboard).
      const pattern = name
        .split(":")
        .map((seg) => (/^[0-9a-f-]{8,}$/i.test(seg) ? "<id>" : seg))
        .join(":");
      bump(patterns, pattern, info);
    });

    const info = dbg.renderView?.renderer?.info ?? null;
    const asArr = (map) =>
      [...map.entries()]
        .map(([k, v]) => ({ key: k, ...v }))
        .sort((a, b) => b.count - a.count);

    return {
      renderer: info
        ? {
            drawCalls: info.render?.drawCalls ?? info.render?.calls ?? null,
            triangles: info.render?.triangles ?? null,
            geometries: info.memory?.geometries ?? null,
            textures: info.memory?.textures ?? null
          }
        : null,
      totals: {
        meshes,
        instancedMeshes,
        totalInstances,
        uniqueGeometries: geoUuids.size,
        visibleDrawApprox: visibleDraws
      },
      byCategory: asArr(cats),
      byPattern: asArr(patterns).slice(0, 40)
    };
  });

  if (report.error) {
    log("ERROR:", report.error);
  } else {
    log("renderer.info:", JSON.stringify(report.renderer));
    log("totals:", JSON.stringify(report.totals));
    log("--- by category (name prefix) ---");
    for (const c of report.byCategory)
      log(
        `  ${c.key.padEnd(26)} meshes=${String(c.count).padStart(4)} ` +
          `instanced=${c.instanced} instances=${c.instances} visible=${c.visible}`
      );
    log("--- by name pattern (ids elided) ---");
    for (const p of report.byPattern)
      log(`  ${String(p.count).padStart(4)} x  ${p.key}`);
  }

  await browser.close();
}

main().catch((err) => {
  console.error("[inv] FAILED:", err.message);
  process.exit(1);
});
