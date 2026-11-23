/**
 * Act 3, "Four doors": the four lines and what they set going, the two
 * timed turns and how each is undone, and that the act can be played from
 * the opening letter to the moment the name is read, whichever way the
 * player goes.
 */
import { describe, expect, it } from 'vitest';
import { advanceStory, beatPassed, storyOffered } from '../core/story';
import { isTaken } from '../core/chorus';
import type { GameState } from '../core';
import { contracts, endings, linesOf, story } from './index';
import { HOUR, content, fresh, play } from './storyPlay';

const act3 = linesOf(story).flatMap((line) => line.beats.filter((beat) => beat.id.startsWith('a3-')));
const passed = (state: GameState, id: string) => beatPassed(state, id);

describe('Act 3 as written', () => {
  it('has the four doors and the lines that run beside them', () => {
    expect(linesOf(story).map((line) => line.id)).toEqual(expect.arrayContaining(['main', 'office', 'calder', 'daylight', 'wick', 'vesper', 'wren', 'rescue-wick', 'rescue-wren']));
    const jobs = contracts.filter((contract) => contract.id.startsWith('act3-'));
    expect(jobs.length).toBeGreaterThanOrEqual(12);
    // Every one is a story job, offered by exactly one beat.
    for (const job of jobs) {
      expect(job.story, job.id).toBe(true);
      expect(act3.filter((beat) => beat.contractId === job.id), job.id).toHaveLength(1);
    }
  });

  it('only waits on flags that something sets', () => {
    const set = new Set<string>();
    for (const beat of linesOf(story).flatMap((line) => line.beats)) {
      for (const flag of [...(beat.set ?? []), ...(beat.lapse?.set ?? [])]) set.add(flag);
      set.add(`story:${beat.id}`);
    }
    // The rules set these: a rewrite twist's flag, and an ending's own flag.
    for (const contract of contracts) {
      for (const stage of [{ targetId: contract.targetId, twists: contract.twists }, ...(contract.stages ?? [])]) {
        for (const twist of stage.twists ?? []) if (twist.kind === 'rewrite') set.add(`rewritten:${stage.targetId}/${twist.file}`);
      }
    }
    // The rules set these: an ending's own flag.
    for (const ending of endings) set.add(`ending:${ending.id}`);
    const wanted = new Set<string>();
    const note = (condition: { flags?: readonly string[]; notFlags?: readonly string[]; anyOf?: readonly unknown[]; atLeast?: { of: readonly unknown[] } } | undefined): void => {
      if (!condition) return;
      for (const flag of [...(condition.flags ?? []), ...(condition.notFlags ?? [])]) wanted.add(flag);
      for (const inner of condition.anyOf ?? []) note(inner as never);
      for (const inner of condition.atLeast?.of ?? []) note(inner as never);
    };
    for (const line of linesOf(story)) {
      note(line.when);
      for (const beat of line.beats) {
        note(beat.when);
        note(beat.if);
      }
    }
    for (const flag of wanted) expect(set.has(flag), flag).toBe(true);
  });

  it('wakes Chorus and takes two machines when the act opens', () => {
    const state = fresh();
    play(state, {}, [], 14);
    expect(passed(state, 'a3-ways')).toBe(true);
    expect(state.flags).toContain('chorus-awake');
    expect(isTaken(state, 'taken-grid')).toBe(true);
    expect(isTaken(state, 'taken-relay')).toBe(true);
  });
});

describe('Act 3 played through', () => {
  it('can be finished by a player who does every job, whatever they chose', () => {
    for (const choose of [{} as Record<string, string>, { 'act3-ask': 'refuse', 'act3-acquire': 'vesper', 'act3-list': 'keep' }, { 'act3-acquire': 'dud', 'act3-list': 'office' }]) {
      const state = fresh();
      play(state, choose);
      for (const id of ['a3-ways', 'a3-office-hire', 'a3-office-lock', 'a3-office-ask', 'a3-calder-hire', 'a3-calder-acq', 'a3-day-hire', 'a3-day-guard', 'a3-day-list', 'a3-wick-ask', 'a3-wren-1', 'a3-wren-2', 'a3-wren-3', 'a3-wren-4', 'a3-chorus-voice', 'a3-v-lines', 'a3-name', 'a3-opened', 'a3-wren-explains']) {
        expect(passed(state, id), `${id} (${JSON.stringify(choose)})`).toBe(true);
      }
      // The ways the player went each get their answer, and the others none.
      expect(passed(state, 'a3-office-gave')).toBe(choose['act3-ask'] === undefined);
      expect(passed(state, 'a3-office-refused')).toBe(choose['act3-ask'] === 'refuse');
      expect(passed(state, 'a3-calder-thanks')).toBe(choose['act3-acquire'] === undefined);
      expect(passed(state, 'a3-calder-cold')).toBe(choose['act3-acquire'] === 'vesper');
      expect(passed(state, 'a3-calder-dud')).toBe(choose['act3-acquire'] === 'dud');
      expect(passed(state, 'a3-day-given')).toBe(choose['act3-list'] === undefined);
      expect(passed(state, 'a3-day-kept')).toBe(choose['act3-list'] === 'keep');
      expect(passed(state, 'a3-day-sold')).toBe(choose['act3-list'] === 'office');
      // The player never read about the rescue lines, and Wren and the station are both fine.
      expect(state.flags).not.toContain('station-taken');
      expect(state.flags).not.toContain('wren-caught');
      expect(passed(state, 'a3-wren-silent')).toBe(false);
    }
  });

  it('does not end until the three lines are in, and Wick and Daylight have been seen', () => {
    for (const missing of ['act3-lines', 'act3-clerk', 'act3-witnesses']) {
      const state = fresh();
      play(state, {}, [missing], 30);
      expect(passed(state, 'a3-name'), missing).toBe(false);
      expect(storyOffered(state)).toContain(missing);
    }
  });

  it('lets Chorus take the station if Wick is left alone, and gives it back for a rescue', () => {
    const state = fresh();
    play(state, {}, ['act3-clerk'], 8);
    expect(passed(state, 'a3-wick-ask')).toBe(false);
    // Three game days of being ignored: Wick says, gently, that time is short. Nothing is lost yet.
    state.clock.gameTimeMs += 80 * HOUR;
    advanceStory(state, content);
    expect(state.messages.filter((message) => message.from === 'Wick').at(-1)?.subject).toBe('something is answering the request line');
    expect(state.flags).not.toContain('station-taken');
    // Two more, and the station goes.
    state.clock.gameTimeMs += 50 * HOUR;
    advanceStory(state, content);
    expect(state.flags).toContain('station-taken');
    expect(isTaken(state, 'wick-node')).toBe(true);
    // The rescue is on the board, and the ask for the clerk is still there too.
    advanceStory(state, content);
    state.clock.gameTimeMs += 2 * HOUR;
    advanceStory(state, content);
    expect(storyOffered(state)).toEqual(expect.arrayContaining(['act3-deadair', 'act3-clerk']));
    state.contracts.completed.push('act3-deadair');
    advanceStory(state, content);
    expect(state.flags).not.toContain('station-taken');
    expect(isTaken(state, 'wick-node')).toBe(false);
    expect(passed(state, 'a3-rescue-wick')).toBe(true);
  });

  it('lets the Office catch Wren if its request is left unanswered, and a rescue undoes it', () => {
    const state = fresh();
    play(state, {}, ['act3-ask', 'act3-postbox'], 30);
    expect(passed(state, 'a3-wick-ask')).toBe(true);
    // Left for five days, after a warning from Wren: the Office has the post box. Wren's letters stop where they are.
    expect(state.flags).toContain('wren-caught');
    const lettersBefore = state.messages.filter((message) => message.from === 'Wren').length;
    expect(storyOffered(state)).toContain('act3-postbox');
    state.contracts.completed.push('act3-postbox');
    advanceStory(state, content);
    expect(state.flags).not.toContain('wren-caught');
    // And once she is free, her letters go on.
    for (let step = 0; step < 40; step++) {
      state.clock.gameTimeMs += 12 * HOUR;
      advanceStory(state, content);
    }
    expect(state.messages.filter((message) => message.from === 'Wren').length).toBeGreaterThan(lettersBefore);
    expect(passed(state, 'a3-wren-4')).toBe(true);
  });

  it('has Vesper say what Wren would if Wren is not free when the name is read', () => {
    const state = fresh();
    play(state, {}, ['act3-ask', 'act3-postbox', 'act3-name'], 60);
    expect(state.flags).toContain('wren-caught');
    expect(storyOffered(state)).toContain('act3-name');
    state.contracts.completed.push('act3-name');
    play(state, {}, ['act3-ask', 'act3-postbox'], 4);
    expect(passed(state, 'a3-name')).toBe(true);
    expect(passed(state, 'a3-wren-silent')).toBe(true);
    expect(passed(state, 'a3-wren-explains')).toBe(false);
  });

  it('says "it opened" only once it has: the offer asks, and the answer comes after the job', () => {
    const state = fresh();
    play(state, {}, ['act3-name'], 60);
    expect(storyOffered(state)).toContain('act3-name');
    const subjects = () => state.messages.filter((message) => message.from === 'Vesper').map((message) => message.subject);
    expect(subjects()).toContain('bring them home');
    expect(subjects()).not.toContain('it opened');
    state.contracts.completed.push('act3-name');
    play(state, {}, [], 4);
    expect(subjects()).toContain('it opened');
  });
});
