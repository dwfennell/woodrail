import { FEAT_FIELD, FEAT_NONE, FEAT_TREE, SURF_GRASS, type FieldStock, type Landscape } from "../landscape";
import { plotSlotOf, type LandEditor } from "../landscape/edit";

/**
 * Fields you plant (Game mode, with coins, from a farm yard's card): a 2 × 2 paddock of crops on open grass near the
 * yard, so it has more to harvest. Fields are the map's own kind (`Landscape.fields`), drawn and moved like them.
 */

/** Coins for the next field you plant: dearer the more you have planted. */
export function fieldPrice(planted: number): number {
  return 40 + 20 * planted;
}

/**
 * The open 2 × 2 of grass nearest `near` (within `reach` mm of it, measured to the field's middle) where a field may
 * go: level, clear of track, props and stations' ways in, every town and depot still reachable (trees are felled).
 * Its four squares, row-major from the top-left, or null.
 */
export function fieldSpot(land: Landscape, editor: LandEditor, near: { x: number; z: number }, reach: number): number[] | null {
  const g = land.grid;
  const col0 = g.colAt(near.x);
  const row0 = g.rowAt(near.z);
  const r = Math.ceil(reach / 72) + 1;
  const spots: { cells: number[]; d: number }[] = [];
  for (let dr = -r; dr <= r; dr++) {
    for (let dc = -r; dc <= r; dc++) {
      const cells = [g.index(col0 + dc, row0 + dr), g.index(col0 + dc + 1, row0 + dr), g.index(col0 + dc, row0 + dr + 1), g.index(col0 + dc + 1, row0 + dr + 1)];
      if (cells.some((i) => i === -1 || g.surface[i] !== SURF_GRASS || (g.feature[i] !== FEAT_NONE && g.feature[i] !== FEAT_TREE))) continue;
      // The field's middle is the corner its four squares share.
      const x = g.centreX(col0 + dc) + 36;
      const z = g.centreZ(row0 + dr) + 36;
      const d = Math.hypot(x - near.x, z - near.z);
      if (d <= reach) spots.push({ cells, d });
    }
  }
  spots.sort((a, b) => a.d - b.d);
  for (const s of spots) if (editor.checkLot(s.cells) === null) return s.cells;
  return null;
}

/** Plant a field of `stock` on these four squares (felling any trees). Returns the plot slots changed. */
export function plantField(land: Landscape, cells: readonly number[], stock: FieldStock = "crops"): number[] {
  const g = land.grid;
  const id = land.fields.length;
  for (const i of cells) {
    g.feature[i] = FEAT_FIELD;
    g.owner[i] = id;
  }
  land.fields.push({ id, cells: [...cells], animal: stock });
  const slots = [...new Set(cells.map(plotSlotOf))];
  for (const s of slots) g.touch(s);
  return slots;
}
