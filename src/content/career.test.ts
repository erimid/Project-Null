/**
 * The balance tests: a scripted player plays the real game from a new
 * save, and the climb has to hold together. If a price, a timing or a
 * rating changes and one of these fails, the change has broken the
 * career somewhere: read the report to see where.
 *
 * To read the full reports: CAREER_REPORT=1 npx vitest run src/content/career.test.ts --disable-console-intercept
 */
import { describe, expect, it } from 'vitest';
import { PROFILES, formatCareer, playCareer, type CareerOptions, type CareerReport, type Profile } from '../core/career';
import type { Content } from '../core';
import { companies, contracts, gameInfo, hardware, mail, models, people, programs, modules, servers, skills, tuning } from './index';

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
  rules: tuning,
};

const top = gameInfo.ratings[gameInfo.ratings.length - 1]!;
const options: CareerOptions = {
  maxContracts: 150,
  maxMinutes: 400,
  untilRating: top.min,
  ratings: gameInfo.ratings,
  startDate: tuning.startDate,
  startingBalance: tuning.startingBalance,
};

// core/ and content/ are checked without Node's or the browser's types, so reach the terminal by hand.
const host = globalThis as { process?: { env: Record<string, string | undefined> }; console?: { log(text: string): void } };
const wanted = Boolean(host.process?.env.CAREER_REPORT);

const cache = new Map<string, CareerReport>();
function career(profile: Profile, seed: number): CareerReport {
  const key = `${profile.name}/${seed}`;
  let report = cache.get(key);
  if (!report) {
    report = playCareer(content, seed, profile, options);
    cache.set(key, report);
    if (wanted) host.console?.log(`${formatCareer(report)}\n`);
  }
  return report;
}

/** Someone who is slow with the mouse but does everything Wren says. */
const SLOW: Profile = { ...PROFILES.typical, name: 'slow', thinkSeconds: 8, hops: 8, bestRelays: true };
/** Someone who buys only what a job cannot be done without. */
const FRUGAL: Profile = { ...PROFILES.typical, name: 'frugal', thinkSeconds: 5, hops: 8, upgrades: false };

/** Someone who never opens the Skills window or the Workbench: the game as it was before them. */
const PLAIN: Profile = { ...PROFILES.typical, name: 'plain', skills: [], craft: false };

const SEEDS = [1, 7, 2034];
// The shelf: every program, every part of hardware, and every grade of every module the market sells.
const everything =
  [...programs, ...hardware].reduce((sum, item) => sum + item.price, 0) +
  modules.reduce((sum, module) => sum + module.grades.reduce((inner, grade) => inner + grade.price, 0), 0);

describe('a whole career', () => {
  it.each(SEEDS)('a careful player reaches the top title with every written contract done, never traced (seed %i)', (seed) => {
    const report = career(PROFILES.careful, seed);
    expect(report.stuck).toEqual([]);
    expect(report.written).toBe(contracts.length);
    expect(report.finalRating).toBeGreaterThanOrEqual(top.min);
    expect(report.caught).toBe(0);
    expect(report.fines).toBe(0);
  });

  it.each(SEEDS)('an ordinary player gets there too (seed %i)', (seed) => {
    const report = career(PROFILES.typical, seed);
    expect(report.stuck).toEqual([]);
    expect(report.written).toBe(contracts.length);
    expect(report.finalRating).toBeGreaterThanOrEqual(top.min);
  });

  it('so does a slow one, and one who buys only what the jobs demand', () => {
    for (const profile of [SLOW, FRUGAL]) {
      const report = career(profile, 1);
      expect(report.stuck, profile.name).toEqual([]);
      expect(report.written, profile.name).toBe(contracts.length);
    }
  });

  it.each(SEEDS)('the climb needs the standing jobs, about one for every two or three written contracts (seed %i)', (seed) => {
    const report = career(PROFILES.typical, seed);
    const standing = report.jobs.filter((job) => job.job).length;
    expect(standing).toBeGreaterThanOrEqual(8);
    expect(standing).toBeLessThanOrEqual(16);
    // No stretch of more than three standing jobs between two written contracts.
    let run = 0;
    for (const job of report.jobs.slice(0, report.jobs.findLastIndex((item) => !item.job))) {
      run = job.job ? run + 1 : 0;
      expect(run).toBeLessThanOrEqual(3);
    }
  });

  it.each(SEEDS)('every title is reached later than the one before it (seed %i)', (seed) => {
    const report = career(PROFILES.typical, seed);
    expect(report.titles.map((line) => line.title)).toEqual(gameInfo.ratings.map((rung) => rung.title));
    report.titles.slice(2).forEach((line, index) => {
      // Each title takes at least two deliveries: none is skipped over.
      expect(line.contracts - report.titles[index + 1]!.contracts, line.title).toBeGreaterThanOrEqual(2);
    });
  });

  it.each(SEEDS)('skills and the Workbench are not needed, and worth having (seed %i)', (seed) => {
    // Someone who never opens either window still gets every contract done.
    const plain = career(PLAIN, seed);
    expect(plain.stuck).toEqual([]);
    expect(plain.written).toBe(contracts.length);
    expect(plain.finalRating).toBeGreaterThanOrEqual(top.min);
    // Someone who does spends nearly every point and fits what the work turns up...
    const report = career(PROFILES.typical, seed);
    expect(report.learned.length).toBeGreaterThanOrEqual(12);
    expect(report.found).toBeGreaterThanOrEqual(4);
    expect(report.built.length).toBeGreaterThanOrEqual(8);
    // ...and for it sets off fewer traces, with more time in hand when one runs, at no cost in pace.
    const traced = (jobs: typeof report.jobs) => jobs.flatMap((job) => (job.closest === null ? [] : [job.closest]));
    const spare = (jobs: typeof report.jobs) => traced(jobs).sort((a, b) => a - b)[Math.floor(traced(jobs).length / 2)]!;
    expect(traced(report.jobs).length).toBeLessThanOrEqual(traced(plain.jobs).length - 3);
    // The single tightest escape is a matter of a second or two either way now that traces are short, so it is not compared.
    expect(spare(report.jobs)).toBeGreaterThan(spare(plain.jobs));
    expect(report.minutes).toBeLessThan(plain.minutes * 1.05);
  });

  it('the work pays better the higher the title', () => {
    const report = career(PROFILES.typical, 1);
    const third = Math.floor(report.jobs.length / 3);
    const rate = (jobs: typeof report.jobs) => jobs.reduce((sum, job) => sum + job.pay, 0) / jobs.reduce((sum, job) => sum + job.seconds, 0);
    expect(rate(report.jobs.slice(-third))).toBeGreaterThan(2 * rate(report.jobs.slice(0, third)));
  });

  it('there is always something left to save up for', () => {
    const report = career(PROFILES.typical, 1);
    // By the top title the career has paid for most of the shelf, not all of it.
    expect(report.earned).toBeGreaterThan(everything * 0.6);
    expect(report.earned).toBeLessThan(everything);
    expect(report.kitCompleteMinutes).toBeNull();
    expect(report.bought.length).toBeGreaterThanOrEqual(12);
  });

  it('two relays and no cleaning up is paid for in fines and traces', () => {
    const report = career(PROFILES.careless, 1);
    const tidy = career(PROFILES.typical, 1);
    expect(report.fines).toBeGreaterThan(5000);
    expect(report.caught + report.stuck.length).toBeGreaterThan(0);
    expect(report.titles.at(-1)!.atMinutes).toBeGreaterThan(tidy.titles.at(-1)!.atMinutes);
  });
});
