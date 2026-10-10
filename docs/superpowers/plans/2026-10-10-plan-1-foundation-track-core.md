# Plan 1: Foundation & Track Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold the Woodrail project and build the pure-TypeScript track core: piece catalog with real dimensions, closed-form path geometry, layout with peg/socket seating and joint play, drag snapping, switch-aware routing, and performance benchmarks.

**Architecture:** `src/track/` is pure TypeScript with no Three.js or DOM imports, testable in Node with Vitest. Pieces are data records (connectors + parametric paths). A `Layout` owns placed pieces, seated joints and a spatial hash of free connectors. Hot-path functions write into caller-supplied output objects instead of allocating.

**Tech Stack:** TypeScript (strict), Vite, Vitest (tests + `vitest bench`), npm, Node ≥ 22.

**Spec:** `docs/superpowers/specs/2026-10-10-core-sandbox-design.md` (§3, §3.1, §3.2, §4, §10, §11, §12)

**Series context:** This is plan 1 of 7 for milestone 1. Later plans: 2 trains & sim, 3 rendering, 4 interaction & UI, 5 derail physics, 6 persistence, 7 hardening (CI perf gating, Playwright E2E, device tuning).

## Global Constraints

- Units: millimetres for length, radians internally for angles. Plan-view coordinates are `(x, z)` on the floor; `y` is height. `heading` is measured from +x toward +z, so direction = `(cos h, sin h)`. (The renderer in plan 3 converts: `object.rotation.y = -heading`.)
- `src/track/` must not import Three.js, the DOM, Zod, or `src/lib/result.ts`.
- Hot-path functions (`samplePath`, `transformPose`, spatial hash queries, `routeFrom`) must not allocate; they write into caller-provided `out` objects/arrays.
- No exceptions for control flow. Expected outcomes are discriminated unions or numeric/boolean codes. Throwing is reserved for invariant violations (programming bugs).
- Joint play: position tolerance **±1.5 mm**, angle tolerance **±2°**; tunable constants in `src/track/constants.ts`.
- Track dimensions: 40 mm wide, 12 mm thick, grooves ~6 mm wide at ~26 mm spacing; straights 54/108/144/216 mm; large curve ~182 mm radius, small curve ~90 mm radius, 45° each.
- Code style: TypeScript strict, ES modules, tests colocated as `*.test.ts`.

## Review Focus

1. **Placing a piece onto an already-joined connector** — expected: no triple joins; a joined connector is never a seating or snapping candidate. (Test in Task 5.)
2. **Heading wrap-around at ±π** — a piece at heading `π` and one at `-π` are the same orientation; seating must succeed across the wrap. (Test in Task 5.)
3. **Removing a piece from the middle of a loop** — expected: its neighbours' connectors become free again and can be snapped to. (Test in Task 5.)
4. **Flipped switch routing** — a flipped switch's branch curves the other way, and switch state still selects straight (0) vs branch (1). (Test in Task 7.)
5. **Layouts at negative coordinates far from the origin** — spatial hashing must work identically in all quadrants. (Test in Task 4.)

---

## File Structure

```
package.json, tsconfig.json, vite.config.ts, index.html, .gitignore
src/main.ts                    Placeholder app entry (replaced in plan 3)
src/lib/result.ts              Result<T, E> for fallible edges (used from plan 5 on)
src/track/constants.ts         All tunable dimensions and tolerances
src/track/math.ts              Pose, angle normalisation, pose transforms
src/track/path.ts              PathGeom (line/arc + height), length, closed-form sampling
src/track/pieces.ts            Piece definition types, catalog, mirroring (flip)
src/track/spatial-hash.ts      Uniform-grid hash of numeric item ids
src/track/layout.ts            Layout: placed pieces, seating, joints, switch states
src/track/snap.ts              findSnap (drag snapping), appendPiece (exact chaining)
src/track/routing.ts           routeFrom (connector → next path), pathExitConnector
src/track/stress-layout.ts     Deterministic large layout for benches/device tests
src/track/index.ts             Public API barrel
bench/track.bench.ts           Vitest benchmarks
```

---

### Task 1: Project scaffold and Result type

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `.gitignore`, `src/main.ts`, `src/lib/result.ts`
- Test: `src/lib/result.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `Result<T, E>`, `ok(value)`, `err(error)` from `src/lib/result.ts`; npm scripts `dev`, `build`, `typecheck`, `test`, `bench`.

- [ ] **Step 1: Initialise the package and install tooling**

```bash
cd /Users/dustin/src/woodrail
npm init -y
npm pkg set name=woodrail private=true type=module
npm pkg set scripts.dev="vite" scripts.build="tsc --noEmit && vite build" scripts.typecheck="tsc --noEmit" scripts.test="vitest run" scripts.bench="vitest bench --run"
npm pkg delete main
npm install -D typescript vite vitest
```

- [ ] **Step 2: Write config files**

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src", "bench", "vite.config.ts"]
}
```

`vite.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    benchmark: { include: ["bench/**/*.bench.ts"] },
  },
});
```

`index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <title>Woodrail</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

`src/main.ts`:

```ts
const app = document.querySelector<HTMLDivElement>("#app");
if (app) app.textContent = "Woodrail";
```

`.gitignore`:

```
node_modules
dist
*.local
```

- [ ] **Step 3: Write the failing test**

`src/lib/result.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { err, ok, type Result } from "./result";

describe("Result", () => {
  it("ok carries a value", () => {
    const r: Result<number, string> = ok(3);
    expect(r).toEqual({ ok: true, value: 3 });
  });

  it("err carries an error", () => {
    const r: Result<number, string> = err("bad");
    expect(r).toEqual({ ok: false, error: "bad" });
  });

  it("narrows on the ok flag", () => {
    const r: Result<number, string> = ok(2);
    const doubled = r.ok ? r.value * 2 : 0;
    expect(doubled).toBe(4);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot resolve `./result`.

- [ ] **Step 5: Implement**

`src/lib/result.ts`:

```ts
/** Outcome of an operation that can fail in expected ways (file I/O, storage, asset loading). Not for hot paths. */
export type Result<T, E> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });
```

- [ ] **Step 6: Verify tests, typecheck and build pass**

Run: `npm test && npm run typecheck && npm run build`
Expected: 3 tests pass; typecheck and build succeed.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.json vite.config.ts index.html .gitignore src
git commit -m "chore: scaffold Vite + TypeScript + Vitest project with Result type"
```

---

### Task 2: Constants, pose math and path geometry

**Files:**
- Create: `src/track/constants.ts`, `src/track/math.ts`, `src/track/path.ts`
- Test: `src/track/math.test.ts`, `src/track/path.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `constants.ts`: `TRACK_WIDTH, TRACK_THICKNESS, GROOVE_WIDTH, GROOVE_SPACING, PEG_HEAD_DIAMETER, STRAIGHT_LENGTHS, LARGE_CURVE_RADIUS, SMALL_CURVE_RADIUS, CURVE_SWEEP, SWITCH_LENGTH, CROSSING_SIZE, RISER_HEIGHT, RAMP_LENGTH, BRIDGE_LENGTH, BUFFER_LENGTH, ADAPTER_LENGTH, JOINT_POS_TOLERANCE, JOINT_ANGLE_TOLERANCE, SNAP_CAPTURE_RADIUS, SNAP_HEIGHT_TOLERANCE, SPATIAL_CELL_SIZE`
  - `math.ts`: `interface Pose { x: number; z: number; heading: number }`, `TAU`, `normalizeAngle(a): number` (→ `(-π, π]`), `angleDiff(a, b): number` (→ `[0, π]`), `transformPose(parent, local, out): Pose`, `solveParentPose(local, world, out): Pose`
  - `path.ts`: `type PathGeom`, `pathLength(g): number`, `interface PathSample { x; z; y; heading; slope }`, `createSample(): PathSample`, `samplePath(g, s, out): PathSample`

- [ ] **Step 1: Write constants (no test; values are spec data)**

`src/track/constants.ts`:

```ts
// Dimensions in millimetres, based on common wooden-rail standards. Tune against a physical set.
export const TRACK_WIDTH = 40;
export const TRACK_THICKNESS = 12;
export const GROOVE_WIDTH = 6;
export const GROOVE_SPACING = 26; // centre to centre
export const PEG_HEAD_DIAMETER = 12;

export const STRAIGHT_LENGTHS = [54, 108, 144, 216] as const;
export const LARGE_CURVE_RADIUS = 182;
export const SMALL_CURVE_RADIUS = 90;
export const CURVE_SWEEP = Math.PI / 4; // eight curves make a circle

export const SWITCH_LENGTH = 144;
export const CROSSING_SIZE = 144;
export const RISER_HEIGHT = 64;
export const RAMP_LENGTH = 216;
export const BRIDGE_LENGTH = 216;
export const BUFFER_LENGTH = 54;
export const ADAPTER_LENGTH = 54;

// Joint play: how far a peg can be from perfectly seated and still hold.
export const JOINT_POS_TOLERANCE = 1.5;
export const JOINT_ANGLE_TOLERANCE = (2 * Math.PI) / 180;

// Drag snapping: how close a dragged connector must come to a free one to snap.
export const SNAP_CAPTURE_RADIUS = 30;
export const SNAP_HEIGHT_TOLERANCE = RISER_HEIGHT / 2;

export const SPATIAL_CELL_SIZE = 64;
```

- [ ] **Step 2: Write the failing math tests**

`src/track/math.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { angleDiff, normalizeAngle, solveParentPose, transformPose, type Pose } from "./math";

const P = (x: number, z: number, heading: number): Pose => ({ x, z, heading });

describe("normalizeAngle", () => {
  it("maps into (-π, π]", () => {
    expect(normalizeAngle(0)).toBe(0);
    expect(normalizeAngle(Math.PI)).toBeCloseTo(Math.PI);
    expect(normalizeAngle(-Math.PI)).toBeCloseTo(Math.PI);
    expect(normalizeAngle(3 * Math.PI)).toBeCloseTo(Math.PI);
    expect(normalizeAngle(-Math.PI / 2 + 4 * Math.PI)).toBeCloseTo(-Math.PI / 2);
  });
});

describe("angleDiff", () => {
  it("is the smallest absolute difference across the wrap", () => {
    expect(angleDiff(Math.PI - 0.01, -Math.PI + 0.01)).toBeCloseTo(0.02);
    expect(angleDiff(0, Math.PI)).toBeCloseTo(Math.PI);
    expect(angleDiff(0.1, -0.1)).toBeCloseTo(0.2);
  });
});

describe("transformPose", () => {
  it("rotates then translates a local pose", () => {
    const out = P(0, 0, 0);
    transformPose(P(10, 20, Math.PI / 2), P(5, 0, 0), out);
    expect(out.x).toBeCloseTo(10);
    expect(out.z).toBeCloseTo(25);
    expect(out.heading).toBeCloseTo(Math.PI / 2);
  });

  it("returns the out object", () => {
    const out = P(0, 0, 0);
    expect(transformPose(P(0, 0, 0), P(1, 1, 0), out)).toBe(out);
  });
});

describe("solveParentPose", () => {
  it("inverts transformPose", () => {
    const local = P(30, -12, 0.7);
    const world = P(-100, 250, -2.1);
    const parent = solveParentPose(local, world, P(0, 0, 0));
    const back = transformPose(parent, local, P(0, 0, 0));
    expect(back.x).toBeCloseTo(world.x);
    expect(back.z).toBeCloseTo(world.z);
    expect(angleDiff(back.heading, world.heading)).toBeCloseTo(0);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run src/track/math.test.ts`
Expected: FAIL — cannot resolve `./math`.

- [ ] **Step 4: Implement math**

`src/track/math.ts`:

```ts
/** Plan-view pose. heading is measured from +x toward +z; direction = (cos heading, sin heading). */
export interface Pose {
  x: number;
  z: number;
  heading: number;
}

export const TAU = Math.PI * 2;

/** Normalise to (-π, π]. */
export function normalizeAngle(a: number): number {
  let r = a % TAU;
  if (r <= -Math.PI) r += TAU;
  else if (r > Math.PI) r -= TAU;
  return r;
}

/** Smallest absolute angle between a and b, in [0, π]. */
export function angleDiff(a: number, b: number): number {
  return Math.abs(normalizeAngle(a - b));
}

/** World pose of `local` expressed in `parent`'s frame. Writes into and returns `out`. */
export function transformPose(parent: Pose, local: Pose, out: Pose): Pose {
  const c = Math.cos(parent.heading);
  const s = Math.sin(parent.heading);
  const x = parent.x + local.x * c - local.z * s;
  const z = parent.z + local.x * s + local.z * c;
  out.x = x;
  out.z = z;
  out.heading = normalizeAngle(parent.heading + local.heading);
  return out;
}

/** The parent pose for which transformPose(parent, local) === world. Writes into and returns `out`. */
export function solveParentPose(local: Pose, world: Pose, out: Pose): Pose {
  const h = normalizeAngle(world.heading - local.heading);
  const c = Math.cos(h);
  const s = Math.sin(h);
  out.x = world.x - (local.x * c - local.z * s);
  out.z = world.z - (local.x * s + local.z * c);
  out.heading = h;
  return out;
}
```

- [ ] **Step 5: Run math tests**

Run: `npx vitest run src/track/math.test.ts`
Expected: PASS.

- [ ] **Step 6: Write the failing path tests**

`src/track/path.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { angleDiff } from "./math";
import { createSample, pathLength, samplePath, type PathGeom } from "./path";

const line: PathGeom = { kind: "line", start: { x: 10, z: 5, heading: 0 }, length: 100, y0: 0, rise: 0 };
const arcLeft: PathGeom = { kind: "arc", start: { x: 0, z: 0, heading: 0 }, radius: 182, sweep: Math.PI / 4, y0: 0, rise: 0 };
const arcRight: PathGeom = { ...arcLeft, sweep: -Math.PI / 4 };
const ramp: PathGeom = { kind: "line", start: { x: 0, z: 0, heading: 0 }, length: 216, y0: 0, rise: 64 };

describe("pathLength", () => {
  it("is length for lines and radius × |sweep| for arcs", () => {
    expect(pathLength(line)).toBe(100);
    expect(pathLength(arcRight)).toBeCloseTo((182 * Math.PI) / 4);
  });
});

describe("samplePath", () => {
  it("moves along a line", () => {
    const s = samplePath(line, 40, createSample());
    expect(s.x).toBeCloseTo(50);
    expect(s.z).toBeCloseTo(5);
    expect(s.heading).toBeCloseTo(0);
  });

  it("ends a left (positive sweep) arc toward +z", () => {
    const s = samplePath(arcLeft, pathLength(arcLeft), createSample());
    expect(s.x).toBeCloseTo(182 * Math.sin(Math.PI / 4));
    expect(s.z).toBeCloseTo(182 * (1 - Math.cos(Math.PI / 4)));
    expect(angleDiff(s.heading, Math.PI / 4)).toBeCloseTo(0);
  });

  it("mirrors a right (negative sweep) arc toward -z", () => {
    const s = samplePath(arcRight, pathLength(arcRight), createSample());
    expect(s.z).toBeCloseTo(-182 * (1 - Math.cos(Math.PI / 4)));
    expect(angleDiff(s.heading, -Math.PI / 4)).toBeCloseTo(0);
  });

  it("has unit-speed tangent consistent with position on arcs", () => {
    const a = samplePath(arcLeft, 50, createSample());
    const b = samplePath(arcLeft, 50.001, createSample());
    expect((b.x - a.x) / 0.001).toBeCloseTo(Math.cos(a.heading), 3);
    expect((b.z - a.z) / 0.001).toBeCloseTo(Math.sin(a.heading), 3);
  });

  it("eases ramp height with zero slope at both ends", () => {
    const out = createSample();
    expect(samplePath(ramp, 0, out).y).toBeCloseTo(0);
    expect(out.slope).toBeCloseTo(0);
    expect(samplePath(ramp, 108, out).y).toBeCloseTo(32);
    expect(out.slope).toBeCloseTo((64 * 1.5) / 216);
    expect(samplePath(ramp, 216, out).y).toBeCloseTo(64);
    expect(out.slope).toBeCloseTo(0);
  });

  it("clamps distance to the path", () => {
    expect(samplePath(line, -20, createSample()).x).toBeCloseTo(10);
    expect(samplePath(line, 500, createSample()).x).toBeCloseTo(110);
  });
});
```

- [ ] **Step 7: Run to verify failure**

Run: `npx vitest run src/track/path.test.ts`
Expected: FAIL — cannot resolve `./path`.

- [ ] **Step 8: Implement path geometry**

`src/track/path.ts`:

```ts
import { normalizeAngle, type Pose } from "./math";

/**
 * A path through a piece, in piece-local coordinates. Height eases from y0 to y0 + rise
 * along a smoothstep so trains meet ramps without a kink.
 * Arcs: positive sweep turns toward +heading (left), negative toward -heading (right).
 */
export type PathGeom =
  | { readonly kind: "line"; readonly start: Pose; readonly length: number; readonly y0: number; readonly rise: number }
  | {
      readonly kind: "arc";
      readonly start: Pose;
      readonly radius: number;
      readonly sweep: number;
      readonly y0: number;
      readonly rise: number;
    };

export interface PathSample {
  x: number;
  z: number;
  y: number;
  /** Direction of travel for increasing distance. */
  heading: number;
  /** dy/ds — positive is uphill when travelling forward. */
  slope: number;
}

export function createSample(): PathSample {
  return { x: 0, z: 0, y: 0, heading: 0, slope: 0 };
}

export function pathLength(g: PathGeom): number {
  return g.kind === "line" ? g.length : g.radius * Math.abs(g.sweep);
}

/** Closed-form sample at distance s (clamped to [0, length]). Writes into and returns `out`. No allocation. */
export function samplePath(g: PathGeom, s: number, out: PathSample): PathSample {
  const len = pathLength(g);
  const d = s < 0 ? 0 : s > len ? len : s;
  const t = len > 0 ? d / len : 0;
  out.y = g.y0 + g.rise * t * t * (3 - 2 * t);
  out.slope = len > 0 ? (g.rise * 6 * t * (1 - t)) / len : 0;

  const h0 = g.start.heading;
  if (g.kind === "line") {
    out.x = g.start.x + Math.cos(h0) * d;
    out.z = g.start.z + Math.sin(h0) * d;
    out.heading = h0;
    return out;
  }

  const sign = g.sweep >= 0 ? 1 : -1;
  const r = g.radius;
  const cx = g.start.x - sign * r * Math.sin(h0);
  const cz = g.start.z + sign * r * Math.cos(h0);
  const h = h0 + (sign * d) / r;
  out.x = cx + sign * r * Math.sin(h);
  out.z = cz - sign * r * Math.cos(h);
  out.heading = normalizeAngle(h);
  return out;
}
```

- [ ] **Step 9: Run tests**

Run: `npx vitest run src/track`
Expected: PASS (math + path).

- [ ] **Step 10: Commit**

```bash
git add src/track
git commit -m "feat(track): constants, pose math and closed-form path geometry"
```

---

### Task 3: Piece catalog and flipping

**Files:**
- Create: `src/track/pieces.ts`
- Test: `src/track/pieces.test.ts`

**Interfaces:**
- Consumes: `Pose`, `normalizeAngle` (math.ts); `PathGeom` (path.ts); constants.
- Produces:
  - `type ConnectorKind = "peg" | "socket"`
  - `interface ConnectorDef { readonly kind: ConnectorKind; readonly pose: Pose; readonly y: number }` — `pose.heading` points **outward** from the piece
  - `interface PathDef { readonly from: number; readonly to: number | null; readonly geom: PathGeom }` — `to: null` = path ends at a buffer inside the piece
  - `type PieceTypeId = "straight-54" | "straight-108" | "straight-144" | "straight-216" | "curve-large" | "curve-small" | "switch" | "crossing" | "ramp" | "riser" | "bridge" | "buffer" | "adapter-peg" | "adapter-socket"`
  - `interface PieceDef { readonly type: PieceTypeId; readonly connectors: readonly ConnectorDef[]; readonly paths: readonly PathDef[]; readonly flippable: boolean; readonly isSwitch: boolean; readonly supportHeight: number }`
  - `PIECE_TYPES: readonly PieceTypeId[]`
  - `MAX_CONNECTORS = 4`
  - `getPieceDef(type: PieceTypeId, flipped: boolean): PieceDef` (cached; flipping a non-flippable piece returns the unflipped def)

- [ ] **Step 1: Write the failing tests**

`src/track/pieces.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { LARGE_CURVE_RADIUS, RISER_HEIGHT } from "./constants";
import { angleDiff } from "./math";
import { createSample, pathLength, samplePath } from "./path";
import { getPieceDef, MAX_CONNECTORS, PIECE_TYPES } from "./pieces";

const variants = PIECE_TYPES.flatMap((type) => [false, true].map((flipped) => ({ type, flipped })));

describe("piece catalog invariants", () => {
  it.each(variants)("$type flipped=$flipped: paths start and end exactly at their connectors", ({ type, flipped }) => {
    const def = getPieceDef(type, flipped);
    expect(def.connectors.length).toBeLessThanOrEqual(MAX_CONNECTORS);
    for (const p of def.paths) {
      const from = def.connectors[p.from];
      const start = samplePath(p.geom, 0, createSample());
      expect(start.x).toBeCloseTo(from.pose.x, 9);
      expect(start.z).toBeCloseTo(from.pose.z, 9);
      expect(start.y).toBeCloseTo(from.y, 9);
      expect(angleDiff(start.heading, from.pose.heading + Math.PI)).toBeCloseTo(0, 9);
      if (p.to === null) continue;
      const to = def.connectors[p.to];
      const end = samplePath(p.geom, pathLength(p.geom), createSample());
      expect(end.x).toBeCloseTo(to.pose.x, 9);
      expect(end.z).toBeCloseTo(to.pose.z, 9);
      expect(end.y).toBeCloseTo(to.y, 9);
      expect(angleDiff(end.heading, to.pose.heading)).toBeCloseTo(0, 9);
    }
  });
});

describe("specific pieces", () => {
  it("straights have a socket at the origin and a peg at the far end", () => {
    const d = getPieceDef("straight-144", false);
    expect(d.connectors.map((c) => c.kind)).toEqual(["socket", "peg"]);
    expect(d.connectors[1].pose.x).toBe(144);
  });

  it("large curve turns 45° left; flipped turns 45° right", () => {
    const left = getPieceDef("curve-large", false);
    const right = getPieceDef("curve-large", true);
    expect(left.connectors[1].pose.z).toBeCloseTo(LARGE_CURVE_RADIUS * (1 - Math.SQRT1_2));
    expect(right.connectors[1].pose.z).toBeCloseTo(-LARGE_CURVE_RADIUS * (1 - Math.SQRT1_2));
  });

  it("switch has one trunk and two branches, and is a switch", () => {
    const d = getPieceDef("switch", false);
    expect(d.isSwitch).toBe(true);
    expect(d.paths.map((p) => p.from)).toEqual([0, 0]);
    expect(d.paths.map((p) => p.to)).toEqual([1, 2]);
  });

  it("ramp climbs one riser height", () => {
    const d = getPieceDef("ramp", false);
    expect(d.connectors[1].y - d.connectors[0].y).toBe(RISER_HEIGHT);
  });

  it("riser is a support with no track", () => {
    const d = getPieceDef("riser", false);
    expect(d.connectors).toHaveLength(0);
    expect(d.supportHeight).toBe(RISER_HEIGHT);
  });

  it("buffer path ends inside the piece", () => {
    expect(getPieceDef("buffer", false).paths[0].to).toBeNull();
  });

  it("adapters have matching connector kinds at both ends", () => {
    expect(getPieceDef("adapter-peg", false).connectors.map((c) => c.kind)).toEqual(["peg", "peg"]);
    expect(getPieceDef("adapter-socket", false).connectors.map((c) => c.kind)).toEqual(["socket", "socket"]);
  });

  it("returns the same cached object on repeat calls; non-flippable ignores flip", () => {
    expect(getPieceDef("switch", true)).toBe(getPieceDef("switch", true));
    expect(getPieceDef("straight-54", true)).toBe(getPieceDef("straight-54", false));
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/track/pieces.test.ts`
Expected: FAIL — cannot resolve `./pieces`.

- [ ] **Step 3: Implement the catalog**

`src/track/pieces.ts`:

```ts
import {
  ADAPTER_LENGTH,
  BRIDGE_LENGTH,
  BUFFER_LENGTH,
  CROSSING_SIZE,
  CURVE_SWEEP,
  LARGE_CURVE_RADIUS,
  RAMP_LENGTH,
  RISER_HEIGHT,
  SMALL_CURVE_RADIUS,
  SWITCH_LENGTH,
} from "./constants";
import { normalizeAngle, type Pose } from "./math";
import type { PathGeom } from "./path";

export type ConnectorKind = "peg" | "socket";

/** pose.heading points outward from the piece. */
export interface ConnectorDef {
  readonly kind: ConnectorKind;
  readonly pose: Pose;
  readonly y: number;
}

/** to === null means the path ends at a buffer inside the piece. */
export interface PathDef {
  readonly from: number;
  readonly to: number | null;
  readonly geom: PathGeom;
}

export type PieceTypeId =
  | "straight-54"
  | "straight-108"
  | "straight-144"
  | "straight-216"
  | "curve-large"
  | "curve-small"
  | "switch"
  | "crossing"
  | "ramp"
  | "riser"
  | "bridge"
  | "buffer"
  | "adapter-peg"
  | "adapter-socket";

export interface PieceDef {
  readonly type: PieceTypeId;
  readonly connectors: readonly ConnectorDef[];
  readonly paths: readonly PathDef[];
  readonly flippable: boolean;
  readonly isSwitch: boolean;
  /** Height this piece provides to pieces resting on top of it (risers). 0 for track. */
  readonly supportHeight: number;
}

export const MAX_CONNECTORS = 4;

const pose = (x: number, z: number, heading: number): Pose => ({ x, z, heading });

function arcEnd(radius: number, sweep: number): Pose {
  const a = Math.abs(sweep);
  const sign = sweep >= 0 ? 1 : -1;
  return pose(radius * Math.sin(a), sign * radius * (1 - Math.cos(a)), sweep);
}

function straight(
  type: PieceTypeId,
  length: number,
  a: ConnectorKind = "socket",
  b: ConnectorKind = "peg",
  y = 0,
): PieceDef {
  return {
    type,
    connectors: [
      { kind: a, pose: pose(0, 0, Math.PI), y },
      { kind: b, pose: pose(length, 0, 0), y },
    ],
    paths: [{ from: 0, to: 1, geom: { kind: "line", start: pose(0, 0, 0), length, y0: y, rise: 0 } }],
    flippable: false,
    isSwitch: false,
    supportHeight: 0,
  };
}

function curve(type: PieceTypeId, radius: number): PieceDef {
  return {
    type,
    connectors: [
      { kind: "socket", pose: pose(0, 0, Math.PI), y: 0 },
      { kind: "peg", pose: arcEnd(radius, CURVE_SWEEP), y: 0 },
    ],
    paths: [
      { from: 0, to: 1, geom: { kind: "arc", start: pose(0, 0, 0), radius, sweep: CURVE_SWEEP, y0: 0, rise: 0 } },
    ],
    flippable: true,
    isSwitch: false,
    supportHeight: 0,
  };
}

const half = CROSSING_SIZE / 2;

const CATALOG: Record<PieceTypeId, PieceDef> = {
  "straight-54": straight("straight-54", 54),
  "straight-108": straight("straight-108", 108),
  "straight-144": straight("straight-144", 144),
  "straight-216": straight("straight-216", 216),
  "curve-large": curve("curve-large", LARGE_CURVE_RADIUS),
  "curve-small": curve("curve-small", SMALL_CURVE_RADIUS),
  switch: {
    type: "switch",
    connectors: [
      { kind: "socket", pose: pose(0, 0, Math.PI), y: 0 },
      { kind: "peg", pose: pose(SWITCH_LENGTH, 0, 0), y: 0 },
      { kind: "peg", pose: arcEnd(LARGE_CURVE_RADIUS, CURVE_SWEEP), y: 0 },
    ],
    paths: [
      { from: 0, to: 1, geom: { kind: "line", start: pose(0, 0, 0), length: SWITCH_LENGTH, y0: 0, rise: 0 } },
      {
        from: 0,
        to: 2,
        geom: { kind: "arc", start: pose(0, 0, 0), radius: LARGE_CURVE_RADIUS, sweep: CURVE_SWEEP, y0: 0, rise: 0 },
      },
    ],
    flippable: true,
    isSwitch: true,
    supportHeight: 0,
  },
  crossing: {
    type: "crossing",
    connectors: [
      { kind: "socket", pose: pose(0, 0, Math.PI), y: 0 },
      { kind: "peg", pose: pose(CROSSING_SIZE, 0, 0), y: 0 },
      { kind: "socket", pose: pose(half, -half, -Math.PI / 2), y: 0 },
      { kind: "peg", pose: pose(half, half, Math.PI / 2), y: 0 },
    ],
    paths: [
      { from: 0, to: 1, geom: { kind: "line", start: pose(0, 0, 0), length: CROSSING_SIZE, y0: 0, rise: 0 } },
      {
        from: 2,
        to: 3,
        geom: { kind: "line", start: pose(half, -half, Math.PI / 2), length: CROSSING_SIZE, y0: 0, rise: 0 },
      },
    ],
    flippable: false,
    isSwitch: false,
    supportHeight: 0,
  },
  ramp: {
    type: "ramp",
    connectors: [
      { kind: "socket", pose: pose(0, 0, Math.PI), y: 0 },
      { kind: "peg", pose: pose(RAMP_LENGTH, 0, 0), y: RISER_HEIGHT },
    ],
    paths: [
      { from: 0, to: 1, geom: { kind: "line", start: pose(0, 0, 0), length: RAMP_LENGTH, y0: 0, rise: RISER_HEIGHT } },
    ],
    flippable: false,
    isSwitch: false,
    supportHeight: 0,
  },
  riser: { type: "riser", connectors: [], paths: [], flippable: false, isSwitch: false, supportHeight: RISER_HEIGHT },
  bridge: straight("bridge", BRIDGE_LENGTH, "socket", "peg", RISER_HEIGHT),
  buffer: {
    type: "buffer",
    connectors: [{ kind: "socket", pose: pose(0, 0, Math.PI), y: 0 }],
    paths: [{ from: 0, to: null, geom: { kind: "line", start: pose(0, 0, 0), length: BUFFER_LENGTH, y0: 0, rise: 0 } }],
    flippable: false,
    isSwitch: false,
    supportHeight: 0,
  },
  "adapter-peg": straight("adapter-peg", ADAPTER_LENGTH, "peg", "peg"),
  "adapter-socket": straight("adapter-socket", ADAPTER_LENGTH, "socket", "socket"),
};

export const PIECE_TYPES = Object.keys(CATALOG) as readonly PieceTypeId[];

const mirrorPose = (p: Pose): Pose => pose(p.x, -p.z, normalizeAngle(-p.heading));

function mirrorGeom(g: PathGeom): PathGeom {
  return g.kind === "line" ? { ...g, start: mirrorPose(g.start) } : { ...g, start: mirrorPose(g.start), sweep: -g.sweep };
}

function mirror(def: PieceDef): PieceDef {
  return {
    ...def,
    connectors: def.connectors.map((c) => ({ ...c, pose: mirrorPose(c.pose) })),
    paths: def.paths.map((p) => ({ ...p, geom: mirrorGeom(p.geom) })),
  };
}

const flippedCache = new Map<PieceTypeId, PieceDef>();

export function getPieceDef(type: PieceTypeId, flipped: boolean): PieceDef {
  const base = CATALOG[type];
  if (!flipped || !base.flippable) return base;
  let m = flippedCache.get(type);
  if (!m) {
    m = mirror(base);
    flippedCache.set(type, m);
  }
  return m;
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/track/pieces.test.ts`
Expected: PASS (28 invariant cases + specific tests).

- [ ] **Step 5: Commit**

```bash
git add src/track/pieces.ts src/track/pieces.test.ts
git commit -m "feat(track): data-driven piece catalog with flipping"
```

---

### Task 4: Spatial hash

**Files:**
- Create: `src/track/spatial-hash.ts`
- Test: `src/track/spatial-hash.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `class SpatialHash { constructor(cellSize: number); insert(item: number, x: number, z: number): void; remove(item: number): boolean; has(item: number): boolean; get size(): number; query(x: number, z: number, radius: number, out: number[]): number }` — `query` returns **candidates** from every cell overlapping the square of side `2 × radius` (callers filter by exact distance), writes them to `out` (clearing it first) and returns the count.

- [ ] **Step 1: Write the failing tests**

`src/track/spatial-hash.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { SpatialHash } from "./spatial-hash";

describe("SpatialHash", () => {
  it("finds items in nearby cells and not far ones", () => {
    const h = new SpatialHash(64);
    h.insert(1, 10, 10);
    h.insert(2, 70, 10);
    h.insert(3, 1000, 1000);
    const out: number[] = [];
    const n = h.query(30, 10, 45, out);
    expect(out.slice(0, n).sort()).toEqual([1, 2]);
  });

  it("works across negative coordinates far from the origin", () => {
    const h = new SpatialHash(64);
    h.insert(7, -50_000.5, -80_000.25);
    h.insert(8, -49_990, -80_000);
    const out: number[] = [];
    const n = h.query(-50_000, -80_000, 20, out);
    expect(out.slice(0, n).sort()).toEqual([7, 8]);
  });

  it("finds items across a cell boundary", () => {
    const h = new SpatialHash(64);
    h.insert(1, 63.9, 0);
    const out: number[] = [];
    expect(h.query(64.1, 0, 1, out)).toBe(1);
  });

  it("removes items", () => {
    const h = new SpatialHash(64);
    h.insert(1, 0, 0);
    expect(h.remove(1)).toBe(true);
    expect(h.remove(1)).toBe(false);
    expect(h.has(1)).toBe(false);
    expect(h.query(0, 0, 10, [])).toBe(0);
    expect(h.size).toBe(0);
  });

  it("clears the out array before writing", () => {
    const h = new SpatialHash(64);
    const out = [99, 98, 97];
    expect(h.query(0, 0, 10, out)).toBe(0);
    expect(out).toHaveLength(0);
  });

  it("re-inserting an item moves it", () => {
    const h = new SpatialHash(64);
    h.insert(1, 0, 0);
    h.insert(1, 500, 500);
    expect(h.query(0, 0, 10, [])).toBe(0);
    expect(h.query(500, 500, 10, [])).toBe(1);
    expect(h.size).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/track/spatial-hash.test.ts`
Expected: FAIL — cannot resolve `./spatial-hash`.

- [ ] **Step 3: Implement**

`src/track/spatial-hash.ts`:

```ts
const OFFSET = 0x8000; // supports ±32768 cells per axis (±2 km at 64 mm cells)
const SPAN = 0x10000;

/** Uniform-grid hash of numeric item ids. Queries return candidates; callers filter by exact distance. */
export class SpatialHash {
  private readonly cells = new Map<number, number[]>();
  private readonly itemCell = new Map<number, number>();

  constructor(private readonly cellSize: number) {}

  get size(): number {
    return this.itemCell.size;
  }

  has(item: number): boolean {
    return this.itemCell.has(item);
  }

  insert(item: number, x: number, z: number): void {
    this.remove(item);
    const key = this.key(Math.floor(x / this.cellSize), Math.floor(z / this.cellSize));
    let cell = this.cells.get(key);
    if (!cell) {
      cell = [];
      this.cells.set(key, cell);
    }
    cell.push(item);
    this.itemCell.set(item, key);
  }

  remove(item: number): boolean {
    const key = this.itemCell.get(item);
    if (key === undefined) return false;
    const cell = this.cells.get(key)!;
    const i = cell.indexOf(item);
    cell[i] = cell[cell.length - 1];
    cell.pop();
    if (cell.length === 0) this.cells.delete(key);
    this.itemCell.delete(item);
    return true;
  }

  query(x: number, z: number, radius: number, out: number[]): number {
    out.length = 0;
    const cs = this.cellSize;
    const x0 = Math.floor((x - radius) / cs);
    const x1 = Math.floor((x + radius) / cs);
    const z0 = Math.floor((z - radius) / cs);
    const z1 = Math.floor((z + radius) / cs);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const cell = this.cells.get(this.key(cx, cz));
        if (!cell) continue;
        for (let i = 0; i < cell.length; i++) out.push(cell[i]);
      }
    }
    return out.length;
  }

  private key(cx: number, cz: number): number {
    return (cx + OFFSET) * SPAN + (cz + OFFSET);
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/track/spatial-hash.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/track/spatial-hash.ts src/track/spatial-hash.test.ts
git commit -m "feat(track): uniform-grid spatial hash"
```

---

### Task 5: Layout with seating and joint play

**Files:**
- Create: `src/track/layout.ts`
- Test: `src/track/layout.test.ts`

**Interfaces:**
- Consumes: `getPieceDef`, `MAX_CONNECTORS`, `PieceTypeId`, `ConnectorKind` (pieces.ts); `Pose`, `transformPose`, `angleDiff` (math.ts); `SpatialHash`; constants `JOINT_POS_TOLERANCE`, `JOINT_ANGLE_TOLERANCE`, `SPATIAL_CELL_SIZE`.
- Produces:
  - `connectorRef(pieceId: number, index: number): number`, `pieceOfRef(ref: number): number`, `indexOfRef(ref: number): number`
  - `interface PlacedPiece { readonly id: number; readonly type: PieceTypeId; readonly flipped: boolean; readonly pose: Pose; readonly y: number }`
  - `interface Joint { readonly a: number; readonly b: number; readonly posError: number; readonly angleError: number }` (`a < b`, connector refs)
  - `interface WorldConnector { x: number; z: number; heading: number; y: number; kind: ConnectorKind }`, `createWorldConnector(): WorldConnector`
  - `class Layout` with:
    - `addPiece(type: PieceTypeId, pose: Pose, y?: number, flipped?: boolean): number` (returns new id; seats every connector within joint play)
    - `removePiece(id: number): boolean`
    - `movePiece(id: number, pose: Pose, y: number): boolean`
    - `getPiece(id: number): PlacedPiece | undefined`
    - `pieceIds(): IterableIterator<number>`, `get pieceCount(): number`
    - `worldConnector(ref: number, out: WorldConnector): WorldConnector`
    - `joinedConnector(ref: number): number` (−1 if free)
    - `jointAt(ref: number): Joint | undefined`, `joints(): IterableIterator<Joint>`, `get jointCount(): number`
    - `queryFreeConnectors(x: number, z: number, radius: number, out: number[]): number` (candidates; caller filters)
    - `switchState(pieceId: number): number`, `setSwitchState(pieceId: number, state: number): void`

- [ ] **Step 1: Write the failing tests**

`src/track/layout.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { connectorRef, createWorldConnector, Layout } from "./layout";
import type { Pose } from "./math";

const P = (x: number, z: number, heading = 0): Pose => ({ x, z, heading });
const deg = (d: number) => (d * Math.PI) / 180;

describe("Layout seating", () => {
  it("seats two exactly aligned straights", () => {
    const l = new Layout();
    const a = l.addPiece("straight-144", P(0, 0));
    const b = l.addPiece("straight-144", P(144, 0));
    expect(l.jointCount).toBe(1);
    expect(l.joinedConnector(connectorRef(a, 1))).toBe(connectorRef(b, 0));
    expect(l.joinedConnector(connectorRef(b, 0))).toBe(connectorRef(a, 1));
    expect(l.jointAt(connectorRef(a, 1))!.posError).toBeCloseTo(0);
  });

  it("seats within ±1.5 mm and records the error", () => {
    const l = new Layout();
    l.addPiece("straight-144", P(0, 0));
    l.addPiece("straight-144", P(145, 0));
    expect(l.jointCount).toBe(1);
    expect([...l.joints()][0].posError).toBeCloseTo(1);
  });

  it("does not seat beyond the position tolerance", () => {
    const l = new Layout();
    l.addPiece("straight-144", P(0, 0));
    l.addPiece("straight-144", P(147, 0));
    expect(l.jointCount).toBe(0);
  });

  it("seats within ±2° and not beyond", () => {
    const ok = new Layout();
    ok.addPiece("straight-144", P(0, 0));
    ok.addPiece("straight-144", P(144, 0, deg(1.5)));
    expect(ok.jointCount).toBe(1);
    expect([...ok.joints()][0].angleError).toBeCloseTo(deg(1.5));

    const bad = new Layout();
    bad.addPiece("straight-144", P(0, 0));
    bad.addPiece("straight-144", P(144, 0, deg(3)));
    expect(bad.jointCount).toBe(0);
  });

  it("never joins two pegs or two sockets", () => {
    const l = new Layout();
    l.addPiece("straight-144", P(0, 0)); // peg at x=144
    l.addPiece("adapter-peg", P(144, 0)); // peg at x=144 facing back
    expect(l.jointCount).toBe(0);
  });

  it("seats across the ±π heading wrap", () => {
    const l = new Layout();
    l.addPiece("straight-144", P(0, 0, Math.PI)); // peg at x=-144, facing -x
    l.addPiece("straight-144", P(-144, 0, -Math.PI)); // same orientation expressed as -π
    expect(l.jointCount).toBe(1);
  });

  it("requires matching height", () => {
    const l = new Layout();
    l.addPiece("straight-144", P(0, 0), 0);
    l.addPiece("straight-144", P(144, 0), 64);
    expect(l.jointCount).toBe(0);
  });

  it("ramp joins floor track to elevated track", () => {
    const l = new Layout();
    l.addPiece("straight-144", P(0, 0));
    l.addPiece("ramp", P(144, 0));
    l.addPiece("bridge", P(360, 0), 0); // bridge track sits at RISER_HEIGHT on its own legs
    expect(l.jointCount).toBe(2);
  });

  it("never makes a triple join on an already-joined connector", () => {
    const l = new Layout();
    l.addPiece("straight-144", P(0, 0));
    l.addPiece("straight-144", P(144, 0));
    l.addPiece("straight-108", P(144, 0)); // its socket sits on the same, already-joined peg
    expect(l.jointCount).toBe(1);
  });
});

describe("Layout editing", () => {
  it("removing a piece frees its neighbours' connectors for re-use", () => {
    const l = new Layout();
    const a = l.addPiece("straight-144", P(0, 0));
    const b = l.addPiece("straight-144", P(144, 0));
    l.addPiece("straight-144", P(288, 0));
    expect(l.jointCount).toBe(2);
    expect(l.removePiece(b)).toBe(true);
    expect(l.jointCount).toBe(0);
    expect(l.joinedConnector(connectorRef(a, 1))).toBe(-1);
    l.addPiece("straight-144", P(144, 0));
    expect(l.jointCount).toBe(2);
  });

  it("removing an unknown id returns false", () => {
    expect(new Layout().removePiece(42)).toBe(false);
  });

  it("moving a piece away unseats it, moving it back re-seats it", () => {
    const l = new Layout();
    l.addPiece("straight-144", P(0, 0));
    const b = l.addPiece("straight-144", P(144, 0));
    expect(l.movePiece(b, P(500, 500), 0)).toBe(true);
    expect(l.jointCount).toBe(0);
    expect(l.movePiece(b, P(144, 0), 0)).toBe(true);
    expect(l.jointCount).toBe(1);
    expect(l.getPiece(b)!.pose).toEqual(P(144, 0));
  });

  it("free connector queries exclude joined connectors", () => {
    const l = new Layout();
    l.addPiece("straight-144", P(0, 0));
    l.addPiece("straight-144", P(144, 0));
    const out: number[] = [];
    const n = l.queryFreeConnectors(144, 0, 5, out);
    expect(n).toBe(0);
  });

  it("computes world connectors from piece pose", () => {
    const l = new Layout();
    const a = l.addPiece("straight-144", P(10, 20, Math.PI / 2), 64);
    const w = l.worldConnector(connectorRef(a, 1), createWorldConnector());
    expect(w.x).toBeCloseTo(10);
    expect(w.z).toBeCloseTo(164);
    expect(w.y).toBe(64);
    expect(w.heading).toBeCloseTo(Math.PI / 2);
    expect(w.kind).toBe("peg");
  });

  it("stores switch state per piece, defaulting to 0", () => {
    const l = new Layout();
    const s = l.addPiece("switch", P(0, 0));
    expect(l.switchState(s)).toBe(0);
    l.setSwitchState(s, 1);
    expect(l.switchState(s)).toBe(1);
    l.removePiece(s);
    expect(l.switchState(s)).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/track/layout.test.ts`
Expected: FAIL — cannot resolve `./layout`.

- [ ] **Step 3: Implement**

`src/track/layout.ts`:

```ts
import { JOINT_ANGLE_TOLERANCE, JOINT_POS_TOLERANCE, SPATIAL_CELL_SIZE } from "./constants";
import { angleDiff, transformPose, type Pose } from "./math";
import { getPieceDef, MAX_CONNECTORS, type ConnectorKind, type PieceTypeId } from "./pieces";
import { SpatialHash } from "./spatial-hash";

export const connectorRef = (pieceId: number, index: number): number => pieceId * MAX_CONNECTORS + index;
export const pieceOfRef = (ref: number): number => Math.floor(ref / MAX_CONNECTORS);
export const indexOfRef = (ref: number): number => ref % MAX_CONNECTORS;

export interface PlacedPiece {
  readonly id: number;
  readonly type: PieceTypeId;
  readonly flipped: boolean;
  readonly pose: Pose;
  readonly y: number;
}

/** A seated peg/socket pair. a < b; errors record how far from perfectly seated it is. */
export interface Joint {
  readonly a: number;
  readonly b: number;
  readonly posError: number;
  readonly angleError: number;
}

export interface WorldConnector {
  x: number;
  z: number;
  heading: number;
  y: number;
  kind: ConnectorKind;
}

export const createWorldConnector = (): WorldConnector => ({ x: 0, z: 0, heading: 0, y: 0, kind: "peg" });

const scratchA = createWorldConnector();
const scratchB = createWorldConnector();
const candidates: number[] = [];

export class Layout {
  private nextId = 1;
  private readonly pieces = new Map<number, PlacedPiece>();
  private readonly joinedTo = new Map<number, number>();
  private readonly jointMap = new Map<number, Joint>();
  private readonly freeConnectors = new SpatialHash(SPATIAL_CELL_SIZE);
  private readonly switchStates = new Map<number, number>();

  get pieceCount(): number {
    return this.pieces.size;
  }

  get jointCount(): number {
    return this.jointMap.size;
  }

  pieceIds(): IterableIterator<number> {
    return this.pieces.keys();
  }

  getPiece(id: number): PlacedPiece | undefined {
    return this.pieces.get(id);
  }

  joints(): IterableIterator<Joint> {
    return this.jointMap.values();
  }

  addPiece(type: PieceTypeId, pose: Pose, y = 0, flipped = false): number {
    const id = this.nextId++;
    this.pieces.set(id, { id, type, flipped, pose: { ...pose }, y });
    this.seatAll(id);
    return id;
  }

  removePiece(id: number): boolean {
    if (!this.pieces.has(id)) return false;
    this.detachAll(id);
    this.pieces.delete(id);
    this.switchStates.delete(id);
    return true;
  }

  movePiece(id: number, pose: Pose, y: number): boolean {
    const piece = this.pieces.get(id);
    if (!piece) return false;
    this.detachAll(id);
    this.pieces.set(id, { ...piece, pose: { ...pose }, y });
    this.seatAll(id);
    return true;
  }

  worldConnector(ref: number, out: WorldConnector): WorldConnector {
    const piece = this.pieces.get(pieceOfRef(ref));
    if (!piece) throw new Error(`worldConnector: no piece for connector ref ${ref}`);
    const c = getPieceDef(piece.type, piece.flipped).connectors[indexOfRef(ref)];
    transformPose(piece.pose, c.pose, out);
    out.y = piece.y + c.y;
    out.kind = c.kind;
    return out;
  }

  joinedConnector(ref: number): number {
    return this.joinedTo.get(ref) ?? -1;
  }

  jointAt(ref: number): Joint | undefined {
    const other = this.joinedTo.get(ref);
    return other === undefined ? undefined : this.jointMap.get(Math.min(ref, other));
  }

  queryFreeConnectors(x: number, z: number, radius: number, out: number[]): number {
    return this.freeConnectors.query(x, z, radius, out);
  }

  switchState(pieceId: number): number {
    return this.switchStates.get(pieceId) ?? 0;
  }

  setSwitchState(pieceId: number, state: number): void {
    this.switchStates.set(pieceId, state);
  }

  private seatAll(id: number): void {
    const piece = this.pieces.get(id)!;
    const count = getPieceDef(piece.type, piece.flipped).connectors.length;
    for (let i = 0; i < count; i++) this.seatConnector(connectorRef(id, i));
  }

  private seatConnector(ref: number): void {
    const w = this.worldConnector(ref, scratchA);
    const self = pieceOfRef(ref);
    const n = this.freeConnectors.query(w.x, w.z, JOINT_POS_TOLERANCE, candidates);
    let best = -1;
    let bestPos = Infinity;
    let bestAngle = 0;
    for (let i = 0; i < n; i++) {
      const other = candidates[i];
      if (pieceOfRef(other) === self) continue;
      const o = this.worldConnector(other, scratchB);
      if (o.kind === w.kind) continue;
      const pos = Math.hypot(o.x - w.x, o.z - w.z);
      if (pos > JOINT_POS_TOLERANCE || Math.abs(o.y - w.y) > JOINT_POS_TOLERANCE) continue;
      const angle = angleDiff(w.heading, o.heading + Math.PI);
      if (angle > JOINT_ANGLE_TOLERANCE) continue;
      if (pos < bestPos) {
        best = other;
        bestPos = pos;
        bestAngle = angle;
      }
    }
    if (best === -1) {
      this.freeConnectors.insert(ref, w.x, w.z);
      return;
    }
    this.freeConnectors.remove(best);
    this.joinedTo.set(ref, best);
    this.joinedTo.set(best, ref);
    const a = Math.min(ref, best);
    this.jointMap.set(a, { a, b: Math.max(ref, best), posError: bestPos, angleError: bestAngle });
  }

  private detachAll(id: number): void {
    const piece = this.pieces.get(id)!;
    const count = getPieceDef(piece.type, piece.flipped).connectors.length;
    for (let i = 0; i < count; i++) {
      const ref = connectorRef(id, i);
      const partner = this.joinedTo.get(ref);
      if (partner === undefined) {
        this.freeConnectors.remove(ref);
        continue;
      }
      this.joinedTo.delete(ref);
      this.joinedTo.delete(partner);
      this.jointMap.delete(Math.min(ref, partner));
      const pw = this.worldConnector(partner, scratchB);
      this.freeConnectors.insert(partner, pw.x, pw.z);
    }
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/track/layout.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/track/layout.ts src/track/layout.test.ts
git commit -m "feat(track): layout with peg/socket seating and joint play"
```

---

### Task 6: Drag snapping, exact chaining and loop closure

**Files:**
- Create: `src/track/snap.ts`
- Test: `src/track/snap.test.ts`

**Interfaces:**
- Consumes: `Layout`, `connectorRef`, `pieceOfRef`, `createWorldConnector` (layout.ts); `getPieceDef`, `PieceTypeId`; `Pose`, `transformPose`, `solveParentPose`; constants `SNAP_CAPTURE_RADIUS`, `SNAP_HEIGHT_TOLERANCE`.
- Produces:
  - `type SnapResult = { readonly kind: "snapped"; readonly pose: Pose; readonly y: number; readonly connector: number; readonly target: number; readonly distance: number } | { readonly kind: "none" }`
  - `findSnap(layout: Layout, type: PieceTypeId, flipped: boolean, pose: Pose, y: number, excludePieceId?: number): SnapResult` — for a piece being dragged at `pose`/`y`, the exact pose that seats its nearest connector onto the nearest compatible free connector within `SNAP_CAPTURE_RADIUS`. `excludePieceId` skips the piece's own connectors when moving an existing piece.
  - `appendPiece(layout: Layout, type: PieceTypeId, flipped: boolean, fromRef: number, connectorIndex?: number): number` — places a new piece exactly seated on free connector `fromRef` via its connector `connectorIndex` (default 0); returns the new piece id.

- [ ] **Step 1: Write the failing tests**

`src/track/snap.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { connectorRef, Layout } from "./layout";
import type { Pose } from "./math";
import { appendPiece, findSnap } from "./snap";

const P = (x: number, z: number, heading = 0): Pose => ({ x, z, heading });
const deg = (d: number) => (d * Math.PI) / 180;

function curveChain(l: Layout, count: number): number[] {
  const ids = [l.addPiece("curve-large", P(0, 0))];
  for (let i = 1; i < count; i++) ids.push(appendPiece(l, "curve-large", false, connectorRef(ids[i - 1], 1)));
  return ids;
}

describe("findSnap", () => {
  it("snaps a nearby dragged piece exactly onto a free peg", () => {
    const l = new Layout();
    l.addPiece("straight-144", P(0, 0));
    const r = findSnap(l, "straight-144", false, P(150, 8, deg(10)), 0);
    expect(r.kind).toBe("snapped");
    if (r.kind !== "snapped") return;
    expect(r.pose.x).toBeCloseTo(144);
    expect(r.pose.z).toBeCloseTo(0);
    expect(r.pose.heading).toBeCloseTo(0);
    expect(r.connector).toBe(0);
  });

  it("returns none when nothing is within the capture radius", () => {
    const l = new Layout();
    l.addPiece("straight-144", P(0, 0));
    expect(findSnap(l, "straight-144", false, P(400, 0), 0).kind).toBe("none");
  });

  it("snaps a piece's peg onto a free socket (attaching behind)", () => {
    const l = new Layout();
    l.addPiece("straight-144", P(0, 0));
    const r = findSnap(l, "straight-108", false, P(-100, 5), 0);
    expect(r.kind).toBe("snapped");
    if (r.kind !== "snapped") return;
    expect(r.connector).toBe(1);
    expect(r.pose.x).toBeCloseTo(-108);
  });

  it("ignores the dragged piece's own connectors", () => {
    const l = new Layout();
    const a = l.addPiece("straight-144", P(0, 0));
    expect(findSnap(l, "straight-144", false, P(5, 0), 0, a).kind).toBe("none");
  });

  it("snaps onto a raised connector and reports the resulting base height", () => {
    const l = new Layout();
    l.addPiece("ramp", P(0, 0)); // peg at x=216, y=64
    const r = findSnap(l, "straight-144", false, P(220, 0), 50);
    expect(r.kind).toBe("snapped");
    if (r.kind === "snapped") expect(r.y).toBeCloseTo(64);
  });

  it("does not snap to joined connectors", () => {
    const l = new Layout();
    l.addPiece("straight-144", P(0, 0));
    l.addPiece("straight-144", P(144, 0));
    const r = findSnap(l, "straight-54", false, P(146, 0), 0);
    // nearest free connectors are at x=0 (socket) and x=288 (peg), both out of range
    expect(r.kind).toBe("none");
  });
});

describe("loop closure", () => {
  it("eight large curves close a circle", () => {
    const l = new Layout();
    curveChain(l, 8);
    expect(l.jointCount).toBe(8);
  });

  it("an oval of 8 curves and 2 matching straights closes", () => {
    const l = new Layout();
    const ids = [l.addPiece("curve-large", P(0, 0))];
    const seq = ["curve-large", "curve-large", "curve-large", "straight-216", "curve-large", "curve-large", "curve-large", "curve-large", "straight-216"] as const;
    for (const t of seq) ids.push(appendPiece(l, t, false, connectorRef(ids[ids.length - 1], 1)));
    expect(l.jointCount).toBe(10);
  });

  it("an oval with mismatched straights does not close", () => {
    const l = new Layout();
    const ids = [l.addPiece("curve-large", P(0, 0))];
    const seq = ["curve-large", "curve-large", "curve-large", "straight-216", "curve-large", "curve-large", "curve-large", "curve-large", "straight-144"] as const;
    for (const t of seq) ids.push(appendPiece(l, t, false, connectorRef(ids[ids.length - 1], 1)));
    expect(l.jointCount).toBe(9);
  });

  it("joint play lets a slightly-off final piece close the loop (0.5° ≈ 1.2 mm)", () => {
    const l = new Layout();
    const ids = curveChain(l, 7);
    const exact = l.getPiece(appendPiece(l, "curve-large", false, connectorRef(ids[6], 1)))!;
    l.removePiece(exact.id);
    l.addPiece("curve-large", { ...exact.pose, heading: exact.pose.heading + deg(0.5) });
    expect(l.jointCount).toBe(8);
    const errors = [...l.joints()].map((j) => j.posError);
    expect(Math.max(...errors)).toBeGreaterThan(1);
  });

  it("a loop that is ~3.6 mm off (1.5°) does not close", () => {
    const l = new Layout();
    const ids = curveChain(l, 7);
    const exact = l.getPiece(appendPiece(l, "curve-large", false, connectorRef(ids[6], 1)))!;
    l.removePiece(exact.id);
    l.addPiece("curve-large", { ...exact.pose, heading: exact.pose.heading + deg(1.5) });
    expect(l.jointCount).toBe(7);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/track/snap.test.ts`
Expected: FAIL — cannot resolve `./snap`.

- [ ] **Step 3: Implement**

`src/track/snap.ts`:

```ts
import { SNAP_CAPTURE_RADIUS, SNAP_HEIGHT_TOLERANCE } from "./constants";
import { createWorldConnector, pieceOfRef, type Layout } from "./layout";
import { solveParentPose, transformPose, type Pose } from "./math";
import { getPieceDef, type PieceTypeId } from "./pieces";

export type SnapResult =
  | {
      readonly kind: "snapped";
      readonly pose: Pose;
      readonly y: number;
      /** Connector index on the dragged piece that seats. */
      readonly connector: number;
      /** Connector ref in the layout it seats onto. */
      readonly target: number;
      readonly distance: number;
    }
  | { readonly kind: "none" };

const NONE: SnapResult = { kind: "none" };
const local: Pose = { x: 0, z: 0, heading: 0 };
const target = createWorldConnector();
const candidates: number[] = [];

/**
 * Where should a piece being dragged at `pose` land? Called on pointer move (not per sim tick),
 * so returning a fresh result object is fine.
 */
export function findSnap(
  layout: Layout,
  type: PieceTypeId,
  flipped: boolean,
  pose: Pose,
  y: number,
  excludePieceId = -1,
): SnapResult {
  const def = getPieceDef(type, flipped);
  let best: SnapResult = NONE;
  let bestDistance = Infinity;
  for (let i = 0; i < def.connectors.length; i++) {
    const c = def.connectors[i];
    transformPose(pose, c.pose, local);
    const cy = y + c.y;
    const n = layout.queryFreeConnectors(local.x, local.z, SNAP_CAPTURE_RADIUS, candidates);
    for (let j = 0; j < n; j++) {
      const ref = candidates[j];
      if (pieceOfRef(ref) === excludePieceId) continue;
      const t = layout.worldConnector(ref, target);
      if (t.kind === c.kind) continue;
      const distance = Math.hypot(t.x - local.x, t.z - local.z);
      if (distance > SNAP_CAPTURE_RADIUS || Math.abs(t.y - cy) > SNAP_HEIGHT_TOLERANCE) continue;
      if (distance >= bestDistance) continue;
      bestDistance = distance;
      const snapped = solveParentPose(c.pose, { x: t.x, z: t.z, heading: t.heading + Math.PI }, { x: 0, z: 0, heading: 0 });
      best = { kind: "snapped", pose: snapped, y: t.y - c.y, connector: i, target: ref, distance };
    }
  }
  return best;
}

/** Place a new piece exactly seated on free connector `fromRef`, through its connector `connectorIndex`. */
export function appendPiece(
  layout: Layout,
  type: PieceTypeId,
  flipped: boolean,
  fromRef: number,
  connectorIndex = 0,
): number {
  const c = getPieceDef(type, flipped).connectors[connectorIndex];
  const t = layout.worldConnector(fromRef, target);
  const pose = solveParentPose(c.pose, { x: t.x, z: t.z, heading: t.heading + Math.PI }, { x: 0, z: 0, heading: 0 });
  const y = t.y - c.y;
  return layout.addPiece(type, pose, y, flipped);
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/track/snap.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/track/snap.ts src/track/snap.test.ts
git commit -m "feat(track): drag snapping, exact chaining and loop closure via joint play"
```

---

### Task 7: Routing through the track graph

**Files:**
- Create: `src/track/routing.ts`
- Test: `src/track/routing.test.ts`

**Interfaces:**
- Consumes: `Layout`, `connectorRef`, `pieceOfRef`, `indexOfRef` (layout.ts); `getPieceDef`, `PieceDef`.
- Produces:
  - `interface RouteStep { pieceId: number; pathIndex: number; reversed: boolean }`, `createRouteStep(): RouteStep`
  - `routeFrom(layout: Layout, pieceId: number, connectorIndex: number, out: RouteStep): boolean` — a train leaving `pieceId` through `connectorIndex`: writes the next piece/path/direction into `out` and returns `true`, or returns `false` for an open end. At a piece where several paths touch the entry connector (switch trunk), picks `candidates[switchState % count]` in path-index order; entering from a branch has exactly one candidate, so trailing moves always merge. `reversed` is `true` when entering at a path's `to` end.
  - `pathExitConnector(def: PieceDef, pathIndex: number, reversed: boolean): number` — connector index the train leaves through, or `-1` if the path ends at a buffer.

- [ ] **Step 1: Write the failing tests**

`src/track/routing.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { connectorRef, Layout } from "./layout";
import type { Pose } from "./math";
import { createSample, pathLength, samplePath } from "./path";
import { getPieceDef } from "./pieces";
import { createRouteStep, pathExitConnector, routeFrom } from "./routing";
import { appendPiece } from "./snap";

const P = (x: number, z: number, heading = 0): Pose => ({ x, z, heading });

describe("routeFrom", () => {
  it("goes forward from one straight into the next", () => {
    const l = new Layout();
    const a = l.addPiece("straight-144", P(0, 0));
    const b = appendPiece(l, "straight-144", false, connectorRef(a, 1));
    const out = createRouteStep();
    expect(routeFrom(l, a, 1, out)).toBe(true);
    expect(out).toEqual({ pieceId: b, pathIndex: 0, reversed: false });
  });

  it("goes backward, entering the previous piece at its path end", () => {
    const l = new Layout();
    const a = l.addPiece("straight-144", P(0, 0));
    const b = appendPiece(l, "straight-144", false, connectorRef(a, 1));
    const out = createRouteStep();
    expect(routeFrom(l, b, 0, out)).toBe(true);
    expect(out).toEqual({ pieceId: a, pathIndex: 0, reversed: true });
  });

  it("returns false at an open end", () => {
    const l = new Layout();
    const a = l.addPiece("straight-144", P(0, 0));
    expect(routeFrom(l, a, 1, createRouteStep())).toBe(false);
  });

  it("follows switch state when entering at the trunk", () => {
    const l = new Layout();
    const a = l.addPiece("straight-144", P(0, 0));
    const s = appendPiece(l, "switch", false, connectorRef(a, 1));
    const out = createRouteStep();
    routeFrom(l, a, 1, out);
    expect(out.pathIndex).toBe(0);
    l.setSwitchState(s, 1);
    routeFrom(l, a, 1, out);
    expect(out).toEqual({ pieceId: s, pathIndex: 1, reversed: false });
  });

  it("always merges when entering from a branch, regardless of switch state", () => {
    const l = new Layout();
    const s = l.addPiece("switch", P(0, 0));
    const tail = appendPiece(l, "straight-144", false, connectorRef(s, 2)); // straight's socket seats on the branch peg
    const out = createRouteStep();
    l.setSwitchState(s, 0); // set to straight; merging in from the curved branch must still work
    expect(routeFrom(l, tail, 0, out)).toBe(true);
    expect(out).toEqual({ pieceId: s, pathIndex: 1, reversed: true });
  });

  it("flipped switch branches the other way and still uses state 1 for the branch", () => {
    const l = new Layout();
    const a = l.addPiece("straight-144", P(0, 0));
    const s = appendPiece(l, "switch", true, connectorRef(a, 1));
    l.setSwitchState(s, 1);
    const out = createRouteStep();
    routeFrom(l, a, 1, out);
    expect(out.pathIndex).toBe(1);
    const geom = getPieceDef("switch", true).paths[1].geom;
    expect(samplePath(geom, pathLength(geom), createSample()).z).toBeLessThan(0);
  });

  it("crossing routes each line straight through", () => {
    const l = new Layout();
    const c = l.addPiece("crossing", P(0, 0));
    const before = l.addPiece("straight-144", P(72, -216, Math.PI / 2)); // peg at (72,-72) facing +z
    const out = createRouteStep();
    expect(routeFrom(l, before, 1, out)).toBe(true);
    expect(out).toEqual({ pieceId: c, pathIndex: 1, reversed: false });
  });
});

describe("pathExitConnector", () => {
  it("returns the far connector, the near one when reversed, and -1 for buffers", () => {
    const sw = getPieceDef("switch", false);
    expect(pathExitConnector(sw, 1, false)).toBe(2);
    expect(pathExitConnector(sw, 1, true)).toBe(0);
    expect(pathExitConnector(getPieceDef("buffer", false), 0, false)).toBe(-1);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/track/routing.test.ts`
Expected: FAIL — cannot resolve `./routing`.

- [ ] **Step 3: Implement**

`src/track/routing.ts`:

```ts
import { connectorRef, indexOfRef, pieceOfRef, type Layout } from "./layout";
import { getPieceDef, type PieceDef } from "./pieces";

export interface RouteStep {
  pieceId: number;
  pathIndex: number;
  /** True when travelling from the path's `to` end toward its `from` end. */
  reversed: boolean;
}

export const createRouteStep = (): RouteStep => ({ pieceId: 0, pathIndex: 0, reversed: false });

/**
 * Where does a train go after leaving `pieceId` through `connectorIndex`?
 * Writes into `out` and returns true, or returns false at an open end. No allocation.
 */
export function routeFrom(layout: Layout, pieceId: number, connectorIndex: number, out: RouteStep): boolean {
  const joined = layout.joinedConnector(connectorRef(pieceId, connectorIndex));
  if (joined === -1) return false;
  const nextId = pieceOfRef(joined);
  const entry = indexOfRef(joined);
  const piece = layout.getPiece(nextId)!;
  const paths = getPieceDef(piece.type, piece.flipped).paths;

  let count = 0;
  for (let i = 0; i < paths.length; i++) if (paths[i].from === entry || paths[i].to === entry) count++;
  if (count === 0) return false;

  const pick = count === 1 ? 0 : layout.switchState(nextId) % count;
  let seen = 0;
  for (let i = 0; i < paths.length; i++) {
    const p = paths[i];
    if (p.from !== entry && p.to !== entry) continue;
    if (seen++ !== pick) continue;
    out.pieceId = nextId;
    out.pathIndex = i;
    out.reversed = p.to === entry;
    return true;
  }
  return false;
}

/** Connector index a train leaves through, or -1 if the path ends at a buffer. */
export function pathExitConnector(def: PieceDef, pathIndex: number, reversed: boolean): number {
  const p = def.paths[pathIndex];
  if (reversed) return p.from;
  return p.to ?? -1;
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/track/routing.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/track/routing.ts src/track/routing.test.ts
git commit -m "feat(track): switch-aware routing through the track graph"
```

---

### Task 8: Stress layout, benchmarks and public API

**Files:**
- Create: `src/track/stress-layout.ts`, `src/track/index.ts`, `bench/track.bench.ts`
- Test: `src/track/stress-layout.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces:
  - `buildStressLayout(ovalCount: number): { layout: Layout; looseSockets: number[] }` — deterministic grid of closed ovals (10 pieces each) plus one loose `straight-144` per oval; `looseSockets` are the loose straights' free socket refs, used as snap targets in benches.
  - `src/track/index.ts` re-exporting the public API of all track modules.

- [ ] **Step 1: Write the failing test**

`src/track/stress-layout.test.ts`:

```ts
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
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/track/stress-layout.test.ts`
Expected: FAIL — cannot resolve `./stress-layout`.

- [ ] **Step 3: Implement the stress layout**

`src/track/stress-layout.ts`:

```ts
import { connectorRef, Layout } from "./layout";
import type { PieceTypeId } from "./pieces";
import { appendPiece } from "./snap";

const OVAL: readonly PieceTypeId[] = [
  "curve-large",
  "curve-large",
  "curve-large",
  "straight-216",
  "curve-large",
  "curve-large",
  "curve-large",
  "curve-large",
  "straight-216",
];
const SPACING = 900;

/** Deterministic large layout for benchmarks and device testing: a grid of closed ovals plus loose straights. */
export function buildStressLayout(ovalCount: number): { layout: Layout; looseSockets: number[] } {
  const layout = new Layout();
  const looseSockets: number[] = [];
  const cols = Math.ceil(Math.sqrt(ovalCount));
  for (let i = 0; i < ovalCount; i++) {
    const ox = (i % cols) * SPACING;
    const oz = Math.floor(i / cols) * SPACING;
    let last = layout.addPiece("curve-large", { x: ox, z: oz, heading: 0 });
    for (const type of OVAL) last = appendPiece(layout, type, false, connectorRef(last, 1));
    const loose = layout.addPiece("straight-144", { x: ox + 300, z: oz + 150, heading: 0 });
    looseSockets.push(connectorRef(loose, 0));
  }
  return { layout, looseSockets };
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/track/stress-layout.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the public API barrel**

`src/track/index.ts`:

```ts
export * from "./constants";
export * from "./layout";
export * from "./math";
export * from "./path";
export * from "./pieces";
export * from "./routing";
export * from "./snap";
export * from "./spatial-hash";
export * from "./stress-layout";
```

- [ ] **Step 6: Write the benchmarks**

`bench/track.bench.ts`:

```ts
import { bench, describe } from "vitest";
import {
  buildStressLayout,
  createRouteStep,
  createSample,
  createWorldConnector,
  findSnap,
  getPieceDef,
  pathLength,
  routeFrom,
  samplePath,
} from "../src/track";

for (const ovals of [30, 200]) {
  const pieces = ovals * 11;
  const { layout, looseSockets } = buildStressLayout(ovals);
  const w = createWorldConnector();
  const targets = looseSockets.map((ref) => {
    layout.worldConnector(ref, w);
    return { x: w.x - 160, z: w.z + 6 }; // a straight-144 dropped here snaps its peg onto the socket
  });

  describe(`track @ ${pieces} pieces`, () => {
    let i = 0;
    bench("findSnap (drag frame)", () => {
      const t = targets[i++ % targets.length];
      findSnap(layout, "straight-144", false, { x: t.x, z: t.z, heading: 0.05 }, 0);
    });

    bench("addPiece + removePiece", () => {
      const t = targets[i++ % targets.length];
      const id = layout.addPiece("straight-144", { x: t.x + 16, z: t.z - 6, heading: 0 });
      layout.removePiece(id);
    });

    const step = createRouteStep();
    bench("routeFrom", () => {
      routeFrom(layout, 1 + (i++ % (ovals * 11)), 1, step);
    });
  });
}

describe("path sampling", () => {
  const geom = getPieceDef("curve-large", false).paths[0].geom;
  const len = pathLength(geom);
  const out = createSample();
  let s = 0;
  bench("samplePath (arc)", () => {
    s = (s + 1.7) % len;
    samplePath(geom, s, out);
  });
});
```

- [ ] **Step 7: Run benchmarks and the full suite**

Run: `npm run bench`
Expected: benchmarks complete. Record the `findSnap` and `addPiece + removePiece` hz figures at 2200 pieces in the commit message body — these are the baselines plan 7 will gate on. `findSnap` should stay above ~200,000 ops/s; if it is dramatically lower, investigate before committing.

Run: `npm test && npm run typecheck`
Expected: all tests pass; no type errors.

- [ ] **Step 8: Commit**

```bash
git add src/track/stress-layout.ts src/track/stress-layout.test.ts src/track/index.ts bench/track.bench.ts
git commit -m "feat(track): stress layout fixture, benchmarks and public API

Bench baselines @ 2200 pieces: findSnap <N> ops/s, add+remove <N> ops/s"
```

---

## Done criteria for Plan 1

- `npm test`, `npm run typecheck`, `npm run build` and `npm run bench` all succeed.
- `src/track/` has no imports from Three.js, the DOM, Zod or `src/lib/`.
- Every Review Focus item has a passing test.

## Deferred to later plans (by design)

- Collision shapes for track pieces → plan 5 (physics).
- Riser stacking rules (which pieces rest on which risers) → plan 4 (editor).
- Restoring layouts with specific piece ids → plan 6 (persistence).
- CI regression gating on bench baselines → plan 7.
