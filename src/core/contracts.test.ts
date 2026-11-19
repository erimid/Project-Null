import { STATE_VERSION } from './state';
import { describe, expect, it } from 'vitest';
import {
  activeContract,
  applyAction,
  availableContracts,
  createGame,
  deserializeGame,
  isLyingLow,
  nextContractRating,
  objectiveMet,
  objectivePossible,
  programStorageGq,
  serializeGame,
  syncWithContent,
  tick,
  usedStorageGq,
  type Action,
  type GameState,
} from './index';
import { content, testContracts } from './testWorld';

/*
 * The test world has a board ("hidden") and four contracts: "steal" and
 * "destroy" (both about corp's secret.dat, open to anyone), "record"
 * (rename record 2 at corp; needs rating 1) and "elite" (needs rating 50).
 * Two programs are for sale: breaker-2 (60) and gold-plated (5000).
 * The player starts with 100.
 */

function harness() {
  const state = syncWithContent(
    createGame({ seed: 1, handle: 'T', startDate: '2034-03-14T08:00:00Z', startingBalance: 100 }),
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
  const here = () => state.connections[0]?.id ?? 'closed';
  /** Connects and logs in. */
  const visit = (serverId: string, user: string) => {
    ok({ type: 'disconnectAll' });
    ok({ type: 'connect', serverId });
    ok({ type: 'login', connectionId: here(), user });
  };
  const accept = (contractId: string) => {
    visit('hidden', 'member');
    ok({ type: 'acceptContract', connectionId: here(), contractId });
    ok({ type: 'disconnectAll' });
  };
  /** Inside corp as administrator with both layers open. */
  const breakIn = () => {
    state.player.passwords.corp = ['admin'];
    visit('corp', 'admin');
    state.connections[0]!.bypassed = { proxy: true, firewall: true };
  };
  const wait = (seconds: number) => tick(state, seconds * 1000, content);
  const subjects = () => state.messages.map((message) => message.subject);
  return { state, ok, refused, here, visit, accept, breakIn, wait, subjects };
}

const byId = (id: string) => testContracts.find((contract) => contract.id === id)!;
const offered = (state: GameState) => availableContracts(state, content).map((contract) => contract.id);

describe('a new game', () => {
  it('starts with a welcome message, sent once', () => {
    const { state, subjects } = harness();
    expect(subjects()).toEqual(['welcome']);
    expect(state.messages[0]).toMatchObject({ from: 'Fixer', body: 'welcome for T', read: false });
    syncWithContent(state, content);
    expect(subjects()).toEqual(['welcome']);
  });
});

describe('the contracts board', () => {
  it('offers the jobs the player has the rating for', () => {
    const { state } = harness();
    expect(offered(state)).toEqual(['steal', 'destroy']);
    state.player.rating = 1;
    expect(offered(state)).toEqual(['steal', 'destroy', 'record']);
  });

  it('gives out one contract at a time, to someone logged in to a board', () => {
    const { state, ok, refused, here, visit } = harness();
    refused({ type: 'acceptContract', connectionId: 'nope', contractId: 'steal' }, /Log in to the board/);
    visit('directory', 'guest');
    refused({ type: 'acceptContract', connectionId: here(), contractId: 'steal' }, /not a contracts board/);
    visit('hidden', 'member');
    refused({ type: 'acceptContract', connectionId: here(), contractId: 'record' }, /not on offer/);
    refused({ type: 'acceptContract', connectionId: here(), contractId: 'nope' }, /not on offer/);
    ok({ type: 'acceptContract', connectionId: here(), contractId: 'steal' });
    expect(activeContract(state, content)?.id).toBe('steal');
    expect(offered(state)).toEqual(['destroy']);
    refused({ type: 'acceptContract', connectionId: here(), contractId: 'destroy' }, /already have a contract/);
  });

  it('explains how a job goes the first time one is taken, and only then', () => {
    const { ok, accept, subjects } = harness();
    accept('steal');
    expect(subjects()).toEqual(['welcome', 'firstAccept']);
    ok({ type: 'abandonContract' });
    accept('destroy');
    expect(subjects()).toEqual(['welcome', 'firstAccept']);
  });

  it('takes a contract back when the player gives it up', () => {
    const { state, ok, refused, accept } = harness();
    refused({ type: 'abandonContract' }, /no contract/);
    accept('steal');
    ok({ type: 'abandonContract' });
    expect(state.contracts.activeId).toBeNull();
    expect(offered(state)).toContain('steal');
  });

  it('always has something to offer, even to a player whose rating has fallen', () => {
    const { state } = harness();
    state.contracts.completed = ['steal', 'destroy'];
    expect(offered(state)).toEqual(['record']);
    state.contracts.completed.push('record');
    expect(offered(state)).toEqual(['elite']);
    state.contracts.completed.push('elite');
    expect(offered(state)).toEqual([]);
  });

  it('holds a contract back while there is standing work to raise the rating with', () => {
    const { state } = harness();
    state.contracts.completed = ['steal', 'destroy', 'record'];
    state.contracts.jobs = [{ ...testContracts[0]!, id: 'job-1', expiresMs: state.clock.gameTimeMs + 3_600_000 }];
    expect(offered(state)).toEqual(['job-1']);
    expect(nextContractRating(state, content)).toBe(50);
    state.player.rating = 50;
    expect(offered(state)).toEqual(['elite', 'job-1']);
    expect(nextContractRating(state, content)).toBeUndefined();
    state.contracts.completed.push('elite');
    expect(nextContractRating(state, content)).toBeUndefined();
  });

  it('stops offering a copy job once the file is gone for good', () => {
    const { state } = harness();
    state.servers.corp!.files = [];
    expect(objectivePossible(state, content, byId('steal'))).toBe(false);
    expect(offered(state)).toEqual(['destroy']);
  });
});

describe('doing the job', () => {
  it('copy: done when the file is on the gateway, and delivery hands it over', () => {
    const { state, ok, refused, here, accept, breakIn, wait, subjects } = harness();
    accept('steal');
    refused({ type: 'deliverContract' }, /not done yet/);
    breakIn();
    ok({ type: 'runProgram', connectionId: here(), target: { kind: 'copyFile', file: 'secret.dat' } });
    wait(7);
    expect(objectiveMet(state, content, byId('steal'))).toBe(true);
    ok({ type: 'disconnectAll' });

    ok({ type: 'deliverContract' });
    expect(state.player).toMatchObject({ balance: 400, rating: 1, files: [] });
    expect(state.contracts).toMatchObject({ activeId: null, completed: ['steal'], jobs: [] });
    expect(subjects().slice(-2)).toEqual(['Paid: Steal it', 'firstDelivery']);
    expect(state.messages.at(-2)).toMatchObject({ from: 'Client S', body: '300' });
    refused({ type: 'deliverContract' }, /no contract/);
    expect(offered(state)).not.toContain('steal');
  });

  it('copy: a file of the same name from somewhere else does not count', () => {
    const { state } = harness();
    state.player.files.push({ name: 'secret.dat', sizeGq: 5, from: 'directory' });
    expect(objectiveMet(state, content, byId('steal'))).toBe(false);
  });

  it('delete: done when the file is gone from the target', () => {
    const { state, ok, here, accept, breakIn, wait } = harness();
    accept('destroy');
    breakIn();
    ok({ type: 'runProgram', connectionId: here(), target: { kind: 'deleteFile', file: 'secret.dat' } });
    wait(5);
    ok({ type: 'deliverContract' });
    expect(state.player).toMatchObject({ balance: 500, rating: 2 });
  });

  it('record: the change needs the contract, an administrator and a way past the proxy', () => {
    const { state, ok, refused, here, visit, accept, breakIn } = harness();
    state.player.rating = 1;
    breakIn();
    refused({ type: 'alterRecord', connectionId: here() }, /no reason to change/);
    accept('record');
    visit('directory', 'guest');
    refused({ type: 'alterRecord', connectionId: here() }, /no reason to change/);
    breakIn();
    state.connections[0]!.bypassed.proxy = false;
    refused({ type: 'alterRecord', connectionId: here() }, /proxy is blocking/);
    state.connections[0]!.bypassed.proxy = true;

    ok({ type: 'alterRecord', connectionId: here() });
    expect(state.servers.corp!.records).toEqual([['1', 'Ann'], ['2', 'Bob']]);
    expect(state.servers.corp!.logs.at(-1)).toMatchObject({ text: 'record updated: 2', byPlayer: true });
    refused({ type: 'alterRecord', connectionId: here() }, /already says so/);
    ok({ type: 'deliverContract' });
    expect(state.player.rating).toBe(2);
  });

  it('record: making the change is noticed by the monitor', () => {
    const { state, ok, here, accept, breakIn } = harness();
    state.player.rating = 1;
    accept('record');
    breakIn();
    state.connections[0]!.trace.status = 'none';
    ok({ type: 'alterRecord', connectionId: here() });
    expect(state.connections[0]!.trace.status).toBe('pending');
  });

  it('sends the first-delivery note only once', () => {
    const { state, ok, accept, subjects } = harness();
    for (const id of ['steal', 'destroy']) {
      accept(id);
      state.player.files.push({ name: 'secret.dat', sizeGq: 5, from: 'corp' });
      state.servers.corp!.files = [];
      ok({ type: 'deliverContract' });
    }
    expect(subjects().filter((subject) => subject === 'firstDelivery')).toHaveLength(1);
  });
});

describe('the market', () => {
  it('sells a program once, to a player at the board who can pay', () => {
    const { state, ok, refused, here, visit } = harness();
    refused({ type: 'buyProgram', connectionId: 'nope', programId: 'breaker-2' }, /Log in to the board/);
    visit('hidden', 'member');
    refused({ type: 'buyProgram', connectionId: here(), programId: 'gold-plated' }, /cannot afford/);
    refused({ type: 'buyProgram', connectionId: here(), programId: 'copier' }, /already own/);
    refused({ type: 'buyProgram', connectionId: here(), programId: 'nope' }, /not for sale/);
    ok({ type: 'buyProgram', connectionId: here(), programId: 'breaker-2' });
    expect(state.player.balance).toBe(40);
    expect(state.player.programs).toContain('breaker-2');
    refused({ type: 'buyProgram', connectionId: here(), programId: 'breaker-2' }, /already own/);
  });

  it('makes the better program the one that runs', () => {
    const { state, ok, here, visit } = harness();
    visit('hidden', 'member');
    ok({ type: 'buyProgram', connectionId: here(), programId: 'breaker-2' });
    ok({ type: 'disconnectAll' });
    ok({ type: 'connect', serverId: 'corp' });
    ok({ type: 'runProgram', connectionId: here(), target: { kind: 'password', user: 'admin' } });
    // Version 2 against a level 1 password: half of 10 seconds.
    expect(state.tasks[0]).toMatchObject({ programId: 'breaker-2', durationMs: 5_000 });
  });
});

describe('gateway storage', () => {
  const sized = (sizeGq: number) => ({
    ...content,
    programs: content.programs.map((program) => ({ ...program, sizeGq })),
  });

  it('counts installed programs as well as files', () => {
    const { state } = harness();
    const big = sized(2);
    state.player.files.push({ name: 'a.dat', sizeGq: 3, from: 'corp' });
    expect(programStorageGq(state, big)).toBe(2 * state.player.programs.length);
    expect(usedStorageGq(state, big)).toBe(2 * state.player.programs.length + 3);
  });

  it('refuses to buy a program there is no room for', () => {
    const { state, here, visit } = harness();
    visit('hidden', 'member');
    // Six starting programs of 3 GB fill 18 of the 20 GB.
    const result = applyAction(state, { type: 'buyProgram', connectionId: here(), programId: 'breaker-2' }, sized(3));
    expect(result).toEqual({ ok: false, reason: 'Not enough room on your gateway.' });
    expect(state.player.balance).toBe(100);
  });

  it('removes a program, and the market gives a starting program back for nothing', () => {
    const { state, ok, refused, here, visit, breakIn } = harness();
    refused({ type: 'uninstallProgram', programId: 'nope' }, /not installed/);
    ok({ type: 'uninstallProgram', programId: 'copier' });
    expect(state.player.programs).not.toContain('copier');
    breakIn();
    refused({ type: 'runProgram', connectionId: here(), target: { kind: 'copyFile', file: 'secret.dat' } }, /do not own/);
    visit('hidden', 'member');
    ok({ type: 'buyProgram', connectionId: here(), programId: 'copier' });
    expect(state.player.programs).toContain('copier');
    expect(state.player.balance).toBe(100);
  });

  it('will not remove a program while it is running', () => {
    const { ok, refused, here } = harness();
    ok({ type: 'connect', serverId: 'corp' });
    ok({ type: 'runProgram', connectionId: here(), target: { kind: 'password', user: 'admin' } });
    refused({ type: 'uninstallProgram', programId: 'breaker' }, /running/);
  });

  it('deletes a stored file, which undoes a steal that was not delivered yet', () => {
    const { state, ok, refused, accept } = harness();
    accept('steal');
    state.player.files.push({ name: 'secret.dat', sizeGq: 5, from: 'corp' });
    expect(objectiveMet(state, content, byId('steal'))).toBe(true);
    ok({ type: 'deleteStoredFile', name: 'secret.dat' });
    expect(state.player.files).toEqual([]);
    expect(objectiveMet(state, content, byId('steal'))).toBe(false);
    refused({ type: 'deleteStoredFile', name: 'secret.dat' }, /no such file/);
  });
});

describe('being traced', () => {
  /** Breaks in directly and waits for the trace (8s wait, then 5s) to finish. */
  const getCaught = (h: ReturnType<typeof harness>) => {
    h.breakIn();
    h.wait(14);
    expect(h.state.connections).toEqual([]);
  };

  it('costs a fine, rating, the broken password and some time without work', () => {
    const h = harness();
    h.state.player.rating = 3;
    getCaught(h);
    // Corp's four layers are level 1 each, at 20 a level.
    expect(h.state.player).toMatchObject({ balance: 20, rating: 2, passwords: {} });
    expect(isLyingLow(h.state)).toBe(true);
    expect(h.state.messages.at(-1)).toMatchObject({ subject: 'Traced by Test Corp', body: 'fine 80, 6 hours' });

    h.visit('hidden', 'member');
    h.refused({ type: 'acceptContract', connectionId: h.here(), contractId: 'steal' }, /lying low/);
    h.ok({ type: 'disconnectAll' });
    h.wait(6 * 60 * 60);
    expect(isLyingLow(h.state)).toBe(false);
    h.accept('steal');
  });

  it('never takes more money than the player has, or rating below zero', () => {
    const h = harness();
    h.state.player.balance = 30;
    getCaught(h);
    expect(h.state.player).toMatchObject({ balance: 0, rating: 0 });
    expect(h.state.messages.at(-1)!.body).toBe('fine 30, 6 hours');
  });

  it('loses an unfinished contract against that server, which goes back on the board', () => {
    const h = harness();
    h.accept('steal');
    getCaught(h);
    expect(h.state.contracts.activeId).toBeNull();
    expect(h.subjects().slice(-2)).toEqual(['Withdrawn: Steal it', 'Traced by Test Corp']);
    expect(offered(h.state)).toContain('steal');
  });

  it('keeps a contract whose job was already done before the trace landed', () => {
    const h = harness();
    h.accept('destroy');
    h.state.servers.corp!.files = [];
    getCaught(h);
    expect(h.state.contracts.activeId).toBe('destroy');
    h.ok({ type: 'deliverContract' });
  });

  it('keeps a contract that is about a different server', () => {
    const h = harness();
    h.state.player.rating = 50;
    h.accept('elite');
    getCaught(h);
    expect(h.state.contracts.activeId).toBe('elite');
  });
});

describe('saves', () => {
  it('round-trip a contract in progress', () => {
    const { state, accept } = harness();
    accept('steal');
    state.player.lieLowUntilMs = 5;
    const loaded = syncWithContent(deserializeGame(serializeGame(state, '')).state, content);
    expect(loaded).toEqual(state);
  });

  it('from before contracts existed (version 3) load with a clean slate', () => {
    const { state } = harness();
    const old = JSON.parse(serializeGame(state, '')) as { version: number; state: Record<string, any> };
    old.version = old.state.version = 3;
    delete old.state.contracts;
    delete old.state.flags;
    delete old.state.player.rating;
    delete old.state.player.lieLowUntilMs;
    const loaded = deserializeGame(JSON.stringify(old)).state;
    expect(loaded).toMatchObject({ version: STATE_VERSION, contracts: { activeId: null, completed: [] }, flags: [] });
    expect(loaded.player).toMatchObject({ rating: 0, lieLowUntilMs: 0 });
  });

  it('drop a contract that is no longer in the game', () => {
    const { state } = harness();
    state.contracts.activeId = 'retired';
    syncWithContent(state, content);
    expect(state.contracts.activeId).toBeNull();
  });

  it('reject damaged contract data', () => {
    const { state } = harness();
    (state.contracts as unknown) = { activeId: 7, completed: [] };
    expect(() => deserializeGame(serializeGame(state, ''))).toThrow(/damaged/);
  });
});
