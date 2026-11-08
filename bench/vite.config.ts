import { defineConfig } from "vite";
import { workerChunks } from "../scripts/worker-chunks.mjs";

// Benchmarks run as a plain Node bundle: Vitest's module runner adds getter overhead that skews hot-path timings.
export default defineConfig({
  // (tick.bench.ts loads saves, whose world reaches the far-detail worker's chunk.)
  plugins: [workerChunks()],
  define: { __BUILD_ID__: '""', __UPDATE_CHECK__: "false" },
  build: {
    ssr: true,
    outDir: "dist-bench",
    emptyOutDir: true,
    rollupOptions: { input: { track: "bench/track.bench.ts", tick: "bench/tick.bench.ts" } },
  },
});
