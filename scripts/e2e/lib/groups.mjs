// Named groups for the end-to-end suites: run them in order, alone (E2E_ONLY), a slice (E2E_SHARD), list them
// (--list), and resume a run that was killed or timed out (a checkpoint per passed group, keyed by the source tree).
// See docs/agents/e2e.md.
//
//   const suite = groups("touch", { check, results, errors });
//   suite.add("map-taps", async () => { … });
//   suite.add("lift", async () => { … }, { extra: true, about: "…" });   // not in a full run: only when named
//   …
//   await suite.run();            // runs what's selected and not already passed for this source tree
//   … the suite's own last checks (e.g. "no page errors") …
//   suite.finish();               // prints "N/N passed" (cached checks counted) and exits
//
// Env and flags (each suite reads them through this helper, the same way):
//   --list                 print the suite's groups, one a line, and exit
//   E2E_ONLY=a,b           run only these groups (in the suite's order); unknown names fail the run. A group added
//                          with { extra: true } runs only when named here
//   E2E_SHARD=i/n          run only the i-th of n slices of the groups (1-based, round-robin by position)
//   E2E_RESUME=0           ignore the checkpoints (run everything selected); default: on
//   E2E_FRESH=1            each group on a fresh page (suites that support it: see `fresh` in the suite)
//
// A group passes when every check it made passed and the page threw nothing while it ran. A passed group is written to
// .e2e-cache/<suite>/<key>.json at once, so a run killed after it doesn't lose it. The key is a hash of the source tree
// (git's index plus what's changed or new in the working tree), so any change to the code runs everything again.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const CACHE = join(ROOT, ".e2e-cache");

// Paths that can't change what a suite does: left out of the key, so editing a doc doesn't throw the checkpoints away.
const IGNORED = /^(docs\/|.*\.md$|\.e2e-cache\/|e2e-out\/)/;

let memoKey = null;
/** A hash of the source tree as it is now: every tracked file's content, changed or not, and every new one. */
export function sourceKey() {
  if (memoKey) return memoKey;
  const git = (...a) => execFileSync("git", a, { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 28 });
  const h = createHash("sha256");
  try {
    // (Index blob ids: cheap. Then the content of what differs from the index, and of new files.)
    for (const line of git("ls-files", "-s").split("\n")) {
      const path = line.split("\t")[1];
      if (path && !IGNORED.test(path)) h.update(line + "\n");
    }
    const changed = new Set([...git("diff", "--name-only").split("\n"), ...git("ls-files", "-o", "--exclude-standard").split("\n")]);
    for (const path of [...changed].filter((p) => p && !IGNORED.test(p)).sort()) {
      h.update(`\0${path}\0`);
      const file = join(ROOT, path);
      h.update(existsSync(file) ? readFileSync(file) : "(deleted)");
    }
  } catch (e) {
    // (Not a git checkout: no key, so nothing is ever skipped.)
    return (memoKey = `nogit-${Date.now()}`);
  }
  return (memoKey = h.digest("hex").slice(0, 16));
}

/** Where in the suite's own script an error was thrown (" at roads.mjs:612"), from its stack: or "". */
function where(e) {
  const script = process.argv[1] ?? "";
  const line = String(e?.stack ?? "").split("\n").find((l) => script && l.includes(script));
  const m = line && /:(\d+):\d+\)?$/.exec(line);
  return m ? ` (at ${script.split("/").at(-1)}:${m[1]})` : "";
}

const envList = (v) => (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);

/**
 * A suite's groups. `check` is the suite's own check function and `results` the array it pushes { name, ok } to; the
 * helper reads it to see what each group checked. `errors` (optional) is the suite's array of page errors: a group
 * during which one was thrown isn't recorded as passed.
 */
export function groups(suite, { results, errors = [], check }) {
  const list = [];
  const argv = process.argv.slice(2);
  const resume = process.env.E2E_RESUME !== "0" && !argv.includes("--fresh-run");
  const key = sourceKey();
  const file = join(CACHE, suite, `${key}.json`);
  let state = { suite, key, groups: {} };
  if (resume && existsSync(file)) {
    try {
      state = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      /* a half-written file: start over */
    }
  }
  const save = () => {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file + ".tmp", JSON.stringify(state, null, 1));
    renameSync(file + ".tmp", file);
  };
  let cachedChecks = 0;
  const started = Date.now();
  const api = {
    suite,
    key,
    /**
     * Add a group. `fn` runs it; its checks are whatever `check` calls it makes. `opts.about`: a line for `--list`;
     * `opts.extra`: not part of a full run, only run when E2E_ONLY names it.
     */
    add(name, fn, opts = {}) {
      if (list.some((g) => g.name === name)) throw new Error(`${suite}: group ${name} twice`);
      list.push({ name, fn, ...opts });
      return api;
    },
    names: () => list.map((g) => g.name),
    /** The groups this run will look at (E2E_ONLY, E2E_SHARD), in order; cached or not. */
    selected() {
      const only = envList(process.env.E2E_ONLY);
      let sel = only.length ? list : list.filter((g) => !g.extra);
      if (only.length) {
        const unknown = only.filter((n) => !list.some((g) => g.name === n));
        if (unknown.length) {
          console.error(`${suite}: no group ${unknown.join(", ")}. Groups: ${list.map((g) => g.name).join(" ")}`);
          process.exit(2);
        }
        sel = sel.filter((g) => only.includes(g.name));
      }
      const shard = /^(\d+)\/(\d+)$/.exec(process.env.E2E_SHARD ?? "");
      if (shard) {
        const [i, n] = [Number(shard[1]), Number(shard[2])];
        sel = sel.filter((_, k) => k % n === i - 1);
      }
      return sel;
    },
    /** Whether a group will actually run (selected, not cached): for fixtures that only some groups need. */
    willRun(name) {
      return api.selected().some((g) => g.name === name) && !(resume && state.groups[name]);
    },
    /** Groups this run will run (selected and not cached), e.g. to skip opening a page none of them needs. */
    pending: () => api.selected().filter((g) => !(resume && state.groups[g.name])),
    /**
     * Run the selected groups in order. `around(group, run)` (optional) wraps each one: set up a page, tidy after.
     * A group that throws fails "<name>: ran to the end" and the run goes on.
     */
    async run(around = (g, go) => go()) {
      if (argv.includes("--list")) {
        for (const g of list) console.log(g.name + (g.extra ? "\t(only when named) " : g.about ? "\t" : "") + (g.about ?? ""));
        process.exit(0);
      }
      const sel = api.selected();
      const cachedNames = sel.filter((g) => resume && state.groups[g.name]).map((g) => g.name);
      if (cachedNames.length) console.log(`(${suite}: ${cachedNames.length} of ${sel.length} groups already passed for source ${key}; E2E_RESUME=0 runs them again)`);
      for (const g of sel) {
        const prior = resume && state.groups[g.name];
        if (prior) {
          cachedChecks += prior.checks;
          console.log(`group ${g.name}: cached pass (${prior.checks} checks, ${prior.seconds}s on ${prior.at})`);
          continue;
        }
        console.log(`group ${g.name}: …`);
        const r0 = results.length;
        const e0 = errors.length;
        const t0 = Date.now();
        try {
          await around(g, () => g.fn());
        } catch (e) {
          check(`${g.name}: ran to the end`, false, String(e?.message ?? e).split("\n")[0] + where(e));
        }
        const mine = results.slice(r0);
        const seconds = Math.round((Date.now() - t0) / 1000);
        const ok = mine.every((r) => r.ok) && errors.length === e0;
        console.log(`group ${g.name}: ${ok ? "pass" : "FAIL"} (${mine.length} checks, ${seconds}s)${errors.length > e0 ? ` — page errors: ${errors.slice(e0).join(" | ")}` : ""}`);
        if (ok && mine.length) {
          state.groups[g.name] = { checks: mine.length, seconds, at: new Date().toISOString() };
          save();
        }
      }
    },
    /** Print "N/N passed" with the cached groups' checks counted, and exit (1 if any check failed). */
    finish() {
      const failed = results.filter((r) => !r.ok).length;
      const total = results.length + cachedChecks;
      const mins = ((Date.now() - started) / 60000).toFixed(1);
      console.log(`\n(${suite}: ${results.length} checks run, ${cachedChecks} cached, ${mins} min)`);
      console.log(`${total - failed}/${total} passed`);
      process.exit(failed ? 1 : 0);
    },
  };
  return api;
}
