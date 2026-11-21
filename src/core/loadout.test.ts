import { describe, expect, it } from 'vitest';
import { applyAction, checkTask, createGame, deserializeGame, serializeGame, syncWithContent, tick, whyNotLearn, type Action, type Content, type GameState } from './index';
import { caught } from './actions';
import { freeMemoryGb, loadedPrograms, matchesLoadout, memoryGb, usedMemoryGb } from './loadout';
import { movesLeft, whyNotMove } from './moves';
import { STATE_VERSION } from './state';
import { content as testContent } from './testWorld';
import { coolHeat, coolWithTime, wanted, wantedLevel } from './wanted';
import { shopFor } from './market';
import { findServer } from './world';

/*
 * The test world with memory and sizes: stock memory holds 6 GB, the next
 * part 10 GB, the one after 14 GB. The three bypasses and the breaker take 2 GB each, the file
 * tools, the log deleter and the tracker 1 GB. Skills for the three moves
 * and the three signatures are added, each for one point.
 */
const SIZES: Record<string, number> = { breaker: 2, 'breaker-2': 3, proxy: 2, firewall: 2, blinder: 2, copier: 1, deleter: 1, logs: 1, tracker: 1, decrypter: 3 };
const skill = (id: string, effect: Content['skills'][number]['effect'], extra: object = {}) => ({ id, branch: 'ghost' as const, row: 4, name: id, blurb: 'b', ranks: 1, cost: 1, effect, amount: 1, ...extra });
const content: Content = {
  ...testContent,
  programs: testContent.programs.map((program) => ({ ...program, sizeGq: SIZES[program.id] ?? 0 })),
  hardware: [
    ...testContent.hardware,
    { id: 'memory-1', slot: 'memory', tier: 1, name: 'm1', blurb: 'b', price: 0, memoryGb: 6 },
    { id: 'memory-2', slot: 'memory', tier: 2, name: 'm2', blurb: 'b', price: 100, memoryGb: 10 },
    { id: 'memory-3', slot: 'memory', tier: 3, name: 'm3', blurb: 'b', price: 200, memoryGb: 14 },
  ],
  skills: [
    ...testContent.skills,
    skill('surge', 'surge'),
    skill('decoy', 'falseTrail'),
    skill('patch', 'hotPatch'),
    skill('twice', 'doubleTap', { signature: true, cost: 0, row: 5 }),
    skill('ninth', 'ninthRelay', { signature: true, cost: 0, row: 5 }),
    skill('deep', 'deepMemory', { signature: true, cost: 0, row: 5, amount: 4 }),
  ],
  rules: { ...testContent.rules, signatureRating: 10 },
};

function game(skills: Record<string, number> = {}) {
  const state: GameState = syncWithContent(createGame({ seed: 5, handle: 'T', startDate: '2034-03-14T08:00:00Z', startingBalance: 5000 }), content);
  state.knownServers = content.servers.map((server) => server.id);
  state.player.skills = { ...skills };
  const act = (action: Action) => applyAction(state, action, content);
  const ok = (action: Action) => expect(act(action)).toEqual({ ok: true });
  const refused = (action: Action, pattern: RegExp) => {
    const result = act(action);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(pattern);
  };
  const wait = (seconds: number) => tick(state, seconds * 1000, content);
  const enter = (serverId = 'corp') => {
    ok({ type: 'connect', serverId });
    return state.connections.at(-1)!;
  };
  return { state, act, ok, refused, wait, enter };
}

describe('loadouts', () => {
  it('packs a new gateway with what fits, most needed first', () => {
    const { state } = game();
    expect(memoryGb(state, content)).toBe(6);
    expect(state.player.loadout).toEqual(['breaker', 'proxy', 'firewall']);
    expect(usedMemoryGb(state, content)).toBe(6);
    // Everything is still on the drive.
    expect(state.player.programs).toContain('copier');
  });

  it('loads and unloads by hand, within the room there is', () => {
    const { state, ok, refused } = game();
    refused({ type: 'loadProgram', programId: 'copier' }, /Not enough memory: copier takes 1 GB and 0 GB is free/);
    ok({ type: 'unloadProgram', programId: 'firewall' });
    ok({ type: 'loadProgram', programId: 'copier' });
    ok({ type: 'loadProgram', programId: 'logs' });
    expect(freeMemoryGb(state, content)).toBe(0);
    refused({ type: 'loadProgram', programId: 'copier' }, /already in memory/);
    refused({ type: 'unloadProgram', programId: 'firewall' }, /not in memory/);
    refused({ type: 'loadProgram', programId: 'decrypter' }, /runs at home/);
    refused({ type: 'loadProgram', programId: 'breaker-2' }, /not installed/);
  });

  it('holds one program of a kind: a second takes the place of the first', () => {
    const { state, ok, refused } = game();
    state.player.programs.push('breaker-2');
    // 3 GB in place of 2 GB, with nothing free: it does not fit.
    refused({ type: 'loadProgram', programId: 'breaker-2' }, /Not enough memory/);
    ok({ type: 'unloadProgram', programId: 'firewall' });
    ok({ type: 'loadProgram', programId: 'breaker-2' });
    expect(state.player.loadout).toEqual(['breaker-2', 'proxy']);
  });

  it('only runs what is in memory, and locks while inside a server', () => {
    const { state, ok, refused, enter } = game();
    ok({ type: 'unloadProgram', programId: 'breaker' });
    const connection = enter();
    const check = checkTask(state, content, connection, { kind: 'password', user: 'admin' });
    expect(check).toMatchObject({ ok: false, reason: expect.stringMatching(/on your drive, not in memory/) });
    refused({ type: 'loadProgram', programId: 'breaker' }, /locked while you are inside a server/);
    refused({ type: 'unloadProgram', programId: 'proxy' }, /locked/);
    refused({ type: 'packMemory' }, /locked/);
    ok({ type: 'disconnectAll' });
    ok({ type: 'loadProgram', programId: 'breaker' });
    expect(checkTask(state, content, enter(), { kind: 'password', user: 'admin' }).ok).toBe(true);
  });

  it('can be repacked at a board or the directory, which are not jobs', () => {
    const { ok, enter } = game();
    enter('directory');
    ok({ type: 'unloadProgram', programId: 'firewall' });
    ok({ type: 'loadProgram', programId: 'copier' });
  });

  it('runs home programs straight off the drive', () => {
    const { state } = game();
    state.player.files.push({ name: 'sealed.dat', sizeGq: 2, from: 'vault', encrypted: 1 });
    expect(state.player.loadout).not.toContain('decrypter');
    expect(applyAction(state, { type: 'decryptFile', name: 'sealed.dat' }, content)).toEqual({ ok: true });
  });

  it('keeps three kits and swaps between them', () => {
    const { state, ok, refused } = game();
    ok({ type: 'saveLoadout', slot: 0 });
    ok({ type: 'unloadProgram', programId: 'proxy' });
    ok({ type: 'unloadProgram', programId: 'firewall' });
    ok({ type: 'loadProgram', programId: 'copier' });
    ok({ type: 'loadProgram', programId: 'deleter' });
    ok({ type: 'saveLoadout', slot: 1 });
    expect(matchesLoadout(state, content, 1)).toBe(true);
    ok({ type: 'useLoadout', slot: 0 });
    expect(state.player.loadout).toEqual(['breaker', 'proxy', 'firewall']);
    expect(matchesLoadout(state, content, 0)).toBe(true);
    refused({ type: 'useLoadout', slot: 2 }, /empty/);
    refused({ type: 'saveLoadout', slot: 3 }, /no such slot/);
    // A program that has since left the drive is left out of the kit.
    ok({ type: 'uninstallProgram', programId: 'deleter' });
    ok({ type: 'useLoadout', slot: 1 });
    expect(state.player.loadout).toEqual(['breaker', 'copier']);
  });

  it('packs the best of each kind on request, and more memory holds more', () => {
    const { state, ok } = game();
    state.player.programs.push('breaker-2');
    state.player.hardware.memory = 2;
    ok({ type: 'packMemory' });
    expect(state.player.loadout).toEqual(['breaker-2', 'proxy', 'firewall', 'blinder', 'copier']);
    expect(usedMemoryGb(state, content)).toBe(10);
  });

  it('survives saving and loading, and an old save is packed on the way in', () => {
    const { state, ok } = game();
    ok({ type: 'unloadProgram', programId: 'firewall' });
    ok({ type: 'saveLoadout', slot: 2 });
    const text = serializeGame(state, '2034-03-14T09:00:00Z');
    const loaded = syncWithContent(deserializeGame(text).state, content);
    expect(loaded.player.loadout).toEqual(['breaker', 'proxy']);
    expect(loaded.player.savedLoadouts[2]).toEqual(['breaker', 'proxy']);

    // A save from before loadouts: no memory part, no loadout, a "preferred" list.
    const file = JSON.parse(text);
    file.version = 25;
    file.state.version = 25;
    delete file.state.wanted;
    delete file.state.player.loadout;
    delete file.state.player.savedLoadouts;
    delete file.state.player.hardware.memory;
    file.state.player.preferred = { breakPassword: 'breaker' };
    file.state.flags = file.state.flags.filter((flag: string) => flag !== 'loadouts');
    const old = syncWithContent(deserializeGame(JSON.stringify(file)).state, content);
    expect(old.version).toBe(STATE_VERSION);
    expect(old.player.hardware.memory).toBe(3);
    expect(old.wanted).toEqual({ heat: 0, level: 0, day: 0 });
    // Everything it owned and could run before still runs: memory was made to fit.
    expect(loadedPrograms(old, content).map((program) => program.kind)).toEqual(expect.arrayContaining(['breakPassword', 'bypassProxy', 'bypassFirewall', 'copyFile', 'deleteLog']));
    expect(usedMemoryGb(old, content)).toBeLessThanOrEqual(memoryGb(old, content));
  });
});

describe('skills that are a button', () => {
  it('Overclock doubles the speed of what is running for ten seconds, and wakes the monitor', () => {
    const { state, ok, refused, wait, enter } = game({ surge: 1 });
    // Two relays, so the trace it starts takes longer than the break.
    ok({ type: 'addHop', serverId: 'relay-a' });
    ok({ type: 'addHop', serverId: 'relay-b' });
    const connection = enter();
    refused({ type: 'useMove', connectionId: connection.id, move: 'overclock' }, /Nothing is running/);
    ok({ type: 'runProgram', connectionId: connection.id, target: { kind: 'password', user: 'admin' } });
    ok({ type: 'useMove', connectionId: connection.id, move: 'overclock' });
    expect(connection.trace.status).toBe('active');
    // A ten-second break, done in five.
    wait(5.01);
    expect(state.player.passwords.corp).toContain('admin');
    refused({ type: 'useMove', connectionId: connection.id, move: 'overclock' }, /spent on this connection/);
    expect(movesLeft(state, content, connection, 'overclock')).toBe(0);
  });

  it('cannot be used before it is learned', () => {
    const { refused, enter } = game();
    const connection = enter();
    refused({ type: 'useMove', connectionId: connection.id, move: 'overclock' }, /not learned Overclock/);
    refused({ type: 'useMove', connectionId: connection.id, move: 'falseTrail' }, /not learned False trail/);
  });

  it('False trail sends a running trace back', () => {
    const { state, ok, refused, wait } = game({ decoy: 1 });
    ok({ type: 'addHop', serverId: 'relay-a' });
    ok({ type: 'addHop', serverId: 'relay-b' });
    ok({ type: 'connect', serverId: 'vault' });
    const connection = state.connections.at(-1)!;
    // The vault traces from the moment you connect: 10 seconds a relay.
    wait(15);
    expect(connection.trace.status).toBe('active');
    const before = connection.trace.elapsedMs;
    expect(before).toBeGreaterThan(10_000);
    ok({ type: 'useMove', connectionId: connection.id, move: 'falseTrail' });
    // It was on the second step: it loses that one and the one before.
    expect(connection.trace.elapsedMs).toBe(0);
    refused({ type: 'useMove', connectionId: connection.id, move: 'falseTrail' }, /spent/);
  });

  it('Hot patch makes a loaded program a match for one stronger layer, for a module', () => {
    const { state, ok, refused, enter } = game({ patch: 1 });
    ok({ type: 'unloadProgram', programId: 'proxy' });
    ok({ type: 'loadProgram', programId: 'blinder' });
    const connection = enter('vault');
    refused({ type: 'useMove', connectionId: connection.id, move: 'hotPatch', layer: 'monitor' }, /shelf is empty/);
    state.player.parts = { 'swift:2': 1, 'quiet:1': 1 };
    expect(whyNotMove(state, content, connection.id, 'hotPatch')).toMatch(/Pick the layer/);
    refused({ type: 'useMove', connectionId: connection.id, move: 'hotPatch', layer: 'firewall' }, /already a match|no program/);
    ok({ type: 'useMove', connectionId: connection.id, move: 'hotPatch', layer: 'monitor' });
    // The cheapest module went into it.
    expect(state.player.parts).toEqual({ 'swift:2': 1 });
    expect(connection.patched).toBe('monitor');
    expect(checkTask(state, content, connection, { kind: 'monitor' })).toMatchObject({ ok: true, seconds: 4 });
    refused({ type: 'useMove', connectionId: connection.id, move: 'hotPatch', layer: 'monitor' }, /spent/);
  });

  it('a signature opens at the top of the board, costs nothing, and there is only one', () => {
    const { state, ok, refused, enter } = game({ surge: 1 });
    expect(whyNotLearn(state, content, 'twice')).toMatch(/best rating of 10/);
    state.player.bestRating = 10;
    ok({ type: 'learnSkill', skillId: 'twice' });
    refused({ type: 'learnSkill', skillId: 'deep' }, /already carry a signature: twice/);
    // Second wind: every move works twice on a connection.
    expect(movesLeft(state, content, enter(), 'overclock')).toBe(2);
  });

  it('Deep memory adds room, and Ninth relay a ninth hop', () => {
    const deep = game({ deep: 1 });
    expect(memoryGb(deep.state, content)).toBe(10);
    const ninth = game({ ninth: 1 });
    const relays = Array.from({ length: 9 }, (_, index) => ({ ...findServer(content, 'relay-b')!, id: `r${index}`, address: `10.9.0.${index}` }));
    const wide: Content = { ...content, servers: [...content.servers, ...relays] };
    ninth.state.knownServers.push(...relays.map((relay) => relay.id));
    for (const relay of relays) expect(applyAction(ninth.state, { type: 'addHop', serverId: relay.id }, wide).ok).toBe(true);
    const plain = game();
    plain.state.knownServers.push(...relays.map((relay) => relay.id));
    const results = relays.map((relay) => applyAction(plain.state, { type: 'addHop', serverId: relay.id }, wide));
    expect(results.filter((result) => result.ok).length).toBe(8);
  });
});

describe('the wanted level', () => {
  it('rises with every trace that lands, and says so in the letter about it', () => {
    const { state, enter } = game();
    expect(wantedLevel(state)).toBe(0);
    caught(state, content, enter());
    expect(wanted(state).name).toBe('Noticed');
    const letter = state.messages.find((message) => message.subject.startsWith('Traced by'))!;
    expect(letter.body).toMatch(/The word on you now: NOTICED\./);
    expect(letter.body).toMatch(/Shops charge 10% more\./);
    state.player.lieLowUntilMs = 0;
    caught(state, content, enter());
    expect(wanted(state).name).toBe('Wanted');
    state.player.lieLowUntilMs = 0;
    caught(state, content, enter());
    expect(wanted(state).name).toBe('Hunted');
    expect(state.messages.at(-1)!.body).toMatch(/HUNTED/);
  });

  it('makes shops dearer and fines bigger', () => {
    const { state, enter } = game();
    const shop = findServer(content, 'hidden')!;
    const before = shopFor(state, content, shop)!.priceFactor ?? 1;
    const balance = state.player.balance;
    caught(state, content, enter());
    const firstFine = balance - state.player.balance;
    expect(shopFor(state, content, shop)!.priceFactor).toBeCloseTo(before * 1.1);
    state.player.lieLowUntilMs = 0;
    const second = state.player.balance;
    caught(state, content, enter());
    // The second fine is charged at Noticed: a quarter more.
    expect(second - state.player.balance).toBe(Math.round(firstFine * 1.25));
  });

  it('fades with delivered work and quiet days', () => {
    const { state, enter } = game();
    caught(state, content, enter());
    expect(state.wanted.heat).toBe(2);
    coolHeat(state, 0.5);
    expect(state.wanted.heat).toBe(1.5);
    expect(wantedLevel(state)).toBe(0);
    // Two days later the rest has gone.
    coolWithTime(state);
    state.clock.gameTimeMs += 3 * 86_400_000;
    coolWithTime(state);
    expect(state.wanted.heat).toBe(0);
  });
});
