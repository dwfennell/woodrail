import { describe, expect, it } from "vitest";
import { PIECE_TYPES } from "../track";
import { DETAIL_MAX, hasOwnName, pieceInfo, trayInfo } from "./piece-info";
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
