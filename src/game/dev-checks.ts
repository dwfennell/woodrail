/**
 * The train invariants (src/sim/invariants.ts) on an `Economy`: the game's own world, as the dev builds, sections QA and
 * the play-throughs run it. `installDevChecks` is the dev builds' (`?dev`, or the dev server): main.ts calls it only
 * then, so a production build without `?dev` runs none of it. (A static import: a dynamic one split a 211 KB shared
 * chunk off the main bundle, one more fetch at every start; this way it's 8.9 KB, 3.4 KB gzipped, of the bundle.)
 */
import type { Economy } from "../economy";
import type { Train } from "../sim";
import { Invariants, type Break, type InvariantOptions, type InvariantWorld } from "../sim/invariants";
import { trainState } from "./engine-status";

/** Dev builds check every this many ticks (fronts every tick): about 4 times a second. */
export const DEV_EVERY = 30;

/** The world the invariants read, from an economy (its sim, sections, router and stalls). */
export function economyWorld(economy: Economy): InvariantWorld {
  return {
    layout: economy.layout,
    sim: economy.sim,
    sections: economy.sections,
    router: economy.router,
    stalls: economy.stalls,
    routed: (engine) => economy.routeOf(engine) !== undefined,
    target: (engine) => economy.routeTarget(engine),
    owner: (engine) => economy.ownerOf(engine),
    drive: (train) => economy.drive(train),
  };
}

/**
 * Stuck sanity, in the game: a lever-on train standing is explained if its card can say why (`trainState`: worked at a
 * depot, at a kit's stop, spacing, a line or points wait, stuck, a red signal, a lift…), or another train holds it
 * where it stands (`Sim.heldBy`: close behind, nose to nose, short of a crossing). What's left is "Held up" by nothing.
 */
export function explained(economy: Economy, train: Train, engine: number): boolean {
  if (economy.sim.heldBy(train.id) !== null) return true;
  const found = economy.sim.findCar(engine);
  const lever = found ? found.train.cars[found.index].lever : 0;
  return trainState(economy.sim, economy, train, lever).kind !== "held-up";
}

/** The invariants on an economy, checked from its tick (`Economy.checker`) until `off()`. */
export function economyChecks(economy: Economy, opts: InvariantOptions = {}): Invariants & { off(): void } {
  const checks = new Invariants(economyWorld(economy), { every: DEV_EVERY, excused: (t, e) => explained(economy, t, e), ...opts }) as Invariants & { off(): void };
  const unwatch = checks.watchThrows();
  economy.checker = checks;
  checks.off = () => {
    unwatch();
    if (economy.checker === checks) economy.checker = null;
  };
  return checks;
}

/**
 * The dev badge: red, at the top in the middle, once anything broke: the count and the latest break. It takes no taps
 * (`pointer-events: none`), so it never stands over a control a player or an e2e taps; the list is in the console
 * (`[invariants] …`, and `window.__invariants.summary()`).
 */
function badge(): { show(n: number, latest: string): void } {
  let el: HTMLDivElement | null = null;
  return {
    show(n, latest) {
      if (!el) {
        el = document.createElement("div");
        el.id = "dev-invariants";
        el.setAttribute("aria-hidden", "true");
        el.style.cssText =
          "position:fixed;left:50%;top:4px;transform:translateX(-50%);z-index:99999;pointer-events:none;padding:3px 8px;border-radius:6px;background:#c62828;color:#fff;font:600 11px/1.3 system-ui,sans-serif;max-width:min(80vw,420px);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:.9";
        document.body.appendChild(el);
      }
      el.textContent = `⚠ ${n} invariant break${n === 1 ? "" : "s"} · ${latest}`;
    },
  };
}

/** The latest invariant breaks the badge showed (dev builds), newest last: sent with a bug report. */
const recent: string[] = [];
export function recentBreaks(): string[] {
  return [...recent];
}

/** What dev builds need of the game: its economy now (a load swaps it). */
export interface DevGame {
  readonly economy: Economy;
}

/**
 * Dev builds: the invariants on the game's economy (moved to the new one when a load swaps it). Each break logs once
 * (per invariant and train or piece) with a short description, and the red badge counts them (it takes no taps). Call `frame()` from the
 * frame hook. `window.__invariants` has the checks, for e2e scripts.
 */
export function installDevChecks(game: DevGame): { frame(): void } {
  let on: Economy | null = null;
  let checks: (Invariants & { off(): void }) | null = null;
  const said = new Set<string>();
  let total = 0;
  const shown = badge();
  const onBreak = (b: Break) => {
    total++;
    const key = `${b.invariant}:${b.engine ?? ""}:${b.pieceId ?? ""}`;
    if (said.has(key)) return;
    said.add(key);
    const line = `${b.invariant}: ${b.what} (${(b.tick / 120).toFixed(1)} s)`;
    console.error(`[invariants] ${line}`);
    recent.push(line);
    if (recent.length > 5) recent.shift();
    shown.show(total, line);
  };
  const frame = () => {
    if (game.economy === on) return;
    checks?.off();
    on = game.economy;
    checks = economyChecks(on, { onBreak });
    (globalThis as { __invariants?: Invariants }).__invariants = checks;
  };
  frame();
  return { frame };
}
