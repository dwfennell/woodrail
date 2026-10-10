import { Color, MeshPhysicalMaterial, MeshStandardMaterial, Vector2 } from "three";
import { beechTextures, oakFloorTextures, rugTextures, wallTextures, weaveTexture, type SurfaceTextures } from "./textures";

export interface Materials {
  track: MeshPhysicalMaterial;
  /** Routed grooves and socket holes: bare, slightly darker wood. */
  trackCut: MeshStandardMaterial;
  trackGhost: MeshPhysicalMaterial;
  trackGhostSnap: MeshPhysicalMaterial;
  naturalWood: MeshPhysicalMaterial;
  floor: MeshPhysicalMaterial;
  rug: MeshPhysicalMaterial;
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

  const rugTex = rugTextures(anisotropy, textureSize);
  const rug = new MeshPhysicalMaterial({
    map: rugTex.map,
    bumpMap: weaveTexture(anisotropy),
    bumpScale: 1.6,
    roughness: 0.97,
    sheen: 0.45,
    sheenRoughness: 0.85,
    sheenColor: new Color("#c9b9a0"),
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

  return {
    track,
    trackCut,
    trackGhost: ghost("#ffffff"),
    trackGhostSnap: ghost("#9be37b"),
    naturalWood: woodMaterial(beech, 0.5),
    floor,
    rug,
    wall,
    skirting: new MeshPhysicalMaterial({ color: new Color("#f4efe6"), roughness: 0.4, clearcoat: 0.5 }),
    magnet: new MeshStandardMaterial({ color: new Color("#2a2b2e"), metalness: 0.85, roughness: 0.3 }),
    coal: new MeshStandardMaterial({ color: new Color("#1c1a19"), roughness: 0.7, metalness: 0.1 }),
    glass: new MeshPhysicalMaterial({ color: new Color("#1d2633"), roughness: 0.1, clearcoat: 1, metalness: 0.2 }),
    lacquer,
  };
}

export const BEECH_UV_SCALE = new Vector2(1 / 512, 1 / 128);
