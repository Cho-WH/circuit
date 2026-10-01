import { validApproximation, type Rational, type StoredScalar } from '../domain';
import { parseDecimal, binary64 } from './conversion';

export type Scalar = Rational | StoredScalar | number;
export const ZERO: Rational = Object.freeze({ numerator: 0n, denominator: 1n });
export const ONE: Rational = Object.freeze({ numerator: 1n, denominator: 1n });
export interface ArithmeticMonitor {
  integer(value: bigint): void;
  remainder(): void;
}
export function createArithmetic(monitor?: ArithmeticMonitor) {
  function gcd(a: bigint, b: bigint): bigint {
    monitor?.integer(a);
    monitor?.integer(b);
    a = a < 0n ? -a : a;
    while (b) {
      monitor?.remainder();
      const r = a % b;
      a = b;
      b = r;
    }
    return a;
  }
  function rational(n: bigint, d = 1n): Rational {
    monitor?.integer(n);
    monitor?.integer(d);
    if (d === 0n) throw new RangeError('ZERO_DENOMINATOR');
    if (!n) return ZERO;
    if (d < 0n) {
      n = -n;
      d = -d;
    }
    const g = gcd(n, d);
    return Object.freeze({ numerator: n / g, denominator: d / g });
  }
  /** Parse a decimal token exactly; unit and fraction syntax belongs to quantity. */
  function fromDecimal(text: string): Rational | null {
    const parts = parseDecimal(text);
    if (!parts) return null;
    const { coefficient, power } = parts;
    return rational(
      coefficient * (power >= 0 ? 10n ** BigInt(power) : 1n),
      power < 0 ? 10n ** BigInt(-power) : 1n,
    );
  }
  function from(value: Scalar): Rational {
    if (typeof value === 'number') {
      const parsed = fromDecimal(String(value));
      if (!parsed) throw new RangeError('INVALID_SCALAR');
      return parsed;
    }
    return typeof value.numerator === 'bigint'
      ? (value as Rational)
      : withError(
          rational(BigInt(value.numerator), BigInt(value.denominator)),
          value,
          value.approximation?.absoluteError ?? 0,
        );
  }
  function isRational(value: unknown): value is Rational {
    if (!value || typeof value !== 'object') return false;
    const v = value as Rational;
    return (
      typeof v.numerator === 'bigint' &&
      typeof v.denominator === 'bigint' &&
      v.denominator > 0n &&
      (v.approximation === undefined || validApproximation(v.approximation)) &&
      gcd(v.numerator, v.denominator) === 1n
    );
  }
  function store(value: Scalar): StoredScalar {
    const v = from(value);
    return {
      numerator: String(v.numerator),
      denominator: String(v.denominator),
      ...(v.approximation ? { approximation: v.approximation } : {}),
    };
  }
  function neg(value: Scalar): Rational {
    const v = from(value);
    return withError(rational(-v.numerator, v.denominator), v, v.approximation?.absoluteError ?? 0);
  }
  function abs(value: Scalar): Rational {
    const v = from(value);
    return v.numerator < 0n ? neg(v) : v;
  }
  function sign(value: Scalar): -1 | 0 | 1 {
    const n = from(value).numerator;
    return n < 0n ? -1 : n > 0n ? 1 : 0;
  }
  function add(left: Scalar, right: Scalar): Rational {
    const a = from(left),
      b = from(right),
      g = gcd(a.denominator, b.denominator);
    return withError(
      rational(
        a.numerator * (b.denominator / g) + b.numerator * (a.denominator / g),
        a.denominator * (b.denominator / g),
      ),
      a.approximation ? a : b,
      (a.approximation?.absoluteError ?? 0) + (b.approximation?.absoluteError ?? 0),
    );
  }
  function sub(a: Scalar, b: Scalar): Rational {
    return add(a, neg(b));
  }
  function mul(left: Scalar, right: Scalar): Rational {
    const a = from(left),
      b = from(right),
      g = gcd(a.numerator, b.denominator),
      h = gcd(b.numerator, a.denominator);
    return withError(
      rational((a.numerator / g) * (b.numerator / h), (a.denominator / h) * (b.denominator / g)),
      a.approximation ? a : b,
      a.approximation || b.approximation
        ? Math.abs(toNumber(a)) * (b.approximation?.absoluteError ?? 0) +
            Math.abs(toNumber(b)) * (a.approximation?.absoluteError ?? 0) +
            (a.approximation?.absoluteError ?? 0) * (b.approximation?.absoluteError ?? 0)
        : 0,
    );
  }
  function div(left: Scalar, right: Scalar): Rational {
    const b = from(right);
    const error = b.approximation?.absoluteError ?? 0,
      magnitude = b.approximation ? Math.abs(toNumber(b)) : 0;
    return mul(
      left,
      withError(
        rational(b.denominator, b.numerator),
        b,
        b.approximation ? error / (magnitude * (magnitude - error)) : 0,
      ),
    );
  }
  function compare(left: Scalar, right: Scalar): -1 | 0 | 1 {
    const a = from(left),
      b = from(right),
      leftProduct = a.numerator * b.denominator,
      rightProduct = b.numerator * a.denominator;
    monitor?.integer(leftProduct);
    monitor?.integer(rightProduct);
    const d = leftProduct - rightProduct;
    monitor?.integer(d);
    return d < 0n ? -1 : d > 0n ? 1 : 0;
  }
  function equal(a: Scalar, b: Scalar): boolean {
    return compare(a, b) === 0;
  }
  function sum(values: readonly Scalar[]): Rational {
    return values.reduce<Rational>((s, v) => add(s, v), ZERO);
  }
  function clamp(v: Scalar, min: Scalar, max: Scalar): Rational {
    return from(compare(v, min) < 0 ? min : compare(v, max) > 0 ? max : v);
  }
  /** Correctly rounded binary64 for geometry, never a physical source of truth. */
  function toNumber(value: Scalar): number {
    return binary64(from(value));
  }
  function decimalExponent(value: Scalar): number {
    const v = abs(value);
    if (!v.numerator) return 0;
    let e = v.numerator.toString().length - v.denominator.toString().length;
    if (
      e >= 0
        ? v.numerator < v.denominator * 10n ** BigInt(e)
        : v.numerator * 10n ** BigInt(-e) < v.denominator
    )
      e--;
    return e;
  }
  function power10(e: number): Rational {
    return e >= 0 ? rational(10n ** BigInt(e)) : rational(1n, 10n ** BigInt(-e));
  }
  /** Decimal rounding at presentation only, ties away from zero. */
  function fixed(value: Scalar, digits: number): string {
    const v = div(abs(value), power10(-digits));
    let n = v.numerator / v.denominator;
    if ((v.numerator % v.denominator) * 2n >= v.denominator) n++;
    let text = n.toString();
    if (digits > 0) {
      text = text.padStart(digits + 1, '0');
      text = text.slice(0, -digits) + '.' + text.slice(-digits);
    } else if (digits < 0) text += '0'.repeat(-digits);
    return sign(value) < 0 && n !== 0n ? '-' + text : text;
  }
  function exactText(value: Scalar): string {
    const v = from(value);
    let d = v.denominator,
      twos = 0,
      fives = 0;
    while (d % 2n === 0n) {
      d /= 2n;
      twos++;
    }
    while (d % 5n === 0n) {
      d /= 5n;
      fives++;
    }
    if (d !== 1n) return `${v.numerator}/${v.denominator}`;
    return trimDecimal(fixed(v, Math.max(twos, fives)));
  }
  function trimDecimal(text: string): string {
    return text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text;
  }

  function withError(value: Rational, source: Rational | StoredScalar, error: number): Rational {
    return source.approximation
      ? {
          ...value,
          approximation: {
            ...source.approximation,
            absoluteError: Number.isFinite(error) && error >= 0 ? error : Number.MAX_VALUE,
          },
        }
      : value;
  }
  function direction(value: Scalar): -1 | 0 | 1 | undefined {
    const v = from(value);
    return v.approximation && Math.abs(toNumber(v)) <= v.approximation.absoluteError
      ? undefined
      : sign(v);
  }
  return {
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
  };
}
