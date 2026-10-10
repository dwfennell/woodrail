import { Color, MeshPhysicalMaterial, MeshStandardMaterial, Vector2 } from "three";
import type { Texture } from "three";
import { beechTextures, feltTextures, mottleTexture, oakFloorTextures, stitchTexture, wallTextures, type SurfaceTextures } from "./textures";

export interface Materials {
  track: MeshPhysicalMaterial;
  /** Routed grooves and socket holes: bare, slightly darker wood. */
  trackCut: MeshStandardMaterial;
  trackGhost: MeshPhysicalMaterial;
  trackGhostSnap: MeshPhysicalMaterial;
  trackGhostBlocked: MeshPhysicalMaterial;
  felt: MeshPhysicalMaterial;
  /** Darker felt binding strip around the mat's edge, and the cream stitches on it. */
  hemFelt: MeshPhysicalMaterial;
  stitch: MeshStandardMaterial;
  riverFelt: MeshPhysicalMaterial;
  roadFelt: MeshPhysicalMaterial;
  blockWood: MeshPhysicalMaterial;
  blockWoodDark: MeshPhysicalMaterial;
  blockTop: MeshPhysicalMaterial;
  naturalWood: MeshPhysicalMaterial;
  floor: MeshPhysicalMaterial;
  wall: MeshStandardMaterial;
  skirting: MeshPhysicalMaterial;
  magnet: MeshStandardMaterial;
  coal: MeshStandardMaterial;
  glass: MeshPhysicalMaterial;
  lacquer: (color: string) => MeshPhysicalMaterial;
}

function woodMaterial(t: SurfaceTextures, bump: number): MeshPhysicalMaterial {
  return new MeshPhysicalMaterial({
    map: t.map,
    roughnessMap: t.roughnessMap,
    bumpMap: t.bumpMap,
    bumpScale: bump,
    roughness: 1,
    clearcoat: 0.35,
    clearcoatRoughness: 0.45,
    sheen: 0.15,
    sheenRoughness: 0.6,
    sheenColor: new Color("#fff1dc"),
  });
}

export function createMaterials(anisotropy: number, textureSize: number): Materials {
  const beech = beechTextures(anisotropy);
  const track = woodMaterial(beech, 0.6);

  const ghost = (color: string) =>
    new MeshPhysicalMaterial({
      map: beech.map,
      color: new Color(color),
      transparent: true,
      opacity: 0.55,
      roughness: 0.6,
      depthWrite: false,
      emissive: new Color(color),
      emissiveIntensity: 0.15,
    });

  const floorTex = oakFloorTextures(anisotropy, textureSize);
  const floor = new MeshPhysicalMaterial({
    map: floorTex.map,
    roughnessMap: floorTex.roughnessMap,
    bumpMap: floorTex.bumpMap,
    bumpScale: 1.2,
    roughness: 1,
    clearcoat: 0.6,
    clearcoatRoughness: 0.25,
  });

  const wallTex = wallTextures(anisotropy);
  const wall = new MeshStandardMaterial({ map: wallTex.map, bumpMap: wallTex.bumpMap, bumpScale: 0.6, roughness: 0.92 });

  const lacquerCache = new Map<string, MeshPhysicalMaterial>();
  const lacquer = (color: string) => {
    let m = lacquerCache.get(color);
    if (!m) {
      m = new MeshPhysicalMaterial({
        color: new Color(color),
        roughness: 0.38,
        clearcoat: 1,
        clearcoatRoughness: 0.12,
        bumpMap: beech.bumpMap,
        bumpScale: 0.25,
      });
      lacquerCache.set(color, m);
    }
    return m;
  };

  const trackCut = new MeshStandardMaterial({ map: beech.map, color: new Color("#a88866"), roughness: 0.85, bumpMap: beech.bumpMap, bumpScale: 0.4 });

  const mottle = mottleTexture();
  const feltMaterial = (color: string, repeat: number, sheen: string, mottleStrength: number) => {
    const t = feltTextures(anisotropy, color, repeat);
    const m = new MeshPhysicalMaterial({
      map: t.map,
      bumpMap: t.bumpMap,
      bumpScale: 1.6,
      roughness: 1,
      sheen: 0.6,
      sheenRoughness: 0.8,
      sheenColor: new Color(sheen),
    });
    return withWorldMottle(m, mottle, 1400, mottleStrength);
  };
  // Felt textures tile in uv space. The mat's uvs span 0..1 (repeat across its 3.2 m); the river and road ribbons
  // have uvs in mm / FELT_TILE.
  const felt = feltMaterial("#477834", 24, "#8fbf6a", 0.1);
  const hemFelt = feltMaterial("#2f5223", 24, "#6f9a55", 0.05);
  const riverFelt = feltMaterial("#2a63a0", 1, "#86b4e8", 0.08);
  const roadFelt = feltMaterial("#8d8a82", 1, "#e8e4da", 0.05);
  const stitch = new MeshStandardMaterial({ map: stitchTexture(anisotropy), transparent: true, alphaTest: 0.3, roughness: 0.9 });
  const blockWood = woodMaterial(beech, 0.5);
  const blockWoodDark = woodMaterial(beech, 0.5);
  blockWoodDark.color = new Color("#d9b48c");
  const blockTop = new MeshPhysicalMaterial({ color: new Color("#5e9446"), roughness: 0.5, clearcoat: 0.6, clearcoatRoughness: 0.3, bumpMap: beech.bumpMap, bumpScale: 0.3 });

  return {
    track,
    trackCut,
    trackGhostBlocked: ghost("#ff6b5a"),
    felt,
    hemFelt,
    stitch,
    riverFelt,
    roadFelt,
    blockWood,
    blockWoodDark,
    blockTop,
    trackGhost: ghost("#ffffff"),
    trackGhostSnap: ghost("#9be37b"),
    naturalWood: woodMaterial(beech, 0.5),
    floor,
    wall,
    skirting: new MeshPhysicalMaterial({ color: new Color("#f4efe6"), roughness: 0.4, clearcoat: 0.5 }),
    magnet: new MeshStandardMaterial({ color: new Color("#2a2b2e"), metalness: 0.85, roughness: 0.3 }),
    coal: new MeshStandardMaterial({ color: new Color("#1c1a19"), roughness: 0.7, metalness: 0.1 }),
    glass: new MeshPhysicalMaterial({ color: new Color("#1d2633"), roughness: 0.1, clearcoat: 1, metalness: 0.2 }),
    lacquer,
  };
}

/** Size (mm) of one felt texture tile on the river and road ribbons. */
export const FELT_TILE = 133;

/**
 * Multiply a material's base colour by a low-frequency noise sampled in world xz (period `scale` mm), so large felt
 * areas vary gently in tone instead of reading as one flat colour.
 */
function withWorldMottle<T extends MeshStandardMaterial>(m: T, tex: Texture, scale: number, strength: number): T {
  m.onBeforeCompile = (shader) => {
    shader.uniforms.mottleMap = { value: tex };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vMottleUv;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>\nvMottleUv = (modelMatrix * vec4(transformed, 1.0)).xz / ${scale.toFixed(1)};`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform sampler2D mottleMap;\nvarying vec2 vMottleUv;")
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>\nfloat mottle = texture2D(mottleMap, vMottleUv).r * 0.6 + texture2D(mottleMap, vMottleUv * 3.7).r * 0.4;\ndiffuseColor.rgb *= 1.0 + (mottle - 0.5) * ${(strength * 2).toFixed(3)};`,
      );
  };
  m.customProgramCacheKey = () => `mottle-${scale}-${strength}`;
  return m;
}

export const BEECH_UV_SCALE = new Vector2(1 / 512, 1 / 128);
