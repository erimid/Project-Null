/**
 * Sound effects. Each is a few synthesised tones, played when something
 * happens in the game (see events.ts) or when a button is pressed.
 */
import { mostUrgentTrace, traceReport } from '../core';
import { duckMusic, noiseBuffer, output } from './audio';
import type { GameEvent } from './events';
import { traceStage, type TraceStage } from './score';
import { content, session } from './session';

interface Tone {
  /** Pitch in hertz. */
  readonly freq: number;
  /** Seconds after the effect starts. */
  readonly at?: number;
  readonly seconds: number;
  readonly wave?: OscillatorType;
  /** Loudness, 0 to 1. */
  readonly level?: number;
  /** Pitch to glide to by the end. */
  readonly to?: number;
}

/** How loud an ordinary tone is. The trace alarm is louder; ticks and the trace's own beeps are quieter. */
const LEVEL = 0.09;

/**
 * No two plays of an effect are quite the same: each is a hair sharp or
 * flat, a touch louder or softer, and a little to one side. Small enough
 * that a tune stays a tune, enough that a run of beeps doesn't sound stamped.
 */
const PITCH_DRIFT = 0.012;
const LEVEL_DRIFT = 0.16;
const PAN_DRIFT = 0.3;
const drift = (width: number): number => (Math.random() - 0.5) * width;

/** Where one effect plays: the effects bus, by way of its own spot between left and right. */
function spot(ctx: AudioContext, out: AudioNode): AudioNode {
  if (typeof ctx.createStereoPanner !== 'function') return out;
  const pan = ctx.createStereoPanner();
  pan.pan.value = drift(PAN_DRIFT);
  pan.connect(out);
  return pan;
}

function play(tones: readonly Tone[]): void {
  const sink = output();
  if (!sink) return;
  const { ctx } = sink;
  const out = spot(ctx, sink.out);
  const tune = 1 + drift(PITCH_DRIFT);
  const push = 1 + drift(LEVEL_DRIFT);
  for (const tone of tones) {
    const when = ctx.currentTime + (tone.at ?? 0);
    const osc = ctx.createOscillator();
    osc.type = tone.wave ?? 'sine';
    osc.frequency.setValueAtTime(tone.freq * tune, when);
    if (tone.to) osc.frequency.exponentialRampToValueAtTime(tone.to * tune, when + tone.seconds);
    const gain = ctx.createGain();
    const level = (tone.level ?? LEVEL) * push;
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(level, when + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + tone.seconds);
    osc.connect(gain).connect(out);
    osc.start(when);
    osc.stop(when + tone.seconds + 0.02);
  }
}

/** A burst of hiss, for the line going dead. */
function burst(seconds: number, level: number): void {
  const sink = output();
  if (!sink) return;
  const { ctx, out } = sink;
  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer(ctx);
  // Start somewhere new in the hiss each time.
  const from = Math.random() * Math.max(0, source.buffer.duration - seconds);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(level, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + seconds);
  source.connect(gain).connect(out);
  source.start(ctx.currentTime, from);
  source.stop(ctx.currentTime + seconds);
}

/** A shaped rush of air: hiss through a filter that can sweep, for whooshes, wipes and static. */
interface Rush {
  readonly at?: number;
  readonly seconds: number;
  readonly level: number;
  /** Where the filter sits, in hertz, and where it ends up. */
  readonly freq: number;
  readonly to?: number;
  /** How narrow the band is: 1 is broad, 8 whistles. */
  readonly q?: number;
  readonly kind?: BiquadFilterType;
  /** Swell in over this share of the length instead of starting at full. */
  readonly swell?: number;
}

function rush(parts: readonly Rush[]): void {
  const sink = output();
  if (!sink) return;
  const { ctx } = sink;
  const out = spot(ctx, sink.out);
  const push = 1 + drift(LEVEL_DRIFT);
  for (const part of parts) {
    const when = ctx.currentTime + (part.at ?? 0);
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer(ctx);
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = part.kind ?? 'bandpass';
    filter.Q.value = part.q ?? 1.5;
    filter.frequency.setValueAtTime(part.freq, when);
    if (part.to) filter.frequency.exponentialRampToValueAtTime(part.to, when + part.seconds);
    const gain = ctx.createGain();
    const peak = part.level * push;
    if (part.swell) {
      gain.gain.setValueAtTime(0.0001, when);
      gain.gain.exponentialRampToValueAtTime(peak, when + part.seconds * part.swell);
    } else gain.gain.setValueAtTime(peak, when);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + part.seconds);
    source.connect(filter).connect(gain).connect(out);
    source.start(when, Math.random() * 0.5);
    source.stop(when + part.seconds + 0.02);
  }
}

/** A run of quick ticks, like keys or a ratchet: `count` of them from `from` hertz to `to`. */
const ticks = (count: number, from: number, to: number, gap: number, level: number, wave: OscillatorType = 'square', at = 0): Tone[] =>
  Array.from({ length: count }, (_, i) => ({ freq: from + ((to - from) * i) / Math.max(1, count - 1), at: at + i * gap, seconds: 0.03, wave, level }));

/**
 * Every program has a voice of its own: how it sounds setting to work,
 * and how it sounds when the thing gives. The kind is what it works on
 * (a task's target), so two password breakers sound alike and a
 * password never sounds like a firewall.
 */
interface Voice {
  readonly label: string;
  readonly start: () => void;
  readonly finish: () => void;
}

const PLAIN_VOICE: Voice = {
  label: 'Any other program',
  start: () => play([{ freq: 300, seconds: 0.08, wave: 'square', level: 0.05, to: 600 }]),
  finish: () =>
    play([
      { freq: 784, seconds: 0.1 },
      { freq: 1175, at: 0.09, seconds: 0.22 },
    ]),
};

export const PROGRAM_VOICES: Readonly<Record<string, Voice>> = {
  // Keys hammered, then a bolt drawn back and the door's two notes.
  password: {
    label: 'Password',
    start: () => play(ticks(6, 700, 1250, 0.035, 0.04)),
    finish: () => {
      play([
        { freq: 150, seconds: 0.09, wave: 'square', level: 0.09, to: 95 },
        { freq: 659, at: 0.09, seconds: 0.1, wave: 'triangle', level: 0.07 },
        { freq: 988, at: 0.18, seconds: 0.28, wave: 'triangle', level: 0.07 },
      ]);
    },
  },
  // Air drawn in, then slipping past: a breath out and one glassy note.
  proxy: {
    label: 'Proxy',
    start: () => rush([{ seconds: 0.28, level: 0.2, freq: 500, to: 2600, q: 3, swell: 0.7 }]),
    finish: () => {
      rush([{ seconds: 0.4, level: 0.17, freq: 3200, to: 500, q: 2.5 }]);
      play([
        { freq: 1568, at: 0.16, seconds: 0.4, level: 0.05 },
        { freq: 2349, at: 0.2, seconds: 0.3, level: 0.025 },
      ]);
    },
  },
  // A low engine pushing, then the wall cracking and falling in.
  firewall: {
    label: 'Firewall',
    start: () =>
      play([
        { freq: 82, seconds: 0.3, wave: 'sawtooth', level: 0.08, to: 110 },
        { freq: 164, at: 0.04, seconds: 0.22, wave: 'square', level: 0.03, to: 220 },
      ]),
    finish: () => {
      rush([
        { seconds: 0.07, level: 0.12, freq: 2400, q: 0.8, kind: 'highpass' },
        { at: 0.05, seconds: 0.5, level: 0.08, freq: 900, to: 140, q: 0.9, kind: 'lowpass' },
      ]);
      play([
        { freq: 98, seconds: 0.45, wave: 'sawtooth', level: 0.085, to: 49 },
        { freq: 740, at: 0.2, seconds: 0.12, wave: 'triangle', level: 0.06 },
        { freq: 1109, at: 0.3, seconds: 0.3, wave: 'triangle', level: 0.06 },
      ]);
    },
  },
  // A sonar ping going out, then the eye closing: the ping falling away to nothing.
  monitor: {
    label: 'Monitor',
    start: () =>
      play([
        { freq: 1175, seconds: 0.35, level: 0.06 },
        { freq: 1175, at: 0.22, seconds: 0.3, level: 0.025 },
      ]),
    finish: () =>
      play([
        { freq: 1175, seconds: 0.5, level: 0.06, to: 294 },
        { freq: 587, at: 0.3, seconds: 0.5, wave: 'triangle', level: 0.05, to: 147 },
        { freq: 73, at: 0.5, seconds: 0.25, level: 0.1 },
      ]),
  },
  // Scrambled notes, then the same notes falling into order.
  decrypt: {
    label: 'Decrypter',
    start: () => play([831, 554, 932, 622, 740].map((freq, i) => ({ freq, at: i * 0.045, seconds: 0.05, wave: 'square' as const, level: 0.035 }))),
    finish: () =>
      play([
        ...[554, 622, 740, 831, 932].map((freq, i) => ({ freq, at: i * 0.05, seconds: 0.07, wave: 'triangle' as const, level: 0.05 })),
        { freq: 1109, at: 0.26, seconds: 0.45, wave: 'triangle', level: 0.06 },
        { freq: 554, at: 0.26, seconds: 0.45, level: 0.04 },
      ]),
  },
  // A drive spinning up, then two blocks dropping home.
  copyFile: {
    label: 'File copier',
    start: () => play([{ freq: 180, seconds: 0.3, wave: 'triangle', level: 0.06, to: 540 }]),
    finish: () =>
      play([
        { freq: 196, seconds: 0.06, wave: 'square', level: 0.07 },
        { freq: 196, at: 0.09, seconds: 0.06, wave: 'square', level: 0.07 },
        { freq: 784, at: 0.18, seconds: 0.1, wave: 'triangle', level: 0.06 },
        { freq: 1047, at: 0.27, seconds: 0.26, wave: 'triangle', level: 0.06 },
      ]),
  },
  // The same drive, the other way: something sent up the line.
  uploadFile: {
    label: 'Upload',
    start: () => play([{ freq: 540, seconds: 0.3, wave: 'triangle', level: 0.06, to: 180 }]),
    finish: () => {
      rush([{ seconds: 0.3, level: 0.07, freq: 600, to: 4000, q: 2, swell: 0.6 }]);
      play([
        { freq: 1047, at: 0.22, seconds: 0.1, wave: 'triangle', level: 0.06 },
        { freq: 784, at: 0.31, seconds: 0.26, wave: 'triangle', level: 0.06 },
      ]);
    },
  },
  // A blade drawn, then the file shredded.
  deleteFile: {
    label: 'File deleter',
    start: () => play([{ freq: 900, seconds: 0.16, wave: 'sawtooth', level: 0.04, to: 300 }]),
    finish: () => {
      rush([{ seconds: 0.32, level: 0.16, freq: 2600, to: 220, q: 1.2 }]);
      play([
        ...ticks(5, 520, 180, 0.04, 0.04, 'sawtooth'),
        { freq: 110, at: 0.24, seconds: 0.25, wave: 'triangle', level: 0.09, to: 70 },
      ]);
    },
  },
  // A cloth across glass, twice: the lines gone.
  deleteLog: {
    label: 'Log deleter',
    start: () => rush([{ seconds: 0.14, level: 0.16, freq: 1800, to: 3600, q: 4 }]),
    finish: () => {
      rush([
        { seconds: 0.16, level: 0.17, freq: 1200, to: 4200, q: 3 },
        { at: 0.16, seconds: 0.2, level: 0.17, freq: 4200, to: 900, q: 3 },
      ]);
      play([{ freq: 1319, at: 0.34, seconds: 0.3, level: 0.05 }]);
    },
  },
  // A ratchet winding back, then the casing opening out.
  decompile: {
    label: 'Decompiler',
    start: () => play(ticks(6, 620, 260, 0.045, 0.04)),
    finish: () =>
      play([
        ...[262, 330, 392, 494, 587].map((freq, i) => ({ freq, at: i * 0.07, seconds: 0.2, wave: 'triangle' as const, level: 0.05 })),
        { freq: 784, at: 0.36, seconds: 0.4, level: 0.05 },
      ]),
  },
  // A sweep out across the network, and three echoes back.
  scan: {
    label: 'Scanner',
    start: () => play([{ freq: 400, seconds: 0.4, level: 0.05, to: 1600 }]),
    finish: () => play([0, 0.12, 0.24].map((at, i) => ({ freq: 1397, at, seconds: 0.18, level: 0.06 - i * 0.015 }))),
  },
  // The Workbench warming up. It has its own sound for the finished build.
  build: {
    label: 'Workbench',
    start: () =>
      play([
        { freq: 110, seconds: 0.4, wave: 'sawtooth', level: 0.04, to: 220 },
        ...ticks(3, 440, 660, 0.09, 0.035, 'square', 0.1),
      ]),
    finish: () => {},
  },
};

const voiceOf = (kind: string): Voice => PROGRAM_VOICES[kind] ?? PLAIN_VOICE;

/**
 * The moments that should be heard over the music: how much of the
 * music is left under each, and for how long.
 */
const DUCKS: Partial<Record<GameEvent['type'], readonly [depth: number, seconds: number]>> = {
  traceStarted: [0.45, 0.9],
  paid: [0.6, 0.5],
  promoted: [0.35, 1],
  raidStarted: [0.35, 1.4],
  raidEnded: [0.4, 1.3],
  barrierFell: [0.5, 0.6],
  feat: [0.6, 1.1],
  serverTaken: [0.4, 1.6],
};

const EFFECTS: Record<GameEvent['type'], (event: GameEvent) => void> = {
  connected: () =>
    play([
      { freq: 440, seconds: 0.09, wave: 'triangle' },
      { freq: 660, at: 0.08, seconds: 0.09, wave: 'triangle' },
      { freq: 990, at: 0.16, seconds: 0.16, wave: 'triangle' },
    ]),
  disconnected: (event) => {
    if (event.type === 'disconnected' && event.traced) {
      // The line going: a crack of static. The "caught" screen plays the rest (see caughtFall and caughtHit).
      burst(0.25, 0.16);
      play([{ freq: 1800, seconds: 0.12, wave: 'square', level: 0.07, to: 300 }]);
    } else {
      burst(0.12, 0.06);
      play([{ freq: 520, seconds: 0.22, wave: 'triangle', to: 180 }]);
    }
  },
  traceStarted: () =>
    play([
      { freq: 880, seconds: 0.14, wave: 'square', level: 0.08 },
      { freq: 880, at: 0.2, seconds: 0.14, wave: 'square', level: 0.08 },
      { freq: 880, at: 0.4, seconds: 0.3, wave: 'square', level: 0.08 },
    ]),
  programStarted: (event) => event.type === 'programStarted' && voiceOf(event.kind).start(),
  programFinished: (event) => event.type === 'programFinished' && voiceOf(event.kind).finish(),
  loggedIn: () =>
    play([
      { freq: 523, seconds: 0.08, wave: 'triangle' },
      { freq: 784, at: 0.07, seconds: 0.18, wave: 'triangle' },
    ]),
  message: () =>
    play([
      { freq: 1047, seconds: 0.12, level: 0.07 },
      { freq: 1319, at: 0.13, seconds: 0.2, level: 0.07 },
    ]),
  // Four notes overlap, so each is a little quieter than a single tone.
  paid: () => play([523, 659, 784, 1047].map((freq, i) => ({ freq, at: i * 0.07, seconds: 0.18, wave: 'triangle' as const, level: 0.07 }))),
  spent: () => play([{ freq: 400, seconds: 0.12, wave: 'triangle', to: 250 }]),
  // A rising fifth and an octave held: a new title.
  promoted: () =>
    play([
      { freq: 392, seconds: 0.16, wave: 'triangle' },
      { freq: 587, at: 0.14, seconds: 0.16, wave: 'triangle' },
      { freq: 784, at: 0.28, seconds: 0.5, wave: 'triangle' },
      { freq: 1175, at: 0.28, seconds: 0.5, level: 0.04 },
    ]),
  // Two soft bells: something to spend.
  pointEarned: () =>
    play([
      { freq: 880, at: 0.5, seconds: 0.3, level: 0.06 },
      { freq: 1319, at: 0.62, seconds: 0.45, level: 0.06 },
    ]),
  // A low note that locks in under a bright one.
  skillLearned: () =>
    play([
      { freq: 196, seconds: 0.35, wave: 'triangle', level: 0.08, to: 262 },
      { freq: 784, at: 0.1, seconds: 0.12, wave: 'triangle', level: 0.06 },
      { freq: 1047, at: 0.2, seconds: 0.4, wave: 'triangle', level: 0.06 },
    ]),
  skillsUnlearned: () =>
    play([
      { freq: 784, seconds: 0.14, wave: 'triangle', level: 0.06 },
      { freq: 523, at: 0.12, seconds: 0.14, wave: 'triangle', level: 0.06 },
      { freq: 262, at: 0.24, seconds: 0.5, wave: 'triangle', level: 0.07, to: 131 },
    ]),
  // A ratchet, then the part seating.
  built: () => {
    play([0, 0.05, 0.1, 0.15].map((at, i) => ({ freq: 500 + 120 * i, at, seconds: 0.035, wave: 'square' as const, level: 0.04 })));
    play([
      { freq: 330, at: 0.24, seconds: 0.3, wave: 'triangle', level: 0.08 },
      { freq: 660, at: 0.24, seconds: 0.45, level: 0.06 },
      { freq: 990, at: 0.34, seconds: 0.5, level: 0.04 },
    ]);
  },
  scrapped: () => {
    burst(0.1, 0.05);
    play([
      { freq: 440, seconds: 0.07, wave: 'square', level: 0.04, to: 300 },
      { freq: 300, at: 0.08, seconds: 0.12, wave: 'square', level: 0.04, to: 160 },
    ]);
  },
  refined: () =>
    play([
      { freq: 300, seconds: 0.5, wave: 'sawtooth', level: 0.035, to: 1200 },
      { freq: 1568, at: 0.45, seconds: 0.5, level: 0.06 },
    ]),
  // A buyer has already heard the money go.
  moduleGained: (event) => {
    if (event.type === 'moduleGained' && event.bought) return;
    play([
      { freq: 659, at: 0.3, seconds: 0.1, wave: 'triangle', level: 0.07 },
      { freq: 988, at: 0.39, seconds: 0.1, wave: 'triangle', level: 0.07 },
      { freq: 1319, at: 0.48, seconds: 0.35, wave: 'triangle', level: 0.07 },
    ]);
  },
  // A two-tone klaxon, three times: someone is in.
  raidStarted: (event) => {
    if (event.type === 'raidStarted' && event.who === content.chorus?.rival.handle) return chorusKnock();
    burst(0.25, 0.08);
    play(
      [0, 0.44, 0.88].flatMap((at) => [
        { freq: 622, at, seconds: 0.2, wave: 'sawtooth' as const, level: 0.11 },
        { freq: 415, at: at + 0.2, seconds: 0.22, wave: 'sawtooth' as const, level: 0.11 },
      ]),
    );
  },
  // A door giving way, low.
  barrierFell: () => {
    burst(0.3, 0.12);
    play([
      { freq: 110, seconds: 0.5, wave: 'sawtooth', level: 0.13, to: 45 },
      { freq: 311, at: 0.05, seconds: 0.25, wave: 'square', level: 0.05, to: 155 },
    ]);
  },
  ringLocked: () =>
    play([
      { freq: 180, seconds: 0.07, wave: 'square', level: 0.07 },
      { freq: 1245, at: 0.02, seconds: 0.12, wave: 'triangle', level: 0.06 },
    ]),
  // A bolt thrown, then a bright confirm.
  portShut: () => {
    burst(0.08, 0.1);
    play([
      { freq: 130, seconds: 0.22, wave: 'square', level: 0.1, to: 65 },
      { freq: 784, at: 0.12, seconds: 0.12, wave: 'triangle', level: 0.07 },
      { freq: 1175, at: 0.22, seconds: 0.3, wave: 'triangle', level: 0.07 },
    ]);
  },
  raidEnded: (event) => {
    if (event.type !== 'raidEnded') return;
    if (event.result === 'won') {
      // A rising run that lands on a held chord: you have their address.
      play([392, 523, 659, 784].map((freq, i) => ({ freq, at: i * 0.09, seconds: 0.16, wave: 'triangle' as const, level: 0.08 })));
      play([
        { freq: 1047, at: 0.4, seconds: 0.7, wave: 'triangle', level: 0.08 },
        { freq: 1319, at: 0.4, seconds: 0.7, level: 0.05 },
        { freq: 523, at: 0.4, seconds: 0.7, wave: 'triangle', level: 0.05 },
      ]);
    } else if (event.result === 'lost') {
      burst(0.8, 0.18);
      play([
        { freq: 196, seconds: 0.35, wave: 'sawtooth', level: 0.12 },
        { freq: 156, at: 0.3, seconds: 0.35, wave: 'sawtooth', level: 0.12 },
        { freq: 104, at: 0.6, seconds: 0.9, wave: 'sawtooth', level: 0.13, to: 52 },
      ]);
    } else if (event.result === 'held') {
      // It gave up: the voices fall away to one, and that one lets go.
      play([
        { freq: 466, seconds: 0.5, level: 0.05, to: 392 },
        { freq: 370, seconds: 0.5, level: 0.05, to: 392 },
        { freq: 392, at: 0.45, seconds: 0.9, wave: 'triangle', level: 0.07 },
        { freq: 784, at: 0.6, seconds: 0.7, level: 0.04 },
      ]);
    } else {
      // The plug: everything winds down.
      burst(0.2, 0.12);
      play([{ freq: 440, seconds: 0.8, wave: 'triangle', level: 0.1, to: 60 }]);
    }
  },
  // One step of a longer job done: two quick notes up.
  stepDone: () =>
    play([
      { freq: 587, seconds: 0.1, wave: 'triangle', level: 0.07 },
      { freq: 880, at: 0.1, seconds: 0.24, wave: 'triangle', level: 0.07 },
    ]),
  serverTaken: () => voices(0.05),
  // The moment and the ending have the whole screen, and play their own (see nameLetter, nameWhole and endingChord).
  nameRead: () => {},
  ended: () => {},
  // A held breath let out: a falling pair, then a low warning.
  allyLetGo: () =>
    play([
      { freq: 660, seconds: 0.14, wave: 'triangle', to: 440 },
      { freq: 330, at: 0.16, seconds: 0.3, wave: 'square', level: 0.06 },
    ]),
  // Three bright bells climbing, the last one held: a feat.
  feat: () =>
    play([
      { freq: 1047, at: 0.3, seconds: 0.18, wave: 'triangle', level: 0.05 },
      { freq: 1319, at: 0.42, seconds: 0.18, wave: 'triangle', level: 0.05 },
      { freq: 1568, at: 0.54, seconds: 0.6, wave: 'triangle', level: 0.05 },
    ]),
};

/** Many quiet voices settling on the same note, a little out of tune with each other: Chorus. */
function voices(level: number, at = 0): void {
  play(
    [311, 313.5, 370, 372, 466, 469].map((freq, i) => ({ freq, at: at + i * 0.06, seconds: 1.5, level: level * (i % 2 ? 0.7 : 1), to: i < 2 ? 311 : i < 4 ? 373 : 466 })),
  );
}

/** Chorus at the gateway: three polite knocks under the voices, where a hacker gets an alarm. */
export function chorusKnock(): void {
  play([0, 0.22, 0.44].map((at) => ({ freq: 140, at, seconds: 0.12, wave: 'triangle' as const, level: 0.14, to: 90 })));
  voices(0.06, 0.5);
}

/** One letter of the name falling into place: higher for each one. */
export function nameLetter(index: number, of: number): void {
  const freq = 330 * 2 ** ((index / Math.max(1, of)) * 1.2);
  play([
    { freq, seconds: 0.5, wave: 'triangle', level: 0.07 },
    { freq: freq * 2, at: 0.02, seconds: 0.25, level: 0.03 },
  ]);
}

/** The whole name read: one open fifth, held, with nothing under it. */
export function nameWhole(): void {
  play([
    { freq: 110, seconds: 3.2, level: 0.12 },
    { freq: 165, seconds: 3.2, level: 0.08 },
    { freq: 220, at: 0.05, seconds: 3, wave: 'triangle', level: 0.07 },
    { freq: 660, at: 0.4, seconds: 2.4, level: 0.03 },
  ]);
}

/** Each ending has its own last chord. */
const ENDING_CHORDS: Record<string, readonly number[]> = {
  // Closed and low: a door shut gently.
  quiet: [131, 196, 262, 330],
  // Bright and wide open.
  daylight: [196, 294, 392, 494, 740],
  // Rising with nothing holding it down.
  unbound: [147, 220, 330, 494, 740, 1109],
  // Four voices that agree.
  treaty: [175, 262, 349, 440, 523],
  // Every voice on one note.
  chorus: [233, 233.8, 234.6, 466, 467.5, 699],
};

export function endingChord(id: string): void {
  const notes = ENDING_CHORDS[id] ?? ENDING_CHORDS['quiet']!;
  play(notes.map((freq, i) => ({ freq, at: i * (id === 'chorus' ? 0.02 : 0.22), seconds: 4.2 - i * 0.2, wave: i % 2 ? ('sine' as const) : ('triangle' as const), level: 0.07 - i * 0.006 })));
}

/**
 * Sounds for things the player does on the desk that the game itself
 * takes no notice of: picking a slot, seating a module, flipping a tab.
 * A button asks for one with a `data-sfx` attribute.
 */
const UI_SOUNDS = {
  // A soft blip: something picked up to look at.
  pick: () => play([{ freq: 880, seconds: 0.06, wave: 'triangle', level: 0.045, to: 1100 }]),
  // A card flicked across: a tab or a sort order changed.
  tab: () =>
    play([
      { freq: 620, seconds: 0.04, wave: 'triangle', level: 0.04 },
      { freq: 930, at: 0.035, seconds: 0.07, wave: 'triangle', level: 0.04 },
    ]),
  // A module pressed home: a click, then a short rising hum.
  socket: () =>
    play([
      { freq: 190, seconds: 0.05, wave: 'square', level: 0.06 },
      { freq: 520, at: 0.03, seconds: 0.16, wave: 'triangle', level: 0.06, to: 880 },
    ]),
  unsocket: () =>
    play([
      { freq: 700, seconds: 0.12, wave: 'triangle', level: 0.05, to: 380 },
      { freq: 170, at: 0.1, seconds: 0.05, wave: 'square', level: 0.045 },
    ]),
  // A part seated on the board: a low thunk, then the board lighting up. It follows the money going.
  fitted: () => {
    burst(0.05, 0.05);
    play([
      { freq: 140, at: 0.14, seconds: 0.16, wave: 'square', level: 0.08, to: 80 },
      { freq: 660, at: 0.22, seconds: 0.12, wave: 'triangle', level: 0.06 },
      { freq: 990, at: 0.31, seconds: 0.12, wave: 'triangle', level: 0.06 },
      { freq: 1320, at: 0.4, seconds: 0.4, wave: 'triangle', level: 0.06 },
    ]);
  },
  // A skill fired: a quick charge up and a snap.
  move: () => {
    play([
      { freq: 220, seconds: 0.18, wave: 'sawtooth', level: 0.05, to: 880 },
      { freq: 1320, at: 0.17, seconds: 0.09, wave: 'square', level: 0.05 },
      { freq: 1760, at: 0.24, seconds: 0.22, wave: 'triangle', level: 0.06 },
    ]);
  },
  // A program pushed into memory, and one pulled out.
  load: () =>
    play([
      { freq: 330, seconds: 0.05, wave: 'square', level: 0.045 },
      { freq: 660, at: 0.04, seconds: 0.1, wave: 'triangle', level: 0.05, to: 990 },
    ]),
  unload: () => play([{ freq: 740, seconds: 0.1, wave: 'triangle', level: 0.045, to: 420 }]),
  // A job taken: a stamp coming down, and one note to say it is yours.
  accepted: () => {
    burst(0.06, 0.07);
    play([
      { freq: 150, seconds: 0.12, wave: 'square', level: 0.08, to: 90 },
      { freq: 587, at: 0.1, seconds: 0.1, wave: 'triangle', level: 0.07 },
      { freq: 880, at: 0.19, seconds: 0.3, wave: 'triangle', level: 0.07 },
    ]);
  },
} as const;

export type UiSound = keyof typeof UI_SOUNDS;

export function uiSound(name: UiSound): void {
  UI_SOUNDS[name]();
}

/**
 * Sounds for the program on the stage (see desktop/windows/Stage.tsx): each
 * show has its own small voice. `n` is a count that pitches some of them.
 */
const STAGE_SOUNDS = {
  // A letter or a ring locking: a tick that climbs as the code fills in.
  letter: (n: number) => play([{ freq: 520 + 70 * Math.min(n, 9), seconds: 0.07, wave: 'square', level: 0.05 }]),
  // A mirror peeled off the proxy: a short falling slip.
  peel: (n: number) => play([{ freq: 980 - 60 * Math.min(n, 8), seconds: 0.12, wave: 'triangle', level: 0.05, to: 420 }]),
  // A run of blocks landing on the drive.
  block: (n: number) => play([{ freq: n % 8 === 0 ? 392 : 330, seconds: 0.04, wave: 'triangle', level: 0.03 }]),
  // Something rubbed out.
  wipe: () => play([{ freq: 300, seconds: 0.09, wave: 'sawtooth', level: 0.03, to: 140 }]),
  // The hands-on part done right: two bright notes.
  caught: () =>
    play([
      { freq: 880, seconds: 0.07, wave: 'triangle', level: 0.07 },
      { freq: 1320, at: 0.06, seconds: 0.16, wave: 'triangle', level: 0.07 },
    ]),
  // And done wrong: a low buzz.
  miss: () => play([{ freq: 150, seconds: 0.16, wave: 'sawtooth', level: 0.06, to: 110 }]),
} as const;

export type StageSound = keyof typeof STAGE_SOUNDS;

export function stageSound(name: StageSound, n = 0): void {
  STAGE_SOUNDS[name](n);
}

/** A soft tick for a button going down. */
function buttonTick(): void {
  play([{ freq: 1500, seconds: 0.03, wave: 'square', level: 0.025 }]);
}

/**
 * The trace counting down, in four stages. The closer it gets the
 * higher, harder and busier the beep, so the stage can be told by ear
 * with the eyes on something else.
 */
function traceBeep(stage: TraceStage): void {
  if (stage === 'far') play([{ freq: 880, seconds: 0.06, level: 0.04 }]);
  else if (stage === 'near') play([{ freq: 990, seconds: 0.06, wave: 'square', level: 0.045 }]);
  else if (stage === 'close') {
    play([
      { freq: 1320, seconds: 0.07, wave: 'square', level: 0.07 },
      { freq: 1320, at: 0.14, seconds: 0.07, wave: 'square', level: 0.07 },
    ]);
  } else {
    play([
      { freq: 1568, seconds: 0.06, wave: 'square', level: 0.075 },
      { freq: 1568, at: 0.11, seconds: 0.06, wave: 'square', level: 0.075 },
      { freq: 1568, at: 0.22, seconds: 0.06, wave: 'square', level: 0.075 },
      { freq: 65, seconds: 0.3, level: 0.14, to: 49 },
    ]);
  }
}

/** The moment the trace steps up a stage: one low push under the beeps. */
function traceStep(stage: TraceStage): void {
  if (stage === 'far') return;
  const freq = stage === 'near' ? 147 : stage === 'close' ? 196 : 262;
  play([
    { freq, seconds: 0.35, wave: 'sawtooth', level: 0.07, to: freq * 1.5 },
    { freq: freq * 2, at: 0.05, seconds: 0.25, wave: 'square', level: 0.03, to: freq * 3 },
  ]);
}

/**
 * What a press sounds like depends on what was pressed: a go button is
 * fuller than a plain one, a window's close is a small fall, and a tab
 * on the bar is a card flicked.
 */
type Press = 'plain' | 'go' | 'close' | 'bar';

function pressOf(button: Element): Press {
  if (button.classList.contains('window__close')) return 'close';
  if (button.closest('.dock__tabs, .pdock__tabs, .window__tabs')) return 'bar';
  if (button.classList.contains('btn--go')) return 'go';
  return 'plain';
}

function pressTick(press: Press): void {
  if (press === 'go') {
    play([
      { freq: 1100, seconds: 0.035, wave: 'square', level: 0.028 },
      { freq: 330, seconds: 0.05, wave: 'triangle', level: 0.026 },
    ]);
  } else if (press === 'close') play([{ freq: 900, seconds: 0.07, wave: 'triangle', level: 0.035, to: 450 }]);
  else if (press === 'bar') {
    play([
      { freq: 700, seconds: 0.03, wave: 'triangle', level: 0.035 },
      { freq: 1050, at: 0.03, seconds: 0.05, wave: 'triangle', level: 0.03 },
    ]);
  } else buttonTick();
}

/** Starts the sound effects. Call once, after the game has loaded. */
export function startSfx(): void {
  session.subscribeEvents((event) => {
    const duck = DUCKS[event.type];
    if (duck) duckMusic(duck[0], duck[1]);
    EFFECTS[event.type](event);
  });

  // Buttons that ask for a sound of their own get it when they are pressed.
  document.addEventListener(
    'click',
    (event) => {
      const button = (event.target as HTMLElement | null)?.closest?.<HTMLElement>('[data-sfx]');
      const name = button?.dataset.sfx;
      if (button && !(button as HTMLButtonElement).disabled && name && name in UI_SOUNDS) uiSound(name as UiSound);
    },
    true,
  );

  // A soft tick for every button, so the desk feels like it has keys.
  document.addEventListener(
    'pointerdown',
    (event) => {
      const button = (event.target as HTMLElement | null)?.closest?.<HTMLButtonElement>('button');
      // A button with a sound of its own (data-sfx) plays that when it is let go; it gets no tick as well.
      if (button && !button.disabled && !button.dataset.sfx) pressTick(pressOf(button));
    },
    true,
  );

  // While a trace runs: one beep a second, stepping up as it closes in.
  let lastSecond = -1;
  let lastStage: TraceStage | null = null;
  session.subscribeGame(() => {
    const connection = mostUrgentTrace(session.getState(), content);
    // A held trace is silent: the quiet is how you know the monitor is blind.
    if (!connection || connection.monitor.blindMs > 0) {
      lastSecond = -1;
      if (!connection) lastStage = null;
      return;
    }
    const report = traceReport(connection.trace);
    const second = Math.ceil(report.remainingMs / 1000);
    if (second === lastSecond) return;
    lastSecond = second;
    const stage = traceStage(report.progress, second);
    if (lastStage !== null && stage !== lastStage) traceStep(stage);
    lastStage = stage;
    traceBeep(stage);
  });
}

/** The trace running home along the route: one falling blip for each hop it takes, lower each time. */
export function caughtFall(hop: number, hops: number): void {
  const freq = 1400 * 0.5 ** ((hop / Math.max(1, hops)) * 2.2);
  play([
    { freq, seconds: 0.16, wave: 'square', level: 0.06, to: freq * 0.7 },
    { freq: freq * 1.5, at: 0.02, seconds: 0.08, wave: 'triangle', level: 0.04 },
  ]);
}

/** The trace arriving: the line cut dead, and a long low note going down under it. */
export function caughtHit(): void {
  burst(0.9, 0.2);
  play([
    { freq: 220, seconds: 1.3, wave: 'sawtooth', level: 0.14, to: 41 },
    { freq: 233, seconds: 1.3, wave: 'sawtooth', level: 0.1, to: 43 },
    { freq: 55, seconds: 1.6, wave: 'sine', level: 0.18, to: 36 },
  ]);
}

/** A soft rising pair of notes: the tour moving on to its next stop. */
export function tourChime(): void {
  play([
    { freq: 784, seconds: 0.12, wave: 'triangle', level: 0.05 },
    { freq: 1175, at: 0.07, seconds: 0.22, wave: 'triangle', level: 0.05 },
  ]);
}

/** One sound the player can ask to hear, by name. */
export interface NamedSound {
  readonly group: string;
  readonly label: string;
  readonly play: () => void;
}

const heard = (event: GameEvent) => () => EFFECTS[event.type](event);

/**
 * Every sound in the game with a name a player would know it by, for the
 * sound test in the settings. Add a line here with each new sound.
 */
export const SOUND_TEST: readonly NamedSound[] = [
  { group: 'Connections', label: 'Connected', play: heard({ type: 'connected', server: '' }) },
  { group: 'Connections', label: 'Logged in', play: heard({ type: 'loggedIn' }) },
  { group: 'Connections', label: 'Disconnected', play: heard({ type: 'disconnected', server: '', traced: false, pulled: false }) },
  { group: 'Connections', label: 'Line cut by a trace', play: heard({ type: 'disconnected', server: '', traced: true, pulled: false }) },
  { group: 'Trace', label: 'Trace started', play: heard({ type: 'traceStarted', server: '' }) },
  { group: 'Trace', label: 'Beep: far off', play: () => traceBeep('far') },
  { group: 'Trace', label: 'Beep: half way', play: () => traceBeep('near') },
  { group: 'Trace', label: 'Beep: last ten seconds', play: () => traceBeep('close') },
  { group: 'Trace', label: 'Beep: last three seconds', play: () => traceBeep('last') },
  { group: 'Trace', label: 'Stepping up', play: () => traceStep('close') },
  { group: 'Trace', label: 'Caught: one hop back', play: () => caughtFall(2, 5) },
  { group: 'Trace', label: 'Caught', play: caughtHit },
  ...[...Object.values(PROGRAM_VOICES), PLAIN_VOICE].flatMap((voice) => [
    { group: 'Programs at work', label: `${voice.label}: start`, play: voice.start },
    ...(voice.label === 'Workbench' ? [] : [{ group: 'Programs at work', label: `${voice.label}: done`, play: voice.finish }]),
  ]),
  { group: 'Hands-on', label: 'Letter found', play: () => stageSound('letter', 4) },
  { group: 'Hands-on', label: 'Mirror peeled', play: () => stageSound('peel', 3) },
  { group: 'Hands-on', label: 'Blocks copied', play: () => stageSound('block', 8) },
  { group: 'Hands-on', label: 'Line wiped', play: () => stageSound('wipe') },
  { group: 'Hands-on', label: 'Right', play: () => stageSound('caught') },
  { group: 'Hands-on', label: 'Wrong', play: () => stageSound('miss') },
  { group: 'Hands-on', label: 'Skill move fired', play: () => uiSound('move') },
  { group: 'Work', label: 'Job taken', play: () => uiSound('accepted') },
  { group: 'Work', label: 'Step done', play: heard({ type: 'stepDone', step: 1, of: 3 }) },
  { group: 'Work', label: 'Paid', play: heard({ type: 'paid' }) },
  { group: 'Work', label: 'Money spent', play: heard({ type: 'spent' }) },
  { group: 'Work', label: 'New message', play: heard({ type: 'message' }) },
  { group: 'Work', label: 'New title', play: heard({ type: 'promoted', title: '' }) },
  { group: 'Work', label: 'Feat earned', play: heard({ type: 'feat', name: '', text: '' }) },
  { group: 'Skills and parts', label: 'Skill point', play: heard({ type: 'pointEarned', free: 1 }) },
  { group: 'Skills and parts', label: 'Skill learned', play: heard({ type: 'skillLearned' }) },
  { group: 'Skills and parts', label: 'Skills reset', play: heard({ type: 'skillsUnlearned' }) },
  { group: 'Skills and parts', label: 'Build finished', play: heard({ type: 'built' }) },
  { group: 'Skills and parts', label: 'Scrapped', play: heard({ type: 'scrapped' }) },
  { group: 'Skills and parts', label: 'Refined', play: heard({ type: 'refined' }) },
  { group: 'Skills and parts', label: 'Module found', play: heard({ type: 'moduleGained', name: '', bought: false }) },
  { group: 'Skills and parts', label: 'Module fitted', play: () => uiSound('socket') },
  { group: 'Skills and parts', label: 'Module pulled', play: () => uiSound('unsocket') },
  { group: 'Skills and parts', label: 'Hardware fitted', play: () => uiSound('fitted') },
  { group: 'Skills and parts', label: 'Program loaded', play: () => uiSound('load') },
  { group: 'Skills and parts', label: 'Program unloaded', play: () => uiSound('unload') },
  { group: 'Your gateway', label: 'Break-in alarm', play: heard({ type: 'raidStarted', who: '' }) },
  { group: 'Your gateway', label: 'Barrier down', play: heard({ type: 'barrierFell', left: 1 }) },
  { group: 'Your gateway', label: 'Ring locked', play: heard({ type: 'ringLocked' }) },
  { group: 'Your gateway', label: 'Port shut', play: heard({ type: 'portShut' }) },
  { group: 'Your gateway', label: 'Intruder traced', play: heard({ type: 'raidEnded', who: '', result: 'won' }) },
  { group: 'Your gateway', label: 'Intruder got in', play: heard({ type: 'raidEnded', who: '', result: 'lost' }) },
  { group: 'Your gateway', label: 'Plug pulled', play: heard({ type: 'raidEnded', who: '', result: 'fled' }) },
  { group: 'Desk', label: 'Button', play: buttonTick },
  { group: 'Desk', label: 'Go button', play: () => pressTick('go') },
  { group: 'Desk', label: 'Window closed', play: () => pressTick('close') },
  { group: 'Desk', label: 'Bar tab', play: () => pressTick('bar') },
  { group: 'Desk', label: 'Pick', play: () => uiSound('pick') },
  { group: 'Desk', label: 'Tab', play: () => uiSound('tab') },
  { group: 'Desk', label: 'Tour step', play: tourChime },
];
