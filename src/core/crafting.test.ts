import { describe, expect, it } from 'vitest';
import {
  applyAction,
  checkTask,
  createGame,
  deserializeGame,
  ownedProgram,
  partCount,
  programStorageGq,
  serializeGame,
  syncWithContent,
  tick,
  type Action,
  type Content,
  type Fitted,
  type GameState,
} from './index';
import { STATE_VERSION } from './state';
import { content as testContent, testPrograms } from './testWorld';
import { noteProgress } from './world';

/*
 * Test world reminders: the Workbench takes 10s a module on a stock
 * processor. Swift doubles speed and size, Compact halves size, Quiet and
 * Tidy halve speed (grade 1). The breaker takes 10s against corp's level
 * 1 password; here it takes 4 GB. Corp's monitor (level 1) waits 8s.
 */
const content: Content = {
  ...testContent,
  programs: testContent.programs.map((program) => (program.id === 'breaker' || program.id === 'copier' ? { ...program, sizeGq: 4 } : program)),
};

function game(parts: Record<string, number> = {}, skills: Record<string, number> = {}) {
  const state: GameState = syncWithContent(
    createGame({ seed: 5, handle: 'T', startDate: '2034-03-14T08:00:00Z', startingBalance: 5000 }),
    content,
  );
  state.knownServers = content.servers.map((server) => server.id);
  state.player.parts = { ...parts };
  state.player.skills = { ...skills };
  const act = (action: Action) => applyAction(state, action, content);
  const ok = (action: Action) => expect(act(action)).toEqual({ ok: true });
  const refused = (action: Action, pattern: RegExp) => {
    const result = act(action);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(pattern);
  };
  const wait = (seconds: number) => tick(state, seconds * 1000, content);
  /** Builds and waits for it to finish. Returns the new program's id. */
  const build = (base: string, modules: Fitted[]) => {
    ok({ type: 'buildProgram', base, modules });
    wait(10 * modules.length + 0.01);
    return state.player.programs.at(-1)!;
  };
  const enterCorp = () => {
    ok({ type: 'connect', serverId: 'corp' });
    return state.connections.at(-1)!.id;
  };
  return { state, act, ok, refused, wait, build, enterCorp };
}

const swift1: Fitted = { id: 'swift', grade: 1 };
const quiet1: Fitted = { id: 'quiet', grade: 1 };

describe('the first modules', () => {
  it('arrive from Wren once enough contracts are delivered', () => {
    const { state } = game();
    const world = { ...content, rules: { ...content.rules, workbenchAfter: 1 } };
    noteProgress(state, world);
    expect(state.player.parts).toEqual({});
    state.contracts.completed.push('steal');
    noteProgress(state, world);
    noteProgress(state, world);
    expect(state.player.parts).toEqual({ 'swift:1': 1, 'quiet:1': 1 });
    expect(state.messages.filter((message) => message.subject === 'workbench')).toHaveLength(1);
  });
});

describe('building', () => {
  it('takes the module at the start, runs on the gateway, and installs a new program beside the original', () => {
    const { state, ok, wait } = game({ 'swift:1': 1 });
    ok({ type: 'buildProgram', base: 'breaker', modules: [swift1] });
    expect(state.player.parts).toEqual({});
    expect(state.tasks[0]).toMatchObject({ connectionId: null, target: { kind: 'build' }, durationMs: 10_000 });
    wait(9.9);
    expect(state.player.builds).toEqual([]);
    wait(0.2);
    const id = state.player.builds[0]!.id;
    expect(state.player.builds[0]).toEqual({ id, base: 'breaker', modules: [swift1] });
    expect(state.player.programs).toContain('breaker');
    expect(state.player.programs).toContain(id);
  });

  it('gives the build its modules’ speed and size, and a name that says what is in it', () => {
    const { state, build } = game({ 'swift:1': 1 });
    const id = build('breaker', [swift1]);
    // Breaker: 10s and 4 GB. Swift 1 halves the time and doubles the room. The copier takes 4 GB too.
    expect(programStorageGq(state, content)).toBe(4 + 4 + 8);
    state.player.preferred.breakPassword = id;
    expect(ownedProgram(state, content, 'breakPassword')).toMatchObject({ id, name: 'breaker, Swift 1', baseSeconds: 5, sizeGq: 8 });
  });

  it('is faster on a faster processor', () => {
    const { state, ok } = game({ 'swift:1': 1 }, { tuned: 2 });
    ok({ type: 'buildProgram', base: 'breaker', modules: [swift1] });
    expect(state.tasks[0]!.durationMs).toBe(5_000);
  });

  it('refuses what cannot be built', () => {
    const { state, refused } = game({ 'swift:1': 1, 'quiet:1': 1, 'compact:1': 1 });
    refused({ type: 'buildProgram', base: 'proxy-x', modules: [swift1] }, /installed/);
    refused({ type: 'buildProgram', base: 'tracker', modules: [swift1] }, /takes no modules/);
    refused({ type: 'buildProgram', base: 'breaker', modules: [] }, /Pick a module/);
    refused({ type: 'buildProgram', base: 'breaker', modules: [{ id: 'tidy', grade: 1 }] }, /does nothing for a breaker/);
    refused({ type: 'buildProgram', base: 'breaker', modules: [{ id: 'swift', grade: 2 }] }, /do not have that module/);
    refused({ type: 'buildProgram', base: 'breaker', modules: [swift1, quiet1] }, /takes one module/);
    expect(state.player.parts).toEqual({ 'swift:1': 1, 'quiet:1': 1, 'compact:1': 1 });
  });

  it('builds one thing at a time, and needs room for the result', () => {
    const { state, ok, refused } = game({ 'swift:1': 2 });
    ok({ type: 'buildProgram', base: 'breaker', modules: [swift1] });
    refused({ type: 'buildProgram', base: 'proxy', modules: [swift1] }, /already building/);
    state.tasks = [];
    state.player.files.push({ name: 'big', sizeGq: 1000, from: 'corp' });
    refused({ type: 'buildProgram', base: 'breaker', modules: [swift1] }, /Not enough room/);
  });

  it('gives the modules back if it is stopped', () => {
    const { state, ok } = game({ 'swift:1': 1 });
    ok({ type: 'buildProgram', base: 'breaker', modules: [swift1] });
    ok({ type: 'cancelProgram', taskId: state.tasks[0]!.id });
    expect(state.player.parts).toEqual({ 'swift:1': 1 });
    expect(state.player.builds).toEqual([]);
  });

  it('takes two modules with Second slot, but never two of the same', () => {
    const { state, refused, build } = game({ 'swift:1': 2, 'compact:1': 1 }, { slot: 1 });
    refused({ type: 'buildProgram', base: 'breaker', modules: [swift1, swift1] }, /One Swift module per build/);
    const id = build('breaker', [swift1, { id: 'compact', grade: 1 }]);
    state.player.preferred.breakPassword = id;
    // 4 GB, doubled, then halved.
    expect(ownedProgram(state, content, 'breakPassword')).toMatchObject({ sizeGq: 4, baseSeconds: 5 });
  });

  it('makes smaller programs with Tight builds', () => {
    const { state, build } = game({ 'swift:1': 1 }, { tight: 2 });
    const id = build('breaker', [swift1]);
    state.player.preferred.breakPassword = id;
    // 4 GB x 2 x 0.5.
    expect(ownedProgram(state, content, 'breakPassword')!.sizeGq).toBe(4);
  });
});

describe('using a build', () => {
  it('runs the market program until the player picks the build, then the build', () => {
    const { state, ok, build, enterCorp } = game({ 'swift:1': 1 });
    const id = build('breaker', [swift1]);
    const corp = enterCorp();
    const seconds = () => {
      const check = checkTask(state, content, state.connections[0]!, { kind: 'password', user: 'admin' });
      return check.ok ? check.seconds : NaN;
    };
    expect(seconds()).toBe(10);
    ok({ type: 'preferProgram', programId: id });
    expect(seconds()).toBe(5);
    ok({ type: 'runProgram', connectionId: corp, target: { kind: 'password', user: 'admin' } });
    expect(state.tasks[0]!.programId).toBe(id);
  });

  it('Quiet: starting it does not alert the monitor', () => {
    const plain = game();
    const quiet = game({ 'quiet:1': 1 });
    const id = quiet.build('breaker', [quiet1]);
    quiet.ok({ type: 'preferProgram', programId: id });
    for (const g of [plain, quiet]) {
      const corp = g.enterCorp();
      g.ok({ type: 'runProgram', connectionId: corp, target: { kind: 'password', user: 'admin' } });
    }
    expect(plain.state.connections[0]!.trace.status).toBe('pending');
    expect(quiet.state.connections[0]!.trace.status).toBe('none');
  });

  it('Quiet: a monitor back from blind does not notice it running', () => {
    const { state, ok, build, enterCorp, wait } = game({ 'quiet:1': 1 });
    const id = build('copier', [quiet1]);
    ok({ type: 'preferProgram', programId: id });
    const corp = enterCorp();
    state.player.passwords.corp = ['admin'];
    // Logged in with an account a monitor would not mind, with the monitor blinded by hand.
    state.connections[0]!.monitor.blindMs = 1000;
    state.connections[0]!.user = 'admin';
    state.connections[0]!.role = 'guest';
    state.connections[0]!.bypassed.firewall = true;
    state.servers.corp!.files[0]!.access = 'guest';
    ok({ type: 'runProgram', connectionId: corp, target: { kind: 'copyFile', file: 'secret.dat' } });
    wait(2);
    expect(state.connections[0]!.trace.status).toBe('none');
  });

  it('Tidy: copying leaves no line in the access log', () => {
    const { state, ok, build, enterCorp, wait } = game({ 'tidy:1': 1 });
    const id = build('copier', [{ id: 'tidy', grade: 1 }]);
    ok({ type: 'preferProgram', programId: id });
    const corp = enterCorp();
    state.connections[0]!.user = 'admin';
    state.connections[0]!.role = 'admin';
    state.connections[0]!.bypassed.firewall = true;
    ok({ type: 'runProgram', connectionId: corp, target: { kind: 'copyFile', file: 'secret.dat' } });
    wait(30);
    expect(state.player.files.map((file) => file.name)).toContain('secret.dat');
    expect(state.servers.corp!.logs.some((entry) => entry.text.startsWith('file copied'))).toBe(false);
  });
});

describe('scrapping', () => {
  it('removes the build and gives its modules back', () => {
    const { state, ok, build } = game({ 'swift:1': 1 });
    const id = build('breaker', [swift1]);
    ok({ type: 'preferProgram', programId: id });
    ok({ type: 'scrapProgram', programId: id });
    expect(state.player.programs).not.toContain(id);
    expect(state.player.builds).toEqual([]);
    expect(state.player.preferred).toEqual({});
    expect(partCount(state, 'swift', 1)).toBe(1);
  });

  it('is what removing a build does, and is refused while it runs or for a market program', () => {
    const { state, ok, refused, build, enterCorp } = game({ 'swift:1': 1 });
    const id = build('breaker', [swift1]);
    ok({ type: 'preferProgram', programId: id });
    const corp = enterCorp();
    ok({ type: 'runProgram', connectionId: corp, target: { kind: 'password', user: 'admin' } });
    refused({ type: 'scrapProgram', programId: id }, /running/);
    refused({ type: 'scrapProgram', programId: 'breaker' }, /Only programs you built/);
    state.tasks = [];
    ok({ type: 'uninstallProgram', programId: id });
    expect(partCount(state, 'swift', 1)).toBe(1);
  });
});

describe('refining', () => {
  it('melts two modules into one a grade better, with the skill', () => {
    const { state, ok, refused } = game({ 'swift:1': 3, 'swift:3': 2 });
    refused({ type: 'refineModule', moduleId: 'swift', grade: 1 }, /Refine skill/);
    state.player.skills = { slot: 1, refine: 1 };
    ok({ type: 'refineModule', moduleId: 'swift', grade: 1 });
    expect(state.player.parts).toEqual({ 'swift:1': 1, 'swift:2': 1, 'swift:3': 2 });
    refused({ type: 'refineModule', moduleId: 'swift', grade: 1 }, /takes two/);
    refused({ type: 'refineModule', moduleId: 'swift', grade: 3 }, /as good as it gets/);
  });
});

describe('saves', () => {
  it('keep parts, builds and picked programs', () => {
    const { state, ok, build } = game({ 'swift:1': 1, 'quiet:2': 3 });
    const id = build('breaker', [swift1]);
    ok({ type: 'preferProgram', programId: id });
    const loaded = syncWithContent(deserializeGame(serializeGame(state, '')).state, content);
    expect(loaded.player.parts).toEqual({ 'quiet:2': 3 });
    expect(loaded.player.builds).toEqual(state.player.builds);
    expect(loaded.player.programs).toContain(id);
    expect(loaded.player.preferred).toEqual({ breakPassword: id });
  });

  it('keep a build that is running', () => {
    const { state, ok } = game({ 'swift:1': 1 });
    ok({ type: 'buildProgram', base: 'breaker', modules: [swift1] });
    const loaded = syncWithContent(deserializeGame(serializeGame(state, '')).state, content);
    expect(loaded.tasks[0]!.target).toEqual({ kind: 'build', base: 'breaker', modules: [swift1] });
  });

  it('from before crafting load with nothing crafted', () => {
    const { state } = game();
    const old = JSON.parse(serializeGame(state, '')) as { version: number; state: Record<string, unknown> & { player: Record<string, unknown> } };
    old.version = 11;
    old.state.version = 11;
    delete old.state.player.parts;
    delete old.state.player.builds;
    delete old.state.player.preferred;
    const loaded = deserializeGame(JSON.stringify(old)).state;
    expect(loaded.version).toBe(STATE_VERSION);
    expect(loaded.player).toMatchObject({ parts: {}, builds: [], preferred: {} });
  });

  it('drop a build whose module no longer exists', () => {
    const { state, build } = game({ 'swift:1': 1 });
    const id = build('breaker', [swift1]);
    const world = { ...content, modules: content.modules.filter((module) => module.id !== 'swift') };
    syncWithContent(state, world);
    expect(state.player.builds).toEqual([]);
    expect(state.player.programs).not.toContain(id);
    expect(testPrograms.length).toBeGreaterThan(0);
  });
});
