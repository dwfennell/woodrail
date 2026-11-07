# Play stats ("Help improve Woodrail")

Anonymous play stats, opt-in. They answer how many people play, on what, where, for how long, how far they get
through the goals, and what errors they hit. The same yes shares railway snapshots: now and then a copy of the
player's railway, to see what people build (below).

## What the player sees

- After their first goal in Game mode (or 10 minutes into Sandbox, which has no goals), once: a card, "Help improve
  Woodrail? Share anonymous play stats (…) and now and then a copy of your railway…", with **No thanks** and **Yes,
  share**.
- A player who said yes before the question mentioned railways (`woodrail.stats` is `yes`, `woodrail.stats.maps`
  unset) is asked once more, at their next goal: "Can we also have a copy of your railway now and then?", with **Just
  stats** and **Yes, share it**. Until they answer, no snapshots.
- In the ☰ menu: **💛 Help improve Woodrail**, which shows the choice and changes it: **Stop sharing** (both), or while
  sharing, **Not my railway** / **Share my railway too**.
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
`pages`, `local`, `other`) and the device (`phone`, `tablet`, `desktop`). No railways (those are snapshots, below), town names, sync codes or IP
addresses are stored.

Events go up in one small POST a minute after the first, or as a beacon when the page hides. An idle game sends
nothing.

## Railway snapshots

The game's side is `src/stats/snapshots.ts`; the Worker's is `cloud/src/snapshots.ts`.

- **Game mode only**, and only once **Join two towns** and **Put an engine on the track** are both done: someone who
  opens the game and doesn't play sends none.
- Then one as each goal ticks (the first as the engine goes on), and one a minute into a stretch of building, at most
  every 15 minutes. 20 a device in all (`woodrail.stats.maps.sent`); the Worker keeps 30 a device at most. Nothing on
  a timer of its own: an idle game sends nothing.
- What's sent: the "Copy map for a bug report" text (Game mode's save: the railway, its session, goals, stickers and
  progress; gzipped), the goals done, why (`goal:<id>` or `building`), the stats' device id, build, host and device.
  The save holds the town names the game gave them, never the player's.
- `POST /v1/snapshots`, from the game's own pages (feedback's origin check: itch, the GitHub site, claude.ai, local),
  a few a minute per IP. Stored in R2 (`snapshots/<id>/…`), so they work on itch too, which has no cloud saves.
- **Reading them** (admin only, `ADMIN_KEY`; see `cloud/README.md`):

  ```sh
  export WOODRAIL_CLOUD_URL=https://woodrail-cloud.<subdomain>.workers.dev ADMIN_KEY=…
  npm run snapshots                      # the latest 100, across devices
  npm run snapshots -- <device id>       # one device's, oldest first, each a file
  npm run replay -- snapshots-<id>/01-goal-place-train.txt
  ```

  Or load one in a dev server with `#load=<the text>` (`src/persist/bug-map.ts`). The device id is the stats' one, so
  a device's snapshots line up with its goals and minutes in Analytics Engine (`index1`).

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

- `npm test` (`src/stats/stats.test.ts`, `snapshots.test.ts`): consent (and the second question), batching, caps;
  snapshots' gate, building and cap.
- `npm --prefix cloud test` (`cloud/test/stats.test.ts`, `snapshots.test.ts`): the endpoints, their checks, the admin
  reads, the per-device cap, and that saves' CORS is unchanged.
- `npm run e2e:stats`: on a phone, the first goal, the question, a yes, the batch the Worker reads (a `goal` point
  for join-two), no snapshot yet; an engine dragged from the tray, and the snapshot the Worker's check takes, which
  reads back as the railway; the menu's Stop sharing, and no question after a reload.
