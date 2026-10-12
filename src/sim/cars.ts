export type CarKind = "engine" | "hopper" | "passenger" | "caboose" | "timber";
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
  timber: { kind: "timber", index: 4, length: 84, bogieInset: 18, width: 32, mass: 1, powered: false },
};

/**
 * How a car looks: the same car underneath (length, speed, what it carries), in a different body. Each kind's first
 * look is its usual one.
 */
export type CarLook = "classic" | "tank" | "diesel" | "electric" | "dining" | "sleeper" | "double-decker" | "bay-window";
export const CAR_LOOKS: Record<CarKind, readonly CarLook[]> = {
  engine: ["classic", "tank", "diesel", "electric"],
  hopper: ["classic"],
  passenger: ["classic", "dining", "sleeper", "double-decker"],
  caboose: ["classic", "bay-window"],
  timber: ["classic"],
};
export const ALL_CAR_LOOKS: readonly CarLook[] = ["classic", "tank", "diesel", "electric", "dining", "sleeper", "double-decker", "bay-window"];

/** In snapshot-index order. */
export const CAR_KINDS: readonly CarKind[] = ["engine", "hopper", "passenger", "caboose", "timber"];

/** Gap between two coupled cars' end faces (mm). */
export const COUPLER_GAP = 2;

export const opposite = (p: Pole): Pole => (p === "N" ? "S" : "N");
