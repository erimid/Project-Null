import { STATE_VERSION } from './state';
import { describe, expect, it } from 'vitest';
import {
  applyAction,
  createGame,
  deserializeGame,
  layerSeconds,
  mostUrgentTrace,
  serializeGame,
  syncWithContent,
  tick,
  totalTraceMs,
  traceReport,
  usedStorageGq,
  type Action,
  type Content,
  type GameState,
  type TaskTarget,
} from './index';
import { content, testPrograms, testServers } from './testWorld';

/*
 * The test world (testWorld.ts): "corp" has a level 1 password, proxy,
 * firewall and monitor, and takes 10 seconds per hop to trace. Relay A
 * slows a trace to double, relay B does not. Every test program is
 * version 1: breaker 10s, bypasses 6s, copier 2s + 1s/Gq, log deleter 3s.
 */

const newGame = (world: Content = content): GameState => {
  const state = syncWithContent(
    createGame({ seed: 1, handle: 'T', startDate: '2034-03-14T08:00:00Z', startingBalance: 100 }),
    world,
  );
  state.knownServers = world.servers.map((server) => server.id);
  return state;
};
const first = (state: GameState) => state.connections[0]?.id ?? 'closed';
const seconds = (state: GameState, s: number, world: Content = content) => tick(state, s * 1000, world);

function harness(world: Content = content) {
  const state = newGame(world);
  const act = (action: Action) => applyAction(state, action, world);
  const ok = (action: Action) => expect(act(action)).toEqual({ ok: true });
  const refused = (action: Action, pattern: RegExp) => {
    const result = act(action);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(pattern);
  };
  const run = (target: TaskTarget): Action => ({ type: 'runProgram', connectionId: first(state), target });
  const wait = (s: number) => seconds(state, s, world);
  return { state, act, ok, refused, run, wait };
}

/** Connected to corp through the given relays, password broken, logged in as admin. */
function inside(route: string[] = ['relay-a', 'relay-b'], world: Content = content) {
  const h = harness(world);
  for (const serverId of route) h.ok({ type: 'addHop', serverId });
  h.ok({ type: 'connect', serverId: 'corp' });
  h.state.player.passwords.corp = ['admin'];
  h.ok({ type: 'login', connectionId: first(h.state), user: 'admin' });
  return h;
}

/** The same world with some of corp's settings changed. */
const withCorp = (change: Partial<(typeof testServers)[number]>): Content => ({
  ...content,
  servers: testServers.map((server) => (server.id === 'corp' ? { ...server, ...change } : server)),
});

describe('how long a program needs against a layer', () => {
  const [breaker] = testPrograms;
  it('takes its base time against a layer of its own level', () => {
    expect(layerSeconds(breaker!, 1)).toBe(10);
  });
  it('doubles for each level the layer is ahead, up to two levels', () => {
    expect(layerSeconds(breaker!, 2)).toBe(20);
    expect(layerSeconds(breaker!, 3)).toBe(40);
  });
  it('cannot touch a layer more than two levels ahead', () => {
    expect(layerSeconds(breaker!, 4)).toBeNull();
  });
  it('halves for each level the program is ahead', () => {
    expect(layerSeconds({ ...breaker!, version: 3 }, 1)).toBe(2.5);
  });
});

describe('passwords', () => {
  it('stop an admin login until the password is broken', () => {
    const { state, ok, refused, run, wait } = harness();
    ok({ type: 'connect', serverId: 'corp' });
    refused({ type: 'login', connectionId: first(state), user: 'admin' }, /needs a password/);

    ok(run({ kind: 'password', user: 'admin' }));
    expect(state.tasks).toHaveLength(1);
    expect(state.tasks[0]).toMatchObject({ programId: 'breaker', progressMs: 0, durationMs: 10_000 });
    wait(4);
    refused({ type: 'login', connectionId: first(state), user: 'admin' }, /needs a password/);
    wait(6.5);
    expect(state.tasks).toEqual([]);
    expect(state.player.passwords).toEqual({ corp: ['admin'] });
    ok({ type: 'login', connectionId: first(state), user: 'admin' });
  });

  it('stay broken after disconnecting', () => {
    const { state, ok, run, wait } = harness();
    ok({ type: 'connect', serverId: 'corp' });
    ok(run({ kind: 'password', user: 'admin' }));
    wait(10);
    ok({ type: 'disconnectAll' });
    ok({ type: 'connect', serverId: 'corp' });
    ok({ type: 'login', connectionId: first(state), user: 'admin' });
  });

  it('are not needed for guest accounts or on servers without a password layer', () => {
    const { state, ok, refused, run } = harness();
    ok({ type: 'connect', serverId: 'relay-a' });
    refused(run({ kind: 'password', user: 'root' }), /already have that password/);
    refused(run({ kind: 'password', user: 'nobody' }), /No such account/);
    ok({ type: 'login', connectionId: first(state), user: 'root' });
    refused(run({ kind: 'password', user: 'guest' }), /already logged in/);
  });

  it('cannot be broken by a program that is too weak', () => {
    const world = withCorp({ security: { password: 4, proxy: 0, firewall: 0, monitor: 0 } });
    const { ok, refused, run } = harness(world);
    ok({ type: 'connect', serverId: 'corp' });
    refused(run({ kind: 'password', user: 'admin' }), /too weak/);
  });

  it('cannot be broken without the program', () => {
    const { state, ok, refused, run } = harness();
    state.player.programs = ['copier'];
    ok({ type: 'connect', serverId: 'corp' });
    refused(run({ kind: 'password', user: 'admin' }), /do not own/);
  });
});

describe('logging out', () => {
  it('goes back to the login screen, keeps the connection and lets you log in as someone else', () => {
    const { state, ok, refused, run } = harness();
    ok({ type: 'connect', serverId: 'relay-a' });
    refused({ type: 'logout', connectionId: first(state) }, /not logged in/);
    ok({ type: 'login', connectionId: first(state), user: 'guest' });
    ok({ type: 'logout', connectionId: first(state) });
    expect(state.connections[0]).toMatchObject({ user: null, role: null });
    expect(state.servers['relay-a']!.logs.at(-1)).toMatchObject({ text: 'logout guest', byPlayer: true });
    ok({ type: 'login', connectionId: first(state), user: 'root' });
    expect(state.connections[0]!.role).toBe('admin');
    refused({ type: 'logout', connectionId: 'nope' }, /closed/);
    void run;
  });

  it('stops programs running in the account but keeps bypassed layers and the trace', () => {
    const { state, ok, run, wait } = inside();
    ok(run({ kind: 'firewall' }));
    wait(6);
    ok(run({ kind: 'proxy' }));
    ok({ type: 'logout', connectionId: first(state) });
    expect(state.tasks).toEqual([]);
    expect(state.connections[0]!.bypassed).toEqual({ proxy: false, firewall: true });
    expect(state.connections[0]!.trace.status).not.toBe('none');
  });
});

describe('the firewall', () => {
  it('blocks copying and deleting files until it is bypassed', () => {
    const { state, ok, refused, run, wait } = inside();
    refused(run({ kind: 'copyFile', file: 'secret.dat' }), /firewall is blocking/);
    refused(run({ kind: 'deleteFile', file: 'secret.dat' }), /firewall is blocking/);
    ok(run({ kind: 'firewall' }));
    wait(6);
    expect(state.connections[0]!.bypassed).toEqual({ proxy: false, firewall: true });
    ok(run({ kind: 'copyFile', file: 'secret.dat' }));
  });

  it('needs a login, and cannot be bypassed twice', () => {
    const { ok, refused, run } = harness();
    ok({ type: 'connect', serverId: 'corp' });
    refused(run({ kind: 'firewall' }), /Log in first/);
    const h = inside();
    h.ok(h.run({ kind: 'firewall' }));
    h.refused(h.run({ kind: 'firewall' }), /already running/);
    h.wait(6);
    h.refused(h.run({ kind: 'firewall' }), /already bypassed/);
  });

  it('is back in place on the next connection', () => {
    const { state, ok, refused, run, wait } = inside([]);
    ok(run({ kind: 'firewall' }));
    wait(3);
    ok({ type: 'disconnectAll' });
    ok({ type: 'connect', serverId: 'corp' });
    ok({ type: 'login', connectionId: first(state), user: 'admin' });
    refused(run({ kind: 'copyFile', file: 'secret.dat' }), /firewall is blocking/);
  });

  it('does not exist on servers without one', () => {
    const { state, ok, refused, run } = harness();
    ok({ type: 'connect', serverId: 'directory' });
    ok({ type: 'login', connectionId: first(state), user: 'guest' });
    refused(run({ kind: 'firewall' }), /no firewall/);
    refused(run({ kind: 'proxy' }), /no proxy/);
  });
});

describe('files', () => {
  /** Inside corp with the firewall already open and the trace switched off. */
  const open = (world: Content = withCorp({ security: { password: 1, proxy: 1, firewall: 0, monitor: 0 }, traceSecondsPerHop: 10_000 })) =>
    inside(['relay-a'], world);

  it('copy to the gateway, taking longer for bigger files, and leave a log line', () => {
    const { state, ok, run, wait } = open();
    ok(run({ kind: 'copyFile', file: 'secret.dat' }));
    // 2 seconds plus 1 second for each of its 5 Gq.
    expect(state.tasks[0]!.durationMs).toBe(7_000);
    wait(6.9);
    expect(state.player.files).toEqual([]);
    wait(0.2);
    expect(state.player.files).toEqual([{ name: 'secret.dat', sizeGq: 5, from: 'corp' }]);
    expect(usedStorageGq(state, content)).toBe(5);
    expect(state.servers.corp!.files).toHaveLength(1);
    expect(state.servers.corp!.logs.at(-1)).toMatchObject({ text: 'file copied: secret.dat', byPlayer: true });
  });

  it('cannot be copied twice, or when the gateway is full', () => {
    const { state, ok, refused, run, wait } = open();
    ok(run({ kind: 'copyFile', file: 'secret.dat' }));
    wait(7);
    refused(run({ kind: 'copyFile', file: 'secret.dat' }), /already have a copy/);
    state.player.files = [{ name: 'big.bin', sizeGq: 16, from: 'x' }];
    refused(run({ kind: 'copyFile', file: 'secret.dat' }), /Not enough room/);
    refused(run({ kind: 'copyFile', file: 'nothing.dat' }), /No such file/);
  });

  it('can be deleted by an administrator, which is logged too', () => {
    const { state, ok, run, wait } = open();
    ok(run({ kind: 'deleteFile', file: 'secret.dat' }));
    // 2 seconds plus half a second per Gq.
    expect(state.tasks[0]!.durationMs).toBe(4_500);
    wait(4.5);
    expect(state.servers.corp!.files).toEqual([]);
    expect(state.servers.corp!.logs.at(-1)).toMatchObject({ text: 'file deleted: secret.dat' });
  });

  it('let a guest copy public files but not delete them or see restricted ones', () => {
    const { state, ok, refused, run, wait } = harness();
    state.servers.directory!.files.push({ name: 'staff.dat', sizeGq: 1, access: 'admin' });
    ok({ type: 'connect', serverId: 'directory' });
    ok({ type: 'login', connectionId: first(state), user: 'guest' });
    refused(run({ kind: 'deleteFile', file: 'readme.txt' }), /Only an administrator/);
    refused(run({ kind: 'copyFile', file: 'staff.dat' }), /No such file/);
    ok(run({ kind: 'copyFile', file: 'readme.txt' }));
    wait(3);
    expect(state.player.files.map((file) => file.name)).toEqual(['readme.txt']);
  });
});

describe('the proxy and the access log', () => {
  const quiet = withCorp({ security: { password: 1, proxy: 1, firewall: 0, monitor: 0 }, traceSecondsPerHop: 10_000 });

  it('blocks changes to the log until it is bypassed', () => {
    const { state, ok, refused, run, wait } = inside(['relay-a'], quiet);
    const login = state.servers.corp!.logs.find((entry) => entry.text.startsWith('login admin'))!;
    refused(run({ kind: 'deleteLog', logIds: [login.id] }), /proxy is blocking/);
    ok(run({ kind: 'proxy' }));
    wait(6);
    ok(run({ kind: 'deleteLog', logIds: [login.id] }));
    wait(3);
    expect(state.servers.corp!.logs.map((entry) => entry.text)).toEqual(['connection opened from 10.0.0.3']);
    refused(run({ kind: 'deleteLog', logIds: [login.id] }), /log line is gone/);
  });

  it('only lets an administrator change the log', () => {
    const { state, ok, refused, run } = harness();
    ok({ type: 'connect', serverId: 'directory' });
    ok({ type: 'login', connectionId: first(state), user: 'guest' });
    refused(run({ kind: 'deleteLog', logIds: [state.servers.directory!.logs[0]!.id] }), /Only an administrator/);
  });
});

describe('running programs', () => {
  const quiet = withCorp({ security: { password: 1, proxy: 1, firewall: 1, monitor: 0 }, traceSecondsPerHop: 10_000 });

  it('run side by side, up to what the gateway can hold', () => {
    const { state, ok, refused, run, wait } = inside(['relay-a'], quiet);
    state.servers.corp!.files.push({ name: 'b.dat', sizeGq: 1, access: 'admin' }, { name: 'c.dat', sizeGq: 1, access: 'admin' });
    state.connections[0]!.bypassed.firewall = true;
    ok(run({ kind: 'proxy' }));
    ok(run({ kind: 'copyFile', file: 'secret.dat' }));
    ok(run({ kind: 'copyFile', file: 'b.dat' }));
    refused(run({ kind: 'copyFile', file: 'c.dat' }), /3 programs at once/);
    wait(3);
    // The small copy (3s) is done; the others are still going.
    expect(state.tasks.map((task) => task.target.kind)).toEqual(['proxy', 'copyFile']);
    ok(run({ kind: 'copyFile', file: 'c.dat' }));
  });

  it('can be cancelled, and then have no effect', () => {
    const { state, ok, refused, run, wait } = inside(['relay-a'], quiet);
    ok(run({ kind: 'proxy' }));
    const taskId = state.tasks[0]!.id;
    ok({ type: 'cancelProgram', taskId });
    refused({ type: 'cancelProgram', taskId }, /already stopped/);
    wait(10);
    expect(state.connections[0]!.bypassed.proxy).toBe(false);
  });

  it('stop when their connection closes', () => {
    const { state, ok, run } = inside(['relay-a'], quiet);
    ok(run({ kind: 'proxy' }));
    ok({ type: 'disconnect', connectionId: first(state) });
    expect(state.tasks).toEqual([]);
  });

  it('finish at the same moment in many small steps as in one big one', () => {
    const a = inside(['relay-a'], quiet);
    const b = inside(['relay-a'], quiet);
    a.ok(a.run({ kind: 'proxy' }));
    b.ok(b.run({ kind: 'proxy' }));
    a.wait(5.9);
    for (let i = 0; i < 59; i++) b.wait(0.1);
    expect(a.state.tasks).toHaveLength(1);
    expect(b.state.tasks).toHaveLength(1);
    a.wait(0.2);
    b.wait(0.2);
    expect(a.state.connections[0]!.bypassed.proxy).toBe(true);
    expect(b.state.connections[0]!.bypassed.proxy).toBe(true);
  });
});

describe('the trace', () => {
  it('does not start for a visitor who only looks around', () => {
    const { state, ok, wait } = harness();
    ok({ type: 'connect', serverId: 'corp' });
    wait(120);
    expect(state.connections[0]!.trace.status).toBe('none');
    expect(mostUrgentTrace(state, content)).toBeUndefined();
  });

  it('starts a short while after the monitor notices a program', () => {
    const { state, ok, run, wait } = harness();
    ok({ type: 'addHop', serverId: 'relay-a' });
    ok({ type: 'addHop', serverId: 'relay-b' });
    ok({ type: 'connect', serverId: 'corp' });
    ok(run({ kind: 'password', user: 'admin' }));
    // Monitor level 1 waits 8 seconds.
    expect(state.connections[0]!.trace).toMatchObject({ status: 'pending', graceMs: 8_000 });
    wait(7);
    expect(state.connections[0]!.trace.status).toBe('pending');
    wait(2);
    // The second left over after the wait already counts towards the trace.
    expect(state.connections[0]!.trace).toMatchObject({ status: 'active', elapsedMs: 1_000 });
    expect(mostUrgentTrace(state, content)).toBe(state.connections[0]);
  });

  it('is noticed when logging in as an administrator with a broken password', () => {
    const { state } = inside();
    expect(state.connections[0]!.trace.status).toBe('pending');
  });

  it('takes longer through more relays, and slow relays count for more', () => {
    const { state } = inside(['relay-a', 'relay-b']);
    // Traced back from the target: relay B (10s) first, then relay A (10s × 2).
    expect(state.connections[0]!.trace.hopMs).toEqual([10_000, 20_000]);
    expect(totalTraceMs(state.connections[0]!.trace)).toBe(30_000);
    // With no relays at all, the trace is quicker than a single hop.
    expect(inside([]).state.connections[0]!.trace.hopMs).toEqual([5_000]);
  });

  it('reports how far it has got', () => {
    const { state, wait } = inside(['relay-a', 'relay-b']);
    wait(8);
    expect(traceReport(state.connections[0]!.trace)).toEqual({ active: true, progress: 0, remainingMs: 30_000, relaysTraced: 0 });
    wait(15);
    expect(traceReport(state.connections[0]!.trace)).toEqual({ active: true, progress: 0.5, remainingMs: 15_000, relaysTraced: 1 });
  });

  it('cuts the connection and tells the player when it reaches the gateway', () => {
    const { state, ok, refused, run, wait } = inside(['relay-a', 'relay-b']);
    ok(run({ kind: 'firewall' }));
    wait(8 + 29);
    expect(state.connections).toHaveLength(1);
    wait(1.5);
    expect(state.connections).toEqual([]);
    expect(state.tasks).toEqual([]);
    const message = state.messages.at(-1)!;
    expect(message).toMatchObject({ from: 'Fixer', subject: 'Traced by Test Corp', read: false });
    expect(state.servers.corp!.logs.at(-1)!.text).toBe('connection closed 10.0.0.4');

    ok({ type: 'readMessage', messageId: message.id });
    expect(message.read).toBe(true);
    refused({ type: 'readMessage', messageId: 'nope' }, /No such message/);
  });

  it('is escaped by disconnecting in time', () => {
    const { state, ok, wait } = inside(['relay-a', 'relay-b']);
    wait(8 + 29);
    ok({ type: 'disconnectAll' });
    wait(60);
    expect(state.messages.map((message) => message.subject)).toEqual(['welcome']);
    expect(state.player.balance).toBe(100);
  });

  it('starts the moment you connect to the most watchful servers', () => {
    const world = withCorp({ security: { password: 1, proxy: 0, firewall: 0, monitor: 3 } });
    const { state, ok } = harness(world);
    ok({ type: 'connect', serverId: 'corp' });
    expect(state.connections[0]!.trace.status).toBe('active');
  });

  it('survives a save and load mid-trace with a program running', () => {
    const { state, ok, run, wait } = inside(['relay-a', 'relay-b']);
    ok(run({ kind: 'firewall' }));
    wait(4);
    const loaded = syncWithContent(deserializeGame(serializeGame(state, '')).state, content);
    expect(loaded).toEqual(state);
    expect(loaded.tasks).toHaveLength(1);
  });
});

describe('saves from before security existed (version 2)', () => {
  it('load with no programs running, the starting programs, and numbered log lines', () => {
    const now = newGame();
    applyAction(now, { type: 'connect', serverId: 'directory' }, content);
    const old = JSON.parse(serializeGame(now, '')) as { version: number; state: Record<string, any> };
    old.version = 2;
    old.state.version = 2;
    for (const key of ['tasks', 'messages', 'contracts', 'flags']) delete old.state[key];
    for (const key of ['programs', 'files', 'passwords', 'rating', 'lieLowUntilMs']) delete old.state.player[key];
    for (const connection of old.state.connections) {
      delete connection.bypassed;
      delete connection.trace;
    }
    for (const server of Object.values(old.state.servers as Record<string, { logs: { id?: number }[] }>)) for (const log of server.logs) delete log.id;

    const loaded = syncWithContent(deserializeGame(JSON.stringify(old)).state, content);
    expect(loaded.version).toBe(STATE_VERSION);
    expect(loaded.player.programs).toEqual(content.startingPrograms);
    expect(loaded.tasks).toEqual([]);
    // Old saves get the welcome message too, since it explains where the work is.
    expect(loaded.messages.map((message) => message.subject)).toEqual(['welcome']);
    expect(loaded.player).toMatchObject({ rating: 0, lieLowUntilMs: 0 });
    expect(loaded.contracts).toEqual({ activeId: null, completed: [], jobs: [] });
    expect(loaded.connections[0]).toMatchObject({ bypassed: { proxy: false, firewall: false }, trace: { status: 'none' } });
    const ids = Object.values(loaded.servers).flatMap((server) => server.logs.map((log) => log.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(loaded.nextId).toBeGreaterThan(Math.max(...ids));
  });
});
