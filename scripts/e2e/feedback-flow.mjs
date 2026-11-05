// "Report a bug or give feedback", end to end, for e2e:touch (a phone, touch taps) and e2e:click (a desktop, mouse
// clicks): ☰ → the item → the sheet (Bug and Idea, a note, the picture on by default, the map locked on for a bug) →
// Send to a mocked Worker that first fails (Copy instead: the note and map on the clipboard), then takes it (Sent). The
// payoff: the posted report's map loads (src/play/bugmap.ts) into the same railway, and its picture is a JPEG within
// 1280 px. The page's VITE_FEEDBACK_URL must be FEEDBACK_URL (the scripts set it before their dev server starts).

/** Where the e2e's game sends feedback: no such host; Playwright answers for it. */
export const FEEDBACK_URL = "http://feedback.test";

/**
 * `p`: a page in a mode, nothing open. `press(selector)`: a tap or click on it as the script's player makes one.
 * `check(name, ok, detail)`: the script's. `label`: before each check's name.
 */
export async function feedbackFlow(p, { press, check, label }) {
  const posts = [];
  let fail = true;
  await p.route(`${FEEDBACK_URL}/**`, async (route) => {
    const req = route.request();
    const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    posts.push(req.postData() ?? "");
    if (fail) return route.fulfill({ status: 503, headers: cors, body: "down" });
    return route.fulfill({ status: 200, headers: { ...cors, "Content-Type": "application/json" }, body: JSON.stringify({ id: "20261102T101010-" + "a".repeat(32), issue: "https://github.com/dwfennell/woodrail/issues/1" }) });
  });
  // The clipboard, kept in the page (headless Chromium's needs permissions the scripts' contexts don't all grant).
  await p.evaluate(() => {
    window.__copied = null;
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (t) => void (window.__copied = t), readText: async () => window.__copied ?? "" } });
  });
  const visible = (sel) => p.evaluate((sel) => { const e = document.querySelector(sel); return !!e && !e.closest("[hidden]") && getComputedStyle(e).visibility !== "hidden" && e.getClientRects().length > 0; }, sel);

  // ☰ → Report a bug or give feedback.
  await press('button[aria-label="Menu"]');
  await p.waitForFunction(() => !document.querySelector(".menu").hidden, null, { timeout: 10000 });
  check(`${label}: ☰ has Report a bug or give feedback, beside Copy map`, await p.evaluate(() => {
    const items = [...document.querySelectorAll(".menu .menu-item")].map((x) => x.textContent);
    const i = items.indexOf("Report a bug or give feedback");
    return i >= 0 && items[i + 1] === "Copy map for a bug report";
  }));
  await press(".menu .feedback-item");
  await p.waitForFunction(() => { const s = document.querySelector(".feedback-sheet"); return s && !s.hidden; }, null, { timeout: 10000 });
  // (Popped in: measured once its animation is done.)
  await p.evaluate(() => Promise.all(document.querySelector(".feedback-sheet").getAnimations().map((a) => a.finished)));
  const shown = await p.evaluate(() => {
    const s = document.querySelector(".feedback-sheet");
    const r = s.getBoundingClientRect();
    const h = (sel) => Math.round(s.querySelector(sel).getBoundingClientRect().height);
    return {
      inView: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight,
      bug: s.querySelector(".feedback-kind.active")?.textContent ?? "",
      shot: s.querySelector(".feedback-shot input").checked,
      mapLocked: s.querySelector(".feedback-map input").checked && s.querySelector(".feedback-map input").disabled,
      sendOff: s.querySelector(".feedback-send").disabled,
      privacy: s.querySelector(".feedback-privacy")?.textContent ?? "",
      heights: { kind: h(".feedback-kind"), shot: h(".feedback-shot"), map: h(".feedback-map"), send: h(".feedback-send"), cancel: h(".feedback-cancel") },
    };
  });
  check(`${label}: the sheet opens on Bug, in view, picture on, map locked on, Send off till there's a note`, shown.inView && shown.bug.includes("Bug") && shown.shot && shown.mapLocked && shown.sendOff, JSON.stringify(shown));
  check(`${label}: its targets are 44 px or more`, Object.values(shown.heights).every((v) => v >= 44), JSON.stringify(shown.heights));
  check(`${label}: it says in a line what's sent`, /note, map, picture/.test(shown.privacy) && /people who make Woodrail/.test(shown.privacy), shown.privacy);
  await p.waitForFunction(() => { const t = document.querySelector(".feedback-thumb"); return t && !t.hidden && t.naturalWidth > 0; }, null, { timeout: 60000 }).catch(() => {});
  check(`${label}: the picture is taken once, as it opens (its preview shows)`, await visible(".feedback-thumb"));
  // (E2E_SHOTS=<dir>: a picture of the sheet, to look at.)
  if (process.env.E2E_SHOTS) await p.screenshot({ path: `${process.env.E2E_SHOTS}/feedback-${label.replace(/\W+/g, "-")}.png` });

  // Idea frees the map's box; Bug locks it again.
  await press(".feedback-kind:nth-child(2)");
  const idea = await p.evaluate(() => ({ active: document.querySelector(".feedback-kind.active")?.textContent, map: !document.querySelector(".feedback-map input").disabled }));
  await press(".feedback-kind:nth-child(1)");
  const bug = await p.evaluate(() => document.querySelector(".feedback-map input").disabled && document.querySelector(".feedback-map input").checked);
  check(`${label}: Idea makes the map optional, Bug makes it always on`, idea.active?.includes("Idea") && idea.map && bug, JSON.stringify({ idea, bug }));

  // A note, Send: the Worker's down.
  await press(".feedback-note");
  await p.keyboard.type("The train fell off the bridge\nright after the curve");
  await press(".feedback-send");
  await p.waitForFunction(() => !document.querySelector(".feedback-copy").hidden, null, { timeout: 60000 }).catch(() => {});
  const failed = await p.evaluate(() => ({ status: document.querySelector(".feedback-status").textContent, copy: !document.querySelector(".feedback-copy").hidden, open: !document.querySelector(".feedback-sheet").hidden }));
  check(`${label}: a failed send says so, keeps the sheet, and offers Copy instead`, failed.open && failed.copy && /Couldn't send/.test(failed.status), JSON.stringify(failed));
  await press(".feedback-copy");
  await p.waitForFunction(() => window.__copied !== null, null, { timeout: 10000 }).catch(() => {});
  const copied = await p.evaluate(() => window.__copied ?? "");
  check(`${label}: Copy instead copies the note and the map`, copied.startsWith("[bug] The train fell off the bridge") && /\nwoodrail-map:1:\S+$/.test(copied), `${copied.length} chars`);

  // Send again: taken.
  fail = false;
  const n = posts.length;
  await press(".feedback-send");
  await p.waitForFunction(() => !document.querySelector(".feedback-done").hidden, null, { timeout: 60000 }).catch(() => {});
  check(`${label}: a send that's taken says Sent`, await visible(".feedback-thanks"), await p.evaluate(() => document.querySelector(".feedback-sheet").textContent));
  const body = posts[n] ?? posts.at(-1) ?? "{}";
  const report = JSON.parse(body);
  const payoff = await p.evaluate(async (r) => {
    const w = window.woodrail;
    const { loadBugMap } = await import("/src/play/bugmap.ts");
    let pieces = -1;
    let mode = "";
    try {
      const m = await loadBugMap(r.map);
      pieces = m.world.layout.pieceCount;
      mode = m.mode;
    } catch (e) {
      mode = String(e);
    }
    let shot = null;
    if (r.shot) {
      const bytes = Uint8Array.from(atob(r.shot), (c) => c.charCodeAt(0));
      const bmp = await createImageBitmap(new Blob([bytes], { type: "image/jpeg" }));
      shot = { jpeg: bytes[0] === 0xff && bytes[1] === 0xd8, kb: Math.round(bytes.length / 1024), w: bmp.width, h: bmp.height };
    }
    return { pieces, mode, here: w.layout.pieceCount, playing: w.mode(), shot, vw: innerWidth, vh: innerHeight };
  }, report);
  check(`${label}: the report's map loads into the same railway`, payoff.mode === payoff.playing && payoff.pieces === payoff.here && payoff.pieces > 0, JSON.stringify(payoff));
  check(`${label}: the report has the note, kind, mode, build, browser and screen`, report.kind === "bug" && report.text === "The train fell off the bridge\nright after the curve" && report.mode === payoff.playing && typeof report.build === "string" && report.userAgent.length > 0 && report.viewport?.width === payoff.vw && report.viewport?.height === payoff.vh && Array.isArray(report.badges), JSON.stringify({ ...report, map: report.map?.slice(0, 30), shot: report.shot?.length }));
  check(`${label}: its picture is a JPEG within 1280 px and about 300 KB`, !!payoff.shot?.jpeg && Math.max(payoff.shot.w, payoff.shot.h) <= 1280 && payoff.shot.kb <= 400, JSON.stringify(payoff.shot));
  await press(".feedback-close");
  check(`${label}: Close puts the sheet away`, await p.evaluate(() => document.querySelector(".feedback-sheet").hidden));
  await p.unroute(`${FEEDBACK_URL}/**`);
}
