import { describe, expect, it } from 'vitest';
import { isStoredScalar } from '../src/domain';
import * as q from '../src/rational';

describe('exact rational arithmetic and display boundary', () => {
  it('normalizes signs and zero, cross-cancels products, and rejects division by zero', () => {
    expect(q.rational(6n, -8n)).toEqual({ numerator: -3n, denominator: 4n });
    expect(q.rational(0n, -7n)).toEqual(q.ZERO);
    const huge = 10n ** 400n;
    expect(q.mul(q.rational(huge, 3n), q.rational(9n, huge))).toEqual(q.from(3));
    expect(q.add(q.rational(1n, 3n), q.rational(1n, 6n))).toEqual(q.rational(1n, 2n));
    expect(q.sub(q.from(0.3), q.add(0.1, 0.2))).toEqual(q.ZERO);
    expect(() => q.div(q.ONE, q.ZERO)).toThrow('ZERO_DENOMINATOR');
    expect(isStoredScalar({ numerator: '0', denominator: '2' })).toBe(false);
  });
  it('rounds finite display ratios without separately overflowing numerator and denominator', () => {
    const huge = 10n ** 400n;
    expect(q.toNumber(q.rational(huge + 1n, huge - 1n))).toBe(1);
    // Nearest binary64, with exact halfway values rounded to an even significand.
    expect(q.toNumber(q.rational(2n ** 53n + 1n, 2n ** 53n))).toBe(1);
    expect(q.toNumber(q.rational(2n ** 53n + 3n, 2n ** 53n))).toBe(1 + 2 ** -51);
    expect(q.toNumber(q.rational(1n, 2n ** 1074n))).toBe(Number.MIN_VALUE);
    expect(q.toNumber(q.rational(1n, 2n ** 1075n))).toBe(0);
    expect(q.sign(q.rational(1n, 2n ** 1075n))).toBe(1);
    for (const text of ['0.1', '1e-300', '1e300', '-2.75'])
      expect(q.toNumber(q.fromDecimal(text)!)).toBe(Number(text));
    expect(q.fixed(q.rational(-1n, 8n), 2)).toBe('-0.13');
    expect(q.exactText(q.rational(1n, 3n))).toBe('1/3');
  });
});
