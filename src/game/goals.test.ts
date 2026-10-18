import { describe, expect, it } from "vitest";
import { appendPiece, connectorRef, Layout } from "../track";
import { connectedPairs } from "../landscape";
import { GOALS, GoalTracker } from "./goals";
import { buildStarterWorld, syncIndustries, type World } from "./world";
import { CARGO } from "../economy/cargo";

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
    expect(goal("place-train").guide(w).tab).toBe("trains");
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

  it("the workshop comes before switches: place it, bring it planks, learn switches", () => {
    const ids = GOALS.map((g) => g.id);
    const at = (id: string) => ids.indexOf(id);
    expect(at("place-workshop")).toBeLessThan(at("workshop-planks"));
    expect(at("workshop-planks")).toBeLessThan(at("learn-switches"));
    expect(at("learn-switches")).toBeLessThan(at("lay-switch"));
    const w = buildStarterWorld();
    expect(goal("learn-switches").check(w, { learned: new Set() }).done).toBe(false);
    expect(goal("learn-switches").check(w, { learned: new Set(["switches"]) }).done).toBe(true);
    expect(goal("place-workshop").check(w).done).toBe(false);
    expect(goal("place-workshop").guide(w).tab).toBe("industries");
    // A workshop placed, then planks in its yard.
    const station = w.stations.get(w.landscape.towns[0].id)!;
    const piece = appendPiece(w.layout, "depot-workshop", false, connectorRef(station, 0));
    syncIndustries(w);
    expect(goal("place-workshop").check(w).done).toBe(true);
    expect(goal("workshop-planks").check(w).done).toBe(false);
    w.economy.depotAtPiece(piece)!.piles[CARGO.planks.index] = 2;
    expect(goal("workshop-planks").check(w).done).toBe(true);
    expect(goal("workshop-planks").guide(w).marks).toEqual([w.layout.getPiece(piece)!.pose]);
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
    // Nowhere it fits: as before, the line itself.
    for (const id of straights) hillsBeside(w, id);
    const none = goal("place-workshop").guide(w);
    expect(none.points.length).toBe(straights.length);
    expect(none.marks).toEqual([]);
  });

  it("with no track laid yet, shows the next towns to join, as before", () => {
    const fresh = buildStarterWorld();
    expect(goal("place-workshop").guide(fresh).towns.length).toBe(2);
  });
  it("two trains at once waits for signals and junctions (a passing loop): passed over till then, and not counted", () => {
    const w = buildStarterWorld();
    const t = new GoalTracker(GOALS.filter((g) => g.id !== "two-trains" && g.id !== "join-all").map((g) => g.id));
    t.update(w, { learned: new Set(["signals"]) });
    expect(t.current()?.id).toBe("join-all");
    expect(t.next()?.id).toBe("two-trains");
    t.update(w, { learned: new Set(["signals", "junctions"]) });
    expect(t.current()?.id).toBe("two-trains");
  });
});
