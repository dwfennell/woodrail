import { defineConfig } from "vitest/config";

export default defineConfig(({ command }) => ({
  // Names this build, so caches of things it generates (track piece geometry) are only reused by the same build.
  // Empty in dev and tests: nothing is cached there.
  define: { __BUILD_ID__: JSON.stringify(command === "build" ? Date.now().toString(36) : "") },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
}));
