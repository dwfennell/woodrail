import { z } from "zod";
import { err, ok, type Result } from "../lib/result";
import { addSitesToOldSave, depotPieceType, fixedPieces, GAMES_KEY, HALT_KITS, INDUSTRY_ROLE, RUIN_STUB, STATION_CRANE_AT, type World } from "../game/world";
import type { GameMode } from "../game/modes";
import { PropStore } from "../props/store";
import { addTownProps } from "../props/towns";
import { ADV_OK, advanceCursor, ALL_CAR_LOOKS, CAR_KINDS, CAR_LOOKS, createAdvance, flipCursor, Sim, type AddTrainResult, type CarKind, type CarLook, type Cursor } from "../sim";
import type { Bag } from "../economy/goods";
import { canCarry, capAt, CARGO, CARGO_KINDS, Economy, KIT_DEPOT_ROLES, type StopAction, PILE_CAP, pilesOf, RECIPES, MAX_SHEDS, MAX_WAGON_CAPACITY, type CargoKind } from "../economy";

/** The biggest pile any depot keeps (a warehouse's). */
const MAX_PILE = Math.max(PILE_CAP, ...Object.values(RECIPES).map((r) => r.cap ?? 0));
/** The fastest a train is saved going (mm/s): well over any engine's top speed. */
const MAX_SAVED_SPEED = 1000;
/** Most people saved riding one coach, or waiting at one station. */
const MAX_RIDERS = 24;
import { connectorRef, cornersFromOneLever, getPieceDef, indexOfRef, JOINT_ANGLE_TOLERANCE, JOINT_POS_TOLERANCE, kitOf, Layout, MAX_CONNECTORS, pieceOfRef, relaxJoints, pathLength, PIECE_TYPES, angleDiff, isLift, type PieceTypeId, type Pose, type RelaxOptions } from "../track";
import { joinSavedLine, LINE_COLOURS } from "../game/lines";
import { JOURNAL_CAP } from "../game/journal";
import { deserializeLandscape, landscapeSchema, serializeLandscape } from "./landscape-data";
import { FEAT_NONE, FEAT_RUIN } from "../landscape";

/**
 * Save format, version 13 (the growth menu: a town's offer is three cards, never a blueprint, saved with the progress;
 * 12: research, the school a depot beside a town, saved with its town's id; 11: town
 * buildings at their new sizes, the biggest landmarks on 2×2 lots; 10: lines, routes with a colour and a name). Plain JSON validated with Zod; only this module
 * (and `landscape-data`) knows its shape. The landscape is saved square by square (see `landscape-data.ts`): loading
 * never regenerates it. No backward compatibility until the game reaches v1: a save older than `MIGRATES_FROM` is
 * turned away (`OLDER_SAVE`), and the game starts afresh.
 */
export const SAVE_VERSION = 13;

/**
 * The oldest save that still loads. A v12 map is a v13 map (v13 changed only the progress's offers, beside the save:
 * `Progress.fromJSON` keeps a v12 offer's town, and `redrawOldOffers` draws it again as cards).
 */
export const MIGRATES_FROM = 12;

/** The error an older save gets (the title says so kindly). */
export const OLDER_SAVE = "older version";

const pieceSchema = z.object({
  id: z.number().int().positive(),
  type: z.enum(PIECE_TYPES as unknown as [PieceTypeId, ...PieceTypeId[]]),
  x: z.number().finite(),
  z: z.number().finite(),
  heading: z.number().finite(),
  y: z.number().finite(),
  flipped: z.boolean(),
});

const trainSchema = z.object({
  cars: z
    .array(
      z.object({
        kind: z.enum(CAR_KINDS as unknown as [CarKind, ...CarKind[]]),
        facing: z.union([z.literal(1), z.literal(-1)]),
        lever: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
        look: z.enum(ALL_CAR_LOOKS as unknown as [CarLook, ...CarLook[]]).optional(),
        cargo: z.object({ kind: z.enum(CARGO_KINDS as unknown as [CargoKind, ...CargoKind[]]), count: z.number().int().min(1).max(MAX_WAGON_CAPACITY) }).optional(),
        /** The harbour (economy depot id) its cargo was bought at: not unloaded back there. */
        landedFrom: z.number().int().min(0).optional(),
        /** People riding a coach: how many, and the station they got on at (its index in `depots`). */
        riders: z.object({ count: z.number().int().min(1).max(MAX_RIDERS), from: z.number().int().min(0) }).optional(),
        /** The line an engine runs (its id in `lines`), and the stop it heads for. */
        // (`joined`: when it came to its line, a count, the newest being the one held when there's no room; `held`: its
        // line had no room for it. Optional: older saves work them out afresh.)
        line: z.object({ id: z.number().int().min(1), next: z.number().int().min(0), joined: z.number().int().min(0).optional(), held: z.literal(true).optional() }).optional(),
      }),
    )
    .min(1),
  lead: z.object({
    pieceId: z.number().int().positive(),
    pathIndex: z.number().int().min(0),
    reversed: z.boolean(),
    s: z.number().finite(),
  }),
  /** How fast it was going (mm/s; optional: older saves, and trains standing, load at rest). */
  speed: z.number().min(0).max(MAX_SAVED_SPEED).optional(),
});

const saveSchema = z.object({
  version: z.literal(SAVE_VERSION),
  landscape: landscapeSchema,
  towns: z.array(z.object({ id: z.number().int().min(0), stationPieceId: z.number().int().positive() })),
  pieces: z.array(pieceSchema),
  switches: z.array(z.tuple([z.number().int(), z.number().int().min(0).max(MAX_CONNECTORS - 1)])),
  /**
   * The joints, each as two ends (piece id, connector index): loaded joined as they were, even one joint play took a
   * little past the joint tolerance (optional: older saves are seated afresh, by the tolerance alone).
   */
  joints: z.array(z.tuple([z.number().int().positive(), z.number().int().min(0).max(MAX_CONNECTORS - 1), z.number().int().positive(), z.number().int().min(0).max(MAX_CONNECTORS - 1)])).optional(),
  /** Pinned switches, by piece id: routed engines don't throw them (optional: older saves load with none). */
  pinned: z.array(z.number().int().positive()).optional(),
  /**
   * Points' defaults (the way the player last set them by hand, which routes put them back to), only where one differs
   * from how the switch is set (optional: older saves, and points not named, default to how they're set).
   */
  switchDefaults: z.array(z.tuple([z.number().int(), z.number().int().min(0).max(MAX_CONNECTORS - 1)])).optional(),
  /**
   * 3: a wye's switch state is its three levers, a bit for each corner (#15). Missing: a save from before, its wyes'
   * one lever setting every corner alike (`cornersFromOneLever`).
   */
  wyeLevers: z.literal(3).optional(),
  trains: z.array(trainSchema),
  /** Economy depots, in id order: the piece each works on and what it does. */
  depots: z.array(
    z.object({
      id: z.number().int().min(0),
      pieceId: z.number().int().positive(),
      role: z.enum(["forest", "sawmill", "town", "workshop", "farm", "mill", "quarry", "warehouse", "mine", "foundry", "carpenter", "smithy", "power", "harbour", "school", ...KIT_DEPOT_ROLES]),
      townId: z.number().int().min(-1),
      auto: z.boolean(),
      waitFull: z.boolean(),
      /** A workshop that takes all the planks trains bring (optional: absent, it shares with towns further on). */
      takesAll: z.literal(true).optional(),
      /** Units on each pile, in cargo order (saves from before grain and flour have just logs and planks). */
      piles: z.array(z.number().int().min(0).max(MAX_PILE)).min(2).max(CARGO_KINDS.length),
      timer: z.number().int().min(0),
      /** People waiting at a town's station. */
      waiting: z.number().int().min(0).max(MAX_RIDERS).optional(),
      /** A harbour's dock sheds. */
      sheds: z.number().int().min(0).max(MAX_SHEDS).optional(),
      /** Of its piles, what's landed there for trains to take away (a harbour's bought goods), in cargo order. */
      landed: z.array(z.number().int().min(0).max(MAX_PILE)).max(CARGO_KINDS.length).optional(),
    }),
  ),
  /** Plank bundles delivered, by town id. */
  delivered: z.array(z.tuple([z.number().int().min(0), z.number().int().min(0)])),
  /** Everything delivered to each town, by kind (Game mode's town baskets). Older saves: planks only, in `delivered`. */
  deliveredGoods: z.array(z.tuple([z.number().int().min(0), z.record(z.string(), z.number().int().min(0))])).optional(),
  /** Lines: a colour, a name, and stops (depot indices in `depots`, what's done there, wait there to fill). */
  lines: z
    .array(
      z.object({
        id: z.number().int().min(1),
        colour: z.string().max(16),
        name: z.string().max(40),
        stops: z.array(z.tuple([z.number().int().min(0), z.enum(["auto", "both", "drop", "pick"]), z.boolean()])).min(1),
        /** Its player has been told it has no room for a train put on it (said once a line). */
        toldFull: z.literal(true).optional(),
      }),
    )
    .optional(),
  /** Placed catalogue models (optional: saves from before props load with none). */
  props: z
    .array(
      z.object({
        id: z.number().int().positive(),
        asset: z.string().max(64),
        x: z.number().finite(),
        z: z.number().finite(),
        heading: z.number().finite(),
        y: z.number().finite(),
        building: z.number().int().min(0).optional(),
        town: z.number().int().min(0).optional(),
        variant: z.number().int().min(0).max(8).optional(),
        scale: z.number().min(0.5).max(1).optional(),
        /** A town house's storeys more than its model (its town grew: `props/storeys.ts`). */
        storeys: z.number().int().min(0).max(8).optional(),
      }),
    )
    .optional(),
});

export type SaveData = z.infer<typeof saveSchema>;

/** A depot's landed goods, for its save entry (none: nothing). */
function landedOf(world: World, depotId: number): { landed?: number[] } {
  const l = world.economy.landed.get(depotId);
  return l && l.some((n) => n > 0) ? { landed: [...l] } : {};
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
        const stops = r.stops.flatMap((s) => (renumbered.has(s.depotId) ? [[renumbered.get(s.depotId)!, s.action, !!s.waitFill] as [number, StopAction, boolean]] : []));
        if (stops.length === 0) continue;
        lineId = line?.id ?? spareId++;
        savedLine.set(r.stops, lineId);
        const look = line ?? LINE_COLOURS[(lineId - 1) % LINE_COLOURS.length];
        const told = !!line && world.economy.sections.toldFullOn(line.id);
        lines.push({ id: lineId, colour: look.colour, name: line?.name ?? `${LINE_COLOURS[(lineId - 1) % LINE_COLOURS.length].name} line`, stops, ...(told ? { toldFull: true as const } : {}) });
      }
      const kept = r.stops.slice(0, r.next).filter((s) => renumbered.has(s.depotId)).length;
      const n = lines.find((l) => l.id === lineId)!.stops.length;
      lineSaved.set(car.id, { id: lineId, next: Math.min(kept, n - 1), ...(line ? world.economy.sections.savedPlace(car.id) : {}) });
    }
  const trains: SaveData["trains"] = sim.trainIds().map((id) => {
    const t = sim.getTrain(id)!;
    return {
      cars: t.cars.map((c) => {
        const cargo = world.economy.cargoOf(c.id);
        const riders = world.economy.ridersOf(c.id);
        const look = sim.lookOf(c.id);
        const line = lineSaved.get(c.id);
        return {
          kind: c.kind,
          facing: c.facing,
          lever: c.lever,
          ...(look !== "classic" ? { look } : {}),
          ...(cargo.kind && cargo.count > 0 ? { cargo: { kind: cargo.kind, count: cargo.count } } : {}),
          ...(cargo.count > 0 && renumbered.has(world.economy.landedFrom.get(c.id) ?? -1) ? { landedFrom: renumbered.get(world.economy.landedFrom.get(c.id)!)! } : {}),
          ...(line ? { line } : {}),
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
    ...(defaults ? { switchDefaults: defaults } : {}),
    wyeLevers: 3,
    trains,
    depots: kept.map((d, id) => ({ id, pieceId: d.pieceId, role: d.role, townId: d.townId, auto: d.auto, waitFull: d.waitFull, ...(d.takesAll ? { takesAll: true as const } : {}), piles: [...d.piles], timer: d.timer, ...(d.waiting > 0 ? { waiting: Math.min(d.waiting, MAX_RIDERS) } : {}), ...(d.sheds > 0 ? { sheds: d.sheds } : {}), ...landedOf(world, d.id) })),
    delivered: [...world.economy.delivered],
    deliveredGoods: [...world.economy.deliveredGoods].map(([townId, bag]) => [townId, { ...bag }] as [number, Record<string, number>]),
    ...(lines.length > 0 ? { lines } : {}),
    props: [...world.props.all()].map((p) => ({ id: p.id, asset: p.asset, x: p.x, z: p.z, heading: p.heading, y: p.y, ...(p.building !== undefined ? { building: p.building, town: p.town } : {}), ...(p.variant ? { variant: p.variant } : {}), ...(p.scale ? { scale: p.scale } : {}), ...(p.storeys ? { storeys: p.storeys } : {}) })),
  };
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
  if (typeof version === "number" && version < SAVE_VERSION) data = { ...(data as object), version: SAVE_VERSION };
  const parsed = saveSchema.safeParse(data);
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
  const stations = new Map<number, number>();
  for (const town of landscape.towns) {
    const saved = save.towns.find((t) => t.id === town.id);
    const piece = saved ? layout.getPiece(saved.stationPieceId) : undefined;
    if (!piece || piece.type !== "station") return err(`invalid save: station for town ${town.id} is missing`);
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
  for (const [i, d] of save.depots.entries()) {
    const want = expected.get(d.pieceId);
    if (d.id !== i || !want || want.role !== d.role || want.townId !== d.townId) return err(`invalid save: economy depot ${d.id} doesn't match the landscape`);
    expected.delete(d.pieceId);
    // A town's station stops wagons by its crane; a halt's coaches stop along its platform (its middle).
    const halt = d.role === "town" && HALT_KITS.has(layout.getPiece(d.pieceId)?.type ?? "straight-216");
    const state = d.role === "town" ? economy.addDepot("town", d.pieceId, d.townId, halt ? undefined : STATION_CRANE_AT) : economy.addDepot(d.role, d.pieceId, d.townId);
    state.auto = d.auto;
    state.waitFull = d.waitFull;
    state.takesAll = d.role === "workshop" && d.takesAll === true;
    if (d.role === "harbour") state.sheds = d.sheds ?? 0;
    // Only the piles this kind of depot uses (its input and output) can hold anything.
    const kept = pilesOf(state.role);
    for (const kind of CARGO_KINDS) state.piles[CARGO[kind].index] = kept.includes(kind) ? Math.min(capAt(state), d.piles[CARGO[kind].index] ?? 0) : 0;
    state.timer = d.timer;
    if (d.role === "town") state.waiting = d.waiting ?? 0;
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
  for (const t of save.trains) {
    const lead = layout.getPiece(t.lead.pieceId);
    if (!lead) continue;
    const path = getPieceDef(lead.type, lead.flipped).paths[t.lead.pathIndex];
    if (!path || t.lead.s < 0 || t.lead.s > pathLength(path.geom)) continue;
    const placed = putBack(sim, layout, t.cars.map((c) => c.kind), t.lead);
    if (placed.kind !== "placed") continue;
    const train = sim.getTrain(placed.trainId)!;
    // Running on as it was (only where it was saved: a train put back elsewhere starts at rest).
    if (t.speed && train.bogies[0].pieceId === t.lead.pieceId && Math.abs(train.bogies[0].s - t.lead.s) < 1e-6) train.speed = t.speed;
    train.cars.forEach((car, i) => {
      if (t.cars[i].facing === -1) sim.flipCar(car.id);
      const look = t.cars[i].look;
      if (look && CAR_LOOKS[car.kind].includes(look)) sim.setLook(car.id, look);
      if (car.kind === "engine") sim.setLever(car.id, t.cars[i].lever);
      const on = t.cars[i].line;
      if (car.kind === "engine" && on) {
        joinSavedLine(economy, save.lines ?? [], car.id, on.id, on.next);
        if (economy.lineIdOf.get(car.id) === on.id) economy.sections.restorePlace(car.id, on.id, on);
      }
      const cargo = t.cars[i].cargo;
      if (cargo && canCarry(car.kind, cargo.kind)) {
        economy.setCargo(car.id, cargo.kind, cargo.count);
        const from = t.cars[i].landedFrom;
        if (from !== undefined && economy.depot(from)) economy.landedFrom.set(car.id, from);
      }
      const riders = t.cars[i].riders;
      if (riders && car.kind === "passenger" && economy.depot(riders.from)?.role === "town") economy.setRiders(car.id, riders.count, riders.from);
    });
  }
  for (const l of save.lines ?? []) if (l.toldFull && economy.lines.has(l.id)) economy.sections.markToldFull(l.id);
  economy.sections.restored();
  if (broughtBack.length > 0) {
    // (Pinned as the editor pins: map pieces, lifts, and track under a train.)
    const fixed = fixedPieces({ stations, depots, ruins });
    const pinned = (id: number) => fixed.has(id) || isLift(layout.getPiece(id)!.type) || sim.pieceOccupied(id) || !sim.liftFree(id);
    if (relaxBroughtBack(layout, broughtBack, pinned)) sim.trackChanged();
  }
  const props = new PropStore();
  for (const p of save.props ?? []) props.add(p.asset, { x: p.x, z: p.z, heading: p.heading, y: p.y }, p.id, { building: p.building, town: p.town, ...(p.variant ? { variant: p.variant } : {}), ...(p.scale ? { scale: p.scale } : {}), ...(p.storeys ? { storeys: p.storeys } : {}) });
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

/** How far along the track a saved train may be moved to find room (a few train lengths). */
const PUT_BACK_REACH = 1200;

/**
 * Put a saved train back where it was; or, when that's taken (a derailed train lying across another after a crash),
 * on the nearest free stretch along the track either way, so a save never loses a train it can fit.
 */
function putBack(sim: Sim, layout: Layout, kinds: readonly CarKind[], lead: Cursor): AddTrainResult {
  const placed = sim.addTrain(kinds, lead);
  if (placed.kind === "placed") return placed;
  const adv = createAdvance();
  const ways = [{ ...lead }, { ...lead }];
  flipCursor(layout, ways[1]);
  const open = [true, true];
  for (let moved = 24; moved <= PUT_BACK_REACH; moved += 24) {
    for (let k = 0; k < 2; k++) {
      if (!open[k]) continue;
      advanceCursor(layout, ways[k], 24, null, adv);
      if (adv.status !== ADV_OK) {
        open[k] = false;
        continue;
      }
      const at = { ...ways[k] };
      if (k === 1) flipCursor(layout, at);
      const r = sim.addTrainAround(kinds, at);
      if (r.kind === "placed") return r;
    }
  }
  return placed;
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

/**
 * What goes on beside a mode's railway, saved with it (not in the save format: nothing in the world depends on it): the
 * game's clock (seconds played, the Journal's times are on it), whether it was paused, and the Journal.
 */
const sessionEntry = z.object({
  kind: z.enum(["event", "milestone"]),
  text: z.string().max(2000),
  place: z.object({ x: z.number().finite(), z: z.number().finite(), points: z.array(z.object({ x: z.number().finite(), z: z.number().finite() })).max(64).optional() }).optional(),
  time: z.number().finite(),
  key: z.string().max(500).optional(),
  count: z.number().int().min(1),
  qty: z.number().finite(),
  seq: z.number().int().min(0),
});
const sessionJournal = z.object({
  entries: z.array(sessionEntry).max(JOURNAL_CAP),
  seq: z.number().int().min(0),
  readSeq: z.number().int().min(0),
});
const sessionSchema = z.object({
  clock: z.number().min(0).finite(),
  paused: z.boolean(),
  journal: sessionJournal,
});

export type SessionData = z.infer<typeof sessionSchema>;

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
    const parsed = sessionSchema.safeParse(data);
    if (parsed.success) return parsed.data;
    // Something in it doesn't read (a Journal entry, most likely): keep the clock and the pause if they do, with the
    // entries that read (QA: one bad entry lost the whole session, so the date went back to Jan 2000).
    const head = z.object({ clock: sessionSchema.shape.clock, paused: sessionSchema.shape.paused }).safeParse(data);
    if (!head.success) return null;
    const j = (data as { journal?: { entries?: unknown; seq?: unknown; readSeq?: unknown } }).journal;
    const entries = (Array.isArray(j?.entries) ? j.entries : []).flatMap((e) => {
      const r = sessionEntry.safeParse(e);
      return r.success ? [r.data] : [];
    });
    const counts = z.object({ seq: sessionJournal.shape.seq, readSeq: sessionJournal.shape.readSeq }).safeParse(j);
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
export const PROGRESS_KEYS = { progress: PROGRESS_KEY, goals: GOALS_KEY } as const;

export function modeKeys(mode: GameMode): string[] {
  const keys = [STORAGE_KEYS[mode], sessionKey(mode)];
  return mode === "game" ? [...keys, GOALS_KEY, PROGRESS_KEY, GAMES_KEY] : keys;
}
