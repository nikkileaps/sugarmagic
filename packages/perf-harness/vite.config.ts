import { resolve } from "node:path";
import { defineConfig } from "vite";

// Standalone QA dev server. Root is this package; it imports the
// workspace render-web source, so allow fs access up to the monorepo
// root. Fixed port so the driver knows the URL.
export default defineConfig({
  root: import.meta.dirname,
  server: {
    port: 5199,
    strictPort: true,
    fs: { allow: [resolve(import.meta.dirname, "../..")] }
  },
  build: { target: "esnext" }
});
