import { DepthTexture, HalfFloatType, ShaderMaterial, UniformsUtils, UnsignedByteType, Vector2, WebGLRenderTarget, type PerspectiveCamera, type Scene, type WebGLRenderer } from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import type { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import { FullScreenQuad, Pass } from "three/examples/jsm/postprocessing/Pass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { BokehShader } from "three/examples/jsm/shaders/BokehShader.js";
import { CopyShader } from "three/examples/jsm/shaders/CopyShader.js";
import type { QualitySettings } from "./quality";
import { dofLook, type DofLook } from "./dof";
import { shadowLook } from "./shadow-strength";

/**
 * The "macro photo of a real toy" finish: a gentle warm grade (lifted, warm shadows and a soft S-curve), lens
 * vignette and fine film grain. It is the last pass, drawn to the screen: it tone maps and converts to sRGB first (what
 * three's OutputPass would do), then grades the display-referred colour.
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
      gl_FragColor = texture2D(tDiffuse, vUv);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      vec4 c = gl_FragColor;
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
  setSize(w: number, h: number): void;
  /** Set for the camera's distance from what it looks at: the depth of field's focus, and ambient occlusion's strength. */
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

/** Ambient occlusion fades out between these camera distances (mm), and is off beyond. */
export const AO_FADE_START = 2000;
export const AO_FADE_END = 3500;

/**
 * Ambient occlusion's strength at a camera distance. Its radius is a few mm: from far out that is under a pixel, and
 * all it adds is noise from the depth buffer's steps (stripes on flat felt, scribbles on hazed scenery), so it fades
 * out as the camera pulls back, and the pass is skipped once it's gone.
 */
export function aoFor(distance: number): number {
  const t = Math.min(1, Math.max(0, (distance - AO_FADE_START) / (AO_FADE_END - AO_FADE_START)));
  return 1 - t * t * (3 - 2 * t);
}

/**
 * three's bokeh shader, with what's nearer than the focus blurred `near` as much, and a sharp band `dead` (mm) beyond
 * the focus. (As three's when `near` is 1 and `dead` 0.)
 */
function dofShader(look: DofLook) {
  const factor = "float factor = ( focus + viewZ );";
  if (!BokehShader.fragmentShader.includes(factor)) throw new Error("BokehShader changed: no focus factor to adjust");
  return {
    ...BokehShader,
    uniforms: { ...BokehShader.uniforms, near: { value: look.near }, dead: { value: 0 } },
    fragmentShader: BokehShader.fragmentShader
      .replace("uniform float focus;", "uniform float focus;\nuniform float near;\nuniform float dead;")
      .replace(factor, `${factor}\nfactor = factor > 0.0 ? factor * near : min( 0.0, factor + dead );`),
  };
}

/**
 * Draws the scene into its own multisampled target, whose depth texture the effects share (so none of them has to
 * draw the scene again for its own depth), then hands the colour on down the chain.
 */
class ScenePass extends Pass {
  readonly target: WebGLRenderTarget;
  private readonly copy = new ShaderMaterial({
    uniforms: UniformsUtils.clone(CopyShader.uniforms),
    vertexShader: CopyShader.vertexShader,
    fragmentShader: CopyShader.fragmentShader,
  });
  private readonly quad = new FullScreenQuad(this.copy);

  constructor(
    private readonly scene: Scene,
    private readonly camera: PerspectiveCamera,
    halfFloat: boolean,
    samples: number,
    depth: boolean,
  ) {
    super();
    // (Its depth as a texture only for the effects that read it: else a depth buffer, with nothing resolved out of it.)
    this.target = new WebGLRenderTarget(1, 1, { type: halfFloat ? HalfFloatType : UnsignedByteType, samples, depthTexture: depth ? new DepthTexture(1, 1) : null });
  }

  setSize(w: number, h: number): void {
    this.target.setSize(w, h);
  }

  render(renderer: WebGLRenderer, writeBuffer: WebGLRenderTarget): void {
    renderer.setRenderTarget(this.target);
    renderer.render(this.scene, this.camera);
    this.copy.uniforms.tDiffuse.value = this.target.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }
}

/** `redraw`: a frame wanted, when ambient occlusion has come (its code is loaded after the rest: post-ao.ts). */
export function createPost(renderer: WebGLRenderer, scene: Scene, camera: PerspectiveCamera, quality: QualitySettings, redraw: () => void = () => {}): Post {
  // Multisampled half-float targets need a colour-buffer extension: without one (some phones), antialiasing would
  // quietly fail, so draw into an 8-bit target instead (a little banding in deep shadow, but smooth edges).
  const halfFloat = renderer.extensions.has("EXT_color_buffer_float") || renderer.extensions.has("EXT_color_buffer_half_float");
  const dof = dofLook();
  const depthOfField = quality.depthOfField && dof.aperture > 0;
  const effects = quality.ambientOcclusion || depthOfField;
  const scenePass = new ScenePass(scene, camera, halfFloat, quality.sceneSamples, effects);
  // Tone mapping and sRGB output happen in the lens pass, saving a full-screen pass of their own.
  const lens = new ShaderPass(LensShader);

  if (!effects) {
    // Nothing between the scene and the lens (the mobile tier): the lens reads the scene's own target and draws to the
    // screen. No composer, so none of its two full-screen half-float buffers (23 MB on a 1080×2424 phone at a pixel
    // ratio of 2) and no copy into them, and no depth texture resolved (6 MB): the same picture, for a full-screen
    // pass and that memory less.
    lens.renderToScreen = true;
    return {
      setSize(w, h) {
        scenePass.setSize(w, h);
        lens.uniforms.resolution.value.set(w, h);
      },
      setFocus() {},
      render(time) {
        lens.uniforms.time.value = time % 100;
        renderer.setRenderTarget(scenePass.target);
        renderer.render(scene, camera);
        lens.render(renderer, scenePass.target, scenePass.target, 0, false);
      },
    };
  }

  const composer = new EffectComposer(renderer);
  // setSize is given drawing-buffer pixels, already scaled by the renderer's pixel ratio: don't scale them again.
  composer.setPixelRatio(1);
  const depth = scenePass.target.depthTexture!;
  composer.addPass(scenePass);
  let gtao: GTAOPass | null = null;
  const aoStrength = shadowLook().contact;
  // The size and focus as last set, for ambient occlusion when it comes.
  let size: [number, number] | null = null;
  let focus = -1;
  const aoFocus = () => {
    if (!gtao || focus < 0) return;
    gtao.blendIntensity = aoFor(focus) * aoStrength;
    gtao.enabled = gtao.blendIntensity > 0;
  };
  if (quality.ambientOcclusion)
    void import("./post-ao").then(({ aoPass }) => {
      gtao = aoPass(scene, camera, depth);
      gtao.blendIntensity = aoStrength;
      // (Right after the scene, before depth of field and the lens, as if it had been there from the start.)
      composer.insertPass(gtao, 1);
      if (size) gtao.setSize(size[0], size[1]);
      aoFocus();
      redraw();
    });

  // Depth of field: three's bokeh shader, reading the shared depth (BokehPass would draw the scene again for it).
  let bokeh: ShaderPass | null = null;
  if (depthOfField) {
    bokeh = new ShaderPass(dofShader(dof), "tColor");
    bokeh.material.defines.DEPTH_PACKING = 0;
    bokeh.uniforms.tDepth.value = depth;
    bokeh.uniforms.maxblur.value = dof.maxblur;
    composer.addPass(bokeh);
  }

  composer.addPass(lens);

  return {
    setSize(w, h) {
      size = [w, h];
      composer.setSize(w, h);
      lens.uniforms.resolution.value.set(w, h);
      if (bokeh) bokeh.uniforms.aspect.value = w / h;
    },
    setFocus(distance) {
      focus = distance;
      aoFocus();
      if (!bokeh) return;
      bokeh.uniforms.focus.value = distance;
      bokeh.uniforms.aperture.value = apertureFor(distance) * dof.aperture;
      bokeh.uniforms.dead.value = dof.dead * distance;
    },
    render(time) {
      lens.uniforms.time.value = time % 100;
      if (bokeh) {
        bokeh.uniforms.nearClip.value = camera.near;
        bokeh.uniforms.farClip.value = camera.far;
      }
      composer.render();
    },
  };
}
