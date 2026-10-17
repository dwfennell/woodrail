import { describe, expect, it } from "vitest";
import { appendPiece, connectorRef } from "../track";
import { inUse, Progress } from "./progress";
import { thingsFor } from "./things";
import { buildStarterWorld } from "./world";

describe("the toy box", () => {
  it("starts with a timber train, two turnbacks and a workshop; plain track is free", () => {
    const w = buildStarterWorld();
    const p = Progress.fresh();
    expect(p.available(w, "car:engine")).toBe(1);
    expect(p.available(w, "car:timber")).toBe(3);
    expect(p.available(w, "piece:buffer-turnback")).toBe(2);
    expect(p.available(w, "piece:depot-workshop")).toBe(1);
    expect(p.available(w, "piece:straight-216")).toBe(Infinity);
    expect(p.available(w, "piece:switch")).toBe(0);
  });

  it("has no other workshop once the one in the box is placed (no ready-next piece then); plain straights never run out", () => {
    const w = buildStarterWorld();
    const p = Progress.fresh();
    const shop = { kind: "piece" as const, type: "depot-workshop" as const };
    expect(p.hasAnother(w, shop)).toBe(true);
    const station = w.stations.get(w.landscape.towns[0].id)!;
    appendPiece(w.layout, "depot-workshop", false, connectorRef(station, 1));
    expect(p.hasAnother(w, shop)).toBe(false);
    expect(p.hasAnother(w, { kind: "piece", type: "straight-216" })).toBe(true);
  });

  it("counts what's on the map, so taking a piece up gives it back", () => {
    const w = buildStarterWorld();
    const p = Progress.fresh();
    const station = w.stations.get(w.landscape.towns[0].id)!;
    const id = appendPiece(w.layout, "buffer-turnback", false, connectorRef(station, 1));
    expect(inUse(w, "piece:buffer-turnback")).toBe(1);
    expect(p.available(w, "piece:buffer-turnback")).toBe(1);
    w.layout.removePiece(id);
    expect(p.available(w, "piece:buffer-turnback")).toBe(2);
  });

  it("doesn't count the map's own depots as the player's", () => {
    const w = buildStarterWorld();
    expect(inUse(w, "piece:depot-sawmill")).toBe(0);
  });

  it("says what's short for a tray item: unknown, or none left", () => {
    const w = buildStarterWorld();
    const p = Progress.fresh();
    expect(p.short(w, thingsFor({ kind: "train", cars: ["engine", "timber", "timber", "timber"] }))).toBeNull();
    expect(p.short(w, thingsFor({ kind: "train", cars: ["engine", "timber", "timber", "timber", "timber"] }))).toBe("car:timber");
    // Switches need their blueprint first, however many are owned.
    p.add("piece:switch", 2);
    expect(p.short(w, thingsFor({ kind: "piece", type: "switch" }))).toBe("piece:switch");
    p.learned.add("switches");
    expect(p.short(w, thingsFor({ kind: "piece", type: "switch" }))).toBeNull();
    expect(p.short(w, thingsFor({ kind: "piece", type: "straight-216" }))).toBeNull();
  });

  it("saves and loads, dropping what it doesn't know, and never owns less than the map holds", () => {
    const p = Progress.fresh();
    p.learned.add("bridges");
    const back = Progress.fromJSON(JSON.parse(JSON.stringify({ ...p.toJSON(), owned: [...p.toJSON().owned, ["piece:nonsense", 3], ["car:engine", -2]] })));
    expect(back.owned.get("car:timber")).toBe(3);
    expect(back.owned.has("piece:nonsense" as never)).toBe(false);
    expect(back.learned.has("bridges")).toBe(true);
    const w = buildStarterWorld();
    const station = w.stations.get(w.landscape.towns[0].id)!;
    appendPiece(w.layout, "switch", false, connectorRef(station, 1));
    const old = new Progress();
    old.coverMap(w);
    expect(old.owned.get("piece:switch")).toBe(1);
  });
});
