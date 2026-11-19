import { describe, expect, it } from 'vitest';
import {
  STATE_VERSION,
  applyAction,
  checkTask,
  createGame,
  deserializeGame,
  hasSkill,
  hostedModel,
  maxConnections,
  maxPrograms,
  serializeGame,
  storageGb,
  syncWithContent,
  tick,
  usedStorageGq,
  type Action,
  type GameState,
} from './index';
import { content } from './testWorld';

/*
 * Test world reminders: the board is the unlisted "hidden" server. Parts:
 * cpu-2 (100c, twice as fast, 4 programs), storage-2 (50c, 60 GB),
 * modem-2 (80c, twice as fast), ports-2 (70c) and ports-3 (150c), and a
 * rack (200c) that hosts the Small model in 8 GB. Hardware is lost to
 * servers with a layer at level 3 or more: the vault (monitor 3).
 */

function game(balance = 1000) {
  const state: GameState = syncWithContent(
    createGame({ seed: 4, handle: 'T', startDate: '2034-03-14T08:00:00Z', startingBalance: balance }),
    content,
  );
  state.knownServers = content.servers.map((server) => server.id);
  const act = (action: Action) => applyAction(state, action, content);
  const ok = (action: Action) => expect(act(action)).toEqual({ ok: true });
  const refused = (action: Action, pattern: RegExp) => {
    const result = act(action);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(pattern);
  };
  const login = (serverId: string, user: string) => {
    ok({ type: 'connect', serverId });
    const id = state.connections.at(-1)!.id;
    ok({ type: 'login', connectionId: id, user });
    return id;
  };
  const buy = (...partIds: string[]) => {
    const id = login('hidden', 'member');
    for (const partId of partIds) ok({ type: 'buyHardware', connectionId: id, partId });
    ok({ type: 'disconnect', connectionId: id });
  };
  return { state, act, ok, refused, login, buy };
}

describe('a new gateway', () => {
  it('has stock parts: three programs, the stock drive, one connection, no model', () => {
    const { state } = game();
    expect(state.player.hardware).toEqual({ cpu: 1, storage: 1, modem: 1, ports: 1, rack: 0, sensor: 0, cooling: 0 });
    expect(maxPrograms(state, content)).toBe(3);
    expect(storageGb(state, content)).toBe(20);
    expect(maxConnections(state, content)).toBe(1);
    expect(hostedModel(state, content)).toBeUndefined();
  });
});

describe('buying hardware', () => {
  it('installs the part at once and takes its price', () => {
    const h = game();
    h.buy('cpu-2');
    expect(h.state.player.hardware.cpu).toBe(2);
    expect(h.state.player.balance).toBe(900);
    expect(maxPrograms(h.state, content)).toBe(4);
  });

  it('is only possible on a board, only for upgrades, and only with the money', () => {
    const h = game(120);
    const directory = h.login('directory', 'guest');
    h.refused({ type: 'buyHardware', connectionId: directory, partId: 'cpu-2' }, /board/);
    h.ok({ type: 'disconnect', connectionId: directory });
    const id = h.login('hidden', 'member');
    h.refused({ type: 'buyHardware', connectionId: id, partId: 'cpu-1' }, /not for sale/);
    h.refused({ type: 'buyHardware', connectionId: id, partId: 'warp-drive' }, /not for sale/);
    h.refused({ type: 'buyHardware', connectionId: id, partId: 'ports-3' }, /afford/);
    h.ok({ type: 'buyHardware', connectionId: id, partId: 'cpu-2' });
    h.refused({ type: 'buyHardware', connectionId: id, partId: 'cpu-2' }, /already has/);
  });

  it('can skip tiers, and a lower tier is refused after a higher one', () => {
    const h = game();
    h.buy('ports-3');
    expect(maxConnections(h.state, content)).toBe(3);
    const id = h.login('hidden', 'member');
    h.refused({ type: 'buyHardware', connectionId: id, partId: 'ports-2' }, /already has/);
  });
});

describe('what the parts do', () => {
  it('a faster processor breaks a password in half the time', () => {
    const h = game();
    h.ok({ type: 'connect', serverId: 'corp' });
    const id = h.state.connections[0]!.id;
    const before = checkTask(h.state, content, h.state.connections[0]!, { kind: 'password', user: 'admin' });
    h.ok({ type: 'disconnect', connectionId: id });
    h.buy('cpu-2');
    h.ok({ type: 'connect', serverId: 'corp' });
    const after = checkTask(h.state, content, h.state.connections[0]!, { kind: 'password', user: 'admin' });
    expect(before.ok && after.ok).toBe(true);
    if (before.ok && after.ok) expect(after.seconds).toBe(before.seconds / 2);
  });

  it('a faster processor lets a fourth program run', () => {
    const h = game();
    h.buy('cpu-2');
    h.state.player.files = ['a', 'b', 'c', 'd'].map((name) => ({ name, sizeGq: 1, from: 'vault', encrypted: 1 }));
    for (const name of ['a', 'b', 'c', 'd']) h.ok({ type: 'decryptFile', name });
    h.state.player.files.push({ name: 'e', sizeGq: 1, from: 'vault', encrypted: 1 });
    h.refused({ type: 'decryptFile', name: 'e' }, /4 programs/);
  });

  it('a faster modem copies files faster but does not speed up the processor work', () => {
    const h = game();
    h.state.player.passwords.corp = ['admin'];
    const corp = () => h.state.connections.find((c) => c.serverId === 'corp')!;
    const seconds = () => {
      const copy = checkTask(h.state, content, corp(), { kind: 'copyFile', file: 'secret.dat' });
      const cut = checkTask(h.state, content, corp(), { kind: 'firewall' });
      return [copy.ok ? copy.seconds : -1, cut.ok ? cut.seconds : -1];
    };
    h.login('corp', 'admin');
    corp().bypassed.firewall = true;
    const [copyBefore, cutBefore] = seconds();
    corp().bypassed.firewall = false;
    const [, cutCheck] = seconds();
    h.ok({ type: 'disconnect', connectionId: corp().id });
    h.buy('modem-2');
    h.login('corp', 'admin');
    corp().bypassed.firewall = true;
    const [copyAfter] = seconds();
    corp().bypassed.firewall = false;
    const [, cutAfter] = seconds();
    expect(copyAfter).toBe(copyBefore! / 2);
    expect(cutAfter).toBe(cutCheck);
    expect(cutBefore).toBe(-1);
  });

  it('more storage holds more', () => {
    const h = game();
    h.buy('storage-2');
    expect(storageGb(h.state, content)).toBe(60);
  });

  it('a second port holds a second connection', () => {
    const h = game();
    h.ok({ type: 'connect', serverId: 'directory' });
    h.refused({ type: 'connect', serverId: 'corp' }, /one connection/);
    h.ok({ type: 'disconnectAll' });
    h.buy('ports-2');
    h.ok({ type: 'connect', serverId: 'directory' });
    h.ok({ type: 'connect', serverId: 'corp' });
    h.refused({ type: 'connect', serverId: 'vault' }, /2 connections/);
  });
});

describe('a model on your own rack', () => {
  it('works for good with no rent, and its weights take room', () => {
    const h = game();
    const before = usedStorageGq(h.state, content);
    h.buy('rack-1');
    expect(hostedModel(h.state, content)?.id).toBe('small');
    expect(hasSkill(h.state, content, 'read')).toBe(true);
    expect(hasSkill(h.state, content, 'watch')).toBe(false);
    expect(usedStorageGq(h.state, content)).toBe(before + 8);
    // A year later it is still there.
    h.state.clock.gameTimeMs += 365 * 24 * 3_600_000;
    tick(h.state, 16, content);
    expect(hasSkill(h.state, content, 'read')).toBe(true);
  });

  it('adds to a rented model rather than replacing it', () => {
    const h = game();
    h.buy('rack-1');
    const id = h.login('hidden', 'member');
    h.ok({ type: 'rentModel', connectionId: id, modelId: 'big' });
    expect(hasSkill(h.state, content, 'watch')).toBe(true);
  });

  it('is refused when the weights would not fit', () => {
    const h = game();
    h.state.player.files = [{ name: 'big.dat', sizeGq: storageGb(h.state, content) - usedStorageGq(h.state, content) - 4, from: 'corp' }];
    const id = h.login('hidden', 'member');
    h.refused({ type: 'buyHardware', connectionId: id, partId: 'rack-1' }, /room/);
    expect(h.state.player.balance).toBe(1000);
  });
});

describe('being traced by a strong system', () => {
  const traceAtVault = (h: ReturnType<typeof game>) => {
    h.ok({ type: 'connect', serverId: 'vault' });
    for (let i = 0; i < 40 && h.state.connections.length > 0; i++) tick(h.state, 250, content);
    expect(h.state.connections).toEqual([]);
  };

  it('costs one tier of one part, with a message', () => {
    const h = game();
    h.buy('cpu-2');
    traceAtVault(h);
    expect(h.state.player.hardware.cpu).toBe(1);
    expect(h.state.messages.at(-1)?.subject).toBe('Lost cpu 2');
    expect(h.state.messages.at(-1)?.body).toBe('now cpu 1');
  });

  it('never takes a stock part', () => {
    const h = game();
    traceAtVault(h);
    expect(h.state.player.hardware).toEqual({ cpu: 1, storage: 1, modem: 1, ports: 1, rack: 0, sensor: 0, cooling: 0 });
  });

  it('can take the model rack', () => {
    const h = game();
    h.buy('rack-1');
    traceAtVault(h);
    expect(h.state.player.hardware.rack).toBe(0);
    expect(hostedModel(h.state, content)).toBeUndefined();
  });

  it('does not happen on weaker systems', () => {
    const h = game();
    h.buy('cpu-2');
    h.ok({ type: 'connect', serverId: 'corp' });
    h.state.connections[0]!.trace.status = 'active';
    for (let i = 0; i < 40 && h.state.connections.length > 0; i++) tick(h.state, 250, content);
    expect(h.state.connections).toEqual([]);
    expect(h.state.player.hardware.cpu).toBe(2);
  });
});

describe('old saves', () => {
  it('load a version 8 save with stock parts, keeping the connection limit as ports', () => {
    const h = game();
    const file = JSON.parse(serializeGame(h.state, 'now'));
    file.version = 8;
    file.state.version = 8;
    delete file.state.player.hardware;
    file.state.player.maxConnections = 2;
    const loaded = deserializeGame(JSON.stringify(file)).state;
    expect(loaded.version).toBe(STATE_VERSION);
    expect(loaded.player.hardware).toEqual({ cpu: 1, storage: 1, modem: 1, ports: 2, rack: 0, sensor: 0, cooling: 0 });
    expect('maxConnections' in loaded.player).toBe(false);
  });

  it('keep the parts across a save', () => {
    const h = game();
    h.buy('cpu-2', 'rack-1');
    const loaded = deserializeGame(serializeGame(h.state, 'now')).state;
    expect(loaded.player.hardware).toEqual({ cpu: 2, storage: 1, modem: 1, ports: 1, rack: 1, sensor: 0, cooling: 0 });
  });
});
