/**
 * Trajectory recorder, a vitest setup file (see trajectory.mjs): with TRAJ_OUT set, every Sim the tests tick records a
 * hash of its trains (each bogie's piece, path, way and position, the speed) and its switch states (not with
 * TRAJ_SWITCHES=0) once a simulated second. Written per test file to TRAJ_OUT, one line a second: `test#sim  second  hash`. It patches the Sim of the tree
 * under test (the vitest root), so the same recorder runs on main and on a branch without changing either.
 */
import { afterAll, expect } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const OUT = process.env.TRAJ_OUT;

if (OUT) {
  const { Sim, SIM_HZ } = await import(/* @vite-ignore */ resolve("src/sim/index.ts"));
  const tick = Sim.prototype.tick;
  const recs = new WeakMap<object, string[]>();
  const all: [string, string[]][] = [];
  const perTest = new Map<string, number>();
  /** FNV-1a over a string. */
  const fnv = (s: string): string => {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
    return (h >>> 0).toString(16).padStart(8, "0");
  };
  Sim.prototype.tick = function (this: any, ...args: unknown[]) {
    const r = tick.apply(this, args);
    if (this.ticks % SIM_HZ !== 0) return r;
    let lines = recs.get(this);
    if (!lines) {
      const test = expect.getState().currentTestName ?? "(file)";
      const n = perTest.get(test) ?? 0;
      perTest.set(test, n + 1);
      lines = [];
      recs.set(this, lines);
      all.push([`${test}#${n}`, lines]);
    }
    let s = "";
    for (const [id, t] of this.trains as Map<number, any>) {
      s += `T${id}:${t.speed}:${t.derailed ? 1 : 0}`;
      for (const b of t.bogies) s += `|${b.pieceId},${b.pathIndex},${b.reversed ? 1 : 0},${b.s}`;
    }
    // (TRAJ_SWITCHES=0 leaves the switches out: routes restoring points after a train (routing step 4) change them, not
    // where the trains run.)
    if (process.env.TRAJ_SWITCHES !== "0") {
      const states = [...(this.layout.switchStates as Map<number, number>)].sort((a, b) => a[0] - b[0]);
      s += `S${states.join(";")}`;
    }
    lines.push(`${this.ticks / SIM_HZ}\t${fnv(s)}`);
    return r;
  };
  afterAll(() => {
    if (all.length === 0) return;
    const file = relative(process.cwd(), expect.getState().testPath ?? "unknown").replace(/[\\/]/g, "_");
    mkdirSync(OUT, { recursive: true });
    const text = all.map(([key, lines]) => lines.map((l) => `${key}\t${l}`).join("\n")).join("\n") + "\n";
    writeFileSync(join(OUT, `${file}.tsv`), text);
  });
}
