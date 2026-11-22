import {
  BoxGeometry,
  BufferGeometry,
  CapsuleGeometry,
  ConeGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Group,
  LatheGeometry,
  Matrix4,
  Mesh,
  Object3D,
  Shape,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  type Material,
} from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { slabProfile } from "./track-profile";
import { mapBoardGrain } from "../render/wood-grain";
import type { Materials } from "../render/materials";

// Align the grain with the length of tall posts and crosswise axles as well as horizontal boards.
const uprightGrain = new Matrix4().makeRotationZ(-Math.PI / 2);
const crosswiseGrain = new Matrix4().makeRotationY(Math.PI / 2);

/**
 * Building blocks for catalogue assets: turned and sawn wood, lacquered in toy colours. Sizes in mm, the game's scale
 * (track 40 wide, 12 thick; a car about 80–96 long, 32 wide; a hill block 72 square, 64 high; a peg person 18 tall).
 * y is up, assets stand on y = 0 and face +x (a train's front) unless they've no front.
 */
export class Kit {
  /**
   * `detail` below 1 builds with fewer segments round curves (in the game, where models are small on screen and many):
   * at most `detail` of the usual count, and about one segment per few mm of circumference, never fewer than 6.
   */
  constructor(
    readonly mats: Materials,
    readonly detail = 1,
    /** Recolours the paint (a colour variant of a model): every `paint` colour goes through it. */
    readonly recolor: (color: string) => string = (c) => c,
  ) {}

  /** Segments round a curve of radius `r` (mm), at most `n`. */
  private seg(n: number, r: number): number {
    // Few segments are a shape, not a curve (a four-sided pyramid roof, a hexagonal nut): keep them.
    if (this.detail >= 1 || n <= 8) return n;
    return Math.max(6, Math.min(Math.ceil(n * this.detail), Math.ceil((2 * Math.PI * r) / 2.5)));
  }

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
    return this.mats.lacquer(this.recolor(color));
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
    const g = rr > 0.05 ? new RoundedBoxGeometry(w, h, d, this.detail >= 1 ? 2 : 1, rr) : new BoxGeometry(w, h, d);
    return this.mesh(g, mat, x, y + h / 2, z);
  }

  /** Ease the two rims of a substantial turned wooden part, keeping its axle, height and outside diameter. */
  private cylinder(mat: Material, bottom: number, top: number, height: number, segments: number): BufferGeometry {
    const count = this.seg(segments, Math.max(bottom, top));
    const wood = mat === this.wood || mat === this.cut || mat.userData.paintColor;
    if (!wood || Math.min(bottom, top) < 3 || height < 4 || segments <= 8) {
      return new CylinderGeometry(top, bottom, height, count);
    }
    const half = height / 2;
    const edge = Math.min(1.1, Math.min(bottom, top) * 0.12, height * 0.09);
    return new LatheGeometry([
      new Vector2(0, -half), new Vector2(bottom - edge, -half), new Vector2(bottom, -half + edge),
      new Vector2(top, half - edge), new Vector2(top - edge, half), new Vector2(0, half),
    ], count);
  }

  /** An upright cylinder (or a cone frustum, `rTop` ≠ `rBottom`), its base on y = `y`. */
  cyl(mat: Material, rBottom: number, h: number, x = 0, y = 0, z = 0, rTop = rBottom, segments = 28): Mesh {
    return this.mesh(this.cylinder(mat, rBottom, rTop, h, segments), mat, x, y + h / 2, z);
  }

  /** A cylinder lying along x (an axle, a log, a boiler), centred at (x, y, z). */
  cylX(mat: Material, r: number, length: number, x = 0, y = 0, z = 0, segments = 28): Mesh {
    const g = this.cylinder(mat, r, r, length, segments);
    g.rotateZ(Math.PI / 2);
    return this.mesh(g, mat, x, y, z);
  }

  /** A cylinder lying along z (a wheel's axle across the track, a drum), centred at (x, y, z). */
  cylZ(mat: Material, r: number, length: number, x = 0, y = 0, z = 0, segments = 28): Mesh {
    const g = this.cylinder(mat, r, r, length, segments);
    g.rotateX(Math.PI / 2);
    return this.mesh(g, mat, x, y, z);
  }

  /** A ball, centred at (x, y, z). Squash with `sy`. */
  ball(mat: Material, r: number, x = 0, y = 0, z = 0, sy = 1): Mesh {
    const m = this.mesh(new SphereGeometry(r, this.seg(24, r), Math.max(4, Math.ceil(this.seg(24, r) * 0.67))), mat, x, y, z);
    m.scale.y = sy;
    return m;
  }

  /** A cone, its base on y = `y`. */
  cone(mat: Material, r: number, h: number, x = 0, y = 0, z = 0, segments = 24): Mesh {
    return this.mesh(new ConeGeometry(r, h, this.seg(segments, r)), mat, x, y + h / 2, z);
  }

  /** A capsule (a pill), upright, its base on y = `y`. */
  capsule(mat: Material, r: number, length: number, x = 0, y = 0, z = 0): Mesh {
    return this.mesh(new CapsuleGeometry(r, length, this.detail >= 1 ? 6 : 3, this.seg(16, r)), mat, x, y + length / 2 + r, z);
  }

  /** A ring (torus) lying flat in x/z, centred at (x, y, z); `upright` stands it in the x/y plane. */
  ring(mat: Material, r: number, tube: number, x = 0, y = 0, z = 0, upright = false, arc = Math.PI * 2): Mesh {
    const g = new TorusGeometry(r, tube, this.seg(12, tube), this.seg(32, r), arc);
    if (!upright) g.rotateX(Math.PI / 2);
    return this.mesh(g, mat, x, y, z);
  }

  /** A turned shape: (radius, height) profile points from the bottom up, spun round y; its base on y = `y`. */
  lathe(mat: Material, profile: readonly [number, number][], x = 0, y = 0, z = 0, segments = 32, minSegments = 0): Mesh {
    return this.mesh(new LatheGeometry(
        profile.map(([r, h]) => new Vector2(r, h)),
        Math.max(minSegments, this.seg(segments, Math.max(...profile.map(([r]) => r)))),
      ), mat, x, y, z);
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
    const half = width / 2;
    const rim = this.lathe(this.paint(color), [
      [0, -half + 0.5], [r - 1.3, -half], [r, -half + 0.8],
      [r, half - 0.8], [r - 1.3, half], [r - 2, half - 0.5], [0, half - 0.5],
    ], 0, 0, 0, 32, 16);
    rim.rotation.x = Math.sign(z || 1) * Math.PI / 2;
    const pin = this.lathe(this.mats.nickel, [[1.9, 0], [1.9, 0.7], [1.4, 1.35], [0, 1.7]], 0, 0, Math.sign(z || 1) * (half - 0.5), 24, 12);
    pin.rotation.x = rim.rotation.x;
    g.add(rim, pin);
    return this.at(g, x, y, z);
  }

  /** Two pairs of wheels under a car `length` long (axles `inset` in from each end), as the game's cars sit on track. */
  bogies(length: number, inset = 18, color = "#c8442f"): Group {
    const g = new Group();
    for (const x of [-(length / 2 - inset), length / 2 - inset]) for (const z of [-13, 13]) g.add(this.wheel(6.5, x, 7.5, z, color));
    return g;
  }

  /** A magnet coupler disc on a car's end (`end` +1 front, −1 back). */
  coupler(length: number, end: 1 | -1, y = 11.5): Mesh {
    const disc = this.lathe(this.mats.nickel, [
      [0, -4.5], [2.2, -4.5], [2.2, -2.7], [4.4, -2.7], [5, -2.1], [5, 0.25], [4.5, 1], [0, 1],
    ], end * length / 2, y, 0, 32, 16);
    disc.rotation.z = -end * Math.PI / 2;
    return disc;
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

  /**
   * A piece of straight track, `length` long along x, centred, with its two grooves (no connectors). Marked as a slab
   * (`userData.slab`, named "slab"), so a kit piece drawing this model over real track can leave it out (`isSlab`).
   */
  trackSlab(length: number, x = 0, y = 0, z = 0): Group {
    const g = new Group();
    g.name = "slab";
    g.userData.slab = true;
    const board = this.extrude(this.wood, slabProfile(40, [0]), length, 0, 0, 0, 0);
    g.add(board.rotateY(Math.PI / 2));
    for (const gz of [-13, 13]) g.add(this.box(this.cut, length - 1, 0.55, 3.6, 0, 0, 8.85, gz));
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
    if (mat === this.wood || mat === this.cut || mat.userData.paintColor) {
      g.computeBoundingBox();
      const { min, max } = g.boundingBox!;
      const w = max.x - min.x, h = max.y - min.y, d = max.z - min.z;
      const grain = h > w && h > d ? uprightGrain : d > w ? crosswiseGrain : undefined;
      mapBoardGrain(g, grain);
    }
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
