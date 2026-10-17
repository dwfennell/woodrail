import { describe, expect, it } from "vitest";
import { PropStore } from "../props/store";
import { Layout } from "../track";
import { leversNear, pointsWay, trackDistance, WHISTLE_EVERY, WHISTLE_POST, WHISTLE_REACH, WhistleCalls, whistlePieces, WhistlePosts } from "./lineside";

/** Three straights end to end along +x from the origin (0–216, 216–432, 432–648), and a fourth far off. */
function track() {
  const layout = new Layout();
  const ids = [0, 216, 432].map((x) => layout.addPiece("straight-216", { x, z: 0, heading: 0 }));
  const far = layout.addPiece("straight-216", { x: 0, z: 2000, heading: 0 });
  return { layout, ids, far };
}

describe("whistle posts", () => {
  it("near track is the pieces whose line comes within 150 mm of a post", () => {
    const { layout, ids, far } = track();
    const props = new PropStore();
    // Beside the second straight, 120 mm off its line: it and no other (the others' nearest ends are further).
    props.add(WHISTLE_POST, { x: 330, z: 120, heading: 0, y: 0 });
    expect(trackDistance(layout, ids[1], 330, 120)).toBeCloseTo(120, 0);
    const near = whistlePieces(layout, props);
    expect([...near]).toEqual([ids[1]]);
    expect(near.has(far)).toBe(false);
    // At a joint, both pieces meeting there.
    props.add(WHISTLE_POST, { x: 432, z: -60, heading: 0, y: 0 });
    expect([...whistlePieces(layout, props)].sort()).toEqual([ids[1], ids[2]].sort());
    // Too far: nothing.
    const off = new PropStore();
    off.add(WHISTLE_POST, { x: 330, z: WHISTLE_REACH + 30, heading: 0, y: 0 });
    expect(whistlePieces(layout, off).size).toBe(0);
  });

  it("are worked out again only when the props or the track change", () => {
    const { layout, ids } = track();
    const props = new PropStore();
    const posts = new WhistlePosts();
    posts.sync(layout, props, 1);
    expect(posts.size).toBe(0);
    props.add(WHISTLE_POST, { x: 100, z: 50, heading: 0, y: 0 });
    posts.sync(layout, props, 1);
    expect(posts.has(ids[0])).toBe(true);
    // The track changes (the first straight taken up), but the version doesn't say so: not looked at.
    layout.removePiece(ids[0]);
    posts.sync(layout, props, 1);
    expect(posts.has(ids[0])).toBe(true);
    posts.sync(layout, props, 2);
    expect(posts.has(ids[0])).toBe(false);
  });
});

describe("whistle calls", () => {
  const alive = () => true;

  it("in a frame, the loudest engine (nearest the camera) whistles, at its own volume and pan", () => {
    const calls = new WhistleCalls();
    const heard: [number, number][] = [];
    const play = (v: number, pan: number) => (heard.push([v, pan]), true);
    calls.offer(1, 0.2, -0.5, 0); // far, to the left
    calls.offer(2, 0.9, 0.1, 0); // near
    calls.offer(3, 0.4, 0.3, 0);
    calls.flush(0, play, alive);
    expect(heard).toEqual([[0.9, 0.1]]);
    // Nothing offered: nothing played.
    calls.flush(16, play, alive);
    expect(heard.length).toBe(1);
  });

  it("a train whistles once as it passes; one not heard may whistle at its next joint", () => {
    const calls = new WhistleCalls();
    let heard = 0;
    const play = () => (heard++, true);
    calls.offer(2, 0.9, 0, 0);
    calls.offer(1, 0.2, 0, 0);
    calls.flush(0, play, alive);
    // Train 2 just whistled: its next joint by the post is quiet; train 1 (drowned out) whistles now.
    const vols: number[] = [];
    calls.offer(2, 0.95, 0, 300);
    calls.offer(1, 0.25, 0, 300);
    calls.flush(300, (v) => (vols.push(v), true), alive);
    expect(vols).toEqual([0.25]);
    // After 4 s, train 2 may whistle again (at the next post).
    calls.offer(2, 0.5, 0, WHISTLE_EVERY + 1);
    calls.flush(WHISTLE_EVERY + 1, play, alive);
    expect(heard).toBe(2);
    // The audio turned one down (another louder whistle just played): not held back.
    calls.offer(3, 0.3, 0, 5000);
    calls.flush(5000, () => false, alive);
    calls.offer(3, 0.3, 0, 5100);
    calls.flush(5100, play, alive);
    expect(heard).toBe(3);
  });
});

describe("signal box and lever frame", () => {
  it("list the points and signals within 400 mm, nearest first, and say which way points are set", () => {
    const layout = new Layout();
    const sw = layout.addPiece("switch", { x: 0, z: 0, heading: 0 });
    const sig = layout.addPiece("signal", { x: 300, z: 0, heading: 0 });
    layout.addPiece("straight-216", { x: 0, z: 100, heading: 0 });
    const farSwitch = layout.addPiece("switch", { x: 1500, z: 0, heading: 0 });
    const levers = leversNear(layout, 250, 60);
    expect(levers.map((l) => [l.pieceId, l.kind])).toEqual([
      [sig, "signal"],
      [sw, "points"],
    ]);
    expect(levers.some((l) => l.pieceId === farSwitch)).toBe(false);
    expect(pointsWay(layout, sw)).toBe("straight");
    layout.setSwitchState(sw, 1);
    expect(["left", "right"]).toContain(pointsWay(layout, sw));
  });
});
