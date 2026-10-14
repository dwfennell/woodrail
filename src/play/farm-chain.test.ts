import { describe, expect, it } from "vitest";
import { Editor } from "../editor/editor";
import { siteWhy, updateRates } from "../game/industries";
import { receivedBy } from "../game/town-life";
import { townStatus } from "../game/towns";
import { buildStarterWorld, syncIndustries, type World } from "../game/world";
import { FEAT_FIELD } from "../landscape";
import { SIM_HZ } from "../sim";
import { appendPiece, connectorRef, getPieceDef, type Pose } from "../track";
import { play } from "./player";
import { endOn, layOn, rulesFor } from "./rules";

/** Places for a farm yard by a field with a mill joined on after it, where the placement rules and site rule allow. */
function* farmSites(w: World): Generator<{ farm: Pose; y: number }> {
  const g = w.landscape.grid;
  const rules = rulesFor(w);
  const fields: number[] = [];
  g.forEachCell((i) => {
    if (g.feature[i] === FEAT_FIELD) fields.push(i);
  });
  for (const f of fields) {
    for (let dc = -5; dc <= 5; dc++) {
      for (let dr = -5; dr <= 5; dr++) {
        for (const heading of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
          const x = g.centreX(g.colOf(f) + dc);
          const z = g.centreZ(g.rowOf(f) + dr);
          // The piece's track down a square's middle.
          const farm = { x: x - Math.cos(heading) * 108, z: z - Math.sin(heading) * 108, heading };
          const cell = g.cellAtWorld(x, z);
          if (cell === -1) continue;
          const y = g.groundY(cell);
          if (siteWhy(w.landscape, "depot-farm", farm) || rules("depot-farm", false, farm, y, -1)) continue;
          const id = w.layout.addPiece("depot-farm", farm, y);
          const via = getPieceDef("depot-mill", false).connectors.findIndex((c) => c.kind !== w.layout.worldConnector(connectorRef(id, 1), { x: 0, z: 0, heading: 0, y: 0, kind: "peg" }).kind);
          const mill = appendPiece(w.layout, "depot-mill", false, connectorRef(id, 1), via);
          const p = w.layout.getPiece(mill)!;
          const ok = !rules("depot-mill", false, p.pose, p.y, mill);
          w.layout.removePiece(mill);
          w.layout.removePiece(id);
          if (ok) yield { farm, y };
        }
      }
    }
  }
}

describe("the farm chain", () => {
  it("grain from a farm yard by the fields, ground at a mill, makes a town a city", () => {
    const log: string[] = [];
    const w = buildStarterWorld();
    const fixed = new Set([...w.stations.values(), ...w.depots.values()]);
    const editor = new Editor(w.layout, w.sim, () => {}, (id) => fixed.has(id));
    // 1. A farm yard by a field, the mill joined on after it; 2. track from the mill to the nearest town that can be
    // reached (a player tries another spot when the way out is blocked), turnbacks on both ends of the line.
    let farm = -1;
    let town = w.landscape.towns[0];
    let joined = false;
    let tries = 0;
    for (const site of farmSites(w)) {
      if (++tries > 30) break;
      farm = editor.place("depot-farm", site.farm, site.y, false);
      const farmEnd = connectorRef(farm, 1);
      const end = w.layout.worldConnector(farmEnd, { x: 0, z: 0, heading: 0, y: 0, kind: "peg" });
      const via = getPieceDef("depot-mill", false).connectors.findIndex((c) => c.kind !== end.kind);
      const tmp = appendPiece(w.layout, "depot-mill", false, farmEnd, via);
      const mp = w.layout.getPiece(tmp)!;
      w.layout.removePiece(tmp);
      const mill = editor.place("depot-mill", mp.pose, mp.y, false);
      const millFree = [0, 1].map((k) => connectorRef(mill, k)).find((r) => w.layout.joinedConnector(r) === -1)!;
      const millAt = w.layout.worldConnector(millFree, { x: 0, z: 0, heading: 0, y: 0, kind: "peg" });
      const towns = [...w.landscape.towns].sort((a, b) => Math.hypot(a.centre.x - millAt.x, a.centre.z - millAt.z) - Math.hypot(b.centre.x - millAt.x, b.centre.z - millAt.z));
      for (const t of towns.slice(0, 2)) {
        const station = w.stations.get(t.id)!;
        const near = [0, 1].map((k) => connectorRef(station, k)).sort((a, b) => {
          const ea = w.layout.worldConnector(a, { x: 0, z: 0, heading: 0, y: 0, kind: "peg" });
          const eb = w.layout.worldConnector(b, { x: 0, z: 0, heading: 0, y: 0, kind: "peg" });
          return Math.hypot(ea.x - millAt.x, ea.z - millAt.z) - Math.hypot(eb.x - millAt.x, eb.z - millAt.z);
        });
        const had = new Set(w.layout.pieceIds());
        const r = play(w.layout, editor, millFree, near[0], { blocked: rulesFor(w), maxPieces: 80, fiddle: 3 });
        if (r.ok) {
          log.push(`farm yard try ${tries}: mill → ${t.name} joined, ${r.pieces} pieces`);
          town = t;
          joined = true;
          endOn(w, editor, near[1]);
          break;
        }
        for (const id of [...w.layout.pieceIds()]) if (!had.has(id)) editor.remove(id);
      }
      if (joined) break;
      editor.remove(mill);
      editor.remove(farm);
    }
    syncIndustries(w);
    updateRates(w);
    log.push(`farm yard rate ${w.economy.depotAtPiece(farm)?.rate.toFixed(2)}`);
    expect(joined, log.join("\n")).toBe(true);
    // Room past the farm yard (a train turns back at the end of the line: its wagons must reach the crane first), and
    // a turnback there if it fits.
    let tail = connectorRef(farm, 0);
    for (let k = 0; k < 2; k++) {
      const more = layOn(w, editor, tail, "straight-216");
      if ("why" in more) break;
      tail = more.next;
    }
    const back = endOn(w, editor, tail);
    log.push(`turnback at the farm yard: ${"why" in back ? `none (${back.why})` : "laid"}`);
    // The town has had its planks up to a town (planks are the starter line's job); it wants flour to be a city.
    w.economy.delivered.set(town.id, 4 + 8 + 14);
    expect(townStatus(receivedBy(w, town.id))).toMatchObject({ level: 2, wants: { flour: 6 } });
    // 3. A train: an engine, a hopper for the grain and a van for the flour, set going toward the farm.
    const on = [...w.layout.pieceIds()].find((id) => !fixed.has(id) && w.layout.getPiece(id)!.type.startsWith("straight"))!;
    const placed = w.sim.addTrain(["engine", "hopper", "van"], { pieceId: on, pathIndex: 0, reversed: false, s: 10 });
    expect(placed.kind).toBe("placed");
    if (placed.kind !== "placed") return;
    w.sim.setLever(w.sim.getTrain(placed.trainId)!.cars[0].id, 1);
    // 4. Run until the town is a city.
    let city = -1;
    for (let tick = 0; tick < 30 * 60 * SIM_HZ && city < 0; tick++) {
      w.sim.tick();
      w.economy.tick();
      if (tick % (SIM_HZ * 10) === 0 && townStatus(receivedBy(w, town.id)).level >= 3) city = tick / SIM_HZ / 60;
    }
    log.push(`${town.name}: flour delivered ${w.economy.deliveredGoods.get(town.id)?.flour ?? 0}; city at ${city < 0 ? "never" : `${city.toFixed(1)} min`}`);
    console.log(`farm chain:\n${log.join("\n")}`);
    expect(city, log.join("\n")).toBeGreaterThan(0);
  }, 300_000);
});
