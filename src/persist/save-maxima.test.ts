/**
 * A Game world at the most the game lets anything be, built by the game's own rules, saved and loaded back: it must
 * read without a number brought down to a limit (2026-11-23: a warehouse stacked by Lift and load, 72 planks, turned
 * away a whole game). Every bound and what the game reaches there: save-limits.test.ts.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildStarterWorld, INDUSTRY_ROLE, syncIndustries, type World } from "../game/world";
import { appendPiece, connectorRef, type PieceTypeId } from "../track";
import { capAt, CARGO, CARGO_KINDS, loungeCap, MAX_SHEDS, pilesOf, RECIPES, type CargoKind } from "../economy";
import { MAX_ENGINE_NAME } from "../sim";
import { applyCranes } from "../game/upgrades";
import { Progress } from "../game/progress";
import { TECHS } from "../game/tech";
import { SEATS, waitingCap } from "../game/passengers";
import { VISITORS_CAP } from "../game/airports";
import { Fleet, MAX_BARGES, MAX_BOATS } from "../game/boats";
import { createLine, LINE_NAME_MAX, MAX_VIAS, renameLine } from "../game/lines";
import { MOST_STOREYS } from "../props/storeys";
import { Journal, JOURNAL_CAP } from "../game/journal";
import { deserializeWorld, serializeWorld, type SaveData } from "./save";
import { saveSchema, sessionSchema } from "./save-schema";

afterEach(() => vi.restoreAllMocks());

function learnedAll(): Progress {
  const p = new Progress();
  for (const t of TECHS) p.learned.add(t.id);
  return p;
}

/** A line of `n` straights off the first town's station. */
function line(world: World, n: number): number[] {
  let last = world.stations.get(world.landscape.towns[0].id)!;
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push((last = appendPiece(world.layout, "straight-216", false, connectorRef(last, 1))));
  return out;
}

/**
 * The starter map with everything learned and every count the game keeps at its most: every kind of depot (its piece
 * laid on a line, its depot made by `syncIndustries`, as the game does; not dragged from the tray), every
 * pile filled to its cap (`capAt`, stacked by Lift and load, a harbour with all its sheds), the most people waiting,
 * flying and riding, heavy wagons full, the most boats and barges, full, long names, a long train, a long line.
 */
function worldAtMaxima(): { world: World; progress: Progress } {
  const world = buildStarterWorld(true);
  const progress = learnedAll();
  const e = world.economy;
  // Research as the game applies it: heavy wagons (the Smithy), Lift and load.
  applyCranes(e, progress);
  const track = line(world, 600);
  // Every industry's piece and the water kits, laid on at the line's end; their depots made as the game makes them.
  let last = track[track.length - 1];
  for (const type of [...Object.keys(INDUSTRY_ROLE), "kit-landing", "kit-boatyard", "kit-shipyard", "kit-ferry-slip"] as PieceTypeId[]) {
    last = appendPiece(world.layout, type, false, connectorRef(last, 1));
    last = appendPiece(world.layout, "straight-216", false, connectorRef(last, 1));
  }
  syncIndustries(world, true);
  for (const d of e.allDepots()) {
    // Dock sheds, bought one at a time on a harbour's card (main.ts) to `MAX_SHEDS`.
    if (d.role === "harbour") while (d.sheds < MAX_SHEDS) d.sheds++;
    // Every pile to the most it holds (harness shortcut: the cap is the game's own; filling by trains isn't tested).
    for (const k of pilesOf(d.role)) d.piles[CARGO[k].index] = capAt(d);
    if (d.role === "workshop") for (const k of CARGO_KINDS) e.setKeep(d.id, k, Number.MAX_SAFE_INTEGER);
    if (d.role === "town") d.waiting = waitingCap(progress);
    if (d.role === "airport") d.waiting = VISITORS_CAP;
    d.flyers = loungeCap(d);
  }
  // A harbour's quay: its bought goods landed on full piles.
  const harbour = e.allDepots().find((d) => d.role === "harbour")!;
  for (const k of pilesOf("harbour")) {
    harbour.piles[CARGO[k].index] = 0;
    e.land(harbour, k, capAt(harbour));
  }
  // The most boats, each with the most barges, loaded at a landing by the game's own rule (`Fleet.serve`).
  const fleet = new Fleet(() => world);
  const landing = e.allDepots().find((d) => d.role === "landing")!;
  for (let i = 0; i < MAX_BOATS + 2; i++) fleet.launch(landing.id);
  for (const b of fleet.all()) {
    while (b.barges < MAX_BARGES) b.barges++;
    for (const k of pilesOf("landing")) landing.piles[CARGO[k].index] = capAt(landing);
    fleet.serve(b, { depotId: landing.id, action: "pick" });
  }
  // A long train: an engine, a coach of each look with every seat taken, and wagons as full as they're let be.
  const coaches = Object.keys(SEATS) as (keyof typeof SEATS)[];
  const kinds = ["engine", ...coaches.map(() => "passenger" as const), ...Array.from({ length: 40 }, () => "hopper" as const), "caboose"] as const;
  const placed = world.sim.addTrain(kinds, { pieceId: track[300], pathIndex: 0, reversed: false, s: 100 });
  if (placed.kind !== "placed") throw new Error(`no room for the train: ${JSON.stringify(placed)}`);
  const train = world.sim.getTrain(placed.trainId)!;
  // The longest name a plate takes, in letters that are two UTF-16 units each.
  expect(world.sim.setName(train.cars[0].id, "🚂".repeat(MAX_ENGINE_NAME + 4))).toBe(true);
  const town = e.allDepots().find((d) => d.role === "town")!;
  train.cars.forEach((c, i) => {
    if (c.kind === "passenger") {
      const look = coaches[i - 1];
      world.sim.setLook(c.id, look);
      e.setRiders(c.id, SEATS[look]!, town.id);
    }
    if (c.kind === "hopper") e.setCargo(c.id, "coal" as CargoKind, Number.MAX_SAFE_INTEGER);
  });
  // A line with a name as long as the sheet takes, its stops with the most via points.
  const l = createLine(e, [
    { depotId: town.id, action: "both", via: track.slice(10, 10 + MAX_VIAS + 3) },
    { depotId: landing.id, action: "both" },
  ]);
  renameLine(e, l.id, "L".repeat(LINE_NAME_MAX + 10));
  // Town houses with every storey they can have.
  for (const p of world.props.all()) if (p.building !== undefined) world.props.setStoreys(p.id, MOST_STOREYS);
  // Counts the game never caps: deliveries, ships built.
  e.shipsBuilt = 5000;
  e.ferriesBuilt = 5000;
  return { world, progress };
}

describe("a Game world at the game's maxima", () => {
  it("is what the guard says: piles stacked and with sheds, heavy wagons, full coaches and boats", () => {
    const { world } = worldAtMaxima();
    const e = world.economy;
    const wh = e.allDepots().find((d) => d.role === "warehouse")!;
    expect(capAt(wh)).toBeGreaterThan(40);
    expect(Math.max(...wh.piles)).toBe(capAt(wh));
    expect(capAt(e.allDepots().find((d) => d.role === "harbour")!)).toBeGreaterThan(RECIPES.harbour.cap ?? 12);
    expect(e.wagonCapacity).toBeGreaterThan(3);
    expect(e.boats.size).toBe(MAX_BOATS);
    expect([...e.boats.values()].every((b) => b.barges === MAX_BARGES && Object.values(b.load).reduce((n, v) => n + (v ?? 0), 0) > 0)).toBe(true);
  });

  it("saves and loads back as it was, nothing brought down to a limit", () => {
    const { world } = worldAtMaxima();
    const warn = vi.spyOn(console, "warn");
    const data = JSON.parse(JSON.stringify(serializeWorld(world))) as SaveData;
    // The schema itself takes it (not mended: `mendTooBig` brings numbers down only when it doesn't).
    const parsed = saveSchema.safeParse(data);
    expect(parsed.success ? "ok" : parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`)).toBe("ok");
    const r = deserializeWorld(data, { sandbox: false });
    expect(r.ok ? "ok" : r.error).toBe("ok");
    if (!r.ok) return;
    expect(warn.mock.calls.filter((c) => String(c[0]).includes("mended"))).toEqual([]);
    // And saved again, the same: every pile, load, rider, boat, name and count as it was.
    const again = JSON.parse(JSON.stringify(serializeWorld(r.value))) as SaveData;
    expect(again.depots).toEqual(data.depots);
    expect(again.trains).toEqual(data.trains);
    expect(again.boats).toEqual(data.boats);
    expect(again.lines).toEqual(data.lines);
    expect(again.props).toEqual(data.props);
    expect(again.built).toEqual(data.built);
    expect(again.pieces).toEqual(data.pieces);
    expect(again.landscape.towns).toEqual(data.landscape.towns);
    expect(again.landscape.plots).toEqual(data.landscape.plots);
    // (What was put there is what was saved: the maxima themselves.)
    expect(Math.max(...data.depots.flatMap((d) => d.piles))).toBe(Math.max(...world.economy.allDepots().map((d) => capAt(d))));
    expect(data.trains[0].cars[0].name).toBe("🚂".repeat(MAX_ENGINE_NAME));
  });

  it("its session (a full Journal, a long clock) and progress (coins and counts) round-trip too", () => {
    const j = new Journal(() => 0);
    for (let i = 0; i < JOURNAL_CAP + 20; i++) j.add({ kind: "event", text: `Delivered ${i} planks to Little Wickhampton`, key: `k${i}` });
    const session = { clock: 1e9, paused: false, journal: j.toJSON(), slot: { id: "abcdefgh", name: "Couldn't open: " + "n".repeat(40) } };
    const s = sessionSchema.safeParse(JSON.parse(JSON.stringify(session)));
    expect(s.success).toBe(true);
    const p = learnedAll();
    p.coins = 2 ** 50;
    p.counts.set("exported", 1e12);
    const back = Progress.fromJSON(JSON.parse(JSON.stringify(p.toJSON())));
    expect(back.coins).toBe(2 ** 50);
    expect(back.counts.get("exported")).toBe(1e12);
    expect([...back.learned].sort()).toEqual([...p.learned].sort());
  });
});
