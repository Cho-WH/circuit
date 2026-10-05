/** Exact SI values: JSON data and runtime arithmetic have distinct representations. */
export interface Rational {
  readonly numerator: bigint;
  readonly denominator: bigint;
  readonly approximation?: Approximation;
}
export interface StoredScalar {
  numerator: string;
  denominator: string;
  approximation?: Approximation;
}
/** Absent on exact scalars. Error is an absolute SI uncertainty estimate. */
export interface Approximation {
  reason: 'integer-limit' | 'operation-limit';
  policy: 'dc-budget-1';
  absoluteError: number;
}
export function validApproximation(value: unknown): value is Approximation {
  if (!value || typeof value !== 'object') return false;
  const v = value as Approximation;
  return (
    (v.reason === 'integer-limit' || v.reason === 'operation-limit') &&
    v.policy === 'dc-budget-1' &&
    Number.isFinite(v.absoluteError) &&
    v.absoluteError >= 0
  );
}
export type ComponentProperties = Record<string, number | string | boolean | StoredScalar>;
export const physicalProperties = [
  'voltageV',
  'resistanceOhm',
  'resistanceMinOhm',
  'resistanceMaxOhm',
  'sourceResistanceOhm',
  'diodeThresholdV',
  'diodeOnResistanceOhm',
] as const;
function scalarData(n: bigint, d = 1n): StoredScalar {
  if (d === 0n) throw new RangeError('ZERO_DENOMINATOR');
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  let a = n < 0n ? -n : n,
    b = d;
  while (b) {
    const r = a % b;
    a = b;
    b = r;
  }
  return { numerator: String(n / a), denominator: String(d / a) };
}
export function isStoredScalar(value: unknown): value is StoredScalar {
  if (!value || typeof value !== 'object') return false;
  const v = value as StoredScalar;
  if (
    typeof v.numerator !== 'string' ||
    typeof v.denominator !== 'string' ||
    (v.approximation !== undefined && !validApproximation(v.approximation)) ||
    !/^(0|-?[1-9]\d*)$/.test(v.numerator) ||
    !/^[1-9]\d*$/.test(v.denominator)
  )
    return false;
  const canonical = scalarData(BigInt(v.numerator), BigInt(v.denominator));
  return canonical.numerator === v.numerator && canonical.denominator === v.denominator;
}
