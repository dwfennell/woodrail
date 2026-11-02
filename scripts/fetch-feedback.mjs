#!/usr/bin/env node
/**
 * Fetch a feedback report's map ("Report a bug or give feedback": cloud/src/feedback.ts) into a bug-map file for
 * `npm run replay` (src/play/bugmap.ts), with its note and device beside it.
 *
 *   node scripts/fetch-feedback.mjs <id or its map link> [--out <file>] [--url <worker>]
 *   node scripts/fetch-feedback.mjs --list [--url <worker>]          (needs ADMIN_KEY in the environment)
 *
 * The Worker is `--url`, else WOODRAIL_CLOUD_URL. A link from an issue (`https://…/feedback/<id>/map`) carries its own.
 * Writes `<out>` (default `feedback-<id>.txt`, the map: `npm run replay -- <out>`) and `<out>.json` (the report).
 */
import { writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
};
const positional = args.filter((a, i) => !a.startsWith("--") && !["--out", "--url"].includes(args[i - 1]));
const ID = /\d{8}T\d{6}-[0-9a-f]{32}/;

let base = opt("url") ?? process.env.WOODRAIL_CLOUD_URL ?? "";
let id = positional[0] ?? "";
const link = /^(https?:\/\/[^/]+)\/feedback\/([^/]+)/.exec(id);
if (link) [, base, id] = [null, opt("url") ?? link[1], link[2]];
base = base.replace(/\/$/, "");

async function get(path, headers = {}) {
  const res = await fetch(`${base}${path}`, { headers });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return res;
}

if (!base) {
  console.error("No Worker: pass --url https://woodrail-cloud.<subdomain>.workers.dev, or set WOODRAIL_CLOUD_URL, or give a map link");
  process.exit(2);
}

if (args.includes("--list")) {
  if (!process.env.ADMIN_KEY) {
    console.error("--list needs ADMIN_KEY in the environment (the Worker's admin key)");
    process.exit(2);
  }
  const list = await (await get("/feedback", { Authorization: `Bearer ${process.env.ADMIN_KEY}` })).json();
  for (const r of list) console.log(`${r.id}  ${r.title}${r.issue ? `  ${r.issue}` : ""}`);
  process.exit(0);
}

if (!ID.test(id)) {
  console.error("usage: node scripts/fetch-feedback.mjs <report id or https://…/feedback/<id>/map> [--out <file>] [--url <worker>]");
  process.exit(2);
}
const report = await (await get(`/feedback/${id}`)).json();
const out = opt("out") ?? `feedback-${id}.txt`;
writeFileSync(`${out}.json`, JSON.stringify(report, null, 2) + "\n");
console.log(`[${report.kind}] ${report.text.split("\n")[0]}`);
console.log(`${report.mode} · build ${report.build} · ${report.viewport.width}×${report.viewport.height} @${report.viewport.dpr}x · ${report.userAgent}`);
for (const b of report.badges ?? []) console.log(`  ${b}`);
if (!report.hasMap) {
  console.log(`No map with this report (an idea sent without it). Its report: ${out}.json`);
  process.exit(0);
}
const map = await (await get(`/feedback/${id}/map`)).text();
writeFileSync(out, map + "\n");
console.log(`\nMap: ${out}   (report: ${out}.json${report.hasShot ? `, picture: ${base}/feedback/${id}/shot.jpg` : ""})`);
console.log(`Replay it: npm run replay -- ${out}`);
