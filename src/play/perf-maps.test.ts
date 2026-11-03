/**
 * The perf harness's big Sandbox map (tools/perf/maps/big-sandbox.txt, see docs/agents/perf.md): a seeded Sandbox
 * world with closed ovals of track laid wherever the land is clear for every piece, and a train of an engine and three
 * cars on some of them. Written as a copied map (`woodrail-map:1:…`) for the harness to load with `?dev#load=`.
 *
 *   PERF_MAPS=1 npx vitest run src/play/perf-maps.test.ts
 *
 * (A generator, not a test of the game: skipped unless asked for. The game's own rules decide where a piece may go:
 * `checkPlacement` and `looseHeight`, as a drop in the tray does.)
 */
import { describe, expect, it } from "vitest";
import { createWorld, plotsForSale, unlockPlot } from "../game/world";
import { checkPlacement, looseHeight } from "../landscape";
import { serializeWorld } from "../persist/save";
import type { CarKind } from "../sim";
import { appendPiece, connectorRef, type PieceTypeId } from "../track";
import { writeMapFile } from "./perf-map-file";

const ENV: Record<string, string | undefined> = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const OVAL: readonly PieceTypeId[] = ["curve-large", "curve-large", "curve-large", "straight-216", "curve-large", "curve-large", "curve-large", "curve-large", "straight-216"];
const TRAIN: CarKind[] = ["engine", "passenger", "van", "hopper"];

describe.skipIf(!ENV.PERF_MAPS)("perf maps", () => {
  it("writes the big Sandbox map", async () => {
    const seed = Number(ENV.PERF_SEED ?? 7);
    const trains = Number(ENV.PERF_TRAINS ?? 16);
    const world = createWorld(seed, false, true, false);
    const { layout, landscape: land, sim } = world;
    // More land, as Sandbox's "add land" gives it: the plots for sale nearest the start, one after another.
    const plots = Number(ENV.PERF_PLOTS ?? 24);
    for (let i = 0; i < plots; i++) {
      const p = plotsForSale(land).sort((a, b) => Math.hypot(a.px, a.pz) - Math.hypot(b.px, b.pz))[0];
      if (!p || !unlockPlot(world, p.px, p.pz)) break;
    }
    let ovals = 0;
    const firsts: number[] = [];
    for (let z = -20000; z <= 20000; z += 900)
      for (let x = -20000; x <= 20000; x += 900) {
        if (land.grid.cellAtWorld(x, z) === -1) continue;
        const ids: number[] = [];
        const fits = (id: number): boolean => {
          const p = layout.getPiece(id)!;
          return checkPlacement(land, p.type, p.flipped, p.pose, p.y).kind === "clear" && land.grid.cellAtWorld(p.pose.x, p.pose.z) !== -1;
        };
        const pose = { x, z, heading: 0 };
        const y = looseHeight(land, layout, "curve-large", false, pose, -1);
        let last = layout.addPiece("curve-large", pose, y);
        ids.push(last);
        let ok = fits(last);
        for (const type of OVAL) {
          if (!ok) break;
          last = appendPiece(layout, type, false, connectorRef(last, 1));
          ids.push(last);
          ok = fits(last);
        }
        if (!ok) {
          for (const id of ids.reverse()) layout.removePiece(id);
          continue;
        }
        ovals++;
        firsts.push(ids[4]);
      }
    let placed = 0;
    for (const pieceId of firsts) {
      if (placed >= trains) break;
      if (sim.addTrain(TRAIN, { pieceId, pathIndex: 0, s: 100, reversed: false }).kind === "placed") placed++;
    }
    // Every engine set going (its lever forward), as a tap on Go does.
    for (const id of sim.trainIds()) for (const c of sim.getTrain(id)!.cars) if (c.kind === "engine") sim.setLever(c.id, 1);
    const keys = { "woodrail.autosave.v3": JSON.stringify(serializeWorld(world)) };
    const file = ENV.PERF_MAP_OUT ?? "tools/perf/maps/big-sandbox.txt";
    await writeMapFile(file, "sandbox", keys);
    console.log(`big sandbox: seed ${seed}, ${ovals} ovals, ${layout.pieceCount} pieces, ${placed} trains → ${file}`);
    expect(ovals).toBeGreaterThan(10);
  });
});
