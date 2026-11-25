/**
 * The difficulty modes and the fixer's loan, played through by the
 * scripted players from the balance tests (see career.test.ts).
 */
import { describe, expect, it } from 'vitest';
import { PROFILES, playCareer, type CareerOptions, type CareerReport } from '../core/career';
import type { Content, Difficulty, LoanState } from '../core';
import { assets, companies, contracts as allContracts, gameInfo, hardware, mail, models, people, programs, modules, rivals, servers, skills, story as fullStory, tuning, news, patrons, ladder, data, linesOf, series, storyOf } from './index';

const LATE = /^(act[34]|after)-/;
const SIDE = new Set(series.flatMap((story) => story.parts.map((part) => part.contract)));
const contracts = allContracts.filter((contract) => !LATE.test(contract.id) && !SIDE.has(contract.id));
const act12 = linesOf(fullStory).find((line) => line.id === 'main')!.beats.filter((beat) => !/^(a3|a4|end)-/.test(beat.id));
const content: Content = { servers, startingServers: gameInfo.startingServers, programs, startingPrograms: gameInfo.startingPrograms, contracts, mail, people, models, hardware, companies, skills, modules, rivals, story: storyOf([{ id: 'main', beats: act12 }]), news, patrons, ladder, data, assets, rules: tuning };
const top = gameInfo.ratings[gameInfo.ratings.length - 1]!;
const options: CareerOptions = { maxContracts: 150, maxMinutes: 400, untilRating: top.min, ratings: gameInfo.ratings, startDate: tuning.startDate, startingBalance: tuning.startingBalance };

/** The middle of the least time a trace had left, over the jobs of a career that were traced at all. */
function usualSpare(report: CareerReport): number {
  const spare = report.jobs.map((job) => job.closest).filter((closest): closest is number => closest !== null).sort((a, b) => a - b);
  return spare[Math.floor(spare.length / 2)] ?? 0;
}

describe('difficulty modes over a whole career', () => {
  const career = (difficulty: Difficulty) => playCareer(content, 7, PROFILES.typical, { ...options, difficulty });
  const story = career('story');
  const standard = career('standard');
  const hard = career('hard');

  it('all reach the top with the same player', () => {
    for (const report of [story, standard, hard]) {
      expect(report.finalRating).toBeGreaterThanOrEqual(top.min);
      expect(report.stuck).toEqual([]);
    }
  });

  it('give more time in hand on Story and less on Hard', () => {
    expect(usualSpare(story)).toBeGreaterThan(usualSpare(standard) * 1.25);
    expect(usualSpare(hard)).toBeLessThan(usualSpare(standard) * 0.85);
  });

  it('make Hard a slower climb: hot relays have to be waited out or routed around', () => {
    expect(hard.minutes).toBeGreaterThan(standard.minutes);
  });
});

describe("the fixer's loan over a careless career", () => {
  it('is given, paid back out of later jobs, and never twice at one title', () => {
    let loan: LoanState | undefined;
    playCareer(content, 7, PROFILES.careless, {
      ...options,
      maxContracts: 40,
      snapshot: (state) => {
        loan = { owed: state.loan.owed, given: [...state.loan.given], marks: [...state.loan.marks] };
      },
    });
    expect(loan).toBeDefined();
    expect(loan!.given.length).toBeGreaterThan(0);
    expect(new Set(loan!.given).size).toBe(loan!.given.length);
    expect(loan!.owed).toBe(0);
  });
});
