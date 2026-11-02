import { describe, expect, it } from "vitest";
import { PIECE_TYPES } from "../track";
import { DETAIL_MAX, hasOwnName, pieceInfo, placeCardInfo, recipeWords, trayInfo } from "./piece-info";
import { TRAY_TABS, type TrayItem } from "./tray-catalogue";

const trayItems = (): TrayItem[] => TRAY_TABS.flatMap((t) => t.groups.flatMap((g) => g.items));

describe("piece names", () => {
  it("names every catalogue piece, with a short detail", () => {
    for (const type of PIECE_TYPES) {
      expect(hasOwnName(type), type).toBe(true);
      const { name, detail } = pieceInfo(type);
      expect(name, type).not.toBe("Track piece");
      expect(name.length, type).toBeGreaterThan(0);
      expect(detail.length, type).toBeGreaterThan(0);
      expect(detail.length, `${type}: ${detail}`).toBeLessThanOrEqual(DETAIL_MAX);
    }
  });

  it("calls a tray piece what the tray calls it (its label is in the name)", () => {
    for (const item of trayItems()) {
      if (item.kind !== "piece" || item.auto) continue;
      expect(pieceInfo(item.type).name.toLowerCase(), item.type).toContain(item.label.toLowerCase());
    }
  });

  it("gives the issue's examples", () => {
    expect(pieceInfo("curve-wide").name).toBe("Wide curve");
    expect(pieceInfo("switch-y").name).toBe("Y switch");
    expect(pieceInfo("ramp-curve").name).toBe("Curved ramp");
    expect(pieceInfo("bridge").name).toBe("Bridge");
  });

  it("has a name and short detail for every tray item", () => {
    for (const item of trayItems()) {
      const { name, detail } = trayInfo(item);
      expect(name.length, item.label).toBeGreaterThan(0);
      expect(detail.length, item.label).toBeGreaterThan(0);
      expect(detail.length, `${item.label}: ${detail}`).toBeLessThanOrEqual(DETAIL_MAX);
    }
  });

  it("gives engines their numbers and wagons their loads", () => {
    const item = (label: string) => trayItems().find((i) => i.label === label)!;
    expect(trayInfo(item("Electric")).detail).toBe("Pulls 6 cars, 1.4× as fast. Needs power on.");
    expect(trayInfo(item("Tank engine")).detail).toContain("Pulls 3 cars");
    expect(trayInfo(item("Hopper")).detail).toBe("Carries grain, stone, coal and ore.");
  });
});

describe("the place card (a tray item ready to place)", () => {
  const engine = (look: string): TrayItem => trayItems().find((i) => i.kind === "train" && i.cars.length === 1 && i.cars[0] === "engine" && (i.looks?.[0] ?? "classic") === look)!;

  it("gives an engine's pulls and speed, and what sets it apart", () => {
    expect(placeCardInfo(engine("classic"))).toEqual({ name: "Engine", detail: "Pulls a train of wagons and coaches.", facts: ["Pulls 4 cars · steady", "A good all-round engine."] });
    expect(placeCardInfo(engine("tank")).facts).toEqual(["Pulls 3 cars · steady", "Starts and stops in half the time."]);
    expect(placeCardInfo(engine("goods")).facts).toEqual(["Pulls 8 cars · slow", "Pulls the most cars, but slow to start."]);
    expect(placeCardInfo(engine("express")).facts[1]).toBe("The fastest engine.");
    expect(placeCardInfo(engine("electric")).facts[1]).toBe("Runs only while a power station has coal.");
    expect(placeCardInfo(engine("diesel")).facts[1]).toBe("Pulls more than the Engine, and faster.");
  });

  it("says what an industry makes, from what", () => {
    expect(recipeWords("sawmill")).toBe("Makes planks from logs · every 8 s");
    expect(recipeWords("foundry")).toBe("Makes iron from coal and ore · every 10 s");
    expect(recipeWords("carpenter")).toBe("Makes furniture from 3 planks · every 12 s");
    expect(recipeWords("forest")).toBe("Makes logs · every 15 s");
    expect(recipeWords("workshop")).toBe("");
    expect(placeCardInfo({ kind: "piece", type: "depot-mill", label: "Mill" }).facts).toEqual(["Makes flour from grain · every 8 s"]);
  });

  it("says what track is for, and keeps every line short", () => {
    expect(placeCardInfo({ kind: "piece", type: "switch", label: "Switch" })).toEqual({ ...pieceInfo("switch"), facts: [] });
    for (const item of trayItems()) {
      const c = placeCardInfo(item);
      for (const line of [c.detail, ...c.facts]) expect(line.length, `${item.label}: ${line}`).toBeLessThanOrEqual(DETAIL_MAX);
    }
  });
});
