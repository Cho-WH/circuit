import type { Exact, Q } from './exact';
import { RcFailure } from './types';

export type Interval = readonly [number, number];
const buffer = new DataView(new ArrayBuffer(8));
export function up(x: number): number {
  if (x === Infinity) return x;
  if (x === 0) return Number.MIN_VALUE;
  buffer.setFloat64(0, x);
  buffer.setBigUint64(0, buffer.getBigUint64(0) + (x > 0 ? 1n : -1n));
  return buffer.getFloat64(0);
}
export const down = (x: number) => -up(-x);
export const point = (x: number): Interval => [x, x];
export const iadd = (a: Interval, b: Interval): Interval => [down(a[0] + b[0]), up(a[1] + b[1])];
export const imul = (a: Interval, b: Interval): Interval => {
  const products = [a[0] * b[0], a[0] * b[1], a[1] * b[0], a[1] * b[1]];
  return [down(Math.min(...products)), up(Math.max(...products))];
};
export function idiv(a: Interval, b: Interval): Interval {
  if (b[0] <= 0 && b[1] >= 0)
    throw new RcFailure('RC_NUMERICAL_UNVERIFIED', 'interval-zero-divisor');
  return imul(a, [down(1 / b[1]), up(1 / b[0])]);
}
export const magnitude = (a: Interval) => Math.max(Math.abs(a[0]), Math.abs(a[1]));
export function enclose(e: Exact, x: Q): Interval {
  const value = e.q.toNumber(x);
  if (!Number.isFinite(value)) throw new RcFailure('RC_NUMERICAL_UNVERIFIED', 'float-range');
  const comparison = e.q.compare(e.fromFloat(value), x);
  return [comparison > 0 ? down(value) : value, comparison < 0 ? up(value) : value];
}
/** sqrt is checked against the exact input; no assumption about Math.sqrt rounding is needed. */
export function sqrtUpper(e: Exact, x: Q): number {
  if (e.q.sign(x) < 0) throw new RcFailure('RC_NUMERICAL_UNVERIFIED', 'negative-square-norm');
  if (e.q.sign(x) === 0) return 0;
  let value = Math.sqrt(enclose(e, x)[1]);
  for (let k = 0; k < 8; k++) {
    if (
      Number.isFinite(value) &&
      e.q.compare(e.q.mul(e.fromFloat(value), e.fromFloat(value)), x) >= 0
    )
      return value;
    value = up(value);
  }
  throw new RcFailure('RC_NUMERICAL_UNVERIFIED', 'sqrt-enclosure');
}

/** Enclose exp(-x) using a positive Taylor series and outward binary64 operations. */
function negativeExp(x: number): Interval {
  if (x === 0) return [1, 1];
  if (x >= 746) return [0, Number.MIN_VALUE];
  if (!(x > 0)) throw new RcFailure('RC_NUMERICAL_UNVERIFIED', 'negative-decay');
  const squarings = Math.max(0, Math.ceil(Math.log2(x / 0.125)));
  const s = idiv(point(x), point(2 ** squarings));
  let term: Interval = [1, 1],
    sum: Interval = [1, 1];
  for (let n = 1; n <= 16; n++) {
    term = idiv(imul(term, s), point(n));
    sum = iadd(sum, term);
  }
  const next = idiv(imul(term, s), point(17));
  const tail = up(next[1] / down(1 - up(s[1] / 18)));
  let result = idiv([1, 1], [sum[0], up(sum[1] + tail)]);
  for (let k = 0; k < squarings; k++) result = imul(result, result);
  return [Math.max(0, result[0]), Math.min(1, result[1])];
}
export function decay(rate: number, time: number): Interval {
  if (time === 0) return [1, 1];
  const product = imul(point(rate), point(time));
  return [negativeExp(Math.max(0, product[1]))[0], negativeExp(Math.max(0, product[0]))[1]];
}
