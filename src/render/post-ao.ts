import type { DepthTexture, PerspectiveCamera, Scene } from "three";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";

/**
 * Ambient occlusion (three's GTAO), on its own: only the high tier draws it, so post.ts loads this the first time
 * it's wanted, and a phone never fetches it (with its shaders and noise, about 17 KB).
 */
export function aoPass(scene: Scene, camera: PerspectiveCamera, depth: DepthTexture): GTAOPass {
  const gtao = new GTAOPass(scene, camera, 1, 1);
  // Normals come from the shared depth, not a second draw of the scene.
  gtao.setGBuffer(depth);
  // Ambient occlusion is soft and denoised: half resolution looks the same at a quarter of the cost. The composer
  // sizes every pass, so halve it there.
  const fullSize = gtao.setSize.bind(gtao);
  gtao.setSize = (w, h) => fullSize(Math.max(1, Math.round(w / 2)), Math.max(1, Math.round(h / 2)));
  gtao.updateGtaoMaterial({ radius: 12, distanceExponent: 1.4, thickness: 5, scale: 1.2, samples: 16 });
  gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
  return gtao;
}
