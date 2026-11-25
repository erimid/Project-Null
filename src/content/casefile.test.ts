/**
 * The case file fills in only as the story is learned: nobody before they
 * are met, and the hidden name only as far as it has been found.
 */
import { describe, expect, it } from 'vitest';
import { caseFile, type GameState } from '../core';
import { beatPassed } from '../core/story';
import { casefile, contracts, linesOf, story } from './index';
import { content as played, fresh, play } from './storyPlay';

const content = { ...played, casefile };
const view = (state: GameState) => caseFile(state, content);

describe('the case file', () => {
  it('starts with only Wren, no threads, no choices and no name', () => {
    const file = view(fresh());
    expect(file.people.map((person) => person.name)).toEqual(['Wren']);
    expect(file.choices).toEqual([]);
    expect(file.name).toBeNull();
  });

  it('shows the name only as far as it is found, and whole only after it is read', () => {
    const state = fresh();
    play(state, {}, ['story-thename'], 30);
    expect(view(state).name).toBeNull();
    state.contracts.completed.push('story-thename');
    play(state, {}, ['act3-lines', 'act3-name'], 40);
    expect(beatPassed(state, 'the-name')).toBe(true);
    const part = view(state).name!;
    expect(part.blocks).toEqual(['PROJECT N', null, null, null]);
    expect(part.full).toBe(false);
    // The letters copied but not yet set in place stay loose, and the name stays short of whole.
    state.player.files.push({ name: 'ledger_line.dat', sizeGq: 1, from: 'ostrander-annex', takenMs: 0 });
    expect(view(state).name!.loose).toEqual(['U']);
    expect(view(state).name!.blocks.join('')).toBe('PROJECT N');
    play(state, {}, [], 80);
    const whole = view(state).name!;
    expect(whole.full).toBe(true);
    expect(whole.blocks.join('')).toBe('PROJECT NULL');
  });

  it('meets the people as the story does, and says what each side is waiting on', () => {
    const state = fresh();
    play(state, {}, [], 120);
    const file = view(state);
    for (const name of ['Wren', 'Vesper', 'Daylight', 'Ledger', 'Wick', 'Calder Re', 'Chorus']) expect(file.people.map((person) => person.name)).toContain(name);
    // Each person says the newest thing known about them.
    expect(file.people.find((person) => person.id === 'vesper')!.text).toMatch(/Wrote the file/);
    expect(file.threads.find((thread) => thread.id === 'main')).toBeDefined();
    // A finished side is closed.
    expect(file.threads.find((thread) => thread.id === 'vesper')!.open).toBe(false);
  });

  it('records the choices made at the end of jobs, one line each', () => {
    const state = fresh();
    const withChoices = contracts.find((contract) => contract.choices && contract.choices.length > 0 && contract.story)!;
    state.patrons.choices[withChoices.id] = withChoices.choices![0]!.id;
    const [choice] = view(state).choices;
    expect(choice).toMatchObject({ contractId: withChoices.id, title: withChoices.title });
    expect(choice!.text.length).toBeGreaterThan(0);
  });

  it('has a written sentence for every choice at the end of a job', () => {
    for (const contract of contracts.filter((item) => item.choices && item.choices.length > 0)) {
      const written = casefile.choices[contract.id] ?? {};
      for (const choice of contract.choices!) expect(written[choice.id], `${contract.id}/${choice.id}`).toBeTruthy();
      if (contract.decide) expect(written.default, `${contract.id}/default`).toBeTruthy();
    }
  });

  it('follows story lines that exist', () => {
    const ids = linesOf(story).map((line) => line.id);
    for (const thread of casefile.threads) expect(ids).toContain(thread.line);
  });
});
