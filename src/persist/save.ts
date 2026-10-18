import { z } from "zod";
import { err, ok, type Result } from "../lib/result";
import { depotPieceType, INDUSTRY_ROLE, STATION_CRANE_AT, type World } from "../game/world";
import type { GameMode } from "../game/modes";
import { PropStore } from "../props/store";
import { addTownProps } from "../props/towns";
import { ADV_OK, advanceCursor, ALL_CAR_LOOKS, CAR_KINDS, CAR_LOOKS, createAdvance, flipCursor, Sim, type AddTrainResult, type CarKind, type CarLook, type Cursor } from "../sim";
import type { Bag } from "../economy/goods";
import { canCarry, capAt, CARGO, CARGO_KINDS, Economy, KIT_DEPOT_ROLES, type StopAction, PILE_CAP, pilesOf, RECIPES, MAX_SHEDS, MAX_WAGON_CAPACITY, type CargoKind } from "../economy";

/** The biggest pile any depot keeps (a warehouse's). */
const MAX_PILE = Math.max(PILE_CAP, ...Object.values(RECIPES).map((r) => r.cap ?? 0));
/** Most people saved riding one coach, or waiting at one station. */
const MAX_RIDERS = 24;
import { getPieceDef, kitOf, Layout, MAX_CONNECTORS, pathLength, PIECE_TYPES, type PieceTypeId } from "../track";
import { joinSavedLine, LINE_COLOURS } from "../game/lines";
import { deserializeLandscape, landscapeSchema, serializeLandscape } from "./landscape-data";

/**
 * Save format, version 10 (lines: routes with a colour and a name). Plain JSON validated with Zod; only this module
 * (and `landscape-data`) knows its shape. The landscape is saved square by square (see `landscape-data.ts`): loading
 * never regenerates it. No backward compatibility until the game reaches v1: an older save is turned away
 * (`OLDER_SAVE`), and the game starts afresh.
 */
export const SAVE_VERSION = 10;

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
        line: z.object({ id: z.number().int().min(1), next: z.number().int().min(0) }).optional(),
      }),
    )
    .min(1),
  lead: z.object({
    pieceId: z.number().int().positive(),
    pathIndex: z.number().int().min(0),
    reversed: z.boolean(),
    s: z.number().finite(),
  }),
});

const saveSchema = z.object({
  version: z.literal(SAVE_VERSION),
  landscape: landscapeSchema,
  towns: z.array(z.object({ id: z.number().int().min(0), stationPieceId: z.number().int().positive() })),
  pieces: z.array(pieceSchema),
  switches: z.array(z.tuple([z.number().int(), z.number().int().min(0).max(MAX_CONNECTORS - 1)])),
  trains: z.array(trainSchema),
  /** Economy depots, in id order: the piece each works on and what it does. */
  depots: z.array(
    z.object({
      id: z.number().int().min(0),
      pieceId: z.number().int().positive(),
      role: z.enum(["forest", "sawmill", "town", "workshop", "farm", "mill", "quarry", "warehouse", "mine", "foundry", "carpenter", "smithy", "power", "harbour", ...KIT_DEPOT_ROLES]),
      townId: z.number().int().min(-1),
      auto: z.boolean(),
      waitFull: z.boolean(),
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
        lines.push({ id: lineId, colour: look.colour, name: line?.name ?? `${LINE_COLOURS[(lineId - 1) % LINE_COLOURS.length].name} line`, stops });
      }
      const kept = r.stops.slice(0, r.next).filter((s) => renumbered.has(s.depotId)).length;
      const n = lines.find((l) => l.id === lineId)!.stops.length;
      lineSaved.set(car.id, { id: lineId, next: Math.min(kept, n - 1) });
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
    };
  });
  return {
    version: SAVE_VERSION,
    landscape: serializeLandscape(world.landscape),
    towns: [...world.stations].map(([id, stationPieceId]) => ({ id, stationPieceId })),
    pieces,
    switches,
    trains,
    depots: kept.map((d, id) => ({ id, pieceId: d.pieceId, role: d.role, townId: d.townId, auto: d.auto, waitFull: d.waitFull, piles: [...d.piles], timer: d.timer, ...(d.waiting > 0 ? { waiting: Math.min(d.waiting, MAX_RIDERS) } : {}), ...(d.sheds > 0 ? { sheds: d.sheds } : {}), ...landedOf(world, d.id) })),
    delivered: [...world.economy.delivered],
    deliveredGoods: [...world.economy.deliveredGoods].map(([townId, bag]) => [townId, { ...bag }] as [number, Record<string, number>]),
    ...(lines.length > 0 ? { lines } : {}),
    props: [...world.props.all()].map((p) => ({ id: p.id, asset: p.asset, x: p.x, z: p.z, heading: p.heading, y: p.y, ...(p.building !== undefined ? { building: p.building, town: p.town } : {}), ...(p.variant ? { variant: p.variant } : {}) })),
  };
}

/** Rebuild a world from saved data. Never throws on bad input. */
export function deserializeWorld(data: unknown): Result<World, string> {
  // An older save: turned away (not migrated).
  const version = (data as { version?: unknown } | null)?.version;
  if (typeof version === "number" && version < SAVE_VERSION) return err(OLDER_SAVE);
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
  for (const [id, state] of save.switches) if (layout.getPiece(id)) layout.setSwitchState(id, state);
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
  const sim = new Sim(layout);
  // The economy's depots as they were, in order: one on each depot piece and station.
  const economy = new Economy(layout, sim);
  const expected = new Map<number, { role: string; townId: number }>();
  for (const [townId, pieceId] of stations) expected.set(pieceId, { role: "town", townId });
  for (const [depotId, pieceId] of depots) expected.set(pieceId, { role: landscape.depots[depotId].kind, townId: -1 });
  // Besides the map's own: industries the player placed (Game mode), each on a piece of its kind.
  for (const d of save.depots) {
    const piece = layout.getPiece(d.pieceId);
    // (Or a kit piece that's a cargo stop: Sandbox's loaders and unloaders.)
    const role = piece ? (INDUSTRY_ROLE[piece.type] ?? kitOf(piece.type)?.depot) : undefined;
    if (!expected.has(d.pieceId) && role === d.role && ![...depots.values()].includes(d.pieceId)) expected.set(d.pieceId, { role: d.role, townId: -1 });
  }
  if (save.depots.length !== expected.size) return err("invalid save: wrong number of economy depots");
  for (const [i, d] of save.depots.entries()) {
    const want = expected.get(d.pieceId);
    if (d.id !== i || !want || want.role !== d.role || want.townId !== d.townId) return err(`invalid save: economy depot ${d.id} doesn't match the landscape`);
    expected.delete(d.pieceId);
    const state = d.role === "town" ? economy.addDepot("town", d.pieceId, d.townId, STATION_CRANE_AT) : economy.addDepot(d.role, d.pieceId);
    state.auto = d.auto;
    state.waitFull = d.waitFull;
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
    train.cars.forEach((car, i) => {
      if (t.cars[i].facing === -1) sim.flipCar(car.id);
      const look = t.cars[i].look;
      if (look && CAR_LOOKS[car.kind].includes(look)) sim.setLook(car.id, look);
      if (car.kind === "engine") sim.setLever(car.id, t.cars[i].lever);
      const on = t.cars[i].line;
      if (car.kind === "engine" && on) joinSavedLine(economy, save.lines ?? [], car.id, on.id, on.next);
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
  const props = new PropStore();
  for (const p of save.props ?? []) props.add(p.asset, { x: p.x, z: p.z, heading: p.heading, y: p.y }, p.id, { building: p.building, town: p.town, ...(p.variant ? { variant: p.variant } : {}) });
  // Saves from before towns were built from catalogue models: their buildings get their models now.
  addTownProps(landscape, props);
  return ok({ layout, sim, landscape, stations, depots, economy, props });
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
  return deserializeWorld(data);
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
