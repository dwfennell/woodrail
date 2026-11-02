import type { CargoKind } from "../economy";

/** Goods a hopper carries as a heap in its bin (cargo.ts: a hopper takes grain, stone, coal and ore; never flour). */
export const HEAP_KINDS = ["grain", "stone", "coal", "ore"] as const;
export type HeapKind = (typeof HEAP_KINDS)[number];
export const isHeap = (k: CargoKind | null): k is HeapKind => (HEAP_KINDS as readonly string[]).includes(k ?? "");

/**
 * The hopper's bin (car-local y, tools/blender/trains.py `hopper`): its inside floor, and where a full heap's base sits
 * (level with the rim, where the modelled coal's bed was). The heap mounds (dressing.py, 59 x 25, 6.5 to 8 high) fill
 * the bin's opening, so a heap sunk below the rim reads as a part-filled bin.
 */
export const HOPPER_FLOOR = 26.5;
export const HOPPER_HEAP = 43;

/** How a hopper shows its load: no heap when empty, else a heap of its goods sunk into the bin by how full it is. */
export interface HopperLook {
  heap: HeapKind;
  /** 0 to 1, in steps of one unit of the wagon's capacity. */
  fill: number;
  /** Car-local y of the heap's base. */
  y: number;
}

/**
 * The look of a hopper carrying `count` of `kind`, with room for `capacity`: null (an empty, open bin) when it carries
 * nothing or something it doesn't heap. Pure, and a few ops: the view calls it as the car's load is drawn.
 */
export function hopperLook(kind: CargoKind | null, count: number, capacity: number): HopperLook | null {
  if (!isHeap(kind) || count <= 0) return null;
  const fill = Math.min(1, count / Math.max(1, capacity));
  return { heap: kind, fill, y: HOPPER_FLOOR + (HOPPER_HEAP - HOPPER_FLOOR) * fill };
}

/**
 * Each heap's colour (the stand-in mound's, and grain's over its model's: the modelled grain, #e2b84a, is the bin's own
 * yellow, #e6b52c, and a part-filled bin of it read as empty). Coal black, ore rusty, stone grey, grain a deeper gold.
 */
export const HEAP_COLORS: Readonly<Record<HeapKind, string>> = { grain: "#bf8530", stone: "#8e8a82", coal: "#2a2b2e", ore: "#9a4f2c" };

/** The heaps' mound (dressing.py's `load_grain_heap` profile: radius, height), for a lathe 59 x 25 and `height` high. */
export const HEAP_PROFILE: readonly (readonly [number, number])[] = [[0, 0], [1, 0], [0.98, 0.18], [0.9, 0.42], [0.74, 0.68], [0.52, 0.86], [0.26, 0.97], [0, 1]];
