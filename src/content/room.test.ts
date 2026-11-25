import { describe, expect, it } from 'vitest';
import { createGame, deserializeGame, postJobs, serializeGame, syncWithContent, worldFor, type Content, type GameState } from '../core';
import { availableContracts, deliverContract, nextContractRating } from '../core/contracts';
import { MIX_RATING, alikeOnBoard, jobSort } from '../core/jobs';
import { REGULAR_MOST, jobsFor, regularOf, regularsOf } from '../core/regulars';
import { MIGRATIONS } from '../core/save';
import { SERIES_GAP_HOURS, seriesDone, seriesLine } from '../core/series';
import { advanceContract, startContract } from '../core/stages';
import type { Job } from '../core/state';
import type { ContractDef } from './schema';
import { parseSeries } from './series';
import { assets, companies, sectorsOf, contracts, events, gameInfo, hardware, ladder, mail, models, modules, news, patrons, people, programs, rivals, series, servers, skills, story, tuning } from './index';

const written: Content = { servers, startingServers: gameInfo.startingServers, programs, startingPrograms: gameInfo.startingPrograms, contracts, mail, people, models, hardware, companies, skills, modules, rivals, story, news, patrons, ladder, events, series, assets, rules: tuning };
const SEED = 31;
const content = worldFor(written, SEED);
const HOUR = 3_600_000;

const newGame = (rating: number, world: Content = content, seed = SEED): GameState => {
  const state = syncWithContent(createGame({ seed, handle: 'Kestrel', startDate: tuning.startDate, startingBalance: tuning.startingBalance }), world);
  state.player.rating = rating;
  postJobs(state, world);
  return state;
};

function wait(state: GameState, hours: number, world: Content = content): void {
  for (let i = 0; i < hours * 4; i++) {
    state.clock.gameTimeMs += HOUR / 4;
    postJobs(state, world);
  }
}

/** Every job the board posts over some days, looked at once an hour. */
function seen(state: GameState, days: number, world: Content = content): Job[] {
  const all = new Map<string, Job>();
  for (let hour = 0; hour < days * 24; hour++) {
    for (const job of state.contracts.jobs) all.set(job.id, job);
    wait(state, 1, world);
  }
  return [...all.values()];
}

const usual = (state: GameState) => state.contracts.jobs.filter((job) => !job.news && !job.heist && !job.legend);
const filled = (text: string) => expect(text).not.toMatch(/\{\w+\}/);

describe('briefs by trade', () => {
  const pools = companies.jobs;

  it('every trade of the second batch has wording of its own, for each plain kind', () => {
    for (const sector of companies.more!.sectors) {
      for (const kind of ['steal', 'destroy', 'record'] as const) {
        expect(pools.trades?.[sector.id]?.[kind]?.briefs?.length ?? 0, `${sector.id} ${kind}`).toBeGreaterThan(0);
      }
    }
  });

  it('every trade has two briefs of its own for each kind it can be asked for, using only what such a job can fill in', () => {
    const can: Record<string, readonly string[]> = { steal: ['company', 'city', 'tier', 'file'], destroy: ['company', 'city', 'tier', 'file'], record: ['company', 'city', 'tier', 'key', 'column', 'value', 'records'] };
    for (const sector of sectorsOf(companies)) {
      for (const kind of ['steal', 'destroy', 'record'] as const) {
        if (kind === 'record' && !sector.records) continue;
        const own = pools.trades?.[sector.id]?.[kind];
        expect(own?.briefs?.length ?? 0, `${sector.id} ${kind}`).toBeGreaterThanOrEqual(2);
        expect(own?.titles?.length ?? 0, `${sector.id} ${kind}`).toBeGreaterThanOrEqual(2);
        for (const line of [...(own?.briefs ?? []), ...(own?.titles ?? [])]) {
          for (const [, name] of line.matchAll(/\{(\w+)\}/g)) expect(can[kind], `${sector.id} ${kind}: {${name}}`).toContain(name);
        }
      }
    }
    for (const kind of ['steal', 'destroy', 'record'] as const) expect(pools[kind].briefs.length, kind).toBeGreaterThanOrEqual(6);
    for (const [kind, wording] of Object.entries(pools.kinds ?? {})) expect(wording!.briefs.length, kind).toBeGreaterThanOrEqual(6);
  });

  it('a job against a company in such a trade is sometimes worded for it, and sometimes not', () => {
    const jobs = seen(newGame(60), 40).filter((job) => !job.stages && !job.patron && !job.regular && ['steal', 'destroy', 'record'].includes(job.objective.kind));
    const own = (job: Job): boolean | undefined => {
      const sector = content.servers.find((server) => server.id === job.targetId)?.generated?.sector;
      const trade = sector === undefined ? undefined : pools.trades?.[sector]?.[job.objective.kind as 'steal'];
      return trade?.titles ? trade.titles.includes(job.title.replace(/^Race: /, '')) : undefined;
    };
    const told = jobs.map(own).filter((value) => value !== undefined);
    expect(told.filter(Boolean).length).toBeGreaterThan(2);
    expect(told.filter((value) => !value).length).toBeGreaterThan(0);
    for (const job of jobs) {
      filled(job.brief);
      filled(job.summary);
    }
  });

  it('the wording changes nothing else: the same companies and goals with it or without', () => {
    const without: Content = { ...content, companies: { ...content.companies, jobs: { ...pools, trades: undefined } } };
    const boards = [content, without].map((world) => {
      const state = newGame(MIX_RATING - 1, world);
      wait(state, 24 * 6, world);
      return state.contracts.jobs.map((job) => [job.targetId, job.objective, job.pay]);
    });
    expect(boards[0]).toEqual(boards[1]);
  });
});

describe('regular clients', () => {
  const regulars = regularsOf(content);
  const lowest = Math.min(...regulars.map((regular) => regular.minRating));

  it('there are eight, each with a name, a voice and a first and a later way of opening', () => {
    expect(regulars.length).toBe(8);
    expect(new Set(regulars.map((regular) => regular.name)).size).toBe(8);
    for (const regular of regulars) {
      expect(regular.intros.length, regular.id).toBeGreaterThanOrEqual(2);
      expect(regular.again.length, regular.id).toBeGreaterThanOrEqual(2);
      // No regular shares a name with a patron or a client the board already uses.
      expect(patrons.some((patron) => patron.name === regular.name)).toBe(false);
      for (const line of [...regular.intros, ...regular.again]) for (const [, name] of line.matchAll(/\{(\w+)\}/g)) expect(['company', 'city', 'times']).toContain(name);
    }
  });

  it('none posts below the rating they start at', () => {
    expect(lowest).toBeGreaterThanOrEqual(10);
    expect(seen(newGame(lowest - 1), 20).some((job) => job.regular)).toBe(false);
  });

  it('they post under their own name, in their own voice, one job each at a time', () => {
    const state = newGame(60);
    const jobs: Job[] = [];
    for (let hour = 0; hour < 24 * 40; hour++) {
      const theirs = state.contracts.jobs.filter((job) => job.regular);
      expect(new Set(theirs.map((job) => job.regular)).size).toBe(theirs.length);
      jobs.push(...theirs.filter((job) => !jobs.some((old) => old.id === job.id)));
      wait(state, 1);
    }
    expect(jobs.length).toBeGreaterThan(3);
    for (const job of jobs) {
      const regular = regularOf(content, job)!;
      expect(job.client).toBe(regular.name);
      expect(job.patron).toBeUndefined();
      expect(job.race).toBeUndefined();
      expect(['guard', 'hunt']).not.toContain(job.objective.kind);
      expect(job.brief.endsWith(regular.signoff)).toBe(true);
      filled(job.brief);
    }
  });

  it('they remember: the next job says so and pays more, up to a limit', () => {
    const state = newGame(60);
    const next = (): Job => {
      for (let hour = 0; hour < 24 * 60; hour++) {
        const job = state.contracts.jobs.find((item) => item.regular && item.objective.kind === 'destroy' && !item.stages && !item.terms);
        if (job) return job;
        wait(state, 1);
      }
      throw new Error('no job from a regular');
    };
    const first = next();
    const regular = regularOf(content, first)!;
    expect(jobsFor(state, regular.id)).toBe(0);
    state.contracts.activeId = first.id;
    startContract(state, content, first);
    const live = state.servers[first.targetId]!;
    const file = (first.objective as { file: string }).file;
    live.files = live.files.filter((item) => item.name !== file);
    advanceContract(state, content, first);
    expect(deliverContract(state, content)).toBeNull();
    expect(jobsFor(state, regular.id)).toBe(1);
    // Many jobs on, the raise has stopped growing.
    state.contracts.regulars[regular.id] = 9;
    state.contracts.jobs = [];
    let later: Job | undefined;
    for (let hour = 0; hour < 24 * 90 && !later; hour++) {
      later = state.contracts.jobs.find((item) => item.regular === regular.id);
      if (!later) wait(state, 1);
    }
    expect(later).toBeDefined();
    const server = content.servers.find((item) => item.id === later!.targetId)!;
    const opening = later!.brief.split('\n\n')[0]!;
    const said = (line: string) => line.replace('{company}', server.name).replace('{city}', server.city).replace('{times}', 'tenth');
    expect(regular.again.map(said)).toContain(opening);
    const most = (tuning.jobPay[server.generated!.tier - 1]! + 200) * 2.6 * (1 + REGULAR_MOST);
    expect(later!.pay).toBeLessThanOrEqual(Math.ceil(most / 50) * 50);
  });

  it('what they remember is kept in a save, and a save from before them loads with nothing remembered', () => {
    const state = newGame(60);
    state.contracts.regulars['marrow'] = 3;
    state.contracts.series['x'] = { done: 1, atMs: 5 };
    const loaded = deserializeGame(serializeGame(state, "2034-01-01T00:00:00Z")).state;
    expect(loaded.contracts.regulars).toEqual({ marrow: 3 });
    expect(loaded.contracts.series).toEqual({ x: { done: 1, atMs: 5 } });
    const old = JSON.parse(JSON.stringify(state)) as { contracts: Record<string, unknown> };
    delete old.contracts['regulars'];
    delete old.contracts['series'];
    const moved = MIGRATIONS[33]!(old as unknown as Record<string, unknown>) as unknown as GameState;
    expect(moved.contracts.regulars).toEqual({});
    expect(moved.contracts.series).toEqual({});
  });
});

describe('side stories', () => {
  const target = content.servers.find((server) => server.generated && server.generated.tier === 2)!;
  const files = target.files.filter((file) => file.access === 'admin' && !file.part && !file.program).map((file) => file.name);
  const part = (n: number, minRating: number): ContractDef => ({
    id: `tale-${n}`,
    title: `Tale ${n}`,
    client: 'Ines Vale',
    targetId: target.id,
    pay: 1000,
    rating: 1,
    minRating,
    summary: 'A part.',
    brief: 'A part.',
    objective: { kind: 'destroy', file: files[n - 1]! },
  });
  const all = [...content.contracts, part(1, 30), part(2, 30), part(3, 32)];
  const tale = parseSeries(
    [
      {
        id: 'tale',
        name: 'The Vale papers',
        client: 'Ines Vale',
        parts: [{ contract: 'tale-1', invite: { subject: 'A start', body: '{handle}, I have work.' } }, { contract: 'tale-2', invite: { subject: 'More', body: 'Again.' } }, { contract: 'tale-3', gapHours: 2 }],
      },
    ],
    all,
  );
  const world: Content = { ...content, contracts: all, series: tale };
  const offered = (state: GameState) => availableContracts(state, world).map((contract) => contract.id).filter((id) => id.startsWith('tale-'));
  const finish = (state: GameState, id: string) => {
    const contract = all.find((item) => item.id === id)!;
    state.contracts.activeId = id;
    startContract(state, world, contract);
    const live = state.servers[target.id]!;
    live.files = live.files.filter((item) => item.name !== (contract.objective as { file: string }).file);
    advanceContract(state, world, contract);
    expect(deliverContract(state, world)).toBeNull();
  };

  it('the written game has eight, about thirty jobs in all, for the middle and the top of a career', () => {
    expect(files.length).toBeGreaterThanOrEqual(3);
    expect(series.length).toBe(8);
    const parts = series.flatMap((story) => story.parts.map((part) => contracts.find((contract) => contract.id === part.contract)!));
    expect(parts.length).toBeGreaterThanOrEqual(28);
    for (const contract of parts) {
      expect(contract.minRating, contract.id).toBeGreaterThanOrEqual(25);
      expect(contract.minRating, contract.id).toBeLessThanOrEqual(95);
      expect(contract.rating, contract.id).toBeGreaterThanOrEqual(1);
      // What a client writes back is sent as written: nothing in it is filled in.
      for (const choice of contract.choices ?? []) expect(choice.reply?.body ?? '', contract.id).not.toMatch(/\{\w+\}/);
    }
    for (const story of series) {
      // One named client all the way through, who writes as each part opens.
      for (const part of story.parts) {
        expect(contracts.find((contract) => contract.id === part.contract)!.client, part.contract).toBe(story.client);
        expect(part.invite, part.contract).toBeDefined();
      }
      expect(story.client.split(' ').length).toBeGreaterThanOrEqual(2);
    }
    // Some end in a choice.
    const last = series.map((story) => contracts.find((contract) => contract.id === story.parts[story.parts.length - 1]!.contract)!);
    expect(last.filter((contract) => (contract.choices?.length ?? 0) > 0).length).toBeGreaterThanOrEqual(4);
    // They are spread over the career, not bunched.
    const starts = series.map((story) => contracts.find((contract) => contract.id === story.parts[0]!.contract)!.minRating).sort((x, y) => x - y);
    for (let i = 1; i < starts.length; i++) expect(starts[i]! - starts[i - 1]!).toBeGreaterThanOrEqual(5);
  });

  it('five written companies were added for them, one in each of five new trades', () => {
    for (const id of ['marisol-grand', 'northlight', 'corran-analytical', 'wensum-council', 'varrick-lowe']) {
      const server = servers.find((item) => item.id === id)!;
      expect(server.kind).toBe('company');
      expect(server.records).toBeDefined();
      expect(series.some((story) => story.parts.some((part) => contracts.find((contract) => contract.id === part.contract)!.targetId === id)), id).toBe(true);
    }
  });

  it('the first part waits for its rating, then comes with a letter from the client', () => {
    const state = newGame(29, world);
    wait(state, 5, world);
    expect(offered(state)).toEqual([]);
    expect(nextContractRating(state, world) ?? 30).toBeLessThanOrEqual(30);
    state.player.rating = 30;
    wait(state, 1, world);
    expect(offered(state)).toEqual(['tale-1']);
    const letter = state.messages.find((mail) => mail.subject === 'A start')!;
    expect(letter.from).toBe('Ines Vale');
    expect(letter.body).toContain('Kestrel');
    expect(seriesLine(world, all.find((item) => item.id === 'tale-1')!)).toBe('Part 1 of 3 · The Vale papers');
    expect(seriesLine(world, content.contracts[0]!)).toBeUndefined();
  });

  it('each part after it comes some hours after the one before is delivered, and not before', () => {
    const state = newGame(40, world);
    wait(state, 1, world);
    expect(offered(state)).toEqual(['tale-1']);
    finish(state, 'tale-1');
    expect(seriesDone(state, 'tale')).toBe(1);
    expect(offered(state)).toEqual([]);
    wait(state, SERIES_GAP_HOURS - 1, world);
    expect(offered(state)).toEqual([]);
    wait(state, 1.25, world);
    expect(offered(state)).toEqual(['tale-2']);
    expect(state.messages.filter((mail) => mail.subject === 'More').length).toBe(1);
    finish(state, 'tale-2');
    wait(state, 2.25, world);
    expect(offered(state)).toEqual(['tale-3']);
    finish(state, 'tale-3');
    wait(state, 30, world);
    expect(seriesDone(state, 'tale')).toBe(3);
    expect(offered(state)).toEqual([]);
    expect(state.messages.filter((mail) => mail.subject === 'A start').length).toBe(1);
  });

  it('a part cannot be asked for a second time, or out of order, in what is written', () => {
    expect(() => parseSeries([{ id: 'a', name: 'A', client: 'B', parts: [{ contract: 'tale-1' }, { contract: 'tale-1' }] }], all)).toThrow(/already part/);
    expect(() => parseSeries([{ id: 'a', name: 'A', client: 'B', parts: [{ contract: 'tale-3' }, { contract: 'tale-1' }] }], all)).toThrow(/lower rating/);
    expect(() => parseSeries([{ id: 'a', name: 'A', client: 'B', parts: [{ contract: 'tale-1' }, { contract: 'nope' }] }], all)).toThrow(/no contract/);
  });
});

describe('a mixed board', () => {
  it('from the rating it starts at, no two of the usual jobs are of one sort or share a title', () => {
    for (const rating of [MIX_RATING, 30, 60, 100]) {
      const state = newGame(rating);
      let alike = 0;
      let looks = 0;
      for (let hour = 0; hour < 24 * 30; hour++) {
        wait(state, 1);
        looks++;
        if (usual(state).some((job) => alikeOnBoard(state, job))) alike++;
      }
      expect(alike / looks, `rating ${rating}`).toBeLessThan(0.02);
      expect(new Set(usual(state).map(jobSort)).size).toBeGreaterThanOrEqual(3);
    }
  });

  it('below that rating the board is drawn as it always was', () => {
    const state = newGame(MIX_RATING - 1);
    wait(state, 24 * 3);
    expect(usual(state).length).toBe(tuning.boardJobs);
  });
});
