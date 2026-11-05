// Page-side tally of the GPU memory a page allocates through WebGL (tools/perf/memory.mjs): every buffer's
// bufferData size, every texture's levels (by format), every renderbuffer (times its samples), and the canvas's
// drawing buffer. An estimate (drivers pad and keep copies), but the same from run to run, and it moves with what the
// game asks for. `window.__gpu.buffers()` etc. give bytes now.
(() => {
  const bufBytes = new Map();
  const texBytes = new Map();
  const rbBytes = new Map();
  const texDims = new Map();
  /** Which context made each object: a context lost (the loading screen's, on purpose) takes its objects with it. */
  const owner = new Map();
  const forget = (gl) => {
    for (const [o, g] of owner) {
      if (g !== gl) continue;
      bufBytes.delete(o);
      texBytes.delete(o);
      rbBytes.delete(o);
      owner.delete(o);
    }
  };
  const boundBuf = new WeakMap();
  const boundTex = new WeakMap();
  const boundRb = new WeakMap();
  const canvases = new Set();
  const sum = (m) => {
    let s = 0;
    for (const v of m.values()) s += typeof v === "number" ? v : v.reduce((a, b) => a + (b || 0), 0);
    return s;
  };
  const BPP = (f) => {
    // A few sized formats three uses; 4 bytes otherwise.
    const map = { 0x881a: 8, 0x8814: 16, 0x822f: 4, 0x8230: 8, 0x822d: 2, 0x8229: 1, 0x822b: 2, 0x81a5: 2, 0x81a6: 4, 0x8cac: 4, 0x88f0: 4, 0x8cad: 8, 0x8058: 4, 0x8c43: 4, 0x8051: 3, 0x1908: 4, 0x1907: 3, 0x1909: 1, 0x190a: 2, 0x1906: 1, 0x1902: 4 };
    return map[f] ?? 4;
  };
  window.__gpu = {
    buffers: () => sum(bufBytes),
    textures: () => sum(texBytes),
    renderbuffers: () => sum(rbBytes),
    drawingBuffer: () => {
      let s = 0;
      for (const [c, aa] of canvases) s += c.width * c.height * 4 * (aa ? 2 : 1) + c.width * c.height * 4 /* depth and stencil */;
      return s;
    },
    /** Each live texture: [bytes, width, height, format, levels or faces], biggest first. */
    textureList: () => [...texDims].filter(([t]) => texBytes.has(t)).map(([t, d]) => [sum(new Map([[0, texBytes.get(t)]])), ...d]).sort((a, b) => b[0] - a[0]),
    counts: () => ({ buffers: bufBytes.size, textures: texBytes.size, renderbuffers: rbBytes.size }),
  };
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, attrs) {
    const gl = getContext.call(this, type, attrs);
    if (gl && /webgl/.test(type) && ![...canvases].some(([c]) => c === this)) {
      const entry = [this, attrs?.antialias ?? true];
      canvases.add(entry);
      this.addEventListener("webglcontextlost", () => {
        forget(gl);
        canvases.delete(entry);
      });
    }
    return gl;
  };
  for (const C of [window.WebGL2RenderingContext, window.WebGLRenderingContext]) {
    if (!C) continue;
    const P = C.prototype;
    const wrap = (name, f) => {
      const orig = P[name];
      if (!orig) return;
      P[name] = function (...a) {
        const r = orig.apply(this, a);
        try {
          f.call(this, a, r);
        } catch {}
        return r;
      };
    };
    const ctxMap = (wm, gl) => {
      let m = wm.get(gl);
      if (!m) wm.set(gl, (m = new Map()));
      return m;
    };
    wrap("bindBuffer", function ([t, b]) {
      ctxMap(boundBuf, this).set(t, b);
    });
    wrap("bufferData", function ([t, d]) {
      const b = ctxMap(boundBuf, this).get(t);
      if (!b) return;
      bufBytes.set(b, typeof d === "number" ? d : (d?.byteLength ?? 0));
      owner.set(b, this);
    });
    wrap("deleteBuffer", function ([b]) {
      bufBytes.delete(b);
    });
    let unit = 0;
    wrap("activeTexture", function ([u]) {
      unit = u;
    });
    wrap("bindTexture", function ([t, tex]) {
      ctxMap(boundTex, this).set(`${unit}:${t}`, tex);
    });
    const tex = (gl, t) => ctxMap(boundTex, gl).get(`${unit}:${t}`);
    const faceTarget = (t) => (t >= 0x8515 && t <= 0x851a ? 0x8513 : t);
    wrap("texImage2D", function (a) {
      const t = faceTarget(a[0]);
      const tx = tex(this, t);
      if (!tx) return;
      const level = a[1];
      const fmt = a[2];
      let w, h;
      if (a.length >= 8) {
        w = a[3];
        h = a[4];
      } else {
        const src = a[5];
        w = src?.width ?? src?.videoWidth ?? 0;
        h = src?.height ?? src?.videoHeight ?? 0;
      }
      let lv = texBytes.get(tx);
      if (!Array.isArray(lv)) texBytes.set(tx, (lv = []));
      const face = a[0] !== t ? a[0] - 0x8515 : 0;
      lv[level * 6 + face] = w * h * BPP(fmt);
      owner.set(tx, this);
      if (level === 0) texDims.set(tx, [w, h, fmt, "2d"]);
    });
    wrap("texStorage2D", function ([t, levels, fmt, w, h]) {
      const tx = tex(this, t);
      if (!tx) return;
      let s = 0;
      for (let l = 0; l < levels; l++) s += Math.max(1, w >> l) * Math.max(1, h >> l) * BPP(fmt);
      texBytes.set(tx, s * (t === 0x8513 ? 6 : 1));
      owner.set(tx, this);
      texDims.set(tx, [w, h, fmt, `storage ${levels}`]);
    });
    wrap("texImage3D", function (a) {
      const tx = tex(this, a[0]);
      if (!tx) return;
      texBytes.set(tx, a[3] * a[4] * a[5] * BPP(a[2]));
      owner.set(tx, this);
      texDims.set(tx, [a[3], a[4], a[2], `3d ${a[5]}`]);
    });
    wrap("texStorage3D", function ([t, levels, fmt, w, h, d]) {
      const tx = tex(this, t);
      if (!tx) return;
      let s = 0;
      for (let l = 0; l < levels; l++) s += Math.max(1, w >> l) * Math.max(1, h >> l) * d * BPP(fmt);
      texBytes.set(tx, s);
      owner.set(tx, this);
      texDims.set(tx, [w, h, fmt, `storage3d ${levels}x${d}`]);
    });
    wrap("generateMipmap", function ([t]) {
      const tx = tex(this, t);
      const lv = tx && texBytes.get(tx);
      if (Array.isArray(lv) && lv[0]) texBytes.set(tx, [Math.round(lv[0] * 4 / 3)]);
    });
    wrap("deleteTexture", function ([tx]) {
      texBytes.delete(tx);
    });
    wrap("bindRenderbuffer", function ([, rb]) {
      boundRb.set(this, rb);
    });
    wrap("renderbufferStorage", function ([, fmt, w, h]) {
      const rb = boundRb.get(this);
      if (rb) rbBytes.set(rb, w * h * BPP(fmt));
      if (rb) owner.set(rb, this);
    });
    wrap("renderbufferStorageMultisample", function ([, samples, fmt, w, h]) {
      const rb = boundRb.get(this);
      if (rb) rbBytes.set(rb, w * h * BPP(fmt) * Math.max(1, samples));
      if (rb) owner.set(rb, this);
    });
    wrap("deleteRenderbuffer", function ([rb]) {
      rbBytes.delete(rb);
    });
  }
})();
