import * as q from '../rational';
import { isStoredScalar, type StoredScalar } from '../domain';
/** Pure SI input and display. Formatting never changes a stored physical value. */
export type QuantityUnit = 'Ω' | 'V' | 'A' | '';
export interface ParsedQuantity {
  value: StoredScalar;
  fraction?: string;
}
export type QuantityMode = 'auto' | 'scientific' | 'plain';
export interface QuantityFormatOptions {
  mode?: QuantityMode;
}
export const defaultQuantityFormat: Readonly<QuantityFormatOptions> = Object.freeze({
  mode: 'auto',
});
export const scalarPattern = '[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?';
const prefixes = [
  { power: -12, prefix: 'p' },
  { power: -9, prefix: 'n' },
  { power: -6, prefix: 'μ' },
  { power: -3, prefix: 'm' },
  { power: 0, prefix: '' },
  { power: 3, prefix: 'k' },
  { power: 6, prefix: 'M' },
] as const;
const powers: Record<string, number> = Object.fromEntries(prefixes.map((p) => [p.prefix, p.power]));
powers.u = powers.µ = -6;
const pattern = new RegExp(
  '^\\s*(' +
    scalarPattern +
    ')(?:\\s*[/⁄]\\s*(' +
    scalarPattern +
    '))?\\s*([pnumkMμµ]?)\\s*(Ω|ohm|V|A)?\\s*$',
);

function decimalText(coefficient: bigint, power: number): string {
  if (coefficient === 0n) return '0';
  const sign = coefficient < 0n ? '-' : '';
  const digits = (coefficient < 0n ? -coefficient : coefficient).toString();
  const point = digits.length + power;
  const raw =
    point <= 0
      ? '0.' + '0'.repeat(-point) + digits
      : point >= digits.length
        ? digits + '0'.repeat(point - digits.length)
        : digits.slice(0, point) + '.' + digits.slice(point);
  return sign + (raw.includes('.') ? raw.replace(/0+$/, '').replace(/\.$/, '') : raw);
}
export function parseQuantity(input: string, unit: QuantityUnit): ParsedQuantity | null {
  if (input.length > 256) return null;
  const match = input.match(pattern);
  if (!match) return null;
  if (match[4] && !(unit === 'Ω' ? ['Ω', 'ohm'] : [unit]).includes(match[4])) return null;
  const a = q.parseDecimal(match[1]),
    b = q.parseDecimal(match[2] ?? '1');
  if (!a || !b || b.coefficient === 0n) return null;
  const power = a.power - b.power + powers[match[3]];
  const n = a.coefficient * (power >= 0 ? 10n ** BigInt(power) : 1n);
  const d = b.coefficient * (power < 0 ? 10n ** BigInt(-power) : 1n);
  const value = q.store(q.rational(n, d));
  if (unit === 'Ω' && q.sign(value) < 0) return null;
  if (match[2] === undefined) return { value };
  const sign = b.coefficient < 0n ? -1n : 1n;
  const fraction =
    decimalText(a.coefficient * sign, a.power) +
    '/' +
    decimalText(b.coefficient * sign, b.power) +
    (match[3] ? ' ' + match[3] : '');
  // Keep persisted notation within the same parser limit, even for extreme exponents.
  const compact = (s: string) => s.replace(/^\+/, '');
  const saved =
    fraction.length <= 256
      ? fraction
      : compact(
          sign < 0n
            ? match[1].startsWith('-')
              ? match[1].slice(1)
              : '-' + match[1].replace(/^\+/, '')
            : match[1],
        ) +
        '/' +
        compact(match[2].replace(/^[-+]/, '')) +
        (match[3] ? ' ' + match[3] : '');
  return { value, fraction: saved };
}
export function storedFraction(
  properties: Record<string, unknown>,
  key: string,
  unit: QuantityUnit,
): string | undefined {
  const input = properties[key + 'Fraction'];
  if (typeof input !== 'string') return undefined;
  const parsed = parseQuantity(input, unit);
  const value = properties[key];
  return parsed?.fraction && isStoredScalar(value) && q.equal(parsed.value, value)
    ? parsed.fraction
    : undefined;
}
/** Exact editable text, separate from rounded readouts and raw CSV values. */
export function quantityInput(value: q.Scalar): string {
  const text = q.exactText(value);
  if (text.length <= 256) return text;
  const compact = (decimal: string) => {
    const [whole, fraction = ''] = decimal.split('.');
    const digits = whole + fraction;
    const coefficient = digits.replace(/0+$/, '');
    const power = digits.length - coefficient.length - fraction.length;
    const significant = coefficient.replace(/^(-?)0+/, '$1');
    return power ? `${significant}e${power}` : significant;
  };
  const candidate = text.split('/').map(compact).join('/');
  return parseQuantity(candidate, '') ? candidate : text;
}
/** Number arguments are display geometry; exact arguments retain all stored digits. */
export function plainNumber(value: q.Scalar): string {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '—';
    const parsed = q.parseDecimal(String(value));
    return parsed ? decimalText(parsed.coefficient, parsed.power) : '—';
  }
  const text = q.exactText(value);
  return text.includes('/')
    ? q.trimDecimal(q.fixed(value, Math.max(0, 15 - q.decimalExponent(value))))
    : text;
}
function scientific(value: q.Scalar): string {
  if (!q.sign(value)) return '0';
  let exponent = q.decimalExponent(value),
    mantissa = q.fixed(q.div(value, q.power10(exponent)), 3);
  if (mantissa.replace('-', '').startsWith('10.')) {
    exponent++;
    mantissa = q.fixed(q.div(value, q.power10(exponent)), 3);
  }
  const superDigits: Record<string, string> = {
    '-': '⁻',
    '0': '⁰',
    '1': '¹',
    '2': '²',
    '3': '³',
    '4': '⁴',
    '5': '⁵',
    '6': '⁶',
    '7': '⁷',
    '8': '⁸',
    '9': '⁹',
  };
  return mantissa + ' × 10' + [...String(exponent)].map((c) => superDigits[c]).join('');
}
function valid(value: q.Scalar | undefined): value is q.Scalar {
  return value !== undefined && (typeof value !== 'number' || Number.isFinite(value));
}
export function createQuantityScale(
  values: readonly q.Scalar[],
  unit: string,
  options: QuantityFormatOptions = defaultQuantityFormat,
) {
  const mode = options.mode ?? 'auto';
  const magnitude = values
    .filter(valid)
    .reduce<q.Rational>((max, v) => (q.compare(q.abs(v), max) > 0 ? q.abs(v) : max), q.ZERO);
  const exponent = q.decimalExponent(magnitude),
    outside = q.sign(magnitude) !== 0 && (exponent < -12 || exponent >= 9);
  let power =
    mode === 'auto' && q.sign(magnitude)
      ? Math.max(-12, Math.min(6, Math.floor(exponent / 3) * 3))
      : 0;
  if (
    mode === 'auto' &&
    power < 6 &&
    Number(q.fixed(q.div(magnitude, q.power10(power)), 2)) >= 1000
  )
    power += 3;
  if (outside) power = 0;
  const prefix = mode === 'auto' ? prefixes.find((p) => p.power === power)!.prefix : '';
  return {
    unit: prefix + unit,
    format(value: q.Scalar | undefined): string {
      if (!valid(value)) return '—';
      const prefix = q.from(value).approximation ? '≈ ' : '';
      if (mode === 'scientific' || (mode === 'auto' && outside)) return prefix + scientific(value);
      if (mode === 'plain') return prefix + plainNumber(value);
      const scaled = q.div(value, q.power10(power)),
        text = q.trimDecimal(q.fixed(scaled, 2));
      return prefix + (text === '0' && q.sign(value) !== 0 ? scientific(scaled) : text);
    },
  };
}
export function formatQuantity(
  value: q.Scalar | undefined,
  unit: string,
  options: QuantityFormatOptions = defaultQuantityFormat,
): string {
  const scale = createQuantityScale(value === undefined ? [] : [value], unit, options);
  return (scale.format(value) + ' ' + scale.unit).trimEnd();
}

export function isQuantityMode(value: unknown): value is QuantityMode {
  return value === 'auto' || value === 'scientific' || value === 'plain';
}
export function quantityFormatFor(
  properties?: Record<string, unknown>,
  fallback: QuantityFormatOptions = defaultQuantityFormat,
): QuantityFormatOptions {
  return isQuantityMode(properties?.quantityMode) ? { mode: properties.quantityMode } : fallback;
}
