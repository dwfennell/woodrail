import { describe, expect, it } from "vitest";
import { mapMarkers, RUIN_ICON, ruinMarkers, ruinMarkersKey, type RuinOnMap } from "./map-markers";
import { receivedBy } from "./town-life";
import { townStatus } from "./towns";
import { buildStarterWorld, landForSale, plotsAround, type World } from "./world";
import { declutterLabels } from "../ui/label-declutter";
import mapViewSrc from "../ui/map-view.ts?raw";

describe("map markers", () => {
  it("point out every town with what it wants, and every depot with its stock", () => {
    const w = buildStarterWorld();
    w.economy.delivered.set(w.landscape.towns[0].id, 6);
    const markers = mapMarkers(w, (id) => townStatus(receivedBy(w, id)));
    const towns = markers.filter((m) => m.kind === "town");
    expect(towns).toHaveLength(w.landscape.towns.length);
    expect(towns[0]).toMatchObject({ title: w.landscape.towns[0].name, detail: "Village · wants 🪵 planks 2/8", fill: 0.25 });
    expect(towns[1].detail).toBe("Hamlet · wants 🪵 planks 0/4");
    const forest = markers.find((m) => m.kind === "forest")!;
    expect(forest).toMatchObject({ title: "Forest yard", detail: "🌲 Logs 0" });
    expect(markers.find((m) => m.kind === "sawmill")!.detail).toBe("🌲 Logs 0 · 🪵 Planks 0");
    expect(new Set(markers.map((m) => m.key)).size).toBe(markers.length);
  });

  it("point out an industry the player put down (a workshop) too, but nothing twice (QA: the map had no workshop)", () => {
    const w = buildStarterWorld();
    const before = mapMarkers(w, (id) => townStatus(receivedBy(w, id)));
    const at = w.layout.addPiece("depot-workshop", { x: 900, z: -400, heading: 0 });
    w.economy.addDepot("workshop", at);
    const after = mapMarkers(w, (id) => townStatus(receivedBy(w, id)));
    expect(after).toHaveLength(before.length + 1);
    expect(after.find((m) => m.kind === "workshop")).toMatchObject({ title: "Workshop", x: 900, z: -400 });
    expect(new Set(after.map((m) => m.key)).size).toBe(after.length);
  });
});

describe("the map's ruin markers (map sites step 3)", () => {
  /** The ruins as the game shows them: the land's standing ones, then those on the land around. */
  function shown(w: World): RuinOnMap[] {
    const out: RuinOnMap[] = (w.landscape.sites ?? []).filter((s) => !s.cleared).map((site) => ({ site, around: false }));
    for (const p of plotsAround(w.landscape)) for (const site of landForSale(w.landscape, p.px, p.pz).sites ?? []) if (!site.cleared) out.push({ site, around: true });
    return out;
  }

  it("mark the starter's old farm, locked till Farming is learned, its card on a tap; the land around's ruins too, by role", () => {
    const w = buildStarterWorld();
    const farm = w.landscape.sites!.find((s) => s.role === "farm")!;
    const none = (_id: string) => false;
    const ruins = shown(w);
    const markers = ruinMarkers(ruins, none);
    expect(markers).toHaveLength(ruins.length);
    expect(markers[0]).toEqual({ key: `ruin:${farm.id}`, kind: "ruin", x: farm.centre.x, z: farm.centre.z, title: "Old farm", detail: "", icon: "🌾", locked: true, ruin: farm.id });
    // The land around's: no card to open (not tappable there), each its role's icon, locked.
    const around = markers.slice(1);
    expect(around.length).toBeGreaterThan(3);
    for (const [k, m] of around.entries()) {
      const site = ruins[k + 1].site;
      expect(m.ruin).toBeUndefined();
      expect(m).toMatchObject({ icon: RUIN_ICON[site.role], locked: true, title: `Old ${site.role}`, x: site.centre.x, z: site.centre.z });
    }
    expect(new Set(markers.map((m) => m.key)).size).toBe(markers.length);
    expect(RUIN_ICON).toEqual({ farm: "🌾", quarry: "🪨", mine: "⛏️", harbour: "⚓" });
    // Farming learned: the farm's lock goes, and only the farms'.
    const farming = (id: string) => id === "farming";
    for (const m of ruinMarkers(ruins, farming)) expect(m.locked).toBe(m.icon !== "🌾");
  });

  it("show nothing for a restored or cleared ruin", () => {
    const w = buildStarterWorld();
    const farm = w.landscape.sites!.find((s) => s.role === "farm")!;
    farm.cleared = true;
    expect(ruinMarkers([{ site: farm, around: false }], () => true)).toEqual([]);
    expect(ruinMarkers(shown(w), () => true).some((m) => m.key === `ruin:${farm.id}`)).toBe(false);
  });

  it("are keyed by the ruins' version and which of their blueprints are learned (not by blueprints that open none)", () => {
    const none = (_id: string) => false;
    expect(ruinMarkersKey(3, none)).toBe("3|1111");
    expect(ruinMarkersKey(4, none)).not.toBe(ruinMarkersKey(3, none));
    expect(ruinMarkersKey(3, (id) => id === "farming")).toBe("3|0111");
    expect(ruinMarkersKey(3, (id) => id === "farming" || id === "switches")).toBe("3|0111");
    expect(ruinMarkersKey(3, (id) => ["farming", "quarries", "mines", "harbours"].includes(id))).toBe("3|0000");
  });

  it("map view: ruins' badges stay on their ruin, and give way to labels (pinned, lowest priority)", () => {
    expect(mapViewSrc).toMatch(/kind === "ruin"\) return \{ priority: -1, pinned: true \}/);
    // A pinned box is never nudged: hidden when its spot is taken.
    const spots = declutterLabels([
      { x: 0, y: 0, w: 100, h: 40, priority: 1 },
      { x: 10, y: 10, w: 28, h: 28, priority: -1, pinned: true },
      { x: 200, y: 10, w: 28, h: 28, priority: -1, pinned: true },
    ]);
    expect(spots).toEqual([
      { dy: 0, hidden: false },
      { dy: 0, hidden: true },
      { dy: 0, hidden: false },
    ]);
  });
});
