import { describe, expect, it } from "vitest";
import { appendPiece, connectorRef, findSplice, Layout } from "../track";
import { checkPlacement, connectedPairs, FEAT_TREE, SURF_GRASS, SURF_RIVER } from "../landscape";
import { checkYard } from "./depot-footprint";
import { siteWhy } from "./industries";
import { BRIDGE_KNOWN_HINT, BUY_LAND_HINT, GOALS, plotsBought, GoalTracker, NOTHING_ACROSS_HINT, NOTHING_ACROSS_KNOWN, MAKE_SWITCH_HINT, OPEN_INDUSTRY_GOALS, secondEngineTip, SWITCH_ORDERED_HINT, TWO_TRAINS_HINT, trayRing } from "./goals";
import mainSrc from "../main.ts?raw";
import panelSrc from "../ui/workshop-panel.ts?raw";
import { Crafting, keepsForOrder } from "./crafting";
import { buildStarterWorld, createWorld, fixedPieces, plotsForSale, STARTER_SEED, syncIndustries, unlockPlot, type World } from "./world";
import { Editor } from "../editor/editor";
import type { MapSite, SiteRole } from "../landscape";
import { restoredType } from "./map-sites";
import { restoreRuin } from "./restore";
import { CARGO } from "../economy/cargo";
import { Progress } from "./progress";
import { pick } from "./research";
import { goalPick, showMePick } from "./research-text";
import { deserializeWorld, serializeWorld } from "../persist/save";

const goal = (id: string) => GOALS.find((g) => g.id === id)!;

/** The starter map with its first two towns joined by four long straights; returns the straights' ids. */
function joined(): { w: World; straights: number[] } {
  const w = buildStarterWorld();
  const [a] = w.landscape.towns;
  let last = w.stations.get(a.id)!;
  const straights: number[] = [];
  for (let i = 0; i < 4; i++) {
    last = appendPiece(w.layout, "straight-216", false, connectorRef(last, 1));
    straights.push(last);
  }
  return { w, straights };
}

/** Clear the map's river and run one across it, along the row at `z`; returns the row. */
function riverRow(w: World, z: number): number {
  const g = w.landscape.grid;
  const row = g.rowAt(z);
  g.forEachCell((i, _c, r) => {
    if (g.surface[i] === SURF_RIVER) g.surface[i] = SURF_GRASS;
    if (r === row) g.surface[i] = SURF_RIVER;
  });
  g.touch();
  return row;
}

function trainOn(w: World, pieceId: number, kinds: Parameters<World["sim"]["addTrain"]>[0] = ["engine"]) {
  const r = w.sim.addTrain(kinds, { pieceId, pathIndex: 0, reversed: false, s: 150 });
  if (r.kind !== "placed") throw new Error("no room for the train");
  return w.sim.getTrain(r.trainId)!;
}

describe("goals", () => {
  it("have unique ids, and none is done on a fresh starter map", () => {
    expect(new Set(GOALS.map((g) => g.id)).size).toBe(GOALS.length);
    const w = buildStarterWorld();
    for (const g of GOALS) expect(g.check(w).done, g.id).toBe(false);
  });

  it("count no towns joined before any track is laid", () => {
    expect(goal("join-two").check(buildStarterWorld())).toMatchObject({ done: false, count: 0, target: 2 });
  });

  it("joining two towns counts toward the town goals", () => {
    const { w } = joined();
    expect(goal("join-two").check(w)).toMatchObject({ done: true, count: 2, target: 2 });
    expect(goal("join-three").check(w)).toMatchObject({ done: false, count: 2, target: 3, unit: "towns" });
    expect(goal("join-all").check(w)).toMatchObject({ done: false, target: w.landscape.towns.length });
  });

  it("trains: placed, moving, at a station, timber, two running", () => {
    const { w, straights } = joined();
    // A wagon on its own isn't the engine the first train goal asks for.
    const wagon = trainOn(w, straights[3], ["timber"]);
    expect(goal("place-train").check(w).done).toBe(false);
    w.sim.removeTrain(wagon.id);
    const t = trainOn(w, straights[1], ["engine", "timber"]);
    expect(goal("place-train").check(w).done).toBe(true);
    expect(goal("timber-train").check(w).done).toBe(true);
    expect(goal("get-moving").check(w).done).toBe(false);
    t.speed = 80;
    expect(goal("get-moving").check(w).done).toBe(true);
    expect(goal("station-stop").check(w).done).toBe(false);
    // Standing on a station isn't running into it.
    const second = trainOn(w, w.stations.get(w.landscape.towns[0].id)!);
    expect(goal("station-stop").check(w).done).toBe(false);
    expect(goal("two-trains").check(w)).toMatchObject({ done: false, count: 1 });
    second.speed = 40;
    expect(goal("station-stop").check(w).done).toBe(true);
    expect(goal("two-trains").check(w).done).toBe(true);
    // A derailed train isn't running.
    t.derailed = true;
    expect(goal("two-trains").check(w).done).toBe(false);
  });

  it("cargo: logs loaded, planks delivered", () => {
    const { w, straights } = joined();
    const t = trainOn(w, straights[1], ["engine", "timber"]);
    expect(goal("load-logs").check(w).done).toBe(false);
    w.economy.setCargo(t.cars[1].id, "log", 2);
    expect(goal("load-logs").check(w).done).toBe(true);
    w.economy.delivered.set(w.landscape.towns[1].id, 4);
    expect(goal("deliver-planks").check(w).done).toBe(true);
    expect(goal("deliver-ten").check(w)).toMatchObject({ done: false, count: 4, target: 10 });
    w.economy.delivered.set(w.landscape.towns[0].id, 6);
    expect(goal("deliver-ten").check(w).done).toBe(true);
  });

  it("pieces: a switch, a bridge", () => {
    const { w, straights } = joined();
    expect(goal("lay-switch").check(w).done).toBe(false);
    appendPiece(w.layout, "switch", true, connectorRef(straights[3], 0));
    expect(goal("lay-switch").check(w).done).toBe(true);
    expect(goal("build-bridge").check(w).done).toBe(false);
    w.layout.addPiece("bridge", { x: 0, z: 0, heading: 0 });
    expect(goal("build-bridge").check(w).done).toBe(true);
  });
});

describe("goal guides", () => {
  it("every goal says where to look on a fresh map and on a busy one", () => {
    const fresh = buildStarterWorld();
    const { w, straights } = joined();
    trainOn(w, straights[1], ["engine", "timber"]);
    for (const g of GOALS) {
      for (const world of [fresh, w]) {
        const guide = g.guide(world);
        expect(guide.points.length, g.id).toBeGreaterThan(0);
        for (const p of guide.points) expect(Number.isFinite(p.x) && Number.isFinite(p.z), g.id).toBe(true);
      }
    }
  });

  it("points at the starter's first two towns, then the nearest town not yet joined", () => {
    const fresh = buildStarterWorld();
    const [a, b] = fresh.landscape.towns;
    expect(goal("join-two").guide(fresh).towns.sort()).toEqual([a.id, b.id].sort());
    const { w } = joined();
    const towns = goal("join-three").guide(w).towns;
    expect(towns).toHaveLength(2);
    expect([a.id, b.id]).toContain(towns[0]);
    expect([a.id, b.id]).not.toContain(towns[1]);
  });

  it("marks the forest yard for loading logs and opens the tabs that have what's needed", () => {
    const { w } = joined();
    const forest = w.landscape.depots.find((d) => d.kind === "forest")!;
    const pose = w.layout.getPiece(w.depots.get(forest.id)!)!.pose;
    expect(goal("load-logs").guide(w).marks).toEqual([pose]);
    // Trains are made up from parts (no ready-made trains in Game mode): Show me opens on the engines, then the wagons.
    expect(goal("place-train").guide(w)).toMatchObject({ tab: "trains", shelf: "Engines" });
    expect(goal("timber-train").guide(w)).toMatchObject({ tab: "trains", shelf: "Wagons" });
    expect(goal("place-train").hint).toMatch(/engine/);
    expect(goal("timber-train").hint).toMatch(/flatbed wagon onto your engine/);
    expect(goal("lay-switch").guide(w)).toMatchObject({ tab: "track", shelf: "Switch" });
    expect(goal("build-bridge").guide(w)).toMatchObject({ tab: "track", shelf: "Bridges" });
  });
});

describe("build-bridge guide", () => {
  it("points at the river square nearest the player's line", () => {
    const { w, straights } = joined();
    const g = w.landscape.grid;
    const end = w.layout.getPiece(straights[3])!.pose;
    const rivers = () => {
      const out: { x: number; z: number }[] = [];
      g.forEachCell((i, c, r) => {
        if (g.surface[i] === 1) out.push({ x: g.centreX(c), z: g.centreZ(r) });
      });
      return out;
    };
    // A single river square beside the end of the track.
    for (const p of rivers()) g.surface[g.cellAtWorld(p.x, p.z)] = 0;
    const i = g.cellAtWorld(end.x + 150, end.z + 150);
    expect(i).not.toBe(-1);
    g.surface[i] = 1;
    g.touch();
    const spot = { x: g.centreX(g.colOf(i)), z: g.centreZ(g.rowOf(i)) };
    const guide = goal("build-bridge").guide(w);
    expect(guide.points[0]).toEqual(spot);
    expect(guide.marks).toEqual([spot]);
    expect(guide).toMatchObject({ tab: "track", shelf: "Bridges" });
    // A nearer river square wins (and the cache follows the grid).
    const j = g.cellAtWorld(end.x + 80, end.z);
    g.surface[j] = 1;
    g.touch();
    expect(goal("build-bridge").guide(w).points[0]).toEqual({ x: g.centreX(g.colOf(j)), z: g.centreZ(g.rowOf(j)) });
  });

  it("with nothing across the river, says so in the hint", () => {
    const { w } = joined();
    const g = w.landscape.grid;
    g.forEachCell((i) => {
      if (g.surface[i] === SURF_RIVER) g.surface[i] = 0;
    });
    // A pond beside the line: no land beyond it.
    const end = w.layout.getPiece(w.stations.get(w.landscape.towns[1].id)!)!.pose;
    g.surface[g.cellAtWorld(end.x + 150, end.z + 150)] = SURF_RIVER;
    g.touch();
    expect(goal("build-bridge").check(w)).toEqual({ done: false, hint: NOTHING_ACROSS_HINT });
    // Bridges learned already: nothing said about learning them.
    expect(goal("build-bridge").check(w, { learned: new Set(["bridges"]) })).toEqual({ done: false, hint: NOTHING_ACROSS_KNOWN });
    expect(NOTHING_ACROSS_KNOWN).not.toMatch(/learn/i);
    expect(goal("build-bridge").guide(w).marks).toHaveLength(1);
  });

  it("with bridges learned, its hint skips learning them", () => {
    const { w } = joined();
    const known = goal("build-bridge").check(w, { learned: new Set(["bridges"]) });
    expect(known.done).toBe(false);
    if (known.hint !== NOTHING_ACROSS_KNOWN) expect(known.hint).toBe(BRIDGE_KNOWN_HINT);
    expect(known.hint).not.toMatch(/learn|research/i);
    // Not learned: its own hint, which says to research them.
    expect(goal("build-bridge").hint).toMatch(/Research bridges/);
  });

  it("frames the crossing toward a town across the river, both banks in view", () => {
    const { w } = joined();
    const g = w.landscape.grid;
    // A river right across the map between the joined towns and the rest.
    const towns = w.landscape.towns;
    const row = riverRow(w, Math.max(...towns.slice(2).map((t) => t.centre.z)) + 250);
    expect(towns.slice(0, 2).every((t) => g.rowAt(t.centre.z) > row)).toBe(true);
    const guide = goal("build-bridge").guide(w);
    const across = towns.slice(2);
    expect(across.map((t) => t.id)).toContain(guide.towns[0]);
    expect(guide.marks).toHaveLength(1);
    const [river, near, far, town] = guide.points;
    expect(g.surface[g.cellAtWorld(river.x, river.z)]).toBe(SURF_RIVER);
    expect(g.rowAt(near.z)).toBeGreaterThan(row);
    expect(g.rowAt(far.z)).toBeLessThan(row);
    expect(town).toEqual(across.find((t) => t.id === guide.towns[0])!.centre);
    expect(guide).toMatchObject({ tab: "track", shelf: "Bridges" });
    expect(goal("build-bridge").check(w).hint).toBeUndefined();
  });

  it("frames the crossing toward a forest across the river (with no town or depot there)", () => {
    const { w } = joined();
    const g = w.landscape.grid;
    const towns = w.landscape.towns;
    const row = riverRow(w, Math.max(...towns.map((t) => t.centre.z), ...w.landscape.depots.map((d) => d.centre.z)) + 500);
    // Bare grass beyond it, but for a stand of trees.
    g.forEachCell((i, _c, r) => {
      if (r <= row) return;
      g.height[i] = 0;
      g.feature[i] = 0;
    });
    const wood = { x: 0, z: (row + 6) * 72 };
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) g.feature[g.index(g.colAt(wood.x) + dc, g.rowAt(wood.z) + dr)] = FEAT_TREE;
    g.touch();
    const guide = goal("build-bridge").guide(w);
    expect(guide.towns).toEqual([]);
    const [river, near, far, at] = guide.points;
    expect(g.surface[g.cellAtWorld(river.x, river.z)]).toBe(SURF_RIVER);
    expect(g.rowAt(near.z)).toBeLessThan(row);
    expect(g.rowAt(far.z)).toBeGreaterThan(row);
    // A square with the trees in an industry's reach.
    expect(Math.hypot(at.x - wood.x, at.z - wood.z)).toBeLessThan(250 + 72);
    expect(goal("build-bridge").check(w).hint).toBeUndefined();
  });

  it("on real starter maps, points over a river", () => {
    for (const seed of [STARTER_SEED, 2, 42]) {
      const w = createWorld(seed, true);
      const [a] = w.landscape.towns;
      let last = w.stations.get(a.id)!;
      for (let i = 0; i < 4; i++) last = appendPiece(w.layout, "straight-216", false, connectorRef(last, 1));
      const g = w.landscape.grid;
      const guide = goal("build-bridge").guide(w);
      const [river, near, far] = guide.points;
      expect(g.surface[g.cellAtWorld(river.x, river.z)], `seed ${seed}`).toBe(SURF_RIVER);
      expect(g.surface[g.cellAtWorld(near.x, near.z)], `seed ${seed}`).not.toBe(SURF_RIVER);
      expect(g.surface[g.cellAtWorld(far.x, far.z)], `seed ${seed}`).not.toBe(SURF_RIVER);
      expect(goal("build-bridge").check(w).hint, `seed ${seed}`).toBeUndefined();
    }
  });

  it("falls back to the line when the map has no river", () => {
    const { w } = joined();
    const g = w.landscape.grid;
    g.forEachCell((i) => {
      if (g.surface[i] === 1) g.surface[i] = 0;
    });
    g.touch();
    const guide = goal("build-bridge").guide(w);
    expect(guide.points.length).toBeGreaterThan(0);
    expect(guide.marks).toEqual([]);
  });
});

describe("GoalTracker", () => {
  it("ticks goals off in order, one a check; one met early waits for its turn", () => {
    const { w, straights } = joined();
    const tracker = new GoalTracker();
    expect(tracker.update(w).map((g) => g.id)).toEqual(["join-two"]);
    expect(tracker.current()?.id).toBe("place-train");
    // Met out of order: a switch before any train. It isn't ticked off ahead of the current goal.
    appendPiece(w.layout, "switch", true, connectorRef(straights[3], 0));
    expect(tracker.update(w)).toEqual([]);
    expect(tracker.waiting("lay-switch")).toBe(true);
    expect(tracker.isDone("lay-switch")).toBe(false);
    expect(tracker.current()?.id).toBe("place-train");
    expect(tracker.next()?.id).toBe("get-moving");
    // Pulling the track up again doesn't undo a goal, nor announce it twice.
    for (const id of straights) w.layout.removePiece(id);
    expect(tracker.update(w)).toEqual([]);
    expect(tracker.isDone("join-two")).toBe(true);
    expect(tracker.doneCount).toBe(1);
    // Saved, a goal met and waiting comes back done.
    expect(new GoalTracker(tracker.ids()).isDone("lay-switch")).toBe(true);
  });

  it("several met at once are ticked off one a check, in order", () => {
    const { w, straights } = joined();
    trainOn(w, straights[1], ["engine", "timber"]);
    const tracker = new GoalTracker();
    const order: string[] = [];
    for (let k = 0; k < 4; k++) {
      const fresh = tracker.update(w);
      expect(fresh.length).toBeLessThanOrEqual(1);
      order.push(...fresh.map((g) => g.id));
    }
    expect(order).toEqual(["join-two", "place-train"]);
    expect(tracker.current()?.id).toBe("get-moving");
  });

  it("research comes right after the first village, before the workshop (spec §4)", () => {
    const ids = GOALS.map((g) => g.id);
    const from = ids.indexOf("deliver-planks");
    // (Then "Open a farm", once Farming is learned: map sites step 2.)
    expect(ids.slice(from, from + 9)).toEqual(["deliver-planks", "grow-town", "place-school", "learn-switches", "place-workshop", "make-switch", "lay-switch", "open-farm", "build-bridge"]);
    expect(goal("learn-switches").title).toBe("Research switches");
    expect(goal("learn-switches").hint).toBe("Pick Switches. Trains bring the school the 3 planks it needs.");
    expect(goal("learn-switches").blueprint).toBe("switches");
    expect(goal("build-bridge").blueprint).toBe("bridges");
  });

  it("place a school by a town: Show me finds a straight beside the village's station where it fits, from the Industries tab", () => {
    const w = buildStarterWorld();
    const g = goal("place-school");
    expect(g.check(w).done).toBe(false);
    // Larkfield a village (the town that's grown most), with a line out of its station.
    const t = w.landscape.towns[0];
    for (const end of [0, 1]) {
      let last = w.stations.get(t.id)!;
      for (let i = 0; i < 4; i++) last = appendPiece(w.layout, "straight-216", false, connectorRef(last, i === 0 ? end : 1));
    }
    w.economy.delivered.set(t.id, 4);
    const guide = g.guide(w);
    expect(guide.tab).toBe("industries");
    expect(guide.held?.type).toBe("depot-school");
    expect(guide.marks).toHaveLength(1);
    const spot = guide.points[0];
    expect(Math.hypot(spot.x - t.station.x, spot.z - t.station.z)).toBeLessThan(1500);
    expect(siteWhy(w.landscape, "depot-school", { ...spot, heading: guide.held!.heading })).toBe(null);
    // Placed there: done, and the switches goal's Show me points at it.
    w.layout.addPiece("depot-school", { x: spot.x, z: spot.z, heading: guide.held!.heading });
    syncIndustries(w, true);
    expect(g.check(w).done).toBe(true);
    const at = goal("learn-switches").guide(w).marks[0];
    expect(Math.hypot(at.x - spot.x, at.z - spot.z)).toBeLessThan(1);
  });

  it("the tray rings what the goal asks to place: the school for Place a school, not the workshop (QA P4)", () => {
    const w = buildStarterWorld();
    // The workshop is in the starting box, but the goal is the school.
    expect(trayRing(goal("place-school"), w)).toBe("depot-school");
    expect(trayRing(goal("learn-switches"), w)).toBe("depot-school");
    expect(trayRing(goal("grow-town"), w)).toBe(null);
    expect(trayRing(goal("place-workshop"), w)).toBe("depot-workshop");
    expect(trayRing(null, w)).toBe(null);
    // A school on the map: no ring for it any more.
    const station = w.stations.get(w.landscape.towns[0].id)!;
    appendPiece(w.layout, "depot-school", false, connectorRef(station, 0));
    syncIndustries(w);
    expect(trayRing(goal("place-school"), w)).toBe(null);
    expect(trayRing(goal("learn-switches"), w)).toBe(null);
    expect(trayRing(goal("place-workshop"), w)).toBe("depot-workshop");
    // The tray's ring follows the current goal (not "a workshop while none is placed"), redrawn when one ticks.
    expect(mainSrc).toMatch(/item\.type === trayRing\(goals\.current\(\), game\.world\)/);
    expect(mainSrc).not.toMatch(/item\.type === "depot-workshop" && workshops\(game\.world\)\.length === 0/);
  });

  it("research switches: done once learned; with no school, the hint says to place one", () => {
    const w = buildStarterWorld();
    expect(goal("learn-switches").check(w, { learned: new Set() })).toEqual({ done: false, hint: "Place your school beside a town (Industries tab)." });
    expect(goal("learn-switches").check(w, { learned: new Set(["switches"]) }).done).toBe(true);
  });

  it("the workshop after research: place it, order a switch, trains bring its planks, made (QA P4: planks first stalled)", () => {
    const w = buildStarterWorld();
    expect(goal("place-workshop").check(w).done).toBe(false);
    expect(goal("place-workshop").guide(w).tab).toBe("industries");
    const station = w.stations.get(w.landscape.towns[0].id)!;
    const piece = appendPiece(w.layout, "depot-workshop", false, connectorRef(station, 0));
    syncIndustries(w);
    expect(goal("place-workshop").check(w).done).toBe(true);
    const g = goal("make-switch");
    expect(g.title).toBe("Make a switch");
    expect(g.hint).toBe(MAKE_SWITCH_HINT);
    // Show me: the workshop alone, its card opened to choose from (not the sawmill's planks).
    expect(g.guide(w)).toMatchObject({ points: [w.layout.getPiece(piece)!.pose], marks: [w.layout.getPiece(piece)!.pose], card: w.economy.depotAtPiece(piece)!.id });
    expect(mainSrc).toMatch(/if \(guide\.card !== undefined\) interaction\.openDepotCard\(guide\.card\);/);
    // Nothing ordered: the workshop keeps no planks, and planks in its yard alone don't tick it.
    const p = Progress.fresh();
    p.learned.add("switches");
    const ctx = () => ({ learned: p.learned, owned: p.owned, orders: p.orders });
    expect(keepsForOrder(p, 0)).toBe(false);
    const yard = w.economy.depotAtPiece(piece)!;
    yard.piles[CARGO.planks.index] = 2;
    expect(g.check(w, ctx())).toEqual({ done: false });
    yard.piles[CARGO.planks.index] = 0;
    // Ordered: the workshop keeps planks for it (towns leave them on the train), and the goal counts them in.
    const crafting = new Crafting(p);
    crafting.order("piece:switch");
    expect(keepsForOrder(p, 0)).toBe(true);
    expect(g.check(w, ctx())).toEqual({ done: false, count: 0, target: 3, unit: "planks", hint: SWITCH_ORDERED_HINT });
    yard.piles[CARGO.planks.index] = 2;
    expect(g.check(w, ctx())).toMatchObject({ done: false, count: 2, target: 3 });
    yard.piles[CARGO.planks.index] = 3;
    for (let k = 0; k < 5; k++) crafting.tick(w, 1);
    // Made: in the toy box, the goal done (and still done once it's laid).
    expect(p.owned.get("piece:switch")).toBe(1);
    expect(g.check(w, ctx()).done).toBe(true);
    // The workshop's card says the order of things: choose, then trains bring the planks.
    expect(panelSrc).toContain("Choose what to make: trains bring the planks.");
    expect(panelSrc).not.toContain("Bring planks here");
    // The game passes the toy box and the orders to the goals.
    expect(mainSrc).toContain("const ctx = { learned: progress.learned, owned: progress.owned, orders: progress.orders };");
    // An order on the card is heard at once (when idle, no frame comes to poll the goals).
    expect(mainSrc).toMatch(/crafting\.order\(id\);\s*showWorkshop\(true\);\s*checkGoals\(true\);/);
  });

  it("switches learned by research tick neither workshop goal (QA: both ticked with no workshop placed)", () => {
    const w = buildStarterWorld();
    const ctx = { learned: new Set(["switches"]) };
    expect(goal("place-workshop").check(w, ctx).done).toBe(false);
    expect(goal("make-switch").check(w, ctx).done).toBe(false);
    // The tracker, at the workshop goal with switches researched (the goal before it): it stays there.
    const upTo = GOALS.slice(0, GOALS.findIndex((g) => g.id === "place-workshop")).map((g) => g.id);
    const tracker = new GoalTracker(upTo);
    for (let k = 0; k < 3; k++) expect(tracker.update(w, ctx).map((g) => g.id)).not.toContain("place-workshop");
    expect(tracker.current()?.id).toBe("place-workshop");
    expect(tracker.ids()).not.toContain("make-switch");
  });

  it("restores from saved ids, ignoring ones it doesn't know", () => {
    const tracker = new GoalTracker(["join-two", "no-such-goal"]);
    expect(tracker.ids()).toEqual(["join-two"]);
    expect(tracker.current()?.id).toBe("place-train");
  });

  it("has no current goal once all are done", () => {
    const tracker = new GoalTracker(GOALS.map((g) => g.id));
    expect(tracker.current()).toBeNull();
    expect(tracker.next()).toBeNull();
  });

  it("three towns joined through a depot and over a bridge count, and the goal is ticked off while the tutorial isn't done", () => {
    const w = buildStarterWorld();
    const [a, b, c] = w.landscape.towns;
    const layout = new Layout();
    // Three "stations" (any pieces) joined: a — depot — bridge — b, and a — straight — c.
    const sa = layout.addPiece("straight-216", { x: 0, z: 0, heading: 0 });
    const depot = appendPiece(layout, "depot-sawmill", false, connectorRef(sa, 1));
    const bridge = appendPiece(layout, "bridge", false, connectorRef(depot, 1));
    const sb = appendPiece(layout, "straight-216", false, connectorRef(bridge, 1));
    const sc = appendPiece(layout, "straight-216", false, connectorRef(sa, 0), 1);
    const stations = new Map([[a.id, sa], [b.id, sb], [c.id, sc]]);
    expect(connectedPairs(layout, stations)).toHaveLength(3);
    // In the game: the starter's first three towns joined, while the tutorial is still on laying a switch.
    const { w: joinedWorld } = joined();
    const tutorial = GOALS.slice(0, GOALS.findIndex((g) => g.id === "lay-switch")).map((g) => g.id);
    const tracker = new GoalTracker(tutorial);
    expect(tracker.current()?.id).toBe("lay-switch");
    const three = { ...joinedWorld, stations } as unknown as typeof joinedWorld;
    Object.assign(three, { layout });
    // The bridge counts too (the user's case: a bridge on the way to the third town): one a check.
    expect(tracker.update(three).map((g) => g.id)).toEqual(["build-bridge"]);
    expect(tracker.update(three).map((g) => g.id)).toEqual(["join-three"]);
    expect(tracker.current()?.id).toBe("lay-switch");
  });
});

describe("place-workshop guide", () => {
  /** The middle of a straight. */
  const middle = (w: World, id: number) => {
    const p = w.layout.getPiece(id)!.pose;
    return { x: p.x + 108 * Math.cos(p.heading), z: p.z + 108 * Math.sin(p.heading) };
  };
  /** Raise every square within `r` of a straight's middle, but the ones its track runs over: both its sides. */
  function hillsBeside(w: World, id: number): void {
    const g = w.landscape.grid;
    const m = middle(w, id);
    const p = w.layout.getPiece(id)!.pose;
    g.forEachCell((i, col, row) => {
      const dx = g.centreX(col) - m.x;
      const dz = g.centreZ(row) - m.z;
      const across = Math.abs(-Math.sin(p.heading) * dx + Math.cos(p.heading) * dz);
      const along = Math.abs(Math.cos(p.heading) * dx + Math.sin(p.heading) * dz);
      if (along < 150 && across > 50 && across < 160) g.height[i] = 1;
    });
    g.revision++;
  }

  it("points at a straight of the line where the workshop fits, past ones where its yard wouldn't", () => {
    const { w, straights } = joined();
    const first = goal("place-workshop").guide(w);
    expect(first).toMatchObject({ tab: "industries", shelf: "Industries" });
    expect(first.marks).toHaveLength(1);
    const at = straights.find((id) => {
      const m = middle(w, id);
      return Math.hypot(m.x - first.points[0].x, m.z - first.points[0].z) < 1;
    });
    expect(at, "a straight's middle").toBeDefined();
    // Hills both sides of that straight: the guide moves on to another.
    hillsBeside(w, at!);
    const next = goal("place-workshop").guide(w);
    expect(next.marks).toHaveLength(1);
    expect(Math.hypot(next.points[0].x - first.points[0].x, next.points[0].z - first.points[0].z)).toBeGreaterThan(100);
    // Nowhere it fits: still a marker (QA: it showed none), on the line where it's nearest the stations.
    for (const id of straights) hillsBeside(w, id);
    const none = goal("place-workshop").guide(w);
    expect(none.marks).toHaveLength(1);
    expect(straights.map((id) => w.layout.getPiece(id)!.pose)).toContainEqual(none.marks[0]);
    expect(none.points[0]).toEqual(none.marks[0]);
  });

  it("says which way round the workshop fits at its spot: held so, it takes that straight's place and fits", () => {
    /** Raise the squares beside a straight's middle on one side only (`side` +1: its left, −1: its right). */
    const hillOneSide = (w: World, id: number, side: 1 | -1) => {
      const g = w.landscape.grid;
      const m = middle(w, id);
      const p = w.layout.getPiece(id)!.pose;
      g.forEachCell((i, col, row) => {
        const dx = g.centreX(col) - m.x;
        const dz = g.centreZ(row) - m.z;
        const across = side * (-Math.sin(p.heading) * dx + Math.cos(p.heading) * dz);
        const along = Math.abs(Math.cos(p.heading) * dx + Math.sin(p.heading) * dz);
        if (along < 150 && across > 50 && across < 160) g.height[i] = 1;
      });
      g.revision++;
    };
    /** Held over `at` turned `heading`: does the workshop take a straight's place there and fit, yard and all? */
    const fitsHeld = (w: World, at: { x: number; z: number }, heading: number) => {
      const s = findSplice(w.layout, "depot-workshop", false, at, heading, 14);
      if (s.kind !== "splice") return false;
      const ctx = { land: w.landscape, layout: w.layout, props: w.props, footprint: () => undefined };
      return checkPlacement(w.landscape, "depot-workshop", false, s.pose, s.y).kind === "clear" && checkYard(ctx, "depot-workshop", s.pose, s.y, new Set(s.covers)) === null;
    };
    for (const side of [1, -1] as const) {
      const { w, straights } = joined();
      const spot = goal("place-workshop").guide(w).points[0];
      const at = straights.find((id) => Math.hypot(middle(w, id).x - spot.x, middle(w, id).z - spot.z) < 1)!;
      // Only one way round fits there now (QA: in the starting view the spot was refused, the other way round).
      hillOneSide(w, at, side);
      const g = goal("place-workshop").guide(w);
      expect(g.held?.type).toBe("depot-workshop");
      expect(fitsHeld(w, g.points[0], g.held!.heading), `side ${side}`).toBe(true);
      expect(fitsHeld(w, g.points[0], g.held!.heading + Math.PI), `side ${side}, turned round`).toBe(false);
    }
  });

  it("with no track laid yet, shows the next towns to join, as before", () => {
    const fresh = buildStarterWorld();
    expect(goal("place-workshop").guide(fresh).towns.length).toBe(2);
  });
  it("two trains at once waits for signals (a passing loop): hidden, not counted, never the current goal till then", () => {
    const w = buildStarterWorld();
    const t = new GoalTracker(GOALS.filter((g) => g.id !== "two-trains" && g.id !== "join-all").map((g) => g.id));
    t.update(w, { learned: new Set(["switches"]) });
    expect(t.current()?.id).toBe("join-all");
    expect(t.next()).toBeNull();
    expect(t.total).toBe(GOALS.length - 1);
    expect(t.lockedHint()).toBe("Research Signals to unlock a goal");
    // Every other goal done: still not the current one.
    const all = new GoalTracker(GOALS.filter((g) => g.id !== "two-trains").map((g) => g.id));
    all.update(w, { learned: new Set() });
    expect(all.current()).toBeNull();
    expect(all.lockedHint()).toBe("Research Signals to unlock a goal");
    t.update(w, { learned: new Set(["switches", "signals"]) });
    expect(t.current()?.id).toBe("two-trains");
    expect(t.total).toBe(GOALS.length);
    expect(t.lockedHint()).toBeNull();
  });

  it("learning Signals names the goal it opens, and where the second engine is (QA: it opened unseen)", () => {
    const t = new GoalTracker(["join-two", "place-train"]);
    // Signals open "Run two trains at once"; Switches open none (no goal waits for them alone).
    expect(t.openedBy("signals", new Set(["switches", "signals"])).map((g) => g.title)).toEqual(["Run two trains at once"]);
    expect(t.openedBy("switches", new Set(["switches"]))).toEqual([]);
    // Already done (an old save): nothing to say.
    expect(new GoalTracker(["two-trains"]).openedBy("signals", new Set(["signals"]))).toEqual([]);
    // The second engine: in the toy box (the Signals present, or one made), to be made (one owned), or both on the map.
    expect(secondEngineTip(1, 2)).toBe("Engine in the Trains tab");
    expect(secondEngineTip(0, 1)).toBe("Make an engine at the workshop");
    expect(secondEngineTip(0, 2)).toBe("");
    // The game's "Learned" note folds them in.
    expect(mainSrc).toMatch(/goals\.openedBy\(id, progress\.learned\)/);
    expect(mainSrc).toMatch(/present \+ goalLine/);
  });

  it("two trains at once, with one train on the map, says to put the second engine on first; Show me opens Engines", () => {
    const { w, straights } = joined();
    const t = trainOn(w, straights[1], ["engine", "timber"]);
    t.speed = 80;
    expect(goal("two-trains").check(w)).toMatchObject({ done: false, count: 1, hint: TWO_TRAINS_HINT });
    expect(goal("two-trains").guide(w)).toMatchObject({ tab: "trains", shelf: "Engines" });
    // Two on the map, one standing: the goal's own hint (the passing loop).
    trainOn(w, w.stations.get(w.landscape.towns[0].id)!);
    expect(goal("two-trains").check(w).hint).toBeUndefined();
  });
});

describe("goals after a blueprint pre-pick its research", () => {
  it("Learn switches and Build a bridge name their blueprint; the picker opens on it while the school is idle", () => {
    expect(goal("learn-switches").blueprint).toBe("switches");
    expect(goal("build-bridge").blueprint).toBe("bridges");
    const p = Progress.fresh();
    expect(goalPick(p, goal("learn-switches").blueprint, true)).toBe("switches");
    expect(goalPick(p, goal("build-bridge").blueprint, true)).toBe("bridges");
    // Nothing picked for you; with a research under way, none.
    expect(p.research.current).toBeNull();
    pick(p, "switches");
    expect(goalPick(p, goal("build-bridge").blueprint, true)).toBeNull();
    // Show me still opens the picker on it (to put it up next), till it's learned.
    expect(showMePick(p, goal("build-bridge").blueprint, true)).toBe("bridges");
    p.learned.add("bridges");
    expect(showMePick(p, goal("build-bridge").blueprint, true)).toBeNull();
  });
});

describe("Open a quarry, a mine, a harbour (map sites step 3)", () => {
  const ROLES = [
    { id: "open-quarry", role: "quarry", bp: "quarries", title: "Open a quarry", hint: "Restore an old quarry, or build one by a hillside." },
    { id: "open-mine", role: "mine", bp: "mines", title: "Open a mine", hint: "Restore an old mine, or build one by a hillside." },
    { id: "open-harbour", role: "harbour", bp: "harbours", title: "Open a harbour", hint: "Restore an old harbour, or build one by the sea." },
  ] as const;

  /** A Game map with the ring of plots round its start bought (its ruins standing): the first of these with 2 ruins of `role`. */
  const worlds = new Map<number, World>();
  function withTwo(role: SiteRole): { w: World; a: MapSite; b: MapSite } {
    for (const seed of [7, 1, 2, 3, 42, 99, 1234, 2027]) {
      let w = worlds.get(seed);
      if (!w) {
        w = createWorld(seed, true);
        for (const p of plotsForSale(w.landscape)) unlockPlot(w, p.px, p.pz);
        worlds.set(seed, w);
      }
      const ruins = (w.landscape.sites ?? []).filter((s) => s.role === role && !s.cleared);
      if (ruins.length >= 2) return { w, a: ruins[0], b: ruins[1] };
    }
    throw new Error(`no map with two old ${role}s`);
  }

  it("come after the passing loop, before Connect every town; each needs its blueprint; Open a farm is where it was", () => {
    const ids = GOALS.map((g) => g.id);
    expect(GOALS).toHaveLength(23);
    expect(ids.slice(ids.indexOf("two-trains"))).toEqual(["two-trains", "open-quarry", "open-mine", "open-harbour", "join-all", "buy-land"]);
    for (const r of ROLES) expect(goal(r.id)).toMatchObject({ title: r.title, hint: r.hint, needs: [r.bp] });
    expect(goal("open-farm")).toMatchObject({ title: "Open a farm", hint: "Restore an old farm, or build a farm yard by some fields.", needs: ["farming"] });
    expect(OPEN_INDUSTRY_GOALS).toEqual(["open-farm", "open-quarry", "open-mine", "open-harbour"]);
  });

  it("each shows once its blueprint is learned (hidden and not counted till then), and learning it names the goal", () => {
    const w = buildStarterWorld();
    const before = GOALS.filter((g) => !ROLES.some((r) => r.id === g.id) && g.id !== "join-all").map((g) => g.id);
    for (const r of ROLES) {
      const t = new GoalTracker(before);
      t.update(w, { learned: new Set(["signals", "farming"]) });
      expect(t.current()?.id).toBe("join-all");
      expect(t.total).toBe(GOALS.length - 3);
      expect(t.lockedCount).toBe(3);
      expect(t.openedBy(r.bp, new Set([r.bp])).map((g) => g.title)).toEqual([r.title]);
      t.update(w, { learned: new Set(["signals", "farming", r.bp]) });
      expect(t.current()?.id).toBe(r.id);
      expect(t.total).toBe(GOALS.length - 2);
    }
  });

  for (const r of ROLES) {
    it(`${r.title}: Show me picks the old ${r.role} nearest the line (its card), and it's done once one is restored or built`, () => {
      const { w, a, b } = withTwo(r.role);
      const g = goal(r.id);
      // A bit of the player's track beside each ruin in turn: the line is there, so the nearest ruin is that one.
      for (const near of [a, b]) {
        const piece = w.layout.addPiece("straight-216", { x: near.centre.x + 400, z: near.centre.z, heading: 0 });
        const guide = g.guide(w);
        expect(guide.ruin).toBe(near.id);
        expect(guide.marks).toEqual([near.centre]);
        expect(guide.points[0]).toEqual(near.centre);
        w.layout.removePiece(piece);
      }
      expect(g.check(w).done).toBe(false);
      // Restored: done.
      const fixed = fixedPieces(w);
      const editor = new Editor(w.layout, w.sim, () => {}, (id) => fixed.has(id));
      const done = restoreRuin(w, editor, a.id);
      if (!("pieceId" in done)) throw new Error(done.why);
      syncIndustries(w);
      expect(g.check(w).done).toBe(true);
      // Undone, not; one of the player's own built anywhere, done again.
      editor.undo();
      syncIndustries(w);
      expect(g.check(w).done).toBe(false);
      const own = w.layout.addPiece(restoredType(r.role), { x: -30000, z: -30000, heading: 0 });
      syncIndustries(w);
      expect(g.check(w).done).toBe(true);
      w.layout.removePiece(own);
      syncIndustries(w);
    });
  }

  it("with no ruin of that kind on the land, Show me falls back to a spot for a new one (the Industries tab)", () => {
    const w = buildStarterWorld();
    for (const r of ROLES) {
      const guide = goal(r.id).guide(w);
      expect(guide.ruin).toBeUndefined();
      expect(guide).toMatchObject({ tab: "industries", shelf: "Industries" });
    }
  });
});

describe("Buy some land", () => {
  it("is the last goal, an open one: ticked when a plot is bought (as the land card's Add this land does), and stays", () => {
    expect(GOALS[GOALS.length - 1].id).toBe("buy-land");
    expect(goal("buy-land").title).toBe("Buy some land");
    expect(goal("buy-land").hint).toBe(BUY_LAND_HINT);
    const w = buildStarterWorld();
    const tracker = new GoalTracker();
    expect(plotsBought(w)).toBe(0);
    expect(goal("buy-land").check(w).done).toBe(false);
    for (let k = 0; k < 3; k++) expect(tracker.update(w).map((g) => g.id)).not.toContain("buy-land");
    // Show me: a plot for sale, framed.
    expect(goal("buy-land").guide(w).points.length).toBeGreaterThan(0);
    // main.ts's buyLand: Game.unlockPlot, which is world's unlockPlot (and draws it).
    const [plot] = plotsForSale(w.landscape);
    expect(unlockPlot(w, plot.px, plot.pz)).not.toBeNull();
    expect(plotsBought(w)).toBe(1);
    // Open (past the tutorial), so ticked though it's not the current goal.
    expect(tracker.current()?.id).not.toBe("buy-land");
    expect(tracker.update(w).map((g) => g.id)).toEqual(["buy-land"]);
    expect(tracker.isDone("buy-land")).toBe(true);
    // Stays met: kept in the saved goals.
    expect(new GoalTracker(tracker.ids()).isDone("buy-land")).toBe(true);
  });

  it("an old save with land bought ticks it on load", () => {
    const w = buildStarterWorld();
    const [plot] = plotsForSale(w.landscape);
    expect(unlockPlot(w, plot.px, plot.pz)).not.toBeNull();
    const r = deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(w))));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Its goals saved before this goal was: some done, not this one.
    const tracker = new GoalTracker(["join-two", "place-train"]);
    expect(tracker.update(r.value).map((g) => g.id)).toContain("buy-land");
    // An old save with no land bought: not ticked.
    const plain = deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(buildStarterWorld()))));
    if (!plain.ok) throw new Error(plain.error);
    const t2 = new GoalTracker(["join-two", "place-train"]);
    for (let k = 0; k < 3; k++) t2.update(plain.value);
    expect(t2.isDone("buy-land")).toBe(false);
  });
});
