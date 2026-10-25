import type { CargoKind } from "../economy/cargo";

/** Routed trains' switch throws are heard at most once in this long (ms). */
export const SOFT_CLUNK_GAP_MS = 700;

/**
 * This long after the last sound has died away (no motor hum or lift winding either), the AudioContext is suspended
 * so its audio thread sleeps while nothing's heard; the next sound wakes it (ms).
 */
export const IDLE_SUSPEND_MS = 3000;

/**
 * At most this many sounds play at once (a busy map: many trains clacking, cranes, saws); one more is dropped till
 * one ends. Milestones' tunes don't count, and are never dropped.
 */
export const MAX_VOICES = 24;

/** The master level at full volume (the compressor after it keeps a pile-up from clipping). */
const MASTER = 0.8;

/** Milestones' tunes: within this long (ms) of one, only a bigger one is heard. */
export const CUE_GAP_MS = 700;

export type CueKind = "chime" | "goal" | "grew" | "learned" | "land";

/**
 * Each milestone's tune: its notes (semitones above C5, start s), the voice, loudness, and rank (a bigger news wins
 * a burst). Short and in one key, so they sit together; the chime is the old towns-connected one (G5, D6).
 */
export const CUES: Record<CueKind, { rank: number; wave: "triangle" | "mallet"; vol: number; notes: readonly (readonly [number, number])[] }> = {
  // Towns connected, a reward, something made, a field planted.
  chime: { rank: 1, wave: "triangle", vol: 0.18, notes: [[7, 0], [14, 0.13]] },
  // A goal ticked: a quick bright "ding-ding".
  goal: { rank: 1, wave: "mallet", vol: 0.2, notes: [[7, 0], [12, 0.09]] },
  // A town grew: three rising wooden notes.
  grew: { rank: 2, wave: "mallet", vol: 0.2, notes: [[0, 0], [4, 0.1], [7, 0.2]] },
  // Research learned: a rising run with a sparkle on top.
  learned: { rank: 2, wave: "mallet", vol: 0.18, notes: [[0, 0], [7, 0.08], [12, 0.16], [16, 0.24]] },
  // New land, an old industry restored: a little fanfare.
  land: { rank: 3, wave: "triangle", vol: 0.16, notes: [[0, 0], [4, 0.12], [7, 0.24], [12, 0.38]] },
};

/** A burst of deliveries (a train unloading at a town) clinks once in this long (ms). */
export const COIN_GAP_MS = 1500;

/** The lead given to sounds scheduled while a sleeping context starts again (s). */
export const RESUME_LEAD_S = 0.05;

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
  private humLevel = 0;
  muted = false;
  /** The player's volume, 0..1 (the menu's slider). */
  private volume = 1;
  /** Sounds playing now (each ends with its `onended`), held under MAX_VOICES. */
  private voices = 0;

  /** When (performance.now(), ms) everything scheduled so far will have died away. */
  private quietAt = 0;
  private sleepTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // The context starts on a user gesture. Later gestures start it again if the system stopped it (iOS "interrupted"
    // by a call or Siri, or a first start the browser didn't count as a gesture): a sound played from a frame can't.
    const gesture = () => {
      const fresh = !this.ctx;
      const ctx = this.ensure();
      if (ctx && (fresh || ctx.state !== "running") && !this.muted && !document.hidden) this.wake(300);
    };
    for (const type of ["pointerdown", "pointerup", "keydown"]) window.addEventListener(type, gesture, { passive: true });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.sleep();
    });
  }

  /**
   * About to play a sound lasting `ms`: the context is started if it sleeps, and kept awake until that sound and
   * IDLE_SUSPEND_MS more have passed. (No per-frame work: one timer, armed while awake.)
   */
  private wake(ms: number): void {
    const ctx = this.ctx;
    if (!ctx || document.hidden) return;
    if (ctx.state !== "running" && !this.resuming) {
      this.resuming = true;
      const done = () => (this.resuming = false);
      void ctx.resume().then(done, done);
    }
    this.quietAt = Math.max(this.quietAt, performance.now() + ms);
    if (!this.sleepTimer) this.sleepTimer = setTimeout(this.sleepWhenQuiet, ms + IDLE_SUSPEND_MS);
  }

  /** True from a resume() till it's done: what's scheduled meanwhile is given a little lead. */
  private resuming = false;

  /**
   * When a sound about to play should start: now, or, while a sleeping context is still starting up again, a little
   * after (RESUME_LEAD_S), so the first sound after a sleep isn't clipped at its start.
   */
  private startTime(ctx: AudioContext): number {
    return ctx.currentTime + (this.resuming ? RESUME_LEAD_S : 0);
  }

  private sleepWhenQuiet = (): void => {
    this.sleepTimer = null;
    // (A motor humming or a lift winding holds it awake: checked again a while later.)
    const held = this.humLevel > 0 || this.windingLevel > 0;
    const left = held ? IDLE_SUSPEND_MS : this.quietAt + IDLE_SUSPEND_MS - performance.now();
    if (left > 0) this.sleepTimer = setTimeout(this.sleepWhenQuiet, left);
    else this.sleep();
  };

  /** Suspend the context (its thread sleeps) until the next sound. */
  private sleep(): void {
    if (this.sleepTimer) clearTimeout(this.sleepTimer);
    this.sleepTimer = null;
    this.quietAt = 0;
    if (this.ctx?.state === "running") void this.ctx.suspend().catch(() => {});
  }

  private ensure(): AudioContext | null {
    if (this.ctx) return this.ctx;
    if (typeof window === "undefined") return null;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    const ctx = new Ctor();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : MASTER * this.volume;
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
    if (this.master) this.master.gain.value = m ? 0 : MASTER * this.volume;
    // (Its winding's level is set again by the next frame that hears a lift ride.)
    if (m) {
      this.setWinding(0);
      this.setHum(0);
      this.sleep();
    }
  }

  /** The player's volume, 0..1: everything, tunes and all, scaled by it. */
  setVolume(v: number): void {
    this.volume = Math.min(1, Math.max(0, v));
    if (this.master && !this.muted) this.master.gain.value = MASTER * this.volume;
  }

  /** A voice for a sound about to start, if there's room: `ends` counts it out again when it's over. */
  private voice(ends: AudioScheduledSourceNode): boolean {
    if (this.voices >= MAX_VOICES) return false;
    this.voices++;
    ends.onended = () => this.voices--;
    return true;
  }

  /** A short filtered noise burst plus a resonant "tock": the sound of wood on wood. */
  private knock(volume: number, freq: number, decay: number, pan: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise || this.muted || volume <= 0.001) return;
    // (The tock rings longest: its end is the sound's.)
    const osc = ctx.createOscillator();
    if (!this.voice(osc)) return;
    this.wake(decay * 1200 + 40);
    const t = this.startTime(ctx);
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

  /** A cheerful two-note chime: towns connected, a reward, something made (the plainest cue). */
  chime(): void {
    this.cue("chime");
  }

  private lastCue = -Infinity;
  private lastCueRank = 0;

  /**
   * A milestone's little tune (CUES), not in the scene. A burst of them (a town grows and ticks a goal at once) plays
   * one: within CUE_GAP_MS of a cue only a bigger one is heard. Returns whether it played.
   */
  cue(kind: CueKind): boolean {
    const ctx = this.ctx;
    if (!ctx || !this.master || this.muted) return false;
    const { rank, wave, notes, vol } = CUES[kind];
    const now = performance.now();
    if (now - this.lastCue < CUE_GAP_MS && rank <= this.lastCueRank) return false;
    this.lastCue = now;
    this.lastCueRank = rank;
    const end = notes[notes.length - 1][1];
    this.wake(end * 1000 + 900);
    const t = this.startTime(ctx);
    notes.forEach(([semis, at], k) => {
      const f = 523.25 * 2 ** (semis / 12);
      // The last note rings on.
      const decay = k === notes.length - 1 ? 0.9 : 0.5;
      // A mallet: the note, and (for a wooden bar) its bright fourth partial dying fast.
      for (const [ratio, v, d] of wave === "mallet" ? ([[1, 1, decay], [3.9, 0.25, 0.08]] as const) : ([[1, 1, decay]] as const)) {
        const osc = ctx.createOscillator();
        osc.type = wave === "mallet" ? "sine" : "triangle";
        osc.frequency.value = f * ratio;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t + at);
        g.gain.linearRampToValueAtTime(vol * v, t + at + 0.006);
        g.gain.exponentialRampToValueAtTime(0.0001, t + at + d);
        osc.connect(g).connect(this.master!);
        osc.start(t + at);
        osc.stop(t + at + d + 0.05);
      }
    });
    return true;
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
    const osc = ctx.createOscillator();
    if (!this.voice(osc)) return;
    this.wake(560);
    const t = this.startTime(ctx);
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
    this.wake(1600);
    const t = this.startTime(ctx);
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
    this.wake(1400);
    const t = this.startTime(ctx);
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

  /** A struck bit of metal: a short sine ping with an inharmonic overtone (a coin, a tool). */
  private ping(freq: number, volume: number, decay: number, pan: number, delay = 0): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || this.muted || volume <= 0.001) return;
    const first = ctx.createOscillator();
    if (!this.voice(first)) return;
    this.wake(delay * 1000 + decay * 1000 + 60);
    const t = this.startTime(ctx) + delay;
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    panner.connect(this.master);
    for (const [ratio, v] of [[1, 1], [2.76, 0.3]] as const) {
      const osc = ratio === 1 ? first : ctx.createOscillator();
      osc.frequency.value = freq * ratio;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(volume * v, t + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0001, t + decay / ratio);
      osc.connect(g).connect(panner);
      osc.start(t);
      osc.stop(t + decay / ratio + 0.02);
    }
  }

  /**
   * A crane moving one unit of `cargo` on or off a wagon, by what it is: wood knocks hollow, stone, coal and ore
   * crunch, sacks of grain or flour thump softly, iron and tools clink. A load going on sits a little higher than one
   * coming off. `volume` and `pan` as `listen` hears the depot.
   */
  goods(cargo: CargoKind, loaded: boolean, volume: number, pan: number): void {
    if (this.muted || volume <= 0.02) return;
    const up = loaded ? 1.12 : 1;
    switch (cargo) {
      case "log":
      case "planks":
      case "furniture":
        this.knock(volume * 0.6, this.vary(cargo === "log" ? 150 : 210) * up, 0.16, pan);
        this.knock(volume * 0.22, this.vary(420) * up, 0.05, pan);
        break;
      case "stone":
      case "coal":
      case "ore":
        // Gravel: a dull thud under a few quick grains.
        this.knock(volume * 0.4, this.vary(120) * up, 0.1, pan);
        for (let i = 0; i < 3; i++) setTimeout(() => this.knock(volume * 0.16, this.vary(1600) * up, 0.025, pan), 15 + i * 22 + Math.random() * 10);
        break;
      case "grain":
      case "flour":
        this.knock(volume * 0.38, this.vary(180) * up, 0.12, pan);
        break;
      case "iron":
      case "tools":
        this.knock(volume * 0.35, this.vary(200) * up, 0.08, pan);
        this.ping(this.vary(cargo === "iron" ? 1400 : 2100) * up, volume * 0.05, 0.25, pan, 0.02);
        break;
    }
  }

  private coinGate = new Gate(COIN_GAP_MS);

  /** Coins earned (a delivery paid): a little two-note clink, at most once every COIN_GAP_MS. Returns whether it played. */
  coins(volume: number, pan: number): boolean {
    if (this.muted || volume <= 0.02 || !this.ctx || !this.coinGate.open(performance.now())) return false;
    const f = this.vary(2093);
    this.ping(f, volume * 0.06, 0.35, pan);
    this.ping(f * 1.26, volume * 0.05, 0.45, pan, 0.075);
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
    this.wake(400);
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
    const target = this.muted ? 0 : Math.min(1, Math.max(0, level)) * 0.045;
    // (Called each frame trains run: a level that's hardly changed, or silence that's already silent, does nothing.)
    if (!ctx || !this.master || target === this.humLevel || (target > 0 && Math.abs(target - this.humLevel) < 0.0005) || (!this.hum && target === 0)) return;
    this.humLevel = target;
    this.wake(600);
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
    this.hum.gain.gain.setTargetAtTime(target, ctx.currentTime, 0.15);
  }
}
