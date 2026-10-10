import {
  BoxGeometry,
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
} from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { SHADOW_PROXY_LAYER } from "./dressing/blocks";
import type { Materials } from "./materials";
import type { QualitySettings } from "./quality";

/** The floorboards sit just below the felt mat, whose top is the play surface at y = 0. */
export const FLOOR_Y = -4;

export interface Room {
  group: Group;
  sun: DirectionalLight;
  /** Fit the sun's shadow camera around an area centred at (x, z). */
  fitShadow(x: number, z: number, radius: number): void;
  /** The area the shadow camera currently covers. */
  readonly shadowFit: { x: number; z: number; radius: number };
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
  scene.environmentIntensity = 0.22;
  scene.background = new Color("#cbbba3");
  scene.fog = new Fog("#cbbba3", 9000, 26000);

  // Floorboards.
  const floor = shadowed(new Mesh(new PlaneGeometry(30000, 30000), mats.floor), false, true);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = FLOOR_Y;
  const floorUv = floor.geometry.getAttribute("uv");
  for (let i = 0; i < floorUv.count; i++) floorUv.setXY(i, floorUv.getX(i) * 30000, floorUv.getY(i) * 30000);
  group.add(floor);

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

  // Light: warm, low late-afternoon sun from a window to the right, soft sky fill.
  const sun = new DirectionalLight(new Color("#ffd2a1"), 5.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
  sun.shadow.bias = -0.00015;
  sun.shadow.normalBias = 0.6;
  sun.shadow.radius = 2.5;
  sun.shadow.blurSamples = 12;
  // The shadow camera also sees the shadow-only stand-ins (see SHADOW_PROXY_LAYER).
  sun.shadow.camera.layers.enable(SHADOW_PROXY_LAYER);
  scene.add(sun);
  scene.add(sun.target);
  scene.add(new HemisphereLight(new Color("#ffeedd"), new Color("#6b4a30"), 0.12));

  const sunDir = { x: 0.72, y: 0.5, z: 0.48 };
  const shadowFit = { x: 0, z: 0, radius: 2000 };
  const fitShadow = (x: number, z: number, radius: number) => {
    shadowFit.x = x;
    shadowFit.z = z;
    shadowFit.radius = radius;
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

  return { group, sun, fitShadow, shadowFit };
}
