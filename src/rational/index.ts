export { createArithmetic, type ArithmeticMonitor } from './arithmetic';
export { parseDecimal } from './conversion';
export type { Rational, StoredScalar } from '../domain';
export type { Scalar } from './arithmetic';
import { createArithmetic } from './arithmetic';
export const {
  ZERO,
  ONE,
  rational,
  fromDecimal,
  from,
  isRational,
  store,
  neg,
  abs,
  sign,
  add,
  sub,
  mul,
  div,
  compare,
  equal,
  sum,
  clamp,
  toNumber,
  decimalExponent,
  power10,
  fixed,
  exactText,
  trimDecimal,
  direction,
} = createArithmetic();
