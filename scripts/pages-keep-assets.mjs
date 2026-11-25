// Keep the previous deploys' hashed files on GitHub Pages (`node scripts/pages-keep-assets.mjs --site <url> [--dist
// dist] [--sha <commit>]`), run by .github/workflows/deploy-pages.yml after the build and before the upload.
//
// Why: a Pages deploy replaces the whole site, so a tab opened before it (its index.html and entry script are the old
// build's) asks for old chunk names when it first opens a lazily loaded sheet, and they're gone: "Couldn't fetch that
// part of the game". Each push to main deploys, many times a day.
//
// How: each deploy writes `asset-history.json` at the site's root: a list of deploys, newest first, each with its
// sha, time and every file under assets/ with its size. The next deploy reads the live site's list, keeps the deploys
// no older than MAX_AGE_DAYS (at most MAX_DEPLOYS, and MAX_BYTES of old files in all), fetches from the live site each
// of their files the new build doesn't have, into dist/assets/, and writes the list again with itself first. A file
// the live site no longer has is dropped from its deploy. With no list on the site (the first deploy with this
// script), the live build's files are found by reading its index.html and the scripts and styles it names.
//
// Only assets/ is touched: index.html, version.json, models/ and the wiki are the new build's, as before.
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const HISTORY = "asset-history.json";
export const MAX_AGE_DAYS = 7;
export const MAX_DEPLOYS = 60;
export const MAX_BYTES = 300 * 1024 * 1024;

/**
 * Which old deploys to keep and which of their files to fetch. `history`: the live list (newest first); `current`:
 * this build's files ({ "assets/x.js": bytes }). Returns `keep` (the old deploys kept, newest first) and `fetch` (the
 * paths to fetch: in a kept deploy, not in this build), and `dropped` (the old deploys left out).
 */
export function plan(history, current, now = Date.now(), { maxAgeDays = MAX_AGE_DAYS, maxDeploys = MAX_DEPLOYS, maxBytes = MAX_BYTES } = {}) {
  const keep = [];
  const dropped = [];
  const fetch = new Set();
  let bytes = 0;
  for (const d of history) {
    const age = now - Date.parse(d.at);
    const extra = Object.entries(d.files ?? {}).filter(([f]) => !(f in current) && !fetch.has(f));
    const more = extra.reduce((s, [, n]) => s + (n || 0), 0);
    if (!(age <= maxAgeDays * 86400_000) || keep.length >= maxDeploys || bytes + more > maxBytes) {
      dropped.push(d);
      continue;
    }
    keep.push(d);
    for (const [f] of extra) fetch.add(f);
    bytes += more;
  }
  return { keep, fetch: [...fetch], dropped, bytes };
}

/** The hashed file names a built page or script names (`assets/x-AbC123.js`, `./x-AbC123.js`), as `assets/…`. */
export function namedAssets(text) {
  const out = new Set();
  for (const m of text.matchAll(/(?:assets\/|\.\/)([\w.-]+-[\w-]{8}\.(?:js|mjs|css|woff2?|webp|png|jpe?g|svg|wasm|json))\b/g)) out.add(`assets/${m[1]}`);
  return out;
}

/** Every file under `dir/assets`, as { "assets/x.js": bytes }. */
export function listAssets(dir) {
  const files = {};
  const walk = (rel) => {
    for (const e of readdirSync(join(dir, rel), { withFileTypes: true })) {
      const r = `${rel}/${e.name}`;
      if (e.isDirectory()) walk(r);
      else files[r] = statSync(join(dir, r)).size;
    }
  };
  if (existsSync(join(dir, "assets"))) walk("assets");
  return files;
}

async function get(url) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { cache: "no-store" });
      if (r.status === 404) return null;
      if (r.ok) return Buffer.from(await r.arrayBuffer());
    } catch {
      /* try again */
    }
    await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
  }
  throw new Error(`couldn't fetch ${url}`);
}

/** With no history on the site: the live build's files, from its index.html and what that names, and so on. */
async function crawl(site) {
  const html = await get(site);
  if (!html) return {};
  const files = {};
  const todo = [...namedAssets(html.toString("utf8"))];
  while (todo.length) {
    const f = todo.pop();
    if (f in files) continue;
    const body = await get(site + f);
    if (!body) continue;
    files[f] = body.length;
    if (/\.(m?js|css)$/.test(f)) for (const g of namedAssets(body.toString("utf8"))) if (!(g in files)) todo.push(g);
  }
  return files;
}

async function main() {
  const arg = (name, dflt) => {
    const i = process.argv.indexOf(`--${name}`);
    return i > 0 ? process.argv[i + 1] : dflt;
  };
  let site = arg("site");
  if (!site) throw new Error("--site <url of the live site> is needed");
  if (!site.endsWith("/")) site += "/";
  const dist = arg("dist", "dist");
  const sha = arg("sha", process.env.GITHUB_SHA ?? "local");
  const current = listAssets(dist);
  const now = Date.now();

  let history = [];
  let live = null;
  try {
    // (A query of its own: never a copy cached in front of the site.)
    live = await get(`${site}${HISTORY}?t=${now}`);
  } catch (e) {
    // (The site unreachable: not the same as no list there. Nothing kept this time, and no crawl.)
    console.warn(`(${HISTORY}: ${e.message}; keeping no old files this time)`);
    live = undefined;
  }
  if (live) {
    try {
      history = JSON.parse(live.toString("utf8")).deploys ?? [];
    } catch {
      console.warn(`(${HISTORY} on the site isn't JSON; starting it again)`);
    }
  } else if (live === null) {
    // The first deploy with this script: the live build, found by reading it.
    try {
      const files = await crawl(site);
      if (Object.keys(files).length) history = [{ sha: "live", at: new Date(now).toISOString(), files }];
      console.log(`no ${HISTORY} on the site: the live build names ${Object.keys(files).length} files`);
    } catch (e) {
      console.warn(`(reading the live build: ${e.message}; keeping no old files this time)`);
    }
  }

  const { keep, fetch: wanted, dropped } = plan(history, current, now);
  const gone = new Set();
  let got = 0;
  let bytes = 0;
  const queue = [...wanted];
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      for (let f; (f = queue.shift()); ) {
        const body = await get(site + f).catch(() => null);
        if (!body) {
          gone.add(f);
          continue;
        }
        mkdirSync(join(dist, f, ".."), { recursive: true });
        writeFileSync(join(dist, f), body);
        got++;
        bytes += body.length;
      }
    }),
  );
  for (const d of keep) for (const f of Object.keys(d.files)) if (gone.has(f)) delete d.files[f];
  const deploys = [{ sha, at: new Date(now).toISOString(), files: current }, ...keep];
  writeFileSync(join(dist, HISTORY), JSON.stringify({ deploys }));
  const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;
  console.log(
    `kept ${keep.length} old deploy(s) (${keep.map((d) => d.sha.slice(0, 7)).join(" ") || "none"}), dropped ${dropped.length}; ` +
      `fetched ${got} old file(s), ${mb(bytes)}` +
      (gone.size ? `; ${gone.size} no longer on the site` : "") +
      `; assets/ now ${mb(Object.values(listAssets(dist)).reduce((s, n) => s + n, 0))}`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main().catch((e) => {
    // Never fail a deploy for this: the new build goes out, only the old files are missing (as before this script).
    console.warn(`pages-keep-assets: ${e.message}; deploying the new build alone`);
    try {
      const dist = process.argv.includes("--dist") ? process.argv[process.argv.indexOf("--dist") + 1] : "dist";
      writeFileSync(join(dist, HISTORY), JSON.stringify({ deploys: [{ sha: process.env.GITHUB_SHA ?? "local", at: new Date().toISOString(), files: listAssets(dist) }] }));
    } catch {
      /* nothing more to do */
    }
  });
}
