import type { Rational } from '../domain';

/** Unit-free decimal token; shared by input parsing and explicit number conversion. */
export function parseDecimal(input: string): { coefficient: bigint; power: number } | null {
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(input)) return null;
  const [mantissa, exponent = '0'] = input.toLowerCase().split('e');
  const power = Number(exponent) - (mantissa.split('.')[1]?.length ?? 0);
  if (!Number.isSafeInteger(power) || Math.abs(power) > 4096) return null;
  return { coefficient: BigInt(mantissa.replace('.', '')), power };
}
/** Correctly round an exact ratio to binary64 at the display boundary. */

export function binary64(v: Rational): number {
  let n = BigInt(v.numerator),
    d = BigInt(v.denominator);
  if (!n) return 0;
  const negative = n < 0n;
  if (negative) n = -n;
  let exponent = n.toString(2).length - d.toString(2).length;
  if (exponent >= 0 ? n < d << BigInt(exponent) : n << BigInt(-exponent) < d) exponent--;
  if (exponent > 1023) return negative ? -Infinity : Infinity;
  if (exponent < -1075) return negative ? -0 : 0;
  exponent = Math.max(exponent, -1022);
  const shift = 52 - exponent,
    numerator = shift >= 0 ? n << BigInt(shift) : n,
    denominator = shift >= 0 ? d : d << BigInt(-shift);
  let significand = numerator / denominator;
  const remainder = numerator % denominator;
  if (2n * remainder > denominator || (2n * remainder === denominator && significand % 2n === 1n))
    significand++;
  const result = Number(significand) * 2 ** (exponent - 52);
  return negative ? -result : result;
}
