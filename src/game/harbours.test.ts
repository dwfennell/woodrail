import { describe, expect, it } from "vitest";
import { capAt, capOf, CARGO, SHED_CAP } from "../economy";
import { deserializeWorld, serializeWorld } from "../persist/save";
import { isWater, SURF_RIVER, SURF_SEA } from "../landscape";
import { siteWhy } from "./industries";
import { BOAT_DOCKED, BOAT_EVERY, BOAT_LOADS, BOAT_SAIL, boatPays, depotPoint, HarbourTrade, loadBoat, QUAY, waterWay, type HarbourEvent } from "./harbours";
import { Progress } from "./progress";
import { buildStarterWorld, landForSale, plotsForSale, syncIndustries, unlockPlot, type World } from "./world";

/** The starter map with its coast plot bought. */
function coastWorld(): World {
  const w = buildStarterWorld();
  const p = plotsForSale(w.landscape).find((q) => {
    const g = landForSale(w.landscape, q.px, q.pz).grid;
    let sea = false;
    g.forEachCell((i) => {
      if (g.surface[i] === SURF_SEA) sea = true;
    });
    return sea;
  })!;
  expect(unlockPlot(w, p.px, p.pz)).not.toBeNull();
  return w;
}

/** A pose for a harbour on this land: its site rule met, its quay on the water (the sea, or a river). */
function harbourSite(w: World, water = SURF_SEA): { x: number; z: number; heading: number } {
  const g = w.landscape.grid;
  let found: { x: number; z: number; heading: number } | null = null;
  g.forEachCell((i, col, row) => {
    if (found || g.surface[i] !== water) return;
    for (const heading of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      // The quay's point on this sea square: the piece stands back from it, on the land.
      const c = Math.cos(heading);
      const s = Math.sin(heading);
      const qx = g.centreX(col);
      const qz = g.centreZ(row);
      const pose = { x: qx - c * QUAY.t + s * QUAY.l, z: qz - s * QUAY.t - c * QUAY.l, heading };
      const under = g.cellAtWorld(pose.x + c * 108, pose.z + s * 108);
      if (under === -1 || isWater(g.surface[under])) continue;
      if (siteWhy(w.landscape, "depot-harbour", pose) === null) {
        found = pose;
        return;
      }
    }
  });
  expect(found).not.toBeNull();
  return found!;
}

describe("harbours", () => {
  it("stand by water boats can reach: the way in runs over water, from out at sea to the quay", () => {
    const w = coastWorld();
    const pose = harbourSite(w);
    const way = waterWay(w.landscape, pose)!;
    expect(way.length).toBeGreaterThan(2);
    const q = depotPoint(pose, QUAY.t, QUAY.l);
    expect(way[way.length - 1]).toEqual(q);
    // Inland, nowhere near water: not a harbour.
    expect(siteWhy(w.landscape, "depot-harbour", { x: 0, z: 0, heading: 0 })).toMatch(/water/);
  });

  it("on a river, boats come up it from the edge of the land", () => {
    const w = buildStarterWorld();
    const pose = harbourSite(w, SURF_RIVER);
    const way = waterWay(w.landscape, pose)!;
    // It comes in from past the land's edge (off the grid), over river squares.
    const g = w.landscape.grid;
    expect(g.cellAtWorld(way[0].x, way[0].z)).toBe(-1);
    for (const p of way.slice(2, -2)) {
      const i = g.cellAtWorld(p.x, p.z);
      if (i !== -1) expect(isWater(g.surface[i])).toBe(true);
    }
  });

  it("a boat takes so many loads, the biggest piles first, and pays half a town's price", () => {
    const w = coastWorld();
    const id = w.layout.addPiece("depot-harbour", harbourSite(w));
    syncIndustries(w);
    const d = w.economy.depotAtPiece(id)!;
    d.piles[CARGO.planks.index] = 5;
    d.piles[CARGO.flour.index] = 2;
    d.piles[CARGO.stone.index] = 1;
    const goods = loadBoat(d);
    expect(goods).toEqual({ planks: 4, flour: 2 });
    expect(Object.values(goods).reduce((a, b) => a + (b ?? 0), 0)).toBe(BOAT_LOADS);
    expect(d.piles[CARGO.planks.index]).toBe(1);
    expect(boatPays(goods)).toBe(Math.round((4 * 4 + 2 * 6) / 2));
  });

  it("boats come by themselves: in, tied up (selling), out, and again a while later", () => {
    const w = coastWorld();
    const id = w.layout.addPiece("depot-harbour", harbourSite(w));
    syncIndustries(w);
    const d = w.economy.depotAtPiece(id)!;
    d.piles[CARGO.planks.index] = 8;
    const p = Progress.fresh();
    const trade = new HarbourTrade();
    const log: { t: number; e: HarbourEvent }[] = [];
    for (let t = 1; t <= 400; t++) for (const e of trade.update(w, p)) log.push({ t, e });
    const kinds = log.map((l) => l.e.kind);
    expect(kinds.slice(0, 4)).toEqual(["arrive", "sold", "leave", "arrive"]);
    const [arrive, sold, leave, again] = log;
    expect(sold.t - arrive.t).toBe(BOAT_SAIL);
    expect(leave.t - sold.t).toBe(BOAT_DOCKED);
    expect(again.t - leave.t).toBe(BOAT_SAIL + BOAT_EVERY);
    expect(sold.e.kind === "sold" && sold.e.goods).toEqual({ planks: 6 });
    expect(p.coins).toBe(12 + 4);
    expect(p.counts.get("exported")).toBe(8);
  });

  it("dock sheds hold more of every good for the boats, and are saved", () => {
    const w = coastWorld();
    const id = w.layout.addPiece("depot-harbour", harbourSite(w));
    syncIndustries(w);
    const d = w.economy.depotAtPiece(id)!;
    expect(capAt(d)).toBe(capOf("harbour"));
    d.sheds = 2;
    expect(capAt(d)).toBe(capOf("harbour") + 2 * SHED_CAP);
    d.piles[CARGO.planks.index] = capOf("harbour") + 5;
    const back = deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(w))));
    expect(back.ok).toBe(true);
    const e = back.ok ? back.value.economy.depotAtPiece(id)! : null;
    expect(e?.sheds).toBe(2);
    expect(e?.piles[CARGO.planks.index]).toBe(capOf("harbour") + 5);
  });

  it("a boat in at a harbour that's taken up, or moved, is gone at once (the view's told)", () => {
    for (const how of ["remove", "move"] as const) {
      const w = coastWorld();
      const pose = harbourSite(w);
      const id = w.layout.addPiece("depot-harbour", pose);
      syncIndustries(w);
      const d = w.economy.depotAtPiece(id)!;
      const p = Progress.fresh();
      const trade = new HarbourTrade();
      const log: HarbourEvent[] = [];
      // Until the boat's tied up.
      while (trade.boatAt(d.id)?.phase !== "docked") log.push(...trade.update(w, p));
      if (how === "remove") {
        w.layout.removePiece(id);
        syncIndustries(w);
      } else {
        w.layout.movePiece(id, { ...pose, x: pose.x + 40 }, 0);
      }
      const after = trade.update(w, p);
      expect(after, how).toEqual([{ kind: "gone", depotId: d.id }]);
      // Nothing more of it: no leave for a boat that's gone; a moved harbour's next boat comes later as usual.
      const more: HarbourEvent[] = [];
      for (let t = 0; t < 60; t++) more.push(...trade.update(w, p));
      expect(more.some((e) => e.kind === "leave" || e.kind === "gone")).toBe(false);
      expect(log.filter((e) => e.kind === "arrive")).toHaveLength(1);
    }
  });
});
