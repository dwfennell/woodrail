import { saveSchemas } from "./schemas";
import { MAX_RIDERS, MAX_SAVED_SPEED, SAVE_VERSION } from "./save-limits";
import { err, ok, type Result } from "../lib/result";
import { addSitesToOldSave, depotPieceType, fixedPieces, GAMES_KEY, HALT_KITS, INDUSTRY_ROLE, RUIN_STUB, STATION_CRANE_AT, type World } from "../game/world";
import type { GameMode } from "../game/modes";
import { PropStore } from "../props/store";
import { addTownProps } from "../props/towns";
import { CAR_LOOKS, Sim } from "../sim";
import type { Bag } from "../economy/goods";
import { canCarry, capAt, CARGO, CARGO_KINDS, Economy, LIFT_STACK, givesChoice, isStore, pilesOf, RECIPES, type BoatState, type CargoKind, type DepotState, type StoreMode } from "../economy";

import { connectorRef, cornersFromOneLever, getPieceDef, indexOfRef, JOINT_ANGLE_TOLERANCE, JOINT_POS_TOLERANCE, kitOf, Layout, pieceOfRef, relaxJoints, pathLength, angleDiff, isLift, type SignalStyle, type Pose, type RelaxOptions } from "../track";
import { BARGE_LOADS, isBulk, isDock, MAX_BOATS } from "../game/boats";
import { joinSavedLine, LINE_COLOURS, MAX_VIAS, type SavedLine } from "../game/lines";
import { JOURNAL_CAP } from "../game/journal";
import { deserializeLandscape, serializeLandscape } from "./landscape-data";
import { FEAT_NONE, FEAT_RUIN } from "../landscape";

export { SAVE_VERSION } from "./save-limits";

/**
 * Saves from before this version stacked nearly every house of a grown town: their town houses' storeys are dropped as
 * they load, and `TownLife.reset` gives them again (only some rise: `props/storeys.ts`).
 */
export const TOWN_STOREYS_FROM = 15;

/**
 * The oldest save that still loads. A v12 map is a v13 map (v13 changed only the progress's offers, beside the save:
 * `Progress.fromJSON` keeps a v12 offer's town, and `redrawOldOffers` draws it again as cards).
 */
export const MIGRATES_FROM = 12;

/** The error an older save gets (the title says so kindly). */
export const OLDER_SAVE = "older version";

export type { SaveData } from "./save-schema";
import type { SaveData, SessionData } from "./save-schema";

/** A workshop's keep amounts for its save: only those set (none: nothing). */
function keepsOf(d: DepotState): { keeps?: Partial<Record<CargoKind, number>> } {
  const keeps: Partial<Record<CargoKind, number>> = {};
  let any = false;
  for (const kind of CARGO_KINDS) {
    const n = d.keeps[CARGO[kind].index];
    if (n !== null) {
      keeps[kind] = n;
      any = true;
    }
  }
  return any ? { keeps } : {};
}

/** A depot's landed goods, for its save entry (none: nothing). */
/** A warehouse's store settings for its save: only what isn't the default (nothing listed, everything taken and given). */
function storeOf(d: DepotState): { modes?: Partial<Record<CargoKind, StoreMode>>; others?: StoreMode } {
  const modes: Partial<Record<CargoKind, StoreMode>> = {};
  let any = false;
  for (const kind of CARGO_KINDS) {
    const m = d.modes[CARGO[kind].index];
    if (m !== null) {
      modes[kind] = m;
      any = true;
    }
  }
  return { ...(any ? { modes } : {}), ...(d.others !== "both" ? { others: d.others } : {}) };
}

function landedOf(world: World, depotId: number): { landed?: number[] } {
  const l = world.economy.landed.get(depotId);
  return l && l.some((n) => n > 0) ? { landed: [...l] } : {};
}

/** A station's van yard (roads spec D5), its goods riding the van counted too (they're back on the yard on loading). */
/** An industry's further tracks as saved (depot tracks): their pieces still on the map; nothing with none. */
function tracksSaved(world: World, depotId: number): { tracks?: { roads: number[]; ends: number[]; ladder: number[] } } {
  const t = world.economy.tracksOf(depotId);
  if (!t) return {};
  const on = (id: number) => !!world.layout.getPiece(id);
  const roads = t.roads.map((r) => r.pieceId).filter(on);
  return roads.length > 0 ? { tracks: { roads, ends: t.ends.filter(on), ladder: t.ladder.filter(on) } } : {};
}

function vanYardOf(world: World, depotId: number): { vanYard?: Record<string, number> } {
  const y = world.economy.vanYard.get(depotId);
  return y && Object.values(y).some((n) => (n ?? 0) > 0) ? { vanYard: { ...y } as Record<string, number> } : {};
}

export function serializeWorld(world: World): SaveData {
  const { layout, sim } = world;
  const pieces: SaveData["pieces"] = [];
  const switches: SaveData["switches"] = [];
  for (const id of layout.pieceIds()) {
    const p = layout.getPiece(id)!;
    pieces.push({ id, type: p.type, x: p.pose.x, z: p.pose.z, heading: p.pose.heading, y: p.y, flipped: p.flipped });
    const state = layout.switchState(id);
    if (state !== 0) switches.push([id, state]);
  }
  // (Points' defaults, where they differ from how the points are set: §3.4 of the routing spec.)
  const defaults = world.economy.router.save();
  // Depots on the map now (one whose industry piece was taken up is left out), numbered afresh.
  const kept = world.economy.allDepots().filter((d) => world.layout.getPiece(d.pieceId));
  const renumbered = new Map(kept.map((d, i) => [d.id, i]));
  // Lines, with their stops at depots still on the map (a line left with none isn't saved), and each engine's line and
  // the stop it heads for (counted among the kept stops). An engine on a route but no line (made in code) is saved
  // as a line of its own.
  const lines: NonNullable<SaveData["lines"]> = [];
  const lineSaved = new Map<number, { id: number; next: number }>();
  const savedLine = new Map<object, number>();
  let spareId = Math.max(0, ...world.economy.lines.keys()) + 1;
  for (const id of sim.trainIds())
    for (const car of sim.getTrain(id)!.cars) {
      const r = world.economy.routeOf(car.id);
      if (!r) continue;
      const line = world.economy.lines.get(world.economy.lineIdOf.get(car.id) ?? -1);
      let lineId = savedLine.get(r.stops);
      if (lineId === undefined) {
        const stops = r.stops.flatMap((s): SavedLine["stops"] => {
          if (!renumbered.has(s.depotId)) return [];
          const via = (s.via ?? []).filter((p) => layout.getPiece(p)).slice(0, MAX_VIAS);
          return [via.length > 0 ? [renumbered.get(s.depotId)!, s.action, !!s.waitFill, via] : [renumbered.get(s.depotId)!, s.action, !!s.waitFill]];
        });
        if (stops.length === 0) continue;
        lineId = line?.id ?? spareId++;
        savedLine.set(r.stops, lineId);
        const look = line ?? LINE_COLOURS[(lineId - 1) % LINE_COLOURS.length];
        const told = !!line && world.economy.sections.toldFullOn(line.id);
        lines.push({ id: lineId, colour: look.colour, name: line?.name ?? `${LINE_COLOURS[(lineId - 1) % LINE_COLOURS.length].name} line`, stops, ...(told ? { toldFull: true as const } : {}) });
      }
      const kept = r.stops.slice(0, r.next).filter((s) => renumbered.has(s.depotId)).length;
      const n = lines.find((l) => l.id === lineId)!.stops.length;
      // (Via points passed on the way to its next stop, so it doesn't go back for them.)
      const via = !r.at && r.viaFor === r.next % r.stops.length && renumbered.has(r.stops[r.next % r.stops.length].depotId) ? (r.viaDone ?? 0) : 0;
      lineSaved.set(car.id, { id: lineId, next: Math.min(kept, n - 1), ...(line ? world.economy.sections.savedPlace(car.id) : {}), ...(via > 0 ? { via } : {}) });
    }
  const trains: SaveData["trains"] = sim.trainIds().map((id) => {
    const t = sim.getTrain(id)!;
    return {
      cars: t.cars.map((c) => {
        const cargo = world.economy.cargoOf(c.id);
        const riders = world.economy.ridersOf(c.id);
        const look = sim.lookOf(c.id);
        const line = lineSaved.get(c.id);
        const off = world.economy.carOffKinds(c.id);
        return {
          id: c.id,
          kind: c.kind,
          facing: c.facing,
          lever: c.lever,
          ...(look !== "classic" ? { look } : {}),
          ...(c.kind === "engine" && sim.nameOf(c.id) ? { name: sim.nameOf(c.id) } : {}),
          ...(c.kind === "engine" && sim.liveryOf(c.id) ? { livery: sim.liveryOf(c.id) } : {}),
          ...(cargo.kind && cargo.count > 0 ? { cargo: { kind: cargo.kind, count: cargo.count } } : {}),
          ...(cargo.count > 0 && renumbered.has(world.economy.landedFrom.get(c.id) ?? -1) ? { landedFrom: renumbered.get(world.economy.landedFrom.get(c.id)!)! } : {}),
          ...(line ? { line } : {}),
          ...(off.length > 0 ? { off } : {}),
          ...(riders.count > 0 && renumbered.has(riders.from) ? { riders: { count: Math.min(riders.count, MAX_RIDERS), from: renumbered.get(riders.from)! } } : {}),
        };
      }),
      lead: { ...t.bogies[0] },
      ...(t.speed > 0 && !t.derailed ? { speed: Math.min(MAX_SAVED_SPEED, Math.round(t.speed * 100) / 100) } : {}),
    };
  });
  return {
    version: SAVE_VERSION,
    landscape: serializeLandscape(world.landscape),
    towns: [...world.stations].map(([id, stationPieceId]) => ({ id, stationPieceId })),
    pieces,
    switches,
    joints: [...layout.joints()].map((j) => [pieceOfRef(j.a), indexOfRef(j.a), pieceOfRef(j.b), indexOfRef(j.b)] as [number, number, number, number]),
    ...(layout.pinnedCount > 0 ? { pinned: [...layout.pinnedIds()] } : {}),
    ...(layout.signalCount > 0 ? { signals: [...layout.signals()].map((m) => [pieceOfRef(m.at), indexOfRef(m.at), m.style, m.held] as [number, number, SignalStyle, boolean]) } : {}),
    ...(defaults ? { switchDefaults: defaults } : {}),
    wyeLevers: 3,
    trains,
    ids: sim.idCounters(),
    depots: kept.map((d, id) => ({ id, pieceId: d.pieceId, role: d.role, townId: d.townId, auto: d.auto, waitFull: d.waitFull, ...(d.takesAll ? { takesAll: true as const } : {}), piles: [...d.piles], timer: d.timer, ...(d.waiting > 0 ? { waiting: Math.min(d.waiting, MAX_RIDERS) } : {}), ...(d.sheds > 0 ? { sheds: d.sheds } : {}), ...storeOf(d), ...keepsOf(d), ...landedOf(world, d.id), ...(d.powerAsk > 0 ? { power: d.powerAsk } : {}), ...vanYardOf(world, d.id), ...tracksSaved(world, d.id) })),
    delivered: [...world.economy.delivered],
    deliveredGoods: [...world.economy.deliveredGoods].map(([townId, bag]) => [townId, { ...bag }] as [number, Record<string, number>]),
    ...(world.economy.roadGot.size > 0 ? { roadGot: [...world.economy.roadGot].map(([townId, bag]) => [townId, { ...bag }] as [number, Record<string, number>]) } : {}),
    ...(world.economy.placePlans.size > 0 ? { placePlans: [...world.economy.placePlans].map(([townId, p]) => [townId, p.id, { ...p.got }] as [number, string, Record<string, number>]) } : {}),
    ...(lines.length > 0 ? { lines } : {}),
    ...boatsOf(world, renumbered),
    ...yardsOf(world, renumbered),
    props: [...world.props.all()].map((p) => ({ id: p.id, asset: p.asset, x: p.x, z: p.z, heading: p.heading, y: p.y, ...(p.building !== undefined ? { building: p.building, town: p.town } : {}), ...(p.variant ? { variant: p.variant } : {}), ...(p.scale ? { scale: p.scale } : {}), ...(p.storeys ? { storeys: p.storeys } : {}) })),
  };
}

/** The yards' orders (renumbered as the depots are) and what the shipyards have built. */
function yardsOf(world: World, renumbered: ReadonlyMap<number, number>): Pick<SaveData, "yards" | "built"> {
  const yards = [...world.economy.yardOrders]
    .filter(([id]) => renumbered.has(id))
    .map(([id, o]) => ({ depot: renumbered.get(id)!, build: o.build, got: Object.fromEntries(Object.entries(o.got).filter(([, n]) => (n ?? 0) > 0)) as Record<string, number> }));
  const { shipsBuilt: ships, ferriesBuilt: ferries } = world.economy;
  return { ...(yards.length > 0 ? { yards } : {}), ...(ships + ferries > 0 ? { built: { ships, ferries } } : {}) };
}

/** The boats, their stops renumbered as the depots are (a stop at a depot no longer on the map is left out). */
function boatsOf(world: World, renumbered: ReadonlyMap<number, number>): Pick<SaveData, "boats"> {
  const boats: NonNullable<SaveData["boats"]> = [];
  for (const b of world.economy.boats.values()) {
    const stops = b.stops.filter((st) => renumbered.has(st.depotId));
    if (stops.length === 0) continue;
    const from = Math.max(0, stops.indexOf(b.stops[b.from]));
    const load: Record<string, number> = {};
    for (const [k, n] of Object.entries(b.load)) if (n && isBulk(k as CargoKind)) load[k] = n;
    boats.push({
      name: b.name,
      barges: b.barges,
      load,
      stops: stops.map((st) => [renumbered.get(st.depotId)!, st.action]),
      from,
      // (A boat that lost its next stop ties up at the one it left.)
      docked: b.docked || stops.length !== b.stops.length,
      t: b.docked || stops.length !== b.stops.length ? 0 : b.t,
      going: b.going,
      home: renumbered.get(b.home) ?? renumbered.get(stops[0].depotId)!,
    });
  }
  return boats.length > 0 ? { boats: boats.slice(0, MAX_BOATS) } : {};
}

/**
 * How far (mm) and how far round any piece may shift while an older save's joints are brought back in (QA's starter
 * line needs 16.9 mm and 6.04°, its curve-wide turning most).
 */
const LOAD_SHIFT = 20;
const LOAD_TURN = (7 * Math.PI) / 180;
/**
 * The work an older save's repair may take: at most this many relaxes, of at most 100 sweeps each (QA: a big old
 * save of 1,607 pieces, 700 joints past the tolerance, took 2.9 s unbounded; about 0.15 s now). Joints left over
 * stay joined as they were saved.
 */
const LOAD_RELAXES = 32;
const LOAD_RELAX: RelaxOptions = { sweeps: 100 };

/**
 * A save from before saves listed their joints: joints that joint play had taken a little past the tolerance were
 * parted by seating afresh (QA: a drawn line split after Continue). Ends that meet within the position tolerance and
 * `SAVED_JOINT_ANGLE` are joined again (`Layout.seatNearMisses`, before the trains go back on); then the loose track
 * round each such joint past the tolerance is relaxed to bring it within it. Pinned (`pinned`): stations, depots,
 * lifts and track under a train. A relax that would shift any piece further than `LOAD_SHIFT` or `LOAD_TURN` from
 * where it was saved isn't applied, and the work is bounded (`LOAD_RELAXES`): a joint not brought in stays joined
 * as saved, better a little past the tolerance and holding than a split line (the next save lists it). Returns
 * whether any piece moved.
 */
function relaxBroughtBack(layout: Layout, made: readonly number[], pinned: (id: number) => boolean): boolean {
  const loose = (ref: number) => {
    const j = layout.jointAt(ref);
    return !!j && (j.angleError > JOINT_ANGLE_TOLERANCE || j.posError > JOINT_POS_TOLERANCE);
  };
  const saved = new Map<number, Pose>();
  const fits = (moved: ReadonlyMap<number, Pose>) => {
    for (const [id, pose] of moved) {
      const from = saved.get(id) ?? layout.getPiece(id)!.pose;
      if (Math.hypot(pose.x - from.x, pose.z - from.z) > LOAD_SHIFT || angleDiff(pose.heading, from.heading) > LOAD_TURN) return false;
    }
    return moved.size > 0;
  };
  let budget = LOAD_RELAXES;
  // (Twice round: relaxing one joint can leave room to bring a neighbour in.)
  for (let pass = 0; pass < 2; pass++)
    for (const ref of made) {
      if (budget <= 0) return saved.size > 0;
      if (!loose(ref)) continue;
      const seeds = [pieceOfRef(ref), pieceOfRef(layout.joinedConnector(ref))];
      budget--;
      let moved = relaxJoints(layout, seeds, pinned, [], { ...LOAD_RELAX, strict: true });
      // (Not all within the tolerance: as near it as the relax gets without turning any joint further.)
      if (!fits(moved)) {
        budget--;
        moved = relaxJoints(layout, seeds, pinned, [], LOAD_RELAX);
      }
      if (!fits(moved)) continue;
      for (const id of moved.keys()) if (!saved.has(id)) saved.set(id, { ...layout.getPiece(id)!.pose });
      layout.nudgePieces(moved);
    }
  return saved.size > 0;
}

/** Rebuild a world from saved data. Never throws on bad input. */
export function deserializeWorld(data: unknown, opts: { sandbox?: boolean } = {}): Result<World, string> {
  // An older save: turned away (not migrated); a v12 one is read as it is (the same shape).
  const version = (data as { version?: unknown } | null)?.version;
  if (typeof version === "number" && version < MIGRATES_FROM) return err(OLDER_SAVE);
  const oldStoreys = typeof version === "number" && version < TOWN_STOREYS_FROM;
  if (typeof version === "number" && version < SAVE_VERSION) data = { ...(data as object), version: SAVE_VERSION };
  const parsed = saveSchemas().saveSchema.safeParse(data);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return err(`invalid save: ${issue.path.join(".")} — ${issue.message}`);
  }
  const save = parsed.data;
  const layout = new Layout();
  for (const p of [...save.pieces].sort((a, b) => a.id - b.id)) {
    if (!layout.restorePiece(p.id, p.type, { x: p.x, z: p.z, heading: p.heading }, p.y, p.flipped)) {
      return err(`invalid save: duplicate piece id ${p.id}`);
    }
  }
  // Joined as they were when saved (QA: joints a drawn line closed a little past the tolerance held while playing,
  // then were refused on loading, and the line split). Pieces that meet within it, and aren't in the list, seat anyway.
  for (const [pa, ia, pb, ib] of save.joints ?? []) layout.restoreJoint(connectorRef(pa, ia), connectorRef(pb, ib));
  // (A save from before the wye's three levers: its one lever set every corner alike.)
  const leversOf = (id: number, state: number): number => {
    const p = save.wyeLevers === undefined ? layout.getPiece(id) : undefined;
    return p && getPieceDef(p.type, p.flipped).cornerLevers ? cornersFromOneLever(state) : state;
  };
  for (const [id, state] of save.switches) if (layout.getPiece(id)) layout.setSwitchState(id, leversOf(id, state));
  for (const id of save.pinned ?? []) layout.setPinned(id, true);
  const land = deserializeLandscape(save.landscape);
  if (!land.ok) return err(`invalid save: ${land.error}`);
  const landscape = land.value;
  // A map saved before the first train's marker, with an engine on it already: its first train ran long ago, somewhere
  // else, so none is put down (null), rather than one wherever a train happens to run next.
  if (landscape.firstTrain === undefined && save.trains.some((t) => t.cars.some((c) => c.kind === "engine"))) landscape.firstTrain = null;
  const stations = new Map<number, number>();
  for (const town of landscape.towns) {
    const saved = save.towns.find((t) => t.id === town.id);
    const piece = saved ? layout.getPiece(saved.stationPieceId) : undefined;
    // (Or a big station's kit it was upgraded to, in place: src/game/station-upgrade.ts.)
    if (!piece || (piece.type !== "station" && piece.type !== town.upgraded)) return err(`invalid save: station for town ${town.id} is missing`);
    if (Math.hypot(piece.pose.x - town.station.x, piece.pose.z - town.station.z) > 0.5) return err(`invalid save: station for town ${town.id} is not at its town`);
    stations.set(town.id, piece.id);
  }
  const depots = new Map<number, number>();
  for (const depot of landscape.depots) {
    const type = depotPieceType(depot.kind);
    const piece = [...layout.pieceIds()].map((id) => layout.getPiece(id)!).find((p) => p.type === type && Math.hypot(p.pose.x - depot.piece.x, p.pose.z - depot.piece.z) < 0.5);
    if (!piece) return err(`invalid save: depot ${depot.id} is missing`);
    depots.set(depot.id, piece.id);
  }
  // Old industries' ruins: each standing one's stub, found where it was put, as a depot's is. (One that isn't there,
  // which can't happen in play, is taken as cleared rather than the save turned away.)
  const ruins = new Map<number, number>();
  const stubs = [...layout.pieceIds()].map((id) => layout.getPiece(id)!).filter((p) => p.type === RUIN_STUB);
  for (const site of landscape.sites ?? []) {
    if (site.cleared) continue;
    const piece = stubs.find((p) => Math.hypot(p.pose.x - site.piece.x, p.pose.z - site.piece.z) < 0.5 && ![...ruins.values()].includes(p.id));
    if (piece) {
      ruins.set(site.id, piece.id);
      continue;
    }
    site.cleared = true;
    const g = landscape.grid;
    g.forEachCell((i) => {
      if (g.feature[i] === FEAT_RUIN && g.owner[i] === site.id) {
        g.feature[i] = FEAT_NONE;
        g.owner[i] = -1;
      }
    });
  }
  // An older save's joints past the tolerance (parted by seating afresh), joined again before the trains go on.
  const broughtBack = save.joints ? [] : layout.seatNearMisses();
  // (Marks go on joints: after every joint is back. One whose joint didn't come back is dropped.)
  for (const [pieceId, index, style, held] of save.signals ?? []) layout.addSignal(connectorRef(pieceId, index), style, held);
  const sim = new Sim(layout);
  // The economy's depots as they were, in order: one on each depot piece and station.
  const economy = new Economy(layout, sim);
  economy.router.restore(save.switchDefaults?.map(([id, state]) => [id, leversOf(id, state)] as [number, number]));
  const expected = new Map<number, { role: string; townId: number }>();
  for (const [townId, pieceId] of stations) expected.set(pieceId, { role: "town", townId });
  for (const [depotId, pieceId] of depots) expected.set(pieceId, { role: landscape.depots[depotId].kind, townId: -1 });
  // Besides the map's own: industries the player placed (Game mode), each on a piece of its kind.
  for (const d of save.depots) {
    const piece = layout.getPiece(d.pieceId);
    // (Or a kit piece that's a cargo stop: Sandbox's loaders and unloaders.)
    const role = piece ? (INDUSTRY_ROLE[piece.type] ?? kitOf(piece.type)?.depot) : undefined;
    // (A school keeps the id of the town it's beside.)
    const townId = role === "school" && landscape.towns.some((t) => t.id === d.townId) ? d.townId : -1;
    if (!expected.has(d.pieceId) && role === d.role && ![...depots.values()].includes(d.pieceId)) expected.set(d.pieceId, { role: d.role, townId });
    // (Or a halt, Game mode's: a passenger stop of a town's on a kit piece.)
    if (!expected.has(d.pieceId) && piece && HALT_KITS.has(piece.type) && d.role === "town" && landscape.towns.some((t) => t.id === d.townId)) expected.set(d.pieceId, { role: "town", townId: d.townId });
  }
  if (save.depots.length !== expected.size) return err("invalid save: wrong number of economy depots");
  const stationIds = new Set(stations.values());
  for (const id of stationIds) economy.stationPieces.add(id);
  for (const [i, d] of save.depots.entries()) {
    const want = expected.get(d.pieceId);
    if (d.id !== i || !want || want.role !== d.role || want.townId !== d.townId) return err(`invalid save: economy depot ${d.id} doesn't match the landscape`);
    expected.delete(d.pieceId);
    // A town's station stops wagons by its crane; a halt's coaches stop along its platform (its middle).
    const halt = d.role === "town" && !stationIds.has(d.pieceId) && HALT_KITS.has(layout.getPiece(d.pieceId)?.type ?? "straight-216");
    const state = d.role === "town" ? economy.addDepot("town", d.pieceId, d.townId, halt ? undefined : STATION_CRANE_AT) : economy.addDepot(d.role, d.pieceId, d.townId);
    state.auto = d.auto;
    state.waitFull = d.waitFull;
    state.takesAll = (d.role === "workshop" || d.role === "school") && d.takesAll === true;
    if (d.role === "harbour") state.sheds = d.sheds ?? 0;
    state.powerAsk = d.power ?? 0;
    // A workshop's keep amounts (older saves have none: the game's own).
    if (d.role === "workshop") for (const kind of CARGO_KINDS) state.keeps[CARGO[kind].index] = d.keeps?.[kind] ?? null;
    // A warehouse's store settings (older saves have none: it takes and gives everything).
    if (isStore(d.role)) {
      state.others = d.others ?? "both";
      for (const kind of CARGO_KINDS) state.modes[CARGO[kind].index] = d.modes?.[kind] ?? null;
    }
    // An industry giving several goods: which it gives (Gives / Doesn't give; anything else is dropped).
    if (givesChoice(d.role)) for (const kind of RECIPES[d.role].gives) {
      const m = d.modes?.[kind];
      if (m === "both" || m === "off") state.modes[CARGO[kind].index] = m;
    }
    // Only the piles this kind of depot uses (its input and output) can hold anything.
    const kept = pilesOf(state.role);
    // (A warehouse's piles may have stacked higher with Lift and load, set again with the research after the load.)
    const cap = state.role === "warehouse" ? capAt(state) * LIFT_STACK : capAt(state);
    for (const kind of CARGO_KINDS) state.piles[CARGO[kind].index] = kept.includes(kind) ? Math.min(cap, d.piles[CARGO[kind].index] ?? 0) : 0;
    state.timer = d.timer;
    if (d.role === "town") state.waiting = d.waiting ?? 0;
    if (d.role === "town" && d.vanYard) {
      const yard: Bag = {};
      for (const k of CARGO_KINDS) if (d.vanYard[k]) yard[k] = d.vanYard[k];
      if (Object.keys(yard).length > 0) economy.vanYard.set(state.id, yard);
    }
    // Its further tracks (depot tracks): only pieces the save has (a save without: one track).
    if (d.tracks) {
      const on = (id: number) => !!layout.getPiece(id);
      const roads = d.tracks.roads.filter(on);
      if (roads.length > 0) economy.setTracks(state, roads, d.tracks.ends.filter(on), d.tracks.ladder.filter(on));
    }
    // Bought goods on a harbour's quay stay landed (the next boat doesn't take them back).
    if (d.landed) for (const kind of CARGO_KINDS) {
      const n = Math.min(d.landed[CARGO[kind].index] ?? 0, state.piles[CARGO[kind].index]);
      if (n > 0) {
        state.piles[CARGO[kind].index] -= n;
        economy.land(state, kind, n);
      }
    }
  }
  for (const [townId, n] of save.delivered) if (landscape.towns.some((t) => t.id === townId)) economy.delivered.set(townId, n);
  for (const [townId, bag] of save.deliveredGoods ?? []) {
    if (!landscape.towns.some((t) => t.id === townId)) continue;
    const goods: Bag = {};
    for (const k of CARGO_KINDS) if (bag[k]) goods[k] = bag[k];
    economy.deliveredGoods.set(townId, goods);
  }
  for (const [townId, id, bag] of save.placePlans ?? []) {
    if (!landscape.towns.some((t) => t.id === townId)) continue;
    const got: Bag = {};
    for (const k of CARGO_KINDS) if (bag[k]) got[k] = bag[k];
    economy.placePlans.set(townId, { id, got });
  }
  for (const [townId, bag] of save.roadGot ?? []) {
    if (!landscape.towns.some((t) => t.id === townId)) continue;
    const goods: Bag = {};
    for (const k of CARGO_KINDS) if (bag[k]) goods[k] = bag[k];
    economy.roadGot.set(townId, goods);
  }
  // Ids as saved (v14): the counters go on from the save's (and past every saved car's id); a train whose cars all
  // have ids, none taken, gets them back. Older saves: fresh ids, as before.
  const used = new Set<number>();
  let top = 0;
  for (const t of save.trains) for (const c of t.cars) if (c.id !== undefined) top = Math.max(top, c.id);
  sim.setIdCounters({ car: Math.max(save.ids?.car ?? 1, top + 1), train: save.ids?.train ?? 1 });
  for (const t of save.trains) {
    const lead = layout.getPiece(t.lead.pieceId);
    if (!lead) continue;
    const path = getPieceDef(lead.type, lead.flipped).paths[t.lead.pathIndex];
    if (!path || t.lead.s < 0 || t.lead.s > pathLength(path.geom)) continue;
    const ids = t.cars.every((c) => c.id !== undefined && !used.has(c.id)) && new Set(t.cars.map((c) => c.id)).size === t.cars.length ? t.cars.map((c) => c.id!) : undefined;
    const placed = sim.putBack(t.cars.map((c) => c.kind), t.lead, ids);
    if (placed.kind !== "placed") continue;
    if (ids) for (const id of ids) used.add(id);
    const train = sim.getTrain(placed.trainId)!;
    // Running on as it was (only where it was saved: a train put back elsewhere starts at rest).
    if (t.speed && train.bogies[0].pieceId === t.lead.pieceId && Math.abs(train.bogies[0].s - t.lead.s) < 1e-6) train.speed = t.speed;
    train.cars.forEach((car, i) => {
      if (t.cars[i].facing === -1) sim.flipCar(car.id);
      const look = t.cars[i].look;
      if (look && CAR_LOOKS[car.kind].includes(look)) sim.setLook(car.id, look);
      if (car.kind === "engine") sim.setLever(car.id, t.cars[i].lever);
      const name = t.cars[i].name;
      if (car.kind === "engine" && name) sim.setName(car.id, name);
      const livery = t.cars[i].livery;
      if (car.kind === "engine" && livery) sim.setLivery(car.id, livery);
      const on = t.cars[i].line;
      if (car.kind === "engine" && on) {
        joinSavedLine(economy, save.lines ?? [], car.id, on.id, on.next, on.via);
        if (economy.lineIdOf.get(car.id) === on.id) economy.sections.restorePlace(car.id, on.id, on);
      }
      const cargo = t.cars[i].cargo;
      if (cargo && canCarry(car.kind, cargo.kind)) {
        economy.setCargo(car.id, cargo.kind, cargo.count);
        const from = t.cars[i].landedFrom;
        if (from !== undefined && economy.depot(from)) economy.landedFrom.set(car.id, from);
      }
      // A wagon's goods switched off on its card (only goods it can carry).
      for (const kind of t.cars[i].off ?? []) if (canCarry(car.kind, kind)) economy.setCarTakes(car.id, kind, false);
      const riders = t.cars[i].riders;
      if (riders && car.kind === "passenger" && economy.depot(riders.from)?.role === "town") economy.setRiders(car.id, riders.count, riders.from);
    });
  }
  for (const l of save.lines ?? []) if (l.toldFull && economy.lines.has(l.id)) economy.sections.markToldFull(l.id);
  economy.sections.restored();
  // The yards' orders, and what the shipyards have built.
  for (const y of save.yards ?? []) {
    const role = economy.depot(y.depot)?.role;
    const fits = (role === "boatyard" && (y.build === "tug" || y.build === "barge")) || (role === "shipyard" && (y.build === "ship" || y.build === "ferry"));
    if (!fits) continue;
    const got: Partial<Record<CargoKind, number>> = {};
    for (const [k, n] of Object.entries(y.got)) if ((CARGO_KINDS as readonly string[]).includes(k)) got[k as CargoKind] = n;
    economy.yardOrders.set(y.depot, { build: y.build, got });
  }
  economy.shipsBuilt = save.built?.ships ?? 0;
  economy.ferriesBuilt = save.built?.ferries ?? 0;
  // The boats, at the depots they call at (one whose docks are all gone isn't brought back).
  let boatId = 1;
  for (const b of save.boats ?? []) {
    const stops = b.stops.filter(([d]) => isDock(economy.depot(d))).map(([depotId, action]) => ({ depotId, action }));
    if (stops.length === 0) continue;
    const load: BoatState["load"] = {};
    let room = b.barges * BARGE_LOADS;
    for (const [k, n] of Object.entries(b.load)) {
      if (!(CARGO_KINDS as readonly string[]).includes(k) || !isBulk(k as CargoKind)) continue;
      const take = Math.min(n, room);
      if (take > 0) load[k as CargoKind] = take;
      room -= take;
    }
    const kept = stops.length === b.stops.length;
    const from = kept ? Math.min(b.from, stops.length - 1) : 0;
    const id = boatId++;
    economy.boats.set(id, { id, name: b.name, barges: b.barges, load, stops, from, docked: kept ? b.docked : true, t: kept ? b.t : 0, going: b.going, home: isDock(economy.depot(b.home)) ? b.home : stops[0].depotId, loadedAt: {} });
  }
  if (broughtBack.length > 0) {
    // (Pinned as the editor pins: map pieces, lifts, and track under a train.)
    const fixed = fixedPieces({ stations, depots, ruins });
    const pinned = (id: number) => fixed.has(id) || isLift(layout.getPiece(id)!.type) || sim.pieceOccupied(id) || !sim.liftFree(id);
    if (relaxBroughtBack(layout, broughtBack, pinned)) sim.trackChanged();
  }
  const props = new PropStore();
  for (const p of save.props ?? []) {
    // (A save from before v15: a town house's storeys are given again by the new rule, `TOWN_STOREYS_FROM`.)
    const storeys = oldStoreys && p.building !== undefined ? 0 : (p.storeys ?? 0);
    props.add(p.asset, { x: p.x, z: p.z, heading: p.heading, y: p.y }, p.id, { building: p.building, town: p.town, ...(p.variant ? { variant: p.variant } : {}), ...(p.scale ? { scale: p.scale } : {}), ...(storeys ? { storeys } : {}) });
  }
  // Saves from before towns were built from catalogue models: their buildings get their models now.
  addTownProps(landscape, props);
  const world: World = { layout, sim, landscape, stations, depots, economy, props, ruins };
  // A save from before the map's sites and extra towns gains them on the land it owns, where nothing of the player's is
  // in the way (`addSitesToOldSave`). No new save version: `sites` is simply missing from such a save.
  // (A Sandbox save: no sites, ever. One from before sites gains nothing.)
  if (opts.sandbox && !landscape.siteless && (landscape.sites ?? []).length === 0) {
    landscape.sites = [];
    landscape.siteless = true;
  } else if (save.landscape.sites === undefined) addSitesToOldSave(world);
  return ok(world);
}

/**
 * One autosave per mode. Moved on with save version 8 (the landscape saved square by square): older saves can't load,
 * so the title shouldn't offer to carry them on.
 */
const STORAGE_KEYS: Record<GameMode, string> = { sandbox: "woodrail.autosave.v3", game: "woodrail.game.v2" };

export function saveToStorage(world: World, mode: GameMode = "sandbox"): boolean {
  try {
    localStorage.setItem(STORAGE_KEYS[mode], JSON.stringify(serializeWorld(world)));
    return true;
  } catch {
    return false;
  }
}

/** True when the mode has an autosave (valid or not: loading says which). */
/** Where an older save is kept (`backupKey`), not overwritten, when the game turns it away and starts afresh. */
export const backupKey = (mode: GameMode, version: number): string => `${STORAGE_KEYS[mode]}.backup-v${version}`;

/** Is this mode's autosave from an older version (one that won't load: the title says so)? */
export function hasOlderSave(mode: GameMode): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS[mode]);
    return raw !== null && olderVersion(raw) !== null;
  } catch {
    return false;
  }
}

/** The version of a save too old to load (`MIGRATES_FROM`), or null (one that loads, or not a save at all). */
function olderVersion(raw: string): number | null {
  let v: unknown;
  try {
    v = (JSON.parse(raw) as { version?: unknown } | null)?.version;
  } catch {
    return null;
  }
  return typeof v === "number" && v < MIGRATES_FROM ? v : null;
}

export function hasSave(mode: GameMode): boolean {
  try {
    return localStorage.getItem(STORAGE_KEYS[mode]) !== null;
  } catch {
    return false;
  }
}

export function loadFromStorage(mode: GameMode = "sandbox"): Result<World, string> | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEYS[mode]);
  } catch {
    return null;
  }
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return err("autosave is not valid JSON");
  }
  const loaded = deserializeWorld(data, { sandbox: mode === "sandbox" });
  // An older save, turned away: kept under a key of its own, so the fresh map's autosave doesn't overwrite it.
  if (!loaded.ok && loaded.error === OLDER_SAVE) {
    const version = (data as { version: number }).version;
    try {
      if (localStorage.getItem(backupKey(mode, version)) === null) localStorage.setItem(backupKey(mode, version), raw);
    } catch {
      // No room to keep it: it goes, as before.
    }
  }
  return loaded;
}

/** Game mode: the ids of the goals done, kept beside the game's autosave. */
const GOALS_KEY = "woodrail.game.goals.v1";

export function saveGoals(ids: readonly string[]): void {
  try {
    localStorage.setItem(GOALS_KEY, JSON.stringify(ids));
  } catch {
    // storage unavailable: goals are checked again from the railway next time
  }
}

export function loadGoals(): string[] {
  try {
    const ids: unknown = JSON.parse(localStorage.getItem(GOALS_KEY) ?? "[]");
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

/** Game mode: the ids of the stickers earned (see `game/stickers.ts`), kept as the goals are. */
const STICKERS_KEY = "woodrail.game.stickers.v1";

export function saveStickers(ids: readonly string[]): void {
  try {
    localStorage.setItem(STICKERS_KEY, JSON.stringify(ids));
  } catch {
    // storage unavailable: those that hold are earned again from the railway next time
  }
}

export function loadStickers(): string[] {
  try {
    const ids: unknown = JSON.parse(localStorage.getItem(STICKERS_KEY) ?? "[]");
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

/** Game mode: the stickers seen in their tab (this device's: only what the chip's dot shows). */
const STICKERS_SEEN_KEY = "woodrail.game.stickers.seen.v1";

export function saveStickersSeen(ids: readonly string[]): void {
  try {
    localStorage.setItem(STICKERS_SEEN_KEY, JSON.stringify(ids));
  } catch {
    // storage unavailable: the dot shows again next time
  }
}

export function loadStickersSeen(): string[] {
  try {
    const ids: unknown = JSON.parse(localStorage.getItem(STICKERS_SEEN_KEY) ?? "[]");
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

/** Game mode's feature tips (src/game/feature-tips.ts): those done (used or tapped away) and those toasted. This device only. */
const TIPS_KEY = "woodrail.game.tips.v1";

export function saveTips(tips: { done: readonly string[]; shown: readonly string[] }): void {
  try {
    localStorage.setItem(TIPS_KEY, JSON.stringify(tips));
  } catch {
    // storage unavailable: a tip may show again next time
  }
}

export function loadTips(): { done: string[]; shown: string[] } {
  const ids = (v: unknown): string[] => (Array.isArray(v) ? v.filter((id): id is string => typeof id === "string") : []);
  try {
    const t = JSON.parse(localStorage.getItem(TIPS_KEY) ?? "{}") as { done?: unknown; shown?: unknown } | null;
    return { done: ids(t?.done), shown: ids(t?.shown) };
  } catch {
    return { done: [], shown: [] };
  }
}

/** Game mode: the toy box, blueprints learned and the workshop's orders (see `Progress`), beside the game's autosave. */
const PROGRESS_KEY = "woodrail.game.progress.v1";

export function saveProgress(data: unknown): void {
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(data));
  } catch {
    // storage unavailable: the toy box covers what's on the map next time
  }
}

/** The saved progress (undefined if there's none or it can't be read: start a fresh one). */
export function loadProgress(): unknown {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    return raw === null ? undefined : JSON.parse(raw);
  } catch {
    return undefined;
  }
}

export type { SessionData } from "./save-schema";

const sessionKey = (mode: GameMode): string => `${STORAGE_KEYS[mode]}.session`;

export function saveSession(mode: GameMode, data: SessionData): void {
  try {
    localStorage.setItem(sessionKey(mode), JSON.stringify(data));
  } catch {
    // storage unavailable: the clock and the Journal start afresh next time
  }
}

/** A mode's saved session, or null (none, or it can't be read: start afresh). */
export function loadSession(mode: GameMode): SessionData | null {
  try {
    const raw = localStorage.getItem(sessionKey(mode));
    if (raw === null) return null;
    const data: unknown = JSON.parse(raw);
    const { sessionSchema, sessionHead, sessionEntry, sessionCounts } = saveSchemas();
    const parsed = sessionSchema.safeParse(data);
    if (parsed.success) return parsed.data;
    // Something in it doesn't read (a Journal entry, most likely): keep the clock and the pause if they do, with the
    // entries that read (QA: one bad entry lost the whole session, so the date went back to Jan 2000).
    const head = sessionHead.safeParse(data);
    if (!head.success) return null;
    const j = (data as { journal?: { entries?: unknown; seq?: unknown; readSeq?: unknown } }).journal;
    const entries = (Array.isArray(j?.entries) ? j.entries : []).flatMap((e) => {
      const r = sessionEntry.safeParse(e);
      return r.success ? [r.data] : [];
    });
    const counts = sessionCounts.safeParse(j);
    const seq = counts.success ? counts.data.seq : entries.reduce((m, e) => Math.max(m, e.seq), 0);
    return { ...head.data, journal: { entries: entries.slice(-JOURNAL_CAP), seq, readSeq: counts.success ? counts.data.readSeq : seq } };
  } catch {
    return null;
  }
}

/**
 * Everything kept for a mode's railway, by storage key (what a cloud save carries, see `persist/cloud.ts`): its
 * autosave and session, and in Game mode its goals and progress too. Settings (sound, graphics, favourites, the hints
 * seen) stay with the device.
 */
/** Game mode's progress and goals keys (what two devices' cloud copies merge: `persist/progress-merge.ts`). */
export const PROGRESS_KEYS = { progress: PROGRESS_KEY, goals: GOALS_KEY, stickers: STICKERS_KEY } as const;

export function modeKeys(mode: GameMode): string[] {
  const keys = [STORAGE_KEYS[mode], sessionKey(mode)];
  return mode === "game" ? [...keys, GOALS_KEY, STICKERS_KEY, PROGRESS_KEY, GAMES_KEY] : keys;
}
