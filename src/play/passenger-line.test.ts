import { describe, expect, it } from "vitest";
import { Editor } from "../editor/editor";
import { attachPassengers, peopleArrive } from "../game/passengers";
import { Progress } from "../game/progress";
import { ready, techOf } from "../game/tech";
import { buildStarterWorld } from "../game/world";
import { SIM_HZ, type CarLook } from "../sim";
import { connectorRef } from "../track";
import { play } from "./player";
import { endOn, rulesFor } from "./rules";

/**
 * A passenger line on the starter map: Larkfield and Elderwick joined, a turnback past each, and a train of an engine
 * and two coaches shuttling between them, on the game's own code. As the passenger line of blueprints is learned the
 * player puts its coaches on (a dining car, a first-class coach, a double-decker, the express engine). Each is
 * researched at a school once enough people are carried: here learned the moment it can be (the research itself is
 * the balance harness's). How long each takes to open, and the fares, are printed: the thresholds are tuned from this.
 */
describe("a passenger line", () => {
  it("carries people between two towns, and learns the passenger line as it goes", () => {
    const w = buildStarterWorld();
    const fixed = new Set([...w.stations.values(), ...w.depots.values()]);
    const editor = new Editor(w.layout, w.sim, () => {}, (id) => fixed.has(id));
    const [a, b] = w.landscape.towns;
    const st = (i: number) => w.stations.get(w.landscape.towns[i].id)!;
    const r = play(w.layout, editor, connectorRef(st(0), 1), connectorRef(st(1), 0), { blocked: rulesFor(w), maxPieces: 60, fiddle: 3 });
    expect(r.ok, `${a.name} → ${b.name}`).toBe(true);
    endOn(w, editor, connectorRef(st(0), 0));
    endOn(w, editor, connectorRef(st(1), 1));

    const p = Progress.fresh();
    p.learned.add("passengers");
    const log: string[] = [];
    const at = (tick: number) => `${(tick / SIM_HZ / 60).toFixed(1).padStart(5)} min`;
    let tick = 0;
    attachPassengers(w, () => p);
    const placed = w.sim.addTrain(["engine", "passenger", "passenger"], { pieceId: st(0), pathIndex: 0, reversed: false, s: 200 });
    if (placed.kind !== "placed") throw new Error("no room");
    const train = () => w.sim.getTrain(w.sim.trainIds()[0])!;
    w.sim.setLever(train().cars[0].id, 1);
    /** What the player does with each new blueprint: put it on the train. */
    const looks: Record<string, [number, CarLook]> = { dining: [1, "dining"], "first-class": [2, "first-class"], "double-decker": [1, "double-decker"], express: [0, "express"] };
    const clock = new Map<number, number>();
    const learnedAt = new Map<string, number>();
    for (; tick < 60 * 60 * SIM_HZ; tick++) {
      w.sim.tick();
      w.economy.tick();
      if (tick % SIM_HZ !== 0) continue;
      peopleArrive(w, p, 1, clock);
      const line = ["dining", "first-class", "stations", "double-decker", "express"].filter((id) => ready(p, id));
      for (const id of line) {
        p.learned.add(id);
        learnedAt.set(id, tick);
        log.push(`${at(tick)}  ${p.riders} carried, ${p.coins} coins: learned ${techOf(id)!.label}`);
        const swap = looks[id];
        if (swap) w.sim.setLook(train().cars[swap[0]].id, swap[1]);
      }
      if (tick % (SIM_HZ * 300) === 0) log.push(`${at(tick)}  ${p.riders} carried, ${p.coins} coins`);
    }
    console.log(["a passenger line:", ...log, `after an hour: ${p.riders} carried, ${p.coins} coins`].join("\n"));
    expect(learnedAt.has("dining"), log.join("\n")).toBe(true);
    expect(learnedAt.get("dining")!).toBeLessThan(15 * 60 * SIM_HZ);
    expect(learnedAt.has("express"), log.join("\n")).toBe(true);
  }, 300_000);
});
