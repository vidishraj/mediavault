import { describe, expect, it } from 'vitest';

import { toggleInSet } from './useSelection';

describe('toggleInSet', () => {
  it('adds an absent id and removes a present one, immutably', () => {
    const a = new Set<string>(['x']);
    const withY = toggleInSet(a, 'y');
    expect([...withY].sort()).toEqual(['x', 'y']);
    expect(a.has('y')).toBe(false); // original untouched

    const withoutX = toggleInSet(withY, 'x');
    expect(withoutX.has('x')).toBe(false);
    expect(withoutX.has('y')).toBe(true);
  });
});
