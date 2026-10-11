import {
  Box3,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Sphere,
  Vector3,
  WebGLRenderTarget,
  type Object3D,
  type WebGLRenderer,
} from "three";
import { CAR_SPECS, COUPLER_GAP, type CarKind } from "../sim";
import type { PieceTypeId } from "../track";
import type { Materials } from "./materials";
import { buildCarModel, disposeObject } from "./train-models";
import { pieceGeometry } from "./track-view";

const W = 176;
const H = 144;
const VIEW = new Vector3(0.95, 1.25, 1.35).normalize();

export type ThumbnailSubject = { key: string; kind: "piece"; type: PieceTypeId } | { key: string; kind: "train"; cars: readonly CarKind[] };

function trainModel(cars: readonly CarKind[], mats: Materials): Group {
  const g = new Group();
  let x = 0;
  cars.forEach((kind, i) => {
    const spec = CAR_SPECS[kind];
    const model = buildCarModel(kind, mats, i).root;
    x -= (i === 0 ? 0 : COUPLER_GAP) + spec.length / 2;
    model.position.x = x;
    x -= spec.length / 2;
    g.add(model);
  });
  return g;
}

/**
 * Render a small three-quarter view of each tray item (the real piece and train models, warmly lit) once at start-up,
 * returned as image URLs by key. Uses the game's renderer and an offscreen target; nothing is kept afterwards.
 */
export function renderThumbnails(renderer: WebGLRenderer, mats: Materials, subjects: readonly ThumbnailSubject[]): Map<string, string> {
  const out = new Map<string, string>();
  const scene = new Scene();
  scene.add(new HemisphereLight(new Color("#fff6e8"), new Color("#8a6a4a"), 1.9));
  const sun = new DirectionalLight(new Color("#ffe2bf"), 2.4);
  sun.position.set(2, 3, 1.5);
  scene.add(sun);
  const camera = new PerspectiveCamera(26, W / H, 1, 5000);
  const target = new WebGLRenderTarget(W, H, { samples: 4 });
  target.texture.colorSpace = SRGBColorSpace;
  const pixels = new Uint8Array(W * H * 4);
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  const image = ctx.createImageData(W, H);
  const box = new Box3();
  const sphere = new Sphere();
  const prevTarget = renderer.getRenderTarget();
  const prevClear = renderer.getClearAlpha();
  const prevColor = renderer.getClearColor(new Color());
  renderer.setClearColor(0x000000, 0);

  for (const s of subjects) {
    let subject: Object3D;
    if (s.kind === "piece") {
      const mesh = new Mesh(pieceGeometry(s.type, false), [mats.track, mats.trackCut, mats.bridgePaint]);
      // Long pieces lie diagonally so they fill the square tile.
      mesh.rotation.y = 0.5;
      subject = mesh;
    } else {
      subject = trainModel(s.cars, mats);
      subject.rotation.y = 0.35;
    }
    scene.add(subject);
    box.setFromObject(subject).getBoundingSphere(sphere);
    const vHalf = (camera.fov * Math.PI) / 360;
    const hHalf = Math.atan(Math.tan(vHalf) * camera.aspect);
    const dist = (sphere.radius / Math.sin(Math.min(vHalf, hHalf))) * 0.68;
    camera.position.copy(sphere.center).addScaledVector(VIEW, dist);
    camera.lookAt(sphere.center);
    renderer.setRenderTarget(target);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.readRenderTargetPixels(target, 0, 0, W, H, pixels);
    // GL rows run bottom-up.
    for (let y = 0; y < H; y++) image.data.set(pixels.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
    ctx.putImageData(image, 0, 0);
    out.set(s.key, canvas.toDataURL("image/png"));
    scene.remove(subject);
    if (s.kind === "train") disposeObject(subject);
  }

  renderer.setRenderTarget(prevTarget);
  renderer.setClearColor(prevColor, prevClear);
  target.dispose();
  return out;
}
