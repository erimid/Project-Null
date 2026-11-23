/**
 * The story's own moments as the screen hears of them: Chorus taking a
 * server, the name being read, and the story ending.
 */
import { describe, expect, it } from 'vitest';
import { reachEnding, readFlag, takeServer, type GameState } from '../core';
import { content, fresh } from '../content/storyPlay';
import { diff, snapshot } from './events';

function eventsOf(state: GameState, change: () => void) {
  const before = snapshot(state, content);
  change();
  return diff(before, snapshot(state, content), content, true);
}

const company = (state: GameState, skip = 0) => content.servers.filter((server) => server.kind === 'company' && !state.chorus.taken.includes(server.id))[skip]!;

describe('story events', () => {
  it('says when a timed ally lets go of a heist door, and not when the heist ends', () => {
    const state = fresh();
    state.contracts.heist = { vaultId: 'orrery-vault', holds: [{ targetId: 'orrery-ministry', layer: 'monitor', ally: 'Wick', allyMs: 500 }] };
    const ministry = content.servers.find((server) => server.id === 'orrery-ministry')!;
    expect(eventsOf(state, () => (state.contracts.heist!.holds[0]!.allyMs = 0))).toContainEqual({ type: 'allyLetGo', who: 'Wick', server: ministry.name });
    state.contracts.heist.holds[0]!.allyMs = 500;
    expect(eventsOf(state, () => (state.contracts.heist = null)).some((event) => event.type === 'allyLetGo')).toBe(false);
  });

  it('says which server Chorus took, and where it reached from', () => {
    const state = fresh();
    const first = company(state);
    expect(eventsOf(state, () => takeServer(state, content, first.id))).toContainEqual({ type: 'serverTaken', id: first.id, server: first.name });
    const second = company(state);
    expect(eventsOf(state, () => takeServer(state, content, second.id))).toContainEqual({ type: 'serverTaken', id: second.id, server: second.name, from: first.id });
  });

  it('marks the name being read once, when the file the three lines open is read', () => {
    const state = fresh();
    const job = content.contracts.find((contract) => contract.id === 'act3-name')!;
    const last = job.stages!.at(-1)!;
    expect(last.objective.kind).toBe('read');
    const flag = readFlag(last.targetId, (last.objective as { file: string }).file);
    expect(eventsOf(state, () => state.flags.push(flag))).toContainEqual({ type: 'nameRead' });
    expect(eventsOf(state, () => state.flags.push('something-else'))).not.toContainEqual({ type: 'nameRead' });
  });

  it('marks each ending once, without the mail chime, and an ending that hands Chorus everything is one event', () => {
    for (const ending of content.endings ?? []) {
      const state = fresh();
      const events = eventsOf(state, () => reachEnding(state, content, ending.id));
      expect(events.filter((event) => event.type === 'ended')).toEqual([{ type: 'ended', id: ending.id, name: ending.name }]);
      expect(events.some((event) => event.type === 'message' || event.type === 'serverTaken')).toBe(false);
      expect(ending.line.length).toBeGreaterThan(10);
    }
  });
});
