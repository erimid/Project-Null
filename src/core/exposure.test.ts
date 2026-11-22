import { describe, expect, it } from 'vitest';
import { createGame, editionDay, syncWithContent, type GameState } from './index';
import { happenings, troubleAt, troubleKind, troubleMap } from './exposure';
import { content } from './testWorld';

const HOUR = 3_600_000;

function game(): GameState {
  const state = syncWithContent(createGame({ seed: 7, handle: 'T', startDate: '2034-03-14T08:00:00Z', startingBalance: 5000 }), content);
  state.knownServers = ['gateway', 'directory', 'relay-a', 'corp'];
  return state;
}

const leaveLine = (state: GameState, serverId: string, text: string) =>
  state.servers[serverId]!.logs.push({ id: state.nextId++, timeMs: state.clock.gameTimeMs, text, byPlayer: true });

describe('trouble on the globe', () => {
  it('finds nothing at a server the player has left clean', () => {
    const state = game();
    leaveLine(state, 'corp', 'connection opened from 10.0.0.1');
    expect(troubleAt(state, content, 'corp')).toBeNull();
    expect(troubleMap(state, content).size).toBe(0);
  });

  it('counts the lines that would give the player away', () => {
    const state = game();
    leaveLine(state, 'corp', 'login admin');
    leaveLine(state, 'corp', 'file copied secret.dat');
    const trouble = troubleAt(state, content, 'corp')!;
    expect(trouble.evidence).toBe(2);
    expect(troubleKind(trouble)).toBe('logs');
  });

  it('shows an open case and how far through its wait it is', () => {
    const state = game();
    const wait = content.rules.reviewHours * HOUR;
    state.reviews.push({ serverId: 'relay-a', dueMs: state.clock.gameTimeMs + wait / 4 });
    const trouble = troubleAt(state, content, 'relay-a')!;
    expect(troubleKind(trouble)).toBe('case');
    expect(trouble.caseShare).toBeCloseTo(0.75);
    expect(trouble.caseDueMs).toBe(state.clock.gameTimeMs + wait / 4);
  });

  it('marks admins on the watch, and lets the watch end', () => {
    const state = game();
    state.servers.corp!.alert = { raise: { monitor: 1 }, untilMs: state.clock.gameTimeMs + HOUR };
    expect(troubleAt(state, content, 'corp')?.watch).toBe('guard');
    state.clock.gameTimeMs += 2 * HOUR;
    expect(troubleAt(state, content, 'corp')).toBeNull();
    state.news.firms.push('corp');
    expect(troubleAt(state, content, 'corp')?.watch).toBe('firm');
  });

  it('only looks at servers the player knows, and never at the gateway or a public place', () => {
    const state = game();
    state.knownServers.push('hidden');
    leaveLine(state, 'hidden', 'login member');
    leaveLine(state, 'directory', 'login guest');
    leaveLine(state, 'vault', 'login admin');
    leaveLine(state, 'gateway', 'login admin');
    leaveLine(state, 'corp', 'login admin');
    expect([...troubleMap(state, content).keys()]).toEqual(['corp']);
  });
});

describe('work on the globe', () => {
  it('groups the jobs on the board by where they are', () => {
    const state = game();
    const here = happenings(state, content);
    expect(here.get('corp')?.jobs.map((job) => job.id)).toEqual(['steal', 'destroy']);
    expect(here.has('directory')).toBe(false);
  });

  it('marks where the job in hand is, and takes it off the board', () => {
    const state = game();
    state.contracts.activeId = 'steal';
    const corp = happenings(state, content).get('corp')!;
    expect(corp.mine).toBe(true);
    expect(corp.jobs.map((job) => job.id)).toEqual(['destroy']);
  });

  it("puts this morning's news where it happened, and drops it the next day", () => {
    const state = game();
    const day = editionDay(state.clock.gameTimeMs);
    state.news.editions.push({ day, weather: '', items: [{ id: 'n1', kind: 'world', headline: 'Corp tightens up', body: 'b', serverId: 'directory' }] });
    expect(happenings(state, content).get('directory')?.news.map((item) => item.id)).toEqual(['n1']);
    state.clock.gameTimeMs += 2 * 86_400_000;
    expect(happenings(state, content).get('directory')).toBeUndefined();
  });
});
