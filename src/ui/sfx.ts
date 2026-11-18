/**
 * Sound effects. Each is a few synthesised tones, played when something
 * happens in the game (see events.ts) or when a button is pressed.
 */
import { mostUrgentTrace, traceReport } from '../core';
import { noiseBuffer, output } from './audio';
import type { GameEvent } from './events';
import { session } from './session';

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

function play(tones: readonly Tone[]): void {
  const sink = output();
  if (!sink) return;
  const { ctx, out } = sink;
  for (const tone of tones) {
    const when = ctx.currentTime + (tone.at ?? 0);
    const osc = ctx.createOscillator();
    osc.type = tone.wave ?? 'sine';
    osc.frequency.setValueAtTime(tone.freq, when);
    if (tone.to) osc.frequency.exponentialRampToValueAtTime(tone.to, when + tone.seconds);
    const gain = ctx.createGain();
    const level = tone.level ?? 0.12;
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
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(level, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + seconds);
  source.connect(gain).connect(out);
  source.start();
  source.stop(ctx.currentTime + seconds);
}

const EFFECTS: Record<GameEvent['type'], (event: GameEvent) => void> = {
  connected: () =>
    play([
      { freq: 440, seconds: 0.09, wave: 'triangle' },
      { freq: 660, at: 0.08, seconds: 0.09, wave: 'triangle' },
      { freq: 990, at: 0.16, seconds: 0.16, wave: 'triangle' },
    ]),
  disconnected: (event) => {
    if (event.type === 'disconnected' && event.traced) {
      burst(0.7, 0.25);
      play([
        { freq: 220, seconds: 0.9, wave: 'sawtooth', level: 0.16, to: 55 },
        { freq: 233, seconds: 0.9, wave: 'sawtooth', level: 0.12, to: 58 },
      ]);
    } else {
      burst(0.12, 0.06);
      play([{ freq: 520, seconds: 0.22, wave: 'triangle', to: 180 }]);
    }
  },
  traceStarted: () =>
    play([
      { freq: 880, seconds: 0.14, wave: 'square', level: 0.1 },
      { freq: 880, at: 0.2, seconds: 0.14, wave: 'square', level: 0.1 },
      { freq: 880, at: 0.4, seconds: 0.3, wave: 'square', level: 0.1 },
    ]),
  programStarted: () => play([{ freq: 300, seconds: 0.08, wave: 'square', level: 0.05, to: 600 }]),
  programFinished: () =>
    play([
      { freq: 784, seconds: 0.1 },
      { freq: 1175, at: 0.09, seconds: 0.22 },
    ]),
  loggedIn: () =>
    play([
      { freq: 523, seconds: 0.08, wave: 'triangle' },
      { freq: 784, at: 0.07, seconds: 0.18, wave: 'triangle' },
    ]),
  message: () =>
    play([
      { freq: 1047, seconds: 0.12, level: 0.09 },
      { freq: 1319, at: 0.13, seconds: 0.2, level: 0.09 },
    ]),
  paid: () => play([523, 659, 784, 1047].map((freq, i) => ({ freq, at: i * 0.07, seconds: 0.18, wave: 'triangle' as const }))),
  spent: () => play([{ freq: 400, seconds: 0.12, wave: 'triangle', to: 250 }]),
};

/** Starts the sound effects. Call once, after the game has loaded. */
export function startSfx(): void {
  session.subscribeEvents((event) => EFFECTS[event.type](event));

  // A soft tick for every button, so the desk feels like it has keys.
  document.addEventListener(
    'pointerdown',
    (event) => {
      const button = (event.target as HTMLElement | null)?.closest?.('button');
      if (button && !button.disabled) play([{ freq: 1500, seconds: 0.03, wave: 'square', level: 0.025 }]);
    },
    true,
  );

  // While a trace runs: one beep a second, higher and doubled in the last ten.
  let lastSecond = -1;
  session.subscribeGame(() => {
    const connection = mostUrgentTrace(session.getState());
    if (!connection) {
      lastSecond = -1;
      return;
    }
    const second = Math.ceil(traceReport(connection.trace).remainingMs / 1000);
    if (second === lastSecond) return;
    lastSecond = second;
    if (second <= 10) {
      play([
        { freq: 1320, seconds: 0.07, wave: 'square', level: 0.08 },
        { freq: 1320, at: 0.14, seconds: 0.07, wave: 'square', level: 0.08 },
      ]);
    } else play([{ freq: 990, seconds: 0.06, wave: 'square', level: 0.045 }]);
  });
}
