import type { CarKind } from "../sim";

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

/** A part of a split train in a few words: "engine + 2", "2 engines", "3 wagons". */
function part(cars: readonly CarKind[]): string {
  const engines = cars.filter((k) => k === "engine").length;
  const others = cars.length - engines;
  if (engines === 0) return plural(others, "wagon");
  const lead = engines === 1 ? "engine" : `${engines} engines`;
  return others > 0 ? `${lead} + ${others}` : lead;
}

/**
 * What Decouple's toast says, so it shows which part keeps the engine. One part has the engine: "Uncoupled 2 wagons"
 * (the other part). Otherwise both parts, the tapped car's first: "Split: engine + 1 | engine + 2", "Split: 1 wagon | 2 wagons".
 */
export function decoupleWords(mine: readonly CarKind[], away: readonly CarKind[]): string {
  const here = mine.includes("engine");
  const there = away.includes("engine");
  if (here !== there) return `Uncoupled ${plural(here ? away.length : mine.length, "wagon")}`;
  return `Split: ${part(mine)} | ${part(away)}`;
}
