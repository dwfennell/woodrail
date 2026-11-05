// What happened to the pages and the dev server while a group ran: for a failure that says only "Resulting promise was
// garbage collected" or "Execution context was destroyed" (a page navigated, reloaded or crashed under a pending
// evaluate), the events that say which. groups.mjs prints the ones from a failed group's time; a suite can print them
// itself (`printEvents`) where it catches a failure of its own.
//
//   watchServer(server)    the dev server's full reloads and dependency re-optimizing (a reload of every open page)
//   watchBrowser(browser)  every page it opens from now on: crash, close, main-frame navigation, console errors,
//                          failed requests and HTTP errors
//
// Nothing is masked: the failure is reported as before, with these lines after it.

const events = [];
const MAX = 200;
const t0 = Date.now();

/** Record an event (kept in a ring of the last 200). */
export function note(what) {
  events.push({ at: Date.now(), what });
  if (events.length > MAX) events.splice(0, events.length - MAX);
}

/** Events since `since` (ms since the epoch), oldest first, as lines. */
export function eventsSince(since) {
  return events.filter((e) => e.at >= since).map((e) => `  +${((e.at - t0) / 1000).toFixed(1)}s ${e.what}`);
}

/** Print the events since `since` under a heading, if there are any. */
export function printEvents(since, heading = "page and server events") {
  const lines = eventsSince(since);
  if (lines.length) console.log(`(${heading}:)\n${lines.join("\n")}`);
}

/** The dev server's messages that reload pages (a full reload, as after re-optimizing dependencies). */
export function watchServer(server) {
  const hots = [server.environments?.client?.hot, server.hot, server.ws].filter((h) => h && typeof h.send === "function");
  for (const hot of new Set(hots)) {
    const send = hot.send.bind(hot);
    hot.send = (payload, ...rest) => {
      const p = typeof payload === "string" ? { type: payload } : payload;
      if (p?.type === "full-reload") note(`vite: full reload sent to the page${p.path ? ` (${p.path})` : ""}${p.triggeredBy ? ` by ${p.triggeredBy}` : ""}`);
      else if (p?.type === "error") note(`vite: error sent to the page: ${String(p.err?.message ?? "").split("\n")[0]}`);
      return send(payload, ...rest);
    };
  }
  // (Re-optimizing is logged at "info"; the suites run at "warn". Kept here whatever the level.)
  const info = server.config?.logger?.info;
  if (info) {
    server.config.logger.info = (msg, opts) => {
      const text = String(msg).replace(/\x1b\[[0-9;]*m/g, "");
      if (/optimiz|reload/i.test(text)) note(`vite: ${text.trim().split("\n")[0]}`);
      return info.call(server.config.logger, msg, opts);
    };
  }
  return server;
}

let pages = 0;
/** Watch one page: crash, close, main-frame navigation, console errors, failed requests and HTTP errors. */
export function watchPage(page) {
  const id = ++pages;
  const tag = `page ${id}`;
  page.on("crash", () => note(`${tag}: CRASHED (the renderer died; evaluates on it fail)`));
  page.on("close", () => note(`${tag}: closed`));
  page.on("framenavigated", (f) => {
    if (f === page.mainFrame()) note(`${tag}: navigated to ${f.url()}`);
  });
  page.on("console", (m) => {
    if (m.type() === "error") note(`${tag}: console error: ${m.text().split("\n")[0].slice(0, 300)}`);
  });
  page.on("requestfailed", (r) => note(`${tag}: request failed: ${r.url().slice(0, 200)} (${r.failure()?.errorText ?? "?"})`));
  page.on("response", (r) => {
    if (r.status() >= 400) note(`${tag}: HTTP ${r.status()} ${r.url().slice(0, 200)}`);
  });
  return page;
}

/** Watch every page `browser` opens from now on (in its own contexts and in `newPage`'s). */
export function watchBrowser(browser) {
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (...a) => {
    const ctx = await newContext(...a);
    ctx.on("page", watchPage);
    return ctx;
  };
  const newPage = browser.newPage.bind(browser);
  browser.newPage = async (...a) => watchPage(await newPage(...a));
  browser.on?.("disconnected", () => note("browser: disconnected"));
  return browser;
}
