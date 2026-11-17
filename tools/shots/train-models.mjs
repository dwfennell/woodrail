// Every engine and wagon one by one, each beside a row house at the same scale (to judge the models' quality against
// the towns' rows), drawn by the game on this machine's GPU on a plain slab high over the map:
// `node tools/shots/train-models.mjs [<out dir>] [--only=engine,passenger] [--yaw=2.4] [--pitch=1.15]`: <out>/<name>.jpg
// and <out>/sheet.jpg. The cars are built as the game builds them (`buildCarModel`), in their own colours.
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const args = process.argv.slice(2);
const OUT = args.find((a) => !a.startsWith("--")) ?? "e2e-out/train-models";
const num = (name, d) => Number(args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? d);
const only = args.find((a) => a.startsWith("--only="))?.slice(7).split(",");
/** [kind, look, the picture's name]. */
const CARS = [
  ["engine", "classic", "engine"],
  ["engine", "goods", "engine-goods"],
  ["engine", "tank", "engine-tank"],
  ["engine", "express", "engine-express"],
  ["engine", "diesel", "engine-diesel"],
  ["engine", "electric", "engine-electric"],
  ["engine", "rack", "engine-rack"],
  ["engine", "metro", "engine-metro"],
  ["engine", "royal", "engine-royal"],
  ["passenger", "classic", "passenger-coach"],
  ["passenger", "first-class", "passenger-first-class"],
  ["passenger", "dining", "passenger-dining"],
  ["passenger", "sleeper", "passenger-sleeper"],
  ["passenger", "double-decker", "passenger-double-decker"],
  ["passenger", "observation", "passenger-observation"],
  ["passenger", "royal", "passenger-royal"],
  ["caboose", "classic", "caboose"],
  ["caboose", "bay-window", "caboose-bay-window"],
  ["hopper", "classic", "wagon-hopper"],
  ["timber", "classic", "wagon-flatbed"],
  ["van", "classic", "wagon-goods-van"],
  ["tanker", "classic", "wagon-milk-tank"],
  ["oiltank", "classic", "wagon-tank"],
  ["reefer", "classic", "wagon-cold-van"],
  ["carrier", "classic", "wagon-car-carrier"],
  ["mailvan", "classic", "wagon-mail-van"],
  ["sortvan", "classic", "wagon-sorting-van"],
  ["cage", "classic", "wagon-circus-cage"],
  ["crane", "classic", "wagon-breakdown-crane"],
  ["cleaner", "classic", "wagon-track-cleaner"],
].filter(([, , name]) => !only || only.some((o) => name.includes(o)));
/** The row house each stands beside, and its colours. */
const BESIDE = "row-pair-a";
const VARIANT = 9;
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5398, strictPort: false }, logLevel: "error" });
await server.listen();
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
try {
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
  for (const [kind, look, name] of CARS) {
    const size = await p.evaluate(
      async ([kind, look, beside, variant, Y, yaw, pitch]) => {
        const { drawnKey } = await import("/src/render/props/library.ts");
        const { buildCarModel } = await import("/src/render/train-models.ts");
        const THREE = await import("/node_modules/.vite/deps/three.js").catch(() => import("three"));
        const w = window.woodrail;
        const scene = w.scene ?? w.landscapeView.group.parent;
        if (window.__shown) scene.remove(window.__shown);
        const g = new THREE.Group();
        const slab = new THREE.Mesh(new THREE.BoxGeometry(900, 2, 900), new THREE.MeshStandardMaterial({ color: "#7fb069" }));
        slab.position.y = -1;
        slab.receiveShadow = true;
        g.add(slab);
        // The car, as the game builds it (a hopper with its modelled load), stood with its wheels on the slab.
        const car = buildCarModel(kind, w.mats, 0, look, true).root;
        car.traverse((o) => (o.castShadow = o.receiveShadow = true));
        car.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(car);
        car.position.y = -box.min.y;
        g.add(car);
        // The row house behind it.
        const m = await w.propLibrary.load(drawnKey(beside, variant, 0));
        for (const part of m.parts) {
          const mesh = new THREE.Mesh(part.geometry, part.material);
          mesh.castShadow = mesh.receiveShadow = true;
          mesh.userData.sharedGeometry = true;
          mesh.position.set(-70, 0, -70);
          g.add(mesh);
        }
        const t = w.world.landscape.towns[0].centre;
        g.position.set(t.x, Y, t.z);
        scene.add(g);
        window.__shown = g;
        const V = w.camera.position.constructor;
        w.lookAt(new V(t.x - 30, Y + 18, t.z - 30), 310, pitch, yaw);
        for (const el of document.body.querySelectorAll("*")) if (el.tagName !== "CANVAS" && !el.querySelector("canvas") && !el.closest("canvas")) el.style.visibility = "hidden";
        w.invalidate();
        await Promise.race([w.settled(3), new Promise((r) => setTimeout(r, 8000))]);
        let triangles = 0;
        car.traverse((o) => {
          const geo = o.geometry;
          if (geo) triangles += (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
        });
        return [box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z, triangles].map(Math.round);
      },
      [kind, look, BESIDE, VARIANT, Y, num("yaw", 2.4), num("pitch", 1.15)],
    );
    await p.waitForTimeout(400);
    await p.screenshot({ path: `${OUT}/${name}.jpg`, type: "jpeg", quality: 86 });
    console.log(name, `${size[0]} x ${size[2]} mm, ${size[1]} high, ${size[3]} triangles`);
  }
  // The sheet: every picture in a grid, each under its name.
  const sheet = await b.newPage({ viewport: { width: 1600, height: 100 }, deviceScaleFactor: 1 });
  const cells = CARS.map(([, , name]) => `<figure><img src="data:image/jpeg;base64,${readFileSync(`${OUT}/${name}.jpg`).toString("base64")}"><figcaption>${name}</figcaption></figure>`).join("");
  await sheet.setContent(`<style>body{margin:0;display:grid;grid-template-columns:repeat(5,320px);font:14px sans-serif;background:#fff}figure{margin:0}img{width:320px;display:block}figcaption{text-align:center;padding:4px}</style>${cells}`);
  await sheet.screenshot({ path: `${OUT}/sheet.jpg`, type: "jpeg", quality: 86, fullPage: true });
} finally {
  await b.close();
  await server.close();
}
