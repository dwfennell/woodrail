import type { Editor } from "../editor/editor";
import type { World } from "../game/world";
import { checkPlacement, checkSupport } from "../landscape";
import { appendPiece, connectorRef, findLowCrossing, findOverlap, getPieceDef, type Layout, type PieceTypeId } from "../track";
import type { Blocked } from "./player";

/** The game's placement rules for a piece on this map (what the tray's drag checks), for simulated players. */
export function rulesFor(w: World): Blocked {
  return (type, flipped, pose, y, ignoreId) => {
    const c = checkPlacement(w.landscape, type, flipped, pose, y);
    if (c.kind === "blocked") return c.reason;
    if (findOverlap(w.layout, type, flipped, pose, y, ignoreId) !== -1) return "piece";
    if (findLowCrossing(w.layout, type, flipped, pose, y, ignoreId) !== -1) return "headroom";
    if (checkSupport(w.landscape, w.layout, type, flipped, pose, y, ignoreId).kind === "unsupported") return "unsupported";
    return null;
  };
}

/**
 * Put `type` on free end `ref` (seated by an end of the other kind) through the Editor, if the rules allow. Returns the
 * new piece's id and its other free end (−1 for a buffer), or why it can't go.
 */
export function layOn(w: World, editor: Editor, ref: number, type: PieceTypeId, flipped = false): { id: number; next: number } | { why: string } {
  const layout: Layout = w.layout;
  const end = layout.worldConnector(ref, { x: 0, z: 0, heading: 0, y: 0, kind: "peg" });
  const def = getPieceDef(type, flipped);
  const via = def.connectors.findIndex((c) => c.kind !== end.kind);
  if (via === -1) return { why: `no ${end.kind === "peg" ? "hole" : "peg"} end` };
  const tmp = appendPiece(layout, type, flipped, ref, via);
  const p = layout.getPiece(tmp)!;
  const pose = { ...p.pose };
  const y = p.y;
  const why = rulesFor(w)(type, flipped, pose, y, tmp);
  layout.removePiece(tmp);
  if (why) return { why };
  const id = editor.place(type, pose, y, flipped);
  const other = def.connectors.findIndex((_, k) => k !== via);
  return { id, next: other === -1 ? -1 : connectorRef(id, other) };
}

/** Put a buffer (or turnback) on free end `ref`, flipped if that end is a hole: a player turns it over to fit. */
export function endOn(w: World, editor: Editor, ref: number, type: PieceTypeId = "buffer-turnback"): { id: number; next: number } | { why: string } {
  const r = layOn(w, editor, ref, type);
  return "why" in r ? layOn(w, editor, ref, type, true) : r;
}
