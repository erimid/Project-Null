import { describe, expect, it } from 'vitest';
import { CHORDS, REST, STEPS_PER_BAR, BARS_PER_CHORD, chordAt, notesAt, runBrightness, runFreq, stepSeconds, tempoFor, type Scene } from './score';

const trace = (progress: number, held = false): Scene => ({ mood: 'trace', progress, held });
const connected: Scene = { mood: 'connected', progress: 0, held: false };
/** Every note of a stretch of music, with the same "chance" for each step so a run is repeatable. */
const stretch = (scene: Scene, steps: number, chance = 0.5) => Array.from({ length: steps }, (_, step) => notesAt(step, scene, chance)).flat();

describe('the soundtrack', () => {
  it('is slow at rest, walks while connected and runs under a trace', () => {
    expect(tempoFor(REST)).toBeLessThan(tempoFor(connected));
    expect(tempoFor(connected)).toBeLessThan(tempoFor(trace(0)));
  });

  it('speeds up as the trace closes in, and never past what can be played', () => {
    let last = 0;
    for (let progress = 0; progress <= 1.001; progress += 0.05) {
      const bpm = tempoFor(trace(progress));
      expect(bpm).toBeGreaterThanOrEqual(last);
      last = bpm;
    }
    expect(tempoFor(trace(1))).toBeGreaterThan(tempoFor(trace(0)) * 1.5);
    expect(stepSeconds(tempoFor(trace(5)))).toBeGreaterThan(0.08);
    expect(tempoFor(trace(-1))).toBe(tempoFor(trace(0)));
  });

  it('climbs with the countdown: the run is higher the nearer the trace', () => {
    const height = (progress: number) => Array.from({ length: 8 }, (_, step) => runFreq(step, progress)).reduce((sum, freq) => sum + freq, 0) / 8;
    let last = 0;
    for (const progress of [0, 0.13, 0.26, 0.4, 0.55, 0.7, 0.85, 1]) {
      expect(height(progress)).toBeGreaterThan(last);
      last = height(progress);
    }
    // Two octaves from start to finish, and still well inside what a small speaker plays.
    expect(height(1) / height(0)).toBeGreaterThan(3);
    for (let step = 0; step < 16; step++) {
      expect(runFreq(step, 0)).toBeGreaterThanOrEqual(200);
      expect(runFreq(step, 1)).toBeLessThan(2500);
    }
    expect(runBrightness(1)).toBeGreaterThan(runBrightness(0));
  });

  it('plays the run only under a moving trace', () => {
    expect(stretch(REST, 64).some((note) => note.voice === 'run')).toBe(false);
    expect(stretch(connected, 64).some((note) => note.voice === 'run')).toBe(false);
    expect(stretch(trace(0.5, true), 64).some((note) => note.voice === 'run')).toBe(false);
    expect(stretch(trace(0.5), 16).filter((note) => note.voice === 'run')).toHaveLength(16);
    // Doubled an octave up at the very end.
    expect(stretch(trace(0.95), 16).filter((note) => note.voice === 'run')).toHaveLength(32);
  });

  it('has a pulse whenever there is a connection, and none at rest', () => {
    expect(stretch(REST, 64, 0.01).every((note) => note.voice === 'bell')).toBe(true);
    expect(stretch(REST, 64, 0.9)).toEqual([]);
    const count = (scene: Scene) => stretch(scene, STEPS_PER_BAR).filter((note) => note.voice === 'pulse').length;
    expect(count(connected)).toBe(2);
    expect(count(trace(0.2))).toBe(4);
    expect(count(trace(0.9))).toBe(8);
    expect(count(trace(0.9, true))).toBe(2);
  });

  it('moves the bed through its chords, and holds the home chord under a trace', () => {
    const perChord = STEPS_PER_BAR * BARS_PER_CHORD;
    expect(chordAt(0, 'rest')).toBe(CHORDS[0]);
    expect(chordAt(perChord, 'rest')).toBe(CHORDS[1]);
    expect(chordAt(perChord * CHORDS.length, 'connected')).toBe(CHORDS[0]);
    expect(chordAt(perChord * 2 + 3, 'trace')).toBe(CHORDS[0]);
  });

  it('keeps every note in range and quiet enough to mix', () => {
    for (const scene of [REST, connected, trace(0), trace(0.5), trace(1), trace(0.5, true)]) {
      for (const chance of [0.001, 0.03, 0.08, 0.5]) {
        for (const note of stretch(scene, 128, chance)) {
          expect(note.freq).toBeGreaterThan(20);
          expect(note.freq).toBeLessThan(8000);
          expect(note.level).toBeGreaterThan(0);
          expect(note.level).toBeLessThanOrEqual(1);
          expect(note.seconds).toBeGreaterThan(0);
        }
      }
    }
  });
});
