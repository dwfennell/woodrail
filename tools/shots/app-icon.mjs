// The Android/iOS app's icon and splash (docs/native-builds.md): the title's "W" alphabet block (index.html's .wb) on
// the table's colour, drawn by a headless browser into assets/, where `npx capacitor-assets generate` makes every size
// from them.
//
//   node tools/shots/app-icon.mjs && npx capacitor-assets generate --android --ios
//
// assets/icon-only.png       1024², the block on the table (iOS, and Android's old square icon)
// assets/icon-foreground.png 1024², the block alone, inside the middle 66% Android's adaptive icons keep
// assets/icon-background.png 1024², the table
// assets/splash.png          2732², a small block in the middle of the table's flat colour (the window's, behind it:
//                            no seam; a gradient this size is megabytes in each of the copies the projects keep)
import { mkdirSync, readFileSync } from "node:fs";
import { chromium } from "playwright-core";

const OUT = "assets";
mkdirSync(OUT, { recursive: true });

const html = readFileSync("index.html", "utf8");
const blockCss = html.slice(html.indexOf("      .wb {"), html.indexOf("    </style>"));
const font = readFileSync("node_modules/@fontsource/nunito/files/nunito-latin-800-normal.woff2").toString("base64");
const table = "radial-gradient(circle at 50% 40%, #f3e6cf, #cbb595)";

/** One square picture: `size` px, the block `block` px wide (0: none), on `ground` (a CSS background) or clear. */
function page(size, block, ground) {
  return `<!doctype html><html><head><style>
    @font-face { font-family: "Nunito"; font-weight: 800; src: url(data:font/woff2;base64,${font}) format("woff2"); }
    html, body { margin: 0; width: ${size}px; height: ${size}px; background: ${ground || "transparent"}; }
    body { display: grid; place-items: center; }
    ${blockCss}
    .wb { font-size: ${block}px; }
  </style></head><body>${block ? '<span class="wb" style="--ink: #c8442f; --tilt: -3deg"><b>W</b></span>' : ""}</body></html>`;
}

const browser = await chromium.launch();
const shoot = async (name, size, block, ground) => {
  const p = await browser.newPage({ viewport: { width: size, height: size } });
  await p.setContent(page(size, block, ground));
  await p.evaluate(() => document.fonts.ready);
  await p.screenshot({ path: `${OUT}/${name}`, omitBackground: !ground });
  await p.close();
  console.log(`${OUT}/${name}`);
};
await shoot("icon-only.png", 1024, 640, table);
await shoot("icon-foreground.png", 1024, 520, "");
await shoot("icon-background.png", 1024, 0, table);
await shoot("splash.png", 2732, 560, "#cbbba3");
await browser.close();
