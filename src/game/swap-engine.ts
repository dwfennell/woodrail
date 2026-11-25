import type { Economy } from "../economy";
import type { CarLook, Sim, Train } from "../sim";
import { isRack, type Layout } from "../track";
import { ENGINES } from "./engines";
import { speedWord } from "./train-summary";

/**
 * Swap engine (spec 2026-11-23-swap-engine.md): an engine's kind is only its look (`Sim.lookOf`; Game mode reads its
 * pull, speed, power and rack from that look each time it asks), so a swap sets the look on the same car. Same id: the
 * train keeps its line and its place on it, its wagons and loads, the engine's name, paint and lever. Free: the toy box
 * counts engines (`car:engine`), and a look costs nothing once learned.
 */

/** The engines a train's engine can become, in the tray's order. (Not the metro's or the Royal Train's: see `SPECIAL`.) */
export const SWAP_LOOKS: readonly CarLook[] = ["classic", "tank", "diesel", "electric", "express", "goods", "rack"];

/** A train of three cars in one look, with a price or a gift of its own: its engine stays as it is, and none becomes one. */
const SPECIAL: ReadonlySet<CarLook> = new Set<CarLook>(["metro", "royal"]);

export type SwapRefusal = "none" | "moving" | "crane" | "special" | "locked" | "rack" | "same";

/** Why a swap is refused, as the card's greyed button and the sheet say it ("" for the ones nothing need say). */
export const SWAP_WHY: Record<SwapRefusal, string> = {
  none: "",
  moving: "Stop the train first",
  crane: "Not while the crane has it",
  special: "This train keeps its own engine",
  locked: "Not learned yet",
  rack: "Bring it off the rack first",
  same: "",
};

/** What a swap looks at: the sim, the track (racks), and the breakdown cranes' jobs. */
export interface SwapWorld {
  readonly sim: Sim;
  readonly layout: Layout;
  readonly economy: Pick<Economy, "breakdown">;
}

/**
 * Game mode's rules (null: Sandbox's, where any engine goes anywhere): the blueprint an engine's look still needs, by
 * its name ("Diesel"), or null once it's learned.
 */
export interface SwapRules {
  locked(look: CarLook): string | null;
}

/** Engine `carId`'s train, if it's an engine on the track. */
function trainOf(sim: Sim, carId: number): Train | null {
  const found = sim.findCar(carId);
  return found && found.train.cars[found.index].kind === "engine" ? found.train : null;
}

/**
 * Why engine `carId` can't become `look` now (null: it can). With no `look`, the reasons that don't hang on which
 * engine it becomes (the card's button). Cheap: a few lookups, and the racks only when it stands on one.
 */
export function swapRefusal(w: SwapWorld, carId: number, look: CarLook | null, rules: SwapRules | null): SwapRefusal | null {
  const train = trainOf(w.sim, carId);
  if (!train) return "none";
  if (SPECIAL.has(w.sim.lookOf(carId)) || (look && SPECIAL.has(look))) return "special";
  if (train.derailed || train.cars.some((c) => w.economy.breakdown.jobFor(c.id) || w.economy.breakdown.jobOf(c.id))) return "crane";
  if (!w.sim.standing(train)) return "moving";
  if (!look) return null;
  if (look === w.sim.lookOf(carId)) return "same";
  if (rules && rules.locked(look)) return "locked";
  // (Game mode: standing on a rack, it would be stuck there without a rack engine. Sandbox lets any train climb.)
  if (rules && look !== "rack" && !train.cars.some((c) => c.kind === "engine" && c.id !== carId && w.sim.lookOf(c.id) === "rack")) {
    for (const id of w.sim.piecesUnder(train.id)) {
      const p = w.layout.getPiece(id);
      if (p && isRack(p.type)) return "rack";
    }
  }
  return null;
}

/** A row of the sheet: an engine the open one could become, what it does, and what's to say of it. */
export interface SwapChoice {
  readonly look: CarLook;
  /** "Tank engine". */
  readonly label: string;
  /** Game mode: "Pulls 3 · steady" ("" in Sandbox, where every engine runs alike). */
  readonly stats: string;
  /** "This one", "Learn Diesel first", "Too weak for 5 cars", …; "" for nothing. */
  readonly note: string;
  /** current: the engine it is; ok: a tap swaps it; warn: a tap swaps it, the note says what to mind; locked: no tap. */
  readonly state: "current" | "ok" | "warn" | "locked";
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The sheet's rows for engine `carId`: every engine it could be, in the tray's order. Built when the sheet draws. */
export function swapChoices(w: SwapWorld, carId: number, rules: SwapRules | null): SwapChoice[] {
  const train = trainOf(w.sim, carId);
  const now = w.sim.lookOf(carId);
  // What the train's other engines pull, and its cars (engines aside): what the new one must make up.
  let others = 0;
  let cars = 0;
  for (const c of train?.cars ?? []) {
    if (c.kind !== "engine") cars++;
    else if (c.id !== carId) others += (ENGINES[w.sim.lookOf(c.id)] ?? ENGINES.classic!).pulls;
  }
  return SWAP_LOOKS.map((look) => {
    const e = ENGINES[look]!;
    const label = capital(e.label);
    const stats = rules ? `Pulls ${e.pulls} · ${speedWord(e.speed)}` : "";
    if (look === now) return { look, label, stats, note: "This one", state: "current" };
    const needs = rules?.locked(look);
    if (needs) return { look, label, stats, note: `Learn ${needs} first`, state: "locked" };
    if (rules && others + e.pulls < cars) return { look, label, stats, note: `Too weak for ${cars} cars`, state: "warn" };
    if (rules && e.electric) return { look, label, stats, note: "Needs ⚡ power, else steam speed", state: "ok" };
    if (e.rack) return { look, label, stats, note: "Climbs racks", state: "ok" };
    return { look, label, stats, note: "", state: "ok" };
  });
}

/** Swap engine `carId` for `look`, if it may (`swapRefusal`): the look it had, or null where it was refused. */
export function swapEngine(w: SwapWorld, carId: number, look: CarLook, rules: SwapRules | null): CarLook | null {
  if (swapRefusal(w, carId, look, rules) !== null) return null;
  const was = w.sim.lookOf(carId);
  w.sim.setLook(carId, look);
  return was;
}

/** "Rowan is a goods engine now". */
export function swappedWords(name: string, look: CarLook): string {
  const label = (ENGINES[look] ?? ENGINES.classic!).label;
  return `${name || "The train"} is ${/^[aeiou]/.test(label) ? "an" : "a"} ${label} now`;
}
