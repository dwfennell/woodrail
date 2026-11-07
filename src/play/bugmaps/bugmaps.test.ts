import { describe, expect, it } from "vitest";
import { buildStarterWorld, type World } from "../../game/world";
import { editLine, stopLine } from "../../game/lines";
import { legFromCursor } from "../../game/route-path";
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
  // (Hilly: the starter map as it was when the file was written, before the gentler default.)
  const world = buildStarterWorld(true, "hilly");
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
  // (Play-test 2026-11-01: four hand-run trains round a ring, one then given a route, Mill ⇄ Farm yard. The line's
  // sections took the hand-run trains in, three of them in the ring's one section, each waiting on the next: all four
  // stuck from the first second, no stop in 600 s. Now a train follows one on no line going its way.)
  { file: "route-stuck.txt", seconds: 600, arrivals: 4, what: "play-test: a routed train among hand-run trains following each other round a ring" },
  // (Issue #29, 2026-11-05: "This train is blocked by a train all the way on the other side of the map!" (v154). The
  // routed train, and a hand-run one, waited for good on an engine parked across the map: on no line, standing in the
  // map's one big section, it was the end of the line for every move through it, on the way or not. Now a train
  // standing off a way isn't in it (`Sections.ask`, `heldIn`). Stuck 295 s of 300 with no stop, it's now 0 s, 8 stops.)
  { file: "far-train.txt", seconds: 300, arrivals: 6, what: "issue #29: a train held by an engine parked across the map" },
  // (QA 2026-11-06, docs/agents/qa/maps/2026-11-06-signals-mill-wait.txt: engine 44 (Yellow, the mill and three towns)
  // stood for good at the path signal by the mill, its way clear, held by sections for engine 48 (Green, a hopper
  // shuttle farm ⇄ mill), which always ran on part of its way. Sections took 44's way on past the mill as the points
  // lay, into the shuttle's loop, not toward its next town; and Green, with signals' waiting points only, wasn't
  // managed: never asked to wait, it never gave a turn. Now the way goes on toward the stop after, and a one-train
  // line of signals sharing a network takes its turns (`Sections.line`). Stuck 300 s with no stop; now 8 stops.)
  { file: "signals-mill-wait.txt", seconds: 300, arrivals: 4, what: "QA: a towns line held at the mill by a hopper shuttle sharing its track" },
  // (Issue #32, 2026-11-07 (build mw5rjr7b): four lines' trains and a hand-run hopper train stood 600 s in a ring of
  // waits, a signal added at the sawmill as the card said. Sections had sent the goods train into the passing loop
  // behind the timber train standing there, the loop's other road empty; now an empty road comes first
  // (`Sections.wayOn`) and they run as laid, nobody turning round. #31's map, the same without that signal, is a real
  // ring (a signal inside the loop road holds a train over its points): its cards say so (signal-green-held.test.ts).)
  { file: "signal-added-still-stuck.txt", seconds: 300, arrivals: 4, what: "issue #32: four lines and a hand-run train meeting at a passing loop, a signal added" },
];

describe("bug maps: copied maps replayed with the invariants on", () => {
  for (const m of MAPS)
    it(`${m.file} (${m.what}): no invariant breaks in ${m.seconds} s, and each routed train comes to ${m.arrivals}+ stops`, async () => {
      const { world } = await loadBugMap(FILES[m.file] ?? "");
      const r = replayBugMap(world, { seconds: m.seconds });
      expect(r.first && describeBreak(r.first)).toBeNull();
      expect(r.seconds).toBe(m.seconds);
      expect(r.arrivals.size).toBeGreaterThan(0);
      // (Every routed train, one that came to none too: it isn't in `arrivals`, and a train stood for good is the bug.)
      for (const engine of new Set([...world.economy.lineIdOf.keys(), ...r.arrivals.keys()])) expect(r.arrivals.get(engine) ?? 0, `engine ${engine}`).toBeGreaterThanOrEqual(m.arrivals);
    }, 60_000);

  it("route-stuck.txt: the route planned again as the player did (Mill, then Farm yard): it heads for the farm yard, ahead of it, and its way there keeps off the middle line", async () => {
    const { world } = await loadBugMap(FILES["route-stuck.txt"] ?? "");
    const eco = world.economy;
    // (Engine 9, just past the mill on the viaduct road, heading away from it; the mill depot on piece 160, the farm
    // yard's on 91. Before, it headed for the mill: the whole way round, by the middle line through Foxley and
    // Buttercombe, piece 109 by the school.)
    const [mill, farm] = eco.routeOf(9)!.stops.map((st) => st.depotId);
    stopLine(eco, 9);
    editLine(eco, 9, (st) => st.push({ depotId: mill, action: "auto" }));
    editLine(eco, 9, (st) => st.push({ depotId: farm, action: "auto" }));
    expect(eco.routeOf(9)!.next).toBe(1);
    const leg = legFromCursor(world.layout, { ...world.sim.findCar(9)!.train.bogies[0] }, eco.depot(farm)!.pieceId);
    expect(leg && leg.some((r) => r.pieceId === 109)).toBe(false);
  });

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
