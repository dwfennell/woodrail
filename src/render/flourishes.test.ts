import { describe, expect, it } from "vitest";
import { Object3D } from "three";
import { Flourishes, settle, turn, wobbleBack, type Flourish } from "./flourishes";

const pose = (x: number, y: number, z: number, heading: number) => ({ x, y, z, heading });

function run(f: Flourishes, seconds: number, dt = 1 / 60): void {
  for (let t = 0; t < seconds; t += dt) f.update(dt);
}

describe("Flourishes", () => {
  it("drops finished flourishes and disposes them", () => {
    const f = new Flourishes();
    let disposed = 0;
    const once: Flourish = { update: () => false, dispose: () => disposed++ };
    f.add(once);
    f.update(1 / 60);
    expect(f.count).toBe(0);
    expect(disposed).toBe(1);
  });

  it("clear() disposes everything still running", () => {
    const f = new Flourishes();
    let disposed = 0;
    for (let i = 0; i < 3; i++) f.add({ update: () => true, dispose: () => disposed++ });
    f.clear();
    expect(f.count).toBe(0);
    expect(disposed).toBe(3);
  });
});

describe("settle", () => {
  it("lands exactly on the target pose within half a second, with a small bounce", () => {
    const obj = new Object3D();
    let done = false;
    const f = new Flourishes();
    f.add(settle(obj, pose(0, 12, 0, 0), pose(50, 0, 20, 0.5), () => (done = true)));
    let lowest = Infinity;
    for (let t = 0; t < 0.5; t += 1 / 60) {
      f.update(1 / 60);
      if (!done) lowest = Math.min(lowest, obj.position.y);
    }
    expect(done).toBe(true);
    expect(obj.position.x).toBe(50);
    expect(obj.position.y).toBe(0);
    expect(obj.position.z).toBe(20);
    expect(obj.rotation.y).toBeCloseTo(-0.5, 9);
    expect(lowest).toBeLessThan(0);
    expect(lowest).toBeGreaterThan(-3);
  });
});

describe("wobbleBack", () => {
  it("ends at the origin pose", () => {
    const obj = new Object3D();
    let done = false;
    const f = new Flourishes();
    f.add(wobbleBack(obj, pose(100, 10, 0, 0), pose(0, 0, 0, Math.PI / 2), () => (done = true)));
    run(f, 1.2);
    expect(done).toBe(true);
    expect(obj.position.x).toBe(0);
    expect(obj.rotation.y).toBeCloseTo(-Math.PI / 2, 9);
  });
});

describe("turn", () => {
  it("rotates the short way and ends exactly on the new heading", () => {
    const obj = new Object3D();
    const f = new Flourishes();
    let maxDelta = 0;
    f.add(turn(obj, pose(0, 0, 0, 0.1), pose(0, 0, 0, Math.PI * 2 - 0.1), () => {}));
    for (let t = 0; t < 0.4; t += 1 / 60) {
      f.update(1 / 60);
      // Wrapped angular distance from the start heading.
      maxDelta = Math.max(maxDelta, Math.acos(Math.cos(-obj.rotation.y - 0.1)));
    }
    expect(maxDelta).toBeLessThan(0.21);
    expect(Math.cos(-obj.rotation.y - (Math.PI * 2 - 0.1))).toBeCloseTo(1, 9);
  });
});

describe("Flourishes chaining", () => {
  it("a flourish chained from one being cleared is finished too", () => {
    const f = new Flourishes();
    let chainedDisposed = false;
    f.add({ update: () => true, dispose: () => f.add({ update: () => true, dispose: () => (chainedDisposed = true) }) });
    f.clear();
    expect(chainedDisposed).toBe(true);
    expect(f.count).toBe(0);
  });
});
