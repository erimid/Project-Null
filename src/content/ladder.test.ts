import { describe, expect, it } from 'vitest';
import { applyAction, createGame, deserializeGame, ladderPlace, ladderRows, postJobs, privateRelay, rivalScore, serializeGame, syncWithContent, tick, worldFor, type Content, type GameState } from '../core';
import { beginRaid, scheduleRaid } from '../core/raid';
import { advanceLadder, noteBeaten, outOfRaids } from '../core/ladder';
import { relayHeat, warmRelay } from '../core/trace';
import { companies, contracts, gameInfo, hardware, mail, models, people, programs, modules, rivals, servers, skills, story, tuning, news, patrons, ladder } from './index';

const written: Content = { servers, startingServers: gameInfo.startingServers, programs, startingPrograms: gameInfo.startingPrograms, contracts, mail, people, models, hardware, companies, skills, modules, rivals, story, news, patrons, ladder, rules: tuning };
const SEED = 31;
const content = worldFor(written, SEED);

const newGame = (): GameState => {
  const state = syncWithContent(createGame({ seed: SEED, handle: 'Kestrel', startDate: tuning.startDate, startingBalance: tuning.startingBalance }), content);
  postJobs(state, content);
  return state;
};
const nextDay = (state: GameState) => {
  state.clock.gameTimeMs += 24 * 3_600_000;
  postJobs(state, content);
};

describe('the rivals ladder', () => {
  it('ranks a dozen handles with the player among them, each raider included', () => {
    const state = newGame();
    const rows = ladderRows(state, content);
    expect(rows).toHaveLength(ladder.rivals.length + 1);
    expect(rows.filter((row) => row.id === null)).toHaveLength(1);
    for (const raider of rivals) expect(rows.some((row) => row.id === raider.id)).toBe(true);
    expect(ladderPlace(state, content)).toBeGreaterThan(5);
  });

  it('climbs once a game day, and rivals take jobs and write when places change', () => {
    const state = newGame();
    const start = rivalScore(state, content, 'hush');
    let sniped = 0;
    let letters = 0;
    for (let day = 0; day < 20; day++) {
      const jobs = state.contracts.jobs.length;
      const mailBefore = state.messages.length;
      state.player.rating += 3;
      nextDay(state);
      if (state.ladder.moves.some((move) => move.timeMs === state.clock.gameTimeMs && move.text.includes('took a job'))) sniped++;
      letters += state.messages.slice(mailBefore).filter((message) => ladder.rivals.some((rival) => rival.handle === message.from)).length;
      expect(state.contracts.jobs.length).toBeGreaterThanOrEqual(Math.min(jobs, tuning.boardJobs) - 1);
    }
    expect(rivalScore(state, content, 'hush')).toBeGreaterThan(start + 10);
    expect(sniped).toBeGreaterThan(0);
    expect(letters).toBeGreaterThan(0);
    expect(state.ladder.moves.length).toBeLessThanOrEqual(8);
    // Moving on twice in one day does nothing.
    const scores = { ...state.ladder.scores };
    advanceLadder(state, content);
    expect(state.ladder.scores).toEqual(scores);
  });

  it('puts a beaten raider on the ladder for a decision, and each choice does what it says', () => {
    for (const outcome of ['sold', 'relay', 'truce'] as const) {
      const state = newGame();
      const raider = rivals[0]!;
      beginRaid(state, content, raider.id);
      state.raid!.traceBack = { status: 'active', graceMs: 0, elapsedMs: 1e9, hopMs: [1] };
      tick(state, 10, content);
      expect(state.raid).toBeNull();
      expect(state.ladder.beaten).toEqual([raider.id]);
      expect(state.messages.at(-1)!.body).toContain('Ladder');
      const balance = state.player.balance;
      expect(applyAction(state, { type: 'settleRival', rivalId: raider.id, outcome }, content)).toEqual({ ok: true });
      expect(state.ladder.beaten).toEqual([]);
      expect(state.ladder.outcomes[raider.id]).toBe(outcome);
      if (outcome === 'sold') expect(state.player.balance).toBeGreaterThan(balance);
      expect(outOfRaids(state, raider.id)).toBe(outcome !== 'relay');
      if (outcome === 'relay') {
        expect(privateRelay(state, content, raider.homeId)).toBe(true);
        warmRelay(state, content, raider.homeId);
        expect(relayHeat(state, content, raider.homeId)).toBe(0);
      }
      // Story raids still come, whatever was decided.
      scheduleRaid(state, content, raider.id, true);
      expect(state.raidPending).not.toBeNull();
      expect(applyAction(state, { type: 'settleRival', rivalId: raider.id, outcome }, content).ok).toBe(false);
    }
  });

  it('sends tips from a rival with a truce', () => {
    const state = newGame();
    noteBeaten(state, content, 'mirrorjack');
    applyAction(state, { type: 'settleRival', rivalId: 'mirrorjack', outcome: 'truce' }, content);
    const known = state.knownServers.length;
    for (let day = 0; day < 15; day++) nextDay(state);
    expect(state.knownServers.length).toBeGreaterThan(known);
    expect(state.messages.some((message) => message.from === 'Mirrorjack' && message.subject === 'A tip')).toBe(true);
  });

  it('survives a save, and old saves keep the raiders already beaten', () => {
    const state = newGame();
    nextDay(state);
    expect(deserializeGame(serializeGame(state, '2030-01-01T00:00:00Z')).state.ladder).toEqual(state.ladder);
    const old = JSON.parse(serializeGame(state, '2030-01-01T00:00:00Z'));
    delete old.state.ladder;
    old.state.flags.push('beat:halftone');
    old.version = old.state.version = 21;
    const loaded = syncWithContent(deserializeGame(JSON.stringify(old)).state, content);
    expect(loaded.ladder.beaten).toEqual(['halftone']);
    postJobs(loaded, content);
    expect(loaded.ladder.day).toBeGreaterThan(0);
  });
});
