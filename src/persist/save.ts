import { z } from "zod";
import { err, ok, type Result } from "../lib/result";
import { CAR_KINDS, Sim, type CarKind } from "../sim";
import { Layout, PIECE_TYPES, type PieceTypeId } from "../track";

/**
 * Save format, version 1. Plain JSON validated with Zod; only this module knows its shape.
 * (The spec's zip container with binary chunks arrives when there is binary data to store.)
 */
export const SAVE_VERSION = 1;

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
  pieces: z.array(pieceSchema),
  switches: z.array(z.tuple([z.number().int(), z.number().int().min(0).max(1)])),
  trains: z.array(trainSchema),
});

export type SaveData = z.infer<typeof saveSchema>;

export function serializeWorld(layout: Layout, sim: Sim): SaveData {
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
      cars: t.cars.map((c) => ({ kind: c.kind, facing: c.facing, lever: c.lever })),
      lead: { ...t.bogies[0] },
    };
  });
  return { version: SAVE_VERSION, pieces, switches, trains };
}

/** Rebuild a world from saved data. Never throws on bad input. */
export function deserializeWorld(data: unknown): Result<{ layout: Layout; sim: Sim }, string> {
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
  const sim = new Sim(layout);
  for (const t of save.trains) {
    if (!layout.getPiece(t.lead.pieceId)) continue;
    const placed = sim.addTrain(
      t.cars.map((c) => c.kind),
      t.lead,
    );
    if (placed.kind !== "placed") continue;
    const train = sim.getTrain(placed.trainId)!;
    train.cars.forEach((car, i) => {
      if (t.cars[i].facing === -1) sim.flipCar(car.id);
      if (car.kind === "engine") sim.setLever(car.id, t.cars[i].lever);
    });
  }
  return ok({ layout, sim });
}

const STORAGE_KEY = "woodrail.autosave.v1";

export function saveToStorage(layout: Layout, sim: Sim): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeWorld(layout, sim)));
    return true;
  } catch {
    return false;
  }
}

export function loadFromStorage(): Result<{ layout: Layout; sim: Sim }, string> | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
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
