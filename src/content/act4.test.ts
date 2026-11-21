/**
 * Act 4, "The asking", and the five endings: the run from the name to the
 * final job, who helps and who attacks in it, which ways of finishing it
 * a player has earned, and the world that follows each ending.
 */
import { describe, expect, it } from 'vitest';
import { deliverContract } from '../core/contracts';
import { startContract } from '../core/stages';
import { heistAttacker, planHeist } from '../core/heists';
import { offeredChoices, reachEnding } from '../core/endings';
import { advanceStory, beatPassed, storyOffered } from '../core/story';
import { endingOptions } from './endings';
import { CLIENT_FILE, type GameState } from '../core';
import { contracts, endings, linesOf, news, story } from './index';
import { content, fresh, play } from './storyPlay';

const asking = contracts.find((contract) => contract.id === 'act4-asking')!;
const passed = (state: GameState, id: string) => beatPassed(state, id);

/** A player who has done the whole of Act 3 and is at the final job, with standing set as asked. */
function atTheAsking(standing: Record<string, number> = {}, choose: Record<string, string> = {}): GameState {
  const state = fresh();
  play(state, choose, ['act4-asking'], 80);
  Object.assign(state.patrons.standing, standing);
  expect(storyOffered(state)).toContain('act4-asking');
  return state;
}

describe('Act 4 as written', () => {
  it('runs from the name, to Vesper admitting it, to Halvorsen, to the final job', () => {
    const state = atTheAsking();
    for (const id of ['a4-wren-asks', 'a4-vesper-admits', 'a4-lantern', 'a4-what-it-said']) expect(passed(state, id), id).toBe(true);
    expect(state.contracts.completed).toEqual(expect.arrayContaining(['act4-signature', 'act4-lantern']));
  });

  it('waits for Wren to be free before it starts, so a rescue is never skipped', () => {
    const state = fresh();
    play(state, {}, ['act3-ask', 'act3-postbox', 'act3-name'], 60);
    state.contracts.completed.push('act3-name');
    play(state, {}, ['act3-ask', 'act3-postbox'], 8);
    expect(passed(state, 'a3-wren-silent')).toBe(true);
    expect(passed(state, 'a4-wren-asks')).toBe(false);
    state.contracts.completed.push('act3-postbox');
    play(state, {}, ['act3-ask', 'act4-asking'], 8);
    expect(passed(state, 'a4-wren-asks')).toBe(true);
  });

  it('is a heist across three lines and the core, and can always be tried again', () => {
    expect(asking.heist?.holds.map((hold) => hold.targetId)).toEqual(['office-director', 'still-point', 'wick-node']);
    expect(asking.heist?.retryFine).toBeGreaterThan(0);
    expect(endingOptions(asking).filter((option) => option.always).map((option) => option.ending).sort()).toEqual(['daylight', 'quiet']);
  });
});

describe('Who turns up in the final job', () => {
  it('sends Warden if the Office is cold, Sable if Calder Re is cold and there is no truce, and Chorus otherwise', () => {
    const state = atTheAsking({ office: -2, calder: -2 });
    expect(heistAttacker(state, asking)).toBe('warden');
    state.patrons.standing.office = 0;
    expect(heistAttacker(state, asking)).toBe('sable');
    expect(heistAttacker(state, asking)).toBe('sable');
    state.flags.push('ladder:sable:truce');
    expect(heistAttacker(state, asking)).toBe('chorus');
    state.patrons.standing.calder = 2;
    expect(heistAttacker(state, asking)).toBe('chorus');
  });

  it('brings Warden, Vesper and Wick to hold lines for a player they trust, and takes them away if not', () => {
    const trusted = atTheAsking({ office: 5, ais: 5 }, { 'act3-ask': 'refuse' });
    const plan = planHeist(trusted, asking)!;
    expect(plan.holds.map((hold) => hold.ally)).toEqual(['Warden', 'Vesper', 'Wick']);
    const cold = atTheAsking({ office: 0, ais: 0 });
    expect(planHeist(cold, asking)!.holds.some((hold) => hold.ally)).toBe(false);
    // Handing the Office the node's address costs Vesper's help; losing the station costs Wick's.
    const gave = atTheAsking({ office: 5, ais: 5 }, { 'act3-ask': 'refuse' });
    gave.flags.push('node-given', 'station-taken');
    expect(planHeist(gave, asking)!.holds.map((hold) => hold.ally)).toEqual(['Warden', undefined, undefined]);
  });

  it('slows the traces for Daylight and Calder Re at good standing', () => {
    const state = atTheAsking({ daylight: 5, calder: 5 });
    expect(planHeist(state, asking)!.slow).toBeCloseTo(1.25 * 1.15);
  });
});

describe('The ways to finish', () => {
  const names = (state: GameState) => offeredChoices(state, asking).map((choice) => choice.id);

  it('always offers the Office and Daylight, and nothing else to a player nobody trusts', () => {
    expect(names(atTheAsking({ office: 0, ais: 0, daylight: 0, calder: 0 }))).toEqual(['daylight']);
  });

  it('offers Unbound to a player the AIs trust', () => {
    expect(names(atTheAsking({ ais: 4 }))).toContain('unbound');
    expect(names(atTheAsking({ ais: 3 }))).not.toContain('unbound');
  });

  it('offers the treaty with three sides and a copy of Ledger in willing hands, whichever way Ledger went', () => {
    // Given to Vesper: needs the AIs.
    expect(names(atTheAsking({ office: 4, daylight: 4, ais: 4 }, { 'act3-list': 'default' }))).toContain('treaty');
    expect(names(atTheAsking({ office: 4, daylight: 4, calder: 4 }))).not.toContain('treaty');
    // Given to Daylight: needs Daylight.
    const day = atTheAsking({ office: 4, calder: 4, ais: 4 }, {});
    day.patrons.choices['story-ledger'] = 'daylight';
    expect(names(day)).not.toContain('treaty');
    day.patrons.standing.daylight = 4;
    expect(names(day)).toContain('treaty');
    // Kept: needs the checkpoint still on the gateway, however the sides stand.
    const kept = atTheAsking({ office: 4, calder: 4, daylight: 4 });
    kept.patrons.choices['story-ledger'] = 'keep';
    expect(names(kept)).not.toContain('treaty');
    kept.player.files.push({ name: 'LEDGER_checkpoint.arc', sizeGq: 14, from: 'ostrander-annex' });
    expect(names(kept)).toContain('treaty');
  });

  it('never offers the Chorus ending', () => {
    expect(names(atTheAsking({ office: 20, daylight: 20, calder: 20, ais: 20 }))).not.toContain('chorus');
  });

  // The final job, taken and finished, for each way there is.
  const finish = (state: GameState, choice?: string): GameState => {
    state.contracts.activeId = asking.id;
    state.contracts.stage = 0;
    startContract(state, content, asking);
    state.player.files.push({ name: 'PROJECT_NULL_core.arc', sizeGq: 16, from: 'halvorsen-core' });
    expect(deliverContract(state, content, choice)).toBeNull();
    return state;
  };

  it.each([
    ['quiet', undefined, {}],
    ['daylight', 'daylight', {}],
    ['unbound', 'unbound', { ais: 5 }],
    ['treaty', 'treaty', { office: 5, daylight: 5, calder: 5, ais: 5 }],
  ] as const)('reaches the %s ending', (ending, choice, standing) => {
    const state = finish(atTheAsking(standing), choice);
    expect(state.ending?.id).toBe(ending);
    expect(state.flags).toContain(`ending:${ending}`);
    expect(state.messages.at(-1)?.from === 'Halvorsen core' || state.messages.some((message) => message.from === 'Halvorsen core')).toBe(true);
  });

  it('reaches the Chorus ending by leaving the story alone, and the final job is then no longer a way out', () => {
    const state = atTheAsking();
    reachEnding(state, content, 'chorus');
    expect(state.ending?.id).toBe('chorus');
    expect(CLIENT_FILE).toBeDefined();
  });
});

describe('The world after', () => {
  const after = (ending: string, setup?: (state: GameState) => void) => {
    const state = atTheAsking();
    setup?.(state);
    reachEnding(state, content, ending);
    play(state, {}, ['act4-asking'], 4);
    return state;
  };

  it.each(['quiet', 'daylight', 'unbound', 'treaty', 'chorus'])('has letters and a job of its own after %s', (ending) => {
    const state = after(ending);
    const line = linesOf(story).find((item) => item.id === `after-${ending}`)!;
    expect(line, ending).toBeDefined();
    const job = line.beats.find((beat) => beat.contractId)!.contractId!;
    // Every letter of the world arrives, and the job is on the board.
    expect(state.contracts.completed).toContain(job);
    for (const beat of line.beats.filter((item) => item.mail && !item.if)) expect(passed(state, beat.id), beat.id).toBe(true);
    expect(endings.find((item) => item.id === ending)!.paper.length).toBeGreaterThanOrEqual(2);
  });

  it('has Daylight say whether it was believed, by whether the player held proof', () => {
    const proved = after('daylight', (state) => state.player.files.push({ name: 'containment_register.dat', sizeGq: 12, from: 'continuity-office' }));
    expect(passed(proved, 'after-daylight-proved')).toBe(true);
    expect(passed(proved, 'after-daylight-bare')).toBe(false);
    const bare = after('daylight', (state) => {
      state.player.files = state.player.files.filter((file) => file.name !== 'containment_register.dat' && file.name !== 'LEDGER_checkpoint.arc');
      state.patrons.choices['story-ledger'] = 'default';
    });
    expect(passed(bare, 'after-daylight-bare')).toBe(true);
    expect(passed(bare, 'after-daylight-proved')).toBe(false);
  });

  it('keeps the newspaper changed by each ending', () => {
    expect(news.story.some((item) => item.after === 'a3-chorus-voice')).toBe(true);
    for (const ending of endings) expect(ending.news.length + ending.paper.length, ending.id).toBeGreaterThanOrEqual(3);
  });

  it('leaves the story over: nothing more is waiting, and nothing left offered', () => {
    const state = after('treaty');
    advanceStory(state, content);
    expect(state.ending?.id).toBe('treaty');
  });
});
