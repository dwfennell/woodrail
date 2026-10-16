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
import { CAR_SPECS, COUPLER_GAP, type CarKind, type CarLook } from "../sim";
import { isBridge, type PieceTypeId } from "../track";
import type { Materials } from "./materials";
import { buildCarModel, disposeObject } from "./train-models";
import { pieceGeometry } from "./track-view";

const W = 176;
const H = 144;
const VIEW = new Vector3(0.95, 1.25, 1.35).normalize();

export type ThumbnailSubject = { key: string; kind: "piece"; type: PieceTypeId } | { key: string; kind: "train"; cars: readonly CarKind[]; looks?: readonly CarLook[] };

function trainModel(cars: readonly CarKind[], mats: Materials, looks: readonly CarLook[] = []): Group {
  const g = new Group();
  let x = 0;
  cars.forEach((kind, i) => {
    const spec = CAR_SPECS[kind];
    const model = buildCarModel(kind, mats, i, looks[i]).root;
    x -= (i === 0 ? 0 : COUPLER_GAP) + spec.length / 2;
    model.position.x = x;
    x -= spec.length / 2;
    g.add(model);
  });
  return g;
}

/**
 * Draws small three-quarter views of models (warmly lit, on a clear background) as image URLs, with the game's
 * renderer and an offscreen target. Keep one while pictures are wanted; `dispose` when done.
 */
export class ThumbnailStudio {
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(26, W / H, 1, 5000);
  private readonly target = new WebGLRenderTarget(W, H, { samples: 4 });
  private readonly pixels = new Uint8Array(W * H * 4);
  private readonly canvas = document.createElement("canvas");
  private readonly ctx: CanvasRenderingContext2D;
  private readonly image: ImageData;
  private readonly box = new Box3();
  private readonly sphere = new Sphere();

  constructor(private readonly renderer: WebGLRenderer) {
    this.scene.add(new HemisphereLight(new Color("#fff6e8"), new Color("#8a6a4a"), 1.9));
    const sun = new DirectionalLight(new Color("#ffe2bf"), 2.4);
    sun.position.set(2, 3, 1.5);
    this.scene.add(sun);
    this.target.texture.colorSpace = SRGBColorSpace;
    this.canvas.width = W;
    this.canvas.height = H;
    this.ctx = this.canvas.getContext("2d")!;
    this.image = this.ctx.createImageData(W, H);
  }

  /** A picture of `subject` (framed to fit; `fill` > 1 frames tighter). WebP where the browser can, else PNG. */
  shoot(subject: Object3D, fill = 1): string {
    const { renderer, scene, camera } = this;
    scene.add(subject);
    this.box.setFromObject(subject).getBoundingSphere(this.sphere);
    const vHalf = (camera.fov * Math.PI) / 360;
    const hHalf = Math.atan(Math.tan(vHalf) * camera.aspect);
    const dist = ((this.sphere.radius / Math.sin(Math.min(vHalf, hHalf))) * 0.68) / fill;
    camera.position.copy(this.sphere.center).addScaledVector(VIEW, dist);
    camera.lookAt(this.sphere.center);
    const prevTarget = renderer.getRenderTarget();
    const prevAlpha = renderer.getClearAlpha();
    const prevColor = renderer.getClearColor(new Color());
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(this.target);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.readRenderTargetPixels(this.target, 0, 0, W, H, this.pixels);
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevColor, prevAlpha);
    scene.remove(subject);
    // GL rows run bottom-up.
    for (let y = 0; y < H; y++) this.image.data.set(this.pixels.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
    this.ctx.putImageData(this.image, 0, 0);
    return this.canvas.toDataURL("image/webp", 0.85);
  }

  dispose(): void {
    this.target.dispose();
  }
}

/** Pictures of the track pieces and trains in the tray, drawn once at start-up, as image URLs by key. */
export function renderThumbnails(
  renderer: WebGLRenderer,
  mats: Materials,
  subjects: readonly ThumbnailSubject[],
  /** What stands with a piece (an industry's yard and buildings, in the piece's frame), if anything. */
  withPiece: (type: PieceTypeId) => Object3D | null = () => null,
  /**
   * A studio to draw in, kept by the caller across calls (a new one each call sets its lights up afresh, and the
   * shaders are compiled again for them). Without one, a studio for this call.
   */
  kept?: ThumbnailStudio,
): Map<string, string> {
  const out = new Map<string, string>();
  const studio = kept ?? new ThumbnailStudio(renderer);
  for (const s of subjects) {
    let subject: Object3D;
    if (s.kind === "piece") {
      const mesh = new Mesh(pieceGeometry(s.type, false, isBridge(s.type) ? 1 : 0), [mats.track, mats.trackCut, mats.bridgePaint]);
      const extra = withPiece(s.type);
      if (extra) mesh.add(extra);
      // Long pieces lie diagonally so they fill the square tile.
      mesh.rotation.y = 0.5;
      subject = mesh;
    } else {
      subject = trainModel(s.cars, mats, s.looks);
      subject.rotation.y = 0.35;
    }
    out.set(s.key, studio.shoot(subject));
    if (s.kind === "train") disposeObject(subject);
    else for (const child of subject.children) disposeObject(child);
  }
  if (!kept) studio.dispose();
  return out;
}
