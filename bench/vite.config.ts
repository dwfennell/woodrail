import { defineConfig } from "vite";

// Benchmarks run as a plain Node bundle: Vitest's module runner adds getter overhead that skews hot-path timings.
export default defineConfig({
  build: {
    ssr: true,
    outDir: "dist-bench",
    emptyOutDir: true,
    rollupOptions: { input: { track: "bench/track.bench.ts" } },
  },
});
