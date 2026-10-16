// Build the game for publishing as a claude.ai Artifact (`npm run build:artifact`). See docs/artifact-builds.md.
//
// Artifacts serve only standard web file types, and .glb isn't one. The game only ever fetches its models as raw
// bytes, so they're published as `<set>.glb.wasm` (a served type), and the built loader is pointed at those names.
// The repo's source is unchanged: this only rewrites the build output.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const OUT = "dist-artifact";
rmSync(OUT, { recursive: true, force: true });
// Relative base: the page is served from the artifact's own path, not a domain root.
// No update check: an artifact is republished by hand, so the build turns the check off and drops version.json.
execFileSync("npx", ["vite", "build", "--base=./", "--outDir", OUT, "--emptyOutDir"], { stdio: "inherit", env: { ...process.env, WOODRAIL_NO_UPDATE_CHECK: "1" } });
rmSync(join(OUT, "version.json"), { force: true });

const files = (dir) => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : [join(dir, f)]));

// Models: rename, and point the built loader at the new names.
let renamed = 0;
for (const f of files(join(OUT, "models")).filter((f) => f.endsWith(".glb"))) {
  renameSync(f, `${f}.wasm`);
  renamed++;
}
let patched = 0;
for (const f of files(join(OUT, "assets")).filter((f) => f.endsWith(".js"))) {
  const src = readFileSync(f, "utf8");
  // The loader's URL template, `${BASE}models/${set}.glb` (minified: models/${e}.glb`).
  const out = src.replace(/(models\/\$\{\w+\}\.glb)`/g, "$1.wasm`");
  if (out !== src) {
    writeFileSync(f, out);
    patched++;
  }
}
if (renamed === 0 || patched === 0) {
  console.error(`artifact build: expected to rename models and patch their loader (renamed ${renamed}, patched ${patched} files)`);
  process.exit(1);
}

// What to publish: the page, and every other file at its path next to it (the Artifact tool's `files` map).
const map = {};
for (const f of files(OUT)) {
  const rel = relative(OUT, f).split("\\").join("/");
  if (rel !== "index.html" && rel !== "files.json") map[rel] = f;
}
writeFileSync(join(OUT, "files.json"), JSON.stringify(map, null, 2) + "\n");
const bytes = files(OUT).reduce((n, f) => n + statSync(f).size, 0);
console.log(`\nartifact build: ${OUT}/index.html plus ${Object.keys(map).length} files (${(bytes / 1e6).toFixed(1)} MB); ${renamed} models renamed to .glb.wasm.`);
console.log(`Publish ${OUT}/index.html with \`files\` = ${OUT}/files.json (see docs/artifact-builds.md).`);
