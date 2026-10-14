import type { CarKind } from "../sim";

export type CargoKind = "log" | "planks" | "grain" | "flour" | "stone";

/** Cargo kinds by snapshot index. */
export const CARGO_KINDS: readonly CargoKind[] = ["log", "planks", "grain", "flour", "stone"];

export const CARGO: Record<CargoKind, { readonly index: number; readonly label: string }> = {
  log: { index: 0, label: "Logs" },
  planks: { index: 1, label: "Planks" },
  grain: { index: 2, label: "Grain" },
  flour: { index: 3, label: "Flour" },
  stone: { index: 4, label: "Stone" },
};

/** What each kind of wagon carries: a kind of wagon per kind of goods (timber wagons take logs and planks). */
export const CARRIES: Partial<Record<CarKind, readonly CargoKind[]>> = {
  timber: ["log", "planks"],
  hopper: ["grain", "stone"],
  van: ["flour"],
};

/** Can this kind of car carry cargo (any, or this kind)? */
export function canCarry(kind: CarKind, cargo?: CargoKind): boolean {
  const list = CARRIES[kind];
  return !!list && (cargo === undefined || list.includes(cargo));
}
