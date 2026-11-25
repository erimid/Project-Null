import { describe, expect, it } from 'vitest';
import {
  applyAction,
  catchFlash,
  catchLocked,
  createGame,
  deserializeGame,
  keyFits,
  serializeGame,
  syncWithContent,
  tick,
  type Action,
  type Content,
  type GameState,
  type KeyPlay,
  type PickPlay,
} from './index';
import { content, testServers } from './testWorld';

/*
 * Test world reminders: the breaker takes 10s on corp's password, the
 * proxy bypass 6s, the decrypter 6s plus 1s per GB. A flash is lit for
 * half a second; a wrong letter costs 1s, a decoy or a jammed key 2s, and
 * a right pick or turn takes 40% off the time left.
 */

const quiet: Content = {
  ...content,
  servers: testServers.map((server) =>
    server.id === 'corp' ? { ...server, security: { password: 1, proxy: 1, firewall: 1, monitor: 0 }, traceSecondsPerHop: 10_000 } : server,
  ),
};

function game(skills: Record<string, number> = {}, seed = 5) {
  const state: GameState = syncWithContent(createGame({ seed, handle: 'T', startDate: '2034-03-14T08:00:00Z', startingBalance: 100 }), quiet);
  state.knownServers = quiet.servers.map((server) => server.id);
  state.player.skills = skills;
  const act = (action: Action) => applyAction(state, action, quiet);
  const ok = (action: Action) => expect(act(action)).toEqual({ ok: true });
  const refused = (action: Action, pattern: RegExp) => {
    const result = act(action);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(pattern);
  };
  ok({ type: 'connect', serverId: 'corp' });
  const id = state.connections[0]!.id;
  const wait = (seconds: number) => tick(state, seconds * 1000, quiet);
  const task = () => state.tasks[0]!;
  return { state, id, act, ok, refused, wait, task };
}

/** Runs the clock in small steps until `done` says stop. Returns the seconds it took. */
function until(h: ReturnType<typeof game>, done: () => boolean, limit = 60): number {
  let seconds = 0;
  while (!done()) {
    h.wait(0.05);
    seconds += 0.05;
    if (seconds > limit) throw new Error('it never happened');
  }
  return seconds;
}

describe('catching letters of a password', () => {
  const start = (skills?: Record<string, number>) => {
    const h = game(skills);
    h.ok({ type: 'runProgram', connectionId: h.id, target: { kind: 'password', user: 'admin' } });
    return h;
  };

  it('changes nothing for a player who leaves it alone: one letter in eight at a time, done on time', () => {
    const h = start();
    expect(h.task().durationMs).toBe(10_000);
    expect(catchLocked(h.task()).filter(Boolean)).toHaveLength(0);
    h.wait(1.3);
    expect(catchLocked(h.task())).toEqual([true, false, false, false, false, false, false, false]);
    h.wait(5);
    expect(catchLocked(h.task()).filter(Boolean)).toHaveLength(5);
    h.wait(3.6);
    // The last letter locks as the program ends.
    expect(catchLocked(h.task()).filter(Boolean)).toHaveLength(7);
    h.wait(0.2);
    expect(h.state.tasks).toHaveLength(0);
    expect(h.state.player.passwords.corp).toEqual(['admin']);
  });

  it('flashes one open letter in each cycle, never the one the program is on', () => {
    const h = start();
    expect(catchFlash(h.task())).toBeNull();
    until(h, () => catchFlash(h.task()) !== null);
    const lit = catchFlash(h.task())!;
    const open = catchLocked(h.task()).flatMap((locked, cell) => (locked ? [] : [cell]));
    expect(open.slice(1)).toContain(lit);
    until(h, () => catchFlash(h.task()) === null);
  });

  it('locks the flashing letter early and takes its share off the time left', () => {
    const h = start();
    until(h, () => catchFlash(h.task()) !== null);
    const lit = catchFlash(h.task())!;
    const before = h.task().durationMs;
    const left = before - h.task().progressMs;
    const open = catchLocked(h.task()).filter((locked) => !locked).length;
    h.ok({ type: 'catchLetter', taskId: h.task().id, cell: lit });
    expect(catchLocked(h.task())[lit]).toBe(true);
    expect(before - h.task().durationMs).toBeCloseTo(left / open, 3);
    // One flash, one letter.
    expect(catchFlash(h.task())).toBeNull();
  });

  it('finishes about a third sooner when every flash is caught', () => {
    const h = start();
    const seconds = until(h, () => {
      const task = h.state.tasks[0];
      if (!task) return true;
      const lit = catchFlash(task);
      if (lit !== null) h.ok({ type: 'catchLetter', taskId: task.id, cell: lit });
      return false;
    });
    expect(seconds).toBeGreaterThan(5.5);
    expect(seconds).toBeLessThan(8);
    expect(h.state.player.passwords.corp).toEqual(['admin']);
  });

  it('adds a second for a press on the wrong letter, or when nothing is lit', () => {
    const h = start();
    h.wait(0.2);
    h.ok({ type: 'catchLetter', taskId: h.task().id, cell: 5 });
    expect(h.task().durationMs).toBe(11_000);
    until(h, () => catchFlash(h.task()) !== null);
    const lit = catchFlash(h.task())!;
    const wrong = catchLocked(h.task()).findIndex((locked, cell) => !locked && cell !== lit);
    h.ok({ type: 'catchLetter', taskId: h.task().id, cell: wrong });
    expect(h.task().durationMs).toBe(12_000);
    // The code still comes out whole at the end.
    until(h, () => h.state.tasks.length === 0);
    expect(h.state.player.passwords.corp).toEqual(['admin']);
  });

  it('refuses a letter that is already locked, without a penalty', () => {
    const h = start();
    h.wait(1.3);
    h.refused({ type: 'catchLetter', taskId: h.task().id, cell: 0 }, /already locked/);
    expect(h.task().durationMs).toBe(10_000);
    h.refused({ type: 'catchLetter', taskId: 'nope', cell: 0 }, /already stopped/);
  });

  it('stays lit longer with Steady hand, and Auto-align catches the flash from any letter', () => {
    const plain = start();
    const steady = start({ steady: 1, align: 1 });
    expect(plain.task().play).toMatchObject({ kind: 'catch', litMs: 500 });
    expect(steady.task().play).toMatchObject({ kind: 'catch', litMs: 750 });
    until(steady, () => catchFlash(steady.task()) !== null);
    const lit = catchFlash(steady.task())!;
    const other = catchLocked(steady.task()).findIndex((locked, cell) => !locked && cell !== lit);
    steady.ok({ type: 'catchLetter', taskId: steady.task().id, cell: other });
    expect(catchLocked(steady.task())[lit]).toBe(true);
    expect(steady.task().durationMs).toBeLessThan(10_000);
  });

  it('carries on through a save', () => {
    const h = start();
    until(h, () => catchFlash(h.task()) !== null);
    h.ok({ type: 'catchLetter', taskId: h.task().id, cell: catchFlash(h.task())! });
    h.wait(1);
    const loaded = deserializeGame(serializeGame(h.state, '2030-01-01T00:00:00Z')).state;
    expect(loaded.tasks[0]).toEqual(h.task());
    expect(catchLocked(loaded.tasks[0]!)).toEqual(catchLocked(h.task()));
  });
});

describe('picking the real address behind a proxy', () => {
  const start = (skills?: Record<string, number>, seed?: number) => {
    const h = game(skills, seed);
    h.state.player.passwords.corp = ['admin'];
    h.ok({ type: 'login', connectionId: h.id, user: 'admin' });
    h.ok({ type: 'runProgram', connectionId: h.id, target: { kind: 'proxy' } });
    const play = () => h.task().play as PickPlay;
    return { ...h, play };
  };

  it('offers five different marks, one of them the real one', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const h = start({}, seed);
      const play = h.play();
      expect(play.kind).toBe('pick');
      expect(new Set(play.marks).size).toBe(5);
      expect(play.struck).toEqual([false, false, false, false, false]);
      expect(play.real).toBeGreaterThanOrEqual(0);
    }
  });

  it('takes 40% off the time left for the real address, once', () => {
    const h = start();
    h.wait(1);
    h.ok({ type: 'pickAddress', taskId: h.task().id, option: h.play().real });
    expect(h.task().durationMs).toBeCloseTo(1000 + 5000 * 0.6, 3);
    expect(h.play().result).toBe('won');
    h.refused({ type: 'pickAddress', taskId: h.task().id, option: 0 }, /already found/);
    until(h, () => h.state.tasks.length === 0);
    expect(h.state.connections[0]!.bypassed.proxy).toBe(true);
  });

  it('rules a decoy out and adds two seconds, and the real one can still be named', () => {
    const h = start();
    const decoy = h.play().real === 0 ? 1 : 0;
    h.ok({ type: 'pickAddress', taskId: h.task().id, option: decoy });
    expect(h.task().durationMs).toBe(8000);
    expect(h.play().struck[decoy]).toBe(true);
    h.refused({ type: 'pickAddress', taskId: h.task().id, option: decoy }, /ruled out/);
    h.ok({ type: 'pickAddress', taskId: h.task().id, option: h.play().real });
    expect(h.task().durationMs).toBeCloseTo(8000 * 0.6, 3);
  });

  it('takes as long as ever when left alone', () => {
    const h = start();
    h.wait(5.9);
    expect(h.state.tasks).toHaveLength(1);
    h.wait(0.2);
    expect(h.state.connections[0]!.bypassed.proxy).toBe(true);
  });

  it('starts with two decoys ruled out for a player with Auto-align', () => {
    const h = start({ steady: 1, align: 1 });
    expect(h.play().struck.filter(Boolean)).toHaveLength(2);
    expect(h.play().struck[h.play().real]).toBe(false);
  });
});

describe('sliding the key of a decrypter', () => {
  const start = (skills?: Record<string, number>, seed?: number) => {
    const h = game(skills, seed);
    h.state.player.files.push({ name: 'sealed.dat', sizeGq: 2, from: 'corp', takenMs: 0, encrypted: 1 });
    h.ok({ type: 'decryptFile', name: 'sealed.dat' });
    const play = () => h.task().play as KeyPlay;
    const fit = () => {
      const play = h.task().play as KeyPlay;
      return Array.from({ length: play.strip.length - play.lock.length + 1 }, (_, pos) => pos).filter((pos) => keyFits(play, pos));
    };
    return { ...h, play, fit };
  };

  it('has exactly one place where the teeth fit, and it is not where the key starts', () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const h = start({}, seed);
      expect(h.fit()).toHaveLength(1);
      expect(h.fit()[0]).not.toBe(h.play().pos);
      expect(keyFits(h.play())).toBe(false);
    }
  });

  it('slides for free and stays on the strip', () => {
    const h = start();
    h.ok({ type: 'slideKey', taskId: h.task().id, pos: 99 });
    expect(h.play().pos).toBe(h.play().strip.length - h.play().lock.length);
    h.ok({ type: 'slideKey', taskId: h.task().id, pos: -3 });
    expect(h.play().pos).toBe(0);
    expect(h.task().durationMs).toBe(8000);
  });

  it('jams where it does not fit, and cuts the time left where it does', () => {
    const h = start();
    h.ok({ type: 'turnKey', taskId: h.task().id });
    expect(h.task().durationMs).toBe(10_000);
    expect(h.play().missed).toBe(1);
    h.wait(2);
    h.ok({ type: 'slideKey', taskId: h.task().id, pos: h.fit()[0]! });
    h.ok({ type: 'turnKey', taskId: h.task().id });
    expect(h.task().durationMs).toBeCloseTo(2000 + 8000 * 0.6, 3);
    h.refused({ type: 'turnKey', taskId: h.task().id }, /already turned/);
    h.refused({ type: 'slideKey', taskId: h.task().id, pos: 0 }, /already turned/);
    until(h, () => h.state.tasks.length === 0);
    expect(h.state.player.files[0]!.encrypted).toBeUndefined();
  });
});

describe('programs with nothing to play', () => {
  it('carry no hands-on moment', () => {
    const h = game();
    h.state.player.passwords.corp = ['admin'];
    h.ok({ type: 'login', connectionId: h.id, user: 'admin' });
    h.ok({ type: 'runProgram', connectionId: h.id, target: { kind: 'firewall' } });
    expect(h.task().play).toBeUndefined();
    expect(h.task().puzzle).toBeDefined();
  });
});
