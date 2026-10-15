import { describe, expect, it } from "vitest";
import { DEFAULT_FAVOURITES, favouriteItems, toggleFavourite, TRAY_TABS, trayKey, trayTabs } from "./tray-catalogue";

describe("tray tabs", () => {
  it("Game mode shows the railway: track (bridges included), trains, industries and roads", () => {
    expect(trayTabs("game").map((t) => t.id)).toEqual(["track", "trains", "industries", "roads"]);
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

describe("tray favourites", () => {
  const track = TRAY_TABS.find((t) => t.id === "track")!;
  const trains = TRAY_TABS.find((t) => t.id === "trains")!;

  it("the defaults are all pieces on the Track tab, in order", () => {
    expect(favouriteItems(DEFAULT_FAVOURITES, track.groups).map(trayKey)).toEqual([...DEFAULT_FAVOURITES]);
  });

  it("a tab shows only its own favourites, in the order they were picked", () => {
    const keys = ["train:Engine", "piece:curve-large", "piece:switch", "nope"];
    expect(favouriteItems(keys, track.groups).map(trayKey)).toEqual(["piece:curve-large", "piece:switch"]);
    expect(favouriteItems(keys, trains.groups).map(trayKey)).toEqual(["train:Engine"]);
  });

  it("toggling adds at the end, or takes off", () => {
    expect(toggleFavourite(["a", "b"], "c")).toEqual(["a", "b", "c"]);
    expect(toggleFavourite(["a", "b", "c"], "b")).toEqual(["a", "c"]);
  });
});
