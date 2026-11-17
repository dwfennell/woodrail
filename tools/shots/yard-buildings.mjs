// The railway yard buildings one by one, each beside a row house at the same scale (to judge them against the towns'
// rows), drawn by the game on this machine's GPU on a plain slab high over the map:
// `node tools/shots/yard-buildings.mjs [<out dir>] [--only=shed,box] [--ids=bldg-school,…] [--yaw=2] [--pitch=1.05]`:
// <out>/<id>.jpg and <out>/sheet.jpg.
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const args = process.argv.slice(2);
const OUT = args.find((a) => !a.startsWith("--")) ?? "e2e-out/yard-buildings";
const num = (name, d) => Number(args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? d);
const only = args.find((a) => a.startsWith("--only="))?.slice(7).split(",");
/** `--ids=bldg-school,bldg-college`: other models from the catalogue, the same way (to judge what else needs the look). */
const others = args.find((a) => a.startsWith("--ids="))?.slice(6).split(",");
const IDS = others ?? [
  "bldg-goods-shed",
  "bldg-warehouse",
  "bldg-platform-furnished",
  "bldg-ticket-booth",
  "bldg-waiting-shelter",
  "bldg-signal-box",
  "bldg-water-tower",
  "bldg-coal-stage",
  "bldg-engine-shed",
  "bldg-roundhouse-segment",
].filter((id) => !only || only.some((o) => id.includes(o)));
/** The row house each stands beside, and its colours. */
const BESIDE = "row-pair-a";
const VARIANT = 9;
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5397, strictPort: false }, logLevel: "error" });
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
const Y = 160;
for (const id of IDS) {
  const size = await p.evaluate(
    async ([id, beside, variant, Y, yaw, pitch]) => {
      // (`modelKey`, not `drawnKey`: a model with a part that turns, a wheel, a clock's hands, is drawn here whole.)
      const { modelKey } = await import("/src/render/props/library.ts");
      const THREE = await import("/node_modules/.vite/deps/three.js").catch(() => import("three"));
      const w = window.woodrail;
      const scene = w.scene ?? w.landscapeView.group.parent;
      if (window.__shown) scene.remove(window.__shown);
      const g = new THREE.Group();
      const slab = new THREE.Mesh(new THREE.BoxGeometry(900, 2, 900), new THREE.MeshStandardMaterial({ color: "#7fb069" }));
      slab.position.y = -1;
      slab.receiveShadow = true;
      g.add(slab);
      const put = async (asset, v, dz) => {
        const m = await w.propLibrary.load(modelKey(asset, v, 0));
        const box = new THREE.Box3();
        for (const part of m.parts) {
          const mesh = new THREE.Mesh(part.geometry, part.material);
          mesh.castShadow = mesh.receiveShadow = true;
          mesh.userData.sharedGeometry = true;
          mesh.position.z = dz;
          g.add(mesh);
          part.geometry.computeBoundingBox();
          box.union(part.geometry.boundingBox);
        }
        return box;
      };
      const box = await put(id, 0, 0);
      // (The row house stands clear of the yard building's side, whatever its width.)
      await put(beside, variant, box.max.z + 60);
      const t = w.world.landscape.towns[0].centre;
      g.position.set(t.x, Y, t.z);
      scene.add(g);
      window.__shown = g;
      const V = w.camera.position.constructor;
      const span = Math.max(box.max.x - box.min.x, box.max.z - box.min.z + 130);
      // (A tall model, a cathedral's spires: looked at halfway up, from far enough to hold its top.)
      w.lookAt(new V(t.x, Y + Math.max(20, box.max.y * 0.4), t.z + (box.max.z + 96 + box.min.z) / 2), Math.max(300, span * 1.5, box.max.y * 3.2), pitch, yaw);
      for (const el of document.body.querySelectorAll("*")) if (el.tagName !== "CANVAS" && !el.querySelector("canvas") && !el.closest("canvas")) el.style.visibility = "hidden";
      w.invalidate();
      await Promise.race([w.settled(3), new Promise((r) => setTimeout(r, 8000))]);
      return [box.max.x - box.min.x, box.max.y, box.max.z - box.min.z].map(Math.round);
    },
    [id, BESIDE, VARIANT, Y, num("yaw", 2), num("pitch", 1.05)],
  );
  await p.waitForTimeout(500);
  await p.screenshot({ path: `${OUT}/${id}.jpg`, type: "jpeg", quality: 84 });
  console.log(id, `${size[0]} x ${size[2]} mm, ${size[1]} high`);
}
// The sheet: every picture in a grid, each under its name.
const sheet = await b.newPage({ viewport: { width: 1600, height: 100 }, deviceScaleFactor: 1 });
const cells = IDS.map((id) => `<figure><img src="data:image/jpeg;base64,${readFileSync(`${OUT}/${id}.jpg`).toString("base64")}"><figcaption>${id.slice(5)}</figcaption></figure>`).join("");
await sheet.setContent(`<style>body{margin:0;display:grid;grid-template-columns:repeat(5,320px);font:14px sans-serif;background:#fff}figure{margin:0}img{width:320px;display:block}figcaption{text-align:center;padding:4px}</style>${cells}`);
await sheet.screenshot({ path: `${OUT}/sheet.jpg`, type: "jpeg", quality: 86, fullPage: true });
await b.close();
await server.close();
