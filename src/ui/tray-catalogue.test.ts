import { describe, expect, it } from "vitest";
import { TRAY_TABS, trayKey, trayTabs } from "./tray-catalogue";

describe("tray tabs", () => {
  it("Game mode shows the railway: track (bridges included) and trains", () => {
    expect(trayTabs("game").map((t) => t.id)).toEqual(["track", "trains"]);
    expect(trayTabs("game")[0].props).toBeUndefined();
    for (const tab of trayTabs("game")) for (const g of tab.groups) for (const item of g.items) expect(item.kind).not.toBe("prop");
  });

  it("every shelf has items, and no item is on two shelves of one tab", () => {
    for (const tab of TRAY_TABS) {
      const keys = tab.groups.flatMap((g) => g.items.map(trayKey));
      for (const g of tab.groups) expect(g.items.length, `${tab.id}/${g.label}`).toBeGreaterThan(0);
      expect(new Set(keys).size, tab.id).toBe(keys.length);
    }
  });

  it("bridges are a shelf of the Track tab", () => {
    const track = TRAY_TABS.find((t) => t.id === "track")!;
    expect(track.groups.find((g) => g.label === "Bridges")!.items.map(trayKey)).toEqual(["piece:bridge", "piece:bridge-curve"]);
    expect(TRAY_TABS.some((t) => t.id === "bridges")).toBe(false);
  });
});
