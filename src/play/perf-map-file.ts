/**
 * Write a copied map (`woodrail-map:1:…`, as "Copy map for a bug report" makes it) to a file: for the perf harness's
 * maps (tools/perf/maps, docs/agents/perf.md). Node only (tests); nothing in the game imports it.
 */
import { MAP_TAG } from "../persist/bug-map";
import type { GameMode } from "../game/modes";

type NodeFs = { writeFileSync(path: string, data: string): void };
type NodeZlib = { gzipSync(data: string): { toString(enc: "base64"): string } };

export async function writeMapFile(file: string, mode: GameMode, keys: Record<string, string>): Promise<void> {
  const fs = (await import(/* @vite-ignore */ "node:" + "fs")) as NodeFs;
  const zlib = (await import(/* @vite-ignore */ "node:" + "zlib")) as NodeZlib;
  fs.writeFileSync(file, MAP_TAG + zlib.gzipSync(JSON.stringify({ mode, keys })).toString("base64") + "\n");
}
