import type { CompiledElement, Rational } from '../domain';
import * as q from '../rational';

export const resistive = (e: CompiledElement) =>
  e.type === 'resistor' || e.type === 'resistive-load';
export const idealLink = (e: CompiledElement) =>
  e.type === 'ammeter' ||
  (e.type === 'switch' && e.closed) ||
  (resistive(e) && q.sign(e.value) === 0);
export interface Mna {
  size: number;
  terms: { row: number; col: number; value: Rational }[];
  rhs: Rational[];
}
/** Unreduced individual stamps: both solvers assemble the identical original equations. */
export function mna(
  elements: CompiledElement[],
  constraints: CompiledElement[],
  voltageIds: string[],
): Mna {
  const index = new Map(voltageIds.map((id, i) => [id, i]));
  const size = voltageIds.length + constraints.length;
  const terms: Mna['terms'] = [];
  const rhs = Array<Rational>(size).fill(q.ZERO);
  const stamp = (row: number | undefined, col: number | undefined, value: Rational) => {
    if (row !== undefined && col !== undefined) terms.push({ row, col, value });
  };
  for (const e of elements)
    if (resistive(e) && q.sign(e.value) > 0 && e.a !== e.b) {
      const a = index.get(e.a),
        b = index.get(e.b);
      const g = { numerator: e.value.denominator, denominator: e.value.numerator };
      const negative = { numerator: -g.numerator, denominator: g.denominator };
      stamp(a, a, g);
      stamp(b, b, g);
      stamp(a, b, negative);
      stamp(b, a, negative);
    }
  constraints.forEach((e, k) => {
    const row = voltageIds.length + k,
      a = index.get(e.a),
      b = index.get(e.b);
    stamp(a, row, q.ONE);
    stamp(row, a, q.ONE);
    stamp(b, row, { numerator: -1n, denominator: 1n });
    stamp(row, b, { numerator: -1n, denominator: 1n });
    rhs[row] = e.type === 'dc-voltage-source' ? e.value : q.ZERO;
  });
  return { size, terms, rhs };
}
