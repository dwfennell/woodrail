import { describe, expect, it } from "vitest";
import { CARGO, type DepotRole } from "../economy";
import { ticks } from "../economy/constants";
import { mergeProgress } from "../persist/progress-merge";
import { PropStore } from "../props/store";
import { appendPiece, connectorRef, Layout } from "../track";
import { updateRates } from "./industries";
import { leversNear, leversWorked, TELEGRAPH_POLE, WIRE_SPAN, wiredPoles } from "./lineside";
import { Progress, REGATES } from "./progress";
import { aheadLacking, aheadLacks, deliver, dequeue, lacking, READING_ROOM, researchFromJSON, researchToJSON, tick, toggleQueue, wants, STUDY_SECONDS } from "./research";
import { readingAhead, schoolCard } from "./research-text";
import { ready, techOf, unlocksOf } from "./tech";
import { boostOf, Counters, machinesFor } from "./upgrades";
import { buildStarterWorld, syncIndustries } from "./world";

/** Tech tree 4: the Reading room, Signal boxes and the Telegraph, and second tiers for mines, foundries, carpenters and smithies. */

/** A player with the Reading room (and what it needs), coins for anything, and the farm's research to queue. */
function reader(withRoom = true): Progress {
  const p = Progress.fresh();
  for (const id of ["switches", "routes", "college", "farming", ...(withRoom ? [READING_ROOM] : [])]) p.learned.add(id);
  p.coins = 1000;
  return p;
}

describe("the Reading room", () => {
  it("is a Learning blueprint after College, tier 2, mostly coins", () => {
    const t = techOf(READING_ROOM)!;
    expect(t.plan).toBeUndefined();
    expect([t.branch, t.tier, t.needs]).toEqual(["learning", 2, ["college"]]);
    expect(t.research).toEqual({ goods: { planks: 6 }, coins: 120 });
    expect(t.school).toBeUndefined();
  });

  it("without it, schools take only what the research under way lacks", () => {
    const p = reader(false);
    toggleQueue(p, "mills"); // current: 6 planks, 6 grain
    toggleQueue(p, "study-hall"); // next: 4 planks
    expect(p.research.current).toBe("mills");
    expect(p.research.next).toBe("study-hall");
    expect(wants(p, "planks")).toBe(6);
    expect(deliver(p, "planks", 10)).toBe(6);
    expect(wants(p, "planks")).toBe(0);
    expect(aheadLacking(p, "planks")).toBe(0);
    expect(readingAhead(p)).toBe("");
  });

  it("with it, schools collect the next research's goods once the one under way has its own, and they go in as it starts", () => {
    const p = reader();
    toggleQueue(p, "mills");
    toggleQueue(p, "study-hall");
    // The one under way first, then the one up next: 6 + 4 planks.
    expect(wants(p, "planks")).toBe(10);
    expect(lacking(p, "planks")).toBe(6);
    expect(deliver(p, "planks", 8)).toBe(8);
    expect(p.research.got.planks).toBe(6);
    expect(p.research.early.get("study-hall")).toEqual({ planks: 2 });
    expect(aheadLacks(p)).toEqual({ planks: 2 });
    expect(schoolCard(p).note).toContain("Reading ahead for Study hall: 2/4");
    expect(deliver(p, "planks", 5)).toBe(2);
    expect(wants(p, "planks")).toBe(0);
    // Grain is the one under way's alone.
    expect(wants(p, "grain")).toBe(6);
    deliver(p, "grain", 6);
    // Mills studied and learned: Study hall starts with its goods all in, and studies straight away.
    expect(tick(p, STUDY_SECONDS[2])).toBe("mills");
    expect(p.research.current).toBe("study-hall");
    expect(p.research.got).toEqual({ planks: 4 });
    expect(p.research.early.size).toBe(0);
    expect(tick(p, STUDY_SECONDS[1])).toBe("study-hall");
  });

  it("a school that can't take the research under way's goods (a College's) still collects ahead for the next", () => {
    const p = reader();
    toggleQueue(p, "mills");
    toggleQueue(p, "study-hall");
    const notMills = (id: string) => id !== "mills";
    expect(wants(p, "planks", notMills)).toBe(4);
    expect(deliver(p, "planks", 6, notMills)).toBe(4);
    expect(p.research.got.planks ?? 0).toBe(0);
    expect(p.research.early.get("study-hall")).toEqual({ planks: 4 });
  });

  it("keeps what it collected when the research leaves the queue, and saves it", () => {
    const p = reader();
    toggleQueue(p, "mills");
    toggleQueue(p, "study-hall");
    deliver(p, "planks", 9);
    dequeue(p, "study-hall");
    expect(p.research.next).toBeNull();
    expect(p.research.early.get("study-hall")).toEqual({ planks: 3 });
    const back = researchFromJSON(JSON.parse(JSON.stringify(researchToJSON(p.research))), (id) => (typeof id === "string" && techOf(id) ? id : null), new Set(["planks", "grain"]));
    expect(back.early.get("study-hall")).toEqual({ planks: 3 });
    // Queued again: it needs only the rest.
    p.research = back;
    toggleQueue(p, "study-hall");
    expect(aheadLacking(p, "planks")).toBe(1);
    // A save from before it has none.
    expect(researchFromJSON({ current: null, next: null, got: [], study: 0 }, () => null, new Set()).early.size).toBe(0);
  });

  it("a cloud merge keeps the most either side collected ahead", () => {
    const a = reader();
    toggleQueue(a, "mills");
    toggleQueue(a, "study-hall");
    deliver(a, "planks", 8);
    const b = Progress.fromJSON(JSON.parse(JSON.stringify(a.toJSON())));
    deliver(b, "planks", 1);
    const merged = Progress.fromJSON(mergeProgress(a.toJSON(), a.toJSON(), b.toJSON(), "remote"));
    expect(merged.research.early.get("study-hall")).toEqual({ planks: 3 });
  });
});

describe("Signal boxes and the Telegraph", () => {
  it("Signals and routes leads on: Signal boxes (the box and lever frame), then the Telegraph (its poles)", () => {
    expect(techOf("signal-boxes")).toMatchObject({ branch: "track", tier: 2, needs: ["routes"] });
    expect(techOf("telegraph")).toMatchObject({ tier: 2, needs: ["signal-boxes"] });
    expect(techOf("telegraph")!.plan).toBeUndefined();
    expect(unlocksOf("signal-boxes").sort()).toEqual(["prop:bldg-signal-box", "prop:mech-lever-frame"]);
    expect(unlocksOf("telegraph")).toEqual(["prop:mech-telegraph-pole"]);
    expect(unlocksOf("scenery")).not.toContain("prop:bldg-signal-box");
    const p = Progress.fresh();
    p.learned.add("switches");
    expect(ready(p, "signal-boxes")).toBe(false);
    p.learned.add("routes");
    expect(ready(p, "signal-boxes")).toBe(true);
    expect(ready(p, "telegraph")).toBe(false);
    p.learned.add("signal-boxes");
    expect(ready(p, "telegraph")).toBe(true);
  });

  it("an old save that learned the Scenery kit keeps its signal boxes: Signal boxes comes learned; a new save's doesn't", () => {
    const old = Progress.fromJSON({ owned: [["prop:bldg-signal-box", 2]], learned: ["switches", "carpentry", "scenery"] });
    expect(old.learned.has("signal-boxes")).toBe(true);
    expect(old.knows("prop:bldg-signal-box")).toBe(true);
    expect(old.toJSON().regates).toBe(REGATES);
    // Saved since: learning the Scenery kit now brings no signal box.
    const now = Progress.fromJSON({ owned: [], learned: ["switches", "carpentry", "scenery"], regates: REGATES });
    expect(now.learned.has("signal-boxes")).toBe(false);
    expect(now.knows("prop:bldg-signal-box")).toBe(false);
    // An old save without the Scenery kit gets nothing.
    expect(Progress.fromJSON({ owned: [], learned: ["switches"] }).learned.has("signal-boxes")).toBe(false);
    // A cloud merge with an old side: its move counted as a load counts it; the merged save is a new one.
    const merged = mergeProgress(undefined, now.toJSON(), { owned: [], learned: ["scenery"] }, "local");
    expect(merged.learned).toContain("signal-boxes");
    expect(merged.regates).toBe(REGATES);
    const fresh = mergeProgress(undefined, now.toJSON(), now.toJSON(), "local");
    expect(fresh.learned).not.toContain("signal-boxes");
  });

  it("a signal box works the points and signals by every telegraph pole wired to it, in a chain", () => {
    const layout = new Layout();
    const near = layout.addPiece("switch", { x: 0, z: 0, heading: 0 });
    const far = layout.addPiece("switch", { x: 1500, z: 0, heading: 0 });
    const farSignal = layout.addPiece("signal", { x: 1700, z: 0, heading: 0 });
    const props = new PropStore();
    // The box by the near points; the far ones are beyond its reach.
    expect(leversNear(layout, 100, 80).map((l) => l.pieceId)).toEqual([near]);
    // No poles: the same with the Telegraph.
    expect(leversWorked(layout, props, 100, 80, true).map((l) => l.pieceId)).toEqual([near]);
    // Two poles in a chain from the box to the far points (each within a span of the one before).
    props.add(TELEGRAPH_POLE, { x: 100 + WIRE_SPAN - 50, z: 80, heading: 0, y: 0 });
    props.add(TELEGRAPH_POLE, { x: 100 + 2 * (WIRE_SPAN - 50), z: 80, heading: 0, y: 0 });
    expect(wiredPoles(props, 100, 80)).toHaveLength(2);
    const worked = leversWorked(layout, props, 100, 80, true);
    expect(worked.map((l) => [l.pieceId, !!l.wired])).toEqual([
      [near, false],
      [far, true],
      [farSignal, true],
    ]);
    // Without the Telegraph learned, the poles carry nothing.
    expect(leversWorked(layout, props, 100, 80, false).map((l) => l.pieceId)).toEqual([near]);
    // A break in the chain: a pole too far from the rest isn't wired.
    const gap = new PropStore();
    gap.add(TELEGRAPH_POLE, { x: 1500, z: 80, heading: 0, y: 0 });
    expect(wiredPoles(gap, 100, 80)).toEqual([]);
    expect(leversWorked(layout, gap, 100, 80, true).map((l) => l.pieceId)).toEqual([near]);
  });
});

describe("second tiers: Mines II, Foundry II, Joinery, Tool works", () => {
  const TIERS: [string, string, DepotRole, string][] = [
    ["mines2", "mines", "mine", "upgrade-winding-engine"],
    ["foundry2", "foundry", "foundry", "upgrade-furnace"],
    ["joinery", "carpentry", "carpenter", "upgrade-lathe"],
    ["toolworks", "smithy", "smithy", "upgrade-steam-hammer"],
  ];

  it("each follows its industry, 1.5× as fast, with a machine in its yard", () => {
    for (const [id, after, role, machine] of TIERS) {
      expect(techOf(id)!.needs, id).toEqual([after]);
      expect(techOf(id)!.plan, id).toBeUndefined();
      const p = Progress.fresh();
      expect(boostOf(p, role)).toBe(1);
      expect(machinesFor(p, role)).toEqual([]);
      p.learned.add(id);
      expect(boostOf(p, role), id).toBe(1.5);
      expect(machinesFor(p, role), id).toEqual([machine]);
    }
  });

  it("the late ones are taught at a College in a city or a University, as the late chains are; Joinery isn't late", () => {
    expect(techOf("mines2")!.school).toBe("college");
    expect(techOf("foundry2")!.school).toBe("college");
    expect(techOf("toolworks")!.school).toBe("university");
    expect(techOf("joinery")!.tier).toBe(2);
    expect(techOf("joinery")!.school).toBeUndefined();
    // All of them mostly coins.
    for (const [id] of TIERS) expect(techOf(id)!.research.coins ?? 0, id).toBeGreaterThanOrEqual(140);
  });

  it("they ask for work done first: coal dug, iron cast, furniture and tools delivered", () => {
    const w = buildStarterWorld();
    const p = Progress.fresh();
    for (const id of ["mines", "foundry", "carpentry", "smithy"]) p.learned.add(id);
    p.landmarks.add("college-school");
    p.landmarks.add("university-school");
    const c = new Counters();
    c.reset(w.economy);
    for (const id of ["mines2", "foundry2", "joinery", "toolworks"]) expect(ready(p, id), id).toBe(false);
    w.economy.made[CARGO.coal.index] += 60;
    w.economy.made[CARGO.iron.index] += 40;
    w.economy.deliveredGoods.set(w.landscape.towns[0].id, { furniture: 30, tools: 30 });
    c.collect(w.economy, p);
    expect(p.counts.get("coalDug")).toBe(60);
    expect(p.counts.get("ironCast")).toBe(40);
    for (const id of ["mines2", "foundry2", "joinery", "toolworks"]) expect(ready(p, id), id).toBe(true);
  });

  it("a mine and a foundry really make more once upgraded", () => {
    const run = (role: "mine" | "foundry", learn: string[]) => {
      const w = buildStarterWorld();
      const station = w.stations.get(w.landscape.towns[0].id)!;
      const piece = appendPiece(w.layout, `depot-${role}`, false, connectorRef(station, 0))!;
      syncIndustries(w);
      const d = w.economy.depotAtPiece(piece)!;
      if (role === "foundry") d.piles[CARGO.coal.index] = d.piles[CARGO.ore.index] = 20;
      const p = Progress.fresh();
      for (const t of learn) p.learned.add(t);
      updateRates(w, (r) => boostOf(p, r));
      for (let i = 0; i < ticks(60); i++) w.economy.tick();
      return w.economy.made[CARGO[role === "mine" ? "coal" : "iron"].index];
    };
    expect(run("mine", ["mines2"])).toBeGreaterThan(run("mine", []));
    expect(run("foundry", ["foundry2"])).toBeGreaterThan(run("foundry", []));
  });
});

describe("the Telegraph's wires on the map", () => {
  it("run from a signal box along the poles wired to it, two wires a span; built again only when the props change", async () => {
    const { TelegraphWires, wireParts } = await import("../render/telegraph-wires");
    const { MeshBasicMaterial } = await import("three");
    const props = new PropStore();
    props.add(TELEGRAPH_POLE, { x: 500, z: 0, heading: 0, y: 0 });
    // No box: no wires.
    expect(wireParts(props)).toHaveLength(0);
    props.add("bldg-signal-box", { x: 0, z: 0, heading: 0, y: 0 });
    props.add(TELEGRAPH_POLE, { x: 1000, z: 0, heading: 0, y: 0 });
    // A pole beyond reach of the chain: not wired.
    props.add(TELEGRAPH_POLE, { x: 5000, z: 0, heading: 0, y: 0 });
    expect(wireParts(props)).toHaveLength(4);
    const wires = new TelegraphWires(new MeshBasicMaterial());
    expect(wires.sync(props, false)).toBe(false);
    expect(wires.mesh.visible).toBe(false);
    expect(wires.sync(props, true)).toBe(true);
    expect(wires.mesh.visible).toBe(true);
    // Nothing changed: nothing done.
    expect(wires.sync(props, true)).toBe(false);
    props.add(TELEGRAPH_POLE, { x: 1500, z: 0, heading: 0, y: 0 });
    expect(wires.sync(props, true)).toBe(true);
    expect(wireParts(props)).toHaveLength(6);
  });
});
