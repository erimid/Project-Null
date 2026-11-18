import { describe, expect, it } from 'vitest';
import { createRng, hashSeed, restoreRng } from './rng';

const take = (n: number, f: () => number) => Array.from({ length: n }, f);

describe('seeded rng', () => {
  it('gives the same sequence for the same seed', () => {
    const a = createRng(1234);
    const b = createRng(1234);
    expect(take(50, a.next)).toEqual(take(50, b.next));
  });

  it('gives different sequences for different seeds', () => {
    const a = createRng(1);
    const b = createRng(2);
    expect(take(10, a.next)).not.toEqual(take(10, b.next));
  });

  it('accepts text seeds', () => {
    expect(take(5, createRng('lantern').next)).toEqual(take(5, createRng('lantern').next));
    expect(hashSeed('lantern')).not.toBe(hashSeed('lanterm'));
  });

  it('stays the same across releases (golden values)', () => {
    // If this fails, the algorithm changed and old saves would replay differently.
    const rng = createRng(42);
    expect(take(3, () => rng.int(0, 999_999))).toEqual([601_103, 448_290, 852_465]);
  });

  it('keeps next() inside [0, 1) and roughly uniform', () => {
    const rng = createRng('uniform');
    const values = take(20_000, rng.next);
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...values)).toBeLessThan(1);
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    expect(mean).toBeGreaterThan(0.48);
    expect(mean).toBeLessThan(0.52);
  });

  it('int() covers both ends of its range and nothing outside', () => {
    const rng = createRng(7);
    const seen = new Set(take(2_000, () => rng.int(3, 6)));
    expect([...seen].sort()).toEqual([3, 4, 5, 6]);
    expect(() => rng.int(5, 4)).toThrow(RangeError);
    expect(() => rng.int(0.5, 4)).toThrow(RangeError);
  });

  it('range() stays inside its bounds', () => {
    const rng = createRng(8);
    for (const v of take(1_000, () => rng.range(-2, 2))) {
      expect(v).toBeGreaterThanOrEqual(-2);
      expect(v).toBeLessThan(2);
    }
  });

  it('chance() respects 0 and 1', () => {
    const rng = createRng(9);
    expect(take(200, () => Number(rng.chance(0))).every((v) => v === 0)).toBe(true);
    expect(take(200, () => Number(rng.chance(1))).every((v) => v === 1)).toBe(true);
  });

  it('pick() returns list members and rejects an empty list', () => {
    const rng = createRng(10);
    const items = ['a', 'b', 'c'] as const;
    for (let i = 0; i < 100; i++) expect(items).toContain(rng.pick(items));
    expect(() => rng.pick([])).toThrow(RangeError);
  });

  it('shuffle() keeps every item and leaves the input alone', () => {
    const rng = createRng(11);
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    const frozen = input.slice();
    const out = rng.shuffle(input);
    expect(input).toEqual(frozen);
    expect(out.slice().sort((a, b) => a - b)).toEqual(frozen);
    expect(createRng(11).shuffle(input)).toEqual(out);
  });

  it('resumes exactly from a saved state', () => {
    const rng = createRng('save-me');
    take(17, rng.next);
    const saved = JSON.parse(JSON.stringify(rng.getState()));
    const expected = take(20, rng.next);
    expect(take(20, restoreRng(saved).next)).toEqual(expected);
  });

  it('fork() gives independent, repeatable streams without advancing the parent', () => {
    const parent = createRng(99);
    const before = parent.getState();
    const trace = parent.fork('trace');
    const world = parent.fork('world');
    expect(parent.getState()).toEqual(before);
    const traceValues = take(10, trace.next);
    expect(traceValues).not.toEqual(take(10, world.next));
    expect(take(10, createRng(99).fork('trace').next)).toEqual(traceValues);
  });
});
