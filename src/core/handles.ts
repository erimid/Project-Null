/**
 * Handles for a new player to choose from: a word, sometimes a second,
 * and usually a number, in the style of an underground board. The same
 * seed always gives the same list, so a spin can be stepped back.
 */
import { createRng } from './rng';

const FIRST = ['GHOST', 'STATIC', 'COLD', 'PAPER', 'NIGHT', 'GLASS', 'QUIET', 'DEAD', 'BLIND', 'IRON', 'SALT', 'ASH', 'LOW', 'GREY', 'THIN', 'LAST', 'SLOW', 'ODD', 'FAINT'] as const;
const SECOND = ['MOTH', 'WIRE', 'LAMP', 'FOX', 'CROW', 'TIDE', 'KEY', 'LINE', 'ROOK', 'HAND', 'SIGNAL', 'HOUR', 'DOOR', 'COIN', 'FINCH', 'ECHO', 'LATCH', 'VALVE', 'MARK', 'OTTER'] as const;
/** Long enough to read as a name, short enough for the corner of the desk. */
const LONGEST = 12;

/** The handle at `index` in the list a seed deals. Never one of `taken` (compared without case). */
export function handleAt(seed: number, index: number, taken: readonly string[] = []): string {
  const used = new Set(taken.map((name) => name.toUpperCase().replace(/[^A-Z0-9]/g, '')));
  const rng = createRng(`handle:${seed >>> 0}:${index}`);
  for (;;) {
    const first = FIRST[rng.int(0, FIRST.length - 1)]!;
    const second = SECOND[rng.int(0, SECOND.length - 1)]!;
    const number = rng.int(2, 99);
    const shape = rng.int(0, 3);
    const handle = shape === 0 ? `${first}_${number}` : shape === 1 ? `${second}_${number}` : shape === 2 ? `${first}${second}` : `${first}_${second}_${number % 10}`;
    if (handle.length <= LONGEST && !used.has(handle.replace(/[^A-Z0-9]/g, ''))) return handle;
  }
}
