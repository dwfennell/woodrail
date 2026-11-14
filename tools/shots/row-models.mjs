// The row models one by one (tools/blender/bldg_rows.py), drawn by the game on this machine's GPU, on a plain slab high
// over the map: `node tools/shots/row-models.mjs [<out dir>] [--only=church,hall] [--variant=9]`: <out>/<id>.jpg and a
// sheet of them all.
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const args = process.argv.slice(2);
const OUT = args.find((a) => !a.startsWith("--")) ?? "e2e-out/row-models";
const only = args.find((a) => a.startsWith("--only="))?.slice(7).split(",");
const variant = Number(args.find((a) => a.startsWith("--variant="))?.slice(10) ?? 9);
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5398, strictPort: false }, logLevel: "error" });
await server.listen();
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const p = await b.newPage({ viewport: { width: 640, height: 480 }, deviceScaleFactor: 1 });
p.on("pageerror", (e) => console.log("pageerror", e.message));
await p.addInitScript(() => localStorage.setItem("woodrail.helpSeen", "1"));
await p.goto(server.resolvedUrls.local[0]);
await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
await p.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((x) => !x.hidden && x.classList.contains("primary")).click());
await p.waitForSelector(".new-game-sheet:not([hidden]) .new-game-start", { timeout: 60000 });
await p.click('.new-game-sheet:not([hidden]) [data-hills="flat"]');
await p.click(".new-game-sheet:not([hidden]) .new-game-start");
await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
await p.evaluate(() => Promise.race([window.woodrail.settled(3), new Promise((r) => setTimeout(r, 20000))]));
await p.keyboard.press("Escape");
const ids = await p.evaluate(async () => {
  const { civicAssets, rowAssetIds } = await import("/src/props/rows.ts");
  return [...civicAssets().map((c) => c.id), ...rowAssetIds()];
});
const Y = 160;
const yaw = Number(args.find((a) => a.startsWith("--yaw="))?.slice(6) ?? 2.4);
for (const id of ids.filter((i) => !only || only.some((o) => i.includes(o)))) {
  const tris = await p.evaluate(
    async ([id, variant, Y, yaw, pitch]) => {
      const { drawnKey } = await import("/src/render/props/library.ts");
      const THREE = await import("/node_modules/.vite/deps/three.js").catch(() => import("three"));
      const w = window.woodrail;
      const scene = w.scene ?? w.landscapeView.group.parent;
      if (window.__shown) scene.remove(window.__shown);
      const g = new THREE.Group();
      const slab = new THREE.Mesh(new THREE.BoxGeometry(900, 2, 900), new THREE.MeshStandardMaterial({ color: "#7fb069" }));
      slab.position.y = -1;
      slab.receiveShadow = true;
      g.add(slab);
      const m = await w.propLibrary.load(drawnKey(id, variant, 0));
      let tris = 0;
      for (const part of m.parts) {
        const mesh = new THREE.Mesh(part.geometry, part.material);
        mesh.castShadow = mesh.receiveShadow = true;
        mesh.userData.sharedGeometry = true;
        g.add(mesh);
        tris += (part.geometry.index ? part.geometry.index.count : part.geometry.getAttribute("position").count) / 3;
      }
      const t = w.world.landscape.towns[0].centre;
      g.position.set(t.x, Y, t.z);
      scene.add(g);
      window.__shown = g;
      const V = w.camera.position.constructor;
      w.lookAt(new V(t.x, Y + 20, t.z), 300, pitch, yaw);
      for (const el of document.body.querySelectorAll("*")) if (el.tagName !== "CANVAS" && !el.querySelector("canvas") && !el.closest("canvas")) el.style.visibility = "hidden";
      w.invalidate();
      await Promise.race([w.settled(3), new Promise((r) => setTimeout(r, 8000))]);
      return Math.round(tris);
    },
    [id, variant, Y, yaw, Number(args.find((a) => a.startsWith("--pitch="))?.slice(8) ?? 0.3)],
  );
  await p.waitForTimeout(500);
  await p.screenshot({ path: `${OUT}/${id}.jpg`, type: "jpeg", quality: 84 });
  console.log(id, tris, "triangles");
}
await b.close();
await server.close();
