import { Color, DoubleSide, Group, Mesh, MeshBasicMaterial, RingGeometry, Vector3, type Camera, type Scene } from "three";
import type { Flourish } from "./flourishes";

/** How long the marks pulse (s). */
const LIFE = 3.2;
/** Ring radius (mm): about a station's half length, so it reads round a depot or a train. */
const RADIUS = 190;
/** A square's ring: round one new building. */
export const SQUARE_RING = 60;

/**
 * "Show me": rings on the ground that ripple out from each place a goal points at, three times, then fade. Built on
 * demand and thrown away afterwards, so they cost nothing when not showing.
 */
export function goalMarks(scene: Scene, points: readonly { x: number; y: number; z: number }[], radius = RADIUS): Flourish | null {
  if (points.length === 0) return null;
  const geometry = new RingGeometry(radius * 0.7, radius, 48);
  geometry.rotateX(-Math.PI / 2);
  const material = new MeshBasicMaterial({ color: new Color("#ffcf6b"), transparent: true, depthWrite: false, side: DoubleSide });
  const group = new Group();
  const rings: Mesh[] = [];
  for (const p of points) {
    for (let k = 0; k < 2; k++) {
      const ring = new Mesh(geometry, k === 0 ? material : material.clone());
      ring.position.set(p.x, p.y + 4, p.z);
      ring.renderOrder = 10;
      rings.push(ring);
      group.add(ring);
    }
  }
  scene.add(group);
  // By the clock (see goalLabels): capped frame steps would stretch them on a slow page.
  const start = performance.now();
  return {
    update() {
      const t = (performance.now() - start) / 1000;
      const fade = Math.min(1, (LIFE - t) / 0.6);
      for (let i = 0; i < rings.length; i++) {
        // Two rings per place, half a beat apart: one ripple after another.
        const beat = ((t / 1.05 + (i % 2) * 0.5) % 1 + 1) % 1;
        rings[i].scale.setScalar(0.45 + beat * 1.1);
        (rings[i].material as MeshBasicMaterial).opacity = Math.max(0, (1 - beat) * 0.9 * fade);
      }
      return t < LIFE;
    },
    dispose() {
      scene.remove(group);
      geometry.dispose();
      const mats = new Set(rings.map((r) => r.material as MeshBasicMaterial));
      for (const m of mats) m.dispose();
    },
  };
}

/** How long a goal's labels stay up (s), the last part fading. */
const LABEL_LIFE = 5;

/** The labels showing now (a second "Show me" replaces them rather than stacking more). */
let showing: { els: HTMLElement[]; done: boolean } | null = null;

/**
 * "Show me": the names of a goal's places (its towns) over them on screen, for a few seconds: they're small from far
 * off. Plain page elements pinned to the places each frame (only their transforms written: the canvas's place on the
 * page is read once, and again only on a resize), gone afterwards.
 */
export function goalLabels(
  camera: Camera,
  canvas: HTMLCanvasElement,
  places: readonly { x: number; y: number; z: number; text: string }[],
  life = LABEL_LIFE,
): Flourish | null {
  if (showing) {
    for (const el of showing.els) el.remove();
    showing.done = true;
    showing = null;
  }
  if (places.length === 0) return null;
  // The labels' own layer over the canvas, clipping them: a label off screen never widens the page (which pans or
  // zooms it on phones).
  const host = document.createElement("div");
  host.className = "goal-labels";
  (canvas.parentElement ?? document.body).append(host);
  const els = places.map((p) => {
    const el = document.createElement("div");
    el.className = "goal-label";
    el.textContent = p.text;
    host.append(el);
    return el;
  });
  const mine = { els: [host], done: false };
  showing = mine;
  // Where the canvas is (read now and on a resize: never between writing labels each frame).
  let width = 1;
  let height = 1;
  const measure = () => {
    const r = canvas.getBoundingClientRect();
    host.style.left = `${r.left}px`;
    host.style.top = `${r.top}px`;
    host.style.width = `${(width = r.width)}px`;
    host.style.height = `${(height = r.height)}px`;
  };
  measure();
  window.addEventListener("resize", measure);
  const v = new Vector3();
  let t = 0;
  // By the clock, not by frames: frame steps are capped (0.1 s), so on a slow or throttled page the labels would
  // last many times `life`, and keep frames being drawn all that while.
  const start = performance.now();
  const place = () => {
    places.forEach((p, i) => {
      v.set(p.x, p.y, p.z).project(camera);
      // Off screen (or behind the camera): not shown at all.
      const off = v.z > 1 || v.x < -1.5 || v.x > 1.5 || v.y < -1.5 || v.y > 1.5;
      els[i].style.display = off ? "none" : "";
      if (off) return;
      const x = ((v.x + 1) / 2) * width;
      const y = ((1 - v.y) / 2) * height;
      els[i].style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
      els[i].style.opacity = String(Math.min(1, (life - t) / 0.8));
    });
  };
  place();
  return {
    update() {
      if (mine.done) return false;
      t = (performance.now() - start) / 1000;
      place();
      return t < life;
    },
    dispose() {
      window.removeEventListener("resize", measure);
      host.remove();
      if (showing === mine) showing = null;
    },
  };
}
