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
import { assets, companies, contracts as allContracts, gameInfo, hardware, mail, models, people, programs, modules, rivals, servers, skills, story as fullStory, tuning, news, patrons, ladder, data, linesOf, storyOf } from './index';

// The scripted player plays Acts 1 and 2. Act 3 onward is checked by its own tests (see story3.test.ts): it
// needs jobs the player bot does not do (stay in, find the hacker, swap, guard, heists) and the choice of a side.
const LATE = /^(act[34]|after)-/;
const contracts = allContracts.filter((contract) => !LATE.test(contract.id));
const act12 = linesOf(fullStory).find((line) => line.id === 'main')!.beats.filter((beat) => !/^(a3|a4|end)-/.test(beat.id));
const story = storyOf([{ id: 'main', beats: act12 }]);

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

const top = gameInfo.ratings[gameInfo.ratings.length - 1]!;
// Every written contract, the story's missions among them: the scripted player takes those as they come up.
const written = contracts.length;
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
const median = (values: readonly number[]): number => [...values].sort((x, y) => x - y)[Math.floor(values.length / 2)]!;
/** The jobs of a career once the opening is behind it: from the Ghost title up. */
const settled = (report: CareerReport) => report.jobs.filter((job) => job.ratingAfter > gameInfo.ratings[4]!.min);

describe('a whole career', () => {
  it.each(SEEDS)('a careful player reaches the top title with every written contract done, never traced (seed %i)', (seed) => {
    const report = career(PROFILES.careful, seed);
    expect(report.stuck).toEqual([]);
    expect(report.written).toBe(written);
    expect(report.finalRating).toBeGreaterThanOrEqual(top.min);
    expect(report.caught).toBe(0);
    expect(report.fines).toBe(0);
  });

  it.each(SEEDS)('an ordinary player gets there too (seed %i)', (seed) => {
    const report = career(PROFILES.typical, seed);
    expect(report.stuck).toEqual([]);
    expect(report.written).toBe(written);
    expect(report.finalRating).toBeGreaterThanOrEqual(top.min);
  });

  it('so does a slow one, and one who buys only what the jobs demand', () => {
    for (const profile of [SLOW, FRUGAL]) {
      const report = career(profile, 1);
      // A standing job the player cannot do with what it owns is given up and the career goes on (a frugal one
      // can meet a company that raised a lock after its first visit); a written contract never is.
      const writtenTitles = new Set(contracts.map((contract) => contract.title));
      expect(report.stuck.filter((line) => writtenTitles.has(/^"(.*?)": /.exec(line)?.[1] ?? '')), profile.name).toEqual([]);
      expect(report.written, profile.name).toBe(written);
    }
  });

  it.each(SEEDS)('the climb needs a few standing jobs between the written contracts (seed %i)', (seed) => {
    const report = career(PROFILES.typical, seed);
    const standing = report.jobs.filter((job) => job.job).length;
    // The written contracts carry the first half of the climb. Through the long upper titles the standing jobs
    // do about half the work: two or three between one written contract and the next.
    // (With the second batch of companies the board is fuller, and a career runs a job or two shorter.)
    expect(standing).toBeGreaterThanOrEqual(28);
    expect(standing).toBeLessThanOrEqual(48);
    // Two or three standing jobs between two written contracts is the usual stretch. Once in a career it may run
    // to four or five, when the next written job needs a program the player has just spent the money for.
    const stretches: number[] = [];
    let run = 0;
    for (const job of report.jobs.slice(0, report.jobs.findLastIndex((item) => !item.job))) {
      if (job.job) run++;
      else {
        if (run > 0) stretches.push(run);
        run = 0;
      }
    }
    expect(Math.max(...stretches)).toBeLessThanOrEqual(5);
    expect(stretches.filter((length) => length > 3).length).toBeLessThanOrEqual(1);
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
    expect(plain.written).toBe(written);
    expect(plain.finalRating).toBeGreaterThanOrEqual(top.min);
    // Someone who does spends nearly every point and fits what the work turns up...
    const report = career(PROFILES.typical, seed);
    expect(report.learned.length).toBeGreaterThanOrEqual(12);
    expect(report.found).toBeGreaterThanOrEqual(4);
    expect(report.built.length).toBeGreaterThanOrEqual(8);
  });

  it('and over several careers they mean fewer traces and more time in hand, at no cost in pace', () => {
    // One career against another is the luck of the board: a trace or two, a minute or two, either way. Taken
    // over all the seeds, the player who learns skills and fits modules is plainly better off.
    const traced = (jobs: CareerReport['jobs']) => jobs.flatMap((job) => (job.closest === null ? [] : [job.closest]));
    const total = (pick: (report: CareerReport) => number, profile: Profile) => SEEDS.reduce((sum, seed) => sum + pick(career(profile, seed)), 0);
    const traces = (report: CareerReport) => traced(report.jobs).length;
    // The single tightest escape is a matter of a second or two either way now that traces are short, so the typical one is compared.
    const spare = (report: CareerReport) => median(traced(report.jobs));
    expect(total(traces, PROFILES.typical)).toBeLessThanOrEqual(total(traces, PLAIN) - 5);
    expect(total(spare, PROFILES.typical)).toBeGreaterThanOrEqual(total(spare, PLAIN) + 3 * SEEDS.length);
    expect(total((report) => report.minutes, PROFILES.typical)).toBeLessThan(total((report) => report.minutes, PLAIN) * 1.03);
  });

  it.each(SEEDS)('the work pays better the higher the title (seed %i)', (seed) => {
    const report = career(PROFILES.typical, seed);
    const third = Math.floor(report.jobs.length / 3);
    const rate = (jobs: typeof report.jobs) => jobs.reduce((sum, job) => sum + job.pay, 0) / jobs.reduce((sum, job) => sum + job.seconds, 0);
    // About twice as well by the last third as in the first. Which jobs the board happens to offer moves it a good way either side.
    expect(rate(report.jobs.slice(-third))).toBeGreaterThan(1.6 * rate(report.jobs.slice(0, third)));
  });

  it.each(SEEDS)('money stays short of the shelves, and the other shops get most of it (seed %i)', (seed) => {
    const report = career(PROFILES.typical, seed);
    // The wish list runs past what a whole career earns: there is always something left to save up for.
    expect(report.kitCompleteMinutes).toBeNull();
    // It never sits on a pile: the most it ever holds is a sixth of what it earns.
    expect(report.richest.balance).toBeLessThan(report.earned / 6);
    expect(report.bought.length).toBeGreaterThanOrEqual(25);
    // Once Wren has pointed them out, the cheaper and better-stocked shops take over from the Backroom.
    expect(report.bought.filter((item) => item.name.includes('(')).length).toBeGreaterThanOrEqual(15);
    // The top versions and the new kinds of gear are within a career's reach, late.
    for (const name of ['Password Breaker v3', 'Firewall Bypass v3', 'Monitor Bypass v3', 'Trace Jammer v1']) {
      expect(report.bought.some((item) => item.name.startsWith(name)), name).toBe(true);
    }
  });

  it.each(SEEDS)('a trace that runs is neither a formality nor a wall (seed %i)', (seed) => {
    for (const profile of [PROFILES.careful, PROFILES.typical]) {
      const report = career(profile, seed);
      // The second job is the first trace anyone meets, and it is made slow on purpose (see the guided first job).
      const gentle = (job: { id: string }) => job.id === 'kestrel-ledger';
      const lengths = report.jobs.flatMap((job) => (job.traceSeconds === null || gentle(job) ? [] : [job.traceSeconds]));
      // The plan's band: a good route buys one to two and a half minutes, and never the four to six it used to.
      // The longest of a whole career may run a little over, against one of the best-defended companies.
      expect(Math.max(...lengths), profile.name).toBeLessThanOrEqual(170);
      for (const job of report.jobs.filter(gentle)) expect(job.traceSeconds ?? 0, profile.name).toBeLessThanOrEqual(240);
      const later = settled(report).flatMap((job) => (job.traceSeconds === null ? [] : [job.traceSeconds]));
      expect(median(later), profile.name).toBeGreaterThanOrEqual(45);
      expect(median(later), profile.name).toBeLessThanOrEqual(100);
    }
    // An ordinary player past the opening leaves with well under a minute in hand, most times a trace runs.
    const spare = settled(career(PROFILES.typical, seed)).flatMap((job) => (job.closest === null ? [] : [job.closest]));
    expect(spare.length).toBeGreaterThanOrEqual(15);
    expect(median(spare)).toBeLessThanOrEqual(55);
  });

  it.each(SEEDS)('jobs with steps pay for their length (seed %i)', (seed) => {
    const report = career(PROFILES.typical, seed);
    const rate = (jobs: typeof report.jobs) => jobs.reduce((sum, job) => sum + job.pay, 0) / jobs.reduce((sum, job) => sum + job.seconds, 0);
    const late = settled(report).filter((job) => !job.story);
    const stepped = late.filter((job) => job.steps > 1);
    expect(stepped.length).toBeGreaterThanOrEqual(10);
    expect(rate(stepped)).toBeGreaterThan(0.85 * rate(late.filter((job) => job.steps === 1)));
    // And every one of them moves the rating.
    for (const contract of contracts) if (!contract.story) expect(contract.rating, contract.id).toBeGreaterThanOrEqual(1);
  });

  it.each(SEEDS)('the story takes most of the climb to unfold (seed %i)', (seed) => {
    for (const profile of [PROFILES.careful, PROFILES.typical]) {
      const report = career(profile, seed);
      expect(report.story.map((beat) => beat.id), profile.name).toEqual(story.beats.map((beat) => beat.id));
      // It starts before the Wraith title and, with Act 2, ends past the Spectre one, close to the top.
      expect(report.story[0]!.rating, profile.name).toBeLessThan(gameInfo.ratings[6]!.min);
      expect(report.story.at(-1)!.rating, profile.name).toBeGreaterThanOrEqual(gameInfo.ratings[10]!.min);
      // A scripted player keeps climbing on standing jobs while the story waits, so allow a little past the top.
      expect(report.story.at(-1)!.rating, profile.name).toBeLessThan(top.min + 6);
    }
  });

  it.each(SEEDS)('the first oddity is met by job five and Halvorsen is on the board by job ten (seed %i)', (seed) => {
    for (const profile of [PROFILES.careful, PROFILES.typical, PLAIN]) {
      const report = career(profile, seed);
      const order = (id: string) => report.jobs.findIndex((job) => job.id === id) + 1;
      expect(order('kestrel-audit'), profile.name).toBeGreaterThanOrEqual(3);
      expect(order('kestrel-audit'), profile.name).toBeLessThanOrEqual(5);
      expect(order('halvorsen-lantern'), profile.name).toBeGreaterThanOrEqual(8);
      expect(order('halvorsen-lantern'), profile.name).toBeLessThanOrEqual(10);
    }
  });

  it.each(SEEDS)('Halvorsen that early is hard, and within reach of someone new (seed %i)', (seed) => {
    // People ten jobs in: few relays or slow hands, the first programs, no skills and nothing from the Workbench.
    const few: Profile = { ...PLAIN, name: 'new, three relays', hops: 3, thinkSeconds: 6 };
    const slow: Profile = { ...PLAIN, name: 'new, slow hands', hops: 5, thinkSeconds: 9 };
    for (const profile of [few, slow, SLOW, FRUGAL]) {
      const report = playCareer(content, seed, profile, { ...options, maxContracts: 13 });
      const lantern = report.jobs.find((job) => job.id === 'halvorsen-lantern');
      // It is done by about job ten (a job or two later for someone traced on the way), in a visit or two.
      expect(lantern, profile.name).toBeDefined();
      expect(report.jobs.indexOf(lantern!) + 1, profile.name).toBeLessThanOrEqual(12);
      expect(lantern!.visits, profile.name).toBeLessThanOrEqual(3);
      expect(report.stuck, profile.name).toEqual([]);
      // And a trace runs on it: the first hard server is not a formality.
      expect(lantern!.traceSeconds, profile.name).not.toBeNull();
      expect(lantern!.traceSeconds!, profile.name).toBeLessThanOrEqual(120);
    }
    // An ordinary player gets out with time in hand, and not a great deal of it.
    const typical = career(PROFILES.typical, seed).jobs.find((job) => job.id === 'halvorsen-lantern')!;
    expect(typical.caught).toBe(0);
    expect(typical.closest!).toBeGreaterThanOrEqual(10);
    expect(typical.closest!).toBeLessThanOrEqual(60);
  });

  it.each(SEEDS)('enemy hackers are rare, never early, and can be beaten (seed %i)', (seed) => {
    for (const profile of [PROFILES.careful, PROFILES.typical, PLAIN]) {
      const report = career(profile, seed);
      // The story sends two (one in each act). The rest are a handful over a whole career.
      expect(report.raids.filter((raid) => raid.story).length, profile.name).toBe(2);
      expect(report.raids.length, profile.name).toBeGreaterThanOrEqual(2);
      expect(report.raids.length, profile.name).toBeLessThanOrEqual(7);
      for (const raid of report.raids) expect(raid.rating, profile.name).toBeGreaterThanOrEqual(tuning.raidMinRating);
      // Someone who traces back and shuts ports wins nearly every time.
      expect(report.raids.filter((raid) => raid.result === 'lost').length, profile.name).toBeLessThanOrEqual(1);
    }
    // Someone who only ever pulls the plug loses nothing, and learns nothing.
    expect(career(PROFILES.careless, 1).raids.every((raid) => raid.result === 'fled')).toBe(true);
  });

  it('two relays and no cleaning up is paid for in fines and traces', () => {
    const report = career(PROFILES.careless, 1);
    const tidy = career(PROFILES.typical, 1);
    expect(report.fines).toBeGreaterThan(5000);
    expect(report.caught + report.stuck.length).toBeGreaterThan(0);
    // Careless play never gets to the top: it is stuck in the lower titles while the tidy player is a Legend.
    expect(report.finalRating).toBeLessThan(tidy.finalRating);
    expect(report.titles.length).toBeLessThan(tidy.titles.length);
  });
});
