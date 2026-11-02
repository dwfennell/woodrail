import { describe, expect, it } from "vitest";
import { SURF_ROAD } from "../landscape";
import { roadAt } from "../roads/graph";
import { pieceForEdges } from "../roads/pieces";
import { appendPiece, connectorRef } from "../track";
import { BUS_SEATS, BUS_STOP, Buses } from "./buses";
import { onTheLine, roadBetween } from "./feeders-testing";
import { peopleArrive, waitingCap } from "./passengers";
import { Progress } from "./progress";
import { techOf } from "./tech";
import { THING_RULES } from "./things";
import { Vans } from "./vans";
import { buildStarterWorld } from "./world";

/**
 * Buses (roads spec D6) on the starter map: Larkfield's station on the line, Elderwick off it, six road squares apart.
 * People turn up at stations by the game's own rule (`peopleArrive`); setup shortcuts (named): the road and the track
 * (`feeders-testing.ts`), and the bus stop put down by the prop store as a drop from the tray does.
 */
function setup(learned = true) {
  const w = buildStarterWorld();
  const a = w.landscape.towns.find((t) => t.name === "Larkfield")!;
  const b = w.landscape.towns.find((t) => t.name === "Elderwick")!;
  const road = roadBetween(w, a, b);
  onTheLine(w, a.id);
  const progress = new Progress();
  progress.learned.add("passengers");
  if (learned) progress.learned.add("buses");
  const vans = new Vans(() => w, () => ({ version: 0, has: () => false }));
  const buses = new Buses({ world: w, vans, knows: () => progress.learned.has("buses"), room: () => waitingCap(progress) });
  const station = w.stations.get(a.id)!;
  const pose = w.layout.getPiece(station)!.pose;
  const stop = () => w.props.add(BUS_STOP, { x: pose.x + Math.cos(pose.heading + Math.PI / 2) * 90, z: pose.z + Math.sin(pose.heading + Math.PI / 2) * 90, heading: pose.heading, y: 0 });
  const depot = (townId: number) => w.economy.allDepots().find((d) => d.role === "town" && d.townId === townId && w.stations.get(townId) === d.pieceId)!;
  const clock = new Map<number, number>();
  /** Game time: the economy's ticks (the bus moves), and people turning up once a second, the bus looking then too. */
  const run = (seconds: number) => {
    for (let s = 0; s < seconds; s++) {
      for (let k = 0; k < 120; k++) w.economy.tick();
      peopleArrive(w, progress, 1, clock);
      buses.update();
    }
  };
  return { w, a, b, road, buses, vans, stop, depot, run, progress };
}

describe("buses (roads spec D6)", () => {
  it("is on the board: after Delivery vans and Halts, 3 planks and 120 coins; the bus stop is free once learned", () => {
    expect([techOf("buses")!.plan, techOf("buses")!.needs, techOf("buses")!.research]).toEqual([undefined, ["vans", "halts"], { goods: { planks: 3 }, coins: 120 }]);
    expect(THING_RULES["prop:scene-bus-stop"]).toMatchObject({ tech: "buses", free: true });
  });

  it("a bus stop beside a station on the line, joined by road to a town off it: a bus parks there; not before", () => {
    const s = setup(false);
    s.road.lay();
    s.stop();
    s.buses.sync();
    expect(s.vans.vehicles.list).toHaveLength(0);
    s.progress.learned.add("buses");
    s.buses.sync();
    expect(s.buses.runOf(s.depot(s.a.id).id)?.townId).toBe(s.b.id);
    expect(s.vans.vehicles.list.map((v) => [v.kind, v.leg])).toEqual([["bus", "home"]]);
  });

  it("a street by the stop that isn't joined to the road out: the bus parks on the next nearest that is", () => {
    const s = setup();
    s.road.lay();
    const g = s.w.landscape.grid;
    const stop = s.stop();
    // (A town that grew can have one: a lone street square of Larkfield's, nearer the stop than any other.)
    const roads = new Set(s.a.cells.filter((i) => g.surface[i] === SURF_ROAD && roadAt(s.w.landscape, i) !== 0));
    const dist = (i: number) => Math.hypot(g.centreX(g.colOf(i)) - stop.x, g.centreZ(g.rowOf(i)) - stop.z);
    const near = Math.min(...[...roads].map(dist));
    // (Laid facing away from the streets: no way from it to Elderwick.)
    const elder = new Set(s.b.cells);
    const toElder = (i: number) => s.vans.way([i], (j) => elder.has(j) && g.surface[j] === SURF_ROAD, `lone${i}`, 64);
    let lone = -1;
    for (const i of s.a.cells.filter((i) => g.surface[i] !== SURF_ROAD && g.road[i] === 0 && dist(i) < near).sort((x, y) => dist(x) - dist(y))) {
      for (const edges of [1 | 4, 2 | 8]) {
        const was = g.surface[i];
        // (A town's own street: its piece on street ground, as growTown lays it.)
        g.setRoad(i, pieceForEdges(edges));
        g.surface[i] = SURF_ROAD;
        g.touch();
        if (toElder(i) === null) lone = i;
        else {
          g.setRoad(i, 0);
          g.surface[i] = was;
          g.touch();
        }
        if (lone !== -1) break;
      }
      if (lone !== -1) break;
    }
    expect(lone).not.toBe(-1);
    s.buses.sync();
    const run = s.buses.runOf(s.depot(s.a.id).id);
    expect(run?.townId).toBe(s.b.id);
    expect(run?.home).not.toBe(lone);
    expect(roads.has(run!.home)).toBe(true);
    expect(s.vans.vehicles.list.map((v) => v.kind)).toEqual(["bus"]);
  });

  it("no stop, no bus; and none to a town whose station is on the line", () => {
    const s = setup();
    s.road.lay();
    s.buses.sync();
    expect(s.vans.vehicles.list).toHaveLength(0);
    s.stop();
    appendPiece(s.w.layout, "straight-216", false, connectorRef(s.w.stations.get(s.b.id)!, 1));
    s.buses.sync();
    expect(s.vans.vehicles.list).toHaveLength(0);
  });

  it("brings the people waiting in the town off the line to the station, for its trains", () => {
    const s = setup();
    s.road.lay();
    s.stop();
    const home = s.depot(s.a.id);
    const far = s.depot(s.b.id);
    // People turn up at both (no train has come yet): Larkfield's platform fills (the bus's riders on it too: they're
    // let off though people turned up meanwhile), and then there's no room for more.
    s.run(120);
    expect(far.waiting).toBeGreaterThan(0);
    expect(home.waiting).toBeGreaterThanOrEqual(waitingCap(s.progress));
    expect(home.waiting).toBeLessThanOrEqual(waitingCap(s.progress) + BUS_SEATS);
    expect(s.vans.vehicles.list[0].leg).toBe("home");
    // A train takes Larkfield's people (as a coach boards them): room, and the bus goes.
    home.waiting = 0;
    const before = far.waiting;
    s.run(3);
    const bus = s.vans.vehicles.list[0];
    expect(bus.leg).toBe("out");
    // (A second at a time, till it's back: with room still at home, it loads to go again at once.)
    const back = () => bus.leg === "home" || bus.leg === "loading";
    for (let k = 0; k < 40 && !back(); k++) s.run(1);
    expect(back()).toBe(true);
    const brought = Math.min(BUS_SEATS, before);
    expect(far.waiting).toBeLessThanOrEqual(before - brought + 2);
    expect(home.waiting).toBeGreaterThanOrEqual(brought);
    expect(home.waiting).toBeLessThanOrEqual(waitingCap(s.progress) + BUS_SEATS);
  });

  it("the road taken up: the bus is put away once home, and nobody is lost", () => {
    const s = setup();
    s.road.lay();
    s.stop();
    s.run(60);
    s.depot(s.a.id).waiting = 0;
    s.run(4);
    expect(s.vans.vehicles.list[0].leg).not.toBe("home");
    // (Cut while it's out: it comes back with whoever it has, or turns back with no one.)
    s.w.landscape.grid.setRoad(s.road.squares[2], 0);
    s.w.landscape.grid.touch();
    const total = () => s.depot(s.a.id).waiting + s.depot(s.b.id).waiting;
    s.run(30);
    expect(s.vans.vehicles.list).toHaveLength(0);
    expect(total()).toBeGreaterThan(0);
  });
});
