import { STATE_VERSION } from './state';
import { describe, expect, it } from 'vitest';
import {
  applyAction,
  createGame,
  deserializeGame,
  evidenceCount,
  hopUnderTrace,
  ringAngle,
  serializeGame,
  syncWithContent,
  tick,
  traceReport,
  type Action,
  type Content,
  type GameState,
} from './index';
import { content, testServers } from './testWorld';

/*
 * Test world reminders: corp has every layer at level 1 and takes 10s a
 * hop to trace; relay A doubles that, relay B and the directory do not.
 * Firewall bypass takes 6s, the log deleter 3s. A ring locks within 20
 * degrees of the marker; a miss adds 2s. Fines are 20 per security level.
 */

const withCorp = (change: Partial<(typeof testServers)[number]>): Content => ({
  ...content,
  servers: testServers.map((server) => (server.id === 'corp' ? { ...server, ...change } : server)),
});
/** Corp with nobody watching, for tests that are not about the trace. */
const quiet = withCorp({ security: { password: 1, proxy: 1, firewall: 1, monitor: 0 }, traceSecondsPerHop: 10_000 });

function inside(route: string[], world: Content = content) {
  const state: GameState = syncWithContent(
    createGame({ seed: 5, handle: 'T', startDate: '2034-03-14T08:00:00Z', startingBalance: 100 }),
    world,
  );
  state.knownServers = world.servers.map((server) => server.id);
  state.player.passwords.corp = ['admin'];
  const act = (action: Action) => applyAction(state, action, world);
  const ok = (action: Action) => expect(act(action)).toEqual({ ok: true });
  const refused = (action: Action, pattern: RegExp) => {
    const result = act(action);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(pattern);
  };
  for (const serverId of route) ok({ type: 'addHop', serverId });
  ok({ type: 'connect', serverId: 'corp' });
  const id = state.connections[0]!.id;
  ok({ type: 'login', connectionId: id, user: 'admin' });
  const wait = (seconds: number) => tick(state, seconds * 1000, world);
  const connection = () => state.connections[0]!;
  const playerLogs = (serverId: string) => state.servers[serverId]!.logs.filter((l) => l.byPlayer).map((l) => l.text);
  return { state, id, ok, refused, wait, connection, playerLogs };
}

describe('the port line-up', () => {
  const start = () => {
    const h = inside(['relay-a'], quiet);
    h.ok({ type: 'runProgram', connectionId: h.id, target: { kind: 'firewall' } });
    const task = () => h.state.tasks[0]!;
    /** Runs the clock in small steps until the ring's port is under the marker. */
    const waitForRing = (ring: number) => {
      for (let i = 0; i < 400; i++) {
        const angle = ringAngle(task(), ring);
        if (Math.min(angle, 360 - angle) <= 8) return;
        h.wait(0.01);
      }
      throw new Error('the ring never came round');
    };
    return { ...h, task, waitForRing };
  };

  it('gives a level 1 firewall three rings, turning at different speeds and in both directions', () => {
    const { task } = start();
    const puzzle = task().puzzle!;
    expect(puzzle.locked).toEqual([false, false, false]);
    expect(puzzle.speeds).toEqual([70, -100, 130]);
    for (const angle of puzzle.startAngles) expect(angle).toBeGreaterThanOrEqual(40);
  });

  it('gives a stronger firewall more and faster rings', () => {
    const h = inside(['relay-a'], withCorp({ security: { password: 1, proxy: 0, firewall: 3, monitor: 0 } }));
    h.ok({ type: 'runProgram', connectionId: h.id, target: { kind: 'firewall' } });
    const puzzle = h.state.tasks[0]!.puzzle!;
    expect(puzzle.speeds).toHaveLength(5);
    expect(Math.abs(puzzle.speeds[0]!)).toBeGreaterThan(70);
  });

  it('is only part of the firewall bypass', () => {
    const h = inside(['relay-a'], quiet);
    h.ok({ type: 'runProgram', connectionId: h.id, target: { kind: 'proxy' } });
    expect(h.state.tasks[0]!.puzzle).toBeUndefined();
    h.refused({ type: 'lockRing', taskId: h.state.tasks[0]!.id, ring: 0 }, /already stopped/);
  });

  it('moves each ring with the program, the same way every time for the same game', () => {
    const a = start();
    const b = start();
    expect(a.task().puzzle).toEqual(b.task().puzzle);
    const before = ringAngle(a.task(), 0);
    a.wait(1);
    expect(ringAngle(a.task(), 0)).toBeCloseTo((before + 70) % 360, 5);
  });

  it('takes a ring\'s share off the time left when it is locked on the marker', () => {
    const { ok, task, waitForRing } = start();
    waitForRing(0);
    const left = task().durationMs - task().progressMs;
    ok({ type: 'lockRing', taskId: task().id, ring: 0 });
    expect(task().puzzle!.locked).toEqual([true, false, false]);
    expect(task().durationMs - task().progressMs).toBeCloseTo((left * 2) / 3, 5);
    expect(ringAngle(task(), 0)).toBe(0);
  });

  it('adds time for a miss and leaves the ring turning', () => {
    const { ok, wait, task } = start();
    // Find a moment when ring 1 is well away from the marker.
    while (Math.min(ringAngle(task(), 1), 360 - ringAngle(task(), 1)) < 60) wait(0.05);
    const before = task().durationMs;
    ok({ type: 'lockRing', taskId: task().id, ring: 1 });
    expect(task().durationMs).toBe(before + 2_000);
    expect(task().puzzle!.locked[1]).toBe(false);
  });

  it('finishes the bypass at once when every ring is locked', () => {
    const { state, ok, refused, wait, task, waitForRing, connection } = start();
    for (const ring of [0, 1, 2]) {
      waitForRing(ring);
      ok({ type: 'lockRing', taskId: task().id, ring });
    }
    const id = task().id;
    expect(task().progressMs).toBeLessThan(6_000);
    wait(0.01);
    expect(state.tasks).toEqual([]);
    expect(connection().bypassed.firewall).toBe(true);
    refused({ type: 'lockRing', taskId: id, ring: 0 }, /already stopped/);
  });

  it('refuses a ring that is already locked or does not exist', () => {
    const { ok, refused, task, waitForRing } = start();
    waitForRing(2);
    ok({ type: 'lockRing', taskId: task().id, ring: 2 });
    refused({ type: 'lockRing', taskId: task().id, ring: 2 }, /already lined up/);
    refused({ type: 'lockRing', taskId: task().id, ring: 9 }, /already lined up/);
  });

  it('still finishes on its own if left alone, and survives a save', () => {
    const { state, wait, connection } = start();
    wait(2);
    const loaded = syncWithContent(deserializeGame(serializeGame(state, '')).state, quiet);
    expect(loaded).toEqual(state);
    wait(4.1);
    expect(connection().bypassed.firewall).toBe(true);
  });
});

describe('scrubbing the log', () => {
  const ready = () => {
    const h = inside(['relay-a'], quiet);
    h.connection().bypassed.proxy = true;
    const logs = () => h.state.servers.corp!.logs;
    return { ...h, logs };
  };

  it('removes several lines in one run, quicker than one at a time', () => {
    const { state, id, ok, wait, logs } = ready();
    const ids = logs().map((entry) => entry.id);
    expect(ids).toHaveLength(2);
    ok({ type: 'runProgram', connectionId: id, target: { kind: 'deleteLog', logIds: ids } });
    // 3 seconds for the first line and a third of that for the second.
    expect(state.tasks[0]!.durationMs).toBe(4_000);
    wait(4);
    expect(logs()).toEqual([]);
  });

  it('needs at least one line, and every line must still exist', () => {
    const { id, refused, logs } = ready();
    refused({ type: 'runProgram', connectionId: id, target: { kind: 'deleteLog', logIds: [] } }, /Pick the lines/);
    refused({ type: 'runProgram', connectionId: id, target: { kind: 'deleteLog', logIds: [logs()[0]!.id, 99_999] } }, /gone/);
  });
});

describe('rerouting', () => {
  /** Inside corp through relay A then relay B, with the trace running. */
  const traced = () => {
    const h = inside(['relay-a', 'relay-b']);
    h.wait(8);
    expect(h.connection().trace.status).toBe('active');
    return h;
  };

  it('swaps the relay being traced and makes the trace start that step again', () => {
    const { id, ok, wait, connection, playerLogs } = traced();
    wait(6);
    // The trace starts with the last relay (B, 10s).
    expect(hopUnderTrace(connection())).toBe(1);
    ok({ type: 'reroute', connectionId: id, serverId: 'directory' });
    expect(connection().route).toEqual(['relay-a', 'directory']);
    expect(connection().trace).toMatchObject({ elapsedMs: 0, hopMs: [10_000, 20_000] });
    expect(connection().reroutes).toBe(1);
    expect(playerLogs('relay-b').at(-1)).toBe('relay closed 10.0.0.3');
    expect(playerLogs('directory').at(-1)).toBe('relay opened 10.0.0.3 > 10.0.0.5');
  });

  it('only resets the step in progress, not the ones the trace has finished', () => {
    const { state, id, ok, wait, connection } = traced();
    wait(15);
    expect(traceReport(connection().trace).relaysTraced).toBe(1);
    expect(hopUnderTrace(connection())).toBe(0);
    state.knownServers.push('hidden');
    ok({ type: 'reroute', connectionId: id, serverId: 'hidden' });
    expect(connection().route).toEqual(['hidden', 'relay-b']);
    // Relay B's 10 seconds stay spent; the new first relay has a delay of 1.
    expect(connection().trace).toMatchObject({ elapsedMs: 10_000, hopMs: [10_000, 10_000] });
  });

  it('buys real time: the trace now lands later', () => {
    const a = traced();
    const b = traced();
    a.wait(9);
    b.wait(9);
    b.ok({ type: 'reroute', connectionId: b.id, serverId: 'directory' });
    a.wait(21.5);
    b.wait(21.5);
    expect(a.state.connections).toEqual([]);
    expect(b.state.connections).toHaveLength(1);
  });

  it('can be done a limited number of times on one connection', () => {
    const { state, id, ok, refused } = traced();
    state.knownServers.push('hidden');
    ok({ type: 'reroute', connectionId: id, serverId: 'directory' });
    ok({ type: 'reroute', connectionId: id, serverId: 'hidden' });
    refused({ type: 'reroute', connectionId: id, serverId: 'relay-b' }, /cannot be rerouted again/);
  });

  it('needs a running trace, a relay to swap, and a spare server you know', () => {
    const calm = inside(['relay-a'], quiet);
    calm.refused({ type: 'reroute', connectionId: calm.id, serverId: 'directory' }, /no trace/);

    const direct = inside([]);
    direct.wait(8);
    direct.refused({ type: 'reroute', connectionId: direct.id, serverId: 'directory' }, /no relays/);

    const { state, id, refused } = traced();
    refused({ type: 'reroute', connectionId: id, serverId: 'relay-a' }, /already in the route/);
    refused({ type: 'reroute', connectionId: id, serverId: 'corp' }, /cannot be a relay/);
    refused({ type: 'reroute', connectionId: id, serverId: 'gateway' }, /cannot be a relay/);
    state.knownServers = state.knownServers.filter((known) => known !== 'directory');
    refused({ type: 'reroute', connectionId: id, serverId: 'directory' }, /do not have that address/);
    refused({ type: 'reroute', connectionId: 'nope', serverId: 'directory' }, /closed/);
  });
});

describe('the log review', () => {
  /** Real seconds in one game hour: the test world runs one game minute a second. */
  const HOURS = 60;

  /** Breaks in, optionally scrubs, and leaves before the trace lands. */
  const visit = (scrub: boolean) => {
    const h = inside(['relay-a', 'relay-b']);
    if (scrub) {
      h.connection().bypassed.proxy = true;
      const logIds = h.state.servers.corp!.logs.filter((entry) => entry.text.startsWith('login')).map((entry) => entry.id);
      h.ok({ type: 'runProgram', connectionId: h.id, target: { kind: 'deleteLog', logIds } });
      h.wait(3);
    }
    h.ok({ type: 'disconnectAll' });
    return h;
  };

  it('counts logins and changes as evidence, but not connections opening and closing', () => {
    const h = inside(['relay-a']);
    expect(h.playerLogs('corp')).toEqual(['connection opened from 10.0.0.3', 'login admin from 10.0.0.3']);
    expect(evidenceCount(h.state, 'corp')).toBe(1);
    expect(evidenceCount(h.state, 'relay-a')).toBe(0);
  });

  it('is booked when the player leaves a server that noticed them', () => {
    const { state } = visit(false);
    expect(state.reviews).toEqual([{ serverId: 'corp', dueMs: state.clock.gameTimeMs + 3 * 3_600_000 }]);
  });

  it('is not booked for a visit nobody noticed', () => {
    const h = inside([], quiet);
    h.state.connections[0]!.trace.status = 'none';
    h.ok({ type: 'disconnectAll' });
    expect(h.state.reviews).toEqual([]);
  });

  it('fines the player for evidence left behind, once', () => {
    const { state, wait } = visit(false);
    wait(3 * HOURS - 10);
    expect(state.player.balance).toBe(100);
    wait(20);
    // Half of the 80 a trace by corp would cost.
    expect(state.player.balance).toBe(60);
    expect(state.messages.at(-1)).toMatchObject({ subject: 'Logs read at Test Corp', body: '1 line, fine 40' });
    expect(state.reviews).toEqual([]);
    expect(evidenceCount(state, 'corp')).toBe(0);
    expect(state.player.lieLowUntilMs).toBe(0);
    wait(6 * HOURS);
    expect(state.player.balance).toBe(60);
  });

  it('finds nothing after a proper scrub', () => {
    const { state, wait } = visit(true);
    wait(4 * HOURS);
    expect(state.player.balance).toBe(100);
    expect(state.messages.map((message) => message.subject)).toEqual(['welcome']);
    expect(state.reviews).toEqual([]);
  });

  it('is dropped when the player was traced there anyway', () => {
    const h = inside([]);
    h.wait(14);
    expect(h.state.connections).toEqual([]);
    expect(h.state.reviews).toEqual([]);
    expect(evidenceCount(h.state, 'corp')).toBe(0);
    const balance = h.state.player.balance;
    h.wait(4 * HOURS);
    expect(h.state.player.balance).toBe(balance);
  });

  it('happens once per server even after several visits', () => {
    const h = visit(false);
    h.ok({ type: 'connect', serverId: 'corp' });
    h.ok({ type: 'login', connectionId: h.state.connections[0]!.id, user: 'admin' });
    h.ok({ type: 'disconnectAll' });
    expect(h.state.reviews).toHaveLength(1);
    h.wait(4 * HOURS);
    expect(h.state.messages.at(-1)!.body).toBe('2 lines, fine 40');
  });
});

describe('saves from before the hands-on moments (version 4)', () => {
  it('load with reroutes at zero, no reviews, and old log-delete tasks converted', () => {
    const h = inside(['relay-a'], quiet);
    h.connection().bypassed.proxy = true;
    const logId = h.state.servers.corp!.logs[0]!.id;
    h.ok({ type: 'runProgram', connectionId: h.id, target: { kind: 'deleteLog', logIds: [logId] } });
    const old = JSON.parse(serializeGame(h.state, '')) as { version: number; state: Record<string, any> };
    old.version = old.state.version = 4;
    delete old.state.reviews;
    delete old.state.connections[0].reroutes;
    old.state.tasks[0].target = { kind: 'deleteLog', logId };

    const loaded = deserializeGame(JSON.stringify(old)).state;
    expect(loaded.version).toBe(STATE_VERSION);
    expect(loaded.reviews).toEqual([]);
    expect(loaded.connections[0]!.reroutes).toBe(0);
    expect(loaded.tasks[0]!.target).toEqual({ kind: 'deleteLog', logIds: [logId] });
  });
});
