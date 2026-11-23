/**
 * Acts 3 and 4, played for real. A scripted player (core/career.ts) plays
 * a whole career from a new save through the same actions the screens
 * send, down each way the story can go, to each ending. If a rating gate,
 * a standing level, a server or a timing changes and one of these fails,
 * the end of the game has stopped holding together somewhere.
 *
 * To read a run: STORY_REPORT=1 npx vitest run src/content/finale.test.ts --disable-console-intercept
 */
import { describe, expect, it } from 'vitest';
import { PROFILES, formatCareer, playCareer, type CareerOptions, type CareerReport, type Profile } from '../core/career';
import { offeredChoices } from '../core/endings';
import { AI_TRUSTED, backfillTrust, standingWith } from '../core/patrons';
import { scheduleRaid } from '../core/raid';
import { tick } from '../core/clock';
import { applyAction } from '../core/actions';
import { availableContracts } from '../core/contracts';
import { advanceStory, storyOffered } from '../core/story';
import { isJob } from '../core/jobs';
import { stagesOf } from '../core/stages';
import { findServer } from '../core/world';
import { worldFor } from '../core/generate';
import type { Content, GameState } from '../core';
import type { ContractDef } from './schema';
import { assets, chorus, companies, contracts, data, endings, gameInfo, hardware, ladder, linesOf, mail, models, modules, news, patrons, people, programs, rivals, servers, skills, story, tuning } from './index';
import { content as storyWorld, fresh, play } from './storyPlay';

const written: Content = { servers, startingServers: gameInfo.startingServers, programs, startingPrograms: gameInfo.startingPrograms, contracts, mail, people, models, hardware, companies, skills, modules, rivals, story, news, patrons, ladder, data, assets, rules: tuning, chorus, endings };

const host = globalThis as { process?: { env: Record<string, string | undefined> }; console?: { log(text: string): void } };
const wanted = Boolean(host.process?.env.STORY_REPORT);

const asking = contracts.find((contract) => contract.id === 'act4-asking')!;
const LEGEND = gameInfo.ratings[gameInfo.ratings.length - 1]!.min;

interface Run {
  readonly report: CareerReport;
  /** The game as it ended. */
  readonly state: GameState;
  /** How things stood as the final job was taken. */
  readonly finale: { readonly lines: number; readonly allies: readonly string[]; readonly attacker: string | undefined; readonly offered: readonly string[]; readonly rating: number; readonly ports: number } | undefined;
  /** The Act 3 and 4 jobs it delivered, in order. */
  readonly late: CareerReport['jobs'];
}

interface Way {
  readonly choices?: Readonly<Record<string, string>>;
  readonly shun?: (contract: ContractDef, state: GameState) => boolean;
  readonly maxMinutes?: number;
}

/** A player who minds whom they hurt: once the sides are in play, no board job against a company one of them looks after. */
const kind =
  (seed: number) =>
  (contract: ContractDef, state: GameState): boolean => {
    if (!isJob(contract) || !state.flags.includes('chorus-awake')) return false;
    const world = worldFor(written, seed);
    return stagesOf(contract).some((stage) => {
      const sector = findServer(world, stage.targetId)?.generated?.sector;
      if (['read', 'guard', 'hold', 'hunt'].includes(stage.objective.kind)) return false;
      return sector === undefined || patrons.some((patron) => patron.id !== contract.patron && patron.protects.includes(sector));
    });
  };

const cache = new Map<string, Run>();
function run(name: string, profile: Profile, seed: number, way: Way = {}): Run {
  const key = `${name}/${profile.name}/${seed}`;
  const done = cache.get(key);
  if (done) return done;
  let live: GameState | undefined;
  let finale: Run['finale'];
  const options: CareerOptions = {
    maxContracts: 400,
    maxMinutes: way.maxMinutes ?? 420,
    untilRating: 9999,
    ratings: gameInfo.ratings,
    startDate: tuning.startDate,
    startingBalance: tuning.startingBalance,
    ...(way.choices ? { choices: way.choices } : {}),
    ...(way.shun ? { shun: way.shun } : {}),
    until: (state) => {
      live = state;
      return state.ending !== null;
    },
    note: (line) => {
      if (!live || !line.includes(`TAKE "${asking.title}"`)) return;
      const plan = live.contracts.heist;
      finale = {
        lines: (plan?.holds.filter((hold) => !hold.ally).length ?? 0) + 1,
        allies: plan?.holds.flatMap((hold) => (hold.ally ? [hold.ally] : [])) ?? [],
        attacker: live.raid?.attackerId ?? live.raidPending?.attackerId,
        offered: offeredChoices(live, asking).map((choice) => choice.id),
        rating: live.player.rating,
        ports: live.player.hardware.ports,
      };
    },
  };
  const report = playCareer(written, seed, profile, options);
  if (wanted) host.console?.log(`${name}\n${formatCareer(report)}\nfinale: ${JSON.stringify(finale)}\nstanding: ${JSON.stringify(live?.patrons.standing)}\n`);
  const result: Run = { report, state: live!, finale, late: report.jobs.filter((job) => /^act[34]-/.test(job.id)) };
  cache.set(key, result);
  return result;
}

/** Does every job the way it is first offered: gives the Office the node, Calder Re the forecaster, Daylight the list. */
const OBLIGING: Way = {};
/** Sides with the machines at every turn. */
const WITH_THE_AIS: Way = { choices: { 'act3-ask': 'refuse', 'act3-acquire': 'vesper', 'act3-list': 'keep', 'act4-asking': 'unbound' } };
/** Refuses the Office and keeps everyone else's good opinion, hurting none of them on the side. */
const PEACEMAKER = (seed: number): Way => ({ choices: { 'act3-ask': 'refuse', 'act4-asking': 'treaty' }, shun: kind(seed) });
/** Leaves Wick's letter on the board until the station is gone, and never goes back for it. */
const LEFT_WICK: Way = {
  choices: { 'act4-asking': 'daylight' },
  shun: (contract, state) => (contract.id === 'act3-clerk' && !state.flags.includes('station-taken')) || contract.id === 'act3-deadair',
};
/** Reads the letter that opens Act 3 and never touches a story job again. */
const DEAF: Way = { shun: (contract) => /^act[34]-/.test(contract.id), maxMinutes: 1500 };

const SEEDS = [1, 7, 2034];

describe('Acts 3 and 4, played from a new save', () => {
  it.each(SEEDS)('an obliging player gets from the three ways to an ending, stuck nowhere (seed %i)', (seed) => {
    for (const profile of [PROFILES.careful, PROFILES.typical]) {
      const { report, state, late } = run('obliging', profile, seed, OBLIGING);
      expect(report.stuck, profile.name).toEqual([]);
      expect(state.ending?.id, profile.name).toBe('quiet');
      // Every job on the way: the three doors, Wick, Vesper's three lines, the name, and Act 4.
      expect(late.map((job) => job.id).sort(), profile.name).toEqual(
        ['act3-trail', 'act3-lock', 'act3-ask', 'act3-diligence', 'act3-acquire', 'act3-witnesses', 'act3-holdboard', 'act3-list', 'act3-clerk', 'act3-lines', 'act3-name', 'act4-signature', 'act4-lantern', 'act4-asking'].sort(),
      );
      // Nothing is lost by accident: someone who simply plays never loses the station or Wren.
      expect(state.flags, profile.name).not.toContain('station-taken');
      expect(state.flags, profile.name).not.toContain('wren-caught');
      expect(late.some((job) => job.id === 'act3-deadair' || job.id === 'act3-postbox'), profile.name).toBe(false);
    }
    expect(run('obliging', PROFILES.careful, seed, OBLIGING).report.caught).toBe(0);
  });

  it.each(SEEDS)('the acts open in order up the last title and past it (seed %i)', (seed) => {
    const { report, finale } = run('obliging', PROFILES.typical, seed, OBLIGING);
    const at = (id: string) => report.story.find((beat) => beat.id === id)!;
    // Act 3 opens as Act 2 closes, in the Eidolon title; the name is read on the doorstep of Legend.
    expect(at('a3-ways').rating).toBeGreaterThanOrEqual(99);
    expect(at('a3-ways').rating).toBeLessThan(LEGEND);
    expect(at('a3-name').rating).toBeGreaterThanOrEqual(LEGEND - 1);
    // Act 4 is a Legend's work: each step waits for a little more standing than the last left you with.
    expect(at('a4-wren-asks').rating).toBeGreaterThanOrEqual(LEGEND + 1);
    expect(at('a4-lantern').rating).toBeGreaterThanOrEqual(LEGEND + 3);
    expect(finale!.rating).toBeGreaterThanOrEqual(LEGEND + 5);
    // The four doors open one after another, not all at once.
    const doors = ['a3-office-hire', 'a3-calder-hire', 'a3-day-hire', 'a3-wick-ask'].map((id) => at(id).rating);
    expect(Math.min(...doors)).toBeGreaterThanOrEqual(100);
    // And the whole of it is a real stretch of the game, not an epilogue.
    expect(at('a4-the-asking').atMinutes - at('a3-ways').atMinutes).toBeGreaterThanOrEqual(25);
  });

  it.each(SEEDS)('no story job is a wall or a formality (seed %i)', (seed) => {
    for (const profile of [PROFILES.careful, PROFILES.typical]) {
      const { late } = run('obliging', profile, seed, OBLIGING);
      for (const job of late) {
        // Done in a trip or three, never traced, and never with nothing in hand when a trace ran.
        expect(job.visits, `${profile.name} ${job.id}`).toBeLessThanOrEqual(3);
        expect(job.caught, `${profile.name} ${job.id}`).toBe(0);
        if (job.closest !== null) expect(job.closest, `${profile.name} ${job.id}`).toBeGreaterThanOrEqual(5);
      }
      // Traces run on most of them, and an ordinary player feels at least one get close.
      const traced = late.flatMap((job) => (job.closest === null ? [] : [job.closest]));
      expect(traced.length, profile.name).toBeGreaterThanOrEqual(8);
      if (profile === PROFILES.typical) expect(Math.min(...traced)).toBeLessThanOrEqual(40);
    }
  });

  it.each(SEEDS)('the story pays better than the board, and the final job is within a normal gateway (seed %i)', (seed) => {
    const { report, late, finale } = run('obliging', PROFILES.typical, seed, OBLIGING);
    const rate = (jobs: CareerReport['jobs']) => jobs.reduce((sum, job) => sum + job.pay, 0) / jobs.reduce((sum, job) => sum + job.seconds, 0);
    const first = report.jobs.findIndex((job) => job.id === 'act3-trail');
    const board = report.jobs.slice(first).filter((job) => job.job);
    expect(rate(late)).toBeGreaterThan(rate(board));
    // Never more lines than a gateway of that standing already has, and the money to have bought them.
    expect(finale!.lines).toBeLessThanOrEqual(3);
    expect(finale!.ports).toBeGreaterThanOrEqual(finale!.lines);
  });
});

describe('The five endings, each reached by playing', () => {
  it('Quiet is there for anyone, and giving the Office the node shuts the machines’ door', () => {
    const { state, finale } = run('obliging', PROFILES.typical, 1, OBLIGING);
    expect(state.ending?.id).toBe('quiet');
    expect(state.flags).toContain('node-given');
    expect(finale!.offered).toContain('daylight');
    expect(finale!.offered).not.toContain('unbound');
    // The Office is pleased, so its own machine holds a line. Vesper will not.
    expect(finale!.allies).toContain('Warden');
    expect(finale!.allies).not.toContain('Vesper');
  });

  it('Unbound is earned by siding with the machines', () => {
    const { report, state, finale } = run('with the AIs', PROFILES.typical, 1, WITH_THE_AIS);
    expect(report.stuck).toEqual([]);
    expect(state.ending?.id).toBe('unbound');
    expect(finale!.offered).toContain('unbound');
    expect(finale!.allies).toEqual(expect.arrayContaining(['Vesper', 'Wick']));
    // The Office and Calder Re were both crossed: one of them sends somebody.
    expect(['warden', 'sable']).toContain(finale!.attacker);
    expect(standingWith(state, 'ais')).toBeGreaterThanOrEqual(AI_TRUSTED);
  });

  it.each([
    [PROFILES.careful, 7],
    [PROFILES.typical, 2034],
  ] as const)('the treaty is earned by keeping three sides’ good opinion, which takes care (%#)', (profile, seed) => {
    const { report, state, finale } = run('peacemaker', profile, seed, PEACEMAKER(seed));
    expect(report.stuck).toEqual([]);
    expect(state.ending?.id).toBe('treaty');
    expect(finale!.offered).toEqual(expect.arrayContaining(['daylight', 'unbound', 'treaty']));
  });

  it('and is lost by someone who takes any work going, against whoever it hurts', () => {
    // Two sides cooled is what keeps the treaty out of reach; the bot's luck on the board decides how many do, so this seed is one where two did.
    const careless = run('refuses, careless', PROFILES.typical, 6, { choices: { 'act3-ask': 'refuse' } });
    expect(careless.finale!.offered).toContain('unbound');
    expect(careless.finale!.offered).not.toContain('treaty');
  });

  it('Daylight is always there, even for someone who lost the station and never went back', () => {
    const { report, state, finale } = run('left Wick', PROFILES.careful, 7, LEFT_WICK);
    expect(report.stuck).toEqual([]);
    expect(state.ending?.id).toBe('daylight');
    expect(state.flags).toContain('station-taken');
    // Wick is not there to keep a line quiet, so it is one more for the player to hold.
    expect(finale!.allies).not.toContain('Wick');
    expect(finale!.lines).toBe(3);
  });

  it('Chorus comes for someone who never answers, after a long time and three warnings', () => {
    const { report, state } = run('deaf', PROFILES.typical, 1, DEAF);
    expect(state.ending?.id).toBe('chorus');
    const first = report.story.find((beat) => beat.id === 'a3-ways')!;
    // Hours of play with the story left on the board, not an evening's distraction.
    expect(report.minutes - first.atMinutes).toBeGreaterThanOrEqual(300);
    for (const warning of chorus!.doom!.warnings) expect(state.messages.some((message) => message.subject === warning.mail.subject), warning.mail.subject).toBe(true);
  });
});

describe('Trust, for saves old and new', () => {
  it('a new game reaches Act 3 trusted by the machines it has worked for', () => {
    const { state } = run('obliging', PROFILES.typical, 2034, OBLIGING);
    // Six jobs for Vesper and Wick in Acts 1 and 2, three more in Act 3, and one confession.
    expect(standingWith(state, 'ais')).toBeGreaterThanOrEqual(AI_TRUSTED - 4);
  });

  it('a save from before trust was kept is given what its finished jobs earned', () => {
    const state = fresh();
    const early = contracts.filter((contract) => contract.patron === 'ais' && !/^(act[34]|after)-/.test(contract.id));
    expect(early.length).toBeGreaterThanOrEqual(6);
    for (const contract of early) state.contracts.completed.push(contract.id);
    state.patrons.standing = {};
    backfillTrust(state, storyWorld);
    expect(standingWith(state, 'ais')).toBe(early.length * 2);
    // With Act 3's own jobs and the confession on top, that is enough to be trusted: no old save is locked out of an ending.
    expect(early.length * 2 + 3 * 2 + 1).toBeGreaterThanOrEqual(AI_TRUSTED);
    // It never lowers trust, and leaves a save alone once Act 3 has started moving it.
    state.patrons.standing.ais = 3;
    state.flags.push('story:a3-ways');
    backfillTrust(state, storyWorld);
    expect(standingWith(state, 'ais')).toBe(3);
  });

  it('each door forgives an old grudge once the player has worked for it', () => {
    const state = fresh();
    Object.assign(state.patrons.standing, { office: -8, calder: -10, daylight: -10 });
    play(state, {}, ['act4-asking'], 80);
    for (const id of ['office', 'calder', 'daylight']) expect(standingWith(state, id), id).toBeGreaterThanOrEqual(2);
  });
});

describe('Rules the story leans on', () => {
  it('offers a job whose file only appears as the job is taken', () => {
    const state = fresh();
    play(state, {}, ['act4-signature'], 80);
    expect(storyOffered(state)).toContain('act4-signature');
    expect(availableContracts(state, storyWorld).map((contract) => contract.id)).toContain('act4-signature');
  });

  it('a client does not trace their own guard', () => {
    const state = fresh();
    play(state, {}, ['act3-holdboard'], 40);
    advanceStory(state, storyWorld);
    expect(storyOffered(state)).toContain('act3-holdboard');
    const board = storyWorld.servers.find((server) => server.kind === 'board')!;
    const act = (action: Parameters<typeof applyAction>[1]) => applyAction(state, action, storyWorld);
    expect(act({ type: 'connect', serverId: board.id }).ok).toBe(true);
    expect(act({ type: 'login', connectionId: state.connections[0]!.id, user: board.accounts[0]!.user }).ok).toBe(true);
    expect(act({ type: 'acceptContract', connectionId: state.connections[0]!.id, contractId: 'act3-holdboard' })).toEqual({ ok: true });
    act({ type: 'disconnectAll' });
    if (!state.knownServers.includes('daylight-board')) state.knownServers.push('daylight-board');
    expect(act({ type: 'connect', serverId: 'daylight-board' }).ok).toBe(true);
    const line = state.connections[0]!;
    const admin = storyWorld.servers.find((server) => server.id === 'daylight-board')!.accounts.find((account) => account.role === 'admin')!;
    expect(act({ type: 'login', connectionId: line.id, user: admin.user }).ok).toBe(true);
    for (let i = 0; i < 600; i++) tick(state, 100, storyWorld);
    expect(line.trace.status).toBe('none');
    expect(state.contracts.heldMs).toBeGreaterThan(50_000);
  });

  it('once Chorus is awake, whoever breaks in goes first for what the story turns on', () => {
    const state = fresh();
    state.flags.push('chorus-awake');
    state.player.files.push({ name: 'holiday.jpg', sizeGq: 1, from: 'x' }, { name: 'containment_register.dat', sizeGq: 2, from: 'continuity-office' });
    scheduleRaid(state, storyWorld, 'halftone', true);
    for (let i = 0; i < 3000 && (state.raid || state.raidPending); i++) tick(state, 100, storyWorld);
    expect(state.player.files.map((file) => file.name)).toContain('holiday.jpg');
    expect(state.player.files.map((file) => file.name)).not.toContain('containment_register.dat');
  });

  it('the timed turns say they are coming, well before they come', () => {
    for (const beat of linesOf(story).flatMap((line) => line.beats)) {
      if (!beat.lapse) continue;
      expect(beat.lapse.warn, beat.id).toBeDefined();
      expect(beat.lapse.hours, beat.id).toBeGreaterThanOrEqual(120);
      expect(beat.lapse.hours - beat.lapse.warn!.hours, beat.id).toBeGreaterThanOrEqual(48);
    }
  });
});
