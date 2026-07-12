/**
 * Web Audio graph that powers the music player's "Sound tuning" panel.
 *
 * The graph wraps a single `<audio>` element via a `MediaElementAudioSource`
 * (which may only be created ONCE per element) and routes it through a real
 * processing chain so the EQ and tone controls actually shape the sound:
 *
 *   source -> preamp -> [10 peaking bands] -> bass(lowshelf) -> treble(highshelf)
 *          -> voice(peaking) -> compressor -> { dry, wet->reverb } -> destination
 *
 * At default settings every stage is transparent (0 dB gains, ratio 1, wet 0),
 * so the output is a clean pass-through — important because a same-origin blob
 * source means this graph carries the *only* audio path once it's built.
 *
 * Building requires a live `AudioContext`, which browsers only allow to start
 * from a user gesture; callers build it lazily on the first play() and we
 * degrade gracefully (element plays directly) if Web Audio is unavailable.
 *
 * The visualizer reads from an AnalyserNode in the same chain, and the
 * Surround/Sound Stage controls add a subtle delayed width branch. They are
 * intentionally conservative so the default curve stays musical.
 */

import { DEFAULT_EQ_VALUES } from "./music-player";

export interface AudioControls {
  bass: number;
  treble: number;
  voiceClarity: number;
  surround: boolean;
  stabilizer: boolean;
  reverb: number;
  soundStage: number;
}

const BAND_FREQUENCIES = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

const DEFAULT_CONTROLS: AudioControls = {
  bass: 0,
  treble: 0,
  voiceClarity: 0,
  surround: false,
  stabilizer: false,
  reverb: 0,
  soundStage: 5,
};

export class MusicAudioGraph {
  private ctx: AudioContext | null = null;
  private source: MediaElementAudioSourceNode | null = null;
  private preamp: GainNode | null = null;
  private bands: BiquadFilterNode[] = [];
  private bass: BiquadFilterNode | null = null;
  private treble: BiquadFilterNode | null = null;
  private voice: BiquadFilterNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private analyser: AnalyserNode | null = null;
  private dry: GainNode | null = null;
  private wet: GainNode | null = null;
  private widthDelay: DelayNode | null = null;
  private widthGain: GainNode | null = null;
  private frequencyData: Uint8Array<ArrayBuffer> | null = null;

  private built = false;
  private failed = false;

  // Desired state captured before the graph exists, applied on build().
  private desiredBands: number[] = [...DEFAULT_EQ_VALUES];
  private desiredControls: AudioControls = { ...DEFAULT_CONTROLS };
  private preferredSampleRate: number | null = null;

  constructor(private readonly el: HTMLAudioElement) {}

  /** True once the Web Audio chain is live (EQ is actually affecting sound). */
  get active(): boolean {
    return this.built && !this.failed;
  }

  /** AudioContext sample rate once built, or `null` before the first `ensure()`. */
  get sampleRate(): number | null {
    return this.ctx?.sampleRate ?? null;
  }

  /** Underlying AudioContext, e.g. for output-device routing once built. */
  get audioContext(): AudioContext | null {
    return this.ctx;
  }

  /**
   * Requests a sample rate for the AudioContext created by the next
   * `build()`. `createMediaElementSource` (in `build()`) is a one-way door —
   * once built, the context can't be swapped without permanently silencing
   * the element — so this only takes effect if called before the first
   * `ensure()` succeeds. Harmless no-op afterward.
   */
  setPreferredSampleRate(rate: number | null | undefined): void {
    this.preferredSampleRate = rate && Number.isFinite(rate) && rate > 0 ? rate : null;
  }

  /**
   * Build + resume the graph. Call from within a user gesture (e.g. the play
   * handler). Returns false when Web Audio is unavailable — the caller should
   * just let the element play natively in that case.
   */
  async ensure(): Promise<boolean> {
    if (this.failed) return false;
    if (!this.built) {
      try {
        this.build();
        this.built = true;
      } catch (err) {
        this.failed = true;
        this.dispose();
        console.warn(
          "[nyrima:audio] EQ graph unavailable; playing element directly",
          err,
        );
        return false;
      }
    }
    try {
      if (this.ctx && this.ctx.state === "suspended") await this.ctx.resume();
    } catch (err) {
      this.failed = true;
      this.dispose();
      console.warn(
        "[nyrima:audio] EQ graph could not resume; playing element directly",
        err,
      );
      return false;
      /* resume can reject if no gesture yet — harmless, retried next play */
    }
    if (this.ctx && this.ctx.state !== "running") {
      const state = this.ctx.state;
      this.failed = true;
      this.dispose();
      console.warn(
        `[nyrima:audio] EQ graph stayed ${state}; playing element directly`,
      );
      return false;
    }
    return true;
  }

  private build(): void {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) throw new Error("Web Audio API unsupported");

    const ctx = new Ctor(
      this.preferredSampleRate ? { sampleRate: this.preferredSampleRate } : undefined,
    );
    this.ctx = ctx;

    const source = ctx.createMediaElementSource(this.el);
    this.source = source;

    const preamp = ctx.createGain();
    preamp.gain.value = 1;
    this.preamp = preamp;

    this.bands = BAND_FREQUENCIES.map((freq) => {
      const filter = ctx.createBiquadFilter();
      filter.type = "peaking";
      filter.frequency.value = freq;
      filter.Q.value = 1.0;
      filter.gain.value = 0;
      return filter;
    });

    const bass = ctx.createBiquadFilter();
    bass.type = "lowshelf";
    bass.frequency.value = 110;
    bass.gain.value = 0;
    this.bass = bass;

    const treble = ctx.createBiquadFilter();
    treble.type = "highshelf";
    treble.frequency.value = 6000;
    treble.gain.value = 0;
    this.treble = treble;

    const voice = ctx.createBiquadFilter();
    voice.type = "peaking";
    voice.frequency.value = 3000;
    voice.Q.value = 1.2;
    voice.gain.value = 0;
    this.voice = voice;

    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = 0;
    compressor.knee.value = 24;
    compressor.ratio.value = 1;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.25;
    this.compressor = compressor;

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.76;
    this.analyser = analyser;

    const convolver = ctx.createConvolver();
    convolver.buffer = makeImpulseResponse(ctx, 2.2, 2.4);

    const dry = ctx.createGain();
    dry.gain.value = 1;
    this.dry = dry;

    const wet = ctx.createGain();
    wet.gain.value = 0;
    this.wet = wet;

    const widthDelay = ctx.createDelay(0.04);
    widthDelay.delayTime.value = 0.012;
    this.widthDelay = widthDelay;

    const widthGain = ctx.createGain();
    widthGain.gain.value = 0;
    this.widthGain = widthGain;

    // Serial tone chain.
    let node: AudioNode = source;
    node.connect(preamp);
    node = preamp;
    for (const band of this.bands) {
      node.connect(band);
      node = band;
    }
    node.connect(bass);
    node = bass;
    node.connect(treble);
    node = treble;
    node.connect(voice);
    node = voice;
    node.connect(compressor);
    node = compressor;
    node.connect(analyser);
    node = analyser;

    // Parallel dry / reverb-wet mix into the destination.
    node.connect(dry);
    dry.connect(ctx.destination);
    node.connect(wet);
    wet.connect(convolver);
    convolver.connect(ctx.destination);
    node.connect(widthDelay);
    widthDelay.connect(widthGain);
    widthGain.connect(ctx.destination);

    // Apply anything the user set before the graph existed.
    this.applyBands();
    this.applyControls();
  }

  setEqBands(values: number[]): void {
    this.desiredBands = values.slice(0, BAND_FREQUENCIES.length);
    if (this.built) this.applyBands();
  }

  setControls(controls: AudioControls): void {
    this.desiredControls = controls;
    if (this.built) this.applyControls();
  }

  readWaveformBars(count: number): number[] {
    if (!this.active || !this.analyser || count <= 0) return [];
    const bins = this.analyser.frequencyBinCount;
    if (!this.frequencyData || this.frequencyData.length !== bins) {
      this.frequencyData = new Uint8Array(bins);
    }
    this.analyser.getByteFrequencyData(this.frequencyData);
    return bucketFrequencyData(this.frequencyData, count);
  }

  private applyBands(): void {
    this.bands.forEach((band, i) => {
      band.gain.value = clampDb(this.desiredBands[i] ?? 0);
    });
  }

  private applyControls(): void {
    const c = this.desiredControls;
    if (this.bass) this.bass.gain.value = amount(c.bass) * 9;
    if (this.treble) this.treble.gain.value = amount(c.treble) * 9;
    if (this.voice) this.voice.gain.value = amount(c.voiceClarity) * 6;
    if (this.compressor) {
      this.compressor.ratio.value = c.stabilizer ? 4 : 1;
      this.compressor.threshold.value = c.stabilizer ? -24 : 0;
    }
    if (this.wet) this.wet.gain.value = amount(c.reverb) * 0.5;
    const stageLift = Math.max(0, amount(c.soundStage) - 0.5) * 2;
    if (this.widthDelay) this.widthDelay.delayTime.value = 0.008 + stageLift * 0.014;
    if (this.widthGain) {
      this.widthGain.gain.value = c.surround ? 0.06 + stageLift * 0.12 : stageLift * 0.05;
    }
  }

  dispose(): void {
    const nodes: (AudioNode | null)[] = [
      this.source,
      this.preamp,
      ...this.bands,
      this.bass,
      this.treble,
      this.voice,
      this.compressor,
      this.analyser,
      this.dry,
      this.wet,
      this.widthDelay,
      this.widthGain,
    ];
    for (const node of nodes) {
      try {
        node?.disconnect();
      } catch {
        /* already disconnected */
      }
    }
    try {
      void this.ctx?.close();
    } catch {
      /* already closed */
    }
    this.ctx = null;
    this.built = false;
  }
}

/** Map a 0..10 "amount" slider to a 0..1 multiplier. */
function amount(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value / 10));
}

function clampDb(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(12, Math.max(-12, value));
}

function bucketFrequencyData(data: Uint8Array<ArrayBuffer>, count: number): number[] {
  const usableBins = Math.max(1, Math.floor(data.length * 0.72));
  const bars: number[] = [];

  for (let i = 0; i < count; i++) {
    const fromRatio = i / count;
    const toRatio = (i + 1) / count;
    const start = Math.min(
      usableBins - 1,
      Math.floor(Math.pow(fromRatio, 1.45) * usableBins),
    );
    const end = Math.max(
      start + 1,
      Math.min(usableBins, Math.floor(Math.pow(toRatio, 1.45) * usableBins)),
    );
    let sum = 0;
    for (let bin = start; bin < end; bin++) sum += data[bin] ?? 0;
    const normalized = sum / ((end - start) * 255);
    bars.push(Math.max(0.1, Math.min(1, Math.pow(normalized, 0.72))));
  }

  return bars;
}

/** Procedural exponentially-decaying stereo impulse for the reverb convolver. */
function makeImpulseResponse(
  ctx: AudioContext,
  seconds: number,
  decay: number,
): AudioBuffer {
  const rate = ctx.sampleRate;
  const length = Math.max(1, Math.floor(rate * seconds));
  const buffer = ctx.createBuffer(2, length, rate);
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
  }
  return buffer;
}
