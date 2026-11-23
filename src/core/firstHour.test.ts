/**
 * Small first-hour rules: the first easy password breaks quickly, and a
 * story attack is never lost behind a chance one.
 */
import { describe, expect, it } from 'vitest';
import { applyAction, beginRaid, checkTask, createGame, scheduleRaid, syncWithContent, type Content, type GameState } from './index';
import { content as base, rivalHome, testRivals, testRules, testServers } from './testWorld';

const quietCorp = testServers.map((server) => (server.id === 'corp' ? { ...server, security: { ...server.security, monitor: 0 } } : server));

function setup(servers = quietCorp): { state: GameState; content: Content } {
  const content: Content = { ...base, servers: [...servers, rivalHome], rivals: testRivals, rules: { ...testRules, easyCrackSpeed: 2.5, easyCrackJobs: 2 } };
  const state = syncWithContent(createGame({ seed: 4, handle: 'T', startDate: '2034-03-14T08:00:00Z', startingBalance: 5000 }), content);
  state.knownServers = content.servers.map((server) => server.id);
  return { state, content };
}

const crackSeconds = (state: GameState, content: Content): number => {
  const check = checkTask(state, content, state.connections[0]!, { kind: 'password', user: 'admin' });
  return check.ok ? check.seconds : NaN;
};

describe('the first hour', () => {
  it('breaks an easy password on an unwatched server quickly, but only for the first jobs', () => {
    const { state, content } = setup();
    expect(applyAction(state, { type: 'connect', serverId: 'corp' }, content)).toEqual({ ok: true });
    const quick = crackSeconds(state, content);
    state.contracts.completed.push('a', 'b');
    const usual = crackSeconds(state, content);
    expect(quick).toBeCloseTo(usual / 2.5);
  });

  it('does not hurry a password anyone is watching', () => {
    const { state, content } = setup(testServers);
    expect(applyAction(state, { type: 'connect', serverId: 'corp' }, content)).toEqual({ ok: true });
    const watched = crackSeconds(state, content);
    state.contracts.completed.push('a', 'b');
    expect(crackSeconds(state, content)).toBe(watched);
  });

  it('queues a story attack behind one under way instead of losing it', () => {
    const { state, content } = setup();
    state.player.rating = 10;
    beginRaid(state, content, 'thief', false);
    scheduleRaid(state, content, 'wrecker', true);
    expect(state.raidPending).toEqual({ attackerId: 'wrecker', story: true });
    // A chance one still never stacks.
    state.raidPending = null;
    scheduleRaid(state, content, 'wrecker', false);
    expect(state.raidPending).toBeNull();
  });
});
