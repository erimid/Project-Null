import { describe, expect, it } from 'vitest';
import { applyAction, beginRaid, createGame, syncWithContent, tick, type Content, type GameState } from '../core';
import { content as base, rivalHome, testRivals, testServers } from '../core/testWorld';
import { diff, snapshot } from './events';

const content: Content = { ...base, servers: [...testServers, rivalHome], rivals: testRivals };

function game(): GameState {
  const state = syncWithContent(createGame({ seed: 3, handle: 'T', startDate: '2034-03-14T08:00:00Z', startingBalance: 5000 }), content);
  state.player.rating = 10;
  return state;
}

/** The events one change makes. */
function eventsOf(state: GameState, change: () => void, byClock = false) {
  const before = snapshot(state, content);
  change();
  return diff(before, snapshot(state, content), content, byClock);
}

describe('attack events', () => {
  it('an attack starting raises its own alarm and not the mail chime', () => {
    const state = game();
    const events = eventsOf(state, () => beginRaid(state, content, testRivals[0]!.id));
    expect(events).toContainEqual({ type: 'raidStarted', who: testRivals[0]!.handle });
    expect(events.some((event) => event.type === 'message')).toBe(false);
  });

  it('pulling the plug ends it as fled', () => {
    const state = game();
    beginRaid(state, content, testRivals[0]!.id);
    const events = eventsOf(state, () => applyAction(state, { type: 'pullPlug' }, content));
    expect(events).toContainEqual({ type: 'raidEnded', who: testRivals[0]!.handle, result: 'fled' });
  });

  it('a break-in ends it as lost, and a finished trace as won', () => {
    const lost = game();
    beginRaid(lost, content, testRivals[0]!.id);
    const lostEvents = eventsOf(lost, () => { for (let i = 0; i < 6000 && lost.raid; i++) tick(lost, 100, content); }, true);
    expect(lostEvents.find((event) => event.type === 'raidEnded')).toMatchObject({ result: 'lost' });

    const won = game();
    beginRaid(won, content, testRivals[0]!.id);
    applyAction(won, { type: 'traceBack' }, content);
    // Hold the break-in off so the trace is what ends it.
    const wonEvents = eventsOf(won, () => {
      for (let i = 0; i < 6000 && won.raid; i++) {
        won.raid.breachMs = 0;
        tick(won, 100, content);
      }
    }, true);
    expect(wonEvents.find((event) => event.type === 'raidEnded')).toMatchObject({ result: 'won' });
  });
});
