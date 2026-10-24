import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.toml" }, miniflare: { bindings: { CODE_KEY: "test-only-key" } } })],
  test: { include: ["test/**/*.test.ts"] },
});
