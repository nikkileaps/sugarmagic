import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@sugarmagic/target-web": new URL(
        "../../targets/web/src/index.ts",
        import.meta.url
      ).pathname
    }
  },
  build: {
    rolldownOptions: {
      input: {
        main: "index.html",
        preview: "preview.html"
      }
    }
  }
});
