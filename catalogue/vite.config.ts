import { defineConfig } from "vite";

// The asset catalogue: a standalone page (`npm run catalogue`), built on its own (`npm run catalogue:build`).
export default defineConfig({
  root: "catalogue",
  base: "./",
  build: { outDir: "../dist-catalogue", emptyOutDir: true, chunkSizeWarningLimit: 4000 },
});
