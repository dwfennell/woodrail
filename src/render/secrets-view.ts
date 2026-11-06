import type { Object3D, Vector3 } from "three";
import { frameOf, type SecretSite } from "../landscape";
import type { Prop } from "../props/store";
import type { PropLibrary } from "./props/library";
import { PropsView, type BatchStart } from "./props/props-view";

const SECRETS_START: BatchStart = { instances: 8, vertices: 1 << 12, indices: 1 << 14 };

/** A secret drawn here: a hidden one (in the mist), or found stones in midsummer (their garlands and bonfire). */
export interface ShownSecret {
  site: SecretSite;
  /** Midsummer at found stones: their dressing drawn over them (the found model itself is its halt's kit piece). */
  midsummer?: boolean;
}

/**
 * The secret sites not yet found, each its hidden model (`secret-<kind>-hidden`) standing in its frame, and found
 * stones' midsummer dressing in June. A found site is its halt's kit piece (drawn with the kits). Drawn as props are,
 * by a `PropsView` of its own (one batched mesh per material, each site an instance, culled on its own; far versions
 * far off): static, built only when the sites shown change (`sync`), nothing per frame. Its models are fetched only once
 * a site is shown (the secrets' file is its own chunk).
 */
export class SecretsView {
  private readonly view: PropsView;
  readonly group;
  private readonly ids = new Map<string, number>();
  private nextId = 1;
  private key = "";
  private readonly source = {
    version: 0,
    shown: new Map<number, Prop>(),
    get: (id: number) => this.source.shown.get(id),
    all: () => this.source.shown.values(),
  };

  constructor(library: PropLibrary) {
    // A few sites, a few thousand vertices: batches start small (the default's room for a world of props was about
    // 1.5 MB a material, empty).
    this.view = new PropsView(library, SECRETS_START);
    this.group = this.view.group;
    this.group.name = "secrets";
  }

  /** Show these sites. Only what changed is touched; `force` once a model has arrived. True if anything changed. */
  sync(shown: readonly ShownSecret[], force = false): boolean {
    const key = shown.map((s) => `${s.site.kind}@${s.site.piece.x},${s.site.piece.z},${s.site.piece.heading}${s.site.found ? (s.midsummer ? "m" : "f") : "h"}`).join(";");
    if (key === this.key && !force) return false;
    if (key !== this.key) {
      this.key = key;
      const next = new Map<number, Prop>();
      for (const s of shown) {
        const asset = s.site.found ? (s.midsummer && s.site.kind === "stones" ? "secret-stones-midsummer" : null) : `secret-${s.site.kind}-hidden`;
        if (!asset) continue;
        const f = frameOf(s.site.piece);
        const k = `${asset}@${f.x.toFixed(1)},${f.z.toFixed(1)}`;
        let id = this.ids.get(k);
        if (id === undefined) this.ids.set(k, (id = this.nextId++));
        next.set(id, { id, asset, x: f.x, z: f.z, heading: f.heading, y: 0 });
      }
      this.source.shown = next;
      this.source.version++;
    }
    return this.view.sync(this.source, -1, force);
  }

  /** Far off, drawn in their models' far versions (see `PropsView.setDetail`). */
  setDetail(eye: Vector3, pxScale: number, moving: boolean): boolean {
    return this.view.setDetail(eye, pxScale, moving);
  }

  /** Is this object (a ray's hit) one of this view's? */
  holds(object: Object3D): boolean {
    for (let o: Object3D | null = object; o; o = o.parent) if (o === this.group) return true;
    return false;
  }

  /** Is a model key one this view draws (to sync it again when it arrives)? */
  static draws(key: string): boolean {
    return key.startsWith("secret-");
  }
}
