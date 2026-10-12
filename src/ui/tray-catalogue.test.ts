import { describe, expect, it } from "vitest";
import { TRAY_TABS, trayKey, trayTabs } from "./tray-catalogue";

describe("tray tabs", () => {
  it("Game mode shows the railway: track, trains and track bridges", () => {
    expect(trayTabs("game").map((t) => t.id)).toEqual(["track", "trains", "bridges"]);
    for (const tab of trayTabs("game")) for (const g of tab.groups) for (const item of g.items) expect(item.kind).not.toBe("prop");
  });

  it("every shelf has items, and no item is on two shelves of one tab", () => {
    for (const tab of TRAY_TABS) {
      const keys = tab.groups.flatMap((g) => g.items.map(trayKey));
      for (const g of tab.groups) expect(g.items.length, `${tab.id}/${g.label}`).toBeGreaterThan(0);
      expect(new Set(keys).size, tab.id).toBe(keys.length);
    }
  });

  it("bridges moved from Track to their own tab", () => {
    const track = TRAY_TABS.find((t) => t.id === "track")!.groups.flatMap((g) => g.items.map(trayKey));
    expect(track).not.toContain("piece:bridge");
    const bridges = TRAY_TABS.find((t) => t.id === "bridges")!.groups.flatMap((g) => g.items.map(trayKey));
    expect(bridges).toEqual(["piece:bridge", "piece:bridge-curve"]);
  });
});
