/**
 * Bug maps (architecture review §3.6): a map copied with "Copy map for a bug report" (`woodrail-map:1:…`, see
 * src/persist/bug-map.ts) loaded into a headless world, as `deserializeWorld` builds it (its `Sim`, `Economy`, and the
 * economy's `Sections`, `Router` and `Stalls`), and run at 120 Hz, seeded, with the train invariants on every tick
 * (src/sim/invariants.ts). It reports the first break (what, when, the train or piece), or that they held, and the
 * stops each routed train came to. Test-only: nothing in the game imports it.
 *
 * What the replay leaves out (named, so it's never taken for the game): the frame loop and the player (nothing is
 * tapped; a map's trains run as they were saved), and Game mode's own rules on top of the economy (towns' wants,
 * research, the workshop): depots take what their recipes take. The world is the save's, so a bug that needs a
 * player's taps after the copy, or Game mode's wants, needs its taps scripted in its test.
 *
 *   npm run replay -- <file> [--seconds 600] [--seed 1]      (scripts/replay.mjs: prints the first break)
 */
import { readMapText, mapText } from "../persist/bug-map";
import { deserializeWorld, modeKeys, serializeWorld } from "../persist/save";
import { economyChecks, economyWorld } from "../game/dev-checks";
import type { GameMode } from "../game/modes";
import type { World } from "../game/world";
import { rng } from "../lib/rng";
import { SIM_HZ } from "../sim";
import type { Break, Invariants } from "../sim/invariants";

export interface BugMap {
  mode: GameMode;
  world: World;
}

/** Something the player does at a time (seconds into the replay). */
export interface ScriptedTap {
  at: number;
  do: (world: World) => void;
}

export interface Replayed {
  /** The first invariant broken (null: none, for the whole run). */
  first: Break | null;
  /** Seconds run (to the first break, with `stopAtFirst`). */
  seconds: number;
  /** Stops come to, per routed engine (by its car id, kept by the save since v14). */
  arrivals: Map<number, number>;
  checks: Invariants;
  /**
   * Liveness (routing redesign §4 step 0): per lever-on train (by its first engine's car id), the longest it stood (s)
   * not busy where it was by its own choice (`InvariantWorld.busy`: at a stop, turning back): stuck for a reason on its
   * card counts, as the player sees a train that doesn't move.
   */
  longestStand: Map<number, number>;
}

/** A copied map's text read into a world, as the game loads its save. Throws if it isn't a map or doesn't load. */
export async function loadBugMap(text: string): Promise<BugMap> {
  const copy = await readMapText(text);
  if (!copy) throw new Error(`not a copied map (it should start "woodrail-map:1:")`);
  const raw = copy.keys[modeKeys(copy.mode)[0]];
  if (!raw) throw new Error(`the copied ${copy.mode} map has no railway in it`);
  const r = deserializeWorld(JSON.parse(raw), { sandbox: copy.mode === "sandbox" });
  if (!r.ok) throw new Error(`the copied map doesn't load: ${r.error}`);
  return { mode: copy.mode, world: r.value };
}

/**
 * Run a loaded map's world `seconds` with the invariants checked every tick. `seed` seeds `Math.random` for the run
 * (the sim and economy don't use it today; anything that does stays repeatable). `stopAtFirst`: stop at the first break.
 * `events`: what the player did after the copy (a lever tap, Go), scripted at a time, as the routing harness's are.
 */
export function replayBugMap(world: World, opts: { seconds?: number; seed?: number; stopAtFirst?: boolean; events?: ScriptedTap[]; onTick?: (world: World) => void; heldFree?: boolean } = {}): Replayed {
  const { seconds = 600, seed = 1, stopAtFirst = true } = opts;
  const events = [...(opts.events ?? [])].sort((a, b) => a.at - b.at);
  let e = 0;
  let first: Break | null = null;
  const checks = economyChecks(world.economy, { every: 1, onBreak: (b) => (first ??= b), heldFree: !!opts.heldFree });
  const random = Math.random;
  Math.random = rng(seed);
  const arrivals = new Map<number, number>();
  const at = new Map<number, boolean>();
  const longestStand = new Map<number, number>();
  const standing = new Map<number, number>();
  const live = economyWorld(world.economy);
  let ticks = 0;
  try {
    const end = Math.round(seconds * SIM_HZ);
    for (; ticks < end; ) {
      while (e < events.length && events[e].at * SIM_HZ <= ticks) events[e++].do(world);
      world.sim.tick();
      world.economy.tick();
      ticks++;
      for (const engine of world.economy.lineIdOf.keys()) {
        const now = !!world.economy.routeOf(engine)?.at;
        if (now && !at.get(engine)) arrivals.set(engine, (arrivals.get(engine) ?? 0) + 1);
        at.set(engine, now);
      }
      opts.onTick?.(world);
      if (ticks % SIM_HZ === 0) stands(world, live, standing, longestStand);
      if (first && stopAtFirst) break;
    }
  } finally {
    Math.random = random;
    checks.off();
  }
  return { first, seconds: ticks / SIM_HZ, arrivals, checks, longestStand };
}

/** Once a second: each lever-on train's stand (s) so far, not busy by its own choice; its longest kept. */
function stands(world: World, live: ReturnType<typeof economyWorld>, standing: Map<number, number>, longest: Map<number, number>): void {
  const sim = world.sim;
  for (const id of sim.trainIds()) {
    const t = sim.getTrain(id)!;
    const engine = t.cars.find((c) => c.kind === "engine");
    if (!engine || engine.lever === 0 || t.derailed) continue;
    const still = t.speed === 0 && !live.busy!(t, engine.id);
    const n = still ? (standing.get(engine.id) ?? 0) + 1 : 0;
    standing.set(engine.id, n);
    if (n > (longest.get(engine.id) ?? 0)) longest.set(engine.id, n);
    if (!longest.has(engine.id)) longest.set(engine.id, 0);
  }
}

/** A world as "Copy map for a bug report" copies it (its save; no session, goals or progress): for hand-made maps. */
export async function bugMapText(world: World, mode: GameMode): Promise<string> {
  const save = JSON.stringify(serializeWorld(world));
  const key = modeKeys(mode)[0];
  return mapText(mode, { getItem: (k: string) => (k === key ? save : null) });
}

/** A break in words, for a report: the invariant, when, and what. */
export function describeBreak(b: Break): string {
  return `${b.invariant} at ${(b.tick / SIM_HZ).toFixed(1)} s: ${b.what}`;
}
