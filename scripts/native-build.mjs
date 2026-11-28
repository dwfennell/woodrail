// Build the game for the Android and iOS apps (`npm run build:native`), then copy it into their projects
// (`npx cap sync`). See docs/native-builds.md.
//
// Like the itch build: relative paths, no update check and no version.json (the store updates the app), no cloud
// saves (every Capacitor app's page is on the same origin, capacitor://localhost or https://localhost, so the Worker
// can't tell ours from another's). Play stats, crash reports and feedback go to the Worker at VITE_STATS_URL, or else
// the repo's WOODRAIL_CLOUD_URL variable (`gh variable get`, as the itch release's workflow sets it): the apps are built
// here, not by a workflow. Neither: a build that sends nothing, said loudly.
// The page starts from src/native/entry.ts, and its fonts come with it (vite.config.ts, `nativePage`).
//
// `-- --no-sync`: build dist-native/ only.
import { execFileSync, spawnSync } from "node:child_process";
import { readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

const OUT = "dist-native";
let statsUrl = (process.env.VITE_STATS_URL ?? "").trim();
if (!statsUrl) {
  const gh = spawnSync("gh", ["variable", "get", "WOODRAIL_CLOUD_URL"], { encoding: "utf8" });
  statsUrl = gh.status === 0 ? gh.stdout.trim() : "";
}
if (!statsUrl) console.warn("\nnative build: NO play stats, crash reports or feedback (no VITE_STATS_URL, and `gh variable get WOODRAIL_CLOUD_URL` gave none)\n");
rmSync(OUT, { recursive: true, force: true });
execFileSync("npx", ["tsc", "--noEmit"], { stdio: "inherit" });
execFileSync("npx", ["vite", "build", "--base=./", "--outDir", OUT, "--emptyOutDir"], {
  stdio: "inherit",
  env: { ...process.env, WOODRAIL_NATIVE: "1", WOODRAIL_NO_UPDATE_CHECK: "1", VITE_CLOUD_URL: "", VITE_STATS_URL: statsUrl },
});
rmSync(join(OUT, "version.json"), { force: true });

const files = (dir) => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : [join(dir, f)]));
const all = files(OUT);
const html = readFileSync(join(OUT, "index.html"), "utf8");
if (!all.some((f) => f.endsWith(".glb")) || html.includes("fonts.googleapis.com") || !all.some((f) => /nunito.*\.woff2$/.test(f))) {
  console.error("native build: expected the .glb models and the bundled fonts, and no Google Fonts link");
  process.exit(1);
}
const bytes = all.reduce((n, f) => n + statSync(f).size, 0);
console.log(`\nnative build: ${OUT}/ (${all.length} files, ${(bytes / 1e6).toFixed(1)} MB).`);

if (!process.argv.includes("--no-sync")) execFileSync("npx", ["cap", "sync"], { stdio: "inherit" });
