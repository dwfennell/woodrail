import { describe, expect, it } from "vitest";
import { CARGO } from "../economy/cargo";
import { Editor } from "../editor/editor";
import { FEAT_BUILDING, FEAT_RUIN, siteSquares } from "../landscape";
import { deserializeWorld, serializeWorld } from "../persist/save";
import { connectorRef } from "../track";
import { workshopStock } from "./crafting";
import { GOALS, guideIndustry } from "./goals";
import { restorePrice, ruinCard } from "./map-sites";
import { Progress, inUse } from "./progress";
import { gamePayment, nearestRuin, RESTORE_NO_WORKSHOP, restoreRuin, restoreWhy, ruinName } from "./restore";
import { buildStarterWorld, fixedPieces, syncIndustries, type World } from "./world";

/** The starter map, an editor on it as the game has one, and its old farm. */
function setup(): { w: World; editor: Editor; farm: NonNullable<World["landscape"]["sites"]>[number]; stub: number } {
  const w = buildStarterWorld();
  const fixed = fixedPieces(w);
  const editor = new Editor(w.layout, w.sim, () => {}, (id) => fixed.has(id));
  const farm = w.landscape.sites!.find((s) => s.role === "farm")!;
  return { w, editor, farm, stub: w.ruins.get(farm.id)! };
}

/** A workshop out of the way (its yard holding `planks`), and a player with `coins` and Farming learned. */
function shop(w: World, planks: number, coins: number): Progress {
  const id = w.layout.addPiece("depot-workshop", { x: -20000, z: -20000, heading: 0 });
  syncIndustries(w);
  w.economy.depotAtPiece(id)!.piles[CARGO.planks.index] = planks;
  const p = Progress.fresh();
  p.learned.add("farming");
  p.coins = coins;
  return p;
}

const ruinSquares = (w: World, siteId: number) => {
  const g = w.landscape.grid;
  let n = 0;
  g.forEachCell((i) => (n += g.feature[i] === FEAT_RUIN && g.owner[i] === siteId ? 1 : 0));
  return n;
};

describe("restoring a ruin: its price", () => {
  it("about half a new industry's (goods rounded up, coins to 5)", () => {
    expect(restorePrice("farm")).toEqual({ goods: { planks: 3 }, coins: 45 });
    expect(restorePrice("quarry")).toEqual({ goods: { planks: 4 }, coins: 90 });
    expect(restorePrice("mine")).toEqual({ goods: { planks: 5 }, coins: 155 });
    expect(restorePrice("harbour")).toEqual({ goods: { planks: 8, stone: 5 }, coins: 240 });
  });
});

describe("restoring a ruin: the swap", () => {
  it("turns its stub into the farm yard in place (joints kept), paid from the workshop's yard and coins, as one undo step", () => {
    const { w, editor, farm, stub } = setup();
    const p = shop(w, 10, 100);
    // Track joined to the stub's end stays joined to the farm yard.
    const pose = w.layout.getPiece(stub)!.pose;
    const end = w.layout.addPiece("straight-216", { x: pose.x - 216 * Math.cos(pose.heading), z: pose.z - 216 * Math.sin(pose.heading), heading: pose.heading });
    expect(w.layout.joinedConnector(connectorRef(end, 1))).not.toBe(-1);
    const squares = ruinSquares(w, farm.id);
    expect(squares).toBeGreaterThan(0);
    let changed = 0;
    const done = restoreRuin(w, editor, farm.id, { pay: gamePayment(w, p, "farm"), changed: () => changed++ });
    if (!("pieceId" in done)) throw new Error(done.why);
    const piece = w.layout.getPiece(done.pieceId)!;
    expect(piece.type).toBe("depot-farm");
    expect(piece.pose).toEqual(pose);
    expect(w.layout.getPiece(stub)).toBeUndefined();
    expect(w.layout.joinedConnector(connectorRef(end, 1))).toBe(connectorRef(done.pieceId, 0));
    // The site is restored, its ruin gone (no stub, no ruined squares), and it's paid for.
    expect(farm).toMatchObject({ cleared: true, restored: true });
    expect(w.ruins.has(farm.id)).toBe(false);
    expect(ruinSquares(w, farm.id)).toBe(0);
    expect(workshopStock(w).planks).toBe(7);
    expect(p.coins).toBe(55);
    expect(changed).toBe(1);
    // A real industry of the player's: owned (none spare in the toy box), an economy depot of its own.
    expect(p.owned.get("piece:depot-farm")).toBe(1);
    expect(inUse(w, "piece:depot-farm")).toBe(1);
    expect(p.available(w, "piece:depot-farm")).toBe(0);
    expect(syncIndustries(w)).toBe(true);
    expect(w.economy.depotAtPiece(done.pieceId)?.role).toBe("farm");
    expect(fixedPieces(w).has(done.pieceId)).toBe(false);

    // Undo: the stub (the same piece) and the ruin are back, and the price given back.
    expect(editor.undo()).toBe(true);
    expect(w.layout.getPiece(done.pieceId)).toBeUndefined();
    expect(w.layout.getPiece(stub)?.type).toBe("straight-216");
    expect(w.ruins.get(farm.id)).toBe(stub);
    expect(farm.cleared).toBeFalsy();
    expect(farm.restored).toBeFalsy();
    expect(ruinSquares(w, farm.id)).toBe(squares);
    expect(workshopStock(w).planks).toBe(10);
    expect(p.coins).toBe(100);
    expect(p.owned.get("piece:depot-farm") ?? 0).toBe(0);
    expect(w.layout.joinedConnector(connectorRef(end, 1))).toBe(connectorRef(stub, 0));

    // Redo: restored again (the same farm yard piece), paid again.
    expect(editor.redo()).toBe(true);
    expect(w.layout.getPiece(done.pieceId)?.type).toBe("depot-farm");
    expect(w.ruins.has(farm.id)).toBe(false);
    expect(p.coins).toBe(55);
    expect(workshopStock(w).planks).toBe(7);
    expect(changed).toBe(3);
  });

  it("a redo it can't pay for is refused, and said why", () => {
    const { w, editor, farm, stub } = setup();
    const p = shop(w, 3, 45);
    expect("pieceId" in restoreRuin(w, editor, farm.id, { pay: gamePayment(w, p, "farm") })).toBe(true);
    expect(p.coins).toBe(0);
    editor.undo();
    expect(p.coins).toBe(45);
    // The coins spent on something else meanwhile.
    p.coins = 20;
    const said: string[] = [];
    editor.onRefused = (why) => said.push(why);
    expect(editor.redo()).toBe(false);
    expect(said).toEqual(["Restoring needs 25🪙 more"]);
    expect(w.layout.getPiece(stub)?.type).toBe("straight-216");
    expect(p.coins).toBe(20);
    expect(editor.canRedo).toBe(true);
  });

  it("is saved: restored, the farm yard a player's industry; loaded again, no ruin comes back", () => {
    const { w, editor, farm } = setup();
    const p = shop(w, 10, 100);
    const done = restoreRuin(w, editor, farm.id, { pay: gamePayment(w, p, "farm") });
    if (!("pieceId" in done)) throw new Error(done.why);
    // (As the game does after every edit: the farm yard's depot, its grain kept with the save.)
    syncIndustries(w);
    w.economy.depotAtPiece(done.pieceId)!.piles[CARGO.grain.index] = 3;
    const r = deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(w))));
    if (!r.ok) throw new Error(r.error);
    const back = r.value;
    const site = back.landscape.sites![farm.id];
    expect(site).toMatchObject({ cleared: true, restored: true });
    expect(back.ruins.has(farm.id)).toBe(false);
    expect(ruinSquares(back, farm.id)).toBe(0);
    const farms = [...back.layout.pieceIds()].map((id) => back.layout.getPiece(id)!).filter((q) => q.type === "depot-farm");
    expect(farms.map((q) => q.pose)).toEqual([w.layout.getPiece(done.pieceId)!.pose]);
    expect(back.economy.depotAtPiece(farms[0].id)).toMatchObject({ role: "farm" });
    expect(back.economy.depotAtPiece(farms[0].id)!.piles[CARGO.grain.index]).toBe(3);
    expect(fixedPieces(back).has(farms[0].id)).toBe(false);
  });
});

describe("restoring a ruin: when it can't", () => {
  it("short of planks or coins, or no workshop: says what's missing, takes nothing", () => {
    const { w, editor, farm, stub } = setup();
    const none = Progress.fresh();
    none.coins = 100;
    expect(restoreWhy(w, farm.id, { pay: gamePayment(w, none, "farm") })).toBe(RESTORE_NO_WORKSHOP);
    const p = shop(w, 1, 30);
    expect(restoreRuin(w, editor, farm.id, { pay: gamePayment(w, p, "farm") })).toEqual({ why: "Restoring needs 2🪵 more at the workshop and 15🪙 more" });
    p.coins = 100;
    expect(restoreWhy(w, farm.id, { pay: gamePayment(w, p, "farm") })).toBe("Restoring needs 2🪵 more at the workshop");
    expect(w.layout.getPiece(stub)?.type).toBe("straight-216");
    expect(p.coins).toBe(100);
    expect(workshopStock(w).planks).toBe(1);
    expect(editor.canUndo).toBe(false);
    // Free in Sandbox (no payment).
    expect(restoreWhy(w, farm.id)).toBeNull();
  });

  it("not while a train is on its stub", () => {
    const { w, editor, farm, stub } = setup();
    expect(w.sim.addTrain(["engine"], { pieceId: stub, pathIndex: 0, reversed: false, s: 100 }).kind).toBe("placed");
    expect(restoreRuin(w, editor, farm.id)).toEqual({ why: "A train is on its track" });
    expect(farm.cleared).toBeFalsy();
  });

  it("not while its yard is blocked (something stands in it), nor once it's gone", () => {
    const { w, editor, farm } = setup();
    const g = w.landscape.grid;
    const [c, r] = siteSquares(farm.centre, farm.piece.heading).yard[4];
    const i = g.index(c, r);
    const was = [g.feature[i], g.owner[i]];
    g.feature[i] = FEAT_BUILDING;
    expect(restoreRuin(w, editor, farm.id)).toEqual({ why: "The farm yard needs open ground: a house is in the way" });
    // (The check leaves the ruin as it was.)
    expect(farm.cleared).toBeFalsy();
    g.feature[i] = was[0];
    g.owner[i] = was[1];
    expect("pieceId" in restoreRuin(w, editor, farm.id)).toBe(true);
    expect(restoreRuin(w, editor, farm.id)).toEqual({ why: "It's gone already" });
  });
});

describe("restoring a ruin: what the player is told and shown", () => {
  it("the card offers Restore with its price once Farming is learned", () => {
    const { w, farm } = setup();
    expect(ruinCard(w.landscape, farm, "game", () => false).restore).toBeNull();
    expect(ruinCard(w.landscape, farm, "game", (id) => id === "farming").restore).toBe("Restore · 3🪵 45🪙");
  });

  it("names a ruin by its nearest town", () => {
    const { w, farm } = setup();
    const towns = [...w.landscape.towns].sort((a, b) => Math.hypot(a.centre.x - farm.centre.x, a.centre.z - farm.centre.z) - Math.hypot(b.centre.x - farm.centre.x, b.centre.z - farm.centre.z));
    expect(ruinName(w.landscape, farm)).toBe(`Old farm by ${towns[0].name}`);
  });

  it("Show me for a farm points at the old farm (its card), then, once it's restored, at a spot for a new one", () => {
    const { w, editor, farm } = setup();
    expect(nearestRuin(w.landscape, "farm", [])?.id).toBe(farm.id);
    expect(nearestRuin(w.landscape, "quarry", [])).toBeNull();
    const guide = guideIndustry(w, "farm");
    expect(guide.ruin).toBe(farm.id);
    expect(guide.marks).toEqual([farm.centre]);
    expect(guide.points[0]).toEqual(farm.centre);
    const goal = GOALS.find((g) => g.id === "open-farm")!;
    expect(goal.needs).toEqual(["farming"]);
    expect(goal.guide(w).ruin).toBe(farm.id);
    expect(goal.check(w).done).toBe(false);
    // No ruin of that kind: today's spot, on the Industries tab (no line yet here, so no spot: the towns).
    expect(guideIndustry(w, "quarry")).toMatchObject({ tab: "industries", shelf: "Industries" });
    expect(guideIndustry(w, "quarry").ruin).toBeUndefined();
    restoreRuin(w, editor, farm.id);
    syncIndustries(w);
    expect(goal.check(w).done).toBe(true);
    expect(guideIndustry(w, "farm").ruin).toBeUndefined();
  });
});
