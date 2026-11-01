import { describe, expect, it } from "vitest";
import { buildStarterWorld, type World } from "../../game/world";
import { editLine } from "../../game/lines";
import { readMapText } from "../../persist/bug-map";
import { appendPiece, connectorRef } from "../../track";
import { bugMapText, describeBreak, loadBugMap, replayBugMap } from "../bugmap";

/**
 * Bug maps (architecture review §3.6): each map here is a "Copy map for a bug report" text, loaded headless and run
 * with the invariants on (src/play/bugmap.ts); each must stay green. A play-test report's map goes in as a file with
 * an entry in `MAPS`: what it was for, how long to run it, and its payoff.
 *
 *   npm run replay -- <file>          (any copied map, outside the tests: prints the first break)
 *   BUGMAP_WRITE=1 npx vitest run src/play/bugmaps   (writes the hand-made maps again from their builders)
 */

const ENV: Record<string, string | undefined> = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
/** The maps in this folder, by file name (bundled by Vite as text). */
const FILES: Record<string, string> = Object.fromEntries(Object.entries(import.meta.glob("./*.txt", { query: "?raw", import: "default", eager: true }) as Record<string, string>).map(([k, v]) => [k.slice(2), v]));
/** Node's fs, for writing the hand-made maps and reading one named on the command line (tests run in Node). */
const fs = async () => (await import(/* @vite-ignore */ "node:" + "fs")) as { readFileSync(path: string, enc: "utf8"): string; writeFileSync(path: string, text: string): void };

/**
 * Hand-made: the starter map's forest yard, a line from it past a siding's points to a sawmill laid at the far end,
 * buffers at both ends, and one timber train on the line. (Made in code, not copied from the game: an example of the
 * format and of the loop, not a play-test report.)
 */
function shuttle(): { world: World; sw: number } {
  const world = buildStarterWorld();
  const L = world.layout;
  const forest = world.depots.get(world.landscape.depots.find((d) => d.kind === "forest")!.id)!;
  const chainFrom = (ref: number, types: Parameters<typeof appendPiece>[1][]) => {
    const ids: number[] = [];
    for (const t of types) {
      const id = appendPiece(L, t, false, ref);
      ids.push(id);
      ref = connectorRef(id, 1);
    }
    return ids;
  };
  const east = chainFrom(connectorRef(forest, 1), ["straight-216", "straight-216", "switch", "straight-216", "straight-216", "depot-sawmill", "buffer-turnback"]);
  chainFrom(connectorRef(forest, 0), ["straight-216", "straight-216", "buffer-turnback"]);
  const sw = east[2];
  chainFrom(connectorRef(sw, 2), ["straight-216", "buffer-turnback"]);
  const saw = world.economy.addDepot("sawmill", east[5]);
  const placed = world.sim.addTrain(["engine", "timber", "timber"], { pieceId: east[1], pathIndex: 0, reversed: false, s: 200 });
  if (placed.kind !== "placed") throw new Error("no room for the train");
  const engine = world.sim.getTrain(placed.trainId)!.cars[0].id;
  const forestDepot = world.economy.depotAtPiece(forest)!;
  editLine(world.economy, engine, (st) => st.push({ depotId: forestDepot.id, action: "auto" }, { depotId: saw.id, action: "auto" }));
  world.sim.setLever(engine, 1);
  return { world, sw };
}

/** The maps here: the file, how long it runs, and the least stops each routed train must come to (its payoff). */
const MAPS: { file: string; seconds: number; arrivals: number; what: string }[] = [
  { file: "hand-made-shuttle.txt", seconds: 600, arrivals: 6, what: "hand-made: a timber train between the forest and a sawmill, past a siding" },
  // (The long goals play-through's map at 13305 s (minute 221.75), 109 s before its first wrongRoad, the plot Show me
  // frames bought (claude/speed-words-land-goal). Its goods train runs through stops with nothing to do; at 87.7 s it's
  // still at a stop (piece 1315), its tail on it, its front past the next stop (piece 2) and onto points 573980.
  // Heading for piece 2, under it, it asked for nothing and took the points as they lay: a wrong road, every lap. Now it
  // heads for the stop after (Economy.goalOf, `ranOnto`). Captured by a snapshot every 15 s in the play-through.)
  { file: "goals-long-ran-through-stop.txt", seconds: 300, arrivals: 12, what: "the long goals play-through's line: a long train at a stop, its front past the next one, onto points" },
];

describe("bug maps: copied maps replayed with the invariants on", () => {
  for (const m of MAPS)
    it(`${m.file} (${m.what}): no invariant breaks in ${m.seconds} s, and each routed train comes to ${m.arrivals}+ stops`, async () => {
      const { world } = await loadBugMap(FILES[m.file] ?? "");
      const r = replayBugMap(world, { seconds: m.seconds });
      expect(r.first && describeBreak(r.first)).toBeNull();
      expect(r.seconds).toBe(m.seconds);
      expect(r.arrivals.size).toBeGreaterThan(0);
      for (const [engine, n] of r.arrivals) expect(n, `engine ${engine}`).toBeGreaterThanOrEqual(m.arrivals);
    }, 60_000);

  it("the hand-made map is its builder's (BUGMAP_WRITE=1 writes it again)", async () => {
    const text = await bugMapText(shuttle().world, "game");
    if (ENV.BUGMAP_WRITE) (await fs()).writeFileSync(new URL("./hand-made-shuttle.txt", import.meta.url).pathname, text + "\n");
    else expect(await readMapText(FILES["hand-made-shuttle.txt"] ?? "")).toEqual(await readMapText(text));
  });

  it("reports the first break: what, when, and the piece (control: the siding's points pinned, then thrown at 2 s under the train)", async () => {
    const made = shuttle();
    const { world } = await loadBugMap(await bugMapText(made.world, "game"));
    // (Piece ids last through a save, so the builder's id for the points is the loaded map's.)
    const sw = made.sw;
    world.layout.setPinned(sw, true);
    const r = replayBugMap(world, { seconds: 60, events: [{ at: 2, do: (w) => w.layout.setSwitchState(sw, w.layout.switchState(sw) === 0 ? 1 : 0) }] });
    expect(r.first).toMatchObject({ invariant: "underTrain", pieceId: sw });
    expect(describeBreak(r.first!)).toBe(`underTrain at 2.0 s: points ${sw} thrown to ${world.layout.switchState(sw)} under a train`);
    // (A pinned one too: seen at the throw, and as moved by that tick's check.)
    expect(r.checks.broke.pinned.count).toBeGreaterThan(0);
    // (It stops at the first break.)
    expect(r.seconds).toBeCloseTo(2, 1);
  });

  it("a replay is repeatable: the same map and seed, the same run", async () => {
    const text = await bugMapText(shuttle().world, "game");
    const runs = await Promise.all([0, 1].map(async () => replayBugMap((await loadBugMap(text)).world, { seconds: 120 })));
    expect([...runs[0].arrivals]).toEqual([...runs[1].arrivals]);
  });
});

/** Any copied map (`npm run replay -- <file>`: REPLAY_FILE): its first break printed; the test fails on one. */
describe.skipIf(!ENV.REPLAY_FILE)("replay a copied map (npm run replay)", () => {
  it(`${ENV.REPLAY_FILE}`, async () => {
    const { mode, world } = await loadBugMap((await fs()).readFileSync(ENV.REPLAY_FILE!, "utf8"));
    const seconds = Number(ENV.REPLAY_SECONDS ?? 600);
    const r = replayBugMap(world, { seconds, seed: Number(ENV.REPLAY_SEED ?? 1), stopAtFirst: !ENV.REPLAY_ALL });
    const stops = [...r.arrivals].map(([e, n]) => `engine ${e}: ${n}`).join(", ") || "no routed trains";
    console.log(`replay: a ${mode} map, ${world.sim.trainIds().length} trains, ${r.seconds.toFixed(1)} s run; stops ${stops}`);
    console.log(r.first ? `replay: first break: ${describeBreak(r.first)}${r.first.engine !== undefined ? ` (engine ${r.first.engine})` : ""}${r.first.pieceId !== undefined ? ` (piece ${r.first.pieceId})` : ""}` : `replay: the invariants held for ${seconds} s`);
    if (ENV.REPLAY_ALL && r.checks.count > 0) console.log(`replay: all breaks: ${r.checks.summary()}`);
    expect(r.first && describeBreak(r.first)).toBeNull();
  }, 3_600_000);
});
