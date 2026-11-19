import { describe, expect, it } from "vitest";
import { appendPiece, connectorRef, getPieceDef, Layout, type PieceTypeId } from "../track";
import { chain, loopOn } from "../economy/loop-fixtures";
import { next } from "./graph";
import { shuttleLine } from "./scenarios";
import { buildTrain, judgeStretch, search, snapOf, stretchOf, withDetours, type Snap } from "./stretch";
import { loadBugMap } from "../play/bugmap";
import complex3 from "../play/bugmaps/reference/complex-3.txt?raw";
import type { Elem } from "./oracle";

const S: PieceTypeId = "straight-216";
const STOP: PieceTypeId = "depot-forest";
const BUFFER: PieceTypeId = "buffer-turnback";

/** The elems of a train on `ids` (tail first, front last), each piece entered from the one before. */
function along(layout: Layout, ids: number[]): Elem[] {
  const conn = (a: number, b: number) => {
    const def = getPieceDef(layout.getPiece(a)!.type, layout.getPiece(a)!.flipped);
    for (let c = 0; c < def.connectors.length; c++) if (next(layout, a, c)?.pieceId === b) return c;
    throw new Error(`${a} doesn't join ${b}`);
  };
  return ids.map((p, i) => {
    const ex = i + 1 < ids.length ? conn(p, ids[i + 1]) : -1;
    const en = i > 0 ? conn(p, ids[i - 1]) : -1;
    const def = getPieceDef(layout.getPiece(p)!.type, layout.getPiece(p)!.flipped);
    const path = def.paths.find((q) => (en < 0 || q.from === en || q.to === en) && (ex < 0 || q.from === ex || q.to === ex))!;
    const other = (c: number) => (path.from === c ? path.to! : path.from);
    return { p, en: en >= 0 ? en : other(ex), ex: ex >= 0 ? ex : other(en) };
  });
}

const snap = (layout: Layout, key: number, ids: number[], stops: number[] | null, length = 400): Snap => ({ key, elems: along(layout, ids), length, stops, next: 0, at: false, lever: true, speed: 0 });

/** `⊐ A ══ ══ (loop) ══ ══ B ⊏`, the loop's roads two straights (432 mm) and curve, straight, curve. */
function lineWithLoop(layout: Layout) {
  const [a, w1, w2] = chain(layout, [STOP, S, S]);
  appendPiece(layout, BUFFER, false, connectorRef(a, 0));
  const loop = loopOn(layout, connectorRef(w2, 1), [S, S], [S]);
  const [e1, e2, b] = chain(layout, [S, S, STOP], connectorRef(loop.s2, 0));
  appendPiece(layout, BUFFER, false, connectorRef(b, 1));
  return { a, b, w1, w2, e1, e2, loop };
}

describe("the per-stretch search (dispatcher spec §5)", () => {
  it("a lone train on a line delivers", () => {
    const layout = new Layout();
    const ids = shuttleLine(layout, 6);
    const j = judgeStretch(layout, [snap(layout, 1, [ids[1], ids[2]], [ids[7], ids[0]])], 1, [], 1000, true, 2)!;
    expect(j.value).toBe(1);
    expect(j.of).toBe(1);
  });

  it("two trains head on, no loop: neither gets by (layout), and no back-up helps", () => {
    const layout = new Layout();
    const ids = shuttleLine(layout, 6);
    const snaps = [snap(layout, 1, [ids[1], ids[2]], [ids[7], ids[0]]), snap(layout, 2, [ids[6], ids[5]], [ids[0], ids[7]])];
    const j = judgeStretch(layout, snaps, 1, [], 10_000, true, 1)!;
    expect(j.trains).toBe(2);
    expect(j.of).toBe(2);
    expect(j.value).toBe(0);
    expect(j.backUp?.value ?? 0).toBe(0);
  });

  it("two trains head on with a passing loop: they pass, one on each road", () => {
    const layout = new Layout();
    const l = lineWithLoop(layout);
    const snaps = [snap(layout, 1, [l.a, l.w1], [l.b, l.a]), snap(layout, 2, [l.b, l.e2], [l.a, l.b])];
    const ts = snaps.map((s) => buildTrain(layout, s, 1));
    // (Each has the loop's other road.)
    expect(ts[0].pos.length).toBeGreaterThan(ts[0].main);
    const r = search(ts, stretchOf(ts, 0), { cap: 10_000 });
    expect(r.value).toBe(2);
    expect(r.capped).toBe(false);
  });

  it("a stand-off only a back-up frees: a train over the points backs off them, the other turns in, both deliver", () => {
    // ⊐ A ══ ══ ══ ╪ points ══ ══ C ⊏, the points' other road ( ══ ══ B ⊏. Train 1 on the A side heading for B; train 2
    // put down with its nose over the points heading for A. No order works; train 2 backing a piece frees the points.
    const layout = new Layout();
    const [a, s1, s2, s3] = chain(layout, [STOP, S, S, S]);
    appendPiece(layout, BUFFER, false, connectorRef(a, 0));
    const sw = appendPiece(layout, "switch", false, connectorRef(s3, 1));
    const [m1, m2, c] = chain(layout, [S, S, STOP], connectorRef(sw, 1));
    appendPiece(layout, BUFFER, false, connectorRef(c, 1));
    const [, , , b] = chain(layout, ["curve-large", S, S, STOP], connectorRef(sw, 2), [true]);
    appendPiece(layout, BUFFER, false, connectorRef(b, 1));
    const snaps = [snap(layout, 1, [s1, s2, s3], [b, a]), snap(layout, 2, [m2, m1, sw], [a, c], 300)];
    const j = judgeStretch(layout, snaps, 1, [], 10_000, true, 1)!;
    expect(j.of).toBe(2);
    expect(j.value).toBe(0);
    expect(j.backUp).toEqual({ value: 2, by: 2 });
  });

  it("followers round an oval: both deliver", () => {
    const layout = new Layout();
    const C: PieceTypeId = "curve-large";
    const ids = chain(layout, [STOP, S, S, C, C, C, C, STOP, S, S, C, C, C, C]);
    const a = ids[0];
    const b = ids[7];
    const snaps = [snap(layout, 1, [ids[1], ids[2]], [b, a]), snap(layout, 2, [ids[8], ids[9]], [a, b])];
    const j = judgeStretch(layout, snaps, 1, [], 10_000, true, 2)!;
    expect(j.value).toBe(2);
  });

  it("save 3's stand-off (complex map, Bluebell and Wren nose to nose at points 94): no order, but Bluebell's detour frees both", async () => {
    const { world } = await loadBugMap(complex3);
    const snaps = snapOf(world.layout, world.sim, world.economy);
    const ts = snaps.map((s) => buildTrain(world.layout, s));
    const k = ts.findIndex((t) => world.sim.nameOf(t.key) === "Bluebell");
    const members = stretchOf(ts, k);
    expect(members.map((i) => world.sim.nameOf(ts[i].key)).sort()).toEqual(["Bluebell", "Wren"]);
    const plain = search(ts, members, { backUps: true });
    expect(plain.value).toBe(0);
    const dt = withDetours(world.layout, snaps, ts, members)!;
    const r = search(dt, members, {});
    expect(r.plain).toBe(0);
    expect(r.detourValue).toBe(2);
    // (Bluebell goes first, round by its detour.)
    expect(r.order[0].k).toBe(0);
    expect(dt[k].detour[r.order[0].to]).toBe(1);
  });
});
