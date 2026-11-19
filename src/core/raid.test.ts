import { describe, expect, it } from 'vitest';
import { applyAction, beginRaid, createGame, raidPortAngle, scheduleRaid, syncWithContent, tick, type Content, type GameState } from './index';
import { maybeScheduleRaid } from './raid';
import { content as base, rivalHome, testRivals, testServers, testRules } from './testWorld';

/** The test world with two rival hackers and a home to trace them to. */
function world(rules = testRules): Content {
  return { ...base, servers: [...testServers, rivalHome], rivals: testRivals, rules };
}

function game(content: Content, rating = 10): GameState {
  const state = syncWithContent(
    createGame({ seed: 3, handle: 'T', startDate: '2034-03-14T08:00:00Z', startingBalance: 5000 }),
    content,
  );
  state.player.rating = rating;
  return state;
}

/** Runs the clock for about `ms`, stopping early once the attack is over. */
function run(state: GameState, content: Content, ms: number): void {
  for (let left = ms; left > 0 && state.raid; left -= 100) tick(state, 100, content);
}

/** Lines up and locks every ring of the open port, by hand, to close it. */
function closePort(state: GameState, content: Content): void {
  expect(applyAction(state, { type: 'defendPort' }, content)).toEqual({ ok: true });
  const port = state.raid!.port!;
  const tol = content.rules.ringToleranceDegrees;
  port.locked.forEach((_, ring) => {
    if (!state.raid?.port) return;
    for (let age = 0; age <= 200_000; age += 5) {
      state.raid.port.ageMs = age;
      const angle = raidPortAngle(state.raid.port, ring);
      if (Math.min(angle, 360 - angle) <= tol) break;
    }
    applyAction(state, { type: 'defendRing', ring }, content);
  });
}

describe('enemy hackers', () => {
  it('a scheduled attack waits while connected and lands once offline', () => {
    const content = world();
    const state = game(content);
    state.knownServers.push('relay-a');
    expect(applyAction(state, { type: 'connect', serverId: 'relay-a' }, content)).toEqual({ ok: true });

    scheduleRaid(state, content, 'thief');
    tick(state, 100, content);
    expect(state.raid).toBeNull(); // still connected, so it holds off

    applyAction(state, { type: 'disconnectAll' }, content);
    tick(state, 100, content);
    expect(state.raid?.attackerId).toBe('thief');
    expect(state.messages.some((m) => m.subject === 'Intrusion')).toBe(true);
  });

  it('breaks in and takes credits if you do nothing', () => {
    const content = world();
    const state = game(content);
    const before = state.player.balance;
    beginRaid(state, content, 'thief');
    run(state, content, 40_000);
    expect(state.raid).toBeNull();
    expect(state.player.balance).toBeLessThan(before);
    expect(state.messages.some((m) => m.subject === 'In: Thief')).toBe(true);
  });

  it('closing ports buys time for a counter-trace, which wins their address', () => {
    const content = world();
    const state = game(content);
    beginRaid(state, content, 'thief');
    expect(applyAction(state, { type: 'traceBack' }, content)).toEqual({ ok: true });
    // Run the trace to the end, shutting a port whenever the break-in gets close.
    for (let i = 0; i < 400 && state.raid; i++) {
      tick(state, 100, content);
      if (state.raid && state.raid.breachMs > state.raid.breachTotalMs * 0.5 && !state.raid.port) closePort(state, content);
    }
    expect(state.raid).toBeNull();
    expect(state.knownServers).toContain('rival-home');
    expect(state.messages.some((m) => m.subject === 'Traced Thief')).toBe(true);
  });

  it('a vandal wipes an unlocked file but not a locked one', () => {
    const content = world();
    const state = game(content);
    state.player.files.push({ name: 'keep.dat', sizeGq: 1, from: 'corp' }, { name: 'drop.dat', sizeGq: 1, from: 'corp' });
    beginRaid(state, content, 'wrecker');
    expect(applyAction(state, { type: 'lockFile', name: 'keep.dat' }, content)).toEqual({ ok: true });
    run(state, content, 60_000);
    expect(state.raid).toBeNull();
    expect(state.player.files.some((f) => f.name === 'keep.dat')).toBe(true);
    expect(state.player.files.some((f) => f.name === 'drop.dat')).toBe(false);
  });

  it('pulling the plug ends the attack with nothing lost and nothing learned', () => {
    const content = world();
    const state = game(content);
    const before = state.player.balance;
    beginRaid(state, content, 'thief');
    expect(applyAction(state, { type: 'pullPlug' }, content)).toEqual({ ok: true });
    expect(state.raid).toBeNull();
    expect(state.player.balance).toBe(before);
    expect(state.knownServers).not.toContain('rival-home');
    expect(state.messages.some((m) => m.subject === 'Plug pulled')).toBe(true);
  });

  it('random attacks are gated by rating, pay and a cool-down', () => {
    const content = world({ ...testRules, raidChance: 1, raidProfilePay: 300, raidMinRating: 4, raidCooldownHours: 24 });
    const low = game(content, 3);
    maybeScheduleRaid(low, content, 1000);
    expect(low.raidPending).toBeNull(); // rating too low

    const okRating = game(content, 6);
    maybeScheduleRaid(okRating, content, 100);
    expect(okRating.raidPending).toBeNull(); // pay too small

    maybeScheduleRaid(okRating, content, 1000);
    expect(okRating.raidPending).not.toBeNull(); // high enough, and the roll always hits here
    const quietUntil = okRating.raidQuietUntilMs;
    okRating.raidPending = null;
    maybeScheduleRaid(okRating, content, 1000);
    expect(okRating.raidPending).toBeNull(); // still in the cool-down
    expect(okRating.raidQuietUntilMs).toBe(quietUntil);
  });
});
