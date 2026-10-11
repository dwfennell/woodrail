import type { CarKind } from "../sim";

export type CargoKind = "log" | "planks";

/** Cargo kinds by snapshot index. */
export const CARGO_KINDS: readonly CargoKind[] = ["log", "planks"];

export const CARGO: Record<CargoKind, { readonly index: number; readonly label: string }> = {
  log: { index: 0, label: "Logs" },
  planks: { index: 1, label: "Planks" },
};

/** Can this kind of car carry cargo? */
export function canCarry(kind: CarKind): boolean {
  return kind === "timber";
}
