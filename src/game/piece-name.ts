import type { PieceTypeId } from "../track";
import { TRACK_ITEMS } from "../ui/tray-catalogue";

/** A piece's name as the tray shows it, in lower case and for many ("long pieces", "curves", "switches"): "Out of …". */
export function pieceName(type: PieceTypeId): string {
  const item = TRACK_ITEMS.find((i) => i.kind === "piece" && i.type === type && !i.auto);
  // (Lower case but for a letter that's a name of its own: "Y switches", "45° crossings".)
  const name = (item?.label ?? type).replace(/^([A-Z])(?=[a-z])/, (c) => c.toLowerCase()).replace(/ ([A-Z])(?=[a-z])/g, (_, c: string) => " " + c.toLowerCase());
  // "Out of switches", "Out of Y switches", "Out of crossings", "Out of curves"; a straight by its size: "long pieces".
  if (/switch$/.test(name)) return name + "es";
  if (/(curve|crossing|three-way|bridge|ramp|buffer|turnback|riser|loop|wye|crossover|signal)$/.test(name)) return name + "s";
  return name + " pieces";
}
