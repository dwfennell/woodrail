# Play stats ("Help improve Woodrail")

Anonymous play stats, opt-in. They answer how many people play, on what, where, for how long, how far they get
through the goals, and what errors they hit.

## What the player sees

- After their first goal in Game mode (or 10 minutes into Sandbox, which has no goals), once: a card, "Help improve
  Woodrail? Share anonymous play stats…", with **No thanks** and **Yes, share**.
- In the ☰ menu: **💛 Help improve Woodrail**, which shows the choice and changes it.
- Nothing leaves the device before a yes. Events from before the answer (this session's start, the goal that led to
  the question) wait in memory: sent on a yes, dropped on a no.
- The menu item and the question show only in a build with somewhere to send stats (below).

## What's sent

The game's side is `src/stats/stats.ts`; the Worker's is `cloud/src/stats.ts`.

| Event | When | Data |
| --- | --- | --- |
| `start` | a mode opened | mode, a new game or carried on |
| `goal` | a goal ticked (Game mode) | the goal's id, how many are done |
| `end` | a stretch of play over (back to the title, or the page hidden) | mode, minutes |
| `error` | an uncaught error (3 a session at most) | its message, cut to 200 characters |

Each batch also carries a random id made on the device on a yes (dropped on a no), the build, the host (`itch`,
`pages`, `local`, `other`) and the device (`phone`, `tablet`, `desktop`). No railways, town names, sync codes or IP
addresses are stored.

Events go up in one small POST a minute after the first, or as a beacon when the page hides. An idle game sends
nothing.

## Where it goes

`POST /v1/stats` on the cloud Worker (`cloud/`), from any page (it's write-only and anonymous; itch serves every game
from one shared origin). Each event is a data point in Workers Analytics Engine, dataset `woodrail_stats` (binding
`STATS` in `cloud/wrangler.toml`): free within Cloudflare's limits, kept 3 months.

| Column | Holds |
| --- | --- |
| `index1` | the device's random id |
| `blob1` | event: `start`, `goal`, `end`, `error` |
| `blob2` | mode |
| `blob3` | the goal's id, or the error |
| `blob4` | build |
| `blob5` | host |
| `blob6` | device |
| `double1` | goals done (`goal`), minutes (`end`) |
| `double2` | 1 for a new game (`start`) |

The game sends to `VITE_STATS_URL`, or else `VITE_CLOUD_URL`. The GitHub Pages build has `VITE_CLOUD_URL` (the
`WOODRAIL_CLOUD_URL` repository variable). The itch build has no cloud saves, so its release workflow passes the same
variable as `VITE_STATS_URL`. The artifact build sends none. Neither set (the Worker not deployed yet): no stats, and
nothing is asked.

## Reading them

```sh
cd cloud
export CLOUDFLARE_ACCOUNT_ID=…  CLOUDFLARE_API_TOKEN=…   # a token with Account Analytics: Read
npm run stats             # the last 30 days
npm run stats -- 7        # the last 7
```

It prints players a day, hosts and devices, modes, minutes played, how many players reach each goal, errors and
builds. Any other question is a SQL query to the same API (`cloud/stats-report.mjs` has the pattern). Analytics Engine
samples at high volume: weight counts with `_sample_interval`, as the report does.

itch.io's own analytics (views, browser plays, referrers) count everyone who opens the page, sharing or not.

## Tests

- `npm test` (`src/stats/stats.test.ts`): consent, batching, caps.
- `npm --prefix cloud test` (`cloud/test/stats.test.ts`): the endpoint, its checks, and that saves' CORS is unchanged.
- `npm run e2e:stats`: on a phone, the first goal, the question, a yes, the batch the Worker reads (a `goal` point
  for join-two), the menu's Stop sharing, and no question after a reload.
