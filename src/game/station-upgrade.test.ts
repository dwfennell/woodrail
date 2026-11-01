import { describe, expect, it } from "vitest";
import { Editor } from "../editor/editor";
import { LandEditor } from "../landscape/edit";
import { FEAT_BUILDING, FEAT_STATION, SURF_ROAD } from "../landscape";
import { deserializeWorld, serializeWorld } from "../persist/save";
import { appendPiece, connectorRef, getPieceDef, Layout } from "../track";
import { startLine } from "./lines";
import { findBuilding } from "../props/towns";
import { buildOnLots, nextLots } from "./town-growth";
import { planUpgrade, upgradeLand, UPGRADE_UNDO_REFUSED, type StationUpgrade, type UpgradePlan } from "./station-upgrade";
import { buildStarterWorld, syncIndustries, type World } from "./world";

describe("Layout.retype", () => {
  it("keeps the piece's id and the joints both types share; new ends are free", () => {
    const layout = new Layout();
    const a = layout.addPiece("straight-216", { x: -216, z: 0, heading: 0 });
    const st = appendPiece(layout, "station", false, connectorRef(a, 1));
    const b = appendPiece(layout, "straight-216", false, connectorRef(st, 1));
    expect(layout.retype(st, "kit-two-platform-station")).toBe(true);
    expect(layout.getPiece(st)!.type).toBe("kit-two-platform-station");
    expect(layout.joinedConnector(connectorRef(st, 0))).toBe(connectorRef(a, 1));
    expect(layout.joinedConnector(connectorRef(st, 1))).toBe(connectorRef(b, 0));
    for (const k of [2, 3]) expect(layout.joinedConnector(connectorRef(st, k))).toBe(-1);
    // And back: the plain station, the same joints.
    expect(layout.retype(st, "station")).toBe(true);
    expect(layout.joinedConnector(connectorRef(st, 1))).toBe(connectorRef(b, 0));
  });

  it("refuses (changing nothing) where a joined end wouldn't survive: a terminus with track past its far end", () => {
    const layout = new Layout();
    const st = layout.addPiece("station", { x: 0, z: 0, heading: 0 });
    appendPiece(layout, "straight-216", false, connectorRef(st, 1));
    expect(layout.canRetype(st, "kit-grand-terminus")).toBe(false);
    expect(layout.retype(st, "kit-grand-terminus")).toBe(false);
    expect(layout.getPiece(st)!.type).toBe("station");
    // The terminus's first road is the station's track, from its near end.
    const t = getPieceDef("kit-grand-terminus", false);
    expect(t.connectors[0].pose).toEqual(getPieceDef("station", false).connectors[0].pose);
  });
});

/** The starter map (Game mode), a line out of each end of town 0's station, and the rules a card asks with. */
function served() {
  const w = buildStarterWorld(true);
  const town = w.landscape.towns[0];
  const station = w.stations.get(town.id)!;
  const before = appendPiece(w.layout, "straight-216", false, connectorRef(station, 0));
  syncIndustries(w, true);
  const checker = new LandEditor(w.landscape, w.layout);
  // The drop rule, as the game asks it (`Interaction.placeWhy`), stood in for by the land's: only what's planned on
  // here (houses and the kit's own squares) is under test, the game's full rule in the e2e.
  const placeWhy = () => null;
  return { w, town, station, before, checker, placeWhy };
}

/** The first upgrade planned for some town of the starter map that moves houses, else any. */
function anyPlan(w: World, checker: LandEditor): UpgradePlan {
  let fallback: UpgradePlan | null = null;
  for (const t of w.landscape.towns)
    for (const type of ["kit-two-platform-station", "kit-grand-terminus"] as StationUpgrade[]) {
      const p = planUpgrade(w, t.id, type, checker, () => null);
      if (typeof p === "string") continue;
      if (p.moves.length > 0) return p;
      fallback ??= p;
    }
  if (!fallback) throw new Error("no upgrade fits anywhere on the starter map");
  return fallback;
}

describe("upgrading a town's station in place (Game mode)", () => {
  it("keeps its depot, the line's and the route's stops, and a train standing at it; one undo step", () => {
    const { w, town, station, checker, placeWhy } = served();
    const depot = w.economy.depotAtPiece(station)!;
    const other = w.economy.depotAtPiece(w.stations.get(w.landscape.towns[1].id)!)!;
    const placed = w.sim.addTrain(["engine", "passenger"], { pieceId: station, pathIndex: 0, reversed: false, s: 200 });
    expect(placed.kind).toBe("placed");
    const train = placed.kind === "placed" ? w.sim.getTrain(placed.trainId)! : null!;
    const engine = train.cars.find((c) => c.kind === "engine")!.id;
    const line = startLine(w.economy, engine, [
      { depotId: depot.id, action: "both" },
      { depotId: other.id, action: "both" },
    ]);
    const plan = planUpgrade(w, town.id, "kit-two-platform-station", checker, placeWhy);
    expect(typeof plan).not.toBe("string");
    if (typeof plan === "string") return;
    const editor = new Editor(w.layout, w.sim, () => {}, (id) => id === station);
    const land = upgradeLand(w, plan);
    land.do();
    expect(editor.retype(station, plan.type, land, UPGRADE_UNDO_REFUSED)).toBe(true);
    syncIndustries(w, true);
    for (let i = 0; i < 120; i++) {
      w.sim.tick();
      w.economy.tick();
    }
    // The same piece and depot: the station, not a halt; the stops still there.
    expect(w.layout.getPiece(station)!.type).toBe("kit-two-platform-station");
    expect(w.economy.depotAtPiece(station)).toBe(depot);
    expect(w.economy.isHalt(depot)).toBe(false);
    expect(w.economy.lines.get(line.id)!.stops.map((s) => s.depotId)).toEqual([depot.id, other.id]);
    expect(w.economy.routeOf(engine)!.stops.map((s) => s.depotId)).toEqual([depot.id, other.id]);
    expect(w.sim.getTrain(placed.kind === "placed" ? placed.trainId : -1)?.derailed ?? false).toBe(false);
    expect(town.upgraded).toBe("kit-two-platform-station");
    // Saved and loaded: the upgraded station comes back the town's, its depot a station's, the line intact.
    const back = deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(w))));
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    const b = back.value;
    expect(b.layout.getPiece(station)!.type).toBe("kit-two-platform-station");
    expect(b.stations.get(town.id)).toBe(station);
    expect(b.economy.isHalt(b.economy.depotAtPiece(station)!)).toBe(false);
    expect(b.landscape.towns[0].upgraded).toBe("kit-two-platform-station");
    // Undo: the plain station again, the land as it was, the line and route untouched.
    expect(editor.undo()).toBe(true);
    expect(w.layout.getPiece(station)!.type).toBe("station");
    expect(town.upgraded).toBeUndefined();
    expect(w.economy.lines.get(line.id)!.stops.map((s) => s.depotId)).toEqual([depot.id, other.id]);
    expect(editor.redo()).toBe(true);
    expect(w.layout.getPiece(station)!.type).toBe("kit-two-platform-station");
  });

  it("moves the town's houses in its way to free lots facing a street (storeys kept); undo puts them back", () => {
    const w = buildStarterWorld(true);
    syncIndustries(w, true);
    const checker = new LandEditor(w.landscape, w.layout);
    const plan = anyPlan(w, checker);
    const g = w.landscape.grid;
    const snapshot = () => JSON.stringify({ f: [...g.feature], o: [...g.owner], s: [...g.surface], towns: w.landscape.towns, props: [...w.props.all()].map((p) => ({ ...p })) });
    const was = snapshot();
    const storeys = new Map([...w.props.all()].filter((p) => p.building !== undefined).map((p) => [p.building!, p.storeys]));
    const stationId = plan.stationId;
    const editor = new Editor(w.layout, w.sim, () => {}, (id) => id === stationId);
    const land = upgradeLand(w, plan);
    land.do();
    expect(editor.retype(stationId, plan.type, land, UPGRADE_UNDO_REFUSED)).toBe(true);
    // Every moved house stands on its lot, facing a street, out of the kit's squares; the kit's squares are the station's.
    const covered = new Set(plan.covered);
    for (const { building, lot } of plan.moves) {
      const found = findBuilding(w.landscape, building)!;
      expect(found.building.cells).toEqual(lot.cells);
      expect(found.building.cells.some((c) => covered.has(c))).toBe(false);
      const front = found.building.front!;
      const [dc, dr] = [
        [1, 0],
        [0, 1],
        [-1, 0],
        [0, -1],
      ][front];
      expect(found.building.cells.some((c) => g.surface[g.index(g.colOf(c) + dc, g.rowOf(c) + dr)] === SURF_ROAD)).toBe(true);
      for (const c of found.building.cells) expect([g.feature[c], g.owner[c]]).toEqual([FEAT_BUILDING, building]);
    }
    for (const i of plan.covered) expect(g.feature[i]).toBe(FEAT_STATION);
    for (const p of w.props.all()) if (p.building !== undefined) expect(p.storeys, `house ${p.building}`).toBe(storeys.get(p.building));
    // One undo step: everything as it was.
    expect(editor.undo()).toBe(true);
    expect(snapshot()).toBe(was);
    // Redone, the town still grows: new lots, none on the station's squares.
    expect(editor.redo()).toBe(true);
    const town = w.landscape.towns.find((t) => t.id === plan.townId)!;
    const count = town.buildings.length;
    const lots = nextLots(w.landscape, town, new LandEditor(w.landscape, w.layout), 3);
    expect(lots.length).toBeGreaterThan(0);
    for (const lot of lots) expect(lot.cells.some((c) => covered.has(c)), JSON.stringify(lot.cells)).toBe(false);
    buildOnLots(w.landscape, town, lots);
    expect(town.buildings.length).toBeGreaterThan(count);
    for (const i of plan.covered) expect(g.feature[i]).toBe(FEAT_STATION);
  });

  it("refuses a terminus where track runs on past the platform, and says so", () => {
    const { w, town, station, checker, placeWhy } = served();
    appendPiece(w.layout, "straight-216", false, connectorRef(station, 1));
    expect(planUpgrade(w, town.id, "kit-grand-terminus", checker, placeWhy)).toBe("A terminus goes only at the end of a line: no track past the platform's far end");
  });

  it("refuses when the drop rule says no (the game's own words), and when there's no free lot for a house", () => {
    const { w, town, checker } = served();
    expect(planUpgrade(w, town.id, "kit-two-platform-station", checker, () => "Track is in the way")).toBe("Track is in the way");
    // No lot will do for anyone: refused if any house is in the way.
    const plan = anyPlan(w, checker);
    if (plan.moves.length === 0) return;
    const none = { checkLot: () => "taken" as const };
    expect(planUpgrade(w, plan.townId, plan.type, none, () => null)).toMatch(/^No free lot in .+ for a house in the way$/);
  });
});
