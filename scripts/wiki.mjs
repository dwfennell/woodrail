#!/usr/bin/env node
/**
 * Make the Woodrail wiki from the game's own data (src/wiki, docs/superpowers/specs/2026-11-07-wiki-design.md):
 *
 *   npm run wiki [-- --out dist/wiki]
 *
 * The game's modules have extensionless imports and worker chunks, so they're loaded through Vite's SSR loader with
 * the project's config, as Vitest loads them. Writes each page's index.html, style.css, sitemap.xml and pictures/ under --out.
 */
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createServer } from "vite";

const args = process.argv.slice(2);
const at = args.indexOf("--out");
const out = resolve(at === -1 ? "dist/wiki" : args[at + 1]);

const vite = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: "custom", logLevel: "error", optimizeDeps: { noDiscovery: true, include: [] } });
try {
  const { buildWiki } = await vite.ssrLoadModule("/src/wiki/pages.ts");
  const wiki = buildWiki();
  rmSync(out, { recursive: true, force: true });
  for (const page of wiki.pages) {
    const dir = join(out, page.path);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "index.html"), page.html);
  }
  writeFileSync(join(out, "style.css"), wiki.css);
  writeFileSync(join(out, "sitemap.xml"), wiki.sitemap);
  // The game's pictures of its industries, engines and wagons (`npm run wiki:pictures`).
  if (existsSync("src/wiki/pictures")) cpSync("src/wiki/pictures", join(out, "pictures"), { recursive: true });
  console.log(`wrote ${wiki.pages.length} wiki pages to ${out}`);
} finally {
  await vite.close();
}
