/**
 * The first hour: Wren's lessons come out one per delivered job, and the
 * inbox sorts itself into Story, Work and Lessons.
 */
import { describe, expect, it } from 'vitest';
import { PROFILES, playCareer } from '../core/career';
import { deserializeGame, kindOf, type Content, type GameState } from '../core';
import { LESSONS } from '../core/record';
import { assets, companies, contracts, data, gameInfo, hardware, mail, models, modules, news, patrons, people, programs, rivals, servers, skills, story, tuning, ladder } from './index';

const content: Content = {
  servers,
  startingServers: gameInfo.startingServers,
  programs,
  startingPrograms: gameInfo.startingPrograms,
  contracts,
  mail,
  people,
  models,
  hardware,
  companies,
  skills,
  modules,
  rivals,
  story,
  news,
  patrons,
  ladder,
  data,
  assets,
  rules: tuning,
};

/** Lessons tied to the moment: they come when a job needs them, whatever else came that job. */
const TIED = new Set(['welcome', 'firstAccept', 'stages', 'routes', 'decompiling', 'news'].map((key) => mail[key as 'stages'].subject));

/** Lessons in the inbox after each delivery, for the first `jobs` jobs of a typical career. */
function lessonsByJob(jobs: number): { after: number[]; final: GameState } {
  const after: number[] = [];
  let final: GameState | undefined;
  playCareer(content, 1, PROFILES.typical, {
    maxContracts: jobs,
    maxMinutes: 120,
    untilRating: 999,
    ratings: gameInfo.ratings,
    startDate: tuning.startDate,
    startingBalance: tuning.startingBalance,
    snapshot: (state) => {
      after.push(state.messages.filter((message) => kindOf(message, content) === 'lesson' && !TIED.has(message.subject)).length);
      final = JSON.parse(JSON.stringify(state)) as GameState;
    },
  });
  return { after, final: final! };
}

describe('the first hour', () => {
  it('brings at most one new lesson per delivered job, besides the ones tied to the moment', () => {
    const { after } = lessonsByJob(12);
    expect(after[0]).toBeLessThanOrEqual(1);
    for (let index = 1; index < after.length; index++) {
      expect(after[index]! - after[index - 1]!, `job ${index + 1}`).toBeLessThanOrEqual(1);
    }
    // Before: 13 letters in the first five jobs. Now at most one queued lesson per job.
    expect(after[4]!).toBeLessThanOrEqual(5);
  });

  it('gets every lesson out in time over a career', () => {
    const { final } = lessonsByJob(40);
    const sent = new Set(final.messages.map((message) => message.subject));
    for (const key of LESSONS) {
      if (!final.flags.includes(key)) continue;
      // A lesson that became due has gone out, or is waiting its turn behind at most a few others.
      expect(sent.has(mail[key].subject) || final.record.lessons.due.includes(key), key).toBe(true);
    }
    expect(final.record.lessons.due.length).toBeLessThanOrEqual(3);
  });

  it('files payment notes as read receipts, so they never count as unread', () => {
    const { final } = lessonsByJob(8);
    const receipts = final.messages.filter((message) => message.subject.startsWith('Paid:'));
    expect(receipts.length).toBeGreaterThan(0);
    expect(receipts.every((message) => message.kind === 'receipt' && message.read)).toBe(true);
  });

  it('sorts the letters of an older save by their subject', () => {
    const { final } = lessonsByJob(4);
    const old = final.messages.map(({ kind: _kind, ...rest }) => rest);
    const kinds = old.map((message) => kindOf(message, content));
    expect(kinds).toEqual(final.messages.map((message) => message.kind));
  });

  it('gives an older save a career record that starts from where it is', () => {
    const { final } = lessonsByJob(4);
    const { record: _record, ...rest } = final;
    const text = JSON.stringify({ format: 'project-null-save', version: 33, summary: { handle: 'T', balance: 0, gameTimeMs: 0, savedAt: '' }, state: { ...rest, version: 33 } });
    const loaded = deserializeGame(text).state;
    expect(loaded.record.stats.jobs).toEqual({ earlier: 4 });
    expect(loaded.record.lessons).toEqual({ due: [], lastJob: 4 });
    expect(loaded.record.last).toBeNull();
  });
});

describe('feats', () => {
  it('has wording for every rule, and about thirty of them', async () => {
    const { feats } = await import('./index');
    expect(feats.length).toBeGreaterThanOrEqual(28);
  });

  it('are earned over a career, the first one with the first job', () => {
    const { final } = lessonsByJob(20);
    expect(final.record.feats).toContain('first-job');
    expect(final.record.feats).toContain('ten-jobs');
  });
});
