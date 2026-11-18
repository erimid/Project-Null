import { describe, expect, it } from 'vitest';
import {
  applyAction,
  checkTask,
  createGame,
  deserializeGame,
  maxPrograms,
  maxReroutes,
  pointsEarned,
  pointsFree,
  ringTolerance,
  serializeGame,
  syncWithContent,
  tick,
  type Action,
  type Content,
  type GameState,
} from './index';
import { STATE_VERSION } from './state';
import { noteProgress } from './world';
import { content, testServers } from './testWorld';

/*
 * Test world reminders: corp has every layer at level 1 and takes 10s a
 * hop to trace; relay A doubles that. A skill point comes every 3 best
 * rating. Test skills have round numbers: Sharp tools +25% a rank, Long
 * way round +25% a rank, Steady hand 0.5, and so on (see testWorld.ts).
 */

const withCorp = (change: Partial<(typeof testServers)[number]>): Content => ({
  ...content,
  servers: testServers.map((server) => (server.id === 'corp' ? { ...server, ...change } : server)),
});

function game(skills: Record<string, number> = {}, world: Content = content) {
  const state: GameState = syncWithContent(
    createGame({ seed: 5, handle: 'T', startDate: '2034-03-14T08:00:00Z', startingBalance: 5000 }),
    world,
  );
  state.knownServers = world.servers.map((server) => server.id);
  state.player.passwords.corp = ['admin'];
  state.player.skills = { ...skills };
  const act = (action: Action) => applyAction(state, action, world);
  const ok = (action: Action) => expect(act(action)).toEqual({ ok: true });
  const refused = (action: Action, pattern: RegExp) => {
    const result = act(action);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(pattern);
  };
  /** Connects to corp through the relays and logs in as admin. Returns the connection id. */
  const enter = (route: string[] = [], serverId = 'corp', user = 'admin') => {
    for (const hop of route) ok({ type: 'addHop', serverId: hop });
    ok({ type: 'connect', serverId });
    const id = state.connections.at(-1)!.id;
    ok({ type: 'login', connectionId: id, user });
    return id;
  };
  const wait = (seconds: number) => tick(state, seconds * 1000, world);
  return { state, act, ok, refused, enter, wait, world };
}

const seconds = (state: GameState, connectionId: string | null, target: Parameters<typeof checkTask>[3], world = content) => {
  const check = checkTask(state, world, state.connections.find((c) => c.id === connectionId) ?? null, target);
  if (!check.ok) throw new Error(check.reason);
  return check.seconds;
};

describe('skill points', () => {
  it('come one for every 3 of the best rating ever reached', () => {
    const { state } = game();
    expect(pointsEarned(state, content)).toBe(0);
    state.player.bestRating = 8;
    expect(pointsEarned(state, content)).toBe(2);
    expect(pointsFree(state, content)).toBe(2);
  });

  it('are not lost when the rating drops after a trace', () => {
    const { state } = game();
    const wait = (_: number) => noteProgress(state, content);
    state.player.rating = 9;
    wait(1);
    expect(state.player.bestRating).toBe(9);
    state.player.rating = 4;
    wait(1);
    expect(state.player.bestRating).toBe(9);
    expect(pointsEarned(state, content)).toBe(3);
  });

  it('bring a message from Wren the first time one is earned', () => {
    const { state } = game();
    const wait = (_: number) => noteProgress(state, content);
    state.player.rating = 2;
    wait(1);
    expect(state.messages.some((m) => m.subject === 'skills')).toBe(false);
    state.player.rating = 3;
    wait(1);
    expect(state.messages.filter((m) => m.subject === 'skills')).toHaveLength(1);
    state.player.rating = 9;
    wait(1);
    expect(state.messages.filter((m) => m.subject === 'skills')).toHaveLength(1);
  });
});

describe('learning a skill', () => {
  it('spends its cost and raises its rank, up to the most it has', () => {
    const { state, ok, refused } = game();
    state.player.bestRating = 30;
    ok({ type: 'learnSkill', skillId: 'sharp' });
    ok({ type: 'learnSkill', skillId: 'sharp' });
    ok({ type: 'learnSkill', skillId: 'sharp' });
    expect(state.player.skills).toEqual({ sharp: 3 });
    expect(pointsFree(state, content)).toBe(7);
    refused({ type: 'learnSkill', skillId: 'sharp' }, /learned all of sharp/);
  });

  it('needs enough free points', () => {
    const { state, refused } = game();
    state.player.bestRating = 3;
    refused({ type: 'learnSkill', skillId: 'thread' }, /needs 2 points; you have 1/);
  });

  it('needs the skill above it first, where there is one', () => {
    const { state, ok, refused } = game();
    state.player.bestRating = 30;
    refused({ type: 'learnSkill', skillId: 'overreach' }, /Learn sharp first/);
    ok({ type: 'learnSkill', skillId: 'sharp' });
    ok({ type: 'learnSkill', skillId: 'overreach' });
  });

  it('refuses a skill that does not exist', () => {
    game().refused({ type: 'learnSkill', skillId: 'flight' }, /No such skill/);
  });
});

describe('unlearning', () => {
  const learned = () => {
    const g = game();
    g.state.player.bestRating = 30;
    g.ok({ type: 'learnSkill', skillId: 'sharp' });
    g.ok({ type: 'learnSkill', skillId: 'thread' });
    return g;
  };

  it('frees every point for a price paid at the board, more each time', () => {
    const { state, ok, enter } = learned();
    const board = enter([], 'hidden', 'member');
    ok({ type: 'unlearnSkills', connectionId: board });
    expect(state.player.skills).toEqual({});
    expect(pointsFree(state, content)).toBe(10);
    expect(state.player.balance).toBe(4000);
    ok({ type: 'learnSkill', skillId: 'sharp' });
    ok({ type: 'unlearnSkills', connectionId: board });
    expect(state.player.balance).toBe(2000);
  });

  it('only works while logged in to a board, with something to forget and the money to pay', () => {
    const { state, act, refused, enter } = learned();
    const corp = enter();
    refused({ type: 'unlearnSkills', connectionId: corp }, /Log in to the board/);
    act({ type: 'disconnectAll' });
    const board = enter([], 'hidden', 'member');
    state.player.balance = 999;
    refused({ type: 'unlearnSkills', connectionId: board }, /costs 1000 credits/);
    state.player.skills = {};
    refused({ type: 'unlearnSkills', connectionId: board }, /not learned anything/);
  });
});

describe('Intrusion skills', () => {
  it('Sharp tools speeds up cracking, a quarter per rank, and nothing else', () => {
    const plain = game();
    const sharp = game({ sharp: 2 });
    const a = plain.enter();
    const b = sharp.enter();
    plain.state.connections[0]!.bypassed.firewall = true;
    sharp.state.connections[0]!.bypassed.firewall = true;
    expect(seconds(plain.state, a, { kind: 'proxy' })).toBe(6);
    expect(seconds(sharp.state, b, { kind: 'proxy' })).toBe(4);
    expect(seconds(sharp.state, b, { kind: 'copyFile', file: 'secret.dat' })).toBe(seconds(plain.state, a, { kind: 'copyFile', file: 'secret.dat' }));
  });

  it('Extra thread runs one more program at once', () => {
    expect(maxPrograms(game({ thread: 1 }).state, content)).toBe(maxPrograms(game().state, content) + 1);
  });

  it('Overreach makes a stronger layer cost less extra time', () => {
    const hard = withCorp({ security: { password: 1, proxy: 3, firewall: 1, monitor: 0 } });
    const plain = game({}, hard);
    const over = game({ overreach: 1 }, hard);
    // Two levels behind: 6s doubled twice, or times 1.5 twice.
    expect(seconds(plain.state, plain.enter(), { kind: 'proxy' }, hard)).toBe(24);
    expect(seconds(over.state, over.enter(), { kind: 'proxy' }, hard)).toBe(13.5);
  });

  it('Steady hand slows the rings and widens the lock', () => {
    const { state, ok, enter } = game({ steady: 1 });
    const id = enter();
    ok({ type: 'runProgram', connectionId: id, target: { kind: 'firewall' } });
    expect(state.tasks[0]!.puzzle!.speeds).toEqual([35, -50, 65]);
    expect(ringTolerance(state, content)).toBe(30);
  });

  it('Auto-align starts the line-up with a ring locked and the bypass a third shorter', () => {
    const { state, ok, enter } = game({ steady: 1, align: 1 });
    const id = enter();
    ok({ type: 'runProgram', connectionId: id, target: { kind: 'firewall' } });
    expect(state.tasks[0]!.puzzle!.locked).toEqual([true, false, false]);
    expect(state.tasks[0]!.durationMs).toBe(4000);
  });
});

describe('Ghost skills', () => {
  it('Long way round makes every step of the trace take longer', () => {
    const { state, enter } = game({ long: 2 });
    enter(['relay-a']);
    expect(state.connections[0]!.trace.hopMs).toEqual([30_000]);
  });

  it('Patience gives a monitor longer before it starts tracing', () => {
    const { state, enter } = game({ patience: 1 });
    enter();
    // Corp's level 1 monitor waits 8s; half again is 12.
    expect(state.connections[0]!.trace).toMatchObject({ status: 'pending', graceMs: 12_000 });
  });

  it('Clean sweep halves the time to remove log lines', () => {
    const { state, enter } = game({ sweep: 1 });
    const id = enter();
    state.connections[0]!.bypassed.proxy = true;
    const logIds = [state.servers.corp!.logs.at(-1)!.id];
    expect(seconds(state, id, { kind: 'deleteLog', logIds })).toBe(1.5);
  });

  it('Cold trail books the log review later and halves its fine', () => {
    const { state, act, enter, wait } = game({ cold: 1 });
    enter(['relay-a']);
    act({ type: 'disconnectAll' });
    // 3 hours, half again later.
    expect(state.reviews[0]!.dueMs - state.clock.gameTimeMs).toBe(4.5 * 3_600_000);
    wait(4.5 * 60 + 1);
    // Corp's fine is 80; a review takes half, and Cold trail half of that.
    expect(state.player.balance).toBe(4980);
  });

  it('Slip away allows one more reroute and sends the trace back a relay further', () => {
    const { state, ok, enter, wait } = game({ slip: 1 });
    const id = enter(['relay-a', 'relay-b']);
    expect(maxReroutes(state, content)).toBe(3);
    wait(8 + 25);
    // Relay B (10s) is done; the trace is 15s into relay A.
    ok({ type: 'reroute', connectionId: id, serverId: 'directory' });
    expect(state.connections[0]!.trace.elapsedMs).toBe(0);
  });
});

describe('Engineering skills', () => {
  it('Tuned hardware speeds up the processor and the modem', () => {
    const plain = game();
    const tuned = game({ tuned: 2 });
    const a = plain.enter();
    const b = tuned.enter();
    plain.state.connections[0]!.bypassed.firewall = true;
    tuned.state.connections[0]!.bypassed.firewall = true;
    expect(seconds(tuned.state, b, { kind: 'proxy' })).toBe(seconds(plain.state, a, { kind: 'proxy' }) / 2);
    expect(seconds(tuned.state, b, { kind: 'copyFile', file: 'secret.dat' })).toBe(seconds(plain.state, a, { kind: 'copyFile', file: 'secret.dat' }) / 2);
  });
});

describe('saves', () => {
  it('keep learned skills, the best rating and how often skills were unlearned', () => {
    const { state } = game({ sharp: 2 });
    state.player.bestRating = 12;
    state.player.unlearns = 1;
    const loaded = deserializeGame(serializeGame(state, '')).state;
    expect(loaded.player).toMatchObject({ skills: { sharp: 2 }, bestRating: 12, unlearns: 1 });
  });

  it('from before the skill tree give the points the rating already earned', () => {
    const { state } = game();
    const old = JSON.parse(serializeGame(state, '')) as { version: number; state: Record<string, unknown> & { player: Record<string, unknown> } };
    old.version = 10;
    old.state.version = 10;
    old.state.player.rating = 7;
    delete old.state.player.bestRating;
    delete old.state.player.skills;
    delete old.state.player.unlearns;
    const loaded = deserializeGame(JSON.stringify(old)).state;
    expect(loaded.version).toBe(STATE_VERSION);
    expect(loaded.player).toMatchObject({ rating: 7, bestRating: 7, skills: {}, unlearns: 0 });
    expect(pointsFree(loaded, content)).toBe(2);
  });
});
