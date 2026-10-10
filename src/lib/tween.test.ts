import { describe, expect, it } from "vitest";
import { damp, easeInOutCubic, easeOutBack, easeOutCubic, Spring } from "./tween";

describe("eases", () => {
  it("start at 0, end at 1 and clamp outside", () => {
    for (const f of [easeOutCubic, easeInOutCubic, (t: number) => easeOutBack(t)]) {
      expect(f(0)).toBeCloseTo(0, 9);
      expect(f(1)).toBeCloseTo(1, 9);
      expect(f(-1)).toBeCloseTo(0, 9);
      expect(f(2)).toBeCloseTo(1, 9);
    }
  });

  it("easeOutBack overshoots a little", () => {
    let peak = 0;
    for (let i = 0; i <= 1000; i++) peak = Math.max(peak, easeOutBack(i / 1000));
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThan(1.12);
  });
});

describe("damp", () => {
  it("is frame-rate independent", () => {
    const one = damp(0, 10, 8, 1 / 30);
    const two = damp(damp(0, 10, 8, 1 / 60), 10, 8, 1 / 60);
    expect(one).toBeCloseTo(two, 9);
  });
});

describe("Spring", () => {
  const run = (s: Spring, target: number, seconds: number, dt = 1 / 60) => {
    let peak = -Infinity;
    let settledAt = -1;
    for (let t = 0; t < seconds; t += dt) {
      s.step(target, dt);
      peak = Math.max(peak, s.value);
      if (settledAt < 0 && s.settled(target, 0.002)) settledAt = t;
      if (settledAt >= 0 && !s.settled(target, 0.002)) settledAt = -1;
    }
    return { peak, settledAt };
  };

  it("underdamped: small overshoot, settles quickly", () => {
    const { peak, settledAt } = run(new Spring(600, 30), 1, 2);
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThan(1.15);
    expect(settledAt).toBeGreaterThanOrEqual(0);
    expect(settledAt).toBeLessThan(0.6);
  });

  it("critically damped never overshoots", () => {
    const k = 400;
    const { peak } = run(new Spring(k, 2 * Math.sqrt(k)), 1, 2);
    expect(peak).toBeLessThanOrEqual(1 + 1e-9);
  });

  it("is stable with a large frame step", () => {
    const s = new Spring(600, 18);
    for (let i = 0; i < 20; i++) s.step(1, 0.1);
    expect(s.value).toBeCloseTo(1, 3);
  });
});
