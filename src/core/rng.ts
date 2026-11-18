/**
 * Seeded random number generator for the game simulation.
 *
 * Everything random in `core/` must come from here, never from
 * Math.random(), so the same seed always produces the same game. That is
 * what makes the simulation testable and saves reproducible.
 *
 * Algorithm: mulberry32. Small, fast, and its whole state is one 32-bit
 * integer, which is easy to store in a save file.
 */

export interface Rng {
  /** Float in [0, 1). */
  next(): number;
  /** Integer in [min, max], both ends included. */
  int(min: number, max: number): number;
  /** Float in [min, max). */
  range(min: number, max: number): number;
  /** True with the given probability (0 = never, 1 = always). */
  chance(probability: number): boolean;
  /** One item from a non-empty list. */
  pick<T>(items: readonly T[]): T;
  /** A shuffled copy. The input is not changed. */
  shuffle<T>(items: readonly T[]): T[];
  /**
   * An independent generator derived from this one's seed and a label.
   * Use it to give each system its own stream ("trace", "world", ...), so
   * adding a random call in one system doesn't change the others.
   * Forking does not advance this generator.
   */
  fork(label: string): Rng;
  /** Current internal state. Store it in a save and pass it to `restoreRng`. */
  getState(): RngState;
}

export interface RngState {
  readonly seed: number;
  readonly state: number;
}

/** Turns a string into a 32-bit seed (FNV-1a hash). */
export function hashSeed(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function createRng(seed: number | string): Rng {
  const numericSeed = typeof seed === 'string' ? hashSeed(seed) : seed >>> 0;
  return build(numericSeed, numericSeed);
}

export function restoreRng(saved: RngState): Rng {
  return build(saved.seed >>> 0, saved.state >>> 0);
}

function build(seed: number, initialState: number): Rng {
  let state = initialState;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const int = (min: number, max: number): number => {
    if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
      throw new RangeError(`rng.int: bad range ${min}..${max}`);
    }
    return min + Math.floor(next() * (max - min + 1));
  };

  return {
    next,
    int,
    range: (min, max) => min + next() * (max - min),
    chance: (probability) => next() < probability,
    pick: <T>(items: readonly T[]): T => {
      if (items.length === 0) throw new RangeError('rng.pick: empty list');
      return items[int(0, items.length - 1)] as T;
    },
    shuffle: <T>(items: readonly T[]): T[] => {
      const copy = items.slice();
      for (let i = copy.length - 1; i > 0; i--) {
        const j = int(0, i);
        const a = copy[i] as T;
        copy[i] = copy[j] as T;
        copy[j] = a;
      }
      return copy;
    },
    fork: (label) => createRng(hashSeed(`${seed}:${label}`)),
    getState: () => ({ seed, state }),
  };
}
