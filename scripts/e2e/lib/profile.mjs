// Where an e2e suite's time goes: every Playwright call (evaluate, waitForFunction, goto, screenshot, clicks, mouse and
// touch input, CDP sends, new pages and contexts) timed and added up by the line of the suite's own script that made
// it, inclusive up the suite's own call chain. Printed at each group's end (that group's lines) and at exit (the run's).
//
//   NODE_OPTIONS=--import=./scripts/e2e/lib/profile.mjs E2E_ONLY=qa-slant-23-there npm run e2e:draw
//   (or E2E_PROFILE=1: the suites that import lib/groups.mjs load it themselves)
//
// Only the outermost Playwright call is counted (one that calls another isn't counted twice). Lines are "file:line
// (function)"; a helper's line (settled, boot) shows the total of every call through it. `E2E_PROFILE_TOP=n`: lines
// printed (default 25).
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ME = fileURLToPath(import.meta.url);
const TOP = Number(process.env.E2E_PROFILE_TOP ?? 25);
/** "file:line (fn)" → { ms, n, self } over the whole run, and since the last group mark. */
const total = new Map();
let window = new Map();
let depth = 0;
const T0 = Date.now();

function sites(stack) {
  const out = [];
  for (const l of String(stack).split("\n").slice(1)) {
    if (l.includes("node_modules") || l.includes(ME) || l.includes("node:")) continue;
    const m = /at (?:async )?(?:(\S+) \()?(?:file:\/\/)?([^()]+):(\d+):\d+\)?$/.exec(l.trim());
    if (!m) continue;
    const file = m[2].split("/").slice(-1)[0];
    if (file === "groups.mjs") continue;
    out.push(`${file}:${m[3]}${m[1] ? ` (${m[1]})` : ""}`);
  }
  return out;
}

function add(map, key, ms, self) {
  const e = map.get(key) ?? { ms: 0, n: 0, self: 0 };
  e.ms += ms;
  e.n++;
  if (self) e.self += ms;
  map.set(key, e);
}

function record(stack, ms, what) {
  const s = [...new Set(sites(stack))];
  s.forEach((k, i) => {
    add(total, k, ms, i === 0);
    add(window, k, ms, i === 0);
  });
  add(total, `  [${what}]`, ms, true);
  add(window, `  [${what}]`, ms, true);
}

function wrap(proto, names, label) {
  if (!proto || proto.__profiled) return;
  proto.__profiled = true;
  for (const name of names) {
    const fn = proto[name];
    if (typeof fn !== "function") continue;
    proto[name] = function (...args) {
      if (depth > 0) return fn.apply(this, args);
      const stack = new Error().stack;
      const t = performance.now();
      depth++;
      let r;
      try {
        r = fn.apply(this, args);
      } catch (e) {
        depth--;
        throw e;
      }
      depth--;
      if (!r || typeof r.then !== "function") return r;
      return r.finally(() => record(stack, performance.now() - t, `${label}.${name}`));
    };
  }
}

const PAGE = ["evaluate", "evaluateHandle", "waitForFunction", "waitForSelector", "waitForTimeout", "goto", "reload", "screenshot", "click", "tap", "dblclick", "fill", "press", "hover", "$", "$$", "$eval", "$$eval", "textContent", "innerText", "isVisible", "waitForLoadState", "setViewportSize", "dispatchEvent", "locator", "close"];
const patchPage = (page) => {
  const proto = Object.getPrototypeOf(page);
  wrap(proto, PAGE, "page");
  for (const [k, l] of [["mouse", "mouse"], ["touchscreen", "touch"], ["keyboard", "keyboard"]]) wrap(Object.getPrototypeOf(page[k]), ["move", "down", "up", "click", "wheel", "tap", "press", "type", "down", "insertText"], l);
  const lproto = Object.getPrototypeOf(page.locator("body"));
  wrap(lproto, ["click", "tap", "fill", "waitFor", "textContent", "isVisible", "boundingBox", "evaluate", "count", "press", "dispatchEvent", "screenshot", "innerText", "getAttribute", "hover", "scrollIntoViewIfNeeded", "check", "selectOption"], "locator");
  return page;
};
const patchContext = (ctx) => {
  const proto = Object.getPrototypeOf(ctx);
  if (!proto.__profiled) {
    wrap(proto, ["newPage", "close", "addInitScript"], "context");
    const ncdp = proto.newCDPSession;
    proto.newCDPSession = async function (...a) {
      const s = await ncdp.apply(this, a);
      wrap(Object.getPrototypeOf(s), ["send"], "cdp");
      return s;
    };
    const np = proto.newPage;
    proto.newPage = async function (...a) {
      return patchPage(await np.apply(this, a));
    };
  }
  return ctx;
};
const patchBrowser = (b) => {
  const proto = Object.getPrototypeOf(b);
  if (!proto.__profiledB) {
    proto.__profiledB = true;
    const nc = proto.newContext;
    proto.newContext = async function (...a) {
      const t = performance.now();
      const stack = new Error().stack;
      const c = patchContext(await nc.apply(this, a));
      record(stack, performance.now() - t, "browser.newContext");
      return c;
    };
    const np = proto.newPage;
    proto.newPage = async function (...a) {
      const t = performance.now();
      const stack = new Error().stack;
      const page = await np.apply(this, a);
      patchContext(page.context());
      record(stack, performance.now() - t, "browser.newPage");
      return patchPage(page);
    };
  }
  return b;
};

for (const mod of ["playwright-core", "playwright"]) {
  let pw;
  try {
    pw = require(mod);
  } catch {
    continue;
  }
  const launch = pw.chromium.launch.bind(pw.chromium);
  pw.chromium.launch = async (...a) => patchBrowser(await launch(...a));
}

function print(map, title) {
  const rows = [...map.entries()].sort((a, b) => b[1].ms - a[1].ms).slice(0, TOP);
  console.log(`\n── profile: ${title} ──  (inclusive s, self s, calls)`);
  for (const [k, e] of rows) console.log(`${(e.ms / 1000).toFixed(1).padStart(8)} ${(e.self / 1000).toFixed(1).padStart(7)} ${String(e.n).padStart(6)}  ${k}`);
}

/** Print what the lines since the last mark took (a group's), and start again. */
export function profileMark(title) {
  print(window, title);
  window = new Map();
}
globalThis.__e2eProfileMark = profileMark;

process.on("exit", () => print(total, `the run (${((Date.now() - T0) / 1000).toFixed(0)} s)`));
