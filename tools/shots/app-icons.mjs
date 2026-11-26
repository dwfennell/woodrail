// The home-screen icons for the GitHub Pages copy (vite.config.ts `homeScreenApp`): the favicon's red toy engine on a
// beech tile, drawn by Chromium at each size into src/assets/app-icons/. Run again after changing the drawing.
// `node tools/shots/app-icons.mjs`. The engine sits inside the middle 70%, so one drawing serves as maskable too.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const OUT = fileURLToPath(new URL("../../src/assets/app-icons/", import.meta.url));
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <defs>
    <radialGradient id="beech" cx="50%" cy="38%" r="75%"><stop offset="0" stop-color="#f6ead2"/><stop offset="1" stop-color="#d9bf94"/></radialGradient>
    <linearGradient id="sheen" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.28"/><stop offset="0.5" stop-color="#fff" stop-opacity="0"/></linearGradient>
  </defs>
  <rect width="100" height="100" fill="url(#beech)"/>
  <g fill="none" stroke="#c9a676" stroke-opacity="0.35" stroke-width="0.8"><path d="M0 18c30 4 60-4 100 2M0 46c35 3 65-5 100 1M0 84c30 3 70-3 100 0"/></g>
  <g transform="translate(15 17) scale(2.19)">
    <rect x="1" y="25" width="30" height="4" rx="2" fill="#c8955c"/>
    <rect x="4" y="12" width="17" height="11" rx="2" fill="#d8473b"/>
    <rect x="19" y="6" width="10" height="17" rx="2" fill="#d8473b"/>
    <rect x="4" y="12" width="25" height="11" rx="2" fill="url(#sheen)"/>
    <rect x="7" y="6" width="4" height="7" rx="1" fill="#333"/>
    <rect x="21" y="9" width="6" height="5" rx="1" fill="#f3e3c3"/>
    <circle cx="9" cy="24" r="4" fill="#333"/><circle cx="23" cy="24" r="4" fill="#333"/>
    <circle cx="9" cy="24" r="1.4" fill="#e6b52c"/><circle cx="23" cy="24" r="1.4" fill="#e6b52c"/>
  </g>
</svg>`;
const b = await chromium.launch({ executablePath: CHROMIUM, args: ["--mute-audio"] });
for (const size of [180, 192, 512]) {
  const p = await b.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await p.setContent(`<html><body style="margin:0">${svg.replace("<svg ", `<svg width="${size}" height="${size}" `)}</body></html>`);
  await p.screenshot({ path: `${OUT}icon-${size}.png` });
  await p.close();
}
await b.close();
console.log(`icons: ${OUT}icon-{180,192,512}.png`);
