/**
 * Sound effects. Each is a few synthesised tones, played when something
 * happens in the game (see events.ts) or when a button is pressed.
 */
import { mostUrgentTrace, traceReport } from '../core';
import { noiseBuffer, output } from './audio';
import type { GameEvent } from './events';
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
    const level = tone.level ?? LEVEL;
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

/** Starts the sound effects. Call once, after the game has loaded. */
export function startSfx(): void {
  session.subscribeEvents((event) => EFFECTS[event.type](event));

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
      const button = (event.target as HTMLElement | null)?.closest?.('button');
      if (button && !button.disabled) play([{ freq: 1500, seconds: 0.03, wave: 'square', level: 0.025 }]);
    },
    true,
  );

  // While a trace runs: one beep a second, higher and doubled in the last ten.
  let lastSecond = -1;
  session.subscribeGame(() => {
    const connection = mostUrgentTrace(session.getState(), content);
    // A held trace is silent: the quiet is how you know the monitor is blind.
    if (!connection || connection.monitor.blindMs > 0) {
      lastSecond = -1;
      return;
    }
    const second = Math.ceil(traceReport(connection.trace).remainingMs / 1000);
    if (second === lastSecond) return;
    lastSecond = second;
    if (second <= 10) {
      play([
        { freq: 1320, seconds: 0.07, wave: 'square', level: 0.07 },
        { freq: 1320, at: 0.14, seconds: 0.07, wave: 'square', level: 0.07 },
      ]);
    } else play([{ freq: 990, seconds: 0.06, wave: 'square', level: 0.045 }]);
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
