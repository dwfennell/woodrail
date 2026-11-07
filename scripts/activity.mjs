#!/usr/bin/env node
/**
 * The "Woodrail Activity" dashboard's numbers (docs/activity.md): play stats from Analytics Engine, the Worker's
 * feedback and railway snapshots, and GitHub's releases and issues, as JSON files of rows in `activity-out/`. Only
 * totals: no device ids, no maps. itch.io's own numbers are read from its dashboard by hand (`activity-out/itch-*.json`).
 *
 *   op run --env-file scripts/activity.env -- node scripts/activity.mjs [days]
 *
 * Needs CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN (Account Analytics: Read) and ADMIN_KEY in the environment
 * (`op run` puts them there from 1Password, never on screen), and `gh` signed in.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const DAYS = Number(process.argv[2] ?? 90);
const OUT = "activity-out";
const CLOUD = (process.env.WOODRAIL_CLOUD_URL ?? "https://woodrail-cloud.jankfighter.workers.dev").replace(/\/$/, "");
const { CLOUDFLARE_ACCOUNT_ID: ACCOUNT, CLOUDFLARE_API_TOKEN: TOKEN, ADMIN_KEY } = process.env;
if (!ACCOUNT || !TOKEN || !ADMIN_KEY) {
  console.error("Needs CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN and ADMIN_KEY: run it under `op run` (docs/activity.md)");
  process.exit(2);
}
mkdirSync(OUT, { recursive: true });
// (`local`: the dev server, our own play.)
const SINCE = `timestamp > NOW() - INTERVAL '${DAYS}' DAY AND blob5 != 'local'`;

async function sql(query) {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/analytics_engine/sql`, { method: "POST", headers: { Authorization: `Bearer ${TOKEN}` }, body: `${query} FORMAT JSON` });
  if (!res.ok) throw new Error(`Analytics Engine ${res.status}: ${await res.text()}`);
  return (await res.json()).data;
}
async function admin(path) {
  const res = await fetch(`${CLOUD}${path}`, { headers: { Authorization: `Bearer ${ADMIN_KEY}` } });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}
const gh = (args) => JSON.parse(execFileSync("gh", args, { encoding: "utf8" }));
const day = (iso) => String(iso).slice(0, 10);
const num = (rows, ...keys) => rows.map((r) => ({ ...r, ...Object.fromEntries(keys.map((k) => [k, Number(r[k])])) }));
const write = (name, rows) => {
  writeFileSync(`${OUT}/${name}.json`, JSON.stringify(rows, null, 1) + "\n");
  console.log(`${name}: ${rows.length} rows`);
};

// Play stats (docs/stats.md): players who chose to share.
const players = num(await sql(`SELECT formatDateTime(toStartOfDay(timestamp), '%Y-%m-%d') AS day, COUNT(DISTINCT index1) AS players, SUM(_sample_interval) AS sessions, SUM(_sample_interval * double2) AS new_games FROM woodrail_stats WHERE blob1 = 'start' AND ${SINCE} GROUP BY day ORDER BY day`), "players", "sessions", "new_games");
const minutes = num(await sql(`SELECT formatDateTime(toStartOfDay(timestamp), '%Y-%m-%d') AS day, ROUND(SUM(_sample_interval * double1)) AS minutes FROM woodrail_stats WHERE blob1 = 'end' AND ${SINCE} GROUP BY day ORDER BY day`), "minutes");
const [totals] = num(await sql(`SELECT COUNT(DISTINCT index1) AS players, SUM(_sample_interval) AS sessions FROM woodrail_stats WHERE blob1 = 'start' AND ${SINCE}`), "players", "sessions");
const [errors] = num(await sql(`SELECT SUM(_sample_interval) AS times FROM woodrail_stats WHERE blob1 = 'error' AND ${SINCE}`), "times");
const [played] = num(await sql(`SELECT ROUND(SUM(_sample_interval * double1)) AS minutes FROM woodrail_stats WHERE blob1 = 'end' AND ${SINCE}`), "minutes");
write("goals", num(await sql(`SELECT blob3 AS goal, COUNT(DISTINCT index1) AS players FROM woodrail_stats WHERE blob1 = 'goal' AND ${SINCE} GROUP BY goal ORDER BY players DESC`), "players"));

// Feedback and railway snapshots, from the Worker (newest first; its lists hold the latest 100).
const feedback = (await admin("/feedback")).map((r) => ({ day: day(r.at), kind: r.kind, title: r.title, issue: r.issue || "" }));
write("feedback", feedback);
const snapshots = await admin("/v1/snapshots");

// GitHub: releases (the itch versions) and open issues.
write("releases", gh(["release", "list", "--limit", "30", "--json", "tagName,publishedAt"]).map((r) => ({ version: r.tagName, day: day(r.publishedAt) })));
const issues = gh(["issue", "list", "--state", "open", "--limit", "100", "--json", "number"]);

// itch.io, read from its analytics page by hand (docs/activity.md): `itch-daily.json`, `itch-totals.json`.
const read = (name, none) => (existsSync(`${OUT}/${name}.json`) ? JSON.parse(readFileSync(`${OUT}/${name}.json`, "utf8")) : none);
const itchDaily = read("itch-daily", []);
const [itch] = read("itch-totals", [{}]);

// One row a day, every source side by side.
const days = [...new Set([...players, ...minutes, ...itchDaily].map((r) => r.day))].sort();
const on = (rows, d, key) => rows.find((r) => r.day === d)?.[key] ?? 0;
write("daily", days.map((d) => ({ day: d, players: on(players, d, "players"), sessions: on(players, d, "sessions"), new_games: on(players, d, "new_games"), minutes: on(minutes, d, "minutes"), itch_views: on(itchDaily, d, "views"), itch_plays: on(itchDaily, d, "plays"), feedback: feedback.filter((f) => f.day === d).length, snapshots: snapshots.filter((s) => day(s.at) === d).length })));
write("summary", [{ as_of: new Date().toISOString().slice(0, 10), days: DAYS, players: totals?.players ?? 0, sessions: totals?.sessions ?? 0, minutes: played?.minutes ?? 0, errors: errors?.times ?? 0, snapshots: snapshots.length, snapshot_players: new Set(snapshots.map((s) => s.id)).size, feedback: feedback.length, open_issues: issues.length, itch_as_of: itch.as_of ?? "", itch_window: itch.window ?? "", itch_views: itch.views ?? 0, itch_plays: itch.browser_plays ?? 0, itch_collections: itch.collections ?? 0, itch_ratings: itch.ratings ?? 0, itch_impressions_7d: itch.impressions_7d ?? 0, itch_ctr_7d: itch.ctr_7d ?? 0 }]);
