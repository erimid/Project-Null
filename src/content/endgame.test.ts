/**
 * The end of the career: the long upper titles, the property a late
 * career buys, and the legend contracts that are left at the top.
 */
import { describe, expect, it } from 'vitest';
import {
  LEGEND_PAY,
  LEGEND_RATING,
  LEGEND_TWISTS,
  TRAVEL_LIGHT_GB,
  applyAction,
  canReadTrace,
  createGame,
  deserializeGame,
  hasAsset,
  isJob,
  maxConnections,
  maxPrograms,
  memoryGb,
  pointsAt,
  postJobs,
  privateRelay,
  securityOf,
  serializeGame,
  syncWithContent,
  twistOfWeek,
  worldFor,
  type Action,
  type Content,
  type GameState,
} from '../core';
import { loseHardware } from '../core/hardware';
import { punish } from '../core/contracts';
import { newTrace, relayHeat, warmRelay } from '../core/trace';
import { coolHeat } from '../core/wanted';
import { noteProgress } from '../core/world';
import { STATE_VERSION } from '../core/state';
import { assets, companies, contracts, data, gameInfo, hardware, ladder, mail, models, modules, news, patrons, people, programs, rivals, servers, skills, story, tuning } from './index';
import { flushLessons } from '../core/record';

const written: Content = { servers, startingServers: gameInfo.startingServers, programs, startingPrograms: gameInfo.startingPrograms, contracts, mail, people, models, hardware, companies, skills, modules, rivals, story, news, patrons, ladder, data, assets, rules: tuning };
const SEED = 31;
const content = worldFor(written, SEED);
const DAY = 24 * 3_600_000;

function game(rating = 0) {
  const state: GameState = syncWithContent(createGame({ seed: SEED, handle: 'Kestrel', startDate: tuning.startDate, startingBalance: 500_000 }), content);
  state.player.rating = rating;
  state.player.bestRating = rating;
  postJobs(state, content);
  const act = (action: Action) => applyAction(state, action, content);
  const board = () => {
    expect(act({ type: 'connect', serverId: 'backroom' })).toEqual({ ok: true });
    const connection = state.connections.at(-1)!;
    expect(act({ type: 'login', connectionId: connection.id, user: 'member' })).toEqual({ ok: true });
    return connection.id;
  };
  return { state, act, board };
}

describe('the long upper titles', () => {
  it('are twice as long as the early ones, with a title every dozen points or so', () => {
    const mins = gameInfo.ratings.map((rung) => rung.min);
    expect(gameInfo.ratings.at(-1)).toEqual({ min: 111, title: 'Legend' });
    const steps = mins.slice(1).map((min, index) => min - mins[index]!);
    // Short steps at first, long ones later, and never a title more than sixteen points off.
    expect(Math.max(...steps.slice(0, 6))).toBeLessThanOrEqual(7);
    expect(Math.min(...steps.slice(6))).toBeGreaterThanOrEqual(12);
    expect(Math.max(...steps)).toBeLessThanOrEqual(16);
  });

  it('earn skill points at the same pace per title all the way up', () => {
    expect(pointsAt(tuning, 24)).toBe(8);
    expect(pointsAt(tuning, 30)).toBe(9);
    // The whole climb earns what it always did.
    expect(pointsAt(tuning, 111)).toBe(22);
  });

  it('move an old save to where its rating now stands', () => {
    const { state } = game();
    const { assets: _assets, legends: _legends, ...player } = state.player;
    const { legendDay: _day, ...board } = state.contracts;
    const old = { ...state, version: 26, player: { ...player, rating: 45, bestRating: 55 }, contracts: board, ladder: { ...state.ladder, scores: { hush: 34, sable: 20.5 } } };
    const loaded = deserializeGame(JSON.stringify({ format: 'project-null-save', version: 26, summary: {}, state: old })).state;
    expect(loaded.version).toBe(STATE_VERSION);
    // 25 and under stays; above that, every point is worth two.
    expect(loaded.player.rating).toBe(65);
    expect(loaded.player.bestRating).toBe(85);
    expect(loaded.ladder.scores).toEqual({ hush: 43, sable: 20.5 });
    expect(loaded.player.assets).toEqual([]);
    expect(loaded.player.legends).toBe(0);
    expect(loaded.contracts.legendDay).toBe(-1);
    // And it saves and loads again as it is.
    expect(deserializeGame(serializeGame(loaded, '2099-01-01T00:00:00Z')).state).toEqual(loaded);
  });
});

describe('property', () => {
  it('is sold by rating, once each, at a board that sells parts', () => {
    const { state, act, board } = game(50);
    const connectionId = board();
    expect(act({ type: 'buyAsset', connectionId, assetId: 'safe-house' })).toEqual({ ok: false, reason: expect.stringMatching(/rating of 64/) });
    const before = state.player.balance;
    expect(act({ type: 'buyAsset', connectionId, assetId: 'private-relay' })).toEqual({ ok: true });
    expect(before - state.player.balance).toBe(assets.find((asset) => asset.id === 'private-relay')!.price);
    expect(act({ type: 'buyAsset', connectionId, assetId: 'private-relay' })).toEqual({ ok: false, reason: 'You already own it.' });
    state.player.balance = 10;
    state.player.rating = 80;
    expect(act({ type: 'buyAsset', connectionId, assetId: 'second-gateway' })).toEqual({ ok: false, reason: 'You cannot afford that.' });
  });

  it('a private relay goes into the address book and never warms up', () => {
    const { state, act, board } = game(50);
    expect(state.knownServers).not.toContain('harbour-relay');
    expect(act({ type: 'buyAsset', connectionId: board(), assetId: 'private-relay' })).toEqual({ ok: true });
    expect(state.knownServers).toContain('harbour-relay');
    expect(privateRelay(state, content, 'harbour-relay')).toBe(true);
    warmRelay(state, content, 'harbour-relay');
    warmRelay(state, content, 'harbour-relay');
    expect(relayHeat(state, content, 'harbour-relay')).toBe(0);
  });

  it('a safe house halves the time lying low, cools heat twice as fast and keeps the gateway whole', () => {
    const target = content.servers.find((server) => server.generated?.tier === 5)!;
    const plain = game(80);
    const housed = game(80);
    expect(housed.act({ type: 'buyAsset', connectionId: housed.board(), assetId: 'safe-house' })).toEqual({ ok: true });
    expect(hasAsset(housed.state, content, 'safeHouse')).toBe(true);
    expect(punish(housed.state, content, target.id).hours).toBe(punish(plain.state, content, target.id).hours / 2);
    for (const { state } of [plain, housed]) {
      state.wanted.heat = 4;
      coolHeat(state, content, 0.5);
      state.player.hardware.cpu = 3;
    }
    expect(plain.state.wanted.heat).toBe(3.5);
    expect(housed.state.wanted.heat).toBe(3);
    expect(loseHardware(plain.state, content, target.id)).toBeDefined();
    expect(loseHardware(housed.state, content, target.id)).toBeUndefined();
    expect(housed.state.player.hardware.cpu).toBe(3);
  });

  it('a second gateway adds a connection, two programs and 16 GB of memory', () => {
    const { state, act, board } = game(80);
    const was = { connections: maxConnections(state, content), programs: maxPrograms(state, content), memory: memoryGb(state, content) };
    expect(act({ type: 'buyAsset', connectionId: board(), assetId: 'second-gateway' })).toEqual({ ok: true });
    expect(maxConnections(state, content)).toBe(was.connections + 1);
    expect(maxPrograms(state, content)).toBe(was.programs + 2);
    expect(memoryGb(state, content)).toBe(was.memory + 16);
  });

  it('the broker writes once, when the first is within reach', () => {
    const { state } = game(48);
    const letters = () => state.messages.filter((message) => message.subject === mail.property.subject).length;
    noteProgress(state, content);
    expect(letters()).toBe(0);
    state.player.rating = 49;
    noteProgress(state, content);
    noteProgress(state, content);
    expect(letters()).toBe(1);
  });
});

describe('legend contracts', () => {
  const legends = (state: GameState) => state.contracts.jobs.filter((job) => job.legend);

  it('are not posted below the top title', () => {
    const { state } = game(110);
    for (let day = 0; day < 5; day++) {
      state.clock.gameTimeMs += DAY;
      postJobs(state, content);
    }
    expect(legends(state)).toEqual([]);
  });

  it('come one at a time, a day apart, on top of the usual board: two steps against the hardest companies, at three times the pay', () => {
    const { state } = game(111);
    expect(legends(state)).toHaveLength(1);
    const job = legends(state)[0]!;
    expect(job.title).toMatch(/^Legend: /);
    expect(job.stages).toHaveLength(1);
    expect(job.rating).toBe(LEGEND_RATING);
    const tiers = [job.targetId, job.stages![0]!.targetId].map((id) => content.servers.find((server) => server.id === id)!.generated!.tier);
    expect(Math.max(...tiers)).toBeGreaterThanOrEqual(4);
    expect(job.pay).toBeGreaterThanOrEqual(tuning.jobPay[4]! * 1.8 * LEGEND_PAY - 50);
    expect(state.contracts.jobs.filter((item) => !item.legend && !item.news && !item.heist)).toHaveLength(tuning.boardJobs);
    // Nothing more while one is still up, however many days pass...
    postJobs(state, content);
    expect(legends(state)).toEqual([job]);
    // ...and once it has gone, nothing more that day. The next day brings another.
    state.contracts.jobs = state.contracts.jobs.filter((item) => item !== job);
    postJobs(state, content);
    expect(legends(state)).toEqual([]);
    state.clock.gameTimeMs += DAY;
    postJobs(state, content);
    expect(legends(state)).toHaveLength(1);
    expect(legends(state)[0]!.id).not.toBe(job.id);
  });

  it('carry the twist of the week, and a game sees all four before one repeats', () => {
    const weeks = [0, 1, 2, 3].map((week) => twistOfWeek(SEED, week));
    expect([...weeks].sort()).toEqual([...LEGEND_TWISTS].sort());
    expect(twistOfWeek(SEED, 4)).toBe(weeks[0]);
    const { state } = game(111);
    const job = legends(state)[0]!;
    expect(job.legend).toEqual({ twist: twistOfWeek(SEED, Math.floor(state.clock.gameTimeMs / DAY / 7)), week: Math.floor(state.clock.gameTimeMs / DAY / 7) });
  });

  it('bend one rule each, only while the job is open', () => {
    for (const twist of LEGEND_TWISTS) {
      const { state, act, board } = game(111);
      state.player.hardware.memory = 4;
      state.player.hardware.sensor = 1;
      const posted = legends(state)[0]!;
      const job = { ...posted, legend: { ...posted.legend!, twist } };
      state.contracts.jobs = state.contracts.jobs.map((item) => (item === posted ? job : item));
      const target = content.servers.find((server) => server.id === job.targetId)!;
      const other = content.servers.find((server) => server.generated?.tier === 5 && server.id !== job.targetId && server.id !== job.stages![0]!.targetId)!;
      const before = {
        memory: memoryGb(state, content),
        reads: canReadTrace(state, content),
        security: securityOf(state, target),
        trace: newTrace(state, content, target, []).hopMs[0]!,
      };
      expect(before.reads).toBe(true);
      expect(act({ type: 'acceptContract', connectionId: board(), contractId: job.id })).toEqual({ ok: true });
      act({ type: 'disconnectAll' });
      expect(memoryGb(state, content), twist).toBe(twist === 'travelLight' ? TRAVEL_LIGHT_GB : before.memory);
      expect(canReadTrace(state, content), twist).toBe(twist !== 'blindRun');
      expect(newTrace(state, content, target, []).hopMs[0]! / before.trace, twist).toBeCloseTo(twist === 'shortFuse' ? 2 / 3 : 1);
      const now = securityOf(state, target);
      for (const layer of ['password', 'proxy', 'firewall'] as const) {
        expect(now[layer], `${twist} ${layer}`).toBe(twist === 'onGuard' && before.security[layer] > 0 ? Math.min(6, before.security[layer] + 1) : before.security[layer]);
      }
      // A server that is not part of the job is as it was.
      expect(securityOf(state, other)).toEqual(other.security);
      // Given up, everything is back.
      expect(act({ type: 'abandonContract' })).toEqual({ ok: true });
      expect(memoryGb(state, content)).toBe(before.memory);
      expect(canReadTrace(state, content)).toBe(true);
      expect(securityOf(state, target)).toEqual(before.security);
    }
  });

  it('a twist that holds memory down sends what no longer fits back to the drive', () => {
    const { state, act, board } = game(111);
    state.player.hardware.memory = 6;
    state.player.programs = programs.filter((program) => program.price > 0 || gameInfo.startingPrograms.includes(program.id)).map((program) => program.id);
    syncWithContent(state, content);
    const posted = legends(state)[0]!;
    state.contracts.jobs = state.contracts.jobs.map((item) => (item === posted ? { ...posted, legend: { ...posted.legend!, twist: 'travelLight' as const } } : item));
    const size = () => state.player.loadout.reduce((sum, id) => sum + (programs.find((program) => program.id === id)?.sizeGq ?? 0), 0);
    expect(act({ type: 'acceptContract', connectionId: board(), contractId: posted.id })).toEqual({ ok: true });
    expect(size()).toBeLessThanOrEqual(TRAVEL_LIGHT_GB);
  });

  it('are explained once, when the first is posted', () => {
    const { state } = game(110);
    const letters = () => state.messages.filter((message) => message.subject === mail.legend.subject).length;
    noteProgress(state, content);
    expect(letters()).toBe(0);
    state.player.rating = 111;
    noteProgress(state, content);
    noteProgress(state, content);
    flushLessons(state, content);
    expect(letters()).toBe(1);
  });

  it('are left alone by rivals, who take only ordinary jobs', () => {
    const { state } = game(111);
    const job = legends(state)[0]!;
    expect(isJob(job)).toBe(true);
    for (let day = 0; day < 40; day++) {
      state.clock.gameTimeMs += DAY;
      // Keep it from running out, so only a rival could take it down.
      state.contracts.jobs = state.contracts.jobs.map((item) => (item.legend ? { ...item, expiresMs: state.clock.gameTimeMs + DAY } : item));
      postJobs(state, content);
      expect(legends(state).map((item) => item.id)).toEqual([job.id]);
    }
    expect(state.ladder.moves.some((move) => move.text.includes('took a job'))).toBe(true);
  });
});
