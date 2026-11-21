import { describe, expect, it } from 'vitest';
import {
  STATE_VERSION,
  createGame,
  deserializeGame,
  editionDay,
  latestEdition,
  postJobs,
  securityOf,
  serializeGame,
  serverMark,
  syncWithContent,
  worldFor,
  type Content,
  type GameState,
} from '../core';
import type { ContractDef } from './index';
import { reportCaught, reportContract, FIRM_HITS, MAX_NEWS_JOBS } from '../core/news';
import { assets, companies, contracts, gameInfo, hardware, mail, models, people, programs, modules, rivals, servers, skills, story, tuning, news, patrons, ladder } from './index';

const written: Content = { servers, startingServers: gameInfo.startingServers, programs, startingPrograms: gameInfo.startingPrograms, contracts, mail, people, models, hardware, companies, skills, modules, rivals, story, news, patrons, ladder, assets, rules: tuning };
const SEED = 11;
const content = worldFor(written, SEED);

const newGame = (): GameState => {
  const state = syncWithContent(createGame({ seed: SEED, handle: 'Kestrel', startDate: tuning.startDate, startingBalance: tuning.startingBalance }), content);
  postJobs(state, content);
  return state;
};
const company = (tier = 1) => content.servers.find((server) => server.generated?.tier === tier && server.security.password > 0)!;
const job = (targetId: string, kind: 'steal' | 'destroy' = 'destroy'): ContractDef => ({
  id: `test-${targetId}`,
  title: 't',
  client: 'c',
  targetId,
  pay: 100,
  rating: 1,
  minRating: 0,
  summary: 's',
  brief: 'b',
  objective: { kind, file: 'x.dat' },
});
const nextMorning = (state: GameState) => {
  state.clock.gameTimeMs += 24 * 3_600_000;
  postJobs(state, content);
};

describe('the daily news', () => {
  it('prints a first edition with background stories and the weather', () => {
    const state = newGame();
    const edition = latestEdition(state)!;
    expect(edition.day).toBe(editionDay(state.clock.gameTimeMs));
    expect(edition.weather).not.toBe('');
    expect(edition.items.filter((item) => item.kind === 'world').length).toBeGreaterThanOrEqual(1);
    // Every placeholder is filled.
    for (const item of edition.items) expect(item.headline + item.body).not.toMatch(/\{\w+\}/);
  });

  it('prints one edition a morning, however long the wait, and keeps a week', () => {
    const state = newGame();
    postJobs(state, content);
    expect(state.news.editions).toHaveLength(1);
    state.clock.gameTimeMs += 5 * 24 * 3_600_000;
    postJobs(state, content);
    expect(state.news.editions).toHaveLength(2);
    for (let day = 0; day < 10; day++) nextMorning(state);
    expect(state.news.editions).toHaveLength(7);
  });

  it("carries the player's work in the next edition, from the victim's side", () => {
    const state = newGame();
    const target = company();
    reportContract(state, content, job(target.id));
    expect(state.news.pending).toHaveLength(2);
    nextMorning(state);
    const items = latestEdition(state)!.items;
    const mine = items.find((item) => item.kind === 'you')!;
    expect(mine.serverId).toBe(target.id);
    expect(mine.headline + mine.body).toContain(target.name);
    expect(JSON.stringify(state.news)).not.toContain('Kestrel');
    expect(state.news.pending).toHaveLength(0);
  });

  it('leaves story missions out of the paper', () => {
    const state = newGame();
    reportContract(state, content, { ...job(company().id), story: true });
    expect(state.news.pending).toHaveLength(0);
  });

  it('puts a company that was hit on its guard for a few days, then a security firm for good', () => {
    const state = newGame();
    const target = company(2);
    const before = securityOf(state, target);
    reportContract(state, content, job(target.id));
    const guarded = securityOf(state, target);
    const raised = (['password', 'proxy', 'firewall', 'monitor'] as const).filter((layer) => guarded[layer] > before[layer]);
    expect(raised).toHaveLength(1);
    expect(serverMark(state, target.id)).toBe('On guard');

    state.clock.gameTimeMs += 4 * 24 * 3_600_000;
    expect(securityOf(state, target)).toEqual(before);
    expect(serverMark(state, target.id)).toBeUndefined();

    for (let hit = 1; hit < FIRM_HITS; hit++) reportCaught(state, content, target.id);
    expect(state.news.firms).toContain(target.id);
    state.clock.gameTimeMs += 30 * 24 * 3_600_000;
    expect(securityOf(state, target).monitor).toBe(before.monitor + 1);
    expect(serverMark(state, target.id)).toBe('Security firm');
  });

  it('leaves the written companies as they were written', () => {
    const state = newGame();
    const corvane = content.servers.find((server) => server.id === 'corvane-mutual')!;
    reportContract(state, content, job(corvane.id));
    expect(securityOf(state, corvane)).toEqual(corvane.security);
    expect(state.news.pending).toHaveLength(1);
  });

  it('opens short-lived jobs from some stories, never more than a couple at once', () => {
    const state = newGame();
    state.player.rating = 30;
    let opened = 0;
    for (let day = 0; day < 30; day++) {
      nextMorning(state);
      const posted = state.contracts.jobs.filter((item) => item.news);
      expect(posted.length).toBeLessThanOrEqual(MAX_NEWS_JOBS);
      for (const item of latestEdition(state)!.items) {
        if (!item.jobId) continue;
        opened++;
        const opener = state.contracts.jobs.find((entry) => entry.id === item.jobId)!;
        expect(opener.news).toBe(item.headline);
        expect(opener.targetId).toBe(item.serverId);
        expect(opener.expiresMs - state.clock.gameTimeMs).toBeLessThanOrEqual(24 * 3_600_000);
      }
    }
    expect(opened).toBeGreaterThan(0);
    // The usual jobs are still there beside them (a rival may have just taken one; the next minute puts it back).
    postJobs(state, content);
    expect(state.contracts.jobs.filter((item) => !item.news).length).toBeGreaterThanOrEqual(tuning.boardJobs - 1);
  });

  it('echoes a story beat once it has passed', () => {
    const state = newGame();
    expect(story.beats.some((beat) => beat.id === news.story[0]!.after)).toBe(true);
    state.flags.push(`story:${news.story[0]!.after}`);
    nextMorning(state);
    expect(latestEdition(state)!.items.some((item) => item.kind === 'story' && item.headline === news.story[0]!.headline)).toBe(true);
    nextMorning(state);
    expect(latestEdition(state)!.items.some((item) => item.kind === 'story')).toBe(false);
  });

  it('survives a save and load, and old saves start with an empty paper', () => {
    const state = newGame();
    reportContract(state, content, job(company().id));
    const loaded = deserializeGame(serializeGame(state, '2030-01-01T00:00:00Z')).state;
    expect(loaded.news).toEqual(state.news);

    const old = JSON.parse(serializeGame(state, '2030-01-01T00:00:00Z'));
    delete old.state.news;
    old.version = 19;
    old.state.version = 19;
    const migrated = syncWithContent(deserializeGame(JSON.stringify(old)).state, content);
    expect(migrated.version).toBe(STATE_VERSION);
    postJobs(migrated, content);
    expect(migrated.news.editions).toHaveLength(1);
  });
});
