import { z } from "zod";
import { err, ok, type Result } from "../lib/result";
import { createEconomy, depotPieceType, type World } from "../game/world";
import type { GameMode } from "../game/modes";
import { generateLandscape } from "../landscape";
import { ALL_CAR_LOOKS, CAR_KINDS, CAR_LOOKS, Sim, type CarKind, type CarLook } from "../sim";
import { CARGO, CARGO_KINDS, PILE_CAP, ROLE, WAGON_CAPACITY, type CargoKind } from "../economy";
import { getPieceDef, isBridge, Layout, pathLength, PIECE_TYPES, RISER_HEIGHT, type PieceTypeId } from "../track";

/**
 * Save format, version 7. Plain JSON validated with Zod; only this module knows its shape.
 * The landscape is regenerated from its seed. No backward compatibility until the game reaches v1, except that
 * version 6 saves still load (their bridges stored the height of their arches' feet, not their decks).
 */
export const SAVE_VERSION = 7;
const BRIDGE_FEET_VERSION = 6;

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
        cargo: z.object({ kind: z.enum(CARGO_KINDS as unknown as [CargoKind, ...CargoKind[]]), count: z.number().int().min(1).max(WAGON_CAPACITY) }).optional(),
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
  version: z.union([z.literal(SAVE_VERSION), z.literal(BRIDGE_FEET_VERSION)]),
  landscape: z.object({ seed: z.number().int(), starter: z.boolean() }),
  towns: z.array(z.object({ id: z.number().int().min(0), stationPieceId: z.number().int().positive() })),
  pieces: z.array(pieceSchema),
  switches: z.array(z.tuple([z.number().int(), z.number().int().min(0).max(2)])),
  trains: z.array(trainSchema),
  /** Economy depots by id (landscape depots first, then one per town station). */
  depots: z.array(
    z.object({
      id: z.number().int().min(0),
      auto: z.boolean(),
      waitFull: z.boolean(),
      piles: z.tuple([z.number().int().min(0).max(PILE_CAP), z.number().int().min(0).max(PILE_CAP)]),
      timer: z.number().int().min(0),
    }),
  ),
  /** Plank bundles delivered, by town id. */
  delivered: z.array(z.tuple([z.number().int().min(0), z.number().int().min(0)])),
});

export type SaveData = z.infer<typeof saveSchema>;

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
  const trains: SaveData["trains"] = sim.trainIds().map((id) => {
    const t = sim.getTrain(id)!;
    return {
      cars: t.cars.map((c) => {
        const cargo = world.economy.cargoOf(c.id);
        const look = sim.lookOf(c.id);
        return { kind: c.kind, facing: c.facing, lever: c.lever, ...(look !== "classic" ? { look } : {}), ...(cargo.kind && cargo.count > 0 ? { cargo: { kind: cargo.kind, count: cargo.count } } : {}) };
      }),
      lead: { ...t.bogies[0] },
    };
  });
  return {
    version: SAVE_VERSION,
    landscape: { seed: world.landscape.seed, starter: world.landscape.starter },
    towns: [...world.stations].map(([id, stationPieceId]) => ({ id, stationPieceId })),
    pieces,
    switches,
    trains,
    depots: world.economy.allDepots().map((d) => ({ id: d.id, auto: d.auto, waitFull: d.waitFull, piles: [d.piles[0], d.piles[1]] as [number, number], timer: d.timer })),
    delivered: [...world.economy.delivered],
  };
}

/** Rebuild a world from saved data. Never throws on bad input. */
export function deserializeWorld(data: unknown): Result<World, string> {
  const parsed = saveSchema.safeParse(data);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return err(`invalid save: ${issue.path.join(".")} — ${issue.message}`);
  }
  const save = parsed.data;
  const layout = new Layout();
  for (const p of [...save.pieces].sort((a, b) => a.id - b.id)) {
    const y = save.version === BRIDGE_FEET_VERSION && isBridge(p.type) ? p.y + RISER_HEIGHT : p.y;
    if (!layout.restorePiece(p.id, p.type, { x: p.x, z: p.z, heading: p.heading }, y, p.flipped)) {
      return err(`invalid save: duplicate piece id ${p.id}`);
    }
  }
  for (const [id, state] of save.switches) if (layout.getPiece(id)) layout.setSwitchState(id, state);
  const landscape = generateLandscape(save.landscape.seed, { starter: save.landscape.starter });
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
  const economy = createEconomy(layout, sim, landscape, stations, depots);
  for (const d of save.depots) {
    const state = economy.depot(d.id);
    if (!state) continue;
    state.auto = d.auto;
    state.waitFull = d.waitFull;
    // Only the piles this kind of depot uses (its input and output) can hold anything.
    const role = ROLE[state.role];
    for (const kind of CARGO_KINDS) state.piles[CARGO[kind].index] = role.takes === kind || role.gives === kind ? d.piles[CARGO[kind].index] : 0;
    state.timer = d.timer;
  }
  for (const [townId, n] of save.delivered) if (landscape.towns.some((t) => t.id === townId)) economy.delivered.set(townId, n);
  for (const t of save.trains) {
    const lead = layout.getPiece(t.lead.pieceId);
    if (!lead) continue;
    const path = getPieceDef(lead.type, lead.flipped).paths[t.lead.pathIndex];
    if (!path || t.lead.s < 0 || t.lead.s > pathLength(path.geom)) continue;
    const placed = sim.addTrain(
      t.cars.map((c) => c.kind),
      t.lead,
    );
    if (placed.kind !== "placed") continue;
    const train = sim.getTrain(placed.trainId)!;
    train.cars.forEach((car, i) => {
      if (t.cars[i].facing === -1) sim.flipCar(car.id);
      const look = t.cars[i].look;
      if (look && CAR_LOOKS[car.kind].includes(look)) sim.setLook(car.id, look);
      if (car.kind === "engine") sim.setLever(car.id, t.cars[i].lever);
      const cargo = t.cars[i].cargo;
      if (cargo && car.kind === "timber") economy.setCargo(car.id, cargo.kind, cargo.count);
    });
  }
  return ok({ layout, sim, landscape, stations, depots, economy });
}

/** One autosave per mode. Sandbox keeps the key from before there were modes, so those railways carry over. */
const STORAGE_KEYS: Record<GameMode, string> = { sandbox: "woodrail.autosave.v2", game: "woodrail.game.v1" };

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
