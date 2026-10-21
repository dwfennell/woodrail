import { describe, expect, it } from "vitest";
import { ruleOf, THING_RULES, type ThingId } from "../game/things";
import { isKit, kitForAsset, kitOf, KITS, type PieceTypeId } from "../track";
import { DEFAULT_FAVOURITES, favouriteItems, INDUSTRY_GROUPS, propGroups, shelfItem, shownGroups, toggleFavourite, TRAY_TABS, trayKey, trayTabs, type TrayGroup, type TrayItem } from "./tray-catalogue";

describe("tray tabs", () => {
  it("Game mode shows the railway: track (bridges included), trains, industries and roads", () => {
    expect(trayTabs("game").map((t) => t.id)).toEqual(["track", "trains", "industries"]);
    expect(trayTabs("game")[0].props).toBeUndefined();
    // Props only as Game mode's lineside furniture (hidden till learned), on the Industries tab.
    for (const tab of trayTabs("game")) for (const g of tab.groups) for (const item of g.items) if (item.kind === "prop") expect([tab.id, g.label, item.unlearned]).toEqual(["industries", "Lineside", "hide"]);
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

  it("Game mode has no catalogue shelves: its kits are on its own shelves, each one with its blueprint", () => {
    for (const tab of trayTabs("game")) {
      expect(tab.props).toBeUndefined();
      for (const g of tab.groups)
        for (const item of g.items) {
          if (!(item.kind === "piece" && isKit(item.type)) && item.kind !== "prop") continue;
          // Hidden till learned, and made at the workshop like any piece.
          expect(item.unlearned, trayKey(item)).toBe("hide");
          expect(ruleOf(trayKey(item) as ThingId)?.tech, trayKey(item)).toBeTruthy();
        }
    }
  });

  it("Sandbox's trays are as they were: no Game shelves, every kit on its catalogue shelf", () => {
    const sandbox = trayTabs("sandbox");
    expect(sandbox.map((t) => t.id)).toEqual(["track", "trains", "buildings", "nature", "town", "vehicles", "life", "machines", "roads", "land"]);
    const track = sandbox.find((t) => t.id === "track")!;
    expect(track.groups.map((g) => g.label)).toEqual(["Straight", "Curve", "Switch", "Ups & downs", "Ends", "Bridges"]);
    for (const tab of sandbox) for (const g of tab.groups) for (const item of g.items) expect(item.kind === "piece" && isKit(item.type), `${tab.id}/${g.label}`).toBe(false);
    // Every kit is offered on a catalogue shelf.
    const shelved = new Set(sandbox.flatMap((t) => t.props ?? []).flatMap((s) => s.assets));
    for (const k of Object.values(KITS)) expect(shelved.has(k.asset), k.asset).toBe(true);
  });
});

describe("Game mode's railway kits on the tray", () => {
  const game = trayTabs("game");
  const tab = (id: string) => game.find((t) => t.id === id)!;
  const keys = (g: TrayGroup) => g.items.map(trayKey);

  it("track kits on the Track tab, buildings and services on the Industries tab's railway shelves", () => {
    expect(keys(tab("track").groups.find((g) => g.label === "Railway kit")!)).toEqual(["piece:kit-semaphore-signal", "piece:kit-colour-light-signal", "piece:kit-signal-gantry", "piece:kit-turntable", "piece:kit-transfer-table"]);
    expect(tab("industries").groups.map((g) => g.label)).toEqual(["Industries", "Railway", "Halts", "Lineside"]);
    expect(keys(tab("industries").groups.find((g) => g.label === "Halts")!)).toEqual(["piece:kit-country-halt", "piece:kit-mountain-station", "piece:kit-harbour-station", "piece:kit-platform-furnished"]);
  });

  it("no cargo loaders or unloaders (the goods shed among them) in Game mode", () => {
    const all = game.flatMap((t) => t.groups.flatMap((g) => g.items));
    for (const item of all) if (item.kind === "piece") expect(kitOf(item.type)?.depot, item.type).toBeUndefined();
    expect(all.some((i) => i.kind === "piece" && i.type === "kit-goods-shed")).toBe(false);
    for (const id of Object.keys(THING_RULES)) if (id.startsWith("piece:kit-")) expect(kitOf(id.slice(6) as PieceTypeId)?.depot, id).toBeUndefined();
  });

  it("a new player's tray: kits not learned stay off it, and an empty shelf with them", () => {
    const nothing = () => false;
    const industries = shownGroups(tab("industries").groups, nothing);
    // Only the industries: the tab opens straight onto them, as before.
    expect(industries.map((g) => g.label)).toEqual(["Industries"]);
    expect(shownGroups(tab("track").groups, nothing).map((g) => g.label)).toEqual(["Straight", "Curve", "Switch", "Ups & downs", "Ends", "Bridges"]);
    // Pieces not learned yet that aren't kits still show (Locked), as before.
    expect(shownGroups(tab("track").groups, nothing).flatMap(keys)).toContain("piece:switch");
    expect(shownGroups(tab("trains").groups, nothing).flatMap(keys)).not.toContain("train:Track cleaner");
    // Learned: there they are.
    const water = (i: TrayItem) => trayKey(i) === "piece:kit-water-tower";
    expect(shownGroups(tab("industries").groups, water).map((g) => [g.label, g.items.length])).toEqual([
      ["Industries", INDUSTRY_GROUPS[0].items.length],
      ["Railway", 1],
    ]);
  });
});

describe("the track cleaner on the Trains tab", () => {
  const cleanerIn = (mode: "sandbox" | "game") =>
    trayTabs(mode)
      .find((t) => t.id === "trains")!
      .groups.some((g) => g.items.some((i) => i.kind === "train" && i.cars.includes("cleaner")));
  it("is a wagon in Sandbox, and Game mode's once Scenery kit is learned", () => {
    expect(cleanerIn("sandbox")).toBe(true);
    expect(cleanerIn("game")).toBe(true);
    expect(ruleOf("car:cleaner")?.tech).toBe("scenery");
    expect(trayTabs("sandbox").some((t) => t.id === "industries")).toBe(false);
    expect(trayTabs("game").some((t) => t.id === "industries")).toBe(true);
  });
});

describe("the Trains tab's shelves", () => {
  const shelvesOf = (mode: "sandbox" | "game") => trayTabs(mode).find((t) => t.id === "trains")!.groups;
  it("Game mode: no ready-made trains, only the parts to make one up (Engines, Wagons, Coaches)", () => {
    const game = shelvesOf("game");
    expect(game.map((g) => g.label)).toEqual(["Engines", "Wagons", "Coaches"]);
    for (const g of game) for (const item of g.items) expect(item.kind === "train" && item.cars.length, `${g.label}/${item.label}`).toBe(1);
    // A shelf dragged up takes out its first item: the Engines shelf's is a plain engine.
    expect(game[0].items[0]).toMatchObject({ kind: "train", cars: ["engine"], label: "Engine" });
  });
  it("Sandbox keeps its ready-made Trains shelf first", () => {
    const sandbox = shelvesOf("sandbox");
    expect(sandbox.map((g) => g.label)).toEqual(["Trains", "Engines", "Wagons", "Coaches"]);
    expect(sandbox[0].items.map((i) => i.label)).toEqual(["Full train", "Flatbed train"]);
  });
  it("an old Game-mode favourite that was a ready-made train isn't offered there (Sandbox still has it)", () => {
    const keys = ["train:Full train", "train:Engine"];
    expect(favouriteItems(keys, shelvesOf("game")).map(trayKey)).toEqual(["train:Engine"]);
    expect(favouriteItems(keys, shelvesOf("sandbox")).map(trayKey)).toEqual(keys);
  });
});
