import { describe, expect, it } from "vitest";
import { appendPiece, connectorRef, Layout } from "../track";
import { ADV_BUFFER, ADV_OK, ADV_OPEN_END, advanceCursor, createAdvance, createWorldSample, cursorWorld, flipCursor, type Cursor } from "./cursor";

function line(...types: Parameters<typeof appendPiece>[1][]): { layout: Layout; ids: number[] } {
  const layout = new Layout();
  const ids = [layout.addPiece(types[0], { x: 0, z: 0, heading: 0 })];
  for (const t of types.slice(1)) ids.push(appendPiece(layout, t, false, connectorRef(ids[ids.length - 1], 1)));
  return { layout, ids };
}

describe("advanceCursor", () => {
  it("moves along a path and into the next piece", () => {
    const { layout, ids } = line("straight-144", "straight-144");
    const c: Cursor = { pieceId: ids[0], pathIndex: 0, reversed: false, s: 100 };
    const r = advanceCursor(layout, c, 60, null, createAdvance());
    expect(r.status).toBe(ADV_OK);
    expect(r.moved).toBeCloseTo(60);
    expect(c.pieceId).toBe(ids[1]);
    expect(c.s).toBeCloseTo(16);
  });

  it("stops at an open end and reports it", () => {
    const { layout, ids } = line("straight-144");
    const c: Cursor = { pieceId: ids[0], pathIndex: 0, reversed: false, s: 100 };
    const r = advanceCursor(layout, c, 60, null, createAdvance());
    expect(r.status).toBe(ADV_OPEN_END);
    expect(r.moved).toBeCloseTo(44);
    expect(c.s).toBeCloseTo(144);
  });

  it("stops at a buffer", () => {
    const { layout, ids } = line("straight-144", "buffer");
    const c: Cursor = { pieceId: ids[0], pathIndex: 0, reversed: false, s: 140 };
    const r = advanceCursor(layout, c, 100, null, createAdvance());
    expect(r.status).toBe(ADV_BUFFER);
    expect(r.moved).toBeCloseTo(58);
    expect(c.pieceId).toBe(ids[1]);
  });

  it("travels backward through reversed paths", () => {
    const { layout, ids } = line("straight-144", "straight-144");
    const c: Cursor = { pieceId: ids[1], pathIndex: 0, reversed: true, s: 100 }; // at x = 144 + 44
    advanceCursor(layout, c, 60, null, createAdvance());
    expect(c.pieceId).toBe(ids[0]);
    const w = cursorWorld(layout, c, createWorldSample());
    expect(w.x).toBeCloseTo(128);
    expect(Math.cos(w.heading)).toBeCloseTo(-1);
  });

  it("remembers a switch choice so following bogies take the same branch", () => {
    const { layout, ids } = line("straight-144", "switch");
    const sw = ids[1];
    const memory = new Map<number, { path: number; remaining: number }>();
    const lead: Cursor = { pieceId: ids[0], pathIndex: 0, reversed: false, s: 140 };
    const follow: Cursor = { pieceId: ids[0], pathIndex: 0, reversed: false, s: 100 };
    layout.setSwitchState(sw, 1);
    advanceCursor(layout, lead, 10, memory, createAdvance(), 2);
    layout.setSwitchState(sw, 0); // flipped while the train is on it
    advanceCursor(layout, follow, 50, memory, createAdvance(), 2);
    expect(lead.pathIndex).toBe(1);
    expect(follow.pathIndex).toBe(1);
    expect(memory.size).toBe(0);
  });
});

describe("flipCursor and cursorWorld", () => {
  it("flipping keeps the world position and reverses heading", () => {
    const { layout, ids } = line("curve-large");
    const c: Cursor = { pieceId: ids[0], pathIndex: 0, reversed: false, s: 50 };
    const a = { ...cursorWorld(layout, c, createWorldSample()) };
    flipCursor(layout, c);
    const b = cursorWorld(layout, c, createWorldSample());
    expect(b.x).toBeCloseTo(a.x);
    expect(b.z).toBeCloseTo(a.z);
    expect(Math.cos(b.heading - a.heading)).toBeCloseTo(-1);
  });

  it("reports slope positive uphill in the direction of travel, plus piece height", () => {
    const { layout, ids } = line("ramp");
    const up: Cursor = { pieceId: ids[0], pathIndex: 0, reversed: false, s: 108 };
    const w = cursorWorld(layout, up, createWorldSample());
    expect(w.slope).toBeGreaterThan(0);
    expect(w.y).toBeCloseTo(32);
    flipCursor(layout, up);
    expect(cursorWorld(layout, up, createWorldSample()).slope).toBeLessThan(0);
  });
});
