// The first download: the entry script and every chunk it imports statically (what a first visit fetches before the
// game's code can run), against what's loaded later (dynamic imports, workers). Used by run.mjs (`bundle.firstJsKB`).
//
//   node tools/perf/first-download.mjs [<dist dir>]
import { readFileSync, readdirSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** The first download's script files (relative to `dist`), from index.html's entry through its static imports. */
export function firstDownload(dist) {
  const html = readFileSync(join(dist, "index.html"), "utf8");
  const entry = html.match(/<script[^>]+type="module"[^>]+src="\/?([^"]+\.js)"/)?.[1] ?? html.match(/src="\.?\/?(assets\/index-[^"]+\.js)"/)?.[1];
  const seen = new Set();
  const walk = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    const src = readFileSync(join(dist, file), "utf8");
    // Static imports only: `import … from "./x.js"`, `import "./x.js"`, `export … from "./x.js"` (not `import(…)`).
    for (const m of src.matchAll(/(?:^|[;\n}])\s*(?:import|export)\s*(?:[\w*{}\s,$]+from\s*)?["'](\.\/[^"']+\.js)["']/g)) walk(join("assets", m[1].slice(2)));
  };
  if (entry) walk(entry.replace(/^\.\//, ""));
  return [...seen];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dist = process.argv[2] ?? "dist";
  const kb = (files) => {
    let raw = 0;
    let gz = 0;
    for (const f of files) {
      const b = readFileSync(join(dist, f));
      raw += b.length;
      gz += gzipSync(b).length;
    }
    return `${Math.round(raw / 1024)} KB (${Math.round(gz / 1024)} KB gzipped)`;
  };
  const first = firstDownload(dist);
  const later = readdirSync(join(dist, "assets"))
    .filter((f) => f.endsWith(".js"))
    .map((f) => join("assets", f))
    .filter((f) => !first.includes(f));
  console.log(`first download: ${kb(first)}: ${first.map((f) => f.replace("assets/", "")).join(", ")}`);
  console.log(`later: ${kb(later)}: ${later.map((f) => f.replace("assets/", "")).join(", ")}`);
}
