import { defineConfig } from "vitest/config";
import { debugReports } from "./scripts/debug-reports.mjs";

export default defineConfig(({ command }) => ({
  // "Send to Claude" reports from the dev server, written to .reports/.
  plugins: [debugReports()],
  // Names this build, so caches of things it generates (track piece geometry) are only reused by the same build.
  // Empty in dev and tests: nothing is cached there.
  define: { __BUILD_ID__: JSON.stringify(command === "build" ? Date.now().toString(36) : "") },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
}));
