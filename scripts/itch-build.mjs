// Build the game for itch.io (`npm run build:itch`). See docs/itch-builds.md.
//
// itch serves an HTML game from a hashed path in an iframe on html-classic.itch.zone, so the build uses relative paths.
// A new itch build only goes up when a release is published, so there's no update check and no version.json.
// Cloud saves are off: the Worker's CORS check would have to let in itch.zone, an origin every itch game shares.
// Play stats (docs/stats.md) go to VITE_STATS_URL if it's set (the release workflow sets it).
// Models stay .glb (itch serves any file type), so unlike the artifact build nothing is renamed.
import { execFileSync } from "node:child_process";
import { readdirSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const OUT = "dist-itch";
const ZIP = "woodrail-itch.zip";
rmSync(OUT, { recursive: true, force: true });
rmSync(ZIP, { force: true });
execFileSync("npx", ["tsc", "--noEmit"], { stdio: "inherit" });
execFileSync("npx", ["vite", "build", "--base=./", "--outDir", OUT, "--emptyOutDir"], {
  stdio: "inherit",
  env: { ...process.env, WOODRAIL_NO_UPDATE_CHECK: "1", VITE_CLOUD_URL: "" },
});
rmSync(join(OUT, "version.json"), { force: true });

const files = (dir) => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : [join(dir, f)]));
const all = files(OUT);
if (!all.includes(join(OUT, "index.html")) || !all.some((f) => f.endsWith(".glb"))) {
  console.error("itch build: expected index.html and the .glb models in the output");
  process.exit(1);
}
const bytes = all.reduce((n, f) => n + statSync(f).size, 0);
console.log(`\nitch build: ${OUT}/ (${all.length} files, ${(bytes / 1e6).toFixed(1)} MB).`);

// The zip is for uploading by hand on itch's project page; butler (the release workflow) pushes the folder itself.
try {
  execFileSync("zip", ["-qr", resolve(ZIP), "."], { cwd: OUT, stdio: "inherit" });
  console.log(`Zipped to ${ZIP}, with index.html at its root.`);
} catch {
  console.log(`(No \`zip\` command here: zip the contents of ${OUT}/, not the folder, to upload by hand.)`);
}
