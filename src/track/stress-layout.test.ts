import { describe, expect, it } from "vitest";
import { buildStressLayout } from "./stress-layout";

describe("buildStressLayout", () => {
  it("builds closed ovals plus one loose straight each", () => {
    const { layout, looseSockets } = buildStressLayout(20);
    expect(layout.pieceCount).toBe(20 * 11);
    expect(layout.jointCount).toBe(20 * 10);
    expect(looseSockets).toHaveLength(20);
    for (const ref of looseSockets) expect(layout.joinedConnector(ref)).toBe(-1);
  });

  it("is deterministic", () => {
    const a = buildStressLayout(5).layout;
    const b = buildStressLayout(5).layout;
    expect([...a.pieceIds()].map((id) => a.getPiece(id))).toEqual([...b.pieceIds()].map((id) => b.getPiece(id)));
  });
});
