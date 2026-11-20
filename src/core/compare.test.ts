import { describe, expect, it } from 'vitest';
import { bestPace, compareProgram, programPace, speedShare, topVersion } from './compare';
import { createGame, syncWithContent, type GameState } from './index';
import type { ProgramDef } from '../content/schema';
import { content as testWorld } from './testWorld';

const make = (id: string, version: number, baseSeconds: number, sizeGq: number, extra: Partial<ProgramDef> = {}): ProgramDef => ({
  id,
  name: id,
  short: id,
  kind: 'breakPassword',
  version,
  baseSeconds,
  secondsPerGq: 0,
  price: 100,
  sizeGq,
  blurb: '',
  ...extra,
});

const v1 = make('breaker-1', 1, 16, 2);
const v2 = make('breaker-2', 2, 16, 4);
const v4 = make('breaker-4', 4, 16, 10);
const slim = make('slim', 2, 21, 2);
const brute = make('brute', 2, 9, 9);
const copier = make('copier', 1, 2, 1, { kind: 'copyFile', secondsPerGq: 1 });
const planner = make('planner', 1, 0, 1, { kind: 'planRoute' });
const content = { ...testWorld, programs: [v1, v2, v4, slim, brute, copier, planner] };

function game(owned: string[]): GameState {
  const state = syncWithContent(createGame({ seed: 5, handle: 'T', startDate: '2034-03-14T08:00:00Z', startingBalance: 0 }), content);
  state.player.programs = owned;
  return state;
}

describe('comparing programs on a shelf', () => {
  it('times a program on standard work, quicker with each version', () => {
    expect(programPace(v1)).toBe(16);
    expect(programPace(v2)).toBe(8);
    // File programs are timed on a 10 GB file.
    expect(programPace(copier)).toBe(12);
    expect(programPace(planner)).toBe(0);
  });

  it('measures speed against the quickest of the kind', () => {
    expect(bestPace(content, 'breakPassword')).toBe(4);
    expect(speedShare(content, v4)).toBe(1);
    expect(speedShare(content, v1)).toBe(0.25);
    expect(speedShare(content, planner)).toBeUndefined();
    expect(topVersion(content, 'breakPassword')).toBe(4);
    expect(topVersion(content, 'scan')).toBe(1);
  });

  it('calls a kind the player lacks an upgrade', () => {
    const result = compareProgram(game([]), content, v1);
    expect(result).toMatchObject({ owned: false, upgrade: true });
    expect(result.current).toBeUndefined();
  });

  it('says how much faster and bigger a higher version is', () => {
    const result = compareProgram(game(['breaker-1']), content, v2);
    expect(result.current?.id).toBe('breaker-1');
    expect(result).toMatchObject({ speed: 2, versions: 1, sizeGq: 2, upgrade: true });
  });

  it('does not call an owned, weaker or slower program an upgrade', () => {
    const state = game(['breaker-1', 'breaker-2']);
    expect(compareProgram(state, content, v2)).toMatchObject({ owned: true, upgrade: false });
    expect(compareProgram(state, content, v1)).toMatchObject({ owned: true, upgrade: false, versions: -1 });
    // Same version, slower but smaller: a side step, not a step up.
    const side = compareProgram(state, content, slim);
    expect(side.speed).toBeLessThan(1);
    expect(side).toMatchObject({ upgrade: false, sizeGq: -2 });
    // Same version and faster is a step up.
    expect(compareProgram(state, content, brute).upgrade).toBe(true);
  });

  it('has no speed to compare for programs that take no time', () => {
    const result = compareProgram(game(['planner']), content, { ...planner, id: 'planner-2', version: 2 });
    expect(result.speed).toBeUndefined();
    expect(result.upgrade).toBe(true);
  });
});
