import { describe, expect, it } from 'vitest';
import { applyAction, createGame, deserializeGame, knownPeople, leads, objectiveMet, postJobs, serializeGame, syncWithContent, tick, worldFor, type Connection, type Content, type GameState } from '../core';
import { deliverContract } from '../core/contracts';
import { MIGRATIONS } from '../core/save';
import { runPhish } from '../core/phish';
import { leakOf, nameChoice, termsKept } from '../core/side';
import { ROUND_HOURS, SIDE_RULES, WIPE_HOURS } from '../core/sideJobs';
import { advanceContract, startContract } from '../core/stages';
import type { Job } from '../core/state';
import { assets, companies, contracts, gameInfo, hardware, mail, models, people, programs, modules, rivals, servers, skills, story, tuning, news, patrons, ladder, type ContractDef } from './index';

const written: Content = { servers, startingServers: gameInfo.startingServers, programs, startingPrograms: gameInfo.startingPrograms, contracts, mail, people, models, hardware, companies, skills, modules, rivals, story, news, patrons, ladder, assets, rules: tuning };
const SEED = 31;
const content = worldFor(written, SEED);

const newGame = (rating = 0): GameState => {
  const state = syncWithContent(createGame({ seed: SEED, handle: 'Kestrel', startDate: tuning.startDate, startingBalance: tuning.startingBalance }), content);
  state.player.rating = rating;
  return state;
};

type Kind = 'deliver' | 'leak' | 'wipe' | 'round' | 'borrow';
const kindOf = (job: ContractDef): Kind | undefined =>
  job.round ? 'round' : job.phish ? 'borrow' : job.objective.kind === 'leak' ? 'leak' : job.objective.kind === 'wipe' ? 'wipe' : job.objective.kind === 'plant' ? 'deliver' : undefined;

/** Turns the board over until it has posted a job that fits. */
function boardJob(state: GameState, fits: (job: Job) => boolean): Job {
  for (let round = 0; round < 200; round++) {
    const found = state.contracts.jobs.find(fits);
    if (found) return found;
    state.clock.gameTimeMs += (tuning.jobHours + 1) * 3_600_000;
    postJobs(state, content);
  }
  throw new Error('the board never posted one');
}

/** Takes a job off the board straight to being worked on. */
function take(state: GameState, job: Job): Job {
  state.contracts.activeId = job.id;
  startContract(state, content, job);
  advanceContract(state, content, job);
  return job;
}

let nextConnection = 0;
function logIn(state: GameState, serverId: string, role: 'admin' | 'guest' = 'admin', route: string[] = []): Connection {
  const server = content.servers.find((item) => item.id === serverId)!;
  const connection: Connection = {
    id: `side-c${nextConnection++}`,
    serverId,
    route,
    user: server.accounts.find((account) => account.role === role)?.user ?? 'someone',
    role,
    openedAtMs: state.clock.gameTimeMs,
    bypassed: { proxy: true, firewall: true },
    trace: { status: 'none', graceMs: 0, elapsedMs: 0, hopMs: [600_000] },
    reroutes: 0,
    monitor: { blindMs: 0, used: false, echo: null },
  };
  state.connections.push(connection);
  return connection;
}
const leave = (state: GameState) => (state.connections = []);
const step = (state: GameState, job: ContractDef) => advanceContract(state, content, job);

describe('the side kinds of board job', () => {
  it('leave the board exactly as it was until the first of them opens', () => {
    const without: Content = { ...content, companies: { ...content.companies, jobs: { ...content.companies.jobs, side: undefined } } };
    const boards = [content, without].map((world) => {
      const state = newGame(SIDE_RULES.deliver.rating - 1);
      const seen: string[] = [];
      for (let round = 0; round < 12; round++) {
        state.clock.gameTimeMs += (tuning.jobHours + 1) * 3_600_000;
        postJobs(state, world);
        seen.push(...state.contracts.jobs.map((job) => `${job.title}/${job.targetId}/${job.pay}/${JSON.stringify(job.objective)}`));
      }
      return seen;
    });
    expect(boards[0]).toEqual(boards[1]);
  });

  it('each open at their own rating, with their own wording and nothing left to fill in', () => {
    for (const [kind, rule] of Object.entries(SIDE_RULES) as [Kind, { rating: number }][]) {
      const early = newGame(rule.rating - 1);
      const late = newGame(rule.rating);
      const seen = { early: 0, late: 0 };
      for (let round = 0; round < 80; round++) {
        for (const [state, key] of [[early, 'early'], [late, 'late']] as const) {
          state.clock.gameTimeMs += (tuning.jobHours + 1) * 3_600_000;
          postJobs(state, content);
          for (const job of state.contracts.jobs) {
            if (kindOf(job) === kind) seen[key]++;
            const text = [job.title, job.summary, job.brief, ...(job.stages ?? []).map((stage) => stage.brief ?? ''), ...(job.twists ?? []).map((twist) => (twist.kind === 'drop' ? `${twist.file} ${twist.text}` : '')), JSON.stringify(job.phish ?? {})].join(' ');
            expect(text, job.title).not.toMatch(/\{\w+\}/);
          }
        }
      }
      expect(seen.early, `${kind} before its rating`).toBe(0);
      expect(seen.late, `${kind} at its rating`).toBeGreaterThan(0);
    }
  });

  it('are about a third of the board once all five are open, and never the whole of it', () => {
    const state = newGame(40);
    let side = 0;
    let all = 0;
    for (let round = 0; round < 150; round++) {
      state.clock.gameTimeMs += (tuning.jobHours + 1) * 3_600_000;
      postJobs(state, content);
      for (const job of state.contracts.jobs) {
        all++;
        if (kindOf(job)) side++;
      }
    }
    expect(side / all).toBeGreaterThan(0.2);
    expect(side / all).toBeLessThan(0.45);
  });

  it('deliver: the file arrives with the job, and putting it on their server finishes it', () => {
    const state = newGame(12);
    const job = take(state, boardJob(state, (item) => kindOf(item) === 'deliver'));
    const goal = job.objective as Extract<ContractDef['objective'], { kind: 'plant' }>;
    expect(state.player.files.some((file) => file.name === goal.file)).toBe(true);
    expect(objectiveMet(state, content, job)).toBe(false);
    state.servers[job.targetId]!.files.push({ name: goal.file, sizeGq: goal.sizeGq, access: 'admin' });
    expect(objectiveMet(state, content, job)).toBe(true);
    expect(deliverContract(state, content)).toBeNull();
  });

  it('find the leak: two notes each clear one of three, and only the right name pays in full', () => {
    for (const right of [true, false]) {
      const state = newGame(22);
      const job = take(state, boardJob(state, (item) => kindOf(item) === 'leak'));
      const goal = leakOf(job)!;
      const files = state.servers[job.targetId]!.files;
      expect(goal.files.every((name) => files.some((file) => file.name === name))).toBe(true);
      // Each innocent is named in a note of their own, and the culprit only in the one that names all three.
      const text = (name: string) => files.find((file) => file.name === name)!.text!;
      const namedIn = (who: string) => goal.files.filter((name) => text(name).includes(who)).length;
      for (const suspect of goal.suspects) expect(namedIn(suspect)).toBe(suspect === goal.culprit ? 1 : 2);

      logIn(state, job.targetId);
      expect(deliverContract(state, content, nameChoice(0))).toBe('The job is not done yet.');
      for (const name of goal.files) expect(applyAction(state, { type: 'readFile', serverId: job.targetId, name }, content).ok).toBe(true);
      leave(state);
      expect(objectiveMet(state, content, job)).toBe(true);
      expect(deliverContract(state, content)).toBe('Name one of the three first.');
      const before = state.player.balance;
      const index = goal.suspects.findIndex((name) => (name === goal.culprit) === right);
      expect(deliverContract(state, content, nameChoice(index))).toBeNull();
      expect(state.player.balance - before).toBe(right ? job.pay : job.pay / 2);
      expect(state.messages.filter((mail) => mail.subject.startsWith('Paid')).pop()!.body).toContain(goal.culprit);
      // The notes are tidied away with the job.
      expect(state.servers[job.targetId]!.files.some((file) => goal.files.includes(file.name))).toBe(false);
    }
  });

  it('wipe a trail: their lines are in both logs, and the whole job is on one clock', () => {
    const state = newGame(26);
    const job = take(state, boardJob(state, (item) => kindOf(item) === 'wipe'));
    const who = (job.objective as Extract<ContractDef['objective'], { kind: 'wipe' }>).who;
    const second = job.stages![0]!.targetId;
    const left = (id: string) => state.servers[id]!.logs.filter((entry) => entry.left === who);
    expect(left(job.targetId).length).toBeGreaterThanOrEqual(2);
    expect(left(job.targetId).every((entry) => entry.text.includes(who) && !entry.byPlayer)).toBe(true);
    expect(left(second)).toHaveLength(0);
    // Clearing the first log moves the job on, and the second server's lines are there to find.
    state.servers[job.targetId]!.logs = state.servers[job.targetId]!.logs.filter((entry) => entry.left !== who);
    step(state, job);
    expect(state.contracts.stage).toBe(1);
    expect(left(second).length).toBeGreaterThanOrEqual(2);
    expect(objectiveMet(state, content, job)).toBe(false);
    // Out of time with the second log still dirty: the job is gone.
    state.clock.gameTimeMs += WIPE_HOURS * 3_600_000 + 60_000;
    expect(step(state, job)).toBe(true);
    expect(state.contracts.activeId).toBeNull();
    expect(state.messages[state.messages.length - 1]!.subject).toContain('Too slow');
  });

  it('wipe a trail: done inside the clock, it pays', () => {
    const state = newGame(26);
    const job = take(state, boardJob(state, (item) => kindOf(item) === 'wipe'));
    const who = (job.objective as Extract<ContractDef['objective'], { kind: 'wipe' }>).who;
    for (const id of [job.targetId, job.stages![0]!.targetId]) {
      state.servers[id]!.logs = state.servers[id]!.logs.filter((entry) => entry.left !== who);
      step(state, job);
    }
    expect(objectiveMet(state, content, job)).toBe(true);
    // Finished is finished: the clock running out afterwards does not take it back.
    state.clock.gameTimeMs += WIPE_HOURS * 3_600_000 + 60_000;
    expect(step(state, job)).toBe(false);
    expect(deliverContract(state, content)).toBeNull();
  });

  it('the round: three small companies, paid stop by stop, and what is not done in time is not paid', () => {
    const finish = (state: GameState, job: Job, index: number) => {
      const stage = index === 0 ? job : job.stages![index - 1]!;
      const goal = stage.objective;
      if (goal.kind === 'destroy') state.servers[stage.targetId]!.files = state.servers[stage.targetId]!.files.filter((file) => file.name !== goal.file);
      else if (goal.kind === 'steal') state.player.files.push({ name: goal.file, sizeGq: 1, from: stage.targetId });
      else throw new Error(`a round stop of kind ${goal.kind}`);
      step(state, job);
    };
    const state = newGame(32);
    const job = take(state, boardJob(state, (item) => kindOf(item) === 'round'));
    const each = job.round!.each;
    const targets = [job.targetId, ...job.stages!.map((stage) => stage.targetId)];
    expect(new Set(targets).size).toBe(3);
    for (const id of targets) expect(content.servers.find((server) => server.id === id)!.generated!.tier).toBeLessThanOrEqual(3);
    const start = state.player.balance;
    finish(state, job, 0);
    expect(state.player.balance - start).toBe(each);
    finish(state, job, 1);
    expect(state.player.balance - start).toBe(2 * each);
    // The third is never done: time runs out, and the two that were paid stay paid.
    state.clock.gameTimeMs += ROUND_HOURS * 3_600_000 + 60_000;
    expect(step(state, job)).toBe(true);
    expect(state.player.balance - start).toBe(2 * each);

    const again = newGame(32);
    const whole = take(again, boardJob(again, (item) => kindOf(item) === 'round'));
    const before = again.player.balance;
    for (let index = 0; index < 3; index++) finish(again, whole, index);
    expect(deliverContract(again, content)).toBeNull();
    expect(again.player.balance - before).toBe(2 * whole.round!.each + whole.pay);
    expect(whole.pay).toBeGreaterThan(whole.round!.each);
  });

  it('borrowed login: the notices name who to write to and as whom, and the reply is the password', () => {
    const state = newGame(36);
    const job = take(state, boardJob(state, (item) => kindOf(item) === 'borrow'));
    const server = content.servers.find((item) => item.id === job.targetId)!;
    const ask = job.phish!.asks[0]!;
    // Nobody to write to until the notices are read; a guest can read them.
    expect(leads(state, content).open.some((item) => item.id === ask.id)).toBe(false);
    logIn(state, server.id, 'guest');
    for (const twist of job.twists ?? []) if (twist.kind === 'drop') expect(applyAction(state, { type: 'readFile', serverId: server.id, name: twist.file }, content).ok).toBe(true);
    leave(state);
    expect(knownPeople(state, content).filter((person) => person.id.startsWith(job.id))).toHaveLength(3);
    expect(leads(state, content).open.some((item) => item.id === ask.id)).toBe(true);
    // The wrong colleague gets nowhere; the right one, with both details, gets the login.
    const admin = server.accounts.find((account) => account.role === 'admin')!.user;
    expect(applyAction(state, { type: 'sendPhish', askId: ask.id, senderId: ask.senderId, factIds: [...ask.needs] }, content).ok).toBe(true);
    state.clock.gameTimeMs += (tuning.phishReplyMinutes + 1) * 60_000;
    runPhish(state, content);
    expect(state.player.passwords[server.id]).toContain(admin);
    expect(state.messages[state.messages.length - 1]!.body).toContain(server.name);
  });

  it('borrowed login: the password is up while the job is open', () => {
    const state = newGame(36);
    const posted = boardJob(state, (item) => kindOf(item) === 'borrow');
    const server = content.servers.find((item) => item.id === posted.targetId)!;
    expect(posted.twists).toContainEqual({ kind: 'raise', layer: 'password', by: 2 });
    expect(server.security.password).toBeGreaterThan(0);
  });
});

describe('optional terms', () => {
  const termed = (state: GameState, kind: 'quiet' | 'fast' | 'light') => take(state, boardJob(state, (item) => item.terms?.kind === kind && item.objective.kind === 'destroy'));
  const finish = (state: GameState, job: Job) => {
    const goal = job.objective as Extract<ContractDef['objective'], { kind: 'destroy' }>;
    state.servers[job.targetId]!.files = state.servers[job.targetId]!.files.filter((file) => file.name !== goal.file);
  };

  it('are only on ordinary one-step jobs, from rating 10', () => {
    const early = newGame(9);
    const late = newGame(40);
    let seen = 0;
    for (let round = 0; round < 60; round++) {
      for (const state of [early, late]) {
        state.clock.gameTimeMs += (tuning.jobHours + 1) * 3_600_000;
        postJobs(state, content);
      }
      expect(early.contracts.jobs.some((job) => job.terms)).toBe(false);
      for (const job of late.contracts.jobs.filter((item) => item.terms)) {
        seen++;
        expect(job.stages ?? []).toHaveLength(0);
        expect(job.race).toBeUndefined();
        expect(['steal', 'destroy', 'record', 'plant']).toContain(job.objective.kind);
        expect(job.terms!.bonus).toBeGreaterThanOrEqual(100);
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('quietly: kept, the bonus is paid on top; a trace under way loses it and nothing else', () => {
    const kept = newGame(20);
    const job = termed(kept, 'quiet');
    // Noticed is not traced: the grace before a trace starts does not count against it.
    Object.assign(logIn(kept, job.targetId).trace, { status: 'pending', graceMs: 60_000 });
    tick(kept, 1000, content);
    expect(termsKept(kept, job)).toBe(true);
    leave(kept);
    finish(kept, job);
    const before = kept.player.balance;
    expect(deliverContract(kept, content)).toBeNull();
    expect(kept.player.balance - before).toBe(job.pay + job.terms!.bonus);
    expect(kept.messages.filter((mail) => mail.subject.startsWith('Paid')).pop()!.body).toContain('bonus');

    const broken = newGame(20);
    const loud = termed(broken, 'quiet');
    logIn(broken, loud.targetId).trace.status = 'active';
    tick(broken, 1000, content);
    expect(termsKept(broken, loud)).toBe(false);
    leave(broken);
    finish(broken, loud);
    const was = broken.player.balance;
    expect(deliverContract(broken, content)).toBeNull();
    expect(broken.player.balance - was).toBe(loud.pay);
  });

  it('quickly: judged when the job is handed in', () => {
    const state = newGame(20);
    const job = termed(state, 'fast');
    const minutes = (job.terms as { minutes: number }).minutes;
    state.clock.gameTimeMs += (minutes - 1) * 60_000;
    expect(termsKept(state, job)).toBe(true);
    state.clock.gameTimeMs += 2 * 60_000;
    expect(termsKept(state, job)).toBe(false);
  });

  it('short route: a long way round to the job breaks it, a long way round to anywhere else does not', () => {
    const state = newGame(20);
    const job = termed(state, 'light');
    const elsewhere = content.servers.find((server) => server.generated && server.id !== job.targetId)!;
    logIn(state, elsewhere.id, 'guest', ['a', 'b', 'c', 'd', 'e']);
    tick(state, 1000, content);
    expect(termsKept(state, job)).toBe(true);
    leave(state);
    logIn(state, job.targetId, 'guest', ['a', 'b', 'c', 'd', 'e']);
    tick(state, 1000, content);
    expect(termsKept(state, job)).toBe(false);
  });
});

describe('saves', () => {
  it('a side job under way survives saving and loading', () => {
    const state = newGame(32);
    const job = take(state, boardJob(state, (item) => kindOf(item) === 'round'));
    const loaded = deserializeGame(serializeGame(state, '2026-01-01T00:00:00Z')).state;
    expect(loaded.contracts.windowUntilMs).toBe(state.contracts.windowUntilMs);
    expect(loaded.contracts.jobs.find((item) => item.id === job.id)).toEqual(job);
  });

  it('a save from before them loads with no clock and no terms', () => {
    const state = newGame(5);
    const old = JSON.parse(JSON.stringify(state)) as Record<string, unknown>;
    const contractsBefore = old['contracts'] as Record<string, unknown>;
    delete contractsBefore['takenMs'];
    delete contractsBefore['windowUntilMs'];
    delete contractsBefore['termsBroken'];
    const moved = MIGRATIONS[31]!(old)['contracts'] as Record<string, unknown>;
    expect(moved).toMatchObject({ takenMs: 0, windowUntilMs: 0, termsBroken: false });
  });
});
