import { describe, expect, it } from "vitest";
import { Economy } from "../economy";
import { checkPlacement, FEAT_NONE, FEAT_SECRET, frameOf, frameToWorld, inSecretFootprint, type SecretSite } from "../landscape";
import { HALT_Z } from "../catalogue/secret-frame";
import { deserializeWorld, serializeWorld } from "../persist/save";
import { Sim, SIM_HZ, type CarKind } from "../sim";
import { appendPiece, connectorRef, getPieceDef, Layout, pieceOfRef, secretKitOf, type PieceTypeId } from "../track";
import { attachPassengers, LOOKOUT_FARE } from "./passengers";
import { Progress } from "./progress";
import { findSecret, haltPieceOf, noteTrip, secretOfStop, secretsReached, TOURIST_COUNT } from "./secrets";
import { STICKERS } from "./stickers";
import { createWorld, fixedPieces, STATION_CRANE_AT, syncIndustries, type World } from "./world";

/** A map whose start has a secret (seed 101: the castle), and that secret. */
function mapWithSecret(): { w: World; site: SecretSite } {
  const w = createWorld(101);
  const site = w.landscape.secrets![0];
  expect(site).toBeDefined();
  return { w, site };
}

/** A straight of the player's ending at `x, z` (its peg end), heading `heading` toward it. */
function straightTo(w: World, x: number, z: number, heading: number): number {
  return w.layout.addPiece("straight-216", { x: x - 216 * Math.cos(heading), z: z - 216 * Math.sin(heading), heading }, 0);
}

describe("secrets: found by laying track to them", () => {
  it("track far off doesn't find it; a line up to its halt's end does, and its halt is laid there, joined", () => {
    const { w, site } = mapWithSecret();
    expect(secretsReached(w)).toEqual([]);
    // A straight 4 squares short of its halt, along its line: not yet.
    const out = site.piece.heading + Math.PI;
    const far = straightTo(w, site.piece.x + Math.cos(out) * 300, site.piece.z + Math.sin(out) * 300, site.piece.heading);
    expect(secretsReached(w)).toEqual([]);
    w.layout.removePiece(far);
    // Up to its halt's open end: found.
    const line = straightTo(w, site.piece.x, site.piece.z, site.piece.heading);
    expect(secretsReached(w)).toEqual([site]);
    const halt = findSecret(w, site);
    expect(site.found).toBe(true);
    expect(w.layout.getPiece(halt)!.type).toBe(secretKitOf(site.kind));
    expect(haltPieceOf(w.layout, site)).toBe(halt);
    // Joined to the line at its open end, a buffer on its far end.
    expect(w.layout.joinedConnector(connectorRef(halt, 0))).toBe(connectorRef(line, 1));
    const after = w.layout.joinedConnector(connectorRef(halt, 1));
    expect(after).not.toBe(-1);
    expect(w.layout.getPiece(pieceOfRef(after))!.type).toBe("buffer");
    // Found once: not again; and the halt's fixed, as a station is.
    expect(secretsReached(w)).toEqual([]);
    expect(fixedPieces(w).has(halt)).toBe(true);
    // A stop of riders from any town, as the lookout is.
    syncIndustries(w, true);
    const d = w.economy.depotAtPiece(halt)!;
    expect(d.role).toBe("town");
    expect(w.economy.isLookout(d)).toBe(true);
    expect(secretOfStop(w, d)).toBe(site);
  });

  it("a track piece beside its body finds it too; its body keeps track off, its halt's bed only till it's found", () => {
    const { w, site } = mapWithSecret();
    const f = frameOf(site.piece);
    const g = w.landscape;
    // On its body: refused, saying something's hidden there.
    const body = frameToWorld(f, 0, 0);
    const across = checkPlacement(g, "straight-216", false, { x: body.x - 108, z: body.z, heading: 0 }, 0);
    expect(across).toMatchObject({ kind: "blocked", reason: "secret" });
    // Its halt's bed: kept till it's found.
    const bed = frameToWorld(f, 0, HALT_Z);
    expect(inSecretFootprint(g, site.id, bed.x, bed.z)).toBe(true);
    // A straight laid along the far side of its body, a square out: found.
    const beside = frameToWorld(f, -108, -176 - 40);
    w.layout.addPiece("straight-216", { x: beside.x, z: beside.z, heading: f.heading }, 0);
    expect(secretsReached(w)).toEqual([site]);
    findSecret(w, site);
    expect(inSecretFootprint(g, site.id, bed.x, bed.z)).toBe(false);
    expect(inSecretFootprint(g, site.id, body.x, body.z)).toBe(true);
  });

  it("found stays found, its halt and its trips kept through a save", () => {
    const { w, site } = mapWithSecret();
    straightTo(w, site.piece.x, site.piece.z, site.piece.heading);
    findSecret(w, site);
    site.trips = 7;
    site.fares = 56;
    site.from = { 0: 5, 1: 2 };
    site.year = [2001, 3];
    const back = deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(w))));
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    const again = back.value.landscape.secrets![site.id];
    expect(again).toMatchObject({ found: true, trips: 7, fares: 56, from: { 0: 5, 1: 2 }, year: [2001, 3] });
    expect(haltPieceOf(back.value.layout, again)).toBeDefined();
    expect(back.value.landscape.secretPlan).toEqual(w.landscape.secretPlan);
  });

  it("an older save (no secrets) loads, and plans its secrets on land it hasn't bought", () => {
    const w = createWorld(101);
    // (Its squares as they were before: the start's secret not there.)
    const g = w.landscape.grid;
    g.forEachCell((i) => {
      if (g.feature[i] !== FEAT_SECRET) return;
      g.feature[i] = FEAT_NONE;
      g.owner[i] = -1;
    });
    const data = JSON.parse(JSON.stringify(serializeWorld(w)));
    delete data.landscape.secretPlan;
    delete data.landscape.secrets;
    const back = deserializeWorld(data);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    const land = back.value.landscape;
    expect(land.secretPlan!.filter((p) => !p.alt)).toHaveLength(6);
    for (const p of land.secretPlan!) expect(land.grid.hasPlot(p.px, p.pz)).toBe(false);
  });
});

// ---- tourist trips ----

/** Lay `type` on free end `ref` (seated by an end of the other kind); returns its id. */
function lay(layout: Layout, ref: number, type: PieceTypeId): number {
  const end = layout.worldConnector(ref, { x: 0, z: 0, heading: 0, y: 0, kind: "peg" });
  const via = getPieceDef(type, false).connectors.findIndex((c) => c.kind !== end.kind);
  return appendPiece(layout, type, false, ref, via);
}
const otherEnd = (layout: Layout, id: number) => [0, 1].map((k) => connectorRef(id, k)).find((r) => layout.joinedConnector(r) === -1)!;

/** Town A's station, a straight, a found castle's halt and its buffer: a train of `cars` on the straight. */
function line(cars: CarKind[] = ["engine", "passenger"]) {
  const layout = new Layout();
  const a = layout.addPiece("station", { x: 0, z: 0, heading: 0 });
  const back = lay(layout, connectorRef(a, 0), "adapter-peg");
  lay(layout, otherEnd(layout, back), "buffer-turnback");
  const s0 = lay(layout, connectorRef(a, 1), "straight-216");
  const s1 = lay(layout, otherEnd(layout, s0), "straight-216");
  const halt = lay(layout, otherEnd(layout, s1), secretKitOf("castle"));
  lay(layout, otherEnd(layout, halt), "buffer");
  const sim = new Sim(layout);
  const placed = sim.addTrain(cars, { pieceId: s0, pathIndex: 0, reversed: false, s: 150 });
  if (placed.kind !== "placed") throw new Error("no room");
  const economy = new Economy(layout, sim);
  const A = economy.addDepot("town", a, 0, STATION_CRANE_AT);
  const H = economy.addDepot("town", halt, 0);
  const site: SecretSite = { id: 0, kind: "castle", piece: { ...layout.getPiece(halt)!.pose }, plot: { px: 0, pz: 0 }, found: true };
  const w = { layout, sim, economy, stations: new Map([[0, a]]), landscape: { towns: [{ id: 0, name: "Larkfield", centre: { x: 0, z: 0 } }], secrets: [site] } } as unknown as World;
  const train = () => sim.getTrain(sim.trainIds()[0])!;
  const car = (kind: CarKind) => train().cars.find((c) => c.kind === kind)!;
  const run = (seconds: number) => {
    for (let i = 0; i < seconds * SIM_HZ; i++) {
      sim.tick();
      economy.tick();
    }
  };
  return { w, sim, economy, A, H, site, car, run };
}

describe("secrets: tourist trips", () => {
  it("riders get off at a found secret's halt, pay twice the fare, and each is a tourist trip, counted on it and in all", () => {
    const { w, sim, economy, A, H, site, car, run } = line();
    const p = Progress.fresh();
    const paid: number[] = [];
    attachPassengers(w, () => p, (fare, _from, to) => void (to === H && paid.push(fare)), () => 5, () => 2003);
    A.waiting = 3;
    const coach = car("passenger").id;
    // Back to A: three get on; then out to the halt, where they all get off.
    sim.setLever(car("engine").id, -1);
    run(12);
    expect(economy.ridersOf(coach).count).toBe(3);
    run(20);
    expect(p.riders).toBe(3);
    expect(paid).toHaveLength(3);
    const plain = paid[0] / LOOKOUT_FARE;
    expect(Number.isInteger(plain) && plain >= 1).toBe(true);
    expect(site).toMatchObject({ trips: 3, fares: paid.reduce((a, b) => a + b, 0), from: { 0: 3 }, year: [2003, 3] });
    expect(p.counts.get(TOURIST_COUNT)).toBe(3);
  });

  it("a trip is counted only at a secret's halt; a new year starts its year's count again", () => {
    const { w, A, H, site } = line();
    const p = Progress.fresh();
    expect(noteTrip(w, p, H, A, 4, 2001)).toBeUndefined();
    expect(p.counts.get(TOURIST_COUNT)).toBeUndefined();
    noteTrip(w, p, A, H, 4, 2001);
    noteTrip(w, p, A, H, 4, 2001);
    noteTrip(w, p, A, H, 4, 2002);
    expect(site).toMatchObject({ trips: 3, fares: 12, year: [2002, 1] });
  });

  it("the Exploring stickers come at 25, 100 and 250 tourist trips", () => {
    const { w } = line();
    const ids = ["day-tripper", "tour-guide", "grand-tourist"];
    const at = (n: number) => ids.filter((id) => STICKERS.find((s) => s.id === id)!.check(w, { coins: 0, counts: new Map([[TOURIST_COUNT, n]]), learned: new Set(), goalsDone: () => false }));
    expect(at(24)).toEqual([]);
    expect(at(25)).toEqual(["day-tripper"]);
    expect(at(99)).toEqual(["day-tripper"]);
    expect(at(100)).toEqual(["day-tripper", "tour-guide"]);
    expect(at(250)).toEqual(ids);
  });
});
