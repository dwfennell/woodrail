import { z } from "zod";
import { err, ok, type Result } from "../lib/result";
import { fitLaneRoads, pieceOf } from "../roads";
import {
  FEAT_BUILDING,
  FEAT_DEPOT,
  FEAT_FIELD,
  FEAT_SHED,
  FEAT_STATION,
  FIELD_STOCK,
  LandscapeGrid,
  MAX_HEIGHT,
  PLOT_CELLS,
  SURF_LANE,
  SURF_ROAD,
  type Landscape,
} from "../landscape";

/**
 * The landscape as saved: every plot's squares and everything standing on them. Saves never regenerate land, so a
 * world loads exactly as it was (and scenery edits, when there are any, are saved with it). Only land not yet owned
 * comes from the seed.
 */

const point = z.object({ x: z.number().finite(), z: z.number().finite() });
const pose = z.object({ x: z.number().finite(), z: z.number().finite(), heading: z.number().finite() });
const cells = z.array(z.number().int().min(0));
const id = z.number().int().min(0);

export const landscapeSchema = z.object({
  seed: z.number().int(),
  starter: z.boolean(),
  nextBuildingId: id,
  plots: z.array(
    z.object({
      px: z.number().int().min(-30000).max(30000),
      pz: z.number().int().min(-30000).max(30000),
      /** Base64 of the plot's squares, row-major: one byte each. */
      height: z.string(),
      surface: z.string(),
      feature: z.string(),
      /** Base64 of the owner ids (little-endian int32 per square). */
      owner: z.string(),
      /** Base64 of the road piece on each square (`grid.road`); missing in saves from before road pieces. */
      road: z.string().optional(),
    }),
  ).min(1),
  towns: z.array(
    z.object({
      id,
      name: z.string().max(80),
      centre: point,
      station: pose,
      cells,
      buildings: z.array(
        z.object({
          id,
          cells,
          floors: z.union([z.literal(1), z.literal(2)]),
          kind: z.enum(["house", "shop"]),
          roof: z.number().int().min(0).max(15),
          front: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]).optional(),
        }),
      ),
    }),
  ),
  depots: z.array(z.object({ id, kind: z.enum(["forest", "sawmill"]), centre: point, piece: pose })),
  fields: z.array(z.object({ id, cells, animal: z.enum(FIELD_STOCK) })),
  shed: z.object({ cells, x: z.number().finite(), z: z.number().finite(), heading: z.number().finite() }).nullable(),
  corridors: cells,
});

export type LandscapeData = z.infer<typeof landscapeSchema>;

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(s: string): Uint8Array | null {
  try {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

export function serializeLandscape(land: Landscape): LandscapeData {
  const g = land.grid;
  return {
    seed: land.seed,
    starter: land.starter,
    nextBuildingId: land.nextBuildingId,
    plots: g.plots.map((p, slot) => {
      const a = slot * PLOT_CELLS;
      const b = a + PLOT_CELLS;
      const owner = g.owner.slice(a, b);
      return {
        px: p.px,
        pz: p.pz,
        height: toBase64(g.height.subarray(a, b)),
        surface: toBase64(g.surface.subarray(a, b)),
        feature: toBase64(g.feature.subarray(a, b)),
        owner: toBase64(new Uint8Array(owner.buffer, owner.byteOffset, owner.byteLength)),
        road: toBase64(g.road.subarray(a, b)),
      };
    }),
    towns: land.towns.map((t) => ({ ...t, centre: { ...t.centre }, station: { ...t.station }, cells: [...t.cells], buildings: t.buildings.map((b) => ({ ...b, cells: [...b.cells] })) })),
    depots: land.depots.map((d) => ({ ...d, centre: { ...d.centre }, piece: { ...d.piece } })),
    fields: land.fields.map((f) => ({ ...f, cells: [...f.cells] })),
    shed: land.shed ? { ...land.shed, cells: [...land.shed.cells] } : null,
    corridors: [...land.corridors],
  };
}

/** Rebuild a landscape from saved data, checking that it hangs together. Never throws. */
export function deserializeLandscape(data: LandscapeData): Result<Landscape, string> {
  const grid = new LandscapeGrid();
  for (const p of data.plots) {
    if (grid.hasPlot(p.px, p.pz)) return err(`plot ${p.px},${p.pz} saved twice`);
    const slot = grid.addPlot(p.px, p.pz);
    const height = fromBase64(p.height);
    const surface = fromBase64(p.surface);
    const feature = fromBase64(p.feature);
    const ownerBytes = fromBase64(p.owner);
    if (!height || !surface || !feature || !ownerBytes) return err(`plot ${p.px},${p.pz} isn't valid base64`);
    if (height.length !== PLOT_CELLS || surface.length !== PLOT_CELLS || feature.length !== PLOT_CELLS || ownerBytes.length !== PLOT_CELLS * 4) {
      return err(`plot ${p.px},${p.pz} has the wrong number of squares`);
    }
    const owner = new Int32Array(ownerBytes.buffer, 0, PLOT_CELLS);
    const base = slot * PLOT_CELLS;
    for (let k = 0; k < PLOT_CELLS; k++) {
      if (height[k] > MAX_HEIGHT || surface[k] > SURF_LANE || feature[k] > FEAT_DEPOT) return err(`plot ${p.px},${p.pz} has an unknown square`);
    }
    grid.height.set(height, base);
    grid.surface.set(surface, base);
    grid.feature.set(feature, base);
    grid.owner.set(owner, base);
    if (p.road !== undefined) {
      const road = fromBase64(p.road);
      if (!road || road.length !== PLOT_CELLS) return err(`plot ${p.px},${p.pz} has bad roads`);
      for (let k = 0; k < PLOT_CELLS; k++) {
        // Roads are laid on lanes (the player's) and town streets.
        if (road[k] !== 0 && (!pieceOf(road[k]) || (surface[k] !== SURF_LANE && surface[k] !== SURF_ROAD))) return err(`plot ${p.px},${p.pz} has a road where there can't be one`);
      }
      grid.road.set(road, base);
    }
  }
  // Lanes saved before road pieces get theirs from their neighbours.
  fitLaneRoads(grid);
  const n = grid.cellCount;
  const cellsOk = (list: readonly number[]) => list.every((i) => i < n);
  // Ids are places in their lists.
  if (data.towns.some((t, i) => t.id !== i) || data.depots.some((d, i) => d.id !== i) || data.fields.some((f, i) => f.id !== i)) return err("landscape ids out of order");
  for (const t of data.towns) if (!cellsOk(t.cells) || t.buildings.some((b) => !cellsOk(b.cells) || b.id >= data.nextBuildingId)) return err(`town ${t.id} has a bad square`);
  // A removed field keeps its place in the list (ids are places), with no squares.
  for (const f of data.fields) if ((f.cells.length !== 4 && f.cells.length !== 0) || !cellsOk(f.cells)) return err(`field ${f.id} has a bad square`);
  if (data.shed && (data.shed.cells.length !== 4 || !cellsOk(data.shed.cells))) return err("the shed has a bad square");
  if (!cellsOk(data.corridors)) return err("a corridor has a bad square");
  // Every owner points at something that exists.
  const limit: Record<number, number> = { [FEAT_STATION]: data.towns.length, [FEAT_DEPOT]: data.depots.length, [FEAT_FIELD]: data.fields.length, [FEAT_BUILDING]: data.nextBuildingId };
  for (let i = 0; i < n; i++) {
    const f = grid.feature[i];
    const o = grid.owner[i];
    if (f in limit && (o < 0 || o >= limit[f])) return err("a square belongs to something that isn't there");
    if (f === FEAT_SHED && !data.shed) return err("a shed square without a shed");
  }
  return ok({
    seed: data.seed,
    starter: data.starter,
    grid,
    towns: data.towns,
    depots: data.depots,
    fields: data.fields,
    shed: data.shed,
    corridors: data.corridors,
    nextBuildingId: data.nextBuildingId,
  });
}
