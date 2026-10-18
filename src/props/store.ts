/** A placed catalogue model: decorative, standing on the ground at (x, z), turned to `heading`. */
export interface Prop {
  readonly id: number;
  /** Catalogue asset id (`bldg-red-barn`). */
  readonly asset: string;
  x: number;
  z: number;
  heading: number;
  /** Height of the ground it stands on (a hill block's top, or 0 on the felt). */
  y: number;
  /** A town building's model (generated with the map): the building's id, while it still stands on its squares. */
  building?: number;
  /** The town it belongs to (town buildings). */
  town?: number;
  /** Colour variant (0 or none: the model's own colours). */
  variant?: number;
  /** Drawn at this scale of its model (none: 1): a town's landmark on a smaller lot than it wants. */
  scale?: number;
}

/** What a prop is part of, beyond its pose. */
export type PropLinks = Pick<Prop, "building" | "town" | "variant" | "scale">;

export type PropPose = Pick<Prop, "x" | "z" | "heading" | "y">;

/** The props on the map. `version` goes up with every change, for keyed caches. */
export class PropStore {
  private readonly props = new Map<number, Prop>();
  private nextId = 1;
  version = 0;

  add(asset: string, pose: PropPose, id?: number, links: PropLinks = {}): Prop {
    const prop: Prop = { id: id ?? this.nextId, asset, ...pose, ...links };
    this.nextId = Math.max(this.nextId, prop.id + 1);
    this.props.set(prop.id, prop);
    this.version++;
    return prop;
  }

  get(id: number): Prop | undefined {
    return this.props.get(id);
  }

  move(id: number, pose: PropPose): void {
    const p = this.props.get(id);
    if (!p) return;
    Object.assign(p, pose);
    this.version++;
  }

  /** Drop a prop's link to its town building (it's become an ordinary prop), or put it back. */
  setLinks(id: number, links: PropLinks): void {
    const p = this.props.get(id);
    if (!p) return;
    p.building = links.building;
    p.town = links.town;
    if ("variant" in links) p.variant = links.variant;
    this.version++;
  }

  remove(id: number): Prop | undefined {
    const p = this.props.get(id);
    if (p) {
      this.props.delete(id);
      this.version++;
    }
    return p;
  }

  all(): IterableIterator<Prop> {
    return this.props.values();
  }

  get size(): number {
    return this.props.size;
  }

  /** The asset ids in use (to load their models). */
  assets(): Set<string> {
    return new Set([...this.props.values()].map((p) => p.asset));
  }
}
