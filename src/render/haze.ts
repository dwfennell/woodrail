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

/** Flat surfaces lower than this (mm) are ground and never cut away (the felt and its hem stay put). */
export const CUTAWAY_MIN_HEIGHT = 3;
/**
 * Scenery whose plan distance from the camera is under this fraction of the target's is fully cut away; it fades
 * back in by FADE_END (of the target's distance).
 */
export const CUTAWAY_FADE_START = 0.8;
export const CUTAWAY_FADE_END = 0.95;

/**
 * How much of a scenery point is cut away (0–1), as the shader decides: points outside the mat that aren't flat
 * ground (facing up, at ground level), nearer the camera (in plan) than the point it looks at.
 */
export function cutawayAt(
  point: { x: number; y: number; z: number },
  camera: { x: number; z: number },
  targetPlanDistance: number,
  facingUp = true,
): number {
  const ground = facingUp && point.y < CUTAWAY_MIN_HEIGHT;
  if (outsideDistance(point.x, point.z) <= 1 || ground) return 0;
  const h = Math.hypot(point.x - camera.x, point.z - camera.z);
  return 1 - smoothstep(CUTAWAY_FADE_START, CUTAWAY_FADE_END, h / Math.max(targetPlanDistance, 1));
}

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
  varying vec4 vHaze;
#endif`;
  ShaderChunk.fog_vertex = `#ifdef USE_FOG
  vec3 hazeWorld = cameraPosition + (vec4(mvPosition.xyz, 0.0) * viewMatrix).xyz;
  vHaze = vec4(hazeWorld.xz, -mvPosition.z, hazeWorld.y);
#endif`;
  ShaderChunk.fog_pars_fragment = `#ifdef USE_FOG
  uniform vec3 fogColor;
  uniform float fogNear;
  uniform float fogFar;
  varying vec4 vHaze;
#endif`;
  ShaderChunk.fog_fragment = `#ifdef USE_FOG
  vec2 hazeOut = max(abs(vHaze.xy) - vec2(${MAT_WIDTH / 2}.0, ${MAT_DEPTH / 2}.0), 0.0);
  float hazeOutside = length(hazeOut);
  // Cutaway: scenery outside the mat, standing above the ground and between the camera and the point it looks at,
  // dithers away so it never walls off the view. (The camera always looks at its target, on the ground: find it
  // along the view direction.)
  // Only the felt ground stays: flat (facing straight up) and at ground level. Block sides, bevels and tops all go.
  vec3 hazeWorldPos = vec3(vHaze.x, vHaze.w, vHaze.y);
  vec3 hazeNormal = normalize(cross(dFdx(hazeWorldPos), dFdy(hazeWorldPos)));
  bool hazeGround = abs(hazeNormal.y) > 0.95 && vHaze.w < ${CUTAWAY_MIN_HEIGHT.toFixed(1)};
  if (hazeOutside > 1.0 && !hazeGround) {
    vec3 hazeFwd = -vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
    if (hazeFwd.y < -0.01) {
      float hazeT = cameraPosition.y / -hazeFwd.y;
      float hazeTargetH = hazeT * length(hazeFwd.xz);
      float hazeH = length(vHaze.xy - cameraPosition.xz);
      float hazeCut = 1.0 - smoothstep(${CUTAWAY_FADE_START.toFixed(2)}, ${CUTAWAY_FADE_END.toFixed(2)}, hazeH / max(hazeTargetH, 1.0));
      if (hazeCut > 0.0 && fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) < hazeCut) discard;
    }
  }
  float fogFactor = smoothstep(fogNear, fogFar, hazeOutside + ${HAZE_VIEW.toFixed(3)} * vHaze.z);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor);
#endif`;
}
