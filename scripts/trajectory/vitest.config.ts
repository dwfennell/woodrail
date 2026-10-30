// The repo's vitest config plus the trajectory recorder (record.ts), for trajectory.mjs (run from the tree under test).
import { fileURLToPath } from "node:url";
import { defineConfig, mergeConfig } from "vitest/config";
import base from "../../vite.config.ts";

export default defineConfig((env) =>
  mergeConfig(base(env), { test: { setupFiles: [fileURLToPath(new URL("./record.ts", import.meta.url))] } }),
);
