import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  PlaneGeometry,
  PMREMGenerator,
  Scene,
  Color,
  Fog,
  type WebGLRenderer,
  ExtrudeGeometry,
  Shape,
  type Material,
} from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { Materials } from "./materials";
import { rng } from "./textures";
import type { QualitySettings } from "./quality";

export const RUG_WIDTH = 2800;
export const RUG_DEPTH = 2000;
const RUG_THICKNESS = 7;
export const FLOOR_Y = -RUG_THICKNESS;

export interface Room {
  group: Group;
  sun: DirectionalLight;
  /** Fit the sun's shadow camera around an area centred at (x, z). */
  fitShadow(x: number, z: number, radius: number): void;
}

function shadowed<T extends Mesh>(m: T, cast = true, receive = true): T {
  m.castShadow = cast;
  m.receiveShadow = receive;
  return m;
}

export function createRoom(scene: Scene, renderer: WebGLRenderer, mats: Materials, quality: QualitySettings): Room {
  const group = new Group();
  scene.add(group);

  const pmrem = new PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.28;
  scene.background = new Color("#cbbba3");
  scene.fog = new Fog("#cbbba3", 9000, 26000);

  // Floor and rug: the rug's top is the play surface at y = 0.
  const floor = shadowed(new Mesh(new PlaneGeometry(30000, 30000), mats.floor), false, true);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = FLOOR_Y;
  const floorUv = floor.geometry.getAttribute("uv");
  for (let i = 0; i < floorUv.count; i++) floorUv.setXY(i, floorUv.getX(i) * 30000, floorUv.getY(i) * 30000);
  group.add(floor);

  const rug = shadowed(new Mesh(new RoundedBoxGeometry(RUG_WIDTH, RUG_THICKNESS, RUG_DEPTH, 2, 3), mats.rug), false, true);
  rug.position.y = -RUG_THICKNESS / 2;
  group.add(rug);

  // Walls behind and to the left, with skirting boards.
  const wallH = 6000;
  const back = new Mesh(new PlaneGeometry(30000, wallH), mats.wall);
  back.position.set(0, FLOOR_Y + wallH / 2, -4200);
  back.receiveShadow = true;
  group.add(back);
  const left = new Mesh(new PlaneGeometry(30000, wallH), mats.wall);
  left.rotation.y = Math.PI / 2;
  left.position.set(-5600, FLOOR_Y + wallH / 2, 0);
  left.receiveShadow = true;
  group.add(left);
  const skirtBack = shadowed(new Mesh(new BoxGeometry(30000, 120, 18), mats.skirting));
  skirtBack.position.set(0, FLOOR_Y + 60, -4200 + 9);
  group.add(skirtBack);
  const skirtLeft = shadowed(new Mesh(new BoxGeometry(18, 120, 30000), mats.skirting));
  skirtLeft.position.set(-5600 + 9, FLOOR_Y + 60, 0);
  group.add(skirtLeft);

  addToys(group, mats);

  // Light: warm low sun from a window to the right, soft sky fill.
  const sun = new DirectionalLight(new Color("#ffdcb0"), 4.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
  sun.shadow.bias = -0.00015;
  sun.shadow.normalBias = 0.6;
  sun.shadow.radius = 4;
  sun.shadow.blurSamples = 12;
  scene.add(sun);
  scene.add(sun.target);
  scene.add(new HemisphereLight(new Color("#ffeedd"), new Color("#6b4a30"), 0.18));

  const sunDir = { x: 0.7, y: 0.55, z: 0.45 };
  const fitShadow = (x: number, z: number, radius: number) => {
    const dist = 6000;
    sun.position.set(x + sunDir.x * dist, sunDir.y * dist, z + sunDir.z * dist);
    sun.target.position.set(x, 0, z);
    const cam = sun.shadow.camera;
    cam.left = -radius;
    cam.right = radius;
    cam.top = radius;
    cam.bottom = -radius;
    cam.near = 100;
    cam.far = dist * 2;
    cam.updateProjectionMatrix();
  };
  fitShadow(0, 0, 2000);

  return { group, sun, fitShadow };
}

/** Wooden building blocks and trees around the edge of the rug: a toy town waiting to grow. */
function addToys(group: Group, mats: Materials): void {
  const r = rng(2024);
  const colors = ["#c8442f", "#2f6db5", "#e6b52c", "#3c8f4e", "#f0ebe0"];
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const place = (m: Mesh, x: number, z: number, y = 0, rot = r() * Math.PI) => {
    m.position.set(x, y, z);
    m.rotation.y = rot;
    shadowed(m);
    group.add(m);
  };

  const house = (x: number, z: number, scale: number) => {
    const body: Material = pick([mats.lacquer("#f0ebe0"), mats.lacquer("#e9d9b8"), mats.naturalWood]);
    const roof = mats.lacquer(pick(["#c8442f", "#2f6db5", "#3c8f4e"]));
    const w = 70 * scale;
    const h = 60 * scale;
    const d = 60 * scale;
    const g = new Group();
    const b = shadowed(new Mesh(new RoundedBoxGeometry(w, h, d, 2, 2.5), body));
    b.position.y = h / 2;
    g.add(b);
    const tri = new Shape();
    tri.moveTo(-w / 2 - 4, 0);
    tri.lineTo(w / 2 + 4, 0);
    tri.lineTo(0, h * 0.62);
    tri.lineTo(-w / 2 - 4, 0);
    const roofGeo = new ExtrudeGeometry(tri, { depth: d + 6, bevelEnabled: true, bevelSize: 1.5, bevelThickness: 1.5, bevelSegments: 2 });
    roofGeo.translate(0, 0, -(d + 6) / 2);
    const rf = shadowed(new Mesh(roofGeo, roof));
    rf.position.y = h;
    g.add(rf);
    for (const side of [-1, 0, 1]) {
      const win = new Mesh(new BoxGeometry(w * 0.16, h * 0.2, 1.5), mats.glass);
      win.position.set(side * w * 0.28, h * 0.68, d / 2 + 0.5);
      g.add(win);
    }
    const sideWin = new Mesh(new BoxGeometry(1.5, h * 0.22, d * 0.3), mats.glass);
    sideWin.position.set(w / 2 + 0.5, h * 0.5, 0);
    g.add(sideWin);
    const door = new Mesh(new BoxGeometry(w * 0.18, h * 0.4, 1.5), mats.lacquer("#6b4a2f"));
    door.position.set(w * 0.25, h * 0.2, d / 2 + 0.6);
    g.add(door);
    g.position.set(x, 0, z);
    g.rotation.y = r() * 0.6 - 0.3;
    group.add(g);
  };

  const tree = (x: number, z: number, scale: number) => {
    const trunk = new Mesh(new CylinderGeometry(6 * scale, 7 * scale, 30 * scale, 16), mats.naturalWood);
    place(trunk, x, z, 15 * scale);
    const crown = new Mesh(new ConeGeometry(30 * scale, 75 * scale, 24), mats.lacquer(pick(["#3c8f4e", "#2f7a43", "#5aa05a"])));
    place(crown, x, z, 30 * scale + 37 * scale);
  };

  const block = (x: number, z: number) => {
    const kind = r();
    const mat = mats.lacquer(pick(colors));
    if (kind < 0.4) place(new Mesh(new RoundedBoxGeometry(44, 44, 44, 2, 2.5), mat), x, z, 22);
    else if (kind < 0.7) place(new Mesh(new CylinderGeometry(22, 22, 70, 32), mat), x, z, 35);
    else place(new Mesh(new RoundedBoxGeometry(88, 22, 44, 2, 2.5), mat), x, z, 11);
  };

  // A little town along the back of the rug, a copse to the left, loose blocks scattered at the front.
  for (let i = 0; i < 6; i++) house(-1100 + i * 330 + r() * 80, -820 - r() * 100, 0.9 + r() * 0.5);
  for (let i = 0; i < 8; i++) tree(-1250 + r() * 250, -560 + i * 130 + r() * 60, 0.8 + r() * 0.6);
  for (let i = 0; i < 6; i++) tree(1080 + r() * 220, -800 + r() * 280, 0.7 + r() * 0.5);
  for (let i = 0; i < 12; i++) block(-1100 + r() * 2200, 760 + r() * 180);

  // The toy box everything came out of, off the rug in the corner.
  const box = shadowed(new Mesh(new RoundedBoxGeometry(900, 520, 600, 3, 8), mats.lacquer("#b8432f")));
  box.position.set(-2900, FLOOR_Y + 260, -2600);
  box.rotation.y = 0.25;
  group.add(box);
  const lid = shadowed(new Mesh(new RoundedBoxGeometry(940, 40, 640, 3, 10), mats.lacquer("#e6b52c")));
  lid.position.set(-2600, FLOOR_Y + 20, -1900);
  lid.rotation.y = -0.4;
  group.add(lid);
}
