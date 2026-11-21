import { describe, expect, it } from "vitest";
import { Build } from "./build";
import { OWN_MAPS } from "./maps";

/**
 * Writes our own reference maps (maps.ts) into src/play/bugmaps/reference/ (OWN_MAPS=1; OWN_MAPS_ONLY=<part of a file
 * name,…>; OWN_MAPS_SVG=<dir>: a schematic of each, for eyeballing). Without OWN_MAPS, checks each still builds: its
 * pieces all down by the rules, its trains on its lines.
 */
const ENV: Record<string, string | undefined> = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const ONLY = ENV.OWN_MAPS_ONLY?.split(",");

async function svg(file: string, b: Build): Promise<void> {
  const fs = (await import(/* @vite-ignore */ "node:" + "fs")) as { writeFileSync(f: string, d: string): void };
  fs.writeFileSync(`${ENV.OWN_MAPS_SVG}/${file.replace(/\.txt$/, ".svg")}`, b.svg());
}

describe("our own reference maps", () => {
  for (const m of OWN_MAPS) {
    if (ONLY && !ONLY.some((o) => m.file.includes(o))) continue;
    it(m.file, async () => {
      let b: Build;
      try {
        b = m.build();
      } catch (e) {
        if (ENV.OWN_MAPS_SVG && Build.last) await svg(m.file, Build.last);
        throw e;
      }
      const routed = b.engines.filter((e) => b.w.economy.lineIdOf.has(e));
      expect(routed.length).toBe(b.engines.length);
      if (ENV.OWN_MAPS_SVG) await svg(m.file, b);
      if (ENV.OWN_MAPS) await b.save(`src/play/bugmaps/reference/${m.file}`);
    });
  }
});
