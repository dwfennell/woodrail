/** Routed trains' switch throws are heard at most once in this long (ms). */
export const SOFT_CLUNK_GAP_MS = 700;

/** Lets something through at most once every `ms` (by the times given). */
export class Gate {
  private last = -Infinity;

  constructor(readonly ms: number) {}

  /** May it go at `now` (ms)? If so, the gate shuts for the next `ms`. */
  open(now: number): boolean {
    if (now - this.last < this.ms) return false;
    this.last = now;
    return true;
  }
}

/**
 * Synthesised toy sounds (no audio files): wooden clacks over joints, magnet clicks, crash thuds, snap knocks
 * and a soft motor hum. The AudioContext starts on the first user gesture, as browsers require.
 */
export class ToyAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private hum: { gain: GainNode; osc: OscillatorNode; lfo: OscillatorNode } | null = null;
  private lastClack = 0;
  muted = false;

  constructor() {
    const start = () => {
      this.ensure();
      window.removeEventListener("pointerdown", start);
      window.removeEventListener("keydown", start);
    };
    window.addEventListener("pointerdown", start);
    window.addEventListener("keydown", start);
  }

  private ensure(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    const ctx = new Ctor();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.8;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(ctx.destination);
    const len = ctx.sampleRate * 0.5;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    let seed = 12345;
    for (let i = 0; i < len; i++) {
      seed = (seed * 1103515245 + 12345) >>> 0;
      data[i] = (seed / 4294967295) * 2 - 1;
    }
    return ctx;
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.8;
    // (Its winding's level is set again by the next frame that hears a lift ride.)
    if (m) this.setWinding(0);
  }

  /** A short filtered noise burst plus a resonant "tock": the sound of wood on wood. */
  private knock(volume: number, freq: number, decay: number, pan: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise || this.muted || volume <= 0.001) return;
    const t = ctx.currentTime;
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    panner.connect(this.master);

    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = freq * 2.2;
    band.Q.value = 2.5;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(volume * 0.6, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    src.connect(band).connect(ng).connect(panner);
    src.start(t, Math.random() * 0.4, decay + 0.02);

    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.7, t + decay);
    const og = ctx.createGain();
    og.gain.setValueAtTime(volume * 0.5, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + decay * 1.2);
    osc.connect(og).connect(panner);
    osc.start(t);
    osc.stop(t + decay * 1.3);
  }

  /** Wheels over a joint. Rate-limited so many trains don't turn into noise. */
  clack(volume: number, pan: number): void {
    const now = performance.now();
    if (now - this.lastClack < 18) return;
    this.lastClack = now;
    this.knock(volume * 0.35, 700 + Math.random() * 120, 0.05, pan);
  }

  magnet(volume: number, pan: number): void {
    this.knock(volume * 0.7, 1300, 0.04, pan);
    setTimeout(() => this.knock(volume * 0.4, 1100, 0.03, pan), 35);
  }

  private lastBump = 0;

  /** Repelling magnets nudging. Rate-limited: it fires every tick while an engine pushes. */
  bump(volume: number, pan: number): void {
    const now = performance.now();
    if (now - this.lastBump < 450) return;
    this.lastBump = now;
    this.knock(volume * 0.25, 900, 0.03, pan);
  }

  /** A cheerful two-note chime: towns connected. */
  chime(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || this.muted) return;
    const t = ctx.currentTime;
    [784, 1175].forEach((f, k) => {
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t + k * 0.13);
      g.gain.linearRampToValueAtTime(0.18, t + k * 0.13 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + k * 0.13 + 0.7);
      osc.connect(g).connect(this.master!);
      osc.start(t + k * 0.13);
      osc.stop(t + k * 0.13 + 0.75);
    });
  }

  /** A wooden clunk: a log or plank bundle set down by a crane. */
  clunk(volume: number, pan: number): void {
    this.knock(volume * 0.8, 120 * this.vary(1), 0.22, pan);
    this.knock(volume * 0.35, 260 * this.vary(1), 0.08, pan);
  }

  /** Routed trains' throws heard: one in `SOFT_CLUNK_GAP_MS` at most. */
  private readonly softClunks = new Gate(SOFT_CLUNK_GAP_MS);

  /**
   * A switch thrown by a routed train, in view (QA N5: it swung over silently): the lever's clunk, soft, and at most one
   * so often, so a busy layout doesn't clatter. True if it was heard.
   */
  softSwitchClunk(pan: number): boolean {
    if (!this.softClunks.open(performance.now())) return false;
    this.switchClunk(0.28, pan);
    return true;
  }

  /** A switch's lever thrown over: the wooden clunk, with a lower knock under it (the points coming home). */
  switchClunk(volume: number, pan: number): void {
    this.clunk(volume, pan);
    this.knock(volume * 0.55, 72 * this.vary(1), 0.16, pan);
  }

  /** A short buzz of the sawmill's blade cutting (call about twice a second while it works). */
  saw(volume: number, pan: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || this.muted || volume <= 0.02) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(190 * this.vary(1), t);
    osc.frequency.linearRampToValueAtTime(160, t + 0.45);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 900;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.035 * volume, t + 0.05);
    g.gain.linearRampToValueAtTime(0.0001, t + 0.5);
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    osc.connect(lp).connect(g).connect(panner).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.55);
  }

  /** A small toy bell, two quick strikes, as an engine sets off. */
  bell(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || this.muted) return;
    const t = ctx.currentTime;
    for (const k of [0, 0.16]) {
      // A bell: a bright fundamental plus inharmonic partials, each fading at its own rate.
      for (const [ratio, vol, decay] of [[1, 0.12, 0.9], [2.76, 0.05, 0.45], [5.4, 0.025, 0.2]] as const) {
        const osc = ctx.createOscillator();
        osc.type = "sine";
        osc.frequency.value = 1320 * ratio;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t + k);
        g.gain.linearRampToValueAtTime(vol, t + k + 0.004);
        g.gain.exponentialRampToValueAtTime(0.0001, t + k + decay);
        osc.connect(g).connect(this.master);
        osc.start(t + k);
        osc.stop(t + k + decay + 0.05);
      }
    }
  }

  private lastWhistle = 0;
  private lastWhistleVolume = 0;
  /** The last whistle's output, to fade when a nearer engine's cuts in over it. */
  private whistleOut: GainNode | null = null;

  /**
   * A toy engine's whistle: two reedy notes a third apart, a breath of air under them, a short pip then a longer
   * toot (an engine passing a whistle post). `volume` and `pan` as `listen` hears the engine: nearer the camera,
   * louder. Rate-limited, so trains passing posts together don't blare: within 0.6 s of one only a clearly louder
   * (nearer) whistle is heard, and the one before it fades out under it. Returns whether it was heard.
   */
  whistle(volume: number, pan: number): boolean {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise || this.muted || volume <= 0.02) return false;
    const now = performance.now();
    if (now - this.lastWhistle < 600) {
      if (volume < this.lastWhistleVolume * 1.4) return false;
      this.whistleOut?.gain.setTargetAtTime(0, ctx.currentTime, 0.03);
    }
    this.lastWhistle = now;
    this.lastWhistleVolume = volume;
    const t = ctx.currentTime;
    const out = ctx.createGain();
    out.connect(this.master);
    this.whistleOut = out;
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    panner.connect(out);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 2600;
    lp.connect(panner);
    for (const [start, length] of [
      [0, 0.12],
      [0.18, 0.55],
    ] as const) {
      for (const f of [880, 1109]) {
        const osc = ctx.createOscillator();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(f * 0.97, t + start);
        osc.frequency.linearRampToValueAtTime(f, t + start + 0.05);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t + start);
        g.gain.linearRampToValueAtTime(0.07 * volume, t + start + 0.03);
        g.gain.setValueAtTime(0.07 * volume, t + start + length - 0.06);
        g.gain.linearRampToValueAtTime(0.0001, t + start + length);
        osc.connect(g).connect(lp);
        osc.start(t + start);
        osc.stop(t + start + length + 0.02);
      }
    }
    // Breath: a little filtered noise under the notes.
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 1800;
    band.Q.value = 1.2;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.025 * volume, t);
    ng.gain.linearRampToValueAtTime(0.0001, t + 0.75);
    src.connect(band).connect(ng).connect(panner);
    src.loop = true;
    src.start(t);
    src.stop(t + 0.78);
    return true;
  }

  snap(): void {
    this.knock(0.55, 520, 0.08, 0);
  }

  /** A little random pitch spread so repeated sounds don't feel canned. */
  private vary(f: number): number {
    return f * (0.94 + Math.random() * 0.12);
  }

  /** Lifting a piece off the felt: a light, dry tick. */
  pickup(): void {
    this.knock(0.22, this.vary(980), 0.035, 0);
  }

  /** Putting a piece down: a seated peg clacks firmly; a loose piece lands with a soft thud on felt. */
  putdown(snapped: boolean): void {
    if (snapped) {
      this.knock(0.55, this.vary(520), 0.08, 0);
      setTimeout(() => this.knock(0.25, this.vary(780), 0.04, 0), 28);
    } else this.knock(0.3, this.vary(340), 0.07, 0);
  }

  /** Drawing track: a ghost piece joins the line (a soft pencil tick). */
  drawTick(): void {
    this.knock(0.08, this.vary(1250), 0.02, 0);
  }

  /** A drawn line going down: each piece clicks in, a little higher along the line (`i` from its start). */
  lay(i: number): void {
    const f = 520 * Math.min(1.6, 1 + i * 0.04);
    this.knock(0.42, this.vary(f), 0.06, 0);
    setTimeout(() => this.knock(0.18, this.vary(f * 1.5), 0.035, 0), 24);
  }

  /** Turning a piece in place: two quick wooden ticks. */
  rotate(): void {
    this.knock(0.2, this.vary(860), 0.03, 0);
    setTimeout(() => this.knock(0.16, this.vary(700), 0.03, 0), 60);
  }

  /** A button press: barely there. */
  tap(): void {
    this.knock(0.1, this.vary(1500), 0.02, 0);
  }

  /** "Nuh-uh": the landscape won't allow that. */
  refuse(): void {
    this.knock(0.28, this.vary(300), 0.06, 0);
    setTimeout(() => this.knock(0.24, this.vary(240), 0.07, 0), 110);
  }

  crash(volume: number, pan: number): void {
    for (let i = 0; i < 5; i++) {
      setTimeout(() => this.knock(volume * (0.9 - i * 0.15), 260 + Math.random() * 500, 0.09, pan + (Math.random() - 0.5) * 0.3), i * 70 + Math.random() * 40);
    }
  }

  /** A train lift setting off or arriving: a soft, deep wooden clunk and a click of its gear. */
  liftClunk(volume: number, pan: number): void {
    this.knock(volume * 0.5, 150 * this.vary(1), 0.16, pan);
    setTimeout(() => this.knock(volume * 0.22, 640 * this.vary(1), 0.03, pan), 45);
  }

  private winding: { gain: GainNode; osc: OscillatorNode; lfo: OscillatorNode } | null = null;
  private windingLevel = 0;

  /**
   * A train lift's winding gear while it rides: a soft low whirr with a ratchet's flutter, level 0..1 (0: quiet, as
   * when no lift rides or the game's paused). Built on first use; a call at the same level does nothing.
   */
  setWinding(level: number): void {
    const ctx = this.ctx;
    const target = this.muted ? 0 : Math.min(1, Math.max(0, level)) * 0.03;
    if (!ctx || !this.master || target === this.windingLevel || (!this.winding && target === 0)) return;
    this.windingLevel = target;
    if (!this.winding) {
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = 130;
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 520;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      // The ratchet: the whirr's loudness fluttering a dozen times a second.
      const flutter = ctx.createGain();
      flutter.gain.value = 0.7;
      const lfo = ctx.createOscillator();
      lfo.type = "square";
      lfo.frequency.value = 12;
      const depth = ctx.createGain();
      depth.gain.value = 0.3;
      lfo.connect(depth).connect(flutter.gain);
      osc.connect(lp).connect(flutter).connect(gain).connect(this.master);
      osc.start();
      lfo.start();
      this.winding = { gain, osc, lfo };
    }
    this.winding.gain.gain.setTargetAtTime(target, ctx.currentTime, 0.08);
  }

  /** Motor hum level 0..1 from the number and nearness of running engines. */
  setHum(level: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    if (!this.hum) {
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.value = 92;
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 380;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 7;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 6;
      lfo.connect(lfoGain).connect(osc.frequency);
      osc.connect(lp).connect(gain).connect(this.master);
      osc.start();
      lfo.start();
      this.hum = { gain, osc, lfo };
    }
    const target = this.muted ? 0 : Math.min(1, level) * 0.045;
    this.hum.gain.gain.setTargetAtTime(target, ctx.currentTime, 0.15);
  }
}
