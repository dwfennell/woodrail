import { Group, type Mesh, type Object3D } from "three";
import { Kit, TOY } from "../catalogue/kit";
import type { ShipPhase } from "../game/airship";
import { depotPoint } from "../game/harbours";
import type { Pose } from "../track";
import { AMBIENT_MIN_PX, type AmbientEye } from "./ambient";
import { MAST, MAST_HEIGHT } from "./depot-view";
import { PAD_H } from "./industry-dressing";
import type { Materials } from "./materials";

/** The airship's length (mm), for the ambient rule. */
const SHIP_SIZE = 130;

/** A mast the view draws an airship for. */
export interface MastAt {
  readonly id: number;
  readonly pose: Pose;
  readonly y: number;
}

/** The airship, facing +x: a cream envelope with a red band, tail fins and a blue gondola. Its nose at x = 0. */
function buildShip(k: Kit): Group {
  const cream = k.paint(TOY.cream);
  const g = k.group();
  const body = k.ball(cream, 22, -60, 0, 0);
  body.scale.set(2.8, 1, 1);
  g.add(body, k.cylX(k.paint(TOY.red), 22.4, 8, -30, 0, 0, 24));
  for (const [y, z, w, h] of [[16, 0, 22, 12], [-16, 0, 22, 12], [0, 16, 22, 2], [0, -16, 22, 2]] as const) g.add(k.box(k.paint(TOY.red), w, h === 12 ? 2 : 12, h === 12 ? 2 : 2, 0.5, -112, y, z));
  g.add(k.box(k.paint(TOY.blue), 26, 8, 10, 2, -58, -28, 0));
  g.traverse((o) => ((o as Mesh).isMesh ? ((o as Mesh).castShadow = true) : null));
  return g;
}

/**
 * Airships at mooring masts (Game mode). Tied up, each is drawn once at its mast's top; touring, it flies a slow loop
 * round the mast, posed from its mast's clock on frames drawn anyway, and asks for frames only while it's in view and
 * big enough to see move (the ambient rule). Paused, it holds still.
 */
export class AirshipView {
  readonly group = new Group();
  private readonly ships = new Map<number, Object3D>();
  private readonly shown = new Map<number, string>();
  private template: Group | null = null;

  constructor(
    private readonly mats: Materials,
    private readonly invalidate: () => void,
  ) {
    this.group.name = "airships";
  }

  get count(): number {
    return this.ships.size;
  }

  update(masts: readonly MastAt[], phase: (id: number) => ShipPhase, radius: number, height: number, eye: AmbientEye | null, paused: boolean): boolean {
    let moving = false;
    const here = new Set<number>();
    for (const m of masts) {
      here.add(m.id);
      let ship = this.ships.get(m.id);
      if (!ship) {
        // (At full detail: one of it, its envelope round.)
        this.template ??= buildShip(new Kit(this.mats, 1));
        ship = this.template.clone();
        this.ships.set(m.id, ship);
        this.group.add(ship);
      }
      const ph = phase(m.id);
      const top = depotPoint(m.pose, MAST.t, MAST.l);
      const key = ph.kind;
      if (this.shown.get(m.id) !== key) {
        this.shown.set(m.id, key);
        this.invalidate();
      }
      if (ph.kind === "docked") {
        // Nose to the mast's top, lying along the yard.
        ship.position.set(top.x, m.y + PAD_H + MAST_HEIGHT, top.z);
        ship.rotation.set(0, -m.pose.heading, 0);
        continue;
      }
      // Out from the mast, round the loop, and back (the loop starts and ends at the mast).
      const a = ph.u * Math.PI * 2;
      const r = radius * Math.sin(Math.PI * ph.u) ** 0.5;
      const cx = top.x + Math.cos(m.pose.heading) * r;
      const cz = top.z + Math.sin(m.pose.heading) * r;
      const x = cx + Math.cos(m.pose.heading + a) * r * 0.6;
      const z = cz + Math.sin(m.pose.heading + a) * r * 0.6;
      const y = m.y + PAD_H + MAST_HEIGHT + (height - MAST_HEIGHT) * Math.sin(Math.PI * ph.u);
      ship.position.set(x, y, z);
      ship.rotation.set(0, -(m.pose.heading + a + Math.PI / 2), 0);
      if (!paused && (!eye || eye.sees(x, y, z, SHIP_SIZE, AMBIENT_MIN_PX.boat, SHIP_SIZE * 2))) moving = true;
    }
    for (const [id, ship] of this.ships)
      if (!here.has(id)) {
        this.group.remove(ship);
        this.ships.delete(id);
        this.shown.delete(id);
      }
    return moving;
  }

  clear(): void {
    for (const s of this.ships.values()) this.group.remove(s);
    this.ships.clear();
    this.shown.clear();
  }
}
