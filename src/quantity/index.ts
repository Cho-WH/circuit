/** Pure SI input and display. Formatting never changes a stored physical value. */
export type QuantityUnit = 'Ω' | 'V' | 'A' | '';
export interface ParsedQuantity {
  value: number;
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

function decimal(text: string) {
  const [mantissa, exponent = '0'] = text.toLowerCase().split('e');
  const power = Number(exponent) - (mantissa.split('.')[1]?.length ?? 0);
  if (!Number.isSafeInteger(power) || Math.abs(power) > 4096) return null;
  return { coefficient: BigInt(mantissa.replace('.', '')), power };
}
function ratioNumber(n: bigint, d: bigint): number {
  if (n === 0n) return 0;
  const negative = n < 0n !== d < 0n;
  n = n < 0n ? -n : n;
  d = d < 0n ? -d : d;
  let exponent = n.toString(2).length - d.toString(2).length;
  if (exponent >= 0 ? n < d << BigInt(exponent) : n << BigInt(-exponent) < d) exponent--;
  if (exponent > 1023) return negative ? -Infinity : Infinity;
  if (exponent < -1075) return negative ? -0 : 0;
  // Round the exact rational once to the nearest binary64 significand, ties to even.
  exponent = Math.max(exponent, -1022);
  const shift = 52 - exponent;
  const numerator = shift >= 0 ? n << BigInt(shift) : n;
  const denominator = shift >= 0 ? d : d << BigInt(-shift);
  let significand = numerator / denominator;
  const remainder = numerator % denominator;
  if (2n * remainder > denominator || (2n * remainder === denominator && significand % 2n === 1n))
    significand++;
  const value = Number(significand) * 2 ** (exponent - 52);
  return negative ? -value : value;
}
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
  const a = decimal(match[1]),
    b = decimal(match[2] ?? '1');
  if (!a || !b || b.coefficient === 0n) return null;
  const power = a.power - b.power + powers[match[3]];
  const n = a.coefficient * (power >= 0 ? 10n ** BigInt(power) : 1n);
  const d = b.coefficient * (power < 0 ? 10n ** BigInt(-power) : 1n);
  const value = ratioNumber(n, d);
  if (!Number.isFinite(value) || (n !== 0n && value === 0) || (unit === 'Ω' && value < 0))
    return null;
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
  properties: Record<string, string | number | boolean>,
  key: string,
  unit: QuantityUnit,
): string | undefined {
  const input = properties[key + 'Fraction'];
  if (typeof input !== 'string') return undefined;
  const parsed = parseQuantity(input, unit);
  return parsed?.fraction && parsed.value === Number(properties[key]) ? parsed.fraction : undefined;
}
/** Shortest round-trippable decimal, expanded to avoid e notation. */
export function plainNumber(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const parsed = decimal(String(value));
  return parsed ? decimalText(parsed.coefficient, parsed.power) : '—';
}
function scientific(value: number, unitPower = 0): string {
  if (value === 0) return '0';
  const [mantissa, exponent] = value.toExponential(3).split('e');
  const superscripts: Record<string, string> = {
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
  return mantissa + ' × 10' + [...String(Number(exponent) - unitPower)].map((c) => superscripts[c]).join('');
}
function automaticNumber(value: number): string {
  const rounded = Number(value.toFixed(2));
  return value !== 0 && rounded === 0 ? scientific(value) : plainNumber(rounded);
}
export function createQuantityScale(
  values: readonly number[],
  unit: string,
  options: QuantityFormatOptions = defaultQuantityFormat,
) {
  const mode = options.mode ?? 'auto';
  const magnitude = values.reduce(
    (max, v) => (Number.isFinite(v) ? Math.max(max, Math.abs(v)) : max),
    0,
  );
  const outsidePrefixes = magnitude > 0 && (magnitude < 1e-12 || magnitude >= 1e9);
  let power = mode === 'auto' && magnitude > 0 ? Math.floor(Math.log10(magnitude) / 3) * 3 : 0;
  power = Math.max(-12, Math.min(6, power));
  // Promote at a rounding boundary (999.999 Ω becomes 1 kΩ).
  if (mode === 'auto' && power < 6 && Number((magnitude / 10 ** power).toFixed(2)) >= 1000)
    power += 3;
  if (outsidePrefixes) power = 0;
  const prefix = mode === 'auto' ? prefixes.find((p) => p.power === power)!.prefix : '';
  return {
    unit: prefix + unit,
    format(value: number | undefined): string {
      if (value === undefined || !Number.isFinite(value)) return '—';
      if (mode === 'scientific' || (mode === 'auto' && outsidePrefixes)) return scientific(value);
      if (mode === 'plain') return plainNumber(value);
      const scaled = value / 10 ** power;
      return value !== 0 && scaled === 0 ? scientific(value, power) : automaticNumber(scaled);
    },
  };
}
export function formatQuantity(
  value: number | undefined,
  unit: string,
  options: QuantityFormatOptions = defaultQuantityFormat,
): string {
  const scale = createQuantityScale([value ?? NaN], unit, options);
  return (scale.format(value) + ' ' + scale.unit).trimEnd();
}

export function isQuantityMode(value:unknown):value is QuantityMode {return value==='auto'||value==='scientific'||value==='plain';}
export function quantityFormatFor(properties?:Record<string,string|number|boolean>,fallback:QuantityFormatOptions=defaultQuantityFormat):QuantityFormatOptions {
  return isQuantityMode(properties?.quantityMode)?{mode:properties.quantityMode}:fallback;
}
