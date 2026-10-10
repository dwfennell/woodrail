export type CarKind = "engine" | "hopper" | "passenger" | "caboose";
export type Pole = "N" | "S";

export interface CarSpec {
  readonly kind: CarKind;
  /** Index used in snapshots. */
  readonly index: number;
  /** Buffer face to buffer face, magnets included (mm). */
  readonly length: number;
  /** Distance from each end face to the nearest axle (mm). */
  readonly bogieInset: number;
  readonly width: number;
  readonly mass: number;
  readonly powered: boolean;
}

export const CAR_SPECS: Record<CarKind, CarSpec> = {
  engine: { kind: "engine", index: 0, length: 96, bogieInset: 20, width: 32, mass: 3, powered: true },
  hopper: { kind: "hopper", index: 1, length: 80, bogieInset: 18, width: 32, mass: 1, powered: false },
  passenger: { kind: "passenger", index: 2, length: 88, bogieInset: 18, width: 32, mass: 1, powered: false },
  caboose: { kind: "caboose", index: 3, length: 76, bogieInset: 18, width: 32, mass: 1, powered: false },
};

export const CAR_KINDS: readonly CarKind[] = ["engine", "hopper", "passenger", "caboose"];

/** Gap between two coupled cars' end faces (mm). */
export const COUPLER_GAP = 2;

export const opposite = (p: Pole): Pole => (p === "N" ? "S" : "N");
