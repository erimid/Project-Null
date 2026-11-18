import { describe, expect, it } from 'vitest';
import {
  applyAction,
  createGame,
  deserializeGame,
  mostUrgentTrace,
  objectiveMet,
  serializeGame,
  syncWithContent,
  tick,
  type Action,
  type Content,
  type GameState,
} from './index';
import { content } from './testWorld';

/*
 * Test world reminders: corp's monitor is level 1 (8s grace); the vault's
 * is level 3, which traces from the moment you connect, 10s a hop (relay A
 * doubles it). The blinder takes 4s against a level 1 monitor and keeps it
 * blind for 30s. The decrypter takes 6s plus 1s per GB; sealed.dat is 2 GB.
 */

function game(world: Content = content) {
  const state: GameState = syncWithContent(
    createGame({ seed: 9, handle: 'T', startDate: '2034-03-14T08:00:00Z', startingBalance: 100 }),
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
  const connect = (serverId: string, route: string[] = []) => {
    for (const hop of route) ok({ type: 'addHop', serverId: hop });
    ok({ type: 'connect', serverId });
    return state.connections[0]!.id;
  };
  const wait = (seconds: number) => tick(state, seconds * 1000, world);
  const connection = () => state.connections[0]!;
  return { state, ok, refused, connect, wait, connection };
}

describe('Monitor Bypass', () => {
  it('runs before login without being noticed, and hides what follows', () => {
    const h = game();
    const id = h.connect('corp');
    h.ok({ type: 'runProgram', connectionId: id, target: { kind: 'monitor' } });
    expect(h.connection().trace.status).toBe('none');
    h.wait(4);
    expect(h.connection().monitor).toMatchObject({ blindMs: 30_000, used: true });

    h.ok({ type: 'login', connectionId: id, user: 'admin' });
    h.ok({ type: 'runProgram', connectionId: id, target: { kind: 'proxy' } });
    h.wait(20);
    expect(h.connection().trace.status).toBe('none');

    // The monitor comes back after 30 seconds and notices the next thing.
    h.wait(11);
    expect(h.connection().monitor).toMatchObject({ blindMs: 0, echo: null });
    h.ok({ type: 'runProgram', connectionId: id, target: { kind: 'deleteLog', logIds: [h.state.servers.corp!.logs[0]!.id] } });
    expect(h.connection().trace.status).toBe('pending');
  });

  it('works once per connection, and again after reconnecting', () => {
    const h = game();
    const id = h.connect('corp');
    h.ok({ type: 'runProgram', connectionId: id, target: { kind: 'monitor' } });
    h.wait(4);
    h.refused({ type: 'runProgram', connectionId: id, target: { kind: 'monitor' } }, /already blind/);
    h.wait(31);
    h.refused({ type: 'runProgram', connectionId: id, target: { kind: 'monitor' } }, /seen that trick/);
    h.ok({ type: 'disconnect', connectionId: id });
    h.ok({ type: 'runProgram', connectionId: h.connect('corp'), target: { kind: 'monitor' } });
  });

  it('is refused where nothing is watching closely', () => {
    const h = game();
    h.refused({ type: 'runProgram', connectionId: h.connect('directory'), target: { kind: 'monitor' } }, /Nothing is watching/);
  });

  it('holds a trace that is already running, for less time against a stronger monitor', () => {
    const h = game();
    const id = h.connect('vault', ['relay-b', 'relay-a']);
    expect(h.connection().trace.status).toBe('active');
    h.ok({ type: 'runProgram', connectionId: id, target: { kind: 'monitor' } });
    // Two levels ahead of the program: four times as long to run, a quarter of the blind time.
    expect(h.state.tasks[0]!.durationMs).toBe(16_000);
    h.wait(15);
    h.wait(1);
    expect(h.connection().trace.elapsedMs).toBe(15_000);
    expect(h.connection().monitor.blindMs).toBe(7_500);

    h.wait(5);
    expect(h.connection().trace.elapsedMs).toBe(15_000);
    expect(mostUrgentTrace(h.state)?.monitor.blindMs).toBe(2_500);
    // What is left of a tick after the monitor wakes goes to the trace.
    h.wait(3);
    expect(h.connection().trace.elapsedMs).toBe(15_500);
  });
});

describe('echoing the handshake', () => {
  const blind = () => {
    const h = game();
    const id = h.connect('corp');
    h.ok({ type: 'runProgram', connectionId: id, target: { kind: 'monitor' } });
    h.wait(4);
    return { ...h, id, echo: () => h.connection().monitor.echo! };
  };

  it('offers a pattern of cells with no cell twice running', () => {
    const { echo } = blind();
    expect(echo()).toMatchObject({ entered: 0, result: 'open' });
    expect(echo().cells).toHaveLength(4);
    echo().cells.forEach((cell, i) => {
      expect(cell).toBeGreaterThanOrEqual(0);
      expect(cell).toBeLessThan(9);
      expect(cell).not.toBe(echo().cells[i - 1]);
    });
  });

  it('stretches the blind time when the whole pattern is repeated', () => {
    const h = blind();
    for (const cell of [...h.echo().cells]) h.ok({ type: 'echoCell', connectionId: h.id, cell });
    expect(h.echo().result).toBe('won');
    expect(h.connection().monitor.blindMs).toBe(45_000);
    h.refused({ type: 'echoCell', connectionId: h.id, cell: 0 }, /no handshake/);
  });

  it('shortens it on one wrong cell and ends the attempt', () => {
    const h = blind();
    const [first, second] = h.echo().cells;
    h.ok({ type: 'echoCell', connectionId: h.id, cell: first! });
    h.ok({ type: 'echoCell', connectionId: h.id, cell: (second! + 1) % 9 });
    expect(h.echo()).toMatchObject({ entered: 1, result: 'lost' });
    expect(h.connection().monitor.blindMs).toBe(15_000);
    h.refused({ type: 'echoCell', connectionId: h.id, cell: second! }, /no handshake/);
  });

  it('survives a save and load', () => {
    const h = blind();
    const loaded = deserializeGame(serializeGame(h.state, 'now')).state;
    expect(loaded.connections[0]!.monitor).toEqual(h.connection().monitor);
  });
});

describe('encrypted files', () => {
  const job = { id: 'sealed', title: 'T', client: 'C', targetId: 'vault', pay: 100, rating: 1, minRating: 0, summary: 's', brief: 'b', objective: { kind: 'steal', file: 'sealed.dat' } } as const;
  const world: Content = { ...content, contracts: [job] };

  const stolen = () => {
    const h = game(world);
    const id = h.connect('vault', ['relay-b', 'relay-a']);
    h.ok({ type: 'login', connectionId: id, user: 'admin' });
    h.ok({ type: 'runProgram', connectionId: id, target: { kind: 'copyFile', file: 'sealed.dat' } });
    h.wait(4);
    h.ok({ type: 'disconnect', connectionId: id });
    return h;
  };

  it('stay encrypted when copied, and do not finish a job until decrypted', () => {
    const h = stolen();
    expect(h.state.player.files).toEqual([{ name: 'sealed.dat', sizeGq: 2, from: 'vault', encrypted: 1 }]);
    expect(objectiveMet(h.state, world, job)).toBe(false);

    h.ok({ type: 'decryptFile', name: 'sealed.dat' });
    expect(h.state.tasks[0]).toMatchObject({ connectionId: null, durationMs: 8_000 });
    h.refused({ type: 'decryptFile', name: 'sealed.dat' }, /already running/);
    h.refused({ type: 'deleteStoredFile', name: 'sealed.dat' }, /being decrypted/);
    h.wait(8);
    expect(h.state.tasks).toEqual([]);
    expect(h.state.player.files).toEqual([{ name: 'sealed.dat', sizeGq: 2, from: 'vault' }]);
    expect(objectiveMet(h.state, world, job)).toBe(true);
    h.refused({ type: 'decryptFile', name: 'sealed.dat' }, /not encrypted/);
  });

  it('keep decrypting through a connection opening and closing, and through a save', () => {
    const h = stolen();
    h.ok({ type: 'decryptFile', name: 'sealed.dat' });
    const id = h.connect('directory');
    h.wait(3);
    h.ok({ type: 'disconnect', connectionId: id });
    const loaded = syncWithContent(deserializeGame(serializeGame(h.state, 'now')).state, world);
    expect(loaded.tasks).toHaveLength(1);
    tick(loaded, 5_000, world);
    expect(loaded.player.files[0]!.encrypted).toBeUndefined();
  });

  it('cannot be decrypted without the file, or over a connection', () => {
    const h = game(world);
    h.refused({ type: 'decryptFile', name: 'sealed.dat' }, /no such file/);
    const id = h.connect('directory');
    h.refused({ type: 'runProgram', connectionId: id, target: { kind: 'decrypt', file: 'sealed.dat' } }, /on your gateway/);
  });
});

describe('progress and old saves', () => {
  it('sends the note about harder security once, after enough deliveries', () => {
    const h = game();
    const notes = () => h.state.messages.filter((message) => message.subject === 'harderSecurity').length;
    expect(notes()).toBe(0);
    h.state.contracts.completed = ['steal', 'destroy', 'record'];
    syncWithContent(h.state, content);
    syncWithContent(h.state, content);
    expect(notes()).toBe(1);
  });

  it('loads a version 5 save with its connection intact and no monitor blinded', () => {
    const h = game();
    h.connect('corp', ['relay-a']);
    const file = JSON.parse(serializeGame(h.state, 'now'));
    file.version = 5;
    file.state.version = 5;
    for (const connection of file.state.connections) delete connection.monitor;
    const loaded = deserializeGame(JSON.stringify(file)).state;
    expect(loaded.version).toBe(6);
    expect(loaded.connections[0]).toMatchObject({ serverId: 'corp', monitor: { blindMs: 0, used: false, echo: null } });
  });
});
