import { describe, expect, it } from "vitest";
import { Economy, type StationEvent } from "../economy";
import { Sim, SIM_HZ, type CarKind, type Train } from "../sim";
import { appendPiece, connectorRef, createWorldConnector, getPieceDef, Layout, type PieceTypeId } from "../track";
import { boardKey, BOARD_ROWS, departures } from "./departures";
import { editLine, startLine } from "./lines";
import { attachPassengers } from "./passengers";
import { Progress } from "./progress";
import { STATION_CRANE_AT, type World } from "./world";

// The stations' little touches are driven by the economy's station events (a halt, someone on or off, the train off)
// and its `nextVersion` (departure boards): checked here through real stops, the sim and economy ticking.

function lay(layout: Layout, ref: number, type: PieceTypeId): number {
  const end = layout.worldConnector(ref, { x: 0, z: 0, heading: 0, y: 0, kind: "peg" });
  const via = getPieceDef(type, false).connectors.findIndex((c) => c.kind !== end.kind);
  return appendPiece(layout, type, false, ref, via);
}
const otherEnd = (layout: Layout, id: number) => [0, 1].map((k) => connectorRef(id, k)).find((r) => layout.joinedConnector(r) === -1)!;
function endAt(layout: Layout, ref: number): void {
  const end = layout.worldConnector(ref, { x: 0, z: 0, heading: 0, y: 0, kind: "peg" });
  lay(layout, end.kind === "peg" ? ref : otherEnd(layout, lay(layout, ref, "adapter-peg")), "buffer-turnback");
}

/** Town A's station, three straights, town B's station, a turnback past each: a coach train heading for B. */
function twoTowns(cars: CarKind[] = ["engine", "passenger"]) {
  const layout = new Layout();
  const a = layout.addPiece("station", { x: 0, z: 0, heading: 0 });
  endAt(layout, connectorRef(a, 0));
  const s0 = lay(layout, connectorRef(a, 1), "straight-216");
  let last = s0;
  for (let i = 0; i < 2; i++) last = lay(layout, otherEnd(layout, last), "straight-216");
  const b = lay(layout, otherEnd(layout, last), "station");
  endAt(layout, otherEnd(layout, b));
  const sim = new Sim(layout);
  if (sim.addTrain(cars, { pieceId: s0, pathIndex: 0, reversed: false, s: 150 }).kind !== "placed") throw new Error("no room");
  const economy = new Economy(layout, sim);
  const A = economy.addDepot("town", a, 0, STATION_CRANE_AT);
  const B = economy.addDepot("town", b, 1, STATION_CRANE_AT);
  const w = { layout, sim, economy, stations: new Map([[0, a], [1, b]]) } as unknown as World;
  const train = () => sim.getTrain(sim.trainIds()[0])!;
  sim.setLever(train().cars.find((c) => c.kind === "engine")!.id, 1);
  const events: StationEvent[] = [];
  const run = (seconds: number) => {
    for (let i = 0; i < seconds * SIM_HZ; i++) {
      sim.tick();
      economy.tick();
      events.push(...economy.drainStationEvents());
    }
  };
  return { w, sim, economy, A, B, a, b, train, events, run };
}

describe("station events", () => {
  it("a coach train at a station: halted, people off and on, then left once, at that station's piece", () => {
    const { w, economy, A, B, b, train, events, run } = twoTowns();
    attachPassengers(w, () => Progress.fresh());
    const coach = train().cars.find((c) => c.kind === "passenger")!.id;
    // Two riders from A on board, three waiting at B.
    economy.setRiders(coach, 2, A.id);
    B.waiting = 3;
    run(12);
    const atB = events.filter((e) => e.pieceId === b);
    const kinds = atB.map((e) => e.kind);
    expect(kinds[0]).toBe("halted");
    expect(kinds.filter((k) => k === "off")).toHaveLength(2);
    expect(kinds.filter((k) => k === "on")).toHaveLength(3);
    // Off before on (people get off first), and one "left" once it's done, last.
    expect(kinds.lastIndexOf("off")).toBeLessThan(kinds.indexOf("on"));
    expect(kinds.filter((k) => k === "halted")).toHaveLength(1);
    expect(kinds.filter((k) => k === "left")).toHaveLength(1);
    expect(kinds[kinds.length - 1]).toBe("left");
    for (const e of atB.filter((e) => e.kind === "on" || e.kind === "off")) expect(e.carId).toBe(coach);
    expect(B.waiting).toBe(0);
    expect(economy.ridersOf(coach)).toEqual({ count: 3, from: B.id });
  });

  it("a train with nothing to do at a station runs through: no events there", () => {
    const { b, events, run } = twoTowns(["engine", "passenger"]);
    // Sandbox: no seats, so no stops at stations.
    run(12);
    expect(events.filter((e) => e.pieceId === b)).toEqual([]);
  });

  it("undrained (tests, headless runs), the log stays small", () => {
    const { economy } = twoTowns();
    const e = economy as unknown as { stationLog: StationEvent[]; stationNote: (...a: unknown[]) => void };
    for (let k = 0; k < 200; k++) e.stationNote("on", 1, 1, 1);
    expect(e.stationLog.length).toBeLessThanOrEqual(64);
  });

  it("a kit's stop (Sandbox's platform): halted, then left after its dwell", () => {
    const layout = new Layout();
    const c = createWorldConnector();
    let at = { x: 0, z: 0, heading: 0 };
    const ids: number[] = [];
    for (const type of ["straight-216", "kit-two-platform-station", "straight-216", "straight-216"] as PieceTypeId[]) {
      const id = layout.addPiece(type, at);
      ids.push(id);
      layout.worldConnector(connectorRef(id, 1), c);
      at = { x: c.x, z: c.z, heading: c.heading };
    }
    endAt(layout, connectorRef(ids[3], 1));
    const sim = new Sim(layout);
    const economy = new Economy(layout, sim);
    if (sim.addTrain(["engine", "passenger"], { pieceId: ids[0], pathIndex: 0, reversed: false, s: 200 }).kind !== "placed") throw new Error("no room");
    const train = () => sim.getTrain(sim.trainIds()[0])! as Train;
    sim.setLever(train().cars[0].id, 1);
    const seen: { kind: string; t: number }[] = [];
    for (let i = 0; i < 10 * SIM_HZ; i++) {
      sim.tick();
      economy.tick();
      for (const e of economy.drainStationEvents()) if (e.pieceId === ids[1]) seen.push({ kind: e.kind, t: i / SIM_HZ });
    }
    expect(seen.map((s) => s.kind)).toEqual(["halted", "left"]);
    // Its dwell: 4 s.
    expect(seen[1].t - seen[0].t).toBeGreaterThan(3.9);
  });
});

describe("departure boards", () => {
  it("lists the trains due, each with where it heads after, and changes only as their next stops do", () => {
    const { economy, A, B, train, run } = twoTowns();
    const engine = train().cars[0].id;
    const names = new Map([
      [A.id, "Ashby"],
      [B.id, "Brook"],
    ]);
    const nameOf = (id: number) => names.get(id)!;
    expect(departures(economy, B.id, nameOf)).toEqual([]);
    const v0 = economy.nextVersion;
    const line = startLine(economy, engine, [
      { depotId: B.id, action: "auto" },
      { depotId: A.id, action: "auto" },
    ]);
    expect(economy.nextVersion).not.toBe(v0);
    expect(departures(economy, B.id, nameOf)).toEqual([{ colour: line.colour, text: `${line.name} → Ashby` }]);
    // Not due at A yet.
    expect(departures(economy, A.id, nameOf)).toEqual([]);
    // Unchanged while it runs on toward B; changed as it leaves B (now due at A).
    const v1 = economy.nextVersion;
    run(1);
    expect(economy.nextVersion).toBe(v1);
    for (let k = 0; k < 40 && economy.routeOf(engine)!.next === 0; k++) run(1);
    expect(economy.nextVersion).not.toBe(v1);
    expect(departures(economy, A.id, nameOf)).toEqual([{ colour: line.colour, text: `${line.name} → Brook` }]);
    expect(departures(economy, B.id, nameOf)).toEqual([]);
    // A line edit is seen too.
    const v2 = economy.nextVersion;
    editLine(economy, engine, (stops) => stops.reverse());
    expect(economy.nextVersion).not.toBe(v2);
  });

  it("at most BOARD_ROWS rows, none twice; the key changes with the rows", () => {
    const lines = new Map<number, { id: number; colour: string; name: string; stops: { depotId: number; action: "auto" }[] }>();
    const lineIdOf = new Map<number, number>();
    const routes = new Map<number, { stops: { depotId: number; action: "auto" }[]; next: number }>();
    for (let k = 0; k < 5; k++) {
      const stops = [
        { depotId: 1, action: "auto" as const },
        { depotId: 10 + (k % 4), action: "auto" as const },
      ];
      lines.set(k, { id: k, colour: `#00000${k}`, name: `Line ${k % 4}`, stops });
      lineIdOf.set(100 + k, k);
      routes.set(100 + k, { stops, next: 0 });
    }
    const economy = { lines, lineIdOf, routeOf: (e: number) => routes.get(e) } as unknown as Parameters<typeof departures>[0];
    const rows = departures(economy, 1, (id) => `Stop ${id}`);
    expect(rows).toHaveLength(BOARD_ROWS);
    expect(new Set(rows.map((r) => r.text)).size).toBe(rows.length);
    expect(rows[0].text).toBe("Line 0 → Stop 10");
    const before = boardKey(rows);
    routes.get(100)!.next = 1;
    expect(boardKey(departures(economy, 1, (id) => `Stop ${id}`))).not.toBe(before);
  });
});
