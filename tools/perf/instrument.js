// Page-side instrumentation for the perf harness (tools/perf/run.mjs), added as an init script before the game's own
// code runs. It times, while `__perf.rec` is on:
// - every requestAnimationFrame callback (three's animation loop runs through it), whether a frame was drawn in it
//   (`woodrail.framesDrawn` went up), and its draw calls and triangles;
// - input handlers, per event: the sum of every listener's time for one pointermove (or down, up, wheel, click, key);
// - setInterval and setTimeout callbacks, summed by their delay (5000: the autosave; 1000: the HUD's once-a-second);
// - long tasks (over 50 ms).
// It also stamps when the game was first ready to play (`__perf.readyAt`, ms since navigation).
(() => {
  const P = (window.__perf = { rec: false, raf: [], events: [], timers: {}, longtasks: [], readyAt: null });
  const now = () => performance.now();
  const drawn = () => window.woodrail?.framesDrawn ?? 0;

  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) =>
    raf((t) => {
      if (!P.rec) return cb(t);
      const s = now();
      const f0 = drawn();
      // What the frame draws (every render call of it: a shadow pass when there is one, the scene, post passes).
      const info = window.woodrail?.renderer?.info;
      if (info) {
        info.autoReset = false;
        info.reset();
      }
      try {
        return cb(t);
      } finally {
        const d = drawn() - f0;
        P.raf.push([s, now() - s, d, d > 0 && info ? info.render.calls : 0, d > 0 && info ? info.render.triangles : 0]);
        if (info) info.autoReset = true;
      }
    });

  const TIMED = new Set(["pointermove", "pointerdown", "pointerup", "touchmove", "touchstart", "touchend", "mousemove", "wheel", "click", "keydown"]);
  const current = new WeakMap();
  const wrappers = new WeakMap();
  const add = EventTarget.prototype.addEventListener;
  const remove = EventTarget.prototype.removeEventListener;
  EventTarget.prototype.addEventListener = function (type, listener, opts) {
    if (!TIMED.has(type) || !listener) return add.call(this, type, listener, opts);
    let byType = wrappers.get(listener);
    if (!byType) wrappers.set(listener, (byType = {}));
    const w =
      byType[type] ??
      (byType[type] = function (e) {
        if (!P.rec) return typeof listener === "function" ? listener.call(this, e) : listener.handleEvent(e);
        const s = now();
        try {
          return typeof listener === "function" ? listener.call(this, e) : listener.handleEvent(e);
        } finally {
          const d = now() - s;
          let r = current.get(e);
          if (!r) {
            r = { type, at: s, ms: 0 };
            current.set(e, r);
            P.events.push(r);
          }
          r.ms += d;
        }
      });
    return add.call(this, type, w, opts);
  };
  EventTarget.prototype.removeEventListener = function (type, listener, opts) {
    const w = listener && wrappers.get(listener)?.[type];
    return remove.call(this, type, w ?? listener, opts);
  };

  const timed = (orig, label) =>
    function (fn, ms, ...rest) {
      if (typeof fn !== "function") return orig.call(window, fn, ms, ...rest);
      const key = `${label}${ms | 0}`;
      return orig.call(
        window,
        (...a) => {
          if (!P.rec) return fn(...a);
          const s = now();
          try {
            return fn(...a);
          } finally {
            const t = (P.timers[key] ??= { n: 0, ms: 0, max: 0 });
            const d = now() - s;
            t.n++;
            t.ms += d;
            t.max = Math.max(t.max, d);
          }
        },
        ms,
        ...rest,
      );
    };
  window.setInterval = timed(window.setInterval, "interval:");
  window.setTimeout = timed(window.setTimeout, "timeout:");

  try {
    new PerformanceObserver((l) => {
      if (P.rec) for (const e of l.getEntries()) P.longtasks.push([e.startTime, e.duration]);
    }).observe({ type: "longtask", buffered: false });
  } catch {}

  // Ready to play: the game's object, its mode, no title, and the loading cover gone.
  const ready = () => {
    const w = window.woodrail;
    if (P.readyAt === null && w?.mode?.() && w.title && !w.title.shown && document.querySelector("#loading.done")) P.readyAt = now();
    if (P.readyAt === null) raf(ready);
  };
  raf(ready);
})();
