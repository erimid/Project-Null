import { describe, expect, it } from 'vitest';
import { applyAction, createGame, deserializeGame, objectiveMet, postJobs, serializeGame, syncWithContent, worldFor, type Connection, type Content, type GameState } from '../core';
import { startContract } from '../core/stages';
import { GUARD_BREACH_SHARE, advanceKinds, foundFlag, guardRingAngle, raceProgress } from '../core/kinds';
import { advanceContract } from '../core/stages';
import { companies, contracts, gameInfo, hardware, mail, models, people, programs, modules, rivals, servers, skills, story, tuning, news, patrons, ladder, type ContractDef } from './index';

const written: Content = { servers, startingServers: gameInfo.startingServers, programs, startingPrograms: gameInfo.startingPrograms, contracts, mail, people, models, hardware, companies, skills, modules, rivals, story, news, patrons, ladder, rules: tuning };
const SEED = 31;
const content = worldFor(written, SEED);

const newGame = (): GameState => syncWithContent(createGame({ seed: SEED, handle: 'Kestrel', startDate: tuning.startDate, startingBalance: tuning.startingBalance }), content);
const company = (tier: number) => content.servers.find((server) => server.generated?.tier === tier && server.accounts.some((account) => account.role === 'admin'))!;

/** Takes a made-up job straight to being worked on. */
function take(state: GameState, job: ContractDef): ContractDef & { expiresMs: number } {
  const posted = { ...job, expiresMs: state.clock.gameTimeMs + 24 * 3_600_000 };
  state.contracts.jobs.push(posted);
  state.contracts.activeId = posted.id;
  startContract(state, content, posted);
  return posted;
}
const job = (targetId: string, objective: ContractDef['objective'], extra: Partial<ContractDef> = {}): ContractDef => ({
  id: `job-${targetId}-${objective.kind}`,
  title: 'A job',
  client: 'A client',
  targetId,
  pay: 1000,
  rating: 1,
  minRating: 0,
  summary: 's',
  brief: 'b',
  objective,
  ...extra,
});
let nextConnection = 0;
function logIn(state: GameState, serverId: string, role: 'admin' | 'guest' = 'admin'): Connection {
  const server = content.servers.find((item) => item.id === serverId)!;
  const connection: Connection = {
    id: `c${nextConnection++}`,
    serverId,
    route: [],
    user: server.accounts.find((account) => account.role === role)?.user ?? 'someone',
    role,
    openedAtMs: state.clock.gameTimeMs,
    bypassed: { proxy: false, firewall: false },
    trace: { status: 'none', graceMs: 0, elapsedMs: 0, hopMs: [600_000] },
    reroutes: 0,
    monitor: { blindMs: 0, used: false, echo: null },
  };
  state.connections.push(connection);
  return connection;
}

describe('the newer kinds of job', () => {
  it('show up on the board once the rating reaches their tiers, each with its own wording', () => {
    const state = newGame();
    state.player.rating = 30;
    const kinds = new Set<string>();
    let races = 0;
    for (let round = 0; round < 40; round++) {
      state.clock.gameTimeMs += (tuning.jobHours + 1) * 3_600_000;
      postJobs(state, content);
      for (const item of state.contracts.jobs) {
        kinds.add(item.objective.kind);
        if (item.race) races++;
        expect(item.brief + item.summary + item.title).not.toMatch(/\{\w+\}/);
      }
    }
    for (const kind of ['frame', 'guard', 'hold', 'hunt', 'swap']) expect(kinds, kind).toContain(kind);
    expect(races).toBeGreaterThan(0);
  });

  it('stay in: counts only while logged in, and starts again after leaving', () => {
    const state = newGame();
    const target = company(2);
    const posted = take(state, job(target.id, { kind: 'hold', seconds: 40 }));
    advanceKinds(state, content, 10_000);
    expect(state.contracts.heldMs).toBe(0);
    const connection = logIn(state, target.id, 'guest');
    advanceKinds(state, content, 20_000);
    expect(state.contracts.heldMs).toBe(20_000);
    // Sitting there sets the trace going.
    expect(connection.trace.status).not.toBe('none');
    state.connections = [];
    advanceKinds(state, content, 1000);
    expect(state.contracts.heldMs).toBe(0);
    logIn(state, target.id, 'guest');
    advanceKinds(state, content, 41_000);
    expect(objectiveMet(state, content, posted)).toBe(true);
    // Once reached, leaving does not undo it.
    state.connections = [];
    advanceKinds(state, content, 1000);
    expect(objectiveMet(state, content, posted)).toBe(true);
  });

  it('guard: an intruder left alone gets in first; shutting ports holds them off', () => {
    const lose = newGame();
    const target = company(3);
    take(lose, job(target.id, { kind: 'guard', seconds: 60, rival: 'Halftone' }));
    // The client hands over their administrator's login.
    expect(lose.player.passwords[target.id]).toContain(target.accounts.find((account) => account.role === 'admin')!.user);
    logIn(lose, target.id);
    let lost = false;
    for (let second = 0; second < 60 && !lost; second++) lost = advanceKinds(lose, content, 1000);
    expect(lost).toBe(true);
    expect(lose.contracts.activeId).toBeNull();
    expect(Math.round(60 * GUARD_BREACH_SHARE)).toBeLessThan(60);

    const win = newGame();
    const posted = take(win, job(target.id, { kind: 'guard', seconds: 60, rival: 'Halftone' }));
    const connection = logIn(win, target.id);
    advanceKinds(win, content, 1000);
    for (let second = 1; second < 60; second++) {
      // Whenever no port is open, open one and lock each ring as it comes round.
      if (!win.contracts.guard!.port) expect(applyAction(win, { type: 'guardPort' }, content)).toEqual({ ok: true });
      const port = win.contracts.guard!.port!;
      for (let step = 0; step < 400 && win.contracts.guard?.port === port; step++) {
        const ring = port.locked.findIndex((locked) => !locked);
        const angle = guardRingAngle(port, ring);
        if (Math.min(angle, 360 - angle) < 2) applyAction(win, { type: 'guardRing', ring }, content);
        else port.ageMs += 5;
      }
      expect(advanceKinds(win, content, 1000)).toBe(false);
    }
    expect(connection.role).toBe('admin');
    expect(objectiveMet(win, content, posted)).toBe(true);
    expect(win.contracts.guard!.shut).toBeGreaterThan(0);
  });

  it('find the hacker: each log points on, and connecting to the last server finds them', () => {
    const state = newGame();
    const target = company(3);
    const others = content.servers.filter((server) => server.generated && server.id !== target.id).slice(0, 2).map((server) => server.id);
    const posted = take(state, job(target.id, { kind: 'hunt', trail: others }));
    const chain = [target.id, ...others];
    for (let i = 0; i < chain.length - 1; i++) {
      const connection = logIn(state, chain[i]!);
      const line = state.servers[chain[i]!]!.logs.find((entry) => entry.points === chain[i + 1])!;
      expect(line).toBeDefined();
      expect(applyAction(state, { type: 'followTrail', connectionId: connection.id, logId: line.id }, content)).toEqual({ ok: true });
      expect(state.knownServers).toContain(chain[i + 1]);
    }
    expect(objectiveMet(state, content, posted)).toBe(false);
    state.connections = [];
    expect(applyAction(state, { type: 'connect', serverId: others[1]! }, content)).toEqual({ ok: true });
    expect(state.flags).toContain(foundFlag(others[1]!));
    expect(objectiveMet(state, content, posted)).toBe(true);
  });

  it('swap: the client sends a doctored copy, which must replace the real file', () => {
    const state = newGame();
    const target = company(1);
    const file = state.servers[target.id]!.files[0]!;
    const posted = take(state, job(target.id, { kind: 'swap', file: file.name }));
    const copy = state.player.files.find((item) => item.name === file.name && item.doctored)!;
    expect(copy).toBeDefined();
    expect(objectiveMet(state, content, posted)).toBe(false);
    // Doing it by hand: the real one goes, the copy goes up in its place.
    state.servers[target.id]!.files = state.servers[target.id]!.files.filter((item) => item.name !== file.name);
    state.servers[target.id]!.files.push({ ...file, doctored: true });
    expect(objectiveMet(state, content, posted)).toBe(true);
  });

  it('race: the rival finishing first closes the job', () => {
    const state = newGame();
    const target = company(2);
    const posted = take(state, job(target.id, { kind: 'destroy', file: 'x.dat' }, { race: { rival: 'Sable', minutes: 120 } }));
    expect(raceProgress(state, posted)!.share).toBe(0);
    state.clock.gameTimeMs += 60 * 60_000;
    expect(raceProgress(state, posted)!.share).toBeCloseTo(0.5);
    expect(advanceContract(state, content, posted)).toBe(false);
    state.clock.gameTimeMs += 61 * 60_000;
    advanceContract(state, content, posted);
    expect(state.contracts.activeId).toBeNull();
    expect(state.messages.at(-1)!.body).toContain('Sable got there first');
  });

  it('keep their progress through a save', () => {
    const state = newGame();
    const target = company(2);
    take(state, job(target.id, { kind: 'hold', seconds: 40 }));
    logIn(state, target.id, 'guest');
    advanceKinds(state, content, 12_000);
    const loaded = deserializeGame(serializeGame(state, '2034-03-14T09:00:00Z'));
    expect(loaded.state.contracts.heldMs).toBe(12_000);
  });
});
