import { DepthTexture, HalfFloatType, ShaderMaterial, UniformsUtils, UnsignedByteType, Vector2, WebGLRenderTarget, type PerspectiveCamera, type Scene, type WebGLRenderer } from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import { FullScreenQuad, Pass } from "three/examples/jsm/postprocessing/Pass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { BokehShader } from "three/examples/jsm/shaders/BokehShader.js";
import { CopyShader } from "three/examples/jsm/shaders/CopyShader.js";
import type { QualitySettings } from "./quality";

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
  ) {
    super();
    this.target = new WebGLRenderTarget(1, 1, { type: halfFloat ? HalfFloatType : UnsignedByteType, samples: 4, depthTexture: new DepthTexture(1, 1) });
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

export function createPost(renderer: WebGLRenderer, scene: Scene, camera: PerspectiveCamera, quality: QualitySettings): Post {
  const composer = new EffectComposer(renderer);
  // setSize is given drawing-buffer pixels, already scaled by the renderer's pixel ratio: don't scale them again.
  composer.setPixelRatio(1);
  // Multisampled half-float targets need a colour-buffer extension: without one (some phones), antialiasing would
  // quietly fail, so draw into an 8-bit target instead (a little banding in deep shadow, but smooth edges).
  const halfFloat = renderer.extensions.has("EXT_color_buffer_float") || renderer.extensions.has("EXT_color_buffer_half_float");
  const scenePass = new ScenePass(scene, camera, halfFloat);
  const depth = scenePass.target.depthTexture!;
  composer.addPass(scenePass);

  if (quality.ambientOcclusion) {
    const gtao = new GTAOPass(scene, camera, 1, 1);
    // Normals come from the shared depth, not a second draw of the scene.
    gtao.setGBuffer(depth);
    // Ambient occlusion is soft and denoised: half resolution looks the same at a quarter of the cost. The composer
    // sizes every pass, so halve it there.
    const fullSize = gtao.setSize.bind(gtao);
    gtao.setSize = (w, h) => fullSize(Math.max(1, Math.round(w / 2)), Math.max(1, Math.round(h / 2)));
    gtao.updateGtaoMaterial({ radius: 12, distanceExponent: 1.4, thickness: 5, scale: 1.2, samples: 16 });
    gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
    gtao.blendIntensity = 1;
    composer.addPass(gtao);
  }

  // Depth of field: three's bokeh shader, reading the shared depth (BokehPass would draw the scene again for it).
  let bokeh: ShaderPass | null = null;
  if (quality.depthOfField) {
    bokeh = new ShaderPass(BokehShader, "tColor");
    bokeh.material.defines.DEPTH_PACKING = 0;
    bokeh.uniforms.tDepth.value = depth;
    bokeh.uniforms.maxblur.value = 0.006;
    composer.addPass(bokeh);
  }

  // Tone mapping and sRGB output happen in the lens pass, saving a full-screen pass of their own.
  const lens = new ShaderPass(LensShader);
  composer.addPass(lens);

  return {
    composer,
    setSize(w, h) {
      composer.setSize(w, h);
      lens.uniforms.resolution.value.set(w, h);
      if (bokeh) bokeh.uniforms.aspect.value = w / h;
    },
    setFocus(distance) {
      if (!bokeh) return;
      bokeh.uniforms.focus.value = distance;
      bokeh.uniforms.aperture.value = apertureFor(distance);
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
