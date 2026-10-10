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

  snap(): void {
    this.knock(0.55, 520, 0.08, 0);
  }

  crash(volume: number, pan: number): void {
    for (let i = 0; i < 5; i++) {
      setTimeout(() => this.knock(volume * (0.9 - i * 0.15), 260 + Math.random() * 500, 0.09, pan + (Math.random() - 0.5) * 0.3), i * 70 + Math.random() * 40);
    }
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
