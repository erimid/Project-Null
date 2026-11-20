import { describe, expect, it } from 'vitest';
import { advanceStory, currentBeat, storyComplete, storyOffered } from './story';
import { availableContracts, createGame, syncWithContent, type Content, type GameState } from './index';
import { content as base, rivalHome, testRivals, testServers } from './testWorld';
import type { StoryDef } from '../content/story';
import type { ContractDef } from '../content/schema';

const mail = (id: string) => ({ from: 'Vesper', subject: id, body: `b-${id}` });

/** Three story contracts against a test server, marked story so the board leaves them to the director. */
const storyContracts: ContractDef[] = ['sc-look', 'sc-take', 'sc-name'].map((id) => ({
  id,
  title: id,
  client: 'Vesper',
  targetId: 'corp',
  pay: 100,
  rating: 1,
  minRating: 0,
  story: true,
  summary: id,
  brief: id,
  objective: { kind: 'steal', file: 'secret.dat' },
}));

/** A test world with a short Act 1 and the rivals the raid beat needs. */
function world(beats: StoryDef['beats']): Content {
  return {
    ...base,
    servers: [...testServers, rivalHome],
    rivals: testRivals,
    contracts: [...base.contracts, ...storyContracts],
    story: { beats },
  };
}

function game(content: Content, rating = 0): GameState {
  const state = syncWithContent(
    createGame({ seed: 5, handle: 'T', startDate: '2034-03-14T08:00:00Z', startingBalance: 1000 }),
    content,
  );
  state.player.rating = rating;
  return state;
}

/** Game hours forward on the clock, without ticking the rest of the sim. */
function pass(state: GameState, hours: number): void {
  state.clock.gameTimeMs += hours * 3_600_000;
}

describe('Story director', () => {
  it('sends an auto beat at once and moves straight on', () => {
    const content = world([{ id: 'hello', mail: mail('hello') }, { id: 'next', minRating: 99, mail: mail('next') }]);
    const h = game(content);
    advanceStory(h, content);
    // The first beat arrived (its message is in the inbox) and the story is now waiting on the second.
    expect(h.messages.map((m) => m.subject)).toContain('hello');
    expect(currentBeat(h, content)?.id).toBe('next');
  });

  it('holds a beat until the rating is high enough', () => {
    const content = world([{ id: 'gated', minRating: 10, mail: mail('gated') }]);
    const h = game(content, 9);
    advanceStory(h, content);
    expect(h.messages.some((m) => m.subject === 'gated')).toBe(false);
    h.player.rating = 10;
    advanceStory(h, content);
    expect(h.messages.map((m) => m.subject)).toContain('gated');
  });

  it('spaces a beat a set time after the one before', () => {
    const content = world([{ id: 'first', mail: mail('first') }, { id: 'second', afterHours: 12, mail: mail('second') }]);
    const h = game(content);
    advanceStory(h, content);
    expect(currentBeat(h, content)?.id).toBe('second');
    // Not yet: only a few hours have passed since the first arrived.
    pass(h, 6);
    advanceStory(h, content);
    expect(h.messages.some((m) => m.subject === 'second')).toBe(false);
    pass(h, 7);
    advanceStory(h, content);
    expect(h.messages.some((m) => m.subject === 'second')).toBe(true);
  });

  it('waits for a contract it requires before it starts', () => {
    const content = world([{ id: 'after-lantern', requires: 'sc-look', mail: mail('after-lantern') }]);
    const h = game(content);
    advanceStory(h, content);
    expect(h.messages.some((m) => m.subject === 'after-lantern')).toBe(false);
    h.contracts.completed.push('sc-look');
    advanceStory(h, content);
    expect(h.messages.map((m) => m.subject)).toContain('after-lantern');
  });

  it('puts a story contract on the board and waits there until it is delivered', () => {
    const content = world([{ id: 'job', contractId: 'sc-take', mail: mail('job') }, { id: 'done', mail: mail('done') }]);
    const h = game(content);
    advanceStory(h, content);
    // The mission is offered on the board, and the story will not move on until it is done.
    expect(storyOffered(h)).toContain('sc-take');
    expect(availableContracts(h, content).map((c) => c.id)).toContain('sc-take');
    expect(h.messages.some((m) => m.subject === 'done')).toBe(false);
    // Deliver it, and the next beat follows at once.
    h.contracts.completed.push('sc-take');
    advanceStory(h, content);
    expect(storyOffered(h)).not.toContain('sc-take');
    expect(h.messages.map((m) => m.subject)).toContain('done');
  });

  it('does not offer a story contract the board has not reached yet', () => {
    const content = world([{ id: 'job', contractId: 'sc-take', mail: mail('job') }]);
    const h = game(content);
    // Before the beat arrives, the mission is nowhere on the board.
    expect(availableContracts(h, content).map((c) => c.id)).not.toContain('sc-take');
  });

  it('sets an enemy hacker on the player at a scripted beat', () => {
    const content = world([{ id: 'ambush', raid: 'thief', mail: mail('ambush') }, { id: 'after', minRating: 99, mail: mail('after') }]);
    const h = game(content, 10);
    advanceStory(h, content);
    // A story attack is scheduled, and the story passes on without waiting for its outcome.
    expect(h.raidPending?.attackerId).toBe('thief');
    expect(h.raidPending?.story).toBe(true);
    expect(h.messages.map((m) => m.subject)).toContain('ambush');
    expect(currentBeat(h, content)?.id).toBe('after');
  });

  it('runs a whole short act from start to finish', () => {
    const content = world([
      { id: 'b0', requires: 'sc-look', mail: mail('b0') },
      { id: 'b1', afterHours: 4, mail: mail('b1') },
      { id: 'b2', minRating: 20, contractId: 'sc-name', reveal: true, mail: mail('b2') },
    ]);
    const h = game(content, 25);
    h.contracts.completed.push('sc-look');
    advanceStory(h, content);
    // b1 is spaced four hours after b0, so it is still pending.
    expect(currentBeat(h, content)?.id).toBe('b1');
    pass(h, 5);
    advanceStory(h, content);
    // b2 posts the final mission; delivering it ends the act.
    expect(storyOffered(h)).toContain('sc-name');
    expect(storyComplete(h, content)).toBe(false);
    h.contracts.completed.push('sc-name');
    advanceStory(h, content);
    expect(storyComplete(h, content)).toBe(true);
    expect(currentBeat(h, content)).toBeUndefined();
  });

  it('fills {handle} in story mail so no raw token reaches the inbox', () => {
    const content = world([{ id: 'hello', mail: { from: 'Vesper', subject: 'Hi {handle}', body: '{handle}, welcome.' } }] as StoryDef['beats']);
    const state = game(content);
    state.player.handle = 'Ghost';
    advanceStory(state, content);
    expect(state.messages.length).toBeGreaterThan(0);
    for (const m of state.messages) expect(`${m.from} ${m.subject} ${m.body}`).not.toMatch(/\{\w+\}/);
    expect(state.messages.some((m) => m.body === 'Ghost, welcome.')).toBe(true);
  });
});
