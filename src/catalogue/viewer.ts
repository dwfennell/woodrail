import {
  ACESFilmicToneMapping,
  Box3,
  CircleGeometry,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  PCFShadowMap,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  ShadowMaterial,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
  type Object3D,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { createMaterials } from "../render/materials";
import { CATALOGUE } from "./assets";
import { Kit } from "./kit";
import type { Asset, Category } from "./types";

const CATEGORIES: Category[] = ["Trains", "Wagons", "Track", "Stations & buildings", "Mechanisms", "Bridges & tunnels", "Vehicles", "People & animals", "Scenery", "Town & road"];
const THUMB = 256;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** A lit stage for an asset: soft sky light, a sun casting shadows onto an invisible ground, room reflections. */
function makeStage(renderer: WebGLRenderer): { scene: Scene; sun: DirectionalLight; holder: Group } {
  const scene = new Scene();
  const pmrem = new PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.45;
  scene.add(new HemisphereLight(new Color("#fff6e6"), new Color("#8a7a5c"), 1.1));
  const sun = new DirectionalLight(new Color("#fff1dc"), 2.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.bias = -0.0004;
  sun.shadow.radius = 4;
  scene.add(sun, sun.target);
  const ground = new Mesh(new CircleGeometry(4000, 48), new ShadowMaterial({ opacity: 0.22 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  const holder = new Group();
  scene.add(holder);
  return { scene, sun, holder };
}

function makeRenderer(canvas?: HTMLCanvasElement): WebGLRenderer {
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: !canvas });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  return renderer;
}

/** Size the sun's shadow to the asset, and point the camera at it from a three-quarter view. */
function frame(object: Object3D, camera: PerspectiveCamera, sun: DirectionalLight, distanceScale = 1): { centre: Vector3; radius: number; box: Box3 } {
  object.updateMatrixWorld(true);
  const box = new Box3().setFromObject(object);
  const centre = box.getCenter(new Vector3());
  const radius = Math.max(8, box.getSize(new Vector3()).length() / 2);
  const dist = (radius / Math.sin((camera.fov * Math.PI) / 360)) * 0.95 * distanceScale;
  const dir = new Vector3(0.75, 0.55, 0.95).normalize();
  camera.position.copy(centre).addScaledVector(dir, dist);
  camera.near = dist / 50;
  camera.far = dist * 10;
  camera.updateProjectionMatrix();
  camera.lookAt(centre);
  sun.position.copy(centre).add(new Vector3(-0.5, 1.4, 0.8).multiplyScalar(radius * 3));
  sun.target.position.copy(centre);
  const s = sun.shadow.camera;
  s.left = s.bottom = -radius * 1.6;
  s.right = s.top = radius * 1.6;
  s.near = radius * 0.5;
  s.far = radius * 8;
  s.updateProjectionMatrix();
  return { centre, radius, box };
}

function dispose(object: Object3D): void {
  object.traverse((o) => (o as Mesh).geometry?.dispose());
}

/** Build an asset, or a placeholder that says it failed (so one broken asset doesn't stop the page). */
function buildSafely(asset: Asset, kit: Kit): Object3D {
  try {
    return asset.build(kit);
  } catch (e) {
    console.warn(`Building ${asset.id} failed`, e);
    return kit.group(kit.box(kit.paint("#e98aa8"), 30, 30, 30, 4));
  }
}

// ——— Thumbnails: one off-screen renderer, rendering a few per frame, cards in view first ———

const thumbRenderer = makeRenderer();
thumbRenderer.setSize(THUMB, THUMB);
const kit = new Kit(createMaterials(thumbRenderer.capabilities.getMaxAnisotropy()));
const thumbStage = makeStage(thumbRenderer);
const thumbCamera = new PerspectiveCamera(30, 1, 1, 10000);
const thumbs = new Map<string, string>();
const wanted: Asset[] = [];
const images = new Map<string, HTMLImageElement>();

function renderThumb(asset: Asset): string {
  const object = buildSafely(asset, kit);
  asset.animate?.(object, 0.6);
  thumbStage.holder.add(object);
  frame(object, thumbCamera, thumbStage.sun);
  thumbRenderer.render(thumbStage.scene, thumbCamera);
  const url = thumbRenderer.domElement.toDataURL("image/png");
  thumbStage.holder.remove(object);
  dispose(object);
  return url;
}

let pumping = false;
function pump(): void {
  if (pumping) return;
  pumping = true;
  const step = () => {
    const start = performance.now();
    while (wanted.length > 0 && performance.now() - start < 24) {
      const asset = wanted.shift()!;
      if (thumbs.has(asset.id)) continue;
      const url = renderThumb(asset);
      thumbs.set(asset.id, url);
      const img = images.get(asset.id);
      if (img) {
        img.src = url;
        img.classList.remove("pending");
      }
    }
    if (wanted.length > 0) requestAnimationFrame(step);
    else pumping = false;
  };
  requestAnimationFrame(step);
}

const observer = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    const id = (e.target as HTMLElement).dataset.id!;
    const asset = CATALOGUE.find((a) => a.id === id);
    if (asset && !thumbs.has(id)) wanted.unshift(asset);
  }
  pump();
});

// ——— The grid ———

let category: Category | "All" = "All";
let query = "";
let shown: Asset[] = [];

function matches(a: Asset): boolean {
  if (category !== "All" && a.category !== category) return false;
  if (!query) return true;
  const hay = `${a.name} ${a.category} ${a.tags.join(" ")} ${a.notes}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .every((w) => hay.includes(w));
}

function renderChips(): void {
  const chips = $("chips");
  chips.replaceChildren();
  const counts = new Map<string, number>();
  for (const a of CATALOGUE) counts.set(a.category, (counts.get(a.category) ?? 0) + 1);
  for (const c of ["All", ...CATEGORIES] as const) {
    const n = c === "All" ? CATALOGUE.length : (counts.get(c) ?? 0);
    if (n === 0) continue;
    const b = document.createElement("button");
    b.textContent = c;
    const span = document.createElement("span");
    span.textContent = String(n);
    b.append(span);
    b.className = c === category ? "on" : "";
    b.onclick = () => {
      category = c;
      renderChips();
      renderGrid();
    };
    chips.append(b);
  }
}

function renderGrid(): void {
  const grid = $("grid");
  observer.disconnect();
  grid.replaceChildren();
  images.clear();
  shown = CATALOGUE.filter(matches);
  $("count").textContent = `${shown.length} asset${shown.length === 1 ? "" : "s"}`;
  shown.forEach((a, i) => {
    const card = document.createElement("button");
    card.className = "card";
    card.dataset.id = a.id;
    const img = document.createElement("img");
    img.className = "thumb";
    img.alt = a.name;
    const url = thumbs.get(a.id);
    if (url) img.src = url;
    else {
      img.classList.add("pending");
      img.src = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";
    }
    images.set(a.id, img);
    const label = document.createElement("div");
    label.className = "label";
    const name = document.createElement("div");
    name.className = "name";
    name.textContent = a.name;
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = a.category;
    if (a.inGame) {
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = "in game";
      meta.append(badge);
    }
    label.append(name, meta);
    card.append(img, label);
    card.onclick = () => open(i);
    grid.append(card);
    observer.observe(card);
  });
  // Everything else after the ones in view.
  for (const a of shown) if (!thumbs.has(a.id)) wanted.push(a);
  pump();
}

// ——— The detail view: one asset, turning on its turntable, orbitable; renders only while something moves ———

const stageCanvas = $<HTMLCanvasElement>("stage");
const detailRenderer = makeRenderer(stageCanvas);
detailRenderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
const detailStage = makeStage(detailRenderer);
const detailCamera = new PerspectiveCamera(30, 1, 1, 10000);
const controls = new OrbitControls(detailCamera, stageCanvas);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI / 2 - 0.05;
let current = -1;
let object: Object3D | null = null;
let friends: Object3D | null = null;
let running = false;
let clock = 0;
let last = 0;
let wakeUntil = 0;

const spin = $<HTMLInputElement>("t-spin");
const anim = $<HTMLInputElement>("t-anim");
const scale = $<HTMLInputElement>("t-scale");

function open(i: number): void {
  current = (i + shown.length) % shown.length;
  const asset = shown[current];
  $("detail").hidden = false;
  $("d-cat").textContent = asset.category + (asset.inGame ? " · in game" : "");
  $("d-name").textContent = asset.name;
  $("d-notes").textContent = asset.notes;
  const tags = $("d-tags");
  tags.replaceChildren(
    ...asset.tags.map((t) => {
      const s = document.createElement("span");
      s.textContent = t;
      return s;
    }),
  );
  if (object) {
    detailStage.holder.remove(object);
    dispose(object);
  }
  object = buildSafely(asset, kit);
  detailStage.holder.rotation.y = 0;
  detailStage.holder.add(object);
  clock = 0;
  setFriends();
  resize();
  const { centre, box } = frame(detailStage.holder, detailCamera, detailStage.sun, scale.checked ? 1.25 : 1);
  controls.target.copy(centre);
  controls.update();
  const size = box.getSize(new Vector3());
  $("d-size").textContent = `About ${Math.round(size.x)} × ${Math.round(size.z)} mm, ${Math.round(size.y)} mm tall`;
  wake(400);
}

/** A peg person and a straight for scale, beside the asset. */
function setFriends(): void {
  if (friends) {
    detailStage.scene.remove(friends);
    dispose(friends);
    friends = null;
  }
  if (!scale.checked || !object) return;
  object.updateMatrixWorld(true);
  const box = new Box3().setFromObject(object);
  friends = kit.group(kit.peg("#2f6db5", "#2a2b2e", box.max.x + 24, 0, box.max.z + 10), kit.trackSlab(144, (box.min.x + box.max.x) / 2, 0, box.max.z + 50));
  detailStage.scene.add(friends);
}

function close(): void {
  $("detail").hidden = true;
  if (object) {
    detailStage.holder.remove(object);
    dispose(object);
    object = null;
  }
  current = -1;
}

function resize(): void {
  const w = stageCanvas.clientWidth;
  const h = stageCanvas.clientHeight;
  if (w === 0 || h === 0) return;
  detailRenderer.setSize(w, h, false);
  detailCamera.aspect = w / h;
  detailCamera.updateProjectionMatrix();
  wake(100);
}

/** Keep drawing for at least `ms` (and while anything moves). */
function wake(ms = 0): void {
  wakeUntil = Math.max(wakeUntil, performance.now() + ms);
  if (running) return;
  running = true;
  last = performance.now();
  requestAnimationFrame(tick);
}

function tick(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (current < 0 || !object) {
    running = false;
    return;
  }
  const asset = shown[current];
  const moving = spin.checked || (anim.checked && !!asset.animate);
  if (spin.checked) detailStage.holder.rotation.y += dt * 0.35;
  if (anim.checked && asset.animate) {
    clock += dt;
    asset.animate(object, clock);
  }
  const damping = controls.update();
  detailRenderer.render(detailStage.scene, detailCamera);
  if (moving || damping || now < wakeUntil) requestAnimationFrame(tick);
  else running = false;
}

controls.addEventListener("change", () => wake(200));
spin.onchange = () => wake();
anim.onchange = () => wake();
scale.onchange = () => {
  setFriends();
  wake();
};
$("close").onclick = close;
$("prev").onclick = () => open(current - 1);
$("next").onclick = () => open(current + 1);
$("detail").onclick = (e) => {
  if (e.target === $("detail")) close();
};
window.addEventListener("keydown", (e) => {
  if (current < 0) return;
  if (e.key === "Escape") close();
  else if (e.key === "ArrowLeft") open(current - 1);
  else if (e.key === "ArrowRight") open(current + 1);
});
window.addEventListener("resize", resize);

const search = $<HTMLInputElement>("search");
search.oninput = () => {
  query = search.value.trim();
  renderGrid();
};

renderChips();
renderGrid();
// Open one straight away with ?asset=<id> (for sharing a link).
const start = new URLSearchParams(location.search).get("asset");
if (start) {
  const i = shown.findIndex((a) => a.id === start);
  if (i >= 0) open(i);
}
