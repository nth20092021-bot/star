import { cosmicEventBus } from '../shared/CosmicEventBus';
import type { StarLinkedPayload } from '../shared/CosmicTypes';
import { clamp } from './GraphicsUtils';

const MUTE_STORAGE_KEY = 'celestial-sound-muted';
const MASTER_VOLUME = 0.62;
const PENTATONIC = [0, 2, 4, 7, 9, 12, 14, 16] as const;
const WINNER_CHORDS: readonly (readonly number[])[] = [
  [293.66, 440.0, 587.33, 880.0],
  [261.63, 392.0, 523.25, 783.99],
  [220.0, 329.63, 440.0, 659.25],
  [196.0, 293.66, 392.0, 587.33],
];

/**
 * 🎧 CosmicAudioEngine — DeepSeek (/src/graphics)
 *
 * Toàn bộ âm thanh được tổng hợp thủ công bằng Web Audio API, không dùng file
 * ngoài: tiếng gió sao nền, tiếng nạp năng lượng 2 giây, cú phóng sao chổi,
 * chuông pentatonic lệch trái/phải theo vị trí ngôi sao, nhịp tim ở ngôi áp
 * chót, tiếng nén – nổ supernova và hợp âm vàng kim khi bảng tên hiện ra.
 *
 * AudioContext chỉ được tạo trong cử chỉ người dùng (pointerdown / keydown)
 * để tuân thủ chính sách autoplay của trình duyệt. Trạng thái tắt tiếng được
 * ghi nhớ trong localStorage.
 */
export class CosmicAudioEngine {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private fxBus: GainNode | null = null;
  private reverbSend: GainNode | null = null;
  private reverbReturn: GainNode | null = null;
  private convolver: ConvolverNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  private readonly activeSources = new Set<AudioScheduledSourceNode>();
  private readonly persistentSources = new Set<AudioScheduledSourceNode>();
  private readonly unsubscribers: Array<() => void> = [];

  private attached = false;
  private muted = false;
  private ambientStarted = false;
  private lastResetAt = -1;

  private readonly handleGesture = (): void => {
    this.ensureStarted();
  };

  constructor() {
    this.muted = this.readMutedPreference();
  }

  /* ================================================================== */
  /* Vòng đời                                                           */
  /* ================================================================== */

  /** Gắn lắng nghe sự kiện kịch bản + cử chỉ người dùng. */
  public attach(): void {
    if (this.attached) return;
    this.attached = true;

    window.addEventListener('pointerdown', this.handleGesture, {
      capture: true,
      passive: true,
    });
    window.addEventListener('keydown', this.handleGesture, {
      capture: true,
      passive: true,
    });

    this.unsubscribers.push(
      cosmicEventBus.on('WEAVE_START', () => this.playWeaveStart()),
      cosmicEventBus.on('STAR_LINKED', (payload) => this.playStarLink(payload)),
      cosmicEventBus.on('STAR_LOCKED_SUPERNOVA', ({ winnerStar }) =>
        this.playSupernova(winnerStar.id)
      ),
      cosmicEventBus.on('CAMERA_RESET', () => this.reset())
    );
  }

  public isMuted(): boolean {
    return this.muted;
  }

  /** Đảo trạng thái tắt tiếng, trả về trạng thái mới. */
  public toggleMute(): boolean {
    this.setMuted(!this.muted);
    if (!this.muted) {
      this.ensureStarted();
    }
    return this.muted;
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    this.writeMutedPreference(muted);

    const ctx = this.context;
    const master = this.master;
    if (!ctx || !master) return;

    const now = ctx.currentTime;
    const target = muted ? 0.0001 : MASTER_VOLUME;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(Math.max(0.0001, master.gain.value), now);
    master.gain.exponentialRampToValueAtTime(target, now + 0.18);
  }

  /**
   * Dừng toàn bộ hiệu ứng một lần (chuông, riser, vụ nổ) nhưng giữ tiếng nền,
   * dùng khi người dùng đặt lại / bấm Tiếp theo.
   */
  public reset(): void {
    const ctx = this.context;
    const fxBus = this.fxBus;
    if (!ctx || !fxBus) return;

    const now = ctx.currentTime;
    if (this.lastResetAt >= 0 && now - this.lastResetAt < 0.05) return;
    this.lastResetAt = now;

    fxBus.gain.cancelScheduledValues(now);
    fxBus.gain.setValueAtTime(Math.max(0.0001, fxBus.gain.value), now);
    fxBus.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
    fxBus.gain.setValueAtTime(0.0001, now + 0.12);
    fxBus.gain.exponentialRampToValueAtTime(1, now + 0.3);

    for (const source of Array.from(this.activeSources)) {
      try {
        source.stop(now + 0.1);
      } catch {
        // Nguồn đã kết thúc tự nhiên.
      }
    }
  }

  public dispose(): void {
    for (const unsub of this.unsubscribers) {
      unsub();
    }
    this.unsubscribers.length = 0;

    window.removeEventListener('pointerdown', this.handleGesture, { capture: true });
    window.removeEventListener('keydown', this.handleGesture, { capture: true });
    this.attached = false;

    for (const source of [...this.activeSources, ...this.persistentSources]) {
      try {
        source.stop();
      } catch {
        // Đã dừng.
      }
      try {
        source.disconnect();
      } catch {
        // Đã ngắt kết nối.
      }
    }
    this.activeSources.clear();
    this.persistentSources.clear();

    const ctx = this.context;
    const graphNodes = [
      this.master,
      this.fxBus,
      this.reverbSend,
      this.reverbReturn,
      this.convolver,
      this.compressor,
    ];

    this.context = null;
    this.master = null;
    this.fxBus = null;
    this.reverbSend = null;
    this.reverbReturn = null;
    this.convolver = null;
    this.compressor = null;
    this.noiseBuffer = null;
    this.ambientStarted = false;

    for (const node of graphNodes) {
      try {
        node?.disconnect();
      } catch {
        // Bỏ qua lỗi ngắt kết nối khi đóng.
      }
    }

    if (ctx && ctx.state !== 'closed') {
      void ctx.close().catch(() => undefined);
    }
  }

  /* ================================================================== */
  /* Đồ thị âm thanh                                                    */
  /* ================================================================== */

  private ensureStarted(): AudioContext | null {
    if (this.context) {
      if (this.context.state === 'suspended') {
        void this.context.resume().catch(() => undefined);
      }
      return this.context;
    }

    if (typeof window === 'undefined') return null;

    const AudioCtor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtor) return null;

    let ctx: AudioContext;
    try {
      ctx = new AudioCtor({ latencyHint: 'interactive' });
    } catch {
      return null;
    }
    this.context = ctx;

    const master = ctx.createGain();
    master.gain.value = this.muted ? 0.0001 : MASTER_VOLUME;

    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.knee.value = 22;
    compressor.ratio.value = 3.2;
    compressor.attack.value = 0.006;
    compressor.release.value = 0.28;

    master.connect(compressor);
    compressor.connect(ctx.destination);
    this.master = master;
    this.compressor = compressor;

    const fxBus = ctx.createGain();
    fxBus.gain.value = 1;
    fxBus.connect(master);
    this.fxBus = fxBus;

    const convolver = ctx.createConvolver();
    convolver.buffer = this.createReverbImpulse(ctx);

    const reverbReturn = ctx.createGain();
    reverbReturn.gain.value = 0.5;
    convolver.connect(reverbReturn);
    reverbReturn.connect(master);

    const reverbSend = ctx.createGain();
    reverbSend.gain.value = 0.32;
    reverbSend.connect(convolver);

    this.convolver = convolver;
    this.reverbReturn = reverbReturn;
    this.reverbSend = reverbSend;

    this.noiseBuffer = this.createNoiseBuffer(ctx);
    this.startAmbient(ctx);

    void ctx.resume().catch(() => undefined);
    return ctx;
  }

  private startAmbient(ctx: AudioContext): void {
    if (this.ambientStarted || !this.master || !this.noiseBuffer) return;
    this.ambientStarted = true;

    const bus = ctx.createGain();
    bus.gain.value = 0.42;
    bus.connect(this.master);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 300;
    filter.Q.value = 0.7;
    filter.connect(bus);

    const drone = ctx.createGain();
    drone.gain.setValueAtTime(0.0001, ctx.currentTime);
    drone.gain.linearRampToValueAtTime(1, ctx.currentTime + 3.2);
    drone.connect(filter);

    const voices: ReadonlyArray<{
      type: OscillatorType;
      freq: number;
      gain: number;
      detune: number;
    }> = [
      { type: 'sine', freq: 55, gain: 0.16, detune: -4 },
      { type: 'triangle', freq: 82.41, gain: 0.075, detune: 5 },
      { type: 'sine', freq: 110, gain: 0.05, detune: -7 },
      { type: 'sine', freq: 164.81, gain: 0.018, detune: 3 },
    ];

    for (const voice of voices) {
      const osc = ctx.createOscillator();
      osc.type = voice.type;
      osc.frequency.value = voice.freq;
      osc.detune.value = voice.detune;

      const gain = ctx.createGain();
      gain.gain.value = voice.gain;

      osc.connect(gain);
      gain.connect(drone);
      osc.start();
      this.persistentSources.add(osc);
    }

    // Gió sao rất nhẹ, lặp vô hạn trên nền nhiễu đã tạo.
    const wind = ctx.createBufferSource();
    wind.buffer = this.noiseBuffer;
    wind.loop = true;

    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.value = 480;
    windFilter.Q.value = 0.9;

    const windGain = ctx.createGain();
    windGain.gain.value = 0.02;

    wind.connect(windFilter);
    windFilter.connect(windGain);
    windGain.connect(bus);
    wind.start();
    this.persistentSources.add(wind);

    // Các LFO chậm làm đài thiên văn "thở".
    const droneLfo = ctx.createOscillator();
    droneLfo.frequency.value = 0.031;
    const droneLfoGain = ctx.createGain();
    droneLfoGain.gain.value = 0.2;
    droneLfo.connect(droneLfoGain);
    droneLfoGain.connect(drone.gain);
    droneLfo.start();
    this.persistentSources.add(droneLfo);

    const filterLfo = ctx.createOscillator();
    filterLfo.frequency.value = 0.045;
    const filterLfoGain = ctx.createGain();
    filterLfoGain.gain.value = 110;
    filterLfo.connect(filterLfoGain);
    filterLfoGain.connect(filter.frequency);
    filterLfo.start();
    this.persistentSources.add(filterLfo);

    const windLfo = ctx.createOscillator();
    windLfo.frequency.value = 0.055;
    const windLfoGain = ctx.createGain();
    windLfoGain.gain.value = 0.008;
    windLfo.connect(windLfoGain);
    windLfoGain.connect(windGain.gain);
    windLfo.start();
    this.persistentSources.add(windLfo);
  }

  private createNoiseBuffer(ctx: AudioContext): AudioBuffer {
    const length = Math.floor(ctx.sampleRate * 4);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  private createReverbImpulse(ctx: AudioContext): AudioBuffer {
    const duration = 2.8;
    const length = Math.floor(ctx.sampleRate * duration);
    const impulse = ctx.createBuffer(2, length, ctx.sampleRate);

    for (let channel = 0; channel < 2; channel += 1) {
      const data = impulse.getChannelData(channel);
      for (let i = 0; i < length; i += 1) {
        const t = i / length;
        const fade = Math.pow(1 - t, 2.7);
        const onset = Math.min(1, i / (ctx.sampleRate * 0.012));
        data[i] = (Math.random() * 2 - 1) * fade * onset;
      }
    }

    return impulse;
  }

  /* ================================================================== */
  /* Sự kiện kịch bản                                                   */
  /* ================================================================== */

  private playWeaveStart(): void {
    if (this.muted) return;
    const ctx = this.ensureStarted();
    if (!ctx) return;

    const now = ctx.currentTime + 0.02;
    const launch = now + 2.0;

    // 2 giây nạp năng lượng tại quả cầu trung tâm.
    this.tone({
      when: now,
      type: 'sawtooth',
      freqStart: 132,
      freqEnd: 760,
      duration: 1.98,
      peak: 0.055,
      attack: 1.72,
      pan: -0.18,
      filter: { type: 'lowpass', start: 280, end: 2600, q: 1.1 },
    });
    this.tone({
      when: now,
      type: 'sawtooth',
      freqStart: 132.6,
      freqEnd: 764,
      duration: 1.98,
      peak: 0.045,
      attack: 1.72,
      pan: 0.2,
      filter: { type: 'lowpass', start: 300, end: 2800, q: 1.1 },
    });
    this.tone({
      when: now,
      type: 'sine',
      freqStart: 48,
      freqEnd: 74,
      duration: 2.0,
      peak: 0.07,
      attack: 1.7,
      pan: 0,
    });
    this.noiseBurst({
      when: now,
      duration: 2.0,
      peak: 0.05,
      attack: 1.6,
      pan: 0,
      filter: { type: 'bandpass', start: 320, end: 2600, q: 0.9 },
    });

    // Nhịp sáng dồn dập báo hiệu thời khắc phóng.
    const ticks = [0.36, 0.78, 1.18, 1.52, 1.8];
    ticks.forEach((offset, index) => {
      this.bell(
        now + offset,
        659.25 * Math.pow(2, index / 12),
        0.022,
        index % 2 === 0 ? -0.35 : 0.35,
        0.22
      );
    });

    // Đúng 2.0s: sao chổi rời quả cầu.
    this.noiseBurst({
      when: launch,
      duration: 1.0,
      peak: 0.16,
      attack: 0.014,
      pan: 0,
      filter: { type: 'bandpass', start: 2400, end: 220, q: 1.0 },
    });
    this.tone({
      when: launch,
      type: 'sine',
      freqStart: 118,
      freqEnd: 32,
      duration: 0.9,
      peak: 0.32,
      attack: 0.01,
      pan: 0,
    });
    this.tone({
      when: launch,
      type: 'triangle',
      freqStart: 520,
      freqEnd: 180,
      duration: 0.6,
      peak: 0.05,
      attack: 0.008,
      pan: -0.25,
    });
    this.bell(launch + 0.02, 1318.51, 0.035, 0.3, 0.7);
  }

  private playStarLink(payload: StarLinkedPayload): void {
    if (this.muted) return;
    const ctx = this.ensureStarted();
    if (!ctx) return;

    const now = ctx.currentTime + 0.01;
    const pan = clamp(payload.position.x / 30, -0.85, 0.85);
    const step = payload.stepIndex;

    // Ngôi chiến thắng do supernova đảm nhận.
    if (step >= 17) return;

    // Ngôi áp chót: nhịp tim + hơi thở nén cho cú lao cuối.
    if (step === 16) {
      this.playHeartbeat(now);
      return;
    }

    // Ngôi mở màn Act 3: chuông trầm ấm hơn.
    if (step === 15) {
      this.bell(now, 880, 0.1, pan, 1.5);
      this.bell(now + 0.07, 1318.51, 0.055, -pan * 0.6, 1.2);
      return;
    }

    const index = (step - 1) % PENTATONIC.length;
    const octave = Math.floor((step - 1) / PENTATONIC.length);
    const semitones = PENTATONIC[index] + octave * 12;
    const freq = 523.25 * Math.pow(2, semitones / 12);
    const peak = 0.1 + Math.min(step, 14) * 0.002;

    this.bell(now, freq, peak, pan, 0.85 + Math.min(step, 14) * 0.02);
  }

  private playHeartbeat(when: number): void {
    this.tone({
      when,
      type: 'sine',
      freqStart: 68,
      freqEnd: 48,
      duration: 0.32,
      peak: 0.26,
      attack: 0.012,
      pan: 0,
    });
    this.tone({
      when: when + 0.26,
      type: 'sine',
      freqStart: 58,
      freqEnd: 40,
      duration: 0.4,
      peak: 0.2,
      attack: 0.012,
      pan: 0,
    });

    this.noiseBurst({
      when: when + 0.12,
      duration: 1.35,
      peak: 0.045,
      attack: 1.0,
      pan: 0,
      filter: { type: 'bandpass', start: 320, end: 2400, q: 1.1 },
    });
    this.tone({
      when: when + 0.2,
      type: 'sawtooth',
      freqStart: 110,
      freqEnd: 420,
      duration: 1.25,
      peak: 0.028,
      attack: 1.0,
      pan: 0.2,
      filter: { type: 'lowpass', start: 400, end: 2200, q: 0.7 },
    });
  }

  private playSupernova(winnerId: number): void {
    if (this.muted) return;
    const ctx = this.ensureStarted();
    if (!ctx) return;

    const now = ctx.currentTime + 0.01;
    const burst = now + 0.5;
    const chord = WINNER_CHORDS[Math.abs(winnerId) % WINNER_CHORDS.length];

    // 0 → 0.5s: nén năng lượng.
    this.tone({
      when: now,
      type: 'sine',
      freqStart: 130,
      freqEnd: 32,
      duration: 0.52,
      peak: 0.2,
      attack: 0.42,
      pan: 0,
    });
    this.noiseBurst({
      when: now,
      duration: 0.5,
      peak: 0.09,
      attack: 0.42,
      pan: 0,
      filter: { type: 'highpass', start: 220, end: 3200, q: 0.9 },
    });
    this.tone({
      when: now,
      type: 'triangle',
      freqStart: 220,
      freqEnd: 90,
      duration: 0.5,
      peak: 0.06,
      attack: 0.4,
      pan: -0.2,
      filter: { type: 'lowpass', start: 900, end: 300, q: 0.7 },
    });

    // 0.5s: vụ nổ và sóng xung kích.
    this.tone({
      when: burst,
      type: 'sine',
      freqStart: 92,
      freqEnd: 28,
      duration: 1.5,
      peak: 0.46,
      attack: 0.012,
      pan: 0,
    });
    this.noiseBurst({
      when: burst,
      duration: 1.6,
      peak: 0.3,
      attack: 0.012,
      pan: 0,
      filter: { type: 'lowpass', start: 2600, end: 150, q: 0.8 },
    });
    this.noiseBurst({
      when: burst + 0.012,
      duration: 1.3,
      peak: 0.16,
      attack: 0.02,
      pan: -0.5,
      filter: { type: 'lowpass', start: 1800, end: 120, q: 0.7 },
    });
    this.noiseBurst({
      when: burst + 0.02,
      duration: 1.25,
      peak: 0.16,
      attack: 0.02,
      pan: 0.5,
      filter: { type: 'lowpass', start: 2200, end: 140, q: 0.7 },
    });
    this.noiseBurst({
      when: burst,
      duration: 0.16,
      peak: 0.18,
      attack: 0.004,
      pan: 0.2,
      filter: { type: 'highpass', start: 3200, end: 6800, q: 0.8 },
    });
    this.noiseBurst({
      when: burst,
      duration: 0.4,
      peak: 0.12,
      attack: 0.02,
      pan: 0,
      filter: { type: 'lowpass', start: 160, end: 80, q: 0.6 },
    });

    // Hợp âm vàng kim lan tỏa.
    const chordPans = [-0.42, 0.3, -0.12, 0.48];
    chord.forEach((freq, index) => {
      this.bell(burst + 0.03 + index * 0.05, freq, 0.07, chordPans[index], 2.1);
      this.bell(
        burst + 0.03 + index * 0.05,
        freq * 2,
        0.03,
        chordPans[index],
        1.4
      );
    });
    this.bell(burst + 0.2, 1567.98, 0.035, 0.6, 1.2);
    this.bell(burst + 0.32, 2093, 0.028, -0.55, 1.0);
    this.bell(burst + 0.44, 2637.02, 0.022, 0.1, 0.9);

    // Bảng tên học sinh trượt vào giữa khung hình.
    const plaque = now + 0.66;
    this.bell(plaque, 1046.5, 0.05, 0, 1.6);

    const padPans = [-0.2, 0.15, 0.32];
    for (let index = 0; index < 3; index += 1) {
      this.tone({
        when: plaque,
        type: 'sine',
        freqStart: chord[index] / 2,
        duration: 2.6,
        peak: 0.035,
        attack: 0.45,
        pan: padPans[index],
        filter: { type: 'lowpass', start: 1400, end: 600, q: 0.6 },
      });
    }
    this.noiseBurst({
      when: plaque,
      duration: 1.6,
      peak: 0.02,
      attack: 0.5,
      pan: 0,
      filter: { type: 'bandpass', start: 700, end: 2400, q: 0.7 },
    });
  }

  /* ================================================================== */
  /* Tổng hợp cơ bản                                                    */
  /* ================================================================== */

  private tone(options: {
    when: number;
    type: OscillatorType;
    freqStart: number;
    freqEnd?: number;
    duration: number;
    peak: number;
    attack?: number;
    pan?: number;
    filter?: {
      type: BiquadFilterType;
      start: number;
      end: number;
      q?: number;
    };
  }): void {
    const ctx = this.context;
    if (!ctx) return;

    const output = this.createOutput(options.pan ?? 0);
    if (!output) return;

    const attack = options.attack ?? 0.01;
    const decay = Math.max(0.05, options.duration - attack);

    const env = ctx.createGain();
    this.envelope(env.gain, options.when, options.peak, attack, decay);
    env.connect(output);

    const osc = ctx.createOscillator();
    osc.type = options.type;
    osc.frequency.setValueAtTime(Math.max(18, options.freqStart), options.when);
    if (options.freqEnd !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(
        Math.max(18, options.freqEnd),
        options.when + options.duration
      );
    }

    let tail: AudioNode = env;
    let filterNode: BiquadFilterNode | null = null;
    if (options.filter) {
      filterNode = ctx.createBiquadFilter();
      filterNode.type = options.filter.type;
      filterNode.frequency.setValueAtTime(
        Math.max(20, options.filter.start),
        options.when
      );
      filterNode.frequency.exponentialRampToValueAtTime(
        Math.max(20, options.filter.end),
        options.when + options.duration
      );
      filterNode.Q.value = options.filter.q ?? 0.8;
      filterNode.connect(env);
      tail = filterNode;
    }

    osc.connect(tail);
    osc.start(options.when);
    osc.stop(options.when + options.duration + 0.06);

    this.register(
      osc,
      filterNode ? [env, output, filterNode] : [env, output]
    );
  }

  private noiseBurst(options: {
    when: number;
    duration: number;
    peak: number;
    attack?: number;
    pan?: number;
    filter?: {
      type: BiquadFilterType;
      start: number;
      end: number;
      q?: number;
    };
  }): void {
    const ctx = this.context;
    if (!ctx || !this.noiseBuffer) return;

    const output = this.createOutput(options.pan ?? 0);
    if (!output) return;

    const attack = options.attack ?? 0.01;
    const decay = Math.max(0.05, options.duration - attack);

    const env = ctx.createGain();
    this.envelope(env.gain, options.when, options.peak, attack, decay);
    env.connect(output);

    const source = ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    source.loop = true;

    let tail: AudioNode = env;
    let filterNode: BiquadFilterNode | null = null;
    if (options.filter) {
      filterNode = ctx.createBiquadFilter();
      filterNode.type = options.filter.type;
      filterNode.frequency.setValueAtTime(
        Math.max(20, options.filter.start),
        options.when
      );
      filterNode.frequency.exponentialRampToValueAtTime(
        Math.max(20, options.filter.end),
        options.when + options.duration
      );
      filterNode.Q.value = options.filter.q ?? 0.8;
      filterNode.connect(env);
      tail = filterNode;
    }

    source.connect(tail);
    source.start(options.when, Math.random() * 2);
    source.stop(options.when + options.duration + 0.06);

    this.register(
      source,
      filterNode ? [env, output, filterNode] : [env, output]
    );
  }

  private bell(
    when: number,
    freq: number,
    peak: number,
    pan: number,
    decay: number
  ): void {
    const ctx = this.context;
    if (!ctx) return;

    const partials: ReadonlyArray<{
      ratio: number;
      weight: number;
      decayScale: number;
      detune: number;
      type: OscillatorType;
    }> = [
      { ratio: 1, weight: 0.72, decayScale: 1, detune: 0, type: 'sine' },
      { ratio: 2.004, weight: 0.26, decayScale: 0.66, detune: 4, type: 'sine' },
      { ratio: 3.01, weight: 0.1, decayScale: 0.45, detune: -5, type: 'triangle' },
    ];

    for (const partial of partials) {
      const output = this.createOutput(pan);
      if (!output) return;

      const partialDecay = Math.max(0.18, decay * partial.decayScale);
      const env = ctx.createGain();
      this.envelope(
        env.gain,
        when,
        Math.max(0.0002, peak * partial.weight),
        0.006,
        partialDecay
      );
      env.connect(output);

      const osc = ctx.createOscillator();
      osc.type = partial.type;
      osc.frequency.value = freq * partial.ratio;
      osc.detune.value = partial.detune;
      osc.connect(env);
      osc.start(when);
      osc.stop(when + partialDecay + 0.1);

      this.register(osc, [env, output]);
    }
  }

  private createOutput(pan: number): StereoPannerNode | null {
    const ctx = this.context;
    if (!ctx || !this.fxBus) return null;

    const panner = ctx.createStereoPanner();
    panner.pan.value = clamp(pan, -1, 1);
    panner.connect(this.fxBus);
    if (this.reverbSend) {
      panner.connect(this.reverbSend);
    }
    return panner;
  }

  private envelope(
    param: AudioParam,
    when: number,
    peak: number,
    attack: number,
    decay: number
  ): void {
    const safeAttack = Math.max(0.004, attack);
    const safePeak = Math.max(0.0001, peak);
    param.setValueAtTime(0.0001, when);
    param.exponentialRampToValueAtTime(safePeak, when + safeAttack);
    param.exponentialRampToValueAtTime(0.0001, when + safeAttack + decay);
  }

  private register(
    source: AudioScheduledSourceNode,
    nodes: readonly AudioNode[]
  ): void {
    this.activeSources.add(source);
    source.onended = () => {
      this.activeSources.delete(source);
      try {
        source.disconnect();
      } catch {
        // Đã ngắt kết nối.
      }
      for (const node of nodes) {
        try {
          node.disconnect();
        } catch {
          // Đã ngắt kết nối.
        }
      }
    };
  }

  /* ================================================================== */
  /* Lưu trạng thái tắt tiếng                                           */
  /* ================================================================== */

  private readMutedPreference(): boolean {
    if (typeof window === 'undefined') return false;
    try {
      return window.localStorage.getItem(MUTE_STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  }

  private writeMutedPreference(muted: boolean): void {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(MUTE_STORAGE_KEY, muted ? '1' : '0');
    } catch {
      // localStorage có thể bị chặn ở chế độ riêng tư.
    }
  }
}
