import { describe, expect, it } from "vitest";
import { Editor } from "../editor/editor";
import { buildStarterWorld, syncIndustries, type World } from "../game/world";
import { checkPlacement, checkSupport } from "../landscape";
import { LandEditor } from "../landscape/edit";
import { addTownProps } from "../props/towns";
import { appendPiece, connectorRef, findLowCrossing, findOverlap, getPieceDef } from "../track";
import { SIM_HZ } from "../sim";
import { buildOnLots, nextLots } from "../game/town-growth";
import { housesBy, townStatus } from "../game/towns";
import { receivedBy } from "../game/town-life";
import { play, type Blocked } from "./player";

function rulesFor(w: World): Blocked {
  return (type, flipped, pose, y, ignoreId) => {
    const c = checkPlacement(w.landscape, type, flipped, pose, y);
    if (c.kind === "blocked") return c.reason;
    if (findOverlap(w.layout, type, flipped, pose, y, ignoreId) !== -1) return "piece";
    if (findLowCrossing(w.layout, type, flipped, pose, y, ignoreId) !== -1) return "headroom";
    if (checkSupport(w.landscape, w.layout, type, flipped, pose, y, ignoreId).kind === "unsupported") return "unsupported";
    return null;
  };
}

/**
 * The Game mode's first job, played end to end: a simulated player lays the starter line (sawmill, Larkfield,
 * Elderwick, forest yard: one straight run) with the placement rules on, turnbacks go on its ends, and one timber
 * train shuttles along it through the real sim and economy until a town has grown to a city (level 3), the way
 * Game mode grows towns.
 */
describe("the starter line", () => {
it("is laid by a player and grows a town into a city", () => {
  const log: string[] = [];
  const w = buildStarterWorld();
  const fixed = new Set([...w.stations.values(), ...w.depots.values()]);
  const editor = new Editor(w.layout, w.sim, () => {}, (id) => fixed.has(id));
  const st = (i: number) => w.stations.get(w.landscape.towns[i].id)!;
  const depotPiece = (kind: string) => [...w.depots.values()].find((id) => w.layout.getPiece(id)!.type === `depot-${kind}`)!;
  const saw = depotPiece("sawmill");
  const forest = depotPiece("forest");
  // 1. The simulated player lays the line, leg by leg.
  const legs: [string, number, number][] = [
    ["Larkfield → sawmill", connectorRef(st(0), 0), connectorRef(saw, 1)],
    ["Larkfield → Elderwick", connectorRef(st(0), 1), connectorRef(st(1), 0)],
    ["Elderwick → forest yard", connectorRef(st(1), 1), connectorRef(forest, 0)],
  ];
  for (const [name, a, b] of legs) {
    const r = play(w.layout, editor, a, b, { blocked: rulesFor(w), maxPieces: 60, fiddle: 3 });
    log.push(`${name}: ${r.ok ? `joined, ${r.pieces} pieces` : `FAILED ${JSON.stringify(r)}`}`);
    expect(r.ok, name).toBe(true);
  }
  // 2. Turnback buffers on the line's two ends (the sawmill's far end, the forest yard's far end).
  for (const [piece, k] of [[saw, 0], [forest, 1]] as const) {
    const ref = connectorRef(piece, k);
    const e = w.layout.worldConnector(ref, { x: 0, z: 0, heading: 0, y: 0, kind: "peg" });
    let end = ref;
    let via = getPieceDef("buffer-turnback", false).connectors.findIndex((c) => c.kind !== e.kind);
    if (via === -1) {
      // A hole end: a buffer has a hole too, so a peg-peg adapter goes first (as a player would have to).
      const aid = appendPiece(w.layout, "adapter-peg", false, ref, 0);
      const ap = w.layout.getPiece(aid)!;
      w.layout.removePiece(aid);
      const placedAdapter = editor.place("adapter-peg", ap.pose, ap.y, false);
      end = connectorRef(placedAdapter, 1);
      via = 0;
      log.push(`turnback on ${w.layout.getPiece(piece)!.type}: needed a peg-peg adapter first`);
    } else log.push(`turnback on ${w.layout.getPiece(piece)!.type}: laid`);
    const id = appendPiece(w.layout, "buffer-turnback", false, end, via);
    const p = w.layout.getPiece(id)!;
    w.layout.removePiece(id);
    editor.place("buffer-turnback", p.pose, p.y, false);
  }
  syncIndustries(w);
  log.push(`track: ${w.layout.pieceCount - fixed.size} pieces laid`);
  // 3. A timber train between the towns, set going.
  const between = [...w.layout.pieceIds()].find((id) => !fixed.has(id) && w.layout.getPiece(id)!.type.startsWith("straight") && Math.abs(w.layout.getPiece(id)!.pose.x) < 300)!;
  const placed = w.sim.addTrain(["engine", "timber", "timber", "timber"], { pieceId: between, pathIndex: 0, reversed: false, s: 10 });
  if (placed.kind !== "placed") throw new Error(`no room for the train: ${placed.kind}`);
  const train = w.sim.getTrain(placed.trainId)!;
  w.sim.setLever(train.cars[0].id, -1);
  // 4. Run the railway; towns grow as in the game (TownLife's rule: on the delivery that fills the bar).
  const levels = new Map(w.landscape.towns.map((t) => [t.id, 0]));
  const minutes = 25;
  let best = 0;
  for (let tick = 0; tick < minutes * 60 * SIM_HZ; tick++) {
    w.sim.tick();
    w.economy.tick();
    if (tick % SIM_HZ !== 0) continue;
    for (const town of w.landscape.towns) {
      const s = townStatus(receivedBy(w, town.id));
      const was = levels.get(town.id)!;
      if (s.level > was) {
        const lots = nextLots(w.landscape, town, new LandEditor(w.landscape, w.layout), housesBy(s.level) - housesBy(was));
        buildOnLots(w.landscape, town, lots);
        addTownProps(w.landscape, w.props);
        levels.set(town.id, s.level);
        log.push(`${(tick / SIM_HZ / 60).toFixed(1)} min: ${town.name} grew into a ${s.name.toLowerCase()} (+${lots.length} buildings)`);
        best = Math.max(best, s.level);
      }
    }
    if (best >= 3) break;
  }
  log.push(`best level: ${best}; delivered ${JSON.stringify(Object.fromEntries(w.economy.delivered))}`);
  expect(best, log.join("\n")).toBeGreaterThanOrEqual(3);
}, 300_000);
});
