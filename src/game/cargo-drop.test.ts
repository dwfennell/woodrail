import { describe, expect, it } from "vitest";
import { cargoDropTarget, type CargoDropInput } from "./cargo-drop";

const base: CargoDropInput = {
  kind: "log",
  from: { kind: "pile", depotId: 0, cargo: "log" },
  x: 0,
  z: 0,
  carId: -1,
  piles: [
    { depotId: 0, cargo: "log", x: 0, z: 10 },
    { depotId: 1, cargo: "log", x: 40, z: 0 },
    { depotId: 1, cargo: "planks", x: 5, z: 0 },
  ],
  carAccepts: () => true,
  pileAccepts: () => true,
};

describe("cargoDropTarget", () => {
  it("prefers a wagon under the pointer that can take the unit", () => {
    expect(cargoDropTarget({ ...base, carId: 7 })).toEqual({ kind: "car", carId: 7 });
  });

  it("falls back to the nearest pile of the same cargo with room, never its own pile", () => {
    expect(cargoDropTarget({ ...base, carId: 7, carAccepts: () => false })).toEqual({ kind: "pile", depotId: 1, cargo: "log" });
    expect(cargoDropTarget({ ...base, pileAccepts: (id) => id !== 1 })).toBeNull();
  });

  it("goes back when nothing is in reach", () => {
    expect(cargoDropTarget({ ...base, x: 500, z: 500, from: { kind: "car", carId: 3 } })).toBeNull();
  });

  it("never drops a unit back onto the wagon it came from", () => {
    expect(cargoDropTarget({ ...base, carId: 3, from: { kind: "car", carId: 3 }, x: 500 })).toBeNull();
  });
});
