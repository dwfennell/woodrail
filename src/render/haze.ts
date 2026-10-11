import { ShaderChunk } from "three";
import { MAT_DEPTH, MAT_WIDTH, outsideDistance } from "../landscape";

/**
 * Atmospheric haze for a world with no edge: three's linear fog, but measured as distance outside the mat (plus a
 * touch of distance from the camera) instead of distance from the camera alone. The mat stays crisp at any zoom and
 * the scenery around it fades into the sky's horizon colour by the ring's outer edge.
 */

export const HAZE_COLOR = "#e6d9c3";
/** Haze starts this far (mm) outside the mat… */
export const HAZE_NEAR = 500;
/** …and is total here. */
export const HAZE_FAR = 2900;
/** How much distance from the camera adds (a little aerial perspective). */
export const HAZE_VIEW = 0.03;

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** The haze amount at plan (x, z) seen from `cameraDistance` mm away (the shader uses view depth, a close stand-in). */
export function hazeAt(x: number, z: number, cameraDistance: number): number {
  return smoothstep(HAZE_NEAR, HAZE_FAR, outsideDistance(x, z) + HAZE_VIEW * cameraDistance);
}

/**
 * Replace three's fog chunks (once, before any material compiles). The vertex shader passes on plan position and view
 * depth, both exact under interpolation, and the haze is measured per pixel, so it is right even across one huge
 * triangle such as the felt ground. World position comes from the view-space position, which works in every
 * built-in shader, instanced or not: world = camera + transpose(view rotation) · mv.
 */
export function installHaze(): void {
  ShaderChunk.fog_pars_vertex = `#ifdef USE_FOG
  varying vec3 vHaze;
#endif`;
  ShaderChunk.fog_vertex = `#ifdef USE_FOG
  vec3 hazeWorld = cameraPosition + (vec4(mvPosition.xyz, 0.0) * viewMatrix).xyz;
  vHaze = vec3(hazeWorld.xz, -mvPosition.z);
#endif`;
  ShaderChunk.fog_pars_fragment = `#ifdef USE_FOG
  uniform vec3 fogColor;
  uniform float fogNear;
  uniform float fogFar;
  varying vec3 vHaze;
#endif`;
  ShaderChunk.fog_fragment = `#ifdef USE_FOG
  vec2 hazeOut = max(abs(vHaze.xy) - vec2(${MAT_WIDTH / 2}.0, ${MAT_DEPTH / 2}.0), 0.0);
  float fogFactor = smoothstep(fogNear, fogFar, length(hazeOut) + ${HAZE_VIEW.toFixed(3)} * vHaze.z);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor);
#endif`;
}
