import { describe, expect, it } from "vitest";
import { CARGO, type CargoKind } from "../economy/cargo";
import { RECIPES } from "../economy/economy";
import { Editor } from "../editor/editor";
import { deserializeWorld, serializeWorld } from "../persist/save";
import { SIM_HZ } from "../sim";
import { GOALS, GoalTracker } from "./goals";
import { amountText, FARM_FIELD_FAR, FARM_NO_FIELD, resourceAt, siteWhy, updateRates } from "./industries";
import { restorePrice, ruinCard } from "./map-sites";
import { Progress } from "./progress";
import { clearRuinEdit, gamePayment, goodsGoTo, nearestRuin, restoredText, restoreRuin, restoreWhy, RUIN_NO_WAY, trackCanReach } from "./restore";
import { buildStarterWorld, createWorld, fixedPieces, plotsForSale, syncIndustries, unlockPlot, type World } from "./world";

/**
 * QA (a phone, github.io): "I also unlocked this ruin but it didn't seem to do much?", the goal still "Open a farm".
 * A farm restored the way the game does it: by the editor, whose change hook syncs the industries and checks the goals
 * (main.ts `onChange`: `industriesChanged`, then `checkGoals`), with every goal before "Open a farm" done.
 */
function play(w: World) {
  const before = GOALS.slice(0, GOALS.findIndex((g) => g.id === "open-farm")).map((g) => g.id);
  const goals = new GoalTracker(before);
  const p = Progress.fresh();
  p.learned.add("farming");
  p.coins = 200;
  const ticked: string[] = [];
  const ctx = () => ({ learned: p.learned, owned: p.owned, orders: p.orders });
  const check = () => ticked.push(...goals.update(w, ctx()).map((g) => g.id));
  const fixed = fixedPieces(w);
  const editor = new Editor(w.layout, w.sim, () => {
    syncIndustries(w, true);
    check();
  }, (id) => fixed.has(id));
  // A workshop out of the way with the planks, as the player's.
  const shop = w.layout.addPiece("depot-workshop", { x: -40000, z: -40000, heading: 0 });
  syncIndustries(w, true);
  w.economy.depotAtPiece(shop)!.piles[CARGO.planks.index] = 20;
  check();
  return { goals, p, editor, ticked, check };
}

function restoreFarm(w: World) {
  const g = play(w);
  expect(g.goals.current()?.id).toBe("open-farm");
  const site = nearestRuin(w.landscape, "farm", w.landscape.towns.map((t) => t.station))!;
  expect(site).not.toBeNull();
  expect(restoreWhy(w, site.id, { pay: gamePayment(w, g.p, "farm") })).toBeNull();
  const done = restoreRuin(w, g.editor, site.id, { pay: gamePayment(w, g.p, "farm") });
  if (!("pieceId" in done)) throw new Error(done.why);
  return { ...g, site, pieceId: done.pieceId };
}

describe("restoring an old farm ticks Open a farm (QA: it didn't seem to do much)", { timeout: 30_000 }, () => {
  const maps: [string, () => World][] = [
    ["the starter map", () => buildStarterWorld()],
    [
      "a generated Game map (seed 7, a ring of plots bought)",
      () => {
        const w = createWorld(7, true);
        for (const q of plotsForSale(w.landscape)) unlockPlot(w, q.px, q.pz);
        return w;
      },
    ],
  ];
  for (const [name, make] of maps) {
    it(`${name}: a farm depot stands, the goal ticks on the edit, and both hold over a save and load`, () => {
      const w = make();
      const { goals, ticked, pieceId, site, check } = restoreFarm(w);
      // (a) A depot of role farm on the restored piece: what hasIndustry looks for.
      expect(w.layout.getPiece(pieceId)?.type).toBe("depot-farm");
      expect(w.economy.allDepots().some((d) => d.role === "farm" && d.pieceId === pieceId)).toBe(true);
      expect(GOALS.find((x) => x.id === "open-farm")!.check(w, { learned: new Set(["farming"]) }).done).toBe(true);
      // (b) Ticked by the edit itself, as the game's change hook does.
      expect(ticked).toContain("open-farm");
      expect(goals.isDone("open-farm")).toBe(true);
      expect(goals.current()?.id).not.toBe("open-farm");
      // (c) Saved and loaded: the farm and its depot back, the goal kept (goals are saved by id).
      const r = deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(w))));
      if (!r.ok) throw new Error(r.error);
      const back = r.value;
      expect(back.landscape.sites![site.id]).toMatchObject({ cleared: true, restored: true });
      syncIndustries(back, true);
      expect(GOALS.find((x) => x.id === "open-farm")!.check(back, { learned: new Set(["farming"]) }).done).toBe(true);
      const again = new GoalTracker(goals.ids());
      expect(again.isDone("open-farm")).toBe(true);
      check();
    });
  }

  it("an old farm not yet restored (only learned, or its card opened) doesn't tick it: no farm depot", () => {
    const w = buildStarterWorld();
    const { goals, ticked } = play(w);
    expect(ticked).not.toContain("open-farm");
    expect(goals.current()?.id).toBe("open-farm");
    expect(w.economy.allDepots().some((d) => d.role === "farm")).toBe(false);
  });
});

/** A generated Game map with a ring of plots bought round its start. */
function boughtRing(seed: number): World {
  const w = createWorld(seed, true);
  for (const q of plotsForSale(w.landscape)) unlockPlot(w, q.px, q.pz);
  return w;
}

/** A minute of the economy (no trains: what the industry makes by itself piles up in its yard). */
const aMinute = (w: World) => {
  for (let t = 0; t < SIM_HZ * 60; t++) w.economy.tick();
};

describe("a restored old industry works (QA: \"that old farm isn't really a farm\")", { timeout: 30_000 }, () => {
  it("each kind restored, paid for, is its kind's industry with all the resource it wants, and makes goods (a harbour: takes them)", () => {
    const seen = new Set<string>();
    for (const seed of [7, 1, 2]) {
      const w = boughtRing(seed);
      for (const s of w.landscape.sites ?? []) {
        if (s.cleared || seen.has(s.role)) continue;
        const p = Progress.fresh();
        p.coins = 1000;
        const shop = w.layout.addPiece("depot-workshop", { x: -40000 - seen.size * 1000, z: -40000, heading: 0 });
        syncIndustries(w, true);
        // (Its price's goods in the workshop's yard: planks, and a harbour's stone.)
        for (const [k, n] of Object.entries(restorePrice(s.role).goods)) w.economy.depotAtPiece(shop)!.piles[CARGO[k as CargoKind].index] = n!;
        const fixed = fixedPieces(w);
        const editor = new Editor(w.layout, w.sim, () => syncIndustries(w, true), (id) => fixed.has(id));
        const done = restoreRuin(w, editor, s.id, { pay: gamePayment(w, p, s.role) });
        if (!("pieceId" in done)) throw new Error(`seed ${seed} ${s.role}: ${done.why}`);
        updateRates(w);
        const piece = w.layout.getPiece(done.pieceId)!;
        const d = w.economy.depotAtPiece(done.pieceId)!;
        expect(piece.type, s.role).toBe(`depot-${s.role}`);
        expect(d.role, s.role).toBe(s.role);
        const r = resourceAt(w.landscape, s.role, piece.pose)!;
        expect(r.count, `${s.role}: ${r.count} of ${r.need}`).toBeGreaterThanOrEqual(r.need);
        expect(d.rate, s.role).toBeGreaterThanOrEqual(1);
        aMinute(w);
        if (s.role === "harbour") expect(RECIPES.harbour.takes.length).toBeGreaterThan(0);
        else for (const k of RECIPES[s.role].gives) expect(d.piles[CARGO[k].index], `${s.role} ${k}`).toBeGreaterThan(0);
        seen.add(s.role);
      }
    }
    expect([...seen].sort()).toEqual(["farm", "harbour", "mine", "quarry"]);
  });

  it("the starter map's old farm: its two fields are all it wants (2 of 2, 8 of 8 squares), restored it makes grain", () => {
    const w = buildStarterWorld();
    const { pieceId } = restoreFarm(w);
    updateRates(w);
    const piece = w.layout.getPiece(pieceId)!;
    const r = resourceAt(w.landscape, "farm", piece.pose)!;
    expect(r).toMatchObject({ count: 8, need: 8 });
    expect(amountText(r.rule, r.count)).toBe("2");
    expect(w.economy.depotAtPiece(pieceId)!.rate).toBe(1);
    aMinute(w);
    expect(w.economy.depotAtPiece(pieceId)!.piles[CARGO.grain.index]).toBeGreaterThan(0);
  });

  it("a new farm yard placed by the old farm's fields (the ruin cleared away) has them all and makes grain", () => {
    const w = buildStarterWorld();
    const site = w.landscape.sites!.find((s) => s.role === "farm")!;
    const fixed = fixedPieces(w);
    const editor = new Editor(w.layout, w.sim, () => syncIndustries(w, true), (id) => fixed.has(id));
    expect("slots" in clearRuinEdit(w, editor, site.id)).toBe(true);
    expect(siteWhy(w.landscape, "depot-farm", site.piece)).toBeNull();
    const id = w.layout.addPiece("depot-farm", site.piece);
    syncIndustries(w, true);
    updateRates(w);
    expect(resourceAt(w.landscape, "farm", site.piece)).toMatchObject({ count: 8, need: 8 });
    aMinute(w);
    expect(w.economy.depotAtPiece(id)!.piles[CARGO.grain.index]).toBeGreaterThan(0);
  });

  it("a farm yard short of fields says so in fields, not squares (QA: \"it needs four but I only have those two\")", () => {
    const w = buildStarterWorld();
    const site = w.landscape.sites!.find((s) => s.role === "farm")!;
    // Beside the ruin, along its track: the old farm's two fields only partly in reach.
    const c = Math.cos(site.piece.heading);
    const s = Math.sin(site.piece.heading);
    const msgs = new Set<string>();
    for (const t of [-432, -360, 360, 432]) {
      const why = siteWhy(w.landscape, "depot-farm", { x: site.piece.x + c * t, z: site.piece.z + s * t, heading: site.piece.heading });
      if (why) msgs.add(why);
    }
    expect(msgs.size).toBeGreaterThan(0);
    for (const m of msgs) expect([FARM_NO_FIELD, FARM_FIELD_FAR]).toContain(m);
    expect(ruinCard(w.landscape, site, "game", () => true).resource).toBe("🌾 Farm fields nearby: 2 of 2");
  });
});

describe("restoring says what it's for", () => {
  it("what it makes, to lay track to its siding, and where its goods go, from the recipes", () => {
    expect(restoredText("farm")).toBe("The farm is working! It grows grain. Lay track to its siding and a train will take it to the mill.");
    expect(restoredText("quarry")).toBe("The quarry is working! It cuts stone. Lay track to its siding and a train will take it to a town.");
    expect(restoredText("mine")).toBe("The mine is working! It digs up coal and ore. Lay track to its siding and a train will take them to the foundry or the power station.");
    expect(restoredText("harbour")).toBe("The harbour is working! Lay track to its siding and bring it goods by train. Boats take them away.");
    expect(goodsGoTo("grain")).toEqual(["the mill"]);
  });

  it("a ruin's card says when track can't reach it from the line: the starter farm can be; walled in by a terrace, it can't", () => {
    const w = buildStarterWorld();
    const site = w.landscape.sites!.find((s) => s.role === "farm")!;
    expect(trackCanReach(w, site.id)).toBe(true);
    // A terrace 3 blocks up all round it, 6 squares out (too steep for track to climb).
    const g = w.landscape.grid;
    const col = g.colAt(site.centre.x);
    const row = g.rowAt(site.centre.z);
    g.forEachCell((i, c, r) => {
      const d = Math.max(Math.abs(c - col), Math.abs(r - row));
      if (d >= 6 && d <= 7) g.height[i] = 3;
    });
    expect(trackCanReach(w, site.id)).toBe(false);
    expect(RUIN_NO_WAY).toMatch(/can't reach/);
  });
});
