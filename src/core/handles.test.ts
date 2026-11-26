import { describe, expect, it } from 'vitest';
import { handleAt } from './handles';

describe('handles to choose from', () => {
  it('are the same for the same seed and place in the list', () => {
    expect(handleAt(12, 3)).toBe(handleAt(12, 3));
    expect(handleAt(12, 3)).not.toBe(handleAt(12, 4));
  });

  it('are short, upper case, and never typed: letters, digits and underscores only', () => {
    for (let index = 0; index < 300; index++) {
      const handle = handleAt(99, index);
      expect(handle).toMatch(/^[A-Z][A-Z0-9_]{2,11}$/);
    }
  });

  it('vary: a few dozen spins hardly repeat', () => {
    const dealt = new Set(Array.from({ length: 40 }, (_, index) => handleAt(7, index)));
    expect(dealt.size).toBeGreaterThan(34);
  });

  it('never give the story word away, or a name someone else has', () => {
    const first = handleAt(5, 0);
    expect(handleAt(5, 0, [first.toLowerCase()])).not.toBe(first);
    for (let index = 0; index < 500; index++) expect(handleAt(3, index)).not.toMatch(/NULL/);
  });
});
