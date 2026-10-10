/** Easing curves, exponential damping and springs for UI and scene animation. Allocation free. */

const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);

export function easeOutCubic(t: number): number {
  const u = 1 - clamp01(t);
  return 1 - u * u * u;
}

export function easeInOutCubic(t: number): number {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

/** Ease out with a small overshoot past 1 before settling. */
export function easeOutBack(t: number, overshoot = 1.4): number {
  const x = clamp01(t) - 1;
  return 1 + (overshoot + 1) * x * x * x + overshoot * x * x;
}

/** Move `current` toward `target` by exponential decay at rate `lambda` (1/s); the same result at any frame rate. */
export function damp(current: number, target: number, lambda: number, dt: number): number {
  return target + (current - target) * Math.exp(-lambda * dt);
}

const MAX_SUBSTEP = 1 / 120;

/** A 1D damped spring (unit mass). Damping 2·√stiffness is critical: no overshoot. */
export class Spring {
  value = 0;
  velocity = 0;

  constructor(
    public stiffness: number,
    public damping: number,
  ) {}

  /** Advance toward `target` by `dt` seconds (sub-stepped for stability). Returns the new value. */
  step(target: number, dt: number): number {
    let left = dt;
    while (left > 1e-9) {
      const h = Math.min(left, MAX_SUBSTEP);
      const accel = this.stiffness * (target - this.value) - this.damping * this.velocity;
      this.velocity += accel * h;
      this.value += this.velocity * h;
      left -= h;
    }
    return this.value;
  }

  settled(target: number, eps = 1e-3): boolean {
    return Math.abs(target - this.value) < eps && Math.abs(this.velocity) < eps * 10;
  }

  /** Jump to a value at rest. */
  reset(value: number): void {
    this.value = value;
    this.velocity = 0;
  }
}
