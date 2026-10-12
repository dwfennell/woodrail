import {
  BoxGeometry,
  BufferGeometry,
  CapsuleGeometry,
  ConeGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Group,
  LatheGeometry,
  Mesh,
  Object3D,
  Shape,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  type Material,
} from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { Materials } from "../render/materials";

/**
 * Building blocks for catalogue assets: turned and sawn wood, lacquered in toy colours. Sizes in mm, the game's scale
 * (track 40 wide, 12 thick; a car about 80–96 long, 32 wide; a hill block 72 square, 64 high; a peg person 18 tall).
 * y is up, assets stand on y = 0 and face +x (a train's front) unless they've no front.
 */
export class Kit {
  constructor(readonly mats: Materials) {}

  // ——— Materials ———

  /** Bare beech, clear-coated (track, turned wood, unpainted parts). */
  get wood(): Material {
    return this.mats.naturalWood;
  }
  /** Matte, darker routed wood (grooves, holes, cut faces). */
  get cut(): Material {
    return this.mats.trackCut;
  }
  /** Gloss lacquer in any colour. */
  paint(color: string): Material {
    return this.mats.lacquer(color);
  }
  get metal(): Material {
    return this.mats.magnet;
  }
  get glass(): Material {
    return this.mats.glass;
  }
  get coal(): Material {
    return this.mats.coal;
  }
  /** Green felt (the mat), blue felt (water), grey felt (road). */
  get felt(): Material {
    return this.mats.felt;
  }
  get water(): Material {
    return this.mats.riverFelt;
  }
  get road(): Material {
    return this.mats.roadFelt;
  }

  // ——— Shapes (each a Mesh, already placed with its base or centre as noted) ———

  /** A box with rounded edges (radius `r`), its base on y = `y`, centred on x/z. */
  box(mat: Material, w: number, h: number, d: number, r = 1.5, x = 0, y = 0, z = 0): Mesh {
    const rr = Math.min(r, w / 2 - 0.01, h / 2 - 0.01, d / 2 - 0.01);
    const g = rr > 0.05 ? new RoundedBoxGeometry(w, h, d, 2, rr) : new BoxGeometry(w, h, d);
    return this.mesh(g, mat, x, y + h / 2, z);
  }

  /** An upright cylinder (or a cone frustum, `rTop` ≠ `rBottom`), its base on y = `y`. */
  cyl(mat: Material, rBottom: number, h: number, x = 0, y = 0, z = 0, rTop = rBottom, segments = 28): Mesh {
    return this.mesh(new CylinderGeometry(rTop, rBottom, h, segments), mat, x, y + h / 2, z);
  }

  /** A cylinder lying along x (an axle, a log, a boiler), centred at (x, y, z). */
  cylX(mat: Material, r: number, length: number, x = 0, y = 0, z = 0, segments = 28): Mesh {
    const g = new CylinderGeometry(r, r, length, segments);
    g.rotateZ(Math.PI / 2);
    return this.mesh(g, mat, x, y, z);
  }

  /** A cylinder lying along z (a wheel's axle across the track, a drum), centred at (x, y, z). */
  cylZ(mat: Material, r: number, length: number, x = 0, y = 0, z = 0, segments = 28): Mesh {
    const g = new CylinderGeometry(r, r, length, segments);
    g.rotateX(Math.PI / 2);
    return this.mesh(g, mat, x, y, z);
  }

  /** A ball, centred at (x, y, z). Squash with `sy`. */
  ball(mat: Material, r: number, x = 0, y = 0, z = 0, sy = 1): Mesh {
    const m = this.mesh(new SphereGeometry(r, 24, 16), mat, x, y, z);
    m.scale.y = sy;
    return m;
  }

  /** A cone, its base on y = `y`. */
  cone(mat: Material, r: number, h: number, x = 0, y = 0, z = 0, segments = 24): Mesh {
    return this.mesh(new ConeGeometry(r, h, segments), mat, x, y + h / 2, z);
  }

  /** A capsule (a pill), upright, its base on y = `y`. */
  capsule(mat: Material, r: number, length: number, x = 0, y = 0, z = 0): Mesh {
    return this.mesh(new CapsuleGeometry(r, length, 6, 16), mat, x, y + length / 2 + r, z);
  }

  /** A ring (torus) lying flat in x/z, centred at (x, y, z); `upright` stands it in the x/y plane. */
  ring(mat: Material, r: number, tube: number, x = 0, y = 0, z = 0, upright = false, arc = Math.PI * 2): Mesh {
    const g = new TorusGeometry(r, tube, 12, 32, arc);
    if (!upright) g.rotateX(Math.PI / 2);
    return this.mesh(g, mat, x, y, z);
  }

  /** A turned shape: (radius, height) profile points from the bottom up, spun round y; its base on y = `y`. */
  lathe(mat: Material, profile: readonly [number, number][], x = 0, y = 0, z = 0, segments = 32): Mesh {
    return this.mesh(new LatheGeometry(profile.map(([r, h]) => new Vector2(r, h)), segments), mat, x, y, z);
  }

  /**
   * A flat outline (in x/y, as drawn on paper) cut `depth` thick along z, centred on z = 0: gables, arches, signs,
   * animal silhouettes. `bevel` rounds its edges.
   */
  extrude(mat: Material, outline: readonly [number, number][] | Shape, depth: number, x = 0, y = 0, z = 0, bevel = 0.8): Mesh {
    const shape = outline instanceof Shape ? outline : new Shape(outline.map(([a, b]) => new Vector2(a, b)));
    const g = new ExtrudeGeometry(shape, {
      depth: Math.max(0.1, depth - 2 * bevel),
      bevelEnabled: bevel > 0,
      bevelThickness: bevel,
      bevelSize: bevel,
      bevelSegments: 2,
      curveSegments: 16,
    });
    g.translate(0, 0, -(depth - 2 * bevel) / 2);
    return this.mesh(g, mat, x, y, z);
  }

  /** A gable roof along x: `w` long, `d` across, `h` high to the ridge, its eaves on y = `y`, `t` thick. */
  roof(mat: Material, w: number, d: number, h: number, x = 0, y = 0, z = 0, t = 3): Group {
    const g = new Group();
    const slope = Math.hypot(d / 2, h);
    const angle = Math.atan2(h, d / 2);
    for (const side of [-1, 1]) {
      const panel = this.box(mat, w, t, slope + 2, 1);
      panel.position.set(0, h / 2, (side * d) / 4);
      panel.rotation.x = side * angle;
      g.add(panel);
    }
    return this.at(g, x, y, z);
  }

  /** A train wheel (painted rim colour optional), its axle along z, centred at (x, y, z). */
  wheel(r = 6, x = 0, y = 6, z = 0, color = "#c8442f", width = 4.5): Group {
    const g = new Group();
    g.add(this.cylZ(this.paint(color), r, width, 0, 0, 0));
    g.add(this.cylZ(this.wood, r * 0.45, width + 0.6, 0, 0, 0, 16));
    return this.at(g, x, y, z);
  }

  /** Two pairs of wheels under a car `length` long (axles `inset` in from each end), as the game's cars sit on track. */
  bogies(length: number, inset = 18, color = "#c8442f"): Group {
    const g = new Group();
    for (const x of [-(length / 2 - inset), length / 2 - inset]) for (const z of [-13, 13]) g.add(this.wheel(6, x, 7.5, z, color));
    return g;
  }

  /** A magnet coupler disc on a car's end (`end` +1 front, −1 back). */
  coupler(length: number, end: 1 | -1, y = 10): Mesh {
    const m = this.cylX(this.metal, 3.5, 3, end * (length / 2 + 1), y, 0, 16);
    return m;
  }

  /** A peg person (about 18 mm): turned body in `coat`, beech head, optional hat. */
  peg(coat = "#2f6db5", hat: string | null = null, x = 0, y = 0, z = 0): Group {
    const g = new Group();
    g.add(this.cyl(this.paint(coat), 4.2, 11, 0, 0, 0, 3.2, 16));
    g.add(this.ball(this.wood, 3.4, 0, 14, 0));
    if (hat) {
      g.add(this.cyl(this.paint(hat), 4, 0.9, 0, 15.9, 0, 4, 16));
      g.add(this.cyl(this.paint(hat), 2.8, 3, 0, 16.6, 0, 2.6, 16));
    }
    return this.at(g, x, y, z);
  }

  /** A piece of straight track, `length` long along x, centred, with its two grooves (no connectors). */
  trackSlab(length: number, x = 0, y = 0, z = 0): Group {
    const g = new Group();
    g.add(this.box(this.wood, length, 12, 40, 1.5));
    for (const gz of [-13, 13]) g.add(this.box(this.cut, length - 0.2, 0.6, 6, 0, 0, 11.6, gz));
    return this.at(g, x, y, z);
  }

  /** A round felt base `r` across, for scenery that comes on its own little mat. */
  feltDisc(r: number, mat: Material = this.felt): Mesh {
    return this.cyl(mat, r, 1.2, 0, 0, 0, r, 48);
  }

  // ——— Placing ———

  /** Put an object at (x, y, z), turned `ry` about y. */
  at<T extends Object3D>(o: T, x = 0, y = 0, z = 0, ry = 0): T {
    o.position.set(o.position.x + x, o.position.y + y, o.position.z + z);
    if (ry) o.rotation.y += ry;
    return o;
  }

  /** A group of parts. */
  group(...parts: Object3D[]): Group {
    const g = new Group();
    for (const p of parts) g.add(p);
    return g;
  }

  /** Repeat a part `n` times, `make(i)` for each. */
  many(n: number, make: (i: number) => Object3D): Group {
    const g = new Group();
    for (let i = 0; i < n; i++) g.add(make(i));
    return g;
  }

  private mesh(g: BufferGeometry, mat: Material, x: number, y: number, z: number): Mesh {
    const m = new Mesh(g, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }
}

/** Toy palette: the game's lacquer colours, and a few more. */
export const TOY = {
  red: "#c8442f",
  blue: "#2f6db5",
  green: "#2d6b3f",
  leaf: "#3c8f4e",
  yellow: "#e6b52c",
  cream: "#f0ebe0",
  black: "#2a2b2e",
  orange: "#e07a2e",
  purple: "#6b4a8f",
  pink: "#e98aa8",
  sky: "#7fb7e0",
  brown: "#7a4a2a",
  grey: "#8d8f93",
  white: "#f6f3ec",
  teal: "#2a8c8c",
} as const;
