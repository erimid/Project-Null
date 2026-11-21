import { describe, expect, it } from 'vitest';
import {
  SaveError,
  STATE_VERSION,
  applyAction,
  createGame,
  deserializeGame,
  effectiveSpeed,
  gameDate,
  readSummary,
  serializeGame,
  stream,
  syncWithContent,
  tick,
  type Action,
  type GameState,
  type Migration,
} from './index';

import { content } from './testWorld';

const fullPlayer = { hardware: { cpu: 1, memory: 1, storage: 1, modem: 1, ports: 1, rack: 0, sensor: 0, cooling: 0 }, programs: content.startingPrograms, files: [], passwords: {}, rating: 0, bestRating: 0, skills: {}, unlearns: 0, parts: {}, builds: [], loadout: expect.any(Array), savedLoadouts: [[], [], []], lieLowUntilMs: 0, contacts: [], facts: [], model: null };
const newGame = (): GameState =>
  syncWithContent(
    createGame({ seed: 7, handle: 'TESTER', startDate: '2034-03-14T08:00:00Z', startingBalance: 2500 }),
    content,
  );
const act = (state: GameState, action: Action) => applyAction(state, action, content);
const connect = (state: GameState) => expect(act(state, { type: 'connect', serverId: 'directory' })).toEqual({ ok: true });

describe('new game', () => {
  it('starts at the configured date with the starting balance', () => {
    const state = newGame();
    expect(gameDate(state)).toEqual({ year: 2034, month: 3, day: 14, weekday: 2, hours: 8, minutes: 0 });
    expect(state.player).toEqual({ handle: 'TESTER', balance: 2500, ...fullPlayer });
    expect(state.connections).toEqual([]);
  });

  it('rejects a bad start date', () => {
    expect(() => createGame({ seed: 1, handle: 'X', startDate: 'nope', startingBalance: 0 })).toThrow(RangeError);
  });
});

describe('clock', () => {
  it('advances one game minute per real second at 1×', () => {
    const state = newGame();
    tick(state, 90_000, content);
    expect(gameDate(state)).toMatchObject({ hours: 9, minutes: 30 });
  });

  it('runs faster at 2× and 4×, and stops when paused', () => {
    for (const [speed, minutes] of [[2, 20], [4, 40], [0, 0]] as const) {
      const state = newGame();
      expect(act(state, { type: 'setSpeed', speed })).toEqual({ ok: true });
      expect(tick(state, 10_000, content)).toBe(10_000 * speed);
      expect(gameDate(state)).toMatchObject({ hours: 8, minutes });
    }
  });

  it('rolls over midnight into the next day', () => {
    const state = newGame();
    tick(state, 16 * 60 * 1000, content);
    expect(gameDate(state)).toMatchObject({ day: 15, weekday: 3, hours: 0, minutes: 0 });
  });

  it('ignores zero, negative and NaN time steps', () => {
    const state = newGame();
    const before = state.clock.gameTimeMs;
    for (const dt of [0, -5, Number.NaN]) expect(tick(state, dt, content)).toBe(0);
    expect(state.clock.gameTimeMs).toBe(before);
  });

  it('gives the same result in many small steps as in one big step', () => {
    const a = newGame();
    const b = newGame();
    tick(a, 60_000, content);
    for (let i = 0; i < 600; i++) tick(b, 100, content);
    expect(b.clock.gameTimeMs).toBe(a.clock.gameTimeMs);
  });

  it('respects the tuning for how fast game time runs', () => {
    const state = newGame();
    tick(state, 1_000, { ...content, rules: { ...content.rules, gameMinutesPerRealSecond: 5 } });
    expect(gameDate(state)).toMatchObject({ hours: 8, minutes: 5 });
  });
});

describe('time lock while connected', () => {
  it('forces 1× whatever speed was chosen', () => {
    for (const speed of [0, 4] as const) {
      const state = newGame();
      act(state, { type: 'setSpeed', speed });
      connect(state);
      expect(effectiveSpeed(state)).toBe(1);
      expect(tick(state, 1_000, content)).toBe(1_000);
    }
  });

  it('refuses speed changes, then allows them again after disconnecting', () => {
    const state = newGame();
    connect(state);
    const refused = act(state, { type: 'setSpeed', speed: 4 });
    expect(refused.ok).toBe(false);
    expect(state.clock.speed).toBe(1);
    act(state, { type: 'disconnectAll' });
    expect(act(state, { type: 'setSpeed', speed: 4 }).ok).toBe(true);
    expect(effectiveSpeed(state)).toBe(4);
  });

  it('refuses a speed that does not exist', () => {
    const state = newGame();
    expect(act(state, { type: 'setSpeed', speed: 3 as never }).ok).toBe(false);
  });
});

describe('random streams', () => {
  it('are repeatable for the same game seed and differ by name', () => {
    const a = stream(newGame(), 'trace');
    const b = stream(newGame(), 'trace');
    const c = stream(newGame(), 'world');
    const draw = (r: typeof a) => [r.next(), r.next(), r.next()];
    const first = draw(a);
    expect(draw(b)).toEqual(first);
    expect(draw(c)).not.toEqual(first);
  });

  it('continue where they left off after a save and load', () => {
    const state = newGame();
    const rng = stream(state, 'trace');
    rng.int(1, 100);
    rng.pick(['a', 'b', 'c']);
    const loaded = deserializeGame(serializeGame(state, '2026-01-01T00:00:00Z')).state;
    const expected = [rng.next(), rng.next(), rng.next()];
    const resumed = stream(loaded, 'trace');
    expect([resumed.next(), resumed.next(), resumed.next()]).toEqual(expected);
  });

  it('do not disturb each other', () => {
    const solo = newGame();
    const mixed = newGame();
    const soloTrace = stream(solo, 'trace');
    const mixedTrace = stream(mixed, 'trace');
    const mixedWorld = stream(mixed, 'world');
    const expected = [soloTrace.next(), soloTrace.next()];
    mixedWorld.next();
    const got = [mixedTrace.next()];
    mixedWorld.next();
    got.push(mixedTrace.next());
    expect(got).toEqual(expected);
  });
});

describe('save and load', () => {
  it('round-trips the whole game', () => {
    const state = newGame();
    act(state, { type: 'setSpeed', speed: 2 });
    tick(state, 123_456, content);
    state.player.balance = 9_001;
    stream(state, 'world').next();
    const text = serializeGame(state, '2026-11-18T03:00:00Z');
    const loaded = deserializeGame(text);
    expect(loaded.state).toEqual(state);
    expect(loaded.state).not.toBe(state);
    expect(loaded.summary).toEqual({
      handle: 'TESTER',
      balance: 9_001,
      gameTimeMs: state.clock.gameTimeMs,
      savedAt: '2026-11-18T03:00:00Z',
    });
    expect(readSummary(text)).toEqual(loaded.summary);
  });

  it.each([
    ['text that is not JSON', 'hello'],
    ['JSON that is not a save', '{"a":1}'],
    ['another format', JSON.stringify({ format: 'other', version: 1, state: {} })],
    ['a save with no version', JSON.stringify({ format: 'project-null-save', state: {} })],
    ['a damaged state', JSON.stringify({ format: 'project-null-save', version: 1, state: { seed: 1 } })],
  ])('rejects %s with a readable message', (_label, text) => {
    expect(() => deserializeGame(text)).toThrow(SaveError);
    expect(readSummary(text)).toBeNull();
  });

  it('rejects a save from a newer version of the game', () => {
    const text = serializeGame({ ...newGame(), version: 99 as never }, '');
    expect(() => deserializeGame(text)).toThrow(/newer version/);
  });

  it('rejects damaged fields inside an otherwise valid save', () => {
    const cases: ((s: GameState) => void)[] = [
      (s) => ((s.clock.speed as number) = 3),
      (s) => ((s.clock.gameTimeMs as unknown) = 'noon'),
      (s) => ((s.player.balance as unknown) = null),
      (s) => ((s.connections as unknown) = [{ id: 1 }]),
      (s) => ((s.connections as unknown) = [{ id: 'c1', serverId: 'x', route: [], openedAtMs: 0, user: 'a', role: 'king' }]),
      (s) => ((s.knownServers as unknown) = [7]),
      (s) => ((s.servers as unknown) = { x: { files: [], logs: [{ timeMs: 0 }], records: [] } }),
      (s) => ((s.player.hardware.ports as unknown) = 'two'),
      (s) => ((s.rngStreams as unknown) = { trace: 'x' }),
    ];
    for (const damage of cases) {
      const state = newGame();
      damage(state);
      expect(() => deserializeGame(serializeGame(state, ''))).toThrow(/damaged/);
    }
  });

  it('upgrades old saves step by step through migrations', () => {
    // A made-up history: version 5 kept money in "credits"; version 6 had no handle.
    const migrations: Record<number, Migration> = {
      5: (old) => {
        const { credits, ...player } = old.player as Record<string, unknown>;
        return { ...old, player: { ...player, balance: credits } };
      },
      6: (old) => ({ ...old, player: { ...(old.player as object), handle: 'RESTORED' } }),
    };
    const { player, ...rest } = newGame();
    const oldState = { ...rest, version: 5, player: { hardware: player.hardware, credits: 777, programs: [], files: [], passwords: {}, rating: 0, bestRating: 0, skills: {}, unlearns: 0, parts: {}, builds: [], loadout: [], savedLoadouts: [[], [], []], lieLowUntilMs: 0, contacts: [], facts: [], model: null } };
    const text = JSON.stringify({ format: 'project-null-save', version: 5, summary: {}, state: oldState });

    const loaded = deserializeGame(text, migrations, 7).state;
    expect(loaded.player).toEqual({ handle: 'RESTORED', balance: 777, hardware: { cpu: 1, memory: 1, storage: 1, modem: 1, ports: 1, rack: 0, sensor: 0, cooling: 0 }, programs: [], files: [], passwords: {}, rating: 0, bestRating: 0, skills: {}, unlearns: 0, parts: {}, builds: [], loadout: expect.any(Array), savedLoadouts: [[], [], []], lieLowUntilMs: 0, contacts: [], facts: [], model: null });
    expect(loaded.version).toBe(7);
  });

  it('loads a save from before connecting existed (version 1)', () => {
    const v1 = {
      format: 'project-null-save',
      version: 1,
      summary: { handle: 'OLD', balance: 1200, gameTimeMs: 2025936000000, savedAt: '2026-11-18T03:20:00Z' },
      state: {
        version: 1,
        seed: 99,
        rngStreams: { world: 12345 },
        clock: { gameTimeMs: 2025936000000, speed: 2 },
        player: { handle: 'OLD', balance: 1200 },
        connections: [],
      },
    };
    const loaded = syncWithContent(deserializeGame(JSON.stringify(v1)).state, content);
    expect(loaded.version).toBe(STATE_VERSION);
    expect(loaded.story).toEqual({ beat: 0, arrived: false, lastMs: 0, offered: [] });
    expect(loaded.raid).toBeNull();
    expect(loaded.raidPending).toBeNull();
    expect(loaded.savedRoutes).toEqual([[], [], []]);
    expect(loaded.relayHeat).toEqual({});
    expect(loaded.bookmarks).toEqual([]);
    expect(loaded.player).toEqual({ handle: 'OLD', balance: 1200, ...fullPlayer });
    expect(loaded.clock).toEqual({ gameTimeMs: 2025936000000, speed: 2 });
    expect(loaded.rngStreams).toEqual({ world: 12345 });
    expect(loaded.knownServers).toEqual(['gateway', 'directory']);
    expect(Object.keys(loaded.servers).sort()).toEqual(content.servers.map((s) => s.id).sort());
    expect(act(loaded, { type: 'connect', serverId: 'directory' }).ok).toBe(true);
  });

  it('refuses a save too old to have a migration', () => {
    const text = JSON.stringify({ format: 'project-null-save', version: 0, state: newGame() });
    // (there is no migration from version 0)
    expect(() => deserializeGame(text)).toThrow(/too old/);
  });
});
