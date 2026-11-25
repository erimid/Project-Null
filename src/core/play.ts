/**
 * Hands-on moments for three programs, in the spirit of the port line-up.
 * Each is optional: left alone, the program takes exactly as long as it
 * always did. Played well, it finishes about a third sooner.
 *
 * - Password Breaker, "catch": the code locks in one letter at a time. Now
 *   and then a letter still spinning flashes its true value; press it while
 *   it is lit and it locks early.
 * - Proxy Bypass, "pick": the proxy answers from five addresses, four of
 *   them decoys. The real one carries the same mark as the reply.
 * - Decrypter, "key": slide a strip of teeth under the lock until they fit,
 *   then turn it.
 *
 * Like the rings, everything is drawn from how long the task has run, so
 * it needs little state and survives a save.
 */
import type { GameState, Task } from './state';
import { effect } from './skills';
import { stream } from './streams';
import type { Content } from './world';

/** Letters in the code a Password Breaker works out. */
export const CATCH_CELLS = 8;
/** Cells in an address mark: a 3 by 3 grid, one bit each. */
export const MARK_CELLS = 9;
/** Addresses a proxy answers from. */
const PICK_OPTIONS = 5;
/** Teeth the lock needs, and how tall a tooth can be. */
const KEY_TEETH = 5;
const TOOTH_HEIGHTS = 3;
const KEY_STRIP = 13;

export interface CatchPlay {
  kind: 'catch';
  /** Letters locked as of `sinceMs`. Read through `catchLocked` for the count right now. */
  locked: boolean[];
  /** The task's running time at which the program started on its current letter. */
  sinceMs: number;
  /** Running time the program needs for each letter it locks itself. */
  shareMs: number;
  /** Picks which letter flashes in each cycle. */
  seed: number;
  /** One flash per cycle. */
  cycleMs: number;
  /** How long a flash stays lit. */
  litMs: number;
  /** The last cycle whose flash was caught, so one flash is one letter. */
  usedCycle: number;
  caught: number;
  missed: number;
}

export interface PickPlay {
  kind: 'pick';
  /** One mark per address, as bits of a 3 by 3 grid. */
  marks: number[];
  /** Which address is the real one. Its mark is the reply's mark. */
  real: number;
  /** Decoys already ruled out. */
  struck: boolean[];
  result: 'open' | 'won';
  missed: number;
  /** For the made-up addresses on screen. */
  seed: number;
}

export interface KeyPlay {
  kind: 'key';
  /** The tooth heights the lock needs, left to right. */
  lock: number[];
  /** The strip of teeth. Exactly one stretch of it fits the lock. */
  strip: number[];
  /** How far the strip has been slid: the tooth under the lock's first notch. */
  pos: number;
  result: 'open' | 'won';
  missed: number;
}

export type Play = CatchPlay | PickPlay | KeyPlay;

/** A small hash, for choices that must be the same every time they are asked for. */
function mix(seed: number, n: number): number {
  let hash = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(n + 1, 0xc2b2ae35);
  hash = Math.imul(hash ^ (hash >>> 15), 0x2c1b3c6d);
  hash = Math.imul(hash ^ (hash >>> 12), 0x297a2d39);
  return (hash ^ (hash >>> 15)) >>> 0;
}

const bits = (mark: number): number => {
  let count = 0;
  for (let i = 0; i < MARK_CELLS; i++) if (mark & (1 << i)) count++;
  return count;
};

/** The hands-on moment a new task starts with, if its kind has one. */
export function newPlay(state: GameState, content: Content, kind: Task['target']['kind'], durationMs: number, level = 1): Play | undefined {
  if (kind !== 'password' && kind !== 'proxy' && kind !== 'decrypt') return undefined;
  // A stream of its own, so the rings and the handshake draw what they always drew.
  const rng = stream(state, 'play');
  const steady = 1 + effect(state, content, 'steadyHand');
  const auto = effect(state, content, 'autoAlign') > 0;

  if (kind === 'password') {
    const cycleMs = Math.min(3000, Math.max(1200, durationMs / 5));
    return {
      kind: 'catch',
      locked: Array.from({ length: CATCH_CELLS }, () => false),
      sinceMs: 0,
      shareMs: durationMs / CATCH_CELLS,
      seed: rng.int(0, 0x7fffffff),
      cycleMs,
      litMs: Math.min(cycleMs * 0.45, content.rules.catchLitSeconds * 1000 * steady),
      usedCycle: -1,
      caught: 0,
      missed: 0,
    };
  }

  if (kind === 'proxy') {
    // A real mark with four or five cells lit, and decoys a cell or two off it: closer as the proxy gets better.
    let real = 0;
    while (bits(real) < 4 || bits(real) > 5) real = rng.int(1, (1 << MARK_CELLS) - 1);
    const marks = [real];
    while (marks.length < PICK_OPTIONS) {
      let decoy = real;
      const flips = level >= 3 ? 1 : 2;
      for (let i = 0; i < flips; i++) decoy ^= 1 << rng.int(0, MARK_CELLS - 1);
      if (decoy !== 0 && !marks.includes(decoy)) marks.push(decoy);
    }
    const order = rng.shuffle(marks);
    const struck = order.map(() => false);
    // Auto-align rules two decoys out before you look.
    if (auto) {
      let left = 2;
      order.forEach((mark, i) => {
        if (mark !== real && left > 0) {
          struck[i] = true;
          left--;
        }
      });
    }
    return { kind: 'pick', marks: order, real: order.indexOf(real), struck, result: 'open', missed: 0, seed: rng.int(0, 0x7fffffff) };
  }

  // The key. One stretch fits; unless Auto-align tidied it away, another stretch is one tooth off.
  const lock = Array.from({ length: KEY_TEETH }, () => rng.int(1, TOOTH_HEIGHTS));
  // Never a flat lock: it has to be recognisable.
  if (lock.every((tooth) => tooth === lock[0])) lock[rng.int(0, KEY_TEETH - 1)] = (lock[0]! % TOOTH_HEIGHTS) + 1;
  const last = KEY_STRIP - KEY_TEETH;
  const side = rng.chance(0.5);
  const at = side ? rng.int(0, 2) : rng.int(last - 2, last);
  const fits = (strip: number[], pos: number) => lock.every((tooth, i) => strip[pos + i] === tooth);
  let strip: number[] = [];
  for (let attempt = 0; attempt < 40; attempt++) {
    strip = Array.from({ length: KEY_STRIP }, () => rng.int(1, TOOTH_HEIGHTS));
    lock.forEach((tooth, i) => (strip[at + i] = tooth));
    if (!auto) {
      const near = side ? rng.int(last - 2, last) : rng.int(0, 2);
      const off = rng.int(0, KEY_TEETH - 1);
      lock.forEach((tooth, i) => (strip[near + i] = i === off ? (tooth % TOOTH_HEIGHTS) + 1 : tooth));
    }
    let matches = 0;
    for (let pos = 0; pos <= last; pos++) if (fits(strip, pos)) matches++;
    if (matches === 1) break;
  }
  return { kind: 'key', lock, strip, pos: Math.floor(last / 2), result: 'open', missed: 0 };
}

/** How many letters the program has locked by itself since the count was last settled. */
function autoLocked(task: Task, play: CatchPlay): number {
  const open = play.locked.filter((locked) => !locked).length;
  if (play.shareMs <= 0) return open;
  // The last letter locks as the task ends, not before.
  return Math.max(0, Math.min(open - 1, Math.floor((task.progressMs - play.sinceMs) / play.shareMs)));
}

/** Which letters of the code are locked right now. The program works left to right. */
export function catchLocked(task: Task): boolean[] {
  const play = task.play;
  if (play?.kind !== 'catch') return [];
  let left = autoLocked(task, play);
  return play.locked.map((locked) => {
    if (locked) return true;
    if (left <= 0) return false;
    left--;
    return true;
  });
}

/** The letter that is flashing its true value right now, or null. Never the one the program is about to lock. */
export function catchFlash(task: Task): number | null {
  const play = task.play;
  if (play?.kind !== 'catch') return null;
  const cycle = Math.floor(task.progressMs / play.cycleMs);
  if (cycle === play.usedCycle) return null;
  const phase = task.progressMs - cycle * play.cycleMs;
  const from = play.cycleMs * 0.5;
  if (phase < from || phase > from + play.litMs) return null;
  const open = catchLocked(task).flatMap((locked, cell) => (locked ? [] : [cell]));
  const choices = open.slice(1);
  if (choices.length === 0) return null;
  // Walk the cells from a start that changes each cycle, so the flash stays put if a letter locks mid-flash.
  const start = mix(play.seed, cycle) % CATCH_CELLS;
  for (let step = 0; step < CATCH_CELLS; step++) {
    const cell = (start + step * 3) % CATCH_CELLS;
    if (choices.includes(cell)) return cell;
  }
  return null;
}

/**
 * Presses one letter of the code. On the flashing letter, it locks early
 * and its share comes off the time left; anywhere else adds time. Returns
 * a reason only if there was nothing to press.
 */
export function catchLetter(state: GameState, content: Content, taskId: string, cell: number): string | null {
  const task = state.tasks.find((item) => item.id === taskId);
  const play = task?.play;
  if (!task || play?.kind !== 'catch') return 'That program has already stopped.';
  if (!Number.isInteger(cell) || cell < 0 || cell >= CATCH_CELLS) return 'No such letter.';
  const lit = catchFlash(task);
  const now = catchLocked(task);
  const auto = effect(state, content, 'autoAlign') > 0;
  if (now[cell] && !(auto && lit !== null)) return 'That letter is already locked.';
  // Settle what the program has done by itself, keeping its progress on the letter it is working on.
  const done = autoLocked(task, play);
  play.locked = now;
  play.sinceMs += done * play.shareMs;
  // With Auto-align a press anywhere on the code catches the flash.
  const hit = lit !== null && (lit === cell || auto);
  if (!hit || lit === null) {
    const missMs = content.rules.catchMissSeconds * 1000;
    task.durationMs += missMs;
    play.sinceMs += missMs;
    play.missed++;
    return null;
  }
  const open = play.locked.filter((locked) => !locked).length;
  const keep = (open - 1) / open;
  play.locked[lit] = true;
  const remaining = Math.max(0, task.durationMs - task.progressMs);
  task.durationMs = task.progressMs + remaining * keep;
  play.sinceMs = task.progressMs - (task.progressMs - play.sinceMs) * keep;
  play.usedCycle = Math.floor(task.progressMs / play.cycleMs);
  play.caught++;
  return null;
}

/** The mark the proxy's reply carries: the real address has the same one. */
export function replyMark(play: PickPlay): number {
  return play.marks[play.real] ?? 0;
}

/** Names one of the proxy's addresses as the real one. Right cuts the time left; wrong rules it out and adds time. */
export function pickAddress(state: GameState, content: Content, taskId: string, option: number): string | null {
  const task = state.tasks.find((item) => item.id === taskId);
  const play = task?.play;
  if (!task || play?.kind !== 'pick') return 'That program has already stopped.';
  if (play.result !== 'open') return 'The real address is already found.';
  if (!Number.isInteger(option) || option < 0 || option >= play.marks.length) return 'No such address.';
  if (play.struck[option]) return 'That address is already ruled out.';
  if (option !== play.real) {
    play.struck[option] = true;
    play.missed++;
    task.durationMs += content.rules.pickMissSeconds * 1000;
    return null;
  }
  play.result = 'won';
  play.struck = play.marks.map((_, i) => i !== play.real);
  task.durationMs = task.progressMs + Math.max(0, task.durationMs - task.progressMs) * (1 - content.rules.pickCutFactor);
  return null;
}

/** True when the teeth under the lock fit it. */
export function keyFits(play: KeyPlay, pos = play.pos): boolean {
  return play.lock.every((tooth, i) => play.strip[pos + i] === tooth);
}

/** Slides the key strip. Free, and can be done as often as you like. */
export function slideKey(state: GameState, taskId: string, pos: number): string | null {
  const task = state.tasks.find((item) => item.id === taskId);
  const play = task?.play;
  if (!task || play?.kind !== 'key') return 'That program has already stopped.';
  if (play.result !== 'open') return 'The key has already turned.';
  if (!Number.isInteger(pos)) return 'No such place on the key.';
  play.pos = Math.max(0, Math.min(play.strip.length - play.lock.length, pos));
  return null;
}

/** Turns the key where it sits. A fit cuts the time left; a jam adds time. */
export function turnKey(state: GameState, content: Content, taskId: string): string | null {
  const task = state.tasks.find((item) => item.id === taskId);
  const play = task?.play;
  if (!task || play?.kind !== 'key') return 'That program has already stopped.';
  if (play.result !== 'open') return 'The key has already turned.';
  if (!keyFits(play)) {
    play.missed++;
    task.durationMs += content.rules.keyMissSeconds * 1000;
    return null;
  }
  play.result = 'won';
  task.durationMs = task.progressMs + Math.max(0, task.durationMs - task.progressMs) * (1 - content.rules.keyCutFactor);
  return null;
}

/** A core loft starts on a pick or a key once the program is this far through. */
const LOFT_AFTER = 0.3;

/**
 * Plays a task's hands-on moment for a player who owns a core loft: a lit
 * letter is caught half-way through its flash, and the proxy's address is
 * named or the key turned once the program is a little way in. A quick
 * hand still beats it.
 */
export function autoPlay(state: GameState, content: Content, task: Task): void {
  const play = task.play;
  if (!play) return;
  if (play.kind === 'catch') {
    const lit = catchFlash(task);
    if (lit === null) return;
    const cycle = Math.floor(task.progressMs / play.cycleMs);
    const litFor = task.progressMs - cycle * play.cycleMs - play.cycleMs * 0.5;
    if (litFor >= play.litMs * 0.5) catchLetter(state, content, task.id, lit);
    return;
  }
  if (play.result !== 'open' || task.progressMs < task.durationMs * LOFT_AFTER) return;
  if (play.kind === 'pick') {
    pickAddress(state, content, task.id, play.real);
    return;
  }
  for (let pos = 0; pos <= play.strip.length - play.lock.length; pos++) {
    if (!keyFits(play, pos)) continue;
    play.pos = pos;
    turnKey(state, content, task.id);
    return;
  }
}
