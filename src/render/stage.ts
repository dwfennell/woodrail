import {
  BackSide,
  BufferAttribute,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  PMREMGenerator,
  Scene,
  SphereGeometry,
  type Camera,
  type WebGLRenderer,
} from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { SHADOW_PROXY_LAYER } from "./dressing/blocks";
import { HAZE_COLOR, hazeFog, installHaze } from "./haze";
import type { QualitySettings } from "./quality";

/** Pale blue high overhead; the horizon is the haze colour so hazed ground meets the sky without a seam. */
export const SKY_ZENITH = "#a9c6db";
const SKY_RADIUS = 30000;

export interface Stage {
  group: Group;
  sun: DirectionalLight;
  /** Fit the sun's shadow camera around an area centred at (x, z). */
  fitShadow(x: number, z: number, radius: number): void;
  /** The area the shadow camera currently covers. */
  readonly shadowFit: { x: number; z: number; radius: number };
  /** Keep the sky centred on the camera (call once per frame, before rendering). */
  update(camera: Camera): void;
}

/** A sky dome coloured by elevation: haze at and below the horizon, rising to pale blue. */
function buildSky(): Mesh {
  const g = new SphereGeometry(SKY_RADIUS, 32, 16);
  const pos = g.getAttribute("position");
  const colors = new Float32Array(pos.count * 3);
  const haze = new Color(HAZE_COLOR);
  const zenith = new Color(SKY_ZENITH);
  const c = new Color();
  for (let i = 0; i < pos.count; i++) {
    const e = Math.max(0, pos.getY(i) / SKY_RADIUS);
    const t = Math.min(1, e / 0.55);
    c.copy(haze).lerp(zenith, t * t * (3 - 2 * t));
    c.toArray(colors, i * 3);
  }
  g.setAttribute("color", new BufferAttribute(colors, 3));
  const sky = new Mesh(g, new MeshBasicMaterial({ vertexColors: true, side: BackSide, fog: false, depthWrite: false }));
  sky.renderOrder = -1;
  sky.frustumCulled = false;
  return sky;
}

/** Lights, sky and haze: the world around the toys. */
export function createStage(scene: Scene, renderer: WebGLRenderer, quality: QualitySettings): Stage {
  installHaze();
  const group = new Group();
  scene.add(group);

  const pmrem = new PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.22;
  scene.background = new Color(HAZE_COLOR);
  // The land it hazes around is set by the game (see `setHazeLand`).
  scene.fog = hazeFog({ x0: 0, z0: 0, x1: 0, z1: 0 });

  const sky = buildSky();
  group.add(sky);

  // Light: warm, low late-afternoon sun, soft sky fill.
  const sun = new DirectionalLight(new Color("#ffd2a1"), 5.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
  sun.shadow.bias = -0.00015;
  sun.shadow.normalBias = 0.6;
  sun.shadow.radius = 2.5;
  sun.shadow.blurSamples = 12;
  // The shadow camera also sees the shadow-only stand-ins (see SHADOW_PROXY_LAYER).
  sun.shadow.camera.layers.enable(SHADOW_PROXY_LAYER);
  // three tests a caster's layers against the view's camera, not the shadow camera: during the shadow pass only, the
  // view's camera sees the stand-ins too. (They still never reach the screen: its list is made before the shadow pass.)
  const renderShadows = renderer.shadowMap.render.bind(renderer.shadowMap);
  renderer.shadowMap.render = (lights, scene, camera) => {
    const had = camera.layers.isEnabled(SHADOW_PROXY_LAYER);
    camera.layers.enable(SHADOW_PROXY_LAYER);
    try {
      renderShadows(lights, scene, camera);
    } finally {
      if (!had) camera.layers.disable(SHADOW_PROXY_LAYER);
    }
  };
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

  const update = (camera: Camera) => {
    sky.position.copy(camera.position);
    sky.updateMatrixWorld();
  };

  return { group, sun, fitShadow, shadowFit, update };
}
