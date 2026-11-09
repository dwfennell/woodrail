import { describe, expect, it } from "vitest";
import { Layout } from "../track";
import { BookingTable } from "./bookings";

describe("the booking table: holds by (piece, path)", () => {
  const layout = new Layout();
  const plain = layout.addPiece("straight-216", { x: 0, z: 0, heading: 0 });
  const dbl = layout.addPiece("double-straight", { x: 500, z: 0, heading: 0 });
  const sw = layout.addPiece("switch", { x: 1000, z: 0, heading: 0 });
  const dia = layout.addPiece("crossing", { x: 1500, z: 0, heading: 0 });

  it("a free piece has no blocker; one held by another train does", () => {
    const t = new BookingTable(layout);
    expect(t.blocker(plain, 1, 7)).toBe(-1);
    t.hold(plain, 3, 1, "ahead");
    expect(t.blocker(plain, 1, 7)).toBe(3);
    expect(t.blocker(plain, 1, 3)).toBe(-1);
    expect(t.heldByOther(plain, 7)).toBe(true);
    expect(t.heldByOther(plain, 3)).toBe(false);
  });

  it("double track: the two roads are held apart", () => {
    const t = new BookingTable(layout);
    t.hold(dbl, 3, 0b01, "under");
    expect(t.blocker(dbl, 0b10, 7)).toBe(-1);
    expect(t.blocker(dbl, 0b01, 7)).toBe(3);
  });

  it("a switch's roads and a diamond's lines foul each other", () => {
    const t = new BookingTable(layout);
    t.hold(sw, 3, 0b01, "ahead");
    expect(t.blocker(sw, 0b10, 7)).toBe(3);
    t.hold(dia, 3, 0b01, "under");
    expect(t.blocker(dia, 0b10, 7)).toBe(3);
  });

  it("by kind, release and release all", () => {
    const t = new BookingTable(layout);
    t.hold(plain, 3, 1, "under");
    t.hold(sw, 3, 1, "ahead");
    expect(t.blocker(plain, 1, 7, "ahead")).toBe(-1);
    expect(t.blocker(plain, 1, 7, "under")).toBe(3);
    expect([...t.piecesOf(3)].sort()).toEqual([plain, sw].sort());
    const v = t.version;
    t.release(sw, 3);
    expect(t.version).toBeGreaterThan(v);
    expect(t.blocker(sw, 1, 7)).toBe(-1);
    t.releaseAll(3);
    expect(t.blocker(plain, 1, 7)).toBe(-1);
    expect(t.piecesOf(3).size).toBe(0);
    t.hold(plain, 3, 1, "under");
    t.clear();
    expect(t.holdsOn(plain)).toEqual([]);
  });

  // (A mutation run found these rules unchecked: docs/agents/audit-2026-11-09.md §7.)
  it("a train's holds of one kind on a piece merge; of another kind, or another train's, stand apart", () => {
    const t = new BookingTable(layout);
    t.hold(dbl, 3, 0b01, "ahead");
    const v = t.version;
    t.hold(dbl, 3, 0b01, "ahead");
    expect(t.version, "nothing new: no change").toBe(v);
    t.hold(dbl, 3, 0b10, "ahead");
    expect(t.holdsOn(dbl)).toEqual([{ key: 3, mask: 0b11, kind: "ahead" }]);
    t.hold(dbl, 3, 0b01, "under");
    t.hold(dbl, 4, 0b01, "ahead");
    expect(t.holdsOn(dbl)).toEqual([
      { key: 3, mask: 0b11, kind: "ahead" },
      { key: 3, mask: 0b01, kind: "under" },
      { key: 4, mask: 0b01, kind: "ahead" },
    ]);
  });

  it("giving back one kind keeps the other; the piece is the train's till both are gone, and others' holds stay", () => {
    const t = new BookingTable(layout);
    t.hold(sw, 3, 0b01, "under");
    t.hold(sw, 3, 0b01, "ahead");
    t.hold(sw, 4, 0b10, "ahead");
    t.release(sw, 3, "ahead");
    expect(t.holdsOn(sw)).toEqual([{ key: 3, mask: 0b01, kind: "under" }, { key: 4, mask: 0b10, kind: "ahead" }]);
    expect(t.piecesOf(3).has(sw)).toBe(true);
    t.release(sw, 3, "under");
    expect(t.piecesOf(3).has(sw)).toBe(false);
    expect(t.holdsOn(sw)).toEqual([{ key: 4, mask: 0b10, kind: "ahead" }]);
    t.release(sw, 4);
    expect(t.holdsOn(sw)).toEqual([]);
    expect(t.heldByOther(sw, 3)).toBe(false);
  });

  it("release all of one kind keeps a train's other holds; all of them, and it holds nothing", () => {
    const t = new BookingTable(layout);
    t.hold(plain, 3, 1, "under");
    t.hold(sw, 3, 1, "ahead");
    t.releaseAll(3, "ahead");
    expect([...t.piecesOf(3)]).toEqual([plain]);
    expect(t.blocker(sw, 1, 7)).toBe(-1);
    expect(t.blocker(plain, 1, 7)).toBe(3);
    t.releaseAll(3);
    expect(t.piecesOf(3).size).toBe(0);
    expect(t.holdsOn(plain)).toEqual([]);
  });

  it("held by another: yes beside the train's own hold; a piece not on the layout blocks no one", () => {
    const t = new BookingTable(layout);
    t.hold(dbl, 3, 0b01, "under");
    t.hold(dbl, 4, 0b10, "under");
    expect(t.heldByOther(dbl, 3)).toBe(true);
    expect(t.heldByOther(dbl, 4)).toBe(true);
    expect(t.heldByOther(dbl, 5)).toBe(true);
    t.hold(999_999, 4, 1, "under");
    expect(t.blocker(999_999, 1, 3)).toBe(-1);
  });
});
