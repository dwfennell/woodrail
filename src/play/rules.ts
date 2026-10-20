import type { Editor } from "../editor/editor";
import { guideSchool } from "../game/goals";
import { schoolOf, siteWhy } from "../game/industries";
import { syncIndustries, type World } from "../game/world";
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
 * Put `type` on free end `ref` through the Editor, if the rules allow: seated by an end of the other kind where it has
 * one, else its first (any two ends join). Returns the new piece's id and its other free end (−1 for a buffer), or why
 * it can't go.
 */
export function layOn(w: World, editor: Editor, ref: number, type: PieceTypeId, flipped = false): { id: number; next: number } | { why: string } {
  const layout: Layout = w.layout;
  const end = layout.worldConnector(ref, { x: 0, z: 0, heading: 0, y: 0, kind: "peg" });
  const def = getPieceDef(type, flipped);
  if (def.connectors.length === 0) return { why: "no end to join by" };
  const unlike = def.connectors.findIndex((c) => c.kind !== end.kind);
  const via = unlike === -1 ? 0 : unlike;
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

/**
 * Drop the school where Game mode's Show me points (`guideSchool`: a straight of the line beside a town, the way round
 * its yard fits), spliced in for that straight as the drop does, if the rules and its site rule allow. Returns its
 * piece's id, or why not (everything put back).
 */
export function schoolOn(w: World, editor: Editor, fixed: ReadonlySet<number>): number | { why: string } {
  const guide = guideSchool(w);
  const spot = guide.held ? guide.marks[0] : undefined;
  if (!spot) return { why: "no spot beside a town" };
  const straight = [...w.layout.pieceIds()].find((id) => {
    const p = w.layout.getPiece(id)!;
    return p.type === "straight-216" && !fixed.has(id) && Math.hypot(p.pose.x + 108 * Math.cos(p.pose.heading) - spot.x, p.pose.z + 108 * Math.sin(p.pose.heading) - spot.z) < 2 && !w.sim.pieceOccupied(id);
  });
  if (straight === undefined) return { why: "its straight is taken" };
  const p = w.layout.getPiece(straight)!;
  const was = { pose: { ...p.pose }, y: p.y, flipped: p.flipped };
  const h = guide.held!.heading;
  const pose = { x: spot.x - 108 * Math.cos(h), z: spot.z - 108 * Math.sin(h), heading: h };
  editor.remove(straight);
  const id = editor.place("depot-school", pose, was.y, false);
  if (rulesFor(w)("depot-school", false, pose, was.y, id) || siteWhy(w.landscape, "depot-school", pose, (t) => schoolOf(w, t, (x) => x === id))) {
    editor.remove(id);
    editor.place("straight-216", was.pose, was.y, was.flipped);
    return { why: "it won't go where its guide points" };
  }
  syncIndustries(w, true);
  return id;
}

/** Put a buffer (or turnback) on free end `ref` (flipped only if it won't go as it is). */
export function endOn(w: World, editor: Editor, ref: number, type: PieceTypeId = "buffer-turnback"): { id: number; next: number } | { why: string } {
  const r = layOn(w, editor, ref, type);
  return "why" in r ? layOn(w, editor, ref, type, true) : r;
}
