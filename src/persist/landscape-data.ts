import { err, ok, type Result } from "../lib/result";
import { fitLaneRoads, pieceOf } from "../roads";
import {
  FEAT_BUILDING,
  FEAT_DEPOT,
  FEAT_FIELD,
  FEAT_RUIN,
  FEAT_SECRET,
  FEAT_SHED,
  FEAT_STATION,
  LandscapeGrid,
  MAX_HEIGHT,
  PLOT_CELLS,
  SURF_LANE,
  SURF_RIVER,
  SURF_SAND,
  SURF_ROAD,
  type Landscape,
} from "../landscape";

/**
 * The landscape as saved: every plot's squares and everything standing on them. Saves never regenerate land, so a
 * world loads exactly as it was (and scenery edits, when there are any, are saved with it). Only land not yet owned
 * comes from the seed.
 */

export type { LandscapeData } from "./landscape-schema";
import type { LandscapeData } from "./landscape-schema";

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

/**
 * Each grid's plots as last encoded: per plot, a copy of each of its byte arrays and that array's base64. An autosave
 * every few seconds encodes again only the arrays whose bytes changed (a byte compare, not a version: nothing relies
 * on every edit having called `touch`). Measured on a 28-plot Sandbox map: 9.6 ms a save to 0.4 ms (desktop).
 */
const encoded = new WeakMap<LandscapeGrid, { bytes: Uint8Array; code: string }[][]>();

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  if (a.byteOffset % 4 === 0 && b.byteOffset % 4 === 0 && a.length % 4 === 0) {
    const x = new Int32Array(a.buffer, a.byteOffset, a.length / 4);
    const y = new Int32Array(b.buffer, b.byteOffset, b.length / 4);
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
    return true;
  }
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** The base64 of a plot's byte array (`k`: which of its arrays), reused while its bytes are as last encoded. */
function plotCode(g: LandscapeGrid, slot: number, k: number, bytes: Uint8Array): string {
  let byGrid = encoded.get(g);
  if (!byGrid) encoded.set(g, (byGrid = []));
  const plot = (byGrid[slot] ??= []);
  const last = plot[k];
  if (last && sameBytes(last.bytes, bytes)) return last.code;
  const code = toBase64(bytes);
  plot[k] = { bytes: bytes.slice(), code };
  return code;
}

export function serializeLandscape(land: Landscape): LandscapeData {
  const g = land.grid;
  return {
    seed: land.seed,
    starter: land.starter,
    nextBuildingId: land.nextBuildingId,
    ...(land.coast ? { coast: { side: land.coast.side, plot: land.coast.plot } } : {}),
    plots: g.plots.map((p, slot) => {
      const a = slot * PLOT_CELLS;
      const b = a + PLOT_CELLS;
      const owner = g.owner.subarray(a, b);
      return {
        px: p.px,
        pz: p.pz,
        height: plotCode(g, slot, 0, g.height.subarray(a, b)),
        surface: plotCode(g, slot, 1, g.surface.subarray(a, b)),
        feature: plotCode(g, slot, 2, g.feature.subarray(a, b)),
        owner: plotCode(g, slot, 3, new Uint8Array(owner.buffer, owner.byteOffset, owner.byteLength)),
        road: plotCode(g, slot, 4, g.road.subarray(a, b)),
      };
    }),
    towns: land.towns.map((t) => ({ ...t, centre: { ...t.centre }, station: { ...t.station }, cells: [...t.cells], buildings: t.buildings.map((b) => ({ ...b, cells: [...b.cells] })), ...(t.claimed?.length ? { claimed: [...t.claimed] } : {}), ...(t.upgraded ? { upgraded: t.upgraded } : {}) })),
    depots: land.depots.map((d) => ({ ...d, centre: { ...d.centre }, piece: { ...d.piece } })),
    fields: land.fields.map((f) => ({ ...f, cells: [...f.cells] })),
    shed: land.shed ? { ...land.shed, cells: [...land.shed.cells] } : null,
    corridors: [...land.corridors],
    ...(land.sites ? { sites: land.sites.map((s) => ({ ...s, centre: { ...s.centre }, piece: { ...s.piece }, plot: { ...s.plot }, fields: [...s.fields] })) } : {}),
    ...(land.siteless ? { siteless: true } : {}),
    ...(land.secretPlan ? { secretPlan: land.secretPlan.map((p) => ({ ...p })) } : {}),
    ...(land.secrets ? { secrets: land.secrets.map((s) => ({ ...s, piece: { ...s.piece }, plot: { ...s.plot }, ...(s.from ? { from: { ...s.from } } : {}), ...(s.year ? { year: [...s.year] as [number, number] } : {}) })) } : {}),
    ...(land.firstTrain !== undefined ? { firstTrain: land.firstTrain && { ...land.firstTrain } } : {}),
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
      if (height[k] > MAX_HEIGHT || surface[k] > SURF_SAND || feature[k] > FEAT_SECRET) return err(`plot ${p.px},${p.pz} has an unknown square`);
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
        const def = road[k] === 0 ? null : pieceOf(road[k]);
        const fits = !def || (def.overRiver ? surface[k] === SURF_RIVER : surface[k] === SURF_LANE || surface[k] === SURF_ROAD);
        if (road[k] !== 0 && (!def || !fits)) return err(`plot ${p.px},${p.pz} has a road where there can't be one`);
      }
      grid.road.set(road, base);
    }
  }
  // Lanes saved before road pieces get theirs from their neighbours.
  fitLaneRoads(grid);
  const n = grid.cellCount;
  const cellsOk = (list: readonly number[]) => list.every((i) => i < n);
  // Ids are places in their lists.
  if (data.towns.some((t, i) => t.id !== i) || data.depots.some((d, i) => d.id !== i) || data.fields.some((f, i) => f.id !== i) || data.sites?.some((s, i) => s.id !== i) || data.secrets?.some((s, i) => s.id !== i)) return err("landscape ids out of order");
  if (data.sites?.some((s) => s.fields.some((f) => f >= data.fields.length))) return err("a site's field isn't there");
  for (const t of data.towns) if (!cellsOk(t.cells) || t.buildings.some((b) => !cellsOk(b.cells) || b.id >= data.nextBuildingId)) return err(`town ${t.id} has a bad square`);
  // A removed field keeps its place in the list (ids are places), with no squares.
  for (const f of data.fields) if ((f.cells.length !== 4 && f.cells.length !== 0) || !cellsOk(f.cells)) return err(`field ${f.id} has a bad square`);
  if (data.shed && (data.shed.cells.length !== 4 || !cellsOk(data.shed.cells))) return err("the shed has a bad square");
  if (!cellsOk(data.corridors)) return err("a corridor has a bad square");
  // Every owner points at something that exists.
  const limit: Record<number, number> = { [FEAT_STATION]: data.towns.length, [FEAT_DEPOT]: data.depots.length, [FEAT_FIELD]: data.fields.length, [FEAT_BUILDING]: data.nextBuildingId, [FEAT_RUIN]: data.sites?.length ?? 0, [FEAT_SECRET]: data.secrets?.length ?? 0 };
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
    coast: data.coast ? { ...data.coast, seed: data.seed } : null,
    ...(data.sites ? { sites: data.sites } : {}),
    ...(data.siteless ? { siteless: true } : {}),
    ...(data.secretPlan ? { secretPlan: data.secretPlan } : {}),
    ...(data.secrets ? { secrets: data.secrets.map((s) => ({ ...s, from: s.from ? Object.fromEntries(Object.entries(s.from).map(([k, v]) => [Number(k), v])) : undefined, year: s.year as [number, number] | undefined })) } : {}),
    ...(data.firstTrain !== undefined ? { firstTrain: data.firstTrain } : {}),
  });
}
