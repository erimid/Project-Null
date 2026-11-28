/**
 * The soundtrack, as numbers. Nothing here makes a sound: music.ts plays
 * what this file says to play. Keeping the two apart means the score can
 * be tested without a synthesiser.
 *
 * There are three moods. At rest the desk has a slow bed of held notes
 * with the odd bell over it. Connected, a soft pulse comes in underneath.
 * Under a trace a pattern of quick notes climbs with the countdown: the
 * closer the trace, the faster and the higher it runs.
 */

export type Mood = 'rest' | 'connected' | 'trace';

/** What the music needs to know about the game. */
export interface Scene {
  readonly mood: Mood;
  /** How far the nearest trace has got, 0 to 1. Only read under a trace. */
  readonly progress: number;
  /** True while that trace stands still (the monitor is blind, busy or jammed). */
  readonly held: boolean;
}

export const REST: Scene = { mood: 'rest', progress: 0, held: false };

const A1 = 55;
const semitones = (from: number, steps: number): number => from * 2 ** (steps / 12);

/** A natural minor scale, as semitones above its root. */
const MINOR = [0, 2, 3, 5, 7, 8, 10] as const;
/** The same scale with the two awkward notes left out: any of these sound well together. */
const PENTATONIC = [0, 3, 5, 7, 10] as const;

/** The bed moves through four chords, a long while on each: A minor, F, C, G. Each is a root, a fifth, an octave and a third. */
export const CHORDS: readonly (readonly number[])[] = [
  [0, 7, 12, 15],
  [-4, 3, 8, 12],
  [-9, -2, 3, 7],
  [-2, 5, 10, 14],
].map((chord) => chord.map((steps) => semitones(A1 * 2, steps)));

/** Steps (sixteenth notes) in a bar, and bars the bed stays on one chord. */
export const STEPS_PER_BAR = 16;
export const BARS_PER_CHORD = 4;

/** The chord under a step of the music. Under a trace it stays on the home chord, so the climb reads as one line. */
export function chordAt(step: number, mood: Mood): readonly number[] {
  if (mood === 'trace') return CHORDS[0]!;
  const bar = Math.floor(step / STEPS_PER_BAR);
  return CHORDS[Math.floor(bar / BARS_PER_CHORD) % CHORDS.length]!;
}

/** Beats a minute. The bed is slow; a connection brings a walking pulse; a trace runs from brisk to frantic. */
export function tempoFor(scene: Scene): number {
  if (scene.mood === 'rest') return 56;
  if (scene.mood === 'connected') return 76;
  if (scene.held) return 84;
  const progress = Math.max(0, Math.min(1, scene.progress));
  return Math.round(96 + 72 * progress);
}

/** Seconds one step lasts at a tempo. */
export const stepSeconds = (bpm: number): number => 60 / bpm / 4;

/** One note for the synthesiser. */
export interface Note {
  readonly voice: 'bell' | 'pulse' | 'bass' | 'tick' | 'run';
  readonly freq: number;
  /** Loudness, 0 to 1, before the music's own volume. */
  readonly level: number;
  readonly seconds: number;
}

/**
 * The climbing run under a trace. It walks up and down four notes of the
 * scale, and the whole figure shifts a scale step higher for every eighth
 * of the trace that has gone, two octaves in all by the end.
 */
export function runFreq(step: number, progress: number): number {
  const figure = [0, 2, 4, 2, 1, 3, 5, 3] as const;
  const lift = Math.floor(Math.max(0, Math.min(1, progress)) * 8);
  const degree = figure[step % figure.length]! + lift * 2;
  const octave = Math.floor(degree / MINOR.length);
  return semitones(A1 * 4, MINOR[degree % MINOR.length]! + 12 * octave);
}

/**
 * Everything that sounds on one step. `chance` is a number from 0 to 1,
 * fresh for each step: the bells fall where it says, so no two minutes of
 * the bed are quite alike.
 */
export function notesAt(step: number, scene: Scene, chance: number): Note[] {
  const notes: Note[] = [];
  const beat = step % 4 === 0;
  const inBar = step % STEPS_PER_BAR;
  const chord = chordAt(step, scene.mood);

  if (scene.mood === 'rest') {
    // A bell now and then, never on top of the last one.
    if (step % 2 === 0 && chance < 0.085) {
      const pick = Math.floor((chance / 0.085) * PENTATONIC.length * 2);
      notes.push({ voice: 'bell', freq: semitones(A1 * 8, PENTATONIC[pick % PENTATONIC.length]! + 12 * Math.floor(pick / PENTATONIC.length)), level: 0.5, seconds: 2.4 });
    }
    return notes;
  }

  if (scene.mood === 'connected') {
    // A heartbeat: two soft thumps a bar, a bass note at the top of it, and a tick off the beat.
    if (inBar === 0 || inBar === 6) notes.push({ voice: 'pulse', freq: 58, level: 0.8, seconds: 0.32 });
    if (inBar === 0) notes.push({ voice: 'bass', freq: chord[0]! / 2, level: 0.55, seconds: 1.6 });
    if (inBar === 10) notes.push({ voice: 'bass', freq: chord[1]! / 2, level: 0.4, seconds: 0.9 });
    if (step % 4 === 2) notes.push({ voice: 'tick', freq: 6000, level: 0.16, seconds: 0.04 });
    if (step % 2 === 0 && chance < 0.04) notes.push({ voice: 'bell', freq: semitones(A1 * 8, PENTATONIC[Math.floor((chance / 0.04) * PENTATONIC.length)]!), level: 0.35, seconds: 1.8 });
    return notes;
  }

  // A trace that stands still: the run stops, the heartbeat waits.
  if (scene.held) {
    if (inBar === 0 || inBar === 8) notes.push({ voice: 'pulse', freq: 58, level: 0.7, seconds: 0.3 });
    if (inBar === 0) notes.push({ voice: 'bass', freq: chord[0]! / 2, level: 0.5, seconds: 1.4 });
    return notes;
  }

  const progress = Math.max(0, Math.min(1, scene.progress));
  // The pulse is on every beat, and on every half beat once the trace is most of the way home.
  if (beat || (progress > 0.75 && step % 2 === 0)) notes.push({ voice: 'pulse', freq: 62, level: 0.85, seconds: 0.2 });
  if (inBar === 0 || inBar === 8) notes.push({ voice: 'bass', freq: chord[0]! / 2, level: 0.6, seconds: 0.5 });
  if (step % 2 === 1) notes.push({ voice: 'tick', freq: 7000, level: 0.14 + 0.1 * progress, seconds: 0.03 });
  notes.push({ voice: 'run', freq: runFreq(step, progress), level: 0.3 + 0.3 * progress, seconds: 0.11 });
  // In the last stretch the run is doubled an octave up.
  if (progress > 0.85) notes.push({ voice: 'run', freq: runFreq(step, progress) * 2, level: 0.22, seconds: 0.09 });
  return notes;
}

/** How bright the run's filter is: it opens as the trace closes in. In hertz. */
export const runBrightness = (progress: number): number => 700 + 3800 * Math.max(0, Math.min(1, progress));

/** How close a trace is, as the countdown beep hears it. */
export type TraceStage = 'far' | 'near' | 'close' | 'last';

/** `progress` is how far the trace has run (0 to 1); `second` is whole seconds left. */
export const traceStage = (progress: number, second: number): TraceStage =>
  second <= 3 ? 'last' : second <= 10 ? 'close' : progress >= 0.5 ? 'near' : 'far';

/** What the background should sound like: nothing, the room at home, or the machine at the far end. */
export interface Air {
  /** Changes when the background should change. */
  readonly key: string;
  /** The hum's lowest note, in hertz. */
  readonly hum: number;
  /** 0 to 1: how hard the place is guarded. Colder, higher and tighter as it rises. */
  readonly guard: number;
}

/** The player's own room: one low, warm note. */
export const HOME_AIR: Air = { key: 'home', hum: 55, guard: 0 };

/**
 * The air of a server. Each machine hums on a note of its own, picked
 * from its id so it is the same every visit, and a well guarded one
 * sounds colder. `chance` is a number from 0 to 1 drawn from the id.
 */
export function serverAir(id: string, strongestLayer: number, chance: number): Air {
  // Six notes that sit well under the music's chords (A minor, low).
  const notes = [41.2, 49, 55, 61.7, 65.4, 73.4];
  const hum = notes[Math.min(notes.length - 1, Math.floor(chance * notes.length))]!;
  return { key: `server:${id}`, hum, guard: Math.max(0, Math.min(1, strongestLayer / 5)) };
}
