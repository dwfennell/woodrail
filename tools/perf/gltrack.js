// Tracks GPU allocations made through WebGL: textures, renderbuffers, buffers, and the canvas's drawing buffer.
(() => {
  const BPP = {
    // internal formats → bytes per pixel (approximate; unknown → 4)
    0x8058: 4, 0x8051: 3, 0x881a: 8, 0x8814: 16, 0x822f: 4, 0x822e: 4, 0x8230: 8, 0x8c3a: 4, 0x8229: 1, 0x822b: 2,
    0x81a5: 2, 0x81a6: 4, 0x8cac: 4, 0x88f0: 4, 0x8cad: 8, 0x8c43: 4, 0x1908: 4, 0x1907: 3, 0x1909: 1, 0x190a: 2,
    0x1902: 4, 0x8d48: 1, 0x8d62: 2, 0x8056: 2, 0x8057: 2, 0x8d9f: 4,
  };
  const TYPEB = { 0x1401: 1, 0x1403: 2, 0x1405: 4, 0x1406: 4, 0x140b: 2, 0x8d61: 2, 0x84fa: 4, 0x8033: 2, 0x8034: 2, 0x8363: 2 };
  const CH = { 0x1908: 4, 0x1907: 3, 0x1909: 1, 0x190a: 2, 0x1902: 1, 0x84f9: 1, 0x1903: 1, 0x8227: 2 };
  const st = { tex: new Map(), rb: new Map(), buf: new Map(), peak: 0, events: 0 };
  const total = () => {
    let t = 0, r = 0, b = 0;
    for (const v of st.tex.values()) t += v.bytes;
    for (const v of st.rb.values()) r += v;
    for (const v of st.buf.values()) b += v;
    return { tex: t, rb: r, buf: b, all: t + r + b };
  };
  let marked = null;
  window.__gl = {
    st,
    /** Remember the buffers alive now; `newSince()` then lists those made after and still alive, by where they were made. */
    mark() { marked = new Set(st.buf.keys()); st.bufStack = new Map(); },
    newSince() {
      const by = new Map();
      for (const [b, bytes] of st.buf) if (marked && !marked.has(b)) { const k = st.bufStack?.get(b) ?? "?"; const e = by.get(k) ?? { n: 0, bytes: 0 }; e.n++; e.bytes += bytes; by.set(k, e); }
      return [...by].sort((a, b) => b[1].n - a[1].n).slice(0, 8).map(([k, e]) => `${e.n}× ${e.bytes}B: ${k}`);
    },
    summary() {
      const s = total();
      const mb = (x) => Math.round(x / 1048576 * 10) / 10;
      const big = [...st.tex.values()].sort((a, b) => b.bytes - a.bytes).slice(0, 12).map((v) => `${v.w}x${v.h}${v.d > 1 ? "x" + v.d : ""} ${v.fmt.toString(16)} ${mb(v.bytes)}MB${window.__glStacks && v.stack ? " @ " + v.stack : ""}`);
      const rbs = [...st.rb.values()].sort((a, b) => b - a).slice(0, 8).map(mb);
      return { texMB: mb(s.tex), rbMB: mb(s.rb), bufMB: mb(s.buf), allMB: mb(s.all), peakMB: mb(st.peak), textures: st.tex.size, renderbuffers: st.rb.size, buffers: st.buf.size, bigTextures: big, bigRenderbuffersMB: rbs };
    },
  };
  const bump = () => { const a = total().all; if (a > st.peak) st.peak = a; };
  for (const P of [window.WebGL2RenderingContext?.prototype].filter(Boolean)) {
    const boundTex = new WeakMap(); // ctx -> {unit, map}
    const unitOf = (gl) => { let s = boundTex.get(gl); if (!s) boundTex.set(gl, (s = { unit: 0, map: new Map(), rb: null, buf: new Map() })); return s; };
    const wrap = (name, after) => { const f = P[name]; P[name] = function (...a) { const r = f.apply(this, a); try { after.call(this, a, r); } catch {} return r; }; };
    wrap("activeTexture", function ([u]) { unitOf(this).unit = u; });
    wrap("bindTexture", function ([t, tex]) { unitOf(this).map.set(unitOf(this).unit + ":" + t, tex); });
    const cur = (gl, target) => {
      const base = target >= 0x8515 && target <= 0x851a ? 0x8513 : target; // cube faces
      return unitOf(gl).map.get(unitOf(gl).unit + ":" + base);
    };
    const setTex = (tex, key, bytes, w, h, d, fmt) => {
      if (!tex) return;
      let e = st.tex.get(tex);
      if (!e) st.tex.set(tex, (e = { parts: new Map(), bytes: 0, w, h, d, fmt }));
      e.parts.set(key, bytes);
      if (bytes > 4e6 && !e.stack) e.stack = new Error().stack.split("\n").slice(3, 14).map((l) => l.trim().replace(/\(?https?:\/\/[^/]+\//, "(")).join(" < ");
      e.bytes = [...e.parts.values()].reduce((s, x) => s + x, 0);
      if (key.startsWith("0:") || key === "storage") { e.w = w; e.h = h; e.d = d; e.fmt = fmt; }
      bump();
    };
    wrap("texImage2D", function (a) {
      const [target, level, ifmt] = a;
      let w, h, fmt = a[a.length - 3 >= 0 ? 0 : 0];
      let type;
      if (a.length >= 8 && typeof a[3] === "number") { w = a[3]; h = a[4]; fmt = a[6]; type = a[7]; }
      else { const src = a[5]; w = src.width || src.videoWidth || src.codedWidth; h = src.height || src.videoHeight || src.codedHeight; fmt = a[3]; type = a[4]; }
      const bpp = BPP[ifmt] ?? (CH[fmt] ?? 4) * (TYPEB[type] ?? 1);
      setTex(cur(this, target), `${level}:${target}`, w * h * bpp, w, h, 1, ifmt);
    });
    wrap("texStorage2D", function ([target, levels, ifmt, w, h]) {
      let s = 0, ww = w, hh = h; for (let i = 0; i < levels; i++) { s += ww * hh; ww = Math.max(1, ww >> 1); hh = Math.max(1, hh >> 1); }
      setTex(cur(this, target), "storage", s * (BPP[ifmt] ?? 4) * (target === 0x8513 ? 6 : 1), w, h, 1, ifmt);
    });
    wrap("texImage3D", function (a) { const [target, level, ifmt, w, h, d, , fmt, type] = a; setTex(cur(this, target), `${level}:${target}`, w * h * d * (BPP[ifmt] ?? (CH[fmt] ?? 4) * (TYPEB[type] ?? 1)), w, h, d, ifmt); });
    wrap("texStorage3D", function ([target, levels, ifmt, w, h, d]) { setTex(cur(this, target), "storage", w * h * d * (BPP[ifmt] ?? 4) * (levels > 1 ? 1.33 : 1), w, h, d, ifmt); });
    wrap("generateMipmap", function ([target]) { const t = cur(this, target); const e = t && st.tex.get(t); if (e && !e.parts.has("mips")) { e.parts.set("mips", Math.round(e.bytes / 3)); e.bytes = Math.round(e.bytes * 4 / 3); bump(); } });
    wrap("deleteTexture", function ([t]) { st.tex.delete(t); });
    wrap("bindRenderbuffer", function ([, rb]) { unitOf(this).rb = rb; });
    wrap("renderbufferStorage", function ([, ifmt, w, h]) { const rb = unitOf(this).rb; if (rb) { st.rb.set(rb, w * h * (BPP[ifmt] ?? 4)); bump(); } });
    wrap("renderbufferStorageMultisample", function ([, samples, ifmt, w, h]) { const rb = unitOf(this).rb; if (rb) { st.rb.set(rb, w * h * Math.max(1, samples) * (BPP[ifmt] ?? 4)); bump(); } });
    wrap("deleteRenderbuffer", function ([rb]) { st.rb.delete(rb); });
    wrap("bindBuffer", function ([t, b]) { unitOf(this).buf.set(t, b); });
    wrap("bufferData", function ([t, d]) { const b = unitOf(this).buf.get(t); if (b) { if (marked && !st.buf.has(b) && st.bufStack) st.bufStack.set(b, new Error().stack.split("\n").slice(3, 12).map((l) => l.trim().replace(/^at /, "").replace(/\(?https?:\/\/[^/]+\/assets\//, "(")).join(" < ")); st.buf.set(b, typeof d === "number" ? d : d?.byteLength ?? 0); bump(); } });
    wrap("deleteBuffer", function ([b]) { st.buf.delete(b); });
  }
})();
