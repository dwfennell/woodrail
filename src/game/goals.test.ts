import { describe, expect, it } from "vitest";
import { appendPiece, connectorRef, findSplice, Layout } from "../track";
import { checkPlacement, connectedPairs, FEAT_TREE, SURF_GRASS, SURF_RIVER } from "../landscape";
import { checkYard } from "./depot-footprint";
import { BRIDGE_KNOWN_HINT, GOALS, GoalTracker, NOTHING_ACROSS_HINT, NOTHING_ACROSS_KNOWN } from "./goals";
import { buildStarterWorld, createWorld, STARTER_SEED, syncIndustries, type World } from "./world";
import { CARGO } from "../economy/cargo";
import { Progress } from "./progress";
import { pick } from "./research";
import { goalPick, showMePick } from "./research-text";

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
    expect(known.hint).not.toMatch(/learn/i);
    // Not learned: its own hint, which says to learn them.
    expect(goal("build-bridge").hint).toMatch(/Learn bridges/);
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
    expect(t.lockedHint()).toBe("Learn Signals to unlock a goal");
    // Every other goal done: still not the current one.
    const all = new GoalTracker(GOALS.filter((g) => g.id !== "two-trains").map((g) => g.id));
    all.update(w, { learned: new Set() });
    expect(all.current()).toBeNull();
    expect(all.lockedHint()).toBe("Learn Signals to unlock a goal");
    t.update(w, { learned: new Set(["switches", "signals"]) });
    expect(t.current()?.id).toBe("two-trains");
    expect(t.total).toBe(GOALS.length);
    expect(t.lockedHint()).toBeNull();
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
