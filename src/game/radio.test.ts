import { describe, expect, it } from "vitest";
import { CARGO } from "../economy";
import { BLUEPRINTS } from "./blueprints";
import { peopleArrive, riderSeconds } from "./passengers";
import { planPower, RADIO_MAST, sharePower } from "./power";
import { Progress } from "./progress";
import { RADIO_REACH, RADIO_RIDERS, radioRiders, radioTowns, townOfMast } from "./radio";
import { THING_RULES } from "./things";
import { buildStarterWorld } from "./world";

describe("the radio", () => {
  it("a mast takes a spark after the electric engines, before the yards", () => {
    const p = sharePower(0, 2, [1], [9], [5, 6]);
    expect([...p.enginesOn, ...p.mastsOn]).toEqual([1, 5]);
    expect(p.yardsOn.size).toBe(0);
    expect(sharePower(1, 0, [], [9], [5]).yardsOn.has(9)).toBe(true);
  });

  it("a mast is the town's it stands in (the nearest middle in reach), or no town's", () => {
    const w = buildStarterWorld();
    const t = w.landscape.towns[0];
    expect(townOfMast(w, t.centre.x + 100, t.centre.z)).toBe(t.id);
    expect(townOfMast(w, t.centre.x + RADIO_REACH * 5, t.centre.z + RADIO_REACH * 5)).toBe(-1);
  });

  it("with a spark, its town's people come 1.5× as often; without, as before", () => {
    const w = buildStarterWorld();
    const t = w.landscape.towns[0];
    const mast = w.props.add(RADIO_MAST, { x: t.centre.x + 100, z: t.centre.z + 100, heading: 0, y: 0 });
    expect(radioTowns(w, planPower(w)).size).toBe(0);
    // A power station with coal: a spark for the mast.
    const power = w.economy.addDepot("power", w.layout.addPiece("depot-power", { x: 9000, z: 9000, heading: 0 }));
    power.piles[CARGO.coal.index] = 1;
    const towns = radioTowns(w, planPower(w));
    expect([...towns]).toEqual([[t.id, mast.id]]);
    expect(radioRiders(towns, t.id)).toBe(RADIO_RIDERS);
    expect(radioRiders(towns, t.id + 1)).toBe(1);
    // The payoff: in the time one person comes to a plain town, the radio's town gets 1.5 (the second at 2/3 of it).
    const p = Progress.fresh();
    p.learned.add("passengers");
    const station = w.economy.depotAtPiece(w.stations.get(t.id)!)!;
    const plain = new Map<number, number>();
    peopleArrive(w, p, (riderSeconds(0) * 2) / RADIO_RIDERS, plain, (id) => radioRiders(towns, id));
    expect(station.waiting).toBe(2);
  });

  it("is a blueprint after Electricity alone, its mast made at the workshop", () => {
    const b = BLUEPRINTS.find((x) => x.id === "radio")!;
    expect(b.needs).toEqual(["electricity"]);
    expect(THING_RULES[`prop:${RADIO_MAST}`]?.tech).toBe("radio");
  });
});
