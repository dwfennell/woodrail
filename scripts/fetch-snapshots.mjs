#!/usr/bin/env node
/**
 * Railway snapshots from players who share them ("Help improve Woodrail": cloud/src/snapshots.ts, docs/stats.md), into
 * bug-map files for `npm run replay` or the dev-only `#load=`.
 *
 *   node scripts/fetch-snapshots.mjs [--url <worker>]                  the latest, across devices
 *   node scripts/fetch-snapshots.mjs <device id> [--out <dir>] [--url <worker>]   that device's, each into a file
 *
 * Needs ADMIN_KEY in the environment (the Worker's admin key). The Worker is `--url`, else WOODRAIL_CLOUD_URL.
 * A device's go to `<dir>` (default `snapshots-<id>/`), oldest first: `01-goal-place-train.txt`, …
 */
import { mkdirSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
};
const positional = args.filter((a, i) => !a.startsWith("--") && !["--out", "--url"].includes(args[i - 1]));
const base = (opt("url") ?? process.env.WOODRAIL_CLOUD_URL ?? "").replace(/\/$/, "");
if (!base) {
  console.error("No Worker: pass --url https://woodrail-cloud.<subdomain>.workers.dev, or set WOODRAIL_CLOUD_URL");
  process.exit(2);
}
if (!process.env.ADMIN_KEY) {
  console.error("Needs ADMIN_KEY in the environment (the Worker's admin key)");
  process.exit(2);
}
async function get(path) {
  const res = await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${process.env.ADMIN_KEY}` } });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return res;
}
const line = (s) => `${s.at}  ${s.id}  ${String(s.goals).padStart(2)} goals  ${s.why.padEnd(24)} ${s.host}/${s.device}  ${s.build}  ${Math.round(Number(s.bytes) / 1024)} KB`;

const id = positional[0];
if (!id) {
  for (const s of await (await get("/v1/snapshots")).json()) console.log(line(s));
  process.exit(0);
}
if (!/^[0-9a-f]{16}$/.test(id)) {
  console.error("usage: node scripts/fetch-snapshots.mjs [<device id: 16 hex digits>] [--out <dir>] [--url <worker>]");
  process.exit(2);
}
const list = (await (await get(`/v1/snapshots/${id}`)).json()).reverse();
const dir = opt("out") ?? `snapshots-${id}`;
mkdirSync(dir, { recursive: true });
for (const [i, s] of list.entries()) {
  const file = `${dir}/${String(i + 1).padStart(2, "0")}-${s.why.replace(/[^a-z0-9]+/gi, "-")}.txt`;
  writeFileSync(file, (await (await get(`/v1/snapshots/${id}/${s.key}`)).text()) + "\n");
  console.log(`${line(s)}  → ${file}`);
}
console.log(`\n${list.length} snapshots. Replay one: npm run replay -- <file>`);
