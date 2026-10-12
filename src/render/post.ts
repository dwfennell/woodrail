import { HalfFloatType, Vector2, WebGLRenderTarget, type PerspectiveCamera, type Scene, type WebGLRenderer } from "three";
import { BokehPass } from "three/examples/jsm/postprocessing/BokehPass.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import type { QualitySettings } from "./quality";

/**
 * The "macro photo of a real toy" finish: a gentle warm grade (lifted, warm shadows and a soft S-curve), lens
 * vignette and fine film grain. Runs after tone mapping, on display-referred colour.
 */
const LensShader = {
  uniforms: { tDiffuse: { value: null }, time: { value: 0 }, resolution: { value: new Vector2(1, 1) } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float time;
    uniform vec2 resolution;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + time) * 43758.5453); }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float luma = dot(c.rgb, vec3(0.299, 0.587, 0.114));
      // Warm the shadows and mids a touch; keep highlights neutral.
      c.rgb += vec3(0.022, 0.010, -0.012) * (1.0 - luma);
      // Soft S-curve for a little more depth.
      c.rgb = mix(c.rgb, c.rgb * c.rgb * (3.0 - 2.0 * c.rgb), 0.22);
      vec2 d = vUv - 0.5;
      d.x *= resolution.x / resolution.y;
      float vig = smoothstep(1.05, 0.3, length(d));
      c.rgb *= mix(0.78, 1.0, vig);
      c.rgb += (hash(vUv * resolution) - 0.5) * 0.018;
      gl_FragColor = c;
    }`,
};

export interface Post {
  composer: EffectComposer;
  setSize(w: number, h: number): void;
  setFocus(distance: number): void;
  render(time: number): void;
}

const APERTURE = 0.0000045;
const SHARP_RANGE = 1500;

/**
 * Depth-of-field aperture for a focus distance. The blur grows with raw depth offset, so beyond close-up range the
 * aperture narrows in proportion: the miniature look stays the same instead of a wide view blurring away entirely.
 */
export function apertureFor(distance: number): number {
  return APERTURE * Math.min(1, SHARP_RANGE / distance);
}

export function createPost(renderer: WebGLRenderer, scene: Scene, camera: PerspectiveCamera, quality: QualitySettings): Post {
  // Multisampled, for anti-aliased edges (the canvas itself isn't: it only ever shows the final full-screen pass).
  const composer = new EffectComposer(renderer, new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples: 4 }));
  // setSize is given drawing-buffer pixels, already scaled by the renderer's pixel ratio: don't scale them again.
  composer.setPixelRatio(1);
  composer.addPass(new RenderPass(scene, camera));

  let gtao: GTAOPass | null = null;
  if (quality.ambientOcclusion) {
    gtao = new GTAOPass(scene, camera, 1, 1);
    // Ambient occlusion is soft and denoised: half resolution looks the same at a quarter of the cost. The composer
    // sizes every pass, so halve it there.
    const fullSize = gtao.setSize.bind(gtao);
    gtao.setSize = (w, h) => fullSize(Math.max(1, Math.round(w / 2)), Math.max(1, Math.round(h / 2)));
    gtao.updateGtaoMaterial({ radius: 12, distanceExponent: 1.4, thickness: 5, scale: 1.2, samples: 16 });
    gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
    gtao.blendIntensity = 1;
    composer.addPass(gtao);
  }

  let bokeh: BokehPass | null = null;
  if (quality.depthOfField) {
    bokeh = new BokehPass(scene, camera, { focus: 1500, aperture: apertureFor(1500), maxblur: 0.006 });
    composer.addPass(bokeh);
  }

  composer.addPass(new OutputPass());
  const lens = new ShaderPass(LensShader);
  composer.addPass(lens);

  return {
    composer,
    setSize(w, h) {
      composer.setSize(w, h);
      lens.uniforms.resolution.value.set(w, h);
    },
    setFocus(distance) {
      if (!bokeh) return;
      const u = bokeh.uniforms as Record<string, { value: number }>;
      u.focus.value = distance;
      u.aperture.value = apertureFor(distance);
    },
    render(time) {
      lens.uniforms.time.value = time % 100;
      composer.render();
    },
  };
}
