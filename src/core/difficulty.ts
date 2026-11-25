/**
 * Difficulty: three ways the same game can be played. Picked at the start
 * and changeable at any time from the game menu. A mode only scales rules
 * that already exist, and nothing is ever wiped in any of them.
 *
 * A change takes hold from the next thing that happens: a trace already
 * running keeps the pace it started with.
 */
export const DIFFICULTIES = ['story', 'standard', 'hard'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export interface Mode {
  readonly name: string;
  /** One line for the menu and the new-game screen. */
  readonly blurb: string;
  /** Each step of a trace takes this many times as long. */
  readonly traceTime: number;
  /** Fines are multiplied by this. */
  readonly fines: number;
  /** False if a trace that gets home never burns a part out of the gateway. */
  readonly burns: boolean;
  /** A relay stays warm this many times as long. */
  readonly relayHot: number;
  /** An intruder needs this share of the usual time to break into the gateway. */
  readonly raidTime: number;
}

export const MODES: Readonly<Record<Difficulty, Mode>> = {
  story: {
    name: 'Story',
    blurb: 'For the story. Traces run 30% slower, fines are halved, and a trace never burns a part out of your gateway.',
    traceTime: 1 / 0.7,
    fines: 0.5,
    burns: false,
    relayHot: 1,
    raidTime: 1,
  },
  standard: {
    name: 'Standard',
    blurb: 'The game as it was built.',
    traceTime: 1,
    fines: 1,
    burns: true,
    relayHot: 1,
    raidTime: 1,
  },
  hard: {
    name: 'Hard',
    blurb: 'For a second career. Traces run 25% faster, relays stay hot twice as long, and intruders break in a quarter quicker.',
    traceTime: 1 / 1.25,
    fines: 1,
    burns: true,
    relayHot: 2,
    raidTime: 0.75,
  },
};

export const isDifficulty = (value: unknown): value is Difficulty => (DIFFICULTIES as readonly unknown[]).includes(value);

/** The rules of the mode a game is being played in. */
export const modeOf = (state: { readonly difficulty?: Difficulty }): Mode => MODES[state.difficulty ?? 'standard'];
