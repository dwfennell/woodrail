// Woodrail's play stats (docs/stats.md), read from Workers Analytics Engine with its SQL API: `npm run stats [-- days]`
// in cloud/. Needs CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN (a token with Account Analytics: Read).
const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;
const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
if (!ACCOUNT || !TOKEN) {
  console.error("Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN (Account Analytics: Read). See docs/stats.md.");
  process.exit(1);
}
const DAYS = Number(process.argv[2] ?? 30);
const SINCE = `timestamp > NOW() - INTERVAL '${DAYS}' DAY`;

async function sql(query) {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/analytics_engine/sql`, { method: "POST", headers: { Authorization: `Bearer ${TOKEN}` }, body: query });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return (await res.json()).data;
}

const REPORTS = [
  ["Players a day (sharing stats)", `SELECT toStartOfDay(timestamp) AS day, COUNT(DISTINCT index1) AS players, SUM(_sample_interval) AS sessions FROM woodrail_stats WHERE blob1 = 'start' AND ${SINCE} GROUP BY day ORDER BY day`],
  ["Where and on what", `SELECT blob5 AS host, blob6 AS device, COUNT(DISTINCT index1) AS players FROM woodrail_stats WHERE blob1 = 'start' AND ${SINCE} GROUP BY host, device ORDER BY players DESC`],
  ["Modes", `SELECT blob2 AS mode, COUNT(DISTINCT index1) AS players, SUM(_sample_interval * double2) AS new_games FROM woodrail_stats WHERE blob1 = 'start' AND ${SINCE} GROUP BY mode`],
  ["Minutes played", `SELECT blob2 AS mode, SUM(_sample_interval * double1) AS minutes, COUNT(DISTINCT index1) AS players FROM woodrail_stats WHERE blob1 = 'end' AND ${SINCE} GROUP BY mode`],
  ["Goals: how many players reach each", `SELECT blob3 AS goal, COUNT(DISTINCT index1) AS players FROM woodrail_stats WHERE blob1 = 'goal' AND ${SINCE} GROUP BY goal ORDER BY players DESC`],
  ["Errors", `SELECT blob3 AS error, SUM(_sample_interval) AS times, COUNT(DISTINCT index1) AS players FROM woodrail_stats WHERE blob1 = 'error' AND ${SINCE} GROUP BY error ORDER BY times DESC LIMIT 20`],
  ["Builds", `SELECT blob4 AS build, COUNT(DISTINCT index1) AS players FROM woodrail_stats WHERE blob1 = 'start' AND ${SINCE} GROUP BY build ORDER BY players DESC LIMIT 10`],
];

console.log(`Woodrail play stats, last ${DAYS} days (players who chose to share)\n`);
for (const [title, query] of REPORTS) {
  console.log(`## ${title}`);
  try {
    const rows = await sql(query);
    if (rows.length === 0) console.log("(none)");
    else console.table(rows);
  } catch (e) {
    console.log(`(couldn't read: ${e.message})`);
  }
  console.log();
}
