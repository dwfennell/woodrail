import { describe, expect, it } from "vitest";
import { kitForAsset, KITS } from "../track";
import { DEFAULT_FAVOURITES, favouriteItems, propGroups, shelfItem, toggleFavourite, TRAY_TABS, trayKey, trayTabs } from "./tray-catalogue";

describe("tray tabs", () => {
  it("Game mode shows the railway: track (bridges included), trains, industries and roads", () => {
    expect(trayTabs("game").map((t) => t.id)).toEqual(["track", "trains", "industries"]);
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

describe("kit pieces on the catalogue shelves (Sandbox)", () => {
  it("the furnished platform on Buildings → Railway comes out as a piece (the kit), where the prop was", async () => {
    const buildings = TRAY_TABS.find((t) => t.id === "buildings")!;
    expect(buildings.modes).toEqual(["sandbox"]);
    const railway = buildings.props!.find((s) => s.label === "Railway")!;
    const groups = await propGroups([railway]);
    const items = groups[0].items;
    const kit = items.find((x) => x.kind === "piece" && x.type === "kit-platform-furnished")!;
    expect(kit).toEqual({ kind: "piece", type: "kit-platform-furnished", label: "Busy platform" }); // (its tray name: the catalogue's is too long for a tile)
    expect(trayKey(kit)).toBe("piece:kit-platform-furnished");
    // In the prop's place on the shelf.
    expect(items.length).toBe(railway.assets.length);
    expect(items.indexOf(kit)).toBe(railway.assets.indexOf(KITS["kit-platform-furnished"].asset));
    // The rest of the shelf is still props.
    expect(items.filter((x) => x.kind === "piece")).toHaveLength(railway.assets.filter((a) => kitForAsset(a)).length);
    expect(shelfItem("bldg-signal-box", "Signal box")).toEqual({ kind: "prop", asset: "bldg-signal-box", label: "Signal box" });
  });

  it("Game mode's trays are as they were: no catalogue shelves, no kits", () => {
    for (const tab of trayTabs("game")) {
      expect(tab.props).toBeUndefined();
      for (const g of tab.groups) for (const item of g.items) expect(item.kind === "piece" && item.type.startsWith("kit-")).toBe(false);
    }
  });
});

describe("the track cleaner on the Trains tab", () => {
  const cleanerIn = (mode: "sandbox" | "game") =>
    trayTabs(mode)
      .find((t) => t.id === "trains")!
      .groups.some((g) => g.items.some((i) => i.kind === "train" && i.cars.includes("cleaner")));
  it("is a wagon in Sandbox, and not on Game mode's tray", () => {
    expect(cleanerIn("sandbox")).toBe(true);
    expect(cleanerIn("game")).toBe(false);
    expect(trayTabs("sandbox").some((t) => t.id === "industries")).toBe(false);
    expect(trayTabs("game").some((t) => t.id === "industries")).toBe(true);
  });
});
