import { describe, expect, it } from "vitest";
import { poseForCentre } from "../editor/editor";
import { connectorRef, findSnap, findSnapAhead, findSnapAtPoint, getPieceDef, AHEAD_SLACK, halfSpan, keepTurning, Layout, SNAP_CAPTURE_RADIUS, WAIT_AHEAD, waitAhead, type PieceTypeId, type SnapResult } from "../track";
import { transformPose, type Pose } from "../track/math";
import { TRACK_ITEMS } from "../ui/tray-catalogue";

/** As `Interaction`'s TAP_REACH: a waiting piece seats on a free end this far (mm) from where it's shown. */
const TAP_REACH = 27;

/**
 * The next ready piece waiting at a free end (`Interaction.previewNextAt`), worked out as a held piece is (`updateDrag`,
 * on the ground level): shown `waitAhead` beyond the end, held at `heading`; a free end under it (a tap's reach), else
 * by its ends, else ahead of an end on its line (`findSnapAhead`); then turned on as a curve it meets (`keepTurning`).
 */
function waiting(layout: Layout, type: PieceTypeId, flipped: boolean, end: number, heading: number): SnapResult {
  const t = layout.worldConnector(end, { x: 0, z: 0, y: 0, heading: 0, kind: "socket" });
  const d = waitAhead(type, flipped);
  const at = { x: t.x + d * Math.cos(t.heading), z: t.z + d * Math.sin(t.heading) };
  const held = poseForCentre(type, flipped, at.x, at.z, heading);
  let s = findSnapAtPoint(layout, type, flipped, held, 0, at, -2, TAP_REACH);
  if (s.kind !== "snapped") s = findSnap(layout, type, flipped, held, 0, -2, SNAP_CAPTURE_RADIUS);
  if (s.kind !== "snapped") s = findSnapAhead(layout, type, flipped, held, 0, at, -2);
  return keepTurning(layout, type, flipped, heading, s, false) ?? s;
}

/** Is the seated piece's end `connector` on the end `ref` (joined there, facing it)? */
function seatedOn(layout: Layout, s: SnapResult, ref: number, type: PieceTypeId): boolean {
  if (s.kind !== "snapped" || s.target !== ref) return false;
  const t = layout.worldConnector(ref, { x: 0, z: 0, y: 0, heading: 0, kind: "socket" });
  const c: Pose = { x: 0, z: 0, heading: 0 };
  transformPose(s.pose, getPieceDef(type, s.flipped).connectors[s.connector].pose, c);
  const turn = Math.abs(Math.atan2(Math.sin(c.heading - t.heading - Math.PI), Math.cos(c.heading - t.heading - Math.PI)));
  return Math.hypot(c.x - t.x, c.z - t.z) < 0.01 && turn < 1e-6;
}

const EIGHTHS = Array.from({ length: 8 }, (_, k) => (k * Math.PI) / 4);
// The tray's plain track that runs on from an end (two ends, one track): what waits at the end of the last one laid.
const PLAIN = [...new Set(TRACK_ITEMS.flatMap((i) => (i.kind === "piece" && !i.auto ? [i.type] : [])))].filter((t) => {
  const d = getPieceDef(t, false);
  return d.connectors.length === 2 && d.paths.length === 1 && d.connectors.every((c) => c.y === 0);
});

describe("the next piece waiting at a free end (the user: a tight curve waited loose, unjoined, by the station)", () => {
  it("waits within its own reach ahead of the end: 60 mm, or a short piece where its middle seats", () => {
    expect(waitAhead("curve-small", false)).toBeCloseTo(90 * Math.sin(Math.PI / 8), 6);
    expect(waitAhead("curve-small", true)).toBeCloseTo(90 * Math.sin(Math.PI / 8), 6);
    expect(waitAhead("straight-54", false)).toBe(27);
    // Longer pieces wait where they always did.
    for (const t of ["straight-108", "straight-144", "straight-216", "curve-large", "curve-wide"] as const) expect(waitAhead(t, false), t).toBe(WAIT_AHEAD);
    for (const t of PLAIN) expect(waitAhead(t, false), t).toBeLessThan(halfSpan(t, false) + AHEAD_SLACK);
  });

  it("the tight curve and every plain tray piece seat on the end, either hand, the end any of 8 ways, held any of 8 ways", () => {
    const missed: string[] = [];
    expect(PLAIN).toContain("curve-small");
    expect(PLAIN).toContain("straight-54");
    for (const type of PLAIN)
      for (const flipped of [false, true])
        for (const h of EIGHTHS)
          for (const held of EIGHTHS) {
            const layout = new Layout();
            const a = layout.addPiece("straight-216", { x: 0, z: 0, heading: h });
            const s = waiting(layout, type, flipped, connectorRef(a, 1), h + held);
            if (!seatedOn(layout, s, connectorRef(a, 1), type)) missed.push(`${type} ${flipped ? "R" : "L"} end ${Math.round((h * 180) / Math.PI)}° held +${Math.round((held * 180) / Math.PI)}°`);
          }
    expect(missed).toEqual([]);
  });

  it("the user's map: the next tight curve at the station curve's open end turns on round to meet the line across", () => {
    // (Pieces 102 and 99 of the user's map, as saved: the station's tight curve R, its socket open heading -135°; the
    // curve from the bridge, its peg open 180 mm off, heading 90°.)
    const layout = new Layout();
    const station = layout.addPiece("curve-small", { x: 872.4, z: 873.6, heading: Math.PI / 4 }, 0, true);
    const end = connectorRef(station, 0);
    for (const flipped of [false, true])
      for (const held of EIGHTHS) {
        const s = waiting(layout, "curve-small", flipped, end, held);
        expect(seatedOn(layout, s, end, "curve-small"), `${flipped ? "R" : "L"} held ${Math.round((held * 180) / Math.PI)}°`).toBe(true);
        if (s.kind !== "snapped") continue;
        // Turned on round (no S-bend): its free end heads -90°, 64 mm on, in line with the other curve's end.
        const def = getPieceDef("curve-small", s.flipped);
        const c: Pose = { x: 0, z: 0, heading: 0 };
        transformPose(s.pose, def.connectors[1 - s.connector].pose, c);
        expect(Math.cos(c.heading + Math.PI / 2)).toBeCloseTo(1, 6);
        expect(c.x).toBeCloseTo(846, 0);
        expect(c.z).toBeCloseTo(810, 0);
      }
  });
});
