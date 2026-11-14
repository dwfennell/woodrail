import { describe, expect, it, vi } from "vitest";
import type * as SaveSchemas from "./save-schema";

// A fresh copy of the module each time: the test setup has already loaded the real schemas into the shared one.
async function fresh(): Promise<typeof import("./schemas")> {
  vi.resetModules();
  return import("./schemas");
}

const schemas = {} as typeof SaveSchemas;
const failure = () => new Error("Failed to fetch dynamically imported module: save-schema.js");

describe("loadSaveSchemas", () => {
  it("retries a failed fetch and then has them", async () => {
    const { loadSaveSchemas, saveSchemas } = await fresh();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let tries = 0;
    await loadSaveSchemas(async () => (++tries < 3 ? Promise.reject(failure()) : schemas), 0);
    expect(tries).toBe(3);
    expect(saveSchemas()).toBe(schemas);
    warn.mockRestore();
  });

  it("gives up after a few tries, and asking again tries again (the loading screen's Try again)", async () => {
    const { loadSaveSchemas, saveSchemas } = await fresh();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let tries = 0;
    await expect(loadSaveSchemas(async () => (++tries, Promise.reject(failure())), 0)).rejects.toThrow(/save-schema/);
    expect(tries).toBe(4);
    expect(() => saveSchemas()).toThrow();
    await loadSaveSchemas(async () => schemas, 0);
    expect(saveSchemas()).toBe(schemas);
    warn.mockRestore();
  });
});
